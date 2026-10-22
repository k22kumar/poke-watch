// Surface states (blueprint section 7, cell reactions): fire spreads through tall grass and is stopped
// by water or cold; cold freezes water into walkable ice that thaws again; Charge floods wet cells
// (at most 30) and skips airborne bodies.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyAgent, CS } from '../src/sim/cells';
import { createRun, step } from '../src/sim/run';
import { T } from '../src/world/tiles';
import type { InputFrame, SimContext } from '../src/sim/types';

const NONE: InputFrame = { mx: 0, mz: 0, jump: false, dash: false };
function calm(): SimContext {
  const ctx = createRun({ seed: 2, species: 'cyndaquil', ruleOverrides: { director: { spawnBase: -99, spawnPerMin: 0, spawnPerStage: 0 }, bodies: { looseRocks: 0 } } as never });
  for (let i = 0; i < 6; i++) step(ctx, NONE);
  return ctx;
}
const secs = (ctx: SimContext, s: number) => { for (let i = 0; i < Math.round(s * 60); i++) step(ctx, NONE); };
/** world centre of the first tile of the given terrain whose 4 neighbours share it */
function find(ctx: SimContext, t: number): [number, number, number] {
  const M = ctx.world.map, w = M.w;
  for (let k = w + 1; k < M.terrain.length - w - 1; k++) {
    if (M.terrain[k] === t && M.terrain[k - 1] === t && M.terrain[k + 1] === t && M.terrain[k - w] === t && M.terrain[k + w] === t && !M.wall[k]) {
      return [k, (k % w) - w / 2 + 0.5, ((k / w) | 0) - w / 2 + 0.5];
    }
  }
  throw new Error('no tile');
}

test('Heat lights tall grass, the fire spreads, burns out to ash, and the grass regrows', () => {
  const ctx = calm();
  const C = ctx.world.cells;
  const [k, x, z] = find(ctx, T.tall);
  applyAgent(ctx, 'heat', x, z, 0.5);
  assert.equal(C.state[k], CS.burning);
  secs(ctx, 3);
  let burning = 0;
  for (const q of C.activeList()) if (C.state[q] === CS.burning) burning++;
  assert.ok(burning > 1, `fire spread (${burning} cells)`);
  secs(ctx, 3);
  assert.equal(C.state[k], CS.ash);
  secs(ctx, 46);
  assert.equal(C.state[k], CS.none, 'grass is back');
});

test('Wet grass will not light; Cold puts a fire out to ash', () => {
  const ctx = calm();
  const C = ctx.world.cells;
  const [k, x, z] = find(ctx, T.tall);
  applyAgent(ctx, 'wet', x, z, 0.5);
  applyAgent(ctx, 'heat', x, z, 0.5);
  assert.equal(C.state[k], CS.none, 'heat dried it but did not ignite it');
  applyAgent(ctx, 'heat', x, z, 0.5);
  assert.equal(C.state[k], CS.burning);
  applyAgent(ctx, 'cold', x, z, 0.5);
  assert.equal(C.state[k], CS.ash);
});

test('Cold freezes water into walkable ice that thaws after 12 s', () => {
  const ctx = calm();
  const W = ctx.world, C = W.cells;
  const [k, x, z] = find(ctx, T.water);
  assert.ok(W.solid(x, z));
  applyAgent(ctx, 'cold', x, z, 0.5);
  assert.equal(C.state[k], CS.frozen);
  secs(ctx, 0.2);
  assert.ok(!W.solid(x, z), 'ice is walkable');
  assert.equal(W.height(x, z), 0);
  secs(ctx, 12.2);
  assert.ok(W.solid(x, z), 'thawed');
});

test('Charge floods at most 30 connected wet cells; jumping avoids it', () => {
  const ctx = calm();
  const C = ctx.world.cells, P = ctx.player;
  // wet a big patch around the player and shock it
  applyAgent(ctx, 'wet', P.x, P.z, 6);
  applyAgent(ctx, 'charge', P.x, P.z, 0.5);
  let charged = 0;
  for (const q of C.activeList()) if (C.charge[q] > 0) charged++;
  assert.ok(charged > 1 && charged <= 30, `${charged} cells charged`);
  // a grounded Cyndaquil standing in it is shocked; an airborne one is not
  const hp0 = P.hp;
  P.cellHurt = 0;
  step(ctx, NONE); step(ctx, NONE); step(ctx, NONE); step(ctx, NONE); step(ctx, NONE); step(ctx, NONE);
  assert.ok(P.hp < hp0 && P.paraT > 0, 'shocked on the ground');
  const ctx2 = calm();
  const P2 = ctx2.player;
  applyAgent(ctx2, 'wet', P2.x, P2.z, 6);
  P2.y += 2; P2.vy = 6; P2.grounded = false;
  applyAgent(ctx2, 'charge', P2.x, P2.z, 0.5);
  const h2 = P2.hp;
  for (let i = 0; i < 6; i++) step(ctx2, { ...NONE, jump: true });
  assert.equal(P2.hp, h2, 'airborne: no shock');
});
