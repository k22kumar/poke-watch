// S1 spike: three ways to give a Rapier world the static colliders of a WorldModel (docs/spikes/S1-physics.md §2).
//   boxes      the adapter's colliders as they are: a cuboid per merged box, a trimesh per ramp collider
//   chunks     one trimesh per render chunk: the 'terrain' surface chunks (the visible shell: tops and exposed sides,
//              at most 64 × 64 m), so collision is literally the drawn geometry. Liquid chunks get no collider
//   boxmesh    one trimesh per 64 m chunk merged from the adapter's colliders (every box face but the floor's, the
//              ramp triangles), bucketed by the box's centre: the collision-grade chunk mesh (the render surfaces are not:
//              they draw a stairs tile as a column at its mid height, lips through the ramp; record §2)
//   heightfield  open ground as one Rapier heightfield; every box that is not plain open ground stays a box
// All colliders go on one fixed body each (a fixed collider with no parent), handles owned by the World.
import type { Collider as RCollider, World as RWorld } from '@dimforge/rapier3d-deterministic/exports';
import type { BoxCollider, WorldModel } from '../world/model';
import type { Rapier } from './rapier';

export type Representation = 'boxes' | 'chunks' | 'boxmesh' | 'heightfield';

export interface BuildStats { rep: Representation; colliders: number; boxes: number; trimeshes: number; heightfields: number; triangles: number; ms: number }

export interface BuildOptions {
  /** trimesh flags for chunk / ramp trimeshes (TriMeshFlags bits; 0 = none) */
  trimeshFlags?: number;
  /** heightfield: the height of open ground (boxes with this top become heightfield) */
  groundY?: number;
}

/** add the model's static colliders to `world`; returns what was made. The caller owns `world` */
export function buildStatic(R: Rapier, world: RWorld, M: WorldModel, rep: Representation, opt: BuildOptions = {}): BuildStats {
  const t0 = performance.now();
  const st: BuildStats = { rep, colliders: 0, boxes: 0, trimeshes: 0, heightfields: 0, triangles: 0, ms: 0 };
  const flags = opt.trimeshFlags ?? 0;
  const add = (d: ReturnType<typeof R.ColliderDesc.cuboid>): RCollider => { st.colliders++; return world.createCollider(d); };
  const cuboid = (b: BoxCollider) => { st.boxes++; add(R.ColliderDesc.cuboid(b.half[0], b.half[1], b.half[2]).setTranslation(b.centre[0], b.centre[1], b.centre[2])); };
  const tri = (pos: Float32Array, idx: Uint32Array) => {
    if (idx.length === 0) return;
    st.trimeshes++; st.triangles += idx.length / 3;
    add(flags ? R.ColliderDesc.trimesh(pos, idx, flags) : R.ColliderDesc.trimesh(pos, idx));
  };

  if (rep === 'boxes') {
    for (const c of M.colliders) c.shape === 'box' ? cuboid(c) : tri(c.positions, c.indices);
  } else if (rep === 'chunks') {
    for (const s of M.surfaces) if (s.material === 'terrain') tri(s.positions, s.indices);
  } else if (rep === 'boxmesh') {
    const [x0, , z0] = M.bounds.min, floor = M.bounds.min[1];
    const buckets = new Map<string, { p: number[]; i: number[] }>();
    const bucket = (x: number, z: number) => {
      const key = `${Math.floor((x - x0) / 64)}|${Math.floor((z - z0) / 64)}`;
      let b = buckets.get(key); if (!b) buckets.set(key, (b = { p: [], i: [] })); return b;
    };
    // faces of a box, outward winding (CCW seen from outside)
    const F: number[][][] = [
      [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]], [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]],
      [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]], [[-1, -1, 1], [-1, -1, -1], [1, -1, -1], [1, -1, 1]],
      [[1, -1, 1], [1, 1, 1], [-1, 1, 1], [-1, -1, 1]], [[-1, -1, -1], [-1, 1, -1], [1, 1, -1], [1, -1, -1]],
    ];
    for (const c of M.colliders) {
      if (c.shape === 'box') {
        const b = bucket(c.centre[0], c.centre[2]);
        F.forEach((q, fi) => {
          if (fi === 3 && c.centre[1] - c.half[1] === floor) return; // a floor-standing box's bottom faces nothing
          const base = b.p.length / 3;
          for (const v of q) b.p.push(c.centre[0] + v[0] * c.half[0], c.centre[1] + v[1] * c.half[1], c.centre[2] + v[2] * c.half[2]);
          b.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
        });
      } else {
        const P = c.positions, I = c.indices, b = bucket(P[0], P[2]), base = b.p.length / 3;
        for (let k = 0; k < P.length; k++) b.p.push(P[k]);
        for (let k = 0; k < I.length; k++) b.i.push(base + I[k]);
      }
    }
    for (const k of [...buckets.keys()].sort()) { const b = buckets.get(k)!; tri(Float32Array.from(b.p), Uint32Array.from(b.i)); }
  } else {
    // open ground: a box from the bounds floor whose top is groundY. Everything else stays as it was
    const g = opt.groundY ?? 0, floor = M.bounds.min[1];
    const [x0, , z0] = M.bounds.min, [x1, , z1] = M.bounds.max;
    const nx = Math.round(x1 - x0), nz = Math.round(z1 - z0);
    // vertex heights at 1 m: open ground where any open-ground box covers the vertex's tile corner, else the floor (a
    // vertex under liquid becomes a bed at the floor: the column model has none, see the record)
    const open = new Uint8Array(nx * nz);
    for (const c of M.colliders) {
      if (c.shape !== 'box' || c.centre[1] - c.half[1] !== floor || c.centre[1] + c.half[1] !== g) continue;
      for (let j = Math.round(c.centre[2] - c.half[2] - z0); j < Math.round(c.centre[2] + c.half[2] - z0); j++)
        for (let i = Math.round(c.centre[0] - c.half[0] - x0); i < Math.round(c.centre[0] + c.half[0] - x0); i++) open[j * nx + i] = 1;
    }
    // Rapier: nrows along z, ncols along x, heights column-major ((nrows+1) × (ncols+1)), centred on the collider
    const nrows = nz, ncols = nx, H = new Float32Array((nrows + 1) * (ncols + 1));
    for (let c = 0; c <= ncols; c++) for (let r = 0; r <= nrows; r++) {
      let any = false;
      for (const [di, dj] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
        const i = c + di, j = r + dj;
        if (i >= 0 && j >= 0 && i < nx && j < nz && open[j * nx + i]) any = true;
      }
      H[c * (nrows + 1) + r] = any ? g : floor;
    }
    st.heightfields++; st.triangles += nrows * ncols * 2;
    add(R.ColliderDesc.heightfield(nrows, ncols, H, { x: nx, y: 1, z: nz }, R.HeightFieldFlags.FIX_INTERNAL_EDGES).setTranslation((x0 + x1) / 2, 0, (z0 + z1) / 2));
    for (const c of M.colliders) {
      if (c.shape === 'box') { if (!(c.centre[1] - c.half[1] === floor && c.centre[1] + c.half[1] === g)) cuboid(c); }
      else tri(c.positions, c.indices);
    }
  }
  st.ms = performance.now() - t0;
  return st;
}
