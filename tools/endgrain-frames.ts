// Endgrain frames (owner, 2026-11-27; docs/looksheet "Endgrain"): stump and log tops from the gameplay camera on two of
// the maps that have them, Shrine Gorge (day, the look sheet's River Gorge, seed 1) and the dusk lagoon (night, seed 1).
// Per map, the two stumps or logs nearest the spawn that have a clear stand point 3.5 m away on level ground: the
// player stands there facing the prop (turned 0.3 rad so the sprite does not cover it), the camera at its gameplay
// pitch. One build per label, so the same poses can be shot before and after.
// npx tsx tools/endgrain-frames.ts <out dir> <label>=<build>/index.html [<label>=<build>/index.html …]
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const [out, ...builds] = process.argv.slice(2);
const MAPS = [
  { id: 'gorge', query: 'go=1&mode=range&species=charmander&map=river-gorge&mapseed=1' },
  { id: 'dusklagoon', query: 'go=1&mode=range&species=charmander&map=cascade-lagoon/dusk&mapseed=1' },
];
// in the page (a string: tsx's __name helper does not exist there): the poses, then one applied by index
const POSES = `(() => {
  const pw = window.pokewatch, m = pw.ctx.world.map, W = m.w, H = m.h;
  const at = (x, z) => { const i = Math.floor(x + W / 2), j = Math.floor(z + H / 2); return i < 0 || j < 0 || i >= W || j >= H ? -1 : j * W + i; };
  const sp = pw.ctx.player, out = [];
  const props = m.props.filter((p) => p.kind === 'stump' || p.kind === 'log').map((p) => ({ p, x: p.x + p.w / 2 - W / 2, z: p.y + p.h / 2 - H / 2, e: m.elev[p.y * W + p.x] }));
  props.sort((a, b) => Math.hypot(a.x - sp.x, a.z - sp.z) - Math.hypot(b.x - sp.x, b.z - sp.z));
  for (const q of props) {
    for (let k = 0; k < 8 && out.length < 2; k++) {
      const a = (k * Math.PI) / 4, d = 3.5, sx = q.x - Math.sin(a) * d, sz = q.z - Math.cos(a) * d;
      let ok = true;
      // from 4 m behind the stand point (the camera's side) up to the prop: open, dry, level ground
      for (let s = -4; s <= d - 1.2 && ok; s += 0.25) {
        const k2 = at(sx + Math.sin(a) * s, sz + Math.cos(a) * s);
        if (k2 < 0 || m.wall[k2] || m.terrain[k2] === 3 || m.stairs[k2] || m.platform[k2] > 0 || Math.abs(m.elev[k2] - q.e) > 0.3) ok = false;
      }
      if (ok) { out.push({ kind: q.p.kind, prop: [q.x, q.z], at: [sx, sz], yaw: a + 0.3 }); break; }
    }
    if (out.length >= 2) break;
  }
  return out;
})()`;

fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ headless: false, args: ['--allow-file-access-from-files', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const record: unknown[] = [];
for (const m of MAPS) for (const spec of builds) {
  const [label, file] = spec.split('=');
  for (let n = 0; n < 2; n++) {
    const p = await b.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    await p.goto(`file://${path.resolve(file)}?capture=1&render=three&${m.query}`);
    await p.waitForFunction(() => (window as any).pokewatch?.ready && !(window as any).pokewatch.loading, null, { timeout: 90000 });
    const poses = (await p.evaluate(POSES)) as { kind: string; prop: number[]; at: number[]; yaw: number }[];
    const o = poses[n];
    if (!o) { console.log(`${m.id}: no pose ${n}`); await p.close(); continue; }
    await p.evaluate(`(() => { const pw = window.pokewatch, c = pw.ctx, P = c.player, r = pw.renderer, o = ${JSON.stringify(o)}; P.x = P.px = o.at[0]; P.z = P.pz = o.at[1]; P.y = P.py = c.world.height(P.x, P.z); r.snapCamera(c); r.look(o.yaw - r.rig.yaw, 0); })()`);
    await p.evaluate(`(() => { window.pokewatch.advance(1, { frames: 60 }); for (const el of document.querySelectorAll('body *')) el.style.visibility = el.id === 'scene3d' ? 'visible' : 'hidden'; })()`);
    await p.waitForTimeout(100);
    const name = `${m.id}-${n + 1}-${label}.png`;
    await p.screenshot({ path: path.join(out, name) });
    record.push({ map: m.id, pose: n + 1, label, ...o, frame: name });
    console.log(`${name}: ${o.kind} at (${o.prop.map((v) => v.toFixed(1)).join(', ')}), stand (${o.at.map((v) => v.toFixed(1)).join(', ')})`);
    await p.close();
  }
}
await b.close();
fs.writeFileSync(path.join(out, 'poses.json'), JSON.stringify(record, null, 1));
