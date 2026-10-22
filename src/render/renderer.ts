// Presentation layer: reads sim state (never writes it), turns sim events into VFX.
// DS-era 2.5D: a fixed three-quarter camera at exactly 16 screen pixels per metre, the tile
// stage (render/tilestage.ts) for the world, and every creature drawn from the asset layer
// (src/assets) as an upright pixel billboard with per-frame anchors.
import { ELEMENTS, ELEMENT_DEFS, type Element } from '../rules/elements';
import { SPECIES, SPECIES_BY_ID, type SpeciesDef } from '../rules/species';
import { BIOMES } from '../rules/stages';
import { BODY_KINDS, BODY_TEMPLATES } from '../rules/materials';
import { ROLE, PK, ZK } from '../sim/pools';
import type { SimContext, SimEvent } from '../sim/types';
import { pinchActive } from '../sim/combat';
import { MOVE_BY_KEY } from '../rules/moves';
const MOVE_NAMES: Record<string, string> = new Proxy({}, { get: (_t, k: string) => MOVE_BY_KEY[k]?.name });
import { CAST_CLIP, TEXELS_PER_METRE, clipLength, dirIndex, frameAt, hitTime, type AnimState, type CreatureArt } from '../assets/art';
import { loadBuiltinArt, type ArtBundle } from '../assets/builtin';
import { registry } from '../assets/registry';
import { InstanceBatch, QUAD_CENTER, QUAD_FEET } from './batches';
import { hexToRgb, mat4, Program, type GL } from './gl';
import { DECAL_FS, DECAL_VS, GLOW_FS, GLOW_VS, RIBBON_FS, RIBBON_VS } from './shaders';
import { TileStage, FOG_GLSL, NO_FOG, type Fog } from './tilestage';
import { PixelLayer } from './pixelfx';
import { ELEMENT_FX } from './pixelart';
import { skyFor } from './sky';
import { cameraPreset, ChaseRig, chaseAim, NO_THREAT, type CameraPreset, type ChaseThreat } from './camera';

// creature billboard: per-frame rect + anchor, stretched like the props so texels stay square on screen
const CREATURE_VS = `
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 iA; // x y z scale
layout(location=2) in vec4 iB; // frame w h, anchor x y (texels)
layout(location=3) in vec4 iUV; // u0 v0 u1 v1
layout(location=4) in vec4 iC; // flash dissolve dx(m, along right) bias
layout(location=5) in vec4 iD; // tint rgb, dy (m)
uniform mat4 uVP; uniform vec3 uRight; uniform vec3 uFwd; uniform float uStretch; uniform vec3 uFogCam;
out vec2 vUV; out float vFlash; out float vDis; out vec3 vTint; out vec3 vW;
void main(){
  float tx = (aCorner.x + 0.5) * iB.x;
  float ty = aCorner.y * iB.y;
  // third person (uStretch <= 0): stretch by 1/cos of the elevation this creature is seen at
  float st = uStretch;
  if (st <= 0.0) { vec3 d = iA.xyz - uFogCam; st = clamp(length(d) / max(length(d.xz), 0.5), 1.0, 1.6); }
  float lx = (tx - iB.z) / ${TEXELS_PER_METRE}.0 * iA.w + iC.z;
  float ly = (ty - (iB.y - iB.w)) / ${TEXELS_PER_METRE}.0 * iA.w * st + iD.w;
  vec3 w = iA.xyz + uRight * lx + vec3(0.0, ly, 0.0) - uFwd * iC.w;
  vUV = vec2(mix(iUV.x, iUV.z, aCorner.x + 0.5), mix(iUV.w, iUV.y, aCorner.y));
  vFlash = iC.x; vDis = iC.y; vTint = iD.xyz; vW = w;
  gl_Position = uVP * vec4(w, 1.0);
}`;
const CREATURE_FS = `
in vec2 vUV; in float vFlash; in float vDis; in vec3 vTint; in vec3 vW;
uniform sampler2D uTex; uniform vec3 uLight; uniform vec4 uSil; out vec4 o;
${FOG_GLSL}
void main(){
  vec4 c = texture(uTex, vUV);
  if (c.a < 0.5) discard;
  // x-ray silhouette of the active Pokémon where something stands in front of it (drawn with depth GREATER)
  // the sprite's own dark outline stays dark, the body becomes a cyan/white checker: reads over any crowd or canopy
  if (uSil.a > 0.0) {
    if (dot(c.rgb, vec3(0.299, 0.587, 0.114)) < 0.2) { o = vec4(0.04, 0.1, 0.16, 1.0); return; }
    vec2 q = mod(floor(gl_FragCoord.xy), 2.0);
    o = vec4(q.x == q.y ? uSil.rgb : vec3(0.92, 1.0, 1.0), 1.0); return;
  }
  if (vDis > 0.0) { vec2 g = mod(floor(gl_FragCoord.xy), 4.0); float th = (g.x * 4.0 + g.y) / 16.0; if (th < vDis) discard; }
  vec3 col = applyFog(min(c.rgb * vTint * uLight, vec3(1.0)), vW);
  o = vec4(mix(col, vec3(1.0), vFlash), 1.0);
}`;

// screen-edge darkening (art direction: frames the play space like a lantern-lit expedition map), quantised with a
// 4x4 ordered dither so it stays on the pixel grid; one full-screen triangle, no texture
const VIG_VS = `
out vec2 vP;
void main(){ vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); vP = p; gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;
const VIG_FS = `
in vec2 vP; uniform vec2 uAspect; uniform vec4 uVig; out vec4 o;
void main(){
  vec2 q = (vP - 0.5) * uAspect;
  float r = length(q);
  float a = uVig.a * smoothstep(0.55, 1.0, r);
  ivec2 c = ivec2(mod(floor(gl_FragCoord.xy), 4.0));
  int b[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  float th = (float(b[c.y * 4 + c.x]) + 0.5) / 16.0;
  float step4 = floor(a * 4.0 + th) / 4.0; // four flat levels, dithered between
  if (step4 <= 0.0) discard;
  o = vec4(uVig.rgb, step4);
}`;

// third-person sky: a vertical gradient from the fog colour at the horizon to a deeper zenith, quantised into six
// dithered bands so it stays on the pixel grid. uHz = horizon height in NDC (y up); below it the fog colour fills.
const SKY_FS = `
in vec2 vP; uniform vec3 uHor; uniform vec3 uZen; uniform float uHz; out vec4 o;
void main(){
  float y = vP.y * 2.0 - 1.0;
  float t = clamp((y - uHz) / max(0.15, 1.6 - uHz), 0.0, 1.0);
  ivec2 c = ivec2(mod(floor(gl_FragCoord.xy), 4.0));
  int b[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  float th = (float(b[c.y * 4 + c.x]) + 0.5) / 16.0;
  float q = floor(pow(t, 0.7) * 6.0 + th) / 6.0;
  o = vec4(mix(uHor, uZen, q), 1.0);
}`;

/** sprite tint per coat (rules/reactions.ts AG index) and the ring colour under coated elites, bosses and you */
const COAT_TINT: [number, number, number][] = [[1, 1, 1], [1.3, 0.85, 0.6], [0.72, 0.9, 1.35], [0.8, 1.15, 1.3], [1.3, 1.25, 0.6]];
const COAT_RING: [number, number, number][] = [[1, 1, 1], [1, 0.45, 0.15], [0.3, 0.6, 1], [0.6, 0.95, 1], [1, 0.9, 0.2]];
const ELC: Record<string, [number, number, number]> = Object.fromEntries(ELEMENTS.map((e) => [e, hexToRgb(ELEMENT_DEFS[e].color)]));
const TAU = Math.PI * 2;

interface SpriteSet { art: CreatureArt; tex: WebGLTexture; batch: InstanceBatch; tw: number; th: number; walkRate: number }
interface Dying { sp: string; x: number; y: number; z: number; dir: number; frame: number; t: number; scale: number }
interface Ribbon { ax: number; ay: number; az: number; bx: number; by: number; bz: number; w: number; c: [number, number, number]; life: number; max: number }
interface Ring { x: number; z: number; r: number; c: [number, number, number]; life: number; max: number; kind: number; grow: boolean }
interface Num { x: number; y: number; z: number; text: string; color: string; life: number; size: number }

class Particles {
  cap = 6000; n = 0;
  x = new Float32Array(this.cap); y = new Float32Array(this.cap); z = new Float32Array(this.cap);
  vx = new Float32Array(this.cap); vy = new Float32Array(this.cap); vz = new Float32Array(this.cap);
  life = new Float32Array(this.cap); max = new Float32Array(this.cap); size = new Float32Array(this.cap);
  r = new Float32Array(this.cap); g = new Float32Array(this.cap); b = new Float32Array(this.cap); grav = new Float32Array(this.cap);
  add(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, c: number[], grav = 0) {
    if (this.n >= this.cap) return;
    const i = this.n++;
    this.x[i] = x; this.y[i] = y; this.z[i] = z; this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.life[i] = this.max[i] = life; this.size[i] = size; this.r[i] = c[0]; this.g[i] = c[1]; this.b[i] = c[2]; this.grav[i] = grav;
  }
  update(dt: number) {
    for (let i = 0; i < this.n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        const j = --this.n;
        this.x[i] = this.x[j]; this.y[i] = this.y[j]; this.z[i] = this.z[j]; this.vx[i] = this.vx[j]; this.vy[i] = this.vy[j]; this.vz[i] = this.vz[j];
        this.life[i] = this.life[j]; this.max[i] = this.max[j]; this.size[i] = this.size[j]; this.r[i] = this.r[j]; this.g[i] = this.g[j]; this.b[i] = this.b[j]; this.grav[i] = this.grav[j];
        i--; continue;
      }
      this.vy[i] -= this.grav[i] * dt;
      this.x[i] += this.vx[i] * dt; this.y[i] += this.vy[i] * dt; this.z[i] += this.vz[i] * dt;
      const d = Math.exp(-2.2 * dt);
      this.vx[i] *= d; this.vz[i] *= d;
    }
  }
}

export class Renderer {
  gl: GL;
  sheets = new Map<string, SpriteSet>();
  stage: TileStage | null = null;
  private stages = new Map<string, TileStage>();
  private creature: Program; private glow: Program; private decal: Program; private ribbon: Program;
  private silBatch: InstanceBatch; private sky: Program; private vig: Program; private vigVao: WebGLVertexArrayObject;
  private glows: InstanceBatch; private decals: InstanceBatch; private decalsTop: InstanceBatch; private ribbons: InstanceBatch;
  private parts = new Particles();
  private dying: Dying[] = [];
  private rib: Ribbon[] = [];
  private rings: Ring[] = [];
  nums: Num[] = [];
  // camera: fixed DS-style three-quarter view; yaw stays at PI (looking north, -z)
  yaw = Math.PI; pitch = 0.82; dist = 30;
  trauma = 0;
  camX = 0; camY = 0; camZ = 0;
  private leadX = 0; private leadZ = 0;
  eye = [0, 0, 0];
  V = mat4.create(); P = mat4.create(); VP = mat4.create();
  right = [1, 0, 0]; up = [0, 1, 0]; fwd = [0, 0, -1];
  stretch = 1;
  time = 0;
  width = 1; height = 1;
  quality = 1;
  /** camera preset (pitch, fov, internal lines); see render/camera.ts */
  cam: CameraPreset = cameraPreset(undefined);
  /** third-person rig (used when the preset's mode is 'chase') */
  rig = new ChaseRig();
  /** pitch input accumulated since the last frame (radians, down is positive) */
  private lookPitch = 0;
  /** FOV offset in degrees (player setting, -10..+12) */
  fovOffset = 0;
  private lastStageKey: object | null = null;
  /** true while the third-person rig drives the camera */
  get chase() { return this.cam.mode === 'chase'; }
  /** 0..1 multiplier on screen shake (reduced-motion setting) */
  shakeScale = 1;
  pixelScale = 1; // CSS pixels per internal pixel (integer)
  /** aimed combat: the ground point under the cursor (or stick aim), drawn as a reticle */
  aim = { x: 0, z: 0, on: false };
  px: PixelLayer;
  private ambientAcc = 0;
  // animation controller state for the player
  // attack timeline: the pre-hit frames are fitted into the sim's wind-up so the HitFrame lands
  // on the release; the recovery is shortened so long source clips never hold up movement
  private pAnim: { state: AnimState; start: number; until: number; wind: number; hitT: number; postScale: number } = { state: 'idle', start: 0, until: 0, wind: 0, hitT: 0, postScale: 1 };
  private deadAt = -1;
  private lastHp = -1;
  /** evaluation only (pokewatch.metrics): hide layers to measure figure-ground contrast and overlay coverage */
  debugHide = { actors: false, player: false, overlays: false, vignette: false };

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 is required');
    this.gl = gl;
    this.creature = new Program(gl, CREATURE_VS, CREATURE_FS);
    this.glow = new Program(gl, GLOW_VS, GLOW_FS);
    this.decal = new Program(gl, DECAL_VS, DECAL_FS);
    this.ribbon = new Program(gl, RIBBON_VS, RIBBON_FS);
    this.glows = new InstanceBatch(gl, QUAD_CENTER, 2, [4, 4], 2048);
    this.decals = new InstanceBatch(gl, QUAD_CENTER, 2, [4, 4, 4], 4096);
    this.decalsTop = new InstanceBatch(gl, QUAD_CENTER, 2, [4, 4, 4], 64);
    const rq = new Float32Array([0, -1, 1, -1, 1, 1, 0, -1, 1, 1, 0, 1]);
    this.ribbons = new InstanceBatch(gl, rq, 2, [4, 4, 4], 256);
    this.silBatch = new InstanceBatch(gl, QUAD_FEET, 2, [4, 4, 4, 4, 4], 2);
    this.vig = new Program(gl, VIG_VS, VIG_FS);
    this.sky = new Program(gl, VIG_VS, SKY_FS);
    this.vigVao = gl.createVertexArray()!;
    this.px = new PixelLayer(gl);
  }

  /** Load the game's Pokémon (sprites, portraits, cries) from the generated art bundle. */
  async loadArt(bundle: ArtBundle, onProgress?: (f: number) => void) {
    await loadBuiltinArt(bundle, (id, art) => this.addArt(id, art), onProgress);
  }

  /** Upload a creature's atlas (baked or imported) and give it an instance batch. */
  addArt(id: string, art: CreatureArt) {
    const gl = this.gl;
    const old = this.sheets.get(id);
    if (old) gl.deleteTexture(old.tex);
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, art.atlas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const sp = SPECIES_BY_ID[id];
    const batch = old?.batch ?? new InstanceBatch(gl, QUAD_FEET, 2, [4, 4, 4, 4, 4], sp?.boss || sp?.playable ? 4 : 128);
    // walk cadence: 1.6 frames per metre travelled, whatever the source's frame count
    const walk = art.clips.walk;
    const walkRate = (clipLength(walk) / Math.max(1, walk.durations.length)) * 1.6;
    this.sheets.set(id, { art, tex, batch, tw: art.atlas.width, th: art.atlas.height, walkRate });
  }

  portrait(id: string): HTMLCanvasElement | undefined {
    return registry.getArt(id)?.portrait;
  }

  setStage(ctx: SimContext) {
    const st = this.stageFor(ctx);
    this.stage = st;
    this.px.parts = [];
    this.parts.n = 0; this.dying = []; this.rib = []; this.rings = []; this.nums = [];
    this.camX = ctx.player.x; this.camY = ctx.player.y; this.camZ = ctx.player.z;
    this.leadX = this.leadZ = 0;
    this.rig.snapTo(ctx.player.x, ctx.player.y, ctx.player.z, this.chase ? this.rig.yaw : Math.PI);
  }

  /** Pre-build a biome's stage (painting the ground takes a moment) so stage changes don't hitch. */
  prepareStage(ctx: SimContext) { this.stageFor(ctx); }

  /** Stages are keyed by map id (the biome id for authored arenas, biome@seed for generated regions). At most three
   *  generated stages are kept; older ones release their GPU resources. */
  private stageFor(ctx: SimContext): TileStage {
    const id = ctx.world.map.id;
    let st = this.stages.get(id);
    if (st) { this.stages.delete(id); this.stages.set(id, st); return st; }
    st = new TileStage(this.gl, ctx.world.map, ctx.world.biome.id);
    this.stages.set(id, st);
    const generated = [...this.stages.keys()].filter((k) => k.includes('@'));
    while (generated.length > 3) { const old = generated.shift()!; const o = this.stages.get(old)!; if (o !== this.stage) { o.dispose(); this.stages.delete(old); } }
    return st;
  }

  /** DS-style pixel rendering: low internal resolution, integer upscale, nearest filtering. */
  resize(w: number, h: number, dpr: number) {
    void dpr;
    const target = this.cam.lines / Math.max(0.6, this.quality); // internal lines; more lines = a wider view at the same pixel size
    const scale = Math.max(1, Math.round(h / target));
    const iw = Math.max(1, Math.floor(w / scale)), ih = Math.max(1, Math.floor(h / scale));
    this.canvas.width = iw; this.canvas.height = ih;
    this.canvas.style.width = iw * scale + 'px'; this.canvas.style.height = ih * scale + 'px';
    this.canvas.style.imageRendering = 'pixelated';
    this.pixelScale = scale;
    this.width = iw * scale; this.height = ih * scale;
  }

  /** what the camera needs to know about hostiles near (x, z): nearest, weighted crowd within 12 m, nearest boss */
  private threatOf(ctx: SimContext, x: number, z: number): ChaseThreat {
    const E = ctx.enemies;
    let nearest = Infinity, boss = Infinity, weight = 0;
    for (let i = 0; i < E.hi; i++) {
      if (!E.alive[i]) continue;
      const dx = E.x[i] - x, dz = E.z[i] - z, d2 = dx * dx + dz * dz;
      if (d2 > 900) continue;
      const d = Math.sqrt(d2), r = E.roles[i];
      if (d < nearest) nearest = d;
      if (r & ROLE.boss) { if (d < boss) boss = d; }
      if (d < 12) weight += r & ROLE.boss ? 8 : r & ROLE.alpha ? 4 : r & ROLE.elite ? 3 : 1;
    }
    return nearest === Infinity && boss === Infinity ? NO_THREAT : { nearest, weight, boss };
  }

  /** turn the third-person camera: dyaw > 0 turns right, dpitch > 0 looks further down (radians) */
  look(dyaw: number, dpitch: number) {
    // yaw takes effect at once so the move direction and the aim of the very next sim tick already use it
    if (this.chase) { this.rig.yaw = Math.atan2(Math.sin(this.rig.yaw - dyaw), Math.cos(this.rig.yaw - dyaw)); this.yaw = this.rig.yaw; }
    this.lookPitch += dpitch;
  }

  /** a new run: look north and put the rig on the Pokémon */
  resetView(ctx: SimContext) { this.yaw = Math.PI; this.rig.userPitch = 0; this.rig.snapTo(ctx.player.x, ctx.player.y, ctx.player.z, Math.PI); this.lookPitch = 0; }

  /** the third-person aim point (ground, in the camera's yaw plane), or null for the fixed views */
  chaseAim(ctx: SimContext): [number, number] | null {
    if (!this.chase) return null;
    return chaseAim(this.rig, ctx.player.x, ctx.player.z, this.width / this.height, (x, z) => ctx.world.height(x, z));
  }

  addShake(a: number) { this.trauma = Math.min(1, this.trauma + a * this.shakeScale); }

  // ------------------------------------------------------------------ events -> fx
  handleEvents(ctx: SimContext, events: SimEvent[]) {
    const P = ctx.player;
    for (const e of events) {
      switch (e.t) {
        case 'hit': {
          const fx = ELEMENT_FX[e.element] ?? ELEMENT_FX.plain;
          const big = e.crit || e.eff > 1;
          this.px.spawn(big ? 'impactBig' : 'impact', e.x, e.y - 0.3, e.z, 0, 0, 0, big ? 0.16 : 0.1, big ? 2 : 1, 0, 0);
          const n = e.crit ? 4 : 2;
          for (let k = 0; k < n; k++) this.px.spawn(fx[1 + (k % 2)], e.x, e.y - 0.3, e.z, rnd(-4, 4), rnd(2, 5), rnd(-4, 4), rnd(0.25, 0.45), 1, 14, rnd(-8, 8));
          if (this.nums.length < 50 && (e.crit || this.nums.length < 24 || Math.random() < 0.2)) {
            this.nums.push({ x: e.x + rnd(-0.3, 0.3), y: e.y + 0.2, z: e.z, text: String(Math.max(1, Math.round(e.amount))), color: e.crit ? '#ffe14a' : e.eff > 1 ? '#ff8f5a' : e.eff < 1 ? '#b8c0cc' : '#ffffff', life: 0.75, size: e.crit ? 1.3 : 1 });
          }
          break;
        }
        case 'kill': {
          const sp = SPECIES[e.species];
          const set = this.sheets.get(sp.id);
          const scale = e.roles & ROLE.boss ? 1 : e.roles & ROLE.alpha ? ctx.rules.enemy.roles.alpha.size : e.roles & ROLE.elite ? ctx.rules.enemy.roles.elite.size : 1;
          if (set && this.dying.length < 120) this.dying.push({ sp: sp.id, x: e.x, y: e.y, z: e.z, dir: 0, frame: 0, t: 0, scale: scale * (sp.scale ?? 1) });
          const fx = ELEMENT_FX[e.element] ?? ELEMENT_FX.plain;
          for (let k = 0; k < 5; k++) this.px.spawn('dust', e.x + rnd(-0.4, 0.4), e.y + 0.3, e.z + rnd(-0.4, 0.4), rnd(-2, 2), rnd(1, 3), rnd(-2, 2), rnd(0.3, 0.5), 1, 2);
          for (let k = 0; k < 3; k++) this.px.spawn(fx[1], e.x, e.y + 0.5, e.z, rnd(-3, 3), rnd(3, 6), rnd(-3, 3), rnd(0.35, 0.6), 1, 12, rnd(-6, 6));
          break;
        }
        case 'windup': this.playerAttack(e.archetype, e.dur); break;
        case 'cast': this.castFx(ctx, e); if (this.pAnim.until < this.time || this.pAnim.state === 'hurt') this.playerAttack(e.archetype, 0); break;
        case 'beam': {
          const y = P.y + 0.8;
          this.rib.push({ ax: e.x1, ay: y, az: e.z1, bx: e.x2, by: y, bz: e.z2, w: e.width * 1.2, c: ELC[e.element], life: e.life + 0.1, max: e.life + 0.1 });
          const bfx = ELEMENT_FX[e.element] ?? ELEMENT_FX.plain; for (let k = 0; k < 12; k++) { const t = Math.random(); this.px.spawn(bfx[1 + (k % 2)], e.x1 + (e.x2 - e.x1) * t, y, e.z1 + (e.z2 - e.z1) * t, rnd(-1, 1), rnd(0, 2), rnd(-1, 1), rnd(0.3, 0.5), 1, 0, rnd(-6, 6)); }
          break;
        }
        case 'chain': {
          const pts = e.pts;
          for (let k = 0; k + 3 < pts.length; k += 2) {
            const ax = pts[k], az = pts[k + 1], bx = pts[k + 2], bz = pts[k + 3];
            const ay = ctx.world.height(ax, az) + 0.9, by = ctx.world.height(bx, bz) + 0.9;
            // jagged: 3 sub-segments
            let px = ax, py = ay, pz = az;
            for (let s = 1; s <= 3; s++) {
              const t = s / 3;
              const nx = ax + (bx - ax) * t + (s < 3 ? rnd(-0.5, 0.5) : 0), ny = ay + (by - ay) * t + (s < 3 ? rnd(-0.4, 0.4) : 0), nz = az + (bz - az) * t + (s < 3 ? rnd(-0.5, 0.5) : 0);
              this.rib.push({ ax: px, ay: py, az: pz, bx: nx, by: ny, bz: nz, w: 0.22, c: ELC[e.element], life: 0.22, max: 0.22 });
              px = nx; py = ny; pz = nz;
            }
          }
          break;
        }
        case 'ring': this.rings.push({ x: e.x, z: e.z, r: e.r, c: ELC[e.element], life: e.life, max: e.life, kind: 1, grow: true }); break;
        case 'react': {
          const RC: Record<string, [number, number, number]> = { steam: [0.95, 0.97, 1], freeze: [0.6, 0.95, 1], shatter: [0.8, 1, 1], conduct: [1, 0.92, 0.25], overload: [1, 0.55, 0.2], cancel: [0.8, 0.8, 0.85] };
          const c = RC[e.kind] ?? [1, 1, 1];
          this.rings.push({ x: e.x, z: e.z, r: Math.max(1, e.r), c, life: e.deep ? 0.5 : 0.3, max: e.deep ? 0.5 : 0.3, kind: 1, grow: true });
          if (e.deep || e.kind === 'shatter') {
            const label = e.kind[0].toUpperCase() + e.kind.slice(1) + (e.n > 1 ? ' ×' + e.n : '');
            if (this.nums.length < 60) this.nums.push({ x: e.x, y: ctx.world.height(e.x, e.z) + 2.2, z: e.z, text: label, color: '#' + c.map((v) => Math.round(Math.min(1, v) * 255).toString(16).padStart(2, '0')).join(''), life: 0.9, size: 1.15 });
          }
          if (e.kind === 'shatter' || e.kind === 'freeze') for (let k = 0; k < 8; k++) this.px.spawn('snow', e.x + rnd(-0.5, 0.5), ctx.world.height(e.x, e.z) + 0.6, e.z + rnd(-0.5, 0.5), rnd(-2, 2), rnd(1, 3), rnd(-2, 2), 0.5, 1);
          break;
        }
        case 'hex': this.rings.push({ x: e.x, z: e.z, r: e.r, c: ELC[e.element], life: e.life, max: e.life, kind: 2, grow: false }); break;
        case 'block': this.rings.push({ x: e.x, z: e.z, r: 0.9, c: [0.85, 0.92, 1], life: 0.2, max: 0.2, kind: 1, grow: true }); break;
        case 'telegraph': this.rings.push({ x: e.x, z: e.z, r: e.r, c: e.hostile ? [1, 0.2, 0.2] : [1, 0.85, 0.3], life: e.life, max: e.life, kind: 2, grow: false }); break;
        case 'line': {
          const y0 = ctx.world.height(e.x1, e.z1) + 0.15, y1 = ctx.world.height(e.x2, e.z2) + 0.15;
          this.rib.push({ ax: e.x1, ay: y0, az: e.z1, bx: e.x2, by: y1, bz: e.z2, w: e.width, c: [1, 0.15, 0.15], life: e.life, max: e.life * 3 });
          break;
        }
        case 'smite': {
          const y = ctx.world.height(e.x, e.z);
          this.rib.push({ ax: e.x, ay: y + 14, az: e.z, bx: e.x, by: y, bz: e.z, w: 0.9, c: ELC[e.element], life: 0.3, max: 0.3 });
          this.rings.push({ x: e.x, z: e.z, r: 2.4, c: ELC[e.element], life: 0.4, max: 0.4, kind: 1, grow: true });
          break;
        }
        case 'pickup': {
          const c = e.kind === 1 ? [1, 0.5, 0.7] : e.kind === 2 ? [1, 0.9, 0.3] : [0.5, 0.9, 1];
          for (let k = 0; k < 3; k++) this.parts.add(P.x, P.y + 0.8, P.z, rnd(-2, 2), rnd(1, 3), rnd(-2, 2), 0.3, 0.2, c);
          break;
        }
        case 'levelUp':
          for (let k = 0; k < 24; k++) { const a = rnd(0, TAU); this.px.spawn('star', P.x + Math.cos(a) * 0.8, P.y + 0.2, P.z + Math.sin(a) * 0.8, Math.cos(a) * 1.5, rnd(3, 7), Math.sin(a) * 1.5, 0.9, 1, 2, rnd(-4, 4)); }
          this.rings.push({ x: P.x, z: P.z, r: 3, c: [1, 0.95, 0.5], life: 0.5, max: 0.5, kind: 1, grow: true });
          break;
        case 'evolveEnd':
          for (let k = 0; k < 70; k++) { const a = rnd(0, TAU); this.px.spawn(k % 3 ? 'star' : 'impact', P.x, P.y + 1, P.z, Math.cos(a) * rnd(2, 9), rnd(1, 9), Math.sin(a) * rnd(2, 9), rnd(0.6, 1.2), 1, 4, rnd(-5, 5)); }
          this.rings.push({ x: P.x, z: P.z, r: 7, c: [1, 1, 1], life: 0.8, max: 0.8, kind: 1, grow: true });
          break;
        case 'playerHurt':
          this.nums.push({ x: P.x, y: P.y + 2, z: P.z, text: '-' + Math.round(e.amount), color: '#ff5a5a', life: 0.8, size: 1.1 });
          break;
        case 'heal':
          if (e.amount >= 2) this.nums.push({ x: P.x, y: P.y + 2.2, z: P.z, text: '+' + Math.round(e.amount), color: '#7dff8a', life: 0.8, size: 1 });
          break;
        case 'shake': {
          const d = Math.hypot(e.x - P.x, e.z - P.z);
          this.addShake(e.amount * Math.max(0.2, 1 - d / 40));
          break;
        }
        case 'dash':
          for (let k = 0; k < 8; k++) this.px.spawn('dust', P.x, P.y + 0.2, P.z, rnd(-2, 2), rnd(0, 2), rnd(-2, 2), 0.35, 1);
          break;
        case 'jump':
          for (let k = 0; k < 5; k++) this.px.spawn('dust', P.x, P.y + 0.1, P.z, rnd(-2, 2), rnd(0.5, 1.5), rnd(-2, 2), 0.3, 1);
          break;
        case 'bossDead': {
          const y = ctx.world.height(e.x, e.z);
          for (let k = 0; k < 120; k++) { const a = rnd(0, TAU); this.px.spawn(k % 4 ? 'star' : 'impactBig', e.x, y + 2, e.z, Math.cos(a) * rnd(2, 14), rnd(2, 14), Math.sin(a) * rnd(2, 14), rnd(0.8, 1.6), k % 4 ? 1 : 2, 6, rnd(-5, 5)); }
          break;
        }
        case 'chest':
          for (let k = 0; k < 30; k++) this.px.spawn('star', e.x, ctx.world.height(e.x, e.z) + 0.8, e.z, rnd(-3, 3), rnd(3, 8), rnd(-3, 3), 1, 1, 9, rnd(-5, 5));
          break;
        case 'stageStart':
          this.setStage(ctx);
          break;
        case 'deflect': case 'parry':
          this.rings.push({ x: e.x, z: e.z, r: 1.6, c: [1, 1, 1], life: 0.25, max: 0.25, kind: 1, grow: true });
          this.addShake(0.12);
          break;
        case 'push':
          // a push that moved it: a white burst; too heavy: a grey "clunk" ring and a word
          if (!e.ok && this.nums.length < 50 && Math.random() < 0.5) this.nums.push({ x: e.x, y: ctx.world.height(e.x, e.z) + 2, z: e.z, text: 'too heavy', color: '#c8ccd8', life: 0.6, size: 0.8 });
          if (e.combined && this.nums.length < 50) this.nums.push({ x: e.x, y: ctx.world.height(e.x, e.z) + 2.2, z: e.z, text: 'combined!', color: '#ffffff', life: 0.8, size: 0.9 });
          this.rings.push({ x: e.x, z: e.z, r: e.ok ? (e.combined ? 2.2 : 1.4) : 1.0, c: e.ok ? [1, 1, 1] : [0.45, 0.45, 0.5], life: 0.25, max: 0.25, kind: 1, grow: e.ok });
          break;
        case 'bodyHit':
          if (e.amount > 0.5 && this.nums.length < 50) this.nums.push({ x: e.x + rnd(-0.3, 0.3), y: e.y + 0.3, z: e.z, text: String(Math.round(e.amount)), color: e.eff > 1 ? '#ff8f5a' : e.eff < 1 ? '#b8c0cc' : '#e8dcc0', life: 0.7, size: 1 });
          for (let k = 0; k < 3; k++) this.px.spawn('rockChunk', e.x, e.y, e.z, rnd(-2, 2), rnd(1, 3), rnd(-2, 2), 0.4, 1, 9, rnd(-6, 6));
          break;
        case 'break':
          for (let k = 0; k < 10 + e.r * 10; k++) this.px.spawn(k % 3 ? 'rockChunk' : 'dust', e.x + rnd(-e.r, e.r), ctx.world.height(e.x, e.z) + rnd(0.2, 1.2), e.z + rnd(-e.r, e.r), rnd(-4, 4), rnd(2, 6), rnd(-4, 4), 0.7, 1, 14, rnd(-8, 8));
          this.rings.push({ x: e.x, z: e.z, r: e.r * 2.2, c: [0.85, 0.75, 0.55], life: 0.35, max: 0.35, kind: 1, grow: true });
          break;
        case 'spark':
          this.rings.push({ x: e.x, z: e.z, r: 1.4, c: [1, 0.95, 0.3], life: e.life, max: e.life, kind: 2, grow: false });
          for (let k = 0; k < 4; k++) this.px.spawn('spark', e.x + rnd(-0.5, 0.5), ctx.world.height(e.x, e.z) + rnd(0.5, 1.2), e.z + rnd(-0.5, 0.5), rnd(-1, 1), rnd(0.5, 1.5), rnd(-1, 1), 0.3, 1);
          break;
        case 'brace':
          this.rings.push({ x: P.x, z: P.z, r: 1.3, c: [0.55, 0.8, 1], life: 0.2, max: 0.2, kind: 1, grow: true });
          break;
        case 'tag': {
          // a white puff where the Pokémon swap places
          this.rings.push({ x: P.x, z: P.z, r: 1.6, c: [1, 1, 1], life: 0.3, max: 0.3, kind: 1, grow: true });
          for (let k = 0; k < 8; k++) this.px.spawn('dust', P.x + rnd(-0.5, 0.5), P.y + 0.4, P.z + rnd(-0.5, 0.5), rnd(-3, 3), rnd(1, 3), rnd(-3, 3), rnd(0.3, 0.5), 1, 2);
          break;
        }
        case 'tagAction':
          if (this.nums.length < 60) this.nums.push({ x: P.x, y: P.y + 2.2, z: P.z, text: (MOVE_NAMES[e.key] ?? e.key) + '!', color: '#9fe7ff', life: 0.9, size: 1 });
          break;
        case 'ability':
          if (this.nums.length < 60) this.nums.push({ x: e.x, y: ctx.world.height(e.x, e.z) + 2.4, z: e.z, text: e.name + '!', color: '#fff3a0', life: 1.1, size: 0.9 });
          break;
      }
    }
  }

  private castFx(ctx: SimContext, e: Extract<SimEvent, { t: 'cast' }>) {
    const c = ELC[e.element];
    const P = ctx.player;
    const y = P.y + 0.7;
    switch (e.archetype) {
      case 'strike': {
        const ty = ctx.world.height(e.tx, e.tz) + 0.6;
        this.rings.push({ x: e.tx, z: e.tz, r: 1.7, c, life: 0.18, max: 0.18, kind: 1, grow: true });
        const a = Math.atan2(e.tx - e.x, e.tz - e.z);
        const sfx = ELEMENT_FX[e.element] ?? ELEMENT_FX.plain; this.px.spawn('impactBig', e.tx, ty, e.tz, 0, 0, 0, 0.12, 2); for (let k = -2; k <= 2; k++) { const b = a + k * 0.3; this.px.spawn(sfx[1], e.tx, ty, e.tz, Math.sin(b) * 6, rnd(0, 1), Math.cos(b) * 6, 0.22, 1, 0, rnd(-6, 6)); }
        break;
      }
      case 'cone': {
        const a = Math.atan2(e.tx - e.x, e.tz - e.z);
        const cfx = ELEMENT_FX[e.element] ?? ELEMENT_FX.plain; for (let k = 0; k < 22; k++) { const b = a + rnd(-0.8, 0.8); const sp = rnd(7, 14); this.px.spawn(k % 3 ? cfx[1] : cfx[0], e.x, y, e.z, Math.sin(b) * sp, rnd(-0.5, 1.5), Math.cos(b) * sp, rnd(0.35, 0.55), 1, 0, rnd(-6, 6)); }
        break;
      }
      case 'aura':
        this.rings.push({ x: P.x, z: P.z, r: 3, c, life: 0.3, max: 0.3, kind: 1, grow: false });
        const afx = ELEMENT_FX[e.element] ?? ELEMENT_FX.plain; for (let k = 0; k < 5; k++) { const a = rnd(0, TAU); this.px.spawn(afx[1], P.x + Math.cos(a) * 2.6, y, P.z + Math.sin(a) * 2.6, 0, rnd(1, 3), 0, 0.4, 1, 0, rnd(-4, 4)); }
        break;
      case 'buff': case 'weather':
        const wfx = ELEMENT_FX[e.element] ?? ELEMENT_FX.plain; for (let k = 0; k < 20; k++) { const a = rnd(0, TAU); this.px.spawn(wfx[1 + (k % 2)], P.x + Math.cos(a), P.y + 0.2, P.z + Math.sin(a), 0, rnd(3, 6), 0, 0.8, 1, 0, rnd(-4, 4)); }
        break;
      case 'dash':
        const dfx = ELEMENT_FX[e.element] ?? ELEMENT_FX.plain; for (let k = 0; k < 8; k++) this.px.spawn(dfx[1], P.x, y, P.z, rnd(-1, 1), rnd(0, 1), rnd(-1, 1), 0.4, 1, 0, rnd(-6, 6));
        break;
    }
  }

  // ------------------------------------------------------------------ frame
  render(ctx: SimContext, alpha: number, dt: number, simDt: number) {
    const gl = this.gl;
    this.time += dt;
    const P = ctx.player;
    const C = ctx.rules.camera;
    const px = P.px + (P.x - P.px) * alpha, py = P.py + (P.y - P.py) * alpha, pz = P.pz + (P.z - P.pz) * alpha;
    // camera: follow with a small lead in the movement direction, settle on the ground height
    const sp = Math.hypot(P.vx, P.vz);
    const lk = 1 - Math.exp(-3 * dt);
    this.leadX += ((sp > 0.5 ? (P.vx / sp) * C.lead : 0) - this.leadX) * lk;
    this.leadZ += ((sp > 0.5 ? (P.vz / sp) * C.lead : 0) - this.leadZ) * lk;
    const follow = 1 - Math.exp(-10 * dt);
    this.camX += (px + this.leadX - this.camX) * follow; this.camZ += (pz + this.leadZ - this.camZ) * follow;
    this.camY += (ctx.world.height(px, pz) - this.camY) * (1 - Math.exp(-5 * dt));
    this.trauma = Math.max(0, this.trauma - dt * C.shakeDecay);
    const sh = this.trauma * this.trauma;
    let fov: number, tx: number, ty: number, tz: number, fx: number, fz: number, near = 1, far: number;
    const chase = this.chase;
    if (!chase) {
      this.pitch = this.cam.pitch;
      fov = (this.cam.fov * Math.PI) / 180;
      // distance that puts exactly pxPerMetre internal pixels on one metre at the focus
      this.dist = this.canvas.height / (2 * Math.tan(fov / 2) * C.pxPerMetre);
      // snap the look-at point to the texel grid so the world never shimmers
      const snap = 1 / C.pxPerMetre;
      tx = Math.round((this.camX + rnd(-1, 1) * sh * 0.35) / snap) * snap;
      tz = Math.round((this.camZ + (this.cam.frameZ ?? 0) + rnd(-1, 1) * sh * 0.35) / snap) * snap;
      ty = Math.round((this.camY + C.height) / snap) * snap;
      fx = Math.sin(this.yaw); fz = Math.cos(this.yaw);
      const cp = Math.cos(this.pitch), spt = Math.sin(this.pitch);
      this.eye = [tx - fx * cp * this.dist, ty + spt * this.dist, tz - fz * cp * this.dist];
      far = this.dist * 3;
      this.stretch = 1 / Math.max(0.35, Math.cos(this.pitch));
    } else {
      // third person: the rig orbits the Pokémon (mouse / right stick), nothing is snapped to a texel grid
      const rig = this.rig;
      const f0 = this.sheets.get(P.species.id)?.art.clips.idle?.frames[0]?.[0];
      const sx = rnd(-1, 1) * sh * 0.45, sy = rnd(-1, 1) * sh * 0.45, sz = rnd(-1, 1) * sh * 0.45;
      rig.update({
        dt, x: px, y: py, z: pz, height: f0 ? f0.h / TEXELS_PER_METRE : 1.1, threat: this.threatOf(ctx, px, pz),
        lookYaw: 0, lookPitch: this.lookPitch, ground: (x, z) => ctx.world.height(x, z), shake: [sx, sy, sz],
      }, { pitchRange: [-8, 12], fovOffset: this.fovOffset });
      this.lookPitch = 0;
      this.yaw = rig.yaw; this.pitch = rig.viewPitch; this.dist = rig.boomUsed;
      fov = rig.fov; [tx, ty, tz] = rig.target;
      [fx, fz] = rig.forward();
      this.eye = [rig.eye[0], rig.eye[1], rig.eye[2]];
      this.camX = rig.px; this.camY = rig.py; this.camZ = rig.pz;
      near = 0.3; far = 240;
      this.stretch = -1; // per-object (see the billboard shaders)
    }
    mat4.lookAt(this.V, this.eye, [tx, ty, tz], [0, 1, 0]);
    mat4.perspective(this.P, fov, this.width / this.height, near, far);
    mat4.mul(this.VP, this.P, this.V);
    this.right = [this.V[0], this.V[4], this.V[8]];
    this.up = [this.V[1], this.V[5], this.V[9]];
    this.fwd = [fx, 0, fz];

    const S = this.stage;
    const clear = S ? S.art.clear : [120, 220, 172];
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(clear[0] / 255, clear[1] / 255, clear[2] / 255, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);

    let fog: Fog = NO_FOG;
    // view radius for culling: the visible ground is about 30 x 22 m; keep a margin for tall props
    let view = { x: tx, z: tz - 2, r: Math.max(26, (this.canvas.width / C.pxPerMetre) * 0.75) };
    if (chase) {
      const sk = skyFor(ctx.world.biome.id);
      // horizon height in NDC (y up): the horizon sits above the screen centre by tan(view pitch) / tan(fov / 2)
      const hz = Math.tan(this.pitch) / Math.tan(fov / 2);
      gl.disable(gl.DEPTH_TEST); gl.depthMask(false);
      const kp = this.sky.use();
      kp.v3('uHor', sk.hor).v3('uZen', sk.zen).f('uHz', Math.max(-1, Math.min(1.5, hz)));
      gl.bindVertexArray(this.vigVao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);
      gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
      const bx = this.eye[0] - px, bz = this.eye[2] - pz, bl = Math.hypot(bx, bz) || 1;
      fog = { col: sk.hor, near: sk.fogNear, far: sk.fogFar, k: sk.fog, behind: [bx / bl, 0, bz / bl] };
      view = { x: this.rig.px + fx * 20, z: this.rig.pz + fz * 20, r: 74 };
    }
    this.fog = fog;
    if (S) {
      S.setMips(chase);
      // creatures moving through tall grass make it rustle
      if (P.moving) S.touch(px, pz);
      S.cells = ctx.world.cells;
      S.propState = ctx.world.propField?.state ?? null; S.propMat = ctx.world.propField?.mat ?? null;
      const E = ctx.enemies;
      for (let i = 0; i < E.hi; i += 3) if (E.alive[i] && E.hover[i] === 0) S.touch(E.x[i], E.z[i]);
      S.draw(this.VP, this.right, this.stretch, this.eye, [px, py, pz], this.time, dt, view, fog);
    }

    // Rain (a director weather event or a move): streaks falling around the view
    if (ctx.weather.element === 'tide' && this.quality > 0) {
      for (let k = 0; k < Math.min(12, Math.ceil(dt * 260)); k++) {
        const x = this.camX + rnd(-15, 15), z = this.camZ + rnd(-11, 13);
        this.px.spawn('drop', x, ctx.world.height(x, z) + rnd(5, 9), z, 0.6, -14, 0.3, 0.55, 1, 0);
      }
    }

    // creatures
    this.drawSprites(ctx, alpha, px, py, pz, dt, view);

    // decals (shadows, rings, zones): blended, no depth write
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(-2, -4);
    this.fillDecals(ctx, alpha, dt, px, py, pz);
    const dp = this.decal.use();
    dp.m4('uVP', this.VP).v3('uCam', this.eye);
    this.decals.draw();
    gl.disable(gl.DEPTH_TEST);
    this.decalsTop.draw(); // telegraphs always visible
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.POLYGON_OFFSET_FILL);

    // crisp pixel effects: projectiles, gems, particles (alpha-tested, depth-tested)
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    this.px.update(simDt);
    this.px.beginFx();
    this.queuePixelFx(ctx, alpha);
    this.px.queueParticles(this.eye, chase ? 0.55 : 1);
    this.px.drawFx(this.VP, this.right, this.up);
    gl.enable(gl.BLEND);
    gl.depthMask(false);

    // faint additive halo under projectiles + ribbons (beams, chains)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    this.parts.update(simDt);
    this.ambient(ctx, dt);
    this.fillGlows(ctx, alpha);
    this.glow.use().m4('uVP', this.VP).v3('uRight', this.right).v3('uUp', this.up);
    this.glows.draw();
    this.fillRibbons(dt);
    this.ribbon.use().m4('uVP', this.VP).v3('uCam', this.eye);
    this.ribbons.draw();
    gl.depthMask(true);
    // vignette (art direction): drawn last over the world, under the DOM UI
    const D = this.stage?.dir;
    if (D && D.vignette > 0 && !this.debugHide.vignette) {
      gl.disable(gl.DEPTH_TEST);
      // keep destination alpha at 1: a translucent canvas would let the page behind it show through the corners
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
      const vp = this.vig.use();
      // r = 1 in the corners, 0.71 at the edge midpoints (an ellipse that follows the screen)
      vp.v2('uAspect', Math.SQRT2, Math.SQRT2).v4('uVig', [...D.vignetteCol, D.vignette]);
      gl.bindVertexArray(this.vigVao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);
      gl.enable(gl.DEPTH_TEST);
    }
    gl.disable(gl.BLEND);

    // damage numbers age
    for (let i = this.nums.length - 1; i >= 0; i--) {
      const n = this.nums[i];
      n.life -= dt; n.y += dt * 1.6;
      if (n.life <= 0) this.nums.splice(i, 1);
    }
  }

  /** start the player's attack clip: `wind` seconds to the HitFrame (0 = start at the hit) */
  playerAttack(archetype: string, wind: number) {
    if (this.pAnim.state === 'hurt' && this.pAnim.until > this.time) return;
    const st = CAST_CLIP[archetype] ?? 'attack';
    const clip = this.sheets.get(this.playerId)?.art.clips[st];
    const len = clip ? clipLength(clip) : 0.3;
    const hitT = clip ? Math.min(hitTime(clip), len) : 0.12;
    const postLen = Math.max(0.05, len - hitT);
    const post = Math.min(postLen, 0.26);
    this.pAnim = { state: st, start: this.time, until: this.time + wind + post, wind, hitT, postScale: postLen / post };
  }
  /** clip time for the current attack at elapsed seconds e */
  private attackClipTime(e: number) {
    const A = this.pAnim;
    return e < A.wind ? (e / A.wind) * A.hitT : A.hitT + (e - A.wind) * A.postScale;
  }
  private playerId = '';

  private drawSprites(ctx: SimContext, alpha: number, px: number, py: number, pz: number, dt: number, view: { x: number; z: number; r: number }) {
    for (const s of this.sheets.values()) s.batch.begin();
    const E = ctx.enemies;
    const r2 = (view.r + 4) * (view.r + 4);
    const right = this.right;
    const push = (id: string, x: number, y: number, z: number, scale: number, facing: number, state: AnimState, t: number, flash: number, dissolve: number, tint: number[], bias = 0) => {
      const set = this.sheets.get(id);
      if (!set) return;
      const clip = set.art.clips[state];
      // the sprite sheet is drawn for a camera looking north (yaw PI); a camera at another yaw sees it rotated
      const dir = dirIndex(facing - (this.yaw - Math.PI));
      const row = clip.frames[dir] ?? clip.frames[0];
      const fi = Math.min(frameAt(clip, t), row.length - 1);
      const f = row[fi];
      // procedural overlays for states the source didn't animate
      let dx = 0, dy = 0;
      if (clip.overlay === 'bob') dy = Math.floor((Math.sin(this.time * 4 + x) * 0.5 + 0.5) * 1.99) / TEXELS_PER_METRE;
      else if (clip.overlay === 'lunge') { const k = Math.sin(Math.min(1, t / 0.25) * Math.PI) * 0.18; dx = (Math.sin(facing) * right[0] + Math.cos(facing) * right[2]) * k; dy = k * 0.2; }
      else if (clip.overlay === 'flash') flash = Math.max(flash, 0.7);
      else if (clip.overlay === 'dissolve') dissolve = Math.max(dissolve, Math.min(1, t / 0.6));
      else if (clip.overlay === 'sink') { const k = Math.min(1, t / 0.5); dy = -k * k * (f.h / TEXELS_PER_METRE) * scale * this.stretch; if (t < 0.1) flash = Math.max(flash, 0.8); }
      const o = set.batch.push();
      set.batch.data.set([x, y, z, scale, f.w, f.h, f.ax, f.ay, f.x / set.tw, f.y / set.th, (f.x + f.w) / set.tw, (f.y + f.h) / set.th, flash, dissolve, dx, bias, tint[0], tint[1], tint[2], dy], o);
    };
    for (let i = 0; i < E.hi; i++) {
      if (!E.alive[i] || this.debugHide.actors) continue;
      const x = E.px[i] + (E.x[i] - E.px[i]) * alpha, z = E.pz[i] + (E.z[i] - E.pz[i]) * alpha, y = E.py[i] + (E.y[i] - E.py[i]) * alpha;
      const ddx = x - view.x, ddz = z - view.z;
      if (ddx * ddx + ddz * ddz > r2) continue;
      const sp = SPECIES[E.species[i]];
      const set = this.sheets.get(sp.id);
      if (!set) continue;
      const roles = E.roles[i];
      let tint = [1, 1, 1];
      if (E.burn[i] > 0) tint = [1.15, 0.8, 0.6];
      else if (E.poison[i] > 0) tint = [0.9, 0.7, 1.1];
      else if (E.chill[i] > 0) tint = [0.7, 0.95, 1.2];
      else if (E.sleep[i] > 0 || E.stun[i] > 0) tint = [0.8, 0.8, 0.8];
      else if (E.confuse[i] > 0) tint = [1.1, 0.8, 1.05];
      // coats read as a tint on top (Soaked blue, Scorched orange, Chilled cyan, Charged yellow); frozen is ice
      if (E.frozen[i] > 0) tint = [0.62, 0.9, 1.45];
      else if (E.coat[i]) { const ct = COAT_TINT[E.coat[i]]; const k = E.coatDeep[i] === 2 ? 1 : 0.6; tint = [tint[0] * (1 + (ct[0] - 1) * k), tint[1] * (1 + (ct[1] - 1) * k), tint[2] * (1 + (ct[2] - 1) * k)]; }
      if (E.blind[i] > 0) tint = [tint[0] * 0.8, tint[1] * 0.8, tint[2] * 0.85];
      if (roles & ROLE.alpha) tint = [tint[0] * 1.15, tint[1] * 0.75, tint[2] * 0.75];
      else if (roles & ROLE.elite) tint = [tint[0] * 1.1, tint[1] * 1.0, tint[2] * 0.7];
      const spawnFade = E.spawnT[i] < 0.25 ? 1 - E.spawnT[i] / 0.25 : 0;
      let flash = E.flash[i] > 0 ? 0.85 : 0;
      // animation state from the sim's state
      let state: AnimState = 'walk', t = E.animT[i] * set.walkRate;
      if (E.flash[i] > 0 && !(roles & ROLE.boss)) { state = 'hurt'; t = 0.12 - E.flash[i]; }
      if (E.sleep[i] > 0) { state = 'sleep'; t = this.time; }
      if (roles & ROLE.boss) {
        const s = E.state[i];
        if (s === 3) { state = 'charge'; t = 0.8 - E.stateT[i]; flash = Math.max(flash, 0.35 + 0.35 * Math.sin(this.time * 30)); }
        else if (s === 2 || s === 5) { state = 'attack'; t = 0.15; }
        else if (s === 6 || s === 4) { state = 'shoot'; t = Math.max(0, 1.1 - E.stateT[i]); }
      } else if (sp.behaviour === 'charger' && E.state[i] === 1) { state = 'charge'; t = ctx.rules.enemy.chargeWindup - E.stateT[i]; flash = Math.max(flash, 0.4 + 0.4 * Math.sin(this.time * 30)); }
      else if (sp.behaviour === 'charger' && E.state[i] === 2) { state = 'attack'; t = 0.1; }
      const inGrass = E.hover[i] === 0 && ctx.world.inTallGrass(x, z);
      push(sp.id, x, y, z, E.size[i] * (sp.scale ?? 1), E.facing[i], state, t, flash, spawnFade * 0.9, tint, inGrass ? -0.12 : 0);
    }
    // fainting enemies: faint clip, then dissolve
    for (let k = this.dying.length - 1; k >= 0 && !this.debugHide.actors; k--) {
      const d = this.dying[k];
      d.t += dt;
      const sink = this.sheets.get(d.sp)?.art.clips.faint.overlay === 'sink';
      if (d.t > (sink ? 0.6 : 0.55)) { this.dying.splice(k, 1); continue; }
      push(d.sp, d.x, d.y, d.z, d.scale, d.dir, 'faint', d.t, d.t < 0.08 ? 0.8 : 0, Math.max(0, (d.t - (sink ? 0.42 : 0.25)) / 0.18), [1, 1, 1]);
    }
    // player
    const P = ctx.player;
    this.playerId = P.species.id;
    // Overgrow / Blaze / Torrent active: a rising aura in the type's colour
    if (pinchActive(ctx) && Math.random() < dt * 14) {
      const el = P.species.elements[0];
      const fx = ELEMENT_FX[el] ?? ELEMENT_FX.plain;
      const a = Math.random() * TAU;
      this.px.spawn(fx[2], px + Math.cos(a) * 0.5, py + 0.1, pz + Math.sin(a) * 0.5, 0, rnd(1.5, 2.6), 0, 0.6, 1, 0, rnd(-3, 3));
    }
    if (this.lastHp >= 0 && P.hp < this.lastHp - 0.5 && P.hurtFlash > 0) this.pAnim = { state: 'hurt', start: this.time, until: this.time + 0.3, wind: 0, hitT: 0, postScale: 1 };
    this.lastHp = P.hp;
    const evolving = ctx.state === 'evolving';
    const blink = P.iframes > 0 && P.dashT <= 0 && Math.floor(this.time * 20) % 2 === 0;
    let flash = P.hurtFlash > 0 ? 0.9 : 0;
    let id = P.species.id;
    let state: AnimState = P.moving || !P.grounded ? 'walk' : 'idle';
    const pset = this.sheets.get(id);
    let t = state === 'walk' ? P.animT * (pset?.walkRate ?? 0.22) : this.time;
    if (this.pAnim.until > this.time) { state = this.pAnim.state; const e = this.time - this.pAnim.start; t = state === 'hurt' ? e : this.attackClipTime(e); }
    if (ctx.state === 'over' || ctx.state === 'dead') { if (this.deadAt < 0) this.deadAt = this.time; state = 'faint'; t = this.time - this.deadAt; }
    else this.deadAt = -1;
    if (evolving) {
      const k = 1 - ctx.stateTimer / ctx.rules.sim.evolveSeconds;
      const rate = 2 + k * 18;
      id = Math.floor(this.time * rate) % 2 === 0 ? P.species.id : P.species.evolvesTo ?? P.species.id;
      flash = 0.5 + k * 0.5;
      state = 'idle';
    }
    const inGrass = ctx.world.inTallGrass(px, pz);
    this.silSheet = null;
    if (!blink && !this.debugHide.actors && !this.debugHide.player) { push(id, px, py, pz, 1, P.facing, state, t, flash, 0, [1, 1, 1], inGrass ? -0.12 : 0); const ps = this.sheets.get(id); if (ps && ps.batch.count) { this.silSheet = ps; this.silData.set(ps.batch.data.subarray((ps.batch.count - 1) * 20, ps.batch.count * 20)); } }

    const gl = this.gl;
    const p = this.creature.use();
    p.m4('uVP', this.VP).v3('uRight', this.right).v3('uFwd', this.fwd).f('uStretch', this.stretch);
    // actors carry their own key light (render/artdirection.ts): a biome's night tint dims the world, not the Pokémon
    p.v3('uLight', this.stage ? this.stage.dir.actor : [1, 1, 1]);
    p.v4('uFog', [this.fog.col[0], this.fog.col[1], this.fog.col[2], this.fog.k]).v2('uFogR', this.fog.near, this.fog.far).v3('uFogCam', this.eye);
    gl.activeTexture(gl.TEXTURE0);
    p.i('uTex', 0);
    p.v4('uSil', [0, 0, 0, 0]);
    for (const s of this.sheets.values()) {
      if (!s.batch.count) continue;
      gl.bindTexture(gl.TEXTURE_2D, s.tex);
      s.batch.draw();
    }
    // x-ray: the active Pokémon's pixels hidden behind trees, cliffs, a boss or the crowd, as a cyan stipple
    if (this.silSheet) {
      this.silBatch.begin();
      const o = this.silBatch.push();
      this.silBatch.data.set(this.silData, o);
      p.v4('uSil', [0.55, 0.95, 1, 1]);
      gl.bindTexture(gl.TEXTURE_2D, this.silSheet.tex);
      gl.depthFunc(gl.GREATER); gl.depthMask(false);
      this.silBatch.draw();
      gl.depthFunc(gl.LESS); gl.depthMask(true);
      p.v4('uSil', [0, 0, 0, 0]);
    }
  }
  private fog: Fog = NO_FOG;
  private silSheet: SpriteSet | null = null;
  private silData = new Float32Array(20);

  private fillDecals(ctx: SimContext, alpha: number, dt: number, px: number, py: number, pz: number) {
    const D = this.decals, T = this.decalsTop;
    D.begin(); T.begin();
    const W = ctx.world;
    const put = (b: InstanceBatch, x: number, z: number, r: number, c: number[], a: number, kind: number, th = 0.2, prog = 0, rot = 0, y?: number) => {
      const o = b.push();
      b.data.set([x, (y ?? W.height(x, z)) + 0.06, z, r, c[0], c[1], c[2], a, kind, th, prog, rot], o);
    };
    const hideO = this.debugHide.overlays;
    // surface states: wet puddles, fire, ice, ash, rubble, charge
    if (!hideO) { const C = ctx.world.cells, list = C.activeList();
      const vx = this.camX, vz = this.camZ, r2 = 34 * 34;
      for (let q = 0; q < list.length; q++) {
        const k = list[q];
        const x = (k % C.w) - C.half + 0.5, z = ((k / C.w) | 0) - C.half + 0.5;
        if ((x - vx) ** 2 + (z - vz) ** 2 > r2) continue;
        const st = C.state[k], tm = C.timer[k];
        const y = W.height(x, z);
        // same-state neighbours (the overlay joins them and rounds off where the patch ends)
        const same = (n: number) => n >= 0 && n < C.state.length && C.state[n] === st;
        const i0 = k % C.w;
        const nb = (i0 < C.w - 1 && same(k + 1) ? 1 : 0) | (i0 > 0 && same(k - 1) ? 2 : 0) | (same(k + C.w) ? 4 : 0) | (same(k - C.w) ? 8 : 0);
        const flick = 0.85 + 0.15 * Math.sin(this.time * 9 + k * 1.7);
        if (st === 1) put(D, x, z, 0.5, [0.32, 0.5, 0.9], Math.min(0.22, tm * 0.08), 5, nb, 0, 0, y);
        else if (st === 2) { put(D, x, z, 0.5, [1, 0.42 * flick + 0.1, 0.08], 0.7 * flick, 5, nb, 0, 0, y); if (Math.random() < dt * 10) this.px.spawn(Math.random() < 0.65 ? 'flame' : 'ember', x + rnd(-0.4, 0.4), y + 0.25, z + rnd(-0.4, 0.4), rnd(-0.2, 0.2), rnd(1.2, 2.4), rnd(-0.2, 0.2), rnd(0.35, 0.6), 1); }
        else if (st === 3) { const crack = tm < 2 && Math.floor(this.time * 8 + k) % 3 === 0; put(D, x, z, 0.5, crack ? [0.62, 0.76, 0.86] : [0.9, 0.97, 1], 0.95, 5, nb, 0, 0, y); }
        else if (st === 4) put(D, x, z, 0.5, [0.2, 0.18, 0.17], Math.min(0.55, tm * 0.05), 5, nb, 0, 0, y);
        else if (st === 5) put(D, x, z, 0.5, [0.55, 0.45, 0.32], Math.min(0.6, tm * 0.1), 5, nb, 0, 0, y);
        else if (st === 6) put(D, x, z, 0.5, [0.3, 0.68, 0.24], Math.min(0.7, tm * 0.12), 5, nb, 0, 0, y); // Burrow's Grass patch
        if (C.charge[k] > 0) { const cn = (n: number) => n >= 0 && n < C.charge.length && C.charge[n] > 0; const cm = (i0 < C.w - 1 && cn(k + 1) ? 1 : 0) | (i0 > 0 && cn(k - 1) ? 2 : 0) | (cn(k + C.w) ? 4 : 0) | (cn(k - C.w) ? 8 : 0); put(D, x, z, 0.5, [1, 0.95, 0.3], Math.floor(this.time * 30 + k) % 2 ? 0.85 : 0.45, 5, cm, 0, 0, y + 0.02); if (Math.random() < dt * 12) this.px.spawn('spark', x + rnd(-0.4, 0.4), y + 0.3, z + rnd(-0.4, 0.4), rnd(-1, 1), rnd(0.5, 1.5), rnd(-1, 1), 0.2, 1); }
        if (C.steam[k] > 0 && Math.random() < dt * 6) this.px.spawn('snow', x + rnd(-0.4, 0.4), y + 0.3, z + rnd(-0.4, 0.4), rnd(-0.2, 0.2), rnd(0.8, 1.6), rnd(-0.2, 0.2), 0.7, 1);
      } }
    // shadows
    const E = ctx.enemies;
    for (let i = 0; i < E.hi; i++) {
      if (!E.alive[i]) continue;
      const x = E.px[i] + (E.x[i] - E.px[i]) * alpha, z = E.pz[i] + (E.z[i] - E.pz[i]) * alpha;
      const dx = x - this.eye[0], dz = z - this.eye[2];
      if (dx * dx + dz * dz > 90 * 90) continue;
      put(D, x, z, E.radius[i] * 1.25, [0, 0, 0], 1, 0);
      if (hideO) continue;
      if (E.roles[i] & (ROLE.elite | ROLE.alpha)) put(D, x, z, E.radius[i] * 1.6, E.roles[i] & ROLE.alpha ? [1, 0.3, 0.2] : [1, 0.8, 0.2], 0.8, 1, 0.12, 0, 0);
      // a deep coat on anything, or any coat on an elite or boss: a coloured ring that says what it carries
      // a coat ring only where it carries a decision (elites, alphas, bosses); fodder shows its coat as a tint, so a
      // soaked swarm does not turn the ground into rings (art direction: signals stay scarce)
      if (E.coat[i] && E.roles[i] & (ROLE.elite | ROLE.alpha | ROLE.boss)) put(T, x, z, E.radius[i] * 1.35 + 0.15, COAT_RING[E.coat[i]], 0.85, 1, 0.16, 0, 0);
    }
    { const B = ctx.bodies;
      for (let b = 0; b < B.hi; b++) {
        if (!B.alive[b]) continue;
        const T = BODY_TEMPLATES[BODY_KINDS[B.kind[b]]];
        const x = B.px[b] + (B.x[b] - B.px[b]) * alpha, z = B.pz[b] + (B.z[b] - B.pz[b]) * alpha;
        put(D, x, z, T.radius * 1.1, [0, 0, 0], 1, 0);
        // thrown at you: a red ring under it; yours: a white one
        if (!hideO && B.team[b] !== 0 && Math.hypot(B.vx[b], B.vz[b]) > 4) put(D, x, z, T.radius * 1.45, B.team[b] === 2 ? [1, 0.3, 0.25] : [1, 1, 1], 0.75, 1, 0.14, 0, 0);
      } }
    if (hideO) { const pArt0 = this.sheets.get(ctx.player.species.id)?.art; put(D, px, pz, [0.42, 0.55, 0.8][pArt0?.shadowSize ?? 1] ?? 0.55, [0, 0, 0], 1, 0, 0, 0, 0, W.height(px, pz)); return; }
    // objectives (blueprint section 9): the Hold pad fills as it charges, the goal and the egg pulse, the
    // Hunt target wears a red ring and its Mender a green one
    { const O = ctx.objective, E = ctx.enemies, R = ctx.rules.objectives;
      if (O && (O.phase === 'offer' || O.phase === 'active')) {
        const pulse = 0.55 + 0.45 * Math.sin(this.time * 5);
        if (O.kind === 'hold') put(D, O.x, O.z, R.hold.radius, [1, 0.84, 0.3], O.phase === 'offer' ? 0.5 + 0.4 * pulse : 0.9, 2, 0.12, O.charge);
        else if (O.kind === 'transport') {
          put(D, O.x, O.z, R.transport.goalRadius, [0.45, 1, 0.55], 0.6 + 0.35 * pulse, 2, 0.14, 0);
          if (O.egg >= 0 && O.carrier === -1) put(T, ctx.bodies.x[O.egg], ctx.bodies.z[O.egg], 1.1, [1, 1, 0.6], pulse, 1, 0.16);
        } else if (O.target >= 0 && E.alive[O.target]) {
          put(T, E.x[O.target], E.z[O.target], E.radius[O.target] * 1.9, [1, 0.25, 0.2], 0.6 + 0.4 * pulse, 1, 0.12);
          if (O.mender >= 0 && E.alive[O.mender]) put(D, E.x[O.mender], E.z[O.mender], E.radius[O.mender] * 1.7, [0.4, 1, 0.45], 0.7, 1, 0.12);
        }
      } }
    // roles: a raised Bulwark shield, a Hexer's element, a Raider's orange tag
    { const E = ctx.enemies, RR = ctx.rules.roles;
      for (const b of ctx.director.bulwarks) if (E.alive[b]) put(D, E.x[b], E.z[b], RR.bulwarkRadius * E.size[b], [0.8, 0.9, 1], 0.55, 1, 0.07);
      for (let i = 0; i < E.hi; i++) {
        if (!E.alive[i] || !(E.roles[i] & (ROLE.hexer | ROLE.raider))) continue;
        const sp = ctx.speciesIndex[E.species[i]];
        put(D, E.x[i], E.z[i], E.radius[i] * 1.5, E.roles[i] & ROLE.hexer ? ELC[sp.elements.find((el) => el === 'blaze' || el === 'tide' || el === 'frost' || el === 'volt') ?? sp.elements[0]] : [1, 0.6, 0.15], 0.85, 1, 0.14);
      } }
    const pArt = this.sheets.get(ctx.player.species.id)?.art;
    put(D, px, pz, [0.42, 0.55, 0.8][pArt?.shadowSize ?? 1] ?? 0.55, [0, 0, 0], 1, 0, 0, 0, 0, W.height(px, pz));
    { const m = ctx.player.m; if (m && m.coat) put(T, px, pz, 0.8, COAT_RING[m.coat], 0.9, 1, 0.16, 0, 0, W.height(px, pz)); }
    // the active Pokémon's marker (art direction: own = cyan-white, never used by hostile signals): a ring at its
    // feet and a pip toward its facing, so it can be found in a swarm at a glance
    { const gy = W.height(px, pz), f = ctx.player.facing, OWN = [0.55, 0.95, 1];
      put(D, px, pz, 0.72, OWN, 0.95, 1, 0.2, 0, 0, gy);
      put(D, px + Math.sin(f) * 0.86, pz + Math.cos(f) * 0.86, 0.13, OWN, 1, 4, 0, 0, 0, gy); }
    // pickup radius hint
    put(D, px, pz, ctx.player.derived.magnet, [0.6, 0.85, 1], 0.1, 1, 0.03, 0, 0, W.height(px, pz));
    // aim reticle on the ground, and three dots from the Pokémon toward it
    if (this.aim.on) {
      const ax = this.aim.x, az = this.aim.z;
      put(T, ax, az, 0.55, [1, 1, 1], 0.85, 1, 0.22, 0, 0, W.height(ax, az));
      put(T, ax, az, 0.12, [1, 1, 1], 0.9, 4, 0.2, 0, 0, W.height(ax, az));
      const dx = ax - px, dz = az - pz, L = Math.hypot(dx, dz);
      if (L > 1.6) for (const d of [1.3, 1.9, 2.5]) { const x = px + (dx / L) * d, z = pz + (dz / L) * d; put(D, x, z, 0.1, [1, 1, 1], 0.7, 4, 0.2, 0, 0, W.height(x, z)); }
    }
    // Guard: a bright ring during the deflect window, a steady one while bracing
    { const Pl = ctx.player, G = ctx.rules.combat;
      if (Pl.guardT >= 0) {
        const win = Pl.guardT <= G.guardWindow;
        put(T, px, pz, win ? 1.5 : 1.15, win ? [1, 1, 1] : [0.55, 0.8, 1], win ? 0.95 : 0.7, 1, win ? 0.2 : 0.14, 0, 0, W.height(px, pz));
      } }
    // zones
    const Z = ctx.zones;
    for (let i = 0; i < Z.hi; i++) {
      if (!Z.alive[i]) continue;
      const c = ELC[ELEMENTS[Z.element[i]]];
      const k = Z.kind[i];
      const lifeF = Z.life[i] / Math.max(0.001, Z.maxLife[i]);
      if (k === ZK.meteor) { put(T, Z.x[i], Z.z[i], Z.radius[i], [1, 0.85, 0.3], 0.9, 2, 0.2, 1 - Math.max(0, Z.delay[i]) / Z.maxLife[i]); continue; }
      if (k === ZK.hostileSlam) { put(T, Z.x[i], Z.z[i], Z.radius[i], [1, 0.2, 0.2], 0.95, 2, 0.2, 1 - Math.max(0, Z.delay[i]) / 1.15); continue; }
      if (k === ZK.dashHit) continue;
      if (k === ZK.steam) {
        put(D, Z.x[i], Z.z[i], Z.radius[i], [0.92, 0.95, 1], Math.min(1, lifeF * 2) * 0.55, 4);
        if (Math.random() < dt * 14 * Z.radius[i]) { const a = rnd(0, TAU), rr = Math.sqrt(Math.random()) * Z.radius[i]; this.px.spawn('snow', Z.x[i] + Math.cos(a) * rr, W.height(Z.x[i], Z.z[i]) + 0.3, Z.z[i] + Math.sin(a) * rr, rnd(-0.3, 0.3), rnd(0.6, 1.4), rnd(-0.3, 0.3), 1.1, 1.6); }
        continue;
      }
      if (Z.pull[i] > 0) put(D, Z.x[i], Z.z[i], Z.radius[i], c, Math.min(1, lifeF * 3), 3, 0.2, this.time * 1.5);
      else if (k === ZK.root) put(D, Z.x[i], Z.z[i], Z.radius[i], [0.4, 0.9, 0.3], Math.min(1, lifeF * 3) * 0.8, 3, 0.2, this.time * 0.5);
      else if (Z.attach[i]) put(D, Z.x[i], Z.z[i], Z.radius[i], c, 0.85, 3, 0.2, this.time * 4, this.time * 5);
      else put(D, Z.x[i], Z.z[i], Z.radius[i], c, Math.min(1, lifeF * 2) * 0.75, 4);
    }
    // transient rings
    for (let k = this.rings.length - 1; k >= 0; k--) {
      const r = this.rings[k];
      r.life -= dt;
      if (r.life <= 0) { this.rings.splice(k, 1); continue; }
      const f = 1 - r.life / r.max;
      if (r.kind === 2) { put(T, r.x, r.z, r.r, r.c, 0.9, 2, 0.2, f); continue; }
      const rad = r.grow ? r.r * (0.3 + 0.7 * Math.sqrt(f)) : r.r;
      put(D, r.x, r.z, rad, r.c, 1 - f, 1, 0.12);
    }
    // portal
    if (ctx.portal.active) {
      put(D, ctx.portal.x, ctx.portal.z, ctx.rules.stage.portalRadius * 1.4, [0.6, 0.85, 1], 1, 3, 0.2, this.time * 2, this.time);
    }
    // boss marker ring
    const bi = ctx.director.bossIndex;
    if (bi >= 0 && E.alive[bi]) put(D, E.x[bi], E.z[bi], E.radius[bi] * 1.4, [1, 0.25, 0.25], 0.6, 1, 0.06);
    void py;
  }

  /** projectiles and pickups as crisp element sprites */
  private queuePixelFx(ctx: SimContext, alpha: number) {
    // bodies: boulders, rocks and rubble; they rock side to side as they roll
    const B = ctx.bodies;
    for (let b = 0; b < B.hi; b++) {
      if (!B.alive[b]) continue;
      const T = BODY_TEMPLATES[BODY_KINDS[B.kind[b]]];
      const x = B.px[b] + (B.x[b] - B.px[b]) * alpha, z = B.pz[b] + (B.z[b] - B.pz[b]) * alpha;
      const sp = Math.hypot(B.vx[b], B.vz[b]);
      const rot = sp > 0.3 ? Math.sin(B.roll[b] / T.radius) * 0.35 : 0;
      const hurt = B.hp[b] < B.maxHp[b] * 0.4 ? 0.15 : 0;
      const fading = T.life < 1e9 && B.age[b] > T.life - 1 ? Math.max(0.2, T.life - B.age[b]) : 1;
      this.px.sprite(T.sprite, x, ctx.world.height(x, z) + T.radius * 0.95, z, T.scale, rot, fading, hurt + (B.team[b] === 2 ? 0.12 + 0.12 * Math.sin(this.time * 18) : 0));
      if (sp > 4 && Math.random() < 0.35) this.px.spawn('dust', x, ctx.world.height(x, z) + 0.2, z, rnd(-0.5, 0.5), rnd(0.3, 0.8), rnd(-0.5, 0.5), 0.4, 1);
    }
    const Pr = ctx.projectiles;
    for (let i = 0; i < Pr.hi; i++) {
      if (!Pr.alive[i]) continue;
      const el = ELEMENTS[Pr.element[i]];
      const fx = ELEMENT_FX[el] ?? ELEMENT_FX.plain;
      const hostile = Pr.kind[i] === PK.hostile;
      const big = hostile || Pr.radius[i] > 0.8 || Pr.kind[i] === PK.lob;
      // orient along velocity on screen for directional sprites
      const vx = Pr.vx[i], vz = Pr.vz[i];
      const sx = vx * this.right[0] + vz * this.right[2];
      const sy = -(vx * Math.sin(this.yaw) + vz * Math.cos(this.yaw)) * Math.sin(this.pitch) * 0.5;
      const dirRot = Math.atan2(-sy, sx);
      const spinKinds = fx[0] === 'leaf' || fx[0] === 'star' || fx[0] === 'shard' || fx[0] === 'metal';
      const rot = spinKinds ? this.time * 14 + i : fx[0] === 'fireball' || fx[0] === 'wind' ? dirRot + Math.PI : 0;
      this.px.sprite(fx[0], Pr.x[i], Pr.y[i], Pr.z[i], big ? 2 : 1, rot, 1, hostile ? 0.25 + 0.25 * Math.sin(this.time * 20) : 0);
      if (Math.random() < 0.25) this.px.spawn(fx[2], Pr.x[i], Pr.y[i], Pr.z[i], rnd(-0.5, 0.5), rnd(-0.2, 0.5), rnd(-0.5, 0.5), 0.25, 1, 0, rnd(-4, 4));
    }
    // item balls (chests) not yet opened
    for (const c of ctx.world.chests) {
      if (c.open) continue;
      const dx = c.x - ctx.player.x, dz = c.z - ctx.player.z;
      if (dx * dx + dz * dz > 40 * 40) continue;
      this.px.sprite('itemball', c.x, ctx.world.height(c.x, c.z) + 0.3 + Math.abs(Math.sin(this.time * 2.2)) * 0.06, c.z, 1, 0, 1, 0);
    }
    const Pk = ctx.pickups;
    for (let i = 0; i < Pk.hi; i++) {
      if (!Pk.alive[i]) continue;
      const k = Pk.kind[i], v = Pk.value[i];
      const kind = k === 1 ? 'oran' : k === 2 ? 'star' : 'xp';
      this.px.sprite(kind, Pk.x[i], Pk.y[i] + 0.35 + Math.sin(this.time * 4 + i) * 0.08, Pk.z[i], k === 0 && v >= 12 ? 2 : 1, 0, 1, k === 0 && v >= 3 && Math.floor(this.time * 6 + i) % 4 === 0 ? 0.5 : 0);
    }
  }

  private fillGlows(ctx: SimContext, alpha: number) {
    const G = this.glows;
    G.begin();
    const Pr = ctx.projectiles;
    for (let i = 0; i < Pr.hi; i++) {
      if (!Pr.alive[i]) continue;
      const c = ELC[ELEMENTS[Pr.element[i]]];
      const hostile = Pr.kind[i] === PK.hostile;
      const o = G.push();
      const size = hostile ? 0.75 : Math.max(0.35, Pr.radius[i] * 1.3) * (Pr.kind[i] === PK.lob ? 1.6 : 1);
      const col = hostile ? [Math.min(1, c[0] * 0.6 + 0.6), c[1] * 0.4, c[2] * 0.6 + 0.2] : c;
      // soft halo behind the pixel sprite (kept faint so the sprite stays crisp)
      G.data.set([Pr.x[i], Pr.y[i], Pr.z[i], size * 1.8, col[0], col[1], col[2], hostile ? 0.45 : 0.22], o);
    }
    const Pa = this.parts;
    for (let i = 0; i < Pa.n; i++) {
      const o = G.push();
      const f = Pa.life[i] / Pa.max[i];
      G.data.set([Pa.x[i], Pa.y[i], Pa.z[i], Pa.size[i] * (0.4 + 0.6 * f), Pa.r[i], Pa.g[i], Pa.b[i], Math.min(1, f * 1.5)], o);
    }
    // portal column
    if (ctx.portal.active) {
      const y = ctx.world.height(ctx.portal.x, ctx.portal.z);
      for (let k = 0; k < 6; k++) {
        const o = G.push();
        G.data.set([ctx.portal.x, y + 0.5 + k * 0.9 + Math.sin(this.time * 3 + k) * 0.2, ctx.portal.z, 1.4 - k * 0.12, 0.5, 0.8, 1, 0.7], o);
      }
      if (Math.random() < 0.6) { const a = rnd(0, TAU); this.parts.add(ctx.portal.x + Math.cos(a) * 2.5, y, ctx.portal.z + Math.sin(a) * 2.5, -Math.cos(a), rnd(2, 5), -Math.sin(a), 1, 0.3, [0.6, 0.85, 1]); }
    }
    // chest sparkle
    if (Math.random() < 0.3) for (const c of ctx.world.chests) if (!c.open && Math.hypot(c.x - ctx.player.x, c.z - ctx.player.z) < 60) this.parts.add(c.x + rnd(-0.6, 0.6), ctx.world.height(c.x, c.z) + 1.2, c.z + rnd(-0.6, 0.6), 0, rnd(0.5, 1.5), 0, 0.8, 0.2, [1, 0.9, 0.4]);
    void alpha;
  }

  private fillRibbons(dt: number) {
    const R = this.ribbons;
    R.begin();
    for (let k = this.rib.length - 1; k >= 0; k--) {
      const r = this.rib[k];
      r.life -= dt;
      if (r.life <= 0) { this.rib.splice(k, 1); continue; }
      const o = R.push();
      R.data.set([r.ax, r.ay, r.az, r.w, r.bx, r.by, r.bz, Math.min(1, (r.life / r.max) * 2), r.c[0], r.c[1], r.c[2], 1], o);
    }
  }

  /** biome ambience: petals / embers / snow / motes drifting around the camera */
  private ambient(ctx: SimContext, dt: number) {
    const kind = ctx.world.biome.particles;
    if (!kind) return;
    this.ambientAcc += dt * 5 * this.quality;
    const P = ctx.player;
    while (this.ambientAcc > 1) {
      this.ambientAcc--;
      const x = P.x + rnd(-16, 16), z = P.z + rnd(-12, 12);
      const y = ctx.world.height(x, z);
      switch (kind) {
        case 'petals': this.px.spawn('petal', x, y + rnd(1.5, 4), z, rnd(0.5, 1.5), -rnd(0.3, 0.6), rnd(-0.5, 0.5), 5, 1, 0, rnd(-3, 3)); break;
        case 'embers': this.px.spawn('ember', x, y + rnd(0, 2), z, rnd(-0.3, 0.3), rnd(1, 2.5), rnd(-0.3, 0.3), 3, 1); break;
        case 'snow': this.px.spawn('snow', x, y + rnd(2, 5), z, rnd(0.3, 0.8), -rnd(1, 2), rnd(-0.3, 0.3), 6, 1, 0, rnd(-2, 2)); break;
        case 'motes': this.px.spawn('wisp', x, y + rnd(0.5, 3), z, rnd(-0.3, 0.3), rnd(-0.2, 0.4), rnd(-0.3, 0.3), 4, 1); break;
      }
    }
  }

  /** CSS pixel position on the canvas -> the point on the horizontal plane at height y (null if the ray misses) */
  groundAt(sx: number, sy: number, y: number): [number, number] | null {
    const inv = invert4(this.VP);
    if (!inv) return null;
    const nx = (sx / this.width) * 2 - 1, ny = 1 - (sy / this.height) * 2;
    const un = (z: number) => {
      const m = inv;
      const X = m[0] * nx + m[4] * ny + m[8] * z + m[12], Y = m[1] * nx + m[5] * ny + m[9] * z + m[13];
      const Z = m[2] * nx + m[6] * ny + m[10] * z + m[14], Wc = m[3] * nx + m[7] * ny + m[11] * z + m[15];
      return [X / Wc, Y / Wc, Z / Wc];
    };
    const a = un(-1), b = un(1);
    const dy = b[1] - a[1];
    if (Math.abs(dy) < 1e-6) return null;
    const t = (y - a[1]) / dy;
    if (t < 0) return null;
    return [a[0] + (b[0] - a[0]) * t, a[2] + (b[2] - a[2]) * t];
  }

  /** world -> CSS pixel position (null if behind camera) */
  project(x: number, y: number, z: number): [number, number] | null {
    const m = this.VP;
    const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
    const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
    const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (cw <= 0.1) return null;
    return [((cx / cw) * 0.5 + 0.5) * this.width, (1 - ((cy / cw) * 0.5 + 0.5)) * this.height];
  }
}

/** 4x4 inverse (column-major), or null when singular */
function invert4(m: Float32Array): Float32Array | null {
  const o = new Float32Array(16);
  const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = m;
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12, b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return null;
  det = 1 / det;
  o[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det; o[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  o[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det; o[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  o[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det; o[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  o[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det; o[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  o[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det; o[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det; o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  o[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det; o[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det; o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return o;
}

function rnd(a: number, b: number) { return a + Math.random() * (b - a); }
function mixc(a: number[], b: number[], t: number) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
function norm(v: number[]) { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; }

export { BIOMES, SPECIES_BY_ID };
export type { Element };
