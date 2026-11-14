// Liquid exposure and exposed falls (docs/HAZARDS.md). The live cases are scripts/hazplay.ts: real sim, ordinary move
// input, spots found on the final collision of fixed map seeds (Shrine Gorge 3 and 7, Cinder Crater 7, Mt. Moon 1,
// Chargestone Cave 1, Viridian Forest 1). This file asserts each passes and that none has gone missing, plus the rules
// that need no map.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cases, mkRun } from '../scripts/hazplay';
import { dominant, LIQUID, safeIn } from '../src/sim/hazards';
import { createRun, step } from '../src/sim/run';
import { NO_INPUT } from '../src/sim/types';
import { T } from '../src/world/tiles';

const all = cases();
const byId = (id: string) => all.filter((c) => c.id === id);

test('every live hazard case passes (water, lava, chasms, ledges, creatures)', () => {
  for (const c of all) assert.ok(c.ok, `${c.id} ${c.map} seed ${c.seed} tile ${c.tile}: ${c.detail}`);
});

test('the live cases cover what the hazard rules promise', () => {
  const want = [
    'water.safe.totodile', 'water.safe.charmander', 'water.safe.squirtle', 'water.escape.rattata', 'water.ko.rattata',
    'water.maxhp', 'water.healing', 'water.cadence.60hz', 'water.cadence.20hz', 'water.cadence.10hz', 'water.rate',
    'water.cells-exit-reenter', 'water.jump', 'water.tag-compatible', 'water.recover', 'water.bridge', 'water.ice', 'water.thaw',
    'lava.escape', 'lava.ko', 'lava.immune', 'lava.fire-default',
    'void.walk.ground-lip', 'void.walk.bridge-deck-side', 'void.diagonal', 'void.knocked', 'void.recover', 'void.creature',
    'ledge.solid', 'ledge.liquid', 'water.creature', 'water.creature-ko',
  ];
  for (const id of want) assert.ok(byId(id).length > 0, `${id} ran`);
  // both gorge seeds, and a real bridge-side fall (Viridian Forest's gully)
  assert.deepEqual(byId('water.ko.rattata').map((c) => c.seed), [3, 7]);
  assert.ok(byId('void.walk.bridge-deck-side').some((c) => c.map === 'viridian-forest' && c.tile !== '-'));
});

test('water safety: the Water type in either slot of a dual type, or Surf in the move set; lava: the explicit flag only', () => {
  const ctx = createRun({ seed: 1, species: 'rattata' });
  assert.ok(safeIn(ctx, LIQUID.water, { id: 'x', elements: ['tide'] }));
  assert.ok(safeIn(ctx, LIQUID.water, { id: 'x', elements: ['stone', 'tide'] }), 'dual type, Water second');
  assert.ok(!safeIn(ctx, LIQUID.water, { id: 'x', elements: ['plain'] }));
  assert.ok(safeIn(ctx, LIQUID.water, { id: 'x', elements: ['blaze'] }, [{ key: 'ember' }, { key: 'surf' }]), 'Surf anywhere in the move set, cooldown or not');
  assert.ok(!safeIn(ctx, LIQUID.lava, { id: 'charmander', elements: ['blaze'] }), 'no Fire-type rule by default');
  assert.ok(!safeIn(ctx, LIQUID.lava, { id: 'totodile', elements: ['tide'] }, [{ key: 'surf' }]), 'Surf does nothing for lava');
  const c2 = createRun({ seed: 1, species: 'rattata', ruleOverrides: { hazards: { lava: { safeSpecies: ['slugma'] } } } as never });
  assert.ok(safeIn(c2, LIQUID.lava, { id: 'slugma', elements: ['blaze'] }));
});

test('overlapping liquids: the shorter lethal time decides, whichever came first', () => {
  const ctx = createRun({ seed: 1, species: 'rattata' });
  assert.equal(dominant(ctx, LIQUID.water, LIQUID.lava), LIQUID.lava);
  assert.equal(dominant(ctx, LIQUID.lava, LIQUID.water), LIQUID.lava);
  assert.equal(dominant(ctx, 0, LIQUID.water), LIQUID.water);
  assert.equal(dominant(ctx, LIQUID.water, LIQUID.water), LIQUID.water);
});

test('hazards off: water is a wall again and chasms are rock (the rules before this layer)', () => {
  const on = mkRun('river-gorge', 3, 'rattata'), off = mkRun('river-gorge', 3, 'rattata', { hazards: { enabled: false } });
  const k = [...Array(on.world.w * on.world.h).keys()].find((q) => on.world.map.terrain[q] === T.water && !on.world.cells.iceAt(q) && !(on.world.map.over && on.world.map.over[q] > 0))!;
  const x = (k % on.world.w) - on.world.half + 0.5, z = ((k / on.world.w) | 0) - on.world.half + 0.5;
  assert.ok(!on.world.collides(x, z, 0, 0.6) && off.world.collides(x, z, 0, 0.6));
  assert.ok(on.world.blocks(x, z, 0, 0.6) && off.world.blocks(x, z, 0, 0.6), 'steering still treats water as a place to avoid');
  const m = mkRun('mt-moon', 1, 'rattata'), mo = mkRun('mt-moon', 1, 'rattata', { hazards: { enabled: false } });
  const v = [...Array(m.world.w * m.world.h).keys()].find((q) => m.world.isVoid(q))!;
  assert.ok(v !== undefined && !mo.world.isVoid(v) && mo.world.map.wall[v] === 1);
  const vx = (v % m.world.w) - m.world.half + 0.5, vz = ((v / m.world.w) | 0) - m.world.half + 0.5;
  assert.equal(m.world.support(vx, vz, 10), -Infinity);
  assert.ok(mo.world.support(vx, vz, 10) > -Infinity && mo.world.wallAt(vx, vz) && !m.world.wallAt(vx, vz));
  // nothing of the exposure state moves with the layer off
  for (let i = 0; i < 120; i++) step(off, NO_INPUT);
  assert.equal(off.player.hzKind, 0);
});
