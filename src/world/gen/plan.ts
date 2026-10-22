// Stage 1: the region plan. Pick an archetype (north ridge, river valley, central hollow), a quarter-turn and mirror,
// and lay out a place graph: spawn hub, boss glade, landmarks, a hamlet, a lookout and two objective sites, with the
// distances between them that make a route. Places are laid out in a canonical frame and transformed onto the map.
import type { GenCtx, Place, PlaceKind } from './context';
import { d2 } from './util';

const NAMES: Record<PlaceKind, string[]> = {
  hub: ['Crossroads'],
  boss: ['Battle Glade', 'Proving Glade', 'Ringstone Glade'],
  shrine: ['Old Shrine Ruins', 'Hillside Shrine', 'Windward Shrine', 'Mossy Shrine'],
  oak: ['Elder Oak', 'Whisperleaf Oak', 'Old Wayfarer Oak', 'Lantern Oak'],
  pond: ['Mirror Pond', 'Reedwater Pond', 'Dappled Pond', 'Stillwater Pool'],
  hamlet: ['Petalbrook', 'Thistledown', 'Hollyhock', 'Fernwick', 'Larkspur'],
  berry: ['Berry Grove', 'Oran Thicket', 'Sweetbough Grove'],
  arch: ['Twin Stones', 'Standing Stones', 'Hollow Gate'],
  lookout: ['Lookout Bluff', 'Kite Hill', 'Sunward Bluff', 'High Meadow'],
  site: ['Clearing'],
};

interface Proto { kind: PlaceKind; u: [number, number]; v: [number, number]; r: number }

/** canonical layouts (u, v in [0, 1] of the interior); the ridge/river/lake features live in terrain.ts */
const LAYOUTS: Record<GenCtx['archetype'], Proto[]> = {
  ridge: [
    { kind: 'hub', u: [0.38, 0.62], v: [0.54, 0.62], r: 13 },
    { kind: 'boss', u: [0.28, 0.72], v: [0.86, 0.9], r: 9 },
    { kind: 'shrine', u: [0.22, 0.78], v: [0.17, 0.2], r: 5 },
    { kind: 'pond', u: [0.12, 0.3], v: [0.4, 0.5], r: 6 },
    { kind: 'oak', u: [0.7, 0.86], v: [0.68, 0.8], r: 5 },
    { kind: 'hamlet', u: [0.66, 0.8], v: [0.4, 0.5], r: 12 },
    { kind: 'lookout', u: [0.1, 0.3], v: [0.68, 0.8], r: 4 },
    { kind: 'berry', u: [0.55, 0.85], v: [0.06, 0.12], r: 4 },
    { kind: 'site', u: [0.12, 0.35], v: [0.88, 0.92], r: 5 },
    { kind: 'site', u: [0.1, 0.4], v: [0.06, 0.12], r: 5 },
  ],
  valley: [
    { kind: 'hub', u: [0.35, 0.65], v: [0.7, 0.76], r: 13 },
    { kind: 'boss', u: [0.3, 0.7], v: [0.12, 0.17], r: 9 },
    { kind: 'shrine', u: [0.1, 0.26], v: [0.14, 0.24], r: 5 },
    { kind: 'pond', u: [0.76, 0.9], v: [0.82, 0.9], r: 6 },
    { kind: 'oak', u: [0.74, 0.88], v: [0.14, 0.26], r: 5 },
    { kind: 'hamlet', u: [0.16, 0.3], v: [0.74, 0.84], r: 12 },
    { kind: 'lookout', u: [0.7, 0.86], v: [0.62, 0.7], r: 4 },
    { kind: 'arch', u: [0.4, 0.6], v: [0.88, 0.92], r: 3 },
    { kind: 'site', u: [0.1, 0.3], v: [0.9, 0.93], r: 5 },
    { kind: 'site', u: [0.45, 0.6], v: [0.3, 0.34], r: 5 },
  ],
  hollow: [
    { kind: 'hub', u: [0.38, 0.62], v: [0.78, 0.84], r: 13 },
    { kind: 'boss', u: [0.35, 0.65], v: [0.1, 0.15], r: 9 },
    { kind: 'shrine', u: [0.08, 0.2], v: [0.3, 0.46], r: 5 },
    { kind: 'pond', u: [0.42, 0.58], v: [0.44, 0.52], r: 9 },
    { kind: 'oak', u: [0.8, 0.92], v: [0.62, 0.78], r: 5 },
    { kind: 'hamlet', u: [0.16, 0.28], v: [0.7, 0.82], r: 12 },
    { kind: 'lookout', u: [0.8, 0.92], v: [0.26, 0.4], r: 4 },
    { kind: 'berry', u: [0.62, 0.8], v: [0.86, 0.92], r: 4 },
    { kind: 'site', u: [0.15, 0.3], v: [0.1, 0.18], r: 5 },
    { kind: 'site', u: [0.7, 0.85], v: [0.1, 0.18], r: 5 },
  ],
};

export const MARGIN = 13; // tiles of border forest kept clear of places

export function planRegion(g: GenCtx) {
  const R = g.rng('plan');
  g.archetype = R.pick(['ridge', 'valley', 'hollow'] as const);
  g.rot = R.int(0, 3); g.mir = R.chance(0.5);
  const span = g.S - MARGIN * 2;
  const used = new Map<PlaceKind, number>();
  for (const pr of LAYOUTS[g.archetype]) {
    let best: [number, number] | null = null, bestD = -Infinity;
    // a few candidates; keep the one farthest from what is already placed (spreads places out)
    for (let t = 0; t < 6; t++) {
      const cu = R.range(pr.u[0], pr.u[1]), cv = R.range(pr.v[0], pr.v[1]);
      const cx = Math.round(MARGIN + cu * span), cy = Math.round(MARGIN + cv * span);
      const [x, y] = g.toMap(cx, cy);
      let dmin = 1e9;
      for (const p of g.places) dmin = Math.min(dmin, d2(x, y, p.x, p.y) - (p.r + pr.r) ** 2);
      if (dmin > bestD) { bestD = dmin; best = [x, y]; }
    }
    const names = NAMES[pr.kind];
    const n = used.get(pr.kind) ?? 0;
    used.set(pr.kind, n + 1);
    const name = pr.kind === 'site' ? `Clearing ${n + 1}` : names[R.int(0, names.length - 1)];
    g.places.push({ id: g.places.length, kind: pr.kind, x: best![0], y: best![1], r: pr.r, name, elev: 0 });
  }
}

/** Edges of the place graph: a spanning tree by distance from the hub, plus loop edges so spawn and boss join twice. */
export function placeEdges(g: GenCtx): [Place, Place, 'road' | 'trail'][] {
  const P = g.places, hub = g.place('hub')!, boss = g.place('boss')!;
  const out: [Place, Place, 'road' | 'trail'][] = [];
  const inTree = new Set<number>([hub.id]);
  // Prim's tree from the hub, cheapest attachments first; ties by id
  while (inTree.size < P.length) {
    let bd = 1e18, ba: Place | null = null, bb: Place | null = null;
    for (const a of P) if (inTree.has(a.id)) for (const b of P) {
      if (inTree.has(b.id)) continue;
      const d = d2(a.x, a.y, b.x, b.y);
      if (d < bd || (d === bd && b.id < (bb?.id ?? 1e9))) { bd = d; ba = a; bb = b; }
    }
    inTree.add(bb!.id);
    out.push([ba!, bb!, ba!.kind === 'hub' || bb!.kind === 'boss' || ba!.kind === 'boss' ? 'road' : 'trail']);
  }
  // loop: hub → boss directly as a road (if the tree did not already), and a second hub→boss path through
  // the landmark that lies most to the side of the first
  if (!out.some(([a, b]) => (a === hub && b === boss) || (a === boss && b === hub))) out.push([hub, boss, 'road']);
  const mx = (hub.x + boss.x) / 2, my = (hub.y + boss.y) / 2;
  const dx = boss.x - hub.x, dy = boss.y - hub.y;
  let side: Place | null = null, sideD = 0;
  for (const p of P) {
    if (p === hub || p === boss || p.kind === 'site') continue;
    const cross = Math.abs((p.x - hub.x) * dy - (p.y - hub.y) * dx) / Math.sqrt(dx * dx + dy * dy || 1);
    const along = d2(p.x, p.y, mx, my);
    const score = cross - along * 0.004;
    if (cross > 14 && score > sideD) { sideD = score; side = p; }
  }
  // the boss glade gets at least two routes (two entrances), the second from its nearest other place
  if (out.filter(([a, b]) => a === boss || b === boss).length < 2) {
    let nb: Place | null = null, nd = 1e18;
    for (const p of P) {
      if (p === boss || p === hub || out.some(([a, b]) => (a === boss && b === p) || (b === boss && a === p))) continue;
      const d = d2(p.x, p.y, boss.x, boss.y);
      if (d < nd) { nd = d; nb = p; }
    }
    if (nb) out.push([boss, nb, 'trail']);
  }
  if (side) {
    if (!out.some(([a, b]) => (a === hub && b === side) || (a === side && b === hub))) out.push([hub, side, 'trail']);
    if (!out.some(([a, b]) => (a === boss && b === side) || (a === side && b === boss))) out.push([side, boss, 'trail']);
  }
  return out;
}
