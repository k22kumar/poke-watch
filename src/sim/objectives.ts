// Objectives (blueprint section 9, Phase 7): the Hold. Hunt and Transport were deleted at hero-shooter pivot step 9
// (docs/hero-shooter-pivot.md §8); carrying a body is the general src/sim/carry.ts.
//
// An objective runs only when something opens one (the survivor director's schedule was deleted at pivot step 9): the
// Hold mode opens one at the start of a habitat map, and the habitat Hold gates open their own. It must be engaged
// within rules.objectives.offerTime or it lapses. A habitat map's Hold sits on its contest floor (src/sim/modes/hold.ts
// holds the point, the charge, the Raiders' drain and the Raid party).
//   Hold       stand within 5 m of the pylon for 30 s; Raiders on the pad drain it

import { navWide, partnerFootprint, partnerHeight } from '../rules/sizing';
import { DIAG_R } from '../world/navblocks';
import { dhypot, dsin, dcos } from '../core/detmath';
import { clamp } from '../core/util';
import type { Objective, ObjectiveKind, SimContext } from './types';
import { holdOfferTime, holdPoint, holdTick, spawnRaidParty } from './modes/hold';
import { GROUND, worldOf } from './worldquery';

/** an open walkable point (r..R m from the player) with room around it, one the partner's own
 *  navigation class reaches (a Large or Extra Large partner never gets an objective behind a one-tile neck) */
function site(ctx: SimContext, rMin: number, rMax: number, fromX = ctx.player.x, fromZ = ctx.player.z): [number, number] {
  const W = worldOf(ctx), b = W.bound - 4, pf = partnerFootprint(ctx.player.species, ctx.rules), wide = pf > 0 && navWide(pf, ctx.rules);
  for (let k = 0; k < 40; k++) {
    const a = ctx.rng.spawn.range(0, Math.PI * 2), r = ctx.rng.spawn.range(rMin, rMax);
    const x = Math.floor(clamp(fromX + dsin(a) * r, -b, b)) + 0.5, z = Math.floor(clamp(fromZ + dcos(a) * r, -b, b)) + 0.5;
    let ok = W.walkableAt(x, GROUND, z) && (!wide || W.navReached('player', x, GROUND, z, pf < DIAG_R, partnerHeight(ctx.player.species, ctx.rules)));
    for (let q = 0; q < 8 && ok; q++) ok = W.walkableAt(x + dsin(q * 0.785) * 2.2, GROUND, z + dcos(q * 0.785) * 2.2);
    if (ok) return [x, z];
  }
  return W.nearestWalkableAt(fromX + rMin, GROUND, fromZ);
}

function blank(kind: ObjectiveKind, x: number, z: number, t: number): Objective {
  return { kind, phase: 'offer', t, x, z, charge: 0 };
}

/** open an objective (a Hold); returns false when the region cannot host it */
export function startObjective(ctx: SimContext, kind: ObjectiveKind): boolean {
  const [x, z] = holdPoint(ctx, () => site(ctx, 12, 20));
  const obj = blank(kind, x, z, holdOfferTime(ctx));
  ctx.objective = obj;
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
