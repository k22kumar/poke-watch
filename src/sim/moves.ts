// Move pipeline: data row -> archetype (classifier) -> scaled spec -> archetype behaviour.
// Classifier order follows PokéBonk: status kinds -> override table -> zero-power physical
// -> drain -> multi-hit -> regex rules on key -> accuracy-less special = homing -> per-element fallback.
// Scaling [C]: dmg x clamp(0.72 + power/260, 0.85, 1.3); cd x clamp(0.88 + (power-60)/500, 0.85, 1.15); priority cd x0.85.

import { datan2, dcos, dhypot, dpow, dsin } from '../core/detmath';
import { ABILITY_IDS } from '../rules/abilities';
import { clamp } from '../core/util';
import { ELEMENT_DEFS, ELEMENTS } from '../rules/elements';
import { MOVE_BY_KEY, archetypeOverrides, archetypeRegexRules, type MoveData } from '../rules/moves';
import type { Rules } from '../rules/defaults';
import { compileCaps } from '../rules/capabilities';
import { ailmentIndex, damageEnemy, healPlayer, type DamageSpec } from './combat';
import { PK, ZK } from './pools';
import { eachBodyIn, holdPower, moveOnBody, pushPower, TEAM, tpl } from './bodies';
import { currentCastSlot, forceOnShots, setCastSlot } from './capabilities';
import { forceOnPropsIn } from './props';
import { shotWeight } from '../rules/capabilities';
import { agentOf, applyAgent } from './cells';
import { BTN, freshAimState, type MoveSlot, type MoveSpec, type SimContext } from './types';
import { HEAD, assistSees, beamLength, combatFlags, launchHeading, resolveSpatial, shotReach, spatialFor } from './aim';
import { Contacts, MASK, QF, RayHit, SK, SK_WORLD, spatialQuery, sweep } from './spatial';
import { AG } from '../rules/reactions';
import { GROUND, worldOf } from './worldquery';

export function classify(m: MoveData): string {
  if (m.cls === 'status') return m.statusKind ?? 'buff';
  if (archetypeOverrides[m.key]) return archetypeOverrides[m.key];
  if (m.power === 0 && m.cls === 'physical') return 'strike';
  if (m.drain) return 'drain';
  if (m.hits && m.hits > 1) return 'barrage';
  for (const [re, arch] of archetypeRegexRules) if (re.test(m.key)) return arch;
  if (m.cls === 'special' && m.accuracy === null) return 'homing';
  const fb = ELEMENT_DEFS[m.element].fallback;
  return m.cls === 'physical' ? fb[0] : fb[1];
}

const cache = new WeakMap<Rules, Map<string, MoveSpec>>();

export function compileMove(rules: Rules, key: string): MoveSpec {
  let c = cache.get(rules);
  if (!c) { c = new Map(); cache.set(rules, c); }
  const hit = c.get(key);
  if (hit) return hit;
  const m = MOVE_BY_KEY[key];
  if (!m) throw new Error('unknown move ' + key);
  const arch = classify(m);
  const t = rules.archetypes[arch];
  if (!t) throw new Error(`move ${key} classified as unknown archetype ${arch}`);
  const ds = rules.moves.dmgScale, cs = rules.moves.cdScale;
  const power = m.power || 60;
  const dmgK = clamp(ds.base + power * ds.perPower, ds.min, ds.max);
  let cdK = clamp(cs.base + (power - cs.pivot) * cs.per, cs.min, cs.max);
  if ((m.priority ?? 0) > 0) cdK *= rules.moves.priorityCdMult;
  const D = rules.damage;
  const ailment = m.ailment ?? ELEMENT_DEFS[m.element].ailment;
  const chance = m.ailmentChance != null
    ? clamp((m.ailmentChance / 100) * D.ailmentChanceScale, D.ailmentMin, D.ailmentMax)
    : D.defaultAilmentChance;
  const spec: MoveSpec = {
    key, name: m.name, element: m.element, cls: m.cls, archetype: arch,
    dmg: t.dmg * dmgK, cd: t.cd * cdK, range: t.range, speed: t.speed, count: arch === 'barrage' ? Math.max(t.count, m.hits ?? 0) : t.count,
    radius: t.radius, pierce: t.pierce, duration: t.duration, knock: t.knock, tick: t.tick,
    ailment, ailmentChance: chance, drain: m.drain ?? (arch === 'drain' ? 0.35 : 0), priority: m.priority ?? 0, power: m.power,
  };
  spec.caps = compileCaps(spec);
  c.set(key, spec);
  return spec;
}

/** Spec adjusted for move level and player vitamins. */
export function levelled(ctx: SimContext, slot: MoveSlot): MoveSpec {
  const R = ctx.rules.moves;
  const s = slot.spec;
  const L = slot.level - 1;
  const area = ctx.player.derived.area;
  const countBonus = Math.floor(L / R.levelCountEvery);
  const multi = ['bolt', 'barrage', 'orbit', 'chain', 'homing', 'orb', 'drain', 'meteor', 'trail'].includes(s.archetype);
  return {
    ...s,
    dmg: s.dmg * (1 + R.levelDmg * L),
    cd: (s.cd * dpow(1 - R.levelCd, L)) / ctx.player.derived.haste,
    count: s.count + (multi ? countBonus : 0),
    radius: ['cone', 'bolt', 'orb', 'homing', 'drain', 'barrage'].includes(s.archetype) ? s.radius : s.radius * (1 + R.levelArea * L) * area,
    pierce: s.pierce < 0 ? -1 : s.pierce + (s.archetype === 'bolt' && !s.fixedPierce ? countBonus : 0),
  };
}

// ------------------------------------------------------------------ helpers
const scratch = new Int32Array(4096);

export function nearestEnemy(ctx: SimContext, x: number, z: number, range: number, exclude = -1): number {
  const E = ctx.enemies;
  const n = ctx.grid.query(x, z, range);
  let best = -1, bd = range * range;
  for (let k = 0; k < n; k++) {
    const e = ctx.grid.result[k];
    if (!E.alive[e] || e === exclude || E.spawnT[e] < 0.25) continue;
    const dx = E.x[e] - x, dz = E.z[e] - z;
    const d = dx * dx + dz * dz;
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

/** Collect live enemies within radius into scratch; returns count. */
export function enemiesInRadius(ctx: SimContext, x: number, z: number, r: number): number {
  const E = ctx.enemies;
  const n = ctx.grid.query(x, z, r + 2);
  let m = 0;
  for (let k = 0; k < n; k++) {
    const e = ctx.grid.result[k];
    if (!E.alive[e]) continue;
    const rr = r + E.radius[e];
    const dx = E.x[e] - x, dz = E.z[e] - z;
    if (dx * dx + dz * dz <= rr * rr) scratch[m++] = e;
  }
  return m;
}
export const hitScratch = scratch;

/** coat depth of the cast in progress: slot 0 (the basic attack) coats light, every other slot deep */
let castDepth = 1;
export function setCastDepth(d: number) { castDepth = d; }
/** an extra agent the cast in progress carries (0 none: nothing sets one since the build layer went) */
let castExtra = 0;
/** the coat depth a cast applies: the slot's, unless the move always coats light or deep (Scatter, Searing);
 *  a basic attack under Catalyst applies no light coat */
function effDepth(spec: MoveSpec): number {
  if (!spec.coatDepth) return castDepth;
  return castDepth === 0 && spec.coatDepth === 1 ? 0 : spec.coatDepth;
}
function dspec(spec: MoveSpec, kx: number, kz: number, knock = spec.knock): DamageSpec {
  return { depth: effDepth(spec), element: spec.element, cls: spec.cls, ailment: spec.ailment, chance: spec.ailmentChance, knock, kx, kz, drain: spec.drain, source: spec.key, contact: spec.archetype === 'strike' || spec.archetype === 'dash' || spec.archetype === 'spin' || spec.archetype === 'trail', hold: holdPower(spec),
    push: pushPower(spec), lasso: spec.lasso, ccT: spec.ccT, extra: castExtra };
}

function aoe(ctx: SimContext, x: number, z: number, r: number, spec: MoveSpec, dmg: number, outward = true) {
  const n = enemiesInRadius(ctx, x, z, r);
  const E = ctx.enemies;
  const P = ctx.player;
  for (let k = 0; k < n; k++) {
    const e = scratch[k];
    const kx = outward ? E.x[e] - x : E.x[e] - P.x;
    const kz = outward ? E.z[e] - z : E.z[e] - P.z;
    damageEnemy(ctx, e, dmg, dspec(spec, kx, kz));
  }
  // the ground: Fire sets grass alight, Water wets, Ice freezes, Electric charges water
  applyAgent(ctx, agentOf(spec.element), x, z, r * 0.8);
  // rocks and boulders in the area: hit, and pushed away from the centre (or from you, for strikes)
  eachBodyIn(ctx, x, z, r, (b) => {
    const B = ctx.bodies;
    moveOnBody(ctx, b, spec, dmg, outward ? B.x[b] - x : B.x[b] - P.x, outward ? B.z[b] - z : B.z[b] - P.z);
  });
  // Phase 8a: enemy shots in the area are pushed away (deflected) or caught, by the same rule as bodies
  shotsInCircle(ctx, spec, x, z, r, outward ? x : P.x, outward ? z : P.z);
  // W4: trees, bushes and rocks in the area: a Push of their Weight breaks them, weaker pushes chip them
  { const pp = pushPower(spec); if (pp) forceOnPropsIn(ctx, x, z, r, pp, dmg, spec.element); }
  return n;
}

/** Phase 8b: a strike that catches one target (Lasso, Crunch Down): the enemy nearest the strike's centre, else the
 *  nearest body; enemy shots in the area still meet its force */
function single(ctx: SimContext, x: number, z: number, r: number, spec: MoveSpec, dmg: number) {
  const n = enemiesInRadius(ctx, x, z, r);
  const E = ctx.enemies, P = ctx.player;
  let best = -1, bd = Infinity;
  for (let k = 0; k < n; k++) { const e = scratch[k], d = (E.x[e] - x) ** 2 + (E.z[e] - z) ** 2; if (d < bd) { bd = d; best = e; } }
  if (best >= 0) damageEnemy(ctx, best, dmg, dspec(spec, E.x[best] - P.x, E.z[best] - P.z));
  else {
    let bb = -1, bbd = Infinity;
    eachBodyIn(ctx, x, z, r, (b) => { const d = (ctx.bodies.x[b] - x) ** 2 + (ctx.bodies.z[b] - z) ** 2; if (d < bbd) { bbd = d; bb = b; } });
    if (bb >= 0) moveOnBody(ctx, bb, spec, dmg, ctx.bodies.x[bb] - P.x, ctx.bodies.z[bb] - P.z);
  }
  applyAgent(ctx, agentOf(spec.element), x, z, r * 0.8);
  shotsInCircle(ctx, spec, x, z, r, P.x, P.z);
  return best >= 0 ? 1 : 0;
}

/** a cast's Push / Hold acting on the enemy shots inside a circle, directed away from (ox, oz) */
function shotsInCircle(ctx: SimContext, spec: MoveSpec, x: number, z: number, r: number, ox: number, oz: number) {
  const push = pushPower(spec), hold = holdPower(spec);
  if (!push && !hold) return;
  forceOnShots(ctx, push, hold, spec.element, TEAM.player, spec.name, currentCastSlot(),
    (px, pz, pr) => (px - x) ** 2 + (pz - z) ** 2 <= (r + pr) ** 2,
    (px, pz) => [px - ox, pz - oz]);
}

function spawnProjectile(ctx: SimContext, kind: number, spec: MoveSpec, x: number, z: number, dirx: number, dirz: number, slotIndex: number) {
  const Pr = ctx.projectiles;
  const i = Pr.spawn();
  if (i < 0) return -1;
  const L = dhypot(dirx, dirz) || 1;
  Pr.kind[i] = kind;
  Pr.x[i] = x; Pr.z[i] = z; Pr.y[i] = ctx.player.y + 0.8;
  Pr.ox[i] = x; Pr.oz[i] = z;
  Pr.vx[i] = (dirx / L) * spec.speed; Pr.vz[i] = (dirz / L) * spec.speed;
  Pr.speed[i] = spec.speed;
  Pr.life[i] = Pr.maxLife[i] = spec.speed > 0 ? (spec.range / spec.speed) * 1.25 + 0.2 : 1;
  Pr.dmg[i] = spec.dmg; Pr.radius[i] = spec.radius; Pr.pierce[i] = spec.pierce;
  Pr.element[i] = ELEMENTS.indexOf(spec.element);
  Pr.ailment[i] = ailmentIndex(spec.ailment); Pr.chance[i] = spec.ailmentChance; Pr.knock[i] = spec.knock;
  Pr.drain[i] = spec.drain; Pr.cls[i] = spec.cls === 'physical' ? 0 : 1; Pr.move[i] = slotIndex;
  // Phase 8a profile: the shot as a light body, carrying its move's Push and Hold Power
  Pr.weight[i] = shotWeight(kind === PK.lob, spec.radius, ctx.rules.caps.heavyShotRadius);
  Pr.pushP[i] = pushPower(spec); Pr.holdP[i] = holdPower(spec);
  // Phase 8b: transforms and techniques the shot carries
  if (spec.coatDepth || castDepth === 0) Pr.depth[i] = effDepth(spec);
  if (spec.landHeat) { Pr.fx[i] = 1; Pr.fxR[i] = spec.landHeat; } else if (spec.bramble) { Pr.fx[i] = 2; Pr.fxR[i] = spec.bramble; }
  Pr.extra[i] = castExtra;
  return i;
}

/** Phase 2B: a linear 3D shot (Pr.traj 1) from the spatial aim's muzzle along the unit (ux, uy, uz): the legacy shot's
 *  fields, then its own launch point, 3D velocity and reach (sim/effects.ts flies it; nothing reads the shooter again) */
function spawnShot3D(ctx: SimContext, spec: MoveSpec, ux: number, uy: number, uz: number, slotIndex: number) {
  const i = spawnProjectile(ctx, PK.straight, spec, A3.ox, A3.oz, ux, uz, slotIndex);
  if (i < 0) return -1;
  const Pr = ctx.projectiles, reach = shotReach(ctx, spec);
  Pr.traj[i] = 1;
  Pr.y[i] = A3.oy; Pr.oy[i] = A3.oy;
  Pr.vx[i] = ux * spec.speed; Pr.vy[i] = uy * spec.speed; Pr.vz[i] = uz * spec.speed;
  Pr.rem[i] = reach;
  Pr.life[i] = Pr.maxLife[i] = spec.speed > 0 ? reach / spec.speed : 1;
  return i;
}

function spawnZone(ctx: SimContext, kind: number, spec: MoveSpec, x: number, z: number, r: number, life: number, slotIndex: number) {
  const Z = ctx.zones;
  const i = Z.spawn();
  if (i < 0) return -1;
  Z.kind[i] = kind; Z.x[i] = x; Z.z[i] = z; Z.radius[i] = r;
  Z.life[i] = Z.maxLife[i] = life; Z.tick[i] = spec.tick; Z.tickT[i] = 0;
  Z.dmg[i] = spec.dmg; Z.element[i] = ELEMENTS.indexOf(spec.element);
  Z.ailment[i] = ailmentIndex(spec.ailment); Z.chance[i] = spec.ailmentChance; Z.knock[i] = spec.knock;
  Z.cls[i] = spec.cls === 'physical' ? 0 : 1; Z.move[i] = slotIndex;
  Z.pushP[i] = pushPower(spec); Z.holdP[i] = holdPower(spec);
  if (spec.coatDepth || castDepth === 0) Z.depth[i] = effDepth(spec);
  Z.extra[i] = castExtra;
  return i;
}

// ------------------------------------------------------------------ aim
// Every cast reads one resolved aim: a direction, a point and (optionally) a target enemy.
// Aimed mode: the player's aim, bent toward an enemy close to the aim line (magnetism).
// Assist/auto, or no aim input (bot, idle stick): the nearest enemy, as the original game did.
// Phase 3: `lead` = shots and lobs may lead the target (false under a device policy without lead); `assist` = the enemy a
// device policy (rules.aim.assist) bent this cast's aim to, else -1 (named in the cast event so the HUD can show it)
interface Aim { manual: boolean; t: number; ux: number; uz: number; px: number; pz: number; lead: boolean; assist: number }
const AIM: Aim = { manual: false, t: -1, ux: 0, uz: 1, px: 0, pz: 0, lead: true, assist: -1 };
/** Phase 2B: the spatial aim of the cast being resolved (sim/aim.ts); A3.on only while that cast is on the spatial path */
const A3 = freshAimState();
const MELEE = new Set(['strike', 'cone', 'spin', 'dash', 'aura', 'nova']);
/** button bit for each move slot: slot 0 is the basic attack (primary fire; automatic only in 'auto' mode) */
const SLOT_BTN = [BTN.basic, BTN.a, BTN.b, BTN.sig];

/** the point the last resolved aim landed on (the Tag Action's target) */
export function aimPoint(): [number, number] { return [AIM.px, AIM.pz]; }

/** true when the input carries a usable aim point (not on top of the player) */
function hasAim(ctx: SimContext): boolean {
  const inp = ctx.input, P = ctx.player;
  if (inp.aimX === undefined || inp.aimZ === undefined) return false;
  const dx = inp.aimX - P.x, dz = inp.aimZ - P.z;
  return dx * dx + dz * dz > 0.25;
}

/** the player's aim direction, or the first non-zero fallback vector, or the facing */
export function aimDir(ctx: SimContext, fx = 0, fz = 0, gx = 0, gz = 0): [number, number] {
  const inp = ctx.input, P = ctx.player;
  if (hasAim(ctx)) { const dx = inp.aimX! - P.x, dz = inp.aimZ! - P.z, L = dhypot(dx, dz); return [dx / L, dz / L]; }
  let L = dhypot(fx, fz);
  if (L > 1e-6) return [fx / L, fz / L];
  L = dhypot(gx, gz);
  if (L > 1e-6) return [gx / L, gz / L];
  return [dsin(P.facing), dcos(P.facing)];
}

/** nearest live enemy to a point (not the player) within r */
function nearPoint(ctx: SimContext, x: number, z: number, r: number): number {
  return nearestEnemy(ctx, x, z, r);
}

function setAimAt(ctx: SimContext, e: number) {
  const P = ctx.player, E = ctx.enemies;
  const dx = E.x[e] - P.x, dz = E.z[e] - P.z, L = dhypot(dx, dz) || 1;
  AIM.t = e; AIM.ux = dx / L; AIM.uz = dz / L; AIM.px = E.x[e]; AIM.pz = E.z[e];
}

/** whether the basic attack / automatic moves use the player's aim */
function aimedFor(ctx: SimContext, basic: boolean): boolean {
  const mode = ctx.rules.combat.mode;
  if (mode === 'auto' || !hasAim(ctx)) return false;
  return !(basic && mode === 'assist');
}

/** Resolve the aim for one cast. Returns false when an automatic cast has nothing to aim at. */
export function resolveAim(ctx: SimContext, s: MoveSpec, manual: boolean, basic: boolean): boolean {
  const P = ctx.player, E = ctx.enemies, C = ctx.rules.combat;
  const reach = Math.max(s.range, 3) + 1;
  AIM.manual = manual; AIM.lead = true; AIM.assist = -1;
  // Phase 2B: a direct shot aimed through the chase camera: the sim's own trace of the crosshair ray, no magnetism
  A3.on = false;
  if (spatialFor(ctx, s, manual, basic) && resolveSpatial(ctx, s, A3)) {
    launchHeading(ctx, A3.ux, A3.uz);
    AIM.t = A3.hitKind === SK.enemy ? A3.hitId : -1;
    AIM.ux = HEAD.x; AIM.uz = HEAD.z;
    AIM.px = A3.tx; AIM.pz = A3.tz;
    return true;
  }
  if (!aimedFor(ctx, basic)) {
    const t = nearestEnemy(ctx, P.x, P.z, reach);
    if (t >= 0) { setAimAt(ctx, t); return true; }
    if (!manual) return false;
    AIM.t = -1; AIM.ux = dsin(P.facing); AIM.uz = dcos(P.facing);
    AIM.px = P.x + AIM.ux * reach * 0.6; AIM.pz = P.z + AIM.uz * reach * 0.6;
    return true;
  }
  const [ux, uz] = aimDir(ctx);
  // magnetism: the enemy closest to the aim line, within the cone or within its own width of the line. Phase 3: input
  // that names its aiming device takes that device's policy (rules.aim.assist): a 0° cone is no magnetism at all (the
  // mouse by default), and `los` admits only enemies the partner can see. Input without a device keeps the legacy cone
  const dev = ctx.rules.aim.deviceAssist ? ctx.input.aimDev : undefined, pol = dev ? ctx.rules.aim.assist[dev] : undefined;
  const melee = MELEE.has(s.archetype);
  const deg = pol ? (melee ? pol.meleeDeg : pol.shotDeg) : melee ? C.meleeMagnetDeg : C.magnetDeg;
  if (pol) AIM.lead = pol.lead;
  let best = -1;
  if (!pol || deg > 0) {
    const cosMax = dcos((deg * Math.PI) / 180);
    const n = ctx.grid.query(P.x, P.z, reach + 2);
    let bestScore = -Infinity;
    for (let k = 0; k < n; k++) {
      const e = ctx.grid.result[k];
      if (!E.alive[e] || E.spawnT[e] < 0.25) continue;
      const dx = E.x[e] - P.x, dz = E.z[e] - P.z, d = dhypot(dx, dz) || 1e-3;
      if (d > reach + E.radius[e]) continue;
      const along = (dx * ux + dz * uz) / d;
      const perp = Math.abs(dx * uz - dz * ux);
      if (along <= 0 || (along < cosMax && perp > E.radius[e] + 0.6)) continue;
      const score = along - d * 0.002;
      if (score > bestScore && (!pol?.los || assistSees(ctx, s, e))) { bestScore = score; best = e; }
    }
  }
  if (best >= 0) { setAimAt(ctx, best); if (pol) AIM.assist = best; return true; }
  AIM.t = -1; AIM.ux = ux; AIM.uz = uz;
  const ax = ctx.input.aimX! - P.x, az = ctx.input.aimZ! - P.z, al = Math.min(dhypot(ax, az), reach);
  AIM.px = P.x + ux * al; AIM.pz = P.z + uz * al;
  return true;
}

// ------------------------------------------------------------------ archetypes
interface Archetype {
  /** return true when the move fired (cooldown restarts) */
  cast(ctx: SimContext, spec: MoveSpec, slot: number): boolean;
}

const P = (ctx: SimContext) => ctx.player;
const face = (ctx: SimContext) => { ctx.player.facing = datan2(AIM.ux, AIM.uz); };
const castEv = (ctx: SimContext, s: MoveSpec, tx = AIM.px, tz = AIM.pz) => {
  const p = ctx.player;
  ctx.events.push({ t: 'cast', archetype: s.archetype, element: s.element, x: p.x, z: p.z, tx, tz, key: s.key, ...(AIM.assist >= 0 ? { assist: AIM.assist } : {}) });
};
/** target for a cast that needs one: the aimed enemy, else the enemy nearest the aim point */
function needTarget(ctx: SimContext, s: MoveSpec, around = 5): number {
  if (AIM.t >= 0) return AIM.t;
  if (!AIM.manual) return -1;
  const t = nearPoint(ctx, AIM.px, AIM.pz, around);
  if (t < 0) return -1;
  const p = P(ctx), E = ctx.enemies;
  if (dhypot(E.x[t] - p.x, E.z[t] - p.z) > s.range + 3) return -1;
  return t;
}

const TRAIL_CAPS = [{ verb: 'hit' as const }, { verb: 'apply' as const, agent: 'heat' as const, depth: 2 as const }];

export const ARCHETYPES: Record<string, Archetype> = {
  strike: {
    cast(ctx, s) {
      const p = P(ctx), E = ctx.enemies;
      let tx: number, tz: number;
      const t = AIM.t;
      if (t >= 0 && dhypot(E.x[t] - p.x, E.z[t] - p.z) <= s.range + 1 + E.radius[t]) {
        tx = (p.x + E.x[t]) / 2 + (E.x[t] - p.x) * 0.25; tz = (p.z + E.z[t]) / 2 + (E.z[t] - p.z) * 0.25;
      } else if (AIM.manual || t >= 0) {
        tx = p.x + AIM.ux * s.range * 0.6; tz = p.z + AIM.uz * s.range * 0.6;
      } else return false;
      if (s.single) single(ctx, tx, tz, s.radius, s, s.dmg); else aoe(ctx, tx, tz, s.radius, s, s.dmg, false);
      face(ctx);
      castEv(ctx, s, tx, tz);
      return true;
    },
  },
  dash: {
    cast(ctx, s, slot) {
      const p = P(ctx), W = worldOf(ctx);
      if (AIM.t < 0 && !AIM.manual) return false;
      p.dashT = s.duration; p.dashDx = AIM.ux; p.dashDz = AIM.uz; p.reflexDash = false;
      face(ctx);
      const z = spawnZone(ctx, ZK.dashHit, s, p.x, p.z, s.radius, s.duration + 0.05, slot);
      if (z >= 0) { ctx.zones.attach[z] = 1; ctx.zones.tick[z] = 0.08; ctx.zones.dmg[z] = s.dmg / 2.2; }
      // Wheel Trail (Phase 8b): burning ground along the first metres of the dash
      if (s.trailHeat) {
        const tr: MoveSpec = { ...s, dmg: s.dmg * 0.12, tick: 0.4, knock: 0, caps: TRAIL_CAPS, trailHeat: undefined };
        for (let d = 1; d <= s.trailHeat; d++) {
          const x = p.x + AIM.ux * d, zz = p.z + AIM.uz * d;
          if (!W.walkableAt(x, GROUND, zz)) break;
          spawnZone(ctx, ZK.damage, tr, x, zz, 1.0, 3, slot);
          applyAgent(ctx, 'heat', x, zz, 0.9);
        }
      }
      castEv(ctx, s);
      return true;
    },
  },
  homing: {
    cast(ctx, s, slot) {
      const p = P(ctx);
      const t = needTarget(ctx, s);
      if (t < 0 && !AIM.manual) return false;
      face(ctx);
      for (let k = 0; k < s.count; k++) {
        // with a target the shots fan out behind and curl in; without one they fly along the aim
        const off = (k - (s.count - 1) / 2);
        const a = t >= 0 ? p.facing + off * 0.7 + Math.PI : p.facing + off * 0.25;
        const i = t >= 0 ? spawnProjectile(ctx, PK.homing, s, p.x, p.z, -dsin(a), -dcos(a), slot) : spawnProjectile(ctx, PK.homing, s, p.x, p.z, dsin(a), dcos(a), slot);
        if (i >= 0) ctx.projectiles.target[i] = t;
      }
      castEv(ctx, s);
      return true;
    },
  },
  orb: { cast: (ctx, s, slot) => straight(ctx, s, slot, 0.18) },
  bolt: { cast: (ctx, s, slot) => straight(ctx, s, slot, 0.12) },
  drain: {
    cast(ctx, s, slot) {
      const p = P(ctx), E = ctx.enemies;
      const t = needTarget(ctx, s);
      if (t < 0 && !AIM.manual) return false;
      for (let k = 0; k < s.count; k++) {
        const dx = t >= 0 ? E.x[t] - p.x : AIM.ux, dz = t >= 0 ? E.z[t] - p.z : AIM.uz;
        const i = spawnProjectile(ctx, PK.homing, s, p.x, p.z, dx + (k - (s.count - 1) / 2) * (t >= 0 ? 1 : 0.2), dz, slot);
        if (i >= 0) ctx.projectiles.target[i] = t;
      }
      castEv(ctx, s);
      return true;
    },
  },
  barrage: {
    cast(ctx, s, slot) {
      const p = P(ctx);
      if (AIM.t < 0 && !AIM.manual) return false;
      const base = datan2(AIM.ux, AIM.uz);
      for (let k = 0; k < s.count; k++) {
        const a = base + ctx.rng.combat.range(-0.22, 0.22);
        const i = spawnProjectile(ctx, PK.straight, s, p.x, p.z, dsin(a), dcos(a), slot);
        if (i >= 0) {
          // stagger: start slightly behind so the volley streams out
          ctx.projectiles.x[i] -= dsin(a) * k * 0.9;
          ctx.projectiles.z[i] -= dcos(a) * k * 0.9;
          ctx.projectiles.life[i] += k * 0.04;
        }
      }
      p.facing = base;
      castEv(ctx, s);
      return true;
    },
  },
  lob: {
    cast(ctx, s, slot) {
      const p = P(ctx), E = ctx.enemies;
      const t = AIM.t;
      if (t < 0 && !AIM.manual) return false;
      const ld = AIM.lead ? 0.5 : 0;
      const cx = t >= 0 ? E.x[t] + E.vx[t] * ld : AIM.px, cz = t >= 0 ? E.z[t] + E.vz[t] * ld : AIM.pz;
      for (let k = 0; k < s.count; k++) {
        const tx = cx + (k ? ctx.rng.combat.range(-3, 3) : 0), tz = cz + (k ? ctx.rng.combat.range(-3, 3) : 0);
        const dx = tx - p.x, dz = tz - p.z, d = dhypot(dx, dz);
        const flight = clamp(d / s.speed, 0.45, 1.2);
        const i = spawnProjectile(ctx, PK.lob, s, p.x, p.z, dx, dz, slot);
        if (i < 0) continue;
        const Pr = ctx.projectiles;
        Pr.vx[i] = dx / flight; Pr.vz[i] = dz / flight;
        Pr.life[i] = Pr.maxLife[i] = flight;
        Pr.ax[i] = tx; Pr.az[i] = tz; Pr.aoe[i] = s.radius; Pr.pierce[i] = -1;
      }
      face(ctx);
      castEv(ctx, s, cx, cz);
      return true;
    },
  },
  boomerang: {
    cast(ctx, s, slot) {
      const p = P(ctx);
      if (AIM.t < 0 && !AIM.manual) return false;
      const base = datan2(AIM.ux, AIM.uz);
      for (let k = 0; k < s.count; k++) {
        const a = base + (k - (s.count - 1) / 2) * 0.5;
        const i = spawnProjectile(ctx, PK.boomerang, s, p.x, p.z, dsin(a), dcos(a), slot);
        if (i >= 0) ctx.projectiles.life[i] = ctx.projectiles.maxLife[i] = (2 * s.range) / s.speed + 1.5;
      }
      p.facing = base;
      castEv(ctx, s);
      return true;
    },
  },
  beam: {
    cast(ctx, s) {
      const p = P(ctx), E = ctx.enemies;
      if (AIM.t < 0 && !AIM.manual) return false;
      if (A3.on) return beam3D(ctx, s);
      const ux = AIM.ux, uz = AIM.uz;
      const len = s.range * ctx.player.derived.area;
      const n = enemiesInRadius(ctx, p.x + ux * len * 0.5, p.z + uz * len * 0.5, len * 0.5 + 1);
      for (let k = 0; k < n; k++) {
        const e = scratch[k];
        const ex = E.x[e] - p.x, ez = E.z[e] - p.z;
        const along = ex * ux + ez * uz;
        if (along < 0 || along > len) continue;
        const perp = Math.abs(ex * uz - ez * ux);
        if (perp > s.radius + E.radius[e]) continue;
        damageEnemy(ctx, e, s.dmg, dspec(s, ux, uz));
      }
      eachBodyIn(ctx, p.x + ux * len * 0.5, p.z + uz * len * 0.5, len * 0.5 + 1, (b) => {
        const B = ctx.bodies, bx = B.x[b] - p.x, bz = B.z[b] - p.z, along = bx * ux + bz * uz;
        if (along >= 0 && along <= len && Math.abs(bx * uz - bz * ux) <= s.radius + 1) moveOnBody(ctx, b, s, s.dmg, ux, uz);
      });
      forceOnShots(ctx, pushPower(s), holdPower(s), s.element, TEAM.player, s.name, currentCastSlot(), (x, z, r) => {
        const bx = x - p.x, bz = z - p.z, along = bx * ux + bz * uz;
        return along >= 0 && along <= len && Math.abs(bx * uz - bz * ux) <= s.radius + r;
      }, () => [ux, uz]);
      { const ag = agentOf(s.element); if (ag) for (let d = 1; d <= len; d += 1.5) applyAgent(ctx, ag, p.x + ux * d, p.z + uz * d, Math.max(0.6, s.radius)); }
      p.facing = datan2(ux, uz);
      ctx.events.push({ t: 'beam', x1: p.x, z1: p.z, x2: p.x + ux * len, z2: p.z + uz * len, width: s.radius, element: s.element, life: s.duration });
      castEv(ctx, s, p.x + ux * len, p.z + uz * len);
      return true;
    },
  },
  chain: {
    cast(ctx, s) {
      const p = P(ctx);
      let t = needTarget(ctx, s);
      if (t < 0) return false;
      const E = ctx.enemies;
      const pts = [p.x, p.z];
      let dmg = s.dmg;
      const hit: number[] = [];
      let lx = p.x, lz = p.z;
      for (let j = 0; j < s.count && t >= 0; j++) {
        pts.push(E.x[t], E.z[t]);
        hit.push(t);
        const ex = E.x[t], ez = E.z[t];
        damageEnemy(ctx, t, dmg, dspec(s, ex - lx, ez - lz));
        lx = ex; lz = ez;
        dmg *= 0.85;
        // next: nearest not yet hit within radius
        const n = ctx.grid.query(ex, ez, s.radius);
        let best = -1, bd = s.radius * s.radius;
        for (let k = 0; k < n; k++) {
          const e = ctx.grid.result[k];
          if (!E.alive[e] || hit.includes(e)) continue;
          const d = (E.x[e] - ex) ** 2 + (E.z[e] - ez) ** 2;
          if (d < bd) { bd = d; best = e; }
        }
        t = best;
      }
      ctx.events.push({ t: 'chain', pts, element: s.element });
      castEv(ctx, s, pts[2], pts[3]);
      return true;
    },
  },
  vortex: {
    cast(ctx, s, slot) {
      if (AIM.t < 0 && !AIM.manual) return false;
      const E = ctx.enemies;
      const x = AIM.t >= 0 ? E.x[AIM.t] : AIM.px, z = AIM.t >= 0 ? E.z[AIM.t] : AIM.pz;
      const zi = spawnZone(ctx, ZK.damage, s, x, z, s.radius, s.duration, slot);
      if (zi >= 0) ctx.zones.pull[zi] = 6;
      face(ctx);
      castEv(ctx, s, x, z);
      return true;
    },
  },
  trap: {
    cast(ctx, s, slot) {
      if (AIM.t < 0 && !AIM.manual) return false;
      const E = ctx.enemies;
      const x = AIM.t >= 0 ? E.x[AIM.t] : AIM.px, z = AIM.t >= 0 ? E.z[AIM.t] : AIM.pz;
      spawnZone(ctx, ZK.root, s, x, z, s.radius, s.duration, slot);
      face(ctx);
      castEv(ctx, s, x, z);
      return true;
    },
  },
  nova: {
    cast(ctx, s) {
      const p = P(ctx);
      if (!AIM.manual && nearestEnemy(ctx, p.x, p.z, s.radius * 0.9) < 0) return false;
      aoe(ctx, p.x, p.z, s.radius, s, s.dmg);
      ctx.events.push({ t: 'ring', x: p.x, z: p.z, r: s.radius, element: s.element, life: 0.45 });
      ctx.events.push({ t: 'shake', amount: ctx.rules.feel.shakeNova, x: p.x, z: p.z });
      castEv(ctx, s, p.x, p.z);
      return true;
    },
  },
  spin: {
    cast(ctx, s, slot) {
      const p = P(ctx);
      if (!AIM.manual && nearestEnemy(ctx, p.x, p.z, s.radius + 2) < 0) return false;
      const z = spawnZone(ctx, ZK.damage, s, p.x, p.z, s.radius, s.duration, slot);
      if (z >= 0) ctx.zones.attach[z] = 1;
      castEv(ctx, s, p.x, p.z);
      return true;
    },
  },
  cone: {
    cast(ctx, s) {
      const p = P(ctx), E = ctx.enemies;
      if (AIM.t < 0 && !AIM.manual) return false;
      const a0 = datan2(AIM.ux, AIM.uz);
      const len = s.range * ctx.player.derived.area;
      const n = enemiesInRadius(ctx, p.x, p.z, len);
      for (let k = 0; k < n; k++) {
        const e = scratch[k];
        const a = datan2(E.x[e] - p.x, E.z[e] - p.z);
        let d = Math.abs(a - a0);
        if (d > Math.PI) d = Math.PI * 2 - d;
        if (d > s.radius) continue;
        damageEnemy(ctx, e, s.dmg, dspec(s, E.x[e] - p.x, E.z[e] - p.z));
      }
      eachBodyIn(ctx, p.x, p.z, len, (b) => {
        const B = ctx.bodies;
        let d = Math.abs(datan2(B.x[b] - p.x, B.z[b] - p.z) - a0);
        if (d > Math.PI) d = Math.PI * 2 - d;
        if (d <= s.radius + 0.2) moveOnBody(ctx, b, s, s.dmg, B.x[b] - p.x, B.z[b] - p.z);
      });
      forceOnShots(ctx, pushPower(s), holdPower(s), s.element, TEAM.player, s.name, currentCastSlot(), (x, z, r) => {
        if ((x - p.x) ** 2 + (z - p.z) ** 2 > (len + r) ** 2) return false;
        let d = Math.abs(datan2(x - p.x, z - p.z) - a0);
        if (d > Math.PI) d = Math.PI * 2 - d;
        return d <= s.radius + 0.2;
      }, (x, z) => [x - p.x, z - p.z]);
      { const ag = agentOf(s.element); if (ag) for (let d = 1.5; d <= len; d += 1.5) applyAgent(ctx, ag, p.x + dsin(a0) * d, p.z + dcos(a0) * d, d * Math.tan(Math.min(0.9, s.radius)) * 0.8); }
      p.facing = a0;
      castEv(ctx, s, p.x + dsin(a0) * len, p.z + dcos(a0) * len);
      return true;
    },
  },
  aura: {
    cast(ctx, s) {
      const p = P(ctx);
      const n = aoe(ctx, p.x, p.z, s.radius, s, s.dmg);
      if (n === 0 && !AIM.manual) return false;
      castEv(ctx, s, p.x, p.z);
      return true;
    },
  },
  orbit: {
    cast(ctx, s, slot) {
      const p = P(ctx);
      if (!AIM.manual && nearestEnemy(ctx, p.x, p.z, 12) < 0) return false;
      for (let k = 0; k < s.count; k++) {
        const i = spawnProjectile(ctx, PK.orbit, s, p.x, p.z, 1, 0, slot);
        if (i < 0) continue;
        const Pr = ctx.projectiles;
        Pr.ax[i] = (k / s.count) * Math.PI * 2;
        Pr.life[i] = Pr.maxLife[i] = s.duration;
        Pr.aoe[i] = s.radius; // orbit radius
        Pr.radius[i] = 0.8;
        Pr.pierce[i] = -1;
      }
      castEv(ctx, s, p.x, p.z);
      return true;
    },
  },
  trail: {
    cast(ctx, s, slot) {
      const p = P(ctx);
      if (!AIM.manual && nearestEnemy(ctx, p.x, p.z, 14) < 0) return false;
      p.trailT = s.count * 0.25;
      p.trailSpec = s;
      p.trailAcc = 0;
      p.trailLevel = slot;
      castEv(ctx, s, p.x, p.z);
      return true;
    },
  },
  meteor: {
    cast(ctx, s, slot) {
      const p = P(ctx), E = ctx.enemies;
      let fired = 0;
      if (AIM.manual) {
        // aimed: the first meteor lands on the aim point (or the enemy there), the rest scatter around it
        const ld = AIM.lead ? 0.4 : 0;
        const cx = AIM.t >= 0 ? E.x[AIM.t] + E.vx[AIM.t] * ld : AIM.px, cz = AIM.t >= 0 ? E.z[AIM.t] + E.vz[AIM.t] * ld : AIM.pz;
        for (let c = 0; c < s.count; c++) {
          const ox = c ? ctx.rng.combat.range(-3, 3) : 0, oz = c ? ctx.rng.combat.range(-3, 3) : 0;
          const z = spawnZone(ctx, ZK.meteor, s, cx + ox, cz + oz, s.radius, s.duration, slot);
          if (z >= 0) { ctx.zones.delay[z] = s.duration; ctx.events.push({ t: 'telegraph', x: ctx.zones.x[z], z: ctx.zones.z[z], r: s.radius, life: s.duration, hostile: false }); fired++; }
        }
      } else {
        const n = ctx.grid.query(p.x, p.z, s.range);
        if (n === 0) return false;
        for (let c = 0; c < s.count; c++) {
          const e = ctx.grid.result[ctx.rng.combat.int(0, n - 1)];
          if (!E.alive[e]) continue;
          const z = spawnZone(ctx, ZK.meteor, s, E.x[e] + E.vx[e] * 0.4, E.z[e] + E.vz[e] * 0.4, s.radius, s.duration, slot);
          if (z >= 0) { ctx.zones.delay[z] = s.duration; ctx.events.push({ t: 'telegraph', x: ctx.zones.x[z], z: ctx.zones.z[z], r: s.radius, life: s.duration, hostile: false }); fired++; }
        }
      }
      if (!fired) return false;
      castEv(ctx, s);
      return true;
    },
  },
  smite: {
    cast(ctx, s) {
      const p = P(ctx), E = ctx.enemies;
      // the toughest enemy in reach (aimed: near the aim point)
      const cx = AIM.manual ? AIM.px : p.x, cz = AIM.manual ? AIM.pz : p.z;
      const n = ctx.grid.query(cx, cz, AIM.manual ? 7 : s.range);
      let best = -1, bh = 0;
      for (let k = 0; k < n; k++) {
        const e = ctx.grid.result[k];
        if (!E.alive[e]) continue;
        if (E.hp[e] > bh) { bh = E.hp[e]; best = e; }
      }
      if (best < 0) return false;
      const x = E.x[best], z = E.z[best];
      aoe(ctx, x, z, s.radius, s, s.dmg);
      ctx.events.push({ t: 'smite', x, z, element: s.element });
      castEv(ctx, s, x, z);
      return true;
    },
  },
  buff: {
    cast(ctx, s) {
      const p = P(ctx);
      if (!AIM.manual && nearestEnemy(ctx, p.x, p.z, 16) < 0) return false;
      p.buffT = s.duration; p.buffAtk = 0.3; p.buffSpe = 0.2;
      castEv(ctx, s, p.x, p.z);
      return true;
    },
  },
  weather: {
    cast(ctx, s) {
      ctx.weather.element = s.element;
      ctx.weather.t = s.duration;
      const p = P(ctx);
      castEv(ctx, s, p.x, p.z);
      return true;
    },
  },
};

// ------------------------------------------------------------------ Phase 2C: the spatial beam
// docs/THIRD_PERSON_IMPLEMENTATION.md §14. A beam on the spatial path is one core line from the muzzle M along the
// resolved aim direction u (sim/aim.ts: M toward the crosshair point T), out to its length (range × area):
//   1. the core against the world: the first solid it enters (wall column, terrain, deck slab, liquid surface, map
//      bounds; foliage by combatFlags) ends it there, with rules.aim.beamWorldRadius as its radius (0: a line)
//   2. the width against bodies: enemies and rocks whose cylinder the beam's volume (radius = the move's radius, as
//      wide vertically) meets before that end, in contact order; one is touched only when the core can see it (the
//      segment from the core's closest point to the body's nearest point is clear), so the width never reaches around a
//      corner or through a slab beside the line
//   3. penetration: the move's pierce (−1: every body on the line, as every beam is authored); a pierce ≥ 0 ends the
//      beam on the body that uses it up
// What is drawn is what hit: the beam event runs from M to the end in 3D, and every body damaged lies inside that
// band. The ground agents, a Push or Hold on enemy shots and the knockback stay planar (under the clipped beam, along
// its heading), as for the direct shots.
/** the beam's contacts: room for every enemy and body in the pools (beamContacts), so the list never truncates and drops a
 *  far body the beam reaches (a 15 m beam through a 500-enemy Mt. Moon crowd met 323) */
let BEAMC = new Contacts(64);
function beamContacts(ctx: SimContext): Contacts {
  const need = ctx.enemies.cap + ctx.bodies.cap;
  if (BEAMC.cap < need) BEAMC = new Contacts(need);
  return BEAMC;
}
/** enemies in their spawn guard included: the planar beam (like every area) hits them too, unlike a shot */
const BEAMQ = spatialQuery({ mask: SK.enemy | SK.body, block: SK.enemy | SK.body, pierce: Infinity, selfKind: SK.player, selfId: 0, flags: QF.spawning });
const BEAMW = new RayHit();

/** can the beam's core (from M along u, up to `end`) see actor (kind, id)? The core's closest point to the actor's
 *  centre, then the actor cylinder's nearest point to that: the open segment between them must be clear */
function coreSees(ctx: SimContext, mx: number, my: number, mz: number, ux: number, uy: number, uz: number, end: number, kind: number, id: number, cf: number): boolean {
  const W = worldOf(ctx);
  let ax: number, az: number, yb: number, yt: number, r: number;
  if (kind === SK.enemy) { const E = ctx.enemies; ax = E.x[id]; az = E.z[id]; yb = E.y[id]; yt = yb + E.tall[id]; r = E.radius[id]; }
  else { const B = ctx.bodies; r = tpl(ctx, id).radius; ax = B.x[id]; az = B.z[id]; yb = B.y[id]; yt = yb + 2 * r; }
  const lim = end > 1e-4 ? end - 1e-4 : 0;
  let t = (ax - mx) * ux + ((yb + yt) / 2 - my) * uy + (az - mz) * uz;
  t = t < 0 ? 0 : t > lim ? lim : t;
  const qx = mx + ux * t, qy = my + uy * t, qz = mz + uz * t;
  const hx = qx - ax, hz = qz - az, hl = Math.sqrt(hx * hx + hz * hz);
  const px = hl > r ? ax + (hx / hl) * r : qx, pz = hl > r ? az + (hz / hl) * r : qz, py = qy < yb ? yb : qy > yt ? yt : qy;
  return W.segmentClear(qx, qy, qz, px, py, pz, MASK.los, cf);
}

function beam3D(ctx: SimContext, s: MoveSpec): boolean {
  const p = P(ctx), cf = combatFlags(ctx), W = worldOf(ctx);
  const mx = A3.ox, my = A3.oy, mz = A3.oz, ux = A3.ux, uy = A3.uy, uz = A3.uz;
  launchHeading(ctx, ux, uz);
  const hl = dhypot(ux, uz), hx = HEAD.x, hz = HEAD.z;
  const len = beamLength(ctx, s);
  // 1. the core against the world
  let end = len, why: 'world' | 'actor' | 'range' = 'range', endKind = 0;
  if (W.raycast(mx, my, mz, ux, uy, uz, len, SK_WORLD, BEAMW, ctx.rules.aim.beamWorldRadius, 0, cf)) { end = BEAMW.t; why = 'world'; endKind = BEAMW.kind; }
  // 2-3. the width against bodies, in contact order, up to that end
  BEAMQ.actorR = s.radius; BEAMQ.actorH = s.radius;
  const BC = beamContacts(ctx), n = sweep(ctx, mx, my, mz, ux, uy, uz, end, BEAMQ, BC);
  let pierce = s.pierce < 0 ? Infinity : s.pierce, hits = 0;
  for (let k = 0; k < n; k++) {
    const kind = BC.kind[k], id = BC.id[k];
    if (kind === SK.body && ctx.bodies.holdT[id] > 0) continue; // your own effects pass a body you hold
    if (!coreSees(ctx, mx, my, mz, ux, uy, uz, end, kind, id, cf)) continue;
    if (kind === SK.enemy) damageEnemy(ctx, id, s.dmg, dspec(s, hx, hz));
    else moveOnBody(ctx, id, s, s.dmg, hx, hz);
    hits++;
    if (!(pierce > 0)) { end = BC.t[k]; why = 'actor'; endKind = kind; break; }
    pierce--;
  }
  const ex = mx + ux * end, ey = my + uy * end, ez = mz + uz * end, endH = end * hl;
  // planar side effects, under the clipped beam: enemy shots it crosses, the ground it paints
  forceOnShots(ctx, pushPower(s), holdPower(s), s.element, TEAM.player, s.name, currentCastSlot(), (x, z, r) => {
    const bx = x - mx, bz = z - mz, along = bx * hx + bz * hz;
    return along >= 0 && along <= endH && Math.abs(bx * hz - bz * hx) <= s.radius + r;
  }, () => [hx, hz]);
  { const ag = agentOf(s.element); if (ag) for (let d = 1; d <= endH; d += 1.5) applyAgent(ctx, ag, mx + hx * d, mz + hz * d, Math.max(0.6, s.radius)); }
  p.facing = datan2(hx, hz);
  ctx.events.push({ t: 'beam', x1: mx, z1: mz, x2: ex, z2: ez, y1: my, y2: ey, width: s.radius, element: s.element, life: s.duration, why, kind: endKind, hits });
  ctx.events.push({ t: 'cast', archetype: s.archetype, element: s.element, x: p.x, z: p.z, tx: ex, tz: ez, key: s.key,
    o: { o: [mx, my, mz], t: [A3.tx, A3.ty, A3.tz], kind: A3.hitKind, blocked: A3.blocked } });
  return true;
}

function straight(ctx: SimContext, s: MoveSpec, slot: number, spread: number): boolean {
  const p = P(ctx), E = ctx.enemies;
  const t = AIM.t;
  if (t < 0 && !AIM.manual) return false;
  if (A3.on) {
    // Phase 2B: from the muzzle toward the crosshair point, in 3D. R2 pole-safe aim: a fan turns in the plane
    // perpendicular to the launch direction u, about u's local up: u cos + r sin, r = the horizontal right of u's heading
    // (launchHeading), so each shot is `off` from u at any pitch. Level, this is the Phase 2B fan
    const sp = s.spread ?? spread;
    let rx = 0, rz = 0;
    if (s.count > 1) { launchHeading(ctx, A3.ux, A3.uz); rx = HEAD.z; rz = -HEAD.x; }
    for (let k = 0; k < s.count; k++) {
      const off = (k - (s.count - 1) / 2) * sp;
      if (off === 0) spawnShot3D(ctx, s, A3.ux, A3.uy, A3.uz, slot);
      else { const c = dcos(off), n = dsin(off); spawnShot3D(ctx, s, A3.ux * c + rx * n, A3.uy * c, A3.uz * c + rz * n, slot); }
    }
    p.facing = datan2(AIM.ux, AIM.uz);
    ctx.events.push({ t: 'cast', archetype: s.archetype, element: s.element, x: p.x, z: p.z, tx: A3.tx, tz: A3.tz, key: s.key,
      o: { o: [A3.ox, A3.oy, A3.oz], t: [A3.tx, A3.ty, A3.tz], kind: A3.hitKind, blocked: A3.blocked } });
    return true;
  }
  let base: number;
  if (t >= 0) {
    // lead the target a little
    const dist = dhypot(E.x[t] - p.x, E.z[t] - p.z);
    const lead = AIM.lead ? dist / Math.max(1, s.speed) : 0;
    base = datan2(E.x[t] + E.vx[t] * lead - p.x, E.z[t] + E.vz[t] * lead - p.z);
  } else base = datan2(AIM.ux, AIM.uz);
  const sp = s.spread ?? spread;
  for (let k = 0; k < s.count; k++) {
    const a = base + (k - (s.count - 1) / 2) * sp;
    spawnProjectile(ctx, PK.straight, s, p.x, p.z, dsin(a), dcos(a), slot);
  }
  p.facing = base;
  castEv(ctx, s);
  return true;
}

/** true when slot i is a manual move (button-cast) under the current combat mode */
function isManual(ctx: SimContext, i: number): boolean {
  return i > 0 && ctx.rules.combat.mode !== 'auto';
}

/** true when move slots cast only while their button is held: every slot outside 'auto' mode, including the basic
 *  attack. Unlike isManual this does not make the basic attack a heavier, slower "manual move". */
function needsButton(ctx: SimContext): boolean {
  return ctx.rules.combat.mode !== 'auto';
}

/** the spec slot i casts with now: levelled, and for manual moves a heavier, slower version */
export function slotSpec(ctx: SimContext, i: number): MoveSpec {
  const slot = ctx.player.moves[i];
  const s = levelled(ctx, slot);
  if (!isManual(ctx, i)) return s;
  const C = ctx.rules.combat;
  return { ...s, cd: s.cd * C.manualCdMult, dmg: s.dmg * C.manualDmgMult };
}

export const movesSystem = {
  name: 'moves',
  update(ctx: SimContext, dt: number) {
    const p = ctx.player;
    ctx.aim.on = false;
    if (p.m.fainted) return;
    // while Tag is held, primary and secondary fire (basic attack, Move A) pick a reserve instead of casting
    const raw = ctx.input.btn ?? 0;
    const tagMask = raw & BTN.sig ? ~(BTN.basic | BTN.a | BTN.b) : ~0;
    const btn = raw & tagMask;
    // Phase 3: the presses (rising edges) of this sample; only these can queue a cast (rules.combat.fireBuffer)
    const press = (ctx.input.press ?? 0) & tagMask;
    if (p.paraT > 0) p.paraT -= dt;
    for (let i = 0; i < p.moves.length; i++) {
      const slot = p.moves[i];
      castDepth = i === 0 ? 1 : 2;
      setCastSlot(i);
      // a slot cast by its button (every slot outside 'auto' mode) is player-aimed: it fires along the aim even with
      // no enemy there; an automatic one (or the basic attack under basicNeedsTarget) waits for a target.
      // slotSpec still makes only slots 1-3 heavier and slower.
      const byButton = needsButton(ctx);
      const aimed = byButton && !(i === 0 && ctx.rules.combat.basicNeedsTarget);
      const spec = slotSpec(ctx, i);
      const impl = ARCHETYPES[spec.archetype];
      if (!impl) continue;
      const bit = SLOT_BTN[i] ?? 0;
      // Phase 3 fire buffer: the window (ticks before ready) in which a press queues; a queued press older than twice
      // that (Tag-swapped out, fainted, evolving, a cooldown stretched by Pressure) is stale and dropped
      const win = byButton ? Math.round((ctx.rules.combat.fireBuffer[i] ?? 0) / dt) : 0;
      const pressed = byButton && (press & bit) !== 0;
      if (slot.queued !== undefined && (ctx.tick - slot.queued > 2 * win + 1 || !byButton)) dropQueued(ctx, slot, i, 'expired');
      // Tag held takes primary and secondary fire for the reserve pick: a queued press is cancelled, not deferred
      if (slot.queued !== undefined && (raw & BTN.sig) && bit !== BTN.sig) dropQueued(ctx, slot, i, 'cancel');
      // carrying the Transport egg: only the basic attack (Move A and B wait, still cooling)
      if (ctx.player.carrying && i > 0) {
        if (slot.cd > 0) slot.cd -= dt;
        slot.windup = undefined;
        if (slot.queued !== undefined) dropQueued(ctx, slot, i, 'cancel');
        if (pressed) ctx.events.push({ t: 'fireDropped', slot: i, why: 'cancel', wait: 0 });
        continue;
      }
      if (slot.windup !== undefined && slot.windup > 0) {
        // release on the frame the wind-up ends (the HitFrame of the attack clip), at the aim of that moment
        slot.windup -= dt;
        const w = ctx.rules.feel.windup[spec.archetype] ?? 0;
        if (slot.windup > 0) {
          // a press during the wind-up: ready after the rest of it and the refunded cooldown
          if (pressed) offerQueue(ctx, slot, i, slot.windup + Math.max(0.05, spec.cd - w), win);
          continue;
        }
        slot.windup = 0;
        if (resolveAim(ctx, spec, aimed, i === 0) && fire(ctx, impl, spec, i)) slot.cd = Math.max(0.05, spec.cd - w);
        else slot.cd = 0.1;
        if (pressed) offerQueue(ctx, slot, i, slot.cd, win);
        continue;
      }
      if (slot.cd > 0) slot.cd -= dt;
      if (slot.cd > 0) { if (pressed) offerQueue(ctx, slot, i, slot.cd, win); continue; }
      // button-cast slots wait, ready, until their button is held (holding repeats on cooldown; releasing starts
      // nothing new, though a wind-up already under way still lands) or a buffered press is queued (it casts once)
      const fromQueue = slot.queued !== undefined;
      if (byButton && !(btn & bit) && !fromQueue) { slot.cd = 0; continue; }
      if (!aimed) {
        // automatic casts only when something is in reach; otherwise retry soon
        const reach = Math.max(spec.range, spec.radius * 1.5, 8);
        if (nearestEnemy(ctx, p.x, p.z, reach) < 0) { slot.cd = 0.1; continue; }
      }
      if (!resolveAim(ctx, spec, aimed, i === 0)) { slot.cd = 0.1; continue; }
      // accepted: a queued press is spent by this cast (exactly one per press)
      slot.queued = undefined;
      const w = ctx.rules.feel.windup[spec.archetype] ?? 0;
      if (w <= 0) { if (fire(ctx, impl, spec, i)) slot.cd = spec.cd; else slot.cd = 0.1; continue; }
      slot.windup = w;
      p.aimFacing = datan2(AIM.ux, AIM.uz);
      p.aimT = w + 0.18;
      ctx.events.push({ t: 'windup', archetype: spec.archetype, element: spec.element, slot: i, dur: w, tx: AIM.px, tz: AIM.pz, key: spec.key, ...(fromQueue ? { queued: true } : {}) });
    }
    presentAim(ctx);
    // trail emitter
    if (p.trailT > 0 && p.trailSpec) {
      p.trailT -= dt;
      p.trailAcc -= dt;
      if (p.trailAcc <= 0) {
        p.trailAcc = 0.22;
        const lv = p.moves[p.trailLevel] ? slotSpec(ctx, p.trailLevel) : p.trailSpec;
        spawnZone(ctx, ZK.damage, lv, p.x, p.z, lv.radius, lv.duration, p.trailLevel);
      }
    }
    if (p.buffT > 0) p.buffT -= dt;
    if (ctx.weather.t > 0) { ctx.weather.t -= dt; if (ctx.weather.t <= 0) ctx.weather.element = null; }
  },
};

/** Phase 2B: the spatial aim of the primary direct shot (the basic attack if it is one, else the first such slot), for
 *  the HUD (ctx.aim): what the crosshair rests on, the muzzle, and whether cover stands between. Presentation only */
function presentAim(ctx: SimContext) {
  const p = ctx.player;
  if (!ctx.input.aim || ctx.state !== 'play') return;
  for (let i = 0; i < p.moves.length; i++) {
    const s = slotSpec(ctx, i);
    if (!ctx.rules.aim.archetypes.includes(s.archetype)) continue;
    if (spatialFor(ctx, s, needsButton(ctx) && !(i === 0 && ctx.rules.combat.basicNeedsTarget), i === 0)) resolveSpatial(ctx, s, ctx.aim);
    return;
  }
}

/** Phase 3 fire buffer: a press on slot i, which is `ttr` s of sim time from ready. Within `win` ticks of ready it is
 *  queued (one at most); otherwise it is dropped as early. Every outcome is an event, so no press vanishes silently */
function offerQueue(ctx: SimContext, slot: MoveSlot, i: number, ttr: number, win: number) {
  const wait = Math.max(1, Math.ceil(ttr / ctx.dt - 1e-6));
  if (wait > win) { ctx.events.push({ t: 'fireDropped', slot: i, why: 'early', wait }); return; }
  if (slot.queued !== undefined) { ctx.events.push({ t: 'fireDropped', slot: i, why: 'queued', wait }); return; }
  slot.queued = ctx.tick;
  ctx.events.push({ t: 'fireQueued', slot: i, wait });
}

function dropQueued(ctx: SimContext, slot: MoveSlot, i: number, why: 'cancel' | 'expired') {
  slot.queued = undefined;
  ctx.events.push({ t: 'fireDropped', slot: i, why, wait: 0 });
}

/** cast slot i, then the move's self-root (MoveSpec.selfRoot) */
function fire(ctx: SimContext, impl: Archetype, spec: MoveSpec, i: number): boolean {
  const ok = impl.cast(ctx, spec, i);
  if (!ok) return false;
  if (spec.selfRoot) ctx.player.rootT = Math.max(ctx.player.rootT, spec.selfRoot);
  return true;
}
void AG;

export { healPlayer };
