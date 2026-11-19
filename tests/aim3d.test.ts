// Phase 2B: spatial aim and 3D direct shots (docs/THIRD_PERSON_IMPLEMENTATION.md §13). The camera's crosshair ray
// reaches the sim as InputFrame.aim; the sim traces it (src/sim/aim.ts), launches bolt and orb shots from a size-aware
// muzzle toward the point it meets, and flies them in 3D on src/sim/spatial.ts sweeps (src/sim/effects.ts).
//
// Each scene runs the real sim (step(): moves, projectiles, enemies) on a private flat world copied from the authored
// meadow (as tests/spatial.test.ts does), with nothing spawning and the targets standing still. The crosshair ray is built
// the way the chase camera composes one: a lens behind the Pokémon, raised, and on a shoulder. Where a test says
// "legacy", it runs the same inputs with rules.aim.spatial off: the planar path every older build used, kept for the bot,
// the fixed views and the checksum sets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultRules, type Rules } from '../src/rules/defaults';
import { BIOMES } from '../src/rules/stages';
import { SPECIES } from '../src/rules/species';
import { bodyOf, partnerFootprint, partnerHeight, partnerRadius } from '../src/rules/sizing';
import { World, DECK_SLAB } from '../src/sim/world';
import { createRun, step } from '../src/sim/run';
import { spawnEnemy } from '../src/sim/enemies';
import { spawnBody } from '../src/sim/bodies';
import { compileMove } from '../src/sim/moves';
import { stateHash } from '../src/sim/checksum';
import { projectileSystem } from '../src/sim/effects';
import { PK } from '../src/sim/pools';
import { SK } from '../src/sim/spatial';
import { HEAD, launchHeading, resolveSpatial } from '../src/sim/aim';
import { BTN, NO_INPUT, freshAimState, type InputFrame, type SimContext, type SimEvent } from '../src/sim/types';
import { ChaseRig, chaseAim, lookPitchRange, type AimView } from '../src/render/camera';
import { chaseFrameFor } from '../src/render/chaseinput';
import { aimRayOf } from '../src/render/hostframe';
import type { DeepPartial } from '../src/core/util';

type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V3): V3 => { const L = len(a); return [a[0] / L, a[1] / L, a[2] / L]; };
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const D2R = Math.PI / 180;

/** an authored world whose map is a private flat grass plain at height 0 (decks and walls ready to edit) */
function flatWorld(los: boolean): World {
  const W = new World(defaultRules, BIOMES.meadow, 5);
  const n = W.w * W.h, M = W.map;
  const map = { ...M, terrain: new Uint8Array(n), elev: new Float32Array(n), stairs: new Uint8Array(n), wall: new Uint8Array(n), platform: new Float32Array(n), over: new Float32Array(n), wlevel: undefined };
  Object.assign(W, { map, over: map.over, voids: new Uint8Array(n), los });
  return W;
}
const K = (W: World, i: number, j: number) => j * W.w + i;
const C = (W: World, i: number) => i - W.half + 0.5;

function speciesOf(cls: string): string {
  // the pre-wave roster (no `wave`): the geometry here is tuned to its bodies (a 1.2 m aim height clears a Medium top)
  const sp = SPECIES.filter((s) => !s.wave && bodyOf(s, defaultRules.size).sizeClass === cls && !bodyOf(s, defaultRules.size).authored && !s.flying).map((s) => s.id).sort();
  assert.ok(sp.length, `a ${cls} species`);
  return sp[0];
}

interface Scene { ctx: SimContext; W: World; P: V3 }
/** a run on a private flat world, the partner at the centre of tile (50, 50) facing +z, its only move an Ember (a bolt) */
function scene(opts: { species?: string; los?: boolean; rules?: DeepPartial<Rules>; move?: string } = {}): Scene {
  const ctx = createRun({ seed: 1, species: opts.species ?? 'cyndaquil', ruleOverrides: opts.rules });
  ctx.rules.director.spawnBase = -99;
  const W = flatWorld(opts.los ?? true);
  ctx.world = W;
  ctx.enemies.clear(); ctx.bodies.clear(); ctx.projectiles.clear(); ctx.zones.clear();
  const p = ctx.player;
  p.x = p.px = C(W, 50); p.z = p.pz = C(W, 50); p.y = p.py = 0; p.facing = 0;
  const key = opts.move ?? 'ember';
  p.moves.length = 0;
  p.moves.push({ key, level: 1, cd: 0, spec: compileMove(ctx.rules, key) });
  ctx.grid.rebuild(ctx.enemies.hi, ctx.enemies.x, ctx.enemies.z, ctx.enemies.alive);
  return { ctx, W, P: [p.x, p.y, p.z] };
}

/** an enemy that stands still (speed 0) with its feet at (x, y, z), out of its spawn guard, hp to spare */
function put(ctx: SimContext, x: number, y: number, z: number, cls = 'medium', hover = 0): number {
  const E = ctx.enemies, e = spawnEnemy(ctx, speciesOf(cls), x, z);
  E.x[e] = E.px[e] = x; E.z[e] = E.pz[e] = z; E.y[e] = E.py[e] = y + hover; E.hover[e] = hover;
  E.spawnT[e] = 1; E.hp[e] = E.maxHp[e] = 1e6; E.speed[e] = 0; E.dmg[e] = 0;
  ctx.grid.rebuild(E.hi, E.x, E.z, E.alive);
  return e;
}
/** the centre of enemy e's hurt cylinder */
const centre = (ctx: SimContext, e: number): V3 => [ctx.enemies.x[e], ctx.enemies.y[e] + ctx.enemies.tall[e] / 2, ctx.enemies.z[e]];

/** a chase-camera lens for a partner at P looking at `at`: `back` m behind along the horizontal line P→at, `up` m above
 *  the feet and `side` m on a shoulder (+ right of the view, − left), and the crosshair ray through `at` */
function lens(P: V3, at: V3, side = 1.25, back = 4.5, up = 1.7): { eye: V3; dir: V3; view: AimView } {
  const f = norm([at[0] - P[0], 0, at[2] - P[2]]), right: V3 = [f[2], 0, -f[0]];
  const eye: V3 = [P[0] - f[0] * back + right[0] * side, P[1] + up, P[2] - f[2] * back + right[2] * side];
  const dir = norm(sub(at, eye));
  return { eye, dir, view: { eye, yaw: Math.atan2(dir[0], dir[2]), viewPitch: Math.asin(-dir[1]), fov: 1 } };
}

/** the InputFrame the chase host sends for that lens: the crosshair ray, and the legacy ground point chaseAim gives */
function frame(ctx: SimContext, l: { eye: V3; dir: V3; view: AimView }, btn = 0, extra: Partial<InputFrame> = {}): InputFrame {
  const P = ctx.player;
  const [ax, az] = chaseAim(l.view, P.x, P.z, 16 / 9, (x, z) => ctx.world.height(x, z));
  return { ...NO_INPUT, btn, aimX: ax, aimZ: az, aim: aimRayOf({ eye: l.eye, dir: l.dir }), aimDev: 'mouse', ...extra };
}

interface Log { events: SimEvent[]; ys: number[][] }
/** press primary fire for one tick, keep aiming through `lensAt(tick)` for `ticks` ticks; record every event and the
 *  height of each live player shot per tick */
function fire(ctx: SimContext, lensAt: (k: number) => { eye: V3; dir: V3; view: AimView }, ticks = 90, extra: (k: number) => Partial<InputFrame> = () => ({})): Log {
  const log: Log = { events: [], ys: [] };
  for (let k = 0; k < ticks; k++) {
    log.events.push(...step(ctx, frame(ctx, lensAt(k), k === 0 ? BTN.basic : 0, extra(k))));
    const Pr = ctx.projectiles, ys: number[] = [];
    for (let i = 0; i < Pr.hi; i++) if (Pr.alive[i] && Pr.kind[i] !== PK.hostile) ys.push(Pr.y[i]);
    log.ys.push(ys);
  }
  return log;
}
const hitsOn = (log: Log, e: number) => log.events.filter((v) => v.t === 'hit' && v.enemy === e).length;
const casts = (log: Log) => log.events.filter((v): v is Extract<SimEvent, { t: 'cast' }> => v.t === 'cast');
const ends = (log: Log) => log.events.filter((v): v is Extract<SimEvent, { t: 'shotEnd' }> => v.t === 'shotEnd');
// Phase 3 device assistance (rules.aim.deviceAssist) is part of the newer layer: legacy turns it off too (§6.1 rule 3)
const LEGACY: DeepPartial<Rules> = { aim: { spatial: false, deviceAssist: false } };

// ------------------------------------------------------------------------------------------------ the prior defects

test('planar aim (claim 1, shot-up): a flier hovering 4 m up on the crosshair is hit; legacy flies under it at the shooter\'s height', () => {
  for (const legacy of [false, true]) {
    const { ctx, P } = scene({ rules: legacy ? LEGACY : {} });
    const e = put(ctx, P[0], 0, P[2] + 10, 'medium', 4);
    const at = centre(ctx, e);
    const log = fire(ctx, () => lens(P, at));
    if (legacy) assert.equal(hitsOn(log, e), 0, 'legacy: magnetism finds it, the shot passes 3.9 m under it');
    else assert.ok(hitsOn(log, e) >= 1, 'spatial: the shot climbs to the crosshair and hits');
  }
});

test('hidden magnetism and lead (claim 3): 6.3 deg off the crosshair is a miss on the spatial path; legacy snaps onto it', () => {
  for (const legacy of [false, true]) {
    const { ctx, P } = scene({ rules: legacy ? LEGACY : {} });
    const e = put(ctx, P[0], 0, P[2] + 10);
    // the crosshair 6.3 deg to the side of the enemy (1.1 m at 10 m: more than its radius plus the shot's)
    const a = 6.3 * D2R, at: V3 = [P[0] + Math.sin(a) * 10, ctx.enemies.tall[e] / 2, P[2] + Math.cos(a) * 10];
    const log = fire(ctx, () => lens(P, at, 0));
    if (legacy) assert.ok(hitsOn(log, e) >= 1, 'legacy: bent 6.3 deg onto the enemy');
    else {
      assert.equal(hitsOn(log, e), 0, 'spatial: what you aim at is what you hit');
      const c = casts(log)[0];
      assert.ok(c && c.o, 'a spatial cast reports its origin and aim point');
      // the cast's aim point lies on the crosshair ray (no bend), and the shot flies from the origin to it
      const l = lens(P, at, 0), T: V3 = c.o!.t, off = sub(T, l.eye), perp = len(sub(off, l.dir.map((d) => d * dot(off, l.dir)) as V3));
      assert.ok(perp < 1e-4, `the aim point is ${perp} m off the crosshair ray`);
    }
  }
});

test('shooter-dependent flight height (claim 4, shot-height): a shot keeps its own line while the shooter jumps; legacy rides the jump', () => {
  for (const legacy of [false, true]) {
    for (const los of [false, true]) {
      const series: number[][] = [];
      for (const jump of [false, true]) {
        const { ctx, P } = scene({ los, rules: legacy ? LEGACY : {} });
        const at: V3 = [P[0], 0.9, P[2] + 30];
        const log = fire(ctx, () => lens(P, at), 40, (k) => ({ jump: jump && k >= 6 && k < 9 }));
        series.push(log.ys.map((ys) => ys[0]).filter((y) => y !== undefined));
      }
      const [still, jumped] = series, n = Math.min(still.length, jumped.length);
      assert.ok(n > 20, 'the shot is in flight for the whole window');
      const dev = Math.max(...still.slice(0, n).map((y, k) => Math.abs(y - jumped[k])));
      if (legacy && !los) assert.ok(dev > 1, `legacy, authored map: the shot rose ${dev.toFixed(2)} m with the jump`);
      else if (!legacy) {
        assert.equal(dev, 0, `spatial (${los ? 'location rules' : 'authored'}): the jump moved the shot ${dev} m`);
        // and the flight is a straight line: constant vertical step
        const dy = still.slice(1, n).map((y, k) => y - still[k]);
        assert.ok(Math.max(...dy) - Math.min(...dy) < 1e-4, 'linear in y');
      }
    }
  }
});

test('close-range reticle (parallax): a target 2.5 m ahead on the right-shoulder crosshair is where the shot goes', () => {
  // the lens is 1.25 m to the right; the crosshair runs parallel to the view, so it crosses the rubble 2.5 m ahead,
  // 1.25 m to the side, and meets the ground far behind it. chaseAim eases the shoulder offset over 16 m and clamps
  // the point to at least 4 m out, so the legacy shot leaves for a ground point ~0.35 m to the side
  for (const legacy of [false, true]) {
    const { ctx, P } = scene({ rules: legacy ? LEGACY : {} });
    const right: V3 = [1, 0, 0]; // +z is ahead, so the lens's right is +x (lens(): right = (f.z, 0, -f.x))
    const b = spawnBody(ctx, 'rubble', P[0] + right[0] * 1.25, P[2] + 2.5);
    const eye: V3 = [P[0] + 1.25, 1.7, P[2] - 4.5], far: V3 = [P[0] + 1.25, 0.4, P[2] + 2.5];
    const dir = norm(sub(far, eye));
    const l = { eye, dir, view: { eye, yaw: Math.atan2(dir[0], dir[2]), viewPitch: Math.asin(-dir[1]), fov: 1 } };
    const [ax, az] = chaseAim(l.view, P[0], P[2], 16 / 9, () => 0);
    if (legacy) assert.ok(Math.abs(ax - (P[0] + 1.25)) > 0.8 && az - P[2] >= 4, `legacy aim point ${(ax - P[0]).toFixed(2)} m to the side, ${(az - P[2]).toFixed(2)} m out`);
    const log = fire(ctx, () => l, 30);
    const hit = log.events.filter((v) => v.t === 'bodyHit').length;
    if (legacy) assert.equal(hit, 0, 'legacy: the shot passes beside what the crosshair is on');
    else {
      assert.ok(hit >= 1 || !ctx.bodies.alive[b], 'spatial: the shot hits the rubble under the crosshair');
      assert.equal(ctx.aim.hitKind === SK.body || casts(log)[0].o!.kind === SK.body, true, 'the camera trace met the rubble');
    }
  }
});

// ------------------------------------------------------------------------------------------------ the verification matrix

test('near and far, above and below, stationary: every crosshair target is hit from the muzzle', () => {
  const cases: [string, number, number, number][] = [['near 3 m', 3, 0, 0], ['far 20 m', 20, 0, 0], ['above 3 m', 12, 0, 3], ['below (shooter on a 4 m rise)', 12, -4, 0]];
  for (const [label, d, py, hover] of cases) {
    const { ctx, W, P } = scene();
    if (py < 0) {
      // the shooter stands on a 4 m plateau of 3 x 3 tiles; the target is on the plain below
      for (let i = 49; i <= 51; i++) for (let j = 49; j <= 51; j++) W.map.elev[K(W, i, j)] = 4;
      ctx.player.y = ctx.player.py = 4; P[1] = 4;
    }
    const e = put(ctx, P[0], 0, P[2] + d, 'medium', hover);
    // from the plateau the lens rides higher, as the rig's boom does, or the rim hides the target from it
    const log = fire(ctx, () => lens(P, centre(ctx, e), 1.25, 4.5, py < 0 ? 3.5 : 1.7));
    assert.ok(hitsOn(log, e) >= 1, `${label}: hit`);
  }
});

test('moving target: no automatic lead; the shot flies to the crosshair point of the release tick', () => {
  for (const legacy of [false, true]) {
    const { ctx, P } = scene({ rules: legacy ? LEGACY : {} });
    const e = put(ctx, P[0] - 3, 0, P[2] + 14), E = ctx.enemies;
    const log = fire(ctx, () => lens(P, centre(ctx, e), 0), 12, () => { E.vx[e] = 5; return {}; });
    const Pr = ctx.projectiles;
    let s = -1;
    for (let i = 0; i < Pr.hi; i++) if (Pr.alive[i] && Pr.kind[i] === PK.straight) s = i;
    assert.ok(s >= 0, 'the shot is in flight');
    const v = norm([Pr.vx[s], Pr.vy[s], Pr.vz[s]]);
    const c = casts(log)[0];
    if (legacy) {
      const aimYaw = Math.atan2(c.tx - P[0], c.tz - P[2]), shotYaw = Math.atan2(v[0], v[2]);
      assert.ok(Math.abs(shotYaw - aimYaw) > 0.5 * D2R, `legacy leads by ${((shotYaw - aimYaw) / D2R).toFixed(2)} deg`);
    } else {
      const want = norm(sub(c.o!.t, c.o!.o));
      assert.ok(dot(v, want) > 1 - 1e-9, 'spatial: straight from the muzzle to the crosshair point');
    }
  }
});

test('empty space: a crosshair on the sky fires along the ray, and the shot ends at its own range from the muzzle', () => {
  const { ctx, P } = scene();
  const at: V3 = [P[0], 6, P[2] + 20];
  const log = fire(ctx, () => lens(P, at), 120);
  const c = casts(log)[0], end = ends(log)[0];
  assert.ok(c && c.o, 'it fired with nothing under the crosshair');
  assert.equal(c.o!.kind, 0, 'the camera trace met nothing');
  const spec = ctx.player.moves[0].spec, reach = spec.range * ctx.rules.aim.reachMult + spec.speed * ctx.rules.aim.reachPad;
  assert.ok(end && end.why === 'range', 'it ran out of range');
  const flown = len(sub([end.x, end.y, end.z], c.o!.o));
  assert.ok(Math.abs(flown - reach) < 1e-3, `it flew ${flown.toFixed(4)} m of its ${reach} m reach (not the camera's ${ctx.rules.aim.sightRange} m sight)`);
  // the aim point is far out along the ray; the shot never got there
  assert.ok(len(sub(c.o!.t, c.o!.o)) > reach + 10);
});

test('range from the origin: a target past the reach is not hit, one just inside it is', () => {
  for (const [margin, want] of [[-0.3, true], [0.3, false]] as [number, boolean][]) {
    const { ctx, P } = scene();
    const sp = ctx.player.moves[0].spec, reach = sp.range * ctx.rules.aim.reachMult + sp.speed * ctx.rules.aim.reachPad;
    const fwd = partnerFootprint(ctx.player.species, ctx.rules) * ctx.rules.aim.muzzle.fwd;
    const probe = put(ctx, P[0], 0, P[2] + 40, 'medium'), r = ctx.enemies.radius[probe];
    ctx.enemies.kill(probe); // only its radius was wanted
    // the shot first touches an enemy whose centre is reach + its radius + the shot's radius from the muzzle
    const d = fwd + reach + r + sp.radius + margin;
    const e = put(ctx, P[0], 0, P[2] + d, 'medium');
    const log = fire(ctx, () => lens(P, centre(ctx, e), 0), 120);
    assert.equal(hitsOn(log, e) > 0, want, `${d.toFixed(2)} m (${margin > 0 ? 'past' : 'inside'} the ${reach} m reach): ${want ? 'hit' : 'out of range'}`);
  }
});

test('both shoulders, three body sizes, and in the air: the origin is the body\'s muzzle and the shot meets the crosshair', () => {
  const heights: number[] = [];
  for (const cls of ['tiny', 'medium', 'xl']) {
    for (const side of [1.25, -1.25]) {
      for (const air of [false, true]) {
        const { ctx, P } = scene({ species: speciesOf(cls) });
        const e = put(ctx, P[0] + 1.5, 0, P[2] + 12);
        const log = fire(ctx, () => lens(P, centre(ctx, e), side), 60, (k) => ({ jump: air && k === 0 }));
        const c = casts(log)[0];
        assert.ok(c && c.o, `${cls} ${side}: cast`);
        assert.ok(hitsOn(log, e) >= 1, `${cls}, shoulder ${side}${air ? ', jumping' : ''}: hit`);
        const sp = ctx.player.species, R = ctx.rules, M = R.aim.muzzle;
        const up = partnerHeight(sp, R) * M.up, fwd = (partnerFootprint(sp, R) || partnerRadius(sp, R)) * M.fwd;
        // the origin is the muzzle of the body where it was at the release tick, on the aim's heading
        const o = c.o!.o, py = o[1] - up;
        assert.ok(Math.abs(Math.hypot(o[0] - c.x, o[2] - c.z) - fwd) < 1e-4, `${cls}: muzzle ${fwd.toFixed(3)} m ahead`);
        if (air) assert.ok(py > 0.2, `${cls}: launched from the body in the air (feet at ${py.toFixed(2)} m)`);
        else { assert.ok(Math.abs(py) < 1e-4, `${cls}: muzzle ${up.toFixed(2)} m above the feet`); if (side > 0) heights.push(up); }
      }
    }
  }
  assert.ok(heights[0] < heights[1] && heights[1] < heights[2], `muzzle height grows with the size class: ${heights.map((h) => h.toFixed(2))}`);
});

test('obstruction at the muzzle: the lens sees past a wall the shot cannot pass; the reticle says blocked and the shot stops on the wall', () => {
  const { ctx, W, P } = scene();
  // a wall tile 1 m ahead of the partner, from 0.5 m left of it to its right edge 0.5 m right of it
  W.map.wall[K(W, 50, 51)] = 1;
  const e = put(ctx, P[0] + 1.9, 0, P[2] + 10);
  const l = lens(P, centre(ctx, e), 1.25);
  const log = fire(ctx, () => l, 40);
  assert.equal(hitsOn(log, e), 0, 'the shot never reaches the enemy');
  const c = casts(log)[0], end = ends(log)[0];
  assert.equal(c.o!.kind, SK.enemy, 'the camera sees the enemy');
  assert.ok(c.o!.blocked, 'and the cast knows the muzzle cannot');
  assert.ok(end && end.why === 'world' && end.kind === SK.wall, 'the shot ended on the wall');
  assert.ok(Math.abs(end.z - (C(W, 51) - 0.5)) < 1e-3, `on its near face (z ${end.z.toFixed(4)})`);
  // the per-tick aim state the HUD reads says the same, with the obstruction point
  assert.ok(ctx.aim.on && ctx.aim.blocked && ctx.aim.blockKind === SK.wall);
  assert.ok(Math.abs(ctx.aim.bz - (C(W, 51) - 0.5)) < 1e-3);
});

test('a rock between muzzle and target takes the shot first (contact order), and pierce goes on to the target', () => {
  const { ctx, P } = scene({ move: 'ember' });
  const e = put(ctx, P[0], 0, P[2] + 12);
  spawnBody(ctx, 'rubble', P[0], P[2] + 5);
  const log = fire(ctx, () => lens(P, centre(ctx, e), 0), 60);
  const first = log.events.find((v) => v.t === 'bodyHit' || (v.t === 'hit' && v.enemy === e));
  assert.equal(first?.t, 'bodyHit', 'the rubble is met first');
  assert.ok(hitsOn(log, e) >= 1, 'Ember pierces 2: it goes on to the enemy');
});

test('decks: the underside stops a shot from below, the underpass lets one through, the top stops one from above', () => {
  // a deck over tiles (46..54, 53..60): top 3 m, underside 2.4 m; its near edge is 2.5 m ahead of the partner
  const deck = (W: World) => { for (let i = 46; i <= 54; i++) for (let j = 53; j <= 60; j++) W.over![K(W, i, j)] = 3; };
  {
    const { ctx, W, P } = scene();
    deck(W);
    // the crosshair passes under the edge and rises into the underside 7 m out
    const log = fire(ctx, () => lens(P, [P[0], 2.5, P[2] + 8], 0, 4.5, 1.2), 40);
    const end = ends(log)[0];
    assert.ok(end && end.kind === SK.deck && Math.abs(end.y - (3 - DECK_SLAB)) < 1e-3, `from below: stops at the underside (${end?.y})`);
  }
  {
    const { ctx, W, P } = scene();
    deck(W);
    const e = put(ctx, P[0], 0, P[2] + 9);
    const log = fire(ctx, () => lens(P, centre(ctx, e), 0, 3, 1.2), 60);
    assert.ok(hitsOn(log, e) >= 1, 'through the underpass (the shot stays under 2.4 m)');
  }
  {
    const { ctx, W, P } = scene();
    deck(W);
    // the partner stands on the deck top 2.5 m from its far edge; an enemy stands on the ground under the deck, another
    // 9.5 m past the edge (the lens rides high enough to see over it, and the muzzle's line clears it too)
    ctx.player.z = ctx.player.pz = C(W, 58); ctx.player.y = ctx.player.py = 3; P[2] = ctx.player.z; P[1] = 3;
    const under = put(ctx, P[0], 0, P[2] + 1.5), beyond = put(ctx, P[0], 0, P[2] + 12);
    const a = fire(ctx, () => lens(P, centre(ctx, under), 0, 4.5, 2)), endA = ends(a)[0];
    assert.equal(hitsOn(a, under), 0, 'the deck top is between');
    assert.ok(endA && endA.kind === SK.deck, 'the shot ends on the deck');
    const b = fire(ctx, () => lens(P, centre(ctx, beyond), 0, 4.5, 3.5), 60);
    assert.ok(hitsOn(b, beyond) >= 1, 'beyond the edge: hit');
  }
});

test('fast shots do not tunnel: a 120 m/s bolt (2 m per tick) meets a Tiny body it passes between two ticks', () => {
  const { ctx, P } = scene();
  ctx.player.moves[0].spec = { ...ctx.player.moves[0].spec, speed: 120 };
  // a Tiny body just inside the shot's reach of the line, centred between two tick ends
  const e = put(ctx, P[0], 0, P[2] + 13, 'tiny');
  const E = ctx.enemies;
  E.x[e] = E.px[e] = P[0] + E.radius[e] + ctx.player.moves[0].spec.radius - 0.02;
  ctx.grid.rebuild(E.hi, E.x, E.z, E.alive);
  const log = fire(ctx, () => lens(P, [P[0], 0.36, P[2] + 30], 0), 30);
  assert.ok(hitsOn(log, e) >= 1, 'hit');
});

test('an enemy moved far after the grid rebuild (a relocation) is still met by a shot that tick', () => {
  const { ctx, W, P } = scene();
  const e = put(ctx, P[0] + 30, 0, P[2] - 20, 'tiny'), E = ctx.enemies;
  // the rebuild saw it 36 m away; it is then moved onto the shot's path, 9 m ahead (enemies.ts relocates this way)
  E.x[e] = E.px[e] = P[0]; E.z[e] = E.pz[e] = P[2] + 9;
  const Pr = ctx.projectiles, i = Pr.spawn();
  Pr.kind[i] = PK.straight; Pr.traj[i] = 1; Pr.x[i] = P[0]; Pr.y[i] = E.tall[e] / 2; Pr.z[i] = P[2] + 8.5;
  Pr.vx[i] = 0; Pr.vy[i] = 0; Pr.vz[i] = 60; Pr.speed[i] = 60; Pr.rem[i] = 20; Pr.life[i] = Pr.maxLife[i] = 1;
  Pr.dmg[i] = 1; Pr.radius[i] = 0.1; Pr.pierce[i] = 0; Pr.move[i] = 0;
  projectileSystem.update(ctx, 1 / 60);
  assert.ok(E.hp[e] < E.maxHp[e], 'the stray is tested where it is now');
  void W;
});

test('flag off, or no aim ray: the sim takes the legacy planar path exactly (replay hashes cannot move)', () => {
  const runs: number[][] = [];
  for (const [rules, withRay] of [[LEGACY, true], [LEGACY, false], [{}, false]] as [DeepPartial<Rules>, boolean][]) {
    const { ctx, P } = scene({ rules });
    const e = put(ctx, P[0] + 2, 0, P[2] + 9);
    const hs: number[] = [];
    for (let k = 0; k < 120; k++) {
      const l = lens(P, centre(ctx, e), 1.25);
      const inp = frame(ctx, l, k % 20 === 0 ? BTN.basic : 0);
      if (!withRay) { delete inp.aim; delete inp.aimDev; }
      step(ctx, inp);
      hs.push(stateHash(ctx));
      assert.equal(ctx.aim.on, false, 'no spatial aim state');
    }
    runs.push(hs);
  }
  assert.deepEqual(runs[0], runs[1], 'flag off: a ray in the input changes nothing');
  assert.deepEqual(runs[1], runs[2], 'flag on, no ray (bot, fixed views): the legacy path');
});

test('determinism: the same aim rays replay to the same state, tick for tick', () => {
  const hashes: number[][] = [];
  for (let r = 0; r < 2; r++) {
    const { ctx, P } = scene();
    put(ctx, P[0] + 2, 0, P[2] + 9); put(ctx, P[0] - 4, 0, P[2] + 14, 'tiny', 2.5); put(ctx, P[0] + 6, 0, P[2] + 6, 'xl');
    const hs: number[] = [];
    for (let k = 0; k < 240; k++) {
      const a = k * 0.013, at: V3 = [P[0] + Math.sin(a) * 12, 0.5 + (k % 40) * 0.05, P[2] + Math.cos(a) * 12];
      step(ctx, frame(ctx, lens(P, at, k < 120 ? 1.25 : -1.25), k % 9 === 0 ? BTN.basic : 0, { mx: k > 100 ? 0.5 : 0, jump: k % 50 === 10 }));
      const Pr = ctx.projectiles;
      let h = stateHash(ctx);
      for (let i = 0; i < Pr.hi; i++) if (Pr.alive[i]) h = (Math.imul(h, 31) + Math.round(Pr.x[i] * 1e4) + Math.round(Pr.y[i] * 1e4) * 7 + Math.round(Pr.z[i] * 1e4) * 13) | 0;
      hs.push(h);
    }
    hashes.push(hs);
  }
  assert.deepEqual(hashes[0], hashes[1]);
});

test('the host adapter: the crosshair ray of a real ChaseRig sample, quantised; a shot on it hits what the rig looks at', () => {
  const { ctx, P } = scene();
  // the rig settled behind the partner as the renderer drives it (its own probes and size-class framing)
  const rig = new ChaseRig();
  rig.snapTo(P[0], P[1], P[2], 0);
  for (let f = 0; f < 120; f++) rig.update(chaseFrameFor(ctx, { dt: 1 / 60, x: P[0], y: P[1], z: P[2], lookPitch: 0 }), { pitchRange: lookPitchRange(), fovOffset: 0 });
  const v = rig.sample(1280, 720), ray = aimRayOf(v);
  for (const [k, want] of [['ox', v.eye[0]], ['oy', v.eye[1]], ['oz', v.eye[2]], ['dx', v.dir[0]], ['dy', v.dir[1]], ['dz', v.dir[2]]] as [keyof typeof ray, number][]) {
    assert.equal(ray[k], Math.fround(want), `${k} is the sample's, through Math.fround`);
  }
  // an enemy on that ray, 8 m from the lens (the neutral crosshair meets level ground ~11 m out from the close lens)
  const t = 8, at: V3 = [v.eye[0] + v.dir[0] * t, v.eye[1] + v.dir[1] * t, v.eye[2] + v.dir[2] * t];
  const e = put(ctx, at[0], Math.max(0, at[1] - 0.6), at[2]);
  let hit = 0;
  for (let k = 0; k < 60; k++) for (const ev of step(ctx, { ...NO_INPUT, btn: k === 0 ? BTN.basic : 0, aim: ray, aimDev: 'mouse', aimX: at[0], aimZ: at[2] })) if (ev.t === 'hit' && ev.enemy === e) hit++;
  assert.ok(hit >= 1);
});

// ------------------------------------------------------------------------------------------------ R2: pole-safe aim maths
// docs/THIRD_PERSON_IMPLEMENTATION.md §18, audit F6 / F7 (rules.aim.poleSafe). The camera still stops at 60° up / 50°
// down (R3 widens it), but the sim takes any ray, so these build rays of any pitch directly. Pitch sign is the camera's:
// + = down.
const POLE_OFF: DeepPartial<Rules> = { aim: { poleSafe: false } };
/** the unit direction of a crosshair ray at pitch `p` (+ down) and yaw `y` (0 = +z), degrees */
function dirAt(p: number, y = 0): V3 {
  const pr = p * D2R, yr = y * D2R;
  return [Math.sin(yr) * Math.cos(pr), -Math.sin(pr), Math.cos(yr) * Math.cos(pr)];
}
/** the expected horizontal muzzle offset at ray pitch p: the full fwd up to rules.aim.muzzleFadeDeg, then linear in the
 *  ray's horizontal fraction down to 0 at the pole */
function fadeOffset(ctx: SimContext, p: number): number {
  const R = ctx.rules, sp = ctx.player.species;
  const fwd = (partnerFootprint(sp, R) || partnerRadius(sp, R)) * R.aim.muzzle.fwd;
  return fwd * Math.min(1, Math.cos(p * D2R) / Math.cos(R.aim.muzzleFadeDeg * D2R));
}
/** resolve the spatial aim of the partner's first move for a ray along d through its chest from 4 m back (the sim's
 *  own resolveSpatial, nothing stepped) */
function resolveAlong(ctx: SimContext, d: V3, out = freshAimState()) {
  const P = ctx.player, cy = P.y + partnerHeight(P.species, ctx.rules) * ctx.rules.aim.muzzle.up;
  ctx.input = { ...NO_INPUT, aim: { ox: P.x - d[0] * 4, oy: cy - d[1] * 4, oz: P.z - d[2] * 4, dx: d[0], dy: d[1], dz: d[2] } };
  assert.ok(resolveSpatial(ctx, P.moves[0].spec, out));
  return out;
}

test('R2 (T2): the muzzle is continuous over ±89.99° and through both poles; pre-R2 it jumped to the facing', () => {
  for (const cls of ['tiny', 'xl']) {
    const sc = scene({ species: speciesOf(cls) }), old = scene({ species: speciesOf(cls), rules: POLE_OFF });
    // the partner faces +x while the camera looks along +z: the case where the pre-R2 fallback moved the muzzle
    sc.ctx.player.facing = old.ctx.player.facing = Math.PI / 2;
    let prev: V3 | null = null, worst = 0;
    for (let k = -8999; k <= 8999; k++) {
      const o = resolveAlong(sc.ctx, dirAt(k / 100)), m: V3 = [o.ox, o.oy, o.oz];
      if (prev) worst = Math.max(worst, len(sub(m, prev)));
      prev = m;
    }
    assert.ok(worst < 0.01, `${cls}: largest muzzle step per 0.01° over ±89.99° ${(worst * 100).toFixed(3)} cm`);
    // over the top and under the bottom: 89.9° → 90° → 89.9° on the far side, in 0.001° steps
    for (const sgn of [1, -1]) {
      let pm: V3 | null = null, pu: V3 | null = null, wm = 0, wu = 0;
      for (let k = 0; k <= 200; k++) {
        const th = (89.9 + k / 1000) * D2R, d: V3 = [0, sgn * Math.sin(th), Math.cos(th)];
        const o = resolveAlong(sc.ctx, d), m: V3 = [o.ox, o.oy, o.oz], u: V3 = [o.ux, o.uy, o.uz];
        if (pm && pu) { wm = Math.max(wm, len(sub(m, pm))); wu = Math.max(wu, Math.acos(Math.min(1, dot(u, pu))) / D2R); }
        pm = m; pu = u;
        if (k === 100) {
          const P = sc.ctx.player;
          assert.ok(Math.hypot(o.ox - P.x, o.oz - P.z) < 1e-9, `${cls} ${sgn > 0 ? 'up' : 'down'}: at the pole the muzzle is on the body's axis`);
        }
      }
      assert.ok(wm < 1e-3, `${cls} ${sgn > 0 ? 'up' : 'down'}: muzzle step through the pole ${(wm * 1000).toFixed(3)} mm per 0.001°`);
      assert.ok(wu < 0.01, `${cls} ${sgn > 0 ? 'up' : 'down'}: launch turns ${wu.toFixed(4)}° per 0.001° through the pole`);
    }
    // the defect, flag off: 89.99° up, then exactly up (the facing takes over)
    const a = resolveAlong(old.ctx, dirAt(-89.99)), b = resolveAlong(old.ctx, [0, 1, 0]);
    const jump = Math.hypot(a.ox - b.ox, a.oz - b.oz);
    if (cls === 'xl') assert.ok(jump > 0.5, `pre-R2: the muzzle jumped ${jump.toFixed(3)} m at the pole`);
  }
});

test('R2: inside today\'s envelope (60° up to 50° down) the muzzle and launch are the pre-R2 ones exactly; past the fade pitch the offset shrinks to 0', () => {
  for (const cls of ['tiny', 'medium', 'xl']) {
    const sc = scene({ species: speciesOf(cls) }), old = scene({ species: speciesOf(cls), rules: POLE_OFF });
    for (let p = -59.5; p <= 50; p += 0.5) for (const y of [0, 37, 133, -101]) {
      const a = resolveAlong(sc.ctx, dirAt(p, y)), b = resolveAlong(old.ctx, dirAt(p, y));
      assert.deepEqual([a.ox, a.oy, a.oz, a.ux, a.uy, a.uz, a.tx, a.ty, a.tz], [b.ox, b.oy, b.oz, b.ux, b.uy, b.uz, b.tx, b.ty, b.tz], `${cls} pitch ${p} yaw ${y}`);
    }
    for (const p of [-89, -80, -70, 70, 80, 89]) {
      const o = resolveAlong(sc.ctx, dirAt(p, 20)), P = sc.ctx.player, want = fadeOffset(sc.ctx, p);
      assert.ok(Math.abs(Math.hypot(o.ox - P.x, o.oz - P.z) - want) < 1e-9, `${cls} ${p}°: offset ${want.toFixed(4)} m`);
    }
  }
});

test('R2 (T1): Tiny, Medium and XL, both shoulders, pitch 89° up to 89° down: the bolt leaves the class muzzle and hits the crosshair target', () => {
  for (const cls of ['tiny', 'medium', 'xl']) for (const side of [1.25, -1.25]) for (const p of [-89, -60, 0, 50, 89]) {
    const { ctx } = scene({ species: speciesOf(cls) });
    const P = ctx.player, R = ctx.rules;
    // looking down from the air (12 m up) so there is something below to aim at; looking level or up from the ground
    if (p > 0) { P.y = P.py = 12; P.vy = 0; }
    const up = partnerHeight(P.species, R) * R.aim.muzzle.up, d = dirAt(p);
    const chest: V3 = [P.x, P.y + up, P.z];
    // the target 10 m along the ray from the chest plane, on the shoulder's side; the lens 4.5 m back along the ray (under
    // the ground for the steep up-looks: the sim traces from the chest plane, so only the ray matters)
    const at: V3 = [chest[0] + d[0] * 10 + side, chest[1] + d[1] * 10, chest[2] + d[2] * 10];
    const e = put(ctx, at[0], 0, at[2], 'tiny', 0);
    ctx.enemies.y[e] = ctx.enemies.py[e] = at[1] - ctx.enemies.tall[e] / 2; ctx.enemies.hover[e] = ctx.enemies.y[e];
    const eye: V3 = [at[0] - d[0] * 14.5, at[1] - d[1] * 14.5, at[2] - d[2] * 14.5];
    const l = { eye, dir: d, view: { eye, yaw: 0, viewPitch: p * D2R, fov: 1 } as AimView };
    const log = fire(ctx, () => l, 60);
    const c = casts(log)[0], tag = `${cls} shoulder ${side} pitch ${p}`;
    assert.ok(c && c.o, `${tag}: cast`);
    const o = c.o!.o, off = Math.hypot(o[0] - c.x, o[2] - c.z);
    assert.ok(Math.abs(off - fadeOffset(ctx, p)) < 1e-4, `${tag}: muzzle ${off.toFixed(4)} m ahead (want ${fadeOffset(ctx, p).toFixed(4)})`);
    assert.ok(off < 1e-6 || (o[2] - c.z) > 0, `${tag}: on the ray's heading`);
    // (in the air the partner has fallen a little by the release tick)
    const feet = o[1] - up;
    assert.ok(p > 0 ? feet > 11 && feet <= 12 : Math.abs(feet) < 1e-4, `${tag}: ${up.toFixed(2)} m above the feet (${feet.toFixed(3)})`);
    assert.equal(c.o!.kind, SK.enemy, `${tag}: the crosshair is on the target`);
    assert.ok(hitsOn(log, e) >= 1, `${tag}: hit`);
  }
});

test('R2 (T3): a 4-shot fan keeps its outer angle at 0, 45, 80 and 89° up and down; pre-R2 it closed toward the pole', () => {
  /** the angle (deg) of the outermost shots from the fan's bisector, for a 4-shot Ember fired along pitch p into the sky
   *  (up) or from 30 m up toward the ground (down), the lens on the line through the chest (so level is level) */
  function outer(rules: DeepPartial<Rules>, p: number): number {
    const { ctx } = scene({ rules });
    const P = ctx.player, sp = P.moves[0].spec;
    P.moves[0].spec = { ...sp, count: 4 };
    if (p > 0) { P.y = P.py = 30; P.vy = 0; }
    const d = dirAt(p);
    const Pr = ctx.projectiles, v: V3[] = [];
    // hold fire until the release tick spawns the fan (the lens follows the falling partner when looking down)
    for (let k = 0; k < 60 && !v.length; k++) {
      const cy = P.y + partnerHeight(P.species, ctx.rules) * ctx.rules.aim.muzzle.up, eye: V3 = [P.x - d[0] * 4.5, cy - d[1] * 4.5, P.z - d[2] * 4.5];
      step(ctx, frame(ctx, { eye, dir: d, view: { eye, yaw: 0, viewPitch: p * D2R, fov: 1 } }, BTN.basic));
      for (let i = 0; i < Pr.hi; i++) if (Pr.alive[i] && Pr.kind[i] !== PK.hostile) v.push(norm([Pr.vx[i], Pr.vy[i], Pr.vz[i]]));
    }
    assert.equal(v.length, 4, `pitch ${p}: four shots`);
    let best = 0;
    for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) best = Math.max(best, Math.acos(Math.min(1, dot(v[a], v[b]))));
    return best / 2 / D2R;
  }
  const level = outer({}, 0);
  assert.ok(level > 5, `level fan outer angle ${level.toFixed(2)}°`);
  for (const p of [45, 80, 89, -45, -80, -89]) {
    const a = outer({}, p);
    assert.ok(Math.abs(a - level) < 0.5, `pitch ${p}: outer angle ${a.toFixed(2)}° (level ${level.toFixed(2)}°)`);
  }
  assert.ok(Math.abs(outer(POLE_OFF, 0) - level) < 1e-6, 'level: the pre-R2 fan exactly');
  const shut = outer(POLE_OFF, -80);
  assert.ok(shut < level / 3, `pre-R2 at 80° up: ${shut.toFixed(2)}° (the defect)`);
});

test('R2: a launch straight up or down takes the crosshair ray\'s heading for the planar side, not the facing', () => {
  const { ctx } = scene(), old = scene({ rules: POLE_OFF }).ctx;
  for (const c of [ctx, old]) {
    c.player.facing = Math.PI / 2; // facing +x
    c.input = { ...NO_INPUT, aim: { ox: 0, oy: 0, oz: 0, dx: -0.6, dy: 0.8, dz: 0 } }; // the ray looks steeply up toward −x
  }
  launchHeading(ctx, 0, 0);
  assert.ok(Math.abs(HEAD.x + 1) < 1e-12 && Math.abs(HEAD.z) < 1e-12, `R2: the ray's heading (${HEAD.x}, ${HEAD.z})`);
  launchHeading(ctx, 0.3, -0.4);
  assert.ok(Math.abs(HEAD.x - 0.6) < 1e-12 && Math.abs(HEAD.z + 0.8) < 1e-12, 'a launch with a horizontal part keeps its own heading');
  launchHeading(old, 0, 0);
  assert.ok(Math.abs(HEAD.x - 1) < 1e-12, 'pre-R2: the facing');
  // a ray that is itself vertical (never sent by the clamped camera) leaves only the facing
  ctx.input = { ...NO_INPUT, aim: { ox: 0, oy: 0, oz: 0, dx: 0, dy: 1, dz: 0 } };
  launchHeading(ctx, 0, 0);
  assert.ok(Math.abs(HEAD.x - 1) < 1e-12, 'a vertical ray: the facing');
});
