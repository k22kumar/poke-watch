// Carrying as a body-layer mechanic (src/sim/carry.ts; docs/hero-shooter-pivot.md §8a): any body a mode ticks through
// carryTick is picked up by walking into it, rides in front of the player at rules.caps.carry.speed, and drops on Guard.
// Transport's egg is one user (tests/phase7.test.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRun, step } from '../src/sim/run';
import { BTN, NO_INPUT } from '../src/sim/types';
import { RANGE } from '../src/mods';
import { spawnBody } from '../src/sim/bodies';
import { CARRIER, carryTick, release } from '../src/sim/carry';

test('a body ticked through carryTick: walk into it to pick it up, it rides ahead, Guard drops it', () => {
  const ctx = createRun({ mode: RANGE, seed: 1, species: 'charmander', ruleOverrides: { worldgen: { arena: 'range' } } as never });
  const P = ctx.player, B = ctx.bodies, C = ctx.rules.caps.carry;
  for (let i = 0; i < 5; i++) step(ctx, NO_INPUT);
  const b = spawnBody(ctx, 'egg', P.x + 0.6, P.z);
  assert.equal(B.carrier[b], CARRIER.none, 'a new body is carried by nobody');
  carryTick(ctx, b);
  assert.equal(B.carrier[b], CARRIER.player, 'within reach: picked up');
  assert.ok(P.carrying);
  carryTick(ctx, b);
  assert.ok(Math.abs(Math.hypot(B.x[b] - P.x, B.z[b] - P.z) - C.front) < 1e-9, 'it rides rules.caps.carry.front ahead');
  step(ctx, { ...NO_INPUT, btn: BTN.guard, press: BTN.guard });
  carryTick(ctx, b);
  assert.equal(B.carrier[b], CARRIER.none, 'Guard drops it');
  assert.ok(!P.carrying);
  // released by its user (an objective ending), and a reused slot starts uncarried
  P.guardT = -1; carryTick(ctx, b); assert.equal(B.carrier[b], CARRIER.player);
  release(ctx, b); assert.equal(B.carrier[b], CARRIER.none); assert.ok(!P.carrying);
  B.kill(b);
  assert.equal(B.carrier[spawnBody(ctx, 'rock', P.x + 9, P.z)], CARRIER.none);
});
