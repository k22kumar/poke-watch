// The tropical habitat (Cascade Lagoon, `tropical-lagoon`; docs/HABITATS.md "Tropical lagoon"): the recipe launches through the
// regular map flow and replays validated seeds; its stream drains from the catchment to the inlet at the map edge; the beach,
// backshore and jungle sit at their own elevations and outside every route reservation; each side has two dry approaches that
// arrive from different angles, one open along the shore and one under the canopy; no long open shore sightline locks both;
// and the map changes route geometry and exposure against Shrine Gorge. Static (final collision) except the play-through.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRun } from '../src/sim/run';
import { attemptHabitat, generateHabitat, HABITATS, HAB_VERSION, profilesFor } from '../src/world/habitat';
import { CONTROL_POINT } from '../src/world/habitat/mode';
import { HK } from '../src/world/habitat/ctx';
import { validateHabitat, type Layout } from '../src/world/habitat/validate';
import { findMapSource, mapChecksum } from '../src/world/maps';
import { worldgenFromQuery } from '../src/world/replay';
import { BIOMES } from '../src/rules/stages';
import { T, type ArenaMap } from '../src/world/tiles';
import { measure } from '../scripts/hablagoon';
import { playHabitat } from '../scripts/habplay';

const ID = 'tropical-lagoon', R = HABITATS[ID];
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
const gen = (seed: number, variant = '') => generateHabitat({ recipe: ID, seed, variant });
/** the accepted attempt again, for the generator's own state (approach tiles, kinds, heights): same seed, same layout */
const attempt = (m: ArenaMap) => { const H = m.gen!.hab!; return attemptHabitat(R, CONTROL_POINT, H.attemptSeed, m.w, H.variant, profilesFor()).g; };

test('the lagoon launches through the regular map flow: ?loc=, loose names, the regions seam', () => {
  for (const q of ['tropical-lagoon', 'Cascade Lagoon', 'lagoon', 'tropical']) assert.equal(findMapSource(q), ID, q);
  assert.equal(findMapSource('tropical-lagoon/dusk'), `${ID}:dusk`);
  const wg = worldgenFromQuery({ world: 'locations', loc: 'lagoon', mapseed: '4', biomes: Object.keys(BIOMES) }, () => {});
  const ctx = createRun({ seed: 3, species: 'cyndaquil', ruleOverrides: { worldgen: wg } as never });
  const H = ctx.world.hab!;
  assert.equal(H.recipe, ID);
  assert.equal(H.seed, 4);
  assert.equal(H.fallback, undefined);
  assert.equal(ctx.world.map.id, `${ID}@4h${HAB_VERSION}`);
  assert.ok(ctx.world.map.wlevel, 'it has fluid levels (the stream, the lagoon)');
});

test('recipe data: the three references, canon / reinterpretation / original, a variant that is paint only', () => {
  assert.deepEqual(R.refs.map((r) => r.title.replace('Bulbapedia — ', '')), ['Lush Jungle', 'Brooklet Hill', 'Loop Lagoon']);
  for (const k of ['canon', 'reinterpretation', 'original']) assert.ok(R.anchors.some((a) => a.provenance === k), k);
  assert.ok(R.adaptations.length >= 3 && R.anchors.some((a) => a.id === 'cascade' && a.locked) && R.anchors.some((a) => a.id === 'lagoon' && a.locked));
  const a = gen(41), b = gen(41, 'dusk');
  assert.deepEqual([...b.elev], [...a.elev], 'the dusk variant keeps the heights');
  assert.deepEqual([...b.wall], [...a.wall], 'and the walls');
  assert.notEqual(b.name, a.name);
});

test('validated seeds replay and are accepted on their first attempt, both surfaces, with every gate (incl. the shore) green', () => {
  for (const s of [...SEEDS, 11, 12, 101, 102, 103, ...R.fallbackSeeds]) for (const v of ['', 'dusk']) {
    const m = gen(s, v), H = m.gen!.hab!;
    assert.equal(mapChecksum(m), mapChecksum(gen(s, v)), `seed ${s}${v}: the same map twice`);
    assert.equal(H.attempts, 1, `seed ${s}${v}: accepted on its first attempt (${H.rejections.map((r) => r.failed.join('+')).join('; ')})`);
    assert.deepEqual(H.gates.filter((g) => !g.ok).map((g) => `${g.id}: ${g.value}`), [], `seed ${s}${v}`);
    for (const id of ['reach:base', 'reach:stripped', 'independent:base', 'independent:stripped', 'planned', 'drainage', 'joins', 'shore', 'connected']) assert.ok(H.gates.some((g) => g.id === id && g.ok), `seed ${s}${v}: ${id}`);
  }
});

test('catchment → outlet: the stream runs from the north edge over a cascade into the pool, the lagoon and the inlet; levels never rise downstream', () => {
  for (const s of SEEDS) {
    const m = gen(s), g = attempt(m), n = m.w * m.h, wl = m.wlevel!, S = m.w;
    const fluid = (k: number) => m.terrain[k] === T.water;
    // the catchment: the highest water on the map is the stream's upper reach, and it touches the map's edge band (its source)
    let top = -Infinity, start = -1;
    for (let k = 0; k < n; k++) if (fluid(k) && wl[k] > top) { top = wl[k]; start = k; }
    assert.ok(top > 2, `seed ${s}: an upland reach (${top.toFixed(2)} m) above the lagoon`);
    // flow downhill (never up) through water and culverts: it must reach the outlet, which lies in the edge band
    const seen = new Uint8Array(n), Q = [start]; seen[start] = 1;
    let reachedEdge = false, lowest = Infinity, fell = 0;
    for (let h = 0; h < Q.length; h++) {
      const a = Q[h], x = a % S, y = (a / S) | 0;
      lowest = Math.min(lowest, wl[a]);
      if (Math.min(x, y, S - 1 - x, S - 1 - y) <= 10 && wl[a] < 0) reachedEdge = true;
      for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
        const i = x + dx, j = y + dy;
        if (i < 0 || j < 0 || i >= S || j >= S) continue;
        const b = j * S + i;
        if (seen[b] || !(fluid(b) || g.culvert[b])) continue;
        if (wl[b] > wl[a] + 0.01) continue; // never uphill
        if (wl[a] - wl[b] > 2) fell++;
        seen[b] = 1; Q.push(b);
      }
    }
    assert.ok(reachedEdge, `seed ${s}: the stream's water reaches the inlet at the map edge downhill (${Q.length} tiles)`);
    assert.ok(fell >= 1, `seed ${s}: the cascade is a drop of more than 2 m between adjacent water tiles`);
    assert.ok(lowest < 0, `seed ${s}: it ends at the lagoon's level`);
    // and everything that is water belongs to that one system (no stranded pool)
    let lost = 0; for (let k = 0; k < n; k++) if (fluid(k) && !seen[k]) lost++;
    assert.equal(lost, 0, `seed ${s}: no water outside the drainage system`);
    assert.ok(m.gen!.hab!.metrics.fallsEdges >= 1);
  }
});

test('landings: two bridges (the shore side) and two causeways (the jungle side) are supported at both ends, with headroom under the decks', () => {
  for (const s of SEEDS) {
    const m = gen(s), g = attempt(m), n = m.w * m.h;
    const bridges = g.joins.filter((j) => j.what === 'bridge'), decks = g.joins.filter((j) => j.what === 'causeway');
    assert.equal(bridges.length, 2, `seed ${s}: a bridge per side`);
    assert.equal(decks.length, 2, `seed ${s}: a causeway per side`);
    for (const J of [...bridges, ...decks]) for (const e of J.ends) {
      assert.ok(e >= 0, `seed ${s}: ${J.what} has both ends on ground`);
      const top = m.over && m.over[e] > 0 ? m.over[e] : m.elev[e];
      assert.ok(Math.abs(top - J.h) <= 0.65, `seed ${s}: ${J.what} end at ${top.toFixed(2)} m vs ${J.h} m`);
    }
    for (const J of decks) assert.ok(J.clearance >= 2.9, `seed ${s}: ${J.clearance.toFixed(1)} m under the causeway`);
    // the bridge is the raised bank's own height (the same height at both ends), the causeway the terrace's
    for (const J of bridges) assert.equal(J.h, R.levels.apron);
    for (const J of decks) assert.equal(J.h, R.levels.terrace);
    let overWater = 0; for (let k = 0; k < n; k++) if (m.over && m.over[k] > 0 && g.kind[k] === HK.fluid) overWater++;
    assert.ok(overWater >= 8, `seed ${s}: the decks span real water (${overWater} tiles)`);
  }
});

test('bands: dry beach and backshore by the water, stands only on the jungle (the terrace and the low inland ground), none on a reservation', () => {
  for (const s of SEEDS) {
    const m = gen(s), g = attempt(m), S = m.w, n = S * S;
    // the dry band: no stand on low ground within the rule's distance of open water
    const dry = R.vegetation.dry!;
    const dist = new Int16Array(n).fill(999), Q: number[] = [];
    for (let k = 0; k < n; k++) if (g.kind[k] === HK.fluid) { dist[k] = 0; Q.push(k); }
    for (let h = 0; h < Q.length; h++) { const a = Q[h], x = a % S, y = (a / S) | 0; for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) { if (x + dx < 0 || y + dy < 0 || x + dx >= S || y + dy >= S) continue; const b = (y + dy) * S + x + dx; if (dist[b] > dist[a] + 1) { dist[b] = dist[a] + 1; Q.push(b); } } }
    const trees = m.props.filter((p) => ['round', 'tree2', 'tree'].includes(p.kind));
    assert.ok(trees.length >= 120, `seed ${s}: a jungle (${trees.length} trees)`);
    let onBeach = 0, onTerrace = 0;
    // (the map's border rows are a closed wall of stand, laid on the mass: not part of the shore)
    for (const p of trees) { if (p.x < 5 || p.y < 5 || p.x > S - 7 || p.y > S - 7) continue; const k = p.y * S + p.x; if (dist[k] <= dry.within && m.elev[k] < dry.below) onBeach++; if (m.elev[k] >= R.levels.terrace - 0.1) onTerrace++; }
    assert.equal(onBeach, 0, `seed ${s}: no stand on the beach or backshore`);
    assert.ok(onTerrace >= 60, `seed ${s}: the jungle stands on the terrace (${onTerrace})`);
    // elevations: the beach (sand) is low and just above the lagoon; the terrace is the highest ground of the play space
    let sand = 0, sandHi = 0;
    for (let k = 0; k < n; k++) if (g.kind[k] === HK.bank && !g.lock[k] && m.terrain[k] === T.sand && g.med[k] === 0) { sand++; if (m.elev[k] > R.levels.apron + 0.01) sandHi++; }
    assert.ok(sand >= 300, `seed ${s}: dry beach (${sand} sand tiles)`);
    assert.equal(sandHi, 0, `seed ${s}: sand never above the raised bank`);
    // the inland-to-shore seam: the low ground (beach, backshore, the jungle fringe) is one continuous surface: no step between two
    // neighbouring low tiles exceeds the walking limit
    let steepest = 0;
    for (let k = 0; k < n; k++) {
      const x = k % S, y = (k / S) | 0;
      if (x >= S - 1 || y >= S - 1 || g.H[k] >= 1 || ![HK.floor, HK.bank].includes(g.kind[k] as never) || m.wall[k]) continue;
      for (const b of [k + 1, k + S]) {
        if (g.H[b] >= 1 || ![HK.floor, HK.bank].includes(g.kind[b] as never) || m.wall[b]) continue;
        steepest = Math.max(steepest, Math.abs(g.H[k] - g.H[b]));
      }
    }
    assert.ok(steepest <= 0.6, `seed ${s}: the low ground steps ${steepest.toFixed(2)} m between neighbours (limit 0.6 m)`);
    // the reservations: every approach tile is open ground, and no stand's footprint touches one
    const route = new Uint8Array(n);
    for (const A of g.approaches) for (const k of A.tiles) {
      route[k] = 1;
      if (m.over && m.over[k] > 0) continue; // a causeway's strip: what lies under the deck (water, a sealed sliver of bank) is not walked
      assert.equal(m.wall[k], 0, `seed ${s}: ${A.id} tile ${k % S},${(k / S) | 0} is not a wall`);
      assert.notEqual(m.terrain[k], T.water, `seed ${s}: ${A.id} is dry`);
    }
    for (const p of m.props) {
      if (!['round', 'tree2', 'tree', 'thicket', 'boulder'].includes(p.kind)) continue;
      for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) assert.equal(route[y * S + x], 0, `seed ${s}: ${p.kind} at ${p.x},${p.y} sits on an approach`);
    }
  }
});

/** the bearing (degrees) from the point to where a route is 12 m out */
function arrival(m: ArenaMap, nodes: number[]): number {
  const H = m.gen!.hab!, n = m.w * m.h;
  for (let i = nodes.length - 1; i >= 0; i--) {
    const k = nodes[i] % n, x = (k % m.w) + 0.5, y = ((k / m.w) | 0) + 0.5;
    if (Math.hypot(x - H.contest.x, y - H.contest.y) >= 12) return (Math.atan2(y - H.contest.y, x - H.contest.x) * 180) / Math.PI;
  }
  return NaN;
}

test('two dry approaches per side arrive from different angles; the way back is the same dry way (every state)', () => {
  for (const s of [1, 2, 3, 4, 5, 6]) {
    const m = gen(s), H = m.gen!.hab!, st = measure(ID, s);
    for (const team of ['A', 'B']) {
      const d = st.routes.find((r) => r.id === `${team}.direct`)!, f = st.routes.find((r) => r.id === `${team}.flank`)!;
      assert.ok(d && f, `seed ${s} ${team}: both approaches walk as built`);
      let diff = Math.abs(arrival(m, d.nodes) - arrival(m, f.nodes)); if (diff > 180) diff = 360 - diff;
      assert.ok(diff >= 40, `seed ${s} ${team}: the shore bank and the causeway arrive ${diff.toFixed(0)}° apart (need 40°)`);
    }
    for (const id of ['reach:base', 'reach:stripped']) assert.ok(H.gates.find((g) => g.id === id)!.ok, `seed ${s}: ${id} (both stagings reach the point and leave again)`);
  }
});

test('the shore gate: an open shore tile that sees both of a side\'s final approaches is rejected, and a shore with a break passes', () => {
  // a 72×72 floor with two corridors per side (north and south ring) and a centre box: the box sees both final stretches
  const S = 72, n = S * S;
  const mk = (carve: (x: number, y: number) => boolean) => {
    const m: ArenaMap = { id: 'fixture', name: 'fixture', w: S, h: S, terrain: new Uint8Array(n), elev: new Float32Array(n), stairs: new Uint8Array(n), dots: new Uint8Array(n), ledge: new Uint8Array(n), wall: new Uint8Array(n).fill(1), platform: new Float32Array(n), props: [], spawn: [6, 36], bossSpot: [36, 36], chestSpots: [], landmarks: [] };
    for (let y = 2; y < S - 2; y++) for (let x = 2; x < S - 2; x++) if (carve(x, y)) m.wall[y * S + x] = 0;
    return m;
  };
  const box = (x: number, y: number, x0: number, y0: number, x1: number, y1: number) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
  const open = (x: number, y: number) => box(x, y, 3, 8, 68, 13) || box(x, y, 3, 58, 68, 63) || box(x, y, 3, 8, 9, 63) || box(x, y, 62, 8, 68, 63) || box(x, y, 33, 8, 38, 63) || box(x, y, 30, 30, 42, 42);
  const m = mk(open);
  const shore = new Uint8Array(n); for (let k = 0; k < n; k++) if (!m.wall[k]) shore[k] = 1;
  const L: Layout = { contest: { x: 36, y: 36, r: 3, h: 0 }, stage: { A: [6.5, 36.5], B: [65.5, 36.5] }, dropNav: 4, states: ['base'], shore };
  const r = validateHabitat(m, L, profilesFor());
  const g = r.gates.find((x) => x.id === 'shore')!;
  assert.ok(g && !g.ok, `an open floor locks both approaches from the shore: ${g?.value}`);
  assert.ok(r.perches.length > 0 && (r.metrics.shoreLock ?? 0) >= 0.5, 'the hits are reported (the repair uses them) and the strongest lock is measured');
  // no shore tile at all: the gate runs and passes (the lock is measured, nothing stands on a shore)
  const none = validateHabitat(m, { ...L, shore: new Uint8Array(n) }, profilesFor());
  assert.ok(none.gates.find((x) => x.id === 'shore')!.ok);
  // a recipe without a shore has no such gate
  assert.ok(!validateHabitat(m, { ...L, shore: undefined }, profilesFor()).gates.some((x) => x.id === 'shore'));
});

test('seeds vary the inlet, the bank curvature, the crossing and the canopy edge; every layout is distinct', () => {
  const shapes = SEEDS.map((s) => gen(s).gen!.hab!.shape);
  assert.equal(new Set(shapes.map((x) => JSON.stringify(x))).size, SEEDS.length, 'distinct traversable layouts');
  for (const key of ['inlet', 'curve', 'canopy', 'crossA', 'overA', 'lagoon', 'lip']) assert.ok(new Set(shapes.map((x) => x[key])).size >= 6, `${key} varies by seed`);
  // the two sides are not mirror images
  assert.ok(shapes.some((x) => x.crossA !== x.crossB), 'B\'s crossings are drawn apart from A\'s');
});

test('it changes route geometry and combat exposure relative to Shrine Gorge (measured on the final collision)', () => {
  const mean = (id: string, f: (r: ReturnType<typeof measure>['routes'][number]) => number, kind: string) => {
    const v: number[] = [];
    for (const s of [1, 2, 3, 4]) for (const r of measure(id, s).routes) if (r.id.endsWith(kind)) v.push(f(r));
    return v.reduce((a, b) => a + b, 0) / v.length;
  };
  // geometry: shorter, straighter routes than the gorge's winding rim path; a bridge on the raised bank, not a switchback
  assert.ok(mean(ID, (r) => r.length, 'flank') < 0.7 * mean('river-gorge', (r) => r.length, 'flank'), 'the inland route is much shorter than the gorge\'s rim route');
  assert.ok(mean(ID, (r) => r.bend, 'direct') < 0.75 * mean('river-gorge', (r) => r.bend, 'direct'), 'the shore bank is straighter than the switchback route');
  assert.ok(mean(ID, (r) => r.climb, 'direct') < mean('river-gorge', (r) => r.climb, 'direct'), 'less climb');
  // exposure: the bank runs beside open water (watched from across the lagoon), the canopy path does not; the gorge's two do not differ that way
  const bankW = mean(ID, (r) => r.water, 'direct'), canopyW = mean(ID, (r) => r.water, 'flank');
  assert.ok(bankW - canopyW >= 0.25, `water beside the shore bank ${(bankW * 100).toFixed(0)} % vs the canopy path ${(canopyW * 100).toFixed(0)} %`);
  assert.ok(bankW > 2 * mean('river-gorge', (r) => r.water, 'direct'), 'the bank is far more on the water than the gorge\'s route');
  // no long open shore sightline locks both approaches (the gate, and the strongest lock measured)
  for (const s of SEEDS) assert.ok(gen(s).gen!.hab!.metrics.shoreLock < 0.5, `seed ${s}: strongest shore lock ${gen(s).gen!.hab!.metrics.shoreLock}`);
});

test('play-through in the real sim: both approaches reach the point, hold it and walk back dry; the Raid party arrives by team B\'s routes', () => {
  for (const s of [1, 2]) {
    for (const r of playHabitat(ID, s, { route: 'both' })) {
      assert.ok(r.reach !== null && r.held && r.back !== null, `seed ${s} ${r.route}: reach ${r.reach} held ${r.held} back ${r.back}`);
      assert.equal(r.hazardHits, 0, `seed ${s} ${r.route}: no environment hit on required travel`);
    }
    for (const r of playHabitat(ID, s, { route: 'both', raid: true })) assert.ok(r.raidAt !== null, `seed ${s} ${r.route}: the Raid party reached the point (${r.raidAt})`);
  }
});
