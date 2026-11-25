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
import { LOCO, selectIntegrator, stepBallistic, stepSupported, type LocoBody, type LocoTick } from '../src/sim/locomotion';

const rules = deepMerge(defaultRules, { physics: { engine: 'rapier' } } as never) as Rules;
const R = rules.player, DT = 1 / 60, C = rules.physics.controller;
const SPEEDS = [0.5, 1, 2, 4, 6, 9], ANGLES = [0, 45];
const CLIMB = [0.3, 0.5, 0.55, 0.6], REFUSE = [0.62, 0.65, 0.8];

/** a flat plain at 0 whose tiles from x = 0 east are raised by `rise` (map arrays private to this World) */
function stepWorld(rise: number, over?: (W: World, map: { over?: Float32Array }) => void): World {
  const W = new World(rules, BIOMES.meadow, 5);
  const n = W.w * W.h, M = W.map;
  const map = { ...M, terrain: new Uint8Array(n), elev: new Float32Array(n), stairs: new Uint8Array(n), wall: new Uint8Array(n), platform: new Float32Array(n), over: undefined as Float32Array | undefined, wlevel: undefined };
  Object.assign(W, { map, over: undefined, voids: new Uint8Array(n) });
  for (let k = 0; k < n; k++) if ((k % W.w) - W.half >= 0) map.elev[k] = rise;
  over?.(W, map);
  return W;
}
const body = (x: number, y = 0): LocoBody => ({ x, y, z: 0, vx: 0, vy: 0, vz: 0, kx: 0, kz: 0, grounded: true, ctl: { buffer: 0, coyote: 0, airSpent: false } });
const tickFor = (foot: number, speed: number, tall?: number): LocoTick => ({ speed, stance: 1, footSpeed: 1, grip: 1, canJump: true, lift: false, airPress: 'none', stepUp: R.stepHeight, foot, tall, wide: false });

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

// Not the tile model's rule: there a drop deeper than the stick (0.35 m) is a fall. A round-bottomed capsule rides down a
// ledge's edge while the floor under its axis comes within the snap, so it walks down some deeper drops; the table
// prints them (docs/LOCOMOTION.md "Resolvers", ROADMAP F66)
test('down: a 0.3 m drop keeps every class supported (the tile model\'s stick); a 0.8 m drop is a fall for every class', () => {
  const table: string[] = [];
  for (const drop of [0.3, 0.4, 0.5, 0.6, 0.8]) {
    const W = stepWorld(drop), row: string[] = [];
    for (const c of rules.size.classes) {
      const b = body(1 + c.body, drop), t = tickFor(c.body, 4), out = { jumped: false };
      let airborne = 0;
      for (let s = 0; s < 90; s++) {
        const it = { mx: -1, mz: 0, jump: false };
        if (b.grounded) stepSupported(W, b, it, t, R, DT, out); else stepBallistic(W, b, it, t, R, DT, out);
        if (!b.grounded) airborne++;
      }
      row.push(`${c.id} ${airborne}`);
      // the feet rest within the controller's skin of the floor (a capsule snapped down sits up to a few mm into it)
      assert.ok(b.x < -1 && Math.abs(b.y) <= C.offset && b.grounded, `${c.id} ${drop} m: down at ${b.x.toFixed(2)}, ${b.y.toFixed(4)}`);
      if (drop === 0.3) assert.equal(airborne, 0, `${c.id}: ${airborne} airborne ticks off a ${drop} m drop`);
      if (drop === 0.8) assert.ok(airborne > 3, `${c.id}: a ${drop} m drop falls (${airborne} airborne ticks)`);
    }
    table.push(`${drop.toFixed(1)} m: ${row.join(', ')}`);
    W.physics!.dispose();
  }
  console.log(`airborne ticks walking off a drop at 4 m/s (0: walked down):\n${table.join('\n')}`);
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
