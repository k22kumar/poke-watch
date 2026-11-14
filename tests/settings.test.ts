// Saved settings (ui/settings.ts): the third-person camera is the default for new players, an old saved copy moves to
// it once, and a camera the player picked afterwards is kept. Run with `npm test`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CAMERA_DEFAULT, cameraPreset } from '../src/render/camera';
import { loadSettings, SETTINGS_DEFAULT } from '../src/ui/settings';

test('a new player (nothing saved, unreadable storage) gets the third-person camera', () => {
  for (const saved of [{}, null, undefined, 'garbage', 42]) {
    const s = loadSettings(saved);
    assert.equal(s.camera, 'chase');
    assert.equal(cameraPreset(s.camera).mode, 'chase');
  }
  assert.equal(CAMERA_DEFAULT, 'chase');
  assert.equal(SETTINGS_DEFAULT.camera, 'chase');
});

test('a copy saved before the third-person camera existed moves to it once, keeping every other choice', () => {
  // no camV in the saved object: the old loader merged it over the defaults first, so camV read as current and a
  // saved Classic / Wide view stayed on the elevated camera for good
  for (const camera of ['classic', 'wide', 'steep']) {
    const s = loadSettings({ camera, volume: 0.3, shake: 0, sens: 1.6 });
    assert.equal(s.camera, 'chase', `${camera} moved to third person`);
    assert.equal(s.camV, 2);
    assert.equal(s.volume, 0.3); assert.equal(s.shake, 0); assert.equal(s.sens, 1.6);
  }
  assert.equal(loadSettings({ camera: 'wide', camV: 1 }).camera, 'chase', 'an older camV migrates too');
});

test('a camera the player picked after that is their choice and is kept; an unknown one falls back to the default', () => {
  for (const camera of ['classic', 'wide', 'steep', 'chase']) assert.equal(loadSettings({ camera, camV: 2 }).camera, camera);
  assert.equal(loadSettings({ camera: 'retired-preset', camV: 2 }).camera, 'chase');
  // and saving what was loaded, then loading it again, changes nothing (no migration loop)
  const once = loadSettings({ camera: 'classic', camV: 2, world: 'generated', worldV: 2 });
  assert.deepEqual(loadSettings(JSON.parse(JSON.stringify(once))), once);
});
