// Phase 2C: spatial beams (docs/THIRD_PERSON_IMPLEMENTATION.md §14). A beam cast through the chase crosshair leaves the
// partner's size-class muzzle along the resolved aim (sim/aim.ts), its core stops on the first world solid
// (sim/spatial.ts raycastWorld), its width meets bodies in contact order only where the core can see them, and the beam
// event the renderer draws runs from that muzzle to where the core stopped (sim/moves.ts beam3D).
//
// Scenes run the real sim (step(): moves, enemies) on a private flat world copied from the authored meadow (as
// tests/aim3d.test.ts does), nothing spawning, the targets standing still with hp to spare. "Phase 2B" is the same input
// with rules.aim.archetypes back to ['bolt', 'orb'] and foliage as cover: the planar beam every older build casts, kept for
// the bot, the fixed views and every checksum set. Each defect case runs both and asserts the planar defect and the fix.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultRules, type Rules } from '../src/rules/defaults';
import { BIOMES } from '../src/rules/stages';
import { SPECIES } from '../src/rules/species';
import { bodyOf } from '../src/rules/sizing';
import { World, DECK_SLAB } from '../src/sim/world';
import { createRun, step } from '../src/sim/run';
import { spawnEnemy } from '../src/sim/enemies';
import { spawnBody, tpl } from '../src/sim/bodies';
import { compileMove, movesSystem, slotSpec } from '../src/sim/moves';
import { stateHash } from '../src/sim/checksum';
import { setTransform } from '../src/sim/build';
import { MASK, QF, SK, SK_WORLD, segmentClear, solidAt } from '../src/sim/spatial';
import { PROP_MATERIALS, MATERIALS } from '../src/rules/surfaces';
import { BTN, NO_INPUT, type InputFrame, type SimContext, type SimEvent } from '../src/sim/types';
import { chaseAim, type AimView } from '../src/render/camera';
import { aimRayOf } from '../src/render/hostframe';
import type { ArenaProp, ArenaPropKind } from '../src/world/tiles';
import type { DeepPartial } from '../src/core/util';

type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V3): V3 => { const L = len(a); return [a[0] / L, a[1] / L, a[2] / L]; };

/** Phase 2B: beams planar (not on the spatial path), foliage cover */
const PHASE2B: DeepPartial<Rules> = { aim: { archetypes: ['bolt', 'orb'], foliageCover: true, deviceAssist: false } };
/** the beam fires on the press tick (no wind-up): the relocation case calls movesSystem directly */
const NOWIND: DeepPartial<Rules> = { feel: { windup: { beam: 0 } } };

function flatWorld(): World {
  const W = new World(defaultRules, BIOMES.meadow, 5);
  const n = W.w * W.h, M = W.map;
  const map = { ...M, terrain: new Uint8Array(n), elev: new Float32Array(n), stairs: new Uint8Array(n), wall: new Uint8Array(n), platform: new Float32Array(n), over: new Float32Array(n), wlevel: undefined, props: [] as ArenaProp[] };
  Object.assign(W, { map, over: map.over, voids: new Uint8Array(n), los: true });
  return W;
}
const K = (W: World, i: number, j: number) => j * W.w + i;
const C = (W: World, i: number) => i - W.half + 0.5;

function speciesOf(cls: string): string {
  const sp = SPECIES.filter((s) => bodyOf(s, defaultRules.size).sizeClass === cls && !bodyOf(s, defaultRules.size).authored && !s.flying).map((s) => s.id).sort();
  assert.ok(sp.length, `a ${cls} species`);
  return sp[0];
}

interface Scene { ctx: SimContext; W: World; P: V3 }
/** the partner at the centre of tile (50, 50) facing +z, its only move an Ice Beam (range 15, half-width 0.9, pierce all) */
function scene(opts: { species?: string; rules?: DeepPartial<Rules>; move?: string; edit?: (W: World) => void } = {}): Scene {
  const ctx = createRun({ seed: 1, species: opts.species ?? 'cyndaquil', ruleOverrides: opts.rules });
  ctx.rules.director.spawnBase = -99;
  const W = flatWorld();
  opts.edit?.(W);
  ctx.world = W;
  ctx.enemies.clear(); ctx.bodies.clear(); ctx.projectiles.clear(); ctx.zones.clear();
  const p = ctx.player;
  p.x = p.px = C(W, 50); p.z = p.pz = C(W, 50); p.y = p.py = 0; p.facing = 0;
  const key = opts.move ?? 'ice_beam';
  p.moves.length = 0;
  p.moves.push({ key, level: 1, cd: 0, spec: compileMove(ctx.rules, key) });
  ctx.grid.rebuild(ctx.enemies.hi, ctx.enemies.x, ctx.enemies.z, ctx.enemies.alive);
  return { ctx, W, P: [p.x, p.y, p.z] };
}

/** a wall or low prop of `kind` on tile (i, j), as the map builders write one (footprint 1 × 1) */
function prop(W: World, kind: ArenaPropKind, i: number, j: number, platform = 0) {
  (W.map.props as ArenaProp[]).push({ kind, x: i, y: j, w: 1, h: 1, variant: 0 });
  if (platform > 0) W.map.platform[K(W, i, j)] = platform; else W.map.wall[K(W, i, j)] = 1;
}

function put(ctx: SimContext, x: number, y: number, z: number, cls = 'medium', hover = 0): number {
  const E = ctx.enemies, e = spawnEnemy(ctx, speciesOf(cls), x, z);
  E.x[e] = E.px[e] = x; E.z[e] = E.pz[e] = z; E.y[e] = E.py[e] = y + hover; E.hover[e] = hover;
  E.spawnT[e] = 1; E.hp[e] = E.maxHp[e] = 1e6; E.speed[e] = 0; E.dmg[e] = 0;
  ctx.grid.rebuild(E.hi, E.x, E.z, E.alive);
  return e;
}
const centre = (ctx: SimContext, e: number): V3 => [ctx.enemies.x[e], ctx.enemies.y[e] + ctx.enemies.tall[e] / 2, ctx.enemies.z[e]];

/** a chase lens `back` m behind the partner on the line to `at`, `up` m above its feet, `side` m on a shoulder */
function lens(P: V3, at: V3, side = 0, back = 4.5, up = 1.7): { eye: V3; dir: V3; view: AimView } {
  const f = norm([at[0] - P[0], 0, at[2] - P[2]]), right: V3 = [f[2], 0, -f[0]];
  const eye: V3 = [P[0] - f[0] * back + right[0] * side, P[1] + up, P[2] - f[2] * back + right[2] * side];
  const dir = norm(sub(at, eye));
  return { eye, dir, view: { eye, yaw: Math.atan2(dir[0], dir[2]), viewPitch: Math.asin(-dir[1]), fov: 1 } };
}
function frame(ctx: SimContext, l: { eye: V3; dir: V3; view: AimView }, btn = 0): InputFrame {
  const P = ctx.player;
  const [ax, az] = chaseAim(l.view, P.x, P.z, 16 / 9, (x, z) => ctx.world.height(x, z));
  return { ...NO_INPUT, btn, aimX: ax, aimZ: az, aim: aimRayOf({ eye: l.eye, dir: l.dir }), aimDev: 'mouse' };
}

type BeamEv = Extract<SimEvent, { t: 'beam' }>;
type CastEv = Extract<SimEvent, { t: 'cast' }>;
interface Log { events: SimEvent[] }
/** press primary fire on the first tick and keep aiming through the lens for `ticks` ticks (one beam: its cooldown is 2 s) */
function fire(ctx: SimContext, l: { eye: V3; dir: V3; view: AimView }, ticks = 30): Log {
  const log: Log = { events: [] };
  for (let k = 0; k < ticks; k++) log.events.push(...step(ctx, frame(ctx, l, k === 0 ? BTN.basic : 0)));
  return log;
}
const hitsOn = (log: Log, e: number) => log.events.filter((v) => v.t === 'hit' && v.enemy === e).length;
const hitOrder = (log: Log) => log.events.filter((v): v is Extract<SimEvent, { t: 'hit' }> => v.t === 'hit').map((v) => v.enemy);
const beamOf = (log: Log): BeamEv => { const b = log.events.filter((v): v is BeamEv => v.t === 'beam'); assert.equal(b.length, 1, 'one beam'); return b[0]; };
const castOf = (log: Log): CastEv => log.events.filter((v): v is CastEv => v.t === 'cast')[0];
const ends = (b: BeamEv): [V3, V3] => [[b.x1, b.y1!, b.z1], [b.x2, b.y2!, b.z2]];
/** a lens level with the partner's muzzle (read from a no-fire tick's aim state), looking due north `dist` m: the
 *  crosshair ray, and so the beam, runs horizontally at muzzle height */
function level(ctx: SimContext, P: V3, dist = 14) {
  step(ctx, frame(ctx, lens(P, [P[0], P[1] + 0.6, P[2] + dist])));
  const y = ctx.aim.oy;
  return lens(P, [P[0], y, P[2] + dist], 0, 4.5, y - P[1]);
}

/**
 * The beam event is the truth: it is 3D (y1/y2), it ends where its core stopped (a world end has solid just past it and
 * open air just before it; a range end is the beam's length from the muzzle), every enemy it damaged lies inside the drawn
 * band (the segment grown by the half-width, as wide vertically), and the event's hit count matches the damage.
 */
function truthful(ctx: SimContext, log: Log, damaged: number[], struck = 0) {
  const b = beamOf(log), [A, B] = ends(b), L = len(sub(B, A)), u = norm(sub(B, A)), w = b.width;
  assert.ok(b.y1 !== undefined && b.y2 !== undefined, 'a spatial beam carries its heights');
  const c = castOf(log);
  assert.ok(c.o, 'the cast names its muzzle');
  assert.deepEqual(c.o!.o, A, 'the beam is drawn from the muzzle');
  assert.ok(Math.abs(c.tx - B[0]) < 1e-9 && Math.abs(c.tz - B[2]) < 1e-9, 'the cast ends where the beam ends');
  if (b.why === 'world') {
    const at = (s: number): V3 => [B[0] + u[0] * s, B[1] + u[1] * s, B[2] + u[2] * s];
    const f = ctx.rules.aim.foliageCover ? 0 : QF.foliage;
    assert.ok(solidAt(ctx.world, ...at(2e-3), SK_WORLD, f) !== 0, 'solid just past a world end');
    assert.equal(solidAt(ctx.world, ...at(-2e-3), SK_WORLD, f), 0, 'open air just before it');
  } else if (b.why === 'range') {
    const spec = slotSpec(ctx, 0);
    assert.ok(Math.abs(L - spec.range * ctx.player.derived.area) < 1e-9, `a range end is the beam's length (${L})`);
  }
  const E = ctx.enemies;
  for (const e of damaged) {
    // where it stood when the beam hit it (the hit event; knockback moves it afterwards): x, top, z
    const h = log.events.find((v): v is Extract<SimEvent, { t: 'hit' }> => v.t === 'hit' && v.enemy === e);
    assert.ok(h, `enemy ${e} was hit`);
    const ex = h!.x, ez = h!.z, yb = h!.y - E.tall[e], yt = h!.y;
    let inside = false;
    for (let s = 0; s <= 4000 && !inside; s++) {
      const t = (L * s) / 4000, x = A[0] + u[0] * t, y = A[1] + u[1] * t, z = A[2] + u[2] * t;
      inside = Math.hypot(x - ex, z - ez) <= E.radius[e] + w + 1e-6 && y >= yb - w - 1e-6 && y <= yt + w + 1e-6;
    }
    assert.ok(inside, `enemy ${e} took damage inside the drawn beam`);
  }
  assert.equal(b.hits, hitOrder(log).length + struck, 'the event counts what it touched (enemies, and rocks struck)');
}

// ------------------------------------------------------------------------------------------------ the reported defect

test('reported case: an enemy on a 4 m plateau with no line of sight from the muzzle takes planar beam damage; the spatial beam stops on the cliff', () => {
  // a plateau 4 m high from 5.5 m ahead; the enemy stands on it 9 m out, the lens is too low to see over the lip
  const plateau = (W: World) => { for (let i = 40; i <= 60; i++) for (let j = 56; j <= 70; j++) W.map.elev[K(W, i, j)] = 4; };
  for (const phase of ['2b', '2c']) {
    const { ctx, P } = scene({ rules: phase === '2b' ? PHASE2B : {}, edit: plateau });
    const e = put(ctx, P[0], 4, P[2] + 9);
    const log = fire(ctx, lens(P, centre(ctx, e)));
    const c = castOf(log);
    if (phase === '2b') {
      assert.ok(!c.o, 'Phase 2B: the beam is planar');
      // the defect, recreated on this code: the line from the partner's chest (the planar beam's height) is blocked
      assert.equal(segmentClear(ctx.world, P[0], 0.8, P[2], ...centre(ctx, e)), false, 'no line of sight');
      assert.ok(hitsOn(log, e) >= 1, 'Phase 2B: damaged anyway (the planar capsule ignores height and cover)');
    } else {
      assert.equal(segmentClear(ctx.world, ...c.o!.o, ...centre(ctx, e)), false, 'no line of sight from the muzzle');
      assert.equal(hitsOn(log, e), 0, 'Phase 2C: no damage');
      const b = beamOf(log);
      assert.equal(b.why, 'world');
      assert.equal(b.kind, SK.terrain, 'the beam ends on the cliff');
      assert.ok(Math.abs(b.z2 - (P[2] + 5.5)) < 1e-6 && b.y2! < 4, `at its face (${b.z2 - P[2]}, ${b.y2})`);
      truthful(ctx, log, []);
    }
  }
});

test('camera clear, muzzle blocked: a lens high enough to see over the lip does not let the beam through it', () => {
  const plateau = (W: World) => { for (let i = 40; i <= 60; i++) for (let j = 56; j <= 70; j++) W.map.elev[K(W, i, j)] = 4; };
  const { ctx, P } = scene({ edit: plateau });
  const e = put(ctx, P[0], 4, P[2] + 9);
  const l = lens(P, centre(ctx, e), 0, 3, 6);
  assert.ok(segmentClear(ctx.world, ...l.eye, ...centre(ctx, e)), 'the camera sees the enemy');
  const log = fire(ctx, l), c = castOf(log), b = beamOf(log);
  assert.equal(c.o!.kind, SK.enemy, 'the crosshair is on the enemy');
  assert.equal(c.o!.blocked, true, 'the aim reports the obstruction');
  assert.equal(segmentClear(ctx.world, ...c.o!.o, ...centre(ctx, e)), false, 'the muzzle cannot see it');
  assert.equal(hitsOn(log, e), 0, 'no damage');
  assert.equal(b.why, 'world');
  truthful(ctx, log, []);
});

test('close-range obstruction: a pillar in front of the muzzle that the shoulder camera sees past stops the beam at the pillar', () => {
  // a 1 × 1 pillar 1.5 m ahead (x within ±0.5 m of the partner's axis); the enemy 10 m out on the axis; the lens on the right shoulder
  for (const phase of ['2b', '2c']) {
    const { ctx, P } = scene({ rules: phase === '2b' ? PHASE2B : {}, edit: (W) => prop(W, 'pillar', 50, 52) });
    const e = put(ctx, P[0], 0, P[2] + 10);
    const l = lens(P, centre(ctx, e), 1.25);
    assert.ok(segmentClear(ctx.world, ...l.eye, ...centre(ctx, e)), 'the shoulder lens sees past the pillar');
    const log = fire(ctx, l);
    if (phase === '2b') { assert.ok(hitsOn(log, e) >= 1, 'Phase 2B: through the pillar'); continue; }
    const b = beamOf(log);
    assert.equal(hitsOn(log, e), 0, 'no damage behind the pillar');
    assert.equal(castOf(log).o!.blocked, true);
    assert.ok(b.why === 'world' && b.kind === SK.wall && Math.abs(b.z2 - (P[2] + 1.5)) < 1e-6, `ends on the pillar face (${b.z2 - P[2]})`);
    truthful(ctx, log, []);
  }
  {
    // hugging a wall: the face 0.6 m ahead of the body's centre, inside the beam's first metre
    const { ctx, P } = scene({ edit: (W) => { for (let i = 45; i <= 55; i++) W.map.wall[K(W, i, 51)] = 1; } });
    const e = put(ctx, P[0], 0, P[2] + 6);
    const log = fire(ctx, lens(P, centre(ctx, e), 1.25, 4.5, 3)), b = beamOf(log);
    assert.equal(hitsOn(log, e), 0);
    assert.ok(b.why === 'world' && len(sub(ends(b)[1], ends(b)[0])) < 0.5, 'the beam ends at once on the wall');
    truthful(ctx, log, []);
  }
});

// ------------------------------------------------------------------------------------------------ elevation

test('elevation: a flier 4 m up is hit; an enemy on the ground under the beam is not (Phase 2B hits both)', () => {
  for (const phase of ['2b', '2c']) {
    const { ctx, P } = scene({ rules: phase === '2b' ? PHASE2B : {} });
    const flier = put(ctx, P[0], 0, P[2] + 12, 'medium', 4), ground = put(ctx, P[0], 0, P[2] + 7);
    const log = fire(ctx, lens(P, centre(ctx, flier)));
    assert.ok(hitsOn(log, flier) >= 1, `${phase}: the flier`);
    if (phase === '2b') { assert.ok(hitsOn(log, ground) >= 1, 'Phase 2B: the enemy 3 m under the line too'); continue; }
    assert.equal(hitsOn(log, ground), 0, 'Phase 2C: the beam passes over it');
    truthful(ctx, log, [flier]);
  }
});

test('elevation: an enemy on a plateau the muzzle can see is hit, from below and down from the top', () => {
  {
    // the plateau 4 m high from 12 m ahead, the enemy at its edge, a lens high enough
    const { ctx, P } = scene({ edit: (W) => { for (let i = 40; i <= 60; i++) for (let j = 62; j <= 70; j++) W.map.elev[K(W, i, j)] = 1.5; } });
    const e = put(ctx, P[0], 1.5, P[2] + 12.6);
    const log = fire(ctx, lens(P, centre(ctx, e), 0, 4.5, 2.5));
    assert.ok(hitsOn(log, e) >= 1, 'from below');
    truthful(ctx, log, [e]);
  }
  {
    // the partner on a 4 m plateau, the enemy on the ground 9 m out
    const { ctx, W, P } = scene({ edit: (W) => { for (let i = 40; i <= 60; i++) for (let j = 40; j <= 50; j++) W.map.elev[K(W, i, j)] = 4; } });
    ctx.player.y = ctx.player.py = 4; P[1] = 4;
    const e = put(ctx, P[0], 0, P[2] + 9);
    const log = fire(ctx, lens(P, centre(ctx, e), 0, 4.5, 2.5));
    assert.ok(hitsOn(log, e) >= 1, 'down from the top');
    truthful(ctx, log, [e]);
    void W;
  }
});

// ------------------------------------------------------------------------------------------------ cover

test('cover: tree trunks, boulders and wall columns stop the beam; Phase 2B passes all of them', () => {
  for (const kind of ['tree', 'boulder', 'pillar', 'stalagmite'] as ArenaPropKind[]) {
    for (const phase of ['2b', '2c']) {
      const { ctx, P } = scene({ rules: phase === '2b' ? PHASE2B : {}, edit: (W) => prop(W, kind, 50, 54) });
      const e = put(ctx, P[0], 0, P[2] + 9);
      const log = fire(ctx, lens(P, centre(ctx, e), 0, 4.5, 3.5));
      if (phase === '2b') { assert.ok(hitsOn(log, e) >= 1, `${kind}: Phase 2B through it`); continue; }
      const b = beamOf(log);
      assert.equal(hitsOn(log, e), 0, `${kind}: cover`);
      assert.ok(b.why === 'world' && b.kind === SK.wall && Math.abs(b.z2 - (P[2] + 3.5)) < 1e-6, `${kind}: ends on its face`);
      truthful(ctx, log, []);
    }
  }
});

test('cover: a rock stops a Tiny partner\'s beam at Tiny height; a beam above its top passes', () => {
  const tiny = speciesOf('tiny');
  {
    const { ctx, P } = scene({ species: tiny, edit: (W) => prop(W, 'rock', 50, 54, 0.75) });
    const e = put(ctx, P[0], 0, P[2] + 9, 'tiny');
    const log = fire(ctx, lens(P, centre(ctx, e), 0, 3, 0.6));
    const b = beamOf(log);
    assert.ok(b.y1! < 0.75, 'the Tiny muzzle is under the rock top');
    assert.equal(hitsOn(log, e), 0, 'the rock is cover');
    assert.ok(b.why === 'world' && b.kind === SK.terrain, 'ends on the rock');
    truthful(ctx, log, []);
  }
  {
    // a Medium partner aiming at a Medium enemy's centre: the line runs over the rock
    const { ctx, P } = scene({ edit: (W) => prop(W, 'rock', 50, 54, 0.75) });
    const e = put(ctx, P[0], 0, P[2] + 9);
    const log = fire(ctx, lens(P, [P[0], 1.2, P[2] + 9]));
    assert.ok(hitsOn(log, e) >= 1, 'over the rock');
    truthful(ctx, log, [e]);
  }
});

test('foliage: a hedge, a bush and a berry bush (leaf: blocksShots false) are not cover; with rules.aim.foliageCover they are', () => {
  for (const [kind, platform] of [['hedge', 0], ['bush', 0.7], ['bushB', 0.7], ['berry', 0]] as [ArenaPropKind, number][]) {
    assert.equal(MATERIALS[PROP_MATERIALS[kind]!.mat].blocksShots, false, `${kind}: authored as not blocking shots`);
    for (const cover of [false, true]) {
      const tiny = speciesOf('tiny');
      const { ctx, P } = scene({ species: tiny, rules: { aim: { foliageCover: cover } }, edit: (W) => prop(W, kind, 50, 54, platform) });
      const e = put(ctx, P[0], 0, P[2] + 9, 'tiny');
      const log = fire(ctx, lens(P, centre(ctx, e), 0, 3, 0.6));
      const b = beamOf(log);
      if (!cover) { assert.ok(hitsOn(log, e) >= 1, `${kind}: through the foliage`); truthful(ctx, log, [e]); }
      else { assert.equal(hitsOn(log, e), 0, `${kind}: foliage as cover`); assert.equal(b.why, 'world'); truthful(ctx, log, []); }
    }
  }
});

test('foliage on real maps: every leaf prop tile is open above its ground with the combat flag; trees, rocks and walls stay solid', () => {
  const worlds: [string, World][] = [['meadow', new World(defaultRules, BIOMES.meadow, 2)], ['dusk', new World(defaultRules, BIOMES.dusk, 3)]];
  for (const loc of ['viridian-forest', 'mt-moon']) {
    const rules = { ...defaultRules, worldgen: { ...defaultRules.worldgen, mode: 'generated' as const, locations: { meadow: loc } } };
    worlds.push([loc, new World(rules, BIOMES.meadow, 1)]);
  }
  let soft = 0, hard = 0;
  for (const [name, W] of worlds) {
    const M = W.map;
    // the prop that owns each tile: the last one placed with a material row (sim/props.ts PropField.at)
    const owner = new Map<number, ArenaProp>();
    for (const p of M.props) if (PROP_MATERIALS[p.kind]) for (let j = p.y; j < p.y + p.h; j++) for (let i = p.x; i < p.x + p.w; i++) owner.set(j * W.w + i, p);
    for (const p of M.props) {
      const k = p.y * W.w + p.x, pm = owner.has(k) ? PROP_MATERIALS[owner.get(k)!.kind] : undefined;
      if (p.x >= W.w || p.y >= W.h || M.stairs[k] || M.terrain[k] === 3 || (W.over && W.over[k] > 0)) continue;
      const x = p.x - W.half + 0.5, z = p.y - W.half + 0.5, y = M.elev[k] + 0.3;
      const isWall = M.wall[k] === 1, isLow = M.platform[k] > 0.3;
      if (!isWall && !isLow) continue;
      const open = solidAt(W, x, y, z, SK_WORLD, QF.foliage) === 0, plain = solidAt(W, x, y, z, SK_WORLD) === 0;
      assert.equal(plain, false, `${name} ${p.kind}: solid without the flag`);
      if (pm && !MATERIALS[pm.mat].blocksShots) { assert.ok(open, `${name} ${p.kind} at ${p.x},${p.y}: foliage is open`); soft++; }
      else { assert.ok(!open, `${name} ${p.kind} at ${p.x},${p.y}: still cover`); hard++; }
    }
  }
  assert.ok(soft > 10 && hard > 10, `both kinds met (${soft} foliage, ${hard} cover tiles)`);
});

// ------------------------------------------------------------------------------------------------ decks

test('decks: the underside stops a beam from below, the underpass lets it through, the slab separates the layers from above', () => {
  // a deck over tiles (46..54, 53..60): top 3 m, underside 2.4 m
  const deck = (W: World) => { for (let i = 46; i <= 54; i++) for (let j = 53; j <= 60; j++) W.over![K(W, i, j)] = 3; };
  for (const phase of ['2b', '2c']) {
    const { ctx, P } = scene({ rules: phase === '2b' ? PHASE2B : {}, edit: deck });
    const top = put(ctx, P[0], 3, P[2] + 6);
    const log = fire(ctx, lens(P, centre(ctx, top), 0, 4.5, 1.2));
    if (phase === '2b') { assert.ok(hitsOn(log, top) >= 1, 'Phase 2B: through the slab'); continue; }
    const b = beamOf(log);
    assert.equal(hitsOn(log, top), 0, 'the slab is between');
    // the lens sees the slab's near edge face, so the crosshair point (and the beam's end) is on that face, in the slab
    assert.ok(b.why === 'world' && b.kind === SK.deck && b.y2! >= 3 - DECK_SLAB - 1e-6 && b.y2! <= 3 + 1e-6, `on the slab (${b.y2})`);
    truthful(ctx, log, []);
  }
  {
    const { ctx, P } = scene({ edit: deck });
    const e = put(ctx, P[0], 0, P[2] + 9);
    const log = fire(ctx, lens(P, centre(ctx, e), 0, 3, 1.2));
    assert.ok(hitsOn(log, e) >= 1, 'through the underpass');
    truthful(ctx, log, [e]);
  }
  for (const phase of ['2b', '2c']) {
    const { ctx, W, P } = scene({ rules: phase === '2b' ? PHASE2B : {}, edit: deck });
    // the partner on the deck top; one enemy on the deck (hit), one on the ground right under the line (not)
    ctx.player.z = ctx.player.pz = C(W, 54); ctx.player.y = ctx.player.py = 3; P[2] = ctx.player.z; P[1] = 3;
    const on = put(ctx, P[0], 3, P[2] + 5), under = put(ctx, P[0], 0, P[2] + 3);
    const log = fire(ctx, lens(P, centre(ctx, on), 0, 4.5, 2));
    assert.ok(hitsOn(log, on) >= 1, `${phase}: on the deck`);
    if (phase === '2b') { assert.ok(hitsOn(log, under) >= 1, 'Phase 2B: and under it'); continue; }
    assert.equal(hitsOn(log, under), 0, 'the slab separates the layers');
    truthful(ctx, log, [on]);
  }
});

// ------------------------------------------------------------------------------------------------ width, order, pierce

test('width: the beam meets bodies within its half-width of the core, and only those (Tiny and Extra Large targets)', () => {
  for (const cls of ['tiny', 'xl']) {
    const { ctx, P } = scene();
    const w = slotSpec(ctx, 0).radius;
    const probe = put(ctx, P[0], 0, P[2] + 30, cls), r = ctx.enemies.radius[probe];
    ctx.enemies.alive[probe] = 0; ctx.enemies.count--;
    // the core runs due north at chest height; the targets stand beside it, their surfaces 0.05 m inside / outside the width
    const inside = put(ctx, P[0] + r + w - 0.05, 0, P[2] + 6, cls), outside = put(ctx, P[0] - r - w - 0.05, 0, P[2] + 9, cls);
    const log = fire(ctx, lens(P, [P[0], 0.6, P[2] + 14]));
    assert.ok(hitsOn(log, inside) >= 1, `${cls}: inside the width`);
    assert.equal(hitsOn(log, outside), 0, `${cls}: outside it`);
    truthful(ctx, log, [inside]);
  }
});

test('adjacent geometry: the width does not reach around a wall beside the core; the core passes a wall face it runs along', () => {
  const { ctx, P } = scene({
    // a wall column east of the line from 4 m to 7 m out, its west face 0.4 m from the core
    edit: (W) => { for (let j = 54; j <= 56; j++) W.map.wall[K(W, 51, j)] = 1; },
  });
  const behind = put(ctx, P[0] + 0.95, 0, P[2] + 5.5, 'tiny');  // within the width, but on the far side of the wall face
  const open = put(ctx, P[0] - 0.95, 0, P[2] + 5.5, 'tiny');    // the same offset on the open side
  const ahead = put(ctx, P[0], 0, P[2] + 11);
  // the wall column's west face is at x = P.x + 0.5; the enemy east of it has its axis 0.45 m inside the wall tile's line
  const log = fire(ctx, lens(P, centre(ctx, ahead)));
  assert.equal(hitsOn(log, behind), 0, 'behind the wall face: not reached');
  assert.ok(hitsOn(log, open) >= 1, 'the open side: reached');
  assert.ok(hitsOn(log, ahead) >= 1, 'the core ran along the face to the far target');
  truthful(ctx, log, [open, ahead]);
});

test('multiple targets: every body on the line in contact order (not pool order), rocks struck; authored pierce ends it on the last', () => {
  {
    const { ctx, P } = scene();
    // spawned far to near, so pool order is the reverse of contact order
    const far = put(ctx, P[0], 0, P[2] + 12), mid = put(ctx, P[0] + 0.3, 0, P[2] + 8), near = put(ctx, P[0] - 0.3, 0, P[2] + 4);
    const rock = spawnBody(ctx, 'rock', P[0], P[2] + 6);
    const hit0 = ctx.bodies.hitCd[rock];
    const log = fire(ctx, level(ctx, P));
    assert.deepEqual(hitOrder(log), [near, mid, far], 'contact order');
    assert.ok(ctx.bodies.hitCd[rock] > hit0, 'the rock on the line was struck (Ice Beam has no Push: it is chipped, not moved)');
    const b = beamOf(log);
    assert.equal(b.why, 'range', 'pierce all: it runs its length');
    truthful(ctx, log, [near, mid, far], 1);
  }
  for (const pierce of [0, 1]) {
    const { ctx, P } = scene({ rules: { archetypes: { beam: { pierce } } } });
    const far = put(ctx, P[0], 0, P[2] + 12), mid = put(ctx, P[0], 0, P[2] + 8), near = put(ctx, P[0], 0, P[2] + 4);
    const log = fire(ctx, level(ctx, P));
    const want = pierce === 0 ? [near] : [near, mid];
    assert.deepEqual(hitOrder(log), want, `pierce ${pierce}`);
    const b = beamOf(log), last = want[want.length - 1], E = ctx.enemies;
    const h = log.events.find((v): v is Extract<SimEvent, { t: 'hit' }> => v.t === 'hit' && v.enemy === last)!;
    assert.equal(b.why, 'actor');
    assert.ok(Math.abs(b.z2 - (h.z - E.radius[last] - b.width)) < 1e-6, `ends where its volume meets the last target (${b.z2}, ${h.z})`);
    truthful(ctx, log, want);
    void far;
  }
});

test('a crowded line: 150 enemies on one beam are all reached in order (the contact list never truncates)', () => {
  const { ctx, P } = scene();
  const ids: number[] = [];
  // far to near, 0.08 m apart along the line from 2 m to 14 m
  for (let k = 149; k >= 0; k--) ids.unshift(put(ctx, P[0], 0, P[2] + 2 + k * 0.08, 'tiny'));
  const log = fire(ctx, level(ctx, P));
  assert.equal(new Set(hitOrder(log)).size, 150, 'every one of them');
  // contact order: each hit's entry distance along the beam (from where the enemy stood when it was hit; the crowd's
  // separation has shuffled them since they were placed) never decreases
  const b = beamOf(log), [A, B] = ends(b), u = norm(sub(B, A)), E = ctx.enemies;
  let last = -Infinity;
  for (const h of log.events.filter((v): v is Extract<SimEvent, { t: 'hit' }> => v.t === 'hit')) {
    const qx = h.x - A[0], qz = h.z - A[2], hl = Math.hypot(u[0], u[2]), along = (qx * u[0] + qz * u[2]) / hl, perp = Math.abs(qx * u[2] - qz * u[0]) / hl;
    // a body the beam starts inside is a contact at 0 (spatial.ts: CF.initial; ties go by id)
    const R = E.radius[h.enemy] + b.width, entry = Math.max(0, (along - Math.sqrt(Math.max(0, R * R - perp * perp))) / hl);
    assert.ok(entry >= last - 1e-9, `contact order (${entry} after ${last})`);
    last = entry;
  }
  truthful(ctx, log, ids);
});

test('range: a target whose surface is just inside the beam\'s length is hit, just outside is not; the beam ends at its length', () => {
  for (const d of [-0.1, 0.1]) {
    const { ctx, P } = scene();
    const s = slotSpec(ctx, 0), L = s.range * ctx.player.derived.area;
    const probe = put(ctx, P[0], 0, P[2] + 40); const r = ctx.enemies.radius[probe]; ctx.enemies.alive[probe] = 0; ctx.enemies.count--;
    // the muzzle is ahead of the partner: place the target by the real muzzle (dry aim through presentation)
    const l = level(ctx, P, 30);
    const oz = ctx.aim.oz;
    const e = put(ctx, P[0], 0, oz + L + r + s.radius + d);
    const log = fire(ctx, l);
    if (d < 0) assert.ok(hitsOn(log, e) >= 1, 'inside the length'); else assert.equal(hitsOn(log, e), 0, 'past it');
    assert.equal(beamOf(log).why, 'range');
    truthful(ctx, log, d < 0 ? [e] : []);
  }
});

// ------------------------------------------------------------------------------------------------ bodies, strays, determinism

test('partner sizes: Tiny, Medium and Extra Large beams leave their own muzzles and hit the crosshair target, from both shoulders', () => {
  const heights: number[] = [];
  for (const cls of ['tiny', 'medium', 'xl']) {
    for (const side of [1.25, -1.25]) {
      const { ctx, P } = scene({ species: speciesOf(cls) });
      const e = put(ctx, P[0] + 1.5, 0, P[2] + 11, cls === 'xl' ? 'large' : 'medium');
      const log = fire(ctx, lens(P, centre(ctx, e), side));
      assert.ok(hitsOn(log, e) >= 1, `${cls} ${side}: hit`);
      const b = beamOf(log);
      if (side > 0) heights.push(b.y1!);
      truthful(ctx, log, [e]);
    }
  }
  assert.ok(heights[0] < heights[1] && heights[1] < heights[2], `muzzle height grows with the class (${heights.map((h) => h.toFixed(2))})`);
});

test('a relocated enemy (moved after the grid rebuild) on the beam is hit that tick', () => {
  const { ctx, P } = scene({ rules: NOWIND });
  const e = put(ctx, P[0] + 30, 0, P[2] - 20, 'tiny'), E = ctx.enemies;
  // the rebuild filed it 36 m away; it is then moved onto the beam's line 8 m ahead, as enemies.ts relocates
  E.x[e] = E.px[e] = P[0]; E.z[e] = E.pz[e] = P[2] + 8;
  ctx.tick++;
  ctx.input = frame(ctx, lens(P, [P[0], 0.6, P[2] + 14]), BTN.basic);
  ctx.events.length = 0;
  movesSystem.update(ctx, 1 / 60);
  assert.ok(E.hp[e] < E.maxHp[e], 'the stray is tested where it is now');
  const log = { events: ctx.events.slice() };
  truthful(ctx, log, [e]);
  // the grid itself still has it in the old cell: a plain grid.query around the line misses it
  const n = ctx.grid.query(P[0], P[2] + 8, 2);
  assert.ok(![...ctx.grid.result.slice(0, n)].includes(e), 'grid.query does not see it this tick');
});

test('determinism and the flag: a scripted beam replay is identical twice; with beams off the path (or no ray) nothing reads the ray', () => {
  const run = (rules: DeepPartial<Rules>, ray: boolean) => {
    const { ctx, P } = scene({ rules, edit: (W) => { prop(W, 'pillar', 52, 55); prop(W, 'hedge', 48, 56); for (let i = 46; i <= 54; i++) for (let j = 60; j <= 64; j++) W.over![K(W, i, j)] = 3; } });
    const a = put(ctx, P[0] + 2, 0, P[2] + 9), b = put(ctx, P[0] - 3, 3, P[2] + 12, 'medium'), c = put(ctx, P[0], 0, P[2] + 6, 'medium', 3);
    const hs: number[] = [], beams: string[] = [];
    for (let k = 0; k < 360; k++) {
      const t = [a, b, c][Math.floor(k / 120)];
      const inp = frame(ctx, lens(P, centre(ctx, t), k % 240 < 120 ? 1.25 : -1.25), k % 120 === 0 ? BTN.basic : 0);
      if (!ray) { delete inp.aim; delete inp.aimDev; }
      for (const ev of step(ctx, inp)) if (ev.t === 'beam') beams.push(JSON.stringify(ev));
      hs.push(stateHash(ctx));
    }
    return { hs, beams };
  };
  const x = run({}, true), y = run({}, true);
  assert.deepEqual(x.hs, y.hs, 'identical state per tick');
  assert.deepEqual(x.beams, y.beams, 'identical beams');
  assert.equal(x.beams.length, 3);
  assert.ok(x.beams.every((s) => JSON.parse(s).y1 !== undefined), 'spatial beams');
  const off = run(PHASE2B, true), noRay = run(PHASE2B, false), noRayOn = run({}, false);
  assert.deepEqual(off.hs, noRay.hs, 'Phase 2B rules: the ray changes nothing');
  assert.deepEqual(noRayOn.hs, noRay.hs, 'no ray: the planar beam, whatever the new rules say');
  assert.ok(off.beams.every((s) => JSON.parse(s).y1 === undefined), 'planar beams');
});

test('Pressure Jet (Water Gun turned into a beam by a build) takes the spatial beam path with its own length, width and push', () => {
  const { ctx, P } = scene({ species: 'totodile', move: 'water_gun', edit: (W) => prop(W, 'pillar', 50, 56) });
  ctx.player.moves[0].uses = 99;
  assert.equal(setTransform(ctx, ctx.player.moves[0], 'pressure_jet'), true);
  const s = slotSpec(ctx, 0);
  assert.equal(s.archetype, 'beam');
  const e = put(ctx, P[0], 0, P[2] + 4), behind = put(ctx, P[0], 0, P[2] + 8);
  const log = fire(ctx, lens(P, centre(ctx, behind)));
  assert.ok(hitsOn(log, e) >= 1 && hitsOn(log, behind) === 0, 'the near enemy, not the one behind the pillar');
  assert.ok(Math.abs(beamOf(log).width - s.radius) < 1e-9);
  truthful(ctx, log, [e]);
});

void tpl; void MASK;
