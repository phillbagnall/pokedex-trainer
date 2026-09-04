/*
 * Dataset: the Pokemon reference data, loaded once from data/pokemon.json.
 *
 * Read-only, no localStorage - mirrors questions.js's role as "the data
 * source module" in the Millionaire app. Every record looks like:
 *   { id, name, types, gen, stats, height, weight, abilities,
 *     evoFrom, evoTo, family, stage }
 * stats is [hp, attack, defense, special-attack, special-defense, speed].
 */
window.Dataset = (function () {
  'use strict';

  var SPRITE_BASE =
    'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/';

  // Custom preferred order for the type sort and filter list - just her
  // own ranking, not tied to game history. Edit this array to change it;
  // anything left out (e.g. Stellar) sorts after everything listed here.
  var TYPE_ORDER = [
    'grass', 'fire', 'water', 'bug', 'normal', 'poison', 'electric',
    'ground', 'fighting', 'psychic', 'rock', 'ghost', 'ice', 'dark',
    'steel', 'dragon', 'flying', 'fairy'
  ];
  var TYPE_ORDER_INDEX = {};
  TYPE_ORDER.forEach(function (t, i) { TYPE_ORDER_INDEX[t] = i; });

  function typeOrderIndex(t) {
    return TYPE_ORDER_INDEX[t] !== undefined ? TYPE_ORDER_INDEX[t] : TYPE_ORDER.length;
  }

  var all = [];
  var byId = new Map();
  var loaded = null;

  function load() {
    if (loaded) return loaded;
    loaded = fetch('data/pokemon.json')
      .then(function (res) {
        if (!res.ok) throw new Error('Failed to load pokemon.json: ' + res.status);
        return res.json();
      })
      .then(function (records) {
        all = records;
        byId = new Map(records.map(function (r) { return [r.id, r]; }));
        return all;
      });
    return loaded;
  }

  function getAll() {
    return all;
  }

  function getById(id) {
    return byId.get(Number(id));
  }

  function imageUrl(id, shiny) {
    return SPRITE_BASE + (shiny ? 'shiny/' : '') + id + '.png';
  }

  function normalise(s) {
    return (s || '').toLowerCase().trim();
  }

  function filter(opts) {
    opts = opts || {};
    var gen = opts.gen;
    var type = opts.type;
    var family = opts.family;
    var query = normalise(opts.query);
    return all.filter(function (p) {
      if (gen && p.gen !== Number(gen)) return false;
      if (type && p.types.indexOf(type) === -1) return false;
      if (family && p.family !== Number(family)) return false;
      if (query && p.name.toLowerCase().indexOf(query) === -1) return false;
      return true;
    });
  }

  /*
   * key: 'dex' | 'name' | 'type' | 'family' | 'weakest'
   * extra.boxOf(id) -> Leitner box number, required for 'weakest'.
   */
  function sortList(list, key, extra) {
    extra = extra || {};
    var copy = list.slice();
    switch (key) {
      case 'name':
        copy.sort(function (a, b) { return a.name.localeCompare(b.name); });
        break;
      case 'type':
        copy.sort(function (a, b) {
          return typeOrderIndex(a.types[0]) - typeOrderIndex(b.types[0]) || a.id - b.id;
        });
        break;
      case 'family':
        copy.sort(function (a, b) {
          return a.family - b.family || a.stage - b.stage || a.id - b.id;
        });
        break;
      case 'weakest':
        if (typeof extra.boxOf === 'function') {
          copy.sort(function (a, b) {
            return extra.boxOf(a.id) - extra.boxOf(b.id) || a.id - b.id;
          });
        }
        break;
      case 'dex':
      default:
        copy.sort(function (a, b) { return a.id - b.id; });
    }
    return copy;
  }

  function generations() {
    var set = new Set(all.map(function (p) { return p.gen; }));
    return Array.from(set).sort(function (a, b) { return a - b; });
  }

  function types() {
    var set = new Set();
    all.forEach(function (p) { p.types.forEach(function (t) { set.add(t); }); });
    return Array.from(set).sort(function (a, b) { return typeOrderIndex(a) - typeOrderIndex(b); });
  }

  /*
   * Evolution lines with more than one member, e.g. {id: 172, name:
   * 'Pichu'} for the Pichu -> Pikachu -> Raichu line (id is the family's
   * base-species id, same value each member's `family` field carries).
   * Solo species (no evolutions either way) are left out - filtering to
   * just one of them is the same as searching its name.
   */
  function families() {
    var counts = {};
    all.forEach(function (p) { counts[p.family] = (counts[p.family] || 0) + 1; });
    return Object.keys(counts)
      .filter(function (f) { return counts[f] > 1; })
      .map(function (f) { return Number(f); })
      .sort(function (a, b) { return a - b; })
      .map(function (f) { return { id: f, name: byId.get(f).name }; });
  }

  return {
    load: load,
    all: getAll,
    byId: getById,
    imageUrl: imageUrl,
    filter: filter,
    sort: sortList,
    generations: generations,
    types: types,
    families: families
  };
})();
