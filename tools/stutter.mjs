// Real-time frame pacing on this machine's GPU and display (docs/ROADMAP.md item 2, P5). Unlike perf.mjs it does not
// step the sim from the tool: the game runs its own requestAnimationFrame loop, and this script times it from outside,
// so the same measurement runs on any build (the current one and the survivor-final tag alike).
//
//   node tools/stutter.mjs <html> <label> "<query>" [seconds=20] [turn=1.2] [--headless] [--pos=x,y] [--size=w,h]
//
// --pos places the window (screen points from the main display's top-left), so a run can be pinned to one display
// when the machine has several with different refresh rates. --warm=<s> sets the warm-up (default 3; 0 times the first
// seconds of the run, when sprites, shaders and effects are used for the first time). --heap adds a sampling heap
// profile of the recorded seconds (CDP HeapProfiler): the functions that allocate the most, for the GC rate.
//
// It opens a visible Chromium window (headless Chromium has no real vsync and, on most machines, no real GPU), waits
// for pokewatch.ready and 3 s of warm-up, then records <seconds> of frames while the bot plays (?autoplay) and the
// camera turns at <turn> rad/s through renderer.look (a steady turn, one step per frame, so the mouse's own cadence is
// not part of the number). Per frame: the rAF interval, the main loop's JS time, renderer.render's JS time, and the
// sim ticks it ran (from ctx.time). Also: long tasks, and heap drops over 1 MB (garbage collections). Prints one JSON line.
import { chromium } from 'playwright';

const [file, label, query, secArg, turnArg] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const headless = process.argv.includes('--headless');
const opt = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const [vw, vh] = (opt('size') ?? '1600,900').split(',').map(Number);
const seconds = Number(secArg ?? 20), turn = Number(turnArg ?? 1.2);
if (!file || !query) { console.error('usage: node tools/stutter.mjs <html> <label> "<query>" [seconds] [turn rad/s] [--headless]'); process.exit(2); }

const b = await chromium.launch({
  headless,
  args: [...(opt('pos') ? [`--window-position=${opt('pos')}`] : []), `--window-size=${vw},${vh + 120}`, '--enable-precise-memory-info', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--autoplay-policy=no-user-gesture-required'],
});
const p = await b.newPage({ viewport: { width: vw, height: vh } });
const errors = [];
p.on('pageerror', (e) => errors.push(String(e)));

await p.addInitScript(() => {
  const R = (window.__stutter = { on: false, turn: 0, f: [], js: [], ren: [], ticks: [], heapDrops: [], longs: [], lastHeap: 0 });
  const raf = window.requestAnimationFrame.bind(window);
  let last = 0;
  window.requestAnimationFrame = (cb) => raf((now) => {
    const pw = window.pokewatch, c = pw?.ctx;
    if (R.on && pw?.renderer && !pw.renderer.__timed) {
      const r = pw.renderer, orig = r.render.bind(r);
      r.render = (...a) => { const t0 = performance.now(); const v = orig(...a); R.renNow += performance.now() - t0; return v; };
      r.__timed = true;
    }
    // several callbacks can share one frame (the game loop and any UI animation): they are one frame, summed
    const same = now === last;
    if (R.on && pw?.renderer && last && !same) pw.renderer.look(R.turn * Math.min(0.1, (now - last) / 1000), 0);
    const t0 = performance.now(), simT0 = c ? c.time : 0;
    const ren0 = same ? R.renNow : 0;
    R.renNow = ren0;
    cb(now);
    const js = performance.now() - t0;
    if (R.on && same && R.f.length) {
      const k = R.f.length - 1;
      R.js[k] += js; R.ren[k] = R.renNow; R.ticks[k] += c ? Math.round((c.time - simT0) / c.dt) : 0;
      return;
    }
    if (R.on) {
      if (last) {
        R.f.push(now - last); R.js.push(js); R.ren.push(R.renNow);
        R.ticks.push(c ? Math.round((c.time - simT0) / c.dt) : -1);
      }
      const h = performance.memory?.usedJSHeapSize ?? 0;
      if (R.lastHeap - h > 1 << 20) R.heapDrops.push((R.lastHeap - h) / (1 << 20));
      R.lastHeap = h;
    }
    last = now;
  });
  try { new PerformanceObserver((l) => { if (R.on) for (const e of l.getEntries()) R.longs.push(e.duration); }).observe({ type: 'longtask' }); } catch { /* unsupported */ }
});

await p.goto('file://' + file + (query.startsWith('?') ? query : '?' + query));
await p.waitForFunction(() => window.pokewatch?.ready && window.pokewatch.ctx, null, { timeout: 120000 });
const gpu = await p.evaluate(() => {
  const gl = document.createElement('canvas').getContext('webgl2'); const e = gl?.getExtension('WEBGL_debug_renderer_info');
  return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl?.getParameter(gl.RENDERER);
});
await p.waitForTimeout(Number(opt('warm') ?? 3) * 1000);
const cdp = process.argv.includes('--heap') ? await p.context().newCDPSession(p) : null;
if (cdp) { await cdp.send('HeapProfiler.enable'); await cdp.send('HeapProfiler.startSampling', { samplingInterval: 16384, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true }); }
await p.evaluate((turn) => { window.__stutter.on = true; window.__stutter.turn = turn; }, turn);
await p.waitForTimeout(seconds * 1000);
let heap = null;
if (cdp) {
  const { profile } = await cdp.send('HeapProfiler.stopSampling');
  const by = new Map();
  const walk = (n, stack) => {
    const f = n.callFrame, name = `${f.functionName || '(anon)'}@${f.lineNumber}:${f.columnNumber}`;
    if (n.selfSize) by.set(name, (by.get(name) ?? 0) + n.selfSize);
    for (const ch of n.children) walk(ch, stack);
  };
  walk(profile.head, []);
  const total = [...by.values()].reduce((a, v) => a + v, 0);
  heap = { sampledMB: +(total / 2 ** 20).toFixed(1), top: [...by].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, v]) => `${(v / 2 ** 20).toFixed(1)} MB ${k}`) };
}
const r = await p.evaluate(() => {
  const R = window.__stutter; R.on = false;
  const c = window.pokewatch.ctx;
  let alive = 0; if (c) for (let i = 0; i < c.enemies.hi; i++) alive += c.enemies.alive[i] ? 1 : 0;
  return { f: R.f, js: R.js, ren: R.ren, ticks: R.ticks, heapDrops: R.heapDrops, longs: R.longs, alive, map: c?.world?.map?.id ?? null, state: c?.state };
});
await b.close();

const q = (a, x) => { const s = [...a].sort((m, n) => m - n); return s.length ? +s[Math.min(s.length - 1, Math.floor(x * (s.length - 1) + 0.5))].toFixed(2) : null; };
const med = q(r.f, 0.5);
const mean = r.f.reduce((a, v) => a + v, 0) / r.f.length;
const sd = Math.sqrt(r.f.reduce((a, v) => a + (v - mean) ** 2, 0) / r.f.length);
const hist = [0, 0, 0, 0]; for (const t of r.ticks) if (t >= 0) hist[Math.min(3, t)]++;
// a frame that stands out: over 1.8x the display's median interval (and over 12 ms)
const lim = Math.max(12, med * 1.8);
const out = {
  label, gpu, seconds, viewport: `${vw}x${vh}`, frames: r.f.length, fps: +(1000 / mean).toFixed(1), map: r.map, alive: r.alive, state: r.state,
  frameMs: { p50: med, p95: q(r.f, 0.95), p99: q(r.f, 0.99), max: q(r.f, 1), sd: +sd.toFixed(2) },
  hitches: r.f.filter((v) => v > lim).length, over25: r.f.filter((v) => v > 25).length, over50: r.f.filter((v) => v > 50).length,
  // the main loop's JS time and the part of it in renderer.render (the rest: sim ticks, HUD, audio)
  jsMs: { p50: q(r.js, 0.5), p95: q(r.js, 0.95), p99: q(r.js, 0.99), max: q(r.js, 1) },
  renderMs: { p50: q(r.ren, 0.5), p95: q(r.ren, 0.95), max: q(r.ren, 1) },
  // the main loop's JS time in the frames that were hitches (is the long frame our code, or something outside it?)
  // interval / JS ms @ seconds into the recording
  hitchJs: (() => { let t = 0; return r.f.map((v, i) => { t += v; return [v, r.js[i], t]; }); })().filter(([v]) => v > lim).slice(0, 16).map(([v, j, t]) => `${v.toFixed(0)}/${j.toFixed(1)}@${(t / 1000).toFixed(1)}s`),
  ticksPerFrame: hist,
  gc: { n: r.heapDrops.length, mb: +r.heapDrops.reduce((a, v) => a + v, 0).toFixed(1), perSec: +(r.heapDrops.length / seconds).toFixed(2) },
  longTasks: { n: r.longs.length, max: r.longs.length ? Math.max(...r.longs).toFixed(0) : 0 },
  errors: errors.slice(0, 3),
  ...(heap ? { heap } : {}),
};
console.log(JSON.stringify(out));
