// Physics parity (task I1a): the world queries of tests/spatial.test.ts asked of both implementations, the tile column
// model (sim/spatial.ts raycastWorld / segmentClear / solidAt over the World) and src/physics (Rapier, built from the tile
// adapter's model of the same World by sim/physseam.ts buildTilePhysics), on the same scenes and on adapter maps. They
// agree, except for these documented differences, each asserted where it shows:
//
//   D1 closed sets   Rapier's solids are closed, the tile model's open. A ray lying in a face plane, or grazing one wall's
//                    edge or corner, touches it on Rapier and passes on tiles; a start on a surface is inside (a t = 0
//                    contact). The tile model's corner seal (two walls touching at a corner) is what closed sets give
//                    anyway, without CF.seal. A segment whose end rests on a surface is clear on both (physics END_EPS).
//   D2 tolerance     Rapier's geometry is f32: ray contacts agree to 1e-4 m along the ray or 1e-5 m across the surface
//                    entered (grazing incidence), normals to 1e-3. Its shape casts stop within
//                    their GJK tolerance, a few millimetres short of contact (on a grazing approach that is decimetres of
//                    t): a swept cylinder's contact lies between the tile contacts of the same volume grown by SWEEP_TOL
//                    (1 cm) and of the volume itself (up to SWEEP_LATE, 2 mm, past it), on the solid either one meets; a
//                    sweep passing within SWEEP_TOL of a solid may stop on it where the tile volume passes, and the actor
//                    contacts between the two world contacts differ with it.
//   D3 ids           a world contact's id is the collider index on physics, the tile index on tiles (both deterministic;
//                    aim.ts only compares ids within one implementation). Not compared.
//   D4 fat ramps     a swept cylinder meets a stairs ramp at its exact plane on physics; the tile model takes the ramp at
//                    its higher edge (conservative). Not compared on stairs tiles.
//   D5 the far field the tile model's columns are infinite: walls and the map edge go up forever, the ground down
//                    forever. The adapter's model starts at its bounds floor (the lowest surface − 1 m), and the physics
//                    edge slabs and wall columns stop EDGE_PAD (64 m) past its bounds. A contact the tile model makes below
//                    the floor or above that is missed on physics.
//   D6 skip initial  QF.skipInitialWorld ignores the solids containing the start: on physics a collider (a merged box
//                    covers many tiles) is skipped whole, on tiles only the start's own tile columns, so a cast that
//                    starts inside the ground or a wall and runs on inside it meets the next tile boundary on tiles and
//                    goes on through the merged box on physics. Only the camera trace (aim.ts CAMQ) skips, from the
//                    partner's chest plane.
//
// Plus F12: World.sight samples every 0.5 m and sees through a wall corner (tests/spatial.test.ts keeps that `todo`);
// on physics the seam's sight is the exact segment, and the todo passes here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import './setup/physics';
import { defaultRules, type Rules } from '../src/rules/defaults';
import { BIOMES } from '../src/rules/stages';
import { HABITATS } from '../src/world/habitat/recipes';
import { World, DECK_REACH } from '../src/sim/world';
import { createRun, disposeRun, step } from '../src/sim/run';
import { Rng } from '../src/core/rng';
import { T, DECK_SLAB } from '../src/world/tiles';
import { CS } from '../src/sim/cells';
import { buildTilePhysics, PhysicsSeam, PhysicsBridge } from '../src/sim/physseam';
import { PhysicsWorld, STOPS, EDGE_PAD } from '../src/physics/world';
import { crowd } from '../scripts/lib/crowd';
import { botInput } from '../src/sim/bot';
import { withAim } from '../scripts/lib/aimbot';
import {
  CF, Contacts, MASK, QF, RayHit, SK, SK_ACTOR, SK_WORLD, overlapCylinder, raycastWorld, segmentClear, solidAt, spatialQuery, sweep,
} from '../src/sim/spatial';
import type { SimContext } from '../src/sim/types';

const ROOT2 = Math.SQRT1_2;
const near = (a: number, b: number, eps: number) => Math.abs(a - b) <= eps;

/** an authored world whose map is replaced by a private flat grass plain at height 0 (tests/spatial.test.ts flatWorld) */
function flatWorld(): World {
  const W = new World(defaultRules, BIOMES.meadow, 5);
  const n = W.w * W.h, M = W.map;
  const map = { ...M, terrain: new Uint8Array(n), elev: new Float32Array(n), stairs: new Uint8Array(n), wall: new Uint8Array(n), platform: new Float32Array(n), over: new Float32Array(n), wlevel: undefined, props: [] };
  Object.assign(W, { map, over: map.over, voids: new Uint8Array(n) });
  return W;
}
const K = (W: World, i: number, j: number) => j * W.w + i;
const X = (W: World, i: number) => i - W.half;
const C = (W: World, i: number) => i - W.half + 0.5;

const TH = new RayHit(), PH = new RayHit();
const tileHit = (): RayHit => TH, physHit = (): RayHit => PH;
interface Q { o: [number, number, number]; d: [number, number, number]; maxT: number; mask?: number; r?: number; h?: number; flags?: number }
/** the same cast on both: [tile met, physics met] (hits in TH, PH) */
function both(W: World, P: PhysicsWorld, q: Q): [boolean, boolean] {
  const [ox, oy, oz] = q.o, [dx, dy, dz] = q.d, mask = q.mask ?? SK_WORLD, r = q.r ?? 0, h = q.h ?? 0, flags = q.flags ?? 0;
  return [raycastWorld(W, ox, oy, oz, dx, dy, dz, q.maxT, mask, TH, r, h, flags), P.cast(ox, oy, oz, dx, dy, dz, q.maxT, mask, flags, STOPS.shots, PH, r, h)];
}
/** a swept cylinder's tolerance band on physics (D2) */
const SWEEP_TOL = 0.01;
/** ... and how far past the tile volume's contact it may stop (f32 and GJK at map coordinates) */
const SWEEP_LATE = 2e-3;
const GH = new RayHit();
/** both agree (D2 tolerances; D3: ids not compared; the tile model's CF.seal is a plain block on physics). A sweep (q
 *  with r or h) is checked against the band (D2) */
function agree(a: [boolean, boolean], fat: boolean, W?: World, q?: Q): string | null {
  const [ta, pa] = a;
  if (fat && W && q && !(PH.t === 0 || (ta && TH.t === 0))) {
    // the tile cast of the volume grown by SWEEP_TOL bounds how early physics may stop
    const [ox, oy, oz] = q.o, [dx, dy, dz] = q.d;
    const g = raycastWorld(W, ox, oy, oz, dx, dy, dz, q.maxT, q.mask ?? SK_WORLD, GH, Math.min(0.999, (q.r ?? 0) + SWEEP_TOL), (q.h ?? 0) + SWEEP_TOL, q.flags ?? 0);
    if (!pa) return ta ? `met: tile at ${TH.t.toFixed(5)}, physics passes` : null;
    if (!g) return `physics stops at ${PH.t.toFixed(5)} (kind ${PH.kind}) where the grown tile volume passes`;
    if (!(GH.t <= PH.t + 1e-4)) return `physics stops at ${PH.t.toFixed(5)}, before the grown tile volume meets anything (${GH.t.toFixed(5)})`;
    if (ta && !(PH.t <= TH.t + SWEEP_LATE)) return `physics stops at ${PH.t.toFixed(5)}, after the tile volume (${TH.t.toFixed(5)})`;
    if (!(PH.kind === GH.kind || (ta && PH.kind === TH.kind))) return `kind: physics ${PH.kind}, tile ${ta ? TH.kind : '-'}, grown ${GH.kind}`;
    return null;
  }
  if (ta !== pa) return `met: tile ${ta}, physics ${pa}${ta ? ` (tile t ${TH.t.toFixed(5)} kind ${TH.kind})` : ` (physics t ${PH.t.toFixed(5)} kind ${PH.kind})`}`;
  if (!ta) return null;
  const T = tileHit(), P = physHit();
  // f32 positions: 1e-4 m along the ray, or 1e-5 m across the surface entered (a grazing ray turns a sub-micron f32
  // error in the face into a long way along itself)
  const dn = q ? Math.abs(q.d[0] * T.nx + q.d[1] * T.ny + q.d[2] * T.nz) : 1;
  if (!(near(T.t, P.t, 1e-4) || Math.abs(T.t - P.t) * dn <= 1e-5)) return `t: tile ${T.t}, physics ${P.t}`;
  if (T.kind !== P.kind) return `kind: tile ${T.kind}, physics ${P.kind}`;
  if ((T.flags & CF.initial) !== (P.flags & CF.initial)) return `initial: tile ${T.flags}, physics ${P.flags}`;
  if (!(T.flags & CF.seal) && !(near(T.nx, P.nx, 1e-3) && near(T.ny, P.ny, 1e-3) && near(T.nz, P.nz, 1e-3))) return `normal: tile (${T.nx}, ${T.ny}, ${T.nz}), physics (${P.nx}, ${P.ny}, ${P.nz})`;
  return null;
}
function same(W: World, P: PhysicsWorld, q: Q, what: string) {
  const bad = agree(both(W, P, q), (q.r ?? 0) > 0 || (q.h ?? 0) > 0, W, q);
  assert.equal(bad, null, `${what}: ${bad}`);
}
/** D1: the tile model passes where the closed set touches */
function closedOnly(W: World, P: PhysicsWorld, q: Q, what: string) {
  const [ta, pa] = both(W, P, q);
  assert.ok(!ta && pa, `${what} (D1): tile ${ta}, physics ${pa}`);
}

// ------------------------------------------------------------------------------------------------ the spatial scenes

test('terrain and low props: faces and tops agree; a ray in the floor plane is D1', () => {
  const W = flatWorld(), i = 50, j = 50, x = C(W, i), z = C(W, j);
  W.map.elev[K(W, i + 3, j)] = 1;
  W.map.platform[K(W, i + 1, j)] = 0.7;
  const P = buildTilePhysics(W);
  same(W, P, { o: [x, 5, z], d: [0, -1, 0], maxT: 10 }, 'straight down');
  same(W, P, { o: [x, 0.5, z], d: [1, 0, 0], maxT: 10 }, 'the side of the 0.7 m prop');
  same(W, P, { o: [x, 0.8, z], d: [1, 0, 0], maxT: 10 }, 'over the prop, into the 1 m rise');
  same(W, P, { o: [x, 1.2, z], d: [1, 0, 0], maxT: 10 }, 'over the rise');
  assert.ok(both(W, P, { o: [x, 0, z], d: [1, 0, 0], maxT: 10 })[1] && PH.t === 0 && PH.flags & CF.initial, 'D1: a start on the ground is inside it on physics');
  assert.equal(P.clear(x, 2, z, x, 0, z, SK_WORLD, 0, STOPS.sight), segmentClear(W, x, 2, z, x, 0, z), 'a segment ending on the ground is clear');
  assert.equal(P.clear(x, 2, z, x, -0.01, z, SK_WORLD, 0, STOPS.sight), false);
  P.dispose();
});

test('stairs: the ramp plane, from above and up the flight', () => {
  const W = flatWorld(), i = 60, j = 40, M = W.map;
  M.elev[K(W, i, j - 1)] = 1; M.stairs[K(W, i, j)] = 1; M.stairs[K(W, i, j + 1)] = 1;
  const P = buildTilePhysics(W);
  for (const f of [0.1, 0.25, 0.5, 0.9, 1.3, 1.75]) same(W, P, { o: [C(W, i), 3, X(W, j) + f], d: [0, -1, 0], maxT: 10 }, `down onto the ramp at ${f}`);
  same(W, P, { o: [C(W, i), 0.25, j + 3 - W.half], d: [0, 0, -1], maxT: 10 }, 'up the flight');
  // across the flight under its plane: the tile column is solid down from the plane, and so is the wedge piece
  same(W, P, { o: [C(W, i) - 3, 0.3, X(W, j) + 0.5], d: [1, 0, 0], maxT: 10 }, 'across the wedge');
  P.dispose();
});

test('decks: underside, top, underpass, slab edge, masks; a wall under a deck; a chasm and a bridge over it', () => {
  const W = flatWorld(), i = 40, j = 70, k = K(W, i, j), x = C(W, i), z = C(W, j);
  W.over![k] = 3; W.over![k + 1] = 3;
  const a = 30, b = 30, ka = K(W, a, b), xa = C(W, a), za = C(W, b);
  W.map.wall[ka] = 1; W.over![ka] = 3;
  const kv = K(W, a + 5, b);
  W.voids![kv] = 1; W.map.wall[kv] = 1; W.map.elev[kv] = -6;
  const kb = K(W, a + 8, b);
  W.voids![kb] = 1; W.map.wall[kb] = 1; W.map.elev[kb] = -6; W.over![kb] = 1;
  const P = buildTilePhysics(W);
  same(W, P, { o: [x, 0.5, z], d: [0, 1, 0], maxT: 10 }, 'up into the underside');
  same(W, P, { o: [x, 6, z], d: [0, -1, 0], maxT: 10 }, 'down onto the top');
  same(W, P, { o: [X(W, i) - 2, 1.5, z], d: [1, 0, 0], maxT: 6 }, 'through the underpass');
  same(W, P, { o: [X(W, i) - 2, 2.7, z], d: [1, 0, 0], maxT: 6 }, 'into the slab edge');
  same(W, P, { o: [X(W, i) - 2, 3.4, z], d: [1, 0, 0], maxT: 6 }, 'over it');
  same(W, P, { o: [x, 0.5, z], d: [0, 1, 0], maxT: 10, mask: SK_WORLD & ~SK.deck }, 'a mask without decks');
  same(W, P, { o: [x, 2, z], d: [0, -1, 0], maxT: 10 }, 'from the underpass down to the ground');
  same(W, P, { o: [X(W, a) - 1, 3.5, za], d: [1, 0, 0], maxT: 5 }, 'above a deck over a wall');
  same(W, P, { o: [X(W, a) - 1, 2.7, za], d: [1, 0, 0], maxT: 5 }, 'the slab over the wall');
  same(W, P, { o: [X(W, a) - 1, 1, za], d: [1, 0, 0], maxT: 5 }, 'the wall up to the underside');
  same(W, P, { o: [C(W, a + 5), 2, za], d: [0, -1, 0], maxT: 6 }, 'down a chasm (within the bounds)');
  same(W, P, { o: [C(W, a + 8), 2, za], d: [0, -1, 0], maxT: 30 }, 'a bridge over a chasm');
  // D5: the tile chasm has no floor and its neighbours' columns go down forever; the model starts at its floor
  const [tf, pf] = both(W, P, { o: [C(W, a + 5), -7.5, za], d: [1, 0, 0], maxT: 30 });
  assert.ok(tf && !pf && TH.y < -7, `D5: below the bounds floor (-7 m), into the neighbour's column: tile ${tf} at y ${TH.y.toFixed(2)}, physics ${pf}`);
  void xa;
  P.dispose();
});

test('decks on generated maps (Mt. Moon, Chargestone Cave): underside, top and the line through the slab', () => {
  for (const loc of ['mt-moon', 'chargestone-cave']) {
    const rules = { ...defaultRules, worldgen: { ...defaultRules.worldgen, mode: 'generated' as const, locations: { meadow: loc } } };
    const W = new World(rules, BIOMES.meadow, 4), m = W.map, S = m.w, P = buildTilePhysics(W);
    let tested = 0;
    for (let k = 0; k < S * S && tested < 20; k++) {
      const ov = m.over?.[k] ?? 0;
      if (ov <= 0 || m.wall[k] || W.isVoid(k)) continue;
      const x = (k % S) - W.half + 0.5, z = ((k / S) | 0) - W.half + 0.5, g = W.height(x, z);
      same(W, P, { o: [x, g + 0.3, z], d: [0, 1, 0], maxT: 20 }, `${loc} ${k}: up to the underside`);
      same(W, P, { o: [x, ov + 2, z], d: [0, -1, 0], maxT: 20 }, `${loc} ${k}: down to the top`);
      assert.equal(P.clear(x, ov + 0.9, z, x, g + 0.6, z, SK_WORLD, 0, STOPS.sight), false);
      assert.equal(P.clear(x, g + 0.3, z, x, ov - DECK_SLAB - 0.05, z, SK_WORLD, 0, STOPS.sight), true);
      tested++;
    }
    assert.ok(tested > 5, `${loc}: ${tested} deck tiles`);
    P.dispose();
  }
});

test('walls and the map edge; corners: two touching walls stop a ray on both, one wall\'s corner is D1', () => {
  const W = flatWorld(), i = 20, j = 20, x = C(W, i), z = C(W, j);
  W.map.wall[K(W, i + 2, j)] = 1;
  const a = 40, b = 40;
  W.map.wall[K(W, a + 1, b)] = 1; W.map.wall[K(W, a, b + 1)] = 1;
  const c = 60;
  W.map.wall[K(W, c + 1, b)] = 1;
  const e = 80;
  for (let d = 0; d < 4; d++) W.map.wall[K(W, e, j + d)] = 1;
  W.map.wall[K(W, a + 5, b)] = 1;
  const P = buildTilePhysics(W);
  same(W, P, { o: [x, 0.5, z], d: [1, 0, 0], maxT: 10 }, 'a wall face');
  same(W, P, { o: [x, 50, z], d: [1, 0, 0], maxT: 10 }, 'a bare wall at 50 m (within EDGE_PAD of the bounds top)');
  same(W, P, { o: [x, 0.5, z], d: [-1, 0, 0], maxT: 100 }, 'the west edge');
  same(W, P, { o: [x, 0.5, z], d: [-1, 0, 0], maxT: 100, mask: SK_WORLD & ~SK.bounds }, 'edge ignored');
  same(W, P, { o: [-W.half - 5, 0.5, z], d: [1, 0, 0], maxT: 100 }, 'a start outside the map is inside the edge');
  same(W, P, { o: [-W.half - 5, 0.5, z], d: [1, 0, 0], maxT: 100, mask: SK_WORLD & ~SK.bounds }, 'outside with the edge ignored: walks in');
  // the tile model's corner seal is a plain contact of the closed sets
  const [ts, ps] = both(W, P, { o: [C(W, a), 0.5, C(W, b)], d: [ROOT2, 0, ROOT2], maxT: 5 });
  assert.ok(ts && ps && TH.flags & CF.seal && near(TH.t, PH.t, 1e-4) && PH.kind === SK.wall, 'two touching walls');
  closedOnly(W, P, { o: [C(W, c), 0.5, C(W, b)], d: [ROOT2, 0, ROOT2], maxT: 5 }, 'one wall: grazing its corner');
  same(W, P, { o: [C(W, c) + 1e-6, 0.5, C(W, b)], d: [ROOT2, 0, ROOT2], maxT: 5 }, 'a hair east of the corner');
  same(W, P, { o: [X(W, a + 5), 0.5, C(W, b) - 3], d: [0, 0, 1], maxT: 6 }, 'along the west face line');
  closedOnly(W, P, { o: [X(W, a + 6), 0.5, C(W, b) - 3], d: [0, 0, 1], maxT: 6 }, 'along the east face line');
  const tx = X(W, e), tz = X(W, j + 1), L = Math.hypot(3, 1.5);
  same(W, P, { o: [tx - 3, 0.5, tz - 1.5], d: [3 / L, 0, 1.5 / L], maxT: 10 }, 'at the seam of a row of walls');
  same(W, P, { o: [tx + 0.5, 0.5, X(W, j + 6)], d: [0, 0, -1], maxT: 10 }, 'up the row');
  P.dispose();
});

test('fat sweeps: rounded-square footprints, corner passes and half-height against the ground', () => {
  const W = flatWorld(), i = 50, j = 80;
  for (let d = 2; d < 7; d++) W.map.wall[K(W, i + d, j)] = 1;
  const a = 30, b = 30;
  W.map.wall[K(W, a, b)] = 1;
  const P = buildTilePhysics(W), z0 = X(W, j), sx = C(W, i);
  same(W, P, { o: [sx, 0.5, z0 - 0.2], d: [1, 0, 0], maxT: 10, r: 0.3 }, 'the first wall\'s rounded corner');
  same(W, P, { o: [sx, 0.5, z0 - 0.35], d: [1, 0, 0], maxT: 10, r: 0.3 }, '0.35 m off');
  const cx = X(W, a), cz = X(W, b);
  for (const dist of [0.32, 0.28]) {
    const s = dist * Math.SQRT2;
    same(W, P, { o: [cx - 3, 0.5, cz - s + 3], d: [ROOT2, 0, -ROOT2], maxT: 10, r: 0.3 }, `corner pass at ${dist} m`);
  }
  same(W, P, { o: [sx, 0.2, z0 - 3], d: [1, 0, 0], maxT: 3, r: 0.1, h: 0.3 }, 'h 0.3 at 0.2 m starts in the ground');
  same(W, P, { o: [sx, 0.2, z0 - 3], d: [1, 0, 0], maxT: 3, r: 0.1, h: 0.1 }, 'h 0.1 clears it');
  P.dispose();
});

test('initial overlap and skipInitialWorld; solidAt', () => {
  const W = flatWorld(), i = 60, j = 60, x = C(W, i), z = C(W, j);
  W.map.wall[K(W, i, j)] = 1; W.map.wall[K(W, i + 2, j)] = 1;
  const P = buildTilePhysics(W);
  same(W, P, { o: [x, 1, z], d: [1, 0, 0], maxT: 5 }, 'inside a wall');
  same(W, P, { o: [x, 1, z], d: [1, 0, 0], maxT: 5, flags: QF.skipInitialWorld }, 'skip it: the next wall');
  same(W, P, { o: [C(W, i + 1), -0.5, z], d: [0, 1, 0], maxT: 5 }, 'from under the ground');
  same(W, P, { o: [C(W, i + 1), -0.5, z], d: [0, 1, 0], maxT: 5, flags: QF.skipInitialWorld }, 'leaving the ground upward');
  same(W, P, { o: [x, 1, z], d: [1, 0, 0], maxT: 5, r: 0.2, h: 0.2, flags: QF.skipInitialWorld }, 'a fat start inside, skipped');
  for (const [px, py, pz] of [[x, 1, z], [C(W, i + 1), 1, z], [C(W, i + 1), -0.5, z], [C(W, i + 1), 0, z]] as [number, number, number][]) {
    assert.equal(P.solidAt(px, py, pz, SK_WORLD), solidAt(W, px, py, pz), `solidAt (${px}, ${py}, ${pz})`);
  }
  P.dispose();
});

test('water and ice: a liquid surface, no bed; frozen water is terrain at the ice', () => {
  const W = flatWorld(), i = 20, j = 90, k = K(W, i, j), x = C(W, i), z = C(W, j);
  W.map.terrain[k] = T.water; W.map.terrain[k + 1] = T.water;
  Object.assign(W.cells, { terrain: W.map.terrain }); // the cells read the private map's terrain
  W.cells.state[k + 1] = CS.frozen;
  const P = buildTilePhysics(W);
  same(W, P, { o: [x, 2, z], d: [0, -1, 0], maxT: 5 }, 'down onto water');
  same(W, P, { o: [x, 2, z], d: [0, -1, 0], maxT: 5, mask: SK_WORLD & ~SK.liquid }, 'a mask without liquids');
  same(W, P, { o: [x + 1, 2, z], d: [0, -1, 0], maxT: 5 }, 'down onto ice');
  assert.equal(P.liquidAt(x, -0.5, z), 1);
  assert.equal(P.level, W.height(x, z), 'the liquid\'s surface');
  assert.equal(P.liquidAt(x + 1, -0.5, z), 0, 'no liquid under ice');
  assert.equal(P.supportBelow(x + 1, 2, z), W.height(x + 1, z), 'the ice is support');
  P.dispose();
});

test('cover: foliage (QF.foliage) and wall tops (QF.tops), with stops-shots and stops-sight kept apart', () => {
  const W = flatWorld(), m = W.map, j = 40;
  // a bush (a low prop of a foliage material), a berry bush (a foliage wall prop, top 1.6) and a sign (a wall prop, 1.1)
  m.props = [{ kind: 'bush', x: 40, y: j, w: 1, h: 1, variant: 0 }, { kind: 'berry', x: 50, y: j, w: 1, h: 1, variant: 0 }, { kind: 'sign', x: 60, y: j, w: 1, h: 1, variant: 0 }];
  m.platform[K(W, 40, j)] = 0.7; m.wall[K(W, 50, j)] = 1; m.wall[K(W, 60, j)] = 1;
  Object.assign(W, { wallTop: new Float64Array(W.w * W.h).fill(Infinity) });
  W.wallTop[K(W, 50, j)] = 1.6; W.wallTop[K(W, 60, j)] = 1.1;
  const P = buildTilePhysics(W), z = C(W, j);
  for (const flags of [0, QF.foliage, QF.tops, QF.foliage | QF.tops]) for (const [x0, y] of [[38, 0.5], [38, 0.8], [48, 1], [48, 2], [48, -0.3], [58, 0.8], [58, 1.5], [58, 30]] as [number, number][]) {
    same(W, P, { o: [X(W, x0), y, z], d: [1, 0, 0], maxT: 4, flags }, `flags ${flags} from x ${x0} at ${y} m`);
    same(W, P, { o: [C(W, x0 + 2), y + 3, z], d: [0, -1, 0], maxT: 6, flags }, `flags ${flags} down at x ${x0 + 2} from ${y + 3} m`);
    const sight = P.clear(X(W, x0), y, z, X(W, x0 + 4), y, z, SK_WORLD, flags, STOPS.sight);
    assert.equal(sight, segmentClear(W, X(W, x0), y, z, X(W, x0 + 4), y, z, SK_WORLD, flags), `sight, flags ${flags}, x ${x0}, ${y} m`);
    assert.equal(P.clear(X(W, x0), y, z, X(W, x0 + 4), y, z, SK_WORLD, flags, STOPS.shots), sight, 'the adapter sets blocksSight = blocksShots (WORLDGEN3D Q15.4 splits them later)');
  }
  P.dispose();
});

// ------------------------------------------------------------------------------------------------ F12 (World.sight)

test('F12 on physics: the seam\'s sight does not see through a wall corner (the tile todo, passing)', () => {
  const W = flatWorld(), a = 40, b = 40;
  W.map.wall[K(W, a, b)] = 1;
  const B = new PhysicsBridge(), S = B.seamFor(W) as PhysicsSeam;
  const cx = X(W, a), cz = X(W, b);
  let tileSaw = 0;
  for (let s = 0; s < 50; s++) {
    const off = s * 0.01, x0 = cx - 3 + off, z0 = cz + 0.2 + 3 - off;
    assert.equal(S.sight(x0, 0.5, z0, x0 + 6, 0.5, z0 - 6), false, `phase ${s}`);
    if (W.sight(x0, 0.5, z0, x0 + 6, 0.5, z0 - 6)) tileSaw++;
  }
  assert.ok(tileSaw > 0, `the tile World's sampled sight still sees through on ${tileSaw} of 50 phases`);
  // and 0.15 m below a deck's underside (inside the movement snap band) both see
  const W2 = flatWorld(), i = 40, j = 70;
  for (let d = 0; d < 4; d++) W2.over![K(W2, i + d, j)] = 3;
  const S2 = B.seamFor(W2), y = 3 - DECK_SLAB - 0.15;
  assert.ok(y > 3 - DECK_REACH && S2.sight(X(W2, i) - 1, y, C(W2, j), X(W2, i) + 5, y, C(W2, j)) && W2.sight(X(W2, i) - 1, y, C(W2, j), X(W2, i) + 5, y, C(W2, j)));
  B.dispose();
});

// ------------------------------------------------------------------------------------------------ adapter maps

function maps(): { name: string; rules: Rules; seed: number }[] {
  const gen = (loc: string) => ({ ...defaultRules, worldgen: { ...defaultRules.worldgen, mode: 'generated' as const, locations: { meadow: loc } } });
  const out = [{ name: 'range', rules: { ...defaultRules, worldgen: { ...defaultRules.worldgen, arena: 'range' } } as Rules, seed: 1 }];
  for (const id of Object.keys(HABITATS)) out.push({ name: `${id}@1`, rules: gen(id), seed: 1 });
  for (const id of ['mt-moon', 'chargestone-cave', 'viridian-forest']) out.push({ name: `${id}@4`, rules: gen(id), seed: 4 });
  return out;
}

test('adapter maps: rays, sweeps, segments and points agree on the range, every habitat and three locations', () => {
  const rng = new Rng(11), tally: Record<string, number> = {};
  let n = 0;
  for (const src of maps()) {
    const W = new World(src.rules, BIOMES.meadow, src.seed), P = buildTilePhysics(W), lim = W.half - 1;
    const floor = W.tiles.map.elev.reduce((a, b) => Math.min(a, b), Infinity) - 1;
    for (let s = 0; s < 1200; s++) {
      const x = rng.range(-lim, lim), z = rng.range(-lim, lim), deck = rng.next() < 0.3 ? 99 : undefined;
      const y = W.height(x, z, deck) + rng.range(0.05, 3.5);
      const a = rng.range(0, Math.PI * 2), p = rng.range(-1.2, 0.9), c = Math.cos(p);
      const d: [number, number, number] = [Math.cos(a) * c, Math.sin(p), Math.sin(a) * c];
      const flags = [0, QF.foliage, QF.tops, QF.foliage | QF.tops, QF.skipInitialWorld | QF.foliage | QF.tops][s % 5];
      const fat = s % 3 === 0, r = fat ? rng.range(0.05, 0.6) : 0, h = fat ? rng.range(0, 0.5) : 0;
      const q: Q = { o: [x, y, z], d, maxT: rng.range(2, 40), flags, r, h };
      const res = both(W, P, q);
      n++;
      const bad = agree(res, fat, W, q);
      if (!bad) { tally.agree = (tally.agree ?? 0) + 1; continue; }
      // the documented classes
      const k = res[0] ? W.tile(TH.x, TH.z) : -1;
      if (res[0] && !res[1] && (TH.y < floor + 1e-6 || TH.y > W.height(TH.x, TH.z, 99) + 8 + EDGE_PAD - 1)) { tally.D5 = (tally.D5 ?? 0) + 1; continue; }
      if (fat && ((k >= 0 && W.tiles.map.stairs[k]) || (res[1] && W.tiles.map.stairs[W.tile(PH.x, PH.z)] === 1) || nearStairs(W, x, z, d, q.maxT))) { tally.D4 = (tally.D4 ?? 0) + 1; continue; }
      if (flags & QF.skipInitialWorld && P.cast(x, y, z, d[0], d[1], d[2], q.maxT, SK_WORLD, flags & ~QF.skipInitialWorld, STOPS.shots, GH, r, h) && GH.t === 0) { tally.D6 = (tally.D6 ?? 0) + 1; continue; }
      assert.fail(`${src.name}: undocumented difference: ${bad} for ${JSON.stringify(q)}`);
    }
    // segments (line of sight) and points
    for (let s = 0; s < 400; s++) {
      const x0 = rng.range(-lim, lim), z0 = rng.range(-lim, lim), x1 = Math.max(-lim, Math.min(lim, x0 + rng.range(-20, 20))), z1 = Math.max(-lim, Math.min(lim, z0 + rng.range(-20, 20)));
      const y0 = W.height(x0, z0) + rng.range(0.1, 3), y1 = W.height(x1, z1) + rng.range(0.1, 3), flags = s % 2 ? 0 : QF.foliage | QF.tops;
      const t = segmentClear(W, x0, y0, z0, x1, y1, z1, MASK.los, flags), p = P.clear(x0, y0, z0, x1, y1, z1, MASK.los, flags, STOPS.sight);
      n++;
      if (t === p) { tally.agree = (tally.agree ?? 0) + 1; continue; }
      assert.fail(`${src.name}: segment (${x0}, ${y0}, ${z0}) → (${x1}, ${y1}, ${z1}) flags ${flags}: tile ${t}, physics ${p}`);
    }
    for (let s = 0; s < 400; s++) {
      const x = rng.range(-lim, lim), z = rng.range(-lim, lim), y = W.height(x, z) + rng.range(-2, 3);
      const flags = s % 2 ? 0 : QF.foliage | QF.tops;
      n++;
      if (solidAt(W, x, y, z, SK_WORLD, flags) === P.solidAt(x, y, z, SK_WORLD, flags)) { tally.agree = (tally.agree ?? 0) + 1; continue; }
      if (y < floor) { tally.D5 = (tally.D5 ?? 0) + 1; continue; }
      assert.fail(`${src.name}: solidAt (${x}, ${y}, ${z}) flags ${flags}: tile ${solidAt(W, x, y, z, SK_WORLD, flags)}, physics ${P.solidAt(x, y, z, SK_WORLD, flags)}`);
    }
    P.dispose();
  }
  console.log(`physics parity on adapter maps: ${n} queries, ${JSON.stringify(tally)}`);
  // every difference is a documented class (an undocumented one failed above); D6 needs a skipping cast that starts
  // inside a solid (a fifth of the casts skip, many start within 0.5 m of the ground), D5 a contact outside the bounds
  assert.ok((tally.D5 ?? 0) < n * 0.02 && (tally.agree ?? 0) > n * 0.9, `agreement ${tally.agree} of ${n}`);
});

/** does the cast pass within a metre of a stairs tile? (D4 applies to fat casts near ramps) */
function nearStairs(W: World, x: number, z: number, d: [number, number, number], L: number): boolean {
  const m = W.tiles.map;
  for (let t = 0; t <= L; t += 0.25) {
    for (const [ox, oz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = W.tile(x + d[0] * t + ox, z + d[2] * t + oz);
      if (k >= 0 && m.stairs[k]) return true;
    }
  }
  return false;
}

// ------------------------------------------------------------------------------------------------ the actor queries

test('the actor queries on physics: a live crowd\'s sweeps and sight-checked overlaps match the tile run contact for contact', () => {
  // one run's state, asked both ways: B is A with the physics bridge attached (two runs would drift apart at f32 level
  // through the shots' contacts, so their actors would not stand in the same places)
  const A = createRun({ seed: 2, species: 'cyndaquil', mods: [crowd(200)] });
  for (let t = 0; t < 240; t++) step(A, withAim(A, botInput(A)));
  const bridge = new PhysicsBridge(), B = { ...A, physics: bridge } as SimContext;
  const rng = new Rng(3), oa = new Contacts(32), ob = new Contacts(32);
  const shot = spatialQuery({ mask: MASK.shot, block: SK.enemy | SK.body, pierce: 2, worldR: 0.1, actorR: 0.4, actorH: 0.4, flags: QF.foliage | QF.tops });
  const thin = spatialQuery({ mask: MASK.shot, block: SK.enemy | SK.body, pierce: 2, actorR: 0.4, actorH: 0.4, flags: QF.foliage | QF.tops });
  const area = spatialQuery({ mask: SK_WORLD | SK_ACTOR, flags: QF.sight | QF.foliage });
  /** the lists agree: every actor contact before both world stops exactly, the world stop within the D2 band */
  const cmp = (what: string, q: typeof shot | null, o?: [number, number, number], d?: number[], L = 0) => {
    const wa = oa.stop >= 0 && oa.kind[oa.stop] & SK_WORLD ? oa.t[oa.stop] : Infinity, wb = ob.stop >= 0 && ob.kind[ob.stop] & SK_WORLD ? ob.t[ob.stop] : Infinity;
    const cut = Math.min(wa, wb) - 1e-6, pre = (c: Contacts) => { let n = 0; while (n < c.n && c.t[n] < cut) n++; return n; };
    const na = pre(oa), nb = pre(ob);
    assert.equal(na, nb, `${what}: actor contacts before the world`);
    for (let i = 0; i < na; i++) {
      assert.equal(oa.kind[i], ob.kind[i], `${what} #${i}: kind`);
      assert.equal(oa.id[i], ob.id[i], `${what} #${i}: id`);
      assert.ok(near(oa.t[i], ob.t[i], 1e-9), `${what} #${i}: t ${oa.t[i]} vs ${ob.t[i]}`);
      assert.equal(oa.flags[i], ob.flags[i], `${what} #${i}: flags`);
    }
    assert.equal(oa.occluded, ob.occluded, `${what}: occluded`);
    if (!q || wa === wb) return;
    // D2: physics' world stop lies between the grown tile volume's contact and the tile volume's
    const g = raycastWorld(A.world, o![0], o![1], o![2], d![0], d![1], d![2], L, q.mask & SK_WORLD, GH, q.worldR + SWEEP_TOL, q.worldH + SWEEP_TOL, q.flags);
    assert.ok(g && GH.t <= wb + 1e-4 && wb <= wa + SWEEP_LATE, `${what}: world stop ${wb} outside [${GH.t}, ${wa}]`);
  };
  for (let s = 0; s < 400; s++) {
    const P = A.player, a = rng.range(0, Math.PI * 2), p = rng.range(-0.3, 0.2);
    const o: [number, number, number] = [P.x, P.y + rng.range(0.3, 1.5), P.z];
    const d = [Math.cos(a) * Math.cos(p), Math.sin(p), Math.sin(a) * Math.cos(p)];
    sweep(A, ...o, d[0], d[1], d[2], 26, shot, oa); sweep(B, ...o, d[0], d[1], d[2], 26, shot, ob);
    cmp(`sweep ${s}`, shot, o, d, 26);
    sweep(A, ...o, d[0], d[1], d[2], 26, thin, oa); sweep(B, ...o, d[0], d[1], d[2], 26, thin, ob);
    cmp(`thin sweep ${s}`, null);
    assert.ok(oa.stop < 0 || !(oa.kind[oa.stop] & SK_WORLD) || near(oa.stopT, ob.stopT, 1e-4), `thin sweep ${s}: world stop ${oa.stopT} vs ${ob.stopT}`);
    overlapCylinder(A, o[0], o[1] - 1, o[1] + 1.5, o[2], 6, area, oa); overlapCylinder(B, o[0], o[1] - 1, o[1] + 1.5, o[2], 6, area, ob);
    cmp(`overlap ${s}`, null);
  }
  bridge.dispose();
});
