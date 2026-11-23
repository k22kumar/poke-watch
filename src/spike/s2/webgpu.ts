// S2 spike: configurations 2 and 3, WebGPURenderer from 'three/webgpu' (on WebGPU, and with forceWebGL on its WebGL 2
// backend). ShaderMaterial does not run here, so the creature billboard is a TSL node material: the same maths as the
// game's CREATURE_VS / CREATURE_FS, LEAN_GLSL and SPRITE_SAMPLE_GLSL, written as nodes. Never merged.
import { GreaterDepth, MeshBasicNodeMaterial, PCFShadowMap, RenderPipeline, Vector3, Vector4, WebGPURenderer, type Camera, type Object3D, type Scene, type Texture } from 'three/webgpu';
import {
  Discard, Fn, If, abs, atan, attribute, cameraFar, cameraNear, clamp, cos, dFdx, dFdy, packNormalToRGB, perspectiveDepthToViewZ, dot, float, floor, length, max, min, mix, mod,
  mrt, normalView, output, pass, positionGeometry, screenCoordinate, screenUV, select, sign, sin, texture, textureSize, uniform,
  varying, vec2, vec3, vec4,
} from 'three/tsl';
import { TEXELS_PER_METRE } from '../../assets/art';
import type { Backend, BackendId, CreatureUniforms, FrameInfo } from './backend';

type N = any; // TSL node chains are typed loosely in @types/three; the spike does not fight them
// @types/three 0.187 rejects plain numbers and TextureSizeNode in some overloads; these are the same functions, untyped
const tsize: N = textureSize, v2: N = vec2, fmax: N = max, fsel: N = select;

/** SPRITE_SAMPLE_GLSL as nodes: one nearest tap at a texel per pixel or larger, else an n×n box (n 2 or 3) of nearest
 *  taps clamped inside the sprite's frame, alpha-weighted. The 3×3 loop is unrolled in JS with a mask per tap. */
function spriteTex(tex: Texture, uv: N, rect: N): N {
  const ts = v2(tsize(texture(tex), 0));
  const dx = dFdx(uv), dy = dFdy(uv);
  const fp = max(length(dx.mul(ts)), length(dy.mul(ts)));
  const one = (texture(tex, uv) as N).level(0);
  const n = select(fp.lessThan(2.3), float(2), float(3));
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
  const box = select(acc.a.greaterThan(0), vec4(acc.rgb.div(acc.a), acc.a), vec4(0));
  return select(fp.lessThan(1.3), one, box);
}

export async function createWebGPU(canvas: HTMLCanvasElement, forceWebGL: boolean): Promise<Backend> {
  const id: BackendId = forceWebGL ? 'webgpu-gl' : 'webgpu';
  const notes: string[] = [];
  const hasGPU = typeof navigator !== 'undefined' && !!(navigator as unknown as { gpu?: unknown }).gpu;
  notes.push(`navigator.gpu: ${hasGPU ? 'yes' : 'no'}`);
  const renderer = new WebGPURenderer({ canvas, antialias: false, forceWebGL, trackTimestamp: true, powerPreference: 'high-performance' } as never);
  renderer.setPixelRatio(1);
  await renderer.init();
  const be = (renderer as unknown as { backend: { isWebGPUBackend?: boolean; trackTimestamp?: boolean } }).backend;
  const actual = be.isWebGPUBackend ? 'WebGPU (WebGPURenderer)' : 'WebGL 2 (WebGPURenderer fallback)';
  notes.push(`timestamp queries: ${be.trackTimestamp ? 'yes' : 'no'}`);
  const cu: CreatureUniforms = { right: new Vector3(), fwd: new Vector3(), cam: new Vector3(), light: new Vector3(1, 1, 1), lean: { value: 0 }, sil: new Vector4(0.55, 0.95, 1, 1) };
  const uRight = uniform(cu.right), uFwd = uniform(cu.fwd), uCam = uniform(cu.cam), uLight = uniform(cu.light), uSil = uniform(cu.sil);
  const uLean = uniform(0);
  // the uniform node holds its own value; CreatureUniforms.lean is read through it
  Object.defineProperty(cu, 'lean', { value: { get value() { return uLean.value as number; }, set value(v: number) { uLean.value = v; } } });

  // the vertex stage, shared by every creature material (the per-instance attributes are the geometry's own)
  const iA: N = attribute('iA', 'vec4'), iB: N = attribute('iB', 'vec4'), iUV: N = attribute('iUV', 'vec4'), iC: N = attribute('iC', 'vec4'), iD: N = attribute('iD', 'vec4');
  const corner: N = positionGeometry.xy;
  const worldPos: N = Fn(() => {
    const tx = corner.x.add(0.5).mul(iB.x);
    const ty = corner.y.mul(iB.y);
    const d = iA.xyz.sub(uCam);
    const st = clamp(length(d).div(fmax(length(d.xz), 0.5)), 1.0, 1.6);
    // LEAN_GLSL leanUp: the excess over uLean of the seen elevation tilts the card's up axis about the camera's right;
    // with no excess the lean formula is the upright one, so the GLSL branch is not needed
    const el = atan(d.y.negate(), length(d.xz));
    const ex = fsel(uLean.greaterThan(0), sign(el).mul(fmax(0, abs(el).sub(uLean))), float(0));
    const up = vec3(uFwd.x.mul(sin(ex)), cos(ex), uFwd.z.mul(sin(ex)));
    const lx = tx.sub(iB.z).div(TEXELS_PER_METRE).mul(iA.w).add(iC.z);
    const ly = ty.sub(iB.y.sub(iB.w)).div(TEXELS_PER_METRE).mul(iA.w).mul(st).add(iD.w);
    return iA.xyz.add(uRight.mul(lx)).add(up.mul(ly.sub(iD.w))).add(vec3(0, iD.w, 0)).sub(uFwd.mul(iC.w));
  })();
  const vUV: N = varying(vec2(mix(iUV.x, iUV.z, corner.x.add(0.5)), mix(iUV.w, iUV.y, corner.y)));
  const vRect: N = varying(iUV);
  const vC: N = varying(iC), vTint: N = varying(iD.xyz);

  let edgeOn = false;
  let pipe: RenderPipeline | null = null;
  const b: Backend = {
    id, actual, canvas, cu, notes,
    get edges() { return edgeOn; },
    setSize(w, h) { renderer.setSize(w, h, false); },
    setShadows(on) { renderer.shadowMap.enabled = on; renderer.shadowMap.type = PCFShadowMap; },
    creatureMaterial(tex: Texture, xray: boolean) {
      const m = new MeshBasicNodeMaterial();
      m.positionNode = worldPos;
      m.colorNode = Fn(() => {
        const c: N = spriteTex(tex, vUV, vRect);
        Discard(c.a.lessThan(0.5));
        if (xray) {
          const q: N = mod(floor(screenCoordinate.xy), 2.0);
          const chk = select(q.x.equal(q.y), uSil.rgb, vec3(0.92, 1.0, 1.0));
          return vec4(select(dot(c.rgb, vec3(0.299, 0.587, 0.114)).lessThan(0.04), vec3(0.04, 0.1, 0.16), chk), 1.0);
        }
        const g: N = mod(floor(screenCoordinate.xy), 4.0);
        const th = g.x.mul(4.0).add(g.y).div(16.0);
        Discard(vC.y.greaterThan(0).and(th.lessThan(vC.y)));
        const col = min(c.rgb.mul(vTint).mul(uLight), vec3(1.0));
        return vec4(mix(col, vec3(1.0), vC.x), 1.0);
      })();
      if (xray) { m.depthFunc = GreaterDepth; m.depthWrite = false; m.fog = false; }
      return m;
    },
    render(scene, camera) {
      // with the pipeline (scene pass + quad) the info is summed over both passes
      if (pipe) { renderer.info.autoReset = false; renderer.info.reset(); pipe.render(); renderer.info.autoReset = true; } else renderer.render(scene, camera);
      if (be.trackTimestamp) void renderer.resolveTimestampsAsync('render');
    },
    info(): FrameInfo {
      const r = renderer.info.render as unknown as { drawCalls: number; triangles: number; timestamp: number };
      return { calls: r.drawCalls, triangles: r.triangles, gpuMs: be.trackTimestamp ? r.timestamp : null };
    },
    enableEdges(scene: Scene, camera: Camera, _hide: Object3D[]) {
      // one scene pass with MRT (colour + view normals), edges from its depth and normal textures
      const sp: N = pass(scene, camera);
      sp.setMRT(mrt({ output, normal: packNormalToRGB(normalView) }));
      const col: N = sp.getTextureNode('output'), nrm: N = sp.getTextureNode('normal'), dtex: N = sp.getTextureNode('depth');
      // view distance from the depth texture (getLinearDepthNode is not a texture node: it cannot be sampled at offsets)
      const lin = (uv: N): N => (perspectiveDepthToViewZ as N)(dtex.sample(uv).r, cameraNear, cameraFar).negate();
      const edgeNode: N = Fn(() => {
        const texel = v2(1).div(v2(tsize(col, 0)));
        const d = lin(screenUV);
        const n = nrm.sample(screenUV).xyz.mul(2).sub(1);
        let sum: N = float(0), ne: N = float(0);
        for (const o of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const uv = screenUV.add(vec2(o[0], o[1]).mul(texel));
          sum = sum.add(lin(uv));
          ne = ne.add(float(1).sub(dot(n, nrm.sample(uv).xyz.mul(2).sub(1))));
        }
        // depth: the Laplacian (flat ground at a grazing angle has none), normals: the summed bend to the 4 neighbours
        const de = abs(sum.sub(d.mul(4)));
        const e = clamp(de.greaterThan(d.mul(0.02)).select(1, 0).add(ne.greaterThan(0.6).select(1, 0)), 0, 1);
        return vec4(mix(col.sample(screenUV).rgb, vec3(0.08, 0.07, 0.1), e.mul(0.85)), 1);
      })();
      pipe = new RenderPipeline(renderer, edgeNode);
      edgeOn = true;
    },
  };
  void If;
  return b;
}
