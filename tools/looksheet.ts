// The lowpoly look sheet (docs/looksheet, ROADMAP F111): the frames of every variant on every tuning map, and the
// three pass marks per variant (scripts/toplint.ts; tools/three-signal.mjs; tools/s2perf.mjs on the WebGL 2 backend,
// WebGPU for information). Writes <out>/<map>-<variant>.png, <out>/results.json and prints the table.
// npx tsx tools/looksheet.ts <build dir>/index.html <out dir> [--frames-only]
// Headed Chromium on the real GPU. It never loads a hold-out map (scripts/lib/looksheet.ts LOOK_MAPS).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { HOLD_OUT_MAPS, HOLD_OUT_SWEEP, KEY_SWEEP, LOOK_MAPS as TUNING_MAPS, LOOK_VARIANTS as GRID } from '../scripts/lib/looksheet';

const [file, out] = process.argv.slice(2);
const framesOnly = process.argv.includes('--frames-only');
// --holdouts: the shipped profile (no variant parameters) on the hold-out maps, after the owner's pick
// --holdout-sweep: the cave and night sweep on the hold-out maps (HOLD_OUT_SWEEP: frames, mark 1, GPU; no signal run)
// --key-sweep: Chargestone's key sweep (scripts/toplint.ts --key-sweep's steps) and the night as applied on the dusk
//   lagoon: frames, mark 1, each frame's mean L* (the scene's lightness), GPU p95 on both backends; no signal run
const keySweep = process.argv.includes('--key-sweep');
const sweep = keySweep || process.argv.includes('--holdout-sweep');
const holdouts = sweep || process.argv.includes('--holdouts');
const LOOK_MAPS = holdouts ? HOLD_OUT_MAPS : TUNING_MAPS;
const LOOK_VARIANTS = holdouts ? [{ id: 'pick', query: '' }] : GRID;
const keyRows = keySweep ? JSON.parse(execFileSync('npx', ['tsx', 'scripts/toplint.ts', '--key-sweep', '--json'], { encoding: 'utf8' })) : [];
const variantsOf = (m: { id: string }): { id: string; query: string }[] => (keySweep ? (m.id === KEY_SWEEP.map ? keyRows : [{ id: 'applied', query: '' }]) : sweep ? HOLD_OUT_SWEEP[m.id] : LOOK_VARIANTS);
const lightness: Record<string, number> = {};
fs.mkdirSync(out, { recursive: true });

// 1. frames: one pose per map (capture mode, the spawn, 1 s of ticks), the 3D canvas alone
const b = await chromium.launch({ headless: false, args: ['--allow-file-access-from-files', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const browser = b.version();
console.log(`browser: Chromium ${browser} (Playwright), headed, real GPU`);
for (const m of LOOK_MAPS) for (const pose of m.poses) for (const v of variantsOf(m)) {
  const p = await b.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  await p.goto(`file://${path.resolve(file)}?capture=1&render=three&${m.query}${v.query ? '&' + v.query : ''}`);
  await p.waitForFunction(() => (window as any).pokewatch?.ready && !(window as any).pokewatch.loading, null, { timeout: 90000 });
  // the pose: stand there, cut the camera to it, face its yaw and pitch the view down (render/renderer.ts look)
  if (pose.at) await p.evaluate((o) => { const pw = (window as any).pokewatch, c = pw.ctx, P = c.player, r = pw.renderer; P.x = P.px = o.at[0]; P.z = P.pz = o.at[1]; P.y = P.py = c.world.height(P.x, P.z); r.snapCamera(c); r.look(o.yaw - r.rig.yaw, o.pitch); }, pose);
  await p.evaluate(() => { (window as any).pokewatch.advance(1, { frames: 60 }); for (const el of document.querySelectorAll<HTMLElement>('body *')) el.style.visibility = el.id === 'scene3d' ? 'visible' : 'hidden'; });
  await p.waitForTimeout(100);
  const shot = await p.screenshot({ path: path.join(out, `${m.id}-${pose.id}-${v.id}.png`) });
  // the frame's mean CIE L* over every pixel (sRGB decoded, D65 luminance)
  // (a string, not a function: tsx's __name helper does not exist in the page)
  lightness[`${m.id}-${pose.id}-${v.id}`] = await p.evaluate(`(async () => {
    const img = await createImageBitmap(await (await fetch('data:image/png;base64,${shot.toString('base64')}')).blob());
    const c = new OffscreenCanvas(img.width, img.height), g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, img.width, img.height).data;
    const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) {
      const Y = 0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2]);
      sum += Y > 216 / 24389 ? 116 * Math.cbrt(Y) - 16 : (24389 / 27) * Y;
    }
    return +(sum / (d.length / 4)).toFixed(1);
  })()`) as number;
  const r = await p.evaluate(() => (window as any).pokewatchThree.report());
  console.log(`frame ${m.id}-${pose.id}-${v.id}: ${r.backend}, passes ${r.passes.join('+') || 'none'}`);
  await p.close();
}
await b.close();
if (framesOnly) process.exit(0);

if (sweep) {
  // per map and variant: mark 1 from the lint, GPU p50 / p95 on both backends (1920 × 1080, S2's scene on the map)
  const lint = keySweep
    ? { [KEY_SWEEP.map]: keyRows, dusklagoon: JSON.parse(execFileSync('npx', ['tsx', 'scripts/toplint.ts', '--holdouts', '--json'], { encoding: 'utf8' }))[0].per.filter((p: any) => p.map === 'dusklagoon').map((p: any) => ({ id: 'applied', query: '', roles: Object.fromEntries(p.gaps.map((g: any) => [g.role, +g.gap.toFixed(1)])), shadow: Object.fromEntries(p.gaps.map((g: any) => [g.role, +g.shadowTop.toFixed(1)])), min: +Math.min(...p.gaps.map((g: any) => g.gap)).toFixed(1), shadowMin: +Math.min(...p.gaps.map((g: any) => g.shadowTop)).toFixed(1), pass: Math.min(...p.gaps.map((g: any) => g.gap)) >= 12 })) }
    : JSON.parse(execFileSync('npx', ['tsx', 'scripts/toplint.ts', '--holdout-sweep', '--json'], { encoding: 'utf8' }));
  const res: Record<string, unknown[]> = {};
  for (const m of LOOK_MAPS) {
    res[m.id] = [];
    for (const v of variantsOf(m)) {
      const perf: Record<string, unknown> = {};
      for (const be of ['webgl', 'webgpu']) {
        const q = `backend=${be}&res=1920x1080&${m.query.replace(/(^|&)(go|mode|species)=[^&]*/g, '').replace(/^&/, '')}${v.query ? '&' + v.query : ''}`;
        perf[be] = JSON.parse(execFileSync('node', ['tools/s2perf.mjs', file, q, '8', '3'], { encoding: 'utf8', timeout: 180000 }).trim()).gpuMs;
      }
      const L = lint[m.id].find((x: any) => x.id === v.id);
      const lstar = Object.fromEntries(m.poses.map((pose) => [pose.id, lightness[`${m.id}-${pose.id}-${v.id}`]]));
      res[m.id].push({ ...L, perf, lstar });
      console.log(`${m.id} ${v.id}: mark 1 ${L.min} (${L.pass ? 'pass' : 'fail'}), shadowed top ${L.shadowMin}, frame L* ${m.poses.map((pose) => `${pose.id} ${lstar[pose.id]}`).join(' / ')}, GPU p95 WebGL 2 ${(perf.webgl as any).p95} / WebGPU ${(perf.webgpu as any).p95} ms`);
    }
  }
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ browser, machine: 'Apple M3 Max', results: res }, null, 1));
  process.exit(0);
}

// 2. marks
const lint = JSON.parse(execFileSync('npx', ['tsx', 'scripts/toplint.ts', '--json', ...(holdouts ? ['--holdouts'] : [])], { encoding: 'utf8' }));
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
