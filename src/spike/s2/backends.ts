// S2 spike: every configuration (the default build). scripts/build.mjs S2_THREE=webgl|webgpu swaps this module for
// backends.webgl.ts or backends.webgpu.ts so each configuration's bundle bytes can be measured alone.
import type { BackendFactory, BackendId } from './backend';
import { createWebGL } from './webgl';
import { createWebGPU } from './webgpu';

export const BACKENDS: Partial<Record<BackendId, BackendFactory>> = {
  webgl: (c) => createWebGL(c),
  webgpu: (c) => createWebGPU(c, false),
  'webgpu-gl': (c) => createWebGPU(c, true),
};
