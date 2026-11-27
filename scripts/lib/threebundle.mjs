// The three.js side file (S2 decision 5, task I2a; docs/RENDER3D.md "How it loads"): three and the 3D scene
// (src/render/three/entry.ts) bundled alone into <out>/three/scene.<hash>.js, a classic script the page loads only with
// ?render=three (src/render/threeload.ts). Returns the URL the page bundle is built with (__THREE_URL__) and the byte
// counts the build reports (S2 decision 5: every task that adds a runtime library reports page and side-file bytes).
import * as esbuild from 'esbuild';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** 'three' (what three's addons may import) is the WebGPU build: importing three.module.js beside three.webgpu.js
 *  would bundle WebGLRenderer too (docs/spikes/S2-renderer.md "Import paths for the smallest bundle") */
const threeWebgpu = {
  name: 'three-webgpu',
  setup(b) { b.onResolve({ filter: /^three$/ }, () => ({ path: path.resolve('node_modules/three/build/three.webgpu.js') })); },
};

export async function buildThree(outDir, { minify = true, sourcemap = false } = {}) {
  const dir = path.join(outDir, 'three');
  const out = await esbuild.build({
    entryPoints: ['src/render/three/entry.ts'], bundle: true, format: 'iife', target: 'es2022', minify, write: false, sourcemap: sourcemap ? 'inline' : false, legalComments: 'none',
    metafile: true, plugins: [threeWebgpu], logLevel: 'silent',
  });
  const js = out.outputFiles[0].contents;
  const hash = crypto.createHash('sha256').update(js).digest('hex').slice(0, 8);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const name = `scene.${hash}.js`;
  fs.writeFileSync(path.join(dir, name), js);
  let three = 0;
  for (const o of Object.values(out.metafile.outputs)) for (const [k, v] of Object.entries(o.inputs)) if (k.includes('node_modules/three/')) three += v.bytesInOutput;
  return { url: `./three/${name}`, bytes: js.length, three };
}

/** fails when the page bundle took in three: three ships in the side file only (S2 decision 5) */
export function assertNoThree(metafile) {
  const hit = Object.values(metafile.outputs).flatMap((o) => Object.keys(o.inputs)).filter((k) => k.includes('node_modules/three/') || k.includes('src/render/three/'));
  if (hit.length) throw new Error(`the page bundle imports three.js or src/render/three (it belongs in the side file): ${hit.slice(0, 5).join(', ')}`);
}
