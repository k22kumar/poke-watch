// Carrying a body (docs/hero-shooter-pivot.md §8a): a body is carried in front of the player who walked into it, or
// behind a Raider that grabbed it, until Guard, Dash, Tag, a faint or the end of play drops it (the player's) or its
// carrier falls (an enemy's). While the player carries, they move at rules.caps.carry.speed and fire only the basic
// attack (src/sim/moves.ts). BodyPool.carrier says who has a body: CARRIER.none, CARRIER.player or an enemy slot.
// Transport (src/sim/objectives.ts) is one user: it ticks its egg here each frame; any mode can carry another body
// the same way.
import { dcos, dhypot, dsin } from '../core/detmath';
import { partnerRadius } from '../rules/sizing';
import { tpl } from './bodies';
import { ROLE } from './pools';
import type { SimContext } from './types';

export const CARRIER = { none: -1, player: -2 } as const;

/** let go of body b, wherever it is */
export function release(ctx: SimContext, b: number) {
  const B = ctx.bodies;
  if (B.carrier[b] === CARRIER.player) ctx.player.carrying = false;
  B.carrier[b] = CARRIER.none;
}

/** one tick of carrying body b: keep it with its carrier or drop it, then let the player or a Raider pick it up */
export function carryTick(ctx: SimContext, b: number) {
  const B = ctx.bodies, P = ctx.player, E = ctx.enemies, C = ctx.rules.caps.carry;
  const c = B.carrier[b];
  if (c === CARRIER.player) {
    // dropped by Guard, Dash, Tag, a faint or anything that ends normal play
    if (P.guardT >= 0 || P.dashT > 0 || P.tagPending >= 0 || P.faintT >= 0 || ctx.state !== 'play') release(ctx, b);
    else { B.x[b] = P.x + dsin(P.facing) * C.front; B.z[b] = P.z + dcos(P.facing) * C.front; B.vx[b] = B.vz[b] = 0; }
  } else if (c >= 0) {
    if (!E.alive[c]) B.carrier[b] = CARRIER.none;
    else { B.x[b] = E.x[c] - dsin(E.facing[c]) * C.behind; B.z[b] = E.z[c] - dcos(E.facing[c]) * C.behind; B.vx[b] = B.vz[b] = 0; }
  }
  if (B.carrier[b] !== CARRIER.none) return;
  const reach = tpl(ctx, b).radius + partnerRadius(P.species, ctx.rules) + C.reach;
  if (dhypot(P.x - B.x[b], P.z - B.z[b]) < reach && P.faintT < 0 && P.guardT < 0 && P.dashT <= 0) { B.carrier[b] = CARRIER.player; P.carrying = true; return; }
  const n = ctx.grid.query(B.x[b], B.z[b], C.raiderReach);
  for (let k = 0; k < n; k++) { const e = ctx.grid.result[k]; if (E.alive[e] && E.roles[e] & ROLE.raider) { B.carrier[b] = e; break; } }
}
