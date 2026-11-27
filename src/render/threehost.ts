// The contract between the page and the three.js side file (docs/RENDER3D.md "How it loads"). Types only: the page
// bundle never imports three, and the side file (src/render/three/entry.ts → dist/three/scene.<hash>.js, S2 decision 5)
// never bundles a page singleton. What the side file needs from the page's state it gets through ThreeHost.
import type { CreatureArt } from '../assets/art';
import type { SimContext } from '../sim/types';
import type { WorldModel } from '../world/model';
import type { Outline } from './framing';
import type { LampEmitter } from './world3d/bake';

/** the lens the page's camera rig set this frame (render/renderer.ts `cam3`); the scene draws from it */
export interface ThreeCamera {
  eye: [number, number, number];
  yaw: number;
  /** the view pitch (rad, + looks down) */
  pitch: number;
  /** vertical field of view (rad) */
  fov: number;
  near: number; far: number;
  /** the sprite's stair-smoothing offset (ChaseRig.spriteStep) */
  spriteStep: number;
  /** R3 lean on (CHASE_CONFIG.lean): the seen elevation past which a card leans back, 0 = no lean */
  leanFrom: number;
}

/** a creature sheet's draw facts as the page's renderer sized them (render/renderer.ts `sheetInfo`) */
export interface ThreeSheet { scale: number; walkRate: number; outline?: Outline }

/** one map, as the scene builds it */
export interface ThreeWorld {
  /** the map's WorldModel (the tile adapter until X1b) */
  model: WorldModel;
  /** the biome art key (world/tiles.ts `ArenaMap.gen.loc.art`, else the biome id): its binding (rules/styles) */
  artKey: string;
  lamps: LampEmitter[];
}

export interface ThreeHost {
  /** the canvas the scene draws on (inserted above the page's own, pointer events off) */
  canvas: HTMLCanvasElement;
  params: URLSearchParams;
  /** the run's map as a ThreeWorld; the page caches it per map */
  world(ctx: SimContext): ThreeWorld;
  sheet(id: string): ThreeSheet | undefined;
}

export interface ThreeReport { [k: string]: unknown }

export interface ThreeView {
  /** what actually runs: 'WebGPU' or 'WebGL 2 (WebGPURenderer fallback)' */
  readonly backend: string;
  addArt(id: string, art: CreatureArt): void;
  /** CSS pixels */
  resize(w: number, h: number): void;
  /** draw one frame of `ctx` from the page's lens */
  render(ctx: SimContext, alpha: number, cam: ThreeCamera, dt: number): void;
  /** measurements: the last frames' percentiles, draw calls, triangles, the world build's stats */
  report(): ThreeReport;
  /** clear the samples, wait `seconds`, report */
  collect(seconds: number): Promise<ThreeReport>;
}

export type CreateThreeView = (host: ThreeHost) => Promise<ThreeView>;

/** what the side file puts on the window when it has loaded */
export const THREE_GLOBAL = '__pokewatchThree';
