// Exercises the licensed-recording slot path with a generated test tone (not shipped):
// a 2 s buffer whose second half is louder; loop 1.0–2.0 s must repeat only the loud part.
import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 960, height: 540 } });
await p.goto('file://' + process.argv[2] + '?capture=1');
await p.waitForFunction(() => window.pokewatch?.ready, null, { timeout: 90000 });
await p.mouse.click(480, 270); await p.waitForTimeout(500);
const r = await p.evaluate(async () => {
  const A = pokewatch.audio; A.unlock(); await new Promise((r) => setTimeout(r, 300));
  const c = A.ctx, sr = c.sampleRate, buf = c.createBuffer(1, sr * 2, sr), d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.sin(2 * Math.PI * 440 * i / sr) * (i < sr ? 0.02 : 0.3);
  A.slotBuffers.set('route_meadow', buf); A.slots.route_meadow = { src: 'test', loopStart: 1, loopEnd: 2 };
  A.setBiome({ id: 'meadow' });
  const m = []; const t0 = performance.now();
  await new Promise((res) => { const iv = setInterval(() => { m.push([Math.round(performance.now() - t0), A.meters().music]); if (performance.now() - t0 > 6000) { clearInterval(iv); res(); } }, 100); });
  return { track: A.trackKey, m };
});
const late = r.m.filter(([t]) => t > 2600).map(([, v]) => v);
console.log(JSON.stringify({ track: r.track, early: r.m.slice(2, 8).map((x) => x[1]), lateMin: Math.min(...late), lateMax: Math.max(...late) }));
await b.close();
