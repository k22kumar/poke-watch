// Evolution as a Breakthrough (src/sim/evolution.ts; docs/hero-shooter-pivot.md Q23, Q30, Q39): a per-player state,
// rooted and invulnerable with its status cleared, then the next form at full health, while the world keeps running.
// Plus the size change it brings: a body that grew in a corridor or under a deck gets out, never further in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRun, step } from '../src/sim/run';
import { BTN, NO_INPUT, type InputFrame, type SimContext } from '../src/sim/types';
import { canBreakthrough, startEvolution } from '../src/sim/evolution';
import { damagePlayer } from '../src/sim/combat';
import { spawnEnemy } from '../src/sim/enemies';
import { partnerFootprint, partnerHeight } from '../src/rules/sizing';
import { RANGE } from '../src/mods';
import type { World } from '../src/sim/world';

const steps = (ctx: SimContext, n: number, inp: Partial<InputFrame> = {}) => { const evs: string[] = []; for (let i = 0; i < n; i++) for (const e of step(ctx, { ...NO_INPUT, ...inp })) evs.push(e.t); return evs; };

test('a Breakthrough roots, protects and clears status for breakSeconds, then swaps to the next form at full health', () => {
  const ctx = createRun({ mode: RANGE, seed: 1, species: 'charmander' });
  const P = ctx.player, T = ctx.rules.evolution.breakSeconds;
  steps(ctx, 10);
  const e = spawnEnemy(ctx, 'rattata', P.x + 6, P.z);
  P.hp = P.maxHp * 0.4; P.paraT = 3;
  assert.ok(canBreakthrough(ctx));
  assert.ok(startEvolution(ctx));
  assert.ok(!canBreakthrough(ctx), 'not twice at once');
  assert.equal(P.paraT, 0, 'status cleared');
  const x0 = P.x, z0 = P.z, ex0 = ctx.enemies.x[e], tick0 = ctx.tick;
  const evs = steps(ctx, Math.round((T * 0.5) / ctx.dt), { mx: 1 });
  assert.ok(Math.hypot(P.x - x0, P.z - z0) < 0.05, 'rooted: walking does not move it');
  assert.equal(damagePlayer(ctx, 50, P.x + 1, P.z), 'none', 'invulnerable');
  assert.equal(P.species.id, 'charmander', 'still the old form mid-way');
  assert.ok(ctx.tick > tick0 && ctx.state === 'play' && ctx.enemies.x[e] !== ex0, 'the world keeps running (an enemy moved)');
  assert.ok(!evs.includes('evolveEnd'));
  const rest = steps(ctx, Math.round((T * 0.5) / ctx.dt) + 2);
  assert.ok(rest.includes('evolveEnd'));
  assert.equal(P.species.id, 'charmeleon');
  assert.equal(P.hp, P.maxHp, 'full health');
  assert.equal(P.breakT, 0);
  steps(ctx, 30, { mx: 1 });
  assert.ok(Math.hypot(P.x - x0, P.z - z0) > 0.5, 'free to move again');
});

test('the range Mode: holding Touch for holdTime is a free Breakthrough; a tap is not, and other modes have no trigger', () => {
  const hold = (ctx: SimContext, seconds: number) => steps(ctx, Math.round(seconds / ctx.dt), { btn: BTN.touch });
  const a = createRun({ mode: RANGE, seed: 1, species: 'caterpie' });
  hold(a, a.rules.evolution.holdTime * 0.5); steps(a, 2);
  assert.equal(a.player.breakT, 0, 'a tap shorter than holdTime does nothing');
  hold(a, a.rules.evolution.holdTime + 2 * a.dt);
  assert.ok(a.player.breakT > 0, 'held long enough: a Breakthrough');
  steps(a, Math.round(a.rules.evolution.breakSeconds / a.dt) + 2);
  assert.equal(a.player.species.id, 'metapod');
  const b = createRun({ seed: 1, species: 'caterpie' });
  hold(b, 1);
  assert.equal(b.player.breakT, 0, 'outside the range Mode Touch does not evolve (Candy prices come with growth)');
  // a non-evolver: a no-op until the burst dial is played
  const c = createRun({ mode: RANGE, seed: 1, species: 'tauros' });
  hold(c, 1);
  assert.equal(c.player.breakT, 0);
});

/** a flat open n × n square: its lower-left tile */
function openSquare(W: World, n: number): [number, number] {
  for (let j = 2; j < W.w - n - 2; j++) for (let i = 2; i < W.w - n - 2; i++) {
    const h0 = W.height(i - W.half + 0.5, j - W.half + 0.5);
    let ok = true;
    for (let b = 0; b < n && ok; b++) for (let a = 0; a < n && ok; a++) { const x = i + a - W.half + 0.5, z = j + b - W.half + 0.5; ok = W.walkable(x, z) && Math.abs(W.height(x, z) - h0) < 0.01; }
    if (ok) return [i, j];
  }
  throw new Error('no open square');
}

test('growing in a corridor: Croconaw becomes Feraligatr inside a two-tile corridor and walks out along it', () => {
  const ctx = createRun({ mode: RANGE, seed: 1, species: 'croconaw' });
  const W = ctx.world, P = ctx.player, [I, J] = openSquare(W, 12);
  // a corridor two tiles wide (columns I+5, I+6) running the square's length, walled either side
  const walls: number[] = [];
  for (let j = J; j < J + 12; j++) for (const i of [I + 4, I + 7]) walls.push(j * W.w + i);
  const saved = walls.map((k) => [k, W.map.wall[k], W.map.platform[k]] as const);
  try {
    for (const k of walls) W.setBlock(k, 1, W.map.platform[k]);
    P.x = P.px = I + 5.6 - W.half; P.z = P.pz = J + 2.5 - W.half; P.y = P.py = W.height(P.x, P.z);
    steps(ctx, 5);
    const r0 = partnerFootprint(P.species, ctx.rules);
    assert.ok(startEvolution(ctx));
    steps(ctx, Math.round(ctx.rules.evolution.breakSeconds / ctx.dt) + 2);
    assert.equal(P.species.id, 'feraligatr');
    const r1 = partnerFootprint(P.species, ctx.rules), tall = partnerHeight(P.species, ctx.rules);
    assert.ok(r1 > r0, `the footprint grew (${r0} → ${r1} m)`);
    // walk along the corridor: the body must end clear of its walls and get further along, never wedge deeper
    const z0 = P.z;
    for (let t = 0; t < 240; t++) { step(ctx, { ...NO_INPUT, mz: 1 }); }
    assert.ok(P.z > z0 + 4, `walked along the corridor (${(P.z - z0).toFixed(2)} m)`);
    assert.ok(W.fits(P.x, P.z, P.y, r1 - 2e-3, 0.6 + 1e-3, tall), 'clear of the corridor walls');
  } finally { for (const [k, w, p] of saved.reverse()) W.setBlock(k, w, p); }
});

test('growing under a deck: a Breakthrough under Mt. Moon\'s deck leaves the head below the slab and the body on the ground', () => {
  const id = 'mt-moon';
  const ctx = createRun({ mode: RANGE, seed: 1, species: 'croconaw', ruleOverrides: { worldgen: { mode: 'generated', regionSeed: 5, locations: { meadow: id, dusk: id, badlands: id, frost: id } } } as never });
  for (let e = 0; e < ctx.enemies.hi; e++) if (ctx.enemies.alive[e]) ctx.enemies.kill(e);
  const W = ctx.world, P = ctx.player, m = W.map;
  assert.ok(m.over, 'Mt. Moon has decks');
  // a ground tile under a deck, open around it
  let k = -1;
  for (let j = 3; j < m.h - 3 && k < 0; j++) for (let i = 3; i < m.w - 3 && k < 0; i++) {
    const q = j * m.w + i;
    if (!(m.over![q] > 0)) continue;
    const x = i - W.half + 0.5, z = j - W.half + 0.5, g = W.height(x, z, 0);
    if (W.walkable(x, z) && W.fits(x, z, g, 0.9, 0.6, 2.4) && W.ceilingAt(x, z, g) - g > 2.4) k = q;
  }
  assert.ok(k >= 0, 'a ground tile under a deck with room for an Extra Large body');
  P.x = P.px = (k % m.w) - W.half + 0.5; P.z = P.pz = Math.floor(k / m.w) - W.half + 0.5; P.y = P.py = W.height(P.x, P.z, 0);
  const ground = P.y, ceiling = W.ceilingAt(P.x, P.z, ground);
  steps(ctx, 3);
  assert.ok(startEvolution(ctx));
  steps(ctx, Math.round(ctx.rules.evolution.breakSeconds / ctx.dt) + 30);
  assert.equal(P.species.id, 'feraligatr');
  const tall = partnerHeight(P.species, ctx.rules);
  assert.ok(Math.abs(P.y - ground) < 0.05, `still on the ground under the deck (y ${P.y.toFixed(2)}, ground ${ground.toFixed(2)})`);
  assert.ok(P.y + tall <= ceiling + 1e-3, `head ${(P.y + tall).toFixed(2)} m below the slab at ${ceiling.toFixed(2)} m`);
});
