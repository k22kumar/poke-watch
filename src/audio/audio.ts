// Audio facade: mixer (Master / Music / Effects / Cries buses, effects compressor, master
// limiter, ducking), the music director, move sound effects and cries. See docs/AUDIO.md.
//
// Music states follow the game's real moments, with hysteresis so the score never flips back and
// forth: title & partner select → region route (low pressure: stage start, after the boss) →
// battle (a crowd stays close for a few seconds; the swarm layer fades in with enemy count) →
// boss (intro bars, then the loop) → victory / evolution / defeat stingers; pause filters and
// lowers the music instead of stopping it.
import type { BiomeDef } from '../rules/stages';
import type { Element } from '../rules/elements';
import { cries } from '../assets/cries';
import { SfxEngine } from './sfx';
import { TRACKS, TrackPlayer, makeWaves, type MusicSlot, type TrackDef } from './music';
import SLOTS from '../content/music.json';

export interface MixSettings { master: number; music: number; sfx: number; cries: number; muted: boolean }
export const MIX_DEFAULT: MixSettings = { master: 0.8, music: 0.55, sfx: 0.8, cries: 0.85, muted: false };
export type MusicState = 'none' | 'title' | 'explore' | 'battle' | 'boss' | 'evolution' | 'ended';

interface Bus { gain: GainNode; meter: AnalyserNode }

export class Audio {
  ctx: AudioContext | null = null;
  mix: MixSettings = { ...MIX_DEFAULT };
  private master!: Bus; private music!: Bus; private sfxBus!: Bus; private cryBus!: Bus;
  private musicDuck!: GainNode; private musicFilter!: BiquadFilterNode;
  sfx: SfxEngine | null = null;
  private waves: Record<string, PeriodicWave> = {};
  private noise!: AudioBuffer;
  private slots: Record<string, MusicSlot> = SLOTS as Record<string, MusicSlot>;
  private slotBuffers = new Map<string, AudioBuffer>();
  // director state
  state: MusicState = 'none';
  private player: TrackPlayer | null = null;
  private stinger: TrackPlayer | null = null;
  private biome = 'meadow';
  private dwell = 0;
  private pressure = 0; // seconds of sustained close combat (positive) or calm (negative)
  private resumeAfterEvolution: MusicState = 'explore';
  private paused = false;
  intensity = 0;
  readonly log: { t: number; from: string; to: string; why: string }[] = [];
  private pickupCombo = 0; private pickupT = 0;

  // ------------------------------------------------------------------ setup
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') void this.ctx.resume(); return; }
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    const c: AudioContext = new AC();
    this.ctx = c;
    const bus = (dest: AudioNode): Bus => { const gain = c.createGain(); const meter = c.createAnalyser(); meter.fftSize = 1024; gain.connect(meter); gain.connect(dest); return { gain, meter }; };
    // master limiter keeps peaks under control when everything fires at once
    const lim = c.createDynamicsCompressor(); lim.threshold.value = -4; lim.knee.value = 2; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.12;
    lim.connect(c.destination);
    this.master = bus(lim);
    this.musicFilter = c.createBiquadFilter(); this.musicFilter.type = 'lowpass'; this.musicFilter.frequency.value = 20000;
    this.musicDuck = c.createGain();
    this.music = bus(this.master.gain);
    this.musicDuck.connect(this.musicFilter); this.musicFilter.connect(this.music.gain);
    // effects compressor: swarms of impacts stay comfortable, single hits stay punchy
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -20; comp.knee.value = 8; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.15;
    this.sfxBus = bus(this.master.gain);
    comp.connect(this.sfxBus.gain);
    this.cryBus = bus(this.master.gain);
    this.sfx = new SfxEngine(c, comp);
    this.noise = this.sfx.noise!;
    this.waves = makeWaves(c);
    cries.onPlay = (sec) => this.duck(0.55, sec + 0.15);
    this.applyVolume();
    void cries.preload(c);
    void this.loadSlots();
    if (this.state !== 'none') { const s = this.state; this.state = 'none'; this.go(s, 'audio unlocked'); }
  }

  /** decode any licensed recordings dropped into the music slots */
  private async loadSlots() {
    if (!this.ctx) return;
    for (const [state, slot] of Object.entries(this.slots)) {
      try { const r = await fetch(slot.src); this.slotBuffers.set(state, await this.ctx.decodeAudioData(await r.arrayBuffer())); }
      catch (e) { console.warn(`music slot ${state} could not be decoded; using the original track`, e); }
    }
  }

  applyVolume() {
    if (!this.ctx) return;
    const m = this.mix;
    this.master.gain.gain.value = m.muted ? 0 : m.master;
    this.music.gain.gain.value = m.music * 0.7;
    this.sfxBus.gain.gain.value = m.sfx;
    this.cryBus.gain.gain.value = m.cries;
  }
  /** legacy setters used by older settings */
  set volume(v: number) { this.mix.sfx = v; }
  set musicVolume(v: number) { this.mix.music = v; }
  get muted() { return this.mix.muted; }
  set muted(v: boolean) { this.mix.muted = v; }

  /** briefly lower the music (cries, stingers, important cues) */
  duck(to: number, seconds: number) {
    if (!this.ctx) return;
    const g = this.musicDuck.gain, t = this.ctx.currentTime;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(to, t + 0.06);
    g.setValueAtTime(to, t + seconds);
    g.linearRampToValueAtTime(1, t + seconds + 0.35);
  }

  /** RMS levels (dBFS) per bus, for the verification tools and the audio debug view */
  meters() {
    const rms = (a: AnalyserNode) => { const d = new Float32Array(a.fftSize); a.getFloatTimeDomainData(d); let s = 0; for (const v of d) s += v * v; return Math.round(20 * Math.log10(Math.sqrt(s / d.length) + 1e-9) * 10) / 10; };
    if (!this.ctx) return null;
    return { master: rms(this.master.meter), music: rms(this.music.meter), sfx: rms(this.sfxBus.meter), cries: rms(this.cryBus.meter), voices: this.sfx?.activeVoices() ?? 0 };
  }
  /** a tap of the final mix (for recording audio in tests) */
  captureStream(): MediaStream | null {
    if (!this.ctx) return null;
    const d = this.ctx.createMediaStreamDestination();
    this.master.gain.connect(d);
    return d.stream;
  }

  // ------------------------------------------------------------------ cries
  cry(id: string, opts: { volume?: number; pitch?: number; gate?: number } = {}) {
    if (!this.ctx) return;
    cries.play(this.ctx, this.cryBus.gain, id, opts);
  }

  // ------------------------------------------------------------------ move & combat sounds
  charge(key: string, dur: number) { this.sfx?.charge(key, dur); }
  release(key: string, archetype: string, element: Element) { this.sfx?.release(key, archetype, element); }
  impact(element: Element, crit: boolean, eff: number) { this.sfx?.impact(element, crit, eff); }
  /** older single-call cast (no move key known) */
  cast(arch: string) { this.sfx?.release('', arch, 'plain'); }
  hit(crit: boolean) { this.sfx?.impact('plain', crit, 1); }
  private t(layers: Parameters<SfxEngine['layers']>[0], pri: 0 | 1 | 2 | 3 | 4 = 2, gateKey?: string, gap = 0.03) {
    if (!this.sfx || (gateKey && !this.sfx.gate(gateKey, gap))) return;
    this.sfx.layers(layers, { pri });
  }
  kill() { this.t([{ osc: 'triangle', f0: 620, f1: 160, dur: 0.08, vol: 0.05 }], 1, 'kill', 0.04); }
  pickup() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (now - this.pickupT > 0.6) this.pickupCombo = 0;
    this.pickupT = now;
    const semis = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24][Math.min(10, this.pickupCombo++)];
    const f = 880 * Math.pow(2, semis / 12);
    this.t([{ osc: 'sine', f0: f, f1: f * 1.01, dur: 0.07, vol: 0.05 }], 0, 'pick', 0.035);
  }
  levelUp() {
    this.duck(0.4, 0.55);
    [0, 4, 7, 12].forEach((s, i) => this.sfx?.layers([{ osc: 'square', f0: 523 * Math.pow(2, s / 12), dur: 0.13, vol: 0.06 }], { when: i * 0.07, pri: 4 }));
  }
  hurt() { this.t([{ osc: 'sawtooth', f0: 190, f1: 60, dur: 0.18, vol: 0.13 }, { noise: 'lowpass', f0: 1200, f1: 300, dur: 0.12, vol: 0.12 }], 4, 'hurt', 0.1); }
  boss() { this.duck(0.3, 1.2); this.t([{ osc: 'sawtooth', f0: 110, f1: 98, dur: 0.9, vol: 0.12 }, { osc: 'sawtooth', f0: 90, f1: 78, dur: 0.9, vol: 0.1, delay: 0.35 }, { noise: 'lowpass', f0: 300, f1: 120, dur: 1, vol: 0.12 }], 4); }
  evolve() { /* the evolution track carries this moment */ }
  evolveDone() { this.t([{ osc: 'sine', f0: 1046, f1: 2093, dur: 0.6, vol: 0.06 }, { noise: 'highpass', f0: 6000, f1: 8000, dur: 0.6, vol: 0.05 }], 4); }
  ui() { this.uiMove(); }
  uiMove() { this.t([{ osc: 'square', f0: 1320, f1: 1320, dur: 0.035, vol: 0.035 }], 4, 'uim', 0.025); }
  pick() { this.uiConfirm(); }
  uiConfirm() { [0, 7].forEach((s, i) => this.sfx?.layers([{ osc: 'square', f0: 990 * Math.pow(2, s / 12), dur: 0.07, vol: 0.045 }], { when: i * 0.045, pri: 4 })); }
  uiBack() { [0, -5].forEach((s, i) => this.sfx?.layers([{ osc: 'square', f0: 880 * Math.pow(2, s / 12), dur: 0.06, vol: 0.04 }], { when: i * 0.04, pri: 4 })); }
  uiDenied() { this.t([{ osc: 'square', f0: 220, f1: 200, dur: 0.12, vol: 0.05 }], 4, 'uid', 0.1); }
  dash() { this.t([{ noise: 'bandpass', f0: 800, f1: 2600, q: 1.2, dur: 0.14, vol: 0.12 }], 2, 'dash', 0.05); }
  jump() { this.t([{ osc: 'square', f0: 330, f1: 660, dur: 0.09, vol: 0.035 }], 2, 'jump', 0.05); }
  chest() { this.stingerPlay('item'); }
  portal() { this.t([{ osc: 'sine', f0: 200, f1: 1200, dur: 1.0, vol: 0.08 }, { osc: 'sine', f0: 300, f1: 1800, dur: 1.0, vol: 0.05, delay: 0.1 }], 3); }
  death() { this.t([{ osc: 'sawtooth', f0: 400, f1: 50, dur: 1.2, vol: 0.1 }], 4); }
  // aimed combat: a quick metallic "shk" on Guard, a bright ping on a deflect or parry, a dull thud on Brace
  guard() { this.t([{ noise: 'highpass', f0: 3000, f1: 5000, dur: 0.05, vol: 0.05 }], 2, 'guard', 0.05); }
  deflect() { this.t([{ osc: 'square', f0: 1568, f1: 2093, dur: 0.09, vol: 0.06 }, { osc: 'triangle', f0: 784, f1: 1046, dur: 0.14, vol: 0.05 }, { noise: 'highpass', f0: 5000, f1: 7000, dur: 0.06, vol: 0.05 }], 3, 'deflect', 0.03); }
  brace() { this.t([{ osc: 'triangle', f0: 180, f1: 120, dur: 0.1, vol: 0.08 }, { noise: 'lowpass', f0: 900, f1: 300, dur: 0.08, vol: 0.06 }], 3, 'brace', 0.08); }
  enemyShot() { this.t([{ osc: 'square', f0: 320, f1: 210, dur: 0.06, vol: 0.022 }], 1, 'eshot', 0.08); }

  // ------------------------------------------------------------------ music director
  private trackFor(state: MusicState): TrackDef | null {
    switch (state) {
      case 'title': return TRACKS.title;
      case 'explore': return TRACKS['route_' + this.biome] ?? TRACKS.route_meadow;
      case 'battle': return TRACKS.battle;
      case 'boss': return TRACKS.boss;
      case 'evolution': return TRACKS.evolution;
      default: return null;
    }
  }
  /** switch music state; quantised to the current bar unless `now` */
  private trackKey = '';
  private go(state: MusicState, why: string, now = false) {
    const key = state === 'explore' ? 'route_' + this.biome : state;
    if (key === this.trackKey && this.player) return;
    this.trackKey = key;
    this.log.push({ t: this.ctx?.currentTime ?? 0, from: this.state, to: state, why });
    if (this.log.length > 60) this.log.shift();
    this.state = state; this.dwell = 0; this.pressure = 0;
    const c = this.ctx;
    if (!c) return;
    const def = this.trackFor(state);
    const old = this.player;
    // start on the old track's next bar boundary when it's close, else almost immediately
    let at = c.currentTime + 0.06;
    if (old && !now) { const nb = old.nextBoundary(); if (nb - c.currentTime < 1.2) at = Math.max(at, nb); }
    if (old) { old.fade(0, now ? 0.35 : 1.1, at); old.stop(at + 1.3); }
    this.player = null;
    if (!def) { this.trackKey = state; return; }
    const buf = this.slotBuffers.get(key);
    const p = new TrackPlayer(c, this.musicDuck, def, this.waves, this.noise, buf ? { buffer: buf, slot: this.slots[key] } : undefined, at);
    p.fade(1, old ? (now ? 0.25 : 0.9) : 0.6, at);
    this.player = p;
  }
  private stingerPlay(id: string) {
    const c = this.ctx;
    if (!c) return;
    const def = TRACKS[id];
    this.stinger?.stop();
    const buf = this.slotBuffers.get(id);
    const s = new TrackPlayer(c, this.music.gain, def, this.waves, this.noise, buf ? { buffer: buf, slot: this.slots[id] } : undefined);
    s.fade(1, 0.02);
    this.stinger = s;
    const len = buf ? buf.duration : (60 / def.bpm / (def.steps / 2)) * def.steps * def.lead.length;
    this.duck(0.12, len);
    setTimeout(() => { if (this.stinger === s) { s.stop(); this.stinger = null; } }, (len + 0.5) * 1000);
  }

  /** title / select screens */
  titleMusic() { this.paused = false; this.musicFilter && this.setPausedFilter(false); this.go('title', 'menu'); }
  stopMusic() { this.go('none', 'stop'); }
  /** start of a run or a region */
  setBiome(b: BiomeDef) { const changed = b.id !== this.biome; this.biome = b.id; if (changed || this.state !== 'explore') this.go('explore', changed ? 'region ' + b.id : 'run start', changed && this.state === 'explore'); }
  onBossSpawn() { this.go('boss', 'boss appears', true); }
  onBossDead() { this.stingerPlay('victory'); this.go('explore', 'boss defeated'); }
  onEvolveStart() { this.resumeAfterEvolution = this.state === 'evolution' ? 'explore' : this.state; this.go('evolution', 'evolution', true); }
  onEvolveEnd() { this.stingerPlay('evolved'); this.go(this.resumeAfterEvolution === 'none' ? 'explore' : this.resumeAfterEvolution, 'evolution done'); }
  onDefeat() { this.go('ended', 'defeat', true); this.stingerPlay('defeat'); }
  onVictory() { this.go('ended', 'run won', true); this.stingerPlay('victory'); setTimeout(() => this.go('title', 'after victory'), 4000); }
  setPaused(p: boolean) { this.paused = p; this.setPausedFilter(p); }
  private setPausedFilter(p: boolean) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.musicFilter.frequency.setTargetAtTime(p ? 900 : 20000, t, 0.08);
    this.music.gain.gain.setTargetAtTime((p ? 0.45 : 1) * this.mix.music * 0.7, t, 0.08);
  }

  /** per-frame update: schedules music and decides battle vs explore with hysteresis */
  tick(dt = 1 / 60, info?: { inRun: boolean; enemiesNear: number; enemies: number; boss: boolean }) {
    const c = this.ctx;
    if (!c) return;
    this.player?.pump(); this.stinger?.pump();
    if (!info || !info.inRun || this.paused) return;
    this.dwell += dt;
    if (this.state === 'explore' || this.state === 'battle') {
      // close crowd for 2.5 s → battle; nearly empty surroundings for 6 s → back to the route;
      // never switch more often than every 8 s
      if (info.enemiesNear >= 8) this.pressure = Math.max(0, this.pressure) + dt;
      else if (info.enemiesNear <= 2) this.pressure = Math.min(0, this.pressure) - dt;
      else this.pressure *= Math.exp(-dt * 0.5);
      if (this.dwell > 8) {
        if (this.state === 'explore' && this.pressure > 2.5) this.go('battle', `crowd ${info.enemiesNear} close`);
        else if (this.state === 'battle' && this.pressure < -6) this.go('explore', 'calm');
      }
    }
    if (info.boss && this.state !== 'boss' && this.state !== 'evolution' && this.state !== 'ended') this.go('boss', 'boss alive', true);
    // swarm layer: fades in with the size of the crowd
    this.intensity = Math.min(1, info.enemies / 140);
    this.player?.setLayer(this.state === 'battle' ? Math.min(1, Math.max(0, (info.enemies - 30) / 90)) : 0);
  }
}
