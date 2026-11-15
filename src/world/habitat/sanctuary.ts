// Landform kernel `sanctuary`: a precinct of tiers on a mountain, built from the ruin kit (ruins.ts) along one AXIS.
//
//   canonical frame: u west→east, v north→south, mapped to the map by a seeded quarter turn and mirror (the axis keeps its
//   order in every orientation: foothill at the south end, focal platform at the north end).
//
//   foothill   a plain along the south edge with a tarn between the two stagings; team A on the west, B on the east
//   threshold  a terrace one tier up, closed to the south by rock; a rock-cut switchback climbs to each end of it
//   forecourt  the colonnade court a tier higher (rows of columns either side of the processional lane), reached by a
//              stair on the axis; a side court off it whose wall has a seeded opening
//   platform   the focal tier: a solid plinth with the landmark on its south face, the contest court tangent to the plinth,
//              columns either side, a broken balustrade on its front edge; reached by a second stair on the axis
//   balcony    a ruined upper ledge on a rock shoulder beside the platform, the strongest upper position: a stair from the
//              platform climbs to it (the counter-angle), a short drop from its edge is the quick exit, wall fragments
//              screen it from the gallery's door
//   gallery    each side's second approach: a dry bedrock gallery from a mouth at the foot of the massif that climbs inside
//              the rock to a door onto the platform's flank (the balcony's side comes in behind it, at the rear)
//
// Each side draws its own numbers, A then B, so the plan is not a mirror image. The plan (tier rectangles, balcony, doors)
// is recorded for the sanctuary gates and the audit (planOf).
import { fbm } from '../../core/rng';
import { HK, MED, type Approach, type HabCtx } from './ctx';
import { basin, path, spur, tunnel, type Pt } from './families';
import { colonnadeCourt, focalCourt, gateway, RuinKit, type Rect } from './ruins';

export interface SanctuaryPlan {
  axis: number;
  /** tier rectangles in canonical coordinates, south to north: foothill (v ≥ foot), threshold, forecourt, platform */
  foot: number; threshold: Rect; forecourt: Rect; platform: Rect;
  heights: { foot: number; threshold: number; forecourt: number; platform: number; balcony: number };
  /** the points the axis passes through, canonical (the readable sequence) */
  sequence: { foot: Pt; threshold: Pt; forecourt: Pt; platform: Pt };
  plinth: Rect; hold: Pt;
  balcony: { side: -1 | 1; rect: Rect; tiles: number[]; stair: Pt };
  court: { side: -1 | 1; rect: Rect };
  doors: Record<'A' | 'B', { u: number; v: number; rear: boolean }>;
  /** per tile: which tier it belongs to (0 none, 1 threshold, 2 forecourt, 3 platform, 4 balcony); map tile index */
  tier: Uint8Array;
}
const PLANS = new WeakMap<HabCtx, SanctuaryPlan>();
export const planOf = (g: HabCtx): SanctuaryPlan | undefined => PLANS.get(g);

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function approach(g: HabCtx, team: 'A' | 'B', kind: 'direct' | 'flank', form: string): Approach {
  const a: Approach = { id: `${team}.${kind}`, team, kind, form, pts: [], tiles: [] };
  g.approaches.push(a);
  return a;
}

export function sanctuary(g: HabCtx) {
  const R = g.rng('landform'), F = g.recipe.freedoms, L = g.recipe.levels;
  const fr = (key: string) => R.range(F[key][0], F[key][1]);
  g.rot = R.int(0, 3); g.mir = R.chance(0.5);
  const S1 = g.S - 1;
  const K = new RuinKit(g);
  const C = (u: number, v: number): Pt => K.at(u, v);
  const wp = (u: number, v: number, h: number) => K.wp(u, v, h);
  const H1 = L.thresh, H2 = L.court, H3 = L.focal, H4 = L.balcony, Hm = L.mass, WL = L.water;
  const wob = R.int(1, 1e6);
  const W = 5; // tread width: the largest essential body (elite, 2.84 m) plus turning margin on diagonals
  const canCut = (k: number) => !g.lock[k] && g.kind[k] !== HK.fluid;

  // ---- the plan: every number drawn up front, so a later draw never shifts an earlier one ----
  const cx = S1 / 2 + fr('axis');
  const vF = fr('footV');
  const thrD = fr('thrD'), courtD = fr('courtD'), platD = fr('platD');
  const thrH = fr('thrHalf'), courtH = fr('courtHalf'), platH = fr('platHalf');
  const vT1 = vF - 3, vT0 = vT1 - thrD, vC0 = vT0 - courtD, vP0 = vC0 - platD;
  const plW = fr('plinthW'), plD = fr('plinthD'), plV0 = vP0 + fr('plinthV');
  const r0 = g.mode.contestR;
  const vHold = plV0 + plD + 2.5 + r0, hx = fr('holdShift');
  const sgB = (R.chance(0.5) ? 1 : -1) as -1 | 1; // the rock shoulder's side
  const balW = fr('balW'), balLenWant = fr('balLen'), balV0 = vP0 + fr('balV'), balH = H4 + fr('balRise');
  // the shoulder ends well short of the platform's front edge, so it never overlooks the forecourt's stair
  const balLen = Math.max(10, Math.min(balLenWant, vC0 - 7 - balV0));
  const courtW = fr('courtW'), courtDp = fr('courtDp'), courtV0 = vC0 + fr('courtV'), courtGap = fr('courtGap'), courtGapW = fr('courtGapW');
  const tarnU = cx + fr('tarnU'), tarnR = fr('tarnR'), tarnV = vF + fr('tarnV');
  // the ruin assemblies' own numbers
  const x = {
    plinthRise: fr('plinthRise'), spearRise: fr('spearRise'), gateWall: fr('gateWall'), phase: R.range(0, 2.5), pitch: fr('pitch'), broken: fr('broken'),
    colRise: fr('colRise'), thrPhase: R.range(0, 2), flankPitch: fr('flankPitch'), flankRise: fr('flankRise'), flankPhase: R.range(0, 2), gp: R.range(0.6, 0.7), gp2: R.range(0.82, 0.88),
  };
  interface Side { team: 'A' | 'B'; sg: -1 | 1; stU: number; stV: number; gu: number; x1: number; x2: number; leg: number; climb: number; doorV: number; rear: boolean }
  const sides: Side[] = (['A', 'B'] as const).map((team) => {
    const sg = (team === 'A' ? -1 : 1) as -1 | 1, rear = sg === sgB;
    // the gallery's column sits `galU` tiles in from the map edge; the switchback's two legs lie between it and the axis
    const gu = sg < 0 ? fr('galU') : S1 - fr('galU'), x1 = gu - sg * fr('sbOff'), x2 = x1 - sg * fr('hair');
    return {
      team, sg, stU: fr('stageU'), stV: vF + fr('stageV'), gu, x1, x2,
      leg: fr('legUp'), climb: H3 / fr('galGrade'), rear,
      doorV: rear ? vP0 + fr('doorRear') : vP0 + fr('doorFlank'),
    };
  });

  // ---- relief: rock everywhere; the foothill, then the tiers carved out of it ----
  g.used.add('cliff'); g.used.add('relief');
  for (let y = 0; y < g.S; y++) for (let x = 0; x < g.S; x++) {
    const [u, v] = K.to(x + 0.5, y + 0.5), k = g.idx(x, y);
    const edge = vF + (fbm(u / 9, 3, wob, 2) - 0.5) * 3;
    if (v >= edge) { g.H[k] = 0; g.kind[k] = HK.floor; continue; }
    g.H[k] = Hm + Math.round(fbm(u / 5, v / 5, wob + 1, 2) * 3) * 0.6; g.kind[k] = HK.mass;
  }
  // the tarn between the stagings (channel family): a closed basin, it is its own sink
  const [tmx, tmy] = C(tarnU, tarnV);
  basin(g, tmx, tmy, tarnR, tarnR, { med: MED.water, wl: WL, lock: true, wobble: 0.3 });
  g.sinks.push([tmx, tmy]);

  const rThr: Rect = { u: [cx - thrH, cx + thrH], v: [vT0, vT1] };
  const rCourt: Rect = { u: [cx - courtH, cx + courtH], v: [vC0, vT0] };
  const rPlat: Rect = { u: [cx - platH, cx + platH], v: [vP0, vC0] };
  const tier = new Uint8Array(g.S * g.S);
  const mark = (tiles: number[], id: number) => { for (const k of tiles) tier[k] = id; };
  mark(K.slab(rThr, H1, { ragged: 0.7, can: (k) => g.kind[k] !== HK.floor }), 1);
  mark(K.slab(rCourt, H2, { ragged: 0.8, can: (k) => g.kind[k] !== HK.floor }), 2);
  mark(K.slab(rPlat, H3, { ragged: 0.6, platform: true, can: (k) => g.kind[k] !== HK.floor }), 3);
  g.shape.axis = +cx.toFixed(1); g.shape.foot = +vF.toFixed(1); g.shape.tiers = +(thrD + courtD + platD).toFixed(1);
  g.shape.platW = +platH.toFixed(1); g.shape.courtW = +courtH.toFixed(1); g.shape.thrW = +thrH.toFixed(1);

  // ---- the hold: the court tangent to the plinth, on the platform ----
  const [ccx, ccy] = C(cx + hx, vHold);
  g.contest = { x: ccx, y: ccy, h: H3, r: r0 };
  g.nodes.contest = [ccx, ccy];

  // ---- the balcony: a ruined upper ledge on the rock shoulder, the strongest upper position ----
  const balU0 = cx + sgB * (platH - 0.5), balU1 = cx + sgB * (platH + balW);
  const rBal: Rect = { u: [Math.min(balU0, balU1), Math.max(balU0, balU1)], v: [balV0, balV0 + balLen] };
  const balTiles = K.slab(rBal, balH, { kind: HK.shelf, can: (k) => g.kind[k] === HK.mass });
  mark(balTiles, 4);
  // the stair up to it from the platform's front corner (baseline walking: a counter-angle both sides reach)
  const balStairV = balV0 + balLen - 3;
  K.walkway([[cx + sgB * (platH - 5.4), balStairV, H3], [cx + sgB * (platH + 1.2), balStairV, balH]], W, { kind: HK.ramp, keep: 1, can: (k) => !g.lock[k] && g.kind[k] !== HK.fluid && (g.kind[k] !== HK.mass || tier[k] === 0) });

  // ---- each side's approaches ----
  for (const s of sides) {
    const { team, sg } = s;
    const stage = C(cx + sg * s.stU, s.stV);
    for (const id of ['stage', 'spawn', 'exit']) g.nodes[id + team] = stage;
    g.disc(stage[0], stage[1], 6, (k) => { if (g.kind[k] !== HK.fluid) { g.keep[k] = 1; } });

    // direct: the external switchback cut into the massif's flank (two legs and a hairpin), onto the threshold terrace,
    // along it to the axis, up the threshold stair, along the forecourt's lane, up the platform stair, onto the court
    const A1 = approach(g, team, 'direct', 'external switchback, threshold stair, forecourt lane, platform stair');
    const hs = H1 * 0.5, y1 = vF - s.leg;
    path(g, [wp(cx + sg * s.stU, s.stV, 0), wp(s.x1, vF + 3.5, 0), wp(s.x1, y1, hs), wp(s.x2, y1, hs), wp(s.x2, y1 + 4.5, H1), wp(cx + sg * (thrH - 3), y1 + 4.5, H1), wp(cx, y1 + 4.5, H1), wp(cx, vT0 + 7.5, H1)],
      { w: W, approach: A1, keep: 1, can: canCut });
    path(g, [wp(cx, vT0 + 7.5, H1), wp(cx, vT0 - 1.5, H2), wp(cx, vC0 + 7.5, H2), wp(cx, vC0 - 1.5, H3), wp(cx + hx, vHold, H3)], { w: W, approach: A1, keep: 1, can: canCut });

    // flank: the dry bedrock gallery. A mouth at the massif's foot, a climb inside the rock to the platform's height, then
    // across to a door in the platform's flank (on the balcony's side: behind it, at the rear, screened by its wall)
    const A2 = approach(g, team, 'flank', 'dry bedrock gallery, door onto the platform');
    const top: Pt = [s.gu, vF - 0.5 - s.climb], doorIn: Pt = [cx + sg * (platH + 2), s.doorV];
    const mid: Pt = s.rear ? [lerp(top[0], doorIn[0], 0.62), s.doorV + 2.2] : [lerp(top[0], doorIn[0], 0.5), lerp(top[1], doorIn[1], 0.5)];
    path(g, [wp(cx + sg * s.stU, s.stV, 0), wp(s.gu, vF + 4, 0)], { w: W, approach: A2, keep: 1, can: canCut });
    tunnel(g, [wp(s.gu, vF + 3, 0), wp(s.gu, vF - 0.5, 0), wp(top[0], top[1], H3), wp(mid[0], mid[1], H3), wp(doorIn[0], doorIn[1], H3)], W, A2);
    path(g, [wp(doorIn[0], doorIn[1], H3), wp(cx + sg * (platH - 5), s.doorV, H3), wp(cx + hx + sg * 6, lerp(s.doorV, vHold, 0.8), H3), wp(cx + hx, vHold, H3)], { w: W, approach: A2, keep: 1, can: canCut });
    g.shape[`door${team}`] = +s.doorV.toFixed(1); g.shape[`climb${team}`] = +s.climb.toFixed(1); g.shape[`leg${team}`] = +s.leg.toFixed(1);
  }

  // ---- rock outcrops on the foothill, off every tread: cover between the stagings and the tarn (boulder family) ----
  for (const s of sides) {
    const o = fr('outcropU'), ov = vF + fr('outcropV');
    const sp = spur(g, [C(cx + s.sg * o, ov), C(cx + s.sg * (o - 2.6), ov + 1.2)], 2.4, 1.8, (k) => !g.lock[k] && !g.keep[k] && g.kind[k] === HK.floor);
    for (const k of sp) g.lock[k] = 1;
    g.shape[`outcrop${s.team}`] = sp.length;
  }

  // ---- the ruin assemblies (ruins.ts): the focal court on the platform, the gateway, the forecourt's and threshold's columns ----
  const focal = focalCourt(K, {
    axis: cx, v0: vP0, v1: vC0, half: platH, plinthW: plW, plinthD: plD, plinthTop: plV0 - vP0, plinthRise: x.plinthRise, spearRise: x.spearRise,
    flank: { offset: 12.8, pitch: x.flankPitch, rise: x.flankRise, phase: x.flankPhase, broken: (i, row) => (i * 3 + row) % 7 === 1 },
    // (the balustrade is laid from the shoulder's end: unbroken over the balcony's reach, so the balcony cannot fire down the stairs)
    shoulder: sgB, balustradeRise: 0.9, balustradeGaps: [[x.gp, x.gp + 0.1], [x.gp2, x.gp2 + 0.08]],
  });
  const rPlinth = focal.plinth;
  const [lmx, lmy] = C(...focal.landmark);
  g.landmark = { x: lmx, y: lmy, name: g.recipe.props.landmark };
  gateway(K, { axis: cx, v: vT0, pylon: 3.6, wall: 1.3, wallLen: x.gateWall });
  const gone = (i: number, row: number) => ((i * 7 + row * 5 + Math.floor(wob / 3)) % 11) / 11 < x.broken;
  colonnadeCourt(K, { axis: cx, rows: [9.5, 16.5], v0: vC0 + 3.5, v1: vT0 - 2, pitch: x.pitch, rise: x.colRise, phase: x.phase, broken: gone });
  colonnadeCourt(K, { axis: cx, rows: [11, 19], v0: vT0 + 2, v1: vT0 + 9, pitch: 5.5, rise: x.colRise - 0.6, phase: x.thrPhase, broken: (i, row) => (i + row) % 5 === 2 });

  // ---- the balcony's parapet (broken: the firing edge) and the wall that screens it from the gallery's door ----
  const innerU = balU0 + sgB * 0.5;
  K.wall([[innerU, balV0 + 2], [innerU, balV0 + balLen - 4.5]], 1.1, { gaps: [[0.2, 0.34], [0.52, 0.66], [0.8, 0.9]] });
  K.wall([[balU0 + sgB * 0.5, balV0 + 0.5], [balU0 + sgB * (balW - 0.5), balV0 + 0.5]], 1.4);

  // the occluding wall: across the platform's rear corner on the shoulder's side, between the balcony's firing edge and the
  // gallery's door route (it leaves the route's own width open: reserved tiles are never walled)
  K.wall([[cx + sgB * (plW / 2 + 1.8), balV0 - 1.2], [cx + sgB * (platH - 0.5), balV0 - 1.2]], 1.5);

  // ---- the side court off the forecourt, opposite the shoulder: its wall has a seeded opening ----
  const cs = (-sgB) as -1 | 1;
  const cU0 = cx + cs * courtH, cU1 = cx + cs * (courtH + courtW);
  const rCt: Rect = { u: [Math.min(cU0, cU1), Math.max(cU0, cU1)], v: [courtV0, courtV0 + courtDp] };
  const ctTiles = K.slab(rCt, H2, { can: (k) => g.kind[k] === HK.mass });
  mark(ctTiles, 2);
  const wallU = cx + cs * (courtH + 0.5);
  const gapT = courtGap, gapE = courtGapW / courtDp;
  K.wall([[wallU, courtV0 + 0.5], [wallU, courtV0 + courtDp - 0.5]], 1.2, { gaps: [[Math.max(0, gapT - gapE / 2), Math.min(1, gapT + gapE / 2)]] });
  K.wall([[cx + cs * (courtH + 3), courtV0 + courtDp - 3], [cx + cs * (courtH + courtW - 2.5), courtV0 + courtDp - 3]], 1.0, { gaps: [[0.4, 0.55]] });
  g.shape.courtGap = +courtGap.toFixed(2); g.shape.courtSide = cs; g.shape.balSide = sgB; g.shape.balLen = +balLen.toFixed(1);
  g.shape.pillars = K.pieces.pillars; g.shape.walls = K.pieces.walls; g.shape.plinths = K.pieces.plinths; g.shape.walkways = K.pieces.walkways; g.shape.slabs = K.pieces.tiers;

  // ---- enemy entry anchors: the foothill, the threshold, the forecourt ----
  g.anchors.push(g.nodes.stageB, C(cx, vF + 18), C(14, vF + 16), C(S1 - 14, vF + 16), C(cx, vT1 - 4), C(cx + cs * 14, vC0 + 14));
  g.m.bossSpot = [Math.floor(ccx), Math.floor(ccy)];

  // the outer border is rock
  for (let y = 0; y < g.S; y++) for (let x = 0; x < g.S; x++) {
    if (x >= 4 && y >= 4 && x < g.S - 4 && y < g.S - 4) continue;
    const k = g.idx(x, y);
    if (g.kind[k] === HK.fluid) continue;
    g.H[k] = Hm + 1.2; g.kind[k] = HK.mass;
  }

  PLANS.set(g, {
    axis: cx, foot: vF, threshold: rThr, forecourt: rCourt, platform: rPlat,
    heights: { foot: 0, threshold: H1, forecourt: H2, platform: H3, balcony: balH },
    sequence: { foot: [cx + 12, vF + 2.4], threshold: [cx + 12, (vT0 + vT1) / 2], forecourt: [cx + 12, (vC0 + vT0) / 2], platform: [cx + 12, (vP0 + vC0) / 2] },
    plinth: rPlinth, hold: [cx + hx, vHold],
    balcony: { side: sgB, rect: rBal, tiles: balTiles, stair: [cx + sgB * platH, balStairV] },
    court: { side: cs, rect: rCt },
    doors: { A: { u: cx - platH, v: sides[0].doorV, rear: sides[0].rear }, B: { u: cx + platH, v: sides[1].doorV, rear: sides[1].rear } },
    tier,
  });
}
