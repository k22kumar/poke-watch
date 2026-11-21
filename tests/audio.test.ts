// Audio checks after the hero-shooter pivot (docs/hero-shooter-pivot.md Q51): every music state is the adaptive
// score, there are no synthesised sounds anywhere in the audio path, and cries are recordings only (a species
// without one is silent). The adaptive score's own timing and stem checks are in tests/adaptive-audio.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CryBank } from '../src/assets/cries';

const read = (rel: string) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');

test('the audio path synthesises nothing: no oscillators, no generated waves, no chip-tune or sfx modules', () => {
  for (const f of ['../src/audio/audio.ts', '../src/audio/adaptive.ts', '../src/audio/adaptive-score.ts', '../src/assets/cries.ts']) {
    const src = read(f);
    for (const banned of ['createOscillator', 'createPeriodicWave', 'PeriodicWave', "from './sfx'", "from './music'", 'music.json']) {
      assert.ok(!src.includes(banned), `${f} still uses ${banned}`);
    }
  }
  for (const gone of ['../src/audio/sfx.ts', '../src/audio/music.ts', '../src/content/music.json', '../content/music/manifest.json']) {
    assert.ok(!fs.existsSync(new URL(gone, import.meta.url)), `${gone} should be deleted`);
  }
});

test('every music state plays the adaptive score: the director has no other track source', () => {
  const src = read('../src/audio/audio.ts');
  assert.match(src, /new AdaptivePlayer\(/);
  assert.ok(!/TRACKS|TrackPlayer|slotBuffers/.test(src), 'no chip-tune tracks or recording slots remain');
});

test('a species with no cry recording is silent: no fallback voice', () => {
  const bank = new CryBank();
  assert.equal(bank.kind('nocry'), 'none');
  assert.equal(bank.status('nocry'), 'none');
  assert.equal(bank.format('nocry'), 'none');
  bank.play(null, null, 'nocry'); // no context: a no-op, never throws
  assert.equal(bank.stats.played, 0);
  bank.sample('withcry', 'data:audio/ogg;base64,AAAA', 1);
  assert.equal(bank.kind('withcry'), 'sample');
  assert.equal(bank.status('withcry'), 'idle');
});
