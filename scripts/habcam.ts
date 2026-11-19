// Third-person camera framing and occlusion along a Hold approach (no GL): drives the trainer along an approach on a habitat
// map and feeds the chase rig exactly as the renderer does (interpolated player, the same world probes via render/chaseinput.ts).
// It reads the rig and never changes it (docs/THIRD_PERSON.md).
//   npx tsx scripts/habcam.ts <river-gorge|volcanic-ridge> [seeds] [--route direct|flank|both] [--yaw ahead|fixed|side|all] [--species totodile] [-v]
// Per approach and per stretch kind (open ground, ramp, bridge or causeway deck, arch, tunnel) it reports:
//   boom%    the boom actually used as a share of the largest boom seen on the same walk (100 = nothing in the way)
//   gapMin   the closest the lens came to the pivot (m); under ~0.95 the Pokémon dissolves, under 0.45 it is 75 % gone
//   hidden%  frames where terrain (ground, a cliff, a deck slab) stands between the lens and the Pokémon's chest; props are not
//            counted: the renderer dithers a prop between the lens and the Pokémon away
//   ahead    how far along the approach the trainer can see from the lens: the median and the 10th percentile of the length
//            of route (m, at 0.5 m) visible before the first point hidden by terrain; a short "ahead" is a blind corner
//   pops     ticks the safety net slid the lens in
//   fpsDev   (printed, but unreliable: use scripts/camstats.ts --fps 60,144 for the frame-rate dependence of the rig)
import { ChaseRig } from '../src/render/camera';
import { chaseFrameFor } from '../src/render/chaseinput';
import { createRun, step } from '../src/sim/run';
import { clearance } from '../src/world/habitat/validate';
import { pathBetween } from '../src/world/locgen/nav';
import { NO_INPUT, type SimContext } from '../src/sim/types';
import { T } from '../src/world/tiles';

const arg = (k: string, d: string) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const D2R = Math.PI / 180;

type Kind = 'open' | 'ramp' | 'deck' | 'tunnel';
const KINDS: Kind[] = ['open', 'ramp', 'deck', 'tunnel'];

interface Frame { px: number; pz: number; yaw: number; kind: Kind; boom: number; gap: number; hidden: boolean; ahead: number; eye: [number, number, number]; tile: number }

/** a calm run on a habitat map (every region is the recipe), as the Hold approach walks use it */
export function habitatRun(recipe: string, seed: number, species: string): SimContext {
  return createRun({ seed: 1, species, ruleOverrides: { worldgen: { mode: 'generated', regionSeed: seed, locations: { meadow: recipe, dusk: recipe, badlands: recipe, frost: recipe } }, objectives: { firstAfter: 1e9, secondAfter: 1e9 }, director: { spawnBase: -99 } } as never });
}

/** walk the trainer from the spawn to the contest point along the direct or the flank approach with the real player
 *  physics; null when the walk does not get there */
export function walkPath(ctx: SimContext, which: 'direct' | 'flank'): { path: number[]; ticks: { x: number; y: number; z: number; vx: number; vz: number; tile: number; g: boolean }[] } | null {
  const W = ctx.world, m = W.map, n = W.w * W.h, H = W.hab!, cl = clearance(m), N = cl.length;
  const allow = new Uint8Array(N); for (let v = 0; v < N; v++) allow[v] = cl[v] >= 0.75 ? 1 : 0;
  if (W.hazard) for (let k = 0; k < n; k++) if (W.hazard[k]) allow[k] = 0;
  const from = m.spawn[1] * W.w + m.spawn[0], to = Math.floor(H.contest.y) * W.w + Math.floor(H.contest.x);
  const first = pathBetween(m, from, to, allow); if (!first) return null;
  let path = first;
  if (which === 'flank') {
    const a = new Uint8Array(allow);
    for (const v of first) { const k = v % n, x = k % W.w, y = (k / W.w) | 0; if (Math.hypot(x - H.contest.x, y - H.contest.y) <= H.contest.r + 3 || Math.hypot(x - m.spawn[0], y - m.spawn[1]) <= 12) continue; for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const q = (y + dy) * W.w + x + dx; a[q] = 0; if (N > n) a[n + q] = 0; } }
    const p2 = pathBetween(m, from, to, a); if (!p2) return null; path = p2;
  }
  // walk it with the real player physics (a few nodes of look-ahead, never over a ledge: as scripts/habtac.ts)
  const P = ctx.player, ticks: { x: number; y: number; z: number; vx: number; vz: number; tile: number; g: boolean }[] = [];
  let i = 0, lastBest = 0, lastT = 0;
  for (let t = 0; t < 60 * 90 && i < path.length - 2; t++) {
    let near = i, nd = Infinity;
    for (let j = i; j < Math.min(path.length, i + 30); j++) { const k = path[j] % n, x = (k % W.w) - W.half + 0.5, z = ((k / W.w) | 0) - W.half + 0.5, d = Math.hypot(x - P.x, z - P.z); if (d < nd) { nd = d; near = j; } }
    i = near; if (i > lastBest) { lastBest = i; lastT = ctx.time; } else if (ctx.time - lastT > 6) return null;
    let tk = path[Math.min(path.length - 1, i + 1)] % n;
    for (let ahead = 4; ahead >= 1; ahead--) {
      const c = path[Math.min(path.length - 1, i + ahead)] % n, cx = (c % W.w) - W.half + 0.5, cz = ((c / W.w) | 0) - W.half + 0.5;
      let clear = true, feet = P.y; const L0 = Math.hypot(cx - P.x, cz - P.z), steps = Math.ceil(L0 / 0.25);
      for (let s = 1; s <= steps && clear; s++) { const x = P.x + ((cx - P.x) * s) / steps, z = P.z + ((cz - P.z) * s) / steps; for (const [ox, oz] of [[0, 0], [0.45, 0], [-0.45, 0], [0, 0.45], [0, -0.45]]) if (W.blocks(x + ox, z + oz, feet, 0.6) || W.hazardAt(x + ox, z + oz)) { clear = false; break; } if (clear) { feet = Math.max(W.height(x, z, feet), feet - 0.6); if (P.y - W.height(x, z, feet) > 0.6 * (s * 0.25) + 0.5) clear = false; } }
      if (clear) { tk = c; break; }
    }
    const tx = (tk % W.w) - W.half + 0.5, tz = ((tk / W.w) | 0) - W.half + 0.5, dx = tx - P.x, dz = tz - P.z, L = Math.hypot(dx, dz) || 1;
    step(ctx, { ...NO_INPUT, mx: dx / L, mz: dz / L });
    ticks.push({ x: P.x, y: P.y, z: P.z, vx: P.vx, vz: P.vz, tile: W.tile(P.x, P.z), g: P.grounded });
  }
  return i >= path.length - 2 ? { path, ticks } : null;
}

/** terrain (ground, platforms, deck slabs) between two points: props are left out on purpose, because the renderer dithers a
 *  prop that stands between the lens and the Pokémon away (World.sight counts them as walls and would overstate occlusion) */
function terrainBlocks(ctx: SimContext, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): boolean {
  const W = ctx.world, dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz), n = Math.floor(L / 0.4);
  for (let s = 1; s < n; s++) {
    const t = (s * 0.4) / L, x = x0 + dx * t, z = z0 + dz * t, y = y0 + (y1 - y0) * t, k = W.tile(x, z);
    if (k < 0) return true;
    const ov = W.map.over ? W.map.over[k] : 0;
    if (ov > 0 && y >= ov - 0.9) { if (ov > y) return true; continue; }
    if (W.height(x, z) > y) return true;
  }
  return false;
}

/** what the trainer is standing in: a deck (bridge, causeway, arch), a tunnel (rock on two opposite sides), a ramp, or open ground */
function kindAt(ctx: SimContext, k: number, y: number, dy: number): Kind {
  const W = ctx.world, m = W.map;
  if ((m.over && m.over[k] > 0 && y >= m.over[k] - 0.9) || m.terrain[k] === T.wood) return 'deck';
  const i = k % W.w, j = (k / W.w) | 0;
  const rock = (ii: number, jj: number) => { if (ii < 0 || jj < 0 || ii >= W.w || jj >= W.h) return true; const q = jj * W.w + ii; return m.wall[q] === 1 || m.elev[q] + m.platform[q] > y + 1.8; };
  const side = (dx: number, dz: number) => { for (let s = 1; s <= 3; s++) if (rock(i + dx * s, j + dz * s)) return true; return false; };
  if ((side(1, 0) && side(-1, 0)) || (side(0, 1) && side(0, -1))) return 'tunnel';
  return Math.abs(dy) > 0.05 ? 'ramp' : 'open';
}

export interface Shot { map: string; seed: number; route: string; yawMode: string; kind: string; tile: string; yaw: number; boomPct: number; why: string }
export interface CamRow { map: string; seed: number; route: string; yaw: string; kind: Kind; frames: number; boomPct: number; boomMin: number; gapMin: number; hiddenPct: number; aheadMed: number; ahead10: number; pops: number; fpsDev: number; worst: { tile: string; why: string } | null }

export function walkCamera(recipe: string, seed: number, route: 'direct' | 'flank', yawMode: 'ahead' | 'fixed' | 'side', species: string, fps = 60): { rows: CamRow[]; ok: boolean; shots: Shot[] } {
  const ctx = habitatRun(recipe, seed, species);
  const W = ctx.world, P = ctx.player;
  const walked = walkPath(ctx, route);
  if (!walked) return { rows: [], ok: false, shots: [] };
  const { path, ticks } = walked, n = W.w * W.h;
  // the camera: the same walk, the rig at `fps`, the lens yaw following the policy
  const view = (fpsRun: number) => {
    const rig = new ChaseRig(), out: Frame[] = [];
    rig.snapTo(ticks[0].x, ticks[0].y, ticks[0].z, Math.PI);
    let acc = 0, ti = 0, yaw = Math.PI;
    const dtF = 1 / fpsRun;
    while (ti < ticks.length - 2) {
      acc += dtF; while (acc >= ctx.dt - 1e-9 && ti < ticks.length - 2) { ti++; acc -= ctx.dt; }
      const a = Math.max(0, Math.min(1, acc / ctx.dt)), p = ticks[ti], q = ticks[Math.min(ticks.length - 1, ti + 1)];
      const px = p.x + (q.x - p.x) * a, py = p.y + (q.y - p.y) * a, pz = p.z + (q.z - p.z) * a;
      // the travel direction over the last second (smoothed): where a player would be looking when they steer by the camera
      const back = ticks[Math.max(0, ti - 30)], ahead = ticks[Math.min(ticks.length - 1, ti + 30)];
      const hx = ahead.x - back.x, hz = ahead.z - back.z, hl = Math.hypot(hx, hz);
      const want = yawMode === 'fixed' ? Math.PI : hl > 0.5 ? Math.atan2(hx, hz) + (yawMode === 'side' ? Math.PI / 2 : 0) : yaw;
      // a player turns the camera at most ~3 rad/s
      let d = Math.atan2(Math.sin(want - yaw), Math.cos(want - yaw)); const maxd = 3 * dtF; d = Math.max(-maxd, Math.min(maxd, d)); yaw += d;
      rig.yaw = yaw;
      rig.update(chaseFrameFor(ctx, { dt: dtF, x: px, y: py, z: pz, lookPitch: 0, grounded: p.g && q.g }));
      const k = W.tile(p.x, p.z), dy = q.y - p.y;
      // terrain between the lens and the Pokémon's chest
      const cx = rig.px, cy = rig.py + rig.pivotH, cz = rig.pz;
      const hidden = terrainBlocks(ctx, rig.eye[0], rig.eye[1], rig.eye[2], cx, cy, cz);
      // how much of the approach ahead the lens can see (route points up to 14 m on)
      let seen = 0;
      let i0 = 0; for (let j = 0; j < path.length; j++) { const kk = path[j] % n, x = (kk % W.w) - W.half + 0.5, z = ((kk / W.w) | 0) - W.half + 0.5; if (Math.hypot(x - px, z - pz) < 1.2) { i0 = j; break; } }
      let acc2 = 0;
      for (let j = i0 + 1; j < path.length && acc2 < 14; j++) {
        const k1 = path[j - 1] % n, k2 = path[j] % n, x1 = (k1 % W.w) - W.half + 0.5, z1 = ((k1 / W.w) | 0) - W.half + 0.5, x2 = (k2 % W.w) - W.half + 0.5, z2 = ((k2 / W.w) | 0) - W.half + 0.5;
        acc2 += Math.hypot(x2 - x1, z2 - z1);
        const ty = (path[j] >= n ? m2(ctx).over![path[j] - n] : W.height(x2, z2)) + 0.5;
        if (terrainBlocks(ctx, rig.eye[0], rig.eye[1], rig.eye[2], x2, ty, z2)) break;
        seen = acc2;
      }
      out.push({ px, pz, yaw, kind: kindAt(ctx, k, py, dy), boom: rig.boomUsed, gap: rig.lensGap, hidden, ahead: seen, eye: rig.eye.slice() as [number, number, number], tile: k });
    }
    return { out, pops: rig.groundPops };
  };
  const m2 = (c: SimContext) => c.world.map;
  const base = view(fps), alt = view(144);
  // lens path at 144 fps against 60 fps (same walk), by time
  let fpsDev = 0;
  for (let i = 0; i < base.out.length; i += 6) { const t = i / 60, j = Math.min(alt.out.length - 1, Math.round(t * 144)); const e1 = base.out[i].eye, e2 = alt.out[j].eye; fpsDev = Math.max(fpsDev, Math.hypot(e1[0] - e2[0], e1[1] - e2[1], e1[2] - e2[2])); }
  const boomMax = Math.max(...base.out.map((f) => f.boom));
  const pct = (a: number[], p: number) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
  const rows: CamRow[] = [], shots: Shot[] = [];
  for (const kind of KINDS) {
    const f = base.out.filter((x) => x.kind === kind); if (!f.length) continue;
    const worstF = f.reduce((b, x) => (x.hidden ? x : b), null as Frame | null) ?? f.reduce((b, x) => (x.gap < b.gap ? x : b), f[0]);
    // the frame to replay in a browser: the tightest boom on this kind of stretch (lens nearest the Pokémon), after the first second
    const rf = f.filter((x, i) => i > 20).reduce((b, x) => (x.boom < b.boom ? x : b), f[Math.min(f.length - 1, 20)]);
    shots.push({ map: recipe, seed, route, yawMode, kind, tile: `${rf.tile % W.w},${(rf.tile / W.w) | 0}`, yaw: +rf.yaw.toFixed(3), boomPct: +(100 * rf.boom / boomMax).toFixed(0), why: rf.hidden ? 'terrain between lens and Pokémon' : `lens ${rf.gap.toFixed(2)} m from the pivot` });
    rows.push({ map: recipe, seed, route, yaw: yawMode, kind, frames: f.length, boomPct: +(100 * pct(f.map((x) => x.boom / boomMax), 0.5)).toFixed(0), boomMin: +(100 * Math.min(...f.map((x) => x.boom / boomMax))).toFixed(0), gapMin: +Math.min(...f.map((x) => x.gap)).toFixed(2), hiddenPct: +(100 * f.filter((x) => x.hidden).length / f.length).toFixed(1), aheadMed: +pct(f.map((x) => x.ahead), 0.5).toFixed(1), ahead10: +pct(f.map((x) => x.ahead), 0.1).toFixed(1), pops: base.pops, fpsDev: +fpsDev.toFixed(3), worst: { tile: `${worstF.tile % W.w},${(worstF.tile / W.w) | 0}`, why: worstF.hidden ? 'terrain between lens and Pokémon' : `lens ${worstF.gap.toFixed(2)} m from the pivot` } });
  }
  return { rows, ok: true, shots };
}

if (process.argv[1]?.endsWith('habcam.ts')) {
  const which = process.argv[2] ?? 'river-gorge';
  const seeds = (process.argv[3] && !process.argv[3].startsWith('-') ? process.argv[3] : '3').split(',').map(Number);
  const routes = arg('route', 'both') === 'both' ? ['direct', 'flank'] : [arg('route', 'direct')];
  const yaws = arg('yaw', 'all') === 'all' ? ['ahead', 'fixed', 'side'] : [arg('yaw', 'ahead')];
  const species = arg('species', 'totodile');
  const all: CamRow[] = [], shots: Shot[] = [];
  for (const s of seeds) for (const r of routes) for (const y of yaws) {
    const { rows, ok, shots: sh } = walkCamera(which, s, r as 'direct' | 'flank', y as 'ahead' | 'fixed' | 'side', species);
    if (!ok) { console.log(`${which} seed ${s} ${r} ${y}: could not walk the approach`); continue; }
    all.push(...rows); shots.push(...sh);
  }
  const so = process.argv.indexOf('--shots'); if (so > 0) (await import('node:fs')).writeFileSync(process.argv[so + 1], JSON.stringify(shots, null, 1));
  console.table(all.map((r) => ({ seed: r.seed, route: r.route, yaw: r.yaw, kind: r.kind, frames: r.frames, 'boom% med': r.boomPct, 'boom% min': r.boomMin, gapMin: r.gapMin, 'hidden%': r.hiddenPct, 'ahead med m': r.aheadMed, 'ahead p10 m': r.ahead10, pops: r.pops, fpsDev: r.fpsDev, worst: `${r.worst?.tile} ${r.worst?.why}` })));
}
