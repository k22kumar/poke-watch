// Navigation check with real key presses and a virtual gamepad. Prints PASS/FAIL per step.
import { chromium } from 'playwright';
const [,, file] = process.argv;
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
await p.addInitScript(() => {
  // virtual gamepad: tests set window.__pad.buttons[i] = true
  window.__pad = { buttons: Array(17).fill(false), axes: [0, 0, 0, 0] };
  navigator.getGamepads = () => [{ id: 'virtual', connected: true, axes: window.__pad.axes, buttons: window.__pad.buttons.map((x) => ({ pressed: x, value: x ? 1 : 0 })) }];
});
await p.goto('file://' + file);
await p.waitForFunction(() => window.pokewatch?.ready, null, { timeout: 90000 });
await p.waitForTimeout(500);
const results = [];
const check = async (name, fn) => { let ok = false, info = ''; try { const r = await p.evaluate(fn); ok = !!(r === true || r?.ok); info = typeof r === 'object' ? JSON.stringify(r) : String(r); } catch (e) { info = e.message; } results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  → ' + info}`); };
const focusText = () => p.evaluate(() => (document.activeElement?.textContent || document.activeElement?.tagName || '').trim().slice(0, 40));
const vis = (id) => `!document.getElementById('${id}').classList.contains('hidden')`;
const key = async (k, n = 1) => { for (let i = 0; i < n; i++) { await p.keyboard.press(k); await p.waitForTimeout(90); } };
const pad = async (i) => { await p.evaluate((i) => { window.__pad.buttons[i] = true; }, i); await p.waitForTimeout(220); await p.evaluate((i) => { window.__pad.buttons[i] = false; }, i); await p.waitForTimeout(220); };

// title
await check('title: default focus is the selected mode', () => document.activeElement?.getAttribute('aria-checked') === 'true');
await key('ArrowRight');
await check('title: arrow moves to the next mode and selects it', () => document.activeElement?.textContent?.startsWith('Survival') && document.activeElement.getAttribute('aria-checked') === 'true');
await key('ArrowLeft');
const t0 = await focusText(); await key('Tab'); const t1 = await focusText();
results.push(`${t0 !== t1 ? 'PASS' : 'FAIL'}  title: Tab moves focus natively (${t0} → ${t1})`);
await key('ArrowDown', 2);
await check('title: arrows reach the action row', () => /Play|Settings|How to play|Credits/.test(document.activeElement?.textContent ?? ''));
// go to Play and confirm
for (let i = 0; i < 4 && !/^Play/.test(await focusText()); i++) await key('ArrowLeft');
await key('Enter');
await p.waitForTimeout(300);
await check('select: opens with the selected partner focused', () => !document.getElementById('screen-select').classList.contains('hidden') && document.activeElement?.getAttribute('role') === 'radio');
await key('ArrowRight');
await key('Enter');
await check('select: Enter selects the focused partner', () => document.activeElement?.getAttribute('aria-checked') === 'true');
const chosen = await p.evaluate(() => document.activeElement?.querySelector('b')?.textContent);
await key('Escape'); await p.waitForTimeout(200);
await check('select: Esc goes back to the title', () => !document.getElementById('screen-title').classList.contains('hidden'));
await key('Enter'); // Play is focused by default on the title? (focus restores the selected mode) — open select again via the Play button
await p.click('text=Play'); await p.waitForTimeout(300);
await key('ArrowRight'); await key('Enter'); await key('Enter');
await p.waitForTimeout(800);
await check('run: pressing the selected partner again starts the run', () => !!window.pokewatch.ctx && !document.getElementById('hud').classList.contains('hidden'));
// play
const z0 = await p.evaluate(() => window.pokewatch.ctx.player.z);
await p.keyboard.down('KeyW'); await p.waitForTimeout(700); await p.keyboard.up('KeyW');
await check('play: W moves the partner north', `(${'() => window.pokewatch.ctx.player.z < ' + z0 + ' - 0.3'})()`.length ? () => true : () => false);
const z1 = await p.evaluate(() => window.pokewatch.ctx.player.z);
results.push(`${z1 < z0 - 0.2 ? 'PASS' : 'FAIL'}  play: W moves the partner north (z ${z0.toFixed(2)} → ${z1.toFixed(2)})`);
results.splice(results.findIndex((r) => r.includes("W moves the partner north") && !r.includes('z ')), 1);
const fBefore = await focusText(); await key('Tab'); const fAfter = await focusText();
results.push(`${fBefore === fAfter || fAfter === 'BODY' ? 'PASS' : 'FAIL'}  play: Tab does not move focus into hidden menus (${fBefore} → ${fAfter})`);
// level-up cards
await p.evaluate(() => window.pokewatch.addLevel());
await p.waitForTimeout(700);
await check('cards: level-up opens with a card focused', () => ({ ok: !document.getElementById('modal-cards').classList.contains('hidden') && document.activeElement?.classList.contains('card'), modal: !document.getElementById('modal-cards').classList.contains('hidden'), focus: document.activeElement?.className, state: window.pokewatch.ctx.state }));
await key('ArrowRight');
const lvBefore = await p.evaluate(() => window.pokewatch.ctx.player.moves.length + Object.keys(window.pokewatch.ctx.player.vitamins).length + window.pokewatch.ctx.player.moves.reduce((a, m) => a + m.level, 0));
await key('Enter'); await p.waitForTimeout(500);
await check('cards: Enter picks the focused card and play resumes', () => document.getElementById('modal-cards').classList.contains('hidden') && window.pokewatch.ctx.state === 'play');
// pause / settings
await key('Escape'); await p.waitForTimeout(300);
await check('pause: Esc opens pause with Resume focused', () => !document.getElementById('screen-pause').classList.contains('hidden') && /Resume/.test(document.activeElement?.textContent ?? ''));
await key('ArrowDown'); await key('Enter'); await p.waitForTimeout(300);
await check('settings: opens from pause', () => !document.getElementById('screen-settings').classList.contains('hidden'));
// focus the Master slider and adjust it with the arrow keys
await p.evaluate(() => document.querySelector('#screen-settings input[type=range]').focus());
const v0 = await p.evaluate(() => document.querySelector('#screen-settings input[type=range]').value);
await key('ArrowLeft', 2);
const v1 = await p.evaluate(() => document.querySelector('#screen-settings input[type=range]').value);
results.push(`${Number(v1) < Number(v0) ? 'PASS' : 'FAIL'}  settings: arrows adjust a focused slider (${v0} → ${v1}) and the mix follows`);
await check('settings: master volume applied to the mixer', () => Math.abs(window.pokewatch.audio.mix.master - Number(document.querySelector('#screen-settings input[type=range]').value)) < 1e-6);
await key('Escape'); await p.waitForTimeout(200);
await check('settings: Esc returns to pause', () => !document.getElementById('screen-pause').classList.contains('hidden'));
await key('Escape'); await p.waitForTimeout(300);
await check('pause: Esc resumes play', () => document.getElementById('screen-pause').classList.contains('hidden') && window.pokewatch.ctx.state === 'play');
// gamepad (first close a level-up modal the idle partner may have earned meanwhile)
for (let i = 0; i < 3; i++) { if (await p.evaluate(() => !document.getElementById('modal-cards').classList.contains('hidden'))) { await key('1'); await p.waitForTimeout(300); } }
await pad(9); await p.waitForTimeout(500);
await check('gamepad: Start pauses', () => ({ ok: !document.getElementById('screen-pause').classList.contains('hidden'), menu: window.pokewatch.ui.activeMenu(), state: window.pokewatch.ctx?.state }));
await pad(13);
await check('gamepad: D-pad down moves focus', () => ({ ok: /Settings/.test(document.activeElement?.textContent ?? ''), focus: document.activeElement?.textContent, menu: window.pokewatch.ui.activeMenu() }));
await pad(1); await p.waitForTimeout(250);
await check('gamepad: B resumes from pause', () => document.getElementById('screen-pause').classList.contains('hidden'));
// disabled state
await p.evaluate(() => { window.pokewatch.ctx.cards.rerolls = 0; window.pokewatch.addLevel(); });
await p.waitForTimeout(700);
await check('cards: a spent action is disabled and announced', () => { const b = [...document.querySelectorAll('#modal-cards button')].find((x) => /Reroll/.test(x.textContent)); return b && b.disabled && b.getAttribute('aria-disabled') === 'true'; });
await key('f'); await p.waitForTimeout(150);
await check('cards: pressing F with no rerolls changes nothing', () => !document.getElementById('modal-cards').classList.contains('hidden'));
await key('1'); await p.waitForTimeout(400);
// defeat → end screen → restart
const seed0 = await p.evaluate(() => window.pokewatch.ctx.seed);
await p.evaluate(() => window.pokewatch.damage(1e9));
await p.waitForFunction(() => !document.getElementById('screen-end').classList.contains('hidden'), null, { timeout: 20000 }).catch(() => {});
await check('defeat: end screen with Try again focused', () => !document.getElementById('screen-end').classList.contains('hidden') && /Try again/.test(document.activeElement?.textContent ?? ''));
await key('Enter'); await p.waitForTimeout(800);
const seed1 = await p.evaluate(() => window.pokewatch.ctx?.seed);
results.push(`${seed1 !== undefined && seed1 !== seed0 ? 'PASS' : 'FAIL'}  defeat: Enter restarts with a new seed (${seed0} → ${seed1})`);
// quit to title via pause
await key('Escape'); await p.waitForTimeout(300);
for (let i = 0; i < 6 && !/Quit/.test(await focusText()); i++) await key('ArrowDown');
await key('Enter'); await p.waitForTimeout(400);
await check('pause: Quit to title returns to the title screen', () => !document.getElementById('screen-title').classList.contains('hidden') && window.pokewatch.ctx === null);
await check('music: title music after quitting', () => window.pokewatch.audio.state === 'title');
console.log(results.join('\n'));
console.log(`\n${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed; page errors: ${errs.length ? errs.join(' | ') : 'none'}; chosen partner: ${chosen}`);
await b.close();
