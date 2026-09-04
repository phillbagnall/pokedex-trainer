/*
 * TypeChart: the standard Gen 6+ type effectiveness chart (unchanged
 * through Gen 9), used to show a Pokemon's weaknesses/resistances in the
 * detail view. Static data, no dependency on Dataset.
 */
window.TypeChart = (function () {
  'use strict';

  // attacker -> { defender: multiplier }. Anything not listed is neutral (1x).
  var CHART = {
    normal: { rock: 0.5, steel: 0.5, ghost: 0 },
    fire: { grass: 2, ice: 2, bug: 2, steel: 2, fire: 0.5, water: 0.5, rock: 0.5, dragon: 0.5 },
    water: { fire: 2, ground: 2, rock: 2, water: 0.5, grass: 0.5, dragon: 0.5 },
    electric: { water: 2, flying: 2, electric: 0.5, grass: 0.5, dragon: 0.5, ground: 0 },
    grass: { water: 2, ground: 2, rock: 2, fire: 0.5, grass: 0.5, poison: 0.5, flying: 0.5, bug: 0.5, dragon: 0.5, steel: 0.5 },
    ice: { grass: 2, ground: 2, flying: 2, dragon: 2, fire: 0.5, water: 0.5, ice: 0.5, steel: 0.5 },
    fighting: { normal: 2, ice: 2, rock: 2, dark: 2, steel: 2, poison: 0.5, flying: 0.5, psychic: 0.5, bug: 0.5, fairy: 0.5, ghost: 0 },
    poison: { grass: 2, fairy: 2, poison: 0.5, ground: 0.5, rock: 0.5, ghost: 0.5, steel: 0 },
    ground: { fire: 2, electric: 2, poison: 2, rock: 2, steel: 2, grass: 0.5, bug: 0.5, flying: 0 },
    flying: { grass: 2, fighting: 2, bug: 2, electric: 0.5, rock: 0.5, steel: 0.5 },
    psychic: { fighting: 2, poison: 2, psychic: 0.5, steel: 0.5, dark: 0 },
    bug: { grass: 2, psychic: 2, dark: 2, fire: 0.5, fighting: 0.5, poison: 0.5, flying: 0.5, ghost: 0.5, steel: 0.5, fairy: 0.5 },
    rock: { fire: 2, ice: 2, flying: 2, bug: 2, fighting: 0.5, ground: 0.5, steel: 0.5 },
    ghost: { ghost: 2, psychic: 2, dark: 0.5, normal: 0 },
    dragon: { dragon: 2, steel: 0.5, fairy: 0 },
    dark: { ghost: 2, psychic: 2, fighting: 0.5, dark: 0.5, fairy: 0.5 },
    steel: { ice: 2, rock: 2, fairy: 2, fire: 0.5, water: 0.5, electric: 0.5, steel: 0.5 },
    fairy: { fighting: 2, dragon: 2, dark: 2, fire: 0.5, poison: 0.5, steel: 0.5 }
  };

  /*
   * Combined multiplier each attacking type deals to a Pokemon with the
   * given (one or two) defending types.
   */
  function against(defendTypes) {
    var result = {};
    Object.keys(CHART).forEach(function (atk) {
      var mult = 1;
      defendTypes.forEach(function (def) {
        var row = CHART[atk];
        var m = row && row[def] !== undefined ? row[def] : 1;
        mult *= m;
      });
      result[atk] = mult;
    });
    return result;
  }

  /*
   * { weak: [{type, mult}], resist: [{type, mult}], immune: [{type, mult}] }
   * weak = takes more than 1x, resist = takes less than 1x (but not 0),
   * immune = takes none. Neutral (1x) types are left out entirely.
   */
  function matchups(defendTypes) {
    var all = against(defendTypes);
    var weak = [];
    var resist = [];
    var immune = [];
    Object.keys(all).forEach(function (t) {
      var m = all[t];
      if (m === 0) immune.push({ type: t, mult: m });
      else if (m > 1) weak.push({ type: t, mult: m });
      else if (m < 1) resist.push({ type: t, mult: m });
    });
    weak.sort(function (a, b) { return b.mult - a.mult; });
    resist.sort(function (a, b) { return a.mult - b.mult; });
    return { weak: weak, resist: resist, immune: immune };
  }

  return { matchups: matchups };
})();
