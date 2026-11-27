// Time of day (D12; WORLDGEN3D Q23.2 as amended; docs/RENDER3D.md "Time of day"): every map ships one fixed time, and
// all lighting — the sun, the two sets of six ambient colours, fog, the sky, grading and the lamp channel's strength —
// is read from one time-of-day value through keyframed per-map data. This pins that changing the value changes the
// lighting, and that the 3D scene reads lighting through that one path and no other, so a cycle (task TD) only has to
// move the value.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { BIOME_BINDINGS, bindingFor } from '../src/rules/styles/bindings';
import { FIXED_HOUR, hourFromParam, keyLightDir, lightingAt, mapTime, sunSine, type Lighting } from '../src/rules/styles/timeofday';
import { resolve } from '../src/rules/styles/resolve';
import { lightAt, lightUniforms } from '../src/render/world3d/lighting';

const lum = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const differs = (a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b);

/** every lighting field, so a test can name the ones that moved */
const FIELDS: [string, (L: Lighting) => unknown][] = [
  ['sun direction', (L) => L.sunDir], ['sun colour × intensity', (L) => L.sun],
  ['ambient, open sky (6)', (L) => L.ambient.open], ['ambient, enclosed (6)', (L) => L.ambient.enclosed],
  ['sky', (L) => L.sky], ['fog', (L) => L.fog], ['grading', (L) => L.grade], ['lamp strength', (L) => L.lamp],
];

test('time of day: changing the one value changes every part of the lighting, on every binding', () => {
  for (const b of Object.values(BIOME_BINDINGS)) {
    const t = mapTime(b);
    const fixed = lightingAt(t, t.hour);
    // the opposite side of the clock: night for a day map, day for a night map
    const other = lightingAt(t, t.hour + 12);
    // (a cave's lamps burn the same day and night: its lamp strength is keyed, at one value)
    for (const [name, f] of FIELDS) if (!(name === 'lamp strength' && b.light === 'cave')) assert.ok(differs(f(fixed), f(other)), `${b.id}: ${name} did not change between ${t.hour}:00 and ${(t.hour + 12) % 24}:00`);
    // and it is continuous: a minute moves it a little, not a lot
    const a = lightingAt(t, 9), c = lightingAt(t, 9 + 1 / 60);
    assert.ok(Math.abs(lum(a.sun.colour) * a.sun.intensity - lum(c.sun.colour) * c.sun.intensity) < 0.02, `${b.id}: the key light jumps within a minute`);
  }
});

test('time of day: the scene reads lighting only through lightAt, and lightAt only from lightingAt', () => {
  // the render side's one path: lightAt(time, hour) === lightUniforms(lightingAt(time, hour)), and it moves with the hour
  const t = mapTime(bindingFor('meadow'));
  assert.deepEqual(lightAt(t, 9.25), lightUniforms(lightingAt(t, 9.25)));
  const u0 = lightAt(t, t.hour), u1 = lightAt(t, 20);
  // each group of uniforms moves (the fog's distances and amount, and gamma and gain, are keyed at one value today)
  const groups: Record<string, (u: typeof u0) => unknown> = {
    sun: (u) => [u.sunDir, u.sun], ambient: (u) => [u.ambOpen, u.ambEnclosed], sky: (u) => [u.skyHor, u.skyZen],
    fog: (u) => [u.fogColour, u.fogNear, u.fogFar, u.fogAmount], grading: (u) => [u.lift, u.gamma, u.gain, u.saturation], lamp: (u) => u.lamp,
  };
  for (const [g, f] of Object.entries(groups)) assert.ok(differs(f(u0), f(u1)), `the ${g} uniforms did not change with the hour`);

  // the source rule: under src/render only world3d/lighting.ts calls lightingAt or reads a MapTime's keys; only
  // three/view.ts calls lightAt, and every light, fog, sky and grading uniform there is written inside its `apply`
  const files: string[] = [];
  const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (p.endsWith('.ts')) files.push(p); } };
  walk('src/render');
  const calls = (re: RegExp) => files.filter((f) => re.test(fs.readFileSync(f, 'utf8').replace(/\/\/.*$/gm, ''))).map((f) => path.relative('src/render', f));
  assert.deepEqual(calls(/\blightingAt\s*\(/), ['world3d/lighting.ts']);
  assert.deepEqual(calls(/\.keys\b(?!\()/), []);
  assert.deepEqual(calls(/\bkeysFor\s*\(/), []);
  assert.deepEqual(calls(/\blightAt\s*\(/).filter((f) => f !== 'world3d/lighting.ts'), ['three/view.ts']);
  const view = fs.readFileSync('src/render/three/view.ts', 'utf8');
  const applyAt = view.indexOf('const apply = (L: LightUniforms) => {'), applyEnd = view.indexOf('\n  };', applyAt);
  assert.ok(applyAt > 0 && applyEnd > applyAt, 'view.ts has one apply');
  const outside = view.slice(0, applyAt) + view.slice(applyEnd);
  for (const w of ['W.apply(', 'G.apply(', 'sun.color.', 'sun.intensity =', 'uFog.value', 'uFogNear.value =', 'uFogFar.value =', 'uFogK.value =', 'uHor.value', 'uZen.value']) assert.ok(!outside.includes(w), `view.ts writes ${w} outside apply`);
  assert.equal((view.match(/apply\(lightAt\(/g) ?? []).length, 2, 'lightAt feeds apply at a map load and at setHour only');
});

test('time of day: every map has one fixed hour, the dev parameter overrides it', () => {
  for (const b of Object.values(BIOME_BINDINGS)) assert.equal(mapTime(b).hour, FIXED_HOUR[b.light]);
  assert.equal(resolve('lowpoly', 'meadow').time.hour, 10);
  assert.equal(resolve('lowpoly', 'dusk').time.hour, 22);
  assert.equal(hourFromParam(null, 10), 10);
  assert.equal(hourFromParam('', 10), 10);
  assert.equal(hourFromParam('17.5', 10), 17.5);
  assert.equal(hourFromParam('9:30', 10), 9.5);
  assert.equal(hourFromParam('25', 10), 1);
  assert.equal(hourFromParam('noon', 10), 10);
});

test('time of day: at the fixed hour an open-sky top facing up is lit to its base colour (the transcription)', () => {
  // key light × n·l plus the open ambient's +y colour: luminance 1 at the fixed hour, so the top shows the binding's
  // colour (today's tables) and sides read darker (Q23.3)
  for (const b of Object.values(BIOME_BINDINGS)) {
    const L = lightingAt(mapTime(b), mapTime(b).hour);
    const up = lum(L.sun.colour) * L.sun.intensity * Math.max(0, L.sunDir[1]) + lum(L.ambient.open[2]);
    assert.ok(Math.abs(up - 1) < 0.03, `${b.id}: an open top gets ${up.toFixed(3)} of its base colour`);
    // a side facing away from the key light gets only the side ambient: darker than the top
    assert.ok(lum(L.ambient.open[0]) < up - 0.2 && lum(L.ambient.open[1]) < up - 0.2, `${b.id}: sides read apart from tops`);
    // enclosed is darker than open in every direction
    for (let i = 0; i < 6; i++) assert.ok(lum(L.ambient.enclosed[i]) < lum(L.ambient.open[i]), `${b.id}: enclosed ${i} not darker`);
  }
});

test('time of day: the key light runs on a plane perpendicular to the team axis, symmetric about noon (Q18.8)', () => {
  for (const axis of [[0, 1], [1, 0], [Math.SQRT1_2, Math.SQRT1_2]] as [number, number][]) {
    for (let h = 0; h < 24; h += 0.25) {
      const d = keyLightDir(h, axis);
      assert.ok(Math.abs(d[0] * axis[0] + d[2] * axis[1]) < 1e-9, `the key light leans toward a team at ${h}:00`);
      assert.ok(Math.abs(Math.hypot(...d) - 1) < 1e-9);
      assert.ok(d[1] > 0, 'the key light is always above the horizon (the moon by night)');
    }
    for (const x of [1, 2.5, 4, 5.5]) {
      const a = keyLightDir(12 - x, axis), b = keyLightDir(12 + x, axis);
      assert.ok(Math.abs(a[1] - b[1]) < 1e-9 && Math.abs(a[0] + b[0]) < 1e-9 && Math.abs(a[2] + b[2]) < 1e-9, `not symmetric about noon at ±${x} h`);
    }
  }
  // staging markers set the axis: Hold maps pass A and B
  assert.deepEqual(mapTime(bindingFor('meadow'), [[0, -20], [0, 20]]).teamAxis, [0, 1]);
  assert.deepEqual(mapTime(bindingFor('meadow'), [[-20, 0], [20, 0]]).teamAxis, [1, 0]);
  assert.ok(sunSine(12) === 1 && Math.abs(sunSine(6)) < 1e-12);
});

test('time of day: a look layer may anchor the keyframes at another fixed hour and key share, calibrated there', () => {
  for (const [hour, keyShare] of [[11, 0.65], [10, 0.85], [9, 0.75]] as [number, number][]) {
    const S = resolve('lowpoly', 'meadow', { overlay: { hour, keyShare } });
    assert.equal(S.time.hour, hour);
    const L = lightingAt(S.time, hour);
    const key = lum(L.sun.colour) * L.sun.intensity * Math.max(0, L.sunDir[1]), up = key + lum(L.ambient.open[2]);
    assert.ok(Math.abs(up - 1) < 0.03, `an open top at ${hour}:00, share ${keyShare}: ${up}`);
    assert.ok(Math.abs(key - keyShare) < 0.03, `the key light's part ${key}`);
  }
});
