// src/nav on hand-made fixtures (task I3; docs/OVERHAUL_3D.md "Navigation (I3)"): the rules' cell counts, the width
// groups' widths and heights, areas, off-mesh links with their needs, TileCache-style obstacles and per-tile rebuilds,
// determinism, the volume-routing graph's reader and wasm memory over many builds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { navWasmBytes } from './setup/nav';
import { defaultRules, type Rules } from '../src/rules/defaults';
import { SPECIES_BY_ID } from '../src/rules/species';
import { enemyHeight, footprintOf } from '../src/rules/sizing';
import { NavWorld, GROUPS } from '../src/nav/world';
import { AREA, NavSoup } from '../src/nav/build';
import { NONE } from '../src/nav/graph';
import { VolumeRoutes } from '../src/nav/routes';
import { fixture, type Fixture } from './fixtures/navmodels';

const rules = defaultRules;
/** a smaller tile so the fixtures span several tiles (12.8 m is the map setting) */
const small = (tileSize = 64): Rules => ({ ...rules, nav: { ...rules.nav, tileSize } });
const P = new Float64Array(3);
const OUT: [number, number] = [0, 0];

function withNav<T>(f: Fixture, r: Rules, fn: (N: NavWorld) => T): T {
  const N = NavWorld.build(fixture(f), r);
  try { return fn(N); } finally { N.dispose(); }
}
const g = (name: string) => GROUPS.indexOf(name as never);

test('rules.nav: every Recast number is an integer cell count, the groups in ascending height', () => {
  const N = rules.nav;
  for (const k of ['walkableClimb', 'recastClimb', 'tileSize', 'maxEdgeLen', 'minRegionArea', 'mergeRegionArea', 'maxVertsPerPoly', 'giantHeight'] as const) assert.ok(Number.isInteger(N[k]), k);
  assert.equal(N.walkableClimb, 12, '12 cells = 0.6 m, written (floor(0.6 / 0.05) is 11 in float)');
  assert.equal(Math.floor(0.6 / 0.05), 11, 'the float trap S1 §8 names');
  assert.equal(N.recastClimb, N.walkableClimb - 1, 'Recast tests rounded-up tops: one cell under the step keeps every joined rise <= 0.6 m');
  assert.equal(N.cs, 0.1); assert.equal(N.ch, 0.05); assert.equal(N.walkableSlopeAngle, 45.5);
  let last = 0;
  for (const name of GROUPS) {
    const a = N.groups[name];
    assert.ok(Number.isInteger(a.radius) && Number.isInteger(a.height), name);
    assert.ok(a.height >= last, 'ascending agent height'); last = a.height;
  }
});

test('each group\'s agent covers its widest footprint and the tallest body today\'s gates carry for it', () => {
  const N = rules.nav, body = (id: string) => rules.size.classes.find((c) => c.id === id)!.body;
  // footprints: every class of the group (WORLDGEN3D Q7), at the class value (no tilt: SIZING "Footprint")
  const groupClasses: Record<string, string[]> = { narrow: ['tiny', 'small', 'medium'], large: ['large'], xl: ['xl'] };
  for (const [name, classes] of Object.entries(groupClasses)) {
    const widest = Math.max(...classes.map(body));
    assert.ok(N.groups[name as 'narrow'].radius * N.cs >= widest - 1e-9, `${name}: ${N.groups[name as 'narrow'].radius} cells cover ${widest} m`);
    assert.ok((N.groups[name as 'narrow'].radius - 1) * N.cs < widest, `${name}: the smallest such count`);
  }
  // heights: scripts/navwalk.ts's walkers and trainers
  const gate: Record<string, string[]> = { narrow: ['slugma', 'totodile'], large: ['heracross'], xl: ['onix', 'feraligatr'] };
  for (const [name, ids] of Object.entries(gate)) {
    const tallest = Math.max(...ids.map((id) => enemyHeight(SPECIES_BY_ID[id], 1, rules)));
    const a = N.groups[name as 'narrow'];
    assert.ok(a.height * N.ch >= tallest, `${name}: ${a.height} cells cover ${tallest.toFixed(3)} m`);
    assert.ok((a.height - 1) * N.ch < tallest, `${name}: the smallest such count`);
    for (const id of ids) assert.ok(footprintOf(SPECIES_BY_ID[id], 1, rules) <= a.radius * N.cs, `${id} fits ${name}'s radius`);
  }
  assert.ok(N.giantHeight * N.ch >= 3.57 && (N.giantHeight - 1) * N.ch < 3.57, 'the giant report height covers the 3.57 m cap');
});

test('a floor with a wall across it: every group routes round the gap, by corridor following', () => {
  // a 24 x 24 m floor, a wall from the north edge to 4 m short of the south edge
  const f: Fixture = { size: [24, 24], floors: [{ x0: -12, z0: -12, x1: 12, z1: 12, y: 0 }], walls: [{ x0: -0.5, z0: -12, x1: 0.5, z1: 8, y: 3 }] };
  withNav(f, small(), (N) => {
    for (const name of GROUPS) {
      const G = g(name), F = N.field(G, 'goal', 8, 0, -8, 2)!;
      assert.ok(F, name);
      // from the far side of the wall the first corner is the wall's free end (south), not straight at the goal
      assert.equal(N.steer(G, F, -8, 0, -8, 2, OUT), 1, name);
      assert.ok(OUT[1] > 0.5, `${name} heads south round the wall (${OUT.map((v) => v.toFixed(2))})`);
      const d = N.distance(G, F, -8, 0, -8, 2);
      assert.ok(d > 16 + 8 && d < 60, `${name}: the route goes round (${d.toFixed(1)} m)`);
      // on the goal's polygon there is nothing to follow
      const p = N.locate(G, 8, 0, -8, 0, P);
      assert.equal(p, F.goal);
      assert.equal(N.steer(G, F, 8, 0, -8, 2, OUT), 0);
      // the whole straight path ends at the goal and turns at the wall's end
      const pts = N.graphs[G].straight(F, N.locate(G, -8, 0, -8, 0, P), -8, -8);
      assert.deepEqual(pts[pts.length - 1], [8, -8]);
      assert.ok(pts.some(([x, z]) => Math.abs(x) < 2 && z > 8), `${name} turns at the wall's end: ${JSON.stringify(pts)}`);
    }
  });
});

test('width: a 1.2 m gap admits narrow only, 1.6 m narrow and large, 2.0 m every group', () => {
  // two rooms joined only by a gap of width w in a wall along z = 0
  for (const [w, admits] of [[1.2, ['narrow']], [1.6, ['narrow', 'large']], [2.0, ['narrow', 'large', 'xl']]] as const) {
    const f: Fixture = { size: [24, 24], floors: [{ x0: -12, z0: -12, x1: 12, z1: 12, y: 0 }], walls: [{ x0: -12, z0: -0.5, x1: -w / 2, z1: 0.5, y: 3 }, { x0: w / 2, z0: -0.5, x1: 12, z1: 0.5, y: 3 }] };
    withNav(f, small(), (N) => {
      for (const name of GROUPS) {
        const G = g(name), F = N.field(G, 'goal', 0, 0, 8, 2)!;
        assert.equal(N.reaches(G, F, 0, 0, -8, 0), (admits as readonly string[]).includes(name), `${name} through ${w} m`);
      }
    });
  }
});

test('headroom: a 2.4 m gap under a deck admits narrow and large, not Extra Large (56 cells); the giant report height is shut out of 3.5 m', () => {
  // a corridor 6 m wide whose only way through runs under a slab 2.4 m above the floor (walls either side)
  const deck = (gap: number): Fixture => ({ size: [24, 24], floors: [{ x0: -12, z0: -12, x1: 12, z1: 12, y: 0 }], walls: [{ x0: -12, z0: -2, x1: -3, z1: 2, y: 6 }, { x0: 3, z0: -2, x1: 12, z1: 2, y: 6 }], slabs: [{ x0: -3, z0: -2, x1: 3, z1: 2, y0: gap, y1: gap + 0.6 }] });
  withNav(deck(2.4), small(), (N) => {
    for (const name of GROUPS) {
      const G = g(name), F = N.field(G, 'goal', 0, 0, 8, 2)!;
      assert.equal(N.reaches(G, F, 0, 0, -8, 0), name !== 'xl', `${name} under 2.4 m`);
    }
  });
  const giant = { name: 'giant', agent: { radius: rules.nav.groups.xl.radius, height: rules.nav.giantHeight } };
  for (const [gap, ok] of [[3.5, false], [3.7, true]] as const) {
    const N = NavWorld.build(fixture(deck(gap)), small(), [giant]);
    try {
      const G = N.group('giant'), F = N.field(G, 'goal', 0, 0, 8, 2)!;
      assert.equal(N.reaches(G, F, 0, 0, -8, 0), ok, `giant under ${gap} m`);
      // the deck's top is walkable too
      assert.notEqual(N.locate(N.group('narrow'), 0, gap + 1, 0, 0, P), NONE);
      assert.ok(Math.abs(P[1] - (gap + 0.6)) < 0.1);
    } finally { N.dispose(); }
  }
});

test('areas: soft soil is AREA.soft, a hazard volume AREA.hazard, and a field priced for hazards goes round one', () => {
  // a floor whose middle band (z -2..2) is soft soil, and a hazard strip (x -4..4) across the middle of it
  const f: Fixture = { size: [24, 24], floors: [{ x0: -12, z0: -12, x1: 12, z1: -2, y: 0 }, { x0: -12, z0: -2, x1: 12, z1: 2, y: 0, soft: true }, { x0: -12, z0: 2, x1: 12, z1: 12, y: 0 }], hazards: [{ x0: -12, z0: -2, x1: 4, z1: 2, y: 0 }] };
  withNav(f, small(), (N) => {
    const G = g('narrow'), Gr = N.graphs[G];
    assert.equal(Gr.area[N.locate(G, 8, 0, 0, 0, P)], AREA.soft);
    assert.equal(Gr.area[N.locate(G, 0, 0, 0, 0, P)], AREA.hazard);
    assert.equal(Gr.area[N.locate(G, 0, 0, 8, 0, P)], AREA.ground);
    const plain = N.field(G, 'plain', 0, 0, 8, 2)!, priced = N.field(G, 'priced', 0, 0, 8, 2, { enter: { [AREA.hazard]: 4096 } })!;
    const d0 = N.distance(G, plain, 0, 0, -8, 2), d1 = N.distance(G, priced, 0, 0, -8, 2);
    assert.ok(d0 < 20, `straight across the strip (${d0.toFixed(1)} m)`);
    assert.ok(d1 > d0 + 4 && d1 < 4096, `round the strip's east end (${d1.toFixed(1)} m)`);
    const path = Gr.path(priced, N.locate(G, 0, 0, -8, 0, P));
    assert.ok(!path.some((p) => Gr.area[p] === AREA.hazard), 'no hazard polygon on the priced route');
  });
});

test('off-mesh links: kind and needs from navInput.links; one-way links one way', () => {
  // two floors with no walkable join (a wall between), one link across it
  const base: Fixture = { size: [24, 24], floors: [{ x0: -12, z0: -12, x1: 12, z1: -1, y: 0 }, { x0: -12, z0: 1, x1: 12, z1: 12, y: 0 }], walls: [{ x0: -12, z0: -1, x1: 12, z1: 1, y: 4 }] };
  const link = (o: Partial<import('../src/world/model').OffMeshLink>) => ({ ...base, links: [{ a: [0, 0, -3], b: [0, 0, 3], kind: 'burrow', bidirectional: true, ...o }] as never });
  withNav(base, small(), (N) => { const F = N.field(0, 'goal', 0, 0, 8, 2); assert.ok(!N.reaches(0, F, 0, 0, -8, 0), 'no link, no route'); });
  withNav(link({}), small(), (N) => {
    const F = N.field(0, 'goal', 0, 0, 8, 2);
    assert.ok(N.reaches(0, F, 0, 0, -8, 0), 'a link with no needs is open to every body');
    assert.equal(N.steer(0, F, 0, 0, -8, 2, OUT), 1);
    assert.ok(OUT[1] > 0.9, 'heads for the link');
    const Gr = N.graphs[0], p = [...Array(Gr.n).keys()].find((q) => Gr.link[q] !== NONE)!;
    assert.equal(Gr.area[p], AREA.link);
  });
  withNav(link({ needs: ['burrow'] }), small(), (N) => {
    assert.ok(!N.reaches(0, N.field(0, 'plain', 0, 0, 8, 2), 0, 0, -8, 0), 'needs burrow: closed to a body without it');
    assert.ok(N.reaches(0, N.field(0, 'burrower', 0, 0, 8, 2, { caps: ['burrow'] }), 0, 0, -8, 0), 'open to one that holds it');
  });
  withNav(link({ bidirectional: false }), small(), (N) => {
    assert.ok(N.reaches(0, N.field(0, 'north', 0, 0, 8, 2), 0, 0, -8, 0), 'a to b');
    assert.ok(!N.reaches(0, N.field(0, 'south', 0, 0, -8, 2), 0, 0, 8, 0), 'not b to a');
  });
});

test('temporary obstacles (TileCache-style): only the tiles they touch rebuild; the route closes and reopens', () => {
  // a 2 m corridor between two rooms; the corridor is the only way
  const f: Fixture = { size: [32, 32], floors: [{ x0: -16, z0: -16, x1: 16, z1: 16, y: 0 }], walls: [{ x0: -16, z0: -0.5, x1: -1, z1: 0.5, y: 3 }, { x0: 1, z0: -0.5, x1: 16, z1: 0.5, y: 3 }] };
  withNav(f, small(64), (N) => {
    const T = N.tiles, total = T.tw * T.th;
    assert.ok(total >= 16, `${total} tiles`);
    const reach = () => N.reaches(0, N.field(0, 'goal', 0, 0, 10, 2), 0, 0, -10, 0);
    assert.ok(reach());
    const before = T.builds;
    const id = N.addObstacle({ kind: 'cylinder', x: 0, y: -0.5, z: 0, r: 0.8, h: 3 });
    const rebuilt = N.update();
    assert.ok(rebuilt.length > 0 && rebuilt.length <= 4, `rebuilt ${rebuilt.length} of ${total}`);
    assert.equal(T.builds - before, rebuilt.length);
    assert.ok(!reach(), 'the obstacle closes the corridor (with the agent radius around it)');
    assert.ok(N.removeObstacle(id));
    N.update();
    assert.ok(reach(), 'removed, the corridor reopens');
    const box = N.addObstacle({ kind: 'box', min: [-1, -0.5, -0.3], max: [1, 3, 0.3] });
    N.update();
    assert.ok(!reach(), 'a box obstacle too');
    N.removeObstacle(box); N.update();
    assert.ok(reach());
  });
});

test('a geometry change rebuilds only the tiles it touches, and they equal a full build', () => {
  const open: Fixture = { size: [32, 32], floors: [{ x0: -16, z0: -16, x1: 16, z1: 16, y: 0 }], walls: [{ x0: -16, z0: -0.5, x1: -1, z1: 0.5, y: 3 }, { x0: 1, z0: -0.5, x1: 16, z1: 0.5, y: 3 }] };
  const shut: Fixture = { ...open, walls: [...open.walls!, { x0: -1, z0: -0.5, x1: 1, z1: 0.5, y: 3 }] };
  const N = NavWorld.build(fixture(open), small(64)), M = NavWorld.build(fixture(shut), small(64));
  try {
    assert.ok(N.reaches(0, N.field(0, 'goal', 0, 0, 10, 2), 0, 0, -10, 0));
    const rebuilt = N.replace(fixture(shut), [{ x0: -1, z0: -0.5, x1: 1, z1: 0.5 }]);
    assert.ok(rebuilt.length > 0 && rebuilt.length < N.tiles.tw * N.tiles.th / 2, `${rebuilt.length} tiles`);
    assert.ok(!N.reaches(0, N.field(0, 'goal', 0, 0, 10, 2), 0, 0, -10, 0), 'the corridor is shut');
    for (let G = 0; G < N.graphs.length; G++) {
      const a = N.graphs[G], b = M.graphs[G];
      assert.equal(a.n, b.n, `${N.names[G]} polygons`);
      assert.deepEqual([...a.vx], [...b.vx]); assert.deepEqual([...a.vz], [...b.vz]); assert.deepEqual([...a.aTo], [...b.aTo]);
    }
  } finally { N.dispose(); M.dispose(); }
});

test('deterministic: the same model builds the same graphs and paths', () => {
  const f: Fixture = { size: [32, 32], floors: [{ x0: -16, z0: -16, x1: 16, z1: 16, y: 0 }], walls: [{ x0: -6, z0: -10, x1: -4, z1: 12, y: 3 }, { x0: 4, z0: -12, x1: 6, z1: 10, y: 3 }], ramps: [{ x0: 8, z0: -4, x1: 12, z1: 4, a: 0, b: 2 }] };
  const sig = () => withNav(f, small(64), (N) => {
    const parts: number[] = [];
    for (let G = 0; G < N.graphs.length; G++) {
      const Gr = N.graphs[G], F = N.field(G, 'goal', 12, 0, 12, 2)!;
      parts.push(Gr.n, ...Gr.vx, ...Gr.vy, ...Gr.vz, ...Gr.aTo, ...F.cost);
      for (const [x, z] of [[-12, -12], [0, 0], [-12, 12]]) parts.push(...Gr.straight(F, N.locate(G, x, 0, z, 2, P), x, z).flat());
    }
    return parts;
  });
  assert.deepEqual(sig(), sig());
});

test('the volume-routing graph (navInput.routes): medium, clear radius, needs and state', () => {
  const R = new VolumeRoutes({
    nodes: [{ position: [0, 4, 0] }, { position: [10, 4, 0] }, { position: [20, 4, 0] }, { position: [10, -2, 10] }, { position: [20, -2, 10] }],
    edges: [
      { a: 0, b: 1, medium: 'air', radius: 2 },
      { a: 1, b: 2, medium: 'air', radius: 0.8, needs: ['fly'] },
      { a: 0, b: 2, medium: 'air', radius: 3, needs: ['fly'], when: { env: 'night' } },
      { a: 1, b: 3, medium: 'water', radius: 1.5, needs: ['dive'] },
      { a: 3, b: 4, medium: 'water', radius: 1.5, needs: ['dive'] },
    ],
  });
  const air = { medium: 'air', radius: 0.5, caps: ['fly'] } as const;
  assert.deepEqual(R.route(0, 2, air)?.nodes, [0, 1, 2]);
  assert.equal(R.route(0, 2, { ...air, radius: 1 }), null, 'the 0.8 m edge is too narrow for a 1 m body');
  assert.deepEqual(R.route(0, 2, { ...air, radius: 1, state: { env: 'night' } })?.nodes, [0, 2], 'the night edge exists at night');
  assert.equal(R.route(0, 2, { medium: 'air', radius: 0.5 }), null, 'no fly, no fly edges');
  assert.ok(Math.abs(R.route(1, 4, { medium: 'water', radius: 1, caps: ['dive'] })!.length - (Math.sqrt(6 * 6 + 10 * 10) + 10)) < 1e-9);
  assert.equal(R.route(1, 4, { medium: 'water', radius: 1 }), null);
  assert.equal(R.nearest([19, -1, 9], { medium: 'water', radius: 1, caps: ['dive'] }), 4);
  assert.throws(() => new VolumeRoutes({ nodes: [{ position: [0, 0, 0] }], edges: [{ a: 0, b: 3, medium: 'air', radius: 1 }] }), /edge 0/);
  // the adapter writes an empty graph: the reader takes it
  assert.equal(new VolumeRoutes({ nodes: [], edges: [] }).n, 0);
});

test('disposal: the wasm memory stays flat over 40 builds and disposals', () => {
  const f: Fixture = { size: [32, 32], floors: [{ x0: -16, z0: -16, x1: 16, z1: 16, y: 0 }], walls: [{ x0: -2, z0: -2, x1: 2, z1: 2, y: 3 }] };
  for (let i = 0; i < 5; i++) withNav(f, small(64), () => {});
  const m0 = navWasmBytes();
  for (let i = 0; i < 40; i++) withNav(f, small(64), (N) => { N.field(0, 'g', 10, 0, 10, 2); });
  assert.equal(navWasmBytes(), m0, `wasm memory ${m0} -> ${navWasmBytes()}`);
});

test('NavSoup: every triangle is inset in plan, floor-standing boxes keep only their sides', () => {
  const soup = new NavSoup(fixture({ size: [8, 8], floors: [{ x0: -4, z0: -4, x1: 4, z1: 4, y: 0 }], slabs: [{ x0: -1, z0: -1, x1: 1, z1: 1, y0: 2, y1: 2.6 }] }), 0.01);
  try {
    assert.equal(soup.walkCount, 4, 'two quads');
    assert.equal(soup.solidCount, 8 + 12, 'the floor box: 4 sides; the slab: 6 faces');
    const { walk } = soup.select(-4, -4, 4, 4);
    assert.equal(walk.length, 4);
  } finally { soup.dispose(); }
});
