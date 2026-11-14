// Layer C — micro structure. Dress the realised space without breaking it:
//   surfaces  — floors, trails running into each clearing, ramps, decks, steps, rock
//   enclosure — forest masses planted as 2×2 trees (thickets fill the gaps at the edge)
//   landmarks — the location's stamps, in zones that satisfy their kind and tier
//   cover     — combat spaces get ring clusters (one blocking piece + low pieces) with gaps between them;
//               raised rims get a broken parapet of low cover; wide paths get a piece at their side now and then
//   decor     — walkable decoration, tall-grass patches, habitat bits
//   anchors   — where enemies enter (entrances, nooks, flank trails), chests, loose stones
// Corridor centre lines, ramps, decks, steps and the spawn clearing are reserved: nothing solid goes there.
import { dcos, dsin } from '../../core/detmath';
import { fbm } from '../../core/rng';
import { HAB } from '../../rules/habitats';
import { PROP_RULES, T, type ArenaPropKind } from '../tiles';
import { K, type LocCtx, type Zone } from './ctx';
import { STAMPS, type Dresser } from './stamps';

export function dress(g: LocCtx) {
  const S = g.S, m = g.m, D = g.def, n = S * S, R = g.rng('dress');
  const reserved = new Uint8Array(n);
  const hub = g.zone('hub')!;
  const reserve = (x: number, y: number, r: number) => {
    for (let j = Math.floor(y - r); j <= y + r; j++) for (let i = Math.floor(x - r); i <= x + r; i++) if (g.in(i, j) && (i - x) ** 2 + (j - y) ** 2 <= r * r) reserved[g.idx(i, j)] = 1;
  };

  // surfaces
  const sfc = D.surface;
  for (let k = 0; k < n; k++) {
    const kd = g.kind[k];
    // rock tops use the grass painter with the cave palette's grey (a mottled natural surface, never paving)
    if (kd === K.mass || kd === K.chasm) m.terrain[k] = T.grass;
    else if (kd === K.zone) m.terrain[k] = g.zones[g.zoneOf[k]].tier > 0 ? sfc.high : sfc.floor;
    else if (kd === K.corridor) m.terrain[k] = sfc.path;
    else if (kd === K.ramp) m.terrain[k] = sfc.ramp;
    else if (kd === K.deck) m.terrain[k] = sfc.bridge === 'wood' ? T.wood : sfc.path;
    else if (kd === K.step) m.terrain[k] = sfc.ramp;
    if (kd === K.ramp || kd === K.deck || kd === K.step) reserved[k] = 1;
    // under an overhead deck: open floor only (nothing tall pokes through the slab)
    if (m.over && m.over[k] > 0) reserved[k] = 1;
  }
  // centre lines: reserved, and trails continue into each clearing toward its centre
  for (const L of g.links) {
    for (let i = 0; i < L.pts.length - 1; i++) {
      const [ax, ay] = L.pts[i], [bx, by] = L.pts[i + 1];
      const steps = Math.ceil(Math.max(Math.abs(bx - ax), Math.abs(by - ay)) * 2);
      for (let s = 0; s <= steps; s++) {
        const x = ax + ((bx - ax) * s) / steps, y = ay + ((by - ay) * s) / steps;
        reserve(x - 0.5, y - 0.5, L.kind === 'path' ? 1.6 : 1.1);
        const k = g.idx(Math.floor(x), Math.floor(y));
        const z = g.zoneOf[k] >= 0 ? g.zones[g.zoneOf[k]] : null;
        if (z && (z.x - x) ** 2 + (z.y - y) ** 2 > (z.r * 0.3) ** 2) {
          for (const [dx, dy] of [[0, 0], [1, 0], [0, 1]]) { const kk = g.idx(Math.floor(x) + dx, Math.floor(y) + dy); if (g.kind[kk] === K.zone) m.terrain[kk] = sfc.path; }
        }
      }
    }
  }
  reserve(hub.x - 0.5, hub.y - 0.5, D.gameplay.spawnOpen);
  for (const z of g.zones) if (z.kind === 'boss') reserve(z.x - 0.5, z.y - 0.5, 4);

  const flatFree = (x: number, y: number, w: number, h: number, zone: number) => {
    const e0 = g.in(x, y) ? m.elev[g.idx(x, y)] : 0;
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) {
      if (!g.in(i, j)) return false;
      const k = g.idx(i, j);
      if (reserved[k] || !g.play(k) || g.kind[k] !== K.zone && g.kind[k] !== K.corridor) return false;
      if (zone >= 0 && g.zoneOf[k] !== zone) return false;
      if (m.wall[k] || m.platform[k] || m.elev[k] !== e0) return false;
    }
    // never leave a one-tile gap between this footprint and another blocker (enemies snag, the camera squeezes)
    const blocked = (i: number, j: number) => !g.in(i, j) || !g.play(g.idx(i, j)) || m.wall[g.idx(i, j)] === 1 || m.platform[g.idx(i, j)] > 0;
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) {
      for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
        const ax = i + dx, ay = j + dy;
        if (ax >= x && ax < x + w && ay >= y && ay < y + h) continue;
        if (!blocked(ax, ay) && blocked(ax + dx, ay + dy)) return false;
      }
    }
    return true;
  };
  const Dr: Dresser = {
    place(kind, x, y, zone, opts) {
      const P = PROP_RULES[kind];
      if (!flatFree(x, y, P.w, P.h, zone)) return false;
      return g.b.prop(kind, x, y, { allowPath: true, force: true, text: opts?.text });
    },
    near(kind, x, y, zone, r = 2, opts) {
      for (let rr = 0; rr <= r; rr++) for (let dy = -rr; dy <= rr; dy++) for (let dx = -rr; dx <= rr; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== rr) continue;
        if (Dr.place(kind, x + dx, y + dy, zone, opts)) return [x + dx, y + dy];
      }
      return null;
    },
    reserve,
  };

  // enclosure: forest masses become trees
  if (D.enclosure.kind === 'forest') plantForest(g);

  // rock enclosure: the location's spire or crystal grows on some rim tops (visual; the mass is already wall)
  if (D.enclosure.kind === 'rock') {
    for (let k = 0; k < n; k++) {
      if (g.kind[k] !== K.mass) continue;
      const x = k % S, y = (k / S) | 0;
      if (!nextToPlay(g, x, y) || (((x * 92837111) ^ (y * 689287499)) >>> 0) % 1000 >= (D.props.rimRate ?? 0.1) * 1000) continue;
      g.b.prop(D.props.massFill, x, y, { force: true, allowPath: true });
    }
  }

  // landmarks
  const maxTier = Math.max(...g.zones.map((z) => z.tier));
  const minTier = Math.min(...g.zones.filter((z) => z.kind !== 'entrance').map((z) => z.tier));
  for (const L of D.landmarks) {
    const want = R.int(L.count[0], L.count[1]);
    const tierOk = (z: Zone) => L.tier === 'any' || (L.tier === 'low' ? z.tier === minTier : L.tier === 'high' ? z.tier > minTier : z.tier === maxTier);
    let cands = g.zones.filter((z) => L.zone.includes(z.kind) && tierOk(z) && (z.kind === 'entrance' || !z.marks.length));
    if (!cands.length && L.tier === 'top') cands = g.zones.filter((z) => z.tier === maxTier && z.kind !== 'entrance' && z.kind !== 'hub' && !z.marks.length);
    if (!cands.length && L.tier === 'low') cands = g.zones.filter((z) => z.tier === minTier && z.kind !== 'entrance' && z.kind !== 'hub' && !z.marks.length);
    // gatehouses go to the entrances nearest the canonical north and south edges
    if (L.stamp === 'gate') cands.sort((a, b) => Math.abs(b.y - S / 2) + Math.abs(b.x - S / 2) * 0.2 - (Math.abs(a.y - S / 2) + Math.abs(a.x - S / 2) * 0.2) || a.id - b.id);
    else cands = R.shuffle(cands);
    let placed = 0;
    for (const z of cands) {
      if (placed >= want) break;
      if (STAMPS[L.stamp](g, z, Dr, placed)) {
        z.marks.push(L.id); placed++;
        if (z.kind !== 'entrance' || !z.name) z.name = L.name;
        m.landmarks.push({ x: Math.round(z.x), y: Math.round(z.y), name: L.name });
      }
    }
    if (placed < L.count[0]) g.notes.push(`landmark ${L.id}: ${placed}/${L.count[0]}`);
  }

  // cover in combat spaces: ring clusters with gaps
  for (const z of g.zones) {
    if (z.kind === 'nook' || z.kind === 'entrance') continue;
    const clusters = Math.max(2, Math.round(z.r / 3.2));
    const a0 = R.range(0, 6.28);
    for (let c = 0; c < clusters; c++) {
      const a = a0 + (c / clusters) * 6.283 + R.range(-0.35, 0.35);
      const rr = Math.max(z.kind === 'hub' ? D.gameplay.spawnOpen + 1.5 : 0, z.r * R.range(0.42, 0.72));
      const cx = Math.round(z.x + dcos(a) * rr * (z.rx / z.r)), cy = Math.round(z.y + dsin(a) * rr * (z.ry / z.r));
      const big = R.pick(D.props.cover);
      const at = Dr.near(big, cx, cy, z.id, 2);
      const lows = R.int(1, 2);
      for (let l = 0; l < lows; l++) {
        const b = a + R.range(-1.2, 1.2);
        Dr.near(R.pick(D.props.low), Math.round((at?.[0] ?? cx) + dcos(b) * 2.5), Math.round((at?.[1] ?? cy) + dsin(b) * 2.5), z.id, 1);
      }
    }
  }
  // parapets: low cover on raised rims, broken every few tiles
  const lipAt: [number, number][] = [];
  for (let k = 0; k < n; k++) {
    if (g.kind[k] !== K.zone || reserved[k] || m.wall[k] || m.platform[k]) continue;
    const x = k % S, y = (k / S) | 0;
    let edge = false;
    for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      const kk = g.idx(x + dx, y + dy);
      if (g.play(kk) && m.elev[k] - m.elev[kk] >= D.gameplay.tierGap * 0.8) edge = true;
    }
    if (!edge || fbm(x / 4, y / 4, g.seed & 0xffff, 1) < 0.5) continue;
    if (lipAt.some(([px, py]) => (px - x) ** 2 + (py - y) ** 2 < 10)) continue;
    if (Dr.place(D.props.lip[(x * 7 + y * 3) % D.props.lip.length], x, y, -1)) lipAt.push([x, y]);
  }
  // wide paths: a low piece at the side every ~9 tiles
  for (const L of g.links) {
    if (L.kind !== 'path' || L.w < 4) continue;
    for (let i = 2; i < L.pts.length - 2; i += 3) {
      const [ax, ay] = L.pts[i], [bx, by] = L.pts[i + 1];
      const dx = bx - ax, dy = by - ay, l = Math.sqrt(dx * dx + dy * dy) || 1;
      const side = (i & 2) ? 1 : -1;
      Dr.place(R.pick(D.props.low), Math.round(ax - (dy / l) * side * (L.w / 2 - 0.5) - 0.5), Math.round(ay + (dx / l) * side * (L.w / 2 - 0.5) - 0.5), -1);
    }
  }

  // decor and habitat
  const s1 = R.int(1, 1e6), habitat = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    if (!g.play(k)) continue;
    const x = k % S, y = (k / S) | 0;
    const z = g.zoneOf[k] >= 0 ? g.zones[g.zoneOf[k]] : null;
    habitat[k] = m.elev[k] > 0.5 ? D.habitat.high : D.habitat.floor;
    if (reserved[k] || m.wall[k] || m.platform[k] || g.kind[k] !== K.zone && g.kind[k] !== K.corridor) continue;
    const f = fbm(x / 5, y / 5, s1, 2);
    if (sfc.tallGrass > 0 && z && z.kind !== 'entrance' && f > 1 - sfc.tallGrass * 1.25 && m.terrain[k] !== sfc.path) {
      if (g.b.prop('tall', x, y, { allowPath: true })) habitat[k] |= D.habitat.patch;
      continue;
    }
    if (D.props.decor.includes('mushroom') && f > 0.66 && nextToMass(g, x, y)) {
      if (g.b.prop('mushroom', x, y, { allowPath: true, force: true })) { habitat[k] |= D.habitat.patch; continue; }
    }
    const flowers = D.props.decor.filter((p) => p.startsWith('flower'));
    if (flowers.length && ((x * 73856093) ^ (y * 19349663)) % 37 === 0) g.b.prop(flowers[(x + y) % flowers.length], x, y, { allowPath: true });
  }
  if (sfc.dots > 0) g.b.dots(0, 0, S, S, sfc.dots, g.seed & 0xffff);
  // step marks: a ladder against the cliff above each hop step (walk-through; the climb is still two jumps)
  if (D.props.stepMark) for (const [x, y] of g.steps) if (g.in(x, y) && !m.wall[g.idx(x, y)]) g.b.prop(D.props.stepMark, x, y, { force: true, allowPath: true });
  g.b.ledgeLips();

  // anchors: entrances, nooks and the middle of flank trails (where an enemy wave walks out of the dark)
  for (const z of g.zones) if (z.kind === 'entrance' || z.kind === 'nook') g.anchors.push([Math.round(z.x), Math.round(z.y)]);
  for (const L of g.links) {
    if (L.kind !== 'trail' || g.zones[L.a].kind === 'entrance' || g.zones[L.b].kind === 'entrance') continue;
    const [x, y] = L.pts[L.pts.length >> 1];
    g.anchors.push([Math.floor(x), Math.floor(y)]);
  }
  // chests: nooks first (exploration reward), then the far side of raised spaces
  for (const z of g.zones) if (z.kind === 'nook') m.chestSpots.push([Math.round(z.x), Math.round(z.y)]);
  for (const z of g.zones) if (z.tier > 0 && z.kind === 'chamber' && m.chestSpots.length < 10) m.chestSpots.push([Math.round(z.x + z.rx * 0.4), Math.round(z.y)]);
  // loose stones beyond the stamps' own
  for (let i = 0, t = 0; g.bodySpots.length < D.bodies && t < 200; t++) {
    const L = g.links[R.int(0, g.links.length - 1)];
    if (L.kind === 'ramp' || L.kind === 'bridge' || !L.tiles.length) continue;
    const k = L.tiles[R.int(0, L.tiles.length - 1)];
    if (reserved[k]) continue;
    g.bodySpots.push([k % S, (k / S) | 0]); i++;
  }
  g.habitat = habitat;
}

function nextToPlay(g: LocCtx, x: number, y: number) {
  for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) if (g.in(x + dx, y + dy) && g.play(g.idx(x + dx, y + dy))) return true;
  return false;
}

function nextToMass(g: LocCtx, x: number, y: number) {
  for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) if (g.in(x + dx, y + dy) && g.kind[g.idx(x + dx, y + dy)] === K.mass) return true;
  return false;
}

/** forest enclosure: 2×2 trees on every mass block that takes one, thickets on the mass edge, walls everywhere */
function plantForest(g: LocCtx) {
  const S = g.S, m = g.m, P = g.def.props;
  const isMass = (x: number, y: number) => g.in(x, y) && g.kind[g.idx(x, y)] === K.mass && !m.wall[g.idx(x, y)];
  for (const off of [0, 1]) for (let y = off; y < S - 1; y += 2) for (let x = off; x < S - 1; x += 2) {
    if (!isMass(x, y) || !isMass(x + 1, y) || !isMass(x, y + 1) || !isMass(x + 1, y + 1)) continue;
    const e = m.elev[g.idx(x, y)];
    if (m.elev[g.idx(x + 1, y)] !== e || m.elev[g.idx(x, y + 1)] !== e || m.elev[g.idx(x + 1, y + 1)] !== e) continue;
    g.b.prop(P.mass[(x * 7 + y * 13) % P.mass.length], x, y, { force: true, allowPath: true });
  }
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    if (!isMass(x, y)) continue;
    let edge = false;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (g.in(x + dx, y + dy) && g.play(g.idx(x + dx, y + dy))) edge = true;
    if (!edge || !g.b.prop(P.massFill, x, y, { force: true, allowPath: true })) m.wall[g.idx(x, y)] = 1;
  }
}

export { HAB };
