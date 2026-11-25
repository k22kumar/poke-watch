// Build: bundles src/main.ts and inlines it into dist/index.html, which holds only code (and the UI font and icons).
// The Pokémon art is written beside it as dist/art/ (scripts/lib/artfiles.mjs), the music as dist/music/ and the Rapier
// wasm as dist/physics/ (scripts/lib/rapierwasm.mjs); the page fetches them (docs/ROADMAP.md "Item 3: A1 plan"). The build fails when dist/index.html is over PAGE_BUDGET.
// `--out <dir>` writes there instead of dist/ (a private build for captures while other sessions use dist/: CLAUDE.md
// "Parallel sessions").
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { writeArt } from './lib/artfiles.mjs';
import { rapierWasm } from './lib/rapierwasm.mjs';

/** dist/index.html's size budget (bytes): the page is code; art and music are side files */
const PAGE_BUDGET = 3_000_000;

const OUT = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : 'dist';
fs.mkdirSync(OUT, { recursive: true });
// the game's art files first: the bundle is built with their names
const art = await writeArt(path.join(OUT, 'art'));
console.log(`${path.join(OUT, 'art')}/ ${art.files} files, ${(art.bytes / 1024).toFixed(0)} KB`);
const out = await esbuild.build({
  entryPoints: ['src/main.ts'], bundle: true, format: 'iife', target: 'es2022', minify: !process.argv.includes('--dev'), write: false, sourcemap: false, legalComments: 'none',
  // the music is fetched from dist/music/ (content-hashed names)
  loader: { '.mp3': 'file' }, outdir: OUT, assetNames: 'music/[name].[hash]', publicPath: '.',
  define: { __ART__: JSON.stringify({ manifest: art.manifest, heroes: art.heroes }) },
  // the Rapier wasm is fetched from dist/physics/ (content-hashed name; src/physics/web.ts)
  plugins: [rapierWasm(OUT)],
});
const js = out.outputFiles.find((f) => f.path.endsWith('.js')).text;
fs.rmSync(path.join(OUT, 'music'), { recursive: true, force: true });
for (const f of out.outputFiles) if (!f.path.endsWith('.js')) { fs.mkdirSync(path.dirname(f.path), { recursive: true }); fs.writeFileSync(f.path, f.contents); }
const tpl = fs.readFileSync('index.html', 'utf8');
// the UI font ships inside the page (SIL OFL Pixelify Sans subset, content/fonts/)
const font = fs.readFileSync('content/fonts/PixelifySans.woff').toString('base64');
const css = `@font-face{font-family:'Pixelify Sans';src:url(data:font/woff;base64,${font}) format('woff');font-weight:400 700;font-display:block}\n` + fs.readFileSync('src/ui/style.css', 'utf8');
const html = tpl.replace('/*__CSS__*/', () => css).replace('/*__JS__*/', () => js.replace(/<\/script/g, '<\\/script'));
fs.writeFileSync(path.join(OUT, 'index.html'), html);
const size = Buffer.byteLength(html);
console.log(path.join(OUT, 'index.html'), (size / 1024).toFixed(0) + ' KB');
// no single-file variant (owner, 2026-11-22): a page that fetches its art cannot be one file
fs.rmSync(path.join(OUT, 'poke-watch-artifact.html'), { force: true });
if (size > PAGE_BUDGET) {
  console.error(`${path.join(OUT, 'index.html')} is ${(size / 1e6).toFixed(2)} MB, over the ${PAGE_BUDGET / 1e6} MB budget: art, music and other data belong in side files (docs/ROADMAP.md "Item 3: A1 plan")`);
  process.exit(1);
}
