// The post passes and the frame's pass order (docs/WORLDGEN3D.md Q18.4 as superseded by Q23, S2 decision 2;
// docs/RENDER3D.md "Pass order"). One RenderPipeline:
//
//   scene pass (world, actors; MRT normals only when a built pass needs them)
//   → the profile's registry passes, in its order (ink, bloom; a pass at zero weight is not built)
//   → renderOutput (tone mapping and the sRGB transform)
//   → grading (lift, gamma, gain, saturation: a keyframe value of the one time-of-day path) and the vignette
//   → the signal composite: the signal scene's own pass, sRGB-encoded and laid over the graded frame.
//
// Signals are drawn after grading and never see the scene's fog (their scene has none) or bloom (it runs on the scene
// pass only), so a signal's colour and luminance on screen do not change with a map's grade, fog or bloom (Q23 confirmed
// point 6). tools/three-signal.mjs checks the pixels. Which signal kinds exist and how each meets the world's depth
// (its occlusion rule, Q23.4c) is I2b's.
import { NoToneMapping, RenderPipeline, SRGBColorSpace, Vector3, type Camera, type Scene, type WebGPURenderer } from 'three/webgpu';
import { Fn, abs, convertToTexture, floor, mod, screenCoordinate, cameraFar, cameraNear, clamp, dot, float, length, max, mix, mrt, normalView, output, packNormalToRGB, pass, perspectiveDepthToViewZ, pow, renderOutput, screenUV, smoothstep, textureSize, uniform, vec2, vec3, vec4 } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { PASS_NEEDS, type PostPassId } from '../../rules/styles/passes';
import type { ResolvedStyle } from '../../rules/styles/resolve';
import { srgbToLinear, type LightUniforms } from '../world3d/lighting';

type N = any; // TSL node chains are loosely typed in @types/three 0.187 (S2 F42)
const tsize: N = textureSize, v2: N = vec2, v4: N = vec4;

/** grading's uniforms, written only by `apply` from the one time-of-day path */
export class Grade {
  readonly lift = new Vector3(); readonly gamma = new Vector3(1, 1, 1); readonly gain = new Vector3(1, 1, 1);
  readonly uLift: N = uniform(this.lift); readonly uGamma: N = uniform(this.gamma); readonly uGain: N = uniform(this.gain);
  readonly uSat: N = uniform(1);
  apply(L: LightUniforms) { this.lift.set(...L.lift); this.gamma.set(...L.gamma); this.gain.set(...L.gain); this.uSat.value = L.saturation; }
}

interface PassInput { col: N; scene: N; S: ResolvedStyle }
type PassImpl = (p: PassInput) => N;

/** the ink pass (S2's edge pass over depth and normals): darkens depth and normal edges by the ink weight × the role's
 *  ink share (the normal target's alpha), and lightens normal creases by the paint block's edge light */
const ink: PassImpl = ({ col: input, scene, S }) => {
  // a pass before this one hands over a node, not a texture: sample it through one
  const col: N = input.isTextureNode ? input : (convertToTexture as N)(input);
  const nrm: N = scene.getTextureNode('normal'), dtex: N = scene.getTextureNode('depth');
  const lin = (uv: N): N => (perspectiveDepthToViewZ as N)(dtex.sample(uv).r, cameraNear, cameraFar).negate();
  const I = S.ink, edgeLight = S.paint.edgeLight;
  return Fn(() => {
    const texel = v2(1).div(v2(tsize(col, 0)));
    const d = lin(screenUV);
    const n0: N = nrm.sample(screenUV);
    const n = n0.xyz.mul(2).sub(1);
    let sum: N = float(0), ne: N = float(0);
    for (const o of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const uv = screenUV.add(vec2(o[0], o[1]).mul(texel));
      sum = sum.add(lin(uv));
      ne = ne.add(float(1).sub(dot(n, nrm.sample(uv).xyz.mul(2).sub(1))));
    }
    const de = abs(sum.sub(d.mul(4)));
    const depthEdge = de.greaterThan(d.mul(I.depthEdge)).select(1, 0);
    const normalEdge = ne.greaterThan(I.normalEdge).select(1, 0);
    const e = clamp(depthEdge.add(normalEdge), 0, 1).mul(n0.a).mul(I.weight);
    const c: N = col.sample(screenUV);
    const lit = edgeLight > 0 ? c.rgb.add(vec3(normalEdge.mul(edgeLight).mul(n0.a))) : c.rgb;
    return vec4(mix(lit, vec3(...I.colour.map(srgbToLinear)), e), c.a);
  })();
};

/** bloom (three's BloomNode), added over the scene; Q23.5: nothing depends on it */
const bloomPass: PassImpl = ({ col, S }) => {
  const b: N = bloom(col, S.bloom.strength, S.bloom.radius, S.bloom.threshold);
  b.setResolutionScale?.(S.bloom.resolution);
  return col.add(b);
};

/** the closed registry's implementations (rules/styles/passes.ts ids) */
export const PASS_IMPLS: Record<PostPassId, PassImpl> = { ink, bloom: bloomPass };

/** the 4 × 4 Bayer threshold (render/renderer.ts VIG_FS's table) at a pixel's (x mod 4, y mod 4), in (0, 1) */
export function bayer4(g: N): N {
  // b[y * 4 + x] = 0 8 2 10 / 12 4 14 6 / 3 11 1 9 / 15 7 13 5, as bit maths: the classic recursive construction
  const x: N = g.x, y: N = g.y;
  const x0 = mod(x, 2), y0 = mod(y, 2), x1 = floor(x.div(2)), y1 = floor(y.div(2));
  const lo = x0.mul(2).add(y0.mul(3)).sub(x0.mul(y0).mul(4)); // 0 2 / 3 1 at the fine level
  const hi = x1.mul(2).add(y1.mul(3)).sub(x1.mul(y1).mul(4));
  return lo.mul(4).add(hi).add(0.5).div(16);
}

/** display-space grading: lift, gain, gamma per channel, then saturation around luminance */
function grade(c: N, G: Grade): N {
  let x: N = c.add(G.uLift.mul(float(1).sub(c))).mul(G.uGain);
  x = pow(max(x, vec3(0)), vec3(1).div(G.uGamma));
  const l = dot(x, vec3(0.2126, 0.7152, 0.0722));
  return mix(vec3(l), x, G.uSat);
}

export interface Pipeline {
  pipe: RenderPipeline;
  /** the passes actually built, in order */
  built: PostPassId[];
  normals: boolean;
  signals: boolean;
}

/** assemble the frame. `signals`: the signal scene, or null when nothing draws there (no pass is built for it) */
export function buildPipeline(renderer: WebGPURenderer, scene: Scene, signals: Scene | null, camera: Camera, S: ResolvedStyle, G: Grade): Pipeline {
  const built = S.passes;
  const normals = built.some((id) => PASS_NEEDS[id].normals);
  const sp: N = pass(scene, camera);
  // the normal target's alpha is the material's ink share: 0 here (sky, actors, liquids), a role's share where a world
  // material sets its own (worldmat.ts normalTarget)
  if (normals) sp.setMRT(mrt({ output, normal: v4(packNormalToRGB(normalView), 0) }));
  let col: N = sp.getTextureNode('output');
  for (const id of built) col = PASS_IMPLS[id]({ col, scene: sp, S });
  // the output step: tone mapping and the colour transform, then grading and the vignette in display space
  let disp: N = grade((renderOutput as N)(col, NoToneMapping, SRGBColorSpace).rgb, G);
  const V = S.vignette;
  if (V.amount > 0) {
    // today's vignette (render/renderer.ts VIG_FS): an ellipse following the screen (r 1 in the corners), four flat
    // levels dithered between them on a 4 × 4 Bayer grid
    const r = length(screenUV.sub(0.5).mul(Math.SQRT2));
    const g: N = mod(floor(screenCoordinate.xy), 4.0);
    const th = bayer4(g);
    const a = floor(smoothstep(0.55, 1.0, r).mul(V.amount * 4).add(th)).div(4);
    disp = mix(disp, vec3(...V.colour), a);
  }
  let final: N = v4(disp, 1);
  if (signals) {
    const sg: N = pass(signals, camera);
    const s: N = sg.getTextureNode('output');
    const enc: N = (renderOutput as N)(s, NoToneMapping, SRGBColorSpace);
    final = v4(mix(disp, enc.rgb, clamp(s.a, 0, 1)), 1);
  }
  const pipe = new RenderPipeline(renderer, final);
  pipe.outputColorTransform = false;
  return { pipe, built, normals, signals: !!signals };
}
