// The sim's physics bridge (task I1a; docs/OVERHAUL_3D.md "World seam" Q14): with rules.physics.engine = 'rapier' the
// world half of every ray, sweep, line of sight and overlap sight line is answered by src/physics (Rapier) instead of
// the tile column model, at the two swap points: worldOf(ctx) returns a PhysicsSeam (its ray members on physics, every
// other member forwarded to the tile World unchanged), and sim/spatial.ts's sweeps and overlaps call castWorld here.
// Movement, support, liquids for bodies and navigation stay on the tile World (I1b, I3 move them).
//
// The physics world is built from the tile adapter's WorldModel (world/adapter.ts fromArenaMap) of the World's live map
// state, plus the column model's pieces the adapter's colliders leave out (query-only, tile-legacy, deleted at X1b; the
// kind table stays until generated colliders say which world kind they are: WM2's `role` is a material role, and a
// `cliff` face can be ground or wall):
//   kinds        the SK kind of each adapter collider, read off the tile under its first cell (walls, decks, terrain)
//   wall caps    a wall prop is solid to its measured top only with QF.tops (R1b); without it the column goes on up (to
//                a deck's underside, else past the bounds): a query-only box above the top, in the untopped modes
//   bare walls   a bare wall's column goes on past the adapter's bounds top
//   soft ground  under a foliage wall tile, the ground to its elevation, for the modes where foliage is open
//   stair wedges the solid between a ramp's plane and its base box (the adapter leaves the wedge open)
// The tile World's geometry changes at run time (a prop burns or breaks: World.setBlock; the tide: setTide; water
// freezes or thaws: refreshNav), and each bumps World.geoGen: the physics world is rebuilt from the live map at the
// next query after a change (counted in `rebuilds`). Ice is read from the cells (a frozen tile is terrain at the ice),
// chasms from World.isVoid (the tile World makes them voids only with hazards on).
//
// Ownership: the bridge owns its PhysicsWorld; reset() and dispose() free it (sim/run.ts disposeRun; S1 O7).

import { PhysicsWorld, STOPS, MODES_ALL, MODES_UNTOPPED, MODES_FOLIAGE_OPEN, modesOf, EDGE_PAD, type ExtraPiece } from '../physics/world';
import { fromArenaMap } from '../world/adapter';
import { rapier, rapierReady } from '../physics/rapier';
import { DECK_SLAB, ICE_LIFT, T, WATER_Y, stairEdges, wallTopsOf, type ArenaMap } from '../world/tiles';
import { SK, SK_WORLD, QF_WORLD, type RayHit } from '../world/sight';
import type { WorldModel } from '../world/model';
import type { NavGoal, RefY, TileExt, WorldQuery } from './worldquery';

/** a cast with Infinity as its length goes this far (m) */
const FAR = 1e4;

/** The live tile state as an ArenaMap the adapter reads: ice as ground at the ice, the World's voids as the chasm list
 *  (the adapter makes every listed chasm a void, the tile World only with hazards on). Copies only what it changes. */
export function liveMap(T0: TileExt): ArenaMap {
  const m = T0.map, n = m.w * m.h;
  let terrain = m.terrain, elev = m.elev, platform = m.platform;
  for (let k = 0; k < n; k++) {
    if (m.terrain[k] !== T.water || !T0.cells.iceAt(k)) continue;
    if (terrain === m.terrain) { terrain = m.terrain.slice(); elev = m.elev.slice(); platform = m.platform.slice(); }
    terrain[k] = T.stone; elev[k] = (m.wlevel ? m.wlevel[k] : WATER_Y) + ICE_LIFT; platform[k] = 0;
  }
  const chasm: number[] = [];
  for (let k = 0; k < n; k++) if (T0.isVoid(k)) chasm.push(k);
  const was = m.gen?.loc?.chasm ?? [];
  const sameChasm = was.length === chasm.length && was.every((v, i) => v === chasm[i]);
  const over = T0.over ?? m.over;
  if (terrain === m.terrain && sameChasm && over === m.over) return m;
  const out: ArenaMap = { ...m, terrain, elev, platform, over: over ?? undefined };
  if (!sameChasm) {
    const g = m.gen ?? ({ seed: 0, version: 0 } as unknown as NonNullable<ArenaMap['gen']>);
    out.gen = { ...g, loc: { ...(g.loc ?? { id: 'synthetic', anchors: [], bodySpots: [] }), chasm } } as never;
  }
  return out;
}

/** The query-side extras for an adapter model of map m: each collider's SK kind and the column model's missing pieces. */
export function tileExtras(m: ArenaMap, model: WorldModel): { kinds: Uint8Array; pieces: ExtraPiece[] } {
  const W = m.w, H = m.h, hx = W / 2, hz = H / 2, floor = model.bounds.min[1], ceil = model.bounds.max[1];
  const voids = new Set(m.gen?.loc?.chasm ?? []);
  const over = (k: number) => (m.over && m.over[k] > 0 ? m.over[k] : 0);
  const kinds = new Uint8Array(model.colliders.length);
  const eps = 1e-6;
  model.colliders.forEach((c, i) => {
    if (c.shape !== 'box') { kinds[i] = SK.terrain; return; }
    const i0 = Math.round(c.centre[0] - c.half[0] + hx), j0 = Math.round(c.centre[2] - c.half[2] + hz);
    const k = j0 * W + i0, y0 = c.centre[1] - c.half[1], y1 = c.centre[1] + c.half[1];
    if (Math.abs(y0 - floor) < eps) kinds[i] = m.wall[k] === 1 && !voids.has(k) ? SK.wall : SK.terrain;
    else if (over(k) > 0 && Math.abs(y1 - over(k)) < eps && Math.abs(y0 - (over(k) - DECK_SLAB)) < eps) kinds[i] = SK.deck;
    else kinds[i] = SK.terrain;
  });

  // per-tile pieces, merged greedily per key (rows first, then down; the adapter's rule)
  const pieces: ExtraPiece[] = [];
  const top = wallTopsOf(m), sky = ceil + EDGE_PAD;
  const keys = new Map<string, number>(), payload: { y0: number; y1: number; kind: number; modes: number }[] = [];
  const grid = new Int32Array(W * H).fill(-1);
  const put = (y0: number, y1: number, kind: number, modes: number) => {
    const key = `${y0}|${y1}|${kind}|${modes}`;
    let id = keys.get(key);
    if (id === undefined) { id = payload.length; keys.set(key, id); payload.push({ y0, y1, kind, modes }); }
    return id;
  };
  // foliage wall tiles
  // (the adapter's own soft rule, read back from its wall colliders' foliage flag per tile)
  const softOf = new Uint8Array(W * H);
  model.colliders.forEach((c, i) => {
    if (c.shape !== 'box' || kinds[i] !== SK.wall || !c.foliage) return;
    const i0 = Math.round(c.centre[0] - c.half[0] + hx), j0 = Math.round(c.centre[2] - c.half[2] + hz);
    const i1 = Math.round(c.centre[0] + c.half[0] + hx), j1 = Math.round(c.centre[2] + c.half[2] + hz);
    for (let j = j0; j < j1; j++) for (let ii = i0; ii < i1; ii++) softOf[j * W + ii] = 1;
  });
  const wallModes = (k: number) => (softOf[k] ? modesOf(false, false, true) : MODES_ALL);
  // pass 1: the column above a wall's adapter top (wall caps and bare walls)
  for (let k = 0; k < W * H; k++) {
    if (m.wall[k] !== 1 || voids.has(k)) continue;
    const ov = over(k), under = ov > 0 ? ov - DECK_SLAB : sky;
    const adapterTop = Math.min(top[k] === Infinity ? ceil : top[k], ov > 0 ? ov - DECK_SLAB : Infinity);
    if (!(under > adapterTop)) continue;
    const modes = wallModes(k) & (top[k] === Infinity ? MODES_ALL : MODES_UNTOPPED);
    grid[k] = put(adapterTop, under, SK.wall, modes);
  }
  mergeInto(grid, W, H, payload, pieces, hx, hz);
  // pass 2: the ground under a foliage wall (open foliage leaves the tile's own ground)
  grid.fill(-1);
  for (let k = 0; k < W * H; k++) {
    if (!softOf[k] || m.stairs[k] || m.terrain[k] === T.water) continue;
    const e = m.elev[k], g = m.terrain[k] === T.wood ? (e > 0.05 ? e : 0.05) : e;
    if (!(g > floor)) continue;
    grid[k] = put(floor, g, SK.terrain, MODES_FOLIAGE_OPEN);
  }
  mergeInto(grid, W, H, payload, pieces, hx, hz);
  // stair wedges: the prism between the ramp's plane and the base box at its lower edge
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = j * W + i;
    if (!m.stairs[k] || m.wall[k] === 1 || voids.has(k)) continue;
    const [a, b] = stairEdges(m, i, j), base = Math.min(a, b);
    if (!(Math.abs(a - b) > 1e-9)) continue;
    const x0 = i - hx, x1 = x0 + 1, z0 = j - hz, z1 = z0 + 1;
    pieces.push({ kind: SK.terrain, modes: MODES_ALL, hull: Float32Array.from([
      x0, base, z0, x1, base, z0, x0, base, z1, x1, base, z1,
      x0, a, z0, x1, a, z0, x0, b, z1, x1, b, z1,
    ]) });
  }
  return { kinds, pieces };
}

/** greedy rectangles over a key grid into box pieces */
function mergeInto(grid: Int32Array, W: number, H: number, payload: { y0: number; y1: number; kind: number; modes: number }[], out: ExtraPiece[], hx: number, hz: number) {
  const used = new Uint8Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = j * W + i, key = grid[k];
    if (key < 0 || used[k]) continue;
    let i1 = i;
    while (i1 + 1 < W && grid[k + i1 + 1 - i] === key && !used[k + i1 + 1 - i]) i1++;
    let j1 = j;
    grow: while (j1 + 1 < H) {
      const r = (j1 + 1) * W;
      for (let a = i; a <= i1; a++) if (grid[r + a] !== key || used[r + a]) break grow;
      j1++;
    }
    for (let b = j; b <= j1; b++) for (let a = i; a <= i1; a++) used[b * W + a] = 1;
    const p = payload[key];
    out.push({ min: [i - hx, p.y0, j - hz], max: [i1 + 1 - hx, p.y1, j1 + 1 - hz], kind: p.kind, modes: p.modes });
  }
}

/** Build the physics world of a tile World's current state (the adapter's model and the tile extras). */
export function buildTilePhysics(T0: TileExt): PhysicsWorld {
  const m = liveMap(T0), model = fromArenaMap(m);
  return PhysicsWorld.build(model, tileExtras(m, model));
}

/** The bridge a run with rules.physics.engine = 'rapier' carries (SimContext.physics). */
export class PhysicsBridge {
  constructor() {
    if (!rapierReady()) rapier(); // throws the init message: Rapier loads once, asynchronously, before createRun
  }
  private W: WorldQuery | null = null;
  private T: TileExt | null = null;
  private gen = -1;
  private seam: PhysicsSeam | null = null;
  /** the current physics world (null until the first query, and after reset or dispose) */
  physics: PhysicsWorld | null = null;
  /** physics worlds built (map entries and live geometry changes) */
  rebuilds = 0;

  /** the physics world for tile world w, built or rebuilt when w or its geometry changed */
  worldFor(w: WorldQuery): PhysicsWorld {
    const t = w.tiles;
    if (w !== this.W || t !== this.T || t.geoGen !== this.gen || !this.physics) {
      this.physics?.dispose();
      this.physics = buildTilePhysics(t);
      this.rebuilds++;
      if (w !== this.W) this.seam = null;
      this.W = w; this.T = t; this.gen = t.geoGen;
    }
    return this.physics;
  }

  /** the WorldQuery the systems see for tile world w (worldOf's swap) */
  seamFor(w: WorldQuery): WorldQuery {
    if (w !== this.W || !this.seam) { this.worldFor(w); this.seam = new PhysicsSeam(w, this); }
    return this.seam;
  }

  /** sim/spatial.ts's world contact: the cast in (o, d, maxT, r, h) against w's physics (shots stop it) */
  castWorld(w: WorldQuery, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number, r: number, h: number, mask: number, flags: number, hit: RayHit, stops: number = STOPS.shots): boolean {
    if (maxT === Infinity) maxT = FAR;
    return this.worldFor(w).cast(ox, oy, oz, dx, dy, dz, maxT, mask & SK_WORLD, flags, stops, hit, r, h);
  }

  /** the physics world's state as bytes (S1 O8; tests/physics.test.ts round-trips it) */
  snapshot(): Uint8Array {
    if (!this.physics) throw new Error('physics: no world to snapshot');
    return this.physics.snapshot();
  }

  /** replace the current physics world with one restored from `bytes` (a snapshot of the same map and geometry) */
  restore(bytes: Uint8Array): void {
    const old = this.physics;
    if (!old) throw new Error('physics: no world to restore over');
    this.physics = PhysicsWorld.restore(bytes, old);
    old.dispose();
  }

  /** free the physics world (a map change; the next query builds the new one) */
  reset(): void {
    this.physics?.dispose();
    this.physics = null; this.W = null; this.T = null; this.seam = null; this.gen = -1;
  }

  dispose(): void { this.reset(); }
}

/** The tile World's WorldQuery with its rays on physics: every other member is forwarded unchanged. */
export class PhysicsSeam implements WorldQuery {
  constructor(private readonly w: WorldQuery, private readonly bridge: PhysicsBridge) {}
  get bound() { return this.w.bound; }
  get killY() { return this.w.killY; }
  get spawn() { return this.w.spawn; }
  get anchors() { return this.w.anchors; }
  get tiles(): TileExt { return this.w.tiles; }
  surfaceAt(x: number, y: RefY, z: number): number { return this.w.surfaceAt(x, y, z); }
  supportAt(x: number, y: RefY, z: number): number { return this.w.supportAt(x, y, z); }
  liquidContact(x: number, y: number, z: number, contact: number): number { return this.w.liquidContact(x, y, z, contact); }
  headroomOver(x: number, y: number, z: number, r: number): number { return this.w.headroomOver(x, y, z, r); }
  moveFootprint(x: number, y: number, z: number, dx: number, dz: number, step: number, r: number, out: [number, number], stop?: (x: number, z: number) => boolean, tall?: number, over?: boolean): void {
    this.w.moveFootprint(x, y, z, dx, dz, step, r, out, stop, tall, over);
  }
  solidFor(x: number, y: number, z: number, step: number, tall?: number, over?: boolean): boolean { return this.w.solidFor(x, y, z, step, tall, over); }
  blockedFor(x: number, y: number, z: number, step: number, tall?: number, over?: boolean): boolean { return this.w.blockedFor(x, y, z, step, tall, over); }
  fitsAt(x: number, y: number, z: number, r: number, step?: number, tall?: number, over?: boolean): boolean { return this.w.fitsAt(x, y, z, r, step, tall, over); }
  topBelow(x: number, y: number, z: number, r: number): number { return this.w.topBelow(x, y, z, r); }
  insideRock(x: number, y: number, z: number, over?: boolean): boolean { return this.w.insideRock(x, y, z, over); }
  // ---- on physics: shots stop raycast and solidAt, sight stops segmentClear and sight
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number, mask: number, hit: RayHit, r = 0, h = 0, flags = 0): boolean {
    return this.bridge.castWorld(this.w, ox, oy, oz, dx, dy, dz, maxT, r, h, mask, flags, hit);
  }
  segmentClear(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mask: number = SK_WORLD, flags = 0): boolean {
    return this.bridge.worldFor(this.w).clear(x0, y0, z0, x1, y1, z1, mask & SK_WORLD, flags & QF_WORLD, STOPS.sight);
  }
  solidAt(x: number, y: number, z: number, mask: number = SK_WORLD, flags = 0): number {
    return this.bridge.worldFor(this.w).solidAt(x, y, z, mask & SK_WORLD, flags & QF_WORLD, STOPS.shots);
  }
  /** enemy line of sight: the exact segment (F12: the 0.5 m samples saw through wall corners), every wall infinite
   *  (no QF.tops) and foliage solid, as World.sight */
  sight(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): boolean {
    return this.bridge.worldFor(this.w).clear(x0, y0, z0, x1, y1, z1, SK_WORLD, 0, STOPS.sight);
  }
  walkableAt(x: number, y: RefY, z: number): boolean { return this.w.walkableAt(x, y, z); }
  nearestWalkableAt(x: number, y: RefY, z: number): [number, number] { return this.w.nearestWalkableAt(x, y, z); }
  place(x: number, y: RefY, z: number, r: number, wide: boolean, reach?: boolean, tall?: number): [number, number] { return this.w.place(x, y, z, r, wide, reach, tall); }
  setNavGoal(x: number, y: RefY, z: number): void { this.w.setNavGoal(x, y, z); }
  navDir(goal: NavGoal, x: number, y: RefY, z: number, out: [number, number], wide?: boolean, diag?: boolean, tall?: number): -1 | 0 | 1 { return this.w.navDir(goal, x, y, z, out, wide, diag, tall); }
  navReached(goal: 'player', x: number, y: RefY, z: number, diag?: boolean, tall?: number): boolean { return this.w.navReached(goal, x, y, z, diag, tall); }
  navDist(goal: 'player', x: number, y: RefY, z: number): number { return this.w.navDist(goal, x, y, z); }
}

