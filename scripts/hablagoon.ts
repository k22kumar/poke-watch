// Route geometry and combat exposure of a habitat map, from the final collision (no sim steps), for comparing recipes:
//   npx tsx scripts/hablagoon.ts [recipe[,recipe…]] [seeds] [firstSeed] [-v]      default: tropical-lagoon,river-gorge 8 1
// For each seed, each side's two planned approaches are walked as built (the same corridor the `planned` gate proves) and
// measured:
//   length / bend   path length (m) and its ratio to the straight staging → point distance
//   climb           total metres climbed along it
//   open            mean share of 16 rays (muzzle height, 30 m) that run clear for ≥ 15 m, over the path's nodes more than 14 m
//                   from the point and from its staging (the ground round both is shared): how much of the route is walked in the open (1)
//                   or under cover (0)
//   cover           mean share of the 8 compass sides with something to shelter behind within 6 tiles (a tree, a rock, a stack, a
//                   rise of 0.9 m): a path between stands has most, a bank in the open few
//   water           share of those nodes with open water within 5 tiles (a bank is watched from across the water)
//   reach           the longest clear sightline from any node of the route (m)
//   seen            share of the route's last 40 m the point can see at weapon range (14 m), and where it is first seen
// then per map: how far apart a side's two approaches are in exposure (|open direct − open flank|), the strongest `shore`
// lock (validate.ts), and the longest open line anywhere on the map's low shore. The gorge has no shore: its rim and floor
// stand in (every walkable tile off the routes). The numbers back the claim in docs/HABITATS.md that a lagoon changes route
// geometry and combat exposure relative to Shrine Gorge; tests/lagoon.test.ts keeps it true.
import { attemptHabitat, generateHabitat, HABITATS, profilesFor } from '../src/world/habitat';
import { CONTROL_POINT } from '../src/world/habitat/mode';
import { clearance, sightAbs } from '../src/world/habitat/validate';
import { navTop, navOpen } from '../src/world/tilenav';
import { pathBetween } from '../src/world/locgen/nav';
import { T, type ArenaMap } from '../src/world/tiles';

const RAYS = 16, RANGE = 30, FAR = 90, OPEN_AT = 15, MUZZLE = 1.0, SEE = 14, NEAR_POINT = 14;

export interface RouteStats { id: string; length: number; bend: number; climb: number; open: number; cover: number; water: number; reach: number; seen: number; firstSeen: number; nodes: number[] }
export interface MapStats { recipe: string; seed: number; routes: RouteStats[]; gap: [number, number]; shoreLock: number | null; shoreReach: number; crossings: Record<string, number> }

const tileOf = (m: ArenaMap, p: [number, number]) => Math.floor(p[1]) * m.w + Math.floor(p[0]);
const xy = (m: ArenaMap, v: number): [number, number] => { const k = v % (m.w * m.h); return [(k % m.w) + 0.5, ((k / m.w) | 0) + 0.5]; };
const level = (m: ArenaMap, v: number) => (v >= m.w * m.h ? m.over![v - m.w * m.h] : navTop(m, v));

/** longest clear run (m) from node v along direction d at a muzzle height above its own surface */
export function ray(m: ArenaMap, v: number, d: number, range = RANGE, dryEnd = false): number {
  const [x, y] = xy(m, v), h = level(m, v) + MUZZLE;
  const dx = Math.cos((d / RAYS) * Math.PI * 2), dy = Math.sin((d / RAYS) * Math.PI * 2);
  let last = 0;
  for (let s = 2; s <= range; s += 2) {
    if (!sightAbs(m, x, y, h, x + dx * s, y + dy * s, h)) break;
    // a dry-to-dry line: it counts only up to the last stretch that ends on standable ground (not across the water to nothing)
    if (!dryEnd || navOpen(m, Math.floor(y + dy * s) * m.w + Math.floor(x + dx * s))) last = s;
  }
  return last;
}

function planned(m: ArenaMap, H: NonNullable<ArenaMap['gen']>['hab'] & object, cl: Float32Array, tiles: number[], team: 'A' | 'B'): number[] | null {
  const n = m.w * m.h, N = cl.length, corr = new Uint8Array(N);
  const mark = (cx: number, cy: number, r: number) => { for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(m.h - 1, Math.ceil(cy + r)); y++) for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(m.w - 1, Math.ceil(cx + r)); x++) if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) { corr[y * m.w + x] = 1; if (N > n) corr[n + y * m.w + x] = 1; } };
  for (const k of tiles) mark((k % m.w) + 0.5, ((k / m.w) | 0) + 0.5, 2);
  mark(H.stage[team][0], H.stage[team][1], 12); mark(H.contest.x, H.contest.y, H.contest.r + 3);
  const allow = new Uint8Array(N);
  for (let v = 0; v < N; v++) allow[v] = corr[v] && cl[v] >= 1.42 ? 1 : 0;
  const c = m.over && m.over[tileOf(m, [H.contest.x, H.contest.y])] > 0 && Math.abs(m.over[tileOf(m, [H.contest.x, H.contest.y])] - H.contest.h) < 0.7 ? n + tileOf(m, [H.contest.x, H.contest.y]) : tileOf(m, [H.contest.x, H.contest.y]);
  return pathBetween(m, tileOf(m, H.stage[team]), c, allow);
}

/** is there something to shelter behind at a node: a wall (tree, rock, stack) or a rise of ≥ 0.9 m within 6 tiles, on the side of the
 *  node it would shelter? Share of the 8 compass sides that have one (a route walked between trees has most of them) */
export function coverAt(m: ArenaMap, v: number): number {
  const [x, y] = xy(m, v), h = level(m, v), W = m.w;
  let sides = 0;
  for (let d = 0; d < 8; d++) {
    const dx = Math.cos((d / 8) * Math.PI * 2), dy = Math.sin((d / 8) * Math.PI * 2);
    for (let s = 1.5; s <= 6.5; s += 1) {
      const tx = Math.floor(x + dx * s), ty = Math.floor(y + dy * s);
      if (tx < 0 || ty < 0 || tx >= W || ty >= m.h) break;
      const k = ty * W + tx;
      if (m.wall[k] || (navOpen(m, k) && navTop(m, k) - h >= 0.9)) { sides++; break; }
    }
  }
  return sides / 8;
}

/** is there open water within 5 tiles of the node (a bank or a beach is watched from across it)? 1 or 0 */
function waterNear(m: ArenaMap, v: number): number {
  const k = v % (m.w * m.h), x0 = k % m.w, y0 = (k / m.w) | 0;
  for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) {
    const x = x0 + dx, y = y0 + dy;
    if (x < 0 || y < 0 || x >= m.w || y >= m.h || dx * dx + dy * dy > 25) continue;
    if (m.terrain[y * m.w + x] === T.water && !m.wall[y * m.w + x] && !(m.over && m.over[y * m.w + x] > 0)) return 1;
  }
  return 0;
}

export function measure(recipe: string, seed: number): MapStats {
  const m = generateHabitat({ recipe, seed }), H = m.gen!.hab!, cl = clearance(m), n = m.w * m.h;
  // the accepted attempt again, for each approach's own tiles (the meta keeps only a count); same seed, same layout
  const G = attemptHabitat(HABITATS[recipe], CONTROL_POINT, H.attemptSeed, m.w, H.variant, profilesFor()).g;
  const padTile = tileOf(m, [H.contest.x, H.contest.y]);
  const routes: RouteStats[] = [];
  for (const team of ['A', 'B'] as const) for (const kind of ['direct', 'flank'] as const) {
    const A = H.approaches.find((a) => a.team === team && a.kind === kind);
    if (!A) continue;
    const tiles = G.approaches.find((a) => a.id === A.id)!.tiles;
    const p = planned(m, H, cl, tiles, team);
    if (!p) continue;
    let len = 0, climb = 0;
    for (let i = 1; i < p.length; i++) { const [ax, ay] = xy(m, p[i - 1]), [bx, by] = xy(m, p[i]); len += Math.hypot(ax - bx, ay - by); climb += Math.max(0, level(m, p[i]) - level(m, p[i - 1])); }
    const chord = Math.hypot(H.stage[team][0] - H.contest.x, H.stage[team][1] - H.contest.y);
    let openSum = 0, coverSum = 0, waterSum = 0, reach = 0, samples = 0;
    for (let i = 0; i < p.length; i += 3) {
      // the route's own character, not the open ground round the point that both share: skip the last stretch
      const [qx, qy] = xy(m, p[i]);
      if (Math.hypot(qx - H.contest.x, qy - H.contest.y) < NEAR_POINT || Math.hypot(qx - H.stage[team][0], qy - H.stage[team][1]) < NEAR_POINT) continue;
      const runs = Array.from({ length: RAYS }, (_, d) => ray(m, p[i], d));
      openSum += runs.filter((r) => r >= OPEN_AT).length / RAYS; reach = Math.max(reach, ...runs); samples++;
      coverSum += coverAt(m, p[i]); waterSum += waterNear(m, p[i]);
    }
    // the last 40 m, and what the point sees of it
    let acc = 0, from = p.length - 1;
    for (let i = p.length - 1; i > 0 && acc < 40; i--) { const [ax, ay] = xy(m, p[i]), [bx, by] = xy(m, p[i - 1]); acc += Math.hypot(ax - bx, ay - by); from = i - 1; }
    const tail = p.slice(from), [px, py] = xy(m, padTile), eye = H.contest.h + 0.9;
    let seen = 0, first = 0, run = 0;
    for (let i = tail.length - 1; i >= 0; i--) {
      const [x, y] = xy(m, tail[i]);
      if (i < tail.length - 1) { const [qx, qy] = xy(m, tail[i + 1]); run += Math.hypot(qx - x, qy - y); }
      if (Math.hypot(x - px, y - py) <= SEE && sightAbs(m, px, py, eye, x, y, level(m, tail[i]) + 0.5)) { seen++; first = run; }
    }
    routes.push({ id: `${team}.${kind}`, length: len, bend: len / chord, climb, open: openSum / samples, cover: coverSum / samples, water: waterSum / samples, reach, seen: seen / tail.length, firstSeen: first, nodes: p });
  }
  const gap: [number, number] = [0, 0];
  for (const [i, team] of (['A', 'B'] as const).entries()) { const d = routes.find((r) => r.id === `${team}.direct`), f = routes.find((r) => r.id === `${team}.flank`); gap[i] = d && f ? Math.abs(d.open - f.open) : 0; }
  // the longest dry-to-dry open line on the low ground that is not a route (the shore; on the gorge, the floor)
  const onRoute = new Set<number>(); for (const r of routes) for (const v of r.nodes) onRoute.add(v % n);
  let shoreReach = 0;
  const low = Math.min(...routes.flatMap((r) => r.nodes.map((v) => level(m, v))));
  for (let k = 0; k < n; k += 5) {
    if (!navOpen(m, k) || onRoute.has(k) || navTop(m, k) > low + 1.2) continue;
    const v = k, [x, y] = xy(m, v), c = Math.hypot(x - H.contest.x, y - H.contest.y);
    if (c > 45 || c < 8) continue;
    for (let d = 0; d < RAYS; d += 2) shoreReach = Math.max(shoreReach, ray(m, v, d, FAR, true));
  }
  const crossings: Record<string, number> = {};
  if (m.over) { let k0 = 0; for (let k = 0; k < n; k++) if (m.over[k] > 0) k0++; crossings.deckTiles = k0; }
  return { recipe, seed, routes, gap, shoreLock: H.metrics.shoreLock ?? null, shoreReach, crossings };
}

if (process.argv[1]?.endsWith('hablagoon.ts')) {
  const which = (process.argv[2] && !process.argv[2].startsWith('-') ? process.argv[2] : 'tropical-lagoon,river-gorge').split(',');
  const N = Number(process.argv[3] ?? 8), first = Number(process.argv[4] ?? 1), verbose = process.argv.includes('-v');
  const f = (x: number, d = 0) => x.toFixed(d);
  for (const id of which) {
    if (!HABITATS[id]) { console.log(`unknown recipe ${id}`); continue; }
    const agg: Record<string, number[]> = {};
    const push = (k: string, v: number) => (agg[k] ??= []).push(v);
    for (let s = first; s < first + N; s++) {
      const st = measure(id, s);
      for (const r of st.routes) {
        const kind = r.id.split('.')[1];
        push(`${kind} length`, r.length); push(`${kind} bend`, r.bend); push(`${kind} climb`, r.climb); push(`${kind} open`, r.open); push(`${kind} cover`, r.cover); push(`${kind} water`, r.water); push(`${kind} reach`, r.reach); push(`${kind} seen`, r.seen); push(`${kind} first`, r.firstSeen);
      }
      push('gap', (st.gap[0] + st.gap[1]) / 2); push('shoreReach', st.shoreReach); if (st.shoreLock !== null) push('shoreLock', st.shoreLock);
      if (verbose) console.log(`${id} seed ${s}: ${st.routes.map((r) => `${r.id} ${f(r.length)} m bend ${f(r.bend, 2)} climb ${f(r.climb, 1)} open ${f(r.open, 2)} cover ${f(r.cover, 2)} water ${f(r.water, 2)} reach ${f(r.reach)} seen ${f(r.seen * 100)}%@${f(r.firstSeen)}`).join(' | ')} | gap ${f(st.gap[0], 2)}/${f(st.gap[1], 2)} shore reach ${f(st.shoreReach)} lock ${st.shoreLock ?? '-'}`);
    }
    const mean = (k: string) => (agg[k] ?? []).reduce((a, b) => a + b, 0) / Math.max(1, (agg[k] ?? []).length);
    console.log(`\n${id} (${N} seeds from ${first}), means:`);
    for (const kind of ['direct', 'flank']) console.log(`  ${kind.padEnd(6)} length ${f(mean(`${kind} length`))} m, bend ${f(mean(`${kind} bend`), 2)}, climb ${f(mean(`${kind} climb`), 1)} m, open ${f(mean(`${kind} open`), 2)}, cover ${f(mean(`${kind} cover`), 2)}, water beside ${f(mean(`${kind} water`) * 100)} %, longest sightline ${f(mean(`${kind} reach`))} m, point sees ${f(mean(`${kind} seen`) * 100)} % of the last 40 m (first at ${f(mean(`${kind} first`))} m)`);
    console.log(`  exposure gap between a side's two approaches ${f(mean('gap'), 2)}, longest dry-to-dry open line on the low ground ${f(mean('shoreReach'))} m${agg.shoreLock ? `, strongest shore lock ${f(mean('shoreLock') * 100)} %` : ''}`);
  }
}
