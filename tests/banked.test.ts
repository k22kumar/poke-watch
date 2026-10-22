// Banked picks (blueprint Phase 4): level-ups wait in a tray while the world keeps running.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRun, step } from '../src/sim/run';
import { gainXp } from '../src/sim/progression';
import { NO_INPUT } from '../src/sim/types';

test('a level-up opens a tray offer without pausing the sim', () => {
  const ctx = createRun({ seed: 3, species: 'totodile' });
  gainXp(ctx, ctx.player.xpNext + 0.01);
  step(ctx, NO_INPUT);
  assert.ok(ctx.cards.offer, 'an offer is open');
  assert.equal(ctx.state, 'play');
  const t0 = ctx.time;
  for (let i = 0; i < 60; i++) step(ctx, NO_INPUT);
  assert.ok(ctx.time > t0 + 0.9, 'time keeps running while the offer waits');
  assert.equal(ctx.player.pendingLevels, 1);
  step(ctx, { ...NO_INPUT, card: { action: 'pick', index: 0 } });
  assert.equal(ctx.player.pendingLevels, 0);
  assert.equal(ctx.cards.offer, null);
});

test('several level-ups bank and open one after another', () => {
  const ctx = createRun({ seed: 4, species: 'cyndaquil' });
  for (let i = 0; i < 3; i++) gainXp(ctx, ctx.player.xpNext - ctx.player.xp + 0.01);
  step(ctx, NO_INPUT);
  assert.equal(ctx.player.pendingLevels, 3);
  for (let i = 0; i < 3; i++) { assert.ok(ctx.cards.offer); step(ctx, { ...NO_INPUT, card: { action: 'pick', index: 0 } }); }
  assert.equal(ctx.player.pendingLevels, 0);
});

test('the pausing modal is still available as a rule (cards.tray = false)', () => {
  const ctx = createRun({ seed: 3, species: 'totodile', ruleOverrides: { cards: { tray: false } } });
  gainXp(ctx, ctx.player.xpNext + 0.01);
  step(ctx, NO_INPUT);
  assert.equal(ctx.state, 'levelup');
  const t0 = ctx.time;
  step(ctx, NO_INPUT);
  assert.equal(ctx.time, t0, 'the modal pauses the world');
});
