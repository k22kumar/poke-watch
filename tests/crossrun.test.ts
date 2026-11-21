// Independent runs in one process stay independent (docs/HAZARDS.md "Shore target"). A driver steers a partner
// that is in a liquid toward the shore `shoreFor` gives it; that answer is cached per tile. The cache was one slot for
// the whole process, keyed by tile index alone, so a run on a map with the same layout (the authored meadow) could be
// handed the shore another run had computed for the same tile index, from another position and partner. The sim itself
// was never affected (replaying recorded frames in any order reproduces every run); bot-driven runs, harnesses and
// browser autoplay restarts were. The cache is now per World. The first test drives a scripted input track (no bot), so
// it holds whatever the bot's steering becomes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRun, step } from '../src/sim/run';
import { playerLiquid, shoreFor } from '../src/sim/hazards';
import { stateHash } from '../src/sim/checksum';
import { partnerRadius } from '../src/rules/sizing';
import { T } from '../src/world/tiles';
import { NO_INPUT, type SimContext } from '../src/sim/types';
import { RANGE } from '../src/mods';
import { runEnded } from '../scripts/lib/ended';


/** a scripted run (no bot): head for a water tile, and once in the liquid swim to the shore shoreFor gives (the cached
 *  answer the leak was in), then walk back toward the spawn for 2 s and go again. Per tick, the input and the state */
function trackRun(species: string, seed: number, seconds: number) {
  const ctx = createRun({ mode: RANGE, seed, species });
  const [wx, wz] = waterTile(ctx), [sx, sz] = ctx.world.spawn;
  const trace: string[] = [];
  let wet = 0, backUntil = -1;
  while (ctx.time < seconds && !runEnded(ctx)) {
    const P = ctx.player, inLiquid = playerLiquid(ctx) > 0;
    let tx = wx, tz = wz;
    if (inLiquid) { const s = shoreFor(ctx); if (s) { tx = s[0]; tz = s[1]; } backUntil = ctx.tick + 120; }
    else if (ctx.tick < backUntil) { tx = sx; tz = sz; }
    const dx = tx - P.x, dz = tz - P.z, L = Math.hypot(dx, dz) || 1;
    const inp = { ...NO_INPUT, mx: dx / L, mz: dz / L };
    step(ctx, inp);
    if (playerLiquid(ctx)) wet++;
    trace.push(`${inp.mx},${inp.mz}|${stateHash(ctx)},${P.y},${P.vy},${P.grounded}`);
  }
  return { trace, wet };
}

// first in this file: the fresh run must be the first run of the process
test('a scripted run is the same fresh and after another run on the same map layout (the demonstrated case)', () => {
  const fresh = trackRun('cyndaquil', 4, 30);
  const other = trackRun('bulbasaur', 3, 25); // leaves its last shore at a tile index the first run reaches
  const again = trackRun('cyndaquil', 4, 30);
  assert.ok(fresh.wet > 0 && other.wet > 0, `both runs put the partner in a liquid (${fresh.wet}, ${other.wet} ticks): the shore path is exercised`);
  assert.equal(again.trace.length, fresh.trace.length);
  const first = fresh.trace.findIndex((t, i) => t !== again.trace[i]);
  assert.equal(first, -1, `the second run diverges from the fresh one at tick ${first}`);
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
  const a = createRun({ seed: 3, species: 'onix' });
  const b = createRun({ seed: 4, species: 'gastly' });
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
