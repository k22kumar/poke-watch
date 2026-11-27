// I1c drop links (docs/OVERHAUL_3D.md "Actors (I1c)", src/nav/graph.ts findDrops; owner's Q1, 2026-11-27): generated
// and validated when a navmesh is built, one way, down only, each landing on its own group's floor, and the routes take
// them. Hand-made fixtures (tests/fixtures/navmodels.ts), no sim.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import './setup/nav';
import { defaultRules } from '../src/rules/defaults';
import { NavWorld, type DropOptions } from '../src/nav/world';
import { NONE } from '../src/nav/graph';
import { fixture, type Fixture } from './fixtures/navmodels';

const R = defaultRules;
const D: DropOptions = { rules: R.nav.drops };
/** an upper floor (x < 0) `hi` m above a lower one (x > 0), a vertical face between them */
const ledge = (hi: number): Fixture => ({ size: [16, 8], floors: [{ x0: -8, z0: -4, x1: 0, z1: 4, y: hi }, { x0: 0, z0: -4, x1: 8, z1: 4, y: 0 }] });

function withNav<T>(f: Fixture, drops: DropOptions | null, fn: (N: NavWorld) => T): T {
  const N = NavWorld.build(fixture(f), R, [], drops);
  try { return fn(N); } finally { N.dispose(); }
}

test('a 2 m ledge: drop links from the top to the bottom in every group, none back up', () => {
  withNav(ledge(2), D, (N) => {
    for (let g = 0; g < N.graphs.length; g++) {
      const G = N.graphs[g], drops = G.drops;
      assert.ok(drops.length > 0, `${N.names[g]}: drops`);
      for (const d of drops) {
        assert.ok(Math.abs(d.y0 - 2) < 0.05, `${N.names[g]}: from the top (${d.y0})`);
        assert.ok(Math.abs(d.y1) < 0.05, `${N.names[g]}: onto the bottom (${d.y1})`);
        assert.ok(d.nx > 0.99, `${N.names[g]}: straight out over the face (${d.nx}, ${d.nz})`);
        assert.ok(d.to !== d.from && G.link[d.to] === NONE, 'onto a land polygon');
        // the landing point lies on the landing polygon, its agent radius and more beyond the edge
        const x = (d.ax + d.bx) / 2 + d.nx * d.d, z = (d.az + d.bz) / 2 + d.nz * d.d;
        assert.ok(G.contains(d.to, x, z), `${N.names[g]}: the landing is on its polygon`);
      }
    }
  });
});

test('the routes take the drops: the top reaches a goal below only through them', () => {
  const costs = (drops: DropOptions | null) => withNav(ledge(2), drops, (N) => {
    const out: number[] = [];
    for (let g = 0; g < N.graphs.length; g++) {
      const F = N.field(g, 'below', 4, 0, 0, 2), p = N.locate(g, -4, 2, 0, 0);
      assert.notEqual(p, NONE);
      out.push(F!.cost[p]);
    }
    return out;
  });
  const without = costs(null), withDrops = costs(D);
  for (let g = 0; g < 3; g++) {
    assert.equal(without[g], Infinity, 'no ramp: no route down without drops');
    assert.ok(withDrops[g] < 12, `group ${g}: about the straight way down (${withDrops[g]})`);
  }
  // and never up: a goal on the top is not reached from the bottom
  withNav(ledge(2), D, (N) => {
    for (let g = 0; g < N.graphs.length; g++) {
      const F = N.field(g, 'above', -4, 2, 0, 2), p = N.locate(g, 4, 0, 0, 0);
      assert.equal(F!.cost[p], Infinity, `group ${g}: one way`);
    }
  });
});

test('no drop below rules.nav.drops.min, none past max, none the check refuses', () => {
  withNav(ledge(0.4), D, (N) => { for (const G of N.graphs) assert.equal(G.drops.length, 0, 'a 0.4 m rise is a step, not a drop'); });
  withNav(ledge(R.nav.drops.max + 1), D, (N) => { for (const G of N.graphs) assert.equal(G.drops.length, 0, 'past max'); });
  let asked = 0;
  withNav(ledge(2), { rules: R.nav.drops, check: () => { asked++; return false; } }, (N) => { for (const G of N.graphs) assert.equal(G.drops.length, 0, 'refused'); });
  assert.ok(asked > 0, 'the check was asked');
  // the check is told the group, the fall and where it lands
  const seen = new Set<number>();
  withNav(ledge(2), { rules: R.nav.drops, check: (g: number, _x0: number, y0: number, _z0: number, nx: number, _nz: number, d: number, y1: number) => { seen.add(g); assert.ok(y0 - y1 > 1.9 && nx > 0.99 && d > 0); return true; } }, () => undefined);
  assert.deepEqual([...seen].sort(), [0, 1, 2]);
});

test('drops are deterministic: two builds give the same links', () => {
  const a = withNav(ledge(3), D, (N) => JSON.stringify(N.graphs.map((G) => G.drops)));
  const b = withNav(ledge(3), D, (N) => JSON.stringify(N.graphs.map((G) => G.drops)));
  assert.equal(a, b);
});

test('dropCrossed: a move over the edge toward a goal below takes the drop; one along the top or away does not', () => {
  withNav(ledge(2), D, (N) => {
    const g = 0, F = N.field(g, 'below', 4, 0, 0, 2), G = N.graphs[g];
    const d0 = G.drops[0], mx = (d0.ax + d0.bx) / 2, mz = (d0.az + d0.bz) / 2;
    const p = d0.from;
    assert.notEqual(N.dropCrossed(g, F, p, mx - d0.nx * 0.05, mz, mx + d0.nx * 0.05, mz), NONE, 'over the edge');
    assert.equal(N.dropCrossed(g, F, p, mx - d0.nx * 0.2, mz, mx - d0.nx * 0.1, mz), NONE, 'short of the edge');
    // a goal on the top: the drop brings it no nearer
    const Fa = N.field(g, 'above', -6, 2, 0, 2);
    assert.equal(N.dropCrossed(g, Fa, p, mx - d0.nx * 0.05, mz, mx + d0.nx * 0.05, mz), NONE, 'not away from the goal');
  });
});
