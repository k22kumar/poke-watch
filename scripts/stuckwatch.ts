// Movement deadlock watch over live runs (docs/SIZING.md "Checking it"): the autoplay bot (src/sim/bot.ts, the playable
// AI) on every habitat recipe and location, against a chasing crowd of 120 (scripts/lib/crowd.ts; the survivor director
// was deleted at pivot step 9).
//   npx tsx scripts/stuckwatch.ts [recipe|location|all] [seeds] [seconds] [firstSeed]
// A stuck episode is 5 s with less than 0.5 m of net movement while the actor is trying to move:
//   player  the bot asks to move (|input| > 0.5); `pinned` when it also walked under 2 m in those 5 s (against geometry
//           or a crowd), else it walked back and forth (the bot kiting between threats). Every player episode is also
//           checked for a way out (escapeOf, with the partner's own footprint): TRAPPED when no heading moves it onto ground
//           it may stand on, or when the ground it can walk to is a pocket under 48 tiles (World.shore's trap size).
//           Anything else is the bot's own steering (it samples a few headings and can miss a one-tile way out:
//           tropical-lagoon seed 3), not a movement failure
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
import { navWide, partnerFootprint, partnerHeight } from '../src/rules/sizing';
import { DIAG_R } from '../src/world/navblocks';
import { stateHash } from '../src/sim/checksum';
import { safeIn } from '../src/sim/hazards';
import { WATER_Y } from '../src/world/tiles';
import type { SimContext } from '../src/sim/types';
import { sizeLabel, sizeOverride } from './lib/sizeflags';
import { crowd } from './lib/crowd';

export interface StuckReport { map: string; seed: number; species: string; playerStuck: number; playerPinned: number; playerTrapped: number; enemyStuck: number; holding: number; samples: number; notes: string[]; hash: string }

const NAV: [number, number] = [0, 0], OUT: [number, number] = [0, 0];
/** World.shore's room: a walkable pocket smaller than this (in tiles) is a trap */
export const TRAP_ROOM = 48;

/** Can the partner get out from where it stands? Both answers move its own footprint with World.moveBody, as the player
 *  system does, so a one-tile exit counts for a Small partner and not for an Extra Large one.
 *    free  of 16 headings, those along which a 0.3 m move goes at least 0.2 m onto ground it may stand on
 *    room  ground it can get to, in tiles: a flood over the world's 0.5 m lattice from where it stands, each step a 0.5 m
 *          move that arrives, walking (faces it cannot step up stop it; it may drop off a ledge) or jumping (a face up to
 *          the real jump apex, rules.player jumpVelocity² / 2 gravity, plus the step: the trainer-jump climb the habitat
 *          profiles use), never into open air or a liquid it is not safe in (hazards.safeIn). A liquid it is safe in is a
 *          way through: a swimmer floats at its surface. It stops at TRAP_ROOM
 *  Reads the world only: moveBody and support write nothing, and the wide field (which a query could rebuild early, and
 *  so change later steering) is never touched. */
export function escapeOf(ctx: SimContext): { free: number; room: number; trapped: boolean } {
  const W = ctx.world, P = ctx.player, R = ctx.rules.player, r = partnerFootprint(P.species, ctx.rules), st = R.stepHeight, tall = partnerHeight(P.species, ctx.rules);
  const climb = st + (R.jumpVelocity * R.jumpVelocity) / (2 * R.gravity);
  const contact = ctx.rules.hazards.contact;
  const standable = (x: number, z: number, feet: number) => {
    const g = W.support(x, z, feet);
    const kind = W.liquidAt(x, z, g === -Infinity ? feet : g, contact);
    if (kind) {
      if (!safeIn(ctx, kind, P.species)) return -Infinity;
      // swimming: a liquid it is safe in carries it at the surface, floor or none
      const k = W.tile(x, z), top = W.map.wlevel ? W.map.wlevel[k] : WATER_Y;
      return g === -Infinity ? top : Math.max(g, top);
    }
    return g;
  };
  // a move of (dx, dz) from (x, z) at `feet` that arrives within `tol` of its target: walking first, then jumping
  const arrives = (x: number, z: number, feet: number, dx: number, dz: number, tol: number) => {
    for (const up of [st, climb]) {
      W.moveBody(x, z, dx, dz, feet, up, r, OUT, undefined, tall);
      if (Math.hypot(OUT[0] - (x + dx), OUT[1] - (z + dz)) <= tol) return true;
    }
    return false;
  };
  let free = 0;
  for (let h = 0; h < 16; h++) {
    const a = (h * Math.PI) / 8, dx = Math.sin(a) * 0.3, dz = Math.cos(a) * 0.3;
    // as before, a heading is free when a 0.3 m move goes at least 0.2 m (sliding along a face counts), walking or jumping
    for (const up of [st, climb]) {
      W.moveBody(P.x, P.z, dx, dz, P.y, up, r, OUT, undefined, tall);
      if (Math.hypot(OUT[0] - P.x, OUT[1] - P.z) >= 0.2 && standable(OUT[0], OUT[1], up === st ? P.y : P.y + climb) > -Infinity) { free++; break; }
    }
  }
  // the lattice is the world's 0.5 m points (tile centres and corners: the middle of a one-tile and of a two-tile passage,
  // where a footprint with little room to spare fits), seeded with those within 0.75 m the partner reaches from where it is
  const key = (i: number, j: number) => (i + 2048) * 4096 + (j + 2048);
  const cap = TRAP_ROOM * 4, seen = new Map<number, number>(), Q: number[] = [];
  const reach = (x: number, z: number, feet: number, tx: number, tz: number) => {
    if (!arrives(x, z, feet, tx - x, tz - z, 0.05)) return -Infinity;
    // walked or jumped: it stands on whatever is under it there, up to a jump's height above its feet
    return standable(tx, tz, feet + climb);
  };
  const i0 = Math.round(P.x * 2), j0 = Math.round(P.z * 2);
  for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
    const tx = (i0 + di) / 2, tz = (j0 + dj) / 2;
    if (Math.hypot(tx - P.x, tz - P.z) > 0.75) continue;
    const g = reach(P.x, P.z, P.y, tx, tz);
    if (g > -Infinity) { seen.set(key(i0 + di, j0 + dj), g); Q.push(key(i0 + di, j0 + dj)); }
  }
  for (let h = 0; h < Q.length && seen.size < cap; h++) {
    const k = Q[h], i = Math.floor(k / 4096) - 2048, j = (k % 4096) - 2048, feet = seen.get(k)!;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nk = key(i + di, j + dj);
      if (seen.has(nk)) continue;
      const g = reach(i / 2, j / 2, feet, (i + di) / 2, (j + dj) / 2);
      if (g > -Infinity) { seen.set(nk, g); Q.push(nk); }
    }
  }
  const room = Math.min(TRAP_ROOM, seen.size / 4);
  return { free, room, trapped: free === 0 || room < TRAP_ROOM };
}

export function watch(map: string, seed: number, seconds: number, species = 'totodile', extra: object = {}): StuckReport {
  const ctx: SimContext = createRun({ seed, species, mods: [crowd(120)], ruleOverrides: { worldgen: { mode: 'generated', regionSeed: seed, locations: { meadow: map, dusk: map, badlands: map, frost: map } }, ...sizeOverride(), ...extra } as never });
  const W = ctx.world, P = ctx.player, E = ctx.enemies, R: StuckReport = { map, seed, species, playerStuck: 0, playerPinned: 0, playerTrapped: 0, enemyStuck: 0, holding: 0, samples: 0, notes: [], hash: '' };
  const WIN = 300; // ticks (5 s)
  let pAnchor: [number, number, number] | null = null, pTrying = 0, pPath = 0, pLx = P.x, pLz = P.z;
  const eAnchor = new Map<string, [number, number, number]>();
  const lastX = new Float64Array(E.x.length), lastZ = new Float64Array(E.x.length);
  while (ctx.time < seconds && ctx.state !== 'over' && ctx.state !== 'dead') {
    const inp = botInput(ctx);
    step(ctx, inp);
    // player
    if (Math.hypot(inp.mx, inp.mz) > 0.5 && P.faintT < 0) pTrying++;
    pPath += Math.hypot(P.x - pLx, P.z - pLz); pLx = P.x; pLz = P.z;
    if (ctx.tick % WIN === 0) {
      if (pAnchor && pTrying > WIN * 0.8 && Math.hypot(P.x - pAnchor[0], P.z - pAnchor[1]) < 0.5) { R.playerStuck++;
        let crowd = 0; for (let e = 0; e < E.hi; e++) if (E.alive[e] && Math.hypot(E.x[e] - P.x, E.z[e] - P.z) < 2.5) crowd++;
        const pinned = pPath < 2, out = escapeOf(ctx); if (pinned) R.playerPinned++; if (out.trapped) R.playerTrapped++;
        R.notes.push(`player ${out.trapped ? 'TRAPPED ' : ''}${pinned ? 'pinned' : 'oscillating'} (${out.free}/16 headings free, ${out.room >= TRAP_ROOM ? TRAP_ROOM + '+' : out.room} tiles reachable) at ${P.x.toFixed(1)},${P.z.toFixed(1)} y ${P.y.toFixed(1)} t ${ctx.time.toFixed(0)}, walked ${pPath.toFixed(1)} m, ${crowd} enemies within 2.5 m, ${P.holding ? 'holding' : ''}`); }
      // STUCK_PROBE_ALL=1 runs the escape probe every window: a run with it must hash the same as one without
      else if (process.env.STUCK_PROBE_ALL) escapeOf(ctx);
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
      const route = wide ? W.wideDir(E.x[e], E.z[e], NAV, E.y[e], E.foot[e] < DIAG_R, E.tall[e]) : W.flowDist(E.x[e], E.z[e], E.y[e]) < Infinity ? 1 : -1;
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
  R.hash = stateHash(ctx).toString(16); // the sim state at the end (the probe must not move it)
  return R;
}

if (process.argv[1]?.endsWith('stuckwatch.ts')) {
  console.log(sizeLabel);
  const which = process.argv[2] ?? 'all', N = Number(process.argv[3] ?? 3), secs = Number(process.argv[4] ?? 120), first = Number(process.argv[5] ?? 1);
  const extra = process.env.STUCK_RULES ? JSON.parse(process.env.STUCK_RULES) : {};
  const maps = which === 'all' ? [...Object.keys(HABITATS), ...Object.keys(LOCATIONS)] : which === 'habitat' ? Object.keys(HABITATS) : which === 'location' ? Object.keys(LOCATIONS) : [which];
  let ps = 0, pp = 0, pt = 0, es = 0, hold = 0, samples = 0;
  for (const map of maps) for (let s = first; s < first + N; s++) for (const species of ['totodile', 'feraligatr']) {
    const r = watch(map, s, secs, species, extra);
    ps += r.playerStuck; pp += r.playerPinned; pt += r.playerTrapped; es += r.enemyStuck; hold += r.holding; samples += r.samples;
    console.log(`${map} seed ${s} ${species.padEnd(10)} player stuck ${r.playerStuck} (pinned ${r.playerPinned}, trapped ${r.playerTrapped}), enemy stuck ${r.enemyStuck} (of ${r.samples} enemy-seconds with a route), wide holding ${r.holding}${process.env.STUCK_PROBE_ALL || process.env.STUCK_HASH ? ', end state ' + r.hash : ''}`);
    for (const n of r.notes) console.log('   ', n);
  }
  console.log(`\nplayer stuck episodes ${ps} (pinned ${pp}: walked under 2 m in the 5 s; the rest walked back and forth; TRAPPED ${pt}: no way out, a movement failure); enemy stuck episodes ${es} over ${samples} enemy-seconds with a route; wide holding samples ${hold}`);
}
