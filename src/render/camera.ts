// Camera presets compared in docs/CAMERA.md. The fixed presets keep the north-up yaw, the 16 px/m pixel
// grid and integer upscaling; they differ in pitch and in how many internal lines (how much of the
// arena) fit on screen. The 'chase' preset is the third-person rig (docs/THIRD_PERSON.md): a low,
// over-the-shoulder camera behind the Pokémon that the player orbits with the mouse or right stick.
import { classOutline, idealArm, pivotHeight, type IdealArm, type Outline } from './framing';

export interface CameraPreset {
  id: string; name: string; pitch: number; fov: number; lines: number; note: string;
  /** look-at shift toward the camera (m): puts the player higher on screen so threats from the south show earlier */
  frameZ?: number;
  /** 'chase' = third-person rig (free yaw, perspective, no texel snapping); absent = the fixed north-up view */
  mode?: 'chase';
}

export const CAMERA_PRESETS: CameraPreset[] = [
  { id: 'chase', name: 'Third person', pitch: 0.16, fov: 64, lines: 400, mode: 'chase', note: 'Low, over the shoulder of your Pokémon. Mouse or right stick turns the camera and aims.' },
  { id: 'classic', name: 'Classic', pitch: 0.82, fov: 30, lines: 250, note: 'The original 47° view.' },
  { id: 'steep', name: 'Overhead', pitch: 0.98, fov: 30, lines: 250, note: 'A steeper 56° view: less hidden behind trees, shorter jumps on screen.' },
  { id: 'wide', name: 'Wide', pitch: 0.86, fov: 30, lines: 330, frameZ: 2, note: 'About 50 % more arena on screen at a smaller pixel scale, framed to balance warning distance.' },
];
// the product direction is third person; the fixed views stay selectable (and are what the old captures use)
export const CAMERA_DEFAULT = 'chase';
export const cameraPreset = (id: string | undefined) => CAMERA_PRESETS.find((p) => p.id === id) ?? CAMERA_PRESETS.find((p) => p.id === CAMERA_DEFAULT)!;


// ----------------------------------------------------------------------------------------------------------
// Third-person rig (docs/THIRD_PERSON.md "Camera" and "Composition"). Pure maths (no GL, no DOM, never touches the sim)
// so it can be unit-tested. One stable combat framing, attached to the Pokémon and turned only by the player:
//
//   anchor = the Pokémon's feet exactly where they are drawn this frame (no follow lag in any axis)
//   pivot  = anchor + up * pivotH: on the top of the sprite's outline as drawn (render/framing.ts pivotHeight); past
//            the orbit range it stays where that range left it (chasePivotH)
//   hand   = pivot + right * shoulder: far enough to the side that the outline's right edge is `reticle.side` left of
//            the crosshair
//   lens   = hand - arm(yaw, elevation) * back: the arm sits `reticle.below` over the view axis, so the outline's top
//            stays that far under the crosshair line whatever the back distance
//   view   = the player's yaw and pitch, nothing else (the axis is the crosshair ray: screen centre)
//
// What wins when they conflict (the rig's stages run in this order):
//   P1  always: the lens keeps `lens.clear` from terrain, bare walls, deck undersides and the map edge, on every drawn
//       frame and every view sample. Props are not solids for the lens: they dissolve (render/tilestage.ts)
//   P2  always: the view direction is the player's yaw and pitch. Nothing here turns it
//   P3  when it fits: the composition above. It holds while no wall takes the shoulder, no slab the pivot, and the
//       pitch is inside the orbit range (CHASE_CONFIG.elevation)
//   P4  otherwise: the renderer dissolves the Pokémon by how far its drawn frame is inside the keep-out (framing.ts fadeFor)
//
//   1 ideal      the arm for the sprite's measured outline (framing.ts idealArm): one fixed figure per sprite
//   2 clearance  two sweeps, sideways then back: how much of each arm the world leaves free, unsmoothed
//   3 smoothing  the lens comes in at a capped speed, hopping only what is in its own way (boomTime.in: its own point is
//                never within lens.clear of a solid), and the arm eases back out after a hold; the
//                grounded step of a tile edge is taken up at a capped rate; a deck's cap on the elevation is eased
//   4 final      the composed lens is checked once more for P1 (clearLens) after a frame's yaw, pitch and step offset
//
// Nothing depends on enemies, combat, speed, animation, the Pokémon's traversal mode or the direction it moves in.
// Every number lives in CHASE_CONFIG.
// ----------------------------------------------------------------------------------------------------------

/** Every camera tuning value. Angles in degrees, distances in metres, times in seconds. */
export const CHASE_CONFIG = {
  /** framing from the sprite as it is drawn (render/framing.ts; the outline is measured from the art, assets/measure.ts):
   *  back distance = `boom` × (the body's drawn height / `ref`) ^ `exp`, inside [`min`, `max`]: one law for every sprite.
   *  The drawn height is the outline's top plus what it draws below its anchor (a PMD anchor is the middle of the
   *  footprint; the picture reaches a fifth of its height below it at the median, three quarters for a few). With the top
   *  pinned `reticle.below` under the crosshair line and exp 1, every body's lowest drawn point lands at about the same
   *  height in the frame (0.88 to 0.94 of it): over the HUD's move bar in a 1080p window, at most 2 % of the frame under
   *  it at 720p (scripts/camframe.ts "HUD"). `settle`: smoothing (s) when the squad tags a Pokémon with another outline
   *  (an evolution or any size change counts: the outline changes). `max` 14 (F3, docs/size-extremes-plan.md; was 9):
   *  the law itself sets every partner's distance under it, the largest giant (Eternatus, capture-only) wanting 13.75 m,
   *  so no partner is held short of its framing */
  frame: { ref: 1.9, boom: 4.3, exp: 1, min: 1.8, max: 14, settle: 0.45 },
  /** the keep-out around the crosshair (degrees, render/framing.ts): the player's own Pokémon lies left of `side` or
   *  below `below`. The outline's top-right corner is put on the keep-out's lower-left corner: `below` is how far the arm
   *  sits over the view axis, `side` sets the shoulder offset. `reach`: the most the fixed combat allowance may move that
   *  corner (attack, shoot, charge and hurt frames that reach past the body's outline; framing.ts reserveCorner) */
  reticle: { side: 7, below: 3, reach: 4, rise: 0 },
  /** the shoulder offset is at most this share of the back distance (a body too long for it sideways is listed by
   *  scripts/camframe.ts; its side rows fall to the fade) */
  shoulderMax: 0.6,
  /** the vertical field of view (deg) before the player's offset (Settings: Field of view), and the reachable range */
  fov: 64,
  fovRange: [40, 85] as [number, number],
  /** the player owns the view direction (Phase 4A / R3, docs/THIRD_PERSON_IMPLEMENTATION.md §16, §19): the view axis (the
   *  crosshair ray) is `neutral` + the player's pitch, inside `up` degrees above and `down` below the horizon. The arm's
   *  elevation follows the pitch (boomElevation: view pitch + `reticle.below`, inside `elevation`); past the elevation
   *  cap it rises with the view (owner decision C, the 40° start approved 2026-11-17); under a deck CHASE_CONFIG.deck
   *  caps it. `tiltMax`: the most the subject tilt may add (chaseTilt, F3): a partner whose neutral crosshair would meet
   *  flat ground past `aim.max` is framed with just enough extra pitch to bring it back to `aim.max`; every other partner
   *  gets none */
  aimPitch: { neutral: 11, up: 89, down: 89, tiltMax: 10 },
  /** R3 (§19, audit F9): billboards seen from steeper than the stretch can square (acos(1 / 1.6) = 51.3°, the shaders'
   *  stretch cap) lean back by the excess, top away from a lens above them (toward one below), so from overhead a sprite
   *  keeps the height it has at 51.3° instead of flattening into a sliver. Below 51.3° nothing changes. False: upright */
  lean: true,
  /** R3 (decision B): the edge cue for the player's own Pokémon once it has left the frame (looking up).
   *  `fade`: how far past the frame edge (fraction of the half-screen) the cue takes to reach full opacity */
  cue: { fade: 0.15 },
  /** the arm's elevation is kept inside this (deg) below the overhead rise: the orbit range */
  elevation: [2, 40] as [number, number],
  /** grounded steps: the sim moves a supported body up or down a tile edge (0.25 and 0.5 m are the common ones, up to
   *  rules.player.stepHeight) in one tick. While the body is on the ground (ChaseFrame.grounded: the sim's own flag over
   *  the span drawn; a synthetic frame without it: within `ground` m of the support under it at both ends of a rig tick),
   *  the rig's height follows it at no more than `rate` m/s and never more than `max` m behind (a rate-limited stair
   *  smoothing, both ways): a ramp or stairs climbed slower than `rate` is followed exactly, a 0.5 m step is taken up in
   *  0.125 s instead of in one tick. The renderer draws the Pokémon's sprite with the same offset (ChaseRig.spriteStep),
   *  so the Pokémon does not move in the frame either, up to `sprite` × the outline's top: the offset puts the drawn
   *  feet under the tile just climbed, and all of a 0.5 m step hid more than half of 12 of the 68 sprites on its first
   *  frame (0.43 m of a body 0.5 to 0.8 m tall). At 0.35 that happens to one (Diglett), 48 sprites still take a 0.5 m
   *  step whole, and the 20 smallest move against the lens on its first frame instead (11 of them by over 0.1 m).
   *  In the air the rig follows the body 1:1 */
  step: { rate: 4, max: 0.6, ground: 0.05, sprite: 0.35 },
  /** P1: the lens, and every point of the arm, stays `clear` m from terrain, bare walls and deck undersides (the near
   *  plane is 0.3 m): over a floor, under a slab, and beside rock or a wall along x and z */
  lens: { clear: 0.3 },
  /** a deck over the back arm caps its elevation so the lens stays `clearance` m under the slab above any point of the
   *  arm's ground track (down to `minElev` degrees), and a slab over the Pokémon, beside it or over the shoulder arm
   *  lowers the pivot to `clearance` under it. Both come in over `enter` s and go over `exit` s (critically damped), so
   *  walking under or out from under a deck does not move the lens in one frame; the cap also eases the overhead rise
   *  out under a deck and back in after one (R3). The track is tested out to `reach` of the back distance, so the cap is
   *  coming in before the lens itself is under the slab, and a slab within `near` m of the Pokémon starts the pivot coming
   *  down. Where the Pokémon is going plays no part */
  deck: { clearance: 0.45, minElev: -5, enter: 0.2, exit: 0.3, reach: 1.2, near: 2 },
  /** arm response: each arm comes in to what its sweep leaves free and goes back out over `out` s (critically damped)
   *  once there has been room for `hold` s. Coming in, the lens travels at no more than `in` m/s (a quarter metre a
   *  frame at 60 fps) along the straight line to where the shortened arm puts it, and hops only across the stretch of
   *  that line that is itself within `lens.clear` of a solid: what cuts an arm is usually a wall's end or a ridge's
   *  corner crossing it near the Pokémon, with free air on the lens's own way in (measured: in three of four cuts of
   *  over a metre the line had 1.3 m of rock on it or less). Coming in all at once, as the first version of the second
   *  pass did, moved the lens over 1 m in a frame 2.3 times a minute in the forest and 4.3 in the cave (up to 8 m); the
   *  lens point itself is never in a solid either way. Only what is in the way moves the arm: never the direction the
   *  Pokémon moves in, how fast the view turns, or a prop */
  boomTime: { out: 0.45, hold: 0.25, in: 15 },
  /** the planar aim point is kept this far from the Pokémon (m) */
  aim: { min: 4, max: 26 },
  /** the longest step the rig takes at once (s): longer frames are split (see ChaseRig.update) */
  tick: 1 / 120,
};
/** where the aim crosshair sits on screen, as a fraction of height from the top (0.5 = the view axis) */
export const RETICLE_Y = 0.5;

export interface ChaseFrame {
  dt: number;
  /** interpolated player position (feet), exactly where it is drawn this frame */
  x: number; y: number; z: number;
  /** the sprite's outline as drawn (render/framing.ts Outline: the body's top and reach, the combat frames' corners):
   *  sets the whole arm. Absent (a synthetic frame, a run with no art decoded) = classOutline(`visual` ?? `height`) */
  outline?: Outline;
  /** the size class's body height and visible core (m, rules/sizing.ts bodyOf): only the fallback outline reads them */
  height: number;
  visual?: number;
  /** the body was on its support over the whole latest span (the sim's Player.pgrounded && grounded: the previous tick
   *  and the latest), for the stair smoothing. The motion between two frames lies in that span or the one before it
   *  (drawn near the start of a span, a frame shows the previous one's end), so a step is taken up when this frame or the
   *  last one says so; a frame in the air on both never is. A property of the sim's ticks, not of when frames fall, so
   *  the smoothing decides the same at every frame rate. Absent (synthetic frames) = within CHASE_CONFIG.step.ground of
   *  `ground` under it now and at the rig's last tick */
  grounded?: boolean;
  /** look input this frame: radians of yaw (+ turns the camera to the right: the view direction is (sin yaw, cos yaw), so a right turn lowers yaw) and of pitch (+ looks down) */
  lookYaw: number; lookPitch: number;
  /** terrain height under (x, z) */
  ground: (x: number, z: number) => number;
  /** underside of an overhead deck above the Pokémon at (x, z), Infinity where open sky (layered maps) */
  ceiling?: (x: number, z: number) => number;
  /** something solid that is neither floor nor deck occupies the point (a bare wall: rock mass, cave wall, the map edge
   *  is ground): the lens stays out of it. Props are not solids for the lens */
  solid?: (x: number, y: number, z: number) => boolean;
}

/** One immutable sample of the third-person view (docs/THIRD_PERSON.md, "View-state contract"): everything that places
 *  the crosshair ray, taken together at one instant. The host takes one per frame, after the frame's look input and
 *  before the frame's sim ticks, and every tick of that frame aims with it (render/hostframe.ts). Position, direction,
 *  projection and viewport always belong to the same rig state; nothing in it is a live reference into the rig. */
export interface ViewSample {
  /** lens position (m) */
  readonly eye: readonly [number, number, number];
  /** unit view axis (the screen centre) */
  readonly dir: readonly [number, number, number];
  /** view yaw (rad; the view direction is (sin yaw, cos yaw)) and the axis' pitch below the horizon (rad) */
  readonly yaw: number; readonly viewPitch: number;
  /** the player's own pitch offset (deg) the sample includes */
  readonly userPitch: number;
  /** vertical field of view (rad) */
  readonly fov: number;
  /** viewport (CSS px) and its aspect, and where the crosshair sits (fraction of height from the top) */
  readonly width: number; readonly height: number; readonly aspect: number; readonly reticleY: number;
}
/** what chaseAim reads: a ViewSample, or the rig itself (its public fields are its composed view) */
export interface AimView { readonly eye: readonly [number, number, number]; readonly yaw: number; readonly viewPitch: number; readonly fov: number }

export interface ChaseSettings {
  /** the band the player's pitch offset is clamped to (deg, + looks down): lookPitchRange() */
  pitchRange: [number, number];
  /** FOV offset the player chose (deg), -10..+12 */
  fovOffset: number;
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
/** critically damped easing towards a target (no overshoot, no jump at the start, continuous velocity whatever the frame
 *  rate); returns [value, velocity]. `maxSpeed` caps the speed (units/s). */
export function smoothDamp(cur: number, target: number, vel: number, smoothTime: number, dt: number, maxSpeed = Infinity): [number, number] {
  if (dt <= 0) return [cur, vel];
  const om = 2 / Math.max(1e-3, smoothTime), x = om * dt, e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const maxCh = maxSpeed * smoothTime;
  const ch = clamp(cur - target, -maxCh, maxCh), t = cur - ch, tmp = (vel + om * ch) * dt;
  let out = t + (ch + tmp) * e, v = (vel - om * tmp) * e;
  // never past the target
  if ((target - cur > 0) === (out > target)) { out = target; v = 0; }
  return [out, v];
}
const D2R = Math.PI / 180;
const CFG = CHASE_CONFIG;

/** the band (deg, + looks down) the player's pitch offset `userPitch` is clamped to: the absolute view limits
 *  (CHASE_CONFIG.aimPitch up / down about the horizon) expressed around the neutral pitch */
export function lookPitchRange(): [number, number] {
  const A = CFG.aimPitch;
  return [-A.up - A.neutral, A.down - A.neutral];
}
/** the view axis' pitch below the horizon (rad) for a pitch offset about the neutral pitch (the player's own pitch plus
 *  the subject tilt) */
const ownedPitch = (up: number) => (CFG.aimPitch.neutral + up) * D2R;

/** The ideal arm for a subject (CHASE_CONFIG.frame, .reticle, .shoulderMax; render/framing.ts idealArm): the frame's
 *  outline, or the fallback for a subject with no measured art. `tilt`: its subject tilt (chaseTilt) */
export function chaseArm(f: { outline?: Outline; height: number; visual?: number }): IdealArm & { tilt: number } {
  const I = idealArm(f.outline ?? classOutline(f.visual ?? f.height), CFG.frame, CFG.reticle, CFG.shoulderMax);
  return { ...I, tilt: chaseTilt(I) };
}

/** Where the neutral view axis meets flat ground (m ahead of the feet, along the yaw) for an ideal arm with `tilt`
 *  degrees of extra pitch: the lens on the arm at the elevation that pitch gives (boomElevation), the pivot on the
 *  outline's top as drawn (chasePivotH). This is criterion E4's ground point (scripts/camframe.ts composition) */
export function neutralGround(I: IdealArm, tilt: number): number {
  const v = (CFG.aimPitch.neutral + tilt) * D2R;
  if (v <= 1e-6) return Infinity;
  const el = boomElevation(tilt), e = el * D2R, ph = chasePivotH(I.top, I.back, I.shoulder, el);
  return -I.back * Math.cos(e) + (ph + I.back * Math.sin(e)) / Math.tan(v);
}

/** The subject tilt (deg, F3; docs/THIRD_PERSON_IMPLEMENTATION.md §26): zero for every subject whose neutral crosshair
 *  meets flat ground within CHASE_CONFIG.aim.max, otherwise just enough extra pitch to bring that point back to
 *  `aim.max` (at most `aimPitch.tiltMax`). One fixed figure per outline, like the ideal arm: the rig eases it over
 *  `frame.settle` when the outline changes (a tag swap, an evolution, any size change). A deliberate, condition-bound
 *  exception to §24.2's "the crosshair ray does not move without input" */
export function chaseTilt(I: IdealArm): number {
  const max = CFG.aim.max;
  if (neutralGround(I, 0) <= max) return 0;
  let lo = 0, hi = CFG.aimPitch.tiltMax;
  if (neutralGround(I, hi) > max) return hi;
  for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2; if (neutralGround(I, m) > max) lo = m; else hi = m; }
  return hi;
}

/** The arm's elevation (deg, before a deck) for the player's pitch offset `up`: the view pitch + reticle.below, inside
 *  CHASE_CONFIG.elevation, and never below the view pitch (R3, owner decisions C and E). Up to the elevation cap the arm
 *  sits `reticle.below` over the view axis (the composition's vertical term); past it the lens rises with the view
 *  (elevation = view pitch): the crosshair ray then passes the pivot's vertical line at the pivot, so its ground point
 *  stays ahead of the feet and moves toward them as the view goes down, and the lens never swings faster than the look.
 *  `overhead` scales the rise, 0..1 (0: the elevation without it). Continuous in `up`. */
export function boomElevation(up: number, overhead = 1): number {
  const E = CFG.elevation, A = CFG.aimPitch, p = A.neutral + up, e = clamp(p + CFG.reticle.below, E[0], E[1]);
  return p <= e ? e : e + (p - e) * overhead;
}

/** The pivot's height over the feet for an arm of `back` m and `shoulder` m at `elevDeg`: on the outline's top as the
 *  shader draws it (framing.ts pivotHeight) through the orbit range (CHASE_CONFIG.elevation). Past it, in the overhead
 *  rise, the pivot stays where the orbit range left it: the lens then rises on an arc of constant length about a fixed
 *  point, so the Pokémon keeps its size as the view goes down (a pivot that kept following the leaning card's top stood
 *  5 to 6 outline heights up at 89°: the lens 8 m over a Tiny, 24 m over an Extra Large). The composition is not
 *  promised there; the fade is */
export function chasePivotH(top: number, back: number, shoulder: number, elevDeg: number): number {
  return pivotHeight(top, back, shoulder, Math.min(elevDeg, CFG.elevation[1])).h;
}

interface TickOut { px: number; py: number; pz: number; pivotH: number; eye: [number, number, number]; fov: number; boom: number; shoulder: number; gap: number; yaw: number; up: number; stepY: number }
const blankTick = (): TickOut => ({ px: 0, py: 0, pz: 0, pivotH: 0.9, eye: [0, 0, 0], fov: 64 * D2R, boom: 3.5, shoulder: 0, gap: 3.5, yaw: Math.PI, up: 0, stepY: 0 });

export class ChaseRig {
  yaw = Math.PI;
  /** the player's own pitch offset about the neutral pitch (deg, + looks down) */
  userPitch = 0;
  fovOffset = 0;
  /** the pivot base: the Pokémon's feet as drawn, raised by the step being absorbed (stepOffset) */
  px = 0; py = 0; pz = 0;
  /** height of the pivot above the feet (m) */
  pivotH = 0.9;
  eye: [number, number, number] = [0, 0, 0];
  /** a point on the view axis, 20 m from the lens */
  target: [number, number, number] = [0, 0, 0];
  /** vertical field of view (rad) and the view axis' pitch below the horizon (rad) */
  fov = 64 * D2R; viewPitch = 0.1;
  /** the back distance in use (m): from the hand to the lens */
  boomUsed = 3.5;
  /** the shoulder offset in use (m): from the pivot to the hand, to the right */
  shoulderUsed = 0;
  /** the ideal arm for the Pokémon framed (stage 1; eased when the squad tags one with another outline): back distance,
   *  shoulder offset, and the outline corner the composition pins (m, before the stretch) */
  backWant = 3.5; shoulderWant = 0.8; cornerTop = 1.4; cornerRight = 0.7;
  /** what the world left free of each arm at the last tick (stage 2, unsmoothed, m) */
  backFree = 3.5; shoulderFree = 0.8;
  /** ticks or frames on which the composed lens had to be brought in for P1 (clearLens): the step offset, a turn or a
   *  held arm put it within `lens.clear` of something. A diagnostic (scripts/camstats.ts `slides`) */
  groundPops = 0;
  /** distance from the lens to the pivot (m): under ~0.95 m the lens is at the Pokémon and the renderer fades it */
  lensGap = 3.5;
  /** the vertical offset (m) the rig has from the body this frame: a grounded step not yet taken up (CHASE_CONFIG.step);
   *  0 almost always */
  get stepOffset() { return this.fStep; }
  /** the part of that offset the renderer draws the Pokémon's sprite with: all of it up to `step.sprite` × the outline's
   *  top. The shadow, the ground ring, the hurtbox, the muzzle and the shots stay where the body is */
  get spriteStep() { const m = Math.min(CFG.step.max, CFG.step.sprite * this.cornerTop); return clamp(this.fStep, -m, m); }
  private fStep = 0;
  private sideT = 1; private sideV = 0; private sideClear = 0; // the share of the shoulder in use, its rate, and how long there has been room
  private colT = 1; private colV = 0; private clearT = 1; // the same for the back distance
  private ready = false;
  private wantV = [0, 0, 0, 0]; private sizeSet = false;
  /** the subject tilt in force (deg, chaseTilt): eased over frame.settle toward the outline's own; it adds to the
   *  player's pitch everywhere the rig turns a pitch into a view or an arm elevation */
  tilt = 0; private tiltV = 0;
  /** the look band last given to update() (lookPitchRange()), kept so the tilt's easing keeps the view inside it */
  private band: [number, number] = [-Infinity, Infinity];
  /** the Pokémon's last tick height and support state (the stair smoothing). The rig keeps no velocity: where the
   *  Pokémon is going never moves the camera */
  private ly = 0; private lGround = false;
  /** the last frame's ChaseFrame.grounded: the motion between two frames may lie in the span before the latest one */
  private fGround = false;
  /** the grounded step not yet taken up (m, the rig's height less the body's), at the last tick */
  private stepY = 0;
  /** the last tick's elevation was set by a deck over the arm (the slab, not the player's pitch) */
  private coveredTk = false;
  /** the eased cap (deg) the decks over the arm put on its elevation (90: no slab), and how far a slab over the Pokémon
   *  lowers the pivot (m), with their rates */
  private slabLim = 90; private slabV = 0; private pivDrop = 0; private pivDropV = 0;
  /** the next update follows a snap: take the clearance answer at once instead of easing to it */
  private fresh = false;
  /** the rig's clock (s), its last and next tick, and the yaw and the Pokémon's position at the end of the last drawn
   *  frame (the ticks interpolate from them) */
  private clock = 0; private lastTick = 0; private nextTick = 0;
  private frameYaw = Math.PI; private ix = 0; private iy = 0; private iz = 0;
  /** what the last two ticks produced (the frame is drawn between them) */
  private tk: TickOut = blankTick(); private tkPrev: TickOut = blankTick(); private tkFirst = true;
  /** the world as the last frame gave it (its probes): look() checks P1 against it between frames */
  private world: ChaseFrame | null = null;
  /** the composed lens before P1's last check (clearLens): look() turns this one, so a view it composes is exactly the
   *  one update() would with no time passed, whatever the check did to the frame before */
  private raw: [number, number, number] = [0, 0, 0];

  /** hard reset onto the player (stage change, new run, a respawn) */
  snapTo(x: number, y: number, z: number, yaw = this.yaw) {
    this.px = x; this.py = y; this.pz = z; this.yaw = yaw; this.ready = true;
    this.frameYaw = yaw; this.ix = x; this.iy = y; this.iz = z;
    this.clock = 0; this.lastTick = 0; this.nextTick = 0; this.tkFirst = true; this.tk = { ...blankTick(), px: x, py: y, pz: z };
    this.colT = 1; this.colV = 0; this.clearT = 1; this.sideT = 1; this.sideV = 0; this.sideClear = 1;
    this.wantV = [0, 0, 0, 0]; this.sizeSet = false; this.tiltV = 0;
    this.ly = y; this.lGround = false; this.fGround = false; this.stepY = 0; this.fStep = 0;
    this.fresh = true; this.coveredTk = false;
    this.slabLim = 90; this.slabV = 0; this.pivDrop = 0; this.pivDropV = 0;
    this.raw = [x, y, z];
  }

  /** One drawn frame. The rig itself runs on a fixed clock of CHASE_CONFIG.tick (120 Hz), whatever the frame rate: the
   *  Pokémon's position and the yaw are interpolated to each tick's exact time, so every hold timer and threshold
   *  (clearance, steps) is decided at the same instants on the same inputs at 30, 60 or 144 fps. The frame then takes
   *  the arm (the lens relative to the pivot) between the last two ticks and puts it on the Pokémon where it is drawn
   *  now, turned to the yaw and swung for the pitch the player has now: the body never moves in the frame because the
   *  camera lags it, and look input has no added latency. Last, P1 is checked on the composed lens. */
  update(f: ChaseFrame, opt: ChaseSettings = { pitchRange: lookPitchRange(), fovOffset: this.fovOffset }) {
    if (!this.ready) this.snapTo(f.x, f.y, f.z);
    this.world = f;
    const dt = clamp(f.dt, 0, 0.25), h = CFG.tick;
    const y1 = wrap(this.yaw - f.lookYaw);
    const y0 = this.frameYaw, dY = wrap(y1 - y0);
    this.fovOffset = clamp(opt.fovOffset, -10, 12);
    this.band = opt.pitchRange;
    this.userPitch = clamp(this.userPitch + f.lookPitch / D2R, opt.pitchRange[0] - this.tilt, opt.pitchRange[1] - this.tilt);
    const t0 = this.clock, t1 = t0 + dt;
    const x0 = this.ix, h0 = this.iy, z0 = this.iz;
    while (this.nextTick <= t1 + 1e-9) {
      const u = dt > 0 ? clamp((this.nextTick - t0) / dt, 0, 1) : 1;
      this.yaw = wrap(y0 + dY * u);
      this.step({ ...f, dt: this.fresh ? 0 : h, x: x0 + (f.x - x0) * u, y: h0 + (f.y - h0) * u, z: z0 + (f.z - z0) * u, lookYaw: 0, lookPitch: 0 });
      const was = this.tk;
      this.tk = { px: this.px, py: this.py, pz: this.pz, pivotH: this.pivotH, eye: this.eye.slice() as [number, number, number], fov: this.fov, boom: this.boomUsed, shoulder: this.shoulderUsed, gap: this.lensGap, yaw: this.yaw, up: this.userPitch, stepY: this.stepY };
      this.tkPrev = this.tkFirst ? this.tk : was; this.tkFirst = false;
      this.lastTick = this.nextTick; this.nextTick += h;
    }
    this.clock = t1; this.frameYaw = y1; this.ix = f.x; this.iy = f.y; this.iz = f.z;
    // the frame: the arm between the last two ticks, on the Pokémon where it is now, turned to the yaw (and swung for
    // the pitch) the player has now
    // (an arm that came in between the two ticks is taken as the later tick has it: a lens still on its way in would be
    // where the sweep has just found something)
    const A = this.tkPrev, B = this.tk, a = B.boom < A.boom - 1e-6 || B.shoulder < A.shoulder - 1e-6 ? 1 : clamp((t1 - this.lastTick) / h, 0, 1), mix = (p: number, q: number) => p + (q - p) * a;
    const dyAB = wrap(B.yaw - A.yaw), yawAt = A.yaw + dyAB * a;
    this.yaw = y1;
    const ax = mix(A.px, B.px), az = mix(A.pz, B.pz);
    // the rig's height at the frame's own time: the stair smoothing run on from the last tick over the part of a tick
    // since (not kept: the next tick redoes it), so the drawn height is continuous across a tile edge
    const S = CFG.step, m = S.rate * Math.max(0, t1 - this.lastTick);
    let sY = B.stepY;
    if (f.grounded === undefined ? Math.abs(f.y - f.ground(f.x, f.z)) < S.ground && this.lGround : f.grounded || this.fGround) sY -= f.y - B.py;
    sY = clamp(Math.abs(sY) <= m ? 0 : sY - Math.sign(sY) * m, -S.max, S.max);
    this.fGround = !!f.grounded;
    this.fStep = sY;
    this.px = f.x; this.py = f.y + sY; this.pz = f.z;
    this.pivotH = mix(A.pivotH, B.pivotH);
    this.boomUsed = mix(A.boom, B.boom); this.shoulderUsed = mix(A.shoulder, B.shoulder); this.lensGap = mix(A.gap, B.gap); this.fov = mix(A.fov, B.fov);
    this.viewPitch = ownedPitch(this.userPitch + this.tilt);
    const d = wrap(y1 - yawAt), cd = Math.cos(d), sd = Math.sin(d);
    // the arm: the ticks' lens relative to the ticks' anchor (the feet, plus the step not yet taken up)
    const ex = mix(A.eye[0], B.eye[0]) - ax, ey = mix(A.eye[1] - A.py - A.stepY, B.eye[1] - B.py - B.stepY), ez = mix(A.eye[2], B.eye[2]) - az;
    this.eye = [f.x + ex * cd + ez * sd, this.py + ey, f.z - ex * sd + ez * cd];
    // the player's pitch also sets the arm's elevation (step): pitch input since the ticks swings the lens about the
    // pivot now, as the yaw does, instead of a tick later (zero once a tick has run with it)
    this.swingLens(this.elevFor(mix(A.up, B.up)), this.elevFor(this.userPitch));
    this.raw = [this.eye[0], this.eye[1], this.eye[2]];
    this.clearLens();
    const vc = Math.cos(this.viewPitch), vs = Math.sin(this.viewPitch), fy = Math.sin(y1), fz = Math.cos(y1);
    this.target = [this.eye[0] + fy * vc * 20, this.eye[1] - vs * 20, this.eye[2] + fz * vc * 20];
  }

  /** the arm elevation (deg) the player's pitch `up` gives, as the tick composes it (only differences are used:
   *  swingLens); under a deck the slab decides it, so pitch does not move the lens there */
  private elevFor(up: number) {
    return this.coveredTk ? 0 : boomElevation(up + this.tilt);
  }

  /** Swing the composed lens for a change of the arm's elevation from `e0` to `e1` degrees, as a tick would compose it:
   *  about the pivot's sideways axis (the one the hand lies on), and with the pivot itself moved to where it stands at the
   *  new elevation (it sits on the outline's top as drawn, and the stretch the sprite is drawn with follows the lens) */
  private swingLens(e0: number, e1: number) {
    if (e0 === e1) return;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw), oy = this.py + this.pivotH;
    const rx = this.eye[0] - this.px, ry = this.eye[1] - oy, rz = this.eye[2] - this.pz;
    const back = -(rx * fx + rz * fz), lx = rx + fx * back, lz = rz + fz * back; // behind the pivot, and across
    const R = Math.hypot(back, ry), e = Math.atan2(ry, back) + (e1 - e0) * D2R;
    const b2 = R * Math.cos(e);
    const dH = this.coveredTk ? 0 : chasePivotH(this.cornerTop, this.boomUsed, this.shoulderUsed, e1) - chasePivotH(this.cornerTop, this.boomUsed, this.shoulderUsed, e0);
    this.pivotH += dH;
    this.eye = [this.px + lx - fx * b2, oy + dH + R * Math.sin(e), this.pz + lz - fz * b2];
  }

  /** P1's test: is the point within `lens.clear` of a solid: less than that over the floor or under a deck's underside
   *  there, in a bare wall, or beside rock, a wall or a slab that stands `lens.clear` away along x or z */
  private blocked(f: ChaseFrame, x: number, y: number, z: number): boolean {
    const c = CFG.lens.clear;
    if (y < f.ground(x, z) + c || (!!f.ceiling && y > f.ceiling(x, z) - c) || (!!f.solid && f.solid(x, y, z))) return true;
    for (let k = 0; k < 4; k++) {
      const qx = x + (k === 0 ? c : k === 1 ? -c : 0), qz = z + (k === 2 ? c : k === 3 ? -c : 0);
      if (y < f.ground(qx, qz) || (!!f.ceiling && y > f.ceiling(qx, qz)) || (!!f.solid && f.solid(qx, y, qz))) return true;
    }
    return false;
  }

  /** is the point in a solid: under the floor, over a deck's underside, or in a bare wall */
  private inside(f: ChaseFrame, x: number, y: number, z: number): boolean {
    return y < f.ground(x, z) || (!!f.ceiling && y > f.ceiling(x, z)) || (!!f.solid && f.solid(x, y, z));
  }

  /** How far a point can go from (ax, ay, az) along the unit (dx, dy, dz), up to `len` m, before it is blocked: sampled
   *  every 0.25 m at most (walls are a metre thick), then bisected, so the answer is continuous as the Pokémon walks.
   *  The start is where the body or the arm already is: it counts as free unless it is in a solid, and so does the
   *  first stretch out of it (twice `lens.clear`) while that is only close to something, not in it: a Pokémon pressed
   *  into a corner has its pivot inside the walls' clearance, and its arm still leaves that place for the first clear
   *  point beyond. 0 when the way never gets clear */
  private sweep(f: ChaseFrame, ax: number, ay: number, az: number, dx: number, dy: number, dz: number, len: number, every = 0.25): number {
    if (!(len > 0)) return 0;
    if (this.inside(f, ax, ay, az)) return 0;
    const n = Math.max(1, Math.ceil(len / every)), grace = 2 * CFG.lens.clear;
    let out = !this.blocked(f, ax, ay, az), prev = 0; // `out`: a clear point has been met; `prev`: the last sample that was free to pass
    for (let i = 1; i <= n; i++) {
      const t = (len * i) / n, x = ax + dx * t, y = ay + dy * t, z = az + dz * t;
      if (!this.blocked(f, x, y, z)) { out = true; prev = t; continue; }
      if (!out) {
        if (t <= grace + 1e-9 && !this.inside(f, x, y, z)) { prev = t; continue; }
        return 0;
      }
      let lo = prev, hi = t;
      for (let k = 0; k < 7; k++) { const q = (lo + hi) / 2; if (this.blocked(f, ax + dx * q, ay + dy * q, az + dz * q)) hi = q; else lo = q; }
      return lo;
    }
    return out ? len : 0;
  }

  /** P1 on the composed lens (stage 4): where the step offset, a turn since the last tick or a held arm leaves the lens
   *  within `lens.clear` of a solid, it comes in along the back arm to the nearest clear point from the hand (from the
   *  pivot when the hand itself is not clear). Never lifted, never turned: the view direction is untouched */
  private clearLens() {
    const f = this.world, e = this.eye;
    if (!f || !this.blocked(f, e[0], e[1], e[2])) return;
    const rx = -Math.cos(this.yaw), rz = Math.sin(this.yaw), oy = this.py + this.pivotH;
    for (const s of [this.shoulderUsed, 0]) {
      const hx = this.px + rx * s, hz = this.pz + rz * s;
      if (this.inside(f, hx, oy, hz)) continue;
      const dx = e[0] - hx, dy = e[1] - oy, dz = e[2] - hz, len = Math.hypot(dx, dy, dz);
      const t = len > 1e-6 ? this.sweep(f, hx, oy, hz, dx / len, dy / len, dz / len, len) : 0, k = len > 1e-6 ? t / len : 0;
      this.eye = [hx + dx * k, oy + dy * k, hz + dz * k];
      this.lensGap = Math.hypot(this.eye[0] - this.px, this.eye[1] - oy, this.eye[2] - this.pz);
      this.groundPops++;
      return;
    }
  }

  /** one tick of the rig */
  private step(f: ChaseFrame) {
    const dt = f.dt;
    // a grounded step (CHASE_CONFIG.step): on the ground the rig's height follows the body at a capped rate, so a tile
    // edge the sim walked it up or down in one tick is taken up over a few ticks; a ramp walked slower than the cap, a
    // jump, a fall and flight are followed 1:1
    // (the sim's own support flag over the span drawn: a position interpolated across a tile edge is between the two
    // floors, not in the air, and a landing span is not a step)
    const S = CFG.step, onGround = Math.abs(f.y - f.ground(f.x, f.z)) < S.ground, absorb = f.grounded === undefined ? onGround && this.lGround : f.grounded || this.fGround;
    if (dt > 0) {
      if (absorb) this.stepY -= f.y - this.ly;
      const m = S.rate * dt;
      this.stepY = clamp(Math.abs(this.stepY) <= m ? 0 : this.stepY - Math.sign(this.stepY) * m, -S.max, S.max);
    }
    this.ly = f.y; this.lGround = onGround;

    // ---- stage 1: the ideal arm for the sprite's outline, eased when the squad tags a Pokémon with another outline
    const I = chaseArm(f), F = CFG.frame, V = this.wantV;
    if (!this.sizeSet) { this.backWant = I.back; this.shoulderWant = I.shoulder; this.cornerTop = I.top; this.cornerRight = I.right; this.tilt = I.tilt; this.sizeSet = true; }
    else {
      [this.backWant, V[0]] = smoothDamp(this.backWant, I.back, V[0], F.settle, dt); [this.shoulderWant, V[1]] = smoothDamp(this.shoulderWant, I.shoulder, V[1], F.settle, dt);
      [this.cornerTop, V[2]] = smoothDamp(this.cornerTop, I.top, V[2], F.settle, dt); [this.cornerRight, V[3]] = smoothDamp(this.cornerRight, I.right, V[3], F.settle, dt);
      [this.tilt, this.tiltV] = smoothDamp(this.tilt, I.tilt, this.tiltV, F.settle, dt);
    }
    // the look band is absolute (aimPitch up / down about the horizon): the player's own pitch gives way to the tilt
    this.userPitch = clamp(this.userPitch, this.band[0] - this.tilt, this.band[1] - this.tilt);
    const want = this.backWant, wantS = this.shoulderWant;

    // the anchor: the Pokémon itself, no lag
    this.px = f.x; this.py = f.y; this.pz = f.z;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const rx = -cy, rz = sy; // right of the view direction (the same vector the move input uses)

    // the arm's elevation: the player's pitch (boomElevation, the overhead rise past the orbit range included), capped
    // by the decks over the arm (a shelf, a bridge) so the lens stays deck.clearance under every underside above the
    // back arm's ground track: a flat low arm rather than rising over the slab, which would put the camera on top of it
    // looking down at nothing. The track is sampled out to `reach` of the back distance at the elevation in force, so
    // the cap is coming in before the lens itself is under a slab. A slab over the Pokémon, beside it or over the
    // shoulder arm also lowers the pivot (the outline's top may stand taller than the gap). Both are eased (in over
    // deck.enter s, out over deck.exit s) and depend only on where the Pokémon stands, never on where it is going
    const DK = CFG.deck, free = boomElevation(this.userPitch + this.tilt);
    const sPrev = this.fresh ? wantS : this.shoulderUsed, bPrev = this.fresh ? want : this.boomUsed;
    // the pivot on the corner's top as the shader draws it from where the lens was (the stretch follows the arm in use)
    const tall = chasePivotH(this.cornerTop, bPrev, sPrev, Math.min(free, this.slabLim));
    let lim = 90, drop = 0, hard = 0;
    if (f.ceiling) {
      const c = CFG.lens.clear;
      // the lowest underside over anything the shoulder arm's sweep can touch (the pivot, the arm at the sweep's own
      // spacing, `lens.clear` either side of each) and over the start of the back arm, where it has not yet dropped
      // under anything: the pivot may not stand higher than `deck.clearance` under it (`must`)
      let low = Infinity;
      for (let t = 0; t < wantS + 0.25; t += 0.25) {
        const q = Math.min(t, wantS), qx = f.x + rx * q, qz = f.z + rz * q;
        low = Math.min(low, f.ceiling(qx, qz), f.ceiling(qx + c, qz), f.ceiling(qx - c, qz), f.ceiling(qx, qz + c), f.ceiling(qx, qz - c));
      }
      low = Math.min(low, f.ceiling(f.x + rx * (wantS + c), f.z + rz * (wantS + c)));
      // (and over the back arm's ground track as far as the lens: an arm that starts above a slab cannot get under it,
      // so the pivot stays down until the lens too is out from under)
      const hbU = Math.cos(Math.min(free, this.slabLim) * D2R) * bPrev;
      for (const t of [0.07, 0.14, 0.2, 0.35, 0.5, 0.65, 0.8, 0.95, 1.05]) low = Math.min(low, f.ceiling(f.x + rx * sPrev - sy * hbU * t, f.z + rz * sPrev - cy * hbU * t));
      const must = low < Infinity ? Math.max(0, f.y + tall - (low - DK.clearance)) : 0;
      // and a slab within `near` m of the Pokémon, any way round, starts the pivot coming down (eased): whichever way
      // the Pokémon goes under it, most of the drop is done by then. Where it stands decides, never where it is heading
      let around = low;
      for (let k = 0; k < 8; k++) { const a = (k * Math.PI) / 4, ux = Math.sin(a), uz = Math.cos(a); around = Math.min(around, f.ceiling(f.x + ux * DK.near * 0.5, f.z + uz * DK.near * 0.5), f.ceiling(f.x + ux * DK.near, f.z + uz * DK.near)); }
      drop = around < Infinity ? Math.max(0, f.y + tall - (around - DK.clearance)) : 0;
      hard = must;
      const oyT = f.y + tall - Math.max(hard, this.pivDrop), hb = Math.cos(Math.min(free, this.slabLim) * D2R) * want;
      const cap = (u: number, t: number) => Math.max(DK.minElev, Math.asin(clamp((u - DK.clearance - oyT) / (Math.min(1, t) * want), -1, 1)) / D2R);
      for (let k = 0; k <= 6; k++) {
        const t = (k / 5) * DK.reach / 1.2, u = f.ceiling(f.x + rx * sPrev - sy * hb * t, f.z + rz * sPrev - cy * hb * t);
        if (u < Infinity) lim = Math.min(lim, cap(u, Math.max(t, 0.2)));
      }
      // (a slab near the Pokémon caps the whole arm too: a lens high over the pivot, looking down, has no ground track
      // to speak of, and would otherwise meet the slab only when the Pokémon is already under it)
      // (looked for as far out as the lens itself stands from the pivot, up to a metre more than `near`)
      let wide = around;
      const far = DK.near + Math.min(1, hb);
      for (let k = 0; k < 8; k++) { const a = (k * Math.PI) / 4; wide = Math.min(wide, f.ceiling(f.x + Math.sin(a) * far, f.z + Math.cos(a) * far)); }
      if (wide < Infinity) lim = Math.min(lim, cap(wide, 1));
    }
    if (this.fresh) { this.slabLim = lim; this.slabV = 0; this.pivDrop = drop; this.pivDropV = 0; }
    else {
      // (with nothing above, the cap lets go toward the elevation the pitch asks for, not toward 90°: the lens rises
      // at the easing's own pace, then the cap is off)
      if (lim >= free && this.slabLim >= free - 0.01) { this.slabLim = 90; this.slabV = 0; }
      else if (lim < this.slabLim) [this.slabLim, this.slabV] = smoothDamp(this.slabLim, lim, this.slabV, DK.enter, dt);
      else [this.slabLim, this.slabV] = smoothDamp(Math.min(this.slabLim, free), Math.min(lim, free), this.slabV, DK.exit, dt);
      if (drop !== this.pivDrop) [this.pivDrop, this.pivDropV] = smoothDamp(this.pivDrop, drop, this.pivDropV, drop > this.pivDrop ? DK.enter : DK.exit, dt);
    }
    const elev = Math.min(free, this.slabLim);
    this.coveredTk = this.slabLim < free;
    // (the easing may still be catching a slab the Pokémon has just come under: the pivot is never left in its clearance)
    const pivH = Math.max(tall - Math.max(this.pivDrop, hard), 0.2);
    this.pivotH = pivH;
    const ox = f.x, oy = f.y + pivH, oz = f.z;
    const cp = Math.cos(elev * D2R), sp = Math.sin(elev * D2R);

    // ---- stage 2: clearance. Sideways from the pivot to the hand, then back from the hand to the lens: how much of
    // each arm the world leaves free (terrain, deck undersides, the map edge, bare walls; never a prop). A pivot that
    // reads as inside a solid (an interpolated position cutting a wall's corner) leaves both arms as they were
    const B = CFG.boomTime, c = CFG.lens.clear, held = !this.fresh && this.inside(f, ox, oy, oz);
    /** the back arm from a hand `sh` m to the side: how much of it is free */
    const backFrom = (sh: number, every?: number) => this.sweep(f, ox + rx * sh, oy, oz + rz * sh, -sy * cp, sp, -cy * cp, want, every);
    const sMax = held ? this.shoulderUsed : this.sweep(f, ox, oy, oz, rx, 0, rz, wantS);
    // The hand to use: the furthest one out, unless the back arm from it is cut short. Then, of the hands the world
    // leaves free, the one whose lens ends nearest the ideal lens (the two arms are at right angles, so that distance is
    // hypot(shoulder given up, back given up)): a wall behind the Pokémon keeps the whole shoulder and shortens the back
    // arm; rock behind the shoulder side is passed on the inside rather than pinning the lens at the hand. The hand in
    // use is tried first and has to be beaten clearly, so two near-equal answers do not trade places as the Pokémon moves
    let sBest = sMax, bBest = held ? this.boomUsed : backFrom(sMax);
    if (!held && bBest < want - 1e-3) {
      const costOf = (sh: number, b: number) => Math.hypot(wantS - sh, want - b);
      let cost = costOf(sBest, bBest), top = sMax;
      const cur = Math.min(this.shoulderUsed, sMax);
      if (cur < sMax - 0.02) { const b = backFrom(cur, 0.5), k = costOf(cur, b) * 0.85; if (k < cost) { cost = k; sBest = cur; bBest = b; } }
      const N = 5;
      for (let k = N - 1; k >= 0 && sMax > 0.05; k--) {
        const sh = (sMax * k) / N, b = backFrom(sh, 0.5), q = costOf(sh, b);
        if (q < cost - 1e-6) { cost = q; sBest = sh; bBest = b; top = (sMax * (k + 1)) / N; }
      }
      // a Pokémon pressed to a wall on its shoulder side has no room for the hand there at all (its pivot stands at the
      // wall's clearance): the hand may back off the other way, up to twice the clearance (P1 before the composition)
      if (sMax < 2 * c) for (let d = c / 2; d <= 2 * c + 1e-9; d += c / 2) {
        if (this.blocked(f, ox - rx * d, oy, oz - rz * d)) continue;
        const b = backFrom(-d, 0.5), q = costOf(-d, b);
        if (q < cost - 1e-6) { cost = q; sBest = -d; bBest = b; top = -d; }
      }
      if (sBest < 0) bBest = backFrom(sBest);
      else if (sBest < sMax) {
        // out from the best hand toward the next one tried: as far as the back arm stays as free (an obstacle's inner edge)
        let lo = sBest, hi = Math.max(sBest, Math.min(top, sMax));
        for (let i = 0; i < 4 && hi - lo > 0.03; i++) { const m = (lo + hi) / 2; if (backFrom(m, 0.5) >= bBest - 0.1) lo = m; else hi = m; }
        sBest = lo; bBest = backFrom(lo);
      }
    }
    // ---- stage 3: each arm comes in to what is free and eases back out once there has been room for boomTime.hold s
    const sFree = sBest, sWas = wantS * this.sideT, bWas = want * this.colT, first = this.fresh;
    const sShare = wantS > 1e-6 ? Math.min(1, sFree / wantS) : 1;
    if (this.fresh || sShare < this.sideT) { this.sideT = sShare; this.sideV = 0; this.sideClear = 0; }
    else if (!held && (this.sideClear += dt) > B.hold) [this.sideT, this.sideV] = smoothDamp(this.sideT, sShare, this.sideV, B.out, dt);
    let sUsed = wantS * this.sideT;
    const bFree = held ? this.boomUsed : Math.abs(sUsed - sBest) < 1e-9 ? bBest : backFrom(sUsed);
    const bShare = want > 1e-6 ? Math.min(1, bFree / want) : 1;
    if (this.fresh || bShare < this.colT) { this.colT = bShare; this.colV = 0; this.clearT = 0; }
    else if (!held && (this.clearT += dt) > B.hold) [this.colT, this.colV] = smoothDamp(this.colT, bShare, this.colV, B.out, dt);
    this.fresh = false;
    let back = want * this.colT;
    // The way in. (sUsed, back) is where the arms put the lens with everything in their way respected: a clear point.
    // The lens goes there from where it was (the same two lengths a tick ago, on the Pokémon as it stands now) along the
    // straight line between the two, at no more than boomTime.in, as long as its own position is clear: what crosses an
    // arm near the Pokémon leaves the lens, further out, in free air. Where the line itself runs through a solid's
    // clearance the lens hops that stretch, and only that
    if (!first && !held && (sUsed < sWas - 1e-9 || back < bWas - 1e-9)) {
      const ds = sUsed - sWas, db = back - bWas, far = Math.hypot(ds, db), most = B.in * dt;
      if (far > most) {
        const lensAt = (u: number) => { const sh = sWas + ds * u, b = bWas + db * u; return this.blocked(f, ox + rx * sh - sy * cp * b, oy + sp * b, oz + rz * sh - cy * cp * b); };
        let u = most / far;
        while (u < 1 && lensAt(u)) u = Math.min(1, u + 0.1 / far);
        if (u < 1) { sUsed = sWas + ds * u; back = bWas + db * u; this.sideT = wantS > 1e-6 ? sUsed / wantS : 1; this.colT = want > 1e-6 ? back / want : 1; }
      }
    }
    const hx = ox + rx * sUsed, hz = oz + rz * sUsed;
    this.shoulderFree = sFree; this.backFree = bFree;
    this.shoulderUsed = sUsed; this.boomUsed = back;

    // the grounded step still being taken up rides on the whole rig (presentation only: the sweeps saw the Pokémon where
    // it is); the frame's own P1 check (clearLens) has the last word
    this.eye = [hx - sy * cp * back, oy + sp * back + this.stepY, hz - cy * cp * back];
    this.lensGap = Math.hypot(this.eye[0] - ox, this.eye[1] - this.stepY - oy, this.eye[2] - oz);
    this.viewPitch = ownedPitch(this.userPitch + this.tilt);
    const vc = Math.cos(this.viewPitch), vs = Math.sin(this.viewPitch);
    this.target = [this.eye[0] + sy * vc * 20, this.eye[1] - vs * 20, this.eye[2] + cy * vc * 20];
    this.fov = clamp(CFG.fov + this.fovOffset, CFG.fovRange[0], CFG.fovRange[1]) * D2R;
  }

  /** unit vector of the horizontal view direction */
  forward(): [number, number] { return [Math.sin(this.yaw), Math.cos(this.yaw)]; }

  /** Look input (mouse, right stick): dyaw > 0 turns right, dpitch > 0 looks further down (radians). Both apply at
   *  once, and the composed view (eye, viewPitch, target) is recomposed for them exactly as update() composes a frame:
   *  the lens turned about the pivot by the yaw change and swung up or down by the arm elevation the pitch change
   *  gives, the axis tilted by the pitch change, then checked for P1 against the world of the last frame. So the rig's
   *  public view is coherent at every instant, a sample taken now aims where update() with no elapsed time would draw,
   *  and the rig's clock does not move (only update() advances it). The pitch is clamped to `range` (lookPitchRange()). */
  look(dyaw: number, dpitch: number, range: [number, number] = lookPitchRange()) {
    const y0 = this.yaw, up0 = this.userPitch;
    this.yaw = wrap(y0 - dyaw);
    this.userPitch = clamp(up0 + dpitch / D2R, range[0] - this.tilt, range[1] - this.tilt);
    if (!this.ready) return; // nothing composed yet: the first update() snaps onto the Pokémon with this yaw and pitch
    const d = wrap(this.yaw - y0), cd = Math.cos(d), sd = Math.sin(d);
    const ex = this.raw[0] - this.px, ez = this.raw[2] - this.pz;
    this.eye = [this.px + ex * cd + ez * sd, this.raw[1], this.pz - ex * sd + ez * cd];
    this.swingLens(this.elevFor(up0), this.elevFor(this.userPitch));
    this.raw = [this.eye[0], this.eye[1], this.eye[2]];
    this.lensGap = Math.hypot(this.eye[0] - this.px, this.eye[1] - this.py - this.pivotH, this.eye[2] - this.pz);
    this.clearLens();
    this.viewPitch = ownedPitch(this.userPitch + this.tilt);
    const vc = Math.cos(this.viewPitch), vs = Math.sin(this.viewPitch);
    this.target = [this.eye[0] + Math.sin(this.yaw) * vc * 20, this.eye[1] - vs * 20, this.eye[2] + Math.cos(this.yaw) * vc * 20];
  }

  /** a new run: the player's pitch back to neutral */
  resetLook() { this.userPitch = 0; }

  /** an immutable copy of the composed view, for a viewport of width x height */
  sample(width: number, height: number): ViewSample {
    const vc = Math.cos(this.viewPitch);
    return Object.freeze({
      eye: Object.freeze([this.eye[0], this.eye[1], this.eye[2]] as [number, number, number]),
      dir: Object.freeze([Math.sin(this.yaw) * vc, -Math.sin(this.viewPitch), Math.cos(this.yaw) * vc] as [number, number, number]),
      yaw: this.yaw, viewPitch: this.viewPitch, userPitch: this.userPitch, fov: this.fov,
      width, height, aspect: width / Math.max(1, height), reticleY: RETICLE_Y,
    });
  }
}

/** The aim point for the camera: where the crosshair ray meets the terrain, at least `min` and at most `max` metres
 *  from the Pokémon. Shots converge on the crosshair like they do in a third-person shooter: the lens sits on a
 *  shoulder, so the point is offset sideways by the lens' own offset (eased in over the first 16 m so a close
 *  target does not swing the shot). With no shoulder the point lies in the vertical plane of the camera yaw. */
export function chaseAim(rig: AimView, px: number, pz: number, aspect: number, ground: (x: number, z: number) => number, min = CFG.aim.min, max = CFG.aim.max): [number, number] {
  void aspect;
  const sy = Math.sin(rig.yaw), cy = Math.cos(rig.yaw);
  // the crosshair ray is above the view axis by (0.5 - RETICLE_Y) of the half-height
  const ty = Math.tan(rig.fov / 2) * (0.5 - RETICLE_Y) * 2;
  const ang = rig.viewPitch - Math.atan(ty); // ray pitch below the horizon
  const dxz = Math.cos(ang), dy = -Math.sin(ang);
  const e = rig.eye;
  // the eye relative to the Pokémon, along the yaw (negative = behind it) and across it (+ = right)
  const back = (e[0] - px) * sy + (e[2] - pz) * cy, lat = (e[0] - px) * -cy + (e[2] - pz) * sy;
  let along = max;
  if (dy < 0) {
    for (let s = 0.5; s < 120; s += 0.5) {
      const x = e[0] + sy * dxz * s, z = e[2] + cy * dxz * s, y = e[1] + dy * s;
      if (y <= ground(x, z)) { along = back + dxz * s; break; }
    }
  }
  along = clamp(along, min, max);
  const side = lat * Math.min(1, along / 16);
  return [px + sy * along - cy * side, pz + cy * along + sy * side];
}

/** where the player's own Pokémon is while the view has left it (R3, owner decision B): the direction from the screen
 *  centre toward it (screen axes: x right, y down, unit length) and an opacity that rises from 0 at the frame edge to 1
 *  `CHASE_CONFIG.cue.fade` of the half-screen past it. Null while any of `pts` (feet, chest, head) is on screen */
export interface OffFrameCue { readonly dx: number; readonly dy: number; readonly alpha: number }
export function offFrameCue(v: ViewSample, pts: readonly (readonly [number, number, number])[]): OffFrameCue | null {
  const sy = Math.sin(v.yaw), cy = Math.cos(v.yaw), sp = Math.sin(v.viewPitch), cp = Math.cos(v.viewPitch);
  // the view basis of mat4.viewYawPitch: forward, right from the yaw (no roll), up = back × right
  const f = [sy * cp, -sp, cy * cp], r = [-cy, 0, sy], u = [sy * sp, cp, cy * sp];
  const tv = Math.tan(v.fov / 2), th = tv * v.aspect;
  let inside = -Infinity, front = false;
  for (const q of pts) {
    const d0 = q[0] - v.eye[0], d1 = q[1] - v.eye[1], d2 = q[2] - v.eye[2];
    const z = d0 * f[0] + d1 * f[1] + d2 * f[2];
    if (z <= 0.3) continue; // at or behind the near plane: not on screen
    front = true;
    const x = (d0 * r[0] + d2 * r[2]) / (z * th), y = (d0 * u[0] + d1 * u[1] + d2 * u[2]) / (z * tv);
    inside = Math.max(inside, Math.min(1 - Math.abs(x), 1 - Math.abs(y)));
  }
  if (inside > 0) return null;
  // the direction toward the middle point, in normalised screen units (independent of its depth, so also behind the lens)
  const q = pts[Math.floor(pts.length / 2)], d0 = q[0] - v.eye[0], d1 = q[1] - v.eye[1], d2 = q[2] - v.eye[2];
  const x = (d0 * r[0] + d2 * r[2]) / th, y = -(d0 * u[0] + d1 * u[1] + d2 * u[2]) / tv, L = Math.hypot(x, y);
  if (L < 1e-9) return null;
  return { dx: x / L, dy: y / L, alpha: front ? clamp(-inside / CFG.cue.fade, 0, 1) : 1 };
}

// ----------------------------------------------------------------------------------------------------------
// Awareness. A low lens sees less of what is behind and beside the Pokémon, so hostiles near and out of frame are
// reported as a ring of sectors around the screen (drawn by ui.threatRing) and off-screen objectives point the way.
// ----------------------------------------------------------------------------------------------------------
export const RING = { sectors: 16, range: 16 };

/** where (x, z) lies as seen from the Pokémon: the angle from straight ahead (+ = to the right, ±π = behind) and the distance (m) */
export function bearingOf(yaw: number, px: number, pz: number, x: number, z: number): [number, number] {
  const dx = x - px, dz = z - pz, sy = Math.sin(yaw), cy = Math.cos(yaw);
  return [Math.atan2(dx * -cy + dz * sy, dx * sy + dz * cy), Math.hypot(dx, dz)];
}

/** add a hostile of threat `weight` at `dist` m and bearing `ang` to the ring (sector 0 = ahead, clockwise); nearer counts more */
export function ringAdd(ring: Float32Array, ang: number, dist: number, weight: number) {
  if (dist >= RING.range) return;
  const n = RING.sectors, k = ((Math.round((ang / (Math.PI * 2)) * n) % n) + n) % n;
  ring[k] += weight * (1 - dist / RING.range);
}
