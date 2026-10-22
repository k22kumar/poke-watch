// Maps whatever animations a source provides onto the gameplay states, following
// ANIM_FALLBACKS. Records which source (or fallback) each state resolved to so the asset
// registry can report it.
import { ANIM_FALLBACKS, ANIM_STATES, type AnimState, type Clip, type FrameRect, type Overlay } from './art';

export interface SourceAnim {
  frames: FrameRect[][]; // [dir][frame]
  durations: number[]; // seconds
  hit?: number;
}

const LOOPING: Record<AnimState, boolean> = { idle: true, walk: true, attack: false, shoot: false, charge: false, hurt: false, faint: false, sleep: true };

export function resolveClips(src: Record<string, SourceAnim>): { clips: Record<AnimState, Clip>; report: Record<AnimState, string> } {
  const clips = {} as Record<AnimState, Clip>;
  const report = {} as Record<AnimState, string>;
  // walk first: everything can fall back to it
  const order: AnimState[] = ['walk', ...ANIM_STATES.filter((s) => s !== 'walk')];
  for (const state of order) {
    let clip: Clip | null = null;
    for (const entry of ANIM_FALLBACKS[state]) {
      if (entry.startsWith('@')) {
        const base = clips.idle ?? clips.walk;
        if (!base) continue;
        const overlay = entry.slice(1) as Overlay;
        const still = base.frames.map((d) => [d[0]]);
        clip = { state, source: `${base.source}+${overlay}`, frames: still, durations: [overlay === 'bob' ? 0.5 : 0.3], loop: LOOPING[state], overlay };
        break;
      }
      const [ref, ov] = entry.split(':');
      const [name, idx] = ref.split('@');
      const a = src[name];
      if (!a || !a.frames.length || !a.frames[0].length) continue;
      if (idx !== undefined) {
        const i = Math.min(Number(idx), a.frames[0].length - 1);
        const overlay = (ov as Overlay | undefined) ?? (state === 'idle' ? 'bob' : 'none');
        clip = { state, source: ov ? `${ref}+${ov}` : entry, frames: a.frames.map((d) => [d[i]]), durations: [0.6], loop: LOOPING[state], overlay };
      } else {
        clip = { state, source: name, frames: a.frames, durations: a.durations, loop: LOOPING[state], hit: a.hit, overlay: 'none' };
      }
      break;
    }
    if (!clip) throw new Error(`no animation available for "${state}" (source has: ${Object.keys(src).join(', ') || 'nothing'})`);
    clips[state] = clip;
    report[state] = clip.source;
  }
  return { clips, report };
}
