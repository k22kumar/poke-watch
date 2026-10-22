// Sprite baker: renders each creature design from 8 directions x 4 walk frames into a
// pixel sprite sheet (toon-shaded, 1px outline), the Poke-Watch equivalent of PokéBonk's
// 8-direction PMD sheets. Sheets are baked at load, so editing a design re-skins instantly.

import { Mesh, Program, mat4, type GL } from './gl';
import { bounds, buildFrame, type Design } from './kit';

export const DIRS = 8;
export const FRAMES = 4;
export const ELEVATION = (24 * Math.PI) / 180;

export interface Sheet {
  tex: WebGLTexture;
  px: number; // cell size in pixels
  w: number; h: number; // atlas size in pixels
  heightFrac: number; // model height / cell world size
  footV: number; // ground contact as a fraction of the cell from the bottom
  portrait: HTMLCanvasElement; // front-facing frame 0 (for UI)
  pixels: Uint8Array; // final RGBA, bottom-up rows (GL order)
}

/** Optional sizing: bake so the creature is `height` world units tall at `density` texels per unit. */
export interface BakeSize { density: number; height: number }

const VS = `
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNor;
layout(location=2) in vec3 aCol;
layout(location=3) in float aEmi;
uniform mat4 uVP; uniform mat4 uM;
out vec3 vN; out vec3 vC; out float vE;
void main(){ vN = mat3(uM) * aNor; vC = aCol; vE = aEmi; gl_Position = uVP * uM * vec4(aPos,1.0); }`;

const FS = `
in vec3 vN; in vec3 vC; in float vE;
uniform vec3 uL; uniform vec3 uV;
out vec4 o;
void main(){
  vec3 n = normalize(vN);
  float d = dot(n, uL);
  float s = d > 0.5 ? 1.0 : d > 0.05 ? 0.86 : 0.7;
  float rim = pow(1.0 - max(dot(n, uV), 0.0), 3.0);
  vec3 c = vC * s + rim * 0.12 * vC;
  c = mix(c, vC * 1.12 + 0.05, vE);
  o = vec4(c, 1.0);
}`;

let prog: Program | null = null;

export function bakeSheet(gl: GL, design: Design, pxOrSize: number | BakeSize, opts: { elevation?: number; outline?: [number, number, number] } = {}): Sheet {
  const el = opts.elevation ?? ELEVATION;
  let px = typeof pxOrSize === 'number' ? pxOrSize : 32;
  if (!prog) prog = new Program(gl, VS, FS);
  const frames: Float32Array[] = [];
  for (let f = 0; f < FRAMES; f++) frames.push(buildFrame(design, f, FRAMES));
  // rotation-invariant extents over all frames
  let maxR = 0, y0 = 1e9, y1 = -1e9;
  for (const fr of frames) {
    const b = bounds(fr);
    y0 = Math.min(y0, b.y0); y1 = Math.max(y1, b.y1);
    for (let i = 0; i < fr.length; i += 10) maxR = Math.max(maxR, Math.hypot(fr[i], fr[i + 2]));
  }
  y0 = Math.min(y0, 0);
  const ce = Math.cos(el), se = Math.sin(el);
  const projH = (y1 - y0) * ce + 2 * maxR * se;
  const projW = 2 * maxR;
  const S = Math.max(projH, projW) * 1.08 + 0.02; // world units across a cell
  if (typeof pxOrSize !== 'number') px = Math.max(12, Math.round(pxOrSize.density * pxOrSize.height * (S / (y1 - y0))));
  // view: camera on +z, elevated, looking at the centre of the projected box
  const cy = (y0 + y1) / 2;
  const dist = 10;
  const eye = [0, cy + Math.sin(el) * dist, Math.cos(el) * dist];
  const V = mat4.create(), P = mat4.create(), VP = mat4.create();
  mat4.lookAt(V, eye, [0, cy, 0], [0, 1, 0]);
  mat4.ortho(P, -S / 2, S / 2, -S / 2, S / 2, 0.1, 40);
  mat4.mul(VP, P, V);
  // where does the ground point (0,0,0) land vertically? (rotation invariant)
  const clip = mat4.transformPoint(VP, 0, 0, 0);
  const footV = (clip[1] + 1) / 2;

  const W = FRAMES * px, H = DIRS * px;
  const fbo = gl.createFramebuffer()!;
  const rt = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, rt);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  const depth = gl.createRenderbuffer()!;
  gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, W, H);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, rt, 0);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
  gl.viewport(0, 0, W, H);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);
  gl.disable(gl.BLEND);
  gl.enable(gl.SCISSOR_TEST);
  const p = prog.use();
  p.m4('uVP', VP);
  // light from upper-left-front in camera space
  const L = [-0.45, 0.75, 0.5]; const ll = Math.hypot(L[0], L[1], L[2]);
  p.v3('uL', [L[0] / ll, L[1] / ll, L[2] / ll]);
  p.v3('uV', [0, se, ce]);
  const M = mat4.create();
  for (let f = 0; f < FRAMES; f++) {
    const mesh = new Mesh(gl, frames[f], 10);
    gl.bindVertexArray(mesh.vao);
    for (let d = 0; d < DIRS; d++) {
      gl.viewport(f * px, d * px, px, px);
      gl.scissor(f * px, d * px, px, px);
      mat4.compose(M, 0, 0, 0, 0, (d * Math.PI * 2) / DIRS, 0, 1, 1, 1);
      p.m4('uM', M);
      gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
    }
    gl.bindVertexArray(null);
    gl.deleteBuffer(mesh.vbo);
    gl.deleteVertexArray(mesh.vao);
  }
  gl.disable(gl.SCISSOR_TEST);
  const pixels = new Uint8Array(W * H * 4);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteFramebuffer(fbo);
  gl.deleteRenderbuffer(depth);
  gl.deleteTexture(rt);

  outline(pixels, W, H, px, opts.outline);

  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  // portrait: frame 0, dir 0 (front), flipped to canvas orientation
  const portrait = document.createElement('canvas');
  portrait.width = px; portrait.height = px;
  const c2 = portrait.getContext('2d')!;
  const img = c2.createImageData(px, px);
  for (let y = 0; y < px; y++) {
    for (let x = 0; x < px; x++) {
      const si = ((y) * W + x) * 4;
      const di = ((px - 1 - y) * px + x) * 4;
      img.data[di] = pixels[si]; img.data[di + 1] = pixels[si + 1]; img.data[di + 2] = pixels[si + 2]; img.data[di + 3] = pixels[si + 3];
    }
  }
  c2.putImageData(img, 0, 0);
  return { tex, px, w: W, h: H, heightFrac: (y1 - y0) / S, footV, portrait, pixels };
}

/** 1px dark outline around opaque pixels, kept within each cell. */
function outline(px: Uint8Array, W: number, H: number, cell: number, fixed?: [number, number, number]) {
  const src = px.slice();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (src[i + 3] > 0) continue;
      const cx = Math.floor(x / cell) * cell, cy = Math.floor(y / cell) * cell;
      let r = 0, g = 0, b = 0, n = 0;
      const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (const [dx, dy] of nb) {
        const nx = x + dx, ny = y + dy;
        if (nx < cx || nx >= cx + cell || ny < cy || ny >= cy + cell) continue;
        const j = (ny * W + nx) * 4;
        if (src[j + 3] > 0) { r += src[j]; g += src[j + 1]; b += src[j + 2]; n++; }
      }
      if (n) {
        if (fixed) { px[i] = fixed[0]; px[i + 1] = fixed[1]; px[i + 2] = fixed[2]; } else { px[i] = (r / n) * 0.28; px[i + 1] = (g / n) * 0.24; px[i + 2] = (b / n) * 0.3 + 6; }
        px[i + 3] = 255;
      }
    }
  }
}
