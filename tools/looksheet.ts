// The lowpoly look sheet (docs/looksheet, ROADMAP F111): the frames of every variant on every tuning map, and the
// three pass marks per variant (scripts/toplint.ts; tools/three-signal.mjs; tools/s2perf.mjs on the WebGL 2 backend,
// WebGPU for information). Writes <out>/<map>-<variant>.png, <out>/results.json and prints the table.
// npx tsx tools/looksheet.ts <build dir>/index.html <out dir> [--frames-only]
// Headed Chromium on the real GPU. It never loads a hold-out map (scripts/lib/looksheet.ts LOOK_MAPS).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { LOOK_MAPS, LOOK_VARIANTS } from '../scripts/lib/looksheet';

const [file, out] = process.argv.slice(2);
const framesOnly = process.argv.includes('--frames-only');
fs.mkdirSync(out, { recursive: true });

// 1. frames: one pose per map (capture mode, the spawn, 1 s of ticks), the 3D canvas alone
const b = await chromium.launch({ headless: false, args: ['--allow-file-access-from-files', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
for (const m of LOOK_MAPS) for (const v of LOOK_VARIANTS) {
  const p = await b.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  await p.goto(`file://${path.resolve(file)}?capture=1&render=three&${m.query}${v.query ? '&' + v.query : ''}`);
  await p.waitForFunction(() => (window as any).pokewatch?.ready && !(window as any).pokewatch.loading, null, { timeout: 90000 });
  await p.evaluate(() => { (window as any).pokewatch.advance(1, { frames: 60 }); for (const el of document.querySelectorAll<HTMLElement>('body *')) el.style.visibility = el.id === 'scene3d' ? 'visible' : 'hidden'; });
  await p.waitForTimeout(100);
  await p.screenshot({ path: path.join(out, `${m.id}-${v.id}.png`) });
  const r = await p.evaluate(() => (window as any).pokewatchThree.report());
  console.log(`frame ${m.id}-${v.id}: ${r.backend}, passes ${r.passes.join('+') || 'none'}`);
  await p.close();
}
await b.close();
if (framesOnly) process.exit(0);

// 2. marks
const lint = JSON.parse(execFileSync('npx', ['tsx', 'scripts/toplint.ts', '--json'], { encoding: 'utf8' }));
const results = [];
for (const v of LOOK_VARIANTS) {
  let signal = true, signalOut = '';
  try { signalOut = execFileSync('node', ['tools/three-signal.mjs', file, ...(v.query ? ['--query', v.query] : [])], { encoding: 'utf8', timeout: 600000 }); } catch (e: any) { signal = false; signalOut = String(e.stdout ?? e); }
  const perf: Record<string, unknown> = {};
  for (const m of LOOK_MAPS) for (const be of ['webgl', 'webgpu']) {
    const q = `backend=${be}&res=1920x1080&${m.query.replace(/(^|&)(go|mode|species)=[^&]*/g, '').replace(/^&/, '')}${v.query ? '&' + v.query : ''}`;
    const r = JSON.parse(execFileSync('node', ['tools/s2perf.mjs', file, q, '8', '3'], { encoding: 'utf8', timeout: 180000 }).trim());
    perf[`${m.id}/${be}`] = r.gpuMs;
  }
  const L = lint.find((x: any) => x.id === v.id);
  const webglP95 = Math.max(...LOOK_MAPS.map((m) => (perf[`${m.id}/webgl`] as any).p95));
  const row = { id: v.id, query: v.query, topSide: { pass: L.pass, min: +L.worst.gap.toFixed(1), at: `${L.worst.map} ${L.worst.role}`, meanMin: +Math.min(...L.per.flatMap((p: any) => p.gaps.map((g: any) => g.meanGap))).toFixed(1) }, signal: { pass: signal, out: signalOut.trim().split('\n') }, perf, budget: { pass: webglP95 <= 4.0, webglP95 } };
  results.push(row);
  console.log(`${v.id}: top/side ${row.topSide.pass ? 'pass' : 'FAIL'} (${row.topSide.min}), signal ${signal ? 'pass' : 'FAIL'}, budget ${row.budget.pass ? 'pass' : 'FAIL'} (${webglP95} ms)`);
}
fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 1));
