import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REGION_BIOMES, SPAWN_PRESETS, isWild, resolveSpawnTable, spawnTableFor, spawnableSpecies, validateSpawnConfig, validateSpawnOverride, type SpawnPoolDef } from '../src/rules/spawning';
import { MODES, modeSpawnProblems } from '../src/mods';
import { defaultRules } from '../src/rules/defaults';
import { bodyOf } from '../src/rules/sizing';
import { SPECIES_OVERRIDES, traversalOf } from '../src/rules/profiles';
import { HAB } from '../src/rules/habitats';
import { SPECIES, SPECIES_BY_ID, type SpeciesDef } from '../src/rules/species';
import { STAGES } from '../src/rules/stages';
import { allMapSpawnPools } from '../src/world/maps';
import { createRun, step } from '../src/sim/run';
import type { InputFrame } from '../src/sim/types';
import { deepMerge } from '../src/core/util';
import type { Rules } from '../src/rules/defaults';

const merge = (over: object): Rules => deepMerge(defaultRules, over as never) as Rules;

const NONE: InputFrame = { mx: 0, mz: 0, jump: false, dash: false };
const ids = (t: { spawns: [string, number][] }) => t.spawns.map(([id]) => id);

test('the shipped spawn configuration is valid', () => {
  assert.deepEqual(validateSpawnConfig(allMapSpawnPools()), []);
  assert.equal(STAGES.length, REGION_BIOMES.length);
  assert.deepEqual(STAGES.map((s) => s.biome), [...REGION_BIOMES]);
});

test('validation names bad pools instead of accepting them', () => {
  const bad: Record<string, SpawnPoolDef> = {
    a: { preset: 'nope' },
    b: { include: ['missingno', ['rattata', 0]] },
    c: { boss: 'rattata', elites: ['sudowoodo'] },
    d: { exclude: SPECIES.map((s) => s.id) },
  };
  const out = validateSpawnConfig(bad).join('\n');
  assert.match(out, /map a: unknown preset 'nope'/);
  assert.match(out, /'missingno' is not a game species/);
  assert.match(out, /'rattata' has weight 0/);
  assert.match(out, /boss 'rattata' has no boss kit/);
  assert.match(out, /elite 'sudowoodo' is a boss/);
  // a boss named in the spawns (only / include / weights) is reported: it spawns only through `boss`
  const spawned = validateSpawnConfig({ e: { include: ['magcargo'] }, f: { only: ['onix', ['sudowoodo', 2]] }, g: { weights: { articuno: 3 } } }).join('\n');
  assert.match(spawned, /map e: 'magcargo' is a boss/);
  assert.match(spawned, /map f: 'sudowoodo' is a boss/);
  assert.match(spawned, /map g: 'articuno' is a boss/);
});

test('a boss never enters the spawns: an override or a ?pool-style only naming one ends up without it', () => {
  const boss = (id: string) => SPECIES_BY_ID[id].boss;
  // a mode's or mod's override that includes the boss, with a size filter that would otherwise select it by its class
  // (Magcargo's extent class is Small with rules.size.axis, Medium without)
  const override: SpawnPoolDef = { include: ['magcargo'], filter: { sizeClasses: ['small', 'medium'] } };
  // ?pool=magcargo,onix becomes { only: [...] } (src/main.ts poolOverride, which warns and leaves the boss out itself)
  const pool: SpawnPoolDef = { only: ['magcargo', 'onix'] };
  for (const size of [{ axis: false }, { axis: true }]) {
    for (const L of [override, pool]) {
      const ctx = createRun({ seed: 1, species: 'charmander', ruleOverrides: { size, spawning: { override: L } } as never });
      assert.ok(!ids(ctx.spawnTable).includes('magcargo'), `${JSON.stringify(L)} axis ${size.axis}: no boss in the spawns`);
      assert.ok(ids(ctx.spawnTable).length > 0);
      for (let s = 0; s < REGION_BIOMES.length; s++) assert.ok(!ids(spawnTableFor(ctx.rules, s, L)).some(boss), `region ${s}`);
    }
  }
  assert.deepEqual(ids(spawnTableFor(defaultRules, 0, pool)), ['onix']);
  // the boss slot itself is untouched
  assert.equal(spawnTableFor(defaultRules, 1, override).boss, 'magcargo');
  // the validator, run where a mode's or mod's override loads, reports both
  assert.match(validateSpawnOverride('mod m rules.spawning.override', override).join('\n'), /mod m rules.spawning.override: 'magcargo' is a boss/);
  assert.match(validateSpawnOverride('pool', pool).join('\n'), /'magcargo' is a boss/);
  // no shipped preset or map pool lists a boss among its spawns
  for (let s = 0; s < REGION_BIOMES.length; s++) assert.ok(!resolveSpawnTable(s).spawns.some(([id]) => boss(id)));
});

test('the shipped modes and their mods load spawn overrides without problems', () => {
  for (const m of MODES) assert.deepEqual(modeSpawnProblems(m), [], m.id);
  const bad = { id: 'x', name: 'x', description: '', rules: { spawning: { override: { include: ['magcargo'] } } }, mods: [{ id: 'y', name: 'y', rules: { spawning: { override: { only: ['sudowoodo', 'onix'] } } } }] };
  const out = modeSpawnProblems(bad as never).join('\n');
  assert.match(out, /mode x rules.spawning.override: 'magcargo' is a boss/);
  assert.match(out, /mod y rules.spawning.override: 'sudowoodo' is a boss/);
});

test('layers apply in order: preset, only, everyWild, include, weights, filter, exclude, elites/boss', () => {
  // a region preset composes: Sunpetal Meadow is the classic table plus its share of the 2026-11 wave
  const base = resolveSpawnTable(0);
  assert.deepEqual(base.spawns, [...SPAWN_PRESETS['meadow-classic'].include!, ...SPAWN_PRESETS.meadow.include!]);
  assert.equal(base.boss, 'sudowoodo');
  // the region presets themselves are a rule: the classic tables are one setting away
  assert.deepEqual(resolveSpawnTable(0, ['meadow-classic', 'badlands', 'frost', 'dusk']).spawns, SPAWN_PRESETS['meadow-classic'].include);
  // map: include (adds or re-weights), exclude, weights
  const m = resolveSpawnTable(0, undefined, { include: ['onix', ['rattata', 9]], exclude: ['ledyba'], weights: { mareep: 7, notThere: 3 } });
  assert.ok(ids(m).includes('onix') && !ids(m).includes('ledyba') && !ids(m).includes('notThere'));
  assert.equal(m.spawns.find(([id]) => id === 'rattata')![1], 9);
  assert.equal(m.spawns.find(([id]) => id === 'mareep')![1], 7);
  // a preset in a later layer starts over from it, but keeps the boss and elites when it names none
  const p = resolveSpawnTable(0, undefined, { preset: 'dusk' });
  assert.deepEqual(ids(p), ids(resolveSpawnTable(3)));
  assert.equal(p.boss, 'houndoom');
  const q = resolveSpawnTable(0, undefined, { preset: 'all-wild' });
  assert.equal(q.boss, 'sudowoodo', 'all-wild names no boss: the region keeps its own');
  // override precedence: the last layer wins
  const r = resolveSpawnTable(0, undefined, { only: ['zubat'] }, { only: ['gastly'] });
  assert.deepEqual(ids(r), ['gastly']);
  const s = resolveSpawnTable(0, undefined, { only: ['zubat'] }, undefined, { include: ['gastly'] });
  assert.deepEqual(ids(s), ['zubat', 'gastly']);
});

test('filters select by type, behaviour, size class and flight, never by map', () => {
  const water = resolveSpawnTable(0, undefined, { preset: 'all-wild', filter: { types: ['water'] } });
  assert.ok(ids(water).length > 0);
  for (const id of ids(water)) assert.ok(SPECIES_BY_ID[id].types?.includes('water'), id);
  const flyers = resolveSpawnTable(0, undefined, { preset: 'all-wild', filter: { fly: true } });
  assert.ok(ids(flyers).length > 0);
  for (const id of ids(flyers)) assert.ok(!traversalOf(SPECIES_BY_ID[id]).groundNav, id);
  const walkers = resolveSpawnTable(0, undefined, { preset: 'all-wild', filter: { fly: false } });
  for (const id of ids(walkers)) assert.ok(traversalOf(SPECIES_BY_ID[id]).groundNav, id);
  const small = resolveSpawnTable(0, undefined, { preset: 'all-wild', filter: { sizeClasses: ['tiny', 'small'] } });
  assert.ok(ids(small).includes('rattata') && !ids(small).includes('onix'));
  const chargers = resolveSpawnTable(0, undefined, { preset: 'all-wild', filter: { behaviours: ['charger'] } });
  for (const id of ids(chargers)) assert.equal(SPECIES_BY_ID[id].behaviour, 'charger');
});

test('all-wild makes every wild species eligible, so a new Pokémon needs no map edit', () => {
  const all = resolveSpawnTable(2, undefined, { preset: 'all-wild' });
  // ...except a legendary or mythical one (canon.special, rules.spawning.everyWildSkips): it appears only where named
  assert.deepEqual(new Set(ids(all)), new Set(SPECIES.filter((s) => isWild(s) && !s.canon?.special).map((s) => s.id)));
  const special = SPECIES.filter((s) => isWild(s) && s.canon?.special).map((s) => s.id);
  assert.equal(special.length, 24, 'the legendary and mythical wild species (the catalogue wave, and Mewtwo from the hero test lines)');
  assert.ok(ids(resolveSpawnTable(2, undefined, { preset: 'all-wild', include: ['lugia'] })).includes('lugia'), 'a pool that names one fields it');
  assert.deepEqual(new Set(ids(spawnTableFor(merge({ spawning: { everyWildSkips: [] } }), 2, { preset: 'all-wild' }))), new Set(SPECIES.filter(isWild).map((s) => s.id)), 'with no skips, every wild species');
  // the catalogue wave off (older replay layers) leaves every pool, even one naming its species
  const off = merge({ spawning: { waves: { catalogue: false } } });
  const offIds = ids(spawnTableFor(off, 2, { preset: 'all-wild', include: ['lugia'] }));
  assert.ok(offIds.length && offIds.every((id) => SPECIES_BY_ID[id].wave !== 'catalogue'), 'no catalogue-wave species with the wave off');
  assert.deepEqual([...spawnableSpecies([], off).spawns].filter((id) => SPECIES_BY_ID[id].wave === 'catalogue'), [], 'nor in the habitat profiles');
  // a species added to the roster (simulated) appears in all-wild with no other change
  const fake = { ...SPECIES_BY_ID.rattata, id: '__newmon', name: 'Newmon' } as SpeciesDef;
  SPECIES.push(fake); SPECIES_BY_ID.__newmon = fake;
  try {
    assert.ok(ids(resolveSpawnTable(1, undefined, { preset: 'all-wild' })).includes('__newmon'));
    assert.ok(spawnableSpecies().spawns.has('__newmon'), 'habitat profiles see it too');
  } finally {
    SPECIES.pop(); delete SPECIES_BY_ID.__newmon;
  }
});

test('a map pool layers over the region pool at stage start', async () => {
  const { LOCATIONS } = await import('../src/world/locations');
  const L = LOCATIONS['viridian-forest'];
  const saved = L.spawns;
  L.spawns = { only: [['zubat', 1]], exclude: ['heracross'] };
  try {
    const ctx = createRun({ seed: 3, species: 'charmander', ruleOverrides: { worldgen: { mode: 'generated', locations: { meadow: 'viridian-forest' } } } as never });
    assert.deepEqual(ids(ctx.spawnTable), ['zubat']);
    assert.deepEqual(ctx.spawnTable.elites, ['sandshrew'], 'heracross excluded from the elites too');
    assert.equal(ctx.spawnTable.boss, 'sudowoodo');
    // and a mode override still wins over the map
    const ctx2 = createRun({ seed: 3, species: 'charmander', ruleOverrides: { worldgen: { mode: 'generated', locations: { meadow: 'viridian-forest' } }, spawning: { override: { only: ['gastly'] } } } as never });
    assert.deepEqual(ids(ctx2.spawnTable), ['gastly']);
  } finally {
    L.spawns = saved;
  }
});

test('a size filter reads the run\'s rules.size, not the defaults (F1)', () => {
  // with rules.size.axis on (the default), Ekans' listed 2 m is a body length (0.5 x): Medium; with it off, Large
  const large = { preset: 'all-wild', filter: { sizeClasses: ['large'] } } as SpawnPoolDef;
  assert.equal(bodyOf(SPECIES_BY_ID.ekans).sizeClass, 'medium');
  assert.ok(!ids(spawnTableFor(defaultRules, 0, large)).includes('ekans'));
  const off = createRun({ seed: 1, species: 'charmander', ruleOverrides: { size: { axis: false }, spawning: { override: large } } as never });
  assert.equal(bodyOf(SPECIES_BY_ID.ekans, off.rules.size).sizeClass, 'large');
  assert.ok(ids(off.spawnTable).includes('ekans'), 'the run\'s pool keeps it');
  assert.ok(ids(spawnTableFor(off.rules, 0, large)).includes('ekans'));
});
