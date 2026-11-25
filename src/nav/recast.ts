// How recast-navigation enters the game (task I3; docs/OVERHAUL_3D.md "Navigation (I3)"): the recast-navigation 0.44.0
// packages, pinned exactly (package.json; @recast-navigation/core, /wasm and /generators are its exact dependencies).
// The wasm package ships two builds: the default `wasm-compat` entry inlines the module as base64 (1,013,548 B of JS),
// and the `./wasm` entry is the Emscripten glue (recast-navigation.wasm.js, 560,115 B unminified) beside a separate
// recast-navigation.wasm.wasm (340,097 B). We take the second and hand the glue the compiled module ourselves through
// Emscripten's `instantiateWasm` hook, so the glue never fetches or locates anything: Node reads the bytes from
// node_modules (src/nav/node.ts), the page fetches the content-hashed side file dist/nav/ (src/nav/web.ts with
// scripts/lib/navwasm.mjs), as I1a does for Rapier.
//
// Those are glue facts a recast-navigation upgrade can change silently (as S1 risk R9 for Rapier): checkGlue names the
// one that moved, and tests/nav-load.test.ts runs it in Node.
//
// One module per process; init once (at boot with ?nav=navmesh, or in the shared test setup tests/setup/nav.ts), then
// createRun stays synchronous. Only src/nav imports recast-navigation (tests/imports.test.ts).

import * as core from '@recast-navigation/core';

export type Recast = typeof core;

/** the package and version the loaders are written against (package.json pins it exactly) */
export const RECAST_PACKAGE = 'recast-navigation';
export const RECAST_VERSION = '0.44.0';
/** the wasm's one import module (Emscripten's minified "env") */
export const GLUE_MODULE = 'a';

/** the glue's factory: `factory({ instantiateWasm })` resolves with the Emscripten module */
export type GlueFactory = (arg: { instantiateWasm: (imports: WebAssembly.Imports, done: (i: WebAssembly.Instance, m: WebAssembly.Module) => void) => object }) => Promise<unknown>;

let ready = false;
let heap: (() => number) | null = null;

/** the core namespace after init; throws before */
export function recast(): Recast {
  if (!ready) throw new Error('nav: recast-navigation is not initialised (await initNavNode() in Node, bootRecast() in the page) before createRun with rules.nav.engine = \'navmesh\'');
  return core;
}

/** has init run? */
export const recastReady = (): boolean => ready;

/** the wasm linear memory (bytes), for the disposal checks; 0 before init */
export const recastMemoryBytes = (): number => (heap ? heap() : 0);

/**
 * The loader's assumptions about the package (as physics/rapier.ts checkGlue): returns the first that no longer holds,
 * naming what changed, or null. `glueJs` is the glue's source text when the caller can read it (Node).
 */
export function checkGlue(factory: unknown, mod: WebAssembly.Module | null, glueJs?: string, version?: string): string | null {
  if (typeof factory !== 'function') return 'the glue (recast-navigation.wasm.js) no longer has a default-exported factory';
  if (mod) {
    const names = [...new Set(WebAssembly.Module.imports(mod).map((i) => i.module))];
    if (names.length !== 1 || names[0] !== GLUE_MODULE) return `the wasm's import modules are ${JSON.stringify(names)}, not ["${GLUE_MODULE}"]`;
  }
  if (glueJs !== undefined && !glueJs.includes('instantiateWasm')) return 'the glue no longer honours Module.instantiateWasm (the loaders hand it the compiled module through it)';
  if (version !== undefined && version !== RECAST_VERSION) return `the package is ${version}, the loaders were written for ${RECAST_VERSION}`;
  return null;
}

/** compile the module from its bytes (or a fetch Response), instantiate it through the glue, then init core */
export async function initRecast(factory: GlueFactory, source: BufferSource | Response | Promise<Response>, glueJs?: string, version?: string): Promise<Recast> {
  if (ready) return core;
  const src = await source;
  let mod: WebAssembly.Module;
  if (typeof Response !== 'undefined' && src instanceof Response) {
    // streaming compile needs application/wasm; GitHub Pages serves .wasm with it, file:// does not
    try { mod = await WebAssembly.compileStreaming(src.clone()); }
    catch { mod = await WebAssembly.compile(await src.arrayBuffer()); }
  } else {
    mod = await WebAssembly.compile(src as BufferSource);
  }
  const bad = checkGlue(factory, mod, glueJs, version);
  if (bad) throw new Error(`nav: the recast-navigation loader no longer fits ${RECAST_PACKAGE}: ${bad}`);
  // core.init(impl) awaits impl() for the Emscripten module (its type names the glue's own factory)
  const impl = () => factory({
    instantiateWasm(imports, done) {
      WebAssembly.instantiate(mod, imports).then((inst) => done(inst, mod));
      return {};
    },
  });
  await core.init(impl as never);
  const M = core.Raw.Module as unknown as { HEAPU8: Uint8Array };
  heap = () => M.HEAPU8.buffer.byteLength;
  ready = true;
  return core;
}
