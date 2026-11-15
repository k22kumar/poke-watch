// What makes a `sanctuary` map a sanctuary, measured on the finished map (docs/HABITATS.md, "Sanctuary").
//
//   identity     the defining features survived dressing and sealing (a seed that lost one is rejected, never repaired)
//   gates        sanctuary:sequence  the axis keeps its order on the built map: foothill < threshold < forecourt < platform, in
//                                    height and along one line, every side's direct route climbs through them in that order,
//                                    the Hold sits on the platform beside the landmark
//                sanctuary:entry     each side's two approaches reach the platform from a different direction or at a different
//                                    height (the switchback by the axial stairs, the gallery by its door)
//                sanctuary:exit      the way out through the gallery is protected: the balcony (the strongest upper position)
//                                    sees under half of the gallery's doorway (its lane within 8 tiles of the door), and a short drop from the
//                                    balcony to the platform exists (the quick exit)
//                sanctuary:counter   the balcony is a position either side can take and answer: reachable by baseline walking
//                                    from both stagings by a short stair from the platform, and the court sees its edge
import { navOpen, navTop } from '../gen/util';
import type { GateResult } from '../gen/context';
import { pathBetween } from '../locgen/nav';
import type { ArenaMap } from '../tiles';
import { HK, type HabCtx } from './ctx';
import { planOf } from './sanctuary';
import type { BodyProfile } from './types';
import { clearance, sightAbs, type HabReport } from './validate';

const N4: [number, number][] = [[1, 0], [0, 1], [-1, 0], [0, -1]];
/** the arrival test: the two approaches' bearings at the contest differ by at least this (degrees) ... */
export const ENTRY_ANGLE = 40;
/** ... or their heights, a few tiles before the court, by at least this (m) */
export const ENTRY_RISE = 2.5;
/** the balcony's share of the gallery's last stretch it may see (the same bound as a perch's) */
export const EXIT_SEEN = 0.5;
/** the stair from the platform to the balcony: the longest baseline walk from the contest to the balcony's floor (tiles) */
export const COUNTER_WALK = 34;

export function sanctuaryIdentity(g: HabCtx, rep: HabReport): string[] {
  const out: string[] = [];
  const P = planOf(g), n = g.S * g.S, m = g.m;
  if (!P) return ['plan'];
  const count = new Float64Array(5);
  for (let k = 0; k < n; k++) if (P.tier[k] && navOpen(m, k)) count[P.tier[k]]++;
  if (count[1] < 150 || count[2] < 300 || count[3] < 350) out.push('tiers');
  if ((g.shape.pillars ?? 0) < 14) out.push('columns');
  if ((g.shape.plinths ?? 0) < 3 || (g.shape.walls ?? 0) < 4) out.push('plinth');
  let tun = 0;
  for (const A of g.approaches) if (A.kind === 'flank') { let t = 0; for (const k of A.tiles) if (g.kind[k] === HK.tunnel) t++; tun = tun ? Math.min(tun, t) : t; }
  if (tun < 60) out.push('gallery');
  if (count[4] < 40) out.push('balcony');
  let fluid = 0;
  for (let k = 0; k < n; k++) if (g.kind[k] === HK.fluid) fluid++;
  if (fluid < 30) out.push('tarn');
  const drained = rep.gates.find((x) => x.id === 'drainage');
  if (drained && !drained.ok) out.push('drainage');
  return out;
}

const dilate = (m: ArenaMap, tiles: Iterable<number>, r: number): Uint8Array => {
  const out = new Uint8Array(m.w * m.h), W = m.w;
  for (const k of tiles) { const x = k % W, y = (k / W) | 0; for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const i = x + dx, j = y + dy; if (i >= 0 && j >= 0 && i < W && j < m.h) out[j * W + i] = 1; } }
  return out;
};

/** the gates above, on the final collision. `m` is the finished map, `rep` the validator's report (its metrics are extended). */
export function sanctuaryGates(g: HabCtx, m: ArenaMap, rep: HabReport, profiles: BodyProfile[]): GateResult[] {
  const P = planOf(g), out: GateResult[] = [];
  const gate = (id: string, ok: boolean, value: string) => out.push({ id, ok, value });
  if (!P) { gate('sanctuary:sequence', false, 'no plan'); return out; }
  const n = m.w * m.h, W = m.w, S1 = g.S - 1, M = rep.metrics;
  const tileAt = (p: [number, number]) => Math.floor(p[1]) * W + Math.floor(p[0]);
  const at = (u: number, v: number): [number, number] => g.P(u / S1, v / S1);
  const rMax = Math.max(...profiles.filter((p) => p.essential).map((p) => p.radius));
  const clear = clearance(m);
  const fit = new Uint8Array(clear.length);
  for (let v = 0; v < fit.length; v++) fit[v] = clear[v] >= rMax - 1e-6 ? 1 : 0;
  const stage = { A: tileAt(g.nodes.stageA as [number, number]), B: tileAt(g.nodes.stageB as [number, number]) };
  const cT = tileAt([g.contest.x, g.contest.y]);

  // ---- the corridor path of each planned approach (shortest within 2 tiles of its own tiles, and the stagings' funnels) ----
  const lane: Record<string, number[] | null> = {};
  for (const A of g.approaches) {
    const corr = dilate(m, A.tiles, 2), allow = new Uint8Array(fit.length);
    for (let v = 0; v < fit.length; v++) allow[v] = fit[v] && corr[v % n] ? 1 : 0;
    lane[A.id] = pathBetween(m, stage[A.team], cT, allow);
  }

  // ---- sequence ----
  const seq = Object.entries(P.sequence) as [keyof typeof P.sequence, [number, number]][];
  const elev = seq.map(([, [u, v]]) => m.elev[tileAt(at(u, v))]);
  const rising = elev.every((e, i) => i === 0 || e - elev[i - 1] >= 2.4);
  const pts = seq.map(([, [u, v]]) => at(u, v));
  // collinear: every sequence point within 1.5 tiles of the line from the foot's to the platform's
  const [a, b] = [pts[0], pts[3]], len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const off = Math.max(...pts.map(([x, y]) => Math.abs((b[0] - a[0]) * (a[1] - y) - (a[0] - x) * (b[1] - a[1])) / len));
  const inPlat = (() => { const [u, v] = g.Q(g.contest.x, g.contest.y); return u >= P.platform.u[0] && u <= P.platform.u[1] && v >= P.platform.v[0] && v <= P.platform.v[1]; })();
  const lm = g.landmark ? Math.hypot(g.landmark.x - g.contest.x, g.landmark.y - g.contest.y) : Infinity;
  const order: string[] = [];
  for (const team of ['A', 'B'] as const) {
    const p = lane[`${team}.direct`];
    if (!p) { order.push(`${team}: no direct lane`); continue; }
    const seen: number[] = [];
    for (const v of p) { const t = P.tier[v % n]; if (t >= 1 && t <= 3 && seen[seen.length - 1] !== t) seen.push(t); }
    if (seen.join() !== '1,2,3') order.push(`${team}: tiers ${seen.join('>') || 'none'}`);
  }
  M.axisOff = +off.toFixed(2);
  gate('sanctuary:sequence', rising && off <= 1.5 && inPlat && lm <= g.contest.r + 6 && order.length === 0,
    `heights ${elev.map((e) => e.toFixed(1)).join(' < ')} m${rising ? '' : ' (not rising)'}, axis off ${off.toFixed(1)} tiles, hold ${inPlat ? 'on' : 'off'} the platform, landmark ${lm.toFixed(1)} m from it${order.length ? '; ' + order.join('; ') : '; both direct lanes climb threshold > forecourt > platform'}`);

  // ---- entry: different direction or different height ----
  const bearing = (v: number) => { const k = v % n, x = (k % W) + 0.5, y = ((k / W) | 0) + 0.5; return Math.atan2(y - g.contest.y, x - g.contest.x); };
  const lvl = (v: number) => navTop(m, v % n);
  const entries: string[] = [];
  let worstEntry = Infinity;
  for (const team of ['A', 'B'] as const) {
    const d = lane[`${team}.direct`], f = lane[`${team}.flank`];
    if (!d || !f) { entries.push(`${team}: a lane is missing`); continue; }
    const at24 = (p: number[]) => p[Math.max(0, p.length - 1 - 26)];
    let da = Math.abs(bearing(at24(d)) - bearing(at24(f))) % (Math.PI * 2); if (da > Math.PI) da = Math.PI * 2 - da;
    const ang = (da * 180) / Math.PI, dh = Math.abs(lvl(at24(d)) - lvl(at24(f)));
    M[`entry:${team}`] = +ang.toFixed(0); M[`entryRise:${team}`] = +dh.toFixed(1);
    worstEntry = Math.min(worstEntry, ang);
    if (!(ang >= ENTRY_ANGLE || dh >= ENTRY_RISE)) entries.push(`${team}: ${ang.toFixed(0)}° and ${dh.toFixed(1)} m apart`);
  }
  gate('sanctuary:entry', entries.length === 0, entries.length ? entries.join('; ') : `the two approaches of each side arrive ≥ ${ENTRY_ANGLE}° apart or ≥ ${ENTRY_RISE} m apart in height (smallest ${worstEntry.toFixed(0)}°)`);

  // ---- exit: the balcony cannot watch the gallery's last stretch ----
  const bal = P.balcony.tiles.filter((k) => navOpen(m, k));
  const shooters = bal.filter((_, i) => i % 2 === 0);
  const eye = Math.max(...profiles.filter((p) => p.id.startsWith('trainer')).map((p) => p.eye[1]));
  let worstSeen = 0, worstTeam = '';
  for (const team of ['A', 'B'] as const) {
    const f = lane[`${team}.flank`];
    if (!f) continue;
    // the doorway: the gallery's lane within 8 tiles of its door, on the platform's apron and inside the rock
    const door = at(P.doors[team].u, P.doors[team].v), leg: number[] = [];
    for (const v of f) { const k = v % n; if (Math.hypot((k % W) + 0.5 - door[0], ((k / W) | 0) + 0.5 - door[1]) <= 8) leg.push(v); }
    const tgt = leg.filter((_, i) => i % 2 === 0);
    let best = 0;
    for (const s of shooters) {
      const px = (s % W) + 0.5, py = ((s / W) | 0) + 0.5, h = navTop(m, s) + eye;
      let seen = 0;
      for (const t of tgt) { const tx = (t % W) + 0.5, ty = ((t / W) | 0) + 0.5; if ((tx - px) ** 2 + (ty - py) ** 2 <= 30 * 30 && sightAbs(m, px, py, h, tx, ty, navTop(m, t) + 0.9)) seen++; }
      best = Math.max(best, seen / Math.max(1, tgt.length));
    }
    M[`exitSeen:${team}`] = +best.toFixed(2);
    if (best > worstSeen) { worstSeen = best; worstTeam = team; }
  }
  // the quick exit: a balcony edge tile with a platform tile beside it a short drop below (2 to 4 m)
  let drops = 0;
  for (const k of bal) {
    const x = k % W, y = (k / W) | 0;
    for (const [dx, dy] of N4) {
      if (x + dx < 0 || y + dy < 0 || x + dx >= W || y + dy >= m.h) continue;
      const j = (y + dy) * W + x + dx;
      if (P.tier[j] === 3 && navOpen(m, j)) { const d = navTop(m, k) - navTop(m, j); if (d >= 2 && d <= 4) { drops++; break; } }
    }
  }
  M.balconyDrops = drops;
  gate('sanctuary:exit', worstSeen < EXIT_SEEN && drops >= 1, `the balcony sees ${(worstSeen * 100).toFixed(0)} % of the gallery's doorway${worstTeam ? ` (worst ${worstTeam})` : ''} (limit ${EXIT_SEEN * 100} %); ${drops} balcony edge tiles drop 2-4 m onto the platform`);

  // ---- counter: the balcony is a position either side can take, and the court answers it ----
  const top = bal.length ? bal.reduce((best, k) => { const [sx, sy] = at(P.balcony.stair[0], P.balcony.stair[1]); const d = Math.hypot((k % W) + 0.5 - sx, ((k / W) | 0) + 0.5 - sy); return d < best.d ? { k, d } : best; }, { k: -1, d: Infinity }).k : -1;
  const walks: string[] = [];
  let walkMax = 0;
  if (top < 0) walks.push('no balcony floor');
  else {
    for (const team of ['A', 'B'] as const) { const p = pathBetween(m, stage[team], top, fit); if (!p) walks.push(`${team} cannot walk to it`); }
    const pc = pathBetween(m, cT, top, fit);
    walkMax = pc ? pc.length : Infinity;
    if (!pc) walks.push('no walk from the point');
    else if (pc.length > COUNTER_WALK) walks.push(`${pc.length} tiles from the point`);
  }
  // the court answers it: from the contest disc a muzzle sees the balcony's edge (any inner-edge tile) from at least half the sampled tiles
  const edge = bal.filter((k) => { const x = k % W, y = (k / W) | 0; return N4.some(([dx, dy]) => { const i = x + dx, j = y + dy; return i >= 0 && j >= 0 && i < W && j < m.h && P.tier[j * W + i] === 3; }); });
  let samples = 0, sees = 0;
  const lowEye = Math.min(...profiles.filter((p) => p.essential).map((p) => p.eye[0]));
  for (let k = 0; k < n; k++) {
    const x = (k % W) + 0.5, y = ((k / W) | 0) + 0.5;
    if ((x - g.contest.x) ** 2 + (y - g.contest.y) ** 2 > g.contest.r ** 2 || !navOpen(m, k) || (k % 3)) continue;
    samples++;
    for (let i = 0; i < edge.length; i += 2) { const e = edge[i]; if (sightAbs(m, x, y, navTop(m, k) + lowEye, (e % W) + 0.5, ((e / W) | 0) + 0.5, navTop(m, e) + 0.9)) { sees++; break; } }
  }
  const share = samples ? sees / samples : 0;
  M.counterSee = +share.toFixed(2); M.counterWalk = walkMax === Infinity ? 99 : walkMax;
  if (share < 0.5) walks.push(`the court sees its edge from ${(share * 100).toFixed(0)} % of samples`);
  gate('sanctuary:counter', walks.length === 0, walks.length ? walks.join('; ') : `the balcony is ${walkMax} tiles from the point by baseline walking from both stagings, and ${(share * 100).toFixed(0)} % of the court sees its edge`);
  return out;
}
