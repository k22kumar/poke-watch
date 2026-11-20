// Static route and denial geometry for a Hold on a habitat map, from the final collision (no sim steps):
//   npx tsx scripts/habgeom.ts <river-gorge|volcanic-ridge> [seeds] [--range 14] [-v]
// For each seed: both approaches of each side (length, how long the Raiders' last stretch is in view of the pad), and a scan
// of every standable high position within 32 m of the point: can one watch BOTH of team B's approaches (the last 40 m of
// each) at weapon range, and can the trainer reach it (without a jump) and still stand on the pad? That is the question
// "can the rim, the terrace or the crest deny both routes".
import { createRun } from '../src/sim/run';
import { HABITATS } from '../src/world/habitat';
import { clearance } from '../src/world/habitat/validate';
import { pathBetween, sightTiles, playerReach } from '../src/world/locgen/nav';
import type { SimContext } from '../src/sim/types';

import { RANGE as RANGE_MODE } from '../src/mods';
const arg = (k: string, d: string) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const RANGE = Number(arg('range', '14')), THR = Number(arg('thr', '0.5'));
const EYE = 0.9; // m above the feet for the shooter and the target's centre of mass 0.5

type Path = number[];
interface Geo {
  lenA: [number, number]; lenB: [number, number];
  /** the last stretch of each B approach seen from the pad, in metres of path and as a share of the last 40 m */
  seenFromPad: [number, number]; firstSeen: [number, number];
  /** share of the pad ring (r ≤ 3.8 m) positions that see ≥ 50 % of both B approaches' last 40 m at weapon range */
  padDenies: number;
  /** standable positions off the routes that watch ≥ 50 % of both B routes' last 40 m within range */
  deniers: { n: number; high: number; inRing: number; bestMin: { v: number; tile?: string; y?: number; dPad?: number; cover?: number[] }; best: { tile: string; y: number; dPad: number; cover: [number, number]; reach: number | null; onRoute: boolean } | null };
  kinds: Record<string, number>;
}

function nodeXZ(ctx: SimContext, v: number): [number, number] { const W = ctx.world, n = W.w * W.h, k = v % n; return [(k % W.w) - W.half + 0.5, ((k / W.w) | 0) - W.half + 0.5]; }
function plen(ctx: SimContext, p: Path) { let L = 0; for (let i = 1; i < p.length; i++) { const a = nodeXZ(ctx, p[i - 1]), b = nodeXZ(ctx, p[i]); L += Math.hypot(a[0] - b[0], a[1] - b[1]); } return L; }
/** the last `len` metres of a path (toward the pad), as node indices */
function tail(ctx: SimContext, p: Path, len: number): Path { let acc = 0; const out: Path = [p[p.length - 1]]; for (let i = p.length - 2; i >= 0 && acc < len; i--) { const a = nodeXZ(ctx, p[i]), b = nodeXZ(ctx, p[i + 1]); acc += Math.hypot(a[0] - b[0], a[1] - b[1]); out.push(p[i]); } return out.reverse(); }

export function analyse(recipe: string, seed: number): Geo & { ctx: SimContext } {
  const ctx = createRun({ mode: RANGE_MODE, seed: 1, species: 'bulbasaur', ruleOverrides: { worldgen: { mode: 'generated', regionSeed: seed, locations: { meadow: recipe, dusk: recipe, badlands: recipe, frost: recipe } } } as never });
  // the map's own biome stage does not matter for the geometry; stage 0 is enough
  const W = ctx.world, H = W.hab!, m = W.map, n = W.w * W.h, N = m.over ? 2 * n : n;
  const cl = clearance(m);
  const allow = new Uint8Array(N); for (let v = 0; v < N; v++) allow[v] = cl[v] >= 0.75 ? 1 : 0;
  if (W.hazard) for (let k = 0; k < n; k++) if (W.hazard[k]) allow[k] = 0;
  const tileIdx = (p: [number, number]) => Math.floor(p[1]) * W.w + Math.floor(p[0]);
  const pad = tileIdx([H.contest.x, H.contest.y]);
  const route = (from: [number, number], avoid?: Set<number>) => { const a = new Uint8Array(allow); if (avoid) for (let v = 0; v < N; v++) if (avoid.has(v % n)) a[v] = 0; return pathBetween(m, tileIdx(from), pad, a); };
  const avoidOf = (p: Path, from: [number, number]) => { const s = new Set<number>(); for (const v of p) { const k = v % n, x = k % W.w, y = (k / W.w) | 0; if (Math.hypot(x - H.contest.x, y - H.contest.y) <= H.contest.r + 3 || Math.hypot(x - from[0], y - from[1]) <= 12) continue; for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) s.add((y + dy) * W.w + x + dx); } return s; };
  const A1 = route(H.stage.A)!, A2 = route(H.stage.A, avoidOf(A1, H.stage.A)) ?? A1;
  const B1 = route(H.stage.B)!, B2 = route(H.stage.B, avoidOf(B1, H.stage.B)) ?? B1;
  const topOf = (v: number) => v >= n ? m.over![v - n] : W.height((v % W.w) - W.half + 0.5, (((v % n) / W.w) | 0) - W.half + 0.5);
  const seeFrom = (kx: number, ky: number, hy: number, target: number) => sightTiles(m, ky * W.w + kx, hy, target % n, 0.5) // shooter tile + eye above its surface; the target is a path tile
    && (target < n || true);
  void seeFrom;
  const T1 = tail(ctx, B1, 40), T2 = tail(ctx, B2, 40);
  const padTile = Math.floor(H.contest.y) * W.w + Math.floor(H.contest.x);
  // 1. what the pad sees of the last 40 m of each approach
  const seenFromPad = [T1, T2].map((T) => { let seen = 0, first = Infinity, acc = 0; for (let i = T.length - 1; i >= 0; i--) { const [x, z] = nodeXZ(ctx, T[i]); const d = Math.hypot(x - (H.contest.x - W.half), z - (H.contest.y - W.half)); if (i < T.length - 1) { const [px, pz] = nodeXZ(ctx, T[i + 1]); acc += Math.hypot(px - x, pz - z); } if (d <= RANGE && sightTiles(m, padTile, EYE, T[i] % n, 0.5)) { seen++; first = acc; } } return { share: seen / T.length, first: first === Infinity ? 0 : first }; });
  // 2. every standable position within 32 m of the pad, off both B routes
  const reach = playerReach(m, Math.floor(H.stage.A[1]) * W.w + Math.floor(H.stage.A[0]));
  const onRoute = new Uint8Array(n); for (const p of [B1, B2]) for (const v of p) { const k = v % n, x = k % W.w, y = (k / W.w) | 0; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) onRoute[(y + dy) * W.w + x + dx] = 1; }
  const hMin = Math.min(...[...T1, ...T2].map(topOf));
  let count = 0, high = 0, inRing = 0, ringCount = 0, ringDeny = 0;
  let best: Geo['deniers']['best'] = null; let bestScore = -1;
  const kinds: Record<string, number> = {};
  let bestMin: { v: number; tile?: string; y?: number; dPad?: number; cover?: number[] } = { v: -1 };
  const cover = (v: number): [number, number] => {
    const k = v % n, px = (k % W.w) + 0.5, py = ((k / W.w) | 0) + 0.5, hy = v >= n ? 0 : 0, cs: number[] = [];
    for (const T of [T1, T2]) { let c = 0; for (const t of T) { const [tx, tz] = nodeXZ(ctx, t); if (Math.hypot(tx + W.half - px, tz + W.half - py) > RANGE) continue; if (sightTiles(m, k, EYE + hy, t % n, 0.5)) c++; } cs.push(c / T.length); }
    return [cs[0], cs[1]];
  };
  for (let v = 0; v < N; v++) {
    if (!reach[v]) continue;
    const k = v % n, x = (k % W.w) + 0.5, y = ((k / W.w) | 0) + 0.5, d = Math.hypot(x - H.contest.x, y - H.contest.y);
    if (d > 32) continue;
    if (v < n && (m.wall[k] || m.terrain[k] === 3)) continue;
    const inPad = d <= H.contest.r - 1.2; // where the Hold lets a trainer stand and still count
    if (!inPad && onRoute[k]) continue;
    const h = topOf(v), isHigh = h >= hMin + 1.5;
    const c = cover(v);
    if (inPad) { ringCount++; if (Math.min(...c) >= 0.5) ringDeny++; }
    if (Math.min(...c) > bestMin.v) bestMin = { v: Math.min(...c), tile: `${k % W.w},${(k / W.w) | 0}`, y: +h.toFixed(1), dPad: +d.toFixed(1), cover: [+c[0].toFixed(2), +c[1].toFixed(2)] };
    if (Math.min(...c) < THR) continue;
    count++; if (isHigh) high++; if (inPad) inRing++;
    const kind = inPad ? 'pad' : v >= n ? 'deck' : isHigh ? `high@${h.toFixed(1)}m` : 'low';
    kinds[kind] = (kinds[kind] ?? 0) + 1;
    const score = Math.min(...c) * 100 + (inPad ? 50 : 0) + (isHigh ? 5 : 0) - d * 0.1;
    if (score > bestScore) { bestScore = score; const rp = route(H.stage.A, undefined); void rp; best = { tile: `${k % W.w},${(k / W.w) | 0}`, y: +h.toFixed(1), dPad: +d.toFixed(1), cover: [+c[0].toFixed(2), +c[1].toFixed(2)], reach: null, onRoute: !!onRoute[k] }; }
  }
  if (best) { const [bx, by] = best.tile.split(',').map(Number); const p = pathBetween(m, Math.floor(H.stage.A[1]) * W.w + Math.floor(H.stage.A[0]), by * W.w + bx, allow); best.reach = p ? +plen(ctx, p).toFixed(0) : null; }
  return {
    ctx, lenA: [plen(ctx, A1), plen(ctx, A2)], lenB: [plen(ctx, B1), plen(ctx, B2)],
    seenFromPad: [seenFromPad[0].share, seenFromPad[1].share], firstSeen: [seenFromPad[0].first, seenFromPad[1].first],
    padDenies: ringCount ? ringDeny / ringCount : 0,
    deniers: { n: count, high, inRing, bestMin, best }, kinds,
  };
}

if (process.argv[1]?.endsWith('habgeom.ts')) {
  const which = process.argv[2] ?? 'river-gorge';
  const seeds = (process.argv[3] && !process.argv[3].startsWith('-') ? process.argv[3] : '3').split(',').map(Number);
  for (const id of which === 'all' ? Object.keys(HABITATS) : [which]) for (const s of seeds) {
    const g = analyse(id, s);
    const f = (a: number[]) => a.map((x) => x.toFixed(0)).join('/');
    console.log(`${id} seed ${s}: A ${f(g.lenA)} m, B ${f(g.lenB)} m (direct/flank) | pad sees last 40 m of B: ${g.seenFromPad.map((x) => (x * 100).toFixed(0) + '%').join('/')} first seen ${f(g.firstSeen)} m out | pad ring denies both: ${(g.padDenies * 100).toFixed(0)}% | off-route spots watching both ≥50%: ${g.deniers.n} (high ${g.deniers.high}, on the pad ${g.deniers.inRing}) ${JSON.stringify(g.kinds)} best ${JSON.stringify(g.deniers.best)} | strongest single spot (min cover of the two): ${JSON.stringify(g.deniers.bestMin)}`);
  }
}
