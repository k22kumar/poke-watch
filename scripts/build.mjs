// Build: bundles src/main.ts and inlines it into dist/index.html, which holds only code (and the UI font and icons).
// The Pokémon art is written beside it as dist/art/ (scripts/lib/artfiles.mjs) and the music as dist/music/; the page
// fetches both (docs/ROADMAP.md "Item 3: A1 plan"). The build fails when dist/index.html is over PAGE_BUDGET.
// `node scripts/build.mjs --tool sheets` builds a dev tool page instead. `--out <dir>` writes there instead of dist/ (a
// private build for captures while other sessions use dist/: CLAUDE.md "Parallel sessions").
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { writeArt } from './lib/artfiles.mjs';

/** dist/index.html's size budget (bytes): the page is code; art and music are side files */
const PAGE_BUDGET = 3_000_000;

const overworld = process.argv.includes('--overworld');
const tool = process.argv.includes('--tool') ? process.argv[process.argv.indexOf('--tool') + 1] : null;
const entry = tool ? `src/tools/${tool}.ts` : overworld ? 'src/overworld/main.ts' : 'src/main.ts';
const game = !tool && !overworld;
const OUT = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : 'dist';
fs.mkdirSync(OUT, { recursive: true });
// the game's art files first: the bundle is built with their names
const art = game ? await writeArt(path.join(OUT, 'art')) : null;
if (art) console.log(`${path.join(OUT, 'art')}/ ${art.files} files, ${(art.bytes / 1024).toFixed(0)} KB`);
const out = await esbuild.build({
  entryPoints: [entry], bundle: true, format: 'iife', target: 'es2022', minify: !tool && !process.argv.includes('--dev'), write: false, sourcemap: false, legalComments: 'none',
  // the game's music is fetched from dist/music/ (content-hashed names); the tool and overworld pages keep it inline
  ...(game ? { loader: { '.mp3': 'file' }, outdir: OUT, assetNames: 'music/[name].[hash]', publicPath: '.' } : { loader: { '.mp3': 'dataurl' } }),
  define: { __ART__: JSON.stringify(art ? { manifest: art.manifest, heroes: art.heroes } : { manifest: '', heroes: '' }) },
});
const js = out.outputFiles.find((f) => f.path.endsWith('.js')).text;
if (game) {
  fs.rmSync(path.join(OUT, 'music'), { recursive: true, force: true });
  for (const f of out.outputFiles) if (!f.path.endsWith('.js')) { fs.mkdirSync(path.dirname(f.path), { recursive: true }); fs.writeFileSync(f.path, f.contents); }
}
if (tool) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${tool}</title><style>body{background:#2a3040;color:#fff;font:12px sans-serif;margin:8px}#root{display:flex;flex-wrap:wrap;gap:8px}.card{background:#59617a;padding:4px;text-align:center}canvas{image-rendering:pixelated;display:block}</style></head><body><div id="root"></div><script>${js}</script></body></html>`;
  fs.writeFileSync(path.join(OUT, `${tool}.html`), html);
  console.log(path.join(OUT, `${tool}.html`), (html.length / 1024).toFixed(0) + ' KB');
} else if (overworld) {
  const tpl = fs.readFileSync('overworld.html', 'utf8');
  const css = fs.readFileSync('src/overworld/style.css', 'utf8');
  const html = tpl.replace('/*__CSS__*/', () => css).replace('/*__JS__*/', () => js.replace(/<\/script/g, '<\\/script'));
  fs.writeFileSync(path.join(OUT, 'overworld.html'), html);
  const frag = html.replace(/^[\s\S]*?<title>[^<]*<\/title>/, '<title>Maplebrook</title>').replace(/<\/head>\s*<body>/, '').replace(/<\/body>\s*<\/html>\s*$/, '').replace(/<meta name="viewport"[^>]*>/, '');
  fs.writeFileSync(path.join(OUT, 'maplebrook-artifact.html'), frag);
  console.log(path.join(OUT, 'overworld.html'), (html.length / 1024).toFixed(0) + ' KB');
} else {
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
}
