// Phase 3 (docs/THIRD_PERSON_IMPLEMENTATION.md §15): primary-fire input acceptance on the real sim (createRun + step).
// Press, accept, wind-up, release and cooldown are separate: a press (InputFrame.press) on a ready slot is accepted on
// that tick; a press within rules.combat.fireBuffer of ready is queued and casts exactly once on the ready tick, held or
// not; an earlier press is dropped with an event; holding repeats on the move's cooldown; releasing starts nothing new.
// Plus the input side (input/input.ts: edges between samples, pause and focus loss) and per-device aim assistance.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultRules, type Rules } from '../src/rules/defaults';
import { BIOMES } from '../src/rules/stages';
import { createRun, step } from '../src/sim/run';
import { spawnEnemy } from '../src/sim/enemies';
import { learnMove } from '../src/sim/progression';
import { compileMove, slotSpec } from '../src/sim/moves';
import { stateHash } from '../src/sim/checksum';
import { PK } from '../src/sim/pools';
import { World } from '../src/sim/world';
import { datan2 } from '../src/core/detmath';
import { BTN, NO_INPUT, type InputFrame, type SimContext, type SimEvent } from '../src/sim/types';
import type { DeepPartial } from '../src/core/util';

import { RANGE } from '../src/mods';
const WIN = Math.round(defaultRules.combat.fireBuffer[0] * 60); // the default window in ticks (9)

function calm(species: string, rules: DeepPartial<Rules> = {}): { ctx: SimContext; aim: Partial<InputFrame> } {
  const ctx = createRun({ mode: RANGE, seed: 3, species, ruleOverrides: { ...rules } as never });
  for (let i = 0; i < 30; i++) step(ctx, NO_INPUT);
  const P = ctx.player;
  const [ex, ez] = ctx.world.nearestWalkable(P.x + 5, P.z);
  const e = spawnEnemy(ctx, 'rattata', ex, ez);
  ctx.enemies.hp[e] = ctx.enemies.maxHp[e] = 1e9; ctx.enemies.speed[e] = 0;
  for (let i = 0; i < 20; i++) step(ctx, NO_INPUT);
  return { ctx, aim: { aimX: ex, aimZ: ez } };
}

interface Tick { accept: number; queuedAccept: number; cast: number; queued: number; dropped: string[]; events: SimEvent[] }
/** step once per input; per tick, slot `slot`'s accepts (wind-up start), casts, queues and drops */
function run(ctx: SimContext, inputs: Partial<InputFrame>[], slot = 0): Tick[] {
  const key = ctx.player.moves[slot].key;
  return inputs.map((inp) => {
    const ev = step(ctx, { ...NO_INPUT, ...inp });
    return {
      accept: ev.filter((e) => e.t === 'windup' && e.slot === slot).length,
      queuedAccept: ev.filter((e) => e.t === 'windup' && e.slot === slot && e.queued).length,
      cast: ev.filter((e) => e.t === 'cast' && e.key === key).length,
      queued: ev.filter((e) => e.t === 'fireQueued' && e.slot === slot).length,
      dropped: ev.flatMap((e) => (e.t === 'fireDropped' && e.slot === slot ? [e.why] : [])),
      events: ev.slice(),
    };
  });
}
const ticksOf = (log: Tick[], k: 'accept' | 'cast' | 'queued') => log.flatMap((x, t) => (x[k] ? [t] : []));
const total = (log: Tick[], k: 'accept' | 'cast' | 'queued') => log.reduce((n, x) => n + x[k], 0);
/** a one-tick tap (the button down for one sample, and its rising edge) */
const tap = (aim: Partial<InputFrame>, bit: number = BTN.basic): Partial<InputFrame> => ({ ...aim, btn: bit, press: bit });
/** the button held with no new edge */
const hold = (aim: Partial<InputFrame>, bit: number = BTN.basic): Partial<InputFrame> => ({ ...aim, btn: bit });
const idle = (aim: Partial<InputFrame>, n: number) => Array<Partial<InputFrame>>(n).fill(aim);
/** ticks from the accept to the release of a wind-up of w s: the sim subtracts 1/60 per tick until it is no longer
 *  positive, in floating point (0.1 s takes 7 ticks, not 6: six steps leave 1e-17) */
function windupTicks(w: number): number { let r = w, n = 0; while (r > 0) { r -= 1 / 60; n++; } return n; }

/** ticks from one accept to the next ready tick for this species' basic attack (the hold cadence, measured) */
function cadence(species: string, rules: DeepPartial<Rules> = {}): number {
  const { ctx, aim } = calm(species, rules);
  const a = ticksOf(run(ctx, [tap(aim), ...idle(hold(aim), 400)]), 'accept');
  return a[1] - a[0];
}
/** a fresh scene where the basic attack was accepted on tick 0 (a tap on a ready slot) and is `G` ticks from ready */
function fired(species: string, rules: DeepPartial<Rules> = {}) {
  const G = cadence(species, rules);
  const s = calm(species, rules);
  const first = run(s.ctx, [tap(s.aim)]);
  assert.equal(first[0].accept, 1, 'a tap on a ready slot is accepted on its own tick');
  return { ...s, G };
}

// ------------------------------------------------------------------ the press contract

test('single click when ready: accepted on the press tick, released after the wind-up, exactly one attack', () => {
  const { ctx, aim } = calm('cyndaquil');
  const w = defaultRules.feel.windup.bolt;
  const log = run(ctx, [tap(aim), ...idle(aim, 120)]);
  assert.deepEqual(ticksOf(log, 'accept'), [0]);
  assert.deepEqual(ticksOf(log, 'cast'), [windupTicks(w)], 'release on the tick the wind-up ends (5 ticks for 0.07 s)');
  assert.equal(total(log, 'queued'), 0, 'a press on a ready slot is never queued');
});

test('click shortly before the cooldown completes: one cast on the ready tick, even after release', () => {
  for (const k of [1, 2, 5, WIN]) {
    const { ctx, aim, G } = fired('cyndaquil');
    // tick 0 above was the accept; tick t here is tick t + 1 of the scene
    const at = G - 1 - k;
    const log = run(ctx, [...idle(aim, at), tap(aim), ...idle(aim, 150)]);
    assert.equal(log[at].queued, 1, `k=${k}: queued`);
    assert.deepEqual(ticksOf(log, 'accept'), [at + k], `k=${k}: accepted on the ready tick (${k} ticks after the press)`);
    assert.equal(log[at + k].queuedAccept, 1, 'the accept spent the queued press');
    assert.equal(ticksOf(log, 'cast').filter((t) => t >= at).length, 1, `k=${k}: exactly one cast from the press`);
  }
});

test('click outside the buffer window: dropped with an event, nothing casts', () => {
  for (const k of [WIN + 1, 20, 30]) {
    const { ctx, aim, G } = fired('cyndaquil');
    const at = G - 1 - k;
    const log = run(ctx, [...idle(aim, at), tap(aim), ...idle(aim, 150)]);
    assert.deepEqual(log[at].dropped, ['early'], `k=${k}`);
    assert.equal(total(log, 'accept') + total(log, 'queued'), 0, `k=${k}: nothing queued or started`);
  }
});

test('the window is a rule: fireBuffer 0 drops every press during the cooldown (the pre-Phase-3 rule)', () => {
  const R = { combat: { fireBuffer: [0, 0, 0, 0] } };
  const { ctx, aim, G } = fired('cyndaquil', R);
  const log = run(ctx, [...idle(aim, G - 2), tap(aim), ...idle(aim, 120)]);
  assert.deepEqual(log[G - 2].dropped, ['early'], 'one tick before ready, still dropped');
  assert.equal(total(log, 'accept'), 0);
  // a wider window queues from further out
  const W = { combat: { fireBuffer: [0.3, 0, 0, 0] } };
  const s = fired('cyndaquil', W);
  const l2 = run(s.ctx, [...idle(s.aim, s.G - 1 - 15), tap(s.aim), ...idle(s.aim, 120)]);
  assert.equal(total(l2, 'accept'), 1, 'fireBuffer 0.3: a press 15 ticks out queues');
});

test('a press without the edge field never queues (the bot and older replays keep the hold-only rule)', () => {
  const { ctx, aim, G } = fired('cyndaquil');
  const log = run(ctx, [...idle(aim, G - 3), hold(aim), ...idle(aim, 120)]);
  assert.equal(total(log, 'accept') + total(log, 'queued') + log.flatMap((x) => x.dropped).length, 0);
});

test('rapid repeated taps: exactly one queued press per ready, the hold cadence, never faster', () => {
  const G = cadence('cyndaquil');
  for (const per of [2, 4, 7, 12]) {
    const { ctx, aim } = calm('cyndaquil');
    const log = run(ctx, Array.from({ length: 600 }, (_, t) => (t % per === 0 ? tap(aim) : aim)));
    const acc = ticksOf(log, 'accept');
    const gaps = acc.slice(1).map((t, i) => t - acc[i]);
    assert.ok(Math.min(...gaps) >= G, `every ${per} ticks: no two accepts closer than the cadence (${Math.min(...gaps)} < ${G})`);
    if (per <= WIN) assert.ok(Math.max(...gaps) <= G, `every ${per} ticks: mashing keeps the hold cadence (${gaps.join()})`);
    const late = log.length - 1 - acc[acc.length - 1] < windupTicks(defaultRules.feel.windup.bolt) ? 1 : 0;
    assert.equal(total(log, 'cast'), acc.length - late, 'every accept releases once');
    // each accept is backed by a press since the previous one
    for (const t of acc) {
      const prev = acc.filter((a) => a < t).pop() ?? -1;
      assert.ok(log.slice(prev + 1, t + 1).some((_, j) => (prev + 1 + j) % per === 0), `accept at ${t} has a press behind it`);
    }
  }
});

test('continuous hold repeats on the move cadence; a press while holding adds no extra attack', () => {
  const G = cadence('cyndaquil');
  const { ctx, aim } = calm('cyndaquil');
  const log = run(ctx, [tap(aim), ...Array.from({ length: 599 }, (_, t) => (t % 5 === 0 ? tap(aim) : hold(aim)))]);
  const acc = ticksOf(log, 'accept');
  const gaps = acc.slice(1).map((t, i) => t - acc[i]);
  assert.ok(gaps.every((g) => g === G), `steady ${G}-tick cadence while held and tapped: ${gaps.join()}`);
  const spec = slotSpec(ctx, 0);
  assert.ok(Math.abs(G / 60 - spec.cd) <= 2 / 60, `cadence ${G} ticks vs cooldown ${(spec.cd * 60).toFixed(1)} ticks`);
});

test('release during the cooldown: no new attack; release during the wind-up: the committed attack still lands', () => {
  const { ctx, aim, G } = fired('cyndaquil');
  // held through the rest of this cooldown and let go 15 ticks before ready
  const l1 = run(ctx, [...idle(hold(aim), G - 16), ...idle(aim, 200)]);
  assert.equal(total(l1, 'accept'), 0, 'released during the cooldown: nothing new');
  assert.equal(total(l1, 'cast'), 1, 'only the first wind-up lands');
  const s = calm('cyndaquil');
  const l2 = run(s.ctx, [tap(s.aim), ...idle(s.aim, 200)]);
  assert.equal(total(l2, 'cast'), 1, 'released on the press tick, inside the wind-up: it lands once');
});

test('a press during the wind-up is early for a move whose cooldown outlasts the window', () => {
  const { ctx, aim } = calm('cyndaquil');
  const log = run(ctx, [tap(aim), aim, tap(aim), ...idle(aim, 120)]);
  assert.deepEqual(log[2].dropped, ['early']);
  assert.equal(total(log, 'accept'), 1);
});

// ------------------------------------------------------------------ interruption and cancellation

test('Tag held cancels a queued press; carrying the egg cancels Move A presses; paralysis cancels nothing', () => {
  {
    const { ctx, aim, G } = fired('cyndaquil');
    const at = G - 1 - 4;
    const log = run(ctx, [...idle(aim, at), tap(aim), { ...aim, btn: BTN.sig }, ...idle(aim, 120)]);
    assert.equal(log[at].queued, 1);
    assert.deepEqual(log[at + 1].dropped, ['cancel'], 'Tag held: the queued press is cancelled at once');
    assert.equal(total(log, 'accept'), 0);
  }
  {
    const R = { combat: { fireBuffer: [0.15, 0.15, 0, 0] } };
    const { ctx, aim } = calm('totodile', R);
    learnMove(ctx, 'bite');
    const l0 = run(ctx, idle(hold(aim, BTN.a), 240), 1);
    assert.ok(total(l0, 'accept') >= 1, 'Move A casts while held');
    let cancelled = 0, accepted = 0;
    for (let t = 0; t < 200; t++) {
      ctx.player.carrying = t > 0;
      const l = run(ctx, [t % 3 === 0 ? tap(aim, BTN.a) : aim], 1)[0];
      cancelled += l.dropped.filter((d) => d === 'cancel').length; accepted += l.accept;
    }
    assert.ok(cancelled > 0 && accepted === 0, `carrying: Move A presses cancelled (${cancelled}), none accepted`);
  }
  {
    const { ctx, aim, G } = fired('cyndaquil');
    const at = G - 1 - 4;
    ctx.player.paraT = 5;
    const log = run(ctx, [...idle(aim, at), tap(aim), ...idle(aim, 60)]);
    assert.equal(total(log, 'accept'), 1, 'paralysis (half speed) does not block attacks or the buffer');
  }
});

test('a modal state that outlasts the bound expires the queued press; a pause (no ticks) keeps it', () => {
  {
    const { ctx, aim, G } = fired('cyndaquil');
    const at = G - 1 - 6;
    run(ctx, [...idle(aim, at), tap(aim)]);
    ctx.state = 'evolving'; ctx.stateTimer = 99;
    run(ctx, idle(aim, 40)); // the sim's tick runs, the moves do not
    ctx.state = 'play';
    const log = run(ctx, idle(aim, 60));
    assert.ok(log.some((x) => x.dropped.includes('expired')), 'stale after the cinematic');
    assert.equal(total(log, 'accept'), 0);
  }
  {
    const { ctx, aim, G } = fired('cyndaquil');
    const at = G - 1 - 6;
    run(ctx, [...idle(aim, at), tap(aim)]);
    // paused: the host runs no step at all (main.ts), so sim time and the queue are frozen; it casts on resume
    const log = run(ctx, idle(aim, 60));
    assert.deepEqual(ticksOf(log, 'accept'), [5], 'cast on the ready tick of resumed sim time');
  }
});

test('combat modes: assist buffers like aimed; auto ignores presses and fires on its own', () => {
  {
    const { ctx, aim, G } = fired('cyndaquil', { combat: { mode: 'assist' } });
    const at = G - 1 - 3;
    const log = run(ctx, [...idle(aim, at), tap(aim), ...idle(aim, 60)]);
    assert.deepEqual(ticksOf(log, 'accept'), [at + 3], 'assist: queued and accepted on the ready tick');
  }
  {
    const { ctx, aim } = calm('cyndaquil', { combat: { mode: 'auto' } });
    const log = run(ctx, Array.from({ length: 300 }, (_, t) => (t % 4 === 0 ? tap(aim) : aim)));
    assert.equal(total(log, 'queued') + log.flatMap((x) => x.dropped).length, 0, 'auto: no press is read');
    assert.ok(total(log, 'cast') > 0, 'auto still fires on its own');
  }
});

test('every basic-attack family: a buffered tap casts once on the ready tick; the wind-up keeps its length', () => {
  const families: [string, string][] = [['bolt', 'cyndaquil'], ['orb', 'squirtle'], ['strike', 'bulbasaur'], ['dash', 'impidimp'], ['nova', 'magcargo'], ['chain', 'pichu'], ['lob', 'slugma'], ['cone', 'snom'], ['boomerang', 'chikorita'], ['barrage', 'heracross'], ['drain', 'oddish']];
  for (const [arch, sp] of families) {
    const { ctx, aim, G } = fired(sp);
    assert.equal(slotSpec(ctx, 0).archetype, arch, sp);
    const at = G - 1 - 4;
    const log = run(ctx, [...idle(aim, at), tap(aim), ...idle(aim, 200)]);
    const acc = ticksOf(log, 'accept'), cast = ticksOf(log, 'cast');
    assert.deepEqual(acc, [at + 4], `${arch}: accept on ready`);
    // the first wind-up's release is in this log too (tick < at)
    const rel = cast.filter((t) => t >= acc[0]);
    assert.deepEqual(rel, [acc[0] + windupTicks(defaultRules.feel.windup[arch])], `${arch}: release after its own wind-up`);
  }
});

test('deterministic tick timing: the same scripted presses give the same state and event log', () => {
  const once = () => {
    const { ctx, aim } = calm('bulbasaur');
    const out: string[] = [];
    for (let t = 0; t < 900; t++) {
      const inp: Partial<InputFrame> = t % 23 === 0 || t % 37 === 0 ? tap(aim) : t % 200 < 40 ? hold(aim) : aim;
      for (const e of step(ctx, { ...NO_INPUT, ...inp })) if (e.t === 'windup' || e.t === 'fireQueued' || e.t === 'fireDropped') out.push(`${t}:${e.t}:${'why' in e ? e.why : ''}`);
    }
    return { h: stateHash(ctx), out: out.join() };
  };
  const a = once(), b = once();
  assert.equal(a.h, b.h);
  assert.equal(a.out, b.out);
  assert.ok(a.out.includes('fireQueued') && a.out.includes('early'));
});

test('damage per second: mashing equals holding, a slow tap rate is never boosted, a queue never fires twice', () => {
  for (const sp of ['cyndaquil', 'heracross', 'slugma']) {
    const dps = (inputs: (aim: Partial<InputFrame>, t: number) => Partial<InputFrame>) => {
      const { ctx, aim } = calm(sp);
      const d0 = ctx.stats.damageDealt;
      const log = run(ctx, Array.from({ length: 600 }, (_, t) => inputs(aim, t)));
      return { dmg: ctx.stats.damageDealt - d0, casts: total(log, 'cast') };
    };
    const held = dps((a, t) => (t === 0 ? tap(a) : hold(a)));
    const mash = dps((a, t) => (t % 7 === 0 ? tap(a) : a));
    const slow = dps((a, t) => (t % 120 === 0 ? tap(a) : a));
    assert.ok(Math.abs(mash.dmg - held.dmg) <= held.dmg / held.casts + 1e-6, `${sp}: 8.6 Hz taps ${mash.dmg.toFixed(0)} vs hold ${held.dmg.toFixed(0)}`);
    assert.ok(mash.casts <= held.casts, `${sp}: never more casts than holding`);
    assert.equal(slow.casts, 5, `${sp}: one tap every 2 s is one attack each`);
  }
});

// ------------------------------------------------------------------ device assistance (planar path)

/** a private flat plain (tile walls editable), the partner at tile (50, 50), one move, one still enemy `dist` m away at
 *  `off` degrees right of a due-+z aim */
function assistScene(move: string, dev: InputFrame['aimDev'] | undefined, off: number, wall = false, dist = 6, rules: DeepPartial<Rules> = {}) {
  const ctx = createRun({ mode: RANGE, seed: 1, species: 'cyndaquil', ruleOverrides: { ...rules } as never });
  const W = new World(defaultRules, BIOMES.meadow, 5);
  const n = W.w * W.h, M = W.map;
  const map = { ...M, terrain: new Uint8Array(n), elev: new Float32Array(n), stairs: new Uint8Array(n), wall: new Uint8Array(n), platform: new Float32Array(n), over: new Float32Array(n), wlevel: undefined };
  Object.assign(W, { map, over: map.over, voids: new Uint8Array(n), los: true });
  ctx.world = W;
  ctx.enemies.clear(); ctx.projectiles.clear(); ctx.zones.clear();
  const P = ctx.player, c = (i: number) => i - W.half + 0.5;
  P.x = P.px = c(50); P.z = P.pz = c(50); P.y = P.py = 0; P.facing = 0;
  P.moves.length = 0; P.moves.push({ key: move, level: 1, cd: 0, spec: compileMove(ctx.rules, move) });
  const a = (off * Math.PI) / 180, ex = P.x + Math.sin(a) * dist, ez = P.z + Math.cos(a) * dist;
  const e = spawnEnemy(ctx, 'rattata', ex, ez);
  const E = ctx.enemies;
  E.x[e] = E.px[e] = ex; E.z[e] = E.pz[e] = ez; E.y[e] = E.py[e] = 0; E.spawnT[e] = 1; E.hp[e] = E.maxHp[e] = 1e6; E.speed[e] = 0; E.dmg[e] = 0;
  if (wall) W.map.wall[(Math.floor(P.z + W.half) + 3) * W.w + Math.floor((P.x + ex) / 2 + W.half)] = 1;
  ctx.grid.rebuild(E.hi, E.x, E.z, E.alive);
  const inp: InputFrame = { ...NO_INPUT, btn: BTN.basic, press: BTN.basic, aimX: P.x, aimZ: P.z + 10, ...(dev ? { aimDev: dev } : {}) };
  let cast: Extract<SimEvent, { t: 'cast' }> | undefined, heading = NaN;
  for (let t = 0; t < 30 && !cast; t++) {
    for (const ev of step(ctx, t === 0 ? inp : { ...inp, btn: 0, press: 0 })) if (ev.t === 'cast') cast = ev;
    if (cast) for (let i = 0; i < ctx.projectiles.hi; i++) if (ctx.projectiles.alive[i] && ctx.projectiles.kind[i] === PK.straight) heading = datan2(ctx.projectiles.vx[i], ctx.projectiles.vz[i]) * 180 / Math.PI;
  }
  assert.ok(cast, `${move} cast`);
  return { cast: cast!, heading, e };
}

test('mouse aim is direct: no hidden magnetism or lead; the stick bends visibly, and only toward an enemy it can see', () => {
  // a planar bolt (no crosshair ray): Ember at an enemy 6° off the aim
  const mouse = assistScene('ember', 'mouse', 6);
  assert.ok(Math.abs(mouse.heading) < 0.01, `mouse: the shot flies along the aim (${mouse.heading.toFixed(2)}°)`);
  assert.equal(mouse.cast.assist, undefined);
  const stick = assistScene('ember', 'stick', 6);
  assert.ok(Math.abs(stick.heading - 6) < 0.05, `stick: bent to the enemy (${stick.heading.toFixed(2)}°)`);
  assert.equal(stick.cast.assist, stick.e, 'the cast event names the enemy the aim bent to');
  const hidden = assistScene('ember', 'stick', 6, true);
  assert.ok(Math.abs(hidden.heading) < 0.01, `stick, wall between: not bent (${hidden.heading.toFixed(2)}°)`);
  assert.equal(hidden.cast.assist, undefined);
  // input with no device (scripted tests, older replays) keeps the legacy cone, no sight test, no assist field
  const legacy = assistScene('ember', undefined, 6, true);
  assert.ok(Math.abs(legacy.heading - 6) < 0.05, `no device: legacy magnetism (${legacy.heading.toFixed(2)}°)`);
  assert.equal(legacy.cast.assist, undefined);
  // rules.aim.deviceAssist false: the device is ignored (the Phase 2C layer exactly)
  const off = assistScene('ember', 'mouse', 6, true, 6, { aim: { deviceAssist: false } });
  assert.ok(Math.abs(off.heading - 6) < 0.05 && off.cast.assist === undefined, `deviceAssist off: legacy (${off.heading.toFixed(2)}°)`);
  // melee: a strike's 28° stick cone, none for the mouse
  const sm = assistScene('scratch', 'mouse', 20, false, 2), ss = assistScene('scratch', 'stick', 20, false, 2);
  assert.equal(sm.cast.assist, undefined);
  assert.ok(Math.abs(sm.cast.tx - sm.cast.x) < 1e-9 && sm.cast.tz > sm.cast.z, 'mouse strike lands along the aim (due +z)');
  assert.equal(ss.cast.assist, ss.e, 'stick strike bends to an enemy 20° off');
});

// ------------------------------------------------------------------ input capture (input/input.ts, stubbed DOM)

class Target {
  l: Record<string, ((e: unknown) => void)[]> = {};
  addEventListener(t: string, f: (e: unknown) => void) { (this.l[t] ??= []).push(f); }
  fire(t: string, e: Record<string, unknown> = {}) { for (const f of this.l[t] ?? []) f({ preventDefault() {}, target: null, ...e }); }
}
async function stubInput() {
  const win = new Target(), doc = Object.assign(new Target(), { pointerLockElement: null, exitPointerLock() {} }), el = Object.assign(new Target(), { requestPointerLock() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) });
  let pad: { buttons: { pressed: boolean; value: number }[]; axes: number[] } | null = null;
  Object.assign(globalThis, { window: win, document: doc });
  Object.defineProperty(globalThis, 'navigator', { value: { getGamepads: () => [pad] }, configurable: true, writable: true });
  const { Input } = await import('../src/input/input');
  const input = new Input(el as unknown as HTMLElement);
  input.context = 'play';
  const setPad = (rt: boolean | null) => { pad = rt === null ? null : { buttons: Array.from({ length: 16 }, (_, i) => ({ pressed: i === 7 && rt, value: 0 })), axes: [0, 0, 0, 0] }; };
  return { input, win, doc, el, setPad };
}

test('input: a click or key tap between two samples reaches the next sample as a press, once', async () => {
  const { input, win, el } = await stubInput();
  el.fire('mousedown', { button: 0 }); win.fire('mouseup', { button: 0 });
  let f = input.sample(0);
  assert.equal(f.btn! & BTN.basic, BTN.basic); assert.equal(f.press, BTN.basic);
  f = input.sample(0);
  assert.equal(f.btn! & BTN.basic, 0); assert.equal(f.press, undefined, 'one sample only');
  // frames with no sim tick (hit-stop, a fast display) take no sample, so the latch waits for the next tick
  win.fire('keydown', { code: 'KeyJ' }); win.fire('keyup', { code: 'KeyJ' });
  f = input.sample(0);
  assert.equal(f.press, BTN.basic, 'kept until the next sample');
});

test('input: held is not a press; a release and re-press inside one sample is', async () => {
  const { input, win, el } = await stubInput();
  el.fire('mousedown', { button: 0 });
  assert.equal(input.sample(0).press, BTN.basic);
  assert.equal(input.sample(0).press, undefined, 'still held: no new edge');
  assert.equal(input.sample(0).btn! & BTN.basic, BTN.basic);
  win.fire('mouseup', { button: 0 }); el.fire('mousedown', { button: 0 });
  const f = input.sample(0);
  assert.equal(f.btn! & BTN.basic, BTN.basic, 'btn alone shows it held throughout');
  assert.equal(f.press, BTN.basic, 'the re-press is an edge');
  win.fire('keydown', { code: 'KeyJ' }); win.fire('keydown', { code: 'KeyJ' }); // key auto-repeat is not a press
  assert.equal(input.sample(0).press, BTN.basic);
  win.fire('keydown', { code: 'KeyJ' });
  assert.equal(input.sample(0).press, undefined, 'auto-repeat of a held key adds no press');
});

test('input: pause and focus loss clear pending presses and held buttons', async () => {
  const { input, win, el } = await stubInput();
  el.fire('mousedown', { button: 0 });
  input.clearButtons(); // what the host does on pause (main.ts setPaused) and on losing the pointer lock
  let f = input.sample(0);
  assert.equal((f.btn ?? 0) & BTN.basic, 0); assert.equal(f.press, undefined);
  win.fire('keydown', { code: 'KeyJ' });
  win.fire('blur');
  f = input.sample(0);
  assert.equal((f.btn ?? 0) & BTN.basic, 0, 'focus lost: nothing held'); assert.equal(f.press, undefined, 'and nothing pending');
});

test('input: the gamepad trigger gives one press per pull (polled at the sample)', async () => {
  const { input, setPad } = await stubInput();
  setPad(true);
  assert.equal(input.sample(0).press, BTN.basic);
  assert.equal(input.sample(0).press, undefined);
  setPad(false); input.sample(0); setPad(true);
  assert.equal(input.sample(0).press, BTN.basic);
  setPad(null);
  assert.equal(input.sample(0).press, undefined);
});
