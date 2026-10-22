// Stage 5: the authored kit. Landmark stamps (blueprint section 1, "The kit") are written once and placed by every
// seed where their preconditions hold: the shrine ruin on high ground, the elder oak in a flat clearing, the pond
// shore, the camp and signpost at the crossroads, a hamlet grown by a small grammar, the battle glade, a rock gate,
// the log bridge, hedge gates, stone stairs (cut in terrain.ts), a berry grove and the lookouts.
// Each stamp declares its footprint, sockets (where paths enter), its precondition, and the cover and height value the
// gameplay pass counts. Nothing here is noise: every prop has a reason to stand where it stands.
import { datan2, dcos, dsin } from '../../core/detmath';
import { T, type ArenaPropKind } from '../tiles';
import type { GenCtx, Place } from './context';
import { FIX } from './terrain';
import { d2 } from './util';

export interface StampDef {
  id: string; name: string;
  /** footprint (tiles) the stamp needs clear */
  w: number; h: number;
  /** where paths enter, relative to the place centre, with the heading they arrive from */
  sockets: [number, number, 'n' | 'e' | 's' | 'w'][];
  /** precondition, checked by `fits` */
  pre: { flat?: number; minElev?: number; nearWater?: number; farWater?: number };
  /** what the gameplay pass counts: cover pieces and height (m) the stamp adds */
  cover: number; height: number;
}

export const STAMPS: Record<string, StampDef> = {
  shrine: { id: 'shrine', name: 'Shrine ruin', w: 12, h: 9, sockets: [[0, 5, 's']], pre: { minElev: 1.5 }, cover: 5, height: 2 },
  oak: { id: 'oak', name: 'Elder oak', w: 10, h: 8, sockets: [[0, 4, 's'], [4, 0, 'e']], pre: { flat: 4, farWater: 2 }, cover: 1, height: 0 },
  pond: { id: 'pond', name: 'Pond shore', w: 16, h: 12, sockets: [[0, 7, 's']], pre: { nearWater: 2 }, cover: 1, height: 0 },
  camp: { id: 'camp', name: 'Camp and signpost', w: 6, h: 5, sockets: [[0, 0, 's']], pre: { flat: 3 }, cover: 0, height: 0 },
  hamlet: { id: 'hamlet', name: 'Hamlet (grammar)', w: 24, h: 12, sockets: [[-12, 0, 'w'], [12, 0, 'e']], pre: { flat: 10, farWater: 3 }, cover: 4, height: 0 },
  glade: { id: 'glade', name: 'Battle glade', w: 20, h: 16, sockets: [[0, -9, 'n'], [0, 9, 's']], pre: { flat: 7 }, cover: 6, height: 0 },
  arch: { id: 'arch', name: 'Rock gate', w: 8, h: 4, sockets: [[0, 0, 'n'], [0, 0, 's']], pre: { flat: 2 }, cover: 3, height: 0 },
  bridge: { id: 'bridge', name: 'Log bridge', w: 3, h: 6, sockets: [[0, -3, 'n'], [0, 3, 's']], pre: { nearWater: 0 }, cover: 0, height: 0 },
  hedge: { id: 'hedge', name: 'Hedge gate', w: 6, h: 3, sockets: [[0, 0, 'w'], [0, 0, 'e']], pre: { flat: 2 }, cover: 2, height: 0 },
  stair: { id: 'stair', name: 'Stone stair', w: 3, h: 3, sockets: [[0, 2, 's']], pre: { minElev: 1 }, cover: 0, height: 0 },
  berry: { id: 'berry', name: 'Berry grove', w: 8, h: 7, sockets: [[0, 4, 's']], pre: { flat: 3, farWater: 1 }, cover: 4, height: 0 },
  lookout: { id: 'lookout', name: 'Lookout', w: 10, h: 8, sockets: [[0, 4, 's']], pre: { minElev: 1 }, cover: 1, height: 2 },
};

/** precondition check against the shaped terrain */
export function fits(g: GenCtx, def: StampDef, x: number, y: number) {
  const m = g.m, e0 = m.elev[g.idx(x, y)];
  if (def.pre.minElev !== undefined && e0 < def.pre.minElev) return false;
  if (def.pre.flat) {
    const r = def.pre.flat;
    for (let j = y - r; j <= y + r; j++) for (let i = x - r; i <= x + r; i++) if (!g.in(i, j) || (m.elev[g.idx(i, j)] !== e0 && m.terrain[g.idx(i, j)] !== T.water)) return false;
  }
  const waterWithin = (r: number) => { for (let j = y - r; j <= y + r; j++) for (let i = x - r; i <= x + r; i++) if (g.in(i, j) && m.terrain[g.idx(i, j)] === T.water) return true; return false; };
  if (def.pre.farWater !== undefined && waterWithin(def.pre.farWater)) return false;
  return true;
}

/** place a prop at (x, y) or the nearest spot within r that takes it */
function near(g: GenCtx, kind: ArenaPropKind, x: number, y: number, r = 2, opts: { allowPath?: boolean; text?: string; variant?: number } = {}) {
  for (let rr = 0; rr <= r; rr++)
    for (let dy = -rr; dy <= rr; dy++) for (let dx = -rr; dx <= rr; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== rr) continue;
      if (!g.in(x + dx, y + dy)) continue;
      if (g.m.stairs[g.idx(x + dx, y + dy)]) continue;
      if (g.keepOpen[g.idx(x + dx, y + dy)] && kind !== 'shrine' && kind !== 'elder') continue;
      if (g.b.prop(kind, x + dx, y + dy, opts)) return [x + dx, y + dy] as [number, number];
    }
  return null;
}

function open(g: GenCtx, x: number, y: number, r: number) {
  for (let j = y - r; j <= y + r; j++) for (let i = x - r; i <= x + r; i++) if (g.in(i, j) && d2(i, j, x, y) <= r * r) g.keepOpen[g.idx(i, j)] = 1;
}

const ARROWS = ['→', '↘', '↓', '↙', '←', '↖', '↑', '↗'];
function arrow(dx: number, dy: number) {
  const a = datan2(dy, dx);
  return ARROWS[(Math.round(a / (Math.PI / 4)) + 8) % 8];
}

export const BIOME_KINDS: Record<string, { clump: ArenaPropKind[]; low: ArenaPropKind[]; flowers: ArenaPropKind[]; wall: ArenaPropKind[] }> = {
  meadow: { wall: ['tree', 'tree2', 'tree', 'round'], clump: ['tree', 'round', 'tree2'], low: ['bush', 'bushR', 'rock', 'bush', 'stump', 'log'], flowers: ['flowerR', 'flowerW', 'flowerY', 'flowerB'] },
  badlands: { wall: ['deadtree', 'boulder', 'deadtree'], clump: ['boulder', 'deadtree'], low: ['rock', 'rock', 'vent', 'stump'], flowers: ['flowerY'] },
  frost: { wall: ['icepine', 'icepine', 'tree2'], clump: ['icepine', 'boulder'], low: ['rock', 'bushB', 'rock', 'stump'], flowers: ['flowerW', 'flowerB'] },
  dusk: { wall: ['round', 'tree2', 'round'], clump: ['round', 'tree2', 'deadtree'], low: ['mushroom', 'rock', 'bushB', 'stump'], flowers: ['flowerB', 'flowerW'] },
};
export const kindsOf = (b: string) => BIOME_KINDS[b] ?? BIOME_KINDS.meadow;

// ---------------------------------------------------------------------------------------------- stamps

export function stampShrine(g: GenCtx, p: Place) {
  const b = g.b, R = g.rng('stamp:shrine');
  // stone court on the high ground
  for (let y = p.y - 4; y <= p.y + 3; y++) for (let x = p.x - 5; x <= p.x + 5; x++) {
    if (!g.in(x, y)) continue;
    const k = g.idx(x, y);
    if (g.m.elev[k] !== p.elev || g.m.stairs[k]) continue;
    const ax = (x - p.x) / 5.5, ay = (y - p.y + 0.5) / 4;
    if (ax * ax + ay * ay <= 1) g.m.terrain[k] = T.stone;
  }
  near(g, 'shrine', p.x - 1, p.y - 3, 2, { allowPath: true });
  for (const [dx, dy] of [[-5, -2], [5, -2], [-5, 2], [5, 2], [0, -5]] as [number, number][]) near(g, R.chance(0.4) ? 'pillarBroken' : 'pillar', p.x + dx, p.y + dy, 1, { allowPath: true });
  near(g, 'lantern', p.x - 3, p.y - 1, 1, { allowPath: true }); near(g, 'lantern', p.x + 3, p.y - 1, 1, { allowPath: true });
  open(g, p.x, p.y, 4);
  b.landmark(p.x, p.y, p.name);
  const c = near(g, 'flowerW', p.x + 4, p.y + 1, 2); if (c) b.chest(c[0], c[1]);
}

export function stampOak(g: GenCtx, p: Place) {
  const b = g.b, K = kindsOf(g.biome);
  const at = near(g, 'elder', p.x - 2, p.y - 3, 3, { allowPath: false });
  if (!at) g.notes.push(`${p.name}: elder oak did not fit`);
  b.scatter(K.flowers, p.x, p.y + 1, 6, 3, 0.3, g.seed % 997);
  open(g, p.x, p.y + 1, 3);
  b.landmark(p.x, p.y, p.name);
  b.chest(p.x - 3, p.y + 2);
}

export function stampPond(g: GenCtx, p: Place) {
  const b = g.b, R = g.rng('stamp:pond');
  b.scatter(['reeds'], p.x, p.y, 10, 8, 0.32, R.int(1, 999));
  if (g.biome === 'meadow' || g.biome === 'dusk') b.scatter(['lily'], p.x, p.y, 7, 5, 0.12, R.int(1, 999));
  // a log to sit on at the shore, facing the water
  for (let r = 6; r < 12; r++) {
    let done = false;
    for (const [dx, dy] of [[0, 1], [1, 0], [-1, 0], [0, -1]] as [number, number][]) {
      const x = p.x + dx * r - 1, y = p.y + dy * r;
      if (g.in(x, y) && g.m.terrain[g.idx(x, y)] !== T.water && b.prop('log', x, y)) { done = true; break; }
    }
    if (done) break;
  }
  // the landmark stands on the shore nearest the hub
  const hub = g.place('hub')!;
  let lx = p.x, ly = p.y, ld = 1e9;
  for (let y = p.y - 12; y <= p.y + 12; y++) for (let x = p.x - 12; x <= p.x + 12; x++) {
    if (!g.in(x, y)) continue;
    const k = g.idx(x, y);
    if (g.m.terrain[k] === T.water || g.m.wall[k]) continue;
    let shore = false;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (g.in(x + dx, y + dy) && g.m.terrain[g.idx(x + dx, y + dy)] === T.water) shore = true;
    if (!shore) continue;
    const dd = d2(x, y, hub.x, hub.y);
    if (dd < ld) { ld = dd; lx = x; ly = y; }
  }
  b.landmark(lx, ly, p.name);
  for (let r = 7; r < 12; r++) { const x = p.x + r, y = p.y; if (g.in(x, y) && g.m.terrain[g.idx(x, y)] !== T.water && !g.m.wall[g.idx(x, y)]) { b.chest(x, y); break; } }
}

/** the crossroads signpost (render/decor.ts lays the cold camp beside it) */
export function stampCamp(g: GenCtx, p: Place, regionName: string) {
  const parts: string[] = [];
  for (const q of g.places) {
    if (q === p || q.kind === 'site' || q.kind === 'arch') continue;
    if (['shrine', 'pond', 'hamlet', 'boss', 'oak'].includes(q.kind)) parts.push(`${q.kind === 'boss' ? 'Glade' : q.name.split(' ').slice(-1)[0]} ${arrow(q.x - p.x, q.y - p.y)}`);
  }
  const text = `${regionName}: ${parts.slice(0, 4).join(' · ')}`;
  // beside the road, on the corner nearest the hub centre
  for (let r = 2; r < 8; r++) {
    for (const [dx, dy] of [[r, -r], [-r, -r], [r, r], [-r, r], [r, 0], [0, -r]] as [number, number][]) {
      const x = p.x + dx, y = p.y + dy;
      if (!g.in(x, y)) continue;
      const k = g.idx(x, y);
      let byRoute = false;
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (g.in(x + ox, y + oy) && g.route[g.idx(x + ox, y + oy)]) byRoute = true;
      if (!byRoute || g.route[k]) continue;
      if (g.b.prop('sign', x, y, { text })) { g.b.landmark(p.x, p.y, 'Crossroads'); return; }
    }
  }
  g.notes.push('signpost did not fit');
}

/** Hamlet grammar: a main street E–W through the site; lots on its north side face it (DS camera: doors face south);
 *  the south side holds the well, gardens and a fence; a sign at the west end; hedges close the back of the lots. */
export function stampHamlet(g: GenCtx, p: Place): { cabins: [number, number][] } {
  const b = g.b, R = g.rng('stamp:hamlet'), K = kindsOf(g.biome);
  const cabins: [number, number][] = [];
  const y0 = p.y; // street rows y0 and y0 + 1
  const half = 11;
  // street
  for (let x = p.x - half; x <= p.x + half; x++) for (const y of [y0, y0 + 1]) {
    if (!g.in(x, y)) continue;
    const k = g.idx(x, y);
    if (g.m.terrain[k] === T.water || g.m.stairs[k] || Math.abs(g.m.elev[k] - p.elev) > 0.01) continue;
    g.m.terrain[k] = T.path; g.route[k] = g.route[k] || 2; g.keepOpen[k] = 1;
  }
  // lots: cabins north of the street, a one-tile front yard, 5–6 tiles per lot
  const lotW = R.pick([5, 6]);
  for (let x = p.x - half + 1; x + 4 <= p.x + half; x += lotW) {
    const cx = x, cy = y0 - 4; // footprint rows cy..cy+2; door on the south face at row cy+2, yard at y0-1
    if (g.b.prop('cabin', cx, cy, { variant: R.int(0, 3) })) {
      cabins.push([cx, cy]);
      for (let i = cx; i < cx + 4; i++) g.keepOpen[g.idx(i, y0 - 1)] = 1;
      // a hedge closes the back of the lot
      for (let i = cx - 1; i <= cx + 4; i++) if (R.chance(0.8)) b.prop('hedge', i, cy - 1);
    }
  }
  // south side: the well near the centre, a fenced garden, flower beds
  near(g, 'well', p.x - 1, y0 + 3, 2);
  b.flowerBed(p.x + 3, y0 + 3, 3, 2, K.flowers, R.int(1, 999));
  for (let i = p.x + 2; i <= p.x + 7; i++) b.prop('fence', i, y0 + 5);
  b.flowerBed(p.x - 7, y0 + 3, 3, 2, K.flowers, R.int(1, 999));
  near(g, 'bench', p.x - 5, y0 + 3, 1);
  near(g, 'lamp', p.x + 1, y0 + 2, 1);
  near(g, 'sign', p.x - half - 1, y0 - 1, 2, { text: `${p.name} — a quiet hamlet`, allowPath: false });
  b.landmark(p.x, p.y, p.name);
  const c = near(g, 'flowerY', p.x + 8, y0 + 3, 2); if (c) b.chest(c[0], c[1]);
  return { cabins };
}

export function stampGlade(g: GenCtx, p: Place) {
  const b = g.b, R = g.rng('stamp:glade');
  b.blob(p.x, p.y, 8.5, 6.5, g.biome === 'badlands' ? T.dirt : T.sand, 1, R.int(1, 99));
  // keep the blob on the glade's own level
  for (let y = p.y - 9; y <= p.y + 9; y++) for (let x = p.x - 10; x <= p.x + 10; x++) {
    if (!g.in(x, y)) continue;
    const k = g.idx(x, y);
    if ((g.m.terrain[k] === T.sand || g.m.terrain[k] === T.dirt) && (Math.abs(g.m.elev[k] - p.elev) > 0.01)) g.m.terrain[k] = T.grass;
  }
  // a ring of pillars and lanterns at ~10 m, left open where routes enter
  for (let a = 0; a < 8; a++) {
    const ang = (a / 8) * Math.PI * 2 + R.range(-0.1, 0.1);
    const x = Math.round(p.x + dcos(ang) * 10.5), y = Math.round(p.y + dsin(ang) * 8);
    if (!g.in(x, y)) continue;
    let byRoute = false;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (g.in(x + dx, y + dy) && g.route[g.idx(x + dx, y + dy)]) byRoute = true;
    if (byRoute) continue;
    b.prop(a % 2 ? 'lantern' : 'pillar', x, y);
  }
  open(g, p.x, p.y, 8);
  b.landmark(p.x, p.y, p.name);
}

export function stampArch(g: GenCtx, p: Place) {
  const b = g.b;
  // find the route through the gate: boulders on both sides of it
  let horiz = true, cx = p.x, cy = p.y, found = false;
  for (let r = 0; r < 6 && !found; r++) for (let dy = -r; dy <= r && !found; dy++) for (let dx = -r; dx <= r && !found; dx++) {
    const x = p.x + dx, y = p.y + dy;
    if (!g.in(x, y) || !g.route[g.idx(x, y)]) continue;
    cx = x; cy = y; found = true;
    horiz = g.in(x + 2, y) && g.route[g.idx(x + 2, y)] > 0 && g.in(x - 2, y) && g.route[g.idx(x - 2, y)] > 0;
  }
  if (!found) return;
  // walk to the route's edges
  const step: [number, number] = horiz ? [0, 1] : [1, 0];
  let lo = 0, hi = 0;
  while (lo > -5 && g.in(cx + step[0] * (lo - 1), cy + step[1] * (lo - 1)) && g.route[g.idx(cx + step[0] * (lo - 1), cy + step[1] * (lo - 1))]) lo--;
  while (hi < 5 && g.in(cx + step[0] * (hi + 1), cy + step[1] * (hi + 1)) && g.route[g.idx(cx + step[0] * (hi + 1), cy + step[1] * (hi + 1))]) hi++;
  const side = (s: number): [number, number] => [cx + step[0] * s, cy + step[1] * s];
  const [ax, ay] = side(lo - (horiz ? 2 : 2)), [bx, by] = side(hi + 1);
  near(g, 'boulder', ax, ay, 1); near(g, 'boulder', bx, by, 1);
  const [qx, qy] = side(hi + 3); near(g, 'pillarBroken', qx, qy, 1);
  b.landmark(cx, cy, p.name);
}

/** name the longest bridge: it is the region's log bridge landmark; stone lanterns stand at its ends */
export function stampBridges(g: GenCtx) {
  const S = g.S, m = g.m, seen = new Uint8Array(S * S);
  let best: number[] = [];
  for (let k = 0; k < S * S; k++) {
    if (m.terrain[k] !== T.wood || seen[k]) continue;
    const comp: number[] = [], q = [k]; seen[k] = 1;
    while (q.length) { const a = q.pop()!; comp.push(a); const x = a % S, y = (a / S) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (!g.in(nx, ny)) continue; const nk = g.idx(nx, ny); if (!seen[nk] && m.terrain[nk] === T.wood) { seen[nk] = 1; q.push(nk); } } }
    if (comp.length > best.length) best = comp;
  }
  if (!best.length) return;
  let sx = 0, sy = 0;
  for (const k of best) { sx += k % S; sy += (k / S) | 0; }
  g.b.landmark(Math.round(sx / best.length), Math.round(sy / best.length), 'Old Log Bridge');
}

export function stampBerry(g: GenCtx, p: Place) {
  const b = g.b, K = kindsOf(g.biome), R = g.rng('stamp:berry');
  let n = 0;
  for (let t = 0; t < 30 && n < 5; t++) {
    const a = R.range(0, 6.28), r = R.range(2.5, 4.5);
    if (b.prop('berry', Math.round(p.x + dcos(a) * r), Math.round(p.y + dsin(a) * r * 0.8))) n++;
  }
  b.scatter(K.flowers, p.x, p.y, 5, 4, 0.25, R.int(1, 999));
  open(g, p.x, p.y, 2);
  b.landmark(p.x, p.y, p.name);
  b.chest(p.x, p.y);
}

export function stampLookout(g: GenCtx, p: Place) {
  const b = g.b;
  near(g, 'lantern', p.x + 2, p.y - 2, 2, { allowPath: true });
  b.landmark(p.x, p.y, p.name);
  // a chest at the top: the reason to climb
  for (let r = 0; r < 4; r++) { const x = p.x - 1 - r, y = p.y; if (g.in(x, y) && g.m.elev[g.idx(x, y)] === p.elev && !g.m.wall[g.idx(x, y)]) { b.chest(x, y); break; } }
  open(g, p.x, p.y, 2);
}

/** hedge gate: hedges flank a trail where it enters the hamlet or a site */
export function stampHedgeGate(g: GenCtx, p: Place) {
  const S = g.S;
  // find a trail tile 3–6 tiles out from the place
  for (let r = p.r + 1; r < p.r + 5; r++) for (let a = 0; a < 16; a++) {
    const ang = (a / 16) * Math.PI * 2;
    const x = Math.round(p.x + dcos(ang) * r), y = Math.round(p.y + dsin(ang) * r);
    if (!g.in(x, y) || g.route[g.idx(x, y)] !== 2) continue;
    const horiz = g.in(x + 1, y) && g.route[g.idx(x + 1, y)] > 0 && g.in(x - 1, y) && g.route[g.idx(x - 1, y)] > 0;
    let placed = 0;
    for (const s of [-1, 1]) {
      // edge of the trail, then hedges along it for 3 tiles
      let o = 0;
      while (o < 4 && g.in(x + (horiz ? 0 : s * o), y + (horiz ? s * o : 0)) && g.route[g.idx(x + (horiz ? 0 : s * o), y + (horiz ? s * o : 0))]) o++;
      for (let t = -1; t <= 1; t++) {
        const hx = x + (horiz ? t : s * o), hy = y + (horiz ? s * o : t);
        if (g.in(hx, hy) && !g.keepOpen[g.idx(hx, hy)] && g.b.prop('hedge', hx, hy)) placed++;
      }
    }
    if (placed >= 3) { void S; return; }
  }
}

/** objective sites: open, flat, non-flammable ground (bare dirt), away from the routes' flow */
export function stampSite(g: GenCtx, p: Place) {
  for (let y = p.y - 3; y <= p.y + 3; y++) for (let x = p.x - 3; x <= p.x + 3; x++) {
    if (!g.in(x, y) || d2(x, y, p.x, p.y) > 9.5) continue;
    const k = g.idx(x, y);
    if (g.m.terrain[k] === T.grass && Math.abs(g.m.elev[k] - p.elev) < 0.01 && g.fixed[k] !== FIX.plateau) g.m.terrain[k] = T.dirt;
  }
  open(g, p.x, p.y, 5);
  g.sites.push([p.x, p.y]);
}
