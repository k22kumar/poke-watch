// S2 spike: configuration 1, WebGLRenderer from 'three'. The creature billboard is a ShaderMaterial in GLSL: the game's
// CREATURE_VS / CREATURE_FS (render/renderer.ts) with three's built-in uniforms (viewMatrix, projectionMatrix) and fog
// chunks in place of the game's own. Never merged.
import {
  Color, DepthTexture, GreaterDepth, Mesh, MeshNormalMaterial, NearestFilter, OrthographicCamera, PCFShadowMap, PlaneGeometry,
  Scene, ShaderMaterial, UnsignedIntType, Vector2, Vector3, Vector4, WebGLRenderer, WebGLRenderTarget,
  type Camera, type Object3D, type Texture,
} from 'three';
import { TEXELS_PER_METRE } from '../../assets/art';
import { LEAN_GLSL } from '../../render/tilestage';
import { SPRITE_SAMPLE_GLSL } from '../../render/spritesample';
import type { Backend, CreatureUniforms, FrameInfo } from './backend';

// three's ShaderMaterial (GLSL 1 spelling, compiled as GLSL ES 3.00 on WebGL 2: textureSize, textureLod and dFdx are
// available). `position` carries the quad corner (x -0.5..0.5, y 0..1), as aCorner did.
const VS = /* glsl */ `
attribute vec4 iA; attribute vec4 iB; attribute vec4 iUV; attribute vec4 iC; attribute vec4 iD;
uniform vec3 uRight; uniform vec3 uFwd; uniform vec3 uCam; uniform float uLean;
varying vec2 vUV; flat varying vec4 vRect; varying float vFlash; varying float vDis; varying vec3 vTint;
#include <fog_pars_vertex>
${LEAN_GLSL}
void main(){
  vec2 aCorner = position.xy;
  float tx = (aCorner.x + 0.5) * iB.x;
  float ty = aCorner.y * iB.y;
  vec3 d = iA.xyz - uCam;
  float st = clamp(length(d) / max(length(d.xz), 0.5), 1.0, 1.6);
  vec3 up = leanUp(d, uFwd, uLean);
  float lx = (tx - iB.z) / ${TEXELS_PER_METRE}.0 * iA.w + iC.z;
  float ly = (ty - (iB.y - iB.w)) / ${TEXELS_PER_METRE}.0 * iA.w * st + iD.w;
  vec3 w = iA.xyz + uRight * lx + vec3(0.0, ly, 0.0) - uFwd * iC.w;
  if (up.y < 1.0) w = iA.xyz + uRight * lx + up * (ly - iD.w) + vec3(0.0, iD.w, 0.0) - uFwd * iC.w;
  vUV = vec2(mix(iUV.x, iUV.z, aCorner.x + 0.5), mix(iUV.w, iUV.y, aCorner.y)); vRect = iUV;
  vFlash = iC.x; vDis = iC.y; vTint = iD.xyz;
  vec4 mvPosition = viewMatrix * vec4(w, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const FS = /* glsl */ `
uniform sampler2D uTex; uniform vec3 uLight; uniform vec4 uSil;
varying vec2 vUV; flat varying vec4 vRect; varying float vFlash; varying float vDis; varying vec3 vTint;
#include <fog_pars_fragment>
${SPRITE_SAMPLE_GLSL}
void main(){
  vec4 c = spriteTex(uTex, vUV, vRect);
  if (c.a < 0.5) discard;
#ifdef XRAY
  // the sprite's own dark outline stays dark, the body becomes a cyan/white checker (renderer.ts CREATURE_FS)
  if (dot(c.rgb, vec3(0.299, 0.587, 0.114)) < 0.04) { gl_FragColor = vec4(0.04, 0.1, 0.16, 1.0); return; }
  vec2 q = mod(floor(gl_FragCoord.xy), 2.0);
  gl_FragColor = vec4(q.x == q.y ? uSil.rgb : vec3(0.92, 1.0, 1.0), 1.0);
  return;
#endif
  if (vDis > 0.0) { vec2 g = mod(floor(gl_FragCoord.xy), 4.0); float th = (g.x * 4.0 + g.y) / 16.0; if (th < vDis) discard; }
  vec3 col = min(c.rgb * vTint * uLight, vec3(1.0));
  gl_FragColor = vec4(mix(col, vec3(1.0), vFlash), 1.0);
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

// edge pass (step 3 extra): colour + depth from the main pass, view normals from a pre-pass with MeshNormalMaterial
// (WebGLRenderer's built-in materials write one colour output, so there is no MRT normal for free)
const EDGE_VS = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const EDGE_FS = /* glsl */ `
uniform sampler2D tColor; uniform sampler2D tDepth; uniform sampler2D tNormal; uniform vec2 uTexel; uniform vec2 uNF;
varying vec2 vUv;
float lin(vec2 uv){ float z = texture2D(tDepth, uv).x * 2.0 - 1.0; return 2.0 * uNF.x * uNF.y / (uNF.y + uNF.x - z * (uNF.y - uNF.x)); }
void main(){
  float d = lin(vUv);
  vec3 n = texture2D(tNormal, vUv).xyz * 2.0 - 1.0;
  float sum = 0.0, ne = 0.0;
  for (int i = 0; i < 4; i++) {
    vec2 o = i == 0 ? vec2(1.0, 0.0) : i == 1 ? vec2(-1.0, 0.0) : i == 2 ? vec2(0.0, 1.0) : vec2(0.0, -1.0);
    vec2 uv = vUv + o * uTexel;
    sum += lin(uv);
    ne += 1.0 - dot(n, texture2D(tNormal, uv).xyz * 2.0 - 1.0);
  }
  // depth: the Laplacian (flat ground at a grazing angle has none), normals: the summed bend to the 4 neighbours
  float e = clamp(step(0.02 * d, abs(sum - 4.0 * d)) + step(0.6, ne), 0.0, 1.0);
  vec4 c = texture2D(tColor, vUv);
  gl_FragColor = vec4(mix(c.rgb, vec3(0.08, 0.07, 0.1), e * 0.85), 1.0);
  #include <colorspace_fragment>
}`;

export async function createWebGL(canvas: HTMLCanvasElement): Promise<Backend> {
  const renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1);
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const notes: string[] = [];
  const cu: CreatureUniforms = { right: new Vector3(), fwd: new Vector3(), cam: new Vector3(), light: new Vector3(1, 1, 1), lean: { value: 0 }, sil: new Vector4(0.55, 0.95, 1, 1) };
  const shared = {
    uRight: { value: cu.right }, uFwd: { value: cu.fwd }, uCam: { value: cu.cam }, uLight: { value: cu.light }, uLean: cu.lean, uSil: { value: cu.sil },
    fogColor: { value: new Color() }, fogNear: { value: 1 }, fogFar: { value: 2000 }, fogDensity: { value: 0 },
  };
  // GPU time: EXT_disjoint_timer_query_webgl2, when the browser exposes it
  const tq = gl.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  notes.push(`EXT_disjoint_timer_query_webgl2: ${tq ? 'yes' : 'no'}`);
  const pending: WebGLQuery[] = [];
  let gpuMs: number | null = null;

  let edgeOn = false;
  let edge: { rt: WebGLRenderTarget; nrt: WebGLRenderTarget; mat: ShaderMaterial; quad: Mesh; qs: Scene; qc: OrthographicCamera; nm: MeshNormalMaterial; hide: Object3D[] } | null = null;

  const b: Backend = {
    id: 'webgl', actual: 'WebGL 2 (WebGLRenderer)', canvas, cu, notes,
    get edges() { return edgeOn; },
    setSize(w, h) {
      renderer.setSize(w, h, false);
      if (edge) { edge.rt.setSize(w, h); edge.nrt.setSize(w, h); (edge.mat.uniforms.uTexel.value as Vector2).set(1 / w, 1 / h); }
    },
    setShadows(on) { renderer.shadowMap.enabled = on; renderer.shadowMap.type = PCFShadowMap; },
    creatureMaterial(tex: Texture, xray: boolean) {
      const m = new ShaderMaterial({ vertexShader: VS, fragmentShader: FS, uniforms: { ...shared, uTex: { value: tex } }, fog: true, defines: xray ? { XRAY: 1 } : {} });
      if (xray) { m.depthFunc = GreaterDepth; m.depthWrite = false; }
      return m;
    },
    render(scene, camera: Camera) {
      let q: WebGLQuery | null = null;
      if (tq && pending.length < 4) { q = gl.createQuery(); gl.beginQuery(tq.TIME_ELAPSED_EXT, q!); }
      if (!edge) renderer.render(scene, camera);
      else {
        // normal pre-pass (no billboards), then the lit pass into the colour + depth target, then the edge quad
        const vis = edge.hide.map((o) => o.visible);
        for (const o of edge.hide) o.visible = false;
        const sh = renderer.shadowMap.autoUpdate; renderer.shadowMap.autoUpdate = false;
        scene.overrideMaterial = edge.nm;
        renderer.setRenderTarget(edge.nrt); renderer.render(scene, camera);
        scene.overrideMaterial = null; renderer.shadowMap.autoUpdate = sh;
        edge.hide.forEach((o, i) => (o.visible = vis[i]));
        const calls = renderer.info.render.calls, tris = renderer.info.render.triangles;
        renderer.info.autoReset = false;
        renderer.setRenderTarget(edge.rt); renderer.render(scene, camera);
        renderer.setRenderTarget(null); renderer.render(edge.qs, edge.qc);
        renderer.info.autoReset = true;
        void calls; void tris;
      }
      if (q) { gl.endQuery(tq!.TIME_ELAPSED_EXT); pending.push(q); }
      while (pending.length && gl.getQueryParameter(pending[0], gl.QUERY_RESULT_AVAILABLE)) {
        const p = pending.shift()!;
        if (!gl.getParameter(tq!.GPU_DISJOINT_EXT)) gpuMs = gl.getQueryParameter(p, gl.QUERY_RESULT) / 1e6;
        gl.deleteQuery(p);
      }
    },
    info(): FrameInfo { return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, gpuMs }; },
    enableEdges(_scene, camera, hide) {
      const w = canvas.width, h = canvas.height;
      const rt = new WebGLRenderTarget(w, h, { depthTexture: new DepthTexture(w, h, UnsignedIntType) });
      const nrt = new WebGLRenderTarget(w, h, { minFilter: NearestFilter, magFilter: NearestFilter });
      const cam = camera as unknown as { near: number; far: number };
      const mat = new ShaderMaterial({ vertexShader: EDGE_VS, fragmentShader: EDGE_FS, depthTest: false, depthWrite: false,
        uniforms: { tColor: { value: rt.texture }, tDepth: { value: rt.depthTexture }, tNormal: { value: nrt.texture }, uTexel: { value: new Vector2(1 / w, 1 / h) }, uNF: { value: new Vector2(cam.near, cam.far) } } });
      const quad = new Mesh(new PlaneGeometry(2, 2), mat); quad.frustumCulled = false;
      const qs = new Scene(); qs.add(quad);
      edge = { rt, nrt, mat, quad, qs, qc: new OrthographicCamera(-1, 1, 1, -1, 0, 1), nm: new MeshNormalMaterial(), hide };
      edgeOn = true;
    },
  };
  // sprite colour spaces: the atlas is sRGB (decoded on sampling), output through colorspace_fragment like built-ins
  return b;
}
