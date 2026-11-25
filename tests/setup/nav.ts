// The shared navigation test setup (docs/OVERHAUL_3D.md "Migration rules": async WASM is initialised once at boot and
// once in a shared test setup; createRun stays synchronous). A test file that builds a run with rules.nav.engine =
// 'navmesh', or a NavWorld, imports this module, which loads recast-navigation once per process (node --test runs each
// file in its own process) with the Node loader (src/nav/node.ts). Importing it twice awaits the same init.
import { initNavNode } from '../../src/nav/node';
import { recastMemoryBytes } from '../../src/nav/recast';

export const RN = await initNavNode();
/** the wasm linear memory now (bytes): it only grows, so a leak shows as growth over a batch of builds */
export const navWasmBytes = (): number => recastMemoryBytes();
