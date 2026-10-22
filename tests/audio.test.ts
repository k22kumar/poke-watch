// Audio data checks: every move has an explicit sound mapping, every track's score is
// well-formed and loops at its declared loop point, and the music slots manifest is valid JSON.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { MOVES } from '../src/rules/moves';
import { MOVE_SFX, MATERIALS, MOTION } from '../src/audio/sfx';
import { TRACKS, barEvents, nextBar, trackBars, midi, chordNotes } from '../src/audio/music';

test('every move in the game has an explicit sound mapping', () => {
  for (const m of MOVES) {
    const s = MOVE_SFX[m.key];
    assert.ok(s, `${m.key} has no sound mapping`);
    assert.ok(MATERIALS[s.material], `${m.key}: material ${s.material}`);
    assert.ok(MOTION[s.motion], `${m.key}: motion ${s.motion}`);
    assert.ok(s.pitch > 0.6 && s.pitch < 1.4, `${m.key}: pitch ${s.pitch}`);
  }
  assert.equal(Object.keys(MOVE_SFX).length, MOVES.length);
});

test('every track is well-formed: bar lengths, chords, notes, loop point', () => {
  for (const t of Object.values(TRACKS)) {
    const n = trackBars(t);
    assert.ok(n > 0, t.id);
    for (const lines of [t.lead, t.harm, t.layer?.lead]) {
      if (!lines) continue;
      assert.equal(lines.length, n, `${t.id}: line length`);
      lines.forEach((b, i) => {
        const toks = b.split(/\s+/);
        assert.equal(toks.length, t.steps, `${t.id} bar ${i}: ${toks.length} steps`);
        for (const tk of toks) if (tk !== '-' && tk !== '.') assert.doesNotThrow(() => midi(tk), `${t.id}: ${tk}`);
      });
    }
    for (const d of [...t.drums, ...(t.layer?.drums ?? [])]) assert.equal(d.split(/\s+/).length, t.steps, `${t.id}: drum pattern ${d}`);
    for (const c of t.chords) assert.equal(chordNotes(c).length >= 3, true);
    assert.ok(t.loopStart >= 0 && t.loopStart < n, `${t.id}: loopStart`);
    // walk 3 loops: the bar after the last is the loop start (stingers end instead)
    let bar = 0, steps = 0;
    for (let k = 0; k < n * 3 && bar >= 0; k++) { barEvents(t, bar); bar = nextBar(t, bar); steps++; if (bar === t.loopStart && k >= n - 1) break; }
    if (t.stinger) assert.equal(nextBar(t, n - 1), -1, `${t.id}: stinger ends`);
    else assert.equal(nextBar(t, n - 1), t.loopStart, `${t.id}: loops to bar ${t.loopStart}`);
    assert.ok(steps > 0);
  }
});

test('music slots manifest parses and lists only known states', () => {
  const known = new Set(['title', 'route_meadow', 'route_badlands', 'route_frost', 'route_dusk', 'battle', 'boss', 'evolution', 'evolved', 'victory', 'defeat', 'item']);
  const man = JSON.parse(fs.readFileSync(new URL('../content/music/manifest.json', import.meta.url), 'utf8'));
  for (const k of Object.keys(man.slots ?? {})) assert.ok(known.has(k), k);
  for (const k of Object.keys(TRACKS)) assert.ok(known.has(k), `track ${k} has a slot name`);
});
