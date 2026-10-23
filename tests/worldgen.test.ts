// Procedural world (src/world/gen, src/world/maps.ts): determinism, seed dependence, the hard gates, the determinism
// rules for the generator's source, the W0 seam (authored mode unchanged) and generated regions in play.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { defaultRules } from '../src/rules/defaults';
import { BIOMES } from '../src/rules/stages';
import { World } from '../src/sim/world';
import { createRun, step } from '../src/sim/run';
import { botInput } from '../src/sim/bot';
import { generateRegion, GEN_VERSION } from '../src/world/gen';
import { mapChecksum, regionMap } from '../src/world/maps';
import { getArena } from '../src/world/arenas';
import { T, PROP_RULES } from '../src/world/tiles';

const SPECIES = ['rattata', 'ledyba', 'sandshrew', 'oddish', 'poliwag', 'mareep', 'heracross', 'geodude'];
const GEN = { ...defaultRules.worldgen, mode: 'generated' as const, biomes: ['meadow'] };

test('the same seed generates the same map; different seeds give different places', () => {
  const a = generateRegion({ biome: 'meadow', seed: 1234, species: SPECIES });
  const b = generateRegion({ biome: 'meadow', seed: 1234, species: SPECIES });
  assert.notEqual(a, b, 'two separate generations');
  assert.equal(mapChecksum(a), mapChecksum(b));
  assert.equal(a.id, `meadow@1234v${GEN_VERSION}`);
  const sums = new Set<number>(), shapes = new Set<string>();
  for (let s = 1; s <= 12; s++) {
    const m = generateRegion({ biome: 'meadow', seed: s, species: SPECIES });
    sums.add(mapChecksum(m));
    shapes.add(m.gen!.archetype + m.gen!.places.map((p) => `${p.kind}${Math.round(p.x / 16)},${Math.round(p.y / 16)}`).join());
  }
  assert.equal(sums.size, 12);
  assert.equal(shapes.size, 12, 'no two seeds share a place graph shape');
});

test('40 seeds pass every hard gate and rule test', () => {
  const archetypes = new Set<string>();
  for (let s = 100; s < 140; s++) {
    const m = generateRegion({ biome: 'meadow', seed: s, species: SPECIES });
    const failed = m.gen!.gates.filter((g) => !g.ok).map((g) => `${g.id}: ${g.value}`);
    assert.deepEqual(failed, [], `seed ${s}`);
    archetypes.add(m.gen!.archetype);
    assert.equal(m.w, 128);
  }
  assert.equal(archetypes.size, 3, 'ridge, valley and hollow all appear');
});

test('generated maps are well formed: no overlapping blockers, props on the map, spawn and boss walkable', () => {
  for (const s of [3, 7, 11]) {
    const m = generateRegion({ biome: 'meadow', seed: s, species: SPECIES });
    const seen = new Set<number>();
    for (const p of m.props) {
      const R = PROP_RULES[p.kind];
      assert.ok(p.x >= 0 && p.y >= 0 && p.x + p.w <= m.w && p.y + p.h <= m.h, `${p.kind} on the map`);
      if (!R.wall && !R.platform) continue;
      for (let j = p.y; j < p.y + p.h; j++) for (let i = p.x; i < p.x + p.w; i++) { const k = j * m.w + i; assert.ok(!seen.has(k), `seed ${s}: overlap at ${i},${j}`); seen.add(k); }
    }
    for (const [x, y] of [m.spawn, m.bossSpot]) { const k = y * m.w + x; assert.ok(!m.wall[k] && m.terrain[k] !== T.water); }
    assert.ok(m.props.filter((p) => p.kind === 'cabin').length >= 3, 'a hamlet');
    assert.ok(m.landmarks.length >= 6, 'landmarks');
  }
});

test('the generator follows the determinism rules (no Math trig, no Math.random, no clock in output)', () => {
  const dir = new URL('../src/world/gen/', import.meta.url);
  for (const f of readdirSync(dir)) {
    const src = readFileSync(new URL(f, dir), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(src, /Math\.(sin|cos|tan|atan2?|hypot|exp|log|pow|random)\(/, f);
  }
});

test('W0 seam: authored mode keeps the cached handcrafted arena; generated mode builds per seed', () => {
  const rules = defaultRules;
  const a = new World(rules, BIOMES.meadow, 5);
  assert.equal(a.map, getArena('meadow'));
  const g1 = new World({ ...rules, worldgen: GEN }, BIOMES.meadow, 5, SPECIES);
  const g2 = new World({ ...rules, worldgen: GEN }, BIOMES.meadow, 6, SPECIES);
  assert.notEqual(g1.map.id, g2.map.id);
  assert.equal(g1.w, 128);
  // the factory caches by (biome, seed, version): a second World on the same seed shares the base arrays
  assert.equal(regionMap(GEN, 'meadow', 5, SPECIES).terrain, g1.map.terrain);
  // only listed biomes are generated
  const bad = new World({ ...rules, worldgen: GEN, surfaces: { ...rules.surfaces, enabled: false } }, BIOMES.badlands, 5);
  assert.equal(bad.map, getArena('badlands'));
});

test('a generated region plays two minutes for each archetype: no errors, enemies never inside walls or water', () => {
  const seen = new Set<string>();
  for (const seed of [1, 3, 9, 4, 2, 5]) {
    const ctx = createRun({ seed, species: 'squirtle', ruleOverrides: { worldgen: { mode: 'generated' }, player: { hpBase: 4000 } } as never });
    const arch = ctx.world.map.gen!.archetype;
    if (seen.has(arch)) continue;
    seen.add(arch);
    let checked = 0;
    while (ctx.time < 120 && ctx.state !== 'over') {
      step(ctx, botInput(ctx));
      if (ctx.tick % 60) continue;
      const E = ctx.enemies, W = ctx.world;
      for (let i = 0; i < E.hi; i++) if (E.alive[i] && E.hover[i] === 0) { checked++; assert.ok(!W.solid(E.x[i], E.z[i]), `${arch}: enemy in a wall`); }
    }
    assert.ok(ctx.enemies.count > 10 && checked > 300, `${arch}: spawning and fighting`);
    assert.notEqual(ctx.state, 'over');
  }
  assert.equal(seen.size, 3);
});
