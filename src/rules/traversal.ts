// Traversal capabilities (R6b, docs/LOCOMOTION.md "Capabilities"): what a Pokémon's body CAN do to get around, as
// reusable template rows. A species holds a list of templates (src/rules/profiles.ts resolves it: `traversalOf`); the
// rows' numbers live in rules.locomotion.templates. Elemental type and named abilities are never read here: a Flying
// type does not imply flight, and the Levitate ability (rules/abilities.ts) is a damage immunity, not a movement.
//
// Kinds keep apart the things the old roster flag `flying` used to mean at once:
//   glide     ballistic lift row: holding Jump in the air clamps the fall (rules.player.glideFallSpeed). Driven by the
//             player today (wild bodies never jump)
//   hover     a wild body held at a fixed height above the terrain, with a bob; no footprint, no wall test (enemy motion
//             in src/sim/enemies.ts until R7 moves it onto the shared integrators)
//   swim      safe in open water: no exposure, swimming pace (rules.hazards.water). Surface only
// Reserved (declared so their semantics stay distinct; no template may use them until their phase lands):
//   fly       sustained flight, volume × air (R6d)
//   levitate  constrained, timed levitation above the support, volume × air (R6e)
//   dive      underwater movement, volume × liquid (R8)
//
// Any row may give the airborne Jump press its meaning (`airPress`, R6c; §12.6 rule 1 of the audit plan): 'doubleJump'
// (once per airtime) or 'takeoff' (into volume × air, so only a fly or levitate row: R6d). A species' rows give it at
// most one meaning; no shipped row sets one, so the press means nothing in the air today and waits in the jump buffer.

export type TraversalKind = 'glide' | 'hover' | 'swim' | 'fly' | 'levitate' | 'dive';
/** kinds whose mechanics do not exist yet, with the roadmap phase that brings them (validateTraversal rejects them) */
export const RESERVED_KINDS: Readonly<Partial<Record<TraversalKind, string>>> = { fly: 'R6d', levitate: 'R6e', dive: 'R8' };

/** what an airborne Jump press means (sim/locomotion.ts jumpControl). 'none' when no row sets one */
export type AirPress = 'none' | 'doubleJump' | 'takeoff';
/** the kinds whose rows may set airPress 'takeoff' (volume × air; both reserved until R6d / R6e) */
export const TAKEOFF_KINDS: readonly TraversalKind[] = ['fly', 'levitate'];
/** fields every row may carry */
interface RowBase { airPress?: AirPress }

/** glide: the lift row. Its fall speed is rules.player.glideFallSpeed (R6e brings glide ratio and dive numbers here) */
export interface GlideRow extends RowBase { kind: 'glide' }
/** hover: rest height above the terrain `height + ((slot × 37) mod levels) × step` m (a deterministic spread per pool
 *  slot so a flock does not stack), bobbing ± `bob` m at `bobRate` rad/s */
export interface HoverRow extends RowBase { kind: 'hover'; height: number; step: number; levels: number; bob: number; bobRate: number }
/** swim: safe in open water (the exposure rule passes it; rules.hazards.water.safeSpeed) */
export interface SwimRow extends RowBase { kind: 'swim' }
export type TraversalTemplate = GlideRow | HoverRow | SwimRow;

/** the shipped template rows (rules.locomotion.templates). A species names them by id; rule sets may retune numbers */
export const TRAVERSAL_TEMPLATES: Record<string, TraversalTemplate> = {
  glider: { kind: 'glide' },
  'fixed-hover': { kind: 'hover', height: 0.9, step: 0.05, levels: 10, bob: 0.15, bobRate: 3 },
  'surface-swimmer': { kind: 'swim' },
};

/** A species' resolved traversal: one row per kind it holds (null = absent), and the policies other systems read.
 *  Capabilities say what the body can do; each policy is a separate gameplay rule with its own reader, defaulted from
 *  the capabilities but not the same fact. */
export interface Traversal {
  readonly id: string;
  /** template ids, in the order they were listed */
  readonly templates: readonly string[];
  readonly glide: GlideRow | null;
  readonly hover: HoverRow | null;
  readonly swim: SwimRow | null;
  /** any air capability (glide or hover today): camera framing for air bodies, the roster's "flies" label */
  readonly air: boolean;
  /** navigation: a wild body of this species routes on the ground (footprint, walkable placement and relocation, spawn
   *  room, Hold raid parties, the habitat ground profiles, spawn-pool `fly` filters). False while it hovers: R7 gives
   *  fliers real altitude and wall tests, when the two separate */
  readonly groundNav: boolean;
  /** hazards: habitat vents do not hurt this Pokémon standing on them (the trainer's partner; wild bodies are judged by
   *  their height above the vent). Default: any air capability */
  readonly ventImmune: boolean;
  /** controls (R6c): what an airborne Jump press means, from the one row that sets it ('none' otherwise) */
  readonly airPress: AirPress;
}
