// Layer B+ — overhead decks: a second walkable surface above open ground (ArenaMap.over), so the one-height-per-tile
// map gains spaces you can stand above and walk beneath. The sim reads `over` in World.height/blocks/sight and runs
// its flow field on two layers (sim/world.ts); the renderer draws each deck as a slab (render/tilestage.ts).
//
//   shelves    a raised floor's rim carries on past its cliff line for 2–3 tiles as an overhang. On top: a balcony
//              that pushes out over the lower space (better angles down, an exposed edge). Underneath: a sheltered
//              alcove at the foot of the cliff whose slab stops shots from above. Enemies walk onto a shelf from its
//              own floor and drop off its edge (dropNav); below they walk under it like any floor.
//   underpass  a bridge whose deck spans a wooded gully or a rift with lower floor beyond it: the gully floor becomes a
//              walkable passage under the deck instead of a void. Lower floor on both sides: a through-route under
//              the bridge. On one side only: a hollow that runs in under the deck and ends just past it, with a chest.
//
// Clearance: every deck stands at least CLEARANCE m above the ground beneath it, more than a jump reaches plus the
// sim's deck reach (World DECK_REACH), so nothing below can hop onto a deck from underneath.
import { K, type LocCtx } from './ctx';

export const CLEARANCE = 2.9;
const DIRS: [number, number][] = [[1, 0], [0, 1], [-1, 0], [0, -1]];

/** Build shelves and underpasses; returns the number of deck tiles (0 = the map keeps no `over` layer). */
export function decks(g: LocCtx): number {
  const D = g.def.decks;
  if (!D) return 0;
  const S = g.S, n = S * S, over = new Float32Array(n);
  let tiles = 0;
  tiles += crossings(g, over);
  tiles += shelves(g, over, D);
  tiles += underpasses(g, over);
  if (tiles) { g.m.over = over; g.deckTiles = tiles; }
  return tiles;
}

/** where realize() found a flat trail running under a bridge deck: the deck becomes an overhead layer, the trail runs
 *  on beneath it (a real underpass: two routes cross, one above the other) */
function crossings(g: LocCtx, over: Float32Array): number {
  const m = g.m;
  let tiles = 0;
  const bridges = new Set<number>();
  for (let k = 0; k < g.S * g.S; k++) {
    if (g.under[k] < 0 || g.kind[k] !== K.deck) continue;
    over[k] = g.H[k];
    bridges.add(g.linkOf[k]);
    g.H[k] = g.under[k]; g.kind[k] = K.corridor; m.elev[k] = g.under[k]; m.wall[k] = 0;
    tiles++;
  }
  for (const id of [...bridges].sort((a, b) => a - b)) { g.crossed.add(id); g.notes.push(`underpass ${id} crossing`); }
  return tiles;
}

/** ground a deck may stand over: open floor or corridor (never a ramp, step, bridge deck or another deck) */
const floorLike = (g: LocCtx, k: number) => g.kind[k] === K.zone || g.kind[k] === K.corridor;

function shelves(g: LocCtx, over: Float32Array, D: NonNullable<LocCtx['def']['decks']>): number {
  const S = g.S, R = g.rng('decks');
  const hub = g.zone('hub')!, boss = g.zone('boss')!;
  const spawnR = g.def.gameplay.spawnOpen + 2;
  // candidate columns: a rim tile r (floor at height h) and a direction where the floor drops by at least the
  // clearance onto flat lower floor for `depth` tiles
  type Col = { r: number; x: number; y: number; d: number; h: number; tiles: number[]; root: number };
  const byKey = new Map<string, Col[]>();
  for (let k = 0; k < S * S; k++) {
    if (!floorLike(g, k)) continue;
    const x = k % S, y = (k / S) | 0, h = g.H[k];
    if (h < CLEARANCE) continue;
    for (let d = 0; d < 4; d++) {
      const [dx, dy] = DIRS[d];
      const tiles: number[] = [];
      let g0 = -1, root = -1;
      // the rim may break through one tile of rock (or forest) first: that tile becomes floor at the rim's height
      const r1x = x + dx, r1y = y + dy;
      if (g.in(r1x, r1y) && g.kind[g.idx(r1x, r1y)] === K.mass) root = g.idx(r1x, r1y);
      for (let s = root >= 0 ? 2 : 1; s <= D.depth[1] + (root >= 0 ? 1 : 0); s++) {
        const ax = x + dx * s, ay = y + dy * s;
        if (!g.in(ax, ay) || ax < 3 || ay < 3 || ax >= S - 3 || ay >= S - 3) break;
        const a = g.idx(ax, ay);
        if (!floorLike(g, a) || over[a] > 0) break;
        if (g0 < 0) g0 = g.H[a];
        if (g.H[a] !== g0 || h - g.H[a] < CLEARANCE) break;
        // the spawn clearing and the boss hall's centre stay open sky
        if ((ax - hub.x) ** 2 + (ay - hub.y) ** 2 < spawnR * spawnR || (ax - boss.x) ** 2 + (ay - boss.y) ** 2 < 25) break;
        tiles.push(a);
      }
      if (tiles.length < D.depth[0]) continue;
      // runs are grouped by height, direction and the line they lie on (perpendicular coordinate)
      const line = dx ? x : y, along = dx ? y : x;
      const key = `${h}|${d}`;
      (byKey.get(key) ?? byKey.set(key, []).get(key)!).push({ r: k, x: along, y: line, d, h, tiles, root });
    }
  }
  // runs: chains of columns one step apart along the rim, allowed to shift a tile in or out (rims curve)
  type Run = Col[];
  const runs: Run[] = [];
  for (const key of [...byKey.keys()].sort()) {
    const cols = byKey.get(key)!.sort((a, b) => a.x - b.x || a.y - b.y);
    const taken = new Set<Col>();
    for (const c0 of cols) {
      if (taken.has(c0)) continue;
      const run: Run = [c0]; taken.add(c0);
      for (let cur = c0; ;) {
        // the next column: one further along, the same line or one off it (prefer the same line)
        const nxt = cols.filter((c) => !taken.has(c) && c.x === cur.x + 1 && Math.abs(c.y - cur.y) <= 1).sort((a, b) => Math.abs(a.y - cur.y) - Math.abs(b.y - cur.y))[0];
        if (!nxt) break;
        run.push(nxt); taken.add(nxt); cur = nxt;
      }
      runs.push(run);
    }
  }
  const good = runs.filter((r) => r.length >= D.run[0]);
  // longest first, ties by position (deterministic), then a seeded pick among the best few
  good.sort((a, b) => b.length - a.length || a[0].r - b[0].r);
  const want = R.int(D.shelves[0], D.shelves[1]);
  const pool = good.slice(0, Math.max(want * 3, 6));
  let made = 0, tiles = 0;
  const used: [number, number][] = [];
  for (const run of R.shuffle(pool)) {
    if (made >= want) break;
    // trim to the longest allowed run, centred
    const len = Math.min(run.length, D.run[1]), start = Math.floor((run.length - len) / 2);
    const part = run.slice(start, start + len);
    const mid = part[part.length >> 1], mx = mid.r % S, my = (mid.r / S) | 0;
    // keep shelves apart (one per cliff face)
    if (used.some(([ux, uy]) => (ux - mx) ** 2 + (uy - my) ** 2 < 18 * 18)) continue;
    // depth varies a little along the run so the outer edge is not a ruler line (ends shallower)
    let ok = true;
    for (const c of part) for (const a of c.tiles) if (over[a] > 0) ok = false;
    if (!ok) continue;
    part.forEach((c, i) => {
      if (c.root >= 0 && g.kind[c.root] === K.mass) { g.kind[c.root] = K.corridor; g.H[c.root] = c.h; g.m.elev[c.root] = c.h; g.m.wall[c.root] = 0; }
      const end = i === 0 || i === part.length - 1;
      const depth = Math.max(D.depth[0], end ? c.tiles.length - 1 : c.tiles.length);
      for (const a of c.tiles.slice(0, depth)) { over[a] = c.h; tiles++; }
    });
    used.push([mx, my]);
    made++;
    g.notes.push(`shelf ${part.length}x${part[0].tiles.length} @${mx},${my}`);
  }
  return tiles;
}

/** a bridge over a gully that runs between two lower spaces becomes a deck over a walkable passage */
function underpasses(g: LocCtx, over: Float32Array): number {
  const S = g.S, W = g.def.gameplay.trailW[0];
  let tiles = 0;
  for (const L of g.links) {
    if (L.kind !== 'bridge' || !L.tiles.length || g.crossed.has(L.id)) continue;
    const A = g.zones[L.a], B = g.zones[L.b];
    const deckH = A.h;
    const dx = B.x - A.x, dy = B.y - A.y, len = Math.sqrt(dx * dx + dy * dy) || 1, px = -dy / len, py = dx / len;
    const [mx, my] = L.pts[L.pts.length >> 1];
    // walk both ways across the bridge until lower floor; both ends must find it
    const found: ({ s: number; h: number } | null)[] = [];
    for (const sg of [1, -1]) {
      let f: { s: number; h: number } | null = null;
      for (let s = 1; s < 26; s += 0.5) {
        const x = Math.floor(mx + px * s * sg), y = Math.floor(my + py * s * sg);
        if (!g.in(x, y) || x < 3 || y < 3 || x >= S - 3 || y >= S - 3) break;
        const k = g.idx(x, y);
        if (g.linkOf[k] === L.id) continue;
        if (g.kind[k] === K.mass || g.kind[k] === K.chasm) continue;
        if (floorLike(g, k) && g.H[k] <= deckH - CLEARANCE) f = { s: s * sg, h: g.H[k] };
        break;
      }
      found.push(f);
    }
    if (!found[0] && !found[1]) continue;
    // one side only: a hollow under the bridge that ends a few tiles past it (a dead-end alcove with a chest)
    const hollow = !found[0] || !found[1];
    const e0 = (found[0] ?? found[1])!;
    const e1 = hollow ? { s: -Math.sign(e0.s) * (g.def.gameplay.bridgeW / 2 + 3), h: e0.h } : found[1]!;
    const span = Math.abs(e0.s - e1.s);
    // the passage must stay walkable for enemies (≤ 0.5 m per tile) and under the deck by the clearance
    if (Math.abs(e0.h - e1.h) / span > 0.45 || Math.max(e0.h, e1.h) > deckH - CLEARANCE) continue;
    // carve: a strip W wide from end to end through the mass and under the deck
    const claimed: number[] = [];
    let blocked = false;
    for (let s = Math.min(e0.s, e1.s); s <= Math.max(e0.s, e1.s) && !blocked; s += 0.5) {
      const t = (s - e0.s) / (e1.s - e0.s), h = e0.h + (e1.h - e0.h) * t;
      for (let o = -W / 2; o < W / 2; o += 0.5) {
        const x = Math.floor(mx + px * s + (dx / len) * o), y = Math.floor(my + py * s + (dy / len) * o);
        if (!g.in(x, y)) { blocked = true; break; }
        const k = g.idx(x, y);
        if (g.kind[k] === K.deck && g.linkOf[k] === L.id) { if (!claimed.includes(-k - 1)) claimed.push(-k - 1); g.H[k] = Math.min(g.H[k], h); continue; }
        if (g.kind[k] === K.mass || g.kind[k] === K.chasm) { if (!claimed.includes(k)) claimed.push(k); g.H[k] = h; continue; }
        if (floorLike(g, k)) continue; // the ends meet existing floor
        blocked = true; break; // a ramp, step or another link in the way
      }
    }
    if (blocked) continue;
    const m = g.m;
    for (const c of claimed) {
      // realize() already set heights and walls: the passage is open floor now
      if (c >= 0) { g.kind[c] = K.corridor; g.linkOf[c] = -1; m.elev[c] = g.H[c]; m.wall[c] = 0; continue; }
      const k = -c - 1;
      // the deck tile: the ground below becomes passage floor, the deck surface moves to `over`
      over[k] = deckH; g.kind[k] = K.corridor; m.elev[k] = g.H[k]; m.wall[k] = 0; tiles++;
    }
    // the bridge's other deck tiles (over the remaining gully) keep their single-layer deck
    if (hollow) {
      const ex = Math.floor(mx + px * e1.s * 0.85), ey = Math.floor(my + py * e1.s * 0.85);
      if (g.in(ex, ey) && floorLike(g, g.idx(ex, ey))) g.m.chestSpots.push([ex, ey]);
    }
    g.notes.push(`${hollow ? 'hollow' : 'underpass'} ${L.id} span ${span.toFixed(0)}`);
  }
  return tiles;
}
