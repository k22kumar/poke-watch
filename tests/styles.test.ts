// World styles (task I2a; WORLDGEN3D Q18 as superseded by Q23, D11; docs/RENDER3D.md): the closed profile registry
// with `lowpoly` alone, the closed pass registry, the biome bindings that replace today's four look tables, and the
// pure resolver. The renderer's half (src/render/three) is checked in the browser (tools/three-signal.mjs, captures).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { MATERIAL_ROLES } from '../src/rules/materialroles';
import { BIOME_BINDINGS } from '../src/rules/styles/bindings';
import { PASS_NEEDS, POST_PASS_IDS } from '../src/rules/styles/passes';
import { NORMAL_MODES, PATTERN_IDS, PROFILE_IDS, STYLE_PROFILES } from '../src/rules/styles/profiles';
import { resolve } from '../src/rules/styles/resolve';
import { RENDER_BUDGET } from '../src/rules/styles/budgets';
import { SKY } from '../src/render/sky';
import { ART_DIRECTION } from '../src/render/artdirection';

const HEX = /^#[0-9a-f]{6}$/;

test('styles: the profile registry is closed and holds lowpoly alone (D11)', () => {
  assert.deepEqual([...PROFILE_IDS], ['lowpoly']);
  assert.deepEqual(Object.keys(STYLE_PROFILES), ['lowpoly']);
  for (const id of PROFILE_IDS) {
    const P = STYLE_PROFILES[id];
    assert.equal(P.id, id);
    assert.deepEqual(Object.keys(P.roles).sort(), [...MATERIAL_ROLES].sort(), `${id}: one shading record per role`);
    for (const r of MATERIAL_ROLES) {
      const m = P.roles[r];
      assert.ok(NORMAL_MODES.includes(m.normal) && (PATTERN_IDS as readonly string[]).includes(m.pattern), `${id}.${r}`);
      assert.ok(m.ramp.bands >= 0 && m.ramp.bands <= P.constraints.maxBands && m.ink >= 0 && m.ink <= P.constraints.maxInk, `${id}.${r} inside its own constraints`);
    }
    for (const p of P.passes) assert.ok((POST_PASS_IDS as readonly string[]).includes(p), `${id}: pass ${p} is in the registry`);
    assert.ok(P.shape.creaseAngle > 0 && P.shape.creaseAngle < 90);
  }
});

test('styles: the pass registry is closed; every pass says what it reads', () => {
  assert.deepEqual([...POST_PASS_IDS], ['ink', 'bloom']);
  assert.deepEqual(Object.keys(PASS_NEEDS).sort(), [...POST_PASS_IDS].sort());
});

test('styles: a binding per art key, transcribed from today\'s tables', () => {
  // every art key a map can name (render/sky.ts SKY lists them all) has a binding with every role and both liquids
  assert.deepEqual(Object.keys(BIOME_BINDINGS).sort(), Object.keys(SKY).sort());
  for (const b of Object.values(BIOME_BINDINGS)) {
    for (const r of MATERIAL_ROLES) assert.match(b.roles[r], HEX, `${b.id}.${r}`);
    assert.match(b.liquids.water.colour, HEX); assert.match(b.liquids.lava.colour, HEX);
    // the transcription: sky and fog are render/sky.ts's, the world tint ART_DIRECTION's where it has one
    const sk = SKY[b.id], hex = (c: number[]) => '#' + c.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
    assert.equal(b.sky.hor, hex(sk.hor)); assert.equal(b.sky.zen, hex(sk.zen));
    assert.deepEqual([b.sky.fogNear, b.sky.fogFar, b.sky.fog], [sk.fogNear, sk.fogFar, sk.fog]);
    if (ART_DIRECTION[b.id]) { assert.deepEqual(b.world, ART_DIRECTION[b.id].world); assert.deepEqual(b.actor, ART_DIRECTION[b.id].actor); }
  }
});

test('styles: resolve is pure, drops passes at zero weight, applies the layers in order and logs its clamps', () => {
  const a = resolve('lowpoly', 'meadow'), b = resolve('lowpoly', 'meadow');
  assert.deepEqual(a, b);
  // lowpoly builds ink since the owner's pick (2026-11-27, p1i1); bloom stays at weight 0. A pass at zero weight is
  // not built: with ink and edge light at 0, neither is
  assert.deepEqual(a.passes, ['ink'], 'lowpoly builds ink, not bloom');
  assert.deepEqual(resolve('lowpoly', 'meadow', { overlay: { ink: { weight: 0 }, paint: { edgeLight: 0 } } }).passes, [], 'nothing at zero weight');
  assert.deepEqual(resolve('lowpoly', 'meadow', { overlay: { ink: { weight: 0.5 } } }).passes, ['ink']);
  // the ink pass draws the paint block's edge light too: built for edge light alone, with no ink
  assert.deepEqual(resolve('lowpoly', 'meadow', { overlay: { paint: { edgeLight: 0.1 } } }).passes, ['ink']);
  assert.deepEqual(resolve('lowpoly', 'meadow', { overlay: { ink: { weight: 0.5 }, bloom: { strength: 0.3 } } }).passes, ['ink', 'bloom'], 'in the profile\'s order');
  // look before overlay: the overlay wins
  const r = resolve('lowpoly', 'meadow', { look: { roles: { ground: { base: '#102030' } } }, overlay: { roles: { ground: { base: '#405060' } } } });
  assert.deepEqual(r.roles.ground.base, [0x40 / 255, 0x50 / 255, 0x60 / 255]);
  assert.deepEqual(r.roles.path.base, a.roles.path.base);
  // the profile is the final guard
  const c = resolve('lowpoly', 'meadow', { overlay: { ink: { weight: 3 }, roles: { rock: { ramp: { bands: 40, soft: 0 } } }, grade: { saturation: 9 } } });
  assert.equal(c.ink.weight, 1); assert.equal(c.roles.rock.ramp.bands, 8);
  assert.ok(c.time.keys.every((k) => k.grade.saturation === 2));
  assert.ok(c.log.some((l) => l.startsWith('ink.weight: 3 → 1')) && c.log.some((l) => l.startsWith('roles.rock.ramp.bands')) && c.log.some((l) => l.startsWith('grade.saturation')), c.log.join('; '));
  // an unknown art key falls back to meadow, as render/sky.ts does
  assert.equal(resolve('lowpoly', 'nowhere').binding, 'meadow');
});

test('styles: the style data imports no three and no renderer; three stays in src/render/three', () => {
  const files: string[] = [];
  const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(ts|mjs|js)$/.test(p)) files.push(p); } };
  walk('src');
  const imports = (f: string) => [...fs.readFileSync(f, 'utf8').matchAll(/(?:import|export)[^'"]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1] ?? m[2]);
  const bad: string[] = [];
  for (const f of files) {
    const rel = path.relative('src', f);
    for (const s of imports(f)) {
      const three = s === 'three' || s.startsWith('three/');
      if (three && !rel.startsWith(path.join('render', 'three') + path.sep)) bad.push(`${rel} imports ${s}`);
      if (rel.startsWith(path.join('rules', 'styles')) && (three || s.includes('/render/') || s.startsWith('../render') || s.includes('../../render'))) bad.push(`${rel} imports ${s}`);
      // the page reaches the side file through render/threeload.ts and the types of render/threehost.ts only
      if (!rel.startsWith(path.join('render', 'three') + path.sep) && /(^|\/)three\/(view|entry|backend|billboard|passes|worldmat)$/.test(s)) bad.push(`${rel} imports ${s}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('styles: the shipped profile fits the recalibrated budgets (Q20, I2a)', () => {
  const B = RENDER_BUDGET, C = B.categoryMs;
  assert.ok(Math.abs(C.terrain + C.actors + C.effects + C.shadows + C.post - B.frameMs) < 1e-9, 'the shares add up to the frame');
  assert.ok(B.backdrop.ms <= C.terrain && B.strokes.ms <= C.terrain && B.particleCards.ms <= C.effects);
  // bloom's default from the profiling: off, a quarter-resolution first target when on
  const P = STYLE_PROFILES.lowpoly;
  assert.equal(P.bloom.strength, 0);
  assert.equal(P.bloom.resolution, 0.25);
  assert.ok(!resolve('lowpoly', 'meadow').passes.includes('bloom'));
});
