// S1 spike: the Node loader (tsx scripts, tests). A synchronous in-thread resolve hook (module.registerHooks, Node ≥ 22.15)
// fixes the two things Node's ESM resolver refuses in the bundler build: extensionless relative specifiers ("../raw",
// "./dynamics") and the "./rapier_wasm3d" entry that imports the .wasm (pointed at the glue instead). Then the
// namespace is imported dynamically (static imports would resolve before the hook exists) and the .wasm bytes read
// from node_modules.
import fs from 'node:fs';
import { createRequire, registerHooks } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { initRapier, type Rapier } from './rapier';

export type Variant = 'deterministic' | 'simd' | 'deterministic-compat';
let hooked = false;

function hook() {
  if (hooked) return;
  hooked = true;
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

/** init Rapier in Node from the named package variant; returns the namespace and the init time (ms) */
export async function initRapierNode(variant: Variant = 'deterministic'): Promise<{ R: Rapier; ms: number; wasmBytes: number }> {
  const t0 = performance.now();
  const pkg = `@dimforge/rapier3d-${variant}`;
  const req = createRequire(import.meta.url);
  const dir = path.dirname(req.resolve(`${pkg}/package.json`));
  if (variant === 'deterministic-compat') {
    // the compat build embeds the wasm as base64 and exports init()
    const ns = (await import(pathToFileURL(path.join(dir, 'rapier.mjs')).href)) as Rapier & { init(): Promise<void> };
    await ns.init();
    const R = await initRapier(ns as Rapier, { __wbg_set_wasm() {} }, new Uint8Array(0)).catch(() => ns as Rapier);
    return { R, ms: performance.now() - t0, wasmBytes: 0 };
  }
  hook();
  const glue = await import(pathToFileURL(path.join(dir, 'rapier_wasm3d_bg.js')).href);
  const ns = (await import(pathToFileURL(path.join(dir, 'exports.js')).href)) as Rapier;
  const bytes = fs.readFileSync(path.join(dir, 'rapier_wasm3d_bg.wasm'));
  const R = await initRapier(ns, glue, bytes);
  return { R, ms: performance.now() - t0, wasmBytes: bytes.byteLength };
}
