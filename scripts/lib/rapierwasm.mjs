// S1 spike: the esbuild side of loading the plain @dimforge/rapier3d-deterministic (bundler) build in the page.
// 1. "./rapier_wasm3d" (raw.js's extensionless entry, which imports the .wasm through ESM integration) resolves to the
//    glue file "./rapier_wasm3d_bg.js", so the bundle never sees the .wasm import.
// 2. An import of "…/rapier_wasm3d_bg.wasm" becomes a string: the URL of a content-hashed copy written to
//    <out>/physics/ (a fetched file like dist/art/ and dist/music/). src/physics/web.ts fetches and instantiates it.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export function rapierWasm(outDir) {
  return {
    name: 'rapier-wasm',
    setup(build) {
      build.onResolve({ filter: /^\.\/rapier_wasm3d$/ }, (a) => (a.importer.includes(`${path.sep}@dimforge${path.sep}`) ? { path: path.join(a.resolveDir, 'rapier_wasm3d_bg.js') } : undefined));
      build.onResolve({ filter: /rapier_wasm3d_bg\.wasm$/ }, (a) => ({ path: a.path.startsWith('.') ? path.join(a.resolveDir, a.path) : path.resolve('node_modules', a.path), namespace: 'rapier-wasm-url' }));
      build.onLoad({ filter: /.*/, namespace: 'rapier-wasm-url' }, (a) => {
        const bytes = fs.readFileSync(a.path);
        const hash = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 8);
        const name = `physics/${path.basename(path.dirname(a.path))}.${hash}.wasm`;
        fs.mkdirSync(path.join(outDir, 'physics'), { recursive: true });
        fs.writeFileSync(path.join(outDir, name), bytes);
        return { contents: `export default ${JSON.stringify('./' + name)};`, loader: 'js' };
      });
    },
  };
}
