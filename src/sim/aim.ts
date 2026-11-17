// Spatial aim (Phase 2B; docs/THIRD_PERSON_IMPLEMENTATION.md §13). The chase camera sends its crosshair ray as input
// (InputFrame.aim); the sim, never the renderer, decides what it means:
//
//   1. camera trace  the ray, from where it passes the partner's chest plane (so nothing between the lens and the
//                    Pokémon counts), out to rules.aim.sightRange: the first world solid, enemy or body it meets is the
//                    aim point T (with nothing there, T is the ray's end: firing into empty space)
//   2. muzzle        M = the partner's feet + up × its class height, + fwd × its footprint along the ray's heading
//                    (rules.aim.muzzle, overridden per archetype or move key by rules.aim.muzzleBy). A wall between the
//                    body's axis and M (a corner inside the body's own reach) puts M back on the axis
//   3. launch        u = (T − M) / |T − M|; an aim point within rules.aim.convergeMin of M, or behind it, fires along the
//                    crosshair ray instead
//   4. obstruction   the shot's own volume swept from M toward T: the first contact that would stop it (the world, or
//                    the actor that uses up its pierce) before T, when it is not what the crosshair is on, is reported as
//                    `blocked` with its point, the same answer the shot will meet in flight
//
// Beams (Phase 2C, §14) resolve the same way: the same camera trace, muzzle and launch direction, with the beam's length
// (range × area) as the reach and its own world radius (rules.aim.beamWorldRadius); moves.ts beam3D casts it.
// Every trace here and in the shots and beams uses one cover policy (combatFlags): foliage is open unless
// rules.aim.foliageCover (sim/spatial.ts header).
//
// Nothing here bends the aim toward an enemy (no magnetism) or leads a moving one: the shot goes where the crosshair is.
// The bot and the fixed views send no ray and stay on moves.ts's planar path (magnetism, lead), as every checksum set
// expects. Allocation-free: callers own the AimState, the contact lists and queries are module scratch.

import { Contacts, MASK, QF, SK, SK_WORLD, segmentClear, spatialQuery, sweep } from './spatial';
import { partnerFootprint, partnerHeight, partnerRadius } from '../rules/sizing';
import { dcos, dhypot, dsin } from '../core/detmath';
import type { AimState, MoveSpec, SimContext } from './types';

const CAM = new Contacts(32), MUZ = new Contacts(32);
/** the camera trace: what the crosshair can rest on (every actor reported in order; held bodies are skipped below). Off
 *  the map is not a surface: a crosshair over the edge is on empty space (the shot itself still ends at the bounds) */
const CAMQ = spatialQuery({ mask: MASK.camera & ~SK.bounds, block: SK.enemy | SK.body, pierce: Infinity, selfKind: SK.player, selfId: 0, flags: QF.skipInitialWorld });
/** the muzzle trace: the shot's own volume (radius set per call) */
const MUZQ = spatialQuery({ mask: MASK.shot, block: SK.enemy | SK.body, pierce: Infinity, selfKind: SK.player, selfId: 0 });

/** the query flags of every player attack trace (camera, muzzle, shot flight, beam): foliage is open air unless the
 *  rules make it cover (rules.aim.foliageCover, the Phase 2B behaviour) */
export function combatFlags(ctx: SimContext): number {
  return ctx.rules.aim.foliageCover ? 0 : QF.foliage;
}

/** a beam's length from its muzzle: the move's range × the partner's area multiplier (the planar beam's length) */
export function beamLength(ctx: SimContext, s: MoveSpec): number {
  return s.range * ctx.player.derived.area;
}

/** true when this cast takes the spatial path: the flag, a crosshair ray, a player-aimed cast and a migrated archetype */
export function spatialFor(ctx: SimContext, s: MoveSpec, manual: boolean, basic: boolean): boolean {
  const R = ctx.rules.aim, mode = ctx.rules.combat.mode;
  if (!R.spatial || !ctx.input.aim || !manual || mode === 'auto' || (basic && mode === 'assist')) return false;
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
  const P = ctx.player, E = ctx.enemies;
  const up = partnerHeight(P.species, ctx.rules) * muzzleOf(ctx, s).up;
  return segmentClear(ctx.world, P.x, P.y + up, P.z, E.x[e], E.y[e] + E.tall[e] / 2, E.z[e], MASK.los, combatFlags(ctx));
}

/** the distance a spatial shot of this move flies from its muzzle (the legacy flight of the same move) */
export function shotReach(ctx: SimContext, s: MoveSpec): number {
  return s.range * ctx.rules.aim.reachMult + s.speed * ctx.rules.aim.reachPad;
}

/** a body the partner is holding: its own shots pass it (effects.ts effectOnBody) */
const held = (ctx: SimContext, kind: number, id: number) => kind === SK.body && ctx.bodies.holdT[id] > 0;

/**
 * Resolve the spatial aim of move `s` for the player from ctx.input.aim into `out` (§ steps 1-4 above). Returns false
 * (out.on = false) when the input has no usable ray. Reads the world and the actors as they are now; changes nothing.
 */
export function resolveSpatial(ctx: SimContext, s: MoveSpec, out: AimState): boolean {
  out.on = false;
  const ray = ctx.input.aim, P = ctx.player, W = ctx.world, R = ctx.rules.aim;
  if (!ray) return false;
  let dx = ray.dx, dy = ray.dy, dz = ray.dz;
  const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (!(L > 1e-6) || !Number.isFinite(ray.ox + ray.oy + ray.oz)) return false;
  dx /= L; dy /= L; dz /= L;

  // 2. the muzzle, on the ray's heading (straight up or down: the partner's facing)
  const sp = P.species, m = muzzleOf(ctx, s);
  const up = partnerHeight(sp, ctx.rules) * m.up, fwd = (partnerFootprint(sp, ctx.rules) || partnerRadius(sp, ctx.rules)) * m.fwd;
  const hl = dhypot(dx, dz);
  const hx = hl > 1e-6 ? dx / hl : dsin(P.facing), hz = hl > 1e-6 ? dz / hl : dcos(P.facing);
  const cx = P.x, cy = P.y + up, cz = P.z;
  let mx = cx + hx * fwd, my = cy, mz = cz + hz * fwd;
  const cf = combatFlags(ctx);
  if (!segmentClear(W, cx, cy, cz, mx, my, mz, MASK.los, cf)) { mx = cx; my = cy; mz = cz; }

  // 1. the camera trace, from the chest plane out
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
  out.ox = mx; out.oy = my; out.oz = mz;
  out.tx = tx; out.ty = ty; out.tz = tz; out.hitKind = kind; out.hitId = id;
  out.ux = ux; out.uy = uy; out.uz = uz;
  out.blocked = blocked; out.blockKind = bk; out.bx = bx; out.by = by; out.bz = bz;
  out.reach = reach; out.dist = dist;
  return true;
}
