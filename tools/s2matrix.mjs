// The render measurement matrix (ported from spike/s2-three for I2a; S2 decision 6: re-run it on every three upgrade).
// One tools/s2perf.mjs run per line of output (JSONL). Every run is vsync-capped headed Chromium on the real GPU, the
// range with S2's 240-actor crowd frozen on its ring and the camera orbiting at 20°/s, unless the group says otherwise.
// node tools/s2matrix.mjs <build dir>/index.html <out.jsonl> [group,...]
// Groups: main gorge shadow passes bloom backdrop cards strokes live lamps. Defaults to all of them. Both WebGPURenderer
// backends run each line (backend=webgpu, backend=webgl: the WebGL 2 fallback, Q20(c)'s baseline).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const [file, out, groups = 'main,gorge,shadow,passes,bloom,backdrop,cards,strokes,live,lamps'] = process.argv.slice(2);
const want = new Set(groups.split(','));
const BE = ['webgpu', 'webgl'];
const runs = [];
const add = (group, q, secs = 8, warm = 3) => { for (const b of BE) runs.push({ group, q: `backend=${b}&${q}`, secs, warm }); };
const HD = 'res=1920x1080';
if (want.has('main')) for (let rep = 0; rep < 2; rep++) for (const res of ['res=1280x720', HD]) add('main', res);
if (want.has('gorge')) add('gorge', `${HD}&map=river-gorge&mapseed=1`);
if (want.has('shadow')) for (const s of ['shadow=0', 'shadow=1']) add('shadow', `${HD}&${s}`);
// the optional passes at a working weight (their look values are the owner's; the cost does not depend on them)
if (want.has('passes')) for (const p of ['ink=0.8', 'ink=0.8&edge=0.2', 'bloom=0.5', 'ink=0.8&bloom=0.5']) add('passes', `${HD}&${p}`);
// bloom's quality: the resolution of its mip chain's first target (Q23.5, Q20(c))
if (want.has('bloom')) for (const r of ['0.25', '0.5', '1']) add('bloom', `${HD}&bloom=0.5&bloomres=${r}`);
if (want.has('backdrop')) for (const n of [500, 2000, 8000]) add('backdrop', `${HD}&bench3=backdrop:${n}`);
if (want.has('cards')) for (const n of [250, 1000, 4000]) add('cards', `${HD}&bench3=cards:${n}`);
if (want.has('strokes')) for (const n of [5000, 20000, 80000]) add('strokes', `${HD}&bench3=strokes:${n}`);
if (want.has('live')) add('live', `${HD}&live=1`);
// the lamp channel costs nothing per frame (it is baked): the lamp-heavy maps with and without it
if (want.has('lamps')) for (const l of ['', '&lamps=0']) add('lamps', `${HD}&map=chargestone-cave&mapseed=1${l}`);
fs.writeFileSync(out, '');
for (const [i, r] of runs.entries()) {
  let line;
  try {
    line = execFileSync('node', ['tools/s2perf.mjs', file, r.q, String(r.secs), String(r.warm)], { encoding: 'utf8', timeout: 180000 }).trim();
  } catch (e) { line = JSON.stringify({ error: String(e).slice(0, 300) }); }
  fs.appendFileSync(out, JSON.stringify({ group: r.group, ...JSON.parse(line) }) + '\n');
  console.log(`${i + 1}/${runs.length} ${r.group} ${r.q}`);
}
