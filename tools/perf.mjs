import { chromium } from 'playwright';
const file = process.argv[2];
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
await p.goto('file://' + file + '?capture=1&go=1&species=cyndaquil&seed=5&autopick=1&stageTime=299.5&level=12');
await p.waitForFunction(() => window.pokewatch?.ready, null, { timeout: 90000 });
await p.evaluate(() => pokewatch.advance(3, { bot: true, frames: 6 }));
const r = await p.evaluate(() => {
  const c = pokewatch.ctx; for (let i = 0; i < 120; i++) pokewatch.spawn(['rattata','geodude','vulpix'][i % 3], (Math.random() - 0.5) * 24, (Math.random() - 0.5) * 18);
  const sims = [], rens = [];
  for (let f = 0; f < 120; f++) {
    const t0 = performance.now(); pokewatch.advance(1 / 60, { bot: true }); const t1 = performance.now();
    sims.push(t1 - t0);
  }
  // render-only timing
  for (let f = 0; f < 60; f++) { const t0 = performance.now(); pokewatch.renderer.render(c, 1, 1 / 60, 0); pokewatch.renderer.gl?.finish?.(); rens.push(performance.now() - t0); }
  // sim-only timing
  const st = []; for (let f = 0; f < 240; f++) { const t0 = performance.now(); pokewatch.step(c, { mx: 0, mz: 0, jump: false, dash: false }); st.push(performance.now() - t0); }
  const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return +s[Math.floor(p * (s.length - 1))].toFixed(2); };
  let alive = 0; for (let i = 0; i < c.enemies.alive.length; i++) alive += c.enemies.alive[i] ? 1 : 0;
  return { alive, proj: c.projectiles?.count ?? null, frameMs: { p50: q(sims, .5), p95: q(sims, .95) }, renderMs: { p50: q(rens, .5), p95: q(rens, .95) }, simStepMs: { p50: q(st, .5), p95: q(st, .95), max: q(st, 1) } };
});
console.log(JSON.stringify(r));
await b.close();
