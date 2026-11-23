// Modes = rule overrides + mods. Register a mode in MODES to reach it by URL (?go=1&mode=<id>), and in TITLE_MODES to
// offer it on the title screen.
import { swapSystem } from '../sim/swap';
import { startObjective } from '../sim/objectives';
import { RAID_PARTY } from '../sim/modes/hold';
import type { System } from '../sim/types';
import type { Mod, Mode } from './types';

/** One Pokémon per player: the swap system (src/sim/swap.ts) is left out. The default for hero modes. */
const solo: Mod = {
  id: 'solo',
  name: 'Solo',
  systems: (list) => list.filter((s) => s.name !== 'swap'),
};

/** Swapping as a mechanic a mode opts into (docs/hero-shooter-pivot.md Q10, Q11): the swap system, after the squad's
 *  core. Pair it with a loadout above one (rules.hero.loadout, RunOptions.loadout). */
export const swap: Mod = {
  id: 'swap',
  name: 'Swap',
  systems: (list) => {
    if (list.some((s) => s.name === 'swap')) return list;
    const i = list.findIndex((s) => s.name === 'squad');
    return [...list.slice(0, i + 1), swapSystem, ...list.slice(i + 1)];
  },
};

/** The training range: the foundation systems. Targets, respawns and the hero kit arrive in later steps
 *  of the pivot (docs/hero-shooter-pivot.md §8). */
export const RANGE: Mode = {
  id: 'range', name: 'Training range',
  description: 'No waves, no levels: move, aim and fight on any map.',
  rules: { mode: { id: 'range' }, hero: { fillE: true, respawn: 3 }, evolution: { freeTrigger: true } },
  mods: [solo],
};

/** Hold opens at the start of a habitat map (src/sim/modes/hold.ts): the point is the contest floor, the Raid party
 *  comes from team B's staging. On a map with no habitat it does nothing. */
const holdStart: System = {
  name: 'holdStart',
  update(ctx) { if (ctx.tick === 1 && !ctx.objective && ctx.world.hab) startObjective(ctx, 'hold'); },
};
const holdMod: Mod = {
  id: 'hold',
  name: 'Hold',
  shows: [...new Set(RAID_PARTY.flatMap((m) => m.species))],
  systems: (list) => { const i = list.findIndex((s) => s.name === 'objectives'); return i < 0 ? [...list, holdStart] : [...list.slice(0, i), holdStart, ...list.slice(i)]; },
};

/** Hold the point (docs/hero-shooter-pivot.md Q14, Q48): the control point on a habitat map against the Raid party.
 *  The 3v3's objective later; for now one hero against the raiders. */
export const HOLD: Mode = {
  id: 'hold', name: 'Hold',
  description: 'Take the point on a habitat map and hold it against the raid party.',
  rules: { mode: { id: 'hold' } },
  mods: [solo, holdMod],
};

/** The range with a three-member loadout and swapping: the opt-in swap system's own mode (and replay scenario). */
export const RANGE_SWAP: Mode = {
  id: 'range-swap', name: 'Training range (swap)',
  description: 'The range with a three-Pokémon loadout you swap between.',
  rules: { ...RANGE.rules, hero: { fillE: true, respawn: 3, loadout: 3 } },
  mods: [swap],
};

// ---------------------------------------------------------------- modes
/** The shipped modes (docs/hero-shooter-pivot.md Q48): the training range and Hold. The survivor modes (Classic,
 *  Survival, Glass Cannon, Boss Rush) and their example mods were deleted at pivot step 9; the Mode / Mod mechanism
 *  stays (src/mods/types.ts). RANGE_SWAP is the swap system's own mode, used by its replay scenario. */
export const MODES: Mode[] = [RANGE, HOLD];

/** The modes the title screen offers. Hold is hidden until T2 (owner, 2026-11-21): it only does something on a habitat
 *  map, and the title's default world is not one. Reach it with `?go=1&mode=hold&map=river-gorge` (any habitat recipe). */
export const TITLE_MODES: Mode[] = [RANGE];

