// Diagnostic contact sheet for habitat maps:
//   npx tsx scripts/habsheet.ts <recipe> [count] [firstSeed] [out.png] [scale] [--raw]
// Each cell is a top-down view of the final collision: height as brightness, walls dark, water blue, lava orange,
// decks (causeways, arches) brown, hazard tiles purple, team A's approaches cyan (direct) / blue (flank), team B's
// yellow (direct) / orange (flank), the contest disc white, staging A white and B red, any perch that watches both of
// a side's approaches magenta. --raw draws a single attempt without retries (what a raw seed looks like).
import { writePng } from './lib/rgbpng';
import { attemptHabitat, generateHabitat, HABITATS, profilesFor } from '../src/world/habitat';
import { CONTROL_POINT } from '../src/world/habitat/mode';
import type { HabCtx } from '../src/world/habitat/ctx';
import type { Perch } from '../src/world/habitat/validate';
import { T, type ArenaMap } from '../src/world/tiles';

type C = [number, number, number];

export function renderHab(m: ArenaMap, sc: number, g?: HabCtx, perches: Perch[] = []): { w: number; h: number; px: Uint8Array } {
  const W = m.w * sc, H = m.h * sc, px = new Uint8Array(W * H * 3), S = m.w;
  const set = (x: number, y: number, c: C) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const o = (y * W + x) * 3; px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; };
  const hab = m.gen?.hab;
  const lava = hab?.medium === 'lava' || g?.recipe.medium === 'lava';
  const hz = new Set(hab?.hazard ?? (g ? [...g.hazard.keys()].filter((k) => g.hazard[k]) : []));
  const route = new Map<number, C>();
  const cols: Record<string, C> = { 'A.direct': [60, 230, 230], 'A.flank': [70, 110, 255], 'B.direct': [250, 230, 60], 'B.flank': [255, 140, 30] };
  if (g) for (const A of g.approaches) for (const k of A.tiles) route.set(k, cols[A.id]);
  else if (m.gen?.route) for (let k = 0; k < S * S; k++) if (m.gen.route[k]) route.set(k, m.gen.route[k] === 1 ? [60, 230, 230] : [70, 110, 255]);
  for (let j = 0; j < m.h; j++) for (let i = 0; i < m.w; i++) {
    const k = j * S + i, e = m.elev[k];
    const b = Math.max(0, Math.min(1, e / 9));
    let c: C = [70 + 150 * b, 90 + 140 * b, 60 + 120 * b];
    if (m.terrain[k] === T.water) c = lava ? [240, 110, 30] : [50, 110, 210];
    if (m.terrain[k] === T.wood) c = [170, 120, 60];
    if (m.wall[k]) c = [c[0] * 0.35, c[1] * 0.35, c[2] * 0.35];
    if (m.platform[k] > 0) c = [c[0] * 0.7, c[1] * 0.7, c[2] * 0.7];
    if (m.over && m.over[k] > 0) c = [150, 100, 50];
    if (hz.has(k)) c = [170, 60, 200];
    const rc = route.get(k);
    if (rc) c = [(c[0] + rc[0] * 2) / 3, (c[1] + rc[1] * 2) / 3, (c[2] + rc[2] * 2) / 3];
    for (let y = 0; y < sc; y++) for (let x = 0; x < sc; x++) set(i * sc + x, j * sc + y, c);
    // cliff outlines
    if (i < S - 1 && Math.abs(m.elev[k + 1] - e) > 0.65 && !m.wall[k] && !m.wall[k + 1]) for (let y = 0; y < sc; y++) set(i * sc + sc - 1, j * sc + y, [20, 20, 20]);
    if (j < m.h - 1 && Math.abs(m.elev[k + S] - e) > 0.65 && !m.wall[k] && !m.wall[k + S]) for (let x = 0; x < sc; x++) set(i * sc + x, j * sc + sc - 1, [20, 20, 20]);
  }
  const mark = (x: number, y: number, c: C, r = 2) => { for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (Math.abs(dx) + Math.abs(dy) <= r) set(Math.round(x * sc) + dx, Math.round(y * sc) + dy, c); };
  const ct = hab?.contest ?? g?.contest;
  if (ct) for (let a = 0; a < 64; a++) set(Math.round((ct.x + Math.cos(a / 10.2) * ct.r) * sc), Math.round((ct.y + Math.sin(a / 10.2) * ct.r) * sc), [255, 255, 255]);
  const st = hab?.stage ?? (g ? { A: g.nodes.stageA, B: g.nodes.stageB } : null);
  if (st) { mark(st.A[0], st.A[1], [255, 255, 255], 4); mark(st.B[0], st.B[1], [230, 40, 40], 4); }
  for (const p of perches) mark((p.tile % S) + 0.5, ((p.tile / S) | 0) + 0.5, [255, 0, 255], 1);
  return { w: W, h: H, px };
}

if (process.argv[1]?.endsWith('habsheet.ts')) {
  const id = process.argv[2] ?? 'river-gorge', count = Number(process.argv[3] ?? 4), first = Number(process.argv[4] ?? 1);
  const out = process.argv[5] ?? `${id}.png`, scale = Number(process.argv[6] ?? 3), raw = process.argv.includes('--raw');
  if (!HABITATS[id]) throw new Error('unknown recipe ' + id + '; known: ' + Object.keys(HABITATS).join(', '));
  const cols = Math.min(count, 4), rows = Math.ceil(count / cols), cell = 128 * scale + 6;
  const sheet = new Uint8Array(cols * cell * rows * cell * 3).fill(24);
  for (let n = 0; n < count; n++) {
    let r;
    if (raw) {
      const a = attemptHabitat(HABITATS[id], CONTROL_POINT, first + n, 128, '', profilesFor());
      r = renderHab(a.g.m, scale, a.g, a.report.perches);
      console.log(`seed ${first + n} (raw): ${a.ok ? 'ok' : 'FAIL ' + a.failed.join(',')}`);
    } else {
      const m = generateHabitat({ recipe: id, seed: first + n });
      r = renderHab(m, scale);
      console.log(`seed ${first + n}: attempts ${m.gen!.hab!.attempts}${m.gen!.hab!.fallback ? ' fallback' : ''}`);
    }
    const ox = (n % cols) * cell + 3, oy = Math.floor(n / cols) * cell + 3;
    for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) { const s = (y * r.w + x) * 3, d = ((oy + y) * cols * cell + ox + x) * 3; sheet[d] = r.px[s]; sheet[d + 1] = r.px[s + 1]; sheet[d + 2] = r.px[s + 2]; }
  }
  writePng(out, cols * cell, rows * cell, sheet);
  console.log('wrote', out);
}
