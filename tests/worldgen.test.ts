// Procedural world (src/world/gen, src/world/maps.ts): determinism, seed dependence, the hard gates, the determinism
// rule for every sim and world source (with its allow-list), the W0 seam (authored mode unchanged) and generated regions in play.
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
import { crowd } from '../scripts/lib/crowd';

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

// The determinism rule (src/core/detmath.ts, CLAUDE.md): src/sim, src/world, src/core and src/rules (and src/mods, which
// adds sim systems) call detmath for the implementation-approximated maths, never Math.random, and read a clock only for
// timing metrics. These are the call sites left on 2026-11-21, per file: the count may shrink (lower or drop the entry)
// but not grow, and no other file may gain one. Moving one to detmath moves replay hashes or habitat layouts, so it is
// P2b (sim, rules) or P2c (habitat, with a HAB_VERSION bump) in docs/ROADMAP.md, not a drive-by edit.
// `**` with a non-literal exponent is a pow. `clock` is performance.now, Date.now or new Date.
const DETERMINISM_SCOPE = ['core', 'mods', 'rules', 'sim', 'world'];
const DETERMINISM_ALLOWED: Record<string, Record<string, number>> = {
  'rules/sizing.ts': { log: 2, '**': 1 },
  'sim/bot.ts': { hypot: 1 },
  'sim/moves.ts': { tan: 1 },
  'sim/spatial.ts': { hypot: 1 },
  'sim/targets.ts': { hypot: 1 },
  'sim/world.ts': { hypot: 1 },
  'world/gen/index.ts': { clock: 4 },
  'world/habitat/dress.ts': { atan2: 1, cos: 3, sin: 3, exp: 2 },
  'world/habitat/families.ts': { hypot: 9 },
  'world/habitat/graves.ts': { tan: 1, hypot: 1 },
  'world/habitat/index.ts': { hypot: 2, clock: 2 },
  'world/habitat/lagoon.ts': { hypot: 1 },
  'world/habitat/landforms.ts': { hypot: 17, atan2: 6, cos: 5, sin: 5 },
  'world/habitat/ruins.ts': { hypot: 2 },
  'world/habitat/sanctuary-checks.ts': { hypot: 4, atan2: 1 },
  'world/habitat/validate.ts': { hypot: 3, cos: 1, sin: 1 },
  'world/locgen/index.ts': { clock: 2 },
};

/** the determinism-rule call sites in one source file, comments stripped, counted by function */
function determinismSites(src: string): Record<string, number> {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const out: Record<string, number> = {};
  const add = (k: string) => { out[k] = (out[k] ?? 0) + 1; };
  for (const m of code.matchAll(/\bMath\.(sin|cos|tan|asin|acos|atan2?|sinh|cosh|tanh|asinh|acosh|atanh|hypot|exp|expm1|log|log1p|log2|log10|pow|cbrt|random)\b/g)) add(m[1]);
  for (const _ of code.matchAll(/\*\*(?!\s*\d+\b)/g)) add('**');
  for (const _ of code.matchAll(/\bperformance\.now\b|\bDate\.now\b|\bnew Date\b/g)) add('clock');
  return out;
}

test('the determinism rule: sim, world, core, rules and mods use detmath, no Math.random, clocks only for timing; the allow-list cannot grow', () => {
  const root = new URL('../src/', import.meta.url);
  const files = DETERMINISM_SCOPE.flatMap((d) => (readdirSync(new URL(d, root), { recursive: true }) as string[]).map((f) => `${d}/${f.replace(/\\/g, '/')}`)).filter((f) => f.endsWith('.ts')).sort();
  assert.ok(files.length > 100 && files.includes('sim/run.ts') && files.includes('world/habitat/landforms.ts'), 'the scan reaches the sim and world sources');
  const found: Record<string, Record<string, number>> = {};
  let total = 0;
  for (const f of files) {
    const s = determinismSites(readFileSync(new URL(f, root), 'utf8'));
    if (Object.keys(s).length) found[f] = s;
    total += Object.values(s).reduce((a, b) => a + b, 0);
  }
  for (const [f, s] of Object.entries(found)) {
    assert.ok(!s.random, `${f}: Math.random is never allowed (one Rng stream per system)`);
    for (const [k, n] of Object.entries(s)) {
      const allowed = DETERMINISM_ALLOWED[f]?.[k] ?? 0;
      assert.ok(n <= allowed, `${f}: ${n} × ${k}, allowed ${allowed}; use core/detmath (or, for a clock, keep it out of the output)`);
    }
  }
  // a site that went to detmath lowers its entry, so the list stays a ceiling of what is there
  for (const [f, s] of Object.entries(DETERMINISM_ALLOWED)) for (const [k, n] of Object.entries(s)) {
    assert.equal(found[f]?.[k] ?? 0, n, `${f}: ${k} is allowed ${n} but found ${found[f]?.[k] ?? 0}; lower the allow-list entry`);
  }
  assert.equal(total, 84, 'today: 76 maths call sites (75 Math.*, one non-literal **) and 8 timing clocks');
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
  const bad = new World({ ...rules, worldgen: GEN }, BIOMES.badlands, 5);
  assert.equal(bad.map, getArena('badlands'));
});

test('a generated region plays two minutes for each archetype: no errors, enemies never inside walls or water', () => {
  const seen = new Set<string>();
  for (const seed of [1, 3, 9, 4, 2, 5]) {
    const ctx = createRun({ seed, species: 'squirtle', mods: [crowd(60)], ruleOverrides: { worldgen: { mode: 'generated', locations: { meadow: '' } }, hero: { health: 4000 } } as never });
    const arch = ctx.world.map.gen!.archetype;
    if (seen.has(arch)) continue;
    seen.add(arch);
    let checked = 0;
    while (ctx.time < 120 && ctx.state !== 'over') {
      // the player is kept up: this checks the map and the crowd on it, not the survivor bot's odds (it has no cards
      // or build since docs/hero-shooter-pivot.md §8 step 9)
      ctx.player.hp = ctx.player.maxHp;
      step(ctx, botInput(ctx));
      if (ctx.tick % 60) continue;
      const E = ctx.enemies, W = ctx.world;
      for (let i = 0; i < E.hi; i++) if (E.alive[i] && E.hover[i] === 0) {
        checked++;
        assert.ok(!W.wallAt(E.x[i], E.z[i]), `${arch}: enemy in a wall`);
        // liquids are entered only when knocked in (sim/hazards.ts): then the exposure rule has it (or it can swim)
        if (W.liquidAt(E.x[i], E.z[i], E.y[i], ctx.rules.hazards.contact)) assert.ok(E.hzKind[i] !== 0 || ctx.speciesIndex[E.species[i]].elements.includes('tide'), `${arch}: enemy in water outside the exposure rule`);
      }
    }
    assert.ok(ctx.enemies.count > 10 && checked > 300, `${arch}: spawning and fighting`);
    assert.notEqual(ctx.state, 'over');
  }
  assert.equal(seen.size, 3);
});
