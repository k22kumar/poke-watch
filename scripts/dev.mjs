// Dev server: rebuilds dist/index.html on every change and serves it at http://localhost:5173. The Pokémon art
// (dist/art/) is written once at start (restart after regenerating src/content/art.json); the music goes to dist/music/.
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { writeArt } from './lib/artfiles.mjs';
import { rapierWasm } from './lib/rapierwasm.mjs';

const art = await writeArt('dist/art');
console.log(`dist/art/ ${art.files} files`);

const writeHtml = {
  name: 'write-html',
  setup(build) {
    build.onEnd((res) => {
      if (res.errors.length) return;
      const js = res.outputFiles?.find((f) => f.path.endsWith('.js'))?.text ?? '';
      for (const f of res.outputFiles ?? []) if (!f.path.endsWith('.js') && !fs.existsSync(f.path)) { fs.mkdirSync(path.dirname(f.path), { recursive: true }); fs.writeFileSync(f.path, f.contents); }
      const tpl = fs.readFileSync('index.html', 'utf8');
      const css = fs.readFileSync('src/ui/style.css', 'utf8');
      fs.mkdirSync('dist', { recursive: true });
      fs.writeFileSync('dist/index.html', tpl.replace('/*__CSS__*/', () => css).replace('/*__JS__*/', () => js.replace(/<\/script/g, '<\\/script')));
      console.log(`[${new Date().toLocaleTimeString()}] rebuilt dist/index.html`);
    });
  },
};

const ctx = await esbuild.context({ entryPoints: ['src/main.ts'], outdir: 'dist', bundle: true, loader: { '.mp3': 'file' }, assetNames: 'music/[name].[hash]', publicPath: '.', define: { __ART__: JSON.stringify({ manifest: art.manifest, heroes: art.heroes }) }, format: 'iife', target: 'es2022', write: false, sourcemap: 'inline', plugins: [rapierWasm('dist'), writeHtml] });
await ctx.watch();
const { port } = await ctx.serve({ servedir: 'dist', port: 5173 });
console.log(`Poke-Watch dev server: http://localhost:${port}  (edit src/** and reload)`);
