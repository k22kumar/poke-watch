// Enemy actions any behaviour can use (docs/hero-shooter-pivot.md §8a 5). Today's user is the Rock-type boss's Rock Throw
// (src/sim/enemies.ts bossThink); a T1/T2 bot throws the same way. An action owns one enemy state value while it runs.
import { datan2, dhypot } from '../core/detmath';
import { spawnBody, TEAM } from './bodies';
import type { SimContext } from './types';
import { GROUND, worldOf } from './worldquery';

/** the enemy state a throw holds while it winds up */
export const THROWING = 7;

/** start (or queue) a throw of a heavy body at the player: `left` throws remain, the first after `delay` s. The path is
 *  drawn on the ground for the wind-up (rules.actions.throw) */
export function startThrow(ctx: SimContext, i: number, left: number, delay = ctx.rules.actions.throw.windup) {
  const E = ctx.enemies, P = ctx.player, R = ctx.rules.actions.throw;
  const dx = P.x - E.x[i], dz = P.z - E.z[i], L = dhypot(dx, dz) || 1;
  E.state[i] = THROWING; E.stateT[i] = delay; E.tx[i] = dx / L; E.tz[i] = dz / L; E.sx[i] = left;
  E.facing[i] = datan2(dx, dz);
  ctx.events.push({ t: 'line', x1: E.x[i], z1: E.z[i], x2: E.x[i] + (dx / L) * R.lineLength, z2: E.z[i] + (dz / L) * R.lineLength, width: R.lineWidth, life: delay });
}

/** a throwing enemy's tick (its speed is 0 meanwhile): at the end of the wind-up the body rolls along the drawn path, its
 *  impact damage the thrower's contact damage × rules.actions.throw.dmg at full speed; then the next queued throw, or
 *  back to `after` */
export function throwTick(ctx: SimContext, i: number, after: number) {
  const E = ctx.enemies, W = worldOf(ctx);
  if (E.stateT[i] > 0) return;
  const R = ctx.rules.actions.throw, dx = E.tx[i], dz = E.tz[i];
  const off = E.radius[i] + R.offset;
  const sx0 = E.x[i] + dx * off, sz0 = E.z[i] + dz * off;
  const [bx, bz] = W.walkableAt(sx0, GROUND, sz0) ? [sx0, sz0] : [E.x[i], E.z[i]];
  spawnBody(ctx, R.template, bx, bz, dx * R.speed, dz * R.speed, TEAM.enemy, E.dmg[i] * R.dmg * 10 / R.speed);
  ctx.events.push({ t: 'throw', x: bx, z: bz, tx: bx + dx * 20, tz: bz + dz * 20, element: 'stone' });
  if (E.sx[i] > 1) startThrow(ctx, i, E.sx[i] - 1, R.again); else E.state[i] = after;
}
