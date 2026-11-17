import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REGION_BIOMES, SPAWN_PRESETS, isWild, resolveSpawnTable, spawnableSpecies, validateSpawnConfig, type SpawnPoolDef } from '../src/rules/spawning';
import { SPECIES_OVERRIDES, traversalOf } from '../src/rules/profiles';
import { HAB } from '../src/rules/habitats';
import { SPECIES, SPECIES_BY_ID, type SpeciesDef } from '../src/rules/species';
import { STAGES } from '../src/rules/stages';
import { allMapSpawnPools } from '../src/world/maps';
import { createRun, step } from '../src/sim/run';
import type { InputFrame } from '../src/sim/types';

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
  assert.deepEqual(new Set(ids(all)), new Set(SPECIES.filter(isWild).map((s) => s.id)));
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

test('a Water type is eligible on a dry map; only an explicit restriction keeps a species off a tile', () => {
  // Poliwag prefers water but is eligible anywhere its pool lists it
  assert.ok(ids(resolveSpawnTable(3)).includes('poliwag'));
  const calm = (over: SpawnPoolDef) => createRun({ seed: 11, species: 'charmander', ruleOverrides: { spawning: { override: over }, director: { spawnBase: 30, spawnPerMin: 0, eliteEvery: 9999, swarmEvery: 9999 }, objectives: { enabled: false }, beats: { enabled: false } } as never });
  const count = (ctx: ReturnType<typeof createRun>, secs: number) => {
    const seen = new Map<string, number>();
    let skipped = 0;
    for (let i = 0; i < secs * 60; i++) for (const e of step(ctx, NONE)) {
      if (e.t === 'spawnSkipped') skipped++;
    }
    for (let i = 0; i < ctx.enemies.hi; i++) if (ctx.enemies.alive[i]) { const id = ctx.speciesIndex[ctx.enemies.species[i]].id; seen.set(id, (seen.get(id) ?? 0) + 1); }
    return { seen, skipped };
  };
  const a = count(calm({ only: ['poliwag'] }), 6);
  assert.ok((a.seen.get('poliwag') ?? 0) > 0, 'Poliwag spawns on the authored meadow, which has no water preference');
  assert.equal(a.skipped, 0);
});

test('a restricted species is never placed on a tile it may not use: the spawn is skipped and reported', () => {
  // a synthetic species whose profile is resolved for the first time here, so its restriction is the one cached
  const fake = { ...SPECIES_BY_ID.rattata, id: '__fussy', name: 'Fussy' } as SpeciesDef;
  SPECIES.push(fake); SPECIES_BY_ID.__fussy = fake;
  SPECIES_OVERRIDES.__fussy = { avoids: HAB.meadow | HAB.grass | HAB.water | HAB.rock | HAB.dry | HAB.forest };
  try {
    const ctx = createRun({ seed: 5, species: 'charmander', ruleOverrides: { worldgen: { mode: 'generated', locations: { meadow: '' } }, spawning: { override: { only: ['__fussy'] } }, director: { spawnBase: 30, spawnPerMin: 0, eliteEvery: 9999, swarmEvery: 9999 }, enemy: { speedBase: 0, speedPerSpe: 0 }, objectives: { enabled: false }, beats: { enabled: false } } as never });
    let skipped = 0, placed = 0;
    const seen = new Set<number>(), E = ctx.enemies;
    for (let i = 0; i < 5 * 60; i++) {
      for (const e of step(ctx, NONE)) if (e.t === 'spawnSkipped') skipped++;
      // judge each body where it appeared (separation pushes bodies about afterwards)
      for (let e = 0; e < E.hi; e++) if (E.alive[e] && !seen.has(e * 65536 + E.gen[e])) {
        seen.add(e * 65536 + E.gen[e]);
        placed++;
        assert.equal(ctx.world.habitatAt(E.x[e], E.z[e]) & SPECIES_OVERRIDES.__fussy.avoids!, 0, 'placed on an avoided tile');
      }
    }
    assert.ok(skipped > 0, 'the director reported the skipped spawns');
    void placed; // an untagged tile (habitat 0) satisfies `avoids`, so a placement there is legitimate
  } finally {
    SPECIES.pop(); delete SPECIES_BY_ID.__fussy; delete SPECIES_OVERRIDES.__fussy;
  }
});

test('seeded selection is deterministic for the same pool', () => {
  const run = () => {
    const ctx = createRun({ seed: 9, species: 'squirtle', ruleOverrides: { spawning: { override: { preset: 'all-wild' } }, objectives: { enabled: false } } as never });
    const out: string[] = [];
    for (let i = 0; i < 20 * 60; i++) step(ctx, NONE);
    for (let i = 0; i < ctx.enemies.hi; i++) if (ctx.enemies.alive[i]) out.push(ctx.speciesIndex[ctx.enemies.species[i]].id + '@' + ctx.enemies.x[i].toFixed(3));
    return out.join(',');
  };
  assert.equal(run(), run());
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
