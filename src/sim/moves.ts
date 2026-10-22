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
import { eachBodyIn, holdPower, moveOnBody, pushPower, TEAM } from './bodies';
import { currentCastSlot, forceOnShots, setCastSlot } from './capabilities';
import { forceOnPropsIn } from './props';
import { shotWeight } from '../rules/capabilities';
import { agentOf, applyAgent } from './cells';
import { BTN, type MoveSlot, type MoveSpec, type SimContext } from './types';
import { TB } from '../rules/build';
import { tech, techSpec } from './techniques';
import { AG } from '../rules/reactions';

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

/** coat depth of the cast in progress: slot 0 (the basic attack) coats light, every other slot deep
 *  (Phase 8b: 0 for the basic attack under Catalyst) */
let castDepth = 1;
export function setCastDepth(d: number) { castDepth = d; }
/** Phase 8b: an extra agent the cast in progress carries (Slipstream's copied coat; 0 none) */
let castExtra = 0;
/** the coat depth a cast applies: the slot's, unless the move always coats light or deep (Scatter, Searing);
 *  a basic attack under Catalyst applies no light coat */
function effDepth(spec: MoveSpec): number {
  if (!spec.coatDepth) return castDepth;
  return castDepth === 0 && spec.coatDepth === 1 ? 0 : spec.coatDepth;
}
export function dspec(spec: MoveSpec, kx: number, kz: number, knock = spec.knock): DamageSpec {
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
  if (ctx.rules.surfaces.enabled) { const pp = pushPower(spec); if (pp) forceOnPropsIn(ctx, x, z, r, pp, dmg, spec.element); }
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
interface Aim { manual: boolean; t: number; ux: number; uz: number; px: number; pz: number }
const AIM: Aim = { manual: false, t: -1, ux: 0, uz: 1, px: 0, pz: 0 };
const MELEE = new Set(['strike', 'cone', 'spin', 'dash', 'aura', 'nova']);
/** button bit for each move slot: slot 0 is the basic attack (autofire) */
export const SLOT_BTN = [0, BTN.a, BTN.b, BTN.sig];

/** the point the last resolved aim landed on (the Tag Action's target) */
export function aimPoint(): [number, number] { return [AIM.px, AIM.pz]; }

/** true when the input carries a usable aim point (not on top of the player) */
export function hasAim(ctx: SimContext): boolean {
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
  AIM.manual = manual;
  if (!aimedFor(ctx, basic)) {
    const t = nearestEnemy(ctx, P.x, P.z, reach);
    if (t >= 0) { setAimAt(ctx, t); return true; }
    if (!manual) return false;
    AIM.t = -1; AIM.ux = dsin(P.facing); AIM.uz = dcos(P.facing);
    AIM.px = P.x + AIM.ux * reach * 0.6; AIM.pz = P.z + AIM.uz * reach * 0.6;
    return true;
  }
  const [ux, uz] = aimDir(ctx);
  // magnetism: the enemy closest to the aim line, within the cone or within its own width of the line
  const cosMax = dcos(((MELEE.has(s.archetype) ? C.meleeMagnetDeg : C.magnetDeg) * Math.PI) / 180);
  const n = ctx.grid.query(P.x, P.z, reach + 2);
  let best = -1, bestScore = -Infinity;
  for (let k = 0; k < n; k++) {
    const e = ctx.grid.result[k];
    if (!E.alive[e] || E.spawnT[e] < 0.25) continue;
    const dx = E.x[e] - P.x, dz = E.z[e] - P.z, d = dhypot(dx, dz) || 1e-3;
    if (d > reach + E.radius[e]) continue;
    const along = (dx * ux + dz * uz) / d;
    const perp = Math.abs(dx * uz - dz * ux);
    if (along <= 0 || (along < cosMax && perp > E.radius[e] + 0.6)) continue;
    const score = along - d * 0.002;
    if (score > bestScore) { bestScore = score; best = e; }
  }
  if (best >= 0) { setAimAt(ctx, best); return true; }
  AIM.t = -1; AIM.ux = ux; AIM.uz = uz;
  const ax = ctx.input.aimX! - P.x, az = ctx.input.aimZ! - P.z, al = Math.min(dhypot(ax, az), reach);
  AIM.px = P.x + ux * al; AIM.pz = P.z + uz * al;
  return true;
}

// ------------------------------------------------------------------ archetypes
export interface Archetype {
  /** return true when the move fired (cooldown restarts) */
  cast(ctx: SimContext, spec: MoveSpec, slot: number): boolean;
}

const P = (ctx: SimContext) => ctx.player;
const face = (ctx: SimContext) => { ctx.player.facing = datan2(AIM.ux, AIM.uz); };
const castEv = (ctx: SimContext, s: MoveSpec, tx = AIM.px, tz = AIM.pz) => {
  const p = ctx.player;
  ctx.events.push({ t: 'cast', archetype: s.archetype, element: s.element, x: p.x, z: p.z, tx, tz, key: s.key });
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
      const p = P(ctx);
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
          if (!ctx.world.walkable(x, zz)) break;
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
      const cx = t >= 0 ? E.x[t] + E.vx[t] * 0.5 : AIM.px, cz = t >= 0 ? E.z[t] + E.vz[t] * 0.5 : AIM.pz;
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
        const cx = AIM.t >= 0 ? E.x[AIM.t] + E.vx[AIM.t] * 0.4 : AIM.px, cz = AIM.t >= 0 ? E.z[AIM.t] + E.vz[AIM.t] * 0.4 : AIM.pz;
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

function straight(ctx: SimContext, s: MoveSpec, slot: number, spread: number): boolean {
  const p = P(ctx), E = ctx.enemies;
  const t = AIM.t;
  if (t < 0 && !AIM.manual) return false;
  let base: number;
  if (t >= 0) {
    // lead the target a little
    const dist = dhypot(E.x[t] - p.x, E.z[t] - p.z);
    const lead = dist / Math.max(1, s.speed);
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

const AB_PRESSURE = ABILITY_IDS.indexOf('pressure') + 1;

/** true when slot i is a manual move (button-cast) under the current combat mode */
export function isManual(ctx: SimContext, i: number): boolean {
  return i > 0 && ctx.rules.combat.mode !== 'auto';
}

/** the spec slot i casts with now: levelled, and for manual moves a heavier, slower version */
export function slotSpec(ctx: SimContext, i: number): MoveSpec {
  const slot = ctx.player.moves[i];
  const s = levelled(ctx, slot);
  if (!isManual(ctx, i)) return techSpec(ctx, s);
  const C = ctx.rules.combat;
  return techSpec(ctx, { ...s, cd: s.cd * C.manualCdMult, dmg: s.dmg * C.manualDmgMult });
}

export const movesSystem = {
  name: 'moves',
  update(ctx: SimContext, dt: number) {
    const p = ctx.player;
    if (p.m.fainted) return;
    // while Tag is held, Move A / Move B pick a reserve instead of casting
    const btn = (ctx.input.btn ?? 0) & ((ctx.input.btn ?? 0) & BTN.sig ? ~(BTN.a | BTN.b) : ~0);
    // Pressure (Articuno): within 12 m, cooldowns recover 15% slower (there is no PP to drain)
    let pressure = 1;
    { const E = ctx.enemies, b = ctx.director.bossIndex; if (b >= 0 && E.alive[b] && E.ability[b] === AB_PRESSURE && dhypot(E.x[b] - p.x, E.z[b] - p.z) < 12) pressure = 0.85; }
    if (p.paraT > 0) p.paraT -= dt;
    const catalyst = tech(ctx, TB.catalyst);
    for (let i = 0; i < p.moves.length; i++) {
      const slot = p.moves[i];
      castDepth = i === 0 ? (catalyst ? 0 : 1) : 2;
      setCastSlot(i);
      const manual = isManual(ctx, i);
      const spec = slotSpec(ctx, i);
      const impl = ARCHETYPES[spec.archetype];
      if (!impl) continue;
      // carrying the Transport egg: only the basic attack (Move A and B wait, still cooling)
      if (ctx.player.carrying && i > 0) { if (slot.cd > 0) slot.cd -= dt * pressure; slot.windup = undefined; continue; }
      if (slot.windup !== undefined && slot.windup > 0) {
        // release on the frame the wind-up ends (the HitFrame of the attack clip), at the aim of that moment
        slot.windup -= dt;
        if (slot.windup > 0) continue;
        const w = ctx.rules.feel.windup[spec.archetype] ?? 0;
        slot.windup = 0;
        if (resolveAim(ctx, spec, manual, i === 0) && fire(ctx, impl, spec, i)) slot.cd = Math.max(0.05, spec.cd - w);
        else slot.cd = 0.1;
        continue;
      }
      if (slot.cd > 0) slot.cd -= dt * pressure;
      if (slot.cd > 0) continue;
      // manual moves wait, ready, until their button is held (holding repeats on cooldown)
      if (manual && !(btn & (SLOT_BTN[i] ?? 0))) { slot.cd = 0; continue; }
      if (!manual) {
        // automatic casts only when something is in reach; otherwise retry soon
        const reach = Math.max(spec.range, spec.radius * 1.5, 8);
        if (nearestEnemy(ctx, p.x, p.z, reach) < 0) { slot.cd = 0.1; continue; }
      }
      if (!resolveAim(ctx, spec, manual, i === 0)) { slot.cd = 0.1; continue; }
      const w = ctx.rules.feel.windup[spec.archetype] ?? 0;
      if (w <= 0) { if (fire(ctx, impl, spec, i)) slot.cd = spec.cd; else slot.cd = 0.1; continue; }
      slot.windup = w;
      p.aimFacing = datan2(AIM.ux, AIM.uz);
      p.aimT = w + 0.18;
      ctx.events.push({ t: 'windup', archetype: spec.archetype, element: spec.element, slot: i, dur: w, tx: AIM.px, tz: AIM.pz, key: spec.key });
    }
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

/** cast slot i (Phase 8b bookkeeping around the archetype: uses, Pressure Jet's root, Slipstream's copied coat) */
function fire(ctx: SimContext, impl: Archetype, spec: MoveSpec, i: number): boolean {
  const p = ctx.player;
  const slip = (i === 1 || i === 2) && p.slipAg > 0 ? p.slipAg : 0;
  castExtra = slip;
  const ok = impl.cast(ctx, spec, i);
  castExtra = 0;
  if (!ok) return false;
  const slot = p.moves[i];
  if (slot) slot.uses = (slot.uses ?? 0) + 1;
  if (spec.selfRoot) p.rootT = Math.max(p.rootT, spec.selfRoot);
  if (slip) p.slipAg = 0;
  return true;
}
void AG;

export { healPlayer };
