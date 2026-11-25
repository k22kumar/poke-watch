// A chase-camera crosshair for the headless bot (Phase 2B, docs/THIRD_PERSON_IMPLEMENTATION.md §13): the bot sends no
// aim, so neither the replay scenarios' tracks nor the performance gate would reach the spatial aim on their own.
// tests/fixtures/scenarios.ts and scripts/perf-sim.ts (`--aim`) add this ray to the input. It is a measuring device, not
// the bot's behaviour: roadmap Stage 7A gives the bot a real aim.
import { MASK, RayHit, SK } from '../../src/sim/spatial';
import { worldOf } from '../../src/sim/worldquery';
import { combatFlags, eyePoint } from '../../src/sim/aim';
import { anatomyOf } from '../../src/rules/anatomy';
import { FRAMING, cameraDistance, lensHeight } from '../../src/rules/framing';
import { dcos, dsin } from '../../src/core/detmath';
import type { InputFrame, SimContext } from '../../src/sim/types';

/** the bot's input plus a crosshair ray: a lens 4.5 m behind and 1.7 m above the partner, 1.25 m on the right shoulder,
 *  looking at the centre of the nearest live enemy within 30 m that the partner can see (the seam's segmentClear, so a run
 *  on physics aims with physics; with the attack cover
 *  policy of sim/aim.ts combatFlags: a player does not aim into a wall, and does aim through a hedge when foliage is not
 *  cover), else level along the partner's facing. Deterministic: it reads sim state only, with detmath and
 *  sqrt (no engine-dependent Math.sin / Math.hypot), so the `aim` hashes do not depend on the machine.
 *  CL-Q12: with rules.aim.viewSight on, the lens follows the camera law instead (src/rules/framing.ts): at the anatomical
 *  eye's height, cameraDistance(the anatomy table's height) behind, the same 1.25 m shoulder (a test value only; I2b sets
 *  the real one), and the target pick sees from the eye; a lens the world would cover is pulled in along the line from the
 *  eye toward it, FRAMING.lensClear short of the first terrain, wall or deck it meets (CL-Q13: a harness pull-in, not the
 *  rig's, which is I2b's). Off, it is byte for byte the lens above */
const SHOULDER = 1.25;
const PULL = new RayHit();
export function withAim(ctx: SimContext, inp: InputFrame): InputFrame {
  const P = ctx.player;
  const [tx, ty, tz] = crosshairTarget(ctx);
  let fx = tx - P.x, fz = tz - P.z;
  const fl = Math.sqrt(fx * fx + fz * fz) || 1; fx /= fl; fz /= fl;
  let back = 4.5, up = 1.7;
  if (ctx.rules.aim.viewSight) { const an = anatomyOf(P.species, ctx.rules); back = cameraDistance(an.height); up = lensHeight(an.eye.up); }
  let ex = P.x - fx * back + fz * SHOULDER, ey = P.y + up, ez = P.z - fz * back - fx * SHOULDER;
  if (ctx.rules.aim.viewSight) {
    const ax = P.x, ay = eyePoint(ctx, 0, 0).ay, az = P.z, lx = ex - ax, ly = ey - ay, lz = ez - az, ll = Math.sqrt(lx * lx + ly * ly + lz * lz);
    if (ll > 1e-6 && worldOf(ctx).raycast(ax, ay, az, lx / ll, ly / ll, lz / ll, ll + FRAMING.lensClear, SK.wall | SK.deck | SK.terrain, PULL, 0, 0, combatFlags(ctx))) {
      const k = Math.max(0, PULL.t - FRAMING.lensClear) / ll;
      ex = ax + lx * k; ey = ay + ly * k; ez = az + lz * k;
    }
  }
  const dx = tx - ex, dy = ty - ey, dz = tz - ez, L = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1, f = Math.fround;
  return { ...inp, aim: { ox: f(ex), oy: f(ey), oz: f(ez), dx: f(dx / L), dy: f(dy / L), dz: f(dz / L) }, aimDev: 'mouse' };
}

/** the point withAim's crosshair looks at: the centre of the nearest live enemy within 30 m the partner can see, else
 *  20 m along its facing at eye height */
export function crosshairTarget(ctx: SimContext): [number, number, number] {
  const P = ctx.player, E = ctx.enemies;
  let best = -1, bd = 900;
  const cf = combatFlags(ctx), W = worldOf(ctx), view = ctx.rules.aim.viewSight;
  const sy = view ? eyePoint(ctx, 0, 0).ay : P.y + 0.7;
  for (let i = 0; i < E.hi; i++) {
    if (!E.alive[i]) continue;
    const d = (E.x[i] - P.x) ** 2 + (E.z[i] - P.z) ** 2;
    if (d >= bd || !W.segmentClear(P.x, sy, P.z, E.x[i], E.y[i] + E.tall[i] / 2, E.z[i], MASK.los, cf)) continue;
    bd = d; best = i;
  }
  const tx = best >= 0 ? E.x[best] : P.x + dsin(P.facing) * 20, tz = best >= 0 ? E.z[best] : P.z + dcos(P.facing) * 20;
  const ty = best >= 0 ? E.y[best] + E.tall[best] / 2 : P.y + 1.7;
  return [tx, ty, tz];
}
