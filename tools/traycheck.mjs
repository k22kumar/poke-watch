// Regression check: no menu, tray, banner or effect may outlive the run that opened it.
// usage: node tools/traycheck.mjs <dist/index.html>      (exits 1 on any failure)
// Dies with a banked-pick offer open, then leaves through Try again, Title screen, and Restart-from-pause,
// and pauses with an offer open.
import { chromium } from 'playwright';
const file = process.argv[2];
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) fails++; };

const state = (p) => p.evaluate(() => {
  const vis = (id) => { const e = document.getElementById(id); return !!e && !e.classList.contains('hidden') && getComputedStyle(e).display !== 'none'; };
  const fx = document.getElementById('fx2d');
  const px = fx.width ? fx.getContext('2d').getImageData(0, 0, fx.width, fx.height).data : [];
  let ink = 0; for (let i = 3; i < px.length; i += 4) if (px[i]) ink++;
  return { state: window.pokewatch.ctx?.state ?? null, tray: vis('tray-cards'), end: vis('screen-end'), title: vis('screen-title'), pause: vis('screen-pause'), hud: vis('hud'), banner: document.getElementById('banner').classList.contains('show'), fxInk: ink, trayOpen: window.pokewatch.ui.trayOpen() };
});
const click = (p, sel, re) => p.evaluate(([sel, re]) => { [...document.querySelectorAll(sel)].find((x) => new RegExp(re).test(x.textContent)).click(); }, [sel, re]);

async function fresh() {
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  p.on('pageerror', (e) => { console.log('PAGEERROR ' + e.message); fails++; });
  await p.goto('file://' + file + '?go=1&species=totodile&seed=3&calm=1');
  await p.waitForFunction(() => window.pokewatch?.ready, null, { timeout: 90000 });
  await p.waitForTimeout(1500);
  await p.evaluate(() => window.pokewatch.addLevel());
  await p.waitForTimeout(600);
  return p;
}
async function dieWithOffer(p) {
  const s = await state(p);
  check(s.tray && s.trayOpen, 'offer open in the tray before death');
  await p.evaluate(() => window.pokewatch.damage(1e6));
  await p.waitForFunction(() => window.pokewatch.ctx?.state === 'over', null, { timeout: 60000 });
  await p.waitForTimeout(1200);
}

{ // 1: die with an offer -> end screen has no tray; Try again has no tray
  const p = await fresh(); await dieWithOffer(p);
  let s = await state(p);
  check(s.end && !s.tray, 'end screen up and tray hidden after death');
  await click(p, '#screen-end button', 'Try again'); await p.waitForTimeout(800);
  s = await state(p);
  check(s.state === 'play' && s.hud && !s.tray && !s.end, 'after Try again: new run, no stale tray');
  await p.close();
}
{ // 2: die with an offer -> Title screen has no tray, banner or effects
  const p = await fresh(); await dieWithOffer(p);
  await click(p, '#screen-end button', 'Title screen'); await p.waitForTimeout(400);
  const s = await state(p);
  check(s.title && !s.tray && !s.banner && s.fxInk === 0, 'title screen clean (no tray, banner or effects layer ink)');
  await p.close();
}
{ // 3: pause with an offer open: tray suspended and not pickable, back after Resume
  const p = await fresh();
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  let s = await state(p);
  check(s.pause && !s.tray && !s.trayOpen, 'paused: tray not shown and not open to picks');
  await click(p, '#screen-pause button', 'Resume'); await p.waitForTimeout(300);
  s = await state(p);
  check(!s.pause && s.tray && s.trayOpen, 'resumed: tray is back');
  // restart from the pause menu with the offer open
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  await click(p, '#screen-pause button', 'Restart run'); await p.waitForTimeout(800);
  s = await state(p);
  check(s.state === 'play' && !s.pause && !s.tray, 'restart from pause: no stale tray');
  await p.close();
}
await b.close();
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
