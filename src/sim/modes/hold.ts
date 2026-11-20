// Hold: the control-point objective as a mode of its own (docs/hero-shooter-pivot.md Q14). Stand within
// rules.objectives.hold.radius of the point for hold.time seconds to take it; Raiders standing on it drain the charge.
// On habitat maps the point is the generated contest floor and the Raid party leaves team B's staging and takes its
// approaches (docs/HABITATS.md "Hold contract"); src/sim/enemies.ts pins Raiders of an active habitat Hold so the
// far-behind relocation (rules.enemy.despawnDistance) never skips the approaches. Hold is the 3v3's objective later.
//
// src/sim/objectives.ts still schedules and finishes objectives (Hunt and Transport are survivor-only and go with the
// loop); it calls these for everything Hold-specific. The HOLD Mode (src/mods) opens one at the start of a habitat map.
import { clamp } from '../../core/util';
import { compositionsFor, spawnComposition } from '../director';
import { ROLE } from '../pools';
import type { Objective, SimContext } from '../types';

/** where the point is: the habitat contest floor, else `site()` (an open spot near the player) */
export function holdPoint(ctx: SimContext, site: () => [number, number]): [number, number] {
  const H = ctx.world.hab;
  return H ? [H.contest.x - ctx.world.half, H.contest.y - ctx.world.half] : site();
}

/** how long the point is offered before it lapses: habitat maps add 30 s (the walk from staging A) */
export function holdOfferTime(ctx: SimContext): number {
  return ctx.world.hab ? ctx.rules.objectives.offerTime + 30 : ctx.rules.objectives.offerTime;
}

/** the Raid party: a composition that comes for the point, from team B's staging on habitat maps */
export function spawnRaidParty(ctx: SimContext) {
  const opts = compositionsFor(ctx, 'objective');
  const H = ctx.world.hab;
  const near: [number, number] | undefined = H ? [H.stage.B[0] - ctx.world.half, H.stage.B[1] - ctx.world.half] : undefined;
  if (opts.length) spawnComposition(ctx, ctx.rng.spawn.weighted(opts, (c) => c.weight), near);
}

/** one tick of a Hold: activation on arrival, charge while the player stands on it, the Raiders' drain.
 *  Returns 'activate' when the player has just arrived, 'taken' when the charge is full, else null. */
export function holdTick(ctx: SimContext, O: Objective, dt: number, dP: number): 'activate' | 'taken' | null {
  const R = ctx.rules.objectives, E = ctx.enemies, P = ctx.player;
  if (O.phase === 'offer') return dP < R.hold.radius ? 'activate' : null;
  if (O.phase !== 'active') return null;
  if (dP < R.hold.radius && P.faintT < 0) O.charge += dt / R.hold.time;
  // Raiders standing on the pad drain it
  const n = ctx.grid.query(O.x, O.z, 2);
  for (let k = 0; k < n; k++) { const e = ctx.grid.result[k]; if (E.alive[e] && E.roles[e] & ROLE.raider) O.charge -= R.hold.drain * dt; }
  O.charge = clamp(O.charge, 0, 1);
  return O.charge >= 1 ? 'taken' : null;
}
