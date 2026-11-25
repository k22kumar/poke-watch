// The shared physics test setup (docs/OVERHAUL_3D.md "Migration rules": async WASM is initialised once at boot and once
// in a shared test setup; createRun stays synchronous). A test file that builds a run with rules.physics.engine =
// 'rapier' imports this module, which loads Rapier once per process (node --test runs each file in its own process) with
// the Node loader (src/physics/node.ts). Importing it twice awaits the same init.
import { initPhysicsNode } from '../../src/physics/node';
import { rapierMemoryBytes } from '../../src/physics/rapier';

export const R = await initPhysicsNode();
/** the wasm linear memory now (bytes): it only grows, so a leak shows as growth over a batch of runs (S1 §6) */
export const wasmBytes = (): number => rapierMemoryBytes();
