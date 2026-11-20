// Audio facade: mixer (Master / Music / Effects / Cries buses, effects compressor, master
// limiter, ducking), the music states, and cries. See docs/AUDIO.md.
//
// Every music state plays the adaptive score (src/audio/adaptive.ts): the score director picks its
// intensity from the fight, the boss state forces the climax, and victory / defeat / accent are its
// cues. Nothing plays before the score has loaded, and nothing replaces it if it fails to load.
// Pause filters and lowers the music instead of stopping it.
//
// Sound effects: the hero-shooter pivot (docs/hero-shooter-pivot.md Q51) removed every synthesised
// effect. The cue methods below stay as the hook points for recorded sounds and are silent until
// those are added. Cries are real recordings only; a species without one is silent.
import type { BiomeDef } from '../rules/stages';
import type { Element } from '../rules/elements';
import { cries } from '../assets/cries';
import { AdaptivePlayer, ScoreDirector, type CombatMusicInput, type ScoreCue } from './adaptive';
import { ADAPTIVE_SCORE } from './adaptive-score';

export interface MixSettings { master: number; music: number; sfx: number; cries: number; muted: boolean }
export const MIX_DEFAULT: MixSettings = { master: 0.8, music: 0.55, sfx: 0.8, cries: 0.85, muted: false };
export type MusicState = 'none' | 'title' | 'explore' | 'battle' | 'boss' | 'evolution' | 'ended';

interface Bus { gain: GainNode; meter: AnalyserNode }

export class Audio {
  ctx: AudioContext | null = null;
  mix: MixSettings = { ...MIX_DEFAULT };
  private master!: Bus; private music!: Bus; private sfxBus!: Bus; private cryBus!: Bus;
  private musicDuck!: GainNode; private musicFilter!: BiquadFilterNode;
  private adaptive: AdaptivePlayer | null = null;
  private scoreDirector = new ScoreDirector();
  private victoryTimer?: ReturnType<typeof setTimeout>;
  get adaptiveStatus() { return { ready: this.adaptive?.ready ?? false, playing: this.adaptive?.playing ?? false, intensity: this.adaptive?.state ?? 'anticipation' }; }
  // director state
  state: MusicState = 'none';
  private biome = 'meadow';
  private resumeAfterEvolution: MusicState = 'explore';
  private paused = false;
  intensity = 0;
  readonly log: { t: number; from: string; to: string; why: string }[] = [];

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
    cries.onPlay = (sec) => this.duck(0.55, sec + 0.15);
    this.applyVolume();
    void cries.preload(c);
    this.adaptive = new AdaptivePlayer(c, this.musicDuck, ADAPTIVE_SCORE);
    void this.adaptive.load().then(() => this.syncAdaptive())
      .catch((error) => { console.warn('Adaptive score unavailable; the music stays silent', error); });
    if (this.state !== 'none') { const s = this.state; this.state = 'none'; this.go(s, 'audio unlocked'); }
  }

  applyVolume() {
    if (!this.ctx) return;
    const m = this.mix;
    this.master.gain.gain.value = m.muted ? 0 : m.master;
    this.music.gain.gain.value = (this.paused ? 0.45 : 1) * m.music * 0.7;
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
    return { master: rms(this.master.meter), music: rms(this.music.meter), sfx: rms(this.sfxBus.meter), cries: rms(this.cryBus.meter) };
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

  // ------------------------------------------------------------------ sound-effect hooks
  // Silent until recorded sounds are added (Q51). Callers keep calling them, so each is the place a
  // recording plugs in. chest() is the exception: it is the adaptive score's accent cue.
  charge(_key: string, _dur: number) {}
  release(_key: string, _archetype: string, _element: Element) {}
  impact(_element: Element, _crit: boolean, _eff: number) {}
  cast(_arch: string) {}
  hit(_crit: boolean) {}
  kill() {}
  /** the overworld's warp (src/overworld/game.ts): a silent hook since the SFX cut */
  portal() {}
  pickup() {}
  levelUp() {}
  hurt() {}
  boss() {}
  evolve() {}
  evolveDone() {}
  ui() {}
  uiMove() {}
  pick() {}
  uiConfirm() {}
  uiBack() {}
  uiDenied() {}
  dash() {}
  jump() {}
  chest() { this.stingerPlay('item'); }
  death() {}
  guard() {}
  deflect() {}
  brace() {}
  enemyShot() {}

  // ------------------------------------------------------------------ music director
  private syncAdaptive() {
    if (!this.adaptive?.ready) return;
    if (this.state === 'none' || this.state === 'ended') { this.adaptive.stop(); return; }
    const band = this.state === 'boss' ? 'climax' : this.state === 'battle' ? 'combat' : this.scoreDirector.state;
    this.adaptive.start(band); this.adaptive.setState(band);
  }
  /** switch music state: every state plays the adaptive score (silent until it has loaded) */
  private go(state: MusicState, why: string) {
    if (state === this.state) return;
    this.log.push({ t: this.ctx?.currentTime ?? 0, from: this.state, to: state, why });
    if (this.log.length > 60) this.log.shift();
    this.state = state;
    this.syncAdaptive();
  }
  /** a one-shot: the adaptive score's victory, defeat or accent cue (nothing before the score loads) */
  private stingerPlay(id: string) {
    if (!this.ctx || !this.adaptive?.ready) return;
    const cue: ScoreCue | null = id === 'victory' ? (this.state === 'ended' ? 'victory' : 'accent') : id === 'defeat' ? 'defeat' : id === 'item' || id === 'evolved' ? 'accent' : null;
    if (cue) this.adaptive.cue(cue, this.state === 'ended');
  }

  /** title / select screens */
  titleMusic() { clearTimeout(this.victoryTimer); this.scoreDirector.reset(); this.adaptive?.cancelCues(); this.paused = false; this.musicFilter && this.setPausedFilter(false); this.go('title', 'menu'); }
  stopMusic() { clearTimeout(this.victoryTimer); this.adaptive?.cancelCues(); this.go('none', 'stop'); }
  resetMusicRun() { clearTimeout(this.victoryTimer); this.scoreDirector.reset(); this.adaptive?.cancelCues(); this.adaptive?.setState('anticipation'); }
  /** start of a run or a region */
  setBiome(b: BiomeDef) { clearTimeout(this.victoryTimer); if (this.state === 'title' || this.state === 'ended') { this.scoreDirector.reset(); this.adaptive?.cancelCues(); } const changed = b.id !== this.biome; this.biome = b.id; if (changed || this.state !== 'explore') this.go('explore', changed ? 'region ' + b.id : 'run start'); }
  onBossSpawn() { this.go('boss', 'boss appears'); }
  onBossDead() { this.scoreDirector.reset(); this.stingerPlay('victory'); this.go('explore', 'boss defeated'); }
  onMusicClimax() { this.scoreDirector.emphasize(); this.adaptive?.setState('climax'); }
  onEvolveStart() { this.resumeAfterEvolution = this.state === 'evolution' ? 'explore' : this.state; this.go('evolution', 'evolution'); }
  onEvolveEnd() { this.stingerPlay('evolved'); this.go(this.resumeAfterEvolution === 'none' ? 'explore' : this.resumeAfterEvolution, 'evolution done'); }
  onDefeat() { clearTimeout(this.victoryTimer); this.go('ended', 'defeat'); this.stingerPlay('defeat'); }
  onVictory() { clearTimeout(this.victoryTimer); this.go('ended', 'run won'); this.stingerPlay('victory'); this.victoryTimer = setTimeout(() => this.titleMusic(), 6500); }
  setPaused(p: boolean) { this.paused = p; this.setPausedFilter(p); }
  private setPausedFilter(p: boolean) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.musicFilter.frequency.setTargetAtTime(p ? 900 : 20000, t, 0.08);
    this.music.gain.gain.setTargetAtTime((p ? 0.45 : 1) * this.mix.music * 0.7, t, 0.08);
  }

  /** per-frame update: feeds the score director the fight around the player */
  tick(dt = 1 / 60, info?: CombatMusicInput) {
    if (!this.ctx) return;
    this.adaptive?.pump();
    if (!info || !info.inRun || this.paused || !this.adaptive?.ready) return;
    if (this.state !== 'ended' && this.state !== 'none') this.adaptive.setState(this.scoreDirector.update(dt, info));
    this.intensity = Math.min(1, info.enemiesNear / 16);
  }
}
