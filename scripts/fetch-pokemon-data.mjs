#!/usr/bin/env node
/*
 * Generates data/pokemon.json: all National Dex species (Gen 1-9, ids
 * 1-1025) plus regional forms (Alolan/Galarian/Hisuian/Paldean) as their
 * own near-independent entries, and Mega Evolution/Gigantamax as bonus
 * "forms" attached to their base species. Built by joining PokeAPI's own
 * CSV data dump, pulled straight from its GitHub repo
 * (raw.githubusercontent.com/PokeAPI/pokeapi) - the same source PokeAPI's
 * REST API is generated from, but joining ~20 bulk CSV files locally is
 * far more robust than thousands of individual REST calls.
 *
 * Maintainer-only. Never run by the deployed app. Requires Node 18+ (uses
 * the built-in fetch). No npm dependencies.
 *
 *   node scripts/fetch-pokemon-data.mjs
 *
 * Data model:
 * - Base species records (ids 1-1025): unchanged shape, plus a `dex`
 *   field (always equal to `id` here - see regional forms below) and a
 *   `forms` array of any Mega Evolution / Gigantamax forms (empty if
 *   none). These are battle-only, temporary, and don't have their own
 *   evolution chain, so they're just extra facts on the base entry
 *   rather than separate dex entries.
 * - Regional form records (appended after the 1025 base ones): full
 *   near-independent entries - own id (PokeAPI's real pokemon id, used
 *   for sprite lookup), own types/stats/abilities (they can genuinely
 *   differ, e.g. Alolan Vulpix is Ice-type), own evolution chain and
 *   family/stage (computed only among same-region siblings - Alolan
 *   Vulpix -> Alolan Ninetales is its own line, separate from the
 *   Kantonian one). `dex` holds the shared National Dex number (so both
 *   show e.g. "#037"), `variant` is 'alola'|'galar'|'hisui'|'paldea', and
 *   `baseId` links back to the base species' id.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const OUT_FILE = path.join(REPO_ROOT, 'data', 'pokemon.json');
const CACHE_DIR = path.join(__dirname, '.pokeapi-cache');

const CSV_BASE = 'https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv';
const EN = '9'; // languages.csv: id 9 = English
const NATIONAL_DEX_MAX = 1025; // last species of Gen 9 (Scarlet/Violet)

// form_identifier values (from pokemon_forms.csv) that count as a real,
// permanent, catchable regional form, mapped to the region label used in
// the app. Most regions are one plain identifier per species, but a
// couple of species need an explicit extra entry:
// - Darmanitan's Galarian form is "galar-standard" (its battle-only "Zen
//   Mode" is "galar-zen" and deliberately excluded, same as Mega/Gigantamax
//   - a temporary battle state, not a separate creature).
// - Tauros has three distinct Paldean breeds, not one "paldea" form.
// Deliberately excluded: "-cap" (Pikachu's cosmetic event hats), "totem-"
// (oversized single-encounter versions with no typing/appearance change
// beyond size, the same reasoning as skipping Dynamax).
const REGIONAL_FORM_IDENTIFIERS = new Map([
  ['alola', 'alola'],
  ['galar', 'galar'],
  ['galar-standard', 'galar'],
  ['hisui', 'hisui'],
  ['paldea', 'paldea'],
  ['paldea-combat-breed', 'paldea'],
  ['paldea-blaze-breed', 'paldea'],
  ['paldea-aqua-breed', 'paldea']
]);

const STAT_INDEX = { 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5 }; // hp,atk,def,spa,spd,spe

/* ---------------- fetch + cache ---------------- */

async function fetchCsv(name) {
  const cachePath = path.join(CACHE_DIR, name);
  if (existsSync(cachePath)) {
    return readFile(cachePath, 'utf8');
  }
  const url = `${CSV_BASE}/${name}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);
  }
  const text = await res.text();
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(cachePath, text, 'utf8');
  return text;
}

/* ---------------- tiny RFC4180-ish CSV parser ---------------- */

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const lines = text.split(/\r\n|\n/);
  for (const line of lines) {
    if (line === '' && !inQuotes) continue;
    let i = 0;
    if (!inQuotes) { row = []; field = ''; }
    while (i < line.length) {
      const c = line[i];
      if (inQuotes) {
        if (c === '"') {
          if (line[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQuotes = false; i += 1; continue;
        }
        field += c; i += 1; continue;
      }
      if (c === '"') { inQuotes = true; i += 1; continue; }
      if (c === ',') { row.push(field); field = ''; i += 1; continue; }
      field += c; i += 1;
    }
    if (inQuotes) { field += '\n'; continue; } // embedded newline, keep accumulating
    row.push(field);
    rows.push(row);
  }
  const header = rows.shift();
  return rows.map((r) => {
    const obj = {};
    header.forEach((h, idx) => { obj[h] = r[idx] === undefined ? '' : r[idx]; });
    return obj;
  });
}

function groupBy(rows, key) {
  const map = new Map();
  for (const r of rows) {
    const k = r[key];
    if (!k) continue;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  }
  return map;
}

/* ---------------- evolution method labelling ---------------- */

function titleCase(identifier) {
  return identifier.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
}

function evoLabel(row, triggerName, itemNameById) {
  const item = row.trigger_item_id ? itemNameById.get(row.trigger_item_id) : null;
  switch (triggerName) {
    case 'level-up':
      if (row.minimum_level) return `Level ${row.minimum_level}`;
      if (row.minimum_happiness) return 'High friendship';
      if (row.minimum_beauty) return 'High beauty';
      if (row.minimum_affection) return 'High affection';
      if (row.known_move_id || row.known_move_type_id) return 'Level up (knows a move)';
      if (row.time_of_day) return `Level up (${row.time_of_day})`;
      if (row.location_id) return 'Level up (at a location)';
      return 'Level up';
    case 'trade':
      return item ? `Trade holding ${item}` : 'Trade';
    case 'use-item':
      return item ? `Use ${item}` : 'Use item';
    case 'shed':
      return 'Empty Poke Ball + free party slot';
    case 'spin':
      return 'Spin holding item';
    default:
      return titleCase(triggerName || 'other');
  }
}

/* ---------------- main ---------------- */

async function main() {
  console.log('Fetching PokeAPI CSV data dump...');
  const [
    pokemonCsv, speciesCsv, speciesNamesCsv, typesCsv, pokemonTypesCsv,
    pokemonStatsCsv, pokemonAbilitiesCsv, abilityNamesCsv, evolutionCsv,
    evolutionTriggersCsv, itemNamesCsv, pokemonFormsCsv, pokemonFormNamesCsv,
    versionGroupsCsv
  ] = await Promise.all([
    fetchCsv('pokemon.csv'),
    fetchCsv('pokemon_species.csv'),
    fetchCsv('pokemon_species_names.csv'),
    fetchCsv('types.csv'),
    fetchCsv('pokemon_types.csv'),
    fetchCsv('pokemon_stats.csv'),
    fetchCsv('pokemon_abilities.csv'),
    fetchCsv('ability_names.csv'),
    fetchCsv('pokemon_evolution.csv'),
    fetchCsv('evolution_triggers.csv'),
    fetchCsv('item_names.csv'),
    fetchCsv('pokemon_forms.csv'),
    fetchCsv('pokemon_form_names.csv'),
    fetchCsv('version_groups.csv')
  ]);

  const pokemon = parseCsv(pokemonCsv);
  const species = parseCsv(speciesCsv);
  const speciesNames = parseCsv(speciesNamesCsv);
  const types = parseCsv(typesCsv);
  const pokemonTypes = parseCsv(pokemonTypesCsv);
  const pokemonStats = parseCsv(pokemonStatsCsv);
  const pokemonAbilities = parseCsv(pokemonAbilitiesCsv);
  const abilityNames = parseCsv(abilityNamesCsv);
  const evolutions = parseCsv(evolutionCsv);
  const evolutionTriggers = parseCsv(evolutionTriggersCsv);
  const itemNames = parseCsv(itemNamesCsv);
  const pokemonForms = parseCsv(pokemonFormsCsv);
  const pokemonFormNames = parseCsv(pokemonFormNamesCsv);
  const versionGroups = parseCsv(versionGroupsCsv);

  console.log('Joining...');

  const typeNameById = new Map(types.map((t) => [t.id, t.identifier]));
  const speciesNameById = new Map(
    speciesNames.filter((n) => n.local_language_id === EN).map((n) => [n.pokemon_species_id, n.name])
  );
  const abilityNameById = new Map(
    abilityNames.filter((n) => n.local_language_id === EN).map((n) => [n.ability_id, n.name])
  );
  const itemNameById = new Map(
    itemNames.filter((n) => n.local_language_id === EN).map((n) => [n.item_id, n.name])
  );
  const formNameById = new Map(
    pokemonFormNames.filter((n) => n.local_language_id === EN).map((n) => [n.pokemon_form_id, n.pokemon_name])
  );
  const generationByVersionGroupId = new Map(versionGroups.map((v) => [v.id, Number(v.generation_id)]));
  const triggerNameById = new Map(evolutionTriggers.map((t) => [t.id, t.identifier]));
  // One representative evolution row per evolved species (method can vary
  // slightly by version group; any one of them is a fine flashcard fact).
  const evolutionByEvolvedSpeciesId = new Map();
  for (const row of evolutions) {
    if (!evolutionByEvolvedSpeciesId.has(row.evolved_species_id)) {
      evolutionByEvolvedSpeciesId.set(row.evolved_species_id, row);
    }
  }
  // Some evolutions are form-specific (e.g. Alolan Vulpix uses an Ice
  // Stone where the Kantonian one uses a Fire Stone; Paldean Wooper is
  // the only Wooper that evolves into Clodsire at all) - PokeAPI records
  // those with an explicit base_form_id, keyed here by the source form's
  // own pokemon id. evolved_form_id is only set when the *target* also
  // has its own alternate-form id (e.g. Alolan Ninetales); when the
  // target is just a plain species (like Clodsire), fall back to its
  // species id instead - base_form_id alone is what marks the row as
  // form-specific, not evolved_form_id.
  const formEvoRows = evolutions.filter((e) => e.base_form_id);
  const formEvoRowsByBaseFormId = groupBy(formEvoRows, 'base_form_id');
  const formEvoRowsByEvolvedFormId = groupBy(
    formEvoRows.filter((e) => e.evolved_form_id), 'evolved_form_id'
  );

  const pokemonRowById = new Map(pokemon.map((p) => [p.id, p]));
  const defaultFormById = new Map(
    pokemon
      .filter((p) => p.is_default === '1' && Number(p.species_id) <= NATIONAL_DEX_MAX)
      .map((p) => [p.species_id, p])
  );
  const typesByPokemonId = groupBy(pokemonTypes, 'pokemon_id');
  const statsByPokemonId = groupBy(pokemonStats, 'pokemon_id');
  const abilitiesByPokemonId = groupBy(pokemonAbilities, 'pokemon_id');
  const speciesById = new Map(species.map((s) => [s.id, s]));
  const childrenByParentId = groupBy(
    species.filter((s) => s.evolves_from_species_id),
    'evolves_from_species_id'
  );

  function extractFacts(pokemonId) {
    const typeRows = (typesByPokemonId.get(pokemonId) || []).sort((a, b) => a.slot - b.slot);
    const typeNames = typeRows.map((t) => typeNameById.get(t.type_id));

    const statArr = [0, 0, 0, 0, 0, 0];
    for (const row of statsByPokemonId.get(pokemonId) || []) {
      const idx = STAT_INDEX[row.stat_id];
      if (idx !== undefined) statArr[idx] = Number(row.base_stat);
    }

    const abilityRows = (abilitiesByPokemonId.get(pokemonId) || []).sort((a, b) => a.slot - b.slot);
    const abilityNamesArr = abilityRows.map((a) => abilityNameById.get(a.ability_id)).filter(Boolean);

    return { types: typeNames, stats: statArr, abilities: abilityNamesArr };
  }

  // family/stage: walk each species up its evolves_from chain to the root,
  // memoised so repeated chain members don't get re-walked.
  const familyStageById = new Map();
  function resolveFamilyStage(id) {
    if (familyStageById.has(id)) return familyStageById.get(id);
    const s = speciesById.get(id);
    if (!s || !s.evolves_from_species_id) {
      const result = { family: Number(id), stage: 1 };
      familyStageById.set(id, result);
      return result;
    }
    const parent = resolveFamilyStage(s.evolves_from_species_id);
    const result = { family: parent.family, stage: parent.stage + 1 };
    familyStageById.set(id, result);
    return result;
  }

  /* ---------------- Mega Evolution / Gigantamax: bonus forms on base records ---------------- */

  const formsByBaseDex = new Map();
  function addSpecialForm(row, kind) {
    const pid = row.pokemon_id;
    const pRow = pokemonRowById.get(pid);
    if (!pRow) return;
    const baseDex = Number(pRow.species_id);
    if (baseDex > NATIONAL_DEX_MAX) return;
    const facts = extractFacts(pid);
    const list = formsByBaseDex.get(baseDex) || [];
    list.push({
      id: Number(pid),
      kind,
      name: formNameById.get(row.id) || titleCase(row.identifier),
      types: facts.types,
      stats: facts.stats,
      height: Number(pRow.height),
      weight: Number(pRow.weight),
      abilities: facts.abilities
    });
    formsByBaseDex.set(baseDex, list);
  }
  pokemonForms.filter((f) => f.is_mega === '1').forEach((f) => addSpecialForm(f, 'mega'));
  pokemonForms.filter((f) => f.form_identifier === 'gmax').forEach((f) => addSpecialForm(f, 'gmax'));

  /* ---------------- base species records (ids 1-1025) ---------------- */

  const baseRecords = [];
  for (let id = 1; id <= NATIONAL_DEX_MAX; id += 1) {
    const idStr = String(id);
    const s = speciesById.get(idStr);
    const form = defaultFormById.get(idStr);
    if (!s || !form) {
      throw new Error(`Missing species or default form for dex id ${id}`);
    }

    const facts = extractFacts(idStr);

    const children = (childrenByParentId.get(idStr) || [])
      .map((c) => Number(c.id))
      .sort((a, b) => a - b)
      .map((childId) => {
        const evoRow = evolutionByEvolvedSpeciesId.get(String(childId));
        const triggerName = evoRow ? triggerNameById.get(evoRow.evolution_trigger_id) : null;
        const m = evoRow ? evoLabel(evoRow, triggerName, itemNameById) : 'Unknown';
        return { id: childId, m };
      });

    const { family, stage } = resolveFamilyStage(idStr);

    baseRecords.push({
      id,
      dex: id,
      name: speciesNameById.get(idStr) || titleCase(s.identifier),
      types: facts.types,
      gen: Number(s.generation_id),
      stats: facts.stats,
      height: Number(form.height),
      weight: Number(form.weight),
      abilities: facts.abilities,
      evoFrom: s.evolves_from_species_id ? Number(s.evolves_from_species_id) : null,
      evoTo: children,
      family,
      stage,
      forms: formsByBaseDex.get(id) || []
    });
  }

  if (baseRecords.length !== NATIONAL_DEX_MAX) {
    throw new Error(`Expected ${NATIONAL_DEX_MAX} base records, got ${baseRecords.length}`);
  }
  baseRecords.forEach((r, i) => {
    if (r.id !== i + 1) throw new Error(`Dex id gap at index ${i}: got id ${r.id}`);
  });

  /* ---------------- regional forms: near-independent records ---------------- */

  const regionalRows = pokemonForms.filter((f) => REGIONAL_FORM_IDENTIFIERS.has(f.form_identifier));
  const regionalRecords = [];
  const regionalByDexVariant = new Map(); // "dex:variant" -> record
  const regionalById = new Map();

  for (const f of regionalRows) {
    const pid = f.pokemon_id;
    const pRow = pokemonRowById.get(pid);
    if (!pRow) continue;
    const baseDex = Number(pRow.species_id);
    if (baseDex > NATIONAL_DEX_MAX) continue;
    const facts = extractFacts(pid);
    const gen = generationByVersionGroupId.get(f.introduced_in_version_group_id)
      ?? Number(speciesById.get(String(baseDex)).generation_id);
    const variant = REGIONAL_FORM_IDENTIFIERS.get(f.form_identifier);

    const record = {
      id: Number(pid),
      dex: baseDex,
      name: formNameById.get(f.id) || titleCase(f.identifier),
      variant,
      baseId: baseDex,
      types: facts.types,
      gen,
      stats: facts.stats,
      height: Number(pRow.height),
      weight: Number(pRow.weight),
      abilities: facts.abilities,
      evoFrom: null,
      evoTo: [],
      family: 0,
      stage: 1
    };
    regionalRecords.push(record);
    // Keyed by the *normalised* variant (not the raw form_identifier) so
    // e.g. Darmanitan's "galar-standard" form still pairs correctly with
    // Darumaka's plain "galar" form as the same evolutionary line. Tauros'
    // three Paldean breeds collide here (all "128:paldea"), which is fine
    // since Tauros has no evolution in any direction to look up.
    regionalByDexVariant.set(`${baseDex}:${variant}`, record);
    regionalById.set(record.id, record);
  }

  // Species that have a regional form for at least one variant - used
  // below to tell "this evolution target has no regional fork, so it's a
  // shared target regardless of the parent's region" (e.g. Paldean Wooper
  // evolving into the ordinary Clodsire, a brand-new Gen 9 species with no
  // regional form of its own) apart from "this target *is* forked, just
  // not for this particular variant" (genuinely ambiguous - left out).
  const forkedDexes = new Set(regionalRecords.map((r) => r.dex));

  for (const r of regionalRecords) {
    const pidStr = String(r.id);

    // evoTo: prefer an explicit form-specific evolution row; otherwise
    // pair with the same-variant sibling of whatever the base species
    // evolves into, falling back further to the plain base entry when
    // that evolution target isn't regionally forked at all.
    const explicitTo = formEvoRowsByBaseFormId.get(pidStr);
    if (explicitTo && explicitTo.length) {
      // The same evolution sometimes appears more than once (recorded per
      // game version it's available in, e.g. Legends Arceus vs its later
      // DLC) - dedupe to one entry per distinct target, not per row.
      const seenTargets = new Set();
      r.evoTo = explicitTo.map((row) => {
        const triggerName = triggerNameById.get(row.evolution_trigger_id);
        const targetId = row.evolved_form_id ? Number(row.evolved_form_id) : Number(row.evolved_species_id);
        return { id: targetId, m: evoLabel(row, triggerName, itemNameById) };
      }).filter((entry) => {
        if (seenTargets.has(entry.id)) return false;
        seenTargets.add(entry.id);
        return true;
      });
    } else {
      const baseChildren = childrenByParentId.get(String(r.dex)) || [];
      r.evoTo = baseChildren
        .map((childSpecies) => {
          const childDex = Number(childSpecies.id);
          const sibling = regionalByDexVariant.get(`${childDex}:${r.variant}`);
          const targetId = sibling ? sibling.id : (!forkedDexes.has(childDex) ? childDex : null);
          if (!targetId) return null;
          const evoRow = evolutionByEvolvedSpeciesId.get(String(childDex));
          const triggerName = evoRow ? triggerNameById.get(evoRow.evolution_trigger_id) : null;
          const m = evoRow ? evoLabel(evoRow, triggerName, itemNameById) : 'Unknown';
          return { id: targetId, m };
        })
        .filter(Boolean);
    }

    // evoFrom: same idea, mirrored.
    const explicitFrom = formEvoRowsByEvolvedFormId.get(pidStr);
    if (explicitFrom && explicitFrom.length) {
      r.evoFrom = Number(explicitFrom[0].base_form_id);
    } else {
      const baseSpecies = speciesById.get(String(r.dex));
      const parentDex = baseSpecies && baseSpecies.evolves_from_species_id
        ? Number(baseSpecies.evolves_from_species_id) : null;
      if (parentDex == null) {
        r.evoFrom = null;
      } else {
        const parentSibling = regionalByDexVariant.get(`${parentDex}:${r.variant}`);
        r.evoFrom = parentSibling ? parentSibling.id : (!forkedDexes.has(parentDex) ? parentDex : null);
      }
    }
  }

  const regionalFamilyStageById = new Map();
  function resolveRegionalFamilyStage(id) {
    if (regionalFamilyStageById.has(id)) return regionalFamilyStageById.get(id);
    const rec = regionalById.get(id);
    if (!rec || !rec.evoFrom) {
      const result = { family: id, stage: 1 };
      regionalFamilyStageById.set(id, result);
      return result;
    }
    const parent = resolveRegionalFamilyStage(rec.evoFrom);
    const result = { family: parent.family, stage: parent.stage + 1 };
    regionalFamilyStageById.set(id, result);
    return result;
  }
  for (const r of regionalRecords) {
    const { family, stage } = resolveRegionalFamilyStage(r.id);
    r.family = family;
    r.stage = stage;
  }

  const totalMega = [...formsByBaseDex.values()].flat().filter((f) => f.kind === 'mega').length;
  const totalGmax = [...formsByBaseDex.values()].flat().filter((f) => f.kind === 'gmax').length;
  console.log(
    `Base species: ${baseRecords.length}. Regional forms: ${regionalRecords.length}. `
    + `Mega forms: ${totalMega}. Gigantamax forms: ${totalGmax}.`
  );

  const records = [...baseRecords, ...regionalRecords];

  await mkdir(path.dirname(OUT_FILE), { recursive: true });
  const json = JSON.stringify(records);
  await writeFile(OUT_FILE, json, 'utf8');

  const kb = (json.length / 1024).toFixed(1);
  console.log(`Wrote ${records.length} records (${kb} KB) to ${path.relative(REPO_ROOT, OUT_FILE)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
