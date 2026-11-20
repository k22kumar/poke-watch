// A chase-camera crosshair for the headless bot (Phase 2B, docs/THIRD_PERSON_IMPLEMENTATION.md §13): the bot sends no
// aim, so the replay sets and the performance gate would never reach the spatial aim. scripts/checksum.ts (`aim`,
// `aim-off`) and scripts/perf-sim.ts (`--aim`) add this ray to the bot's own input. It is a measuring device, not the
// bot's behaviour: roadmap Stage 7A gives the bot a real aim.
import { MASK, segmentClear } from '../../src/sim/spatial';
import { combatFlags } from '../../src/sim/aim';
import { dcos, dsin } from '../../src/core/detmath';
import type { InputFrame, SimContext } from '../../src/sim/types';

/** the bot's input plus a crosshair ray: a lens 4.5 m behind and 1.7 m above the partner, 1.25 m on the right shoulder,
 *  looking at the centre of the nearest live enemy within 30 m that the partner can see (segmentClear, with the attack cover
 *  policy of sim/aim.ts combatFlags: a player does not aim into a wall, and does aim through a hedge when foliage is not
 *  cover), else level along the partner's facing. Deterministic: it reads sim state only, with detmath and
 *  sqrt (no engine-dependent Math.sin / Math.hypot), so the `aim` hashes do not depend on the machine */
export function withAim(ctx: SimContext, inp: InputFrame): InputFrame {
  const P = ctx.player;
  const [tx, ty, tz] = crosshairTarget(ctx);
  let fx = tx - P.x, fz = tz - P.z;
  const fl = Math.sqrt(fx * fx + fz * fz) || 1; fx /= fl; fz /= fl;
  const ex = P.x - fx * 4.5 + fz * 1.25, ey = P.y + 1.7, ez = P.z - fz * 4.5 - fx * 1.25;
  const dx = tx - ex, dy = ty - ey, dz = tz - ez, L = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1, f = Math.fround;
  return { ...inp, aim: { ox: f(ex), oy: f(ey), oz: f(ez), dx: f(dx / L), dy: f(dy / L), dz: f(dz / L) }, aimDev: 'mouse' };
}

/** the point withAim's crosshair looks at: the centre of the nearest live enemy within 30 m the partner can see, else
 *  20 m along its facing at eye height */
export function crosshairTarget(ctx: SimContext): [number, number, number] {
  const P = ctx.player, E = ctx.enemies;
  let best = -1, bd = 900;
  const cf = combatFlags(ctx);
  for (let i = 0; i < E.hi; i++) {
    if (!E.alive[i]) continue;
    const d = (E.x[i] - P.x) ** 2 + (E.z[i] - P.z) ** 2;
    if (d >= bd || !segmentClear(ctx.world, P.x, P.y + 0.7, P.z, E.x[i], E.y[i] + E.tall[i] / 2, E.z[i], MASK.los, cf)) continue;
    bd = d; best = i;
  }
  const tx = best >= 0 ? E.x[best] : P.x + dsin(P.facing) * 20, tz = best >= 0 ? E.z[best] : P.z + dcos(P.facing) * 20;
  const ty = best >= 0 ? E.y[best] + E.tall[best] / 2 : P.y + 1.7;
  return [tx, ty, tz];
}
