// Headless simulation tests: `npm test` (node:test via tsx). No browser needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '../src/core/rng';
import { Hasher } from '../src/core/util';
import { defaultRules } from '../src/rules/defaults';
import { MOVES } from '../src/rules/moves';
import { SPECIES, SPECIES_BY_ID } from '../src/rules/species';
import { MODES, RANGE, TITLE_MODES } from '../src/mods';
import type { Mod } from '../src/mods/types';
import { classify, compileMove } from '../src/sim/moves';
import { botInput } from '../src/sim/bot';
import { createRun, step } from '../src/sim/run';
import { spawnEnemy } from '../src/sim/enemies';
import { heroHealth } from '../src/rules/stats';
import type { SimContext } from '../src/sim/types';

import { runEnded as ended } from '../scripts/lib/ended';
import { crowd } from '../scripts/lib/crowd';
function hashRun(ctx: SimContext) {
  const h = new Hasher();
  const P = ctx.player;
  h.num(P.x).num(P.z).num(P.hp).num(P.level).num(ctx.stats.kills).num(ctx.enemies.count);
  const E = ctx.enemies;
  for (let i = 0; i < E.hi; i++) if (E.alive[i]) h.num(E.x[i]).num(E.z[i]).num(E.hp[i]);
  return h.h;
}

function run(seed: number, species: string, seconds: number, opts: Parameters<typeof createRun>[0] extends infer O ? Partial<O> : never = {}) {
  const ctx = createRun({ seed, species, ...opts });
  while (ctx.time < seconds && ctx.state !== 'over') step(ctx, botInput(ctx));
  return ctx;
}

test('mulberry32 stream is stable', () => {
  const r = new Rng(12345);
  const a = [r.next(), r.next(), r.next()];
  const r2 = new Rng(12345);
  assert.deepEqual(a, [r2.next(), r2.next(), r2.next()]);
  assert.ok(a.every((v) => v >= 0 && v < 1));
});

test('enemy health is the canon curve x the behaviour multiplier and does not grow with match time', () => {
  const ctx = createRun({ seed: 1, species: 'charmander' });
  const sp = SPECIES_BY_ID.rattata;
  const e0 = spawnEnemy(ctx, 'rattata', ctx.player.x + 6, ctx.player.z);
  const want = heroHealth(sp.stats.hp, ctx.rules) * ctx.rules.enemy.behaviourHp[sp.behaviour ?? 'chase'];
  assert.ok(Math.abs(ctx.enemies.maxHp[e0] - Math.fround(want)) < 1e-9);
  const s0 = ctx.enemies.speed[e0];
  ctx.stageTime = 240; ctx.time = 240; ctx.stage = 1;
  const e1 = spawnEnemy(ctx, 'rattata', ctx.player.x - 6, ctx.player.z);
  assert.equal(ctx.enemies.maxHp[e1], ctx.enemies.maxHp[e0]);
  assert.equal(ctx.enemies.speed[e1], s0);
});

test('every move classifies to a defined archetype and scales within the clamps', () => {
  for (const m of MOVES) {
    const arch = classify(m);
    assert.ok(defaultRules.archetypes[arch], `${m.key} -> ${arch}`);
    const s = compileMove(defaultRules, m.key);
    const t = defaultRules.archetypes[arch];
    assert.ok(s.dmg >= t.dmg * 0.85 - 1e-9 && s.dmg <= t.dmg * 1.3 + 1e-9, m.key);
  }
  assert.equal(classify(MOVES.find((m) => m.key === 'mud_bomb')!), 'lob');
  assert.equal(classify(MOVES.find((m) => m.key === 'thunder_shock')!), 'chain');
  assert.equal(classify(MOVES.find((m) => m.key === 'fury_swipes')!), 'barrage');
  assert.equal(classify(MOVES.find((m) => m.key === 'giga_drain')!), 'drain');
  assert.equal(classify(MOVES.find((m) => m.key === 'magical_leaf')!), 'homing');
});

test('every species learnset references real moves', () => {
  const keys = new Set(MOVES.map((m) => m.key));
  for (const s of SPECIES) {
    if (s.starter) assert.ok(keys.has(s.starter), s.id);
    for (const [, k] of s.learnset ?? []) assert.ok(keys.has(k), `${s.id}: ${k}`);
  }
});

test('same seed + same inputs = identical run (determinism)', () => {
  const a = run(42, 'totodile', 90, { mods: [crowd(60)] });
  const b = run(42, 'totodile', 90, { mods: [crowd(60)] });
  assert.equal(hashRun(a), hashRun(b));
  assert.equal(a.stats.kills, b.stats.kills);
  const c = run(43, 'totodile', 90, { mods: [crowd(60)] });
  assert.notEqual(hashRun(a), hashRun(c));
});

test('mods and modes plug in without engine changes', () => {
  let kills = 0, hits = 0;
  const probe: Mod = { id: 'probe', name: 'probe', rules: { damage: { stab: 1.8 } }, hooks: { onKill: () => { kills++; }, modifyDamage: () => { hits++; } } };
  const ctx = createRun({ seed: 5, species: 'charmander', mode: RANGE, mods: [probe, crowd(30)] });
  assert.equal(ctx.rules.damage.stab, 1.8, 'a mod\'s rules merge over the mode\'s');
  assert.equal(ctx.hooks.modifyDamage.length, 1);
  assert.deepEqual(MODES.map((m) => m.id), ['range', 'hold'], 'the shipped modes (Q48)');
  assert.deepEqual(TITLE_MODES.map((m) => m.id), ['range'], 'Hold is URL-only until T2 (?go=1&mode=hold&map=<habitat>)');
  while (ctx.time < 60 && !ended(ctx)) step(ctx, botInput(ctx));
  assert.equal(kills, ctx.stats.kills);
  assert.ok(kills > 0 && hits > 0);
});

test('enemy pool never exceeds capacity under heavy spawning', () => {
  const ctx = run(7, 'bulbasaur', 120, { mods: [crowd(defaultRules.enemy.cap + 500, { perTick: 40 })] });
  assert.ok(ctx.enemies.count > defaultRules.enemy.cap * 0.9, `the crowd filled the pool (${ctx.enemies.count})`);
  assert.ok(ctx.enemies.count <= defaultRules.enemy.cap);
});
