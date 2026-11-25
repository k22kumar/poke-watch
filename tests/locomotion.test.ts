// R6a shared locomotion foundation (docs/LOCOMOTION.md): the body step works on plain numbers (no Player, no ctx), the
// player's controller is one caller of it, and the integrator / medium rules are the ones the old controller had.
// Behaviour preservation itself is gated by scripts/checksum.ts (every line identical); these tests pin the seam.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { defaultRules } from '../src/rules/defaults';
import { traversalOf } from '../src/rules/profiles';
import { BIOMES } from '../src/rules/stages';
import { World } from '../src/sim/world';
import { T, WATER_Y } from '../src/world/tiles';
import { createRun } from '../src/sim/run';
import { playerSystem } from '../src/sim/player';
import { footing } from '../src/sim/cells';
import { playerLiquid } from '../src/sim/hazards';
import { navWide, partnerFootprint, partnerHeight } from '../src/rules/sizing';
import {
  LOCO, MEDIUM, mediumAt, selectIntegrator, stepBallistic, stepScripted, stepSupported,
  type LocoBody, type LocoIntent, type LocoResult, type LocoTick,
} from '../src/sim/locomotion';

const R = defaultRules.player, DT = 1 / 60;

/** an authored world whose map is replaced by a private flat plain at height 0 (arrays copied: the base map is shared) */
function flatWorld() {
  const W = new World(defaultRules, BIOMES.meadow, 5);
  const n = W.w * W.h, M = W.map;
  const map = { ...M, terrain: new Uint8Array(n), elev: new Float32Array(n), stairs: new Uint8Array(n), wall: new Uint8Array(n), platform: new Float32Array(n), over: undefined, wlevel: undefined };
  Object.assign(W, { map, over: undefined, voids: new Uint8Array(n) });
  return W;
}
const body = (y = 0, grounded = true): LocoBody => ({ x: 0, y, z: 0, vx: 0, vy: 0, vz: 0, kx: 0, kz: 0, grounded, ctl: { buffer: 0, coyote: 0, airSpent: false } });
const tick = (o: Partial<LocoTick> = {}): LocoTick => ({ speed: 7.2, stance: 1, footSpeed: 1, grip: 1, canJump: true, lift: false, airPress: 'none', stepUp: R.stepHeight, foot: 0.4, tall: undefined, wide: false, height: o.tall ?? defaultRules.size.classes.reduce((a, c) => (Math.abs(c.body - (o.foot ?? 0.4)) < Math.abs(a.body - (o.foot ?? 0.4)) ? c : a)).height, ...o });
const intent = (o: Partial<LocoIntent> = {}): LocoIntent => ({ mx: 0, mz: 0, jump: false, ...o });

/** one tick the way the player controller picks it (the dash aside) */
function stepAny(W: World, b: LocoBody, it: LocoIntent, t: LocoTick, out: LocoResult) {
  if (selectIntegrator(false, b.grounded) === LOCO.supported) stepSupported(W, b, it, t, R, DT, out);
  else stepBallistic(W, b, it, t, R, DT, out);
}

test('locomotion: the integrator follows from the body state (scripted wins, then support)', () => {
  assert.equal(selectIntegrator(false, true), LOCO.supported);
  assert.equal(selectIntegrator(false, false), LOCO.ballistic);
  assert.equal(selectIntegrator(true, true), LOCO.scripted);
  assert.equal(selectIntegrator(true, false), LOCO.scripted);
});

test('locomotion: a ballistic body falls under gravity and lands on the support (ballistic → supported)', () => {
  const W = flatWorld(), b = body(5, false), out = { jumped: false };
  stepAny(W, b, intent(), tick(), out);
  assert.equal(b.vy, -R.gravity * DT, 'one tick of gravity');
  let n = 1;
  while (!b.grounded && n < 600) { stepAny(W, b, intent(), tick(), out); n++; }
  assert.equal(b.grounded, true);
  assert.equal(b.y, 0);
  assert.equal(b.vy, 0);
  const tFall = Math.sqrt((2 * 5) / R.gravity);
  assert.ok(Math.abs(n * DT - tFall) <= 2 * DT, `lands after ${(n * DT).toFixed(3)} s (free fall ${tFall.toFixed(3)} s)`);
});

test('locomotion: a jump takes off from support only, reaches v²/2g and reports itself once', () => {
  const W = flatWorld(), b = body(), out = { jumped: false };
  stepAny(W, b, intent({ jump: true }), tick(), out);
  assert.equal(out.jumped, true);
  assert.equal(b.grounded, false, 'supported → ballistic on the press');
  let apex = b.y, jumps = 0;
  for (let s = 0; s < 120 && !b.grounded; s++) { stepAny(W, b, intent({ jump: true }), tick(), out); if (out.jumped) jumps++; apex = Math.max(apex, b.y); }
  assert.equal(jumps, 0, 'no second take-off in the air');
  const ideal = (R.jumpVelocity * R.jumpVelocity) / (2 * R.gravity);
  assert.ok(Math.abs(apex - ideal) < 0.1, `apex ${apex.toFixed(3)} m vs ${ideal.toFixed(3)} m`);
  const wet = body();
  stepAny(W, wet, intent({ jump: true }), tick({ canJump: false }), out);
  assert.equal(out.jumped, false, 'a liquid that forbids the jump keeps it supported');
  assert.equal(wet.grounded, true);
});

test('locomotion: the lift row holds the fall at glideFallSpeed while Jump is held, and only then', () => {
  const W = flatWorld(), out = { jumped: false };
  for (const [lift, jump, capped] of [[true, true, true], [true, false, false], [false, true, false]] as const) {
    const b = body(20, false);
    let fastest = 0;
    for (let s = 0; s < 90; s++) { stepAny(W, b, intent({ jump }), tick({ lift }), out); fastest = Math.min(fastest, b.vy); }
    if (capped) assert.equal(fastest, -R.glideFallSpeed, 'lift + held: clamped');
    else assert.ok(fastest < -R.glideFallSpeed * 4, `lift ${lift} jump ${jump}: free fall (${fastest.toFixed(2)} m/s)`);
  }
});

test('locomotion: supported drive reads grip and footing speed (and scales the wish in place); air control does not', () => {
  const W = flatWorld(), out = { jumped: false };
  const ice = body(), dry = body();
  const itIce = intent({ mx: 1 }), itDry = intent({ mx: 1 });
  stepSupported(W, ice, itIce, tick({ grip: 0.25, footSpeed: 0.5 }), R, DT, out);
  stepSupported(W, dry, itDry, tick(), R, DT, out);
  assert.equal(itIce.mx, 0.5, 'the footing speed scales the wish the body was driven by');
  assert.equal(dry.vx, 7.2 * Math.min(1, R.groundAccel * DT));
  assert.equal(ice.vx, 0.5 * 7.2 * Math.min(1, R.groundAccel * 0.25 * DT));
  const air = body(10, false), itAir = intent({ mx: 1 });
  stepBallistic(W, air, itAir, tick({ grip: 0.25, footSpeed: 0.5 }), R, DT, out);
  assert.equal(itAir.mx, 1);
  assert.equal(air.vx, 7.2 * Math.min(1, R.airAccel * DT));
});

test('locomotion: a scripted tick owns planar velocity; gravity and support still act under it', () => {
  const W = flatWorld(), out = { jumped: false };
  const b = body(3, false);
  stepScripted(W, b, intent({ mx: -1 }), 0, 1, R.dashSpeed, tick(), R, DT, out);
  assert.equal(b.vx, 0);
  assert.equal(b.vz, R.dashSpeed, 'the ability, not the wish');
  assert.ok(b.vy < 0 && !b.grounded, 'a dash off a ledge falls');
  const g = body();
  stepScripted(W, g, intent({ jump: true }), 1, 0, R.dashSpeed, tick(), R, DT, out);
  assert.equal(out.jumped, true, 'a grounded dash can jump');
});

test('locomotion: the medium is derived from the world (liquid, then support, then air)', () => {
  const W = flatWorld();
  const c = defaultRules.hazards.contact;
  assert.equal(mediumAt(W, body(), c), MEDIUM.support);
  assert.equal(mediumAt(W, body(4, false), c), MEDIUM.air);
  const k = W.tile(0, 0);
  W.map.terrain[k] = T.water;
  assert.equal(mediumAt(W, body(WATER_Y), c), MEDIUM.liquid);
  assert.equal(mediumAt(W, body(WATER_Y + c + 2, false), c), MEDIUM.air, 'above the surface');
});

test('locomotion: one body, two callers: the player controller and a plain body on the shared step move identically', () => {
  // the player half of T38: the same intent sequence through playerSystem and through the shared functions on a plain
  // copy of the body's numbers gives the same trajectory, bit for bit
  const ctx = createRun({ seed: 1, species: 'cyndaquil' });
  const P = ctx.player, W = ctx.world, out = { jumped: false };
  let compared = 0;
  for (let s = 0; s < 240; s++) {
    const inp = { mx: s < 120 ? 1 : -0.6, mz: s < 60 ? 0 : 0.8, jump: s % 50 < 12, dash: false };
    if (playerLiquid(ctx) || W.waterAt(P.x, P.z) > P.y + 0.3) break; // the plain copy below has no liquid rules
    const b: LocoBody = { x: P.x, y: P.y, z: P.z, vx: P.vx, vy: P.vy, vz: P.vz, kx: P.kx, kz: P.kz, grounded: P.grounded, ctl: { ...P.ctl } };
    const foot = partnerFootprint(P.species, ctx.rules);
    const t = tick({
      speed: P.derived.speed, foot, wide: navWide(foot, ctx.rules), stepUp: R.stepHeight,
      tall: W.over ? partnerHeight(P.species, ctx.rules) : undefined, lift: traversalOf(P.species, ctx.rules).glide !== null,
      height: partnerHeight(P.species, ctx.rules),
    });
    let mx = inp.mx, mz = inp.mz;
    const ml = Math.hypot(mx, mz);
    if (ml > 1) { mx /= ml; mz /= ml; }
    const it = intent({ mx, mz, jump: inp.jump });
    if (b.grounded) {
      [t.footSpeed, t.grip] = footing(ctx, b.x, b.z, P.species.elements);
      stepSupported(W, b, it, t, ctx.rules.player, ctx.dt, out);
    } else stepBallistic(W, b, it, t, ctx.rules.player, ctx.dt, out);
    ctx.input = inp;
    playerSystem.update(ctx, ctx.dt);
    for (const f of ['x', 'y', 'z', 'vx', 'vy', 'vz', 'kx', 'kz', 'grounded'] as const) assert.equal(b[f], P[f], `tick ${s}: ${f}`);
    assert.equal(P.loco.integrator, selectIntegrator(false, P.grounded));
    compared++;
  }
  assert.ok(compared > 200, `${compared} ticks compared`);
});

test('locomotion: the player controller holds no body physics of its own (T38 source gate, player half)', () => {
  const src = readFileSync(new URL('../src/sim/player.ts', import.meta.url), 'utf8');
  for (const word of ['.gravity', 'jumpVelocity', 'glideFallSpeed', 'moveBody', '.support(', 'headroomAt', 'P.vy', 'P.y =', 'dexp(']) {
    assert.ok(!src.includes(word), `player.ts must not contain "${word}": body physics lives in sim/locomotion.ts`);
  }
});
