// Diagnostic contact sheet for location maps: `npx tsx scripts/locsheet.ts <location> [count] [firstSeed] [out.png] [scale]`.
// Each cell is a top-down view: height as a colour ramp per tier (dark = low, bright = high), walls dark, cliffs
// outlined, decks brown, chasms black, the zone graph (white = walkable link, yellow = hop shortcut), spawn (white),
// boss hall (red), anchors (orange), chests (yellow), loose stones (cyan), one-tile pinch points (magenta) and
// tiles the player can reach but enemies cannot (red, should be none).
import { writePng } from './worldsheet';
import { generateLocation } from '../src/world/locgen';
import { enemyCore, playerReach } from '../src/world/locgen/nav';
import { navOpen } from '../src/world/gen/util';
import { LOCATIONS } from '../src/world/locations';
import { PROP_RULES, T, type ArenaMap } from '../src/world/tiles';

type C = [number, number, number];

export function renderLoc(m: ArenaMap, sc: number): { w: number; h: number; px: Uint8Array } {
  const W = m.w * sc, H = m.h * sc, px = new Uint8Array(W * H * 3), L = m.gen!.loc!;
  const set = (x: number, y: number, c: C) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const o = (y * W + x) * 3; px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; };
  const S = m.w, core = enemyCore(m, m.spawn[1] * S + m.spawn[0], L.dropNav), pr = playerReach(m, m.spawn[1] * S + m.spawn[0]);
  const tierCol: C[] = [[96, 132, 92], [150, 176, 110], [214, 206, 140], [240, 236, 200]];
  const gap = 3;
  for (let j = 0; j < m.h; j++) for (let i = 0; i < m.w; i++) {
    const k = j * S + i, e = m.elev[k];
    let c: C;
    if (m.wall[k] && e < -1) c = [10, 10, 14];
    else if (m.wall[k] && !m.props.length) c = [40, 38, 44];
    else if (m.wall[k]) c = [36, 52, 40];
    else {
      const t = Math.max(0, Math.min(3, e / gap));
      const a = tierCol[Math.floor(t)], b = tierCol[Math.min(3, Math.floor(t) + 1)], f = t - Math.floor(t);
      c = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
      if (m.terrain[k] === T.wood) c = [168, 112, 64];
      if (m.terrain[k] === T.tall) c = [c[0] * 0.8, c[1] * 0.95, c[2] * 0.7];
      if (m.platform[k] > 0) c = [120, 116, 108];
      if (navOpen(m, k) && !core[k]) c = [255, 0, 0];
      if (pr[k] && navOpen(m, k) && !core[k]) c = [255, 60, 60];
    }
    for (let dy = 0; dy < sc; dy++) for (let dx = 0; dx < sc; dx++) {
      let cc = c;
      // a dark line where a walkable tile meets a drop of a tier
      const s = j + 1 < m.h ? e - m.elev[k + S] : 0, r = i + 1 < m.w ? e - m.elev[k + 1] : 0;
      if (!m.wall[k] && ((dy === sc - 1 && s > 1.5) || (dx === sc - 1 && r > 1.5))) cc = [30, 26, 22];
      set(i * sc + dx, j * sc + dy, cc);
    }
    if (core[k]) {
      const bEW = !navOpen(m, k - 1) && !navOpen(m, k + 1) && (m.wall[k - 1] || m.wall[k + 1]);
      const bNS = !navOpen(m, k - S) && !navOpen(m, k + S) && (m.wall[k - S] || m.wall[k + S]);
      if (bEW || bNS) set(i * sc + (sc >> 1), j * sc + (sc >> 1), [255, 0, 255]);
    }
  }
  for (const p of m.props) {
    const R = PROP_RULES[p.kind];
    if (!R.wall || ['tree', 'tree2', 'round', 'thicket'].includes(p.kind)) continue;
    for (let j = p.y * sc + 1; j < (p.y + p.h) * sc - 1; j++) for (let i = p.x * sc + 1; i < (p.x + p.w) * sc - 1; i++) set(i, j, p.kind === 'magnetite' || p.kind === 'crystal' ? [90, 200, 255] : p.kind === 'moonstone' ? [230, 230, 255] : [70, 66, 60]);
  }
  const line = (x0: number, y0: number, x1: number, y1: number, c: C) => { const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * sc; for (let s = 0; s <= n; s++) set(Math.round((x0 + ((x1 - x0) * s) / n) * sc), Math.round((y0 + ((y1 - y0) * s) / n) * sc), c); };
  for (const l of L.links) { const a = L.zones[l.a], b = L.zones[l.b]; line(a.x, a.y, b.x, b.y, l.kind === 'bridge' ? [255, 170, 90] : l.kind === 'ramp' ? [140, 220, 255] : [235, 235, 235]); }
  const mark = (x: number, y: number, c: C, r = 2) => { for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (Math.abs(dx) + Math.abs(dy) <= r) set(x * sc + 1 + dx, y * sc + 1 + dy, c); };
  for (const [x, y] of L.anchors) mark(x, y, [255, 140, 0], 2);
  for (const [x, y] of L.bodySpots) mark(x, y, [0, 255, 255], 1);
  for (const [x, y] of m.chestSpots) mark(x, y, [255, 220, 40], 1);
  mark(m.spawn[0], m.spawn[1], [255, 255, 255], 3);
  mark(m.bossSpot[0], m.bossSpot[1], [230, 40, 40], 3);
  return { w: W, h: H, px };
}

if (process.argv[1]?.endsWith('locsheet.ts')) {
  const id = process.argv[2] ?? 'viridian-forest', count = Number(process.argv[3] ?? 4), first = Number(process.argv[4] ?? 1);
  const out = process.argv[5] ?? `${id}.png`, scale = Number(process.argv[6] ?? 3);
  if (!LOCATIONS[id]) throw new Error('unknown location ' + id + '; known: ' + Object.keys(LOCATIONS).join(', '));
  const cols = Math.min(count, 4), rows = Math.ceil(count / cols), cell = 128 * scale + 6;
  const sheet = new Uint8Array(cols * cell * rows * cell * 3).fill(24);
  for (let n = 0; n < count; n++) {
    const m = generateLocation({ location: id, seed: first + n });
    const r = renderLoc(m, scale), ox = (n % cols) * cell + 3, oy = Math.floor(n / cols) * cell + 3;
    for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) { const s = (y * r.w + x) * 3, d = ((oy + y) * cols * cell + ox + x) * 3; sheet[d] = r.px[s]; sheet[d + 1] = r.px[s + 1]; sheet[d + 2] = r.px[s + 2]; }
    const g = m.gen!;
    console.log(`seed ${first + n}: ${g.archetype} attempts ${g.attempts} ${g.ms.toFixed(0)} ms ${g.gates.filter((x) => !x.ok).map((x) => `${x.id}(${x.value})`).join(' ') || 'ok'}`);
  }
  writePng(out, cols * cell, rows * cell, sheet);
  console.log('wrote', out);
}
