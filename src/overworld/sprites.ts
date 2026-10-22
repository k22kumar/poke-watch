// Original overworld pixel art: people (4 directions x 4-frame walk), trees, props.
// Proportions follow the DS overworld scale: 16 px tiles, people ~16x27 px.
import { Sprite, Pix, hex, h2, type Ramp } from './paint';

export const CELL_W = 24, CELL_H = 32;

export interface Person {
  skin: Ramp; hair: Ramp; hairStyle: 'short' | 'spiky' | 'long' | 'bun' | 'twin' | 'bald' | 'bob';
  hat?: { ramp: Ramp; kind: 'cap' | 'beanie' | 'straw' | 'band' };
  shirt: Ramp; pants: Ramp; shoes: Ramp; skirt?: boolean; bag?: Ramp; kid?: boolean; old?: boolean; apron?: Ramp;
}

export const SKIN: Record<string, Ramp> = {
  light: ['#ffe8d0', '#f8d0a8', '#d8a078', '#b07858'],
  tan: ['#f0c898', '#d8a070', '#b07850', '#8a5838'],
  deep: ['#c89068', '#a06840', '#7a4a28', '#5a3418'],
};

/** dir: 0 down, 1 up, 2 left, 3 right(mirrored) ; frame 0..3 (stand, step A, stand, step B) */
export function paintPerson(p: Person, dir: number, frame: number): ImageData {
  const flip = dir === 3;
  const d = dir === 3 ? 2 : dir;
  const s = new Sprite(CELL_W, CELL_H);
  const SK = s.ramp(p.skin), HR = s.ramp(p.hair), SH = s.ramp(p.shirt), PA = s.ramp(p.pants), SO = s.ramp(p.shoes);
  const HT = p.hat ? s.ramp(p.hat.ramp) : 0;
  const BG = p.bag ? s.ramp(p.bag) : 0;
  const AP = p.apron ? s.ramp(p.apron) : 0;
  const step = frame === 1 ? 1 : frame === 3 ? -1 : 0; // +1: left foot forward
  const bob = frame % 2 === 1 ? -1 : 0;
  const k = p.kid ? 4 : p.old ? 1 : 0; // shorter characters
  const oy = k + bob;
  const eye = '#202030';

  // --- long hair behind body
  if (p.hairStyle === 'long') {
    if (d === 0) s.rect(6, 12 + oy, 13, 8, HR);
    if (d === 2) s.rect(11, 11 + oy, 7, 9, HR);
  }
  if (p.hairStyle === 'twin' && d !== 1) {
    s.ellipse(d === 2 ? 17 : 4.5, 15 + oy, 2.5, 4, HR);
    if (d === 0) s.ellipse(19.5, 15 + oy, 2.5, 4, HR);
  }

  // --- legs & shoes (feet stay on the ground: y 28-29)
  const legTop = 22 + oy;
  if (d === 0 || d === 1) {
    const lLift = step === 1 ? 1 : 0, rLift = step === -1 ? 1 : 0;
    if (!p.skirt) {
      s.rect(9, legTop, 3, 28 - legTop - lLift, PA);
      s.rect(13, legTop, 3, 28 - legTop - rLift, PA);
    } else {
      s.rect(10, legTop + 3, 2, 25 - legTop - lLift, SK);
      s.rect(13, legTop + 3, 2, 25 - legTop - rLift, SK);
    }
    s.rect(9, 28 - lLift, 3, 2, SO);
    s.rect(13, 28 - rLift, 3, 2, SO);
  } else {
    if (step === 0) {
      if (!p.skirt) s.rect(10, legTop, 5, 28 - legTop, PA); else s.rect(11, legTop + 3, 3, 25 - legTop, SK);
      s.rect(8, 28, 6, 2, SO);
    } else {
      if (!p.skirt) { s.line(10, legTop, 8, 27, PA); s.line(11, legTop, 9, 27, PA); s.line(13, legTop, 14, 27, PA); s.line(14, legTop, 15, 27, PA); }
      else { s.line(11, legTop + 3, 9, 27, SK); s.line(13, legTop + 3, 14, 27, SK); }
      s.rect(6, 28, 4, 2, SO);
      s.rect(13, 28, 4, 2, SO);
    }
  }

  // --- torso / skirt
  const tTop = 15 + oy;
  if (d === 0 || d === 1) {
    s.rect(8, tTop, 9, legTop - tTop, SH);
    s.rect(7, tTop + 1, 11, 2, SH);
    if (p.skirt) { s.rect(7, legTop - 1, 11, 4, PA); s.rect(6, legTop + 1, 13, 2, PA); }
    else s.rect(8, legTop - 1, 9, 2, PA);
    if (AP && d === 0) s.rect(9, tTop + 2, 7, legTop - tTop + 1, AP);
  } else {
    s.rect(9, tTop, 7, legTop - tTop, SH);
    if (p.skirt) { s.rect(8, legTop - 1, 8, 4, PA); s.rect(7, legTop + 1, 10, 2, PA); }
    else s.rect(9, legTop - 1, 7, 2, PA);
    if (AP) s.rect(8, tTop + 2, 3, legTop - tTop + 1, AP);
  }
  // bag (backpack / satchel)
  if (BG) {
    if (d === 1) s.rect(9, tTop + 1, 7, 6, BG);
    else if (d === 2) s.rect(14, tTop + 1, 4, 6, BG);
    else { s.dline(8, tTop, 15, legTop - 2, '#5a3a28'); }
  }

  // --- arms
  if (d === 0 || d === 1) {
    const la = step, ra = -step;
    s.rect(6, tTop + 1 + la, 2, 5, SH); s.rect(6, tTop + 6 + la, 2, 2, SK);
    s.rect(17, tTop + 1 + ra, 2, 5, SH); s.rect(17, tTop + 6 + ra, 2, 2, SK);
  } else {
    const ax = 11 - step * 2;
    s.rect(ax, tTop + 1, 3, 5, SH);
    s.rect(ax, tTop + 6, 3, 2, SK);
  }

  // --- head
  const hy = 9 + oy;
  if (d === 0) {
    s.ellipse(12.5, hy, 6.6, 6.2, HR);
    s.ellipse(12.5, hy + 1.6, 5.3, 4.6, SK);
    // bangs
    s.rect(7, hy - 2, 11, 2, HR);
    s.px(9, hy, HR); s.px(12, hy, HR); s.px(15, hy, HR);
    if (p.hairStyle === 'spiky') { s.px(6, hy - 5, HR); s.px(19, hy - 5, HR); s.px(8, hy - 7, HR); s.px(16, hy - 7, HR); s.px(12, hy - 7, HR); }
    if (p.hairStyle === 'bob' || p.hairStyle === 'long') { s.rect(6, hy, 2, 5, HR); s.rect(17, hy, 2, 5, HR); }
    if (p.hairStyle === 'bun') s.ellipse(12.5, hy - 6.5, 3, 2.5, HR);
    // eyes
    s.dot(10, hy + 1, eye); s.dot(10, hy + 2, eye); s.dot(15, hy + 1, eye); s.dot(15, hy + 2, eye);
    s.dot(9, hy + 3, '#f0a0a0'); s.dot(16, hy + 3, '#f0a0a0');
    if (p.old) { s.dot(10, hy + 1, '#606070'); s.dot(15, hy + 1, '#606070'); s.dot(12, hy + 4, '#d8d8e0'); s.dot(13, hy + 4, '#d8d8e0'); }
  } else if (d === 1) {
    s.ellipse(12.5, hy, 6.6, 6.2, HR);
    s.px(5, hy + 1, SK); s.px(19, hy + 1, SK);
    if (p.hairStyle === 'bun') s.ellipse(12.5, hy - 6.5, 3, 2.5, HR);
    if (p.hairStyle === 'spiky') { s.px(8, hy - 7, HR); s.px(16, hy - 7, HR); s.px(12, hy - 7, HR); }
    if (p.hairStyle === 'long' || p.hairStyle === 'bob') s.rect(7, hy + 3, 11, p.hairStyle === 'long' ? 9 : 3, HR);
    if (p.hairStyle === 'twin') { s.ellipse(4.5, hy + 5, 2.5, 4, HR); s.ellipse(20.5, hy + 5, 2.5, 4, HR); }
  } else {
    s.ellipse(12, hy, 6.4, 6.2, HR);
    s.ellipse(10, hy + 1.6, 4.6, 4.6, SK);
    s.rect(6, hy - 2, 8, 2, HR);
    s.px(5, hy + 2, SK); // nose
    s.px(14, hy + 2, SK); s.px(14, hy + 1, SK); // ear
    if (p.hairStyle === 'spiky') { s.px(15, hy - 6, HR); s.px(18, hy - 3, HR); s.px(11, hy - 7, HR); }
    if (p.hairStyle === 'bun') s.ellipse(15, hy - 5, 2.5, 2.5, HR);
    if (p.hairStyle === 'bob' || p.hairStyle === 'long') s.rect(14, hy, 4, 5, HR);
    s.dot(8, hy + 1, eye); s.dot(8, hy + 2, eye);
    s.dot(8, hy + 3, '#f0a0a0');
  }

  // --- hats
  if (p.hat) {
    if (p.hat.kind === 'cap') {
      s.ellipse(12.5, hy - 2.5, 6.8, 4, HT);
      if (d === 0) s.rect(6, hy - 1, 13, 2, HT);
      if (d === 1) s.rect(9, hy + 1, 7, 1, HT);
      if (d === 2) s.rect(3, hy - 1, 8, 2, HT);
      if (d !== 1) s.dot(12, hy - 4, '#ffffff');
    } else if (p.hat.kind === 'beanie') {
      s.ellipse(12.5, hy - 2.5, 6.8, 4.2, HT);
      s.rect(6, hy - 1, 13, 2, HT);
      s.ellipse(12.5, hy - 7, 1.6, 1.4, HT);
      if (d === 0) { s.dot(9, hy - 4, '#ffffff'); }
    } else if (p.hat.kind === 'straw') {
      s.ellipse(12.5, hy - 2, 9, 2, HT);
      s.ellipse(12.5, hy - 4, 5, 3, HT);
    } else if (p.hat.kind === 'band') {
      s.rect(6, hy - 3, 13, 2, HT);
    }
  }

  const img = s.render();
  if (!flip) return img;
  const out = new ImageData(img.width, img.height);
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++) {
      const si = (y * img.width + (img.width - 1 - x)) * 4, di = (y * img.width + x) * 4;
      out.data.set(img.data.subarray(si, si + 4), di);
    }
  return out;
}

/** 4 rows (down, up, left, right) x 4 frames sheet */
export function personSheet(p: Person): Pix {
  const sheet = new Pix(CELL_W * 4, CELL_H * 4);
  for (let dir = 0; dir < 4; dir++) for (let f = 0; f < 4; f++) sheet.blit(paintPerson(p, dir, f), f * CELL_W, dir * CELL_H);
  return sheet;
}

// =================================================================== props
// HGSS-referenced foliage (docs/HGSS_REFERENCE.md): light lumps lean yellow-green, shadow masses
// lean teal, outlines are dark teal rather than brown-black.
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

/** compatibility names used by Maplebrook and the arenas */
export function paintTree(variant = 0): ImageData { return paintJohtoTree(variant, variant % 2 ? JOHTO_DARK : JOHTO); }

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

/** small flower clump (HGSS-style four-petal blooms), 2 frames of sway */
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

export function paintMailbox(color: string): ImageData {
  const s = new Sprite(12, 18);
  s.outline = '#302020';
  const b = s.ramp([lighten(color), color, darken(color)]);
  const p = s.ramp(['#a07850', '#7a5838', '#5a4028']);
  s.rect(5, 9, 2, 9, p);
  s.rect(1, 2, 10, 7, b);
  s.ellipse(6, 3, 5, 2.4, b);
  s.dot(9, 5, '#ffe060');
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

export function paintPlanter(color: string): ImageData {
  const s = new Sprite(16, 14);
  s.outline = '#3a2818';
  const pot = s.ramp(['#e8a070', '#c87850', '#a05838']);
  s.rect(2, 7, 12, 6, pot);
  const l = s.ramp(['#a8e070', '#70b850', '#509838']);
  s.ellipse(8, 5, 6, 3.6, l);
  s.dot(5, 4, color); s.dot(9, 3, color); s.dot(11, 5, color); s.dot(7, 6, color);
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

/** shrine gate (original design, 48x52), stands over a 3-tile wide path */
export function paintGate(): ImageData {
  const s = new Sprite(52, 54);
  s.outline = '#3a1818';
  const red: Ramp = ['#ff8060', '#e04030', '#b02820', '#801810'];
  const blk = s.ramp(['#606068', '#383840', '#202028']);
  s.rect(9, 14, 5, 38, s.ramp(red)); s.rect(38, 14, 5, 38, s.ramp(red));
  s.rect(7, 49, 9, 4, blk); s.rect(36, 49, 9, 4, blk);
  s.rect(4, 14, 44, 4, s.ramp(red));
  s.rect(1, 4, 50, 5, blk);
  s.rect(0, 2, 52, 3, blk);
  s.rect(4, 8, 44, 3, s.ramp(red));
  s.rect(22, 9, 8, 6, s.ramp(['#f0e8d0', '#d8d0b8', '#b8b098']));
  return s.render();
}

export function paintEmote(kind: '!' | '?' | '♪'): ImageData {
  const s = new Sprite(12, 14);
  s.outline = '#303040';
  const w = s.ramp(['#ffffff', '#ffffff', '#e0e0f0']);
  s.rect(1, 1, 10, 9, w);
  s.px(4, 10, w); s.px(5, 11, w); s.px(5, 10, w);
  const c = kind === '!' ? '#e03030' : kind === '?' ? '#3060e0' : '#e050a0';
  if (kind === '!') { for (let y = 2; y < 7; y++) { s.dot(5, y, c); s.dot(6, y, c); } s.dot(5, 8, c); s.dot(6, 8, c); }
  else if (kind === '?') { s.dline(4, 3, 7, 3, c); s.dot(8, 4, c); s.dot(7, 5, c); s.dot(6, 6, c); s.dot(6, 8, c); }
  else { s.dline(7, 2, 7, 7, c); s.dline(7, 2, 9, 3, c); s.dot(5, 7, c); s.dot(6, 7, c); s.dot(5, 8, c); s.dot(6, 8, c); }
  return s.render();
}

export function paintSmoke(): ImageData {
  const s = new Sprite(10, 10);
  s.outline = '#a0a0b0';
  s.ellipse(5, 5, 4, 4, s.ramp(['#ffffff', '#f0f0f8', '#d8d8e8']));
  return s.render();
}

export function lighten(c: string, k = 0.35) { const [r, g, b] = hex(c); return rgbHex(r + (255 - r) * k, g + (255 - g) * k, b + (255 - b) * k); }
export function darken(c: string, k = 0.28) { const [r, g, b] = hex(c); return rgbHex(r * (1 - k), g * (1 - k), b * (1 - k)); }
export function rgbHex(r: number, g: number, b: number) { return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join(''); }

// =================================================================== interior furniture (3/4 front view)
const WOOD: Ramp = ['#e8b878', '#c89058', '#a06c3c', '#7a5028'];
export function paintFurniture(kind: string): ImageData {
  let s: Sprite;
  switch (kind) {
    case 'bookcase': case 'shelf': {
      s = new Sprite(16, 30); s.outline = '#3a2818';
      const w = s.ramp(WOOD);
      s.rect(0, 2, 16, 27, w);
      const inner = s.ramp(['#7a5028', '#6a4420', '#503018']);
      for (let r = 0; r < 3; r++) {
        s.rect(2, 4 + r * 8, 12, 6, inner);
        for (let k = 0; k < 5; k++) {
          const c = kind === 'shelf' ? ['#f0c060', '#e87070', '#70b0e8', '#90d070', '#f0f0f0'][(k + r) % 5] : ['#c84848', '#4870c8', '#48a868', '#d8b848', '#9868c8'][(k + r * 2) % 5];
          const hgt = kind === 'shelf' ? 3 + (k % 2) : 5 - (k % 2);
          for (let y = 0; y < hgt; y++) { s.dot(3 + k * 2, 9 + r * 8 - y, c); s.dot(4 + k * 2, 9 + r * 8 - y, c); }
        }
      }
      s.rect(0, 0, 16, 3, s.ramp(['#f0c888', '#d8a068', '#b07c48']));
      break;
    }
    case 'table': case 'desk': case 'lowtable': case 'counter': {
      const W = kind === 'counter' ? 16 : 32, H = kind === 'lowtable' ? 14 : 20;
      s = new Sprite(W, H); s.outline = '#3a2818';
      const top = s.ramp(kind === 'counter' ? ['#f8f0e0', '#e8dcc8', '#c8b8a0'] : kind === 'lowtable' ? ['#c87850', '#a05838', '#7a4028'] : ['#f0c888', '#d8a068', '#b07c48']);
      const leg = s.ramp(WOOD);
      if (kind === 'counter') { s.rect(0, 2, 16, 18, s.ramp(['#a8d8b0', '#78b888', '#589868'])); s.rect(0, 0, 16, 4, top); }
      else {
        s.rect(0, 2, W, H === 14 ? 5 : 6, top);
        s.rect(1, 8, 2, H - 8, leg); s.rect(W - 3, 8, 2, H - 8, leg);
        if (kind === 'desk') { s.rect(W - 12, 8, 10, 8, leg); s.dot(W - 7, 11, '#ffe070'); s.rect(6, -1, 8, 4, s.ramp(['#e0f0ff', '#a8c8e8', '#7898b8'])); }
        if (kind === 'table') { s.dot(8, 3, '#ffffff'); s.dot(9, 3, '#ffffff'); s.dot(20, 3, '#e86060'); s.dot(21, 3, '#e86060'); }
        if (kind === 'lowtable') { s.dot(14, 3, '#90c870'); s.dot(15, 3, '#90c870'); s.dot(14, 2, '#ffffff'); }
      }
      break;
    }
    case 'tv': {
      s = new Sprite(16, 22); s.outline = '#202028';
      s.rect(0, 10, 16, 11, s.ramp(WOOD));
      s.rect(1, 1, 14, 10, s.ramp(['#606878', '#404858', '#282c38']));
      s.rect(3, 3, 10, 6, s.ramp(['#a8e0ff', '#78b8e8', '#5890c8']));
      s.dot(4, 4, '#ffffff');
      break;
    }
    case 'stove': {
      s = new Sprite(16, 22); s.outline = '#282830';
      s.rect(0, 4, 16, 17, s.ramp(['#f8f8f8', '#d8dce0', '#a8b0b8']));
      s.rect(2, 10, 12, 8, s.ramp(['#606870', '#404850', '#283038']));
      s.dot(4, 6, '#e85050'); s.dot(11, 6, '#e85050');
      s.rect(3, 0, 6, 4, s.ramp(['#d0d4d8', '#a0a8b0', '#788088']));
      break;
    }
    case 'plant': {
      s = new Sprite(16, 24); s.outline = '#2a3a20';
      s.rect(4, 16, 8, 7, s.ramp(['#f0a070', '#d07848', '#a85830']));
      const l = s.ramp(['#a8e070', '#70b850', '#509838', '#3a7a30']);
      s.ellipse(8, 9, 6, 7, l); s.ellipse(4, 12, 3.5, 4, s.ramp(['#a8e070', '#70b850', '#509838'])); s.ellipse(12, 12, 3.5, 4, s.ramp(['#a8e070', '#70b850', '#509838']));
      break;
    }
    case 'machine': {
      s = new Sprite(16, 28); s.outline = '#283038';
      s.rect(0, 2, 16, 25, s.ramp(['#f0f4f8', '#c8d0d8', '#98a4b0']));
      s.rect(2, 5, 12, 8, s.ramp(['#70e0c0', '#40b898', '#289878']));
      s.dot(4, 7, '#ffffff');
      for (let k = 0; k < 3; k++) s.dot(4 + k * 4, 17, ['#e85050', '#f0c040', '#50a0e8'][k]);
      s.rect(3, 21, 10, 2, s.ramp(['#98a4b0', '#788490', '#586470']));
      break;
    }
    case 'crate': {
      s = new Sprite(16, 16); s.outline = '#3a2818';
      s.rect(0, 1, 16, 14, s.ramp(WOOD));
      s.dline(1, 2, 14, 13, '#8a5c30'); s.dline(1, 13, 14, 2, '#8a5c30');
      break;
    }
    case 'cushion': {
      s = new Sprite(14, 8); s.outline = '#5a2030';
      s.ellipse(7, 4, 6, 3, s.ramp(['#ff9898', '#e86868', '#c04848']));
      break;
    }
    case 'scroll': {
      s = new Sprite(16, 26); s.outline = '#3a2818';
      s.rect(2, 2, 12, 22, s.ramp(['#fffaf0', '#f4ecd8', '#d8ccb0']));
      s.rect(1, 0, 14, 2, s.ramp(WOOD)); s.rect(1, 24, 14, 2, s.ramp(WOOD));
      for (let y = 6; y < 20; y += 3) s.dline(6, y, 9, y + 1, '#303030');
      s.ellipse(8, 18, 2, 2, s.ramp(['#ff8080', '#e05050', '#b03030']));
      break;
    }
    default: s = new Sprite(8, 8); s.rect(0, 0, 8, 8, s.ramp(['#ff00ff', '#ff00ff', '#ff00ff']));
  }
  return s.render();
}
