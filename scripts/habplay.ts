// Scripted playable run on a habitat map, through the real sim (player physics, collision, objectives, hazards):
//   npx tsx scripts/habplay.ts [recipe|all] [seeds] [firstSeed] [--enemies] [--route direct|flank|both]
// For each map: the trainer walks from its spawn to the contest along a route derived from the final collision
// (baseline walking, no jump), triggers the Hold objective on the generated point, holds it to completion, then
// retreats to its staging. With --route both (default) it does this once along each of the side's two approaches
// (the second run is forced to keep away from the first route). Prints arrival times, Hold result and any stall.
// Default: geometry only (the director spawns nothing and the Hold's raid party is removed). --raid: the raid party
// leaves team B's staging and walks to the point (the trainer cannot be hurt; pass = a Raider reached the point, so
// team B's approaches work in the sim). --enemies: everything live; the trainer only moves and holds (it does not fight).
import { createRun, step } from '../src/sim/run';
import { startObjective } from '../src/sim/objectives';
import { HABITATS } from '../src/world/habitat';
import { clearance } from '../src/world/habitat/validate';
import { pathBetween } from '../src/world/locgen/nav';
import { NO_INPUT, type SimContext } from '../src/sim/types';
import { ROLE } from '../src/sim/pools';
import { shoreFor, ventPhase } from '../src/sim/hazards';
import { partnerFootprint } from '../src/rules/sizing';
import { BODY_KINDS, BODY_TEMPLATES } from '../src/rules/materials';
import { sizeLabel, sizeOverride } from './lib/sizeflags';

import { RANGE } from '../src/mods';
import { runEnded } from './lib/ended';
export interface PlayResult { recipe: string; seed: number; route: string; reach: number | null; held: boolean; holdT: number | null; back: number | null; stalls: number; hp: number; note: string; raidAt: number | null;
  /** damage the trainer took from everything (a stampede can arrive) and environment hits (vent ticks, cold dunks, burning or charged tiles) on anyone: none on required travel */
  dmg: number; hazardHits: number; ventSeconds: number;
  /** of those hits: the trainer's, and a Raider's while the Hold is active (its required travel); the rest are creatures that chose to cross (chasing the trainer) */
  trainerHits: number; raiderHits: number }

/** the trainer's movement footprint (0 with size geometry off: then the old fixed 0.45 m probes) */
const trainerFoot = (ctx: SimContext) => partnerFootprint(ctx.player.species, ctx.rules);

/** tiles a resting body (a loose rock, the egg) covers for the trainer: within the body's radius plus the trainer's
 *  footprint of the body's centre. Resting bodies are solid to the player (sim/bodies.ts), so a route through one pins the
 *  driver against it head-on (tidal-cave seed 5: the retreat stalled on a rock at a corridor corner). */
export function bodyTiles(ctx: SimContext): Set<number> {
  const B = ctx.bodies, W = ctx.world, out = new Set<number>(), f = Math.max(0.45, trainerFoot(ctx));
  for (let b = 0; b < B.hi; b++) {
    if (!B.alive[b] || Math.hypot(B.vx[b], B.vz[b]) > 1) continue;
    const R = BODY_TEMPLATES[BODY_KINDS[B.kind[b]]].radius + f;
    for (let z = Math.floor(B.z[b] - R); z <= Math.floor(B.z[b] + R); z++) for (let x = Math.floor(B.x[b] - R); x <= Math.floor(B.x[b] + R); x++) {
      // the tile's nearest point to the body's centre
      const qx = Math.min(x + 1, Math.max(x, B.x[b])), qz = Math.min(z + 1, Math.max(z, B.z[b]));
      if (Math.hypot(qx - B.x[b], qz - B.z[b]) < R - 0.5) { const k = W.tile(x + 0.5, z + 0.5); if (k >= 0) out.add(k); }
    }
  }
  return out;
}

export function routeTo(ctx: SimContext, from: number, to: number, avoid?: Set<number>, minClear = 0.75): number[] | null {
  const m = ctx.world.map, n = m.w * m.h, cl = clearance(m), N = cl.length, need = Math.max(minClear, trainerFoot(ctx));
  const rocks = bodyTiles(ctx);
  rocks.delete(from % n); rocks.delete(to % n);
  const plan = (withBodies: boolean) => {
    const allow = new Uint8Array(N);
    for (let v = 0; v < N; v++) allow[v] = cl[v] >= need && !(avoid && avoid.has(v % n)) && !(withBodies && rocks.has(v % n)) ? 1 : 0;
    if (ctx.world.hazard) for (let k = 0; k < n; k++) if (ctx.world.hazard[k]) { allow[k] = 0; }
    return pathBetween(m, from, to, allow);
  };
  // round resting bodies when there is a way round; through them only when there is none (a Power move would clear it)
  return plan(true) ?? plan(false);
}

/** drive the player along a node path; returns seconds taken or null if it stalls past the budget */
export function drive(ctx: SimContext, path: number[], budget: number, stall: { n: number }, each?: () => void): number | null {
  const W = ctx.world, n = W.w * W.h, P = ctx.player, t0 = ctx.time, Bd = ctx.bodies;
  // the straight-line test samples the trainer's footprint (0.45 m with size geometry off) and keeps clear of resting bodies
  const pf = Math.max(0.45, trainerFoot(ctx)), probes = [[0, 0], [pf, 0], [-pf, 0], [0, pf], [0, -pf]];
  let i = 0, lastProgress = ctx.time, best = Infinity;
  while (ctx.time - t0 < budget) {
    if (runEnded(ctx)) return null; // ended: no arrival (drive's callers report a missing time as a failure)
    // shoved into a liquid (hazards on: crowds and knockback can do that): swim to the nearest shore, then re-plan the
    // rest of the route from wherever that is
    const shore = shoreFor(ctx);
    if (shore) {
      const sx = shore[0] - P.x, sz = shore[1] - P.z, sl = Math.hypot(sx, sz) || 1;
      each?.();
      step(ctx, { ...NO_INPUT, mx: sx / sl, mz: sz / sl });
      if (ctx.state === 'dead') return null;
      if (!shoreFor(ctx)) {
        const here = W.tile(P.x, P.z), goal = path[path.length - 1] % n;
      const re = routeTo(ctx, here, goal) ?? routeTo(ctx, here, goal, undefined, 0.45); // a narrow bank under a causeway has less than a trainer's width of clearance
        if (re) { path = re; i = 0; best = Infinity; lastProgress = ctx.time; }
      }
      continue;
    }
    // the next waypoint: a few nodes ahead of the nearest one, counting a difference in level as distance. Knocked onto
    // a ledge on the retreat (forest-cemetery seed 1), the nearest node in plan was on the plateau 0.9 m above, half a
    // metre away and many nodes along the route, and the driver steered at the face below it for good
    let near = i, nd = Infinity;
    for (let j = i; j < Math.min(path.length, i + 30); j++) {
      const v = path[j], k = v % n, x = (k % W.w) - W.half + 0.5, z = ((k / W.w) | 0) - W.half + 0.5;
      const h = v >= n ? W.height(x, z, 1e9) : W.height(x, z), d = Math.hypot(x - P.x, z - P.z) + Math.max(0, Math.abs(h - P.y) - 0.6) * 4;
      if (d < nd) { nd = d; near = j; }
    }
    i = near;
    if (i >= path.length - 2 && nd < 1.2) return ctx.time - t0;
    // steer at the farthest of the next few nodes reachable in a straight walkable line (never cut a corner over water)
    let tk = path[Math.min(path.length - 1, i + 1)] % n;
    for (let ahead = 4; ahead >= 1; ahead--) {
      const c = path[Math.min(path.length - 1, i + ahead)] % n, cx = (c % W.w) - W.half + 0.5, cz = ((c / W.w) | 0) - W.half + 0.5;
      let clear = true, feet = P.y;
      const L0 = Math.hypot(cx - P.x, cz - P.z), steps = Math.ceil(L0 / 0.25);
      for (let s = 1; s <= steps && clear; s++) {
        const x = P.x + ((cx - P.x) * s) / steps, z = P.z + ((cz - P.z) * s) / steps;
        for (const [ox, oz] of probes) if (W.blocks(x + ox, z + oz, feet, 0.6) || W.hazardAt(x + ox, z + oz)) { clear = false; break; }
        // and never off a ledge: a corner cut along a plateau edge dropped the trainer onto the ledge below (forest-cemetery 1)
        if (clear && W.height(x, z, feet) < feet - 0.6) clear = false;
        if (clear) for (let b = 0; b < Bd.hi; b++) if (Bd.alive[b] && Math.hypot(Bd.vx[b], Bd.vz[b]) <= 1 && Math.hypot(Bd.x[b] - x, Bd.z[b] - z) < BODY_TEMPLATES[BODY_KINDS[Bd.kind[b]]].radius + pf) { clear = false; break; }
        if (clear) feet = Math.max(W.height(x, z, feet), feet - 0.6);
      }
      if (clear) { tk = c; break; }
    }
    const tx = (tk % W.w) - W.half + 0.5, tz = ((tk / W.w) | 0) - W.half + 0.5;
    const dx = tx - P.x, dz = tz - P.z, L = Math.hypot(dx, dz) || 1;
    const remaining = path.length - i;
    if (remaining < best - 0.5) { best = remaining; lastProgress = ctx.time; }
    if (ctx.time - lastProgress > 4) {
      stall.n++; lastProgress = ctx.time;
      if (process.env.HABPLAY_DEBUG) { const k = W.tile(P.x, P.z); console.log('stall at tile', k % W.w, (k / W.w) | 0, 'y', P.y.toFixed(2), 'target', tk % W.w, (tk / W.w) | 0, 'node', path[Math.min(path.length - 1, i + 1)] >= n ? 'deck' : 'ground'); }
      // knocked off a causeway into the river (a Water type is a safe swimmer, so the shore rescue above never fires) or onto
      // the floor under a ledge: plan again from where the trainer is (tested: gorge seed 5, raid party live, retreat by the flank)
      const here = W.tile(P.x, P.z), goal = path[path.length - 1] % n;
      const re = routeTo(ctx, here, goal) ?? routeTo(ctx, here, goal, undefined, 0.45); // a narrow bank under a causeway has less than a trainer's width of clearance
      if (re && re.length > 1) { path = re; i = 0; best = Infinity; }
    }
    each?.();
    step(ctx, { ...NO_INPUT, mx: dx / L, mz: dz / L });
    if (ctx.state === 'dead') return null;
  }
  return null;
}

/** `prepare` runs on the fresh run before the route is derived (transitions the match permits: strip the props, freeze the river) */
export function playHabitat(recipe: string, seed: number, opts: { enemies?: boolean; raid?: boolean; route?: 'direct' | 'flank' | 'both'; prepare?: (ctx: SimContext) => void; rules?: object } = {}): PlayResult[] {
  const out: PlayResult[] = [];
  const routes = opts.route === 'direct' ? ['direct'] : opts.route === 'flank' ? ['flank'] : ['direct', 'flank'];
  let first: number[] | null = null;
  for (const which of routes) {
    const ctx = createRun({ mode: opts.enemies ? undefined : RANGE, seed: 1, species: 'totodile', ruleOverrides: { objectives: { firstAfter: 1e9, secondAfter: 1e9 }, worldgen: { mode: 'generated', regionSeed: seed, locations: { meadow: recipe, dusk: recipe, badlands: recipe, frost: recipe } }, ...sizeOverride(), ...(opts.rules ?? {}) } as never });
    const W = ctx.world, H = W.hab!, n = W.w * W.h, m = W.map;
    const res: PlayResult = { recipe, seed, route: which, reach: null, held: false, holdT: null, back: null, stalls: 0, hp: 0, note: '', raidAt: null, dmg: 0, hazardHits: 0, ventSeconds: 0, trainerHits: 0, raiderHits: 0 };
    ctx.hooks.onTick.push((c) => { for (const e of c.events) {
      if (e.t === 'cellHurt' && (e.kind === 'burn' || e.kind === 'charge')) { res.hazardHits++; res.trainerHits++; }
      if (e.t !== 'hazardHit') continue;
      res.hazardHits++;
      if (e.who === 'player') res.trainerHits++;
      else if (c.enemies.roles[e.id] & ROLE.raider && c.objective?.phase === 'active') res.raiderHits++;
    }
    res.dmg = c.stats.damageTaken; if (c.world.hazard && ventPhase(c) === 'active') res.ventSeconds += c.dt; });
    opts.prepare?.(ctx);
    const spawn = m.spawn[1] * W.w + m.spawn[0];
    const ck = Math.floor(H.contest.y) * W.w + Math.floor(H.contest.x);
    const avoid = which === 'flank' && first ? new Set(first.filter((v) => { const k = v % n, x = k % W.w, y = (k / W.w) | 0; return Math.hypot(x - H.contest.x, y - H.contest.y) > H.contest.r + 3 && Math.hypot(x - m.spawn[0], y - m.spawn[1]) > 12; }).flatMap((v) => { const k = v % n, x = k % W.w, y = (k / W.w) | 0, o: number[] = []; for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) o.push((y + dy) * W.w + x + dx); return o; })) : undefined;
    const path = routeTo(ctx, spawn, ck, avoid);
    if (!path) { res.note = 'no route on the final collision'; out.push(res); continue; }
    if (which === 'direct') first = path;
    const stall = { n: 0 };
    // to the point
    res.reach = drive(ctx, path, 60, stall);
    if (res.reach === null) { res.note = 'did not reach the contest'; res.stalls = stall.n; out.push(res); continue; }
    // the Hold on the generated point: offered, engaged by standing on it, held to completion
    startObjective(ctx, 'hold');
    const O = ctx.objective!;
    const t0 = ctx.time;
    const E = ctx.enemies;
    while (ctx.time - t0 < 90 && O.phase !== 'done' && O.phase !== 'failed' && ctx.state !== 'dead') {
      const dx = O.x - ctx.player.x, dz = O.z - ctx.player.z, L = Math.hypot(dx, dz);
      // geometry mode: nothing else on the map; raid mode: the trainer cannot be hurt, the raid party is live
      if (opts.raid) { ctx.player.iframes = 1; /* raid mode */ ctx.player.hp = ctx.player.maxHp; }
      else if (!opts.enemies) for (let e = 0; e < E.alive.length; e++) if (E.alive[e]) E.kill(e);
      step(ctx, L > 1 ? { ...NO_INPUT, mx: dx / L * 0.5, mz: dz / L * 0.5 } : NO_INPUT);
      if (ctx.cards.offer) step(ctx, { ...NO_INPUT, card: { action: 'skip', index: 0 } });
      if (res.raidAt === null) for (let e = 0; e < E.alive.length; e++) if (E.alive[e] && E.roles[e] & ROLE.raider && Math.hypot(E.x[e] - O.x, E.z[e] - O.z) < ctx.rules.objectives.hold.radius) { res.raidAt = +(ctx.time - t0).toFixed(1); break; }
    }
    res.held = O.phase === 'done';
    res.holdT = res.held ? +(ctx.time - t0).toFixed(1) : null;
    res.note = `objective at ${O.x.toFixed(1)},${O.z.toFixed(1)} (contest ${(H.contest.x - W.half).toFixed(1)},${(H.contest.y - W.half).toFixed(1)}) ${O.phase}`;
    // retreat to the staging along the same approach, reversed
    const here = W.tile(ctx.player.x, ctx.player.z);
    const back = routeTo(ctx, here, spawn, avoid);
    // raid mode: the trainer cannot be hurt on the way back either (the raid party is still live)
    res.back = back ? drive(ctx, back, 60, stall, opts.raid ? () => { ctx.player.iframes = 1; ctx.player.hp = ctx.player.maxHp; } : undefined) : null;
    res.stalls = stall.n; res.hp = Math.round(ctx.player.hp);
    out.push(res);
  }
  return out;
}

if (process.argv[1]?.endsWith('habplay.ts')) {
  console.log(sizeLabel);
  const which = process.argv[2] ?? 'all', N = Number(process.argv[3] ?? 3), first = Number(process.argv[4] ?? 1);
  const enemies = process.argv.includes('--enemies'), raid = process.argv.includes('--raid');
  const ri = process.argv.indexOf('--route'), route = (ri > 0 ? process.argv[ri + 1] : 'both') as 'direct' | 'flank' | 'both';
  let ok = 0, total = 0;
  for (const id of which === 'all' ? Object.keys(HABITATS) : [which]) for (let s = first; s < first + N; s++) {
    for (const r of playHabitat(id, s, { enemies, raid, route })) {
      total++;
      const pass = r.reach !== null && (raid ? r.raidAt !== null : r.held) && r.back !== null;
      if (pass) ok++;
      console.log(`${id} seed ${s} ${r.route.padEnd(6)} ${pass ? 'ok  ' : 'FAIL'} env hits ${r.hazardHits}, dmg ${r.dmg.toFixed(1)}, reach ${r.reach?.toFixed(1) ?? '-'} s, hold ${r.held ? r.holdT + ' s' : 'no'}, back ${r.back?.toFixed(1) ?? '-'} s, stalls ${r.stalls}, hp ${r.hp}${raid ? `, raiders on the point at ${r.raidAt ?? '-'} s` : ''}  ${r.note}`);
    }
  }
  console.log(`\n${ok}/${total} spawn → objective → retreat runs completed${raid ? ' (raid party live, trainer invulnerable: pass = raiders reached the point)' : enemies ? ' (enemies live)' : ' (geometry only: no enemies)'}`);
}
