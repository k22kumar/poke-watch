// Assembly and dressing, after the routes and landings are fitted (spec R04, R29: reserve topology before dressing):
//   write     heights, surfaces, fluid levels, decks and walls into the ArenaMap
//   cover     major cover first: the landmark and its ruins, blocking cover beside the contest, low cover along routes
//   stands    tree stands where the habitat field suits them (moisture from the fluid, flat footing, clearings by
//             noise), never on reserved route, landing, contest or sightline space, never leaving a one-tile gap
//   detail    tall grass in clearings, reeds and lilies at the water, vents in the hazard field, decor
//   anchors   enemy entries, chest spots, habitat bits
import { fbm } from '../../core/rng';
import { HAB } from '../../rules/habitats';
import { PROP_RULES, T, type ArenaPropKind, type TerrainId } from '../tiles';
import { HK, MED, type HabCtx } from './ctx';

const N4: [number, number][] = [[1, 0], [0, 1], [-1, 0], [0, -1]];

/** forested landforms: the mass around the play space is woodland (closed by stands and thicket in dress), not rock */
export const wooded = (g: HabCtx) => g.recipe.landform === 'gorge' || g.recipe.landform === 'ridge' || g.recipe.landform === 'lagoon';

export function write(g: HabCtx) {
  const m = g.m, S = g.S, n = S * S, sf = g.surfaces(), wd = wooded(g);
  const wl = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const kd = g.kind[k];
    m.elev[k] = g.H[k];
    m.wall[k] = 0;
    let t: TerrainId;
    switch (kd) {
      case HK.fluid: t = T.water; wl[k] = g.wl[k]; m.elev[k] = g.wl[k] + 0.25; break;
      case HK.route: t = g.culvert[k] ? (g.H[k] > 0.3 ? T.stone : T.wood) : sf.route; break;
      case HK.ramp: t = sf.ramp; break;
      case HK.bank: t = sf.bank; break;
      case HK.terrace: t = sf.terrace; break;
      case HK.shelf: t = sf.shelf; break;
      case HK.tunnel: t = sf.ramp; break;
      case HK.rock: t = T.stone; m.wall[k] = 1; break;
      case HK.mass: t = !wd ? T.stone : sf.rim; m.wall[k] = !wd ? 1 : 0; break;
      default: t = g.H[k] > 0.5 && wd ? sf.rim : sf.floor;
    }
    // the tidal floor (dry at low water) reads as the bank: the tide line is visible at every tide
    if (g.tide[k] && kd !== HK.fluid) t = sf.bank;
    // culverts keep their fluid level for drainage and the water drawn under a low bridge
    if (g.culvert[k]) wl[k] = g.wl[k];
    m.terrain[k] = t;
  }
  // gravel banks along open water (the bank family's dry margin)
  for (let k = 0; k < n; k++) {
    if (g.kind[k] !== HK.floor || g.med[k] !== MED.none) continue;
    const x = k % S, y = (k / S) | 0;
    let near = false;
    for (let dy = -2; dy <= 2 && !near; dy++) for (let dx = -2; dx <= 2 && !near; dx++) {
      if (!g.in(x + dx, y + dy)) continue;
      const b = g.idx(x + dx, y + dy);
      if (g.kind[b] === HK.fluid && Math.abs(g.H[k] - g.wl[b]) < 1) near = true;
    }
    if (near) m.terrain[k] = sf.bank;
  }
  m.wlevel = wl;
  if (g.over.some((v) => v > 0)) m.over = g.over;
}

/** footprint free for a blocking prop: flat, playable, unreserved, and it leaves no one-tile gap to another blocker */
function freeFor(g: HabCtx, x: number, y: number, w: number, h: number, allowKeep = false): boolean {
  const m = g.m;
  if (!g.in(x, y)) return false;
  const e0 = m.elev[g.idx(x, y)];
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) {
    if (!g.in(i, j)) return false;
    const k = g.idx(i, j);
    if ((!allowKeep && g.keep[k]) || g.lock[k] && g.kind[k] !== HK.terrace || g.hazard[k] || !g.play(k) || g.over[k] > 0) return false;
    if (g.kind[k] === HK.ramp || g.kind[k] === HK.route || g.kind[k] === HK.tunnel || g.culvert[k]) return false;
    if (m.wall[k] || m.platform[k] || m.elev[k] !== e0) return false;
  }
  const blocked = (i: number, j: number) => !g.in(i, j) || !g.play(g.idx(i, j)) || m.wall[g.idx(i, j)] === 1 || m.platform[g.idx(i, j)] > 0;
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) for (const [dx, dy] of N4) {
    const ax = i + dx, ay = j + dy;
    if (ax >= x && ax < x + w && ay >= y && ay < y + h) continue;
    if (!blocked(ax, ay) && blocked(ax + dx, ay + dy)) return false;
  }
  return true;
}

function place(g: HabCtx, kind: ArenaPropKind, x: number, y: number, opts: { text?: string; allowKeep?: boolean } = {}): boolean {
  const P = PROP_RULES[kind];
  if ((P.wall || P.platform) && !freeFor(g, x, y, P.w, P.h, opts.allowKeep)) return false;
  return g.b.prop(kind, x, y, { force: true, allowPath: true, text: opts.text });
}

function near(g: HabCtx, kind: ArenaPropKind, x: number, y: number, r: number, opts: { text?: string; allowKeep?: boolean } = {}): [number, number] | null {
  for (let rr = 0; rr <= r; rr++) for (let dy = -rr; dy <= rr; dy++) for (let dx = -rr; dx <= rr; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== rr) continue;
    if (place(g, kind, x + dx, y + dy, opts)) return [x + dx, y + dy];
  }
  return null;
}

export function dress(g: HabCtx) {
  const m = g.m, S = g.S, n = S * S, Rp = g.recipe.props, V = g.vegetation(), R = g.rng('dress');
  const c = g.contest;
  // the contest floor and a shoulder around it stay open (the ruins sit on the shoulder's edge)
  g.disc(c.x, c.y, c.r + 1, (k) => { g.keep[k] = 1; });
  // the spawn clearing
  for (const id of ['spawnA', 'spawnB']) { const p = g.nodes[id]; if (p) g.disc(p[0], p[1], 6, (k) => { g.keep[k] = 1; }); }

  // ---- landmark and ruins (structure family) ----
  if (g.landmark) {
    const L = g.landmark, kind = Rp.landmarkProp as ArenaPropKind, P = PROP_RULES[kind];
    let at = near(g, kind, Math.round(L.x - P.w / 2), Math.round(L.y - P.h / 2), 4, { allowKeep: true });
    // else anywhere just outside the contest disc
    for (let i = 0; i < 12 && !at; i++) {
      const a = Math.atan2(L.y - c.y, L.x - c.x) + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.5, r = c.r + 1.5;
      at = near(g, kind, Math.round(c.x + Math.cos(a) * r - P.w / 2), Math.round(c.y + Math.sin(a) * r - P.h / 2), 2, { allowKeep: true });
    }
    if (at) { g.notes.push(`landmark at ${at}`); g.landmark = { ...L, x: at[0] + P.w / 2, y: at[1] + P.h / 2 }; m.landmarks.push({ x: Math.round(g.landmark.x), y: Math.round(g.landmark.y), name: L.name }); }
    else { g.notes.push('landmark not placed'); g.landmark = null; }
  }
  // a broken ring of pillars just outside the contest radius, gaps where the approaches arrive
  const ring = c.r + 1.8, count = R.int(7, 10), a0 = R.range(0, 6.28);
  for (let i = 0; i < count; i++) {
    if (R.chance(0.25)) continue;
    const a = a0 + (i / count) * 6.283;
    const x = Math.round(c.x + Math.cos(a) * ring - 0.5), y = Math.round(c.y + Math.sin(a) * ring - 0.5);
    place(g, (Rp.ruin[i % Rp.ruin.length]) as ArenaPropKind, x, y);
  }
  // blocking cover a little further out (one big piece per quadrant, where it fits)
  for (let q = 0; q < 4; q++) {
    const a = a0 + q * 1.571 + R.range(-0.4, 0.4), r = c.r + R.range(4, 7);
    if (near(g, R.pick(Rp.cover) as ArenaPropKind, Math.round(c.x + Math.cos(a) * r - 1), Math.round(c.y + Math.sin(a) * r - 1), 2)) g.used.add('boulder');
  }
  // low cover beside every approach every ~8 tiles (off the tread)
  for (const A of g.approaches) {
    for (let i = 4; i < A.tiles.length; i += 23) {
      const k = A.tiles[i], x = k % S, y = (k / S) | 0;
      for (const [dx, dy] of N4) if (place(g, R.pick(Rp.low) as ArenaPropKind, x + dx * 3, y + dy * 3)) break;
    }
  }

  // ---- tree stands by suitability (stand family) ----
  // moisture: distance to open fluid of the recipe's medium (water feeds stands; lava kills them)
  const dist = new Int32Array(n).fill(1 << 20), Q = new Int32Array(n);
  let h = 0, t = 0;
  for (let k = 0; k < n; k++) if (g.kind[k] === HK.fluid) { dist[k] = 0; Q[t++] = k; }
  while (h < t) {
    const a = Q[h++], ax = a % S, ay = (a / S) | 0;
    for (const [dx, dy] of N4) {
      const x = ax + dx, y = ay + dy;
      if (!g.in(x, y)) continue;
      const b = g.idx(x, y);
      if (dist[b] > dist[a] + 1) { dist[b] = dist[a] + 1; Q[t++] = b; }
    }
  }
  const wet = g.recipe.medium === 'water';
  // distance (tiles) to the nearest flank approach tile, for the canopy rule
  const flankD = new Int16Array(n).fill(999);
  if (V.canopy) {
    const q: number[] = [];
    for (const A of g.approaches) if (A.kind === 'flank') for (const k of A.tiles) if (flankD[k] !== 0) { flankD[k] = 0; q.push(k); }
    for (let qh = 0; qh < q.length; qh++) {
      const a = q[qh], ax = a % S, ay = (a / S) | 0;
      if (flankD[a] >= V.canopy.within) continue;
      for (const [dx, dy] of N4) { if (!g.in(ax + dx, ay + dy)) continue; const b = g.idx(ax + dx, ay + dy); if (flankD[b] > flankD[a] + 1) { flankD[b] = flankD[a] + 1; q.push(b); } }
    }
  }
  const s1 = R.int(1, 1e6), s2 = R.int(1, 1e6);
  // a stand grows where the patch field clears a threshold set by the recipe's density, raised by moisture where the
  // medium is water (riparian stands) and lowered near lava; inside a stand most 2×2 cells hold a tree
  const stand = (k: number) => {
    const x = k % S, y = (k / S) | 0;
    const moist = wet ? Math.exp(-dist[k] / 12) : Math.exp(-dist[k] / 10);
    const [mLo, mHi] = V.moisture;
    const inBand = moist >= mLo && moist <= mHi;
    // the dry shore (beach and backshore): low ground beside open water carries no stands
    if (V.dry && dist[k] <= V.dry.within && m.elev[k] < V.dry.below) return false;
    const field = fbm(x / 11, y / 11, s1, 3) + (wet ? (moist - 0.4) * 0.22 : -moist * 0.4);
    // the canopy over a screened flank: near the inland route the stand is denser and has no clearings
    const roof = V.canopy && flankD[k] <= V.canopy.within;
    return inBand && field > 1 - (V.density + (roof ? V.canopy!.boost : 0)) * 0.75 && fbm(x / 5, y / 5, s2, 2) > (roof ? 0 : V.clearings * 0.9);
  };
  const hash = (x: number, y: number) => (((x * 73856093) ^ (y * 19349663) ^ s1) >>> 0) % 1000 / 1000;
  const trees = V.trees as ArenaPropKind[];
  for (const off of [0, 1]) for (let y = off; y < S - 1; y += 2) for (let x = off; x < S - 1; x += 2) {
    const k = g.idx(x, y);
    if (g.kind[k] !== HK.floor && g.kind[k] !== HK.mass) continue;
    if (!stand(k) || hash(x, y) > 0.85) continue;
    if (place(g, trees[(x * 7 + y * 13) % trees.length], x, y)) g.used.add('stand');
  }
  // map border: a closed wall of stand (or rock) so nothing walks off the map
  for (let k = 0; k < n; k++) {
    if (g.kind[k] !== HK.mass || m.wall[k]) continue;
    const x = k % S, y = (k / S) | 0;
    if (x < S - 1 && y < S - 1 && g.kind[k + 1] === HK.mass && g.kind[k + S] === HK.mass && g.kind[k + S + 1] === HK.mass && !m.wall[k + 1] && !m.wall[k + S] && !m.wall[k + S + 1]
      && g.b.prop(trees[(x + y) % trees.length], x, y, { force: true, allowPath: true })) continue;
    if (!m.wall[k] && !g.b.prop(V.fill as ArenaPropKind, x, y, { force: true, allowPath: true })) m.wall[k] = 1;
  }
  // understory at stand edges
  for (let k = 0; k < n; k++) {
    if (g.kind[k] !== HK.floor || g.keep[k] || m.wall[k] || m.platform[k]) continue;
    const x = k % S, y = (k / S) | 0;
    let edge = 0;
    for (const [dx, dy] of N4) if (g.in(x + dx, y + dy) && m.wall[g.idx(x + dx, y + dy)]) edge++;
    if (edge && hash(x + 11, y + 5) < 0.09 * V.density * 2 && V.under.length) place(g, V.under[(x + y) % V.under.length] as ArenaPropKind, x, y);
  }

  // ---- detail ----
  const s3 = R.int(1, 1e6);
  for (let k = 0; k < n; k++) {
    const x = k % S, y = (k / S) | 0;
    // a shelf recipe (the lagoon's shallow rim) carries its lilies on the shelf band, several tiles deep, as scenery
    const lily = g.recipe.landform === 'lagoon' ? 0.1 : 0.03;
    if (g.kind[k] === HK.fluid && wet && dist[k] === 0 && hash(x, y + 3) < lily) { const nb = N4.some(([dx, dy]) => g.in(x + dx, y + dy) && g.play(g.idx(x + dx, y + dy))); if (nb) g.b.prop('lily', x, y); continue; }    if (g.keep[k] || m.wall[k] || m.platform[k] || g.kind[k] !== HK.floor || g.hazard[k]) continue;
    if (V.clearings > 0 && fbm(x / 5, y / 5, s3, 2) > 0.66) { g.b.prop('tall', x, y, { allowPath: true }); continue; }
    if (wet && dist[k] <= 2 && hash(x + 1, y) < 0.18) { g.b.prop('reeds', x, y, { allowPath: true }); continue; }
    if (Rp.decor.length && hash(x, y + 9) < 0.02) g.b.prop(Rp.decor[(x + y) % Rp.decor.length] as ArenaPropKind, x, y, { allowPath: true });
  }
  // vents in the hazard field (low, standable: the hazard is the eruption, not the prop)
  for (let k = 0; k < n; k++) if (g.hazard[k] && hash(k % S, (k / S) | 0) < 0.22) g.b.prop('vent', k % S, (k / S) | 0, { force: true, allowPath: true });
  if (g.recipe.landform === 'gorge') g.b.dots(0, 0, S, S, 0.05, g.seed & 0xffff);
  g.b.ledgeLips();

  // ---- chests, habitat ----
  for (const A of g.approaches) { const k = A.tiles[A.tiles.length >> 1]; if (k !== undefined) m.chestSpots.push([k % S, (k / S) | 0]); }
  for (let k = 0; k < n; k++) {
    if (!g.play(k)) continue;
    const moist = dist[k] < 6;
    g.habitat[k] = g.recipe.landform === 'gorge' ? (moist ? HAB.water | HAB.forest : HAB.forest | HAB.grass | HAB.meadow)
      : g.recipe.landform === 'ridge' ? HAB.forest | HAB.rock // woodland round old stones: Ghost and Rock natives
      : g.recipe.landform === 'shoal' ? (moist || g.tide[k] ? HAB.water | HAB.rock : HAB.rock)
      : g.recipe.landform === 'lagoon' ? (g.kind[k] === HK.bank ? HAB.water | HAB.dry : moist ? HAB.water | HAB.grass : HAB.forest | HAB.grass)
      : (g.hazard[k] ? HAB.dry : HAB.rock | HAB.dry);
  }
}

export { HAB };
