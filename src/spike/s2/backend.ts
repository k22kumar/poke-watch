// S2 spike (docs/spikes/S2-renderer.md): what each renderer configuration gives the shared scene code. Never merged.
import type { Camera, Material, Object3D, Scene, Texture, Vector3, Vector4 } from 'three';

export type BackendId = 'webgl' | 'webgpu' | 'webgpu-gl';

/** uniforms every creature material shares (one set per backend, written once a frame) */
export interface CreatureUniforms {
  right: Vector3; fwd: Vector3; cam: Vector3; light: Vector3;
  /** seen elevation (rad) past which a card leans back (LEAN_FROM), 0 = no lean */
  lean: { value: number };
  sil: Vector4;
}

export interface FrameInfo { calls: number; triangles: number; gpuMs: number | null }

export interface Backend {
  id: BackendId;
  /** what actually ran: 'WebGL 2 (WebGLRenderer)', 'WebGPU', 'WebGL 2 (WebGPURenderer fallback)' */
  actual: string;
  canvas: HTMLCanvasElement;
  setSize(w: number, h: number): void;
  /** shadow maps on or off (decided once, before the first frame) */
  setShadows(on: boolean): void;
  /** a creature billboard material for one atlas; `xray` = the silhouette variant (depth GREATER, no depth write) */
  creatureMaterial(tex: Texture, xray: boolean): Material;
  /** the shared uniforms creatureMaterial reads */
  readonly cu: CreatureUniforms;
  /** draw one frame (with the optional edge pass when enabled) */
  render(scene: Scene, camera: Camera): void;
  /** info for the frame just drawn (gpuMs: the last resolved GPU timer, null when the backend has none) */
  info(): FrameInfo;
  /** turn the full-screen edge pass over depth and normals on (step 3 extra); `hide` objects are left out of the normal
   *  pre-pass where the backend needs one */
  enableEdges(scene: Scene, camera: Camera, hide: Object3D[]): void;
  readonly edges: boolean;
  /** extra notes for the record (feature support seen at run time) */
  notes: string[];
}

export type BackendFactory = (canvas: HTMLCanvasElement) => Promise<Backend>;
