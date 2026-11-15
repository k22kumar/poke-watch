// The lagoon landform kernel (docs/HABITATS.md, "Lagoon"): an island coast in one canonical frame (u west→east,
// v north→south), mapped to the map by a seeded quarter turn and mirror like the other kernels.
//
//   catchment   a stream rises at the north edge, runs across a jungle terrace and leaves it over a short cascade into a
//               plunge pool; the pool's outflow splits around a sandy islet that carries the point on a raised terrace,
//               rejoins south of it and widens into the lagoon, which drains through a barrier inlet to the sea edge (the
//               outlet). Levels never rise downstream: terrace reach > pool > arms = lagoon = inlet.
//   bands       from the water inland: the dry beach (sand, a few tiles), the backshore (grass and scrub, no stands), then
//               jungle (stands) on the low inland ground and on the terrace; the terrace's south face is the canopy edge.
//   routes      each side holds a staging clearing on the low shore. Direct (shore bank): along the lagoon's north beach,
//               open to the water, over a low bridge across the west/east arm onto the islet's apron and up a cut ramp.
//               Flank (inland causeway): up a ramp cut into the jungle bluff, through the stands, over a causeway at
//               terrace height onto the islet's north edge. The two arrive from the south and the north of the islet.
//   shelf       the lagoon's shallow rim is scenery (lilies, dress.ts); no route, gate or optional piece lies under water.
//   breaks      terrain (boulder family) cuts the sightlines the open shore would give: a karst tower across each bluff's
//               shoulder between the crossings, and stacks on the beach (the `shore` gate, validate.ts, is the check).
import { dsin } from '../../core/detmath';
import { fbm } from '../../core/rng';
import { HK, MED, type Approach, type HabCtx } from './ctx';
import { basin, bridge, causeway, channel, keepLine, path, plinth, ruinWall, spur, type Pt, type WP } from './families';

const sstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const N4: [number, number][] = [[1, 0], [0, 1], [-1, 0], [0, -1]];

/** the open shore of a lagoon map (low ground within the dry band of the water): validate.ts's `shore` gate reads it */
const SHORE = new WeakMap<HabCtx, Uint8Array>();
export const shoreOf = (g: HabCtx): Uint8Array | undefined => SHORE.get(g);

function approach(g: HabCtx, team: 'A' | 'B', kind: 'direct' | 'flank', form: string): Approach {
  const a: Approach = { id: `${team}.${kind}`, team, kind, form, pts: [], tiles: [] };
  g.approaches.push(a);
  return a;
}

export function lagoon(g: HabCtx) {
  const R = g.rng('landform'), F = g.recipe.freedoms, L = g.recipe.levels;
  const fr = (key: string) => R.range(F[key][0], F[key][1]);
  g.rot = R.int(0, 3); g.mir = R.chance(0.5);
  const S1 = g.S - 1;
  const C = (x: number, y: number): Pt => g.P(x / S1, y / S1);
  const wp = (x: number, y: number, h: number): WP => { const [mx, my] = C(x, y); return { x: mx, y: my, h }; };
  // axis-aligned shapes (basin, plinth) live in map space: a quarter turn swaps their axes
  const odd = g.rot % 2 === 1;
  const ax = (a: number, b: number): [number, number] => (odd ? [b, a] : [a, b]);
  const Hj = L.terrace, Hs = L.shore, WL = L.water, Hr = L.apron, WU = Hj - 0.25;
  const wob = R.int(1, 1e6);

  // ---- the plan, canonical: the stream line, the lip, the pool, the islet, the lagoon, the inlet ----
  const x0 = S1 / 2 + fr('streamShift'), amp = fr('bend'), freq = fr('bendFreq'), ph = R.range(0, 6.283);
  const sx = (y: number) => x0 + amp * dsin((y / S1) * 6.283 * freq + ph); // the stream's centre line
  const lip = fr('lipY'), poolR = fr('poolR');
  const py = lip + poolR - 1.2;
  const irx = fr('islandRx'), iry = fr('islandRy'), armW = R.int(F.armW[0], F.armW[1]);
  const iy = py + poolR + iry + fr('islandGap'), ix = sx(iy);
  const lrx = fr('lagoonRx'), lry = fr('lagoonRy');
  const curve = fr('curve'); // bank curvature: how far the lagoon's wings sag toward the south
  const lcx = ix + R.range(-2, 2), ly = iy + iry - 3 + lry;
  const inletW = fr('inletW'), bendA = fr('inletBend'), bendB = fr('inletBend');
  const canopy = fr('canopy'), phE = R.range(0, 6.283);
  g.shape.lip = +lip.toFixed(1); g.shape.curve = +curve.toFixed(1); g.shape.inlet = +(bendA + bendB).toFixed(1); g.shape.canopy = +(canopy * 10 + phE).toFixed(1);
  g.shape.lagoon = +(lrx * 10 + lry).toFixed(1);

  // the islet and the stream's banks, as functions of y (the island's ellipse and the arms around it)
  const tw = (y: number, rr = iry - 3, rx = irx - 3) => { const t = (y - iy) / rr; return Math.abs(t) >= 1 ? 0 : rx * Math.sqrt(1 - t * t); };
  const armOff = (y: number) => { const t = (y - iy) / iry; return (Math.abs(t) < 1 ? irx * Math.sqrt(1 - t * t) : 0) + armW / 2 + 0.4; };
  const ay0 = iy - iry - 5, ay1 = iy + iry + 5; // the arms run along the islet from here to here
  // the stream's half width at y between the pool and the arms (the main reach), and the pool's
  const half = (y: number) => {
    if (y >= ay0 && y <= ay1) return armOff(y) + armW / 2;
    const d = Math.abs(y - py);
    return d < poolR ? Math.max(armW / 2 + 0.3, Math.sqrt(poolR * poolR - d * d)) : armW / 2 + 0.3;
  };

  // ---- relief: low ground everywhere; the jungle terrace north of the canopy edge, and a bluff along each arm's outer bank ----
  g.used.add('cliff'); g.used.add('relief');
  const esc = (cx: number) => lip + canopy * dsin(cx * 0.085 + phE) + (fbm(cx / 9, 3.3, wob, 2) - 0.5) * 3.5;
  const tw0 = fr('bluffW'), bluffEnd = iy + iry * fr('bluffEnd');
  const bluff = (cx: number, cy: number, sg: number) => {
    if (cy < lip + 2 || cy > bluffEnd) return false;
    const edge = sg < 0 ? ix - half(cy) + 0.3 : ix + half(cy) - 0.3; // the arm's outer bank (the arm overwrites the overlap: no sliver of low ground)
    const d = sg < 0 ? edge - cx : cx - edge;
    if (d < 0 || d > tw0) return false;
    // the south end is square at the arm's bank and rounds off toward the outer face
    const u = Math.max(0, (d - tw0 / 2) / (tw0 / 2));
    return cy <= bluffEnd - 7 * u * u;
  };
  for (let y = 0; y < g.S; y++) for (let x = 0; x < g.S; x++) {
    const [cx, cy] = g.Q(x + 0.5, y + 0.5), k = g.idx(x, y);
    if (cy < esc(cx) || bluff(cx, cy, -1) || bluff(cx, cy, 1)) { g.H[k] = Hj; g.kind[k] = HK.floor; } else { g.H[k] = Hs; g.kind[k] = HK.floor; }
  }

  // ---- water: the stream (catchment) over the terrace, the pool under the cascade, the reach and the arms, the lagoon, the inlet ----
  const line = (a: number, b: number, off = 0, step = 2): Pt[] => { const out: Pt[] = []; for (let y = a; y <= b; y += step) out.push(C(sx(y) + off, y)); out.push(C(sx(b) + off, b)); return out; };
  channel(g, line(-6, lip + 1.5), armW + 1, { med: MED.water, wl: () => WU, lock: true });
  basin(g, ...C(sx(py), py), ...ax(poolR, poolR * 0.92), { med: MED.water, wl: WL, lock: true });
  channel(g, line(py, iy + iry + 8), armW + 0.5, { med: MED.water, wl: () => WL, lock: true });
  // the lagoon: a main body and two wings, the wings drawn lower by `curve` (the bank's curvature), then the inlet through the barrier
  const [mrx, mry] = ax(lrx, lry), [wrx, wry] = ax(lrx * 0.55, lry * 0.8);
  basin(g, ...C(lcx, ly), mrx, mry, { med: MED.water, wl: WL, lock: true, wobble: 0.3 });
  for (const sg of [-1, 1]) basin(g, ...C(lcx + sg * lrx * 0.55, ly + curve * (sg < 0 ? 1 : -0.6)), wrx, wry, { med: MED.water, wl: WL, lock: true, wobble: 0.4 });
  const inletTop = ly + lry - 2.5, inletX = lcx + (bendA + bendB) * 0.15;
  channel(g, [C(inletX, inletTop), C(inletX + bendA, inletTop + 5), C(inletX + bendB, S1 - 9), C(inletX + bendB, S1 - 7)], inletW, { med: MED.water, wl: () => WL, lock: true, depth: 0.8 });
  g.sources.push(C(sx(0), 0)); g.outlets.push(C(inletX + bendB, S1 - 8));

  // ---- the islet: a sandy apron, the terrace on it (the whole north half is terrace to the arm, so the deck lands on it) ----
  const [icx, icy] = C(ix, iy);
  const [erx, ery] = ax(irx, iry);
  plinth(g, icx, icy, erx, ery, Hr, HK.bank, false);
  plinth(g, icx, icy, ...ax(irx - 3, iry - 3), Hj, HK.terrace, false);
  for (let y = 0; y < g.S; y++) for (let x = 0; x < g.S; x++) {
    const [cx, cy] = g.Q(x + 0.5, y + 0.5);
    if (cy > iy - 0.15 * iry || ((cx - ix) / irx) ** 2 + ((cy - iy) / iry) ** 2 > 1) continue;
    const k = g.idx(x, y);
    if (g.kind[k] !== HK.fluid) { g.H[k] = Hj; g.kind[k] = HK.terrace; }
  }
  for (const sg of [-1, 1]) {
    const pts: Pt[] = [];
    for (let y = ay0; y <= ay1; y += 1) pts.push(C(sx(y) + sg * armOff(y), y));
    channel(g, pts, armW, { med: MED.water, wl: () => WL, lock: true });
  }

  // ---- stray water: a wing's wobble can strand a tile or two. Anything not 4-connected to the inlet is land ----
  const n = g.S * g.S, dw = new Int16Array(n).fill(999), Q = new Int32Array(n);
  let qh = 0, qt = 0;
  {
    const [ox, oy] = g.outlets[0], seen = new Uint8Array(n);
    let best = -1, bd = Infinity;
    for (let k = 0; k < n; k++) if (g.kind[k] === HK.fluid) { const d = ((k % g.S) - ox) ** 2 + (((k / g.S) | 0) - oy) ** 2; if (d < bd) { bd = d; best = k; } }
    seen[best] = 1; Q[qt++] = best;
    while (qh < qt) {
      const a = Q[qh++], x = a % g.S, y = (a / g.S) | 0;
      for (const [dx, dy] of N4) { if (!g.in(x + dx, y + dy)) continue; const b = g.idx(x + dx, y + dy); if (!seen[b] && g.kind[b] === HK.fluid) { seen[b] = 1; Q[qt++] = b; } }
    }
    let pruned = 0;
    for (let k = 0; k < n; k++) if (g.kind[k] === HK.fluid && !seen[k]) { g.kind[k] = HK.floor; g.H[k] = g.wl[k] > 1 ? Hj : Hs; g.med[k] = MED.none; g.lock[k] = 0; pruned++; }
    if (pruned) g.notes.push(`pruned ${pruned} stray water tiles`);
    qh = 0; qt = 0;
  }
  // ---- the shore: dry beach and backshore bands from the lagoon's waterline inland (low ground only) ----
  for (let k = 0; k < n; k++) if (g.kind[k] === HK.fluid && g.wl[k] < 0) { dw[k] = 0; Q[qt++] = k; }
  while (qh < qt) {
    const a = Q[qh++], x = a % g.S, y = (a / g.S) | 0;
    for (const [dx, dy] of N4) {
      if (!g.in(x + dx, y + dy)) continue;
      const b = g.idx(x + dx, y + dy);
      if (dw[b] <= dw[a] + 1 || g.kind[b] === HK.fluid) continue;
      dw[b] = dw[a] + 1; Q[qt++] = b;
    }
  }
  const beachW = Math.round(fr('beachW'));
  let beach = 0;
  for (let k = 0; k < n; k++) {
    if (g.kind[k] !== HK.floor || g.H[k] > Hs + 0.1 || dw[k] > beachW) continue;
    const [qx, qy] = g.Q((k % g.S) + 0.5, ((k / g.S) | 0) + 0.5);
    // the sliver of bank between the islet's apron and its arms is the apron's own height (a bridge lands across it)
    if (((qx - ix) / (irx + 2)) ** 2 + ((qy - iy) / (iry + 2)) ** 2 <= 1) { g.kind[k] = HK.bank; g.H[k] = Hr; continue; }
    g.kind[k] = HK.bank; g.H[k] = Hs - 0.2 + 0.05 * dw[k]; beach++;
  }
  g.shape.beach = beach;

  // ---- stagings: a clearing on the low shore, west (A) and east (B) of the lagoon's head ----
  const stageX: Record<'A' | 'B', number> = { A: fr('stageX'), B: S1 - fr('stageX') };
  const stageY: Record<'A' | 'B', number> = { A: iy + fr('stageDy'), B: iy + fr('stageDy') + R.range(-3, 3) };
  const stage: Record<'A' | 'B', Pt> = { A: C(stageX.A, stageY.A), B: C(stageX.B, stageY.B) };
  for (const t of ['A', 'B'] as const) {
    g.disc(stage[t][0], stage[t][1], 6, (k) => { if (g.kind[k] !== HK.fluid) { g.kind[k] = HK.floor; g.H[k] = Hs; } });
    for (const id of ['stage', 'spawn', 'exit']) g.nodes[id + t] = stage[t];
  }

  // ---- the point on the islet's terrace ----
  const shrineSide = R.chance(0.5) ? 1 : -1;
  const cX = ix - shrineSide * 1.5, cY = iy - 1.5;
  const [ccx, ccy] = C(cX, cY);
  const r0 = g.mode.contestR;
  g.contest = { x: ccx, y: ccy, h: Hj, r: r0 };
  g.nodes.contest = [ccx, ccy];

  // ---- approaches, one side at a time: sg = -1 west (A), +1 east (B) ----
  const W = 5; // tread width: the largest essential body (elite, 2.84 m) plus turning margin on diagonals
  const shoreY = (cx: number): number => { // the lagoon's north waterline at column cx, canonical (scanned), or -1
    for (let cy = Math.floor(iy + iry * 0.3); cy < S1 - 6; cy++) { const [mx, my] = C(cx, cy), k = g.idx(Math.floor(mx), Math.floor(my)); if (g.in(Math.floor(mx), Math.floor(my)) && g.kind[k] === HK.fluid && g.wl[k] < 0 && !g.culvert[k]) return cy; }
    return -1;
  };
  const sideOf = (team: 'A' | 'B') => {
    const sg = team === 'A' ? -1 : 1;
    const [sxm, sym] = g.Q(stage[team][0], stage[team][1]);
    const bankX = (y: number) => ix + sg * armOff(y); // the arm's centre
    // ---- direct: the shore bank. Along the lagoon's north beach (it follows the waterline), over a low bridge across the
    // arm just above where it meets the lagoon, onto the islet's apron, then a ramp cut up into the terrace ----
    const A1 = approach(g, team, 'direct', 'shore bank along the beach, low bridge, cut ramp');
    const yb = iy + iry * R.range(0.48, 0.58);
    const bw: Pt = [bankX(yb) + sg * (armW / 2 + 3), yb], be: Pt = [bankX(yb) - sg * (armW / 2 + 2.2), yb];
    const beachPts: WP[] = [wp(sxm, sym, Hs)];
    const nSeg = 5;
    // the waterline's nearest approach within a few columns either side (a diagonal shore comes closer than its column says)
    const nearWater = (cx: number): number => { let best = -1; for (let d = -5; d <= 5; d += 1.5) { const y = shoreY(cx + d); if (y > 0 && (best < 0 || y < best)) best = y; } return best; };
    for (let i = 1; i <= nSeg; i++) {
      const cx = lerp(sxm, bw[0], i / nSeg), yw = nearWater(cx), yLat = lerp(sym, yb, i / nSeg);
      // keep a few tiles of beach between the raised bank and the water (a dike with water at its foot would pinch it)
      const yy = yw < 0 ? yLat : Math.max(yb - 1, Math.min(yw - 5.5, yLat + 7));
      // the first stretch is on the beach; from the third waypoint the route runs on the raised bank (a berm at the apron's height)
      beachPts.push(wp(cx, i === nSeg ? yb : lerp(yy, yb, sstep(0.6, 1, i / nSeg)), i <= 2 ? Hs : Hr));
    }
    // the raised bank runs on to the arm's edge, so the bridge's near end stands on it
    beachPts.push(wp(bankX(yb) + sg * (armW / 2 + 0.9), yb, Hr));
    path(g, beachPts, { w: W, approach: A1, keep: 1, kind: HK.bank, can: (k) => !g.lock[k] && g.kind[k] !== HK.fluid });
    // the bridge is laid at the raised bank's height whatever lies under the edges of its strip (a bridge takes the lowest
    // tile it covers, and a beach tile a half-tile outside the route would drop the whole deck a metre)
    const deck = bridge(g, C(bw[0], bw[1]), C(be[0] - sg * 0.5, be[1]), W, A1);
    for (const k of deck) g.H[k] = Hr;
    g.joins[g.joins.length - 1].h = Hr;
    // the apron: a landing on the islet's bank ring, then the cut ramp up into the terrace
    g.disc(...C(be[0], be[1]), 3.2, (k) => { if (g.kind[k] !== HK.fluid) { g.kind[k] = HK.route; g.H[k] = Hr; g.keep[k] = 1; A1.tiles.push(k); } });
    const dx = cX - be[0], dy = cY - be[1], dl = Math.hypot(dx, dy) || 1;
    const rl = (Hj - Hr) / 0.42 + 0.5;
    const top: Pt = [be[0] + (dx / dl) * (rl + 1.5), be[1] + (dy / dl) * (rl + 1.5)];
    path(g, [wp(be[0] + (dx / dl) * 1.5, be[1] + (dy / dl) * 1.5, Hr), wp(top[0], top[1], Hj)], { w: W, approach: A1, keep: 1, can: (k) => g.kind[k] !== HK.fluid });
    path(g, [wp(top[0], top[1], Hj), wp(cX, cY, Hj)], { w: W, approach: A1, keep: 1, can: (k) => g.kind[k] === HK.terrace || g.kind[k] === HK.route });

    // ---- flank: the inland causeway. Out of staging to the bluff's outer face, up a ramp cut into it, through the jungle on
    // top to the arm's bank, over a causeway at terrace height onto the islet's terrace (it arrives from the north) ----
    const A2 = approach(g, team, 'flank', 'jungle bluff ramp, canopy path, causeway');
    const yn = iy - iry * R.range(0.5, 0.64);
    const bankW = ix + sg * (half(yn) + 0.9); // the arm's outer bank at yn
    const faceX = bankW + sg * tw0; // the bluff's outer face (its far side from the arm)
    const rampY = Math.min(sym - 4, bluffEnd - 9), rampLen = (Hj - Hs) / 0.4;
    // the ramp starts on the low ground just outside the face and climbs inward to the terrace's top
    const foot: Pt = [faceX + sg * 1, rampY], head: Pt = [faceX - sg * (rampLen - 1), rampY];
    // the canopy path swings up into the jungle's middle (north of the crossing) and comes back down to the arm's bank
    const mid: Pt = [lerp(head[0], bankW, 0.5) + R.range(-2, 2), Math.max(lip + 5, yn - R.range(11, 15))];
    const free = (k: number) => !g.lock[k] && g.kind[k] !== HK.fluid;
    path(g, [wp(sxm, sym, Hs), wp(lerp(sxm, foot[0], 0.55), lerp(sym, rampY, 0.65), Hs), wp(foot[0], foot[1], Hs)], { w: W, approach: A2, keep: 1, can: free });
    path(g, [wp(foot[0], foot[1], Hs), wp(head[0], head[1], Hj)], { w: W, approach: A2, keep: 1, can: free });
    // (the canopy path keeps no margin: the stand closes in to the tread's edge, so the inland route is walked between trees)
    path(g, [wp(head[0], head[1], Hj), wp(mid[0], mid[1], Hj), wp(bankW + sg * 3, yn, Hj)], { w: W, approach: A2, keep: 0, can: free });
    const land: Pt = [ix + sg * (tw(yn, iry, irx) - 2.2), yn];
    causeway(g, C(bankW + sg * 2.5, yn), C(land[0], land[1]), W, Hj, A2);
    path(g, [wp(land[0], land[1], Hj), wp(cX, cY, Hj)], { w: W, approach: A2, keep: 1, can: (k) => g.kind[k] === HK.terrace || g.kind[k] === HK.route });
    keepLine(g, [C(bankW + sg * 2.5, yn), C(land[0], land[1])], 3);
    // ---- sightline breaks (boulder family: terrain, so they hold when every prop is gone) ----
    // a karst tower across the bluff's south shoulder between the two crossings: from the arm's bank inward, it hides the
    // shore bridge and apron from the canopy path and the causeway's head, and the other way round
    const ySp = iy + R.range(-1.5, 1.5), spLen = R.range(8, 10.5);
    const tower = spur(g, [C(bankW + sg * 0.5, ySp), C(bankW + sg * spLen, ySp + R.range(-1.5, 1.5))], R.range(3.2, 4), 2.4, (k) => !g.lock[k] && !g.keep[k] && g.kind[k] !== HK.fluid && g.kind[k] !== HK.bank);
    for (const k of tower) g.lock[k] = 1;
    g.shape[`spur${team}`] = tower.length;
    // stacks on the beach (rock outcrops, locked): one at the arm's mouth, just south of the bank's end, where the water's
    // straight reach would otherwise show the causeway to everyone standing on the sand; one a few tiles off the shore route
    // (on its lagoon side, else inland of it where the bank hugs the water)
    const stackAt = (a: Pt, b: Pt, w: number): number => {
      const H0 = g.H.slice(), K0 = g.kind.slice();
      const t = spur(g, [C(a[0], a[1]), C(b[0], b[1])], w, 2.2, (k) => !g.lock[k] && !g.keep[k] && g.kind[k] !== HK.fluid && g.H[k] < 1);
      if (t.length >= 3) { for (const k of t) g.lock[k] = 1; return t.length; }
      for (const k of t) { g.H[k] = H0[k]; g.kind[k] = K0[k]; } // too small to be a stack: put the ground back
      return 0;
    };
    let mouth = 0;
    for (const dy of [5.2, 6.5, 4.4, 8]) {
      mouth = stackAt([bankX(yb) + sg * (armW / 2 + 4.5), yb + dy], [bankX(yb) + sg * (armW / 2 + 7.5), yb + dy + R.range(-0.8, 0.8)], R.range(3, 3.8));
      if (mouth) break;
    }
    let placed = mouth;
    for (const f of [0.45, 0.3, 0.6, 0.2]) {
      const wpt = beachPts[Math.max(1, Math.min(beachPts.length - 2, Math.floor(beachPts.length * f)))], [qx, qy] = g.Q(wpt.x, wpt.y), yw = shoreY(qx);
      let got = 0;
      for (const dy of [yw > 0 ? Math.min(6, yw - 2.5 - qy) : 6, -6.5, 5.5, -8]) { got = stackAt([qx - sg * 1.2, qy + dy], [qx + sg * 2.4, qy + dy + R.range(-0.8, 0.8)], R.range(2.6, 3.4)); if (got) break; }
      if (got) { placed += got; break; }
    }
    g.shape[`stack${team}`] = placed;
    g.shape[`cross${team}`] = +yb.toFixed(1); g.shape[`over${team}`] = +yn.toFixed(1); g.shape[`ramp${team}`] = +rampY.toFixed(1);
    return { yb, yn, bankW, faceX };
  };
  sideOf('A'); sideOf('B');

  // ---- the landmark on the terrace beside the point, ruin stubs on its edge (structure family) ----
  const [shx, shy] = C(ix + shrineSide * (tw(iy) - 1.5), iy - 1.5);
  g.landmark = { x: shx, y: shy, name: g.recipe.props.landmark };
  for (const sg of [-1, 1]) for (const f of [0.55, 0.85]) {
    const yy = iy - 1.5 + sg * (iry - 3) * f, xx = ix + (sg * shrineSide > 0 ? 1 : -1) * tw(yy) * 0.8;
    ruinWall(g, C(xx - 1, yy), C(xx + 1, yy), 1.3);
  }
  for (let k = 0; k < n; k++) if (g.kind[k] === HK.terrace) g.lock[k] = 1;
  for (let y = Math.floor(icy - ery - 1); y <= icy + ery + 1; y++) for (let x = Math.floor(icx - erx - 1); x <= icx + erx + 1; x++) {
    // (a little beyond the apron: the sliver of bank between it and the arm is part of the islet)
    if (!g.in(x, y) || ((x + 0.5 - icx) / (erx + 1.4)) ** 2 + ((y + 0.5 - icy) / (ery + 1.4)) ** 2 > 1) continue;
    const k = g.idx(x, y);
    if (g.kind[k] !== HK.fluid) g.platform[k] = 1;
  }

  // the open shore as the validator sees it: low ground within the dry band of the lagoon's water, off the islet
  {
    const mask = new Uint8Array(n);
    for (let k = 0; k < n; k++) if (dw[k] <= 9 && g.H[k] < 1 && g.kind[k] !== HK.fluid && g.kind[k] !== HK.rock && g.kind[k] !== HK.mass && !g.platform[k]) mask[k] = 1;
    SHORE.set(g, mask);
  }

  // enemy entry anchors: the wild den, the lagoon's far shore, the inlet mouth, the stream's banks, the jungle corners
  g.anchors.push(stage.B, C(lcx, ly + lry * 0.4), C(inletX + bendB, S1 - 12), C(sx(8) - armW - 4, 8), C(sx(8) + armW + 4, 8), C(12, 24), C(S1 - 12, 24));
  g.m.bossSpot = [Math.floor(ccx), Math.floor(ccy)];
  border(g, 4, (k) => g.H[k]);
}

function border(g: HabCtx, m: number, h: (k: number) => number) {
  for (let y = 0; y < g.S; y++) for (let x = 0; x < g.S; x++) {
    if (x >= m && y >= m && x < g.S - m && y < g.S - m) continue;
    const k = g.idx(x, y);
    if (g.kind[k] === HK.fluid) continue;
    g.H[k] = h(k); g.kind[k] = HK.mass;
  }
}
