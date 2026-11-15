// How a sanctuary Hold plays differently from a crater Hold, measured on the final collision (no sim steps):
//   npx tsx scripts/habsanct.ts [recipeA=spear-sanctuary] [recipeB=volcanic-ridge] [seeds=6] [firstSeed=1] [--json out.json]
// For each seed and recipe, from the built map alone:
//   entry       the bearing each of the four final approaches arrives at the point from (18 tiles out along its lane), the
//               angle between a side's two approaches, and between the two sides' direct approaches (convergence: ≈ 0° when
//               both sides climb the same stair, ≈ 180° when they come from opposite sides), and the arrival slope (the
//               level 18 tiles out minus the point's: negative = the lane climbs into the point, positive = it drops into it)
//   sightlines  from the point's centre at a 0.9 m muzzle, 64 rays: the clear length (m) of each (mean, p90, share under 10 m,
//               share over 25 m), and how far out along each approach's last 60 m the point can see it
//   high ground standable tiles ≥ 2.4 m above the point within 24 m that see it (the counter gate's "high" tiles), the
//               largest rise, how many of 16 compass sectors around the point hold one (its arc), and whether the nearest is
//               reachable by baseline walking from both stagings
import { writeFileSync } from 'node:fs';
import { generateHabitat, profilesFor } from '../src/world/habitat';
import { clearance, sightAbs } from '../src/world/habitat/validate';
import { pathBetween } from '../src/world/locgen/nav';
import { navOpen, navTop } from '../src/world/gen/util';
import type { ArenaMap } from '../src/world/tiles';

export interface Geo {
  recipe: string; seed: number;
  /** degrees: [A.direct, A.flank, B.direct, B.flank] bearings at 18 tiles out */
  bearing: number[];
  within: number[]; convergence: number; sectors: number;
  slope: number[];
  ray: { mean: number; p90: number; max: number; short: number; long: number };
  seen: number[];
  high: { tiles: number; rise: number; arc: number; reach: boolean };
}

const deg = (r: number) => ((r * 180) / Math.PI + 360) % 360;
const sep = (a: number, b: number) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

export function analyse(recipe: string, seed: number): Geo {
  const m: ArenaMap = generateHabitat({ recipe, seed });
  const H = m.gen!.hab!, W = m.w, n = W * m.h, N = m.over ? 2 * n : n;
  const cl = clearance(m), profiles = profilesFor();
  const rMax = Math.max(...profiles.filter((p) => p.essential).map((p) => p.radius));
  const fit = new Uint8Array(N), fitT = new Uint8Array(N), rT = profiles.find((p) => p.id === 'trainer')!.radius;
  for (let v = 0; v < N; v++) { fit[v] = cl[v] >= rMax - 1e-6 && !H.hazard.includes(v % n) ? 1 : 0; fitT[v] = cl[v] >= rT - 1e-6 ? 1 : 0; }
  const tile = (p: [number, number]) => Math.floor(p[1]) * W + Math.floor(p[0]);
  const stage = { A: tile(H.stage.A), B: tile(H.stage.B) }, c = tile([H.contest.x, H.contest.y]);
  const route = m.gen!.route!;
  const lane = (team: 'A' | 'B', kind: 1 | 2): number[] | null => {
    // the shortest walk inside the corridor of this kind of approach (2 tiles round it, and 12 round the staging)
    const allow = new Uint8Array(N), s = stage[team], sx = s % W, sy = (s / W) | 0;
    for (let v = 0; v < N; v++) {
      const k = v % n, x = k % W, y = (k / W) | 0;
      if (!fit[v]) continue;
      let ok = Math.hypot(x - sx, y - sy) <= 12 || Math.hypot(x + 0.5 - H.contest.x, y + 0.5 - H.contest.y) <= H.contest.r + 3;
      for (let dy = -2; dy <= 2 && !ok; dy++) for (let dx = -2; dx <= 2 && !ok; dx++) if (x + dx >= 0 && y + dy >= 0 && x + dx < W && y + dy < m.h && route[(y + dy) * W + x + dx] === kind) ok = true;
      allow[v] = ok ? 1 : 0;
    }
    return pathBetween(m, s, c, allow);
  };
  const lanes = [lane('A', 1), lane('A', 2), lane('B', 1), lane('B', 2)];
  const level = (v: number) => (m.over && v >= n ? m.over[v - n] : navTop(m, v));
  const out = (p: number[] | null, back: number) => p ? p[Math.max(0, p.length - 1 - back)] : -1;
  const bearing = lanes.map((p) => { const v = out(p, 18); if (v < 0) return NaN; const k = v % n; return deg(Math.atan2(((k / W) | 0) + 0.5 - H.contest.y, (k % W) + 0.5 - H.contest.x)); });
  const slope = lanes.map((p) => { const v = out(p, 18); return v < 0 ? NaN : +(level(v) - H.contest.h).toFixed(1); });
  const within = [sep(bearing[0], bearing[1]), sep(bearing[2], bearing[3])];
  const convergence = sep(bearing[0], bearing[2]);
  const sectors = new Set(bearing.map((b) => Math.floor(b / 45))).size;

  // sightlines from the point's centre
  const cx = H.contest.x, cy = H.contest.y, y0 = navTop(m, c) + 0.9, rays: number[] = [];
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * Math.PI * 2, dx = Math.cos(a), dy = Math.sin(a);
    let len = 0;
    for (let s = 1; s <= 60; s++) { if (!sightAbs(m, cx, cy, y0, cx + dx * s, cy + dy * s, y0)) break; len = s; }
    rays.push(len);
  }
  rays.sort((a, b) => a - b);
  const ray = { mean: +(rays.reduce((a, b) => a + b, 0) / rays.length).toFixed(1), p90: rays[Math.floor(rays.length * 0.9)], max: rays[rays.length - 1], short: +(rays.filter((r) => r < 10).length / rays.length).toFixed(2), long: +(rays.filter((r) => r > 25).length / rays.length).toFixed(2) };
  // how much of each approach's last 60 m the point sees
  const seen = lanes.map((p) => {
    if (!p) return NaN;
    let tot = 0, vis = 0;
    for (let i = p.length - 1; i >= 0 && tot < 60; i--) {
      const k = p[i] % n, tx = (k % W) + 0.5, ty = ((k / W) | 0) + 0.5;
      tot++;
      if (sightAbs(m, cx, cy, y0, tx, ty, level(p[i]) + 0.9)) vis++;
    }
    return +(vis / Math.max(1, tot)).toFixed(2);
  });

  // high ground overlooking the point
  const eyeHi = Math.max(...profiles.filter((p) => p.id.startsWith('trainer')).map((p) => p.eye[1]));
  let tiles = 0, rise = 0;
  const arc = new Set<number>();
  let nearest = { k: -1, d: Infinity };
  for (let k = 0; k < n; k++) {
    if (!navOpen(m, k)) continue;
    const px = (k % W) + 0.5, py = ((k / W) | 0) + 0.5, d = Math.hypot(px - cx, py - cy), h = navTop(m, k);
    if (d > 24 || h < H.contest.h + 2.4) continue;
    if (!sightAbs(m, px, py, h + eyeHi, cx, cy, H.contest.h + 0.9)) continue;
    tiles++; rise = Math.max(rise, h - H.contest.h); arc.add(Math.floor(deg(Math.atan2(py - cy, px - cx)) / 22.5));
    if (d < nearest.d) nearest = { k, d };
  }
  let reach = false;
  if (nearest.k >= 0) reach = !!pathBetween(m, stage.A, nearest.k, fitT) && !!pathBetween(m, stage.B, nearest.k, fitT);
  return { recipe, seed, bearing: bearing.map((b) => Math.round(b)), within: within.map(Math.round), convergence: Math.round(convergence), sectors, slope, ray, seen, high: { tiles, rise: +rise.toFixed(1), arc: arc.size, reach } };
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

if (process.argv[1]?.endsWith('habsanct.ts')) {
  const pos = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--json');
  const A = pos[0] ?? 'spear-sanctuary', B = pos[1] ?? 'volcanic-ridge', N = Number(pos[2] ?? 6), first = Number(pos[3] ?? 1);
  const all: Record<string, Geo[]> = {};
  for (const id of [A, B]) {
    all[id] = [];
    for (let s = first; s < first + N; s++) all[id].push(analyse(id, s));
    const g = all[id];
    console.log(`\n${id} (${N} seeds from ${first})`);
    console.log(`  entry      within-side ${mean(g.flatMap((x) => x.within)).toFixed(0)}° (min ${Math.min(...g.flatMap((x) => x.within))}°)   direct-vs-direct ${mean(g.map((x) => x.convergence)).toFixed(0)}° (range ${Math.min(...g.map((x) => x.convergence))}-${Math.max(...g.map((x) => x.convergence))}°)   sectors used ${mean(g.map((x) => x.sectors)).toFixed(1)}/8`);
    console.log(`  arrival    direct ${mean(g.flatMap((x) => [x.slope[0], x.slope[2]])).toFixed(1)} m, flank ${mean(g.flatMap((x) => [x.slope[1], x.slope[3]])).toFixed(1)} m (level 18 tiles out minus the point's)`);
    console.log(`  sightlines mean ${mean(g.map((x) => x.ray.mean)).toFixed(1)} m  p90 ${mean(g.map((x) => x.ray.p90)).toFixed(1)} m  max ${Math.max(...g.map((x) => x.ray.max))} m  short(<10) ${(mean(g.map((x) => x.ray.short)) * 100).toFixed(0)} %  long(>25) ${(mean(g.map((x) => x.ray.long)) * 100).toFixed(0)} %  point sees ${(mean(g.flatMap((x) => x.seen)) * 100).toFixed(0)} % of each approach's last 60 m`);
    console.log(`  high       ${mean(g.map((x) => x.high.tiles)).toFixed(0)} tiles ≥ 2.4 m up, rise ${mean(g.map((x) => x.high.rise)).toFixed(1)} m, arc ${mean(g.map((x) => x.high.arc)).toFixed(1)}/16 sectors, baseline-reachable from both sides ${g.filter((x) => x.high.reach).length}/${N}`);
  }
  const j = process.argv.indexOf('--json');
  if (j > 0) writeFileSync(process.argv[j + 1], JSON.stringify(all, null, 1));
}
