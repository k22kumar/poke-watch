// Creature coats and reactions (blueprint section 8, Phase 5).
//
// A hit, a tile or the weather can coat a creature with one of four agents (Heat, Wet, Cold, Charge).
// A second, different agent reacts with the coat (rules/reactions.ts):
//   Steam    Heat + Wet      a cloud; enemies inside lose their target and stop shooting; spends the burn
//   Freeze   Wet + Cold      frozen solid; the next physical hit or push shatters it for x2
//   Conduct  Charge into Wet chains through every Soaked creature nearby and stuns them
//   Overload Heat + Charge   a burst that pushes everything outward
//   Cancel   Heat + Cold     both are removed
// Light coats (the basic attack) stick only to fodder and react small; deep coats (moves A and B, Tag
// Actions, terrain) stick to everything, react big, and can only be spent by another deep agent, so the
// autofire never wastes a setup. Stuns, freezes and roots feed a crowd-control meter that grants a short
// immunity, so stacked control cannot lock a creature (or a boss) down.

import { dhypot } from '../core/detmath';
import { ELEMENTS, effectiveness, type Element } from '../rules/elements';
import { AG, REACT, coatImmune } from '../rules/reactions';
import { killEnemy } from './combat';
import { ROLE, ZK } from './pools';
import type { Member, SimContext } from './types';
import { onHpLoss } from './squad';
import { onReaction } from './techniques';

const BIG = ROLE.elite | ROLE.alpha | ROLE.boss;
const AGENT_EL: Element[] = ['plain', 'blaze', 'tide', 'frost', 'volt'];

export type ReactionEvent = 'steam' | 'freeze' | 'shatter' | 'conduct' | 'overload' | 'cancel';

/** stun, freeze or root e for up to `dur` s, through the crowd-control meter; returns the time granted */
export function ccApply(ctx: SimContext, e: number, dur: number): number {
  const E = ctx.enemies, C = ctx.rules.reactions.cc;
  if (dur <= 0 || E.ccImmune[e] > 0) return 0;
  const mult = E.roles[e] & ROLE.boss ? C.bossMult : 1;
  E.ccAcc[e] += dur * mult;
  if (E.ccAcc[e] >= C.limit) { E.ccAcc[e] = 0; E.ccImmune[e] = C.immune; }
  return dur;
}

/** reaction damage: scaled only by the type chart (the hit that started it was already scaled) */
function reactHit(ctx: SimContext, e: number, amount: number, el: Element, kx = 0, kz = 0, knock = 0) {
  const E = ctx.enemies;
  if (!E.alive[e] || amount <= 0) return;
  const eff = effectiveness(ctx.chart, el, ctx.speciesIndex[E.species[e]].elements);
  const dmg = amount * eff;
  if (dmg <= 0) return;
  E.hp[e] -= dmg;
  E.flash[e] = 0.12;
  ctx.stats.damageDealt += dmg;
  if (knock > 0 && !(E.roles[e] & ROLE.boss)) {
    const L = dhypot(kx, kz) || 1;
    const resist = E.roles[e] & ROLE.alpha ? 0.3 : E.roles[e] & ROLE.elite ? 0.6 : 1;
    E.kx[e] += (kx / L) * knock * resist; E.kz[e] += (kz / L) * knock * resist;
  }
  ctx.events.push({ t: 'hit', x: E.x[e], y: E.y[e] + E.size[e], z: E.z[e], amount: dmg, crit: false, eff, element: el, enemy: e });
  if (E.hp[e] <= 0) killEnemy(ctx, e);
}

function clearCoat(ctx: SimContext, e: number) {
  const E = ctx.enemies;
  E.coat[e] = 0; E.coatDeep[e] = 0; E.coatT[e] = 0;
}

/** base for a reaction started by a tile rather than a hit */
export function tileReactionBase(ctx: SimContext) {
  const R = ctx.rules.reactions;
  return R.tileBase + R.tilePerLevel * ctx.player.level;
}

/**
 * Agent `agent` arrives on enemy e at `depth` (1 light, 2 deep), from a hit that dealt `amount`.
 * Coats it, refreshes its coat, or reacts with it.
 */
export function coatEnemy(ctx: SimContext, e: number, agent: number, depth: number, amount: number, byPlayer = false) {
  const E = ctx.enemies, R = ctx.rules.reactions;
  if (!agent || depth <= 0 || !E.alive[e]) return;
  reactByPlayer = byPlayer;
  const big = (E.roles[e] & BIG) !== 0;
  if (depth === 1 && big) return; // light coats stick only to fodder
  if (coatImmune(ctx.speciesIndex[E.species[e]].elements, agent)) return;
  if (depth === 1) { if (E.coatIcd[e] > 0) return; E.coatIcd[e] = R.lightIcd; }
  const cur = E.coat[e];
  const time = depth === 2 ? R.deepTime : R.lightTime;
  if (cur === 0 || cur === agent) {
    E.coat[e] = agent;
    E.coatDeep[e] = Math.max(E.coatDeep[e], depth);
    E.coatT[e] = Math.max(E.coatT[e], time);
    return;
  }
  // a different agent: light agents never spend a deep coat
  if (E.coatDeep[e] === 2 && depth === 1) return;
  const r = REACT[cur][agent];
  const deep = depth === 2;
  const x = E.x[e], z = E.z[e];
  switch (r) {
    case 'steam': {
      const S = deep ? R.steam.deep : R.steam.light;
      clearCoat(ctx, e);
      E.burn[e] = 0; E.dot[e] = E.poison[e] > 0 ? E.dot[e] : 0; // steam spends the burn
      const zi = ctx.zones.spawn();
      if (zi >= 0) {
        const Z = ctx.zones;
        Z.kind[zi] = ZK.steam; Z.x[zi] = x; Z.z[zi] = z; Z.radius[zi] = S.r; Z.life[zi] = Z.maxLife[zi] = S.t;
        Z.tick[zi] = 0.1; Z.tickT[zi] = 0; Z.dmg[zi] = 0; Z.element[zi] = ELEMENTS.indexOf('tide'); Z.knock[zi] = 0; Z.move[zi] = -1;
      }
      react(ctx, 'steam', x, z, S.r, deep);
      break;
    }
    case 'freeze': {
      clearCoat(ctx, e);
      const t = ccApply(ctx, e, deep ? R.freeze.deep : R.freeze.light);
      if (t > 0) { E.frozen[e] = t; E.stun[e] = Math.max(E.stun[e], t); E.chill[e] = 0; }
      react(ctx, 'freeze', x, z, 1, deep);
      break;
    }
    case 'conduct': {
      const C = deep ? R.conduct.deep : R.conduct.light;
      const dmg = Math.max(amount, tileReactionBase(ctx)) * C.mult;
      const pts = [x, z];
      const n = ctx.grid.query(x, z, C.r);
      let hits = 0;
      // the struck creature first, then every Soaked creature in reach
      const targets = [e];
      for (let k = 0; k < n && targets.length < R.conduct.maxTargets; k++) {
        const j = ctx.grid.result[k];
        if (j === e || !E.alive[j] || E.coat[j] !== AG.wet) continue;
        if (dhypot(E.x[j] - x, E.z[j] - z) > C.r) continue;
        targets.push(j);
      }
      for (const j of targets) {
        if (!E.alive[j]) continue;
        if (coatImmune(ctx.speciesIndex[E.species[j]].elements, AG.charge)) continue;
        clearCoat(ctx, j);
        const st = ccApply(ctx, j, C.stun);
        if (st > 0) E.stun[j] = Math.max(E.stun[j], st);
        if (j !== e) pts.push(E.x[j], E.z[j]);
        reactHit(ctx, j, dmg, 'volt');
        hits++;
      }
      if (pts.length > 2) ctx.events.push({ t: 'chain', pts, element: 'volt' });
      react(ctx, 'conduct', x, z, C.r, deep, hits);
      break;
    }
    case 'overload': {
      const O = deep ? R.overload.deep : R.overload.light;
      clearCoat(ctx, e);
      const dmg = Math.max(amount, tileReactionBase(ctx)) * O.mult;
      const n = ctx.grid.query(x, z, O.r + 2);
      const hitList: number[] = [];
      for (let k = 0; k < n; k++) {
        const j = ctx.grid.result[k];
        if (!E.alive[j]) continue;
        if (dhypot(E.x[j] - x, E.z[j] - z) > O.r + E.radius[j]) continue;
        hitList.push(j);
      }
      for (const j of hitList) reactHit(ctx, j, dmg, 'blaze', E.x[j] - x || 0.01, E.z[j] - z, O.knock);
      ctx.events.push({ t: 'ring', x, z, r: O.r, element: 'volt', life: 0.35 });
      react(ctx, 'overload', x, z, O.r, deep, hitList.length);
      break;
    }
    case 'cancel':
      clearCoat(ctx, e);
      E.burn[e] = 0; E.chill[e] = 0;
      if (E.poison[e] <= 0) E.dot[e] = 0;
      react(ctx, 'cancel', x, z, 1, deep);
      break;
    case 'none':
      // Cold and Charge do not react: the newer agent replaces the older one
      E.coat[e] = agent; E.coatDeep[e] = depth; E.coatT[e] = time;
      break;
    default:
      break;
  }
}

/** the reaction being settled was started by the trainer's own hit (Catalyst counts only those) */
let reactByPlayer = false;
function react(ctx: SimContext, kind: ReactionEvent, x: number, z: number, r: number, deep: boolean, n = 1) {
  ctx.events.push({ t: 'react', kind, x, z, r, deep, n });
  if (reactByPlayer && kind !== 'shatter') { reactByPlayer = false; onReaction(ctx, x, z); }
}

/** a physical hit or a push on a frozen creature shatters it: returns the damage multiplier */
export function shatter(ctx: SimContext, e: number): number {
  const E = ctx.enemies;
  if (E.frozen[e] <= 0) return 1;
  E.frozen[e] = 0; E.stun[e] = 0;
  react(ctx, 'shatter', E.x[e], E.z[e], 1, true);
  onReaction(ctx, E.x[e], E.z[e]); // a shatter is always the trainer's own physical hit
  return ctx.rules.reactions.freeze.shatter;
}

// ------------------------------------------------------------------ the player's Pokémon
/**
 * Agent arrives on a squad member (from an enemy shot or a tile). Player-side reactions are small and
 * readable: Conduct stuns and hurts, Freeze slows, Steam and Cancel just clear the coat.
 * Returns the reaction that happened, if any.
 */
export function coatMember(ctx: SimContext, m: Member, agent: number, depth: number): ReactionEvent | null {
  const R = ctx.rules.reactions;
  reactByPlayer = false;
  if (!agent || depth <= 0 || m.fainted) return null;
  if (coatImmune(m.species.elements, agent)) return null;
  const time = depth === 2 ? R.deepTime : R.lightTime;
  if (m.coat === 0 || m.coat === agent) {
    m.coat = agent; m.coatDeep = Math.max(m.coatDeep, depth); m.coatT = Math.max(m.coatT, time);
    return null;
  }
  const r = REACT[m.coat][agent];
  const P = ctx.player;
  const clear = () => { m.coat = 0; m.coatDeep = 0; m.coatT = 0; };
  switch (r) {
    case 'conduct': {
      clear();
      if (P.m === m) {
        P.paraT = Math.max(P.paraT, 1.8);
        const amt = m.maxHp * 0.06 * ctx.rules.mode.difficulty;
        m.hp = Math.max(0, m.hp - amt);
        P.hurtFlash = 0.2;
        ctx.stats.damageTaken += amt;
        onHpLoss(ctx, amt);
      }
      react(ctx, 'conduct', P.x, P.z, 1, depth === 2);
      return 'conduct';
    }
    case 'freeze':
      clear();
      if (P.m === m) P.paraT = Math.max(P.paraT, 1);
      react(ctx, 'freeze', P.x, P.z, 1, depth === 2);
      return 'freeze';
    case 'steam': case 'cancel': case 'overload':
      clear();
      react(ctx, r, P.x, P.z, 1, depth === 2);
      return r;
    case 'none':
      m.coat = agent; m.coatDeep = depth; m.coatT = time;
      return null;
    default:
      return null;
  }
}

/** the agent element name for a coat index (for colours and events) */
export const coatElement = (agent: number): Element => AGENT_EL[agent] ?? 'plain';

export const coatSystem = {
  name: 'coats',
  update(ctx: SimContext, dt: number) {
    const E = ctx.enemies, C = ctx.rules.reactions.cc;
    for (let i = 0; i < E.hi; i++) {
      if (!E.alive[i]) continue;
      if (E.coatT[i] > 0) { E.coatT[i] -= dt; if (E.coatT[i] <= 0) clearCoat(ctx, i); }
      if (E.coatIcd[i] > 0) E.coatIcd[i] -= dt;
      if (E.frozen[i] > 0) E.frozen[i] -= dt;
      if (E.blind[i] > 0) E.blind[i] -= dt;
      if (E.ccImmune[i] > 0) E.ccImmune[i] -= dt;
      else if (E.ccAcc[i] > 0) E.ccAcc[i] = Math.max(0, E.ccAcc[i] - C.decay * dt);
    }
    // the squad: the active member's coat runs down normally, benched members' twice as fast
    for (const P of ctx.players) {
      for (let k = 0; k < P.squad.length; k++) {
        const m = P.squad[k];
        if (m.coatT <= 0) continue;
        m.coatT -= dt * (k === P.active ? 1 : 2);
        if (m.coatT <= 0) { m.coat = 0; m.coatDeep = 0; m.coatT = 0; }
      }
    }
  },
};
