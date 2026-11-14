// The tidal habitat (Shoal Grotto, `tidal-cave`; docs/HABITATS.md "Tide"): the recipe launches through the regular map
// flow, replays validated seeds, and its lower hall opens and closes with the tide while both dry approaches stay viable.
// The live checks are scripts/habtide.ts (npx tsx scripts/habtide.ts 1 2 7 prints the same lines).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRun, step } from '../src/sim/run';
import { tideIn, tidePhase } from '../src/sim/hazards';
import { NO_INPUT } from '../src/sim/types';
import { generateHabitat, HABITATS } from '../src/world/habitat';
import { findMapSource, mapChecksum } from '../src/world/maps';
import { worldgenFromQuery } from '../src/world/replay';
import { BIOMES } from '../src/rules/stages';
import { T } from '../src/world/tiles';
import { mkTide, RECIPE, staticChecks, tideChecks } from '../scripts/habtide';

const SEEDS = [1, 2, 7];

test('the tidal cave launches through the regular map flow: ?loc=, loose names, the regions seam', () => {
  assert.equal(findMapSource('tidal-cave'), RECIPE);
  assert.equal(findMapSource('Shoal Grotto'), RECIPE);
  assert.equal(findMapSource('shoal'), RECIPE);
  assert.equal(findMapSource('tidal-cave/glimmer'), `${RECIPE}:glimmer`);
  const wg = worldgenFromQuery({ world: 'locations', loc: 'tidal-cave', mapseed: '7', biomes: Object.keys(BIOMES) }, () => {});
  const ctx = createRun({ seed: 3, species: 'cyndaquil', ruleOverrides: { worldgen: wg } as never });
  const H = ctx.world.hab!;
  assert.equal(H.recipe, RECIPE);
  assert.equal(H.seed, 7);
  assert.ok(ctx.world.tide && ctx.world.tide.tiles.length > 400, 'the run has its tide');
  assert.equal(ctx.world.map.id, `${RECIPE}@7h${H.version}`);
});

test('validated seeds replay: same layout and checksum twice, every gate on the first attempt, both water states', () => {
  for (const s of [...SEEDS, 3, 4, 5, 101, 102, 103, ...HABITATS[RECIPE].fallbackSeeds]) {
    const a = generateHabitat({ recipe: RECIPE, seed: s }), b = generateHabitat({ recipe: RECIPE, seed: s }), H = a.gen!.hab!;
    assert.equal(mapChecksum(a), mapChecksum(b), `seed ${s}: the same map twice`);
    assert.deepEqual(H.tide!.tiles, b.gen!.hab!.tide!.tiles, `seed ${s}: the same tidal floor`);
    assert.equal(H.attempts, 1, `seed ${s}: accepted on its first attempt (${H.rejections.map((r) => r.failed.join('+')).join('; ')})`);
    assert.deepEqual(H.gates.filter((g) => !g.ok).map((g) => `${g.id}: ${g.value}`), [], `seed ${s}`);
    for (const id of ['reach:base', 'reach:flooded', 'independent:base', 'independent:flooded', 'tide:dry', 'tide:exit', 'tide:shortcut', 'tide:swim']) assert.ok(H.gates.some((g) => g.id === id && g.ok), `seed ${s}: ${id}`);
  }
});

test('tide clock: whole sim steps, low → warning → high → low, and the rule data bends it (always low, always high)', () => {
  const ctx = mkTide(2), TR = ctx.rules.habitat.tide, hz = ctx.rules.sim.hz;
  const at = (s: number) => { ctx.stageTime = s; return [tidePhase(ctx), +tideIn(ctx).toFixed(3)]; };
  assert.deepEqual(at(0), ['low', TR.low + TR.warn]);
  assert.deepEqual(at(TR.low - 1 / hz), ['low', +(TR.warn + 1 / hz).toFixed(3)]);
  assert.deepEqual(at(TR.low), ['warn', TR.warn]);
  assert.deepEqual(at(TR.low + TR.warn), ['high', 0]);
  assert.deepEqual(at(TR.period - 1 / hz), ['high', 0]);
  assert.deepEqual(at(TR.period), ['low', TR.low + TR.warn]);
  const hi = mkTide(2, 'cyndaquil', { low: 0, warn: 0 }), lo = mkTide(2, 'cyndaquil', { low: 1e6 });
  for (let i = 0; i < 3 * 60; i++) { step(hi, NO_INPUT); step(lo, NO_INPUT); }
  assert.equal(hi.world.tideHigh, true);
  assert.equal(lo.world.tideHigh, false);
});

test('flooding is a per-run overlay: the cached map is untouched and a new run starts at low water', () => {
  const ctx = mkTide(1, 'cyndaquil', { low: 0, warn: 0 });
  step(ctx, NO_INPUT);
  const W = ctx.world, k = W.tide!.tiles.find((_, i) => W.tide!.terrain[i] !== T.water)!;
  assert.equal(W.map.terrain[k], T.water, 'flooded in this run');
  const base = generateHabitat({ recipe: RECIPE, seed: 1 });
  assert.notEqual(base.terrain[k], T.water, 'dry in the generated map');
  const again = mkTide(1);
  assert.notEqual(again.world.map.terrain[k], T.water, 'a fresh run starts dry');
  assert.equal(again.world.tideHigh, false);
});

test('the tide does nothing on other maps or with liquid hazards off', () => {
  const gorge = createRun({ seed: 1, species: 'cyndaquil', ruleOverrides: { worldgen: { mode: 'generated', regionSeed: 3, locations: { meadow: 'river-gorge' } } } as never });
  assert.equal(gorge.world.tide, null);
  const off = createRun({ seed: 1, species: 'cyndaquil', ruleOverrides: { worldgen: { mode: 'generated', regionSeed: 2, locations: { meadow: RECIPE } }, hazards: { enabled: false } } as never });
  assert.equal(off.world.tide, null, 'no tide without the liquid exposure rule (the hall stays dry)');
});

for (const s of SEEDS) {
  test(`tidal cave seed ${s}: the hall's access changes with the water, both dry approaches hold, actors caught by the flood get out`, () => {
    const checks = tideChecks(s);
    const bad = checks.filter((c) => !c.ok).map((c) => `${c.id}: ${c.detail}`);
    assert.deepEqual(bad, [], `seed ${s}`);
    assert.ok(checks.filter((c) => c.coverage === 'live').length >= 10);
  });
}

test('more seeds: the static route and gate checks', () => {
  for (const s of [3, 4, 5, 6, 8, 9, 10]) for (const c of staticChecks(s)) assert.ok(c.ok, `seed ${s} ${c.id}: ${c.detail}`);
});
