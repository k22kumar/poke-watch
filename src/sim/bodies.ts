// Bodies and the force verbs (blueprint sections 7-8).
//
// A body is a boulder, a rock or a chunk of rubble: a circle on the height field with a Weight class,
// a Pokémon type and integrity. Moves act on bodies through three verbs:
//   Hit  - integrity damage through the type chart (Water and Grass break Rock; Fire barely scratches it)
//   Push - Power >= Weight sets its velocity along the push; less only slows it. Two pushes within
//          0.2 s and 45° of each other count as the stronger Power + 1.
//   Hold - Power >= Weight pulls it toward the holder.
// A moving body (5 m/s or more) hits whatever it touches for 10 x Weight x speed/10, typed as the body.
// Guard deflects a body no heavier than the guard's own Weight class; Brace halves the hit.
// Every change of owner costs a quarter of its integrity, so nothing can be passed back and forth forever.

import { datan2, dcos, dhypot, dsin } from '../core/detmath';
import { BODY_KINDS, BODY_TEMPLATES } from '../rules/materials';
import { capOf, deriveHold, derivePush } from '../rules/capabilities';
import { effectiveness, type Element } from '../rules/elements';
import { forceOnProp } from './props';
import { weightClass } from '../rules/species';
import { damageEnemy, damagePlayer } from './combat';
import { deflecting } from './player';
import { CS, rubbleAt } from './cells';
import { ROLE } from './pools';
import type { MoveSpec, SimContext } from './types';
import { rec, setSrc } from './caplog';
import { currentCastSlot, holdAim, holdButton } from './capabilities';
import { TB } from '../rules/build';
import { guardWeight, holdSeconds, logTech, onGuardDeflect } from './techniques';
import { applyAgent } from './cells';

export const TEAM = { neutral: 0, player: 1, enemy: 2 } as const;
const HIT_RING = 8;

export class BodyPool {
  readonly cap: number;
  hi = 0;
  count = 0;
  alive: Uint8Array; gen: Uint32Array;
  x: Float64Array; y: Float64Array; z: Float64Array; px: Float64Array; pz: Float64Array;
  vx: Float64Array; vz: Float64Array;
  kind: Uint8Array; team: Uint8Array;
  hp: Float64Array; maxHp: Float64Array; life: Float64Array; age: Float64Array;
  /** impact damage base (before speed scaling) */
  dmg: Float64Array;
  /** distance rolled (for the sprite's spin) */
  roll: Float64Array;
  /** last push: time, power, direction (combined force) */
  pushT: Float64Array; pushP: Uint8Array; pushX: Float64Array; pushZ: Float64Array;
  /** player-hit cooldown (one move hit per 0.2 s) */
  hitCd: Float64Array;
  /** recently hit enemies */
  hitE: Int32Array; hitT: Float64Array; hitN: Uint8Array;
  /** Phase 8a suspend-style Hold: s left suspended, its Power and the button that keeps it (0 = none) */
  holdT: Float64Array; holdP: Uint8Array; holdBtn: Uint8Array;
  /** last hold attempt (time, Power, direction), for combining holds like pushes */
  hPT: Float64Array; hP: Uint8Array; hX: Float64Array; hZ: Float64Array;
  /** made by a player's Create (counted against rules.caps.createCap) */
  made: Uint8Array;
  /** recently struck bodies (body-on-body impacts): body index and until when */
  bhitE: Int32Array; bhitT: Float64Array; bhitN: Uint8Array;
  private free: number[] = [];

  constructor(cap: number) {
    this.cap = cap;
    const F = () => new Float64Array(cap);
    this.alive = new Uint8Array(cap); this.gen = new Uint32Array(cap);
    this.x = F(); this.y = F(); this.z = F(); this.px = F(); this.pz = F(); this.vx = F(); this.vz = F();
    this.kind = new Uint8Array(cap); this.team = new Uint8Array(cap);
    this.hp = F(); this.maxHp = F(); this.life = F(); this.age = F(); this.dmg = F(); this.roll = F();
    this.pushT = F(); this.pushP = new Uint8Array(cap); this.pushX = F(); this.pushZ = F(); this.hitCd = F();
    this.hitE = new Int32Array(cap * HIT_RING); this.hitT = new Float64Array(cap * HIT_RING); this.hitN = new Uint8Array(cap);
    this.holdT = F(); this.holdP = new Uint8Array(cap); this.holdBtn = new Uint8Array(cap);
    this.hPT = F(); this.hP = new Uint8Array(cap); this.hX = F(); this.hZ = F(); this.made = new Uint8Array(cap);
    this.bhitE = new Int32Array(cap * HIT_RING); this.bhitT = new Float64Array(cap * HIT_RING); this.bhitN = new Uint8Array(cap);
    for (let i = cap - 1; i >= 0; i--) this.free.push(i);
  }
  spawn(): number {
    const i = this.free.pop();
    if (i === undefined) return -1;
    this.alive[i] = 1; this.gen[i]++; this.count++;
    if (i >= this.hi) this.hi = i + 1;
    this.vx[i] = this.vz[i] = 0; this.age[i] = 0; this.roll[i] = 0; this.pushT[i] = -9; this.pushP[i] = 0; this.hitCd[i] = 0; this.hitN[i] = 0;
    this.hitE.fill(-1, i * HIT_RING, (i + 1) * HIT_RING);
    this.holdT[i] = 0; this.holdP[i] = 0; this.holdBtn[i] = 0; this.hPT[i] = -9; this.hP[i] = 0; this.made[i] = 0; this.bhitN[i] = 0;
    this.bhitE.fill(-1, i * HIT_RING, (i + 1) * HIT_RING);
    return i;
  }
  kill(i: number) {
    if (!this.alive[i]) return;
    this.alive[i] = 0; this.count--;
    this.free.push(i);
  }
  clear() { for (let i = 0; i < this.hi; i++) if (this.alive[i]) this.kill(i); this.hi = 0; this.free = []; for (let i = this.cap - 1; i >= 0; i--) this.free.push(i); }
  recentlyHit(i: number, e: number, now: number) {
    const b = i * HIT_RING;
    for (let k = 0; k < HIT_RING; k++) if (this.hitE[b + k] === e && this.hitT[b + k] > now) return true;
    return false;
  }
  markHit(i: number, e: number, until: number) {
    const k = this.hitN[i]++ % HIT_RING;
    this.hitE[i * HIT_RING + k] = e; this.hitT[i * HIT_RING + k] = until;
  }
  /** body i struck body j (generation-tagged) within the cooldown */
  recentlyStruck(i: number, j: number, now: number) {
    const b = i * HIT_RING, id = j * 4096 + (this.gen[j] & 4095);
    for (let k = 0; k < HIT_RING; k++) if (this.bhitE[b + k] === id && this.bhitT[b + k] > now) return true;
    return false;
  }
  markStruck(i: number, j: number, until: number) {
    const k = this.bhitN[i]++ % HIT_RING;
    this.bhitE[i * HIT_RING + k] = j * 4096 + (this.gen[j] & 4095); this.bhitT[i * HIT_RING + k] = until;
  }
}

export const tpl = (ctx: SimContext, b: number) => BODY_TEMPLATES[BODY_KINDS[ctx.bodies.kind[b]]];
export const bodyWeight = (ctx: SimContext, b: number) => tpl(ctx, b).weight;
export const bodySpeed = (ctx: SimContext, b: number) => dhypot(ctx.bodies.vx[b], ctx.bodies.vz[b]);

export function spawnBody(ctx: SimContext, kind: string, x: number, z: number, vx = 0, vz = 0, team: number = TEAM.neutral, dmg?: number): number {
  const B = ctx.bodies, T = BODY_TEMPLATES[kind];
  if (!T) throw new Error('unknown body ' + kind);
  const i = B.spawn();
  if (i < 0) return -1;
  B.kind[i] = BODY_KINDS.indexOf(kind);
  B.x[i] = B.px[i] = x; B.z[i] = B.pz[i] = z; B.y[i] = ctx.world.height(x, z);
  B.vx[i] = vx; B.vz[i] = vz; B.team[i] = team;
  B.hp[i] = B.maxHp[i] = T.integrity; B.life[i] = T.life;
  B.dmg[i] = dmg ?? 10 * T.weight;
  return i;
}

// ------------------------------------------------------------------ move -> verb powers
// The derivation lives in rules/capabilities.ts and is compiled into each MoveSpec's `caps`; these read it.

/** Push Power of a move: Water moves, physical Fighting/Rock/Ground moves, special Flying moves and
 *  contact dash moves push, by base power (under 60 = 1, 60-90 = 2, over 90 = 3). */
export function pushPower(s: MoveSpec): number {
  return s.caps ? capOf(s.caps, 'push') : derivePush(s);
}
/** Hold Power: binding and telekinetic moves (Vine Whip, Wrap, Confusion, Psychic…) */
export function holdPower(s: MoveSpec): number {
  return s.caps ? capOf(s.caps, 'hold') : deriveHold(s);
}

// ------------------------------------------------------------------ verbs
/** Push body b with a power along (dx, dz). Returns true if it moved it, false if it was too heavy. */
export function pushBody(ctx: SimContext, b: number, power: number, dx: number, dz: number, team: number): boolean {
  const B = ctx.bodies, W = bodyWeight(ctx, b);
  const L = dhypot(dx, dz) || 1; dx /= L; dz /= L;
  // combined force: a second push within 0.2 s and 45° adds one Power
  let P = power;
  if (ctx.time - B.pushT[b] <= 0.2 && dx * B.pushX[b] + dz * B.pushZ[b] >= 0.7071) P = Math.min(4, Math.max(P, B.pushP[b]) + 1);
  B.pushT[b] = ctx.time; B.pushP[b] = power; B.pushX[b] = dx; B.pushZ[b] = dz;
  const r = rec(ctx, 'push', P >= W ? (P > power ? 'combined' : 'ok') : 'fail');
  if (r) { r.power = P; r.weight = W; r.tgt = 'body'; r.tgtName = BODY_KINDS[B.kind[b]]; r.type = tpl(ctx, b).type; r.x = B.x[b]; r.z = B.z[b]; }
  if (P >= W) {
    const sp = 8 * (1 + 0.5 * (P - W));
    B.vx[b] = dx * sp; B.vz[b] = dz * sp;
    changeOwner(ctx, b, team);
    ctx.events.push({ t: 'push', x: B.x[b], z: B.z[b], ok: true, combined: P > power });
    return true;
  }
  // too heavy: it only slows
  const k = Math.max(0, 1 - 0.15 * P);
  B.vx[b] *= k; B.vz[b] *= k;
  ctx.events.push({ t: 'push', x: B.x[b], z: B.z[b], ok: false, combined: false });
  return false;
}

/**
 * Suspend-style Hold (Phase 8a): Power >= Weight suspends the body 1.5 m in front of the holder for up to
 * rules.caps.holdTime s; it is then released as a Push of the same Power along the holder's aim. Holds combine
 * like pushes (a second hold within 0.2 s and 45° counts as the stronger Power + 1). Less Power only slows it.
 * (dx, dz) points from the body toward the holder. Returns true if the body is (now) held.
 */
export function holdBody(ctx: SimContext, b: number, power: number, dx: number, dz: number, team: number, btn: number): boolean {
  const B = ctx.bodies, W = bodyWeight(ctx, b), C = ctx.rules.caps;
  if (B.holdT[b] > 0) return true; // already suspended: a hold lasts its time, it is not refreshed
  if (ctx.objective && ctx.objective.egg === b && ctx.objective.carrier !== -1) return false; // carried
  const L = dhypot(dx, dz) || 1; dx /= L; dz /= L;
  let P = power;
  if (ctx.time - B.hPT[b] <= C.combineWindow && dx * B.hX[b] + dz * B.hZ[b] >= C.combineCos) P = Math.min(4, Math.max(P, B.hP[b]) + 1);
  B.hPT[b] = ctx.time; B.hP[b] = power; B.hX[b] = dx; B.hZ[b] = dz;
  const r = rec(ctx, 'hold', P >= W ? (P > power ? 'combined' : 'ok') : 'fail');
  if (r) { r.power = P; r.weight = W; r.tgt = 'body'; r.tgtName = BODY_KINDS[B.kind[b]]; r.type = tpl(ctx, b).type; r.x = B.x[b]; r.z = B.z[b]; }
  if (P >= W) {
    B.holdT[b] = holdSeconds(ctx); B.holdP[b] = P; B.holdBtn[b] = btn;
    B.vx[b] = 0; B.vz[b] = 0;
    changeOwner(ctx, b, team);
    ctx.events.push({ t: 'push', x: B.x[b], z: B.z[b], ok: true, combined: P > power });
    return B.alive[b] === 1;
  }
  const k = Math.max(0, 1 - 0.15 * P);
  B.vx[b] *= k; B.vz[b] *= k;
  ctx.events.push({ t: 'push', x: B.x[b], z: B.z[b], ok: false, combined: false });
  return false;
}

/** A suspended body follows the hold point; on release it flies along the aim as a Push of its hold Power.
 *  Returns true while it is still held (the body skips its normal motion and impacts this tick). */
function tickHeld(ctx: SimContext, b: number, dt: number): boolean {
  const B = ctx.bodies, P = ctx.player, C = ctx.rules.caps, T = tpl(ctx, b), Wd = ctx.world;
  B.holdT[b] -= dt;
  const [ux, uz] = holdAim(ctx);
  const O = ctx.objective;
  if (P.paraT > 0 || P.faintT >= 0 || ctx.state !== 'play' || (O && O.egg === b && O.carrier !== -1)) {
    // a stunned or fainted holder drops it where it is
    B.holdT[b] = 0; B.vx[b] = B.vz[b] = 0;
    const r = rec(ctx, 'release', 'drop');
    if (r) { r.power = B.holdP[b]; r.weight = T.weight; r.tgt = 'body'; r.tgtName = BODY_KINDS[B.kind[b]]; r.x = B.x[b]; r.z = B.z[b]; }
    return false;
  }
  const btnUp = B.holdBtn[b] !== 0 && !((ctx.input.btn ?? 0) & B.holdBtn[b]);
  if (B.holdT[b] <= 0 || btnUp) {
    B.holdT[b] = 0;
    const sp = 8 * (1 + 0.5 * Math.max(0, B.holdP[b] - T.weight));
    B.vx[b] = ux * sp; B.vz[b] = uz * sp;
    // the throw counts as this tick's push, so a partner's push within 0.2 s combines with it
    B.pushT[b] = ctx.time; B.pushP[b] = B.holdP[b]; B.pushX[b] = ux; B.pushZ[b] = uz;
    ctx.events.push({ t: 'push', x: B.x[b], z: B.z[b], ok: true, combined: false });
    const r = rec(ctx, 'release', 'ok');
    if (r) { r.power = B.holdP[b]; r.weight = T.weight; r.tgt = 'body'; r.tgtName = BODY_KINDS[B.kind[b]]; r.type = T.type; r.x = B.x[b]; r.z = B.z[b]; }
    return false;
  }
  // suspended: travel to the hold point in front of the holder and wait there
  P.holdNext++;
  const dist = Math.max(C.holdDistance, T.radius + ctx.rules.player.radius + 0.25);
  const tx = P.x + ux * dist, tz = P.z + uz * dist;
  const dx = tx - B.x[b], dz = tz - B.z[b], d = dhypot(dx, dz);
  if (d > 1e-6) {
    const step = Math.min(d, C.holdSpeed * dt);
    const nx = B.x[b] + (dx / d) * step, nz = B.z[b] + (dz / d) * step;
    if (!Wd.solid(nx, nz)) { B.x[b] = nx; B.z[b] = nz; }
  }
  B.vx[b] = 0; B.vz[b] = 0;
  B.y[b] = Wd.height(B.x[b], B.z[b]) + 0.6;
  return true;
}

export function changeOwner(ctx: SimContext, b: number, team: number) {
  const B = ctx.bodies;
  if (B.team[b] !== TEAM.neutral && B.team[b] !== team) {
    B.hp[b] -= B.maxHp[b] * 0.25; // each change of hands wears it down
    if (team === TEAM.player) B.dmg[b] = 10 * bodyWeight(ctx, b) * 1.5; // turned against its thrower
  }
  B.team[b] = team;
  if (B.hp[b] <= 0) breakBody(ctx, b);
}

/** Integrity damage through the type chart; breaks it at zero. `byPlayer`: the trainer's hit (Quarry). */
export function damageBody(ctx: SimContext, b: number, amount: number, element: Element, byPlayer = false) {
  const B = ctx.bodies;
  if (!B.alive[b]) return;
  const T = tpl(ctx, b);
  if (T.integrity <= 0) return;
  const quarry = byPlayer && (ctx.player.techMask & TB.quarry) !== 0;
  const eff = effectiveness(ctx.chart, element, [T.type]);
  const dealt = amount * eff * (quarry ? ctx.rules.build.tech.quarry.integrity : 1);
  B.hp[b] -= dealt;
  ctx.events.push({ t: 'bodyHit', x: B.x[b], y: B.y[b] + T.radius, z: B.z[b], amount: dealt, eff, element });
  if (B.hp[b] <= 0) breakBody(ctx, b, quarry);
}

/** Quarry: a rock or boulder the trainer broke leaves extra rubble, owned by the player, flung outward */
function quarryRubble(ctx: SimContext, x: number, z: number, a0: number) {
  const Q = ctx.rules.build.tech.quarry;
  for (let k = 0; k < Q.rubble; k++) {
    const a = a0 + Math.PI * (0.5 + k) * (2 / Q.rubble);
    spawnBody(ctx, 'rubble', x + dsin(a) * 0.5, z + dcos(a) * 0.5, dsin(a) * Q.speed, dcos(a) * Q.speed, TEAM.player);
  }
  logTech(ctx, 'quarry', `+${Q.rubble} rubble`, x, z);
}

export function breakBody(ctx: SimContext, b: number, quarry = false) {
  const B = ctx.bodies;
  if (!B.alive[b]) return;
  const T = tpl(ctx, b);
  const x = B.x[b], z = B.z[b], vx = B.vx[b], vz = B.vz[b], team = B.team[b], dmg = B.dmg[b];
  B.kill(b);
  B.holdT[b] = 0;
  ctx.events.push({ t: 'break', x, z, r: T.radius, element: T.type });
  const r = rec(ctx, 'break', 'ok');
  if (r) { r.weight = T.weight; r.tgt = 'body'; r.tgtName = BODY_KINDS[B.kind[b]]; r.type = T.type; r.x = x; r.z = z; }
  ctx.events.push({ t: 'shake', amount: 0.12 * T.weight, x, z });
  if (T.weight >= 3) rubbleAt(ctx, x, z, 1);
  const into = T.breaksInto;
  if (!into) return;
  if (quarry && into.template === 'rubble') quarryRubble(ctx, x, z, datan2(vx, vz));
  const base = datan2(vx, vz), sp = dhypot(vx, vz) * into.speedKeep;
  for (let k = 0; k < into.count; k++) {
    // shrapnel keeps half the speed, fanned over 60°; resting rocks scatter gently
    const a = base + (into.count > 1 ? (k / (into.count - 1) - 0.5) * 1.05 : 0) + ctx.rng.world.range(-0.15, 0.15);
    const s = sp > 1 ? sp : ctx.rng.world.range(1.5, 3);
    const aa = sp > 1 ? a : ctx.rng.world.range(0, Math.PI * 2);
    spawnBody(ctx, into.template, x + dsin(aa) * 0.4, z + dcos(aa) * 0.4, dsin(aa) * s, dcos(aa) * s, team, team === TEAM.enemy ? dmg * 0.3 : undefined);
  }
}

/** A player move touches body b: damage it, and push or hold it if the move can. */
export function moveOnBody(ctx: SimContext, b: number, s: MoveSpec, dmg: number, dirx: number, dirz: number, slot = currentCastSlot()) {
  const B = ctx.bodies;
  if (!B.alive[b] || B.hitCd[b] > ctx.time || B.holdT[b] > 0) return; // your own moves pass a body you are holding
  B.hitCd[b] = ctx.time + 0.2;
  const P = ctx.player, d = P.derived;
  const out = dmg * ctx.rules.damage.playerMult * (s.cls === 'physical' ? d.atk : d.spa);
  setSrc(slot === 9 ? 'tag' : 'move', s.name);
  forceOnBody(ctx, b, pushPower(s), holdPower(s), dirx, dirz, slot);
  if (B.alive[b]) damageBody(ctx, b, out, s.element, true);
}

/** The force verbs of a player effect on body b: a Hold (pull in v10, suspend in Phase 8a), else a Push. */
export function forceOnBody(ctx: SimContext, b: number, push: number, hold: number, dirx: number, dirz: number, slot: number) {
  const B = ctx.bodies, P = ctx.player;
  if (hold > 0) {
    if (ctx.rules.caps.enabled && ctx.rules.caps.suspendHold) { holdBody(ctx, b, hold, P.x - B.x[b], P.z - B.z[b], TEAM.player, holdButton(ctx, slot)); return; }
    // v10: a hold pulls it toward you when it is light enough
    const W = bodyWeight(ctx, b);
    if (hold >= W) { const dx = P.x - B.x[b], dz = P.z - B.z[b], L = dhypot(dx, dz) || 1; B.vx[b] = (dx / L) * 7; B.vz[b] = (dz / L) * 7; changeOwner(ctx, b, TEAM.player); ctx.events.push({ t: 'push', x: B.x[b], z: B.z[b], ok: true, combined: false }); }
    else ctx.events.push({ t: 'push', x: B.x[b], z: B.z[b], ok: false, combined: false });
  } else if (push > 0) {
    const moved = pushBody(ctx, b, push, dirx, dirz, TEAM.player);
    // Undertow: your Pushes also Apply Wet (the ground under the rock you roll)
    if (moved && P.techMask & TB.undertow) applyAgent(ctx, 'wet', B.x[b], B.z[b], 1.2);
  }
}

/** bodies whose circle overlaps (x, z, r); calls fn(body) */
export function eachBodyIn(ctx: SimContext, x: number, z: number, r: number, fn: (b: number) => void) {
  const B = ctx.bodies;
  for (let b = 0; b < B.hi; b++) {
    if (!B.alive[b]) continue;
    const rr = r + tpl(ctx, b).radius;
    const dx = B.x[b] - x, dz = B.z[b] - z;
    if (dx * dx + dz * dz <= rr * rr) fn(b);
  }
}

/** The deflect window turns a body back along the player's aim, if it is no heavier than the player. */
export function deflectBody(ctx: SimContext, b: number, ux: number, uz: number) {
  const B = ctx.bodies;
  B.holdT[b] = 0;
  const r = rec(ctx, 'deflect', 'ok');
  if (r) { r.src = 'player'; r.srcName = ctx.player.species.name; r.power = guardWeight(ctx); r.weight = bodyWeight(ctx, b); r.tgt = 'body'; r.tgtName = BODY_KINDS[B.kind[b]]; r.type = tpl(ctx, b).type; r.x = B.x[b]; r.z = B.z[b]; }
  const sp = Math.max(9, bodySpeed(ctx, b)) * 1.1;
  B.vx[b] = ux * sp; B.vz[b] = uz * sp;
  changeOwner(ctx, b, TEAM.player);
  ctx.player.guardHit = true;
  onGuardDeflect(ctx);
  ctx.events.push({ t: 'deflect', x: B.x[b], z: B.z[b], element: tpl(ctx, b).type });
}

// ------------------------------------------------------------------ system
const IMPACT_SPEED = 5;

export const bodySystem = {
  name: 'bodies',
  update(ctx: SimContext, dt: number) {
    const B = ctx.bodies, W = ctx.world, E = ctx.enemies, P = ctx.player;
    const collide = ctx.rules.caps.enabled && ctx.rules.caps.bodyCollisions;
    for (let b = 0; b < B.hi; b++) {
      if (!B.alive[b]) continue;
      const T = tpl(ctx, b);
      B.age[b] += dt;
      if (B.age[b] > T.life) { breakBody(ctx, b); continue; }
      B.px[b] = B.x[b]; B.pz[b] = B.z[b];
      if (B.holdT[b] > 0 && tickHeld(ctx, b, dt)) continue;
      let sp = dhypot(B.vx[b], B.vz[b]);
      if (sp > 0) {
        // rolling friction (Frozen ground will lower this in the surface-state layer)
        const ice = ctx.world.cells.at(B.x[b], B.z[b]) === CS.frozen;
        const ns = Math.max(0, sp - T.friction * (ice ? 0.15 : 1) * dt);
        if (ns < 0.3) { B.vx[b] = B.vz[b] = 0; sp = 0; }
        else { B.vx[b] *= ns / sp; B.vz[b] *= ns / sp; sp = ns; }
      }
      if (sp > 0) {
        const nx = B.x[b] + B.vx[b] * dt, nz = B.z[b] + B.vz[b] * dt;
        const feet = W.height(B.x[b], B.z[b]);
        const ax = Math.sign(B.vx[b]) * T.radius, az = Math.sign(B.vz[b]) * T.radius;
        const blockX = W.blocks(nx + ax, B.z[b], feet, 0.6), blockZ = W.blocks(B.x[b], nz + az, feet, 0.6);
        if (blockX || blockZ) {
          // W4: a body running into a tree, bush or rock strikes it as a force of its own Weight
          if (ctx.rules.surfaces.enabled && sp >= IMPACT_SPEED) {
            const k = W.tile(blockX ? nx + ax : B.x[b], blockX ? B.z[b] : nz + az);
            if (k >= 0) forceOnProp(ctx, k, sp >= 8 ? T.weight : T.weight - 1, (10 * T.weight * sp) / 10, T.type);
          }
          if (sp >= 8 && T.integrity > 0) { ctx.events.push({ t: 'shake', amount: 0.2, x: B.x[b], z: B.z[b] }); breakBody(ctx, b); continue; }
          if (blockX) B.vx[b] *= -0.3;
          if (blockZ) B.vz[b] *= -0.3;
        } else { B.x[b] = nx; B.z[b] = nz; }
        B.roll[b] += sp * dt;
        sp = dhypot(B.vx[b], B.vz[b]);
      }
      B.y[b] = W.height(B.x[b], B.z[b]);
      const x = B.x[b], z = B.z[b], R = T.radius, wgt = T.weight;

      // impacts on enemies (player-owned or loose bodies only; enemy throws pass through their side)
      if (sp >= IMPACT_SPEED && B.team[b] !== TEAM.enemy) {
        const n = ctx.grid.query(x, z, R + 3.5);
        for (let k = 0; k < n && B.alive[b]; k++) {
          const e = ctx.grid.result[k];
          if (!E.alive[e] || E.spawnT[e] < 0.25 || E.hover[e] > 0.5) continue;
          const dx = E.x[e] - x, dz = E.z[e] - z, rr = R + E.radius[e];
          if (dx * dx + dz * dz > rr * rr || B.recentlyHit(b, e, ctx.time)) continue;
          B.markHit(b, e, ctx.time + 0.5);
          const ew = weightClass(ctx.speciesIndex[E.species[e]], (E.roles[e] & ROLE.boss) !== 0);
          const dealt = (B.dmg[b] * sp) / 10;
          damageEnemy(ctx, e, dealt, { element: T.type, cls: 'physical', ailment: 'knock', chance: 0, knock: wgt >= ew ? 9 : 2, kx: B.vx[b], kz: B.vz[b], drain: 0, source: 'impact' });
          if (ew >= wgt) { B.vx[b] *= -0.3; B.vz[b] *= -0.3; } // stopped by something as heavy
          else { B.vx[b] *= 0.85; B.vz[b] *= 0.85; }
          sp = dhypot(B.vx[b], B.vz[b]);
          if (sp < IMPACT_SPEED) break;
        }
      }

      // Phase 8a: the impact rule between bodies. A body moving at 5 m/s or more strikes the bodies it runs into
      // for 10 x Weight x speed / 10, typed as itself, and shoves them as a Push of its own Weight; something as
      // heavy stops it (it bounces back), something lighter only slows it.
      if (sp >= IMPACT_SPEED && collide && B.alive[b]) sp = bodyImpacts(ctx, b, sp);

      // the player: thrown bodies hit, guard or deflect; resting bodies are solid
      const dxp = P.x - x, dzp = P.z - z, rp = R + ctx.rules.player.radius;
      const dp2 = dxp * dxp + dzp * dzp;
      if (dp2 < (rp + 0.9) * (rp + 0.9) && sp >= IMPACT_SPEED && B.team[b] !== TEAM.player) {
        const near = dp2 < rp * rp;
        if (deflecting(ctx) && wgt <= guardWeight(ctx)) {
          const inp = ctx.input;
          let ux = -B.vx[b], uz = -B.vz[b];
          if (inp.aimX !== undefined && inp.aimZ !== undefined) { ux = inp.aimX - P.x; uz = inp.aimZ - P.z; }
          const L = dhypot(ux, uz) || 1;
          deflectBody(ctx, b, ux / L, uz / L);
          continue;
        }
        if (near && P.y - W.height(P.x, P.z) < R * 1.4) {
          const res = damagePlayer(ctx, (B.dmg[b] * sp) / 10, x, z, 1.4, wgt, T.type, { kind: 'body', name: BODY_KINDS[B.kind[b]] });
          if (res === 'parry') { deflectBody(ctx, b, dxp === 0 && dzp === 0 ? 0 : -B.vx[b] / sp, -B.vz[b] / sp); continue; }
          if (res !== 'none') { B.vx[b] *= 0.8; B.vz[b] *= 0.8; }
        }
      }
      const held = ctx.objective && ctx.objective.egg === b && ctx.objective.carrier !== -1;
      if (!held && sp < IMPACT_SPEED && dp2 < rp * rp && dp2 > 1e-6 && P.y - B.y[b] < R * 1.2) {
        // resting bodies are solid: push the player out
        const d = Math.sqrt(dp2), push = rp - d;
        const qx = P.x + (dxp / d) * push, qz = P.z + (dzp / d) * push;
        if (!W.blocks(qx, qz, P.y, ctx.rules.player.stepHeight)) { P.x = qx; P.z = qz; }
      }
    }
  },
};

/** body b (moving at speed sp) strikes the bodies it overlaps; returns its speed afterwards */
function bodyImpacts(ctx: SimContext, b: number, sp: number): number {
  const B = ctx.bodies, T = tpl(ctx, b), wgt = T.weight, O = ctx.objective;
  for (let j = 0; j < B.hi && B.alive[b]; j++) {
    if (j === b || !B.alive[j] || B.holdT[j] > 0) continue;
    if (B.age[b] < 0.25 && B.age[j] < 0.25) continue; // pieces of one break do not strike each other
    if (O && O.egg === j && O.carrier !== -1) continue; // a carried egg is in someone's arms
    const Tj = tpl(ctx, j), rr = T.radius + Tj.radius;
    const dx = B.x[j] - B.x[b], dz = B.z[j] - B.z[b];
    if (dx * dx + dz * dz > rr * rr) continue;
    if (B.vx[b] * dx + B.vz[b] * dz <= 0) continue; // moving apart
    if (B.recentlyStruck(b, j, ctx.time)) continue;
    B.markStruck(b, j, ctx.time + 0.5);
    const amount = (B.dmg[b] * sp) / 10;
    const ux = B.vx[b] / sp, uz = B.vz[b] / sp;
    setSrc('body', BODY_KINDS[B.kind[b]]);
    const r = rec(ctx, 'impact', Tj.weight <= wgt ? 'ok' : 'fail');
    if (r) { r.power = wgt; r.weight = Tj.weight; r.amount = amount; r.type = T.type; r.tgt = 'body'; r.tgtName = BODY_KINDS[B.kind[j]]; r.x = B.x[j]; r.z = B.z[j]; }
    pushBody(ctx, j, wgt, ux, uz, B.team[b]);
    if (B.alive[j]) damageBody(ctx, j, amount, T.type, B.team[b] === TEAM.player);
    if (Tj.weight >= wgt) { B.vx[b] *= -0.3; B.vz[b] *= -0.3; } else { B.vx[b] *= 0.6; B.vz[b] *= 0.6; }
    sp = dhypot(B.vx[b], B.vz[b]);
    if (sp < IMPACT_SPEED) break;
  }
  return sp;
}

/** Loose rocks scattered on the route at the start of each stage. */
export function seedBodies(ctx: SimContext) {
  const n = ctx.rules.bodies.looseRocks;
  const W = ctx.world;
  const [sx, sz] = W.spawn;
  for (let k = 0, tries = 0; k < n && tries < n * 30; tries++) {
    const a = ctx.rng.world.range(0, Math.PI * 2), r = ctx.rng.world.range(7, 42);
    const x = Math.floor(sx + dsin(a) * r) + 0.5, z = Math.floor(sz + dcos(a) * r) + 0.5;
    if (!W.walkable(x, z) || !W.walkable(x + 1, z) || !W.walkable(x - 1, z) || !W.walkable(x, z + 1) || !W.walkable(x, z - 1)) continue;
    let clear = true;
    eachBodyIn(ctx, x, z, 4, () => { clear = false; });
    if (!clear) continue;
    spawnBody(ctx, 'rock', x, z);
    k++;
  }
}

