// Deterministic scene capture. usage: node cap.mjs <html> <scenes.json> <outdir> [filter]
// scene: { name, query, w?, h?, steps: [ {advance, bot?, input?, frames?} | {shot} | {raw} | {eval} | {metrics} | {click} | {key} | {wait} ] }
//   metrics -> one JSON line per scene in <outdir>/metrics.jsonl (pokewatch.metrics(): figure-ground contrast, overlay cover)
//   shot -> <outdir>/<name>-<shot>.png (page screenshot);  raw -> internal-resolution canvas pixels
import { chromium } from 'playwright';
import fs from 'node:fs';
const [,, file, scenesFile, out, filter] = process.argv;
const scenes = JSON.parse(fs.readFileSync(scenesFile, 'utf8')).filter((s) => !filter || s.name.includes(filter));
fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
for (const sc of scenes) {
  const p = await b.newPage({ viewport: { width: sc.w ?? 1280, height: sc.h ?? 720 } });
  const logs = [];
  p.on('console', (m) => { if (!/GPU stall|GL Driver|TUNNEL|Failed to load resource/.test(m.text())) logs.push(m.type() + ': ' + m.text()); });
  p.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message));
  await p.goto('file://' + file + '?capture=1&' + (sc.query ?? ''));
  await p.waitForFunction(() => window.pokewatch?.ready, null, { timeout: 90000 }).catch(() => logs.push('not ready'));
  await p.waitForTimeout(300);
  for (const st of sc.steps ?? []) {
    if (st.advance !== undefined) await p.evaluate((st) => window.pokewatch.advance(st.advance, st), st);
    if (st.wait) await p.waitForTimeout(st.wait);
    if (st.click) await p.click(st.click).catch(() => logs.push('clickfail ' + st.click));
    if (st.key) await p.keyboard.press(st.key);
    if (st.metrics) { const m = await p.evaluate(() => window.pokewatch.metrics()); fs.appendFileSync(`${out}/metrics.jsonl`, JSON.stringify({ scene: sc.name, ...m }) + '\n'); }
    if (st.eval) logs.push('EVAL ' + String(JSON.stringify(await p.evaluate(st.eval))).slice(0, 1500));
    if (st.shot) await p.screenshot({ path: `${out}/${sc.name}-${st.shot}.png` });
    if (st.strip) {
      // n frames, each after advancing dt seconds: <name>-<strip>-NN.png at internal resolution
      for (let k = 0; k < st.n; k++) {
        const data = await p.evaluate((st) => { window.pokewatch.advance(st.dt, st); return document.getElementById('game').toDataURL('image/png'); }, st);
        fs.writeFileSync(`${out}/${sc.name}-${st.strip}-${String(k).padStart(2, '0')}.png`, Buffer.from(data.split(',')[1], 'base64'));
      }
    }
    if (st.raw) {
      const data = await p.evaluate(() => { window.pokewatch.advance(0); return document.getElementById('game').toDataURL('image/png'); });
      fs.writeFileSync(`${out}/${sc.name}-${st.raw}.png`, Buffer.from(data.split(',')[1], 'base64'));
    }
  }
  if (logs.length) console.log(`[${sc.name}]\n  ` + logs.slice(0, 20).join('\n  '));
  await p.close();
}
await b.close();
