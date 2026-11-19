import { defaultRules, type Rules } from './defaults';
import { pinnedSizeClass } from './profiles';
import type { SpeciesDef } from './species';
import { SIZE_CLASS_NAMES, sizeClassIndex, speciesExtent, type ExtentSource, type SizeClass, type SizeClassId, type SizeRules } from './extent';

export { SIZE_CLASS_IDS, SIZE_CLASS_NAMES, NEUTRAL_CORE_EXTENT_M, sizeClassIndex, listedAxis, speciesExtent } from './extent';
export type { SizeClassId, SizeClass, NeutralExtent, ExtentSource, SpeciesExtent, SizeRules } from './extent';

// Size classes: one table (rules.size, src/rules/defaults.ts) decides how big every Pokémon is drawn and how big its
// body is in the sim. docs/SIZING.md has the rationale and the numbers.
//
//   class      from the canonical extent, cut at rules.size.classes[].below — or pinned per species in profiles.ts
//   visual     the visible core the renderer scales the idle sprite to (src/render/renderer.ts)
//   radius     hurt radius in the sim: what hits it, contact and crowd reach (enemies × role size; partners clamped
//              by rules.size.playerRadius)
//   height     vertical hit window in the sim
//   body       movement footprint: the circle walls, faces and deck slabs stop (World.moveBody) and the navigation
//              class it routes on. Per class with no tilt (passability is a property of the class); role sizes scale
//              it up to rules.size.bodyCap. 0 with rules.size.geometry off (the old point collision).
//
// All three body values come from the same class row times one bounded tilt factor, so a Pokémon that is drawn
// bigger is also hit, pushed and routed as bigger. Earlier this file ran a continuous curve (1.25·S^0.45 clamped
// 0.78–2.55 m) that made the classes invisible: a 0.64 m Small and a 0.65 m Medium drew the same, and neighbouring
// classes were ~25 % apart. Fixed class targets ×1.4 apart, with a ±8 % tilt, keep classes distinct and never
// overlapping while an evolution inside one class still grows a little.
//
// Two flags, both off by default (docs/SIZING.md "Measurement axis", "Giants"): rules.size.axis reads a listed body
// length (serpent and fish shapes, src/rules/shapes.ts) as lengthRise × itself; rules.size.xlContinuous lets the
// Extra Large drawn core grow with the extent (xlVisual) while its sim body keeps the class row.
//
// Bosses keep their authored encounter scale (`SpeciesDef.scale`, drawn 2–3× by the renderer) and their sim body
// stays the drawn one (radius from that drawn height), so the class rules never compound with it.

/** Upper bounds of the Tiny, Small, Medium and Large classes, in metres of source extent (rules.size.classes). */
export const SIZE_CUTOFFS_M = defaultRules.size.classes.slice(0, -1).map((c) => c.below);

/** the size rules of a run (its ctx.rules.size), the defaults with no run: what the developer roster labels classes with
 *  (src/main.ts UIHooks.sizeRules) */
export const runSizeRules = (run: { rules: Pick<Rules, 'size'> } | null | undefined): SizeRules => run?.rules.size ?? defaultRules.size;

export function sizeClassOf(extentM: number, size: SizeRules = defaultRules.size): SizeClass {
  return SIZE_CLASS_NAMES[sizeClassIndex(extentM, size)];
}

/** 1 ± tilt from where `extentM` sits inside class `i` (log scale; the open ends use rules.size.extentRange). */
export function classTilt(extentM: number, i: number, size: SizeRules = defaultRules.size): number {
  const C = size.classes;
  const lo = i === 0 ? size.extentRange[0] : C[i - 1].below;
  const hi = i === C.length - 1 ? size.extentRange[1] : C[i].below;
  const t = Math.min(1, Math.max(0, Math.log(Math.max(extentM, 1e-6) / lo) / Math.log(hi / lo)));
  return 1 + size.tilt * (2 * t - 1);
}

export interface SpeciesBody {
  id: string;
  sizeClass: SizeClassId;
  sizeClassIndex: number;
  className: SizeClass;
  extentM: number;
  extentSource: ExtentSource;
  /** the tilt factor applied to every class value below */
  factor: number;
  /** visible core the sprite is drawn at, metres (authored bosses: their drawn height) */
  visualM: number;
  /** sim collision / hurt radius before any role multiplier */
  radius: number;
  /** sim body height before any role multiplier */
  height: number;
  /** movement footprint radius before any role multiplier (the class's `body`, no tilt) */
  body: number;
  /** true when the species carries an authored encounter scale (bosses) */
  authored: boolean;
}

/** The pre-size-class sim radius (sprite height × 0.4, clamped): bosses keep it, and `geometry: false` restores it. */
export const legacyRadius = (sp: SpeciesDef) => Math.min(3.2, Math.max(0.35, sp.height * 0.4));

const bodies = new WeakMap<SizeRules, Map<string, SpeciesBody>>();

/** The body of a species under these size rules: class, visual target and sim dimensions. Pure and cached. */
export function bodyOf(sp: SpeciesDef, size: SizeRules = defaultRules.size): SpeciesBody {
  let m = bodies.get(size);
  if (!m) bodies.set(size, (m = new Map()));
  const hit = m.get(sp.id);
  if (hit) return hit;
  const ext = speciesExtent(sp, size);
  const pinned = pinnedSizeClass(sp.id);
  const byExtent = sizeClassIndex(ext.m, size);
  const at = pinned !== undefined ? size.classes.findIndex((c) => c.id === pinned) : -1;
  const i = at >= 0 ? at : byExtent;
  // a pinned class whose band does not hold the extent sits at the class centre
  const factor = at >= 0 && i !== byExtent ? 1 : classTilt(ext.m, i, size);
  const C = size.classes[i];
  const authored = sp.scale !== undefined;
  const body: SpeciesBody = {
    id: sp.id,
    sizeClass: C.id as SizeClassId,
    sizeClassIndex: i,
    className: SIZE_CLASS_NAMES[i],
    extentM: ext.m,
    extentSource: at >= 0 ? 'override' : ext.source,
    factor,
    visualM: authored ? sp.height : C.id === 'xl' && size.xlContinuous ? xlVisual(ext.m, size) : C.visual * factor,
    radius: authored ? legacyRadius(sp) : C.radius * factor,
    // xlTall (with xlContinuous): an XL body is as tall as it is drawn, at the class's height-to-visual ratio. Otherwise
    // the class height × tilt, unchanged (xlTall alone moves nothing)
    height: authored ? sp.height : C.id === 'xl' && size.xlContinuous && size.xlTall ? xlVisual(ext.m, size) * (C.height / C.visual) : C.height * factor,
    // an authored boss keeps its encounter-scale hurtbox; its footprint is capped like every role-scaled body
    body: authored ? Math.min(size.bodyCap, legacyRadius(sp)) : C.body,
    authored,
  };
  m.set(sp.id, body);
  return body;
}

/**
 * The drawn core of an Extra Large species with rules.size.xlContinuous on: min(xlVisualCap, xlFloor × (S / L) ^
 * xlExponent), L the Large class's upper cut. It starts at today's lowest XL draw at the cut (an extent pinned into XL
 * from below draws the floor) and rises with the extent, so a 14.5 m Wailord stays visibly bigger than a 2.1 m Snorlax.
 */
export function xlVisual(extentM: number, size: SizeRules = defaultRules.size): number {
  const cut = size.classes[size.classes.length - 2].below;
  return Math.min(size.xlVisualCap, size.xlFloor * Math.max(1, extentM / cut) ** size.xlExponent);
}

/** A partner's collision and hurt radius: its class radius inside rules.size.playerRadius (or the shared legacy one). */
export function partnerRadius(sp: SpeciesDef, rules: Rules = defaultRules): number {
  if (!rules.size.geometry) return rules.player.radius;
  const [lo, hi] = rules.size.playerRadius;
  return Math.min(hi, Math.max(lo, bodyOf(sp, rules.size).radius));
}

/** A partner's vertical hurt extent: its class height (1.2 m, the old fixed window, when size geometry is off). */
export function partnerHeight(sp: SpeciesDef, rules: Rules = defaultRules): number {
  return rules.size.geometry ? bodyOf(sp, rules.size).height : 1.2;
}

/** An enemy's collision radius at a role size multiplier (elite ×2, alpha ×3). */
export function enemyRadius(sp: SpeciesDef, roleSize: number, rules: Rules = defaultRules): number {
  return (rules.size.geometry ? bodyOf(sp, rules.size).radius : legacyRadius(sp)) * roleSize;
}

/** A partner's movement footprint: its class `body`, uncapped (an Extra Large partner is physically bigger than a Large
 *  one), or 0 (point collision) when size geometry is off. */
export function partnerFootprint(sp: SpeciesDef, rules: Rules = defaultRules): number {
  return rules.size.geometry ? bodyOf(sp, rules.size).body : 0;
}

/** An enemy's movement footprint at a role size: class `body` × role size up to rules.size.bodyCap (0 when size
 *  geometry is off). Bosses use role size 1 on their authored body. */
export function footprintOf(sp: SpeciesDef, roleSize: number, rules: Rules = defaultRules): number {
  return rules.size.geometry ? Math.min(rules.size.bodyCap, bodyOf(sp, rules.size).body * roleSize) : 0;
}

/** Does a footprint route on the wide (2 × 2 block) navigation field? (rules.size.heavyRadius; docs/SIZING.md) */
export const navWide = (foot: number, rules: Rules = defaultRules) => foot >= rules.size.heavyRadius;

/** An enemy's vertical hit extent at a role size (the legacy rules used the role size itself as the height). */
export function enemyHeight(sp: SpeciesDef, roleSize: number, rules: Rules = defaultRules): number {
  return rules.size.geometry ? bodyOf(sp, rules.size).height * roleSize : roleSize;
}

export interface SpeciesSizing extends SpeciesBody {
  /** target visible core, metres (= visualM) */
  coreM: number;
  /** the asset's own neutral core (idle, facing the camera, frame 0), metres, after the Wide normalisation */
  neutralCoreM: number;
  /** true when the idle frame is wide enough that its width set the neutral core */
  wide: boolean;
  /** multiplier the renderer submits with the billboard */
  scale: number;
}

/**
 * Sprite scale for a species against a stable neutral asset reference: `neutralHeightM` is the visible height of the
 * idle pose facing the camera, frame 0 (`CreatureArt.heightPx / 16`), never the frame being drawn. A frame at least
 * `rules.size.wideRatio` times wider than tall (a serpent, a long quadruped) is normalised on width / wideRatio, so a
 * long body is not drawn oversized. One multiplier per species, applied uniformly, so proportions and the per-frame
 * feet anchor survive animation, an evolution swap and a faint.
 *
 * A species with an authored `scale` (boss presentation) returns 1: the renderer applies that on top.
 */
export function speciesSizing(sp: SpeciesDef, neutralHeightM: number, neutralWidthM = 0, size: SizeRules = defaultRules.size): SpeciesSizing {
  const body = bodyOf(sp, size);
  const h = neutralHeightM > 0 ? neutralHeightM : sp.height;
  const wide = neutralWidthM >= size.wideRatio * h;
  const neutral = wide ? neutralWidthM / size.wideRatio : h;
  return { ...body, coreM: body.visualM, neutralCoreM: neutral, wide, scale: body.authored ? 1 : body.visualM / neutral };
}
