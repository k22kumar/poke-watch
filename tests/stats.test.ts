// The hero stat curve (src/rules/stats.ts; docs/STATS_GROWTH_TARGET.md "Stats"; docs/hero-shooter-pivot.md Q12, Q25,
// Q36, Q37): base 80 is ×1.0 and 250 health, levels add nothing, top speed sits in the narrow Spe band, and incoming
// damage is divided by the guard of its channel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultRules } from '../src/rules/defaults';
import { channelOf, guardOf, heroHealth, statMult, topSpeed } from '../src/rules/stats';
import { SPECIES_BY_ID } from '../src/rules/species';
import { createRun } from '../src/sim/run';
import { recompute } from '../src/sim/progression';
import { RANGE } from '../src/mods';

const close = (a: number, b: number, eps = 0.005) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

test('the Level-50 Canon Curve: base 80 is ×1.0 and 250 health, k = 0.6', () => {
  close(statMult(80, defaultRules), 1);
  close(heroHealth(80, defaultRules), 250);
  close(statMult(180, defaultRules), Math.pow(2, 0.6));
  close(heroHealth(235, defaultRules), 250 * Math.pow(2, 0.6));
  assert.ok(statMult(30, defaultRules) < statMult(80, defaultRules) && statMult(154, defaultRules) > 1.39);
});

test('top speed is a narrow logistic band in Spe: 5.70 / 6.00 / 6.30 / 6.36 m/s at Spe 30 / 80 / 130 / 150', () => {
  close(topSpeed(30, defaultRules), 5.70, 0.01);
  close(topSpeed(80, defaultRules), 6.00, 0.001);
  close(topSpeed(130, defaultRules), 6.30, 0.01);
  close(topSpeed(150, defaultRules), 6.36, 0.01);
  for (const s of [0, 5, 255]) { const v = topSpeed(s, defaultRules); assert.ok(v > 5.6 && v < 6.4, `Spe ${s}: ${v}`); }
});

test('levels add nothing: the derived stats are the same at level 1 and level 40', () => {
  const ctx = createRun({ mode: RANGE, seed: 1, species: 'charmander' });
  const at = (lv: number) => { ctx.player.level = lv; recompute(ctx); const d = ctx.player.m.derived; return [d.maxHp, d.atk, d.spa, d.def, d.spd, d.speed]; };
  assert.deepEqual(at(1), at(40));
});

test('channels: an attacker uses its higher attack stat, and the guard is m(Def) or m(SpD)', () => {
  assert.equal(channelOf(SPECIES_BY_ID.tauros), 'physical');
  assert.equal(channelOf(SPECIES_BY_ID.mewtwo), 'special');
  const mew = SPECIES_BY_ID.mewtwo;
  close(guardOf(mew, 'physical', defaultRules), statMult(mew.stats.def, defaultRules));
  close(guardOf(mew, 'special', defaultRules), statMult(mew.stats.spd, defaultRules));
});
