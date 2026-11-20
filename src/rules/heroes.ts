// Heroes: what a Pokémon brings to a match. The opening-move helpers were salvaged from progression
// (docs/hero-shooter-pivot.md §8 step 4); the kit rule (`heroKit`) and the prototype list join them in later steps.
// Pure rules: no sim state.
import { MOVE_BY_KEY } from './moves';
import { SPECIES, type SpeciesDef } from './species';
import { defaultRules } from './defaults';
import { NEEDS_ABILITY_RULE_REASON } from './profiles';

/** Species the prototype leaves out because their identity is an Ability the game has no rule for yet
 *  (docs/STATS_GROWTH_TARGET.md "Prototype scope", docs/hero-shooter-pivot.md Q34): Shedinja (Wonder Guard), Slaking
 *  (Truant), Regigigas (Slow Start), Wishiwashi (Schooling). A game species among them carries `recruitable: false` with
 *  this reason in SPECIES_OVERRIDES; tests/heroes.test.ts refuses one imported without it. */
export const NEEDS_ABILITY_RULE: readonly string[] = ['shedinja', 'slaking', 'regigigas', 'wishiwashi'];
export { NEEDS_ABILITY_RULE_REASON };

/** a species' level-up moves: the curated partner set, else its cross-game level-up moves */
export function learnsetOf(sp: SpeciesDef): [number, string][] {
  if (sp.learnset?.length) return sp.learnset;
  return (sp.canon?.levelUp ?? []).filter(([, k]) => MOVE_BY_KEY[k]);
}

/** All forms in this line (base first) so evolved creatures keep earlier learnsets. */
export function lineage(sp: SpeciesDef): SpeciesDef[] {
  const out = [sp];
  let cur = sp;
  for (;;) {
    const pre = SPECIES.find((s) => s.evolvesTo === cur.id);
    if (!pre) break;
    out.unshift(pre);
    cur = pre;
  }
  return out;
}

/** The first attacks of a Pokémon arriving at `level`: its earliest non-status level-up moves (the first becomes the
 *  basic attack), else any non-status move it learns. Recruits join with these (sim/squad.ts addMember). */
export function firstAttacks(sp: SpeciesDef, level: number, count = 2): string[] {
  const keys = learnsetOf(sp).filter(([lv, k]) => lv <= Math.max(level, 1) && MOVE_BY_KEY[k] && MOVE_BY_KEY[k].cls !== 'status').map(([, k]) => k);
  const out = [...new Set(keys)].slice(0, count);
  if (!out.length) { const any = learnsetOf(sp).find(([, k]) => MOVE_BY_KEY[k] && MOVE_BY_KEY[k].cls !== 'status'); if (any) out.push(any[1]); }
  // a species that learns no damaging move (Cosmog) still has something to open with: the basic attack
  if (!out.length && MOVE_BY_KEY[defaultRules.moves.fallbackAttack]) out.push(defaultRules.moves.fallbackAttack);
  return out;
}

/** The move a run opens with: the species' curated starter, else its line's (an evolved partner picked directly),
 *  else its first attack, so any species can lead a run (docs/PLAYABILITY.md). */
export function openingMove(sp: SpeciesDef): string | undefined {
  return sp.starter ?? lineage(sp)[0].starter ?? firstAttacks(sp, 1, 1)[0];
}

/** The four test lines (docs/STATS_GROWTH_TARGET.md "Prototype scope"): shown first on hero pick and used by the replay
 *  baseline and tests. Calibrated first with scripted duels. */
export const FEATURED: readonly string[] = ['caterpie', 'metapod', 'butterfree', 'charmander', 'charmeleon', 'charizard', 'tauros', 'mewtwo'];

/** The prototype's hero pick (docs/hero-shooter-pivot.md Q35, approved with the Rock and Dragon lines added): 58 forms
 *  in 22 families, FEATURED first. The rule: a whole canonical line in the roster, every form ready and recruitable
 *  and inside the frozen habitat trainer profile (footprint ≤ 0.88 m, eye ≤ 1.42 m), spread across elements, size
 *  and traversal (swim, fly, hover), no branching line (a Breakthrough needs one next form; how it would choose a
 *  branch is open, §11). Every line is linked by evolvesTo (scripts/build-content.mjs links every species to its single
 *  next form), so each can Breakthrough; tests/heroes.test.ts checks the lines are whole. */
export const PROTOTYPE: readonly string[] = [
  ...FEATURED,
  // the partner lines (evolvesTo wired)
  'bulbasaur', 'ivysaur', 'venusaur', 'squirtle', 'wartortle', 'blastoise', 'chikorita', 'bayleef', 'meganium',
  'cyndaquil', 'quilava', 'typhlosion', 'totodile', 'croconaw', 'feraligatr',
  // wild lines: Electric, Flying, hover, Ice, Fairy / swim, Ghost / Fire, Fighting, Dark, Steel, Ground, Fairy, Rock, Dragon
  'pichu', 'pikachu', 'raichu',
  'rookidee', 'corvisquire', 'corviknight',
  'tynamo', 'eelektrik', 'eelektross',
  'bergmite', 'avalugg',
  'azurill', 'marill', 'azumarill',
  'litwick', 'lampent', 'chandelure',
  'makuhita', 'hariyama',
  'murkrow', 'honchkrow',
  'magnemite', 'magneton', 'magnezone',
  'diglett', 'dugtrio',
  'togepi', 'togetic', 'togekiss',
  'geodude', 'graveler', 'golem',
  'bagon', 'shelgon', 'salamence',
];

/** A hero's kit (docs/STATS_GROWTH_TARGET.md "Kit and gating", docs/hero-shooter-pivot.md Q27): the primary (left
 *  click, fixed by species), Ability 1 (Q) and Ability 2 (E). The Ultimate (R) is unbound until it exists. */
export interface HeroKit { primary?: string; q?: string; e?: string }

/** Hand-authored kits that override the rule, field by field (the featured heroes' tuning lives here). */
export const HERO_KITS: Record<string, Partial<HeroKit>> = {
  // Tauros's canonical learnset has no hold move; Wrap (a Normal bind, rules/capabilities.ts HOLD_MOVES) is its E so the
  // featured physical hero can hold and throw (docs/hero-shooter-pivot.md Q41, scenario range-tauros)
  tauros: { e: 'wrap' },
};

/** a species' level-up moves in canonical order (its official level-up list, earliest level first, status moves
 *  included), else its game learnset */
export function canonicalLearnset(sp: SpeciesDef): string[] {
  const rows = sp.canon?.levelUp?.length ? sp.canon.levelUp : learnsetOf(sp);
  const sorted = rows.map((r, i) => [r[0], i, r[1]] as const).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return [...new Set(sorted.map((r) => r[2]).filter((k) => MOVE_BY_KEY[k]))];
}

/** The kit rule: primary = openingMove; Q = the first other move of the canonical learnset; E empty, or (range mode,
 *  for testing) the next one. HERO_KITS overrides any field. */
export function heroKit(sp: SpeciesDef, opts: { fillE?: boolean } = {}): HeroKit {
  const o = HERO_KITS[sp.id] ?? {};
  const primary = o.primary ?? openingMove(sp);
  const rest = canonicalLearnset(sp).filter((k) => k !== primary);
  const q = o.q ?? rest[0];
  const e = o.e ?? (opts.fillE ? rest.find((k) => k !== q) : undefined);
  return { primary, q, e };
}
