// Headless simulation tests: `npm test` (node:test via tsx). No browser needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '../src/core/rng';
import { Hasher } from '../src/core/util';
import { defaultRules } from '../src/rules/defaults';
import { MOVES } from '../src/rules/moves';
import { SPECIES } from '../src/rules/species';
import { MODES, vampiric } from '../src/mods';
import { classify, compileMove } from '../src/sim/moves';
import { botInput } from '../src/sim/bot';
import { xpNext } from '../src/sim/progression';
import { createRun, step } from '../src/sim/run';
import { hpMultiplier, speedFactor, toughness } from '../src/sim/enemies';
import type { SimContext } from '../src/sim/types';

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
  while (ctx.time < seconds && ctx.state !== 'over' && ctx.state !== 'victory') step(ctx, botInput(ctx));
  return ctx;
}

test('mulberry32 stream is stable', () => {
  const r = new Rng(12345);
  const a = [r.next(), r.next(), r.next()];
  const r2 = new Rng(12345);
  assert.deepEqual(a, [r2.next(), r2.next(), r2.next()]);
  assert.ok(a.every((v) => v >= 0 && v < 1));
});

test('XP curve matches PokéBonk: round(8 + 5.5L + L^1.8)', () => {
  for (let L = 1; L <= 40; L++) assert.equal(xpNext(defaultRules, L), Math.round(8 + 5.5 * L + Math.pow(L, 1.8)));
  assert.equal(xpNext(defaultRules, 1), 15);
  assert.equal(xpNext(defaultRules, 10), 126);
});

test('director curves match the confirmed formulas', () => {
  const ctx = createRun({ seed: 1, species: 'charmander' });
  ctx.stageTime = 240; ctx.time = 240; ctx.stage = 1;
  const t = 4;
  assert.ok(Math.abs(hpMultiplier(ctx) - (1 + 0.3 * t + Math.max(0, t - 1.5) ** 2 * 0.07) * 5.5) < 1e-9);
  assert.ok(Math.abs(speedFactor(ctx) - Math.min(1.3, 1 + 0.02 * t + 0.06)) < 1e-9);
  assert.ok(Math.abs(toughness(ctx) - (1.35 + 1.05 * (1 - 240 / 480))) < 1e-9);
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
  const a = run(42, 'totodile', 90);
  const b = run(42, 'totodile', 90);
  assert.equal(hashRun(a), hashRun(b));
  assert.equal(a.stats.kills, b.stats.kills);
  const c = run(43, 'totodile', 90);
  assert.notEqual(hashRun(a), hashRun(c));
});

test('a classic run spawns a boss at 5:00 and can clear a region', () => {
  const ctx = createRun({ seed: 3, species: 'squirtle', ruleOverrides: { player: { hpBase: 4000 } } }); // tanky so the bot survives
  let boss = false, cleared = false;
  while (ctx.time < 900 && ctx.state !== 'over') {
    for (const e of step(ctx, botInput(ctx))) {
      if (e.t === 'bossSpawn') { boss = true; assert.ok(Math.abs(ctx.stageTime - defaultRules.stage.bossAt) < 0.05); }
      if (e.t === 'stageStart' && e.stage === 1) cleared = true;
    }
    if (cleared) break;
  }
  assert.ok(boss, 'boss spawned');
  assert.ok(cleared, 'region 1 cleared');
});

test('mods and modes plug in without engine changes', () => {
  let healed = 0;
  const ctx = createRun({ seed: 5, species: 'charmander', mode: MODES.find((m) => m.id === 'glass-cannon'), mods: [{ id: 'probe', name: 'probe', hooks: { onKill: () => { healed++; } } }] });
  assert.equal(ctx.rules.damage.stab, 1.8);
  assert.equal(ctx.hooks.modifyDamage.length, 1); // vampiric from the mode
  while (ctx.time < 60) step(ctx, botInput(ctx));
  assert.equal(healed, ctx.stats.kills);
  assert.ok(vampiric.hooks?.modifyDamage);
});

test('enemy pool never exceeds capacity under heavy spawning', () => {
  const ctx = run(7, 'bulbasaur', 120, { ruleOverrides: { director: { spawnBase: 40 } } });
  assert.ok(ctx.enemies.count <= defaultRules.enemy.cap);
});
