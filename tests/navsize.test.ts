import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultRules } from '../src/rules/defaults';
import { BIOMES } from '../src/rules/stages';
import { World } from '../src/sim/world';

// Size-aware navigation (docs/SIZING.md, "Navigation classes"): a footprint at or above rules.size.heavyRadius routes
// on the wide field over 2 × 2 blocks (world/navblocks.ts), so it goes round a one-tile gap that a small body takes.
// Where no wide route exists it has no route and holds (World.wideDir returns -1): it never squeezes into the gap.

/** a flat, open square of n × n tiles on the authored meadow: its lower-left tile (i, j) */
function openSquare(W: World, n: number): [number, number] {
  const S = W.w;
  for (let j = 2; j < S - n - 2; j++) for (let i = 2; i < S - n - 2; i++) {
    const h0 = W.height(i - W.half + 0.5, j - W.half + 0.5);
    let ok = true;
    for (let b = 0; b < n && ok; b++) for (let a = 0; a < n && ok; a++) {
      const x = i + a - W.half + 0.5, z = j + b - W.half + 0.5;
      ok = W.walkable(x, z) && Math.abs(W.height(x, z) - h0) < 0.01;
    }
    if (ok) return [i, j];
  }
  throw new Error('no open square');
}

test('a wide body goes round a one-tile gap a light body takes; with no wide route it holds', () => {
  const W = new World(defaultRules, BIOMES.meadow, 5);
  const [i0, j0] = openSquare(W, 16);
  const S = W.w, k = (i: number, j: number) => j * S + i, at = (i: number, j: number): [number, number] => [i - W.half + 0.5, j - W.half + 0.5];
  // a wall across the map at row j0 + 8 (through the square), with a one-tile gap at column i0 + 3 and a three-tile gap at i0 + 11..13
  const wallRow = j0 + 8, saved: [number, number, number][] = [];
  const set = (i: number, j: number, wall: number) => { const t = k(i, j); saved.push([t, W.map.wall[t], W.map.platform[t]]); W.setBlock(t, wall, W.map.platform[t]); };
  try {
    for (let i = 0; i < S; i++) if (i !== i0 + 3 && (i < i0 + 11 || i > i0 + 13)) set(i, wallRow, 1); // the whole width: the gaps are the only crossings
    // the player above the wall near the narrow gap, the walker below it, straight under the narrow gap
    const [px, pz] = at(i0 + 3, wallRow + 5), [ex, ez] = at(i0 + 3, wallRow - 4);
    W.updateFlow(px, pz);
    assert.ok(!W.fitsHeavy(...at(i0 + 3, wallRow)), 'the one-tile gap is too tight for a wide body');
    assert.ok(W.fitsHeavy(...at(i0 + 12, wallRow)), 'the three-tile gap is wide enough');
    const light: [number, number] = [0, 0], heavy: [number, number] = [0, 0];
    assert.ok(W.flowDir(ex, ez, light));
    // the wide walker stands on a block centre (its tiles' shared corner), as nearestFit puts it down
    assert.equal(W.wideDir(ex + 0.5, ez + 0.5, heavy), 1);
    assert.ok(Math.abs(light[0]) < 0.75 && light[1] > 0, `light walker heads straight for the narrow gap (${light})`);
    assert.ok(heavy[0] > 0.5, `wide walker heads sideways for the wide gap (${heavy})`);
    // close the wide gap: no wide route is left, so the wide walker has no route and holds; it is never sent at the gap
    for (let i = i0 + 11; i <= i0 + 13; i++) set(i, wallRow, 1);
    W.updateFlow(px, pz + 1); W.updateFlow(px, pz);
    const none: [number, number] = [0, 0];
    assert.equal(W.wideDir(ex + 0.5, ez + 0.5, none), -1, 'a wide walker with no wide route has none');
    assert.ok(W.flowDir(ex, ez, light), 'the light walker still has its route through the gap');
  } finally {
    // the authored arena is cached and shared: put every tile back
    for (const [t, wall, platform] of saved.reverse()) W.setBlock(t, wall, platform);
  }
});
