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
//   ridge   a walled burial precinct on a dry ridge in woodland: a lower terrace with a forecourt, two raised terraces on its
//           contour, plot groups of grave markers along the contour, a broken perimeter wall and a broken wall round the
//           forecourt. Each side has a path along the lower wall and another along the upper contour (half-turn symmetric,
//           the two sides' numbers drawn apart).
//   crater  a breached crater: a walkable rim crest above a crater floor with a bounded lava lake, an outer flank of
//           solid rock, a foot plain around it. Teams start on the foot at opposite sides; each has a grounded
//           switchback cut up the flank to a notch in the crest, and a dry cave (mouth → tunnel → chamber → tunnel)
//           whose last reach runs under the rim crest (an arch) into the crater. An optional cave branch ends in a
//           vent field (the hazard); the breach is the grounded return path.
import { dcos, dsin } from '../../core/detmath';
import { fbm } from '../../core/rng';
import { HK, MED, type Approach, type HabCtx } from './ctx';
import { arch, basin, bench, bridge, brokenWall, causeway, chamber, channel, keepLine, path, plinth, ruinWall, spur, switchback, tunnel, type Pt, type WP } from './families';
import { dropPlot, placeMark, planPlot, retype, type GravePlot } from './graves';
import { sanctuary } from './sanctuary';
import { lagoon } from './lagoon';

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

// =================================================================================================================
// shoal
// =================================================================================================================
//
// A sea cave in a coastal massif, on two connected elevations. The sea inlet (the coastal mouth) runs in from the map
// edge to a lower chamber; a hall on the lower floor runs from each side's staging, down a ramp, through the chamber;
// an up-ramp climbs from the chamber to the contest on the upper floor. The water is tidal (families.ts tidal: the hall,
// the chamber and the low end of every ramp are dry at low water and open water at high water), so the hall is the
// optional low-water shortcut. Each side's two required approaches stay on the upper floor, above maximum tide: a stable
// gallery along the hall's far wall that crosses the hall on a causeway (a deck the hall passes under), and a sheltered
// tunnel through the massif that arrives at the point from the other side. Exit ramps out of the hall onto the gallery
// keep every flooded tile within a short swim of dry ground.

export function shoal(g: HabCtx) {
  const R = g.rng('landform'), F = g.recipe.freedoms, L = g.recipe.levels;
  const fr = (key: string) => R.range(F[key][0], F[key][1]);
  g.rot = R.int(0, 3); g.mir = R.chance(0.5);
  const S1 = g.S - 1;
  const C = (x: number, y: number): Pt => g.P(x / S1, y / S1);
  const wp = (x: number, y: number, h: number): WP => { const [mx, my] = C(x, y); return { x: mx, y: my, h }; };
  const Hu = L.upper, Hl = L.lower, Hm = L.mass, lo = L.low;
  const wob = R.int(1, 1e6);

  // ---- relief: the massif is rock everywhere; every space below is carved out of it (cliff + chamber families) ----
  g.used.add('cliff'); g.used.add('relief');
  for (let y = 0; y < g.S; y++) for (let x = 0; x < g.S; x++) {
    const [cx, cy] = g.Q(x + 0.5, y + 0.5), k = g.idx(x, y);
    g.H[k] = Hm + Math.round(fbm(cx / 5, cy / 5, wob, 2) * 3) * 0.6; g.kind[k] = HK.mass;
  }

  // ---- the plan (canonical: team A west, B east; B's numbers are drawn apart, so the two sides are not mirror images) ----
  const hy = fr('hallY'), hallW = fr('hallW'), cx = S1 / 2 + R.range(-1.5, 1.5), dy = fr('contestDy'), cy = hy - dy;
  const r0 = g.mode.contestR, chR = fr('chamberR'), chY = hy - 1;
  const plat = r0 + 2.5;
  g.shape.hall = +hy.toFixed(1); g.shape.contestDy = +dy.toFixed(1); g.shape.chamber = +chR.toFixed(1);
  const W = 5; // tread width: the largest essential body (elite, 2.84 m) plus turning margin on diagonals
  const rampL = (Hu - Hl) / 0.42;
  type Side = { team: 'A' | 'B'; X: (x: number) => number; sx: number; sy: number; bottom: number; gx: number; gy: number; rise: number; exitBack: number };
  const sideOf = (team: 'A' | 'B'): Side => {
    const X = (x: number) => (team === 'A' ? x : S1 - x);
    const sx = fr('stageX'), sy = hy - fr('stageDy');
    return { team, X, sx, sy, bottom: sx + 5 + rampL, gx: fr('crossX'), gy: hy + hallW / 2 + fr('galleryOff'), rise: fr('tunnelRise'), exitBack: R.range(7, 8) };
  };
  const sides = [sideOf('A'), sideOf('B')];

  // ---- the coastal mouth: the sea inlet from the map edge into the chamber (channel family; the tide's fluid) ----
  const inletW = fr('inletW'), bend = R.range(-3, 3);
  // (it ends against the border rock: the open sea lies beyond the map)
  channel(g, [C(cx, hy + 2.6), C(cx + bend * 0.4, hy + chR + 4), C(cx + bend, S1 - 10), C(cx + bend, S1 - 8)], inletW, { med: MED.water, wl: () => lo, depth: 0.8, lock: true });
  g.outlets.push(C(cx + bend, S1 - 7));
  g.sources.push(C(cx + bend, S1 - 7));

  // ---- lower floor: the chamber, the hall through it to both sides, the up-ramp to the contest ----
  const chamberTiles = chamber(g, ...C(cx, chY), chR, Hl);
  const [A, B] = sides;
  const xa = A.X(A.bottom), xb = B.X(B.bottom);
  const hall = path(g, [wp(xa, hy, Hl), wp(cx, hy, Hl), wp(xb, hy, Hl)], { w: hallW, keep: 0 });
  g.notes.push(`hall ${hall.length} tiles, chamber ${chamberTiles.length}`);
  // (it climbs from the chamber's middle, so its waterline at high water is close to the pool)
  path(g, [wp(cx, chY + 0.5, Hl), wp(cx, cy + plat - 0.5, Hu)], { w: W, keep: 0 });

  // ---- the contest platform on the upper floor, and each side's staging clearing ----
  g.disc(...C(cx, cy), plat, (k) => { g.kind[k] = HK.floor; g.H[k] = Hu; });
  const [ccx, ccy] = C(cx, cy);
  g.contest = { x: ccx, y: ccy, h: Hu, r: r0 };
  g.nodes.contest = [ccx, ccy];
  g.disc(ccx, ccy, r0 + 4, (k) => { g.platform[k] = 1; });
  for (const s of sides) {
    const st = C(s.X(s.sx), s.sy);
    g.disc(st[0], st[1], 6, (k) => { if (g.kind[k] !== HK.fluid) { g.kind[k] = HK.floor; g.H[k] = Hu; } });
    for (const id of ['stage', 'spawn', 'exit']) g.nodes[id + s.team] = st;
  }

  for (const s of sides) {
    const X = s.X, tw = (x: number, y: number, h: number) => wp(X(x), y, h);
    // a point placed from the contest (which is not exactly on the map's axis): dx tiles toward this side
    const near = (dx: number, y: number, h: number) => wp(cx + (s.team === 'A' ? -dx : dx), y, h);
    // the shortcut's way down: out of staging onto a ramp into the hall's end (its low end floods at high water)
    path(g, [tw(s.sx, s.sy, Hu), tw(s.sx + 5, hy, Hu), tw(s.bottom + 0.5, hy, Hl)], { w: W, keep: 0 });

    // direct: the stable gallery. Out of staging round the hall's end, along the hall's far wall above maximum tide, over
    // the hall on a causeway (a deck the hall passes under) and up to the point
    const A1 = approach(g, s.team, 'direct', 'stable gallery above the tide, causeway over the hall');
    const gal: WP[] = [tw(s.sx, s.sy, Hu), tw(s.sx - 2.5, s.gy - 4, Hu), tw(s.sx + 4, s.gy, Hu), tw(s.gx, s.gy, Hu)];
    // the gallery itself is a broad ledge on its outer side, away from the hall (that floor carries cover and stands; the
    // hall side stays rock, so a ramp out of the hall is a cut with rock walls, never a slope beside open floor)
    path(g, [tw(s.sx + 4, s.gy + 2.5, Hu), tw(s.gx - 1, s.gy + 2.5, Hu)], { w: 6, kind: HK.floor, can: (k) => !g.lock[k] && g.kind[k] === HK.mass });
    const edgeS = hy + hallW / 2 + 0.6, edgeN = hy - hallW / 2 - 0.6;
    path(g, [...gal, tw(s.gx, edgeS, Hu)], { w: W, approach: A1, keep: 1, can: (k) => !g.lock[k] && g.kind[k] !== HK.fluid && !(g.kind[k] === HK.route && g.H[k] < Hu - 0.5) });
    // the far landing is cut before the deck is laid, so the deck's ends rest on it
    path(g, [tw(s.gx, edgeN, Hu), tw(s.gx + 4, edgeN - 3.5, Hu), near(plat - 0.5, cy + 2, Hu), wp(cx, cy, Hu)], { w: W, approach: A1, keep: 1, can: (k) => !g.lock[k] && g.kind[k] !== HK.fluid && !(g.H[k] < Hu - 0.5 && (g.kind[k] === HK.route || g.kind[k] === HK.ramp || g.kind[k] === HK.tunnel)) });
    causeway(g, C(X(s.gx), edgeS + 0.6), C(X(s.gx), edgeN - 0.6), W, Hu, A1);

    // flank: a sheltered tunnel through the massif, arcing away from the hall and arriving at the point from its far side
    const A2 = approach(g, s.team, 'flank', 'sheltered tunnel through the massif');
    const ty = cy - s.rise;
    tunnel(g, [tw(s.sx, s.sy, Hu), tw(s.sx + 1, s.sy - 12, Hu), tw(s.sx + 9, ty + 4, Hu), near(19, ty, Hu), near(9, ty + 2.5, Hu), near(3, cy - plat + 0.5, Hu), wp(cx, cy, Hu)], W, A2);
    keepLine(g, A2.pts.slice(-3), 3);

    // exits out of the hall onto the gallery: a ramp up the far wall to the gallery ledge and one up the near wall to the
    // gallery's landing (the tide's ways out: nobody caught in the hall is far from dry ground)
    // (an exit only cuts rock or the hall: it may meet an approach's tread, never re-grade it)
    const cut = (k: number) => !g.lock[k] && (g.kind[k] === HK.mass || (g.H[k] < Hu - 0.5 && (g.kind[k] === HK.route || g.kind[k] === HK.ramp)));
    // the far-wall exit sits just short of the crossing (never under it), climbing back along the wall to the gallery's
    // tread; the near-wall exit is just past the crossing, between it and the chamber
    const xS = s.gx - s.exitBack, xN = s.gx + R.range(6.5, 8);
    path(g, [tw(xS, hy + hallW / 2 - 1.5, Hl), tw(xS - 6.5, s.gy - W / 2, Hu)], { w: W, keep: 0, can: cut });
    // the near-wall exit climbs onto the gallery's landing leg, at a point on that leg
    const l0 = tw(s.gx + 4, edgeN - 3.5, Hu), l1 = near(plat - 0.5, cy + 2, Hu), on = { x: lerp(l0.x, l1.x, 0.35), y: lerp(l0.y, l1.y, 0.35), h: Hu };
    path(g, [tw(xN, hy - 0.5, Hl), on], { w: W, keep: 0, can: cut });

    // the coastal mouth's shore: a beach from the sea inlet's bank up to the gallery's end. At every tide the waterline
    // lies on it, so anything in the inlet has a bank to climb out onto (its low end floods at high water)
    {
      // one beach near the inlet's sea end, the other just below the chamber, so neither end of the inlet is far from one
      const yb = s.team === 'A' ? S1 - R.range(9, 10) : hy + R.range(4.5, 6), toward = s.team === 'A' ? -1 : 1;
      let xe = cx + bend;
      for (let i = 0; i < 24; i++) { const [mx, my] = C(xe, yb), k = g.idx(Math.floor(mx), Math.floor(my)); if (g.in(Math.floor(mx), Math.floor(my)) && g.kind[k] !== HK.fluid) break; xe += toward * 0.5; }
      // a steep toe at the water (the waterline is never far up the beach), then the long slope to the gallery
      const toe = wp(xe + toward * 3.6, yb + (s.team === 'A' ? -0.8 : 0.8), L.high + 0.35);
      const beach = path(g, [wp(xe + toward * 0.6, yb, lo + 0.2), toe, tw(s.gx + 6, s.gy + 1.5, Hu), tw(s.gx + 1, s.gy, Hu)], { w: W, keep: 0, can: (k) => !g.lock[k] && g.kind[k] === HK.mass });
      g.shape[`beach${s.team}`] = beach.length;
      // and a far-wall exit just past the crossing climbs onto the beach's upper slope
      path(g, [tw(s.gx + 5, hy + hallW / 2 - 1.5, Hl), tw(s.gx + 9.5, s.gy + 0.5, Hu)], { w: W, keep: 0, can: cut });
    }

    // a rock spur on the gallery's outer margin: indestructible cover along the ledge (boulder family)
    const sp = spur(g, [C(X(lerp(s.sx + 4, s.gx, 0.55)), s.gy + 3.6), C(X(lerp(s.sx + 4, s.gx, 0.55) + 2.5), s.gy + 3.4)], 1.6, 1.6, (k) => !g.lock[k] && !g.keep[k] && g.kind[k] === HK.floor);
    g.shape[`spur${s.team}`] = sp.length;
    g.shape[`cross${s.team}`] = +s.gx.toFixed(1); g.shape[`rise${s.team}`] = +s.rise.toFixed(1);
  }

  // ---- the landmark beside the point, at the angle farthest from every tread; ruin stubs as cover on the platform ----
  {
    let best = -Infinity, bx = ccx, by = ccy;
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * 6.2832, x = ccx + dcos(a) * (r0 + 1.5), y = ccy + dsin(a) * (r0 + 1.5);
      let d = 9;
      g.disc(x, y, 9, (k, dd) => { const t = g.kind[k]; if ((t === HK.route || t === HK.ramp || t === HK.tunnel) && dd < d) d = dd; });
      if (d > best) { best = d; bx = x; by = y; }
    }
    g.landmark = { x: bx, y: by, name: g.recipe.props.landmark };
  }
  const pieces = R.int(4, 6), a0 = R.range(0, 6.28);
  for (let i = 0; i < pieces; i++) {
    const a = a0 + (i / pieces) * 6.283, rr = r0 + 1.6;
    ruinWall(g, [ccx + dcos(a - 0.13) * rr, ccy + dsin(a - 0.13) * rr], [ccx + dcos(a + 0.13) * rr, ccy + dsin(a + 0.13) * rr], 1.3);
  }
  for (const k of chamberTiles) g.lock[k] = 1;

  g.anchors.push(g.nodes.stageB, C(cx, chY), C(xa, hy), C(xb, hy), C(cx, cy - 14));
  g.m.bossSpot = [Math.floor(ccx), Math.floor(ccy)];
  border(g, 4, () => Hm + 1.2);
}

// =================================================================================================================
// ridge
// =================================================================================================================
//
// Canonical frame, team A west. An "A-local" point (ax, ay) is ax tiles west of the centre and ay tiles south of it; team B's
// is the half turn of that, so the plan is point-symmetric and every side draws its own numbers (B is not A's mirror image).
// Levels: the woodland floor 0, the lower terrace `lower`, two raised terraces `upper`, 0.9 m above it (a standable node on
// one is never 1.5 m above a route on the other, so no terrace is a perch).
//
//   lower path  woodland → a ramp cut across the lower terrace's rim → along the lower wall → forecourt gate (from the west-south-west)
//   upper path  woodland → a ramp cut onto a raised terrace's far end → along its north contour behind the plot group → ramp down →
//               forecourt gate (from the north-west, about 90 degrees from the lower path's gate: gates further apart than that
//               leave a chord through both openings, and gates closer than 60 degrees are no longer two ways in)
//   plots       2-3 staggered groups of markers: one on each raised terrace, a third on the lower terrace's end; neighbouring
//               plots shear opposite ways (graves.ts)
//   walls       a broken perimeter wall round the lower terrace's rim (a gap where each route crosses it, seeded openings), a
//               broken wall round the forecourt (a gap at each gate), the memorial beside the point

export function ridge(g: HabCtx) {
  const R = g.rng('landform'), F = g.recipe.freedoms, L = g.recipe.levels;
  const fr = (key: string) => R.range(F[key][0], F[key][1]);
  const fi = (key: string) => Math.floor(fr(key));
  g.rot = R.int(0, 3); g.mir = R.chance(0.5);
  const S1 = g.S - 1;
  const C = (x: number, y: number): Pt => g.P(x / S1, y / S1);
  const wp = (x: number, y: number, h: number): WP => { const [mx, my] = C(x, y); return { x: mx, y: my, h }; };
  const Hl = L.lower, Hu = L.upper, wallRise = L.wall;
  const wob = R.int(1, 1e6);
  const cx = S1 / 2 + R.range(-2, 2), cy = fr('ridgeY');
  const La = fr('ridgeA'), Lb = fr('ridgeB'), Ua = fr('terraceA'), Ub = fr('terraceB');
  const r0 = g.mode.contestR, platR = r0 + 4; // the contest radius and the contest platform's
  g.shape.ridgeA = +La.toFixed(1); g.shape.ridgeB = +Lb.toFixed(1);
  const sgOf = (t: 'A' | 'B') => (t === 'A' ? -1 : 1);
  /** an A-local point as a canonical point for a team (B is the half turn) */
  const at = (t: 'A' | 'B', ax: number, ay: number): Pt => [cx + sgOf(t) * ax, cy - sgOf(t) * ay];

  // ---- every side's own numbers, drawn up front (A then B) so no later draw shifts them ----
  interface Side { team: 'A' | 'B'; stx: number; sty: number; ux: number; uy: number; phi: number; b: number[]; gateD: number; gateY: number; upX: number }
  const sides: Side[] = (['A', 'B'] as const).map((team) => ({
    team, stx: fr('stageX'), sty: fr('stageY'), ux: fr('upperX'), uy: fr('upperY'), phi: R.range(0.66, 0.82),
    b: [0, 1, 2, 3].map((i) => fr('bend') * (i % 2 ? -1 : 1) * R.range(0.6, 1)), gateD: R.range(8, 10), gateY: R.range(7.4, 9), upX: R.range(7.5, 9.5),
  }));

  // ---- relief: woodland floor, the lower terrace (an ellipse with a wobbling rim), a raised terrace on each side ----
  g.used.add('cliff'); g.used.add('relief');
  const ell = (qx: number, qy: number, ex: number, ey: number, a: number, b: number) => ((qx - ex) / a) ** 2 + ((qy - ey) / b) ** 2;
  const upper = sides.map((sd) => at(sd.team, sd.ux, -sd.uy));
  for (let y = 0; y < g.S; y++) for (let x = 0; x < g.S; x++) {
    const [qx, qy] = g.Q(x + 0.5, y + 0.5), k = g.idx(x, y);
    const n = (fbm(qx / 7, qy / 7, wob, 2) - 0.5) * 0.12;
    g.kind[k] = HK.floor; g.H[k] = 0;
    if (ell(qx, qy, cx, cy, La, Lb) <= 1 + n) { g.H[k] = Hl; g.precinct[k] = 1; }
    for (const u of upper) if (ell(qx, qy, u[0], u[1], Ua, Ub) <= 1 + n) { g.H[k] = Hu; g.precinct[k] = 1; }
  }
  // the forecourt is lower-terrace floor whatever a raised terrace's ellipse reached
  const [ccx, ccy] = C(cx, cy);
  g.disc(ccx, ccy, platR + 1.5, (k) => { g.H[k] = Hl; g.precinct[k] = 1; });
  g.contest = { x: ccx, y: ccy, h: Hl, r: r0 };
  g.nodes.contest = [ccx, ccy];
  g.disc(ccx, ccy, platR, (k) => { g.platform[k] = 1; });

  // ---- stagings in the woodland, one each side ----
  const stage = {} as Record<'A' | 'B', Pt>;
  for (const sd of sides) { stage[sd.team] = C(...at(sd.team, sd.stx, sd.sty)); for (const id of ['stage', 'spawn', 'exit']) g.nodes[id + sd.team] = stage[sd.team]; }

  // ---- routes, one side at a time ----
  const W = 5; // tread width: the largest essential body (elite, 2.84 m) plus turning margin on diagonals
  // the relief's rim (with the same wobble) and a ramp cut across it
  const rimN = (qx: number, qy: number) => (fbm(qx / 7, qy / 7, wob, 2) - 0.5) * 0.12;
  const inL = (x: number, y: number) => ell(x, y, cx, cy, La, Lb) <= 1 + rimN(x, y);
  const inU = (u: Pt) => (x: number, y: number) => ell(x, y, u[0], u[1], Ua, Ub) <= 1 + rimN(x, y);
  const wc = (p: Pt, h: number): WP => wp(p[0], p[1], h);
  const loc = (t: 'A' | 'B', p: Pt): Pt => [(p[0] - cx) / sgOf(t), (cy - p[1]) / sgOf(t)];
  /** a ramp along the line a → b (canonical) across the rim `inside` names: foot `out` tiles outside the rim, top where it has risen `h` at grade 0.4;
   *  `pre` is 6 tiles back along the same axis (the woodland leg's last stretch) */
  const ramp = (a: Pt, b: Pt, inside: (x: number, y: number) => boolean, h: number, out: number) => {
    const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) * 4), dl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, dir: Pt = [(b[0] - a[0]) / dl, (b[1] - a[1]) / dl];
    let r0: Pt = b;
    for (let i = 0; i <= n; i++) { const x = lerp(a[0], b[0], i / n), y = lerp(a[1], b[1], i / n); if (inside(x, y)) { r0 = [x, y]; break; } }
    const foot: Pt = [r0[0] - dir[0] * out, r0[1] - dir[1] * out], top: Pt = [foot[0] + dir[0] * (h / 0.4), foot[1] + dir[1] * (h / 0.4)];
    return { foot, top, dir, pre: [foot[0] - dir[0] * 6, foot[1] - dir[1] * 6] as Pt };
  };
  const entries: number[] = []; // the angle (map space, from the centre) each route reaches the forecourt at
  const angleOf = (p: Pt) => Math.atan2(p[1] - ccy, p[0] - ccx);
  for (const sd of sides) {
    const team = sd.team, w = (ax: number, ay: number, h: number) => wp(...at(team, ax, ay), h);
    const [b0, b1, b2, b3] = sd.b;
    // lower path: out of the woodland, a short steep ramp cut across the lower terrace's rim, along the lower wall and into the
    // forecourt from the west-south-west. A ramp is a cut across the rim (grade 0.4), found where its axis meets the rim the
    // relief drew: a gentle ramp leaves a long band along its side where the bank is 0.5-0.7 m, the step limit, and a body
    // that cuts the corner wedges on it. The woodland leg runs along the ramp's axis for its last 6 tiles, and clears 2 tiles either
    // side of the tread (the validator lets a route stray 2 tiles off it, 4.5 from its centre line).
    const A1 = approach(g, team, 'direct', 'lower wall path, rim gap, forecourt gate');
    const fx = La * Math.cos(sd.phi), fy = Lb * Math.sin(sd.phi);
    const rm = ramp(at(team, fx * 1.35, fy * 1.35), at(team, fx * 0.55, fy * 0.55), inL, Hl, 1.3);
    const [px1, py1] = loc(team, rm.pre);
    path(g, [w(sd.stx, sd.sty, 0), w(lerp(sd.stx, px1, 0.35), lerp(sd.sty, py1, 0.5) + b0, 0), wc(rm.pre, 0), wc(rm.foot, 0), wc(rm.top, Hl)], { w: W, approach: A1, keep: 2 });
    // (inside the walls the tread claims no margin: the gap in a wall is the tread's own width)
    const [tx, ty] = loc(team, rm.top);
    path(g, [wc(rm.top, Hl), w(lerp(tx, sd.gateD + 9, 0.55), lerp(ty, sd.gateY + 3.5, 0.55) + b1 * 0.4, Hl), w(sd.gateD + 9, sd.gateY + 3.5 + b1 * 0.15, Hl), w(sd.gateD, sd.gateY, Hl), w(0, 0, Hl)],
      { w: W, approach: A1, keep: 0 });
    entries.push(angleOf(C(...at(team, sd.gateD, sd.gateY))));

    // upper path: out of the woodland, a ramp cut up onto this side's raised terrace at its far end, along its north contour behind
    // the plot group, a ramp down into the forecourt from the north-west
    const A2 = approach(g, team, 'flank', 'upper contour path behind the plots, terrace ramp, forecourt gate');
    const tipX = sd.ux + Ua; // the terrace's far (outer) tip
    const rm2 = ramp(at(team, tipX + 9, -sd.uy), at(team, tipX - 6, -sd.uy), inU(upper[sides.indexOf(sd)]), Hu, 1.5);
    const [px2, py2] = loc(team, rm2.pre);
    path(g, [w(sd.stx, sd.sty, 0), w(lerp(sd.stx, px2, 0.35), lerp(sd.sty, py2, 0.5) + b2, 0), wc(rm2.pre, 0), wc(rm2.foot, 0), wc(rm2.top, Hu)], { w: W, approach: A2, keep: 2 });
    path(g, [wc(rm2.top, Hu), w(sd.ux + Ua * 0.45, -sd.uy - Ub * 0.55 + b3 * 0.25, Hu), w(sd.ux - Ua * 0.2, -sd.uy - Ub * 0.5, Hu), w(sd.upX + 3, -sd.uy + 1.5, Hu), w(sd.upX, -8.7, Hl), w(0, 0, Hl)],
      { w: W, approach: A2, keep: 0 });
    entries.push(angleOf(C(...at(team, sd.upX, -8.7))));
  }

  // every wall keeps 2.5 tiles clear of any tread: a route may stray 2 tiles off its tread and a body is 1.1 m across
  const clearOfTread = (() => {
    const near = new Uint8Array(g.S * g.S);
    for (const A of g.approaches) for (const k of A.tiles) g.disc((k % g.S) + 0.5, ((k / g.S) | 0) + 0.5, 2.5, (j) => { near[j] = 1; });
    return (k: number) => !near[k];
  })();

  // ---- walls round the forecourt and wings between the gates (the perimeter comes last, round the plots) ----
  const courtR = platR + 1.3, court: Pt[] = [];
  for (let i = 0; i <= 64; i++) { const t = (i / 64) * 6.2832; court.push([ccx + dcos(t) * courtR, ccy + dsin(t) * courtR]); }
  const angD = (a: number, b: number) => { let d = (a - b) % 6.2832; if (d > 3.1416) d -= 6.2832; if (d < -3.1416) d += 6.2832; return Math.abs(d); };
  const inner = brokenWall(g, R, court, { rise: wallRise - 0.2, piece: [4, 7.5], gap: [2.5, 4], open: (x, y) => { const a = Math.atan2(y - ccy, x - ccx); return entries.some((e) => angD(a, e) < 0.28); }, can: (k) => !g.keep[k] && !g.lock[k] && g.kind[k] === HK.floor && !g.platform[k] && clearOfTread(k) });
  // wing walls: from the forecourt wall outward along the bisector of each pair of neighbouring gates. Each route's last stretch runs
  // in its own corridor between wings, so a watcher on one cannot see across the forecourt into another's (a ray has to pass
  // through two gates that are 70-110 degrees apart)
  const sorted = [...entries].sort((a, b) => a - b), wings: number[] = [];
  sorted.forEach((e, i) => { const nx = i === sorted.length - 1 ? sorted[0] + 6.2832 : sorted[i + 1]; wings.push((e + nx) / 2); });
  let wingTiles = 0;
  for (const a of wings) {
    // out to the edge of the precinct: a wing that stops short leaves a ray over its end
    let reach = courtR + 2;
    while (reach < 46) {
      const [px, py] = [ccx + dcos(a) * (reach + 1), ccy + dsin(a) * (reach + 1)];
      if (!g.in(Math.floor(px), Math.floor(py)) || !g.precinct[g.idx(Math.floor(px), Math.floor(py))]) break;
      reach += 1;
    }
    wingTiles += brokenWall(g, R, [[ccx + dcos(a) * (courtR + 0.3), ccy + dsin(a) * (courtR + 0.3)], [ccx + dcos(a) * reach, ccy + dsin(a) * reach]],
      { rise: wallRise - 0.1, piece: [reach + 4, reach + 6], gap: [1, 1], can: (k) => !g.keep[k] && !g.lock[k] && g.kind[k] === HK.floor && !g.platform[k] && clearOfTread(k) }).length;
  }

  // ---- plots: arcs concentric with the forecourt (along the contour), in the sectors between a wing and a gate; neighbours shear
  // opposite ways and sit at different radii (staggered) ----
  const gr = g.recipe.graves!, count = fi('plotCount');
  const baseAngle = fr('angle');
  interface Slot { a0: number; a1: number }
  const slots: Slot[] = [];
  sorted.forEach((e, i) => {
    const nx = i === sorted.length - 1 ? sorted[0] + 6.2832 : sorted[i + 1], b = (e + nx) / 2;
    slots.push({ a0: e, a1: b }, { a0: b, a1: nx });
  });
  // a plot takes the arc between a gate's path margin and a wing's (3.8 tiles from a gate, 3 from a wing), at its own radius; a
  // plot that comes out under five markers is taken back and the next slot tried
  const plots: GravePlot[] = [], shears: { a: number; sign: 1 | -1 }[] = [];
  const order = R.shuffle(slots.map((s, i) => ({ s, i })));
  const rRow = fr('plotR');
  for (const { s, i } of order) {
    if (plots.length >= count) break;
    // staggered: each plot sits a step further in or out than the last
    const r = rRow + (plots.length % 2 ? 1.8 : -1.2) + R.range(-0.5, 0.5);
    const aS = s.a0 + (i % 2 === 0 ? 3.8 : 3) / r, aE = s.a1 - (i % 2 === 0 ? 3 : 3.8) / r;
    if ((aE - aS) * r < 6) continue;
    const pts: Pt[] = [];
    for (let j = 0; j <= 10; j++) { const a = aS + ((aE - aS) * j) / 10; pts.push([ccx + dcos(a) * r, ccy + dsin(a) * r]); }
    // a plot shears the opposite way to its nearest neighbour, so no lane runs straight through a seam (R21: opposing angles)
    const mid = Math.atan2(pts[5][1] - ccy, pts[5][0] - ccx);
    let near = Infinity, sign: 1 | -1 = 1;
    for (const q of shears) { const d = angD(mid, q.a); if (d < near) { near = d; sign = q.sign === 1 ? -1 : 1; } }
    const P = planPlot(g, R, { contour: pts, rows: fi('rows'), cols: fi('cols'), pitch: fr('pitch'), rowGap: fr('rowGap'), start: 0, angle: sign * (baseAngle + R.range(-0.06, 0.06)), wave: fr('wave'), jitter: fr('jitter'), skip: 0.1, mix: gr.mix, wide: gr.wide, lean: gr.lean, tread: 1, can: (k) => !!g.precinct[k] });
    // a stele beyond each end of the arc, on its middle row: the taller memorial that stops the alley and interrupts the line across the court
    for (const [a, sg] of [[aS, -1], [aE, 1]] as const) for (const d of [2.4, 3.2, 4]) if (placeMark(g, P, ccx + dcos(a + (sg * d) / r) * r, ccy + dsin(a + (sg * d) / r) * r, 'stele', 1, 0)) break;
    if (P.marks.length < 5) { dropPlot(g, P); continue; }
    plots.push(P); shears.push({ a: mid, sign });
  }
  // every class is in the precinct: where a seed's draw left one out, a marker of the commonest class becomes it
  {
    const all = plots.flatMap((p) => p.marks), by = (c: string) => all.filter((m) => m.cls === c);
    for (const cls of ['stele', 'kerb', 'stone'] as const) {
      if (by(cls).length) continue;
      const donors = (['stone', 'kerb', 'stele'] as const).map(by).sort((p, q) => q.length - p.length)[0];
      if (donors.length > 3) retype(g, donors[(donors.length >> 1)], cls);
    }
  }
  g.shape.plots = plots.length;

  // the perimeter: a broken wall round the lower terrace's rim, clear of the markers
  const wpiece = [F.wallPiece[0], F.wallPiece[1]] as [number, number], wgap = [F.wallGap[0], F.wallGap[1]] as [number, number];
  const openings: Pt[] = [];
  for (let i = 0, n = fi('wallOpen'); i < n; i++) { const t = R.range(0, 6.283); openings.push(C(cx + La * 0.94 * Math.cos(t), cy + Lb * 0.94 * Math.sin(t))); }
  const ring: Pt[] = [];
  for (let i = 0; i <= 96; i++) { const t = (i / 96) * 6.2832; ring.push(C(cx + La * 0.94 * Math.cos(t), cy + Lb * 0.94 * Math.sin(t))); }
  const nearMarker = (k: number) => { const x = k % g.S, y = (k / g.S) | 0; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (g.in(x + dx, y + dy) && g.marked[g.idx(x + dx, y + dy)]) return true; return false; };
  const rim = brokenWall(g, R, ring, { rise: wallRise, piece: wpiece, gap: wgap, open: (x, y) => openings.some((o) => Math.hypot(o[0] - x, o[1] - y) < 2.6), can: (k) => g.H[k] >= Hl - 0.01 && !g.keep[k] && !g.lock[k] && g.kind[k] === HK.floor && !g.platform[k] && !nearMarker(k) && clearOfTread(k) });
  g.shape.wallRim = rim.length; g.shape.wallCourt = inner.length; g.shape.wings = wingTiles; g.shape.openings = openings.length;
  g.shape.markers = plots.reduce((a, p) => a + p.marks.length, 0);

  // the terraces are the precinct: nothing grows on them but what is placed here (dress.ts leaves reserved tiles alone)
  for (let k = 0; k < g.S * g.S; k++) if (g.precinct[k]) g.keep[k] = 1;

  // ---- the memorial beside the point, at the angle farthest from every tread ----
  {
    let best = -Infinity, bx = ccx, by = ccy;
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * 6.2832, x = ccx + dcos(a) * (r0 + 1.5), y = ccy + dsin(a) * (r0 + 1.5);
      let d = 9;
      g.disc(x, y, 9, (k, dd) => { const t = g.kind[k]; if ((t === HK.route || t === HK.ramp || t === HK.tunnel) && dd < d) d = dd; });
      if (d > best) { best = d; bx = x; by = y; }
    }
    g.landmark = { x: bx, y: by, name: g.recipe.props.landmark };
  }

  g.anchors.push(stage.B, C(cx, 11), C(cx, S1 - 11), C(14, 16), C(S1 - 14, S1 - 16), C(cx - 30, S1 - 14), C(cx + 30, 14));
  g.m.bossSpot = [Math.floor(ccx), Math.floor(ccy)];
  border(g, 4, (k) => g.H[k]);
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

export const LANDFORMS: Record<string, (g: HabCtx) => void> = { gorge, crater, shoal, ridge, lagoon, sanctuary };
