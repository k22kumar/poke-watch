// Tile-world and navigation tests (headless).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultRules } from '../src/rules/defaults';
import { BIOMES } from '../src/rules/stages';
import { World } from '../src/sim/world';
import { createRun, startStage, step } from '../src/sim/run';
import { botInput } from '../src/sim/bot';
import { getArena } from '../src/world/arenas';
import { PROP_RULES, T } from '../src/world/tiles';

const rules = defaultRules as typeof defaultRules;

test('every arena is one connected walkable region with reachable chests and landmarks', () => {
  for (const id of Object.keys(BIOMES)) {
    const W = new World(rules, BIOMES[id], 1);
    W.updateFlow(W.spawn[0], W.spawn[1]);
    const M = W.map;
    let open = 0, reach = 0;
    for (let k = 0; k < M.w * M.h; k++) {
      if (!M.wall[k] && M.terrain[k] !== T.water && M.platform[k] <= 0.6) open++;
      if (W.flow[k] !== 0x7fff) reach++;
    }
    assert.ok(reach / open > 0.995, `${id}: only ${reach}/${open} open tiles reachable`);
    for (const [x, y] of M.chestSpots) assert.ok(Number.isFinite(W.flowDist(x - W.half + 0.5, y - W.half + 0.5)), `${id}: chest at ${x},${y} unreachable`);
    assert.ok(Number.isFinite(W.flowDist(M.bossSpot[0] - W.half + 0.5, M.bossSpot[1] - W.half + 0.5)), `${id}: boss glade unreachable`);
  }
});

test('arenas are handcrafted: identical on every load, with designed landmarks', () => {
  // authored mode: the arena is cached and seed-independent; with materials on, each World holds its own wall and
  // platform overlay over the same base arrays (W4), so compare the base, not the object
  const a = getArena('meadow'), b = new World({ ...rules, surfaces: { ...rules.surfaces, inAuthored: true } }, BIOMES.meadow, 99).map;
  assert.equal(a.terrain, b.terrain, 'arenas are cached and seed-independent');
  assert.equal(new World(rules, BIOMES.meadow, 3).map, a, 'by default the authored arena is used as is');
  assert.equal(a.props, b.props);
  assert.deepEqual(a.wall, b.wall);
  assert.equal(new World({ ...rules, surfaces: { ...rules.surfaces, enabled: false } }, BIOMES.meadow, 7).map, a, 'materials off: the cached map itself');
  const names = a.landmarks.map((l) => l.name);
  for (const n of ['Old Shrine Ruins', 'Mirror Pond', 'Elder Oak', 'Petal Terrace', 'Battle Glade']) assert.ok(names.includes(n), n);
  assert.ok(a.props.some((p) => p.kind === 'elder'), 'elder oak placed');
  assert.ok(a.stairs.some((v) => v === 1), 'bluff has stairs');
  assert.ok(a.terrain.some((t) => t === T.wood), 'bridge exists');
  // no two blocking props share a tile
  const seen = new Set<number>();
  for (const p of a.props) {
    const R = PROP_RULES[p.kind];
    if (!R.wall && !R.platform) continue;
    for (let j = p.y; j < p.y + p.h; j++) for (let i = p.x; i < p.x + p.w; i++) { assert.ok(i < a.w && j < a.h, `${p.kind} spills off the map at ${i},${j}`); const k = j * a.w + i; assert.ok(!seen.has(k), `overlap at ${i},${j}`); seen.add(k); }
  }
});

test('the player climbs the bluff stairs and cannot walk up a cliff face', () => {
  const ctx = createRun({ seed: 1, species: 'charmander' });
  const W = ctx.world, M = W.map;
  const k = M.stairs.indexOf(1);
  const si = k % M.w, sj = Math.floor(k / M.w);
  let bottom = sj; while (M.stairs[(bottom + 1) * M.w + si]) bottom++;
  const P = ctx.player;
  // start two tiles south of the flight, walk north
  P.x = P.px = si - W.half + 0.5; P.z = P.pz = bottom + 2 - W.half + 0.5; P.y = P.py = W.height(P.x, P.z);
  ctx.rules.director.spawnBase = -99;
  for (let t = 0; t < 120; t++) step(ctx, { mx: 0, mz: -1, jump: false, dash: false });
  assert.ok(P.y > 1.9, `reached the bluff top (y=${P.y.toFixed(2)})`);
  // a column west of the flight ends in a sheer 2 m face: walking north there is blocked
  const ctx2 = createRun({ seed: 1, species: 'charmander' });
  const P2 = ctx2.player;
  ctx2.rules.director.spawnBase = -99;
  const col = si - 4;
  let edge = M.h - 1; while (edge > 0 && M.elev[edge * M.w + col] < 2) edge--;
  P2.x = P2.px = col - W.half + 0.5; P2.z = P2.pz = edge + 3 - W.half + 0.5; P2.y = P2.py = W.height(P2.x, P2.z);
  assert.equal(P2.y, 0, 'starts on the ground below the cliff');
  for (let t = 0; t < 120; t++) step(ctx2, { mx: 0, mz: -1, jump: false, dash: false });
  assert.ok(P2.y < 0.1, `stayed at the cliff foot (y=${P2.y.toFixed(2)})`);
});

test('ground enemies never finish a tick inside a wall or water', () => {
  const ctx = createRun({ seed: 11, species: 'bulbasaur', ruleOverrides: { player: { hpBase: 5000 }, director: { spawnBase: 6 } } });
  let checked = 0;
  while (ctx.time < 90) {
    step(ctx, botInput(ctx));
    if (ctx.tick % 30) continue;
    const E = ctx.enemies, W = ctx.world;
    for (let i = 0; i < E.hi; i++) {
      if (!E.alive[i] || E.hover[i] > 0) continue;
      checked++;
      assert.ok(!W.solid(E.x[i], E.z[i]), `enemy ${i} inside a wall at ${E.x[i].toFixed(1)},${E.z[i].toFixed(1)} t=${ctx.time.toFixed(1)}`);
    }
  }
  assert.ok(checked > 1000, `checked ${checked} enemy positions`);
});

test('flow field routes around obstacles and is deterministic', () => {
  const W = new World(rules, BIOMES.meadow, 3);
  W.updateFlow(W.spawn[0], W.spawn[1]);
  const a = W.flow.slice();
  const W2 = new World(rules, BIOMES.meadow, 3);
  W2.updateFlow(W2.spawn[0], W2.spawn[1]);
  assert.deepEqual(a, W2.flow);
  // from a tile behind the elder oak, following flowDir reaches the player without touching walls
  let x = 66 - W.half + 0.5, z = 26 - W.half + 0.5;
  const out: [number, number] = [0, 0];
  for (let s = 0; s < 400 && W.flowDist(x, z) > 1; s++) {
    if (!W.flowDir(x, z, out)) break;
    x += out[0] * 0.5; z += out[1] * 0.5;
    assert.ok(!W.solid(x, z), `path entered a wall at ${x.toFixed(1)},${z.toFixed(1)}`);
  }
  assert.ok(W.flowDist(x, z) <= 1, 'reached the player');
});

test('every region loads and plays a minute without errors', () => {
  for (let s = 0; s < 4; s++) {
    const ctx = createRun({ seed: 2, species: 'squirtle', ruleOverrides: { player: { hpBase: 4000 } } });
    if (s) startStage(ctx, s);
    let casts = 0;
    while (ctx.stageTime < 60 && ctx.state !== 'over') casts += step(ctx, botInput(ctx)).filter((e) => e.t === 'cast').length;
    // later regions carry the stage HP multiplier (x5.5 / x13 / x20), so a level-1 partner may not KO yet
    assert.ok(ctx.enemies.count > 20 && casts > 40, `region ${s}: spawning and fighting (${ctx.enemies.count} wild, ${casts} casts)`);
    assert.ok(ctx.state !== 'over', `region ${s}: survived`);
  }
});
