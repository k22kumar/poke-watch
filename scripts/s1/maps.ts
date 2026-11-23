// S1 spike: the two maps the spike measures, as tile maps and WorldModels
import { defaultRules } from '../../src/rules/defaults';
import { BIOMES } from '../../src/rules/stages';
import { World } from '../../src/sim/world';
import { fromArenaMap } from '../../src/world/adapter';
import type { WorldModel } from '../../src/world/model';

export function rangeModel(): { M: WorldModel; W: World } {
  const rules = { ...defaultRules, worldgen: { ...defaultRules.worldgen, arena: 'range' } };
  const W = new World(rules as never, BIOMES.meadow, 1);
  return { M: fromArenaMap(W.map), W };
}

export function gorgeModel(seed = 1): { M: WorldModel; W: World } {
  const rules = { ...defaultRules, worldgen: { ...defaultRules.worldgen, mode: 'generated' as const, locations: { meadow: 'river-gorge' } } };
  const W = new World(rules as never, BIOMES.meadow, seed);
  return { M: fromArenaMap(W.map), W };
}
