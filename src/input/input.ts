// Action-mapped input: keyboard + gamepad. Produces one sim InputFrame
// per tick in world space, relative to the camera yaw.
import { BTN, type InputFrame } from '../sim/types';

export const DEFAULT_BINDINGS: Record<string, string[]> = {
  up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  jump: ['Space'], dash: ['ShiftLeft', 'ShiftRight'],
  // aimed combat: Move A / Move B are the mouse buttons (J / K on the keyboard), Q the Signature, E Guard
  moveA: ['KeyJ'], moveB: ['KeyK'], sig: ['KeyQ'], guard: ['KeyE', 'KeyL'],
  pause: ['Escape', 'KeyP'], reroll: ['KeyF'], skip: ['KeyX'], banish: ['KeyZ'],
  pick1: ['Digit1'], pick2: ['Digit2'], pick3: ['Digit3'], pick4: ['Digit4'], cardPointer: ['KeyC'], tuning: ['Backquote'], mute: ['KeyM'],
};

export class Input {
  keys = new Set<string>();
  pressed = new Set<string>();
  mouseDx = 0; mouseDy = 0;
  dragging = false;
  /** cursor position in CSS pixels relative to the canvas, once the mouse has moved over it */
  mouseX = 0; mouseY = 0; mouseSeen = false;
  /** mouse buttons held during play (bit 0 left, bit 1 right) */
  mouseBtn = 0;
  /** which device aimed last: the cursor, the right stick, or nothing yet */
  aimSource: 'none' | 'mouse' | 'stick' = 'none';
  /** right-stick aim direction in world space (unit), valid while aimSource is 'stick' */
  stickAim: [number, number] = [0, 1];
  locked = false;
  /** third-person camera: the mouse is captured while playing and the right stick turns the camera instead of aiming */
  chase = false;
  /** called when the browser takes the pointer lock away during play (Esc): the host pauses */
  onLockLost?: () => void;
  private expectUnlock = false;
  bindings = DEFAULT_BINDINGS;
  private dashLatch = false;
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
      if (firstPress) for (const [a, codes] of Object.entries(this.bindings)) if (codes.includes(e.code)) this.onAction?.(a);
      // during play, keep movement keys from scrolling or moving focus to hidden menu buttons
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    // the camera is fixed (DS-style), so the mouse no longer grabs the pointer
    el.addEventListener('mousedown', (e) => {
      if (e.button === 2) this.dragging = true;
      if (this.context === 'play') { this.mouseBtn |= e.button === 0 ? 1 : e.button === 2 ? 2 : 0; this.aimSource = 'mouse'; this.mouseSeen = true; this.capture(); }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 2) this.dragging = false;
      this.mouseBtn &= ~(e.button === 0 ? 1 : e.button === 2 ? 2 : 0);
    });
    window.addEventListener('blur', () => { this.mouseBtn = 0; });
    el.addEventListener('mousemove', (e) => {
      const r = el.getBoundingClientRect();
      this.mouseX = e.clientX - r.left; this.mouseY = e.clientY - r.top;
      this.mouseSeen = true; this.aimSource = 'mouse';
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === el;
      if (was && !this.locked) {
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
      if (this.aimSource === 'stick' && !this.touchButtons.moveA && !this.touchButtons.moveB && !this.touchButtons.sig && !this.touchButtons.guard) this.aimSource = 'none';
    };
    this.el.addEventListener('touchend', () => clearTouchInput(), { passive: false });
    this.el.addEventListener('touchcancel', () => clearTouchInput(), { passive: false });
  }

  private clamp(v: number, min: number, max: number) { return Math.min(max, Math.max(min, v)); }
  private is(action: string, code: string) { return this.bindings[action]?.includes(code); }
  down(action: string) {
    if (action === 'jump') return (this.bindings.jump?.some((c) => this.keys.has(c)) ?? false) || !!this.touchButtons.jump;
    if (action === 'dash') return (this.bindings.dash?.some((c) => this.keys.has(c)) ?? false) || !!this.touchButtons.dash;
    if (action === 'moveA') return (this.bindings.moveA?.some((c) => this.keys.has(c)) ?? false) || !!this.touchButtons.moveA;
    if (action === 'moveB') return (this.bindings.moveB?.some((c) => this.keys.has(c)) ?? false) || !!this.touchButtons.moveB;
    if (action === 'sig') return (this.bindings.sig?.some((c) => this.keys.has(c)) ?? false) || !!this.touchButtons.sig;
    if (action === 'guard') return (this.bindings.guard?.some((c) => this.keys.has(c)) ?? false) || !!this.touchButtons.guard;
    return this.bindings[action]?.some((c) => this.keys.has(c)) ?? false;
  }

  releaseLock() { if (document.pointerLockElement) { this.expectUnlock = true; document.exitPointerLock(); } }

  /** third person: take the mouse so it can turn the camera (needs a user gesture; browsers may refuse right after Esc) */
  capture() {
    if (!this.chase || this.locked || this.context !== 'play') return;
    try { const r = this.el.requestPointerLock() as unknown; if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(() => { /* refused: the next click retries */ }); } catch { /* unsupported */ }
  }

  /** right stick as a look axis, for the third-person camera */
  lookStick(): [number, number] {
    if (this.touchLook[0] || this.touchLook[1]) return this.touchLook;
    const p = this.pad();
    return p ? [p.rx, p.ry] : [0, 0];
  }

  /** gamepad axes / buttons (first pad) */
  pad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const p = pads && pads[0];
    if (!p) return null;
    const dz = (v: number) => (Math.abs(v) < 0.18 ? 0 : v);
    const pr = (i: number) => !!p.buttons[i]?.pressed || (p.buttons[i]?.value ?? 0) > 0.4;
    return {
      lx: dz(p.axes[0] ?? 0), ly: dz(p.axes[1] ?? 0), rx: dz(p.axes[2] ?? 0), ry: dz(p.axes[3] ?? 0),
      a: pr(0), b: pr(1), start: pr(9),
      // RT Move A, LT Move B, Y Signature, RB or LB Guard
      rt: pr(7), lt: pr(6), y: pr(3), guard: pr(5) || pr(4),
    };
  }

  /** build a sim input frame for camera yaw (aim is filled in by the host, which knows the camera) */
  sample(yaw: number): InputFrame {
    let f = (this.down('up') ? 1 : 0) - (this.down('down') ? 1 : 0) + this.touchMove[1];
    let s = (this.down('right') ? 1 : 0) - (this.down('left') ? 1 : 0) + this.touchMove[0];
    const pad = this.pad();
    let jump = this.down('jump');
    let dash = this.dashLatch;
    let btn = (this.mouseBtn & 1 || this.down('moveA') ? BTN.a : 0) | (this.mouseBtn & 2 || this.down('moveB') ? BTN.b : 0)
      | (this.down('sig') ? BTN.sig : 0) | (this.down('guard') ? BTN.guard : 0);
    const Fx = Math.sin(yaw), Fz = Math.cos(yaw);
    const Rx = -Math.cos(yaw), Rz = Math.sin(yaw);
    if (pad) {
      f += -pad.ly; s += pad.lx;
      jump = jump || pad.a;
      dash = dash || pad.b;
      btn |= (pad.rt ? BTN.a : 0) | (pad.lt ? BTN.b : 0) | (pad.y ? BTN.sig : 0) | (pad.guard ? BTN.guard : 0);
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
    return { mx, mz, jump, dash, btn };
  }

  consumeMouse() {
    const d = [this.mouseDx, this.mouseDy];
    this.mouseDx = 0; this.mouseDy = 0;
    return d;
  }
}
