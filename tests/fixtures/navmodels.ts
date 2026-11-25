// Hand-made WorldModels for the navigation tests (task I3): only what src/nav reads (bounds, colliders, hazard volumes,
// navInput). Each piece is the adapter's shape: a floor is a box from the model floor to its top with its top face in
// navInput, a wall a floor-standing box with no walkable face, a slab a box above the floor with its top walkable.
import { NAV_AREA, type BoxCollider, type OffMeshLink, type VolumeGraph, type WorldModel } from '../../src/world/model';

export interface Fixture {
  size: [number, number];
  /** walkable floors: plan rectangle and top (area flags optional) */
  floors?: { x0: number; z0: number; x1: number; z1: number; y: number; soft?: boolean }[];
  /** walls: plan rectangle and top */
  walls?: { x0: number; z0: number; x1: number; z1: number; y: number }[];
  /** slabs (decks): plan rectangle, underside and top; the top is walkable */
  slabs?: { x0: number; z0: number; x1: number; z1: number; y0: number; y1: number }[];
  /** ramps: plan rectangle, height at z0 and at z1 (a sloped walkable quad over a solid wedge base) */
  ramps?: { x0: number; z0: number; x1: number; z1: number; a: number; b: number }[];
  hazards?: { x0: number; z0: number; x1: number; z1: number; y: number }[];
  links?: OffMeshLink[];
  routes?: VolumeGraph;
}

export const FLOOR_Y = -1;

export function fixture(f: Fixture): WorldModel {
  const [W, H] = f.size, hx = W / 2, hz = H / 2;
  const pos: number[] = [], idx: number[] = [], areas: number[] = [];
  const quad = (p: number[][], area: number) => {
    const v = pos.length / 3;
    for (const q of p) pos.push(...q);
    idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
    areas.push(area, area);
  };
  const colliders: BoxCollider[] = [];
  const box = (x0: number, z0: number, x1: number, z1: number, y0: number, y1: number): BoxCollider => ({
    shape: 'box', centre: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], half: [(x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2], yaw: 0,
    material: 'stone', blocksShots: true, foliage: false, role: 'ground', blocksSight: true,
  });
  let top = 0;
  for (const r of f.floors ?? []) {
    colliders.push(box(r.x0, r.z0, r.x1, r.z1, FLOOR_Y, r.y));
    quad([[r.x0, r.y, r.z0], [r.x0, r.y, r.z1], [r.x1, r.y, r.z1], [r.x1, r.y, r.z0]], r.soft ? NAV_AREA.softSoil : 0);
    top = Math.max(top, r.y);
  }
  for (const r of f.walls ?? []) { colliders.push(box(r.x0, r.z0, r.x1, r.z1, FLOOR_Y, r.y)); top = Math.max(top, r.y); }
  for (const r of f.slabs ?? []) {
    colliders.push(box(r.x0, r.z0, r.x1, r.z1, r.y0, r.y1));
    quad([[r.x0, r.y1, r.z0], [r.x0, r.y1, r.z1], [r.x1, r.y1, r.z1], [r.x1, r.y1, r.z0]], 0);
    top = Math.max(top, r.y1);
  }
  for (const r of f.ramps ?? []) {
    const lo = Math.min(r.a, r.b);
    colliders.push(box(r.x0, r.z0, r.x1, r.z1, FLOOR_Y, lo));
    quad([[r.x0, r.a, r.z0], [r.x0, r.b, r.z1], [r.x1, r.b, r.z1], [r.x1, r.a, r.z0]], 0);
    top = Math.max(top, r.a, r.b);
  }
  return {
    bounds: { min: [-hx, FLOOR_Y, -hz], max: [hx, top + 8, hz] },
    colliders,
    volumes: (f.hazards ?? []).map((h) => ({ kind: 'hazard' as const, box: { min: [h.x0, h.y, h.z0] as [number, number, number], max: [h.x1, h.y + 0.05, h.z1] as [number, number, number] }, element: 'blaze' })),
    navInput: { positions: Float32Array.from(pos), indices: Uint32Array.from(idx), links: f.links ?? [], areas: Uint8Array.from(areas), routes: f.routes ?? { nodes: [], edges: [] } },
  } as unknown as WorldModel;
}
