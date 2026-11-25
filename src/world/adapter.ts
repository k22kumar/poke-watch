// The tile adapter (docs/OVERHAUL_3D.md "Migration rules", "WorldModel"): fromArenaMap expresses a tile map as a
// WorldModel, so physics, the three.js renderer and navigation can be built and compared on maps that already pass the
// playability gates. Temporary: deleted with the tile stack at X1b. Nothing in the game reads it before the flags.
//
// It reproduces the column model of sim/world.ts and sim/spatial.ts ("Geometry model") exactly, per tile:
//   ground    a box from the bounds floor (lowest surface − 1 m) to World.height(x, z) with no reference: the elevation,
//             a bridge plank's deckTop, and on a low prop's tile the elevation (the prop is its own box above it)
//   low prop  a box from the elevation to elevation + ArenaMap.platform, flagged foliage when the prop owning the tile
//             (the last prop with a material row, as sim/props.ts PropField.at and spatial.ts Geo.soft) does not block
//             shots
//   stairs    the ramp's sloped plane as trimesh quads (one per run of a flight in a column, merged across columns that
//             share it), over a box to the ramp's lower edge; the wedge between them is left open
//   wall      a wall-prop tile: a box to its wallTopsOf top; a bare wall: a box to the bounds top (highest surface + 8 m).
//             Under a deck the wall ends at the deck's underside (spatial.ts column)
//   deck      ArenaMap.over: a slab from over − DECK_SLAB to over
//   chasm     (LocMeta.chasm) no collider at all, whatever the hazards rule says
//   liquid    open water and lava: no collider (the column model has no bed: every water tile's elevation lies above its
//             surface), a liquid volume from the bounds floor to its level (wlevel, or WATER_Y). Ice is run state
//             (sim/cells.ts), not map data: no tile starts frozen
// Equal neighbouring columns merge greedily into one box (rows first, then down). Surfaces are crude on purpose: tile
// tops and sides, split into chunks by role, positions welded per chunk, no normals and no colour (WM2, WORLDGEN3D Q23;
// I2a styles them).
//
// Contract v2 defaults (WM2), chosen to keep today's meaning:
//   blocksSight   = blocksShots (the tile era's one flag means both)
//   role          per collider and per render chunk, from the terrain or prop it came from. Crude and temporary:
//                   terrain  grass, tall, flowerbed, sand → ground; path → path; dirt → soil; stone → rock;
//                            floor, tatami, wood → floor; water → none (a liquid chunk carries its liquid id); void → none
//                   prop     by its material: stone → cover, wood → trunk, leaf → foliage
//                   ground column, stairs base and ramp   the terrain's role (stairs are stone: rock)
//                   wall tile    a wall prop's role; a bare wall (no prop) → cliff
//                   low prop     the prop's role; a low prop with no material row (Mt. Moon's crate and fossils) is
//                                cover (owner, 2026-11-25, ROADMAP F52), while its collider keeps the terrain name as
//                                material, as on main (F55)
//                   deck         floor (top, underside and rim)
//                   side faces   cliff; on a low prop's or wall prop's tile, the prop's role (a low prop's side segment
//                                only when it lies wholly above the tile's ground, so no face is split)
//                   bed          unused: the tile maps have no bed and the adapter puts nothing under a liquid
//   liquid volume the liquid id ('water', or 'lava' on a lava habitat), one level (no environment states), no bed
//   meta          requestedSeed = seed (the habitat fallback record, ArenaMap.gen.hab.fallback, is not read)
//   empty         spaces, portals, features, breakables, surface cells, the volume-routing graph; every navmesh area 0
//
// No maths beyond + − × ÷ and Math.sqrt (core/detmath's rule), no clock, no RNG: the same map gives the same bytes.
import type { MaterialRole } from '../rules/materialroles';
import { MATERIALS, PROP_MATERIALS, type MaterialId } from '../rules/surfaces';
import { DECK_SLAB, T, WATER_Y, deckTop, stairEdges, wallTopsOf, type ArenaMap } from './tiles';
import { SURFACE_CHUNK, type Aabb, type BoxCollider, type Collider, type LiquidId, type Marker, type SurfaceChunk, type Volume, type WorldModel } from './model';

/** terrain id → name (world/tiles.ts T) */
const TERRAIN_NAME: string[] = [];
for (const [name, id] of Object.entries(T)) TERRAIN_NAME[id] = name;

/** a vent field's reach above the ground: the sim's on-the-ground test (sim/hazards.ts, feet within 0.05 m) */
const HAZARD_REACH = 0.05;
/** the bounds: this far below the lowest surface and above the highest (the brief's numbers) */
const FLOOR_DEPTH = 1, TOP_HEADROOM = 8;

/** terrain name → role (the header's table); null: no role (water draws a liquid chunk; void never stands as ground) */
const TERRAIN_ROLE: Record<keyof typeof T, MaterialRole | null> = {
  grass: 'ground', tall: 'ground', flowerbed: 'ground', sand: 'ground', path: 'path', dirt: 'soil', stone: 'rock',
  floor: 'floor', tatami: 'floor', wood: 'floor', water: null, void: null,
};
/** prop material → role; the other materials are never a prop's */
const PROP_ROLE: Partial<Record<MaterialId, MaterialRole>> = { stone: 'cover', wood: 'trunk', leaf: 'foliage' };

function terrainRole(t: number): MaterialRole {
  const name = TERRAIN_NAME[t] as keyof typeof T, r = TERRAIN_ROLE[name];
  if (!r) throw new Error(`tile adapter: terrain '${name}' has no role`);
  return r;
}
function propRole(mat: MaterialId): MaterialRole {
  const r = PROP_ROLE[mat];
  if (!r) throw new Error(`tile adapter: prop material '${mat}' has no role`);
  return r;
}

interface Rect { i0: number; j0: number; i1: number; j1: number; key: number }

/** greedy rectangles over a key grid (-1 = empty): extend each unused cell east while the key holds, then south while
 *  the whole row segment holds. Row-major, so the result depends only on the grid. */
function mergeRects(keys: Int32Array, W: number, H: number): Rect[] {
  const used = new Uint8Array(W * H), out: Rect[] = [];
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = j * W + i, key = keys[k];
    if (key < 0 || used[k]) continue;
    let i1 = i;
    while (i1 + 1 < W && keys[k + i1 + 1 - i] === key && !used[k + i1 + 1 - i]) i1++;
    let j1 = j;
    grow: while (j1 + 1 < H) {
      const r = (j1 + 1) * W;
      for (let a = i; a <= i1; a++) if (keys[r + a] !== key || used[r + a]) break grow;
      j1++;
    }
    for (let b = j; b <= j1; b++) for (let a = i; a <= i1; a++) used[b * W + a] = 1;
    out.push({ i0: i, j0: j, i1, j1, key });
  }
  return out;
}

/** interns keys (strings) to dense ids in first-seen order, carrying a payload per id */
class Keys<P> {
  private ids = new Map<string, number>();
  readonly data: P[] = [];
  id(key: string, payload: () => P): number {
    let n = this.ids.get(key);
    if (n === undefined) { n = this.data.length; this.ids.set(key, n); this.data.push(payload()); }
    return n;
  }
}

/** growable triangle buffers */
class Tris {
  pos: number[] = []; idx: number[] = [];
  get tris() { return this.idx.length / 3; }
  /** a planar quad from four corners in order around its edge; wound so its normal points along `want` (dot > 0) */
  quad(c: [number, number, number][], want: [number, number, number]) {
    const [a, b, d] = [c[0], c[1], c[2]];
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const flip = nx * want[0] + ny * want[1] + nz * want[2] < 0;
    if (Math.sqrt(nx * nx + ny * ny + nz * nz) === 0) return; // degenerate: dropped, as before
    const base = this.pos.length / 3;
    for (const p of c) this.pos.push(p[0], p[1], p[2]);
    if (flip) this.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    else this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

/** Welds a chunk: one vertex per distinct float32 position (−0 read as +0), first-seen order; the triangles and their
 *  order are unchanged. An open-addressed table over the positions' bit patterns (Math.imul only). */
function weld(pos: number[], idx: number[]): { positions: Float32Array; indices: Uint32Array } {
  const f = Float32Array.from(pos), bits = new Uint32Array(f.buffer), nv = f.length / 3;
  for (let a = 0; a < f.length; a++) if (f[a] === 0) f[a] = 0;
  let cap = 16;
  while (cap < nv * 2) cap *= 2;
  const table = new Int32Array(cap).fill(-1), remap = new Uint32Array(nv), keep = new Uint32Array(nv);
  let out = 0;
  for (let v = 0; v < nv; v++) {
    const x = bits[v * 3], y = bits[v * 3 + 1], z = bits[v * 3 + 2];
    let h = Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca77) ^ Math.imul(z, 0xc2b2ae3d);
    h = (h ^ (h >>> 15)) & (cap - 1);
    for (;;) {
      const w = table[h];
      if (w < 0) { table[h] = out; keep[out] = v; remap[v] = out++; break; }
      const q = keep[w] * 3;
      if (bits[q] === x && bits[q + 1] === y && bits[q + 2] === z) { remap[v] = w; break; }
      h = (h + 1) & (cap - 1);
    }
  }
  const positions = new Float32Array(out * 3);
  for (let w = 0; w < out; w++) { const q = keep[w] * 3; positions[w * 3] = f[q]; positions[w * 3 + 1] = f[q + 1]; positions[w * 3 + 2] = f[q + 2]; }
  const indices = new Uint32Array(idx.length);
  for (let t = 0; t < idx.length; t++) indices[t] = remap[idx[t]];
  return { positions, indices };
}

const UP: [number, number, number] = [0, 1, 0], DOWN: [number, number, number] = [0, -1, 0];

/** The tile map as a WorldModel (docs/OVERHAUL_3D.md). Pure: reads the map, never writes it. */
/** the meta.source prefixes fromArenaMap writes (arena, habitat, location, region) */
export const ADAPTER_SOURCES = ['arena:', 'habitat:', 'location:', 'region:'] as const;
/** a WorldModel the tile adapter made (its meta.source is one of ADAPTER_SOURCES); a generated mesh world (G1) is not */
export function isAdapterModel(model: { readonly meta?: { readonly source: string } }): boolean {
  const s = model.meta?.source;
  return s !== undefined && ADAPTER_SOURCES.some((p) => s.startsWith(p));
}

export function fromArenaMap(m: ArenaMap): WorldModel {
  const W = m.w, H = m.h, n = W * H, hx = W / 2, hz = H / 2;
  const top = wallTopsOf(m);
  const voids = new Uint8Array(n);
  for (const k of m.gen?.loc?.chasm ?? []) voids[k] = 1;
  const lava = m.gen?.hab?.medium === 'lava', liquid: LiquidId = lava ? 'lava' : 'water';

  // the prop owning each tile: the last prop with a material row covering it (sim/props.ts PropField.at)
  const owner = new Int32Array(n).fill(-1);
  m.props.forEach((p, idx) => {
    if (!PROP_MATERIALS[p.kind]) return;
    for (let j = p.y; j < p.y + p.h; j++) for (let i = p.x; i < p.x + p.w; i++) if (i >= 0 && j >= 0 && i < W && j < H) owner[j * W + i] = idx;
  });
  const ownMat = (k: number) => (owner[k] >= 0 ? PROP_MATERIALS[m.props[owner[k]].kind]!.mat : '');
  const soft = (k: number) => owner[k] >= 0 && !MATERIALS[PROP_MATERIALS[m.props[owner[k]].kind]!.mat].blocksShots;
  const destructible = (k: number) => (owner[k] >= 0 && PROP_MATERIALS[m.props[owner[k]].kind]!.integrity > 0 ? owner[k] : -1);
  /** a wall tile's role: its wall prop's, or cliff for a bare wall */
  const wallRole = (k: number): MaterialRole => (owner[k] >= 0 ? propRole(PROP_MATERIALS[m.props[owner[k]].kind]!.mat) : 'cliff');
  /** a low prop's role: its prop's, or cover when no prop with a material row owns it (F52) */
  const platRole = (k: number): MaterialRole => (owner[k] >= 0 ? propRole(PROP_MATERIALS[m.props[owner[k]].kind]!.mat) : 'cover');

  // per tile: what kind of column it is, and its ground surface (World.height with no reference, at the tile centre)
  const KIND = { void: 0, wall: 1, stairs: 2, water: 3, ground: 4 } as const;
  const kind = new Uint8Array(n), ground = new Float64Array(n), lvl = new Float64Array(n);
  const rampA = new Float64Array(n), rampB = new Float64Array(n); // stairs: heights at the tile's north and south edges
  let lo = Infinity, hi = -Infinity;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = j * W + i, t = m.terrain[k], e = m.elev[k];
    lo = Math.min(lo, e); hi = Math.max(hi, e);
    if (t === T.water) { lvl[k] = m.wlevel ? m.wlevel[k] : WATER_Y; lo = Math.min(lo, lvl[k]); hi = Math.max(hi, lvl[k]); }
    if (m.over && m.over[k] > 0) hi = Math.max(hi, m.over[k]);
    if (voids[k]) { kind[k] = KIND.void; continue; }
    if (m.wall[k] === 1) { kind[k] = KIND.wall; continue; }
    if (m.stairs[k]) {
      const [a, b] = stairEdges(m, i, j);
      rampA[k] = a; rampB[k] = b;
      kind[k] = KIND.stairs; ground[k] = Math.min(a, b);
      lo = Math.min(lo, ground[k]); hi = Math.max(hi, a, b);
      continue;
    }
    if (t === T.water) { kind[k] = KIND.water; ground[k] = lvl[k]; continue; }
    kind[k] = KIND.ground;
    ground[k] = t === T.wood ? deckTop(e) : e;
    hi = Math.max(hi, ground[k] + (t === T.wood ? 0 : m.platform[k]));
  }
  if (lo === Infinity) { lo = 0; hi = 0; }
  const floor = lo - FLOOR_DEPTH, ceil = hi + TOP_HEADROOM;
  const bounds: Aabb = { min: [-hx, floor, -hz], max: [hx, ceil, hz] };
  const wx = (i: number) => i - hx, wz = (j: number) => j - hz;
  const deckAt = (k: number) => (m.over && m.over[k] > 0 ? m.over[k] : 0);
  const hasPlatform = (k: number) => kind[k] === KIND.ground && m.terrain[k] !== T.wood && m.platform[k] > 0;
  /** the top of the wall column at k (wall tiles) */
  const wallCap = (k: number) => {
    let c = top[k] === Infinity ? ceil : top[k];
    const ov = deckAt(k);
    if (ov > 0 && ov - DECK_SLAB < c) c = ov - DECK_SLAB;
    return c;
  };

  const colliders: Collider[] = [];
  const box = (r: Rect, y0: number, y1: number, material: string, role: MaterialRole, blocks: boolean, foliage: boolean, d: number): BoxCollider => {
    const x0 = wx(r.i0), x1 = wx(r.i1 + 1), z0 = wz(r.j0), z1 = wz(r.j1 + 1);
    const b: BoxCollider = { shape: 'box', centre: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], half: [(x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2], yaw: 0, material, blocksShots: blocks, foliage, role, blocksSight: blocks };
    if (d >= 0) b.destructible = d;
    return b;
  };
  const nav = new Tris();
  const navTop = (r: Rect, y: number) => {
    const x0 = wx(r.i0), x1 = wx(r.i1 + 1), z0 = wz(r.j0), z1 = wz(r.j1 + 1);
    nav.quad([[x0, y, z0], [x0, y, z1], [x1, y, z1], [x1, y, z0]], UP);
  };

  // ground and wall columns (one per tile, from the floor): merged by kind, top, material, role, flags and destructible id
  interface Col { top: number; material: string; role: MaterialRole; blocks: boolean; foliage: boolean; d: number; walk: boolean }
  const colKeys = new Keys<Col>(), col = new Int32Array(n).fill(-1);
  for (let k = 0; k < n; k++) {
    const kd = kind[k];
    if (kd === KIND.void || kd === KIND.water) continue;
    const terr = TERRAIN_NAME[m.terrain[k]];
    if (kd === KIND.wall) {
      const c = wallCap(k), mat = ownMat(k) || terr, role = wallRole(k), s = soft(k), d = destructible(k);
      col[k] = colKeys.id(`w|${c}|${mat}|${role}|${s}|${d}`, () => ({ top: c, material: mat, role, blocks: !s, foliage: s, d, walk: false }));
    } else {
      // a stairs base and the ground under a low prop are not walkable faces (the ramp and the prop are)
      const walk = kd === KIND.ground && !hasPlatform(k), g = ground[k];
      col[k] = colKeys.id(`g|${g}|${terr}|${walk}`, () => ({ top: g, material: terr, role: terrainRole(m.terrain[k]), blocks: true, foliage: false, d: -1, walk }));
    }
  }
  for (const r of mergeRects(col, W, H)) {
    const c = colKeys.data[r.key];
    colliders.push(box(r, floor, c.top, c.material, c.role, c.blocks, c.foliage, c.d));
    if (c.walk) navTop(r, c.top);
  }

  // low props: from the elevation to the platform height
  interface Plat { y0: number; y1: number; material: string; role: MaterialRole; foliage: boolean; d: number }
  const platKeys = new Keys<Plat>(), plat = new Int32Array(n).fill(-1);
  for (let k = 0; k < n; k++) {
    if (!hasPlatform(k)) continue;
    const y0 = m.elev[k], y1 = y0 + m.platform[k], mat = ownMat(k) || TERRAIN_NAME[m.terrain[k]], role = platRole(k), s = soft(k), d = destructible(k);
    plat[k] = platKeys.id(`${y0}|${y1}|${mat}|${role}|${s}|${d}`, () => ({ y0, y1, material: mat, role, foliage: s, d }));
  }
  for (const r of mergeRects(plat, W, H)) {
    const p = platKeys.data[r.key];
    colliders.push(box(r, p.y0, p.y1, p.material, p.role, !p.foliage, p.foliage, p.d));
    navTop(r, p.y1);
  }

  // decks: slabs under their top
  const deckKeys = new Keys<number>(), deck = new Int32Array(n).fill(-1);
  for (let k = 0; k < n; k++) { const ov = deckAt(k); if (ov > 0) deck[k] = deckKeys.id(String(ov), () => ov); }
  for (const r of mergeRects(deck, W, H)) {
    const ov = deckKeys.data[r.key];
    colliders.push(box(r, ov - DECK_SLAB, ov, 'wood', 'floor', true, false, -1));
    navTop(r, ov);
  }

  // stairs ramps: per column, each run of consecutive stairs tiles is one plane (stairEdges is linear along a flight);
  // runs with the same rows, heights and material in neighbouring columns merge into one quad
  interface Ramp { j0: number; j1: number; a: number; b: number; material: string; role: MaterialRole }
  const rampKeys = new Keys<Ramp>(), ramp = new Int32Array(n).fill(-1);
  for (let i = 0; i < W; i++) for (let j = 0; j < H; j++) {
    const k = j * W + i;
    if (kind[k] !== KIND.stairs || ramp[k] >= 0) continue;
    const mat = TERRAIN_NAME[m.terrain[k]];
    let j1 = j;
    while (j1 + 1 < H && kind[(j1 + 1) * W + i] === KIND.stairs && m.stairs[(j1 + 1) * W + i] && TERRAIN_NAME[m.terrain[(j1 + 1) * W + i]] === mat) j1++;
    const a = rampA[k], b = rampB[j1 * W + i];
    const id = rampKeys.id(`${j}|${j1}|${a}|${b}|${mat}`, () => ({ j0: j, j1, a, b, material: mat, role: terrainRole(m.terrain[k]) }));
    for (let q = j; q <= j1; q++) ramp[q * W + i] = id;
  }
  // a ramp key names its rows, so merging can only widen it across columns
  const rampTris = new Map<string, { role: MaterialRole; t: Tris }>();
  for (const r of mergeRects(ramp, W, H)) {
    const R = rampKeys.data[r.key];
    let t = rampTris.get(R.material)?.t;
    if (!t) rampTris.set(R.material, { role: R.role, t: (t = new Tris()) });
    const x0 = wx(r.i0), x1 = wx(r.i1 + 1), z0 = wz(R.j0), z1 = wz(R.j1 + 1);
    const c: [number, number, number][] = [[x0, R.a, z0], [x0, R.b, z1], [x1, R.b, z1], [x1, R.a, z0]];
    t.quad(c, UP);
    nav.quad(c, UP);
  }
  for (const [material, { role, t }] of rampTris) colliders.push({ shape: 'trimesh', positions: Float32Array.from(t.pos), indices: Uint32Array.from(t.idx), material, blocksShots: true, foliage: false, role, blocksSight: true });

  // volumes: liquids (every water tile, as World.liquidAt reads them) and vent fields
  const volumes: Volume[] = [];
  const liqKeys = new Keys<number>(), liq = new Int32Array(n).fill(-1);
  for (let k = 0; k < n; k++) if (m.terrain[k] === T.water) { const L = lvl[k]; liq[k] = liqKeys.id(String(L), () => L); }
  for (const r of mergeRects(liq, W, H)) {
    const L = liqKeys.data[r.key];
    volumes.push({ kind: 'liquid', box: { min: [wx(r.i0), floor, wz(r.j0)], max: [wx(r.i1 + 1), L, wz(r.j1 + 1)] }, level: L, element: lava ? 'blaze' : 'tide', liquid });
  }
  const hazKeys = new Keys<number>(), haz = new Int32Array(n).fill(-1);
  for (const k of m.gen?.hab?.hazard ?? []) { const g = surfaceAt(k); haz[k] = hazKeys.id(String(g), () => g); }
  for (const r of mergeRects(haz, W, H)) {
    const g = hazKeys.data[r.key];
    volumes.push({ kind: 'hazard', box: { min: [wx(r.i0), g, wz(r.j0)], max: [wx(r.i1 + 1), g + HAZARD_REACH, wz(r.j1 + 1)] }, element: 'blaze' });
  }

  /** the standable ground at tile k with no reference (World.height at its centre; a wall's top; a chasm's floor) */
  function surfaceAt(k: number): number {
    switch (kind[k]) {
      case KIND.void: return floor;
      case KIND.wall: return wallCap(k);
      case KIND.stairs: return (rampA[k] + rampB[k]) / 2;
      case KIND.water: return lvl[k];
      default: return ground[k] + (hasPlatform(k) ? m.platform[k] : 0);
    }
  }

  // markers
  const markers: Marker[] = [];
  const at = (x: number, z: number): [number, number, number] => {
    const i = Math.min(W - 1, Math.max(0, Math.floor(x + hx))), j = Math.min(H - 1, Math.max(0, Math.floor(z + hz)));
    return [x, surfaceAt(j * W + i), z];
  };
  const tileAt = (i: number, j: number) => at(wx(i) + 0.5, wz(j) + 0.5);
  markers.push({ kind: 'spawn', position: tileAt(m.spawn[0], m.spawn[1]) });
  const hab = m.gen?.hab;
  if (hab) {
    markers.push({ kind: 'staging', name: 'A', position: at(hab.stage.A[0] - hx, hab.stage.A[1] - hz) });
    markers.push({ kind: 'staging', name: 'B', position: at(hab.stage.B[0] - hx, hab.stage.B[1] - hz) });
    markers.push({ kind: 'contest', position: at(hab.contest.x - hx, hab.contest.y - hz), radius: hab.contest.r, height: hab.contest.h });
  }
  for (const [x, y] of m.throwables ?? []) markers.push({ kind: 'body', position: tileAt(x, y) });
  for (const [x, y] of m.gen?.loc?.bodySpots ?? []) markers.push({ kind: 'body', position: tileAt(x, y) });
  for (const [x, y] of m.gen?.loc?.anchors ?? []) markers.push({ kind: 'anchor', position: tileAt(x, y) });
  for (const L of m.landmarks) markers.push({ kind: 'landmark', name: L.name, position: tileAt(L.x, L.y) });

  // surfaces: per tile, its solid intervals (bottom, top); a side face is the part of an interval its neighbour's
  // column does not cover. Liquids occlude their banks up to the surface but draw only that surface. Chunks split by
  // role (a liquid chunk by its liquid), then are welded.
  const solids = (k: number, out: number[]) => {
    out.length = 0;
    const kd = kind[k];
    if (kd === KIND.wall) out.push(floor, wallCap(k));
    else if (kd === KIND.stairs) out.push(floor, (rampA[k] + rampB[k]) / 2);
    else if (kd === KIND.water) out.push(floor, lvl[k]);
    else if (kd === KIND.ground) out.push(floor, surfaceAt(k));
    const ov = deckAt(k);
    if (ov > 0) out.push(ov - DECK_SLAB, ov);
  };
  const chunks = new Map<string, { cx: number; cz: number; role: MaterialRole | null; t: Tris }>();
  /** the chunk of tile (i, j) for a role; null: the liquid chunk */
  const chunkOf = (i: number, j: number, role: MaterialRole | null) => {
    const cx = Math.floor(i / SURFACE_CHUNK), cz = Math.floor(j / SURFACE_CHUNK), key = `${cz}|${cx}|${role ?? ''}`;
    let c = chunks.get(key);
    if (!c) chunks.set(key, (c = { cx, cz, role, t: new Tris() }));
    return c.t;
  };
  const A: number[] = [], B: number[] = [];
  const DIRS: [number, number, [number, number, number]][] = [[1, 0, [1, 0, 0]], [-1, 0, [-1, 0, 0]], [0, 1, [0, 0, 1]], [0, -1, [0, 0, -1]]];
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = j * W + i, kd = kind[k];
    const x0 = wx(i), x1 = x0 + 1, z0 = wz(j), z1 = z0 + 1;
    if (kd === KIND.water || (m.terrain[k] === T.water && kd !== KIND.wall)) {
      chunkOf(i, j, null).quad([[x0, lvl[k], z0], [x0, lvl[k], z1], [x1, lvl[k], z1], [x1, lvl[k], z0]], UP);
    }
    if (kd === KIND.water && !(deckAt(k) > 0)) continue;
    const plat = hasPlatform(k);
    /** the role of this tile's column top and of its side faces (the deck interval aside) */
    const topRole: MaterialRole | null = kd === KIND.wall ? wallRole(k) : kd === KIND.stairs ? terrainRole(m.terrain[k]) : kd === KIND.ground ? (plat ? platRole(k) : terrainRole(m.terrain[k])) : null;
    const sideRole: MaterialRole = kd === KIND.wall ? wallRole(k) : 'cliff';
    // tops
    if (kd === KIND.stairs) chunkOf(i, j, topRole).quad([[x0, rampA[k], z0], [x0, rampB[k], z1], [x1, rampB[k], z1], [x1, rampA[k], z0]], UP);
    else if (kd === KIND.wall || kd === KIND.ground) {
      const y = surfaceAt(k);
      chunkOf(i, j, topRole).quad([[x0, y, z0], [x0, y, z1], [x1, y, z1], [x1, y, z0]], UP);
    }
    const ov = deckAt(k);
    if (ov > 0) {
      const u = ov - DECK_SLAB, t = chunkOf(i, j, 'floor');
      t.quad([[x0, ov, z0], [x0, ov, z1], [x1, ov, z1], [x1, ov, z0]], UP);
      t.quad([[x0, u, z0], [x0, u, z1], [x1, u, z1], [x1, u, z0]], DOWN);
    }
    // sides
    solids(k, A);
    if (kd === KIND.water) A.splice(0, 2); // a liquid draws no banks of its own
    for (const [di, dj, nrm] of DIRS) {
      const ni = i + di, nj = j + dj;
      if (ni >= 0 && nj >= 0 && ni < W && nj < H) solids(nj * W + ni, B); else B.length = 0;
      for (let a = 0; a < A.length; a += 2) {
        const isDeck = ov > 0 && a === A.length - 2;
        // subtract every neighbour interval from [A[a], A[a+1]]
        let segs = [A[a], A[a + 1]];
        for (let b = 0; b < B.length; b += 2) {
          const next: number[] = [];
          for (let s = 0; s < segs.length; s += 2) {
            const s0 = segs[s], s1 = segs[s + 1];
            if (B[b + 1] <= s0 || B[b] >= s1) { next.push(s0, s1); continue; }
            if (B[b] > s0) next.push(s0, B[b]);
            if (B[b + 1] < s1) next.push(B[b + 1], s1);
          }
          segs = next;
        }
        for (let s = 0; s < segs.length; s += 2) {
          const y0 = segs[s], y1 = segs[s + 1];
          if (y1 - y0 <= 0) continue;
          const ex = di > 0 ? x1 : x0, ez = dj > 0 ? z1 : z0;
          // a low prop's side: only a segment wholly above the tile's ground (the rest is the ground's cliff)
          const t = chunkOf(i, j, isDeck ? 'floor' : plat && y0 >= ground[k] ? topRole : sideRole);
          if (di !== 0) t.quad([[ex, y0, z0], [ex, y0, z1], [ex, y1, z1], [ex, y1, z0]], nrm);
          else t.quad([[x0, y0, ez], [x1, y0, ez], [x1, y1, ez], [x0, y1, ez]], nrm);
        }
      }
    }
  }
  const surfaces: SurfaceChunk[] = [];
  for (const c of chunks.values()) {
    const { positions, indices } = weld(c.t.pos, c.t.idx);
    surfaces.push(c.role ? { cx: c.cx, cz: c.cz, material: 'terrain', positions, indices, role: c.role } : { cx: c.cx, cz: c.cz, material: 'liquid', positions, indices, liquid });
  }

  const g = m.gen;
  const source = g?.hab ? `habitat:${g.hab.recipe}${g.hab.variant ? ':' + g.hab.variant : ''}` : g?.loc ? `location:${g.loc.id}` : g ? `region:${m.id}` : `arena:${m.id}`;
  return {
    meta: { source, id: m.id, name: m.name, seed: g ? g.seed : 0, version: g ? g.version : 0, requestedSeed: g ? g.seed : 0 },
    bounds,
    colliders,
    volumes,
    navInput: { positions: Float32Array.from(nav.pos), indices: Uint32Array.from(nav.idx), links: [], areas: new Uint8Array(nav.tris), routes: { nodes: [], edges: [] } },
    surfaces,
    markers,
    spaces: [],
    portals: [],
    features: [],
    breakables: [],
    cells: [],
  };
}
