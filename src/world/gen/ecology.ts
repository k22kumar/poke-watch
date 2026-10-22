// Stage 6: ecology. Moisture, distance to routes and a low-frequency grove field pick the ground cover in bands
// (blueprint section 3, "Forest" and "Grassland to other biomes"):
//   grove     — 2×2 tree masses on an even grid, the HGSS wall look, with a feathered edge;
//   scattered — single trees and bushes in the band around a grove;
//   grass     — rectangular tall-grass blocks beside routes in mid moisture (never on a route);
//   shore     — sand banks, reeds at the water's edge, lilies on still water.
// Never on a route, never inside a clearing, never across a cliff.
import { fbm } from '../../core/rng';
import { T } from '../tiles';
import { HAB, type GenCtx } from './context';
import { kindsOf } from './kit';
import { MARGIN } from './plan';
import { FIX } from './terrain';
import { DIRS4, distanceTo, hashf, smoothstep } from './util';
import { treeMask } from './validate';
import { clearTile } from './gameplay';

export interface Fields { dRoute: Int32Array; dWater: Int32Array; moist: Float32Array }

export function fields(g: GenCtx): Fields {
  const S = g.S, m = g.m;
  const dRoute = distanceTo(S, S, (k) => g.route[k] > 0, 40);
  const dWater = distanceTo(S, S, (k) => m.terrain[k] === T.water, 40);
  const moist = new Float32Array(S * S);
  const s = g.rng('ecology').int(1, 1e6);
  for (let k = 0; k < S * S; k++) {
    const x = k % S, y = (k / S) | 0;
    const dw = dWater[k] < 0 ? 40 : dWater[k];
    moist[k] = 0.55 * (1 - smoothstep(0, 18, dw)) + 0.6 * (fbm(x / 16, y / 16, s, 3) - 0.5) + 0.3;
  }
  return { dRoute, dWater, moist };
}

export function plantEcology(g: GenCtx, F: Fields) {
  const S = g.S, m = g.m, b = g.b, R = g.rng('ecology'), K = kindsOf(g.biome);
  const gs = R.int(1, 1e6);
  const groveField = new Float32Array(S * S);
  for (let k = 0; k < S * S; k++) {
    const x = k % S, y = (k / S) | 0;
    groveField[k] = fbm(x / 20, y / 20, gs, 3) + 0.18 * F.moist[k];
  }
  const clearOf = (k: number) => !g.keepOpen[k] && !g.route[k] && !m.stairs[k] && m.terrain[k] !== T.water && m.terrain[k] !== T.wood && g.fixed[k] !== FIX.ramp;
  // ---- groves: 2×2 masses on an even grid where the field is high and routes are at least 3 tiles away
  const GROVE = 0.6, SCATTER = 0.52;
  for (let y = 2; y < S - 3; y += 2) for (let x = 2; x < S - 3; x += 2) {
    const ks = [g.idx(x, y), g.idx(x + 1, y), g.idx(x, y + 1), g.idx(x + 1, y + 1)];
    if (!ks.every(clearOf)) continue;
    // keep 3–6 tiles from routes, varying slowly along the route so grove edges never run parallel to it
    const keep = 3 + Math.floor(fbm(x / 7, y / 7, gs + 7, 2) * 4.5);
    if (Math.min(...ks.map((k) => F.dRoute[k] < 0 ? 99 : F.dRoute[k])) < keep) continue;
    const f = (groveField[ks[0]] + groveField[ks[3]]) / 2;
    const edgeJitter = (hashf(x, y, gs) - 0.5) * 0.06;
    if (f + edgeJitter > GROVE) {
      // feather the outer edge: drop a fraction of the trees touching the scattered band
      if (f < GROVE + 0.025 && hashf(x, y, gs, 3) < 0.35) continue;
      b.prop(K.clump[Math.floor(hashf(x, y, gs, 1) * K.clump.length)], x, y);
    } else if (f > SCATTER && hashf(x, y, gs, 2) < 0.07 + (f - SCATTER) * 2) {
      b.prop(K.clump[Math.floor(hashf(x, y, gs, 4) * K.clump.length)], x, y);
    } else if (f > SCATTER - 0.04 && hashf(x, y, gs, 5) < 0.06) {
      b.prop(K.low[Math.floor(hashf(x, y, gs, 6) * 3)], x + (hashf(x, y, gs, 7) < 0.5 ? 0 : 1), y);
    }
  }
  featherGroves(g);
  // ---- tall grass: a few big fields in open meadow, then blocks beside routes in mid moisture
  const tryBlock = (x: number, y: number, w: number, h: number, near: [number, number], moist: [number, number]) => {
    const kc = g.idx(x + (w >> 1), y + (h >> 1));
    const dr = F.dRoute[kc] < 0 ? 99 : F.dRoute[kc];
    if (dr < near[0] || dr > near[1]) return false;
    if (F.moist[kc] < moist[0] || F.moist[kc] > moist[1]) return false;
    const e0 = m.elev[g.idx(x, y)];
    for (let j = y - 1; j <= y + h; j++) for (let i = x - 1; i <= x + w; i++) {
      if (!g.in(i, j)) return false;
      const k = g.idx(i, j);
      const inside = j >= y && j < y + h && i >= x && i < x + w;
      if (inside && (m.terrain[k] !== T.grass || m.elev[k] !== e0 || g.keepOpen[k] || m.wall[k] || m.platform[k])) return false;
      if (g.route[k]) return false; // a tile of margin from any route
    }
    b.tallRect(x, y, w, h, R.int(1, 999));
    return true;
  };
  let fieldsN = 0;
  const fieldsWant = 4 + R.int(0, 1);
  for (let t = 0; t < 500 && fieldsN < fieldsWant; t++) {
    const w = R.int(10, 16), h = R.int(6, 9);
    if (tryBlock(R.int(MARGIN - 2, S - MARGIN - w + 2), R.int(MARGIN - 2, S - MARGIN - h + 2), w, h, [2, 30], [0.15, 0.8])) fieldsN++;
  }
  let blocks = 0;
  const target = 26 + R.int(0, 8);
  for (let t = 0; t < 1500 && blocks < target; t++) {
    const w = R.int(5, 12), h = R.int(3, 7);
    if (tryBlock(R.int(MARGIN - 2, S - MARGIN - w + 2), R.int(MARGIN - 2, S - MARGIN - h + 2), w, h, [2, 12], [0.1, 0.9])) blocks++;
  }
  // ---- top up: keep plain grass at or under 77 % of the open ground (the authored Meadow is 78 %)
  let open = 0, grass = 0;
  for (let k = 0; k < S * S; k++) if (!m.wall[k] && m.terrain[k] !== T.water) { open++; if (m.terrain[k] === T.grass) grass++; }
  for (let t = 0; t < 600 && grass / Math.max(1, open) > 0.77; t++) {
    const w = R.int(6, 12), h = R.int(4, 7);
    const before = m.props.length;
    if (tryBlock(R.int(MARGIN - 2, S - MARGIN - w + 2), R.int(MARGIN - 2, S - MARGIN - h + 2), w, h, [2, 30], [0.05, 0.95])) grass -= m.props.length - before;
  }
  // ---- shore: reeds on the bank, lilies on still water (lakes, not rivers: few neighbours are water on a river bank)
  for (let k = 0; k < S * S; k++) {
    const x = k % S, y = (k / S) | 0;
    if (m.terrain[k] === T.water) {
      let wn = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (g.in(x + dx, y + dy) && m.terrain[g.idx(x + dx, y + dy)] === T.water) wn++;
      if (wn >= 23 && hashf(x, y, gs, 9) < 0.07 && (g.biome === 'meadow' || g.biome === 'dusk')) b.prop('lily', x, y);
      continue;
    }
    if (F.dWater[k] === 1 && !g.route[k] && !g.keepOpen[k] && hashf(x, y, gs, 10) < 0.22) b.prop('reeds', x, y);
  }
  // ---- painted ground flowers in open meadow away from forest
  for (let k = 0; k < S * S; k++) {
    if (m.terrain[k] !== T.grass) continue;
    const x = k % S, y = (k / S) | 0;
    if (F.moist[k] > 0.35 && F.moist[k] < 0.7 && hashf(x, y, gs, 11) < 0.1) m.dots[k] = 1;
  }
}

/** Habitat tags (blueprint section 1): water edge, tall grass, rock (high or stony ground), dry open ground, meadow, forest. */
export function tagHabitat(g: GenCtx, F: Fields) {
  const S = g.S, m = g.m, H = g.habitat;
  for (let k = 0; k < S * S; k++) {
    let h = 0;
    const t = m.terrain[k];
    if (t === T.water || (F.dWater[k] >= 0 && F.dWater[k] <= 3)) h |= HAB.water;
    if (t === T.tall) h |= HAB.grass;
    if (m.elev[k] >= 1.5 || t === T.stone) h |= HAB.rock;
    if ((t === T.sand || t === T.dirt || t === T.path) && (F.dWater[k] < 0 || F.dWater[k] > 4)) h |= HAB.dry;
    if (t === T.grass && F.moist[k] < 0.7 && !m.wall[k]) h |= HAB.meadow;
    H[k] = h;
  }
  // forest edge: walkable tiles within 2 of a tree
  const nearTree = distanceTo(S, S, (k) => m.wall[k] === 1 && m.platform[k] === 0, 3);
  for (let k = 0; k < S * S; k++) if (!m.wall[k] && nearTree[k] >= 1 && nearTree[k] <= 2) H[k] |= HAB.forest;
  // rocks and boulders make rock habitat around them
  for (const p of m.props) if (p.kind === 'rock' || p.kind === 'boulder' || p.kind === 'pillar' || p.kind === 'pillarBroken') {
    for (let dy = -2; dy <= p.h + 1; dy++) for (let dx = -2; dx <= p.w + 1; dx++) if (g.in(p.x + dx, p.y + dy)) H[g.idx(p.x + dx, p.y + dy)] |= HAB.rock;
  }
  void DIRS4;
}

/** spawn-table species → the habitat they belong to (presentation: burrows, tufts, prints follow it) */
export const SPECIES_HABITAT: Record<string, number> = {
  rattata: HAB.meadow | HAB.grass, ledyba: HAB.forest | HAB.meadow, sandshrew: HAB.dry, oddish: HAB.grass, poliwag: HAB.water,
  mareep: HAB.meadow, heracross: HAB.forest, geodude: HAB.rock, houndour: HAB.dry | HAB.rock, zubat: HAB.forest, paras: HAB.forest,
  vulpix: HAB.dry, slugma: HAB.rock, swinub: HAB.water, delibird: HAB.meadow, gastly: HAB.forest,
};

/** Break every straight grove edge longer than 10 tiles: take out the tree in the middle of the run (a notch). */
export function featherGroves(g: GenCtx) {
  const S = g.S, m = g.m;
  for (let pass = 0; pass < 8; pass++) {
    const tree = treeMask(m);
    let cut = -1;
    const scan = (horizontal: boolean, side: number) => {
      for (let a = 1; a < S - 1 && cut < 0; a++) {
        let run = 0;
        for (let b = 0; b < S; b++) {
          const x = horizontal ? b : a, y = horizontal ? a : b;
          const k = y * S + x, nk = horizontal ? (y + side) * S + x : y * S + x + side;
          const edge = tree[k] && !m.wall[nk] && m.terrain[nk] !== T.water && x > MARGIN && x < S - MARGIN && y > MARGIN && y < S - MARGIN;
          run = edge ? run + 1 : 0;
          if (run > 10) { const mb = b - (run >> 1); cut = horizontal ? y * S + mb : mb * S + x; break; }
        }
      }
    };
    for (const h of [true, false]) for (const sd of [1, -1]) if (cut < 0) scan(h, sd);
    if (cut < 0) return;
    clearTile(g, cut);
    // a low bush fills part of the notch so it reads as a feathered edge, not a hole
    const x = cut % S, y = (cut / S) | 0;
    g.b.prop(kindsOf(g.biome).low[0], x, y);
  }
}
