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
} from '../src/rules/sizing';
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
  for (const sp of SPECIES) {
    const b = bodyOf(sp);
    if (b.authored) continue;
    const C = S.classes[b.sizeClassIndex];
    assert.ok(Math.abs(b.visualM / C.visual - 1) <= S.tilt + 1e-9, `${sp.id} ${b.visualM} vs ${C.visual}`);
    near(b.radius / C.radius, b.factor);
    near(b.height / C.height, b.factor);
  }
});

test('extent prefers an approved neutral core, then the canonical listed extent, then the sprite height', () => {
  const sp = SPECIES_BY_ID.rattata;
  assert.equal(sp.canon?.heightM, 0.3);
  assert.deepEqual(speciesExtent(sp), { m: 0.3, source: 'canonical-listed' });
  NEUTRAL_CORE_EXTENT_M[sp.id] = 0.18;
  try {
    assert.deepEqual(speciesExtent(sp), { m: 0.18, source: 'approved-neutral' });
  } finally {
    delete NEUTRAL_CORE_EXTENT_M[sp.id];
  }
  const bare = { ...synthetic('bare', 0), canon: undefined, height: 1.4 } as SpeciesDef;
  assert.deepEqual(speciesExtent(bare), { m: 1.4, source: 'sprite-fallback' });
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

test('sim geometry follows the class, and geometry: false restores the old bodies exactly', () => {
  const off = { ...defaultRules, size: { ...defaultRules.size, geometry: false } };
  for (const sp of SPECIES) {
    near(enemyRadius(sp, 2), bodyOf(sp).radius * 2);
    near(enemyHeight(sp, 3), bodyOf(sp).height * 3);
    assert.equal(enemyRadius(sp, 2, off), legacyRadius(sp) * 2);
    assert.equal(enemyHeight(sp, 2, off), 2);
    assert.equal(partnerRadius(sp, off), defaultRules.player.radius);
    assert.equal(partnerHeight(sp, off), 1.2);
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
