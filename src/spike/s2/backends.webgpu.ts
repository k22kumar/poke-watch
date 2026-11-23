// S2 spike: WebGPURenderer only (S2_THREE=webgpu; 'three' resolves to three.webgpu.js so core classes are not pulled
// in twice)
import type { BackendFactory, BackendId } from './backend';
import { createWebGPU } from './webgpu';

export const BACKENDS: Partial<Record<BackendId, BackendFactory>> = {
  webgpu: (c) => createWebGPU(c, false),
  'webgpu-gl': (c) => createWebGPU(c, true),
};
