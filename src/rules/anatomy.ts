// The anatomy table (docs/WORLDGEN3D.md Q15c, CL-Q2, CL-Q6): a creature's gameplay body and sight origin as data, not
// from its picture. Creatures are flat sprites today; a future 3D model reads the same record, and the model must fit
// it (a lint), never the reverse. The sim never reads the art: scripts/anatomy-lint.ts compares this table with each
// sprite's measured outline and writes docs/anatomy-lint.md (report-only, ROADMAP F86).
//
//   height, length, width   metres, in-game scale from the size curve (bodyOf: class row × tilt, continuous giants)
//   eye                     the gameplay sight origin, in the body frame: `up` above the feet, `fwd` ahead of the axis
//   attacks                 named attack origins in the same frame (`mouth` now; tail, horns, hands later). Nothing in
//                           the sim reads them (ROADMAP F88): flagged spatial shots launch from the eye (CL-Q10)
//   postures                only `stand` exists; the names are reserved for later (ROADMAP F89)
//
// Defaults: fractions of the species' own body by official shape (rules.anatomy), the size class entering only through
// the body it scales. Overrides: reviewed per-species data below, any dimension or point, per posture. CL adds none:
// the lint finds every default eye inside its sprite (CL-Q6).
import { defaultRules, type Rules } from './defaults';
import { bodyOf } from './sizing';
import type { SpeciesDef } from './species';

export interface BodyPoint { up: number; fwd: number }
export type PostureId = 'stand';
export interface Anatomy {
  height: number; length: number; width: number;
  eye: BodyPoint;
  attacks: Readonly<Record<string, BodyPoint>>;
}
export interface AnatomyOverride {
  height?: number; length?: number; width?: number;
  eye?: Partial<BodyPoint>;
  attacks?: Record<string, Partial<BodyPoint>>;
}

/** Reviewed per-species overrides, by species id and posture. Each row names its measurement and reason in
 *  docs/anatomy-lint.md. Empty: no default eye lies outside its sprite (CL-Q6) */
export const ANATOMY_OVERRIDES: Readonly<Record<string, Partial<Record<PostureId, AnatomyOverride>>>> = {};

const cache = new WeakMap<Rules['anatomy'], WeakMap<Rules['size'], Map<string, Anatomy>>>();

/** the anatomy of a species in a posture under these rules (pure, cached per rules.anatomy × rules.size) */
export function anatomyOf(sp: SpeciesDef, rules: Pick<Rules, 'anatomy' | 'size'> = defaultRules, posture: PostureId = 'stand'): Anatomy {
  let bySize = cache.get(rules.anatomy);
  if (!bySize) cache.set(rules.anatomy, (bySize = new WeakMap()));
  let m = bySize.get(rules.size);
  if (!m) bySize.set(rules.size, (m = new Map()));
  const key = sp.id + '|' + posture, hit = m.get(key);
  if (hit) return hit;
  const b = bodyOf(sp, rules.size), A = rules.anatomy, foot = b.body;
  const f = A.eye[sp.canon?.shape ?? ''] ?? A.eyeUnknown;
  const o = ANATOMY_OVERRIDES[sp.id]?.[posture];
  const height = o?.height ?? b.height;
  const out: Anatomy = {
    height, length: o?.length ?? 2 * foot, width: o?.width ?? 2 * foot,
    eye: { up: o?.eye?.up ?? height * f.up, fwd: o?.eye?.fwd ?? foot * f.fwd },
    attacks: { mouth: { up: o?.attacks?.mouth?.up ?? height * A.mouth.up, fwd: o?.attacks?.mouth?.fwd ?? foot * A.mouth.fwd } },
  };
  for (const [k, v] of Object.entries(o?.attacks ?? {})) if (k !== 'mouth') out.attacks = { ...out.attacks, [k]: { up: v.up ?? 0, fwd: v.fwd ?? 0 } };
  m.set(key, out);
  return out;
}

/** the largest eye fraction any shape (or the unknown default) gives: the bound the camera law sizes spaces with */
export function maxEyeFraction(rules: Pick<Rules, 'anatomy'> = defaultRules): number {
  let m = rules.anatomy.eyeUnknown.up;
  for (const v of Object.values(rules.anatomy.eye)) if (v.up > m) m = v.up;
  return m;
}
