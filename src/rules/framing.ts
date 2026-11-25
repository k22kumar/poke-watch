// The single framing source (docs/WORLDGEN3D.md Q7c, CL-Q4, CL-Q5, CL-Q8): every number the chase camera is framed
// with, for both cameras, and the numbers the map generator sizes spaces from. Presentation only: nothing here changes
// physical scale, line of sight, concealment, targeting or combat. Pure data and pure functions (no three, no DOM), so
// src/render, src/world and the Node tools read the same values.
//
//   the old renderer   today's framing law, moved here unchanged: src/render/camera.ts CHASE_CONFIG reads these
//                      fields (back distance from the sprite's drawn height, docs/THIRD_PERSON.md "Composition")
//   the 3D rig (I2b)   CL's law: the lens at the anatomical eye's height at the neutral pitch, no cap, never above
//                      the eye (CL-Q4, CL-Q5); its distance D = k × the anatomy table's height inside [min, max]
//                      (CL-Q8, provisional, ROADMAP F99)
//   the generator      cameraClearance(rules): the `camera-clearance` ceiling and short side and the tall-dressing
//                      keep-out (Q7, Q17.5), sized for the Extra Large class (Q7)
import { defaultRules, type Rules } from './defaults';
import { maxEyeFraction } from './anatomy';

export const FRAMING = {
  /** the old renderer's law (render/framing.ts backFor): back distance = `boom` × (drawn body height / `ref`) ^ `exp`,
   *  inside [`min`, `max`]; `settle` s eases an outline change (CHASE_CONFIG.frame documents each) */
  frame: { ref: 1.9, boom: 4.3, exp: 1, min: 1.8, max: 14, settle: 0.45 },
  /** the keep-out around the crosshair (deg) and the combat allowance (CHASE_CONFIG.reticle) */
  reticle: { side: 7, below: 3, reach: 4, rise: 0 },
  /** the shoulder offset is at most this share of the back distance (CHASE_CONFIG.shoulderMax) */
  shoulderMax: 0.6,
  /** the arm's elevation inside the orbit range (deg; CHASE_CONFIG.elevation) */
  elevation: [2, 40] as [number, number],
  /** the view's pitch below the horizon with no input (deg; CHASE_CONFIG.aimPitch.neutral) */
  neutralPitch: 11,
  /** the lens keeps this far from terrain, bare walls and deck undersides (m; CHASE_CONFIG.lens.clear, the near plane) */
  lensClear: 0.3,
  /** under a deck the lens stays this far under the slab (m; CHASE_CONFIG.deck.clearance) */
  deckClearance: 0.45,
  /** CL-Q8: the 3D rig's distance D = `k` × the anatomy table's height, inside [`min`, `max`] m. `max` binds only above
   *  2.57 m tall (no hero); raising it after G1 is a planned layout change (F99) */
  law: { k: 3.5, min: 1.8, max: 9.0 },
  /** CL-Q4, CL-Q5: the view band, a presentation rule only, used by clampToBand alone (the live law puts the lens at
   *  the eye, lensHeight). `floor` is applied as min(floor, eye), so a lens is never lifted above its eye */
  band: { floor: 0.6, cap: 1.35 },
};
export type Framing = typeof FRAMING;

/** CL-Q8: the 3D rig's back distance for a body `height` m tall (the anatomy table's height) */
export function cameraDistance(height: number, F: Framing = FRAMING): number {
  const d = F.law.k * height;
  return d < F.law.min ? F.law.min : d > F.law.max ? F.law.max : d;
}

/** CL-Q4, CL-Q5: the lens height over the feet at the neutral pitch for an eye `eye` m up: the eye itself (no cap, and
 *  the floor min(0.60, eye) never lifts it). Looking down, the rig orbits up from here (I2b) */
export function lensHeight(eye: number): number {
  return eye;
}

/** The view band as a clamp (CL-Q5): the floor as min(floor, eye), then the cap. The live law does not apply it
 *  (lensHeight); it is kept as a presentation rule with its own test */
export function clampToBand(eye: number, F: Framing = FRAMING): number {
  const lo = Math.min(F.band.floor, eye);
  return eye < lo ? lo : eye > F.band.cap ? F.band.cap : eye;
}

/** the tallest sim height the size rules can give a partner: a continuous Extra Large body at rules.size.xlVisualCap */
export function tallestBody(rules: Pick<Rules, 'size'> = defaultRules): number {
  const xl = rules.size.classes[rules.size.classes.length - 1];
  return rules.size.xlVisualCap * (xl.height / xl.visual);
}

export interface CameraClearance {
  /** the tallest eye the rules allow (the tallest body × the largest eye fraction), m */
  eye: number;
  /** `camera-clearance` spaces: the ceiling (the tallest eye + the deck clearance) */
  ceiling: number;
  /** `camera-clearance` spaces: the shorter side (D max + the Extra Large footprint radius + the lens clearance) */
  shortSide: number;
  /** taller dressing lies outside reachable space grown by this (D max + the lens clearance; Q17.5) */
  keepOut: number;
}

/** CL-Q8: what the generator sizes spaces from, for the Extra Large class (Q7), from the rules alone (no roster, no art).
 *  Default rules: eye 3.21 m, ceiling 3.66 m, short side 10.18 m, keep-out 9.30 m. Authored boss bodies
 *  (SpeciesDef.scale; Sudowoodo's eye 3.72 m) are outside it: no mode uses a boss role (ROADMAP F99) */
export function cameraClearance(rules: Pick<Rules, 'size' | 'anatomy'> = defaultRules, F: Framing = FRAMING): CameraClearance {
  const eye = tallestBody(rules) * maxEyeFraction(rules);
  const xl = rules.size.classes[rules.size.classes.length - 1];
  return { eye, ceiling: eye + F.deckClearance, shortSide: F.law.max + xl.body + F.lensClear, keepOut: F.law.max + F.lensClear };
}
