// Entry: wires sim (fixed 60 Hz), renderer, UI, audio and input together.
import { buildRecap, debugLine } from './sim/caplog';
import { Audio } from './audio/audio';
import { Input } from './input/input';
import { MODES } from './mods';
import type { Mode } from './mods/types';
import { BIOMES, STAGES } from './rules/stages';
import { SPECIES_BY_ID } from './rules/species';
import { Renderer } from './render/renderer';
import { botInput } from './sim/bot';
import { damagePlayer, killEnemy } from './sim/combat';
import { spawnEnemy } from './sim/enemies';
import { ROLE } from './sim/pools';
import { spawnBody } from './sim/bodies';
import { applyAgent } from './sim/cells';
import { gainXp, xpNext } from './sim/progression';
import { addMember } from './sim/squad';
import { addTechnique, setTransform } from './sim/build';
import { startObjective } from './sim/objectives';
import { spawnComposition } from './sim/director';
import { COMPOSITIONS } from './rules/compositions';
import { createRun, startStage, step } from './sim/run';
import { TRANSFORM_BY_ID } from './rules/build';
import { artMetrics } from './render/metrics';
const TRANSFORM_MOVE = (id: string) => TRANSFORM_BY_ID[id]?.move;
import type { InputFrame, SimContext, SimEvent } from './sim/types';
import { UI } from './ui/ui';
import { CAMERA_DEFAULT, cameraPreset } from './render/camera';
import { cries } from './assets/cries';
import { MOVE_SFX } from './audio/sfx';
import { TRACKS } from './audio/music';
import type { ArtBundle } from './assets/builtin';
import ART from './content/art.json';

const params = new URLSearchParams(location.search);
const DEFAULT_SPECIES = 'charmander';
const canvas = document.getElementById('game') as HTMLCanvasElement;
const audio = new Audio();
const input = new Input(canvas);

const SETTINGS_DEFAULT = { volume: 0.8, music: 0.55, master: 0.8, cries: 0.85, muted: false, quality: 1, numbers: true, camera: CAMERA_DEFAULT, shake: 1, combat: 'aimed' as 'aimed' | 'assist' | 'auto', sens: 1, invertY: false, fov: 0, camV: 2, world: 'generated' as 'authored' | 'generated', worldV: 1 };
const settings = { ...SETTINGS_DEFAULT };
try {
  const saved = JSON.parse(localStorage.getItem('poke-watch.settings') ?? localStorage.getItem('bonklab.settings') ?? '{}');
  Object.assign(settings, saved);
  if (saved.worldV !== 1) settings.world = 'generated';
} catch { /* storage unavailable */ }
settings.worldV = 1;
// settings saved before the third-person camera existed keep their other choices but move to the new default view once
if (settings.camV !== 2) { settings.camera = 'chase'; settings.camV = 2; }

let renderer: Renderer;
let ctx: SimContext | null = null;
let current: { mode: Mode; species: string; seed: number } | null = null;
let paused = false;
let acc = 0;
let hitstop = 0;
let pendingCard: InputFrame['card'] | undefined;
let lastFrame = performance.now();
let fps = 60, fpsAcc = 0, fpsN = 0, govT = 0, govGood = 0;
let god = false;
const perf = { sim: 0, render: 0 };
const autoplay = params.has('autoplay');
// ?capture=1: the loop stops advancing on its own; tools call pokewatch.advance(seconds) to step the sim at
// exactly 60 Hz and draw one frame, and presentation randomness is seeded, so shots are repeatable.
const capture = params.has('capture');
if (capture) { let s = 0x9e3779b9; Math.random = () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const speed = Number(params.get('speed') ?? 1);

function ui_applySettings() {
  applyMix();
  if (ctx) ctx.rules.combat.mode = settings.combat;
  if (renderer) { renderer.quality = settings.quality; renderer.cam = cameraPreset(settings.camera); renderer.shakeScale = settings.shake; renderer.fovOffset = settings.fov; input.chase = renderer.chase; if (!renderer.chase) input.releaseLock(); resize(); }
  try { localStorage.setItem('poke-watch.settings', JSON.stringify(settings)); } catch { /* storage unavailable */ }
}
const ui = new UI({
  start: (mode, species, seed) => startRun(mode, species, seed),
  card: (action, index) => { pendingCard = { action, index }; },
  resume: () => setPaused(false),
  restart: () => { if (current) startRun(current.mode, current.species, (current.seed + 1) >>> 0); },
  quit: () => { cancelEnd(); ctx = null; (window as any).pokewatch.ctx = null; paused = false; pendingCard = undefined; audio.setPaused(false); audio.titleMusic(); input.releaseLock(); ui.title(); },
  portrait: (id) => renderer?.portrait(id),
  sound: (k) => { audio.unlock(); if (k === 'ui' || k === 'move') audio.uiMove(); else if (k === 'back') audio.uiBack(); else if (k === 'denied') audio.uiDenied(); else audio.uiConfirm(); },
  settings,
  cry: (id) => { audio.unlock(); audio.cry(id, { volume: 0.5, gate: 0.25 }); },
  resetSettings: () => { Object.assign(settings, SETTINGS_DEFAULT); ui_applySettings(); },
  preview: (kind) => {
    audio.unlock();
    if (kind === 'cry') audio.cry(ctx?.player.species.id ?? 'charmander', { volume: 0.8, gate: 0 });
    else if (kind === 'sfx') { audio.release('flamethrower', 'cone', 'blaze'); setTimeout(() => audio.impact('blaze', false, 2), 220); }
    else audio.chest();
  },
  applySettings: () => ui_applySettings(),

  tuning: () => ({
    rules: ctx?.rules ?? {},
    ctx,
    spawnBoss: () => { if (!ctx) return; const t = STAGES[ctx.stage % STAGES.length]; const P = ctx.player; const b = spawnEnemy(ctx, t.boss, P.x + 18, P.z, ROLE.boss); ctx.director.bossIndex = b; ctx.director.bossSpawned = true; ui.banner(SPECIES_BY_ID[t.boss].name, 'appears!', 2); audio.boss(); },
    addLevel: () => { if (ctx) gainXp(ctx, ctx.player.xpNext - ctx.player.xp + 0.01); },
    god: (on) => { god = on; },
    killAll: () => { if (!ctx) return; const E = ctx.enemies; for (let i = 0; i < E.hi; i++) if (E.alive[i] && !(E.roles[i] & ROLE.boss)) killEnemy(ctx, i); },
  }),
});
function applyMix() { audio.mix = { master: settings.master, music: settings.music, sfx: settings.volume, cries: settings.cries, muted: settings.muted }; audio.applyVolume(); }
applyMix();

input.onAction = (a) => {
  audio.unlock();
  if (!ctx) return;
  if (a === 'pause' && ctx.state !== 'over' && ctx.state !== 'victory') setPaused(!paused);
  if (a === 'tuning') ui.toggleTuning();
  if (a === 'mute') { settings.muted = !settings.muted; applyMix(); }
  // Upgrade shortcuts are edge-triggered and only act while an offer is pending.
  if (ui.trayOpen() && !paused) {
    if (a === 'pick1' || a === 'pick2' || a === 'pick3' || a === 'pick4') ui.cardClick(Number(a.slice(4)) - 1);
    else if (a === 'reroll' || a === 'skip') ui.cardKey(a);
    else if (a === 'banish') ui.toggleBanish();
    else if (a === 'cardPointer') { if (input.locked) input.releaseLock(); else input.capture(); }
  }
  // Menus own their controls; upgrade hotkeys are routed above while gameplay stays active.
};
window.addEventListener('pointerdown', () => audio.unlock());

function setPaused(p: boolean) {
  paused = p;
  audio.setPaused(p);
  if (p) { ui.pause(ctx); input.releaseLock(); } else { ui.unpause(); input.context = 'play'; input.capture(); }
}

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  renderer.resize(window.innerWidth, window.innerHeight, dpr);
}

function startRun(mode: Mode, species: string, seed: number) {
  audio.unlock();
  cancelEnd();
  audio.setPaused(false); // restarting from the pause menu must not keep the muffled pause mix
  current = { mode, species, seed };
  const world = params.get('world') === 'gen' ? 'generated' : params.get('world') === 'authored' ? 'authored' : settings.world;
  ctx = createRun({ seed, species, mode, ruleOverrides: { combat: { mode: (params.get('combat') as typeof settings.combat) ?? settings.combat }, worldgen: { mode: world } } });
  renderer.setStage(ctx);
  renderer.yaw = Math.PI; // fixed views look north (-z); the third-person rig starts there too and is then turned by the player
  renderer.resetView(ctx);
  acc = 0; hitstop = 0; paused = false; pendingCard = undefined;
  ui.startHud(ctx);
  audio.setBiome(ctx.world.biome);
  audio.cry(species, { volume: 0.6 });
  (window as any).pokewatch.ctx = ctx;
}

/** one input frame with the aim point: the ground under the cursor, or 8 m along the right stick */
function sampleInput(c: SimContext): InputFrame {
  const inp = input.sample(renderer.yaw);
  const P = c.player;
  let aim: [number, number] | null = null;
  // third person: the camera is the aim (the reticle ray against the terrain, in the camera's yaw plane)
  if (renderer.chase) aim = renderer.chaseAim(c);
  else if (input.aimSource === 'mouse' && input.mouseSeen) aim = renderer.groundAt(input.mouseX, input.mouseY, P.y);
  else if (input.aimSource === 'stick') aim = [P.x + input.stickAim[0] * 8, P.z + input.stickAim[1] * 8];
  if (aim && c.rules.combat.mode !== 'auto') { inp.aimX = aim[0]; inp.aimZ = aim[1]; }
  renderer.aim.on = !!aim && c.rules.combat.mode !== 'auto' && c.state === 'play';
  if (aim) { renderer.aim.x = aim[0]; renderer.aim.z = aim[1]; }
  return inp;
}

function onEvents(c: SimContext, events: SimEvent[]) {
  renderer.handleEvents(c, events);
  for (const e of events) {
    switch (e.t) {
      case 'hitstop': hitstop = Math.max(hitstop, e.dur); break;
      case 'windup': audio.charge(e.key, e.dur); break;
      case 'cast': audio.release(e.key, e.archetype, e.element); break;
      case 'hit': audio.impact(e.element, e.crit, e.eff); break;
      case 'kill': audio.kill(); break;
      case 'pickup': audio.pickup(); break;
      case 'levelUp': audio.levelUp(); audio.cry(c.player.species.id, { volume: 0.35, gate: 2 }); break;
      case 'playerHurt':
        ui.hurt(); audio.hurt();
        if (god) c.player.hp = Math.max(c.player.hp, c.player.maxHp * 0.5);
        break;
      case 'cards': ui.showCards(c, e.cards, e.chest); break;
      case 'cardPicked': ui.hideCards(e.card); if (e.card) audio.pick(); break;
      case 'evolveStart': ui.evolve(e.from, e.to); audio.onEvolveStart(); audio.cry(e.from, { volume: 0.6 }); break;
      case 'evolveEnd': audio.onEvolveEnd(); audio.cry(e.species, { volume: 0.7, gate: 0 }); ui.evolveDone(e.species, Object.values(SPECIES_BY_ID).find((s) => s.evolvesTo === e.species)?.id ?? ''); audio.evolveDone(); break;
      // boss cries play at their recorded pitch (as in HGSS encounters); see docs/AUDIO.md
      case 'bossSpawn': ui.banner(SPECIES_BY_ID[e.species].name, SPECIES_BY_ID[e.species].boss?.title ?? 'appears!', 3); audio.boss(); audio.onBossSpawn(); setTimeout(() => audio.cry(e.species, { volume: 0.8, gate: 0 }), 450); break;
      case 'bossPhase': ui.banner('It\'s getting angry!', '', 1.4); break;
      case 'bossDead': ui.banner('Boss defeated!', 'Step into the portal', 3); audio.cry(e.species, { volume: 0.8, pitch: 0.85, gate: 0 }); audio.onBossDead(); break;
      case 'finalSwarm': ui.banner('FINAL SWARM', 'They keep getting tougher…', 2.5); break;
      case 'swarm': ui.banner('Stampede!', '', 1.2); break;
      case 'chest': audio.chest(); break;
      case 'dash': audio.dash(); break;
      case 'jump': audio.jump(); break;
      case 'guard': audio.guard(); break;
      case 'deflect': case 'parry': audio.deflect(); break;
      case 'brace': audio.brace(); break;
      case 'push': if (!e.ok) audio.brace(); break;
      case 'bodyHit': audio.impact('stone', false, e.eff); break;
      case 'break': audio.impact('stone', true, 2); break;
      case 'throw': audio.enemyShot(); break;
      case 'cell': audio.impact(e.change === 'ignite' ? 'blaze' : e.change === 'freeze' ? 'frost' : e.change === 'charge' ? 'volt' : 'tide', e.change === 'charge', 1); break;
      case 'spark': audio.enemyShot(); break;
      case 'enemyShot': audio.enemyShot(); break;
      case 'portal': audio.portal(); break;
      case 'stageStart':
        if (c.tick > 1) { ui.stageBanner(c); audio.setBiome(BIOMES[e.biome]); }
        break;
      // the faint cry is lowered, as the DS games do when a Pokémon faints
      case 'death': audio.death(); audio.onDefeat(); audio.cry(c.player.species.id, { volume: 0.7, pitch: 0.85, gate: 0 }); ui.banner(c.player.squad.length > 1 ? 'Your whole squad fainted…' : `${c.player.species.name} fainted…`, '', 1.5); break;
      // squad (blueprint section 6): the incoming Pokémon calls out as it tags in
      case 'tag': audio.dash(); audio.cry(e.to, { volume: e.free ? 0.6 : 0.4, gate: 0.25 }); break;
      case 'faint': if (!e.out) { audio.cry(e.species, { volume: 0.6, pitch: 0.85, gate: 0 }); ui.banner(`${SPECIES_BY_ID[e.species].name} fainted!`, 'The next Pokémon is coming in', 1.6); } break;
      case 'recruit': audio.levelUp(); audio.cry(e.species, { volume: 0.7, gate: 0 }); ui.banner(`${SPECIES_BY_ID[e.species].name} joined your squad!`, 'Tag it in with Q (tap) or hold Q + click', 2.6); break;
      // objectives and the director (blueprint section 9)
      case 'objective': {
        const what = e.kind === 'hold' ? 'Hold the pad!' : e.kind === 'hunt' ? 'A marked Pokémon is roaming!' : 'Carry the Egg to the goal!';
        const why = e.kind === 'hold' ? 'Stand on it for 30 s · pays an item ball' : e.kind === 'hunt' ? 'Defeat it and it may join you' : 'Walk into it · it pays an evolution';
        if (e.phase === 'offer') { ui.banner(what, why, 2.6); audio.chest(); }
        else if (e.phase === 'done') { ui.banner(e.kind === 'hunt' ? 'Hunt complete!' : e.kind === 'hold' ? 'Pad charged!' : 'Egg delivered!', e.reward === 'recruit' ? 'It wants to join you' : e.reward === 'item' ? 'You found an item ball!' : e.reward === 'heal' ? 'Your squad is fully healed' : '', 2.2); audio.levelUp(); }
        else if (e.phase === 'expired') ui.banner('The objective slipped away', 'Here they come…', 1.8);
        else if (e.phase === 'failed') audio.brace();
        break;
      }
      case 'weatherEvent': ui.banner(e.kind === 'rain' ? 'It started to rain!' : 'The sunlight turned harsh!', e.kind === 'rain' ? 'Water soaks the ground · Fire weakens' : 'Fire is stronger · the grass may catch', 2.2); break;
      case 'block': audio.guard(); break;
      case 'benchEvolve': audio.evolveDone(); ui.banner(`${SPECIES_BY_ID[e.from].name} evolved into ${SPECIES_BY_ID[e.to].name}!`, 'On the bench', 2); break;
    }
  }
}

/** third person: mouse deltas and the right stick turn the camera (and so the aim and the move direction) */
function lookInput(dt: number, live: boolean) {
  const [mx, my] = input.consumeMouse();
  if (!live) return;
  const sens = settings.sens, inv = settings.invertY ? -1 : 1;
  let yaw = mx * 0.0022 * sens, pitch = my * 0.0018 * sens * inv;
  const [rx, ry] = input.lookStick();
  if (rx || ry) { yaw += rx * 2.6 * sens * dt; pitch += ry * 1.5 * sens * inv * dt; }
  if (yaw || pitch) renderer.look(yaw, pitch);
}

// third person: until the browser has given us the mouse, say how to get it (gamepad players never see this)
const lockHint = document.createElement('div');
lockHint.setAttribute('role', 'status');
lockHint.style.cssText = 'position:fixed;left:50%;bottom:92px;transform:translateX(-50%);padding:6px 14px;border-radius:10px;background:rgba(20,28,44,.82);color:#fff;font:600 14px system-ui,sans-serif;pointer-events:none;z-index:5;display:none';
lockHint.textContent = 'Click the game to aim with the mouse · Esc pauses';
document.body.appendChild(lockHint);
function updateLockHint(c: SimContext | null) {
  const show = !!c && renderer.chase && !paused && c.state === 'play' && !input.locked && input.context === 'play' && !input.pad();
  const want = show ? 'block' : 'none';
  if (lockHint.style.display !== want) lockHint.style.display = want;
}

let startPrev = false;
let dpadPrev = [false, false, false, false];
/** gamepad d-pad on the banked-pick tray: left / up / right pick cards 1 / 2 / 3, down rerolls */
function trayPad() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  const p = pads && pads[0];
  if (!p) return;
  const now = [14, 12, 15, 13].map((i) => !!p.buttons[i]?.pressed);
  if (ui.trayOpen() && !paused) {
    for (let k = 0; k < 3; k++) if (now[k] && !dpadPrev[k]) ui.cardClick(k);
    if (now[3] && !dpadPrev[3]) ui.cardKey('reroll');
  }
  dpadPrev = now;
}
function frame(now: number) {
  requestAnimationFrame(frame);
  // input context: menus own the keyboard/gamepad while open; gameplay keys apply only in play
  input.context = ui.menuOpen() ? 'menu' : 'play';
  ui.padTick(1 / 60);
  trayPad();
  { const pd = input.pad(); const st = !!pd?.start; if (st && !startPrev && ctx && ctx.state !== 'over' && ctx.state !== 'victory' && (input.context === 'play' || paused)) setPaused(!paused); startPrev = st; }
  if (capture) return;
  let real = Math.min(0.25, (now - lastFrame) / 1000);
  lastFrame = now;
  fpsAcc += real; fpsN++;
  if (fpsAcc > 0.5) { fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }
  audioTick(real);
  if (!ctx) {
    renderer.aim.on = false;
    updateLockHint(null);
    // attract mode: slowly orbit an empty meadow behind the title
    if (attract) {
      // drift the view slowly along the route behind the title
      const a = attract.player, t = performance.now() / 1000;
      a.px = a.x; a.pz = a.z;
      a.x = attract.world.spawn[0] + Math.sin(t * 0.07) * 14; a.z = attract.world.spawn[1] - 6 + Math.cos(t * 0.05) * 9;
      renderer.render(attract, 1, real, real);
    }
    return;
  }
  const c = ctx;
  updateLockHint(c);
  if (renderer.chase) lookInput(real, !paused && input.context === 'play' && c.state !== 'over' && c.state !== 'victory');
  const tSim0 = performance.now();
  let simDt = 0;
  if (!paused && c.state !== 'over' && c.state !== 'victory') {
    let scale = speed;
    if (hitstop > 0) { hitstop -= real; scale *= c.rules.sim.hitstopScale; }
    if (c.state === 'dead') scale *= c.rules.sim.deathTimeScale;
    if (c.cards.offer && (autoplay || params.has('autopick'))) pendingCard = { action: 'pick', index: 0 };
    acc += real * scale;
    simDt = real * scale;
    let steps = 0;
    const maxSteps = Math.max(5, Math.ceil(speed * 5));
    while (acc >= c.dt && steps < maxSteps) {
      const inp = autoplay ? botInput(c) : sampleInput(c);
      if (pendingCard) { inp.card = pendingCard; pendingCard = undefined; }
      const ev = step(c, inp);
      onEvents(c, ev);
      acc -= c.dt;
      steps++;
      if ((c.state as string) === 'over' || (c.state as string) === 'victory') { onEnd(c); break; }
    }
    if (steps >= maxSteps) acc = 0;
    // performance governor [C]: every 2 s, adapt the live enemy cap to frame rate
    govT += real;
    const G = c.rules.enemy.governor;
    if (govT > G.window && !autoplay) {
      govT = 0;
      if (fps < G.targetFps && c.enemies.count > 200) { c.director.liveCap = Math.max(200, Math.floor(c.enemies.count * G.dropTo)); govGood = 0; }
      else if (++govGood >= 3) c.director.liveCap = Math.min(c.rules.enemy.liveCap, c.director.liveCap + G.raiseBy);
    }
  }
  if (c.state !== 'evolving') ui.show('overlay-evolve', false);
  const tSim1 = performance.now();
  const alpha = Math.max(0, Math.min(1, acc / c.dt));
  audio.intensity = Math.min(1, c.enemies.count / 500 + (c.director.bossIndex >= 0 ? 0.5 : 0));
  renderer.render(c, alpha, real, paused ? 0 : simDt);
  const tR = performance.now();
  perf.sim = perf.sim * 0.9 + (tSim1 - tSim0) * 0.1; perf.render = perf.render * 0.9 + (tR - tSim1) * 0.1;
  ui.update(c, real, fps);
  ui.drawNumbers(renderer.nums, (x, y, z) => renderer.project(x, y, z), renderer.canvas.width, renderer.canvas.height, renderer.pixelScale);
  if (ctx) ui.objective(ctx, (x, y, z) => renderer.project(x, y, z), renderer.canvas.width, renderer.canvas.height, renderer.pixelScale);
  if (ctx && debugCaps) ui.capsDebug(ctx, (x, y, z) => renderer.project(x, y, z), renderer.canvas.width, renderer.canvas.height, renderer.pixelScale);
}

// music director input: how crowded the player's surroundings are (sampled 4x a second)
let nearT = 0, enemiesNear = 0;
function audioTick(dt: number) {
  const c = ctx;
  if (c && c.state !== 'over' && c.state !== 'victory') {
    nearT -= dt;
    if (nearT <= 0) {
      nearT = 0.25;
      let n = 0; const E = c.enemies, P = c.player;
      for (let i = 0; i < E.hi; i++) if (E.alive[i]) { const dx = E.x[i] - P.x, dz = E.z[i] - P.z; if (dx * dx + dz * dz < 144) n++; }
      enemiesNear = n;
    }
    audio.tick(dt, { inRun: c.state === 'play', enemiesNear, enemies: c.enemies.count, boss: c.director.bossIndex >= 0 && c.enemies.alive[c.director.bossIndex] === 1 });
  } else audio.tick(dt);
}

let ended = false;
let endTimer = 0;
/** a restart or quit before the end screen has appeared must cancel it */
function cancelEnd() { clearTimeout(endTimer); ended = false; }
let debugCaps = params.get('debug') === 'caps';

function onEnd(c: SimContext) {
  if (ended && c === ctx) return;
  ended = true;
  input.releaseLock();
  ui.hideCards(); // an open offer in the banked-pick tray must not outlive the run
  if (c.state === 'victory') audio.onVictory();
  endTimer = setTimeout(() => { ended = false; if (c === ctx) ui.end(c, c.state === 'victory'); }, 600) as unknown as number;
}

let attract: SimContext | null = null;

/** capture mode: advance the run by `seconds` of sim time (bot or idle input) and draw one frame */
function advance(seconds: number, opts: { bot?: boolean; input?: Partial<InputFrame>; frames?: number } = {}) {
  const c = ctx ?? attract;
  if (!c) return;
  const frames = Math.max(1, opts.frames ?? 1);
  const per = seconds / frames;
  for (let f = 0; f < frames; f++) {
    let n = Math.round(per / c.dt);
    if (ctx) {
      while (n-- > 0 && c.state !== 'over' && c.state !== 'victory') {
        const inp: InputFrame = opts.bot ? botInput(c) : { ...sampleInput(c), ...(opts.input ?? {}) } as InputFrame;
        if (c.cards.offer && (opts.bot || params.has('autopick'))) inp.card = { action: 'pick', index: 0 };
        if (pendingCard) { inp.card = pendingCard; pendingCard = undefined; }
        onEvents(c, step(c, inp));
      }
    }
    audioTick(per);
    renderer.render(c, 1, per, ctx ? per : 0);
    if (ctx) { ui.update(c, per, 60); ui.drawNumbers(renderer.nums, (x, y, z) => renderer.project(x, y, z), renderer.canvas.width, renderer.canvas.height, renderer.pixelScale); ui.objective(c, (x, y, z) => renderer.project(x, y, z), renderer.canvas.width, renderer.canvas.height, renderer.pixelScale); if (debugCaps) ui.capsDebug(c, (x, y, z) => renderer.project(x, y, z), renderer.canvas.width, renderer.canvas.height, renderer.pixelScale); }
  }
}



async function boot() {
  ui.loading(0);
  renderer = new Renderer(canvas);
  renderer.quality = settings.quality;
  renderer.cam = cameraPreset(params.get('cam') ?? settings.camera);
  renderer.shakeScale = settings.shake;
  renderer.fovOffset = settings.fov;
  input.chase = renderer.chase;
  input.onLockLost = () => { if (ctx && !paused && (ctx.state === 'play' || ctx.state === 'dead') && !ui.menuOpen()) setPaused(true); };
  resize();
  window.addEventListener('resize', resize);
  (window as any).pokewatch = {
    // Phase 8a: pokewatch.debug('caps') toggles the capability overlay; pokewatch.caps(s) lists the last s seconds of
    // capability events; pokewatch.recap() is the death recap as it would read now
    debug: (what = 'caps') => { debugCaps = what === 'caps' ? !debugCaps : false; return debugCaps; },
    caps: (seconds = 3) => (ctx ? ctx.caplog.since(ctx.time - seconds).map((r) => debugLine(r, ctx!.time)) : []),
    recap: () => (ctx ? buildRecap(ctx.caplog, ctx.time, ctx.rules.caps.recapSeconds) : []),
    cries, MOVE_SFX, TRACKS, advance, damage: (n: number) => { if (ctx) { ctx.player.iframes = 0; damagePlayer(ctx, n, ctx.player.x + 1, ctx.player.z); } }, spawn: (id: string, dx: number, dz: number, role = 0) => ctx ? spawnEnemy(ctx, id, ctx.player.x + dx, ctx.player.z + dz, role) : -1, addLevel: () => ctx && gainXp(ctx, ctx.player.xpNext - ctx.player.xp + 0.01), agent: (a: 'heat' | 'wet' | 'cold' | 'charge', dx: number, dz: number, r = 1) => { if (ctx) applyAgent(ctx, a, ctx.player.x + dx, ctx.player.z + dz, r); }, body: (kind: string, dx: number, dz: number, vx = 0, vz = 0, team = 0) => ctx ? spawnBody(ctx, kind, ctx.player.x + dx, ctx.player.z + dz, vx, vz, team) : -1, perf, renderer, ui, audio, rules: null, ctx: null, createRun, step, xpNext, MODES,
    objective: (kind: 'hold' | 'hunt' | 'transport') => !!ctx && startObjective(ctx, kind),
    // Phase 8b: pokewatch.tech('undertow') gives the trainer a technique; pokewatch.xf('pressure_jet') transforms the field
    // Pokémon's move that has it; pokewatch.build() lists the build (testing and playtest setups)
    tech: (id: string) => !!ctx && addTechnique(ctx, id),
    xf: (id: string) => { if (!ctx) return false; const s = ctx.player.moves.find((m) => TRANSFORM_MOVE(id) === m.key); return !!s && setTransform(ctx, s, id); },
    metrics: () => (ctx ? artMetrics(renderer, ctx) : null),
    build: () => (ctx ? { techs: ctx.player.techs, transforms: ctx.player.squad.map((m) => m.moves.map((s) => s.key + (s.xf ? '>' + s.xf : ''))), picks: ctx.build.history } : null),
    composition: (id: string) => { const d = COMPOSITIONS.find((c) => c.id === id); return ctx && d ? spawnComposition(ctx, d) : []; } };
  await renderer.loadArt(ART as unknown as ArtBundle, (f) => ui.loading(f * 0.6));
  console.info(`[boot] Pokémon loaded at ${Math.round(performance.now())} ms`);
  // paint the first region now; the others are painted in the background (see below)
  { const pre = createRun({ seed: 7, species: DEFAULT_SPECIES }); renderer.prepareStage(pre); ui.loading(0.97); }
  console.info(`[boot] stages ready at ${Math.round(performance.now())} ms`);
  attract = createRun({ seed: 7, species: DEFAULT_SPECIES });
  renderer.setStage(attract);
  ui.loading(1);
  requestAnimationFrame(frame);
  // URL shortcuts for testing: ?species=hootz&mode=classic&seed=3&go=1&autoplay=1&speed=4
  if (params.has('go')) {
    const mode = MODES.find((m) => m.id === params.get('mode')) ?? MODES[0];
    startRun(mode, params.get('species') ?? DEFAULT_SPECIES, Number(params.get('seed') ?? 1));
    if (params.has('stage') && ctx) { startStage(ctx, Number(params.get('stage'))); renderer.setStage(ctx); audio.setBiome(ctx.world.biome); }
    if (params.has('stageTime') && ctx) { const t = Number(params.get('stageTime')); (ctx as SimContext).stageTime = t; (ctx as SimContext).time = t; }
    if (params.has('tp') && ctx) { const [tx, ty] = params.get('tp')!.split(',').map(Number); const c = ctx as SimContext; const h = c.world.half; c.player.x = c.player.px = tx - h + 0.5; c.player.z = c.player.pz = ty - h + 0.5; c.player.y = c.player.py = c.world.height(c.player.x, c.player.z); renderer.setStage(c); }
    if (params.has('calm') && ctx) (ctx as SimContext).rules.director.spawnBase = -99;
    if (params.has('level') && ctx) { const L = Number(params.get('level')); for (let i = 1; i < L; i++) gainXp(ctx, ctx.player.xpNext - ctx.player.xp + 0.01); }
    // squad=mareep,geodude: recruits join at once, at squad level (testing)
    if (params.has('squad') && ctx) { for (const id of params.get('squad')!.split(',')) addMember(ctx, id); }
    // techs=undertow,lodestone and xf=pressure_jet: start with a build (Phase 8b playtest setups)
    if (params.has('techs') && ctx) { for (const id of params.get('techs')!.split(',')) addTechnique(ctx, id); }
    if (params.has('xf') && ctx) { for (const id of params.get('xf')!.split(',')) (window as any).pokewatch.xf(id); }
  } else { ui.title(); audio.titleMusic(); }
  (window as any).pokewatch.ready = true;
  document.title = 'Poke-Watch';
  // paint the remaining regions one at a time while the player is on the menus
  let next = 1;
  const paintNext = () => {
    if (next >= STAGES.length) return;
    if (ctx && ctx.state === 'play') { setTimeout(paintNext, 1500); return; }
    const pre = createRun({ seed: 7, species: DEFAULT_SPECIES });
    startStage(pre, next++);
    renderer.prepareStage(pre);
    setTimeout(paintNext, 250);
  };
  setTimeout(paintNext, 600);
}

boot().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;inset:20px;color:#fff;background:#300;padding:20px;white-space:pre-wrap;z-index:9">Poke-Watch failed to start:\n${String(e?.stack ?? e)}</pre>`);
});
