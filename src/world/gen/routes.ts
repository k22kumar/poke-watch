// Stage 4: routes. Roads and trails join the places along the place graph. A* runs over (tile, heading) with a turn
// penalty, so a route is a few long straight runs with corners instead of a wandering line. It
// only takes steps a walker can take (0.5 m, or a stair flight north–south), reuses earlier routes, and crosses water
// only straight, on a bridge of at most 6 tiles (blueprint section 3, "Bridges").
import { T } from '../tiles';
import type { GenCtx, Place } from './context';
import { MARGIN, placeEdges } from './plan';
import { FIX } from './terrain';
import { DIRS4, Heap } from './util';

export const MAX_BRIDGE = 6;

export interface RouteResult { ok: boolean; failed: [string, string][]; crossings: number }

export function buildRoutes(g: GenCtx): RouteResult {
  const edges = placeEdges(g);
  // roads first, so trails can follow them
  edges.sort((a, b) => (a[2] === b[2] ? 0 : a[2] === 'road' ? -1 : 1));
  const failed: [string, string][] = [];
  let crossings = 0;
  // a place whose centre is water (the pond) is reached at its shore, the land tile nearest the other end
  const landing = (p: Place, from: Place): { x: number; y: number } => {
    if (g.m.terrain[g.idx(p.x, p.y)] !== T.water) return p;
    let best = { x: p.x, y: p.y }, bd = 1e18;
    for (let y = p.y - 14; y <= p.y + 14; y++) for (let x = p.x - 14; x <= p.x + 14; x++) {
      if (!g.in(x, y) || g.m.terrain[g.idx(x, y)] === T.water || g.m.wall[g.idx(x, y)]) continue;
      let shore = false;
      for (const [dx, dy] of DIRS4) if (g.in(x + dx, y + dy) && g.m.terrain[g.idx(x + dx, y + dy)] === T.water) shore = true;
      if (!shore) continue;
      const d = (x - from.x) ** 2 + (y - from.y) ** 2;
      if (d < bd) { bd = d; best = { x, y }; }
    }
    return best;
  };
  for (const [a, b, kind] of edges) {
    const path = findRoute(g, landing(a, b), landing(b, a));
    if (!path) { failed.push([a.name, b.name]); continue; }
    crossings += paintRoute(g, path, kind === 'road' ? 3 : 2, kind === 'road' ? T.path : T.dirt, kind === 'road' ? 1 : 2);
  }
  paveBridgeEnds(g);
  return { ok: failed.length === 0, failed, crossings };
}

/** every bridge tile whose long-axis neighbour is land gets that land tile paved, so bridges always land on a route */
export function paveBridgeEnds(g: GenCtx) {
  const S = g.S, m = g.m;
  for (let k = 0; k < S * S; k++) {
    if (m.terrain[k] !== T.wood) continue;
    const x = k % S, y = (k / S) | 0;
    const horiz = (g.in(x - 1, y) && m.terrain[g.idx(x - 1, y)] === T.wood) || (g.in(x + 1, y) && m.terrain[g.idx(x + 1, y)] === T.wood);
    const vert = (g.in(x, y - 1) && m.terrain[g.idx(x, y - 1)] === T.wood) || (g.in(x, y + 1) && m.terrain[g.idx(x, y + 1)] === T.wood);
    const ends: [number, number][] = [];
    if (horiz || !vert) ends.push([x - 1, y], [x + 1, y]);
    if (vert || !horiz) ends.push([x, y - 1], [x, y + 1]);
    for (const [ex, ey] of ends) {
      if (!g.in(ex, ey)) continue;
      const nk = g.idx(ex, ey);
      if (m.terrain[nk] === T.water || m.terrain[nk] === T.wood || g.route[nk] || m.wall[nk]) continue;
      if (Math.abs(m.elev[nk] - 0.05) > 0.6) continue;
      m.terrain[nk] = T.path; g.route[nk] = 2;
    }
  }
}

/** length of the straight water run starting at tile k going in direction d (0 if k is land) */
function waterRun(g: GenCtx, x: number, y: number, d: number) {
  let n = 0;
  while (g.in(x, y) && g.m.terrain[g.idx(x, y)] === T.water) { n++; x += DIRS4[d][0]; y += DIRS4[d][1]; if (n > MAX_BRIDGE + 1) break; }
  return n;
}

function stepOk(g: GenCtx, a: number, b: number) {
  const m = g.m;
  if (m.wall[b]) return false;
  const ta = m.terrain[a], tb = m.terrain[b];
  const ha = ta === T.water || ta === T.wood ? 0.05 : m.elev[a], hb = tb === T.water || tb === T.wood ? 0.05 : m.elev[b];
  if ((m.stairs[a] || m.stairs[b]) && Math.abs(a - b) === g.S) return true;
  if (m.stairs[a] || m.stairs[b]) return false; // no sideways onto a flight
  return Math.abs(ha - hb) <= 0.5;
}

const bufs = new Map<number, { G: Float64Array; from: Int32Array; stamp: Int32Array; cur: number; heap: Heap }>();
function bufFor(n: number) {
  let b = bufs.get(n);
  if (!b) { b = { G: new Float64Array(n), from: new Int32Array(n), stamp: new Int32Array(n), cur: 0, heap: new Heap(8192) }; bufs.set(n, b); }
  if (b.cur > 2e9) { b.stamp.fill(0); b.cur = 0; }
  return b;
}

export function findRoute(g: GenCtx, A: { x: number; y: number }, B: { x: number; y: number }, avoid?: Uint8Array, avoidCost = 0): [number, number][] | null {
  const S = g.S, n = S * S;
  // search buffers reused across routes; a stamp marks which entries belong to this search
  const buf = bufFor(n * 4);
  const G = buf.G, from = buf.from, stamp = buf.stamp, cur = ++buf.cur;
  const H = buf.heap; H.clear();
  const getG = (st: number) => (stamp[st] === cur ? G[st] : Infinity);
  const setG = (st: number, v: number, f: number) => { stamp[st] = cur; G[st] = v; from[st] = f; };
  const s = A.y * S + A.x, t = B.y * S + B.x;
  for (let d = 0; d < 4; d++) { setG(s * 4 + d, 0, -1); H.push(0, s * 4 + d); }
  let end = -1;
  while (H.n) {
    const st = H.pop();
    const a = st >> 2, dir = st & 3;
    if (a === t) { end = st; break; }
    const x = a % S, y = (a / S) | 0;
    const onWater = g.m.terrain[a] === T.water;
    for (let d = 0; d < 4; d++) {
      if (onWater && d !== dir) continue; // straight across water
      if (d === ((dir + 2) & 3)) continue;
      const nx = x + DIRS4[d][0], ny = y + DIRS4[d][1];
      if (nx < 1 || ny < 1 || nx >= S - 1 || ny >= S - 1) continue;
      const b = ny * S + nx;
      const toWater = g.m.terrain[b] === T.water;
      if (toWater && !onWater && waterRun(g, nx, ny, d) > MAX_BRIDGE) continue;
      if (!stepOk(g, a, b)) continue;
      let c = 1;
      if (toWater) c = 4;
      else if (g.route[b]) c = 0.35;
      if (!toWater && Math.abs(g.m.elev[a] - g.m.elev[b]) > 0.01 && !g.m.stairs[b]) c += 1.2;
      if (d !== dir) c += 3;
      const edge = Math.min(nx, ny, S - 1 - nx, S - 1 - ny);
      if (edge < MARGIN - 3) c += 6;
      if (g.fixed[b] === FIX.plateau && !g.route[b]) c += 0.6;
      if (avoid && avoid[b]) c += avoidCost;
      const ng = getG(st) + c;
      const ns = b * 4 + d;
      if (ng < getG(ns)) {
        setG(ns, ng, st);
        H.push(ng + (Math.abs(nx - B.x) + Math.abs(ny - B.y)) * 0.7, ns);
      }
    }
  }
  if (end < 0) return null;
  const out: [number, number][] = [];
  for (let st = end; st >= 0; st = from[st]) {
    const k = st >> 2;
    out.push([k % S, (k / S) | 0]);
    if (k === s) break;
  }
  return out.reverse();
}

/** Paint a route `w` tiles wide; water under it becomes a bridge. Returns how many water crossings it made. */
export function paintRoute(g: GenCtx, path: [number, number][], w: number, t: number, mark: number): number {
  const S = g.S, m = g.m;
  let crossings = 0, wasWater = false;
  for (let i = 0; i < path.length; i++) {
    const [x, y] = path[i];
    const [px, py] = path[Math.max(0, i - 1)], [qx, qy] = path[Math.min(path.length - 1, i + 1)];
    const horiz = Math.abs(qx - px) >= Math.abs(qy - py);
    const k0 = g.idx(x, y);
    const water = m.terrain[k0] === T.water || m.terrain[k0] === T.wood;
    if (water && !wasWater) crossings++;
    wasWater = water;
    // width grows to the south / east of the centre line, like ArenaBuilder.path
    for (let o = -((w - 1) >> 1); o <= w >> 1; o++) {
      // on corners paint a square so the turn stays full width
      const offs: [number, number][] = horiz ? [[0, o]] : [[o, 0]];
      if (i > 0 && i < path.length - 1 && (Math.abs(qx - px) === 1 && Math.abs(qy - py) === 1)) offs.push([o, 0], [0, o]);
      for (const [ox, oy] of offs) {
        const ax = x + ox, ay = y + oy;
        if (!g.in(ax, ay)) continue;
        const k = ay * S + ax;
        if (m.stairs[k]) { g.route[k] = g.route[k] || mark; continue; }
        if (m.terrain[k] === T.water) {
          // only bridge water that the centre line crosses
          if (water) { m.terrain[k] = T.wood; g.route[k] = mark; }
          continue;
        }
        if (m.terrain[k] === T.wood) { g.route[k] = g.route[k] || mark; continue; }
        // a trail never downgrades a road; never paint across a cliff (keep the rim tile as is)
        if (Math.abs(m.elev[k] - m.elev[k0]) > 0.5) continue;
        if (g.route[k] === 1 && mark === 2) continue;
        m.terrain[k] = t; g.route[k] = mark;
      }
    }
  }
  return crossings;
}

/** places a route touches (by clearing radius) */
export function routeTouches(g: GenCtx, p: Place) {
  for (let y = p.y - p.r; y <= p.y + p.r; y++) for (let x = p.x - p.r; x <= p.x + p.r; x++) if (g.in(x, y) && g.route[g.idx(x, y)]) return true;
  return false;
}
