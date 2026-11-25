// The Node loader (tsx scripts, tests; docs/spikes/S1-physics.md §1). A synchronous in-thread resolve hook
// (module.registerHooks, Node ≥ 22.15, package.json "engines") fixes the two things Node's ESM resolver refuses in the
// bundler build: extensionless relative specifiers ("../raw", "./dynamics") and the "./rapier_wasm3d" entry that
// imports the .wasm (pointed at the glue instead). Then the namespace is imported dynamically (static imports would
// resolve before the hook exists) and the .wasm bytes read from node_modules. The page never imports this file.
import fs from 'node:fs';
import { createRequire, registerHooks } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { initRapier, rapierReady, rapier, RAPIER_PACKAGE, type Rapier, type Glue } from './rapier';

let hooked = false;

function hook() {
  if (hooked) return;
  hooked = true;
  if (typeof registerHooks !== 'function') throw new Error(`physics: module.registerHooks is missing (Node ${process.versions.node}); the Rapier loader needs Node >= 22.15`);
  registerHooks({
    resolve(spec, ctx, next) {
      const inPkg = ctx.parentURL?.includes('/@dimforge/');
      if (!inPkg || !spec.startsWith('.')) return next(spec, ctx);
      if (spec === './rapier_wasm3d') return { url: new URL('./rapier_wasm3d_bg.js', ctx.parentURL).href, format: 'module', shortCircuit: true };
      if (path.extname(spec) === '.js') return { ...next(spec, ctx), format: 'module' };
      const base = new URL(spec, ctx.parentURL);
      for (const cand of [base.href + '.js', base.href + '/index.js']) {
        if (fs.existsSync(new URL(cand))) return { url: cand, format: 'module', shortCircuit: true };
      }
      return next(spec, ctx);
    },
  });
}

/** where the package lives */
export function rapierDir(): string {
  const req = createRequire(import.meta.url);
  return path.dirname(req.resolve(`${RAPIER_PACKAGE}/package.json`));
}

let pending: Promise<Rapier> | null = null;

/** init Rapier in this process (once; later calls return the same namespace) */
export function initPhysicsNode(): Promise<Rapier> {
  if (rapierReady()) return Promise.resolve(rapier());
  if (!pending) pending = (async () => {
    hook();
    const dir = rapierDir();
    const glue = (await import(pathToFileURL(path.join(dir, 'rapier_wasm3d_bg.js')).href)) as Glue;
    const ns = (await import(pathToFileURL(path.join(dir, 'exports.js')).href)) as Rapier;
    const bytes = fs.readFileSync(path.join(dir, 'rapier_wasm3d_bg.wasm'));
    const rawJs = fs.readFileSync(path.join(dir, 'raw.js'), 'utf8');
    const version = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version as string;
    return initRapier(ns, glue, bytes, rawJs, version);
  })();
  return pending;
}
