// Poke-Watch's original creatures. No longer in the survivor game (which plays with Pokémon from
// src/content/pokedex.ts); kept for the Maplebrook overworld, whose following partners and
// wild encounters are baked from these designs.
import type { SpeciesDef, Stats } from './species';

const S = (hp: number, atk: number, def: number, spa: number, spd: number, spe: number): Stats => ({ hp, atk, def, spa, spd, spe });

export const ORIGINALS: SpeciesDef[] = [
  // ---------------- playable lines ----------------
  {
    id: 'kindlamb', name: 'Kindlamb', elements: ['blaze'], stats: S(55, 62, 50, 64, 50, 62), height: 1.35, art: 'kindlamb',
    playable: true, blurb: 'A lamb whose wool smoulders like banked coals. Warm, stubborn, loyal.',
    starter: 'ember_orb', evolvesTo: 'pyroram', evolveLevel: 16,
    learnset: [[3, 'flame_breath'], [6, 'blaze_rush'], [9, 'cinder_trail'], [13, 'magma_bomb'], [18, 'inferno_nova'], [24, 'sun_meteor'], [28, 'sunny_day']],
  },
  {
    id: 'pyroram', name: 'Pyroram', elements: ['blaze', 'stone'], stats: S(80, 95, 80, 85, 65, 70), height: 2.1, art: 'pyroram',
    learnset: [[20, 'boulder_bomb'], [26, 'rockfall']],
  },
  {
    id: 'rayling', name: 'Rayling', elements: ['tide'], stats: S(52, 50, 55, 66, 62, 66), height: 1.2, art: 'rayling', flying: true,
    playable: true, blurb: 'A pocket-sized ray that waddles on fin-tips and glides on warm air.',
    starter: 'bubble_shot', evolvesTo: 'mantide', evolveLevel: 16,
    learnset: [[3, 'tide_pulse'], [6, 'wave_rush'], [9, 'spring_drain'], [13, 'riptide_vortex'], [18, 'hydro_beam'], [24, 'rain_call']],
  },
  {
    id: 'mantide', name: 'Mantide', elements: ['tide', 'gale'], stats: S(75, 70, 75, 100, 85, 90), height: 1.9, art: 'mantide', flying: true,
    learnset: [[20, 'sky_seeker'], [26, 'cyclone_storm']],
  },
  {
    id: 'mosscub', name: 'Mosscub', elements: ['bloom'], stats: S(64, 62, 62, 52, 55, 48), height: 1.3, art: 'mosscub',
    playable: true, blurb: 'A sleepy cub with a garden growing on its back. Hits like a falling log.',
    starter: 'vine_strike', evolvesTo: 'grovebear', evolveLevel: 16,
    learnset: [[3, 'leaf_rang'], [6, 'thorn_needle'], [9, 'spore_orbit'], [13, 'sap_drain'], [18, 'grove_slam'], [24, 'petal_storm'], [27, 'root_snare']],
  },
  {
    id: 'grovebear', name: 'Grovebear', elements: ['bloom', 'brawl'], stats: S(100, 105, 90, 70, 75, 60), height: 2.3, art: 'grovebear',
    learnset: [[20, 'brawl_punch'], [26, 'power_rush']],
  },
  {
    id: 'hootz', name: 'Hootz', elements: ['volt', 'gale'], stats: S(48, 52, 45, 68, 55, 75), height: 1.15, art: 'hootz', flying: true,
    playable: true, blurb: 'A round owlet whose ear-tufts crackle before a storm. Never sleeps.',
    starter: 'zap_bolt', evolvesTo: 'stormowl', evolveLevel: 16,
    learnset: [[3, 'static_aura'], [6, 'spark_rush'], [9, 'air_slash'], [13, 'spark_needle'], [18, 'ion_beam'], [24, 'volt_smite'], [27, 'tailwind_buff']],
  },
  {
    id: 'stormowl', name: 'Stormowl', elements: ['volt', 'gale'], stats: S(70, 75, 65, 105, 75, 110), height: 1.9, art: 'stormowl', flying: true,
    learnset: [[20, 'wind_twister'], [26, 'cyclone_storm']],
  },
  {
    id: 'frostkit', name: 'Frostkit', elements: ['frost'], stats: S(50, 60, 48, 60, 52, 80), height: 1.2, art: 'frostkit',
    playable: true, blurb: 'A snow hare with icicle ears. Leaves a little frost on everything it touches.',
    starter: 'ice_shard', evolvesTo: 'glaciare', evolveLevel: 16,
    learnset: [[3, 'snow_orb'], [6, 'frost_breath'], [9, 'glacier_spin'], [13, 'icicle_barrage'], [18, 'frost_nova'], [24, 'hail_meteor']],
  },
  {
    id: 'glaciare', name: 'Glaciare', elements: ['frost', 'fae'], stats: S(72, 88, 70, 92, 75, 115), height: 2.0, art: 'glaciare',
    learnset: [[20, 'moon_orb'], [26, 'glimmer_aura']],
  },
  {
    id: 'psiquid', name: 'Psiquid', elements: ['mind'], stats: S(50, 40, 50, 75, 70, 60), height: 1.2, art: 'psiquid', flying: true,
    playable: true, blurb: 'A floating squidlet that hums thoughts at people. The gem is a third eye.',
    starter: 'psi_orb', evolvesTo: 'cerebrosquid', evolveLevel: 16,
    learnset: [[3, 'mind_seeker'], [6, 'astral_orbit'], [9, 'focus_buff'], [13, 'psi_beam'], [18, 'mind_nova'], [24, 'mind_smite']],
  },
  {
    id: 'cerebrosquid', name: 'Cerebrosquid', elements: ['mind', 'wisp'], stats: S(75, 55, 70, 120, 95, 80), height: 2.0, art: 'cerebrosquid', flying: true,
    learnset: [[20, 'hex_seeker'], [26, 'phantom_orbit']],
  },

  // ---------------- wild creatures ----------------
  { id: 'burrowbun', name: 'Burrowbun', elements: ['plain'], stats: S(40, 45, 35, 25, 30, 55), height: 0.95, art: 'burrowbun', behaviour: 'chase' },
  { id: 'pebblet', name: 'Pebblet', elements: ['stone'], stats: S(50, 60, 90, 25, 35, 25), height: 0.9, art: 'pebblet', behaviour: 'tank' },
  { id: 'gnatling', name: 'Gnatling', elements: ['hive', 'gale'], stats: S(25, 35, 25, 25, 25, 85), height: 0.8, art: 'gnatling', flying: true, behaviour: 'swarm' },
  { id: 'mudpup', name: 'Mudpup', elements: ['quake'], stats: S(50, 60, 45, 30, 40, 55), height: 1.0, art: 'mudpup', behaviour: 'chase' },
  { id: 'spitfern', name: 'Spitfern', elements: ['bloom', 'venom'], stats: S(45, 30, 50, 60, 50, 30), height: 1.2, art: 'spitfern', behaviour: 'ranged', shot: 'venom' },
  { id: 'bogtoad', name: 'Bogtoad', elements: ['venom', 'tide'], stats: S(60, 55, 55, 50, 50, 40), height: 1.0, art: 'bogtoad', behaviour: 'chase' },
  { id: 'cindercrab', name: 'Cindercrab', elements: ['blaze'], stats: S(50, 70, 75, 30, 40, 40), height: 0.95, art: 'cindercrab', behaviour: 'chase' },
  { id: 'cinderwisp', name: 'Cinderwisp', elements: ['blaze', 'wisp'], stats: S(40, 30, 35, 70, 50, 60), height: 1.0, art: 'cinderwisp', flying: true, behaviour: 'ranged', shot: 'blaze' },
  { id: 'sparkmite', name: 'Sparkmite', elements: ['volt', 'hive'], stats: S(40, 65, 40, 40, 35, 70), height: 0.85, art: 'sparkmite', behaviour: 'charger' },
  { id: 'frostling', name: 'Frostling', elements: ['frost'], stats: S(40, 30, 40, 70, 60, 50), height: 1.05, art: 'frostling', flying: true, behaviour: 'ranged', shot: 'frost' },
  { id: 'icehorn', name: 'Icehorn', elements: ['frost', 'stone'], stats: S(65, 80, 70, 30, 40, 45), height: 1.3, art: 'icehorn', behaviour: 'charger' },
  { id: 'shadebat', name: 'Shadebat', elements: ['gloom', 'gale'], stats: S(35, 55, 30, 40, 35, 80), height: 0.9, art: 'shadebat', flying: true, behaviour: 'swarm' },
  { id: 'wispling', name: 'Wispling', elements: ['wisp'], stats: S(40, 35, 40, 70, 60, 55), height: 1.0, art: 'wispling', flying: true, behaviour: 'ranged', shot: 'wisp' },
  { id: 'gloomcap', name: 'Gloomcap', elements: ['venom', 'gloom'], stats: S(70, 40, 60, 55, 70, 30), height: 1.1, art: 'gloomcap', behaviour: 'healer' },
  { id: 'duskfang', name: 'Duskfang', elements: ['gloom'], stats: S(60, 85, 50, 40, 45, 75), height: 1.25, art: 'duskfang', behaviour: 'charger' },
  { id: 'hornbeetle', name: 'Hornbeetle', elements: ['alloy', 'hive'], stats: S(80, 95, 110, 30, 60, 45), height: 1.35, art: 'hornbeetle', behaviour: 'tank' },

  // ---------------- bosses ----------------
  {
    id: 'grimbark', name: 'Grimbark', elements: ['bloom', 'quake'], stats: S(110, 100, 110, 80, 90, 50), height: 5.2, art: 'grimbark',
    behaviour: 'chase', boss: { title: 'The Rooted King', attacks: ['slam', 'radial', 'summon', 'charge'], phaseHp: [0.5], summon: 'burrowbun' },
  },
  {
    id: 'magmaw', name: 'Magmaw', elements: ['blaze', 'stone'], stats: S(120, 110, 120, 100, 80, 40), height: 4.8, art: 'magmaw',
    behaviour: 'chase', boss: { title: 'Mountain That Walks', attacks: ['slam', 'spiral', 'volley', 'charge'], phaseHp: [0.6, 0.3], summon: 'cindercrab' },
  },
  {
    id: 'rimewing', name: 'Rimewing', elements: ['frost', 'gale'], stats: S(100, 95, 85, 120, 90, 95), height: 5.0, art: 'rimewing', flying: true,
    behaviour: 'chase', boss: { title: 'Herald of the White Sky', attacks: ['charge', 'radial', 'volley', 'spiral'], phaseHp: [0.5], summon: 'frostling' },
  },
  {
    id: 'umbraking', name: 'Umbraking', elements: ['gloom', 'wisp'], stats: S(130, 130, 95, 120, 95, 90), height: 5.4, art: 'umbraking',
    behaviour: 'chase', boss: { title: 'Lord of the Long Night', attacks: ['charge', 'spiral', 'summon', 'slam', 'radial'], phaseHp: [0.66, 0.33], summon: 'duskfang' },
  },
];

export const ORIGINALS_BY_ID: Record<string, SpeciesDef> = Object.fromEntries(ORIGINALS.map((s) => [s.id, s]));
