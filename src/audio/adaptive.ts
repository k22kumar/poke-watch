type ScoreState = 'anticipation' | 'combat' | 'surge' | 'climax';
export type ScoreCue = 'victory' | 'defeat' | 'accent';
interface ScoreStem {
  id: string; src: string; gain: Record<ScoreState, number>;
}
export interface AdaptiveScore {
  title: string; duration: number; boundaries: number[];
  stems: ScoreStem[];
  cues: Partial<Record<ScoreCue, string>>;
}
export interface CombatMusicInput {
  inRun: boolean; enemiesNear: number; enemies: number; boss: boolean;
  health?: number; objective?: boolean;
}

const rank: ScoreState[] = ['anticipation', 'combat', 'surge', 'climax'];
/** Hysteresis keeps momentary enemy-count changes from flickering the orchestration. */
export class ScoreDirector {
  state: ScoreState = 'anticipation';
  private candidate: ScoreState = this.state;
  private held = 0;
  private accent = 0;
  emphasize(seconds = 8) { this.accent = Math.max(this.accent, seconds); }
  reset() { this.state = this.candidate = 'anticipation'; this.held = this.accent = 0; }
  update(dt: number, info: CombatMusicInput): ScoreState {
    if (!info.inRun) return this.state;
    this.accent = Math.max(0, this.accent - dt);
    const danger = info.enemiesNear > 0 && (info.health ?? 1) < 0.3;
    const desired: ScoreState = info.boss || this.accent > 0 ? 'climax'
      : info.enemiesNear >= 12 || danger || (info.objective && info.enemiesNear >= 6) ? 'surge'
      : info.enemiesNear >= 3 || info.objective ? 'combat' : 'anticipation';
    if (desired !== this.candidate) { this.candidate = desired; this.held = 0; }
    this.held += Math.max(0, dt);
    const rising = rank.indexOf(desired) > rank.indexOf(this.state);
    if (this.held >= (desired === 'climax' ? 0 : rising ? 1.25 : 6)) this.state = desired;
    return this.state;
  }
}

/** Find an authored phrase/bar boundary without rounding the reference recording's tempo. */
export function nextScoreBoundary(now: number, start: number, duration: number, boundaries: number[], lead = 0.06) {
  const target = Math.max(start, now + lead);
  const cycle = Math.max(0, Math.floor((target - start) / duration));
  const phase = target - start - cycle * duration;
  const boundary = boundaries.find((time) => time >= phase);
  return start + cycle * duration + (boundary ?? duration);
}

export function validateScore(score: AdaptiveScore) {
  if (!Number.isFinite(score.duration) || score.duration <= 0) throw new Error('Invalid score duration');
  if (!score.stems.length || score.boundaries[0] !== 0) throw new Error('Score needs stems and an initial boundary');
  if (new Set(score.stems.map((s) => s.id)).size !== score.stems.length) throw new Error('Duplicate score stem');
  score.boundaries.forEach((time, i) => {
    if (!Number.isFinite(time) || time < 0 || time >= score.duration || (i > 0 && time <= score.boundaries[i - 1])) throw new Error('Invalid score boundaries');
  });
  for (const stem of score.stems) for (const state of rank) {
    if (!Number.isFinite(stem.gain[state]) || stem.gain[state] < 0 || stem.gain[state] > 1) throw new Error(`Invalid gain: ${stem.id}/${state}`);
  }
}

/** All stems share one clock and loop; changing intensity never restarts the melody. */
export class AdaptivePlayer {
  readonly out: GainNode;
  private buffers = new Map<string, AudioBuffer>();
  private cues = new Map<ScoreCue, AudioBuffer>();
  private voices: { source: AudioBufferSourceNode; gain: GainNode; stem: ScoreStem }[] = [];
  private cueVoices = new Set<AudioBufferSourceNode>();
  private startTime = 0;
  private current: ScoreState = 'anticipation';
  private pending?: { state: ScoreState; at: number };
  ready = false;
  get playing() { return this.voices.length > 0; }
  get state() { return this.current; }
  constructor(private ctx: AudioContext, destination: AudioNode, readonly score: AdaptiveScore) {
    validateScore(score);
    this.out = ctx.createGain(); this.out.connect(destination);
  }
  async load() {
    // the score's files are fetched one at a time and at low priority (docs/ROADMAP.md "Item 3: A1 plan"): about 10 MB
    // that must not crowd out a match's Pokémon art, which the match waits for; decoding still overlaps the next fetch
    let queue: Promise<unknown> = Promise.resolve();
    const decode = async (src: string) => {
      const got = queue.then(() => fetch(src, { priority: 'low' } as RequestInit)).then(async (response) => {
        if (!response.ok) throw new Error(`Score audio failed: ${response.status}`);
        return response.arrayBuffer();
      });
      queue = got.catch(() => undefined);
      return this.ctx.decodeAudioData(await got);
    };
    // Do not activate a half-loaded score; the existing score remains the fallback.
    const stems = await Promise.all(this.score.stems.map(async (stem) => {
      const buffer = await decode(stem.src);
      if (Math.abs(buffer.duration - this.score.duration) > 0.12) throw new Error(`Misaligned score stem: ${stem.id}`);
      return [stem.id, buffer] as const;
    }));
    const cues = await Promise.all(Object.entries(this.score.cues).map(async ([key, src]) => [key as ScoreCue, await decode(src)] as const));
    this.buffers = new Map(stems); this.cues = new Map(cues); this.ready = true;
  }
  start(state: ScoreState = 'anticipation') {
    if (!this.ready || this.playing) return;
    this.cancelCues();
    this.current = state; this.pending = undefined;
    this.startTime = this.ctx.currentTime + 0.08;
    this.out.gain.cancelScheduledValues(this.ctx.currentTime);
    this.out.gain.setValueAtTime(0, this.ctx.currentTime);
    this.out.gain.linearRampToValueAtTime(1, this.startTime + 0.5);
    this.voices = this.score.stems.map((stem) => {
      const source = this.ctx.createBufferSource(); source.buffer = this.buffers.get(stem.id)!;
      source.loop = true; source.loopStart = 0; source.loopEnd = this.score.duration;
      const gain = this.ctx.createGain(); gain.gain.value = stem.gain[state];
      source.connect(gain); gain.connect(this.out);
      source.onended = () => { source.disconnect(); gain.disconnect(); };
      source.start(this.startTime);
      return { source, gain, stem };
    });
  }
  setState(state: ScoreState) {
    if (!this.playing || state === (this.pending?.state ?? this.current)) return;
    // Only the pump commits automation, so changing a pending request cannot leave stale ramps.
    if (state === this.current) { this.pending = undefined; return; }
    this.pending = { state, at: nextScoreBoundary(this.ctx.currentTime, this.startTime, this.score.duration, this.score.boundaries) };
  }
  pump() {
    const next = this.pending;
    if (!next || next.at > this.ctx.currentTime + 0.12) return;
    // If a background tab missed the boundary, wait for a fresh musical boundary.
    if (next.at < this.ctx.currentTime) {
      next.at = nextScoreBoundary(this.ctx.currentTime, this.startTime, this.score.duration, this.score.boundaries);
      return;
    }
    for (const voice of this.voices) {
      voice.gain.gain.cancelScheduledValues(next.at);
      voice.gain.gain.setTargetAtTime(voice.stem.gain[next.state], next.at, 0.18);
    }
    this.current = next.state; this.pending = undefined;
  }
  stop(fade = 0.35) {
    const at = this.ctx.currentTime;
    this.pending = undefined;
    // Each retiring voice has its own fader; restarting immediately cannot revive it.
    for (const voice of this.voices) {
      voice.gain.gain.cancelScheduledValues(at);
      voice.gain.gain.setTargetAtTime(0, at, Math.max(0.01, fade / 4));
      voice.source.stop(at + fade + 0.02);
    }
    this.voices = [];
  }
  cue(kind: ScoreCue, resolve = false): boolean {
    const buffer = this.cues.get(kind);
    if (!buffer) return false;
    this.cancelCues();
    const at = this.ctx.currentTime + 0.04;
    if (resolve) this.stop(0.3);
    const source = this.ctx.createBufferSource(); source.buffer = buffer;
    source.connect(this.out); source.start(at); this.cueVoices.add(source);
    source.onended = () => { source.disconnect(); this.cueVoices.delete(source); };
    if (!resolve) {
      this.out.gain.cancelScheduledValues(at);
      this.out.gain.setTargetAtTime(0.65, at, 0.02);
      this.out.gain.setTargetAtTime(1, at + buffer.duration, 0.2);
    }
    return true;
  }
  cancelCues() {
    for (const source of this.cueVoices) { try { source.stop(); } catch { /* already ended */ } }
    this.cueVoices.clear();
    this.out.gain.cancelScheduledValues(this.ctx.currentTime);
    this.out.gain.setTargetAtTime(1, this.ctx.currentTime, 0.02);
  }
}
