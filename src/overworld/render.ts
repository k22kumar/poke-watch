// Gen-5-style 2.5D renderer: the scene is rendered at a low internal resolution and scaled
// up by an integer factor with nearest filtering, so 3D geometry and 2D sprites share one
// pixel grid. Terrain/buildings are textured 3D geometry; characters, trees and props are
// upright pixel billboards (vertically stretched to undo the camera's foreshortening).
import { compile, mat4, type GL } from '../render/gl';
import { InstanceBatch, QUAD_CENTER, QUAD_FEET } from '../render/batches';
import { buildBuilding, boxGeo } from './buildings';
import type { MapDef } from './mapdef';
import { Pix, hex, h2 } from './paint';
import { paintCliff, paintGround, paintStairs, paintWater, T } from './terrain';

export interface Billboard { key: string; x: number; y: number; z: number; w: number; h: number; u0: number; v0: number; u1: number; v1: number; flip?: boolean; bright?: number; bias?: number }
export interface Shadow { x: number; y: number; z: number; rx: number; rz: number; a: number }

const MESH_VS = `
layout(location=0) in vec3 aPos; layout(location=1) in vec2 aUV; layout(location=2) in float aShade;
uniform mat4 uVP; uniform vec2 uUVScale;
out vec2 vUV; out float vS;
void main(){ vUV = aUV * uUVScale; vS = aShade; gl_Position = uVP * vec4(aPos,1.0); }`;
const MESH_FS = `
in vec2 vUV; in float vS; uniform sampler2D uTex; uniform float uTint; out vec4 o;
void main(){ vec4 c = texture(uTex, vUV); if (c.a < 0.5) discard; o = vec4(c.rgb * vS * uTint, 1.0); }`;

const BB_VS = `
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 iA;  // x y z w
layout(location=2) in vec4 iB;  // h flip bright bias
layout(location=3) in vec4 iUV; // u0 v0 u1 v1
uniform mat4 uVP; uniform vec3 uRight; uniform vec3 uFwd; uniform float uStretch;
out vec2 vUV; out float vB;
void main(){
  vec3 w = iA.xyz + uRight * (aCorner.x * iA.w) + vec3(0.0, aCorner.y * iB.x * uStretch, 0.0) - uFwd * iB.w;
  float u = aCorner.x + 0.5; if (iB.y > 0.5) u = 1.0 - u;
  vUV = vec2(mix(iUV.x, iUV.z, u), mix(iUV.w, iUV.y, aCorner.y));
  vB = iB.z;
  gl_Position = uVP * vec4(w, 1.0);
}`;
const BB_FS = `
in vec2 vUV; in float vB; uniform sampler2D uTex; out vec4 o;
void main(){ vec4 c = texture(uTex, vUV); if (c.a < 0.5) discard; o = vec4(min(c.rgb * vB, vec3(1.0)), 1.0); }`;

const SH_VS = `
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 iA; // x y z rx
layout(location=2) in vec4 iB; // rz alpha
uniform mat4 uVP;
out vec2 vC; out float vA;
void main(){ vC = aCorner; vA = iB.y; gl_Position = uVP * vec4(iA.x + aCorner.x * iA.w, iA.y, iA.z + aCorner.y * iB.x, 1.0); }`;
const SH_FS = `
in vec2 vC; in float vA; out vec4 o;
void main(){ float r = dot(vC, vC); if (r > 1.0) discard; o = vec4(0.12, 0.14, 0.2, vA * (r < 0.55 ? 1.0 : 0.7)); }`;

class Prog {
  p: WebGLProgram; u = new Map<string, WebGLUniformLocation | null>();
  constructor(private gl: GL, vs: string, fs: string) { this.p = compile(gl, vs, fs); }
  use() { this.gl.useProgram(this.p); return this; }
  loc(n: string) { if (!this.u.has(n)) this.u.set(n, this.gl.getUniformLocation(this.p, n)); return this.u.get(n)!; }
}

interface Mesh { vao: WebGLVertexArrayObject; n: number; tex: WebGLTexture; uvScale?: [number, number]; buf: WebGLBuffer }

export class Atlas {
  canvas = document.createElement('canvas');
  ctx: CanvasRenderingContext2D;
  map = new Map<string, { x: number; y: number; w: number; h: number }>();
  private sx = 1; private sy = 1; private rowH = 0;
  constructor(public size = 2048) {
    this.canvas.width = this.canvas.height = size;
    this.ctx = this.canvas.getContext('2d')!;
  }
  add(key: string, src: ImageData | HTMLCanvasElement) {
    const w = src.width, h = src.height;
    if (this.sx + w + 1 > this.size) { this.sx = 1; this.sy += this.rowH + 1; this.rowH = 0; }
    if (src instanceof ImageData) this.ctx.putImageData(src, this.sx, this.sy); else this.ctx.drawImage(src, this.sx, this.sy);
    this.map.set(key, { x: this.sx, y: this.sy, w, h });
    this.sx += w + 1; this.rowH = Math.max(this.rowH, h);
  }
  uv(key: string, cx = 0, cy = 0, cw?: number, ch?: number) {
    const e = this.map.get(key);
    if (!e) throw new Error('atlas: missing ' + key);
    const w = cw ?? e.w, h = ch ?? e.h;
    const x = e.x + cx * w, y = e.y + cy * h;
    return [x / this.size, y / this.size, (x + w) / this.size, (y + h) / this.size];
  }
  has(key: string) { return this.map.has(key); }
}

export class OverworldRenderer {
  gl: GL;
  mesh: Prog; bb: Prog; sh: Prog;
  atlasTex!: WebGLTexture;
  meshes: Mesh[] = [];
  water: Mesh | null = null;
  waterTex: WebGLTexture[] = [];
  bbBatch: InstanceBatch; shBatch: InstanceBatch;
  VP = mat4.create(); V = mat4.create(); P = mat4.create();
  eye = [0, 0, 0]; right = [1, 0, 0]; fwd = [0, 0, -1];
  stretch = 1;
  indoor = false;
  W = 320; H = 240;

  constructor(public canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false });
    if (!gl) throw new Error('WebGL2 is required');
    this.gl = gl;
    this.mesh = new Prog(gl, MESH_VS, MESH_FS);
    this.bb = new Prog(gl, BB_VS, BB_FS);
    this.sh = new Prog(gl, SH_VS, SH_FS);
    this.bbBatch = new InstanceBatch(gl, QUAD_FEET, 2, [4, 4, 4], 1024);
    this.shBatch = new InstanceBatch(gl, QUAD_CENTER, 2, [4, 4], 128);
    const wp = paintWater();
    for (let f = 0; f < 4; f++) {
      const c = document.createElement('canvas'); c.width = 32; c.height = 32;
      c.getContext('2d')!.drawImage(wp.canvas(), f * 32, 0, 32, 32, 0, 0, 32, 32);
      this.waterTex.push(this.texture(c, true));
    }
  }

  texture(src: HTMLCanvasElement, repeat = false): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE);
    return t;
  }

  setAtlas(a: Atlas) { this.atlasTex = this.texture(a.canvas); }

  private makeMesh(data: number[] | Float32Array, tex: WebGLTexture, uvScale?: [number, number]): Mesh {
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data instanceof Float32Array ? data : new Float32Array(data), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 24, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 24, 20);
    gl.bindVertexArray(null);
    return { vao, n: data.length / 6, tex, uvScale, buf };
  }

  /** Build all static geometry for a map. */
  loadMap(m: MapDef, groundHeight: (x: number, y: number) => number) {
    const gl = this.gl;
    for (const me of this.meshes) { gl.deleteVertexArray(me.vao); gl.deleteBuffer(me.buf); }
    this.meshes = [];
    this.indoor = m.indoor;
    const W = m.w, H = m.h;
    const E = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : m.elev[y * W + x]);
    const TER = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H ? (m.indoor ? T.void : T.grass) : m.terrain[y * W + x]);
    const isWaterish = (t: number) => t === T.water || (t === T.wood && !m.indoor);
    const WATER_Y = -0.25;
    void groundHeight;

    // ---- ground (top faces)
    const ground = paintGround({ w: W, h: H, terrain: m.terrain, dots: m.dots, ledge: m.ledge });
    const gtex = this.texture(ground.canvas());
    const gd: number[] = [];
    const q = (out: number[], a: number[], b: number[], c: number[], d: number[], ua: number[], ub: number[], uc: number[], ud: number[], s: number) =>
      out.push(...a, ...ua, s, ...b, ...ub, s, ...c, ...uc, s, ...a, ...ua, s, ...c, ...uc, s, ...d, ...ud, s);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const t = TER(x, y);
        if (t === T.void || t === T.water) continue;
        const u0 = x / W, u1 = (x + 1) / W, v0 = y / H, v1 = (y + 1) / H;
        if (m.stairs[y * W + x]) continue;
        const e = t === T.wood && !m.indoor ? 0.05 : E(x, y);
        q(gd, [x, e, y + 1], [x + 1, e, y + 1], [x + 1, e, y], [x, e, y], [u0, v1], [u1, v1], [u1, v0], [u0, v0], 1);
      }
    this.meshes.push(this.makeMesh(gd, gtex));

    // ---- outside-the-map grass skirt (outdoor)
    if (!m.indoor) {
      const skirtPix = paintGround({ w: 2, h: 2, terrain: new Uint8Array(4) });
      const stex = this.texture(skirtPix.canvas(), true);
      const sd: number[] = [];
      const M = 24;
      const rect = (x0: number, z0: number, x1: number, z1: number) => q(sd, [x0, -0.02, z1], [x1, -0.02, z1], [x1, -0.02, z0], [x0, -0.02, z0], [x0 / 2, z1 / 2], [x1 / 2, z1 / 2], [x1 / 2, z0 / 2], [x0 / 2, z0 / 2], 0.96);
      rect(-M, -M, W + M, 0); rect(-M, H, W + M, H + M); rect(-M, 0, 0, H); rect(W, 0, W + M, H);
      this.meshes.push(this.makeMesh(sd, stex));
    }

    // ---- cliffs, banks, ledges (vertical faces)
    const cliffTex = this.texture(paintCliff('rock').canvas(), true);
    const bankTex = this.texture(paintCliff('bank').canvas(), true);
    const cd: number[] = [], bd: number[] = [];
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const t = TER(x, y);
        if (t === T.void || t === T.water || isWaterish(t) && t !== T.wood) continue;
        const e = E(x, y);
        const top = t === T.wood && !m.indoor ? 0.05 : e;
        const sides: [number, number, number[], number[], number][] = [
          [0, 1, [x, y + 1], [x + 1, y + 1], 0.86], // south
          [1, 0, [x + 1, y + 1], [x + 1, y], 0.72], // east
          [-1, 0, [x, y], [x, y + 1], 0.66], // west
          [0, -1, [x + 1, y], [x, y], 0.6], // north
        ];
        for (const [dx, dy, A, B, s] of sides) {
          const nt = TER(x + dx, y + dy);
          if (m.stairs[(y + dy) * W + (x + dx)] && dy !== 0) continue;
          let bottom: number;
          let out = cd;
          if (nt === T.water || (nt === T.wood && t !== T.wood && !m.indoor)) { bottom = WATER_Y - 0.05; out = bankTex === undefined ? cd : bd; if (t === T.wood) continue; }
          else if (nt === T.void) continue;
          else bottom = E(x + dx, y + dy);
          if (top - bottom < 0.01) continue;
          const la = A[0] + A[1], lb = B[0] + B[1];
          q(out, [A[0], bottom, A[1]], [B[0], bottom, B[1]], [B[0], top, B[1]], [A[0], top, A[1]], [la / 2, top - bottom], [lb / 2, top - bottom], [lb / 2, 0], [la / 2, 0], s);
        }
      }
    this.meshes.push(this.makeMesh(cd, cliffTex), this.makeMesh(bd, bankTex));

    // ---- stairs
    const stTex = this.texture(paintStairs().canvas(), true);
    const sd: number[] = [];
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        if (!m.stairs[y * W + x]) continue;
        const lo = E(x, y + 1), hi = E(x, y - 1);
        const steps = 4;
        for (let k = 0; k < steps; k++) {
          const z0 = y + 1 - k / steps, z1 = y + 1 - (k + 1) / steps;
          const yA = lo + ((hi - lo) * k) / steps, yB = lo + ((hi - lo) * (k + 1)) / steps;
          q(sd, [x, yA, z0], [x + 1, yA, z0], [x + 1, yB, z0], [x, yB, z0], [0, 1], [1, 1], [1, 0.75], [0, 0.75], 0.82);
          q(sd, [x, yB, z0], [x + 1, yB, z0], [x + 1, yB, z1], [x, yB, z1], [0, 0.25], [1, 0.25], [1, 0], [0, 0], 1);
        }
        // side walls of the staircase
        for (const sx of [x, x + 1]) q(sd, [sx, lo, y + 1], [sx, lo, y], [sx, hi, y], [sx, lo + 0.001, y + 1], [0, 1], [1, 1], [1, 0], [0, 0], 0.6);
      }
    if (sd.length) this.meshes.push(this.makeMesh(sd, stTex));

    // ---- water surface (+ under bridges)
    const wd: number[] = [];
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const t = TER(x, y);
        if (!isWaterish(t)) continue;
        q(wd, [x, WATER_Y, y + 1], [x + 1, WATER_Y, y + 1], [x + 1, WATER_Y, y], [x, WATER_Y, y], [x / 2, (y + 1) / 2], [(x + 1) / 2, (y + 1) / 2], [(x + 1) / 2, y / 2], [x / 2, y / 2], 1);
      }
    this.water = wd.length ? this.makeMesh(wd, this.waterTex[0]) : null;

    // ---- bridge rails and posts (solid-colour texture)
    const rails = new Pix(8, 8);
    rails.fill(0, 0, 8, 8, hex('#a87040')); rails.fill(0, 0, 8, 2, hex('#e0a868')); rails.fill(0, 6, 8, 2, hex('#7a4a28'));
    const railTex = this.texture(rails.canvas(), true);
    const rd: number[] = [];
    if (!m.indoor) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (TER(x, y) !== T.wood) continue;
      for (const [side, nx] of [[x, x - 1], [x + 1, x + 1]] as [number, number][]) {
        if (TER(nx, y) === T.wood) continue;
        const ox = side === x ? side : side - 0.12;
        boxGeo(rd, ox, 0.05, y, ox + 0.12, 0.42, y + 1, [0, 0, 1, 0.25], [0, 0, 1, 1]);
        boxGeo(rd, ox - 0.03, 0.05, y + 0.42, ox + 0.15, 0.62, y + 0.58, [0, 0, 1, 0.25], [0, 0, 1, 1]);
      }
      // plank side faces over water
      for (const dz of [0, 1]) {
        const ny = y + (dz ? 1 : -1);
        if (TER(x, ny) === T.wood) continue;
        const z = y + dz;
        q(rd, [x, WATER_Y + 0.1, z], [x + 1, WATER_Y + 0.1, z], [x + 1, 0.05, z], [x, 0.05, z], [0, 1], [1, 1], [1, 0], [0, 0], dz ? 0.7 : 0.5);
      }
    }
    if (rd.length) this.meshes.push(this.makeMesh(rd, railTex));

    // ---- buildings
    for (const bdef of m.buildings) {
      const bm = buildBuilding(bdef, E(bdef.x, bdef.y + bdef.d - 1));
      this.meshes.push(this.makeMesh(bm.data, this.texture(bm.canvas)));
    }

    // ---- interior back wall
    if (m.indoor) {
      const wh = 40;
      const wall = new Pix(W * 16, wh);
      const wp = hex(m.wallpaper ?? '#f0d8b0');
      const wd2: [number, number, number] = [wp[0] * 0.85, wp[1] * 0.85, wp[2] * 0.85];
      for (let y = 0; y < wh; y++) for (let x = 0; x < W * 16; x++) {
        let c = ((x >> 3) + (y >> 3)) % 2 ? wp : wd2;
        if (m.terrain[W] === T.tatami) c = y > 26 ? hex('#7a5030') : (x % 32 < 2 ? hex('#6a4428') : wp);
        if (y >= wh - 6) c = y === wh - 6 ? hex('#5a3c24') : hex('#8a5c34');
        if (y < 2) c = hex('#5a3c24');
        wall.set(x, y, c as [number, number, number]);
      }
      // windows on the back wall
      for (let k = 2; k < W - 1; k += 4) {
        const wx = k * 16 + 2;
        for (let y = 8; y < 24; y++) for (let x = 0; x < 14; x++) {
          const edge = x === 0 || x === 13 || y === 8 || y === 23 || x === 7;
          wall.set(wx + x, y, edge ? hex('#ffffff') : y < 16 ? hex('#a8d8ff') : hex('#88c0f0'));
        }
      }
      const wt = this.texture(wall.canvas());
      const wd3: number[] = [];
      q(wd3, [0, 0, 1], [W, 0, 1], [W, 2.5, 1], [0, 2.5, 1], [0, 1], [1, 1], [1, 0], [0, 0], 1);
      // side wall tops (dark borders)
      const dark = new Pix(4, 4); dark.fill(0, 0, 4, 4, hex('#202028'));
      const dt = this.texture(dark.canvas());
      const sd2: number[] = [];
      boxGeo(sd2, -0.3, 0, 0, 0, 2.5, H, [0, 0, 1, 1], [0, 0, 1, 1]);
      boxGeo(sd2, W, 0, 0, W + 0.3, 2.5, H, [0, 0, 1, 1], [0, 0, 1, 1]);
      boxGeo(sd2, -0.3, 0, H, W + 0.3, 0.12, H + 0.3, [0, 0, 1, 1], [0, 0, 1, 1]);
      this.meshes.push(this.makeMesh(wd3, wt), this.makeMesh(sd2, dt));
    }
  }

  resize(winW: number, winH: number, targetH = 240) {
    const scale = Math.max(1, Math.round(winH / targetH));
    this.W = Math.max(64, Math.floor(winW / scale));
    this.H = Math.max(64, Math.floor(winH / scale));
    this.canvas.width = this.W; this.canvas.height = this.H;
    this.canvas.style.width = this.W * scale + 'px';
    this.canvas.style.height = this.H * scale + 'px';
    return { scale, W: this.W, H: this.H };
  }

  setCamera(tx: number, ty: number, tz: number, pitch: number, yaw: number, dist: number, fovDeg = 32) {
    // snap the look-at point to the texel grid to avoid pixel crawl
    const sn = (v: number) => Math.round(v * 16) / 16;
    tx = sn(tx); tz = sn(tz); ty = sn(ty);
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    this.eye = [tx - fx * cp * dist, ty + sp * dist, tz - fz * cp * dist];
    mat4.lookAt(this.V, this.eye, [tx, ty, tz], [0, 1, 0]);
    mat4.perspective(this.P, (fovDeg * Math.PI) / 180, this.W / this.H, 1, 200);
    mat4.mul(this.VP, this.P, this.V);
    this.right = [this.V[0], this.V[4], this.V[8]];
    this.fwd = [fx, 0, fz];
    this.stretch = Math.min(1.6, 1 / Math.max(0.35, Math.cos(pitch * 0.92)));
  }

  draw(time: number, billboards: Billboard[], shadows: Shadow[], clear: [number, number, number], fade: number) {
    const gl = this.gl;
    gl.viewport(0, 0, this.W, this.H);
    gl.clearColor(clear[0], clear[1], clear[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    const tint = 1 - fade;
    const mp = this.mesh.use();
    gl.uniformMatrix4fv(mp.loc('uVP'), false, this.VP);
    gl.uniform1i(mp.loc('uTex'), 0);
    gl.uniform1f(mp.loc('uTint'), tint);
    gl.activeTexture(gl.TEXTURE0);
    for (const me of this.meshes) {
      gl.uniform2f(mp.loc('uUVScale'), 1, 1);
      gl.bindTexture(gl.TEXTURE_2D, me.tex);
      gl.bindVertexArray(me.vao);
      gl.drawArrays(gl.TRIANGLES, 0, me.n);
    }
    if (this.water) {
      gl.bindTexture(gl.TEXTURE_2D, this.waterTex[Math.floor(time * 3) % 4]);
      gl.bindVertexArray(this.water.vao);
      gl.drawArrays(gl.TRIANGLES, 0, this.water.n);
    }
    gl.bindVertexArray(null);

    // shadows (blended, no depth write)
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    const S = this.shBatch;
    S.begin();
    for (const s of shadows) { const o = S.push(); S.data.set([s.x, s.y + 0.03, s.z, s.rx, s.rz, s.a * tint, 0, 0], o); }
    const sp = this.sh.use();
    gl.uniformMatrix4fv(sp.loc('uVP'), false, this.VP);
    S.draw();
    gl.depthMask(true);
    gl.disable(gl.BLEND);

    // billboards
    const B = this.bbBatch;
    B.begin();
    for (const b of billboards) {
      const o = B.push();
      B.data.set([b.x, b.y, b.z, b.w, b.h, b.flip ? 1 : 0, (b.bright ?? 1) * tint, b.bias ?? 0, b.u0, b.v0, b.u1, b.v1], o);
    }
    const bp = this.bb.use();
    gl.uniformMatrix4fv(bp.loc('uVP'), false, this.VP);
    gl.uniform3fv(bp.loc('uRight'), this.right);
    gl.uniform3fv(bp.loc('uFwd'), this.fwd);
    gl.uniform1f(bp.loc('uStretch'), this.stretch);
    gl.uniform1i(bp.loc('uTex'), 0);
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    B.draw();
  }

  /** world -> internal-pixel coordinates */
  project(x: number, y: number, z: number): [number, number] | null {
    const m = this.VP;
    const cx = m[0] * x + m[4] * y + m[8] * z + m[12], cy = m[1] * x + m[5] * y + m[9] * z + m[13], cw = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (cw <= 0.01) return null;
    return [((cx / cw) * 0.5 + 0.5) * this.W, (1 - ((cy / cw) * 0.5 + 0.5)) * this.H];
  }
}

export { h2 };
