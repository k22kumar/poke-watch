// Control bindings (R6c, docs/CONTROLS.md): which keyboard keys and gamepad buttons drive each action. Pure tables and
// functions (no DOM), so tests/bindings.test.ts checks them headless. input/input.ts reads the resolved tables; the
// player's changes are saved as overrides in the settings (ui/settings.ts `keys`, `pad`) and edited on Settings →
// Controls → Bindings (ui/ui.ts).
//
// Defaults are the controls of every earlier phase, unchanged, plus `descend` (R6c): V on the keyboard (next to C and
// Space; C stays `cardPointer`), left-stick click on the pad (provisional, docs/CONTROLS.md "Descend"; X stays free as
// the alternative a player can bind if it proves uncomfortable: no duplicate default), and a touch button. Ctrl is not a default: Ctrl + W / S / D are browser shortcuts while
// moving (Ctrl + W cannot be intercepted); a player may still bind it.
//
// Gamepad buttons are the W3C "standard" mapping indices. Movement on the pad is the left stick and look / aim the right
// stick (axes, not rebindable). Menu navigation on the pad (A confirm, B back, d-pad or stick to move focus) is fixed:
// it belongs to the menus, not to play.

/** the actions players can bind, in the order the bindings screen lists them */
export const ACTIONS = [
  { id: 'up', label: 'Move forward' }, { id: 'down', label: 'Move back' }, { id: 'left', label: 'Move left' }, { id: 'right', label: 'Move right' },
  { id: 'jump', label: 'Jump / ascend' }, { id: 'descend', label: 'Descend (flight)' }, { id: 'dash', label: 'Dash' },
  { id: 'basic', label: 'Attack' }, { id: 'moveA', label: 'Move A' }, { id: 'moveB', label: 'Move B' }, { id: 'sig', label: 'Signature / Tag' }, { id: 'guard', label: 'Guard' },
  { id: 'pick1', label: 'Pick card 1' }, { id: 'pick2', label: 'Pick card 2' }, { id: 'pick3', label: 'Pick card 3' }, { id: 'pick4', label: 'Pick card 4' },
  { id: 'reroll', label: 'Reroll cards' }, { id: 'skip', label: 'Skip cards' }, { id: 'banish', label: 'Banish a card' }, { id: 'cardPointer', label: 'Cursor / camera toggle' },
  { id: 'pause', label: 'Pause' }, { id: 'mute', label: 'Mute' }, { id: 'tuning', label: 'Tuning panel' },
] as const;
export type Action = (typeof ACTIONS)[number]['id'];
const ACTION_IDS = new Set<string>(ACTIONS.map((a) => a.id));

/** slots per action and device on the bindings screen (every default fits in two) */
export const SLOTS = 2;

export type KeyBindings = Record<string, readonly string[]>;
export type PadBindings = Record<string, readonly number[]>;

/** keyboard defaults (KeyboardEvent.code) */
export const DEFAULT_KEYS: KeyBindings = {
  up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  jump: ['Space'], descend: ['KeyV'], dash: ['ShiftLeft', 'ShiftRight'],
  // hero-shooter combat: the basic attack is primary fire (left mouse, J), Move A secondary (right mouse, K),
  // Move B R, Q the Signature / Tag, E Guard
  basic: ['KeyJ'], moveA: ['KeyK'], moveB: ['KeyR'], sig: ['KeyQ'], guard: ['KeyE', 'KeyL'],
  pause: ['Escape', 'KeyP'], reroll: ['KeyF'], skip: ['KeyX'], banish: ['KeyZ'],
  pick1: ['Digit1'], pick2: ['Digit2'], pick3: ['Digit3'], pick4: ['Digit4'], cardPointer: ['KeyC'], tuning: ['Backquote'], mute: ['KeyM'],
};

/** standard-mapping gamepad button indices */
export const PAD = { a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, lt: 6, rt: 7, back: 8, start: 9, ls: 10, rs: 11, up: 12, down: 13, left: 14, right: 15 } as const;
/** buttons a binding may use (0–15; 16, the home / guide button, belongs to the browser or the OS) */
export const PAD_BUTTONS = 16;

/** gamepad defaults: the buttons the pad used before R6c (A jump, B dash, Y Signature, LB Guard, RB Move B, LT Move A,
 *  RT attack, Start pause, d-pad left / up / right picks and down rerolls while the card tray is open), plus descend */
export const DEFAULT_PAD: PadBindings = {
  jump: [PAD.a], dash: [PAD.b], basic: [PAD.rt], moveA: [PAD.lt], moveB: [PAD.rb], sig: [PAD.y], guard: [PAD.lb],
  descend: [PAD.ls], pause: [PAD.start],
  pick1: [PAD.left], pick2: [PAD.up], pick3: [PAD.right], reroll: [PAD.down],
};

/** keys a binding may not take: Escape cancels a capture on the bindings screen (and releases the pointer lock in the
 *  browser), Tab moves focus */
export const RESERVED_KEYS: readonly string[] = ['Tab'];

const KEY_CODE = /^[A-Za-z][A-Za-z0-9]{0,31}$/;
const okKey = (c: unknown): c is string => typeof c === 'string' && KEY_CODE.test(c) && !RESERVED_KEYS.includes(c);
const okPad = (c: unknown): c is number => typeof c === 'number' && Number.isInteger(c) && c >= 0 && c < PAD_BUTTONS;

/** a saved copy of the player's overrides (anything at all) brought to a clean table: known actions only, at most SLOTS
 *  distinct valid codes each, and no code claimed by two overridden actions (the first keeps it) */
function sanitize<T extends string | number>(saved: unknown, ok: (c: unknown) => c is T): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return out;
  const seen = new Set<T>();
  for (const a of ACTIONS) {
    const v = (saved as Record<string, unknown>)[a.id];
    if (!Array.isArray(v)) continue;
    const codes: T[] = [];
    for (const c of v) if (ok(c) && !seen.has(c) && codes.length < SLOTS) { codes.push(c); seen.add(c); }
    out[a.id] = codes;
  }
  return out;
}
export const sanitizeKeyOverrides = (saved: unknown) => sanitize(saved, okKey);
export const sanitizePadOverrides = (saved: unknown) => sanitize(saved, okPad);

/** The table in use: the defaults with the player's overrides on top. An overridden action has exactly its override's
 *  codes; a code an override claims leaves every action the player did not override, so a default added later (or
 *  one the player moved) never silently drives two actions. */
export function resolveBindings<T extends string | number>(defaults: Record<string, readonly T[]>, overrides: Record<string, readonly NoInfer<T>[]>): Record<string, T[]> {
  const claimed = new Set<T>();
  for (const a of ACTIONS) for (const c of overrides[a.id] ?? []) claimed.add(c);
  const out: Record<string, T[]> = {};
  for (const a of ACTIONS) {
    const o = overrides[a.id];
    out[a.id] = o ? [...o] : (defaults[a.id] ?? []).filter((c) => !claimed.has(c));
  }
  return out;
}

/** codes bound to more than one action, with the actions (empty for every resolved table: resolveBindings and
 *  assignBinding never produce one; tests/bindings.test.ts checks the defaults) */
export function bindingConflicts<T extends string | number>(table: Record<string, readonly T[]>): [T, string[]][] {
  const by = new Map<T, string[]>();
  for (const a of ACTIONS) for (const c of table[a.id] ?? []) by.set(c, [...(by.get(c) ?? []), a.id]);
  return [...by].filter(([, as]) => as.length > 1);
}

/** Bind `code` to `action` in slot `slot` (null clears the slot). Returns the new overrides (the input is not changed)
 *  and the action the code was taken from, if any: a code drives one action, so binding it moves it. */
export function assignBinding<T extends string | number>(defaults: Record<string, readonly T[]>, overrides: Record<string, readonly NoInfer<T>[]>, action: string, slot: number, code: NoInfer<T> | null): { overrides: Record<string, T[]>; from: string | null } {
  if (!ACTION_IDS.has(action) || slot < 0 || slot >= SLOTS) throw new Error(`no binding slot ${action}[${slot}]`);
  const cur = resolveBindings(defaults, overrides);
  const next: Record<string, T[]> = {};
  for (const [a, cs] of Object.entries(overrides)) next[a] = [...cs];
  let from: string | null = null;
  if (code !== null) for (const a of ACTIONS) {
    if (a.id === action || !cur[a.id].includes(code)) continue;
    from = a.id;
    next[a.id] = cur[a.id].filter((c) => c !== code);
  }
  const mine = cur[action].filter((c) => c !== code);
  if (code === null) mine.splice(slot, 1);
  else mine.splice(Math.min(slot, mine.length), slot < mine.length ? 1 : 0, code);
  next[action] = mine.slice(0, SLOTS);
  return { overrides: next, from };
}

const KEY_NAMES: Record<string, string> = {
  Space: 'Space', Escape: 'Esc', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
  Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Enter: 'Enter', Backspace: 'Backspace',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  ShiftLeft: 'L Shift', ShiftRight: 'R Shift', ControlLeft: 'L Ctrl', ControlRight: 'R Ctrl', AltLeft: 'L Alt', AltRight: 'R Alt',
  MetaLeft: 'L Meta', MetaRight: 'R Meta', CapsLock: 'Caps',
};
/** a key's name for the screen ('KeyW' → 'W', 'Digit1' → '1', 'ShiftLeft' → 'L Shift') */
export function keyName(code: string): string {
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^Numpad/.test(code)) return 'Num ' + code.slice(6);
  return code;
}
const PAD_NAMES = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Back', 'Start', 'L-stick click', 'R-stick click', 'D-pad up', 'D-pad down', 'D-pad left', 'D-pad right'];
/** a gamepad button's name (Xbox labels of the standard mapping) */
export const padName = (i: number) => PAD_NAMES[i] ?? `Button ${i}`;
