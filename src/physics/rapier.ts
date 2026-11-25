// How Rapier enters the game (docs/spikes/S1-physics.md §1, owner O1): the plain @dimforge/rapier3d-deterministic 0.21.0
// package, pinned exactly. It is a wasm-pack "bundler" build: rapier_wasm3d.js does `import * as wasm from
// "./rapier_wasm3d_bg.wasm"` (WebAssembly ESM integration), which neither Node nor an esbuild iife bundle can load as
// is. So we instantiate the .wasm ourselves: its only import module is "./rapier_wasm3d_bg.js" (the glue), and the glue
// holds the instance in a module-level `let` that every Raw* class reads at call time (`__wbg_set_wasm`). The package's
// `raw.js` re-exports "./rapier_wasm3d" (extensionless); both loaders (node.ts, web.ts with scripts/lib/rapierwasm.mjs)
// point that specifier at the glue file, so the .wasm import never runs.
//
// Those three facts are glue internals a Rapier upgrade can change silently (S1 risk R9, F38): checkGlue names the one
// that moved, and tests/physics-load.test.ts runs it in Node.
//
// One namespace per process; init once (at boot, or in the shared test setup tests/setup/physics.ts), then createRun
// stays synchronous. Only src/physics imports @dimforge/* (tests/imports.test.ts).

import type * as NS from '@dimforge/rapier3d-deterministic/exports';

export type Rapier = typeof NS;

/** the package and version the loaders are written against (package.json pins it exactly) */
export const RAPIER_PACKAGE = '@dimforge/rapier3d-deterministic';
export const RAPIER_VERSION = '0.21.0';
/** the glue module the wasm imports, and the glue's instance setter */
export const GLUE_MODULE = './rapier_wasm3d_bg.js';
export const GLUE_SETTER = '__wbg_set_wasm';

/** the glue module's surface we touch */
export interface Glue { __wbg_set_wasm(exports: WebAssembly.Exports): void; [k: string]: unknown }

let R: Rapier | undefined;
let wasmMemory: WebAssembly.Memory | undefined;

/** the namespace after init; throws before */
export function rapier(): Rapier {
  if (!R) throw new Error('physics: Rapier is not initialised (await initPhysicsNode() in Node, bootRapier() in the page) before createRun with rules.physics.engine = \'rapier\'');
  return R;
}

/** has init run? */
export const rapierReady = (): boolean => R !== undefined;

/** the wasm linear memory (bytes), for the disposal checks; 0 before init */
export const rapierMemoryBytes = (): number => (wasmMemory ? wasmMemory.buffer.byteLength : 0);

/**
 * The loader's assumptions about the package, checked before instantiating (F38): returns the first that no longer
 * holds, naming the glue internal that changed, or null. `rawJs` is raw.js's source text when the caller can read it
 * (Node); `mod` is the compiled wasm module.
 */
export function checkGlue(glue: Partial<Glue>, mod: WebAssembly.Module | null, rawJs?: string, version?: string): string | null {
  if (typeof glue[GLUE_SETTER] !== 'function') return `the glue (rapier_wasm3d_bg.js) no longer exports ${GLUE_SETTER}`;
  if (mod) {
    const names = [...new Set(WebAssembly.Module.imports(mod).map((i) => i.module))];
    if (names.length !== 1 || names[0] !== GLUE_MODULE) return `the wasm's import modules are ${JSON.stringify(names)}, not ["${GLUE_MODULE}"]`;
    const missing = WebAssembly.Module.imports(mod).find((i) => i.kind === 'function' && typeof glue[i.name] !== 'function');
    if (missing) return `the wasm imports ${missing.name} from the glue, which does not export it`;
  }
  if (rawJs !== undefined && !/from\s+["']\.\/rapier_wasm3d["']/.test(rawJs)) return 'raw.js no longer re-exports the extensionless "./rapier_wasm3d" (the loaders redirect that specifier to the glue)';
  if (version !== undefined && version !== RAPIER_VERSION) return `the package is ${version}, the loaders were written for ${RAPIER_VERSION}`;
  return null;
}

/** instantiate the module from its bytes (or a fetch Response) against the glue, then publish the namespace */
export async function initRapier(ns: Rapier, glue: Glue, source: BufferSource | Response | Promise<Response>, rawJs?: string, version?: string): Promise<Rapier> {
  if (R) return R;
  const imports = { [GLUE_MODULE]: glue as unknown as WebAssembly.ModuleImports };
  let mod: WebAssembly.Module;
  const src = await source;
  if (typeof Response !== 'undefined' && src instanceof Response) {
    // streaming compile needs application/wasm; GitHub Pages serves .wasm with it, file:// does not
    try { mod = await WebAssembly.compileStreaming(src.clone()); }
    catch { mod = await WebAssembly.compile(await src.arrayBuffer()); }
  } else {
    mod = await WebAssembly.compile(src as BufferSource);
  }
  const bad = checkGlue(glue, mod, rawJs, version);
  if (bad) throw new Error(`physics: the Rapier loader no longer fits ${RAPIER_PACKAGE}: ${bad}`);
  const inst = await WebAssembly.instantiate(mod, imports);
  glue.__wbg_set_wasm(inst.exports);
  wasmMemory = inst.exports.memory as WebAssembly.Memory;
  R = ns;
  return R;
}
