// The signal check of task I2a (docs/RENDER3D.md "Pass order"; WORLDGEN3D Q23 confirmed point 6): a signal's colour
// and luminance on screen do not change with a map's grade, fog or bloom. The page's ?signalcheck=1 draws signal cards
// (signal scene) and world cards of the same colour (world scene), 3 m and 100 m ahead of the lens; this reads the
// pixels at their centres in every variant on both backends. The signal cards must read the reference colour (sRGB
// 255, 102, 31) within ±2 in every variant; the world cards are printed to show the variants do bite.
// usage: node tools/three-signal.mjs <build dir>/index.html [--query 'k=v&…']   (headed Chromium on the real GPU; exits 1
// on a failure). --query adds parameters to every run (a look-sheet variant, docs/looksheet).
import { chromium } from 'playwright';
import { decodePng } from '../scripts/lib/png.mjs';

const argv = process.argv.slice(2);
const extra = argv.includes('--query') ? '&' + argv[argv.indexOf('--query') + 1] : '';
const [file] = argv;
const REF = [255, 102, 31], TOL = 2;
const VARIANTS = [
  ['plain', ''],
  ['grade', '&grade=0.12,1.6,0.7,0.3'],
  ['night fog', '&tod=22'],
  ['bloom', '&bloom=2.5'],
  ['all', '&grade=-0.1,0.6,1.4,1.8&tod=22&bloom=2.5&ink=1'],
];
const b = await chromium.launch({ headless: false, args: ['--allow-file-access-from-files', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
let fails = 0;
for (const backend of ['webgpu', 'webgl']) for (const [name, q] of VARIANTS) {
  const p = await b.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  await p.goto(`file://${file}?capture=1&render=three&signalcheck=1&go=1&mode=range&species=charmander&backend=${backend}${extra}${q}`);
  await p.waitForFunction(() => window.pokewatch?.ready && !window.pokewatch.loading, null, { timeout: 90000 });
  // hide everything but the 3D canvas (the HUD, the 2D overlay), so the shot holds only the scene
  await p.evaluate(() => { window.pokewatch.advance(0.5, { frames: 30 }); for (const el of document.querySelectorAll('body *')) el.style.visibility = el.id === 'scene3d' ? 'visible' : 'hidden'; });
  await p.waitForTimeout(100);
  const pts = await p.evaluate(() => window.pokewatchThree.probe());
  const actual = await p.evaluate(() => window.pokewatchThree.backend);
  const img = decodePng(await p.screenshot());
  const px = ([x, y]) => { const k = (y * img.width + x) * 4; return [img.data[k], img.data[k + 1], img.data[k + 2]]; };
  const got = pts.map(px);
  const ok = got.slice(0, 2).every((c) => c.every((v, i) => Math.abs(v - REF[i]) <= TOL));
  if (!ok) fails++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${actual.padEnd(34)} ${name.padEnd(10)} signal near ${got[0]} far ${got[1]}   world near ${got[2]} far ${got[3]}`);
  await p.close();
}
await b.close();
process.exit(fails ? 1 : 0);
