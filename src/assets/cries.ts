// Pokémon cries. Every species carries its latest available recorded cry (PokeAPI/cries)
// as OGG Vorbis plus an MP3 transcode for browsers without
// Vorbis decoding. Samples are decoded on audio unlock, loudness-normalised to one RMS, and
// played at their recorded pitch unless a caller asks otherwise.
//
// Fixes over the first version:
// - a cry requested before its sample is decoded is queued and plays when decoding finishes
//   (unless it went stale: more than MAX_QUEUE_S late, or a newer request replaced it);
// - a sample that can't be decoded falls back to a real synthesised voice for that species;
// - status() reports what will actually be heard, and stats count plays, queues and fallbacks.
import type { Element } from '../rules/elements';

interface SynthCry { base: number; shape: OscillatorType; notes: [number, number, number][]; vib: number }
interface SampleCry {
  kind: 'sample';
  src: string; alt?: string;
  buffer: AudioBuffer | null; pending: Promise<void> | null; gain: number;
  failed?: string; usedAlt?: boolean;
  synth: SynthCry;
}
interface SynthOnly { kind: 'synth'; synth: SynthCry }
type Cry = SampleCry | SynthOnly;
export type CryStatus = 'ready' | 'pending' | 'idle' | 'fallback' | 'synth' | 'none';
export interface CryPlayOpts { volume?: number; pitch?: number; gate?: number }

const TARGET_RMS = 0.12;
const MAX_QUEUE_S = 0.6;
const MAX_VOICES = 3;

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** a deterministic synthesised call (used when a recording is missing or can't be decoded) */
function makeSynth(id: string, height: number, element: Element): SynthCry {
  const h = hashStr(id);
  const r = (k: number) => ((h >>> (k * 4)) & 15) / 15;
  const base = (900 / Math.max(0.6, height)) * (0.8 + r(0) * 0.5);
  const shapes: Partial<Record<Element, OscillatorType>> = { blaze: 'sawtooth', tide: 'sine', bloom: 'triangle', volt: 'square', frost: 'sine', mind: 'sine', wisp: 'triangle', gloom: 'sawtooth' };
  const notes: [number, number, number][] = [];
  for (let k = 0; k < 2 + (h % 2); k++) notes.push([0.7 + r(k + 1) * 0.9, 0.5 + r(k + 3) * 1.1, 0.07 + r(k + 5) * 0.11]);
  return { base, shape: shapes[element] ?? 'triangle', notes, vib: 4 + r(6) * 14 };
}

export class CryBank {
  private cries = new Map<string, Cry>();
  private last = new Map<string, number>();
  private queued = new Map<string, { at: number; dest: AudioNode; opts: CryPlayOpts }>();
  private voices: { src: AudioScheduledSourceNode; gain: GainNode; end: number }[] = [];
  /** which source formats this browser decodes (set on first decode) */
  private preferAlt: boolean | null = null;
  /** called with the duration whenever a cry starts (the mixer ducks music under it) */
  onPlay: ((seconds: number) => void) | null = null;
  readonly stats = { played: 0, queued: 0, playedFromQueue: 0, droppedStale: 0, fallbacks: 0, synthPlayed: 0 };

  synth(id: string, height: number, element: Element) { this.cries.set(id, { kind: 'synth', synth: makeSynth(id, height, element) }); }

  /** register a recorded cry; `alt` is the MP3 transcode; height/element shape the fallback voice */
  sample(id: string, src: string, gain = 1, alt?: string, height = 1, element: Element = 'plain') {
    this.cries.set(id, { kind: 'sample', src, alt, buffer: null, pending: null, gain, synth: makeSynth(id, height, element) });
  }

  has(id: string) { return this.cries.has(id); }
  kind(id: string): 'synth' | 'sample' | 'none' { return this.cries.get(id)?.kind ?? 'none'; }
  error(id: string): string | undefined { const c = this.cries.get(id); return c?.kind === 'sample' ? c.failed : undefined; }
  /** what a play() right now would produce */
  status(id: string): CryStatus {
    const c = this.cries.get(id);
    if (!c) return 'none';
    if (c.kind === 'synth') return 'synth';
    if (c.buffer) return 'ready';
    if (c.failed) return 'fallback';
    return c.pending ? 'pending' : 'idle';
  }
  /** source actually decoded for a species ('ogg' | 'mp3' | 'synth' | 'pending') */
  format(id: string): string {
    const c = this.cries.get(id);
    if (!c || c.kind === 'synth') return 'synth';
    if (c.failed) return 'synth';
    if (!c.buffer) return 'pending';
    return c.usedAlt ? 'mp3' : 'ogg';
  }
  ids() { return [...this.cries.keys()]; }

  /** decode every sample (call once the audio context exists, e.g. on unlock) */
  async preload(ctx: AudioContext) {
    await Promise.all([...this.cries.keys()].map((id) => this.decode(ctx, id)));
  }

  private async decodeUrl(ctx: AudioContext, url: string): Promise<AudioBuffer> {
    const res = await fetch(url);
    return await ctx.decodeAudioData(await res.arrayBuffer());
  }

  private decode(ctx: AudioContext, id: string): Promise<void> {
    const c = this.cries.get(id);
    if (!c || c.kind !== 'sample' || c.buffer || c.failed) return Promise.resolve();
    if (!c.pending) {
      c.pending = (async () => {
        const order = c.alt && this.preferAlt ? [c.alt, c.src] : c.alt ? [c.src, c.alt] : [c.src];
        let lastErr = '';
        for (const url of order) {
          try {
            const buf = await this.decodeUrl(ctx, url);
            let sum = 0, n = 0;
            for (let ch = 0; ch < buf.numberOfChannels; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < d.length; i += 2) { sum += d[i] * d[i]; n++; } }
            const rms = Math.sqrt(sum / Math.max(1, n));
            c.gain *= Math.min(4, TARGET_RMS / Math.max(1e-4, rms));
            c.buffer = buf;
            c.usedAlt = url === c.alt;
            if (this.preferAlt === null) this.preferAlt = c.usedAlt;
            break;
          } catch (e) { lastErr = String((e as Error)?.message ?? e); }
        }
        if (!c.buffer) {
          c.failed = lastErr || 'decode failed';
          this.stats.fallbacks++;
          console.warn(`cry for ${id} could not be decoded (${c.failed}); using its synthesised voice`);
        }
        // play a request that arrived while decoding, if it's still fresh
        const q = this.queued.get(id);
        if (q) {
          this.queued.delete(id);
          if (ctx.currentTime - q.at <= MAX_QUEUE_S) { this.stats.playedFromQueue++; this.start(ctx, q.dest, id, c, q.opts); }
          else this.stats.droppedStale++;
        }
      })();
    }
    return c.pending;
  }

  /** play a species' cry at its recorded pitch (pitch < 1 deepens it) */
  play(ctx: AudioContext | null, dest: AudioNode | null, id: string, opts: CryPlayOpts = {}) {
    if (!ctx || !dest) return;
    const now = ctx.currentTime;
    if (now - (this.last.get(id) ?? -9) < (opts.gate ?? 0.4)) return;
    this.last.set(id, now);
    const c = this.cries.get(id);
    if (!c) return;
    if (c.kind === 'sample' && !c.buffer && !c.failed) {
      // not decoded yet: queue this request (a newer one replaces it) and make sure decoding runs
      this.queued.set(id, { at: now, dest, opts });
      this.stats.queued++;
      void this.decode(ctx, id);
      return;
    }
    this.start(ctx, dest, id, c, opts);
  }

  private start(ctx: AudioContext, dest: AudioNode, id: string, c: Cry, opts: CryPlayOpts) {
    const now = ctx.currentTime;
    const vol = opts.volume ?? 0.5, pitch = opts.pitch ?? 1;
    // voice limit: the oldest cry fades out quickly when a fourth starts
    this.voices = this.voices.filter((v) => v.end > now);
    while (this.voices.length >= MAX_VOICES) {
      const v = this.voices.shift()!;
      v.gain.gain.setTargetAtTime(0, now, 0.02);
      try { v.src.stop(now + 0.1); } catch { /* already stopped */ }
    }
    this.stats.played++;
    if (c.kind === 'sample' && c.buffer) {
      const s = ctx.createBufferSource(); s.buffer = c.buffer; s.playbackRate.value = pitch;
      const g = ctx.createGain(); g.gain.value = vol * c.gain;
      s.connect(g); g.connect(dest); s.start(now);
      const dur = c.buffer.duration / pitch;
      this.voices.push({ src: s, gain: g, end: now + dur });
      this.onPlay?.(dur);
      return;
    }
    this.stats.synthPlayed++;
    const sy = c.synth;
    const out = ctx.createGain(); out.connect(dest);
    let t = now, first: OscillatorNode | null = null;
    for (const [a, b, d] of sy.notes) {
      const o = ctx.createOscillator(); o.type = sy.shape;
      const f0 = sy.base * a * pitch, f1 = sy.base * b * pitch;
      o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + d);
      const lfo = ctx.createOscillator(); lfo.frequency.value = sy.vib; const lg = ctx.createGain(); lg.gain.value = f0 * 0.04; lfo.connect(lg); lg.connect(o.frequency);
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol * 0.22, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0008, t + d);
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 3200;
      o.connect(f); f.connect(g); g.connect(out);
      o.start(t); o.stop(t + d + 0.02); lfo.start(t); lfo.stop(t + d + 0.02);
      first ??= o;
      t += d * 0.85;
    }
    if (first) this.voices.push({ src: first, gain: out, end: t + 0.05 });
    this.onPlay?.(t - now);
  }
}

export const cries = new CryBank();
