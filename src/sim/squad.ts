// Squad and Tag (blueprint section 6, Phase 6).
//
// Three Pokémon, one on the field. Tag (Q / Y) swaps the field Pokémon; the incoming one arrives where the
// outgoing one stood, invulnerable for 0.15 s, and 0.2 s later fires its Tag Action toward the aim point.
// A tap swaps back to the last Pokémon; holding Tag and pressing primary or secondary fire (left / right mouse,
// RT / LT: the basic attack and Move A buttons) picks the first or the second reserve. One squad-wide cooldown
// (4 s) limits how often you can switch, and Reflex charges
// belong to the trainer, so switching never refills Dash or Guard.
//
// Benched Pokémon rest: their cooldowns keep ticking, grey health (part of each recent hit) refills, and
// their coats and paralysis wear off twice as fast. They give no passive bonuses and take no actions.
// A fainted Pokémon is replaced automatically (with a free Tag Action); the run ends when all three faint.

import { dexp } from '../core/detmath';
import { MOVE_BY_KEY } from '../rules/moves';
import { SPECIES_BY_ID, type SpeciesDef } from '../rules/species';
import { tagLineOf, type TagDef } from '../rules/tags';
import { spawnBody, TEAM } from './bodies';
import { resolve, setCastSlot } from './capabilities';
import { buildRecap, rec, setSrc } from './caplog';
import { ARCHETYPES, compileMove, resolveAim, setCastDepth, aimPoint } from './moves';
import { makeMember, recomputeMember } from './progression';
import { firstAttacks, heroKit, lineage } from '../rules/heroes';
import { BTN, type Member, type MoveSpec, type SimContext } from './types';

/** the first member other than `except` that has not fainted, -1 if none */
export function firstAlive(ctx: SimContext, except: number): number {
  const P = ctx.player;
  for (let k = 0; k < P.squad.length; k++) if (k !== except && !P.squad[k].fainted) return k;
  return -1;
}

/** health lost by the field Pokémon: part of it becomes grey; at zero it faints. Returns true if the run ended. */
export function onHpLoss(ctx: SimContext, amt: number): boolean {
  const P = ctx.player, m = P.m, R = ctx.rules.squad;
  if (m.fainted) return false;
  if (m.hp > 0) { m.grey = Math.min(m.maxHp - m.hp, m.grey + amt * R.greyShare); return false; }
  return faint(ctx);
}

/** the field Pokémon faints: the next one comes in after a moment, or the run ends */
export function faint(ctx: SimContext): boolean {
  const P = ctx.player, m = P.m, R = ctx.rules.squad;
  m.hp = 0; m.grey = 0; m.fainted = true; m.coat = 0; m.coatDeep = 0; m.coatT = 0; m.paraT = 0;
  const next = firstAlive(ctx, P.active);
  setSrc('player', m.species.name);
  const r = rec(ctx, 'faint', 'none', true);
  if (r) { r.tgt = 'player'; r.tgtName = m.species.name; r.x = P.x; r.z = P.z; }
  if (next < 0 && ctx.rules.hero.respawn > 0) {
    // no fail state (the range): down for rules.hero.respawn, then back at the spawn (squadSystem)
    ctx.events.push({ t: 'faint', species: m.species.id, out: false });
    P.respawnT = ctx.rules.hero.respawn;
    P.iframes = Math.max(P.iframes, P.respawnT + 0.5);
    P.tagPending = -1;
    return false;
  }
  if (next < 0) {
    // the death recap: which rules decided the last few seconds (blueprint section 10)
    ctx.recap = buildRecap(ctx.caplog, ctx.time, ctx.rules.caps.recapSeconds);
    ctx.events.push({ t: 'faint', species: m.species.id, out: true });
    ctx.state = 'dead';
    ctx.stateTimer = ctx.rules.sim.deathSlowmoSeconds;
    ctx.events.push({ t: 'death' });
    return true;
  }
  ctx.events.push({ t: 'faint', species: m.species.id, out: false });
  P.faintT = R.faintDelay;
  P.iframes = Math.max(P.iframes, R.faintDelay + 0.3);
  P.tagPending = -1;
  return false;
}

/** back at the spawn with every member at full health (the range's no-fail rule) */
function respawn(ctx: SimContext) {
  const P = ctx.player, W = ctx.world, [sx, sz] = W.spawn;
  P.respawnT = 0;
  for (const m of P.squad) { m.fainted = false; m.hp = m.maxHp; m.grey = 0; m.coat = 0; m.coatDeep = 0; m.coatT = 0; m.paraT = 0; }
  P.x = P.px = sx; P.z = P.pz = sz; P.y = P.py = W.height(sx, sz); P.vx = P.vz = P.vy = 0; P.kx = P.kz = 0; P.grounded = true;
  P.safeX = sx; P.safeY = P.y; P.safeZ = sz; P.hzKind = 0; P.hzT = 0; P.hzAcc = 0;
  P.iframes = Math.max(P.iframes, 1);
  ctx.events.push({ t: 'respawn', species: P.m.species.id });
}

/** a loadout member (docs/hero-shooter-pivot.md Q10): a Pokémon the player brings into the match, with its hero kit at
 *  the fixed move level (src/rules/heroes.ts heroKit). Not a recruit: no event, no squad-level moves */
export function addLoadoutMember(ctx: SimContext, id: string): Member | null {
  const P = ctx.player, sp = SPECIES_BY_ID[id];
  if (!sp || P.squad.length >= Math.max(1, ctx.rules.hero.loadout)) return null;
  const m = makeMember(sp);
  P.squad.push(m);
  recomputeMember(ctx, m);
  m.hp = m.maxHp;
  const kit = heroKit(sp, { fillE: ctx.rules.hero.fillE });
  for (const k of [kit.primary, kit.q, kit.e]) if (k && !m.learned.has(k)) { m.moves.push({ key: k, level: ctx.rules.hero.moveLevel, cd: 0.3, spec: compileMove(ctx.rules, k) }); m.learned.add(k); }
  return m;
}

// ------------------------------------------------------------------ squad members
/** add a Pokémon to the squad with its first moves (harnesses and the ?squad= dev parameter; recruiting was deleted at
 *  hero-shooter pivot step 9) */
export function addMember(ctx: SimContext, id: string): Member | null {
  const P = ctx.player;
  const sp = SPECIES_BY_ID[id];
  if (!sp || P.squad.length >= ctx.rules.squad.max) return null;
  const m = makeMember(sp);
  P.squad.push(m);
  recomputeMember(ctx, m);
  m.hp = m.maxHp;
  // its first two attacks from its cross-game level-up moves, the earliest first (it becomes the basic attack)
  for (const k of firstAttacks(sp, P.level, 2)) { m.moves.push({ key: k, level: ctx.rules.hero.moveLevel, cd: 0.3, spec: compileMove(ctx.rules, k) }); m.learned.add(k); }
  ctx.events.push({ t: 'recruit', species: id });
  return m;
}

/** the squad's core, any size: the field timer and each member's Flash Fire timer. Swapping (Tag input, Tag Actions,
 *  the faint replacement, grey health and the bench) is the opt-in swap system (src/sim/swap.ts). */
export const squadSystem = {
  name: 'squad',
  update(ctx: SimContext, dt: number) {
    const P = ctx.player;
    P.fieldT += dt;
    for (const m of P.squad) if (m.flashT > 0) m.flashT -= dt;
    // a respawn (rules.hero.respawn): rooted while down, then every member back at full health on the spawn
    if (P.respawnT > 0) {
      P.respawnT -= dt; P.rootT = Math.max(P.rootT, dt * 2); P.vx = 0; P.vz = 0;
      if (P.respawnT <= 0) respawn(ctx);
    }
  },
};
