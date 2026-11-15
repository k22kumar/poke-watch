import type { SpeciesDef } from './species';

// Visible size of a Pokémon on screen, derived from its researched real-world extent.
//
// The problem this fixes: a sprite's size used to come from the source art alone
// (`scripts/import-pack.mjs`: visible idle texels / 16, clamped 0.9-3.2 m), so PMD sheets drawn at
// roughly one sprite height put a 0.3 m Rattata and a 2.0 m Venusaur within 6 % of each other.
// The algorithm here keeps canonical order (bigger species read bigger, an evolution grows) while
// compressing the canonical range so a Tiny species stays legible and an Extra Large one still fits
// the frame: a power curve on the extent, clamped at both ends.
//
// Scope: this is a *presentation* rule. It is read by src/render only. Collision radii, hitboxes,
// navigation profiles and roster membership keep reading `SpeciesDef.height`, so no sim state, no
// habitat layout and no replay hash moves with it.

/** Upper bounds of the Tiny, Small, Medium and Large classes, in metres of source extent. */
export const SIZE_CUTOFFS_M = [0.35, 0.65, 1.15, 2.05] as const;

export const SIZE_CLASS_NAMES = ['Tiny', 'Small', 'Medium', 'Large', 'Extra Large'] as const;
export type SizeClass = (typeof SIZE_CLASS_NAMES)[number];

/** The continuous curve: core = clamp(coefficient × S^exponent, min, max) metres. */
export const VISIBLE_CORE = { coefficient: 1.25, exponent: 0.45, min: 0.78, max: 2.55 } as const;

/**
 * Approved neutral core extents (m), by species id: a reviewed figure for a species whose listed
 * extent describes something other than its standing silhouette — length along the body for a
 * serpent, a hovering cloud's envelope, a bound flower. An entry here replaces the canonical listed
 * extent as the input `S`; it never replaces the curve. Keep it empty until a figure is approved:
 * an unreviewed guess here is worse than the canonical number, which at least has a source.
 */
export const NEUTRAL_CORE_EXTENT_M: Record<string, number> = {};

/** Where a species' input extent came from, so a capture or report can say. */
export type ExtentSource = 'approved-neutral' | 'canonical-listed' | 'sprite-fallback';

export interface SpeciesExtent {
  /** input `S` for the curve, in metres */
  m: number;
  source: ExtentSource;
}

/** Class index 0-4 from a source extent in metres. */
export function sizeClassIndex(extentM: number): number {
  let i = 0;
  while (i < SIZE_CUTOFFS_M.length && extentM >= SIZE_CUTOFFS_M[i]) i++;
  return i;
}

export function sizeClassOf(extentM: number): SizeClass {
  return SIZE_CLASS_NAMES[sizeClassIndex(extentM)];
}

/** Visible core extent in metres for a source extent `S`: the height the silhouette should occupy. */
export function visibleCoreMetres(extentM: number): number {
  const V = VISIBLE_CORE;
  const raw = V.coefficient * Math.pow(Math.max(0, extentM), V.exponent);
  return Math.min(V.max, Math.max(V.min, raw));
}

/**
 * The extent to feed the curve: an approved neutral core extent when one exists, else the active
 * species' ordinary canonical listed extent (`canon.heightM`, the species-default form's published
 * figure). `SpeciesDef.height` is the last resort — it is the old sprite-derived number, so it is
 * only reached by a species with no canonical record at all.
 */
export function speciesExtent(sp: SpeciesDef): SpeciesExtent {
  const approved = NEUTRAL_CORE_EXTENT_M[sp.id];
  if (approved !== undefined && approved > 0) return { m: approved, source: 'approved-neutral' };
  const canon = sp.canon?.heightM;
  if (canon !== undefined && canon > 0) return { m: canon, source: 'canonical-listed' };
  return { m: sp.height, source: 'sprite-fallback' };
}

export interface SpeciesSizing {
  id: string;
  extentM: number;
  extentSource: ExtentSource;
  sizeClass: SizeClass;
  sizeClassIndex: number;
  /** target visible core, metres */
  coreM: number;
  /** the asset's own neutral core (idle, facing the camera, frame 0), metres */
  neutralCoreM: number;
  /** multiplier the renderer submits with the billboard */
  scale: number;
  /** true when the species carries an authored scale (bosses): the curve stays out of its way */
  authored: boolean;
}

/**
 * Sprite scale for a species, against a stable neutral asset reference: `neutralCoreM` is the
 * visible height of the idle pose facing the camera, frame 0 (`CreatureArt.heightPx / 16`), and
 * never the frame being drawn. One multiplier per species, applied uniformly to the billboard, so
 * proportions and the per-frame feet anchor survive animation, an evolution swap and a faint.
 *
 * A species with an authored `scale` (boss presentation, `scripts/build-content.mjs`) returns 1:
 * the authored multiplier is applied by the renderer on top, and the two must not compound.
 */
export function speciesSizing(sp: SpeciesDef, neutralCoreM: number): SpeciesSizing {
  const { m, source } = speciesExtent(sp);
  const coreM = visibleCoreMetres(m);
  const neutral = neutralCoreM > 0 ? neutralCoreM : sp.height;
  const authored = sp.scale !== undefined;
  return {
    id: sp.id,
    extentM: m,
    extentSource: source,
    sizeClass: sizeClassOf(m),
    sizeClassIndex: sizeClassIndex(m),
    coreM,
    neutralCoreM: neutral,
    scale: authored ? 1 : coreM / neutral,
    authored,
  };
}
