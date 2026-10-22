// Creature art model shared by every sprite source. Whatever a creature's art comes from —
// a baked Poke-Watch design, or a PMD SpriteCollab sheet imported into a creature pack — it is
// normalised into one atlas plus named clips, so the renderer, UI and animation controller
// never care where it came from.
//
// Conventions (see docs/ART_BIBLE.md):
// - 1 texel = 1/16 m in the world, so every source shares one pixel density.
// - 8 directions, PMD order: 0 down (toward camera), 1 down-right, 2 right, 3 up-right,
//   4 up, 5 up-left, 6 left, 7 down-left. Direction = round(facing / 45°) with facing =
//   atan2(vx, vz) and the camera locked looking north.
// - Each frame carries its own anchor: the texel under the creature's feet.

export const TEXELS_PER_METRE = 16;
export const DIRS = 8;

export type AnimState = 'idle' | 'walk' | 'attack' | 'shoot' | 'charge' | 'hurt' | 'faint' | 'sleep';
export const ANIM_STATES: AnimState[] = ['idle', 'walk', 'attack', 'shoot', 'charge', 'hurt', 'faint', 'sleep'];

/** Procedural overlays used when a source has no matching animation. */
export type Overlay = 'none' | 'bob' | 'lunge' | 'flash' | 'dissolve' | 'sink';

export interface FrameRect {
  x: number; y: number; w: number; h: number; // texel rect inside the atlas (y down)
  ax: number; ay: number; // anchor (feet) inside the rect, texels from its top-left
}

export interface Clip {
  state: AnimState;
  /** where the frames came from: a PMD anim name ("Walk"), "baked:walk", or "Walk@0" for a single frame */
  source: string;
  frames: FrameRect[][]; // [dir][frame]
  durations: number[]; // seconds per frame
  loop: boolean;
  /** frame index on which an attack connects (PMD HitFrame) */
  hit?: number;
  /** procedural motion layered on top (fallbacks) */
  overlay: Overlay;
}

export interface CreatureArt {
  id: string;
  kind: 'baked' | 'pmd';
  atlas: HTMLCanvasElement;
  clips: Record<AnimState, Clip>;
  /** visible height of the idle/walk pose in texels (for UI sizing and hit-height) */
  heightPx: number;
  /** PMD shadow size class 0 small · 1 medium · 2 large */
  shadowSize: number;
  portrait: HTMLCanvasElement;
  credits?: string[];
  license?: string;
  sourceUrl?: string;
}

/**
 * Fallback chains, in priority order. Entries are source animation names; `Name@i` uses a
 * single frame; `@overlay` reuses the current base clip with a procedural overlay.
 * Editing this table changes how every imported creature maps onto gameplay states.
 */
export const ANIM_FALLBACKS: Record<AnimState, string[]> = {
  idle: ['Idle', 'Walk@0', '@bob'],
  walk: ['Walk', 'Idle'],
  attack: ['Attack', 'Strike', 'Swing', 'Double', 'Kick', '@lunge'],
  shoot: ['Shoot', 'Charge', 'Attack', '@lunge'],
  charge: ['Charge', 'Shoot', 'Attack', '@lunge'],
  hurt: ['Hurt', 'Pain', 'Cringe', '@flash'],
  // no Faint clip: hold the Sleep pose (lying, eyes shut) and sink into the ground with a flash,
  // like a Gen 4 battle faint; Hurt frames carry pain marks, so they're only the last resort
  faint: ['Faint', 'Sleep@0:sink', 'Hurt@0:sink', 'Walk@0:sink'],
  sleep: ['Sleep', 'EventSleep', 'Laying', 'Idle', '@bob'],
};

/** The PMD animation that natively provides each gameplay state; anything else is a substitute. */
export const NATIVE_CLIP: Record<AnimState, string> = { idle: 'Idle', walk: 'Walk', attack: 'Attack', shoot: 'Shoot', charge: 'Charge', hurt: 'Hurt', faint: 'Faint', sleep: 'Sleep' };

/** seconds from the start of a clip to its HitFrame (or 40 % in when it has none) */
export function hitTime(c: Clip): number {
  if (c.hit === undefined || c.hit <= 0) return clipLength(c) * 0.4;
  let t = 0;
  for (let i = 0; i < Math.min(c.hit, c.durations.length); i++) t += c.durations[i];
  return t;
}

/** Gameplay archetype -> the clip a caster plays when it fires. */
export const CAST_CLIP: Record<string, AnimState> = {
  strike: 'attack', dash: 'attack', cone: 'attack', nova: 'attack', spin: 'attack', aura: 'charge',
  homing: 'shoot', orb: 'shoot', bolt: 'shoot', barrage: 'shoot', lob: 'shoot', boomerang: 'shoot', beam: 'shoot',
  chain: 'charge', vortex: 'charge', meteor: 'charge', smite: 'charge', drain: 'shoot', orbit: 'charge', trail: 'attack',
  trap: 'charge', buff: 'charge', weather: 'charge',
};

export function clipLength(c: Clip): number {
  let t = 0;
  for (const d of c.durations) t += d;
  return t;
}

/** frame index at time t (seconds) for a clip */
export function frameAt(c: Clip, t: number): number {
  const n = c.durations.length;
  if (n <= 1) return 0;
  const L = clipLength(c);
  let u = c.loop ? ((t % L) + L) % L : Math.min(t, L - 1e-6);
  for (let i = 0; i < n; i++) { u -= c.durations[i]; if (u < 0) return i; }
  return n - 1;
}

/** 8-way direction index from a facing angle (atan2(vx, vz)), camera looking north */
export function dirIndex(facing: number): number {
  return ((Math.round(facing / (Math.PI / 4)) % DIRS) + DIRS) % DIRS;
}

/** Build a canvas from RGBA pixels (top-down rows). */
export function canvasFrom(w: number, h: number, rgba: Uint8ClampedArray | Uint8Array): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  const img = g.createImageData(w, h);
  img.data.set(rgba);
  g.putImageData(img, 0, 0);
  return c;
}

/** Copy one frame of a clip into its own canvas (portraits, previews). */
export function frameCanvas(art: CreatureArt, state: AnimState, dir = 0, frame = 0, scale = 1): HTMLCanvasElement {
  const f = art.clips[state].frames[dir][Math.min(frame, art.clips[state].frames[dir].length - 1)];
  const c = document.createElement('canvas');
  c.width = f.w * scale; c.height = f.h * scale;
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  g.drawImage(art.atlas, f.x, f.y, f.w, f.h, 0, 0, f.w * scale, f.h * scale);
  return c;
}
