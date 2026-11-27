// Load-time per-vertex bakes for the 3D world (docs/RENDER3D.md "World meshes"): sky visibility (the ambient rig's
// blend between its open-sky and enclosed sets, WORLDGEN3D Q18.7) and the lamp channel (local light baked per vertex,
// Q18.9 as superseded by Q23). Both read the top field, never the sim. No three.
import type { TopField } from './topfield';

/** a local light emitter (WORLDGEN3D Q18.9: colour, radius, intensity; data in `Dressing` once G1a writes it, from the
 *  tile maps' light pools until then: render/world3d/tilelamps.ts) */
export interface LampEmitter {
  position: [number, number, number];
  /** 0..1 sRGB */
  colour: [number, number, number];
  /** m */
  radius: number;
  intensity: number;
}

/** azimuths and march distances (m) of the sky-visibility horizon search */
const AZ = 8;
const STEPS = [0.6, 1.2, 2, 3, 4.5, 7, 10, 15];
const DIRS = Array.from({ length: AZ }, (_, k) => [Math.cos((k / AZ) * Math.PI * 2), Math.sin((k / AZ) * Math.PI * 2)]);
/** how far off the surface the bakes start, along the normal (just over half a field cell, so a vertical face's sample
 *  leaves the column it belongs to) */
const LIFT = 0.26;

/** Sky visibility at a surface point, 0 (enclosed) to 1 (open sky): per azimuth, the highest horizon the top field
 *  raises over the point, weighted toward the directions the face looks at; anything drawn overhead (a deck, an
 *  overhang) cuts it to a quarter. */
export function skyVisibility(f: TopField, x: number, y: number, z: number, nx: number, ny: number, nz: number): number {
  const px = x + nx * LIFT, py = y + ny * LIFT, pz = z + nz * LIFT;
  const hl = Math.hypot(nx, nz);
  let sum = 0, wsum = 0;
  for (const [dx, dz] of DIRS) {
    // the half of the sky behind a steep face is not seen by it
    const facing = hl > 1e-3 ? (dx * nx + dz * nz) / hl : 0;
    const w = Math.max(0, 0.5 + 0.5 * facing * Math.min(1, hl * 1.5));
    if (w <= 0) continue;
    let sinMax = 0;
    for (const r of STEPS) {
      const h = f.at(px + dx * r, pz + dz * r) - py;
      if (h > 0) { const s = h / Math.hypot(h, r); if (s > sinMax) sinMax = s; }
    }
    sum += w * (1 - sinMax); wsum += w;
  }
  let v = wsum > 0 ? sum / wsum : 0;
  if (f.at(px, pz) > py + 0.3) v *= 0.25;
  return Math.max(0, Math.min(1, v));
}

/** is the straight line from an emitter to a point clear of the top field (no surface rises over it)? The lamp
 *  channel's confinement: light stays in the emitter's space and its openings. (On generated maps the spaces and
 *  portals of the model are the rule, WORLDGEN3D Q18.9; the adapter maps have none, so the line is the test.) */
export function lampSees(f: TopField, e: [number, number, number], x: number, y: number, z: number): boolean {
  const N = 6, d = Math.hypot(x - e[0], z - e[2]);
  for (let k = 1; k < N; k++) {
    const t = k / N;
    // the emitter's own body (the prop it sits on) does not shade it: samples within LAMP_BODY of it are skipped
    if (t * d < LAMP_BODY) continue;
    const sx = e[0] + (x - e[0]) * t, sy = e[1] + (y - e[1]) * t, sz = e[2] + (z - e[2]) * t;
    if (f.at(sx, sz) > sy + 0.35) return false;
  }
  return true;
}

/** the share of an emitter's light at a point (0 outside its radius or out of its sight), before colour × intensity */
export function lampFalloff(f: TopField, L: LampEmitter, x: number, y: number, z: number, nx: number, ny: number, nz: number): number {
  const dx = L.position[0] - x, dy = L.position[1] - y, dz = L.position[2] - z, d = Math.hypot(dx, dy, dz);
  if (d >= L.radius) return 0;
  const ndl = d > 1e-4 ? (dx * nx + dy * ny + dz * nz) / d : 1;
  const wrap = Math.max(0, (ndl + 0.3) / 1.3);
  if (wrap <= 0) return 0;
  if (!lampSees(f, L.position, x + nx * 0.05, y + ny * 0.05, z + nz * 0.05)) return 0;
  const u = 1 - d / L.radius;
  return u * u * wrap;
}

/** m around an emitter where the top field is its own body, not an occluder */
export const LAMP_BODY = 1.5;

/** a contribution this small is not an overlap (Q20(c)'s count) */
export const LAMP_EPS = 0.02;
