// Control readiness (docs/PLAYABILITY.md): which species can lead a run as the player, derived from the game's own
// data with no hand-kept list. Every species in SPECIES (src/content/pokedex.ts, generated from content/roster.json)
// is graded by the checks below; a newly generated Pokémon is graded the same way the next time the game starts.
//
// `playable` on a SpeciesDef still means "offered as a starter" (rules/species.ts starterChoices); this module is
// about whether a species *works* under player control, which is what the developer roster lists.
//
// Tiers: `ready` (every check passes), `partial` (it runs, but a warn check failed: selectable with a warning) and
// `unavailable` (a block check failed: listed with the reason, not selectable). Hosts add checks the sim cannot make
// (the browser adds `art`: the species' sprite atlas actually loaded) through `extra`.

import { MOVE_BY_KEY } from '../rules/moves';
import { defaultRules, type Rules } from '../rules/defaults';
import { SPECIES, type SpeciesDef } from '../rules/species';
import { bodyOf } from '../rules/sizing';
import { tagLineOf } from '../rules/tags';
import { ARCHETYPES, compileMove } from './moves';
import { lineage, openingMove } from '../rules/heroes';

export type ControlTier = 'ready' | 'partial' | 'unavailable';

/** One readiness rule. `test` returns null when the species passes, else the reason it does not. */
export interface ReadinessCheck {
  id: string;
  /** block: a failure makes the species unavailable; warn: it stays selectable as partial */
  severity: 'block' | 'warn';
  test(sp: SpeciesDef, rules: Rules): string | null;
}

export interface CheckResult { id: string; ok: boolean; severity: ReadinessCheck['severity']; reason?: string }

export interface ControlReadiness {
  id: string;
  name: string;
  tier: ControlTier;
  /** the move the run opens with (sim/progression.ts openingMove) */
  opening?: string;
  checks: CheckResult[];
  /** the reasons of the failed checks, block ones first */
  reasons: string[];
}

const finite = (n: number) => Number.isFinite(n) && n > 0;

/** The sim-side checks. Add one here to tighten what "playable" means; the roster UI and tests pick it up. */
export const READINESS_CHECKS: ReadinessCheck[] = [
  {
    id: 'registered', severity: 'block',
    test: (sp) => {
      const s = sp.stats;
      if (!s || ![s.hp, s.atk, s.def, s.spa, s.spd, s.spe].every((v) => Number.isFinite(v) && v >= 0) || s.hp <= 0) return 'incomplete base stats';
      if (!sp.elements?.length) return 'no type';
      return null;
    },
  },
  {
    id: 'openingKit', severity: 'block',
    test: (sp, rules) => {
      const key = openingMove(sp);
      if (!key) return 'no damaging move to open a run with';
      const m = MOVE_BY_KEY[key];
      if (!m) return `opening move ${key} is not in the move database`;
      if (m.cls === 'status') return `opening move ${key} is a status move`;
      try {
        const spec = compileMove(rules, key);
        if (!ARCHETYPES[spec.archetype]) return `opening move ${key} has no behaviour (${spec.archetype})`;
      } catch (e) {
        return `opening move ${key} does not compile: ${(e as Error).message}`;
      }
      return null;
    },
  },
  {
    id: 'body', severity: 'warn',
    test: (sp, rules) => {
      const b = bodyOf(sp, rules.size);
      if (!finite(b.radius) || !finite(b.height) || !finite(b.body)) return 'no valid body size';
      // a boss keeps its encounter-scale body (sp.scale): its hurtbox is boss-sized while the player sprite is drawn at 1x
      if (b.authored) return 'boss-scale body: hitbox larger than its player sprite';
      return null;
    },
  },
  {
    id: 'tagAction', severity: 'warn',
    test: (sp) => {
      const line = tagLineOf(lineage(sp)[0].id) ?? tagLineOf(sp.id);
      if (!line) return 'no Tag Action (tagging it in fires nothing)';
      if (!MOVE_BY_KEY[line.base.move] || !MOVE_BY_KEY[line.variant.move]) return 'Tag Action move missing from the move database';
      return null;
    },
  },
];

/** Grade one species against the sim checks plus any host checks. */
export function controlReadiness(sp: SpeciesDef, rules: Rules = defaultRules, extra: readonly ReadinessCheck[] = []): ControlReadiness {
  const checks: CheckResult[] = [];
  for (const c of [...READINESS_CHECKS, ...extra]) {
    let reason: string | null;
    try { reason = c.test(sp, rules); } catch (e) { reason = `check failed: ${(e as Error).message}`; }
    checks.push(reason === null ? { id: c.id, ok: true, severity: c.severity } : { id: c.id, ok: false, severity: c.severity, reason });
  }
  const failed = checks.filter((c) => !c.ok);
  const tier: ControlTier = failed.some((c) => c.severity === 'block') ? 'unavailable' : failed.length ? 'partial' : 'ready';
  const reasons = [...failed.filter((c) => c.severity === 'block'), ...failed.filter((c) => c.severity === 'warn')].map((c) => c.reason!);
  return { id: sp.id, name: sp.name, tier, opening: openingMove(sp), checks, reasons };
}

const memo = new WeakMap<Rules, ControlReadiness[]>();

/** Every species in the registry, graded, in registry order. Memoised per rules object when no host checks are given. */
export function controlRoster(rules: Rules = defaultRules, extra: readonly ReadinessCheck[] = []): ControlReadiness[] {
  if (!extra.length) {
    const hit = memo.get(rules);
    if (hit) return hit;
  }
  const out = SPECIES.map((sp) => controlReadiness(sp, rules, extra));
  if (!extra.length) memo.set(rules, out);
  return out;
}

/** Species that can be selected to play as (ready and partial). */
export const selectableSpecies = (rules: Rules = defaultRules, extra: readonly ReadinessCheck[] = []) =>
  controlRoster(rules, extra).filter((r) => r.tier !== 'unavailable');
