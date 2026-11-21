// R6b traversal capabilities (docs/LOCOMOTION.md "Capabilities"): reusable template rows, one accessor (`traversalOf`),
// the policies the old roster flag `flying` mixed together kept apart, and swim eligibility as a capability. Behaviour
// preservation is gated by scripts/checksum.ts; these tests pin the data model and the readers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { deepMerge } from '../src/core/util';
import { defaultRules, type Rules } from '../src/rules/defaults';
import { LEGACY_FLYING, LEGACY_SWIM, SPECIES_OVERRIDES, canSwim, traversalIds, traversalOf, validateTraversal } from '../src/rules/profiles';
import { RESERVED_KINDS, TRAVERSAL_TEMPLATES } from '../src/rules/traversal';
import { SPECIES, SPECIES_BY_ID } from '../src/rules/species';
import { createRun, step } from '../src/sim/run';
import { spawnEnemy } from '../src/sim/enemies';
import { NO_INPUT } from '../src/sim/types';

import { RANGE } from '../src/mods';
const CALM = { };
const withRules = (o: object) => deepMerge(defaultRules, o as never) as Rules;
/** run `fn` with extra SPECIES_OVERRIDES entries, restoring the table afterwards */
function withOverrides(extra: typeof SPECIES_OVERRIDES, fn: () => void) {
  const saved = Object.fromEntries(Object.keys(extra).map((k) => [k, SPECIES_OVERRIDES[k]]));
  Object.assign(SPECIES_OVERRIDES, extra);
  try { fn(); } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete SPECIES_OVERRIDES[k]; else SPECIES_OVERRIDES[k] = v; }
  }
}

test('the shipped templates and every species resolve without problems', () => {
  assert.deepEqual(validateTraversal(), []);
  assert.deepEqual(Object.keys(defaultRules.locomotion.templates).sort(), ['fixed-hover', 'glider', 'surface-swimmer']);
  for (const row of Object.values(TRAVERSAL_TEMPLATES)) assert.ok(!RESERVED_KINDS[row.kind], `${row.kind} is not reserved`);
  // the hover row reproduces the old literals exactly: 0.9 + ((slot × 37) mod 10) × 0.05, bob 0.15 at 3 rad/s
  assert.deepEqual(TRAVERSAL_TEMPLATES['fixed-hover'], { kind: 'hover', height: 0.9, step: 0.05, levels: 10, bob: 0.15, bobRate: 3 });
});

test('the legacy flag and the swimming types map to the rows they meant, and nothing else is derived', () => {
  for (const sp of SPECIES) {
    const t = traversalOf(sp), fly = !!sp.flying, tide = sp.elements.includes('tide');
    assert.equal(t.glide !== null, fly, `${sp.id}: glide`);
    assert.equal(t.hover !== null, fly, `${sp.id}: hover`);
    assert.equal(t.air, fly, `${sp.id}: air`);
    assert.equal(t.groundNav, !fly, `${sp.id}: ground navigation`);
    assert.equal(t.ventImmune, fly, `${sp.id}: vent immunity`);
    assert.equal(t.swim !== null, tide, `${sp.id}: swim`);
    assert.deepEqual(t.templates, [...(fly ? LEGACY_FLYING : []), ...(tide ? LEGACY_SWIM : [])], sp.id);
  }
});

test('movement eligibility is a capability, not a type (T25)', () => {
  // Flying type, no movement capability
  const doduo = SPECIES_BY_ID.doduo;
  assert.ok(doduo.elements.includes('gale'));
  assert.equal(traversalOf(doduo).air, false);
  // air capability, no Flying type
  for (const id of ['gastly', 'haunter', 'koffing', 'cutiefly', 'dreepy']) {
    assert.ok(!SPECIES_BY_ID[id].elements.includes('gale'), id);
    assert.ok(traversalOf(SPECIES_BY_ID[id]).air, id);
  }
  // Gengar: no movement capability at all (M18; its levitation is R6e), the Levitate ability is not read
  assert.deepEqual(traversalOf(SPECIES_BY_ID.gengar).templates, []);
});

test('species-specific differences: several capabilities on one body, none on another', () => {
  const char = traversalOf(SPECIES_BY_ID.charizard), toto = traversalOf(SPECIES_BY_ID.totodile), geo = traversalOf(SPECIES_BY_ID.geodude);
  assert.ok(char.glide && char.hover && !char.swim, 'Charizard: the player glide and the wild hover, two rows');
  assert.ok(!toto.glide && !toto.hover && toto.swim, 'Totodile: swims, no air row');
  assert.deepEqual(geo.templates, []);
  assert.ok(geo.groundNav && !geo.ventImmune);
});

test('an override replaces the derived list; policies are independent of each other', () => {
  withOverrides({
    __duck: { traversal: ['glider', 'surface-swimmer'] },
    __grounded: { traversal: [] },
    __hot: { ventImmune: false },
    __shielded: { ventImmune: true },
  }, () => {
    const duck = traversalOf({ id: '__duck', elements: ['plain'] });
    assert.ok(duck.glide && duck.swim && !duck.hover, 'two capabilities from one list');
    assert.ok(duck.air && duck.groundNav, 'a glider with no hover still routes on the ground');
    assert.ok(canSwim({ id: '__duck', elements: ['plain'] }), 'swims by capability, not type');
    const grounded = traversalOf({ id: '__grounded', elements: ['tide'], flying: true });
    assert.deepEqual(grounded.templates, [], 'an empty list removes even the derived rows');
    assert.ok(!canSwim({ id: '__grounded', elements: ['tide'] }) && canSwim({ id: '__grounded', elements: ['tide'] }, [{ key: 'surf' }]), 'Surf still lends swimming');
    const hot = traversalOf({ id: '__hot', elements: ['plain'], flying: true });
    assert.ok(hot.glide && hot.hover && !hot.ventImmune, 'vent immunity is its own policy');
    const shielded = traversalOf({ id: '__shielded', elements: ['plain'] });
    assert.ok(shielded.ventImmune && !shielded.air && shielded.groundNav);
    assert.deepEqual(validateTraversal(), []);
  });
});

test('validation names a bad template or list instead of accepting it', () => {
  withOverrides({ __bad: { traversal: ['nope'] }, __twice: { traversal: ['glider', 'glider'] } }, () => {
    const msg = validateTraversal().join('\n');
    assert.match(msg, /__bad\.traversal: unknown template 'nope'/);
    assert.match(msg, /__twice\.traversal: two 'glide' templates/);
    assert.throws(() => traversalOf({ id: '__bad', elements: [] }), /unknown traversal template 'nope'/);
    assert.throws(() => traversalOf({ id: '__twice', elements: [] }), /two 'glide' templates/);
  });
  const reserved = withRules({ locomotion: { templates: { wings: { kind: 'fly' } } } });
  assert.match(validateTraversal(reserved).join('\n'), /template wings: kind 'fly' arrives in R6d/);
  const badHover = withRules({ locomotion: { templates: { 'fixed-hover': { height: 0, levels: 2.5 } } } });
  const m = validateTraversal(badHover).join('\n');
  assert.match(m, /fixed-hover\.height/);
  assert.match(m, /fixed-hover\.levels/);
});

test('template numbers come from the rules the accessor is given (cached per rules object)', () => {
  const tuned = withRules({ locomotion: { templates: { 'fixed-hover': { height: 2 } } } });
  const sp = SPECIES_BY_ID.zubat;
  assert.equal(traversalOf(sp, tuned).hover?.height, 2);
  assert.equal(traversalOf(sp).hover?.height, 0.9, 'the default rules are untouched');
  assert.equal(traversalOf(sp), traversalOf(sp), 'one resolution per rules object and species');
  // the swimming default follows rules.hazards.water.safeTypes
  const stone = withRules({ hazards: { water: { safeTypes: ['tide', 'stone'] } } });
  assert.ok(traversalOf(SPECIES_BY_ID.geodude, stone).swim && !traversalOf(SPECIES_BY_ID.geodude).swim);
  assert.deepEqual(traversalIds(SPECIES_BY_ID.geodude, stone), LEGACY_SWIM);
});

test('the wild hover reads the hover row: height, spread and bob, no literals', () => {
  const ctx = createRun({ mode: RANGE, seed: 3, species: 'cyndaquil', ruleOverrides: { ...CALM, locomotion: { templates: { 'fixed-hover': { height: 2, step: 0, bob: 0 } } } } as never });
  const P = ctx.player, W = ctx.world;
  const i = spawnEnemy(ctx, 'zubat', P.x + 3, P.z + 3);
  assert.equal(ctx.enemies.hover[i], 2);
  assert.equal(ctx.enemies.foot[i], 0, 'a hovering body has no footprint');
  for (let k = 0; k < 30; k++) step(ctx, NO_INPUT);
  const g = W.height(ctx.enemies.x[i], ctx.enemies.z[i]);
  assert.ok(Math.abs(ctx.enemies.y[i] - (g + 2)) < 1e-5, `no bob: y ${ctx.enemies.y[i]} vs ${g + 2}`);
});

test('player glide and wild hover are separate rows of one species', () => {
  const fall = (traversal?: string[]) => {
    let vy = 0;
    withOverrides(traversal ? { charizard: { traversal } } : {}, () => {
      const ctx = createRun({ mode: RANGE, seed: 1, species: 'charizard', ruleOverrides: CALM as never });
      const P = ctx.player;
      P.y = P.py = ctx.world.height(P.x, P.z) + 30; P.grounded = false; P.vy = 0;
      for (let k = 0; k < 60; k++) step(ctx, { ...NO_INPUT, jump: true });
      vy = P.vy;
      // the wild Charizard of the same run: hovers unless the list drops the hover row
      const e = spawnEnemy(ctx, 'charizard', P.x + 4, P.z);
      const hovers = !traversal || traversal.includes('fixed-hover');
      assert.equal(ctx.enemies.hover[e] > 0, hovers, `wild Charizard hovers: ${hovers}`);
      assert.equal(ctx.enemies.foot[e] > 0, !hovers, 'a walking wild body has a footprint');
    });
    return vy;
  };
  assert.equal(fall(), -defaultRules.player.glideFallSpeed, 'the glide row clamps the fall with Jump held');
  assert.equal(fall(['fixed-hover']), fall(['fixed-hover']));
  assert.ok(fall(['fixed-hover']) < -defaultRules.player.glideFallSpeed - 1, 'no glide row: free fall, though it still hovers in the wild');
  assert.equal(fall(['glider']), -defaultRules.player.glideFallSpeed, 'glide without hover: the wild body walks');
});

test('source gate: nothing outside src/rules/profiles.ts reads the legacy `flying` flag', () => {
  const files: string[] = [];
  const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.ts')) files.push(p); } };
  walk('src');
  // declarations and data keep the field; the camera's own ChaseFrame input is named `flying` (render/camera.ts)
  const skip = new Set(['src/rules/profiles.ts', 'src/rules/species.ts', 'src/assets/pack.ts', 'src/rules/originals.ts', 'src/render/camera.ts']);
  const bad: string[] = [];
  for (const f of files) {
    if (skip.has(f) || f.startsWith('src/content/')) continue;
    readFileSync(f, 'utf8').split('\n').forEach((line, n) => { if (/(?<!ROLE)\??\.flying\b/.test(line)) bad.push(`${f}:${n + 1}: ${line.trim()}`); });
  }
  assert.deepEqual(bad, []);
});
