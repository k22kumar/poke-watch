// Size captures with the debug overlay (docs/size-extremes-plan.md §S3). Like tools/cap.mjs, plus:
//   - each scene may name a `build` (key into --builds), so flag-on and flag-off rows run against their own page;
//   - {overlay: opts} injects tools/sizeoverlay.js once and calls __sizeOverlay.draw(opts) (a DOM canvas over #game,
//     so a `shot` of the page includes it; the game's own frame is untouched);
//   - {eval} results are kept whole in <outdir>/<scene>.json (cap.mjs truncates them into its log).
//
//   node tools/sizecap.mjs --builds on=.capture/on/index.html,off=.capture/off/index.html tools/sizescenes.json <outdir> [filter]
//
// Playwright is not a dependency: `npm i --no-save playwright` first (tools/README.md).
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const bi = argv.indexOf('--builds');
const builds = Object.fromEntries((bi >= 0 ? argv.splice(bi, 2)[1] : '').split(',').filter(Boolean).map((kv) => { const [k, v] = kv.split('='); return [k, path.resolve(v)]; }));
const [scenesFile, out, filter] = argv;
const overlaySrc = fs.readFileSync(new URL('./sizeoverlay.js', import.meta.url), 'utf8');
const scenes = JSON.parse(fs.readFileSync(scenesFile, 'utf8')).filter((s) => !filter || s.name.includes(filter));
fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
for (const sc of scenes) {
  const file = builds[sc.build ?? 'on'];
  if (!file) { console.log(`${sc.name}: no build '${sc.build ?? 'on'}' (pass --builds)`); continue; }
  const p = await b.newPage({ viewport: { width: sc.w ?? 1280, height: sc.h ?? 720 } });
  const logs = [], results = [];
  p.on('console', (m) => { if (!/GPU stall|GL Driver|TUNNEL|Failed to load resource/.test(m.text())) logs.push(m.type() + ': ' + m.text()); });
  p.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message));
  await p.goto('file://' + file + '?capture=1&' + (sc.query ?? ''));
  await p.waitForFunction(() => window.pokewatch?.ready, null, { timeout: 60000 });
  let injected = false;
  for (const st of sc.steps) {
    if (st.advance !== undefined) await p.evaluate((st) => window.pokewatch.advance(st.advance, st), st);
    if (st.eval) results.push(await p.evaluate(st.eval));
    if (st.overlay) {
      if (!injected) { await p.addScriptTag({ content: overlaySrc }); injected = true; }
      const o = { ...st.overlay };
      if (o.marksFrom) { const f = path.resolve(o.marksFrom); o.marks = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {}; delete o.marksFrom; }
      await p.evaluate((o) => {
        // face: turn every enemy to this facing (0 = towards the classic camera, the idle reference frame) for this render
        // only; advance(0) draws without stepping the sim, which would turn them back to the partner
        const E = window.pokewatch.ctx.enemies;
        if (o.face !== undefined) for (let i = 0; i < E.hi; i++) if (E.alive[i]) E.facing[i] = o.face;
        window.pokewatch.advance(0); return window.__sizeOverlay.draw(o);
      }, o);
    }
    if (st.measure) { if (!injected) { await p.addScriptTag({ content: overlaySrc }); injected = true; } results.push(await p.evaluate((ids) => window.__sizeOverlay.measure(ids), st.measure)); }
    if (st.frame) { if (!injected) { await p.addScriptTag({ content: overlaySrc }); injected = true; } results.push(await p.evaluate(() => { window.pokewatch.advance(0); return window.__sizeOverlay.frame(); })); }
    if (st.shot) await p.screenshot({ path: `${out}/${sc.name}-${st.shot}.png` });
  }
  fs.writeFileSync(`${out}/${sc.name}.json`, JSON.stringify({ scene: sc.name, build: sc.build ?? 'on', results, logs }, null, 1));
  console.log(sc.name, sc.build ?? 'on', logs.filter((l) => /ERROR|error/.test(l)).join(' | '));
  await p.close();
}
await b.close();
