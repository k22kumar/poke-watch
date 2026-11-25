// R6c: the Jump control (sim/locomotion.ts jumpControl, docs/LOCOMOTION.md "Controls", §12.6 of the audit plan) at tick
// level. Edge-sending input (InputFrame.jumpPressed present) jumps on the press, buffered (rules.player.jumpBuffer) and
// with coyote time (rules.player.coyote), never repeats from a held Jump, and gives an airborne press the template's one
// meaning. Input without the field keeps the legacy held rule exactly. The vertical intent `my` and the look pitch move
// nothing in the states that exist before R6d.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultRules, type Rules } from '../src/rules/defaults';
import { BIOMES } from '../src/rules/stages';
import { validateTraversal, traversalOf } from '../src/rules/profiles';
import { SPECIES } from '../src/rules/species';
import { World } from '../src/sim/world';
import { createRun, step } from '../src/sim/run';
import { stateHash } from '../src/sim/checksum';
import { NO_INPUT, type InputFrame, type SimContext } from '../src/sim/types';
import { deepMerge, type DeepPartial } from '../src/core/util';
import { RANGE } from '../src/mods';
import {
  ACT, LOCO, jumpControl, selectIntegrator, stepBallistic, stepScripted, stepSupported,
  type LocoBody, type LocoIntent, type LocoResult, type LocoTick,
} from '../src/sim/locomotion';

const R = defaultRules.player, DT = 1 / 60;
const BUF = Math.round(R.jumpBuffer / DT), COY = Math.round(R.coyote / DT); // 7 and 6 ticks

/** a private flat plain at height 0; `ledge` raises every tile west of x = 0 to that height */
function flatWorld(ledge = 0) {
  const W = new World(defaultRules, BIOMES.meadow, 5);
  const n = W.w * W.h, M = W.map;
  const map = { ...M, terrain: new Uint8Array(n), elev: new Float32Array(n), stairs: new Uint8Array(n), wall: new Uint8Array(n), platform: new Float32Array(n), over: undefined, wlevel: undefined };
  Object.assign(W, { map, over: undefined, voids: new Uint8Array(n) });
  if (ledge) for (let k = 0; k < n; k++) if ((k % W.w) - W.half < 0) map.elev[k] = ledge;
  return W;
}
const body = (y = 0, grounded = true, x = 0): LocoBody => ({ x, y, z: 0, vx: 0, vy: 0, vz: 0, kx: 0, kz: 0, grounded, ctl: { buffer: 0, coyote: 0, airSpent: false } });
const tick = (o: Partial<LocoTick> = {}): LocoTick => ({ speed: 7.2, stance: 1, footSpeed: 1, grip: 1, canJump: true, lift: false, airPress: 'none', stepUp: R.stepHeight, foot: 0.4, tall: undefined, wide: false, height: o.tall ?? defaultRules.size.classes.reduce((a, c) => (Math.abs(c.body - (o.foot ?? 0.4)) < Math.abs(a.body - (o.foot ?? 0.4)) ? c : a)).height, ...o });
const edge = (pressed: boolean, o: Partial<LocoIntent> = {}): LocoIntent => ({ mx: 0, mz: 0, jump: pressed, jumpPressed: pressed, ...o });

/** one tick the way the player controller picks it (`scripted`: a Dash owns the planar velocity) */
function stepAny(W: World, b: LocoBody, it: LocoIntent, t: LocoTick, out: LocoResult, scripted = false) {
  const integ = selectIntegrator(scripted, b.grounded);
  if (integ === LOCO.scripted) stepScripted(W, b, it, 1, 0, R.dashSpeed, t, R, DT, out);
  else if (integ === LOCO.supported) stepSupported(W, b, it, t, R, DT, out);
  else stepBallistic(W, b, it, t, R, DT, out);
}

/** a calm run (no spawns) on its start position, settled */
function calm(species = 'cyndaquil', rules: DeepPartial<Rules> = {}): SimContext {
  const ctx = createRun({ mode: RANGE, seed: 1, species, ruleOverrides: deepMerge({  }, rules as never) as never });
  for (let i = 0; i < 30; i++) step(ctx, NO_INPUT);
  return ctx;
}
/** run the frames; the ticks a jump event came on */
function jumps(ctx: SimContext, frames: Partial<InputFrame>[]): number[] {
  const at: number[] = [];
  frames.forEach((f, t) => { for (const e of step(ctx, { ...NO_INPUT, ...f })) if (e.t === 'jump') at.push(t); });
  return at;
}
const hold = (n: number, f: (t: number) => Partial<InputFrame>) => Array.from({ length: n }, (_, t) => f(t));

// ------------------------------------------------------------------ legacy and edges on the real step

test('jump-hold (claim 8b): legacy input repeats a held jump on every landing; edge input jumps once per press', () => {
  const legacy = jumps(calm(), hold(300, () => ({ jump: true })));
  assert.equal(legacy.length, 8, `legacy: ${legacy.length} jumps in 300 held ticks (the ledger's 8)`);
  const edgeHeld = jumps(calm(), hold(300, (t) => ({ jump: true, jumpPressed: t === 0 })));
  assert.deepEqual(edgeHeld, [0], 'edge: one jump, on the press tick; holding never jumps again');
  const twoPresses = jumps(calm(), hold(300, (t) => ({ jump: t < 100 || t >= 150, jumpPressed: t === 0 || t === 150 })));
  assert.deepEqual(twoPresses, [0, 150], 'a release and a new press jumps again');
});

test('jump-tap (claim 8a): a press with Jump no longer held still jumps, on its own tick', () => {
  assert.deepEqual(jumps(calm(), hold(60, (t) => ({ jump: false, jumpPressed: t === 5 }))), [5]);
  // legacy input has no edge: a tap that never shows as held is lost (what jumpLatch fixes on the input side)
  assert.deepEqual(jumps(calm(), hold(60, () => ({ jump: false }))), []);
});

test('legacy input never writes the jump control state (so every checksum set hashes as before)', () => {
  const ctx = calm('charizard');
  for (let t = 0; t < 400; t++) step(ctx, { ...NO_INPUT, mx: Math.sin(t * 0.05), mz: Math.cos(t * 0.03), jump: t % 70 < 25, dash: t % 90 === 0 });
  assert.deepEqual(ctx.player.ctl, { buffer: 0, coyote: 0, airSpent: false });
});

test('edge input with no press moves the body exactly as legacy input with Jump released', () => {
  const a = calm(), b = calm();
  for (let t = 0; t < 300; t++) {
    const f = { ...NO_INPUT, mx: Math.sin(t * 0.04), mz: Math.cos(t * 0.02), dash: t % 120 === 7 };
    step(a, f); step(b, { ...f, jumpPressed: false });
    for (const k of ['x', 'y', 'z', 'vx', 'vy', 'vz', 'grounded', 'facing'] as const) assert.equal(b.player[k], a.player[k], `tick ${t} ${k}`);
  }
});

// ------------------------------------------------------------------ buffer and coyote (locomotion.ts, exact ticks)

test(`jump buffer: a press up to ${BUF} ticks before landing jumps on the first supported tick; earlier is dropped`, () => {
  assert.equal(BUF, 7); assert.equal(COY, 6);
  for (let k = 1; k <= BUF + 3; k++) {
    // a body falling from 3 m; find its landing tick, then press k ticks before it
    const W = flatWorld(), probe = body(3, false), out = { jumped: false };
    let land = 0;
    while (!probe.grounded) { stepAny(W, probe, edge(false), tick(), out); land++; }
    const b = body(3, false);
    let jumpedAt = -1;
    for (let s = 0; s < land + 20 && jumpedAt < 0; s++) {
      stepAny(W, b, edge(s === land - k), tick(), out);
      if (out.jumped) jumpedAt = s;
    }
    // the body lands at the end of tick land-1, so tick `land` is its first supported tick
    if (k <= BUF) assert.equal(jumpedAt, land, `press ${k} ticks before landing: jumps on landing (tick ${land}), got ${jumpedAt}`);
    else assert.equal(jumpedAt, -1, `press ${k} ticks before landing: outside the buffer, no jump`);
  }
});

test(`coyote time: a press up to ${COY} ticks after walking off a ledge is a ground jump; later is not`, () => {
  for (let k = 1; k <= COY + 3; k++) {
    const W = flatWorld(2), b = body(2, true, -1.5), out = { jumped: false };
    let left = -1, jumpedAt = -1;
    for (let s = 0; s < 60 && jumpedAt < 0; s++) {
      const wasGrounded = b.grounded;
      stepAny(W, b, edge(left >= 0 && s === left + k, { mx: 1 }), tick(), out);
      if (out.jumped) jumpedAt = s;
      if (wasGrounded && !b.grounded && left < 0 && !out.jumped) left = s; // the tick the support ended
    }
    assert.ok(left > 0, 'walked off the ledge');
    if (k <= COY) assert.equal(jumpedAt, left + k, `press ${k} ticks after leaving: coyote jump`);
    else assert.equal(jumpedAt, -1, `press ${k} ticks after leaving: too late`);
  }
});

test('a jump spends the coyote window: no second ground jump in the same airtime', () => {
  const W = flatWorld(), b = body(), out = { jumped: false };
  stepAny(W, b, edge(true), tick(), out);
  assert.equal(out.jumped, true);
  stepAny(W, b, edge(true), tick(), out);
  assert.equal(out.jumped, false, 'a press the tick after a jump is no coyote jump');
});

test('the buffer is a rule: jumpBuffer 0 and coyote 0 leave pure edges', () => {
  const L0 = { ...R, jumpBuffer: 0, coyote: 0 };
  const b = body(0.02, false), it = edge(true), t = tick();
  assert.equal(jumpControl(b, it, t, L0, DT, LOCO.ballistic), ACT.none);
  assert.equal(b.ctl.buffer, 0, 'nothing buffered');
  b.grounded = true;
  assert.equal(jumpControl(b, edge(false), t, L0, DT, LOCO.supported), ACT.none, 'a press one tick before landing is lost');
});

test('a press that cannot jump yet (exposed in a liquid) waits in the buffer and jumps when it can', () => {
  const b = body(), t = tick({ canJump: false });
  assert.equal(jumpControl(b, edge(true), t, R, DT, LOCO.supported), ACT.none);
  assert.equal(b.ctl.buffer, BUF);
  t.canJump = true;
  assert.equal(jumpControl(b, edge(false), t, R, DT, LOCO.supported), ACT.jump);
});

// ------------------------------------------------------------------ airborne press, take-off, scripted

test('airPress none (every shipped template): an airborne press does nothing in the air', () => {
  for (const sp of SPECIES) assert.equal(traversalOf(sp).airPress, 'none', sp.id);
  const b = body(5, false);
  assert.equal(jumpControl(b, edge(true), tick(), R, DT, LOCO.ballistic), ACT.none);
});

test('airPress doubleJump: once per airtime, only from a new press, never from holding; landing restores it', () => {
  const W = flatWorld(), b = body(), out = { jumped: false }, t = tick({ airPress: 'doubleJump' });
  const log: number[] = [];
  const press = new Set([0, 12, 20, 100]);
  let landed = -1;
  for (let s = 0; s < 200; s++) {
    stepAny(W, b, edge(press.has(s), { jump: s < 40 || press.has(s) }), t, out);
    if (out.jumped) log.push(s);
    if (s > 12 && b.grounded && landed < 0) landed = s;
  }
  // 0 ground jump; 12 double jump; 20 nothing (spent; held through 39 adds nothing); the body lands; 100 ground jump
  assert.ok(landed > 20 && landed < 100, `landed on tick ${landed}`);
  assert.deepEqual(log, [0, 12, 100]);
  // a new airtime has a fresh double jump
  const c = body(); stepAny(W, c, edge(true), t, out); stepAny(W, c, edge(false), t, out);
  assert.equal(jumpControl(c, edge(true), t, R, DT, LOCO.ballistic), ACT.airJump);
});

test('airPress takeoff (R6d): a new airborne press only; never the press that started the jump, never a hold, coyote first', () => {
  const t = tick({ airPress: 'takeoff' });
  const g = body();
  assert.equal(jumpControl(g, edge(true), t, R, DT, LOCO.supported), ACT.jump, 'on a support the press is a jump');
  g.grounded = false;
  assert.equal(jumpControl(g, edge(false, { jump: true }), t, R, DT, LOCO.ballistic), ACT.none, 'holding the jump press never takes off');
  assert.equal(jumpControl(g, edge(true), t, R, DT, LOCO.ballistic), ACT.takeoff, 'a second press takes off');
  // walked off a ledge: inside the coyote window the press is still a ground jump
  const w = body(); jumpControl(w, edge(false), t, R, DT, LOCO.supported); w.grounded = false;
  assert.equal(jumpControl(w, edge(true), t, R, DT, LOCO.ballistic), ACT.jump);
  // a buffered press never takes off: it waits for a support
  const f = body(5, false), none = tick();
  jumpControl(f, edge(true), none, R, DT, LOCO.ballistic);
  assert.equal(jumpControl(f, edge(false), t, R, DT, LOCO.ballistic), ACT.none);
});

test('scripted (Dash): a grounded dash still jumps (declared); an airborne dash ignores the air press, which waits for landing', () => {
  const t = tick({ airPress: 'doubleJump' });
  const g = body();
  assert.equal(jumpControl(g, edge(true), t, R, DT, LOCO.scripted), ACT.jump, 'grounded dash + press: the pre-R6c dash jump');
  const a = body(1, false);
  assert.equal(jumpControl(a, edge(true), t, R, DT, LOCO.scripted), ACT.none, 'airborne dash: no double jump');
  assert.equal(a.ctl.buffer, BUF, 'the press waits for a support');
  // on the real step: a dash, a jump press during it
  const ctx = calm();
  const at = jumps(ctx, hold(40, (s) => ({ dash: s === 0, jump: s === 3, jumpPressed: s === 3 })));
  assert.deepEqual(at, [3], 'jumps during the dash, as before');
});

test('validation: take-off needs a fly or levitate row; two airborne meanings on one species are rejected', () => {
  const T = defaultRules.locomotion.templates;
  const rules = (rows: Record<string, unknown>) => deepMerge(defaultRules, { locomotion: { templates: { ...T, ...rows } } } as never) as Rules;
  assert.deepEqual(validateTraversal(), [], 'shipped data is valid');
  const bad = rules({ glider: { kind: 'glide', airPress: 'takeoff' } });
  assert.ok(validateTraversal(bad).some((m) => m.includes('take-off needs a fly or levitate row')));
  assert.throws(() => traversalOf({ id: 'charizard', elements: ['fire'], flying: true }, bad), /take-off needs a fly or levitate row|takes off from a 'glide' row/);
  const two = rules({ glider: { kind: 'glide', airPress: 'doubleJump' }, 'fixed-hover': { ...T['fixed-hover'], airPress: 'takeoff' } });
  assert.throws(() => traversalOf({ id: 'charizard', elements: ['fire'], flying: true }, two));
  const odd = rules({ glider: { kind: 'glide', airPress: 'triple' } });
  assert.ok(validateTraversal(odd).some((m) => m.includes("unknown 'triple'")));
  const dj = rules({ glider: { kind: 'glide', airPress: 'doubleJump' } });
  assert.equal(traversalOf({ id: 'charizard', elements: ['fire'], flying: true }, dj).airPress, 'doubleJump');
});

test('a glider with a doubleJump row on the real step: press, flap once, glide while held', () => {
  const ctx = calm('charizard', { locomotion: { templates: { glider: { kind: 'glide', airPress: 'doubleJump' } } } } as never);
  const P = ctx.player;
  const at = jumps(ctx, hold(200, (s) => ({ jump: s < 150, jumpPressed: s === 0 || s === 20 || s === 30 })));
  assert.deepEqual(at, [0, 20], 'ground jump, one double jump; the third press is spent');
  assert.equal(P.grounded, true);
});

// ------------------------------------------------------------------ vertical intent and look independence

test('my (ascend − descend) moves nothing before R6d: supported, ballistic, scripted, gliding', () => {
  for (const species of ['cyndaquil', 'charizard']) {
    const a = calm(species), b = calm(species), c = calm(species);
    for (let t = 0; t < 360; t++) {
      const f: InputFrame = { ...NO_INPUT, mx: Math.sin(t * 0.05), mz: Math.cos(t * 0.03), jump: t % 80 < 40, jumpPressed: t % 80 === 0, dash: t % 100 === 50 };
      step(a, f); step(b, { ...f, my: 1 }); step(c, { ...f, my: t % 2 ? -1 : 0.37 });
      for (const k of ['x', 'y', 'z', 'vx', 'vy', 'vz', 'grounded'] as const) {
        assert.equal(b.player[k], a.player[k], `${species} tick ${t} ${k} (my 1)`);
        assert.equal(c.player[k], a.player[k], `${species} tick ${t} ${k} (my varying)`);
      }
    }
    assert.equal(stateHash(b), stateHash(a));
  }
});

test('look pitch never changes altitude (invariant 4): aim rays swept ±89° leave every height identical', () => {
  const base = calm('charizard'), swept = calm('charizard');
  for (let t = 0; t < 360; t++) {
    const f: InputFrame = { ...NO_INPUT, mx: 0.6, mz: 0.3, jump: t % 90 < 50, jumpPressed: t % 90 === 0 };
    const pitch = Math.sin(t * 0.07) * (89 * Math.PI / 180);
    const P = swept.player;
    const aim = { ox: P.x, oy: P.y + 3, oz: P.z - 4, dx: 0, dy: -Math.sin(pitch), dz: Math.cos(pitch) };
    step(base, f); step(swept, { ...f, aim, aimDev: 'mouse' });
    assert.equal(swept.player.y, base.player.y, `tick ${t}: y`);
    assert.equal(swept.player.vy, base.player.vy, `tick ${t}: vy`);
    assert.equal(swept.player.grounded, base.player.grounded, `tick ${t}: grounded`);
  }
});

test('deterministic: the same edge input gives the same state, hash and jump ticks', () => {
  const run = () => {
    const ctx = calm('charizard');
    const at: number[] = [];
    for (let t = 0; t < 500; t++) {
      const ev = step(ctx, { ...NO_INPUT, mx: Math.sin(t * 0.02), mz: 0.5, jump: t % 47 < 20, jumpPressed: t % 47 === 0 || t % 61 === 3, my: (t % 5) - 2 });
      if (ev.some((e) => e.t === 'jump')) at.push(t);
    }
    return { h: stateHash(ctx), at };
  };
  const a = run(), b = run();
  assert.equal(a.h, b.h);
  assert.deepEqual(a.at, b.at);
  assert.ok(a.at.length > 5);
});
