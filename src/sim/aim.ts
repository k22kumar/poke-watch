// Spatial aim (Phase 2B; docs/THIRD_PERSON_IMPLEMENTATION.md §13). The chase camera sends its crosshair ray as input
// (InputFrame.aim); the sim, never the renderer, decides what it means:
//
//   1. camera trace  the ray, from where it passes the partner's chest plane (so nothing between the lens and the
//                    Pokémon counts), out to rules.aim.sightRange: the first world solid, enemy or body it meets is the
//                    aim point T (with nothing there, T is the ray's end: firing into empty space)
//   2. muzzle        M = the partner's feet + up × its class height, + fwd × its footprint along the ray's heading
//                    (rules.aim.muzzle, overridden per archetype or move key by rules.aim.muzzleBy). A wall between the
//                    body's axis and M (a corner inside the body's own reach) puts M back on the axis. R2 (pole safety):
//                    past rules.aim.muzzleFadeDeg of ray pitch the forward offset shrinks with the
//                    ray's horizontal fraction, to 0 straight up or down, so M is continuous across the pole
//   3. launch        u = (T − M) / |T − M|; an aim point within rules.aim.convergeMin of M, or behind it, fires along the
//                    crosshair ray instead
//   4. obstruction   the shot's own volume swept from M toward T: the first contact that would stop it (the world, or
//                    the actor that uses up its pierce) before T, when it is not what the crosshair is on, is reported as
//                    `blocked` with its point, the same answer the shot will meet in flight
//
// Beams (Phase 2C, §14) resolve the same way: the same camera trace, muzzle and launch direction, with the beam's length
// (range × area) as the reach and its own world radius (rules.aim.beamWorldRadius); moves.ts beam3D casts it.
// Every trace here and in the shots and beams uses one cover policy (combatFlags): foliage is open unless
// rules.aim.foliageCover, and wall props end at their measured tops (R1b; sim/spatial.ts header).
//
// CL, behind rules.aim.viewSight (docs/WORLDGEN3D.md Q15c, CL-Q3, CL-Q10, CL-Q11, CL-Q13; off until X1a): the shot
// launches from the partner's anatomical eye (src/rules/anatomy.ts; eyePoint below) instead of the muzzle, and the
// camera trace starts where the ray passes the eye's plane. Step 4's sweep from the eye, which never skips the world,
// is then the line-of-sight check and the HUD's `blocked`: "what you see is what you can hit". eyeSees is the
// information gate's query (CL-Q7), for the renderer; nothing in the tick calls it.
//
// Nothing here bends the aim toward an enemy (no magnetism) or leads a moving one: the shot goes where the crosshair is.
// The bot and the fixed views send no ray and stay on moves.ts's planar path (magnetism, lead), as every checksum set
// expects. Allocation-free: callers own the AimState, the contact lists and queries are module scratch.

import { Contacts, MASK, QF, RayHit, SK, SK_WORLD, spatialQuery, sweep } from './spatial';
import { anatomyOf } from '../rules/anatomy';
import { partnerFootprint, partnerHeight, partnerRadius } from '../rules/sizing';
import { dcos, dhypot, dsin } from '../core/detmath';
import type { AimState, MoveSpec, SimContext } from './types';
import { worldOf } from './worldquery';

const CAM = new Contacts(32), MUZ = new Contacts(32);
/** the camera trace: what the crosshair can rest on (every actor reported in order; held bodies are skipped below). Off
 *  the map is not a surface: a crosshair over the edge is on empty space (the shot itself still ends at the bounds) */
const CAMQ = spatialQuery({ mask: MASK.camera & ~SK.bounds, block: SK.enemy | SK.body, pierce: Infinity, selfKind: SK.player, selfId: 0, flags: QF.skipInitialWorld });
/** the muzzle trace: the shot's own volume (radius set per call) */
const MUZQ = spatialQuery({ mask: MASK.shot, block: SK.enemy | SK.body, pierce: Infinity, selfKind: SK.player, selfId: 0 });

/** the query flags of every player attack trace (camera, muzzle, shot flight, beam, device assist, the aimbot): foliage
 *  is open air unless the rules make it cover (rules.aim.foliageCover, the Phase 2B behaviour), and a wall prop is solid
 *  only up to its measured top (R1b wall tops), so a shot that clears a fence, a boulder or a canopy passes over it
 *  (sim/spatial.ts QF.tops) */
export function combatFlags(ctx: SimContext): number {
  return (ctx.rules.aim.foliageCover ? 0 : QF.foliage) | QF.tops;
}

/** a beam's length from its muzzle: the move's range × the partner's area multiplier (the planar beam's length) */
export function beamLength(ctx: SimContext, s: MoveSpec): number {
  return s.range * ctx.player.derived.area;
}

/** true when this cast takes the spatial path: a crosshair ray, a player-aimed cast and a migrated archetype */
export function spatialFor(ctx: SimContext, s: MoveSpec, manual: boolean, basic: boolean): boolean {
  const R = ctx.rules.aim, mode = ctx.rules.combat.mode;
  if (!ctx.input.aim || !manual || mode === 'auto' || (basic && mode === 'assist')) return false;
  return R.archetypes.includes(s.archetype);
}

/** the muzzle fractions for a move: its key's override, else its archetype's, else rules.aim.muzzle */
function muzzleOf(ctx: SimContext, s: MoveSpec): { up: number; fwd: number } {
  const R = ctx.rules.aim, by = R.muzzleBy[s.key] ?? R.muzzleBy[s.archetype];
  return by ? { up: by.up ?? R.muzzle.up, fwd: by.fwd ?? R.muzzle.fwd } : R.muzzle;
}

/** Phase 3 device assistance (rules.aim.assist `los`): whether the partner's chest (its muzzle height for this move, on
 *  its centre) sees enemy e's centre, under the attack cover policy. An enemy behind cover cannot bend a planar aim */
export function assistSees(ctx: SimContext, s: MoveSpec, e: number): boolean {
  const P = ctx.player, E = ctx.enemies, W = worldOf(ctx);
  const up = partnerHeight(P.species, ctx.rules) * muzzleOf(ctx, s).up;
  return W.segmentClear(P.x, P.y + up, P.z, E.x[e], E.y[e] + E.tall[e] / 2, E.z[e], MASK.los, combatFlags(ctx));
}

/** the distance a spatial shot of this move flies from its muzzle (the legacy flight of the same move) */
export function shotReach(ctx: SimContext, s: MoveSpec): number {
  return s.range * ctx.rules.aim.reachMult + s.speed * ctx.rules.aim.reachPad;
}

/** R2: the horizontal fraction of the ray (cos of its pitch) below which the muzzle offset fades (rules.aim.muzzleFadeDeg) */
function muzzleFadeHl(ctx: SimContext): number {
  const deg = ctx.rules.aim.muzzleFadeDeg;
  return dcos((deg < 0 ? 0 : deg > 89.9 ? 89.9 : deg) * (Math.PI / 180));
}

/** The horizontal heading (unit x, z, written to HEAD) that the planar side of a spatial cast uses (facing, knockback,
 *  the beam's ground paint) for launch direction (ux, uz): its own heading; a launch straight up or down (no horizontal
 *  part) takes the crosshair ray's heading (R2 pole-safe aim), and only a ray that is itself vertical, which the
 *  pitch clamp never sends, the partner's facing */
export const HEAD = { x: 0, z: 1 };
export function launchHeading(ctx: SimContext, ux: number, uz: number): void {
  const hl = dhypot(ux, uz);
  if (hl > 1e-6) { HEAD.x = ux / hl; HEAD.z = uz / hl; return; }
  const ray = ctx.input.aim;
  if (ray) {
    const rl = dhypot(ray.dx, ray.dz);
    if (rl > 1e-6) { HEAD.x = ray.dx / rl; HEAD.z = ray.dz / rl; return; }
  }
  const f = ctx.player.facing;
  HEAD.x = dsin(f); HEAD.z = dcos(f);
}

/** CL-Q3: the world kinds that stop the eye's vertical pull-back (a solid over the body) */
const OVER = SK.wall | SK.deck | SK.terrain;
const UPHIT = new RayHit();
/** how far above the feet the vertical pull-back's ray starts (m): off the floor the feet rest on */
const UP_LIFT = 0.01;

/** The partner's eye point (CL-Q3), written to `out`: its feet + the anatomy table's `eye.up`, + `eye.fwd` (capped at
 *  the footprint radius) along the horizontal heading (hx, hz). A solid over the body below the eye (a low overhang, a
 *  deck underside) pulls the eye down to rules.aim.eyeGap under it; a wall between the body's axis and the eye puts it
 *  back on the axis. `ax, ay, az`: the axis point at the eye's height. Reads the world, changes nothing */
export const EYE = { x: 0, y: 0, z: 0, ax: 0, ay: 0, az: 0 };
export function eyePoint(ctx: SimContext, hx: number, hz: number, out = EYE): typeof EYE {
  const P = ctx.player, W = worldOf(ctx), sp = P.species, an = anatomyOf(sp, ctx.rules), cf = combatFlags(ctx);
  const foot = partnerFootprint(sp, ctx.rules) || partnerRadius(sp, ctx.rules);
  let up = an.eye.up;
  const fwd = an.eye.fwd < foot ? an.eye.fwd : foot;
  if (up > UP_LIFT && W.raycast(P.x, P.y + UP_LIFT, P.z, 0, 1, 0, up - UP_LIFT, OVER, UPHIT, 0, 0, cf)) {
    const y = UP_LIFT + UPHIT.t - ctx.rules.aim.eyeGap;
    up = y > 0 ? y : 0;
  }
  out.ax = P.x; out.ay = P.y + up; out.az = P.z;
  out.x = P.x + hx * fwd; out.y = out.ay; out.z = P.z + hz * fwd;
  if (fwd > 0 && !W.segmentClear(out.ax, out.ay, out.az, out.x, out.y, out.z, MASK.los, cf)) { out.x = out.ax; out.z = out.az; }
  return out;
}

const SEE = { x: 0, y: 0, z: 0, ax: 0, ay: 0, az: 0 };
/** CL-Q7, the information gate's query: does the player's eye see the point (x, y, z)? The eye is taken along the
 *  crosshair ray's heading (the partner's facing with no ray). A deterministic pure function of the sim state for the
 *  renderer: not part of the tick or the replay hash. Same sight test as the shot check (segmentClear, the attack cover
 *  policy) */
export function eyeSeesPoint(ctx: SimContext, x: number, y: number, z: number): boolean {
  const ray = ctx.input.aim, P = ctx.player;
  let hx = 0, hz = 0;
  const rl = ray ? dhypot(ray.dx, ray.dz) : 0;
  if (ray && rl > 1e-6) { hx = ray.dx / rl; hz = ray.dz / rl; } else { hx = dsin(P.facing); hz = dcos(P.facing); }
  const e = eyePoint(ctx, hx, hz, SEE);
  return worldOf(ctx).segmentClear(e.x, e.y, e.z, x, y, z, MASK.los, combatFlags(ctx));
}
/** CL-Q7: does the player's eye see live enemy i? Seen when either sample, its top or its centre, is visible
 *  (two rays at most). Partial visibility is ROADMAP F90 */
export function eyeSeesEnemy(ctx: SimContext, i: number): boolean {
  const E = ctx.enemies;
  return eyeSeesPoint(ctx, E.x[i], E.y[i] + E.tall[i], E.z[i]) || eyeSeesPoint(ctx, E.x[i], E.y[i] + E.tall[i] / 2, E.z[i]);
}

/** a body the partner is holding: its own shots pass it (effects.ts effectOnBody) */
const held = (ctx: SimContext, kind: number, id: number) => kind === SK.body && ctx.bodies.holdT[id] > 0;

/**
 * Resolve the spatial aim of move `s` for the player from ctx.input.aim into `out` (§ steps 1-4 above). Returns false
 * (out.on = false) when the input has no usable ray. Reads the world and the actors as they are now; changes nothing.
 */
export function resolveSpatial(ctx: SimContext, s: MoveSpec, out: AimState): boolean {
  out.on = false;
  const ray = ctx.input.aim, P = ctx.player, W = worldOf(ctx), R = ctx.rules.aim;
  if (!ray) return false;
  let dx = ray.dx, dy = ray.dy, dz = ray.dz;
  const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (!(L > 1e-6) || !Number.isFinite(ray.ox + ray.oy + ray.oz)) return false;
  dx /= L; dy /= L; dz /= L;

  // 2. the muzzle, on the ray's heading. R2: the full offset up to the fade pitch (hl ≥ h0, the pre-R2 expression), then
  // (dx, dz) / h0: linear in the horizontal fraction hl, 0 at the pole, no division by a vanishing hl and no facing
  const sp = P.species, m = muzzleOf(ctx, s);
  const up = partnerHeight(sp, ctx.rules) * m.up, fwd = (partnerFootprint(sp, ctx.rules) || partnerRadius(sp, ctx.rules)) * m.fwd;
  const hl = dhypot(dx, dz);
  const h0 = muzzleFadeHl(ctx), hx = hl >= h0 ? dx / hl : dx / h0, hz = hl >= h0 ? dz / hl : dz / h0;
  let cx = P.x, cy = P.y + up, cz = P.z;
  let mx = cx + hx * fwd, my = cy, mz = cz + hz * fwd;
  const cf = combatFlags(ctx);
  if (R.viewSight) {
    // CL-Q10, CL-Q13: the eye is the launch point and the trace starts at its plane
    const e = eyePoint(ctx, hx, hz);
    mx = cx = e.x; my = cy = e.y; mz = cz = e.z;
  } else if (!W.segmentClear(cx, cy, cz, mx, my, mz, MASK.los, cf)) { mx = cx; my = cy; mz = cz; }

  // 1. the camera trace, from the chest plane out (the eye's plane under rules.aim.viewSight)
  const vx0 = cx - ray.ox, vy0 = cy - ray.oy, vz0 = cz - ray.oz;
  let t0 = vx0 * dx + vy0 * dy + vz0 * dz;
  if (!(t0 > 0)) t0 = 0;
  const sx = ray.ox + dx * t0, sy = ray.oy + dy * t0, sz = ray.oz + dz * t0;
  CAMQ.flags = QF.skipInitialWorld | cf;
  sweep(ctx, sx, sy, sz, dx, dy, dz, R.sightRange, CAMQ, CAM);
  let tx = sx + dx * R.sightRange, ty = sy + dy * R.sightRange, tz = sz + dz * R.sightRange, kind = 0, id = -1;
  for (let k = 0; k < CAM.n; k++) {
    const kk = CAM.kind[k];
    if (!(kk & SK_WORLD) && held(ctx, kk, CAM.id[k])) continue;
    tx = CAM.x[k]; ty = CAM.y[k]; tz = CAM.z[k]; kind = kk; id = CAM.id[k];
    break;
  }

  // 3. the launch direction
  let ux = tx - mx, uy = ty - my, uz = tz - mz;
  const dist = Math.sqrt(ux * ux + uy * uy + uz * uz);
  if (dist < R.convergeMin || ux * dx + uy * dy + uz * dz <= 0) { ux = dx; uy = dy; uz = dz; }
  else { ux /= dist; uy /= dist; uz /= dist; }

  // 4. obstruction: the shot's (or beam's) own sweep toward T, with the move's pierce
  const beam = s.archetype === 'beam', reach = beam ? beamLength(ctx, s) : shotReach(ctx, s);
  MUZQ.actorR = s.radius; MUZQ.actorH = s.radius; MUZQ.worldR = beam ? R.beamWorldRadius : R.worldRadius; MUZQ.flags = cf;
  sweep(ctx, mx, my, mz, ux, uy, uz, dist, MUZQ, MUZ);
  let blocked = false, bk = 0, bx = 0, by = 0, bz = 0, pierce = s.pierce < 0 ? Infinity : s.pierce;
  for (let k = 0; k < MUZ.n; k++) {
    const kk = MUZ.kind[k], ki = MUZ.id[k];
    if (kk & SK_WORLD) {
      // the surface the crosshair is on ends the trace at T itself: not an obstruction
      if (MUZ.t[k] < dist - 1e-3 && !(kk === kind && ki === id && MUZ.t[k] > dist - 0.05)) { blocked = true; bk = kk; bx = MUZ.x[k]; by = MUZ.y[k]; bz = MUZ.z[k]; }
      break;
    }
    if (held(ctx, kk, ki)) continue;
    if (kk === kind && ki === id) break; // the crosshair's own target: reached
    if (!(pierce > 0)) { blocked = true; bk = kk; bx = MUZ.x[k]; by = MUZ.y[k]; bz = MUZ.z[k]; break; }
    pierce--;
  }

  out.on = true;
  out.ox = mx; out.oy = my; out.oz = mz; out.eye = R.viewSight;
  out.tx = tx; out.ty = ty; out.tz = tz; out.hitKind = kind; out.hitId = id;
  out.ux = ux; out.uy = uy; out.uz = uz;
  out.blocked = blocked; out.blockKind = bk; out.bx = bx; out.by = by; out.bz = bz;
  out.reach = reach; out.dist = dist;
  return true;
}
