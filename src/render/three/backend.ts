// Backend selection (S2 decision 1, D14): WebGPURenderer on its WebGPU backend where the browser has WebGPU, its WebGL 2
// backend everywhere else, the same TSL either way. ?backend=webgl forces the WebGL 2 backend (the Q20(c) baseline the
// budgets are measured on), ?backend=webgpu asks for WebGPU (and falls back, as the renderer does, where there is none).
// Ported from spike/s2-three (src/spike/s2/webgpu.ts createWebGPU), minus the spike's output-path experiments.
import { WebGPURenderer } from 'three/webgpu';

export type BackendPick = 'auto' | 'webgpu' | 'webgl';

export interface Backend {
  renderer: WebGPURenderer;
  pick: BackendPick;
  /** what actually runs */
  actual: string;
  /** GPU timestamp queries are on (only with ?perf=1: they cost a resolve per frame) */
  timestamps: boolean;
}

export const backendPick = (v: string | null): BackendPick => (v === 'webgl' || v === 'webgpu' ? v : 'auto');

export async function createBackend(canvas: HTMLCanvasElement, pick: BackendPick, perf: boolean): Promise<Backend> {
  const renderer = new WebGPURenderer({ canvas, antialias: false, forceWebGL: pick === 'webgl', trackTimestamp: perf, powerPreference: 'high-performance' } as never);
  renderer.setPixelRatio(1);
  await renderer.init();
  const be = (renderer as unknown as { backend: { isWebGPUBackend?: boolean; trackTimestamp?: boolean } }).backend;
  return { renderer, pick, actual: be.isWebGPUBackend ? 'WebGPU' : 'WebGL 2 (WebGPURenderer fallback)', timestamps: !!be.trackTimestamp };
}
