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
