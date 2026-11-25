// The Recast build (task I3; docs/OVERHAUL_3D.md "Navigation (I3)"): one tiled Detour navmesh per width group, built
// tile by tile from a WorldModel's navInput. Our own pipeline rather than @recast-navigation/generators:
//   - walkable faces and solid geometry are two inputs. navInput holds the walkable faces only (up-facing triangles, each
//     with a NAV_AREA byte); the colliders are rasterised too, as null-area solids, so a deck slab's underside limits the
//     headroom of the ground beneath it and a cliff face reads as a wall, not a drop, from its foot (Recast's ledge
//     filter takes an empty neighbour column for a drop). A box standing on the model's floor contributes only its side
//     faces: Recast never fills a solid's inside, its top is the navInput face over it (or a wall's top, which nothing
//     walks), and its bottom is buried. A box above the floor (a deck slab, a low prop) contributes all six faces.
//   - every rasterised triangle is inset by `inset` (0.01 m) in plan. Tile geometry lies exactly on cell boundaries, and
//     Recast's float 1/cs floors an integer boundary one cell low, so a face on a boundary leaks into the neighbouring
//     column; a walkable face leaking into a wall column would make the wall's top walkable (rcAddSpan keeps the higher
//     area of two spans whose tops are within walkableClimb). Inset by a tenth of a cell, each column is owned cleanly.
//   - one rasterisation per tile serves every group: the groups are filtered in ascending agent height on the same
//     heightfield (the height filter only clears spans, and a span too low for a short agent is too low for a taller
//     one). Every tile uses the widest group's border. The ledge filter is not run (buildGroupTile says why).
//   - areas: the navInput byte picks the polygon area (NAV_AREA.softSoil -> AREA.soft), hazard volumes are marked
//     AREA.hazard, off-mesh links carry AREA.link and their index as user id.
//   - tiles are rebuilt one at a time: the TileCache binding has no removeTile, so geometry changes could not replace a
//     tile's cached layers. Temporary objects are TileCache-style obstacles of our own: each marks its cells null before
//     erosion in the tiles it touches (so agents keep their radius from it), and only those tiles are rebuilt.
// Every Recast number is an integer cell count from src/rules (never computed: floor(0.6 / 0.05) is 11 in float).

import type { RecastBuildContext, NavMesh, RecastHeightfield, RecastCompactHeightfield } from '@recast-navigation/core';
import { recast } from './recast';
import { dcos, dsin } from '../core/detmath';
import { NAV_AREA, type Aabb, type BoxCollider, type OffMeshLink, type WorldModel } from '../world/model';

/** Recast area ids (0..63; 0 is Recast's null area) */
export const AREA = { ground: 1, soft: 2, hazard: 3, link: 4 } as const;
/** Detour poly flags: every walkable polygon carries `walk`, a link carries `link` */
export const FLAG = { walk: 1, link: 2 } as const;
/** Recast's RC_WALKABLE_AREA (what rcMarkWalkableTriangles writes) */
const RC_WALKABLE = 63;

/** the Recast and Detour settings shared by every group (cells, from rules.nav) */
export interface NavConfig {
  /** cell size and height (m) */
  cs: number; ch: number;
  /** cells: the agent's step (Detour's climb) */
  walkableClimb: number;
  /** cells: the climb the Recast build tests (rules.nav.recastClimb says why it is a cell under walkableClimb) */
  recastClimb: number;
  /** degrees: Recast's rcMarkWalkableTriangles compares the normal's y with cos(angle) in wasm */
  walkableSlopeAngle: number;
  /** cells per tile side */
  tileSize: number;
  /** m: every rasterised triangle and box is moved this far in from its plan outline */
  inset: number;
  maxSimplificationError: number;
  /** cells */
  maxEdgeLen: number;
  /** cells² */
  minRegionArea: number; mergeRegionArea: number;
  maxVertsPerPoly: number;
  /** a measurement switch, not a rule (I3 review, ROADMAP F78): build Recast's detail mesh with this sample distance
   *  and max error (m, rcBuildPolyMeshDetail's own units) and hand it to Detour. Absent (the game): no detail mesh;
   *  NavGraph reads polygon heights from their vertices either way */
  detail?: { sampleDist: number; sampleMaxError: number };
  /** a measurement switch, not a rule (I3 review, ROADMAP F80): run rcFilterLedgeSpans (the game does not) */
  ledgeFilter?: boolean;
}

/** one width group's agent, in cells */
export interface AgentCells { radius: number; height: number }

/** a temporary obstacle (TileCache-style): a vertical cylinder or an axis-aligned box, its cells null while it exists */
export type Obstacle = { kind: 'cylinder'; x: number; y: number; z: number; r: number; h: number } | { kind: 'box'; min: [number, number, number]; max: [number, number, number] };

/** a profiling clock (scripts/navbench.ts and perf-sim set it); the output never reads it */
export const navClock: { now: (() => number) | null; stages: Record<string, number> } = { now: null, stages: {} };
let lastMark = 0;
function mark(stage: string) {
  if (!navClock.now) return;
  const t = navClock.now();
  navClock.stages[stage] = (navClock.stages[stage] ?? 0) + t - lastMark;
  lastMark = t;
}
function markStart() { if (navClock.now) lastMark = navClock.now(); }

/**
 * The rasteriser's input for one map: walkable faces and solid pieces as one inset triangle soup, copied to wasm once and
 * bucketed by plan cell in JS. Shared by every group of the map.
 */
export class NavSoup {
  readonly bounds: Aabb;
  readonly links: OffMeshLink[];
  readonly hazards: Aabb[];
  /** triangle counts: walkable faces first, then solids */
  readonly walkCount: number; readonly solidCount: number;
  private readonly pos: Float32Array;
  private readonly tris: Int32Array;
  /** walkable triangle -> AREA */
  private readonly walkArea: Uint8Array;
  /** plan AABB per triangle */
  private readonly box: Float32Array;
  /** triangles by bucket (BUCKET m squares over the bounds): CSR offsets and lists */
  private readonly bOff: Int32Array; private readonly bList: Int32Array; private readonly bw: number; private readonly bh: number;
  private readonly seen: Uint32Array; private stamp = 0;
  private verts: InstanceType<ReturnType<typeof recast>['FloatArray']> | null = null;

  constructor(model: WorldModel, inset: number) {
    this.bounds = model.bounds;
    this.links = model.navInput.links;
    this.hazards = model.volumes.filter((v) => v.kind === 'hazard').map((v) => v.box);
    const pos: number[] = [], tris: number[] = [], area: number[] = [];
    const nav = model.navInput;
    for (let t = 0; t < nav.indices.length / 3; t++) {
      if (!insetTri(nav.positions, nav.indices[3 * t], nav.indices[3 * t + 1], nav.indices[3 * t + 2], inset, pos, tris)) continue;
      area.push(nav.areas[t] & NAV_AREA.softSoil ? AREA.soft : AREA.ground);
    }
    this.walkCount = area.length;
    const floor = model.bounds.min[1];
    for (const col of model.colliders) {
      if (col.shape === 'box') boxTris(col, inset, col.centre[1] - col.half[1] <= floor + 1e-6, pos, tris);
      else for (let t = 0; t < col.indices.length / 3; t++) insetTri(col.positions, col.indices[3 * t], col.indices[3 * t + 1], col.indices[3 * t + 2], inset, pos, tris, true);
    }
    this.solidCount = tris.length / 3 - this.walkCount;
    this.pos = Float32Array.from(pos);
    this.tris = Int32Array.from(tris);
    this.walkArea = Uint8Array.from(area);
    const n = this.tris.length / 3, box = new Float32Array(4 * n);
    for (let t = 0; t < n; t++) {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (let q = 0; q < 3; q++) { const v = this.tris[3 * t + q], x = this.pos[3 * v], z = this.pos[3 * v + 2]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
      box[4 * t] = x0; box[4 * t + 1] = z0; box[4 * t + 2] = x1; box[4 * t + 3] = z1;
    }
    this.box = box;
    // buckets
    const b = this.bounds, bw = Math.max(1, Math.ceil((b.max[0] - b.min[0]) / BUCKET)), bh = Math.max(1, Math.ceil((b.max[2] - b.min[2]) / BUCKET));
    this.bw = bw; this.bh = bh;
    const cnt = new Int32Array(bw * bh + 1);
    const span = (t: number, f: (k: number) => void) => {
      const i0 = this.bi(box[4 * t], bw, 0), i1 = this.bi(box[4 * t + 2], bw, 0), j0 = this.bi(box[4 * t + 1], bh, 2), j1 = this.bi(box[4 * t + 3], bh, 2);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) f(j * bw + i);
    };
    for (let t = 0; t < n; t++) span(t, (k) => { cnt[k + 1]++; });
    for (let k = 0; k < bw * bh; k++) cnt[k + 1] += cnt[k];
    const fill = cnt.slice(), list = new Int32Array(cnt[bw * bh]);
    for (let t = 0; t < n; t++) span(t, (k) => { list[fill[k]++] = t; });
    this.bOff = cnt; this.bList = list;
    this.seen = new Uint32Array(n);
  }
  private bi(v: number, nb: number, axis: 0 | 2): number { return Math.min(nb - 1, Math.max(0, Math.floor((v - this.bounds.min[axis]) / BUCKET))); }

  /** the soup's vertices in wasm (copied once, freed by dispose) */
  vertsArray() {
    if (!this.verts) { const R = recast(); this.verts = new R.FloatArray(); this.verts.copy(this.pos); }
    return this.verts;
  }
  get vertexCount(): number { return this.pos.length / 3; }

  /** the triangles overlapping the plan rectangle, in index order, walkable and solid apart */
  select(x0: number, z0: number, x1: number, z1: number): { walk: number[]; solid: number[] } {
    const walk: number[] = [], solid: number[] = [], B = this.box, s = ++this.stamp;
    const i0 = this.bi(x0, this.bw, 0), i1 = this.bi(x1, this.bw, 0), j0 = this.bi(z0, this.bh, 2), j1 = this.bi(z1, this.bh, 2);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * this.bw + i;
      for (let q = this.bOff[k]; q < this.bOff[k + 1]; q++) {
        const t = this.bList[q];
        if (this.seen[t] === s) continue;
        this.seen[t] = s;
        if (B[4 * t + 2] < x0 || B[4 * t] > x1 || B[4 * t + 3] < z0 || B[4 * t + 1] > z1) continue;
        (t < this.walkCount ? walk : solid).push(t);
      }
    }
    walk.sort((a, b) => a - b); solid.sort((a, b) => a - b);
    return { walk, solid };
  }
  areaOf(t: number): number { return this.walkArea[t]; }
  triVerts(t: number, out: Int32Array, at: number) { out[at] = this.tris[3 * t]; out[at + 1] = this.tris[3 * t + 1]; out[at + 2] = this.tris[3 * t + 2]; }

  dispose() { this.verts?.destroy(); this.verts = null; }
}

/** the soup's plan buckets (m) */
const BUCKET = 4;

/**
 * Append triangle (a, b, c) of `src`, its plan outline moved in by `d` (each edge offset inward: the triangle scaled
 * about its plan incentre, so it stays on its own plane). A triangle too small to shrink is dropped (false). A vertical
 * one (no plan area) is kept as it is when `keepVertical` (a solid's wall face), else dropped.
 */
function insetTri(src: Float32Array, a: number, b: number, c: number, d: number, pos: number[], tris: number[], keepVertical = false): boolean {
  const ax = src[3 * a], ay = src[3 * a + 1], az = src[3 * a + 2];
  const bx = src[3 * b], by = src[3 * b + 1], bz = src[3 * b + 2];
  const cx = src[3 * c], cy = src[3 * c + 1], cz = src[3 * c + 2];
  const la = Math.sqrt((bx - cx) * (bx - cx) + (bz - cz) * (bz - cz)), lb = Math.sqrt((ax - cx) * (ax - cx) + (az - cz) * (az - cz)), lc = Math.sqrt((ax - bx) * (ax - bx) + (az - bz) * (az - bz));
  const per = la + lb + lc, area2 = Math.abs((bx - ax) * (cz - az) - (bz - az) * (cx - ax));
  const v0 = pos.length / 3;
  if (!(area2 > 1e-9)) {
    if (!keepVertical) return false;
    pos.push(ax, ay, az, bx, by, bz, cx, cy, cz); tris.push(v0, v0 + 1, v0 + 2);
    return true;
  }
  const r = area2 / per; // the plan inradius: (area2 / 2) / (per / 2)
  if (!(r > d * 1.5)) return false;
  const ix = (la * ax + lb * bx + lc * cx) / per, iy = (la * ay + lb * by + lc * cy) / per, iz = (la * az + lb * bz + lc * cz) / per, s = (r - d) / r;
  pos.push(ix + (ax - ix) * s, iy + (ay - iy) * s, iz + (az - iz) * s, ix + (bx - ix) * s, iy + (by - iy) * s, iz + (bz - iz) * s, ix + (cx - ix) * s, iy + (cy - iy) * s, iz + (cz - iz) * s);
  tris.push(v0, v0 + 1, v0 + 2);
  return true;
}

/** a box collider as triangles, its plan half-extents less `d`: the four sides only when it stands on the floor */
function boxTris(b: BoxCollider, d: number, grounded: boolean, pos: number[], tris: number[]) {
  const hx = b.half[0] - d, hy = b.half[1], hz = b.half[2] - d;
  if (!(hx > 0 && hz > 0 && hy > 0)) return;
  const cs = b.yaw ? dcos(b.yaw) : 1, sn = b.yaw ? dsin(b.yaw) : 0, v0 = pos.length / 3;
  for (let q = 0; q < 8; q++) {
    const lx = q & 1 ? hx : -hx, ly = q & 2 ? hy : -hy, lz = q & 4 ? hz : -hz;
    pos.push(b.centre[0] + lx * cs - lz * sn, b.centre[1] + ly, b.centre[2] + lx * sn + lz * cs);
  }
  // corner q: bit 0 x, bit 1 y, bit 2 z. Solids are rasterised with the null area, so winding and slope never matter
  const SIDES = [0, 4, 6, 0, 6, 2, 1, 3, 7, 1, 7, 5, 0, 2, 3, 0, 3, 1, 4, 5, 7, 4, 7, 6];
  const CAPS = [0, 1, 5, 0, 5, 4, 2, 6, 7, 2, 7, 3];
  for (const f of SIDES) tris.push(v0 + f);
  if (!grounded) for (const f of CAPS) tris.push(v0 + f);
}

/** one width group's Detour navmesh */
export interface GroupMesh { readonly name: string; readonly agent: AgentCells; readonly navMesh: NavMesh; readonly polys: Int32Array }

/**
 * One map's tiled navmeshes, every width group on one tile grid: built tile by tile from a NavSoup (one rasterisation
 * per tile for all groups), rebuilt per tile when the soup changes (setSoup) or an obstacle touches it (addObstacle /
 * removeObstacle + update).
 */
export class NavTiles {
  readonly groups: GroupMesh[];
  readonly tw: number; readonly th: number;
  /** the widest group's tile border (cells) */
  readonly border: number;
  private ctx: RecastBuildContext;
  private obstacles = new Map<number, Obstacle>();
  private nextObstacle = 1;
  private dirty = new Set<number>();
  /** tile builds (every group of one tile counts once) */
  builds = 0;
  /** called after each tile is (re)built, with its index (tz * tw + tx); the navigation graph re-reads it */
  onTile: ((t: number) => void) | null = null;

  /** `groups` in ascending agent height (the shared rasterisation's filter order) */
  constructor(private soup: NavSoup, readonly cfg: NavConfig, groups: { name: string; agent: AgentCells }[]) {
    const R = recast();
    for (let i = 1; i < groups.length; i++) if (groups[i].agent.height < groups[i - 1].agent.height) throw new Error('nav: groups must come in ascending agent height');
    const b = soup.bounds, tcs = cfg.tileSize * cfg.cs;
    this.tw = Math.max(1, Math.ceil((b.max[0] - b.min[0]) / tcs - 1e-9));
    this.th = Math.max(1, Math.ceil((b.max[2] - b.min[2]) / tcs - 1e-9));
    this.border = Math.max(...groups.map((g) => g.agent.radius)) + 3;
    this.ctx = new R.RecastBuildContext(false);
    const tileBits = Math.min(14, ceilLog2(this.tw * this.th));
    this.groups = groups.map((g) => {
      const navMesh = new R.NavMesh();
      const params = R.NavMeshParams.create({ orig: { x: b.min[0], y: b.min[1], z: b.min[2] }, tileWidth: tcs, tileHeight: tcs, maxTiles: 1 << tileBits, maxPolys: 1 << (22 - tileBits) });
      if (!navMesh.initTiled(params)) throw new Error('nav: dtNavMesh initTiled failed');
      return { name: g.name, agent: g.agent, navMesh, polys: new Int32Array(this.tw * this.th) };
    });
  }

  /** build every tile (map entry) */
  buildAll(): void { for (let tz = 0; tz < this.th; tz++) for (let tx = 0; tx < this.tw; tx++) this.buildTile(tx, tz); }

  /** a new soup for the same map bounds (a geometry change): the tiles listed are rebuilt from it now */
  setSoup(soup: NavSoup, tiles: Iterable<number>): void {
    this.soup.dispose();
    this.soup = soup;
    for (const t of [...tiles].sort((a, b) => a - b)) this.buildTile(t % this.tw, (t / this.tw) | 0);
  }

  /** the tiles (index tz * tw + tx) whose build reads a plan rectangle (their own square and their border) */
  tilesTouching(x0: number, z0: number, x1: number, z1: number): number[] {
    const b = this.soup.bounds, tcs = this.cfg.tileSize * this.cfg.cs, pad = this.border * this.cfg.cs;
    const i0 = Math.max(0, Math.floor((x0 - pad - b.min[0]) / tcs)), i1 = Math.min(this.tw - 1, Math.floor((x1 + pad - b.min[0]) / tcs));
    const j0 = Math.max(0, Math.floor((z0 - pad - b.min[2]) / tcs)), j1 = Math.min(this.th - 1, Math.floor((z1 + pad - b.min[2]) / tcs));
    const out: number[] = [];
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) out.push(j * this.tw + i);
    return out;
  }

  /** add a temporary obstacle; its tiles rebuild at the next update(). Returns its id */
  addObstacle(o: Obstacle): number {
    const id = this.nextObstacle++;
    this.obstacles.set(id, o);
    for (const t of this.obstacleTiles(o)) this.dirty.add(t);
    return id;
  }
  removeObstacle(id: number): boolean {
    const o = this.obstacles.get(id);
    if (!o) return false;
    this.obstacles.delete(id);
    for (const t of this.obstacleTiles(o)) this.dirty.add(t);
    return true;
  }
  /** rebuild the tiles obstacles touched since the last update; returns them (ascending) */
  update(): number[] {
    const list = [...this.dirty].sort((a, b) => a - b);
    this.dirty.clear();
    for (const t of list) this.buildTile(t % this.tw, (t / this.tw) | 0);
    return list;
  }
  private obstacleTiles(o: Obstacle): number[] {
    return o.kind === 'cylinder' ? this.tilesTouching(o.x - o.r, o.z - o.r, o.x + o.r, o.z + o.r) : this.tilesTouching(o.min[0], o.min[2], o.max[0], o.max[2]);
  }

  /** (re)build one tile for every group: one rasterisation, then per group filter, erode, regions, contours, polygons
   *  and Detour data, replacing the group's old tile */
  buildTile(tx: number, tz: number): void {
    const R = recast(), C = this.cfg, ctx = this.ctx, b = this.soup.bounds;
    markStart();
    for (const g of this.groups) { const old = g.navMesh.getTileRefAt(tx, tz, 0); if (old) g.navMesh.removeTile(old); g.polys[tz * this.tw + tx] = 0; }
    const border = this.border, tcs = C.tileSize * C.cs;
    const bmin: [number, number, number] = [b.min[0] + tx * tcs - border * C.cs, b.min[1], b.min[2] + tz * tcs - border * C.cs];
    const bmax: [number, number, number] = [b.min[0] + (tx + 1) * tcs + border * C.cs, b.max[1], b.min[2] + (tz + 1) * tcs + border * C.cs];
    const side = C.tileSize + 2 * border;
    const { walk, solid } = this.soup.select(bmin[0], bmin[2], bmax[0], bmax[2]);
    mark('select');
    this.builds++;
    if (walk.length === 0) { this.onTile?.(tz * this.tw + tx); return; }
    const hf = R.allocHeightfield();
    try {
      if (!R.createHeightfield(ctx, hf, side, side, bmin, bmax, C.cs, C.ch)) throw new Error('nav: createHeightfield');
      this.rasterise(hf, walk, true);
      if (solid.length) this.rasterise(hf, solid, false);
      mark('rasterise');
      R.filterLowHangingWalkableObstacles(ctx, C.recastClimb, hf);
      for (const g of this.groups) this.buildGroupTile(g, hf, tx, tz, bmin, bmax);
    } finally {
      R.freeHeightfield(hf);
    }
    this.onTile?.(tz * this.tw + tx);
  }

  private buildGroupTile(g: GroupMesh, hf: RecastHeightfield, tx: number, tz: number, bmin: [number, number, number], bmax: [number, number, number]) {
    const R = recast(), C = this.cfg, A = g.agent, ctx = this.ctx;
    // no rcFilterLedgeSpans: its steep-slope rule (a span whose reachable neighbours' floors differ by more than
    // walkableClimb) clears the corner cells of every diagonal terraced slope on the tile maps (0.3-0.4 m a tile, so a
    // corner cell sees +0.4 and -0.3), cutting ramps the sim walks (Viridian Forest seed 1). Drops need no filter here:
    // a cell does not connect across a drop larger than the climb, and erosion keeps the agent its radius from it
    if (C.ledgeFilter) R.filterLedgeSpans(ctx, A.height, C.recastClimb, hf);
    R.filterWalkableLowHeightSpans(ctx, A.height, hf);
    mark('filter');
    let chf: RecastCompactHeightfield | null = null, cset: ReturnType<typeof R.allocContourSet> | null = null, pmesh: ReturnType<typeof R.allocPolyMesh> | null = null;
    let dmesh: ReturnType<typeof R.allocPolyMeshDetail> | null = null;
    try {
      chf = R.allocCompactHeightfield();
      if (!R.buildCompactHeightfield(ctx, A.height, C.recastClimb, hf, chf)) throw new Error('nav: buildCompactHeightfield');
      // temporary obstacles: null before erosion, so the agent keeps its radius from them
      for (const o of this.obstacles.values()) {
        if (o.kind === 'cylinder') R.markCylinderArea(ctx, [o.x, o.y, o.z], o.r, o.h, 0, chf);
        else R.markBoxArea(ctx, o.min, o.max, 0, chf);
      }
      mark('compact');
      if (!R.erodeWalkableArea(ctx, A.radius, chf)) throw new Error('nav: erodeWalkableArea');
      // hazard volumes (vent fields): their own area, two cells of reach either way
      for (const h of this.soup.hazards) {
        const d = C.inset;
        R.markBoxArea(ctx, [h.min[0] + d, h.min[1] - 2 * C.ch, h.min[2] + d], [h.max[0] - d, h.max[1] + 2 * C.ch, h.max[2] - d], AREA.hazard, chf);
      }
      mark('erode');
      if (!R.buildRegionsMonotone(ctx, chf, this.border, C.minRegionArea, C.mergeRegionArea)) throw new Error('nav: buildRegions');
      mark('regions');
      cset = R.allocContourSet();
      if (!R.buildContours(ctx, chf, C.maxSimplificationError, C.maxEdgeLen, cset, R.Recast.RC_CONTOUR_TESS_WALL_EDGES)) throw new Error('nav: buildContours');
      pmesh = R.allocPolyMesh();
      if (!R.buildPolyMesh(ctx, cset, C.maxVertsPerPoly, pmesh)) throw new Error('nav: buildPolyMesh');
      mark('contours');
      const polys = pmesh.npolys();
      if (polys === 0) return;
      for (let i = 0; i < polys; i++) pmesh.setFlags(i, FLAG.walk);
      if (C.detail) {
        dmesh = R.allocPolyMeshDetail();
        if (!R.buildPolyMeshDetail(ctx, pmesh, chf, C.detail.sampleDist, C.detail.sampleMaxError, dmesh)) throw new Error('nav: buildPolyMeshDetail');
        mark('detail');
      }
      const P = new R.NavMeshCreateParams();
      P.setPolyMeshCreateParams(pmesh);
      if (dmesh) P.setPolyMeshDetailCreateParams(dmesh);
      P.setWalkableHeight(A.height * C.ch);
      P.setWalkableRadius(A.radius * C.cs);
      P.setWalkableClimb(C.walkableClimb * C.ch);
      P.setCellSize(C.cs);
      P.setCellHeight(C.ch);
      P.setBuildBvTree(true);
      P.setTileX(tx);
      P.setTileY(tz);
      const links = this.linksIn(tx, tz, A);
      if (links.length) P.setOffMeshConnections(links);
      const res = R.createNavMeshData(P);
      P.destroy();
      if (!res.success) throw new Error('nav: createNavMeshData');
      const add = g.navMesh.addTile(res.navMeshData, R.Detour.DT_TILE_FREE_DATA, 0);
      if (R.statusFailed(add.status)) throw new Error(`nav: addTile status ${add.status}`);
      g.polys[tz * this.tw + tx] = polys;
      mark('detour');
    } finally {
      if (chf) R.freeCompactHeightfield(chf);
      if (cset) R.freeContourSet(cset);
      if (pmesh) R.freePolyMesh(pmesh);
      if (dmesh) R.freePolyMeshDetail(dmesh);
    }
  }

  /** the off-mesh links whose start lies in the tile's own square (Detour stores a link in its start's tile) */
  private linksIn(tx: number, tz: number, A: AgentCells) {
    const C = this.cfg, b = this.soup.bounds, tcs = C.tileSize * C.cs, x0 = b.min[0] + tx * tcs, z0 = b.min[2] + tz * tcs;
    const out: { startPosition: { x: number; y: number; z: number }; endPosition: { x: number; y: number; z: number }; radius: number; bidirectional: boolean; area: number; flags: number; userId: number }[] = [];
    this.soup.links.forEach((L, i) => {
      if (L.a[0] < x0 || L.a[0] >= x0 + tcs || L.a[2] < z0 || L.a[2] >= z0 + tcs) return;
      out.push({ startPosition: { x: L.a[0], y: L.a[1], z: L.a[2] }, endPosition: { x: L.b[0], y: L.b[1], z: L.b[2] }, radius: A.radius * C.cs, bidirectional: L.bidirectional, area: AREA.link, flags: FLAG.link, userId: i });
    });
    return out;
  }

  private rasterise(hf: RecastHeightfield, list: number[], walkable: boolean) {
    const R = recast(), n = list.length, tris = new R.IntArray(), areas = new R.UnsignedCharArray();
    try {
      tris.resize(3 * n); areas.resize(n);
      const tv = tris.getHeapView();
      for (let i = 0; i < n; i++) this.soup.triVerts(list[i], tv, 3 * i);
      areas.getHeapView().fill(0);
      const verts = this.soup.vertsArray();
      if (walkable) {
        R.markWalkableTriangles(this.ctx, this.cfg.walkableSlopeAngle, verts, this.soup.vertexCount, tris, n, areas);
        const av = areas.getHeapView();
        for (let i = 0; i < n; i++) av[i] = av[i] === RC_WALKABLE ? this.soup.areaOf(list[i]) : 0;
      }
      if (!R.rasterizeTriangles(this.ctx, verts, this.soup.vertexCount, tris, areas, n, hf, this.cfg.recastClimb)) throw new Error('nav: rasterizeTriangles');
    } finally { tris.destroy(); areas.destroy(); }
  }

  dispose(): void {
    for (const g of this.groups) g.navMesh.destroy();
    this.ctx.destroy();
    this.soup.dispose();
  }
}

function ceilLog2(n: number): number { let b = 0; while ((1 << b) < n) b++; return b; }
