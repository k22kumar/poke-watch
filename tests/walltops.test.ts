// R1b wall tops (docs/SIZING.md "Wall tops", ledger §23): a wall prop (tree, fence, boulder, building) is solid only up to
// its measured height (PROP_RULES top → World.wallTop) for every reader that opts in: the player's spatial attack traces
// (QF.tops through combatFlags), the chase lens, and a body given the crossing permission (`over`; no driver gives it
// before R6d). Bare walls and the map edge stay infinite; without the opt-in every wall is infinite, as before R1b.
//
// The scenes run on a private flat world copied from the authored meadow (as tests/aim3d.test.ts does), with props written
// the way the map builder writes them and the wall tops rebuilt from them (world/tiles.ts wallTopsOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { defaultRules, type Rules } from '../src/rules/defaults';
import { BIOMES } from '../src/rules/stages';
import { SPECIES } from '../src/rules/species';
import { bodyOf, partnerHeight } from '../src/rules/sizing';
import { World } from '../src/sim/world';
import { createRun, step } from '../src/sim/run';
import { spawnEnemy } from '../src/sim/enemies';
import { compileMove } from '../src/sim/moves';
import { MASK, QF, SK, segmentClear } from '../src/sim/spatial';
import { combatFlags } from '../src/sim/aim';
import { LOCO, selectIntegrator, stepBallistic, type LocoBody, type LocoNumbers, type LocoResult, type LocoTick } from '../src/sim/locomotion';
import { BTN, NO_INPUT, type InputFrame, type SimContext, type SimEvent } from '../src/sim/types';
import { PROP_RULES, wallTopsOf, type ArenaProp, type ArenaPropKind } from '../src/world/tiles';
import { arenaSprites } from '../src/render/tileart';
import { chaseFrameFor } from '../src/render/chaseinput';
import { chaseAim, type AimView } from '../src/render/camera';
import { aimRayOf } from '../src/render/hostframe';
import { TEXELS_PER_METRE } from '../src/assets/art';
import type { DeepPartial } from '../src/core/util';

// The painters build ImageData; Node has no such global (the browser does). A minimal stand-in: width, height, RGBA bytes.
class ImageDataShim {
  width: number; height: number; data: Uint8ClampedArray; colorSpace = 'srgb';
  constructor(a: number | Uint8ClampedArray, b: number, c?: number) {
    if (typeof a === 'number') { this.width = a; this.height = b; this.data = new Uint8ClampedArray(a * b * 4); }
    else { this.data = a; this.width = b; this.height = c ?? a.length / 4 / b; }
  }
}
(globalThis as { ImageData?: unknown }).ImageData ??= ImageDataShim;

type V3 = [number, number, number];
const EPS = 0.01;
const TOPS_OFF: DeepPartial<Rules> = { world: { wallTops: false } };
const OFF_RULES = { ...defaultRules, world: { ...defaultRules.world, wallTops: false } } as Rules;
/** every wall prop kind: the kinds R1b gives a top */
const WALL_KINDS = (Object.keys(PROP_RULES) as ArenaPropKind[]).filter((k) => PROP_RULES[k].wall);

/** an authored world whose map is a private flat grass plain at height 0 with no props (the base map is shared) */
function flatWorld(rules: Rules = defaultRules, los = true): World {
  const W = new World(rules, BIOMES.meadow, 5);
  const n = W.w * W.h, M = W.map;
  const map = { ...M, terrain: new Uint8Array(n), elev: new Float32Array(n), stairs: new Uint8Array(n), wall: new Uint8Array(n), platform: new Float32Array(n), over: new Float32Array(n), wlevel: undefined, props: [] as ArenaProp[] };
  Object.assign(W, { map, over: map.over, voids: new Uint8Array(n), los });
  return W;
}
const K = (W: World, i: number, j: number) => j * W.w + i;
const C = (W: World, i: number) => i - W.half + 0.5;
/** a wall prop of `kind` with its top-left tile at (i, j), its footprint as PROP_RULES says, as World.Builder.prop writes it */
function place(W: World, kind: ArenaPropKind, i: number, j: number) {
  const R = PROP_RULES[kind];
  (W.map.props as ArenaProp[]).push({ kind, x: i, y: j, w: R.w, h: R.h, variant: 0 });
  for (let b = j; b < j + R.h; b++) for (let a = i; a < i + R.w; a++) W.map.wall[K(W, a, b)] = 1;
}
/** raise the ground of a rectangle (a plateau the props can stand on) */
function raise(W: World, i0: number, j0: number, w: number, h: number, e: number) {
  for (let j = j0; j < j0 + h; j++) for (let i = i0; i < i0 + w; i++) W.map.elev[K(W, i, j)] = e;
}
/** after editing a private world's map: refresh its navigation through World.setBlock (the overlay's only writer: open
 *  tiles, standing heights, the movement fast path's cache) and rebuild its wall tops from the props, in place, before
 *  any query reads them */
function retop(W: World) {
  for (let k = 0; k < W.w * W.h; k++) W.setBlock(k, W.map.wall[k], W.map.platform[k]);
  if (W.wallTop) W.wallTop.set(wallTopsOf(W.map));
}

function speciesOf(cls: string): string {
  const sp = SPECIES.filter((s) => bodyOf(s, defaultRules.size).sizeClass === cls && !bodyOf(s, defaultRules.size).authored && !s.flying).map((s) => s.id).sort();
  assert.ok(sp.length, `a ${cls} species`);
  return sp[0];
}
/** the five size classes' muzzle heights over flat ground (rules.aim.muzzle.up × the class height: 0.36 … 1.44 m) */
const MUZZLES = defaultRules.size.classes.map((c) => ({ cls: c.id, y: defaultRules.aim.muzzle.up * c.height }));

// ------------------------------------------------------------------------------------------------ the height table (G10)

const BIOME_PALETTES = ['meadow', 'badlands', 'frost', 'dusk', 'forest', 'moon', 'chargestone', 'volcano'];
/** the sprite keys a prop kind is drawn with (render/tilestage.ts: a `tree` draws `tree` or `tree3` by its variant) */
const SPRITE_KEYS: Partial<Record<ArenaPropKind, string[]>> = { tree: ['tree', 'tree3'] };
/** a sprite's drawn height (m): its highest pixel the billboard shader keeps (alpha ≥ 0.5) above the card's foot, at the
 *  card's unstretched size (TEXELS_PER_METRE px per m) */
function drawnHeight(im: { width: number; height: number; data: Uint8ClampedArray }): number {
  for (let y = 0; y < im.height; y++) for (let x = 0; x < im.width; x++) if (im.data[(y * im.width + x) * 4 + 3] / 255 >= 0.5) return (im.height - y) / TEXELS_PER_METRE;
  return 0;
}

test('wall tops: every wall prop carries its tallest unstretched drawn height, rounded up to 0.05 m (painter drift gate)', () => {
  // the conventions the measurement copies from the renderer, checked in its source so a change there fails here
  const stage = readFileSync(new URL('../src/render/tilestage.ts', import.meta.url), 'utf8');
  assert.ok(stage.includes("if (p.kind === 'tree') key = ['tree', 'tree3', 'tree'][p.variant % 3];"), 'tree variants: tree, tree3');
  assert.ok(stage.includes('e.w / 16, e.h / 16'), 'a prop card is its sprite at 16 px per m');
  assert.ok(stage.includes('if (c.a < 0.5) discard;'), 'the billboard shader keeps alpha ≥ 0.5');
  assert.ok(stage.includes('const y = m.elev[(p.y + p.h - 1) * W + p.x];'), "a card stands on its bottom-left tile's elevation (wallTopsOf's footing)");
  assert.equal(TEXELS_PER_METRE, 16);
  const sets = BIOME_PALETTES.map((b) => arenaSprites(b));
  for (const kind of Object.keys(PROP_RULES) as ArenaPropKind[]) {
    const R = PROP_RULES[kind];
    if (!R.wall) { assert.equal(R.top, undefined, `${kind}: only wall props carry a top (low props have their platform)`); continue; }
    let max = 0;
    for (const S of sets) for (const key of SPRITE_KEYS[kind] ?? [kind]) {
      const im = S.get(key);
      assert.ok(im, `${kind}: sprite ${key} painted`);
      max = Math.max(max, drawnHeight(im as never));
    }
    const want = Math.ceil(max / 0.05 - 1e-9) * 0.05;
    assert.ok(R.top !== undefined && Math.abs(R.top - want) < 1e-9, `${kind}: table top ${R.top} m; the art is ${max} m, so ${want.toFixed(2)} m`);
    assert.ok(R.top! >= max - 1e-9, `${kind}: the top never sits under the drawn prop`);
  }
});

test('wall tops: wallTopsOf puts a prop\'s top on its footing, keeps a cliff tile\'s rock, and leaves bare walls infinite', () => {
  const W = flatWorld();
  // a 2 × 2 boulder over tiles (60..61, 40..41); its footing is its bottom-left tile (60, 41) at 0.5 m. Of the tiles
  // behind it, (60, 40) is raised to 2 m (still under footing + top) and (61, 40) is a cliff at 4 m (above it)
  raise(W, 60, 41, 1, 1, 0.5);
  raise(W, 60, 40, 1, 1, 2);
  place(W, 'boulder', 60, 40);
  W.map.elev[K(W, 61, 40)] = 4;
  W.map.wall[K(W, 70, 70)] = 1; // a bare wall (rock: no prop)
  const T = wallTopsOf(W.map), top = PROP_RULES.boulder.top!;
  assert.equal(T[K(W, 60, 41)], 0.5 + top, 'the footing tile: footing + top');
  assert.equal(T[K(W, 61, 41)], 0.5 + top, 'every footprint tile shares the footing (the card is one sprite)');
  assert.equal(T[K(W, 60, 40)], 0.5 + top, 'a tile raised to 2 m, still under footing + top (2.10 m): the prop top');
  assert.equal(T[K(W, 61, 40)], 4, 'the cliff tile: its ground (4 m), not the lower prop top');
  assert.equal(T[K(W, 70, 70)], Infinity, 'a bare wall: infinite');
  assert.equal(T[K(W, 10, 10)], Infinity, 'open ground: infinite (never read off a wall)');
  assert.equal(flatWorld(OFF_RULES).wallTop, null, 'flag off: no wall tops at all');
});

// ------------------------------------------------------------------------------------------------ one height, every reader (G4)

/** a run whose world is a flat plain with one of every wall kind, half on the ground and half on a 2 m plateau */
function gallery(rules?: DeepPartial<Rules>) {
  const ctx = createRun({ seed: 1, species: 'cyndaquil', ruleOverrides: rules });
  const W = flatWorld(ctx.rules);
  const sites: { kind: ArenaPropKind; i: number; j: number; base: number }[] = [];
  WALL_KINDS.forEach((kind, n) => {
    const i = 8 + (n % 8) * 12, j = 8 + Math.floor(n / 8) * 14, base = n % 2 ? 2 : 0;
    if (base) raise(W, i - 3, j - 3, PROP_RULES[kind].w + 6, PROP_RULES[kind].h + 6, base);
    place(W, kind, i, j);
    sites.push({ kind, i, j, base });
  });
  retop(W);
  ctx.world = W;
  ctx.enemies.clear(); ctx.bodies.clear(); ctx.projectiles.clear(); ctx.zones.clear();
  const lens = chaseFrameFor(ctx, { x: 0, y: 0, z: 0, height: 1, width: 1, dt: 1 / 60, lookPitch: 0, shake: 0 } as never).solid!;
  return { ctx, W, sites, lens };
}

test('wall tops (T37): body, shot and lens agree on every wall kind\'s top, on the ground and on a plateau', () => {
  const { W, sites, lens } = gallery();
  for (const { kind, i, j, base } of sites) {
    const R = PROP_RULES[kind], top = base + R.top!, x = C(W, i), z = C(W, j + R.h - 1), zr = z;
    assert.equal(W.wallTopAt(x, z), top, `${kind}: World.wallTopAt`);
    // a level line across the whole footprint, from a metre west to a metre east of it
    const xa = C(W, i) - 1.5, xb = C(W, i + R.w - 1) + 1.5;
    for (const [dy, solid] of [[-EPS, true], [0, false], [EPS, false]] as const) {
      const y = top + dy, what = `${kind} at ${dy >= 0 ? '+' : ''}${dy} m of its top (${top.toFixed(2)} m)`;
      assert.equal(W.collides(x, z, y, 0, undefined, true), solid, `body with the permission, ${what}`);
      assert.equal(!segmentClear(W, xa, y, zr, xb, y, zr, MASK.los, QF.tops), solid, `shot, ${what}`);
      assert.equal(lens(x, y, z), solid, `lens, ${what}`);
      // without the opt-in every reader keeps the wall infinite
      assert.equal(W.collides(x, z, y, 0), true, `body without the permission, ${what}`);
      assert.equal(segmentClear(W, xa, y, zr, xb, y, zr, MASK.los, 0), false, `shot without QF.tops, ${what}`);
    }
    assert.equal(W.collides(x, z, top + 50, 0), true, `${kind}: no permission, solid 50 m above the top`);
    assert.equal(segmentClear(W, xa, top + 50, zr, xb, top + 50, zr, MASK.los, 0), false, `${kind}: no QF.tops, solid 50 m up`);
  }
});

test('wall tops (G4): a level line at each size class\'s muzzle height clears exactly the props lower than it', () => {
  const { W, sites } = gallery();
  for (const { kind, i, j, base } of sites) {
    const R = PROP_RULES[kind], z = C(W, j + R.h - 1), xa = C(W, i) - 1.5, xb = C(W, i + R.w - 1) + 1.5;
    for (const m of MUZZLES) {
      const y = base + m.y;
      assert.equal(segmentClear(W, xa, y, z, xb, y, z, MASK.los, QF.tops), m.y >= R.top!, `${m.cls} muzzle ${m.y.toFixed(2)} m vs ${kind} ${R.top} m`);
    }
  }
  // the cover table this produces (docs/SIZING.md "Wall tops"): which level shots cross the low lane barriers
  const fires = (kind: ArenaPropKind) => MUZZLES.filter((m) => m.y >= PROP_RULES[kind].top!).map((m) => m.cls);
  assert.deepEqual(fires('fence'), ['large', 'xl']);
  assert.deepEqual(fires('hedge'), ['large', 'xl']);
  assert.deepEqual(fires('sign'), ['xl']);
  assert.deepEqual(fires('thicket'), ['xl']);
  assert.deepEqual(fires('crystal'), ['xl']);
  assert.deepEqual(fires('boulder'), [], 'no class fires level over a boulder (Extra Large 1.44 < 1.60)');
});

test('wall tops: with the flag off every reader keeps every wall infinite (the older layers)', () => {
  const { W, sites, lens } = gallery(TOPS_OFF);
  assert.equal(W.wallTop, null);
  for (const { kind, i, j, base } of sites) {
    const R = PROP_RULES[kind], x = C(W, i), z = C(W, j + R.h - 1), y = base + R.top! + 0.5;
    assert.equal(W.collides(x, z, y, 0, undefined, true), true, `${kind}: body, even with the permission`);
    assert.equal(segmentClear(W, x - 2, y, z, x + 2 + R.w, y, z, MASK.los, QF.tops), false, `${kind}: shot, even with QF.tops`);
    assert.equal(lens(x, base + 2.39, z), true, `${kind}: the lens keeps today's 2.4 m margin`);
    assert.equal(lens(x, base + 2.41, z), false);
  }
});

// ------------------------------------------------------------------------------------------------ bodies (G5 – G8)

const NUM: LocoNumbers = { gravity: 30, jumpVelocity: 10.5, glideFallSpeed: 2, stepHeight: 0.6, groundAccel: 14, airAccel: 6, knockDecay: 7, jumpBuffer: 0.12, coyote: 0.1 };
const tick = (over?: boolean, foot = 0.42): LocoTick => ({ speed: 6, stance: 1, footSpeed: 1, grip: 1, canJump: true, lift: false, airPress: 'none', stepUp: 0.6, foot, tall: undefined, wide: false, ...(over === undefined ? {} : { over }) });
const body = (x: number, y: number, z: number): LocoBody => ({ x, y, z, vx: 0, vy: 0, vz: 0, kx: 0, kz: 0, grounded: false, ctl: { buffer: 0, coyote: 0, airSpent: false } });
const RES: LocoResult = { jumped: false };

/** a fence line across row 50 (x 40..60) and a 2 × 2 tree at (49..50, 60..61) on a flat world */
function lane(los = true, rules: Rules = defaultRules) {
  const W = flatWorld(rules, los);
  for (let i = 40; i <= 60; i++) place(W, 'fence', i, 50);
  place(W, 'tree', 49, 60);
  retop(W);
  return { W, fenceZ: 50 - W.half, treeZ: 60 - W.half, treeX: C(W, 49) + 0.5 };
}

test('wall tops (G5): bodies without the permission meet wall props at any height, as before R1b', () => {
  const { W, fenceZ } = lane();
  const x = C(W, 50), out: [number, number] = [0, 0];
  for (const feet of [0, 0.95, 1.84, 3, 50]) {
    assert.equal(W.collides(x, fenceZ + 0.5, feet, 0.6), true, `collides, feet ${feet} m over a 0.9 m fence`);
    assert.equal(W.blocks(x, fenceZ + 0.5, feet, 0.6), true, `blocks (steering, the bot's probe), feet ${feet} m`);
  }
  // a footprint walking north at feet 1.0 m (above the fence's 0.9 m) stops at it without the permission, crosses with it
  for (const over of [false, true]) {
    let z = fenceZ - 2;
    for (let s = 0; s < 30; s++) { W.moveBody(x, z, 0, 0.2, 1.0, 0.6, 0.42, out, undefined, undefined, over); z = out[1]; }
    if (over) assert.ok(z > fenceZ + 1.5, `with the permission the footprint passes over the fence (z ${(z - fenceZ).toFixed(2)} past it)`);
    else assert.ok(z + 0.42 <= fenceZ + 1e-3, `without it the footprint stops at the fence (${(z + 0.42 - fenceZ).toFixed(3)} m)`);
  }
});

test('wall tops (G5): a jumping player, a gliding one off a ledge and one on a tier beside a lower tree never pass a wall prop', () => {
  // the real sim (step()): input toward the prop with Jump held, so each run jumps (apex 1.84 m) or glides
  // tier: a 2-row plateau `gap` rows short of the prop (gap 0: the prop stands against the tier's edge)
  const cases: { what: string; species: string; tier: number; gap: number; target: 'fence' | 'tree' }[] = [
    { what: 'a jump at a 0.90 m fence (apex 1.84 m)', species: 'cyndaquil', tier: 0, gap: 0, target: 'fence' },
    { what: 'a glide off a 6 m ledge toward a 2.75 m tree 2 m beyond it', species: 'charizard', tier: 6, gap: 2, target: 'tree' },
    { what: 'a walk on a 4 m tier into a 2.75 m tree against its edge', species: 'cyndaquil', tier: 4, gap: 0, target: 'tree' },
  ];
  for (const c of cases) {
    const ctx = createRun({ seed: 1, species: c.species });
    ctx.rules.director.spawnBase = -99;
    const { W, fenceZ, treeZ } = lane(true, ctx.rules);
    const zWall = c.target === 'fence' ? fenceZ : treeZ;
    const row = zWall + W.half;
    if (c.tier) raise(W, 40, row - c.gap - 2, 21, 2, c.tier);
    ctx.world = W;
    ctx.enemies.clear(); ctx.bodies.clear(); ctx.projectiles.clear(); ctx.zones.clear();
    const P = ctx.player;
    P.x = P.px = C(W, 49) + 0.5; P.z = P.pz = c.tier ? row - c.gap - 2 - W.half + 0.5 : zWall - 2.5; P.y = P.py = c.tier; P.vy = 0; P.grounded = true;
    let maxZ = -Infinity, maxY = 0;
    for (let k = 0; k < 240; k++) {
      step(ctx, { ...NO_INPUT, mz: 1, jump: c.tier === 0 || c.species === 'charizard' });
      maxZ = Math.max(maxZ, P.z); maxY = Math.max(maxY, P.y);
      assert.ok(!(W.map.wall[W.tile(P.x, P.z)] === 1), `${c.what}: the body's centre never stands in the prop (tick ${k}, y ${P.y.toFixed(2)})`);
    }
    assert.ok(maxZ < zWall, `${c.what}: never past the prop's face (max z ${(maxZ - zWall).toFixed(2)} m from it)`);
    if (c.target === 'fence') assert.ok(maxY > PROP_RULES.fence.top! + 0.5, `the jump rose well over the fence top (${maxY.toFixed(2)} m)`);
  }
});

test('wall tops (G6): a permitted body crosses above a top, stops below it, and a descent onto it is a stop, not a landing', () => {
  const { W, treeZ } = lane(false);
  const top = W.wallTopAt(C(W, 49), treeZ + 0.5), x = C(W, 49) + 0.5;
  assert.equal(top, PROP_RULES.tree.top);
  const hover: LocoNumbers = { ...NUM, gravity: 0 };
  // horizontal: at 3.0 m (over 2.75 m) the footprint crosses the tree; at 2.0 m it stops at the trunk; without it, both stop
  for (const [feet, over, crosses] of [[3, true, true], [2, true, false], [3, false, false]] as const) {
    const b = body(x, feet, treeZ - 2);
    for (let k = 0; k < 120; k++) { b.vz = 4; b.vy = 0; stepBallistic(W, b, { mx: 0, mz: 1, jump: false }, tick(over), hover, 1 / 60, RES); }
    if (crosses) assert.ok(b.z > treeZ + 2.5, `feet ${feet}, permitted: passes over the tree (z ${(b.z - treeZ).toFixed(2)})`);
    else assert.ok(b.z + 0.42 <= treeZ + 1e-3, `feet ${feet}, ${over ? 'permitted' : 'not permitted'}: stopped at the trunk (${(b.z + 0.42 - treeZ).toFixed(3)})`);
    assert.equal(b.y, feet, 'no vertical change from the planar move');
  }
  // vertical: falling from 4 m onto the canopy
  const b = body(x, 4, treeZ + 1), z0 = b.z;
  for (let k = 0; k < 90; k++) stepBallistic(W, b, { mx: 0, mz: 0, jump: true }, tick(true), NUM, 1 / 60, RES);
  assert.ok(Math.abs(b.y - top) < 1e-9, `the descent stops at the top (y ${b.y})`);
  assert.equal(b.vy, 0, 'downward speed spent');
  assert.equal(b.grounded, false, 'not grounded: a top is not a support (no landing)');
  assert.equal(selectIntegrator(false, b.grounded), LOCO.ballistic, 'it keeps its integrator');
  assert.equal(b.x, x); assert.equal(b.z, z0, 'no relocation');
  assert.equal(RES.jumped, false, 'held Jump never jumps off a top (it is not ground)');
  assert.equal(W.support(b.x, b.z, b.y), 0, 'World.support under it is still the ground');
  assert.equal(W.height(b.x, b.z, b.y), 0, 'World.height never reports a wall top');
  // without the permission the same fall goes into the trunk to the ground (a non-location map has no rock recovery)
  const c = body(x, 4, treeZ + 1);
  for (let k = 0; k < 90; k++) stepBallistic(W, c, { mx: 0, mz: 0, jump: false }, tick(), NUM, 1 / 60, RES);
  assert.equal(c.y, 0, 'without the permission the vertical move never meets a wall, as before R1b');
});

test('wall tops (G7): the rock recovery leaves a permitted body above a top alone and snaps everything else as before', () => {
  const { W, treeZ } = lane(true);
  const x = C(W, 49) + 0.5, z = treeZ + 1, hover: LocoNumbers = { ...NUM, gravity: 0 };
  // hovering 1 m over the canopy (3.75 m): permitted, it stays; without the permission it is pulled out at any height
  for (const over of [true, false, undefined]) {
    const b = body(x, PROP_RULES.tree.top! + 1, z);
    stepBallistic(W, b, { mx: 0, mz: 0, jump: false }, tick(over), hover, 1 / 60, RES);
    if (over) { assert.equal(b.x, x); assert.equal(b.z, z); assert.equal(b.grounded, false); assert.ok(b.y > PROP_RULES.tree.top!); }
    else {
      assert.ok(b.x !== x || b.z !== z, `without the permission (${over}) the body over the tree is moved to footing`);
      assert.equal(W.map.wall[W.tile(b.x, b.z)], 0); assert.equal(b.grounded, true); assert.equal(b.y, 0);
    }
  }
  // below the top a permitted body is in the rock too, and is recovered exactly like any other
  const a = body(x, 1, z), d = body(x, 1, z);
  stepBallistic(W, a, { mx: 0, mz: 0, jump: false }, tick(true), hover, 1 / 60, RES);
  stepBallistic(W, d, { mx: 0, mz: 0, jump: false }, tick(), hover, 1 / 60, RES);
  assert.deepEqual([a.x, a.y, a.z, a.grounded], [d.x, d.y, d.z, d.grounded], 'inside the trunk: the same recovery with or without the permission');
  assert.equal(W.inRock(x, z, 1, true), true);
  assert.equal(W.inRock(x, z, 3, true), false);
  assert.equal(W.inRock(x, z, 99, false), true);
});

test('wall tops (G8): bare walls and the map edge stay infinite for bodies, shots and (with its margin) the lens', () => {
  const { W, sites, lens } = gallery();
  void sites;
  const i = 100, j = 100, x = C(W, i), z = C(W, j);
  W.map.wall[K(W, i, j)] = 1; // rock: a wall with no prop
  assert.equal(W.wallTopAt(x, z), Infinity);
  assert.equal(W.collides(x, z, 100, 0, undefined, true), true, 'body with the permission, 100 m up');
  assert.equal(segmentClear(W, x - 2, 60, z, x + 2, 60, z, MASK.los, QF.tops), false, 'shot with QF.tops, 60 m up');
  assert.equal(lens(x, 2.39, z), true, 'lens: the bare-wall margin (ground + 2.4 m) is unchanged');
  assert.equal(lens(x, 2.41, z), false);
  // off the map: solid for bodies at any height and a bounds column for shots
  assert.equal(W.collides(W.half + 3, 0, 100, 0, undefined, true), true);
  assert.equal(segmentClear(W, W.half - 2, 80, 0, W.half + 2, 80, 0, MASK.los, QF.tops), false);
  // on the shipped maps every wall tile without a wall prop over it is infinite: rock masses, cave walls, the habitat low walls
  const maps: [string, DeepPartial<Rules>][] = [
    ['authored meadow', {}],
    ['Mt. Moon', { worldgen: { mode: 'generated', regionSeed: 3, locations: { meadow: 'mt-moon', dusk: 'mt-moon', badlands: 'mt-moon', frost: 'mt-moon' } } }],
    ['Memorial Ridge', { worldgen: { mode: 'generated', regionSeed: 3, locations: { meadow: 'forest-cemetery', dusk: 'forest-cemetery', badlands: 'forest-cemetery', frost: 'forest-cemetery' } } }],
  ];
  for (const [name, rules] of maps) {
    const ctx = createRun({ seed: 1, species: 'cyndaquil', ruleOverrides: rules });
    const M = ctx.world.map, T = ctx.world.wallTop!, covered = new Uint8Array(M.w * M.h);
    for (const p of M.props) if (PROP_RULES[p.kind].wall) for (let b = p.y; b < p.y + p.h; b++) for (let a = p.x; a < p.x + p.w; a++) if (a >= 0 && b >= 0 && a < M.w && b < M.h) covered[b * M.w + a] = 1;
    let bare = 0, finite = 0;
    for (let k = 0; k < M.w * M.h; k++) {
      if (!M.wall[k]) continue;
      if (covered[k]) { finite++; assert.ok(T[k] < Infinity, `${name}: a wall-prop tile has a finite top`); }
      else { bare++; assert.equal(T[k], Infinity, `${name}: bare wall tile ${k} stays infinite`); }
    }
    assert.ok(bare > 0 && finite > 0, `${name}: ${bare} bare and ${finite} wall-prop tiles`);
  }
});

test('wall tops (G9): a prop that burns or breaks takes its top with it (World.setBlock)', () => {
  const { W, treeZ } = lane(false);
  const k = K(W, 49, 61), x = C(W, 49), z = treeZ + 1.5;
  assert.ok(W.wallTop![k] < Infinity);
  assert.equal(segmentClear(W, x - 2, 2, z, x + 2, 2, z, MASK.los, QF.tops), false, 'the intact trunk stops a line at 2 m');
  W.setBlock(k, 0, 0.65); // burnt: a stump on the footing tile
  assert.equal(W.wallTop![k], Infinity, 'no wall, no wall top');
  assert.equal(W.wallTopAt(x, z), -Infinity, 'wallTopAt: no wall there now');
  // the burnt tile is open above the stump; its neighbour (still a trunk) is not, so test this tile alone
  assert.equal(segmentClear(W, x, 0.7, z - 0.4, x, 0.7, z + 0.4, MASK.los, QF.tops), true, 'a line over the 0.65 m stump passes');
  assert.equal(segmentClear(W, x, 0.6, z - 0.4, x, 0.6, z + 0.4, MASK.los, QF.tops), false, 'one through it does not');
  W.setBlock(k, 0, 0); // and gone
  assert.equal(segmentClear(W, x, 0.1, z - 0.4, x, 0.1, z + 0.4, MASK.los, QF.tops), true);
  assert.ok(W.wallTop![K(W, 50, 61)] < Infinity, 'the rest of the tree keeps its top');
});

// ------------------------------------------------------------------------------------------------ shots and beams (G11)

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm = (a: V3): V3 => { const L = Math.hypot(a[0], a[1], a[2]); return [a[0] / L, a[1] / L, a[2] / L]; };
type CastEv = Extract<SimEvent, { t: 'cast' }>;
type EndEv = Extract<SimEvent, { t: 'shotEnd' }>;
type BeamEv = Extract<SimEvent, { t: 'beam' }>;

/** a run on the lane world as `species` at x of the tree column, `dz` m south of the fence (or of the boulder), one move */
function range(opts: { species: string; move: string; cover: 'fence' | 'boulder' | 'tree'; rules?: DeepPartial<Rules> }) {
  const ctx = createRun({ seed: 1, species: opts.species, ruleOverrides: { feel: { windup: { beam: 0 } }, ...(opts.rules ?? {}) } as never });
  ctx.rules.director.spawnBase = -99;
  const W = flatWorld(ctx.rules);
  const i = 50, j = 50;
  if (opts.cover === 'fence') for (let a = 40; a <= 60; a++) place(W, 'fence', a, j);
  else place(W, opts.cover, i, j); // 2 × 2 at (50..51, 50..51)
  retop(W);
  ctx.world = W;
  ctx.enemies.clear(); ctx.bodies.clear(); ctx.projectiles.clear(); ctx.zones.clear();
  const P = ctx.player;
  P.x = P.px = i - W.half + (opts.cover === 'fence' ? 0.5 : 1); P.z = P.pz = j - W.half - 4; P.y = P.py = 0; P.facing = 0;
  P.moves.length = 0;
  P.moves.push({ key: opts.move, level: 1, cd: 0, spec: compileMove(ctx.rules, opts.move) });
  ctx.grid.rebuild(ctx.enemies.hi, ctx.enemies.x, ctx.enemies.z, ctx.enemies.alive);
  const coverZ = j - W.half, top = opts.cover === 'fence' ? PROP_RULES.fence.top! : PROP_RULES[opts.cover].top!;
  return { ctx, W, coverZ, top };
}
function target(ctx: SimContext, x: number, z: number, hover: number): number {
  const E = ctx.enemies, sp = SPECIES.filter((s) => bodyOf(s, defaultRules.size).sizeClass === 'small' && !s.flying).map((s) => s.id).sort()[0];
  const e = spawnEnemy(ctx, sp, x, z);
  E.x[e] = E.px[e] = x; E.z[e] = E.pz[e] = z; E.y[e] = E.py[e] = hover; E.hover[e] = hover;
  E.spawnT[e] = 1; E.hp[e] = E.maxHp[e] = 1e6; E.speed[e] = 0; E.dmg[e] = 0;
  ctx.grid.rebuild(E.hi, E.x, E.z, E.alive);
  return e;
}
/** fire once through a chase-style lens 4.5 m behind and 1.7 m above the partner, at the target's centre */
function fireAt(ctx: SimContext, at: V3, ticks = 60): SimEvent[] {
  const P = ctx.player, f = norm([at[0] - P.x, 0, at[2] - P.z]);
  const eye: V3 = [P.x - f[0] * 4.5, P.y + 1.7, P.z - f[2] * 4.5], dir = norm(sub(at, eye));
  const view: AimView = { eye, yaw: Math.atan2(dir[0], dir[2]), viewPitch: Math.asin(-dir[1]), fov: 1 };
  const ev: SimEvent[] = [];
  for (let k = 0; k < ticks; k++) {
    const [ax, az] = chaseAim(view, P.x, P.z, 16 / 9, (x, z) => ctx.world.height(x, z));
    const inp: InputFrame = { ...NO_INPUT, btn: k === 0 ? BTN.basic : 0, aimX: ax, aimZ: az, aim: aimRayOf({ eye, dir }), aimDev: 'mouse' };
    ev.push(...step(ctx, inp));
  }
  return ev;
}
/** the height of the cast's straight line (muzzle → aim point) where it reaches the cover's near face */
function lineAt(c: CastEv, z: number): number {
  const [o, t] = [c.o!.o, c.o!.t];
  return o[1] + ((t[1] - o[1]) * (z - o[2])) / (t[2] - o[2]);
}

test('wall tops (G11): a shot clears low cover only where its own line clears the top (real flight, both ways)', () => {
  const cases: { what: string; species: string; cover: 'fence' | 'boulder' | 'tree'; hover: number; rules?: DeepPartial<Rules>; clears: boolean }[] = [
    { what: 'Extra Large, level, over a 0.90 m fence', species: speciesOf('xl'), cover: 'fence', hover: 0, clears: true },
    { what: 'Small, level, into a 0.90 m fence', species: speciesOf('small'), cover: 'fence', hover: 0, clears: false },
    { what: 'Extra Large, level, into a 1.60 m boulder', species: speciesOf('xl'), cover: 'boulder', hover: 0, clears: false },
    { what: 'Extra Large, up at a flier 3 m over the far side of a boulder', species: speciesOf('xl'), cover: 'boulder', hover: 3, clears: true },
    { what: 'Small, up at a flier 4 m over the far side of a boulder', species: speciesOf('small'), cover: 'boulder', hover: 4, clears: true },
    { what: 'Medium, at a flier 1.5 m up behind a 2.75 m tree (through the trunk)', species: speciesOf('medium'), cover: 'tree', hover: 1.5, clears: false },
    { what: 'Medium, at a flier 6 m up behind a 2.75 m tree (over the canopy)', species: speciesOf('medium'), cover: 'tree', hover: 6, clears: true },
    { what: 'flag off: Extra Large, level, at the fence', species: speciesOf('xl'), cover: 'fence', hover: 0, rules: TOPS_OFF, clears: false },
  ];
  for (const c of cases) {
    const { ctx, W, coverZ, top } = range({ species: c.species, move: 'ember', cover: c.cover, rules: c.rules });
    const e = target(ctx, ctx.player.x, coverZ + (c.cover === 'fence' ? 8 : 6), c.hover);
    const at: V3 = [ctx.enemies.x[e], ctx.enemies.y[e] + ctx.enemies.tall[e] / 2, ctx.enemies.z[e]];
    const ev = fireAt(ctx, at);
    const cast = ev.find((v): v is CastEv => v.t === 'cast');
    assert.ok(cast && cast.o, `${c.what}: a spatial cast`);
    const y = lineAt(cast!, coverZ), hits = ev.filter((v) => v.t === 'hit' && v.enemy === e).length;
    const muzzle = cast!.o!.o[1];
    if (c.rules === undefined) assert.equal(y > top, c.clears, `${c.what}: the line is at ${y.toFixed(2)} m at the cover's face (top ${top} m, muzzle ${muzzle.toFixed(2)} m)`);
    assert.equal(hits > 0, c.clears, `${c.what}: ${hits} hits (line ${y.toFixed(2)} m vs top ${top} m)`);
    if (!c.clears) {
      const end = ev.find((v): v is EndEv => v.t === 'shotEnd');
      assert.ok(end && end.why === 'world', `${c.what}: the shot ends on the cover`);
      assert.ok(Math.abs(end!.z - coverZ) < 0.6, `${c.what}: at the cover's face (z ${(end!.z - coverZ).toFixed(2)})`);
      // with tops the cover stopped it below its top; with the flag off the infinite wall stopped it above the top
      if (c.rules === undefined) assert.ok(end!.y < top + 1e-6, `${c.what}: below the top (y ${end!.y.toFixed(2)})`);
      else assert.ok(end!.y > top, `${c.what}: the infinite wall stopped a shot ${(end!.y - top).toFixed(2)} m over the top`);
    }
    void W;
  }
});

test('wall tops (G11): a beam passes over a fence it clears and stops on the first contact it does not', () => {
  for (const [cls, clears] of [['xl', true], ['small', false]] as const) {
    const { ctx, coverZ, top } = range({ species: speciesOf(cls), move: 'ice_beam', cover: 'fence' });
    const e = target(ctx, ctx.player.x, coverZ + 8, 0);
    const at: V3 = [ctx.enemies.x[e], ctx.enemies.y[e] + ctx.enemies.tall[e] / 2, ctx.enemies.z[e]];
    const ev = fireAt(ctx, at, 30);
    const beam = ev.find((v): v is BeamEv => v.t === 'beam');
    assert.ok(beam, `${cls}: a beam`);
    const cast = ev.find((v): v is CastEv => v.t === 'cast')!;
    const y = lineAt(cast, coverZ), hits = ev.filter((v) => v.t === 'hit' && v.enemy === e).length;
    assert.equal(y > top, clears, `${cls}: the beam's line at the fence is ${y.toFixed(2)} m (top ${top})`);
    assert.equal(hits > 0, clears, `${cls}: ${hits} hits`);
    if (!clears) assert.ok(Math.abs(beam!.z2 - coverZ) < 0.6, `${cls}: the beam ends at the fence (z ${(beam!.z2 - coverZ).toFixed(2)})`);
  }
});

test('wall tops: combatFlags opts every player attack trace in with the flag, and out without it', () => {
  const on = createRun({ seed: 1, species: 'cyndaquil' }), off = createRun({ seed: 1, species: 'cyndaquil', ruleOverrides: TOPS_OFF });
  assert.equal(combatFlags(on) & QF.tops, QF.tops);
  assert.equal(combatFlags(off) & QF.tops, 0);
  assert.equal(combatFlags(on) & QF.foliage, QF.foliage, 'the foliage policy is unchanged');
  void SK; void partnerHeight;
});
