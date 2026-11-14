// Pixel layer for the survivor arena: crisp element-specific combat sprites (projectiles,
// particles, impacts, XP). Arena props are drawn by render/tilestage.ts.
// Everything is drawn at PIXEL_DENSITY texels per metre so it matches the creature sprites.
import { compile, type GL } from './gl';
import { InstanceBatch, QUAD_CENTER } from './batches';
import * as A from './pixelart';

const D = A.PIXEL_DENSITY;

const FX_VS = `
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 iA; // x y z size(m)
layout(location=2) in vec4 iB; // u0 v0 u1 v1
layout(location=3) in vec4 iC; // rot alpha flash 0
uniform mat4 uVP; uniform vec3 uRight; uniform vec3 uUp;
out vec2 vUV; out float vA; out float vF;
void main(){
  float c = cos(iC.x), s = sin(iC.x);
  vec2 q = vec2(c * aCorner.x - s * aCorner.y, s * aCorner.x + c * aCorner.y) * 0.5 * iA.w;
  vec3 w = iA.xyz + uRight * q.x + uUp * q.y;
  vec2 t = aCorner * 0.5 + 0.5;
  vUV = vec2(mix(iB.x, iB.z, t.x), mix(iB.w, iB.y, t.y));
  vA = iC.y; vF = iC.z;
  gl_Position = uVP * vec4(w, 1.0);
}`;
const FX_FS = `
in vec2 vUV; in float vA; in float vF; uniform sampler2D uTex; out vec4 o;
void main(){
  vec4 c = texture(uTex, vUV);
  if (c.a < 0.5) discard;
  // stippled fade-out keeps edges crisp (no soft alpha)
  if (vA < 0.99) { vec2 g = mod(floor(gl_FragCoord.xy), 2.0); float th = g.x == g.y ? 0.5 : 0.25; if (vA < th) discard; }
  o = vec4(mix(c.rgb, vec3(1.0), vF), 1.0);
}`;

/** centre an image on a transparent square canvas of side n (bottom-aligned) */
function square(img: ImageData, n: number): ImageData {
  const out = new ImageData(n, n);
  const ox = Math.floor((n - img.width) / 2), oy = n - img.height;
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    const tx = x + ox, ty = y + oy;
    if (tx < 0 || ty < 0 || tx >= n || ty >= n) continue;
    const si = (y * img.width + x) * 4, di = (ty * n + tx) * 4;
    out.data[di] = img.data[si]; out.data[di + 1] = img.data[si + 1]; out.data[di + 2] = img.data[si + 2]; out.data[di + 3] = img.data[si + 3];
  }
  return out;
}

class Atlas {
  canvas = document.createElement('canvas'); ctx: CanvasRenderingContext2D;
  map = new Map<string, [number, number, number, number, number, number]>(); // u0 v0 u1 v1 w h
  private x = 1; private y = 1; private row = 0;
  constructor(public size: number) { this.canvas.width = this.canvas.height = size; this.ctx = this.canvas.getContext('2d')!; }
  add(key: string, img: ImageData) {
    if (this.x + img.width + 1 > this.size) { this.x = 1; this.y += this.row + 1; this.row = 0; }
    this.ctx.putImageData(img, this.x, this.y);
    const s = this.size;
    this.map.set(key, [this.x / s, this.y / s, (this.x + img.width) / s, (this.y + img.height) / s, img.width, img.height]);
    this.x += img.width + 1; this.row = Math.max(this.row, img.height);
  }
  has(key: string) { return this.map.has(key); }
}

interface FxP { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; max: number; kind: string; scale: number; grav: number; rot: number; spin: number }

const AMBIENT_KINDS = new Set(['petal', 'ember', 'snow', 'wisp', 'drop', 'spark', 'dust']);

export class PixelLayer {
  fxProg: WebGLProgram;
  fx: InstanceBatch;
  fxTex: WebGLTexture;
  fxAtlas = new Atlas(512);
  parts: FxP[] = [];
  private uF = new Map<string, WebGLUniformLocation | null>();

  constructor(private gl: GL) {
    this.fxProg = compile(gl, FX_VS, FX_FS);
    this.fx = new InstanceBatch(gl, QUAD_CENTER, 2, [4, 4, 4], 2048);
    for (const k of A.FX_KINDS) this.fxAtlas.add(k, A.fxSprite(k));
    // bodies (boulders, rocks): the route's rock painter, padded square so the quad keeps its shape
    this.fxAtlas.add('bodyBoulder', square(A.rock(1.6, ['#e4d4b4', '#c0a882', '#94805e', '#6a5a42']), 32));
    this.fxAtlas.add('bodyRock', square(A.rock(1.2, ['#e4d4b4', '#c0a882', '#94805e', '#6a5a42']), 24));
    this.fxAtlas.add('bodyEgg', square(A.egg(), 18));
    // location stones (render/renderer.ts picks `<sprite>.<art>` when present): Viridian's grey field stones,
    // Mt. Moon's brown cave rock, Chargestone's charged stones (slate with glowing cyan veins; they hover)
    const LOC: Record<string, [string, string, string, string]> = { forest: ['#c4c8b4', '#969e8a', '#6e7866', '#4c5448'], moon: ['#a89e94', '#82786e', '#5e564e', '#403a34'], chargestone: ['#6a7a98', '#4a5874', '#343e56', '#222a3c'], volcano: ['#7a6a66', '#5a4c4a', '#423634', '#2c2222'] };
    for (const [art, tone] of Object.entries(LOC)) {
      for (const [key, k, pad] of [['bodyBoulder', 1.6, 32], ['bodyRock', 1.2, 24]] as [string, number, number][]) {
        const im = square(A.rock(k, tone), pad);
        if (art === 'chargestone') shards(im);
        this.fxAtlas.add(key + '.' + art, im);
      }
    }
    this.fxTex = this.tex(this.fxAtlas.canvas);
  }

  private tex(c: HTMLCanvasElement) {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  private u(map: Map<string, WebGLUniformLocation | null>, prog: WebGLProgram, n: string) {
    if (!map.has(n)) map.set(n, this.gl.getUniformLocation(prog, n));
    return map.get(n)!;
  }

  // ------------------------------------------------------------ combat sprites
  spawn(kind: string, x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, scale = 1, grav = 0, spin = 0) {
    if (this.parts.length > 2500) return;
    this.parts.push({ x, y, z, vx, vy, vz, life, max: life, kind, scale, grav, rot: Math.random() * Math.PI * 2 * (spin ? 1 : 0), spin });
  }

  update(dt: number) {
    const ps = this.parts;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.life -= dt;
      if (p.life <= 0) { ps[i] = ps[ps.length - 1]; ps.pop(); continue; }
      p.vy -= p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const d = Math.exp(-2 * dt); p.vx *= d; p.vz *= d;
      p.rot += p.spin * dt;
    }
  }

  beginFx() { this.fx.begin(); }
  /** queue one effect sprite (scale is an integer pixel multiple for crisp pixels) */
  sprite(kind: string, x: number, y: number, z: number, scale = 1, rot = 0, alpha = 1, flash = 0) {
    const e = this.fxAtlas.map.get(kind);
    if (!e) return;
    const o = this.fx.push();
    this.fx.data.set([x, y, z, (16 / D) * scale, e[0], e[1], e[2], e[3], rot, alpha, flash, 0], o);
  }
  /** `ambient` scales the weather and air particles (petals, embers, snow, wisps, rain): a camera a few metres away
   *  would otherwise show them far larger than the fixed view ever did */
  queueParticles(eye: number[], ambient = 1) {
    for (const p of this.parts) {
      const dx = p.x - eye[0], dy = p.y - eye[1], dz = p.z - eye[2];
      if (dx * dx + dy * dy + dz * dz < 25) continue; // never fill the lens
      this.sprite(p.kind, p.x, p.y, p.z, AMBIENT_KINDS.has(p.kind) ? p.scale * ambient : p.scale, p.rot, Math.min(1, (p.life / p.max) * 2.2));
    }
  }
  drawFx(VP: Float32Array, right: number[], up: number[]) {
    const gl = this.gl;
    gl.useProgram(this.fxProg);
    const u = (n: string) => this.u(this.uF, this.fxProg, n);
    gl.uniformMatrix4fv(u('uVP'), false, VP);
    gl.uniform3fv(u('uRight'), right); gl.uniform3fv(u('uUp'), up);
    gl.uniform1i(u('uTex'), 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.fxTex);
    this.fx.draw();
  }
}

/** Chargestone's charged stones: small glowing crystal shards growing out of the top of a rendered stone */
function shards(im: ImageData) {
  const W = im.width, H = im.height, d = im.data;
  const top = (x: number) => { for (let y = 0; y < H; y++) if (d[(y * W + x) * 4 + 3]) return y; return -1; };
  const set = (x: number, y: number, c: [number, number, number]) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const o = (y * W + x) * 4; d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255; };
  const hi: [number, number, number] = [240, 252, 255], mid: [number, number, number] = [120, 224, 255], lo: [number, number, number] = [40, 144, 216], out: [number, number, number] = [26, 40, 72];
  for (const [fx, len] of [[0.38, 5], [0.55, 7], [0.7, 4]] as [number, number][]) {
    const x = Math.floor(W * fx), t = top(x);
    if (t < 0) continue;
    for (let y = 0; y < len; y++) { const yy = t + 2 - y; set(x - 1, yy, out); set(x, yy, y === len - 1 ? hi : mid); set(x + 1, yy, lo); set(x + 2, yy, out); }
    set(x, t + 2 - len, out); set(x + 1, t + 2 - len, out);
  }
}
