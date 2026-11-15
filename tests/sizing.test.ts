import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NEUTRAL_CORE_EXTENT_M,
  SIZE_CUTOFFS_M,
  VISIBLE_CORE,
  sizeClassOf,
  speciesExtent,
  speciesSizing,
  visibleCoreMetres,
} from '../src/rules/sizing';
import { SPECIES, SPECIES_BY_ID, type SpeciesDef } from '../src/rules/species';

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('class cutoffs are Tiny 0.35, Small 0.65, Medium 1.15, Large 2.05', () => {
  assert.deepEqual([...SIZE_CUTOFFS_M], [0.35, 0.65, 1.15, 2.05]);
  assert.equal(sizeClassOf(0.1), 'Tiny');
  assert.equal(sizeClassOf(0.349), 'Tiny');
  // a cutoff belongs to the class above it
  assert.equal(sizeClassOf(0.35), 'Small');
  assert.equal(sizeClassOf(0.64), 'Small');
  assert.equal(sizeClassOf(0.65), 'Medium');
  assert.equal(sizeClassOf(1.14), 'Medium');
  assert.equal(sizeClassOf(1.15), 'Large');
  assert.equal(sizeClassOf(2.04), 'Large');
  assert.equal(sizeClassOf(2.05), 'Extra Large');
  assert.equal(sizeClassOf(20), 'Extra Large');
});

test('visible core is clamp(1.25 * S^0.45, 0.78, 2.55) and rises with extent', () => {
  assert.deepEqual({ ...VISIBLE_CORE }, { coefficient: 1.25, exponent: 0.45, min: 0.78, max: 2.55 });
  near(visibleCoreMetres(1), 1.25);
  near(visibleCoreMetres(0.6), 1.25 * Math.pow(0.6, 0.45));
  near(visibleCoreMetres(2), 1.25 * Math.pow(2, 0.45));
  // clamped at both ends
  near(visibleCoreMetres(0.3), 0.78); // raw 0.727
  near(visibleCoreMetres(0.01), 0.78);
  near(visibleCoreMetres(0), 0.78);
  near(visibleCoreMetres(100), 2.55);
  let last = 0;
  for (let s = 0.1; s < 12; s += 0.1) {
    const c = visibleCoreMetres(s);
    assert.ok(c >= last - 1e-12, `core fell at S=${s}`);
    assert.ok(c >= 0.78 && c <= 2.55);
    last = c;
  }
});

test('extent prefers an approved neutral core, then the canonical listed extent', () => {
  const sp = SPECIES_BY_ID.rattata;
  assert.equal(sp.canon?.heightM, 0.3);
  assert.deepEqual(speciesExtent(sp), { m: 0.3, source: 'canonical-listed' });
  NEUTRAL_CORE_EXTENT_M[sp.id] = 0.18;
  try {
    assert.deepEqual(speciesExtent(sp), { m: 0.18, source: 'approved-neutral' });
  } finally {
    delete NEUTRAL_CORE_EXTENT_M[sp.id];
  }
  // no canonical record at all: the old sprite-derived height, flagged as such
  const synthetic = { id: 'x', name: 'X', elements: [], stats: { hp: 1, atk: 1, def: 1, spa: 1, spd: 1, spe: 1 }, height: 1.4, art: 'x' } as SpeciesDef;
  assert.deepEqual(speciesExtent(synthetic), { m: 1.4, source: 'sprite-fallback' });
});

test('scale converts the target core against the neutral asset reference', () => {
  const sp = SPECIES_BY_ID.charmander; // canonical 0.6 m, idle reference 20 px -> 1.25 m
  const z = speciesSizing(sp, 20 / 16);
  assert.equal(z.extentSource, 'canonical-listed');
  assert.equal(z.sizeClass, 'Small');
  near(z.coreM, 1.25 * Math.pow(0.6, 0.45));
  near(z.neutralCoreM, 1.25);
  near(z.scale, z.coreM / 1.25);
  // the multiplier only depends on the neutral reference, never on the frame being drawn
  near(speciesSizing(sp, 20 / 16).scale, z.scale);
});

test('an evolution line grows, and ordering follows canonical extent', () => {
  const ref = 20 / 16; // same neutral reference, so only the extent moves
  const line = ['charmander', 'charmeleon', 'charizard'].map((id) => speciesSizing(SPECIES_BY_ID[id], ref));
  for (let i = 1; i < line.length; i++) assert.ok(line[i].coreM > line[i - 1].coreM, `${line[i].id} not bigger`);
  assert.deepEqual(line.map((z) => z.sizeClass), ['Small', 'Medium', 'Large']);
  const rat = speciesSizing(SPECIES_BY_ID.rattata, ref);
  const venu = speciesSizing(SPECIES_BY_ID.venusaur, ref);
  assert.ok(venu.coreM > rat.coreM * 2, 'Venusaur should read far bigger than Rattata');
});

test('authored boss scale is left alone: the curve returns 1 for it', () => {
  for (const sp of SPECIES.filter((s) => s.scale !== undefined)) {
    const z = speciesSizing(sp, 1.5);
    assert.equal(z.authored, true);
    assert.equal(z.scale, 1, `${sp.id} would double-scale`);
  }
  assert.ok(SPECIES.some((s) => s.scale !== undefined), 'no authored-scale species in the roster');
  for (const sp of SPECIES.filter((s) => s.scale === undefined)) assert.equal(speciesSizing(sp, 1.5).authored, false);
});

test('every roster species lands inside the clamp with a sane multiplier', () => {
  for (const sp of SPECIES) {
    const z = speciesSizing(sp, sp.height);
    assert.ok(z.coreM >= 0.78 && z.coreM <= 2.55, `${sp.id} core ${z.coreM}`);
    assert.ok(z.scale > 0.2 && z.scale < 5, `${sp.id} scale ${z.scale}`);
    assert.ok(Number.isFinite(z.scale));
  }
});

test('sizing is a render rule: sim and world never read it', async () => {
  const { readdirSync, readFileSync, statSync } = await import('node:fs');
  const { join } = await import('node:path');
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
  });
  for (const dir of ['src/sim', 'src/world']) {
    for (const f of walk(dir)) {
      assert.ok(!/from '[^']*rules\/sizing'/.test(readFileSync(f, 'utf8')), `${f} imports rules/sizing`);
    }
  }
});
