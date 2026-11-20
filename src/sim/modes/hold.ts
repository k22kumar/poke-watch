// Hold: the control-point objective as a mode of its own (docs/hero-shooter-pivot.md Q14). Stand within
// rules.objectives.hold.radius of the point for hold.time seconds to take it; Raiders standing on it drain the charge.
// On habitat maps the point is the generated contest floor and the Raid party leaves team B's staging and takes its
// approaches (docs/HABITATS.md "Hold contract"); src/sim/enemies.ts pins Raiders of an active habitat Hold so the
// far-behind relocation (rules.enemy.despawnDistance) never skips the approaches. Hold is the 3v3's objective later.
//
// src/sim/objectives.ts still schedules and finishes objectives (Hunt and Transport are survivor-only and go with the
// loop); it calls these for everything Hold-specific. The HOLD Mode (src/mods) opens one at the start of a habitat map.
import { clamp } from '../../core/util';
import { dcos, dhypot, dsin } from '../../core/detmath';
import { COMPOSITIONS, resolve, type CompositionDef } from '../../rules/compositions';
import { ringPoint, spawnEnemy } from '../enemies';
import { allowedAt } from '../placement';
import { ROLE } from '../pools';
import type { Objective, SimContext } from '../types';

/** where the point is: the habitat contest floor, else `site()` (an open spot near the player) */
export function holdPoint(ctx: SimContext, site: () => [number, number]): [number, number] {
  const H = ctx.world.hab;
  return H ? [H.contest.x - ctx.world.half, H.contest.y - ctx.world.half] : site();
}

/** how long the point is offered before it lapses: habitat maps add 30 s (the walk from staging A) */
export function holdOfferTime(ctx: SimContext): number {
  return ctx.world.hab ? ctx.rules.objectives.offerTime + 30 : ctx.rules.objectives.offerTime;
}

// The composition spawner, moved here from the survivor director (deleted at pivot step 9); the Raid party is its only
// user. It goes with the compositions (src/rules/compositions.ts), next in step 9.
/** spawn one composition at a point on the spawn ring; returns the enemy slots */
export function spawnComposition(ctx: SimContext, def: CompositionDef, near?: [number, number]): number[] {
  const table = ctx.spawnTable;
  const jobs = resolve(def, table);
  if (!jobs) return [];
  const [rMin, rMax] = ctx.rules.enemy.spawnRadius;
  const [cx, cz] = near ?? ringPoint(ctx, rMin, rMax);
  const P = ctx.player, R = ctx.rules.roles;
  // toward the player: the wall stands in front, the guns behind it
  const dx = P.x - cx, dz = P.z - cz, L = dhypot(dx, dz) || 1, ux = dx / L, uz = dz / L;
  const out: number[] = [];
  def.members.forEach((m, k) => {
    const can = jobs[k];
    for (let c = 0; c < m.count; c++) {
      const sp = ctx.rng.spawn.pick(can);
      const front = m.roles & ROLE.shielder ? 2.2 : m.job === 'ranged' || m.job === 'mender' || m.job === 'hexer' ? -1.6 : 0;
      const a = ctx.rng.spawn.range(0, Math.PI * 2), r = ctx.rng.spawn.range(0, 1.8);
      const b = ctx.world.bound;
      const x = clamp(cx + ux * front + dsin(a) * r, -b, b), z = clamp(cz + uz * front + dcos(a) * r, -b, b);
      // the first region's Bulwark is a plain tank with a shield; from the second region on it is an elite
      const roles = ctx.stage === 0 ? m.roles & ~ROLE.elite : m.roles;
      // compatibility: a member that may not stand here is left out (the group still comes)
      if (!allowedAt(ctx, sp.id, x, z, roles & ROLE.elite ? ctx.rules.enemy.roles.elite.size : 1)) { ctx.events.push({ t: 'spawnSkipped', species: sp.id, reason: 'restricted habitat', x, z }); continue; }
      const i = spawnEnemy(ctx, sp.id, x, z, roles);
      if (i < 0) continue;
      if (m.roles & ROLE.raider) { ctx.enemies.speed[i] *= R.raiderSpeed; ctx.enemies.hp[i] *= R.raiderHp; ctx.enemies.maxHp[i] *= R.raiderHp; }
      out.push(i);
    }
  });
  return out;
}

/** compositions this region can field, for a peak or for an objective */
export function compositionsFor(ctx: SimContext, when: 'peak' | 'objective'): CompositionDef[] {
  const table = ctx.spawnTable;
  return COMPOSITIONS.filter((c) => c.when === when && resolve(c, table));
}

/** the Raid party: a composition that comes for the point, from team B's staging on habitat maps */
export function spawnRaidParty(ctx: SimContext) {
  const opts = compositionsFor(ctx, 'objective');
  const H = ctx.world.hab;
  const near: [number, number] | undefined = H ? [H.stage.B[0] - ctx.world.half, H.stage.B[1] - ctx.world.half] : undefined;
  if (opts.length) spawnComposition(ctx, ctx.rng.spawn.weighted(opts, (c) => c.weight), near);
}

/** one tick of a Hold: activation on arrival, charge while the player stands on it, the Raiders' drain.
 *  Returns 'activate' when the player has just arrived, 'taken' when the charge is full, else null. */
export function holdTick(ctx: SimContext, O: Objective, dt: number, dP: number): 'activate' | 'taken' | null {
  const R = ctx.rules.objectives, E = ctx.enemies, P = ctx.player;
  if (O.phase === 'offer') return dP < R.hold.radius ? 'activate' : null;
  if (O.phase !== 'active') return null;
  if (dP < R.hold.radius && P.faintT < 0) O.charge += dt / R.hold.time;
  // Raiders standing on the pad drain it
  const n = ctx.grid.query(O.x, O.z, 2);
  for (let k = 0; k < n; k++) { const e = ctx.grid.result[k]; if (E.alive[e] && E.roles[e] & ROLE.raider) O.charge -= R.hold.drain * dt; }
  O.charge = clamp(O.charge, 0, 1);
  return O.charge >= 1 ? 'taken' : null;
}
