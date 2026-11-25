// The recast-navigation load test (task I3; src/nav/recast.ts): the loaders rely on facts of the Emscripten glue a
// recast-navigation upgrade can change silently (the `./wasm` entry, its one import module, the instantiateWasm hook).
// This inits it in Node through the real loader (src/nav/node.ts) and checks each assumption by name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { RN, navWasmBytes } from './setup/nav';
import { recastWasmDir } from '../src/nav/node';
import { checkGlue, GLUE_MODULE, RECAST_PACKAGE, RECAST_VERSION } from '../src/nav/recast';
import { NavWorld } from '../src/nav/world';
import { defaultRules } from '../src/rules/defaults';
import { fixture } from './fixtures/navmodels';

const ROOT = path.resolve(import.meta.dirname, '..');
const dir = recastWasmDir();

test(`${RECAST_PACKAGE} is pinned exactly to ${RECAST_VERSION}, with its packages at the same version`, () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.dependencies?.[RECAST_PACKAGE], RECAST_VERSION, 'package.json pins the exact version (no range)');
  for (const sub of ['core', 'wasm', 'generators']) {
    const p = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', '@recast-navigation', sub, 'package.json'), 'utf8'));
    assert.equal(p.version, RECAST_VERSION, `@recast-navigation/${sub}`);
  }
});

test('the glue facts the loader depends on hold (each named on failure)', async () => {
  const glueJs = fs.readFileSync(path.join(dir, 'dist', 'recast-navigation.wasm.js'), 'utf8');
  const mod = await WebAssembly.compile(fs.readFileSync(path.join(dir, 'dist', 'recast-navigation.wasm.wasm')));
  const factory = (await import(new URL(`file://${path.join(dir, 'dist', 'recast-navigation.wasm.js')}`).href)).default;
  assert.equal(checkGlue(factory, mod, glueJs, RECAST_VERSION), null);
  assert.deepEqual([...new Set(WebAssembly.Module.imports(mod).map((i) => i.module))], [GLUE_MODULE]);
  // the checks are live: each broken assumption is reported by name
  assert.match(checkGlue(undefined, mod)!, /factory/);
  assert.match(checkGlue(factory, mod, 'export default 1')!, /instantiateWasm/);
  assert.match(checkGlue(factory, mod, glueJs, '0.45.0')!, /0\.45\.0/);
  // the separate wasm is the one the page ships (dist/nav/), not the inlined compat build
  assert.ok(fs.statSync(path.join(dir, 'dist', 'recast-navigation.wasm.wasm')).size > 100_000);
});

test('recast-navigation is initialised in Node and builds and queries a navmesh', () => {
  assert.ok(navWasmBytes() > 0, 'the wasm memory is the instance the glue was handed');
  assert.equal(typeof RN.NavMesh, 'function');
  // a 10 x 10 m floor: every width group gets a polygon under its centre
  const N = NavWorld.build(fixture({ size: [10, 10], floors: [{ x0: -5, z0: -5, x1: 5, z1: 5, y: 0 }] }), defaultRules);
  try {
    const P = new Float64Array(3);
    for (let g = 0; g < N.graphs.length; g++) { assert.ok(N.locate(g, 0, 0, 0, 0, P) >= 0, N.names[g]); assert.ok(Math.abs(P[1]) < 0.1); }
  } finally { N.dispose(); }
});
