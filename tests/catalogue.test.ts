// Canonical reference catalogue: exact inventory, canonical families, and isolation from the game.
//
// The expected sets are the research report's appendices (docs/pokemon-integration-handoff.md,
// Appendices B and C). This file asserts the inventory by count and by identity, and asserts that
// catalogue records stay out of the sim's species universe — a leak would join `all-wild` spawn
// pools and the habitat navigation profiles, moving habitat layout acceptance and every replay hash.
import { bodyOf } from '../src/rules/sizing';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  CATALOGUE,
  CATALOGUE_BY_ID,
  CATALOGUE_BY_SPECIES,
  CATALOGUE_TOTALS,
  FAMILIES,
  FORM_CONDITIONS,
  catalogueRecord,
  childrenOfSpecies,
  defaultRecordOf,
  familyOfSpecies,
  formConditionsFor,
  heightMeters,
  parentOfSpecies,
  weightKilograms,
} from '../src/rules/catalogue';
import { CATALOGUE_SOURCE } from '../src/content/catalogue';
import { SPECIES, SPECIES_BY_ID, weightClass } from '../src/rules/species';
import { POKEDEX_MOVES, POKEDEX_SPECIES } from '../src/content/pokedex';
import { STAGES } from '../src/rules/stages';

const ROOT = path.join(import.meta.dirname, '..');
const authored = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/catalogue.json'), 'utf8'));

test('inventory: the exact expected totals, with no duplicate or missing identity', () => {
  assert.deepEqual({ ...CATALOGUE_TOTALS }, {
    records: 269, species: 210, varieties: 59, families: 108, edges: 102, singletons: 39, conditions: 28,
  });
  assert.equal(new Set(CATALOGUE.map((r) => r.id)).size, 269, 'distinct pokemon slugs');
  assert.equal(new Set(CATALOGUE.map((r) => r.pokemonId)).size, 269, 'distinct pokemon ids');
  assert.equal(new Set(CATALOGUE.map((r) => r.form.id)).size, 269, 'distinct form ids');
  assert.equal(new Set(FAMILIES.map((f) => f.chainId)).size, 108, 'distinct chain ids');
  // every record resolves by slug and by id, matching the authored pins both ways
  assert.equal(authored.records.length, 269);
  for (const want of authored.records) {
    const r = catalogueRecord(want.pokemon);
    assert.ok(r, `${want.pokemon} resolves`);
    assert.equal(r.pokemonId, want.pokemonId, `${want.pokemon} id`);
    assert.equal(r.species, want.species, `${want.pokemon} species`);
    assert.equal(r.speciesId, want.speciesId, `${want.pokemon} species id`);
    assert.equal(r.form.status, want.formStatus, `${want.pokemon} form status`);
    assert.equal(r.inclusion, want.inclusion, `${want.pokemon} inclusion`);
  }
  const ids = new Set(authored.records.map((r: { pokemon: string }) => r.pokemon));
  assert.deepEqual(CATALOGUE.map((r) => r.id).filter((id) => !ids.has(id)), [], 'no record outside the authored set');
});

test('inventory: one default record per species, and the 9 alternate default slugs', () => {
  assert.equal(Object.keys(CATALOGUE_BY_SPECIES).length, 210);
  for (const [species, records] of Object.entries(CATALOGUE_BY_SPECIES)) {
    const defaults = records.filter((r) => r.form.status === 'species-default');
    assert.equal(defaults.length, 1, `${species} has exactly one species-default record`);
    assert.equal(records[0], defaults[0], `${species} lists its default record first`);
  }
  // A species default whose slug is not the species slug cannot be resolved by name: PokéAPI has
  // no `pokemon/aegislash` or `pokemon/tatsugiri` resource at all.
  const alternates = Object.entries(CATALOGUE_BY_SPECIES)
    .map(([species]) => [species, defaultRecordOf(species)!.id] as const)
    .filter(([species, id]) => species !== id);
  assert.deepEqual(Object.fromEntries(alternates), {
    aegislash: 'aegislash-shield',
    dudunsparce: 'dudunsparce-two-segment',
    giratina: 'giratina-altered',
    minior: 'minior-red-meteor',
    morpeko: 'morpeko-full-belly',
    tatsugiri: 'tatsugiri-curly',
    toxtricity: 'toxtricity-amped',
    urshifu: 'urshifu-single-strike',
    wishiwashi: 'wishiwashi-solo',
  });
  // an alternate default slug, resolved end to end
  const tatsugiri = defaultRecordOf('tatsugiri')!;
  assert.equal(tatsugiri.id, 'tatsugiri-curly');
  assert.equal(tatsugiri.pokemonId, 978);
  assert.equal(tatsugiri.form.label, 'Curly Form');
  assert.deepEqual(tatsugiri.types, ['dragon', 'water']);
  assert.equal(catalogueRecord('tatsugiri'), null, 'the species slug is not a pokemon record');
});

test('typing is preserved in source slot order, 171 dual and 98 mono', () => {
  assert.equal(CATALOGUE.filter((r) => r.types.length === 2).length, 171);
  assert.equal(CATALOGUE.filter((r) => r.types.length === 1).length, 98);
  for (const r of CATALOGUE) assert.ok(r.types.length === 1 || r.types.length === 2, `${r.id} type count`);
  // slot order is display-visible: Galarian Weezing is poison then fairy, never sorted
  assert.deepEqual(catalogueRecord('weezing-galar')!.types, ['poison', 'fairy']);
  assert.deepEqual(catalogueRecord('zamazenta-crowned')!.types, ['fighting', 'steel']);
  assert.deepEqual(catalogueRecord('toedscool')!.types, ['ground', 'grass']);
});

test('form metadata: every status accounted for, with the source form row kept', () => {
  const byStatus: Record<string, number> = {};
  for (const r of CATALOGUE) byStatus[r.form.status] = (byStatus[r.form.status] ?? 0) + 1;
  assert.deepEqual(byStatus, {
    'species-default': 210, 'persistent-alternate': 24, temporary: 22, regional: 8, 'out-of-battle-build': 4, 'persistent-fusion': 1,
  });
  // a form row whose id differs from the pokemon id, and a blank label where the source has none
  assert.deepEqual(catalogueRecord('xerneas')!.form, { slug: 'xerneas-neutral', id: 10132, label: 'Neutral Mode', status: 'species-default' });
  assert.equal(catalogueRecord('tentacool')!.form.label, '');
  assert.deepEqual(catalogueRecord('calyrex-ice')!.form.status, 'persistent-fusion');
  // Koraidon's four ride builds: the source flags none of them default, so they are not the species default
  const builds = CATALOGUE.filter((r) => r.form.status === 'out-of-battle-build');
  assert.deepEqual(builds.map((r) => r.id).sort(), ['koraidon-gliding-build', 'koraidon-limited-build', 'koraidon-sprinting-build', 'koraidon-swimming-build']);
  assert.equal(defaultRecordOf('koraidon')!.id, 'koraidon');
});

test('raw measurements keep their units and qualifiers; no placeholder is read as a value', () => {
  assert.equal(CATALOGUE.filter((r) => r.heightKind === 'lower-bound').length, 15);
  assert.equal(CATALOGUE.filter((r) => r.weightKind === 'unknown-placeholder').length, 16);
  // raw units are decimetres and hectograms
  const wailord = catalogueRecord('wailord')!;
  assert.equal(wailord.heightDm, 145);
  assert.equal(wailord.weightHg, 3980);
  assert.deepEqual(heightMeters(wailord), { m: 14.5, lowerBound: false });
  assert.equal(weightKilograms(wailord), 398);
  // a Gigantamax listed height is a lower bound and its 10,000 hg mass is unknown
  const gmax = catalogueRecord('charizard-gmax')!;
  assert.equal(gmax.heightKind, 'lower-bound');
  assert.deepEqual(heightMeters(gmax), { m: 28, lowerBound: true });
  assert.equal(weightKilograms(gmax), null, 'unknown mass is never exposed as 1000 kg');
  for (const r of CATALOGUE.filter((x) => x.form.label === 'Gigantamax Form')) {
    assert.equal(r.heightKind, 'lower-bound', `${r.id} height is a lower bound`);
    assert.equal(r.weightKind, 'unknown-placeholder', `${r.id} mass is unknown`);
  }
  // Eternamax: a real listed height, an unknown mass stored as 0 hg
  const eternamax = catalogueRecord('eternatus-eternamax')!;
  assert.equal(eternamax.heightKind, 'listed');
  assert.deepEqual(heightMeters(eternamax), { m: 100, lowerBound: false });
  assert.equal(eternamax.weightHg, 0);
  assert.equal(weightKilograms(eternamax), null, 'unknown mass is never exposed as 0 kg');
  // every other record exposes a plain value
  for (const r of CATALOGUE) {
    if (r.weightKind === 'listed') assert.equal(weightKilograms(r), r.weightHg / 10, `${r.id} kg`);
    else assert.equal(weightKilograms(r), null, `${r.id} placeholder withheld`);
  }
});

test('families: every branch from the root, all 102 edges and 39 singletons', () => {
  const edges = FAMILIES.flatMap((f) => f.edges.map(([p, c]) => `${p}>${c}`));
  assert.equal(edges.length, 102);
  assert.equal(new Set(edges).size, 102, 'no duplicate edge');
  assert.equal(FAMILIES.filter((f) => f.singleton).length, 39);
  for (const f of FAMILIES) {
    assert.equal(f.edges.length, f.species.length - 1, `chain ${f.chainId}: one edge per non-root member`);
    assert.equal(f.singleton, f.edges.length === 0, `chain ${f.chainId}: singleton flag`);
    assert.equal(parentOfSpecies(f.root), null, `chain ${f.chainId}: the root has no parent`);
    for (const [p, c] of f.edges) {
      assert.ok(f.species.includes(p) && f.species.includes(c), `chain ${f.chainId}: ${p}>${c} inside the family`);
      assert.equal(familyOfSpecies(c)!.chainId, f.chainId, `${c} belongs to one family`);
    }
  }
  // family membership is exactly the catalogue's species set
  const members = new Set(FAMILIES.flatMap((f) => f.species));
  assert.equal(members.size, 210);
  assert.deepEqual([...members].filter((s) => !CATALOGUE_BY_SPECIES[s]), [], 'no family member outside the catalogue');
  // all six branching parents keep every child
  const branching = Object.fromEntries(
    [...new Set(FAMILIES.flatMap((f) => f.edges.map(([p]) => p)))]
      .map((p) => [p, childrenOfSpecies(p)] as const)
      .filter(([, kids]) => kids.length > 1)
      .map(([p, kids]) => [p, [...kids].sort()]),
  );
  assert.deepEqual(branching, {
    applin: ['appletun', 'dipplin', 'flapple'],
    cosmoem: ['lunala', 'solgaleo'],
    nincada: ['ninjask', 'shedinja'],
    sneasel: ['sneasler', 'weavile'],
    snorunt: ['froslass', 'glalie'],
    tyrogue: ['hitmonchan', 'hitmonlee', 'hitmontop'],
  });
});

test('families: Tyrogue, the extended Applin branch, and Nincada → Shedinja', () => {
  const tyrogue = familyOfSpecies('tyrogue')!;
  assert.equal(tyrogue.chainId, 47);
  assert.equal(tyrogue.root, 'tyrogue');
  assert.deepEqual(tyrogue.edges, [['tyrogue', 'hitmonlee'], ['tyrogue', 'hitmonchan'], ['tyrogue', 'hitmontop']]);
  for (const kid of ['hitmonlee', 'hitmonchan', 'hitmontop']) {
    assert.equal(parentOfSpecies(kid), 'tyrogue');
    assert.deepEqual(childrenOfSpecies(kid), [], `${kid} is terminal`);
  }

  // Applin: two terminal branches plus a third that continues through Dipplin to Hydrapple
  const applin = familyOfSpecies('applin')!;
  assert.equal(applin.chainId, 442);
  assert.deepEqual(applin.edges, [['applin', 'flapple'], ['applin', 'appletun'], ['applin', 'dipplin'], ['dipplin', 'hydrapple']]);
  assert.deepEqual(childrenOfSpecies('dipplin'), ['hydrapple']);
  assert.equal(parentOfSpecies('hydrapple'), 'dipplin');
  assert.equal(familyOfSpecies('hydrapple')!.root, 'applin', 'the extended branch stays in Applin\'s family');

  // Nincada: Shedinja is a by-product of evolving into Ninjask, and both are kept as edges
  const nincada = familyOfSpecies('nincada')!;
  assert.equal(nincada.chainId, 144);
  assert.deepEqual(nincada.edges, [['nincada', 'ninjask'], ['nincada', 'shedinja']]);
  assert.equal(parentOfSpecies('shedinja'), 'nincada');
  assert.deepEqual(nincada.species, ['nincada', 'ninjask', 'shedinja']);
  assert.ok(catalogueRecord('shedinja'), 'shedinja is a catalogue record of its own');
});

test('form and regional restrictions are kept as scoped source references', () => {
  assert.equal(FORM_CONDITIONS.length, 28);
  for (const c of FORM_CONDITIONS) {
    assert.ok(c.requiredForm || c.evolvedForm || c.region, `${c.parent}>${c.child} has an explicit field`);
    const family = familyOfSpecies(c.child)!;
    assert.equal(family.chainId, c.chainId, `${c.child} condition sits on its own chain`);
    assert.ok(family.edges.some(([p, k]) => p === c.parent && k === c.child), `${c.parent}>${c.child} is a real edge`);
  }
  // a regional restriction: Galarian Weezing comes from Koffing in Galar
  const galar = formConditionsFor('koffing', 'weezing');
  assert.equal(galar.length, 1);
  assert.deepEqual(galar[0], {
    chainId: 49, parent: 'koffing', child: 'weezing',
    requiredForm: null, evolvedForm: { slug: 'weezing-galar', id: 10326 }, region: 'galar', versionGroups: ['sword-shield'],
  });
  assert.equal(catalogueRecord('weezing-galar')!.form.status, 'regional');
  // the source form on the second Sneasel edge: Sneasler comes from Hisuian Sneasel
  const hisui = formConditionsFor('sneasel', 'sneasler');
  assert.equal(hisui.length, 1);
  assert.deepEqual(hisui[0].requiredForm, { slug: 'sneasel-hisui', id: 10404 });
  assert.deepEqual(formConditionsFor('sneasel', 'weavile'), [], 'the Johtonian edge carries no form field');
  // regions named by the conditions are only ever source context
  assert.deepEqual([...new Set(FORM_CONDITIONS.map((c) => c.region).filter(Boolean))].sort(), ['alola', 'galar', 'hisui']);
});

test('isolation: catalogue records are not game species and move nothing in the sim', () => {
  // the active registry holds the roster's 72 species, the same ids, and no catalogue leak.
  // 38 predate the catalogue lane; Joltik and Onix and then the 2026-11 wave of 32 (docs/SPECIES.md) were added
  // deliberately through content/roster.json as wild encounters, so they are role records that coincide with catalogue
  // records, not a catalogue leak. A catalogue record still never becomes a species on its own.
  assert.equal(POKEDEX_SPECIES.length, 72);
  assert.equal(SPECIES.length, 72);
  assert.equal(SPECIES, POKEDEX_SPECIES);
  assert.deepEqual(STAGES.map((s) => s.biome), ['meadow', 'badlands', 'frost', 'dusk']);
  assert.equal(POKEDEX_MOVES.length, 263, 'the catalogue adds no move rows; every row is a role species\' level-up move');
  const roleIds = new Set(SPECIES.map((s) => s.id));
  const catalogueOnly = CATALOGUE.filter((r) => !roleIds.has(r.id));
  assert.equal(catalogueOnly.length, 228, '228 of the 269 records have no runtime role');
  for (const r of catalogueOnly) assert.equal(SPECIES_BY_ID[r.id], undefined, `${r.id} is not a game species`);
  // a catalogue record carries no gameplay field at all
  for (const r of CATALOGUE) {
    for (const key of ['playable', 'learnset', 'behaviour', 'boss', 'art', 'stats', 'elements', 'evolvesTo', 'evolveLevel', 'canon', 'scale', 'flying']) {
      assert.ok(!(key in r), `${r.id} must not carry ${key}`);
    }
  }
  // The active roster membership itself, pinned. The habitat navigation profiles (`profilesFor()`,
  // src/world/habitat/mode.ts) take the extremes of the bodies the spawn pools can field, so a change to
  // this set is what moves habitat layout acceptance and the replay hashes.
  assert.deepEqual(SPECIES.map((s) => s.id).sort(), [
    'articuno', 'bayleef', 'bergmite', 'blastoise', 'budew', 'bulbasaur', 'cetoddle', 'charizard', 'charmander', 'charmeleon',
    'chikorita', 'croconaw', 'cutiefly', 'cyndaquil', 'delibird', 'diglett', 'doduo', 'dreepy', 'ekans', 'feraligatr', 'furret',
    'gastly', 'gengar', 'geodude', 'hariyama', 'haunter', 'heracross', 'honedge', 'houndoom', 'houndour', 'impidimp', 'ivysaur',
    'joltik', 'koffing', 'lapras', 'ledyba', 'litwick', 'magcargo', 'makuhita', 'mareep', 'meganium', 'murkrow', 'noibat',
    'oddish', 'onix', 'paras', 'pichu', 'pikachu', 'poliwag', 'quilava', 'rattata', 'rolycoly', 'sandshrew', 'sentret',
    'silicobra', 'sizzlipede', 'slugma', 'sneasel', 'snom', 'snorlax', 'snorunt', 'squirtle', 'sudowoodo', 'swinub', 'togepi',
    'totodile', 'turtwig', 'typhlosion', 'venusaur', 'vulpix', 'wartortle', 'zubat',
  ]);
  const wild = SPECIES.filter((s) => !s.boss && !s.flying);
  const bosses = SPECIES.filter((s) => s.boss && !s.flying);
  assert.equal(wild.length + bosses.length + SPECIES.filter((s) => s.flying).length, 72);
  assert.equal(Math.max(...SPECIES.map((s) => s.height)), 4.5, 'the overall height extremes are unchanged');
  assert.equal(Math.min(...SPECIES.map((s) => s.height)), 0.9);
  // Sim bodies come from the size classes (rules/sizing.ts): the widest non-flying body is an Extra Large (Onix: its
  // 8.8 m listed length stands 4.4 m with the measurement axis, 0.9 m × its tilt; 0.972 with the size flags off).
  // Pinned so a later accidental change to the set is still caught.
  assert.equal(+Math.max(...wild.map((s) => bodyOf(s).radius)).toFixed(3), 0.93);
  assert.equal(SPECIES_BY_ID['onix'].height, 3.02);
  assert.equal(SPECIES_BY_ID['joltik'].height, 0.9);
  // a Gigantamax placeholder would read as "Massive" and Eternamax's 0 hg as "Weightless";
  // neither can reach weightClass, because neither is a species
  assert.equal(SPECIES_BY_ID['charizard-gmax'], undefined);
  assert.equal(SPECIES_BY_ID['eternatus-eternamax'], undefined);
  assert.equal(weightClass(SPECIES_BY_ID['charizard']), 3, 'the role record still answers for Charizard');
});

test('isolation: nothing in the sim, world, render, ui or audio imports the catalogue', () => {
  const offLimits = ['src/sim', 'src/world', 'src/render', 'src/ui', 'src/audio', 'src/input', 'src/assets'];
  const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  const offenders: string[] = [];
  for (const area of [...offLimits, 'src/main.ts', 'src/rules/species.ts']) {
    const full = path.join(ROOT, area);
    const files = fs.statSync(full).isDirectory() ? walk(full) : [full];
    for (const f of files.filter((x) => x.endsWith('.ts'))) {
      const text = fs.readFileSync(f, 'utf8');
      if (/from '[^']*(rules\/catalogue|content\/catalogue)'/.test(text)) offenders.push(path.relative(ROOT, f));
    }
  }
  assert.deepEqual(offenders, [], 'the catalogue stays out of the sim bundle and the species registry');
});

test('the 41 records with a game role agree with the catalogue and keep their role', () => {
  // 7 records already had a role when this lane landed; Joltik and Onix, then the 2026-11 wave of 32, were added to
  // the roster deliberately as wild encounters, so the overlap is 41.
  const overlap = [
    'charmander', 'charmeleon', 'charizard', 'rattata', 'gastly', 'slugma', 'magcargo', 'joltik', 'onix',
    'pichu', 'pikachu', 'togepi', 'sentret', 'furret', 'budew', 'cutiefly', 'turtwig', 'doduo', 'snorlax',
    'diglett', 'ekans', 'koffing', 'rolycoly', 'sizzlipede', 'silicobra', 'makuhita', 'hariyama',
    'snorunt', 'snom', 'sneasel', 'bergmite', 'cetoddle', 'lapras',
    'murkrow', 'litwick', 'haunter', 'gengar', 'impidimp', 'noibat', 'honedge', 'dreepy',
  ];
  assert.deepEqual(CATALOGUE.map((r) => r.id).filter((id) => SPECIES_BY_ID[id]).sort(), [...overlap].sort());
  for (const id of overlap) {
    const sp = SPECIES_BY_ID[id];
    const rec = catalogueRecord(id)!;
    assert.deepEqual(sp.types, rec.types, `${id} types agree in slot order`);
    assert.equal(sp.dex, rec.speciesId, `${id} dex number`);
    assert.equal(sp.canon!.heightM, heightMeters(rec).m, `${id} canonical height`);
    assert.equal(sp.canon!.weightKg, weightKilograms(rec), `${id} canonical weight`);
  }
  // gameplay values stay separate from canonical ones, as they already did
  assert.equal(SPECIES_BY_ID['gastly'].canon!.heightM, 1.3);
  assert.equal(SPECIES_BY_ID['gastly'].height, 1.97);
  // an existing starter line still paces itself through evolvesTo, not through canonical edges
  assert.equal(SPECIES_BY_ID['charmander'].evolvesTo, 'charmeleon');
  assert.equal(SPECIES_BY_ID['charmander'].evolveLevel, 16);
  assert.equal(SPECIES_BY_ID['charmeleon'].evolvesTo, 'charizard');
  assert.equal(SPECIES_BY_ID['charizard'].evolvesTo, undefined);
  const family = familyOfSpecies('charmander')!;
  assert.deepEqual(family.edges, [['charmander', 'charmeleon'], ['charmeleon', 'charizard']]);
  // the catalogue's own records never carry in-run pacing, and the 10 non-Charmander starter
  // edges in SPECIES are outside the catalogue's 102 and stay untouched
  const inRun = SPECIES.filter((s) => s.evolvesTo).map((s) => `${s.id}>${s.evolvesTo}`);
  assert.equal(inRun.length, 12, 'the six starter lines, unchanged');
  const canonical = new Set(FAMILIES.flatMap((f) => f.edges.map(([p, c]) => `${p}>${c}`)));
  assert.deepEqual(inRun.filter((e) => canonical.has(e)), ['charmander>charmeleon', 'charmeleon>charizard']);
});

test('provenance: the generated module records the pinned source revision', () => {
  assert.equal(CATALOGUE_SOURCE.repo, 'PokeAPI/pokeapi');
  assert.equal(CATALOGUE_SOURCE.revision, authored.source.revision);
  assert.match(CATALOGUE_SOURCE.revision, /^[0-9a-f]{40}$/);
  const report = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/report.json'), 'utf8'));
  assert.equal(report.catalogue.source.revision, CATALOGUE_SOURCE.revision);
  assert.deepEqual(report.catalogue.totals, { ...CATALOGUE_TOTALS });
  assert.equal(report.catalogue.source.files.length, authored.source.csv.length);
  for (const f of report.catalogue.source.files) assert.match(f.sha256, /^[0-9a-f]{64}$/, `${f.file} checksum`);
  assert.equal(report.species.length, 72, 'the role lane\'s provenance is preserved');
});

test('shape: every record and every runtime species carries its official shape from the pinned snapshot', () => {
  const SHAPES = new Set(['ball', 'squiggle', 'fish', 'arms', 'blob', 'upright', 'legs', 'quadruped', 'wings', 'tentacles', 'heads', 'humanoid', 'bug-wings', 'armor']);
  assert.ok(authored.source.csv.includes('pokemon_shapes'));
  for (const r of CATALOGUE) assert.ok(r.shape && SHAPES.has(r.shape), `${r.id}: shape ${r.shape}`);
  // a species and its catalogue default record agree (the role lane reads the same snapshot)
  for (const sp of SPECIES) {
    assert.ok(sp.canon?.shape && SHAPES.has(sp.canon.shape), `${sp.id}: shape ${sp.canon?.shape}`);
    const rec = CATALOGUE_BY_ID[sp.id];
    if (rec) assert.equal(rec.shape, sp.canon.shape, sp.id);
  }
  assert.equal(CATALOGUE_BY_ID.onix.shape, 'squiggle');
  assert.equal(CATALOGUE_BY_ID.eternatus?.shape ?? 'wings', 'wings');
});
