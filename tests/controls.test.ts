// R6c controls on the input side (input/input.ts, input/bindings.ts, ui/settings.ts; docs/CONTROLS.md): the Jump edge
// (jumpLatch), the vertical intent from buttons only, the `descend` action, and the bindings tables (defaults, conflicts,
// overrides, saving). Stubbed DOM, as tests/primaryfire.test.ts does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIONS, DEFAULT_KEYS, DEFAULT_PAD, PAD, assignBinding, bindingConflicts, keyName, padName, resolveBindings,
  sanitizeKeyOverrides, sanitizePadOverrides,
} from '../src/input/bindings';
import { loadSettings, SETTINGS_DEFAULT } from '../src/ui/settings';
import { BTN } from '../src/sim/types';

class Target {
  l: Record<string, ((e: unknown) => void)[]> = {};
  addEventListener(t: string, f: (e: unknown) => void) { (this.l[t] ??= []).push(f); }
  fire(t: string, e: Record<string, unknown> = {}) { for (const f of this.l[t] ?? []) f({ preventDefault() {}, target: null, ...e }); }
}
type Pad = { buttons: { pressed: boolean; value: number }[]; axes: number[] };
async function stubInput() {
  const win = new Target(), doc = Object.assign(new Target(), { pointerLockElement: null, exitPointerLock() {} });
  const el = Object.assign(new Target(), { requestPointerLock() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) });
  let pad: Pad | null = null;
  Object.assign(globalThis, { window: win, document: doc });
  Object.defineProperty(globalThis, 'navigator', { value: { getGamepads: () => [pad] }, configurable: true, writable: true });
  const { Input } = await import('../src/input/input');
  const input = new Input(el as unknown as HTMLElement);
  input.context = 'play';
  /** the first pad: these buttons held, these axes */
  const setPad = (held: number[] | null, axes = [0, 0, 0, 0]) => {
    pad = held === null ? null : { buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: held.includes(i), value: held.includes(i) ? 1 : 0 })), axes };
  };
  const key = (code: string, down = true) => win.fire(down ? 'keydown' : 'keyup', { code });
  const tap = (code: string) => { key(code); key(code, false); };
  const touch = (action: string, down = true) => doc.fire(down ? 'pointerdown' : 'pointerup', { target: { closest: () => ({ dataset: { touchAction: action } }) } });
  return { input, win, doc, el, setPad, key, tap, touch };
}

// ------------------------------------------------------------------ the Jump edge

test('jump-tap: Space down and up before one sample reaches the sim as a press (jump: false, jumpPressed: true), once', async () => {
  const { input, tap } = await stubInput();
  tap('Space');
  let f = input.sample(0);
  assert.equal(f.jump, false, 'not held');
  assert.equal(f.jumpPressed, true, 'but pressed');
  f = input.sample(0);
  assert.equal(f.jumpPressed, false, 'one sample only; the field is always sent');
  // frames with no tick take no sample: the latch waits
  tap('Space');
  assert.equal(input.sample(0).jumpPressed, true);
});

test('jump hold: one press, held frames carry no edge; key auto-repeat adds none; a re-press inside one sample is one', async () => {
  const { input, key } = await stubInput();
  key('Space');
  let f = input.sample(0);
  assert.equal(f.jump, true); assert.equal(f.jumpPressed, true);
  for (let i = 0; i < 50; i++) { key('Space'); f = input.sample(0); assert.equal(f.jump, true); assert.equal(f.jumpPressed, false, `held sample ${i}`); }
  key('Space', false); key('Space');
  assert.equal(input.sample(0).jumpPressed, true, 'released and pressed again between samples');
});

test('pause and focus loss drop a pending jump press', async () => {
  const { input, tap, win, key } = await stubInput();
  tap('Space');
  input.clearButtons();
  assert.equal(input.sample(0).jumpPressed, false);
  key('Space'); win.fire('blur');
  const f = input.sample(0);
  assert.equal(f.jump, false, 'focus lost: nothing held');
  // (blur clears the held keys; the press itself was real and is delivered once, like a combat press)
  assert.equal(input.sample(0).jumpPressed, false);
});

test('menus own the keyboard: Space in a menu is no jump press', async () => {
  const { input, tap } = await stubInput();
  input.context = 'menu';
  tap('Space');
  input.context = 'play';
  assert.equal(input.sample(0).jumpPressed, false);
});

test('touch Jump and Descend buttons: a tap is a press; Descend held is my −1', async () => {
  const { input, touch } = await stubInput();
  touch('jump'); touch('jump', false);
  let f = input.sample(0);
  assert.equal(f.jumpPressed, true); assert.equal(f.jump, false);
  touch('descend');
  f = input.sample(0);
  assert.equal(f.my, -1); assert.equal(f.jumpPressed, false);
  touch('descend', false);
  assert.equal(input.sample(0).my, 0);
});

test('gamepad A: one press per pull (polled at the sample), held never repeats; no pad clears the edge memory', async () => {
  const { input, setPad } = await stubInput();
  setPad([PAD.a]);
  let f = input.sample(0);
  assert.equal(f.jump, true); assert.equal(f.jumpPressed, true);
  assert.equal(input.sample(0).jumpPressed, false);
  setPad([]); input.sample(0); setPad([PAD.a]);
  assert.equal(input.sample(0).jumpPressed, true);
  setPad(null);
  f = input.sample(0);
  assert.equal(f.jump, false); assert.equal(f.jumpPressed, false);
});

test('gamepad: a press only a frame saw (shorter than a tick, a display above 60 Hz) still reaches the next sample', async () => {
  const { input, setPad } = await stubInput();
  setPad([]); input.sample(0);
  setPad([PAD.a, PAD.rt]); input.pollPad(); // the host polls every frame of play
  setPad([]); input.pollPad();
  let f = input.sample(0);
  assert.equal(f.jumpPressed, true, 'the jump press was latched');
  assert.equal(f.jump, false, 'and is not held');
  assert.equal((f.btn ?? 0) & BTN.basic, BTN.basic, 'RT reaches the sim as one tick held, like a click');
  assert.equal(f.press, BTN.basic);
  f = input.sample(0);
  assert.equal(f.jumpPressed, false); assert.equal(f.press, undefined);
  // polls of a held button add nothing
  setPad([PAD.a]); input.pollPad(); input.pollPad();
  assert.equal(input.sample(0).jumpPressed, true);
  input.pollPad();
  assert.equal(input.sample(0).jumpPressed, false);
});

// ------------------------------------------------------------------ vertical intent and descend

test('my = ascend − descend from buttons: V descends, Space ascends, both cancel; C stays the card pointer', async () => {
  const { input, key } = await stubInput();
  const actions: string[] = [];
  input.onAction = (a) => actions.push(a);
  key('KeyV');
  let f = input.sample(0);
  assert.equal(f.my, -1); assert.equal(f.jump, false); assert.equal(f.jumpPressed, false);
  key('Space');
  f = input.sample(0);
  assert.equal(f.my, 0, 'ascend and descend together cancel'); assert.equal(f.jumpPressed, true);
  key('KeyV', false);
  assert.equal(input.sample(0).my, 1);
  key('Space', false);
  assert.equal(input.sample(0).my, 0);
  key('KeyC');
  assert.ok(actions.includes('cardPointer') && actions.includes('descend'));
  assert.equal(input.sample(0).my, 0, 'C does not descend');
});

test('gamepad descend: left-stick click at full deflection still reads both; X is free until bound; L3 + A cancel', async () => {
  const { input, setPad } = await stubInput();
  setPad([PAD.ls], [1, 0, 0, 0]); // the left stick pushed fully right and clicked
  let f = input.sample(0);
  assert.equal(f.my, -1, 'descend held');
  assert.ok(Math.abs(Math.hypot(f.mx, f.mz) - 1) < 1e-9, 'full planar wish at the same time');
  setPad([PAD.ls], [0.7, -0.7, 0, 0]); // hard diagonal steering with the click
  f = input.sample(0);
  assert.equal(f.my, -1); assert.ok(Math.hypot(f.mx, f.mz) > 0.98);
  setPad([PAD.x]);
  assert.equal(input.sample(0).my, 0, 'X is no default descend (no duplicate binding)');
  input.setBindings({}, { descend: [PAD.x] });
  setPad([PAD.x]);
  assert.equal(input.sample(0).my, -1, 'X as the alternative, once the player binds it');
  setPad([PAD.ls]);
  assert.equal(input.sample(0).my, 0, 'and then it replaces the click');
  input.setBindings();
  setPad([PAD.ls, PAD.a]);
  f = input.sample(0);
  assert.equal(f.my, 0); assert.equal(f.jumpPressed, true);
});

test('look is independent of movement: mouse look and the right stick change neither my, jump nor the planar wish', async () => {
  const { input, win, setPad, key } = await stubInput();
  input.locked = true;
  key('KeyW');
  const ref = input.sample(0.3);
  for (let i = 0; i < 20; i++) win.fire('mousemove', { movementX: 40 * i, movementY: -90 * i });
  setPad([], [0, 0, 0.9, -1]); // right stick: hard up and right
  const f = input.sample(0.3);
  assert.equal(f.my, 0); assert.equal(f.jumpPressed, false); assert.equal(f.jump, false);
  assert.equal(f.mx, ref.mx); assert.equal(f.mz, ref.mz);
  assert.deepEqual(input.lookStick(), [0.9, -1], 'the stick went to the camera');
});

// ------------------------------------------------------------------ bindings tables

/** the keyboard and pad tables before R6c (input.ts and pad() at 9d855f5), which R6c must not change */
const PRE_R6C_KEYS: Record<string, string[]> = {
  up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  jump: ['Space'], dash: ['ShiftLeft', 'ShiftRight'], basic: ['KeyJ'], moveA: ['KeyK'], moveB: ['KeyR'], sig: ['KeyQ'], guard: ['KeyE', 'KeyL'],
  pause: ['Escape', 'KeyP'], reroll: ['KeyF'], skip: ['KeyX'], banish: ['KeyZ'],
  pick1: ['Digit1'], pick2: ['Digit2'], pick3: ['Digit3'], pick4: ['Digit4'], cardPointer: ['KeyC'], tuning: ['Backquote'], mute: ['KeyM'],
};
const PRE_R6C_PAD: Record<string, number[]> = { jump: [0], dash: [1], sig: [3], guard: [4], moveB: [5], moveA: [6], basic: [7], pause: [9], pick1: [14], pick2: [12], pick3: [15], reroll: [13] };

test('defaults: every earlier binding unchanged; descend is V and left-stick click; no Ctrl; no conflicts', () => {
  for (const [a, cs] of Object.entries(PRE_R6C_KEYS)) assert.deepEqual(DEFAULT_KEYS[a], cs, a);
  for (const [a, cs] of Object.entries(PRE_R6C_PAD)) assert.deepEqual(DEFAULT_PAD[a], cs, a);
  assert.deepEqual(DEFAULT_KEYS.descend, ['KeyV']);
  assert.deepEqual(DEFAULT_PAD.descend, [PAD.ls]);
  assert.ok(!Object.values(DEFAULT_PAD).flat().includes(PAD.x), 'X is free: the alternative descend a player may bind');
  assert.deepEqual(DEFAULT_KEYS.cardPointer, ['KeyC']);
  assert.equal(Object.values(DEFAULT_KEYS).flat().filter((c) => c.startsWith('Control')).length, 0, 'Ctrl + W / S / D are browser shortcuts');
  assert.deepEqual(bindingConflicts(DEFAULT_KEYS), []);
  assert.deepEqual(bindingConflicts(DEFAULT_PAD), []);
  // every keyboard action is on the screen; every pad binding names a known action
  for (const a of Object.keys(DEFAULT_KEYS)) assert.ok(ACTIONS.some((x) => x.id === a), a);
  for (const a of Object.keys(DEFAULT_PAD)) assert.ok(ACTIONS.some((x) => x.id === a), a);
});

test('overrides: an overridden action has exactly its codes, and a claimed code leaves every other action', () => {
  const keys = resolveBindings(DEFAULT_KEYS, { jump: ['KeyV'] });
  assert.deepEqual(keys.jump, ['KeyV']);
  assert.deepEqual(keys.descend, [], 'V left descend');
  assert.deepEqual(bindingConflicts(keys), []);
  const pad = resolveBindings(DEFAULT_PAD, { descend: [PAD.y] });
  assert.deepEqual(pad.descend, [PAD.y]);
  assert.deepEqual(pad.sig, [], 'Y left the Signature');
});

test('assignBinding moves a code (never two actions on one code), clears slots, and leaves its input alone', () => {
  const o0 = {};
  const r = assignBinding(DEFAULT_KEYS, o0, 'descend', 0, 'KeyC');
  assert.deepEqual(o0, {}, 'input unchanged');
  assert.equal(r.from, 'cardPointer');
  const k = resolveBindings(DEFAULT_KEYS, r.overrides);
  assert.deepEqual(k.descend, ['KeyC']); assert.deepEqual(k.cardPointer, []);
  const r2 = assignBinding(DEFAULT_KEYS, r.overrides, 'descend', 1, 'KeyV');
  assert.deepEqual(resolveBindings(DEFAULT_KEYS, r2.overrides).descend, ['KeyC', 'KeyV']);
  const r3 = assignBinding(DEFAULT_KEYS, r2.overrides, 'descend', 0, null);
  assert.deepEqual(resolveBindings(DEFAULT_KEYS, r3.overrides).descend, ['KeyV']);
  // a seeded storm of random assignments never yields a conflict
  let o: Record<string, readonly string[]> = {}, s = 7;
  const codes = ['KeyV', 'KeyC', 'Space', 'KeyW', 'KeyQ', 'ShiftLeft', 'KeyB', 'Digit1', 'ControlLeft'];
  for (let i = 0; i < 400; i++) {
    s = (s * 1103515245 + 12345) >>> 0;
    const a = ACTIONS[s % ACTIONS.length].id, c = codes[(s >>> 8) % codes.length];
    o = assignBinding(DEFAULT_KEYS, o, a, (s >>> 16) % 2, (s >>> 20) % 9 === 0 ? null : c).overrides;
    assert.deepEqual(bindingConflicts(resolveBindings(DEFAULT_KEYS, o)), [], `step ${i}`);
  }
});

test('rebinding reaches the sample: keyboard and pad tables from setBindings', async () => {
  const { input, key, setPad } = await stubInput();
  input.setBindings({ jump: ['KeyB'] }, { jump: [PAD.y] });
  key('Space');
  assert.equal(input.sample(0).jumpPressed, false, 'Space is no longer Jump');
  key('KeyB');
  assert.equal(input.sample(0).jumpPressed, true);
  key('KeyB', false); key('Space', false);
  setPad([PAD.y]);
  let f = input.sample(0);
  assert.equal(f.jumpPressed, true, 'Y jumps on the pad');
  assert.equal((f.btn ?? 0) & BTN.sig, 0, 'and no longer casts the Signature');
  setPad([PAD.a]);
  f = input.sample(0);
  assert.equal(f.jump, false, 'A is unbound now');
  input.setBindings();
  setPad([PAD.a]); input.sample(0);
  assert.equal(input.padHeld('jump'), true, 'defaults restored');
});

test('saved bindings: anything saved is cut down to known actions and valid codes, in fresh objects', () => {
  assert.deepEqual(sanitizeKeyOverrides({ jump: ['KeyV', 'KeyV', 'Tab', 7, 'x y'], nope: ['KeyQ'], descend: 'KeyB' }), { jump: ['KeyV'] });
  assert.deepEqual(sanitizePadOverrides({ jump: [0, 0, 16, -1, 1.5, 3], dash: [3] }), { jump: [0, 3], dash: [] }, 'a code claimed twice stays with the first action');
  const s = loadSettings({ keys: { descend: ['KeyG'] }, pad: 'junk' });
  assert.deepEqual(s.keys, { descend: ['KeyG'] });
  assert.deepEqual(s.pad, {});
  const fresh = loadSettings({});
  assert.notEqual(fresh.keys, SETTINGS_DEFAULT.keys, 'never the default object (Reset must not see edits)');
  assert.deepEqual(fresh.keys, {}); assert.deepEqual(fresh.pad, {});
});

test('names for the bindings screen', () => {
  assert.equal(keyName('KeyV'), 'V'); assert.equal(keyName('Digit3'), '3'); assert.equal(keyName('ShiftLeft'), 'L Shift'); assert.equal(keyName('Space'), 'Space');
  assert.equal(padName(PAD.ls), 'L-stick click'); assert.equal(padName(PAD.x), 'X'); assert.equal(padName(PAD.rt), 'RT');
});
