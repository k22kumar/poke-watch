// Playability on the finished map (docs/HABITATS.md, "Gates"; spec section F and the workbook's PBL tests).
// Everything here is derived from the final collision: the ArenaMap's heights, walls, platforms, water and decks,
// exactly as the sim reads them (locgen/nav mirrors sim/world.ts). Nothing trusts the planned graph; the plan is only
// compared against what was built (PBL10).
//
//   clearance   per navigation node (ground or deck): the widest clearance (m) of a body centred somewhere in the tile,
//               to the nearest square that is blocked at the node's level (wall, water, a rise or a drop of > 0.6 m).
//               A profile fits a node when clearance ≥ its radius (PBL01, PBL06: erode the floor by the footprint).
//   reach       symmetric baseline walking (steps ≤ 0.6 m, no jump, no drop) from each staging to the contest and
//               back, for every essential profile, in every environment state the recipe has (PBL02, PBL04).
//   independent two approaches per side that keep ≥ SEP tiles apart outside the staging funnel and the contest
//               shoulder, neither through a hazard (PBL03, PBL05)
//   perch       no standable high node off the side's own routes (any locomotion, all destructible cover gone) sees
//               at least half of BOTH of a side's final approach segments and the point itself (R30: the "same perch
//               controls both approaches" failure)
//   counter     every high position overlooking the contest is reachable by baseline walking from both sides or is
//               itself in view of the contest floor (PBL08)
//   contest     the contest floor is mostly usable by the largest essential body (PBL06); spawns cannot see each other
//               (PBL07); hazard tiles have an exit within reach of the warning (PBL04/05)
//   joins       bridges, causeways and arches are supported at both ends and clear what passes under (spec R02)
//   drainage    every fluid tile drains, through culverts and falls, to an outlet or a declared sink (spec R03)
import { mapExposureClear, mapSegmentClear } from '../../sim/spatial';
import { navOpen, navTop } from '../tilenav';
import type { GateResult } from '../genmeta';
import { enemyCore, pathBetween, playerReach } from '../locgen/nav';
import { defaultRules } from '../../rules/defaults';
import { PROP_MATERIALS } from '../../rules/surfaces';
import { T, WATER_Y, ICE_LIFT, type ArenaMap } from '../tiles';
import type { Join } from './ctx';
import { bracketsMuzzles, PLOT_ZONE, type GraveMark } from './graves';
import type { BodyProfile, HabitatState } from './types';

export const SEP = 4; // tiles two approaches keep apart outside the exempt funnel and shoulder
export const CLEARANCE = 2.9;
/** tiles beyond the contest radius that count as the contest platform (excluded from the perch test) */
export const PLATFORM = 5;
/** the protected spawn funnel both of a side's approaches may share before they split (tiles) */
export const FUNNEL = 12;
/** the longest engagement range in the roster's kit (m): spawns farther apart than this may see each other */
export const RANGE = 30; // m under any deck (a jump reaches 1.84 m, the sim snaps onto a deck from 0.9 m below)
const N4: [number, number][] = [[1, 0], [0, 1], [-1, 0], [0, -1]];

/** what validate needs to know about the plan (all tile coords) */
export interface Layout {
  contest: { x: number; y: number; r: number; h: number };
  stage: { A: [number, number]; B: [number, number] };
  /** planned approaches (tile lists); optional (fixtures have none) */
  approaches?: { id: string; team: 'A' | 'B'; tiles: number[] }[];
  hazard?: Uint8Array;
  culvert?: Uint8Array;
  /** the contest platform (tiles); default: within contest.r + PLATFORM */
  platform?: Uint8Array;
  joins?: Join[];
  outlets?: [number, number][];
  sinks?: [number, number][];
  dropNav: number;
  states: HabitatState[];
  /** a tidal fluid body: the tiles it covers at high water (dry floor at low water) and its two levels (m) */
  tide?: { mask: Uint8Array; low: number; high: number };
  /** an open shore (the lagoon's beach and backshore: low ground beside the water): the `shore` gate runs when present */
  shore?: Uint8Array;
  /** grave markers as built and the precinct footprint (tiles inside the perimeter wall): the marker gates run when present */
  graves?: { marks: GraveMark[]; precinct: Uint8Array };
}

export interface SideReport { team: 'A' | 'B'; reach: Record<string, boolean>; exit: boolean; independent: boolean; bottleneck?: [number, number]; lengths: [number, number]; planned: Record<string, boolean> }
export interface Perch { tile: number; deck: boolean; team: 'A' | 'B'; sees: [number, number]; target: number; /** the visible samples of the less-exposed segment (blocking these breaks the dominance) */ targets: number[] }
export interface HabReport {
  ok: boolean;
  gates: GateResult[];
  failed: string[];
  /** per state, per side */
  states: Record<string, SideReport[]>;
  perches: Perch[];
  metrics: Record<string, number>;
}

// ---- state variants ----------------------------------------------------------------------------------------------

/** the map as it is in an environment state (a shallow copy with the changed layers) */
export function stateMap(m: ArenaMap, st: HabitatState, L: Layout): ArenaMap {
  if (st === 'base') return m;
  const out: ArenaMap = { ...m, terrain: m.terrain.slice(), elev: m.elev.slice(), wall: m.wall.slice(), platform: m.platform.slice() };
  const n = m.w * m.h;
  if (st === 'flooded') {
    // high water: every tidal tile is open water at the tide's high level (sim: World.setTide)
    if (L.tide) {
      const wl = m.wlevel ? m.wlevel.slice() : new Float32Array(n).fill(WATER_Y);
      for (let k = 0; k < n; k++) if (L.tide.mask[k] && !m.wall[k]) { out.terrain[k] = T.water; wl[k] = L.tide.high; }
      out.wlevel = wl;
    }
  } else if (st === 'frozen') {
    // every water tile freezes: walkable ice a hand above its water level (sim: CellField frozen, World.height, ICE_LIFT)
    for (let k = 0; k < n; k++) if (m.terrain[k] === T.water) { out.terrain[k] = T.stone; out.elev[k] = (m.wlevel ? m.wlevel[k] : WATER_Y) + ICE_LIFT; }
  } else if (st === 'venting') {
    if (L.hazard) for (let k = 0; k < n; k++) if (L.hazard[k]) out.wall[k] = 1;
  } else if (st === 'stripped') {
    // every destructible prop burnt or broken: its footprint opens (stumps and rubble are low)
    for (const p of m.props) {
      const pm = PROP_MATERIALS[p.kind];
      if (!pm || pm.integrity === 0) continue;
      for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) {
        if (x < 0 || y < 0 || x >= m.w || y >= m.h) continue;
        const k = y * m.w + x;
        out.wall[k] = 0; out.platform[k] = 0;
      }
    }
  }
  return out;
}

// ---- geometry helpers ----------------------------------------------------------------------------------------------

const level = (m: ArenaMap, node: number) => { const n = m.w * m.h; return node >= n ? m.over![node - n] : navTop(m, node); };
const nodeOpen = (m: ArenaMap, node: number) => { const n = m.w * m.h; return node >= n ? m.over![node - n] > 0 : navOpen(m, node); };

/** per node: the widest clearance (m, capped at 3) of a body centred at the tile's centre or one of its corners. The
 *  free space is what a walker standing there can reach by continuous footing within 4 tiles (steps of ≤ 0.6 m on its
 *  own layer), so a slope is free and a wall, water, a cliff face, a drop or a deck slab overhead bounds it. */
export function clearance(m: ArenaMap, base?: Float32Array, changed?: Uint8Array): Float32Array {
  const W = m.w, H = m.h, n = W * H, N = m.over ? 2 * n : n;
  const out = base ? base.slice() : new Float32Array(N);
  // incremental: only nodes within the flood window of a changed tile can differ from the base map's
  let dirty: Uint8Array | null = null;
  if (base && changed) {
    dirty = new Uint8Array(n);
    for (let k = 0; k < n; k++) {
      if (!changed[k]) continue;
      const x = k % W, y = (k / W) | 0;
      for (let j = Math.max(0, y - 5); j <= Math.min(H - 1, y + 5); j++) for (let i = Math.max(0, x - 5); i <= Math.min(W - 1, x + 5); i++) dirty[j * W + i] = 1;
    }
  }
  const CAP = 3, R = 4, D = 2 * R + 1;
  const seen = new Int32Array(D * D).fill(-1), lvl = new Float32Array(D * D), Q = new Int32Array(D * D * 2);
  const samples: [number, number][] = [[0.5, 0.5], [0.02, 0.02], [0.98, 0.02], [0.02, 0.98], [0.98, 0.98]];
  const free: number[] = [];
  for (let node = 0; node < N; node++) {
    if (dirty && !dirty[node % n]) continue;
    out[node] = 0;
    if (!nodeOpen(m, node)) continue;
    const k = node % n, x0 = k % W, y0 = (k / W) | 0;
    // local flood on the walker's layer
    let qh = 0, qt = 0;
    const li = (x: number, y: number) => (y - y0 + R) * D + (x - x0 + R);
    seen[li(x0, y0)] = node; lvl[li(x0, y0)] = level(m, node); Q[qt++] = x0; Q[qt++] = y0;
    while (qh < qt) {
      const ax = Q[qh++], ay = Q[qh++], ha = lvl[li(ax, ay)];
      for (const [dx, dy] of N4) {
        const bx = ax + dx, by = ay + dy;
        if (bx < 0 || by < 0 || bx >= W || by >= H || Math.abs(bx - x0) > R || Math.abs(by - y0) > R) continue;
        const l = li(bx, by);
        if (seen[l] === node) continue;
        const b = by * W + bx;
        // the walker lands on a deck when within its reach, else the ground (World.height)
        const ov = m.over ? m.over[b] : 0;
        let hb: number;
        if (ov > 0 && ha >= ov - 0.9) hb = ov;
        else { if (!navOpen(m, b)) continue; if (ov > 0 && navTop(m, b) > ov - 2.9 + 0.01 && ha < ov - 0.9) continue; hb = navTop(m, b); }
        if (Math.abs(hb - ha) > 0.6) continue;
        seen[l] = node; lvl[l] = hb; Q[qt++] = bx; Q[qt++] = by;
      }
    }
    let best = 0;
    for (const [sx, sy] of samples) {
      const px = x0 + sx, py = y0 + sy;
      let md = Math.min(CAP, px, py, W - px, H - py);
      for (let j = y0 - R; j <= y0 + R && md > best; j++) for (let i = x0 - R; i <= x0 + R && md > best; i++) {
        if (i >= 0 && j >= 0 && i < W && j < H && seen[li(i, j)] === node) continue;
        const dx = Math.max(i - px, 0, px - (i + 1)), dy = Math.max(j - py, 0, py - (j + 1));
        const d = Math.hypot(dx, dy);
        if (d < md) md = d;
      }
      if (md > best) best = md;
    }
    out[node] = best;
  }
  void free;
  return out;
}

/** 3D line of sight between two points at absolute heights in map coordinates, using the same continuous trace as combat */
export function sightAbs(m: ArenaMap, ax: number, ay: number, ya: number, bx: number, by: number, yb: number): boolean {
  return mapSegmentClear(m, ax, ya, ay, bx, yb, by);
}

const tileOf = (m: ArenaMap, p: [number, number]) => Math.floor(p[1]) * m.w + Math.floor(p[0]);

/** node at a point: the deck when one is within reach above the ground there and higher than h, else the ground */
function nodeAt(m: ArenaMap, p: [number, number], h?: number): number {
  const k = tileOf(m, p), n = m.w * m.h;
  if (h !== undefined && m.over && m.over[k] > 0 && Math.abs(m.over[k] - h) < 0.7) return n + k;
  return k;
}

function discMask(m: ArenaMap, cx: number, cy: number, r: number, N: number): Uint8Array {
  const out = new Uint8Array(N), n = m.w * m.h;
  for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(m.h - 1, Math.ceil(cy + r)); y++) for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(m.w - 1, Math.ceil(cx + r)); x++) {
    if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 > r * r) continue;
    out[y * m.w + x] = 1; if (N > n) out[n + y * m.w + x] = 1;
  }
  return out;
}

/** dilate a node set by r tiles (both layers) */
function dilate(m: ArenaMap, nodes: Iterable<number>, r: number, N: number): Uint8Array {
  const out = new Uint8Array(N), n = m.w * m.h, W = m.w;
  for (const node of nodes) {
    const k = node % n, x = k % W, y = (k / W) | 0;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r + 0.5) continue;
      const i = x + dx, j = y + dy;
      if (i < 0 || j < 0 || i >= W || j >= m.h) continue;
      out[j * W + i] = 1; if (N > n) out[n + j * W + i] = 1;
    }
  }
  return out;
}

// ---- the tests ---------------------------------------------------------------------------------------------------------

interface SideCtx { m: ArenaMap; clear: Float32Array; N: number; hazard: Uint8Array }

function allowedFor(S: SideCtx, r: number, extra?: (node: number) => boolean): Uint8Array {
  const out = new Uint8Array(S.N), n = S.m.w * S.m.h;
  for (let v = 0; v < S.N; v++) if (S.clear[v] >= r - 1e-6 && !S.hazard[v % n] && (!extra || extra(v))) out[v] = 1;
  return out;
}

/** the side's two approaches: try each planned approach first, then the shortest path; the second must keep SEP tiles
 *  away from the first outside the exempt zones */
function approachPair(S: SideCtx, L: Layout, team: 'A' | 'B', r: number): { p1: number[] | null; p2: number[] | null; bottleneck?: [number, number] } {
  const m = S.m, s = tileOf(m, L.stage[team]), c = nodeAt(m, [L.contest.x, L.contest.y], L.contest.h);
  const exempt = discMask(m, L.stage[team][0], L.stage[team][1], FUNNEL, S.N);
  const shoulder = discMask(m, L.contest.x, L.contest.y, L.contest.r + 3, S.N);
  for (let v = 0; v < S.N; v++) exempt[v] |= shoulder[v];
  // PBL07: a side's approaches never run through the other side's protected spawn funnel
  const other = team === 'A' ? L.stage.B : L.stage.A;
  const theirs = discMask(m, other[0], other[1], FUNNEL, S.N);
  const base = allowedFor(S, r, (v) => !theirs[v]);
  const firsts: (number[] | null)[] = [];
  for (const A of (L.approaches ?? []).filter((a) => a.team === team)) {
    const corr = dilate(m, A.tiles, 2, S.N);
    const allow = base.slice();
    for (let v = 0; v < S.N; v++) if (!corr[v] && !exempt[v]) allow[v] = 0;
    firsts.push(pathBetween(m, s, c, allow));
  }
  firsts.push(pathBetween(m, s, c, base));
  let last: number[] | null = null;
  for (const p1 of firsts) {
    if (!p1) continue;
    last = p1;
    const buf = dilate(m, p1, SEP, S.N);
    const allow = base.slice();
    for (let v = 0; v < S.N; v++) if (buf[v] && !exempt[v]) allow[v] = 0;
    const p2 = pathBetween(m, s, c, allow);
    if (p2) return { p1, p2 };
  }
  if (!last) return { p1: null, p2: null };
  // the bottleneck: the first tile of the only route outside the exempt zones
  const k = last.find((v) => !exempt[v]) ?? last[0];
  const t = k % (m.w * m.h);
  return { p1: last, p2: null, bottleneck: [t % m.w, (t / m.w) | 0] };
}

/** the last `len` nodes of a path before it reaches the contest platform (the approach proper) */
function finalSegment(m: ArenaMap, p: number[], L: Layout, len: number, extra = 0): number[] {
  const n = m.w * m.h, out: number[] = [];
  const R2 = (L.contest.r + PLATFORM + extra) ** 2;
  let i = p.length - 1;
  while (i >= 0) { const k = p[i] % n; if ((k % m.w + 0.5 - L.contest.x) ** 2 + (((k / m.w) | 0) + 0.5 - L.contest.y) ** 2 > R2) break; i--; }
  for (; i >= 0 && out.length < len; i--) out.push(p[i]);
  return out;
}

function seesShare(m: ArenaMap, px: number, py: number, eye: number, seg: number[], range: number, vis?: number[]): number {
  const n = m.w * m.h;
  let seen = 0, tried = 0;
  for (let i = 0; i < seg.length; i += 2) {
    const v = seg[i], k = v % n, tx = (k % m.w) + 0.5, ty = ((k / m.w) | 0) + 0.5;
    tried++;
    if ((tx - px) ** 2 + (ty - py) ** 2 > range * range) continue;
    if (mapExposureClear(m, px, eye, py, tx, level(m, v) + 0.9, ty)) { seen++; vis?.push(v); }
  }
  return tried ? seen / tried : 0;
}

export function validateHabitat(m0: ArenaMap, L: Layout, profiles: BodyProfile[]): HabReport {
  const gates: GateResult[] = [];
  const gate = (id: string, ok: boolean, value: string) => gates.push({ id, ok, value });
  const n = m0.w * m0.h, N = m0.over ? 2 * n : n, W = m0.w;
  const essential = profiles.filter((p) => p.essential);
  const rMax = Math.max(...essential.map((p) => p.radius));
  const trainer = profiles.find((p) => p.id === 'trainer')!;
  const eyeHi = Math.max(...profiles.filter((p) => p.id.startsWith('trainer')).map((p) => p.eye[1]));
  const hazard = L.hazard ?? new Uint8Array(n);
  const states: Record<string, SideReport[]> = {};
  const metrics: Record<string, number> = {};
  let perches: Perch[] = [];
  const shoreHits: Perch[] = [];
  let shoreLock = 0;
  const pathsFor: Record<string, { p1: number[] | null; p2: number[] | null }> = {};

  const baseClear = clearance(m0);
  for (const st of L.states) {
    const m = stateMap(m0, st, L);
    let clear = baseClear;
    if (m !== m0) {
      const changed = new Uint8Array(n);
      for (let k = 0; k < n; k++) if (m.terrain[k] !== m0.terrain[k] || m.wall[k] !== m0.wall[k] || m.platform[k] !== m0.platform[k] || m.elev[k] !== m0.elev[k]) changed[k] = 1;
      clear = clearance(m, baseClear, changed);
    }
    const S: SideCtx = { m, clear, N, hazard };
    const sides: SideReport[] = [];
    for (const team of ['A', 'B'] as const) {
      const s = tileOf(m, L.stage[team]), c = nodeAt(m, [L.contest.x, L.contest.y], L.contest.h);
      const reach: Record<string, boolean> = {};
      for (const P of essential) reach[P.id] = !!pathBetween(m, s, c, allowedFor(S, P.radius));
      // exit: back from the contest to staging (the symmetric graph makes it the reverse; checked from the contest
      // floor's far edge so a body standing anywhere on the point can leave)
      const exit = !!pathBetween(m, c, s, allowedFor(S, rMax));
      const pair = approachPair(S, L, team, rMax);
      const planned: Record<string, boolean> = {};
      for (const A of (L.approaches ?? []).filter((a) => a.team === team)) {
        const corr = dilate(m, A.tiles, 2, N), ex = discMask(m, L.stage[team][0], L.stage[team][1], FUNNEL, N), sh = discMask(m, L.contest.x, L.contest.y, L.contest.r + 3, N);
        const allow = allowedFor(S, rMax, (v) => !!(corr[v] || ex[v] || sh[v]));
        planned[A.id] = !!pathBetween(m, s, c, allow);
      }
      sides.push({ team, reach, exit, independent: !!(pair.p1 && pair.p2), bottleneck: pair.bottleneck, lengths: [pair.p1?.length ?? 0, pair.p2?.length ?? 0], planned });
      pathsFor[st + team] = pair;
    }
    states[st] = sides;

    // perches: in the stripped state (all destructible cover gone) when the recipe has it, else in the base state
    const perchState = L.states.includes('stripped') ? 'stripped' : 'base';
    if (st === perchState) {
      const reachable = playerReach(m, tileOf(m, L.stage.A));
      const found: Perch[] = [];
      for (const team of ['A', 'B'] as const) {
        const pr = pathsFor[st + team];
        if (!pr.p1 || !pr.p2) continue;
        const s1 = finalSegment(m, pr.p1, L, 14), s2 = finalSegment(m, pr.p2, L, 14);
        if (!s1.length || !s2.length) continue;
        const hMin = Math.min(...[...s1, ...s2].map((v) => level(m, v)));
        // standing on one of the side's own approaches is using it, not perching over it (the side contests it by
        // walking it); a perch is somewhere else
        const planned = (L.approaches ?? []).filter((a) => a.team === team).flatMap((a) => a.tiles);
        const onRoute = dilate(m, [...pr.p1, ...pr.p2, ...planned], 2, N);
        for (let v = 0; v < N; v++) {
          if (!reachable[v] || !nodeOpen(m, v) || onRoute[v]) continue;
          const k = v % n, px = (k % W) + 0.5, py = ((k / W) | 0) + 0.5, h = level(m, v);
          if (h < hMin + 1.5) continue;
          // the contest platform itself is not a perch: standing on the objective is the fight, and both sides reach it
          if (L.platform ? L.platform[k] : (px - L.contest.x) ** 2 + (py - L.contest.y) ** 2 <= (L.contest.r + PLATFORM) ** 2) continue;
          const va: number[] = [], vb: number[] = [];
          const a = seesShare(m, px, py, h + eyeHi, s1, 24, va);
          if (a < 0.5) continue;
          const b = seesShare(m, px, py, h + eyeHi, s2, 24, vb);
          if (b < 0.5) continue;
          // R30: a dominant perch sees both approaches and the point at once
          if (!mapExposureClear(m, px, h + eyeHi, py, L.contest.x, L.contest.h + 0.9, L.contest.y)) continue;
          const weak = a <= b ? va : vb;
          found.push({ tile: k, deck: v >= n, team, sees: [+a.toFixed(2), +b.toFixed(2)], target: weak[0] % n, targets: weak.map((t) => t % n) });
        }
        // shore: a long open shore needs no height. Any standable shore tile (ground, off the side's own routes, off the platform)
        // that sees half of BOTH final stretches at weapon range would lock both approaches from the beach
        if (L.shore) {
          for (let v = 0; v < n; v++) {
            if (!L.shore[v] || !reachable[v] || !nodeOpen(m, v) || onRoute[v] || (L.platform && L.platform[v])) continue;
            const px = (v % W) + 0.5, py = ((v / W) | 0) + 0.5, h = level(m, v);
            const va: number[] = [], vb: number[] = [];
            const a = seesShare(m, px, py, h + eyeHi, s1, RANGE, va);
            const b = seesShare(m, px, py, h + eyeHi, s2, RANGE, vb);
            shoreLock = Math.max(shoreLock, Math.min(a, b));
            if (a < 0.5 || b < 0.5) continue;
            const weak = a <= b ? va : vb;
            shoreHits.push({ tile: v, deck: false, team, sees: [+a.toFixed(2), +b.toFixed(2)], target: weak[0] % n, targets: weak.map((t) => t % n) });
          }
        }
      }
      perches = found;

      // counter: high positions that overlook the contest need a baseline route from both sides or a counter-angle
      const c = nodeAt(m, [L.contest.x, L.contest.y], L.contest.h);
      const fitT = allowedFor(S, trainer.radius);
      const fromA = bfsSym(m, tileOf(m, L.stage.A), fitT), fromB = bfsSym(m, tileOf(m, L.stage.B), fitT);
      let high = 0, unanswered = 0;
      const R2 = 24 * 24;
      const contestTiles: number[] = [];
      for (let k = 0; k < n; k++) { const x = (k % W) + 0.5, y = ((k / W) | 0) + 0.5; if ((x - L.contest.x) ** 2 + (y - L.contest.y) ** 2 <= L.contest.r ** 2 && navOpen(m, k)) contestTiles.push(k); }
      for (let v = 0; v < N; v++) {
        if (!reachable[v] || !nodeOpen(m, v)) continue;
        const k = v % n, px = (k % W) + 0.5, py = ((k / W) | 0) + 0.5, h = level(m, v);
        if (h < L.contest.h + 2.4 || (px - L.contest.x) ** 2 + (py - L.contest.y) ** 2 > R2) continue;
        if (!sightAbs(m, px, py, h + eyeHi, L.contest.x, L.contest.y, L.contest.h + 0.9)) continue;
        high++;
        if (fromA[v] && fromB[v]) continue;
        const answered = contestTiles.some((t, i) => i % 3 === 0 && sightAbs(m, (t % W) + 0.5, ((t / W) | 0) + 0.5, navTop(m, t) + trainer.eye[0], px, py, h + 0.9));
        if (!answered) unanswered++;
      }
      metrics.highGround = high; metrics.unanswered = unanswered;
      gate('counter', unanswered === 0, `${high} high tiles overlook the contest; ${unanswered} with no baseline route from both sides and no counter-angle`);
      void c;
    }
  }

  // ---- gates over every state ----
  for (const st of L.states) {
    const sides = states[st];
    const bad = sides.flatMap((s) => Object.entries(s.reach).filter(([, ok]) => !ok).map(([p]) => `${s.team}:${p}`));
    gate(`reach:${st}`, bad.length === 0 && sides.every((s) => s.exit), bad.length ? `no route for ${bad.join(', ')}` : sides.every((s) => s.exit) ? 'every essential body reaches the contest from both stagings and leaves again' : 'no exit');
    const dep = sides.filter((s) => !s.independent);
    gate(`independent:${st}`, dep.length === 0, dep.length ? dep.map((s) => `${s.team}: one approach (bottleneck at ${s.bottleneck?.join(',') ?? '?'})`).join('; ') : `two approaches per side, ${SEP}+ tiles apart outside the funnel and shoulder`);
  }
  const base = states[L.states[0]];
  const plannedBad = base.flatMap((s) => Object.entries(s.planned).filter(([, ok]) => !ok).map(([id]) => id));
  if (L.approaches?.length) gate('planned', plannedBad.length === 0, plannedBad.length ? `not realised: ${plannedBad.join(', ')}` : 'every planned approach is walkable as built');
  gate('perch', perches.length === 0, perches.length ? `${perches.length} tiles see both of a side's final approaches (worst ${perches[0].team} at ${perches[0].tile % W},${(perches[0].tile / W) | 0}: ${perches[0].sees.join('/')})` : 'no perch watches both of a side\'s approaches');
  if (L.shore) {
    metrics.shoreLock = +shoreLock.toFixed(2);
    gate('shore', shoreHits.length === 0, shoreHits.length ? `${shoreHits.length} open-shore tiles see both of a side's final approaches (worst ${shoreHits[0].team} at ${shoreHits[0].tile % W},${(shoreHits[0].tile / W) | 0}: ${shoreHits[0].sees.join('/')})` : `no open-shore tile sees both of a side's final approaches (strongest lock ${(shoreLock * 100).toFixed(0)} % of the weaker one)`);
  }

  // ---- base-state checks ----
  const m = m0, clear = baseClear;
  const core = enemyCore(m, tileOf(m, L.stage.A), L.dropNav);
  let open = 0, inCore = 0, decks = 0, decksIn = 0;
  for (let k = 0; k < n; k++) if (navOpen(m, k)) { open++; if (core[k]) inCore++; }
  if (m.over) for (let k = 0; k < n; k++) if (m.over[k] > 0) { decks++; if (core[n + k]) decksIn++; }
  gate('connected', open === inCore && decks === decksIn, `${inCore}/${open} tiles, ${decksIn}/${decks} deck in one strongly connected space`);
  const pr = playerReach(m, tileOf(m, L.stage.A));
  let perchOnly = 0;
  for (let v = 0; v < N; v++) if (pr[v] && (v >= n ? m.over![v - n] > 0 : navOpen(m, v)) && !core[v]) perchOnly++;
  gate('playerOnly', perchOnly === 0, `${perchOnly} tiles only the player can stand on`);
  // contest floor (PBL06)
  let disc = 0, usable = 0;
  const fit = allowedFor({ m, clear, N, hazard }, rMax);
  for (let k = 0; k < n; k++) {
    const x = (k % W) + 0.5, y = ((k / W) | 0) + 0.5;
    if ((x - L.contest.x) ** 2 + (y - L.contest.y) ** 2 > L.contest.r ** 2) continue;
    disc++;
    const v = m.over && m.over[k] > 0 && Math.abs(m.over[k] - L.contest.h) < 0.7 ? n + k : k;
    if (fit[v] && core[v] && Math.abs(level(m, v) - L.contest.h) <= 1.2) usable++;
  }
  metrics.contestUsable = +(usable / Math.max(1, disc)).toFixed(2);
  gate('contest', usable / Math.max(1, disc) >= 0.6, `${usable}/${disc} contest tiles fit the largest essential body (${rMax} m) at the point's level`);
  // spawn safety (PBL07)
  const [ax, ay] = L.stage.A, [bx, by] = L.stage.B;
  const hA = navTop(m, tileOf(m, L.stage.A)), hB = navTop(m, tileOf(m, L.stage.B));
  const dSp = Math.hypot(ax - bx, ay - by);
  const seeSp = sightAbs(m, ax, ay, hA + eyeHi, bx, by, hB + 0.9);
  gate('spawns', dSp >= 40 && (!seeSp || dSp > 2 * RANGE), `${dSp.toFixed(0)} m apart, ${seeSp ? 'in' : 'out of'} sight (engagement range ${RANGE} m)`);
  // hazard exits (PBL04 occupied transition, PBL05 recovery): from any hazard tile a safe tile within 4 m
  let hz = 0, worst = 0;
  if (L.hazard) {
    const d = new Int32Array(n).fill(-1), Q = new Int32Array(n);
    let h = 0, t = 0;
    for (let k = 0; k < n; k++) if (navOpen(m, k) && !L.hazard[k] && core[k]) { d[k] = 0; Q[t++] = k; }
    while (h < t) { const a = Q[h++]; for (const [dx, dy] of N4) { const x = (a % W) + dx, y = ((a / W) | 0) + dy; if (x < 0 || y < 0 || x >= W || y >= m.h) continue; const b = y * W + x; if (d[b] < 0 && navOpen(m, b) && Math.abs(navTop(m, b) - navTop(m, a)) <= 0.6) { d[b] = d[a] + 1; Q[t++] = b; } } }
    for (let k = 0; k < n; k++) if (L.hazard[k] && navOpen(m, k)) { hz++; worst = Math.max(worst, d[k] < 0 ? 99 : d[k]); }
    metrics.hazardTiles = hz; metrics.hazardEscape = worst;
    if (hz) gate('hazardExit', worst <= 4, `${hz} hazard tiles; the farthest is ${worst} tiles from safe ground`);
  }
  // joins (R02)
  const badJ: string[] = [];
  for (const J of L.joins ?? []) {
    for (const e of J.ends) {
      if (e < 0) { badJ.push(`${J.what}: unsupported end`); continue; }
      const top = m.over && m.over[e] > 0 ? m.over[e] : navTop(m, e);
      if (Math.abs(top - J.h) > 0.65 && !(J.what === 'arch')) badJ.push(`${J.what}: end at ${top.toFixed(1)} m vs ${J.h} m`);
    }
    if ((J.what === 'causeway' || J.what === 'arch') && J.clearance > 0 && J.clearance < CLEARANCE) badJ.push(`${J.what}: ${J.clearance.toFixed(1)} m headroom`);
  }
  gate('joins', badJ.length === 0, badJ.length ? badJ.slice(0, 4).join('; ') : `${(L.joins ?? []).length} joins supported with headroom`);
  // drainage (R03): fluid tiles reach an outlet or sink moving downstream (level never rises)
  if (m.wlevel) {
    const wl = m.wlevel, isF = (k: number) => m.terrain[k] === T.water || !!(L.culvert && L.culvert[k]);
    const seen = new Uint8Array(n), Q = new Int32Array(n);
    let h = 0, t = 0;
    for (const p of [...(L.outlets ?? []), ...(L.sinks ?? [])]) {
      // the nearest fluid tile to each outlet / sink
      let best = -1, bd = Infinity;
      for (let k = 0; k < n; k++) if (isF(k)) { const d = ((k % W) - p[0]) ** 2 + (((k / W) | 0) - p[1]) ** 2; if (d < bd) { bd = d; best = k; } }
      if (best >= 0 && !seen[best]) { seen[best] = 1; Q[t++] = best; }
    }
    while (h < t) {
      const a = Q[h++];
      for (const [dx, dy] of N4) {
        const x = (a % W) + dx, y = ((a / W) | 0) + dy;
        if (x < 0 || y < 0 || x >= W || y >= m.h) continue;
        const b = y * W + x;
        if (!seen[b] && isF(b) && wl[b] >= wl[a] - 0.01) { seen[b] = 1; Q[t++] = b; }
      }
    }
    let fl = 0, lost = 0, falls = 0;
    for (let k = 0; k < n; k++) if (isF(k)) {
      fl++; if (!seen[k]) lost++;
      const x = k % W;
      if (x < W - 1 && isF(k + 1) && Math.abs(wl[k] - wl[k + 1]) > 2) falls++;
      if (k + W < n && isF(k + W) && Math.abs(wl[k] - wl[k + W]) > 2) falls++;
    }
    metrics.fluidTiles = fl; metrics.fallsEdges = falls;
    gate('drainage', lost === 0, lost ? `${lost}/${fl} fluid tiles do not drain to an outlet or sink` : `${fl} fluid tiles drain to ${(L.outlets ?? []).length} outlet(s) and ${(L.sinks ?? []).length} sink(s)`);
  }
  if (L.tide) tideGates(m0, L, profiles, baseClear, pathsFor, gate, metrics);
  if (L.graves) markerGates(m0, L, profiles, pathsFor, gate, metrics);
  // body fit along the planned approaches (PBL01): narrowest clearance on each as built
  for (const A of L.approaches ?? []) {
    let narrow = Infinity;
    const pair = pathsFor[L.states[0] + A.team];
    const tiles = new Set(A.tiles);
    for (const p of [pair?.p1, pair?.p2]) if (p) for (const v of p) if (tiles.has(v % n)) narrow = Math.min(narrow, clear[v]);
    metrics[`width:${A.id}`] = narrow === Infinity ? -1 : +(narrow * 2).toFixed(2);
  }
  // travel times and skew (PBL09, review)
  const t = (p: number[] | null, sp: number) => (p ? p.length / sp : Infinity);
  const tA = Math.min(t(pathsFor[L.states[0] + 'A'].p1, trainer.speed), t(pathsFor[L.states[0] + 'A'].p2, trainer.speed));
  const tB = Math.min(t(pathsFor[L.states[0] + 'B'].p1, trainer.speed), t(pathsFor[L.states[0] + 'B'].p2, trainer.speed));
  metrics.timeA = +tA.toFixed(1); metrics.timeB = +tB.toFixed(1);
  metrics.skew = +(Math.abs(tA - tB) / Math.max(tA, tB)).toFixed(3);
  metrics.perches = perches.length;
  return { ok: gates.every((g) => g.ok), gates, failed: gates.filter((g) => !g.ok).map((g) => g.id), states, perches: [...perches, ...shoreHits], metrics };
}

// ---- grave markers (docs/HABITATS.md "Cemetery") ----------------------------------------------------------------------------

/** the longest straight firing lane through a plot (tiles): measured from every open tile within PLOT_ZONE of a marker, in 16
 *  directions at a muzzle height, ending at a wall, a rise over the ray, the contest platform or where the ray leaves the plot
 *  zone. The run includes the zone's margin at both ends, so the limit is the Raiders' ranged reach plus that margin plus a body:
 *  a lane longer than that lets one end of a row fire down it from beyond return range, the "firing alley with one dominant
 *  end" of spec T26. A plot's rows are the lanes this keeps short. */
export const LANE = defaultRules.enemy.rangedRange + 2 * PLOT_ZONE + 1.4;
/** share of a side's other approach (its final 14 nodes) a watcher on the first may see; the same bound as a perch's */
export const WATCH = 0.5;
const LANE_CAP = 40;
/** tiles beyond the contest platform (5 m from the point, plus its shoulder) that still belong to the fight for the point: the
 *  forecourt wall and the first body-lengths outside its gates. The court is open by design, so two gates ~90 degrees apart see
 *  each other through it out to a radius of 15.5 m; a route is judged as an approach from 16 m on, where the chord between
 *  the gates no longer passes through the court */
const SHOULDER = 6;

/** the muzzle (eye) extremes of the roster's essential bodies: the smallest wild Pokémon's 0.5 m to the tallest partner's 1.42 m */
export function muzzles(profiles: BodyProfile[]): [number, number] {
  const ess = profiles.filter((p) => p.essential);
  return [Math.min(...ess.map((p) => p.eye[0])), Math.max(...ess.map((p) => p.eye[1]))];
}

/** per open precinct tile: the longest clear straight run (tiles) at a muzzle height, over 16 directions. A ray holds the absolute
 *  height of its muzzle, so a ground rise (a marker, a ledge) blocks it exactly as sightAbs would. */
export function laneField(m: ArenaMap, region: Uint8Array, platform: Uint8Array | undefined, muzzle: number, zone: Uint8Array): { max: number; at: number; dir: number } {
  const W = m.w, H = m.h;
  let best = { max: 0, at: -1, dir: 0 };
  const DIRS16: [number, number][] = [];
  for (let i = 0; i < 16; i++) DIRS16.push([Math.cos((i / 16) * Math.PI * 2), Math.sin((i / 16) * Math.PI * 2)]);
  for (let k = 0; k < W * H; k++) {
    if (!zone[k] || !region[k] || !navOpen(m, k) || (platform && platform[k])) continue;
    const px = (k % W) + 0.5, py = ((k / W) | 0) + 0.5, y = navTop(m, k) + muzzle;
    for (let d = 0; d < 16; d++) {
      const [dx, dy] = DIRS16[d];
      let len = 0;
      for (let s = 1; s <= LANE_CAP * 2; s++) {
        const x = Math.floor(px + dx * s * 0.5), z = Math.floor(py + dy * s * 0.5);
        if (x < 0 || z < 0 || x >= W || z >= H) break;
        const t = z * W + x;
        if (!zone[t] || !region[t] || (platform && platform[t]) || m.wall[t] || navTop(m, t) > y) break;
        len = s * 0.5;
      }
      if (len > best.max) best = { max: len, at: k, dir: d };
    }
  }
  return best;
}

/** Marker gates, on the final collision:
 *   marker:height  the three classes bracket the roster's muzzle extremes; every marker's footprint carries its class height;
 *                  none touches a tread, the contest platform or the forecourt; every class is present
 *   lane           no straight firing lane inside the precinct is longer than LANE, at the smallest or the tallest muzzle
 *   watch          a watcher on a side's main row (its first approach) sees under WATCH of the other approach's final stretch
 *                  at either muzzle, and the other way round: the second way to the monument stays unwatched */
function markerGates(m0: ArenaMap, L: Layout, profiles: BodyProfile[], pathsFor: Record<string, { p1: number[] | null; p2: number[] | null }>,
  gate: (id: string, ok: boolean, value: string) => void, metrics: Record<string, number>) {
  const G = L.graves!, n = m0.w * m0.h, W = m0.w;
  const [lo, hi] = muzzles(profiles);
  // ---- height: the bracket, the built footprints, the clearances ----
  const br = bracketsMuzzles(lo, hi);
  const bad: string[] = [];
  const tread = new Uint8Array(n);
  for (const A of L.approaches ?? []) for (const k of A.tiles) tread[k] = 1;
  const count = { kerb: 0, stone: 0, stele: 0 };
  for (const mk of G.marks) {
    count[mk.cls]++;
    for (let i = mk.x; i < mk.x + mk.w; i++) {
      const k = mk.y * W + i;
      if (Math.abs(m0.platform[k] - mk.top) > 0.011) bad.push(`${mk.x},${mk.y}: ${m0.platform[k].toFixed(2)} m, not ${mk.top} m`);
      if (L.platform && L.platform[k]) bad.push(`${mk.x},${mk.y}: on the contest platform`);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const j = (mk.y + dy) * W + i + dx; if (j >= 0 && j < n && tread[j]) bad.push(`${mk.x},${mk.y}: beside a tread`); }
    }
  }
  metrics.markers = G.marks.length; metrics.kerbs = count.kerb; metrics.stones = count.stone; metrics.steles = count.stele;
  const classesOk = count.stone > 0 && count.stele > 0 && count.kerb > 0;
  gate('marker:height', br.ok && bad.length === 0 && classesOk, !br.ok ? br.why : bad.length ? [...new Set(bad)].slice(0, 3).join('; ') : !classesOk ? `a class is missing (${count.kerb} kerbs, ${count.stone} headstones, ${count.stele} steles)` : `${G.marks.length} markers (${count.kerb} kerbs, ${count.stone} headstones, ${count.stele} steles): ${br.why}`);

  // ---- lanes and watchers, in the state where every destructible prop is gone (markers stay: they are terrain-grade) ----
  const st = L.states.includes('stripped') ? 'stripped' : 'base';
  const m = stateMap(m0, st, L);
  // a plot zone: every tile within PLOT_ZONE of a marker (an alley between two rows lies 1-1.6 tiles from the markers either side)
  const lanes: string[] = [], zone = new Uint8Array(n);
  for (const mk of G.marks) for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= mk.w + 2; dx++) {
    const x = mk.x + dx, y = mk.y + dy;
    if (x < 0 || y < 0 || x >= W || y >= m0.h) continue;
    const ex = Math.max(mk.x - (x + 0.5), 0, x + 0.5 - (mk.x + mk.w)), ey = Math.max(mk.y - (y + 0.5), 0, y + 0.5 - (mk.y + 1));
    if (Math.hypot(ex, ey) <= PLOT_ZONE) zone[y * W + x] = 1;
  }
  let worst = 0;
  for (const [name, mz] of [['small', lo], ['tall', hi]] as const) {
    const r = laneField(m, G.precinct, L.platform, mz, zone);
    metrics[`lane:${name}`] = r.max; worst = Math.max(worst, r.max);
    lanes.push(`${name} muzzle ${mz} m: ${r.max} tiles${r.at >= 0 ? ` from ${r.at % W},${(r.at / W) | 0}` : ''}`);
  }
  gate('lane', worst <= LANE, `longest straight firing lane through a plot (limit ${LANE} tiles): ${lanes.join('; ')}`);

  const watched: string[] = [];
  let seen = 0;
  for (const team of ['A', 'B'] as const) {
    const pr = pathsFor[st + team];
    if (!pr?.p1 || !pr.p2) continue;
    const s1 = finalSegment(m, pr.p1, L, 14, SHOULDER), s2 = finalSegment(m, pr.p2, L, 14, SHOULDER);
    for (const [from, to, name] of [[pr.p1, s2, 'main→alt'], [pr.p2, s1, 'alt→main']] as const) {
      let top = 0, where = -1;
      for (const v of from) {
        const k = v % n;
        if (v >= n || !G.precinct[k] || (L.platform && L.platform[k])) continue;
        const px = (k % W) + 0.5, py = ((k / W) | 0) + 0.5;
        // inside the contest shoulder a body is in the fight on the point, not on an approach: judged from beyond it
        if ((px - L.contest.x) ** 2 + (py - L.contest.y) ** 2 < (L.contest.r + PLATFORM + SHOULDER) ** 2) continue;
        for (const mz of [lo, hi]) { const sh = seesShare(m, px, py, level(m, v) + mz, to, 30); if (sh > top) { top = sh; where = k; } }
      }
      metrics[`watch:${team}:${name}`] = +top.toFixed(2); seen = Math.max(seen, top);
      if (top >= WATCH) watched.push(`${team} ${name} ${(top * 100).toFixed(0)} % from ${where % W},${(where / W) | 0}`);
    }
  }
  gate('watch', watched.length === 0, watched.length ? `the other approach is watched (limit ${WATCH * 100} %): ${watched.join('; ')}` : `no watcher on one approach sees ${WATCH * 100} % of the other's final stretch at either muzzle (worst ${(seen * 100).toFixed(0)} %)`);

  // ---- what the markers do to the small and the tall muzzle: the defender on the point looking down each approach (reported) ----
  const c = nodeAt(m, [L.contest.x, L.contest.y], L.contest.h);
  const ck = c % n, cx = (ck % W) + 0.5, cy = ((ck / W) | 0) + 0.5;
  let gap = 0;
  for (const team of ['A', 'B'] as const) {
    const pr = pathsFor[st + team];
    if (!pr?.p1 || !pr.p2) continue;
    for (const p of [pr.p1, pr.p2]) {
      const seg = finalSegment(m, p, L, 14);
      gap += seesShare(m, cx, cy, level(m, c) + hi, seg, 30) - seesShare(m, cx, cy, level(m, c) + lo, seg, 30);
    }
  }
  metrics.muzzleGap = +gap.toFixed(2);
}

/** symmetric baseline reach over allowed nodes */
function bfsSym(m: ArenaMap, src: number, allowed: Uint8Array): Uint8Array {
  const p = new Uint8Array(allowed.length);
  // reuse pathBetween's step rule by flooding: a path to every node is wasteful; walk the graph directly
  const n = m.w * m.h, W = m.w, Q = new Int32Array(allowed.length);
  let h = 0, t = 0;
  if (!allowed[src]) return p;
  p[src] = 1; Q[t++] = src;
  while (h < t) {
    const a = Q[h++], k = a % n, x = k % W, y = (k / W) | 0, ha = level(m, a);
    for (const [dx, dy] of N4) {
      const i = x + dx, j = y + dy;
      if (i < 0 || j < 0 || i >= W || j >= m.h) continue;
      const b = j * W + i;
      for (const v of m.over && m.over[b] > 0 ? [b, n + b] : [b]) {
        if (p[v] || !allowed[v] || !nodeOpen(m, v)) continue;
        // a walker lands on the deck when within reach of it (World.height), else the ground
        const ov = m.over ? m.over[b] : 0;
        if (ov > 0 && (ha >= ov - 0.9) !== (v >= n)) continue;
        if (Math.abs(level(m, v) - ha) > 0.6) continue;
        p[v] = 1; Q[t++] = v;
      }
    }
  }
  return p;
}

/** the farthest (m) a body caught by high water may be from dry ground it can climb out onto: the slowest playable
 *  Pokémon wading (7.2 m/s × 0.75 = 5.4 m/s) covers 11 m in about 2 s of the 5 s water clock (about 40 % of its maximum HP) */
export const TIDE_EXIT = 11;
/** the low-water shortcut must save at least this share of the best dry route (per side) */
export const TIDE_GAIN = 0.1;
/** a body in water climbs a bank this high above the surface (rules.hazards.climbOut) */
const CLIMB_OUT = 0.8;

/** Tidal gates (docs/HABITATS.md "Tide"), on the final collision:
 *   tide:dry       the contest, both stagings and every planned approach stay off the tidal floor (above maximum tide)
 *   tide:exit      at high water every flooded tile is within TIDE_EXIT tiles (swimming) of dry, connected ground it can
 *                  climb out onto
 *   tide:shortcut  at low water each side's shortest route to the point, using the dry tidal floor, is at least TIDE_GAIN
 *                  shorter than its best route that avoids it (the shortcut is worth taking)
 *   tide:swim      at high water a swimmer (a Water type, or anything knowing Surf) still has that shortcut: a route
 *                  staging → point through the flooded floor, entering and leaving by banks it can climb, shorter than
 *                  the best dry route */
function tideGates(m0: ArenaMap, L: Layout, profiles: BodyProfile[], clear: Float32Array, pathsFor: Record<string, { p1: number[] | null; p2: number[] | null }>,
  gate: (id: string, ok: boolean, value: string) => void, metrics: Record<string, number>) {
  const T0 = L.tide!, n = m0.w * m0.h, W = m0.w, N = m0.over ? 2 * n : n;
  const trainer = profiles.find((p) => p.id === 'trainer')!;
  const mask = T0.mask;
  let tiles = 0;
  for (let k = 0; k < n; k++) if (mask[k] && !m0.wall[k]) tiles++;
  metrics.tideTiles = tiles;
  // ---- dry: nothing required is tidal ----
  const wet: string[] = [];
  const cT = tileOf(m0, [L.contest.x, L.contest.y]);
  for (let k = 0; k < n; k++) {
    if (!mask[k]) continue;
    const x = (k % W) + 0.5, y = ((k / W) | 0) + 0.5;
    if ((x - L.contest.x) ** 2 + (y - L.contest.y) ** 2 <= L.contest.r ** 2) { wet.push('contest'); break; }
  }
  for (const t of ['A', 'B'] as const) if (mask[tileOf(m0, L.stage[t])]) wet.push(`staging ${t}`);
  for (const A of L.approaches ?? []) if (A.tiles.some((k) => mask[k] && !(m0.over && m0.over[k] > 0))) wet.push(A.id);
  gate('tide:dry', wet.length === 0 && L.contest.h > T0.high, wet.length ? `tidal: ${wet.join(', ')}` : `the point (${L.contest.h} m), both stagings and every planned approach stay above maximum tide (${T0.high} m)`);

  // ---- exit at high water: swim distance from every flooded tile to a dry bank it can climb onto ----
  const fm = stateMap(m0, 'flooded', L), core = enemyCore(fm, cT, L.dropNav);
  const d = tideExitField(fm, core, T0.high);
  let worst = 0, stuck = 0;
  for (let k = 0; k < n; k++) if (fm.terrain[k] === T.water && mask[k]) { if (d[k] === Infinity) stuck++; else worst = Math.max(worst, d[k]); }
  metrics.tideExit = stuck ? 99 : +worst.toFixed(1);
  gate('tide:exit', stuck === 0 && worst <= TIDE_EXIT, stuck ? `${stuck} flooded tiles have no bank to climb out onto` : `${tiles} tiles flood at high water; the farthest is ${worst.toFixed(1)} m from a bank (limit ${TIDE_EXIT} m)`);

  // ---- shortcut at low water, and the swimmer's route at high water ----
  const fitT = new Uint8Array(N);
  for (let v = 0; v < N; v++) fitT[v] = clear[v] >= trainer.radius - 1e-6 ? 1 : 0;
  const c = nodeAt(m0, [L.contest.x, L.contest.y], L.contest.h);
  const lows: string[] = [], swims: string[] = [];
  let okS = true, okW = true;
  for (const team of ['A', 'B'] as const) {
    const s = tileOf(m0, L.stage[team]);
    const any = pathBetween(m0, s, c, fitT);
    const dryAllow = fitT.slice();
    for (let v = 0; v < N; v++) if (v < n && mask[v]) dryAllow[v] = 0;
    const dry = pathBetween(m0, s, c, dryAllow);
    const la = any?.length ?? Infinity, ld = dry?.length ?? Infinity;
    const gain = ld === Infinity ? 0 : 1 - la / ld;
    metrics[`shortcut${team}`] = +gain.toFixed(3);
    const usesTide = !!any && any.some((v) => v < n && mask[v]);
    if (!(usesTide && gain >= TIDE_GAIN)) okS = false;
    lows.push(`${team} ${la}/${ld} tiles (${(gain * 100).toFixed(0)} %)`);
    const sw = swimPath(fm, s, c, mask, T0.high, fitT);
    metrics[`swim${team}`] = sw ?? -1;
    if (sw === null || sw >= ld) okW = false;
    swims.push(`${team} ${sw ?? 'none'}/${ld} tiles`);
  }
  void pathsFor;
  gate('tide:shortcut', okS, `low water, shortest through the tidal floor vs best dry route: ${lows.join('; ')} (needs ${TIDE_GAIN * 100} %)`);
  gate('tide:swim', okW, `high water, a swimmer through the flood vs best dry route: ${swims.join('; ')}`);
}

/** swim distance (m, tile centre to tile centre: 8 directions, no corner cutting) from every open water tile of the map
 *  to the nearest bank a body in the water can climb out onto: dry, open, in `core`, at most CLIMB_OUT above the surface
 *  `wl` and not more than a step below it. Infinity where there is none (and on every dry tile). */
export function tideExitField(m: ArenaMap, core: Uint8Array, wl: number): Float64Array {
  const W = m.w, H = m.h, n = W * H, d = new Float64Array(n).fill(Infinity);
  const water = (k: number) => m.terrain[k] === T.water && !m.wall[k];
  const heap: number[] = [];
  const push = (k: number) => { heap.push(k); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (d[heap[p]] <= d[heap[i]]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop()!; if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let b = i; if (l < heap.length && d[heap[l]] < d[heap[b]]) b = l; if (r < heap.length && d[heap[r]] < d[heap[b]]) b = r; if (b === i) break; [heap[b], heap[i]] = [heap[i], heap[b]]; i = b; } } return top; };
  for (let k = 0; k < n; k++) {
    if (!water(k)) continue;
    const x = k % W, y = (k / W) | 0;
    for (const [dx, dy] of N4) {
      const i = x + dx, j = y + dy;
      if (i < 0 || j < 0 || i >= W || j >= H) continue;
      const b = j * W + i, top = navTop(m, b);
      if (navOpen(m, b) && core[b] && top - wl <= CLIMB_OUT && top >= wl - 0.6) { d[k] = 1; push(k); break; }
    }
  }
  const seen = new Uint8Array(n);
  while (heap.length) {
    const a = pop();
    if (seen[a]) continue;
    seen[a] = 1;
    const x = a % W, y = (a / W) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const i = x + dx, j = y + dy;
      if (i < 0 || j < 0 || i >= W || j >= H) continue;
      const b = j * W + i;
      if (!water(b) || seen[b]) continue;
      if (dx && dy && !(water(y * W + i) && water(j * W + x))) continue;
      const v = d[a] + (dx && dy ? Math.SQRT2 : 1);
      if (v < d[b] - 1e-9) { d[b] = v; push(b); }
    }
  }
  return d;
}

/** shortest route (tiles) for a swimmer: ground nodes, dry where a trainer fits (steps ≤ 0.6 m) or flooded water at
 *  level `wl`; a swimmer enters the water off a bank and climbs out onto one at most CLIMB_OUT above the surface. null
 *  when there is none. The path must reach the contest's ground node (decks are walked as on land). */
function swimPath(m: ArenaMap, a: number, b: number, mask: Uint8Array, wl: number, fit: Uint8Array): number | null {
  const n = m.w * m.h, W = m.w, D = new Int32Array(n).fill(-1), Q = new Int32Array(n);
  const water = (k: number) => m.terrain[k] === T.water && !!mask[k] && !m.wall[k];
  const top = (k: number) => (water(k) ? wl : navTop(m, k));
  const ok = (k: number) => water(k) || (navOpen(m, k) && fit[k] === 1);
  const goal = b % n;
  if (!ok(a)) return null;
  let h = 0, t = 0;
  D[a] = 0; Q[t++] = a;
  while (h < t) {
    const u = Q[h++];
    if (u === goal) return D[u];
    const x = u % W, y = (u / W) | 0;
    for (const [dx, dy] of N4) {
      const i = x + dx, j = y + dy;
      if (i < 0 || j < 0 || i >= W || j >= m.h) continue;
      const v = j * W + i;
      if (D[v] >= 0 || !ok(v)) continue;
      const dh = top(v) - top(u), lim = water(u) || water(v) ? CLIMB_OUT : 0.6;
      if (Math.abs(dh) > lim && !(water(v) && dh < 0)) continue; // dropping into water off any bank is allowed
      D[v] = D[u] + 1; Q[t++] = v;
    }
  }
  return null;
}
