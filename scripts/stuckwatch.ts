// Movement deadlock watch over live runs (docs/SIZING.md "Checking it"): the autoplay bot (src/sim/bot.ts, the playable
// AI) on every habitat recipe and location, everything live (spawns, swarms, elites, objectives, Hold Raid parties).
//   npx tsx scripts/stuckwatch.ts [recipe|location|all] [seeds] [seconds] [firstSeed]
// A stuck episode is 5 s with less than 0.5 m of net movement while the actor is trying to move:
//   player  the bot asks to move (|input| > 0.5); `pinned` when it also walked under 2 m in those 5 s (against geometry
//           or a crowd), else it walked back and forth (the bot kiting between threats)
//   enemy   a ground enemy with a route to the player (its field reaches it), more than 4 m from the player (crowding at
//           the target is not a deadlock), not frozen, held, falling, in a liquid, a boss, or a role that keeps its
//           distance on purpose (ranged, Hexer, Mender); a wide body with no wide route holds on purpose and is counted
//           apart as `holding`
// Read-only over the sim: it only observes. Prints every episode (seed, where, what is around) and a summary.
import { createRun, step } from '../src/sim/run';
import { botInput } from '../src/sim/bot';
import { ROLE } from '../src/sim/pools';
import { HABITATS } from '../src/world/habitat';
import { LOCATIONS } from '../src/world/locations';
import { navWide } from '../src/rules/sizing';
import { DIAG_R } from '../src/world/navblocks';
import type { SimContext } from '../src/sim/types';

export interface StuckReport { map: string; seed: number; species: string; playerStuck: number; playerPinned: number; enemyStuck: number; holding: number; samples: number; notes: string[] }

const NAV: [number, number] = [0, 0];

export function watch(map: string, seed: number, seconds: number, species = 'totodile', extra: object = {}): StuckReport {
  const ctx: SimContext = createRun({ seed, species, ruleOverrides: { worldgen: { mode: 'generated', regionSeed: seed, locations: { meadow: map, dusk: map, badlands: map, frost: map } }, ...extra } as never });
  const W = ctx.world, P = ctx.player, E = ctx.enemies, R: StuckReport = { map, seed, species, playerStuck: 0, playerPinned: 0, enemyStuck: 0, holding: 0, samples: 0, notes: [] };
  const WIN = 300; // ticks (5 s)
  let pAnchor: [number, number, number] | null = null, pTrying = 0, pPath = 0, pLx = P.x, pLz = P.z;
  const eAnchor = new Map<string, [number, number, number]>();
  const lastX = new Float64Array(E.x.length), lastZ = new Float64Array(E.x.length);
  while (ctx.time < seconds && ctx.state !== 'over' && ctx.state !== 'dead') {
    const inp = botInput(ctx);
    step(ctx, inp);
    // player
    if (Math.hypot(inp.mx, inp.mz) > 0.5 && P.faintT < 0 && !ctx.cards.offer) pTrying++;
    pPath += Math.hypot(P.x - pLx, P.z - pLz); pLx = P.x; pLz = P.z;
    if (ctx.tick % WIN === 0) {
      if (pAnchor && pTrying > WIN * 0.8 && Math.hypot(P.x - pAnchor[0], P.z - pAnchor[1]) < 0.5) { R.playerStuck++;
        let crowd = 0; for (let e = 0; e < E.hi; e++) if (E.alive[e] && Math.hypot(E.x[e] - P.x, E.z[e] - P.z) < 2.5) crowd++;
        const pinned = pPath < 2; if (pinned) R.playerPinned++;
        R.notes.push(`player ${pinned ? 'pinned' : 'oscillating'} at ${P.x.toFixed(1)},${P.z.toFixed(1)} y ${P.y.toFixed(1)} t ${ctx.time.toFixed(0)}, walked ${pPath.toFixed(1)} m, ${crowd} enemies within 2.5 m, ${P.holding ? 'holding' : ''}`); }
      pAnchor = [P.x, P.z, ctx.tick]; pTrying = 0; pPath = 0;
    }
    // enemies, sampled once a second
    // a body moved more than 3 m in one tick was relocated (rules.enemy.despawnDistance or holdRelocate): a new start, not
    // movement. Without this a walker relocated back to near the same ring point read as stuck (river-gorge seed 1)
    for (let e = 0; e < E.hi; e++) {
      if (Math.hypot(E.x[e] - lastX[e], E.z[e] - lastZ[e]) > 3) eAnchor.delete(e + ':' + E.gen[e]);
      lastX[e] = E.x[e]; lastZ[e] = E.z[e];
    }
    if (ctx.tick % 60) continue;
    for (let e = 0; e < E.hi; e++) {
      if (!E.alive[e]) continue;
      const key = e + ':' + E.gen[e], roles = E.roles[e];
      const skip = E.hover[e] > 0 || roles & (ROLE.boss | ROLE.ranged | ROLE.hexer | ROLE.healer) || E.heldT[e] > 0 || E.fallV[e] > 0 || E.hzKind[e]
        || E.sleep[e] > 0 || E.stun[e] > 0 || E.root[e] > 0 || Math.hypot(E.x[e] - P.x, E.z[e] - P.z) < 4;
      if (skip) { eAnchor.delete(key); continue; }
      const wide = E.foot[e] > 0 && navWide(E.foot[e], ctx.rules);
      const route = wide ? W.wideDir(E.x[e], E.z[e], NAV, E.y[e], E.foot[e] < DIAG_R) : W.flowDist(E.x[e], E.z[e], E.y[e]) < Infinity ? 1 : -1;
      if (route < 0) {
        if (wide) {
          R.holding++;
          if (process.env.STUCK_HOLD && R.holding % 50 === 1) R.notes.push(`hold ${ctx.speciesIndex[E.species[e]].id} at ${E.x[e].toFixed(1)},${E.z[e].toFixed(1)} y ${E.y[e].toFixed(1)}; player ${P.x.toFixed(1)},${P.z.toFixed(1)} y ${P.y.toFixed(1)} ${W.liquidAt(P.x, P.z, P.y, 0.3) ? 'in liquid' : ''} ${P.grounded ? '' : 'airborne'} player on wide ground ${W.fitsHeavy(P.x, P.z, P.y)}, ordinary route ${W.flowDist(E.x[e], E.z[e], E.y[e])}`);
        }
        eAnchor.delete(key); continue;
      }
      R.samples++;
      const a = eAnchor.get(key);
      if (!a) { eAnchor.set(key, [E.x[e], E.z[e], ctx.tick]); continue; }
      if (ctx.tick - a[2] < WIN) continue;
      if (Math.hypot(E.x[e] - a[0], E.z[e] - a[1]) < 0.5) {
        R.enemyStuck++;
        if (R.notes.length < 12) R.notes.push(`enemy ${ctx.speciesIndex[E.species[e]].id} foot ${E.foot[e].toFixed(2)} roles ${roles} stuck at ${E.x[e].toFixed(1)},${E.z[e].toFixed(1)} y ${E.y[e].toFixed(1)} (player ${Math.hypot(E.x[e] - P.x, E.z[e] - P.z).toFixed(1)} m) t ${ctx.time.toFixed(0)}`);
      }
      eAnchor.set(key, [E.x[e], E.z[e], ctx.tick]);
    }
  }
  return R;
}

if (process.argv[1]?.endsWith('stuckwatch.ts')) {
  const which = process.argv[2] ?? 'all', N = Number(process.argv[3] ?? 3), secs = Number(process.argv[4] ?? 120), first = Number(process.argv[5] ?? 1);
  const extra = process.env.STUCK_RULES ? JSON.parse(process.env.STUCK_RULES) : {};
  const maps = which === 'all' ? [...Object.keys(HABITATS), ...Object.keys(LOCATIONS)] : which === 'habitat' ? Object.keys(HABITATS) : which === 'location' ? Object.keys(LOCATIONS) : [which];
  let ps = 0, pp = 0, es = 0, hold = 0, samples = 0;
  for (const map of maps) for (let s = first; s < first + N; s++) for (const species of ['totodile', 'feraligatr']) {
    const r = watch(map, s, secs, species, extra);
    ps += r.playerStuck; pp += r.playerPinned; es += r.enemyStuck; hold += r.holding; samples += r.samples;
    console.log(`${map} seed ${s} ${species.padEnd(10)} player stuck ${r.playerStuck} (pinned ${r.playerPinned}), enemy stuck ${r.enemyStuck} (of ${r.samples} enemy-seconds with a route), wide holding ${r.holding}`);
    for (const n of r.notes) console.log('   ', n);
  }
  console.log(`\nplayer stuck episodes ${ps} (pinned ${pp}: walked under 2 m in the 5 s; the rest walked back and forth); enemy stuck episodes ${es} over ${samples} enemy-seconds with a route; wide holding samples ${hold}`);
}
