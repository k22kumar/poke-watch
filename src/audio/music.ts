// Music: original compositions (not Pokémon recordings; see docs/AUDIO.md) arranged for a
// DS-era chip palette, a sample-accurate sequencer with explicit loop points, and slots for
// licensed recordings (src/content/music.json, built from content/music/manifest.json) that
// replace a state's track without code changes.
//
// Notation: one token per eighth-note step (or sixteenth when steps = 16). "C5" starts a note,
// "-" holds the previous note, "." is a rest. Chords are one symbol per bar. Drums: K kick,
// S snare, H hat, O open hat, "." rest.

export type Instrument = 'pulse' | 'pulse2' | 'tri' | 'bell' | 'pad' | 'flute';
export interface TrackDef {
  id: string; title: string; bpm: number; steps: 8 | 16;
  /** bars [0, loopStart) play once (intro); [loopStart, bars) loop forever */
  loopStart: number;
  lead: string[]; leadInst: Instrument;
  harm?: string[]; harmInst?: Instrument;
  chords: string[];
  bass: 'pump' | 'walk' | 'root' | 'octave' | 'ostinato';
  drums: string[]; // one pattern per bar (cycled)
  /** extra layer faded in by intensity (swarm) */
  layer?: { lead: string[]; inst: Instrument; drums?: string[] };
  transpose?: number;
  stinger?: boolean; // plays once, no loop
  gain?: number;
}

const NOTE: Record<string, number> = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
export function midi(tok: string): number {
  const m = tok.match(/^([A-G][#b]?)(-?\d)$/);
  if (!m) throw new Error('bad note ' + tok);
  return NOTE[m[1]] + 12 * (Number(m[2]) + 1);
}
const CHORD_Q: Record<string, number[]> = { '': [0, 4, 7], m: [0, 3, 7], 7: [0, 4, 7, 10], m7: [0, 3, 7, 10], maj7: [0, 4, 7, 11], sus4: [0, 5, 7], dim: [0, 3, 6] };
export function chordNotes(sym: string): number[] {
  const m = sym.match(/^([A-G][#b]?)(.*)$/)!;
  const root = NOTE[m[1]] + 48;
  return (CHORD_Q[m[2]] ?? CHORD_Q['']).map((i) => root + i);
}
const bars = (s: string) => s.trim().split('|').map((b) => b.trim());

// ------------------------------------------------------------------ the score (original)
export const TRACKS: Record<string, TrackDef> = {
  title: {
    id: 'title', title: 'Sunrise Over the Route', bpm: 132, steps: 8, loopStart: 2,
    lead: bars(`D5 F#5 A5 D6 A5 F#5 D5 A4 | B4 D5 G5 B5 A5 - . . |
      F#5 - A5 - D6 - C#6 B5 | B5 - G5 - D5 - E5 F#5 | E5 - C#5 - A4 - B4 C#5 | D5 - - - A4 - - . |
      B4 - D5 - F#5 - E5 D5 | D5 - B4 - G4 - A4 B4 | G4 - B4 - E5 - D5 C#5 | C#5 - E5 - A5 - G5 E5`),
    leadInst: 'pulse',
    harm: bars(`. . . . . . . . | . . . . . . . . |
      D5 - - - F#5 - - - | D5 - - - B4 - - - | C#5 - - - A4 - - - | A4 - - - F#4 - - - |
      F#4 - - - B4 - - - | G4 - - - D4 - - - | E4 - - - G4 - - - | A4 - - - C#5 - - -`),
    harmInst: 'pulse2',
    chords: ['D', 'G', 'D', 'G', 'A', 'D', 'Bm', 'G', 'Em', 'A'], bass: 'octave',
    drums: ['K . . . S . . .', 'K . K . S . H H', 'K . H . S . H .', 'K . H . S . H .', 'K . H . S . H .', 'K . H K S . H H'],
  },
  route_meadow: {
    id: 'route_meadow', title: 'Petal Path (Sunpetal Meadow)', bpm: 118, steps: 8, loopStart: 0,
    lead: bars(`D5 - B4 - G4 A4 B4 - | C5 - E5 - D5 C5 B4 - | A4 - F#4 - A4 B4 C5 - | B4 - G4 - - - . . |
      E5 - G5 - F#5 E5 D5 - | E5 - C5 - A4 B4 C5 - | A4 - C5 - E5 D5 C5 - | D5 - - - F#5 - A5 -`),
    leadInst: 'flute',
    harm: bars(`B4 - - - D5 - - - | E4 - - - G4 - - - | F#4 - - - D4 - - - | G4 - - - D4 - - - |
      G4 - - - B4 - - - | G4 - - - E4 - - - | E4 - - - A4 - - - | F#4 - - - C5 - - -`),
    harmInst: 'pulse2',
    chords: ['G', 'C', 'D', 'G', 'Em', 'C', 'Am', 'D'], bass: 'walk',
    drums: ['K . H . S . H .', 'K . H K S . H .'],
  },
  route_badlands: {
    id: 'route_badlands', title: 'Cinder Trail (Cinder Badlands)', bpm: 112, steps: 8, loopStart: 0, transpose: -5,
    lead: bars(`D5 - B4 - G4 A4 B4 - | C5 - E5 - D5 C5 B4 - | A4 - F#4 - A4 B4 C5 - | B4 - G4 - - - . . |
      E5 - G5 - F#5 E5 D5 - | E5 - C5 - A4 B4 C5 - | A4 - C5 - E5 D5 C5 - | D5 - - - F#5 - A5 -`),
    leadInst: 'pulse',
    chords: ['G', 'C', 'D', 'G', 'Em', 'C', 'Am', 'D'], bass: 'root',
    drums: ['K . . K S . . .', 'K . K . S . . H'],
  },
  route_frost: {
    id: 'route_frost', title: 'Rime Steps (Rimefrost Heights)', bpm: 104, steps: 8, loopStart: 0, transpose: -2,
    lead: bars(`D5 - B4 - G4 A4 B4 - | C5 - E5 - D5 C5 B4 - | A4 - F#4 - A4 B4 C5 - | B4 - G4 - - - . . |
      E5 - G5 - F#5 E5 D5 - | E5 - C5 - A4 B4 C5 - | A4 - C5 - E5 D5 C5 - | D5 - - - F#5 - A5 -`),
    leadInst: 'bell',
    harm: bars(`G4 - - - - - - - | C4 - - - - - - - | D4 - - - - - - - | G4 - - - - - - - |
      E4 - - - - - - - | C4 - - - - - - - | A3 - - - - - - - | D4 - - - - - - -`),
    harmInst: 'pad',
    chords: ['G', 'C', 'D', 'G', 'Em', 'C', 'Am', 'D'], bass: 'root',
    drums: ['K . . . H . . .', 'K . . . H . H .'],
  },
  route_dusk: {
    id: 'route_dusk', title: 'Moonlit Hollow (Duskwood Hollow)', bpm: 96, steps: 8, loopStart: 0,
    lead: bars(`A4 - C5 - E5 - D5 C5 | B4 - - - G4 - - - | F4 - A4 - C5 - B4 A4 | G#4 - - - E4 - - - |
      A4 - C5 - E5 - G5 F5 | E5 - - - C5 - D5 E5 | F5 - E5 - D5 - C5 B4 | A4 - - - - - . .`),
    leadInst: 'flute',
    harm: bars(`E4 - - - - - - - | D4 - - - - - - - | C4 - - - - - - - | B3 - - - - - - - |
      E4 - - - - - - - | E4 - - - - - - - | D4 - - - - - - - | C4 - - - - - - -`),
    harmInst: 'pad',
    chords: ['Am', 'G', 'F', 'E', 'Am', 'C', 'Dm', 'Am'], bass: 'root',
    drums: ['K . . . S . . .', 'K . . H S . . .'],
  },
  battle: {
    id: 'battle', title: 'Wild Rush (battle)', bpm: 152, steps: 8, loopStart: 1,
    lead: bars(`. . . . E4 F4 G4 G#4 |
      A4 . A4 C5 E5 - D5 C5 | B4 - G4 - A4 - . . | F4 . F4 A4 C5 - B4 A4 | G4 - B4 - D5 - . . |
      E5 . E5 D5 C5 - B4 C5 | D5 - C5 - A4 - . . | F5 - E5 - D5 - C5 - | B4 - G#4 - E4 - . .`),
    leadInst: 'pulse',
    chords: ['E', 'Am', 'Am', 'F', 'G', 'Am', 'Am', 'F', 'E'], bass: 'pump',
    drums: ['K . K . S S S S', 'K . H . S . H .', 'K . H K S . H .', 'K . H . S . H .', 'K K H . S . H O'],
    layer: {
      lead: bars(`. . . . . . . . |
        E5 - - - C5 - - - | D5 - - - B4 - - - | C5 - - - A4 - - - | D5 - - - G4 - - - |
        C5 - - - G5 - - - | A4 - - - F5 - - - | A5 - G5 - F5 - E5 - | E5 - - - B4 - - -`),
      inst: 'pulse2',
      drums: ['. . . . . . . .', 'H H H H H H H H'],
    },
  },
  boss: {
    id: 'boss', title: 'Lord of the Glade (boss)', bpm: 166, steps: 8, loopStart: 2,
    lead: bars(`D4 . . D4 . . D4 . | C#4 . . C#4 . E4 A4 . |
      D5 - F5 - A5 - G5 F5 | Bb4 - D5 - F5 - E5 D5 | C5 - E5 - G5 - F5 E5 | A4 - C#5 - E5 - . . |
      D5 - A5 - G5 F5 E5 D5 | F5 - D5 - Bb4 - C5 D5 | G4 - Bb4 - D5 - C5 Bb4 | A4 - - - C#5 - E5 -`),
    leadInst: 'pulse',
    harm: bars(`. . . . . . . . | . . . . . . . . |
      A4 - - - D5 - - - | F4 - - - Bb4 - - - | G4 - - - C5 - - - | E4 - - - A4 - - - |
      A4 - - - F4 - - - | D5 - - - Bb4 - - - | D4 - - - G4 - - - | E4 - - - G4 - - -`),
    harmInst: 'pulse2',
    chords: ['Dm', 'A', 'Dm', 'Bb', 'C', 'A', 'Dm', 'Bb', 'Gm', 'A'], bass: 'ostinato',
    drums: ['K . . K . . K .', 'K . . K . K S S', 'K . H . S . H K', 'K . H K S . H .'],
    gain: 1.05,
  },
  evolution: {
    id: 'evolution', title: "Something's Happening (evolution)", bpm: 100, steps: 8, loopStart: 0,
    lead: bars(`C5 E5 G5 C6 G5 E5 C5 E5 | D5 F5 A5 D6 A5 F5 D5 F5 | E5 G5 B5 E6 B5 G5 E5 G5 | F5 A5 C6 F6 G5 B5 D6 G6`),
    leadInst: 'bell',
    chords: ['C', 'Dm', 'Em', 'F'], bass: 'root',
    drums: ['K . . . K . . .', 'K . . . K . K .'],
  },
  // ---- stingers (play once)
  evolved: { id: 'evolved', title: 'Congratulations (evolution complete)', bpm: 120, steps: 8, loopStart: 0, stinger: true, lead: bars(`C5 E5 G5 C6 - - E6 - | D6 - - - C6 - - .`), leadInst: 'pulse', harm: bars(`G4 C5 E5 G5 - - C6 - | B5 - - - G5 - - .`), harmInst: 'pulse2', chords: ['C', 'C'], bass: 'root', drums: ['K . S . K . S .', 'K . . . . . . .'] },
  victory: { id: 'victory', title: 'Region Cleared (victory)', bpm: 128, steps: 8, loopStart: 0, stinger: true, lead: bars(`G4 - G4 G4 C5 - - - | E5 - D5 C5 E5 - - - | G5 - - - - - . .`), leadInst: 'pulse', harm: bars(`E4 - E4 E4 G4 - - - | C5 - B4 A4 C5 - - - | E5 - - - - - . .`), harmInst: 'pulse2', chords: ['C', 'C', 'C'], bass: 'root', drums: ['K . K K S . . .', 'K . K K S . . .', 'K . . . . . . .'] },
  defeat: { id: 'defeat', title: 'Fainted (defeat)', bpm: 84, steps: 8, loopStart: 0, stinger: true, lead: bars(`E5 - D5 - C5 - B4 - | A4 - - - - - . .`), leadInst: 'flute', chords: ['Am', 'Am'], bass: 'root', drums: ['. . . . . . . .', '. . . . . . . .'] },
  item: { id: 'item', title: 'Item Get (chest)', bpm: 150, steps: 8, loopStart: 0, stinger: true, lead: bars(`C5 E5 G5 C6 - E6 - . | D6 - C6 - - - . .`), leadInst: 'pulse', chords: ['C', 'C'], bass: 'root', drums: ['. . . . . . . .', '. . . . . . . .'] },
};

export interface NoteEvent { step: number; len: number; midi: number; inst: Instrument; vol: number; layer?: boolean }
export interface DrumEvent { step: number; kind: 'K' | 'S' | 'H' | 'O'; layer?: boolean }

/** steps per bar for a track */
export const barSteps = (t: TrackDef) => t.steps;
export const trackBars = (t: TrackDef) => t.lead.length;

/** Expand one bar of a track into note and drum events (step offsets within the bar). */
export function barEvents(t: TrackDef, bar: number): { notes: NoteEvent[]; drums: DrumEvent[] } {
  const notes: NoteEvent[] = [], drums: DrumEvent[] = [];
  const S = t.steps, tr = t.transpose ?? 0;
  const line = (src: string[] | undefined, inst: Instrument | undefined, vol: number, layer = false) => {
    if (!src || !inst) return;
    const toks = src[bar].split(/\s+/);
    for (let i = 0; i < toks.length; i++) {
      const tk = toks[i];
      if (tk === '-' || tk === '.') continue;
      let len = 1;
      while (i + len < toks.length && toks[i + len] === '-') len++;
      notes.push({ step: i, len, midi: midi(tk) + tr, inst, vol, layer });
    }
  };
  line(t.lead, t.leadInst, 1);
  line(t.harm, t.harmInst, 0.55);
  if (t.layer) line(t.layer.lead, t.layer.inst, 0.5, true);
  // bass from the chord
  const ch = chordNotes(t.chords[bar % t.chords.length]).map((n) => n - 24 + tr);
  const root = ch[0], fifth = ch[2], third = ch[1];
  const B = (step: number, n: number, len = 1) => notes.push({ step, len, midi: n, inst: 'tri', vol: 0.9 });
  switch (t.bass) {
    case 'pump': for (let s = 0; s < S; s++) B(s, s % 4 === 2 ? root + 12 : root); break;
    case 'walk': B(0, root, 2); B(2, third, 2); B(4, fifth, 2); B(6, root + 12, 1); B(7, fifth, 1); break;
    case 'root': B(0, root, 4); B(4, fifth, 4); break;
    case 'octave': for (let s = 0; s < S; s += 2) B(s, s % 4 ? root + 12 : root, 2); break;
    case 'ostinato': [root, root, root + 12, root, fifth, root, root + 12, fifth].forEach((n, i) => B(i, n)); break;
  }
  const dr = (pat: string | undefined, layer = false) => {
    if (!pat) return;
    pat.split(/\s+/).forEach((tk, i) => { if (tk !== '.') drums.push({ step: i, kind: tk as DrumEvent['kind'], layer }); });
  };
  dr(t.drums[bar % t.drums.length]);
  if (t.layer?.drums) dr(t.layer.drums[bar % t.layer.drums.length], true);
  return { notes, drums };
}

/** the bar that follows `bar`, honouring the loop point (or -1 at the end of a stinger) */
export function nextBar(t: TrackDef, bar: number): number {
  const n = trackBars(t);
  if (bar + 1 < n) return bar + 1;
  return t.stinger ? -1 : t.loopStart;
}

// ------------------------------------------------------------------ playback
export interface MusicSlot { src: string; loopStart: number; loopEnd: number; gain?: number; title?: string; source?: string; license?: string }

const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/** a single playing track (synth sequence or recorded slot) with its own fader */
export class TrackPlayer {
  readonly out: GainNode;
  private layerGain: GainNode;
  private bar = 0;
  private nextBarTime = 0;
  private stopped = false;
  private buf: AudioBufferSourceNode | null = null;
  ended = false;
  /** seconds of the bar boundaries this player has scheduled (for quantised switches) */
  barStart = 0;
  constructor(private ctx: AudioContext, dest: AudioNode, readonly def: TrackDef, private waves: Record<string, PeriodicWave>, private noise: AudioBuffer, slot?: { buffer: AudioBuffer; slot: MusicSlot }, startAt?: number) {
    this.out = ctx.createGain(); this.out.gain.value = 0; this.out.connect(dest);
    this.layerGain = ctx.createGain(); this.layerGain.gain.value = 0; this.layerGain.connect(this.out);
    this.nextBarTime = startAt ?? ctx.currentTime + 0.05;
    if (slot) {
      // recorded track: gapless loop with explicit loop points
      const s = ctx.createBufferSource(); s.buffer = slot.buffer;
      s.loop = !def.stinger; s.loopStart = slot.slot.loopStart; s.loopEnd = slot.slot.loopEnd || slot.buffer.duration;
      const g = ctx.createGain(); g.gain.value = slot.slot.gain ?? 1; s.connect(g); g.connect(this.out);
      s.start(this.nextBarTime);
      if (def.stinger) s.onended = () => { this.ended = true; };
      this.buf = s;
    }
  }
  get stepDur() { return 60 / this.def.bpm / (this.def.steps / 2); }
  get barDur() { return this.stepDur * this.def.steps; }
  setLayer(v: number) { this.layerGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.4); }
  /** fade to `to` over `seconds` starting at `at`; continues from whatever level is scheduled then */
  fade(to: number, seconds: number, at = this.ctx.currentTime) {
    const g = this.out.gain;
    const now = this.ctx.currentTime;
    if (at <= now + 0.005) { g.cancelScheduledValues(now); g.setValueAtTime(g.value, now); g.linearRampToValueAtTime(to, now + Math.max(0.01, seconds)); return; }
    // future start: let any running fade finish, then ramp from the level reached at `at`
    g.cancelScheduledValues(at);
    g.setTargetAtTime(to, at, Math.max(0.01, seconds) / 3);
  }
  stop(at = this.ctx.currentTime) {
    this.stopped = true;
    if (this.buf) try { this.buf.stop(at + 0.05); } catch { /* ok */ }
    setTimeout(() => this.out.disconnect(), Math.max(0, (at - this.ctx.currentTime) * 1000) + 400);
  }
  /** time of the next bar boundary (for quantised transitions) */
  nextBoundary() { return this.nextBarTime; }

  /** schedule bars up to `horizon` seconds ahead */
  pump(horizon = 0.3) {
    if (this.stopped || this.buf || this.ended) return;
    while (this.nextBarTime < this.ctx.currentTime + horizon) {
      if (this.bar < 0) { this.ended = true; return; }
      this.barStart = this.nextBarTime;
      this.scheduleBar(this.bar, this.nextBarTime);
      this.nextBarTime += this.barDur;
      this.bar = nextBar(this.def, this.bar);
    }
  }

  private scheduleBar(bar: number, t0: number) {
    const { notes, drums } = barEvents(this.def, bar);
    const sd = this.stepDur, gv = this.def.gain ?? 1;
    for (const n of notes) this.voice(n.inst, hz(n.midi), t0 + n.step * sd, n.len * sd, n.vol * gv, n.layer ? this.layerGain : this.out);
    for (const d of drums) this.drum(d.kind, t0 + d.step * sd, d.layer ? this.layerGain : this.out);
  }

  private voice(inst: Instrument, f: number, t: number, dur: number, vol: number, dest: AudioNode) {
    const c = this.ctx;
    const g = c.createGain(); g.connect(dest);
    const end = t + dur * 0.92;
    const env = (peak: number, a: number, decayTo: number, release = 0.04) => {
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + a);
      g.gain.setTargetAtTime(peak * decayTo, t + a, dur * 0.4);
      g.gain.setValueAtTime(peak * decayTo, end); g.gain.linearRampToValueAtTime(0, end + release);
    };
    const osc = (type: OscillatorType | 'wave', freq: number, wave?: PeriodicWave) => {
      const o = c.createOscillator();
      if (wave) o.setPeriodicWave(wave); else o.type = type as OscillatorType;
      o.frequency.value = freq; o.start(t); o.stop(end + 0.3); return o;
    };
    switch (inst) {
      case 'pulse': { const o = osc('wave', f, this.waves.p25); const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200; o.connect(lp); lp.connect(g); env(0.05 * vol, 0.006, 0.75); break; }
      case 'pulse2': { const o = osc('wave', f, this.waves.p12); const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600; o.connect(lp); lp.connect(g); env(0.035 * vol, 0.006, 0.6); break; }
      case 'tri': { osc('triangle', f).connect(g); env(0.16 * vol, 0.004, 0.85, 0.02); break; }
      case 'bell': { osc('sine', f).connect(g); const o2 = osc('sine', f * 3.01); const g2 = c.createGain(); g2.gain.value = 0.25; o2.connect(g2); g2.connect(g); env(0.07 * vol, 0.003, 0.15, 0.3); break; }
      case 'flute': {
        const o = osc('triangle', f); const lfo = c.createOscillator(); lfo.frequency.value = 5.2; const lg = c.createGain(); lg.gain.value = f * 0.006; lfo.connect(lg); lg.connect(o.frequency); lfo.start(t + 0.12); lfo.stop(end + 0.3);
        const o2 = osc('wave', f, this.waves.p50); const g2 = c.createGain(); g2.gain.value = 0.25; o2.connect(g2); g2.connect(g);
        o.connect(g); env(0.075 * vol, 0.03, 0.85, 0.06); break;
      }
      case 'pad': {
        for (const d of [-6, 6]) { const o = osc('sawtooth', f * Math.pow(2, d / 1200)); const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1100; o.connect(lp); lp.connect(g); }
        env(0.02 * vol, Math.min(0.3, dur * 0.3), 0.9, 0.25); break;
      }
    }
  }

  private drum(k: DrumEvent['kind'], t: number, dest: AudioNode) {
    const c = this.ctx;
    const g = c.createGain(); g.connect(dest);
    if (k === 'K') {
      const o = c.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
      g.gain.setValueAtTime(0.22, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.16); o.connect(g); o.start(t); o.stop(t + 0.18);
      return;
    }
    const s = c.createBufferSource(); s.buffer = this.noise;
    const f = c.createBiquadFilter();
    if (k === 'S') { f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 0.8; g.gain.setValueAtTime(0.09, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.12); }
    else { f.type = 'highpass'; f.frequency.value = 7000; g.gain.setValueAtTime(k === 'O' ? 0.03 : 0.022, t); g.gain.exponentialRampToValueAtTime(0.001, t + (k === 'O' ? 0.16 : 0.035)); }
    s.connect(f); f.connect(g); s.start(t, Math.random() * 0.5); s.stop(t + 0.2);
  }
}

export function makeWaves(c: AudioContext): Record<string, PeriodicWave> {
  // band-limited pulse waves (12.5 %, 25 %, 50 % duty) like the DS sound chip's square channels
  const pulse = (duty: number) => {
    const N = 32, re = new Float32Array(N), im = new Float32Array(N);
    for (let n = 1; n < N; n++) im[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * duty);
    return c.createPeriodicWave(re, im);
  };
  return { p12: pulse(0.125), p25: pulse(0.25), p50: pulse(0.5) };
}
