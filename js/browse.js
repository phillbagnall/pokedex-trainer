/*
 * Browse: searchable/filterable/sortable Pokemon grid, plus a tap-to-open
 * detail overlay. Reads Dataset (data) and Progress (due/box state), never
 * writes to Progress itself.
 */
window.Browse = (function () {
  'use strict';

  var GEN_LABELS = {
    1: 'Gen 1 (Kanto)', 2: 'Gen 2 (Johto)', 3: 'Gen 3 (Hoenn)',
    4: 'Gen 4 (Sinnoh)', 5: 'Gen 5 (Unova)', 6: 'Gen 6 (Kalos)',
    7: 'Gen 7 (Alola)', 8: 'Gen 8 (Galar)', 9: 'Gen 9 (Paldea)'
  };
  var STAT_LABELS = ['HP', 'Attack', 'Defense', 'Sp. Atk', 'Sp. Def', 'Speed'];
  var STAT_MAX = 180; // rough ceiling for the stat-bar widths

  var els = {};
  var state = { gen: '', types: [], family: '', query: '', sort: 'dex', dueOnly: false, shiny: false, starters: false };
  var overlayOpen = false;

  function init() {
    els.search = document.getElementById('browse-search');
    els.searchClear = document.getElementById('browse-search-clear');
    els.gen = document.getElementById('browse-gen');
    els.typeChecks = document.getElementById('browse-type-checks');
    els.family = document.getElementById('browse-family');
    els.sort = document.getElementById('browse-sort');
    els.dueOnly = document.getElementById('browse-due-only');
    els.starters = document.getElementById('browse-starters');
    els.shiny = document.getElementById('browse-shiny');
    els.clearFilters = document.getElementById('browse-clear-filters');
    els.count = document.getElementById('browse-count');
    els.grid = document.getElementById('browse-grid');
    els.overlay = document.getElementById('detail-overlay');
    els.detailBody = document.getElementById('detail-body');
    els.detailClose = document.getElementById('detail-close');

    Dataset.generations().forEach(function (g) {
      var opt = document.createElement('option');
      opt.value = g;
      opt.textContent = GEN_LABELS[g] || ('Gen ' + g);
      els.gen.appendChild(opt);
    });
    Dataset.types().forEach(function (t) {
      var label = document.createElement('label');
      label.className = 'type-check type-check-' + t;
      label.innerHTML =
        '<input type="checkbox" value="' + t + '">' +
        '<span>' + t[0].toUpperCase() + t.slice(1) + '</span>';
      els.typeChecks.appendChild(label);
    });
    Dataset.families()
      .slice()
      .sort(function (a, b) { return a.name.localeCompare(b.name); })
      .forEach(function (f) {
        var opt = document.createElement('option');
        opt.value = f.id;
        opt.textContent = f.name + ' line';
        els.family.appendChild(opt);
      });

    els.search.addEventListener('input', function () {
      state.query = els.search.value;
      els.searchClear.hidden = !state.query;
      render();
    });
    els.searchClear.addEventListener('click', function () {
      state.query = '';
      els.search.value = '';
      els.searchClear.hidden = true;
      render();
    });
    els.gen.addEventListener('change', function () { state.gen = els.gen.value; render(); });
    els.typeChecks.addEventListener('change', function () {
      state.types = Array.prototype.slice
        .call(els.typeChecks.querySelectorAll('input:checked'))
        .map(function (input) { return input.value; });
      render();
    });
    els.family.addEventListener('change', function () { state.family = els.family.value; render(); });
    els.sort.addEventListener('change', function () { state.sort = els.sort.value; render(); });
    els.dueOnly.addEventListener('change', function () { state.dueOnly = els.dueOnly.checked; render(); });
    els.starters.addEventListener('change', function () {
      state.starters = els.starters.checked;
      // Ordered by generation by default when this turns on, so the nine
      // trios appear one generation at a time - she can still pick a
      // different sort afterwards if she wants.
      if (state.starters) {
        state.sort = 'gen';
        els.sort.value = 'gen';
      }
      render();
    });
    els.shiny.addEventListener('change', function () { state.shiny = els.shiny.checked; render(); });
    els.clearFilters.addEventListener('click', clearFilters);

    els.grid.addEventListener('click', function (e) {
      var card = e.target.closest('.poke-card');
      if (card) openDetail(Number(card.dataset.id));
    });
    els.detailClose.addEventListener('click', closeDetail);
    els.overlay.addEventListener('click', function (e) {
      if (e.target === els.overlay) closeDetail();
    });
    // A phone's hardware/gesture back button should close the detail
    // popup, not exit the app: opening it pushes a history entry, and
    // popping that entry (by any means - back button or the close
    // controls above) is what actually hides it.
    window.addEventListener('popstate', function () {
      if (overlayOpen) hideDetail();
    });

    render();
  }

  function clearFilters() {
    state.gen = '';
    state.types = [];
    state.family = '';
    state.query = '';
    state.dueOnly = false;
    state.starters = false;
    els.gen.value = '';
    els.typeChecks.querySelectorAll('input:checked').forEach(function (input) { input.checked = false; });
    els.family.value = '';
    els.search.value = '';
    els.searchClear.hidden = true;
    els.dueOnly.checked = false;
    els.starters.checked = false;
    render();
  }

  function computeList() {
    var list = Dataset.filter({
      gen: state.gen, types: state.types, family: state.family, query: state.query,
      startersOnly: state.starters
    });
    if (state.dueOnly) {
      var due = new Set(Progress.dueIds(Dataset.all().map(function (p) { return p.id; })));
      list = list.filter(function (p) { return due.has(p.id); });
    }
    return Dataset.sort(list, state.sort, { boxOf: Progress.boxOf });
  }

  function typeBadges(types) {
    return types.map(function (t) {
      return '<span class="type-badge type-' + t + '">' + t + '</span>';
    }).join('');
  }

  function render() {
    var list = computeList();
    els.count.textContent = list.length + (list.length === 1 ? ' Pokemon' : ' Pokemon');
    els.grid.classList.toggle('shiny-mode', state.shiny);

    var frag = document.createDocumentFragment();
    list.forEach(function (p) {
      var card = document.createElement('button');
      card.className = 'poke-card';
      card.dataset.id = p.id;
      card.innerHTML =
        '<span class="poke-dex">#' + String(p.dex).padStart(3, '0') + '</span>' +
        '<img loading="lazy" src="' + Dataset.imageUrl(p.id, state.shiny) + '" alt="' + p.name + '">' +
        '<span class="poke-name">' + p.name + '</span>' +
        '<span class="type-badges">' + typeBadges(p.types) + '</span>';
      frag.appendChild(card);
    });
    els.grid.innerHTML = '';
    els.grid.appendChild(frag);
  }

  function evoChainLine(p) {
    var parts = [];
    if (p.evoFrom) {
      var from = Dataset.byId(p.evoFrom);
      if (from) parts.push('Evolves from <strong>' + from.name + '</strong>');
    }
    if (p.evoTo.length) {
      var tos = p.evoTo.map(function (e) {
        var target = Dataset.byId(e.id);
        return (target ? target.name : '#' + e.id) + ' (' + e.m + ')';
      });
      parts.push('Evolves into ' + tos.map(function (t) { return '<strong>' + t + '</strong>'; }).join(', '));
    }
    if (!parts.length) parts.push('Does not evolve');
    return parts.join('<br>');
  }

  function statBars(stats) {
    return stats.map(function (v, i) {
      var pct = Math.min(100, Math.round((v / STAT_MAX) * 100));
      return (
        '<div class="stat-row">' +
          '<span class="stat-label">' + STAT_LABELS[i] + '</span>' +
          '<span class="stat-bar"><span style="width:' + pct + '%"></span></span>' +
          '<span class="stat-value">' + v + '</span>' +
        '</div>'
      );
    }).join('');
  }

  function matchupBadges(list) {
    return list.map(function (m) {
      var label = m.mult === 4 ? '4x' : m.mult === 2 ? '2x' : m.mult === 0.5 ? '1/2x' : m.mult === 0.25 ? '1/4x' : '0x';
      return '<span class="type-badge type-' + m.type + '">' + m.type + ' ' + label + '</span>';
    }).join('');
  }

  function matchupsBlock(types) {
    var m = TypeChart.matchups(types);
    var rows = [];
    if (m.weak.length) rows.push('<p class="matchup-row"><span class="matchup-label">Weak to</span>' + matchupBadges(m.weak) + '</p>');
    if (m.resist.length) rows.push('<p class="matchup-row"><span class="matchup-label">Resists</span>' + matchupBadges(m.resist) + '</p>');
    if (m.immune.length) rows.push('<p class="matchup-row"><span class="matchup-label">Immune to</span>' + matchupBadges(m.immune) + '</p>');
    return rows.join('');
  }

  var FORM_KIND_LABELS = { mega: 'Mega Evolution', gmax: 'Gigantamax' };

  function specialFormsBlock(forms) {
    if (!forms || !forms.length) return '';
    var cards = forms.map(function (f) {
      return (
        '<div class="special-form-card">' +
          '<img src="' + Dataset.imageUrl(f.id) + '" alt="' + f.name + '">' +
          '<span class="special-form-name">' + f.name + '</span>' +
          '<span class="muted">' + (FORM_KIND_LABELS[f.kind] || f.kind) + '</span>' +
          '<span class="type-badges">' + typeBadges(f.types) + '</span>' +
        '</div>'
      );
    }).join('');
    return '<h3>Special forms</h3><div class="special-forms">' + cards + '</div>';
  }

  function openDetail(id) {
    var p = Dataset.byId(id);
    if (!p) return;
    var entry = Progress.entryOf(id);
    var boxLine = entry
      ? 'Leitner box ' + entry.box + '/5 &middot; seen ' + entry.seen + ' &middot; ' +
        Math.round((entry.correct / entry.seen) * 100) + '% correct'
      : 'Not studied yet';
    var isFamily = !!(p.evoFrom || p.evoTo.length);

    els.detailBody.innerHTML =
      '<img id="detail-img" class="detail-img" src="' + Dataset.imageUrl(p.id, state.shiny) + '" alt="' + p.name + '">' +
      '<h2>' + p.name + ' <span class="muted">#' + String(p.dex).padStart(3, '0') + '</span></h2>' +
      '<p class="type-badges">' + typeBadges(p.types) + '</p>' +
      '<div class="matchups">' + matchupsBlock(p.types) + '</div>' +
      '<p class="muted">' + (GEN_LABELS[p.gen] || ('Gen ' + p.gen)) + '</p>' +
      '<div class="stat-block">' + statBars(p.stats) + '</div>' +
      '<p>Height ' + (p.height / 10).toFixed(1) + ' m &middot; Weight ' + (p.weight / 10).toFixed(1) + ' kg</p>' +
      '<p>Abilities: ' + p.abilities.join(', ') + '</p>' +
      '<p class="evo-line">' + evoChainLine(p) + '</p>' +
      (isFamily ? '<button id="detail-see-line" type="button" class="btn btn-primary">See full evolution line</button>' : '') +
      specialFormsBlock(p.forms) +
      '<p class="muted">' + boxLine + '</p>';

    var seeLineBtn = document.getElementById('detail-see-line');
    if (seeLineBtn) {
      seeLineBtn.addEventListener('click', function () {
        state.family = String(p.family);
        els.family.value = state.family;
        render();
        closeDetail();
      });
    }

    els.overlay.hidden = false;
    overlayOpen = true;
    history.pushState({ pokedexDetail: true }, '');
  }

  function closeDetail() {
    if (!overlayOpen) return;
    history.back();
  }

  function hideDetail() {
    els.overlay.hidden = true;
    overlayOpen = false;
  }

  return { init: init, refresh: render };
})();
