// Chargestone Cave (Unova). Magnetic cave archetype: charged crystals, floating stones, layered cavern shelves.
import { HAB } from '../../rules/habitats';
import { T } from '../tiles';
import type { LocationDef } from './types';

export const CHARGESTONE_CAVE: LocationDef = {
  id: 'chargestone-cave',
  name: 'Chargestone Cave',
  region: 'Unova',
  summary: 'A cave between Route 6 and Mistralton City where a special magnetic field makes electrically charged stones float; glowing crystals fill the passages and Electric, Bug and Steel Pokémon (Joltik, Klink, Ferroseed, Tynamo) live there.',
  canon: {
    facts: [
      { fact: 'Lies between Route 6 and Mistralton City in Unova (Black/White, Black 2/White 2).', refs: [0, 1] },
      { fact: 'Electrically charged stones float in the air because of the cave\'s magnetism; some block passages and must be pushed toward larger magnetic crystals embedded in the ground.', refs: [0, 2, 3] },
      { fact: 'The cave has three floors (1F, B1F, B2F).', refs: [0, 2] },
      { fact: 'Wild Joltik and Klink are most common; Ferroseed, Boldore, Drilbur and the rare Tynamo also appear.', refs: [0, 4] },
      { fact: 'Bulbapedia lists the cave among places with a special magnetic field.', refs: [5] },
    ],
    identity: [
      'blue glowing crystal clusters in every space',
      'large magnetic crystals with loose charged stones beside them',
      'layered cavern floors (three levels)',
      'dark rock walls; no vegetation',
    ],
  },
  creative: [
    { feature: 'Charged stones as Push / Hold bodies', why: 'The canonical stone-pushing puzzle maps onto this game\'s body system: shove them into the horde.' },
    { feature: 'Floors as open shelves 3 m apart joined by ramps', why: 'Keeps the three canonical levels as one contestable space under the third-person camera.' },
    { feature: 'Crystal bridges over dark rifts', why: 'An exposed crossing between upper shelves; the crystal dressing is interpretation.' },
    { feature: 'Crystal step shortcuts (player only)', why: 'Two half-height crystal ledges: faster climbs that enemies walk around.' },
  ],
  refs: [
    { title: 'Bulbapedia — Chargestone Cave', url: 'https://bulbapedia.bulbagarden.net/wiki/Chargestone_Cave' },
    { title: 'Serebii — Pokéarth: Chargestone Cave', url: 'https://serebii.net/pokearth/unova/chargestonecave.shtml' },
    { title: 'Thonky — Pokémon Black/White: Chargestone Cave', url: 'https://thonky.com/pokemon-black-white/chargestone-cave' },
    { title: 'Game Guides — Pokémon Black/White walkthrough: Chargestone Cave', url: 'https://gamerguides.com/pokemon-black-white/guide/story-walkthrough/gym-6/chargestone-cave' },
    { title: 'RankedBoost — Black & White Chargestone Cave', url: 'https://rankedboost.com/pokemon/location/black-white/chargestone-cave/' },
    { title: 'Bulbapedia — Special magnetic field', url: 'https://bulbapedia.bulbagarden.net/wiki/Special_magnetic_field' },
  ],
  gameplay: {
    tierGap: 3, tiers: 3,
    arenaR: [9, 12], chamberR: [6, 9], nookR: [3, 4],
    pathW: [4, 5], trailW: [4, 4], rampW: 4, bridgeW: 3,
    terrace: 0.8, slope: 0.5, dropNav: 3.5, spawnOpen: 8, hubTier: 0,
  },
  freedoms: {
    zones: [9, 12], loops: [3, 5], raised: [0.45, 0.7], bridges: [2, 3], hops: [2, 4], entrances: [3, 4],
    landforms: ['terraces', 'twin', 'descent'],
  },
  enclosure: { kind: 'rock', wallRise: 2.5, chasm: 'abyss' },
  surface: { floor: T.dirt, path: T.sand, high: T.dirt, ramp: T.sand, tallGrass: 0, dots: 0, bridge: 'stone' },
  props: {
    mass: [], massFill: 'crystal',
    cover: ['magnetite', 'crystal', 'crystal', 'boulder'], low: ['rock', 'rock'], lip: ['crystal', 'rock'],
    decor: [], rimRate: 0.3,
  },
  landmarks: [
    { id: 'magnet-field', name: 'Magnetic Crystal', stamp: 'magnet', zone: ['arena', 'chamber', 'boss'], tier: 'any', count: [3, 4], canon: true },
    { id: 'tunnel', name: 'Cave Passage', stamp: 'tunnel', zone: ['entrance'], tier: 'any', count: [2, 4], canon: true },
  ],
  habitat: { floor: HAB.rock, high: HAB.rock | HAB.dry, patch: HAB.rock },
  art: 'chargestone', particles: 'sparks', bodies: 6,
  decks: { shelves: [2, 3], depth: [2, 3], run: [5, 12] },
  biomeFit: ['badlands'],
};
