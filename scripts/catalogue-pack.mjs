#!/usr/bin/env node
// Canonical reference catalogue importer: PokéAPI's published CSV snapshot -> one
// `catalogue.json` pack that scripts/build-content.mjs turns into src/content/catalogue.ts.
//
//   node scripts/catalogue-pack.mjs --out <dir> [--clones ../src-data] [--offline]
//
// This is the *reference* lane and deliberately not the role lane (scripts/import-pack.mjs):
// a catalogue record carries canonical facts only — ordered typing, form identity, raw
// measurements with their qualifiers, species family edges — and never a sprite, cry,
// learnset, move row, spawn entry or gameplay role. It therefore does not touch
// SpriteCollab or PokeAPI/cries, and nothing it emits enters POKEDEX_SPECIES.
//
// Why the CSV snapshot rather than per-record REST documents: the pinned revision in
// content/catalogue.json supplies every field this lane needs in ten files — including
// `pokemon_evolution.region_id`, `required_pokemon_form_id` and `evolved_pokemon_form_id`,
// which carry the form and regional restrictions — so no per-Pokémon fetch is needed, and
// a pinned revision makes the output reproducible.
//
// Options
//   --out DIR      output folder for catalogue.json (required)
//   --clones DIR   read the CSVs from a checkout made by scripts/fetch-sources.sh
//                  (DIR/pokeapi-csv/data/v2/csv/*.csv) instead of the network
//   --offline      only use the download cache (.import-cache)
//
// Everything fetched is cached in .import-cache/ and recorded with its URL and SHA-256.
// Pokémon names, data and designs belong to Nintendo, Creatures, GAME FREAK and
// The Pokémon Company. Personal, non-commercial use only.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// ----------------------------------------------------------------------------- options
const argv = process.argv.slice(2);
const VALUED = new Set(['out', 'clones', 'catalogue']);
const opts = {};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith('--')) continue;
  const k = a.slice(2);
  if (VALUED.has(k)) opts[k] = argv[++i];
  else opts[k] = true;
}
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = typeof opts.out === 'string' ? opts.out : null;
const CLONES = typeof opts.clones === 'string' ? path.resolve(opts.clones) : null;
const OFFLINE = opts.offline === true;
const CATALOGUE = typeof opts.catalogue === 'string' ? opts.catalogue : path.join(ROOT, 'content/catalogue.json');
if (!OUT) { console.error('usage: node scripts/catalogue-pack.mjs --out DIR [--clones DIR] [--offline]'); process.exit(2); }

const CACHE = '.import-cache';
const spec = JSON.parse(fs.readFileSync(CATALOGUE, 'utf8'));
const REV = spec.source.revision;
const REPO = spec.source.repo;
const CSV_FILES = spec.source.csv;
const csvUrl = (name) => `https://raw.githubusercontent.com/${REPO}/${REV}/data/v2/csv/${name}.csv`;

// ----------------------------------------------------------------------------- sources, cache, provenance
const provenance = [];
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

/** The pinned CSV for `name`, from the checkout, the cache or the network (cached, with provenance). */
async function csv(name) {
  const url = csvUrl(name);
  const cacheFile = path.join(CACHE, sha(Buffer.from(url)));
  let buf = null, from = 'network';
  const local = CLONES ? path.join(CLONES, 'pokeapi-csv/data/v2/csv', `${name}.csv`) : null;
  if (local && fs.existsSync(local)) { buf = fs.readFileSync(local); from = 'clone'; }
  else if (fs.existsSync(cacheFile)) { buf = fs.readFileSync(cacheFile); from = 'cache'; }
  else if (!OFFLINE) {
    for (let attempt = 0; attempt < 3 && !buf; attempt++) {
      try {
        const res = await fetch(url, { headers: { 'user-agent': 'poke-watch-catalogue-pack/1.0 (personal, non-commercial)' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        buf = Buffer.from(await res.arrayBuffer());
        fs.mkdirSync(CACHE, { recursive: true });
        fs.writeFileSync(cacheFile, buf);
      } catch (e) {
        if (attempt === 2) throw new Error(`could not fetch ${url}: ${e.message}`);
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      }
    }
  }
  if (!buf) throw new Error(`missing source: ${url}${CLONES ? ' (not in the local checkout)' : ''}${OFFLINE ? ' (offline)' : ''}`);
  provenance.push({ file: `${name}.csv`, url, from, bytes: buf.length, sha256: sha(buf) });
  return parseCsv(buf.toString('utf8'));
}

/** RFC 4180 rows -> objects keyed by the header row. PokéAPI's CSVs quote fields containing commas. */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') { field += c; continue; }
      if (text[i + 1] === '"') { field += '"'; i++; continue; }
      quoted = false;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
      continue;
    }
    field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const head = rows.shift();
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

const index = (rows, key) => new Map(rows.map((r) => [r[key], r]));
const group = (rows, key) => { const m = new Map(); for (const r of rows) { const k = r[key]; if (!m.has(k)) m.set(k, []); m.get(k).push(r); } return m; };
const ENGLISH = '9';

// ----------------------------------------------------------------------------- build
const fail = [];
const check = (ok, msg) => { if (!ok) fail.push(msg); return ok; };

const src = {};
for (const name of CSV_FILES) src[name] = await csv(name);

const pokemon = index(src.pokemon, 'id');
const species = index(src.pokemon_species, 'id');
const speciesBySlug = index(src.pokemon_species, 'identifier');
const typeName = new Map(src.types.map((t) => [t.id, t.identifier]));
const typesOf = group(src.pokemon_types, 'pokemon_id');
const formsOf = group(src.pokemon_forms, 'pokemon_id');
const formById = index(src.pokemon_forms, 'id');
const formLabel = new Map(src.pokemon_form_names.filter((n) => n.local_language_id === ENGLISH).map((n) => [n.pokemon_form_id, n.form_name]));
const speciesName = new Map(src.pokemon_species_names.filter((n) => n.local_language_id === ENGLISH).map((n) => [n.pokemon_species_id, n.name]));
const regionName = new Map(src.regions.map((r) => [r.id, r.identifier]));
const versionGroupName = new Map(src.version_groups.map((v) => [v.id, v.identifier]));

/** The form row that describes a `pokemon` record: its default row, or its only row.
 *  Koraidon's four ride builds each have exactly one form row and none is flagged default. */
function defaultForm(pokemonId, slug) {
  const rows = formsOf.get(pokemonId) ?? [];
  const flagged = rows.filter((f) => f.is_default === '1');
  if (flagged.length === 1) return flagged[0];
  if (rows.length === 1) return rows[0];
  check(false, `${slug}: ${rows.length} form rows and ${flagged.length} flagged default; cannot pick one`);
  return rows.sort((a, b) => Number(a.form_order) - Number(b.form_order))[0] ?? null;
}

// Measurement qualifiers. The source stores decimetres and hectograms as plain integers and
// records nothing about their confidence, so the two documented exceptions are applied by rule:
// a Gigantamax form's listed height is a lower bound and its 10,000 hg mass means "unknown",
// and Eternamax's 0 hg mass means "unknown" (its listed height is a real figure).
const GMAX = /-gmax$/;
const UNKNOWN_GMAX_WEIGHT_HG = 10000;
const ETERNAMAX = 'eternatus-eternamax';

const records = [];
for (const r of spec.records) {
  const id = String(r.pokemonId);
  const p = pokemon.get(id);
  if (!check(p, `${r.pokemon}: no pokemon row for id ${r.pokemonId} in the pinned snapshot`)) continue;
  // Identity is pinned by number and then confirmed by name, never guessed from the species slug:
  // 9 species defaults (aegislash-shield, tatsugiri-curly, …) have no record at their species slug.
  check(p.identifier === r.pokemon, `id ${r.pokemonId}: snapshot slug ${p.identifier} != expected ${r.pokemon}`);
  check(p.species_id === String(r.speciesId), `${r.pokemon}: snapshot species ${p.species_id} != expected ${r.speciesId}`);
  const sp = species.get(p.species_id);
  if (!check(sp, `${r.pokemon}: no pokemon_species row for ${p.species_id}`)) continue;
  check(sp.identifier === r.species, `${r.pokemon}: snapshot species slug ${sp.identifier} != expected ${r.species}`);
  check((p.is_default === '1') === (r.formStatus === 'species-default'), `${r.pokemon}: is_default=${p.is_default} disagrees with formStatus=${r.formStatus}`);

  const slots = (typesOf.get(id) ?? []).slice().sort((a, b) => Number(a.slot) - Number(b.slot));
  check(slots.length >= 1 && slots.length <= 2, `${r.pokemon}: ${slots.length} type slots`);
  check(slots.every((s, i) => Number(s.slot) === i + 1), `${r.pokemon}: type slots are not 1..n`);
  const types = slots.map((s) => typeName.get(s.type_id));
  check(types.every(Boolean), `${r.pokemon}: unresolved type id`);

  const form = defaultForm(id, r.pokemon);
  const gmax = form ? GMAX.test(form.identifier) : false;
  const heightDm = Number(p.height), weightHg = Number(p.weight);
  check(Number.isInteger(heightDm) && heightDm > 0, `${r.pokemon}: height ${p.height}`);
  check(Number.isInteger(weightHg) && weightHg >= 0, `${r.pokemon}: weight ${p.weight}`);
  const weightUnknown = (gmax && weightHg === UNKNOWN_GMAX_WEIGHT_HG) || r.pokemon === ETERNAMAX;

  records.push({
    id: r.pokemon,
    pokemonId: Number(r.pokemonId),
    species: r.species,
    speciesId: Number(r.speciesId),
    name: speciesName.get(p.species_id) ?? sp.identifier,
    types,
    form: {
      slug: form?.identifier ?? r.pokemon,
      id: form ? Number(form.id) : Number(r.pokemonId),
      label: (form && formLabel.get(form.id)) || '',
      status: r.formStatus,
    },
    heightDm,
    heightKind: gmax ? 'lower-bound' : 'listed',
    weightHg,
    weightKind: weightUnknown ? 'unknown-placeholder' : 'listed',
    inclusion: r.inclusion,
    chainId: Number(sp.evolution_chain_id),
  });
}

// ----------------------------------------------------------------------------- inventory invariants
check(records.length === spec.records.length, `resolved ${records.length} of ${spec.records.length} records`);
const dupe = (list) => list.filter((v, i) => list.indexOf(v) !== i);
check(!dupe(records.map((r) => r.id)).length, `duplicate pokemon slug: ${dupe(records.map((r) => r.id))}`);
check(!dupe(records.map((r) => r.pokemonId)).length, `duplicate pokemon id: ${dupe(records.map((r) => r.pokemonId))}`);
check(!dupe(records.map((r) => r.form.id)).length, `duplicate form id: ${dupe(records.map((r) => r.form.id))}`);
const speciesSlugs = [...new Set(records.map((r) => r.species))].sort();
for (const s of speciesSlugs) {
  const defaults = records.filter((r) => r.species === s && r.form.status === 'species-default');
  check(defaults.length === 1, `${s}: ${defaults.length} species-default records`);
}

// ----------------------------------------------------------------------------- families
// Every species' complete chain, walked from the root through `evolves_from_species_id`, so all
// branches are kept (Tyrogue's three, Applin's three, Nincada's Shedinja by-product). These are
// canonical relationships only: the game's paced evolvesTo / evolveLevel live in the pokedex and
// are never written from here.
const speciesInChain = group(src.pokemon_species, 'evolution_chain_id');
const families = [];
for (const chainId of [...new Set(records.map((r) => r.chainId))].sort((a, b) => a - b)) {
  const members = speciesInChain.get(String(chainId)) ?? [];
  if (!check(members.length, `chain ${chainId}: no species rows`)) continue;
  const roots = members.filter((m) => !m.evolves_from_species_id);
  check(roots.length === 1, `chain ${chainId}: ${roots.length} roots`);
  const outside = members.map((m) => m.identifier).filter((m) => !speciesSlugs.includes(m));
  check(!outside.length, `chain ${chainId}: members outside the catalogue: ${outside.join(', ')}`);
  const edges = [];
  const walk = (parent) => {
    for (const child of members.filter((m) => m.evolves_from_species_id === parent.id).sort((a, b) => Number(a.id) - Number(b.id))) {
      edges.push([parent.identifier, child.identifier]);
      walk(child);
    }
  };
  if (roots[0]) walk(roots[0]);
  check(edges.length === members.length - 1, `chain ${chainId}: ${edges.length} edges for ${members.length} species (unreachable member?)`);
  families.push({
    chainId,
    root: roots[0]?.identifier ?? members[0].identifier,
    species: members.map((m) => m.identifier).sort(),
    edges,
    singleton: edges.length === 0,
  });
}

// ----------------------------------------------------------------------------- form and region conditions
// The source's explicit form/region fields for edges inside these families, kept as scoped source
// references. Rows that differ only by version group are one condition with both groups listed.
const catalogueSpeciesIds = new Set(records.map((r) => String(r.speciesId)));
const conditions = [];
for (const e of src.pokemon_evolution) {
  if (!catalogueSpeciesIds.has(e.evolved_species_id)) continue;
  if (!e.region_id && !e.required_pokemon_form_id && !e.evolved_pokemon_form_id) continue;
  const child = species.get(e.evolved_species_id);
  const parent = child?.evolves_from_species_id ? species.get(child.evolves_from_species_id) : null;
  if (!check(parent, `evolution row ${e.id}: ${child?.identifier} has no parent species`)) continue;
  const formRef = (id) => (id ? { slug: formById.get(id)?.identifier ?? null, id: Number(id) } : null);
  const row = {
    chainId: Number(child.evolution_chain_id),
    parent: parent.identifier,
    child: child.identifier,
    requiredForm: formRef(e.required_pokemon_form_id),
    evolvedForm: formRef(e.evolved_pokemon_form_id),
    region: e.region_id ? regionName.get(e.region_id) ?? null : null,
    versionGroups: e.version_group_id ? [versionGroupName.get(e.version_group_id)].filter(Boolean) : [],
  };
  const same = conditions.find((c) => c.chainId === row.chainId && c.parent === row.parent && c.child === row.child
    && c.requiredForm?.id === row.requiredForm?.id && c.evolvedForm?.id === row.evolvedForm?.id && c.region === row.region);
  if (same) { for (const v of row.versionGroups) if (!same.versionGroups.includes(v)) same.versionGroups.push(v); continue; }
  conditions.push(row);
}
conditions.sort((a, b) => a.chainId - b.chainId || a.child.localeCompare(b.child) || (a.requiredForm?.id ?? 0) - (b.requiredForm?.id ?? 0) || (a.evolvedForm?.id ?? 0) - (b.evolvedForm?.id ?? 0));

// ----------------------------------------------------------------------------- write
if (fail.length) {
  console.error(`catalogue: ${fail.length} validation failure(s); nothing written`);
  for (const f of fail.slice(0, 40)) console.error('  ' + f);
  process.exit(1);
}
records.sort((a, b) => a.id.localeCompare(b.id));
const pack = {
  source: { repo: REPO, revision: REV, kind: 'published CSV snapshot', files: provenance },
  records,
  families,
  conditions,
  totals: {
    records: records.length,
    species: speciesSlugs.length,
    varieties: records.length - speciesSlugs.length,
    families: families.length,
    edges: families.reduce((n, f) => n + f.edges.length, 0),
    singletons: families.filter((f) => f.singleton).length,
    conditions: conditions.length,
  },
};
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'catalogue.json'), JSON.stringify(pack, null, 1));
const t = pack.totals;
console.log(`catalogue: ${t.records} records (${t.species} species + ${t.varieties} varieties), ${t.families} families, ${t.edges} edges, ${t.singletons} singletons, ${t.conditions} form/region conditions`);
console.log(`  source ${REPO}@${REV.slice(0, 8)} — ${provenance.length} CSV files (${provenance.map((p) => p.from).filter((v, i, a) => a.indexOf(v) === i).join(', ')})`);
