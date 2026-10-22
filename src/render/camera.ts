// Camera presets compared in docs/CAMERA.md. The fixed presets keep the north-up yaw, the 16 px/m pixel
// grid and integer upscaling; they differ in pitch and in how many internal lines (how much of the
// arena) fit on screen. The 'chase' preset is the third-person rig (docs/THIRD_PERSON.md): a camera
// behind the Pokémon that the player orbits with the mouse or right stick.
export interface CameraPreset {
  id: string; name: string; pitch: number; fov: number; lines: number; note: string;
  /** look-at shift toward the camera (m): puts the player higher on screen so threats from the south show earlier */
  frameZ?: number;
  /** 'chase' = third-person rig (free yaw, perspective, no texel snapping); absent = the fixed north-up view */
  mode?: 'chase';
}

export const CAMERA_PRESETS: CameraPreset[] = [
  { id: 'chase', name: 'Third person', pitch: 0.52, fov: 62, lines: 400, mode: 'chase', note: 'Behind your Pokémon. Mouse or right stick turns the camera and aims.' },
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
//   pivot  = the Pokémon's chest; the boom swings behind it by yaw/pitch
//   eye    = pivot - dir(yaw, pitch) * boom, pushed in by terrain
//   target = a ground point `look` metres ahead of the Pokémon, so the Pokémon sits in the lower third and the
//            screen centre is where the Pokémon is going to shoot
// ----------------------------------------------------------------------------------------------------------
export type ChaseState = 'explore' | 'combat' | 'pressure';
export interface ChaseParams { pitch: number; boom: number; fov: number; look: number }

const D2R = Math.PI / 180;
/** state table; angles in degrees, distances in metres (blueprint: Explore 20/6.5/58, Combat 30/8.5/62, Pressure 34/10.5/66) */
export const CHASE_STATES: Record<ChaseState, ChaseParams> = {
  explore: { pitch: 20, boom: 6.5, fov: 58, look: 7 },
  combat: { pitch: 30, boom: 8.5, fov: 62, look: 9 },
  pressure: { pitch: 34, boom: 10.5, fov: 66, look: 10 },
};
/** where the aim reticle sits on screen, as a fraction of height from the top (the screen centre is the view axis) */
export const RETICLE_Y = 0.44;

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
  /** player sprite height in metres (scales the boom for tall / small Pokémon) */
  height: number;
  threat: ChaseThreat;
  /** look input this frame: radians of yaw (+ turns the camera to the right: the view direction is (sin yaw, cos yaw), so a right turn lowers yaw) and of pitch (+ looks down) */
  lookYaw: number; lookPitch: number;
  /** terrain height under (x, z) */
  ground: (x: number, z: number) => number;
  /** screen-shake offset in metres, already scaled */
  shake?: [number, number, number];
}

export interface ChaseSettings {
  /** extra pitch the player may add (deg) beyond the state's pitch */
  pitchRange: [number, number];
  /** FOV offset the player chose (deg), -10..+12 */
  fovOffset: number;
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

export class ChaseRig {
  yaw = Math.PI;
  /** the player's own pitch offset on top of the state pitch (deg) */
  userPitch = 0;
  fovOffset = 0;
  state: ChaseState = 'explore';
  cur: ChaseParams = { ...CHASE_STATES.explore };
  /** smoothed pivot (follows the Pokémon with a short lag) */
  px = 0; py = 0; pz = 0;
  eye: [number, number, number] = [0, 0, 0];
  target: [number, number, number] = [0, 0, 0];
  /** vertical field of view (rad) and the final view pitch below the horizon (rad) */
  fov = 62 * D2R; viewPitch = 0.5;
  /** boom actually used after terrain collision and size scaling */
  boomUsed = 8.5;
  private calm = 99;
  private colT = 1; // 0..1 fraction of the boom the terrain allows (smoothed)
  private clearT = 1;
  private ready = false;

  /** hard reset onto the player (stage change, new run) */
  snapTo(x: number, y: number, z: number, yaw = this.yaw) {
    this.px = x; this.py = y; this.pz = z; this.yaw = yaw; this.colT = 1; this.clearT = 1; this.ready = true; this.calm = 99;
    this.state = 'explore'; this.cur = { ...CHASE_STATES.explore };
  }

  /** the state the threat calls for (hostiles near for the last 3 s keep Combat) */
  pick(t: ChaseThreat, dt: number): ChaseState {
    if (t.boss < 25 || t.weight >= 20) { this.calm = 0; return 'pressure'; }
    if (t.nearest < 20) { this.calm = 0; return 'combat'; }
    this.calm += dt;
    return this.calm < 3 ? 'combat' : 'explore';
  }

  update(f: ChaseFrame, opt: ChaseSettings = { pitchRange: [-8, 12], fovOffset: this.fovOffset }) {
    if (!this.ready) this.snapTo(f.x, f.y, f.z);
    const dt = Math.min(f.dt, 1);
    this.yaw -= f.lookYaw;
    this.yaw = Math.atan2(Math.sin(this.yaw), Math.cos(this.yaw));
    this.fovOffset = clamp(opt.fovOffset, -10, 12);
    this.userPitch = clamp(this.userPitch + f.lookPitch / D2R, opt.pitchRange[0], opt.pitchRange[1]);

    // state: out (towards danger) 0.4 s, in (back to calm) 1.2 s; the boom never moves faster than 6 m/s
    const next = this.pick(f.threat, dt);
    this.state = next;
    const T = CHASE_STATES[next];
    // going towards more danger (a higher, wider view) is the fast direction; judged against where the blend is now
    const danger = T.pitch >= this.cur.pitch;
    const k = 1 - Math.exp(-(3 / (danger ? 0.4 : 1.2)) * dt);
    this.cur.pitch += (T.pitch - this.cur.pitch) * k;
    this.cur.fov += (T.fov - this.cur.fov) * k;
    this.cur.look += (T.look - this.cur.look) * k;
    const dBoom = (T.boom - this.cur.boom) * k;
    this.cur.boom += clamp(dBoom, -6 * dt, 6 * dt);

    // size scaling: tall Pokémon get a longer boom, small ones a shorter one
    const sizeK = clamp(Math.pow(f.height / 1.1, 0.6), 0.8, 1.45);
    const want = this.cur.boom * sizeK;

    // pivot: horizontal follow with a short lag, vertical eased (steps and slopes do not jerk the view)
    const fk = 1 - Math.exp(-16 * dt);
    this.px += (f.x - this.px) * fk; this.pz += (f.z - this.pz) * fk;
    this.py += (f.y - this.py) * (1 - Math.exp(-7 * dt));
    const chest = clamp(f.height * 0.75, 0.55, 2.4);
    const ox = this.px, oy = this.py + chest, oz = this.pz;

    const pitch = clamp(this.cur.pitch + this.userPitch, 6, 58) * D2R;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);

    // collision: walk the boom from the pivot out; the terrain (+ a 0.35 m capsule) may shorten it
    let allowed = 1;
    const STEPS = 10;
    for (let i = 1; i <= STEPS; i++) {
      const t = i / STEPS, b = want * t;
      const x = ox - sy * cp * b, y = oy + sp * b, z = oz - cy * cp * b;
      if (y < f.ground(x, z) + 0.35) { allowed = Math.max(2 / want, (i - 1) / STEPS); break; }
    }
    // in fast (0.05 s), out slow (0.4 s, only after 0.25 s of clear air)
    if (allowed < this.colT) { this.colT += (allowed - this.colT) * (1 - Math.exp(-dt / 0.05)); this.clearT = 0; }
    else { this.clearT += dt; if (this.clearT > 0.25) this.colT += (allowed - this.colT) * (1 - Math.exp(-dt / 0.4)); }
    this.colT = clamp(this.colT, Math.min(1, 2 / want), 1);
    const boom = want * this.colT;
    this.boomUsed = boom;

    const sh = f.shake ?? [0, 0, 0];
    let ex = ox - sy * cp * boom + sh[0], ey = oy + sp * boom + sh[1], ez = oz - cy * cp * boom + sh[2];
    // never let the lens sink into a rise behind the Pokémon
    const g = f.ground(ex, ez) + 0.5;
    if (ey < g) ey = g;
    this.eye = [ex, ey, ez];

    // look at a ground point `look` metres ahead of the Pokémon
    const lx = this.px + sy * this.cur.look, lz = this.pz + cy * this.cur.look;
    const ly = Math.max(f.ground(lx, lz), this.py) + 0.2;
    this.target = [lx, ly, lz];
    this.fov = clamp(this.cur.fov + this.fovOffset, 40, 80) * D2R;
    const hx = lx - ex, hz = lz - ez, hl = Math.hypot(hx, hz) || 1;
    this.viewPitch = Math.atan2(ey - ly, hl);
  }

  /** unit vector of the horizontal view direction */
  forward(): [number, number] {
    const hx = this.target[0] - this.eye[0], hz = this.target[2] - this.eye[2], l = Math.hypot(hx, hz) || 1;
    return [hx / l, hz / l];
  }
}

/** the aim point for the camera: the reticle ray against the terrain, kept in the vertical plane of the camera
 *  yaw (so the shot goes where the camera looks), at least `min` and at most `max` metres from the Pokémon */
export function chaseAim(rig: ChaseRig, px: number, pz: number, aspect: number, ground: (x: number, z: number) => number, min = 4, max = 26): [number, number] {
  const sy = Math.sin(rig.yaw), cy = Math.cos(rig.yaw);
  // the reticle ray is above the view axis by (0.5 - RETICLE_Y) of the half-height
  const ty = Math.tan(rig.fov / 2) * (0.5 - RETICLE_Y) * 2;
  void aspect;
  const ang = rig.viewPitch - Math.atan(ty); // ray pitch below the horizon
  const dxz = Math.cos(ang), dy = -Math.sin(ang);
  let hit = max + 8;
  const e = rig.eye;
  // eye distance along the yaw direction from the Pokémon (negative = behind it)
  const back = (e[0] - px) * sy + (e[2] - pz) * cy;
  for (let s = 0.5; s < 70; s += 0.5) {
    const x = e[0] + sy * dxz * s, z = e[2] + cy * dxz * s, y = e[1] + dy * s;
    if (y <= ground(x, z)) { hit = back + dxz * s; break; }
  }
  const d = clamp(hit, min, max);
  return [px + sy * d, pz + cy * d];
}
