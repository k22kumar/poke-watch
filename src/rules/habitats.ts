/** Tile habitat tags shared by world generation and encounter selection. Which species prefer, require or avoid
 *  them is in src/rules/profiles.ts (SPECIES_OVERRIDES); no species is excluded from an unfamiliar habitat unless
 *  its profile says so. */
export const HAB = { meadow: 1, grass: 2, water: 4, rock: 8, dry: 16, forest: 32 } as const;
