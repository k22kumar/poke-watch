// Landform kernels: an environment-first envelope with the mode graph embedded in it (spec section H, "topology-first
// constraints inside an environment-first envelope"). Each kernel
//   1. fixes the landform's defining relief, medium and anchors (locked: repairs may not touch them),
//   2. places the mode graph's nodes (spawns, staging, contest) where the landform gives them meaning,
//   3. fits every approach as dry treads, ramps, crossings, cave mouths and landings with the shared families,
// and leaves vegetation and small props to dress.ts. Both kernels work in a canonical frame (u west→east, v north→
// south) mapped to the map by a seeded quarter turn and mirror; every distance is computed in map space.
//
//   gorge   a river gorge: an upper reach on the plateau falls over a lip into a plunge pool, the outflow splits
//           around a rock island that carries the shrine terrace and rejoins downstream to the map edge (the
//           outlet). Teams hold opposite rims; each has a low bridge approach (rim switchback → floor → bridge →
//           cut ramp) and a screened approach (rim forest → bench ramp → bench → causeway onto the terrace).
//   crater  a breached crater: a walkable rim crest above a crater floor with a bounded lava lake, an outer flank of
//           solid rock, a foot plain around it. Teams start on the foot at opposite sides; each has a grounded
//           switchback cut up the flank to a notch in the crest, and a dry cave (mouth → tunnel → chamber → tunnel)
//           whose last reach runs under the rim crest (an arch) into the crater. An optional cave branch ends in a
//           vent field (the hazard); the breach is the grounded return path.
import { dcos, dsin } from '../../core/detmath';
import { fbm } from '../../core/rng';
import { HK, MED, type Approach, type HabCtx } from './ctx';
import { arch, basin, bench, bridge, causeway, chamber, channel, keepLine, path, plinth, ruinWall, spur, switchback, tunnel, type Pt, type WP } from './families';

const sstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function approach(g: HabCtx, team: 'A' | 'B', kind: 'direct' | 'flank', form: string): Approach {
  const a: Approach = { id: `${team}.${kind}`, team, kind, form, pts: [], tiles: [] };
  g.approaches.push(a);
  return a;
}

/** border: everything within `m` tiles of the map edge is mass at height h */
function border(g: HabCtx, m: number, h: (k: number) => number) {
  for (let y = 0; y < g.S; y++) for (let x = 0; x < g.S; x++) {
    if (x >= m && y >= m && x < g.S - m && y < g.S - m) continue;
    const k = g.idx(x, y);
    if (g.kind[k] === HK.fluid) continue;
    g.H[k] = h(k); g.kind[k] = HK.mass;
  }
}

// =================================================================================================================
// gorge
// =================================================================================================================

export function gorge(g: HabCtx) {
  const R = g.rng('landform'), F = g.recipe.freedoms, L = g.recipe.levels;
  const fr = (key: string) => R.range(F[key][0], F[key][1]);
  g.rot = R.int(0, 3); g.mir = R.chance(0.5);
  const S1 = g.S - 1;
  const C = (x: number, y: number): Pt => g.P(x / S1, y / S1);
  const Dm = (dx: number, dy: number): Pt => g.D(dx, dy);
  const wp = (x: number, y: number, h: number): WP => { const [mx, my] = C(x, y); return { x: mx, y: my, h }; };
  const Hr = L.rim, Ht = L.terrace, Hb = L.bench, WL = L.water;

  // ---- environment fields: the river line, the gorge floor's half width along it ----
  const x0 = S1 / 2 + fr('riverShift'), amp = fr('bend'), freq = fr('bendFreq'), ph = R.range(0, 6.283);
  const rx = (y: number) => x0 + amp * dsin((y / S1) * 6.283 * freq + ph);
  const fallsY = fr('fallsY'), poolR = fr('poolR');
  const poolY = fallsY + poolR - 1.5;
  const irx = fr('islandRx'), iry = fr('islandRy'), armW = R.int(F.armW[0], F.armW[1]);
  const iy = poolY + poolR + iry + fr('islandGap'), ix = rx(iy);
  const bankW = fr('bankW'), downW = fr('downW');
  const Wis = irx + armW + bankW;
  const ys = [poolY - poolR - 0.5, poolY + 1, iy - iry - 3, iy + iry + 3, iy + iry + 16, S1 + 8];
  const ws = [poolR + 0.5, poolR + 3.5, Wis, Wis, downW, downW];
  const fh = (y: number) => {
    if (y <= ys[0]) return -1;
    for (let i = 0; i < ys.length - 1; i++) if (y <= ys[i + 1]) return lerp(ws[i], ws[i + 1], sstep(ys[i], ys[i + 1], y));
    return downW;
  };
  g.shape.bend = +amp.toFixed(2); g.shape.falls = +fallsY.toFixed(1); g.shape.island = +iy.toFixed(1);
  const wob = R.int(1, 1e6);

  // ---- relief: rim plateau, gorge floor (kernel 1); the step between them is the gorge wall (cliff family) ----
  g.used.add('cliff');
  for (let y = 0; y < g.S; y++) for (let x = 0; x < g.S; x++) {
    const [cx, cy] = g.Q(x + 0.5, y + 0.5);
    const k = g.idx(x, y), w = fh(cy);
    const edge = w + (fbm(cx / 7, cy / 7, wob, 2) - 0.5) * 3;
    if (w > 0 && Math.abs(cx - rx(cy)) <= edge) { g.H[k] = 0; g.kind[k] = HK.floor; }
    else { g.H[k] = Hr; g.kind[k] = HK.floor; }
  }

  // ---- channels and basins (kernels 2 + 4): upper reach, falls, plunge pool, outflow, arms around the island ----
  const line = (a: number, b: number, off = 0, step = 2): Pt[] => { const out: Pt[] = []; for (let y = a; y <= b; y += step) out.push(C(rx(y) + off, y)); out.push(C(rx(b) + off, b)); return out; };
  channel(g, line(-6, poolY - poolR + 1.2), armW + 1, { med: MED.water, wl: () => Hr + WL, lock: true });
  basin(g, ...C(rx(poolY), poolY), poolR, poolR * 0.92, { med: MED.water, wl: WL, lock: true });
  channel(g, line(poolY, S1 + 6), armW + 0.5, { med: MED.water, wl: () => WL, lock: true });
  // the island (bank ring at floor level, the shrine terrace raised inside it)
  const [icx, icy] = C(ix, iy);
  const rot = g.rot % 2 === 1;
  const erx = rot ? iry : irx, ery = rot ? irx : iry; // ellipse axes in map space
  plinth(g, icx, icy, erx, ery, 0, HK.bank, false);
  plinth(g, icx, icy, erx - 3, ery - 3, Ht, HK.terrace, false);
  const tw = (y: number) => { const t = (y - iy) / (iry - 3); return Math.abs(t) >= 1 ? 0 : (irx - 3) * Math.sqrt(1 - t * t); };
  const armOff = (y: number) => { const t = (y - iy) / iry; return (Math.abs(t) < 1 ? irx * Math.sqrt(1 - t * t) : 0) + armW / 2 + 0.4; };
  for (const sg of [-1, 1]) {
    const pts: Pt[] = [];
    for (let y = iy - iry - 5; y <= iy + iry + 5; y += 1) pts.push(C(rx(y) + sg * armOff(y), y));
    channel(g, pts, armW, { med: MED.water, wl: () => WL, lock: true });
  }
  g.sources.push(C(rx(-6), 0)); g.outlets.push(C(rx(S1), S1));

  // ---- mode nodes ----
  const r0 = g.mode.contestR;
  const shrineSide = R.chance(0.5) ? 1 : -1;
  const cX = ix - shrineSide * 1.5, cY = iy;
  const [ccx, ccy] = C(cX, cY);
  g.contest = { x: ccx, y: ccy, h: Ht, r: r0 };
  g.nodes.contest = [ccx, ccy];
  // team A on the west rim, south; team B mirrored through the island (a half turn), on the east rim, north
  const ay = iy + fr('stageDy'), ax = Math.max(16, rx(ay) - fh(ay) - fr('stageDx'));
  const by = 2 * iy - ay + R.range(-2, 2), bx = Math.min(S1 - 16, rx(by) + Math.max(fh(by), 6) + fr('stageDx'));
  const stage: Record<'A' | 'B', Pt> = { A: C(ax, ay), B: C(bx, Math.max(14, by)) };
  g.nodes.stageA = stage.A; g.nodes.stageB = stage.B; g.nodes.spawnA = stage.A; g.nodes.spawnB = stage.B;
  g.nodes.exitA = stage.A; g.nodes.exitB = stage.B;

  // ---- approaches, one side at a time: sg = -1 west (A), +1 east (B); fy flips north/south for B ----
  const W = 5; // tread width: the largest essential body (elite, 2.84 m) plus turning margin on diagonals
  const sideOf = (team: 'A' | 'B') => {
    const sg = team === 'A' ? -1 : 1, fy = team === 'A' ? 1 : -1;
    const [sx, sy] = g.Q(stage[team][0], stage[team][1]);
    const edgeX = (y: number) => rx(y) + sg * fh(y); // the gorge wall's lip
    // direct: out of staging toward the gorge, along the rim lip, down a switchback cut into the wall, across the floor,
    // over a low bridge, onto a landing pad on the island and up a cut ramp onto the terrace
    const A1 = approach(g, team, 'direct', 'rim lip path, switchback, low bridge, cut ramp');
    const yb = iy + fy * iry * R.range(0.42, 0.56);
    const yS = yb + fy * R.range(8, 11);
    // both legs are cut into the wall: the first deep in the rim heading toward the crossing, the second nearer the lip
    // heading back, so the floor below stays free and the cut opens onto the floor beside the crossing
    const topX = edgeX(yS) + sg * 10;
    const sw = switchback([topX, yS], [0, -fy], [-sg, 0], Hr, 0, 7, 6.5, 0.45);
    const swMap: WP[] = sw.map((p) => wp(p.x, p.y, p.h));
    // rim routes follow the wall at a fixed offset (the gorge widens and narrows; a fixed x would wander onto the floor)
    const along = (y0: number, y1: number, off: number, h: number): WP[] => { const out: WP[] = []; const n = Math.max(1, Math.ceil(Math.abs(y1 - y0) / 5)); for (let i = 0; i <= n; i++) { const y = lerp(y0, y1, i / n); out.push(wp(Math.max(9, Math.min(S1 - 9, edgeX(y) + sg * off)), y, h)); } return out; };
    path(g, [wp(sx, sy, Hr), ...along(lerp(sy, yS, 0.3), yS + fy * 2, 10, Hr), { ...swMap[0] }], { w: W, approach: A1, keep: 1 });
    path(g, swMap, { w: W, approach: A1, keep: 1, grade: 0.5 });
    const armX = rx(yb) + sg * armOff(yb);
    const bw: Pt = [armX + sg * (armW / 2 + 3), yb], be: Pt = [armX - sg * (armW / 2 + 2.2), yb];
    const bot = sw[sw.length - 1];
    const out: Pt = [edgeX(bot.y) - sg * 2.5, bot.y];
    path(g, [{ ...swMap[swMap.length - 1] }, wp(out[0], out[1], 0), wp(lerp(out[0], bw[0], 0.5), lerp(out[1], bw[1], 0.5), 0), wp(bw[0], bw[1], 0)], { w: W, approach: A1, keep: 1 });
    bridge(g, C(bw[0], bw[1]), C(be[0] - sg * 0.5, be[1]), W, A1);
    // the landing pad: a floor-level apron on the island where the bridge lands, cut back into the terrace
    g.disc(...C(be[0], be[1]), 3.2, (k) => { if (g.kind[k] !== HK.fluid) { g.kind[k] = HK.route; g.H[k] = 0; g.keep[k] = 1; A1.tiles.push(k); } });
    const dx = cX - be[0], dy = cY - be[1], dl = Math.hypot(dx, dy) || 1;
    const rl = Ht / 0.45 + 0.5;
    const top: Pt = [be[0] + (dx / dl) * (rl + 1.5), be[1] + (dy / dl) * (rl + 1.5)];
    path(g, [wp(be[0] + (dx / dl) * 1.5, be[1] + (dy / dl) * 1.5, 0), wp(top[0], top[1], Ht)], { w: W, approach: A1, keep: 1, can: (k) => g.kind[k] !== HK.fluid });
    path(g, [wp(top[0], top[1], Ht), wp(cX, cY, Ht)], { w: W, approach: A1, keep: 1, can: (k) => g.kind[k] === HK.terrace || g.kind[k] === HK.route });

    // flank: out of staging away from the gorge into the rim forest, along a deep forest line past the far crossing,
    // back to the lip, down a bench ramp cut into the wall toward the crossing, along the bench and over a causeway at
    // terrace height onto the terrace (it arrives from the other end of the island)
    const A2 = approach(g, team, 'flank', 'rim forest path, bench ramp, causeway');
    const yn = iy - fy * iry * R.range(0.42, 0.56);
    const benchX = edgeX(yn) + sg * 3; // the bench ramp is cut into the rim
    const rampTop: Pt = [benchX, yn - fy * ((Hr - Hb) / 0.43 + 1.5)];
    const deep = Math.min(Math.abs(sx - edgeX(sy)) + 8, 22);
    path(g, [wp(sx, sy, Hr), ...along(sy - fy * 6, rampTop[1] - fy * 4, deep, Hr), wp(rampTop[0] + sg * 3, rampTop[1] - fy * 4, Hr), wp(rampTop[0], rampTop[1] - fy * 1, Hr), wp(rampTop[0], rampTop[1], Hr)], { w: W, approach: A2, keep: 1 });
    path(g, [wp(rampTop[0], rampTop[1], Hr), wp(benchX, yn - fy * 1.5, Hb), wp(benchX - sg * 4.5, yn, Hb)], { w: W, approach: A2, keep: 1 });
    bench(g, [C(benchX, yn - fy * 1.5), C(benchX - sg * 5, yn + fy * 1.5)], 5, Hb);
    const land: Pt = [ix + sg * (tw(yn) - 1.5), yn];
    causeway(g, C(benchX - sg * 4.5, yn), C(land[0], land[1]), W, Ht, A2);
    path(g, [wp(land[0], land[1], Ht), wp(cX, cY, Ht)], { w: W, approach: A2, keep: 1, can: (k) => g.kind[k] === HK.terrace || g.kind[k] === HK.route });
    keepLine(g, [C(benchX - sg * 4.5, yn), C(land[0], land[1])], 3);

    // the sightline break: an indestructible rock spur from the wall between this side's two crossings
    const ySp = iy + R.range(-2.5, 2.5);
    const spLen = Math.max(4, bankW - R.range(3, 4.5));
    const spTiles = spur(g, [C(edgeX(ySp) + sg * 4, ySp), C(edgeX(ySp) - sg * spLen, ySp + R.range(-1.5, 1.5))], R.range(2.8, 3.8), 2.4);
    for (const k of spTiles) g.lock[k] = 1;
    g.shape[`spur${team}`] = spTiles.length;
    return { yb, yn, yS };
  };
  const sa = sideOf('A'), sb = sideOf('B');
  g.shape.crossA = +sa.yb.toFixed(1); g.shape.crossB = +sb.yb.toFixed(1);

  // ---- bank trails along the downstream reach to the gorge mouth (the floor stays one space; enemies enter there) ----
  const bankSide = R.chance(0.5) ? 1 : -1;
  for (const sg of [bankSide, -bankSide]) {
    const y0 = iy + iry + 2, y1 = S1 - 5, pts: WP[] = [];
    for (let y = y0; y <= y1; y += 6) pts.push(wp(rx(y) + sg * Math.min(fh(y) - 3, armW / 2 + 3.5), y, 0));
    pts.push(wp(rx(y1) + sg * Math.min(fh(y1) - 3, armW / 2 + 3.5), y1, 0));
    path(g, pts, { w: 3, keep: 0, can: (k) => !g.lock[k] && g.kind[k] !== HK.fluid && Math.abs(g.H[k]) < 0.7 });
    if (sg === bankSide) g.anchors.push([pts[pts.length - 1].x, pts[pts.length - 1].y]);
  }

  // ---- optional secondary connections: a stepping-stone ford above the lip, a low bridge downstream ----
  // (an optional piece never cuts reserved route space: a few positions are tried, else it is left out)
  const clearOf = (a: Pt, b: Pt, w: number) => { let ok = true; const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) * 2); for (let i = 0; i <= n && ok; i++) g.disc(a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n, w / 2 + 1, (k) => { if (g.keep[k] && g.kind[k] !== HK.fluid) ok = false; }); return ok; };
  if (R.chance(g.recipe.optional.find((o) => o.id === 'lip-ford')?.chance ?? 0)) {
    for (let t = 0; t < 4; t++) {
      const yf = fallsY - R.range(5, 14);
      const a = C(rx(yf) - armW, yf), b = C(rx(yf) + armW, yf);
      if (!clearOf(a, b, 3)) continue;
      if (channelCrossing(g, a, b, 3, Hr)) { g.optional.push('lip-ford'); g.shape.lipFord = +yf.toFixed(1); }
      break;
    }
  }
  if (R.chance(g.recipe.optional.find((o) => o.id === 'south-bridge')?.chance ?? 0)) {
    for (let t = 0; t < 4; t++) {
      const yd = iy + iry + R.range(10, 24);
      const a = C(rx(yd) - armW - 1, yd), b = C(rx(yd) + armW + 1, yd);
      if (!clearOf(a, b, 4)) continue;
      // both ends must land on open floor
      const floorAt = (p: Pt) => { const k = g.idx(Math.floor(p[0]), Math.floor(p[1])); return g.kind[k] !== HK.fluid && !g.lock[k] && Math.abs(g.H[k]) < 0.5; };
      if (!floorAt(C(rx(yd) - armW - 2.5, yd)) || !floorAt(C(rx(yd) + armW + 2.5, yd))) continue;
      bridge(g, a, b, 4);
      g.optional.push('south-bridge'); g.shape.southBridge = +yd.toFixed(1);
      break;
    }
  }

  // ---- the shrine on the terrace beside the forecourt, ruins around it (structure family) ----
  const [shx, shy] = C(ix + shrineSide * (tw(iy) - 2.2), iy);
  g.landmark = { x: shx, y: shy, name: g.recipe.props.landmark };
  for (const sg of [-1, 1]) for (const f of [0.55, 0.85]) {
    // broken retaining-wall stubs on the terrace edge between entries (indestructible cover against the rims)
    const yy = iy + sg * (iry - 3) * f, xx = ix + (sg * shrineSide > 0 ? 1 : -1) * tw(yy) * 0.8;
    ruinWall(g, C(xx - 1, yy), C(xx + 1, yy), 1.3);
  }
  // lock the terrace and the island: they define the place
  for (let k = 0; k < g.S * g.S; k++) if (g.kind[k] === HK.terrace) g.lock[k] = 1;
  // the contest platform: the whole island (terrace, cut ramps, landing pads): the objective structure itself
  for (let y = Math.floor(icy - ery - 1); y <= icy + ery + 1; y++) for (let x = Math.floor(icx - erx - 1); x <= icx + erx + 1; x++) {
    if (!g.in(x, y) || ((x + 0.5 - icx) / erx) ** 2 + ((y + 0.5 - icy) / ery) ** 2 > 1) continue;
    const k = g.idx(x, y);
    if (g.kind[k] !== HK.fluid) g.platform[k] = 1;
  }

  // enemy entry anchors: the wild den, the gorge mouth downstream, the upper river banks, the far rim corners
  g.anchors.push(stage.B, C(rx(S1 - 8) + downW * 0.5, S1 - 8), C(rx(8) - armW - 4, 8), C(rx(8) + armW + 4, 8), C(12, 20), C(S1 - 12, S1 - 20));
  g.m.bossSpot = [Math.floor(ccx), Math.floor(ccy)];
  border(g, 4, (k) => g.H[k]);
}

/** a dry stepping-stone crossing over a channel at height h: the fluid passes through (culvert) */
function channelCrossing(g: HabCtx, a: Pt, b: Pt, w: number, h: number): number[] | null {
  const tiles: number[] = [];
  const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) * 2);
  const seen = new Set<number>();
  for (let s = 0; s <= n; s++) g.disc(a[0] + ((b[0] - a[0]) * s) / n, a[1] + ((b[1] - a[1]) * s) / n, w / 2, (k) => { if (!seen.has(k)) { seen.add(k); tiles.push(k); } });
  if (!tiles.some((k) => g.kind[k] === HK.fluid)) return null;
  for (const k of tiles) {
    if (g.kind[k] === HK.fluid) { g.culvert[k] = 1; g.kind[k] = HK.route; g.H[k] = h; }
    else if (!g.lock[k]) { g.kind[k] = HK.route; g.H[k] = h; }
    g.keep[k] = 1;
  }
  g.joins.push({ family: 'structure', what: 'ford', ends: [tiles[0], tiles[tiles.length - 1]], h, clearance: 0, medium: 'water' });
  return tiles;
}

// =================================================================================================================
// crater
// =================================================================================================================

export function crater(g: HabCtx) {
  const R = g.rng('landform'), F = g.recipe.freedoms, L = g.recipe.levels;
  const fr = (key: string) => R.range(F[key][0], F[key][1]);
  g.rot = R.int(0, 3); g.mir = R.chance(0.5);
  const S1 = g.S - 1;
  const C = (x: number, y: number): Pt => g.P(x / S1, y / S1);
  const wp = (x: number, y: number, h: number): WP => { const [mx, my] = C(x, y); return { x: mx, y: my, h }; };
  const Hf = L.floor, Hc = L.crest, Hm = L.mass, Hk = L.chamber;
  const cx0 = S1 / 2 + R.range(-2, 2), cy0 = fr('craterY');
  const Rf = fr('craterR'), crestW = fr('crestW'), flankW = fr('flankW');
  const Rc = Rf + crestW, Ro = Rc + flankW;
  const breachA = Math.PI / 2 + R.range(-0.22, 0.22), breachW = fr('breachW');
  const wob = R.int(1, 1e6);
  g.shape.craterR = +Rf.toFixed(1); g.shape.breach = +breachA.toFixed(2);
  const polar = (a: number, r: number): [number, number] => [cx0 + dcos(a) * r, cy0 + dsin(a) * r];
  const angDiff = (a: number, b: number) => { let d = (a - b) % 6.2832; if (d > 3.1416) d -= 6.2832; if (d < -3.1416) d += 6.2832; return Math.abs(d); };

  // ---- relief: foot plain, flank mass, rim crest, crater floor; the breach cuts crest and flank to floor level ----
  g.used.add('cliff'); g.used.add('relief');
  for (let y = 0; y < g.S; y++) for (let x = 0; x < g.S; x++) {
    const [cx, cy] = g.Q(x + 0.5, y + 0.5);
    const k = g.idx(x, y);
    const a = Math.atan2(cy - cy0, cx - cx0), r = Math.hypot(cx - cx0, cy - cy0);
    const n = (fbm(cx / 8, cy / 8, wob, 2) - 0.5) * 3;
    const inBreach = angDiff(a, breachA) < breachW / 2 / Math.max(6, r);
    if (r < Rf + n * 0.6) { g.H[k] = Hf; g.kind[k] = HK.floor; }
    else if (inBreach && r < Ro + 4) { g.H[k] = Hf; g.kind[k] = HK.floor; }
    else if (r < Rc + n * 0.5) { g.H[k] = Hc; g.kind[k] = HK.shelf; }
    else if (r < Ro + n) { g.H[k] = Hm + Math.round(fbm(cx / 5, cy / 5, wob + 1, 2) * 3) * 0.6; g.kind[k] = HK.mass; }
    else { g.H[k] = 0; g.kind[k] = HK.floor; }
  }
  // the breach's floor runs out past the flank and steps down to the foot by a ramp (the grounded return path)
  const [bOutX, bOutY] = polar(breachA, Ro + 3), [bFootX, bFootY] = polar(breachA, Ro + 3 + Hf / 0.45 + 1);
  const ret = path(g, [wp(...polar(breachA, Rf - 2), Hf), wp(bOutX, bOutY, Hf), wp(bFootX, bFootY, 0)], { w: 6, keep: 1 });
  g.notes.push(`return path ${ret.length} tiles`);

  // ---- the lava lake: bounded by a cooled shelf, on the far side from the breach (kernel 4, lava medium) ----
  const lavaA = breachA + Math.PI + R.range(-0.25, 0.25), lavaD = Rf * fr('lavaD');
  const [lx, ly] = polar(lavaA, lavaD), lr = fr('lavaR');
  const [mlx, mly] = C(lx, ly);
  g.disc(mlx, mly, lr + 2.2, (k) => { if (g.kind[k] === HK.floor) { g.kind[k] = HK.shelf; g.H[k] = Hf; g.lock[k] = 1; } });
  basin(g, mlx, mly, lr, lr * 0.85, { med: MED.lava, wl: Hf - 0.3, lock: true, wobble: 0.35 });
  g.sinks.push([mlx, mly]);

  // ---- contest: the cooled forecourt between the lava and the breach, ringed by ruins ----
  const r0 = g.mode.contestR;
  const cD = fr('contestD');
  const [qcx, qcy] = polar(breachA, Rf * cD);
  const [ccx, ccy] = C(qcx, qcy);
  g.contest = { x: ccx, y: ccy, h: Hf, r: r0 };
  g.nodes.contest = [ccx, ccy];
  g.disc(ccx, ccy, r0 + 4, (k) => { g.platform[k] = 1; });
  { const ux = lx - qcx, uy = ly - qcy, ul = Math.hypot(ux, uy) || 1; const [ax, ay] = C(qcx + (ux / ul) * (r0 + 1), qcy + (uy / ul) * (r0 + 1)); g.landmark = { x: ax, y: ay, name: g.recipe.props.landmark }; }

  // a final segment to the forecourt that would cross the lava lake or its shelf bends around it (canonical coords)
  const aroundLava = (a: [number, number], b: [number, number]): [number, number][] => {
    const vx = b[0] - a[0], vy = b[1] - a[1], L2 = vx * vx + vy * vy || 1;
    const t = Math.max(0, Math.min(1, ((lx - a[0]) * vx + (ly - a[1]) * vy) / L2));
    const px = a[0] + vx * t, py = a[1] + vy * t, d = Math.hypot(px - lx, py - ly), clear = lr + 2.2 + 4;
    if (d >= clear) return [];
    const ux = d > 0.01 ? (px - lx) / d : -vy / Math.sqrt(L2), uy = d > 0.01 ? (py - ly) / d : vx / Math.sqrt(L2);
    return [[lx + ux * clear, ly + uy * clear]];
  };

  // ---- teams on the foot, west (A) and east (B), mirrored across the crater's axis ----
  const stageAng: Record<'A' | 'B', number> = { A: Math.PI + R.range(-0.18, 0.12), B: 0 };
  stageAng.B = Math.PI - stageAng.A;
  const stageR = Ro + fr('stageD');
  const stage: Record<'A' | 'B', Pt> = { A: C(...polar(stageAng.A, stageR)), B: C(...polar(stageAng.B, stageR)) };
  for (const t of ['A', 'B'] as const) { g.nodes['stage' + t] = stage[t]; g.nodes['spawn' + t] = stage[t]; g.nodes['exit' + t] = stage[t]; }

  const W = 5; // tread width: the largest essential body (elite, 2.84 m) plus turning margin on diagonals
  const swSector = fr('switchA'), caveSector = fr('caveA'), branchOn = R.chance(g.recipe.optional.find((o) => o.id === 'vent-branch')?.chance ?? 0);
  const legLen = fr('legLen');
  const side = (team: 'A' | 'B') => {
    const sg = team === 'A' ? 1 : -1; // mirror: angles measured from the team's own side
    const base = stageAng[team];
    const ang = (d: number) => base - sg * d; // + d turns toward the breach for A (south), mirrored for B
    const [sx, sy] = g.Q(stage[team][0], stage[team][1]);

    // direct: a switchback cut up the flank from the foot to a notch in the crest at crater-floor level
    const A1 = approach(g, team, 'direct', 'grounded switchback, crest notch');
    const aS = ang(swSector);
    const foot = polar(aS, Ro + 2.5), notchIn = polar(aS, Rf - 2.5);
    // legs along the flank (tangential), stepping inward
    const tx = -dsin(aS), ty = dcos(aS), nx = -dcos(aS), ny = -dsin(aS);
    const legs = 2, fall = Hf / legs; // two long gentle legs and one hairpin (short legs pinch at the turns)
    const wps: WP[] = [wp(sx, sy, 0), wp(foot[0], foot[1], 0)];
    // the first leg climbs away from staging (back toward it would run over the path that brought us here)
    let px = foot[0], py = foot[1], h = 0, dirS = tx * (sx - foot[0]) + ty * (sy - foot[1]) > 0 ? -1 : 1;
    for (let l = 0; l < legs; l++) {
      const len = legLen;
      px += tx * dirS * len; py += ty * dirS * len; h += fall;
      wps.push(wp(px, py, h));
      if (l < legs - 1) { px += nx * 6; py += ny * 6; wps.push(wp(px, py, h)); dirS = -dirS; }
    }
    const [ex, ey] = polar(aS, Rc + 1);
    wps.push(wp(px + (ex - px) * 0.5, py + (ey - py) * 0.5, Hf), wp(...polar(aS, Rc - 1), Hf), wp(notchIn[0], notchIn[1], Hf));
    path(g, wps, { w: W, approach: A1, keep: 1, can: (k) => !g.lock[k] && g.kind[k] !== HK.fluid });
    path(g, [wp(notchIn[0], notchIn[1], Hf), ...aroundLava(notchIn, [qcx, qcy]).map(([x, y]) => wp(x, y, Hf)), wp(qcx, qcy, Hf)], { w: W, approach: A1, keep: 1, can: (k) => g.kind[k] !== HK.fluid && !(g.lock[k] && g.kind[k] === HK.shelf) });

    // a crest ramp between the notch and the cave: the high ground's baseline counter-route from the crater floor (crest
    // segments nobody can climb back onto are sealed as rock by the pocket repair)
    {
      // one straight ramp cut into the crest's inner face (a bend would compress the upper leg into a step)
      const aR = base + sg * ((caveSector - swSector) / 2) * 0.5;
      path(g, [wp(...polar(aR, Rf - 6.5), Hf), wp(...polar(aR, Rf + crestW * 0.55), Hc)], { w: W, keep: 1, can: (k) => !g.lock[k] && (g.kind[k] === HK.floor || g.kind[k] === HK.shelf) });
    }

    // flank: a dry cave. Mouth on the foot, tunnel through the flank to a chamber, tunnel under the crest into the crater
    const A2 = approach(g, team, 'flank', 'dry cave: mouth, tunnel, chamber, arch under the crest');
    const aC = ang(-caveSector);
    const mouth = polar(aC, Ro + 5), chamberAt = polar(aC + sg * R.range(-0.08, 0.08), Rc + flankW * 0.5);
    const exitAt = polar(aC - sg * 0.12, Rf - 1.5);
    const cr = fr('chamberR');
    const [chx, chy] = C(chamberAt[0], chamberAt[1]);
    const chR = Math.hypot(chamberAt[0] - cx0, chamberAt[1] - cy0);
    // the chamber first; each tunnel reaches the chamber's floor height at the chamber's edge
    chamber(g, chx, chy, cr, Hk);
    const outEdge = polar(aC, chR + cr - 0.5), inEdge = polar(aC - sg * 0.04, chR - cr + 0.5);
    path(g, [wp(sx, sy, 0), wp(lerp(sx, mouth[0], 0.5), lerp(sy, mouth[1], 0.5), 0), wp(mouth[0], mouth[1], 0)], { w: W, approach: A2, keep: 1 });
    tunnel(g, [wp(mouth[0], mouth[1], 0), wp(outEdge[0], outEdge[1], Hk), wp(chamberAt[0], chamberAt[1], Hk)], W, A2);
    const t2 = tunnel(g, [wp(chamberAt[0], chamberAt[1], Hk), wp(inEdge[0], inEdge[1], Hk), wp(exitAt[0], exitAt[1], Hf)], W, A2);
    // the crest continues over the tunnel as an arch (a deck at crest height above the tunnel floor)
    arch(g, t2.filter((k) => { const [cx, cy] = g.Q((k % g.S) + 0.5, ((k / g.S) | 0) + 0.5); const r = Math.hypot(cx - cx0, cy - cy0); return r >= Rf + 0.8 && r <= Rc + 0.3 && g.H[k] <= Hc - 2.9; }), Hc);
    path(g, [wp(exitAt[0], exitAt[1], Hf), ...aroundLava(exitAt, [qcx, qcy]).map(([x, y]) => wp(x, y, Hf)), wp(qcx, qcy, Hf)], { w: W, approach: A2, keep: 1, can: (k) => g.kind[k] !== HK.fluid && !(g.lock[k] && g.kind[k] === HK.shelf) });
    g.shape[`chamber${team}`] = +(Math.hypot(chamberAt[0] - cx0, chamberAt[1] - cy0)).toFixed(1);

    // optional hazard branch: from the chamber a side tunnel climbs into a vent field on the crater floor
    if (branchOn) {
      // toward the lava from the cave's mouth, but never within the lake's cooled shelf
      let aV = aC + sg * R.range(0.4, 0.5), ventAt = polar(aV, Rf - 4.5);
      // and clear of the main cave's exit path to the forecourt (a hazard is never on an essential route)
      const segD = (p: [number, number], a: [number, number], b: [number, number]) => { const vx = b[0] - a[0], vy = b[1] - a[1], t = Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / (vx * vx + vy * vy || 1))); return Math.hypot(p[0] - a[0] - vx * t, p[1] - a[1] - vy * t); };
      for (let t = 0; t < 14 && (Math.hypot(ventAt[0] - lx, ventAt[1] - ly) < lr + 7 || segD(ventAt, exitAt, [qcx, qcy]) < 8.5); t++) {
        aV += sg * (Math.hypot(ventAt[0] - lx, ventAt[1] - ly) < lr + 7 ? -0.05 : 0.05); ventAt = polar(aV, Rf - (t > 6 ? 3.5 : 4.5));
      }
      // the branch leaves the chamber on its far side and crosses under the crest at its own angle, well clear of the
      // main cave tunnel (two tunnels side by side would leave a one-tile rib and pinch both)
      const bEdge = polar(aC + sg * 0.22, chR - cr + 0.5);
      const t3 = tunnel(g, [wp(chamberAt[0], chamberAt[1], Hk), wp(bEdge[0], bEdge[1], Hk), wp(...polar(aV, Rc + 0.5), Hf - 0.5), wp(...polar(aV, Rf - 1), Hf), wp(ventAt[0], ventAt[1], Hf)], 3);
      arch(g, t3.filter((k) => { const [cx, cy] = g.Q((k % g.S) + 0.5, ((k / g.S) | 0) + 0.5); const r = Math.hypot(cx - cx0, cy - cy0); return r >= Rf + 0.8 && r <= Rc + 0.3 && g.H[k] <= Hc - 2.9; }), Hc);
      const [vx, vy] = C(ventAt[0], ventAt[1]);
      g.disc(vx, vy, 3.6, (k) => { if (!g.keep[k] && (g.kind[k] === HK.floor || g.kind[k] === HK.route || g.kind[k] === HK.tunnel)) g.hazard[k] = 1; });
      g.optional.push(`vent-branch-${team}`);
    }
  };
  side('A'); side('B');

  // the altar beside the forecourt: at the angle farthest from every tread, leaning toward the lava
  {
    const toLava = Math.atan2(mly - ccy, mlx - ccx);
    let best = -Infinity, bx = ccx, by = ccy;
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * 6.2832, r = r0 + 2;
      const x = ccx + Math.cos(a) * r, y = ccy + Math.sin(a) * r;
      let d = 9;
      g.disc(x, y, 9, (k, dd) => { const t = g.kind[k]; if ((t === HK.route || t === HK.ramp || t === HK.tunnel) && dd < d) d = dd; });
      const score = d - 0.8 * Math.abs(Math.atan2(Math.sin(a - toLava), Math.cos(a - toLava)));
      if (score > best) { best = score; bx = x; by = y; }
    }
    g.landmark = { x: bx, y: by, name: g.recipe.props.landmark };
  }

  // ---- ruins around the contest: a broken ring of indestructible wall stubs (cover against the rim), the altar ----
  const ruinR = r0 + R.range(2.2, 3.2), pieces = R.int(5, 7), a0 = R.range(0, 6.28);
  for (let i = 0; i < pieces; i++) {
    const a = a0 + (i / pieces) * 6.283;
    const p = (r: number, d: number): Pt => [ccx + dcos(a + d) * r, ccy + dsin(a + d) * r];
    ruinWall(g, p(ruinR, -0.12), p(ruinR, 0.12), 1.4);
  }
  // cooled-rock blocks (spurs) toward the lava: the decisive break between the far crest and the forecourt
  const [lmx2, lmy2] = [mlx + (ccx - mlx) * 0.55, mly + (ccy - mly) * 0.55];
  const px = -(ccy - mly), py = ccx - mlx, pl = Math.hypot(px, py) || 1;
  for (const s of [-1, 1]) {
    const off = s * R.range(4, 6.5);
    const tiles = spur(g, [[lmx2 + (px / pl) * off, lmy2 + (py / pl) * off], [lmx2 + (px / pl) * (off + s * 2.5), lmy2 + (py / pl) * (off + s * 2.5)]], 2.4, 1.8, (k) => !g.lock[k] && !g.keep[k] && g.kind[k] !== HK.fluid && !treadNear(g, k, 3));
    for (const k of tiles) g.lock[k] = 1;
  }

  g.anchors.push(stage.B, C(...polar(breachA, Ro + 12)), C(...polar(lavaA, Ro + 3)), C(...polar(breachA + 1.2, Ro + 6)), C(...polar(breachA - 1.2, Ro + 6)));
  g.m.bossSpot = [Math.floor(ccx), Math.floor(ccy)];
  border(g, 4, () => Hm + 1.2);
}

/** is any tread (route, ramp or tunnel tile) within d tiles of k? */
function treadNear(g: HabCtx, k: number, d: number): boolean {
  const x = k % g.S, y = (k / g.S) | 0;
  for (let dy = -d; dy <= d; dy++) for (let dx = -d; dx <= d; dx++) {
    if (!g.in(x + dx, y + dy)) continue;
    const t = g.kind[g.idx(x + dx, y + dy)];
    if (t === HK.route || t === HK.ramp || t === HK.tunnel) return true;
  }
  return false;
}

export const LANDFORMS: Record<string, (g: HabCtx) => void> = { gorge, crater };
