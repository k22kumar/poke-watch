// Actual offline asset decoding and runtime integration, not a mocked music player.
// node tools/musiccheck.mjs /absolute/path/to/dist/index.html
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('file://' + process.argv[2] + '?capture=1');
  await page.waitForFunction(() => window.pokewatch?.ready, null, { timeout: 90000 });
  await page.mouse.click(920, 520);
  await page.waitForFunction(() => pokewatch.audio.adaptiveStatus.ready, null, { timeout: 30000 });
  // Capture mode owns its clock; pump the presentation scheduler without advancing the sim.
  await page.evaluate(() => { window.musicTestPump = setInterval(() => pokewatch.audio.tick(1 / 60), 16); });
  const data = await page.evaluate(() => {
    const a = pokewatch.audio;
    return {
      status: a.adaptiveStatus,
      stems: a.adaptive.voices.map((v) => ({ duration: v.source.buffer.duration, loop: v.source.loop, end: v.source.loopEnd })),
      decodedMB: [...a.adaptive.buffers.values()].reduce((n, b) => n + b.length * b.numberOfChannels * 4, 0) / 1024 / 1024,
    };
  });
  assert.equal(data.status.playing, true);
  assert.equal(data.stems.length, 4);
  for (const stem of data.stems) { assert.ok(stem.loop); assert.equal(stem.end, 119.8); assert.ok(Math.abs(stem.duration - 119.8) < 0.12); }
  await page.evaluate(() => {
    const a = pokewatch.audio;
    window.leadSource = a.adaptive.voices[0].source;
    for (let i = 0; i < 20; i++) a.tick(0.1, { inRun: true, enemiesNear: 15, enemies: 30, boss: false });
  });
  await page.waitForFunction(() => pokewatch.audio.adaptiveStatus.intensity === 'surge', null, { timeout: 5000 });
  assert.equal(await page.evaluate(() => leadSource === pokewatch.audio.adaptive.voices[0].source), true);
  await page.evaluate(() => pokewatch.audio.onBossSpawn());
  await page.waitForFunction(() => pokewatch.audio.adaptiveStatus.intensity === 'climax', null, { timeout: 5000 });
  // The reference starts quietly; do not confuse its opening with a silent audio graph.
  await page.waitForFunction(() => pokewatch.audio.ctx.currentTime > pokewatch.audio.adaptive.startTime + 1.5 && pokewatch.audio.meters().music > -70, null, { timeout: 6000 });
  const mixer = await page.evaluate(() => {
    const a = pokewatch.audio;
    const audible = a.meters().music;
    a.mix.muted = true; a.applyVolume(); const muted = a.master.gain.gain.value;
    a.mix.muted = false; a.applyVolume(); a.setPaused(true);
    a.mix.music = 0.4; a.applyVolume(); const paused = a.music.gain.gain.value;
    a.setPaused(false);
    return { audible, muted, paused, context: a.ctx.state, time: a.ctx.currentTime,
      gains: [a.adaptive.out.gain.value, a.musicDuck.gain.value, a.music.gain.gain.value, a.master.gain.gain.value],
      voices: a.adaptive.voices.map((v) => ({ gain: v.gain.gain.value, sample: v.source.buffer.getChannelData(0)[100000] })) };
  });
  assert.ok(mixer.audible > -70 && mixer.audible < 0, JSON.stringify(mixer));
  assert.equal(mixer.muted, 0);
  assert.ok(Math.abs(mixer.paused - 0.4 * 0.7 * 0.45) < 0.0001);
  await page.evaluate(() => pokewatch.audio.onDefeat());
  assert.equal(await page.evaluate(() => pokewatch.audio.adaptiveStatus.playing), false);
  assert.equal(await page.evaluate(() => pokewatch.audio.adaptive.cueVoices.size), 1);
  await page.evaluate(() => { pokewatch.audio.resetMusicRun(); pokewatch.audio.setBiome({ id: 'meadow' }); });
  assert.equal(await page.evaluate(() => pokewatch.audio.adaptiveStatus.playing), true);
  assert.equal(await page.evaluate(() => pokewatch.audio.adaptive.cueVoices.size), 0);
  await page.evaluate(() => pokewatch.audio.stopMusic());
  assert.equal(await page.evaluate(() => pokewatch.audio.adaptiveStatus.playing), false);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ checks: 'Offline decoding, synchronized loops, continuous melody through surge/boss, mixer, defeat, restart, stop', decodedMB: data.decodedMB, mixer }, null, 2));
} finally { await browser.close(); }
