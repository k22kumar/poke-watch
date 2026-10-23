// Asset pipeline tests: the importer runs end to end on the offline fixture mirror, its pack
// validates, maps canonical data onto the game's schema, and the animation fallback table
// resolves every gameplay state for sparse sources.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validatePack, type PackFile } from '../src/assets/pack';
import { resolveClips } from '../src/assets/clips';
import { NATIVE_CLIP, ANIM_STATES, dirIndex, frameAt, type FrameRect } from '../src/assets/art';
import { classify } from '../src/sim/moves';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bonkpack-'));
const mirror = path.join(tmp, 'mirror');

function buildFixturePack(): PackFile {
  execFileSync('node', [path.join(root, 'scripts/make-fixture-mirror.mjs'), mirror], { stdio: 'pipe' });
  execFileSync('node', [path.join(root, 'scripts/import-pack.mjs'), 'charmander', 'squirtle', 'totodile', '--mirror', mirror, '--out', path.join(tmp, 'out'), '--id', 'fixture'], { stdio: 'pipe', cwd: tmp });
  return JSON.parse(fs.readFileSync(path.join(tmp, 'out', 'fixture.bonkpack.json'), 'utf8'));
}

const pack = buildFixturePack();

test('importer produces a valid pack with the three test starters and their evolutions', () => {
  assert.deepEqual(validatePack(pack), []);
  assert.deepEqual(pack.species.map((s) => s.id), ['charmander', 'charmeleon', 'squirtle', 'wartortle', 'totodile', 'croconaw']);
  const byId = Object.fromEntries(pack.species.map((s) => [s.id, s]));
  assert.deepEqual(byId.charmander.elements, ['blaze']);
  assert.deepEqual(byId.squirtle.elements, ['tide']);
  assert.deepEqual(byId.charmander.stats, { hp: 39, atk: 52, def: 43, spa: 60, spd: 50, spe: 65 });
  assert.equal(byId.charmander.evolvesTo, 'charmeleon'); assert.equal(byId.charmander.evolveLevel, 16);
  assert.equal(byId.totodile.evolveLevel, 18);
  assert.equal(byId.charmander.starter, 'ember', 'same-type starter preferred');
  for (const s of pack.species.filter((s) => s.playable)) assert.ok((s.learnset ?? []).length >= 4, `${s.id} has a learnset`);
});

test('all three species use the same sprite format and full 8-direction animation sets', () => {
  for (const s of pack.species) {
    for (const name of ['Walk', 'Idle', 'Attack', 'Hurt', 'Faint']) {
      const a = s.art.anims[name];
      assert.ok(a, `${s.id}: ${name}`);
      assert.equal(a.frames.length, 8);
      for (const row of a.frames) {
        assert.equal(row.length, a.durations.length);
        for (const [, , w, h, ax, ay] of row) { assert.ok(w > 0 && h > 0); assert.ok(ax >= -2 && ax <= w + 2 && ay >= 0 && ay <= h + 2, `${s.id} ${name} anchor inside frame`); }
      }
    }
    assert.match(s.art.license!, /CC BY-NC 4\.0/);
    assert.ok(s.art.credits!.length > 0);
    assert.ok(s.provenance?.sha256?.atlas?.length === 64);
  }
  // durations come straight from SpriteCollab's AnimData (ticks)
  const ch = pack.species.find((s) => s.id === 'charmander')!;
  assert.deepEqual(ch.art.anims.Walk.durations, [6, 8, 6, 8]);
  assert.equal(ch.art.anims.Attack.hit, 6);
});

test('report records provenance and the deliberate fixture faults', () => {
  const report = JSON.parse(fs.readFileSync(path.join(tmp, 'out', 'report.json'), 'utf8'));
  assert.ok(report.sources.length > 50);
  assert.ok(report.sources.every((s: { sha256: string }) => /^[0-9a-f]{64}$/.test(s.sha256)));
  const warn = report.species.flatMap((s: { id: string; warnings: string[] }) => s.warnings.map((w) => s.id + ': ' + w)).join('\n');
  assert.match(warn, /squirtle: Hurt: no shadow sheet/);
  assert.match(warn, /totodile: cry missing/);
  assert.ok(fs.existsSync(path.join(tmp, 'out', 'preview', 'charmander.png')));
});

test('canonical move metadata becomes game behaviour', () => {
  const m = Object.fromEntries(pack.moves.map((x) => [x.key, x]));
  assert.equal(m.ember.element, 'blaze'); assert.equal(m.ember.ailment, 'burn'); assert.equal(m.ember.ailmentChance, 10);
  assert.equal(m.bubble.archetype, 'nova', 'all-opponents target -> radial burst');
  assert.equal(m.withdraw?.statusKind, 'buff');
  assert.equal(m.water_pulse.ailment, 'confuse');
  assert.ok(!pack.moves.some((x) => x.key === 'growl'), 'non-buff status moves are dropped');
  assert.equal(classify({ ...m.tackle }), 'dash', 'runtime classifier still handles names');
});

test('canonical learnsets merge all game versions and retain hidden abilities', () => {
  const charmander = pack.species.find((s) => s.id === 'charmander')!;
  assert.equal(charmander.canon?.levelUp.find(([, key]) => key === 'ember')?.[0], 6, 'earliest level across version groups');
  assert.deepEqual(charmander.canon?.abilities, ['blaze', 'solar_power']);
  assert.ok(!('versionGroup' in (charmander.canon ?? {})), 'canonical facts do not name one source version');
});

test('animation fallbacks resolve every state, even from a walk-only source', () => {
  const f = (x: number): FrameRect => ({ x, y: 0, w: 16, h: 16, ax: 8, ay: 15 });
  const walkOnly = { Walk: { frames: Array.from({ length: 8 }, () => [f(0), f(16), f(32), f(48)]), durations: [0.1, 0.1, 0.1, 0.1] } };
  const { clips, report } = resolveClips(walkOnly);
  for (const s of ANIM_STATES) assert.ok(clips[s], s);
  assert.equal(report.idle, 'Walk@0');
  assert.equal(clips.attack.overlay, 'lunge');
  assert.equal(clips.hurt.overlay, 'flash');
  // no Faint and no Hurt: hold a walk frame and sink into the ground (never replay Hurt as a faint)
  assert.equal(clips.faint.overlay, 'sink');
  assert.equal(report.faint, 'Walk@0+sink');
  assert.equal(frameAt(clips.walk, 0.25), 2);
  assert.equal(dirIndex(0), 0); assert.equal(dirIndex(Math.PI / 2), 2); assert.equal(dirIndex(Math.PI), 4); assert.equal(dirIndex(-Math.PI / 2), 6);
});

test('a missing Faint resolves to a sinking held pose and is reported as a substitute', () => {
  const f = (x: number): FrameRect => ({ x, y: 0, w: 16, h: 16, ax: 8, ay: 15 });
  const rows = (n: number) => Array.from({ length: 8 }, () => Array.from({ length: n }, (_, i) => f(i * 16)));
  const src: Record<string, { frames: FrameRect[][]; durations: number[] }> = { Walk: { frames: rows(4), durations: [0.1, 0.1, 0.1, 0.1] }, Hurt: { frames: rows(2), durations: [0.1, 0.1] }, Idle: { frames: rows(2), durations: [0.3, 0.3] } };
  assert.equal(resolveClips(src).report.faint, 'Hurt@0+sink', 'Hurt pose when there is no Sleep');
  src.Sleep = { frames: rows(2), durations: [0.5, 0.5] };
  const { clips, report } = resolveClips(src);
  assert.equal(report.faint, 'Sleep@0+sink', 'Sleep pose preferred');
  assert.equal(clips.faint.overlay, 'sink');
  assert.equal(clips.faint.frames[0].length, 1, 'holds one pose');
  assert.notEqual(report.faint, NATIVE_CLIP.faint);
  assert.equal(report.hurt, NATIVE_CLIP.hurt);
});

test('validator rejects malformed packs with readable reasons', () => {
  const bad = JSON.parse(JSON.stringify(pack));
  bad.species[0].art.anims.Walk.frames.pop();
  bad.species[0].starter = 'not_a_move';
  delete bad.species[2].art.license;
  const errs = validatePack(bad).join('\n');
  assert.match(errs, /Walk needs 8 direction rows/);
  assert.match(errs, /starter not_a_move not in moves/);
  assert.match(errs, /art licence missing/);
});
