// Runtime traversal proof for the navigation classes (docs/SIZING.md "Navigation classes"): real sim actors walk to
// every target through the real systems (enemy AI, flow and wide fields, player physics, World.moveBody), not a model.
//   npx tsx scripts/navwalk.ts [location|habitat|all] [seeds] [firstSeed]
// Location maps: the player stands at each target and one enemy per class pursues it from the hub (or, for an anchor,
// from that anchor to the player at the hub); then the trainer itself is driven from the hub to every mandatory
// target, as a Small and as an Extra Large partner. Habitat maps: the same at the contest from team B's staging, and the
// trainer from its spawn to the contest. Targets follow the gate's mandatory/optional table (docs/LOCATIONS.md):
//   mandatory (hub, boss hall, arenas; the habitat contest)   every class must arrive
//   the gate's wide anchors, wide-reachable optional spaces   every class must arrive
//   optional and size-restricted (a chamber or nook behind a one-tile neck, a narrow-only anchor)
//                                                               the narrow body must arrive; the wide body must not
// Every tick, every walker's footprint must stay clear of solid geometry (World.fits): navigation and collision agree.
//   --known <file> (I1b review): a known-failure list (tests/fixtures/navwalk-known.json). A failure that matches a
//   listed case by identity (map, seed, space, walker size class) and fails the same way (stuck, overlap or budget) is
//   KNOWN; any other failure is NEW and a listed case failing another way is DIFFERENT (both exit 1); a listed case that
//   now arrives is FIXED. The list is for one flag setting and refuses another
//   --physics rapier (I1b): the partner on the character controller (rules.physics.engine 'rapier'): only the trainer
//   walks, one per size class, to every mandatory target; its capsule must stay clear of the physics world (the
//   enemies stay on the tile World with the physics flag alone, so their walks are the flag-off run's). With both flags
//   (--physics rapier --nav navmesh, I1c, ROADMAP F74) the enemy walkers walk too, on their navmesh and Rapier
//   (sim/enemy3d.ts), each grounded tick's footprint clear of the physics world (World.fits' rule).
//   NAVWALK_DEPTH=1 prints the deepest overlap and a histogram of overlapping ticks by depth; NAVWALK_DEBUG3D=1 a walker's
//   state at its first overlap
import { createRun, step } from '../src/sim/run';
import { spawnEnemy } from '../src/sim/enemies';
import { NO_INPUT, type SimContext } from '../src/sim/types';
import { LOCATIONS } from '../src/world/locations';
import { HABITATS } from '../src/world/habitat';
import { navGrid, wideCore, pathBetween, enemyCore } from '../src/world/locgen/nav';
import { blockMask, blockNeighbours, blockNodes, DIAG_R } from '../src/world/navblocks';
import { navWide, partnerFootprint, partnerHeight } from '../src/rules/sizing';
import { BODY_KINDS, BODY_TEMPLATES } from '../src/rules/materials';
import { bodyTiles } from './habplay';

import { RANGE } from '../src/mods';
import { initNavNode } from '../src/nav/node';
import { worldOf, GROUND } from '../src/sim/worldquery';
import { assertRunning, endedNote, runEnded } from './lib/ended';
/** enemies per class: a Medium (narrow, 0.46 m), a Large (wide with diagonal links, 0.66 m) and an Extra Large (0.88 m).
 *  The Large elite (×2, capped at 0.95 m) went with the elite role (pivot step 10) */
const WALKERS: [string, string, number][] = [['narrow', 'slugma', 0], ['large', 'heracross', 0], ['xl', 'onix', 0]];
const TRAINERS: [string, string][] = [['small', 'totodile'], ['xl', 'feraligatr']];
/** I1b, --physics rapier: the trainer of every size class */
const TRAINERS_PHYSICS: [string, string][] = [['tiny', 'pichu'], ['small', 'totodile'], ['medium', 'croconaw'], ['large', 'tauros'], ['xl', 'feraligatr']];
/** the physics flag of this run (--physics rapier; set by the command line below) */
let PHYSICS: 'tiles' | 'rapier' = 'tiles';

export interface WalkResult { map: string; seed: number; target: string; walker: string; expect: 'arrive' | 'refuse'; ok: boolean; t: number; note: string }

// no spawns, no objectives, and no far-enemy relocation (rules.enemy.despawnDistance would teleport a walker that starts
// more than 46 m from the player to a ring around it, skipping the very route under test; a holding wide body likewise)
const calm = { enemy: { despawnDistance: 1e9, holdRelocate: 1e9 }, ...(process.env.NAVWALK_RULES ? JSON.parse(process.env.NAVWALK_RULES) : {}) };

// I3: `--nav navmesh` (anywhere on the command line) runs every walker on rules.nav.engine 'navmesh' (src/nav): enemies
// steer by the navmesh, and the trainer's route is its group's straight path (navTrainerRoute) instead of the tile lattice
const navAt = process.argv.indexOf('--nav');
const NAV_ENGINE = navAt > 1 ? process.argv.splice(navAt, 2)[1] : 'flow';
if (NAV_ENGINE !== 'flow' && NAV_ENGINE !== 'navmesh') throw new Error(`--nav flow|navmesh, not ${NAV_ENGINE}`);
if (NAV_ENGINE === 'navmesh') { const c = calm as Record<string, Record<string, unknown>>; c.nav = { ...c.nav, engine: 'navmesh' }; await initNavNode(); }

/** the route length (m) on group g's navmesh from tile `from` to the player standing at tile `to`, Infinity with none */
function navRouteLength(ctx: SimContext, from: number, to: number, g: number): number {
  const W = worldOf(ctx), N = ctx.nav!.navFor(W), [fx, fz] = at(ctx, from), [tx, tz] = at(ctx, to);
  const F = N.field(g, 'navwalk-length', tx, ctx.world.height(tx, tz), tz, ctx.rules.nav.goalSnap);
  return N.distance(g, F, fx, ctx.world.height(fx, fz), fz, ctx.rules.nav.snap);
}

/** the trainer's route on the navmesh: its width group's straight path from tile `from` to tile `to` (the target counts
 *  within 2 tiles, as on the lattice), the start first; null when the group's field does not reach the start. Resting
 *  bodies (loose rocks: solid to the trainer, sim/bodies.ts) are TileCache-style obstacles while the route is made, as the
 *  lattice route steps round them; when they close the way (a rock in a two-tile passage) the route goes through */
function navTrainerRoute(ctx: SimContext, from: number, to: number, wide: boolean, diag: boolean, avoidRocks = true): [number, number][] | null {
  const B = ctx.nav!, W = worldOf(ctx), g = wide ? (diag ? 1 : 2) : 0;
  const [fx, fz] = at(ctx, from), [tx, tz] = at(ctx, to);
  W.setNavGoal(fx, GROUND, fz);
  const N = B.navFor(W), P = new Float64Array(3), Bo = ctx.bodies, rocks: number[] = [];
  if (avoidRocks) {
    for (let b = 0; b < Bo.hi; b++) if (Bo.alive[b] && Math.hypot(Bo.vx[b], Bo.vz[b]) <= 1) rocks.push(N.addObstacle({ kind: 'cylinder', x: Bo.x[b], y: Bo.y[b] - 0.5, z: Bo.z[b], r: BODY_TEMPLATES[BODY_KINDS[Bo.kind[b]]].radius, h: 2 }));
    N.update();
  }
  const F = N.field(g, 'navwalk-target', tx, ctx.world.height(tx, tz), tz, 2);
  const p = N.locate(g, fx, ctx.world.height(fx, fz), fz, ctx.rules.nav.snap, P);
  const pts = F ? N.graphs[g].straight(F, p, P[0], P[2]) : [];
  if (rocks.length) { for (const id of rocks) N.removeObstacle(id); N.update(); }
  if (!pts.length) return avoidRocks ? navTrainerRoute(ctx, from, to, wide, diag, false) : null;
  // waypoints at most 1 m apart, as the lattice's (driveTrainer counts progress by waypoints passed)
  const out: [number, number][] = [[fx, fz]];
  for (const [x, z] of pts) {
    const [px, pz] = out[out.length - 1], n = Math.ceil(Math.hypot(x - px, z - pz));
    for (let s = 1; s <= n; s++) out.push([px + ((x - px) * s) / n, pz + ((z - pz) * s) / n]);
  }
  return out;
}
const at = (ctx: SimContext, k: number): [number, number] => [(k % ctx.world.w) - ctx.world.half + 0.5, ((k / ctx.world.w) | 0) - ctx.world.half + 0.5];

export function freshRun(kind: 'location' | 'habitat', id: string, seed: number, species = 'totodile'): SimContext {
  const wg = kind === 'location'
    ? { mode: 'generated', regionSeed: seed, locations: { meadow: id, dusk: id, badlands: id, frost: id } }
    : { mode: 'generated', regionSeed: seed, locations: { meadow: id, dusk: id, badlands: id, frost: id } };
  const ctx = createRun({ mode: RANGE, seed: 1, species, ruleOverrides: { worldgen: wg, ...calm, ...(PHYSICS === 'rapier' ? { physics: { engine: 'rapier' } } : {}) } as never });
  const E = ctx.enemies;
  for (let e = 0; e < E.hi; e++) if (E.alive[e]) E.kill(e);
  return ctx;
}

/** stand the player at (x, z): on the ground, or on the deck there when `deck` (a bridge node of the wide core) */
function place(ctx: SimContext, x: number, z: number, deck = false) {
  const P = ctx.player, W = ctx.world;
  P.x = P.px = x; P.z = P.pz = z; P.y = P.py = deck ? W.height(x, z, 1e9) : W.height(x, z); P.vx = P.vz = P.vy = P.kx = P.kz = 0; P.grounded = true;
}

/** the footprint clears solid geometry (a tiny tolerance for float32 positions); with a body height its head clears deck slabs too */
const clearAt = (ctx: SimContext, x: number, z: number, y: number, r: number, tall?: number) => r <= 0 || ctx.world.fits(x, z, y, Math.max(0, r - 2e-3), 0.6 + 1e-3, tall === undefined ? undefined : tall - 2e-3);
/** I1c, both flags: an enemy walker's footprint (shrunk by 2 mm) clear of what stops a body from a step (+1 cm) above its
 *  feet to its head on Rapier: World.fits' rule (faces higher than the step, walls, slabs a head would hit) */
const clear3d = (ctx: SimContext, x: number, z: number, y: number, r: number, tall: number) => ctx.nav!.physFor(worldOf(ctx)).bodyOverlap(x, y + ctx.rules.player.stepHeight + 0.01, y + Math.max(tall, ctx.rules.player.stepHeight + 0.06), z, r - 2e-3) === 0;
/** on physics the trainer's own body: its capsule (shrunk by 2 mm) clear of the physics world */
const clearOn = (ctx: SimContext, x: number, z: number, y: number, r: number, tall: number) => ctx.physics ? ctx.physics.bodyClear(ctx.world, x, y, z, r, tall, 2e-3) : clearAt(ctx, x, z, y, r, tall);

const DEBUG = !!process.env.NAVWALK_DEBUG;
/** NAVWALK_DEPTH=1 (I1c): the deepest 3D walker overlap seen, printed at the end */
let maxDepth = 0;
const depthHist: Record<string, number> = {}, deepEx: string[] = [];
process.on('exit', () => { if (process.env.NAVWALK_DEPTH) console.log(`deepest 3D walker overlap ${maxDepth.toFixed(3)} m; overlapping grounded ticks by depth ${JSON.stringify(depthHist)}\n${deepEx.join('\n')}`); });

/** one enemy pursues the player standing at (px, pz) from (sx, sz) */
function pursue(ctx: SimContext, walker: [string, string, number], sx: number, sz: number, px: number, pz: number, budget: number, deck = false): { arrived: boolean; t: number; pen: boolean; note: string } {
  const [, species, roles] = walker, E = ctx.enemies, P = ctx.player;
  place(ctx, px, pz, deck);
  const e = spawnEnemy(ctx, species, sx, sz, roles);
  if (e < 0) return { arrived: false, t: 0, pen: false, note: 'no spawn' };
  E.spawnT[e] = 1;
  const t0 = ctx.time;
  let pen = false, note = '';
  const ring: string[] = [];
  while (ctx.time - t0 < budget) {
    assertRunning(ctx, 'navwalk enemy walker');
    P.iframes = 1; P.hp = P.maxHp; place(ctx, px, pz, deck);
    step(ctx, NO_INPUT);
    // NAVWALK_DEBUG=1: print the last 8 ticks before the first overlap
    if (DEBUG) { ring.push(`x ${E.x[e].toFixed(3)} z ${E.z[e].toFixed(3)} y ${E.y[e].toFixed(2)} py ${E.py[e].toFixed(2)} fall ${E.fallV[e].toFixed(1)} v ${E.vx[e].toFixed(1)},${E.vz[e].toFixed(1)} k ${E.kx[e].toFixed(1)},${E.kz[e].toFixed(1)} clear ${clearAt(ctx, E.x[e], E.z[e], E.y[e], E.foot[e])}`); if (ring.length > 8) ring.shift(); }
    if (!E.alive[e]) return { arrived: false, t: ctx.time - t0, pen, note: 'died' };
    // grounded walkers only: a body falling past a cliff (knocked off, or dropping further than it planned) is pushed off
    // the face as it falls, and must be clear again by the time it stands
    // I1c (F74), both flags: the walker moves on its navmesh and Rapier (sim/enemy3d.ts); grounded is off a drop link
    // with no fall under way, and clear is World.fits' rule on Rapier: its footprint (2 mm under) clear of what stops a
    // body from a step above its feet to its head (an enemy is a footprint at its axis' height, not a capsule: S1 O2)
    const on3d = !!ctx.nav?.full, grounded = on3d ? E.mesh[e] !== 1 && E.vy[e] === 0 : E.fallV[e] === 0;
    if (grounded && !(on3d ? clear3d(ctx, E.x[e], E.z[e], E.y[e], E.foot[e], E.tall[e]) : clearAt(ctx, E.x[e], E.z[e], E.y[e], E.foot[e], E.tall[e]))) {
      if (!pen && DEBUG) console.log([...ring, `overlap ${species} at ${E.x[e]},${E.z[e]} y ${E.y[e]} h ${ctx.world.height(E.x[e], E.z[e], E.y[e])} foot ${E.foot[e]} collides ${ctx.world.collides(E.x[e], E.z[e], E.y[e], 0.6)} from ${E.px[e]},${E.pz[e]} hz ${E.hzKind[e]}`].join('\n'));
      if (on3d && process.env.NAVWALK_DEPTH) { const Pw = ctx.nav!.physFor(worldOf(ctx)); let d = 0; while (d < 0.5 && Pw.bodyOverlap(E.x[e], E.y[e] + 0.61, E.y[e] + Math.max(E.tall[e], 0.66), E.z[e], E.foot[e] - d) > 0) d += 0.005; maxDepth = Math.max(maxDepth, d); const bk = d <= 0.02 ? '<=0.02' : d <= 0.06 ? '<=0.06' : d <= 0.15 ? '<=0.15' : '>0.15'; depthHist[bk] = (depthHist[bk] ?? 0) + 1; if (d > 0.15 && deepEx.length < 12) deepEx.push(`${species} mesh ${E.mesh[e]} ${E.x[e].toFixed(2)},${E.y[e].toFixed(2)},${E.z[e].toFixed(2)} d ${d.toFixed(3)} tileH ${ctx.world.height(E.x[e], E.z[e]).toFixed(2)} vy ${E.vy[e]}`); }
      if (!pen && on3d && process.env.NAVWALK_DEBUG3D) console.log(`overlap3d ${species} mesh ${E.mesh[e]} meshT ${E.meshT[e].toFixed(2)} vy ${E.vy[e]} at ${E.x[e].toFixed(3)},${E.y[e].toFixed(3)},${E.z[e].toFixed(3)} py ${E.py[e].toFixed(3)} foot ${E.foot[e]} tall ${E.tall[e].toFixed(2)} k ${E.kx[e].toFixed(2)},${E.kz[e].toFixed(2)} tileH ${ctx.world.height(E.x[e], E.z[e]).toFixed(2)}`);
      pen = true; note = `overlap at ${E.x[e].toFixed(2)},${E.z[e].toFixed(2)}`;
    }
    if (Math.hypot(E.x[e] - px, E.z[e] - pz) < 2.5) { E.kill(e); return { arrived: true, t: ctx.time - t0, pen, note }; }
  }
  note = note || `ended ${E.x[e].toFixed(1)},${E.z[e].toFixed(1)} (${Math.hypot(E.x[e] - px, E.z[e] - pz).toFixed(1)} m off)`;
  E.kill(e);
  return { arrived: false, t: budget, pen, note };
}

/** the trainer's own route: tile centres on the ordinary graph (narrow), or wide block centres (wide, the lattice) */
export function trainerRoute(ctx: SimContext, from: number, to: number, wide: boolean, diag: boolean, avoidRocks = true): [number, number][] | null {
  const m = ctx.world.map, W = m.w, n = W * m.h, rocks = avoidRocks ? bodyTiles(ctx) : new Set<number>();
  rocks.delete(from); rocks.delete(to);
  if (!wide) {
    const core = enemyCore(m, from, 0);
    const free = core.slice(); for (const k of rocks) { free[k] = 0; if (m.over) free[n + k] = 0; }
    const p = pathBetween(m, from, to, free) ?? pathBetween(m, from, to, core);
    return p ? p.map((k) => at(ctx, k % n)) : null;
  }
  const g = navGrid(m), M = blockMask(g), prev = new Int32Array(M.length).fill(-2), Q: number[] = [], nb = new Int32Array(16), ta = new Int32Array(4), tb = new Int32Array(4);
  const blocksOf = (k: number) => { const out: number[] = [], i = k % W, j = (k / W) | 0; for (let L = 0; L < M.length / n; L++) for (let dj = -1; dj <= 0; dj++) for (let di = -1; di <= 0; di++) { const b = L * n + (j + dj) * W + i + di; if (i + di >= 0 && j + dj >= 0 && M[b]) out.push(b); } return out; };
  for (const b of blocksOf(from)) { prev[b] = -1; Q.push(b); }
  const goal = new Set<number>();
  // any wide block within 2 tiles of the target counts (the target is a space, not a tile)
  for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) for (const b of blocksOf(to + dj * W + di)) goal.add(b);
  let end = -1;
  const withRocks = avoidRocks;
  for (let h = 0; h < Q.length && end < 0; h++) {
    const a = Q[h];
    if (goal.has(a)) { end = a; break; }
    const c = blockNeighbours(g, M, a, nb, ta, tb, diag);
    for (let q = 0; q < c; q++) {
      const b = nb[q], k = b % n;
      // round resting bodies (a loose rock is solid to the trainer: sim/bodies.ts): the block centre, where the trainer is
      // steered, keeps rock radius + footprint clear of every rock
      if (prev[b] !== -2) continue;
      if (avoidRocks) { const cx = (k % W) + 1 - ctx.world.half, cz = ((k / W) | 0) + 1 - ctx.world.half; if (rockAt(ctx, cx, cz, partnerFootprint(ctx.player.species, ctx.rules))) continue; }
      prev[b] = a; Q.push(b);
    }
  }
  // a loose rock may close a two-tile passage for an Extra Large trainer: then the route through it (a Power move clears it)
  if (end < 0) return withRocks ? trainerRoute(ctx, from, to, wide, diag, false) : null;
  const out: [number, number][] = [];
  for (let b = end; b >= 0; b = prev[b]) { const k = b % n; out.push([(k % W) + 1 - ctx.world.half, ((k / W) | 0) + 1 - ctx.world.half]); }
  void blockNodes;
  return out.reverse();
}

/** drive the trainer along waypoints with its own physics; true when it reaches the last one */
function driveTrainer(ctx: SimContext, path: [number, number][], budget: number): { arrived: boolean; t: number; pen: boolean; note: string } {
  const P = ctx.player, t0 = ctx.time, foot = partnerFootprint(P.species, ctx.rules);
  let i = 0, pen = false, note = '', bestI = 0, lastProgress = ctx.time;
  while (ctx.time - t0 < budget) {
    if (runEnded(ctx)) return { arrived: false, t: ctx.time - t0, pen, note: endedNote(ctx) };
    P.iframes = 1; P.hp = P.maxHp;
    // the nearest waypoint among the next few is where the trainer is along the route (the look-ahead cuts past some)
    // (only one it can walk to in a straight line: a waypoint a metre away across a face is further along the route)
    const walkTo = (x: number, z: number) => { let feet = P.y; const L = Math.hypot(x - P.x, z - P.z), N = Math.ceil(L / 0.25); for (let s = 1; s <= N; s++) { const qx = P.x + ((x - P.x) * s) / N, qz = P.z + ((z - P.z) * s) / N; if (ctx.world.blocks(qx, qz, feet, 0.6)) return false; feet = Math.max(ctx.world.height(qx, qz, feet), feet - 0.6); } return true; };
    { let nd = Infinity, ni = i; for (let j = i; j < Math.min(path.length, i + 8); j++) { const d = Math.hypot(path[j][0] - P.x, path[j][1] - P.z); if (d < nd && (j === i || walkTo(path[j][0], path[j][1]))) { nd = d; ni = j; } } i = ni; }
    if (i < path.length - 1 && Math.hypot(path[i][0] - P.x, path[i][1] - P.z) < 0.6) i++;
    // look ahead along the route to the farthest waypoint within 3 steps the footprint reaches in a straight line
    let tx = path[i][0], tz = path[i][1];
    for (let a = Math.min(path.length - 1, i + 3); a > i; a--) {
      const [cx, cz] = path[a], L = Math.hypot(cx - P.x, cz - P.z), N = Math.ceil(L / 0.25);
      let ok = true, feet = P.y;
      for (let s = 1; s <= N && ok; s++) {
        const x = P.x + ((cx - P.x) * s) / N, z = P.z + ((cz - P.z) * s) / N;
        ok = !ctx.world.blocks(x, z, feet, 0.6) && clearAt(ctx, x, z, ctx.world.height(x, z, feet), foot + 0.05) && !rockAt(ctx, x, z, foot);
        feet = Math.max(ctx.world.height(x, z, feet), feet - 0.6);
      }
      if (ok) { tx = cx; tz = cz; break; }
    }
    const dx = tx - P.x, dz = tz - P.z, L = Math.hypot(dx, dz) || 1;
    step(ctx, { ...NO_INPUT, mx: dx / L, mz: dz / L });
    if (!clearOn(ctx, P.x, P.z, P.y, foot, partnerHeight(P.species, ctx.rules))) { pen = true; note = `overlap at ${P.x.toFixed(2)},${P.z.toFixed(2)}`; }
    if (i > bestI) { bestI = i; lastProgress = ctx.time; }
    if (i >= path.length - 1 && Math.hypot(path[path.length - 1][0] - P.x, path[path.length - 1][1] - P.z) < 1.2) return { arrived: true, t: ctx.time - t0, pen, note };
    if (ctx.time - lastProgress > 6) return { arrived: false, t: ctx.time - t0, pen, note: note || `stuck at ${P.x.toFixed(2)},${P.z.toFixed(2)} (waypoint ${i}/${path.length})` };
  }
  return { arrived: false, t: budget, pen, note: note || 'budget' };
}

const budgetFor = (tiles: number, speed = 2.5) => tiles / speed * 2 + 5;

export function walkLocation(id: string, seed: number): WalkResult[] {
  const out: WalkResult[] = [];
  const base = freshRun('location', id, seed), W = base.world, m = W.map, L = m.gen!.loc!, n = m.w * m.h;
  const hub = L.zones.find((z) => z.kind === 'hub')!, hubK = Math.floor(hub.y) * m.w + Math.floor(hub.x);
  const wideStrict = wideCore(m, hubK), wideDiag = wideCore(m, hubK, 0, true), ecore = enemyCore(m, hubK, W.dropNav);
  const nearIn = (c: Uint8Array, x: number, y: number, R: number) => { for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) { const k = (Math.floor(y) + dy) * m.w + Math.floor(x) + dx; if (c[k] || (m.over && c[n + k])) return true; } return false; };
  const dist = (a: number, b: number) => pathBetween(m, a, b, ecore)?.length ?? 200;
  const targets: { name: string; k: number; mandatory: boolean; anchor: boolean }[] = [];
  for (const z of L.zones) {
    if (z.kind === 'hub' || z.kind === 'entrance') continue;
    const k = Math.floor(z.y) * m.w + Math.floor(z.x);
    if (!navOpenAt(base, k)) continue;
    targets.push({ name: z.kind + z.id, k, mandatory: z.kind === 'boss' || z.kind === 'arena', anchor: false });
  }
  for (const [x, y] of L.anchors) targets.push({ name: `anchor${x},${y}`, k: y * m.w + x, mandatory: false, anchor: true });
  for (const T of targets) {
    for (const w of PHYSICS === 'rapier' && NAV_ENGINE !== 'navmesh' ? [] : WALKERS) {
      const ctx = freshRun('location', id, seed);
      const diag = w[0] === 'large', narrow = w[0] === 'narrow';
      const reach = narrow ? true : nearIn(diag ? wideDiag : wideStrict, T.k % m.w, (T.k / m.w) | 0, T.anchor ? 0 : 3);
      if (T.anchor && !narrow && !reach) continue; // the director never spawns a wide body at a narrow-only anchor
      // (on the navmesh too: an adapter map's narrow agent is 4 cells, so one-tile necks stay open, the owner's F77 decision)
      const expect: WalkResult['expect'] = T.mandatory || reach ? 'arrive' : 'refuse';
      // where the walker is asked to come: the target tile for a narrow body; for a wide one the nearest tile of its wide
      // core within the gate's radius of the target (the gate's own test: a space is wide-reachable when wide ground lies
      // within 3 tiles of its centre, docs/LOCATIONS.md), so a pillar on the very centre tile does not fail the walk
      let tk = T.k, deck = false;
      if (!narrow && reach) {
        const c = diag ? wideDiag : wideStrict, R = T.anchor ? 0 : 3, cx = T.k % m.w, cy = (T.k / m.w) | 0;
        let best = Infinity;
        for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) { const k = (cy + dy) * m.w + cx + dx; if ((c[k] || (m.over && c[n + k])) && dx * dx + dy * dy < best) { best = dx * dx + dy * dy; tk = k; deck = !c[k]; } }
      }
      const [hx, hz] = at(ctx, hubK), [tx, tz] = at(ctx, tk);
      // the time budget follows the walker's own route: a wide body may detour far round a one-tile neck
      const own = narrow ? null : trainerRoute(ctx, T.anchor ? tk : hubK, T.anchor ? hubK : tk, true, diag, false);
      // (on the navmesh, the walker's own group route too: a neck it does not fit sends it the long way)
      const navLen = NAV_ENGINE === 'navmesh' ? navRouteLength(ctx, T.anchor ? tk : hubK, T.anchor ? hubK : tk, narrow ? 0 : diag ? 1 : 2) : 0;
      const tiles = Math.max(T.anchor ? dist(T.k, hubK) : dist(hubK, T.k), own ? own.length : 0, navLen < Infinity ? navLen : 0);
      const r = T.anchor ? pursue(ctx, w, tx, tz, hx, hz, budgetFor(tiles)) : pursue(ctx, w, hx, hz, tx, tz, budgetFor(tiles), deck);
      const ok = !r.pen && (expect === 'arrive' ? r.arrived : !r.arrived);
      out.push({ map: id, seed, target: T.name, walker: w[0], expect, ok, t: +r.t.toFixed(1), note: r.note });
    }
  }
  // the trainer to every mandatory target
  for (const [label, species] of PHYSICS === 'rapier' ? TRAINERS_PHYSICS : TRAINERS) for (const T of targets.filter((t) => t.mandatory)) {
    const ctx = freshRun('location', id, seed, species), foot = partnerFootprint(ctx.player.species, ctx.rules), wide = navWide(foot, ctx.rules);
    const route = NAV_ENGINE === 'navmesh' ? navTrainerRoute(ctx, hubK, T.k, wide, foot < DIAG_R) : trainerRoute(ctx, hubK, T.k, wide, foot < DIAG_R);
    if (!route) { out.push({ map: id, seed, target: T.name, walker: 'trainer-' + label, expect: 'arrive', ok: false, t: 0, note: 'no route on its lattice' }); continue; }
    place(ctx, ...route[0]);
    const r = driveTrainer(ctx, route, budgetFor(route.length, 3));
    out.push({ map: id, seed, target: T.name, walker: 'trainer-' + label, expect: 'arrive', ok: r.arrived && !r.pen, t: +r.t.toFixed(1), note: r.note });
  }
  return out;
}

/** a resting body (loose rock, egg) within reach of a footprint centred at (x, z) */
function rockAt(ctx: SimContext, x: number, z: number, foot: number): boolean {
  const B = ctx.bodies;
  for (let b = 0; b < B.hi; b++) if (B.alive[b] && Math.hypot(B.vx[b], B.vz[b]) <= 1 && Math.hypot(B.x[b] - x, B.z[b] - z) < BODY_TEMPLATES[BODY_KINDS[B.kind[b]]].radius + foot + 0.05) return true;
  return false;
}

function navOpenAt(ctx: SimContext, k: number) { const [x, z] = at(ctx, k); return ctx.world.walkable(x, z); }

export function walkHabitat(id: string, seed: number): WalkResult[] {
  const out: WalkResult[] = [];
  const base = freshRun('habitat', id, seed), W = base.world, H = W.hab!, m = W.map;
  const ck = Math.floor(H.contest.y) * m.w + Math.floor(H.contest.x), sk = m.spawn[1] * m.w + m.spawn[0];
  const bk = Math.floor(H.stage.B[1]) * m.w + Math.floor(H.stage.B[0]);
  for (const w of PHYSICS === 'rapier' && NAV_ENGINE !== 'navmesh' ? [] : WALKERS) {
    const ctx = freshRun('habitat', id, seed);
    const [bx, bz] = at(ctx, bk), [cx, cz] = at(ctx, ck);
    const r = pursue(ctx, w, bx, bz, cx, cz, budgetFor(60));
    out.push({ map: id, seed, target: 'contest', walker: w[0], expect: 'arrive', ok: r.arrived && !r.pen, t: +r.t.toFixed(1), note: r.note });
  }
  for (const [label, species] of PHYSICS === 'rapier' ? TRAINERS_PHYSICS : TRAINERS) {
    const ctx = freshRun('habitat', id, seed, species), foot = partnerFootprint(ctx.player.species, ctx.rules), wide = navWide(foot, ctx.rules);
    const route = NAV_ENGINE === 'navmesh' ? navTrainerRoute(ctx, sk, ck, wide, foot < DIAG_R) : trainerRoute(ctx, sk, ck, wide, foot < DIAG_R);
    if (!route) { out.push({ map: id, seed, target: 'contest', walker: 'trainer-' + label, expect: 'arrive', ok: false, t: 0, note: 'no route on its lattice' }); continue; }
    place(ctx, ...route[0]);
    const r = driveTrainer(ctx, route, budgetFor(route.length, 3));
    out.push({ map: id, seed, target: 'contest', walker: 'trainer-' + label, expect: 'arrive', ok: r.arrived && !r.pen, t: +r.t.toFixed(1), note: r.note });
  }
  return out;
}

if (process.argv[1]?.endsWith('navwalk.ts')) {
  // --physics rapier (I1b): Rapier loads once before the first run
  const pf = process.argv.indexOf('--physics'), argv = process.argv.slice();
  if (pf >= 0) { PHYSICS = argv[pf + 1] === 'rapier' ? 'rapier' : 'tiles'; argv.splice(pf, 2); }
  if (PHYSICS === 'rapier') await (await import('../src/physics/node')).initPhysicsNode();
  const ki = argv.indexOf('--known'), knownPath = ki >= 0 ? argv.splice(ki, 2)[1] : null;
  const which = argv[2] ?? 'all', N = Number(argv[3] ?? 5), first = Number(argv[4] ?? 1);
  const ids: ['location' | 'habitat', string][] = [];
  if (which === 'all' || which === 'location') for (const id of Object.keys(LOCATIONS)) ids.push(['location', id]);
  if (which === 'all' || which === 'habitat') for (const id of Object.keys(HABITATS)) ids.push(['habitat', id]);
  if (LOCATIONS[which]) ids.push(['location', which]);
  if (HABITATS[which]) ids.push(['habitat', which]);
  const tally: Record<string, { ok: number; n: number }> = {};
  const failed: WalkResult[] = [], ran: WalkResult[] = [];
  let fails = 0;
  for (const [kind, id] of ids) for (let s = first; s < first + N; s++) {
    for (const r of kind === 'location' ? walkLocation(id, s) : walkHabitat(id, s)) {
      const key = `${r.walker} ${r.expect}`;
      tally[key] ??= { ok: 0, n: 0 }; tally[key].n++; if (r.ok) tally[key].ok++;
      if (!r.ok) { fails++; failed.push(r); console.log(`FAIL ${r.map} seed ${r.seed} ${r.target} ${r.walker} expect ${r.expect} t ${r.t} ${r.note}`); }
      ran.push(r);
    }
  }
  for (const [k, v] of Object.entries(tally).sort()) console.log(`${k.padEnd(22)} ${v.ok}/${v.n}`);
  console.log(`\n${fails} failures${PHYSICS === 'rapier' ? ' (physics: the trainer on the character controller)' : ''}`);
  if (fails) process.exitCode = 1;
  if (knownPath) {
    type Known = { map: string; seed: number; target: string; walker: string; failure: string; why?: string };
    const K = JSON.parse((await import('node:fs')).readFileSync(knownPath, 'utf8')) as { setting: { physics: string; nav: string }; cases: Known[] };
    if (K.setting.physics !== PHYSICS || K.setting.nav !== NAV_ENGINE) throw new Error(`--known: ${knownPath} is for physics ${K.setting.physics}, nav ${K.setting.nav}; this run is physics ${PHYSICS}, nav ${NAV_ENGINE}`);
    const failureOf = (r: WalkResult) => r.note.startsWith('stuck') ? 'stuck' : r.note.startsWith('overlap') ? 'overlap' : r.note === 'budget' ? 'budget' : 'other';
    const id = (c: { map: string; seed: number; target: string; walker: string }) => `${c.map} seed ${c.seed} ${c.target} ${c.walker}`;
    const known = new Map(K.cases.map((c) => [id(c), c]));
    let bad = 0;
    console.log(`\nfailures against the known list ${knownPath} (physics ${PHYSICS}, nav ${NAV_ENGINE}):`);
    for (const r of failed) {
      const k = known.get(id(r)), f = failureOf(r);
      if (k && k.failure === f) console.log(`  KNOWN     ${id(r)}: ${f} (${r.note})`);
      else if (k) { bad++; console.log(`  DIFFERENT ${id(r)}: ${f}, listed as ${k.failure} (${r.note})`); }
      else { bad++; console.log(`  NEW       ${id(r)}: ${f} (${r.note})`); }
    }
    const ranIds = new Set(ran.map(id)), failedIds = new Set(failed.map(id));
    for (const c of K.cases) if (!failedIds.has(id(c))) console.log(`  ${ranIds.has(id(c)) ? 'FIXED    ' : 'NOT RUN  '} ${id(c)}: listed as ${c.failure}`);
    console.log(`known-failure gate: ${failed.length - bad} known, ${bad} new or different: ${bad === 0 ? 'PASS' : 'FAIL'}`);
    process.exitCode = bad ? 1 : 0;
  }
}
