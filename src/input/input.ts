// Action-mapped input: keyboard + gamepad + touch. Produces one sim InputFrame per tick in world space, relative to the
// camera yaw. Which key or pad button drives which action is the bindings table (input/bindings.ts, docs/CONTROLS.md):
// defaults plus the player's saved overrides (setBindings).
import { BTN, type InputFrame } from '../sim/types';
import { DEFAULT_KEYS, DEFAULT_PAD, resolveBindings, type KeyBindings, type PadBindings } from './bindings';

/** the keyboard defaults (input/bindings.ts DEFAULT_KEYS) */
export const DEFAULT_BINDINGS = DEFAULT_KEYS;

/** the InputFrame.btn bit each combat action sets */
const ACTION_BTN: Record<string, number> = { basic: BTN.basic, moveA: BTN.a, moveB: BTN.b, sig: BTN.sig, guard: BTN.guard };
/** mouse buttons as InputFrame.btn bits: left is primary fire (the basic attack), right is Move A */
const mouseBits = (button: number) => (button === 0 ? BTN.basic : button === 2 ? BTN.a : 0);

export class Input {
  keys = new Set<string>();
  pressed = new Set<string>();
  mouseDx = 0; mouseDy = 0;
  dragging = false;
  /** cursor position in CSS pixels relative to the canvas, once the mouse has moved over it */
  mouseX = 0; mouseY = 0; mouseSeen = false;
  /** mouse buttons held during play, as BTN bits (left = basic attack, right = Move A) */
  mouseBtn = 0;
  /** combat buttons pressed since the last sample: a click or tap that goes down and up between two sim ticks
   *  still reaches the sim as one tick of the button held (so it casts once when ready) */
  private btnLatch = 0;
  /** combat buttons that went down since the last sample (rising edges, BTN bits): InputFrame.press. Unlike btnLatch it
   *  also catches a release and re-press inside one sample, which `btn` shows as still held */
  private pressLatch = 0;
  /** the pad's combat buttons at the last sample (its edges: a pad is polled, so a press shorter than a frame is missed) */
  private padPrev = 0;
  /** pointer lock is unavailable here (never supported, or refused again and again: a sandboxed frame); clicks then
   *  attack without waiting for it. One refusal is not enough: Chrome refuses a re-lock for about a second after the
   *  player leaves it with Esc, and a request made from an Esc keydown has no user activation, so a single refusal is
   *  usually transient and the next click should capture, not attack */
  private lockFailed = false;
  /** consecutive refused lock requests, and whether this page has held the lock at all */
  private refusals = 0;
  private everLocked = false;
  /** which device aimed last: the cursor, the right stick, or nothing yet */
  aimSource: 'none' | 'mouse' | 'stick' = 'none';
  /** right-stick aim direction in world space (unit), valid while aimSource is 'stick' */
  stickAim: [number, number] = [0, 1];
  locked = false;
  /** third-person camera: the mouse is captured while playing and the right stick turns the camera instead of aiming */
  chase = false;
  /** called when the browser takes the pointer lock away during play (Esc): the host pauses */
  onLockLost?: () => void;
  /** called when the pointer lock is granted, and when a request for it is refused (the host's resume waits on these) */
  onLockGained?: () => void;
  onLockError?: () => void;
  private expectUnlock = false;
  /** the keyboard and gamepad tables in use (defaults + the player's overrides: setBindings) */
  bindings: KeyBindings = DEFAULT_KEYS;
  padBindings: PadBindings = DEFAULT_PAD;
  private dashLatch = false;
  /** R6c: Jump went down since the last sample (a key, the touch button, or the pad's jump button between two polls):
   *  InputFrame.jumpPressed. A tap that goes down and up between two sim ticks is still one press */
  private jumpLatch = false;
  /** the pad's jump binding at the last sample (its edge; a pad is polled, so a press shorter than a frame is missed) */
  private padJumpPrev = false;
  private touchButtons: Record<string, boolean> = {};
  private touchMove: [number, number] = [0, 0];
  private touchLook: [number, number] = [0, 0];
  onAction?: (a: string) => void;
  /** 'menu' while a menu owns the keyboard (the UI handles it), 'play' during gameplay */
  context: 'menu' | 'play' = 'menu';

  constructor(private el: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      const focusedTrayControl = (e.target as HTMLElement)?.closest('#tray-cards');
      if (focusedTrayControl && ['Enter', 'Space', 'Tab'].includes(e.code)) return;
      if (this.context === 'menu') {
        // menus: never block Tab/arrows/Space; only global toggles pass through
        for (const a of ['mute', 'tuning']) if (this.is(a, e.code)) this.onAction?.(a);
        return;
      }
      const firstPress = !this.keys.has(e.code);
      if (firstPress) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (this.is('dash', e.code)) this.dashLatch = true;
      if (firstPress && this.is('jump', e.code)) this.jumpLatch = true;
      if (firstPress) for (const [a, bit] of Object.entries(ACTION_BTN)) if (this.is(a, e.code)) { this.btnLatch |= bit; this.pressLatch |= bit; }
      if (firstPress) for (const [a, codes] of Object.entries(this.bindings)) if (codes.includes(e.code)) this.onAction?.(a);
      // during play, keep movement keys from scrolling or moving focus to hidden menu buttons
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    // the camera is fixed (DS-style), so the mouse no longer grabs the pointer
    el.addEventListener('mousedown', (e) => {
      if (e.button === 2) this.dragging = true;
      if (this.context !== 'play') return;
      this.aimSource = 'mouse'; this.mouseSeen = true;
      // third person: the click that captures the mouse only captures it (no stray attack before you can aim)
      if (this.chase && !this.locked && !this.lockFailed) { this.capture(); return; }
      const bit = mouseBits(e.button);
      this.mouseBtn |= bit; this.btnLatch |= bit; this.pressLatch |= bit;
      this.capture();
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 2) this.dragging = false;
      this.mouseBtn &= ~mouseBits(e.button);
    });
    window.addEventListener('blur', () => this.clearButtons());
    document.addEventListener('pointerlockerror', () => {
      this.refusals++;
      // a page that has never held the lock is likely not allowed it at all (a frame without pointer-lock permission)
      if (this.refusals >= (this.everLocked ? 3 : 2)) this.lockFailed = true;
      this.onLockError?.();
    });
    el.addEventListener('mousemove', (e) => {
      const r = el.getBoundingClientRect();
      this.mouseX = e.clientX - r.left; this.mouseY = e.clientY - r.top;
      this.mouseSeen = true; this.aimSource = 'mouse';
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === el;
      if (this.locked) { this.lockFailed = false; this.refusals = 0; this.everLocked = true; if (!was) this.onLockGained?.(); }
      if (was && !this.locked) {
        this.clearButtons(); // nothing keeps firing once the mouse is let go (menus, pause, Esc)
        // a release the host asked for (menus, pause) is not a pause request; the browser's own Esc release is
        if (!this.expectUnlock && this.chase && this.context === 'play') this.onLockLost?.();
        this.expectUnlock = false;
        this.mouseDx = this.mouseDy = 0;
      }
    });
    window.addEventListener('mousemove', (e) => {
      if (this.locked || this.dragging) { this.mouseDx += e.movementX; this.mouseDy += e.movementY; }
    });
    const bindTouchAction = (down: boolean, action: string) => {
      if (!action) return;
      this.touchButtons[action] = down;
      if (down && action === 'dash') this.dashLatch = true;
      if (down && action === 'jump') this.jumpLatch = true;
      if (down) { this.btnLatch |= ACTION_BTN[action] ?? 0; this.pressLatch |= ACTION_BTN[action] ?? 0; }
    };
    document.addEventListener('pointerdown', (e) => {
      const btn = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-touch-action]');
      if (!btn) return;
      e.preventDefault();
      bindTouchAction(true, btn.dataset.touchAction ?? '');
    }, { passive: false });
    document.addEventListener('pointerup', (e) => {
      const btn = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-touch-action]');
      if (!btn) return;
      e.preventDefault();
      bindTouchAction(false, btn.dataset.touchAction ?? '');
    }, { passive: false });
    document.addEventListener('pointercancel', (e) => {
      const btn = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-touch-action]');
      if (!btn) return;
      bindTouchAction(false, btn.dataset.touchAction ?? '');
    });
    const setTouchInput = (x: number, y: number) => {
      const r = this.el.getBoundingClientRect();
      const leftZone = r.width * 0.42;
      if (x < leftZone) {
        const dx = this.clamp((x - r.width * 0.18) / Math.max(1, r.width * 0.18), -1, 1);
        const dy = this.clamp((r.height * 0.5 - y) / Math.max(1, r.height * 0.45), -1, 1);
        this.touchMove = [dx, dy];
      } else {
        const nx = this.clamp((x - r.width * 0.7) / Math.max(1, r.width * 0.3), -1, 1);
        const ny = this.clamp((r.height * 0.5 - y) / Math.max(1, r.height * 0.45), -1, 1);
        this.touchLook = [nx, ny];
        this.stickAim = [nx, ny];
        this.aimSource = 'stick';
      }
    };
    this.el.addEventListener('touchstart', (e) => {
      if (this.context !== 'play') return;
      for (const t of e.changedTouches) {
        const r = this.el.getBoundingClientRect();
        setTouchInput(t.clientX - r.left, t.clientY - r.top);
      }
      e.preventDefault();
    }, { passive: false });
    this.el.addEventListener('touchmove', (e) => {
      if (this.context !== 'play') return;
      for (const t of e.touches) {
        const r = this.el.getBoundingClientRect();
        setTouchInput(t.clientX - r.left, t.clientY - r.top);
      }
      e.preventDefault();
    }, { passive: false });
    const clearTouchInput = () => {
      this.touchMove = [0, 0];
      this.touchLook = [0, 0];
      if (this.aimSource === 'stick' && !this.touchButtons.basic && !this.touchButtons.moveA && !this.touchButtons.moveB && !this.touchButtons.sig && !this.touchButtons.guard) this.aimSource = 'none';
    };
    this.el.addEventListener('touchend', () => clearTouchInput(), { passive: false });
    this.el.addEventListener('touchcancel', () => clearTouchInput(), { passive: false });
  }

  private clamp(v: number, min: number, max: number) { return Math.min(max, Math.max(min, v)); }
  private is(action: string, code: string) { return this.bindings[action]?.includes(code); }
  /** a bound key, or the on-screen touch button of the same name, is held */
  down(action: string) {
    return (this.bindings[action]?.some((c) => this.keys.has(c)) ?? false) || !!this.touchButtons[action];
  }

  /** the bindings in use: the defaults with these overrides on top (the saved settings; input/bindings.ts) */
  setBindings(keys: KeyBindings = {}, pad: PadBindings = {}) {
    this.bindings = resolveBindings(DEFAULT_KEYS, keys);
    this.padBindings = resolveBindings(DEFAULT_PAD, pad);
  }

  /** let go of every combat button (focus lost, pointer released, a menu or pause took over) */
  clearButtons() {
    this.mouseBtn = 0; this.btnLatch = 0; this.pressLatch = 0; this.jumpLatch = false;
    for (const k of Object.keys(this.touchButtons)) this.touchButtons[k] = false;
  }

  releaseLock() { if (document.pointerLockElement) { this.expectUnlock = true; document.exitPointerLock(); } }

  /** the pointer lock cannot be had here: the host stops waiting for it (mouse look falls back to right-drag) */
  get lockUnavailable() { return this.lockFailed || typeof (this.el as { requestPointerLock?: unknown }).requestPointerLock !== 'function'; }

  /** third person: take the mouse so it can turn the camera (needs a user gesture; browsers may refuse right after Esc).
   *  `force`: ask even though a menu still owns the input (the Start and Resume buttons, inside their own click) */
  capture(force = false) {
    if (!this.chase || this.locked || (!force && this.context !== 'play')) return;
    try { const r = this.el.requestPointerLock() as unknown; if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(() => { /* refused: the next click retries */ }); } catch { /* unsupported */ }
  }

  /** right stick as a look axis, for the third-person camera */
  lookStick(): [number, number] {
    if (this.touchLook[0] || this.touchLook[1]) return this.touchLook;
    const p = this.pad();
    return p ? [p.rx, p.ry] : [0, 0];
  }

  /** gamepad axes and buttons (first pad): sticks with a dead zone, and `held(action)` through the pad bindings (a
   *  trigger counts past 0.4 of its travel). Movement is the left stick, look / aim the right stick */
  pad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const p = pads && pads[0];
    if (!p) return null;
    const dz = (v: number) => (Math.abs(v) < 0.18 ? 0 : v);
    const pr = (i: number) => !!p.buttons[i]?.pressed || (p.buttons[i]?.value ?? 0) > 0.4;
    const pb = this.padBindings;
    return {
      lx: dz(p.axes[0] ?? 0), ly: dz(p.axes[1] ?? 0), rx: dz(p.axes[2] ?? 0), ry: dz(p.axes[3] ?? 0),
      held: (action: string) => pb[action]?.some(pr) ?? false,
    };
  }

  /** a pad button bound to `action` is held (false with no pad): the host's pause and card-tray picks */
  padHeld(action: string) { return this.pad()?.held(action) ?? false; }

  /** Poll the pad's Jump and combat buttons and latch their rising edges, as key and touch events latch theirs: the host
   *  calls it every frame of play (main.ts), and every sample calls it too. A pad is polled, not evented, so before this a
   *  press shorter than a sim tick was lost at frame rates above 60 Hz (most frames take no sample); now any press one
   *  frame sees reaches the next sample (jumpPressed, and `btn` + `press` for one tick, like a click). A press shorter
   *  than a frame still falls between two polls (docs/CONTROLS.md, scripts/jumptiming.ts) */
  pollPad() {
    const pad = this.pad();
    if (!pad) { this.padPrev = 0; this.padJumpPrev = false; return null; }
    const pj = pad.held('jump');
    if (pj && !this.padJumpPrev) this.jumpLatch = true;
    this.padJumpPrev = pj;
    let pb = 0;
    for (const [a, bit] of Object.entries(ACTION_BTN)) if (pad.held(a)) pb |= bit;
    const rise = pb & ~this.padPrev;
    this.btnLatch |= rise; this.pressLatch |= rise;
    this.padPrev = pb;
    return { pad, pb, pj };
  }

  /** build a sim input frame for camera yaw (aim is filled in by the host, which knows the camera) */
  sample(yaw: number): InputFrame {
    let f = (this.down('up') ? 1 : 0) - (this.down('down') ? 1 : 0) + this.touchMove[1];
    let s = (this.down('right') ? 1 : 0) - (this.down('left') ? 1 : 0) + this.touchMove[0];
    const polled = this.pollPad();
    const pad = polled?.pad;
    let jump = this.down('jump');
    let descend = this.down('descend');
    let jumpPressed = this.jumpLatch;
    this.jumpLatch = false;
    let dash = this.dashLatch;
    let btn = this.mouseBtn | this.btnLatch;
    let press = this.pressLatch;
    for (const [a, bit] of Object.entries(ACTION_BTN)) if (this.down(a)) btn |= bit;
    this.btnLatch = 0; this.pressLatch = 0;
    const Fx = Math.sin(yaw), Fz = Math.cos(yaw);
    const Rx = -Math.cos(yaw), Rz = Math.sin(yaw);
    if (polled && pad) {
      f += -pad.ly; s += pad.lx;
      jump = jump || polled.pj;
      descend = descend || pad.held('descend');
      dash = dash || pad.held('dash');
      btn |= polled.pb;
      if (!this.chase && Math.hypot(pad.rx, pad.ry) > 0.35) {
        const af = -pad.ry, as = pad.rx;
        const ax = Fx * af + Rx * as, az = Fz * af + Rz * as, L = Math.hypot(ax, az) || 1;
        this.stickAim = [ax / L, az / L];
        this.aimSource = 'stick';
      } else if (!this.chase && this.aimSource === 'stick') this.aimSource = 'none'; // idle stick: auto-aim
    }
    this.dashLatch = false;
    let mx = Fx * f + Rx * s, mz = Fz * f + Rz * s;
    const L = Math.hypot(mx, mz);
    if (L > 1) { mx /= L; mz /= L; }
    // R6c: the Jump edge is always sent (false included), so the sim uses the edge rules (press, buffer, coyote; no
    // repeat from holding). The vertical intent is ascend − descend from buttons only: ascend is Jump held, both held
    // cancel. The camera's pitch never reaches it (invariant 4: looking up or down does not change altitude)
    const my = (jump ? 1 : 0) - (descend ? 1 : 0);
    return press ? { mx, mz, jump, dash, btn, press, jumpPressed, my } : { mx, mz, jump, dash, btn, jumpPressed, my };
  }

  consumeMouse() {
    const d = [this.mouseDx, this.mouseDy];
    this.mouseDx = 0; this.mouseDy = 0;
    return d;
  }
}
