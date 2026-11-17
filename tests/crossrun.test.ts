// Independent runs in one process stay independent (docs/HAZARDS.md "Shore target"). The balance bot steers a partner
// that is in a liquid toward the shore `shoreFor` gives it; that answer is cached per tile. The cache was one slot for
// the whole process, keyed by tile index alone, so a run on a map with the same layout (the authored meadow) could be
// handed the shore another run had computed for the same tile index, from another position and partner. The sim itself
// was never affected (replaying recorded frames in any order reproduces every run); bot-driven runs, harnesses and
// browser autoplay restarts were. The cache is now per World.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRun, step } from '../src/sim/run';
import { botInput } from '../src/sim/bot';
import { playerLiquid, shoreFor } from '../src/sim/hazards';
import { stateHash } from '../src/sim/checksum';
import { partnerRadius } from '../src/rules/sizing';
import { MODES } from '../src/mods';
import { T } from '../src/world/tiles';
import type { SimContext } from '../src/sim/types';

const mode = (id: string) => MODES.find((m) => m.id === id);

/** a bot-driven run with Jump held 25 of every 70 ticks (the jumps carry the partner over a lip into the water, where
 *  the bot asks for a shore); per tick, the bot's input and the resulting state */
function botRun(species: string, seed: number, modeId: string, seconds: number, jumps: boolean) {
  const ctx = createRun({ seed, species, mode: mode(modeId) });
  const trace: string[] = [];
  let wet = 0;
  while (ctx.time < seconds && ctx.state !== 'over' && ctx.state !== 'victory') {
    let inp = botInput(ctx);
    if (jumps && ctx.tick % 70 < 25) inp = { ...inp, jump: true };
    step(ctx, inp);
    const P = ctx.player;
    if (playerLiquid(ctx)) wet++;
    trace.push(`${inp.mx},${inp.mz},${inp.dash},${inp.btn}|${stateHash(ctx)},${P.y},${P.vy},${P.grounded}`);
  }
  return { trace, wet };
}

// first in this file: the fresh run must be the first bot run of the process
test('a bot-driven run is the same fresh and after another run on the same map layout (the demonstrated case)', () => {
  const fresh = botRun('gastly', 4, 'classic', 55, true);
  const other = botRun('bulbasaur', 3, 'boss-rush', 47, false); // leaves the partner's last shore at a tile index B reaches
  const again = botRun('gastly', 4, 'classic', 55, true);
  assert.ok(fresh.wet > 0 && other.wet > 0, `both runs put the partner in a liquid (${fresh.wet}, ${other.wet} ticks): the shore path is exercised`);
  assert.equal(again.trace.length, fresh.trace.length);
  const first = fresh.trace.findIndex((t, i) => t !== again.trace[i]);
  assert.equal(first, -1, `the second gastly run diverges from the fresh one at tick ${first} (before the fix: tick 3261)`);
});

/** a water tile of this run's map that the trainer can stand in (open water, no deck, no ice) */
function waterTile(ctx: SimContext): [number, number] {
  const W = ctx.world, M = W.map;
  for (let k = 0; k < W.w * W.h; k++) {
    if (M.terrain[k] !== T.water || (W.over && W.over[k] > 0) || W.cells.iceAt(k)) continue;
    const x = (k % W.w) - W.half + 0.5, z = Math.floor(k / W.w) - W.half + 0.5;
    if (W.shore(x, z, 0.3, W.height(x, z)) && W.shore(x + 0.3, z + 0.3, 0.6, W.height(x, z))) return [x, z];
  }
  throw new Error('no water tile');
}
function wade(ctx: SimContext, x: number, z: number) {
  const P = ctx.player;
  P.x = P.px = x; P.z = P.pz = z; P.y = P.py = ctx.world.height(x, z); P.grounded = true;
  assert.ok(playerLiquid(ctx), 'the trainer stands in the liquid');
}

test('shoreFor: each world answers from its own map, position and partner, whatever another world asked first', () => {
  // two runs on the same authored map: the same tile indices, different worlds
  const a = createRun({ seed: 3, species: 'onix', mode: mode('classic') });
  const b = createRun({ seed: 4, species: 'gastly', mode: mode('classic') });
  assert.equal(a.world.map.id, b.world.map.id, 'one layout');
  const [x, z] = waterTile(a);
  wade(a, x + 0.3, z + 0.3); // the far corner of the tile, with an Extra Large footprint
  wade(b, x - 0.3, z - 0.3); // the near corner, a small one
  const sa = shoreFor(a);
  const sb = shoreFor(b);
  const own = b.world.shore(b.player.x, b.player.z, partnerRadius(b.player.species, b.rules), b.player.y);
  assert.ok(sa && sb && own);
  assert.deepEqual(sb, own, `world B's shore is its own (${own}), not world A's (${sa})`);
  // within one world the per-tile answer is kept, as before: a second ask on the same tile returns the first answer
  b.player.x += 0.2;
  assert.deepEqual(shoreFor(b), sb);
});
