// Shared locomotion foundation (R6a, docs/LOCOMOTION.md). How a Pokémon body's velocity becomes motion, for any driver:
// the player's input today, AI steering after R7. Callers resolve their driver into an intent and the body's numbers;
// everything here works on those numbers alone (no Player, no pool, no ctx, no allocation).
//
// Integrators (a closed set; `volume` arrives in R6d):
//   supported  planar velocity eases toward the intent at the surface's grip, scaled by its footing speed
//   ballistic  planar velocity eases toward the intent at air control; gravity and the optional lift row act
//   scripted   an ability owns planar velocity for a duration (the dash and dash-shaped moves); support and gravity
//              still act underneath it, so a dash that runs off a ledge falls and a grounded dash can jump
// All three then share one body step (`advanceBody`): knockback decay, the planar move with the step rule and the
// footprint (World.moveBody), the jump take-off, gravity and lift, headroom, and the support (landing, slope stick,
// leaving the support). The integrator a tick runs follows from the body's state (`selectIntegrator`); the transitions
// it can make in one tick are supported → ballistic (jump pressed, support ends) and ballistic → supported (contact).
//
// Medium (`mediumAt`) is derived from the world at the body's position, never chosen: liquid, support or air.
//
// Allowed differences between drivers (§12.10 of the audit plan), named here so a later caller knows them: float32
// storage in pools (the caller rounds before the wall test and on store); no input buffering for AI. Enemy bodies keep
// their own motion code until R7 moves them onto these functions behind its flag; only the landing clear is shared now
// (it was already the same call on both sides).

import { dexp } from '../core/detmath';
import { clamp } from '../core/util';
import { HEAD_EPS, type World } from './world';

/** how velocity becomes motion this tick (stored as a small int so pools can hold it in R7) */
export const LOCO = { supported: 0, ballistic: 1, scripted: 2 } as const;
export type Integrator = (typeof LOCO)[keyof typeof LOCO];
/** what surrounds the body, derived from the world */
export const MEDIUM = { support: 0, air: 1, liquid: 2 } as const;
export type Medium = (typeof MEDIUM)[keyof typeof MEDIUM];

/** the locomotion state a body carries (Player.loco; EnemyPool columns in R7): what ran last tick, where it ended */
export interface LocoState { integrator: Integrator; medium: Medium }

/** a body's kinematic state. Player satisfies it directly; a pool driver loads one scratch body per creature */
export interface LocoBody {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  /** knockback velocity, decays on its own */
  kx: number; kz: number;
  grounded: boolean;
}

/** what the driver wants this tick, already in world axes. `mx, mz` (length ≤ 1) is the planar wish; `jump` is the held
 *  Jump. A supported step scales `mx, mz` by the surface's footing speed in place, so the caller reads the wish the body
 *  was driven by (the player's facing does). R6c adds `my` and `jumpPressed` */
export interface LocoIntent { mx: number; mz: number; jump: boolean }

/** the movement numbers a body reads (`rules.player`; per-template body numbers arrive with R6d / R6e) */
export interface LocoNumbers {
  gravity: number;
  jumpVelocity: number;
  /** m/s: the fall speed a body with lift holds while Jump is held */
  glideFallSpeed: number;
  /** m: the dry step a body walks up (and the step its landing clear uses) */
  stepHeight: number;
  /** 1/s: planar velocity response on a support (× the surface's grip) and in the air */
  groundAccel: number;
  airAccel: number;
  /** 1/s: knockback decays by exp(-knockDecay × dt) */
  knockDecay: number;
}

/** this tick's per-body numbers, from the caller's gameplay rules (speed modifiers, footing, liquids, size) */
export interface LocoTick {
  /** m/s planar top speed (species speed × buffs, liquid, carry, root …) and the stance factor applied after it (Brace) */
  speed: number; stance: number;
  /** the surface under a supported body: speed factor and grip (World footing; 1, 1 in the air) */
  footSpeed: number; grip: number;
  /** a jump may start (a liquid the body is exposed in can forbid it) */
  canJump: boolean;
  /** the lift row: holding Jump clamps the fall to glideFallSpeed (a glide template: traversalOf(species).glide) */
  lift: boolean;
  /** m: the step this tick's planar move walks up (stepHeight, or climbing out of a liquid) */
  stepUp: number;
  /** m: footprint radius against walls (0 = the centre-point look-ahead rule, size geometry off) */
  foot: number;
  /** m: body height against deck slabs, undefined = heads pass through slabs (headroom off) */
  tall: number | undefined;
  /** navigation lattice for the rock recovery (wide footprints route on navblocks) */
  wide: boolean;
}

/** what the step did, for the caller's events */
export interface LocoResult { jumped: boolean }

/** m: centre-point look-ahead of the legacy planar move (size geometry off) */
const AHEAD = 0.35;
/** m: a grounded body going down a slope sticks to it within this drop */
const STICK = 0.35;
/** m: a fall or drop deeper than this clears the footprint on landing */
const LAND_CLEAR = 0.3;

const MOVE: [number, number] = [0, 0];

/** the integrator a tick runs, from the body's state at the start of the tick */
export const selectIntegrator = (scripted: boolean, grounded: boolean): Integrator =>
  scripted ? LOCO.scripted : grounded ? LOCO.supported : LOCO.ballistic;

/** the medium at a body's position: a liquid it is in contact with, else its support, else air */
export const mediumAt = (W: World, b: LocoBody, contact: number): Medium =>
  W.liquidAt(b.x, b.z, b.y, contact) ? MEDIUM.liquid : b.grounded ? MEDIUM.support : MEDIUM.air;

/** supported: velocity eases toward the wish at the surface's grip; the wish is scaled by the footing speed */
export function driveSupported(b: LocoBody, it: LocoIntent, t: LocoTick, L: LocoNumbers, dt: number) {
  const accel = Math.min(1, L.groundAccel * t.grip * dt);
  it.mx *= t.footSpeed; it.mz *= t.footSpeed;
  b.vx += (it.mx * t.speed * t.stance - b.vx) * accel;
  b.vz += (it.mz * t.speed * t.stance - b.vz) * accel;
}

/** ballistic: velocity eases toward the wish at air control */
export function driveBallistic(b: LocoBody, it: LocoIntent, t: LocoTick, L: LocoNumbers, dt: number) {
  const accel = Math.min(1, L.airAccel * dt);
  b.vx += (it.mx * t.speed * t.stance - b.vx) * accel;
  b.vz += (it.mz * t.speed * t.stance - b.vz) * accel;
}

/** scripted: the ability owns planar velocity (unit direction × speed) */
export function driveScripted(b: LocoBody, dx: number, dz: number, speed: number) {
  b.vx = dx * speed;
  b.vz = dz * speed;
}

/** a body that dropped onto the ground at `ground` may stand in the lip (faces were measured from its feet on the way
 *  down): push its footprint clear (World.moveBody's push). Shared by the player and the enemy pool */
export function clearLanding(W: World, x: number, z: number, ground: number, step: number, foot: number, tall: number | undefined, out: [number, number]) {
  W.moveBody(x, z, 0, 0, ground, step, foot, out, undefined, tall);
}

/** the planar move with the terrain step rule, axis-separated sliding. Only solid geometry stops it (World.collides):
 *  open liquid and open air are entered, by walking or by being knocked */
function movePlanar(W: World, b: LocoBody, t: LocoTick, dt: number) {
  const stepX = (b.vx + b.kx) * dt, stepZ = (b.vz + b.kz) * dt;
  const feet = b.y, stepUp = t.stepUp, tall = t.tall;
  let nx = b.x + stepX, nz = b.z + stepZ;
  if (t.foot > 0) {
    // size geometry on: the footprint against walls and faces (World.moveBody, docs/SIZING.md "Footprint"): it glides
    // round corners, never cuts one, and a Large or Extra Large body does not fit a one-tile gap
    W.moveBody(b.x, b.z, stepX, stepZ, feet, stepUp, t.foot, MOVE, undefined, tall);
    nx = MOVE[0]; nz = MOVE[1];
  } else {
    const blocked = (x: number, z: number) => W.collides(x, z, feet, stepUp, tall);
    const ax = Math.sign(stepX) * AHEAD, az = Math.sign(stepZ) * AHEAD;
    if (blocked(nx + ax, nz + az)) {
      if (!blocked(nx + ax, b.z)) nz = b.z;
      else if (!blocked(b.x, nz + az)) nx = b.x;
      else { nx = b.x; nz = b.z; }
    }
    // location maps: the look-ahead test can pass on a diagonal while the landing point itself is a wall (corner
    // cutting); beside a chasm that would drop the body into it, so test where the step actually lands too
    if (W.los && blocked(nx, nz)) {
      if (!blocked(nx, b.z)) nz = b.z;
      else if (!blocked(b.x, nz)) nx = b.x;
      else { nx = b.x; nz = b.z; }
    }
  }
  const bd = W.bound;
  b.x = clamp(nx, -bd, bd);
  b.z = clamp(nz, -bd, bd);
}

/** vertical: take-off, gravity and lift, headroom, then the support (landing, slope stick, leaving it) */
function moveVertical(W: World, b: LocoBody, it: LocoIntent, t: LocoTick, L: LocoNumbers, dt: number, y0: number, out: LocoResult) {
  if (it.jump && b.grounded && t.canJump) {
    b.vy = L.jumpVelocity;
    b.grounded = false;
    out.jumped = true;
  }
  b.vy -= L.gravity * dt;
  if (t.lift && it.jump && b.vy < -L.glideFallSpeed) b.vy = -L.glideFallSpeed;
  b.y += b.vy * dt;
  // headroom: a rising head stops at the lowest deck underside over the footprint (the jump's speed is spent there, then
  // gravity brings it down). A head already in a slab (a body evolved under one) rises no further. Falling is never
  // clamped: a body dropping past a deck's edge is not pulled down by it
  const tall = t.tall;
  if (tall !== undefined && b.vy > 0) {
    const top = W.headroomAt(b.x, b.z, y0, t.foot);
    if (b.y + tall > top + HEAD_EPS) { b.y = Math.max(y0, top - tall); b.vy = 0; }
  }
  // the supporting surface: -Infinity over open air (a chasm), so gravity takes over where support ends
  const g = W.support(b.x, b.z, b.y);
  if (b.y <= g) {
    if (t.foot > 0 && !b.grounded && y0 - g > LAND_CLEAR) { clearLanding(W, b.x, b.z, g, L.stepHeight, t.foot, tall, MOVE); b.x = MOVE[0]; b.z = MOVE[1]; }
    b.y = g;
    b.vy = 0;
    b.grounded = true;
  } else if (b.grounded && b.y - g < STICK && b.vy <= 0) {
    b.y = g; b.vy = 0; // stick to slopes going down
  } else {
    b.grounded = false;
  }
}

/** location maps: never left inside rock (a shove or knockback through a corner): back to footing. A chasm is not rock
 *  (hazards on: World.wallAt is false there), so a real fall is never pulled back to the lip. (A walker standing on a
 *  deck is above the ground's wall: on location maps nothing solid ever sits under a deck, so this only matters where a
 *  habitat causeway spans sealed ground) */
function recoverFromRock(W: World, b: LocoBody, t: LocoTick) {
  if (!(W.los && W.wallAt(b.x, b.z) && !(W.over && W.node(b.x, b.z, b.y) >= W.w * W.h))) return;
  [b.x, b.z] = t.foot > 0 ? W.nearestFit(b.x, b.z, t.foot, t.wide, true, t.tall) : W.nearestWalkable(b.x, b.z);
  b.y = W.height(b.x, b.z, b.y); b.vy = 0; b.grounded = true;
}

/** the body step every integrator shares, after its drive set the planar velocity */
export function advanceBody(W: World, b: LocoBody, it: LocoIntent, t: LocoTick, L: LocoNumbers, dt: number, out: LocoResult) {
  out.jumped = false;
  const y0 = b.y;
  const kd = dexp(-L.knockDecay * dt);
  b.kx *= kd; b.kz *= kd;
  movePlanar(W, b, t, dt);
  moveVertical(W, b, it, t, L, dt, y0, out);
  recoverFromRock(W, b, t);
}

/** one supported tick: drive on the surface, then the shared body step */
export function stepSupported(W: World, b: LocoBody, it: LocoIntent, t: LocoTick, L: LocoNumbers, dt: number, out: LocoResult) {
  driveSupported(b, it, t, L, dt);
  advanceBody(W, b, it, t, L, dt, out);
}

/** one ballistic tick: air control, then the shared body step */
export function stepBallistic(W: World, b: LocoBody, it: LocoIntent, t: LocoTick, L: LocoNumbers, dt: number, out: LocoResult) {
  driveBallistic(b, it, t, L, dt);
  advanceBody(W, b, it, t, L, dt, out);
}

/** one scripted tick: the ability's velocity (unit direction × speed), then the shared body step */
export function stepScripted(W: World, b: LocoBody, it: LocoIntent, dx: number, dz: number, speed: number, t: LocoTick, L: LocoNumbers, dt: number, out: LocoResult) {
  driveScripted(b, dx, dz, speed);
  advanceBody(W, b, it, t, L, dt, out);
}
