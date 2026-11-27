// I1c, the 3D stack (docs/OVERHAUL_3D.md "Actors (I1c)"; owner's Q1–Q5 of 2026-11-27): with both flags on, ground
// enemies walk their width group's navmesh, take drop links and fall under the sim's gravity, and stand at Rapier's
// height; the seam's heights, placement and probes answer from the navmesh and Rapier; enemy and planar shots stop on
// Rapier (F65); a broken breakable leaves no collider (WORLDGEN3D Q21.9). With one flag alone nothing of it is on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import './setup/physics';
import './setup/nav';
import { createRun, disposeRun, step } from '../src/sim/run';
import { worldOf, GROUND } from '../src/sim/worldquery';
import { NO_INPUT, type SimContext } from '../src/sim/types';
import { NONE } from '../src/nav/graph';
import { PK } from '../src/sim/pools';
import { RANGE } from '../src/mods';
import { forceOnProp, PS } from '../src/sim/props';
import { navWide } from '../src/rules/sizing';
import { actorStats, RAY_AUDIT } from '../src/sim/enemy3d';
import { shootHostile } from '../src/sim/enemies';
import { SCENARIOS, runScenario } from './fixtures/scenarios';
import { T } from '../src/world/tiles';

const gorge = { mode: 'generated', regionSeed: 1, locations: { meadow: 'river-gorge', dusk: 'river-gorge', badlands: 'river-gorge', frost: 'river-gorge' } };
const run = (physics: 'tiles' | 'rapier', nav: 'flow' | 'navmesh', range = false) =>
  createRun({ mode: RANGE, seed: 1, species: 'totodile', ruleOverrides: { ...(range ? {} : { worldgen: gorge }), physics: { engine: physics }, nav: { engine: nav } } as never });

test('the 3D stack is on only with both flags', () => {
  for (const [p, n, on] of [['tiles', 'navmesh', false], ['rapier', 'navmesh', true]] as const) {
    const ctx = run(p, n);
    try { step(ctx, NO_INPUT); assert.equal(ctx.nav!.full, on, `${p} + ${n}`); assert.equal(ctx.nav!.nav!.graphs.some((G) => G.drops.length > 0), on, `${p} + ${n}: drop links`); }
    finally { disposeRun(ctx); }
  }
});

test('gorge-hold-3d: raiders take drop links, land and rejoin; a walking enemy is always on its navmesh', () => {
  const s = SCENARIOS.find((x) => x.id === 'gorge-hold-3d')!;
  let C: SimContext | null = null, walking = 0, offPoly = 0;
  RAY_AUDIT.on = true; RAY_AUDIT.reused = 0; RAY_AUDIT.differ = 0; RAY_AUDIT.maxErr = 0;
  const pt = new Float64Array(3);
  const res = runScenario(s, (ctx) => {
    C = ctx;
    const E = ctx.enemies, B = ctx.nav;
    if (!B || !B.nav) return;
    for (let i = 0; i < E.hi; i++) {
      if (!E.alive[i] || E.hover[i] > 0 || E.mesh[i] !== 0 || E.heldT[i] > 0) continue;
      const r = E.foot[i] > 0 ? E.foot[i] : E.radius[i], g = B.groupOf(r, navWide(r, ctx.rules));
      walking++;
      if (B.nav.locate(g, E.x[i], E.y[i], E.z[i], 0, pt) === NONE) offPoly++;
    }
  });
  RAY_AUDIT.on = false;
  const S = actorStats(C!.nav!);
  // the ground-ray budget (owner, 2026-11-27): on a flat polygon over the same box the last ray's height is reused, and
  // it is exactly what a fresh ray gives
  assert.ok(S.reused > S.rays, `reused ${S.reused} against ${S.rays} rays`);
  assert.equal(RAY_AUDIT.differ, 0, `reused heights that a fresh ray contradicts (max ${RAY_AUDIT.maxErr} m)`);
  assert.ok(S.drops >= 3, `drops taken: ${S.drops}`);
  assert.ok(S.landed >= 3 && S.rejoined >= 3, `landed ${S.landed}, rejoined ${S.rejoined}`);
  assert.equal(S.putBacks, 0, 'no body needed putting back');
  assert.ok(walking > 1000, `walking enemy-ticks: ${walking}`);
  assert.equal(offPoly, 0, 'a walking enemy stands on a polygon of its group');
  assert.ok(res.coverage!.kills > 0, 'the raiders reach the point and are fought');
  // determinism: the same run again, the same hashes
  const again = runScenario(s);
  assert.deepEqual(again.checkpoints, res.checkpoints);
  assert.equal(again.end, res.end);
});

test('F75 on the 3D stack: a height on the range\'s stair ramps is Rapier\'s resting height on the ramp', () => {
  const ctx = run('rapier', 'navmesh', true);
  try {
    step(ctx, NO_INPUT);
    const W = worldOf(ctx), Tl = W.tiles, P = ctx.nav!.physFor(W), m = Tl.map;
    let ramps = 0, moved = 0;
    for (let k = 0; k < m.w * m.h; k++) {
      if (!m.stairs[k] || m.wall[k]) continue;
      for (const f of [0.25, 0.5, 0.75]) {
        const x = (k % m.w) - Tl.half + 0.5, z = ((k / m.w) | 0) - Tl.half + f, t = ctx.world.height(x, z);
        const h = W.surfaceAt(x, GROUND, z), s = P.bodySupportBelow(x, t + 0.6, z, 1.3);
        assert.equal(h, s, `ramp ${k} at ${f}`);
        if (Math.abs(h - t) > 1e-3) moved++;
        ramps++;
      }
    }
    assert.ok(ramps > 0, 'the range has stair ramps');
    void moved;
  } finally { disposeRun(ctx); }
});

test('the seam on the 3D stack: placement on the navmesh, probes on Rapier', () => {
  const ctx = run('rapier', 'navmesh');
  try {
    step(ctx, NO_INPUT);
    const W = worldOf(ctx), Tl = W.tiles, B = ctx.nav!, P = B.physFor(W), m = Tl.map;
    let walls = 0;
    void P;
    for (let k = 0; k < m.w * m.h; k++) {
      const x = (k % m.w) - Tl.half + 0.5, z = ((k / m.w) | 0) - Tl.half + 0.5;
      if (m.wall[k] && walls < 50) {
        assert.equal(W.walkableAt(x, GROUND, z), false, `wall ${k} is not walkable`);
        assert.equal(W.solidFor(x, ctx.world.height(x, z, 0) - 0.01 - 0.6, z, 0.6), true, `wall ${k} is solid`);
        walls++;
      }
    }
    assert.ok(walls > 0);
    // place: a point of the body's own group's navmesh, clear of the physics world
    const pt = new Float64Array(3);
    for (const [r, wide] of [[0.4, false], [0.66, true], [0.88, true]] as const) {
      for (let q = 0; q < 20; q++) {
        const x = -40 + q * 4, z = 10 - q * 2.5, [px, pz] = W.place(x, GROUND, z, r, wide, true, 1.2);
        const g = B.groupOf(r, wide);
        assert.notEqual(B.nav!.locate(g, px, W.surfaceAt(px, GROUND, pz), pz, 0, pt), NONE, `r ${r}: placed on its group's mesh`);
      }
    }
    assert.ok(B.placements > 0);
  } finally { disposeRun(ctx); }
});

test('F65: an enemy shot stops on Rapier at a wall, as on the tile World', () => {
  for (const nav of ['flow', 'navmesh'] as const) {
    const ctx = run(nav === 'navmesh' ? 'rapier' : 'tiles', nav);
    try {
      step(ctx, NO_INPUT);
      const W = worldOf(ctx), Tl = W.tiles, m = Tl.map, Pr = ctx.projectiles;
      // a wall tile with open ground west of it at the same height: a shot flown east from there
      let k = -1;
      for (let q = 2; q < m.w * m.h && k < 0; q++) {
        const i = q % m.w;
        if (i < 3 || !m.wall[q] || m.wall[q - 1] || m.wall[q - 2] || m.terrain[q - 1] === T.water || m.stairs[q - 1] || m.stairs[q - 2]) continue;
        if (Math.abs(m.elev[q - 1] - m.elev[q - 2]) > 0.01 || m.platform[q - 1] || m.platform[q - 2] || (m.over && (m.over[q - 1] || m.over[q]))) continue;
        k = q;
      }
      assert.ok(k >= 0, 'a wall with open ground before it');
      const wx = (k % m.w) - Tl.half, z = ((k / m.w) | 0) - Tl.half + 0.5;
      ctx.player.x = wx - 1.5 - 8; ctx.player.z = z; // well behind the shot, so it is aimed east and level
      shootHostile(ctx, wx - 1.5, z, 1, 0, 10, 1, 'blaze');
      let i = -1;
      for (let s = 0; s < Pr.hi; s++) if (Pr.alive[s] && Pr.kind[s] === PK.hostile) i = s;
      assert.ok(i >= 0);
      Pr.vy[i] = 0; Pr.y[i] = W.surfaceAt(wx - 1.5, GROUND, z) + 0.9;
      let maxX = -Infinity;
      for (let t = 0; t < 30 && Pr.alive[i]; t++) { step(ctx, NO_INPUT); if (Pr.alive[i]) maxX = Math.max(maxX, Pr.x[i]); }
      assert.equal(Pr.alive[i] ? 1 : 0, 0, `${nav}: the shot ended`);
      assert.ok(maxX < wx + 0.2, `${nav}: never inside the wall (${maxX} against ${wx})`);
    } finally { disposeRun(ctx); }
  }
});

test('WORLDGEN3D Q21.9: a broken tree leaves no collider on the 3D stack (its stump is still the tile World\'s platform)', () => {
  const ctx = run('rapier', 'navmesh');
  try {
    step(ctx, NO_INPUT);
    const W = worldOf(ctx), Tl = W.tiles, F = Tl.propField!, m = Tl.map;
    let stumpK = -1;
    for (let k = 0; k < m.w * m.h && stumpK < 0; k++) {
      const i = F.at[k];
      if (i < 0 || F.mat[i]?.breaksInto !== 'stump' || !(F.mat[i]!.integrity > 0)) continue;
      forceOnProp(ctx, k, 99, 999, 'quake');
      for (let q = 0; q < m.w * m.h; q++) if (F.at[q] === i && m.platform[q] > 0 && F.state[i] === PS.broken) { stumpK = q; break; }
    }
    assert.ok(stumpK >= 0, 'a tree broke into a stump');
    const x = (stumpK % m.w) - Tl.half + 0.5, z = ((stumpK / m.w) | 0) - Tl.half + 0.5;
    assert.ok(m.platform[stumpK] > 0.6, 'the tile World keeps the stump platform');
    const P = ctx.nav!.physFor(W);
    assert.equal(P.bodySupportBelow(x, m.elev[stumpK] + 2, z), m.elev[stumpK], 'Rapier has no stump: the ground is the support');
    assert.equal(W.surfaceAt(x, GROUND, z), m.elev[stumpK], 'the seam\'s height is the ground');
  } finally { disposeRun(ctx); }
});
