// Navigation determinism (task I3; docs/OVERHAUL_3D.md "Navigation (I3)"): builds every width group's navmesh on a set of
// adapter maps and hashes what the sim reads of them (polygons, adjacency, portals), the fields toward each map's goals
// and the straight paths from a lattice of start points. The same inputs must give the same hash on every platform:
// the workflow .github/workflows/nav-determinism.yml runs this on Linux (Node 22 and 24) and checks it against
// tests/fixtures/navhash.json, recorded on the owner's Mac (Apple M3 Max, Node 24.21), like S1's controller course.
//   npx tsx scripts/navhash.ts [--check] [--update]
// --check exits 1 when a map's hash differs from the fixture; --update rewrites the fixture.
import fs from 'node:fs';
import path from 'node:path';
import { initNavNode } from '../src/nav/node';
import { NavWorld } from '../src/nav/world';
import { defaultRules, type Rules } from '../src/rules/defaults';
import { BIOMES } from '../src/rules/stages';
import { World } from '../src/sim/world';
import { fromArenaMap } from '../src/world/adapter';

/** the maps hashed: the range, River Gorge (the Hold), a deck-heavy and a sloped location */
export const NAVHASH_MAPS: [string, number][] = [['range', 1], ['river-gorge', 1], ['river-gorge', 3], ['tropical-lagoon', 3], ['viridian-forest', 1], ['mt-moon', 4]];

function rulesFor(id: string, seed: number): Rules {
  if (id === 'range') return { ...defaultRules, worldgen: { ...defaultRules.worldgen, arena: 'range' } } as Rules;
  return { ...defaultRules, worldgen: { ...defaultRules.worldgen, mode: 'generated' as const, regionSeed: seed, locations: { meadow: id } } } as Rules;
}

/** FNV-1a over the float64 bits of every number */
class Hash {
  private h = 0x811c9dc5 >>> 0;
  private f = new Float64Array(1); private b = new Uint8Array(this.f.buffer);
  num(v: number) { this.f[0] = v; for (let i = 0; i < 8; i++) { this.h ^= this.b[i]; this.h = Math.imul(this.h, 0x01000193) >>> 0; } }
  all(a: ArrayLike<number>) { this.num(a.length); for (let i = 0; i < a.length; i++) this.num(a[i]); }
  get hex() { return this.h.toString(16).padStart(8, '0'); }
}

/** the navigation hash of one map, with its polygon counts */
export function navHash(id: string, seed: number): { hash: string; polys: number[]; paths: number } {
  const rules = rulesFor(id, seed), W = new World(rules, BIOMES.meadow, seed);
  const N = NavWorld.build(fromArenaMap(W.map), rules);
  try {
    const H = new Hash(), P = new Float64Array(3);
    let paths = 0;
    const [sx, sz] = W.spawn, goals: [number, number][] = [[sx, sz]];
    if (W.hab) goals.push([W.hab.contest.x - W.half, W.hab.contest.y - W.half]);
    for (let g = 0; g < N.graphs.length; g++) {
      const G = N.graphs[g];
      H.all(G.vx); H.all(G.vy); H.all(G.vz); H.all(G.area); H.all(G.aTo); H.all(G.pl); H.all(G.pr);
      goals.forEach(([gx, gz], k) => {
        const F = N.field(g, `goal${k}`, gx, W.height(gx, gz), gz, 4);
        if (!F) { H.num(-1); return; }
        H.all(F.cost); H.all(F.next);
        for (let z = -W.half + 4; z < W.half; z += 8) for (let x = -W.half + 4; x < W.half; x += 8) {
          const p = N.locate(g, x, W.height(x, z), z, 2, P);
          const pts = G.straight(F, p, P[0], P[2]);
          if (pts.length) paths++;
          H.num(p); for (const [a, b] of pts) { H.num(a); H.num(b); }
        }
      });
    }
    return { hash: H.hex, polys: N.graphs.map((G) => G.n), paths };
  } finally { N.dispose(); }
}

if (process.argv[1]?.endsWith('navhash.ts')) {
  await initNavNode();
  const fixture = path.resolve(import.meta.dirname, '../tests/fixtures/navhash.json');
  const want: Record<string, string> = fs.existsSync(fixture) ? JSON.parse(fs.readFileSync(fixture, 'utf8')).hashes : {};
  const got: Record<string, string> = {};
  let bad = 0;
  for (const [id, seed] of NAVHASH_MAPS) {
    const key = `${id}@${seed}`, r = navHash(id, seed);
    got[key] = r.hash;
    const ok = want[key] === r.hash;
    if (!ok) bad++;
    console.log(`HASH ${key.padEnd(20)} ${r.hash} ${ok ? '(as recorded)' : want[key] ? `MOVED from ${want[key]}` : '(new)'}  polygons ${r.polys.join('/')}  paths ${r.paths}`);
  }
  console.log(`platform ${process.platform}-${process.arch} node ${process.version}`);
  if (process.argv.includes('--update')) {
    fs.writeFileSync(fixture, JSON.stringify({ recorded: `${process.platform}-${process.arch} node ${process.version}`, hashes: got }, null, 2) + '\n');
    console.log(`wrote ${fixture}`);
  } else if (process.argv.includes('--check') && bad) process.exitCode = 1;
}
