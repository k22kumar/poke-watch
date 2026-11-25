// Shared locomotion foundation (R6a, docs/LOCOMOTION.md). How a Pokémon body's velocity becomes motion, for any driver:
// the player's input today, AI steering after R7. Callers resolve their driver into an intent and the body's numbers;
// everything here works on those numbers alone (no Player, no pool, no ctx, no allocation).
//
// Integrators (a closed set; `volume` arrives in R6d):
//   supported  planar velocity eases toward the intent at the surface's grip, scaled by its footing speed
//   ballistic  planar velocity eases toward the intent at air control; gravity and the optional lift row act
//   scripted   an ability owns planar velocity for a duration (the dash and dash-shaped moves); support and gravity
//              still act underneath it, so a dash that runs off a ledge falls and a grounded dash can jump
// All three then share one body step (`advanceBody`): knockback decay, the jump take-off, gravity and lift, then a
// resolver turns the tick's translation into where the body ends (docs/LOCOMOTION.md "Resolvers"). The flag picks the
// resolver, never the integrator:
//   tiles      the planar move with the step rule and the footprint (World.moveBody), headroom, the support (landing,
//              slope stick, leaving the support), as before I1b
//   controller rules.physics.engine 'rapier' (I1b): the world's `mover`, Rapier's character controller with our own step
//              rule (physics/controller.ts): it slides, keeps a body supported by the tile model's own rule at the axis
//              (a drop under STICK + g·dt² is walked down, a deeper one falls, every class; ROADMAP F66), lands it where
//              the tile body lands, stops a rising head, and says whether the body stands on something
// The integrator a tick runs follows from the body's state (`selectIntegrator`); the transitions it can make in one tick
// are supported → ballistic (jump pressed, support ends) and ballistic → supported (contact).
//
// Medium (`mediumAt`) is derived from the world at the body's position, never chosen: liquid, support or air.
//
// Controls (R6c, `jumpControl`, the §12.6 state machine of the audit plan): what the Jump press does in each state.
// An intent with `jumpPressed` (an edge-sending driver: the game's input) jumps on the press, buffered and with coyote
// time, and never repeats from a held Jump; an intent without it keeps the legacy held rule exactly. The vertical
// intent `my` (ascend − descend) is carried for the volume integrator (R6d); no integrator here reads it. Look pitch is
// not an input of anything in this file (invariant 4: looking up or down never changes altitude).
//
// Allowed differences between drivers (§12.10 of the audit plan), named here so a later caller knows them: float32
// storage in pools (the caller rounds before the wall test and on store); no input buffering for AI. Enemy bodies keep
// their own motion code until R7 moves them onto these functions behind its flag; only the landing clear is shared now
// (it was already the same call on both sides).

import { dexp } from '../core/detmath';
import { clamp } from '../core/util';
import type { AirPress } from '../rules/traversal';
import { HEAD_EPS } from './world';
import { GROUND, type BodyMove, type BodyMover, type WorldQuery } from './worldquery';

/** how velocity becomes motion this tick (stored as a small int so pools can hold it in R7) */
export const LOCO = { supported: 0, ballistic: 1, scripted: 2 } as const;
type Integrator = (typeof LOCO)[keyof typeof LOCO];
/** what surrounds the body, derived from the world */
export const MEDIUM = { support: 0, air: 1, liquid: 2 } as const;
type Medium = (typeof MEDIUM)[keyof typeof MEDIUM];

/** the locomotion state a body carries (Player.loco; EnemyPool columns in R7): what ran last tick, where it ended */
export interface LocoState { integrator: Integrator; medium: Medium }

/** what the Jump control does on a tick (`jumpControl`). `airJump` is the double jump; `takeoff` enters volume × air,
 *  which arrives with the volume integrator in R6d (no validated template can reach it before then) */
export const ACT = { none: 0, jump: 1, airJump: 2, takeoff: 3 } as const;
type JumpAct = (typeof ACT)[keyof typeof ACT];

/** jump acceptance a body carries between ticks (Player.ctl), in whole ticks of sim time so replays agree (§12.6, R6c).
 *  Only an edge-sending intent (`jumpPressed` present) reads or writes it; legacy intents leave it untouched (zero) */
export interface JumpControl {
  /** ticks a press not yet spent stays eligible for a ground jump (rules.player.jumpBuffer) */
  buffer: number;
  /** ticks left to ground-jump after the support ended without a jump (rules.player.coyote) */
  coyote: number;
  /** the airborne press was spent this airtime (a double jump is once per airtime; landing restores it) */
  airSpent: boolean;
}

/** a body's kinematic state. Player satisfies it directly; a pool driver loads one scratch body per creature */
export interface LocoBody {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  /** knockback velocity, decays on its own */
  kx: number; kz: number;
  grounded: boolean;
  /** jump acceptance (R6c): written only for edge-sending intents. AI drivers send none (no input buffering for AI) */
  ctl: JumpControl;
}

/** what the driver wants this tick, already in world axes. `mx, mz` (length ≤ 1) is the planar wish; `jump` is the held
 *  Jump. A supported step scales `mx, mz` by the surface's footing speed in place, so the caller reads the wish the body
 *  was driven by (the player's facing does).
 *  R6c: `jumpPressed` is Jump's rising edge this tick. Present = the driver sends edges (the §12.6 rules: jump on the
 *  press, buffered, with coyote time, no repeat from holding); absent = legacy (held Jump jumps whenever supported).
 *  `my` is the vertical intent, ascend − descend in −1..1 (absent = 0), read only by the volume integrator (R6d) */
export interface LocoIntent { mx: number; mz: number; jump: boolean; jumpPressed?: boolean; my?: number }

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
  /** s: a Jump press stays eligible for a ground jump this long after it (edge-sending intents; rounded to whole ticks) */
  jumpBuffer: number;
  /** s: a body that left its support without jumping may still ground-jump this long (edge-sending intents; ticks) */
  coyote: number;
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
  /** what an airborne Jump press means for this body (traversalOf(species).airPress, §12.6 rule 1): 'none', a
   *  'doubleJump' once per airtime, or 'takeoff' (R6d). Read only for edge-sending intents */
  airPress: AirPress;
  /** m: the step this tick's planar move walks up (stepHeight, or climbing out of a liquid) */
  stepUp: number;
  /** m: footprint radius against walls (World.moveBody) */
  foot: number;
  /** m: body height against deck slabs, undefined on a map with no decks */
  tall: number | undefined;
  /** m: the body's height on the controller (I1b, ROADMAP F72): on every map, decks or none (the tile resolver reads
   *  `tall`). Absent: `tall`, else the footprint's size class height (tests' plain bodies) */
  height?: number;
  /** navigation lattice for the rock recovery (wide footprints route on navblocks) */
  wide: boolean;
  /** R1b wall tops (docs/SIZING.md "Wall tops"): the explicit permission to cross above a wall prop's finite top
   *  (World.wallTop). With it the planar move passes over a top the feet clear, a descent stops at the top without
   *  landing (World.topUnder: the body keeps its integrator and is not grounded), and the rock recovery leaves a body
   *  above a top alone. Absent or false: walls are solid to any height, as before. No driver sets it before R6d, where a
   *  traversal template grants it */
  over?: boolean;
}

/** what the step did, for the caller's events */
export interface LocoResult { jumped: boolean }

/** m: a grounded body going down a slope sticks to it within this drop */
const STICK = 0.35;
/** m: a fall or drop deeper than this clears the footprint on landing */
const LAND_CLEAR = 0.3;

const MOVE: [number, number] = [0, 0];
/** the controller's scratch move (I1b) */
const BM: BodyMove = { x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 0, r: 0, h: undefined, stepUp: 0, supported: false, onGround: false, ceiling: false, stepped: false };

/** whole ticks of a duration in seconds (the jump buffer and coyote windows) */
const ticksOf = (s: number, dt: number) => Math.max(0, Math.round(s / dt));

/** The Jump control (§12.6 of the audit plan, R6c): what Jump does this tick for a body in integrator `integ`, evaluated
 *  from its state at the start of the tick.
 *
 *  Legacy intent (no `jumpPressed`): held Jump jumps whenever the body is supported and may jump (the pre-R6c rule,
 *  bit for bit; holding repeats a jump on every landing). `ctl` is not touched.
 *
 *  Edge intent (`jumpPressed` present, true or false):
 *  | state                  | Jump pressed (edge)                                         | Jump held            |
 *  | supported              | ground jump; if it cannot (exposed in a liquid) the press   | no repeat jump       |
 *  |                        | waits in the buffer                                         |                      |
 *  | ballistic, coyote left | ground jump (walked off a ledge within the coyote window)   | glide (lift row)     |
 *  | ballistic              | the template's airPress: doubleJump once per airtime,       | glide (lift row)     |
 *  |                        | takeoff (R6d), or none, when the press waits in the buffer   |                      |
 *  | scripted (Dash)        | ground jump when supported (the Dash declares it: today's   | as its support state |
 *  |                        | "a grounded dash can jump"); air presses are ignored        |                      |
 *  A buffered press only ever makes a ground jump, on the first supported tick inside the window; an airborne meaning
 *  (double jump, take-off) needs a press on its own tick, so the press that started a jump can never also double jump
 *  or take off, and holding never takes off. Descend and `my` mean nothing in these states (volume only, R6d). */
export function jumpControl(b: LocoBody, it: LocoIntent, t: LocoTick, L: LocoNumbers, dt: number, integ: Integrator): JumpAct {
  if (it.jumpPressed === undefined) return it.jump && b.grounded && t.canJump ? ACT.jump : ACT.none;
  const c = b.ctl;
  if (b.grounded) { c.coyote = ticksOf(L.coyote, dt); c.airSpent = false; }
  if (it.jumpPressed) c.buffer = ticksOf(L.jumpBuffer, dt) + 1; // eligible this tick and for the window after it
  let act: JumpAct = ACT.none;
  if (c.buffer > 0 && t.canJump && (b.grounded || c.coyote > 0)) act = ACT.jump;
  else if (it.jumpPressed && !b.grounded && integ !== LOCO.scripted && t.canJump) {
    if (t.airPress === 'doubleJump' && !c.airSpent) act = ACT.airJump;
    else if (t.airPress === 'takeoff') act = ACT.takeoff;
  }
  if (act !== ACT.none) {
    c.buffer = 0; c.coyote = 0;
    if (act !== ACT.jump) c.airSpent = true;
  } else {
    if (c.buffer > 0) c.buffer--;
    if (!b.grounded && c.coyote > 0) c.coyote--;
  }
  return act;
}

/** the integrator a tick runs, from the body's state at the start of the tick */
export const selectIntegrator = (scripted: boolean, grounded: boolean): Integrator =>
  scripted ? LOCO.scripted : grounded ? LOCO.supported : LOCO.ballistic;

/** the medium at a body's position: a liquid it is in contact with, else its support, else air */
export const mediumAt = (W: WorldQuery, b: LocoBody, contact: number): Medium =>
  W.liquidContact(b.x, b.y, b.z, contact) ? MEDIUM.liquid : b.grounded ? MEDIUM.support : MEDIUM.air;

/** supported: velocity eases toward the wish at the surface's grip; the wish is scaled by the footing speed */
function driveSupported(b: LocoBody, it: LocoIntent, t: LocoTick, L: LocoNumbers, dt: number) {
  const accel = Math.min(1, L.groundAccel * t.grip * dt);
  it.mx *= t.footSpeed; it.mz *= t.footSpeed;
  b.vx += (it.mx * t.speed * t.stance - b.vx) * accel;
  b.vz += (it.mz * t.speed * t.stance - b.vz) * accel;
}

/** ballistic: velocity eases toward the wish at air control */
function driveBallistic(b: LocoBody, it: LocoIntent, t: LocoTick, L: LocoNumbers, dt: number) {
  const accel = Math.min(1, L.airAccel * dt);
  b.vx += (it.mx * t.speed * t.stance - b.vx) * accel;
  b.vz += (it.mz * t.speed * t.stance - b.vz) * accel;
}

/** scripted: the ability owns planar velocity (unit direction × speed) */
function driveScripted(b: LocoBody, dx: number, dz: number, speed: number) {
  b.vx = dx * speed;
  b.vz = dz * speed;
}

/** a body that dropped onto the ground at `ground` may stand in the lip (faces were measured from its feet on the way
 *  down): push its footprint clear (World.moveBody's push). Shared by the player and the enemy pool */
export function clearLanding(W: WorldQuery, x: number, z: number, ground: number, step: number, foot: number, tall: number | undefined, out: [number, number], over?: boolean) {
  W.moveFootprint(x, ground, z, 0, 0, step, foot, out, undefined, tall, over);
}

/** the planar move with the terrain step rule, axis-separated sliding. Only solid geometry stops it (World.collides):
 *  open liquid and open air are entered, by walking or by being knocked */
function movePlanar(W: WorldQuery, b: LocoBody, t: LocoTick, dt: number) {
  const stepX = (b.vx + b.kx) * dt, stepZ = (b.vz + b.kz) * dt;
  const feet = b.y, stepUp = t.stepUp, tall = t.tall;
  // the footprint against walls and faces (World.moveBody, docs/SIZING.md "Footprint"): it glides round corners, never
  // cuts one, and a Large or Extra Large body does not fit a one-tile gap
  W.moveFootprint(b.x, feet, b.z, stepX, stepZ, stepUp, t.foot, MOVE, undefined, tall, t.over);
  const nx = MOVE[0], nz = MOVE[1];
  const bd = W.bound;
  b.x = clamp(nx, -bd, bd);
  b.z = clamp(nz, -bd, bd);
}

/** the vertical drive both resolvers share: the Jump control (jump, double jump), gravity and lift */
function driveVertical(b: LocoBody, it: LocoIntent, t: LocoTick, L: LocoNumbers, dt: number, integ: Integrator, out: LocoResult) {
  const act = jumpControl(b, it, t, L, dt, integ);
  if (act === ACT.jump || act === ACT.airJump) {
    b.vy = L.jumpVelocity;
    b.grounded = false;
    out.jumped = true;
  }
  // ACT.takeoff: volume × air arrives in R6d; validateTraversal keeps every template from reaching it until then
  b.vy -= L.gravity * dt;
  if (t.lift && it.jump && b.vy < -L.glideFallSpeed) b.vy = -L.glideFallSpeed;
}

/** vertical on the tile model: the vertical drive, headroom, then the support (landing, slope stick, leaving it) */
function moveVertical(W: WorldQuery, b: LocoBody, it: LocoIntent, t: LocoTick, L: LocoNumbers, dt: number, y0: number, integ: Integrator, out: LocoResult) {
  driveVertical(b, it, t, L, dt, integ, out);
  b.y += b.vy * dt;
  // headroom: a rising head stops at the lowest deck underside over the footprint (the jump's speed is spent there, then
  // gravity brings it down). A head already in a slab (a body evolved under one) rises no further. Falling is never
  // clamped: a body dropping past a deck's edge is not pulled down by it
  const tall = t.tall;
  if (tall !== undefined && b.vy > 0) {
    const top = W.headroomOver(b.x, y0, b.z, t.foot);
    if (b.y + tall > top + HEAD_EPS) { b.y = Math.max(y0, top - tall); b.vy = 0; }
  }
  // R1b: a body with the crossing permission that was over a wall prop's top before this move stops at it (swept: from
  // its feet at the start of the tick). Only the downward speed is spent; grounded, the integrator and the support below
  // are untouched, so this is not a landing (standing on tops is a later phase)
  if (t.over) {
    const top = W.topBelow(b.x, y0, b.z, t.foot);
    if (b.y < top) { b.y = top; if (b.vy < 0) b.vy = 0; }
  }
  // the supporting surface: -Infinity over open air (a chasm), so gravity takes over where support ends
  const g = W.supportAt(b.x, b.y, b.z);
  if (b.y <= g) {
    if (t.foot > 0 && !b.grounded && y0 - g > LAND_CLEAR) { clearLanding(W, b.x, b.z, g, L.stepHeight, t.foot, tall, MOVE); b.x = MOVE[0]; b.z = MOVE[1]; }
    b.y = g;
    b.vy = 0;
    b.grounded = true;
  } else if (b.grounded && b.y - g < STICK && b.vy <= 0) {
    b.y = g; b.vy = 0; // stick to slopes going down
  } else {
    b.grounded = false;
    // still airborne: faces are measured from the feet as they fall (World.overlap), so the ledge a body is dropping past
    // becomes a face during the tick its feet come within a step of the floor below. The planar move was resolved at the
    // tick's starting feet, so push the footprint clear at its new feet now, not on the next tick's move (navwalk
    // location seed 3: an Extra Large body ended a tick 0.13 m inside the ledge)
    if (t.foot > 0) { clearLanding(W, b.x, b.z, b.y, t.stepUp, t.foot, tall, MOVE, t.over); b.x = MOVE[0]; b.z = MOVE[1]; }
  }
}

/** location maps: never left inside rock (a shove or knockback through a corner): back to footing. A chasm is not rock
 *  (hazards on: World.wallAt is false there), so a real fall is never pulled back to the lip. (A walker standing on a
 *  deck is above the ground's wall: on location maps nothing solid ever sits under a deck, so this only matters where a
 *  habitat causeway spans sealed ground) */
function recoverFromRock(W: WorldQuery, b: LocoBody, t: LocoTick) {
  // R1b: World.inRock is World.wallAt for a body without the crossing permission; with it, a body at or above a wall
  // prop's top is over the rock, not in it
  const T = W.tiles;
  if (!(T.los && W.insideRock(b.x, b.y, b.z, t.over) && !(T.over && T.node(b.x, b.z, b.y) >= T.w * T.h))) return;
  [b.x, b.z] = t.foot > 0 ? W.place(b.x, GROUND, b.z, t.foot, t.wide, true, t.tall) : W.nearestWalkableAt(b.x, GROUND, b.z);
  b.y = W.surfaceAt(b.x, b.y, b.z); b.vy = 0; b.grounded = true;
}

/** The controller resolver (I1b, rules.physics.engine 'rapier'): the vertical drive, then the whole translation (planar
 *  velocity and knockback, the vertical speed) through the world's character controller in one move. It slides along
 *  what it meets, keeps a supported body supported by the tile model's stick at its axis (F66), climbs rises up to
 *  `stepUp` by the step rule (only from a support, not on a take-off), stops a rising head (the jump's speed is spent),
 *  and says whether the body stands on something: grounded is that, unless the body is still rising. Liquids are floors at their surface (the tile
 *  model's swim kind: contact at the surface; WORLDGEN3D Q9's depth modes are I4's). Not used: `over` (no driver sets it
 *  before R6d; a wall prop's column is solid to any height here), the landing clear (a capsule never stands in a lip) */
function resolveOnController(M: BodyMover, W: WorldQuery, b: LocoBody, it: LocoIntent, t: LocoTick, L: LocoNumbers, dt: number, integ: Integrator, out: LocoResult) {
  driveVertical(b, it, t, L, dt, integ, out);
  const m = BM;
  m.x = b.x; m.y = b.y; m.z = b.z;
  m.dx = (b.vx + b.kx) * dt; m.dy = b.vy * dt; m.dz = (b.vz + b.kz) * dt;
  m.r = t.foot; m.h = t.height ?? t.tall; m.stepUp = t.stepUp; m.supported = b.grounded;
  M.move(m);
  const bd = W.bound;
  b.x = clamp(m.x, -bd, bd); b.y = m.y; b.z = clamp(m.z, -bd, bd);
  if (m.ceiling && b.vy > 0) b.vy = 0;
  if (m.onGround && b.vy <= 0) { b.vy = 0; b.grounded = true; } else b.grounded = false;
}

/** the body step every integrator shares, after its drive set the planar velocity (`integ`: which one ran, for the
 *  Jump control). The world's mover, when it has one (physics), is the resolver; else the tile model's */
function advanceBody(W: WorldQuery, b: LocoBody, it: LocoIntent, t: LocoTick, L: LocoNumbers, dt: number, integ: Integrator, out: LocoResult) {
  out.jumped = false;
  const y0 = b.y;
  const kd = dexp(-L.knockDecay * dt);
  b.kx *= kd; b.kz *= kd;
  const M = t.foot > 0 ? W.mover : null;
  if (M) resolveOnController(M, W, b, it, t, L, dt, integ, out);
  else {
    movePlanar(W, b, t, dt);
    moveVertical(W, b, it, t, L, dt, y0, integ, out);
  }
  recoverFromRock(W, b, t);
}

/** The shoves one system's loop gives a body (I1b): on physics they are summed and resolved in one controller move after
 *  the loop (`flushShoves`), where the tile model moves the footprint at each shove (a crowd of 500 shoving the partner
 *  one controller move each cost 2 ms a tick). Caller-owned, one per system */
export interface Shoves { dx: number; dz: number; n: number; step: number; foot: number; tall: number | undefined }
/** a fresh accumulator (a function declaration: enemies.ts and bodies.ts make theirs at module load, and the sim's
 *  import cycle can load them before this module's body has run) */
export function newShoves(): Shoves { return { dx: 0, dz: 0, n: 0, step: 0, foot: 0, tall: undefined }; }

/** Push a body's footprint by (dx, dz) (a crowd or a resting body shoving the partner): the tile model's footprint move
 *  at once; on physics added to `acc`, for `flushShoves` to resolve. Keeps velocity and support */
export function pushFootprint(W: WorldQuery, b: LocoBody, dx: number, dz: number, step: number, foot: number, tall: number | undefined, acc: Shoves) {
  if (W.mover) { acc.dx += dx; acc.dz += dz; acc.n++; acc.step = step; acc.foot = foot; acc.tall = tall; return; }
  W.moveFootprint(b.x, b.y, b.z, dx, dz, step, foot, MOVE, undefined, tall);
  b.x = MOVE[0]; b.z = MOVE[1];
}

/** Resolve the summed shoves through the controller (physics; no vertical intent, the step rule from a support) and clear
 *  them. Nothing to do on tiles, where each shove already moved the body */
export function flushShoves(W: WorldQuery, b: LocoBody, acc: Shoves) {
  if (acc.n === 0) return;
  const M = W.mover;
  if (M) {
    const m = BM;
    m.x = b.x; m.y = b.y; m.z = b.z; m.dx = acc.dx; m.dy = 0; m.dz = acc.dz;
    m.r = acc.foot; m.h = acc.tall; m.stepUp = acc.step; m.supported = b.grounded;
    M.move(m);
    b.x = m.x; b.y = m.y; b.z = m.z;
  }
  acc.dx = acc.dz = 0; acc.n = 0;
}

/** one supported tick: drive on the surface, then the shared body step */
export function stepSupported(W: WorldQuery, b: LocoBody, it: LocoIntent, t: LocoTick, L: LocoNumbers, dt: number, out: LocoResult) {
  driveSupported(b, it, t, L, dt);
  advanceBody(W, b, it, t, L, dt, LOCO.supported, out);
}

/** one ballistic tick: air control, then the shared body step */
export function stepBallistic(W: WorldQuery, b: LocoBody, it: LocoIntent, t: LocoTick, L: LocoNumbers, dt: number, out: LocoResult) {
  driveBallistic(b, it, t, L, dt);
  advanceBody(W, b, it, t, L, dt, LOCO.ballistic, out);
}

/** one scripted tick: the ability's velocity (unit direction × speed), then the shared body step */
export function stepScripted(W: WorldQuery, b: LocoBody, it: LocoIntent, dx: number, dz: number, speed: number, t: LocoTick, L: LocoNumbers, dt: number, out: LocoResult) {
  driveScripted(b, dx, dz, speed);
  advanceBody(W, b, it, t, L, dt, LOCO.scripted, out);
}
