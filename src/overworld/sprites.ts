// Original pixel art for the tile stage: trees, bushes, rocks and the other map props (the Maplebrook people and
// furniture went with the overworld at C1). One of the tile stage's painters, deleted with it at X1b.
import { Sprite, hex, h2, type Ramp } from './paint';

// =================================================================== props
// Handheld-adventure foliage: light lumps lean yellow-green, shadow masses lean teal,
// outlines are dark teal rather than brown-black.
export interface TreeRamps { hl: string; light: string; base: string; shade: string; deep: string; outline: string; trunk: Ramp }
export const JOHTO: TreeRamps = { hl: '#c4f080', light: '#8ed458', base: '#5cb444', shade: '#2e8a46', deep: '#1c6248', outline: '#173a2e', trunk: ['#a87c50', '#7a5838', '#523a26'] };
export const JOHTO_DARK: TreeRamps = { hl: '#a8e070', light: '#74bc4c', base: '#48a040', shade: '#287a44', deep: '#185444', outline: '#13322a', trunk: ['#9a7048', '#6e5034', '#4a3424'] };
const TRUNK: Ramp = ['#a07850', '#7a5838', '#5a4028'];

/**
 * Johto route tree: a broad rounded crown of lumpy clusters (2 tiles wide, ~2.6 tall), lit from
 * the upper left, a teal shadow mass under the crown, a short trunk with a root flare.
 * variant 0-2 permutes the lumps; the border rows mix variants and mirror them.
 */
export function paintJohtoTree(variant = 0, R: TreeRamps = JOHTO): ImageData {
  const s = new Sprite(32, 42);
  s.outline = R.outline;
  const tr = s.ramp(R.trunk);
  s.rect(13, 31, 6, 9, tr);
  s.rect(11, 38, 10, 2, tr);
  s.px(12, 37, tr); s.px(19, 37, tr);
  const LIGHT: Ramp = [R.hl, R.light, R.base, R.shade];
  const MID: Ramp = [R.light, R.base, R.shade, R.deep];
  const DARK: Ramp = [R.base, R.shade, R.deep, R.deep];
  const v = variant % 3;
  const jit = (n: number) => (h2(n, v, 41) - 0.5) * 1.6;
  // back (shadow) lumps first, then the middle, then the lit top lumps
  const lumps: [number, number, number, Ramp][] = [
    [7 + jit(1), 25, 6.5, DARK], [25 + jit(2), 25, 6.5, DARK], [16, 28, 8.5, DARK],
    [6 + jit(3), 18, 6.5, MID], [26 + jit(4), 18, 6.5, MID], [16, 21, 9.5, MID],
    [11 + jit(5), 11, 7.2, LIGHT], [21 + jit(6), 11, 7.2, LIGHT], [16, 6 + (v === 1 ? 1 : 0), 6.2, LIGHT],
  ];
  if (v === 2) lumps.push([16, 15, 6, LIGHT]);
  for (const [x, y, r, ramp] of lumps) s.ellipse(x, y, r, r * 0.9, s.ramp(ramp));
  // leaf clusters: small highlight flecks on the lit lumps, dark flecks in the shadow mass
  for (let n = 0; n < 34; n++) {
    const x = 3 + h2(n, 1, v) * 26, y = 2 + h2(n, 2, v) * 30;
    if (!s.get(Math.round(x), Math.round(y))) continue;
    if (y < 15 && x < 22) { s.dot(x, y, R.hl); s.dot(x + 1, y, R.hl); }
    else if (y > 22) { s.dot(x, y, R.deep); }
    else if (n % 3 === 0) s.dot(x, y, R.light);
  }
  return s.render();
}

/** round broadleaf town tree (blossom variant for decoration) */
export function paintRoundTree(variant = 0): ImageData {
  if (variant === 2) {
    return paintJohtoTree(2, { hl: '#ffe8f0', light: '#ffc0d8', base: '#f098bc', shade: '#c8709c', deep: '#985878', outline: '#5a2a40', trunk: TRUNK });
  }
  return paintJohtoTree(variant === 1 ? 2 : 1, variant === 1 ? { ...JOHTO, hl: '#e0f088', light: '#b8d860', base: '#8cbc48' } : JOHTO);
}

/** low shrub: three lumps in the tree palette */
export function paintBush(variant = 0, R: TreeRamps = JOHTO): ImageData {
  const s = new Sprite(18, 16);
  s.outline = R.outline;
  const MID: Ramp = [R.light, R.base, R.shade, R.deep];
  const LIGHT: Ramp = [R.hl, R.light, R.base, R.shade];
  s.ellipse(5.5, 10, 5.2, 4.6, s.ramp(MID));
  s.ellipse(12.5, 10, 5.2, 4.6, s.ramp(MID));
  s.ellipse(9, 6.5, 5.4, 4.6, s.ramp(LIGHT));
  s.dot(7, 4, R.hl); s.dot(8, 4, R.hl); s.dot(4, 8, R.hl);
  if (variant === 1) for (const [x, y] of [[6, 7], [11, 9], [9, 12], [13, 5]]) { s.dot(x, y, '#e83850'); s.dot(x, y - 1, '#ff98a8'); }
  if (variant === 2) for (const [x, y] of [[6, 7], [12, 8], [8, 11]]) { s.dot(x, y, '#4870e8'); s.dot(x, y - 1, '#a8c0ff'); }
  return s.render();
}

/** small four-petal flower clump, 2 frames of sway */
export function paintFlowers(color: string, frame: number, stem: Ramp = ['#7cc850', '#4ea83e', '#2f8a34'], outline = '#245a2c'): ImageData {
  const s = new Sprite(16, 12);
  s.outline = outline;
  const st = s.ramp(stem);
  const pet = s.ramp([lighten(color), color, darken(color)]);
  const sw = frame ? 1 : 0;
  for (const [x, y] of [[4, 4], [11, 3], [8, 7]]) {
    s.line(x, y + 2, x - sw, 11, st);
    const cx = x - sw;
    s.px(cx, y - 1, pet); s.px(cx - 1, y, pet); s.px(cx + 1, y, pet); s.px(cx, y + 1, pet);
    s.dot(cx, y, '#fff6a0');
  }
  return s.render();
}

/**
 * Tall grass, one tile wide: a dark base with a crown of four pointed blade clumps, so a patch
 * reads as a solid block with a scalloped top. frame 0 calm, 1-2 rustle (lean left/right).
 */
export function paintTallGrass(frame: number): ImageData {
  const s = new Sprite(16, 14);
  s.outline = '#1a4a26';
  const lean = frame === 1 ? -1 : frame === 2 ? 1 : 0;
  const A = s.ramp(['#8cd458', '#4ea83e', '#2f8a34', '#1f6a2c']);
  const B = s.ramp(['#7cc850', '#44a03a', '#2a8032', '#1c6229']);
  s.rect(0, 10, 16, 4, B);
  const crowns: [number, number][] = [[2, 3], [6, 1], [10, 2], [14, 0]];
  crowns.forEach(([cx, top], i) => {
    const r = i % 2 ? A : B;
    const t = top + (frame && i % 2 ? 1 : 0);
    for (let y = t; y < 12; y++) {
      const w = Math.min(2, Math.floor((y - t) / 2.5));
      const off = Math.round(lean * (1 - (y - t) / (12 - t)) * 1.5);
      for (let x = -w; x <= w; x++) s.px(cx + x + off, y, r);
    }
    s.dot(cx + Math.round(lean * 1.5), t, '#b8ec80');
  });
  return s.render({ outline: true });
}

export function paintRock(): ImageData {
  const s = new Sprite(18, 15);
  s.outline = '#3a3830';
  const r = s.ramp(['#e4e0d4', '#bcb6a8', '#8e887c', '#605c54']);
  s.ellipse(9, 9, 8, 5.6, r);
  const r2 = s.ramp(['#f0ece2', '#cac4b6', '#9c968a']);
  s.ellipse(7, 6.5, 4.5, 3.4, r2);
  s.dot(5, 5, '#ffffff');
  return s.render();
}

export function paintSign(): ImageData {
  const s = new Sprite(16, 18);
  s.outline = '#3a2818';
  const w = s.ramp(['#e8c088', '#c89858', '#a07038', '#7a5028']);
  const p = s.ramp(['#b08050', '#8a6038', '#6a4828']);
  s.rect(7, 10, 2, 8, p);
  s.rect(1, 2, 14, 9, w);
  for (let x = 3; x < 13; x += 2) s.dot(x, 6, '#8a6038');
  s.dline(3, 4, 12, 4, '#8a6038');
  s.dline(3, 8, 10, 8, '#8a6038');
  return s.render();
}

export function paintLamp(): ImageData {
  const s = new Sprite(12, 38);
  s.outline = '#262830';
  const m = s.ramp(['#8890a8', '#606880', '#484c60']);
  s.rect(5, 8, 2, 28, m);
  s.rect(3, 34, 6, 3, m);
  s.rect(2, 2, 8, 2, m);
  const g = s.ramp(['#fffbe0', '#fff0a8', '#e8d070']);
  s.rect(3, 4, 6, 5, g);
  s.rect(4, 0, 4, 2, m);
  return s.render();
}

export function paintStoneLantern(): ImageData {
  const s = new Sprite(14, 26);
  s.outline = '#383838';
  const st = s.ramp(['#e0e0d8', '#b8b8b0', '#909088', '#707068']);
  s.rect(3, 22, 8, 3, st);
  s.rect(5, 14, 4, 8, s.ramp(['#e0e0d8', '#b8b8b0', '#909088']));
  s.rect(3, 9, 8, 5, s.ramp(['#e0e0d8', '#b8b8b0', '#909088']));
  s.dot(6, 11, '#ffe890'); s.dot(7, 11, '#ffe890'); s.dot(6, 12, '#ffd060'); s.dot(7, 12, '#ffd060');
  const roof = s.ramp(['#d0d0c8', '#a8a8a0', '#808078']);
  s.rect(1, 6, 12, 3, roof);
  s.rect(3, 4, 8, 2, roof);
  s.rect(6, 1, 2, 3, roof);
  return s.render();
}

export function paintLog(): ImageData {
  const s = new Sprite(30, 14);
  s.outline = '#3a2818';
  const b = s.ramp(['#b08860', '#8a6840', '#6a4c30', '#503820']);
  s.rect(4, 3, 22, 9, b);
  const e = s.ramp(['#f0d8a8', '#d8b888', '#b89868']);
  s.ellipse(4, 7.5, 3, 4.5, e);
  s.dot(4, 7, '#a07848'); s.dot(3, 8, '#a07848');
  for (let x = 8; x < 24; x += 5) s.dot(x, 6, '#5a4028');
  return s.render();
}

export function paintBench(): ImageData {
  const s = new Sprite(30, 16);
  s.outline = '#3a2818';
  const w = s.ramp(['#e0b070', '#c08848', '#986830']);
  const m = s.ramp(['#707888', '#505868', '#383c48']);
  s.rect(3, 9, 2, 6, m); s.rect(25, 9, 2, 6, m);
  s.rect(1, 7, 28, 3, w);
  s.rect(1, 2, 28, 3, w);
  s.rect(3, 4, 2, 4, m); s.rect(25, 4, 2, 4, m);
  return s.render();
}

export function paintFence(): ImageData {
  const s = new Sprite(16, 16);
  s.outline = '#4a3a28';
  const w = s.ramp(['#fff8e8', '#e8e0c8', '#c0b8a0']);
  s.rect(1, 3, 3, 12, w); s.rect(12, 3, 3, 12, w);
  s.rect(0, 5, 16, 2, w); s.rect(0, 10, 16, 2, w);
  return s.render();
}

export function paintHedge(): ImageData {
  const s = new Sprite(16, 18);
  s.outline = '#24401e';
  const L: Ramp = ['#88c860', '#5aa040', '#468a34', '#386e2c'];
  s.rect(0, 5, 16, 12, s.ramp(L));
  for (let x = 2; x < 16; x += 4) s.ellipse(x, 5, 3, 2.5, s.ramp(L));
  return s.render();
}

export function paintBerryTree(): ImageData {
  const s = new Sprite(22, 26);
  s.outline = '#2e3a20';
  const tr = s.ramp(TRUNK);
  s.rect(10, 17, 3, 8, tr);
  const L: Ramp = [JOHTO.light, JOHTO.base, JOHTO.shade, JOHTO.deep];
  s.outline = JOHTO.outline;
  for (const [x, y, r] of [[7, 12, 6], [15, 12, 6], [11, 7, 6]] as [number, number, number][]) s.ellipse(x, y, r, r * 0.9, s.ramp(L));
  for (const [x, y] of [[6, 10], [14, 9], [10, 14], [16, 14], [11, 5]]) { s.dot(x, y, '#e83850'); s.dot(x + 1, y, '#e83850'); s.dot(x, y + 1, '#a01830'); s.dot(x + 1, y - 1, '#ffb0b0'); }
  return s.render();
}

export function paintWell(): ImageData {
  const s = new Sprite(26, 30);
  s.outline = '#2e2a28';
  const st = s.ramp(['#e0dcd0', '#b8b4a8', '#908c80', '#706c60']);
  s.rect(3, 18, 20, 10, st);
  s.ellipse(13, 18, 10, 3.5, s.ramp(['#606870', '#404850', '#303840']));
  const w = s.ramp(['#c89060', '#a07040', '#7a5028']);
  s.rect(3, 4, 2, 15, w); s.rect(21, 4, 2, 15, w);
  const r = s.ramp(['#a87860', '#885848', '#683830']);
  s.rect(1, 2, 24, 3, r); s.rect(4, 0, 18, 2, r);
  s.rect(12, 6, 2, 8, s.ramp(['#d8c8a0', '#b8a880', '#988860']));
  return s.render();
}

function lighten(c: string, k = 0.35) { const [r, g, b] = hex(c); return rgbHex(r + (255 - r) * k, g + (255 - g) * k, b + (255 - b) * k); }
function darken(c: string, k = 0.28) { const [r, g, b] = hex(c); return rgbHex(r * (1 - k), g * (1 - k), b * (1 - k)); }
function rgbHex(r: number, g: number, b: number) { return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join(''); }

