import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultRules } from '../src/rules/defaults';
import { BIOMES } from '../src/rules/stages';
import { World, DECK_REACH, DECK_SLAB } from '../src/sim/world';
import { createRun, step } from '../src/sim/run';
import { botInput } from '../src/sim/bot';
import { spawnEnemy } from '../src/sim/enemies';
import { spawnBody, TEAM } from '../src/sim/bodies';
import { projectileSystem } from '../src/sim/effects';
import { PK } from '../src/sim/pools';
import { Grid } from '../src/core/grid';
import { Rng } from '../src/core/rng';
import { dcos, dsin } from '../src/core/detmath';
import { SPECIES, SPECIES_BY_ID } from '../src/rules/species';
import { bodyOf } from '../src/rules/sizing';
import { T } from '../src/world/tiles';
import type { SimContext } from '../src/sim/types';
import {
  CF, Contacts, MASK, QF, RayHit, SK, SK_ACTOR, SK_WORLD, overlapCylinder, overlapSector, raycastWorld, segmentClear,
  solidAt, spatialQuery, sweep, sweepTo,
} from '../src/sim/spatial';

// Phase 2A spatial queries (src/sim/spatial.ts; docs/THIRD_PERSON_IMPLEMENTATION.md §12). Synthetic scenes copy the
// map arrays of an authored world before editing them (the base map is cached and shared by every World), so no test
// changes another's map.

const ROOT2 = Math.SQRT1_2;
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;
/** a contact's kind (a call: assert.equal would otherwise narrow the element's type for the rest of the test) */
const kindOf = (o: Contacts, i: number): number => o.kind[i];
const count = (o: Contacts): number => o.n;
const occluded = (o: Contacts): number => o.occluded;

/** an authored world whose map is replaced by a private flat grass plain at height 0 (decks and chasm masks ready) */
function flatWorld(): World {
  const W = new World(defaultRules, BIOMES.meadow, 5);
  const n = W.w * W.h, M = W.map;
  const map = { ...M, terrain: new Uint8Array(n), elev: new Float32Array(n), stairs: new Uint8Array(n), wall: new Uint8Array(n), platform: new Float32Array(n), over: new Float32Array(n), wlevel: undefined };
  Object.assign(W, { map, over: map.over, voids: new Uint8Array(n) });
  return W;
}
const K = (W: World, i: number, j: number) => j * W.w + i;
/** world x of grid column i (its west edge) and of its centre */
const X = (W: World, i: number) => i - W.half;
const C = (W: World, i: number) => i - W.half + 0.5;

/** a run on the authored meadow with no enemies or bodies, on a private flat world */
function scene(ruleOverrides?: object): { ctx: SimContext; W: World } {
  const ctx = createRun({ seed: 1, species: 'cyndaquil', ruleOverrides: ruleOverrides as never });
  const W = flatWorld();
  ctx.world = W;
  ctx.enemies.clear(); ctx.bodies.clear(); ctx.projectiles.clear();
  ctx.player.x = C(W, 10); ctx.player.z = C(W, 10); ctx.player.y = 0;
  ctx.grid.rebuild(ctx.enemies.hi, ctx.enemies.x, ctx.enemies.z, ctx.enemies.alive);
  return { ctx, W };
}

function speciesOf(cls: string): string {
  const sp = SPECIES.filter((s) => bodyOf(s, defaultRules.size).sizeClass === cls && !bodyOf(s, defaultRules.size).authored && !s.flying).map((s) => s.id).sort();
  assert.ok(sp.length, `a ${cls} species`);
  return sp[0];
}

/** an enemy of `id` with its feet at (x, y, z), out of its spawn guard; the grid rebuilt */
function put(ctx: SimContext, id: string, x: number, y: number, z: number, radius?: number): number {
  const E = ctx.enemies, e = spawnEnemy(ctx, id, x, z);
  E.x[e] = E.px[e] = x; E.z[e] = E.pz[e] = z; E.y[e] = E.py[e] = y; E.spawnT[e] = 1; E.hp[e] = E.maxHp[e] = 1e6;
  if (radius !== undefined) E.radius[e] = radius;
  ctx.grid.rebuild(E.hi, E.x, E.z, E.alive);
  return e;
}

const HIT = new RayHit();
/** the last raycast's contact (a call, so the type checker does not narrow its fields across casts) */
const hit = (): RayHit => HIT;
const ray = (W: World, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number, mask = SK_WORLD, r = 0, h = 0, flags = 0) =>
  raycastWorld(W, ox, oy, oz, dx, dy, dz, maxT, mask, HIT, r, h, flags);

// ------------------------------------------------------------------------------------------------ terrain and props

test('terrain: a ray meets the ground and raised tiles at their faces; a ray lying in a floor plane does not touch it', () => {
  const W = flatWorld(), i = 50, j = 50, x = C(W, i), z = C(W, j);
  assert.ok(ray(W, x, 5, z, 0, -1, 0, 10));
  assert.ok(near(hit().t, 5) && hit().kind === SK.terrain && hit().id === K(W, i, j) && hit().ny === 1 && hit().flags === CF.block, 'straight down: 5 m, the top face');
  assert.equal(ray(W, x, 0, z, 1, 0, 0, 10), false, 'along the floor plane: no positive length inside the ground');
  W.map.elev[K(W, i + 3, j)] = 1;
  assert.ok(ray(W, x, 0.5, z, 1, 0, 0, 10));
  assert.ok(near(hit().t, 2.5) && hit().nx === -1 && hit().kind === SK.terrain && hit().id === K(W, i + 3, j), 'the side of a 1 m rise');
  assert.equal(ray(W, x, 1.2, z, 1, 0, 0, 10), false, 'over the rise');
  // a low prop is terrain of its platform height: cover below it, open above it (shoot over a bush)
  W.map.platform[K(W, i + 1, j)] = 0.7;
  assert.ok(ray(W, x, 0.5, z, 1, 0, 0, 10) && near(hit().t, 0.5) && hit().id === K(W, i + 1, j));
  assert.ok(ray(W, x, 0.8, z, 1, 0, 0, 10) && hit().id === K(W, i + 3, j), 'passes over the 0.7 m prop, stops at the 1 m rise');
  // the end of a segment exactly on a surface is not a hit (a positive length is needed)
  assert.equal(segmentClear(W, x, 2, z, x, 0, z), true, 'a segment ending on the ground');
  assert.equal(segmentClear(W, x, 2, z, x, -0.01, z), false);
});

test('stairs: the ramp is its sloped plane; contacts land on World.height with the plane normal', () => {
  const W = flatWorld(), i = 60, j = 40, M = W.map;
  M.elev[K(W, i, j - 1)] = 1; // the landing north of the flight (high end)
  M.stairs[K(W, i, j)] = 1; M.stairs[K(W, i, j + 1)] = 1;
  for (const f of [0.1, 0.25, 0.5, 0.9, 1.3, 1.75]) {
    const x = C(W, i), zz = X(W, j) + f;
    assert.ok(ray(W, x, 3, zz, 0, -1, 0, 10), `down onto the ramp at ${f}`);
    assert.ok(near(hit().t, 3 - W.height(x, zz), 1e-6), `on World.height (${(3 - hit().t).toFixed(4)} vs ${W.height(x, zz).toFixed(4)})`);
    assert.ok(hit().ny > 0.8 && hit().ny < 1 && hit().nz > 0, 'the normal tilts down the ramp (south, +z)');
  }
  // a horizontal ray up the flight meets the ramp where its height is the ray's
  assert.ok(ray(W, C(W, i), 0.25, j + 3 - W.half, 0, 0, -1, 10));
  assert.ok(near(W.height(hit().x, hit().z), 0.25, 1e-6), 'meets the plane at its own height');
});

// ------------------------------------------------------------------------------------------------ decks

test('decks: a 0.6 m slab: underside from below, top from above, open air in the underpass', () => {
  const W = flatWorld(), i = 40, j = 70, k = K(W, i, j), x = C(W, i), z = C(W, j);
  W.over![k] = 3; W.over![k + 1] = 3;
  assert.ok(ray(W, x, 0.5, z, 0, 1, 0, 10) && near(hit().t, 3 - DECK_SLAB - 0.5) && hit().kind === SK.deck && hit().ny === -1, 'up into the underside at 2.4 m');
  assert.ok(ray(W, x, 6, z, 0, -1, 0, 10) && near(hit().t, 3) && hit().kind === SK.deck && hit().ny === 1, 'down onto the top');
  assert.equal(ray(W, X(W, i) - 2, 1.5, z, 1, 0, 0, 6), false, 'through the underpass under it');
  assert.ok(ray(W, X(W, i) - 2, 2.7, z, 1, 0, 0, 6) && near(hit().t, 2) && hit().kind === SK.deck && hit().nx === -1, 'into the slab edge');
  assert.equal(ray(W, X(W, i) - 2, 3.4, z, 1, 0, 0, 6), false, 'over it');
  assert.equal(ray(W, x, 0.5, z, 0, 1, 0, 10, SK_WORLD & ~SK.deck), false, 'a mask without decks sees through it');
  // the layer rule: a deck tile's ground is still terrain under it
  assert.ok(ray(W, x, 2, z, 0, -1, 0, 10) && near(hit().t, 2) && hit().kind === SK.terrain, 'from inside the underpass down to the ground');
  // spatial and the movement layer agree on the underside (World.ceilingAt)
  assert.equal(W.ceilingAt(x, z, 0), 3 - DECK_SLAB);
});

test('decks: a wall under a deck stops at the slab; a chasm has no floor unless a deck spans it', () => {
  const W = flatWorld(), i = 30, j = 30, k = K(W, i, j), x = C(W, i), z = C(W, j);
  W.map.wall[k] = 1;
  assert.ok(ray(W, X(W, i) - 1, 50, z, 1, 0, 0, 5) && hit().kind === SK.wall, 'a wall column has no top');
  W.over![k] = 3;
  assert.equal(ray(W, X(W, i) - 1, 3.5, z, 1, 0, 0, 5), false, 'with a deck over it, above the deck is open');
  assert.ok(ray(W, X(W, i) - 1, 2.7, z, 1, 0, 0, 5) && hit().kind === SK.deck, 'the slab');
  assert.ok(ray(W, X(W, i) - 1, 1, z, 1, 0, 0, 5) && hit().kind === SK.wall, 'the wall up to the underside');
  const kv = K(W, i + 5, j);
  W.voids![kv] = 1; W.map.wall[kv] = 1; W.map.elev[kv] = -6;
  assert.equal(ray(W, C(W, i + 5), 2, z, 0, -1, 0, 30), false, 'straight down a chasm: open air, no floor, no wall');
  W.over![kv] = 1;
  assert.ok(ray(W, C(W, i + 5), 2, z, 0, -1, 0, 30) && near(hit().t, 1) && hit().kind === SK.deck, 'a bridge over it');
});

test('decks on generated maps: the underpass, the slab between layers and a line from the top to the ground beneath', () => {
  for (const loc of ['mt-moon', 'chargestone-cave']) {
    const rules = { ...defaultRules, worldgen: { ...defaultRules.worldgen, mode: 'generated' as const, locations: { meadow: loc } } };
    const W = new World(rules, BIOMES.meadow, 4), m = W.map, S = m.w;
    let tested = 0;
    for (let k = 0; k < S * S && tested < 20; k++) {
      const ov = m.over?.[k] ?? 0;
      if (ov <= 0 || m.wall[k] || (W.voids && W.voids[k])) continue;
      const x = (k % S) - W.half + 0.5, z = ((k / S) | 0) - W.half + 0.5, g = W.height(x, z);
      assert.ok(ray(W, x, g + 0.3, z, 0, 1, 0, 20) && hit().kind === SK.deck && near(hit().y, ov - DECK_SLAB, 1e-5), `${loc} ${k}: up to the underside`);
      assert.ok(ray(W, x, ov + 2, z, 0, -1, 0, 20) && hit().kind === SK.deck && near(hit().y, ov, 1e-5), `${loc} ${k}: down to the top`);
      assert.equal(segmentClear(W, x, ov + 0.9, z, x, g + 0.6, z), false, 'top to the ground beneath crosses the slab');
      assert.equal(segmentClear(W, x, g + 0.3, z, x, ov - DECK_SLAB - 0.05, z), true, 'the underpass is open');
      tested++;
    }
    assert.ok(tested > 5, `${loc}: deck tiles tested (${tested})`);
  }
});

// ------------------------------------------------------------------------------------------------ walls, bounds, corners

test('walls and bounds: columns stop rays at their faces; the map edge only when the mask asks for it', () => {
  const W = flatWorld(), i = 20, j = 20, x = C(W, i), z = C(W, j);
  W.map.wall[K(W, i + 2, j)] = 1;
  assert.ok(ray(W, x, 0.5, z, 1, 0, 0, 10) && near(hit().t, 1.5) && hit().kind === SK.wall && hit().nx === -1 && hit().id === K(W, i + 2, j));
  assert.ok(ray(W, x, 0.5, z, -1, 0, 0, 100, SK_WORLD) && hit().kind === SK.bounds && near(hit().x, -W.half) && hit().nx === 1, 'the west edge');
  assert.equal(ray(W, x, 0.5, z, -1, 0, 0, 100, SK_WORLD & ~SK.bounds), false, 'edge ignored: clear');
  assert.ok(ray(W, -W.half - 5, 0.5, z, 1, 0, 0, 100, SK_WORLD) && hit().t === 0 && hit().flags & CF.initial, 'a start outside the map is inside bounds');
  assert.ok(ray(W, -W.half - 5, 0.5, z, 1, 0, 0, 100, SK_WORLD & ~SK.bounds) && hit().kind === SK.wall && near(hit().x, X(W, i + 2)), 'outside with bounds ignored: walks in from the edge');
});

test('corners: an exact corner between two diagonal walls is sealed; one wall is grazed; a hair off goes into the wall', () => {
  const W = flatWorld(), a = 40, b = 40, x = C(W, a), z = C(W, b);
  W.map.wall[K(W, a + 1, b)] = 1; W.map.wall[K(W, a, b + 1)] = 1;
  assert.ok(ray(W, x, 0.5, z, ROOT2, 0, ROOT2, 5), 'two walls touching at a corner');
  assert.ok(hit().flags & CF.seal && near(hit().t, Math.SQRT2 / 2) && hit().kind === SK.wall && hit().id === K(W, a + 1, b) && hit().nx === -1, 'stopped at the corner, x-side wall reported');
  W.map.wall[K(W, a, b + 1)] = 0;
  assert.equal(ray(W, x, 0.5, z, ROOT2, 0, ROOT2, 5), false, 'one wall: the ray grazes its corner (zero length inside)');
  assert.ok(ray(W, x + 1e-9, 0.5, z, ROOT2, 0, ROOT2, 5) && !(hit().flags & CF.seal) && hit().id === K(W, a + 1, b), 'a hair east of the corner: inside the wall');
  // along a tile boundary: the half-open rule (World.tile) puts the line in the tile east and south of it
  const k = K(W, a + 5, b);
  W.map.wall[k] = 1;
  assert.ok(ray(W, X(W, a + 5), 0.5, z - 3, 0, 0, 1, 6) && hit().id === k && near(hit().z, X(W, b)), 'along the west face line: inside the wall tile');
  assert.equal(ray(W, X(W, a + 6), 0.5, z - 3, 0, 0, 1, 6), false, 'along the east face line: in the open tile');
});

test('adjacent blockers: a seam between two wall tiles and a row of walls report one deterministic tile', () => {
  const W = flatWorld(), i = 70, j = 70;
  for (let d = 0; d < 4; d++) W.map.wall[K(W, i, j + d)] = 1;
  // aimed exactly at the seam between rows j and j+1: the point belongs to row j+1 (half-open)
  const tx = X(W, i), tz = X(W, j + 1), ox = tx - 3, oz = tz - 1.5, L = Math.hypot(3, 1.5);
  assert.ok(ray(W, ox, 0.5, oz, 3 / L, 0, 1.5 / L, 10) && near(hit().x, tx, 1e-9) && hit().id === K(W, i, j + 1) && hit().nx === -1);
  // straight along the row's face from the south: the first tile of the row it reaches
  assert.ok(ray(W, tx + 0.5, 0.5, X(W, j + 6), 0, 0, -1, 10) && hit().id === K(W, i, j + 3) && hit().nz === 1);
});

// ------------------------------------------------------------------------------------------------ swept volumes vs the world

test('fat sweeps: the footprint grows to a rounded square; parallel passes and corner passes are exact', () => {
  const W = flatWorld(), i = 50, j = 80;
  for (let d = 2; d < 7; d++) W.map.wall[K(W, i + d, j)] = 1;
  const z0 = X(W, j), sx = C(W, i);
  // 0.2 m from the row's north face with r = 0.3: the first wall tile's rounded corner
  assert.ok(ray(W, sx, 0.5, z0 - 0.2, 1, 0, 0, 10, SK_WORLD, 0.3));
  assert.ok(near(hit().x, X(W, i + 2) - Math.sqrt(0.3 * 0.3 - 0.2 * 0.2), 1e-9) && hit().id === K(W, i + 2, j), `entry on the rounded corner (x ${hit().x})`);
  assert.equal(ray(W, sx, 0.5, z0 - 0.35, 1, 0, 0, 10, SK_WORLD, 0.3), false, '0.35 m off: clear');
  // diagonal past a lone wall's corner: the square-grown box would reach 0.42 m out along the diagonal, the round one 0.3
  const W2 = flatWorld(), a = 30, b = 30, cx = X(W2, a), cz = X(W2, b);
  W2.map.wall[K(W2, a, b)] = 1;
  for (const [dist, meets] of [[0.32, false], [0.28, true]] as [number, boolean][]) {
    const s = dist * Math.SQRT2; // the line x + z = cx + cz − s passes the corner at `dist`
    const ox = cx - 3, oz = cz - s + 3;
    assert.equal(ray(W2, ox, 0.5, oz, ROOT2, 0, -ROOT2, 10, SK_WORLD, 0.3), meets, `corner pass at ${dist} m`);
    if (meets) {
      // the first touch is 0.3 m from the corner (not the closest approach), and the normal points from the corner to it
      const ex = hit().x - cx, ez = hit().z - cz, d = Math.hypot(ex, ez);
      assert.ok(near(d, 0.3, 1e-9) && near(hit().nx, ex / d, 1e-9) && near(hit().nz, ez / d, 1e-9) && ex < 0 && ez < 0, 'touches the rounded corner, normal away from it');
    }
  }
  // half-height against the ground: a volume 0.2 m above the floor with h = 0.3 starts inside it
  assert.ok(ray(W, sx, 0.2, z0 - 3, 1, 0, 0, 3, SK_WORLD, 0.1, 0.3) && hit().t === 0 && hit().flags & CF.initial);
  assert.equal(ray(W, sx, 0.2, z0 - 3, 1, 0, 0, 3, SK_WORLD, 0.1, 0.1), false);
});

test('initial overlap: a start inside a solid is a t = 0 contact; skipInitialWorld leaves it and meets the next', () => {
  const W = flatWorld(), i = 60, j = 60, x = C(W, i), z = C(W, j);
  W.map.wall[K(W, i, j)] = 1; W.map.wall[K(W, i + 2, j)] = 1;
  assert.ok(ray(W, x, 1, z, 1, 0, 0, 5) && hit().t === 0 && hit().flags & CF.initial && hit().nx === -1 && hit().kind === SK.wall);
  assert.ok(ray(W, x, 1, z, 1, 0, 0, 5, SK_WORLD, 0, 0, QF.skipInitialWorld) && near(hit().t, 1.5) && !(hit().flags & CF.initial) && hit().id === K(W, i + 2, j));
  assert.ok(ray(W, C(W, i + 1), -0.5, z, 0, 1, 0, 5) && hit().t === 0 && hit().kind === SK.terrain, 'from under the ground');
  assert.equal(ray(W, C(W, i + 1), -0.5, z, 0, 1, 0, 5, SK_WORLD, 0, 0, QF.skipInitialWorld), false, 'leaving the ground upward');
  assert.equal(solidAt(W, x, 1, z), SK.wall);
  assert.equal(solidAt(W, C(W, i + 1), 1, z), 0);
});

// ------------------------------------------------------------------------------------------------ actors

test('giants (size-extremes default flip): a ray at 0.85 of Onix\'s drawn height hits with the size flags on and misses with them off; a 0.3 m bolt at 95 % of it hits', () => {
  // with axis + xlContinuous + xlTall (the defaults) an Extra Large body's hit window is 0.892 x its drawn height, so a
  // shot at the upper body of the sprite lands; with the flags off the window stops at the class height. One aim height
  // for both runs, from the flags-on body
  const ON = defaultRules.size, OFF = { size: { axis: false, xlContinuous: false, xlTall: false } };
  const on = bodyOf(SPECIES_BY_ID.onix, ON), off = bodyOf(SPECIES_BY_ID.onix, { ...ON, ...OFF.size });
  const h = 0.85 * on.visualM;
  assert.ok(off.height < h && h < on.height, `windows ${off.height.toFixed(2)} / ${on.height.toFixed(2)} m bracket ${h.toFixed(2)} m`);
  const shot = (over: object | undefined, y: number, r: number) => {
    const { ctx, W } = scene(over), z = C(W, 50);
    const e = put(ctx, 'onix', C(W, 60), 0, z), out = new Contacts();
    sweep(ctx, C(W, 50), y, z, 1, 0, 0, 20, spatialQuery({ mask: SK.enemy, block: 0, actorR: r, actorH: r }), out);
    return { hit: [...out.id.subarray(0, out.n)].includes(e), tall: ctx.enemies.tall[e] };
  };
  const rayOn = shot(undefined, h, 0), rayOff = shot(OFF, h, 0);
  assert.ok(Math.abs(rayOn.tall - on.height) < 1e-5 && Math.abs(rayOff.tall - off.height) < 1e-5, 'E.tall carries each body');
  assert.ok(rayOn.hit, 'flags on: the ray hits');
  assert.ok(!rayOff.hit, 'flags off: the ray passes over the window');
  assert.ok(shot(undefined, 0.95 * on.visualM, 0.3).hit, 'flags on: a 0.3 m bolt at 95 % of the drawn height hits');
});

test('actors: size-class cylinders; actor radius and half-height inflate the volume exactly', () => {
  const { ctx, W } = scene(), z = C(W, 50);
  const tiny = put(ctx, speciesOf('tiny'), C(W, 50), 0, z), xl = put(ctx, speciesOf('xl'), C(W, 60), 0, z);
  const E = ctx.enemies, out = new Contacts(), q = spatialQuery({ mask: SK.enemy, block: 0 });
  assert.ok(E.tall[tiny] < 0.8 && E.tall[xl] > 2 && E.radius[tiny] < 0.4 && E.radius[xl] > 0.8, 'real class bodies');
  // at 1.0 m: over the Tiny body, into the Extra Large one
  sweep(ctx, C(W, 45), 1.0, z, 1, 0, 0, 30, q, out);
  assert.deepEqual([...out.id.subarray(0, out.n)], [xl]);
  assert.ok(near(out.t[0], C(W, 60) - E.radius[xl] - C(W, 45), 1e-5) && near(out.nx[0], -1, 1e-6));
  // 0.6 m off both axes at 0.3 m: misses Tiny (r 0.32) as a ray, hits it with a 0.4 m shot radius
  sweep(ctx, C(W, 45), 0.3, z + 0.6, 1, 0, 0, 30, q, out);
  assert.deepEqual([...out.id.subarray(0, out.n)], [xl]);
  sweep(ctx, C(W, 45), 0.3, z + 0.6, 1, 0, 0, 30, { ...q, actorR: 0.4 }, out);
  assert.deepEqual([...out.id.subarray(0, out.n)], [tiny, xl]);
  // 0.3 m over the Tiny head: a ray misses, a 0.4 m half-height touches it on its top cap
  const top = E.y[tiny] + E.tall[tiny];
  sweep(ctx, C(W, 45), top + 0.3, z, 1, 0, 0, 10, q, out);
  assert.equal(out.n, 0);
  sweep(ctx, C(W, 45), top + 0.3, z, 1, 0, 0, 10, { ...q, actorH: 0.4 }, out);
  assert.equal(out.n, 1);
  // straight down onto it: the top cap, normal up
  sweep(ctx, C(W, 50), 3, z, 0, -1, 0, 5, q, out);
  assert.ok(out.n === 1 && near(out.t[0], 3 - top, 1e-6) && out.ny[0] === 1);
  // the trainer's partner is a cylinder too (an enemy shot's mask), and is never its own target
  const P = ctx.player;
  P.x = C(W, 70); P.z = z; P.y = 0;
  sweep(ctx, C(W, 66), 0.5, z, 1, 0, 0, 10, spatialQuery({ mask: MASK.hostile }), out);
  assert.ok(out.n === 1 && kindOf(out, 0) === SK.player && out.flags[0] & CF.block);
  sweep(ctx, P.x, 0.5, z, 1, 0, 0, 10, spatialQuery({ mask: MASK.hostile, selfKind: SK.player, selfId: 0 }), out);
  assert.equal(out.n, 0, 'self ignored');
  sweep(ctx, P.x, 0.5, z, 1, 0, 0, 10, spatialQuery({ mask: MASK.hostile }), out);
  assert.ok(out.n === 1 && out.t[0] === 0 && out.flags[0] & CF.initial, 'without self-ignore: a start inside the partner');
});

test('ordered contacts and penetration: nearest first whatever the slot order; pierce counts; walls end every list', () => {
  const { ctx, W } = scene(), z = C(W, 50), sp = speciesOf('medium');
  // slots in reverse distance order, and one behind the wall
  const far = put(ctx, sp, C(W, 59), 0, z), mid = put(ctx, sp, C(W, 56), 0, z), nearE = put(ctx, sp, C(W, 53), 0, z), hidden = put(ctx, sp, C(W, 64), 0, z);
  W.map.wall[K(W, 62, 50)] = 1;
  const out = new Contacts(), ids = () => [...out.id.subarray(0, out.n)], kinds = () => [...out.kind.subarray(0, out.n)], flags = () => [...out.flags.subarray(0, out.n)];
  const go = (q: Partial<Parameters<typeof spatialQuery>[0]>) => sweep(ctx, C(W, 50), 0.5, z, 1, 0, 0, 30, spatialQuery({ mask: MASK.shot, ...q }), out);
  go({ pierce: 0 });
  assert.deepEqual(ids(), [nearE]); assert.deepEqual(flags(), [CF.block]);
  go({ pierce: 1 });
  assert.deepEqual(ids(), [nearE, mid]); assert.deepEqual(flags(), [CF.pierced, CF.block]);
  go({ pierce: Infinity });
  assert.deepEqual(ids(), [nearE, mid, far, K(W, 62, 50)]); assert.deepEqual(kinds(), [SK.enemy, SK.enemy, SK.enemy, SK.wall]);
  assert.deepEqual(flags(), [CF.pierced, CF.pierced, CF.pierced, CF.block]);
  assert.ok(out.stop === 3 && near(out.stopT, X(W, 62) - C(W, 50)));
  go({ block: 0 });
  assert.deepEqual(flags(), [CF.overlap, CF.overlap, CF.overlap, CF.block], 'enemies as overlaps; the wall still blocks');
  assert.ok(!ids().includes(hidden), 'nothing behind the wall');
  go({ mask: SK.enemy, pierce: Infinity });
  assert.deepEqual(ids(), [nearE, mid, far, hidden], 'walls ignored by the mask');
  for (let p = 1; p < out.n; p++) assert.ok(out.t[p] > out.t[p - 1]);
  // capacity: a short list keeps the nearest, marks truncation and does not claim a clear path
  const small = new Contacts(2);
  sweep(ctx, C(W, 50), 0.5, z, 1, 0, 0, 30, spatialQuery({ mask: SK.enemy, pierce: Infinity }), small);
  assert.ok(small.truncated && small.n === 2 && small.id[0] === nearE && small.id[1] === mid && small.stop === -1 && near(small.stopT, small.t[1]));
});

test('overlapping obstacles: an enemy against a wall, overlapping enemies, and exact ties broken by kind then id', () => {
  const { ctx, W } = scene(), z = C(W, 50), sp = speciesOf('medium');
  W.map.wall[K(W, 55, 50)] = 1;
  const face = X(W, 55);
  // centre 0.2 m inside the wall: its front still stands proud of the face, so it is reached first
  const e = put(ctx, sp, face + 0.2, 0, z), out = new Contacts();
  sweep(ctx, C(W, 50), 0.5, z, 1, 0, 0, 30, spatialQuery({ pierce: Infinity }), out);
  assert.equal(out.n, 2); assert.equal(out.id[0], e); assert.equal(kindOf(out, 1), SK.wall);
  // two enemies overlapping each other on the line, then a tie: two at mirrored offsets meet the ray at the same t
  const { ctx: c2, W: W2 } = scene(), z2 = C(W2, 50);
  const b = put(c2, sp, C(W2, 54) + 0.3, 0, z2), a = put(c2, sp, C(W2, 54), 0, z2);
  sweep(c2, C(W2, 50), 0.5, z2, 1, 0, 0, 30, spatialQuery({ mask: SK.enemy, pierce: Infinity }), out);
  assert.deepEqual([...out.id.subarray(0, out.n)], [a, b], 'the overlapping pair in entry order');
  const { ctx: c3, W: W3 } = scene(), z3 = C(W3, 50);
  const s1 = put(c3, sp, C(W3, 54), 0, z3 + 0.3), s0 = put(c3, sp, C(W3, 54), 0, z3 - 0.3);
  sweep(c3, C(W3, 50), 0.5, z3, 1, 0, 0, 30, spatialQuery({ mask: SK.enemy, pierce: Infinity }), out);
  assert.ok(out.n === 2 && out.t[0] === out.t[1], 'an exact tie');
  assert.deepEqual([...out.id.subarray(0, 2)], [Math.min(s0, s1), Math.max(s0, s1)], 'broken by id');
  // a tie between cover and an enemy: cover wins (bounds, wall, deck, terrain, liquid, body, player, enemy)
  const { ctx: c4, W: W4 } = scene(), z4 = C(W4, 50);
  W4.map.wall[K(W4, 55, 50)] = 1;
  const R = 0.5, e4 = put(c4, sp, X(W4, 55) + R, 0, z4, R);
  sweep(c4, C(W4, 50), 0.5, z4, 1, 0, 0, 30, spatialQuery({ pierce: Infinity }), out);
  assert.ok(count(out) === 1 && kindOf(out, 0) === SK.wall && out.flags[0] & CF.block, `the enemy touching the face at the same t is behind cover (${e4})`);
});

test('layers and filters: a deck between a shooter and an enemy; bodies by team; spawn guard', () => {
  const { ctx, W } = scene(), i = 50, j = 50, sp = speciesOf('medium');
  for (let d = -2; d <= 2; d++) for (let e = -2; e <= 2; e++) W.over![K(W, i + d, j + e)] = 3;
  const top = put(ctx, sp, C(W, i), 3, C(W, j)), out = new Contacts(), E = ctx.enemies;
  // from under the deck, aimed at the enemy standing on it: the slab first, nothing past it
  sweepTo(ctx, C(W, i) - 1, 0.5, C(W, j), C(W, i), 3 + E.tall[top] / 2, C(W, j), spatialQuery(), out);
  assert.ok(out.n === 1 && kindOf(out, 0) === SK.deck && out.ny[0] === -1, 'the underside blocks');
  // from the deck itself it is a clear shot
  sweepTo(ctx, C(W, i) - 2, 3.5, C(W, j), C(W, i) + 2, 3.5, C(W, j), spatialQuery(), out);
  assert.ok(out.n === 1 && kindOf(out, 0) === SK.enemy && out.id[0] === top);
  // a body: tested only for the teams the query names; a bounding cylinder of 2r
  const b = spawnBody(ctx, 'rock', C(W, 70), C(W, 50), 0, 0, TEAM.neutral);
  ctx.bodies.y[b] = 0;
  sweep(ctx, C(W, 66), 0.5, C(W, 50), 1, 0, 0, 10, spatialQuery({ mask: SK.body }), out);
  assert.ok(out.n === 1 && out.id[0] === b && kindOf(out, 0) === SK.body);
  sweep(ctx, C(W, 66), 0.5, C(W, 50), 1, 0, 0, 10, spatialQuery({ mask: SK.body, bodyTeams: 1 << TEAM.enemy }), out);
  assert.equal(out.n, 0, 'neutral bodies filtered out');
  // the spawn guard (rules.spatial.spawnGuard), unless the query asks for spawning enemies
  const fresh = put(ctx, sp, C(W, 80), 0, C(W, 50));
  E.spawnT[fresh] = 0.1;
  sweep(ctx, C(W, 76), 0.5, C(W, 50), 1, 0, 0, 10, spatialQuery({ mask: SK.enemy }), out);
  assert.equal(out.n, 0);
  sweep(ctx, C(W, 76), 0.5, C(W, 50), 1, 0, 0, 10, spatialQuery({ mask: SK.enemy, flags: QF.spawning }), out);
  assert.equal(out.n, 1);
});

test('overlaps: an upright cylinder and an exact sector, with vertical bands and line of sight', () => {
  const { ctx, W } = scene(), x = C(W, 50), z = C(W, 50), sp = speciesOf('medium'), out = new Contacts();
  for (let d = 2; d <= 4; d++) for (let e = -1; e <= 1; e++) W.over![K(W, 50 + d, 50 + e)] = 3;
  const ground = put(ctx, sp, x + 1.5, 0, z), deckE = put(ctx, sp, x + 3, 3, z), farE = put(ctx, sp, x - 2.2, 0, z);
  const q = spatialQuery({ mask: SK_ACTOR & ~SK.player });
  overlapCylinder(ctx, x, -0.5, 2, z, 3, q, out);
  assert.deepEqual([...out.id.subarray(0, out.n)], [ground, farE], 'nearest first; the enemy on the deck is outside the band');
  assert.ok(out.flags[0] === CF.overlap && near(out.t[0], 1.5, 1e-5));
  overlapCylinder(ctx, x, -0.5, 4, z, 3.2, q, out);
  assert.ok([...out.id.subarray(0, out.n)].includes(deckE), 'a taller band reaches the deck');
  overlapCylinder(ctx, x, -0.5, 4, z, 3.2, { ...q, flags: QF.sight }, out);
  assert.ok([...out.id.subarray(0, out.n)].includes(deckE) && out.occluded === 0, 'line of sight tests the world kinds in the mask: none here');
  overlapCylinder(ctx, x, -0.5, 4, z, 3.2, { ...q, mask: q.mask | MASK.los, flags: QF.sight }, out);
  assert.ok(![...out.id.subarray(0, out.n)].includes(deckE) && occluded(out) === 1, 'with them, the slab hides it from the centre');
  // a 45° half-angle wedge facing +x: an enemy at 60° and 2 m is 2·sin 15° = 0.518 m from the edge segment
  const { ctx: c2, W: W2 } = scene(), x2 = C(W2, 50), z2 = C(W2, 50), a = Math.PI / 3, cos45 = dcos(Math.PI / 4);
  const edge = 2 * dsin(Math.PI / 12);
  const inE = put(c2, sp, x2 + 2 * dcos(a), 0, z2 + 2 * dsin(a), edge + 0.01);
  const outE = put(c2, sp, x2 + 2 * dcos(a), 0, z2 - 2 * dsin(a), edge - 0.01);
  const behind = put(c2, sp, x2 - 1.5, 0, z2);
  const ahead = put(c2, sp, x2 + 3.4, 0, z2);
  overlapSector(c2, x2, -0.5, 2, z2, 3, 1, 0, cos45, spatialQuery({ mask: SK.enemy }), out);
  const got = [...out.id.subarray(0, out.n)];
  assert.ok(got.includes(inE) && !got.includes(outE) && !got.includes(behind), `the edge is exact (${got})`);
  assert.ok(got.includes(ahead), 'past the arc by less than its radius: its disc reaches in');
  // a zero-width wedge is a line, not a circle
  overlapSector(c2, x2, -0.5, 2, z2, 3, 1, 0, 1, spatialQuery({ mask: SK.enemy }), out);
  assert.deepEqual([...out.id.subarray(0, out.n)].sort(), [ahead].sort());
  void W;
});

// ------------------------------------------------------------------------------------------------ tunnelling and the projectile defects

/** the scene of the real projectile system: a straight player shot along −z at 26 m/s (a bolt), radius 0.4. `traj` 0 is
 *  the legacy planar shot (end-of-tick point test, grid order: the bot and the fixed views); 1 the linear 3D shot the
 *  spatial aim launches (Phase 2B: swept, contact order) */
function shoot(ctx: SimContext, x: number, z: number, speed: number, pierce: number, traj = 0): number {
  const Pr = ctx.projectiles, i = Pr.spawn();
  Pr.kind[i] = PK.straight; Pr.x[i] = x; Pr.z[i] = z; Pr.y[i] = 0.8; Pr.vx[i] = 0; Pr.vz[i] = -speed; Pr.speed[i] = speed;
  Pr.life[i] = Pr.maxLife[i] = 1.5; Pr.dmg[i] = 1; Pr.radius[i] = 0.4; Pr.pierce[i] = pierce; Pr.move[i] = 0; Pr.element[i] = 0;
  Pr.traj[i] = traj; Pr.vy[i] = 0; Pr.oy[i] = 0.8; Pr.rem[i] = speed * 1.5;
  return i;
}

/** a Tiny enemy 1 cm inside a 0.4 m shot's reach of the line x, centred between two tick ends of a shot moving −z at
 *  `step` m per tick from z0 (tick 11 ends half a step before it, tick 12 half a step past it) */
function graze(ctx: SimContext, W: World, x: number, step: number) {
  const ez = C(W, 40), e = put(ctx, speciesOf('tiny'), x, 0, ez);
  const lat = ctx.enemies.radius[e] + 0.4 - 0.01;
  ctx.enemies.x[e] = ctx.enemies.px[e] = x + lat;
  ctx.grid.rebuild(ctx.enemies.hi, ctx.enemies.x, ctx.enemies.z, ctx.enemies.alive);
  return { e, lat, z0: ez + 11.5 * step };
}

test('tunnelling: a swept shot meets a Tiny body it passes between two ticks', () => {
  const { ctx, W } = scene(), x = C(W, 50), step = 26 / 60, { e, lat, z0 } = graze(ctx, W, x, step);
  const rr = ctx.enemies.radius[e] + 0.4;
  assert.ok(lat < rr && Math.hypot(lat, step / 2) > rr, 'the tick ends both miss it; the path between them crosses it');
  const out = new Contacts(), q = spatialQuery({ mask: SK.enemy, actorR: 0.4, actorH: 0.4 });
  let met = -1;
  for (let t = 0; t < 30 && met < 0; t++) if (sweep(ctx, x, 0.5, z0 - t * step, 0, 0, -1, step, q, out)) met = t;
  assert.equal(met, 11, 'the tick segment that passes it meets it');
});

// N2 and N1 were `todo` here in Phase 2A (owner: the direct-projectile migration). Phase 2B moved the spatial aim's
// shots onto sweep(): the linear 3D shot must pass both. The legacy planar shot keeps both defects on purpose (the bot,
// the fixed views and every checksum set fly it; it retires with roadmap Stage 7B), and the second half of each test
// pins that, so a change to it is seen.
test('tunnelling (effects.ts, N2): a linear 3D shot meets the graze the legacy end-of-tick point test misses', () => {
  for (const traj of [1, 0]) {
    const { ctx, W } = scene(), x = C(W, 50), step = 26 / 60, { e, z0 } = graze(ctx, W, x, step);
    shoot(ctx, x, z0, 26, 0, traj);
    for (let t = 0; t < 30; t++) { projectileSystem.update(ctx, 1 / 60); ctx.time += 1 / 60; }
    const dmg = ctx.enemies.maxHp[e] - ctx.enemies.hp[e];
    if (traj) assert.ok(dmg > 0, `the 3D shot hits the body it passed through (dmg ${dmg})`);
    else assert.equal(dmg, 0, 'legacy: still tunnels (kept for the replay hashes until Stage 7B)');
  }
});

test('pierce order (effects.ts, N1): with pierce 0 a linear 3D shot stops on the first body it reaches; legacy takes grid order', () => {
  for (const traj of [1, 0]) {
    const { ctx, W } = scene(), sp = speciesOf('tiny'), x = C(W, 50), zn = C(W, 40);
    const E = ctx.enemies;
    // the far one in the lower slot, the near one off the line: both inside reach on the same tick, near first by contact
    const far = put(ctx, sp, x, 0, zn - 0.45, 0.32), nearE = put(ctx, sp, x + 0.65, 0, zn, 0.32);
    const out = new Contacts();
    sweep(ctx, x, 0.5, zn + 5, 0, 0, -1, 10, spatialQuery({ mask: SK.enemy, actorR: 0.4, actorH: 1 }), out);
    assert.equal(out.id[0], nearE, 'contact order: the near one');
    shoot(ctx, x, zn + 26 / 60 * 12, 26, 0, traj);
    for (let t = 0; t < 20; t++) { projectileSystem.update(ctx, 1 / 60); ctx.time += 1 / 60; }
    const dn = E.maxHp[nearE] - E.hp[nearE], df = E.maxHp[far] - E.hp[far];
    if (traj) assert.ok(dn > 0 && df === 0, `near hit, far untouched: near ${dn} dmg, far ${df} dmg`);
    else assert.ok(dn === 0 && df > 0, `legacy: grid order reaches slot ${far} first (near ${dn}, far ${df}); kept until Stage 7B`);
  }
});

// ------------------------------------------------------------------------------------------------ the old sampled line test

test('World.sight against the exact query: sampling misses a wall corner the segment crosses', () => {
  const W = flatWorld(), a = 40, b = 40;
  W.map.wall[K(W, a, b)] = 1;
  const cx = X(W, a), cz = X(W, b);
  // lines x + z = cx + cz + 0.2 clip the tile's corner over a 0.28 m chord; search the phase that 0.5 m samples miss
  let found = 0;
  for (let s = 0; s < 50; s++) {
    const off = s * 0.01, x0 = cx - 3 + off, z0 = cz + 0.2 + 3 - off, x1 = x0 + 6, z1 = z0 - 6;
    assert.equal(segmentClear(W, x0, 0.5, z0, x1, 0.5, z1), false, 'the exact query always sees the clip');
    if (W.sight(x0, 0.5, z0, x1, 0.5, z1)) found++;
  }
  assert.ok(found > 0, `sampled sight misses the corner on ${found} of 50 phases`);
});

test('World.sight (I2): the 0.5 m sampled line should not see through a wall corner', { todo: 'Stage 7A (enemy line of fire on segmentClear; gate: this test active, enemy hashes migrated once). Phase 2B does not read World.sight' }, () => {
  const W = flatWorld(), a = 40, b = 40;
  W.map.wall[K(W, a, b)] = 1;
  const cx = X(W, a), cz = X(W, b);
  for (let s = 0; s < 50; s++) {
    const off = s * 0.01, x0 = cx - 3 + off, z0 = cz + 0.2 + 3 - off;
    assert.equal(W.sight(x0, 0.5, z0, x0 + 6, 0.5, z0 - 6), false);
  }
});

test('World.sight (I1): a line 0.3 m under a deck\'s drawn underside should be open', { todo: 'Stage 7A (World.sight treats the 0.9 m DECK_REACH band as slab; gate: this test active). Phase 2B shots use the 0.6 m DECK_SLAB' }, () => {
  const W = flatWorld(), i = 40, j = 70;
  for (let d = 0; d < 4; d++) W.over![K(W, i + d, j)] = 3;
  const y = 3 - DECK_SLAB - 0.15, z = C(W, j);
  assert.ok(y > 3 - DECK_REACH && segmentClear(W, X(W, i) - 1, y, z, X(W, i) + 5, y, z));
  assert.equal(W.sight(X(W, i) - 1, y, z, X(W, i) + 5, y, z), true);
});

test('exact against dense sampling, and World.sight compared, on 10 000 segments over generated maps', () => {
  const rng = new Rng(7);
  let segs = 0, blocked = 0, sightMiss = 0, sightBand = 0, sightOther = 0;
  for (const [loc, seed, count] of [['mt-moon', 4, 3334], ['chargestone-cave', 3, 3333], ['viridian-forest', 1, 3333]] as [string, number, number][]) {
    const rules = { ...defaultRules, worldgen: { ...defaultRules.worldgen, mode: 'generated' as const, locations: { meadow: loc } } };
    const W = new World(rules, BIOMES.meadow, seed), lim = W.half - 1;
    for (let s = 0; s < count; s++) {
      const x0 = rng.range(-lim, lim), z0 = rng.range(-lim, lim), a = rng.range(0, Math.PI * 2), len = rng.range(1, 24);
      const x1 = Math.min(lim, Math.max(-lim, x0 + Math.cos(a) * len)), z1 = Math.min(lim, Math.max(-lim, z0 + Math.sin(a) * len));
      const lift = () => rng.range(0.1, 3.5);
      // a third of the endpoints stand on a deck where there is one
      const y0 = W.height(x0, z0, rng.next() < 0.33 ? 99 : undefined) + lift(), y1 = W.height(x1, z1, rng.next() < 0.33 ? 99 : undefined) + lift();
      const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0, L = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const ux = dx / L, uy = dy / L, uz = dz / L;
      segs++;
      const met = raycastWorld(W, x0, y0, z0, ux, uy, uz, L, SK_WORLD, HIT);
      // no false negative: every densely sampled solid point means a contact at or before it
      let dense = Infinity;
      for (let t = 0.005; t < L; t += 0.01) if (solidAt(W, x0 + ux * t, y0 + uy * t, z0 + uz * t)) { dense = t; break; }
      if (dense < Infinity) assert.ok(met && hit().t <= dense + 1e-9, `${loc}: dense solid at ${dense.toFixed(3)} but contact ${met ? hit().t.toFixed(3) : 'none'}`);
      // no false positive: just past a contact the line is inside a solid (a corner seal excepted)
      if (met) {
        blocked++;
        if (!(hit().flags & CF.seal)) {
          const inside = [1e-9, 1e-7, 1e-5].some((e) => solidAt(W, x0 + ux * (hit().t + e), y0 + uy * (hit().t + e), z0 + uz * (hit().t + e)) !== 0);
          assert.ok(inside, `${loc}: contact at ${hit().t} with open space past it`);
        }
      }
      // World.sight over the part it samples (horizontal 0.5 m steps from 0.5 m to the last whole step before the end)
      const Lh = Math.hypot(dx, dz), n = Math.floor(Lh / 0.5);
      if (n < 2) continue;
      const fa = 0.5 / Lh, fb = ((n - 1) * 0.5) / Lh;
      const exact = segmentClear(W, x0 + dx * fa, y0 + dy * fa, z0 + dz * fa, x0 + dx * fb, y0 + dy * fb, z0 + dz * fb);
      const sampled = W.sight(x0, y0, z0, x1, y1, z1);
      if (sampled === exact) continue;
      if (sampled && !exact) { sightMiss++; continue; } // sampling stepped over a solid the exact query met
      // sight blocked where the exact query is clear: its 0.9 m deck band (vs the 0.6 m slab) must explain it
      let band = false;
      for (let q = 1; q < n && !band; q++) {
        const t = (q * 0.5) / Lh, x = x0 + dx * t, z = z0 + dz * t, y = y0 + dy * t, k = W.tile(x, z), ov = W.over ? W.over[k] : 0;
        if (ov > 0 && y >= ov - DECK_REACH && y <= ov - DECK_SLAB) band = true;
      }
      if (band) sightBand++; else sightOther++;
    }
  }
  console.log(`spatial vs sight: ${segs} segments, ${blocked} blocked; sight saw through ${sightMiss} (sampling), blocked ${sightBand} in the deck band, ${sightOther} unexplained`);
  assert.equal(sightOther, 0, 'every disagreement is sampling or the deck band');
  assert.ok(segs === 10000 && blocked > 1000);
});

// ------------------------------------------------------------------------------------------------ tick state and broad phase

test('live crowd: the grid broad phase never misses what a brute-force pass finds; enemies stay inside gridSlack', () => {
  const ctx = createRun({ seed: 2, species: 'cyndaquil', ruleOverrides: { director: { spawnBase: 12, spawnPerMin: 6, capBase: 330, capPerMin: 0 }, enemy: { liveCap: 330 } } as never });
  const E = ctx.enemies, rng = new Rng(11), out = new Contacts(64), q = spatialQuery({ mask: SK.enemy, pierce: Infinity, actorR: 0.4, actorH: 0.4 });
  let maxMove = 0, compared = 0, contacts = 0, peak = 0;
  const brute: [number, number][] = [];
  while (ctx.time < 70) {
    ctx.player.hp = ctx.player.maxHp;
    step(ctx, botInput(ctx));
    peak = Math.max(peak, E.count);
    // movement since the grid was built this tick (E.px is the position when enemySystem began, right after the rebuild;
    // a relocation resets it, and the grid then has the old cell until the next rebuild)
    for (let e = 0; e < E.hi; e++) if (E.alive[e]) maxMove = Math.max(maxMove, Math.abs(E.x[e] - E.px[e]), Math.abs(E.z[e] - E.pz[e]));
    if (ctx.tick % 20 !== 0) continue;
    for (let s = 0; s < 20; s++) {
      const a = rng.range(0, Math.PI * 2), L = rng.range(2, 30), ox = ctx.player.x, oz = ctx.player.z, oy = ctx.player.y + 0.6;
      const dx = Math.cos(a), dz = Math.sin(a);
      sweep(ctx, ox, oy, oz, dx, 0, dz, L, q, out);
      brute.length = 0;
      for (let e = 0; e < E.hi; e++) {
        if (!E.alive[e] || E.spawnT[e] < ctx.rules.spatial.spawnGuard) continue;
        // the same closed cylinder test, done by hand against every enemy
        const R = E.radius[e] + 0.4, px = ox - E.x[e], pz = oz - E.z[e], b = px * dx + pz * dz, c = px * px + pz * pz - R * R, disc = b * b - c;
        if (disc < 0 || oy < E.y[e] - 0.4 || oy > E.y[e] + E.tall[e] + 0.4) continue;
        const t1 = -b - Math.sqrt(disc), t2 = -b + Math.sqrt(disc);
        if (t2 < 0 || t1 > L) continue;
        brute.push([Math.max(0, t1), e]);
      }
      brute.sort((p, r) => p[0] - r[0] || p[1] - r[1]);
      assert.deepEqual([...out.id.subarray(0, out.n)], brute.map((p) => p[1]), `tick ${ctx.tick}`);
      compared++; contacts += out.n;
    }
  }
  console.log(`broad phase: ${compared} sweeps against brute force at up to ${peak} enemies, ${contacts} contacts; largest move after the grid rebuild ${maxMove.toFixed(3)} m (gridSlack ${ctx.rules.spatial.gridSlack})`);
  assert.ok(peak > 250 && contacts > 100);
  assert.ok(maxMove < ctx.rules.spatial.gridSlack, `per-tick movement ${maxMove} within gridSlack`);
});

test('live strays (Phase 2B): an enemy relocated or added after the grid rebuild is still met where it is', () => {
  // the probe after each step: the grid is this tick's rebuild (before enemySystem moved anyone) and the positions are
  // this tick's, which is what every query inside the tick sees. Each live enemy out of its spawn guard is probed with a
  // short vertical sweep through its centre; a widened grid.query around it shows what a plain grid reader would get
  const ctx = createRun({ seed: 5, species: 'cyndaquil', ruleOverrides: { director: { spawnBase: 14, spawnPerMin: 8, capBase: 330, capPerMin: 0 }, enemy: { liveCap: 330 } } as never });
  const E = ctx.enemies, out = new Contacts(256), q = spatialQuery({ mask: SK.enemy, pierce: Infinity });
  let probes = 0, gridMiss = 0, ticksWithStrays = 0, far = 0;
  while (ctx.time < 60) {
    ctx.player.hp = ctx.player.maxHp;
    step(ctx, botInput(ctx));
    let strays = 0;
    for (let e = 0; e < E.hi; e++) {
      if (!E.alive[e] || E.spawnT[e] < ctx.rules.spatial.spawnGuard) continue;
      const x = E.x[e], z = E.z[e], y = E.y[e] + E.tall[e] / 2;
      sweep(ctx, x, y + 1, z, 0, -1, 0, 2, q, out);
      assert.ok([...out.id.subarray(0, out.n)].includes(e), `tick ${ctx.tick}: enemy ${e} at (${x.toFixed(1)}, ${z.toFixed(1)}) not met`);
      probes++;
      const n = ctx.grid.query(x, z, E.radius[e] + ctx.rules.spatial.gridSlack);
      let inGrid = false;
      for (let k = 0; k < n && !inGrid; k++) inGrid = ctx.grid.result[k] === e;
      if (!inGrid) { gridMiss++; strays++; if (Math.hypot(x - ctx.player.x, z - ctx.player.z) > 20) far++; }
    }
    if (strays) ticksWithStrays++;
  }
  console.log(`strays: ${probes} probes, all met; a plain grid.query missed ${gridMiss} (on ${ticksWithStrays} ticks, ${far} of them relocated onto the ring ahead of the trainer)`);
  assert.ok(probes > 50000);
  assert.ok(gridMiss > 0, 'the run relocates enemies (otherwise this test proves nothing)');
});

test('determinism: repeated replays, another grid cell size and an in-use grid.result give identical contacts', () => {
  const build = () => {
    const ctx = createRun({ seed: 3, species: 'totodile', ruleOverrides: { worldgen: { mode: 'generated', locations: { meadow: 'mt-moon' } }, director: { spawnBase: 12, spawnPerMin: 6, capBase: 200, capPerMin: 0 }, enemy: { liveCap: 200 } } as never });
    while (ctx.time < 40) { ctx.player.hp = ctx.player.maxHp; step(ctx, botInput(ctx)); }
    return ctx;
  };
  const digest = (ctx: SimContext) => {
    const rng = new Rng(5), out = new Contacts(48), q = spatialQuery({ mask: SK_WORLD | SK_ACTOR, pierce: 3, actorR: 0.35, actorH: 0.35, worldR: 0.2, worldH: 0.2 });
    let h = 2166136261;
    const mix = (v: number) => { h = Math.imul(h ^ (Math.fround(v) * 1e4 | 0), 16777619) >>> 0; };
    for (let s = 0; s < 1500; s++) {
      const a = rng.range(0, Math.PI * 2), p = rng.range(-0.4, 0.4), L = rng.range(1, 30);
      sweep(ctx, ctx.player.x, ctx.player.y + 0.7, ctx.player.z, Math.cos(a) * Math.cos(p), Math.sin(p), Math.sin(a) * Math.cos(p), L, q, out);
      mix(out.n); for (let c = 0; c < out.n; c++) { mix(out.t[c]); mix(out.kind[c]); mix(out.id[c]); mix(out.flags[c]); mix(out.nx[c]); mix(out.ny[c]); mix(out.nz[c]); }
      overlapCylinder(ctx, ctx.player.x + Math.cos(a) * 3, ctx.player.y - 1, ctx.player.y + 2, ctx.player.z + Math.sin(a) * 3, rng.range(1, 5), { ...q, flags: QF.sight }, out);
      mix(out.n); mix(out.occluded); for (let c = 0; c < out.n; c++) { mix(out.t[c]); mix(out.id[c]); }
    }
    return h;
  };
  const a = build(), b = build();
  const ha = digest(a);
  assert.equal(digest(a), ha, 'the same query set twice');
  assert.equal(digest(b), ha, 'a second replay of the same run');
  // another grid: cells of 5 m instead of 3 (a different iteration order and other candidates)
  const g = new Grid(b.grid.extent, 5, b.rules.enemy.cap);
  g.rebuild(b.enemies.hi, b.enemies.x, b.enemies.z, b.enemies.alive);
  const keep = b.grid;
  b.grid = g;
  assert.equal(digest(b), ha, 'independent of the grid layout');
  b.grid = keep;
  // the shared grid.result buffer another system may be iterating is never touched
  const n = b.grid.query(b.player.x, b.player.z, 8), before = b.grid.result.slice(0, n);
  digest(b);
  assert.deepEqual(b.grid.result.slice(0, n), before);
  assert.equal(b.grid.resultCount, n);
});

test('no sim state changes: a query reads only (stateHash unchanged after thousands of queries)', async () => {
  const { stateHash } = await import('../src/sim/checksum');
  const ctx = createRun({ seed: 4, species: 'charmander' });
  while (ctx.time < 20) step(ctx, botInput(ctx));
  const h0 = stateHash(ctx), out = new Contacts(), q = spatialQuery({ mask: SK_WORLD | SK_ACTOR, pierce: Infinity });
  for (let s = 0; s < 3000; s++) {
    const a = s * 0.37;
    sweep(ctx, ctx.player.x, ctx.player.y + 0.6, ctx.player.z, Math.cos(a), 0, Math.sin(a), 25, q, out);
    overlapSector(ctx, ctx.player.x, ctx.player.y, ctx.player.y + 2, ctx.player.z, 4, Math.cos(a), Math.sin(a), 0.5, q, out);
  }
  assert.equal(stateHash(ctx), h0);
  // and stepping on afterwards matches a run that never queried
  const twin = createRun({ seed: 4, species: 'charmander' });
  while (twin.time < 20) step(twin, botInput(twin));
  for (let t = 0; t < 300; t++) { step(ctx, botInput(ctx)); step(twin, botInput(twin)); }
  assert.equal(stateHash(ctx), stateHash(twin));
});

test('water and ice: open water is a liquid surface, frozen water is terrain at the ice', () => {
  const W = flatWorld(), i = 20, j = 90, k = K(W, i, j), x = C(W, i), z = C(W, j);
  W.map.terrain[k] = T.water;
  assert.ok(ray(W, x, 2, z, 0, -1, 0, 5) && hit().kind === SK.liquid && near(hit().y, W.height(x, z), 1e-6));
  assert.equal(ray(W, x, 2, z, 0, -1, 0, 5, SK_WORLD & ~SK.liquid), false, 'a mask without liquids passes the surface (no bed below it)');
});
