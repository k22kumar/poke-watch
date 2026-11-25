// The navmesh's vertical cell counts for a cell height, derived from the physical sizes they stand for (I3 review of
// F79). A measurement helper: the game's counts are written in rules.nav and tests/nav.test.ts checks them against the
// same physical sizes; this lets the harnesses compare a cell height without editing rules. Horizontal settings (cs,
// radii, tile size) are not touched.
//   step      rules.player.stepHeight (0.6 m) in cells, rounded to the nearest (it is a whole number of cells at 0.05,
//             0.02 and 0.01; Math.floor(0.6 / 0.05) is 11 in float, the trap S1 §8 names)
//   heights   the tallest body today's gates carry per group (scripts/navwalk.ts's walkers and trainers, enemyHeight at
//             role size 1), rounded up to cells; the giant report's 3.57 m draw cap the same way
//   climb     Recast's build climb: one cell under the step (rules.nav.recastClimb says why), unless given
import { defaultRules, type Rules } from '../../src/rules/defaults';
import { SPECIES_BY_ID } from '../../src/rules/species';
import { enemyHeight } from '../../src/rules/sizing';

/** the species whose heights set each group's agent height (tests/nav.test.ts's `gate`) */
export const HEIGHT_GATE: Record<'narrow' | 'large' | 'xl', string[]> = { narrow: ['slugma', 'totodile'], large: ['heracross'], xl: ['onix', 'feraligatr'] };
/** m: the giant report's draw cap */
export const GIANT_CAP = 3.57;

const up = (m: number, ch: number) => Math.ceil(m / ch - 1e-9);

/** rules.nav's vertical counts at cell height `ch` (climb: Recast's build climb, default one under the step) */
export function navCellsFor(ch: number, climb?: number, rules: Rules = defaultRules): Partial<Rules['nav']> {
  const tallest = (ids: string[]) => Math.max(...ids.map((id) => enemyHeight(SPECIES_BY_ID[id], 1, rules)));
  const step = Math.round(rules.player.stepHeight / ch);
  if (Math.abs(step * ch - rules.player.stepHeight) > 1e-9) throw new Error(`navcells: ${rules.player.stepHeight} m is not a whole number of ${ch} m cells`);
  const G = rules.nav.groups;
  return {
    ch, walkableClimb: step, recastClimb: climb ?? step - 1, giantHeight: up(GIANT_CAP, ch),
    groups: {
      narrow: { radius: G.narrow.radius, height: up(tallest(HEIGHT_GATE.narrow), ch) },
      large: { radius: G.large.radius, height: up(tallest(HEIGHT_GATE.large), ch) },
      xl: { radius: G.xl.radius, height: up(tallest(HEIGHT_GATE.xl), ch) },
    },
  };
}

/** rules with rules.nav at cell height ch (NAV_CH / NAV_CLIMB in the environment for the gate scripts) */
export function withNavCells<R extends Rules>(rules: R, ch: number, climb?: number): R {
  return { ...rules, nav: { ...rules.nav, ...navCellsFor(ch, climb, rules) } };
}
