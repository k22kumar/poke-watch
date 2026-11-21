// Measurement axis: what a species' listed extent (PokéAPI `height`, decimetres) measures. The listed figure is the
// standing height for most bodies, but the length along the body for serpents and fish, so a 8.8 m Onix is not
// 8.8 m tall. docs/SIZING.md "Measurement axis" has the rationale.
//
// The axis comes from the official body shape (`pokemon_species.shape_id` -> `pokemon_shapes.identifier`), which the
// content build carries into `canon.shape`. SHAPE_AXIS decides the axis, so a new shape or a new generation needs a
// data row here, not code. A shape not listed reads as `height`.
//
// A species whose listed figure measures another axis than its shape says gets a reviewed row in SPECIES_AXIS: the axis
// only, no metres, so its extent still comes from the shared rule (rules.size.lengthRise for a length).
//
// `span` (wingspan or envelope) has no source figure in PokéAPI: no shape maps to it, and SPECIES_AXIS cannot name it.
// Only an approved entry in NEUTRAL_CORE_EXTENT_M (src/rules/sizing.ts), which carries its own metres, can select it.

export type MeasureAxis = 'height' | 'length' | 'span';

/** Official shape identifier -> what its listed extent measures. Every shape not listed is `height`. */
export const SHAPE_AXIS: Readonly<Record<string, MeasureAxis>> = {
  squiggle: 'length', // serpentine bodies (Ekans, Onix, Gyarados, Rayquaza)
  fish: 'length', // fins and flippers (Magikarp, Lapras, Wailord)
};

/** The axis a shape's listed extent measures (`height` for an unknown or missing shape). */
export const axisOfShape = (shape: string | null | undefined): MeasureAxis => (shape ? SHAPE_AXIS[shape] : undefined) ?? 'height';

/** Approved per-species axis overrides, by species id: the listed figure measures this axis whatever the shape says.
 *  Owner-approved 2026-11-18 (docs/size-extremes-plan.md §S1.9). */
export const SPECIES_AXIS: Readonly<Record<string, Exclude<MeasureAxis, 'span'>>> = {
  eternatus: 'length', // shape `wings`, but its 20 m is the length of the body
};

/** The axis a species' listed extent measures: its approved override, else its shape's. */
export const axisOf = (id: string, shape: string | null | undefined): MeasureAxis => SPECIES_AXIS[id] ?? axisOfShape(shape);
