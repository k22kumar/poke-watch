// Modes = rule overrides + mods. Add a file, register it here, it appears on the title screen.
import { enemiesInRadius, hitScratch } from '../sim/moves';
import { damageEnemy } from '../sim/combat';
import { healPlayer } from '../sim/combat';
import { swapSystem } from '../sim/swap';
import { startObjective } from '../sim/objectives';
import type { System } from '../sim/types';
import type { Mod, Mode } from './types';
import { deepMerge } from '../core/util';
import { defaultRules } from '../rules/defaults';
import { validateSpawnOverride, type SpawnPoolDef } from '../rules/spawning';

// ---------------------------------------------------------------- example mods
export const vampiric: Mod = {
  id: 'vampiric',
  name: 'Vampiric',
  description: 'Critical hits heal 5% of the damage dealt.',
  hooks: {
    modifyDamage(ctx, hit) {
      if (hit.crit) healPlayer(ctx, hit.amount * 0.05);
    },
  },
};

export const volatile: Mod = {
  id: 'volatile',
  name: 'Volatile',
  description: 'Defeated creatures burst, damaging neighbours.',
  hooks: {
    onKill(ctx, e) {
      const E = ctx.enemies;
      const x = E.x[e], z = E.z[e];
      const dmg = E.maxHp[e] * 0.25;
      // copy targets first: damageEnemy may kill and re-enter this hook
      const n = enemiesInRadius(ctx, x, z, 2.5);
      const targets = Array.from(hitScratch.subarray(0, n));
      ctx.events.push({ t: 'ring', x, z, r: 2.5, element: 'blaze', life: 0.3 });
      for (const j of targets) if (j !== e && E.alive[j]) damageEnemy(ctx, j, dmg / Math.max(0.5, ctx.player.derived.spa), { element: 'blaze', cls: 'special', ailment: 'burn', chance: 0, knock: 3, kx: E.x[j] - x, kz: E.z[j] - z, drain: 0, source: 'volatile' });
    },
  },
};

export const ALL_MODS: Mod[] = [vampiric, volatile];

/** The survivor loop's systems left: progression (chests). The director was deleted at pivot step 9; objectives stay
 *  and run only when something starts one (the Hold mode, the habitat Hold gates). */
export const SURVIVOR_SYSTEMS: ReadonlySet<string> = new Set(['progression']);

/** No survivor loop (docs/hero-shooter-pivot.md §8 step 1, Q15): the foundation systems only. Tests and gates that
 *  exercise movement, combat, worldgen or hazards run under it instead of silencing the director with rule hacks. */
export const noSurvivorLoop: Mod = {
  id: 'no-survivor-loop',
  name: 'No survivor loop',
  systems: (list) => list.filter((s) => !SURVIVOR_SYSTEMS.has(s.name)),
};

/** One Pokémon per player: the swap system (src/sim/swap.ts) is left out. The default for hero modes. */
export const solo: Mod = {
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

/** The training range: the foundation with no survivor loop. Targets, respawns and the hero kit arrive in later steps
 *  of the pivot (docs/hero-shooter-pivot.md §8). */
export const RANGE: Mode = {
  id: 'range', name: 'Training range',
  description: 'No waves, no levels: move, aim and fight on any map.',
  rules: { mode: { id: 'range', difficulty: 1 }, hero: { fillE: true, respawn: 3 }, evolution: { freeTrigger: true } },
  mods: [noSurvivorLoop, solo],
};

/** Hold opens at the start of a habitat map (src/sim/modes/hold.ts): the point is the contest floor, the Raid party
 *  comes from team B's staging. On a map with no habitat it does nothing. */
const holdStart: System = {
  name: 'holdStart',
  update(ctx) { if (ctx.tick === 1 && !ctx.objective && ctx.world.hab) startObjective(ctx, 'hold'); },
};
export const holdMod: Mod = {
  id: 'hold',
  name: 'Hold',
  systems: (list) => { const i = list.findIndex((s) => s.name === 'objectives'); return i < 0 ? [...list, holdStart] : [...list.slice(0, i), holdStart, ...list.slice(i)]; },
};

/** Hold the point (docs/hero-shooter-pivot.md Q14, Q48): the control point on a habitat map against the Raid party.
 *  The 3v3's objective later; for now one hero against the raiders. */
export const HOLD: Mode = {
  id: 'hold', name: 'Hold',
  description: 'Take the point on a habitat map and hold it against the raid party.',
  rules: { mode: { id: 'hold', difficulty: 1 } },
  mods: [noSurvivorLoop, solo, holdMod],
};

/** The range with a three-member loadout and swapping: the opt-in swap system's own mode (and replay scenario). */
export const RANGE_SWAP: Mode = {
  id: 'range-swap', name: 'Training range (swap)',
  description: 'The range with a three-Pokémon loadout you swap between.',
  rules: { ...RANGE.rules, hero: { fillE: true, respawn: 3, loadout: 3 } },
  mods: [noSurvivorLoop, swap],
};

// ---------------------------------------------------------------- modes
export const MODES: Mode[] = [
  {
    id: 'classic', name: 'Classic',
    description: 'Four regions, a boss at 5:00 in each. Beat the boss, take the portal.',
  },
  {
    id: 'survival', name: 'Survival',
    description: 'Endless. Regions loop with steeper enemies every lap. How long can you last?',
    rules: { mode: { id: 'survival', difficulty: 1 } },
  },
  {
    id: 'glass-cannon', name: 'Glass Cannon',
    description: 'You hit much harder, so do they. Crits heal a little.',
    rules: { mode: { id: 'glass-cannon', difficulty: 1.6 }, damage: { stab: 1.8, critChance: 0.15 } },
    mods: [vampiric],
  },
  {
    id: 'boss-rush', name: 'Boss Rush',
    description: 'Bosses arrive at 1:30. Short stages.',
  },
  RANGE,
  HOLD,
];

/** What validateSpawnOverride reports for a mode's own rules.spawning.override and each of its mods' (bosses named in
 *  the spawns, unknown species, empty pools), with the regions the mode's rules select. Checked where a mode is loaded:
 *  src/main.ts startRun warns with these; tests/spawning.test.ts requires none for MODES. */
export function modeSpawnProblems(mode: Mode): string[] {
  const layers: [string, Mod | Mode][] = [[`mode ${mode.id}`, mode], ...(mode.mods ?? []).map((m): [string, Mod] => [`mod ${m.id}`, m])];
  const rules = deepMerge(defaultRules, mode.rules, ...(mode.mods ?? []).map((m) => m.rules));
  const out: string[] = [];
  for (const [where, src] of layers) {
    const o = src.rules?.spawning?.override;
    if (o) out.push(...validateSpawnOverride(`${where} rules.spawning.override`, o as SpawnPoolDef, rules.spawning.regions, rules));
  }
  return out;
}
