// Every tunable number lives here. Systems read ctx.rules, never literals.
// Values tagged [C] are confirmed from PokéBonk's shipped bundle (see docs/ANALYSIS.md),
// [I] inferred, [B] Poke-Watch's own choice where the original is unknown.

export interface ArchetypeTemplate {
  dmg: number; // base damage per hit
  cd: number; // cooldown seconds
  range: number; // targeting / travel range (m)
  speed: number; // projectile speed (m/s)
  count: number; // projectiles / hits per cast
  radius: number; // hit radius or area radius (m)
  pierce: number; // enemies a projectile can pass through (-1 = infinite)
  duration: number; // lifetime of zones / orbits (s)
  knock: number; // knockback impulse (m/s)
  tick: number; // damage tick interval for zones (s)
}

const T = (t: Partial<ArchetypeTemplate>): ArchetypeTemplate => ({
  dmg: 20, cd: 1.2, range: 14, speed: 14, count: 1, radius: 0.6, pierce: 0, duration: 0, knock: 4, tick: 0.3, ...t,
});

export const defaultRules = {
  sim: {
    hz: 60, // [B] fixed step (original: variable dt clamped to 1/20 s)
    maxFrameDt: 0.25,
    hitstopScale: 0.08, // [C] time scale while hit-stop is active
    deathTimeScale: 0.25, // [C] slow motion on death
    deathSlowmoSeconds: 1.6, // [B]
    evolveSeconds: 2.4, // [B] world frozen during evolution cinematic
  },
  world: {
    size: 112, // [B] handcrafted arena, 1 tile = 1 m (src/world/arenas.ts). PokéBonk's heightfield was 280 m [C]
    gridCell: 3, // [C] spatial grid cell (m)
    chests: 6, // [B] drawn from each arena's designed chest spots
  },
  player: {
    radius: 0.55, // [C]
    gravity: 30, // [C]
    jumpVelocity: 10.5, // [B]
    glideFallSpeed: 2, // [C] flyers holding jump
    stepHeight: 0.6, // [C] blocked if ground ahead rises more than this
    baseSpeed: 7.2, // [B]
    iframes: 0.55, // [B]
    knockback: 9, // [B]
    crowdPush: 3, // [B]
    dashSpeed: 24, // [B]
    dashTime: 0.17, // [B]
    dashCooldown: 1.5, // [B] legacy; Dash now spends a Reflex charge (combat.reflexRecharge)
    magnetRadius: 4, // [B]
    pickupRadius: 1.1, // [B]
    moveSlots: 3, // [C] (4 later)
    moveSlotsLate: 3, // [C] 4 in PokéBonk; 3 here, because the squad carries three Pokémon (blueprint section 5)
    lateSlotLevel: 20, // [I]
    vitaminSlots: 3, // [C]
    hpBase: 50, hpPerStat: 1.4, hpPerLevel: 4, // [B] maxHp = hpBase + hp*hpPerStat + level*hpPerLevel
    statRef: 60, // [B]
    growthPerLevel: 0.04, // [B] stats x (1 + 0.04*(L-1)) attack/spa multiplier = stat / statRef
    defenseRef: 90, // [B] damage taken * defenseRef/(defenseRef+def)
    regenPerSec: 0.25, // [B]
  },
  camera: {
    // DS-style fixed three-quarter view (see docs/ART_BIBLE.md). PokéBonk used an orbit camera
    // (distance 9, pitch 0.45 [C]); Poke-Watch locks yaw like HeartGold/SoulSilver routes.
    pitch: 0.82, // [B] rad (~47°) above the horizon
    fov: 30, // [B] degrees; narrow lens keeps tiles nearly square across the screen
    pxPerMetre: 16, // [B] one texel of every sprite and tile = one screen pixel at the focus
    lead: 1.2, // [B] metres the view leads in the movement direction
    height: 0.6, // [B] look-at point above the player's feet
    shakeDecay: 1.8,
  },
  xp: {
    base: 8, linear: 5.5, exponent: 1.8, // [C] xpNext(L) = round(8 + 5.5L + L^1.8)
    endlessMult: 1.15, // [I]
    gemBase: 0.85, gemPerBst: 1 / 180, // [B]
  },
  enemy: {
    cap: 2200, // [C] pool capacity
    liveCap: 900, // [C] quality presets 500 / 900 / 1400
    governor: { window: 2, dropTo: 0.82, raiseBy: 50, targetFps: 50 }, // [C]
    hpBase: 12, hpPerBst: 0.055, // [C] hp = (12 + BST*0.055) * hpMult * toughness * roleMult
    speedBase: 3, speedPerSpe: 1 / 55, speedMax: 6.2, // [C]
    dmgBase: 5, dmgPerAtk: 1 / 16, dmgPerSpa: 1 / 24, // [C]
    steerRate: 10, // [C] velocity eases toward desired by min(1, 10*dt)
    knockDecay: 7, // [C] knockback decays by exp(-7*dt)
    separationPad: 1, // [C] neighbours within 2r + 1 push apart
    separationForce: 6, // [B]
    contactCooldown: 0.5, // [B]
    despawnDistance: 46, // [B] respawn closer if left behind
    spawnRadius: [21, 27], // [B] just outside the fixed view (±15 m wide, ±11 m deep)
    roles: {
      elite: { hp: 4.5, dmg: 1.5, size: 2, xp: 5 }, // [C] hp; size [B] whole-number scales only, so texels stay square (1.5x doubled every other texel and shimmered)
      alpha: { hp: 22, dmg: 2, size: 3, xp: 20 }, // [C] hp; size [B] whole-number scale
      boss: { hp: 70, dmg: 2.2, size: 1, xp: 60 }, // [C] hp
    },
    rangedRange: 13, rangedCooldown: 2.6, rangedShotSpeed: 11, // [B]
    chargeWindup: 0.6, chargeSpeedMult: 2.8, chargeTime: 0.7, chargeCooldown: 3.5, // [B]
  },
  director: {
    hpN: [1, 5.5, 13, 20], // [C] per stage
    hpR: [0.15, 0.07, 0.05, 0.05], // [C] per stage
    hpLinear: 0.3, hpKnee: 1.5, // [C] (1 + 0.3t + max(0, t-1.5)^2 r) * n, t = stage minutes
    toughnessBase: 1.35, toughnessEarly: 1.05, toughnessWindow: 480, // [C] 1.35 + 1.05*max(0, 1 - t/480s)
    speedPerMin: 0.02, speedPerStage: 0.06, speedCap: 1.3, // [C]
    finalSwarmBase: 4, // [C] HP x 4^(minutes since swarm start)
    spawnBase: 1.0, spawnPerMin: 0.9, spawnPerStage: 0.6, // [B] spawns per second
    capBase: 120, capPerMin: 130, // [B] live-enemy cap ramps up over the stage (min with enemy.liveCap)
    eliteEvery: 40, // [B] s
    swarmEvery: 55, swarmSize: [14, 26], // [B] ring swarms
    alphaAt: 210, // [B] s into stage
  },
  damage: {
    playerMult: 2.0, // [B] global player damage scale (original player damage formula is unknown)
    stab: 1.25, // [C]
    stabAdaptive: 1.5625, // [C]
    superEffectiveBonus: 1, // [C] extra x when eff > 1 (stat, default 1)
    immuneMult: 0.25, // [B] immune hits still chip (original unknown)
    critChance: 0.06, critMult: 1.6, // [B]
    sleepBonus: 1.8, // [C]
    weatherBoost: 1.3, weatherNerf: 0.75, // [C]
    ailmentChanceScale: 1.6, ailmentMin: 0.15, ailmentMax: 0.8, // [C]
    defaultAilmentChance: 0.12, // [C]
    burnDps: 0.06, poisonDps: 0.05, // [B] fraction of hit damage per second
    statusTime: { burn: 3, poison: 4, sleep: 1.6, root: 1.5, confuse: 2, chill: 2.5, stun: 0.7, knock: 0 },
    knockMult: 1,
  },
  moves: {
    dmgScale: { base: 0.72, perPower: 1 / 260, min: 0.85, max: 1.3 }, // [C]
    cdScale: { base: 0.88, pivot: 60, per: 1 / 500, min: 0.85, max: 1.15 }, // [C]
    priorityCdMult: 0.85, // [C]
    maxLevel: 8,
    levelDmg: 0.25, levelCd: 0.06, levelCountEvery: 2, levelArea: 0.08, // [B] per move level
    autoAimRange: 18,
  },
  archetypes: {
    strike: T({ dmg: 26, cd: 0.85, range: 4.6, radius: 1.9, knock: 7 }),
    dash: T({ dmg: 30, cd: 2.2, range: 9, speed: 26, radius: 1.5, knock: 9, duration: 0.24 }),
    homing: T({ dmg: 18, cd: 1.1, range: 18, speed: 13, radius: 0.55, count: 1 }),
    orb: T({ dmg: 26, cd: 1.0, range: 16, speed: 12, radius: 0.7, pierce: 1 }),
    lob: T({ dmg: 30, cd: 1.8, range: 14, speed: 11, radius: 3, knock: 6 }),
    bolt: T({ dmg: 14, cd: 0.7, range: 18, speed: 26, radius: 0.4, pierce: 2, count: 1 }),
    beam: T({ dmg: 22, cd: 2.0, range: 15, radius: 0.9, pierce: -1, knock: 3, duration: 0.3 }),
    chain: T({ dmg: 20, cd: 1.4, range: 10, radius: 6, count: 4, knock: 1.5 }),
    barrage: T({ dmg: 8, cd: 1.2, range: 16, speed: 22, radius: 0.35, count: 5, knock: 1.5 }),
    boomerang: T({ dmg: 16, cd: 1.6, range: 11, speed: 16, radius: 0.9, pierce: -1, knock: 3 }),
    vortex: T({ dmg: 7, cd: 3.2, range: 14, radius: 3.6, duration: 2.6, tick: 0.3, knock: 0 }),
    nova: T({ dmg: 24, cd: 2.4, range: 0, radius: 4.8, knock: 11 }),
    spin: T({ dmg: 9, cd: 2.4, radius: 2.8, duration: 1.3, tick: 0.2, knock: 5 }),
    cone: T({ dmg: 15, cd: 1.3, range: 7, radius: 0.9, knock: 3 }), // radius = half-angle (rad)
    aura: T({ dmg: 6, cd: 0.45, radius: 3.0, knock: 0.6 }),
    orbit: T({ dmg: 12, cd: 4.5, radius: 2.8, speed: 3.2, count: 3, duration: 3.2, pierce: -1, knock: 4 }),
    trail: T({ dmg: 6, cd: 3.5, radius: 1.5, duration: 2.2, tick: 0.3, count: 10, knock: 0 }),
    meteor: T({ dmg: 46, cd: 2.6, range: 16, radius: 3.4, duration: 0.65, knock: 10 }),
    drain: T({ dmg: 16, cd: 1.3, range: 16, speed: 12, radius: 0.6 }),
    smite: T({ dmg: 55, cd: 3.0, range: 20, radius: 1.8, knock: 2 }),
    trap: T({ dmg: 4, cd: 4, range: 12, radius: 3.0, duration: 3, tick: 0.5, knock: 0 }),
    buff: T({ dmg: 0, cd: 9, duration: 5 }),
    weather: T({ dmg: 0, cd: 14, duration: 8 }),
  } as Record<string, ArchetypeTemplate>,
  pickups: {
    cap: 4000,
    mergeThreshold: 260, // [C]
    magnetSpeed: 20, // [B]
    healChance: 0.004, // [B]
  },
  cards: {
    choices: 3, rerolls: 2, skips: 2, banishes: 2, // [C] reroll(F) skip(X) banish(Z); counts [B]
    weights: { learn: 3, upgrade: 4, vitamin: 2.2, heal: 0.6 },
    rarity: { common: 1, rare: 0.28, epic: 0.07 },
    rarityMult: { common: 1, rare: 1.6, epic: 2.4 },
  },
  vitamins: {
    hp: { add: 0.12, label: 'Max HP' },
    atk: { add: 0.1, label: 'Attack' },
    spa: { add: 0.1, label: 'Sp. Attack' },
    def: { add: 0.12, label: 'Defense' },
    spe: { add: 0.07, label: 'Speed' },
    haste: { add: 0.06, label: 'Cooldowns' },
    area: { add: 0.1, label: 'Area' },
    crit: { add: 0.04, label: 'Crit chance' },
    magnet: { add: 0.3, label: 'Magnet' },
  } as Record<string, { add: number; label: string }>,
  stage: {
    count: 4, // [I] stages per region
    bossAt: 300, // [B] s
    finalSwarmAt: 480, // [B] s (if the boss is still alive the swarm begins)
    portalRadius: 2.2,
  },
  // Aimed combat (blueprint section 4). The basic attack (slot 0) autofires; slots 1-3 are Move A,
  // Move B and the Signature, cast while their button is held. Dash and Guard share Reflex charges.
  combat: {
    /** 'aimed' = basic attack follows your aim; 'assist' = basic attack targets the nearest enemy;
     *  'auto' = every move fires on its own at the nearest enemy (the original survivor controls) */
    mode: 'aimed' as 'aimed' | 'assist' | 'auto',
    magnetDeg: 12, // shots bend toward an enemy this close to the aim line
    meleeMagnetDeg: 28, // strikes, cones and spins
    manualCdMult: 1.5, // manual moves: longer cooldown...
    manualDmgMult: 1.5, // ...and harder hits, so damage per second matches the autofire tuning
    reflexCharges: 2,
    reflexRecharge: 1.8, // s per charge
    guardWindow: 0.15, // s: deflect / parry window at the start of a Guard
    braceMult: 0.5, // damage taken while bracing
    braceSpeed: 0.4, // move speed while bracing
    braceDrainEvery: 2, // s of Brace per extra Reflex charge
    whiffLock: 0.35, // s without Guard or Dash after a Guard tap that caught nothing
    deflectSpeed: 1.35, // reflected shots fly this much faster
    deflectDmg: 40, // base damage of a reflected shot (player damage pipeline)
    parryKnock: 16, parryStun: 0.8,
    incomingTypeExp: 0.5, // [B] hits on your Pokémon use the type chart to this power: weak x1.41, resist x0.71, immune x0.5
    flashFireTime: 10, // [B] s a player Flash Fire stays armed after absorbing Fire
  },
  // [B] enemy roles, objectives and the beat director (blueprint section 9, Phase 7)
  roles: {
    bulwarkArc: 0.7071, // cos of the half-angle of the shield's front arc (90° total)
    bulwarkRadius: 2.4, // m: shots in front of the Bulwark within this reach are blocked
    bulwarkBreak: 4, // s the shield stays down after a Fighting hit or a push that moves it
    hexRange: 9, // m: Hexers keep about this far away
    hexCooldown: 4.5, hexWindup: 0.8, hexRadius: 2.5, // s, s, m: the puddle lands where you were heading
    raiderSpeed: 1.25, raiderHp: 0.8, // multipliers
    menderHeal: 0.12, menderEvery: 3.2, menderRadius: 5,
  },
  objectives: {
    enabled: true, // false = v8 pacing: no objectives, the alpha at 3:30 and recruits after elite kills
    offerTime: 45, // s to engage before an objective lapses
    firstAfter: 90, secondAfter: 200, // s into the stage before the first and second objective can open
    hold: { radius: 5, time: 30, drain: 0.015, limit: 60 }, // drain: charge lost per Raider on the pad per s (4 out-drain you)
    hunt: { escort: 4, flee: 0.5, limit: 75, menderDistance: 14 },
    transport: { distance: 36, goalRadius: 2.5, carrySpeed: 0.7, limit: 90 },
  },
  beats: {
    enabled: true,
    build: [35, 45], peak: [20, 30], relax: [10, 15], // s ranges
    rate: { build: [0.75, 1.15], peak: 1.3, relax: 0.3 }, // spawn-rate multipliers (build ramps)
    hotIntensity: 0.85, hotTime: 5, // a peak ends early once intensity has stayed this high this long
    weatherChance: 0.3, weatherTime: 30, // share of non-objective peaks that bring Rain or Sun, and how long
    compositionsAfter: 75, // s into a stage before a Peak may send a composition (early Peaks are just busier)
  },
  // [B] squad and Tag (blueprint section 6): three Pokémon, one on the field. Tag (Q / Y) swaps the field
  // Pokémon and the incoming one fires its Tag Action. Benched Pokémon rest: cooldowns keep ticking, grey
  // (recently lost) health refills, coats wear off twice as fast. A run ends when all three have fainted.
  squad: {
    max: 3,
    tagCooldown: 4, // s, squad-wide
    tagInvuln: 0.15, // s of invulnerability on arrival
    tagDelay: 0.2, // s from arrival to the Tag Action's release
    holdPick: 0.25, // s: holding Tag longer than this opens the pick (A = first reserve, B = second)
    benchCdRate: 1, // benched cooldowns recover at this rate (the H2 knob)
    greyShare: 0.4, // share of each hit that becomes grey health
    greyHalfLife: 2.8, // s: grey health on the field drains toward permanent loss (mostly gone in 8 s)
    benchRefill: 0.03, // share of max HP per second refilled from grey health while benched
    faintDelay: 1, // s before the next Pokémon comes in after a faint
    reviveHp: 0.3, // fainted Pokémon return at this share of max HP at the next region's portal
    recruitAfter: [120, 300], // s of run time before the first and the second recruit can be offered
    tagDmgMult: 1.8, tagKnockMult: 1.5, // a Tag Action hits like a strong manual move
    variantLevel: 18, // Pokémon that never evolve unlock their Tag variant at this squad level
  },
  // [B] creature coats and reactions (blueprint section 8): the four tile agents also coat creatures.
  // Light coats come from the basic attack and stick only to fodder; deep coats come from moves A/B, Tag
  // Actions, terrain and weather, stick to everything, and can only be spent by another deep agent.
  reactions: {
    lightTime: 3, deepTime: 8,
    lightIcd: 1, // s between light coats or light reactions on the same creature
    steam: { light: { r: 2, t: 2 }, deep: { r: 4, t: 4 } }, // cloud: enemies inside lose their target and stop shooting
    freeze: { light: 1, deep: 3, shatter: 2 }, // s frozen; the next physical hit or push deals x2
    conduct: { light: { r: 2, stun: 0.3, mult: 0.5 }, deep: { r: 6, stun: 1, mult: 1 }, maxTargets: 12 },
    overload: { light: { r: 1.5, mult: 0.6, knock: 6 }, deep: { r: 3, mult: 1.2, knock: 12 } },
    /** base damage of a reaction that a tile starts (no hit to scale from): base + perLevel x squad level */
    tileBase: 10, tilePerLevel: 2,
    soakedFire: 0.5, // Fire damage into a Soaked creature
    /** crowd-control meter: after `limit` s of stun / freeze / root inside the decay window, immune for `immune` s */
    cc: { limit: 2, decay: 1 / 3, immune: 4, bossMult: 2 },
  },
  // [I] Procedural world (docs/WORLDGEN.md, Procedural Pokémon World Blueprint). `mode: 'authored'` keeps the
  // handcrafted arenas exactly (replay checksums unchanged); 'generated' builds each listed biome's region from the
  // stage seed (seed + stage*7919 + loop*104729) with src/world/gen. Biomes not listed stay authored.
  worldgen: {
    mode: 'authored' as 'authored' | 'generated',
    biomes: ['meadow'] as string[],
    size: 128, // tiles (m) per side of a generated region
    version: 1, // goes in the map id, the map checksum and the replay; bump when the generator's output changes
    regionSeed: -1, // ≥ 0: use this region seed for every stage instead of the run's (experiments: hold the map, vary the run)
  },
  // [I] W4 materials (rules/surfaces.ts): trees, bushes and rocks have a material, burn, break and leave stumps or
  // rubble; wall and platform become a mutable overlay; a watchdog keeps the map reachable. false = today's rules.
  surfaces: {
    enabled: true,
    /** materials on the handcrafted arenas too (off: they apply to generated regions only, so the default game is
     *  unchanged until materials are tuned with people; bot runs on the authored Meadow die earlier with them on) */
    inAuthored: false,
    coverLossCap: 0.4, // fraction of a region's cover props that may be lost for good; past it, fire stops spreading to the rest
    watchdogEvery: 2, // s between reachability checks
    watchdogFloor: 0.9, // reachable walkable area must stay at least this share of the base map's
    propIgnite: 0.06, // chance per 0.1 s pass that a burning prop lights a flammable prop beside it (leaf)
    grassToProp: 0.02, // chance per 0.1 s pass that a burning grass tile lights a prop beside it (leaf)
    woodSpread: 0.045, // wood catches at this fraction: about 1 in 7 over a neighbour's 6 s burn, so with ~4 neighbours a forest fire dies out instead of crossing the region
    hitIntegrity: 1, // integrity damage per point of hit damage (type chart applies)
  },
  bodies: {
    looseRocks: 8, // Medium rocks scattered on each route; Power 2 moves roll them into the horde
    cap: 64,
  },
  // [B] Phase 8a: one capability resolver for creatures, bodies and projectiles (blueprint sections 7, 10, 12).
  // `enabled: false` (or each feature flag off) gives the v10 rules exactly: replay checksums are unchanged.
  caps: {
    enabled: true,
    /** projectiles are light bodies: a Push deflects a shot, a Hold catches it, opposing shots cancel by Weight,
     *  and Guard deflects only shots no heavier than the guarding Pokémon */
    interception: true,
    maxInterceptsPerTick: 32, // interceptions resolved per tick at most (dense shot fields stay readable)
    heavyShotRadius: 0.6, // m: shots at least this wide are Weight 1 ("heavy shots"); lobs are Weight 1 too
    /** Hold suspends its target in front of the holder, then releases it as a Push of the same Power along the aim */
    suspendHold: true,
    holdTime: 1, // s at most (manual moves release early when their button is let go)
    holdDistance: 1.5, // m in front of the holder
    holdSpeed: 14, // m/s at which a caught body travels to the hold point
    combineWindow: 0.2, combineCos: 0.7071, // holds combine like pushes: within 0.2 s and 45°, stronger Power + 1
    /** the impact rule between bodies: a body moving at 5 m/s or more hits and shoves the bodies it touches */
    bodyCollisions: true,
    /** flow-field cost of a burning tile for enemy navigation (1 = fire does not change paths) */
    burnNavCost: 8,
    /** bodies one player's Create can keep at once; the oldest breaks first */
    createCap: 6,
    /** capability events kept for the death recap and pokewatch.debug('caps') */
    logSize: 512,
    recapSeconds: 5,
  },
  // [B] Phase 8b: the build layer (blueprint section 6). Every level-up (and item ball) shows three cards: a Kit card
  // (the field Pokémon's learnset or a transform of one of its moves), a Technique (a trainer-wide rule with a cost; at
  // most 3 held) and a Wildcard (a benched Pokémon's transform, a Tag variant, an early evolution, a heal). Raw power
  // comes from squad level and evolution: move levels follow the squad level ("mastery") instead of power-up cards.
  // `enabled: false` gives the Phase 8a cards exactly (replay checksums unchanged).
  build: {
    enabled: true,
    /** compatibility flag, off until the replacements are verified with people: true brings back the numeric cards
     *  (vitamins as Wildcards, move power-ups as Kit cards) and move levels come from those cards again (no mastery) */
    legacyNumeric: false,
    maxTechniques: 3,
    /** a technique is offered at least once every this many picks (matters once 3 are held) */
    techniqueEvery: 3,
    /** once 3 are held, the Technique slot shows a replacement with this chance (else another Kit or Wildcard) */
    techniqueWhenFull: 0.35,
    /** per region (reset at each region's start) */
    rerolls: 2, banishes: 1,
    /** w = base x (1 + synergy x s) x n x f: s = the card's capability tags the kit already uses (capped), n = novelty
     *  for a capability the squad lacks during the first noveltyPicks picks, f = repeat for a card in the last offer */
    synergy: 0.6, synergyCap: 2, novelty: 1.5, noveltyPicks: 4, repeat: 0.5,
    weights: { learn: 3, replace: 1, transform: 4, technique: 1, benchTransform: 2.5, tagVariant: 1.5, evolve: 1, heal: 0.6, vitamin: 2.2, upgrade: 4 },
    /** casts before a move offers its transforms ("used for a while"): the autofired basic attack, and Move A / B */
    transformUses: { basic: 25, move: 8 },
    /** mastery: a move's level = 1 + floor((squad level - 1) / masteryEvery), up to moves.maxLevel */
    masteryEvery: 5,
    /** Kit filler: learnset moves up to this many levels early (at this weight multiplier), so the Kit slot is rarely empty */
    learnAhead: 4, learnAheadMult: 0.5,
    /** the Wildcard evolution is offered this many squad levels before a Pokémon's evolution level */
    evolveWithin: 2,
    /** the Sitrus Berry is a filler: offered below this share of HP, and when it is the only Wildcard it takes the slot
     *  only with this chance (otherwise the slot draws a Kit or Technique card) */
    healBelow: 0.5, healFill: 0.4,
    tech: {
      undertow: { pushDmg: 0.8 },
      lodestone: { holdBonus: 1, holdTime: 1.5 },
      heavyFooting: { weight: 1, maxGuard: 3, speed: 0.85, dash: 0.7, knock: 0.5 },
      catalyst: { refund: 1 },
      slipstream: { dashCost: 1.3, reach: 1.3 },
      quarry: { rubble: 2, integrity: 0.75, speed: 6 },
      secondWind: { tagCooldown: 5 },
    },
    /** Lasso on a creature: the throw's speed rule is the body rule, 8 x (1 + 0.5 x (Power - Weight)) m/s */
    lassoHold: 0.6, // s a lassoed creature is suspended before the throw (a manual move lets go early)
    brambleTime: 10, brambleSlow: 0.55,
  },
  bosses: {
    // extra attacks layered on a boss's roster kit: Rock-type bosses roll boulders at you
    extraAttacks: { sudowoodo: ['boulder'], magcargo: ['boulder'] } as Record<string, string[]>,
    boulderWindup: 0.6, boulderSpeed: 11, boulderDmg: 1.5, // x the boss's contact damage
  },
  feel: {
    hitstopKillBig: 0.06, hitstopBossHit: 0.0, hitstopBossKill: 0.5, hitstopPlayerHurt: 0.08, // [C] range 0.06..0.5
    shakePlayerHurt: 0.35, shakeBoss: 0.6, shakeNova: 0.15,
    damageNumbers: true,
    // [B] attack timeline: seconds between a move coming off cooldown (pose starts, Pokémon turns to
    // the target) and the release, so the PMD HitFrame lines up with the projectile/impact. The
    // wind-up is refunded from the next cooldown, so damage per second is unchanged.
    windup: { strike: 0.1, dash: 0.06, cone: 0.1, nova: 0.1, spin: 0.08, aura: 0.1, homing: 0.08, orb: 0.09, bolt: 0.07, barrage: 0.08, lob: 0.1, boomerang: 0.08, beam: 0.12, chain: 0.12, vortex: 0.12, meteor: 0.14, smite: 0.12, drain: 0.08, orbit: 0.1, trail: 0.06, trap: 0.1, buff: 0.12, weather: 0.12 } as Record<string, number>,
  },
  mode: {
    id: 'classic',
    endless: false,
    difficulty: 1, // multiplies enemy hp, dmg, speed
  },
};

export type Rules = typeof defaultRules;
