// Mt. Moon (Kanto). Cave archetype: stacked floors joined by ladders, rock chambers, fossils and the Moon Stone.
import { HAB } from '../../rules/habitats';
import { T } from '../tiles';
import type { LocationDef } from './types';

export const MT_MOON: LocationDef = {
  id: 'mt-moon',
  name: 'Mt. Moon',
  region: 'Kanto',
  summary: 'A mountain cave between Route 3 and Route 4 (Pewter to Cerulean): several floors joined by ladders, Zubat and Geodude in the dark, Paras on the cave floor, fossils on the deepest floor, and the Moon Stone at its summit square.',
  canon: {
    facts: [
      { fact: 'Connects Route 3 and Route 4 between Pewter City and Cerulean City.', refs: [0] },
      { fact: 'A cave of several floors (1F, B1F, B2F) joined by ladders.', refs: [0, 1] },
      { fact: 'Wild Zubat, Geodude, Paras and Clefairy live inside (Gen I).', refs: [0, 2] },
      { fact: 'On B2F a Super Nerd guards the Dome and Helix Fossils; Team Rocket digs for fossils on the basement floors.', refs: [0, 1] },
      { fact: 'Moon Stones are found in the cave; in Gold/Silver/Crystal and HeartGold/SoulSilver the summit, Mt. Moon Square, holds a large Moon Stone where Clefairy dance on Monday nights.', refs: [0] },
    ],
    identity: [
      'rock cavern walls on every side (an underground place)',
      'distinct floors at different depths joined by climbs',
      'a fossil dig on the deepest floor',
      'the Moon Stone on the highest floor',
    ],
  },
  creative: [
    { feature: 'Floors as open tiers 3.5 m apart joined by carved ramps and stairs', why: 'This game has no ladders or loading between floors; ramps keep floors stacked and contestable in one space.' },
    { feature: 'Open roof (a lit cavern)', why: 'The third-person camera needs to see down into chambers; darkness, fog and rock walls carry the underground mood.' },
    { feature: 'Natural rock bridges over dark shafts', why: 'Joins two upper chambers across the cave; an exposed crossing above a fall.' },
    { feature: 'Rubble step shortcuts (player only)', why: 'Broken-rock climbs a nod to Rock Smash / Rock Climb, faster than walking the ramps.' },
    { feature: 'Moss and mushroom patches on the floors', why: 'Habitat for the Paras that canonically live in the cave; their placement is interpretation.' },
  ],
  refs: [
    { title: 'Bulbapedia — Mt. Moon', url: 'https://bulbapedia.bulbagarden.net/wiki/Mt._Moon' },
    { title: 'Bulbapedia — Walkthrough: Pokémon Red and Blue, Part 4', url: 'https://bulbapedia.bulbagarden.net/wiki/Walkthrough:Pok%C3%A9mon_Red_and_Blue/Part_4' },
    { title: 'RankedBoost — FireRed & LeafGreen Mt. Moon', url: 'https://rankedboost.com/pokemon/location/firered-leafgreen/mt-moon/' },
  ],
  gameplay: {
    tierGap: 3.5, tiers: 3,
    arenaR: [9, 11], chamberR: [6, 8], nookR: [3, 4],
    pathW: [4, 5], trailW: [4, 4], rampW: 4, bridgeW: 3,
    terrace: 0.7, slope: 0.5, dropNav: 4, spawnOpen: 8, hubTier: 1,
  },
  freedoms: {
    zones: [8, 10], loops: [2, 4], raised: [0.45, 0.7], bridges: [1, 2], hops: [1, 3], entrances: [3, 4],
    landforms: ['descent', 'terraces'],
  },
  enclosure: { kind: 'rock', wallRise: 2.5, chasm: 'abyss' },
  surface: { floor: T.dirt, path: T.sand, high: T.dirt, ramp: T.sand, tallGrass: 0, dots: 0, bridge: 'stone' },
  props: {
    mass: [], massFill: 'stalagmite',
    cover: ['boulder', 'stalagmite', 'stalagmite'], low: ['rock'], lip: ['rock', 'stalagmite'],
    decor: ['mushroom'], rimRate: 0.1, stepMark: 'ladder',
  },
  landmarks: [
    { id: 'moon-square', name: 'Moon Stone', stamp: 'moonstone', zone: ['chamber', 'arena', 'boss'], tier: 'top', count: [1, 1], canon: true },
    { id: 'fossil-dig', name: 'Fossil Dig', stamp: 'dig', zone: ['chamber', 'arena', 'nook'], tier: 'low', count: [1, 1], canon: true },
    { id: 'tunnel', name: 'Cave Tunnel', stamp: 'tunnel', zone: ['entrance'], tier: 'any', count: [2, 4], canon: true },
  ],
  habitat: { floor: HAB.rock | HAB.dry, high: HAB.rock, patch: HAB.forest | HAB.water },
  art: 'moon', particles: 'dust', bodies: 3,
  decks: { shelves: [2, 3], depth: [2, 3], run: [5, 12] },
  biomeFit: ['dusk'],
};
