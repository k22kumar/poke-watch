// Overworld entry: low-res canvas + UI canvas, keyboard/gamepad input, fixed update loop.
import { Audio } from '../audio/audio';
import { Overworld, type Keys } from './game';
import { OverworldRenderer } from './render';

const gameCanvas = document.getElementById('ow') as HTMLCanvasElement;
const uiCanvas = document.getElementById('owui') as HTMLCanvasElement;
const params = new URLSearchParams(location.search);
const audio = new Audio();
audio.musicVolume = 0.35;

const held = new Set<string>();
const pressed = new Set<string>();
window.addEventListener('keydown', (e) => {
  audio.unlock();
  if (!held.has(e.code)) pressed.add(e.code);
  held.add(e.code);
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
});
window.addEventListener('keyup', (e) => held.delete(e.code));
window.addEventListener('blur', () => held.clear());
window.addEventListener('pointerdown', () => { audio.unlock(); pressed.add('KeyZ'); });

// scripted input for automated tests: ?script=R4,U6,A,...
const script: string[] = (params.get('script') ?? '').split(',').filter(Boolean);
let scriptT = 0, scriptHold: string | null = null, scriptLeft = 0;

function keys(dt: number): Keys {
  const any = (...c: string[]) => c.some((k) => held.has(k));
  const hit = (...c: string[]) => c.some((k) => pressed.has(k));
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  const p = pads && pads[0];
  const ax = p ? p.axes[0] ?? 0 : 0, ay = p ? p.axes[1] ?? 0 : 0;
  const k: Keys = {
    up: any('ArrowUp', 'KeyW') || ay < -0.5 || !!p?.buttons[12]?.pressed,
    down: any('ArrowDown', 'KeyS') || ay > 0.5 || !!p?.buttons[13]?.pressed,
    left: any('ArrowLeft', 'KeyA') || ax < -0.5 || !!p?.buttons[14]?.pressed,
    right: any('ArrowRight', 'KeyD') || ax > 0.5 || !!p?.buttons[15]?.pressed,
    a: any('KeyZ', 'Space', 'Enter'), b: any('KeyX', 'ShiftLeft', 'ShiftRight') || !!p?.buttons[1]?.pressed,
    aPressed: hit('KeyZ', 'Space', 'Enter'), bPressed: hit('KeyX', 'Escape'), swap: hit('KeyC'),
  };
  if (script.length || scriptHold) {
    scriptT -= dt;
    if (scriptT <= 0) {
      if (scriptLeft > 0) scriptLeft--;
      if (scriptLeft <= 0) {
        const cmd = script.shift();
        if (cmd) { scriptHold = cmd[0]; scriptLeft = Math.max(1, Number(cmd.slice(1)) || 1); } else scriptHold = null;
      }
      scriptT = scriptHold === 'A' || scriptHold === 'W' ? 0.5 : 0.26;
      if (scriptHold === 'A') k.aPressed = true;
      if (scriptHold === 'C') k.swap = true;
    }
    if (scriptHold === 'U') k.up = true; if (scriptHold === 'D') k.down = true; if (scriptHold === 'L') k.left = true; if (scriptHold === 'R') k.right = true;
  }
  pressed.clear();
  return k;
}

async function boot() {
  const r = new OverworldRenderer(gameCanvas);
  const fit = () => {
    const { W, H, scale } = r.resize(window.innerWidth, window.innerHeight, Number(params.get('h') ?? 240));
    uiCanvas.width = W; uiCanvas.height = H;
    uiCanvas.style.width = W * scale + 'px'; uiCanvas.style.height = H * scale + 'px';
  };
  fit();
  window.addEventListener('resize', fit);
  const ow = new Overworld(r, uiCanvas, audio);
  if (params.has('x')) { (ow as any).place(ow.player, Number(params.get('x')), Number(params.get('y')), Number(params.get('dir') ?? 1)); (ow as any).place(ow.follower, Number(params.get('x')), Number(params.get('y')) + 1, 1); }
  if (params.has('map')) { ow.warpTo(params.get('map')!, Number(params.get('x') ?? 4), Number(params.get('y') ?? 5), 1); ow.fade = 0.99; }
  if (params.has('partner')) for (let i = 0; i < Number(params.get('partner')); i++) ow.update(0, { up: false, down: false, left: false, right: false, a: false, b: false, aPressed: false, bPressed: false, swap: true });
  ow.snapCamera();
  if (params.has('x') || params.has('map') || params.has('script') || params.has('notitle')) { ow.title = false; ow.showBanner(ow.map.areas?.find((a) => ow.player.ty >= a.y && ow.player.ty < a.y + a.h)?.name ?? ow.map.name); }
  (window as any).ow = ow;
  let last = performance.now();
  const STEP = 1 / 60;
  let acc = 0;
  const frame = (now: number) => {
    requestAnimationFrame(frame);
    const real = Math.min(0.1, (now - last) / 1000);
    last = now;
    acc += real;
    let n = 0;
    while (acc >= STEP && n++ < 6) { ow.update(STEP, keys(STEP)); acc -= STEP; }
    audio.tick();
    ow.render();
  };
  requestAnimationFrame(frame);
  document.title = 'Maplebrook';
}
boot().catch((e) => { console.error(e); document.body.insertAdjacentHTML('beforeend', `<pre style="color:#fff;white-space:pre-wrap">${String(e?.stack ?? e)}</pre>`); });
