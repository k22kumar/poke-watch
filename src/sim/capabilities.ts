// The capability resolver (blueprint sections 7 and 12, Phase 8a).
//
// One event shape for every interaction: a capability (Hit, Push, Hold, Deflect, Apply, Create) with a Power,
// a type and an owner, aimed at a target. `resolve()` reads the target's profile (Weight, type, integrity,
// owner, state) and applies the rule from section 7, whatever produced the event: a move, a Tag Action, a
// thrown body or a shot. Targets: creatures, bodies, projectiles (light bodies of Weight 0 or 1) and tiles.
// Cover props (Phase 8c) will be one more target kind with the same profile.
//
// The per-target rules live next to their data (sim/bodies.ts for bodies, sim/combat.ts for creature damage,
// sim/cells.ts for tiles); this module is the single entry point that dispatches to them, plus the projectile
// rules (interception, push-deflect, hold-catch) that did not exist before.
//
// Conflicts within one tick: Deflect (the Guard window) is checked before Hit; pushes on one body combine
// first, then the highest Power wins; every pool is walked in index order.

import { datan2, dhypot, dsin, dcos } from '../core/detmath';
import { type CapVerb, type Cap } from '../rules/capabilities';
import { ELEMENTS, type Element } from '../rules/elements';
import { AGENT_NAMES, type AgentName } from '../rules/reactions';
import { BODY_TEMPLATES } from '../rules/materials';
import { weightClass } from '../rules/species';
import { ROLE, PK } from './pools';
import { TEAM, bodyWeight, breakBody, damageBody, holdBody, pushBody, spawnBody, deflectBody } from './bodies';
import { applyAgent } from './cells';
import { coatEnemy } from './coats';
import { rec, setSrc, type LogKind } from './caplog';
import { BTN, type SimContext } from './types';
import type { DamageSpec } from './combat';
import { brambleAt } from './cells';
import { holdSeconds } from './techniques';
import { ccApply } from './coats';

export type SrcKind = 'move' | 'tag' | 'body' | 'shot' | 'tile' | 'creature' | 'guard';
export type TgtKind = 'creature' | 'body' | 'shot' | 'cover' | 'tile';
export type Outcome = 'ok' | 'fail' | 'combined' | 'caught' | 'deflected' | 'cancel' | 'none';

export interface CapEvent {
  verb: CapVerb;
  /** Push / Hold Power; Deflect: the guard's Weight; Hit: unused */
  power: number;
  type: Element;
  /** team that owns the force (TEAM.player / TEAM.enemy / TEAM.neutral) */
  owner: number;
  x: number; z: number;
  /** direction of the force (push: along it; hold: from the target toward the holder) */
  dx: number; dz: number;
  source: { kind: SrcKind; id: number; name: string };
  target: { kind: TgtKind; id: number };
  /** Hit: integrity damage before the type chart */
  amount?: number;
  /** Apply: the agent and depth (1 light, 2 deep); tiles take radius r */
  agent?: AgentName; depth?: number; r?: number;
  /** Create: the body template */
  template?: string;
  /** Hold: the casting move slot (a manual move releases early when its button is let go) */
  slot?: number;
}

/** the master switch and one feature flag */
export function capsOn(ctx: SimContext, f: 'interception' | 'suspendHold' | 'bodyCollisions'): boolean {
  return ctx.rules.caps.enabled && ctx.rules.caps[f];
}

// ------------------------------------------------------------------ cast context
// The moves system sets the slot it is casting from, so a Hold knows which button keeps it.
let castSlot = -1;
export function setCastSlot(slot: number) { castSlot = slot; }
export function currentCastSlot() { return castSlot; }

/** the button bit that keeps a hold from move slot `slot` (0 = no button: hold for the full time) */
export function holdButton(ctx: SimContext, slot: number): number {
  if (ctx.rules.combat.mode === 'auto') return 0;
  return slot === 1 ? BTN.a : slot === 2 ? BTN.b : 0;
}

/** the holder's aim: the aim point, else the facing */
export function holdAim(ctx: SimContext): [number, number] {
  const P = ctx.player, inp = ctx.input;
  if (inp.aimX !== undefined && inp.aimZ !== undefined) {
    const dx = inp.aimX - P.x, dz = inp.aimZ - P.z, L = dhypot(dx, dz);
    if (L > 0.5) return [dx / L, dz / L];
  }
  return [dsin(P.facing), dcos(P.facing)];
}

// ------------------------------------------------------------------ the resolver
/** Resolve one capability event against its target. */
export function resolve(ctx: SimContext, ev: CapEvent): Outcome {
  setSrc(ev.source.kind as LogKind, ev.source.name);
  switch (ev.target.kind) {
    case 'body': return onBody(ctx, ev);
    case 'shot': return onShot(ctx, ev);
    case 'creature': return onCreature(ctx, ev);
    case 'tile': return onTile(ctx, ev);
    default: return 'none'; // cover props arrive in Phase 8c
  }
}

function onBody(ctx: SimContext, ev: CapEvent): Outcome {
  const b = ev.target.id, B = ctx.bodies;
  if (!B.alive[b]) return 'none';
  switch (ev.verb) {
    case 'push': {
      // the combine rule is checked inside pushBody; read it here only to report the outcome
      const L = dhypot(ev.dx, ev.dz) || 1;
      const combines = ctx.time - B.pushT[b] <= 0.2 && (ev.dx / L) * B.pushX[b] + (ev.dz / L) * B.pushZ[b] >= 0.7071;
      const ok = pushBody(ctx, b, ev.power, ev.dx, ev.dz, ev.owner);
      return ok ? (combines && ev.power < bodyWeight(ctx, b) ? 'combined' : 'ok') : 'fail';
    }
    case 'hold': return holdBody(ctx, b, ev.power, ev.dx, ev.dz, ev.owner, holdButton(ctx, ev.slot ?? -1)) ? 'ok' : 'fail';
    case 'hit': damageBody(ctx, b, ev.amount ?? 0, ev.type, ev.owner === TEAM.player); return 'ok';
    case 'deflect': {
      if (bodyWeight(ctx, b) > ev.power) return 'fail';
      const L = dhypot(ev.dx, ev.dz) || 1;
      deflectBody(ctx, b, ev.dx / L, ev.dz / L);
      return 'deflected';
    }
    default: return 'none';
  }
}

function onCreature(ctx: SimContext, ev: CapEvent): Outcome {
  const e = ev.target.id, E = ctx.enemies;
  if (!E.alive[e]) return 'none';
  if (ev.verb === 'apply' && ev.agent) {
    coatEnemy(ctx, e, AGENT_NAMES.indexOf(ev.agent), ev.depth ?? 2, ev.amount ?? 0, ev.owner === TEAM.player);
    const r = rec(ctx, 'apply', 'ok');
    if (r) { r.tgt = 'creature'; r.tgtName = ctx.speciesIndex[E.species[e]].name; r.x = E.x[e]; r.z = E.z[e]; }
    return 'ok';
  }
  if (ev.verb === 'hold') { FORCE.hold = ev.power; FORCE.knock = 0; return creatureForce(ctx, e, FORCE) ? 'ok' : 'fail'; }
  if (ev.verb === 'push') {
    // a bare Push on a creature (no move behind it) follows the body rule: Power >= Weight knocks it away at
    // 8 x (1 + 0.5 x (Power - Weight)) m/s, less does nothing; moves keep their own knockback in damageEnemy
    const w = weightClass(ctx.speciesIndex[E.species[e]], (E.roles[e] & ROLE.boss) !== 0);
    if (ev.power < w) return 'fail';
    FORCE.hold = 0; FORCE.knock = 8 * (1 + 0.5 * (ev.power - w)); FORCE.kx = ev.dx; FORCE.kz = ev.dz;
    return creatureForce(ctx, e, FORCE) ? 'ok' : 'fail';
  }
  return 'none';
}
const FORCE = { hold: 0, knock: 0, kx: 0, kz: 0 };

/** Phase 8b: a technique adds an Apply event after a hit (Undertow after a Push, Slipstream's copied coat) */
const APPLY: CapEvent = { verb: 'apply', power: 0, type: 'plain', owner: 1 /* TEAM.player as a literal: module init order */, x: 0, z: 0, dx: 0, dz: 0, source: { kind: 'move', id: -1, name: '' }, target: { kind: 'creature', id: -1 } };
export function applyAfterHit(ctx: SimContext, e: number, agent: number, depth: number, amount: number, by: string) {
  const name = AGENT_NAMES[agent];
  if (!name) return;
  APPLY.agent = name; APPLY.depth = depth; APPLY.amount = amount; APPLY.x = ctx.enemies.x[e]; APPLY.z = ctx.enemies.z[e];
  APPLY.source.name = by; APPLY.target.id = e;
  resolve(ctx, APPLY);
}

function onTile(ctx: SimContext, ev: CapEvent): Outcome {
  if (ev.verb === 'apply' && ev.agent) { applyAgent(ctx, ev.agent, ev.x, ev.z, ev.r ?? 0.5); return 'ok'; }
  if (ev.verb === 'create' && ev.template === 'bramble') {
    // Phase 8b Burrow: a Grass patch is a tile state, not a body
    const n = brambleAt(ctx, ev.x, ev.z, ev.r ?? 2);
    const r = rec(ctx, 'create', n ? 'ok' : 'fail');
    if (r) { r.src = ev.source.kind as LogKind; r.srcName = ev.source.name; r.tgt = 'tile'; r.tgtName = 'grass patch'; r.x = ev.x; r.z = ev.z; }
    return n ? 'ok' : 'fail';
  }
  if (ev.verb === 'create' && ev.template) return createBody(ctx, ev.template, ev.x, ev.z, ev.source.name) >= 0 ? 'ok' : 'fail';
  return 'none';
}

/** Create: spawn a body from a template. Each player keeps at most rules.caps.createCap; the oldest breaks first. */
export function createBody(ctx: SimContext, template: string, x: number, z: number, srcName = ''): number {
  const B = ctx.bodies;
  const b = spawnBody(ctx, template, x, z, 0, 0, TEAM.neutral);
  if (b < 0) return -1;
  if (!ctx.rules.caps.enabled) return b;
  B.made[b] = 1;
  let n = 0, oldest = -1, age = -1;
  for (let i = 0; i < B.hi; i++) {
    if (!B.alive[i] || !B.made[i]) continue;
    n++;
    if (i !== b && B.age[i] > age) { age = B.age[i]; oldest = i; }
  }
  if (n > ctx.rules.caps.createCap && oldest >= 0) { setSrc('tag', 'create cap'); breakBody(ctx, oldest); }
  const r = rec(ctx, 'create', 'ok');
  if (r) { r.src = 'tag'; r.srcName = srcName; r.tgt = 'body'; r.tgtName = template; r.weight = BODY_TEMPLATES[template]?.weight ?? 0; r.x = x; r.z = z; }
  return b;
}

// ------------------------------------------------------------------ creatures
/** Push / Hold on a creature: a Hold no lighter than the creature reels it in 2 m; otherwise a knockback that
 *  bosses, alphas and elites resist. (v10's rule, moved here unchanged so every source shares it.) Returns true if
 *  a force was applied. */
export function creatureForce(ctx: SimContext, e: number, spec: Pick<DamageSpec, 'hold' | 'knock' | 'kx' | 'kz' | 'lasso'>): boolean {
  const E = ctx.enemies, P = ctx.player;
  if (spec.lasso && spec.hold) {
    // Phase 8b Lasso: a Light creature (Weight 1 or less) is suspended in front of you, then thrown along your aim;
    // anything heavier is only hit
    const w = weightClass(ctx.speciesIndex[E.species[e]], (E.roles[e] & ROLE.boss) !== 0);
    if (w > 1 || w > spec.hold || E.heldT[e] > 0) return false;
    if (ccApply(ctx, e, ctx.rules.build.lassoHold) <= 0) return false; // crowd-control immune: it slips the lasso
    E.heldT[e] = Math.max(ctx.rules.build.lassoHold, holdSeconds(ctx) - ctx.rules.caps.holdTime + ctx.rules.build.lassoHold);
    E.heldP[e] = spec.hold; E.heldBtn[e] = holdButton(ctx, castSlot);
    E.stun[e] = Math.max(E.stun[e], E.heldT[e]);
    setSrc('move', 'Lasso');
    const r = rec(ctx, 'hold', 'ok');
    if (r) { r.power = spec.hold; r.weight = w; r.tgt = 'creature'; r.tgtName = ctx.speciesIndex[E.species[e]].name; r.x = E.x[e]; r.z = E.z[e]; }
    return true;
  }
  if (spec.hold && spec.hold >= weightClass(ctx.speciesIndex[E.species[e]], (E.roles[e] & ROLE.boss) !== 0)) {
    // Vine Whip, Wrap, Confusion…: reel it in, 2 m toward you
    const dx = P.x - E.x[e], dz = P.z - E.z[e], L = dhypot(dx, dz) || 1;
    const k = Math.min(L - 1.2, 2) * 5;
    if (k > 0) { E.kx[e] += (dx / L) * k; E.kz[e] += (dz / L) * k; }
    return true;
  } else if (spec.knock > 0) {
    const L = dhypot(spec.kx, spec.kz) || 1;
    const resist = E.roles[e] & ROLE.boss ? 0.05 : E.roles[e] & ROLE.alpha ? 0.3 : E.roles[e] & ROLE.elite ? 0.6 : 1;
    const k = spec.knock * ctx.rules.damage.knockMult * resist;
    E.kx[e] += (spec.kx / L) * k;
    E.kz[e] += (spec.kz / L) * k;
    return true;
  }
  return false;
}

// ------------------------------------------------------------------ projectiles as light bodies
/** Send shot i along (ux, uz) as the player's: a Guard deflect, a Push deflect, or a held shot released.
 *  (v10's deflect, generalised: same speed and damage rule.) */
export function launchShot(ctx: SimContext, i: number, ux: number, uz: number) {
  const Pr = ctx.projectiles, P = ctx.player, G = ctx.rules.combat;
  const sp = Math.max(10, dhypot(Pr.vx[i], Pr.vz[i])) * G.deflectSpeed;
  Pr.kind[i] = PK.straight;
  Pr.vx[i] = ux * sp; Pr.vz[i] = uz * sp; Pr.speed[i] = sp;
  Pr.dmg[i] = G.deflectDmg * (1 + 0.04 * (P.level - 1));
  Pr.pierce[i] = 1; Pr.radius[i] = Math.max(Pr.radius[i], 0.5);
  Pr.life[i] = Pr.maxLife[i] = 1.4; Pr.t[i] = 0;
  Pr.cls[i] = 1; Pr.knock[i] = 4; Pr.chance[i] = 0; Pr.drain[i] = 0; Pr.move[i] = -1;
  Pr.ox[i] = Pr.x[i]; Pr.oz[i] = Pr.z[i];
  Pr.depth[i] = 255; Pr.fx[i] = 0; Pr.extra[i] = 0; // a deflected shot coats deep, as before
}

/** Phase 8b Lasso: a suspended creature follows the hold point, then is thrown along the aim as a Push of the hold's
 *  Power (the body rule's speed). Returns true while it is still held (it skips its own movement this tick). */
export function tickHeldEnemy(ctx: SimContext, e: number, dt: number): boolean {
  const E = ctx.enemies, P = ctx.player, W = ctx.world;
  E.heldT[e] -= dt;
  const [ux, uz] = holdAim(ctx);
  const w = weightClass(ctx.speciesIndex[E.species[e]], (E.roles[e] & ROLE.boss) !== 0);
  if (P.paraT > 0 || P.faintT >= 0 || ctx.state !== 'play') { E.heldT[e] = 0; E.stun[e] = 0; return false; }
  const btnUp = E.heldBtn[e] !== 0 && !((ctx.input.btn ?? 0) & E.heldBtn[e]);
  if (E.heldT[e] <= 0 || btnUp) {
    E.heldT[e] = 0; E.stun[e] = 0;
    const sp = 8 * (1 + 0.5 * Math.max(0, E.heldP[e] - w));
    E.kx[e] = ux * sp; E.kz[e] = uz * sp; E.vx[e] = 0; E.vz[e] = 0;
    ctx.events.push({ t: 'push', x: E.x[e], z: E.z[e], ok: true, combined: false });
    setSrc('move', 'Lasso');
    const r = rec(ctx, 'release', 'ok');
    if (r) { r.power = E.heldP[e]; r.weight = w; r.tgt = 'creature'; r.tgtName = ctx.speciesIndex[E.species[e]].name; r.x = E.x[e]; r.z = E.z[e]; }
    return false;
  }
  P.holdNext++;
  const tx = P.x + ux * (ctx.rules.caps.holdDistance + E.radius[e]), tz = P.z + uz * (ctx.rules.caps.holdDistance + E.radius[e]);
  const dx = tx - E.x[e], dz = tz - E.z[e], d = dhypot(dx, dz);
  if (d > 1e-6) {
    const step = Math.min(d, ctx.rules.caps.holdSpeed * dt);
    const nx = Math.fround(E.x[e] + (dx / d) * step), nz = Math.fround(E.z[e] + (dz / d) * step);
    if (!W.solid(nx, nz)) { E.x[e] = nx; E.z[e] = nz; }
  }
  E.vx[e] = 0; E.vz[e] = 0; E.kx[e] = 0; E.kz[e] = 0;
  E.y[e] = W.height(E.x[e], E.z[e]) + 0.6 + E.hover[e];
  return true;
}

const isHostile = (ctx: SimContext, i: number) => ctx.projectiles.kind[i] === PK.hostile;
const shotTeam = (ctx: SimContext, i: number) => (isHostile(ctx, i) ? TEAM.enemy : TEAM.player);

function logShot(ctx: SimContext, verb: 'push' | 'hold' | 'deflect' | 'intercept' | 'release', out: 'ok' | 'fail' | 'cancel' | 'catch' | 'drop', i: number, power: number) {
  const r = rec(ctx, verb, out);
  if (!r) return;
  const Pr = ctx.projectiles;
  r.power = power; r.weight = Pr.weight[i]; r.tgt = 'shot'; r.tgtName = Pr.src[i] >= 0 ? ctx.speciesIndex[Pr.src[i]].name : 'shot';
  r.x = Pr.x[i]; r.z = Pr.z[i];
}

function onShot(ctx: SimContext, ev: CapEvent): Outcome {
  const i = ev.target.id, Pr = ctx.projectiles;
  if (!Pr.alive[i] || Pr.heldT[i] > 0) return 'none';
  if (shotTeam(ctx, i) === ev.owner) return 'none'; // a team's forces leave its own shots alone
  const w = Pr.weight[i];
  switch (ev.verb) {
    case 'push': {
      // a Push of any Power deflects a shot it overlaps, along the push
      const L = dhypot(ev.dx, ev.dz) || 1;
      launchShot(ctx, i, ev.dx / L, ev.dz / L);
      ctx.events.push({ t: 'deflect', x: Pr.x[i], z: Pr.z[i], element: ev.type });
      logShot(ctx, 'push', 'ok', i, ev.power);
      return 'deflected';
    }
    case 'hold': {
      if (ev.power < w) { logShot(ctx, 'hold', 'fail', i, ev.power); return 'fail'; }
      Pr.kind[i] = PK.straight; Pr.vx[i] = Pr.vx[i] * 0.1; Pr.vz[i] = Pr.vz[i] * 0.1;
      Pr.heldT[i] = holdSeconds(ctx); Pr.heldBtn[i] = holdButton(ctx, ev.slot ?? -1); Pr.move[i] = -1;
      ctx.events.push({ t: 'push', x: Pr.x[i], z: Pr.z[i], ok: true, combined: false });
      logShot(ctx, 'hold', 'catch', i, ev.power);
      return 'caught';
    }
    case 'deflect': {
      if (w > ev.power) return 'fail';
      const L = dhypot(ev.dx, ev.dz) || 1;
      launchShot(ctx, i, ev.dx / L, ev.dz / L);
      logShot(ctx, 'deflect', 'ok', i, ev.power);
      return 'deflected';
    }
    case 'hit': {
      // a shot of the other team: the lighter shot is cancelled, equal Weights cancel both,
      // and a heavier shot survives but spends one pierce
      const j = ev.source.id;
      if (j < 0 || !Pr.alive[j]) return 'none';
      const wj = Pr.weight[j];
      logShot(ctx, 'intercept', 'cancel', i, wj);
      ctx.events.push({ t: 'block', x: Pr.x[i], z: Pr.z[i], enemy: -1 });
      if (w <= wj) Pr.kill(i);
      if (wj <= w) Pr.kill(j); else spendPierce(ctx, j);
      return 'cancel';
    }
    default: return 'none';
  }
}

function spendPierce(ctx: SimContext, i: number) {
  const Pr = ctx.projectiles;
  if (!Pr.alive[i] || Pr.pierce[i] < 0) return;
  Pr.pierce[i]--;
  if (Pr.pierce[i] < 0) Pr.kill(i);
}

const EV: CapEvent = { verb: 'hit', power: 0, type: 'plain', owner: 0, x: 0, z: 0, dx: 0, dz: 0, source: { kind: 'move', id: -1, name: '' }, target: { kind: 'shot', id: -1 } };
function shotEvent(verb: CapVerb, power: number, type: Element, owner: number, dx: number, dz: number, srcKind: SrcKind, srcId: number, srcName: string, target: number, slot: number) {
  EV.verb = verb; EV.power = power; EV.type = type; EV.owner = owner; EV.dx = dx; EV.dz = dz;
  EV.source.kind = srcKind; EV.source.id = srcId; EV.source.name = srcName; EV.target.kind = 'shot'; EV.target.id = target; EV.slot = slot;
  return EV;
}

/**
 * An area force (a strike, cone, beam, nova, dash or zone tick) meets the other team's shots it overlaps:
 * a Push deflects them along `dir(x, z)`, a Hold catches the ones no heavier than its Power.
 * `inside(x, z, r)` decides overlap for the shape. Lobs are in the air and pass over.
 */
export function forceOnShots(ctx: SimContext, push: number, hold: number, type: Element, owner: number, srcName: string, slot: number,
  inside: (x: number, z: number, r: number) => boolean, dir: (x: number, z: number) => [number, number]) {
  if ((!push && !hold) || !capsOn(ctx, 'interception')) return;
  const Pr = ctx.projectiles;
  let budget = ctx.rules.caps.maxInterceptsPerTick;
  for (let i = 0; i < Pr.hi && budget > 0; i++) {
    if (!Pr.alive[i] || Pr.heldT[i] > 0 || Pr.kind[i] === PK.lob || shotTeam(ctx, i) === owner) continue;
    if (!inside(Pr.x[i], Pr.z[i], Pr.radius[i])) continue;
    const [ux, uz] = dir(Pr.x[i], Pr.z[i]);
    if (hold) resolve(ctx, shotEvent('hold', hold, type, owner, ux, uz, slot === 9 ? 'tag' : 'move', -1, srcName, i, slot));
    else resolve(ctx, shotEvent('push', push, type, owner, ux, uz, slot === 9 ? 'tag' : 'move', -1, srcName, i, slot));
    budget--;
  }
}

// Interception between projectiles, after they move (blueprint section 7, step 4): the player's shots against the
// enemy's, lower index first, at most rules.caps.maxInterceptsPerTick per tick.
const OURS = new Int32Array(4096), THEIRS = new Int32Array(4096);
export function interceptPass(ctx: SimContext) {
  if (!capsOn(ctx, 'interception')) return;
  const Pr = ctx.projectiles;
  let no = 0, nt = 0;
  for (let i = 0; i < Pr.hi; i++) {
    if (!Pr.alive[i] || Pr.heldT[i] > 0 || Pr.kind[i] === PK.lob) continue;
    if (Pr.kind[i] === PK.hostile) THEIRS[nt++] = i; else OURS[no++] = i;
  }
  if (!no || !nt) return;
  let budget = ctx.rules.caps.maxInterceptsPerTick;
  for (let a = 0; a < no && budget > 0; a++) {
    const i = OURS[a];
    for (let c = 0; c < nt && budget > 0 && Pr.alive[i]; c++) {
      const j = THEIRS[c];
      if (!Pr.alive[j] || Pr.kind[j] !== PK.hostile) continue;
      const dx = Pr.x[j] - Pr.x[i], dz = Pr.z[j] - Pr.z[i], rr = Pr.radius[i] + Pr.radius[j];
      if (dx > rr || dx < -rr || dz > rr || dz < -rr || dx * dx + dz * dz > rr * rr) continue;
      budget--;
      const el = ELEMENT_AT(ctx, i), name = shotName(ctx, i);
      if (Pr.pushP[i] > 0) {
        // a pushing shot (Water Gun, Bubble…) deflects the enemy shot along its own flight, then spends a pierce
        let ux = Pr.vx[i], uz = Pr.vz[i];
        if (Pr.kind[i] === PK.orbit) { ux = Pr.x[j] - ctx.player.x; uz = Pr.z[j] - ctx.player.z; }
        resolve(ctx, shotEvent('push', Pr.pushP[i], el, TEAM.player, ux, uz, 'shot', i, name, j, Pr.move[i]));
        spendPierce(ctx, i);
      } else if (Pr.holdP[i] > 0 && Pr.holdP[i] >= Pr.weight[j]) {
        resolve(ctx, shotEvent('hold', Pr.holdP[i], el, TEAM.player, -dx, -dz, 'shot', i, name, j, Pr.move[i]));
        spendPierce(ctx, i);
      } else {
        resolve(ctx, shotEvent('hit', 0, el, TEAM.player, dx, dz, 'shot', i, name, j, Pr.move[i]));
      }
    }
  }
}
const ELEMENT_AT = (ctx: SimContext, i: number) => ELEMENTS[ctx.projectiles.element[i]];
function shotName(ctx: SimContext, i: number): string {
  const slot = ctx.projectiles.move[i], P = ctx.player;
  if (slot >= 0 && slot < P.moves.length) return P.moves[slot].spec.name;
  return slot === 9 ? 'Tag Action' : 'deflected shot';
}

/** A held shot: it waits at the hold point, then flies along the aim (or drops if the holder is stunned). */
export function tickHeldShot(ctx: SimContext, i: number, dt: number) {
  const Pr = ctx.projectiles, P = ctx.player, C = ctx.rules.caps;
  Pr.heldT[i] -= dt;
  P.holdNext++;
  const [ux, uz] = holdAim(ctx);
  if (P.paraT > 0 || P.faintT >= 0 || ctx.state !== 'play') { Pr.heldT[i] = 0; logShot(ctx, 'release', 'drop', i, 0); Pr.kill(i); return; }
  const btnUp = Pr.heldBtn[i] !== 0 && !((ctx.input.btn ?? 0) & Pr.heldBtn[i]);
  Pr.x[i] = P.x + ux * C.holdDistance; Pr.z[i] = P.z + uz * C.holdDistance;
  Pr.y[i] = P.y + 0.9;
  if (Pr.heldT[i] <= 0 || btnUp) {
    Pr.heldT[i] = 0;
    launchShot(ctx, i, ux, uz);
    P.aimFacing = datan2(ux, uz); P.aimT = 0.2;
    ctx.events.push({ t: 'deflect', x: Pr.x[i], z: Pr.z[i], element: ELEMENT_AT(ctx, i) });
    logShot(ctx, 'release', 'ok', i, Pr.weight[i]);
  }
}

/** capability list of whatever a projectile or zone slot index casts (Tag Actions and orphans have none) */
export function slotCaps(ctx: SimContext, slot: number): readonly Cap[] | undefined {
  const P = ctx.player;
  return slot >= 0 && slot < P.moves.length ? P.moves[slot].spec.caps : undefined;
}

