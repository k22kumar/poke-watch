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

export const SHOAL_CAVE: HabitatRecipe = {
  id: 'tidal-cave',
  name: 'Shoal Grotto',
  summary: 'A tidal sea cave on two connected floors: a sea inlet (the coastal mouth) runs into a lower chamber, a lower hall crosses the cave through it, and the point stands on the upper floor above the chamber. Low water leaves the hall and chamber dry as a short way to the point; high water floods them. Adaptation of Shoal Cave (Hoenn: a sea cave whose lower rooms flood and drain with the tide).',
  landform: 'shoal', support: 'ground', medium: 'water',
  refs: [
    { title: 'Bulbapedia — Shoal Cave', url: 'https://bulbapedia.bulbagarden.net/wiki/Shoal_Cave' },
  ],
  anchors: [
    { id: 'inlet', form: 'a sea inlet from the map edge into the cave: the coastal mouth', family: 'channel', provenance: 'canon', refs: [0], locked: true },
    { id: 'tide', form: 'a tide that rises and falls over one cave floor: the lower floor is dry at low water and flooded at high water', family: 'channel', provenance: 'canon', refs: [0], locked: true },
    { id: 'two-floors', form: 'two connected elevations: a lower floor at sea level and an upper floor above maximum tide, joined by ramps', family: 'cliff', provenance: 'canon', refs: [0], locked: true },
    { id: 'chamber', form: 'a lower chamber the inlet opens into, below the point', family: 'chamber', provenance: 'reinterpretation', refs: [0], locked: true },
    { id: 'gallery', form: 'a stable gallery on the upper floor along the hall\'s far wall, crossing the hall on a causeway', family: 'structure', provenance: 'original', refs: [], locked: false },
    { id: 'tunnel', form: 'a sheltered tunnel through the massif, dry at every tide', family: 'chamber', provenance: 'original', refs: [], locked: false },
    { id: 'tidewatch', form: 'a standing stone beside the point with broken rock stubs around it', family: 'structure', provenance: 'original', refs: [], locked: true },
  ],
  adaptations: [
    { feature: 'The tide runs on a fixed cycle of minutes, not hours of the day', why: 'A match must see both waters; the cycle is a pure function of stage time, so every replay agrees on it.' },
    { feature: 'The flooded hall is the optional shortcut, never a required route', why: 'Both sides keep two dry approaches at every tide; the hall trades a shorter walk for a tide clock.' },
    { feature: 'A causeway carries the gallery over the hall', why: 'The gallery reaches the point from a different angle than the tunnel without cutting the hall, which passes beneath it.' },
  ],
  vegetation: { trees: ['stalagmite'], fill: 'stalagmite', under: ['rock'], density: 0.85, moisture: [0, 1], clearings: 0 },
  props: { cover: ['boulder'], low: ['rock', 'rock', 'pillarBroken'], ruin: ['pillarBroken', 'rock', 'pillarBroken'], decor: [], landmark: 'Tidewatch Stone', landmarkProp: 'statue' },
  // floors are path and dirt (neither changes footing in any stage biome) so open floor reads against the grey rock tops;
  // the tidal floor is the bank surface, so the tide line shows at low water
  surfaces: { floor: T.path, rim: T.stone, route: T.path, ramp: T.dirt, bank: T.dirt, terrace: T.stone, shelf: T.stone },
  variants: {
    // paint only: the glimmering palette and motes; every surface and prop the same
    glimmer: { name: 'Glimmering grotto', art: 'chargestone', particles: 'motes' },
  },
  optional: [],
  seams: [
    { recipe: 'river-gorge', via: 'a shore and a cliff in the massif (water continues as the sea)' },
  ],
  freedoms: {
    hallY: [101, 106], hallW: [6, 7], contestDy: [20.5, 22.5], chamberR: [5, 6], stageX: [14, 18], stageDy: [1, 4],
    crossX: [40, 45], galleryOff: [5.5, 7], tunnelRise: [13, 18], inletW: [4.5, 5.5],
  },
  levels: { upper: 3, lower: 0, mass: 9, low: -0.5, high: 1, water: -0.5 },
  art: 'moon', particles: 'motes',
  biomeFit: ['frost', 'dusk'],
  fallbackSeeds: [1, 2, 3],
  states: ['base', 'flooded', 'stripped'],
  tide: { low: -0.5, high: 1 },
};

export const FOREST_CEMETERY: HabitatRecipe = {
  id: 'forest-cemetery',
  name: 'Memorial Ridge',
  summary: 'An old burial precinct on a dry ridge inside wild woodland: a walled terrace with a memorial forecourt, two or three staggered plot groups of grave markers laid along the contour, a broken perimeter wall with a gap at each approach, and a path along the lower wall and another along the upper contour for each side. Adaptation of Old Cemetery (Galar), Memorial Hill (Alola) and a forest approach (Eterna Forest, Old Chateau).',
  landform: 'ridge', support: 'ground', medium: 'water',
  refs: [
    { title: 'Bulbapedia — Old Cemetery', url: 'https://bulbapedia.bulbagarden.net/wiki/Old_Cemetery' },
    { title: 'Bulbapedia — Memorial Hill', url: 'https://bulbapedia.bulbagarden.net/wiki/Memorial_Hill' },
    { title: 'Bulbapedia — Eterna Forest', url: 'https://bulbapedia.bulbagarden.net/wiki/Eterna_Forest' },
  ],
  anchors: [
    { id: 'ridge', form: 'a dry ridge: a lower terrace carrying the precinct, two raised terraces on its contour', family: 'cliff', provenance: 'reinterpretation', refs: [1], locked: true },
    { id: 'plots', form: 'two or three staggered plot groups of grave markers laid along the contour, each sheared against its neighbour', family: 'structure', provenance: 'canon', refs: [0, 1], locked: true },
    { id: 'markers', form: 'grave markers in three heights (kerb, headstone, stele) with a lean', family: 'boulder', provenance: 'canon', refs: [0, 1], locked: true },
    { id: 'wall', form: 'a broken perimeter wall with a gap at each approach, and a broken wall round the forecourt', family: 'structure', provenance: 'reinterpretation', refs: [1], locked: true },
    { id: 'forecourt', form: 'a memorial forecourt on the lower terrace with a standing memorial beside the point', family: 'structure', provenance: 'original', refs: [], locked: true },
    { id: 'woodland', form: 'wild woodland around the ridge: tree stands, understory and thicket, a forest approach for each side', family: 'stand', provenance: 'reinterpretation', refs: [2], locked: false },
    { id: 'lower-path', form: 'a path from the woodland up onto the lower terrace and along the lower wall to the forecourt', family: 'relief', provenance: 'original', refs: [], locked: false },
    { id: 'upper-path', form: 'a path from the woodland up onto a raised terrace, along the upper contour behind a plot group and down into the forecourt', family: 'relief', provenance: 'original', refs: [], locked: false },
  ],
  adaptations: [
    { feature: 'The precinct is walled and terraced on a ridge, with two raised terraces', why: 'Old Cemetery and Memorial Hill are open hillsides; a terrace gives each side a second approach at a different height without a perch (every level step is under the perch threshold).' },
    { feature: 'Grave markers come in three heights that bracket the roster\'s muzzle extremes', why: 'Real stones differ in height; here the heights are chosen so a headstone is cover for the smallest bodies and not for the tallest, and a stele for neither. The collision is the height the sprite shows.' },
    { feature: 'Plots alternate their shear angle and stagger along the contour', why: 'A uniform lattice makes firing alleys with one dominant end (spec T26); opposing angles at each seam and a wall between plots break them.' },
    { feature: 'The grave family is terrain-grade cover (indestructible)', why: 'Sightlines built on markers must hold in every environment state; the stripped state removes only destructible props.' },
  ],
  vegetation: { trees: ['tree', 'tree2', 'round'], fill: 'thicket', under: ['bush', 'bushR'], density: 0.62, moisture: [0, 1], clearings: 0.1 },
  props: { cover: ['boulder', 'tree'], low: ['rock', 'stump', 'bush'], ruin: ['pillarBroken', 'pillar', 'pillarBroken', 'lantern'], decor: ['flowerW', 'mushroom'], landmark: 'Memorial Stone', landmarkProp: 'statue' },
  // the woodland floor is grass; the hill (every tile above 0.5 m) is dirt, so the precinct reads against the trees
  surfaces: { floor: T.grass, rim: T.dirt, route: T.path, ramp: T.dirt, bank: T.sand, terrace: T.stone, shelf: T.dirt },
  variants: {
    // paint only: the night palette and motes; every surface, tree and prop the same
    hollow: { name: 'Hollow memorial', art: 'dusk', particles: 'motes' },
  },
  optional: [],
  seams: [
    { recipe: 'river-gorge', via: 'the woodland continues as the gorge\'s rim forest (same climate and substrate: blend, spec R06)' },
    { recipe: 'viridian-forest', via: 'the same woodland, a ridge rising out of it' },
  ],
  freedoms: {
    ridgeY: [60, 66], ridgeA: [29, 31], ridgeB: [26, 28], terraceA: [14, 16], terraceB: [8, 9.5], upperX: [18, 20], upperY: [16, 18],
    stageX: [40, 44], stageY: [1, 5], bend: [1.5, 5], wallPiece: [7, 12], wallGap: [3.5, 6], wallOpen: [0, 3],
    plotCount: [2, 3.99], rows: [3, 3.99], cols: [3, 5.99], pitch: [3, 3.6], rowGap: [3, 3.4], wave: [0.2, 0.45], angle: [0.28, 0.55], plotR: [21.5, 24.5], jitter: [0, 0.35],
  },
  levels: { lower: 1.2, upper: 2.1, wall: 1.3 },
  art: 'forest', particles: 'petals',
  biomeFit: ['meadow', 'dusk'],
  // each passes every gate on its first attempt, base and hollow (seed 1 does not: its lane gate fails and it needs a second attempt)
  fallbackSeeds: [2, 3, 4],
  states: ['base', 'stripped'],
  graves: { mix: { kerb: 0.3, stone: 0.55, stele: 0.15 }, wide: 0.2, lean: 0.55 },
};

export const TROPICAL_LAGOON: HabitatRecipe = {
  id: 'tropical-lagoon',
  name: 'Cascade Lagoon',
  summary: 'A tropical island coast: a stream rises in a layered jungle, leaves the terrace over a short cascade into a plunge pool, splits round a sandy islet that carries the point on a raised terrace and widens into a sheltered lagoon, which drains through a barrier inlet to the sea. Dry beach and backshore ring the lagoon; jungle stands cover the terrace and the low inland ground. Adaptation of Lush Jungle (layered jungle), Brooklet Hill (a stream falling through pools) and Loop Lagoon (a sheltered lagoon shore).',
  landform: 'lagoon', support: 'ground', medium: 'water',
  refs: [
    { title: 'Bulbapedia — Lush Jungle', url: 'https://bulbapedia.bulbagarden.net/wiki/Lush_Jungle' },
    { title: 'Bulbapedia — Brooklet Hill', url: 'https://bulbapedia.bulbagarden.net/wiki/Brooklet_Hill' },
    { title: 'Bulbapedia — Loop Lagoon', url: 'https://bulbapedia.bulbagarden.net/wiki/Loop_Lagoon' },
  ],
  anchors: [
    { id: 'catchment', form: 'a stream from the island\'s wet upland: it rises at the north edge, crosses the jungle terrace and drains, over the cascade, the pool, the arms and the lagoon, to the inlet at the map edge', family: 'channel', provenance: 'canon', refs: [1], locked: true },
    { id: 'cascade', form: 'a short cascade off the terrace\'s south face into a plunge pool', family: 'channel', provenance: 'canon', refs: [1], locked: true },
    { id: 'jungle', form: 'layered jungle: stands on the terrace and the low inland ground, understory beneath, a dry shore band kept clear', family: 'stand', provenance: 'canon', refs: [0], locked: false },
    { id: 'terrace', form: 'a raised jungle terrace with a canopy edge, and a bluff along each arm\'s outer bank', family: 'cliff', provenance: 'reinterpretation', refs: [0], locked: true },
    { id: 'lagoon', form: 'a sheltered lagoon below the islet, ringed by a dry beach and a backshore, drained by a barrier inlet', family: 'channel', provenance: 'canon', refs: [2], locked: true },
    { id: 'shore', form: 'a dry beach and backshore: bands of sand and then grass and scrub from the waterline inland', family: 'relief', provenance: 'reinterpretation', refs: [2], locked: false },
    { id: 'islet', form: 'a sandy islet at the cascade\'s foot with the point on a raised terrace', family: 'structure', provenance: 'original', refs: [], locked: true },
    { id: 'crossings', form: 'a low bridge over the arm on the shore side and a terrace-height causeway over it on the jungle side', family: 'structure', provenance: 'reinterpretation', refs: [1], locked: false },
    { id: 'stacks', form: 'rock stacks on the beach that break the long shore sightline', family: 'boulder', provenance: 'original', refs: [], locked: false },
  ],
  adaptations: [
    { feature: 'The point stands on a sandy islet where the stream\'s two arms meet the lagoon', why: 'Brooklet Hill\'s falling stream and Loop Lagoon\'s sheltered shore are joined so both sides cross water by a dry bridge or causeway.' },
    { feature: 'A jungle bluff along each arm carries the inland causeway at terrace height', why: 'A screened approach through the canopy that arrives from the north while the shore bank arrives from the south.' },
    { feature: 'The lagoon is tideless and its shelf is scenery', why: 'The tide is its own system (Shoal Grotto); here the shallow rim carries lilies, and nothing a route needs lies under water.' },
    { feature: 'Rock stacks stand on the beach', why: 'A long open shore sees both of a side\'s approaches unless terrain breaks it; stacks are terrain, so the break holds when every prop is gone.' },
  ],
  vegetation: { trees: ['round', 'tree2', 'tree'], fill: 'thicket', under: ['bushR', 'bush', 'bushB'], density: 1.5, moisture: [0, 1], clearings: 0.04, dry: { within: 14, below: 1.2 }, canopy: { within: 9, boost: 0.4 } },
  props: { cover: ['boulder'], low: ['rock', 'log', 'rock', 'bush'], ruin: ['pillarBroken', 'pillar', 'pillarBroken'], decor: ['flowerR', 'flowerY', 'flowerB'], landmark: 'Cascade Totem', landmarkProp: 'statue' },
  surfaces: { floor: T.grass, rim: T.grass, route: T.path, ramp: T.dirt, bank: T.sand, terrace: T.stone, shelf: T.dirt },
  variants: {
    // paint only: the dusk palette and motes (fireflies over the lagoon)
    dusk: { name: 'Lagoon at dusk', art: 'dusk', particles: 'motes' },
  },
  optional: [],
  seams: [
    { recipe: 'river-gorge', via: 'the stream continues upstream as the gorge\'s river: same water, a rising rim and a falls' },
    { recipe: 'tidal-cave', via: 'the lagoon\'s inlet opens to the same coast: a sea cave in the headland beside the barrier' },
  ],
  freedoms: {
    streamShift: [-3, 3], bend: [1.5, 3.5], bendFreq: [0.6, 1.1], lipY: [52, 57], poolR: [5.5, 7], islandRx: [11.5, 13], islandRy: [10.5, 12], armW: [4, 5], islandGap: [2, 3.5],
    lagoonRx: [29, 34], lagoonRy: [12.5, 15], curve: [-4, 6], inletW: [4.5, 5.5], inletBend: [-5, 5], canopy: [1.5, 3.5], bluffW: [16, 20], bluffEnd: [0.35, 0.55], beachW: [3, 4.5],
    stageX: [15, 19], stageDy: [3, 8],
  },
  levels: { terrace: 2.5, shore: 0.4, water: -0.5, apron: 1.3 },
  art: 'tropic', particles: 'petals',
  biomeFit: ['meadow', 'dusk'],
  fallbackSeeds: [1, 2, 3],
  states: ['base', 'frozen', 'stripped'],
};

export const SPEAR_SANCTUARY: HabitatRecipe = {
  id: 'spear-sanctuary',
  name: 'Spear Sanctuary',
  summary: 'A legendary sanctuary on a mountain: a foothill with a tarn, a threshold terrace, a colonnade forecourt and a focal platform, one tier above the next along a single processional axis. The Hold is the court tangent to the focal plinth. Each side climbs an external switchback cut into the massif\'s flank, or a dry bedrock gallery that enters the platform through a door in its flank; a ruined balcony on the rock shoulder is the strongest upper position. Adaptation of Mt. Coronet (the mountain, its interior), Spear Pillar (the summit colonnade and focal platform) and the Temple of Sinnoh (axial thresholds, stairs and a focal platform).',
  landform: 'sanctuary', support: 'ground', medium: 'water',
  refs: [
    { title: 'Bulbapedia — Mt. Coronet', url: 'https://bulbapedia.bulbagarden.net/wiki/Mount_Coronet' },
    { title: 'Bulbapedia — Spear Pillar', url: 'https://bulbapedia.bulbagarden.net/wiki/Spear_Pillar' },
    { title: 'Bulbapedia — Temple of Sinnoh', url: 'https://bulbapedia.bulbagarden.net/wiki/Temple_of_Sinnoh' },
  ],
  anchors: [
    { id: 'slope', form: 'a tiered mountain slope: a foothill, a threshold terrace, a forecourt and a focal platform, each one tier above the last, with solid rock between and beside them', family: 'cliff', provenance: 'canon', refs: [0, 1], locked: true },
    { id: 'axis', form: 'one processional axis from the foothill to the focal platform: a stair up to the forecourt through a pair of pylons, the forecourt lane, a stair up to the platform', family: 'structure', provenance: 'reinterpretation', refs: [1, 2], locked: true },
    { id: 'colonnade', form: 'rows of columns either side of the forecourt lane and the platform court, with fallen places', family: 'structure', provenance: 'canon', refs: [1], locked: false },
    { id: 'plinth', form: 'a solid focal plinth with the landmark on its south face; the contest court tangent to it', family: 'structure', provenance: 'reinterpretation', refs: [1, 2], locked: true },
    { id: 'gallery', form: 'a dry bedrock gallery climbing inside the massif from a mouth at its foot to a door onto the platform', family: 'chamber', provenance: 'canon', refs: [0], locked: false },
    { id: 'switchback', form: 'an external switchback cut into the massif\'s flank to the threshold terrace', family: 'relief', provenance: 'reinterpretation', refs: [0], locked: false },
    { id: 'tarn', form: 'a snowmelt tarn on the foothill between the two stagings', family: 'channel', provenance: 'reinterpretation', refs: [0], locked: true },
    { id: 'balcony', form: 'a ruined upper balcony on a rock shoulder beside the platform, with a stair up from it and a short drop back', family: 'cliff', provenance: 'original', refs: [], locked: true },
    { id: 'outcrops', form: 'rock outcrops on the foothill and conifer stands at the treeline', family: 'boulder', provenance: 'original', refs: [], locked: false },
  ],
  adaptations: [
    { feature: 'The Hold is the court beside the plinth, not the summit itself', why: 'The specification puts the objective in a neutral court tangent to the plinth when the altar\'s scale would impair the contest; the plinth stays clear of the contest volume and breaks central visibility.' },
    { feature: 'The gallery runs inside the massif from the foothill to a door on the platform', why: 'An independent dry approach that enters at the platform\'s height from a different direction than the external switchback, which arrives by the axial stairs.' },
    { feature: 'A ruined balcony on the shoulder is the strongest upper position', why: 'Every contest needs a high position; here it is reached from the platform by a stair (a counter-angle both sides can take), has a short drop for a quick exit, and a wall screens it from the gallery\'s door.' },
    { feature: 'A snowmelt tarn at the foot', why: 'Water on the foothill keeps the two stagings out of each other\'s line and is never on a route.' },
  ],
  vegetation: { trees: ['tree2', 'tree'], fill: 'thicket', under: ['rock', 'bush'], density: 0.3, moisture: [0, 1], clearings: 0 },
  props: { cover: ['boulder'], low: ['rock', 'rock', 'pillarBroken'], ruin: ['pillarBroken', 'pillar', 'pillarBroken'], decor: [], landmark: 'Spear Pillar', landmarkProp: 'statue' },
  // path and dirt change footing in no stage biome, so the geometry plays the same on every stage
  surfaces: { floor: T.path, rim: T.stone, route: T.path, ramp: T.dirt, bank: T.dirt, terrace: T.stone, shelf: T.stone },
  variants: {
    // paint only: the frost palette, snow and ice pines (2×2 walls like the trees they replace)
    snow: { name: 'Snowbound sanctuary', art: 'frost', particles: 'snow', trees: ['icepine', 'icepine', 'tree2'] },
  },
  optional: [],
  seams: [
    { recipe: 'volcanic-ridge', via: 'a bare rock shelf and a drop in elevation (conflicting climates, spec R06)' },
  ],
  freedoms: {
    axis: [-2.5, 2.5], footV: [99, 102], thrD: [12, 14], courtD: [21, 24], platD: [28, 31], thrHalf: [30, 33], courtHalf: [22, 26], platHalf: [16, 19],
    plinthW: [8, 11], plinthD: [4.5, 6], plinthV: [5, 7], holdShift: [-2, 2], plinthRise: [2.2, 2.8], spearRise: [4.2, 5],
    balW: [6.5, 8.5], balLen: [13, 17], balV: [9, 11], balRise: [0, 0.5],
    courtW: [9, 12], courtDp: [9, 12], courtV: [5, 8], courtGap: [0.2, 0.8], courtGapW: [4.5, 6.5],
    tarnU: [-6, 6], tarnR: [5.5, 7], tarnV: [10, 14], galU: [12, 14], sbOff: [8.5, 9.5], hair: [6, 7], stageU: [32, 38], stageV: [6, 12],
    legUp: [9.5, 11.5], galGrade: [0.38, 0.42], doorRear: [3, 5.5], doorFlank: [14, 22],
    gateWall: [3, 5], outcropU: [20, 26], outcropV: [6, 12], pitch: [3.8, 4.6], broken: [0.05, 0.2], colRise: [2.4, 3], flankPitch: [5, 6.5], flankRise: [2.6, 3.2],
  },
  levels: { thresh: 3, court: 6, focal: 9, balcony: 11.7, mass: 14.4, water: -0.3 },
  art: 'dusk', particles: 'motes',
  biomeFit: ['frost', 'dusk'],
  fallbackSeeds: [1, 2, 3],
  states: ['base', 'stripped'],
};

export const HABITATS: Record<string, HabitatRecipe> = { [RIVER_GORGE.id]: RIVER_GORGE, [VOLCANIC_RIDGE.id]: VOLCANIC_RIDGE, [SHOAL_CAVE.id]: SHOAL_CAVE, [FOREST_CEMETERY.id]: FOREST_CEMETERY, [TROPICAL_LAGOON.id]: TROPICAL_LAGOON, [SPEAR_SANCTUARY.id]: SPEAR_SANCTUARY };

/** look a recipe up loosely ("river gorge", "volcano", "Cinder Crater"); `id:variant` selects a surface variant */
export function findHabitat(q: string): { id: string; variant: string } | undefined {
  const [base, variant = ''] = q.split(':');
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const n = norm(base);
  if (!n) return undefined;
  const alias: Record<string, string> = { gorge: 'river-gorge', river: 'river-gorge', shrine: 'river-gorge', volcano: 'volcanic-ridge', volcanic: 'volcanic-ridge', crater: 'volcanic-ridge', shoal: 'tidal-cave', shoalcave: 'tidal-cave', tide: 'tidal-cave', grotto: 'tidal-cave', cemetery: 'forest-cemetery', graveyard: 'forest-cemetery', memorial: 'forest-cemetery', memorialhill: 'forest-cemetery', oldcemetery: 'forest-cemetery', lagoon: 'tropical-lagoon', tropical: 'tropical-lagoon', jungle: 'tropical-lagoon', island: 'tropical-lagoon', cascade: 'tropical-lagoon', loop: 'tropical-lagoon', coronet: 'spear-sanctuary', mountcoronet: 'spear-sanctuary', spear: 'spear-sanctuary', spearpillar: 'spear-sanctuary', pillar: 'spear-sanctuary', sinnoh: 'spear-sanctuary', temple: 'spear-sanctuary', sanctuary: 'spear-sanctuary', summit: 'spear-sanctuary' };
  for (const R of Object.values(HABITATS)) if (norm(R.id) === n || norm(R.name) === n) return { id: R.id, variant: R.variants[variant] ? variant : '' };
  for (const R of Object.values(HABITATS)) if (norm(R.id).startsWith(n) || norm(R.name).startsWith(n)) return { id: R.id, variant: R.variants[variant] ? variant : '' };
  if (alias[n]) return { id: alias[n], variant: HABITATS[alias[n]].variants[variant] ? variant : '' };
  return undefined;
}
