// Audio verification: records the final mix (MediaStream tap → MediaRecorder) while auditioning
// cries and each music state, and logs bus meters + cry bank status. There are no synthesised
// sound effects (docs/hero-shooter-pivot.md Q51): every music state is the adaptive score.
// usage: node audiocheck.mjs <html> <outdir> <phase: cries|cryfix|music|play>
import { chromium } from 'playwright';
import fs from 'node:fs';
const [,, file, out, phase] = process.argv;
fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--allow-file-access-from-files', '--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage({ viewport: { width: 960, height: 540 } });
const logs = [];
p.on('console', (m) => { if (!/GPU stall|GL Driver|TUNNEL|Failed to load/.test(m.text())) logs.push(m.type() + ': ' + m.text()); });
p.on('pageerror', (e) => logs.push('PAGEERROR ' + e.message));
const q = phase === 'play' ? 'go=1&species=charmander&seed=5&autopick=1&autoplay=1&stageTime=272&level=10' : '';
await p.goto('file://' + file + '?' + q);
await p.waitForFunction(() => window.pokewatch?.ready, null, { timeout: 90000 });
if (phase !== 'cryfix') { await p.mouse.click(480, 270); await p.waitForTimeout(600); } // a real gesture unlocks the AudioContext
const result = await p.evaluate(async (phase) => {
  const A = window.pokewatch.audio, C = window.pokewatch.cries;
  if (phase === 'cryfix') {
    // register a corrupt sample before unlocking, then request cries in the same tick as unlock
    C.sample('broken_test', 'data:audio/ogg;base64,T2dnUwAAAAAAAAAA', 1);
  }
  A.unlock();
  const stream = A.captureStream();
  const rec = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
  const chunks = [];
  rec.ondataavailable = (e) => chunks.push(e.data);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const marks = [], meters = [];
  const t0 = performance.now();
  const mark = (label) => marks.push({ t: Math.round(performance.now() - t0) / 1000, label });
  const sample = () => meters.push({ t: Math.round(performance.now() - t0) / 1000, ...A.meters() });
  const iv = setInterval(sample, 100);
  rec.start(250);
  if (phase === 'cryfix') {
    mark('requests before decode: charmander, totodile, articuno, broken_test');
    const before = Object.fromEntries(['charmander', 'totodile', 'articuno', 'broken_test'].map((id) => [id, C.status(id)]));
    for (const id of ['charmander', 'totodile', 'articuno']) A.cry(id, { volume: 0.8, gate: 0 });
    A.cry('broken_test', { volume: 0.8, gate: 0 });
    await new Promise((r) => setTimeout(r, 2500));
    mark('broken_test again (silent: no fallback voice)'); A.cry('broken_test', { volume: 0.8, gate: 0 });
    await new Promise((r) => setTimeout(r, 1500));
    marks.push({ t: 0, label: 'status before: ' + JSON.stringify(before) + ' after: ' + JSON.stringify(Object.fromEntries(['charmander', 'totodile', 'articuno', 'broken_test'].map((id) => [id, C.status(id)]))) });
  }
  if (phase === 'cries') {
    const ids = C.ids();
    // first play of each cry happens while samples may still be decoding: the queue must play it
    mark('first plays (queued if still decoding)');
    for (const id of ids) { mark('cry ' + id + ' [' + C.status(id) + ']'); A.cry(id, { volume: 0.8, gate: 0 }); await wait(1150); }
  } else if (phase === 'music') {
    const seq = [['titleMusic', 'title'], ['setBiome', 'explore meadow', { id: 'meadow' }], ['go', 'battle'], ['onBossSpawn', 'boss (climax)'], ['onBossDead', 'victory cue → explore'], ['onEvolveStart', 'evolution'], ['onEvolveEnd', 'accent cue → back'], ['setPaused', 'pause', true], ['setPaused', 'unpause', false], ['chest', 'accent cue'], ['onDefeat', 'defeat cue']];
    for (const [fn, label, arg] of seq) {
      mark('music ' + label);
      if (fn === 'go') A.go('battle', 'audition'); else A[fn](arg);
      await wait(fn === 'setPaused' || fn === 'chest' ? 2500 : 9000);
    }
  } else if (phase === 'play') {
    mark('gameplay (bot) 45 s from 4:32');
    await wait(45000);
  }
  clearInterval(iv);
  rec.stop();
  await wait(400);
  const blob = new Blob(chunks, { type: 'audio/webm' });
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  const status = Object.fromEntries(C.ids().map((id) => [id, C.status(id) + '/' + C.format(id)]));
  return { b64: btoa(bin), marks, meters, status, stats: { ...C.stats }, adaptive: A.adaptiveStatus, music: A.log.slice(-30), ctxState: A.ctx?.state };
}, phase);
fs.writeFileSync(`${out}/${phase}.webm`, Buffer.from(result.b64, 'base64'));
delete result.b64;
fs.writeFileSync(`${out}/${phase}.json`, JSON.stringify({ ...result, logs }, null, 1));
console.log(JSON.stringify({ phase, ctx: result.ctxState, stats: result.stats, adaptive: result.adaptive, statusSample: Object.entries(result.status).slice(0, 5), musicLog: result.music.slice(-6), errors: logs.filter((l) => /error|warn/i.test(l)).slice(0, 5) }, null, 1));
await b.close();
