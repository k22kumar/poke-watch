// S2 spike (docs/spikes/S2-renderer.md): frame time of the three.js spike page in HEADED Chromium on the real GPU.
// node tools/s2perf.mjs <build dir>/index.html '<query>' [seconds=8] [warm=3] [--shot out.png] [--uncapped]
// The query is appended to ?render=three&. --uncapped launches with --disable-gpu-vsync --disable-frame-rate-limit so the
// frame interval is the throughput, not the display's refresh. Prints one JSON line (the page's s2.report()).
import { chromium } from 'playwright';

const [file, query = '', secs = '8', warm = '3'] = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && !(all[i - 1] === '--shot'));
const shot = process.argv.includes('--shot') ? process.argv[process.argv.indexOf('--shot') + 1] : null;
const uncapped = process.argv.includes('--uncapped');
const res = /res=(\d+)x(\d+)/.exec(query);
const [w, h] = res ? [Number(res[1]), Number(res[2])] : [1280, 720];
const args = ['--allow-file-access-from-files', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'];
if (uncapped) args.push('--disable-gpu-vsync', '--disable-frame-rate-limit');
const b = await chromium.launch({ headless: false, args });
const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
const logs = [];
p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning' || m.text().startsWith('[s2]')) logs.push(`${m.type()}: ${m.text()}`.slice(0, 400)); });
p.on('pageerror', (e) => logs.push('pageerror: ' + String(e).slice(0, 400)));
const t0 = Date.now();
await p.goto('file://' + file + '?render=three&' + query);
try { await p.waitForFunction(() => window.s2?.ready, null, { timeout: 120000 }); } catch (e) { console.log(JSON.stringify({ error: String(e), logs })); await b.close(); process.exit(1); }
await p.waitForTimeout(Number(warm) * 1000);
const r = await p.evaluate((s) => window.s2.collect(s), Number(secs));
if (shot) await p.screenshot({ path: shot });
const gpu = await p.evaluate(async () => {
  const a = await navigator.gpu?.requestAdapter?.();
  const info = a?.info ?? {};
  return { webgpu: !!a, vendor: info.vendor, architecture: info.architecture, description: info.description, timestamp: a?.features?.has('timestamp-query') ?? false };
});
console.log(JSON.stringify({ query, uncapped, wallBootMs: null, ...r, gpu, logs: [...new Set(logs)].slice(0, 12), wall: Date.now() - t0 }));
await b.close();
