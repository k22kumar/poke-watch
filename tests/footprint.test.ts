import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultRules } from '../src/rules/defaults';
import { BIOMES } from '../src/rules/stages';
import { World } from '../src/sim/world';
import { createRun, step } from '../src/sim/run';
import { NO_INPUT } from '../src/sim/types';
import { SPECIES_BY_ID } from '../src/rules/species';
import { footprintOf, partnerFootprint } from '../src/rules/sizing';
import { blockMask, wideBlock, type NavGrid } from '../src/world/navblocks';
import { generateLocation } from '../src/world/locgen';
import { wideCore } from '../src/world/locgen/nav';
import { walkLocation } from '../scripts/navwalk';
import { playHabitat } from '../scripts/habplay';
import { escapeOf, TRAP_ROOM } from '../scripts/stuckwatch';

import { RANGE } from '../src/mods';
// Movement footprints (docs/SIZING.md "Footprint", "Navigation classes"): every body collides with walls as a circle of
// its class `body` (World.moveBody), wide bodies route on 2 × 2 blocks (world/navblocks.ts), and navigation and collision
// agree on what fits. One test per defect this pass confirmed.

/** a flat open n × n square on the authored meadow: its lower-left tile */
function openSquare(W: World, n: number): [number, number] {
  for (let j = 2; j < W.w - n - 2; j++) for (let i = 2; i < W.w - n - 2; i++) {
    const h0 = W.height(i - W.half + 0.5, j - W.half + 0.5);
    let ok = true;
    for (let b = 0; b < n && ok; b++) for (let a = 0; a < n && ok; a++) { const x = i + a - W.half + 0.5, z = j + b - W.half + 0.5; ok = W.walkable(x, z) && Math.abs(W.height(x, z) - h0) < 0.01; }
    if (ok) return [i, j];
  }
  throw new Error('no open square');
}

/** run `fn` with tiles walled on the shared authored meadow, then put every tile back */
function withWalls(W: World, tiles: [number, number][], fn: () => void) {
  const saved = tiles.map(([i, j]) => { const k = j * W.w + i; return [k, W.map.wall[k], W.map.platform[k]] as const; });
  try { for (const [i, j] of tiles) W.setBlock(j * W.w + i, 1, W.map.platform[j * W.w + i]); fn(); }
  finally { for (const [k, w, p] of saved.reverse()) W.setBlock(k, w, p); }
}

test('classes: a one-tile passage fits Tiny, Small and Medium bodies, not Large or Extra Large; role sizes stop at bodyCap', () => {
  const S = defaultRules.size;
  for (const c of S.classes) assert.equal(c.body < S.heavyRadius, ['tiny', 'small', 'medium'].includes(c.id), c.id);
  for (const c of S.classes) assert.ok(2 * c.body < (c.body < S.heavyRadius ? 1 : 2), `${c.id} fits its passage width`);
  assert.equal(footprintOf(SPECIES_BY_ID.heracross, 2), S.bodyCap);
  assert.equal(footprintOf(SPECIES_BY_ID.onix, 1), 0.88);
  assert.equal(partnerFootprint(SPECIES_BY_ID.feraligatr), 0.88, 'an Extra Large partner is not capped');
  // the footprint is configured on its own: Medium's body is under its hurtbox, and geometry off is the point model
  const off = { ...defaultRules, size: { ...S, geometry: false } };
  assert.equal(footprintOf(SPECIES_BY_ID.onix, 1, off), 0);
  assert.equal(partnerFootprint(SPECIES_BY_ID.feraligatr, off), 0);
});

// The point-collision half (size.geometry off, where the trainer slipped through) went with the hero speed band: its
// slip depended on the old 8 m/s run-up, and the off-path itself is retired (docs/hero-shooter-pivot.md Q18).
test('a diagonal pinhole (two walls touching at a corner) stops the trainer', () => {
  for (const geometry of [true]) {
    const ctx = createRun({ mode: RANGE, seed: 1, species: 'totodile', ruleOverrides: { size: { geometry } } as never });
    const W = ctx.world, P = ctx.player, [I, J] = openSquare(W, 10);
    const i = I + 5, j = J + 5;
    // row j walled left of column i, row j + 1 walled from column i: the two sides touch only at the corner (i, j + 1)
    const walls: [number, number][] = [];
    for (let c = I; c < I + 10; c++) walls.push(c < i ? [c, j] : [c, j + 1]);
    let crossed = false;
    withWalls(W, walls, () => {
      const at = (a: number, b: number): [number, number] => [a - W.half + 0.5, b - W.half + 0.5];
      [P.x, P.z] = at(i, j - 2); P.px = P.x; P.pz = P.z; P.y = W.height(P.x, P.z);
      const corner: [number, number] = [i - W.half, j + 1 - W.half], goal = at(i - 1, j + 3);
      for (let t = 0; t < 600 && !crossed; t++) {
        const [tx, tz] = t < 300 ? [corner[0] + 0.02, corner[1] - 0.02] : goal, dx = tx - P.x, dz = tz - P.z, L = Math.hypot(dx, dz) || 1;
        step(ctx, { ...NO_INPUT, mx: dx / L, mz: dz / L });
        crossed = P.z > corner[1] + 0.3 && P.x < corner[0];
      }
    });
    assert.equal(crossed, !geometry, geometry ? 'the footprint cannot pass a zero-width gap' : 'the old point collision did');
  }
});

test('a Large partner does not fit a one-tile gap that a Small one walks through, and never ends a tick in the wall', () => {
  for (const [species, fits] of [['totodile', true], ['meganium', false]] as const) {
    const ctx = createRun({ mode: RANGE, seed: 1, species, ruleOverrides: {} as never });
    const W = ctx.world, P = ctx.player, [I, J] = openSquare(W, 12), foot = partnerFootprint(P.species, ctx.rules);
    const gap = I + 6, row = J + 6, walls: [number, number][] = [];
    for (let c = I; c < I + 12; c++) if (c !== gap) walls.push([c, row]);
    let passed = false, overlap = false;
    withWalls(W, walls, () => {
      P.x = P.px = gap - W.half + 0.5; P.z = P.pz = row - 3 - W.half + 0.5; P.y = W.height(P.x, P.z);
      for (let t = 0; t < 240; t++) {
        // straight at the gap, with a sideways wobble a player's stick has
        step(ctx, { ...NO_INPUT, mx: Math.sin(t * 0.2) * 0.3, mz: 1 });
        if (!W.fits(P.x, P.z, P.y, foot - 2e-3)) overlap = true;
        if (P.z > row + 1.2 - W.half) passed = true;
      }
    });
    assert.equal(passed, fits, `${species} (footprint ${foot}) ${fits ? 'walks through' : 'stops at'} the one-tile gap`);
    assert.ok(!overlap, `${species} stays clear of the walls`);
  }
});

test('a dash into a wall never tunnels or overlaps it (moveBody substeps)', () => {
  const ctx = createRun({ mode: RANGE, seed: 1, species: 'feraligatr', ruleOverrides: {} as never });
  const W = ctx.world, P = ctx.player, [I, J] = openSquare(W, 10), foot = partnerFootprint(P.species, ctx.rules);
  const row = J + 6, walls: [number, number][] = [];
  for (let c = I; c < I + 10; c++) walls.push([c, row]);
  withWalls(W, walls, () => {
    P.x = P.px = I + 5 - W.half + 0.5; P.z = P.pz = row - 2 - W.half + 0.5; P.y = W.height(P.x, P.z);
    for (let t = 0; t < 90; t++) {
      step(ctx, { ...NO_INPUT, mz: 1, dash: t % 15 === 0 });
      assert.ok(W.fits(P.x, P.z, P.y, foot - 2e-3), `clear of the wall at tick ${t}`);
      assert.ok(P.z < row - W.half - foot + 0.01, 'never past the wall face');
    }
  });
});

test('a body left inside a tight spot (an evolution in a corridor) walks out of it and never further in', () => {
  const W = new World(defaultRules, BIOMES.meadow, 5), [I, J] = openSquare(W, 10);
  const walls: [number, number][] = [];
  for (let r = J; r < J + 10; r++) { walls.push([I + 4, r]); walls.push([I + 6, r]); } // a one-tile corridor along column I + 5
  withWalls(W, walls, () => {
    const out: [number, number] = [0, 0], r = 0.88, x = I + 5 - W.half + 0.5;
    let z = J + 2 - W.half + 0.5;
    const y = W.height(x, z);
    assert.ok(!W.fits(x, z, y, r), 'an Extra Large body overlaps both walls of a one-tile corridor');
    W.moveBody(x, z, 0.6, 0, y, 0.6, r, out);
    assert.ok(Math.abs(out[0] - x) < 1e-6, 'it cannot move sideways deeper into a wall');
    for (let s = 0; s < 40; s++) { W.moveBody(x, z, 0, 0.25, y, 0.6, r, out); z = out[1]; }
    assert.ok(z > J + 9 - W.half, 'it can walk along the corridor and out');
  });
});

test('the wide lattice counts a diagonal ramp and a bridge abutment as wide (the old max − min rule did not)', () => {
  // a 4 × 4 ramp rising 0.5 m per tile along the diagonal: every orthogonal step 0.5 m, every block's span 1.0 m
  const n = 6, open = new Uint8Array(n * n).fill(1), top = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) top[j * n + i] = 0.25 * (i + j);
  const ramp: NavGrid = { w: n, h: n, over: null, open: (k) => open[k] === 1, step: (a, b) => Math.abs(top[a] - top[b]) <= 0.6 };
  const t = new Int32Array(4);
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) assert.ok(wideBlock(ramp, i, j, 0, t), `ramp block ${i},${j}`);
  // a bridge abutment: tiles 0-1 of each row are ground at 3 m, tiles 2-5 a deck at 3 m over a chasm (ground closed)
  const over = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 2; i < n; i++) { over[j * n + i] = 3; open[j * n + i] = 0; }
  const N = n * n, h = (a: number) => (a >= N ? over[a - N] : 3);
  const bridge: NavGrid = { w: n, h: n, over, open: (k) => open[k] === 1, step: (a, b) => Math.abs(h(a) - h(b)) <= 0.6 };
  const M = blockMask(bridge);
  assert.equal(M[1 * n + 1], 1, 'the block straddling ground and deck is wide');
});

test('location maps: the wide gate holds and every arena and boss hall is wide-reachable from the hub on sampled seeds', () => {
  for (const id of ['viridian-forest', 'mt-moon', 'chargestone-cave']) for (const seed of [1, 6, 9]) {
    const m = generateLocation({ location: id, seed });
    const g = m.gen!, L = g.loc!;
    assert.ok(g.gates.find((x) => x.id === 'wide')?.ok, `${id} seed ${seed} wide gate: ${g.gates.find((x) => x.id === 'wide')?.value}`);
    assert.equal(L.metrics.wideBoss, 1);
    const hub = L.zones.find((z) => z.kind === 'hub')!, core = wideCore(m, Math.floor(hub.y) * m.w + Math.floor(hub.x));
    assert.ok(core.some((v) => v === 1));
  }
});

test('navigation and collision agree at runtime: real walkers of every class reach every mandatory space (and refuse a size-restricted one)', () => {
  for (const [id, seed] of [['viridian-forest', 1], ['chargestone-cave', 10]] as const) {
    const res = walkLocation(id, seed);
    const bad = res.filter((r) => !r.ok);
    assert.deepEqual(bad.map((r) => `${r.target} ${r.walker} ${r.note}`), [], `${id} seed ${seed}`);
    assert.ok(res.some((r) => r.walker === 'xl' && r.target.startsWith('boss')) && res.some((r) => r.walker === 'trainer-xl'));
  }
});

test('the tidal-cave retreat no longer pins on a loose rock (habplay drove the trainer into its centre), even with no crowd drag', () => {
  for (const crowdPush of [3, 0]) {
    const r = playHabitat('tidal-cave', 5, { raid: true, route: 'direct', rules: { player: { crowdPush } } })[0];
    assert.ok(r.back !== null, `retreat completes (crowdPush ${crowdPush})`);
    assert.equal(r.stalls, 0, `no stall (crowdPush ${crowdPush})`);
  }
});

test('stuckwatch tells a trapped partner from a bot that missed a narrow way out (escapeOf)', () => {
  for (const species of ['totodile', 'feraligatr']) {
    const ctx = createRun({ mode: RANGE, seed: 1, species, ruleOverrides: {} as never });
    const W = ctx.world, P = ctx.player, [I, J] = openSquare(W, 14), ci = I + 7, cj = J + 7;
    const put = () => { P.x = P.px = ci - W.half + 0.5; P.z = P.pz = cj - W.half + 0.5; P.y = W.height(P.x, P.z); };
    put();
    let r = escapeOf(ctx);
    assert.equal(r.free, 16, `${species}: open ground`); assert.equal(r.trapped, false);
    // a ring of walls three tiles out: a sealed 5 × 5 pocket, room to move but nowhere to go
    const ring: [number, number][] = [];
    for (let d = -3; d <= 3; d++) ring.push([ci + d, cj - 3], [ci + d, cj + 3]);
    for (let d = -2; d <= 2; d++) ring.push([ci - 3, cj + d], [ci + 3, cj + d]);
    withWalls(W, ring, () => {
      put(); r = escapeOf(ctx);
      assert.ok(r.free > 0 && r.room < TRAP_ROOM, `${species}: sealed pocket (${r.free} free, ${r.room} tiles)`);
      assert.equal(r.trapped, true, `${species}: a sealed pocket is a trap`);
    });
    // the same pocket with a one-tile way out: no trap for a Small partner, still one for an Extra Large one, which does
    // not fit the exit (a point flood called both free); a two-tile exit lets both out
    withWalls(W, ring.filter(([a, b]) => !(a === ci && b === cj + 3)), () => {
      put(); r = escapeOf(ctx);
      assert.equal(r.trapped, species === 'feraligatr', `${species}: a one-tile exit (${r.free} free, ${r.room} tiles)`);
    });
    withWalls(W, ring.filter(([a, b]) => !((a === ci || a === ci + 1) && b === cj + 3)), () => {
      put(); r = escapeOf(ctx);
      assert.equal(r.trapped, false, `${species}: a two-tile exit (${r.free} free, ${r.room} tiles)`);
    });
    // walled in on all eight sides: no heading moves it, and its tile is a pocket of one
    const box: [number, number][] = [];
    for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) if (a || b) box.push([ci + a, cj + b]);
    withWalls(W, box, () => {
      put(); r = escapeOf(ctx);
      assert.equal(r.trapped, true, `${species}: boxed in (${r.free} free, ${r.room} tiles)`);
      if (species === 'feraligatr') assert.equal(r.free, 0, 'an Extra Large footprint has no room to move in one tile');
    });
  }
});
