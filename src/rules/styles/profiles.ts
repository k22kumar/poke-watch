// World style profiles (docs/WORLDGEN3D.md Q18.1, Q23; docs/RENDER3D.md): the game's look and its constraints, as data.
// The registry is closed: a profile id is a member of PROFILE_IDS, and adding one (storybook, task SB) adds a member and
// a record here without changing the material family or the pass registry (D11). Only `lowpoly` exists until SB.
//
// Presentation only: nothing in the sim, the world or a hash reads this file. Every look number below is provisional
// (marked "provisional"): I2a built the machinery and left the look values neutral or transcribed from today's tables
// until the owner sets them (docs/RENDER3D.md "Look values").
import type { MaterialRole } from '../materialroles';
import type { RenderRole } from './bindings';
import type { PostPassId } from './passes';

/** the closed profile registry (Q18.1a): one ships; dev builds may pick another with ?profile= */
export const PROFILE_IDS = ['lowpoly'] as const;
export type ProfileId = (typeof PROFILE_IDS)[number];

/** how the renderer computes a face's normals (Q16.4, Q23): per face, split at the profile's crease angle, or smooth */
export type NormalMode = 'flat' | 'crease' | 'smooth';
export const NORMAL_MODES: readonly NormalMode[] = ['flat', 'crease', 'smooth'];

/** a role-driven world-space pattern (Q18.2); the registry is closed. `none` is the only member until a profile needs one */
export const PATTERN_IDS = ['none'] as const;
export type PatternId = (typeof PATTERN_IDS)[number];

/** the diffuse ramp, from continuous (bands 0) to banded (Q18.2 as superseded by Q23) */
export interface Ramp {
  /** band count over the lit half (0 = continuous Lambert) */
  bands: number;
  /** each band edge's softness, as a fraction of a band (0 = hard) */
  soft: number;
}

/** per-role shading parameters a profile sets (the base colour comes from the biome binding) */
export interface RoleShading {
  ramp: Ramp;
  normal: NormalMode;
  /** multiplies the ambient fill: tinted shadows, never black (Q18.2) */
  shadowTint: [number, number, number];
  pattern: PatternId;
  patternStrength: number;
  /** 0..1: this role's share of the ink pass's weight */
  ink: number;
}

/** the shape block (Q23): render-side geometry treatments. I2a reads only creaseAngle; the rest are G1b's builders' */
export interface ShapeBlock {
  /** degrees: faces meeting at a sharper angle keep separate normals (normal mode `crease`) */
  creaseAngle: number;
  /** m: the chamfer width of kit pieces (G1b) */
  chamfer: number;
  /** 0..1: vertex jitter of visual-only geometry (G1b) */
  irregularity: number;
  /** m: the default minimum thickness of dressing and backdrop archetypes (Q23.7) */
  minThickness: number;
  /** strokes per m² of painted accents (G1b, Q23.6) */
  strokeDensity: number;
}

/** the paint block (Q23): tonal variation without image textures (Q23.6) */
export interface PaintBlock {
  /** the facet tone's amplitude (0 = none) */
  facetTone: number;
  /** how a face takes its facet tone: `plane`, a hash per plane (±); `oriented`, locked to orientation, tops + and
   *  sides − (a face is a top when its normal is within 60° of up) */
  facetMode: 'plane' | 'oriented';
  /** darkening per metre below the local top, up to 1 at 4 m (0 = none) */
  verticalGradient: number;
  /** lightening along crease edges, drawn by the ink pass (0 = none) */
  edgeLight: number;
  /** amplitude of horizontal strata bands on steep faces (0 = none) */
  strata: number;
  /** m: the strata band height */
  strataSpacing: number;
}

/** ink pass parameters (registry `ink`) */
export interface InkParams {
  /** 0 = the pass is not built (Q23: a pass at zero weight is not built) */
  weight: number;
  colour: [number, number, number];
  /** relative depth step (fraction of the view depth) that counts as an edge */
  depthEdge: number;
  /** summed normal bend to the four neighbours that counts as an edge */
  normalEdge: number;
}

/** bloom pass parameters (registry `bloom`); Q23.5: glow never depends on bloom */
export interface BloomParams {
  strength: number;
  radius: number;
  threshold: number;
  /** the bloom targets' size as a fraction of the frame (its quality, Q20(c)) */
  resolution: number;
}

/** clamps the resolver applies last (Q18.1: the profile is both the base and the final guard) */
export interface Constraints {
  maxBands: number;
  maxInk: number;
  /** grading's allowed ranges */
  saturation: [number, number];
  gamma: [number, number];
  /** the largest |lift| */
  lift: number;
  gain: [number, number];
}

export interface StyleProfile {
  id: ProfileId;
  /** per-role defaults */
  roles: Record<MaterialRole, RoleShading>;
  /** per render-side role (bindings.ts RENDER_ROLES) */
  renderRoles: Record<RenderRole, RoleShading>;
  /** liquids: the same bands plus transparency and flow (Q18.3) */
  liquid: { ramp: Ramp; opacity: number; flow: number };
  shape: ShapeBlock;
  paint: PaintBlock;
  /** paint overrides per light class of the binding (BiomeBinding.light), over `paint` and under a map's look */
  paintByLight: Partial<Record<'day' | 'night' | 'cave', Partial<PaintBlock>>>;
  /** the pass list, in order, from the closed registry (Q18.4 as superseded by Q23) */
  passes: PostPassId[];
  ink: InkParams;
  bloom: BloomParams;
  constraints: Constraints;
}

const WHITE: [number, number, number] = [1, 1, 1];
/** one role's defaults: flat-shaded continuous Lambert, no pattern, an ink share of 0.35 (the owner's look-sheet pick,
 *  2026-11-27, docs/looksheet p1i1); the ramp, normal mode and shadow tint stay provisional */
const flat = (o: Partial<RoleShading> = {}): RoleShading => ({ ramp: { bands: 0, soft: 0 }, normal: 'flat', shadowTint: WHITE, pattern: 'none', patternStrength: 0, ink: 0.35, ...o });

export const STYLE_PROFILES: Record<ProfileId, StyleProfile> = {
  lowpoly: {
    id: 'lowpoly',
    roles: {
      ground: flat(), path: flat(), soil: flat(), rock: flat(), cliff: flat(), bed: flat(),
      floor: flat(), wall: flat(), roof: flat(), trim: flat(),
      cover: flat(), foliage: flat(), trunk: flat(),
      objective: flat(), hazard: flat(),
    },
    renderRoles: { endgrain: flat() },
    liquid: { ramp: { bands: 0, soft: 0 }, opacity: 0.78, flow: 0 },
    // provisional: S2's crease-free tile boxes need none of the G1b numbers yet
    shape: { creaseAngle: 30, chamfer: 0, irregularity: 0, minThickness: 0.1, strokeDensity: 0 },
    // the owner's look-sheet pick (2026-11-27, docs/looksheet p1i1): the facet tone locked to orientation (+0.06 tops,
    // −0.06 sides, Q23.3) and the moderate set: vertical gradient 0.25, edge light 0.12, strata 0.08 on steep faces
    paint: { facetTone: 0.06, facetMode: 'oriented', verticalGradient: 0.25, edgeLight: 0.12, strata: 0.08, strataSpacing: 0.5 },
    // dim scenes (owner, 2026-11-27, after the cave and night sweep): caves and night take facet tone ±0.10; day maps
    // keep ±0.06
    paintByLight: { cave: { facetTone: 0.1 }, night: { facetTone: 0.1 } },
    // both optional passes are listed and built only at a weight above zero; provisional weights are zero
    passes: ['ink', 'bloom'],
    // thin (1 px) dark ink at weight 1 × each role's share (0.35): the owner's pick, p1i1
    ink: { weight: 1, colour: [0.08, 0.07, 0.1], depthEdge: 0.02, normalEdge: 0.6 },
    // bloom's default (I2a's profiling, docs/RENDER3D.md "Budgets"): off; when a profile turns it on, its quality is
    // a quarter-resolution first target, the cheapest measured (it is over the post budget even there: ROADMAP F108)
    bloom: { strength: 0, radius: 0.2, threshold: 0.85, resolution: 0.25 },
    constraints: { maxBands: 8, maxInk: 1, saturation: [0, 2], gamma: [0.5, 2], lift: 0.25, gain: [0.5, 1.5] },
  },
};

export const isProfileId = (s: string | null | undefined): s is ProfileId => !!s && (PROFILE_IDS as readonly string[]).includes(s);
