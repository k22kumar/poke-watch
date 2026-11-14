// Registry of Pokémon locations the location generator can build (docs/LOCATIONS.md).
import { CHARGESTONE_CAVE } from './chargestoneCave';
import { MT_MOON } from './mtMoon';
import type { LocationDef } from './types';
import { VIRIDIAN_FOREST } from './viridianForest';

export type { LocationDef } from './types';

export const LOCATIONS: Record<string, LocationDef> = {
  [VIRIDIAN_FOREST.id]: VIRIDIAN_FOREST,
  [MT_MOON.id]: MT_MOON,
  [CHARGESTONE_CAVE.id]: CHARGESTONE_CAVE,
};

/** look a location up by id, accepting loose spellings ("Chargestone Cave", "chargestone", "mt moon") */
export function findLocation(q: string): LocationDef | undefined {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const n = norm(q);
  if (!n) return undefined;
  for (const L of Object.values(LOCATIONS)) if (norm(L.id) === n || norm(L.name) === n) return L;
  for (const L of Object.values(LOCATIONS)) if (norm(L.id).startsWith(n) || norm(L.name).startsWith(n)) return L;
  return undefined;
}
