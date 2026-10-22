// Modes = rule overrides + mods. Add a file, register it here, it appears on the title screen.
import { enemiesInRadius, hitScratch } from '../sim/moves';
import { damageEnemy } from '../sim/combat';
import { healPlayer } from '../sim/combat';
import type { Mod, Mode } from './types';

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

export const noHealCards: Mod = {
  id: 'no-heal-cards',
  name: 'No heal cards',
  hooks: { filterCards: (_ctx, cards) => cards.filter((c) => c.kind !== 'heal') },
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

export const ALL_MODS: Mod[] = [vampiric, noHealCards, volatile];

// ---------------------------------------------------------------- modes
export const MODES: Mode[] = [
  {
    id: 'classic', name: 'Classic',
    description: 'Four regions, a boss at 5:00 in each. Beat the boss, take the portal.',
  },
  {
    id: 'survival', name: 'Survival',
    description: 'Endless. Regions loop with steeper enemies every lap. How long can you last?',
    rules: { mode: { id: 'survival', endless: true, difficulty: 1 } },
  },
  {
    id: 'glass-cannon', name: 'Glass Cannon',
    description: 'You hit much harder, so do they. Crits heal a little.',
    rules: { mode: { id: 'glass-cannon', endless: false, difficulty: 1.6 }, damage: { stab: 1.8, critChance: 0.15 } },
    mods: [vampiric],
  },
  {
    id: 'boss-rush', name: 'Boss Rush',
    description: 'Bosses arrive at 1:30. Fast levels, short stages.',
    rules: { stage: { bossAt: 90, finalSwarmAt: 240 }, xp: { base: 4, linear: 3 }, director: { alphaAt: 60, eliteEvery: 20 } },
  },
];
