// S2 spike: the measurement matrix of docs/spikes/S2-renderer.md, one tools/s2perf.mjs run per line of output (JSONL).
// node tools/s2matrix.mjs <builds dir> <out.jsonl> [group,...]
// <builds dir> holds the S2_THREE builds: all/, webgl/, webgpu/ (scripts/build.mjs --out). Groups: main gorge shadow props
// edges live boot cshadow stress. Every run is vsync-capped headed Chromium on the real GPU.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const [dir, out, groups = 'main,gorge,shadow,props,edges,live,boot'] = process.argv.slice(2);
const want = new Set(groups.split(','));
const BE = ['webgl', 'webgpu', 'webgpu-gl'];
const runs = [];
const add = (group, build, q, secs = 8, warm = 3) => runs.push({ group, build, q, secs, warm });
const base = 'map=range&freeze=1&orbit=20';
if (want.has('main')) for (let rep = 0; rep < 2; rep++) for (const res of ['1280x720', '1920x1080']) for (const b of BE) add('main', 'all', `backend=${b}&${base}&res=${res}`);
if (want.has('gorge')) for (const b of BE) add('gorge', 'all', `backend=${b}&map=river-gorge&freeze=1&orbit=20&res=1920x1080`);
if (want.has('shadow')) for (const s of ['shadow=0', 'shadowSize=1024', 'shadowSize=4096']) for (const b of BE) add('shadow', 'all', `backend=${b}&${base}&res=1920x1080&${s}`);
if (want.has('props')) for (const p of ['instanced', 'batched']) for (const b of BE) add('props', 'all', `backend=${b}&${base}&res=1920x1080&props=${p}`);
if (want.has('edges')) for (const b of BE) add('edges', 'all', `backend=${b}&${base}&res=1920x1080&edges=1`);
if (want.has('live')) for (const b of BE) add('live', 'all', `backend=${b}&map=range&res=1920x1080`);
if (want.has('cshadow')) for (const b of BE) add('cshadow', 'all', `backend=${b}&${base}&res=1920x1080&cshadow=1`);
// a heavier scene, to see how the configurations scale past what this GPU shrugs off
if (want.has('stress')) for (let rep = 0; rep < 2; rep++) for (const b of BE) add('stress', 'all', `backend=${b}&${base}&res=1920x1080&actors=1500&props=instanced&propN=5000&cshadow=1&shadowSize=4096`);
// WebGPURenderer's output path: the default RGBA16F intermediate + output blit, an RGBA8 one, none (linear output)
if (want.has('output')) for (const o of ['', '&obuf=8', '&olinear=1']) for (const b of ['webgpu', 'webgpu-gl']) for (const sc of ['map=range&res=1920x1080', `${base}&res=1920x1080&actors=1500&props=instanced&propN=5000&cshadow=1&shadowSize=4096`]) add('output', 'all', `backend=${b}&${sc}${o}`);
if (want.has('boot')) for (let rep = 0; rep < 5; rep++) for (const b of BE) add('boot', b === 'webgl' ? 'webgl' : 'webgpu', `backend=${b}&map=range&res=1280x720&freeze=1`, 1, 0);
fs.writeFileSync(out, '');
for (const [i, r] of runs.entries()) {
  let line;
  try {
    line = execFileSync('node', ['tools/s2perf.mjs', path.resolve(dir, r.build, 'index.html'), r.q, String(r.secs), String(r.warm)], { encoding: 'utf8', timeout: 180000 }).trim();
  } catch (e) { line = JSON.stringify({ error: String(e).slice(0, 300) }); }
  fs.appendFileSync(out, JSON.stringify({ group: r.group, build: r.build, ...JSON.parse(line) }) + '\n');
  console.log(`${i + 1}/${runs.length} ${r.group} ${r.build} ${r.q}`);
}
