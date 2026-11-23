// S2 spike: WebGLRenderer only (S2_THREE=webgl)
import type { BackendFactory, BackendId } from './backend';
import { createWebGL } from './webgl';

export const BACKENDS: Partial<Record<BackendId, BackendFactory>> = { webgl: (c) => createWebGL(c) };
