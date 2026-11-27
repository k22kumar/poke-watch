// The world material family (docs/WORLDGEN3D.md Q18.2 as superseded by Q23; docs/RENDER3D.md "The material family"):
// one TSL node material for every opaque world surface, driven by a role's resolved parameters, never by a biome:
//   - a diffuse ramp from continuous (bands 0) to banded, on the key light (one DirectionalLight with its shadow map);
//   - the ambient rig: two sets of six colours (open sky, enclosed), blended by the vertex's baked sky visibility and
//     read by the world normal as an ambient cube, times the role's shadow tint (tinted shadows, never black);
//   - the baked lamp channel (per-vertex local light) times the time-of-day lamp strength;
//   - the profile's paint terms: facet tone, vertical gradient, strata (edge light is drawn by the ink pass);
//   - emissive for self-lit liquids.
// The liquid kind is the same family with transparency (Q18.3). Normal modes are the geometry's (render/world3d/mesh.ts).
// Every value here comes from a ResolvedStyle (rules/styles) or the LightUniforms of the one time-of-day path.
import { DoubleSide, LightingModel, NodeMaterial, Vector3 } from 'three/webgpu';
import { attribute, clamp, diffuseColor, float, floor, fract, min, mix, mrt, normalView, normalWorld, packNormalToRGB, positionWorld, select, smoothstep, uniform, vec3, vec4 } from 'three/tsl';
import type { Ramp } from '../../rules/styles/profiles';
import type { RoleMaterial } from '../../rules/styles/resolve';
import type { PaintBlock } from '../../rules/styles/profiles';
import { srgbToLinear, type LightUniforms } from '../world3d/lighting';

type N = any; // TSL node chains are loosely typed in @types/three 0.187 (S2 F42)

/** the light rig's uniforms, shared by every world material and written only by `apply` (the one path, D12) */
export class WorldLight {
  readonly open = Array.from({ length: 6 }, () => new Vector3());
  readonly enclosed = Array.from({ length: 6 }, () => new Vector3());
  readonly uOpen: N[] = this.open.map((v) => uniform(v));
  readonly uEnclosed: N[] = this.enclosed.map((v) => uniform(v));
  readonly uLamp: N = uniform(0);
  apply(L: LightUniforms) {
    for (let i = 0; i < 6; i++) {
      this.open[i].set(L.ambOpen[i * 3], L.ambOpen[i * 3 + 1], L.ambOpen[i * 3 + 2]);
      this.enclosed[i].set(L.ambEnclosed[i * 3], L.ambEnclosed[i * 3 + 1], L.ambEnclosed[i * 3 + 2]);
    }
    this.uLamp.value = L.lamp;
  }
}

/** the ramp on n·l: continuous, or `bands` steps with soft edges */
function ramp(ndl: N, r: Ramp): N {
  if (r.bands <= 0) return ndl;
  const x = ndl.mul(r.bands);
  const s = Math.max(0.001, r.soft);
  return clamp(floor(x).add(smoothstep(float(1 - s), float(1), fract(x))).div(r.bands), 0, 1);
}

/** an ambient cube: the six colours weighted by the squared normal components, the sign picking each axis's side */
function cube(n: N, six: N[]): N {
  const n2 = n.mul(n);
  return select(n.x.greaterThan(0), six[0], six[1]).mul(n2.x)
    .add(select(n.y.greaterThan(0), six[2], six[3]).mul(n2.y))
    .add(select(n.z.greaterThan(0), six[4], six[5]).mul(n2.z));
}

class WorldLighting extends LightingModel {
  constructor(private readonly r: Ramp, private readonly W: WorldLight, private readonly tint: [number, number, number]) { super(); }
  direct({ lightDirection, lightColor, reflectedLight }: N) {
    const ndl = normalView.dot(lightDirection).clamp();
    reflectedLight.directDiffuse.addAssign(ramp(ndl, this.r).mul(lightColor).mul(diffuseColor.rgb));
  }
  indirect(builder: N) {
    const { reflectedLight } = builder.context;
    const sky: N = attribute('aSky', 'float');
    const amb = mix(cube(normalWorld, this.W.uEnclosed), cube(normalWorld, this.W.uOpen), sky).mul(vec3(...this.tint));
    const lamp: N = attribute('aLamp', 'vec3').mul(this.W.uLamp);
    reflectedLight.indirectDiffuse.addAssign(amb.add(lamp).mul(diffuseColor.rgb));
  }
}

class WorldNodeMaterial extends NodeMaterial {
  constructor(private readonly make: () => LightingModel) { super(); this.lights = true; }
  setupLightingModel() { return this.make(); }
}

const lin = (c: [number, number, number]): [number, number, number] => [srgbToLinear(c[0]), srgbToLinear(c[1]), srgbToLinear(c[2])];

/** the paint terms on the base colour (Q23.6): facet tone, the vertical gradient below the local top, strata on steep
 *  faces. Terms at zero build no nodes */
function painted(base: [number, number, number], P: PaintBlock): N {
  let c: N = vec3(...lin(base));
  if (P.facetTone > 0) {
    // by plane: the baked hash; locked to orientation: + on tops (normal within 60° of up), − on every other face
    const top: N = normalWorld.y.greaterThan(0.5);
    const f: N = P.facetMode === 'oriented' ? select(top, float(1), float(-1)) : attribute('aFacet', 'float');
    c = c.mul(float(1).add(f.mul(P.facetTone)));
  }
  if (P.verticalGradient > 0) c = c.mul(float(1).sub(min(float(1), attribute('aDepth', 'float').div(4)).mul(P.verticalGradient)));
  if (P.strata > 0) {
    const steep = float(1).sub(smoothstep(0.35, 0.6, normalWorld.y.abs()));
    const band = smoothstep(0.42, 0.5, fract(positionWorld.y.div(P.strataSpacing)));
    c = c.mul(float(1).sub(band.mul(steep).mul(P.strata)));
  }
  return c;
}

/** the normal target's value for a surface: view normal, and the ink share in alpha (render/three/passes.ts reads it).
 *  Set only when the pipeline has a normal target: with none, a material MRT would replace the colour output */
export const normalTarget = (ink: number): N => (vec4 as N)(packNormalToRGB(normalView), ink);

/** one role's opaque world material; `normals`: the pipeline has a normal target (a built pass needs it) */
export function worldMaterial(m: RoleMaterial, P: PaintBlock, W: WorldLight, normals = false): NodeMaterial {
  const mat = new WorldNodeMaterial(() => new WorldLighting(m.ramp, W, m.shadowTint));
  mat.colorNode = vec4(painted(m.base, P), 1);
  if (normals) mat.mrtNode = mrt({ normal: normalTarget(m.ink) });
  mat.side = DoubleSide; // the adapter's side faces are not consistently wound (ROADMAP F104)
  return mat;
}

/** a liquid's material: the same family, transparent, self-lit by its `emissive` share */
export function liquidMaterial(colour: [number, number, number], emissive: number, opacity: number, r: Ramp, W: WorldLight): NodeMaterial {
  const mat = new WorldNodeMaterial(() => new WorldLighting(r, W, [1, 1, 1]));
  const c = vec3(...lin(colour));
  mat.colorNode = vec4(c, opacity);
  if (emissive > 0) (mat as N).emissiveNode = c.mul(emissive);
  mat.transparent = true; mat.depthWrite = false;
  return mat;
}
