// The page loader for recast-navigation (src/nav/recast.ts says why). The esbuild plugin (scripts/lib/navwasm.mjs)
// turns the .wasm import into the URL of dist/nav/recast-navigation.<hash>.wasm, a fetched file like dist/physics/, and
// stubs the package's inlined wasm-compat entry out of the bundle; here we fetch and instantiate it. src/main.ts calls
// it once at boot when the run navigates on the navmesh (?nav=navmesh), before createRun.
import factory from '@recast-navigation/wasm/wasm';
import wasmUrl from '@recast-navigation/wasm/recast-navigation.wasm.wasm';
import { initRecast, type GlueFactory } from './recast';

/** fetch + instantiate; resolves with the init time (ms, fetch included) and the URL */
export async function bootRecast(): Promise<{ ms: number; url: string }> {
  const t0 = performance.now();
  await initRecast(factory as unknown as GlueFactory, fetch(wasmUrl));
  return { ms: performance.now() - t0, url: wasmUrl };
}
