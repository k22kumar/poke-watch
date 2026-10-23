/** Tile habitat tags shared by world generation and encounter selection. */
export const HAB = { meadow: 1, grass: 2, water: 4, rock: 8, dry: 16, forest: 32 } as const;

/** Native ranges may overlap; no species is excluded from an unfamiliar habitat. */
export const SPECIES_HABITAT: Record<string, number> = {
  rattata: HAB.meadow | HAB.grass, ledyba: HAB.forest | HAB.meadow, sandshrew: HAB.dry | HAB.rock,
  oddish: HAB.grass | HAB.forest, poliwag: HAB.water, mareep: HAB.meadow, heracross: HAB.forest,
  geodude: HAB.rock, houndour: HAB.dry | HAB.rock, zubat: HAB.forest | HAB.rock, paras: HAB.forest | HAB.water,
  vulpix: HAB.dry, slugma: HAB.rock | HAB.dry, swinub: HAB.water | HAB.rock, delibird: HAB.meadow | HAB.rock,
  gastly: HAB.forest | HAB.rock,
};

/** Habitat preference changes encounter odds, never eligibility. */
export function habitatSpawnFactor(species: string, habitat: number): number {
  const native = SPECIES_HABITAT[species];
  if (!native || !habitat) return 1;
  return native & habitat ? 2 : 0.55;
}
