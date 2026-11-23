// S2 spike: the current game's boot for reference (the hand-written WebGL2 renderer): navigation start to the range
// match being ready and to the next frame after it, in headed Chromium. node tools/s2gameboot.mjs <html> [runs=5]
import { chromium } from 'playwright';

const [file, runs = '5'] = process.argv.slice(2);
const out = [];
for (let i = 0; i < Number(runs); i++) {
  const b = await chromium.launch({ headless: false, args: ['--allow-file-access-from-files'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  await p.goto('file://' + file + '?go=1&mode=range&species=charmander');
  await p.waitForFunction(() => window.pokewatch?.ready, null, { timeout: 120000 });
  out.push(await p.evaluate(() => new Promise((res) => { const ready = performance.now(); requestAnimationFrame(() => requestAnimationFrame(() => res({ ready: Math.round(ready), frame: Math.round(performance.now()) }))); })));
  await b.close();
}
console.log(JSON.stringify(out));
