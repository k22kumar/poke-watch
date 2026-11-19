// The third-person camera's motion bench (no GL): acceptance criteria C and D of docs/THIRD_PERSON_IMPLEMENTATION.md §25.
// A track is the player's path on a real map (the sim alone, 60 Hz); the rig then follows it exactly as the renderer
// feeds it, and every frame is measured in screen space and against the world:
//
//   clear / tight   the ideal arm (scripts/lib/camrig.ts armPath) is free of terrain, bare walls, deck undersides and the
//                   map edge now and has been for 2 s: nothing gives the camera a reason to be anywhere but ideal. Props
//                   are not solids for the lens (they dissolve)
//   scale           apparent size against the settled open-ground framing: nominal / actual lens distance to the sprite
//   keep-out        the body outline (idle + walk, all rows) projected with the shader's maths (render/framing.ts)
//   P1              the final lens is not inside a solid, and not within LENS_CLEAR of one
//
// Sets: `tuning` (generated maps, seeds 1-3) is what the rig is tuned on; `holdout` (other seeds, the authored arenas,
// habitat Hold approaches, other species) is measured before the change and once after it, never tuned against.
import { KEEP_SLACK, seen, subjectBox, type CardBounds, type KeepOut, type SubjectBox } from '../../src/render/framing';
import { createRun, startStage, step } from '../../src/sim/run';
import { NO_INPUT, type SimContext } from '../../src/sim/types';
import { DECK_SLAB } from '../../src/sim/world';
import { habitatRun, walkPath } from '../habcam';
import { ADAPTER } from './camrig';
import { spriteOutline } from './silhouette';

/** what a bench reads of a rig (render/camera.ts ChaseRig, or the one before it) */
export interface RigLike {
  yaw: number; userPitch: number; viewPitch: number; fov: number; eye: number[]; boomUsed: number; shoulderUsed: number; lensGap: number; groundPops: number;
  snapTo(x: number, y: number, z: number, yaw?: number): void;
  update(f: unknown): void;
  look(dyaw: number, dpitch: number): void;
  sample(width: number, height: number): { eye: readonly number[]; dir: readonly number[]; yaw: number; viewPitch: number; fov: number; aspect: number };
}
/** what a bench needs to know about a rig's internals (scripts/lib/camrig.ts ADAPTER is the current rig's): how it is
 *  fed, where its ideal arm runs, where the sprite is drawn and how much it dissolves */
export interface RigAdapter {
  version: string;
  /** the neutral view pitch (deg below the horizon) and the base vertical field of view (deg) */
  neutral(): number; fov(): number;
  make(): RigLike;
  chaseFrame(ctx: SimContext, s: { dt: number; x: number; y: number; z: number; lookPitch: number; grounded?: boolean }): { x: number; y: number; z: number };
  armPath(rig: RigLike, f: { x: number; y: number; z: number }): number[][];
  /** the arm the rig has now, pivot → … → lens (world space) */
  arm(rig: RigLike): number[][];
  drawnFeet(rig: RigLike, px: number, py: number, pz: number): [number, number, number];
  fadeOf(rig: RigLike, box: SubjectBox): number;
  settled(id: string, viewPitch?: number): RigLike;
  chaseAim(v: { eye: readonly number[]; yaw: number; viewPitch: number; fov: number }, px: number, pz: number, aspect: number, ground: (x: number, z: number) => number): [number, number];
}

export const KEEP_OUT: KeepOut = { side: 7, below: 3 };
/** the clearance P1 asks of the final lens (m): the near plane */
export const LENS_CLEAR = 0.3;
const D2R = Math.PI / 180;

export type Mode = 'forward' | 'reverse' | 'strafeL' | 'strafeR' | 'stop' | 'approach';
export const MODES: Mode[] = ['forward', 'reverse', 'strafeL', 'strafeR', 'stop'];
export const HEADINGS = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => (k * Math.PI) / 4);

/** one tick of a track: the body's feet, its support flag, the height the renderer feeds the rig (`cy`: the last safe
 *  ground while the body is over a chasm, render/renderer.ts) and whether the run is still in play */
export interface TrackTick { x: number; y: number; z: number; g: boolean; cy: number; live: boolean }
export interface Track { ctx: SimContext; species: string; map: string; mode: Mode; pos: TrackTick[]; yaw: number[]; warm: number }
const tickOf = (ctx: SimContext): TrackTick => {
  const P = ctx.player, over = !!ctx.world.hazards && ctx.world.support(P.x, P.z, P.y) === -Infinity;
  return { x: P.x, y: P.y, z: P.z, g: P.grounded, cy: over ? Math.max(P.y, P.safeY) : P.y, live: ctx.state === 'play' };
};

/** a movement-mode track: 4 s forward along `heading` (not measured), then 3 s of the mode. The view never turns */
export function modeTrack(species: string, seed: number, stage: number, generated: boolean, heading: number, mode: Mode): Track {
  const ctx = createRun({ seed, species, ruleOverrides: generated ? { worldgen: { mode: 'generated' } } : {} });
  if (stage) startStage(ctx, stage);
  ctx.rules.director.spawnBase = -99;
  const fx = Math.sin(heading), fz = Math.cos(heading), rx = -fz, rz = fx;
  const pos: Track['pos'] = [tickOf(ctx)], yaw = [heading];
  for (let k = 0; k < 7 * 60; k++) {
    let mx = fx, mz = fz;
    if (k >= 240) {
      if (mode === 'reverse') { mx = -fx; mz = -fz; } else if (mode === 'strafeL') { mx = -rx; mz = -rz; } else if (mode === 'strafeR') { mx = rx; mz = rz; } else if (mode === 'stop') { mx = 0; mz = 0; }
    }
    step(ctx, { ...NO_INPUT, mx, mz });
    pos.push(tickOf(ctx)); yaw.push(heading);
  }
  return { ctx, species, map: ctx.world.map.id, mode, pos, yaw, warm: 240 };
}

/** a habitat Hold approach walked with the real player physics, the view turning toward the travel direction at up to
 *  3 rad/s (as scripts/habcam.ts `--yaw ahead`); null when the species cannot walk it */
export function approachTrack(recipe: string, seed: number, route: 'direct' | 'flank', species: string): Track | null {
  const ctx = habitatRun(recipe, seed, species);
  const start = tickOf(ctx);
  const walked = walkPath(ctx, route);
  if (!walked || walked.ticks.length < 180) return null;
  const T = walked.ticks, pos: Track['pos'] = [start, ...T.map((t): TrackTick => ({ x: t.x, y: t.y, z: t.z, g: t.g, cy: t.y, live: true }))], yaw: number[] = [];
  let y = Math.PI;
  for (let i = 0; i < pos.length; i++) {
    const a = pos[Math.max(0, i - 30)], b = pos[Math.min(pos.length - 1, i + 30)], hx = b.x - a.x, hz = b.z - a.z;
    const want = Math.hypot(hx, hz) > 0.5 ? Math.atan2(hx, hz) : y;
    y += Math.max(-3 / 60, Math.min(3 / 60, Math.atan2(Math.sin(want - y), Math.cos(want - y))));
    yaw.push(y);
  }
  return { ctx, species, map: ctx.world.map.id, mode: 'approach', pos, yaw, warm: 60 };
}

/** what a frame of the bench counts (sums over the measured frames of a cell) */
export interface Cell {
  frames: number; clear: number; tight: number;
  /** frames with the body over a chasm (falling): P1 only */
  voidFrames: number;
  /** C1: clear frames whose apparent scale is off 1 by more than 2 % */
  clearScaleOff: number;
  /** C3: frames with the Pokémon more than 1.25 × its nominal size */
  big: number;
  /** frames with the whole body outline outside a 16:9 frame (a wall behind takes the back arm: the lens is then beside
   *  the Pokémon, which stands off the frame's edge) */
  gone: number;
  /** A / C4: frames with the body outline inside the keep-out (`In`), and those of them with the fade under a half
   *  (`Uncovered`), among clear / tight frames */
  clearIn: number; tightIn: number; clearUncovered: number; tightUncovered: number;
  /** P1: frames with the lens inside a solid / within LENS_CLEAR of one; P2: frames whose view is not the commanded one */
  inside: number; near: number; turned: number;
  /** D1: clear frames where the lens moved more than 1 mm against the drawn Pokémon / the drawn feet moved more than
   *  0.2 % of the screen height; the largest of each */
  clearLensMoved: number; clearShifted: number; clearLensMax: number; clearShiftMax: number;
  /** D2: frames with a lens step over 0.25 m against the drawn Pokémon; those more than 0.3 s after an obstruction started
   *  on the ideal arm (`popsLate`: the arm became obstructed, or its free length dropped by more than 0.25 m in a frame);
   *  and those nothing forced (`popsUnforced`): the arm the rig had the frame before, carried along with the Pokémon and
   *  the view, is still clear of solids this frame, so the lens could have stayed where it was */
  pops: number; popsLate: number; popsUnforced: number;
  /** the same steps by size: those over 1 m, those over 2 m, and the largest (m). A rate of steps says nothing of a lens
   *  that moves the whole arm at once */
  pops1: number; pops2: number; popMax: number;
  /** boom travel (m) and steps (the body's own height changes over 0.15 m in a tick) */
  travel: number; steps: number;
}
export const emptyCell = (): Cell => ({ frames: 0, clear: 0, tight: 0, voidFrames: 0, clearScaleOff: 0, big: 0, gone: 0, clearIn: 0, tightIn: 0, clearUncovered: 0, tightUncovered: 0, inside: 0, near: 0, turned: 0, clearLensMoved: 0, clearShifted: 0, clearLensMax: 0, clearShiftMax: 0, pops: 0, popsLate: 0, popsUnforced: 0, pops1: 0, pops2: 0, popMax: 0, travel: 0, steps: 0 });
export function addCell(a: Cell, b: Cell): Cell {
  for (const k of Object.keys(a) as (keyof Cell)[]) a[k] = k === 'clearLensMax' || k === 'clearShiftMax' || k === 'popMax' ? Math.max(a[k], b[k]) : a[k] + b[k];
  return a;
}

/** the world as the lens meets it (terrain at the Pokémon's own layer, decks, bare walls; props are not solid) */
function lensWorld(ctx: SimContext) {
  const W = ctx.world, wall = W.map.wall, tops = W.wallTop;
  const ground = (x: number, z: number, py: number) => { const k = W.tile(x, z); return k < 0 ? 60 : W.isVoid(k) && W.support(x, z, py + 1) === -Infinity ? -Infinity : W.height(x, z, py + 1); };
  const ceiling = (x: number, z: number, py: number) => (W.over ? W.ceilingAt(x, z, py) : Infinity);
  // a bare wall is solid at every height, or up to the underside of a deck over it (sim/spatial.ts's wall column)
  const bare = (x: number, y: number, z: number) => { const k = W.tile(x, z); if (k < 0 || wall[k] !== 1 || (tops && tops[k] !== Infinity)) return false; const ov = W.over ? W.over[k] : 0; return !(ov > 0) || y < ov - DECK_SLAB; };
  /** is (x, y, z) in a solid, or within `clear` of a floor or a ceiling */
  const solid = (x: number, y: number, z: number, py: number, clear: number) => y < ground(x, z, py) + clear || y > ceiling(x, z, py) - clear || bare(x, y, z);
  /** P1's clearance: within LENS_CLEAR of a floor or a ceiling there, or of a solid standing that far along x or z */
  const close = (x: number, y: number, z: number, py: number) => solid(x, y, z, py, LENS_CLEAR) || solid(x + LENS_CLEAR, y, z, py, 0) || solid(x - LENS_CLEAR, y, z, py, 0) || solid(x, y, z + LENS_CLEAR, py, 0) || solid(x, y, z - LENS_CLEAR, py, 0);
  return { solid, close };
}

const nominal = new Map<string, { dist: number; card: CardBounds; mid: number }>();
function nominalOf(species: string, A: RigAdapter) {
  const key = A.version + ' ' + species;
  let n = nominal.get(key);
  if (!n) {
    const o = spriteOutline(species)!.outline, rig = A.settled(species), mid = o.top / 2;
    n = { dist: Math.hypot(rig.eye[0], rig.eye[1] - mid, rig.eye[2]), card: { l: o.left, r: o.right, t: o.top, b: 0 }, mid };
    nominal.set(key, n);
  }
  return n;
}

/** the rig following a track: the cell of its measured frames */
export interface FrameInfo { i: number; clear: boolean; clearNow: boolean; scale: number; relStep: number; shift: number; inside: boolean; near: boolean; late: boolean; rig: RigLike; feet: number[] }
export function measure(tr: Track, debug?: (f: FrameInfo) => void, A: RigAdapter = ADAPTER): Cell {
  const { ctx, pos, yaw } = tr, c = emptyCell(), L = lensWorld(ctx), N = nominalOf(tr.species, A);
  const rig = A.make();
  rig.snapTo(pos[0].x, pos[0].cy, pos[0].z, yaw[0]);
  const tf = Math.tan((A.fov() * D2R) / 2), neutral = A.neutral() * D2R;
  let clearRun = 0, wasClear = true, lastOnset = -1e9, prevFree = Infinity, prevRel: number[] | null = null, prevArm: number[][] | null = null, prevY = NaN, prevBoom = NaN;
  for (let i = 1; i < pos.length; i++) {
    const P = pos[i], Q = pos[i - 1], p = [P.x, P.cy, P.z], q = [Q.x, Q.cy, Q.z];
    rig.yaw = yaw[i];
    const f = A.chaseFrame(ctx, { dt: 1 / 60, x: P.x, y: P.cy, z: P.z, lookPitch: 0, grounded: P.g && Q.g });
    rig.update(f);
    // the ideal arm against the world
    // (sampled every 5 cm; its first 0.3 m is the body's own place, as for the rig's sweeps)
    // (how far along it the first solid is: an obstruction starts when the arm becomes obstructed, or when something
    // enters an already obstructed arm more than 0.25 m nearer the pivot than the frame before)
    const path = A.armPath(rig, f);
    let clearNow = true, free = 0;
    for (let s = 1; s < path.length && clearNow; s++) {
      const a = path[s - 1], b = path[s], len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), n = Math.max(1, Math.ceil(len / 0.05));
      for (let k = s === 1 ? 6 : 0; k <= n && clearNow; k++) { const t = k / n; if (L.close(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, p[1])) clearNow = false; else if (k) free += len / n; }
    }
    if ((!clearNow && wasClear) || free < prevFree - 0.25) lastOnset = i;
    prevFree = free;
    clearRun = clearNow ? clearRun + 1 : 0; wasClear = clearNow;
    const clear = clearRun >= 120;
    // the lens against the drawn Pokémon, in the view's own frame (right, up, forward): turning the view is not lens motion
    const feet = A.drawnFeet(rig, P.x, P.y, P.z), e = rig.eye, wx = e[0] - feet[0], wz = e[2] - feet[2], cyw = Math.cos(rig.yaw), syw = Math.sin(rig.yaw);
    const rel = [wx * -cyw + wz * syw, e[1] - feet[1], wx * syw + wz * cyw];
    const relStep = prevRel ? Math.hypot(rel[0] - prevRel[0], rel[1] - prevRel[1], rel[2] - prevRel[2]) : 0;
    // had the rig kept the arm it had the frame before (carried along with the Pokémon and the view): is that arm still
    // free? (its first 0.3 m is the body's own place)
    const armNow = A.arm(rig).map((w) => { const dx = w[0] - feet[0], dz = w[2] - feet[2]; return [dx * -cyw + dz * syw, w[1] - feet[1], dx * syw + dz * cyw]; });
    let keptFree = true;
    if (prevArm && relStep > 0.25) {
      const W3 = prevArm.map((r) => [feet[0] - cyw * r[0] + syw * r[2], feet[1] + r[1], feet[2] + syw * r[0] + cyw * r[2]]);
      let gone = 0;
      for (let s = 1; s < W3.length && keptFree; s++) {
        const a = W3[s - 1], b = W3[s], len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), n = Math.max(1, Math.ceil(len / 0.1));
        for (let k = 1; k <= n && keptFree; k++) { const t = k / n; gone += len / n; if (gone > 0.3 && L.close(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, p[1])) keptFree = false; }
      }
    }
    prevArm = armNow;
    const sy = 0.5 - Math.tan(seen(rig, feet[0], feet[1], feet[2])[1] * D2R) / tf / 2, shift = prevY === prevY ? Math.abs(sy - prevY) : 0;
    const boom = rig.boomUsed, dBoom = prevBoom === prevBoom ? Math.abs(boom - prevBoom) : 0;
    prevRel = rel; prevY = sy; prevBoom = boom;
    // a run that has ended is not measured; a body over a chasm (the rig is held at the last safe height and watches the
    // fall: render/renderer.ts) is checked for P1 only
    if (i <= tr.warm || !P.live) continue;
    const falling = Math.abs(P.cy - P.y) > 1e-6;
    c.frames++;
    if (falling) { c.voidFrames++; if (L.solid(e[0], e[1], e[2], p[1], 0)) c.inside++; else if (L.close(e[0], e[1], e[2], p[1])) c.near++; continue; }
    c.travel += dBoom;
    if (Math.abs(p[1] - q[1]) > 0.15 && P.g && Q.g) c.steps++;
    const scale = N.dist / Math.max(0.05, Math.hypot(rel[0], rel[1] - N.mid, rel[2]));
    if (scale > 1.25) c.big++;
    const box = subjectBox(rig, feet, N.card, KEEP_OUT), inKeep = box.depth > KEEP_SLACK, uncovered = inKeep && A.fadeOf(rig, box) < 0.5;
    const hv = (rig.fov * 90) / Math.PI, hx = (Math.atan(Math.tan(rig.fov / 2) * (16 / 9)) * 180) / Math.PI;
    if (box.right < -hx || box.left > hx || box.top < -hv || box.bottom > hv) c.gone++;
    const inside = L.solid(e[0], e[1], e[2], p[1], 0);
    const nearS = !inside && L.close(e[0], e[1], e[2], p[1]);
    if (inside) c.inside++; else if (nearS) c.near++;
    if (debug) debug({ i, clear, clearNow, scale, relStep, shift, inside, near: nearS, late: relStep > 0.25 && i - lastOnset > 18, rig, feet });
    if (Math.abs(Math.atan2(Math.sin(rig.yaw - yaw[i]), Math.cos(rig.yaw - yaw[i]))) > 1e-9 || Math.abs(rig.viewPitch - neutral) > 1e-9) c.turned++;
    if (relStep > 0.25) { c.pops++; if (relStep > 1) c.pops1++; if (relStep > 2) c.pops2++; if (relStep > c.popMax) c.popMax = relStep; if (i - lastOnset > 18) c.popsLate++; if (keptFree) c.popsUnforced++; }
    if (clear) {
      c.clear++;
      if (Math.abs(scale - 1) > 0.02) c.clearScaleOff++;
      if (inKeep) c.clearIn++;
      if (uncovered) c.clearUncovered++;
      if (relStep > 0.001) c.clearLensMoved++;
      if (shift > 0.002) c.clearShifted++;
      c.clearLensMax = Math.max(c.clearLensMax, relStep); c.clearShiftMax = Math.max(c.clearShiftMax, shift);
    } else { c.tight++; if (inKeep) c.tightIn++; if (uncovered) c.tightUncovered++; }
  }
  return c;
}

export interface BenchSet { name: 'tuning' | 'holdout'; species: string[]; tracks(species: string): Generator<Track> }

export const TUNING: BenchSet = {
  name: 'tuning', species: ['pichu', 'cyndaquil', 'quilava', 'charizard', 'feraligatr'],
  *tracks(sp) { for (const seed of [1, 2, 3]) for (const stage of [0, 1, 2, 3]) for (const h of HEADINGS) for (const m of MODES) yield modeTrack(sp, seed, stage, true, h, m); },
};
export const HOLDOUT: BenchSet = {
  name: 'holdout', species: ['joltik', 'totodile', 'croconaw', 'venusaur', 'lapras'],
  *tracks(sp) {
    for (const seed of [7, 8, 9]) for (const stage of [0, 1, 2, 3]) for (const h of HEADINGS) for (const m of MODES) yield modeTrack(sp, seed, stage, true, h, m);
    for (const seed of [1, 2]) for (const stage of [0, 1, 2, 3]) for (const h of HEADINGS) for (const m of MODES) yield modeTrack(sp, seed, stage, false, h, m);
    for (const recipe of ['river-gorge', 'volcanic-ridge']) for (const seed of [1, 2, 3]) for (const route of ['direct', 'flank'] as const) { const t = approachTrack(recipe, seed, route, sp); if (t) yield t; }
  },
};

/** a set (or some of its species), per species × mode */
export function runBench(set: BenchSet, species = set.species, A: RigAdapter = ADAPTER): Record<string, Cell> {
  const cells: Record<string, Cell> = {};
  for (const sp of species) for (const tr of set.tracks(sp)) addCell((cells[`${sp} ${tr.mode}`] ??= emptyCell()), measure(tr, undefined, A));
  return cells;
}

const pc = (a: number, b: number) => (b ? +((100 * a) / b).toFixed(1) : 0);
/** the cells as the criteria read them */
export function benchTable(cells: Record<string, Cell>) {
  return Object.fromEntries(Object.entries(cells).map(([k, c]) => [k, {
    frames: c.frames, 'clear %': pc(c.clear, c.frames),
    'C1 clear, scale off %': pc(c.clearScaleOff, c.clear),
    'C3 >1.25x %': pc(c.big, c.frames), 'out of frame %': pc(c.gone, c.frames),
    'A clear, in keep-out % (unfaded)': `${pc(c.clearIn, c.clear)} (${pc(c.clearUncovered, c.clear)})`, 'C4 tight, in keep-out % (unfaded)': `${pc(c.tightIn, c.tight)} (${pc(c.tightUncovered, c.tight)})`,
    'P1 inside / near %': `${pc(c.inside, c.frames)} / ${pc(c.near, c.frames)}`, 'P2 turned': c.turned,
    'D1 clear lens moved % (max m)': `${pc(c.clearLensMoved, c.clear)} (${c.clearLensMax.toFixed(3)})`, 'D1 clear shifted % (max)': `${pc(c.clearShifted, c.clear)} (${c.clearShiftMax.toFixed(3)})`,
    'D2 pops /min (late, unforced)': `${(c.pops / (c.frames / 3600)).toFixed(2)} (${(c.popsLate / (c.frames / 3600)).toFixed(2)}, ${(c.popsUnforced / (c.frames / 3600)).toFixed(2)})`,
    'pops over 1 m / 2 m /min (largest m)': `${(c.pops1 / (c.frames / 3600)).toFixed(2)} / ${(c.pops2 / (c.frames / 3600)).toFixed(2)} (${c.popMax.toFixed(2)})`,
    'boom m/s': +(c.travel / (c.frames / 60)).toFixed(3), 'steps /min': +(c.steps / (c.frames / 3600)).toFixed(1),
  }]));
}
