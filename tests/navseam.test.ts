// The navigation seam (task I3; sim/navseam.ts, docs/OVERHAUL_3D.md "Navigation (I3)"): rules.nav.engine = 'navmesh'
// answers navDir, navReached and navDist from src/nav, independently of rules.physics.engine (worldOf composes both
// swaps); the flagged replay scenario really steers by the navmesh; a run-time geometry change rebuilds only the tiles it
// touches; the F2 shore search on the navmesh is bounded; and the navigation hash matches the one recorded on the Mac.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import './setup/physics';
import './setup/nav';
import { createRun, disposeRun, step } from '../src/sim/run';
import { worldOf, GROUND } from '../src/sim/worldquery';
import { NavSeam } from '../src/sim/navseam';
import { PhysicsSeam, liveMap } from '../src/sim/physseam';
import { NO_INPUT } from '../src/sim/types';
import { NavWorld } from '../src/nav/world';
import { fromArenaMap } from '../src/world/adapter';
import { T } from '../src/world/tiles';
import { RayHit } from '../src/world/sight';
import { RANGE } from '../src/mods';
import { SCENARIOS, runScenario } from './fixtures/scenarios';
import { NAVHASH_MAPS, navHash } from '../scripts/navhash';
import type { SimContext } from '../src/sim/types';

const gorge = { mode: 'generated', regionSeed: 1, locations: { meadow: 'river-gorge', dusk: 'river-gorge', badlands: 'river-gorge', frost: 'river-gorge' } };
const run = (o: { physics?: 'tiles' | 'rapier'; nav?: 'flow' | 'navmesh'; worldgen?: object } = {}) =>
  createRun({ mode: RANGE, seed: 1, species: 'totodile', ruleOverrides: { worldgen: o.worldgen ?? gorge, physics: { engine: o.physics ?? 'tiles' }, nav: { engine: o.nav ?? 'flow' } } as never });

test('flag off: no bridge, the tile World answers navigation', () => {
  const ctx = run();
  try { assert.equal(ctx.nav, null); assert.equal(worldOf(ctx), ctx.world); } finally { disposeRun(ctx); }
});

test('the two flags are independent and compose: physics members from the physics seam, navigation from nav', () => {
  for (const physics of ['tiles', 'rapier'] as const) {
    const ctx = run({ physics, nav: 'navmesh' });
    try {
      const W = worldOf(ctx);
      assert.ok(W instanceof NavSeam, `${physics}: worldOf is the navigation seam`);
      assert.equal(W.tiles, ctx.world.tiles);
      const base = (W as unknown as { w: unknown }).w;
      assert.ok(physics === 'rapier' ? base === ctx.world && ctx.world.physics !== null && ctx.world.physics === ctx.physics && ctx.world.mover !== null : base === ctx.world && ctx.world.physics === null && ctx.world.mover === null, `${physics}: under it the tile World, ${physics === 'rapier' ? 'holding the physics bridge and its controller (F64)' : 'with no physics bridge'}`);
      // a ray goes to physics when physics is on
      W.raycast(0, 20, 0, 0, -1, 0, 40, 0xff, new RayHit());
      assert.equal(!!ctx.physics?.physics, physics === 'rapier');
      // navigation is answered by the navmesh
      const B = ctx.nav!, before = B.answers.dir1 + B.answers.dir0 + B.answers.dirHold;
      W.navDir('player', ctx.player.x + 10, GROUND, ctx.player.z + 10, [0, 0]);
      assert.equal(B.answers.dir1 + B.answers.dir0 + B.answers.dirHold, before + 1);
      assert.equal(B.builds, 1, 'one navmesh build at map entry');
    } finally { disposeRun(ctx); }
  }
  // physics alone: no navigation seam
  const ctx = run({ physics: 'rapier' });
  try { assert.ok(worldOf(ctx) === ctx.world && ctx.world.physics !== null && ctx.world.physics === ctx.physics && ctx.world.mover !== null, 'physics alone: worldOf is the tile World, holding the physics bridge and its controller (F64)'); } finally { disposeRun(ctx); }
});

test('gorge-hold-navmesh steers by the navmesh (its hashes alone cannot show it)', () => {
  const s = SCENARIOS.find((x) => x.id === 'gorge-hold-navmesh')!;
  assert.ok(s, 'the scenario exists');
  let ctx: SimContext | null = null;
  runScenario(s, (c) => { ctx = c; });
  const B = ctx!.nav!;
  assert.ok(B, 'the run carried the navigation bridge');
  const A = B.answers;
  assert.ok(A.dir1 > 500, `navDir answered with a direction ${A.dir1} times`);
  assert.ok(A.turned > 50, `${A.turned} of them turned more than 30° off the straight line (corridor corners)`);
  assert.ok(B.nav === null, 'disposeRun freed the navmeshes');
  assert.equal(B.builds, 1);
});

test('a run-time geometry change rebuilds only the navmesh tiles it touches, as a fresh build would make them', () => {
  const ctx = run({ nav: 'navmesh' });
  try {
    const W = worldOf(ctx), Tx = W.tiles, B = ctx.nav!, N0 = B.navFor(W);
    const total = N0.tiles.tw * N0.tiles.th;
    // a wall tile beside open ground near the middle is cleared (World.setBlock, as a prop burns or breaks: sim/props.ts)
    let k = -1;
    for (let j = Tx.h / 2 - 20; j < Tx.h / 2 + 20 && k < 0; j++) for (let i = Tx.w / 2 - 20; i < Tx.w / 2 + 20 && k < 0; i++) {
      const kk = j * Tx.w + i;
      if (Tx.map.wall[kk] === 1 && Tx.map.wall[kk + 1] === 0 && Tx.map.terrain[kk + 1] !== T.water) k = kk;
    }
    assert.ok(k >= 0);
    Tx.setBlock(k, 0, 0);
    W.navDir('player', 0, GROUND, 0, [0, 0]);
    assert.equal(B.updates, 1);
    assert.ok(B.tilesRebuilt > 0 && B.tilesRebuilt <= 4, `${B.tilesRebuilt} of ${total} tiles rebuilt`);
    const fresh = NavWorld.build(fromArenaMap(liveMap(Tx)), ctx.rules);
    try {
      for (let g = 0; g < fresh.graphs.length; g++) {
        const a = B.nav!.graphs[g], b = fresh.graphs[g];
        assert.equal(a.n, b.n, `${fresh.names[g]} polygons`);
        assert.deepEqual([...a.vx], [...b.vx]); assert.deepEqual([...a.vz], [...b.vz]); assert.deepEqual([...a.aTo], [...b.aTo]);
      }
    } finally { fresh.dispose(); }
  } finally { disposeRun(ctx); }
});

test('F2 on the navmesh: a swimmer\'s shore search reads at most 289 locate buckets and lands on reached ground', () => {
  const ctx = run({ nav: 'navmesh' });
  try {
    const W = worldOf(ctx), Tx = W.tiles, B = ctx.nav!;
    step(ctx, NO_INPUT);
    let found = 0, worst = 0;
    for (let k = 0; k < Tx.w * Tx.h; k += 7) {
      if (Tx.map.terrain[k] !== T.water) continue;
      const x = (k % Tx.w) - Tx.half + 0.5, z = ((k / Tx.w) | 0) - Tx.half + 0.5, y = Tx.map.wlevel ? Tx.map.wlevel[k] : 0;
      for (const [wide, diag] of [[false, false], [true, true], [true, false]] as const) {
        const s = B.shoreFor(W, x, y, z, wide, diag);
        const g = wide ? (diag ? 1 : 2) : 0, G = B.nav!.graphs[g];
        worst = Math.max(worst, G.visited);
        if (!s) continue;
        found++;
        const F = B.fieldOf(W, 'player', g)!, P = new Float64Array(3), p = G.locate(s[0], y, s[1], 0.05, P);
        assert.ok(p >= 0 && F.cost[p] < Infinity, 'on a polygon the player field reaches');
        assert.ok(Math.hypot(s[0] - x, s[1] - z) <= ctx.rules.nav.shoreReach + 1e-9);
      }
    }
    assert.ok(found > 10, `${found} shores found`);
    assert.ok(worst <= 289, `at most 289 buckets read (worst ${worst})`);
  } finally { disposeRun(ctx); }
});

test('the navigation hash of River Gorge seed 1 matches the one recorded on the Mac (tests/fixtures/navhash.json)', () => {
  const want = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, 'fixtures/navhash.json'), 'utf8')).hashes as Record<string, string>;
  const [id, seed] = NAVHASH_MAPS[1];
  assert.equal(navHash(id, seed).hash, want[`${id}@${seed}`]);
});
