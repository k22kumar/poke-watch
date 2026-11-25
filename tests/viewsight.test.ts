// CL, rules.aim.viewSight (docs/WORLDGEN3D.md Q15c, CL-Q3, CL-Q10 to CL-Q13): a spatial shot launches from the partner's
// anatomical eye (src/rules/anatomy.ts) and its own sweep from there is the line-of-sight check, the HUD's `blocked`
// included. Flag off, the muzzle as before. Every scene runs on both engines: the tile column model and Rapier
// (rules.physics.engine 'rapier', built from the tile adapter's model of the same private world).
//
// Cover is raised terrain (one tile row at elev = the rung), solid for shots and sight on both engines. The crosshair
// ray comes from a lens high behind the partner, so the camera sees the target over every rung and the check alone
// decides: "a camera that sees is not enough; the eye has to".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import './setup/physics';
import { defaultRules } from '../src/rules/defaults';
import { BIOMES } from '../src/rules/stages';
import { SPECIES, SPECIES_BY_ID } from '../src/rules/species';
import { anatomyOf } from '../src/rules/anatomy';
import { bodyOf, partnerFootprint, partnerHeight } from '../src/rules/sizing';
import { World } from '../src/sim/world';
import { createRun, disposeRun, step } from '../src/sim/run';
import { spawnEnemy } from '../src/sim/enemies';
import { compileMove } from '../src/sim/moves';
import { SK } from '../src/sim/spatial';
import { eyePoint, eyeSeesPoint, resolveSpatial } from '../src/sim/aim';
import { worldOf } from '../src/sim/worldquery';
import { BTN, NO_INPUT, freshAimState, type InputFrame, type SimContext, type SimEvent } from '../src/sim/types';
import { runScenario, SCENARIOS } from './fixtures/scenarios';

type V3 = [number, number, number];
type Engine = 'tiles' | 'rapier';
const ENGINES: Engine[] = ['tiles', 'rapier'];
const RUNGS = [1.45, 2.0, 3.7];

/** a private flat grass plain at height 0 (tests/aim3d.test.ts flatWorld), edited by `build` before any query */
function flatWorld(build: (W: World) => void): World {
  const W = new World(defaultRules, BIOMES.meadow, 5);
  const n = W.w * W.h, M = W.map;
  const map = { ...M, terrain: new Uint8Array(n), elev: new Float32Array(n), stairs: new Uint8Array(n), wall: new Uint8Array(n), platform: new Float32Array(n), over: new Float32Array(n), wlevel: undefined };
  Object.assign(W, { map, over: map.over, voids: new Uint8Array(n), los: true });
  build(W);
  return W;
}
const K = (W: World, i: number, j: number) => j * W.w + i;
const C = (W: World, i: number) => i - W.half + 0.5;

const medium = SPECIES.filter((s) => !s.wave && bodyOf(s).sizeClass === 'medium' && !bodyOf(s).authored && !s.flying).map((s) => s.id).sort()[0];

interface Scene { ctx: SimContext; P: V3 }
/** a run on a private flat world on `engine`, the partner at the centre of tile (50, 50) facing +z, its only move an
 *  Ember (a bolt) */
function scene(engine: Engine, species: string, viewSight: boolean, build: (W: World) => void = () => {}): Scene {
  const ctx = createRun({ seed: 1, species, ruleOverrides: { aim: { viewSight }, ...(engine === 'rapier' ? { physics: { engine: 'rapier' } } : {}) } as never });
  const W = flatWorld(build);
  ctx.world = W;
  ctx.enemies.clear(); ctx.bodies.clear(); ctx.projectiles.clear(); ctx.zones.clear();
  const p = ctx.player;
  p.x = p.px = C(W, 50); p.z = p.pz = C(W, 50); p.y = p.py = 0; p.facing = 0;
  p.moves.length = 0;
  p.moves.push({ key: 'ember', level: 1, cd: 0, spec: compileMove(ctx.rules, 'ember') });
  ctx.grid.rebuild(ctx.enemies.hi, ctx.enemies.x, ctx.enemies.z, ctx.enemies.alive);
  return { ctx, P: [p.x, p.y, p.z] };
}
/** an enemy standing still whose hurt cylinder is centred at height `cy` above the ground at (x, z) */
function put(ctx: SimContext, x: number, z: number, cy: number): number {
  const E = ctx.enemies, e = spawnEnemy(ctx, medium, x, z);
  const hover = cy - E.tall[e] / 2;
  E.x[e] = E.px[e] = x; E.z[e] = E.pz[e] = z; E.y[e] = E.py[e] = hover; E.hover[e] = hover;
  E.spawnT[e] = 1; E.hp[e] = E.maxHp[e] = 1e6; E.speed[e] = 0; E.dmg[e] = 0;
  ctx.grid.rebuild(E.hi, E.x, E.z, E.alive);
  return e;
}
/** the crosshair ray from `lens` through `at` */
function ray(lens: V3, at: V3): InputFrame['aim'] {
  const d = [at[0] - lens[0], at[1] - lens[1], at[2] - lens[2]], L = Math.hypot(d[0], d[1], d[2]);
  return { ox: lens[0], oy: lens[1], oz: lens[2], dx: d[0] / L, dy: d[1] / L, dz: d[2] / L };
}
const input = (aim: InputFrame['aim'], btn = 0): InputFrame => ({ ...NO_INPUT, btn, aim, aimDev: 'mouse' });

/** one rung scene: cover of height `c` on tile row 52 (1.5 to 2.5 m ahead), an enemy 10 m ahead whose front is aimed at
 *  `aimY` m up, from a lens 12 m up and 4.5 m behind (it sees the enemy over every rung) */
function rungScene(engine: Engine, species: string, viewSight: boolean, c: number, aimY?: number) {
  const s = scene(engine, species, viewSight, (W) => { for (let i = 44; i <= 56; i++) W.map.elev[K(W, i, 52)] = c; });
  const { ctx, P } = s, eye = anatomyOf(ctx.player.species, ctx.rules).eye.up, y = aimY ?? eye;
  const e = put(ctx, P[0], P[2] + 10, y), front: V3 = [P[0], y, P[2] + 10 - ctx.enemies.radius[e] + 0.02];
  const aim = ray([P[0] + 1.25, 12, P[2] - 4.5], front);
  return { ...s, e, aim, eye };
}
/** does the straight segment o → t pass under the top `c` of the cover row (z from 1.5 to 2.5 m ahead of P)? */
function underCover(P: V3, o: V3, t: V3, c: number): boolean {
  const at = (z: number) => o[1] + ((t[1] - o[1]) * (z - o[2])) / (t[2] - o[2]);
  return at(P[2] + 1.5) < c || at(P[2] + 2.5) < c;
}

// ---------------------------------------------------------------------------------------------- every body × every rung

test('CL-Q3: each body against each cover rung from its own eye, flag on and off, on both engines', () => {
  // Charmander (Small, eye 0.81), Mewtwo (Large, 1.55), Feraligatr (Extra Large hero, 1.95), Onix (a giant, 2.36 m)
  const expectOn: Record<string, boolean[]> = {
    charmander: [true, true, true], mewtwo: [false, true, true], feraligatr: [false, true, true], onix: [false, false, true],
  };
  for (const engine of ENGINES) for (const id of Object.keys(expectOn)) for (const [r, c] of RUNGS.entries()) for (const on of [true, false]) {
    const { ctx, P, aim, eye } = rungScene(engine, id, on, c);
    ctx.input = input(aim);
    const out = freshAimState();
    assert.ok(resolveSpatial(ctx, ctx.player.moves[0].spec, out), `${engine} ${id} ${c}: a spatial aim`);
    const tag = `${engine} ${id} behind ${c} m, flag ${on ? 'on' : 'off'}`;
    assert.equal(out.hitKind, SK.enemy, `${tag}: the crosshair is on the enemy`);
    assert.equal(out.eye, on, `${tag}: launched from the ${on ? 'eye' : 'muzzle'}`);
    const sp = SPECIES_BY_ID[id];
    if (on) assert.ok(Math.abs(out.oy - (P[1] + eye)) < 1e-9, `${tag}: the launch height is the eye's (${out.oy})`);
    else assert.ok(Math.abs(out.oy - (P[1] + partnerHeight(sp, ctx.rules) * ctx.rules.aim.muzzle.up)) < 1e-9, `${tag}: the muzzle's height`);
    const want = underCover(P, [out.ox, out.oy, out.oz], [out.tx, out.ty, out.tz], c);
    assert.equal(out.blocked, want, `${tag}: blocked ${out.blocked}, the geometry says ${want}`);
    if (on) assert.equal(out.blocked, expectOn[id][r], `${tag}: from its eye at ${eye.toFixed(2)} m`);
    if (id === 'charmander') assert.ok(out.blocked, `${tag}: a Small is blocked by every rung`);
    disposeRun(ctx);
  }
});

// ------------------------------------------------------------------------------- CL-Q10: launched from the eye, and hit

test('CL-Q10: Feraligatr and Mewtwo see over 1.45 m cover; flagged, the shot launches from the eye and hits; flag off, the muzzle\'s shot meets the cover', () => {
  for (const engine of ENGINES) for (const id of ['feraligatr', 'mewtwo']) for (const on of [true, false]) {
    const { ctx, e, aim } = rungScene(engine, id, on, 1.45, 1.5);
    const events: SimEvent[] = [];
    let hud: boolean | undefined;
    for (let k = 0; k < 90; k++) {
      events.push(...step(ctx, input(aim, k === 0 ? BTN.basic : 0)));
      if (k === 0) hud = ctx.aim.blocked;
    }
    const cast = events.find((v): v is Extract<SimEvent, { t: 'cast' }> => v.t === 'cast');
    const hits = events.filter((v) => v.t === 'hit' && v.enemy === e).length, tag = `${engine} ${id} flag ${on ? 'on' : 'off'}`;
    assert.ok(cast?.o, `${tag}: a spatial cast`);
    assert.equal(cast!.o!.eye === true, on, `${tag}: the cast reports its launch point`);
    assert.equal(cast!.o!.blocked, !on, `${tag}: blocked ${cast!.o!.blocked}`);
    assert.equal(hud, cast!.o!.blocked, `${tag}: the HUD and the cast agree`);
    assert.equal(hits > 0, on, `${tag}: ${hits} hits`);
    disposeRun(ctx);
  }
});

// ------------------------------------------------------------------------- CL-Q11: the indicator never disagrees with the shot

test('CL-Q11: the HUD\'s blocked is the shot\'s own sweep from the eye: a blocked shot fires and meets the cover, a clear one hits', () => {
  let blocked = 0, clear = 0;
  for (const engine of ENGINES) for (const id of ['charmander', 'mewtwo', 'feraligatr', 'onix']) for (const c of RUNGS) {
    const { ctx, e, aim } = rungScene(engine, id, true, c);
    const events: SimEvent[] = [];
    let hud: boolean | undefined;
    for (let k = 0; k < 90; k++) {
      events.push(...step(ctx, input(aim, k === 0 ? BTN.basic : 0)));
      if (k === 0) hud = ctx.aim.blocked;
    }
    const cast = events.find((v): v is Extract<SimEvent, { t: 'cast' }> => v.t === 'cast')!;
    const hits = events.filter((v) => v.t === 'hit' && v.enemy === e).length, tag = `${engine} ${id} behind ${c} m`;
    assert.ok(cast?.o?.eye, `${tag}: an eye cast`);
    assert.equal(hud, cast.o!.blocked, `${tag}: HUD ${hud}, shot ${cast.o!.blocked}`);
    assert.equal(hits > 0, !cast.o!.blocked, `${tag}: blocked ${cast.o!.blocked} but ${hits} hits`);
    if (cast.o!.blocked) blocked++; else clear++;
    disposeRun(ctx);
  }
  assert.ok(blocked > 0 && clear > 0, `both outcomes covered (${blocked} blocked, ${clear} clear)`);
});

// ------------------------------------------------------------------------------------------------ CL-Q3: the pull-backs

test('CL-Q3 vertical pull-back: a Tiny under an overhang lower than its eye has its eye under the slab, and cannot see or shoot through it', () => {
  for (const engine of ENGINES) {
    // a deck whose underside is 0.25 m up (over 0.85, the slab 0.6 m) over a 5 × 5 tile patch around Tynamo (eye 0.33 m)
    const { ctx, P } = scene(engine, 'tynamo', true, (W) => { for (let i = 48; i <= 52; i++) for (let j = 48; j <= 52; j++) W.over![K(W, i, j)] = 0.85; });
    const eye = anatomyOf(ctx.player.species, ctx.rules).eye.up;
    assert.ok(eye > 0.25, `Tynamo's eye ${eye} is above the underside`);
    const E = eyePoint(ctx, 0, 1);
    assert.ok(Math.abs(E.y - (0.25 - ctx.rules.aim.eyeGap)) < 1e-3, `${engine}: the eye at ${E.y}, ${ctx.rules.aim.eyeGap} m under the slab`);
    assert.equal(worldOf(ctx).solidAt(E.x, E.y, E.z), 0, `${engine}: the eye is not inside a solid`);
    // an enemy above the deck, 4 m ahead and 2.5 m up: the line from the eye climbs into the slab
    const e = put(ctx, P[0], P[2] + 4, 2.5);
    assert.equal(eyeSeesPoint(ctx, ctx.enemies.x[e], 2.5, ctx.enemies.z[e]), false, `${engine}: the eye does not see through the slab`);
    ctx.input = input(ray([P[0] + 1.25, 6, P[2] - 4.5], [P[0], 2.5, P[2] + 4 - ctx.enemies.radius[e] + 0.02]));
    const out = freshAimState();
    resolveSpatial(ctx, ctx.player.moves[0].spec, out);
    assert.ok(out.eye && Math.abs(out.oy - E.y) < 1e-9, `${engine}: the shot starts at the pulled-down eye`);
    assert.ok(out.blocked, `${engine}: the shot is blocked by the slab`);
    disposeRun(ctx);
  }
});

test('CL-Q3 wall pull-back and the ray heading: a wall between the axis and the eye puts the eye on the axis; a turn-and-shoot uses the crosshair\'s heading, not the facing', () => {
  for (const engine of ENGINES) {
    // Tauros (quadruped, footprint 0.66 m): its eye 0.59 m ahead reaches past a wall face 0.5 m ahead
    const { ctx, P } = scene(engine, 'tauros', true, (W) => { W.map.wall[K(W, 50, 51)] = 1; });
    const an = anatomyOf(ctx.player.species, ctx.rules), foot = partnerFootprint(ctx.player.species, ctx.rules);
    assert.ok(an.eye.fwd > 0.5 && an.eye.fwd <= foot, `Tauros' eye ${an.eye.fwd} m ahead, within its footprint ${foot}`);
    const into = eyePoint(ctx, 0, 1);
    assert.ok(into.x === P[0] && into.z === P[2], `${engine}: facing the wall, the eye is back on the axis`);
    const away = eyePoint(ctx, 0, -1);
    assert.ok(Math.abs(away.z - (P[2] - an.eye.fwd)) < 1e-9, `${engine}: facing away, the eye is ${an.eye.fwd} m ahead`);
    // facing +z (the wall), the crosshair to +x: the eye goes along the ray's heading
    ctx.player.facing = 0;
    ctx.input = input(ray([P[0] - 4.5, 3, P[2]], [P[0] + 10, 1, P[2]]));
    const out = freshAimState();
    resolveSpatial(ctx, ctx.player.moves[0].spec, out);
    assert.ok(Math.abs(out.ox - (P[0] + an.eye.fwd)) < 1e-6 && Math.abs(out.oz - P[2]) < 1e-6, `${engine}: the launch point is ahead along the ray (${out.ox - P[0]}, ${out.oz - P[2]})`);
    disposeRun(ctx);
  }
});

// --------------------------------------------------------------------------------------- CL-Q13: the trace start and D6

test('CL-Q13: a crosshair trace that starts inside a merged box on Rapier puts the aim point beyond the rock; the shot from the eye is blocked by the rock, and the HUD says so', () => {
  for (const engine of ENGINES) {
    // a 3 m block 0.5 to 3.5 m to the partner's right and 1.5 m behind to 2.5 m ahead; the lens above it, the ray passing
    // the eye's plane inside the block, then on to the ground 10 m ahead beyond it
    const { ctx, P } = scene(engine, 'charmander', true, (W) => { for (let i = 51; i <= 53; i++) for (let j = 49; j <= 52; j++) W.map.elev[K(W, i, j)] = 3; });
    const lens: V3 = [P[0] + 2, 4, P[2] - 4], G: V3 = [P[0] + 4, 0, P[2] + 10];
    const inside: V3 = [lens[0] + (G[0] - lens[0]) * (4 / 14), lens[1] + (G[1] - lens[1]) * (4 / 14), P[2]];
    assert.notEqual(worldOf(ctx).solidAt(inside[0], inside[1], inside[2]), 0, `${engine}: the ray passes the eye's plane inside the rock`);
    ctx.input = input(ray(lens, G));
    // the ray is 22° off the facing: the cast winds up (turns) first, so step until it fires
    let cast: Extract<SimEvent, { t: 'cast' }> | undefined, hud = false;
    for (let k = 0; k < 60 && !cast; k++) {
      cast = step(ctx, input(ray(lens, G), k === 0 ? BTN.basic : 0)).find((v): v is Extract<SimEvent, { t: 'cast' }> => v.t === 'cast');
      hud = ctx.aim.blocked;
    }
    assert.ok(cast?.o?.eye, `${engine}: an eye cast`);
    assert.ok(cast!.o!.blocked, `${engine}: the shot from the eye is blocked`);
    assert.equal(hud, cast!.o!.blocked, `${engine}: the HUD agrees`);
    if (engine === 'rapier') assert.ok(cast!.o!.t[2] - P[2] > 2.5, `rapier: the merged box is skipped whole, the aim point ${cast!.o!.t[2] - P[2]} m ahead, beyond the rock`);
    disposeRun(ctx);
  }
});

// ------------------------------------------------------------------------------------------------------ the replay twin

test('range-mewtwo-viewsight takes the eye path (its twin never does) and its hashes differ from the twin\'s', () => {
  const flagged = SCENARIOS.find((s) => s.id === 'range-mewtwo-viewsight')!, twin = SCENARIOS.find((s) => s.id === 'range-mewtwo')!;
  const a = runScenario(flagged), b = runScenario(twin);
  assert.ok(a.coverage!.eyeCasts > 0, `flagged: ${a.coverage!.eyeCasts} casts from the eye`);
  assert.equal(b.coverage!.eyeCasts, 0, 'the twin launches from the muzzle');
  assert.notEqual(a.end, b.end, 'the eye path changed the run');
});
