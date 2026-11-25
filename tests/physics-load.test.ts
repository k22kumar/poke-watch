// The Rapier load test (docs/spikes/S1-physics.md §1 and risk R9; owner O1, F38): the loaders rely on wasm-bindgen glue
// internals a Rapier upgrade can change silently. This inits Rapier in Node through the real loader (src/physics/node.ts)
// and checks each assumption by name, so a failure says which internal moved rather than "physics is broken".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { R } from './setup/physics';
import { rapierDir } from '../src/physics/node';
import { checkGlue, GLUE_MODULE, GLUE_SETTER, RAPIER_PACKAGE, RAPIER_VERSION, rapierMemoryBytes } from '../src/physics/rapier';

const ROOT = path.resolve(import.meta.dirname, '..');
const dir = rapierDir();
const read = (f: string) => fs.readFileSync(path.join(dir, f));

test(`${RAPIER_PACKAGE} is pinned exactly to ${RAPIER_VERSION} and Node is >= 22.15`, () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.dependencies?.[RAPIER_PACKAGE], RAPIER_VERSION, 'package.json pins the exact version (no range)');
  assert.equal(pkg.engines?.node, '>=22.15', 'module.registerHooks (the Node loader) needs Node 22.15');
  assert.equal(JSON.parse(read('package.json').toString()).version, RAPIER_VERSION, 'the installed package');
  const [maj, min] = process.versions.node.split('.').map(Number);
  assert.ok(maj > 22 || (maj === 22 && min >= 15), `this Node is ${process.versions.node}`);
});

test('the glue internals the loader depends on are where it expects them (each named on failure)', async () => {
  const mod = await WebAssembly.compile(read('rapier_wasm3d_bg.wasm'));
  const glue = await import(new URL(`file://${path.join(dir, 'rapier_wasm3d_bg.js')}`).href);
  const raw = read('raw.js').toString();
  assert.equal(checkGlue(glue, mod, raw, RAPIER_VERSION), null);
  // the checks are live: each broken assumption is reported by name
  assert.match(checkGlue({}, mod, raw)!, new RegExp(GLUE_SETTER));
  assert.match(checkGlue(glue, mod, 'export * from "./rapier_wasm3d.js";')!, /raw\.js/);
  assert.match(checkGlue(glue, mod, raw, '0.22.0')!, /0\.22\.0/);
  const { [Object.keys(glue).find((k) => k.startsWith('__wbg_') && k !== GLUE_SETTER)!]: _drop, ...partial } = glue;
  assert.match(checkGlue(partial, mod, raw)!, /imports __wbg_/);
  assert.deepEqual([...new Set(WebAssembly.Module.imports(mod).map((i) => i.module))], [GLUE_MODULE]);
});

test('Rapier is initialised in Node and answers a query', () => {
  assert.equal(R.version(), RAPIER_VERSION);
  assert.ok(rapierMemoryBytes() > 0, 'the wasm memory is the instance the glue was handed');
  const w = new R.World({ x: 0, y: 0, z: 0 });
  try {
    w.createCollider(R.ColliderDesc.cuboid(1, 1, 1).setTranslation(0, -1, 0));
    w.step();
    const hit = w.castRayAndGetNormal(new R.Ray({ x: 0, y: 5, z: 0 }, { x: 0, y: -1, z: 0 }), 10, true);
    assert.ok(hit && Math.abs(hit.timeOfImpact - 5) < 1e-6 && hit.normal.y === 1);
  } finally { w.free(); }
});
