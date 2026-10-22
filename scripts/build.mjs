// Build: bundles src/main.ts and inlines it into a single self-contained dist/index.html.
// `node scripts/build.mjs --tool sheets` builds a dev tool page instead.
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const overworld = process.argv.includes('--overworld');
const tool = process.argv.includes('--tool') ? process.argv[process.argv.indexOf('--tool') + 1] : null;
const entry = tool ? `src/tools/${tool}.ts` : overworld ? 'src/overworld/main.ts' : 'src/main.ts';
const out = await esbuild.build({ entryPoints: [entry], bundle: true, format: 'iife', target: 'es2022', minify: !tool && !process.argv.includes('--dev'), write: false, sourcemap: false, legalComments: 'none' });
const js = out.outputFiles[0].text;
fs.mkdirSync('dist', { recursive: true });
if (tool) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${tool}</title><style>body{background:#2a3040;color:#fff;font:12px sans-serif;margin:8px}#root{display:flex;flex-wrap:wrap;gap:8px}.card{background:#59617a;padding:4px;text-align:center}canvas{image-rendering:pixelated;display:block}</style></head><body><div id="root"></div><script>${js}</script></body></html>`;
  fs.writeFileSync(`dist/${tool}.html`, html);
  console.log(`dist/${tool}.html`, (html.length / 1024).toFixed(0) + ' KB');
} else if (overworld) {
  const tpl = fs.readFileSync('overworld.html', 'utf8');
  const css = fs.readFileSync('src/overworld/style.css', 'utf8');
  const html = tpl.replace('/*__CSS__*/', () => css).replace('/*__JS__*/', () => js.replace(/<\/script/g, '<\\/script'));
  fs.writeFileSync('dist/overworld.html', html);
  const frag = html.replace(/^[\s\S]*?<title>[^<]*<\/title>/, '<title>Maplebrook</title>').replace(/<\/head>\s*<body>/, '').replace(/<\/body>\s*<\/html>\s*$/, '').replace(/<meta name="viewport"[^>]*>/, '');
  fs.writeFileSync('dist/maplebrook-artifact.html', frag);
  console.log('dist/overworld.html', (html.length / 1024).toFixed(0) + ' KB');
} else {
  const tpl = fs.readFileSync('index.html', 'utf8');
  // the UI font ships inside the page (SIL OFL Pixelify Sans subset, content/fonts/)
  const font = fs.readFileSync('content/fonts/PixelifySans.woff').toString('base64');
  const css = `@font-face{font-family:'Pixelify Sans';src:url(data:font/woff;base64,${font}) format('woff');font-weight:400 700;font-display:block}\n` + fs.readFileSync('src/ui/style.css', 'utf8');
  const html = tpl.replace('/*__CSS__*/', () => css).replace('/*__JS__*/', () => js.replace(/<\/script/g, '<\\/script'));
  fs.writeFileSync('dist/index.html', html);
  console.log('dist/index.html', (html.length / 1024).toFixed(0) + ' KB');
  // fragment variant for hosts that wrap the page in their own document skeleton
  const frag = html.replace(/^[\s\S]*?<title>[^<]*<\/title>/, '<title>Poke-Watch</title>').replace(/<\/head>\s*<body>/, '').replace(/<\/body>\s*<\/html>\s*$/, '').replace(/<meta name="viewport"[^>]*>/, '');
  fs.writeFileSync('dist/poke-watch-artifact.html', frag);
}
