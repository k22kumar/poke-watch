// Stage 2: terrain. A rolling height field shaped by the archetype and the plan, quantised to 0.5 m terraces, then a
// slope relaxation that guarantees walkable ground everywhere except where a cliff is intended (plateau rims and the
// sides of ramps). Plateaus (lookouts, the shrine's high ground, the ridge) are raised afterwards with a graded ramp
// or a stone stair, so every cliff is deliberate (blueprint sections 3 and 5).
import { dsin } from '../../core/detmath';
import { fbm } from '../../core/rng';
import { T } from '../tiles';
import type { GenCtx, Place } from './context';
import { MARGIN } from './plan';
import { DIRS4, clamp, d2, smoothstep } from './util';

export const FIX = { anchor: 1, plateau: 2, ramp: 3, water: 4 } as const;

/** continuous base height and the archetype's landform */
export function baseTerrain(g: GenCtx) {
  const S = g.S, R = g.rng('terrain');
  const s1 = R.int(1, 1 << 30), s2 = R.int(1, 1 << 30);
  const span = S - MARGIN * 2;
  const phase = R.range(0, 6.28), amp = R.range(2.5, 5);
  const hollowC = g.place('pond')!;
  const [hcx, hcy] = g.toCanon(hollowC.x, hollowC.y);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const [cx, cy] = g.toCanon(x, y);
    // broad rolling ground: two scales, mostly 0–1 m
    let h = (fbm(x / 30, y / 30, s1, 4) - 0.42) * 2.6 + (fbm(x / 11, y / 11, s2, 2) - 0.5) * 0.5;
    if (g.archetype === 'ridge') {
      // foothills rise toward the ridge band in the north third
      const line = MARGIN + 0.22 * span + amp * dsin(cx * 0.045 + phase);
      const d = Math.abs(cy - line);
      h += 1.1 * (1 - smoothstep(6, 22, d));
    } else if (g.archetype === 'valley') {
      // a broad valley across the middle; the river follows its floor
      const line = MARGIN + 0.5 * span + amp * 1.6 * dsin(cx * 0.035 + phase);
      const d = Math.abs(cy - line);
      h += -0.7 * (1 - smoothstep(4, 20, d)) + 0.5 * smoothstep(18, 40, d);
    } else {
      // a bowl around the lake, rim about 1.2 m higher
      const d = Math.sqrt(d2(cx, cy, hcx, hcy));
      h += -0.5 + 1.4 * smoothstep(12, 38, d);
    }
    // ponds sit in basins: a rim rises around each still water site (hollow already is one)
    if (g.archetype !== 'hollow') { const dp = Math.sqrt(d2(x, y, hollowC.x, hollowC.y)); h += 0.9 * smoothstep(6, 11, dp) * (1 - smoothstep(13, 22, dp)) - 0.3 * (1 - smoothstep(4, 8, dp)); }
    g.h0[g.idx(x, y)] = h;
  }
}

/** Quantise to 0.5 m steps (0–2 m) and clean single-tile specks with two majority passes. */
export function quantise(g: GenCtx) {
  const S = g.S, E = g.m.elev;
  for (let k = 0; k < S * S; k++) E[k] = clamp(Math.round(g.h0[k] * 2) / 2, 0, 2);
  const tmp = new Float32Array(S * S);
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const counts = [0, 0, 0, 0, 0];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const a = clamp(x + dx, 0, S - 1), b = clamp(y + dy, 0, S - 1);
        counts[E[b * S + a] * 2]++;
      }
      let best = E[y * S + x] * 2;
      for (let l = 0; l < 5; l++) if (counts[l] > counts[best] || (counts[l] === counts[best] && l < best && counts[l] >= 5)) best = l;
      tmp[y * S + x] = counts[best] >= 5 ? best / 2 : E[y * S + x];
    }
    E.set(tmp);
  }
}

/** Flatten each non-plateau place to one level (the lowest around it, so the slope relaxation never needs to raise ground). */
export function flattenPlaces(g: GenCtx) {
  const S = g.S, E = g.m.elev;
  for (const p of g.places) {
    if (p.kind === 'lookout' || p.kind === 'shrine' || p.kind === 'pond') continue;
    const r = p.r + 1;
    let L = 9;
    for (let y = p.y - r - 2; y <= p.y + r + 2; y++) for (let x = p.x - r - 2; x <= p.x + r + 2; x++) {
      if (!g.in(x, y) || d2(x, y, p.x, p.y) > (r + 2) ** 2) continue;
      if (g.fixed[g.idx(x, y)] === FIX.water) continue;
      L = Math.min(L, E[g.idx(x, y)]);
    }
    if (L === 9) L = 0;
    L = Math.min(L, 1);
    p.elev = L;
    for (let y = p.y - r; y <= p.y + r; y++) for (let x = p.x - r; x <= p.x + r; x++) {
      if (!g.in(x, y) || d2(x, y, p.x, p.y) > r * r) continue;
      const k = g.idx(x, y);
      if (g.fixed[k] === FIX.water) continue;
      E[k] = L; g.fixed[k] = FIX.anchor;
    }
  }
}

/**
 * Max-slope relaxation: every free tile ends at most 0.5 m above each free, anchor or water neighbour, so the free ground
 * is walkable everywhere. Only lowers ground (valleys form beside water and anchors). Plateau and ramp tiles are not
 * neighbours for this rule: steps against them are their intended cliffs.
 */
export function relax(g: GenCtx) {
  const S = g.S, E = g.m.elev, F = g.fixed;
  const limit = (k: number) => F[k] === 0 || F[k] === FIX.anchor || F[k] === FIX.water;
  for (let it = 0; it < 64; it++) {
    let changed = false;
    // alternate sweep directions (two-pass distance-transform style)
    for (let pass = 0; pass < 2; pass++) {
      for (let q = 0; q < S * S; q++) {
        const k = pass ? S * S - 1 - q : q;
        if (F[k] !== 0) continue;
        const x = k % S, y = (k / S) | 0;
        let lo = E[k];
        for (let d = 0; d < 4; d++) {
          const nx = x + DIRS4[d][0], ny = y + DIRS4[d][1];
          if (nx < 0 || ny < 0 || nx >= S || ny >= S) continue;
          const nk = ny * S + nx;
          if (!limit(nk)) continue;
          if (E[nk] + 0.5 < lo) lo = E[nk] + 0.5;
        }
        if (lo < E[k]) { E[k] = lo; changed = true; }
      }
    }
    if (!changed) break;
  }
}

/** Keep the base ground's high share in a band (the plateaus add their own): at most 11 % of land at 1 m or more. */
export function budgetHeight(g: GenCtx) {
  const S = g.S, E = g.m.elev;
  for (let it = 0; it < 4; it++) {
    let land = 0, high = 0;
    for (let k = 0; k < S * S; k++) if (g.fixed[k] !== FIX.water) { land++; if (E[k] >= 1) high++; }
    if (high / land <= 0.11) return;
    for (let k = 0; k < S * S; k++) if (g.fixed[k] === 0 && E[k] >= 1 && !g.rim[k]) E[k] -= 0.5;
    relax(g);
  }
}

/** Raise a plateau blob at `height` with a soft, wobbly rim; returns its tiles. Rims are allowed cliffs. */
export function plateau(g: GenCtx, cx: number, cy: number, rx: number, ry: number, height: number, seed: number, avoid: (k: number) => boolean): number[] {
  const out: number[] = [];
  for (let y = Math.floor(cy - ry - 3); y <= cy + ry + 3; y++) for (let x = Math.floor(cx - rx - 3); x <= cx + rx + 3; x++) {
    if (!g.in(x, y)) continue;
    const k = g.idx(x, y);
    if (avoid(k)) continue;
    const ax = (x + 0.5 - cx) / rx, ay = (y + 0.5 - cy) / ry;
    const wob = (fbm(x / 5, y / 5, seed, 2) - 0.5) * 0.5;
    if (ax * ax + ay * ay > 1 + wob) continue;
    out.push(k);
  }
  for (const k of out) { g.m.elev[k] = height; g.fixed[k] = FIX.plateau; }
  markRims(g, out);
  return out;
}

/** mark plateau tiles and their outside neighbours as allowed cliffs */
export function markRims(g: GenCtx, tiles: number[]) {
  const S = g.S;
  for (const k of tiles) {
    const x = k % S, y = (k / S) | 0;
    for (let d = 0; d < 4; d++) {
      const nx = x + DIRS4[d][0], ny = y + DIRS4[d][1];
      if (!g.in(nx, ny)) continue;
      const nk = g.idx(nx, ny);
      if (g.fixed[nk] !== FIX.plateau) { g.cliffOk[k] = 1; g.cliffOk[nk] = 1; }
    }
  }
}

/**
 * Cut an access from a plateau toward (tx, ty): a stone stair when the plateau's edge faces south (the engine's stairs
 * climb north), otherwise a graded ramp of 0.5 m per tile, `w` tiles wide. Returns the tile where the access lands
 * (a route ends there), or null when no side reaches lower ground.
 */
export function cutAccess(g: GenCtx, tiles: Set<number>, height: number, tx: number, ty: number, w = 3): [number, number] | null {
  const S = g.S;
  // candidate edges: plateau tiles whose whole width faces non-plateau ground in direction d; best (nearest the
  // target, a south stair preferred a little) first, then the next if the first cannot be cut
  const cands: { k: number; d: number; score: number }[] = [];
  for (const k of tiles) {
    const x = k % S, y = (k / S) | 0;
    for (let d = 0; d < 4; d++) {
      const [dx, dy] = DIRS4[d];
      let ok = true;
      for (let o = -(w >> 1); o <= w >> 1 && ok; o++) {
        const ex = x + (dx ? 0 : o), ey = y + (dy ? 0 : o);
        if (!g.in(ex, ey) || !tiles.has(g.idx(ex, ey))) ok = false;
        else { const nx = ex + dx, ny = ey + dy; if (!g.in(nx, ny) || g.fixed[g.idx(nx, ny)] === FIX.plateau) ok = false; }
      }
      if (ok) cands.push({ k, d, score: d2(x, y, tx, ty) - (dy === 1 ? 60 : 0) });
    }
  }
  cands.sort((a, b) => a.score - b.score || a.k * 4 + a.d - (b.k * 4 + b.d));
  for (const c of cands.slice(0, 24)) {
    const plan = planAccess(g, c.k, c.d, height, w);
    if (!plan) continue;
    for (const [k, h, kind] of plan.tiles) {
      g.m.elev[k] = h; g.cliffOk[k] = 1;
      if (kind === 'stair') { g.m.stairs[k] = 1; g.m.terrain[k] = T.stone; g.fixed[k] = FIX.ramp; }
      else if (kind === 'ramp') g.fixed[k] = FIX.ramp;
      else if (kind === 'landing') g.fixed[k] = FIX.anchor;
      else if (kind === 'top') g.m.terrain[k] = T.stone;
      else if (kind === 'side') { /* only marks the face */ }
    }
    return plan.door;
  }
  return null;
}

type AccessTile = [number, number, 'stair' | 'ramp' | 'landing' | 'top' | 'side'];

/** dry run of an access: every tile it would change, or null when it would cut into water, a plateau or the edge */
function planAccess(g: GenCtx, k0: number, d: number, height: number, w: number): { tiles: AccessTile[]; door: [number, number] } | null {
  const S = g.S, E = g.m.elev, out: AccessTile[] = [];
  const x0 = k0 % S, y0 = (k0 / S) | 0, [dx, dy] = DIRS4[d];
  const across = (o: number, s: number): [number, number] => [x0 + dx * s + (dx ? 0 : o), y0 + dy * s + (dy ? 0 : o)];
  const bad = (x: number, y: number) => !g.in(x, y) || x < 3 || y < 3 || x >= S - 3 || y >= S - 3 || g.fixed[g.idx(x, y)] === FIX.water || g.fixed[g.idx(x, y)] === FIX.plateau || g.m.stairs[g.idx(x, y)] === 1;
  if (dy === 1) {
    // south-facing: a stone stair flight, one row per metre of rise (at least 2)
    const rows = Math.max(2, Math.ceil(height));
    const [fx, fy] = across(0, rows + 1);
    if (bad(fx, fy)) return null;
    const ground = E[g.idx(fx, fy)];
    if (ground >= height - 0.25) return null;
    for (let o = -(w >> 1); o <= w >> 1; o++) {
      for (let s = 1; s <= rows + 1; s++) { const [ax, ay] = across(o, s); if (bad(ax, ay)) return null; }
      for (let s = 1; s <= rows; s++) { const [ax, ay] = across(o, s); out.push([g.idx(ax, ay), height + ((ground - height) * (s - 0.5)) / rows, 'stair']); }
      const [lx, ly] = across(o, rows + 1); out.push([g.idx(lx, ly), ground, 'landing']);
      const [tx0, ty0] = across(o, 0); out.push([g.idx(tx0, ty0), height, 'top']);
    }
    return { tiles: out, door: across(0, rows + 1) };
  }
  // graded ramp: 0.5 m per tile until it meets the ground
  let hgt = height, s = 1;
  for (; s < 12; s++) {
    // the lowest ground across the ramp's width decides where it lands, so no row ends above a drop
    let ground = Infinity;
    for (let o = -(w >> 1); o <= w >> 1; o++) { const [ax, ay] = across(o, s); if (bad(ax, ay)) return null; ground = Math.min(ground, E[g.idx(ax, ay)]); }
    if (hgt - ground <= 0.5) break;
    hgt -= 0.5;
    for (let o = -(w >> 1); o <= w >> 1; o++) {
      const [ax, ay] = across(o, s);
      if (bad(ax, ay)) return null;
      out.push([g.idx(ax, ay), hgt, 'ramp']);
      if (o === -(w >> 1) || o === w >> 1) {
        const sx = ax + (dx ? 0 : o < 0 ? -1 : 1), sy = ay + (dy ? 0 : o < 0 ? -1 : 1);
        if (g.in(sx, sy)) out.push([g.idx(sx, sy), E[g.idx(sx, sy)], 'side']);
      }
    }
  }
  if (s >= 12) return null;
  return { tiles: out, door: across(0, s) };
}

/** The landform features that need cliffs: lookouts, the shrine's high ground and (ridge archetype) the ridge. */
export function raiseHighGround(g: GenCtx) {
  const R = g.rng('plateaus');
  const hub = g.place('hub')!;
  const avoid = (k: number) => g.fixed[k] === FIX.water || g.fixed[k] === FIX.anchor;
  const span = g.S - MARGIN * 2;
  if (g.archetype === 'ridge') {
    // the ridge: a long plateau across the north, broken once by a pass far from the shrine
    const shrine = g.place('shrine')!;
    const [scx, scy] = g.toCanon(shrine.x, shrine.y);
    const phase = R.range(0, 6.28), amp = R.range(2, 4);
    const passU = scx < g.S / 2 ? R.range(0.62, 0.82) : R.range(0.18, 0.38);
    const passX = MARGIN + passU * span;
    const height = 2.5;
    const tiles: number[] = [];
    for (let y = 0; y < g.S; y++) for (let x = 0; x < g.S; x++) {
      const [cx, cy] = g.toCanon(x, y);
      const line = scy + amp * dsin((cx - scx) * 0.06 + phase) - amp * dsin(phase);
      const half = 5.5 + 1.5 * fbm(cx / 9, 3, R.int(1, 999), 2);
      if (Math.abs(cy - line) > half) continue;
      if (Math.abs(cx - passX) < 4) continue; // the pass
      const k = g.idx(x, y);
      if (avoid(k)) continue;
      g.ridge[k] = 1;
      tiles.push(k);
    }
    for (const k of tiles) { g.m.elev[k] = height; g.fixed[k] = FIX.plateau; }
    markRims(g, tiles);
    shrine.elev = height;
    const set = new Set(tiles);
    // the shrine's own access faces the hub; a second stair on the far side keeps the north reachable from the top
    shrine.door = cutAccess(g, regionAround(set, shrine, 16, g.S), height, hub.x, hub.y) ?? undefined;
    const [px, py] = g.toMap(Math.round(passX), Math.round(scy));
    // the pass carries a rock-gate stamp
    g.places.push({ id: g.places.length, kind: 'arch', x: px, y: py, r: 3, name: 'Ridge Pass', elev: 0 });
  } else {
    // the shrine sits on its own knoll
    const shrine = g.place('shrine')!;
    const h = R.pick([1.5, 2]);
    const t = plateau(g, shrine.x, shrine.y, 7 + R.int(0, 2), 6 + R.int(0, 2), h, R.int(1, 1e6), avoid);
    shrine.elev = h;
    shrine.door = cutAccess(g, new Set(t), h, hub.x, hub.y) ?? undefined;
  }
  // lookouts: one plateau each, a single access (ramp on one side only)
  for (const p of g.places.filter((q) => q.kind === 'lookout')) {
    const h = R.pick([1.5, 2, 2]);
    const rx = 5 + R.int(0, 2), ry = 4 + R.int(0, 2);
    const t = plateau(g, p.x, p.y, rx, ry, h, R.int(1, 1e6), avoid);
    if (t.length < 20) continue;
    p.elev = h;
    const door = cutAccess(g, new Set(t), h, hub.x, hub.y);
    p.door = door ?? undefined;
    g.lookouts.push({ x: p.x, y: p.y, w: rx * 2, h: ry * 2, height: h, ramps: door ? 1 : 0, name: p.name });
  }
}

function regionAround(set: Set<number>, p: Place, r: number, S: number) {
  const out = new Set<number>();
  for (const k of set) { const x = k % S, y = (k / S) | 0; if (d2(x, y, p.x, p.y) <= r * r) out.add(k); }
  return out;
}

/** Final pass: bare rock patches on the 2.5 m ridge top (blueprint section 3, "stone above 2.5 m"), as low-frequency
 *  blobs so they read as outcrops, never as a hash pattern. */
export function stoneTops(g: GenCtx) {
  const s = g.rng('stone').int(1, 1e6);
  for (let k = 0; k < g.S * g.S; k++) {
    if (g.m.elev[k] < 2.5 || g.m.terrain[k] !== T.grass || g.m.stairs[k]) continue;
    const x = k % g.S, y = (k / g.S) | 0;
    if (fbm(x / 6, y / 6, s, 2) > 0.58) g.m.terrain[k] = T.stone;
  }
}
