// Move and combat sound effects. No licensed source of authentic Pokémon move sound effects is
// available to this project, so every sound here is original Web Audio synthesis (see
// docs/AUDIO.md). The design follows the games' logic instead: each move maps to a type
// "material" family (what it's made of) and an archetype "motion" (how it travels), with power
// setting weight and pitch, and a handful of representative moves get their own signature.
//
// A move's timeline: charge (during the sim's wind-up, for charged moves) → release (on cast) →
// impact (on each hit, typed by the hit's element). Crowded combat stays comfortable through a
// voice cap with priorities, per-key gating, and collapsing simultaneous impacts into one voice
// whose level grows with the log of the count.
import type { Element } from '../rules/elements';
import { MOVES } from '../rules/moves';
import { classify } from '../sim/moves';

type Filt = BiquadFilterType;
interface Layer {
  /** oscillator layer: wave, start/end frequency */
  osc?: OscillatorType; f0?: number; f1?: number;
  /** noise layer through a filter sweeping f0 → f1 */
  noise?: Filt; q?: number;
  dur: number; vol: number; attack?: number; delay?: number;
  /** vibrato depth (fraction of f0) and rate */
  vib?: number; vibRate?: number;
  /** repeat the layer n times spaced by `every` (bubbles, sparkles, crackle) */
  n?: number; every?: number; jitter?: number;
}
export interface MoveSfx { key: string; material: Element; motion: string; weight: number; pitch: number; charge: boolean; signature?: string; origin: 'original synthesis' }

// ------------------------------------------------------------------ type materials
// release = the move leaving the Pokémon; impact = it landing; charge = wind-up tint
const M: Record<Element, { release: Layer[]; impact: Layer[]; charge: Layer[] }> = {
  plain: {
    release: [{ noise: 'bandpass', f0: 900, f1: 1600, q: 1.2, dur: 0.12, vol: 0.18 }],
    impact: [{ osc: 'sine', f0: 170, f1: 55, dur: 0.12, vol: 0.32 }, { noise: 'lowpass', f0: 1400, f1: 300, dur: 0.07, vol: 0.2 }],
    charge: [{ osc: 'triangle', f0: 300, f1: 600, dur: 0.12, vol: 0.06 }],
  },
  blaze: {
    release: [{ noise: 'lowpass', f0: 700, f1: 3200, dur: 0.16, vol: 0.22 }, { noise: 'highpass', f0: 3000, f1: 3000, dur: 0.015, vol: 0.12, n: 4, every: 0.03, jitter: 0.012 }],
    impact: [{ noise: 'lowpass', f0: 1600, f1: 400, dur: 0.14, vol: 0.26 }, { noise: 'highpass', f0: 4000, f1: 4000, dur: 0.012, vol: 0.1, n: 3, every: 0.025, jitter: 0.01 }],
    charge: [{ noise: 'bandpass', f0: 400, f1: 1600, q: 2, dur: 0.12, vol: 0.1 }],
  },
  tide: {
    release: [{ noise: 'bandpass', f0: 1500, f1: 700, q: 1.5, dur: 0.15, vol: 0.2 }, { osc: 'sine', f0: 500, f1: 1100, dur: 0.035, vol: 0.08, n: 2, every: 0.05, jitter: 0.015 }],
    impact: [{ noise: 'bandpass', f0: 1100, f1: 450, q: 1, dur: 0.16, vol: 0.24 }, { osc: 'sine', f0: 160, f1: 90, dur: 0.1, vol: 0.18 }],
    charge: [{ osc: 'sine', f0: 400, f1: 900, dur: 0.05, vol: 0.06, n: 3, every: 0.04 }],
  },
  bloom: {
    release: [{ noise: 'bandpass', f0: 3200, f1: 1400, q: 2.5, dur: 0.1, vol: 0.18, n: 2, every: 0.06 }],
    impact: [{ noise: 'bandpass', f0: 2600, f1: 1800, q: 3, dur: 0.08, vol: 0.2 }, { osc: 'sine', f0: 140, f1: 70, dur: 0.07, vol: 0.14 }],
    charge: [{ osc: 'triangle', f0: 500, f1: 1000, dur: 0.14, vol: 0.05, vib: 0.03, vibRate: 18 }],
  },
  volt: {
    release: [{ osc: 'sawtooth', f0: 110, f1: 90, dur: 0.14, vol: 0.1, vib: 0.35, vibRate: 55 }, { noise: 'highpass', f0: 5000, f1: 2500, dur: 0.02, vol: 0.12, n: 3, every: 0.035, jitter: 0.015 }],
    impact: [{ noise: 'highpass', f0: 4500, f1: 2000, dur: 0.03, vol: 0.16, n: 3, every: 0.03, jitter: 0.01 }, { osc: 'square', f0: 220, f1: 110, dur: 0.06, vol: 0.06 }],
    charge: [{ osc: 'sawtooth', f0: 80, f1: 160, dur: 0.14, vol: 0.06, vib: 0.4, vibRate: 40 }],
  },
  frost: {
    release: [{ osc: 'sine', f0: 2200, f1: 2600, dur: 0.12, vol: 0.06, vib: 0.01, vibRate: 30 }, { osc: 'sine', f0: 3300, f1: 3500, dur: 0.1, vol: 0.04, delay: 0.02 }, { noise: 'highpass', f0: 6000, f1: 4000, dur: 0.08, vol: 0.06 }],
    impact: [{ osc: 'sine', f0: 3000, f1: 2900, dur: 0.05, vol: 0.08 }, { osc: 'sine', f0: 4500, f1: 4400, dur: 0.04, vol: 0.05, delay: 0.01 }, { noise: 'highpass', f0: 5000, f1: 3000, dur: 0.05, vol: 0.12 }],
    charge: [{ osc: 'sine', f0: 1500, f1: 3000, dur: 0.14, vol: 0.04 }],
  },
  brawl: {
    release: [{ noise: 'bandpass', f0: 700, f1: 1200, q: 1, dur: 0.09, vol: 0.2 }],
    impact: [{ osc: 'sine', f0: 130, f1: 45, dur: 0.11, vol: 0.38 }, { noise: 'lowpass', f0: 900, f1: 200, dur: 0.06, vol: 0.24 }],
    charge: [{ noise: 'bandpass', f0: 300, f1: 700, q: 1, dur: 0.1, vol: 0.08 }],
  },
  venom: {
    release: [{ osc: 'sine', f0: 420, f1: 200, dur: 0.05, vol: 0.1, n: 3, every: 0.04, jitter: 0.015 }, { osc: 'square', f0: 140, f1: 100, dur: 0.12, vol: 0.04, vib: 0.2, vibRate: 12 }],
    impact: [{ noise: 'lowpass', f0: 800, f1: 250, dur: 0.12, vol: 0.24 }, { osc: 'sine', f0: 300, f1: 150, dur: 0.05, vol: 0.08 }],
    charge: [{ osc: 'sine', f0: 200, f1: 350, dur: 0.05, vol: 0.06, n: 3, every: 0.04 }],
  },
  quake: {
    release: [{ osc: 'sine', f0: 70, f1: 50, dur: 0.25, vol: 0.3 }, { noise: 'lowpass', f0: 400, f1: 150, dur: 0.22, vol: 0.2 }],
    impact: [{ osc: 'sine', f0: 90, f1: 40, dur: 0.14, vol: 0.36 }, { noise: 'lowpass', f0: 600, f1: 150, dur: 0.1, vol: 0.2 }],
    charge: [{ noise: 'lowpass', f0: 150, f1: 400, dur: 0.14, vol: 0.12 }],
  },
  gale: {
    release: [{ noise: 'bandpass', f0: 400, f1: 1800, q: 1.4, dur: 0.18, vol: 0.2 }],
    impact: [{ noise: 'bandpass', f0: 1500, f1: 600, q: 1.2, dur: 0.1, vol: 0.2 }],
    charge: [{ noise: 'bandpass', f0: 300, f1: 900, q: 2, dur: 0.14, vol: 0.08 }],
  },
  mind: {
    release: [{ osc: 'sine', f0: 520, f1: 780, dur: 0.18, vol: 0.08, vib: 0.05, vibRate: 9 }, { osc: 'triangle', f0: 780, f1: 1170, dur: 0.16, vol: 0.05, delay: 0.02 }],
    impact: [{ osc: 'sine', f0: 1320, f1: 1300, dur: 0.12, vol: 0.08 }, { osc: 'sine', f0: 1980, f1: 1960, dur: 0.1, vol: 0.05 }],
    charge: [{ osc: 'sine', f0: 300, f1: 900, dur: 0.14, vol: 0.06, vib: 0.06, vibRate: 7 }],
  },
  hive: {
    release: [{ osc: 'sawtooth', f0: 190, f1: 230, dur: 0.14, vol: 0.06, vib: 0.08, vibRate: 70 }],
    impact: [{ noise: 'bandpass', f0: 3000, f1: 2500, q: 4, dur: 0.02, vol: 0.14, n: 3, every: 0.025 }],
    charge: [{ osc: 'sawtooth', f0: 150, f1: 260, dur: 0.12, vol: 0.05, vib: 0.1, vibRate: 60 }],
  },
  stone: {
    release: [{ noise: 'lowpass', f0: 600, f1: 300, dur: 0.12, vol: 0.2 }],
    impact: [{ noise: 'bandpass', f0: 1600, f1: 1200, q: 3, dur: 0.05, vol: 0.22 }, { osc: 'sine', f0: 100, f1: 50, dur: 0.12, vol: 0.32 }],
    charge: [{ noise: 'lowpass', f0: 200, f1: 600, dur: 0.12, vol: 0.12 }],
  },
  wisp: {
    release: [{ osc: 'sine', f0: 320, f1: 210, dur: 0.24, vol: 0.09, vib: 0.08, vibRate: 5 }, { osc: 'sine', f0: 327, f1: 215, dur: 0.24, vol: 0.07, vib: 0.08, vibRate: 5.5 }],
    impact: [{ noise: 'lowpass', f0: 700, f1: 300, dur: 0.14, vol: 0.18 }, { osc: 'sine', f0: 200, f1: 120, dur: 0.12, vol: 0.1 }],
    charge: [{ osc: 'sine', f0: 180, f1: 320, dur: 0.14, vol: 0.06, vib: 0.1, vibRate: 4 }],
  },
  wyrm: {
    release: [{ osc: 'sawtooth', f0: 95, f1: 70, dur: 0.24, vol: 0.12 }, { noise: 'lowpass', f0: 900, f1: 300, dur: 0.2, vol: 0.18 }],
    impact: [{ osc: 'sine', f0: 110, f1: 45, dur: 0.16, vol: 0.36 }, { noise: 'lowpass', f0: 1000, f1: 250, dur: 0.09, vol: 0.2 }],
    charge: [{ osc: 'sawtooth', f0: 60, f1: 110, dur: 0.14, vol: 0.08 }],
  },
  gloom: {
    release: [{ noise: 'bandpass', f0: 700, f1: 300, q: 1.5, dur: 0.12, vol: 0.2 }],
    impact: [{ noise: 'bandpass', f0: 1200, f1: 700, q: 2, dur: 0.03, vol: 0.2, n: 2, every: 0.04 }, { osc: 'sine', f0: 120, f1: 60, dur: 0.08, vol: 0.2 }],
    charge: [{ osc: 'sine', f0: 140, f1: 260, dur: 0.14, vol: 0.06 }],
  },
  alloy: {
    release: [{ osc: 'square', f0: 880, f1: 860, dur: 0.12, vol: 0.04 }, { osc: 'square', f0: 1320, f1: 1290, dur: 0.1, vol: 0.03 }],
    impact: [{ noise: 'bandpass', f0: 1250, f1: 1200, q: 18, dur: 0.18, vol: 0.4 }, { noise: 'bandpass', f0: 2100, f1: 2050, q: 18, dur: 0.14, vol: 0.25 }],
    charge: [{ osc: 'square', f0: 440, f1: 880, dur: 0.12, vol: 0.03 }],
  },
  fae: {
    release: [{ osc: 'sine', f0: 1568, f1: 1600, dur: 0.06, vol: 0.06, n: 3, every: 0.045 }],
    impact: [{ osc: 'sine', f0: 2093, f1: 2100, dur: 0.1, vol: 0.07 }, { osc: 'sine', f0: 2637, f1: 2640, dur: 0.08, vol: 0.05, delay: 0.03 }],
    charge: [{ osc: 'sine', f0: 1000, f1: 2000, dur: 0.12, vol: 0.04 }],
  },
};

// ------------------------------------------------------------------ archetype motions
// scale the material's release: duration, volume, pitch; sustain = extra held layer (beams, cones)
const MOTION: Record<string, { dur: number; vol: number; pitch: number; sustain?: number; repeat?: number }> = {
  strike: { dur: 0.7, vol: 1, pitch: 1.1 }, dash: { dur: 1.3, vol: 0.9, pitch: 0.9 }, spin: { dur: 1.6, vol: 0.8, pitch: 1 },
  bolt: { dur: 0.7, vol: 0.8, pitch: 1.15 }, orb: { dur: 1, vol: 0.9, pitch: 0.95 }, homing: { dur: 0.9, vol: 0.8, pitch: 1.2 },
  barrage: { dur: 0.5, vol: 0.55, pitch: 1.25, repeat: 3 }, lob: { dur: 1.3, vol: 0.9, pitch: 0.85 }, boomerang: { dur: 1.4, vol: 0.8, pitch: 1.05 },
  drain: { dur: 1.1, vol: 0.8, pitch: 1.1 }, beam: { dur: 1, vol: 0.9, pitch: 1, sustain: 0.38 }, cone: { dur: 1, vol: 0.9, pitch: 0.95, sustain: 0.3 },
  nova: { dur: 1.6, vol: 1.2, pitch: 0.75 }, vortex: { dur: 1.8, vol: 0.9, pitch: 0.85, sustain: 0.45 }, chain: { dur: 1.2, vol: 1, pitch: 1.1 },
  meteor: { dur: 1.5, vol: 1, pitch: 0.8 }, smite: { dur: 1.2, vol: 1.1, pitch: 0.9 }, trap: { dur: 1, vol: 0.7, pitch: 1 },
  orbit: { dur: 1, vol: 0.6, pitch: 1.2 }, trail: { dur: 0.8, vol: 0.5, pitch: 1 }, aura: { dur: 0.5, vol: 0.25, pitch: 1.3 },
  buff: { dur: 1.5, vol: 0.7, pitch: 1.4 }, weather: { dur: 2.2, vol: 0.7, pitch: 1.2 },
};
const CHARGED = new Set(['beam', 'chain', 'meteor', 'smite', 'vortex', 'buff', 'weather', 'nova']);

// ------------------------------------------------------------------ signature moves
// representative moves get their own release so the most-heard attacks are distinct
const SIGNATURE: Record<string, Layer[]> = {
  ember: [{ noise: 'highpass', f0: 2500, f1: 2500, dur: 0.012, vol: 0.18, n: 5, every: 0.022, jitter: 0.008 }, { noise: 'lowpass', f0: 900, f1: 2400, dur: 0.1, vol: 0.18 }],
  flamethrower: [{ noise: 'lowpass', f0: 600, f1: 1800, dur: 0.42, vol: 0.26, vib: 0, attack: 0.04 }, { noise: 'highpass', f0: 3500, f1: 3500, dur: 0.012, vol: 0.1, n: 8, every: 0.045, jitter: 0.02 }],
  fire_spin: [{ noise: 'bandpass', f0: 500, f1: 1400, q: 3, dur: 0.5, vol: 0.2, vib: 0.3, vibRate: 7 }],
  heat_wave: [{ noise: 'lowpass', f0: 300, f1: 2200, dur: 0.5, vol: 0.28, attack: 0.08 }],
  eruption: [{ osc: 'sine', f0: 80, f1: 30, dur: 0.5, vol: 0.45 }, { noise: 'lowpass', f0: 2500, f1: 200, dur: 0.45, vol: 0.32 }],
  flare_blitz: [{ noise: 'lowpass', f0: 500, f1: 3000, dur: 0.3, vol: 0.3 }, { osc: 'sawtooth', f0: 120, f1: 60, dur: 0.25, vol: 0.08 }],
  bubble: [{ osc: 'sine', f0: 700, f1: 1500, dur: 0.03, vol: 0.12, n: 4, every: 0.045, jitter: 0.02 }],
  water_gun: [{ noise: 'bandpass', f0: 2200, f1: 900, q: 1.2, dur: 0.2, vol: 0.22 }],
  water_pulse: [{ osc: 'sine', f0: 300, f1: 600, dur: 0.18, vol: 0.12, vib: 0.1, vibRate: 14 }, { noise: 'bandpass', f0: 1200, f1: 700, q: 2, dur: 0.15, vol: 0.14 }],
  hydro_pump: [{ noise: 'bandpass', f0: 1800, f1: 500, q: 0.8, dur: 0.5, vol: 0.32, attack: 0.03 }, { osc: 'sine', f0: 120, f1: 80, dur: 0.4, vol: 0.18 }],
  aqua_tail: [{ noise: 'bandpass', f0: 1400, f1: 500, q: 1, dur: 0.2, vol: 0.24 }, { osc: 'sine', f0: 180, f1: 70, dur: 0.14, vol: 0.2 }],
  vine_whip: [{ noise: 'highpass', f0: 6000, f1: 3000, dur: 0.025, vol: 0.28 }, { noise: 'bandpass', f0: 1800, f1: 3500, q: 2, dur: 0.07, vol: 0.12 }],
  razor_leaf: [{ noise: 'bandpass', f0: 3600, f1: 1800, q: 3, dur: 0.07, vol: 0.18, n: 3, every: 0.05, jitter: 0.015 }],
  magical_leaf: [{ noise: 'bandpass', f0: 3000, f1: 1600, q: 3, dur: 0.08, vol: 0.14, n: 2, every: 0.06 }, { osc: 'sine', f0: 1320, f1: 1980, dur: 0.12, vol: 0.05 }],
  petal_dance: [{ osc: 'sine', f0: 1046, f1: 1060, dur: 0.07, vol: 0.06, n: 5, every: 0.06 }, { noise: 'bandpass', f0: 2800, f1: 1600, q: 3, dur: 0.3, vol: 0.12 }],
  solar_beam: [{ osc: 'sawtooth', f0: 220, f1: 330, dur: 0.45, vol: 0.06 }, { osc: 'sine', f0: 880, f1: 990, dur: 0.45, vol: 0.06, vib: 0.02, vibRate: 12 }, { noise: 'highpass', f0: 3000, f1: 5000, dur: 0.45, vol: 0.06 }],
  seed_bomb: [{ osc: 'sine', f0: 300, f1: 500, dur: 0.12, vol: 0.12 }],
  thunder_shock: [{ osc: 'sawtooth', f0: 140, f1: 100, dur: 0.18, vol: 0.12, vib: 0.5, vibRate: 70 }, { noise: 'highpass', f0: 6000, f1: 3000, dur: 0.02, vol: 0.16, n: 4, every: 0.035, jitter: 0.015 }],
  bite: [{ noise: 'bandpass', f0: 1800, f1: 900, q: 2, dur: 0.03, vol: 0.24, n: 2, every: 0.05 }],
  crunch: [{ noise: 'bandpass', f0: 1500, f1: 700, q: 2, dur: 0.035, vol: 0.26, n: 3, every: 0.04 }],
  ice_fang: [{ noise: 'bandpass', f0: 1800, f1: 900, q: 2, dur: 0.03, vol: 0.2, n: 2, every: 0.05 }, { osc: 'sine', f0: 3000, f1: 3100, dur: 0.08, vol: 0.06, delay: 0.04 }],
  fire_fang: [{ noise: 'bandpass', f0: 1800, f1: 900, q: 2, dur: 0.03, vol: 0.2, n: 2, every: 0.05 }, { noise: 'lowpass', f0: 1000, f1: 2500, dur: 0.1, vol: 0.14, delay: 0.04 }],
  quick_attack: [{ noise: 'bandpass', f0: 1200, f1: 3600, q: 1.5, dur: 0.1, vol: 0.22 }],
  tackle: [{ noise: 'bandpass', f0: 800, f1: 1400, q: 1, dur: 0.08, vol: 0.18 }],
  scratch: [{ noise: 'highpass', f0: 3000, f1: 1500, dur: 0.05, vol: 0.18, n: 2, every: 0.04 }],
  slash: [{ noise: 'highpass', f0: 4000, f1: 1200, dur: 0.09, vol: 0.24 }],
  swift: [{ osc: 'sine', f0: 1760, f1: 2100, dur: 0.05, vol: 0.07, n: 4, every: 0.04 }],
  dragon_rage: [{ osc: 'sawtooth', f0: 110, f1: 70, dur: 0.4, vol: 0.14, vib: 0.06, vibRate: 9 }, { noise: 'lowpass', f0: 1200, f1: 400, dur: 0.35, vol: 0.2 }],
  dragon_claw: [{ noise: 'highpass', f0: 3000, f1: 900, dur: 0.1, vol: 0.24 }, { osc: 'sawtooth', f0: 100, f1: 70, dur: 0.15, vol: 0.08 }],
  flash_cannon: [{ osc: 'square', f0: 660, f1: 640, dur: 0.4, vol: 0.05 }, { noise: 'bandpass', f0: 1250, f1: 1250, q: 12, dur: 0.4, vol: 0.18 }],
  rapid_spin: [{ noise: 'bandpass', f0: 600, f1: 1800, q: 4, dur: 0.3, vol: 0.18, vib: 0.4, vibRate: 16 }],
  rollout: [{ osc: 'sine', f0: 70, f1: 110, dur: 0.35, vol: 0.3, vib: 0.2, vibRate: 10 }],
  rain_dance: [{ noise: 'highpass', f0: 4000, f1: 4000, dur: 0.01, vol: 0.08, n: 24, every: 0.03, jitter: 0.015 }],
  growth: [{ osc: 'sine', f0: 523, f1: 1046, dur: 0.4, vol: 0.07 }, { osc: 'sine', f0: 659, f1: 1318, dur: 0.38, vol: 0.05, delay: 0.04 }],
  wing_attack: [{ noise: 'bandpass', f0: 500, f1: 1500, q: 1.4, dur: 0.1, vol: 0.2, n: 2, every: 0.08 }],
  air_slash: [{ noise: 'highpass', f0: 2500, f1: 1200, dur: 0.12, vol: 0.2 }, { noise: 'bandpass', f0: 600, f1: 1600, q: 1.4, dur: 0.15, vol: 0.14 }],
  superpower: [{ osc: 'sine', f0: 90, f1: 40, dur: 0.25, vol: 0.4 }, { noise: 'lowpass', f0: 1200, f1: 200, dur: 0.18, vol: 0.26 }],
  thrash: [{ osc: 'sine', f0: 140, f1: 60, dur: 0.07, vol: 0.28, n: 3, every: 0.07 }],
};

function hashKey(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

/** the explicit mapping every move in the game resolves to (exported for docs and tests) */
export const MOVE_SFX: Record<string, MoveSfx> = Object.fromEntries(MOVES.map((m) => {
  const motion = classify(m);
  const weight = Math.max(0, Math.min(1, (m.power || 40) / 120));
  // restrained per-move variation (±4 %) so moves sharing a family aren't identical
  const pitch = (1.15 - weight * 0.3) * (0.96 + ((hashKey(m.key) % 9) / 8) * 0.08);
  return [m.key, { key: m.key, material: m.element, motion, weight, pitch, charge: CHARGED.has(motion), signature: SIGNATURE[m.key] ? m.key : undefined, origin: 'original synthesis' as const }];
}));

export type SfxPriority = 0 | 1 | 2 | 3 | 4; // 4 most important
interface Voice { end: number; pri: SfxPriority; stop: () => void }

/** voice-limited synthesis engine for one bus */
export class SfxEngine {
  private voices: Voice[] = [];
  private last = new Map<string, number>();
  private pendingImpacts = new Map<string, { n: number; crit: boolean; eff: number; t: number }>();
  maxVoices = 26;
  noise: AudioBuffer | null = null;
  readonly stats = { played: 0, gated: 0, stolen: 0, dropped: 0, collapsed: 0 };
  constructor(private ctx: AudioContext, private out: AudioNode) {
    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  /** gate: false if the same key played within `gap` s */
  gate(key: string, gap: number) {
    const t = this.ctx.currentTime, l = this.last.get(key) ?? -9;
    if (t - l < gap) { this.stats.gated++; return false; }
    this.last.set(key, t); return true;
  }

  private admit(pri: SfxPriority, dur: number, stop: () => void) {
    const now = this.ctx.currentTime;
    this.voices = this.voices.filter((v) => v.end > now);
    if (this.voices.length >= this.maxVoices) {
      // steal the oldest voice of lower priority, else drop this sound
      let idx = -1;
      for (let i = 0; i < this.voices.length; i++) if (this.voices[i].pri < pri && (idx < 0 || this.voices[i].end < this.voices[idx].end)) idx = i;
      if (idx < 0) { this.stats.dropped++; return false; }
      this.voices[idx].stop(); this.voices.splice(idx, 1); this.stats.stolen++;
    }
    this.voices.push({ end: now + dur, pri, stop });
    return true;
  }
  activeVoices() { const now = this.ctx.currentTime; return this.voices.filter((v) => v.end > now).length; }

  /** play a set of layers; pitch multiplies frequencies (and filter sweeps), vol scales levels */
  layers(L: Layer[], opts: { pitch?: number; vol?: number; durMul?: number; when?: number; pri?: SfxPriority } = {}) {
    const c = this.ctx;
    const pitch = opts.pitch ?? 1, vm = opts.vol ?? 1, dm = opts.durMul ?? 1;
    const t0 = c.currentTime + (opts.when ?? 0);
    let total = 0;
    for (const l of L) total = Math.max(total, (l.delay ?? 0) + (l.n ?? 1) * (l.every ?? 0) + l.dur * dm);
    const stops: AudioScheduledSourceNode[] = [];
    const bus = c.createGain(); bus.connect(this.out);
    if (!this.admit(opts.pri ?? 2, total + 0.05, () => { bus.gain.setTargetAtTime(0, c.currentTime, 0.015); for (const s of stops) try { s.stop(c.currentTime + 0.06); } catch { /* ok */ } })) { bus.disconnect(); return 0; }
    this.stats.played++;
    for (const l of L) {
      const n = l.n ?? 1;
      for (let k = 0; k < n; k++) {
        const t = t0 + (l.delay ?? 0) + k * (l.every ?? 0) + (l.jitter ? (Math.random() - 0.5) * 2 * l.jitter : 0);
        const d = l.dur * dm;
        const g = c.createGain();
        const a = l.attack ?? 0.004;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(l.vol * vm, t + a);
        g.gain.exponentialRampToValueAtTime(0.0006, t + Math.max(a + 0.01, d));
        g.connect(bus);
        if (l.osc) {
          const o = c.createOscillator(); o.type = l.osc;
          o.frequency.setValueAtTime((l.f0 ?? 440) * pitch, t);
          o.frequency.exponentialRampToValueAtTime(Math.max(20, (l.f1 ?? l.f0 ?? 440) * pitch), t + d);
          if (l.vib) { const lfo = c.createOscillator(); lfo.frequency.value = l.vibRate ?? 8; const lg = c.createGain(); lg.gain.value = (l.f0 ?? 440) * pitch * l.vib; lfo.connect(lg); lg.connect(o.frequency); lfo.start(t); lfo.stop(t + d + 0.02); stops.push(lfo); }
          o.connect(g); o.start(t); o.stop(t + d + 0.02); stops.push(o);
        } else if (l.noise && this.noise) {
          const s = c.createBufferSource(); s.buffer = this.noise;
          const f = c.createBiquadFilter(); f.type = l.noise; f.Q.value = l.q ?? 0.8;
          f.frequency.setValueAtTime(Math.min(16000, (l.f0 ?? 1000) * pitch), t);
          f.frequency.exponentialRampToValueAtTime(Math.min(16000, Math.max(30, (l.f1 ?? l.f0 ?? 1000) * pitch)), t + d);
          if (l.vib) { const lfo = c.createOscillator(); lfo.frequency.value = l.vibRate ?? 8; const lg = c.createGain(); lg.gain.value = (l.f0 ?? 1000) * l.vib; lfo.connect(lg); lg.connect(f.frequency); lfo.start(t); lfo.stop(t + d + 0.02); stops.push(lfo); }
          s.connect(f); f.connect(g); s.start(t, Math.random() * 0.6); s.stop(t + d + 0.02); stops.push(s);
        }
      }
    }
    return total;
  }

  /** wind-up tint for charged moves */
  charge(key: string, dur: number) {
    const m = MOVE_SFX[key];
    if (!m || !m.charge || !this.gate('ch:' + key, 0.15)) return;
    this.layers(M[m.material].charge, { pitch: m.pitch, durMul: Math.max(0.6, dur / 0.12), vol: 0.9, pri: 2 });
  }

  /** the move leaving the Pokémon */
  release(key: string, fallbackArch: string, element: Element) {
    const m = MOVE_SFX[key] ?? { key, material: element, motion: fallbackArch, weight: 0.4, pitch: 1, charge: false, origin: 'original synthesis' as const };
    if (!this.gate('rel:' + key, 0.06)) return;
    const mo = MOTION[m.motion] ?? MOTION.bolt;
    const sig = SIGNATURE[key];
    const vol = mo.vol * (0.75 + m.weight * 0.45);
    if (sig) this.layers(sig, { pitch: mo.pitch * (0.96 + m.weight * 0.08), vol, pri: 3 });
    else {
      const reps = mo.repeat ?? 1;
      for (let k = 0; k < reps; k++) this.layers(M[m.material].release, { pitch: m.pitch * mo.pitch, vol: vol * (k ? 0.7 : 1), durMul: mo.dur, when: k * 0.06, pri: 3 });
      if (mo.sustain) this.layers([{ noise: 'bandpass', f0: 900, f1: 600, q: 1.5, dur: mo.sustain, vol: 0.06, attack: 0.03 }, ...M[m.material].release.slice(0, 1).map((l) => ({ ...l, dur: mo.sustain!, vol: l.vol * 0.6, attack: 0.03 }))], { pitch: m.pitch, vol, pri: 2 });
    }
  }

  /**
   * a hit landing. Impacts arriving in the same ~40 ms on the same element collapse into one
   * voice whose level grows with log2 of the count (swarms stay readable, not deafening).
   */
  impact(element: Element, crit: boolean, eff: number) {
    const k = 'imp:' + element;
    const now = this.ctx.currentTime;
    const p = this.pendingImpacts.get(k);
    if (p && now - p.t < 0.04) { p.n++; p.crit ||= crit; p.eff = Math.max(p.eff, eff); this.stats.collapsed++; return; }
    this.pendingImpacts.set(k, { n: 1, crit, eff, t: now });
    // schedule on the next tick so collapsed hits can join
    setTimeout(() => {
      const q = this.pendingImpacts.get(k);
      if (!q) return;
      this.pendingImpacts.delete(k);
      const vol = (0.55 + Math.min(1, Math.log2(q.n + 1) / 4)) * (q.eff > 1 ? 1.15 : q.eff < 1 && q.eff > 0 ? 0.7 : 1);
      if (q.eff === 0) { this.layers([{ osc: 'sine', f0: 400, f1: 380, dur: 0.06, vol: 0.05 }], { pri: 1 }); return; }
      this.layers(M[element].impact, { vol, pitch: q.eff > 1 ? 1.08 : q.eff < 1 ? 0.88 : 1, pri: 2 });
      if (q.crit) this.layers([{ noise: 'highpass', f0: 5000, f1: 2500, dur: 0.05, vol: 0.18 }, { osc: 'square', f0: 1400, f1: 900, dur: 0.05, vol: 0.05 }], { pri: 3 });
      if (q.eff > 1) this.layers([{ osc: 'triangle', f0: 880, f1: 1320, dur: 0.07, vol: 0.05 }], { pri: 2 });
    }, 16);
  }
}

export { M as MATERIALS, MOTION, SIGNATURE };
