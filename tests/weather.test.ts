// The weather a move sets acts on the ground (src/sim/weather.ts): Rain soaks, Sun lights the tall grass, Hail chills
// water; nothing happens and no random draw is made without a weather.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRun } from '../src/sim/run';
import { RANGE } from '../src/mods';
import { CS } from '../src/sim/cells';
import { weatherSystem } from '../src/sim/weather';
import type { SimContext } from '../src/sim/types';
import type { Element } from '../src/rules/elements';

const range = () => createRun({ mode: RANGE, seed: 1, species: 'squirtle', ruleOverrides: { worldgen: { arena: 'range' } } as never });
/** `secs` of the weather system alone, with `el` up, the player at map tile (tx, ty) */
function under(ctx: SimContext, el: Element | null, tx: number, ty: number, secs: number) {
  const W = ctx.world, P = ctx.player;
  P.x = tx - W.half + 0.5; P.z = ty - W.half + 0.5; P.y = W.height(P.x, P.z);
  ctx.weather.element = el; ctx.weather.t = el ? 999 : 0;
  for (let t = 0; t < secs * 60; t++) { ctx.tick++; weatherSystem.update(ctx, ctx.dt); }
}
const count = (ctx: SimContext, s: number) => { const C = ctx.world.cells; let n = 0; for (let k = 0; k < C.state.length; k++) if (C.state[k] === s) n++; return n; };

test('the weather system is registered in the range mode', () => {
  assert.ok(range().systems.some((s) => s.name === 'weather'));
});

test('no weather: no tile changes and no draw from rng.world', () => {
  const a = range(), b = range();
  under(a, null, 56, 64, 10);
  assert.equal(count(a, CS.wet) + count(a, CS.burning) + count(a, CS.frozen), 0);
  assert.equal(a.rng.world.next(), b.rng.world.next(), 'rng.world untouched');
});

test('Rain soaks the open ground around the player', () => {
  const ctx = range();
  under(ctx, 'tide', 56, 64, 5);
  assert.ok(count(ctx, CS.wet) > 20, `wet tiles ${count(ctx, CS.wet)}`);
});

test('harsh Sun lights the tall grass beside the player', () => {
  const ctx = range();
  under(ctx, 'blaze', 44, 73, 10); // the range's tall-grass patch (src/world/arenas.ts)
  assert.ok(count(ctx, CS.burning) > 0, 'a grass tile caught');
});

test('Hail chills the water beside the player', () => {
  const ctx = range();
  under(ctx, 'frost', 82, 82, 10); // the range's pond
  assert.ok(count(ctx, CS.frozen) > 0, 'a water tile froze');
});
