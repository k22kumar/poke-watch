// Creature coats and reactions (blueprint section 8, Phase 5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRun, step } from '../src/sim/run';
import { spawnEnemy } from '../src/sim/enemies';
import { damageEnemy } from '../src/sim/combat';
import { ccApply, coatEnemy } from '../src/sim/coats';
import { ROLE, ZK } from '../src/sim/pools';
import { AG } from '../src/rules/reactions';
import type { DamageSpec } from '../src/sim/combat';
import type { InputFrame, SimContext } from '../src/sim/types';
import type { Element } from '../src/rules/elements';

const NONE: InputFrame = { mx: 0, mz: 0, jump: false, dash: false };
function calm(): SimContext {
  const ctx = createRun({ seed: 2, species: 'totodile', ruleOverrides: { director: { spawnBase: -99, spawnPerMin: 0, spawnPerStage: 0 }, bodies: { looseRocks: 0 } } as never });
  for (let i = 0; i < 6; i++) step(ctx, NONE);
  return ctx;
}
/** spawn a creature on dry walkable ground near the player, past its spawn fade */
function foe(ctx: SimContext, id: string, dx: number, dz: number, roles = 0) {
  const e = spawnEnemy(ctx, id, ctx.player.x + dx, ctx.player.z + dz, roles);
  ctx.enemies.spawnT[e] = 1;
  ctx.enemies.hp[e] = ctx.enemies.maxHp[e] = 1e6;
  ctx.grid.rebuild(ctx.enemies.hi, ctx.enemies.x, ctx.enemies.z, ctx.enemies.alive);
  return e;
}
const spec = (element: Element, depth: number, cls: DamageSpec['cls'] = 'special'): DamageSpec => ({ element, cls, ailment: 'knock', chance: 0, knock: 0, kx: 0, kz: 0, drain: 0, source: 'test', depth });

test('light coats stick to fodder but not to elites; deep coats stick to both', () => {
  const ctx = calm(), E = ctx.enemies;
  const a = foe(ctx, 'rattata', 3, 0), b = foe(ctx, 'rattata', -3, 0, ROLE.elite);
  damageEnemy(ctx, a, 5, spec('tide', 1));
  damageEnemy(ctx, b, 5, spec('tide', 1));
  assert.equal(E.coat[a], AG.wet);
  assert.equal(E.coatDeep[a], 1);
  assert.equal(E.coat[b], 0, 'elite ignores a light coat');
  damageEnemy(ctx, b, 5, spec('tide', 2));
  assert.equal(E.coat[b], AG.wet);
  assert.equal(E.coatDeep[b], 2);
});

test('the basic attack cannot spend a deep coat', () => {
  const ctx = calm(), E = ctx.enemies;
  const a = foe(ctx, 'rattata', 3, 0);
  damageEnemy(ctx, a, 5, spec('tide', 2));
  damageEnemy(ctx, a, 5, spec('volt', 1));
  assert.equal(E.coat[a], AG.wet, 'still Soaked');
  assert.equal(E.coatDeep[a], 2);
});

test('Conduct chains a deep Charge through every Soaked creature in reach and stuns them', () => {
  const ctx = calm(), E = ctx.enemies;
  const soaked = [foe(ctx, 'rattata', 3, 0), foe(ctx, 'rattata', 4, 2), foe(ctx, 'rattata', 5, -2)];
  const dry = foe(ctx, 'rattata', 4, 0.5);
  for (const e of soaked) damageEnemy(ctx, e, 5, spec('tide', 2));
  const before = soaked.map((e) => E.hp[e]);
  ctx.events.length = 0;
  damageEnemy(ctx, soaked[0], 20, spec('volt', 2));
  const ev = ctx.events.find((x) => x.t === 'react');
  assert.ok(ev && ev.t === 'react' && ev.kind === 'conduct' && ev.n === 3, 'one Conduct hitting all three');
  for (let k = 0; k < 3; k++) {
    assert.equal(E.coat[soaked[k]], 0, 'the Soak is spent');
    assert.ok(E.stun[soaked[k]] > 0.5, 'stunned');
    assert.ok(E.hp[soaked[k]] < before[k], 'hurt');
  }
  assert.equal(E.stun[dry], 0, 'a dry neighbour is untouched');
});

test('Ground types ignore Charge: no coat and no Conduct', () => {
  const ctx = calm(), E = ctx.enemies;
  const g = foe(ctx, 'sandshrew', 3, 0);
  damageEnemy(ctx, g, 5, spec('tide', 2));
  coatEnemy(ctx, g, AG.charge, 2, 20);
  assert.equal(E.stun[g], 0);
});

test('Freeze from Wet and Cold; a physical hit shatters it for double damage', () => {
  const ctx = calm(), E = ctx.enemies;
  const a = foe(ctx, 'rattata', 3, 0), b = foe(ctx, 'rattata', -3, 0);
  for (const e of [a, b]) damageEnemy(ctx, e, 5, spec('tide', 2));
  damageEnemy(ctx, a, 5, spec('frost', 2));
  assert.ok(E.frozen[a] > 2.5, 'frozen for the deep time');
  ctx.events.length = 0;
  const hpA = E.hp[a], hpB = E.hp[b];
  damageEnemy(ctx, b, 30, spec('plain', 0, 'physical'));
  const plain = hpB - E.hp[b];
  damageEnemy(ctx, a, 30, spec('plain', 0, 'physical'));
  const shattered = hpA - E.hp[a];
  assert.ok(ctx.events.some((x) => x.t === 'react' && x.kind === 'shatter'));
  assert.ok(shattered > plain * 1.6, `shatter ${shattered.toFixed(1)} vs ${plain.toFixed(1)}`);
  assert.equal(E.frozen[a], 0);
});

test('Steam spends the burn and blinds the enemies inside its cloud', () => {
  const ctx = calm(), E = ctx.enemies;
  const a = foe(ctx, 'rattata', 3, 0), b = foe(ctx, 'rattata', 4, 1);
  damageEnemy(ctx, a, 5, spec('blaze', 2));
  E.burn[a] = 3; E.dot[a] = 5;
  damageEnemy(ctx, a, 5, spec('tide', 2));
  assert.equal(E.burn[a], 0, 'the burn is spent');
  let steam = -1;
  for (let i = 0; i < ctx.zones.hi; i++) if (ctx.zones.alive[i] && ctx.zones.kind[i] === ZK.steam) steam = i;
  assert.ok(steam >= 0, 'a steam cloud');
  step(ctx, NONE); step(ctx, NONE);
  assert.ok(E.blind[b] > 0, 'a neighbour inside the cloud lost its target');
});

test('the crowd-control meter grants immunity after 2 s of control', () => {
  const ctx = calm(), E = ctx.enemies;
  const a = foe(ctx, 'rattata', 3, 0);
  assert.equal(ccApply(ctx, a, 1.2), 1.2);
  assert.equal(ccApply(ctx, a, 1.2), 1.2);
  assert.ok(E.ccImmune[a] > 0, 'immune after 2.4 s');
  assert.equal(ccApply(ctx, a, 1), 0);
  const boss = foe(ctx, 'sudowoodo', -4, 0, ROLE.boss);
  ccApply(ctx, boss, 1.1);
  assert.ok(E.ccImmune[boss] > 0, 'bosses fill it twice as fast');
});

test('tiles coat what stands on them, and a Soaked Pokémon carries its coat', () => {
  const ctx = calm();
  const C = ctx.world.cells;
  const k = C.tile(ctx.player.x, ctx.player.z);
  C.set(k, 1, 10); // wet
  for (let i = 0; i < 70; i++) step(ctx, NONE);
  assert.equal(ctx.player.m.coat, AG.wet);
});
