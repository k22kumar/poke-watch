// Regression checks from the generation and replay audit (docs/HABITAT_AUDIT.md, scripts/habaudit.ts): the requested and
// accepted seed and how a replay link reproduces them (retry and fallback included), retry exhaustion → known-good
// fallback → clear failure on controlled fixtures, `?mapseed=` parsing, and the claims of the snow and ash variants.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRun } from '../src/sim/run';
import { generateHabitat, HabitatError, HABITATS, HAB_VERSION, MAX_ATTEMPTS } from '../src/world/habitat';
import { VOLCANIC_RIDGE } from '../src/world/habitat/recipes';
import { mapChecksum } from '../src/world/maps';
import { loadInfo, mapErrorMessage, parseMapSeed, worldgenFromQuery } from '../src/world/replay';
import { BIOMES } from '../src/rules/stages';
import { T } from '../src/world/tiles';
import { registerPoisoned, registerRecipe, scriptedAttempt, unregister } from '../scripts/lib/habfixtures';
import { geometrySum, variantAgainstBase, variantPropRuleIssues } from '../scripts/habaudit';

const IDS = Object.keys(HABITATS);
const biomes = Object.keys(BIOMES);
const link = (l: string) => { const p = new URLSearchParams(l.replace(/^\?/, '')); return worldgenFromQuery({ world: 'locations', loc: p.get('loc'), mapseed: p.get('mapseed'), hv: p.get('hv'), biomes }, () => {}); };

test('every fallback seed is valid on its first attempt, so a fallback is one attempt (Cinder Crater listed seed 3, which needs four)', () => {
  for (const id of IDS) {
    for (const s of HABITATS[id].fallbackSeeds) {
      const H = generateHabitat({ recipe: id, seed: s }).gen!.hab!;
      assert.equal(H.attempts, 1, `${id}: fallback seed ${s} was rejected and re-rolled (${H.rejections.map((r) => r.failed.join('+')).join(', ')})`);
      assert.ok(!H.fallback && H.gates.every((g) => g.ok), `${id}: fallback seed ${s} passes every gate`);
    }
    // the variant's first-attempt acceptance is the recipe's (the geometry is identical): a fallback works in either
    const v = Object.keys(HABITATS[id].variants)[0], s = HABITATS[id].fallbackSeeds[0];
    assert.equal(generateHabitat({ recipe: id, seed: s, variant: v }).gen!.hab!.attempts, 1, `${id}:${v} fallback seed ${s}`);
  }
});

test('a retry is reproducible: requested and accepted seed are both reported, and each link loads the accepted map', () => {
  const m = generateHabitat({ recipe: 'volcanic-ridge', seed: 3 }), H = m.gen!.hab!, L = loadInfo(H);
  assert.ok(H.attempts > 1 && H.rejections.length === H.attempts - 1 && !H.fallback, 'Cinder Crater seed 3 is re-rolled (the batch example)');
  assert.equal(L.kind, 'retry'); assert.equal(L.requested, 3); assert.equal(L.loaded, H.attemptSeed); assert.notEqual(L.loaded, 3);
  assert.ok(L.label.includes('3') && L.label.includes(String(L.loaded)) && L.label.includes(`try ${H.attempts}`), `the plaque names both seeds: ${L.label}`);
  assert.match(L.replay, /mapseed=3&hv=\d+$/); assert.match(L.layout, new RegExp(`mapseed=${L.loaded}&hv=`));
  // the layout link: the accepted seed asked for directly gives the same map in one attempt (a different map id, never a different layout)
  const direct = generateHabitat({ recipe: 'volcanic-ridge', seed: L.loaded }), D = direct.gen!.hab!;
  assert.equal(D.attempts, 1);
  assert.equal(mapChecksum(direct), mapChecksum(m)); assert.equal(geometrySum(direct), geometrySum(m));
  // the replay link, parsed the way main.ts parses a launch, names the same recipe and requested seed
  const wg = link(L.replay);
  assert.equal(wg.mode, 'generated'); assert.equal((wg as { regionSeed: number }).regionSeed, 3); assert.equal((wg as { locations: Record<string, string> }).locations.meadow, 'volcanic-ridge');
  // a second generation (a second load, what another client builds) is the same map to the bit
  assert.equal(mapChecksum(generateHabitat({ recipe: 'volcanic-ridge', seed: 3 })), mapChecksum(m));
});

test('fresh processes agree: Cinder Crater seed 3 (a retry) loads to the same checksum, geometry, navigation and match state', () => {
  const run = (...extra: string[]) => {
    const out = execFileSync(process.execPath, ['--import', 'tsx', 'scripts/habaudit.ts', '--child', `?loc=volcanic-ridge&mapseed=3&hv=${HAB_VERSION}`, ...extra], { encoding: 'utf8', maxBuffer: 1 << 24 });
    return JSON.parse(out.split('\n').find((l) => l.startsWith('@@'))!.slice(2));
  };
  const a = run(), b = run('--warm', 'river-gorge/snow,volcanic-ridge');
  for (const k of ['checksum', 'geometry', 'paint', 'nav', 'sim', 'loaded', 'attempts', 'rejections', 'shape', 'label']) assert.equal(a[k], b[k], `${k} differs between a fresh process and one that built and played other maps first`);
  assert.equal(a.kind, 'retry');
});

test('retries exhausted → the known valid fallback, through the real validator; both links reproduce it', () => {
  for (const id of IDS) {
    const R = HABITATS[id], fs = R.fallbackSeeds, log: number[] = [];
    const m = generateHabitat({ recipe: id, seed: 9, attempt: scriptedAttempt((s) => s === fs[0], log) }), H = m.gen!.hab!, L = loadInfo(H);
    assert.equal(log.length, MAX_ATTEMPTS + 1, `${id}: ${MAX_ATTEMPTS} attempts of the requested seed, then the fallback`);
    assert.equal(log[0], 9); assert.equal(log[MAX_ATTEMPTS], fs[0]);
    assert.equal(H.rejections.length, MAX_ATTEMPTS); assert.equal(H.seed, 9); assert.equal(H.attemptSeed, fs[0]);
    assert.deepEqual({ requested: H.fallback!.requested, used: H.fallback!.used }, { requested: 9, used: fs[0] });
    // the validator ran on the fallback map: every gate is present and passes (not trusted blindly)
    assert.ok(H.gates.length >= 6 && H.gates.every((g) => g.ok), `${id}: the fallback map passed every gate`);
    assert.ok(H.gates.some((g) => g.id === 'reach:base') && H.gates.some((g) => g.id === 'perch'));
    assert.equal(L.kind, 'fallback'); assert.equal(L.label, `map seed 9 → ${fs[0]} (9 rejected)`);
    assert.ok(L.note.includes('rejected') && L.note.includes(`loaded the known valid seed ${fs[0]}`) && L.note.includes(L.layout));
    // the layout link is the known valid seed itself: its map is what loaded
    const direct = generateHabitat({ recipe: id, seed: fs[0] });
    assert.equal(mapChecksum(m), mapChecksum(direct)); assert.equal(geometrySum(m), geometrySum(direct));
    assert.match(L.layout, new RegExp(`mapseed=${fs[0]}&`));
    // the first fallback fails too: the list is walked in order
    const log2: number[] = [];
    const m2 = generateHabitat({ recipe: id, seed: 9, attempt: scriptedAttempt((s) => s === fs[1], log2) });
    assert.equal(m2.gen!.hab!.fallback!.used, fs[1]); assert.deepEqual(log2.slice(MAX_ATTEMPTS), fs.slice(0, 2));
  }
});

test('nothing usable: a HabitatError listing every candidate, and the dialog the player reads (no match, no half-built map)', () => {
  for (const id of IDS) {
    const log: number[] = [];
    let err: unknown;
    try { generateHabitat({ recipe: id, seed: 9, attempt: scriptedAttempt(() => false, log, 'perch') }); } catch (e) { err = e; }
    assert.ok(err instanceof HabitatError, `${id}: raised`);
    const e = err as HabitatError, n = MAX_ATTEMPTS + HABITATS[id].fallbackSeeds.length;
    assert.equal(e.rejections.length, n); assert.equal(log.length, n); assert.equal(e.recipe, id); assert.equal(e.seed, 9);
    const msg = mapErrorMessage(e);
    for (const part of [HABITATS[id].name, 'seed 9', `all ${n} candidates`, 'perch', 'No match was started', 'Settings → World']) assert.ok(msg.includes(part), `${id}: dialog says "${part}": ${msg}`);
  }
  assert.match(mapErrorMessage(new Error('boom')), /^boom\. Pick another/);
});

test('end to end on the real pipeline: a poisoned seed fails its attempts and the fallback loads through createRun; with no fallback the run does not start', () => {
  const R = registerPoisoned('fixture-crater', VOLCANIC_RIDGE, [1]);
  try {
    const ctx = createRun({ seed: 2, species: 'cyndaquil', ruleOverrides: { worldgen: { mode: 'generated', regionSeed: 9, locations: { meadow: 'fixture-crater' } } } as never });
    const H = ctx.world.hab!;
    assert.equal(H.fallback?.used, 1); assert.equal(H.seed, 9); assert.equal(H.attemptSeed, 1); assert.equal(H.rejections.length, MAX_ATTEMPTS);
    assert.ok(H.rejections.every((r) => r.failed.length > 0), 'each poisoned attempt failed a real gate: ' + H.rejections.map((r) => r.failed.join('+')).join(' | '));
    assert.ok(H.gates.every((g) => g.ok) && H.gates.length >= 6, 'the validator ran on the fallback before the run existed');
    assert.equal(ctx.state, 'play'); assert.ok(ctx.world.walkable(ctx.world.spawn[0], ctx.world.spawn[1]));
    assert.equal(loadInfo(H).label, 'map seed 9 → 1 (9 rejected)');
    // the poisoned recipe's good seed is untouched by the wrapper
    assert.equal(mapChecksum(generateHabitat({ recipe: R, seed: 1 })), mapChecksum(generateHabitat({ recipe: 'volcanic-ridge', seed: 1 })));
    // no usable fallback: createRun throws before any match starts, with the error main.ts shows
    HABITATS['fixture-crater'] = { ...R, fallbackSeeds: [] };
    assert.throws(() => createRun({ seed: 2, species: 'cyndaquil', ruleOverrides: { worldgen: { mode: 'generated', regionSeed: 11, locations: { meadow: 'fixture-crater' } } } as never }), (e: unknown) => e instanceof HabitatError && /No match was started/.test(mapErrorMessage(e)));
  } finally { unregister('fixture-crater'); }
});

test('?mapseed= is a whole number: empty and malformed values do not become seed 0 or NaN; large ones wrap and say so', () => {
  const said: string[] = [], w = (m: string) => said.push(m);
  assert.equal(parseMapSeed(null, w), -1); assert.equal(said.length, 0, 'absent is silent');
  for (const bad of ['', ' ', 'abc', '-3', '3.5', '1e3', '0x10', '7 7']) { said.length = 0; assert.equal(parseMapSeed(bad, w), -1, JSON.stringify(bad)); assert.equal(said.length, 1, `says so: ${bad}`); }
  assert.equal(parseMapSeed('0', w), 0); assert.equal(parseMapSeed(' 7 ', w), 7); assert.equal(parseMapSeed('4294967295', w), 4294967295);
  said.length = 0; assert.equal(parseMapSeed('4294967299', w), 3); assert.match(said[0], /wraps to 3/);
  // a replay link made by another generator version says so
  said.length = 0; worldgenFromQuery({ world: 'locations', loc: 'river-gorge', mapseed: '3', hv: String(HAB_VERSION + 1), biomes }, w);
  assert.match(said[0], /generator v\d+; this build is v\d+/);
  said.length = 0; worldgenFromQuery({ world: 'locations', loc: 'river-gorge', mapseed: '3', hv: String(HAB_VERSION), biomes }, w); assert.equal(said.length, 0);
});

test('surface variants keep what they claim: same collision, navigation, footing in every stage biome and accepted seed; props swap like for like', () => {
  for (const id of IDS) {
    assert.deepEqual(variantPropRuleIssues(id), [], `${id}: replacement props collide like the ones they replace`);
    const v = Object.keys(HABITATS[id].variants)[0];
    // seed 3 is the Cinder Crater retry: the variant takes the same re-rolled seed as the recipe
    const r = variantAgainstBase(id, v, 3, true);
    assert.deepEqual(r.issues, [], `${id}:${v} seed 3`);
  }
  assert.notEqual(variantAgainstBase('river-gorge', 'snow', 1, false).variant.paint, variantAgainstBase('river-gorge', 'snow', 1, false).base.paint, 'snow still repaints the trees');
});

test('the variant check catches the definitions it replaced: ash swapping dirt and sand (footing in Rimefrost), snow understory of rocks (0.75 m, not 0.70 m)', () => {
  registerRecipe('legacy-ash', VOLCANIC_RIDGE, { variants: { ash: { name: 'old ash', surfaces: { floor: T.sand, route: T.dirt }, art: 'badlands', particles: 'embers' } } });
  registerRecipe('legacy-snow', HABITATS['river-gorge'], { variants: { snow: { name: 'old snow', art: 'frost', particles: 'snow', trees: ['icepine', 'icepine', 'tree'], under: ['rock'] } } });
  try {
    const a = variantAgainstBase('legacy-ash', 'ash', 3, true);
    assert.ok(a.issues.some((x) => /^footing in frost/.test(x)), `ash: ${a.issues.join('; ')}`);
    assert.ok(a.issues.every((x) => !/collision|navigation/.test(x)), 'the ash swap never changed collision or navigation: only footing did');
    assert.ok(variantAgainstBase('legacy-snow', 'snow', 3, false).issues.includes('collision geometry'));
    assert.ok(variantPropRuleIssues('legacy-snow').some((x) => /under rock/.test(x)));
  } finally { unregister('legacy-ash'); unregister('legacy-snow'); }
});
