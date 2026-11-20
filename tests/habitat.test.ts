// Habitat generator (src/world/habitat, docs/HABITATS.md): recipes as data, deterministic and varied generation,
// playability gates on the final collision over fixed seeds, rejection of fixtures with a blocked or shared approach,
// environment states and hazards, the sim seam (shared control point, raid routing, vents, lava), and a scripted
// spawn → objective → retreat run through the real sim on each recipe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { defaultRules } from '../src/rules/defaults';
import { createRun, step } from '../src/sim/run';
import { applyAgent } from '../src/sim/cells';
import { ventPhase } from '../src/sim/hazards';
import { objectiveDue, startObjective } from '../src/sim/objectives';
import { NO_INPUT } from '../src/sim/types';
import { generateHabitat, HabitatError, HABITATS, HAB_VERSION, profilesFor, findHabitat, CONTROL_POINT } from '../src/world/habitat';
import { measuredProfileInputs, VALIDATED_PROFILES } from '../src/world/habitat/mode';
import { FEATURED } from '../src/rules/heroes';
import { SPECIES_BY_ID } from '../src/rules/species';
import { partnerFootprint } from '../src/rules/sizing';
import { clearance, validateHabitat, type Layout } from '../src/world/habitat/validate';
import { pathBetween } from '../src/world/locgen/nav';
import { findMapSource, locationFor, mapChecksum, regionKey, regionMap } from '../src/world/maps';
import { LOCATIONS } from '../src/world/locations';
import { loadSettings, SETTINGS_DEFAULT } from '../src/ui/settings';
import { T, type ArenaMap } from '../src/world/tiles';
import { playHabitat } from '../scripts/habplay';

import { RANGE } from '../src/mods';
const IDS = Object.keys(HABITATS);
const gen = (id: string, seed: number, variant = '') => generateHabitat({ recipe: id, seed, variant });

test('recipes are data: anchors tagged canon / reinterpretation / original with references, shared families, states', () => {
  const families = IDS.map((id) => new Set(HABITATS[id].anchors.map((a) => a.family)));
  for (const id of IDS) {
    const R = HABITATS[id];
    assert.ok(R.anchors.some((a) => a.provenance === 'canon') && R.anchors.some((a) => a.provenance === 'original'), `${id}: canon and original anchors`);
    for (const a of R.anchors) if (a.provenance !== 'original') assert.ok(a.refs.length && a.refs.every((r) => R.refs[r]?.url.startsWith('https://')), `${id}/${a.id}: cites a reference`);
    assert.ok(R.adaptations.length >= 2 && R.anchors.some((a) => a.locked), `${id}: adaptations listed, identity locked`);
    assert.ok(R.fallbackSeeds.length && R.states.includes('base') && R.states.includes('stripped'), `${id}: fallback seeds and states`);
    assert.ok(Object.keys(R.variants).length >= 1, `${id}: a surface variant`);
  }
  // both recipes are built from the same families (geometry and rule reuse), measured on generated maps
  const built = IDS.map((id) => new Set(gen(id, 5).gen!.hab!.families));
  const shared = [...built[0]].filter((f) => built.slice(1).every((s) => s.has(f)));
  // every recipe builds from at least five of the seven; a recipe with no fluid (the cemetery) has no `channel` to share, so the
  // core every recipe shares is five and the wet recipes add the sixth
  for (const [i, id] of IDS.entries()) assert.ok(built[i].size >= 5, `${id} builds from ${built[i].size} families: ${[...built[i]]}`);
  assert.ok(shared.length >= 5, `shared families: ${shared.join(', ')} (gorge ${[...built[0]]}, crater ${[...built[1]]})`);
  const wet = IDS.filter((id) => !HABITATS[id].anchors.every((a) => a.family !== 'channel'));
  assert.ok(wet.length >= 3 && wet.every((id) => IDS.indexOf(id) >= 0 && built[IDS.indexOf(id)].has('channel')), `every recipe with a fluid anchor builds from channel: ${wet.join(', ')}`);
  void families;
  assert.equal(findHabitat('volcano')?.id, 'volcanic-ridge');
  assert.deepEqual(findHabitat('river-gorge:snow'), { id: 'river-gorge', variant: 'snow' });
  // the mode graph is scenery-free: two approaches per side into one contest, and a return for each side
  for (const t of ['A', 'B']) assert.equal(CONTROL_POINT.edges.filter((e) => e.to === 'contest' && e.from.startsWith(t)).length, 2);
});

test('the generator names no recipe, location or species', () => {
  for (const f of readdirSync('src/world/habitat')) {
    if (f === 'recipes.ts') continue;
    const src = readFileSync('src/world/habitat/' + f, 'utf8');
    for (const word of ['Route 119', 'Ilex', 'Chimney', 'Fiery', 'Firespit', 'Shoal Cave', 'Shoal Grotto', 'river-gorge', 'volcanic-ridge', 'tidal-cave', 'spear-sanctuary', 'Spear Sanctuary', 'Spear Pillar', 'Coronet', 'Temple of Sinnoh', 'totodile', 'magcargo']) assert.ok(!src.includes(word), `${f} mentions ${word}`);
    assert.ok(!/Math\.random|Date\.now|performance\.now\(\)\s*[-+*]/.test(src.replace(/typeof performance[^\n]*/g, '')), `${f}: no randomness or clock in the output`);
  }
});

test('recipe + seed + version reproduce the layout; seeds vary traversable geometry; variants keep the geometry', () => {
  for (const id of IDS) {
    const a = gen(id, 41), b = gen(id, 41);
    assert.equal(mapChecksum(a), mapChecksum(b), `${id}: same map twice (what two clients would build)`);
    assert.equal(a.id, `${id}@41h${HAB_VERSION}`);
    assert.deepEqual(a.gen!.hab!.shape, b.gen!.hab!.shape);
    const shapes = new Set<string>(), sums = new Set<number>();
    for (let s = 1; s <= 5; s++) { const m = gen(id, s); shapes.add(JSON.stringify(m.gen!.hab!.shape)); sums.add(mapChecksum(m)); }
    assert.equal(shapes.size, 5, `${id}: 5 seeds, 5 traversable layouts`);
    // a surface variant repaints the same geometry: heights, walls, decks and water identical
    const v = Object.keys(HABITATS[id].variants)[0], c = gen(id, 41, v);
    assert.deepEqual([...c.elev], [...a.elev], `${id}:${v} elevation`);
    assert.deepEqual([...c.over ?? []], [...a.over ?? []], `${id}:${v} decks`);
    assert.notEqual(c.gen!.loc!.art === a.gen!.loc!.art && c.name === a.name, true, `${id}:${v} looks different`);
  }
});

test('fixed seeds of both recipes pass every gate on the final collision, in every environment state', () => {
  for (const id of IDS) for (const s of [101, 102, 103]) {
    const m = gen(id, s), H = m.gen!.hab!;
    assert.equal(H.fallback, undefined, `${id} ${s}: accepted without a fallback`);
    assert.deepEqual(H.gates.filter((g) => !g.ok).map((g) => `${g.id}: ${g.value}`), [], `${id} ${s}`);
    for (const st of HABITATS[id].states) assert.ok(H.gates.some((g) => g.id === `reach:${st}` && g.ok) && H.gates.some((g) => g.id === `independent:${st}` && g.ok), `${id} ${s}: state ${st}`);
  }
});

test('baseline reach from both stagings to the contest for every essential body, on the built map', () => {
  const P = profilesFor();
  assert.ok(P.find((p) => p.id === 'wild-elite')!.radius > 1.3, 'the largest essential body is measured from the roster');
  for (const id of IDS) {
    const m = gen(id, 7), H = m.gen!.hab!, cl = clearance(m), n = m.w * m.h;
    const c = Math.floor(H.contest.y) * m.w + Math.floor(H.contest.x);
    for (const team of ['A', 'B'] as const) for (const p of P.filter((x) => x.essential)) {
      const allow = new Uint8Array(cl.length);
      for (let v = 0; v < cl.length; v++) allow[v] = cl[v] >= p.radius && !H.hazard.includes(v % n) ? 1 : 0;
      const s = Math.floor(H.stage[team][1]) * m.w + Math.floor(H.stage[team][0]);
      assert.ok(pathBetween(m, s, c, allow), `${id} ${team} ${p.id}: to the point`);
      assert.ok(pathBetween(m, c, s, allow), `${id} ${team} ${p.id}: and back`);
    }
  }
});

/** a 72×72 fixture: walls everywhere, floor where carve() says; staging A west, B east, the point in the middle */
function fixture(carve: (x: number, y: number) => boolean): { m: ArenaMap; L: Layout } {
  const S = 72, n = S * S;
  const m: ArenaMap = { id: 'fixture', name: 'fixture', w: S, h: S, terrain: new Uint8Array(n), elev: new Float32Array(n), stairs: new Uint8Array(n), dots: new Uint8Array(n), ledge: new Uint8Array(n), wall: new Uint8Array(n).fill(1), platform: new Float32Array(n), props: [], spawn: [6, 36], bossSpot: [36, 36], chestSpots: [], landmarks: [] };
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (x > 1 && y > 1 && x < S - 2 && y < S - 2 && carve(x, y)) m.wall[y * S + x] = 0;
  const L: Layout = { contest: { x: 36, y: 36, r: 3, h: 0 }, stage: { A: [6.5, 36.5], B: [65.5, 36.5] }, dropNav: 4, states: ['base'] };
  return { m, L };
}
const box = (x: number, y: number, x0: number, y0: number, x1: number, y1: number) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
// a ring of 6-wide corridors: each side reaches the point from the north and from the south (a centre column)
const ring = (x: number, y: number) => box(x, y, 3, 8, 68, 13) || box(x, y, 3, 58, 68, 63) || box(x, y, 3, 8, 9, 63) || box(x, y, 62, 8, 68, 63);
const twoRoutes = (x: number, y: number) => ring(x, y) || box(x, y, 33, 8, 38, 63) || box(x, y, 30, 30, 42, 42);

test('the validator accepts a two-route fixture and rejects a blocked or a shared approach', () => {
  const P = profilesFor();
  const ok = fixture(twoRoutes);
  const r0 = validateHabitat(ok.m, ok.L, P);
  for (const id of ['reach:base', 'independent:base']) assert.ok(r0.gates.find((g) => g.id === id)?.ok, `two-route fixture: ${id} ${r0.gates.find((g) => g.id === id)?.value}`);
  // blocked: a rockfall across the south corridor on both sides; one route left per side
  const blocked = fixture((x, y) => twoRoutes(x, y) && !(y >= 58 && (x === 20 || x === 51)));
  const r1 = validateHabitat(blocked.m, blocked.L, P);
  assert.ok(r1.failed.includes('independent:base'), `blocked approach rejected: ${r1.gates.find((g) => g.id === 'independent:base')?.value}`);
  // shared: no centre column; the north and south routes meet in one gate, the point's only entrance
  const shared = fixture((x, y) => ring(x, y) || box(x, y, 30, 30, 42, 42) || box(x, y, 18, 8, 23, 63) || box(x, y, 18, 34, 30, 38));
  const r2 = validateHabitat(shared.m, shared.L, P);
  assert.ok(r2.gates.find((g) => g.id === 'reach:base')?.ok, 'the shared fixture is still reachable');
  assert.ok(r2.failed.includes('independent:base'), `shared approach rejected: ${r2.gates.find((g) => g.id === 'independent:base')?.value}`);
  assert.ok(/bottleneck at \d+,\d+/.test(r2.gates.find((g) => g.id === 'independent:base')!.value), 'the reason names where the routes share a bottleneck');
});

test('hazards: vents stay off every essential route, every vent tile has an exit within the warning, both states pass', () => {
  const m = gen('volcanic-ridge', 3), H = m.gen!.hab!;
  if (H.optional.some((o) => o.startsWith('vent-branch'))) {
    assert.ok(H.hazard.length > 0);
    assert.ok(H.gates.find((g) => g.id === 'hazardExit')!.ok);
    assert.ok(H.gates.find((g) => g.id === 'reach:venting')!.ok && H.gates.find((g) => g.id === 'independent:venting')!.ok);
  }
  // gorge: frozen water adds walkable ice but the essential routes never depended on it
  const g = gen('river-gorge', 3).gen!.hab!;
  assert.ok(g.gates.find((x) => x.id === 'reach:frozen')!.ok && g.gates.find((x) => x.id === 'drainage')!.ok);
  assert.ok((g.metrics.fallsEdges ?? 0) >= 2, 'the river falls between levels');
});

test('generation failure is reported, never a silent bad map', () => {
  const broken = { ...HABITATS['river-gorge'], id: 'broken', freedoms: { ...HABITATS['river-gorge'].freedoms, bankW: [0.5, 0.5] as [number, number], islandRx: [3, 3] as [number, number] }, fallbackSeeds: [] };
  assert.throws(() => generateHabitat({ recipe: broken, seed: 1 }), (e: unknown) => e instanceof HabitatError && e.rejections.length > 0 && /failed/.test((e as Error).message));
});

test('sim seam: the map loads through the normal entry point; the objective is a Hold on the generated point', () => {
  const wg = { ...defaultRules.worldgen, mode: 'generated' as const, locations: { meadow: 'river-gorge' } };
  assert.ok(regionKey('meadow', 9, wg).includes(`H${HAB_VERSION}`));
  assert.equal(regionMap(wg, 'meadow', 9).gen!.hab!.recipe, 'river-gorge');
  const ctx = createRun({ seed: 3, species: 'cyndaquil', ruleOverrides: { worldgen: { mode: 'generated', regionSeed: 9, locations: { meadow: 'river-gorge' } } } as never });
  const H = ctx.world.hab!;
  assert.ok(H && ctx.world.los, 'habitat maps use the location rules (line of sight, drop navigation)');
  for (let i = 0; i < 30; i++) step(ctx, NO_INPUT);
  // the schedule's first objective in region 1 is a Hold anyway; the second (a Hunt elsewhere) is a Hold here too
  ctx.stageTime = ctx.rules.objectives.secondAfter + 1; ctx.beat.objectives = 1;
  const due = objectiveDue(ctx);
  assert.equal(due, 'hold', 'every objective on a habitat map is the shared control point');
  assert.ok(startObjective(ctx, due!), 'an objective opened');
  assert.equal(ctx.objective!.kind, 'hold');
  assert.ok(Math.abs(ctx.objective!.x - (H.contest.x - ctx.world.half)) < 0.01 && Math.abs(ctx.objective!.z - (H.contest.y - ctx.world.half)) < 0.01, 'on the generated contest floor');
  // Raiders have a flow field to the point from team B's staging
  const out: [number, number] = [0, 0];
  assert.ok(ctx.world.goalDir(H.stage.B[0] - ctx.world.half, H.stage.B[1] - ctx.world.half, out));
});

test('sim seam: vents erupt on a fixed cycle and hurt what stands in them; lava never freezes', () => {
  let seed = 1, m;
  for (; seed < 20; seed++) { m = gen('volcanic-ridge', seed); if (m.gen!.hab!.hazard.length) break; }
  const ctx = createRun({ mode: RANGE, seed: 1, species: 'totodile', ruleOverrides: { worldgen: { mode: 'generated', regionSeed: seed, locations: { meadow: 'volcanic-ridge' } } } as never });
  const W = ctx.world, H = W.hab!, P = ctx.player, k = H.hazard[0];
  P.x = (k % W.w) - W.half + 0.5; P.z = ((k / W.w) | 0) - W.half + 0.5; P.y = W.height(P.x, P.z);
  const hp0 = P.hp;
  const V = ctx.rules.habitat.vent;
  let sawWarn = false, hurt = false;
  for (let i = 0; i < Math.ceil(V.period * 60) + 30; i++) {
    P.x = (k % W.w) - W.half + 0.5; P.z = ((k / W.w) | 0) - W.half + 0.5; P.iframes = 0;
    step(ctx, NO_INPUT);
    if (ventPhase(ctx) === 'warn') sawWarn = true;
    if (P.hp < hp0) { hurt = true; break; }
  }
  assert.ok(sawWarn, 'a warning phase precedes the eruption');
  assert.ok(hurt, 'standing in an erupting vent field hurts');
  // lava: Cold on a lava tile makes steam, never ice
  const lava = [...W.map.terrain.keys()].find((i) => W.map.terrain[i] === T.water)!;
  applyAgent(ctx, 'cold', (lava % W.w) - W.half + 0.5, ((lava / W.w) | 0) - W.half + 0.5, 0.5);
  assert.ok(!W.cells.iceAt(lava), 'lava does not freeze');
  assert.ok(W.height((lava % W.w) - W.half + 0.5, ((lava / W.w) | 0) - W.half + 0.5) > 2, 'the lava surface sits at its own level in the crater');
});

test('playable run: spawn → objective → retreat through the real sim on both recipes', () => {
  for (const id of IDS) {
    const [r] = playHabitat(id, 2, { route: 'direct' });
    assert.ok(r.reach !== null, `${id}: reached the point (${r.note})`);
    assert.ok(r.held, `${id}: held it to completion (${r.note})`);
    assert.ok(r.back !== null, `${id}: retreated to staging`);
  }
});

// ── how habitat maps meet the rest of the game: Settings → World → Map, ?loc=, the default rotation ───────────────────
test('every Settings → World → Map choice resolves from its saved form and its ?loc= form and reaches the generator seam', () => {
  const choices = [...Object.keys(LOCATIONS), ...IDS.flatMap((id) => [id, ...Object.keys(HABITATS[id].variants).map((v) => `${id}:${v}`)])];
  const wg = { mode: 'generated' as const, biomes: [], size: 128, version: defaultRules.worldgen.version };
  for (const c of choices) {
    assert.equal(findMapSource(c), c, `${c} (saved form)`);
    assert.equal(findMapSource(c.replace(':', '/')), c, `${c} (URL form, as main.ts hands a saved choice over)`);
    assert.equal(locationFor({ ...wg, locations: { meadow: c } }, 'meadow'), c, `${c} reaches the seam`);
  }
  // loose names, an unknown surface variant (the base recipe), and nothing for what does not exist
  assert.equal(findMapSource('Shrine Gorge'), 'river-gorge');
  assert.equal(findMapSource('volcano'), 'volcanic-ridge');
  assert.equal(findMapSource('river-gorge/ash'), 'river-gorge');
  assert.equal(findMapSource('river-gorge/snow'), 'river-gorge:snow');
  assert.equal(findMapSource('atlantis'), undefined);
  assert.equal(findMapSource(''), undefined);
  // an id the seam does not know is treated as the classic generator, never as a half-built map
  assert.equal(locationFor({ ...wg, locations: { meadow: 'atlantis' } }, 'meadow'), '');
  assert.equal(locationFor({ ...wg, mode: 'authored' as never, locations: { meadow: 'river-gorge' } }, 'meadow'), '', 'handcrafted regions ignore it');
});

test('habitat sources leave every other map alone: the default rotation, classic regions and the cache keys', () => {
  const base = { ...defaultRules.worldgen, mode: 'generated' as const };
  // default rotation (Settings → World → Regions → Pokémon locations, Map = Default rotation): Viridian Forest, then Mt. Moon
  assert.equal(locationFor(base, 'meadow'), 'viridian-forest');
  assert.equal(locationFor(base, 'dusk'), 'mt-moon');
  assert.equal(locationFor(base, 'badlands'), ''); assert.equal(locationFor(base, 'frost'), '');
  assert.equal(regionKey('badlands', 5, base), `badlands@5v${base.version}x${base.size}`, 'classic key unchanged');
  assert.ok(regionKey('meadow', 5, base).startsWith('viridian-forest@5L'), 'location key unchanged');
  // a habitat key names recipe, variant, seed and HAB_VERSION, so two layouts never share a cache slot or a ground texture
  const keys = new Set<string>(), ids = new Set<string>();
  for (const src of ['river-gorge', 'river-gorge:snow', 'volcanic-ridge', 'volcanic-ridge:ash']) for (const seed of [3, 4]) {
    const wg = { ...base, locations: { meadow: src } };
    keys.add(regionKey('meadow', seed, wg));
    ids.add(regionMap(wg, 'meadow', seed).id);
  }
  assert.equal(keys.size, 8); assert.equal(ids.size, 8);
  assert.ok(regionKey('meadow', 3, { ...base, locations: { meadow: 'river-gorge:snow' } }).startsWith(`river-gorge:snow@3H${HAB_VERSION}`));
  // an existing map carries no fluid levels, so the checksum's habitat term is absent (the replay hashes themselves:
  // `npx tsx scripts/checksum.ts` prints the same lines with and without the habitat patch)
  assert.equal(regionMap({ ...base, locations: { meadow: '' } }, 'meadow', 5).wlevel, undefined);
  assert.ok(regionMap({ ...base, locations: { meadow: 'river-gorge' } }, 'meadow', 3).wlevel, 'a habitat map does');
});

test('settings: Map and Map seed survive a save and load; anything else in a saved copy falls back to the default rotation and the run seed', () => {
  assert.equal(SETTINGS_DEFAULT.map, ''); assert.equal(SETTINGS_DEFAULT.mapSeed, -1); assert.equal(SETTINGS_DEFAULT.world, 'locations');
  const saved = loadSettings({ camV: 2, worldV: 2, world: 'authored', map: 'river-gorge:snow', mapSeed: 7 });
  assert.equal(saved.map, 'river-gorge:snow'); assert.equal(saved.mapSeed, 7); assert.equal(saved.world, 'authored', 'the World choice is kept beside it');
  assert.deepEqual(loadSettings(JSON.parse(JSON.stringify(saved))), saved, 'save then load changes nothing');
  for (const bad of [{ map: 5, mapSeed: 'x' }, { map: null, mapSeed: -4 }, { map: {}, mapSeed: 2.5 }, { map: [], mapSeed: NaN }, { mapSeed: Infinity }, { map: true }]) {
    const s = loadSettings({ camV: 2, worldV: 2, ...bad });
    assert.equal(s.map, '', JSON.stringify(bad)); assert.equal(s.mapSeed, -1, JSON.stringify(bad));
  }
  // a copy saved before habitats existed (and a new player) has neither: default rotation, seed from the run
  for (const old of [{ camV: 2, worldV: 2, world: 'generated' }, {}, null, 'garbage']) {
    const s = loadSettings(old); assert.equal(s.map, ''); assert.equal(s.mapSeed, -1);
  }
  assert.equal(loadSettings({ camV: 2, worldV: 2, world: 'generated' }).world, 'generated', 'a saved classic-regions choice is kept');
  assert.equal(loadSettings({ world: 'generated' }).world, 'locations', 'a copy from before locations moves to the default once (unchanged)');
});

// The body profiles are frozen at the numbers every shipped map was accepted against (docs/hero-shooter-pivot.md §8
// step 3): no roster or pool change can move a layout. A playable roster that outgrows them fails here instead of
// quietly walking bodies through routes the maps were never validated for.
test('habitat body profiles are the frozen validated numbers, and the playable roster still fits the trainer', () => {
  const P = Object.fromEntries(profilesFor().map((p) => [p.id, p]));
  assert.deepEqual(Object.fromEntries(Object.entries(P).map(([id, p]) => [id, [p.radius, p.step, p.climb, p.drop, p.eye, p.speed, p.essential]])), {
    trainer: [0.88, 0.6, 0.6, 4, [0.7, 1.42], 7.2, true],
    'trainer-jump': [0.88, 0.6, 2.44, Infinity, [0.7, 1.42], 7.2, false],
    'wild-small': [0.3, 0.6, 0.6, 4, [0.5, 0.9], 3.5, true],
    'wild-elite': [1.42, 0.6, 0.6, 4, [0.9, 1.4], 3.5, true],
    boss: [0.95, 0.6, 0.6, 4, [1.2, 2.5], 3, false],
  });
  // every hero, not just the partners: the featured lines (and, once drafted, the prototype list) must fit the frozen
  // trainer, or the maps were never validated for them
  for (const id of FEATURED) {
    const sp = SPECIES_BY_ID[id];
    assert.ok(partnerFootprint(sp, defaultRules) <= VALIDATED_PROFILES.trainerRadius + 1e-9, `${id}: footprint ${partnerFootprint(sp, defaultRules)} m`);
    assert.ok(sp.height * 0.8 <= VALIDATED_PROFILES.trainerEye[1] + 1e-9, `${id}: eye ${(sp.height * 0.8).toFixed(2)} m`);
  }
  const m = measuredProfileInputs();
  assert.ok(m.trainerRadius <= VALIDATED_PROFILES.trainerRadius + 1e-9, `the widest playable footprint ${m.trainerRadius} m is wider than the validated trainer ${VALIDATED_PROFILES.trainerRadius} m`);
  assert.ok(m.trainerEyeTop <= VALIDATED_PROFILES.trainerEye[1] + 1e-9, `the tallest playable eye ${m.trainerEyeTop.toFixed(2)} m is above the validated ${VALIDATED_PROFILES.trainerEye[1]} m`);
});
