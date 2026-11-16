// Camera presets compared in docs/CAMERA.md. The fixed presets keep the north-up yaw, the 16 px/m pixel
// grid and integer upscaling; they differ in pitch and in how many internal lines (how much of the
// arena) fit on screen. The 'chase' preset is the third-person rig (docs/THIRD_PERSON.md): a low,
// over-the-shoulder camera behind the Pokémon that the player orbits with the mouse or right stick.
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
// Third-person rig. Pure maths (no GL, no DOM, never touches the sim) so it can be unit-tested.
//
//   pivot  = the Pokémon's shoulder line (a fraction of its drawn height); the boom swings behind it by yaw/elevation
//   eye    = pivot - dir(yaw, elevation) * boom + right * shoulder * boom, pulled in by terrain, walls and decks
//   view   = parallel to the yaw, tilted `tilt` degrees below the horizon, so the horizon sits just above the screen
//            centre, the Pokémon fills the lower third beside the crosshair and the world runs away into the distance
//
// Every number lives in CHASE_CONFIG: tune the camera there, not in the maths.
// ----------------------------------------------------------------------------------------------------------
export type ChaseState = 'explore' | 'combat' | 'pressure';
export interface ChaseParams {
  /** elevation of the boom above the horizontal (deg): how far the lens sits above the pivot */
  pitch: number;
  /** boom length (m) for a Pokémon of CHASE_CONFIG.size.ref metres */
  boom: number;
  /** vertical field of view (deg) */
  fov: number;
  /** how far below the horizon the view axis points (deg); sets where the horizon and the crosshair's ground hit fall */
  tilt: number;
}

/** Every camera tuning value. Angles in degrees, distances in metres, times in seconds. */
export const CHASE_CONFIG = {
  /** Explore: nothing hostile near. Combat: a hostile within 20 m. Pressure: a boss within 25 m or a crowd.
   *  Garden Warfare sits the lens about a head above its hero and a body-and-a-half behind: Explore is that,
   *  Combat and Pressure rise and back off a little so a crowd stays readable, never past a 17° boom. */
  states: {
    explore: { pitch: 9, boom: 4.2, fov: 64, tilt: 6 },
    combat: { pitch: 13, boom: 5, fov: 68, tilt: 7.5 },
    pressure: { pitch: 17, boom: 6.2, fov: 72, tilt: 10 },
  } as Record<ChaseState, ChaseParams>,
  /** when the state changes: entry and exit thresholds are apart (a crowd hovering at the threshold must not pump the
   *  boom in and out), and a calmer state is only taken after its reading has lasted `hold` / `pressureHold` */
  threat: { combatIn: 20, combatOut: 26, weightIn: 20, weightOut: 12, bossIn: 25, bossOut: 32, hold: 3, pressureHold: 2 },
  /** critically damped blend between states: `out` towards a busier state, `in` back to a calmer one */
  blend: { out: 0.25, in: 0.6 },
  /** boom scale for the Pokémon's size: (framing size / ref) ^ exp, clamped. Small Pokémon sit closer and lower,
   *  big ones further back and higher; `settle` is the smoothing time (s) of the change when the squad tags a different Pokémon */
  size: { ref: 1.2, exp: 0.55, min: 0.7, max: 1.8, settle: 0.45, bodyMin: 0.35, bodyMax: 5, widthWeight: 0.6 },
  /** pivot height = body height * chest (flyers: flyerChest), clamped */
  pivot: { chest: 0.8, flyerChest: 0.9, min: 0.5, max: 2.4 },
  /** over-the-shoulder offset as a fraction of the boom (+ = camera to the right, the Pokémon appears left). The lens
   *  swaps shoulder when its side has left less than `below` of the boom open, and the other side `gain` more, for
   *  `confirm` s; at most once every `every` s; the swap glides over `settle` s */
  shoulder: 0.24,
  swap: { below: 0.8, gain: 0.25, every: 1, settle: 0.25, confirm: 0.2 },
  /** the player's own pitch window around the state's pitch (deg); + looks down */
  pitchRange: [-14, 20] as [number, number],
  /** the boom elevation is kept inside this (deg) */
  elevation: [2, 40] as [number, number],
  /** a tall wall or cliff right behind the Pokémon: the boom may climb this much (deg) before it only shortens. Climbing
   *  is the last resort: every climb tips the whole view, and along a cave wall it bobbed the camera up and down */
  maxLift: 12,
  liftStep: 3,
  /** the boom only climbs when shortening would leave less than `liftClear` of it, and only by the smallest climb
   *  that clears that much (a moderate wall behind just brings the lens closer, as in Garden Warfare; a wall too tall
   *  to see over is never climbed at all) */
  liftClear: 0.35,
  /** climbing: smoothing up and down (s), and how long a lower climb must stay clear before the boom comes back down */
  liftTime: { up: 0.2, down: 0.8, hold: 1 },
  /** how much of the climb the view axis follows (the rest drops the Pokémon lower in frame) */
  liftTilt: 0.7,
  /** lens clearances (m): over the ground (`inside`: how deep into a rise counts as a wall rather than a skim),
   *  under a deck; solids count up to `solidTop` above the ground. The lens' own floor over the ground under it
   *  is `ground` (eased over `floorTime` s when the ground steps up under it), never less than `hardFloor` */
  lens: { ground: 0.4, inside: 0.5, ceiling: 0.35, solidTop: 2.4, floorTime: 0.06, hardFloor: 0.2 },
  /** what may block the lens. Terrain, deck undersides and the map edge always do, on the quick `boomTime` response.
   *  Props (trees, rocks, buildings) do too, but never below minBoom.frac of the boom, never make it climb, and on the
   *  gentler `propBoom` response, and only where they are dense: at least `propDense` of the nine points of a 1 m
   *  grid around the lens (a thicket, a forest wall, a building). A lone tree or rock never moves the boom: the lens
   *  passes through it and it dissolves (props within 4 m of the lens dither away, and any prop between the lens and
   *  the Pokémon is screen-doored). Blocking on every trunk within 0.7 m of the boom pumped the zoom by 2-3 m each
   *  time the camera turned past a single tree. With false the lens passes through all props (steadiest framing, but
   *  in a forest it sits inside the canopy and dithered trees fill the screen) */
  propsBlockLens: true,
  propDense: 3,
  propBoom: { in: 0.3, out: 0.8, hold: 0.5 },
  /** solids (props, when they block) keep the boom out to at least max(floor, frac * wanted boom) (under a deck:
   *  `deck`): closer than that the lens dissolves them instead of the Pokémon filling the screen. Terrain and decks may
   *  bring it in to `hard` metres, right behind the Pokémon */
  minBoom: { frac: 0.45, floor: 1.2, deck: 0.7, hard: 0.4 },
  /** boom collision response: comes in over `in` s (never faster than `pullIn` m/s), goes back out over `out` s once the
   *  air behind has been clear for `hold` s. Where that is too slow and the lens would end up in the ground or a rise, the
   *  final placement slides it in along the boom (see ChaseRig.step) */
  boomTime: { in: 0.1, out: 0.45, hold: 0.25 },
  pullIn: 25,
  /** how much of a jump or glide the camera follows (the Pokémon rises in frame by the rest) */
  air: { follow: 0.65, flyerFollow: 0.85 },
  /** slopes: follow the walkable ground ahead for up to `probe` m (a rise of more than `step` between metres is a wall
   *  or a cliff and ends it; at least `minRun` m is needed), tilt the view by -gain * that slope, clamped (deg), smoothed
   *  over `settle` s. Uphill looks up so the crest shows, a drop looks down so what is below does; a cliff face or a
   *  wall ahead is not a slope and never tips the view */
  slope: { probe: 10, step: 0.6, minRun: 3, gain: 0.5, range: [-9, 8] as [number, number], settle: 0.5 },
  /** the field of view the player may reach with the setting (deg) */
  fovRange: [40, 85] as [number, number],
  /** collision looks this many seconds ahead along the Pokémon's velocity (up to 2.5 m) */
  anticipate: 0.35,
  /** the aim point is kept this far from the Pokémon (m) */
  aim: { min: 4, max: 26 },
  /** screen shake in third person: smooth noise (not a new random offset every frame, which shakes harder the higher
   *  the frame rate) of `amp` metres at full trauma; `freq` is the noise's angular speed (rad/s, its fastest component
   *  ~4x that). The fixed views keep their own, larger shake: they look from 20-30 m away, this lens from about 4 m */
  shake: { amp: 0.12, freq: 30 },
  /** the longest step the rig takes at once (s): longer frames are split (see ChaseRig.update) */
  tick: 1 / 120,
};
/** the state table (angles in degrees, distances in metres) */
export const CHASE_STATES = CHASE_CONFIG.states;
/** where the aim crosshair sits on screen, as a fraction of height from the top (0.5 = the view axis) */
export const RETICLE_Y = 0.5;

export interface ChaseThreat {
  /** distance to the nearest hostile (m), Infinity if none */
  nearest: number;
  /** summed threat weight of hostiles within 12 m (fodder 1, elite 3, alpha 4, boss 8) */
  weight: number;
  /** distance to the nearest living boss (m), Infinity if none */
  boss: number;
}
export const NO_THREAT: ChaseThreat = { nearest: Infinity, weight: 0, boss: Infinity };

export interface ChaseFrame {
  dt: number;
  /** interpolated player position (feet) */
  x: number; y: number; z: number;
  /** drawn sprite height in metres (sets the shoulder line and, with `width`, the boom) */
  height: number;
  /** drawn sprite width in metres: a wide, low Pokémon needs the lens as far back as a tall one */
  width?: number;
  /** the Pokémon glides or floats */
  flying?: boolean;
  threat: ChaseThreat;
  /** look input this frame: radians of yaw (+ turns the camera to the right: the view direction is (sin yaw, cos yaw), so a right turn lowers yaw) and of pitch (+ looks down) */
  lookYaw: number; lookPitch: number;
  /** terrain height under (x, z) */
  ground: (x: number, z: number) => number;
  /** underside of an overhead deck above the Pokémon at (x, z), Infinity where open sky (layered maps) */
  ceiling?: (x: number, z: number) => number;
  /** something solid (a tree trunk, a boulder, rock wall, the map edge) occupies the point; the lens stays out of it */
  solid?: (x: number, y: number, z: number) => boolean;
  /** screen-shake offset in metres, already scaled */
  shake?: [number, number, number];
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
  /** the pitch the player may add to the state's pitch (deg) */
  pitchRange: [number, number];
  /** FOV offset the player chose (deg), -10..+12 */
  fovOffset: number;
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
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
/** smooth noise in -1..1 (a sum of incommensurate sines): continuous in t, so the same at every frame rate */
export const wobble = (t: number, seed: number) => (Math.sin(t * 1.0 + seed) * 0.5 + Math.sin(t * 2.31 + seed * 1.7) * 0.3 + Math.sin(t * 4.13 + seed * 2.9) * 0.2);
const D2R = Math.PI / 180;
const CFG = CHASE_CONFIG;

interface TickOut { px: number; py: number; pz: number; pivotH: number; eye: [number, number, number]; viewPitch: number; fov: number; boom: number; shoulder: number; gap: number; yaw: number; up: number }
const blankTick = (): TickOut => ({ px: 0, py: 0, pz: 0, pivotH: 0.9, eye: [0, 0, 0], viewPitch: 0.1, fov: 64 * D2R, boom: 4.2, shoulder: 0, gap: 4, yaw: Math.PI, up: 0 });

export class ChaseRig {
  yaw = Math.PI;
  /** the player's own pitch offset on top of the state pitch (deg) */
  userPitch = 0;
  fovOffset = 0;
  state: ChaseState = 'explore';
  cur: ChaseParams = { ...CFG.states.explore };
  /** smoothed pivot base (follows the Pokémon with a short lag) */
  px = 0; py = 0; pz = 0;
  /** height of the pivot above the smoothed feet (m) */
  pivotH = 0.9;
  eye: [number, number, number] = [0, 0, 0];
  /** a point on the view axis, 20 m from the lens */
  target: [number, number, number] = [0, 0, 0];
  /** vertical field of view (rad) and the view axis' pitch below the horizon (rad) */
  fov = 64 * D2R; viewPitch = 0.1;
  /** boom actually used after collision and size scaling (m) */
  boomUsed = 4.2;
  /** lateral offset of the lens from the Pokémon (m, + = right of it) */
  shoulderUsed = 0;
  /** smoothed framing size of the Pokémon (m): eases when the squad tags another one */
  size = 1.1;
  /** ticks on which the final placement had to correct the lens (slide it in along the boom, or lift a lens with no clear
   *  anchor): the eased boom was too slow there. A diagnostic (scripts/camstats.ts `slides`) */
  groundPops = 0;
  /** distance from the lens to the pivot (m): under ~0.8 m the lens is at the Pokémon's back and the renderer fades it */
  lensGap = 4;
  private floor = 0; private floorV = 0; private fresh2 = true;
  private softT = 1; private softV = 0; private softClear = 0;
  /** extra elevation taken over a wall behind the Pokémon (deg) */
  get liftDeg() { return this.lift; }
  private curV = { pitch: 0, boom: 0, fov: 0, tilt: 0 };
  /** seconds since a reading that justified Combat / Pressure */
  private sinceC = 99; private sinceP = 99;
  private colT = 1; private colV = 0; // 0..1 fraction of the boom the world allows (smoothed) and its rate
  private clearT = 1;
  /** extra elevation (deg) taken to see over a wall or cliff behind the Pokémon (smoothed), its target and rate */
  private lift = 0; private liftV = 0; private liftWant = 0; private liftLowT = 0;
  private ready = false;
  /** which shoulder the lens is on (+1 right, -1 left), its smoothed value and rate, and the seconds since it last swapped */
  private side = 1; private sideSm = 1; private sideV = 0; private sideT = 9; private swapT = 0;
  private sizeV = 0;
  private vx = 0; private vz = 0; private lx = 0; private lz = 0;
  private slope = 0; private slopeV = 0;
  private yawV = 0; private lastYaw = Math.PI;
  private sizeSet = false;
  /** the last tick was under a deck (the slab, not the player's pitch, set the boom elevation) */
  private coveredTk = false;
  /** the next update follows a snap: take the collision answer at once instead of easing to it */
  private fresh = false;
  /** the rig's clock (s), its last and next tick, and the yaw and the Pokémon's position at the end of the last drawn
   *  frame (the ticks interpolate from them) */
  private clock = 0; private lastTick = 0; private nextTick = 0;
  private frameYaw = Math.PI; private ix = 0; private iy = 0; private iz = 0;
  /** what the last two ticks produced (the frame is drawn between them) */
  private tk: TickOut = blankTick(); private tkPrev: TickOut = blankTick(); private tkFirst = true;

  /** hard reset onto the player (stage change, new run) */
  snapTo(x: number, y: number, z: number, yaw = this.yaw) {
    this.px = x; this.py = y; this.pz = z; this.yaw = yaw; this.ready = true;
    this.frameYaw = yaw; this.ix = x; this.iy = y; this.iz = z;
    this.clock = 0; this.lastTick = 0; this.nextTick = 0; this.tkFirst = true; this.tk = { ...blankTick(), px: x, py: y, pz: z };
    this.colT = 1; this.colV = 0; this.clearT = 1; this.softT = 1; this.softV = 0; this.softClear = 0; this.lift = this.liftV = this.liftWant = this.liftLowT = 0;
    this.sinceC = this.sinceP = 99;
    this.sizeV = 0; this.vx = this.vz = 0; this.lx = x; this.lz = z; this.slope = this.slopeV = 0; this.yawV = 0; this.lastYaw = yaw;
    this.side = 1; this.sideSm = 1; this.sideV = 0; this.sideT = 9; this.swapT = 0; this.sizeSet = false; this.fresh = true; this.fresh2 = true; this.coveredTk = false;
    this.state = 'explore'; this.cur = { ...CFG.states.explore }; this.curV = { pitch: 0, boom: 0, fov: 0, tilt: 0 };
  }

  /** the state the threat calls for, with hysteresis: entering takes the `In` threshold, staying only the `Out` one,
   *  and a calmer state is taken only once the busier one's reading has been gone for its hold time */
  pick(t: ChaseThreat, dt: number): ChaseState {
    const H = CFG.threat;
    const inP = t.boss < H.bossIn || t.weight >= H.weightIn, keepP = t.boss < H.bossOut || t.weight >= H.weightOut;
    const inC = t.nearest < H.combatIn, keepC = t.nearest < H.combatOut;
    if (inP || (this.state === 'pressure' && keepP)) this.sinceP = 0; else this.sinceP += dt;
    if (inC || inP || (this.state !== 'explore' && keepC)) this.sinceC = 0; else this.sinceC += dt;
    if (inP || (this.state === 'pressure' && this.sinceP < H.pressureHold)) return 'pressure';
    if (inC || (this.state !== 'explore' && this.sinceC < H.hold)) return 'combat';
    return 'explore';
  }

  /** One drawn frame. The rig itself runs on a fixed clock of CHASE_CONFIG.tick (120 Hz), whatever the frame rate: the
   *  Pokémon's position and the yaw are interpolated to each tick's exact time, and the frame shows the rig between its
   *  last two ticks (at most one tick, 8 ms, behind). Every hold timer and threshold (shoulder swap, climb, state,
   *  collision) is then decided at the same instants on the same inputs at 30, 60 or 144 fps; stepping once per frame,
   *  a 30 fps run and a 144 fps run swapped shoulder or cut the boom at different moments. The yaw and the player's
   *  pitch are applied on top at the frame itself, so look input has no added latency. */
  update(f: ChaseFrame, opt: ChaseSettings = { pitchRange: CFG.pitchRange, fovOffset: this.fovOffset }) {
    if (!this.ready) this.snapTo(f.x, f.y, f.z);
    const dt = clamp(f.dt, 0, 0.25), h = CFG.tick;
    const y1 = Math.atan2(Math.sin(this.yaw - f.lookYaw), Math.cos(this.yaw - f.lookYaw));
    const y0 = this.frameYaw, dY = Math.atan2(Math.sin(y1 - y0), Math.cos(y1 - y0));
    this.fovOffset = clamp(opt.fovOffset, -10, 12);
    this.userPitch = clamp(this.userPitch + f.lookPitch / D2R, opt.pitchRange[0], opt.pitchRange[1]);
    const t0 = this.clock, t1 = t0 + dt;
    const x0 = this.ix, h0 = this.iy, z0 = this.iz;
    // the tick state (the public fields double as the rig's own state while it steps)
    this.px = this.tk.px; this.py = this.tk.py; this.pz = this.tk.pz;
    while (this.nextTick <= t1 + 1e-9) {
      const u = dt > 0 ? clamp((this.nextTick - t0) / dt, 0, 1) : 1;
      this.yaw = Math.atan2(Math.sin(y0 + dY * u), Math.cos(y0 + dY * u));
      this.step({ ...f, dt: this.fresh ? 0 : h, x: x0 + (f.x - x0) * u, y: h0 + (f.y - h0) * u, z: z0 + (f.z - z0) * u, lookYaw: 0, lookPitch: 0 });
      const was = this.tk;
      this.tk = { px: this.px, py: this.py, pz: this.pz, pivotH: this.pivotH, eye: this.eye.slice() as [number, number, number], viewPitch: this.viewPitch, fov: this.fov, boom: this.boomUsed, shoulder: this.shoulderUsed, gap: this.lensGap, yaw: this.yaw, up: this.userPitch };
      this.tkPrev = this.tkFirst ? this.tk : was; this.tkFirst = false;
      this.lastTick = this.nextTick; this.nextTick += h;
    }
    this.clock = t1; this.frameYaw = y1; this.ix = f.x; this.iy = f.y; this.iz = f.z;
    // the frame: between the last two ticks, then turned to the yaw (and tilted by the pitch) the player has now
    const a = clamp((t1 - this.lastTick) / h, 0, 1), A = this.tkPrev, B = this.tk, mix = (p: number, q: number) => p + (q - p) * a;
    const dyAB = Math.atan2(Math.sin(B.yaw - A.yaw), Math.cos(B.yaw - A.yaw)), yawAt = A.yaw + dyAB * a;
    this.yaw = y1;
    this.px = mix(A.px, B.px); this.py = mix(A.py, B.py); this.pz = mix(A.pz, B.pz); this.pivotH = mix(A.pivotH, B.pivotH);
    this.boomUsed = mix(A.boom, B.boom); this.shoulderUsed = mix(A.shoulder, B.shoulder); this.lensGap = mix(A.gap, B.gap); this.fov = mix(A.fov, B.fov);
    this.viewPitch = mix(A.viewPitch, B.viewPitch) + (this.userPitch - mix(A.up, B.up)) * D2R;
    const d = Math.atan2(Math.sin(y1 - yawAt), Math.cos(y1 - yawAt)), cd = Math.cos(d), sd = Math.sin(d);
    const ex = mix(A.eye[0], B.eye[0]) - this.px, ez = mix(A.eye[2], B.eye[2]) - this.pz;
    this.eye = [this.px + ex * cd + ez * sd, mix(A.eye[1], B.eye[1]), this.pz - ex * sd + ez * cd];
    // the player's pitch also sets the boom's elevation (step): pitch input since the ticks swings the lens about the
    // pivot now, as the yaw does, instead of a tick later (zero once a tick has run with it)
    this.swingLens(this.elevFor(this.userPitch) - this.elevFor(mix(A.up, B.up)));
    const vc = Math.cos(this.viewPitch), vs = Math.sin(this.viewPitch), fy = Math.sin(y1), fz = Math.cos(y1);
    this.target = [this.eye[0] + fy * vc * 20, this.eye[1] - vs * 20, this.eye[2] + fz * vc * 20];
  }

  /** the boom elevation (deg, before any climb) the player's pitch `up` gives in the current state; under a deck the
   *  slab decides it, so pitch does not move the lens there */
  private elevFor(up: number) { return this.coveredTk ? 0 : clamp(this.cur.pitch + up, CFG.elevation[0], CFG.elevation[1]); }

  /** turn the composed lens about the pivot in the vertical plane of the view yaw by `dElev` degrees (+ = higher) */
  private swingLens(dElev: number) {
    if (!dElev) return;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw), oy = this.py + this.pivotH;
    const rx = this.eye[0] - this.px, ry = this.eye[1] - oy, rz = this.eye[2] - this.pz;
    const back = -(rx * fx + rz * fz), lx = rx + fx * back, lz = rz + fz * back; // behind the pivot, and across
    const R = Math.hypot(back, ry), e = Math.atan2(ry, back) + dElev * D2R;
    const b2 = R * Math.cos(e);
    this.eye = [this.px + lx - fx * b2, oy + R * Math.sin(e), this.pz + lz - fz * b2];
  }

  /** one tick of the rig */
  private step(f: ChaseFrame) {
    const dt = f.dt;
    // the Pokémon's velocity (smoothed), for collision anticipation
    if (dt > 0) {
      const vk = 1 - Math.exp(-10 * dt);
      this.vx += ((f.x - this.lx) / dt - this.vx) * vk; this.vz += ((f.z - this.lz) / dt - this.vz) * vk;
    }
    this.lx = f.x; this.lz = f.z;
    // how fast the camera is turning (rad/s, smoothed): the boom is also tested where it will be shortly, so turning
    // into a cliff pulls the lens in ahead of the rock instead of cutting it in when it gets there
    if (dt > 0) { let dy = this.yaw - this.lastYaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); this.yawV += (dy / dt - this.yawV) * (1 - Math.exp(-12 * dt)); }
    this.lastYaw = this.yaw;

    // state: a critically damped blend, quicker towards danger than back to calm
    const next = this.pick(f.threat, dt);
    this.state = next;
    const T = CFG.states[next];
    const st = T.pitch >= this.cur.pitch ? CFG.blend.out : CFG.blend.in;
    for (const k of ['pitch', 'boom', 'fov', 'tilt'] as const) [this.cur[k], this.curV[k]] = smoothDamp(this.cur[k], T[k], this.curV[k], st, dt);

    // size: the framing size is the taller of the body and its (weighted) width; eased so tagging a different
    // Pokémon glides the lens to its new height and distance instead of popping
    const Z = CFG.size;
    const body = clamp(f.height, Z.bodyMin, Z.bodyMax);
    const framing = clamp(Math.max(body, (f.width ?? 0) * Z.widthWeight), Z.bodyMin, Z.bodyMax);
    if (!this.sizeSet) { this.size = framing; this.sizeSet = true; }
    else [this.size, this.sizeV] = smoothDamp(this.size, framing, this.sizeV, Z.settle, dt);
    const sizeK = clamp(Math.pow(this.size / Z.ref, Z.exp), Z.min, Z.max);
    const want = this.cur.boom * sizeK;
    const pivH = clamp(this.size * (f.flying ? CFG.pivot.flyerChest : CFG.pivot.chest), CFG.pivot.min, CFG.pivot.max);
    this.pivotH = pivH;

    // pivot: horizontal follow with a short lag; vertical eased, and only part of a jump or glide is followed, so
    // the Pokémon rises in frame instead of the whole world bobbing; steps, stairs and slopes do not jerk the view
    const fk = 1 - Math.exp(-16 * dt);
    this.px += (f.x - this.px) * fk; this.pz += (f.z - this.pz) * fk;
    // the lagging pivot cuts corners; it must never cut through a rise (a pivot inside a rock wall put the lens on top of
    // the wall, then back down, on alternating frames): where it would stand in one, it comes back towards the Pokémon
    const badPivot = (x: number, z: number) => f.ground(x, z) > f.y + CFG.lens.inside;
    if (badPivot(this.px, this.pz)) {
      // as far along the lag as it can stay (bisection keeps the answer continuous as the Pokémon moves)
      let lo = 0, hi = 1;
      for (let k = 0; k < 8; k++) { const m = (lo + hi) / 2; if (badPivot(f.x + (this.px - f.x) * m, f.z + (this.pz - f.z) * m)) hi = m; else lo = m; }
      this.px = f.x + (this.px - f.x) * lo; this.pz = f.z + (this.pz - f.z) * lo;
    }
    const air = clamp(f.y - f.ground(f.x, f.z), 0, 6);
    const follow = f.flying ? CFG.air.flyerFollow : CFG.air.follow;
    this.py += (f.y - air * (1 - follow) - this.py) * (1 - Math.exp(-7 * dt));
    const ox = this.px, oy = this.py + pivH, oz = this.pz;

    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const rx = -cy, rz = sy; // right of the view direction (the same vector the move input uses)

    // the lens may not sink into the ground, a deck or a solid: walk a boom candidate from the pivot out
    const STEPS = 10;
    const L = CFG.lens;
    // the lens deep inside a rise (a cliff, a bluff) must come in at once; skimming the surface of one (a shelf, a slope
    // under the boom) is eased: the lens is only lifted over it
    const insideAt = (x: number, y: number, z: number) => y < f.ground(x, z) - L.inside;
    const groundAt = (x: number, y: number, z: number) => y < f.ground(x, z) + L.ground;
    const ceilAt = (x: number, y: number, z: number) => !!f.ceiling && y > f.ceiling(x, z) - L.ceiling;
    // dense props only (see propsBlockLens): props are tile-sized, so a 1 m grid counts each tile near the lens once
    const solidAt = (x: number, y: number, z: number) => {
      const s = f.solid;
      if (!s) return false;
      let n = 0;
      for (let i = -1; i <= 1; i++) for (let k = -1; k <= 1; k++) if (s(x + i, y, z + k) && ++n >= CFG.propDense) return true;
      return false;
    };
    // under a deck the lens may come in to an over-the-shoulder 0.7 m (an alcove's back wall is close)
    const ceilHere = f.ceiling ? f.ceiling(this.px, this.pz) : Infinity;
    const covered = ceilHere < Infinity;
    const minBoom = covered ? CFG.minBoom.deck : clamp(CFG.minBoom.frac * want, CFG.minBoom.floor, want);
    const minFrac = Math.min(1, minBoom / want), hardFrac = Math.min(1, CFG.minBoom.hard / want);
    const lead = CFG.anticipate;
    // only motion towards the lens or across it brings an obstacle into the boom; walking away from it never does (and
    // probing from a point ahead of a Pokémon walking away grazed the walls beside the path)
    const vF = Math.max(0, this.vx * sy + this.vz * cy), avx = this.vx - sy * vF, avz = this.vz - cy * vF;
    const spd = Math.hypot(avx, avz), lead2 = Math.min(spd * lead, 2.5), aheadX = spd > 1e-3 ? (avx / spd) * lead2 : 0, aheadZ = spd > 1e-3 ? (avz / spd) * lead2 : 0;
    let softOut = 1; // the prop part of the last clearFrom (props are eased more gently than terrain)
    /** the fraction of the boom (at this elevation and shoulder) the world leaves open */
    const clearFrom = (qx: number, qz: number, elevDeg: number, sf: number, yaw = this.yaw) => {
      const pr = elevDeg * D2R, c = Math.cos(pr), sn = Math.sin(pr);
      const sy = Math.sin(yaw), cy = Math.cos(yaw), rx = -cy, rz = sy;
      // the fraction of the boom that is open before `blocked` first holds: found on STEPS samples, then refined by bisection
      // so the answer is continuous as the Pokémon walks (a coarse answer would shorten the boom in visible 10 % hops)
      const first = (blocked: (x: number, y: number, z: number) => boolean) => {
        const at = (t: number) => blocked(qx + (-sy * c + rx * sf) * want * t, oy + sn * want * t, qz + (-cy * c + rz * sf) * want * t);
        for (let i = 1; i <= STEPS; i++) {
          if (!at(i / STEPS)) continue;
          let lo = (i - 1) / STEPS, hi = i / STEPS;
          for (let k = 0; k < 6; k++) { const m = (lo + hi) / 2; if (at(m)) hi = m; else lo = m; }
          return lo;
        }
        return 1;
      };
      // a rise (a cliff, a bluff), the ground's surface, a deck's underside, a solid
      const g = first(insideAt), gs = first(groundAt), d = f.ceiling ? first(ceilAt) : 1, w = f.solid ? first(solidAt) : 1;
      // all of it eased: a rise that cuts the line between the lens and the Pokémon is eased in like everything else
      // (the x-ray silhouette shows the Pokémon for those few frames; cutting the boom for it in one frame made turning
      // beside a cliff snap the zoom). The lens itself is never let into a rise: the slide below sees to that
      softOut = Math.max(w, minFrac);
      return Math.min(Math.max(g, hardFrac), Math.max(gs, hardFrac), Math.max(d, hardFrac));
    };
    // anticipation: the boom is also tested from where the Pokémon will be in `lead` seconds, so walking backwards
    // into a rise shortens it before the obstacle arrives instead of snapping the lens in
    // (only as far as the Pokémon can actually go: a point inside a rise or a solid is where it will be stopped)
    let aheadK = lead2 < 0.05 ? 0 : 1;
    while (aheadK > 0 && (insideAt(ox + aheadX * aheadK, oy, oz + aheadZ * aheadK) || !!f.solid?.(ox + aheadX * aheadK, oy, oz + aheadZ * aheadK))) aheadK -= 0.25;
    const turnAhead = clamp(this.yawV * CFG.anticipate, -0.6, 0.6);
    /** [terrain and decks, props] fractions of the boom left open, from here and from where the Pokémon and the
     *  camera will be shortly; `clearNow` takes the present boom only */
    const clearBoth = (elevDeg: number, sf: number, now = false): [number, number] => {
      let here = clearFrom(ox, oz, elevDeg, sf), soft = softOut;
      if (now) return [here, soft];
      if (Math.abs(turnAhead) > 0.02) { here = Math.min(here, clearFrom(ox, oz, elevDeg, sf, this.yaw + turnAhead)); soft = Math.min(soft, softOut); }
      if (aheadK > 0) { here = Math.min(here, clearFrom(ox + aheadX * aheadK, oz + aheadZ * aheadK, elevDeg, sf)); soft = Math.min(soft, softOut); }
      return [here, soft];
    };
    /** the boom as it is now (no anticipation): what the shoulder swap and the climb decide on, so neither ever acts
     *  for an obstacle the Pokémon may never reach */
    const clearNow = (elevDeg: number, sf: number) => { const [h, so] = clearBoth(elevDeg, sf, true); return Math.min(h, so); };

    let baseElev = clamp(this.cur.pitch + this.userPitch, CFG.elevation[0], CFG.elevation[1]);
    // under a deck (a shelf, a bridge): keep the lens below its underside, a flat low boom rather than climbing over
    // the wall behind, which would put the camera on top of the slab looking down at nothing
    if (covered) baseElev = clamp(Math.asin(clamp((ceilHere - 0.45 - oy) / want, -1, 1)) / D2R, 2, baseElev);
    this.coveredTk = covered;

    // shoulder: the lens sits on the right; if that side is walled in and the left is open it swaps (at most once a second)
    const SW = CFG.swap;
    this.sideT += dt;
    const sf0 = CFG.shoulder;
    if (this.sideT > SW.every) {
      // the case for swapping must last `confirm` s (a gap glimpsed on one frame is not a reason, and the decision does
      // not depend on which frames happen to sample it)
      const mine = clearNow(baseElev + this.lift, this.side * sf0);
      if (mine < SW.below && clearNow(baseElev + this.lift, -this.side * sf0) > mine + SW.gain) this.swapT += dt; else this.swapT = 0;
      if (this.swapT >= SW.confirm) { this.side = -this.side; this.sideT = 0; this.swapT = 0; }
    }
    [this.sideSm, this.sideV] = smoothDamp(this.sideSm, this.side, this.sideV, SW.settle, dt);
    const sf = sf0 * this.sideSm;

    // a tall wall or cliff right behind the Pokémon: rather than ramming the lens into it, climb over it a little
    // (the smallest climb up to maxLift degrees that leaves `liftClear` of the boom open), else only shorten. The climb wanted is worked out
    // from no climb at all every frame (never from the current, moving climb, which made it hunt up and down); a higher
    // answer is taken at once, a lower one only after it has held for liftTime.hold
    const cl = (l: number) => clearNow(baseElev + l, sf);
    let lift = 0;
    if (!covered && cl(0) < CFG.liftClear) {
      // the smallest climb that actually clears it; if none does (a corridor between tall walls), no climb at all
      for (let a = CFG.liftStep; a <= CFG.maxLift; a += CFG.liftStep) if (cl(a) >= CFG.liftClear) { lift = a; break; }
    }
    if (covered || lift >= this.liftWant) { this.liftWant = lift; this.liftLowT = 0; }
    else if ((this.liftLowT += dt) >= CFG.liftTime.hold) { this.liftWant = lift; this.liftLowT = 0; }
    [this.lift, this.liftV] = smoothDamp(this.lift, this.liftWant, this.liftV, covered ? 0.05 : this.liftWant > this.lift ? CFG.liftTime.up : CFG.liftTime.down, dt);
    const elev = clamp(baseElev + this.lift, covered ? 2 : CFG.elevation[0], CFG.elevation[1] + CFG.maxLift);
    const cp = Math.cos(elev * D2R), sp = Math.sin(elev * D2R);
    const [terrainOpen, propOpen] = clearBoth(elev, sf);
    // props: their own, gentler easing (passing one trunk should not pump the zoom; the dissolve covers the overlap)
    const PB = CFG.propBoom;
    if (this.fresh) { this.softT = propOpen; this.softV = 0; this.softClear = 0; }
    else if (propOpen < this.softT) { this.softClear = 0; [this.softT, this.softV] = smoothDamp(this.softT, propOpen, this.softV, PB.in, dt); }
    else if ((this.softClear += dt) > PB.hold) [this.softT, this.softV] = smoothDamp(this.softT, propOpen, this.softV, PB.out, dt);
    else this.softV = 0;
    const allowed = Math.min(terrainOpen, this.softT);
    // boom length: in quickly (never faster than pullIn), out slowly once the air behind has been clear for a moment;
    // both critically damped, so the lens never changes speed in a single frame
    const B = CFG.boomTime;
    if (this.fresh) { this.colT = Math.min(1, allowed); this.colV = 0; this.fresh = false; }
    if (allowed < this.colT) {
      this.clearT = 0;
      [this.colT, this.colV] = smoothDamp(this.colT, allowed, this.colV, B.in, dt, CFG.pullIn / want);
    } else {
      this.clearT += dt;
      if (this.clearT > B.hold) [this.colT, this.colV] = smoothDamp(this.colT, allowed, this.colV, B.out, dt);
      else if (this.colV < 0) { this.colV *= Math.exp(-dt / 0.04); this.colT += this.colV * dt; } // coast to a stop, never bounce back
    }
    if (this.colT < hardFrac) { this.colT = hardFrac; this.colV = Math.max(0, this.colV); }
    if (this.colT > 1) { this.colT = 1; this.colV = 0; }
    const boom = want * this.colT;
    this.boomUsed = boom;
    this.shoulderUsed = sf * boom;

    const sh = f.shake ?? [0, 0, 0];
    let ex = ox - sy * cp * boom + rx * sf * boom + sh[0], ey = oy + sp * boom + sh[1], ez = oz - cy * cp * boom + rz * sf * boom + sh[2];
    // the safety net: where the boom's end would still be in the ground, in a rise or against a deck's underside (a
    // Pokémon backed against a terrace closer than the shortest boom; the eased boom still catching up), the lens slides
    // in along the boom to the first point from the pivot that is clear, like a spring arm, and the boom is held there.
    // It is never lifted out vertically: lifting it out of a 2 m terrace put it on the terrace top, a metre over the
    // Pokémon's head and looking down past it (a 70° boom elevation), and at a terrace edge it popped up and down by a
    // whole step as the lens crossed the edge
    const lensBad = (x: number, y: number, z: number) => y < f.ground(x, z) + L.hardFloor || (!!f.ceiling && y > f.ceiling(x, z) - L.ceiling);
    // (from the pivot; if the eased pivot is itself buried, e.g. lagging a Pokémon that has just hopped onto a rock, from
    // the Pokémon's own chest. If that reads as buried too, as an interpolated position cutting the corner of a wall can,
    // the lens holds where it was last tick rather than being lifted out onto whatever is on top)
    let ax = ox, ay = oy, az = oz;
    if (lensBad(ax, ay, az)) { ax = f.x; az = f.z; ay = f.y + pivH; }
    const held = this.tk.eye;
    if (lensBad(ex, ey, ez) && lensBad(ax, ay, az) && !this.fresh2 && !lensBad(held[0], held[1], held[2])) { ex = held[0]; ey = held[1]; ez = held[2]; }
    else if (lensBad(ex, ey, ez) && !lensBad(ax, ay, az)) {
      const seg = (t: number) => lensBad(ax + (ex - ax) * t, ay + (ey - ay) * t, az + (ez - az) * t);
      // the nearest clear point back along the boom from its end (the near face of whatever the end is in), not the
      // first obstacle out from the pivot: a lens already behind one rise (eased in, x-ray silhouette showing) that
      // grazes a second must not be yanked metres forward past the first
      let m = 0;
      for (let i = 15; i >= 0; i--) {
        if (seg(i / 16)) continue;
        let lo = i / 16, hi = (i + 1) / 16;
        for (let k = 0; k < 7; k++) { const q = (lo + hi) / 2; if (seg(q)) hi = q; else lo = q; }
        m = lo; break;
      }
      if (m < 1) {
        if ((1 - m) * Math.hypot(ex - ax, ey - ay, ez - az) > 0.05) this.groundPops++;
        ex = ax + (ex - ax) * m; ey = ay + (ey - ay) * m; ez = az + (ez - az) * m;
        // the boom stays where the lens could go (it eases back out from there once the air clears, never jumps out)
        this.colT *= m; this.colV = Math.min(0, this.colV); this.clearT = 0;
        this.boomUsed = want * this.colT; this.shoulderUsed = sf * this.boomUsed;
      }
    }
    // over open ground the lens keeps L.ground over the surface, eased (over L.floorTime s, continuously) so a bump or
    // a shelf edge under it lifts it smoothly; at most L.ground - L.hardFloor, since the slide above already keeps it
    // L.hardFloor clear
    const gl = f.ground(ex, ez), soft = gl + L.ground + 0.05;
    if (this.fresh2) { this.floor = soft; this.floorV = 0; this.fresh2 = false; }
    else [this.floor, this.floorV] = smoothDamp(this.floor, soft, this.floorV, soft > this.floor ? L.floorTime : L.floorTime * 3, dt);
    const g = Math.max(Math.min(this.floor, soft), gl + L.hardFloor);
    if (ey < gl + L.hardFloor - 0.05) this.groundPops++; // only when even the pivot is buried (should never happen)
    if (ey < g) ey = g;
    // and never through a deck overhead (the lens stays under the slab, the boom shortened by the check above)
    if (f.ceiling) { const c = f.ceiling(ex, ez) - 0.3; if (ey > c) ey = Math.max(g, c); }
    this.lensGap = Math.hypot(ex - ox, ey - oy, ez - oz);
    this.eye = [ex, ey, ez];

    // view axis: parallel to the yaw, `tilt` below the horizon. Slopes tilt it (uphill looks up so the crest shows, a
    // drop looks down so what is below does); climbing a wall rotates it with the boom so the Pokémon keeps its place in frame
    const S = CFG.slope;
    const g0 = f.ground(this.px, this.pz);
    let run = 0, h = g0;
    for (let d = 1; d <= S.probe; d++) {
      const gd = f.ground(this.px + sy * d, this.pz + cy * d);
      if (gd - h > S.step) break; // a wall or a cliff face: the walkable ground ends here
      h = gd; run = d;
    }
    const slopeDeg = run >= S.minRun ? Math.atan2(h - g0, run) / D2R : 0;
    [this.slope, this.slopeV] = smoothDamp(this.slope, clamp(-S.gain * slopeDeg, S.range[0], S.range[1]), this.slopeV, S.settle, dt);
    const tilt = this.cur.tilt + this.userPitch + this.slope + this.lift * CFG.liftTilt;
    this.viewPitch = clamp(tilt, -40, 70) * D2R;
    const vc = Math.cos(this.viewPitch), vs = Math.sin(this.viewPitch);
    this.target = [ex + sy * vc * 20, ey - vs * 20, ez + cy * vc * 20];
    this.fov = clamp(this.cur.fov + this.fovOffset, CFG.fovRange[0], CFG.fovRange[1]) * D2R;
  }

  /** unit vector of the horizontal view direction */
  forward(): [number, number] { return [Math.sin(this.yaw), Math.cos(this.yaw)]; }

  /** Look input (mouse, right stick): dyaw > 0 turns right, dpitch > 0 looks further down (radians). Both apply at
   *  once, and the composed view (eye, viewPitch, target) is recomposed for them exactly as update() composes a frame:
   *  the lens turned about the pivot by the yaw change and swung up or down by the boom elevation the pitch change
   *  gives, the axis tilted by the pitch change. So the rig's public view is
   *  coherent at every instant, a sample taken now aims where update() with no elapsed time would draw, and the rig's
   *  clock does not move (only update() advances it). The pitch is clamped to `range` (CHASE_CONFIG.pitchRange). */
  look(dyaw: number, dpitch: number, range: [number, number] = CFG.pitchRange) {
    const y0 = this.yaw, up0 = this.userPitch;
    this.yaw = Math.atan2(Math.sin(y0 - dyaw), Math.cos(y0 - dyaw));
    this.userPitch = clamp(up0 + dpitch / D2R, range[0], range[1]);
    if (!this.ready) return; // nothing composed yet: the first update() snaps onto the Pokémon with this yaw and pitch
    const d = Math.atan2(Math.sin(this.yaw - y0), Math.cos(this.yaw - y0)), cd = Math.cos(d), sd = Math.sin(d);
    const ex = this.eye[0] - this.px, ez = this.eye[2] - this.pz;
    this.eye = [this.px + ex * cd + ez * sd, this.eye[1], this.pz - ex * sd + ez * cd];
    this.swingLens(this.elevFor(this.userPitch) - this.elevFor(up0));
    this.viewPitch += (this.userPitch - up0) * D2R;
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
