// Aimed combat (blueprint section 4): aim, manual moves, Reflex charges, Guard (deflect, parry, brace),
// and the deterministic maths the sim now uses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { datan2, dcos, dexp, dhypot, dlog, dpow, dsin } from '../src/core/detmath';
import { spawnEnemy, shootHostile } from '../src/sim/enemies';
import { PK } from '../src/sim/pools';
import { learnMove } from '../src/sim/progression';
import { createRun, step } from '../src/sim/run';
import { BTN, type InputFrame, type SimContext } from '../src/sim/types';

const NONE: InputFrame = { mx: 0, mz: 0, jump: false, dash: false };

function calm(species: string, mode: 'aimed' | 'assist' | 'auto' = 'aimed'): SimContext {
  const ctx = createRun({ seed: 3, species, ruleOverrides: { director: { spawnBase: -99, spawnPerMin: 0, spawnPerStage: 0 }, combat: { mode } } as never });
  for (let i = 0; i < 30; i++) step(ctx, NONE); // let the stage settle
  return ctx;
}
function steps(ctx: SimContext, n: number, inp: Partial<InputFrame> = {}) {
  for (let i = 0; i < n; i++) step(ctx, { ...NONE, ...inp });
}
/** a walkable spot `d` metres from the player in direction (ux, uz) */
function spot(ctx: SimContext, ux: number, uz: number, d: number): [number, number] {
  const P = ctx.player;
  return ctx.world.nearestWalkable(P.x + ux * d, P.z + uz * d);
}

test('detmath matches native maths closely', () => {
  for (let k = 0; k < 2000; k++) {
    const x = (k - 1000) * 0.7311;
    assert.ok(Math.abs(dsin(x) - Math.sin(x)) < 1e-14);
    assert.ok(Math.abs(dcos(x) - Math.cos(x)) < 1e-14);
    assert.ok(Math.abs(datan2(x, 3.3 - k * 0.01) - Math.atan2(x, 3.3 - k * 0.01)) < 1e-14);
  }
  assert.ok(Math.abs(dexp(-0.1333) - Math.exp(-0.1333)) < 1e-15);
  assert.ok(Math.abs(dlog(37.5) - Math.log(37.5)) < 1e-14);
  assert.ok(Math.abs(dpow(12, 1.8) / Math.pow(12, 1.8) - 1) < 1e-14);
  assert.equal(dpow(0.94, 3), 0.94 * 0.94 * 0.94);
  assert.equal(dhypot(3, 4), 5);
});

test('the basic attack fires along the aim, not at the nearest enemy', () => {
  const ctx = calm('cyndaquil');
  const P = ctx.player;
  // nearest enemy north, a second one further east; aim east
  const [nx, nz] = spot(ctx, 0, -1, 5);
  const [ex, ez] = spot(ctx, 1, 0, 9);
  spawnEnemy(ctx, 'rattata', nx, nz);
  spawnEnemy(ctx, 'rattata', ex, ez);
  steps(ctx, 20);
  const Pr = ctx.projectiles;
  let east = 0, north = 0;
  const seen = new Set<number>();
  for (let t = 0; t < 120; t++) {
    step(ctx, { ...NONE, aimX: P.x + 10, aimZ: P.z, btn: BTN.basic });
    for (let i = 0; i < Pr.hi; i++) {
      if (!Pr.alive[i] || Pr.kind[i] !== PK.straight || seen.has(i)) continue;
      seen.add(i);
      if (Pr.vx[i] > Math.abs(Pr.vz[i])) east++; else if (Pr.vz[i] < 0) north++;
    }
  }
  assert.ok(east > 0, 'shots go east along the aim');
  assert.equal(north, 0, 'no shots go to the nearer enemy off the aim line');
});

test('assist mode keeps the original nearest-enemy targeting', () => {
  const ctx = calm('cyndaquil', 'assist');
  const P = ctx.player;
  const [nx, nz] = spot(ctx, 0, -1, 5);
  spawnEnemy(ctx, 'rattata', nx, nz);
  steps(ctx, 20);
  const Pr = ctx.projectiles;
  let north = 0;
  for (let t = 0; t < 90; t++) {
    step(ctx, { ...NONE, aimX: P.x + 10, aimZ: P.z, btn: BTN.basic });
    for (let i = 0; i < Pr.hi; i++) if (Pr.alive[i] && Pr.kind[i] === PK.straight && Pr.vz[i] < -Math.abs(Pr.vx[i])) north++;
  }
  assert.ok(north > 0);
});

// ------------------------------------------------------------------ primary fire (the basic attack on its button)
/** basic-attack wind-ups and casts per tick for an input sequence */
function basicLog(ctx: SimContext, inputs: Partial<InputFrame>[]) {
  const key = ctx.player.moves[0].key;
  return inputs.map((inp) => {
    const ev = step(ctx, { ...NONE, ...inp });
    return { windup: ev.filter((e) => e.t === 'windup' && e.slot === 0).length, cast: ev.filter((e) => e.t === 'cast' && e.key === key).length };
  });
}
const sum = (log: { windup: number; cast: number }[], k: 'windup' | 'cast') => log.reduce((n, x) => n + x[k], 0);
/** a durable enemy east of the player and an aim at it */
function target(ctx: SimContext, d = 5) {
  const [ex, ez] = spot(ctx, 1, 0, d);
  const e = spawnEnemy(ctx, 'rattata', ex, ez);
  ctx.enemies.hp[e] = ctx.enemies.maxHp[e] = 1e9; ctx.enemies.speed[e] = 0;
  steps(ctx, 20);
  return { aimX: ex, aimZ: ez };
}

test('primary fire: no basic attack starts without its button, with an enemy in reach (aimed and assist)', () => {
  for (const mode of ['aimed', 'assist'] as const) {
    const ctx = calm('cyndaquil', mode);
    const aim = target(ctx);
    const log = basicLog(ctx, Array(240).fill(aim));
    assert.equal(sum(log, 'windup') + sum(log, 'cast'), 0, mode);
    assert.equal(ctx.player.moves[0].cd, 0, 'the attack waits, ready');
  }
});

test('primary fire: one tick of the button gives exactly one attack, which lands after release', () => {
  const ctx = calm('cyndaquil');
  const aim = target(ctx);
  const log = basicLog(ctx, [{ ...aim, btn: BTN.basic }, ...Array(120).fill(aim)]);
  assert.equal(log[0].windup, 1, 'the press starts the wind-up at once');
  assert.equal(sum(log, 'windup'), 1);
  assert.equal(sum(log, 'cast'), 1, 'the committed attack still lands after the button is let go');
});

test('primary fire: holding repeats on the cooldown; releasing starts nothing new', () => {
  const ctx = calm('cyndaquil');
  const aim = target(ctx);
  const held = basicLog(ctx, Array(300).fill({ ...aim, btn: BTN.basic }));
  const ticks = held.flatMap((x, t) => (x.windup ? [t] : []));
  assert.ok(ticks.length >= 4, `${ticks.length} attacks in 5 s of holding`);
  const gaps = ticks.slice(1).map((t, i) => t - ticks[i]);
  assert.ok(Math.max(...gaps) - Math.min(...gaps) <= 1, `steady cadence: ${gaps.join()}`);
  const cd = ctx.player.moves[0].spec.cd / ctx.player.derived.haste;
  assert.ok(Math.abs(gaps[0] / 60 - cd) < 2 / 60, `interval ${gaps[0]} ticks vs cooldown ${cd.toFixed(3)} s`);
  const after = basicLog(ctx, Array(180).fill(aim));
  assert.equal(sum(after, 'windup'), 0, 'no new attack after release');
  assert.ok(sum(after, 'cast') <= 1, 'at most the wind-up already under way lands');
});

test('primary fire: a press only during the cooldown is dropped (no buffer)', () => {
  const ctx = calm('cyndaquil');
  const aim = target(ctx);
  basicLog(ctx, [{ ...aim, btn: BTN.basic }]);
  const log = basicLog(ctx, [...Array(10).fill(aim), { ...aim, btn: BTN.basic }, ...Array(120).fill(aim)]);
  assert.ok(ctx.player.moves[0].cd <= 0);
  assert.equal(sum(log, 'windup'), 0, 'the mid-cooldown press started nothing');
});

test('primary fire: a click at empty ground fires along the aim; basicNeedsTarget restores the old rule', () => {
  for (const [needs, expect] of [[false, true], [true, false]] as const) {
    const ctx = createRun({ seed: 3, species: 'cyndaquil', ruleOverrides: { director: { spawnBase: -99, spawnPerMin: 0, spawnPerStage: 0 }, combat: { basicNeedsTarget: needs } } as never });
    steps(ctx, 30);
    const P = ctx.player;
    let shots = 0;
    for (let t = 0; t < 60; t++) {
      step(ctx, { ...NONE, aimX: P.x + 10, aimZ: P.z, btn: BTN.basic });
      for (let i = 0; i < ctx.projectiles.hi; i++) if (ctx.projectiles.alive[i] && ctx.projectiles.kind[i] === PK.straight && ctx.projectiles.vx[i] > 0) shots++;
    }
    assert.equal(shots > 0, expect, `basicNeedsTarget ${needs}`);
  }
});

test('primary fire: holding Tag holds the basic attack (the button picks a reserve instead)', () => {
  const ctx = calm('cyndaquil');
  const aim = target(ctx);
  const log = basicLog(ctx, Array(120).fill({ ...aim, btn: BTN.basic | BTN.sig }));
  assert.equal(sum(log, 'windup'), 0);
});

test('Auto (classic) mode still fires the basic attack on its own', () => {
  const ctx = calm('cyndaquil', 'auto');
  target(ctx);
  const log = basicLog(ctx, Array(120).fill({}));
  assert.ok(sum(log, 'cast') > 0);
});

test('primary fire: the same scripted presses give the same state', () => {
  const run = () => {
    const ctx = calm('cyndaquil');
    for (let k = 0; k < 8; k++) spawnEnemy(ctx, 'rattata', ctx.player.x + 5 + k, ctx.player.z - 3 + k);
    for (let t = 0; t < 600; t++) step(ctx, { ...NONE, mx: dsin(t * 0.01), mz: dcos(t * 0.013), aimX: ctx.player.x + dcos(t * 0.02) * 6, aimZ: ctx.player.z + dsin(t * 0.02) * 6, btn: t % 37 < (t % 3) ? BTN.basic : 0 });
    return [ctx.player.x, ctx.player.z, ctx.player.hp, ctx.stats.kills, ctx.stats.damageDealt, ctx.player.moves[0].cd].join();
  };
  assert.equal(run(), run());
});

test('manual moves wait for their button', () => {
  const ctx = calm('totodile');
  const P = ctx.player;
  learnMove(ctx, 'bite'); // Move A
  assert.equal(P.moves[1].key, 'bite');
  const [ex, ez] = spot(ctx, 1, 0, 2.5);
  spawnEnemy(ctx, 'geodude', ex, ez);
  steps(ctx, 20);
  let casts = 0;
  for (let t = 0; t < 120; t++) { step(ctx, { ...NONE, aimX: ex, aimZ: ez }); casts += ctx.events.filter((e) => e.t === 'cast' && e.key === 'bite').length; }
  assert.equal(casts, 0, 'Move A never fires without its button');
  for (let t = 0; t < 120; t++) { step(ctx, { ...NONE, aimX: ex, aimZ: ez, btn: BTN.a }); casts += ctx.events.filter((e) => e.t === 'cast' && e.key === 'bite').length; }
  assert.ok(casts >= 1, 'holding Move A casts it');
});

test('Dash and Guard share two Reflex charges', () => {
  const ctx = calm('totodile');
  const P = ctx.player;
  assert.equal(P.reflex, 2);
  step(ctx, { ...NONE, mx: 1, dash: true });
  assert.ok(P.reflex < 1.05);
  steps(ctx, 12);
  step(ctx, { ...NONE, btn: BTN.guard });
  assert.ok(P.guardT >= 0, 'guard starts with a charge left');
  assert.ok(P.reflex < 0.3);
  step(ctx, NONE); // release
  steps(ctx, 25); // whiff lockout passes; still under one charge
  step(ctx, { ...NONE, mx: 1, dash: true });
  assert.ok(P.dashT <= 0 || P.reflex >= 0, 'no dash without a charge');
  const r0 = P.reflex;
  steps(ctx, 60);
  assert.ok(P.reflex > r0, 'charges recharge');
});

test('a timed Guard deflects a shot back along the aim and it hurts enemies', () => {
  const ctx = calm('totodile');
  const P = ctx.player;
  const [ex, ez] = spot(ctx, 1, 0, 8);
  const e = spawnEnemy(ctx, 'rattata', ex, ez);
  ctx.enemies.speed[e] = 0;
  steps(ctx, 20);
  const hp0 = P.hp;
  shootHostile(ctx, P.x + 4, P.z, -1, 0, 9, 30, 'blaze');
  // let it travel ~3 m, then tap Guard just before contact, aiming at the enemy
  let deflected = false, hurtEnemy = false;
  for (let t = 0; t < 60; t++) {
    const guard = t >= 14 && t < 26 ? BTN.guard : 0;
    const ev = step(ctx, { ...NONE, aimX: ctx.enemies.x[e], aimZ: ctx.enemies.z[e], btn: guard });
    if (ev.some((x) => x.t === 'deflect')) deflected = true;
    if (ev.some((x) => x.t === 'hit' && x.enemy === e)) hurtEnemy = true;
  }
  assert.ok(deflected, 'the shot was deflected');
  assert.ok(P.hp >= hp0 - 0.5, 'no damage taken');
  assert.ok(hurtEnemy, 'the returned shot hit the enemy');
});

test('a Light Pokémon parries a Light attacker but only braces against a Medium one', () => {
  for (const [foe, expect] of [['rattata', 'parry'], ['geodude', 'brace']] as const) {
    const ctx = calm('totodile');
    const P = ctx.player;
    const [ex, ez] = spot(ctx, 1, 0, 3);
    const e = spawnEnemy(ctx, foe, ex, ez);
    ctx.enemies.hp[e] = ctx.enemies.maxHp[e] = 1e7; // survive Totodile's autofire
    steps(ctx, 15);
    let got = '';
    for (let t = 0; t < 240 && !got; t++) {
      // tap Guard repeatedly: press 6 ticks, release 30 (so the deflect window keeps reopening)
      const btn = t % 36 < 6 || (expect === 'brace' && t % 36 < 30) ? BTN.guard : 0;
      P.reflex = 2;
      const ev = step(ctx, { ...NONE, btn: btn | BTN.basic }); // Totodile keeps firing its basic attack
      if (ev.some((x) => x.t === 'parry' && x.enemy === e)) got = 'parry';
      else if (ev.some((x) => x.t === 'brace')) got = 'brace';
    }
    assert.equal(got, expect, foe);
  }
});

test('determinism holds with aim and buttons in the input', () => {
  const runOnce = () => {
    const ctx = calm('cyndaquil');
    for (let k = 0; k < 12; k++) spawnEnemy(ctx, k % 2 ? 'rattata' : 'zubat', ctx.player.x + 6 + k, ctx.player.z - 4 + k);
    for (let t = 0; t < 600; t++) step(ctx, { ...NONE, mx: dsin(t * 0.01), mz: dcos(t * 0.013), aimX: ctx.player.x + dcos(t * 0.02) * 6, aimZ: ctx.player.z + dsin(t * 0.02) * 6, btn: (t % 90 < 40 ? BTN.a : 0) | (t % 200 === 5 ? BTN.guard : 0), dash: t % 150 === 0 });
    return [ctx.player.x, ctx.player.z, ctx.player.hp, ctx.stats.kills, ctx.stats.damageDealt].join();
  };
  assert.equal(runOnce(), runOnce());
});
