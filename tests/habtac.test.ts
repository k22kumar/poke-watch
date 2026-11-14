// What the tactical Hold evaluation found and fixed (docs/HABITAT_PLAYTEST.md; scripts/habtac.ts, habgeom.ts, habcam.ts):
//   1. the Raid party of a habitat Hold was relocated onto a 30 m ring ahead of the trainer by the 46 m despawn rule, because
//      team B's staging is 33-47 m from the point; it now walks B's approaches from the staging;
//   2. the vent warning was a few steam particles on a third of the vent tiles; it now also puts a hostile ring on every vent
//      tile for the whole warning.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRun, step } from '../src/sim/run';
import { startObjective } from '../src/sim/objectives';
import { spawnEnemy } from '../src/sim/enemies';
import { ROLE } from '../src/sim/pools';
import { NO_INPUT, type SimContext } from '../src/sim/types';

const mk = (map: string, seed: number): SimContext => createRun({ seed: 1, species: 'bulbasaur', ruleOverrides: { worldgen: { mode: 'generated', regionSeed: seed, locations: { meadow: map, dusk: map, badlands: map, frost: map } }, objectives: { firstAfter: 1e9, secondAfter: 1e9 }, director: { spawnBase: -99, eliteEvery: 1e9, swarmEvery: 1e9 } } as never });

/** stand the trainer on the pad's far side from team B's staging (the worst case for the despawn distance) and open the Hold */
function openHold(ctx: SimContext) {
  const W = ctx.world, H = W.hab!, P = ctx.player;
  const cx = H.contest.x - W.half, cz = H.contest.y - W.half, bx = H.stage.B[0] - W.half, bz = H.stage.B[1] - W.half;
  const L = Math.hypot(cx - bx, cz - bz), ux = (cx - bx) / L, uz = (cz - bz) / L;
  // the nearest standing place to 3.5 m behind the pad (inside the Hold radius), found by walking out from the pad
  let px = cx, pz = cz;
  for (let d = 3.5; d >= 0; d -= 0.25) { const x = cx + ux * d, z = cz + uz * d; if (W.walkable(x, z) && Math.abs(W.height(x, z) - H.contest.h) < 0.7) { px = x; pz = z; break; } }
  P.x = P.px = px; P.z = P.pz = pz; P.y = P.py = W.height(px, pz);
  startObjective(ctx, 'hold');
  return { distToB: Math.hypot(px - bx, pz - bz), bx, bz, cx, cz };
}

for (const [map, seed] of [['volcanic-ridge', 7], ['volcanic-ridge', 3], ['river-gorge', 25]] as const) {
  test(`${map} seed ${seed}: the Raid party starts at team B's staging even when the trainer is on the far side of the point, and walks to it`, () => {
    const ctx = mk(map, seed), E = ctx.enemies, P = ctx.player;
    const { distToB, bx, bz, cx, cz } = openHold(ctx);
    // the situation this guards: the party starts further from the trainer than the despawn distance (crater: always)
    if (map === 'volcanic-ridge') assert.ok(distToB > ctx.rules.enemy.despawnDistance, `precondition: team B's staging is ${distToB.toFixed(1)} m from the trainer, past ${ctx.rules.enemy.despawnDistance} m`);
    P.iframes = 1; step(ctx, NO_INPUT); // the Hold activates, the party spawns and gets its first update
    const raiders: number[] = [];
    for (let i = 0; i < E.hi; i++) if (E.alive[i] && E.roles[i] & ROLE.raider) raiders.push(i);
    assert.equal(raiders.length, 4, 'four Raiders');
    for (const i of raiders) assert.ok(Math.hypot(E.x[i] - bx, E.z[i] - bz) < 4, `Raider ${i} at ${E.x[i].toFixed(1)},${E.z[i].toFixed(1)} is ${Math.hypot(E.x[i] - bx, E.z[i] - bz).toFixed(1)} m from team B's staging, not relocated`);
    // they walk the flow field to the point: the nearest gets within the Hold radius inside 20 s (the trainer cannot be hurt and does not fight)
    let nearest = Infinity;
    for (let t = 0; t < 60 * 20 && nearest > ctx.rules.objectives.hold.radius; t++) {
      P.iframes = 1; P.hp = P.maxHp;
      step(ctx, NO_INPUT);
      for (const i of raiders) if (E.alive[i]) nearest = Math.min(nearest, Math.hypot(E.x[i] - cx, E.z[i] - cz));
    }
    assert.ok(nearest <= ctx.rules.objectives.hold.radius, `a Raider reached the point (nearest ${nearest.toFixed(1)} m)`);
  });
}

test('a Raider far from the trainer on a classic map is still relocated (the pin is for habitat Holds only)', () => {
  const ctx = createRun({ seed: 1, species: 'bulbasaur', ruleOverrides: { director: { spawnBase: -99 } } as never });
  const E = ctx.enemies, P = ctx.player;
  const i = spawnEnemy(ctx, 'rattata', Math.max(-ctx.world.bound, Math.min(ctx.world.bound, P.x + 56)), P.z, ROLE.raider);
  assert.ok(i >= 0);
  assert.ok(Math.hypot(E.x[i] - P.x, E.z[i] - P.z) > ctx.rules.enemy.despawnDistance, 'precondition: the Raider starts past the despawn distance');
  for (let t = 0; t < 5; t++) step(ctx, NO_INPUT);
  assert.ok(Math.hypot(E.x[i] - P.x, E.z[i] - P.z) < ctx.rules.enemy.despawnDistance, 'without an active habitat Hold the far Raider is brought back near the trainer');
});

// the vent warning: one hostile ring per vent tile, once per cycle, for the length of the warning
test('Cinder Crater: the vent warning puts a hostile ring on every vent tile at its first step, and nothing at any other time', () => {
  for (const seed of [7, 2, 9]) {
    const ctx = mk('volcanic-ridge', seed), W = ctx.world, H = W.hab!, V = ctx.rules.habitat.vent;
    assert.ok(H.hazard.length > 0, `seed ${seed} has a vent field`);
    const tiles = new Set(H.hazard.map((k) => `${(k % W.w) - W.half + 0.5},${((k / W.w) | 0) - W.half + 0.5}`));
    ctx.stageTime = 0; ctx.time = 0;
    const onsets: { step: number; n: number; ok: boolean }[] = [];
    for (let t = 0; t < ctx.rules.sim.hz * V.period * 2; t++) {
      const ev = step(ctx, NO_INPUT).filter((e) => e.t === 'telegraph' && e.hostile && e.r < 1);
      if (ev.length) onsets.push({ step: t + 1, n: ev.length, ok: ev.every((e) => e.t === 'telegraph' && e.life === V.warn && tiles.has(`${e.x},${e.z}`)) });
    }
    assert.equal(onsets.length, 2, `seed ${seed}: one cue in each of two cycles`);
    for (const o of onsets) { assert.equal(o.n, H.hazard.length, `seed ${seed}: one ring per vent tile`); assert.ok(o.ok, `seed ${seed}: each ring sits on a vent tile and lasts the warning`); }
    // the first step of the warning is stage time warnFrom = period - active - warn
    const warnAt = Math.round((V.period - V.active - V.warn) * ctx.rules.sim.hz);
    assert.equal(onsets[0].step, warnAt, `seed ${seed}: the cue goes out on the first step of the warning (stage time ${(V.period - V.active - V.warn).toFixed(1)} s)`);
  }
});

test('Cinder Crater: a seed without a vent branch sends no vent warning', () => {
  const ctx = mk('volcanic-ridge', 10);
  assert.equal(ctx.world.hab!.hazard.length, 0);
  let n = 0;
  for (let t = 0; t < ctx.rules.sim.hz * 12; t++) n += step(ctx, NO_INPUT).filter((e) => e.t === 'telegraph').length;
  assert.equal(n, 0);
});

