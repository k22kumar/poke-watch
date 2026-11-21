// The training range and the match foundation (docs/hero-shooter-pivot.md §8 step 7; Q10, Q14, Q16, Q17, Q20): the
// authored range arena, T0 target sets (canon health, pinned, fixed-tick respawn, a dummy that never touches you, a
// strafer that shoots back at reduced damage), the hero's respawn (no fail state), the loadout with swapping as an
// opt-in system, and the Hold mode on a habitat map.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRun, step } from '../src/sim/run';
import { BTN, NO_INPUT, type InputFrame, type SimContext } from '../src/sim/types';
import { HOLD, RANGE, RANGE_SWAP } from '../src/mods';
import { RANGE_TARGETS, type TargetSet } from '../src/rules/targets';
import { heroHealth } from '../src/rules/stats';
import { SPECIES_BY_ID } from '../src/rules/species';
import { killEnemy } from '../src/sim/combat';
import { faint } from '../src/sim/squad';
import { holdBody, pushBody, spawnBody, TEAM } from '../src/sim/bodies';
import { BODY_KINDS } from '../src/rules/materials';

const range = (species = 'charmander', targets: TargetSet = RANGE_TARGETS) =>
  createRun({ mode: RANGE, seed: 1, species, ruleOverrides: { worldgen: { arena: 'range' } } as never, targets });
const steps = (ctx: SimContext, n: number, inp: Partial<InputFrame> = {}) => { const evs: string[] = []; for (let i = 0; i < n; i++) for (const e of step(ctx, { ...NO_INPUT, ...inp })) evs.push(e.t); return evs; };

test('the range arena carries its target set: canon health, no survivor curves, a dummy stands and never touches you', () => {
  const ctx = range();
  assert.equal(ctx.world.map.id, 'range');
  const T = ctx.targets!, E = ctx.enemies;
  assert.equal(T.slot.length, RANGE_TARGETS.targets.length);
  for (let k = 0; k < T.slot.length; k++) {
    const d = RANGE_TARGETS.targets[k], i = T.slot[k];
    assert.ok(i >= 0 && E.alive[i], `${d.species} is up`);
    const want = heroHealth(SPECIES_BY_ID[d.species].stats.hp, ctx.rules) * ctx.rules.targets.hp[d.kind];
    assert.ok(Math.abs(E.maxHp[i] - want) < 1e-3, `${d.species}: canon health ${E.maxHp[i]} (float32) vs ${want}`);
    if (d.kind !== 'strafe') assert.equal(E.dmg[i], 0, `${d.species}: harmless`);
  }
  // stand beside the Geodude dummy for 3 s: it does not move and does not hurt
  const g = T.slot[0], P = ctx.player;
  P.x = P.px = E.x[g] + 0.9; P.z = P.pz = E.z[g]; P.y = P.py = ctx.world.height(P.x, P.z);
  const gx = E.x[g], gz = E.z[g], hp = P.hp;
  // (the strafer is out of reach here: kill it so only the dummy is near)
  killEnemy(ctx, T.slot[3]);
  steps(ctx, 180);
  assert.ok(Math.hypot(E.x[g] - gx, E.z[g] - gz) < 0.05, 'the dummy stands');
  assert.ok(P.hp >= hp - 1e-6, `no damage from a dummy (${hp.toFixed(1)} → ${P.hp.toFixed(1)})`);
});

test('a target that falls comes back on a fixed tick count, at its anchor, with no RNG', () => {
  const run = () => {
    const ctx = range(), T = ctx.targets!, E = ctx.enemies, i = T.slot[0], x0 = E.x[i], z0 = E.z[i];
    steps(ctx, 5);
    killEnemy(ctx, i);
    const fell = ctx.tick, wait = Math.round(ctx.rules.targets.respawn / ctx.dt);
    let backAt = -1;
    for (let t = 0; t < wait + 30 && backAt < 0; t++) { steps(ctx, 1); if (T.slot[0] >= 0) backAt = ctx.tick; }
    const j = T.slot[0];
    return { delay: backAt - fell, at: [E.x[j], E.z[j]], home: [x0, z0], wait };
  };
  const a = run(), b = run();
  assert.ok(Math.abs(a.delay - a.wait) <= 1, `back after ${a.delay} ticks (rule ${a.wait})`);
  assert.deepEqual(a, b, 'deterministic');
  assert.ok(Math.hypot(a.at[0] - a.home[0], a.at[1] - a.home[1]) < 0.01, 'at its anchor');
});

test('the strafer shoots back at reduced damage; targets are never relocated however far you go', () => {
  const ctx = range('charmander', { id: 'one', targets: [{ species: 'gastly', kind: 'strafe', from: 'spawn', dx: 0, dz: -10 }] });
  const T = ctx.targets!, E = ctx.enemies, i = T.slot[0];
  assert.ok(E.dmg[i] > 0, 'it can hurt');
  let hurt = 0;
  for (let t = 0; t < 60 * 20; t++) for (const e of step(ctx, NO_INPUT)) if (e.t === 'playerHurt') hurt++;
  assert.ok(hurt > 0, 'it shot the standing player');
  // walk far away: an ordinary enemy past rules.enemy.despawnDistance is moved onto a ring ahead; a target stays
  const P = ctx.player, x0 = E.x[i], z0 = E.z[i];
  P.x = P.px = x0 + ctx.rules.enemy.despawnDistance + 5 > ctx.world.bound - 2 ? -ctx.world.bound + 6 : x0 + ctx.rules.enemy.despawnDistance + 5;
  P.z = P.pz = ctx.world.bound - 6; P.y = P.py = ctx.world.height(P.x, P.z);
  steps(ctx, 60);
  assert.ok(Math.hypot(E.x[i] - x0, E.z[i] - z0) < 15, 'not relocated to a ring ahead of the player');
});

test('the range has no fail state: a hero with no Pokémon left comes back at the spawn at full health', () => {
  const ctx = range(), P = ctx.player, [sx, sz] = ctx.world.spawn;
  steps(ctx, 30, { mx: 1 });
  P.hp = 0; faint(ctx);
  assert.equal(ctx.state, 'play', 'no game over');
  assert.ok(P.respawnT > 0);
  const evs = steps(ctx, Math.round(ctx.rules.hero.respawn / ctx.dt) + 2);
  assert.ok(evs.includes('respawn'));
  assert.equal(P.respawnT, 0);
  assert.equal(P.hp, P.maxHp);
  assert.ok(!P.m.fainted);
  assert.ok(Math.hypot(P.x - sx, P.z - sz) < 0.5, 'at the spawn');
});

test('loadout: the range is solo (no swap system); the swap mode brings three Pokémon and Tag swaps them', () => {
  const solo = range();
  assert.equal(solo.player.squad.length, 1);
  assert.ok(!solo.systems.some((s) => s.name === 'swap'), 'the swap system is opt-in');
  const ctx = createRun({ mode: RANGE_SWAP, seed: 1, species: 'charmander', loadout: ['squirtle', 'bulbasaur', 'totodile'], ruleOverrides: { worldgen: { arena: 'range' } } as never });
  assert.ok(ctx.systems.some((s) => s.name === 'swap'));
  assert.deepEqual(ctx.player.squad.map((m) => m.species.id), ['charmander', 'squirtle', 'bulbasaur'], 'three: the loadout rule caps it');
  for (const m of ctx.player.squad.slice(1)) assert.ok(m.moves.length >= 2 && m.hp === m.maxHp, `${m.species.id}: its hero kit, at full health`);
  steps(ctx, 30);
  const evs = [...steps(ctx, 2, { btn: BTN.sig }), ...steps(ctx, 2)];
  assert.ok(evs.includes('tag'), 'a Tag tap swaps');
  assert.equal(ctx.player.species.id, 'squirtle');
});

test('the Hold mode opens the point on a habitat map at the start; on the range it does nothing', () => {
  const id = 'river-gorge';
  const ctx = createRun({ mode: HOLD, seed: 1, species: 'bulbasaur', ruleOverrides: { worldgen: { mode: 'generated', regionSeed: 1, locations: { meadow: id, dusk: id, badlands: id, frost: id } } } as never });
  steps(ctx, 2);
  const O = ctx.objective, H = ctx.world.hab!;
  assert.ok(O && O.kind === 'hold', 'a Hold');
  assert.ok(Math.hypot(O!.x - (H.contest.x - ctx.world.half), O!.z - (H.contest.y - ctx.world.half)) < 0.01, 'on the contest floor');
  const flat = createRun({ mode: HOLD, seed: 1, species: 'bulbasaur', ruleOverrides: { worldgen: { arena: 'range' } } as never });
  steps(flat, 2);
  assert.equal(flat.objective, null);
});

test('the range\'s Light throwables: a hold picks one up and a release throws it, and an unbreakable body survives changing hands', () => {
  const ctx = range('tauros'), B = ctx.bodies, P = ctx.player, cob = BODY_KINDS.indexOf('cobble');
  const mine: number[] = [];
  for (let b = 0; b < B.hi; b++) if (B.alive[b] && B.kind[b] === cob) mine.push(b);
  assert.equal(mine.length, ctx.world.map.throwables!.length, 'every throwable is down');
  const b = mine[0];
  P.x = P.px = B.x[b] + 1.2; P.z = P.pz = B.z[b]; P.y = P.py = ctx.world.height(P.x, P.z);
  // Power 1 (Wrap) against Weight 1: held, kept by its button; changing hands from neutral used to break an integrity-0 body
  assert.ok(holdBody(ctx, b, 1, P.x - B.x[b], P.z - B.z[b], TEAM.player, BTN.b), 'held');
  assert.ok(B.alive[b] && B.holdT[b] > 0, 'alive and suspended');
  steps(ctx, 20, { btn: BTN.b });
  steps(ctx, 2);
  assert.ok(B.alive[b] && B.holdT[b] === 0 && Math.hypot(B.vx[b], B.vz[b]) > 1, 'released along the aim: thrown');
  // the Transport egg (integrity 0 too) pushed by Power 2: it rolls and stays whole
  const egg = spawnBody(ctx, 'egg', P.x + 3, P.z);
  assert.ok(pushBody(ctx, egg, 2, 1, 0, TEAM.player));
  assert.ok(B.alive[egg], 'an unbreakable body never breaks for changing hands');
});
