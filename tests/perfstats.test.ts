import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PerfStats } from '../src/ui/perfstats';

const sample = (t: number, frame: number, ticks = 1, mouse = 0) => ({ t, frame, sim: 0.5, render: 1, ui: 0.2, ticks, mouse });

test('perfstats: worst frame, its age and the hitch count within the window', () => {
  const s = new PerfStats(5000, 1500);
  let t = 0;
  for (let i = 0; i < 600; i++) { t += 1000 / 120; s.push(sample(t, i === 300 ? 60 : 1000 / 120)); }
  const st = s.stats()!;
  assert.equal(st.frame.max, 60);
  assert.ok(Math.abs(st.frame.maxAgo - (t - (300 + 1) * (1000 / 120)) / 1000) < 1e-9);
  assert.equal(st.hitches, 1);
  assert.ok(Math.abs(st.refresh - 1000 / 120) < 1e-9, 'the median frame is the display interval');
  assert.ok(Math.abs(st.fps - 120) < 1, `fps ${st.fps}`);
});

test('perfstats: samples older than the window are left out', () => {
  const s = new PerfStats(5000, 1500);
  s.push(sample(0, 200));
  for (let t = 100; t <= 6000; t += 16) s.push(sample(t, 16));
  const st = s.stats()!;
  assert.equal(st.frame.max, 16);
  assert.ok(st.span <= 5);
});

test('perfstats: the ring keeps the newest samples when it wraps', () => {
  const s = new PerfStats(1e9, 10);
  for (let i = 0; i < 25; i++) s.push(sample(i, i));
  assert.equal(s.size, 10);
  assert.deepEqual(s.recentFrames(3), [22, 23, 24]);
  assert.equal(s.stats()!.frames, 10);
});

test('perfstats: ticks per frame histogram (a 144 Hz display on the 60 Hz sim runs 0 or 1 ticks)', () => {
  const s = new PerfStats(5000, 1500);
  const pattern = [1, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 3, 2];
  pattern.forEach((k, i) => s.push(sample(i * 7, 7, k)));
  assert.deepEqual(s.stats()!.ticks, [7, 5, 1, 1]);
});

test('perfstats: mouse look gaps are short still runs between moving frames, not pauses', () => {
  const s = new PerfStats(5000, 1500);
  // moving, gap of 1, moving, gap of 2, moving, pause of 5, moving
  const m = [3, 0, 3, 0, 0, 3, 0, 0, 0, 0, 0, 3];
  m.forEach((v, i) => s.push(sample(i * 7, 7, 1, v)));
  const st = s.stats()!;
  assert.equal(st.look.frames, 4);
  assert.equal(st.look.gaps, 3);
});
