// Phase 8a: capability tags, the shared resolver, projectile interception, suspend-and-release Hold,
// body-on-body impacts, the burning-tile flow cost, the death recap, and determinism (blueprint sections 7,
// 10, 12 and 16). Rule tests, property tests, micro-scene scenario tests and regression tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRun, step } from '../src/sim/run';
import { breakBody, holdBody, holdPower, moveOnBody, pushBody, pushPower, spawnBody, TEAM } from '../src/sim/bodies';
import { createBody, forceOnShots, interceptPass, resolve } from '../src/sim/capabilities';
import { shootHostile, spawnEnemy } from '../src/sim/enemies';
import { compileMove } from '../src/sim/moves';
import { tagSpec } from '../src/sim/squad';
import { addMember } from '../src/sim/squad';
import { CS } from '../src/sim/cells';
import { PK } from '../src/sim/pools';
import { stateHash } from '../src/sim/checksum';
import { buildRecap, debugLine } from '../src/sim/caplog';
import { MOVES } from '../src/rules/moves';
import { capOf, capTags, compileCaps, shotWeight } from '../src/rules/capabilities';
import { SPECIES_BY_ID } from '../src/rules/species';
import { defaultRules } from '../src/rules/defaults';
import { BTN, NO_INPUT, type InputFrame, type SimContext } from '../src/sim/types';

const NONE: InputFrame = { mx: 0, mz: 0, jump: false, dash: false };
const QUIET = { director: { spawnBase: -99, spawnPerMin: 0, spawnPerStage: 0, eliteEvery: 9999, swarmEvery: 9999 }, bodies: { looseRocks: 0 }, beats: { enabled: false }, objectives: { enabled: false } };

function calm(species = 'totodile', extra: object = {}): SimContext {
  const ctx = createRun({ seed: 5, species, ruleOverrides: deep(QUIET, extra) as never });
  for (let i = 0; i < 20; i++) step(ctx, NONE);
  return ctx;
}
function deep(a: any, b: any): any {
  const o: any = { ...a };
  for (const [k, v] of Object.entries(b)) o[k] = v && typeof v === 'object' && !Array.isArray(v) ? deep(a[k] ?? {}, v) : v;
  return o;
}
const steps = (ctx: SimContext, n: number, inp: Partial<InputFrame> = {}) => { const all: any[] = []; for (let i = 0; i < n; i++) all.push(...step(ctx, { ...NONE, ...inp })); return all; };
const speed = (ctx: SimContext, b: number) => Math.hypot(ctx.bodies.vx[b], ctx.bodies.vz[b]);
const open = (ctx: SimContext, dx: number, dz = 0) => ctx.world.nearestWalkable(ctx.player.x + dx, ctx.player.z + dz);
const recs = (ctx: SimContext, s = 999) => ctx.caplog.since(ctx.time - s);
/** an enemy that stands still (a target for autofire) */
function dummy(ctx: SimContext, id: string, x: number, z: number) {
  const e = spawnEnemy(ctx, id, x, z);
  ctx.enemies.speed[e] = 0; ctx.enemies.spawnT[e] = 1; ctx.enemies.attackCd[e] = 999; ctx.enemies.hp[e] = ctx.enemies.maxHp[e] = 1e6;
  ctx.grid.rebuild(ctx.enemies.hi, ctx.enemies.x, ctx.enemies.z, ctx.enemies.alive);
  return e;
}
/** a flat, open square of side n tiles near the spawn: its lower-left tile centre */
function openSquare(ctx: SimContext, n: number): [number, number] {
  const W = ctx.world, [sx, sz] = W.spawn;
  for (let r = 0; r < 30; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
    const x0 = Math.floor(sx + dx) + 0.5, z0 = Math.floor(sz + dz) + 0.5, h0 = W.height(x0, z0);
    let ok = true;
    for (let j = 0; j < n && ok; j++) for (let i = 0; i < n && ok; i++) {
      const k = W.tile(x0 + i, z0 + j);
      ok = W.walkable(x0 + i, z0 + j) && Math.abs(W.height(x0 + i, z0 + j) - h0) < 0.01 && W.map.terrain[k] !== 3 && W.map.terrain[k] !== 4 && !W.map.platform[k] && !W.map.wall[k];
    }
    if (ok) return [x0, z0];
  }
  throw new Error('no open square');
}

// ------------------------------------------------------------------ capability tags (data)
test('capability tags are derived from type, class, power and shape, and carried by every compiled move', () => {
  const tags = (k: string) => capTags(compileMove(defaultRules, k).caps);
  assert.deepEqual(tags('water_gun'), ['hit', 'push:1', 'apply:wet']);
  assert.deepEqual(tags('flame_wheel'), ['hit', 'push:2', 'apply:heat']);
  assert.deepEqual(tags('superpower'), ['hit', 'push:3']);
  assert.deepEqual(tags('vine_whip'), ['hit', 'hold:1']);
  assert.deepEqual(tags('fire_spin'), ['hit', 'hold:1', 'apply:heat']);
  assert.deepEqual(tags('ember'), ['hit', 'apply:heat']);
  for (const m of MOVES) {
    const s = compileMove(defaultRules, m.key);
    assert.ok(Array.isArray(s.caps), m.key);
    if (m.cls === 'status') assert.ok(!s.caps!.some((c) => c.verb === 'hit'), m.key + ': status moves do not Hit');
  }
});

test('regression: compiled Push and Hold Power equal the v10 derivation for every move', () => {
  // v10's sim/bodies.ts pushPower / holdPower, verbatim
  const byPower = (p: number) => (p <= 0 || p < 60 ? 1 : p <= 90 ? 2 : 3);
  const HOLD = new Set(['vine_whip', 'wrap', 'bind', 'confusion', 'psychic', 'whirlpool', 'fire_spin']);
  const v10push = (s: any) => { if (s.cls === 'status') return 0; const el = s.element; if (el === 'tide' || s.archetype === 'dash' || (s.cls === 'physical' && (el === 'brawl' || el === 'stone' || el === 'quake')) || (s.cls === 'special' && el === 'gale')) return byPower(s.power); return 0; };
  const v10hold = (s: any) => (HOLD.has(s.key) ? byPower(s.power) : 0);
  for (const m of MOVES) {
    const s = compileMove(defaultRules, m.key);
    assert.equal(pushPower(s), v10push(s), m.key);
    assert.equal(holdPower(s), v10hold(s), m.key);
  }
});

test('a Create Tag Action carries create:rock; shots weigh 0 and lobs or heavy shots 1', () => {
  const ctx = calm('cyndaquil');
  const m = addMember(ctx, 'geodude')!;
  const spec = tagSpec(ctx, m)!;
  assert.ok(capTags(spec.caps).includes('create:rock'));
  assert.equal(capOf(compileCaps({ key: 'x', element: 'tide', cls: 'special', archetype: 'beam', power: 110 }), 'push'), 3);
  assert.equal(shotWeight(false, 0.45, 0.6), 0);
  assert.equal(shotWeight(false, 0.6, 0.6), 1);
  assert.equal(shotWeight(true, 0.3, 0.6), 1);
});

// ------------------------------------------------------------------ the resolver: rule and property tests
test('resolve(push): Power below Weight slows, at or above moves at 8 x (1 + 0.5 x (P - W)); owner change costs 25%', () => {
  const ctx = calm();
  const [x, z] = open(ctx, 10);
  const b = spawnBody(ctx, 'rock', x, z, 4, 0, TEAM.enemy);
  const ev = (power: number, dx = 0, dz = 1) => ({ verb: 'push' as const, power, type: 'tide' as const, owner: TEAM.player, x, z, dx, dz, source: { kind: 'move' as const, id: 1, name: 'Test' }, target: { kind: 'body' as const, id: b } });
  assert.equal(resolve(ctx, ev(1)), 'fail');
  assert.ok(Math.abs(speed(ctx, b) - 4 * 0.85) < 1e-9);
  ctx.time += 1;
  const hp0 = ctx.bodies.hp[b];
  assert.equal(resolve(ctx, ev(3)), 'ok');
  assert.ok(Math.abs(ctx.bodies.vz[b] - 8 * 1.5) < 1e-9, '8 x (1 + 0.5 x 1)');
  assert.equal(ctx.bodies.team[b], TEAM.player);
  assert.ok(Math.abs(hp0 - ctx.bodies.hp[b] - ctx.bodies.maxHp[b] * 0.25) < 1e-9, 'a quarter of its integrity');
  const last = recs(ctx).filter((r) => r.verb === 'push').pop()!;
  assert.equal(last.out, 'ok'); assert.equal(last.power, 3); assert.equal(last.weight, 2);
});

test('property: more Power never moves a body less, and a combined push is never weaker than either push', () => {
  for (const kind of ['rubble', 'rock', 'boulder']) {
    let prev = -Infinity;
    for (let P = 1; P <= 4; P++) {
      const ctx = calm();
      const [x, z] = open(ctx, 10);
      const b = spawnBody(ctx, kind, x, z, 0, -3, TEAM.neutral);
      pushBody(ctx, b, P, 0, 1, TEAM.player);
      const along = ctx.bodies.vz[b];
      assert.ok(along >= prev - 1e-9, `${kind}: P${P} moves it at least as far as P${P - 1}`);
      prev = along;
    }
    for (let p1 = 1; p1 <= 3; p1++) for (let p2 = 1; p2 <= 3; p2++) {
      const single = (p: number) => { const c = calm(); const [x, z] = open(c, 10); const b = spawnBody(c, kind, x, z); pushBody(c, b, p, 0, 1, TEAM.player); return c.bodies.vz[b]; };
      const c = calm(); const [x, z] = open(c, 10); const b = spawnBody(c, kind, x, z);
      pushBody(c, b, p1, 0, 1, TEAM.player); c.time += 0.1; pushBody(c, b, p2, 0.1, 1, TEAM.player);
      assert.ok(c.bodies.vz[b] >= Math.max(single(p1), single(p2)) - 1e-9, `${kind} ${p1}+${p2}`);
    }
  }
});

// ------------------------------------------------------------------ suspend-and-release Hold
test('Hold suspends a body 1.5 m in front along the aim, then releases it as a Push of the same Power', () => {
  const ctx = calm('bulbasaur');
  const P = ctx.player;
  const [x, z] = open(ctx, 4, 2);
  const b = spawnBody(ctx, 'rubble', x, z);
  ctx.bodies.life[b] = 99;
  const aim = { aimX: P.x - 10, aimZ: P.z }; // aim west
  step(ctx, { ...NONE, ...aim });
  assert.equal(holdBody(ctx, b, 1, P.x - x, P.z - z, TEAM.player, 0), true, 'Hold 1 >= Weight 1');
  assert.equal(ctx.bodies.team[b], TEAM.player);
  steps(ctx, 40, aim); // 0.67 s: it has reached the hold point and waits there
  const hx = P.x - 1.5, d = Math.hypot(ctx.bodies.x[b] - hx, ctx.bodies.z[b] - P.z);
  assert.ok(d < 0.2, `held at the hold point (off by ${d.toFixed(2)} m)`);
  assert.ok(ctx.bodies.holdT[b] > 0);
  steps(ctx, 25, aim); // past 1 s: released west at 8 m/s (Power 1 on Weight 1)
  assert.equal(ctx.bodies.holdT[b], 0);
  assert.ok(ctx.bodies.vx[b] < -6 && Math.abs(ctx.bodies.vz[b]) < 1, 'thrown along the aim');
  assert.ok(recs(ctx).some((r) => r.verb === 'release' && r.out === 'ok'));
});

test('holds combine like pushes: two Hold 1 within 0.2 s and 45° suspend a Medium rock; far apart in time they only slow it', () => {
  for (const gap of [0.1, 0.4]) {
    const ctx = calm('bulbasaur');
    const P = ctx.player;
    const [x, z] = open(ctx, 5);
    const b = spawnBody(ctx, 'rock', x, z);
    assert.equal(holdBody(ctx, b, 1, P.x - x, P.z - z, TEAM.player, 0), false, 'Hold 1 < Weight 2');
    ctx.time += gap;
    const held = holdBody(ctx, b, 1, P.x - x, P.z - z + 0.2, TEAM.player, 0);
    assert.equal(held, gap < 0.2, `gap ${gap}`);
    if (held) assert.equal(ctx.bodies.holdP[b], 2);
  }
});

test('a manual move releases its hold when the button is let go; a stunned holder drops it', () => {
  const ctx = calm('bulbasaur');
  const P = ctx.player;
  const [x, z] = open(ctx, 3);
  const b = spawnBody(ctx, 'rubble', x, z); ctx.bodies.life[b] = 99;
  holdBody(ctx, b, 1, P.x - x, P.z - z, TEAM.player, BTN.a);
  steps(ctx, 10, { btn: BTN.a, aimX: P.x, aimZ: P.z + 10 });
  assert.ok(ctx.bodies.holdT[b] > 0, 'held while Move A is down');
  steps(ctx, 1, { btn: 0, aimX: P.x, aimZ: P.z + 10 });
  assert.equal(ctx.bodies.holdT[b], 0);
  assert.ok(ctx.bodies.vz[b] > 6, 'released toward the aim at once');

  const c2 = calm('bulbasaur');
  const [x2, z2] = open(c2, 3);
  const b2 = spawnBody(c2, 'rubble', x2, z2); c2.bodies.life[b2] = 99;
  holdBody(c2, b2, 1, c2.player.x - x2, c2.player.z - z2, TEAM.player, 0);
  steps(c2, 5);
  c2.player.paraT = 1;
  steps(c2, 1);
  assert.equal(c2.bodies.holdT[b2], 0);
  assert.ok(speed(c2, b2) < 1e-9, 'dropped, not thrown');
  assert.ok(recs(c2).some((r) => r.verb === 'release' && r.out === 'drop'));
});

test('flag off: Hold is v10\'s pull toward the holder at 7 m/s', () => {
  const ctx = calm('bulbasaur', { caps: { suspendHold: false } });
  const [x, z] = open(ctx, 4);
  const b = spawnBody(ctx, 'rubble', x, z);
  const s = compileMove(ctx.rules, 'vine_whip');
  ctx.bodies.hitCd[b] = 0;
  moveOnBody(ctx, b, s, 1, 1, 0, 1);
  assert.ok(Math.abs(speed(ctx, b) - 7) < 1e-9);
  assert.equal(ctx.bodies.holdT[b], 0);
});

// ------------------------------------------------------------------ projectiles: interception
test('scenario: a Water Gun push deflects an incoming Oddish shot (interception)', () => {
  const run = (interception: boolean) => {
    const ctx = calm('totodile', { caps: { interception } });
    const P = ctx.player;
    P.hp = P.maxHp = 1000;
    const [ex, ez] = open(ctx, 13);
    dummy(ctx, 'rattata', ex, P.z);
    const oddish = SPECIES_BY_ID.oddish, osp = ctx.speciesIndex.indexOf(oddish);
    shootHostile(ctx, P.x + 7, P.z, -1, 0, 11, 20, 'venom', 0.45, osp);
    let hurt = 0, deflects = 0;
    for (let t = 0; t < 70; t++) {
      const ev = step(ctx, { ...NONE, aimX: P.x + 12, aimZ: P.z });
      hurt += ev.filter((e) => e.t === 'playerHurt').length;
      deflects += ev.filter((e) => e.t === 'deflect').length;
    }
    return { ctx, hurt, deflects };
  };
  const on = run(true);
  assert.equal(on.hurt, 0, 'the shot never reaches you');
  assert.ok(on.deflects > 0);
  const r = recs(on.ctx).find((x) => x.verb === 'push' && x.tgt === 'shot');
  assert.ok(r, 'logged as a Push on a shot');
  assert.equal(r!.tgtName, 'Oddish');
  const off = run(false);
  assert.equal(off.hurt, 1, 'v10: player shots and enemy shots pass through each other');
});

test('opposing shots cancel by Weight: equal Weights cancel both, a heavier shot survives and spends a pierce', () => {
  const ctx = calm('cyndaquil');
  const Pr = ctx.projectiles, P = ctx.player;
  const mk = (x: number, kind: number, r: number, w: number, pierce = 0) => {
    const i = Pr.spawn(); Pr.kind[i] = kind; Pr.x[i] = x; Pr.z[i] = P.z + 6; Pr.radius[i] = r; Pr.weight[i] = w; Pr.pierce[i] = pierce; Pr.life[i] = 5; Pr.move[i] = -1; return i;
  };
  const a = mk(P.x, PK.straight, 0.4, 0), h = mk(P.x + 0.3, PK.hostile, 0.45, 0);
  interceptPass(ctx);
  assert.equal(Pr.alive[a], 0); assert.equal(Pr.alive[h], 0);
  const big = mk(P.x + 4, PK.straight, 0.7, 1, 1), small = mk(P.x + 4.2, PK.hostile, 0.45, 0);
  interceptPass(ctx);
  assert.equal(Pr.alive[small], 0, 'the lighter enemy shot is cancelled');
  assert.equal(Pr.alive[big], 1); assert.equal(Pr.pierce[big], 0, 'spent one pierce');
  const tiny = mk(P.x - 4, PK.straight, 0.4, 0), heavy = mk(P.x - 4.2, PK.hostile, 0.6, 1);
  interceptPass(ctx);
  assert.equal(Pr.alive[tiny], 0); assert.equal(Pr.alive[heavy], 1, 'a heavy enemy shot survives a light one');
  // same team never interacts
  const m1 = mk(P.x + 8, PK.straight, 0.5, 0), m2 = mk(P.x + 8.2, PK.straight, 0.5, 0);
  interceptPass(ctx);
  assert.equal(Pr.alive[m1] + Pr.alive[m2], 2);
});

test('interceptions are capped per tick (dense shot fields)', () => {
  const ctx = calm('cyndaquil');
  const Pr = ctx.projectiles, P = ctx.player;
  for (let k = 0; k < 50; k++) {
    for (const kind of [PK.straight, PK.hostile]) { const i = Pr.spawn(); Pr.kind[i] = kind; Pr.x[i] = P.x + k * 3; Pr.z[i] = P.z + 30; Pr.radius[i] = 0.5; Pr.life[i] = 5; Pr.move[i] = -1; }
  }
  const before = ctx.caplog.n;
  interceptPass(ctx);
  assert.equal(ctx.caplog.n - before, ctx.rules.caps.maxInterceptsPerTick);
});

test('a Hold catches a shot no heavier than its Power and throws it along the aim; Power below its Weight fails', () => {
  const ctx = calm('bulbasaur');
  const P = ctx.player, Pr = ctx.projectiles;
  shootHostile(ctx, P.x + 4, P.z, -1, 0, 11, 20, 'venom', 0.45);
  shootHostile(ctx, P.x + 4, P.z + 3, -1, 0, 11, 20, 'stone', 0.6); // heavy: Weight 1
  const light = 0, heavy = 1;
  forceOnShots(ctx, 0, 1, 'bloom', TEAM.player, 'Vine Whip', 0, () => true, () => [-1, 0]);
  assert.ok(Pr.heldT[light] > 0, 'caught');
  assert.ok(Pr.heldT[heavy] > 0, 'Hold 1 catches Weight 1 too');
  const ctx2 = calm('bulbasaur');
  shootHostile(ctx2, ctx2.player.x + 4, ctx2.player.z, -1, 0, 11, 20, 'stone', 0.6);
  // a Power-0 hold cannot exist; use the resolver directly with Power 0 against Weight 1
  const out = resolve(ctx2, { verb: 'hold', power: 0, type: 'bloom', owner: TEAM.player, x: 0, z: 0, dx: -1, dz: 0, source: { kind: 'move', id: 0, name: 't' }, target: { kind: 'shot', id: 0 } });
  assert.equal(out, 'fail');
  // the caught shot waits, then flies north along the aim as the player's
  const hp0 = P.hp;
  steps(ctx, 30, { aimX: P.x, aimZ: P.z + 10 });
  assert.ok(Math.hypot(Pr.x[light] - P.x, Pr.z[light] - (P.z + 1.5)) < 0.3, 'at the hold point');
  steps(ctx, 35, { aimX: P.x, aimZ: P.z + 10 });
  assert.equal(Pr.heldT[light], 0);
  assert.equal(Pr.kind[light], PK.straight);
  assert.ok(Pr.vz[light] > 10, 'released north');
  assert.equal(P.hp >= hp0 - 1e-9, true, 'a held shot does not hurt its holder');
});

test('Guard deflects only shots no heavier than the guarding Pokémon (Gastly is Weightless)', () => {
  const run = (radius: number, interception = true) => {
    const ctx = calm('cyndaquil', { caps: { interception } });
    ctx.player.species = SPECIES_BY_ID.gastly;
    const P = ctx.player;
    P.hp = P.maxHp = 1000;
    shootHostile(ctx, P.x + 5, P.z, -1, 0, 10, 20, 'stone', radius);
    let deflected = false;
    for (let t = 0; t < 50; t++) {
      const ev = step(ctx, { ...NONE, btn: t >= 12 && t < 30 ? BTN.guard : 0, aimX: P.x + 10, aimZ: P.z });
      if (ev.some((e) => e.t === 'deflect')) deflected = true;
    }
    return deflected;
  };
  assert.equal(run(0.45), true, 'Weight 0 shot: deflected');
  assert.equal(run(0.6), false, 'Weight 1 shot: too heavy for a Weightless guard');
  assert.equal(run(0.6, false), true, 'flag off: v10 deflects any shot');
});

// ------------------------------------------------------------------ body-on-body impacts
test('scenario: a boulder rolled into a loose rock knocks it on and keeps the thrower\'s team; a rock rolled into a boulder bounces off', () => {
  const ctx = calm();
  const [x, z] = openSquare(ctx, 12);
  const rock = spawnBody(ctx, 'rock', x + 8, z + 2);
  const boulder = spawnBody(ctx, 'boulder', x + 2, z + 2, 11, 0, TEAM.enemy, 20);
  let impacted = false;
  for (let t = 0; t < 60 && !impacted; t++) { steps(ctx, 1); impacted = recs(ctx).some((r) => r.verb === 'impact'); }
  assert.ok(impacted, 'the bodies met');
  assert.ok(ctx.bodies.vx[rock] > 8, 'Weight 3 into Weight 2: the rock flies on');
  assert.equal(ctx.bodies.team[rock], TEAM.enemy, 'and now hurts like an enemy throw');
  assert.ok(ctx.bodies.hp[rock] < ctx.bodies.maxHp[rock], 'struck for integrity (Rock on Rock)');
  assert.ok(ctx.bodies.alive[boulder] && speed(ctx, boulder) < 11);

  const c2 = calm();
  const [x2, z2] = openSquare(c2, 12);
  const big = spawnBody(c2, 'boulder', x2 + 8, z2 + 2);
  const small = spawnBody(c2, 'rock', x2 + 2, z2 + 2, 9, 0, TEAM.player);
  for (let t = 0; t < 60; t++) steps(c2, 1);
  assert.ok(Math.hypot(c2.bodies.x[big] - (x2 + 8), c2.bodies.z[big] - (z2 + 2)) < 0.05, 'Weight 2 cannot move Weight 3');
  assert.ok(!c2.bodies.alive[small] || c2.bodies.x[small] < x2 + 8, 'the rock bounced back');
});

test('flag off: bodies pass through each other (v10)', () => {
  const ctx = calm('totodile', { caps: { bodyCollisions: false } });
  const [x, z] = openSquare(ctx, 12);
  const rock = spawnBody(ctx, 'rock', x + 8, z + 2);
  spawnBody(ctx, 'boulder', x + 2, z + 2, 11, 0, TEAM.enemy, 20);
  steps(ctx, 60);
  assert.equal(speed(ctx, rock), 0);
});

test('scenario: Lasso the rubble of a broken boulder and throw it into an enemy', () => {
  const ctx = calm('bulbasaur');
  const P = ctx.player;
  P.hp = P.maxHp = 1e4;
  const [x, z] = openSquare(ctx, 14);
  P.x = P.px = x + 3; P.z = P.pz = z + 7; P.y = ctx.world.height(P.x, P.z);
  const b = spawnBody(ctx, 'boulder', x + 6, z + 7);
  breakBody(ctx, b);
  steps(ctx, 30); // the rubble scatters and settles
  let piece = -1, bd = 1e9;
  for (let i = 0; i < ctx.bodies.hi; i++) if (ctx.bodies.alive[i] && ctx.bodies.kind[i] === 3) { const d = Math.hypot(ctx.bodies.x[i] - P.x, ctx.bodies.z[i] - P.z); if (d < bd) { bd = d; piece = i; } }
  assert.ok(piece >= 0, 'rubble on the ground');
  const e = dummy(ctx, 'rattata', x + 3, z + 13);
  const hp0 = ctx.enemies.hp[e];
  const aim = { aimX: x + 3, aimZ: z + 13 };
  assert.ok(holdBody(ctx, piece, 1, P.x - ctx.bodies.x[piece], P.z - ctx.bodies.z[piece], TEAM.player, 0));
  let hit = false;
  for (let t = 0; t < 140 && !hit; t++) hit = steps(ctx, 1, aim).some((ev) => ev.t === 'hit' && ev.enemy === e);
  assert.ok(hit && ctx.enemies.hp[e] < hp0, 'the thrown rubble struck the enemy');
});

// ------------------------------------------------------------------ Create
test('Create keeps at most createCap bodies per player; the oldest breaks first', () => {
  const ctx = calm();
  const [x, z] = openSquare(ctx, 12);
  const made: number[] = [];
  for (let k = 0; k < 8; k++) { made.push(createBody(ctx, 'rock', x + k * 1.5, z + 1)); ctx.bodies.age[made[k]] = 10 - k; }
  let alive = 0;
  for (let i = 0; i < ctx.bodies.hi; i++) if (ctx.bodies.alive[i] && ctx.bodies.made[i]) alive++;
  assert.equal(alive, ctx.rules.caps.createCap);
  assert.equal(ctx.bodies.alive[made[7]], 1, 'the newest stays');
});

// ------------------------------------------------------------------ burning tiles in the flow field
test('scenario (Firebreak): enemies route around burning tiles; with the cost at 1 they walk straight through', () => {
  const run = (burnNavCost: number) => {
    const ctx = calm('cyndaquil', { caps: { burnNavCost } });
    const P = ctx.player;
    P.hp = P.maxHp = 1e5;
    const [x0, z0] = openSquare(ctx, 15);
    P.x = P.px = x0 + 2; P.z = P.pz = z0 + 7; P.y = ctx.world.height(P.x, P.z);
    const C = ctx.world.cells;
    for (let j = 3; j <= 11; j++) for (let i = 5; i <= 7; i++) C.set(C.tile(x0 + i, z0 + j), CS.burning, 999);
    steps(ctx, 7); // one reaction pass: the flow field sees the fire
    const e = spawnEnemy(ctx, 'rattata', x0 + 12, z0 + 7);
    ctx.enemies.spawnT[e] = 1; ctx.enemies.hp[e] = ctx.enemies.maxHp[e] = 1e6;
    let onFire = 0, reached = false;
    for (let t = 0; t < 60 * 8; t++) {
      steps(ctx, 1);
      if (ctx.world.burningAt(ctx.enemies.x[e], ctx.enemies.z[e])) onFire++;
      if (Math.hypot(ctx.enemies.x[e] - P.x, ctx.enemies.z[e] - P.z) < 2) { reached = true; break; }
    }
    const through = ctx.world.flowDist(x0 + 6, z0 + 7), around = ctx.world.flowDist(x0 + 9, z0 + 7);
    return { onFire, reached, through, around };
  };
  const costly = run(8), free = run(1);
  assert.ok(costly.reached, 'still reaches you, the long way round');
  assert.ok(free.onFire > 20, `cost 1 walks through it (${free.onFire} ticks)`);
  assert.ok(costly.onFire <= 8 && costly.onFire * 4 < free.onFire, `cost 8 stays off the fire, at most clipping a corner (${costly.onFire} vs ${free.onFire} ticks)`);
  assert.ok(costly.around < 40, 'the far side stays reachable');
});

// ------------------------------------------------------------------ death recap and debugging
test('death recap: a boulder that kills a Light Pokémon names its Weight and what could have stopped it', () => {
  const ctx = calm('totodile');
  const P = ctx.player;
  P.hp = 3;
  spawnBody(ctx, 'boulder', P.x + 5, P.z, -11, 0, TEAM.enemy, 40);
  for (let t = 0; t < 120 && ctx.state === 'play'; t++) step(ctx, NONE);
  assert.equal(ctx.state, 'dead');
  const text = (ctx.recap ?? []).join('\n');
  assert.match(text, /Boulder \(Weight 3, Rock\) hit you/);
  assert.match(text, /Only a Pokémon of Weight 3 or more can deflect it/);
  assert.match(text, /Totodile fainted/);
});

test('death recap: shots name their shooter, contact names the species and the parry rule', () => {
  const ctx = calm('cyndaquil');
  const P = ctx.player;
  P.hp = P.maxHp = 60;
  const osp = ctx.speciesIndex.indexOf(SPECIES_BY_ID.oddish);
  for (let k = 0; k < 8; k++) { shootHostile(ctx, P.x + 6 + k * 3, P.z, -1, 0, 11, 25, 'venom', 0.45, osp); }
  for (let t = 0; t < 60 * 6 && ctx.state === 'play'; t++) step(ctx, NONE);
  const lines = buildRecap(ctx.caplog, ctx.time, 6);
  assert.ok(lines.some((l) => /Oddish's Poison shot \(Weight 0\) hit you/.test(l)), lines.join('\n'));
  assert.ok(lines.some((l) => /A timed Guard deflects it/.test(l)));
  assert.ok(recs(ctx).every((r) => debugLine(r, ctx.time).length > 0));
});

test('the log is passive: with the capability layer off nothing is recorded and no recap is written', () => {
  const ctx = calm('totodile', { caps: { enabled: false } });
  const P = ctx.player;
  P.hp = 3;
  spawnBody(ctx, 'boulder', P.x + 5, P.z, -11, 0, TEAM.enemy, 40);
  for (let t = 0; t < 120 && ctx.state === 'play'; t++) step(ctx, NONE);
  assert.equal(ctx.caplog.n, 0);
  assert.equal(ctx.recap, null);
});

// ------------------------------------------------------------------ determinism and regression
/** scripted inputs that exercise aim, Move A/B holds, Guard taps and dashes */
function scripted(ctx: SimContext, t: number): InputFrame {
  const P = ctx.player, a = t * 0.013;
  return { mx: Math.sin(a * 0.7), mz: Math.cos(a * 0.5), jump: t % 400 === 0, dash: t % 170 === 0, aimX: P.x + Math.sin(a) * 8, aimZ: P.z + Math.cos(a) * 8, btn: (t % 90 < 50 ? BTN.a : 0) | (t % 130 < 40 ? BTN.b : 0) | (t % 75 < 6 ? BTN.guard : 0), card: ctx.cards.offer ? { action: 'pick', index: 0 } : undefined };
}

test('determinism: the same seed and inputs give the same state hash with every Phase 8a feature on', () => {
  for (const species of ['bulbasaur', 'totodile']) {
    const hashes = () => {
      const ctx = createRun({ seed: 21, species });
      const out: number[] = [];
      for (let t = 0; t < 60 * 75 && ctx.state !== 'over'; t++) { step(ctx, scripted(ctx, t)); if (t % 600 === 0) out.push(stateHash(ctx)); }
      return { out, n: ctx.caplog.n };
    };
    const a = hashes(), b = hashes();
    assert.deepEqual(a.out, b.out, species);
    assert.equal(a.n, b.n);
  }
});

test('regression: with the capability layer off, replay hashes equal the v10 build (commit cedd7e7)', async () => {
  const { botInput } = await import('../src/sim/bot');
  const { MODES } = await import('../src/mods');
  const { StateHasher } = await import('../src/sim/checksum');
  // the legacy hash from scripts/checksum.ts; expected values recorded from the unmodified v10 source
  const legacy = (ctx: SimContext) => {
    const h = new StateHasher(), P = ctx.player;
    h.num(ctx.tick).num(ctx.stage).num(ctx.stats.kills).num(ctx.stats.damageTaken).num(ctx.stats.xp);
    h.num(P.x).num(P.y).num(P.z).num(P.vx).num(P.vz).num(P.reflex).num(P.level).num(P.xp).num(P.hp).num(P.maxHp);
    for (const s of P.moves) h.num(s.cd).num(s.level);
    const E = ctx.enemies; for (let i = 0; i < E.hi; i++) if (E.alive[i]) h.num(i).num(E.x[i]).num(E.z[i]).num(E.hp[i]);
    const B = ctx.bodies; for (let i = 0; i < B.hi; i++) if (B.alive[i]) h.num(B.x[i]).num(B.z[i]);
    return h.h.toString(16);
  };
  const V10: [string, number, string, number, string[]][] = [
    ['cyndaquil', 2, 'classic', 150, ['a6dcdc0a', '7b81025d', '44dfd266', '836d6b4f', 'ad0ec6aa']],
    ['bulbasaur', 3, 'survival', 120, ['ad031d5a', '9b72ca20', 'b0fee998', 'bffacf28']],
    ['charmander', 11, 'boss-rush', 120, ['8877765d', '214b4b2a', 'ad9d50de', 'ad09ceb0']],
    ['totodile', 7, 'classic', 120, ['7c7a03ab', 'd8b8f631', '74f3c09c', '4e7ad570']],
  ];
  for (const [species, seed, mode, seconds, want] of V10) {
    // v10 had neither the capability layer nor the Phase 8b build layer
    const ctx = createRun({ seed, species, mode: MODES.find((m) => m.id === mode), ruleOverrides: { caps: { enabled: false }, build: { enabled: false }, surfaces: { enabled: false } } as never });
    const got: string[] = [];
    while (ctx.time < seconds && ctx.state !== 'over' && ctx.state !== 'victory') { step(ctx, botInput(ctx)); if (ctx.tick % 1800 === 0) got.push(legacy(ctx)); }
    assert.deepEqual(got, want, `${species} seed ${seed} ${mode}`);
  }
});

test('regression: each feature flag alone off still runs a bot minute without errors', async () => {
  const { botInput } = await import('../src/sim/bot');
  for (const caps of [{ interception: false }, { suspendHold: false }, { bodyCollisions: false }, { burnNavCost: 1 }]) {
    const ctx = createRun({ seed: 8, species: 'cyndaquil', ruleOverrides: { caps } as never });
    for (let t = 0; t < 3600 && ctx.state !== 'over'; t++) step(ctx, botInput(ctx));
    assert.ok(ctx.tick > 0);
  }
  void NO_INPUT;
});
