// S1 spike: page-side Rapier init time. Opens <dir>/index.html?physics=rapier over file:// (the tools' way) and over a
// local http server (GitHub Pages' way: streaming compile), N cold loads each, prints pokewatchRapier.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const dir = path.resolve(process.argv[2]), N = Number(process.argv[3] ?? 5);
const types = { '.html': 'text/html', '.wasm': 'application/wasm', '.png': 'image/png', '.json': 'application/json', '.mp3': 'audio/mpeg' };
const srv = http.createServer((q, r) => { const f = path.join(dir, decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': types[path.extname(f)] ?? 'application/octet-stream' }); fs.createReadStream(f).pipe(r); }).listen(0);
const port = srv.address().port;
const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
for (const [name, url] of [['file', 'file://' + path.join(dir, 'index.html') + '?physics=rapier'], ['http', `http://127.0.0.1:${port}/index.html?physics=rapier`]]) {
  const ms = [];
  for (let i = 0; i < N; i++) {
    const ctx = await browser.newContext(); const page = await ctx.newPage();
    await page.goto(url);
    const info = await page.waitForFunction(() => window.pokewatchRapier, null, { timeout: 30000 }).then((h) => h.jsonValue());
    if (info.error) { console.log(name, 'ERROR', info.error); break; }
    ms.push(info.initMs);
    if (i === 0) console.log(name, JSON.stringify(info));
    await ctx.close();
  }
  ms.sort((a, b) => a - b);
  console.log(name, 'init ms over', ms.length, 'cold loads: min', ms[0]?.toFixed(1), 'median', ms[ms.length >> 1]?.toFixed(1), 'max', ms[ms.length - 1]?.toFixed(1));
}
await browser.close(); srv.close();
