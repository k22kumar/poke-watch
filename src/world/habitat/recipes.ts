// Habitat recipes (docs/HABITATS.md). Each is data: the landform kernel it uses, its anchors tagged canon /
// reinterpretation / original, vegetation and prop rules, surfaces and variants, optional features, seams, the ranges
// seeds may vary, and the states the validator must enumerate. Both are ADAPTATIONS: the official locations are
// physical references for landforms and relationships, and every combination below is labelled as such.
import { T } from '../tiles';
import type { HabitatRecipe } from './types';

export const RIVER_GORGE: HabitatRecipe = {
  id: 'river-gorge',
  name: 'Shrine Gorge',
  summary: 'A forested river gorge: a river on the plateau falls over a lip into a plunge pool, splits around a rock island that carries a ruined shrine on a raised terrace, and runs on downstream. Adaptation of Hoenn Route 119 (river, waterfall, tall grass) and Ilex Forest (dense forest around a small shrine).',
  landform: 'gorge', support: 'ground', medium: 'water',
  refs: [
    { title: 'Bulbapedia — Hoenn Route 119', url: 'https://bulbapedia.bulbagarden.net/wiki/Hoenn_Route_119' },
    { title: 'Bulbapedia — Ilex Forest', url: 'https://bulbapedia.bulbagarden.net/wiki/Ilex_Forest' },
  ],
  anchors: [
    { id: 'river', form: 'a continuous river: upper reach, falls, plunge pool, two arms, downstream reach to the map edge', family: 'channel', provenance: 'canon', refs: [0], locked: true },
    { id: 'falls', form: 'a waterfall lip over the gorge head with a receiving plunge pool', family: 'channel', provenance: 'canon', refs: [0], locked: true },
    { id: 'tall-grass', form: 'tall grass in the clearings of both rims', family: 'stand', provenance: 'canon', refs: [0], locked: false },
    { id: 'forest', form: 'dense tree stands on the rims and the gorge floor, with clearings', family: 'stand', provenance: 'canon', refs: [1], locked: false },
    { id: 'shrine', form: 'a small shrine with its forecourt', family: 'structure', provenance: 'canon', refs: [1], locked: true },
    { id: 'gorge', form: 'steep gorge walls between the rims and the floor, with a bench on each wall', family: 'cliff', provenance: 'reinterpretation', refs: [0], locked: true },
    { id: 'island-terrace', form: 'the shrine raised on a stable rock terrace inside a river island', family: 'structure', provenance: 'original', refs: [], locked: true },
    { id: 'crossings', form: 'low wooden bridges and terrace-height stone causeways over the arms', family: 'structure', provenance: 'reinterpretation', refs: [0], locked: false },
    { id: 'spurs', form: 'rock spurs off the gorge walls between the crossings', family: 'boulder', provenance: 'original', refs: [], locked: true },
  ],
  adaptations: [
    { feature: 'The shrine stands on a river island below the falls', why: 'Ilex Forest has a shrine and Route 119 a river and waterfall; joining them puts the objective where both sides must cross water by a dry bridge or causeway.' },
    { feature: 'Each wall has a bench at terrace height carrying a causeway', why: 'A screened second approach that arrives at the terrace from a different angle than the bridge.' },
    { feature: 'Rock spurs between the crossings', why: 'They interrupt rim-to-floor sightlines so no perch on a rim watches both of a side\'s approaches.' },
  ],
  vegetation: { trees: ['tree', 'tree2', 'round'], fill: 'thicket', under: ['bush', 'bushR'], density: 0.6, moisture: [0, 1], clearings: 0.3 },
  props: { cover: ['boulder', 'tree'], low: ['rock', 'log', 'stump', 'bush'], ruin: ['pillar', 'pillarBroken', 'lantern', 'pillarBroken'], decor: ['flowerW', 'flowerY', 'mushroom'], landmark: 'River Shrine', landmarkProp: 'shrine' },
  surfaces: { floor: T.grass, rim: T.grass, route: T.path, ramp: T.dirt, bank: T.sand, terrace: T.stone, shelf: T.dirt },
  variants: {
    // paint only: the frost palette, snow and ice pines (2×2 walls like the trees they replace). The understory stays the
    // recipe's bushes: a rock stands 0.75 m, a bush 0.70 m, and a variant may not move the ground a player stands on.
    snow: { name: 'Snowbound gorge', art: 'frost', particles: 'snow', trees: ['icepine', 'icepine', 'tree'] },
  },
  optional: [
    { id: 'lip-ford', chance: 0.7, what: 'a stepping-stone ford across the upper river above the falls (a rim-to-rim connection)' },
    { id: 'south-bridge', chance: 0.55, what: 'a low bridge across the downstream reach (a floor-to-floor connection)' },
  ],
  seams: [
    { recipe: 'viridian-forest', via: 'the rim forest continues as a stand corridor (same climate and substrate: blend, spec R06)' },
    { recipe: 'volcanic-ridge', via: 'a bare rock shelf and a drop in elevation (conflicting climates need distance or a partition, spec R06)' },
  ],
  freedoms: {
    riverShift: [-3, 3], bend: [2, 5], bendFreq: [0.6, 1.2], fallsY: [24, 31], poolR: [6, 7.5],
    islandRx: [11.5, 13], islandRy: [14, 16], armW: [4, 5], islandGap: [3, 6], bankW: [8, 10], downW: [12, 15],
    stageDy: [30, 36], stageDx: [11, 13],
  },
  levels: { rim: 6, terrace: 3, bench: 3, water: -0.25 },
  art: 'forest', particles: 'petals',
  biomeFit: ['meadow'],
  fallbackSeeds: [1, 2, 3],
  states: ['base', 'frozen', 'stripped'],
};

export const VOLCANIC_RIDGE: HabitatRecipe = {
  id: 'volcanic-ridge',
  name: 'Cinder Crater',
  summary: 'A breached volcanic crater: a walkable rim crest over a crater floor with a bounded lava lake, a solid rock flank cut by switchbacks and a dry cave network, and a foot plain around it. Adaptation of Mt. Chimney (crater summit, lava), Fiery Path (a hot cave through the mountain\'s base) and Firespit Island (cooled lava slopes).',
  landform: 'crater', support: 'ground', medium: 'lava',
  refs: [
    { title: 'Bulbapedia — Mt. Chimney', url: 'https://bulbapedia.bulbagarden.net/wiki/Mt._Chimney' },
    { title: 'Bulbapedia — Fiery Path', url: 'https://bulbapedia.bulbagarden.net/wiki/Fiery_Path' },
    { title: 'Bulbapedia — Firespit Island', url: 'https://bulbapedia.bulbagarden.net/wiki/Firespit_Island' },
  ],
  anchors: [
    { id: 'crater', form: 'a crater floor ringed by a rim crest', family: 'cliff', provenance: 'canon', refs: [0], locked: true },
    { id: 'lava', form: 'a bounded lava lake on the crater floor with a cooled shelf around it', family: 'channel', provenance: 'canon', refs: [0, 2], locked: true },
    { id: 'cave', form: 'a dry cave network through the mountain\'s flank: mouths, tunnels, chambers', family: 'chamber', provenance: 'canon', refs: [1], locked: false },
    { id: 'breach', form: 'a breached rim that opens the crater floor to the outer slope', family: 'relief', provenance: 'reinterpretation', refs: [0], locked: true },
    { id: 'flank', form: 'solid cooled-rock flanks and shelves around the crater', family: 'cliff', provenance: 'reinterpretation', refs: [2], locked: false },
    { id: 'vents', form: 'a vent field at the end of an optional cave branch', family: 'relief', provenance: 'reinterpretation', refs: [2], locked: false },
    { id: 'altar', form: 'a ruined altar ring on the crater forecourt', family: 'structure', provenance: 'original', refs: [], locked: true },
  ],
  adaptations: [
    { feature: 'The crater floor is open and dry around a single bounded lava lake', why: 'The fight needs ordinary ground; lava stays at one edge as scenery and a hard boundary.' },
    { feature: 'Fiery Path becomes a cave per side through the flank, ending under the crest in an arch', why: 'An independent dry approach to the forecourt from a different angle than the switchback.' },
    { feature: 'A ruined altar ring on the forecourt', why: 'Indestructible low walls give cover against the strongest rim position; the ruins themselves are original.' },
  ],
  vegetation: { trees: ['deadtree'], fill: 'stalagmite', under: ['rock'], density: 0.22, moisture: [0, 1], clearings: 0 },
  props: { cover: ['boulder'], low: ['rock', 'rock', 'pillarBroken'], ruin: ['pillarBroken', 'pillar', 'pillarBroken'], decor: [], landmark: 'Ember Altar', landmarkProp: 'statue' },
  surfaces: { floor: T.dirt, rim: T.stone, route: T.sand, ramp: T.sand, bank: T.stone, terrace: T.stone, shelf: T.stone },
  variants: {
    // paint only: the ash palette. It does not swap dirt and sand: sim/cells.ts footing slows sand (Rimefrost) and dirt and
    // sand (Cinder Badlands) differently, so a floor/route swap sped the routes up 16 % in a Rimefrost region on the same
    // geometry (audit, docs/HABITAT_AUDIT.md). tests/habaudit.test.ts keeps every variant's footing equal to the recipe's.
    ash: { name: 'Ashfall crater', art: 'badlands', particles: 'embers' },
  },
  optional: [
    { id: 'vent-branch', chance: 0.85, what: 'a side tunnel from each cave chamber into a vent field on the crater floor (the hazard branch)' },
  ],
  seams: [
    { recipe: 'river-gorge', via: 'a bare rock shelf and a drop in elevation (conflicting climates, spec R06)' },
  ],
  freedoms: {
    craterY: [50, 56], craterR: [19, 22], crestW: [5, 6.5], flankW: [10, 12], breachW: [10, 13], lavaD: [0.42, 0.55], lavaR: [6, 7.5],
    contestD: [0.06, 0.2], stageD: [5, 8], switchA: [0.42, 0.55], caveA: [0.6, 0.8], legLen: [5, 7.5], chamberR: [3.6, 4.6],
  },
  levels: { floor: 3.5, crest: 7, mass: 9, chamber: 1.75, water: 3.25 },
  art: 'volcano', particles: 'embers',
  biomeFit: ['badlands'],
  // each passes every gate on its first attempt, base and ash (seed 3 does not: it needs 4 attempts), so a fallback is one attempt
  fallbackSeeds: [1, 2, 5],
  states: ['base', 'venting', 'stripped'],
};

export const HABITATS: Record<string, HabitatRecipe> = { [RIVER_GORGE.id]: RIVER_GORGE, [VOLCANIC_RIDGE.id]: VOLCANIC_RIDGE };

/** look a recipe up loosely ("river gorge", "volcano", "Cinder Crater"); `id:variant` selects a surface variant */
export function findHabitat(q: string): { id: string; variant: string } | undefined {
  const [base, variant = ''] = q.split(':');
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const n = norm(base);
  if (!n) return undefined;
  const alias: Record<string, string> = { gorge: 'river-gorge', river: 'river-gorge', shrine: 'river-gorge', volcano: 'volcanic-ridge', volcanic: 'volcanic-ridge', crater: 'volcanic-ridge' };
  for (const R of Object.values(HABITATS)) if (norm(R.id) === n || norm(R.name) === n) return { id: R.id, variant: R.variants[variant] ? variant : '' };
  for (const R of Object.values(HABITATS)) if (norm(R.id).startsWith(n) || norm(R.name).startsWith(n)) return { id: R.id, variant: R.variants[variant] ? variant : '' };
  if (alias[n]) return { id: alias[n], variant: HABITATS[alias[n]].variants[variant] ? variant : '' };
  return undefined;
}
