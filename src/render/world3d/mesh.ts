// World meshes from a WorldModel's render chunks (docs/RENDER3D.md "World meshes"; WORLDGEN3D Q16.4 as extended by
// Q23): a chunk carries welded positions, indices and a role, and no normals or colour. The renderer computes the
// normals here, across chunk borders, by each role's normal mode (`flat`, `crease` at the profile's crease angle,
// `smooth`), and bakes the per-vertex channels the world material reads: sky visibility, the lamp channel, a facet
// tone and the depth below the local top. Pure arrays, no three: src/render/three wraps them in geometry.
import type { MaterialRole } from '../../rules/materialroles';
import type { NormalMode } from '../../rules/styles/profiles';
import type { WorldModel } from '../../world/model';
import { LAMP_EPS, lampFalloff, skyVisibility, type LampEmitter } from './bake';
import { TopField } from './topfield';

export interface BuiltChunk {
  kind: 'terrain' | 'liquid';
  role?: MaterialRole;
  liquid?: string;
  cx: number; cz: number;
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  /** per vertex: sky visibility 0..1 */
  sky: Float32Array;
  /** per vertex: baked lamp light, linear RGB before the time-of-day strength */
  lamp: Float32Array;
  /** per vertex: a facet's tone seed in −1..1 (the same on every vertex of a plane) */
  facet: Float32Array;
  /** per vertex: m below the top of the column the face belongs to (0 on tops) */
  depth: Float32Array;
}

export interface WorldBuild {
  chunks: BuiltChunk[];
  field: TopField;
  stats: {
    triangles: number; vertices: number; inputVertices: number;
    /** load-time cost, ms (performance.now when present, else 0) */
    ms: { field: number; normals: number; bake: number };
    lamps: number;
    /** the most emitters reaching one vertex (Q20(c) as restated: docs/RENDER3D.md "Local light") */
    maxLampOverlap: number;
  };
}

export interface BuildOptions {
  normalMode: (role: MaterialRole) => NormalMode;
  /** degrees */
  creaseAngle: number;
  lamps?: LampEmitter[];
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : 0);
/** positions within this distance are one vertex across chunk borders */
const Q = 1000;
const key = (x: number, y: number, z: number) => `${Math.round(x * Q)},${Math.round(y * Q)},${Math.round(z * Q)}`;
const srgbLin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** a deterministic −1..1 tone from a plane (its normal and offset), so every face of one plane shares it */
function planeTone(nx: number, ny: number, nz: number, d: number): number {
  let h = Math.imul(Math.round(nx * 64) + 97, 73856093) ^ Math.imul(Math.round(ny * 64) + 89, 19349663) ^ Math.imul(Math.round(nz * 64) + 83, 83492791) ^ Math.imul(Math.round(d * 8), 2654435761);
  h ^= h >>> 13; h = Math.imul(h, 1274126177); h ^= h >>> 16;
  return ((h >>> 0) / 4294967295) * 2 - 1;
}

export function buildWorld(model: WorldModel, o: BuildOptions): WorldBuild {
  const t0 = now();
  const field = TopField.of(model);
  const t1 = now();
  const lamps = o.lamps ?? [];
  const cosCrease = Math.cos((o.creaseAngle * Math.PI) / 180);

  // face normals (unnormalised: their length is twice the area) of every terrain triangle, and the corners at each
  // distinct position across every terrain chunk with their angle: a vertex normal is the corner-angle-weighted mean
  // of the faces it keeps, so it does not depend on how a surface was split into triangles or chunks
  const terrain = model.surfaces.filter((c) => c.material !== 'liquid');
  const faceN: Float32Array[] = [];
  const corners = new Map<string, number[]>(); // position → [chunk, face, corner angle, …] triples
  terrain.forEach((c, ci) => {
    const P = c.positions, I = c.indices, F = new Float32Array(I.length);
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, d = I[t + 2] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
      const vx = P[d] - P[a], vy = P[d + 1] - P[a + 1], vz = P[d + 2] - P[a + 2];
      F[t] = uy * vz - uz * vy; F[t + 1] = uz * vx - ux * vz; F[t + 2] = ux * vy - uy * vx;
      for (let k = 0; k < 3; k++) {
        const v = I[t + k] * 3, p = I[t + ((k + 1) % 3)] * 3, q = I[t + ((k + 2) % 3)] * 3, kk = key(P[v], P[v + 1], P[v + 2]);
        const ax = P[p] - P[v], ay = P[p + 1] - P[v + 1], az = P[p + 2] - P[v + 2], bx = P[q] - P[v], by = P[q + 1] - P[v + 1], bz = P[q + 2] - P[v + 2];
        const la = Math.hypot(ax, ay, az), lb = Math.hypot(bx, by, bz);
        const angle = la > 0 && lb > 0 ? Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by + az * bz) / (la * lb)))) : 0;
        let list = corners.get(kk);
        if (!list) corners.set(kk, (list = []));
        list.push(ci, t, angle);
      }
    }
    faceN.push(F);
  });

  const chunks: BuiltChunk[] = [];
  let triangles = 0, vertices = 0, inputVertices = 0, maxOverlap = 0;
  const t2 = now();
  let bakeMs = 0;
  terrain.forEach((c, ci) => {
    const role = c.role ?? 'ground', mode = o.normalMode(role);
    const P = c.positions, I = c.indices, F = faceN[ci];
    inputVertices += P.length / 3;
    const pos: number[] = [], nrm: number[] = [], idx: number[] = [];
    const seen = new Map<string, number>();
    for (let t = 0; t < I.length; t += 3) {
      const fl = Math.hypot(F[t], F[t + 1], F[t + 2]);
      if (fl < 1e-12) continue; // degenerate
      const fx = F[t] / fl, fy = F[t + 1] / fl, fz = F[t + 2] / fl;
      for (let k = 0; k < 3; k++) {
        const vi = I[t + k], v = vi * 3;
        let nx = fx, ny = fy, nz = fz;
        if (mode !== 'flat') {
          nx = ny = nz = 0;
          const list = corners.get(key(P[v], P[v + 1], P[v + 2]))!;
          for (let q = 0; q < list.length; q += 3) {
            const G = faceN[list[q]], g = list[q + 1], w = list[q + 2];
            const gl = Math.hypot(G[g], G[g + 1], G[g + 2]);
            if (gl < 1e-12) continue;
            if (mode === 'crease' && (G[g] * fx + G[g + 1] * fy + G[g + 2] * fz) / gl < cosCrease) continue;
            nx += (G[g] / gl) * w; ny += (G[g + 1] / gl) * w; nz += (G[g + 2] / gl) * w;
          }
          const l = Math.hypot(nx, ny, nz) || 1;
          nx /= l; ny /= l; nz /= l;
        }
        // corners share a vertex when their normals agree: in flat mode the faces of one plane, never two planes
        const kk = `${vi}|${Math.round(nx * 1e4)},${Math.round(ny * 1e4)},${Math.round(nz * 1e4)}`;
        let out = seen.get(kk);
        if (out === undefined) {
          out = pos.length / 3;
          seen.set(kk, out);
          pos.push(P[v], P[v + 1], P[v + 2]); nrm.push(nx, ny, nz);
        }
        idx.push(out);
      }
    }
    const n = pos.length / 3;
    const b0 = now();
    const sky = new Float32Array(n), lamp = new Float32Array(n * 3), facet = new Float32Array(n), depth = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2], nx = nrm[i * 3], ny = nrm[i * 3 + 1], nz = nrm[i * 3 + 2];
      sky[i] = skyVisibility(field, x, y, z, nx, ny, nz);
      facet[i] = planeTone(nx, ny, nz, nx * x + ny * y + nz * z);
      // the column behind a steep face is the solid it belongs to
      const hl = Math.hypot(nx, nz), top = hl > 0.5 ? field.at(x - (nx / hl) * 0.26, z - (nz / hl) * 0.26) : y;
      depth[i] = Math.max(0, (Number.isFinite(top) ? top : y) - y);
      let overlap = 0;
      for (const L of lamps) {
        const w = lampFalloff(field, L, x, y, z, nx, ny, nz);
        if (w <= 0) continue;
        if (w * L.intensity > LAMP_EPS) overlap++;
        const k = w * L.intensity;
        lamp[i * 3] += srgbLin(L.colour[0]) * k; lamp[i * 3 + 1] += srgbLin(L.colour[1]) * k; lamp[i * 3 + 2] += srgbLin(L.colour[2]) * k;
      }
      if (overlap > maxOverlap) maxOverlap = overlap;
    }
    bakeMs += now() - b0;
    triangles += idx.length / 3; vertices += n;
    chunks.push({ kind: 'terrain', role, cx: c.cx, cz: c.cz, positions: new Float32Array(pos), normals: new Float32Array(nrm), indices: new Uint32Array(idx), sky, lamp, facet, depth });
  });

  // liquids: flat, facing up (a liquid surface is level); open sky unless something is drawn over it
  for (const c of model.surfaces) {
    if (c.material !== 'liquid') continue;
    const P = c.positions, n = P.length / 3;
    inputVertices += n;
    const nrm = new Float32Array(n * 3), sky = new Float32Array(n), lamp = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      nrm[i * 3 + 1] = 1;
      sky[i] = skyVisibility(field, P[i * 3], P[i * 3 + 1], P[i * 3 + 2], 0, 1, 0);
      for (const L of lamps) {
        const k = lampFalloff(field, L, P[i * 3], P[i * 3 + 1], P[i * 3 + 2], 0, 1, 0) * L.intensity;
        lamp[i * 3] += srgbLin(L.colour[0]) * k; lamp[i * 3 + 1] += srgbLin(L.colour[1]) * k; lamp[i * 3 + 2] += srgbLin(L.colour[2]) * k;
      }
    }
    triangles += c.indices.length / 3; vertices += n;
    chunks.push({ kind: 'liquid', liquid: c.liquid ?? 'water', cx: c.cx, cz: c.cz, positions: P, normals: nrm, indices: c.indices, sky, lamp, facet: new Float32Array(n), depth: new Float32Array(n) });
  }
  const t3 = now();
  return { chunks, field, stats: { triangles, vertices, inputVertices, ms: { field: t1 - t0, normals: t3 - t2 - bakeMs, bake: bakeMs }, lamps: lamps.length, maxLampOverlap: maxOverlap } };
}
