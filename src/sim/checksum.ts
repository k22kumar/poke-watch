// State checksum for replays and (later) rollback desync detection: FNV-1a over the float64 bits
// of the state that matters to play. Same seed + same inputs => same hash on every engine.
import type { SimContext } from './types';

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);

export class StateHasher {
  h = 0x811c9dc5;
  num(n: number) {
    f64[0] = n;
    this.h = Math.imul(this.h ^ u32[0], 0x01000193) >>> 0;
    this.h = Math.imul(this.h ^ u32[1], 0x01000193) >>> 0;
    return this;
  }
}

export function stateHash(ctx: SimContext): number {
  const h = new StateHasher();
  h.num(ctx.tick).num(ctx.stage).num(ctx.stats.kills).num(ctx.stats.damageTaken).num(ctx.stats.xp);
  for (const P of ctx.players) {
    h.num(P.x).num(P.y).num(P.z).num(P.vx).num(P.vz).num(P.reflex).num(P.level).num(P.xp);
    // R6c jump acceptance (a buffered press, coyote time, the airborne press spent) is play state; only edge-sending
    // input writes it, so legacy input (the bot, every checksum set) hashes as before
    const c = P.ctl;
    if (c.buffer || c.coyote || c.airSpent) h.num(c.buffer).num(c.coyote).num(c.airSpent ? 1 : 0);
    for (const m of P.squad) {
      h.num(m.hp).num(m.grey).num(m.coat).num(m.coatT);
      // a queued press (Phase 3 fire buffer) is play state; a slot with none hashes as before
      for (const s of m.moves) { h.num(s.cd).num(s.level); if (s.queued !== undefined) h.num(s.queued); }
    }
  }
  const E = ctx.enemies;
  for (let i = 0; i < E.hi; i++) if (E.alive[i]) h.num(i).num(E.x[i]).num(E.z[i]).num(E.hp[i]);
  const B = ctx.bodies;
  for (let i = 0; i < B.hi; i++) if (B.alive[i]) h.num(B.x[i]).num(B.z[i]);
  // W4/W5: the world overlay (prop states) is gameplay state; cosmetics are not hashed
  const F = ctx.world?.propField;
  if (F) { for (let i = 0; i < F.n; i++) if (F.state[i]) h.num(i).num(F.state[i]); } // untouched overlay hashes as nothing
  return h.h;
}

/** The hero-shooter replay hash (docs/hero-shooter-pivot.md Q43; tests/replays.test.ts). Foundation state only, so
 *  deleting the survivor loop cannot move it: no stage, XP, level, cards or director. Per player: position, planar and
 *  vertical velocity, ground contact, Reflex, the jump-control state (buffer, coyote, the airborne press spent), a
 *  Breakthrough and a respawn in progress, the field member, and per member its species, health, grey health, coat and
 *  move slots (cooldown, level, a queued press). Every live enemy (slot, position, height, health), the training
 *  targets (slot, generation, respawn tick, waypoint), every live body (position, height, velocity, owner), the cell
 *  states and the prop overlay. */
export function replayHash(ctx: SimContext): number {
  const h = new StateHasher();
  h.num(ctx.tick).num(ctx.stats.kills).num(ctx.stats.damageTaken).num(ctx.stats.damageDealt);
  for (const P of ctx.players) {
    h.num(P.x).num(P.y).num(P.z).num(P.vx).num(P.vz).num(P.vy).num(P.grounded ? 1 : 0).num(P.reflex);
    const c = P.ctl;
    h.num(c.buffer).num(c.coyote).num(c.airSpent ? 1 : 0);
    h.num(P.breakT).num(P.breakMember).num(P.respawnT).num(P.active);
    for (const m of P.squad) {
      h.num(ctx.speciesIndex.indexOf(m.species)).num(m.hp).num(m.grey).num(m.coat).num(m.coatT).num(m.fainted ? 1 : 0);
      for (const s of m.moves) { h.num(s.cd).num(s.level).num(s.queued ?? -1); }
    }
  }
  const E = ctx.enemies;
  for (let i = 0; i < E.hi; i++) if (E.alive[i]) h.num(i).num(E.x[i]).num(E.y[i]).num(E.z[i]).num(E.hp[i]);
  const T = ctx.targets;
  if (T) for (let k = 0; k < T.slot.length; k++) h.num(T.slot[k]).num(T.gen[k]).num(T.back[k]).num(T.wp[k]);
  const B = ctx.bodies;
  for (let i = 0; i < B.hi; i++) if (B.alive[i]) h.num(i).num(B.x[i]).num(B.y[i]).num(B.z[i]).num(B.vx[i]).num(B.vz[i]).num(B.team[i]);
  const C = ctx.world?.cells;
  if (C) for (let k = 0; k < C.state.length; k++) if (C.state[k]) h.num(k).num(C.state[k]);
  const F = ctx.world?.propField;
  if (F) { for (let i = 0; i < F.n; i++) if (F.state[i]) h.num(i).num(F.state[i]); }
  return h.h;
}
