// What the camera benches (scripts/camframe.ts, scripts/lib/cambench.ts, scripts/camaim.ts) need to know about the
// rig's internals, in one place: how a subject is fed to it, where its ideal arm runs, where the renderer draws the
// sprite and how much it dissolves. The benches themselves only read the rig's public view, so the same measuring code
// runs before and after a rig change; only this file is rewritten with it.
//
// THIS VERSION: the second-pass rig (2026-11-18): an L-shaped arm (pivot on the outline's top, hand to the side, lens
// behind the hand) framed from the sprite's measured outline. The version for the rig before it is in git history
// (docs/camaudit/2026-11-18-before.json was measured with it).
import { CHASE_CONFIG, ChaseRig, boomElevation, chaseAim, chasePivotH, type ChaseFrame } from '../../src/render/camera';
import { chaseFrameFor, type ChaseSubject } from '../../src/render/chaseinput';
import { fadeFor, type SubjectBox } from '../../src/render/framing';
import { bodyOf } from '../../src/rules/sizing';
import { SPECIES_BY_ID } from '../../src/rules/species';
import type { SimContext } from '../../src/sim/types';
import type { RigAdapter } from './cambench';
import { spriteOutline } from './silhouette';
import { frameBodyOf } from './giants';

export const RIG_VERSION = '2026-11-18 second pass';
const D2R = Math.PI / 180;

/** the subject fields of a synthetic frame for a species (what chaseFrameFor passes for it in a run) */
export function subjectOf(id: string): Partial<ChaseFrame> {
  const b = frameBodyOf(id); // a game species, or a capture-only giant from the fixture (scripts/lib/giants.ts)
  return { height: b.height, visual: b.visualM, outline: spriteOutline(id)?.outline };
}

/** the rig's frame for a run, as the renderer builds it (the active Pokémon's measured outline included) */
export function chaseFrame(ctx: SimContext, s: ChaseSubject): ChaseFrame {
  return chaseFrameFor(ctx, { ...s, outline: s.outline ?? spriteOutline(ctx.player.species.id)?.outline });
}

/** the ideal arm for the rig's yaw and pitch, as a polyline pivot → hand → ideal lens (world space): what must be free
 *  of solids for the frame to count as "clear" */
export function armPath(rig: ChaseRig, f: ChaseFrame): number[][] {
  const el = boomElevation(rig.userPitch + rig.tilt), e = el * D2R, back = rig.backWant, s = rig.shoulderWant;
  const sy = Math.sin(rig.yaw), cy = Math.cos(rig.yaw), ox = f.x, oy = f.y + chasePivotH(rig.cornerTop, back, s, el), oz = f.z;
  const hx = ox - cy * s, hz = oz + sy * s;
  return [[ox, oy, oz], [hx, oy, hz], [hx - sy * Math.cos(e) * back, oy + Math.sin(e) * back, hz - cy * Math.cos(e) * back]];
}

/** where the renderer draws the sprite's feet when the body's interpolated feet are (px, py, pz): the sprite shares the
 *  rig's stair smoothing, up to CHASE_CONFIG.step.sprite of its own height */
export function drawnFeet(rig: ChaseRig, px: number, py: number, pz: number): [number, number, number] {
  return [px, py + rig.spriteStep, pz];
}

/** the dissolve (0..1) the renderer draws the player's own sprite with for a frame whose box is `box` (render/renderer.ts
 *  drawSprites: the near-plane rule, and the keep-out fade; the renderer's easing out of the latter is not modelled) */
export function fadeOf(rig: ChaseRig, box: SubjectBox): number {
  const gap = rig.lensGap;
  const near = gap >= 0.45 ? Math.min(0.75, Math.max(0, (0.95 - gap) / 0.5)) : Math.min(0.95, 0.75 + ((0.45 - gap) / 0.15) * 0.2);
  return Math.max(near, fadeFor(box.depth));
}

/** the rig settled on open flat ground behind a species, looking along -z, at a view pitch (deg below the horizon) */
export function settled(id: string, viewPitch: number = CHASE_CONFIG.aimPitch.neutral): ChaseRig {
  const rig = new ChaseRig();
  const f: ChaseFrame = { dt: 1 / 60, x: 0, y: 0, z: 0, height: 1, ...subjectOf(id), grounded: true, lookYaw: 0, lookPitch: 0, ground: () => 0 };
  rig.snapTo(0, 0, 0, Math.PI);
  rig.look(0, (viewPitch - CHASE_CONFIG.aimPitch.neutral) * D2R);
  for (let k = 0; k < 150; k++) rig.update(f);
  return rig;
}

/** `--set frame.boom=3.8,aimPitch.neutral=10`: CHASE_CONFIG values for this run only (tuning) */
export function applySet(argv: string[] = process.argv): string {
  const i = argv.indexOf('--set');
  if (i < 0) return '';
  for (const kv of argv[i + 1].split(',')) {
    const [path, v] = kv.split('='), keys = path.split('.');
    let o = CHASE_CONFIG as unknown as Record<string, unknown>;
    for (const k of keys.slice(0, -1)) o = o[k] as Record<string, unknown>;
    if (!(keys[keys.length - 1] in o)) throw new Error('no CHASE_CONFIG.' + path);
    o[keys[keys.length - 1]] = Number(v);
  }
  return argv[i + 1];
}

/** the current rig, as the benches drive it (scripts/lib/cambench.ts RigAdapter) */
export const ADAPTER: RigAdapter = {
  version: RIG_VERSION,
  neutral: () => CHASE_CONFIG.aimPitch.neutral, fov: () => CHASE_CONFIG.fov,
  make: () => new ChaseRig(),
  chaseFrame: (ctx, s) => chaseFrame(ctx, s),
  armPath: (rig, f) => armPath(rig as ChaseRig, f as ChaseFrame),
  arm: (r) => { const rig = r as ChaseRig, oy = rig.py + rig.pivotH, s = rig.shoulderUsed; return [[rig.px, oy, rig.pz], [rig.px - Math.cos(rig.yaw) * s, oy, rig.pz + Math.sin(rig.yaw) * s], rig.eye]; },
  drawnFeet: (rig, px, py, pz) => drawnFeet(rig as ChaseRig, px, py, pz),
  fadeOf: (rig, box) => fadeOf(rig as ChaseRig, box),
  settled: (id, viewPitch) => settled(id, viewPitch),
  chaseAim: (v, px, pz, aspect, ground) => chaseAim(v as never, px, pz, aspect, ground),
};
