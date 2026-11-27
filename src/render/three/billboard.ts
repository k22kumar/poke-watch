// Creature billboards in TSL, ported from spike/s2-three (src/spike/s2/webgpu.ts, docs/spikes/S2-renderer.md "The
// billboard port"): the game's CREATURE_VS / CREATURE_FS, LEAN_GLSL and SPRITE_SAMPLE_GLSL as nodes, one instanced mesh
// per atlas with the game's 20-float instance layout, the x-ray as a second material with GreaterDepth. The look of
// actors (tints for local light, shadows as decals, the x-ray colours) is I2b's; this is the port as S2 measured it.
import { DynamicDrawUsage, GreaterDepth, InstancedBufferAttribute, InstancedBufferGeometry, BufferAttribute, Mesh, MeshBasicNodeMaterial, Vector3, Vector4, type Texture } from 'three/webgpu';
import { Discard, Fn, If, abs, atan, attribute, clamp, cos, dFdx, dFdy, dot, float, floor, length, max, min, mix, mod, positionGeometry, screenCoordinate, select, sign, sin, texture, textureSize, uniform, varying, vec2, vec3, vec4 } from 'three/tsl';
import { TEXELS_PER_METRE } from '../../assets/art';

type N = any; // TSL node chains are loosely typed in @types/three 0.187 (S2 F42)
const tsize: N = textureSize, v2: N = vec2, fmax: N = max, fsel: N = select;

/** per instance: iA x y z scale | iB w h ax ay | iUV u0 v0 u1 v1 | iC flash dissolve dx bias | iD rgb dy */
export const BILLBOARD_ATTRS = ['iA', 'iB', 'iUV', 'iC', 'iD'] as const;

/** the uniforms every creature material shares, written once a frame */
export class CreatureUniforms {
  readonly right = new Vector3(); readonly fwd = new Vector3(); readonly cam = new Vector3(); readonly light = new Vector3(1, 1, 1);
  readonly sil = new Vector4(0.55, 0.95, 1, 1);
  readonly uRight: N = uniform(this.right); readonly uFwd: N = uniform(this.fwd); readonly uCam: N = uniform(this.cam);
  readonly uLight: N = uniform(this.light); readonly uSil: N = uniform(this.sil);
  readonly uLean: N = uniform(0);
}

/** SPRITE_SAMPLE_GLSL as nodes: one nearest tap at a texel per pixel or larger, else an n×n box (n 2 or 3) of nearest
 *  taps clamped inside the frame, alpha-weighted; a real branch, so a close sprite pays one tap (S2) */
function spriteTex(tex: Texture, uv: N, rect: N): N {
  const ts = v2(tsize(texture(tex), 0));
  const dx = dFdx(uv), dy = dFdy(uv);
  const fp = fmax(length(dx.mul(ts)), length(dy.mul(ts)));
  const out: N = vec4(0).toVar();
  If(fp.lessThan(1.3), () => { out.assign((texture(tex, uv) as N).level(0)); }).Else(() => {
    const n = fsel(fp.lessThan(2.3), float(2), float(3));
    const half = vec2(0.5).div(ts);
    const lo = min(rect.xy, rect.zw).add(half), hi = fmax(rect.xy, rect.zw).sub(half);
    let acc: N = vec4(0);
    for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) {
      const k = vec2(i + 0.5, j + 0.5).div(n).sub(0.5);
      const c: N = (texture(tex, clamp(uv.add(dx.mul(k.x)).add(dy.mul(k.y)), lo, hi)) as N).level(0);
      const m = i < 2 && j < 2 ? float(1) : fsel(n.greaterThan(2.5), float(1), float(0));
      acc = acc.add(vec4(c.rgb.mul(c.a), c.a).mul(m));
    }
    acc = acc.div(n.mul(n));
    out.assign(fsel(acc.a.greaterThan(0), vec4(acc.rgb.div(acc.a), acc.a), vec4(0)));
  });
  return out;
}

/** the vertex stage and varyings every creature material shares */
function cardNodes(U: CreatureUniforms) {
  const iA: N = attribute('iA', 'vec4'), iB: N = attribute('iB', 'vec4'), iUV: N = attribute('iUV', 'vec4'), iC: N = attribute('iC', 'vec4'), iD: N = attribute('iD', 'vec4');
  const corner: N = positionGeometry.xy;
  const worldPos: N = Fn(() => {
    const tx = corner.x.add(0.5).mul(iB.x);
    const ty = corner.y.mul(iB.y);
    const d = iA.xyz.sub(U.uCam);
    const st = clamp(length(d).div(fmax(length(d.xz), 0.5)), 1.0, 1.6);
    // LEAN_GLSL leanUp: the excess of the seen elevation over uLean tilts the card's up axis about the camera's right
    const el = atan(d.y.negate(), length(d.xz));
    const ex = fsel(U.uLean.greaterThan(0), sign(el).mul(fmax(0, abs(el).sub(U.uLean))), float(0));
    const up = vec3(U.uFwd.x.mul(sin(ex)), cos(ex), U.uFwd.z.mul(sin(ex)));
    const lx = tx.sub(iB.z).div(TEXELS_PER_METRE).mul(iA.w).add(iC.z);
    const ly = ty.sub(iB.y.sub(iB.w)).div(TEXELS_PER_METRE).mul(iA.w).mul(st).add(iD.w);
    return iA.xyz.add(U.uRight.mul(lx)).add(up.mul(ly.sub(iD.w))).add(vec3(0, iD.w, 0)).sub(U.uFwd.mul(iC.w));
  })();
  return { worldPos, vUV: varying(vec2(mix(iUV.x, iUV.z, corner.x.add(0.5)), mix(iUV.w, iUV.y, corner.y))) as N, vRect: varying(iUV).setInterpolation('flat') as N, vC: varying(iC) as N, vTint: varying(iD.xyz) as N };
}

export function creatureMaterial(U: CreatureUniforms, tex: Texture, xray: boolean): MeshBasicNodeMaterial {
  const { worldPos, vUV, vRect, vC, vTint } = cardNodes(U);
  const m = new MeshBasicNodeMaterial();
  m.positionNode = worldPos;
  m.colorNode = Fn(() => {
    const c: N = spriteTex(tex, vUV, vRect);
    Discard(c.a.lessThan(0.5));
    if (xray) {
      const q: N = mod(floor(screenCoordinate.xy), 2.0);
      const chk = select(q.x.equal(q.y), U.uSil.rgb, vec3(0.92, 1.0, 1.0));
      return vec4(select(dot(c.rgb, vec3(0.299, 0.587, 0.114)).lessThan(0.04), vec3(0.04, 0.1, 0.16), chk), 1.0);
    }
    const g: N = mod(floor(screenCoordinate.xy), 4.0);
    const th = g.x.mul(4.0).add(g.y).div(16.0);
    Discard(vC.y.greaterThan(0).and(th.lessThan(vC.y)));
    const col = min(c.rgb.mul(vTint).mul(U.uLight), vec3(1.0));
    return vec4(mix(col, vec3(1.0), vC.x), 1.0);
  })();
  if (xray) { m.depthFunc = GreaterDepth; m.depthWrite = false; m.fog = false; }
  return m;
}

const QUAD_POS = new BufferAttribute(new Float32Array([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0]), 3);
const QUAD_NRM = new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]), 3);
const QUAD_IDX = new BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1);

/** one atlas's instanced card mesh with room for `cap` instances */
export class CardBatch {
  readonly geo = new InstancedBufferGeometry();
  readonly attrs: InstancedBufferAttribute[];
  readonly mesh: Mesh;
  n = 0;
  constructor(readonly cap: number, material: MeshBasicNodeMaterial) {
    this.geo.setAttribute('position', QUAD_POS); this.geo.setAttribute('normal', QUAD_NRM); this.geo.setIndex(QUAD_IDX);
    this.attrs = BILLBOARD_ATTRS.map((name) => { const a = new InstancedBufferAttribute(new Float32Array(cap * 4), 4); a.setUsage(DynamicDrawUsage); this.geo.setAttribute(name, a); return a; });
    this.geo.instanceCount = 0;
    this.mesh = new Mesh(this.geo, material);
    this.mesh.frustumCulled = false;
  }
  /** append one instance (20 floats in the five attributes' order) */
  push(v: ArrayLike<number>) {
    if (this.n >= this.cap) return;
    const k = this.n++ * 4;
    for (let a = 0; a < 5; a++) (this.attrs[a].array as Float32Array).set([v[a * 4], v[a * 4 + 1], v[a * 4 + 2], v[a * 4 + 3]], k);
  }
  /** upload what was pushed this frame */
  commit() {
    this.geo.instanceCount = this.n; this.mesh.visible = this.n > 0;
    if (this.n) for (const a of this.attrs) { a.clearUpdateRanges(); a.addUpdateRange(0, this.n * 4); a.needsUpdate = true; }
  }
}
