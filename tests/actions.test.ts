// Enemy actions (src/sim/actions.ts; docs/hero-shooter-pivot.md §8a 5): the throw is not boss code. Any enemy started on
// it winds up for rules.actions.throw.windup with its path drawn, then rolls a heavy body at the player as TEAM.enemy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRun, step } from '../src/sim/run';
import { NO_INPUT } from '../src/sim/types';
import { RANGE } from '../src/mods';
import { spawnEnemy } from '../src/sim/enemies';
import { startThrow, THROWING } from '../src/sim/actions';
import { TEAM } from '../src/sim/bodies';
import { BODY_KINDS } from '../src/rules/materials';

test('a plain enemy throws through the action: wind-up, a drawn path, then a heavy body rolling at the player', () => {
  const ctx = createRun({ mode: RANGE, seed: 1, species: 'charmander', ruleOverrides: { worldgen: { arena: 'range' } } as never });
  const P = ctx.player, E = ctx.enemies, B = ctx.bodies, R = ctx.rules.actions.throw;
  for (let i = 0; i < 3; i++) step(ctx, NO_INPUT);
  const e = spawnEnemy(ctx, 'geodude', P.x, P.z - 12);
  startThrow(ctx, e, 2);
  assert.equal(E.state[e], THROWING);
  assert.ok(ctx.events.some((v) => v.t === 'line'), 'the path is drawn');
  const before = new Set<number>(); for (let b = 0; b < B.hi; b++) if (B.alive[b]) before.add(b);
  let thrown = 0, at = -1;
  for (let t = 0; t < Math.round((R.windup + R.again + 0.2) / ctx.dt); t++) for (const v of step(ctx, NO_INPUT)) if (v.t === 'throw') { thrown++; if (at < 0) at = ctx.tick; }
  assert.equal(thrown, 2, 'two throws: the queued one follows rules.actions.throw.again later');
  const mine = [...Array(B.hi).keys()].filter((b) => B.alive[b] && !before.has(b) && B.kind[b] === BODY_KINDS.indexOf(R.template));
  assert.ok(mine.length >= 1 && mine.every((b) => B.team[b] === TEAM.enemy), 'enemy boulders');
  assert.ok(B.vz[mine[0]] > 0, 'rolling toward the player (south)');
});
