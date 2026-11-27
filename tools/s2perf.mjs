// Frame cost of the three.js scene (?render=three) in HEADED Chromium on the real GPU. Ported from spike/s2-three (S2
// decision 6, F42) to the game page: the page boots the range (or a map) with the 3D scene, the tool spawns S2's crowd,
// steps half a second so it is past its spawn dissolve, freezes the sim (?speed=0) unless `live`, turns the camera at
// `orbit` deg/s, and prints one JSON line: the scene's report (frame, CPU render and GPU percentiles, draw calls,
// triangles, the world build) after `seconds` of frames.
// node tools/s2perf.mjs <build dir>/index.html '<query>' [seconds=8] [warm=3] [--shot out.png] [--uncapped]
// The query is appended to ?render=three&perf=1&go=1&mode=range&species=charmander&. Its own keys: actors=<n> (default
// 240), orbit=<deg/s> (default 20), live=1 (the sim runs and the crowd walks onto the player). Everything else goes to
// the page (backend, map, mapseed, shadow, ink, bloom, bench3, …: docs/RENDER3D.md "Dev parameters").
import { chromium } from 'playwright';

const argv = process.argv.slice(2);
const shot = argv.includes('--shot') ? argv[argv.indexOf('--shot') + 1] : null;
const [file, query = '', secs = '8', warm = '3'] = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--shot');
const uncapped = argv.includes('--uncapped');
const q = new URLSearchParams(query);
const actors = Number(q.get('actors') ?? 240), orbit = Number(q.get('orbit') ?? 20), live = q.get('live') === '1';
for (const k of ['actors', 'orbit', 'live']) q.delete(k);
const res = /^(\d+)x(\d+)$/.exec(q.get('res') ?? '');
q.delete('res');
const [w, h] = res ? [Number(res[1]), Number(res[2])] : [1280, 720];
if (!live) q.set('speed', '0');
/** S2's crowd: chase walkers across the size classes (scripts/lib/crowd.ts CROWD_SPECIES) */
const CROWD = ['rattata', 'sandshrew', 'sentret', 'ekans', 'poliwag', 'gengar', 'geodude', 'zubat', 'cetoddle', 'centiskorch'];

const args = ['--allow-file-access-from-files', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'];
if (uncapped) args.push('--disable-gpu-vsync', '--disable-frame-rate-limit');
const b = await chromium.launch({ headless: false, args });
const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
const logs = [];
p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`${m.type()}: ${m.text()}`.slice(0, 300)); });
p.on('pageerror', (e) => logs.push('pageerror: ' + String(e).slice(0, 300)));
const t0 = Date.now();
await p.goto(`file://${file}?render=three&perf=1&go=1&mode=range&species=charmander&${q}`);
try {
  await p.waitForFunction(() => window.pokewatch?.ready && window.pokewatchThree, null, { timeout: 120000 });
  // the crowd on a golden-angle ring around the player, past its spawn dissolve
  await p.evaluate(([n, crowd]) => { const G = Math.PI * (3 - Math.sqrt(5)); for (let k = 0; k < n; k++) { const a = k * G, r = 6 + 24 * ((k * 0.618034) % 1); window.pokewatch.spawn(crowd[k % crowd.length], Math.cos(a) * r, Math.sin(a) * r); } }, [actors, CROWD]);
  await p.waitForFunction(() => !window.pokewatch.loading, null, { timeout: 60000 });
  await p.evaluate(() => { const c = window.pokewatch.ctx; for (let k = 0; k < 30; k++) { c.player.iframes = 1; window.pokewatch.advance(1 / 60, { frames: 1 }); } });
  // the orbit: the camera turns every frame; the player keeps its invulnerability on a live run
  await p.evaluate(([deg, keep]) => { let last = performance.now(); const tick = (t) => { const dt = (t - last) / 1000; last = t; window.pokewatch.renderer.look(deg * Math.PI / 180 * dt, 0); if (keep && window.pokewatch.ctx) window.pokewatch.ctx.player.iframes = 1; requestAnimationFrame(tick); }; requestAnimationFrame(tick); }, [orbit, live]);
} catch (e) { console.log(JSON.stringify({ error: String(e), logs })); await b.close(); process.exit(1); }
await p.waitForTimeout(Number(warm) * 1000);
const r = await p.evaluate((s) => window.pokewatchThree.collect(s), Number(secs));
if (shot) await p.screenshot({ path: shot });
const gpu = await p.evaluate(async () => {
  const a = await navigator.gpu?.requestAdapter?.();
  const info = a?.info ?? {};
  return { webgpu: !!a, vendor: info.vendor, architecture: info.architecture, timestamp: a?.features?.has('timestamp-query') ?? false };
});
console.log(JSON.stringify({ query: q.toString(), res: `${w}x${h}`, actors, orbit, live, uncapped, ...r, gpu, logs: [...new Set(logs)].slice(0, 8), wall: Date.now() - t0 }));
await b.close();
