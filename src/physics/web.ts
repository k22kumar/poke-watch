// S1 spike: the page loader. The esbuild plugin (scripts/lib/rapierwasm.mjs) points the package's .wasm entry at the glue
// and turns the .wasm import into the URL of dist/physics/<pkg>.<hash>.wasm; here we fetch and instantiate it.
import * as ns from '@dimforge/rapier3d-deterministic/exports';
import * as glue from '@dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js';
import wasmUrl from '@dimforge/rapier3d-deterministic/rapier_wasm3d_bg.wasm';
import { initRapier, type Rapier } from './rapier';

/** fetch + instantiate; resolves with the namespace and the init time (ms, fetch included) */
export async function bootRapier(): Promise<{ R: Rapier; ms: number; url: string }> {
  const t0 = performance.now();
  const R = await initRapier(ns as Rapier, glue as never, fetch(wasmUrl));
  return { R, ms: performance.now() - t0, url: wasmUrl };
}
