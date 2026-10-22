// Creature model kit: low-poly primitives with vertex colours, posed per animation frame.
// Designs (designs.ts) are plain data built from these parts; the baker renders them
// from 8 directions x 4 walk frames into a pixel sprite sheet.

import { hexToRgb, mat4 } from './gl';

export type Shape = 'sphere' | 'cone' | 'cyl' | 'box' | 'torus' | 'tcone';
export type Anim = 'legF' | 'legB' | 'arm' | 'tail' | 'ear' | 'wing' | 'head' | 'flame' | 'tent' | 'none';

export interface Part {
  s: Shape;
  p: [number, number, number];
  k: [number, number, number];
  c: string;
  r?: [number, number, number]; // degrees, applied Ry*Rx*Rz
  m?: boolean; // mirror across x
  a?: Anim;
  pv?: [number, number, number]; // anim pivot (defaults to p)
  e?: number; // emissive 0..1
  arc?: number; // torus arc (radians)
  tube?: number; // torus tube radius (relative)
  top?: number; // tcone top radius (relative)
}

export interface Design {
  parts: Part[];
  lod?: number; // geometry detail multiplier (props use < 1)
  float?: boolean; // hover-bob instead of walking bob
  bob?: number;
}

// ---------------------------------------------------------------- primitive geometry (unit size)
type Tri = number[]; // flat list: px,py,pz,nx,ny,nz per vertex

function sphereGeo(seg = 14, rings = 10): Tri {
  const out: number[] = [];
  const pt = (i: number, j: number) => {
    const th = (j / rings) * Math.PI, ph = (i / seg) * Math.PI * 2;
    const x = Math.sin(th) * Math.sin(ph), y = Math.cos(th), z = Math.sin(th) * Math.cos(ph);
    return [x, y, z, x, y, z];
  };
  for (let j = 0; j < rings; j++)
    for (let i = 0; i < seg; i++) {
      const a = pt(i, j), b = pt(i + 1, j), c = pt(i + 1, j + 1), d = pt(i, j + 1);
      out.push(...a, ...d, ...c, ...a, ...c, ...b);
    }
  return out;
}

function coneGeo(seg = 12, top = 0): Tri {
  // base radius 1 at y=0, top radius `top` at y=1
  const out: number[] = [];
  const slope = 1 - top;
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    const n = (a: number) => { const L = Math.hypot(1, slope); return [Math.sin(a) / L, slope / L, Math.cos(a) / L]; };
    const b0 = [Math.sin(a0), 0, Math.cos(a0)], b1 = [Math.sin(a1), 0, Math.cos(a1)];
    const t0 = [Math.sin(a0) * top, 1, Math.cos(a0) * top], t1 = [Math.sin(a1) * top, 1, Math.cos(a1) * top];
    const n0 = n(a0), n1 = n(a1);
    out.push(...b0, ...n0, ...b1, ...n1, ...t1, ...n1, ...b0, ...n0, ...t1, ...n1, ...t0, ...n0);
    // base cap
    out.push(0, 0, 0, 0, -1, 0, ...b1, 0, -1, 0, ...b0, 0, -1, 0);
    if (top > 0) out.push(0, 1, 0, 0, 1, 0, ...t0, 0, 1, 0, ...t1, 0, 1, 0);
  }
  return out;
}

function boxGeo(): Tri {
  const out: number[] = [];
  const f = (n: number[], u: number[], v: number[]) => {
    const c = (su: number, sv: number) => [n[0] + u[0] * su + v[0] * sv, n[1] + u[1] * su + v[1] * sv, n[2] + u[2] * su + v[2] * sv, ...n];
    const a = c(-1, -1), b = c(1, -1), cc = c(1, 1), d = c(-1, 1);
    out.push(...a, ...b, ...cc, ...a, ...cc, ...d);
  };
  f([0, 0, 1], [1, 0, 0], [0, 1, 0]); f([0, 0, -1], [-1, 0, 0], [0, 1, 0]);
  f([1, 0, 0], [0, 0, -1], [0, 1, 0]); f([-1, 0, 0], [0, 0, 1], [0, 1, 0]);
  f([0, 1, 0], [1, 0, 0], [0, 0, -1]); f([0, -1, 0], [1, 0, 0], [0, 0, 1]);
  return out;
}

function torusGeo(arc = Math.PI * 2, tube = 0.3, seg = 16, tseg = 8): Tri {
  const out: number[] = [];
  const pt = (i: number, j: number) => {
    const u = (i / seg) * arc, v = (j / tseg) * Math.PI * 2;
    const cx = Math.cos(u), cz = Math.sin(u);
    const nx = Math.cos(v) * cx, ny = Math.sin(v), nz = Math.cos(v) * cz;
    return [cx + nx * tube, ny * tube, cz + nz * tube, nx, ny, nz];
  };
  for (let i = 0; i < seg; i++)
    for (let j = 0; j < tseg; j++) {
      const a = pt(i, j), b = pt(i + 1, j), c = pt(i + 1, j + 1), d = pt(i, j + 1);
      out.push(...a, ...b, ...c, ...a, ...c, ...d);
    }
  return out;
}

const geoCache = new Map<string, Tri>();
function geo(p: Part, lod = 1): Tri {
  const key = p.s + (p.arc ?? '') + (p.tube ?? '') + (p.top ?? '') + ':' + lod;
  let g = geoCache.get(key);
  if (!g) {
    const n = (k: number, min: number) => Math.max(min, Math.round(k * lod));
    switch (p.s) {
      case 'sphere': g = sphereGeo(n(14, 6), n(10, 4)); break;
      case 'cone': g = coneGeo(n(12, 5), 0); break;
      case 'tcone': g = coneGeo(n(12, 5), p.top ?? 0.5); break;
      case 'cyl': g = coneGeo(n(12, 5), 1); break;
      case 'box': g = boxGeo(); break;
      case 'torus': g = torusGeo(p.arc, p.tube, n(16, 6), n(8, 4)); break;
    }
    geoCache.set(key, g!);
  }
  return g!;
}

// ---------------------------------------------------------------- posing
const D = Math.PI / 180;

/** Build vertex data (pos3 normal3 color3 emissive1) for one animation frame. */
export function buildFrame(design: Design, frame: number, frames: number): Float32Array {
  const out: number[] = [];
  const ph = (frame / frames) * Math.PI * 2;
  const bob = design.float ? Math.sin(ph) * (design.bob ?? 0.04) : Math.abs(Math.sin(ph)) * (design.bob ?? 0.035);
  const M = mat4.create();
  const A = mat4.create();
  const T = mat4.create();
  for (const part of design.parts) {
    const copies = part.m ? [0, 1] : [0];
    for (const side of copies) {
      const sg = side ? -1 : 1;
      const p = part.p, r = part.r ?? [0, 0, 0];
      // part transform (mirrored: x -> -x, ry -> -ry, rz -> -rz)
      mat4.compose(M, p[0] * sg, p[1], p[2], r[0] * D, r[1] * D * sg, r[2] * D * sg, part.k[0], part.k[1], part.k[2]);
      // animation rotation about pivot
      let ax = 0, ay = 0, az = 0, dy = 0;
      const off = side ? Math.PI : 0;
      switch (part.a) {
        case 'legF': ax = Math.sin(ph + off) * 0.55; break;
        case 'legB': ax = Math.sin(ph + off + Math.PI) * 0.55; break;
        case 'arm': ax = Math.sin(ph + off + Math.PI) * 0.5; break;
        case 'tail': ay = Math.sin(ph) * 0.35; break;
        case 'ear': az = Math.sin(ph * 2) * 0.1 * sg; break;
        case 'wing': az = Math.sin(ph) * 0.6 * sg; break;
        case 'head': ax = Math.sin(ph * 2) * 0.04; break;
        case 'flame': dy = Math.sin(ph * 2) * 0.02; ay = ph; break;
        case 'tent': ax = Math.sin(ph + (p[0] + p[2]) * 3) * 0.3; break;
      }
      if (part.a && part.a !== 'none') {
        const pv = part.pv ?? p;
        const px = pv[0] * sg, py = pv[1], pz = pv[2];
        mat4.compose(A, 0, 0, 0, ax, ay, az, 1, 1, 1);
        mat4.compose(T, -px, -py, -pz, 0, 0, 0, 1, 1, 1);
        mat4.mul(M, T, M);
        mat4.mul(M, A, M);
        mat4.compose(T, px, py + dy, pz, 0, 0, 0, 1, 1, 1);
        mat4.mul(M, T, M);
      }
      const g = geo(part, design.lod ?? 1);
      const col = hexToRgb(part.c);
      const e = part.e ?? 0;
      // normal matrix approximation: transform normal by M then divide by scale^2 (handles non-uniform scale)
      const ks = part.k;
      for (let v = 0; v < g.length; v += 6) {
        let x = g[v], y = g[v + 1], z = g[v + 2];
        const [wx, wy, wz] = mat4.transformPoint(M, x, y, z);
        x = g[v + 3] / ks[0]; y = g[v + 4] / ks[1]; z = g[v + 5] / ks[2];
        let [nx, ny, nz] = mat4.transformDir(M, x / ks[0], y / ks[1], z / ks[2]);
        const L = Math.hypot(nx, ny, nz) || 1;
        nx /= L; ny /= L; nz /= L;
        out.push(wx, wy + bob, wz, nx, ny, nz, col[0], col[1], col[2], e);
      }
      // mirrored geometry flips winding; we render with culling disabled in the baker
    }
  }
  return new Float32Array(out);
}

export function bounds(data: Float32Array) {
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (let i = 0; i < data.length; i += 10) {
    x0 = Math.min(x0, data[i]); x1 = Math.max(x1, data[i]);
    y0 = Math.min(y0, data[i + 1]); y1 = Math.max(y1, data[i + 1]);
    z0 = Math.min(z0, data[i + 2]); z1 = Math.max(z1, data[i + 2]);
  }
  return { x0, x1, y0, y1, z0, z1 };
}
