import { defaultRules, type Rules } from './defaults';
import { axisOf, type MeasureAxis } from './shapes';
import type { SpeciesDef } from './species';

// The extent behind a species' size class, and the class it falls in: the leaf of src/rules/sizing.ts, kept apart so a
// module that loads the roster (src/rules/species.ts, the default role rule in src/rules/roles.ts) can read a class
// without importing sizing.ts, whose profile pins import the roster back. sizing.ts re-exports all of it; read it there.
// A class from here ignores a pinned class (SPECIES_OVERRIDES.sizeClass): bodyOf in sizing.ts applies the pin.

export type SizeClassId = 'tiny' | 'small' | 'medium' | 'large' | 'xl';
export const SIZE_CLASS_IDS: readonly SizeClassId[] = ['tiny', 'small', 'medium', 'large', 'xl'];
export const SIZE_CLASS_NAMES = ['Tiny', 'Small', 'Medium', 'Large', 'Extra Large'] as const;
export type SizeClass = (typeof SIZE_CLASS_NAMES)[number];

/** A reviewed neutral extent with the axis its source figure measured (`span` can only come from here). */
export interface NeutralExtent {
  m: number;
  axis: MeasureAxis;
  /** how the figure was reached, for review */
  basis?: string;
}

/**
 * Approved neutral core extents (m), by species id: a reviewed figure for a species whose listed extent describes
 * something other than its standing silhouette — length along the body for a serpent, a hovering cloud's envelope.
 * An entry here replaces the canonical listed extent as the input `S`. A bare number
 * keeps the species' own axis; a NeutralExtent names the axis its figure measured (the only way to select `span`).
 * To force a class regardless of extent, use `sizeClass` in SPECIES_OVERRIDES (src/rules/profiles.ts) instead.
 * Only owner-reviewed figures go here, each with its basis.
 */
export const NEUTRAL_CORE_EXTENT_M: Record<string, number | NeutralExtent> = {
  // reviewed by the owner 2026-11-19 (docs/archive/size-extremes-plan.md §S2.12): the game draws one trooper (SpriteCollab's
  // Trooper sheet), so its class follows one trooper, not the formation
  falinks: { m: 0.5, axis: 'height', basis: 'one trooper; the listed 3.0 m measures the six-trooper formation' },
};

/** Where a species' class came from, so a capture or report can say. `length-rise` is a listed body length times
 *  rules.size.lengthRise. */
export type ExtentSource = 'override' | 'approved-neutral' | 'canonical-listed' | 'length-rise' | 'sprite-fallback';

export interface SpeciesExtent {
  /** input `S` in metres */
  m: number;
  source: Exclude<ExtentSource, 'override'>;
  /** what the source figure measured (src/rules/shapes.ts) */
  axis: MeasureAxis;
}

export type SizeRules = Rules['size'];

/** Class index 0-4 from a source extent in metres. */
export function sizeClassIndex(extentM: number, size: SizeRules = defaultRules.size): number {
  let i = 0;
  while (i < size.classes.length - 1 && extentM >= size.classes[i].below) i++;
  return i;
}

/** The axis a species' listed extent measures: `canon.axis`, else its approved override or shape, else `height`. */
export const listedAxis = (sp: SpeciesDef): MeasureAxis => sp.canon?.axis ?? axisOf(sp.id, sp.canon?.shape);

/**
 * The extent behind a species' class: an approved neutral figure, else the canonical listed one, else the
 * sprite-derived height. A listed body length (`length` axis) counts `lengthRise` × itself.
 */
export function speciesExtent(sp: SpeciesDef, size: SizeRules = defaultRules.size): SpeciesExtent {
  const axis = listedAxis(sp);
  const approved = NEUTRAL_CORE_EXTENT_M[sp.id];
  const a = typeof approved === 'number' ? { m: approved, axis } : approved;
  if (a !== undefined && a.m > 0) return { m: a.m, source: 'approved-neutral', axis: a.axis };
  const canon = sp.canon?.heightM;
  if (canon !== undefined && canon > 0) {
    if (axis === 'length') return { m: canon * size.lengthRise, source: 'length-rise', axis };
    return { m: canon, source: 'canonical-listed', axis };
  }
  return { m: sp.height, source: 'sprite-fallback', axis: 'height' };
}
