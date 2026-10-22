// Enemy roles, objectives and the beat director (blueprint section 9, Phase 7).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRun, step } from '../src/sim/run';
import { spawnEnemy } from '../src/sim/enemies';
import { damageEnemy, type DamageSpec } from '../src/sim/combat';
import { blockedByBulwark } from '../src/sim/effects';
import { startObjective } from '../src/sim/objectives';
import { forcePeak } from '../src/sim/director';
import { botInput } from '../src/sim/bot';
import { PK, ROLE } from '../src/sim/pools';
import { AG } from '../src/rules/reactions';
import { COMPOSITIONS, resolve } from '../src/rules/compositions';
import { STAGES } from '../src/rules/stages';
import { NO_INPUT, type InputFrame, type SimContext } from '../src/sim/types';

function calm(species = 'totodile', seed = 3): SimContext {
  const ctx = createRun({ seed, species, ruleOverrides: { director: { spawnBase: -99, spawnPerMin: 0, spawnPerStage: 0, eliteEvery: 9999, swarmEvery: 9999 }, bodies: { looseRocks: 0 }, beats: { enabled: false } } as never });
  for (let i = 0; i < 6; i++) step(ctx, NO_INPUT);
  return ctx;
}
const secs = (ctx: SimContext, s: number, inp: InputFrame = NO_INPUT) => { for (let i = 0; i < Math.round(s * 60); i++) step(ctx, inp); };
function foe(ctx: SimContext, id: string, dx: number, dz: number, roles = 0) {
  const e = spawnEnemy(ctx, id, ctx.player.x + dx, ctx.player.z + dz, roles);
  ctx.enemies.spawnT[e] = 1;
  ctx.grid.rebuild(ctx.enemies.hi, ctx.enemies.x, ctx.enemies.z, ctx.enemies.alive);
  return e;
}
const hit = (element: DamageSpec['element'], cls: DamageSpec['cls'] = 'special'): DamageSpec => ({ element, cls, ailment: 'knock', chance: 0, knock: 0, kx: 0, kz: 0, drain: 0, source: 'test' });
const teleport = (ctx: SimContext, x: number, z: number) => { const P = ctx.player; P.x = P.px = x; P.z = P.pz = z; P.y = P.py = ctx.world.height(x, z); };

test('every composition can be fielded somewhere, and the wall can be built in every region', () => {
  for (const c of COMPOSITIONS) assert.ok(STAGES.some((t) => resolve(c, t)), c.id);
  for (const t of STAGES) assert.ok(resolve(COMPOSITIONS.find((c) => c.id === 'wall-and-guns')!, t), t.biome);
  assert.ok(resolve(COMPOSITIONS.find((c) => c.id === 'soak-and-strike')!, STAGES[0]), 'Sunpetal Meadow fields Soak and strike');
});

test('a Hexer warns, then lays a deep agent where you were heading and coats you', () => {
  const ctx = calm('cyndaquil');
  const e = foe(ctx, 'poliwag', 8, 0, ROLE.hexer);
  ctx.enemies.attackCd[e] = 0;
  let warned: { x: number; z: number } | null = null;
  for (let k = 0; k < 60 && !warned; k++) for (const ev of step(ctx, NO_INPUT)) if (ev.t === 'hex') warned = ev;
  assert.ok(warned, 'a hex telegraph');
  secs(ctx, 1);
  assert.equal(ctx.player.m.coat, AG.wet, 'Soaked');
  assert.equal(ctx.player.m.coatDeep, 2, 'deep');
});

test('a Bulwark blocks shots at its front, not from behind, and Fighting breaks its guard', () => {
  const ctx = calm();
  const P = ctx.player, E = ctx.enemies, Pr = ctx.projectiles;
  const b = foe(ctx, 'geodude', 0, 6, ROLE.shielder);
  E.facing[b] = Math.atan2(P.x - E.x[b], P.z - E.z[b]); // facing the player
  ctx.director.bulwarks = [b];
  const shot = (x: number, z: number, vx: number, vz: number) => { const i = Pr.spawn(); Pr.kind[i] = PK.straight; Pr.x[i] = x; Pr.z[i] = z; Pr.vx[i] = vx; Pr.vz[i] = vz; return i; };
  assert.ok(blockedByBulwark(ctx, shot(E.x[b], E.z[b] - 1.5, 0, 12)), 'front shot blocked');
  assert.ok(!blockedByBulwark(ctx, shot(E.x[b], E.z[b] + 1.5, 0, -12)), 'shot from behind passes');
  damageEnemy(ctx, b, 1, hit('brawl', 'physical'));
  assert.ok(E.guardDown[b] > 0, 'guard broken');
  secs(ctx, 1 / 60);
  assert.ok(!ctx.director.bulwarks.includes(b), 'no longer shielding');
});

test('Hold: standing on the pad for 30 s pays an item ball', () => {
  const ctx = calm();
  assert.ok(startObjective(ctx, 'hold'));
  const O = ctx.objective!;
  teleport(ctx, O.x, O.z);
  secs(ctx, 0.5);
  assert.equal(O.phase, 'active');
  // Raiders arrive with it; on the pad they drain it faster than you charge it
  const E = ctx.enemies;
  const raiders = () => { const out: number[] = []; for (let e = 0; e < E.hi; e++) if (E.alive[e] && E.roles[e] & ROLE.raider) out.push(e); return out; };
  assert.ok(raiders().length >= 3, 'a raid party');
  for (const e of raiders()) { E.x[e] = O.x + 0.5; E.z[e] = O.z; E.speed[e] = 0; }
  const c0 = O.charge;
  secs(ctx, 2);
  assert.ok(O.charge <= c0, 'four Raiders out-drain one defender');
  for (const e of raiders()) damageEnemy(ctx, e, 1e9, hit('plain'));
  teleport(ctx, O.x, O.z);
  secs(ctx, 31);
  assert.equal(O.phase, 'done');
  assert.ok(ctx.cards.offer && ctx.cards.chest, 'item ball offered');
});

test('Hunt: the marked target runs to its Mender when hurt, and defeating it offers it as a recruit', () => {
  const ctx = calm();
  assert.ok(startObjective(ctx, 'hunt'));
  const O = ctx.objective!, E = ctx.enemies;
  assert.ok(E.roles[O.target] & ROLE.hunt);
  E.hp[O.target] = E.maxHp[O.target] * 0.4;
  const m = O.mender;
  if (m >= 0) {
    const before = Math.hypot(E.x[O.target] - E.x[m], E.z[O.target] - E.z[m]);
    secs(ctx, 1.5);
    assert.ok(Math.hypot(E.x[O.target] - E.x[m], E.z[O.target] - E.z[m]) < before, 'it heads for the Mender');
  }
  damageEnemy(ctx, O.target, 1e9, hit('plain'));
  secs(ctx, 0.1);
  assert.equal(O.phase, 'done');
  secs(ctx, 0.1);
  assert.equal(ctx.cards.source, 'recruit');
  assert.ok(ctx.cards.offer!.some((c) => c.key === O.species), 'the hunted species is on offer');
});

test('Transport: carrying slows you and locks Move A / B; delivering the egg evolves the field Pokémon', () => {
  const ctx = calm('totodile');
  assert.ok(startObjective(ctx, 'transport'));
  const O = ctx.objective!, B = ctx.bodies;
  teleport(ctx, B.x[O.egg], B.z[O.egg] - 0.5);
  secs(ctx, 0.2);
  assert.equal(O.carrier, -2);
  assert.ok(ctx.player.carrying);
  assert.equal(O.phase, 'active');
  teleport(ctx, O.x, O.z);
  secs(ctx, 0.3);
  assert.equal(O.phase, 'done');
  assert.equal(ctx.player.species.id, 'croconaw');
  assert.ok(!ctx.player.carrying);
});

test('an ignored objective lapses after 45 s and brings a Peak forward', () => {
  const ctx = createRun({ seed: 4, species: 'totodile', ruleOverrides: { director: { spawnBase: -99, spawnPerMin: 0, spawnPerStage: 0, eliteEvery: 9999, swarmEvery: 9999 }, bodies: { looseRocks: 0 } } as never });
  secs(ctx, 1);
  assert.equal(ctx.beat.phase, 'build');
  assert.ok(startObjective(ctx, 'hold'));
  teleport(ctx, ctx.objective!.x + 30, ctx.objective!.z); // far away
  let expired = false;
  for (let k = 0; k < 47 * 60; k++) for (const ev of step(ctx, NO_INPUT)) if (ev.t === 'objective' && ev.phase === 'expired') expired = true;
  assert.ok(expired);
  assert.equal(ctx.beat.phase, 'peak');
  // a forced peak never opens another objective
  forcePeak(ctx);
});

test('the beat director cycles Build, Peak and Relax and opens the first objective after 1:30', () => {
  const ctx = createRun({ seed: 2, species: 'cyndaquil' });
  const phases: string[] = [];
  const opened: string[] = [];
  while (ctx.stageTime < 200 && ctx.state !== 'over') {
    for (const ev of step(ctx, botInput(ctx))) {
      if (ev.t === 'beat') phases.push(ev.phase);
      if (ev.t === 'objective' && ev.phase === 'offer') opened.push(`${ev.kind}@${ctx.stageTime.toFixed(0)}`);
    }
  }
  assert.deepEqual(phases.slice(0, 3), ['peak', 'relax', 'build']);
  assert.ok(opened.length >= 1, 'an objective by 3:20');
  assert.match(opened[0], /^hold@/, 'region 1 opens with a Hold');
  assert.ok(Number(opened[0].split('@')[1]) >= 90);
});
