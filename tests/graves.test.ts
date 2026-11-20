// Memorial Ridge (docs/HABITATS.md "Cemetery") and the grave marker family it is built from (src/world/habitat/graves.ts):
// the recipe runs through the existing flow and replays, both approaches of both sides pass the movement and sightline
// checks, small and tall muzzles are tested against marker height, long firing lanes are broken, a second way in stays
// unwatched, and the family and its placement rule work in a different habitat.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultRules } from '../src/rules/defaults';
import { PROP_MATERIALS } from '../src/rules/surfaces';
import { createRun, step } from '../src/sim/run';
import { NO_INPUT } from '../src/sim/types';
import { Rng, streamSeed } from '../src/core/rng';
import { attemptHabitat, generateHabitat, findHabitat, HABITATS, HAB_VERSION, layoutOf, profilesFor } from '../src/world/habitat';
import { HabCtx, HK } from '../src/world/habitat/ctx';
import { write } from '../src/world/habitat/dress';
import { bracketsMuzzles, commitGraves, placeMark, planPlot, PLOT_ZONE, type PlotRule } from '../src/world/habitat/graves';
import { LANDFORMS } from '../src/world/habitat/landforms';
import { CONTROL_POINT } from '../src/world/habitat/mode';
import { LANE, laneField, muzzles, sightAbs, stateMap, validateHabitat, WATCH } from '../src/world/habitat/validate';
import { findMapSource, mapChecksum, regionMap } from '../src/world/maps';
import { loadInfo, worldgenFromQuery } from '../src/world/replay';
import { GRAVE_TOP, PROP_RULES, graveClassOf, T, type ArenaMap } from '../src/world/tiles';
import { playHabitat } from '../scripts/habplay';

import { RANGE } from '../src/mods';
const ID = 'forest-cemetery', P = profilesFor();
const gen = (seed: number, variant = '') => generateHabitat({ recipe: ID, seed, variant });
const SEEDS = [3, 5, 7, 11];
const tileOf = (m: ArenaMap, x: number, y: number) => y * m.w + x;

test('the recipe is data: cited canon anchors, labelled adaptations, a variant, aliases, the marker family declared', () => {
  const R = HABITATS[ID];
  assert.equal(R.landform, 'ridge');
  assert.ok(R.anchors.some((a) => a.provenance === 'canon') && R.anchors.some((a) => a.provenance === 'original'), 'canon and original anchors');
  for (const a of R.anchors) if (a.provenance !== 'original') assert.ok(a.refs.length && a.refs.every((r) => R.refs[r]?.url.startsWith('https://')), `${a.id} cites a reference`);
  assert.ok(R.refs.some((r) => /Old_Cemetery/.test(r.url)) && R.refs.some((r) => /Memorial_Hill/.test(r.url)), 'Old Cemetery and Memorial Hill');
  assert.ok(R.adaptations.length >= 3 && R.states.includes('base') && R.states.includes('stripped'));
  assert.ok(R.graves && R.graves.mix.kerb > 0 && R.graves.mix.stone > 0 && R.graves.mix.stele > 0, 'the marker mix has every class');
  assert.equal(findHabitat('cemetery')?.id, ID); assert.equal(findHabitat('memorial hill')?.id, ID);
  assert.deepEqual(findHabitat(`${ID}:hollow`), { id: ID, variant: 'hollow' });
  assert.equal(findMapSource(`${ID}/hollow`), `${ID}:hollow`);
});

test('two or more accepted replays: first-attempt acceptance, every gate, the replay link and a second client agree', () => {
  const sums = new Set<number>();
  for (const seed of SEEDS) {
    const m = gen(seed), H = m.gen!.hab!, L = loadInfo(H);
    assert.equal(H.fallback, undefined, `seed ${seed}: no fallback`);
    assert.equal(H.attempts, 1, `seed ${seed}: accepted on the first attempt`);
    assert.deepEqual(H.gates.filter((g) => !g.ok).map((g) => `${g.id}: ${g.value}`), [], `seed ${seed}`);
    for (const id of ['marker:height', 'lane', 'watch', 'perch', 'counter', 'planned', 'connected', 'contest', 'joins']) assert.ok(H.gates.some((g) => g.id === id && g.ok), `seed ${seed}: gate ${id}`);
    assert.equal(L.kind, 'direct'); assert.equal(L.loaded, seed);
    // the replay link, parsed as main.ts parses a launch, rebuilds the same map; so does a second generation
    const wg = worldgenFromQuery({ world: 'locations', loc: ID, mapseed: String(seed), hv: String(HAB_VERSION), biomes: ['meadow'] }, () => {});
    assert.equal((wg as { locations: Record<string, string> }).locations.meadow, ID);
    assert.equal(mapChecksum(m), mapChecksum(gen(seed)), `seed ${seed}: two clients, one map`);
    assert.equal(mapChecksum(regionMap({ ...defaultRules.worldgen, mode: 'generated', locations: { meadow: ID } }, 'meadow', seed)), mapChecksum(m), `seed ${seed}: the map the game loads`);
    sums.add(mapChecksum(m));
  }
  assert.equal(sums.size, SEEDS.length, 'distinct layouts');
  // the variant repaints: heights, walls, platforms (every marker) and decks are identical
  const a = gen(7), b = gen(7, 'hollow');
  assert.deepEqual([...b.elev], [...a.elev]); assert.deepEqual([...b.platform], [...a.platform]); assert.deepEqual([...b.wall], [...a.wall]);
  assert.notEqual(b.gen!.loc!.art, a.gen!.loc!.art);
  // the fallback seeds pass on their first attempt in both
  for (const s of HABITATS[ID].fallbackSeeds) for (const v of ['', 'hollow']) assert.equal(gen(s, v).gen!.hab!.attempts, 1, `fallback ${s} ${v}`);
});

test('both approaches of both sides pass the movement and the sightline checks, in every state, on every sampled seed', () => {
  for (const seed of SEEDS) {
    const H = gen(seed).gen!.hab!;
    assert.equal(H.approaches.length, 4);
    assert.deepEqual(H.approaches.map((a) => a.id).sort(), ['A.direct', 'A.flank', 'B.direct', 'B.flank']);
    for (const st of HABITATS[ID].states) assert.ok(H.gates.some((g) => g.id === `reach:${st}` && g.ok) && H.gates.some((g) => g.id === `independent:${st}` && g.ok), `seed ${seed}: ${st}`);
    // movement: every essential body walks each approach as built (the validator's `planned`), and the sightline gates hold at both muzzle extremes
    assert.ok(H.gates.find((g) => g.id === 'planned')!.ok);
    assert.ok(H.metrics['lane:small'] <= LANE && H.metrics['lane:tall'] <= LANE, `lanes ${H.metrics['lane:small']} / ${H.metrics['lane:tall']} within ${LANE}`);
    for (const k of Object.keys(H.metrics).filter((x) => x.startsWith('watch:'))) assert.ok(H.metrics[k] < WATCH, `${k} ${H.metrics[k]}`);
    assert.equal(H.metrics.perches, 0, 'no perch watches both of a side\'s approaches');
  }
  // in the real sim: the trainer walks each approach from spawn to the point and holds it; the Raid party reaches the point
  for (const seed of [3, 7]) {
    for (const r of playHabitat(ID, seed, {})) assert.ok(r.reach !== null && r.held && r.back !== null && r.stalls === 0, `seed ${seed} ${r.route}: ${r.note} (stalls ${r.stalls})`);
    for (const r of playHabitat(ID, seed, { raid: true })) assert.ok(r.reach !== null && r.raidAt !== null && r.back !== null, `seed ${seed} ${r.route} raid: ${r.note}`);
  }
});

test('marker height against both muzzle extremes: kerb under every muzzle, headstone stops the small and not the tall, stele stops both', () => {
  const [lo, hi] = muzzles(P);
  assert.equal(lo, 0.5, 'the smallest wild Pokémon\'s muzzle'); assert.ok(hi > 1.3 && hi < 1.6, `the tallest partner\'s muzzle ${hi}`);
  assert.ok(bracketsMuzzles(lo, hi).ok, bracketsMuzzles(lo, hi).why);
  assert.ok(GRAVE_TOP.kerb <= defaultRules.player.stepHeight, 'a kerb is walkable (it is not a blocker)');
  assert.ok(GRAVE_TOP.stone > defaultRules.player.stepHeight && GRAVE_TOP.stele > hi);
  assert.equal(graveClassOf(GRAVE_TOP.kerb), 'kerb'); assert.equal(graveClassOf(GRAVE_TOP.stone), 'stone'); assert.equal(graveClassOf(GRAVE_TOP.stele), 'stele');
  // a flat fixture with one marker of each class in a row, a ray at each muzzle across each one
  const g = new HabCtx(HABITATS[ID], CONTROL_POINT, 64, 1);
  for (let k = 0; k < 64 * 64; k++) g.kind[k] = HK.floor;
  const plot = planPlot(g, new Rng(1), { ...rule([[10, 30], [10, 30.1]]), rows: 0, cols: 0 });
  const at = { kerb: 20, stone: 30, stele: 40 } as const;
  for (const [cls, x] of Object.entries(at)) assert.ok(placeMark(g, plot, x + 0.5, 30.5, cls as keyof typeof at), `${cls} placed`);
  write(g); commitGraves(g);
  const m = g.m, open = (a: number, b: number, y: number) => sightAbs(m, a + 0.5, 30.5, y, b + 0.5, 30.5, y);
  const want = { kerb: [true, true], stone: [false, true], stele: [false, false] } as const;
  for (const [cls, x] of Object.entries(at)) {
    assert.ok(Math.abs(m.platform[tileOf(m, x, 30)] - GRAVE_TOP[cls as keyof typeof at]) < 1e-6, `${cls} collision height`);
    assert.deepEqual([open(x - 4, x + 4, lo), open(x - 4, x + 4, hi)], want[cls as keyof typeof want], `${cls}: small ray, tall ray`);
  }
  // and the sim agrees on a built map: a ray at the tall muzzle clears a headstone that stops the small one
  let found = 0;
  for (const seed of [3, 5, 7]) {
    const ctx = createRun({ mode: RANGE, seed: 1, species: 'totodile', ruleOverrides: { worldgen: { mode: 'generated', regionSeed: seed, locations: { meadow: ID } } } as never });
    const W = ctx.world, M = W.map;
    for (const p of M.props) {
      if (p.kind !== 'grave' || graveClassOf(p.top!) !== 'stone' || p.w !== 1) continue;
      for (const [dx, dz] of [[1, 0], [0, 1]]) {
        const tiles = [-4, -3, -2, -1, 1, 2, 3, 4].map((o) => (p.y + dz * o) * M.w + p.x + dx * o);
        if (tiles.some((k) => M.wall[k] || M.platform[k] || M.elev[k] !== M.elev[p.y * M.w + p.x])) continue;
        const x0 = p.x - W.half + 0.5 - dx * 4, z0 = p.y - W.half + 0.5 - dz * 4, x1 = p.x - W.half + 0.5 + dx * 4, z1 = p.y - W.half + 0.5 + dz * 4, e = M.elev[p.y * M.w + p.x];
        assert.equal(W.sight(x0, e + lo, z0, x1, e + lo, z1), false, 'the small muzzle is stopped by a headstone');
        assert.equal(W.sight(x0, e + hi, z0, x1, e + hi, z1), true, 'the tall muzzle fires over it');
        found++; break;
      }
      if (found) break;
    }
    if (found) break;
  }
  assert.ok(found, 'a clear headstone with free ground either side exists on a sampled seed');
});

/** a plot rule with the recipe's numbers (a contour is given in tiles) */
function rule(contour: [number, number][], over: Partial<PlotRule> = {}): PlotRule {
  const gr = HABITATS[ID].graves!;
  return { contour, rows: 3, cols: 5, pitch: 3.3, rowGap: 3.1, start: 0, angle: 0.4, wave: 0.3, jitter: 0.2, skip: 0.1, mix: gr.mix, wide: gr.wide, lean: gr.lean, tread: 1, ...over };
}

test('placement rule on every accepted map: two clear tiles between markers, off every tread and the platform, flat, three classes, leaning both ways', () => {
  const lean = new Set<number>(), widths = new Set<number>();
  for (const seed of SEEDS) {
    const a = attemptHabitat(HABITATS[ID], CONTROL_POINT, seed, 128, '', P), g = a.g, m = g.m, S = g.S;
    assert.ok(a.ok, `seed ${seed}: ${a.failed}`);
    assert.ok(g.plots.length >= 2 && g.plots.length <= 3, `${g.plots.length} plots`);
    for (const pl of g.plots) assert.ok(pl.marks.length >= 5, `a plot of ${pl.marks.length}`);
    const marks = g.graves, tread = new Set(g.approaches.flatMap((x) => x.tiles));
    assert.equal(m.props.filter((p) => p.kind === 'grave').length, marks.length, 'every planned marker is drawn');
    for (const mk of marks) {
      lean.add(mk.lean); widths.add(mk.w);
      assert.ok(mk.w === 1 || mk.w === 2);
      for (let i = mk.x; i < mk.x + mk.w; i++) {
        const k = mk.y * S + i;
        assert.ok(Math.abs(m.platform[k] - mk.top) < 1e-6, 'the footprint carries the class height');
        assert.ok(!g.platform[k] && !g.hazard[k], 'off the contest platform and the hazard');
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) assert.ok(!tread.has(k + dy * S + dx), `marker ${mk.x},${mk.y} beside a tread`);
      }
    }
    // two clear tiles between any two markers' footprints
    for (const [i, p] of marks.entries()) for (const q of marks.slice(i + 1)) {
      const dx = Math.max(q.x - (p.x + p.w), p.x - (q.x + q.w), 0), dy = Math.max(q.y - (p.y + 1), p.y - (q.y + 1), 0);
      assert.ok(Math.max(dx, dy) >= 2, `markers ${p.x},${p.y} and ${q.x},${q.y} leave ${Math.max(dx, dy)} clear tiles`);
    }
    for (const c of ['kerb', 'stone', 'stele']) assert.ok(marks.some((x) => x.cls === c), `seed ${seed}: a ${c}`);
    // plots shear both ways, and no two share a lattice (their angles differ by sign for neighbours)
    const signs = new Set(g.plots.map((pl) => Math.sign(pl.rule.angle)));
    assert.ok(signs.size === 2 || g.plots.length < 2, `seed ${seed}: plots shear opposite ways`);
    for (const pl of g.plots) assert.ok(Math.abs(pl.rule.angle) > 0.2 && Math.abs(pl.rule.angle) < 0.65);
  }
  assert.ok(lean.has(-1) && lean.has(1) && lean.has(0), 'lean goes both ways and none');
  assert.ok(widths.has(1) && widths.has(2), 'single and double markers');
});

test('lanes: a straight row of kerbs is a long lane, steles and the recipe\'s own lattice break it; the validator rejects a precinct whose walls are gone', () => {
  // a 70×12 open strip, every tile in the plot zone: no marker, then a stele every 6 tiles
  const fixture = (steles: number[]) => {
    const w = 70, h = 12, n = w * h;
    const m = { id: 'f', name: 'f', w, h, terrain: new Uint8Array(n), elev: new Float32Array(n), stairs: new Uint8Array(n), dots: new Uint8Array(n), ledge: new Uint8Array(n), wall: new Uint8Array(n), platform: new Float32Array(n), props: [], spawn: [1, 1], bossSpot: [1, 1], chestSpots: [], landmarks: [] } as ArenaMap;
    for (const x of steles) for (let y = 0; y < h; y++) m.platform[y * w + x] = GRAVE_TOP.stele;
    return { m, region: new Uint8Array(n).fill(1) };
  };
  const [lo, hi] = muzzles(P);
  const open = fixture([]);
  assert.ok(laneField(open.m, open.region, undefined, lo, open.region).max > LANE, 'an open strip is a lane');
  const walled = fixture([8, 16, 24, 32, 40, 48, 56, 64]);
  for (const mz of [lo, hi]) { const L2 = laneField(walled.m, walled.region, undefined, mz, walled.region).max; assert.ok(L2 <= 12 && L2 < LANE, `a stele every 8 tiles caps the lane: ${L2}`); }
  // headstones break the lane for the small muzzle only
  const stones = fixture([]); for (const x of [8, 16, 24, 32, 40, 48, 56, 64]) for (let y = 0; y < 12; y++) stones.m.platform[y * 70 + x] = GRAVE_TOP.stone;
  assert.ok(laneField(stones.m, stones.region, undefined, lo, stones.region).max <= 12 && laneField(stones.m, stones.region, undefined, hi, stones.region).max > LANE, 'headstones stop the small muzzle and not the tall');
  // the built precincts hold the limit at both muzzles (the generator's own lattice, kink and steles)
  for (const seed of SEEDS) { const H = gen(seed).gen!.hab!; assert.ok(Math.max(H.metrics['lane:small'], H.metrics['lane:tall']) <= LANE); }
  // remove the walls between the forecourt and the rim (the wings and the forecourt wall: 51 tiles on seed 3) from one accepted precinct:
  // each side's second approach is now in plain view of its first, and the validator says so
  const a = attemptHabitat(HABITATS[ID], CONTROL_POINT, 3, 128, '', P), g = a.g, c = g.contest;
  const bare: ArenaMap = { ...g.m, wall: g.m.wall.slice(), elev: g.m.elev.slice(), terrain: g.m.terrain.slice(), platform: g.m.platform.slice() };
  let cut = 0;
  for (let k = 0; k < g.S * g.S; k++) {
    if (g.kind[k] !== HK.rock || !g.precinct[k]) continue;
    const d = Math.hypot((k % g.S) + 0.5 - c.x, ((k / g.S) | 0) + 0.5 - c.y);
    if (d > 11.5 && d < 24) { bare.wall[k] = 0; bare.elev[k] = g.recipe.levels.lower; cut++; }
  }
  assert.ok(cut >= 30, `${cut} wall tiles removed`);
  const bad = validateHabitat(bare, layoutOf(g), P);
  assert.ok(bad.failed.includes('watch'), `walls gone: ${bad.failed.join(', ') || 'nothing failed'}`);
  assert.ok(bad.gates.find((x) => x.id === 'reach:base')!.ok && bad.gates.find((x) => x.id === 'independent:base')!.ok, 'the approaches still exist: it is the sightline that fails, not the movement');
});

test('every environment state: markers are terrain-grade (the stripped state keeps them), and a destructible prop is not what holds a sightline', () => {
  assert.equal(PROP_MATERIALS.grave!.integrity, 0);
  const a = attemptHabitat(HABITATS[ID], CONTROL_POINT, 5, 128, '', P), L = layoutOf(a.g), s = stateMap(a.g.m, 'stripped', L);
  for (const mk of a.g.graves) for (let i = mk.x; i < mk.x + mk.w; i++) assert.equal(s.platform[mk.y * a.g.S + i], a.g.m.platform[mk.y * a.g.S + i], 'a marker survives the stripped state');
  // the stripped state really removed props (trees), so the check above is not vacuous
  assert.ok(s.wall.some((v, k) => v === 0 && a.g.m.wall[k] === 1), 'stripping opens destructible props');
});

test('the prop kind: per-instance height and lean, a kerb walks, a headstone and a stele block; lean is in the checksum', () => {
  assert.equal(PROP_RULES.grave.platform, GRAVE_TOP.stone);
  const ctx = createRun({ mode: RANGE, seed: 1, species: 'totodile', ruleOverrides: { worldgen: { mode: 'generated', regionSeed: 5, locations: { meadow: ID } } } as never });
  const W = ctx.world, M = W.map, seen = { kerb: 0, stone: 0, stele: 0 };
  for (const p of M.props) {
    if (p.kind !== 'grave') continue;
    const cls = graveClassOf(p.top!), k = p.y * M.w + p.x;
    assert.ok(Math.abs(M.platform[k] - p.top!) < 1e-6);
    // walking onto the tile from the footing beside it (World.blocks: the step limit): only a kerb is walkable
    assert.equal(W.blocks(p.x - W.half + 0.5, p.y - W.half + 0.5, M.elev[k], defaultRules.player.stepHeight), cls !== 'kerb', `${cls} at ${p.x},${p.y}: walkable only when a kerb`);
    seen[cls]++;
  }
  assert.ok(seen.kerb && seen.stone && seen.stele, JSON.stringify(seen));
  for (let i = 0; i < 30; i++) step(ctx, NO_INPUT);
  assert.ok(ctx.world.propField!.mat.some((mat, i) => M.props[i].kind === 'grave' && mat && mat.integrity === 0), 'the sim reads a marker as unbreakable');
  const m = gen(5), c0 = mapChecksum(m);
  const leaning = m.props.find((p) => p.kind === 'grave' && !p.lean)!; leaning.lean = 1;
  assert.notEqual(mapChecksum(m), c0, 'lean is part of the layout');
});

test('seeds vary plot grouping, wall openings and path curvature, within the gates', () => {
  const plots = new Set<number>(), openings = new Set<number>(), rim = new Set<number>(), bends = new Set<string>();
  for (let s = 20; s < 34; s++) {
    const H = gen(s).gen!.hab!;
    plots.add(H.shape.plots); openings.add(H.shape.openings); rim.add(H.shape.wallRim);
    bends.add(H.approaches.map((a) => a.tiles).join('/'));
  }
  assert.ok(plots.has(2) && plots.has(3), `plot groups: ${[...plots]}`);
  assert.ok(openings.size >= 3, `wall openings: ${[...openings]}`);
  assert.ok(rim.size >= 8, `perimeter wall length varies: ${rim.size}`);
  assert.ok(bends.size >= 10, `path lengths (curvature) vary: ${bends.size}`);
});

test('the family is reusable: the same plot rule lays markers on the Shrine Gorge\'s rim, off its routes, at the same heights', () => {
  const g = new HabCtx(HABITATS['river-gorge'], CONTROL_POINT, 128, 7);
  LANDFORMS.gorge(g);
  // a free 16-tile run of the rim plateau
  let at: [number, number] | null = null;
  for (let y = 10; y < 118 && !at; y += 3) for (let x = 8; x < 100 && !at; x++) {
    let ok = true;
    for (let i = 0; i < 16 && ok; i++) for (let j = -4; j <= 4 && ok; j++) { const k = g.idx(x + i, y + j); if (g.kind[k] !== HK.floor || g.H[k] < g.recipe.levels.rim - 0.1 || g.keep[k] || g.lock[k]) ok = false; }
    if (ok) at = [x, y];
  }
  assert.ok(at, 'the gorge has a free stretch of rim');
  const plot = planPlot(g, new Rng(streamSeed(7, 'reuse')), rule([[at![0], at![1]], [at![0] + 16, at![1]]], { cols: 5 }));
  assert.ok(plot.marks.length >= 6, `${plot.marks.length} markers on the rim`);
  write(g);
  assert.equal(commitGraves(g), plot.marks.length);
  const tread = new Set(g.approaches.flatMap((x) => x.tiles));
  for (const mk of plot.marks) {
    assert.ok(Math.abs(g.m.platform[mk.y * g.S + mk.x] - GRAVE_TOP[mk.cls]) < 1e-6);
    assert.equal(g.kind[mk.y * g.S + mk.x], HK.floor);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) assert.ok(!tread.has((mk.y + dy) * g.S + mk.x + dx), 'clear of the gorge\'s routes');
  }
  assert.deepEqual(plot.marks.map((m) => [m.x, m.y, m.cls]), planPlotAgain(at!).map((m) => [m.x, m.y, m.cls]), 'deterministic');
  const [lo, hi] = muzzles(P);
  assert.ok(bracketsMuzzles(lo, hi).ok);
});

function planPlotAgain(at: [number, number]) {
  const g = new HabCtx(HABITATS['river-gorge'], CONTROL_POINT, 128, 7);
  LANDFORMS.gorge(g);
  return planPlot(g, new Rng(streamSeed(7, 'reuse')), rule([[at[0], at[1]], [at[0] + 16, at[1]]], { cols: 5 })).marks;
}

test('the family alone sets a plot\'s footprint: its zone radius is what the lane test counts', () => {
  assert.ok(PLOT_ZONE > 1.2 && PLOT_ZONE < 2.4, 'wide enough for an alley between rows, narrow enough not to follow an arc');
  assert.ok(LANE > defaultRules.enemy.rangedRange, 'a lane may exceed the Raiders\' ranged reach by only the zone\'s margin');
  assert.ok(LANE <= defaultRules.enemy.rangedRange + 2 * PLOT_ZONE + 2);
});
