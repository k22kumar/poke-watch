// Arena stage renderer: the HeartGold/SoulSilver-style 2.5D world. Ground, cliffs, ledges,
// stairs, banks, water and the bridge are textured 3D geometry; trees, rocks, flowers, tall
// grass and ruins are upright pixel billboards stretched by 1/cos(pitch) so every texel
// lands on one screen pixel. Depth testing with alpha-tested texels sorts creatures behind
// trees, cliffs and tall grass without any transparency sorting.
import { compile, type GL } from './gl';
import { InstanceBatch, QUAD_CENTER, QUAD_FEET } from './batches';
import { Atlas } from '../overworld/render';
import { boxGeo } from '../overworld/buildings';
import { Pix, hex } from '../overworld/paint';
import { paintCliff, paintGround, paintStairs, paintWater } from '../overworld/terrain';
import { PROP_RULES, T, WATER_Y, stairEdges, type ArenaMap } from '../world/tiles';
import { BIOME_ART, arenaSprites } from './tileart';
import { decorSprites, layoutDecor } from './decor';
import { artDirection, edgeShade, forestDepth, type ArtDirection } from './artdirection';

const MESH_VS = `
layout(location=0) in vec3 aPos; layout(location=1) in vec2 aUV; layout(location=2) in float aShade;
uniform mat4 uVP;
out vec2 vUV; out float vS; out vec3 vW;
void main(){ vUV = aUV; vS = aShade; vW = aPos; gl_Position = uVP * vec4(aPos,1.0); }`;
// distance fog (third-person view only: uFog.a = 0 leaves the fixed views untouched)
export const FOG_GLSL = `
uniform vec4 uFog; uniform vec2 uFogR; uniform vec3 uFogCam;
vec3 applyFog(vec3 col, vec3 w){
  if (uFog.a <= 0.0) return col;
  float d = distance(w, uFogCam);
  float f = clamp((d - uFogR.x) / (uFogR.y - uFogR.x), 0.0, 1.0);
  return mix(col, uFog.rgb, f * f * uFog.a);
}`;
const MESH_FS = `
in vec2 vUV; in float vS; in vec3 vW; uniform sampler2D uTex; uniform vec3 uTint; uniform float uGlow; out vec4 o;
${FOG_GLSL}
void main(){ vec4 c = texture(uTex, vUV); if (c.a < 0.5) discard; o = vec4(applyFog(min(c.rgb * vS * mix(uTint, vec3(1.0), uGlow), vec3(1.0)), vW), 1.0); }`;

// upright billboard; iB.w = sway amount; dithers away where it hides the player
const BB_VS = `
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 iA;  // x y z w
layout(location=2) in vec4 iB;  // h flip sway shade
layout(location=3) in vec4 iUV; // u0 v0 u1 v1
uniform mat4 uVP; uniform vec3 uRight; uniform float uStretch; uniform float uTime; uniform vec3 uFogCam;
out vec2 vUV; out float vS; out vec3 vW;
void main(){
  // fixed views: one stretch for the whole screen; third person (uStretch <= 0): 1/cos of the elevation the camera
  // sees this object at, so far props are not stretched and texels stay square
  float st = uStretch;
  if (st <= 0.0) { vec3 d = iA.xyz - uFogCam; st = clamp(length(d) / max(length(d.xz), 0.5), 1.0, 1.6); }
  vec3 w = iA.xyz + uRight * (aCorner.x * iA.w) + vec3(0.0, aCorner.y * iB.x * st, 0.0);
  w += uRight * iB.z * aCorner.y * aCorner.y * sin(uTime * 1.7 + iA.x * 0.37 + iA.z * 0.21) * 0.07;
  float u = aCorner.x + 0.5; if (iB.y > 0.5) u = 1.0 - u;
  vUV = vec2(mix(iUV.x, iUV.z, u), mix(iUV.w, iUV.y, aCorner.y));
  vS = iB.w; vW = w;
  gl_Position = uVP * vec4(w, 1.0);
}`;
const BB_FS = `
in vec2 vUV; in float vS; in vec3 vW;
uniform sampler2D uTex; uniform vec3 uTint; uniform vec3 uPlayer; uniform vec3 uCam; uniform vec3 uFrameCool; uniform vec3 uBehind; out vec4 o;
${FOG_GLSL}
void main(){
  vec4 c = texture(uTex, vUV);
  if (c.a < 0.5) discard;
  // screen-door: props between the camera and the player become a 50% dither
  vec3 ab = uPlayer + vec3(0.0, 0.7, 0.0) - uCam; vec3 ap = vW - uCam;
  float t = clamp(dot(ap, ab) / dot(ab, ab), 0.0, 1.0);
  if (t < 0.93 && distance(vW, uCam + ab * t) < 1.1 && dot(vW - uPlayer, uBehind) > 0.2) { vec2 q = mod(floor(gl_FragCoord.xy), 2.0); if (q.x == q.y) discard; }
  // frame: props deep in the forest are darker and cooler (vS < 1), so walls frame the clearing
  vec3 cool = mix(vec3(1.0), uFrameCool, clamp((1.0 - vS) * 3.0, 0.0, 1.0));
  o = vec4(applyFog(min(c.rgb * uTint * vS * cool, vec3(1.0)), vW), 1.0);
}`;

const SH_VS = `
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 iA; // x y z rx
layout(location=2) in vec4 iB; // rz alpha
uniform mat4 uVP;
out vec2 vC; out float vA;
void main(){ vC = aCorner; vA = iB.y; gl_Position = uVP * vec4(iA.x + aCorner.x * iA.w, iA.y, iA.z + aCorner.y * iB.x, 1.0); }`;
const SH_FS = `
in vec2 vC; in float vA; out vec4 o;
void main(){ float r = dot(vC, vC); if (r > 1.0) discard; o = vec4(0.10, 0.12, 0.18, vA * (r < 0.55 ? 1.0 : 0.65)); }`;

/** distance fog and camera side for the third-person view; k = 0 is off (the fixed views) */
export interface Fog { col: number[]; near: number; far: number; k: number; behind: number[] }
export const NO_FOG: Fog = { col: [0, 0, 0], near: 1, far: 2, k: 0, behind: [0, 0, 1] };

interface Mesh { vao: WebGLVertexArrayObject; n: number; tex: WebGLTexture; buf: WebGLBuffer; glow?: boolean }
class Prog {
  p: WebGLProgram; u = new Map<string, WebGLUniformLocation | null>();
  constructor(private gl: GL, vs: string, fs: string) { this.p = compile(gl, vs, fs); }
  use() { this.gl.useProgram(this.p); return this; }
  loc(n: string) { if (!this.u.has(n)) this.u.set(n, this.gl.getUniformLocation(this.p, n)); return this.u.get(n)!; }
}

interface StaticProp { key: string; frames: number; x: number; y: number; z: number; tile: number; sway: number; flip: boolean; kind: string; shade: number; burns?: boolean; pi?: number; sx?: number; sz?: number }

const groundCache = new Map<string, HTMLCanvasElement>();

export class TileStage {
  private mesh: Prog; private bb: Prog; private sh: Prog;
  private meshes: Mesh[] = [];
  private water: Mesh | null = null;
  private waterTex: WebGLTexture[] = [];
  private atlasTex: WebGLTexture;
  private atlas = new Atlas(1024);
  private props: StaticProp[] = [];
  private bbBatch: InstanceBatch; private shBatch: InstanceBatch;
  private treeShadows: [number, number, number, number, number][] = [];
  readonly rustle = new Map<number, number>();
  readonly art;
  /** the expedition art direction for this biome (render/artdirection.ts) */
  readonly dir: ArtDirection;
  readonly half: number;

  constructor(private gl: GL, readonly map: ArenaMap, biome: string) {
    this.mesh = new Prog(gl, MESH_VS, MESH_FS);
    this.bb = new Prog(gl, BB_VS, BB_FS);
    this.sh = new Prog(gl, SH_VS, SH_FS);
    this.bbBatch = new InstanceBatch(gl, QUAD_FEET, 2, [4, 4, 4], 8192);
    this.shBatch = new InstanceBatch(gl, QUAD_CENTER, 2, [4, 4], 4096);
    this.art = BIOME_ART[biome] ?? BIOME_ART.meadow;
    this.dir = artDirection(biome);
    this.half = map.w / 2;
    const wp = paintWater(this.art.water);
    for (let f = 0; f < 4; f++) {
      const c = document.createElement('canvas'); c.width = 32; c.height = 32;
      c.getContext('2d')!.drawImage(wp.canvas(), f * 32, 0, 32, 32, 0, 0, 32, 32);
      this.waterTex.push(this.texture(c, true));
    }
    for (const [k, im] of arenaSprites(biome)) this.atlas.add(k, im);
    for (const [k, im] of decorSprites(biome)) this.atlas.add(k, im);
    this.atlasTex = this.texture(this.atlas.canvas);
    this.buildGeometry(biome);
    this.layoutProps();
  }

  dispose() {
    const gl = this.gl;
    for (const m of this.meshes) { gl.deleteVertexArray(m.vao); gl.deleteBuffer(m.buf); gl.deleteTexture(m.tex); }
    if (this.water) { gl.deleteVertexArray(this.water.vao); gl.deleteBuffer(this.water.buf); }
    for (const t of this.waterTex) gl.deleteTexture(t);
    gl.deleteTexture(this.atlasTex);
  }

  private mips: WebGLTexture[] = [];
  private mipped = false;
  private texture(src: TexImageSource, repeat = false, mip = true): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    if (mip) this.mips.push(t);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE);
    return t;
  }

  /** third person looks at the ground at a grazing angle: mip-map the terrain textures (crisp texels near, no shimmer far)
   *  and use anisotropic filtering where the browser has it. The fixed views keep plain NEAREST. */
  setMips(on: boolean) {
    if (on === this.mipped) return;
    this.mipped = on;
    const gl = this.gl;
    const ext = gl.getExtension('EXT_texture_filter_anisotropic');
    for (const t of this.mips) {
      if (t === this.atlasTex) continue; // sprites share an atlas: mips would bleed neighbours
      gl.bindTexture(gl.TEXTURE_2D, t);
      if (on) gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, on ? gl.NEAREST_MIPMAP_LINEAR : gl.NEAREST);
      if (ext) gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, on ? Math.min(8, gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT)) : 1);
    }
  }

  private makeMesh(data: number[], tex: WebGLTexture, glow = false): Mesh {
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 24, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 24, 20);
    gl.bindVertexArray(null);
    return { vao, n: data.length / 6, tex, buf, glow };
  }

  private buildGeometry(biome: string) {
    const m = this.map, W = m.w, H = m.h, o = this.half;
    const E = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : m.elev[y * W + x]);
    const TER = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H ? T.grass : m.terrain[y * W + x]);
    const q = (out: number[], a: number[], b: number[], c: number[], d: number[], ua: number[], ub: number[], uc: number[], ud: number[], s: number) =>
      out.push(...a, ...ua, s, ...b, ...ub, s, ...c, ...uc, s, ...a, ...ua, s, ...c, ...uc, s, ...d, ...ud, s);

    // ground: one painted texture for the whole arena (cached per biome)
    // ground texture cached per map (authored arenas: the biome id; generated regions: biome@seed)
    let gcanvas = groundCache.get(m.id);
    const D = this.dir, pal = { ...this.art.ground, ...D.ground };
    if (!gcanvas) { gcanvas = paintGround({ w: W, h: H, terrain: m.terrain, dots: m.dots, ledge: m.ledge, palette: pal, macro: D.macro, shade: edgeShade(m, D.edgeShade), shadeCol: D.shadeCol }).canvas(); groundCache.set(m.id, gcanvas); if (groundCache.size > 6) groundCache.delete(groundCache.keys().next().value as string); }
    const gd: number[] = [];
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const t = TER(x, y);
        if (t === T.water || m.stairs[y * W + x]) continue;
        const e = t === T.wood ? 0.05 : E(x, y);
        const u0 = x / W, u1 = (x + 1) / W, v0 = y / H, v1 = (y + 1) / H;
        q(gd, [x - o, e, y + 1 - o], [x + 1 - o, e, y + 1 - o], [x + 1 - o, e, y - o], [x - o, e, y - o], [u0, v1], [u1, v1], [u1, v0], [u0, v0], 1);
      }
    this.meshes.push(this.makeMesh(gd, this.texture(gcanvas)));

    // skirt of plain ground beyond the map so the camera never sees the void
    // the skirt lies under the decorative forest ring: fully in the forest's shade
    const skirt = paintGround({ w: 2, h: 2, terrain: new Uint8Array(4), palette: pal, shade: new Float32Array(4).fill(1), shadeCol: D.shadeCol });
    const sd: number[] = [];
    const M = 30;
    const rect = (x0: number, z0: number, x1: number, z1: number) => q(sd, [x0 - o, -0.02, z1 - o], [x1 - o, -0.02, z1 - o], [x1 - o, -0.02, z0 - o], [x0 - o, -0.02, z0 - o], [x0 / 2, z1 / 2], [x1 / 2, z1 / 2], [x1 / 2, z0 / 2], [x0 / 2, z0 / 2], 0.96);
    rect(-M, -M, W + M, 0); rect(-M, H, W + M, H + M); rect(-M, 0, 0, H); rect(W, 0, W + M, H);
    this.meshes.push(this.makeMesh(sd, this.texture(skirt.canvas(), true)));

    // vertical faces: 1 m cliffs (rock), 0.5 m ledges (grassy lip), banks down to the water
    const cliffT = this.texture(paintCliff('rock', this.art.cliff).canvas(), true);
    const ledgeT = this.texture(paintCliff('ledge', this.art.cliff).canvas(), true);
    const bankT = this.texture(paintCliff('bank', this.art.bank).canvas(), true);
    const cd: number[] = [], ld: number[] = [], bd: number[] = [];
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const t = TER(x, y);
        if (t === T.water || m.stairs[y * W + x]) continue;
        const top = t === T.wood ? 0.05 : E(x, y);
        const sides: [number, number, number[], number[], number][] = [
          [0, 1, [x, y + 1], [x + 1, y + 1], 0.86], [1, 0, [x + 1, y + 1], [x + 1, y], 0.72],
          [-1, 0, [x, y], [x, y + 1], 0.66], [0, -1, [x + 1, y], [x, y], 0.6],
        ];
        for (const [dx, dy, A, B, s] of sides) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < W && ny < H && m.stairs[ny * W + nx] && dy !== 0) continue;
          const nt = TER(nx, ny);
          let bottom: number, out: number[];
          if (nt === T.water) { if (t === T.wood) continue; bottom = WATER_Y - 0.05; out = bd; }
          else { bottom = nt === T.wood ? 0.05 : E(nx, ny); out = top - bottom > 0.75 ? cd : ld; }
          if (top - bottom < 0.01) continue;
          const la = A[0] + A[1], lb = B[0] + B[1];
          q(out, [A[0] - o, bottom, A[1] - o], [B[0] - o, bottom, B[1] - o], [B[0] - o, top, B[1] - o], [A[0] - o, top, A[1] - o], [la / 2, top - bottom], [lb / 2, top - bottom], [lb / 2, 0], [la / 2, 0], s);
        }
      }
    if (cd.length) this.meshes.push(this.makeMesh(cd, cliffT));
    if (ld.length) this.meshes.push(this.makeMesh(ld, ledgeT));
    if (bd.length) this.meshes.push(this.makeMesh(bd, bankT));

    // stairs
    const stT = this.texture(paintStairs().canvas(), true);
    const st: number[] = [];
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        if (!m.stairs[y * W + x]) continue;
        const [hi, lo] = stairEdges(m, x, y), steps = 4;
        for (let k = 0; k < steps; k++) {
          const z0 = y + 1 - k / steps, z1 = y + 1 - (k + 1) / steps;
          const yA = lo + ((hi - lo) * k) / steps, yB = lo + ((hi - lo) * (k + 1)) / steps;
          q(st, [x - o, yA, z0 - o], [x + 1 - o, yA, z0 - o], [x + 1 - o, yB, z0 - o], [x - o, yB, z0 - o], [0, 1], [1, 1], [1, 0.75], [0, 0.75], 0.82);
          q(st, [x - o, yB, z0 - o], [x + 1 - o, yB, z0 - o], [x + 1 - o, yB, z1 - o], [x - o, yB, z1 - o], [0, 0.25], [1, 0.25], [1, 0], [0, 0], 1);
        }
        for (const [sx, nx] of [[x, x - 1], [x + 1, x + 1]] as [number, number][]) {
          if (nx >= 0 && nx < W && m.stairs[y * W + nx]) continue;
          const g0 = E(nx, y);
          if (hi - g0 < 0.01) continue;
          q(st, [sx - o, g0, y + 1 - o], [sx - o, g0, y - o], [sx - o, hi, y - o], [sx - o, Math.max(g0, lo), y + 1 - o], [0, 1], [1, 1], [1, 0], [0, 0], 0.6);
        }
      }
    if (st.length) this.meshes.push(this.makeMesh(st, stT));

    // water surface (and under the bridge)
    const wd: number[] = [];
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const t = TER(x, y);
        if (t !== T.water && t !== T.wood) continue;
        q(wd, [x - o, WATER_Y, y + 1 - o], [x + 1 - o, WATER_Y, y + 1 - o], [x + 1 - o, WATER_Y, y - o], [x - o, WATER_Y, y - o], [x / 2, (y + 1) / 2], [(x + 1) / 2, (y + 1) / 2], [(x + 1) / 2, y / 2], [x / 2, y / 2], 1);
      }
    if (wd.length) this.water = this.makeMesh(wd, this.waterTex[0], this.art.waterGlow);

    // bridge rails and plank edges
    const rails = new Pix(8, 8);
    rails.fill(0, 0, 8, 8, hex('#a87040')); rails.fill(0, 0, 8, 2, hex('#e0a868')); rails.fill(0, 6, 8, 2, hex('#7a4a28'));
    const rd: number[] = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (TER(x, y) !== T.wood) continue;
      for (const dz of [0, 1]) {
        const ny = y + (dz ? 1 : -1);
        if (TER(x, ny) !== T.water) continue;
        const z = y + dz - o;
        const ox = x - o;
        boxGeo(rd, ox, 0.05, z - (dz ? 0.12 : 0), ox + 1, 0.42, z + (dz ? 0 : 0.12), [0, 0, 1, 0.25], [0, 0, 1, 1]);
        if ((x & 1) === 0) boxGeo(rd, ox + 0.4, 0.05, z - 0.08, ox + 0.6, 0.62, z + 0.08, [0, 0, 1, 0.25], [0, 0, 1, 1]);
        q(rd, [x - o, WATER_Y + 0.1, z], [x + 1 - o, WATER_Y + 0.1, z], [x + 1 - o, 0.05, z], [x - o, 0.05, z], [0, 1], [1, 1], [1, 0], [0, 0], dz ? 0.7 : 0.5);
      }
    }
    if (rd.length) this.meshes.push(this.makeMesh(rd, this.texture(rails.canvas(), true)));
  }

  /** Lay every prop out as a billboard (plus a decorative forest beyond the edge). */
  private layoutProps() {
    const m = this.map, o = this.half, W = m.w;
    // frame: how deep each prop sits in the forest (tiles from open ground) sets how dark and cool it is
    const depth = forestDepth(m), FD = this.dir.frameDark;
    const frameShade = (x: number, y: number, w: number, h: number) => {
      let d = 1e9;
      for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) d = Math.min(d, depth[j * W + i]);
      return 1 - FD * Math.max(0, Math.min(1, (d - 0.5) / 3));
    };
    const big = new Set(['tree', 'tree2', 'round', 'blossom', 'elder', 'deadtree', 'icepine', 'boulder', 'statue', 'shrine', 'cabin', 'well']);
    for (let pi = 0; pi < m.props.length; pi++) {
      const p = m.props[pi];
      const cx = p.x + p.w / 2 - o, base = p.y + p.h - o;
      const y = m.elev[(p.y + p.h - 1) * W + p.x];
      let key = p.kind as string, frames = 1, dz = -0.4, sway = 0;
      switch (p.kind) {
        case 'tall': key = 'tall'; frames = 3; dz = -0.06; break;
        case 'flowerR': case 'flowerW': case 'flowerY': case 'flowerB': frames = 2; dz = -0.3 + ((p.x * 11 + p.y * 3) % 5 - 2) * 0.08; sway = 0.6; break;
        case 'reeds': frames = 2; dz = -0.35; sway = 1; break;
        case 'lily': dz = -0.5; break;
        case 'elder': dz = -0.9; sway = 0.3; break;
        case 'cabin': dz = -0.35; break;
        case 'fence': case 'hedge': dz = -0.45; break;
        default: if (big.has(p.kind)) { dz = -0.55; sway = p.kind === 'boulder' || p.kind === 'statue' || p.kind === 'shrine' || p.kind === 'well' ? 0 : 0.25; }
      }
      const jx = p.kind.startsWith('flower') ? (((p.x * 7 + p.y * 13) % 5) - 2) * 0.09 : 0;
      if (p.kind === 'tree') key = ['tree', 'tree3', 'tree'][p.variant % 3];
      const flip = p.kind === 'tall' || p.kind === 'shrine' || p.kind === 'statue' || p.kind === 'sign' ? false : (p.variant & 1) === 1;
      this.props.push({ key, frames, x: cx + jx, y: p.kind === 'lily' ? -0.22 : y, z: base + dz, tile: p.y * W + p.x, sway, flip, kind: p.kind, shade: PROP_RULES[p.kind].wall ? frameShade(p.x, p.y, p.w, p.h) : 1, pi, sx: p.x + 0.5 - o, sz: base - 0.4 });
      if (big.has(p.kind) && PROP_RULES[p.kind].wall) this.treeShadows.push([cx, y, base - 0.6, p.kind === 'elder' || p.kind === 'cabin' ? 2.2 : 1.0, pi]);
    }
    // ground decor: clumps, litter, pebbles, edge ferns and the crossroads camp (render/decor.ts)
    for (const d of layoutDecor(m, edgeShade(m, 1))) {
      const y = m.elev[d.tile];
      this.props.push({ key: d.key, frames: d.frames, x: d.x - o, y, z: d.z - o, tile: d.tile, sway: d.sway, flip: d.flip, kind: 'decor', shade: d.shade, burns: d.burns });
    }
    // decorative forest ring outside the map (no collision; the border forest is the real wall)
    const kinds = ['tree', 'tree2', 'tree3'];
    // the most common 2×2 tree kind in the map (a rock-gate boulder must not set the ring)
    const treeKinds = ['tree', 'tree2', 'round', 'deadtree', 'icepine'];
    const counts = new Map<string, number>();
    for (const p of m.props) if (treeKinds.includes(p.kind)) counts.set(p.kind, (counts.get(p.kind) ?? 0) + 1);
    const wallKind = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'tree';
    for (let y = -14; y < m.h + 14; y += 2) {
      const off = (y >> 1) & 1; // staggered rows, like a woven Johto tree wall
      for (let x = -15 + off; x < m.w + 14; x += 2) {
        if (x >= -1 && y >= -1 && x < m.w && y < m.h) continue;
        const hsh = ((x * 73856093) ^ (y * 19349663)) >>> 0;
        const k = wallKind === 'tree' || wallKind === 'tree2' ? kinds[hsh % 3] : wallKind;
        this.props.push({ key: k, frames: 1, x: x + 1 - o, y: 0, z: y + 2 - 0.55 - o, tile: -1, sway: 0.2, flip: (hsh >> 3) % 2 === 1, kind: k, shade: 1 - FD });
      }
    }
  }

  /** surface states of the current run (burnt grass is not drawn) */
  cells: { state: Uint8Array } | null = null;
  /** W4 prop states of the current run (sim/props.ts PS): burnt wood draws a stump, gone props are skipped */
  propState: Uint8Array | null = null;
  propMat: (unknown | undefined)[] | null = null;

  /** mark tall grass at (x, z) as rustling (creatures moving through it) */
  touch(x: number, z: number) {
    const i = Math.floor(x + this.half), j = Math.floor(z + this.half);
    if (i < 0 || j < 0 || i >= this.map.w || j >= this.map.h) return;
    const k = j * this.map.w + i;
    if (this.map.terrain[k] === T.tall) this.rustle.set(k, 0.45);
  }

  draw(VP: Float32Array, right: number[], stretch: number, cam: number[], player: number[], time: number, dt: number, view: { x: number; z: number; r: number }, fog: Fog = NO_FOG) {
    const gl = this.gl;
    const tint = this.dir.world;
    const mp = this.mesh.use();
    gl.uniformMatrix4fv(mp.loc('uVP'), false, VP);
    gl.uniform1i(mp.loc('uTex'), 0);
    gl.uniform3fv(mp.loc('uTint'), tint);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1f(mp.loc('uGlow'), 0);
    gl.uniform4f(mp.loc('uFog'), fog.col[0], fog.col[1], fog.col[2], fog.k);
    gl.uniform2f(mp.loc('uFogR'), fog.near, fog.far);
    gl.uniform3fv(mp.loc('uFogCam'), cam);
    for (const me of this.meshes) {
      gl.bindTexture(gl.TEXTURE_2D, me.tex);
      gl.bindVertexArray(me.vao);
      gl.drawArrays(gl.TRIANGLES, 0, me.n);
    }
    if (this.water) {
      gl.uniform1f(mp.loc('uGlow'), this.water.glow ? 1 : 0);
      gl.bindTexture(gl.TEXTURE_2D, this.waterTex[Math.floor(time * 3) % 4]);
      gl.bindVertexArray(this.water.vao);
      gl.drawArrays(gl.TRIANGLES, 0, this.water.n);
    }
    gl.bindVertexArray(null);

    // tree shadows (blended, no depth write)
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    const S = this.shBatch;
    S.begin();
    const r2 = view.r * view.r;
    for (const [x, y, z, r, pi] of this.treeShadows) {
      if (this.propState && this.propState[pi] >= 2 && this.propState[pi] <= 3) continue;
      const dx = x - view.x, dz = z - view.z;
      if (dx * dx + dz * dz > r2) continue;
      const o = S.push(); S.data.set([x, y + 0.03, z, r, r * 0.45, 0.2, 0, 0], o);
    }
    const sp = this.sh.use();
    gl.uniformMatrix4fv(sp.loc('uVP'), false, VP);
    S.draw();
    gl.depthMask(true);
    gl.disable(gl.BLEND);

    // prop billboards
    for (const [k, t] of this.rustle) { const n = t - dt; if (n <= 0) this.rustle.delete(k); else this.rustle.set(k, n); }
    const B = this.bbBatch;
    B.begin();
    const A = this.atlas;
    const flowerFrame = Math.floor(time * 1.6) % 2;
    for (const p of this.props) {
      const dx = p.x - view.x, dz = p.z - view.z;
      if (dx * dx + dz * dz > r2) continue;
      let key = p.key;
      let px = p.x, pz = p.z;
      // W4: burnt wood is a stump, burnt leaf and broken props are gone (sim/props.ts PS: 2 burnt, 3 broken)
      if (this.propState && p.pi !== undefined) {
        const st = this.propState[p.pi];
        if (st === 3) continue;
        if (st === 2) {
          const mat = (this.propMat?.[p.pi] as { mat?: string } | undefined)?.mat;
          if (mat !== 'wood' || p.kind === 'stump' || p.kind === 'log') continue;
          key = 'stump'; px = p.sx!; pz = p.sz!;
        }
      }
      // burning (2) or burnt to ash (4) ground loses its grass decor too
      if (p.burns && this.cells && (this.cells.state[p.tile] === 2 || this.cells.state[p.tile] === 4)) continue;
      if (p.frames === 3) {
        // burning (2) or burnt to ash (4): the tuft is gone
        if (this.cells && p.tile >= 0 && (this.cells.state[p.tile] === 2 || this.cells.state[p.tile] === 4)) continue;
        const rs = this.rustle.get(p.tile); key = 'tall' + (rs ? 1 + (Math.floor(rs * 14) % 2) : 0);
      }
      else if (p.frames === 2) key = p.key + ((flowerFrame + (p.tile & 1)) % 2);
      const e = A.map.get(key);
      if (!e) continue;
      const [u0, v0, u1, v1] = A.uv(key);
      const o = B.push();
      if (o < 0) break;
      B.data.set([px, p.y, pz, e.w / 16, e.h / 16, p.flip ? 1 : 0, key === 'stump' && p.kind !== 'stump' ? 0 : p.sway, p.shade, u0, v0, u1, v1], o);
    }
    const bp = this.bb.use();
    gl.uniformMatrix4fv(bp.loc('uVP'), false, VP);
    gl.uniform3fv(bp.loc('uRight'), right);
    gl.uniform1f(bp.loc('uStretch'), stretch);
    gl.uniform1f(bp.loc('uTime'), time);
    gl.uniform3fv(bp.loc('uTint'), tint);
    gl.uniform3fv(bp.loc('uFrameCool'), this.dir.frameCool);
    gl.uniform3fv(bp.loc('uPlayer'), player);
    gl.uniform3fv(bp.loc('uCam'), cam);
    // the side of the player the camera is on (props there may screen-door): classic looks north, so 'behind' is +z
    gl.uniform3fv(bp.loc('uBehind'), fog.behind);
    gl.uniform4f(bp.loc('uFog'), fog.col[0], fog.col[1], fog.col[2], fog.k);
    gl.uniform2f(bp.loc('uFogR'), fog.near, fog.far);
    gl.uniform3fv(bp.loc('uFogCam'), cam);
    gl.uniform1i(bp.loc('uTex'), 0);
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    B.draw();
  }
}
