// Objectives (blueprint section 9, Phase 7): the Hold. Hunt and Transport were deleted at hero-shooter pivot step 9
// (docs/hero-shooter-pivot.md §8); carrying a body is the general src/sim/carry.ts.
//
// The survivor director offers up to two Holds a stage, at the first beat-director Peak after 1:30 and after 3:20.
// None is required, each must be engaged within 45 s or it lapses; ignoring or losing one brings a
// Peak forward rather than ending the run. A habitat map's Hold sits on its contest floor; the Hold mode opens one at
// the start (src/sim/modes/hold.ts holds the point, the charge, the Raiders' drain and the Raid party).
//   Hold       stand within 5 m of the pylon for 30 s; Raiders on the pad drain it

import { navWide, partnerFootprint, partnerHeight } from '../rules/sizing';
import { DIAG_R } from '../world/navblocks';
import { dhypot, dsin, dcos } from '../core/detmath';
import { clamp } from '../core/util';
import { forcePeak } from './director';
import type { Objective, ObjectiveKind, SimContext } from './types';
import { holdOfferTime, holdPoint, holdTick, spawnRaidParty } from './modes/hold';

/** the objective the next Peak should open, if one is due */
export function objectiveDue(ctx: SimContext): ObjectiveKind | null {
  const O = ctx.rules.objectives, B = ctx.beat;
  if (!O.enabled) return null;
  if (ctx.objective && (ctx.objective.phase === 'offer' || ctx.objective.phase === 'active')) return null;
  const n = B.objectives;
  if (n >= 2 || ctx.stageTime < (n === 0 ? O.firstAfter : O.secondAfter)) return null;
  return 'hold';
}

/** an open walkable point (r..R m from the player) with room around it; with size geometry on, one the partner's own
 *  navigation class reaches (a Large or Extra Large partner never gets an objective behind a one-tile neck) */
function site(ctx: SimContext, rMin: number, rMax: number, fromX = ctx.player.x, fromZ = ctx.player.z): [number, number] {
  const W = ctx.world, b = W.bound - 4, pf = partnerFootprint(ctx.player.species, ctx.rules), wide = pf > 0 && navWide(pf, ctx.rules);
  for (let k = 0; k < 40; k++) {
    const a = ctx.rng.spawn.range(0, Math.PI * 2), r = ctx.rng.spawn.range(rMin, rMax);
    const x = Math.floor(clamp(fromX + dsin(a) * r, -b, b)) + 0.5, z = Math.floor(clamp(fromZ + dcos(a) * r, -b, b)) + 0.5;
    let ok = W.walkable(x, z) && (!wide || W.wideReached(x, z, pf < DIAG_R, undefined, partnerHeight(ctx.player.species, ctx.rules)));
    for (let q = 0; q < 8 && ok; q++) ok = W.walkable(x + dsin(q * 0.785) * 2.2, z + dcos(q * 0.785) * 2.2);
    if (ok) return [x, z];
  }
  return W.nearestWalkable(fromX + rMin, fromZ);
}

function blank(kind: ObjectiveKind, x: number, z: number, t: number): Objective {
  return { kind, phase: 'offer', t, x, z, charge: 0 };
}

/** open an objective (a Hold); returns false when the region cannot host it */
export function startObjective(ctx: SimContext, kind: ObjectiveKind): boolean {
  const [x, z] = holdPoint(ctx, () => site(ctx, 12, 20));
  const obj = blank(kind, x, z, holdOfferTime(ctx));
  ctx.objective = obj;
  ctx.beat.objectives++;
  ctx.events.push({ t: 'objective', kind, phase: 'offer', x: obj.x, z: obj.z });
  return true;
}

function activate(ctx: SimContext, O: Objective) {
  O.phase = 'active';
  O.t = ctx.rules.objectives.hold.limit;
  ctx.events.push({ t: 'objective', kind: O.kind, phase: 'active', x: O.x, z: O.z });
  spawnRaidParty(ctx); // a raid party comes for it (src/sim/modes/hold.ts)
}

function finish(ctx: SimContext, O: Objective, ok: boolean) {
  O.phase = ok ? 'done' : 'failed';
  O.t = 3;
  ctx.events.push({ t: 'objective', kind: O.kind, phase: ok ? 'done' : 'failed', x: O.x, z: O.z, reward: '' });
  if (!ok) forcePeak(ctx);
}

export const objectiveSystem = {
  name: 'objectives',
  update(ctx: SimContext, dt: number) {
    const O = ctx.objective;
    if (!O) return;
    const P = ctx.player;
    O.t -= dt;
    if (O.phase === 'done' || O.phase === 'failed') { if (O.t <= 0) ctx.objective = null; return; }
    const dP = dhypot(P.x - O.x, P.z - O.z);
    if (holdTick(ctx, O, 0, dP) === 'activate') activate(ctx, O);
    if (O.phase === 'active' && holdTick(ctx, O, dt, dP) === 'taken') { finish(ctx, O, true); return; }
    if (O.t <= 0) {
      // lapsed (never engaged) or ran out of time
      if (O.phase === 'offer') ctx.events.push({ t: 'objective', kind: O.kind, phase: 'expired', x: O.x, z: O.z });
      finish(ctx, O, false);
    }
  },
};
