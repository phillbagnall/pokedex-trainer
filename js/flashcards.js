/*
 * Flashcards: two study modes, both driving Progress.recordResult once per
 * Pokemon answered (one Leitner track per Pokemon, not per fact type).
 *
 * Picture -> Name: silhouette reveal, typed-answer with autocomplete,
 * normalised auto-grading plus a manual "got it right anyway" override.
 *
 * Name/Type -> Details: multiple choice on a random fact (a base stat,
 * evolution target, secondary type, or an ability).
 */
window.Flashcards = (function () {
  'use strict';

  var ROUND_SIZE = 10;
  var STAT_LABELS = ['HP', 'Attack', 'Defense', 'Sp. Atk', 'Sp. Def', 'Speed'];
  var GEN_LABELS = {
    1: 'Gen 1 (Kanto)', 2: 'Gen 2 (Johto)', 3: 'Gen 3 (Hoenn)',
    4: 'Gen 4 (Sinnoh)', 5: 'Gen 5 (Unova)', 6: 'Gen 6 (Kalos)',
    7: 'Gen 7 (Alola)', 8: 'Gen 8 (Galar)', 9: 'Gen 9 (Paldea)'
  };

  var els = {};
  var selectedGen = '';
  var mode = null;
  var queue = [];
  var idx = 0;
  var correctCount = 0;
  var current = null;
  var currentFact = null; // { correctIndex, options } for details mode

  function init() {
    els.picker = document.getElementById('study-picker');
    els.session = document.getElementById('study-session');
    els.summary = document.getElementById('study-round-summary');
    els.dueCount = document.getElementById('study-due-count');
    els.progressLabel = document.getElementById('study-progress-label');
    els.card = document.getElementById('study-card');
    els.roundStats = document.getElementById('study-round-stats');
    els.genSelect = document.getElementById('study-gen');

    Dataset.generations().forEach(function (g) {
      var opt = document.createElement('option');
      opt.value = g;
      opt.textContent = GEN_LABELS[g] || ('Gen ' + g);
      els.genSelect.appendChild(opt);
    });
    els.genSelect.addEventListener('change', function () {
      selectedGen = els.genSelect.value;
      refreshPicker();
    });

    document.getElementById('study-mode-picture').addEventListener('click', function () { start('picture'); });
    document.getElementById('study-mode-details').addEventListener('click', function () { start('details'); });
    document.getElementById('study-mode-evolution').addEventListener('click', function () { start('evolution'); });
    document.getElementById('study-quit').addEventListener('click', backToPicker);
    document.getElementById('study-back').addEventListener('click', backToPicker);
    document.getElementById('study-again').addEventListener('click', function () { start(mode); });

    refreshPicker();
  }

  function poolIds() {
    return Dataset.filter({ gen: selectedGen }).map(function (p) { return p.id; });
  }

  // Evolutions mode can only ask about Pokemon that actually evolve from
  // or into something.
  function eligibleIds() {
    var ids = poolIds();
    if (mode === 'evolution') {
      ids = ids.filter(function (id) {
        var p = Dataset.byId(id);
        return p.evoFrom || p.evoTo.length;
      });
    }
    return ids;
  }

  function refreshPicker() {
    var due = Progress.dueIds(poolIds());
    var suffix = selectedGen ? ' in ' + (GEN_LABELS[selectedGen] || ('Gen ' + selectedGen)) : '';
    els.dueCount.textContent = due.length
      ? due.length + ' due for review today' + suffix + '.'
      : 'Nothing due today' + suffix + ' - study any Pokemon for extra practice.';
  }

  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i -= 1) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
    return arr;
  }

  function buildQueue() {
    var allIds = eligibleIds();
    var due = Progress.dueIds(allIds);
    var pool = due.length ? due : allIds;
    return shuffle(pool.slice()).slice(0, Math.min(ROUND_SIZE, pool.length));
  }

  function start(selectedMode) {
    mode = selectedMode;
    queue = buildQueue();
    if (!queue.length) {
      els.dueCount.textContent = 'No evolving Pokemon in this selection - try a different generation.';
      return;
    }
    idx = 0;
    correctCount = 0;
    els.picker.hidden = true;
    els.summary.hidden = true;
    els.session.hidden = false;
    renderCurrent();
  }

  function backToPicker() {
    els.session.hidden = true;
    els.summary.hidden = true;
    els.picker.hidden = false;
    refreshPicker();
    if (window.Browse) window.Browse.refresh();
  }

  function renderCurrent() {
    current = Dataset.byId(queue[idx]);
    els.progressLabel.textContent = (idx + 1) + ' / ' + queue.length;
    if (mode === 'picture') renderPictureCard();
    else if (mode === 'evolution') renderEvolutionCard();
    else renderDetailsCard();
  }

  /* ---------------- Picture -> Name ---------------- */

  function normaliseName(s) {
    return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function renderPictureCard() {
    els.card.innerHTML =
      '<div class="silhouette-wrap">' +
        '<img id="fc-image" class="silhouette" src="' + Dataset.imageUrl(current.id) + '" alt="Who is this Pokemon?">' +
      '</div>' +
      '<form id="fc-guess-form" autocomplete="off">' +
        '<input id="fc-guess" type="text" placeholder="Type its name&hellip;" autocomplete="off" autocapitalize="off" spellcheck="false">' +
        '<div id="fc-suggestions" class="suggestions"></div>' +
        '<button type="submit" class="btn btn-primary">Guess</button>' +
      '</form>' +
      '<p class="hint-row"><button type="button" id="fc-hint-btn" class="link-btn">Hint</button></p>' +
      '<p id="fc-hint" class="muted" hidden></p>' +
      '<div id="fc-result" class="fc-result"></div>';

    var input = document.getElementById('fc-guess');
    var suggestions = document.getElementById('fc-suggestions');
    var form = document.getElementById('fc-guess-form');
    var hintBtn = document.getElementById('fc-hint-btn');
    var hintEl = document.getElementById('fc-hint');

    hintBtn.addEventListener('click', function () {
      hintEl.textContent = 'Starts with "' + current.name[0].toUpperCase() + '" · ' + current.name.length + ' letters';
      hintEl.hidden = false;
      hintBtn.hidden = true;
    });

    input.addEventListener('input', function () {
      var q = input.value.trim().toLowerCase();
      suggestions.innerHTML = '';
      if (!q) return;
      var matches = Dataset.all()
        .filter(function (p) { return p.name.toLowerCase().indexOf(q) === 0; })
        .slice(0, 6);
      matches.forEach(function (p) {
        var item = document.createElement('button');
        item.type = 'button';
        item.className = 'suggestion-item';
        item.textContent = p.name;
        item.addEventListener('click', function () {
          input.value = p.name;
          suggestions.innerHTML = '';
          gradePicture(p.name);
        });
        suggestions.appendChild(item);
      });
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      gradePicture(input.value);
    });

    input.focus();
  }

  function gradePicture(typed) {
    var correct = normaliseName(typed) === normaliseName(current.name);
    revealPicture(correct);
  }

  function revealPicture(correct) {
    document.getElementById('fc-image').classList.remove('silhouette');
    document.getElementById('fc-suggestions').innerHTML = '';
    var overrideBtn = correct ? '' :
      '<button id="fc-override" type="button" class="link-btn">I got it right anyway</button>';
    document.getElementById('fc-result').innerHTML =
      '<p class="' + (correct ? 'result-correct' : 'result-wrong') + '">' +
        (correct ? 'Correct! ' : 'It was ') + '<strong>' + current.name + '</strong>' +
      '</p>' +
      overrideBtn +
      '<button id="fc-next" type="button" class="btn btn-primary">Next</button>';
    document.getElementById('fc-guess-form').querySelector('button[type="submit"]').disabled = true;
    document.getElementById('fc-guess').disabled = true;

    // Recorded exactly once, when the verdict is final: immediately if
    // correct, otherwise on override or on Next (whichever comes first) -
    // never both, so one flashcard never counts as two attempts.
    var recorded = false;
    function finalise(wasCorrect) {
      if (recorded) return;
      recorded = true;
      Progress.recordResult(current.id, wasCorrect);
      if (wasCorrect) { correctCount += 1; Sound.correct(); } else { Sound.wrong(); }
    }

    if (correct) finalise(true);

    var overrideEl = document.getElementById('fc-override');
    if (overrideEl) {
      overrideEl.addEventListener('click', function () {
        finalise(true);
        document.getElementById('fc-result').querySelector('p').className = 'result-correct';
        overrideEl.remove();
      });
    }

    document.getElementById('fc-next').addEventListener('click', function () {
      finalise(false);
      advance();
    });
  }

  /* ---------------- shared evolution fact (used by Details and Evolutions) ---------------- */

  /*
   * direction 'forward' asks what current evolves into; 'backward' asks
   * what it evolves from. Caller is responsible for only asking for a
   * direction current actually has (evoTo.length / evoFrom).
   */
  function evoFact(direction) {
    var targetId = direction === 'forward'
      ? current.evoTo[Math.floor(Math.random() * current.evoTo.length)].id
      : current.evoFrom;
    var targetPoke = Dataset.byId(targetId);
    var others = shuffle(
      Dataset.all().filter(function (p) {
        return p.id !== targetPoke.id && p.id !== current.id && p.family !== current.family;
      })
    ).slice(0, 3);
    var options = shuffle([targetPoke.name].concat(others.map(function (p) { return p.name; })));
    return {
      question: direction === 'forward'
        ? 'What does ' + current.name + ' evolve into?'
        : 'What does ' + current.name + ' evolve from?',
      options: options,
      correct: targetPoke.name
    };
  }

  /* ---------------- Name/Type -> Details ---------------- */

  function buildFact() {
    var generators = [];

    generators.push(function () {
      var statIdx = Math.floor(Math.random() * STAT_LABELS.length);
      var correctVal = current.stats[statIdx];
      var options = new Set([correctVal]);
      while (options.size < 4) {
        var delta = (Math.floor(Math.random() * 4) + 1) * 5 * (Math.random() < 0.5 ? -1 : 1);
        var candidate = Math.max(1, correctVal + delta);
        options.add(candidate);
      }
      return {
        question: 'What is ' + current.name + '’s base ' + STAT_LABELS[statIdx] + '?',
        options: shuffle(Array.from(options).map(String)),
        correct: String(correctVal)
      };
    });

    if (current.evoTo.length) {
      generators.push(function () { return evoFact('forward'); });
    }

    if (current.types.length > 1) {
      generators.push(function () {
        var correctType = current.types[1];
        var otherTypes = shuffle(Dataset.types().filter(function (t) { return current.types.indexOf(t) === -1; })).slice(0, 3);
        var options = shuffle([correctType].concat(otherTypes));
        return {
          question: 'Besides ' + current.types[0] + ', what is ' + current.name + '’s other type?',
          options: options,
          correct: correctType,
          hideSecondType: true
        };
      });
    }

    if (current.abilities.length) {
      generators.push(function () {
        var correctAbility = current.abilities[Math.floor(Math.random() * current.abilities.length)];
        var pool = Dataset.all().filter(function (p) { return p.id !== current.id; });
        var distractors = [];
        var attempts = 0;
        while (distractors.length < 3 && attempts < 50) {
          attempts += 1;
          var candidatePoke = pool[Math.floor(Math.random() * pool.length)];
          var candidate = candidatePoke.abilities[Math.floor(Math.random() * candidatePoke.abilities.length)];
          if (current.abilities.indexOf(candidate) === -1 && distractors.indexOf(candidate) === -1) {
            distractors.push(candidate);
          }
        }
        var options = shuffle([correctAbility].concat(distractors));
        return {
          question: 'Which of these is one of ' + current.name + '’s abilities?',
          options: options,
          correct: correctAbility
        };
      });
    }

    var pick = generators[Math.floor(Math.random() * generators.length)];
    return pick();
  }

  function renderDetailsCard() {
    renderChoiceCard(buildFact);
  }

  /* ---------------- Evolutions ---------------- */

  function buildEvolutionFact() {
    var canForward = current.evoTo.length > 0;
    var canBackward = !!current.evoFrom;
    var direction = canForward && canBackward
      ? (Math.random() < 0.5 ? 'forward' : 'backward')
      : (canForward ? 'forward' : 'backward');
    return evoFact(direction);
  }

  function renderEvolutionCard() {
    renderChoiceCard(buildEvolutionFact);
  }

  /* ---------------- shared multiple-choice rendering ---------------- */

  function renderChoiceCard(factBuilder) {
    currentFact = factBuilder();
    var optionsHtml = currentFact.options.map(function (opt, i) {
      return '<button class="option-btn" data-index="' + i + '">' + opt + '</button>';
    }).join('');

    // Don't show the second type badge when that's the very thing being
    // asked - it would just hand the kid the answer.
    var visibleTypes = currentFact.hideSecondType ? current.types.slice(0, 1) : current.types;

    els.card.innerHTML =
      '<div class="details-header">' +
        '<img src="' + Dataset.imageUrl(current.id) + '" alt="' + current.name + '">' +
        '<h3>' + current.name + '</h3>' +
        '<p class="type-badges">' + visibleTypes.map(function (t) {
          return '<span class="type-badge type-' + t + '">' + t + '</span>';
        }).join('') + '</p>' +
      '</div>' +
      '<p class="fc-question">' + currentFact.question + '</p>' +
      '<div id="fc-options" class="options-grid">' + optionsHtml + '</div>' +
      '<div id="fc-result" class="fc-result"></div>';

    document.getElementById('fc-options').addEventListener('click', function (e) {
      var btn = e.target.closest('.option-btn');
      if (!btn || btn.disabled) return;
      chooseOption(Number(btn.dataset.index));
    });
  }

  function chooseOption(chosenIndex) {
    var buttons = els.card.querySelectorAll('.option-btn');
    var chosenText = currentFact.options[chosenIndex];
    var correct = chosenText === currentFact.correct;

    buttons.forEach(function (btn, i) {
      btn.disabled = true;
      if (currentFact.options[i] === currentFact.correct) btn.classList.add('option-correct');
      else if (i === chosenIndex) btn.classList.add('option-wrong');
    });

    Progress.recordResult(current.id, correct);
    if (correct) { correctCount += 1; Sound.correct(); } else { Sound.wrong(); }

    document.getElementById('fc-result').innerHTML =
      '<p class="' + (correct ? 'result-correct' : 'result-wrong') + '">' +
        (correct ? 'Correct!' : 'Not quite - it’s ' + currentFact.correct) +
      '</p>' +
      '<button id="fc-next" type="button" class="btn btn-primary">Next</button>';
    document.getElementById('fc-next').addEventListener('click', advance);
  }

  /* ---------------- shared flow ---------------- */

  function advance() {
    idx += 1;
    if (idx >= queue.length) finishRound();
    else renderCurrent();
  }

  function finishRound() {
    els.session.hidden = true;
    els.summary.hidden = false;
    els.roundStats.textContent = correctCount + ' / ' + queue.length + ' correct.';
    if (window.Browse) window.Browse.refresh();
  }

  return { init: init, refreshPicker: refreshPicker };
})();
