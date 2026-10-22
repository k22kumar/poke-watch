// The validator: hard gates every seed must pass (blueprint section 2) and the rule tests of section 3. Each returns a
// value so the sheet and the 1,000-seed sweep can report distributions, not just pass/fail.
import { dcos, dsin } from '../../core/detmath';
import { T, PROP_RULES, type ArenaMap } from '../tiles';
import { HAB, type GateResult, type GenCtx } from './context';
import { SPECIES_HABITAT } from './ecology';
import { FIX } from './terrain';
import { MARGIN } from './plan';
import { DIRS4, Heap, canStep, d2, navOpen, navTop, walkDist } from './util';

export interface Validation { ok: boolean; gates: GateResult[]; failed: string[] }

export function isCover(kind: string) { const R = PROP_RULES[kind as keyof typeof PROP_RULES]; return !!(R && (R.wall || R.platform)) && kind !== 'sign'; }

/**
 * Cover pieces around (x, y): connected groups (8-neighbour) of blocking prop tiles whose nearest tile lies within
 * [r0, r1] m. A grove, a hedge row or a cabin with its hedge is one piece; a lone rock is one piece. The signpost is
 * not cover.
 */
export function coverAround(m: ArenaMap, x: number, y: number, r0: number, r1: number) {
  const W = m.w, H = m.h, R = Math.ceil(r1) + 6;
  const x0 = Math.max(0, x - R), x1 = Math.min(W - 1, x + R), y0 = Math.max(0, y - R), y1 = Math.min(H - 1, y + R);
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  const blk = new Uint8Array(bw * bh), seen = new Uint8Array(bw * bh);
  for (const p of m.props) {
    if (!isCover(p.kind)) continue;
    if (p.x + p.w < x0 || p.y + p.h < y0 || p.x > x1 || p.y > y1) continue;
    for (let j = p.y; j < p.y + p.h; j++) for (let i = p.x; i < p.x + p.w; i++) if (i >= x0 && j >= y0 && i <= x1 && j <= y1) blk[(j - y0) * bw + i - x0] = 1;
  }
  let n = 0;
  const q: number[] = [];
  for (let k = 0; k < bw * bh; k++) {
    if (!blk[k] || seen[k]) continue;
    seen[k] = 1; q.length = 0; q.push(k);
    let md = 1e9;
    while (q.length) {
      const a = q.pop()!, ax = a % bw, ay = (a / bw) | 0;
      md = Math.min(md, d2(ax + x0, ay + y0, x, y));
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = ax + dx, ny = ay + dy;
        if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue;
        const nk = ny * bw + nx;
        if (blk[nk] && !seen[nk]) { seen[nk] = 1; q.push(nk); }
      }
    }
    if (md >= r0 * r0 && md <= r1 * r1) n++;
  }
  return n;
}

/** no wall, water or blocking prop within r of (x, y) (tall grass, flowers and the signpost are fine) */
export function openRadius(m: ArenaMap, x: number, y: number) {
  const sign = new Set<number>();
  for (const p of m.props) if (p.kind === 'sign') sign.add(p.y * m.w + p.x);
  let r = 0;
  for (; r < 20; r++) {
    let ok = true;
    for (let dy = -r; dy <= r && ok; dy++) for (let dx = -r; dx <= r && ok; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      const i = x + dx, j = y + dy;
      if (i < 0 || j < 0 || i >= m.w || j >= m.h) { ok = false; break; }
      const k = j * m.w + i;
      if (sign.has(k)) continue;
      if (m.wall[k] || m.platform[k] > 0 || m.terrain[k] === T.water) ok = false;
    }
    if (!ok) break;
  }
  return r - 1;
}

/** walkable entrances into a clearing: separate arcs of walkable ring tiles at radius r */
export function entrances(m: ArenaMap, x: number, y: number, r: number) {
  const ring: boolean[] = [];
  const N = 48;
  for (let a = 0; a < N; a++) {
    const ang = (a / N) * Math.PI * 2;
    // detmath not needed: this runs only in the validator, which is not part of the replayed state
    const i = Math.round(x + dcos(ang) * r), j = Math.round(y + dsin(ang) * r);
    ring.push(i >= 0 && j >= 0 && i < m.w && j < m.h && navOpen(m, j * m.w + i));
  }
  if (ring.every(Boolean)) return 99;
  // each walkable arc is one way in; an arc wider than half the ring is an open side, at least two ways in
  let ways = 0;
  for (let a = 0; a < N; a++) {
    if (!ring[a] || ring[(a + N - 1) % N]) continue;
    let L = 0;
    while (L < N && ring[(a + L) % N]) L++;
    ways += L > N / 2 ? 2 : 1;
  }
  return ways;
}

/** shortest walking path between two tiles; tiles in `penal` cost `cost` instead of 1 (Dial's bucket queue: integer
 *  costs, so it is a BFS-speed Dijkstra; ties pop in insertion order, deterministic) */
export function walkPath(m: ArenaMap, a: number, b: number, penal?: Uint8Array, cost = 1): number[] | null {
  const W = m.w, n = W * m.h, NB = Math.max(1, cost) + 1;
  const G = new Int32Array(n).fill(0x7fffffff), from = new Int32Array(n).fill(-1);
  const buckets: number[][] = Array.from({ length: NB }, () => []);
  G[a] = 0; buckets[0].push(a);
  let pending = 1;
  for (let d = 0; pending > 0; d++) {
    const bk = buckets[d % NB];
    for (let q = 0; q < bk.length; q++) {
      const k = bk[q];
      if (G[k] !== d) continue;
      if (k === b) { pending = 0; break; }
      const x = k % W, y = (k / W) | 0;
      for (const [dx, dy] of DIRS4) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= m.h) continue;
        const nk = ny * W + nx;
        const nd = d + (penal && penal[nk] ? cost : 1);
        if (nd >= G[nk] || !canStep(m, k, nk)) continue;
        G[nk] = nd; from[nk] = k; buckets[nd % NB].push(nk); pending++;
      }
    }
    pending -= bk.length; bk.length = 0;
    if (G[b] !== 0x7fffffff && G[b] <= d) break;
  }
  if (G[b] === 0x7fffffff) return null;
  const out: number[] = [];
  for (let k = b; k >= 0; k = from[k]) { out.push(k); if (k === a) break; }
  return out.reverse();
}

export function validate(g: GenCtx, reachBeforeSeal: number): Validation {
  const m = g.m, S = g.S, gates: GateResult[] = [];
  const add = (id: string, ok: boolean, value: string) => gates.push({ id, ok, value });
  const spawn = m.spawn[1] * S + m.spawn[0];
  const D = walkDist(m, spawn);
  const reach = (x: number, y: number) => D[y * S + x] >= 0;
  // 1. sites reachable by walking
  const unreached: string[] = [];
  if (!reach(m.bossSpot[0], m.bossSpot[1])) unreached.push('boss');
  for (const l of m.landmarks) if (!reachNear(m, D, l.x, l.y, 3)) unreached.push(l.name);
  for (const [x, y] of g.sites) if (!reach(x, y)) unreached.push('site');
  for (const [x, y] of m.chestSpots) if (!reach(x, y)) unreached.push(`chest ${x},${y}`);
  add('reach', unreached.length === 0, unreached.length ? 'unreached: ' + unreached.join(', ') : 'all sites');
  // 2. reachable share of open ground (before pockets are sealed)
  add('reachShare', reachBeforeSeal >= 0.55, (reachBeforeSeal * 100).toFixed(0) + '%');
  // 3. spawn clearing
  const hubOpen = openRadius(m, m.spawn[0], m.spawn[1]);
  const hubCover = coverAround(m, m.spawn[0], m.spawn[1], 0, 22);
  add('spawnOpen', hubOpen >= 12, `r ${hubOpen}`);
  add('spawnCover', hubCover >= 4 && hubCover <= 12, `${hubCover} pieces`);
  // 4. boss glade
  const bossOpen = openRadius(m, m.bossSpot[0], m.bossSpot[1]);
  const bossEnt = entrances(m, m.bossSpot[0], m.bossSpot[1], 10);
  add('bossGlade', bossOpen >= 7 && bossEnt >= 2, `r ${bossOpen}, ${bossEnt === 99 ? 'open ring' : bossEnt + ' entrances'}`);
  // 5. a loop: a second spawn→boss path sharing under half of the first, at most 1.8× its length
  const boss = m.bossSpot[1] * S + m.bossSpot[0];
  const p1 = walkPath(m, spawn, boss);
  let loopOk = false, loopVal = 'no path';
  if (p1) {
    const pen = new Uint8Array(S * S);
    for (const k of p1) pen[k] = 1;
    // penalise a 1-tile band around the first path too, so the second cannot hug it
    for (const k of p1) { const x = k % S, y = (k / S) | 0; for (const [dx, dy] of DIRS4) if (g.in(x + dx, y + dy)) pen[g.idx(x + dx, y + dy)] = 1; }
    const p2 = walkPath(m, spawn, boss, pen, 12);
    if (p2) {
      let shared = 0;
      const s1 = new Set(p1);
      for (const k of p2) if (s1.has(k)) shared++;
      const share = shared / p2.length, ratio = p2.length / p1.length;
      loopOk = share < 0.5 && ratio <= 1.8;
      loopVal = `shared ${(share * 100).toFixed(0)}%, ×${ratio.toFixed(2)} (${p1.length}/${p2.length} tiles)`;
    }
  }
  add('loop', loopOk, loopVal);
  // 6. verticality and a lookout with one access
  let walk = 0, high = 0;
  for (let k = 0; k < S * S; k++) if (D[k] >= 0) { walk++; if (m.elev[k] >= 1) high++; }
  const vshare = high / Math.max(1, walk);
  const look = g.lookouts.filter((l) => l.ramps === 1 && reachNear(m, D, l.x, l.y, 2));
  add('vertical', vshare >= 0.08 && vshare <= 0.25, (vshare * 100).toFixed(1) + '% at ≥ 1 m');
  add('lookout', look.length >= 1, `${look.length} reachable lookout(s) with one access`);
  // 7. encounter kinds, water share, no single ground type over 45 % of walkable area
  const kinds = new Set(g.spaces.map((s) => s.kind).filter((k) => k !== 'hub'));
  add('spaces', kinds.size >= 3, [...kinds].join(', ') || 'none');
  let water = 0;
  const byType = new Map<number, number>();
  for (let k = 0; k < S * S; k++) {
    if (m.terrain[k] === T.water || m.terrain[k] === T.wood) water++;
    if (D[k] >= 0) byType.set(m.terrain[k], (byType.get(m.terrain[k]) ?? 0) + 1);
  }
  const ws = water / (S * S);
  add('water', ws >= 0.03 && ws <= 0.09, (ws * 100).toFixed(1) + '%');
  // the blueprint asks for no ground type over 45 %; the authored Meadow is 78 % plain grass, so plain grass is held to
  // 80 % (the authored baseline plus 2) and every other type to 45 % (docs/WORLDGEN.md, "Gates")
  let top = 0, topT = 0;
  for (const [t, n] of byType) if (n > top) { top = n; topT = t; }
  const tshare = top / Math.max(1, walk);
  add('groundMix', tshare <= (topT === T.grass ? 0.8 : 0.45), `${Object.keys(T).find((k) => T[k as keyof typeof T] === topT)} ${(tshare * 100).toFixed(0)}%`);
  // ---- section 3 rule tests
  // cliffs: no step of 0.75 m or more between walkable neighbours unless it is an intended cliff
  let accidental = 0;
  for (let k = 0; k < S * S; k++) {
    if (!navOpen(m, k) || m.stairs[k]) continue;
    const x = k % S, y = (k / S) | 0;
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      if (!g.in(x + dx, y + dy)) continue;
      const nk = g.idx(x + dx, y + dy);
      if (!navOpen(m, nk) || m.stairs[nk]) continue;
      if (Math.abs(m.elev[k] - m.elev[nk]) >= 0.75 && !(g.cliffOk[k] && g.cliffOk[nk])) accidental++;
    }
  }
  add('cliffs', accidental === 0, `${accidental} unintended steps`);
  // bridges land on routes: each bridge's two ends (along its long axis) step onto route tiles
  const badBridge = bridgeEnds(g);
  add('bridges', badBridge === 0, `${badBridge} bridge ends off a route`);
  // rivers never cross the ridge
  let rc = 0;
  for (let k = 0; k < S * S; k++) if (g.ridge[k] && m.terrain[k] === T.water) rc++;
  add('rivers', rc === 0, rc ? `${rc} water tiles on the ridge` : 'ok');
  // lakes: at most 2 still bodies, each in a basin (ring 3–5 tiles out averages 0.5 m or more above the water,
  // or is sand bank and rising ground)
  const lakes = stillBodies(g);
  add('lakes', lakes.count <= 2 && lakes.basins === lakes.count, `${lakes.count} lake(s), ${lakes.basins} in a basin`);
  // grove edges feathered: no straight run of more than 12 wall tiles bordering open ground
  const run = longestWallEdge(g);
  add('groveEdge', run <= 12, `longest straight edge ${run}`);
  // settlement: every cabin door faces the street and is reachable
  let doors = 0, cabins = 0;
  for (const p of m.props) if (p.kind === 'cabin') {
    cabins++;
    const dx = p.x + 1, dy = p.y + p.h;
    if (g.in(dx, dy) && D[g.idx(dx, dy)] >= 0 && (g.route[g.idx(dx, dy + 1)] || g.route[g.idx(dx, dy)])) doors++;
  }
  add('hamlet', cabins >= 3 && cabins <= 5 && doors === cabins, `${cabins} cabins, ${doors} doors on the street`);
  // habitat: each spawn-table species of the region has a matching zone
  const missing: string[] = [];
  for (const sp of g.spawnSpecies) {
    const need = SPECIES_HABITAT[sp];
    if (!need) continue;
    let found = 0;
    for (let k = 0; k < S * S && found < 30; k++) if (D[k] >= 0 && g.habitat[k] & need) found++;
    if (found < 30) missing.push(sp);
  }
  add('habitat', missing.length === 0, missing.length ? 'no zone for ' + missing.join(', ') : `${g.spawnSpecies.length} species matched`);
  void HAB; void FIX;
  const failed = gates.filter((x) => !x.ok).map((x) => x.id);
  return { ok: failed.length === 0, gates, failed };
}

function reachNear(m: ArenaMap, D: Int32Array, x: number, y: number, r: number) {
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const i = x + dx, j = y + dy;
    if (i >= 0 && j >= 0 && i < m.w && j < m.h && D[j * m.w + i] >= 0) return true;
  }
  return false;
}

/** Lakes: at most 2 still bodies, each in a basin — a rim 0.5 m or higher on at least 3 of its 4 sides (the mean height
 *  of the land 2–6 tiles beyond the water, per quadrant). */
function stillBodies(g: GenCtx) {
  const m = g.m;
  let basins = 0;
  for (const [cx, cy, rx, ry] of g.lakes) {
    const sum = [0, 0, 0, 0], n = [0, 0, 0, 0];
    for (let y = Math.floor(cy - ry - 7); y <= cy + ry + 7; y++) for (let x = Math.floor(cx - rx - 7); x <= cx + rx + 7; x++) {
      if (!g.in(x, y)) continue;
      const k = g.idx(x, y);
      if (m.terrain[k] === T.water || m.terrain[k] === T.wood) continue;
      // land 2–5 tiles beyond the water's edge
      const ax = (x - cx) / rx, ay = (y - cy) / ry, rr = Math.sqrt(ax * ax + ay * ay) * Math.min(rx, ry) - Math.min(rx, ry);
      if (rr < 2 || rr > 5) continue;
      const q = Math.abs(x - cx) > Math.abs(y - cy) ? (x > cx ? 0 : 2) : y > cy ? 1 : 3;
      sum[q] += m.elev[k]; n[q]++;
    }
    let sides = 0;
    for (let q = 0; q < 4; q++) if (n[q] && sum[q] / n[q] >= 0.5) sides++;
    if (sides >= 3) basins++;
  }
  return { count: g.lakes.length, basins };
}

export const TREE_KINDS = new Set(['tree', 'tree2', 'round', 'blossom', 'deadtree', 'icepine', 'boulder']);

/** tiles covered by tree masses (hedges, fences and buildings are deliberate straight lines and do not count) */
export function treeMask(m: ArenaMap) {
  const out = new Uint8Array(m.w * m.h);
  for (const p of m.props) if (TREE_KINDS.has(p.kind)) for (let j = p.y; j < p.y + p.h; j++) for (let i = p.x; i < p.x + p.w; i++) if (i < m.w && j < m.h) out[j * m.w + i] = 1;
  return out;
}

function bridgeEnds(g: GenCtx) {
  const S = g.S, m = g.m, seen = new Uint8Array(S * S);
  let bad = 0;
  for (let k = 0; k < S * S; k++) {
    if (m.terrain[k] !== T.wood || seen[k]) continue;
    const comp: number[] = [], q = [k]; seen[k] = 1;
    while (q.length) { const a = q.pop()!; comp.push(a); const x = a % S, y = (a / S) | 0; for (const [dx, dy] of DIRS4) { if (!g.in(x + dx, y + dy)) continue; const nk = g.idx(x + dx, y + dy); if (!seen[nk] && m.terrain[nk] === T.wood) { seen[nk] = 1; q.push(nk); } } }
    let x0 = S, x1 = 0, y0 = S, y1 = 0;
    for (const a of comp) { const x = a % S, y = (a / S) | 0; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const horiz = x1 - x0 >= y1 - y0;
    for (const a of comp) {
      const x = a % S, y = (a / S) | 0;
      const ends: [number, number][] = horiz ? [[x - 1, y], [x + 1, y]] : [[x, y - 1], [x, y + 1]];
      for (const [ex, ey] of ends) {
        if (!g.in(ex, ey)) continue;
        const nk = g.idx(ex, ey), t = m.terrain[nk];
        if (t === T.water || t === T.wood) continue;
        if (!g.route[nk]) bad++;
      }
    }
  }
  return bad;
}

function longestWallEdge(g: GenCtx) {
  const S = g.S, m = g.m, tree = treeMask(m);
  let best = 0;
  // horizontal edges: wall tile with open tile below (or above)
  for (const side of [1, -1]) {
    for (let y = 1; y < S - 1; y++) {
      let run = 0;
      for (let x = 0; x < S; x++) {
        const k = g.idx(x, y), nk = g.idx(x, y + side);
        const edge = tree[k] && !m.wall[nk] && m.terrain[nk] !== T.water && x > MARGIN && x < S - MARGIN && y > MARGIN && y < S - MARGIN;
        run = edge ? run + 1 : 0;
        if (run > best) best = run;
      }
    }
    for (let x = 1; x < S - 1; x++) {
      let run = 0;
      for (let y = 0; y < S; y++) {
        const k = g.idx(x, y), nk = g.idx(x + side, y);
        const edge = tree[k] && !m.wall[nk] && m.terrain[nk] !== T.water && x > MARGIN && x < S - MARGIN && y > MARGIN && y < S - MARGIN;
        run = edge ? run + 1 : 0;
        if (run > best) best = run;
      }
    }
  }
  return best;
}
