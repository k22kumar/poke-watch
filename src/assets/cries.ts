// Pokémon cries. Every species carries its latest available recorded cry (PokeAPI/cries)
// as OGG Vorbis plus an MP3 transcode for browsers without
// Vorbis decoding. Samples are decoded on audio unlock, loudness-normalised to one RMS, and
// played at their recorded pitch unless a caller asks otherwise.
//
// Fixes over the first version:
// - a cry requested before its sample is decoded is queued and plays when decoding finishes
//   (unless it went stale: more than MAX_QUEUE_S late, or a newer request replaced it);
// - status() reports what will actually be heard, and stats count plays, queues and failures.
//
// Recordings only (docs/hero-shooter-pivot.md Q51): a species with no cry, or one whose sample
// can't be decoded, is silent. There is no synthesised fallback voice.

interface Cry {
  src: string; alt?: string;
  buffer: AudioBuffer | null; pending: Promise<void> | null; gain: number;
  failed?: string; usedAlt?: boolean;
}
export type CryStatus = 'ready' | 'pending' | 'idle' | 'failed' | 'none';
export interface CryPlayOpts { volume?: number; pitch?: number; gate?: number }

const TARGET_RMS = 0.12;
const MAX_QUEUE_S = 0.6;
const MAX_VOICES = 3;

export class CryBank {
  private cries = new Map<string, Cry>();
  private last = new Map<string, number>();
  private queued = new Map<string, { at: number; dest: AudioNode; opts: CryPlayOpts }>();
  private voices: { src: AudioScheduledSourceNode; gain: GainNode; end: number }[] = [];
  /** which source formats this browser decodes (set on first decode) */
  private preferAlt: boolean | null = null;
  /** called with the duration whenever a cry starts (the mixer ducks music under it) */
  onPlay: ((seconds: number) => void) | null = null;
  readonly stats = { played: 0, queued: 0, playedFromQueue: 0, droppedStale: 0, failures: 0 };

  /** register a recorded cry; `alt` is the MP3 transcode */
  sample(id: string, src: string, gain = 1, alt?: string) {
    this.cries.set(id, { src, alt, buffer: null, pending: null, gain });
  }

  has(id: string) { return this.cries.has(id); }
  kind(id: string): 'sample' | 'none' { return this.cries.has(id) ? 'sample' : 'none'; }
  error(id: string): string | undefined { return this.cries.get(id)?.failed; }
  /** what a play() right now would produce ('failed' and 'none' are silent) */
  status(id: string): CryStatus {
    const c = this.cries.get(id);
    if (!c) return 'none';
    if (c.buffer) return 'ready';
    if (c.failed) return 'failed';
    return c.pending ? 'pending' : 'idle';
  }
  /** source actually decoded for a species ('ogg' | 'mp3' | 'pending' | 'none') */
  format(id: string): string {
    const c = this.cries.get(id);
    if (!c || c.failed) return 'none';
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
    if (!c || c.buffer || c.failed) return Promise.resolve();
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
          this.stats.failures++;
          console.warn(`cry for ${id} could not be decoded (${c.failed}); it stays silent`);
        }
        // play a request that arrived while decoding, if it's still fresh
        const q = this.queued.get(id);
        if (q) {
          this.queued.delete(id);
          if (c.buffer && ctx.currentTime - q.at <= MAX_QUEUE_S) { this.stats.playedFromQueue++; this.start(ctx, q.dest, c, q.opts); }
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
    if (!c || c.failed) return;
    if (!c.buffer) {
      // not decoded yet: queue this request (a newer one replaces it) and make sure decoding runs
      this.queued.set(id, { at: now, dest, opts });
      this.stats.queued++;
      void this.decode(ctx, id);
      return;
    }
    this.start(ctx, dest, c, opts);
  }

  private start(ctx: AudioContext, dest: AudioNode, c: Cry, opts: CryPlayOpts) {
    const now = ctx.currentTime;
    const vol = opts.volume ?? 0.5, pitch = opts.pitch ?? 1;
    // voice limit: the oldest cry fades out quickly when a fourth starts
    this.voices = this.voices.filter((v) => v.end > now);
    while (this.voices.length >= MAX_VOICES) {
      const v = this.voices.shift()!;
      v.gain.gain.setTargetAtTime(0, now, 0.02);
      try { v.src.stop(now + 0.1); } catch { /* already stopped */ }
    }
    if (!c.buffer) return;
    this.stats.played++;
    const s = ctx.createBufferSource(); s.buffer = c.buffer; s.playbackRate.value = pitch;
    const g = ctx.createGain(); g.gain.value = vol * c.gain;
    s.connect(g); g.connect(dest); s.start(now);
    const dur = c.buffer.duration / pitch;
    this.voices.push({ src: s, gain: g, end: now + dur });
    this.onPlay?.(dur);
  }
}

export const cries = new CryBank();
