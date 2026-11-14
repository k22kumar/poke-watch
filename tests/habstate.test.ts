// Environment-state transitions on the habitat maps (docs/HABITAT_STATES.md), through the real sim. The checks live in
// scripts/habstate.ts (`npx tsx scripts/habstate.ts [crater|gorge|all] [seed]` prints them with their measurements); each is
// tagged `static` (derived from the map or a rule) or `live` (the simulation is stepped through the transition with real
// actors). This file asserts every one passes on fixed seeds and that nothing in the lifecycle table has lost its check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRun, step } from '../src/sim/run';
import { applyAgent } from '../src/sim/cells';
import { ventPhase, ventTick } from '../src/sim/hazards';
import { NO_INPUT } from '../src/sim/types';
import { T } from '../src/world/tiles';
import { craterChecks, fieldOf, gorgeChecks, mk, strippedChecks, type Check } from '../scripts/habstate';

const verify = (cs: Check[]) => { for (const c of cs) assert.ok(c.ok, `${c.recipe} ${c.id} [${c.coverage}] ${c.transition}: ${c.detail}`); };

// seeds with a vent field of different sizes (4 tiles to 27) and with the river's two reaches
const CRATER = [1, 2, 5, 9], GORGE = [2, 6];

test('Cinder Crater: the vent cycle through wind-up, eruption and recovery, with actors on the boundary, entering late and leaving early', () => {
  for (const seed of CRATER) {
    const cs = craterChecks(seed);
    verify(cs);
    const ids = cs.map((c) => c.id);
    for (const want of ['static.required-travel-clear', 'static.field-on-ground', 'crater.timeline', 'crater.footprint', 'crater.late-entry', 'crater.escape', 'crater.raider-in-field', 'crater.contact', 'crater.hold-through-eruptions', 'crater.hold-geometry', 'crater.flow-field']) assert.ok(ids.includes(want), `seed ${seed}: ${want} ran`);
    assert.ok(cs.filter((c) => c.coverage === 'live').length >= 9 && cs.filter((c) => c.coverage === 'static').length === 2, `seed ${seed}: static and live coverage are reported apart`);
  }
});

test('Cinder Crater: a seed without a vent branch never reads the vent cycle', () => {
  verify(craterChecks(10));
});

test('Shrine Gorge: ice under the trainer and a creature, at the seam and in the upper reach; every water tile has a shore; spawn, support and routes with the river frozen at load', () => {
  for (const seed of GORGE) {
    const cs = gorgeChecks(seed);
    verify(cs);
    const ids = cs.map((c) => c.id);
    for (const want of ['gorge.shore-everywhere', 'gorge.frozen-at-load', 'gorge.player-on-ice-timer', 'gorge.player-on-ice-heat', 'gorge.raider-on-ice', 'gorge.upper-reach-ice', 'gorge.refreeze-occupied', 'gorge.seam-bystander', 'gorge.many-occupants', 'gorge.hold-frozen-stripped']) assert.ok(ids.includes(want), `seed ${seed}: ${want} ran`);
    assert.equal(cs.filter((c) => c.coverage === 'static').length, 2, `seed ${seed}: the two static checks`);
  }
});

test('both recipes: cover burnt and broken in the same match (to the sim\'s loss cap) leaves the Hold usable with the vents and river running', () => {
  verify(strippedChecks('volcanic-ridge', 2));
  verify(strippedChecks('river-gorge', 2));
});

test('the vent phase is whole sim steps: boundaries at 6.0 s, 7.5 s and 10.0 s, five damage ticks per eruption, whatever the float stage clock rounds to', () => {
  const ctx = mk('volcanic-ridge', 2), V = ctx.rules.habitat.vent, hz = ctx.rules.sim.hz, seen: Record<string, number> = {}, ticks: number[] = [];
  for (let i = 0; i < 2 * V.period * hz; i++) {
    step(ctx, NO_INPUT);
    const s = Math.round(ctx.stageTime * hz);
    seen[`${ventPhase(ctx)}@${s}`] ??= s;
    if (ventTick(ctx)) ticks.push(s);
  }
  const first = (p: string) => Math.min(...Object.keys(seen).filter((k) => k.startsWith(p)).map((k) => seen[k]));
  assert.equal(first('warn'), 6 * hz); assert.equal(first('active'), 7.5 * hz);
  assert.deepEqual(ticks, [450, 480, 510, 540, 570, 1050, 1080, 1110, 1140, 1170]);
  assert.equal(ventPhase(ctx), 'dormant');
});

test('vent damage is the environment\'s, not a move: independent of the trainer\'s buffs, the combat RNG and hit i-frames, and the same fraction for everyone', () => {
  const run = (buff: boolean) => {
    const ctx = mk('volcanic-ridge', 2), f = fieldOf(ctx), P = ctx.player, W = ctx.world;
    const [x, z] = [(f.edgeIn % W.w) - W.half + 0.5, ((f.edgeIn / W.w) | 0) - W.half + 0.5];
    P.x = x; P.z = z; P.y = W.height(x, z);
    if (buff) { P.buffT = 99; P.buffAtk = 3; P.buffSpe = 0; }
    const rng0 = JSON.stringify(ctx.rng.combat);
    let hurt = 0;
    for (let i = 0; i < 7.6 * 60; i++) { P.iframes = 1; step(ctx, NO_INPUT); for (const e of ctx.events) if (e.t === 'hazardHit') hurt += e.amount; }
    return { hurt, rngUntouched: JSON.stringify(ctx.rng.combat) === rng0, max: P.maxHp };
  };
  const a = run(false), b = run(true);
  assert.ok(a.hurt > 0 && Math.abs(a.hurt - 0.02 * a.max) < 1e-6, 'one tick at the onset step: 2 % of maximum HP, through i-frames');
  assert.equal(a.hurt, b.hurt, 'a buffed trainer takes the same');
  assert.ok(a.rngUntouched && b.rngUntouched, 'the eruption draws nothing from the combat stream');
});

test('ice that opens puts everyone ashore the same way twice: the shore is a pure function of the map, the body and the level', () => {
  const ctx = mk('river-gorge', 2), W = ctx.world, M = W.map;
  const k = [...Array(W.w * W.h).keys()].find((q) => M.terrain[q] === T.water && M.wlevel![q] < 0)!, x = (k % W.w) - W.half + 0.5, z = ((k / W.w) | 0) - W.half + 0.5;
  const a = W.shore(x, z, 0.55, 0), b = W.shore(x, z, 0.55, 0);
  assert.deepEqual(a, b); assert.ok(a);
  // a thaw with nobody on the tile changes nothing but the tile
  applyAgent(ctx, 'cold', x, z, 0.5);
  const hp = ctx.player.hp, at = [ctx.player.x, ctx.player.z];
  for (let i = 0; i < 15 * 60; i++) step(ctx, NO_INPUT);
  assert.ok(!W.cells.iceAt(k) && ctx.player.hp >= hp && ctx.player.x === at[0] && ctx.player.z === at[1], 'an empty thaw moves and hurts no one');
});

test('hazards off: ice that opens under the trainer on a classic region puts them ashore instead of leaving them stuck in the water (the rule before liquids could be entered)', () => {
  const ctx = createRun({ seed: 3, species: 'totodile', ruleOverrides: { worldgen: { mode: 'generated', locations: { meadow: '', dusk: '', badlands: '', frost: '' } }, hazards: { enabled: false } } as never });
  const W = ctx.world, P = ctx.player, c = (k: number): [number, number] => [(k % W.w) - W.half + 0.5, ((k / W.w) | 0) - W.half + 0.5];
  const k = [...Array(W.w * W.h).keys()].find((q) => W.map.terrain[q] === T.water && W.isOpen(q - 1) && W.map.terrain[q - 1] !== T.water && W.isOpen(q - 2) && W.isOpen(q - 3));
  assert.ok(k !== undefined, 'a river tile with a bank beside it');
  applyAgent(ctx, 'cold', ...c(k!), 0.5);
  assert.ok(W.cells.iceAt(k!));
  [P.x, P.z] = c(k!); P.y = W.height(P.x, P.z);
  applyAgent(ctx, 'heat', ...c(k!), 0.5);
  for (let i = 0; i < 20; i++) step(ctx, NO_INPUT);
  assert.ok(W.map.terrain[W.tile(P.x, P.z)] !== T.water && W.isOpen(W.tile(P.x, P.z)), 'on dry open ground');
  assert.ok(P.hp < P.maxHp, 'the cold water cost HP');
  const x0 = P.x; for (let i = 0; i < 60; i++) step(ctx, { ...NO_INPUT, mx: -1 });
  assert.ok(Math.abs(P.x - x0) > 0.5, 'and the trainer can walk on');
});

test('hazards on: ice that opens under the trainer on a classic region leaves them in the water where they stood, and the exposure rule decides', () => {
  for (const [species, safe] of [['totodile', true], ['rattata', false]] as const) {
    const ctx = createRun({ seed: 3, species, ruleOverrides: { worldgen: { mode: 'generated', locations: { meadow: '', dusk: '', badlands: '', frost: '' } }, director: { spawnBase: -99 } } as never });
    const W = ctx.world, P = ctx.player, c = (k: number): [number, number] => [(k % W.w) - W.half + 0.5, ((k / W.w) | 0) - W.half + 0.5];
    const k = [...Array(W.w * W.h).keys()].find((q) => W.map.terrain[q] === T.water && W.isOpen(q - 1) && W.map.terrain[q - 1] !== T.water && W.isOpen(q - 2) && W.isOpen(q - 3))!;
    applyAgent(ctx, 'cold', ...c(k), 0.5);
    [P.x, P.z] = c(k); P.y = W.height(P.x, P.z);
    applyAgent(ctx, 'heat', ...c(k), 0.5);
    for (let i = 0; i < 20; i++) step(ctx, NO_INPUT);
    assert.equal(W.tile(P.x, P.z), k, `${species}: not moved`);
    if (safe) assert.ok(P.hzSafe === 1 && P.hzKind === 0 && P.hp === P.maxHp, 'a Water type swims, unhurt');
    else assert.ok(P.hzKind === 1 && P.hp < P.maxHp, 'anyone else is exposed and losing HP');
    for (let i = 0; i < 90 && W.map.terrain[W.tile(P.x, P.z)] === T.water; i++) step(ctx, { ...NO_INPUT, mx: -1 });
    for (let i = 0; i < 6; i++) step(ctx, { ...NO_INPUT, mx: -1 });
    assert.ok(W.map.terrain[W.tile(P.x, P.z)] !== T.water && P.hzKind === 0 && ctx.state === 'play', `${species}: walks out onto the bank`);
  }
});

test('a classic region with frozen water behaves as before when nobody is on the ice', () => {
  const ctx = createRun({ seed: 3, species: 'totodile', ruleOverrides: { worldgen: { mode: 'generated', locations: { meadow: '', dusk: '', badlands: '', frost: '' } } } as never });
  const W = ctx.world, k = [...Array(W.w * W.h).keys()].find((q) => W.map.terrain[q] === T.water);
  if (k === undefined) return;
  applyAgent(ctx, 'cold', (k % W.w) - W.half + 0.5, ((k / W.w) | 0) - W.half + 0.5, 0.5);
  assert.ok(W.cells.iceAt(k));
  for (let i = 0; i < 14 * 60; i++) step(ctx, NO_INPUT);
  assert.ok(!W.cells.iceAt(k) && W.cells.melted.length === 0, 'it thawed and the queue drained');
});
