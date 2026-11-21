// Training targets in the sim (src/rules/targets.ts for the data; docs/hero-shooter-pivot.md §5, Q16, Q17, Q20).
// startTargets resolves each target's anchor on the map, puts it down through the placement rules (src/sim/placement.ts,
// spawnEnemy's footprint fit) and tracks it; targetSystem respawns a target a fixed tick count after it falls, and
// targetGoal gives a patrol its next waypoint (src/sim/enemies.ts reads it). Targets are pinned: the far-behind
// relocation never moves one.
import { SPECIES_BY_ID } from '../rules/species';
import { heroHealth } from '../rules/stats';
import type { AnchorFrom, TargetSet } from '../rules/targets';
import { spawnEnemy } from './enemies';
import { allowedAt } from './placement';
import { ROLE } from './pools';
import type { SimContext, System } from './types';

export interface TargetState {
  set: TargetSet;
  /** per target: its enemy slot (-1 while down), the slot's generation, the tick it comes back on (-1 = up), its anchor
   *  point in world metres, and a patrol's waypoint index */
  slot: Int32Array; gen: Int32Array; back: Int32Array; ax: Float32Array; az: Float32Array; wp: Int32Array;
  /** enemy slot -> target index (-1 for any other enemy) */
  of: Int32Array;
}

function anchor(ctx: SimContext, from: AnchorFrom): [number, number] {
  const W = ctx.world, H = W.hab;
  if (from === 'contest' && H) return [H.contest.x - W.half, H.contest.y - W.half];
  if (from === 'stageA' && H) return [H.stage.A[0] - W.half, H.stage.A[1] - W.half];
  if (from === 'stageB' && H) return [H.stage.B[0] - W.half, H.stage.B[1] - W.half];
  return [W.spawn[0], W.spawn[1]];
}

/** put the set's targets down and start tracking them (replacing any earlier set) */
export function startTargets(ctx: SimContext, set: TargetSet) {
  const n = set.targets.length;
  const T: TargetState = { set, slot: new Int32Array(n).fill(-1), gen: new Int32Array(n), back: new Int32Array(n).fill(-1), ax: new Float32Array(n), az: new Float32Array(n), wp: new Int32Array(n), of: new Int32Array(ctx.enemies.cap).fill(-1) };
  ctx.targets = T;
  for (let k = 0; k < n; k++) {
    const d = set.targets[k], [x, z] = anchor(ctx, d.from);
    T.ax[k] = x; T.az[k] = z;
    spawnTarget(ctx, k);
  }
}

function spawnTarget(ctx: SimContext, k: number) {
  const T = ctx.targets!, d = T.set.targets[k], sp = SPECIES_BY_ID[d.species], E = ctx.enemies, R = ctx.rules.enemy, TR = ctx.rules.targets;
  let x = T.ax[k] + d.dx, z = T.az[k] + d.dz;
  if (!allowedAt(ctx, d.species, x, z)) [x, z] = ctx.world.nearestWalkable(x, z);
  const i = spawnEnemy(ctx, d.species, x, z, ROLE.target | (d.kind === 'strafe' ? ROLE.ranged : 0));
  T.back[k] = -1;
  if (i < 0) { T.slot[k] = -1; return; }
  T.slot[k] = i; T.gen[k] = E.gen[i]; T.of[i] = k; T.wp[k] = 0;
  // canon-curve health with the kind's multiplier, base speed (no survivor curves), damage by kind
  E.hp[i] = E.maxHp[i] = heroHealth(sp.stats.hp, ctx.rules) * TR.hp[d.kind];
  E.speed[i] = d.kind === 'dummy' ? 0 : Math.min(R.speedMax, R.speedBase + sp.stats.spe * R.speedPerSpe) * (d.kind === 'strafe' ? 0.85 : 1);
  E.dmg[i] = d.kind === 'strafe' ? E.dmg[i] * TR.strafeDamage : 0;
}

/** a patrol's next waypoint (world metres), or null for any other enemy (it falls back to its behaviour) */
export function targetGoal(ctx: SimContext, i: number): [number, number] | null {
  const T = ctx.targets;
  if (!T) return null;
  const k = T.of[i];
  if (k < 0 || T.slot[k] !== i) return null;
  const d = T.set.targets[k], E = ctx.enemies;
  if (d.kind === 'dummy') return [E.x[i], E.z[i]];
  if (d.kind !== 'patrol' || !d.path?.length) return null;
  let [px, pz] = d.path[T.wp[k] % d.path.length];
  if (Math.hypot(T.ax[k] + px - E.x[i], T.az[k] + pz - E.z[i]) < 1.2) { T.wp[k] = (T.wp[k] + 1) % d.path.length; [px, pz] = d.path[T.wp[k]]; }
  return [T.ax[k] + px, T.az[k] + pz];
}

export const targetSystem: System = {
  name: 'targets',
  update(ctx) {
    const T = ctx.targets;
    if (!T) return;
    const E = ctx.enemies, wait = Math.max(1, Math.round(ctx.rules.targets.respawn / ctx.dt));
    for (let k = 0; k < T.slot.length; k++) {
      const i = T.slot[k];
      if (i >= 0 && E.alive[i] && E.gen[i] === T.gen[k]) continue;
      if (i >= 0) { if (T.of[i] === k) T.of[i] = -1; T.slot[k] = -1; T.back[k] = ctx.tick + wait; }
      if (T.back[k] >= 0 && ctx.tick >= T.back[k]) spawnTarget(ctx, k);
    }
  },
};
