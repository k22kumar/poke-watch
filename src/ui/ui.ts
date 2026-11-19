// DOM overlay UI in a handheld Pokémon style adapted to continuous combat.
// - Every interactive element is a real <button> (partner/mode choices are radio buttons), so
//   mouse, touch, Tab, arrow keys and a gamepad all work, with visible focus/selected/disabled.
// - Menus own the keyboard while open (Tab moves focus normally, arrows/D-pad move spatially,
//   Enter/Space/A confirm, Esc/Backspace/B go back); gameplay keys only apply during play.
// - The HUD keeps HP, EXP, level, moves, status and boss information at the screen edges.
import { capLabel, capTags, compileCaps } from '../rules/capabilities';
import { HABITATS } from '../world/habitat/recipes';
import { LOCATIONS } from '../world/locations';
import { BODY_KINDS, BODY_TEMPLATES } from '../rules/materials';
import { weightClass } from '../rules/species';
import { debugLine, debugTag } from '../sim/caplog';
import { ELEMENT_DEFS, type Element } from '../rules/elements';
import { SPECIES, SPECIES_BY_ID, starterChoices, type SpeciesDef } from '../rules/species';
import { bodyOf, type SizeRules } from '../rules/sizing';
import { traversalOf } from '../rules/profiles';
import { ACTIONS, DEFAULT_KEYS, DEFAULT_PAD, PAD_BUTTONS, RESERVED_KEYS, SLOTS, assignBinding, keyName, padName, resolveBindings, type KeyBindings, type PadBindings } from '../input/bindings';
import type { ControlReadiness } from '../sim/playability';
import { BIOMES, STAGES } from '../rules/stages';
import { MOVE_BY_KEY } from '../rules/moves';
import { ABILITIES, abilityOf } from '../rules/abilities';
import { MODES } from '../mods';
import type { Mode } from '../mods/types';
import { ROLE } from '../sim/pools';
import { compileMove, levelled, slotSpec } from '../sim/moves';
import { pinchActive } from '../sim/combat';
import { lineage } from '../sim/progression';
import type { Card, SimContext } from '../sim/types';
import { COAT_NAMES } from '../rules/reactions';
import { tagLineOf } from '../rules/tags';
import { drawText, textWidth } from '../overworld/font';
import { registry } from '../assets/registry';
import { CAMERA_PRESETS } from '../render/camera';
import { TYPE_OF, typeBadge, itemIcon, glyphImg, ICON_LICENSE } from './pixicons';
import { HEAL_LOOK, LEARN_LOOK, UPGRADE_LOOK, VITAMIN_LOOK, TECH_LOOK, EVOLVE_LOOK, type ItemLook } from './items';
import { TECHNIQUE_BY_ID, TRANSFORM_BY_ID, TRANSFORMS_OF } from '../rules/build';
import { transformSpec } from '../sim/build';
import { WEIGHT_NAMES } from '../rules/species';
import { loadInfo } from '../world/replay';

function outlineText(g: CanvasRenderingContext2D, t: string, x: number, y: number, color: string) {
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [1, 1]]) drawText(g, t, x + dx, y + dy, '#1b1630');
  drawText(g, t, x, y, color);
}

type Attrs = Record<string, any>;
type Kid = Node | string | null | undefined | false;
function h(tag: string, attrs: Attrs = {}, ...kids: Kid[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.setAttribute('style', v);
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) (el as any)[k.toLowerCase()] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of kids) if (c != null && c !== false) el.append(c as any);
  return el;
}
const btn = (label: Kid | Kid[], onclick: () => void, cls = 'btn', extra: Attrs = {}) => h('button', { type: 'button', class: cls, onclick, ...extra }, ...(Array.isArray(label) ? label : [label]));

export interface UISettings { volume: number; music: number; master: number; cries: number; muted: boolean; quality: number; numbers: boolean; camera: string; shake: number; combat: 'aimed' | 'assist' | 'auto'; sens: number; invertY: boolean; fov: number; world: 'authored' | 'generated' | 'locations'; map: string; mapSeed: number; keys: KeyBindings; pad: PadBindings }
export interface UIHooks {
  start(mode: Mode, species: string, seed: number): void;
  card(action: 'pick' | 'reroll' | 'skip' | 'banish', index: number): void;
  /** `via`: 'click' from the Resume button (a user gesture, so the mouse can be captured in it), 'key' from Esc / Backspace
   *  in the pause menu (no user activation: browsers refuse a pointer lock from an Esc keydown) */
  resume(via: 'click' | 'key'): void;
  restart(): void;
  quit(): void;
  portrait(id: string): HTMLCanvasElement | undefined;
  sound(kind: 'ui' | 'pick' | 'move' | 'back' | 'denied'): void;
  settings: UISettings;
  cry(id: string): void;
  applySettings(): void;
  resetSettings(): void;
  preview(kind: 'cry' | 'sfx' | 'music'): void;
  tuning(): { rules: any; ctx: SimContext | null; spawnBoss(): void; addLevel(): void; god(on: boolean): void; killAll(): void };
  /** developer roster (docs/PLAYABILITY.md): `dev` (?dev=1) adds the All Pokémon view to the partner screen */
  dev: boolean;
  /** every species graded for player control, in registry order (sim/playability.ts plus the host's art check) */
  roster(): ControlReadiness[];
  /** the size rules of the run on screen (ctx.rules.size), the defaults before one: the developer roster's class labels */
  sizeRules(): SizeRules;
  /** restart the current run (same mode and seed) as another species; false when there is no run or it is not selectable */
  become(id: string): boolean;
}

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const typeName = (e: Element) => { const t = TYPE_OF[e]; return t[0].toUpperCase() + t.slice(1); };
/** the species' role in the roster (content/roster.json), for the developer roster */
const roleOf = (sp: SpeciesDef) => (sp.playable ? 'Starter' : sp.boss ? 'Boss' : sp.behaviour ? 'Wild' : 'Evolution');
const CLASS_NAME = { physical: 'Physical', special: 'Special', status: 'Status' } as const;
const SHAPE_NAME: Record<string, string> = {
  strike: 'close strike', dash: 'dash attack', spin: 'spin', bolt: 'fast projectile', orb: 'piercing orb', homing: 'homing shot', barrage: 'multi-shot',
  lob: 'lobbed blast', boomerang: 'boomerang', drain: 'draining shot', beam: 'beam', cone: 'cone spray', nova: 'burst around you', vortex: 'trapping vortex',
  chain: 'chain lightning', meteor: 'falling strike', smite: 'strike on the toughest foe', trap: 'trap', orbit: 'orbiting guard', trail: 'trail',
  aura: 'aura', buff: 'self boost', weather: 'weather',
};

function copyCanvas(src: HTMLCanvasElement | undefined, cls = ''): HTMLCanvasElement {
  const c = document.createElement('canvas');
  if (cls) c.className = cls;
  if (!src) return c;
  c.width = src.width; c.height = src.height;
  c.getContext('2d')!.drawImage(src, 0, 0);
  return c;
}
function lookIcon(L: ItemLook, scale = 2): HTMLElement {
  return (L.item ? itemIcon(L.item, scale) : null) ?? glyphImg(L.glyph ?? 'upgrade', scale);
}

/** screens that take the keyboard, topmost first */
const MENU_ORDER = ['screen-bindings', 'screen-settings', 'screen-help', 'screen-credits', 'screen-pause', 'screen-end', 'screen-select', 'screen-title'];

export class UI {
  root: HTMLElement;
  private screens: Record<string, HTMLElement> = {};
  private backs: Record<string, () => void> = {};
  private hud!: Record<string, HTMLElement>;
  private slots: HTMLElement[] = [];
  private mode: Mode = MODES[0];
  private species = 'charmander';
  private banishing = false;
  private cardPending = false;
  private cardsShown: Card[] = [];
  private bannerT = 0;
  private hpLagTimer = 0;
  private lastSpecies = '';
  private lastMoves = '';
  private lastVits = '';
  private lastStatus = '';
  private padPrev: boolean[] = [];
  private padRepeat = 0;
  /** Settings → Controls → Bindings: the slot waiting for a key or a pad button (null when none), and the screen to go
   *  back to */
  private capture: { action: string; dev: 'key' | 'pad'; slot: number } | null = null;
  private bindingsBack = 'screen-settings';
  fx2d: CanvasRenderingContext2D;
  tray!: HTMLElement;
  private upgradeStatus!: HTMLElement;
  private upgradeFeedback!: HTMLElement;
  private upgradeFeedbackTimer = 0;

  constructor(private hooks: UIHooks) {
    this.root = document.getElementById('ui')!;
    const fx = document.getElementById('fx2d') as HTMLCanvasElement;
    this.fx2d = fx.getContext('2d')!;
    this.build();
    window.addEventListener('keydown', (e) => this.handleKey(e), true);
  }

  private add(name: string, el: HTMLElement) {
    el.id = name;
    el.classList.add('hidden');
    this.screens[name] = el;
    this.root.append(el);
    return el;
  }
  show(name: string, on = true) { this.screens[name]?.classList.toggle('hidden', !on); }
  hideAll() {
    for (const s of Object.values(this.screens)) s.classList.add('hidden');
    this.clearTransient();
  }
  /** things that live on #ui outside `screens` (the banked-pick tray, the banner, the region plaque) and the effects canvas:
   *  every screen change (new run, title, select) must clear them, or they linger over the next screen */
  clearTransient() {
    this.hideCards();
    this.cardsShown = [];
    this.banishing = false;
    this.bannerT = 0;
    document.getElementById('banner')?.classList.remove('show');
    clearTimeout(this.plaqueT);
    document.getElementById('plaque')?.classList.remove('show');
    this.clearFx();
  }
  /** wipe the 2D effects layer (damage numbers, objective pointer, debug overlay); it is only redrawn while a run is live */
  clearFx() { const cv = this.fx2d.canvas; this.fx2d.clearRect(0, 0, cv.width, cv.height); }
  private visible(name: string) { const s = this.screens[name]; return !!s && !s.classList.contains('hidden'); }

  // ------------------------------------------------------------ menu navigation
  /** the menu screen that currently owns the keyboard (null during play) */
  activeMenu(): string | null { return MENU_ORDER.find((n) => this.visible(n)) ?? null; }
  menuOpen() { return this.activeMenu() !== null; }

  private focusables(root: HTMLElement): HTMLElement[] {
    return [...root.querySelectorAll<HTMLElement>('button, input, select, [tabindex="0"]')].filter((el) => !(el as HTMLButtonElement).disabled && el.offsetParent !== null && !el.closest('.hidden'));
  }
  /** focus the screen's default control (selected choice or primary button) */
  private focusDefault(name: string) {
    const run = () => {
      const root = this.screens[name];
      if (!root || root.classList.contains('hidden')) return;
      const el = root.querySelector<HTMLElement>('[aria-checked="true"]') ?? root.querySelector<HTMLElement>('.primary:not([disabled])') ?? this.focusables(root)[0];
      el?.focus({ preventScroll: false });
    };
    run();
    requestAnimationFrame(run);
  }
  /** move focus to the nearest control in a direction (spatial navigation) */
  private moveFocus(dx: number, dy: number) {
    const name = this.activeMenu();
    if (!name) return;
    const root = this.screens[name];
    const items = this.focusables(root);
    if (!items.length) return;
    let cur = document.activeElement as HTMLElement | null;
    if (!cur || !root.contains(cur)) {
      // nothing focused yet (the screen just opened): start from its default control
      cur = root.querySelector<HTMLElement>('[aria-checked="true"]') ?? root.querySelector<HTMLElement>('.primary:not([disabled])') ?? items[0];
      cur.focus();
    }
    const a = cur.getBoundingClientRect();
    const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    let best: HTMLElement | null = null, bs = Infinity;
    for (const el of items) {
      if (el === cur) continue;
      const b = el.getBoundingClientRect();
      const bx = b.left + b.width / 2, by = b.top + b.height / 2;
      const along = (bx - ax) * dx + (by - ay) * dy;
      if (along <= 4) continue;
      const across = Math.abs((bx - ax) * dy) + Math.abs((by - ay) * dx);
      const score = along + across * 2.2;
      if (score < bs) { bs = score; best = el; }
    }
    if (best) { best.focus(); this.hooks.sound('move'); if (best.getAttribute('role') === 'radio' && best.dataset.follow) best.click(); }
    else this.hooks.sound('denied');
  }
  private back(name: string) { const fn = this.backs[name]; if (fn) { this.hooks.sound('back'); fn(); } }

  private handleKey(e: KeyboardEvent) {
    const name = this.activeMenu();
    const t = e.target as HTMLElement;
    // the bindings screen waits for a key: it takes this one (gameplay and menu navigation never see it). Esc cancels,
    // Delete / Backspace clear the slot, Tab keeps moving focus
    if (this.capture && name === 'screen-bindings' && e.code !== 'Tab') {
      e.preventDefault(); e.stopPropagation();
      if (e.repeat) return;
      if (e.code === 'Escape') { this.capture = null; this.openBindings(this.bindingsBack); return; }
      if (this.capture.dev === 'pad' && e.code !== 'Delete' && e.code !== 'Backspace') return;
      this.bindTo(e.code === 'Delete' || e.code === 'Backspace' ? null : e.code);
      return;
    }
    if (!name && this.tray.contains(t)) {
      const dir: Record<string, number> = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 };
      if (dir[e.key]) {
        const cards = [...this.tray.querySelectorAll<HTMLButtonElement>('.card')];
        const i = cards.indexOf(t.closest<HTMLButtonElement>('.card')!);
        const next = cards[i + dir[e.key]];
        e.preventDefault();
        e.stopPropagation();
        next?.focus();
        return;
      }
      if ((e.key === 'Enter' || e.key === ' ') && t.closest('.card')) e.stopPropagation();
      return;
    }
    if (!name) return;
    const typing = t?.tagName === 'INPUT' && (t as HTMLInputElement).type === 'text';
    const k = e.key;
    if (typing && !['Escape', 'Enter', 'Tab'].includes(k)) return;
    const dir: Record<string, [number, number]> = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    if (dir[k] && !(t?.tagName === 'INPUT' && (t as HTMLInputElement).type === 'range' && (k === 'ArrowLeft' || k === 'ArrowRight'))) { e.preventDefault(); e.stopPropagation(); this.moveFocus(...dir[k]); return; }
    if (k === 'Escape' || (k === 'Backspace' && !typing)) { e.preventDefault(); e.stopPropagation(); this.back(name); return; }
    if (k === 'Tab') { e.stopPropagation(); return; } // native focus order, never swallowed by gameplay
    if ((k === 'Enter' || k === ' ') && t?.tagName === 'BUTTON') e.stopPropagation(); // native activation
  }

  /** gamepad menu navigation (call every frame while a menu is open) */
  padTick(dt: number) {
    const name = this.activeMenu();
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const p = pads && pads[0];
    if (!p || !name) { this.padPrev = []; return; }
    const b = (i: number) => !!p.buttons[i]?.pressed;
    const edge = (i: number) => b(i) && !this.padPrev[i];
    // the bindings screen waits for a pad button: the first new press takes the slot (no navigation meanwhile)
    if (this.capture?.dev === 'pad' && name === 'screen-bindings') {
      let got = -1;
      for (let i = 0; i < PAD_BUTTONS && got < 0; i++) if (edge(i)) got = i;
      this.padPrev = p.buttons.map((x) => x.pressed);
      if (got >= 0) this.bindTo(got);
      return;
    }
    const ax = p.axes[0] ?? 0, ay = p.axes[1] ?? 0;
    const dx = (b(15) ? 1 : 0) - (b(14) ? 1 : 0) || (Math.abs(ax) > 0.55 ? Math.sign(ax) : 0);
    const dy = (b(13) ? 1 : 0) - (b(12) ? 1 : 0) || (Math.abs(ay) > 0.55 ? Math.sign(ay) : 0);
    this.padRepeat -= dt;
    if ((dx || dy) && this.padRepeat <= 0) { this.moveFocus(dx, dx ? 0 : dy); this.padRepeat = this.padPrev.length && (this.padPrev[20] ?? false) ? 0.12 : 0.28; }
    if (!dx && !dy) this.padRepeat = 0;
    if (edge(0)) (document.activeElement as HTMLElement | null)?.click();
    if (edge(1)) this.back(name);
    this.padPrev = p.buttons.map((x) => x.pressed);
    this.padPrev[20] = !!(dx || dy);
  }

  // ------------------------------------------------------------ build
  private build() {
    this.add('screen-loading', h('div', { class: 'screen' }, h('div', { class: 'logo' }, 'POKE-', h('span', {}, 'WATCH')), h('div', { class: 'loadtxt' }, 'Loading Pokémon…'), h('div', { class: 'loadbar' }, h('div', { id: 'loadfill' }))));
    this.add('screen-title', h('div', { class: 'screen' }));
    this.add('screen-select', h('div', { class: 'screen' }));
    const hud = h('div', {});
    this.hud = {
      xp: h('div'), portrait: h('div', { class: 'hud-portrait' }), name: h('span', { class: 'nm' }), lvl: h('span', { class: 'lvl' }), types: h('span', { class: 'types' }),
      hpFill: h('div', { class: 'fill' }), hpLag: h('div', { class: 'lag' }), hpText: h('div', { class: 'hptext' }), status: h('div', { class: 'status' }),
      timer: h('div', { class: 'timer' }), stage: h('div', { class: 'stagename' }),
      kills: h('div'), live: h('small'),
      boss: h('div', { class: 'box bossbox hidden' }), bossName: h('div', { class: 'name' }), bossFill: h('div', { class: 'fill' }), bossTypes: h('span', { class: 'types' }),
      slots: h('div', { class: 'hud-bottom' }), vits: h('div', { class: 'vits' }), vignette: h('div', { class: 'vignette' }),
      squad: h('div', { class: 'squad hidden', role: 'group', 'aria-label': 'Squad' }), tagcd: h('div', { class: 'tagcd' }),
      obj: h('div', { class: 'box objbox hidden', role: 'status', 'aria-live': 'polite' }), objTitle: h('div', { class: 'ot' }), objBar: h('div', { class: 'ob' }), objTime: h('small', {}),
      hint: h('div', { class: 'hint' }),
    };
    const H = this.hud;
    H.obj.append(h('div', { class: 'orow' }, H.objTitle, H.objTime), h('div', { class: 'obar' }, H.objBar));
    H.boss.append(h('div', { class: 'row' }, H.bossName, H.bossTypes), h('div', { class: 'hprow' }, h('span', { class: 'hptag' }, 'HP'), h('div', { class: 'hpbar' }, h('div', { class: 'track' }, H.bossFill))));
    hud.append(
      H.vignette,
      h('div', { class: 'box infobox' }, H.portrait, h('div', { class: 'col' },
        h('div', { class: 'hud-name' }, H.name, H.lvl),
        H.types,
        h('div', { class: 'hp-line' },
          h('div', { class: 'hprow' }, h('span', { class: 'hptag' }, 'HP'), h('div', { class: 'hpbar' }, h('div', { class: 'track' }, H.hpLag, H.hpFill))),
          H.hpText),
        h('div', { class: 'exprow' }, h('span', { class: 'exptag' }, 'EXP'), h('div', { class: 'expbar' }, H.xp)))),
      H.status, H.squad,
      h('div', { class: 'box timebox' }, H.timer, H.stage),
      H.obj,
      h('div', { class: 'box hud-tr' }, H.kills, H.live),
      H.boss, H.slots, H.vits,
      H.hint,
    );
    this.refreshHint();
    this.add('hud', hud);
    const touchControls = h('div', { id: 'touch-controls', class: 'touch-controls' },
      h('button', { type: 'button', class: 'touch-btn basic', 'data-touch-action': 'basic', 'aria-label': 'Attack' }, 'Atk'),
      h('button', { type: 'button', class: 'touch-btn moveA', 'data-touch-action': 'moveA', 'aria-label': 'Move A' }, 'A'),
      h('button', { type: 'button', class: 'touch-btn moveB', 'data-touch-action': 'moveB', 'aria-label': 'Move B' }, 'B'),
      h('button', { type: 'button', class: 'touch-btn sig', 'data-touch-action': 'sig', 'aria-label': 'Signature / Tag' }, 'Sig'),
      h('button', { type: 'button', class: 'touch-btn guard', 'data-touch-action': 'guard', 'aria-label': 'Guard' }, 'Guard'),
      h('button', { type: 'button', class: 'touch-btn jump', 'data-touch-action': 'jump', 'aria-label': 'Jump' }, 'Jump'),
      h('button', { type: 'button', class: 'touch-btn dash', 'data-touch-action': 'dash', 'aria-label': 'Dash' }, 'Dash'),
      // R6c: Descend (the `descend` action, beside Jump). Hidden: no partner can fly before R6d, which shows it for a
      // body that holds a volume capability
      h('button', { type: 'button', class: 'touch-btn descend hidden', 'data-touch-action': 'descend', 'aria-label': 'Descend' }, 'Down'),
    );
    this.root.append(touchControls);
    this.root.append(h('div', { id: 'banner', role: 'status', 'aria-live': 'polite' }), h('div', { id: 'plaque' }));
    this.tray = h('div', { id: 'tray-cards', class: 'hidden', role: 'region', 'aria-label': 'Upgrade choices' });
    this.root.append(this.tray);
    this.upgradeStatus = h('div', { id: 'upgrade-status', class: 'sr-only', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
    this.root.append(this.upgradeStatus);
    this.upgradeFeedback = h('div', { id: 'upgrade-feedback', class: 'hidden', role: 'status' });
    this.root.append(this.upgradeFeedback);
    this.add('overlay-evolve', h('div', { class: 'screen' }, h('div', { class: 'rays' }), h('div', { class: 'box txt', id: 'evotxt' })));
    for (const n of ['screen-pause', 'screen-end', 'screen-settings', 'screen-bindings', 'screen-help', 'screen-credits']) this.add(n, h('div', { class: 'screen dim' }));
    this.add('tuning', h('div', { class: 'box' }));
  }

  loading(f: number) {
    this.show('screen-loading', f < 1);
    const el = document.getElementById('loadfill');
    if (el) el.style.width = `${Math.round(f * 100)}%`;
  }

  // ------------------------------------------------------------ title
  title() {
    this.hideAll();
    const scr = this.screens['screen-title'];
    scr.innerHTML = '';
    const modes = h('div', { class: 'modes', role: 'radiogroup', 'aria-label': 'Game mode' });
    const choose = (m: Mode, el: HTMLElement) => {
      this.mode = m; this.hooks.sound('ui');
      for (const c of modes.children) c.setAttribute('aria-checked', 'false');
      el.setAttribute('aria-checked', 'true');
    };
    for (const m of MODES) {
      const el: HTMLElement = h('button', { type: 'button', class: 'box choice mode', role: 'radio', 'aria-checked': String(m === this.mode), 'data-follow': '1', onclick: () => choose(m, el) }, h('b', {}, m.name), h('span', {}, m.description));
      modes.append(el);
    }
    scr.append(
      h('div', { class: 'logo' }, 'POKE-', h('span', {}, 'WATCH')),
      h('div', { class: 'tagline' }, 'A Pokémon survival fan game across four handcrafted regions'),
      modes,
      h('div', { class: 'title-actions' },
        btn('Play', () => { this.hooks.sound('pick'); this.openSelect(); }, 'btn primary'),
        btn('Settings', () => this.openSettings('screen-title')),
        btn('How to play', () => this.openHelp('screen-title')),
        btn('Credits', () => this.openCredits('screen-title'))),
      h('div', { class: 'footnote' }, 'Independent, non-commercial fan game. Not affiliated with Nintendo, Creatures, GAME FREAK or The Pokémon Company. Pokémon © Nintendo / Creatures / GAME FREAK / The Pokémon Company.'),
    );
    this.backs['screen-title'] = () => {};
    this.show('screen-title');
    this.focusDefault('screen-title');
  }

  // ------------------------------------------------------------ partner select
  openSelect() {
    this.hideAll();
    const scr = this.screens['screen-select'];
    scr.innerHTML = '';
    const roster = h('div', { class: 'roster', role: 'radiogroup', 'aria-label': 'Partner Pokémon' });
    const seedIn = h('input', { type: 'text', inputmode: 'numeric', value: String(Math.floor(Math.random() * 1e6)), 'aria-label': 'Seed' }) as HTMLInputElement;
    let offerSeed = Number(seedIn.value) || 1;
    let offers = starterChoices(offerSeed);
    let mulligansLeft = 1;
    if (!offers.length) offers = SPECIES.filter((s) => s.playable).map((s) => s.id);
    // ?dev=1: the All Pokémon view lists every species graded for player control (docs/PLAYABILITY.md), filled from the
    // registry, so a newly generated Pokémon appears here without any UI change
    let view: 'starters' | 'all' = this.hooks.dev ? 'all' : 'starters';
    let filter = '';
    const selectable = () => this.hooks.roster().filter((r) => r.tier !== 'unavailable').map((r) => r.id);
    const fitView = () => {
      const ok = view === 'all' ? selectable() : offers;
      if (!ok.includes(this.species)) this.species = ok[0] ?? offers[0];
    };
    fitView();
    const choose = (id: string, card: HTMLElement) => {
      this.species = id; this.hooks.sound('ui'); this.hooks.cry(id);
      for (const c of roster.querySelectorAll('.mon')) { c.setAttribute('aria-checked', 'false'); (c as any)._armed = false; }
      card.setAttribute('aria-checked', 'true'); (card as any)._armed = true;
    };
    const go = () => { this.hooks.sound('pick'); this.hooks.start(this.mode, this.species, Number(seedIn.value) || 1); };
    const TIER_TITLE = { ready: 'Ready', partial: 'Partial (plays, with known issues)', unavailable: 'Not playable yet' } as const;
    const rebuildAll = () => {
      roster.className = 'roster dev';
      roster.innerHTML = '';
      const q = filter.trim().toLowerCase();
      const all = this.hooks.roster(), size = this.hooks.sizeRules();
      for (const tier of ['ready', 'partial', 'unavailable'] as const) {
        const rows = all.filter((r) => r.tier === tier).filter((r) => {
          if (!q) return true;
          const sp = SPECIES_BY_ID[r.id];
          return [sp.id, sp.name, ...(sp.types ?? []), ...sp.elements.map(typeName), roleOf(sp), bodyOf(sp, size).className].some((s) => s.toLowerCase().includes(q));
        });
        if (!rows.length) continue;
        roster.append(h('h3', { class: 'dev-group' }, `${TIER_TITLE[tier]} · ${rows.length}`));
        for (const r of rows) roster.append(devCard(r, size));
      }
      if (!roster.querySelector('.mon')) roster.append(h('div', { class: 'dev-group' }, 'No Pokémon match the filter'));
    };
    const devCard = (r: ControlReadiness, size: SizeRules) => {
      const sp = SPECIES_BY_ID[r.id];
      const off = r.tier === 'unavailable';
      const opening = r.opening ? MOVE_BY_KEY[r.opening]?.name ?? r.opening : 'nothing';
      const meta = [roleOf(sp), bodyOf(sp, size).className, traversalOf(sp).air ? 'flies' : '', `opens with ${opening}`].filter(Boolean).join(' · ');
      const card: HTMLElement = h('button', {
        type: 'button', class: `box choice mon dev tier-${r.tier}`, role: 'radio', 'aria-checked': String(!off && sp.id === this.species), 'aria-disabled': String(off),
        'aria-label': `${sp.name}, ${r.tier}${r.reasons.length ? ': ' + r.reasons.join('; ') : ''}`, title: r.reasons.join('\n') || 'Ready to play',
        onclick: () => {
          if (off) { this.hooks.sound('denied'); return; }
          if (this.species === sp.id && card.getAttribute('aria-checked') === 'true' && document.activeElement === card && (card as any)._armed) { go(); return; }
          choose(sp.id, card);
        },
      },
        h('div', { class: 'pic' }, copyCanvas(this.hooks.portrait(sp.id))),
        h('div', { class: 'info' },
          h('div', { class: 'mon-head' }, h('b', {}, sp.name), sp.dex ? h('span', { class: 'dex' }, `No.${String(sp.dex).padStart(3, '0')}`) : null),
          h('div', { class: 'types' }, ...sp.elements.map((e) => typeBadge(e))),
          h('div', { class: 'dev-meta' }, meta),
          r.reasons.length ? h('div', { class: 'dev-why' }, r.reasons.join(' · ')) : null),
      );
      return card;
    };
    const rebuildRoster = () => {
      if (view === 'all') { rebuildAll(); return; }
      roster.className = 'roster';
      roster.innerHTML = '';
      for (const id of offers) {
        const sp = SPECIES_BY_ID[id];
        if (!sp) continue;
        const line = lineFrom(sp);
        const ab = abilityOf(sp);
        const st = sp.stats;
        const bars = h('div', { class: 'stats' });
        for (const [k, lab] of [['hp', 'HP'], ['atk', 'Atk'], ['def', 'Def'], ['spa', 'SpA'], ['spd', 'SpD'], ['spe', 'Spe']] as const) {
          bars.append(h('span', {}, lab), h('div', { class: 'stat' }, h('div', { style: `width:${Math.min(100, (st[k] / 100) * 100)}%` })), h('b', {}, String(st[k])));
        }
        const card: HTMLElement = h('button', {
          type: 'button', class: 'box choice mon', role: 'radio', 'aria-checked': String(sp.id === this.species), 'aria-label': `${sp.name}, ${sp.elements.map(typeName).join(' and ')} type`,
          onclick: () => {
            if (this.species === sp.id && card.getAttribute('aria-checked') === 'true' && document.activeElement === card && (card as any)._armed) { go(); return; }
            choose(sp.id, card);
          },
        },
          h('div', { class: 'pic' }, copyCanvas(this.hooks.portrait(sp.id))),
          h('div', { class: 'info' },
            h('div', { class: 'mon-head' }, h('b', {}, sp.name), sp.dex ? h('span', { class: 'dex' }, `No.${String(sp.dex).padStart(3, '0')}`) : null),
            h('div', { class: 'types' }, ...sp.elements.map((e) => typeBadge(e))),
            ab ? h('div', { class: 'ability' }, h('b', {}, ABILITIES[ab].name), ' — ', ABILITIES[ab].game) : null,
            h('div', { class: 'line' }, line.map((s, i) => (i ? `${s.name} (Lv ${line[i - 1].evolveLevel})` : s.name)).join(' → ')),
            bars),
        );
        roster.append(card);
      }
    };
    rebuildRoster();
    const mulligan = btn(mulligansLeft > 0 ? 'Mulligan (1)' : 'Mulligan used', () => {
      if (mulligansLeft <= 0) return;
      offerSeed = (offerSeed + 1) >>> 0;
      offers = starterChoices(offerSeed);
      if (!offers.length) offers = SPECIES.filter((s) => s.playable).map((s) => s.id);
      this.species = offers[0];
      mulligansLeft = 0;
      this.hooks.sound('ui');
      rebuildRoster();
      btnText.textContent = 'Mulligan used';
      btnText.disabled = true;
    }, 'btn');
    const btnText = mulligan as HTMLButtonElement;
    const subText = () => view === 'all'
      ? `Mode: ${this.mode.name} · developer roster: every Pokémon in the game, graded for player control (docs/PLAYABILITY.md)`
      : `Mode: ${this.mode.name} · pick one of the three starters, or use your single mulligan before starting`;
    const sub = h('div', { class: 'sub' }, subText());
    let devTools: HTMLElement | null = null;
    if (this.hooks.dev) {
      const toggle = btn('', () => { view = view === 'all' ? 'starters' : 'all'; this.hooks.sound('ui'); sync(); }, 'btn small') as HTMLButtonElement;
      const search = h('input', { type: 'search', placeholder: 'Filter: name, type, role, size', 'aria-label': 'Filter Pokémon' }) as HTMLInputElement;
      search.oninput = () => { filter = search.value; rebuildRoster(); };
      const counts = this.hooks.roster().reduce((n, r) => { n[r.tier]++; return n; }, { ready: 0, partial: 0, unavailable: 0 });
      devTools = h('div', { class: 'dev-tools' }, toggle, search, h('span', { class: 'dev-count' }, `${counts.ready} ready · ${counts.partial} partial · ${counts.unavailable} not playable`));
      const sync = () => {
        fitView();
        toggle.textContent = view === 'all' ? 'Show starters' : 'All Pokémon (dev)';
        search.style.display = view === 'all' ? '' : 'none';
        mulligan.style.display = view === 'all' ? 'none' : '';
        sub.textContent = subText();
        rebuildRoster();
      };
      sync();
    }
    scr.append(
      h('h2', { class: 'box heading' }, 'Choose your partner'),
      sub,
      ...(devTools ? [devTools] : []),
      roster,
      h('div', { class: 'select-actions' },
        btn('Back', () => this.title()),
        h('label', { class: 'seed' }, 'Seed ', seedIn),
        mulligan,
        btn('Start run', go, 'btn primary')),
    );
    this.backs['screen-select'] = () => this.title();
    this.show('screen-select');
    this.focusDefault('screen-select');
  }

  // ------------------------------------------------------------ HUD
  startHud(ctx: SimContext) {
    this.hideAll();
    this.show('hud');
    this.lastSpecies = ''; this.lastMoves = ''; this.lastVits = ''; this.lastStatus = '';
    this.stageBanner(ctx);
  }

  stageBanner(ctx: SimContext) {
    const b = BIOMES[STAGES[ctx.stage % STAGES.length].biome];
    const el = document.getElementById('plaque')!;
    el.className = 'plaque-' + b.id;
    el.innerHTML = '';
    const hab = ctx.world.hab;
    const where = ctx.loop ? `Region ${ctx.stage + 1} · Lap ${ctx.loop + 1}` : `Region ${ctx.stage + 1} of ${ctx.rules.stage.count}`;
    // habitat maps: the map seed, so a layout can be replayed (Settings → World → Map seed, or ?mapseed=)
    el.append(h('span', { class: 'pname' }, ctx.world.map.gen?.loc ? ctx.world.map.name : b.name), h('small', {}, hab ? `${where} · ${loadInfo(hab).label}` : where));
    requestAnimationFrame(() => el.classList.add('show'));
    clearTimeout(this.plaqueT);
    this.plaqueT = setTimeout(() => el.classList.remove('show'), 3400) as unknown as number;
  }
  private plaqueT = 0;

  banner(text: string, sub = '', dur = 2) {
    const el = document.getElementById('banner')!;
    el.innerHTML = '';
    el.append(text, sub ? h('small', {}, sub) : '');
    el.classList.add('show');
    this.bannerT = dur;
  }

  hurt() {
    this.hud.vignette.classList.add('hurt');
    setTimeout(() => this.hud.vignette.classList.remove('hurt'), 180);
  }

  update(ctx: SimContext, dt: number, _fps: number) {
    const H = this.hud;
    const P = ctx.player;
    if (this.bannerT > 0) { this.bannerT -= dt; if (this.bannerT <= 0) document.getElementById('banner')!.classList.remove('show'); }
    H.xp.style.width = `${(P.xp / P.xpNext) * 100}%`;
    if (this.lastSpecies !== P.species.id) {
      this.lastSpecies = P.species.id;
      H.portrait.innerHTML = '';
      H.portrait.append(copyCanvas(this.hooks.portrait(P.species.id)));
      H.name.textContent = P.species.name;
      H.types.innerHTML = '';
      for (const e of P.species.elements) H.types.append(typeBadge(e));
    }
    H.lvl.textContent = String(P.level);
    const hpf = Math.max(0, P.hp / P.maxHp) * 100;
    H.hpFill.style.width = hpf + '%';
    H.hpFill.className = 'fill ' + (hpf <= 20 ? 'lo' : hpf <= 50 ? 'mid' : 'hi');
    this.hpLagTimer += dt;
    if (this.hpLagTimer > 0.1) { this.hpLagTimer = 0; H.hpLag.style.width = hpf + '%'; }
    H.hpText.textContent = `${Math.ceil(P.hp)}/${Math.round(P.maxHp)}`;
    H.timer.textContent = fmtTime(ctx.stageTime);
    const biome = BIOMES[STAGES[ctx.stage % STAGES.length].biome];
    const bossIn = ctx.rules.stage.bossAt - ctx.stageTime;
    H.stage.textContent = ctx.portal.active ? 'Portal open!' : bossIn > 0 ? `Boss in ${fmtTime(bossIn)}` : ctx.director.finalSwarm ? 'Final swarm' : ctx.world.map.gen?.loc ? ctx.world.map.name : biome.name;
    H.kills.textContent = `${ctx.stats.kills.toLocaleString()} KOs`;
    H.live.textContent = `${ctx.enemies.count} wild`;

    // status chips: paralysis, active ability, boost, weather
    const ab = abilityOf(P.species);
    const chips: string[] = [];
    if (P.paraT > 0) chips.push('<span class="st par">PAR</span>');
    if (ab && pinchActive(ctx)) chips.push(`<span class="st pinch">${ABILITIES[ab].name}!</span>`);
    if (P.buffT > 0) chips.push('<span class="st boost">Boost</span>');
    if (ctx.weather.element) chips.push(`<span class="st wx" style="--c:${ELEMENT_DEFS[ctx.weather.element].color}">${ctx.weather.element === 'tide' ? 'Rain' : ctx.weather.element === 'blaze' ? 'Harsh sun' : typeName(ctx.weather.element) + ' weather'}</span>`);
    if (P.m.coat) chips.push(`<span class="st coat c${P.m.coat}">${COAT_NAMES[P.m.coat]}${P.m.coatDeep === 2 ? '' : ' (light)'}</span>`);
    const sk = chips.join('');
    if (sk !== this.lastStatus) { this.lastStatus = sk; H.status.innerHTML = sk; }

    // the squad: one card per Pokémon (field one marked), with HP, grey health and what Tag will do
    this.updateSquad(ctx);

    // boss info box
    const bi = ctx.director.bossIndex;
    const E = ctx.enemies;
    if (bi >= 0 && E.alive[bi] && E.roles[bi] & ROLE.boss) {
      if (H.boss.classList.contains('hidden')) {
        H.boss.classList.remove('hidden');
        const sp = SPECIES[E.species[bi]];
        H.bossName.innerHTML = '';
        H.bossName.append(h('b', {}, sp.name), h('small', {}, sp.boss?.title ?? ''));
        H.bossTypes.innerHTML = '';
        for (const e of sp.elements) H.bossTypes.append(typeBadge(e));
      }
      const f = (Math.max(0, E.hp[bi]) / E.maxHp[bi]) * 100;
      H.bossFill.style.width = `${f}%`;
      H.bossFill.className = 'fill ' + (f <= 20 ? 'lo' : f <= 50 ? 'mid' : 'hi');
    } else H.boss.classList.add('hidden');

    // move slots
    const slotsMax = P.level >= ctx.rules.player.lateSlotLevel ? ctx.rules.player.moveSlotsLate : ctx.rules.player.moveSlots;
    const key = P.moves.map((m) => m.key + m.level + (m.xf ?? '')).join() + '|' + slotsMax + '|' + ctx.rules.combat.mode;
    if (key !== this.lastMoves) {
      this.lastMoves = key;
      H.slots.innerHTML = '';
      this.slots = [];
      const auto = ctx.rules.combat.mode === 'auto';
      const KEYS = auto ? ['AUTO', 'AUTO', 'AUTO', 'AUTO'] : ['LMB', 'RMB', 'R', 'Q'];
      const KEY_TITLE = auto ? ['fires on its own', 'fires on its own', 'fires on its own', 'fires on its own']
        : ['Left mouse / J / RT, hold to repeat', 'Right mouse / K / LT, aimed', 'R / RB, aimed', 'Q / Y, aimed'];
      for (let i = 0; i < Math.max(slotsMax, P.moves.length); i++) {
        const m = P.moves[i];
        if (!m) { H.slots.append(h('div', { class: 'slot empty' }, h('span', {}, '—'), h('span', { class: 'key' }, KEYS[i] ?? ''))); continue; }
        const pips = h('div', { class: 'pips' });
        for (let k = 1; k <= ctx.rules.moves.maxLevel; k++) pips.append(h('i', { class: k <= m.level ? 'on' : '' }));
        const cd = h('div', { class: 'cd' });
        const md = MOVE_BY_KEY[m.key];
        const xf = m.xf ? TRANSFORM_BY_ID[m.xf] : null;
        const el = h('div', { class: 'slot' + (xf ? ' xf' : ''), style: `--c:${ELEMENT_DEFS[m.spec.element].color}`, title: `${xf ? `${md?.name ?? m.key} → ${xf.title} (${xf.gain}; ${xf.cost})` : m.spec.name}: ${typeName(m.spec.element)} · ${CLASS_NAME[md?.cls ?? 'special']} · ${SHAPE_NAME[m.spec.archetype] ?? m.spec.archetype}${capLabel(m.spec.caps) ? ' · ' + capLabel(m.spec.caps) : ''} · ${KEY_TITLE[i] ?? ''}` },
          h('div', { class: 'band' }),
          glyphImg(m.spec.archetype, 2, 'pix glyph ico'),
          h('div', { class: 'nm' }, m.spec.name), pips, cd, h('span', { class: 'key' + (auto ? ' auto' : '') }, KEYS[i] ?? ''));
        this.slots.push(cd);
        H.slots.append(el);
      }
      // Reflex: two charges shared by Dash (Shift / B) and Guard (E / LB)
      const reflex = h('div', { class: 'slot dashslot reflex', title: 'Reflex charges: Dash (Shift / B) and Guard (E / LB) each spend one. Tap Guard as a hit arrives to deflect or parry it; hold to brace.' },
        h('div', { class: 'band' }), glyphImg('dash', 2, 'pix glyph ico'),
        h('div', { class: 'nm' }, 'Reflex'), h('div', { class: 'rpips' }), h('span', { class: 'key' }, 'E · Shift'));
      const dcd = h('div', { class: 'cd' });
      reflex.append(dcd);
      this.slots.push(dcd);
      H.slots.append(reflex);
    }
    for (let i = 0; i < P.moves.length; i++) {
      const m = P.moves[i];
      const full = slotSpec(ctx, i).cd;
      const f = m.windup ? 0 : Math.max(0, Math.min(1, m.cd / full));
      if (this.slots[i]) this.slots[i].style.height = `${f * 100}%`;
    }
    const dcd = this.slots[P.moves.length];
    if (dcd) {
      const C = ctx.rules.combat;
      const full = Math.floor(P.reflex + 1e-6);
      dcd.style.height = `${full >= 1 ? 0 : (1 - (P.reflex % 1)) * 100}%`;
      const rp = dcd.parentElement?.querySelector('.rpips');
      if (rp) {
        const sig = full + '|' + (P.guardT >= 0 ? 1 : 0);
        if (rp.getAttribute('data-s') !== sig) {
          rp.setAttribute('data-s', sig);
          rp.innerHTML = '';
          for (let k = 0; k < C.reflexCharges; k++) rp.append(h('i', { class: k < full ? 'on' : '' }));
        }
      }
      dcd.parentElement?.classList.toggle('guarding', P.guardT >= 0);
    }

    // the trainer's techniques (Phase 8b), then held items (vitamins, only with the legacy flag)
    const vk = P.techs.join() + '|' + JSON.stringify(P.vitamins);
    if (vk !== this.lastVits) {
      this.lastVits = vk;
      H.vits.innerHTML = '';
      for (const id of P.techs) {
        const T = TECHNIQUE_BY_ID[id];
        if (T) H.vits.append(h('div', { class: 'vit tech', title: `${T.title}: ${T.gain}. Cost: ${T.cost}` }, lookIcon(TECH_LOOK[id] ?? { name: T.title, glyph: 'upgrade' }, 1), h('span', {}, T.title)));
      }
      for (const [k, v] of Object.entries(P.vitamins)) {
        if (!(v > 0)) continue;
        const L = VITAMIN_LOOK[k] ?? { name: k, glyph: 'upgrade' };
        H.vits.append(h('div', { class: 'vit', title: `${L.name}: ${ctx.rules.vitamins[k]?.label ?? k} +${Math.round(v * 100)}%` }, lookIcon(L, 1), h('span', {}, `+${Math.round(v * 100)}%`)));
      }
    }
  }

  // ------------------------------------------------------------ squad strip
  private squadKey = '';
  private squadEls: { hp: HTMLElement; grey: HTMLElement; tag: HTMLElement | null }[] = [];
  private updateSquad(ctx: SimContext) {
    const P = ctx.player, H = this.hud;
    const key = P.squad.map((m, k) => `${m.species.id}:${m.fainted ? 1 : 0}:${k === P.active ? 1 : 0}`).join('|');
    if (key !== this.squadKey) {
      this.squadKey = key;
      H.squad.innerHTML = '';
      this.squadEls = [];
      H.squad.classList.toggle('hidden', P.squad.length < 2);
      const res = P.squad.map((_, k) => k).filter((k) => k !== P.active);
      P.squad.forEach((m, k) => {
        const field = k === P.active;
        const hp = h('div', { class: 'fill' }), grey = h('div', { class: 'grey' });
        const hint = field ? 'Field' : m.fainted ? 'Fainted' : res[0] === k ? 'Q+LMB' : 'Q+RMB';
        const tag = field || m.fainted ? null : h('span', { class: 'tagkey' }, hint);
        const card = h('div', { class: `mem${field ? ' field' : ''}${m.fainted ? ' out' : ''}`, title: `${m.species.name}${field ? ' (on the field)' : m.fainted ? ' (fainted)' : `: tap Q to swap to the last Pokémon, hold Q and press ${res[0] === k ? 'Move A' : 'Move B'} to pick this one`}` },
          h('div', { class: 'mp' }, copyCanvas(this.hooks.portrait(m.species.id))),
          h('div', { class: 'col' }, h('div', { class: 'mn' }, m.species.name), h('div', { class: 'mbar' }, grey, hp)),
          tag ?? h('span', { class: 'tagkey on' }, field ? '●' : '×'));
        this.squadEls.push({ hp, grey, tag });
        H.squad.append(card);
      });
      H.squad.append(H.tagcd);
    }
    P.squad.forEach((m, k) => {
      const el = this.squadEls[k];
      if (!el) return;
      const f = Math.max(0, m.hp / m.maxHp), g = Math.max(0, Math.min(1 - f, m.grey / m.maxHp));
      el.hp.style.width = `${f * 100}%`;
      el.grey.style.width = `${(f + g) * 100}%`;
    });
    H.tagcd.textContent = P.squad.length < 2 ? '' : P.tagCd > 0 ? `Tag ${P.tagCd.toFixed(1)} s` : 'Tag ready (Q)';
    H.tagcd.classList.toggle('ready', P.tagCd <= 0);
  }

  // ------------------------------------------------------------ level-up cards
  showCards(ctx: SimContext, cards: Card[], chest: boolean) {
    this.cardsShown = cards;
    this.banishing = false;
    this.cardPending = false;
    const scr = this.tray;
    scr.innerHTML = '';
    const row = h('div', { class: 'cards' });
    cards.forEach((c, i) => {
      const { look, kind, lines, tags } = this.describeCard(ctx, c);
      const title = c.kind === 'vitamin' || c.kind === 'heal' ? look.name : c.title;
      const detail = `${kind}: ${title}. ${lines.join('. ')}`;
      const el = h('button', { type: 'button', class: `box card ${c.rarity}`, style: c.element ? `--c:${ELEMENT_DEFS[c.element].color}` : '', onclick: () => this.cardClick(i), title: detail, 'aria-label': `${kind}: ${title}`, 'aria-description': lines.join('. ') },
        h('div', { class: 'top' }, c.kind === 'recruit' && c.key ? h('div', { class: 'recruit-pic' }, copyCanvas(this.hooks.portrait(c.key))) : lookIcon(look, 2), c.rarity !== 'common' ? h('span', { class: 'rar' }, c.rarity) : null),
        h('div', { class: 'kind' }, kind),
        h('div', { class: 'title' }, title),
        tags.length ? h('div', { class: 'tags' }, ...tags) : null,
        h('ul', { class: 'effects' }, ...lines.map((l) => h('li', {}, l))),
        h('div', { class: 'key' }, h('kbd', {}, String(i + 1))),
      );
      row.append(el);
    });
    const C = ctx.cards;
    const act = (label: string, count: number, k: string, fn: () => void) => btn([`${label} (${count}) `, h('kbd', {}, k)], fn, 'btn small', { disabled: count <= 0, 'aria-disabled': String(count <= 0) });
    const more = ctx.player.pendingLevels - (chest ? 0 : 1);
    const src = ctx.cards.source;
    const head = src === 'swap' ? `You can hold ${ctx.rules.build.maxTechniques} techniques: discard one for ${TECHNIQUE_BY_ID[ctx.build.swap?.tech ?? '']?.title ?? 'the new one'}, or keep yours (X)` : src === 'recruit' ? 'A wild Pokémon wants to join! Pick 1, 2 or 3' : src === 'tag' ? `${ctx.player.squad[cards[0]?.member ?? 0]?.species.name ?? ''} can learn a new Tag Action: 1 or 2` : chest ? 'You found an item ball!' : `Lv ${ctx.player.level - Math.max(0, more)}! Choose 1, 2 or 3 · D-pad ← ↑ →${more > 0 ? ` (${more} more banked)` : ''}`;
    this.upgradeStatus.textContent = head;
    const actions = src === 'recruit' || src === 'tag' || src === 'swap' ? [] : [
      act('Reroll', C.rerolls, 'F', () => this.cardAction('reroll')),
      act('Skip', C.skips, 'X', () => this.cardAction('skip')),
      act('Banish', C.banishes, 'Z', () => this.toggleBanish()),
    ];
    const compactHead = chest || src === 'recruit' || src === 'tag' || src === 'swap'
      ? head
      : `Lv ${ctx.player.level - Math.max(0, more)}${more > 0 ? ` · ${more} banked` : ' · Choose 1'}`;
    scr.append(
      h('div', { class: 'upgrade-toolbar' },
        h('h2', { class: 'box heading', title: head }, compactHead),
        actions.length ? h('div', { class: 'card-actions' }, ...actions) : null,
        h('div', { class: 'sub upgrade-controls' }, 'D-pad picks · C cursor'),
      ),
      row,
      // recruit and Tag-variant offers have no reroll, skip or banish: the last card is the free 'no'
      h('div', { class: 'sub banish-hint hidden' }, 'Banish: choose a card to remove it from this run'),
    );
    this.root.classList.add('offer-open');
    this.tray.classList.remove('hidden');
  }
  /** A nonmodal offer is showing; card keys remain routed alongside gameplay input. */
  trayOpen() { return !this.tray.classList.contains('hidden') && !this.tray.classList.contains('suspended'); }

  /** a card's practical effect on the current build, in concrete numbers */
  private describeCard(ctx: SimContext, c: Card): { look: ItemLook; kind: string; lines: string[]; tags: HTMLElement[] } {
    const P = ctx.player;
    const f1 = (n: number) => (Math.round(n * 10) / 10).toString();
    const f2 = (n: number) => n.toFixed(2);
    if (c.kind === 'recruit') {
      if (!c.key) return { look: HEAL_LOOK, kind: 'Squad', lines: ['Keep the squad as it is', `${P.squad.length} of ${ctx.rules.squad.max} Pokémon`], tags: [] };
      const sp = SPECIES_BY_ID[c.key];
      const tagMove = MOVE_BY_KEY[tagLineOf(c.key)?.base.move ?? ''];
      const ab = abilityOf(sp);
      return {
        look: LEARN_LOOK(TYPE_OF[sp.elements[0]]), kind: 'Recruit',
        tags: sp.elements.map((e) => typeBadge(e)),
        lines: [
          tagMove ? `Tag Action: ${tagMove.name}` : 'No Tag Action',
          `${sp.canon?.weightKg ?? '?'} kg · ${['Weightless', 'Light', 'Medium', 'Heavy', 'Massive'][sp.canon ? (sp.canon.weightKg < 1 ? 0 : sp.canon.weightKg < 10 ? 1 : sp.canon.weightKg < 50 ? 2 : sp.canon.weightKg < 200 ? 3 : 4) : 2]}`,
          ab ? `Ability: ${ABILITIES[ab].name}` : 'No ability in play',
          `Joins at Lv ${P.level}`,
        ],
      };
    }
    if (c.kind === 'tag') {
      const m = P.squad[c.member ?? 0];
      const md = MOVE_BY_KEY[tagLineOf(lineage(m.species)[0].id)?.[c.key === '1' ? 'variant' : 'base'].move ?? ''];
      const spec = md ? compileMove(ctx.rules, md.key) : null;
      return {
        look: LEARN_LOOK(TYPE_OF[md?.element ?? 'plain']), kind: c.key === '1' ? 'New Tag Action' : 'Keep Tag Action',
        tags: md ? [typeBadge(md.element), glyphImg(md.cls, 1, 'pix cat')] : [],
        lines: [`${m.species.name}`, spec ? `${SHAPE_NAME[spec.archetype] ?? spec.archetype}` : '', spec ? capLabel(compileCaps(spec, { create: tagLineOf(lineage(m.species)[0].id)?.[c.key === '1' ? 'variant' : 'base'].create })) || (md?.power ? `Base power ${md.power}` : 'No fixed power') : '', 'Fires when it tags in'],
      };
    }
    // Phase 8b cards: the slot they came from, then what changes
    const who = c.member !== undefined && P.squad[c.member] ? P.squad[c.member].species.name : P.species.name;
    const group = c.group === 'kit' ? `Kit · ${who}` : c.group === 'wildcard' ? `Wildcard · ${who}` : c.group === 'technique' ? 'Technique' : '';
    if (c.kind === 'transform') {
      const T = TRANSFORM_BY_ID[c.key];
      const spec = transformSpec(ctx.rules, T.move, T.id);
      const other = TRANSFORMS_OF[T.move].find((x) => x.id !== T.id)!;
      return {
        look: { name: T.title, glyph: spec.archetype }, kind: `${group} · Transform`,
        tags: [typeBadge(spec.element)],
        lines: [T.gain, `Cost: ${T.cost}`, capLabel(spec.caps) || 'No force verb', `Rules out ${other.title} for this run`],
      };
    }
    if (c.kind === 'technique') {
      const T = TECHNIQUE_BY_ID[c.key];
      const max = ctx.rules.build.maxTechniques;
      return {
        look: TECH_LOOK[c.key] ?? { name: T.title, glyph: 'upgrade' }, kind: c.swap ? 'Technique · replaces one' : 'Technique · trainer-wide',
        tags: [],
        lines: [T.gain, `Cost: ${T.cost}`, c.swap ? `You hold ${max}: you will choose one to discard` : `${P.techs.length} of ${max} held · works for every Pokémon`],
      };
    }
    if (c.kind === 'swap') {
      if (!c.key) return { look: HEAL_LOOK, kind: 'Keep', tags: [], lines: ['Back to the same three cards', c.desc] };
      const T = TECHNIQUE_BY_ID[c.key];
      return { look: TECH_LOOK[c.key] ?? { name: T.title, glyph: 'upgrade' }, kind: 'Discard', tags: [], lines: [`Lose: ${T.gain}`, `Free of: ${T.cost}`, c.desc] };
    }
    if (c.kind === 'evolve') {
      const m = P.squad[c.member ?? 0], to = SPECIES_BY_ID[c.key];
      return {
        look: EVOLVE_LOOK, kind: `${group} · Evolution`, tags: to.elements.map((e) => typeBadge(e)),
        lines: [`${m.species.name} → ${to.name}`, `Now, instead of at Lv ${m.species.evolveLevel}`, `${WEIGHT_NAMES[weightClass(m.species)]} → ${WEIGHT_NAMES[weightClass(to)]} Weight`, 'Full HP'],
      };
    }
    if (c.kind === 'replace') {
      const md = MOVE_BY_KEY[c.key], m = P.squad[c.member ?? P.active];
      const spec = compileMove(ctx.rules, c.key), old = m.moves[c.slot ?? 1];
      return {
        look: LEARN_LOOK(TYPE_OF[md.element]), kind: `${group} · Replace a move`,
        tags: [typeBadge(md.element), glyphImg(md.cls, 1, 'pix cat')],
        lines: [`Forget ${old?.spec.name ?? '?'}, learn ${md.name}`, `${SHAPE_NAME[spec.archetype] ?? spec.archetype}`, capLabel(spec.caps) || (md.power ? `Base power ${md.power}` : 'No fixed power'), `Move ${['basic', 'A', 'B', 'C'][c.slot ?? 1]} slot`],
      };
    }
    if (c.kind === 'learn') {
      const md = MOVE_BY_KEY[c.key];
      const spec = levelled(ctx, { key: c.key, level: 1, cd: 0, spec: compileMove(ctx.rules, c.key) });
      const mult = md.cls === 'physical' ? P.derived.atk : P.derived.spa;
      const stab = P.species.elements.includes(md.element) ? ctx.rules.damage.stab : 1;
      const learned = lineage(P.species).some((s) => (s.learnset ?? []).some(([, k]) => k === c.key));
      const ahead = lineage(P.species).flatMap((sp) => sp.learnset ?? sp.canon?.levelUp ?? []).find(([, k]) => k === c.key)?.[0] ?? 0;
      return {
        look: LEARN_LOOK(TYPE_OF[md.element]), kind: (group ? group + ' · ' : '') + (learned ? (ahead > P.level ? `Early move (Lv ${ahead})` : 'New move') : 'Coverage move'),
        tags: [typeBadge(md.element), glyphImg(md.cls, 1, 'pix cat')],
        lines: [
          `${SHAPE_NAME[spec.archetype] ?? spec.archetype}`,
          `≈ ${Math.round(spec.dmg * mult * stab)} damage every ${f2(spec.cd)} s${stab > 1 ? ' (same type)' : ''}`,
          capLabel(spec.caps) || (md.power ? `Base power ${md.power}` : 'No fixed power'),
          `Fills move slot ${P.moves.length + 1}`,
        ],
      };
    }
    if (c.kind === 'upgrade') {
      const slot = P.moves.find((m) => m.key === c.key)!;
      const a = levelled(ctx, slot), b = levelled(ctx, { ...slot, level: c.level ?? slot.level + 1 });
      const lines = [`Lv ${slot.level} → ${c.level}`, `Damage ${f1(a.dmg)} → ${f1(b.dmg)}`, `Cooldown ${f2(a.cd)} s → ${f2(b.cd)} s`];
      if (capLabel(a.caps)) lines.push(capLabel(a.caps));
      if (b.count !== a.count) lines.push(`Projectiles ${a.count} → ${b.count}`);
      if (Math.abs(b.radius - a.radius) > 0.01) lines.push(`Size ${f1(a.radius)} → ${f1(b.radius)} m`);
      return { look: UPGRADE_LOOK, kind: 'Power up', lines, tags: c.element ? [typeBadge(c.element)] : [] };
    }
    if (c.kind === 'vitamin') {
      const L = VITAMIN_LOOK[c.key] ?? { name: c.title, glyph: 'upgrade' };
      const V = ctx.rules.vitamins[c.key];
      const cur = P.vitamins[c.key] ?? 0, add = V.add * ctx.rules.cards.rarityMult[c.rarity];
      return { look: L, kind: L.item ? 'Item' : 'Charm', lines: [`${V.label} +${Math.round(cur * 100)}% → +${Math.round((cur + add) * 100)}%`, L.canon ? `Main-series effect: ${L.canon}` : 'Survival-only charm'], tags: [] };
    }
    const pct = 35 * ctx.rules.cards.rarityMult[c.rarity];
    return { look: HEAL_LOOK, kind: 'Berry', lines: [`Restore ${Math.round(pct)}% HP (+${Math.round(Math.min(P.maxHp - P.hp, P.maxHp * pct / 100))} HP)`, `HP ${Math.ceil(P.hp)}/${Math.round(P.maxHp)}`], tags: [] };
  }

  cardKey(a: 'reroll' | 'skip') { this.cardAction(a); }
  private cardAction(a: 'reroll' | 'skip') {
    if (this.cardPending) return;
    const C = this.hooks.tuning().ctx?.cards;
    if (C && !(a === 'skip' && C.source === 'swap') && (a === 'reroll' ? C.rerolls : C.skips) <= 0) { this.hooks.sound('denied'); return; }
    this.cardPending = true;
    this.hooks.sound('pick');
    this.hooks.card(a, 0);
  }

  toggleBanish() {
    if (this.cardPending) return;
    const C = this.hooks.tuning().ctx?.cards;
    if (!this.banishing && C && C.banishes <= 0) { this.hooks.sound('denied'); return; }
    this.banishing = !this.banishing;
    this.hooks.sound(this.banishing ? 'ui' : 'back');
    this.tray.querySelectorAll('.card').forEach((c) => c.classList.toggle('banishing', this.banishing));
    this.tray.querySelector('.banish-hint')?.classList.toggle('hidden', !this.banishing);
  }

  cardClick(i: number) {
    if (this.cardPending || !this.cardsShown[i]) return;
    this.cardPending = true;
    if (this.banishing) { this.banishing = false; this.hooks.card('banish', i); return; }
    this.hooks.card('pick', i);
  }

  hideCards(card?: Card | null) {
    this.tray.classList.add('hidden');
    this.tray.classList.remove('suspended');
    this.root.classList.remove('offer-open');
    this.cardPending = false;
    if (card !== undefined) {
      const message = card ? `Selected ${card.title}.` : 'Upgrade skipped.';
      this.upgradeStatus.textContent = message;
      this.upgradeFeedback.textContent = message;
      this.upgradeFeedback.classList.remove('hidden');
      clearTimeout(this.upgradeFeedbackTimer);
      this.upgradeFeedbackTimer = window.setTimeout(() => this.upgradeFeedback.classList.add('hidden'), 1600);
    } else {
      clearTimeout(this.upgradeFeedbackTimer);
      this.upgradeFeedback.classList.add('hidden');
    }
  }

  // ------------------------------------------------------------ evolution
  evolve(from: string, to: string) {
    document.getElementById('evotxt')!.textContent = `What? ${SPECIES_BY_ID[from].name} is evolving!`;
    this.show('overlay-evolve');
    void to;
  }
  evolveDone(id: string, from: string) {
    this.show('overlay-evolve', false);
    this.banner(`Congratulations! Your ${SPECIES_BY_ID[from]?.name ?? ''} evolved into ${SPECIES_BY_ID[id].name}!`, 'Stats up · fully healed', 3.2);
  }

  // ------------------------------------------------------------ menus
  pause(ctx: SimContext | null) {
    const scr = this.screens['screen-pause'];
    scr.innerHTML = '';
    scr.append(h('div', { class: 'box menu' },
      h('h2', {}, 'Paused'),
      ctx ? h('div', { class: 'statsgrid' }, ...this.statRows(ctx)) : null,
      btn('Resume', () => { this.hooks.sound('pick'); this.hooks.resume('click'); }, 'btn primary'),
      h('p', { class: 'pause-note hidden', id: 'pause-note', role: 'status', 'aria-live': 'polite' }),
      btn('Settings', () => this.openSettings('screen-pause')),
      btn('Controls', () => this.openHelp('screen-pause')),
      btn('Restart run', () => this.hooks.restart()),
      btn('Quit to title', () => this.hooks.quit()),
      btn('Tuning panel', () => this.toggleTuning(), 'btn small'),
    ));
    this.backs['screen-pause'] = () => this.hooks.resume('key');
    this.tray.classList.add('suspended'); // the tray sits under the pause menu and takes no picks while paused
    this.show('screen-pause');
    this.focusDefault('screen-pause');
  }
  /** a line under Resume in the pause menu ('' hides it): why the game is still paused */
  pauseNote(text: string) {
    const el = document.getElementById('pause-note');
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('hidden', !text);
  }
  unpause() { this.pauseNote(''); this.tray.classList.remove('suspended'); this.capture = null; this.show('screen-pause', false); this.show('screen-settings', false); this.show('screen-bindings', false); this.show('screen-help', false); this.show('screen-credits', false); }

  private statRows(ctx: SimContext) {
    const s = ctx.stats;
    const rows: [string, string][] = [
      ['Time', fmtTime(ctx.time)], ['Region', `${ctx.stage + 1}${ctx.loop ? ` (lap ${ctx.loop + 1})` : ''}`], ['Level', String(ctx.player.level)],
      ['KOs', s.kills.toLocaleString()], ['Damage dealt', Math.round(s.damageDealt).toLocaleString()], ['Damage taken', Math.round(s.damageTaken).toLocaleString()],
      ['Bosses', String(s.bosses)], ['Biggest hit', Math.round(s.maxHit).toLocaleString()], ['Seed', String(ctx.seed)],
    ];
    return rows.flatMap(([a, b]) => [h('span', {}, a), h('span', {}, b)]);
  }

  /** Phase 8b: the run's build: techniques and transforms (blueprint V2/V3 interviews ask players to describe it) */
  private buildSummary(ctx: SimContext): HTMLElement | null {
    if (!ctx.rules.build.enabled) return null;
    const P = ctx.player;
    const xfs = P.squad.flatMap((m) => m.moves.filter((s) => s.xf).map((s) => `${m.species.name}: ${MOVE_BY_KEY[s.key]?.name ?? s.key} → ${TRANSFORM_BY_ID[s.xf!].title}`));
    const techs = P.techs.map((id) => TECHNIQUE_BY_ID[id]?.title ?? id);
    if (!xfs.length && !techs.length) return null;
    return h('div', { class: 'recap build' }, h('h3', {}, 'Your build'), h('ul', {},
      h('li', {}, `Techniques: ${techs.length ? techs.join(', ') : 'none'}`),
      ...(xfs.length ? xfs.map((x) => h('li', {}, x)) : [h('li', {}, 'No transforms')])));
  }

  end(ctx: SimContext, victory: boolean) {
    const scr = this.screens['screen-end'];
    this.hideCards(); // an offer still open at the end of the run must not sit on top of the end screen
    scr.innerHTML = '';
    scr.append(h('div', { class: 'box menu end ' + (victory ? 'win' : 'lose') },
      h('h2', {}, victory ? 'All regions cleared!' : `${ctx.player.species.name} fainted!`),
      h('div', { class: 'endpic' }, copyCanvas(this.hooks.portrait(ctx.player.species.id))),
      h('div', { class: 'statsgrid' }, ...this.statRows(ctx)),
      this.buildSummary(ctx),
      // the death recap (Phase 8a): which rule decided each of the last few seconds
      !victory && ctx.recap && ctx.recap.length ? h('div', { class: 'recap' }, h('h3', {}, 'What happened'), h('ul', {}, ...ctx.recap.map((l) => h('li', {}, l)))) : null,
      btn('Try again', () => { this.hooks.sound('pick'); this.hooks.restart(); }, 'btn primary'),
      btn('Title screen', () => this.hooks.quit()),
    ));
    this.backs['screen-end'] = () => this.hooks.quit();
    this.show('screen-end');
    this.focusDefault('screen-end');
  }

  openSettings(back: string) {
    const S = this.hooks.settings;
    const scr = this.screens['screen-settings'];
    const rebuild = () => this.openSettings(back);
    scr.innerHTML = '';
    const slider = (label: string, key: 'master' | 'music' | 'volume' | 'cries') => {
      const out = h('output', {}, `${Math.round(S[key] * 100)}%`);
      const inp = h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: S[key], 'aria-label': label }) as HTMLInputElement;
      inp.oninput = () => { S[key] = Number(inp.value); out.textContent = `${Math.round(S[key] * 100)}%`; this.hooks.applySettings(); };
      return [h('label', {}, label), inp, out];
    };
    const seg = (label: string, opts: [string, string | number][], get: () => string | number, set: (v: any) => void) => {
      const g = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': label });
      for (const [name, v] of opts) {
        const b: HTMLElement = btn(name, () => { set(v); this.hooks.applySettings(); this.hooks.sound('ui'); for (const c of g.children) c.setAttribute('aria-checked', 'false'); b.setAttribute('aria-checked', 'true'); }, 'btn small', { role: 'radio', 'aria-checked': String(get() === v) });
        g.append(b);
      }
      return [h('label', {}, label), g, h('span', {})];
    };
    const toggle = (label: string, get: () => boolean, set: (v: boolean) => void) => {
      const b: HTMLElement = btn(get() ? 'On' : 'Off', () => { set(!get()); b.textContent = get() ? 'On' : 'Off'; b.setAttribute('aria-pressed', String(get())); this.hooks.applySettings(); this.hooks.sound('ui'); }, 'btn small', { 'aria-pressed': String(get()) });
      return [h('label', {}, label), b, h('span', {})];
    };
    const cams = CAMERA_PRESETS.map((p) => [p.name, p.id] as [string, string]);
    scr.append(h('div', { class: 'box menu settingsbox' },
      h('h2', {}, 'Settings'),
      h('h3', {}, 'Sound'),
      h('div', { class: 'settings' }, ...slider('Master', 'master'), ...slider('Music', 'music'), ...slider('Effects', 'volume'), ...slider('Pokémon cries', 'cries'),
        ...toggle('Mute all', () => S.muted, (v) => { S.muted = v; })),
      h('div', { class: 'row-btns' }, btn('Preview cry', () => this.hooks.preview('cry'), 'btn small'), btn('Preview effect', () => this.hooks.preview('sfx'), 'btn small'), btn('Preview music', () => this.hooks.preview('music'), 'btn small')),
      h('h3', {}, 'Controls'),
      h('div', { class: 'settings' },
        ...seg('Combat', [['Aimed', 'aimed'], ['Assist', 'assist'], ['Auto (classic)', 'auto']], () => S.combat, (v) => { S.combat = v as UISettings['combat']; }),
        h('label', {}, 'Bindings'), btn('Keys & buttons…', () => this.openBindings('screen-settings'), 'btn small'), h('span', {})),
      h('div', { class: 'settings' },
        ...seg('Look speed', [['Slow', 0.6], ['Normal', 1], ['Fast', 1.6]], () => S.sens, (v) => { S.sens = v; }),
        ...toggle('Invert look (Y)', () => S.invertY, (v) => { S.invertY = v; }),
        ...seg('Field of view', [['Narrow', -6], ['Normal', 0], ['Wide', 8]], () => S.fov, (v) => { S.fov = v; })),
      h('p', { class: 'note' }, 'Third person: the mouse (click the game to capture it) or the right stick turns the camera and aims; Esc pauses and releases the mouse. Aimed: left mouse / RT fires your basic attack along the aim (hold to repeat); Move A and Move B fire on RMB / R (LT / RB). Assist: the same buttons, but the basic attack picks the nearest enemy. Auto (classic): every move fires on its own.'),
      h('h3', {}, 'World'),
      h('div', { class: 'settings' },
        ...seg('Regions', [['Handcrafted', 'authored'], ['Generated (classic)', 'generated'], ['Pokémon locations', 'locations']], () => S.world, (v) => { S.world = v as UISettings['world']; })),
      h('div', { class: 'settings' }, ...this.mapPicker(S)),
      h('p', { class: 'note' }, 'Pokémon locations: the first region is built from Viridian Forest and the last from Mt. Moon, new for every seed (tiers, ramps, bridges, overlooks, landmarks); the others use the classic generator. Generated (classic): every region is a generated meadow-style map. Same seed, same map. Takes effect on the next run.'),
      h('h3', {}, 'Display'),
      h('div', { class: 'settings' },
        ...seg('Camera', cams, () => S.camera, (v) => { S.camera = v; }),
        // (third person never shakes: its lens is where the crosshair ray starts, docs/THIRD_PERSON.md "Camera")
        ...seg('Screen shake (fixed views)', [['Full', 1], ['Reduced', 0.35], ['Off', 0]], () => S.shake, (v) => { S.shake = v; }),
        ...toggle('Damage numbers', () => S.numbers, (v) => { S.numbers = v; })),
      h('div', { class: 'row-btns' },
        btn('Reset to defaults', () => { this.hooks.resetSettings(); this.hooks.sound('back'); this.refreshHint(); rebuild(); }, 'btn small'),
        btn('Done', () => { this.show('screen-settings', false); this.show(back); this.focusDefault(back); }, 'btn primary')),
    ));
    this.backs['screen-settings'] = () => { this.show('screen-settings', false); this.show(back); this.focusDefault(back); };
    this.show(back, false);
    this.show('screen-settings');
    this.focusDefault('screen-settings');
  }

  /** Settings → Controls → Bindings (R6c, input/bindings.ts): every action with two keyboard slots and two gamepad
   *  slots. Choose a slot, then press a key or a pad button: a code drives one action, so taking one from another action
   *  moves it (the note says from where). Esc cancels, Delete / Backspace clear the slot. Saved with the settings */
  openBindings(back: string, note = '') {
    this.bindingsBack = back;
    const S = this.hooks.settings;
    const scr = this.screens['screen-bindings'];
    scr.innerHTML = '';
    const keys = resolveBindings(DEFAULT_KEYS, S.keys), pad = resolveBindings(DEFAULT_PAD, S.pad);
    const cap = this.capture;
    const slot = (action: string, label: string, dev: 'key' | 'pad', i: number) => {
      const c = dev === 'key' ? keys[action][i] : pad[action][i];
      const waiting = !!cap && cap.action === action && cap.dev === dev && cap.slot === i;
      const name = waiting ? (dev === 'key' ? 'Press a key…' : 'Press a button…') : c === undefined ? '—' : dev === 'key' ? keyName(c as string) : padName(c as number);
      return btn(name, () => { this.capture = waiting ? null : { action, dev, slot: i }; this.hooks.sound('ui'); this.openBindings(back); },
        'btn small bind' + (waiting ? ' waiting' : ''), { 'data-bind': `${action}:${dev}:${i}`, 'aria-label': `${label}, ${dev === 'key' ? 'key' : 'gamepad button'} ${i + 1}: ${name}` });
    };
    const grid = h('div', { class: 'bindings', role: 'grid', 'aria-label': 'Bindings' },
      h('span', { class: 'bh' }, 'Action'), h('span', { class: 'bh' }, 'Keyboard'), h('span', { class: 'bh' }), h('span', { class: 'bh' }, 'Gamepad'), h('span', { class: 'bh' }));
    for (const a of ACTIONS) {
      grid.append(h('span', {}, a.label));
      for (let i = 0; i < SLOTS; i++) grid.append(slot(a.id, a.label, 'key', i));
      for (let i = 0; i < SLOTS; i++) grid.append(slot(a.id, a.label, 'pad', i));
    }
    scr.append(h('div', { class: 'box menu settingsbox bindingsbox' },
      h('h2', {}, 'Bindings'),
      h('p', { class: 'note' }, `Choose a slot, then press a key or a gamepad button. Esc cancels; Delete clears the slot. A key or button drives one action: taking it moves it here. ${RESERVED_KEYS.join(', ')} stays free for menus. Ctrl works, but Ctrl + W / S / D are browser shortcuts. The sticks (move, look) and menu navigation are fixed.`),
      h('p', { class: 'note bindnote', role: 'status', 'aria-live': 'polite' }, note),
      grid,
      h('div', { class: 'row-btns' },
        btn('Reset bindings', () => { this.capture = null; S.keys = {}; S.pad = {}; this.hooks.applySettings(); this.refreshHint(); this.hooks.sound('back'); this.openBindings(back, 'Bindings reset to the defaults.'); }, 'btn small'),
        btn('Done', () => this.closeBindings(), 'btn primary')),
    ));
    this.backs['screen-bindings'] = () => this.closeBindings();
    this.show(back, false);
    this.show('screen-bindings');
    if (cap) (scr.querySelector<HTMLElement>(`[data-bind="${cap.action}:${cap.dev}:${cap.slot}"]`))?.focus();
  }
  private closeBindings() {
    this.capture = null;
    this.show('screen-bindings', false);
    this.show(this.bindingsBack);
    this.focusDefault(this.bindingsBack);
  }
  /** the waiting slot takes `code` (null clears it); saved at once */
  private bindTo(code: string | number | null) {
    const c = this.capture;
    if (!c) return;
    const S = this.hooks.settings;
    const label = (id: string) => ACTIONS.find((a) => a.id === id)?.label ?? id;
    let from: string | null;
    if (c.dev === 'key') ({ overrides: S.keys, from } = assignBinding(DEFAULT_KEYS, S.keys, c.action, c.slot, code as string | null));
    else ({ overrides: S.pad, from } = assignBinding(DEFAULT_PAD, S.pad, c.action, c.slot, code as number | null));
    this.capture = null;
    this.hooks.applySettings();
    this.refreshHint();
    this.hooks.sound('pick');
    const name = code === null ? '' : c.dev === 'key' ? keyName(code as string) : padName(code as number);
    this.openBindings(this.bindingsBack, from ? `${name} moved from ${label(from)} to ${label(c.action)}.` : '');
    this.screens['screen-bindings'].querySelector<HTMLElement>(`[data-bind="${c.action}:${c.dev}:${c.slot}"]`)?.focus();
  }
  /** the HUD's key hint, from the keyboard bindings in use */
  refreshHint() {
    const keys = resolveBindings(DEFAULT_KEYS, this.hooks.settings.keys);
    const one = (a: string) => {
      const cs = keys[a];
      if (cs.includes('ShiftLeft') && cs.includes('ShiftRight')) return 'Shift';
      return cs.length ? keyName(cs[0]) : '—';
    };
    const kbd = (t: string) => h('kbd', {}, t);
    const H = this.hud.hint;
    H.replaceChildren(kbd(['up', 'left', 'down', 'right'].map(one).join('')), ' move  ', kbd('Mouse'), ' look + aim  ', kbd('LMB'), ' attack  ', kbd('RMB'), kbd(one('moveB')), ' moves  ',
      kbd(one('sig')), ' tag  ', kbd(one('guard')), ' guard  ', kbd(one('dash')), ' dash  ', kbd(one('jump')), ' jump  ', kbd(one('pause')), ' pause');
  }

  /** Settings → World → Map and Map seed: build every region from one Pokémon location or habitat recipe (and its
   *  surface variants), and hold the map seed to replay a layout (docs/HABITATS.md) */
  private mapPicker(S: UISettings): HTMLElement[] {
    const choices: [string, string][] = [['Default rotation', '']];
    for (const L of Object.values(LOCATIONS)) choices.push([L.name, L.id]);
    for (const R of Object.values(HABITATS)) {
      choices.push([`${R.name} (habitat)`, R.id]);
      for (const [v, V] of Object.entries(R.variants)) choices.push([`${V.name} (habitat)`, `${R.id}:${v}`]);
    }
    const sel = h('select', { 'aria-label': 'Map' }) as HTMLSelectElement;
    for (const [name, v] of choices) { const o = h('option', { value: v }, name) as HTMLOptionElement; o.selected = S.map === v; sel.append(o); }
    sel.onchange = () => { S.map = sel.value; this.hooks.applySettings(); this.hooks.sound('ui'); };
    const seed = h('input', { type: 'number', min: -1, step: 1, value: S.mapSeed, 'aria-label': 'Map seed (-1: from the run seed)' }) as HTMLInputElement;
    seed.onchange = () => { const v = Math.floor(Number(seed.value)); S.mapSeed = Number.isFinite(v) && v >= 0 ? v : -1; seed.value = String(S.mapSeed); this.hooks.applySettings(); };
    return [h('label', {}, 'Map'), sel, h('span', {}), h('label', {}, 'Map seed'), seed, h('small', {}, '-1 = from the run seed')];
  }

  /** a map that could not be generated (habitat recipes report why before any match starts) */
  error(msg: string) {
    const box = h('div', { class: 'box menu', role: 'alertdialog', style: 'position:fixed;left:50%;top:40%;transform:translate(-50%,-50%);z-index:50;max-width:520px' },
      h('h2', {}, 'Map not generated'), h('p', {}, msg),
      btn('Title screen', () => { box.remove(); this.hooks.quit(); }, 'btn primary'));
    document.body.append(box);
  }

  openHelp(back: string) {
    const scr = this.screens['screen-help'];
    scr.innerHTML = '';
    scr.append(h('div', { class: 'box menu', style: 'max-width:600px' },
      h('h2', {}, 'How to play'),
      h('div', { class: 'controls', html: `
        <p><b>Move</b> <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> / arrows / left stick · <b>Jump</b> <kbd>Space</kbd> / A (onto rocks and logs; flying partners glide) · <b>Dash</b> <kbd>Shift</kbd> / B</p>
        <p><b>Attack</b> left mouse / <kbd>J</kbd> / RT (hold to keep attacking) · <b>Move A</b> right mouse / <kbd>K</kbd> / LT · <b>Move B</b> <kbd>R</kbd> / RB · <b>Tag</b> <kbd>Q</kbd> / Y · <b>Guard</b> <kbd>E</kbd> / LB. Your Pokémon attacks where you aim; in Settings → Combat, Auto (classic) makes it attack on its own. Collect EXP Shards, level up, choose an upgrade.</p>
        <p>Upgrades stay available while combat continues. Choose directly with <kbd>1</kbd>–<kbd>3</kbd> or the D-pad left/up/right; with a card focused, arrows move focus and <kbd>Enter</kbd> confirms. <kbd>C</kbd> toggles cursor/camera control for mouse selection without pausing. <kbd>F</kbd> rerolls, <kbd>X</kbd> skips, and <kbd>Z</kbd> starts a banish (2 rerolls and 1 banish per region). Each pick shows a <b>Kit</b> card (a move to learn, or a <b>transform</b> that changes what a move does; each move has two and you keep one), a <b>Technique</b> (a rule for your whole squad, with a cost; you hold three) and a <b>Wildcard</b> (a benched Pokémon's transform, a Tag Action, an early evolution, a berry). Moves grow stronger with your level on their own.</p>
        <p>Trees, water and cliffs block the way; climb bluffs by their stairs, hop up ledges, and use groves to split a swarm. Item balls in the field hold a rare upgrade; Oran Berries heal.</p>
        <p>A boss arrives at 5:00 in each region. Defeat it and step into the portal. Partners evolve at their real levels; types and abilities follow the main games where the survival format allows.</p>
        <p>Menus: arrows / D-pad move, <kbd>Enter</kbd> / A confirm, <kbd>Esc</kbd> / B back, <kbd>Tab</kbd> also works. <kbd>Esc</kbd> / Start pauses · <kbd>M</kbd> mutes · <kbd>\`</kbd> tuning panel.</p>
        <p>These are the default keys and buttons: Settings → Controls → Bindings changes any of them.</p>` }),
      btn('Got it', () => { this.show('screen-help', false); this.show(back); this.focusDefault(back); }, 'btn primary'),
    ));
    this.backs['screen-help'] = () => { this.show('screen-help', false); this.show(back); this.focusDefault(back); };
    this.show(back, false);
    this.show('screen-help');
    this.focusDefault('screen-help');
  }

  openCredits(back: string) {
    const scr = this.screens['screen-credits'];
    scr.innerHTML = '';
    const rows = [...registry.records.values()];
    scr.append(h('div', { class: 'box menu', style: 'max-width:820px' },
      h('h2', {}, 'Credits & sources'),
      h('div', { class: 'credits', tabindex: '0' },
        h('p', {}, h('b', {}, 'Independent fan game. '), 'Poke-Watch is non-commercial and not affiliated with Nintendo, Creatures, GAME FREAK or The Pokémon Company. Pokémon names, designs, cries, items and data are © those companies.'),
        h('p', {}, h('b', {}, 'Pokémon data: '), 'PokéAPI (cross-game level-up moves, species, stats, types, evolutions, abilities and type chart). Survival balancing (damage, cooldowns, upgrade levels) is Poke-Watch\'s own and kept separate from the canonical values.'),
        h('p', {}, h('b', {}, 'Sprites & portraits: '), 'PMD SpriteCollab (CC BY-NC 4.0). Artists are credited per Pokémon below; CHUNSOFT-credited sprites come from the Pokémon Mystery Dungeon games.'),
        h('p', {}, h('b', {}, 'Cries: '), 'PokeAPI/cries, legacy recordings (the DS-era cries). Repository CC0; audio © The Pokémon Company. MP3 copies are transcodes of the same recordings.'),
        h('p', {}, h('b', {}, 'Icons: '), ICON_LICENSE + ' — Pokémon type badges and bag icons. Glyphs for EXP Shards, charms and attack shapes are original.'),
        h('p', {}, h('b', {}, 'Music: '), 'adaptive reference remix of Trainer Battle (1997–1998-M56B), composed by Junichi Masuda and arranged by Shinji Miyazaki. The original recording carries the melody; added percussion is synthesized. ', h('a', { href: 'https://www.youtube.com/watch?v=4ZrdWpWqVpQ', target: '_blank', rel: 'noopener noreferrer' }, 'Melody source'), '. This is an arrangement prototype, not a complete reorchestration. Fallback music and sound effects are original synthesis. Font: Pixelify Sans (SIL Open Font License).'),
        h('p', {}, h('b', {}, 'Game: '), 'code, arenas, environment art and effects are original; gameplay formulas are modelled on PokéBonk (no PokéBonk code or assets are used).'),
        h('table', {}, h('tr', {}, h('th', {}, 'Pokémon'), h('th', {}, 'Sprites'), h('th', {}, 'Cry'), h('th', {}, 'Animation notes')),
          ...rows.map((r) => h('tr', {}, h('td', {}, r.name), h('td', {}, r.art.source, r.art.credits.length ? h('div', {}, 'by ' + r.art.credits.join(', ')) : null),
            h('td', {}, r.cry.kind === 'sample' ? `${r.cry.era ?? ''} ${r.cry.source.split('/').pop()}`.trim() : 'synthesised'),
            h('td', { class: r.status === 'ok' ? '' : 'warn' }, r.notes.join('; ') || 'all native')))),
      ),
      btn('Close', () => { this.show('screen-credits', false); this.show(back); this.focusDefault(back); }, 'btn primary'),
    ));
    this.backs['screen-credits'] = () => { this.show('screen-credits', false); this.show(back); this.focusDefault(back); };
    this.show(back, false);
    this.show('screen-credits');
    this.focusDefault('screen-credits');
  }

  // ------------------------------------------------------------ tuning
  toggleTuning() {
    const el = this.screens['tuning'];
    const on = el.classList.contains('hidden');
    if (on) this.buildTuning();
    this.show('tuning', on);
  }

  private buildTuning() {
    const T = this.hooks.tuning();
    const el = this.screens['tuning'];
    el.innerHTML = '';
    el.append(h('div', { style: 'font-weight:700;font-size:15px' }, 'Tuning (live rules)'), h('div', { class: 'sub2' }, 'Edits apply to this run immediately. Defaults live in src/rules/defaults.ts.'));
    const groups: [string, [string, number, number, number][]][] = [
      ['Player', [['player.baseSpeed', 3, 15, 0.1], ['player.dashCooldown', 0.2, 4, 0.1], ['player.magnetRadius', 1, 20, 0.5], ['player.regenPerSec', 0, 5, 0.05], ['damage.playerMult', 0.2, 6, 0.1]]],
      ['Enemies', [['enemy.liveCap', 50, 2200, 10], ['enemy.steerRate', 1, 30, 0.5], ['enemy.knockDecay', 1, 20, 0.5], ['mode.difficulty', 0.2, 4, 0.05]]],
      ['Director', [['director.spawnBase', 0, 10, 0.1], ['director.spawnPerMin', 0, 6, 0.1], ['director.eliteEvery', 5, 120, 1], ['stage.bossAt', 10, 900, 5]]],
      ['Progression', [['xp.base', 1, 40, 0.5], ['xp.linear', 0, 15, 0.1], ['xp.exponent', 1, 2.6, 0.02], ['damage.critChance', 0, 1, 0.01], ['damage.stab', 1, 3, 0.05]]],
      ['Feel', [['sim.hitstopScale', 0, 1, 0.01], ['feel.hitstopPlayerHurt', 0, 0.5, 0.01], ['camera.lead', 0, 4, 0.1]]],
    ];
    const get = (path: string) => path.split('.').reduce((o: any, k) => o?.[k], T.rules);
    const set = (path: string, v: number) => { const ks = path.split('.'); const last = ks.pop()!; const o = ks.reduce((o: any, k) => o[k], T.rules); o[last] = v; };
    for (const [g, rows] of groups) {
      el.append(h('h4', {}, g));
      for (const [path, min, max, step] of rows) {
        const val = h('span', {}, String(get(path)));
        const inp = h('input', { type: 'range', min, max, step, value: get(path), 'aria-label': path }) as HTMLInputElement;
        inp.oninput = () => { set(path, Number(inp.value)); val.textContent = inp.value; if (path === 'enemy.liveCap' && T.ctx) T.ctx.director.liveCap = Number(inp.value); };
        el.append(h('div', { class: 'row' }, h('span', {}, path.split('.')[1]), inp, val));
      }
    }
    // play as another Pokémon: restarts this run (same mode and seed) as the chosen species; the list is the developer
    // roster (sim/playability.ts), so it grows with the registry
    const pick = h('select', { 'aria-label': 'Play as' }) as HTMLSelectElement;
    for (const r of this.hooks.roster()) {
      if (r.tier === 'unavailable') continue;
      const o = h('option', { value: r.id }, `${SPECIES_BY_ID[r.id].name}${r.tier === 'partial' ? ' (partial)' : ''}`) as HTMLOptionElement;
      if (r.id === T.ctx?.player.species.id) o.selected = true;
      pick.append(o);
    }
    // first under the heading, so it is in view without scrolling the panel
    el.children[1].after(h('h4', {}, 'Play as'), h('div', { class: 'row play-as' }, pick, btn('Restart as', () => { if (this.hooks.become(pick.value)) this.show('tuning', false); else this.hooks.sound('denied'); }, 'btn small')));
    let god = false;
    el.append(h('div', { class: 'btns' },
      btn('Spawn boss', () => T.spawnBoss(), 'btn small'),
      btn('+1 level', () => T.addLevel(), 'btn small'),
      btn('Clear wild', () => T.killAll(), 'btn small'),
      btn('God: off', function (this: HTMLElement) { god = !god; T.god(god); this.textContent = god ? 'God: on' : 'God: off'; }, 'btn small'),
      btn('Close', () => this.toggleTuning(), 'btn small'),
    ));
  }

  // ------------------------------------------------------------ damage numbers overlay
  /** the live objective: a panel under the timer, and a pointer at the screen edge when it is out of view */
  objective(ctx: SimContext, project: (x: number, y: number, z: number) => [number, number] | null, W: number, Hh: number, scale: number) {
    const H = this.hud, O = ctx.objective;
    const live = O && (O.phase === 'offer' || O.phase === 'active');
    H.obj.classList.toggle('hidden', !O);
    if (!O) return;
    const R = ctx.rules.objectives;
    const name = O.kind === 'hold' ? 'Hold the pad' : O.kind === 'hunt' ? `Hunt the marked ${SPECIES_BY_ID[O.species]?.name ?? 'Pokémon'}` : 'Carry the Egg to the goal';
    const title = O.phase === 'done' ? (O.kind === 'hunt' ? 'Hunt complete!' : O.kind === 'hold' ? 'Pad charged!' : 'Egg delivered!') : O.phase === 'failed' ? 'Objective lost' : O.phase === 'offer' ? name + (O.kind === 'hold' ? ' (step on it)' : O.kind === 'transport' ? ' (walk into it)' : '') : name;
    if (H.objTitle.textContent !== title) H.objTitle.textContent = title;
    let prog = 0;
    if (O.kind === 'hold') prog = O.charge;
    else if (O.kind === 'hunt') { const E = ctx.enemies; prog = O.target >= 0 && E.alive[O.target] ? 1 - E.hp[O.target] / E.maxHp[O.target] : 1; }
    else if (O.egg >= 0) { const B = ctx.bodies, d0 = Math.hypot(O.sx - O.x, O.sz - O.z) || 1; prog = Math.max(0, Math.min(1, 1 - Math.hypot(B.x[O.egg] - O.x, B.z[O.egg] - O.z) / d0)); }
    if (O.phase === 'done') prog = 1;
    H.objBar.style.width = Math.round(prog * 100) + '%';
    H.obj.classList.toggle('done', O.phase === 'done');
    H.obj.classList.toggle('failed', O.phase === 'failed');
    H.objTime.textContent = live ? fmtTime(Math.max(0, O.t)) : '';
    if (!live) return;
    // where it is: the pad / goal, the Hunt target, or the loose egg when nobody carries it
    let tx = O.x, tz = O.z;
    if (O.kind === 'transport' && O.egg >= 0 && O.carrier !== -2) { tx = ctx.bodies.x[O.egg]; tz = ctx.bodies.z[O.egg]; }
    const p = project(tx, ctx.world.height(tx, tz) + 1.6, tz);
    if (!p) return;
    // the overlay canvas is W x Hh internal pixels; project() gives display pixels (scale per internal pixel)
    const c = this.fx2d, x = p[0] / scale, y = p[1] / scale, w = W, hh = Hh, m = 14;
    const on = x > m && x < w - m && y > m + 24 && y < hh - m - 30;
    const color = O.kind === 'hunt' ? '#ff5a48' : O.kind === 'hold' ? '#ffd23a' : '#7cf08c';
    c.save();
    c.imageSmoothingEnabled = false;
    if (on) {
      // a bobbing pointer above it
      const by = Math.round(y - 6 + Math.sin(performance.now() / 160) * 2);
      c.fillStyle = '#20283a'; c.beginPath(); c.moveTo(x - 6, by - 7); c.lineTo(x + 6, by - 7); c.lineTo(x, by + 1); c.fill();
      c.fillStyle = color; c.beginPath(); c.moveTo(x - 4, by - 6); c.lineTo(x + 4, by - 6); c.lineTo(x, by - 1); c.fill();
    } else {
      // an arrow on the screen edge, pointing at it
      const cx = w / 2, cy = hh / 2, dx = x - cx, dy = y - cy;
      const k = Math.min((w / 2 - m) / Math.max(1e-3, Math.abs(dx)), (hh / 2 - m - 20) / Math.max(1e-3, Math.abs(dy)));
      const ax = cx + dx * k, ay = cy + dy * k, a = Math.atan2(dy, dx);
      c.translate(Math.round(ax), Math.round(ay)); c.rotate(a);
      c.fillStyle = '#20283a'; c.beginPath(); c.moveTo(9, 0); c.lineTo(-6, -8); c.lineTo(-6, 8); c.fill();
      c.fillStyle = color; c.beginPath(); c.moveTo(6, 0); c.lineTo(-4, -5); c.lineTo(-4, 5); c.fill();
    }
    c.restore();
  }

  /** third person: chevrons on the screen edge for hostiles near the Pokémon but out of frame (Renderer.threatRing);
   *  `ring` is sector 0 = ahead, clockwise. Drawn after objective(), on the same overlay. */
  threatRing(ring: Float32Array, W: number, Hh: number) {
    const c = this.fx2d, n = ring.length, m = 16;
    c.save();
    c.imageSmoothingEnabled = false;
    for (let k = 0; k < n; k++) {
      const u = ring[k];
      if (u < 0.12) continue;
      const a = (k / n) * Math.PI * 2, dx = Math.sin(a), dy = -Math.cos(a);
      const kk = Math.min((W / 2 - m) / Math.max(1e-3, Math.abs(dx)), (Hh / 2 - m - 26) / Math.max(1e-3, Math.abs(dy)));
      const s = 1 + Math.min(1, u / 4);
      c.globalAlpha = Math.min(1, 0.35 + u * 0.4);
      c.save();
      c.translate(Math.round(W / 2 + dx * kk), Math.round(Hh / 2 + dy * kk)); c.rotate(Math.atan2(dy, dx));
      c.fillStyle = '#20283a'; c.beginPath(); c.moveTo(8 * s, 0); c.lineTo(-5 * s, -7 * s); c.lineTo(-2 * s, 0); c.lineTo(-5 * s, 7 * s); c.fill();
      c.fillStyle = '#ff5a48'; c.beginPath(); c.moveTo(6 * s, 0); c.lineTo(-3 * s, -5 * s); c.lineTo(-1 * s, 0); c.lineTo(-3 * s, 5 * s); c.fill();
      c.restore();
    }
    c.restore();
  }

  /** third person (R3, decision B): while the view has left the player's own Pokémon (looking up past ~33°), a small
   *  pale-cyan marker (the x-ray silhouette's colour) on the screen edge toward it, fading in as it leaves the frame.
   *  `cue` is Renderer.selfCue: a unit screen direction (y down) and an opacity. Drawn after threatRing, on the same
   *  overlay, smaller than its chevrons and kept clear of the move bar */
  selfCue(cue: { dx: number; dy: number; alpha: number } | null, W: number, Hh: number) {
    if (!cue || cue.alpha <= 0) return;
    const c = this.fx2d, m = 12;
    const k = Math.min((W / 2 - m) / Math.max(1e-3, Math.abs(cue.dx)), (Hh / 2 - m - 34) / Math.max(1e-3, Math.abs(cue.dy)));
    c.save();
    c.imageSmoothingEnabled = false;
    c.globalAlpha = 0.85 * Math.min(1, cue.alpha);
    c.translate(Math.round(W / 2 + cue.dx * k), Math.round(Hh / 2 + cue.dy * k)); c.rotate(Math.atan2(cue.dy, cue.dx));
    // a ring with a short point: "you are this way", distinct from the hostile chevrons and the objective arrow
    c.fillStyle = '#20283a'; c.beginPath(); c.arc(-2, 0, 5, 0, Math.PI * 2); c.moveTo(7, 0); c.lineTo(0, -4); c.lineTo(0, 4); c.fill();
    c.fillStyle = '#8cf2ff'; c.beginPath(); c.arc(-2, 0, 3, 0, Math.PI * 2); c.moveTo(5, 0); c.lineTo(1, -2.5); c.lineTo(1, 2.5); c.fill();
    c.fillStyle = '#20283a'; c.beginPath(); c.arc(-2, 0, 1.2, 0, Math.PI * 2); c.fill();
    c.restore();
  }

  drawNumbers(nums: { x: number; y: number; z: number; text: string; color: string; life: number; size: number }[], project: (x: number, y: number, z: number) => [number, number] | null, W: number, H: number, scale: number) {
    const c = this.fx2d;
    const cv = c.canvas;
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; cv.style.width = W * scale + 'px'; cv.style.height = H * scale + 'px'; cv.style.imageRendering = 'pixelated'; }
    c.clearRect(0, 0, W, H);
    if (!this.hooks.settings.numbers) return;
    for (const n of nums) {
      const p = project(n.x, n.y, n.z);
      if (!p) continue;
      if (n.life < 0.2 && Math.floor(n.life * 30) % 2) continue;
      const tw = textWidth(n.text);
      const x = Math.round(p[0] / scale - tw / 2), y = Math.round(p[1] / scale - 4);
      if (n.size > 1.05) {
        const tmp = this.numCanvas;
        tmp.width = tw + 2; tmp.height = 10;
        const tg = tmp.getContext('2d')!;
        tg.clearRect(0, 0, tmp.width, tmp.height);
        outlineText(tg, n.text, 1, 1, n.color);
        c.imageSmoothingEnabled = false;
        c.drawImage(tmp, x - tw / 2, y - 5, tmp.width * 2, tmp.height * 2);
      } else outlineText(c, n.text, x, y, n.color);
    }
  }
  private numCanvas = document.createElement('canvas');

  /** pokewatch.debug('caps'): Weight badges on bodies, shots and nearby enemies, Power pips on the moves, hold
   *  tethers, and the last 3 s of capability events at the place they happened (Phase 8a). */
  capsDebug(ctx: SimContext, project: (x: number, y: number, z: number) => [number, number] | null, W: number, Hh: number, scale: number) {
    const c = this.fx2d, B = ctx.bodies, Pr = ctx.projectiles, E = ctx.enemies, P = ctx.player;
    const at = (x: number, y: number, z: number): [number, number] | null => { const p = project(x, y, z); return p ? [Math.round(p[0] / scale), Math.round(p[1] / scale)] : null; };
    const label = (t: string, x: number, y: number, z: number, color: string) => { const p = at(x, y, z); if (p && p[0] > -40 && p[0] < W + 40 && p[1] > 0 && p[1] < Hh) outlineText(c, t, p[0] - (textWidth(t) >> 1), p[1], color); };
    const team = (t: number) => (t === 1 ? '#7fd0ff' : t === 2 ? '#ff7a6a' : '#f4f0e0');
    c.save();
    c.imageSmoothingEnabled = false;
    for (let b = 0; b < B.hi; b++) {
      if (!B.alive[b]) continue;
      const T = BODY_TEMPLATES[BODY_KINDS[B.kind[b]]];
      label(`W${T.weight} ${BODY_KINDS[B.kind[b]]}${T.integrity ? ' ' + Math.max(0, Math.round(B.hp[b])) : ''}`, B.x[b], B.y[b] + T.radius * 2 + 0.6, B.z[b], team(B.team[b]));
      if (B.holdT[b] > 0) {
        const a = at(P.x, P.y + 0.8, P.z), q = at(B.x[b], B.y[b] + 0.4, B.z[b]);
        if (a && q) { c.strokeStyle = '#ffe066'; c.lineWidth = 1; c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(q[0], q[1]); c.stroke(); }
        label(`held P${B.holdP[b]} ${B.holdT[b].toFixed(1)}s`, B.x[b], B.y[b] + T.radius * 2 + 1.3, B.z[b], '#ffe066');
      }
    }
    for (let i = 0; i < Pr.hi; i++) {
      if (!Pr.alive[i] || Math.abs(Pr.x[i] - P.x) > 14 || Math.abs(Pr.z[i] - P.z) > 11) continue;
      const hostile = Pr.kind[i] === 5;
      if (!hostile && !Pr.pushP[i] && !Pr.holdP[i] && Pr.heldT[i] <= 0) continue;
      label(`${Pr.weight[i]}${Pr.pushP[i] ? ' P' + Pr.pushP[i] : ''}${Pr.holdP[i] ? ' H' + Pr.holdP[i] : ''}${Pr.heldT[i] > 0 ? ' held' : ''}`, Pr.x[i], Pr.y[i] + 0.5, Pr.z[i], hostile ? '#ff7a6a' : '#7fd0ff');
    }
    for (let e = 0; e < E.hi; e++) {
      if (!E.alive[e] || Math.abs(E.x[e] - P.x) > 9 || Math.abs(E.z[e] - P.z) > 7) continue;
      const sp = ctx.speciesIndex[E.species[e]];
      label(`W${weightClass(sp, (E.roles[e] & ROLE.boss) !== 0)}`, E.x[e], E.y[e] + E.tall[e] + 0.5, E.z[e], '#ffb0a0');
    }
    label(`W${weightClass(P.species)} guard`, P.x, P.y + P.species.height + 0.9, P.z, '#7fd0ff');
    // recent capability events where they happened, rising as they age
    const recent = ctx.caplog.since(ctx.time - 3);
    for (const r of recent) {
      if (r.tgt === 'creature' && r.verb === 'hit') continue;
      const age = ctx.time - r.t;
      const color = r.out === 'fail' ? '#ff9c5a' : r.verb === 'intercept' || r.verb === 'deflect' ? '#a8ff8a' : r.tgt === 'player' ? '#ff6a6a' : '#ffe066';
      label(debugTag(r), r.x, ctx.world.height(r.x, r.z) + 1.2 + age * 0.6, r.z, color);
    }
    // the panel (below the info box): each move's capability tags (Power pips) and the last events as text
    let y = Math.round(Hh * 0.21);
    for (let k = 0; k < P.moves.length; k++) {
      const m = P.moves[k];
      outlineText(c, `${['basic', 'A', 'B'][k] ?? k} ${m.spec.name}: ${capTags(m.spec.caps).join(' ')}`, 6, y, '#f4f0e0'); y += 9;
    }
    y += 3;
    for (const r of recent.slice(-10)) { outlineText(c, debugLine(r, ctx.time), 6, y, r.out === 'fail' ? '#ff9c5a' : '#cfe8ff'); y += 9; }
    c.restore();
  }
}

/** the partner's evolution line, base first */
function lineFrom(sp: SpeciesDef): SpeciesDef[] {
  const out = [sp];
  let cur = sp;
  while (cur.evolvesTo && SPECIES_BY_ID[cur.evolvesTo]) { cur = SPECIES_BY_ID[cur.evolvesTo]; out.push(cur); }
  return out;
}
