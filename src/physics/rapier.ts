// S1 spike (docs/spikes/S1-physics.md): how Rapier enters the game. The plain @dimforge/rapier3d-deterministic package
// is a wasm-pack "bundler" build: rapier_wasm3d.js does `import * as wasm from "./rapier_wasm3d_bg.wasm"` (WebAssembly
// ESM integration), which neither Node nor an esbuild iife bundle can load as is. So we instantiate the .wasm ourselves:
// its only import module is "./rapier_wasm3d_bg.js" (the glue), and the glue holds the instance in a module-level `let`
// that every Raw* class reads at call time (`__wbg_set_wasm`). The package's `raw.js` re-exports "./rapier_wasm3d"
// (extensionless); both loaders point that specifier at the glue file, so the .wasm import never runs.
//
// One RAPIER namespace per process; init once (boot, or a shared test setup), then createRun stays synchronous.

import type * as NS from '@dimforge/rapier3d-deterministic/exports';

export type Rapier = typeof NS;

/** the glue module's surface we touch */
interface Glue { __wbg_set_wasm(exports: WebAssembly.Exports): void; [k: string]: unknown }

let R: Rapier | undefined;
let wasmMemory: WebAssembly.Memory | undefined;

/** the namespace after init; throws before */
export function rapier(): Rapier {
  if (!R) throw new Error('physics: initRapier() has not run');
  return R;
}

/** the wasm linear memory (for the memory probe) */
export const rapierMemory = () => wasmMemory;

/** instantiate the module from its bytes (or a fetch Response) against the glue, then publish the namespace */
export async function initRapier(ns: Rapier, glue: Glue, source: BufferSource | Response | Promise<Response>): Promise<Rapier> {
  if (R) return R;
  const imports = { './rapier_wasm3d_bg.js': glue as unknown as WebAssembly.ModuleImports };
  let inst: WebAssembly.Instance;
  const src = await source;
  if (typeof Response !== 'undefined' && src instanceof Response) {
    // streaming compile needs application/wasm; GitHub Pages serves .wasm with it, file:// does not
    try { inst = (await WebAssembly.instantiateStreaming(src.clone(), imports)).instance; }
    catch { inst = (await WebAssembly.instantiate(await src.arrayBuffer(), imports)).instance; }
  } else {
    inst = (await WebAssembly.instantiate(src as BufferSource, imports)).instance;
  }
  glue.__wbg_set_wasm(inst.exports);
  wasmMemory = inst.exports.memory as WebAssembly.Memory;
  R = ns;
  return R;
}
