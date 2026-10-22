// PNG contact sheet of generated regions (W1 tool): `npx tsx scripts/worldsheet.ts [count] [firstSeed] [out.png] [scale]`.
// Each cell is a top-down tile map: ground by terrain, height as shading, trees and props, water, routes, places.
// Also prints one line per seed with the archetype, attempts and any failed gate.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { generateRegion } from '../src/world/gen';
import { T, PROP_RULES, type ArenaMap } from '../src/world/tiles';

const count = Number(process.argv[2] ?? 12), first = Number(process.argv[3] ?? 1);
const out = process.argv[4] ?? 'worldsheet.png', scale = Number(process.argv[5] ?? 3);
const species = ['rattata', 'ledyba', 'sandshrew', 'oddish', 'poliwag', 'mareep', 'heracross', 'geodude'];

const COL: Record<number, [number, number, number]> = {
  [T.grass]: [140, 196, 104], [T.path]: [222, 200, 150], [T.stone]: [176, 172, 160], [T.water]: [70, 130, 210], [T.tall]: [86, 160, 70],
  [T.wood]: [168, 112, 64], [T.sand]: [232, 214, 160], [T.floor]: [200, 200, 200], [T.tatami]: [200, 200, 160], [T.void]: [0, 0, 0], [T.dirt]: [190, 160, 112], [T.flowerbed]: [200, 120, 140],
};

export function renderMap(m: ArenaMap, sc: number): { w: number; h: number; px: Uint8Array } {
  const W = m.w * sc, H = m.h * sc, px = new Uint8Array(W * H * 3);
  const set = (x: number, y: number, c: [number, number, number]) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const o = (y * W + x) * 3; px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; };
  for (let j = 0; j < m.h; j++) for (let i = 0; i < m.w; i++) {
    const k = j * m.w + i;
    let c = COL[m.terrain[k]] ?? [255, 0, 255];
    const e = m.elev[k];
    const f = m.terrain[k] === T.water ? 1 : 0.86 + e * 0.12;
    c = [c[0] * f, c[1] * f, c[2] * f].map((v) => Math.min(255, v)) as [number, number, number];
    // a shadow line on the south face of a step down (cliffs dark, ledges light)
    const s = j + 1 < m.h ? e - m.elev[k + m.w] : 0;
    for (let dy = 0; dy < sc; dy++) for (let dx = 0; dx < sc; dx++) {
      let cc = c;
      if (dy === sc - 1 && s > 0.25 && m.terrain[k + m.w] !== T.water) cc = s >= 0.75 ? [70, 60, 50] : [c[0] * 0.75, c[1] * 0.75, c[2] * 0.75] as [number, number, number];
      if (m.stairs[k]) cc = dy % 2 ? [150, 146, 140] : [196, 192, 184];
      set(i * sc + dx, j * sc + dy, cc);
    }
  }
  const PC: Record<string, [number, number, number]> = { tree: [34, 96, 52], tree2: [28, 84, 48], round: [52, 120, 60], elder: [20, 70, 40], bush: [60, 140, 70], bushR: [60, 140, 70], rock: [150, 146, 136], boulder: [120, 116, 110], stump: [130, 96, 60], log: [130, 96, 60], cabin: [176, 64, 52], hedge: [40, 110, 50], fence: [200, 170, 120], well: [120, 120, 140], shrine: [196, 80, 70], pillar: [210, 206, 196], pillarBroken: [190, 186, 176], lantern: [210, 200, 160], sign: [240, 230, 120], berry: [80, 60, 140], lamp: [240, 220, 120], bench: [150, 110, 70] };
  for (const p of m.props) {
    const R = PROP_RULES[p.kind];
    const c = PC[p.kind];
    if (!c && !(R.wall || R.platform)) {
      if (p.kind.startsWith('flower')) set(p.x * sc + 1, p.y * sc + 1, [250, 120, 160]);
      else if (p.kind === 'reeds') set(p.x * sc + 1, p.y * sc + 1, [100, 120, 50]);
      continue;
    }
    const cc = c ?? [80, 80, 80];
    for (let j = p.y * sc; j < (p.y + p.h) * sc; j++) for (let i = p.x * sc; i < (p.x + p.w) * sc; i++) {
      const edge = j === p.y * sc || i === p.x * sc;
      set(i, j, edge ? [cc[0] * 0.7, cc[1] * 0.7, cc[2] * 0.7] as [number, number, number] : cc);
    }
  }
  const mark = (x: number, y: number, c: [number, number, number], r = 2) => { for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (Math.abs(dx) + Math.abs(dy) <= r) set(x * sc + 1 + dx, y * sc + 1 + dy, c); };
  for (const [x, y] of m.chestSpots) mark(x, y, [255, 210, 40], 1);
  mark(m.spawn[0], m.spawn[1], [255, 255, 255], 3);
  mark(m.bossSpot[0], m.bossSpot[1], [230, 40, 40], 3);
  for (const l of m.landmarks) mark(l.x, l.y, [250, 140, 250], 2);
  return { w: W, h: H, px };
}

export function writePng(path: string, w: number, h: number, rgb: Uint8Array) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; Buffer.from(rgb.buffer, rgb.byteOffset + y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1); }
  const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = (b: Buffer) => { let c = -1; for (const v of b) c = crcT[(c ^ v) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (t: string, d: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  writeFileSync(path, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

if (process.argv[1]?.endsWith('worldsheet.ts')) {
  const cols = Math.min(count, 4), rows = Math.ceil(count / cols);
  const cell = 128 * scale + 6;
  const W = cols * cell, H = rows * cell;
  const sheet = new Uint8Array(W * H * 3).fill(30);
  for (let n = 0; n < count; n++) {
    const seed = first + n;
    const t = performance.now();
    const m = generateRegion({ biome: 'meadow', seed, species });
    const ms = performance.now() - t;
    const r = renderMap(m, scale);
    const ox = (n % cols) * cell + 3, oy = Math.floor(n / cols) * cell + 3;
    for (let y = 0; y < r.h; y++) sheet.set(r.px.subarray(y * r.w * 3, (y + 1) * r.w * 3), ((oy + y) * W + ox) * 3);
    const g = m.gen!;
    const failed = g.gates.filter((x) => !x.ok).map((x) => `${x.id}(${x.value})`);
    console.log(`seed ${seed}: ${g.archetype.padEnd(6)} attempts ${g.attempts} repairs ${g.repairs} ${ms.toFixed(0)} ms ${failed.length ? 'FAIL ' + failed.join(' ') : 'ok'}`);
  }
  writePng(out, W, H, sheet);
  console.log('wrote', out);
}
