// The esbuild side of loading recast-navigation in the page (task I3; src/nav/recast.ts says why):
// 1. "@recast-navigation/wasm" (the bare entry @recast-navigation/core's init() imports when it is given no module, the
//    `wasm-compat` build with the wasm inlined as 1 MB of base64) becomes a stub that throws: src/nav/web.ts always
//    hands init() its own module, so the inlined copy never ships.
// 2. An import of "@recast-navigation/wasm/recast-navigation.wasm.wasm" becomes a string: the URL of a content-hashed copy
//    written to <out>/nav/ (a fetched file like dist/physics/). src/nav/web.ts fetches and instantiates it.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export function navWasm(outDir) {
  return {
    name: 'recast-wasm',
    setup(build) {
      build.onStart(() => { fs.rmSync(path.join(outDir, 'nav'), { recursive: true, force: true }); });
      build.onResolve({ filter: /^@recast-navigation\/wasm$/ }, () => ({ path: 'recast-compat-stub', namespace: 'recast-wasm-stub' }));
      build.onLoad({ filter: /.*/, namespace: 'recast-wasm-stub' }, () => ({ contents: 'export default () => { throw new Error("nav: recast-navigation is initialised by src/nav/web.ts, never through its inlined wasm-compat build"); };', loader: 'js' }));
      build.onResolve({ filter: /^@recast-navigation\/wasm\/recast-navigation\.wasm\.wasm$/ }, () => ({ path: path.resolve('node_modules/@recast-navigation/wasm/dist/recast-navigation.wasm.wasm'), namespace: 'recast-wasm-url' }));
      build.onLoad({ filter: /.*/, namespace: 'recast-wasm-url' }, (a) => {
        const bytes = fs.readFileSync(a.path);
        const hash = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 8);
        const name = `nav/recast-navigation.${hash}.wasm`;
        fs.mkdirSync(path.join(outDir, 'nav'), { recursive: true });
        fs.writeFileSync(path.join(outDir, name), bytes);
        return { contents: `export default ${JSON.stringify('./' + name)};`, loader: 'js' };
      });
    },
  };
}
