// Species profiles: the one place for per-species gameplay facts that are not combat stats.
//
// A profile keeps three kinds of fact apart, because spawning, traversal and (later) AI read them differently:
//
//   capability   what the Pokémon CAN do        fly (roster.json `flying`), swim (rules.hazards.water: Water type or
//                                               knows a safe move — a rule, not a per-species flag)
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
}

export interface SpeciesProfile {
  id: string;
  fly: boolean;
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
    fly: !!def?.flying,
    prefers: o.prefers ?? 0,
    requires: o.requires ?? 0,
    avoids: o.avoids ?? 0,
    mender: o.mender ?? false,
    sizeClass: o.sizeClass,
  };
  cache.set(id, p);
  return p;
}

/** Capability: can a Pokémon of these types and moves swim safely? The rule lives in rules.hazards.water. */
export function canSwim(species: { elements: readonly string[] }, moves?: readonly { key: string }[], rules: Rules = defaultRules): boolean {
  const W = rules.hazards.water;
  return species.elements.some((e) => W.safeTypes.includes(e as never)) || (!!moves && moves.some((s) => W.safeMoves.includes(s.key as never)));
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

/** A species' pinned size class, if its override sets one (read by src/rules/sizing.ts). */
export const pinnedSizeClass = (id: string): SizeClassId | undefined => SPECIES_OVERRIDES[id]?.sizeClass;
