import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NEUTRAL_CORE_EXTENT_M,
  SIZE_CUTOFFS_M,
  bodyOf,
  classTilt,
  enemyHeight,
  enemyRadius,
  legacyRadius,
  partnerHeight,
  partnerRadius,
  sizeClassIndex,
  sizeClassOf,
  speciesExtent,
  speciesSizing,
  xlVisual,
  runSizeRules,
} from '../src/rules/sizing';
import { createRun } from '../src/sim/run';
import { SHAPE_AXIS, SPECIES_AXIS, axisOf, axisOfShape } from '../src/rules/shapes';
import { SPECIES_OVERRIDES } from '../src/rules/profiles';
import { SPECIES, SPECIES_BY_ID, type SpeciesDef } from '../src/rules/species';
import { defaultRules } from '../src/rules/defaults';

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const S = defaultRules.size;
const synthetic = (id: string, heightM: number, extra: Partial<SpeciesDef> = {}) =>
  ({ id, name: id, elements: [], stats: { hp: 1, atk: 1, def: 1, spa: 1, spd: 1, spe: 1 }, height: 1, art: id, canon: { levelUp: [], abilities: [], heightM, weightKg: 1 }, ...extra }) as SpeciesDef;

test('class cutoffs are Tiny 0.35, Small 0.65, Medium 1.15, Large 2.05 (a cutoff belongs to the class above)', () => {
  assert.deepEqual([...SIZE_CUTOFFS_M], [0.35, 0.65, 1.15, 2.05]);
  const cases: [number, string][] = [[0.1, 'Tiny'], [0.349, 'Tiny'], [0.35, 'Small'], [0.64, 'Small'], [0.65, 'Medium'], [1.14, 'Medium'], [1.15, 'Large'], [2.04, 'Large'], [2.05, 'Extra Large'], [20, 'Extra Large']];
  for (const [m, name] of cases) assert.equal(sizeClassOf(m), name, `${m} m`);
});

test('classes are visibly distinct: every class target is ≥ 1.3× the one below, and tilted ranges never overlap', () => {
  const C = S.classes;
  for (let i = 1; i < C.length; i++) {
    assert.ok(C[i].visual >= C[i - 1].visual * 1.3, `${C[i].id} only ${(C[i].visual / C[i - 1].visual).toFixed(2)}× ${C[i - 1].id}`);
    assert.ok(C[i].visual * (1 - S.tilt) > C[i - 1].visual * (1 + S.tilt), `${C[i - 1].id} and ${C[i].id} overlap`);
    assert.ok(C[i].radius > C[i - 1].radius && C[i].height > C[i - 1].height, `${C[i].id} body not bigger`);
  }
});

test('the tilt is bounded and rises through a class', () => {
  for (let i = 0; i < S.classes.length; i++) {
    let last = 0;
    for (let m = 0.05; m < 12; m *= 1.05) {
      if (sizeClassIndex(m) !== i) continue;
      const f = classTilt(m, i);
      assert.ok(f >= 1 - S.tilt - 1e-12 && f <= 1 + S.tilt + 1e-12, `tilt ${f}`);
      assert.ok(f >= last - 1e-12, 'tilt fell inside a class');
      last = f;
    }
  }
  // the same canonical extent always yields the same body (deterministic, cached)
  near(bodyOf(SPECIES_BY_ID.rattata).visualM, bodyOf(SPECIES_BY_ID.rattata).visualM);
});

test('same-class species draw within ±tilt of the class target, whatever their extent', () => {
  // Tiny to Large; Extra Large draws the continuous law and stands at the class height-to-visual ratio, the test below
  for (const sp of SPECIES) {
    const b = bodyOf(sp);
    if (b.authored || b.sizeClass === 'xl') continue;
    const C = S.classes[b.sizeClassIndex];
    assert.ok(Math.abs(b.visualM / C.visual - 1) <= S.tilt + 1e-9, `${sp.id} ${b.visualM} vs ${C.visual}`);
    near(b.radius / C.radius, b.factor);
    near(b.height / C.height, b.factor);
  }
});

test('Extra Large under the defaults: drawn size from the continuous law, sim height = drawn × class ratio, radius ± tilt', () => {
  const C = S.classes[4];
  let n = 0;
  for (const sp of SPECIES) {
    const b = bodyOf(sp);
    if (b.authored || b.sizeClass !== 'xl') continue;
    n++;
    near(b.visualM, xlVisual(b.extentM, S));
    near(b.height, b.visualM * (C.height / C.visual));
    near(b.radius / C.radius, b.factor);
  }
  assert.ok(n > 0, 'the roster has Extra Large species');
});

test('extent prefers an approved neutral core, then the canonical listed extent, then the sprite height', () => {
  const sp = SPECIES_BY_ID.rattata;
  assert.equal(sp.canon?.heightM, 0.3);
  assert.deepEqual(speciesExtent(sp), { m: 0.3, source: 'canonical-listed', axis: 'height' });
  NEUTRAL_CORE_EXTENT_M[sp.id] = 0.18;
  try {
    assert.deepEqual(speciesExtent(sp), { m: 0.18, source: 'approved-neutral', axis: 'height' });
  } finally {
    delete NEUTRAL_CORE_EXTENT_M[sp.id];
  }
  const bare = { ...synthetic('bare', 0), canon: undefined, height: 1.4 } as SpeciesDef;
  assert.deepEqual(speciesExtent(bare), { m: 1.4, source: 'sprite-fallback', axis: 'height' });
});

test('a pinned size class overrides the extent and sits at the class centre', () => {
  const sp = synthetic('__pinned', 8.8); // a serpent's length: Extra Large by extent
  assert.equal(bodyOf(sp).sizeClass, 'xl');
  SPECIES_OVERRIDES.__pinned2 = { sizeClass: 'large' };
  try {
    const b = bodyOf(synthetic('__pinned2', 8.8));
    assert.equal(b.sizeClass, 'large');
    assert.equal(b.extentSource, 'override');
    near(b.visualM, S.classes[3].visual);
  } finally {
    delete SPECIES_OVERRIDES.__pinned2;
  }
});

test('the renderer scale converts the class target against the neutral asset, width-normalised when Wide', () => {
  const sp = SPECIES_BY_ID.charmander; // canonical 0.6 m: Small
  const z = speciesSizing(sp, 20 / 16);
  assert.equal(z.sizeClass, 'small');
  near(z.coreM, bodyOf(sp).visualM);
  near(z.scale, z.coreM / (20 / 16));
  assert.equal(z.wide, false);
  // a frame 2× wider than tall is normalised on width / wideRatio
  const w = speciesSizing(sp, 1, 2);
  assert.equal(w.wide, true);
  near(w.neutralCoreM, 2 / S.wideRatio);
  near(w.scale, w.coreM / (2 / S.wideRatio));
});

test('an evolution line grows across classes, and Venusaur reads far bigger than Rattata', () => {
  const line = ['charmander', 'charmeleon', 'charizard'].map((id) => bodyOf(SPECIES_BY_ID[id]));
  assert.deepEqual(line.map((b) => b.sizeClass), ['small', 'medium', 'large']);
  for (let i = 1; i < line.length; i++) assert.ok(line[i].visualM > line[i - 1].visualM * 1.25, `${line[i].id} not clearly bigger`);
  assert.ok(bodyOf(SPECIES_BY_ID.venusaur).visualM > bodyOf(SPECIES_BY_ID.rattata).visualM * 2.3);
});

test('authored boss scale is left alone: the renderer multiplier is 1 and the sim body is the drawn one', () => {
  const bosses = SPECIES.filter((s) => s.scale !== undefined);
  assert.ok(bosses.length > 0, 'no authored-scale species in the roster');
  for (const sp of bosses) {
    const z = speciesSizing(sp, 1.5);
    assert.equal(z.authored, true);
    assert.equal(z.scale, 1, `${sp.id} would double-scale`);
    near(z.radius, legacyRadius(sp));
    near(z.height, sp.height);
  }
});

test('sim geometry follows the class', () => {
  for (const sp of SPECIES) {
    near(enemyRadius(sp, 2), bodyOf(sp).radius * 2);
    near(enemyHeight(sp, 3), bodyOf(sp).height * 3);
    near(partnerHeight(sp), bodyOf(sp).height);
  }
  // partners are size-aware inside the clamp; an evolution never shrinks the body
  const [lo, hi] = S.playerRadius;
  for (const id of ['bulbasaur', 'charmander', 'squirtle', 'chikorita', 'cyndaquil', 'totodile']) {
    let cur: SpeciesDef | undefined = SPECIES_BY_ID[id], last = 0;
    for (; cur; cur = cur.evolvesTo ? SPECIES_BY_ID[cur.evolvesTo] : undefined) {
      const r = partnerRadius(cur);
      assert.ok(r >= lo && r <= hi, `${cur.id} radius ${r}`);
      assert.ok(r >= last, `${cur.id} shrank`);
      last = r;
    }
  }
});

test('size classes are sim rules now: sim reads them through rules/sizing, and only rules/sizing derives bodies', async () => {
  const { readdirSync, readFileSync, statSync } = await import('node:fs');
  const { join } = await import('node:path');
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
  });
  // the old per-site formula must not come back anywhere in the sim
  for (const f of walk('src/sim')) assert.ok(!/height \* 0\.4/.test(readFileSync(f, 'utf8')), `${f} derives a body radius itself`);
});

// ------------------------------------------------------------------ measurement axis and continuous XL (S1)
const shaped = (id: string, heightM: number, shape: string) =>
  synthetic(id, heightM, { canon: { levelUp: [], abilities: [], heightM, weightKg: 1, shape } });

test('the shape decides the axis from data: squiggle and fish list a length, every other shape a height', () => {
  assert.deepEqual(Object.entries(SHAPE_AXIS).sort(), [['fish', 'length'], ['squiggle', 'length']]);
  for (const shape of ['ball', 'arms', 'blob', 'upright', 'legs', 'quadruped', 'wings', 'tentacles', 'heads', 'humanoid', 'bug-wings', 'armor', undefined, 'a-future-shape'])
    assert.equal(axisOfShape(shape), 'height', String(shape));
  for (const sp of SPECIES) {
    assert.ok(sp.canon?.shape, `${sp.id}: no canon.shape (rebuild content)`);
    assert.equal(sp.canon.axis, axisOf(sp.id, sp.canon.shape), sp.id);
  }
  // reviewed per-species axis overrides name an axis only (no metres); Eternatus' 20 m is a length (owner 2026-11-18)
  assert.deepEqual({ ...SPECIES_AXIS }, { eternatus: 'length' });
  assert.equal(axisOf('eternatus', 'wings'), 'length');
  assert.equal(axisOf('lugia', 'wings'), 'height');
  assert.equal(SPECIES_BY_ID.onix.canon?.axis, 'length');
  assert.equal(SPECIES_BY_ID.snorlax.canon?.axis, 'height');
});

test('measurement axis: a listed length counts lengthRise × itself; heights and approved figures are unchanged', () => {
  const onix = SPECIES_BY_ID.onix;
  near(speciesExtent(onix).m, onix.canon!.heightM * S.lengthRise);
  assert.equal(speciesExtent(onix).source, 'length-rise');
  assert.equal(S.lengthRise, 0.5);
  assert.equal(bodyOf(onix).sizeClass, 'xl'); // 8.8 × 0.5 = 4.4 m
  assert.equal(bodyOf(SPECIES_BY_ID.lapras).sizeClass, 'large'); // its 2.5 m is a length
  assert.equal(bodyOf(shaped('__eel', 1.2, 'squiggle')).sizeClass, 'small'); // 0.6 m
  // an axis override uses the shared rule, not a figure of its own
  const eternatus = shaped('eternatus', 20, 'wings');
  assert.deepEqual(speciesExtent(eternatus), { m: 20 * S.lengthRise, source: 'length-rise', axis: 'length' });
  // a listed height is the extent as listed
  for (const sp of SPECIES) {
    const e = speciesExtent(sp);
    if (sp.canon?.axis === 'height' && sp.canon.heightM && e.source !== 'approved-neutral') assert.deepEqual(e, { m: sp.canon.heightM, source: 'canonical-listed', axis: 'height' }, sp.id);
  }
  // an approved figure still wins, and only it can name `span`
  NEUTRAL_CORE_EXTENT_M.onix = 4.4;
  NEUTRAL_CORE_EXTENT_M.__wing = { m: 1.6, axis: 'span' };
  try {
    assert.deepEqual(speciesExtent(onix), { m: 4.4, source: 'approved-neutral', axis: 'length' });
    assert.deepEqual(speciesExtent(shaped('__wing', 0.8, 'wings')), { m: 1.6, source: 'approved-neutral', axis: 'span' });
  } finally {
    delete NEUTRAL_CORE_EXTENT_M.onix;
    delete NEUTRAL_CORE_EXTENT_M.__wing;
  }
  for (const sp of SPECIES) assert.notEqual(speciesExtent(sp).axis, 'span', `${sp.id}: span without an approved figure`);
});

test('approved neutral extents: Falinks is one trooper (owner-reviewed 2026-11-19)', () => {
  // the game draws one trooper; the listed 3.0 m measures the six-trooper formation (docs/size-extremes-plan.md §S2.12)
  assert.deepEqual(Object.keys(NEUTRAL_CORE_EXTENT_M), ['falinks'], 'every entry is reviewed: add one only with the owner');
  for (const [id, e] of Object.entries(NEUTRAL_CORE_EXTENT_M)) assert.ok(typeof e === 'object' && e.basis, `${id} records its basis`);
  const f = SPECIES_BY_ID.falinks;
  assert.equal(f.canon?.heightM, 3);
  assert.deepEqual(speciesExtent(f), { m: 0.5, source: 'approved-neutral', axis: 'height' });
  assert.equal(bodyOf(f).sizeClass, 'small');
});

test('continuous XL: the draw rises with the extent from the old floor to the cap; radius and footprint keep the class', () => {
  const L = S.classes[3], X = S.classes[4];
  near(S.xlFloor, X.visual * (1 - S.tilt));
  near(xlVisual(L.below), S.xlFloor);
  near(xlVisual(1), S.xlFloor); // pinned into XL from below: the floor
  near(xlVisual(1000), S.xlVisualCap);
  let last = 0;
  for (let m = L.below; m < 40; m *= 1.03) {
    const v = xlVisual(m);
    assert.ok(v >= last - 1e-12 && v <= S.xlVisualCap + 1e-12, `${m} m -> ${v}`);
    last = v;
  }
  // no overlap: the smallest XL draw stays above the largest Large draw
  assert.ok(S.xlFloor > L.visual * (1 + S.tilt), 'XL floor overlaps Large');
  for (const sp of SPECIES) {
    const b = bodyOf(sp);
    if (b.sizeClass !== 'xl' || b.authored) continue;
    near(b.visualM, xlVisual(b.extentM));
    near(b.radius, X.radius * b.factor);
    assert.equal(b.body, X.body, sp.id);
  }
  // the exponent is a fixed constant, never fitted to the largest species
  assert.equal(S.xlExponent, 0.3);
  // giants read bigger than a 2.1 m XL (extents with axis on: Snorlax 2.1, Onix 4.4, Wailord 7.25, Eternatus 10)
  const snorlax = xlVisual(2.1), onix = xlVisual(4.4), wailord = xlVisual(7.25), eternatus = xlVisual(10);
  assert.ok(onix > snorlax * 1.2 && wailord > snorlax * 1.4 && eternatus <= S.xlVisualCap, `${snorlax} ${onix} ${wailord} ${eternatus}`);
});

test('UIHooks.sizeRules (runSizeRules): the run\'s size rules during a run, the defaults before one (F1)', () => {
  assert.equal(runSizeRules(null), defaultRules.size);
  assert.equal(runSizeRules(undefined), defaultRules.size);
  const run = createRun({ seed: 1, species: 'charmander', ruleOverrides: { size: { lengthRise: 1 } } });
  const got = runSizeRules(run);
  assert.equal(got, run.rules.size);
  assert.equal(got.lengthRise, 1);
  // the roster labels follow it: Lapras is Large by default (half its 2.5 m length) and Extra Large at the full length
  assert.equal(bodyOf(SPECIES_BY_ID.lapras, runSizeRules(null)).sizeClass, 'large');
  assert.equal(bodyOf(SPECIES_BY_ID.lapras, got).sizeClass, 'xl');
});

test('tall giants: an XL body is as tall as drawn at the class ratio', () => {
  const xl = S.classes[4];
  for (const sp of SPECIES) {
    const b = bodyOf(sp);
    if (b.sizeClass === 'xl' && !b.authored) assert.equal(b.height, b.visualM * (xl.height / xl.visual), sp.id);
  }
  // Onix: 3.11 m drawn, 2.78 m tall
  assert.ok(Math.abs(bodyOf(SPECIES_BY_ID.onix).height - 2.78) < 0.01);
});
