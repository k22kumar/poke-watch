// Viridian Forest (Kanto). Forest archetype: dense tree walls, winding trails, tall-grass clearings.
import { HAB } from '../../rules/habitats';
import { T } from '../tiles';
import type { LocationDef } from './types';

export const VIRIDIAN_FOREST: LocationDef = {
  id: 'viridian-forest',
  name: 'Viridian Forest',
  region: 'Kanto',
  summary: 'A dense natural maze of trees on Route 2 between Viridian City and Pewter City, full of tall grass, Bug-type Pokémon and Bug Catchers.',
  canon: {
    facts: [
      { fact: 'Lies on Route 2 between Viridian City (south) and Pewter City (north), entered through gatehouses at both ends.', refs: [0, 1] },
      { fact: 'A dense forest whose trees form a natural maze; paths wind between walls of trees.', refs: [0, 2] },
      { fact: 'Tall grass throughout; wild Bug-type Pokémon (Caterpie, Weedle, Metapod, Kakuna) and a rare Pikachu.', refs: [0, 3] },
      { fact: 'Bug Catchers train here; wooden "Trainer Tips" signs give advice (e.g. weaken a Pokémon before catching it, avoid grass when your team is weak).', refs: [0, 2] },
      { fact: 'Items lie hidden in grass at the bases of trees (e.g. a Razz Berry in Let\'s Go).', refs: [0] },
    ],
    identity: [
      'walls of tall trees enclosing every space (no open sky plains)',
      'narrow winding trails between clearings',
      'tall-grass patches in clearings and along trails',
      'Trainer Tips signs at junctions',
      'gatehouse entrances at the north and south edges',
    ],
  },
  creative: [
    { feature: 'Raised mossy bluffs and root banks (tiers 3 m apart)', why: 'The games draw the forest flat; tiers add high ground and drops without changing what the forest is.' },
    { feature: 'Fallen-tree log bridges across wooded gullies', why: 'Joins two raised banks with an exposed crossing; a forest-native way to give a skyway.' },
    { feature: 'Rock-step shortcuts up the bluffs (player only)', why: 'Two 1.5 m hops, a nod to Rock Climb: a faster way up that enemies must walk around.' },
    { feature: 'A great old tree in the boss clearing', why: 'A readable landmark and cover piece; no specific canonical tree is claimed.' },
    { feature: 'Bug Catcher camps (crates, a sign)', why: 'Environmental storytelling for the trainers who canonically train here.' },
  ],
  refs: [
    { title: 'Bulbapedia — Viridian Forest', url: 'https://bulbapedia.bulbagarden.net/wiki/Viridian_Forest' },
    { title: 'Bulbapedia — Route 2 (Kanto)', url: 'https://bulbapedia.bulbagarden.net/wiki/Kanto_Route_2' },
    { title: 'StrategyWiki — Pokémon FireRed and LeafGreen/Viridian Forest', url: 'https://strategywiki.org/wiki/Pok%C3%A9mon_FireRed_and_LeafGreen/Viridian_Forest' },
    { title: 'StrategyWiki — Pokémon Red and Blue/Viridian Forest', url: 'https://strategywiki.org/wiki/Pok%C3%A9mon_Red_and_Blue/Viridian_Forest' },
  ],
  gameplay: {
    tierGap: 3, tiers: 2,
    arenaR: [9, 12], chamberR: [6, 8], nookR: [3, 4],
    pathW: [4, 5], trailW: [2, 3], rampW: 4, bridgeW: 3,
    terrace: 0.75, slope: 0.5, dropNav: 3.5, spawnOpen: 8, hubTier: 0,
  },
  freedoms: {
    zones: [8, 11], loops: [3, 5], raised: [0.3, 0.5], bridges: [1, 2], hops: [2, 4], entrances: [3, 5],
    landforms: ['ridge', 'twin'],
  },
  enclosure: { kind: 'forest', wallRise: 0, chasm: 'gully' },
  surface: { floor: T.grass, path: T.dirt, high: T.grass, ramp: T.dirt, tallGrass: 0.34, dots: 0.12, bridge: 'wood' },
  props: {
    mass: ['tree', 'tree2', 'round'], massFill: 'thicket',
    cover: ['tree', 'round', 'boulder'], low: ['bush', 'log', 'stump', 'rock'], lip: ['bush', 'rock', 'log'],
    decor: ['flowerY', 'flowerW', 'tall'],
  },
  landmarks: [
    { id: 'gatehouse', name: 'Route 2 Gate', stamp: 'gate', zone: ['entrance'], tier: 'low', count: [2, 2], canon: true },
    { id: 'tips', name: 'Trainer Tips', stamp: 'tips', zone: ['arena', 'chamber', 'hub'], tier: 'any', count: [2, 3], canon: true },
    { id: 'great-tree', name: 'Old Forest Giant', stamp: 'greatTree', zone: ['boss'], tier: 'any', count: [1, 1], canon: false },
    { id: 'bug-camp', name: 'Bug Catcher Camp', stamp: 'camp', zone: ['chamber', 'arena'], tier: 'any', count: [1, 1], canon: false },
  ],
  habitat: { floor: HAB.forest | HAB.grass, high: HAB.forest | HAB.meadow, patch: HAB.grass },
  art: 'forest', particles: 'petals', bodies: 0,
  decks: { shelves: [1, 2], depth: [2, 3], run: [5, 10] },
  biomeFit: ['meadow'],
};
