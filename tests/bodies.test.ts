// Bodies and the force verbs (blueprint section 8 scenario tests): Weight against Power, combined
// force, breaking by type, impacts, Guard against thrown boulders, and bodies as cover.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { breakBody, damageBody, pushBody, spawnBody, TEAM } from '../src/sim/bodies';
import { shootHostile, spawnEnemy } from '../src/sim/enemies';
import { createRun, step } from '../src/sim/run';
import { SPECIES_BY_ID } from '../src/rules/species';
import { BTN, type InputFrame, type SimContext } from '../src/sim/types';

const NONE: InputFrame = { mx: 0, mz: 0, jump: false, dash: false };

function calm(species = 'totodile'): SimContext {
  const ctx = createRun({ seed: 4, species, ruleOverrides: { director: { spawnBase: -99, spawnPerMin: 0, spawnPerStage: 0 }, bodies: { looseRocks: 0 } } as never });
  for (let i = 0; i < 20; i++) step(ctx, NONE);
  return ctx;
}
const steps = (ctx: SimContext, n: number, inp: Partial<InputFrame> = {}) => { for (let i = 0; i < n; i++) step(ctx, { ...NONE, ...inp }); };
const speed = (ctx: SimContext, b: number) => Math.hypot(ctx.bodies.vx[b], ctx.bodies.vz[b]);
/** an open spot: the player's tile moved d metres east (walkable) */
function open(ctx: SimContext, dx: number, dz = 0): [number, number] {
  return ctx.world.nearestWalkable(ctx.player.x + dx, ctx.player.z + dz);
}

test('Power below Weight only slows a body; Power at Weight moves it', () => {
  const ctx = calm();
  const [x, z] = open(ctx, 12);
  const b = spawnBody(ctx, 'boulder', x, z, 10, 0, TEAM.enemy);
  pushBody(ctx, b, 1, -1, 0, TEAM.player); // P1 against W3
  assert.ok(Math.abs(speed(ctx, b) - 8.5) < 1e-9, 'slowed to 85%');
  assert.ok(ctx.bodies.vx[b] > 0, 'direction unchanged');
  assert.equal(ctx.bodies.team[b], TEAM.enemy, 'still the thrower\'s');

  const r = spawnBody(ctx, 'rock', x, z + 3);
  assert.equal(pushBody(ctx, r, 1, 0, 1, TEAM.player), false, 'P1 cannot roll a Medium rock');
  ctx.time += 1;
  assert.equal(pushBody(ctx, r, 2, 0, 1, TEAM.player), true, 'P2 rolls it');
  assert.ok(Math.abs(ctx.bodies.vz[r] - 8) < 1e-9);
});

test('two Power 2 pushes within 0.2 s redirect a Heavy boulder; far apart in time they do not', () => {
  for (const gap of [0.1, 0.4]) {
    const ctx = calm();
    const [x, z] = open(ctx, 12);
    const b = spawnBody(ctx, 'boulder', x, z, -10, 0, TEAM.enemy);
    pushBody(ctx, b, 2, 0, 1, TEAM.player);
    ctx.time += gap;
    const moved = pushBody(ctx, b, 2, 0.2, 1, TEAM.player);
    if (gap < 0.2) { assert.equal(moved, true); assert.ok(ctx.bodies.vz[b] > 7 && Math.abs(ctx.bodies.vx[b]) < 3); assert.equal(ctx.bodies.team[b], TEAM.player); }
    else assert.equal(moved, false);
  }
});

test('Water breaks a Rock boulder twice as fast as Fire is resisted; a break leaves rubble', () => {
  const ctx = calm();
  const [x, z] = open(ctx, 10);
  const a = spawnBody(ctx, 'boulder', x, z), c = spawnBody(ctx, 'boulder', x, z + 4);
  damageBody(ctx, a, 30, 'tide');
  damageBody(ctx, c, 30, 'blaze');
  assert.equal(ctx.bodies.maxHp[a] - ctx.bodies.hp[a], 60, 'Water x2 on Rock');
  assert.equal(ctx.bodies.maxHp[c] - ctx.bodies.hp[c], 15, 'Fire x0.5 on Rock');
  const before = ctx.bodies.count;
  breakBody(ctx, a);
  assert.equal(ctx.bodies.count, before - 1 + 3, 'three rubble chunks');
});

test('a rock rolled by the player hits enemies along its path', () => {
  const ctx = calm();
  const [x, z] = open(ctx, 4);
  const r = spawnBody(ctx, 'rock', x, z);
  const [ex, ez] = open(ctx, 9);
  const e = spawnEnemy(ctx, 'rattata', ex, ez);
  ctx.enemies.speed[e] = 0;
  steps(ctx, 20);
  const hp0 = ctx.enemies.hp[e];
  const dx = ctx.enemies.x[e] - ctx.bodies.x[r], dz = ctx.enemies.z[e] - ctx.bodies.z[r];
  pushBody(ctx, r, 2, dx, dz, TEAM.player);
  let hit = false;
  for (let t = 0; t < 60 && !hit; t++) { const ev = step(ctx, NONE); hit = ev.some((x) => x.t === 'hit' && x.enemy === e); }
  assert.ok(hit, 'impact hit');
  assert.ok(!ctx.enemies.alive[e] || ctx.enemies.hp[e] < hp0);
});

test('a Light Pokémon can only brace a boulder; a Heavy one deflects it back along its aim', () => {
  const run = (species: string) => {
    const ctx = calm(species);
    if (species === 'feraligatr') ctx.player.species = SPECIES_BY_ID.feraligatr;
    const P = ctx.player;
    P.hp = P.maxHp = 1000;
    const [x, z] = open(ctx, 7);
    const b = spawnBody(ctx, 'boulder', x, P.z, -11, 0, TEAM.enemy, 20);
    const out = { deflected: false, braced: false, hp: P.hp, team: 0 };
    for (let t = 0; t < 50; t++) {
      // tap Guard 0.35 s in (the boulder is about 1 m away), aim back east
      const ev = step(ctx, { ...NONE, btn: t >= 24 && t < 34 ? BTN.guard : 0, aimX: P.x + 10, aimZ: P.z });
      if (ev.some((e) => e.t === 'deflect')) out.deflected = true;
      if (ev.some((e) => e.t === 'brace')) out.braced = true;
      if (!ctx.bodies.alive[b]) break;
    }
    out.team = ctx.bodies.team[b];
    out.hp = P.hp;
    return out;
  };
  const light = run('totodile');
  assert.equal(light.deflected, false);
  const heavy = run('feraligatr');
  assert.equal(heavy.deflected, true, 'Feraligatr (88.8 kg, Heavy) deflects a Heavy boulder');
  assert.equal(heavy.team, TEAM.player);
});

test('rocks are cover: enemy shots stop on them', () => {
  const ctx = calm();
  const P = ctx.player;
  const [x] = open(ctx, 3);
  spawnBody(ctx, 'rock', x, P.z);
  const hp0 = P.hp;
  shootHostile(ctx, P.x + 8, P.z, -1, 0, 10, 40, 'blaze');
  steps(ctx, 90);
  assert.equal(P.hp >= hp0 - 1e-6, true, 'no damage behind the rock');
});

test('Sudowoodo throws boulders that roll at the player', () => {
  const ctx = createRun({ seed: 9, species: 'cyndaquil', ruleOverrides: { director: { spawnBase: -99, spawnPerMin: 0, spawnPerStage: 0 }, bosses: { extraAttacks: { sudowoodo: ['boulder'] } } } as never });
  steps(ctx, 10);
  const P = ctx.player;
  P.hp = P.maxHp = 1e6;
  const [bx, bz] = ctx.world.nearestWalkable(P.x + 14, P.z);
  const e = spawnEnemy(ctx, 'sudowoodo', bx, bz, 4);
  ctx.director.bossIndex = e;
  let thrown = 0;
  for (let t = 0; t < 60 * 30 && thrown === 0; t++) { const ev = step(ctx, NONE); thrown += ev.filter((x) => x.t === 'throw').length; }
  assert.ok(thrown > 0, 'a boulder was thrown');
});
