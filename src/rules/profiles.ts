// Species profiles: the one place for per-species gameplay facts that are not combat stats.
//
// A profile keeps three kinds of fact apart, because spawning, traversal and (later) AI read them differently:
//
//   capability   what the Pokémon CAN do        traversal templates (`traversalOf`, src/rules/traversal.ts): glide,
//                                               hover, swim; defaults from the roster's legacy `flying` flag and the
//                                               swimming types (rules.hazards.water.safeTypes), replaced per species by
//                                               `traversal`. Knowing a safe move (Surf) also swims (`canSwim`)
//   preference   what it TENDS to favour        `prefers`: habitat tags whose tiles raise its encounter odds
//                                               (rules.spawning.preference) — never required
//   restriction  what MUST or MUST NOT hold     `requires` / `avoids`: habitat tags a spawn tile must have / must not
//                                               have. Checked only by spawn compatibility (src/rules/spawning.ts).
//
// Defaults are derived; an entry in SPECIES_OVERRIDES replaces individual fields. Nothing here is implied by a
// Pokémon's type: a Water type is not given `requires: water`, and an unlisted species has no preference at all.
// docs/SPAWNING.md and docs/CUSTOMISING.md show worked examples.
import { defaultRules, type Rules } from './defaults';
import { HAB } from './habitats';
import { SPECIES, SPECIES_BY_ID, type SpeciesDef } from './species';
import type { SizeClassId } from './sizing';
import { RESERVED_KINDS, TAKEOFF_KINDS, type AirPress, type Traversal, type TraversalTemplate } from './traversal';

export interface SpeciesOverride {
  /** habitat tags (HAB bits) that raise encounter odds */
  prefers?: number;
  /** a spawn tile must carry at least one of these habitat tags (0 = no requirement) */
  requires?: number;
  /** a spawn tile must carry none of these habitat tags */
  avoids?: number;
  /** can heal allies in a composition even without the `healer` behaviour */
  mender?: boolean;
  /** pin the size class instead of deriving it from the canonical extent (docs/SIZING.md) */
  sizeClass?: SizeClassId;
  /** traversal template ids (rules.locomotion.templates), replacing the derived list entirely ([] = none). At most one
   *  template per kind (docs/LOCOMOTION.md "Capabilities") */
  traversal?: string[];
  /** habitat vents do not hurt it on the ground (default: it holds an air capability) */
  ventImmune?: boolean;
}

export interface SpeciesProfile {
  id: string;
  prefers: number;
  requires: number;
  avoids: number;
  mender: boolean;
  sizeClass?: SizeClassId;
}

/** Authored per-species facts. Every field is optional; leave a species out to take the defaults. */
export const SPECIES_OVERRIDES: Record<string, SpeciesOverride> = {
  rattata: { prefers: HAB.meadow | HAB.grass },
  ledyba: { prefers: HAB.forest | HAB.meadow },
  sandshrew: { prefers: HAB.dry | HAB.rock },
  oddish: { prefers: HAB.grass | HAB.forest, mender: true },
  poliwag: { prefers: HAB.water },
  mareep: { prefers: HAB.meadow },
  heracross: { prefers: HAB.forest },
  geodude: { prefers: HAB.rock },
  houndour: { prefers: HAB.dry | HAB.rock },
  zubat: { prefers: HAB.forest | HAB.rock },
  paras: { prefers: HAB.forest | HAB.water, mender: true },
  vulpix: { prefers: HAB.dry },
  slugma: { prefers: HAB.rock | HAB.dry },
  swinub: { prefers: HAB.water | HAB.rock },
  // Present heals in the main games
  delibird: { prefers: HAB.meadow | HAB.rock, mender: true },
  gastly: { prefers: HAB.forest | HAB.rock },
  // Joltik clings to plants and to cave walls (Pinwheel Forest, Chargestone Cave); Onix tunnels
  // through rock and dry ground (Rock Tunnel, Mt. Moon, the desert routes).
  joltik: { prefers: HAB.grass | HAB.forest },
  onix: { prefers: HAB.rock | HAB.dry },
  // the 2026-11 roster wave (docs/SPECIES.md): preferences only, from each species' usual haunts in the main games
  pichu: { prefers: HAB.meadow | HAB.grass }, pikachu: { prefers: HAB.meadow | HAB.forest }, togepi: { prefers: HAB.meadow },
  sentret: { prefers: HAB.meadow | HAB.grass }, furret: { prefers: HAB.meadow | HAB.grass }, budew: { prefers: HAB.grass | HAB.forest },
  cutiefly: { prefers: HAB.meadow | HAB.grass }, turtwig: { prefers: HAB.forest | HAB.grass }, doduo: { prefers: HAB.meadow | HAB.dry },
  snorlax: { prefers: HAB.forest | HAB.meadow },
  diglett: { prefers: HAB.dry | HAB.rock }, ekans: { prefers: HAB.grass | HAB.dry }, koffing: { prefers: HAB.dry | HAB.rock },
  rolycoly: { prefers: HAB.rock }, sizzlipede: { prefers: HAB.dry }, silicobra: { prefers: HAB.dry }, makuhita: { prefers: HAB.rock },
  hariyama: { prefers: HAB.rock },
  snorunt: { prefers: HAB.rock }, snom: { prefers: HAB.forest | HAB.rock }, sneasel: { prefers: HAB.forest | HAB.rock },
  bergmite: { prefers: HAB.water | HAB.rock }, cetoddle: { prefers: HAB.rock | HAB.meadow }, lapras: { prefers: HAB.water },
  murkrow: { prefers: HAB.forest }, litwick: { prefers: HAB.rock | HAB.forest }, haunter: { prefers: HAB.forest | HAB.rock },
  gengar: { prefers: HAB.forest | HAB.rock }, impidimp: { prefers: HAB.forest }, noibat: { prefers: HAB.rock },
  honedge: { prefers: HAB.rock | HAB.forest }, dreepy: { prefers: HAB.forest },
};

const cache = new Map<string, SpeciesProfile>();

/** The resolved profile: derived defaults, then the authored override field by field. */
export function speciesProfile(sp: SpeciesDef | string): SpeciesProfile {
  const id = typeof sp === 'string' ? sp : sp.id;
  const hit = cache.get(id);
  if (hit) return hit;
  const def = typeof sp === 'string' ? SPECIES_BY_ID[sp] : sp;
  const o = SPECIES_OVERRIDES[id] ?? {};
  const p: SpeciesProfile = {
    id,
    prefers: o.prefers ?? 0,
    requires: o.requires ?? 0,
    avoids: o.avoids ?? 0,
    mender: o.mender ?? false,
    sizeClass: o.sizeClass,
  };
  cache.set(id, p);
  return p;
}

/** Templates a species holds when it has no `traversal` override: the roster's legacy `flying` flag meant both the
 *  player's glide and the wild float, so it maps to both rows; a swimming type (rules.hazards.water.safeTypes, the
 *  Water type) swims. Nothing else is derived from type. */
export const LEGACY_FLYING: readonly string[] = ['glider', 'fixed-hover'];
export const LEGACY_SWIM: readonly string[] = ['surface-swimmer'];

/** what traversalOf reads from a species: its id (for the override), its types (for the swimming default) and the
 *  roster's legacy flag. Test fixtures may pass a bare `{ elements }` */
export type TraversalSource = { readonly id?: string; readonly elements: readonly string[]; readonly flying?: boolean };

const traversals = new WeakMap<Rules, WeakMap<TraversalSource, Traversal>>();

/** the template ids a species holds, before resolution */
export function traversalIds(sp: TraversalSource, rules: Rules = defaultRules): readonly string[] {
  const o = sp.id !== undefined ? SPECIES_OVERRIDES[sp.id]?.traversal : undefined;
  if (o) return o;
  const ids: string[] = [];
  if (sp.flying) ids.push(...LEGACY_FLYING);
  if (sp.elements.some((e) => rules.hazards.water.safeTypes.includes(e))) ids.push(...LEGACY_SWIM);
  return ids;
}

/** Capability: a species' traversal, resolved against these rules' template rows. The one accessor for movement
 *  eligibility (sim, world, render and UI alike); cached per rules object and species object. Throws on an unknown
 *  template id, a reserved kind or two templates of one kind (validateTraversal reports the same up front). */
export function traversalOf(sp: TraversalSource, rules: Rules = defaultRules): Traversal {
  let byRules = traversals.get(rules);
  if (!byRules) traversals.set(rules, (byRules = new WeakMap()));
  const hit = byRules.get(sp);
  if (hit) return hit;
  const ids = traversalIds(sp, rules);
  const rows: Partial<Record<TraversalTemplate['kind'], TraversalTemplate>> = {};
  let airPress: AirPress = 'none';
  for (const tid of ids) {
    const row = (rules.locomotion.templates as Record<string, TraversalTemplate | undefined>)[tid];
    const who = sp.id ?? sp.elements.join('/');
    if (!row) throw new Error(`${who}: unknown traversal template '${tid}'`);
    if (RESERVED_KINDS[row.kind]) throw new Error(`${who}: template '${tid}' is a '${row.kind}' row, which arrives in ${RESERVED_KINDS[row.kind]}`);
    if (rows[row.kind]) throw new Error(`${who}: two '${row.kind}' templates`);
    rows[row.kind] = row;
    const ap = row.airPress ?? 'none';
    if (ap === 'takeoff' && !TAKEOFF_KINDS.includes(row.kind)) throw new Error(`${who}: template '${tid}' takes off from a '${row.kind}' row (take-off needs a fly or levitate row)`);
    if (ap !== 'none') {
      if (airPress !== 'none' && airPress !== ap) throw new Error(`${who}: the airborne Jump press has two meanings ('${airPress}', '${ap}')`);
      airPress = ap;
    }
  }
  const glide = (rows.glide as Traversal['glide']) ?? null, hover = (rows.hover as Traversal['hover']) ?? null;
  const air = glide !== null || hover !== null;
  const t: Traversal = {
    id: sp.id ?? '', templates: ids, glide, hover, swim: (rows.swim as Traversal['swim']) ?? null,
    air, groundNav: hover === null,
    ventImmune: (sp.id !== undefined ? SPECIES_OVERRIDES[sp.id]?.ventImmune : undefined) ?? air,
    airPress,
  };
  byRules.set(sp, t);
  return t;
}

/** Capability: can a Pokémon of this species and these moves swim safely? A swim template (traversalOf), or a
 *  rules.hazards.water.safeMoves move in its move set (knowing Surf lends it, cooling down or not). */
export function canSwim(species: TraversalSource, moves?: readonly { key: string }[], rules: Rules = defaultRules): boolean {
  return traversalOf(species, rules).swim !== null || (!!moves && moves.some((s) => rules.hazards.water.safeMoves.includes(s.key)));
}

/** Preference: encounter-odds factor of a species on a tile with these habitat tags. Never 0: preference is not
 *  eligibility. A species with no preference, or a tile with no tags, is neutral (1). */
export function habitatSpawnFactor(species: string, habitat: number, pref: Rules['spawning']['preference'] = defaultRules.spawning.preference): number {
  const native = speciesProfile(species).prefers;
  if (!native || !habitat) return 1;
  return native & habitat ? pref.native : pref.foreign;
}

/** Restriction: may this species spawn on a tile with these habitat tags? (Preference plays no part.) */
export function habitatAllows(species: string, habitat: number): boolean {
  const p = speciesProfile(species);
  if (p.avoids && habitat & p.avoids) return false;
  if (p.requires && !(habitat & p.requires)) return false;
  return true;
}

const ALL_HAB = Object.values(HAB).reduce((a, b) => a | b, 0);
const SIZE_IDS = new Set(['tiny', 'small', 'medium', 'large', 'xl']);

/** Problems with SPECIES_OVERRIDES, as readable messages (tests/profiles.test.ts asserts none). */
export function validateProfiles(): string[] {
  const out: string[] = [];
  const known = new Set(SPECIES.map((s) => s.id));
  for (const [id, o] of Object.entries(SPECIES_OVERRIDES)) {
    if (!known.has(id)) out.push(`${id}: not a game species (content/roster.json)`);
    for (const k of ['prefers', 'requires', 'avoids'] as const) {
      const v = o[k];
      if (v !== undefined && (!Number.isInteger(v) || v < 0 || (v & ~ALL_HAB) !== 0)) out.push(`${id}.${k}: ${v} is not a combination of HAB tags`);
    }
    if (o.requires && o.avoids && (o.requires & ~o.avoids) === 0) out.push(`${id}: every required habitat is also avoided, so it can never spawn`);
    if (o.sizeClass !== undefined && !SIZE_IDS.has(o.sizeClass)) out.push(`${id}.sizeClass: unknown class '${o.sizeClass}'`);
  }
  return out;
}

const KINDS = new Set(['glide', 'hover', 'swim', 'fly', 'levitate', 'dive']);
const AIR_PRESSES = new Set(['none', 'doubleJump', 'takeoff']);
const finite = (v: unknown, min: number) => typeof v === 'number' && Number.isFinite(v) && v >= min;

/** Problems with the traversal templates of these rules and with every species' template list, as readable messages
 *  (tests/traversal.test.ts asserts none for the shipped rules). */
export function validateTraversal(rules: Rules = defaultRules): string[] {
  const out: string[] = [];
  const T = rules.locomotion.templates as Record<string, TraversalTemplate>;
  for (const [tid, row] of Object.entries(T)) {
    if (!KINDS.has(row.kind)) { out.push(`template ${tid}: unknown kind '${row.kind}'`); continue; }
    if (RESERVED_KINDS[row.kind]) out.push(`template ${tid}: kind '${row.kind}' arrives in ${RESERVED_KINDS[row.kind]}`);
    if (row.airPress !== undefined && !AIR_PRESSES.has(row.airPress)) out.push(`template ${tid}.airPress: unknown '${row.airPress}'`);
    else if (row.airPress === 'takeoff' && !TAKEOFF_KINDS.includes(row.kind)) out.push(`template ${tid}.airPress: take-off needs a fly or levitate row, not '${row.kind}'`);
    if (row.kind === 'hover') {
      if (!finite(row.height, 0) || row.height <= 0) out.push(`template ${tid}.height: ${row.height} (a hover row rests above the terrain, > 0)`);
      if (!finite(row.step, 0)) out.push(`template ${tid}.step: ${row.step}`);
      if (!Number.isInteger(row.levels) || row.levels < 1) out.push(`template ${tid}.levels: ${row.levels} (a whole number ≥ 1)`);
      if (!finite(row.bob, 0) || row.bob >= row.height) out.push(`template ${tid}.bob: ${row.bob} (≥ 0 and below the rest height)`);
      if (!finite(row.bobRate, 0)) out.push(`template ${tid}.bobRate: ${row.bobRate}`);
    }
  }
  for (const [id, o] of Object.entries(SPECIES_OVERRIDES)) {
    if (o.traversal === undefined) continue;
    if (!Array.isArray(o.traversal)) { out.push(`${id}.traversal: a list of template ids`); continue; }
    const kinds = new Set<string>(), presses = new Set<string>();
    for (const tid of o.traversal) {
      const row = T[tid];
      if (!row) { out.push(`${id}.traversal: unknown template '${tid}'`); continue; }
      if (kinds.has(row.kind)) out.push(`${id}.traversal: two '${row.kind}' templates`);
      kinds.add(row.kind);
      if (row.airPress && row.airPress !== 'none') presses.add(row.airPress);
    }
    if (presses.size > 1) out.push(`${id}.traversal: the airborne Jump press has two meanings (${[...presses].join(', ')})`);
  }
  if (!out.length) for (const sp of SPECIES) {
    try { traversalOf(sp, rules); } catch (e) { out.push((e as Error).message); }
  }
  return out;
}

/** A species' pinned size class, if its override sets one (read by src/rules/sizing.ts). */
export const pinnedSizeClass = (id: string): SizeClassId | undefined => SPECIES_OVERRIDES[id]?.sizeClass;
