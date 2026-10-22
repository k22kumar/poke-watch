// Attack timelines, abilities and species identity.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRun, step } from '../src/sim/run';
import { spawnEnemy } from '../src/sim/enemies';
import { damageEnemy } from '../src/sim/combat';
import { generateCards } from '../src/sim/progression';
import { SPECIES, SPECIES_BY_ID } from '../src/rules/species';
import { MOVE_BY_KEY } from '../src/rules/moves';
import { abilityOf, ABILITIES } from '../src/rules/abilities';
import type { SimEvent } from '../src/sim/types';

const idle = { mx: 0, mz: 0, jump: false, dash: false };
const spec = (element: any, extra = {}) => ({ element, cls: 'special' as const, ailment: 'knock' as const, chance: 0, knock: 0, kx: 0, kz: 0, drain: 0, source: 'test', ...extra });

test('moves wind up, face the target, release when the wind-up ends, and keep their cadence', () => {
  const ctx = createRun({ seed: 2, species: 'charmander' });
  ctx.rules.director.spawnBase = -99;
  const e = spawnEnemy(ctx, 'geodude', ctx.player.x + 4, ctx.player.z, 0);
  ctx.enemies.hp[e] = ctx.enemies.maxHp[e] = 1e9;
  const ev: { t: number; e: SimEvent }[] = [];
  for (let i = 0; i < 60 * 6; i++) for (const x of step(ctx, idle)) if (x.t === 'windup' || x.t === 'cast') ev.push({ t: ctx.time, e: x });
  const w = ev.find((x) => x.e.t === 'windup')!;
  const c = ev.find((x) => x.e.t === 'cast' && x.t >= w.t)!;
  assert.ok(w && c, 'wind-up then cast');
  const W = ctx.rules.feel.windup.bolt;
  assert.ok(Math.abs(c.t - w.t - W) < 1 / 30, `release ${(c.t - w.t).toFixed(3)} s after wind-up start (expected ${W})`);
  assert.ok(Math.abs(Math.sin(ctx.player.facing) - 1) < 0.2, 'turned to face the target (east)');
  // cadence: wind-up time is refunded from the cooldown, so casts stay one cooldown apart
  const casts = ev.filter((x) => x.e.t === 'cast' && (x.e as any).key === 'ember').map((x) => x.t);
  const gaps = casts.slice(1).map((t, i) => t - casts[i]);
  const cd = ctx.player.moves[0].spec.cd / ctx.player.derived.haste;
  for (const g of gaps.slice(1)) assert.ok(Math.abs(g - cd) < 0.05, `cast interval ${g.toFixed(3)} vs cooldown ${cd.toFixed(3)}`);
});

test('abilities: Flash Fire and Levitate ignore their type, Water Absorb heals, Sturdy survives once', () => {
  const ctx = createRun({ seed: 3, species: 'charmander' });
  ctx.rules.director.spawnBase = -99;
  const mk = (id: string) => { const i = spawnEnemy(ctx, id, ctx.player.x + 3, ctx.player.z, 0); ctx.enemies.spawnT[i] = 1; return i; };
  const vul = mk('vulpix'), gas = mk('gastly'), pol = mk('poliwag'), geo = mk('geodude');
  const E = ctx.enemies;
  const h0 = E.hp[vul];
  assert.equal(damageEnemy(ctx, vul, 50, spec('blaze')), 0); assert.equal(E.hp[vul], h0, 'Flash Fire: no fire damage');
  assert.ok(E.abilityFlag[vul] === 1, 'Flash Fire armed');
  assert.equal(damageEnemy(ctx, gas, 50, spec('quake')), 0, 'Levitate: no ground damage');
  E.hp[pol] = E.maxHp[pol] * 0.5;
  damageEnemy(ctx, pol, 50, spec('tide'));
  assert.ok(E.hp[pol] > E.maxHp[pol] * 0.5, 'Water Absorb: water heals');
  damageEnemy(ctx, geo, 1e7, spec('plain'));
  assert.ok(E.alive[geo] && Math.round(E.hp[geo]) === 1, 'Sturdy: survives a lethal hit from full HP at 1 HP');
  damageEnemy(ctx, geo, 10, spec('plain'));
  assert.ok(!E.alive[geo], 'Sturdy works once');
  for (const sp of SPECIES) { const a = abilityOf(sp); if (a) assert.ok(ABILITIES[a].supported, `${sp.id}: ${a}`); }
});

test('Blaze boosts fire moves only at one third HP or less', () => {
  const ctx = createRun({ seed: 4, species: 'charmander' });
  ctx.rules.director.spawnBase = -99;
  ctx.player.derived.crit = 0;
  const e = spawnEnemy(ctx, 'rattata', ctx.player.x + 3, ctx.player.z, 0);
  ctx.enemies.spawnT[e] = 1; ctx.enemies.hp[e] = ctx.enemies.maxHp[e] = 1e9;
  const full = damageEnemy(ctx, e, 10, spec('blaze'));
  ctx.player.hp = ctx.player.maxHp * 0.3;
  const pinch = damageEnemy(ctx, e, 10, spec('blaze'));
  assert.ok(Math.abs(pinch / full - 1.5) < 1e-6, `x${(pinch / full).toFixed(3)}`);
  const normal = damageEnemy(ctx, e, 10, spec('plain'));
  ctx.player.hp = ctx.player.maxHp;
  assert.ok(Math.abs(damageEnemy(ctx, e, 10, spec('plain')) - normal) < 1e-6, 'non-fire moves unaffected');
});

test('starter lines reach their final forms at canonical levels; canonical facts are kept apart', () => {
  for (const [a, b, c] of [['bulbasaur', 'ivysaur', 'venusaur'], ['charmander', 'charmeleon', 'charizard'], ['squirtle', 'wartortle', 'blastoise'], ['chikorita', 'bayleef', 'meganium'], ['cyndaquil', 'quilava', 'typhlosion'], ['totodile', 'croconaw', 'feraligatr']]) {
    assert.equal(SPECIES_BY_ID[a].evolvesTo, b); assert.equal(SPECIES_BY_ID[b].evolvesTo, c);
    for (const id of [a, b]) assert.equal(SPECIES_BY_ID[id].evolveLevel, SPECIES_BY_ID[id].canon?.evolveLevel, `${id}: game level matches canon`);
    for (const id of [a, b, c]) {
      const sp = SPECIES_BY_ID[id];
      assert.ok(sp.canon?.levelUp.length, `${id}: canonical HGSS level-up list`);
      for (const [, k] of sp.learnset ?? []) assert.ok(sp.canon!.levelUp.some(([, m]) => m === k) || [a, b, c].some((x) => SPECIES_BY_ID[x].canon!.levelUp.some(([, m]) => m === k)), `${id}: ${k} is a canonical line move`);
    }
  }
});

test('coverage cards only offer the line\'s own canonical moves, never a later form\'s early', () => {
  const ctx = createRun({ seed: 5, species: 'charmander' });
  const P = ctx.player;
  const lineMoves = new Set(['charmander', 'charmeleon', 'charizard'].flatMap((id) => SPECIES_BY_ID[id].canon!.levelUp.map(([, k]) => k)));
  for (let n = 0; n < 300; n++) {
    for (const c of generateCards(ctx)) if (c.kind === 'learn') {
      assert.ok(lineMoves.has(c.key), `${c.key} is not a Charmander-line move`);
      assert.ok(!(SPECIES_BY_ID.charizard.coverage ?? []).some(([, k]) => k === c.key), `${c.key} belongs to Charizard`);
      assert.ok(MOVE_BY_KEY[c.key]);
    }
  }
  void P;
});
