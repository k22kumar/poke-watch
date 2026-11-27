// The 3D scene's world meshes (task I2a; WORLDGEN3D Q16.4 as extended by Q23, Q18.7, Q18.9; docs/RENDER3D.md "World
// meshes"): the renderer computes normals across chunk borders by each role's normal mode and crease angle, and bakes
// the per-vertex sky visibility (the ambient rig's open/enclosed blend) and the lamp channel (local light) at load.
// Pure arrays, no three: render/world3d.
import assert from 'node:assert/strict';
import test from 'node:test';
import { BIOMES } from '../src/rules/stages';
import { resolve } from '../src/rules/styles/resolve';
import type { MaterialRole } from '../src/rules/materialroles';
import { RANGE } from '../src/mods';
import { createRun } from '../src/sim/run';
import { fromArenaMap } from '../src/world/adapter';
import { MODEL_VERSION, type SurfaceChunk, type WorldModel } from '../src/world/model';
import { worldgenFromQuery } from '../src/world/replay';
import type { LampEmitter } from '../src/render/world3d/bake';
import { buildWorld, type BuiltChunk } from '../src/render/world3d/mesh';
import { TopField } from '../src/render/world3d/topfield';
import { lightAt, srgbToLinear } from '../src/render/world3d/lighting';
import { faceTone, lstar, rampOf, topSideGap } from '../src/render/world3d/tones';

/** a model holding only render chunks (the bakes read nothing else) */
function model(surfaces: SurfaceChunk[]): WorldModel {
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const c of surfaces) for (let i = 0; i < c.positions.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], c.positions[i + k]); hi[k] = Math.max(hi[k], c.positions[i + k]); }
  lo = lo.map((v) => v - 1); hi = hi.map((v) => v + 1);
  return {
    meta: { source: 'test', id: 'test', name: 'test', seed: 0, version: MODEL_VERSION, requestedSeed: 0 } as WorldModel['meta'],
    bounds: { min: lo as [number, number, number], max: hi as [number, number, number] }, colliders: [], volumes: [],
    navInput: { positions: new Float32Array(), indices: new Uint32Array(), links: [], areas: new Uint8Array(), routes: { nodes: [], edges: [] } } as unknown as WorldModel['navInput'],
    surfaces, markers: [], spaces: [], portals: [], features: [], breakables: [], cells: [],
  };
}
/** quads (four corners each, counter-clockwise seen from their front) as one welded chunk */
function chunk(role: MaterialRole, quads: number[][][]): SurfaceChunk {
  const pos: number[] = [], idx: number[] = [], at = new Map<string, number>();
  const v = (p: number[]) => { const k = p.join(','); let i = at.get(k); if (i === undefined) { i = pos.length / 3; at.set(k, i); pos.push(...p); } return i; };
  for (const q of quads) { const [a, b, c, d] = q.map(v); idx.push(a, b, c, a, c, d); }
  return { cx: 0, cz: 0, material: 'terrain', role, positions: new Float32Array(pos), indices: new Uint32Array(idx) };
}
/** a level plane at height y over [x0, x1] × [z0, z1] in 1 m quads, facing up */
const plane = (x0: number, x1: number, z0: number, z1: number, y: number) => {
  const q: number[][][] = [];
  for (let x = x0; x < x1; x++) for (let z = z0; z < z1; z++) q.push([[x, y, z + 1], [x + 1, y, z + 1], [x + 1, y, z], [x, y, z]]);
  return q;
};
const opts = (mode: 'flat' | 'crease' | 'smooth' = 'flat', lamps: LampEmitter[] = []) => ({ normalMode: () => mode, creaseAngle: 30, lamps });
/** the baked value at the vertex nearest (x, y, z), and that vertex's normal */
function nearest(chunks: BuiltChunk[], x: number, y: number, z: number, want?: (n: number[]) => boolean) {
  let best = { d: Infinity, sky: 0, lamp: [0, 0, 0], n: [0, 0, 0] };
  for (const c of chunks) for (let i = 0; i < c.positions.length / 3; i++) {
    const n = [c.normals[i * 3], c.normals[i * 3 + 1], c.normals[i * 3 + 2]];
    if (want && !want(n)) continue;
    const d = Math.hypot(c.positions[i * 3] - x, c.positions[i * 3 + 1] - y, c.positions[i * 3 + 2] - z);
    if (d < best.d) best = { d, sky: c.sky[i], lamp: [c.lamp[i * 3], c.lamp[i * 3 + 1], c.lamp[i * 3 + 2]], n };
  }
  return best;
}
const up = (n: number[]) => n[1] > 0.9;

test('world meshes: sky visibility is open on a field, low under a deck and beside a wall', () => {
  const deck = chunk('floor', [...plane(-2, 2, -2, 2, 3), ...plane(-2, 2, -2, 2, 2.7).map((q) => [...q].reverse())]);
  const wall = chunk('cliff', [[[8, 0, 4], [8, 0, -4], [8, 6, -4], [8, 6, 4]], [[8, 6, 4], [8, 6, -4], [9, 6, -4], [9, 6, 4]]]);
  const B = buildWorld(model([chunk('ground', plane(-14, 14, -14, 14, 0)), deck, wall]), opts());
  const field = nearest(B.chunks, -10, 0, -10, up).sky, under = nearest(B.chunks, 0, 0, 0, up).sky, deckTop = nearest(B.chunks, 0, 3, 0, up).sky, byWall = nearest(B.chunks, 7, 0, 0, up).sky;
  assert.ok(field > 0.95, `open field ${field}`);
  assert.ok(deckTop > 0.95, `a deck's top ${deckTop}`);
  assert.ok(under < 0.3, `under the deck ${under}`);
  assert.ok(byWall < field - 0.15 && byWall > under, `beside a 6 m wall ${byWall}`);
});

test('world meshes: normals by mode, across chunk borders', () => {
  // a ridge split between two chunks: two slopes meeting at x = 0, each in its own chunk
  const ridge = (deg: number) => {
    const t = Math.tan((deg * Math.PI) / 180);
    return [chunk('ground', [[[-4, -4 * t, 2], [0, 0, 2], [0, 0, -2], [-4, -4 * t, -2]]]), chunk('rock', [[[0, 0, 2], [4, -4 * t, 2], [4, -4 * t, -2], [0, 0, -2]]])];
  };
  const atRidge = (B: BuiltChunk[]) => B.flatMap((c) => { const out: number[][] = []; for (let i = 0; i < c.positions.length / 3; i++) if (Math.abs(c.positions[i * 3]) < 1e-6 && c.positions[i * 3 + 2] > 0) out.push([...c.normals.slice(i * 3, i * 3 + 3)]); return out; });
  // a 2 × 10° bend is under the 30° crease: crease and smooth share one normal across the border, pointing straight up
  for (const mode of ['crease', 'smooth'] as const) {
    const n = atRidge(buildWorld(model(ridge(10)), opts(mode)).chunks);
    assert.equal(n.length, 2, `${mode}: one ridge vertex per chunk`);
    assert.ok(Math.abs(n[0][0] - n[1][0]) < 1e-6 && Math.abs(n[0][1] - n[1][1]) < 1e-6 && n[0][1] > 0.999, `${mode}: ${JSON.stringify(n)}`);
  }
  // a 2 × 40° bend is past it: crease keeps each face's own normal, smooth still blends
  const c40 = atRidge(buildWorld(model(ridge(40)), opts('crease')).chunks), s40 = atRidge(buildWorld(model(ridge(40)), opts('smooth')).chunks);
  assert.ok(c40.every((n) => n[1] < 0.8) && Math.sign(c40[0][0]) !== Math.sign(c40[1][0]), `crease at 80°: ${JSON.stringify(c40)}`);
  assert.ok(s40.every((n) => n[1] > 0.999), 'smooth blends any bend');
  // flat: every vertex carries its face's normal, and coplanar faces share vertices
  const F = buildWorld(model(ridge(10)), opts('flat')).chunks;
  assert.ok(atRidge(F).every((n) => n[1] < 0.99));
  const g = buildWorld(model([chunk('ground', plane(0, 4, 0, 4, 0))]), opts('flat')).chunks[0];
  assert.equal(g.positions.length / 3, 25, 'a 4 × 4 flat plane keeps its 25 welded vertices');
});

test('world meshes: the lamp channel lights inside its radius and its sight, and counts overlaps', () => {
  const wall = chunk('cliff', [[[3, 0, 3], [3, 0, -3], [3, 4, -3], [3, 4, 3]], [[3, 4, 3], [3, 4, -3], [3.5, 4, -3], [3.5, 4, 3]], [[3.5, 0, -3], [3.5, 0, 3], [3.5, 4, 3], [3.5, 4, -3]]]);
  const L: LampEmitter = { position: [0, 1, 0], colour: [1, 0.5, 0.25], radius: 6, intensity: 1 };
  const M = model([chunk('ground', plane(-10, 10, -10, 10, 0)), wall]);
  const B = buildWorld(M, opts('flat', [L]));
  const near = nearest(B.chunks, 1, 0, 0, up).lamp, edge = nearest(B.chunks, -7, 0, 0, up).lamp, behind = nearest(B.chunks, 5, 0, 0, up).lamp, side = nearest(B.chunks, -3, 0, 2, up).lamp;
  assert.ok(near[0] > 0.3 && near[0] > near[1] && near[1] > near[2], `beside the lamp, its colour: ${near}`);
  assert.ok(side[0] > 0 && side[0] < near[0], 'it falls off with distance');
  assert.deepEqual(edge, [0, 0, 0], 'outside the radius');
  assert.deepEqual(behind, [0, 0, 0], 'behind the wall');
  assert.equal(B.stats.maxLampOverlap, 1);
  const three = buildWorld(M, opts('flat', [L, { ...L, position: [0.5, 1, 0] }, { ...L, position: [0, 1, 0.5] }]));
  assert.equal(three.stats.maxLampOverlap, 3);
  assert.equal(buildWorld(M, opts('flat')).stats.maxLampOverlap, 0);
});

test('world meshes: the range builds whole and the same twice', () => {
  const biomes = Object.keys(BIOMES);
  const ctx = createRun({ seed: 1, species: 'charmander', mode: RANGE, ruleOverrides: { worldgen: { ...worldgenFromQuery({ world: 'locations', loc: null, mapseed: null, biomes }), arena: 'range' } } as never });
  const M = fromArenaMap(ctx.world.map), S = resolve('lowpoly', 'meadow');
  const o = { normalMode: (r: MaterialRole) => S.roles[r].normal, creaseAngle: S.creaseAngle };
  const a = buildWorld(M, o), b = buildWorld(M, o);
  let tris = 0;
  for (const c of M.surfaces) tris += c.indices.length / 3;
  assert.equal(a.stats.triangles, tris, 'no triangle lost');
  assert.equal(a.chunks.length, M.surfaces.length);
  for (const c of a.chunks) {
    for (let i = 0; i < c.normals.length; i += 3) assert.ok(Math.abs(Math.hypot(c.normals[i], c.normals[i + 1], c.normals[i + 2]) - 1) < 1e-5, 'unit normals');
    for (const v of c.sky) assert.ok(v >= 0 && v <= 1);
  }
  assert.deepEqual(a.chunks.map((c) => [c.positions, c.normals, c.sky, c.facet, c.depth]), b.chunks.map((c) => [c.positions, c.normals, c.sky, c.facet, c.depth]));
  // the top field sees the range's highest surface
  const f = TopField.of(M);
  assert.ok(Math.max(...f.top.filter(Number.isFinite)) <= M.bounds.max[1]);
});

test('tones: the CPU face tone is the shader\'s maths (the top/side lint of docs/looksheet)', () => {
  // an open top facing up at the fixed hour shows its base colour (the calibration tests/timeofday.test.ts pins)
  const S = resolve('lowpoly', 'meadow'), L = lightAt(S.time, S.time.hour);
  const top = faceTone(S, L, 'ground', [0, 1, 0]);
  const base = S.roles.ground.base.map(srgbToLinear);
  assert.ok(Math.abs(lstar(top) - lstar(base as [number, number, number])) < 1.5, `${lstar(top)} against ${lstar(base as [number, number, number])}`);
  // the ramp: continuous passes n·l through; 3 bands quantise it, hard edges at soft 0
  assert.equal(rampOf(0.4, 0, 0), 0.4);
  assert.ok(Math.abs(rampOf(0.4, 3, 0) - 1 / 3) < 1e-9 && Math.abs(rampOf(0.7, 3, 0) - 2 / 3) < 1e-9 && rampOf(1, 3, 0.3) === 1);
  // sides are darker than tops, and the sunward side is the brightest of the four
  const g = topSideGap(S, L, 'ground');
  assert.ok(g.gap > 0 && g.meanGap > g.gap);
  assert.equal(lstar([1, 1, 1]), 100);
});
