// Footage: page screenshots (HUD + overlays included) after each fixed sim step; ffmpeg assembles.
// usage: node film.mjs <html> <outdir>
import { chromium } from 'playwright';
import fs from 'node:fs';
const [,, file, out] = process.argv;
const FPS = 24, dt = 1 / FPS;
const reels = [
  { name: 'combat', query: 'go=1&species=charmander&seed=5&autopick=1', pre: [{ advance: 38, bot: true, frames: 20 }], secs: 6, bot: true },
  { name: 'cast', query: 'go=1&species=squirtle&seed=3&calm=1&tp=50,62&autopick=1', pre: [{ advance: 0.3 }, { eval: "pokewatch.spawn('geodude',5,-3);pokewatch.spawn('rattata',6,1)" }, { advance: 0.3, frames: 2 }], secs: 3, input: { mx: 1, mz: 0, jump: false, dash: false } },
  { name: 'boss', query: 'go=1&species=cyndaquil&seed=5&autopick=1&stageTime=299.5&level=12', pre: [{ advance: 3, bot: true, frames: 6 }, { eval: "(()=>{const c=pokewatch.ctx,i=c.director.bossIndex,E=c.enemies;if(i>=0){E.x[i]=E.px[i]=c.player.x+4;E.z[i]=E.pz[i]=c.player.z-2;}return i})()" }], secs: 5, bot: true },
  { name: 'evolve', query: 'go=1&species=charmander&seed=4&calm=1&autopick=1&level=15', pre: [{ advance: 1 }, { eval: 'pokewatch.addLevel()' }], secs: 6 },
];
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
for (const r of reels) {
  const dir = `${out}/${r.name}`; fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const p = await b.newPage({ viewport: { width: 960, height: 540 } });
  p.on('pageerror', (e) => console.log(r.name, 'PAGEERROR', e.message));
  await p.goto('file://' + file + '?capture=1&' + r.query);
  await p.waitForFunction(() => window.pokewatch?.ready, null, { timeout: 90000 });
  for (const st of r.pre) {
    if (st.advance !== undefined) await p.evaluate((st) => window.pokewatch.advance(st.advance, st), st);
    if (st.eval) console.log(r.name, 'eval', await p.evaluate(st.eval));
  }
  const n = Math.round(r.secs * FPS);
  for (let k = 0; k < n; k++) {
    await p.evaluate(([dt, r]) => window.pokewatch.advance(dt, { bot: r.bot, input: r.input, frames: 1 }), [dt, r]);
    await p.screenshot({ path: `${dir}/${String(k).padStart(4, '0')}.png` });
  }
  console.log(r.name, n, 'frames', await p.evaluate(() => ({ state: pokewatch.ctx?.state, sp: pokewatch.ctx?.player.species, lv: pokewatch.ctx?.player.level })));
  await p.close();
}
await b.close();
