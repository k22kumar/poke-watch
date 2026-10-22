// Stage 7: the gameplay pass (blueprint section 4). The director spawns on a ring around the player, so what matters is
// what surrounds the player along the routes. This pass shapes and measures encounter spaces:
//   hub clearing — open radius ≥ 10 m at spawn and junctions, cover at the edge, two or more exits
//   chokepoint   — a route 3–5 tiles wide between cliff, water or grove
//   overlook     — a plateau ≥ 1 m with one access and a view over a route
//   grove        — a tree mass with lanes through it
//   water edge   — a bridge or ford with wet ground around it
// then sets cover at the spawn clearing (4–12 pieces within 22 m, none within 12 m) and the chest spots.
import { dcos, dsin } from '../../core/detmath';
import { T, PROP_RULES, type ArenaPropKind } from '../tiles';
import type { GenCtx, Space, SpaceKind } from './context';
import { kindsOf } from './kit';
import { FIX, cutAccess, markRims } from './terrain';
import { findRoute, paintRoute, paveBridgeEnds } from './routes';
import { stampLookout } from './kit';
import { MARGIN } from './plan';
import { coverAround, isCover } from './validate';
import { d2, hashf, navOpen, walkDist as walkDistFn } from './util';

/** props the gameplay pass may move or remove (never landmarks, buildings or stamps) */
const LOOSE = new Set(['tree', 'tree2', 'round', 'bush', 'bushR', 'bushB', 'rock', 'stump', 'log', 'deadtree', 'icepine', 'mushroom']);

/** is every prop on tile k a loose one (trees, bushes, rocks)? */
function looseAt(g: GenCtx, k: number) {
  const x = k % g.S, y = (k / g.S) | 0;
  return g.m.props.every((p) => x < p.x || y < p.y || x >= p.x + p.w || y >= p.y + p.h || LOOSE.has(p.kind));
}

/** remove every prop overlapping tile k (restores wall/platform/tall grass) */
export function clearTile(g: GenCtx, k: number) {
  const m = g.m, S = g.S, x = k % S, y = (k / S) | 0;
  for (let i = m.props.length - 1; i >= 0; i--) {
    const p = m.props[i];
    if (x < p.x || y < p.y || x >= p.x + p.w || y >= p.y + p.h) continue;
    m.props.splice(i, 1);
    for (let j = p.y; j < p.y + p.h; j++) for (let ii = p.x; ii < p.x + p.w; ii++) {
      if (!g.in(ii, j)) continue;
      const kk = g.idx(ii, j);
      m.wall[kk] = 0; m.platform[kk] = 0;
      if (p.kind === 'tall' && m.terrain[kk] === T.tall) m.terrain[kk] = T.grass;
    }
  }
}

/** Spawn clearing: clear blockers within 12 m, then cover clusters at 13–21 m until 6–10 pieces stand within 22 m. */
export function shapeHub(g: GenCtx) {
  const m = g.m, [hx, hy] = m.spawn, R = g.rng('gameplay:hub'), K = kindsOf(g.biome);
  for (let y = hy - 12; y <= hy + 12; y++) for (let x = hx - 12; x <= hx + 12; x++) {
    if (!g.in(x, y) || d2(x, y, hx, hy) > 144) continue;
    const k = g.idx(x, y);
    if (m.wall[k] || m.platform[k] > 0) {
      // only clear what is in the way: a tree whose footprint touches the radius goes entirely
      const sign = m.props.find((p) => p.kind === 'sign' && x >= p.x && y >= p.y && x < p.x + p.w && y < p.y + p.h);
      if (!sign) clearTile(g, k);
    }
  }
  const want = 6 + R.int(0, 2);
  for (let t = 0; t < 200 && coverAround(m, hx, hy, 0, 22) < want; t++) {
    const a = R.range(0, Math.PI * 2), r = R.range(14, 20);
    const cx = Math.round(hx + dcos(a) * r), cy = Math.round(hy + dsin(a) * r);
    // a cluster of 2–3 low pieces, off the routes
    const n = R.int(2, 3);
    for (let i = 0; i < n; i++) {
      const x = cx + R.int(-1, 1), y = cy + R.int(-1, 1);
      if (!g.in(x, y) || g.route[g.idx(x, y)] || g.keepOpen[g.idx(x, y)] && d2(x, y, hx, hy) < 169) continue;
      if (d2(x, y, hx, hy) < 13 * 13) continue;
      const kind = K.low[R.int(0, K.low.length - 1)];
      g.b.prop(kind, x, y);
    }
  }
  // too many pieces: drop the farthest lone pieces until at most 12
  for (let guard = 0; guard < 60 && coverAround(m, hx, hy, 0, 22) > 12; guard++) {
    let worst = -1, wd = -1;
    m.props.forEach((p, i) => { if (!isCover(p.kind) || p.w * p.h > 4 || !LOOSE.has(p.kind)) return; const dd = d2(p.x, p.y, hx, hy); if (dd <= 22 * 22 && dd >= 13 * 13 && dd > wd) { wd = dd; worst = i; } });
    if (worst < 0) break;
    clearTile(g, g.idx(m.props[worst].x, m.props[worst].y));
  }
}

/** Light cover across the open map, like the authored arena's low-prop sprinkle: rocks, bushes, logs, stumps. */
export function sprinkleCover(g: GenCtx) {
  const S = g.S, m = g.m, K = kindsOf(g.biome), s = g.rng('gameplay:cover').int(1, 1e6);
  for (let y = 10; y < S - 10; y++) for (let x = 10; x < S - 10; x++) {
    const k = g.idx(x, y);
    if (g.route[k] || g.keepOpen[k] || m.terrain[k] !== T.grass) continue;
    if (hashf(x, y, s) < 0.011) g.b.prop(K.low[Math.floor(hashf(x, y, s, 1) * K.low.length)] as ArenaPropKind, x, y);
  }
}

/** sample route tiles and classify the space around each (blueprint section 4) */
export function measureSpaces(g: GenCtx): Space[] {
  const S = g.S, m = g.m;
  const routeTiles: number[] = [];
  for (let k = 0; k < S * S; k++) if (g.route[k] && navOpen(m, k)) routeTiles.push(k);
  const out: Space[] = [];
  const step = Math.max(1, Math.floor(routeTiles.length / 64));
  const openFrac = (x: number, y: number, r: number) => {
    let o = 0, n = 0;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r || !g.in(x + dx, y + dy)) continue;
      n++; if (navOpen(m, g.idx(x + dx, y + dy))) o++;
    }
    return o / Math.max(1, n);
  };
  const count = (x: number, y: number, r: number, f: (k: number) => boolean) => {
    let c = 0;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r && g.in(x + dx, y + dy) && f(g.idx(x + dx, y + dy))) c++;
    return c;
  };
  const push = (kind: SpaceKind, x: number, y: number, score: number) => {
    if (out.some((s) => s.kind === kind && d2(s.x, s.y, x, y) < 14 * 14)) return;
    out.push({ kind, x, y, score });
  };
  for (let i = 0; i < routeTiles.length; i += step) {
    const k = routeTiles[i], x = k % S, y = (k / S) | 0;
    const o8 = openFrac(x, y, 8);
    // perpendicular walkable width through the tile (narrowest of the two axes)
    const width = (dx: number, dy: number) => { let w = 1; for (const s of [-1, 1]) for (let t = 1; t < 9; t++) { const a = x + dx * s * t, b = y + dy * s * t; if (!g.in(a, b) || !navOpen(m, g.idx(a, b)) || Math.abs(m.elev[g.idx(a, b)] - m.elev[k]) > 0.6) break; w++; } return w; };
    const wmin = Math.min(width(1, 0), width(0, 1));
    const trees = count(x, y, 7, (q) => m.wall[q] === 1);
    const water = count(x, y, 6, (q) => m.terrain[q] === T.water);
    const bridge = count(x, y, 6, (q) => m.terrain[q] === T.wood);
    if (o8 >= 0.85 && wmin >= 12) push('hub', x, y, o8);
    if (wmin >= 3 && wmin <= 5) push('choke', x, y, 1 / wmin);
    if (trees >= 40 && o8 >= 0.3 && o8 <= 0.7) push('grove', x, y, trees);
    if (water >= 8 && bridge >= 3) push('water', x, y, water);
  }
  for (const l of g.lookouts) if (l.ramps === 1 && l.height >= 1) push('overlook', l.x, l.y, l.height);
  return out;
}

/** add a chokepoint: grove masses on both sides of a straight route run, 3–4 tiles apart */
export function addChoke(g: GenCtx): boolean {
  const S = g.S, m = g.m, K = kindsOf(g.biome), R = g.rng('gameplay:choke');
  for (let t = 0; t < 400; t++) {
    const x = R.int(16, S - 17), y = R.int(16, S - 17);
    const k = g.idx(x, y);
    if (g.route[k] !== 1 && g.route[k] !== 2) continue;
    if (g.keepOpen[k]) continue;
    const horiz = [-3, -2, -1, 1, 2, 3].every((d) => g.in(x + d, y) && g.route[g.idx(x + d, y)]);
    const vert = [-3, -2, -1, 1, 2, 3].every((d) => g.in(x, y + d) && g.route[g.idx(x, y + d)]);
    if (!horiz && !vert) continue;
    // route edges
    let lo = 0, hi = 0;
    const px = horiz ? 0 : 1, py = horiz ? 1 : 0;
    while (lo > -4 && g.route[g.idx(x + px * (lo - 1), y + py * (lo - 1))]) lo--;
    while (hi < 4 && g.route[g.idx(x + px * (hi + 1), y + py * (hi + 1))]) hi++;
    let placed = 0;
    for (let s = -4; s <= 4; s += 2) {
      const ax = x + (horiz ? s : 0), ay = y + (horiz ? 0 : s);
      for (const side of [lo - 3, hi + 1]) {
        const tx = ax + px * side, ty = ay + py * side;
        if (!g.in(tx, ty) || g.keepOpen[g.idx(tx, ty)]) continue;
        if (g.b.prop(K.clump[(placed + s) & 1 ? 0 : 1], tx, ty)) placed++;
      }
    }
    if (placed >= 6) { g.notes.push(`chokepoint added at ${x},${y}`); return true; }
  }
  return false;
}

/** chest spots: landmarks already have some; add grove interiors and route dead ends until there are 10 */
export function chestSpots(g: GenCtx) {
  const S = g.S, m = g.m, R = g.rng('gameplay:chests');
  for (let t = 0; t < 400 && m.chestSpots.length < 10; t++) {
    const x = R.int(14, S - 15), y = R.int(14, S - 15);
    const k = g.idx(x, y);
    if (!navOpen(m, k) || g.route[k] || m.terrain[k] === T.tall || g.fixed[k] === FIX.ramp) continue;
    // tucked away: walls on 2+ sides within 2 tiles, or high ground
    let walls = 0;
    for (const [dx, dy] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) if (g.in(x + dx, y + dy) && m.wall[g.idx(x + dx, y + dy)]) walls++;
    if (walls < 2 && m.elev[k] < 1) continue;
    if (m.chestSpots.some(([cx, cy]) => d2(cx, cy, x, y) < 15 * 15)) continue;
    if (d2(x, y, m.spawn[0], m.spawn[1]) < 14 * 14) continue;
    m.chestSpots.push([x, y]);
  }
}

/** a trail from a to b that may go through trees (it clears them) but obeys steps and water */
export function cutTrail(g: GenCtx, a: [number, number], b: [number, number], avoid?: Uint8Array): boolean {
  const m = g.m;
  // lift prop walls so the route can pass; restore what the path does not touch
  // only trees, bushes and rocks may be cleared: buildings, landmarks and stamps stay walls
  const saved = m.wall.slice();
  for (const p of m.props) if (LOOSE.has(p.kind)) for (let j = p.y; j < p.y + p.h; j++) for (let i = p.x; i < p.x + p.w; i++) if (g.in(i, j)) m.wall[g.idx(i, j)] = 0;
  const path = findRoute(g, { x: a[0], y: a[1] }, { x: b[0], y: b[1] }, avoid, 10);
  m.wall.set(saved);
  if (!path) return false;
  for (const [x, y] of path) for (let o = 0; o <= 1; o++) {
    for (const [ox, oy] of [[o, 0], [0, o]]) if (g.in(x + ox, y + oy)) { const k = g.idx(x + ox, y + oy); if ((m.wall[k] || m.platform[k] > 0) && looseAt(g, k)) clearTile(g, k); }
  }
  paintRoute(g, path, 2, T.dirt, 2);
  paveBridgeEnds(g);
  return true;
}

/** Repair for verticality: raise one more lookout plateau beside a route, with one access and a trail to it. */
export function addLookout(g: GenCtx): boolean {
  const S = g.S, m = g.m, R = g.rng('gameplay:lookout');
  let best: [number, number] | null = null, bs = -1e9;
  for (let y = MARGIN + 6; y < S - MARGIN - 6; y += 2) for (let x = MARGIN + 6; x < S - MARGIN - 6; x += 2) {
    if (g.places.some((p) => d2(x, y, p.x, p.y) < (p.r + 10) ** 2)) continue;
    const e0 = m.elev[g.idx(x, y)];
    let ok = true, nearRoute = 99;
    for (let dy = -7; dy <= 7 && ok; dy++) for (let dx = -8; dx <= 8 && ok; dx++) {
      const k = g.idx(x + dx, y + dy);
      if (m.terrain[k] === T.water || m.terrain[k] === T.wood || g.keepOpen[k] || g.fixed[k] === FIX.plateau || g.fixed[k] === FIX.ramp || m.stairs[k]) ok = false;
      else if (Math.abs(dx) <= 6 && Math.abs(dy) <= 5 && (g.route[k] || Math.abs(m.elev[k] - e0) > 0.01)) ok = false;
      if (g.route[k]) nearRoute = Math.min(nearRoute, Math.max(Math.abs(dx), Math.abs(dy)));
    }
    if (!ok || nearRoute > 7) continue;
    const score = -nearRoute + hashf(x, y, g.seed) * 0.5;
    if (score > bs) { bs = score; best = [x, y]; }
  }
  if (!best) return false;
  const [cx, cy] = best;
  const h = (m.elev[g.idx(cx, cy)] ?? 0) + R.pick([1.5, 2]);
  const tiles: number[] = [];
  for (let y = cy - 4; y <= cy + 4; y++) for (let x = cx - 5; x <= cx + 5; x++) {
    const ax = (x + 0.5 - cx) / 5.2, ay = (y + 0.5 - cy) / 4.2;
    if (ax * ax + ay * ay > 1) continue;
    const k = g.idx(x, y);
    tiles.push(k);
  }
  // clear what stands there, raise it, mark its rim
  for (let y = cy - 6; y <= cy + 6; y++) for (let x = cx - 7; x <= cx + 7; x++) { const k = g.idx(x, y); if (m.wall[k] || m.platform[k] > 0 || m.terrain[k] === T.tall) clearTile(g, k); }
  for (const k of tiles) { m.elev[k] = h; g.fixed[k] = FIX.plateau; }
  markRims(g, tiles);
  // access toward the nearest route tile
  let rt: [number, number] = [cx, cy], rd = 1e9;
  for (let y = cy - 10; y <= cy + 10; y++) for (let x = cx - 10; x <= cx + 10; x++) if (g.in(x, y) && g.route[g.idx(x, y)] && d2(x, y, cx, cy) < rd) { rd = d2(x, y, cx, cy); rt = [x, y]; }
  const door = cutAccess(g, new Set(tiles), h, rt[0], rt[1]);
  if (!door) {
    for (const k of tiles) { m.elev[k] = h - (h - (m.elev[g.idx(cx, cy + 6)] ?? 0)); g.fixed[k] = 0; }
    return false;
  }
  cutTrail(g, door, rt);
  const names = ['Kite Hill', 'Breezy Knoll', 'Lark Rise', 'Thistle Top'];
  const name = names[g.lookouts.length % names.length];
  const place = { id: g.places.length, kind: 'lookout' as const, x: cx, y: cy, r: 4, name, elev: h, door };
  g.places.push(place);
  g.lookouts.push({ x: cx, y: cy, w: 10, h: 8, height: h, ramps: 1, name });
  stampLookout(g, place);
  g.notes.push(`lookout added at ${cx},${cy}`);
  return true;
}

/**
 * Pockets: walkable ground the routes never reach (a far bank, a shelf boxed in by cliffs). sealPockets would make
 * them invisible walls, which on open grass reads as a bug. Large pockets get a trail from the spawn when a legal one
 * exists (it may bridge water or climb a ramp); whatever is still unreachable is planted as forest, so what looks
 * walkable is walkable and what is blocked looks blocked.
 */
export function resolvePockets(g: GenCtx) {
  const S = g.S, m = g.m, K = kindsOf(g.biome);
  const spawnK = m.spawn[1] * S + m.spawn[0];
  for (let pass = 0; pass < 6; pass++) {
    const D = walkDistLocal(g, spawnK);
    // largest unreachable component
    const seen = new Uint8Array(S * S);
    let best: number[] = [];
    for (let k = 0; k < S * S; k++) {
      if (seen[k] || D[k] >= 0 || !navOpen(m, k)) continue;
      const comp: number[] = [], q = [k]; seen[k] = 1;
      while (q.length) { const a = q.pop()!; comp.push(a); const x = a % S, y = (a / S) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (!g.in(nx, ny)) continue; const nk = g.idx(nx, ny); if (!seen[nk] && D[nk] < 0 && navOpen(m, nk)) { seen[nk] = 1; q.push(nk); } } }
      const inner = comp.filter((a) => { const x = a % S, y = (a / S) | 0; return x > MARGIN && y > MARGIN && x < S - MARGIN && y < S - MARGIN; }).length;
      if (inner > best.length) best = comp;
    }
    if (best.length < 30) break;
    // nearest tile of it to the spawn
    let t = best[0], td = 1e18;
    for (const a of best) { const dd = d2(a % S, (a / S) | 0, m.spawn[0], m.spawn[1]); if (dd < td) { td = dd; t = a; } }
    if (!cutTrail(g, m.spawn, [t % S, (t / S) | 0])) {
      plantPocket(g, best, K);
    }
  }
  // what is left unreachable inside the region becomes visible forest
  const D = walkDistLocal(g, spawnK);
  const left: number[] = [];
  for (let k = 0; k < S * S; k++) if (D[k] < 0 && navOpen(m, k)) left.push(k);
  plantPocket(g, left, K);
}

function plantPocket(g: GenCtx, tiles: number[], K: ReturnType<typeof kindsOf>) {
  const S = g.S, m = g.m, set = new Set(tiles);
  for (const k of tiles) {
    const x = k % S, y = (k / S) | 0;
    if (x & 1 || y & 1) continue;
    if (!set.has(k + 1) || !set.has(k + S) || !set.has(k + S + 1)) continue;
    g.b.prop(K.clump[(x * 7 + y * 3) % K.clump.length], x, y, { allowPath: true });
  }
  for (const k of tiles) {
    if (!navOpen(m, k)) continue;
    const x = k % S, y = (k / S) | 0;
    if (m.terrain[k] === T.tall) clearTile(g, k);
    g.b.prop(K.low[0], x, y, { allowPath: true });
  }
}

function walkDistLocal(g: GenCtx, src: number) {
  // the gen util version, imported lazily to keep this file's imports short
  return walkDistFn(g.m, src);
}
