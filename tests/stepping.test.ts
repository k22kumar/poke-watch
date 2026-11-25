// The step rule on the character controller (task I1b; docs/LOCOMOTION.md "Resolvers", docs/spikes/S1-physics.md §7
// "Steps", owner O4, ROADMAP F34): with rules.physics.engine = 'rapier' a partner's body climbs every rise up to
// rules.player.stepHeight (0.6 m) for every size class at 0.5 to 9 m/s, head-on and at 45°, and refuses 0.62 m and
// above. The matrices are S1's stepmatrix.ts, stepcap.ts and manualstep.ts on the real path: a tile World whose map is
// a flat plain with a raised half, the adapter's colliders, the shared locomotion step. Crease stalls (risk R13: the
// controller returning no movement at a concave crease) are counted on every climb and on the range's stair flight.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import './setup/physics';
import { defaultRules, type Rules } from '../src/rules/defaults';
import { deepMerge } from '../src/core/util';
import { BIOMES } from '../src/rules/stages';
import { World } from '../src/sim/world';
import { createRun, disposeRun, step } from '../src/sim/run';
import { NO_INPUT } from '../src/sim/types';
import { capsuleOf } from '../src/physics/controller';
import { STOPS } from '../src/physics/world';
import { QF, RayHit, SK_WORLD } from '../src/world/sight';
import { LOCO, MEDIUM, mediumAt, selectIntegrator, stepBallistic, stepSupported, type LocoBody, type LocoTick } from '../src/sim/locomotion';
import { T, WATER_Y } from '../src/world/tiles';
import { gorge, inAndOut } from '../scripts/hazplay';

const rules = deepMerge(defaultRules, { physics: { engine: 'rapier' } } as never) as Rules;
const R = rules.player, DT = 1 / 60, C = rules.physics.controller;
const SPEEDS = [0.5, 1, 2, 4, 6, 9], ANGLES = [0, 45];
const CLIMB = [0.3, 0.5, 0.55, 0.6], REFUSE = [0.62, 0.65, 0.8];

/** a flat plain at 0 whose tiles from x = 0 east are raised by `rise` (map arrays private to this World) */
function stepWorld(rise: number, over?: (W: World, map: { over?: Float32Array }) => void, with_: Rules = rules): World {
  const W = new World(with_, BIOMES.meadow, 5);
  const n = W.w * W.h, M = W.map;
  const map = { ...M, terrain: new Uint8Array(n), elev: new Float32Array(n), stairs: new Uint8Array(n), wall: new Uint8Array(n), platform: new Float32Array(n), over: undefined as Float32Array | undefined, wlevel: undefined };
  Object.assign(W, { map, over: undefined, voids: new Uint8Array(n) });
  for (let k = 0; k < n; k++) if ((k % W.w) - W.half >= 0) map.elev[k] = rise;
  over?.(W, map);
  return W;
}
const body = (x: number, y = 0): LocoBody => ({ x, y, z: 0, vx: 0, vy: 0, vz: 0, kx: 0, kz: 0, grounded: true, ctl: { buffer: 0, coyote: 0, airSpent: false } });
const tickFor = (foot: number, speed: number, tall?: number): LocoTick => ({ speed, stance: 1, footSpeed: 1, grip: 1, canJump: true, lift: false, airPress: 'none', stepUp: R.stepHeight, foot, tall, height: tall ?? rules.size.classes.reduce((a, c) => (Math.abs(c.body - foot) < Math.abs(a.body - foot) ? c : a)).height, wide: false });

/** walk a class body at `speed` toward the face at x = 0 from 1 m short of it, at `deg` off its normal; did it end on top,
 *  and the longest run of supported ticks it moved less than 0.1 mm (a stall) */
function approach(W: World, foot: number, speed: number, deg: number, rise: number): { top: boolean; stall: number; steps: number } {
  const a = (deg * Math.PI) / 180, ux = Math.cos(a), uz = Math.sin(a);
  const b = body(-foot - 1), t = tickFor(foot, speed), out = { jumped: false };
  const ticks = Math.round((2.2 + foot) / (speed * ux) / DT) + 60;
  let run = 0, stall = 0, top = false, climbed = false;
  const st0 = W.physics!.worldFor(W).characterStats?.steps ?? 0;
  for (let s = 0; s < ticks; s++) {
    const x0 = b.x, z0 = b.z, it = { mx: ux, mz: uz, jump: false };
    if (selectIntegrator(false, b.grounded) === LOCO.supported) stepSupported(W, b, it, t, R, DT, out);
    else stepBallistic(W, b, it, t, R, DT, out);
    // a stall: supported, wishing, not moving, before it is on top (pressing a face it refuses is no stall)
    if (!climbed && b.grounded && Math.hypot(b.x - x0, b.z - z0) < 1e-4) { run++; stall = Math.max(stall, run); } else run = 0;
    if (b.x > 0.02 && b.y > rise - 0.005) top = climbed = true;
  }
  return { top, stall, steps: (W.physics!.worldFor(W).characterStats?.steps ?? 0) - st0 };
}

test('capsules per size class (S1 §8): radius footprint − offset, the 1 mm head margin, Tiny a ball with none', () => {
  for (const c of rules.size.classes) {
    const k = capsuleOf(c.body, c.height, C.offset, C.headMargin);
    assert.ok(Math.abs(k.radius - (c.body - C.offset)) < 1e-12, `${c.id} radius`);
    const top = k.lift + k.half + k.radius + C.offset; // the envelope's top above the feet
    if (c.id === 'tiny') {
      assert.equal(k.half, 0, 'Tiny is a ball');
      assert.ok(Math.abs(top - c.height) < 1e-12, 'Tiny fills its 0.6 m: no head margin (S1 review finding 5)');
    } else {
      assert.ok(k.half > 0, `${c.id} has a cylinder part`);
      assert.ok(Math.abs(top - (c.height - C.headMargin)) < 1e-12, `${c.id}: the head stops 1 mm under its height`);
    }
  }
  // S1 §8's half-heights
  const half = Object.fromEntries(rules.size.classes.map((c) => [c.id, +capsuleOf(c.body, c.height, C.offset, C.headMargin).half.toFixed(4)]));
  assert.deepEqual(half, { tiny: 0, small: 0.0495, medium: 0.1395, large: 0.1895, xl: 0.3195 });
});

test('step matrix: every class climbs 0.3, 0.5, 0.55 and 0.6 m at 0.5–9 m/s, head-on and at 45° (S1 O4)', () => {
  const lines: string[] = [];
  let worst = 0, misses = 0;
  for (const rise of CLIMB) {
    const W = stepWorld(rise);
    for (const c of rules.size.classes) {
      const row = ANGLES.map((deg) => SPEEDS.map((sp) => {
        const r = approach(W, c.body, sp, deg, rise);
        worst = Math.max(worst, r.stall);
        if (!r.top) misses++;
        return r.top ? '#' : '.';
      }).join('')).join(' | ');
      lines.push(`${rise.toFixed(2)} ${c.id.padEnd(6)} ${row}`);
    }
    W.physics!.dispose();
  }
  console.log(`climbs (speeds ${SPEEDS.join('/')} m/s, head-on | 45°; # on top):\n${lines.join('\n')}\nlongest crease stall before the top: ${worst} ticks`);
  assert.equal(misses, 0, `${misses} approaches did not get on top`);
  assert.ok(worst <= 3, `a climb stalled ${worst} ticks at the face (R13)`);
});

test('step matrix: every class refuses 0.62, 0.65 and 0.8 m at every speed and angle (no over-climb, S1 F34)', () => {
  const lines: string[] = [];
  let climbed = 0;
  for (const rise of REFUSE) {
    const W = stepWorld(rise);
    for (const c of rules.size.classes) {
      const row = ANGLES.map((deg) => SPEEDS.map((sp) => { const r = approach(W, c.body, sp, deg, rise); if (r.top) climbed++; return r.top ? '#' : '.'; }).join('')).join(' | ');
      lines.push(`${rise.toFixed(2)} ${c.id.padEnd(6)} ${row}`);
    }
    W.physics!.dispose();
  }
  console.log(`refusals (# on top):\n${lines.join('\n')}`);
  assert.equal(climbed, 0, `${climbed} approaches climbed a rise above the step`);
});

// F66 (owner, 2026-11-25: option 1): the controller walks down exactly the drops the tile model walks down and falls on
// every drop it treats as a fall, for every size class: the support under the axis may drop less than the snap (the
// tile STICK, 0.35 m) plus the tick's gravity (g·dt²), so 0.3583 m is walked down and 0.359 m is a fall. Each class walks
// off the raised half at six speeds from two starts on both resolvers. From the tick its axis crosses the edge, every
// tick's grounded state must agree (Rapier's planar moves lag the tile body's by up to a millimetre over a 3 m walk, so
// the crossing itself can come a tick later), except a landing where the tile body's fall ends within a micrometre above
// the floor: supportBelow, whose height the controller lands on, is off by up to an f32 ulp of its origin (ROADMAP F70),
// so there the controller lands a tick early. A fall keeps coyote time (a press on its third airborne tick jumps)

/** walk a class body west off the raised half's edge (x = 0) at `speed` from x0: its grounded state per tick ('G' or
 *  '.') and feet from the tick its axis crosses the edge, that tick, and whether a Jump press on its third airborne tick
 *  jumped */
function walkOff(W: World, foot: number, speed: number, drop: number, x0: number): { seq: string; ys: number[]; cross: number; coyote: boolean } {
  const b = body(x0, drop), t = tickFor(foot, speed), out = { jumped: false }, ys: number[] = [];
  let seq = '', airborne = 0, coyote = false, cross = -1;
  for (let s = 0; s < Math.round((2.5 + foot) / speed / DT) + 40; s++) {
    const press = airborne === 3 && !coyote, it = { mx: -1, mz: 0, jump: false, jumpPressed: press };
    if (b.grounded) stepSupported(W, b, it, t, R, DT, out); else stepBallistic(W, b, it, t, R, DT, out);
    if (press) coyote = out.jumped;
    if (!b.grounded) airborne++;
    if (cross < 0 && b.x < 0) cross = s;
    seq += b.grounded ? 'G' : '.';
    ys.push(b.y);
  }
  return { seq: seq.slice(cross), ys: ys.slice(cross), cross, coyote };
}

test('down (F66): every class walks down and falls off exactly the drops the tile model does, tick for tick, with coyote time', () => {
  const limit = rules.physics.controller.snap + R.gravity * DT * DT;
  const tiles = deepMerge(defaultRules, { physics: { engine: 'tiles' } } as never) as Rules;
  const table: string[] = [];
  let cases = 0, late = 0, edge = 0;
  for (const drop of [0.3, limit - 1e-4, limit + 7e-4, 0.4, 0.5, 0.6, 0.8]) {
    const on = stepWorld(drop), off = stepWorld(drop, undefined, tiles), row: string[] = [];
    for (const c of rules.size.classes) for (const sp of SPEEDS) for (const start of [0, 0.37]) {
      const x0 = 1 + c.body + start, a = walkOff(off, c.body, sp, drop, x0), b = walkOff(on, c.body, sp, drop, x0);
      const n = [...b.seq].filter((g) => g === '.').length, what = `${c.id} at ${sp} m/s from ${x0.toFixed(2)} off ${drop.toFixed(4)} m`;
      cases++;
      if (b.cross !== a.cross) late++;
      assert.ok(b.cross >= 0 && Math.abs(b.cross - a.cross) <= 1, `${what}: crosses the edge on tick ${b.cross} (tiles ${a.cross})`);
      const L = Math.min(a.seq.length, b.seq.length);
      let k = 0;
      while (k < L && a.seq[k] === b.seq[k]) k++;
      if (k < L) {
        // the one allowed difference: a landing a tick early where the tile fall ended within a micrometre of the floor
        assert.ok(b.seq[k] === 'G' && a.seq[k] === '.' && (k + 1 >= a.seq.length || a.seq[k + 1] === 'G') && Math.abs(a.ys[k]) < 1e-6,
          `${what}: tick ${k} from the edge is ${b.seq[k]} on the controller, ${a.seq[k]} on tiles (tile feet ${a.ys[k]})`);
        edge++;
        k++;
      }
      assert.equal(b.seq.slice(k, L), a.seq.slice(k, L), `${what}: grounded per tick from the edge on the controller as on tiles`);
      if (drop < limit) assert.equal(n, 0, `${what}: walked down`);
      else {
        assert.ok(n > 3, `${what}: a fall`);
        assert.ok(a.coyote && b.coyote, `${what}: a press on the third airborne tick is a ground jump (coyote time)`);
      }
      if (start === 0 && (sp === 0.5 || sp === 4 || sp === 9)) row.push(`${c.id[0]}${sp}:${n}`);
    }
    table.push(`${drop.toFixed(4)} m: ${row.join(' ')}`);
    on.physics!.dispose();
  }
  console.log(`airborne ticks walking off a drop, the same on both resolvers (class initial and m/s; 0 walked down; a fall includes its coyote jump):\n${table.join('\n')}\n${cases} walks, ${late} crossing the edge a tick later than on tiles, ${edge} landing a tick early within a micrometre (F70)`);
});

test('the range\'s stair flight (45°, 2 m): every class climbs it to the terrace, crease stalls counted (R13)', () => {
  const stalls: string[] = [];
  for (const [cls, species] of [['tiny', 'caterpie'], ['small', 'cyndaquil'], ['medium', 'charmeleon'], ['large', 'tauros'], ['xl', 'snorlax']]) {
    const ctx = createRun({ seed: 1, species, ruleOverrides: { physics: { engine: 'rapier' }, worldgen: { arena: 'range' } } as never });
    const P = ctx.player;
    P.x = P.px = -27; P.z = P.pz = 0; P.y = P.py = 0; P.vx = P.vz = P.vy = 0; P.grounded = true;
    let top = 0, run = 0, worst = 0;
    for (let s = 0; s < 240; s++) {
      const x0 = P.x, z0 = P.z;
      step(ctx, { ...NO_INPUT, mx: 0, mz: -1 });
      if (P.grounded && Math.hypot(P.x - x0, P.z - z0) < 1e-4 && P.y < 1.99) { run++; worst = Math.max(worst, run); } else run = 0;
      top = Math.max(top, P.y);
    }
    stalls.push(`${cls} ${worst}`);
    assert.ok(top > 1.99 && P.z < -7, `${cls}: reached ${top.toFixed(3)} m at z ${P.z.toFixed(2)}`);
    assert.ok(worst <= 3, `${cls}: stalled ${worst} ticks on the flight (R13)`);
    disposeRun(ctx);
  }
  console.log(`stair flight, longest stall in ticks per class: ${stalls.join(', ')}`);
});

test('headroom: an Extra Large body of exactly 2.4 m walks under a 2.4 m gap (S1 O5); a taller one does not, and a jump under a deck spends its speed at the slab', () => {
  // a deck over the raised half's first 4 tiles: top 3.0 m, so its 0.6 m slab leaves 2.4 m above the plain at 0
  const W = stepWorld(0, (Wd, map) => {
    const n = Wd.w * Wd.h, ov = new Float32Array(n);
    for (let k = 0; k < n; k++) { const x = (k % Wd.w) - Wd.half; if (x >= 0 && x < 4) ov[k] = 3; }
    map.over = ov;
    Object.assign(Wd, { over: ov });
  });
  const walk = (foot: number, tall: number) => {
    const b = body(-2), t = tickFor(foot, 3, tall), out = { jumped: false };
    for (let s = 0; s < 150; s++) { const it = { mx: 1, mz: 0, jump: false }; if (b.grounded) stepSupported(W, b, it, t, R, DT, out); else stepBallistic(W, b, it, t, R, DT, out); }
    return b;
  };
  assert.ok(walk(0.88, 2.4).x > 3, 'an Extra Large body of 2.4 m fits under');
  assert.ok(walk(0.88, 2.45).x < 0, 'a 2.45 m body does not');
  const b = body(1), t = tickFor(0.46, 0, 1.2), out = { jumped: false };
  let top = 0;
  for (let s = 0; s < 60; s++) { const it = { mx: 0, mz: 0, jump: s === 0 }; if (b.grounded) stepSupported(W, b, it, t, R, DT, out); else stepBallistic(W, b, it, t, R, DT, out); top = Math.max(top, b.y + 1.2); }
  // the capsule's envelope stops at the slab, and the body's head is its head margin above that (the tile model's HEAD_EPS)
  assert.ok(top <= 2.4 + C.headMargin + 1e-3 && top > 2.39, `a Medium head under the slab tops out at ${top.toFixed(4)} m`);
  assert.ok(b.grounded && Math.abs(b.y) <= C.offset, 'and lands again');
  W.physics!.dispose();
});

// Liquids keep today's behaviour on the controller (owner, 2026-11-25; docs/LOCOMOTION.md "Resolvers"): the adapter puts
// no bed under a liquid (F25), so the controller stands a body on its surface, as the tile model supports it there, and
// contact, exposure and the shipped swim kind read the same body. A plain body walks into a deep pool on both
// resolvers; then scripts/hazplay.ts's wade-in on Shrine Gorge seed 3 runs on the flag: a Water type swims safely at the
// surface, a Normal type is exposed, takes the water's damage and walks back out
test('liquids: a body walks into deep water and rests at its surface in contact; the swim kind swims safely, an exposed body wades out (flag on)', () => {
  const tiles = deepMerge(defaultRules, { physics: { engine: 'tiles' } } as never) as Rules;
  const pool = (W: World, map: { terrain: Uint8Array }) => {
    for (let k = 0; k < W.w * W.h; k++) { const x = (k % W.w) - W.half, z = ((k / W.w) | 0) - W.half; if (x >= 0 && x < 8 && z >= -4 && z < 4) map.terrain[k] = T.water; }
  };
  const gs: string[] = [];
  for (const W of [stepWorld(0, pool as never, tiles), stepWorld(0, pool as never)]) {
    const b = body(-2), t = tickFor(0.46, 3), out = { jumped: false };
    let g = '';
    for (let s = 0; s < 120; s++) {
      const it = { mx: 1, mz: 0, jump: false };
      if (b.grounded) stepSupported(W, b, it, t, R, DT, out); else stepBallistic(W, b, it, t, R, DT, out);
      g += b.grounded ? 'G' : '.';
    }
    assert.ok(b.x > 2 && b.grounded, `in the pool at x ${b.x.toFixed(2)}, supported`);
    assert.ok(Math.abs(b.y - WATER_Y) < 1e-6, `rests at the surface ${WATER_Y}: ${b.y}`);
    assert.equal(mediumAt(W, b, rules.hazards.contact), MEDIUM.liquid, 'in contact: the medium is the liquid');
    gs.push(g);
    W.physics?.dispose();
  }
  // the 0.25 m bank is walked down on both (the controller's round bottom rides its edge down, the tile body drops at once)
  assert.equal(gs[1], gs[0], 'supported on every tick on both resolvers');
  assert.ok(!gs[1].includes('.'), 'never airborne: the bank is walked down');
  const [map, seed] = gorge(3), on = { physics: { engine: 'rapier' } };
  const swim = inAndOut(map, seed, 'totodile', 3, 3, { extra: on });
  assert.ok(swim.ctx.physics && swim.ctx.world.mover, 'the run is on the controller');
  assert.ok(Math.abs(swim.y0 - swim.sh.level) < 1e-6, `Totodile swims at the surface ${swim.sh.level}: ${swim.y0}`);
  assert.ok(swim.swimming === 1 && swim.exposed === 0 && swim.w.damage === 0 && swim.w.enterEvents === 0 && swim.out && swim.state === 'play', `Totodile swims safely and walks out (swimming ${swim.swimming}, exposed ${swim.exposed}, damage ${swim.w.damage}, out ${swim.out})`);
  const wade = inAndOut(map, seed, 'rattata', 2, 1.2, { extra: on });
  assert.ok(wade.exposed === 1 && wade.w.damage > 0 && wade.out && wade.state === 'play' && wade.hp > 0, `Rattata is exposed, takes damage and wades out (exposed ${wade.exposed}, damage ${wade.w.damage}, out ${wade.out})`);
  disposeRun(swim.ctx); disposeRun(wade.ctx);
});

// The controller's capsules are in collision groups 0 (physics/controller.ts): membership 0, so no query's filter ever
// meets them. (They are also never in the broad phase: the physics world is stepped once, at build, before any capsule
// exists. This test steps its own world again so that only the groups keep them out.) With an Extra Large capsule
// standing at the origin, an unfiltered Rapier query finds it there, and every
// query the sim makes on physics passes through it: the shot and aim ray and the beam and orb sweeps (World.raycast, r
// = h = 0 and swept), sight (World.segmentClear, World.sight), solidAt, overlaps, the support below and the liquid at a
// point, in every query mode (shots and sight, foliage open, wall tops)
test('collision groups: aim, sight, shot and beam queries pass through the controller\'s capsules', () => {
  const W = stepWorld(0), b = body(0), t = tickFor(0.88, 0, 2.4), out = { jumped: false };
  stepSupported(W, b, { mx: 0, mz: 0, jump: false }, t, R, DT, out); // the capsule is placed at the body
  const P = W.physics!.worldFor(W), raw = (P as unknown as { world(): { step(): void; intersectionsWithPoint(p: object, cb: () => boolean): void } }).world();
  raw.step(); // the capsule into the broad phase
  let there = 0;
  raw.intersectionsWithPoint({ x: 0, y: 1.2, z: 0 }, () => { there++; return true; });
  assert.ok(there >= 1, 'an unfiltered query meets the capsule at the body');
  const hit = new RayHit();
  for (const flags of [0, QF.foliage, QF.tops, QF.foliage | QF.tops]) {
    assert.equal(W.raycast(-5, 1.2, 0, 1, 0, 0, 10, SK_WORLD, hit, 0, 0, flags), false, `the shot and aim ray (flags ${flags})`);
    assert.equal(W.raycast(-5, 1.2, 0, 1, 0, 0, 10, SK_WORLD, hit, 0.3, 0.4, flags), false, `a beam or orb sweep (flags ${flags})`);
    assert.equal(W.raycast(0, 5, 0, 0, -1, 0, 10, SK_WORLD, hit, 0, 0, flags) && hit.y, 0, `a ray down through it meets the floor (flags ${flags})`);
    assert.equal(W.segmentClear(-5, 1.2, 0, 5, 1.2, 0, SK_WORLD, flags), true, `sight across it (flags ${flags})`);
    assert.equal(W.solidAt(0, 1.2, 0, SK_WORLD, flags), 0, `solidAt inside it (flags ${flags})`);
    for (const stops of [STOPS.shots, STOPS.sight]) assert.equal(P.overlapCylinder(0, 0.5, 2, 0, 0.3, SK_WORLD, flags, stops), 0, `an overlap inside it (flags ${flags}, stops ${stops})`);
  }
  assert.equal(W.sight(-5, 1.2, 0, 5, 1.2, 0), true, 'enemy line of sight across it');
  // the floor, not the capsule's bottom (its f32 ray reads the floor at 0 to within 1e-7 m: ROADMAP F70)
  assert.ok(Math.abs(P.supportBelow(0, 1.2, 0)) < 1e-6, 'the support below a point inside it is the floor');
  assert.equal(P.liquidAt(0, 1.2, 0), 0, 'no liquid inside it');
  W.physics!.dispose();
});
