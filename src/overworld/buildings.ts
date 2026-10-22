// 3D buildings with painted pixel textures (16 texels per unit): front/side walls, gable or
// hip roofs with overhang, chimneys, awnings, signboards. Walls and roofs are real geometry
// so buildings show volume, height and perspective, while every surface stays pixel art.
import { Pix, hex, h2, type RGB } from './paint';
import { drawText, textWidth } from './font';
import { darken, lighten } from './sprites';

export type WallStyle = 'wood' | 'plaster' | 'japanese' | 'brick' | 'lab' | 'shop' | 'log';

export interface BuildingDef {
  id: string;
  x: number; y: number; w: number; d: number; // tile footprint (y = north edge)
  wallH: number; // units
  style: WallStyle;
  roof: 'gable' | 'hip';
  roofColor: string;
  door: number; // door column offset from x
  doorStyle?: 'wood' | 'glass' | 'sliding';
  chimney?: number;
  awning?: string;
  sign?: string;
  warp?: string; // interior map id
  floors?: number;
  rise?: number; // roof height
}

export interface BuildingMesh { data: Float32Array; canvas: HTMLCanvasElement; def: BuildingDef }

const OV = 0.3; // roof overhang (units)

function paintWindow(p: Pix, x: number, y: number, w: number, h: number, frame: RGB, curtain?: RGB, shoji = false) {
  p.fill(x - 1, y - 1, w + 2, h + 2, darken3(frame));
  p.fill(x, y, w, h, frame);
  for (let j = 1; j < h - 1; j++)
    for (let i = 1; i < w - 1; i++) {
      let c: RGB;
      if (shoji) c = (i % 3 === 0 || j % 4 === 0) ? hex('#b89a70') : hex('#fff8e8');
      else {
        c = j < h / 2 ? hex('#a8d8ff') : hex('#78b0e8');
        if (i - j === 1 || i - j === 2) c = hex('#e8f6ff');
        if (curtain && (i < 3 || i > w - 4)) c = curtain;
      }
      p.set(x + i, y + j, c);
    }
  if (!shoji) { p.fill(x + Math.floor(w / 2), y + 1, 1, h - 2, frame); }
  p.fill(x - 1, y + h + 1, w + 2, 1, lighten3(frame)); // sill
}
const darken3 = (c: RGB): RGB => [c[0] * 0.6, c[1] * 0.6, c[2] * 0.6];
const lighten3 = (c: RGB): RGB => [c[0] + (255 - c[0]) * 0.5, c[1] + (255 - c[1]) * 0.5, c[2] + (255 - c[2]) * 0.5];

function paintWall(p: Pix, ox: number, oy: number, w: number, h: number, style: WallStyle, seed: number) {
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let c: RGB;
      const n = h2(x, y, seed);
      switch (style) {
        case 'wood': case 'log': {
          const ly = y % (style === 'log' ? 6 : 5);
          c = style === 'log' ? (ly === 0 ? hex('#7a5030') : ly === 1 ? hex('#d8a068') : ly === 5 ? hex('#8a5c34') : hex('#b88048'))
            : (ly === 0 ? hex('#8a5c34') : ly === 1 ? hex('#e0b47c') : hex('#c89660'));
          if (n < 0.03) c = hex('#a87848');
          break;
        }
        case 'plaster': c = n < 0.04 ? hex('#e8dcc4') : hex('#f6eedc'); break;
        case 'japanese': {
          c = y > h * 0.55 ? ((x % 4 === 0) ? hex('#6a4428') : hex('#9a6a40')) : (n < 0.04 ? hex('#e8e0cc') : hex('#f4ecd8'));
          if (Math.abs(y - Math.floor(h * 0.55)) < 2) c = hex('#5a3820');
          if (x % 32 < 3) c = hex('#5a3820');
          break;
        }
        case 'brick': {
          const row = Math.floor(y / 4), bx = (x + (row % 2) * 4) % 8;
          c = (y % 4 === 3 || bx === 0) ? hex('#d8c8b8') : h2(Math.floor((x + (row % 2) * 4) / 8), row, seed) < 0.3 ? hex('#b05040') : hex('#c86450');
          break;
        }
        case 'lab': c = (y % 16 === 0) ? hex('#c8d0d8') : hex('#f4f6f8'); if (Math.abs(y - h * 0.35) < 2) c = hex('#48a8b8'); break;
        case 'shop': c = n < 0.04 ? hex('#f0e4cc') : hex('#fbf2de'); break;
      }
      p.set(ox + x, oy + y, c);
    }
  // foundation band
  for (let x = 0; x < w; x++) for (let y = h - 4; y < h; y++) p.set(ox + x, oy + y, y === h - 4 ? hex('#8a8a92') : (x + y) % 6 === 0 ? hex('#9a9aa2') : hex('#b4b4bc'));
  // eave shadow at top
  for (let x = 0; x < w; x++) { p.set(ox + x, oy, hex('#4a3a3a')); p.set(ox + x, oy + 1, darken3(p.get(ox + x, oy + 2))); }
}

function paintRoof(p: Pix, ox: number, oy: number, w: number, h: number, color: string, japanese: boolean) {
  const base = hex(color), dk = hex(darken(color, 0.25)), dd = hex(darken(color, 0.45)), lt = hex(lighten(color, 0.3));
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      // texture v=0 at the ridge (top), v=h at the eave (bottom)
      const row = Math.floor(y / 4), ly = y % 4;
      let c: RGB;
      if (japanese) {
        const lx = x % 4;
        c = lx === 0 ? dd : lx === 3 ? dk : base;
        if (ly === 3) c = dd;
        if (ly === 0 && lx > 0) c = lt;
      } else {
        const lx = (x + (row % 2) * 3) % 6;
        c = ly === 3 ? dd : ly === 2 ? dk : base;
        if (lx === 0) c = dk;
        if (ly === 0 && lx > 1 && lx < 5) c = lt;
      }
      if (y < 3) c = y === 2 ? dd : lt; // ridge cap
      if (y >= h - 2) c = dd; // eave edge
      p.set(ox + x, oy + y, c);
    }
}

/** Build geometry (pos3 uv2 shade1) and a texture canvas for one building. */
export function buildBuilding(b: BuildingDef, baseY: number): BuildingMesh {
  const fw = b.w * 16, sw = b.d * 16, wh = Math.round(b.wallH * 16);
  const rise = b.rise ?? Math.min(2.2, b.d * 0.42 + 0.4);
  const half = b.d / 2 + OV;
  const slopeLen = Math.hypot(half, rise);
  const rw = Math.round((b.w + 2 * OV) * 16), rh = Math.round(slopeLen * 16);
  const W = Math.max(fw, sw, rw, 64), H = wh * 2 + rh + 32;
  const p = new Pix(W, H);
  const seed = b.x * 31 + b.y;
  // regions
  const FR = { x: 0, y: 0 }, SD = { x: 0, y: wh }, RF = { x: 0, y: wh * 2 }, CH = { x: 0, y: wh * 2 + rh };
  paintWall(p, FR.x, FR.y, fw, wh, b.style, seed);
  paintWall(p, SD.x, SD.y, sw, wh, b.style, seed + 1);
  paintRoof(p, RF.x, RF.y, rw, rh, b.roofColor, b.style === 'japanese');
  paintWall(p, CH.x, CH.y, 32, 32, 'brick', seed + 2);

  // windows / door on the front face
  const frame = b.style === 'japanese' ? hex('#5a3820') : b.style === 'lab' ? hex('#8090a0') : hex('#ffffff');
  const curtain = b.style === 'wood' ? hex('#ffb8c8') : b.style === 'plaster' ? hex('#b8e0a8') : undefined;
  const floors = b.floors ?? (b.wallH >= 2.6 ? 2 : 1);
  const doorPx = b.door * 16 + 2;
  const doorW = 12, doorH = Math.min(22, wh - 6);
  const rowsY = floors === 2 ? [Math.round(wh * 0.18), Math.round(wh * 0.58)] : [Math.round(wh * 0.3)];
  for (let r = 0; r < rowsY.length; r++)
    for (let tx = 0; tx < b.w; tx++) {
      if (r === rowsY.length - 1 && (tx === b.door)) continue;
      if (b.style === 'shop' && r === rowsY.length - 1) continue;
      if ((tx + (b.w % 2 ? 0 : 1)) % 2 === 1 && b.w > 3 && b.style !== 'lab') continue;
      const ww = b.style === 'lab' ? 14 : 11;
      paintWindow(p, tx * 16 + (16 - ww) / 2, rowsY[r], ww, b.style === 'lab' ? 9 : 9, frame, curtain, b.style === 'japanese');
    }
  if (b.style === 'shop') {
    // display window
    const sx = b.door === 0 ? 20 : 4, swd = Math.max(20, b.door * 16 - 10);
    paintWindow(p, sx, wh - doorH - 2, swd, doorH - 6, hex('#ffffff'));
  }
  // door
  const dy = wh - 4 - doorH;
  const ds = b.doorStyle ?? (b.style === 'lab' || b.style === 'shop' ? 'glass' : b.style === 'japanese' ? 'sliding' : 'wood');
  p.fill(doorPx - 1, dy - 1, doorW + 2, doorH + 1, hex('#3a2a20'));
  for (let y = 0; y < doorH; y++)
    for (let x = 0; x < doorW; x++) {
      let c: RGB;
      if (ds === 'glass') c = x === 5 || x === 6 ? hex('#8090a0') : (y < doorH * 0.5 ? hex('#98d0f8') : hex('#70a8e0'));
      else if (ds === 'sliding') c = (x % 4 === 0 || y % 5 === 0) ? hex('#6a4428') : hex('#fff4e0');
      else c = (x === 0 || x === doorW - 1 || y === 0) ? hex('#8a4a2a') : (y % 6 === 5 ? hex('#a05a34') : hex('#c06c40'));
      p.set(doorPx + x, dy + y, c);
    }
  if (ds === 'wood') { p.set(doorPx + doorW - 3, dy + doorH / 2, hex('#ffe070')); p.set(doorPx + doorW - 3, dy + doorH / 2 + 1, hex('#c8a030')); }
  // step
  p.fill(doorPx - 2, wh - 3, doorW + 4, 3, hex('#d8d8e0'));

  const canvas = p.canvas();
  // signboard above the door
  if (b.sign) {
    const g = canvas.getContext('2d')!;
    const tw = textWidth(b.sign) + 8;
    const sx = Math.round(Math.max(2, Math.min(fw - tw - 2, doorPx + doorW / 2 - tw / 2)));
    const sy = Math.max(3, dy - 14);
    g.fillStyle = '#3a2a20'; g.fillRect(sx - 1, sy - 1, tw + 2, 12);
    g.fillStyle = b.style === 'lab' ? '#2a7890' : '#2a6a48'; g.fillRect(sx, sy, tw, 10);
    drawText(g, b.sign, sx + 4, sy + 1, '#ffffff');
  }

  // ---------------- geometry
  const out: number[] = [];
  const U = (px: number) => px / W, V = (py: number) => py / H;
  const quad = (a: number[], bb: number[], c: number[], d: number[], ua: number[], ub: number[], uc: number[], ud: number[], shade: number) => {
    out.push(...a, ...ua, shade, ...bb, ...ub, shade, ...c, ...uc, shade, ...a, ...ua, shade, ...c, ...uc, shade, ...d, ...ud, shade);
  };
  const tri = (a: number[], bb: number[], c: number[], ua: number[], ub: number[], uc: number[], shade: number) => out.push(...a, ...ua, shade, ...bb, ...ub, shade, ...c, ...uc, shade);
  const x0 = b.x, x1 = b.x + b.w, z0 = b.y, z1 = b.y + b.d;
  const y0 = baseY, y1 = baseY + b.wallH;
  // front (south) wall
  quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [U(0), V(wh)], [U(fw), V(wh)], [U(fw), V(0)], [U(0), V(0)], 1);
  // east / west walls
  quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [U(0), V(SD.y + wh)], [U(sw), V(SD.y + wh)], [U(sw), V(SD.y)], [U(0), V(SD.y)], 0.78);
  quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [U(0), V(SD.y + wh)], [U(sw), V(SD.y + wh)], [U(sw), V(SD.y)], [U(0), V(SD.y)], 0.68);
  // back wall (rarely visible, keeps silhouettes closed)
  quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [U(0), V(SD.y + wh)], [U(fw), V(SD.y + wh)], [U(fw), V(SD.y)], [U(0), V(SD.y)], 0.6);
  // roof
  const zm = (z0 + z1) / 2;
  const eaveDrop = OV * (rise / half);
  const ey = y1 - eaveDrop, ry = y1 + rise * (1 - OV / half) + eaveDrop * 0; // ridge height
  const rx0 = x0 - OV, rx1 = x1 + OV, rz0 = z0 - OV, rz1 = z1 + OV;
  const ru0 = U(RF.x), ru1 = U(RF.x + rw), rvTop = V(RF.y), rvBot = V(RF.y + rh);
  if (b.roof === 'gable') {
    quad([rx0, ey, rz1], [rx1, ey, rz1], [rx1, ry, zm], [rx0, ry, zm], [ru0, rvBot], [ru1, rvBot], [ru1, rvTop], [ru0, rvTop], 1);
    quad([rx1, ey, rz0], [rx0, ey, rz0], [rx0, ry, zm], [rx1, ry, zm], [ru0, rvBot], [ru1, rvBot], [ru1, rvTop], [ru0, rvTop], 0.7);
    // gable ends (wall texture)
    const gu = (z: number) => U(((z - z0) / b.d) * sw);
    tri([x1, y1, z1], [x1, y1, z0], [x1, ry, zm], [gu(z1), V(SD.y + 6)], [gu(z0), V(SD.y + 6)], [gu(zm), V(SD.y + 2)], 0.78);
    tri([x0, y1, z0], [x0, y1, z1], [x0, ry, zm], [gu(z0), V(SD.y + 6)], [gu(z1), V(SD.y + 6)], [gu(zm), V(SD.y + 2)], 0.68);
    // eave undersides (thin dark fascia)
    quad([rx0, ey - 0.08, rz1], [rx1, ey - 0.08, rz1], [rx1, ey, rz1], [rx0, ey, rz1], [U(1), V(1)], [U(2), V(1)], [U(2), V(0)], [U(1), V(0)], 0.5);
  } else {
    const inset = Math.min(half, (b.w + 2 * OV) / 2 - 0.01);
    const ra = rx0 + inset, rb = rx1 - inset;
    quad([rx0, ey, rz1], [rx1, ey, rz1], [rb, ry, zm], [ra, ry, zm], [ru0, rvBot], [ru1, rvBot], [U(RF.x + rw - inset * 16), rvTop], [U(RF.x + inset * 16), rvTop], 1);
    quad([rx1, ey, rz0], [rx0, ey, rz0], [ra, ry, zm], [rb, ry, zm], [ru0, rvBot], [ru1, rvBot], [U(RF.x + inset * 16), rvTop], [U(RF.x + rw - inset * 16), rvTop], 0.7);
    tri([rx1, ey, rz1], [rx1, ey, rz0], [rb, ry, zm], [ru0, rvBot], [ru1, rvBot], [U(RF.x + rw / 2), rvTop], 0.85);
    tri([rx0, ey, rz0], [rx0, ey, rz1], [ra, ry, zm], [ru0, rvBot], [ru1, rvBot], [U(RF.x + rw / 2), rvTop], 0.75);
    quad([rx0, ey - 0.08, rz1], [rx1, ey - 0.08, rz1], [rx1, ey, rz1], [rx0, ey, rz1], [U(1), V(1)], [U(2), V(1)], [U(2), V(0)], [U(1), V(0)], 0.5);
  }
  // chimney
  if (b.chimney != null) {
    const cx0 = x0 + b.chimney + 0.25, cx1 = cx0 + 0.55, cz0 = zm - 0.2 - 0.4, cz1 = cz0 + 0.5;
    const cyTop = ry + 0.5, cyBot = ey;
    const cu0 = U(CH.x), cu1 = U(CH.x + 9), cv0 = V(CH.y), cv1 = V(CH.y + 30);
    quad([cx0, cyBot, cz1], [cx1, cyBot, cz1], [cx1, cyTop, cz1], [cx0, cyTop, cz1], [cu0, cv1], [cu1, cv1], [cu1, cv0], [cu0, cv0], 0.95);
    quad([cx1, cyBot, cz1], [cx1, cyBot, cz0], [cx1, cyTop, cz0], [cx1, cyTop, cz1], [cu0, cv1], [cu1, cv1], [cu1, cv0], [cu0, cv0], 0.75);
    quad([cx0, cyBot, cz0], [cx0, cyBot, cz1], [cx0, cyTop, cz1], [cx0, cyTop, cz0], [cu0, cv1], [cu1, cv1], [cu1, cv0], [cu0, cv0], 0.65);
    quad([cx0, cyTop, cz1], [cx1, cyTop, cz1], [cx1, cyTop, cz0], [cx0, cyTop, cz0], [U(CH.x + 1), V(CH.y + 1)], [U(CH.x + 2), V(CH.y + 1)], [U(CH.x + 2), V(CH.y + 2)], [U(CH.x + 1), V(CH.y + 2)], 0.35);
  }
  // awning (striped, sloping out over the door)
  if (b.awning) {
    const ay = y0 + Math.min(b.wallH - 0.3, 1.75);
    const ax0 = x0 + 0.15, ax1 = x1 - 0.15;
    // paint stripes into a spare strip at the chimney region's right
    const g = canvas.getContext('2d')!;
    for (let i = 0; i < 32; i++) { g.fillStyle = Math.floor(i / 4) % 2 ? '#ffffff' : b.awning; g.fillRect(40 + i, CH.y, 1, 16); }
    g.fillStyle = darken(b.awning, 0.3); g.fillRect(40, CH.y + 14, 32, 2);
    const au0 = U(40), au1 = U(40 + Math.min(32, b.w * 4)), av0 = V(CH.y), av1 = V(CH.y + 16);
    quad([ax0, ay - 0.45, z1 + 0.75], [ax1, ay - 0.45, z1 + 0.75], [ax1, ay, z1], [ax0, ay, z1], [au0, av1], [au1, av1], [au1, av0], [au0, av0], 1);
    quad([ax0, ay - 0.6, z1 + 0.75], [ax1, ay - 0.6, z1 + 0.75], [ax1, ay - 0.45, z1 + 0.75], [ax0, ay - 0.45, z1 + 0.75], [au0, av1], [au1, av1], [au1, V(CH.y + 12)], [au0, V(CH.y + 12)], 0.8);
  }
  return { data: new Float32Array(out), canvas, def: b };
}

/** Simple textured box (furniture, counters, bridge rails): returns pos3 uv2 shade1 into `out` using a solid-colour pixel texture region. */
export function boxGeo(out: number[], x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, uvTop: number[], uvSide: number[]) {
  const q = (a: number[], b: number[], c: number[], d: number[], uv: number[], s: number) => {
    const [u0, v0, u1, v1] = uv;
    out.push(...a, u0, v1, s, ...b, u1, v1, s, ...c, u1, v0, s, ...a, u0, v1, s, ...c, u1, v0, s, ...d, u0, v0, s);
  };
  q([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], uvTop, 1);
  q([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], uvSide, 0.85);
  q([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], uvSide, 0.7);
  q([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], uvSide, 0.62);
}
