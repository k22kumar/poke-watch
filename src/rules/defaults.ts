import type { SpawnPoolDef } from './spawning';
import { TRAVERSAL_TEMPLATES } from './traversal';
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
  },
  world: {
    size: 112, // [B] handcrafted arena, 1 tile = 1 m (src/world/arenas.ts). PokéBonk's heightfield was 280 m [C]
    gridCell: 3, // [C] spatial grid cell (m)
    chests: 6, // [B] drawn from each arena's designed chest spots
    /** [C] R1b wall tops (docs/SIZING.md "Wall tops"): a wall prop (tree, fence, boulder, building) is solid only up to
     *  its measured height (PROP_RULES top, World.wallTop) for every reader that opts in: the player's spatial attack
     *  traces (QF.tops through combatFlags), the chase lens, and a body given the crossing permission (no driver gives it
     *  before R6d). Bare walls, enemy sight and fire, planar shots and the map validators keep walls infinite. false =
     *  every wall infinite for everyone (the checksum sets older than R1b, `aim-tops-off`) */
    wallTops: true,
  },
  // Spatial queries (src/sim/spatial.ts; docs/THIRD_PERSON_IMPLEMENTATION.md §12): rays, ordered sweeps and overlaps.
  // No system reads them yet (Phase 2A has no consumers), so no replay hash depends on these numbers.
  spatial: {
    /** [C] m (per axis) an enemy may move between the grid rebuild (gridSystem) and a query later in the same tick; the
     *  actor broad phase widens by it. Walking and knockback give < 0.5 m; a footprint pushed out of a wall after a fall
     *  moves up to 2 pushes of bodyCap (an Extra Large Snorlax moved 1.04 m on one axis, tests/spatial.test.ts) */
    gridSlack: 2.5,
    /** [C] s an enemy cannot be hit after it spawns (the 0.25 s spawn guard of effects.ts, as a rule) */
    spawnGuard: 0.25,
  },
  // Spatial aim and 3D direct shots (src/sim/aim.ts, docs/THIRD_PERSON_IMPLEMENTATION.md §13). Applies only when the
  // input carries the chase camera's crosshair ray (InputFrame.aim), the cast is player-aimed (combat.mode 'aimed', or
  // 'assist' for slots 1-3) and its archetype is listed: the sim traces the ray, launches from the body's muzzle toward
  // the point it meets, and the shot flies its own straight 3D line on swept, ordered contacts. No magnetism and no
  // lead on that path. The bot and the fixed views send no ray, so every replay checksum set is unchanged.
  aim: {
    /** [C] false = every cast takes the planar path (aimX/aimZ, magnetism, lead, shots at the shooter's height) */
    spatial: true,
    /** [C] the archetypes on the spatial path: the direct linear shots (others keep their own targeting until their stage) */
    archetypes: ['bolt', 'orb', 'beam'] as string[],
    /** [C] m the crosshair ray is traced past the partner's plane: how far the aim can see. It never extends a shot */
    sightRange: 80,
    /** [C] m: an aim point closer to the muzzle than this, or behind it, fires along the crosshair ray instead (point blank) */
    convergeMin: 0.5,
    /** [B] the muzzle: `up` × the partner's class height above its feet, `fwd` × its footprint (hurt radius with size
     *  geometry off) ahead along the aim's heading. Size classes scale it (Tiny 0.36 m up, Extra Large 1.44 m) */
    muzzle: { up: 0.6, fwd: 0.9 },
    /** [B] per-archetype or per-move-key overrides of the muzzle (a move key wins over its archetype) */
    muzzleBy: {} as Record<string, { up?: number; fwd?: number }>,
    /** [C] R2 pole-safe aim maths (docs/THIRD_PERSON_IMPLEMENTATION.md §18): the muzzle's forward offset follows the
     *  crosshair ray's horizontal fraction continuously to 0 at the pole (no jump to the partner's facing); a multi-shot
     *  fan turns in the plane perpendicular to its launch direction (its spread no longer shrinks with pitch); a launch
     *  straight up or down takes the crosshair ray's heading, not the facing. false = the pre-R2 maths exactly (the
     *  `aim-pole-off` checksum set) */
    poleSafe: true,
    /** [C] R2, degrees from the horizon: up to this ray pitch the muzzle's forward offset is the full `fwd` (bit-identical
     *  to pre-R2, and the whole of today's 60° up / 50° down envelope); past it the offset shrinks linearly with the ray's
     *  horizontal fraction, to 0 at ±90°. In [0, 90) */
    muzzleFadeDeg: 60,
    /** [B] a spatial shot's reach from its muzzle = range × reachMult + speed × reachPad: the distance a legacy shot of
     *  the same move flies (its life is range / speed × 1.25 + 0.2 s), so moving onto this path changes no range */
    reachMult: 1.25, reachPad: 0.2,
    /** [C] the shot's radius against the world (m, < 1): 0 = a ray, so a shot skims floors and passes wall corners by
     *  its centre line; its full radius applies against bodies */
    worldRadius: 0,
    /** [C] Phase 2C: a beam's core radius against the world (m, < 1): 0 = its centre line meets walls, floors and slabs,
     *  so it passes beside a corner; its full width (the move's radius) applies against bodies, and only to bodies the
     *  core can see (moves.ts beam3D) */
    beamWorldRadius: 0,
    /** [C] Phase 2C: true = foliage (props whose material has blocksShots false: bushes, hedges, berry bushes,
     *  mushrooms) is cover for every spatial trace, as in Phase 2B; false = it is open air above its ground (the
     *  authored material rule). Tree trunks, rock masses, buildings, rocks and grave markers block either way */
    foliageCover: false,
    /** [C] Phase 3 (docs/THIRD_PERSON_IMPLEMENTATION.md §15): aim assistance per aiming device, for casts on the planar
     *  path (every family not in `archetypes`) whose input names its device (InputFrame.aimDev). `shotDeg` / `meleeDeg`:
     *  the cone (degrees) inside which the aim bends to the enemy nearest the aim line (0 = never: no cone and no
     *  width snap); `lead`: shots and lobs lead the enemy they bent to; `los`: only an enemy the partner's chest can see
     *  (sim/spatial.ts segmentClear, the attack cover policy) can bend it. A bent cast names its enemy in the cast event
     *  (`assist`). Input with no aimDev (the bot, scripted input, older replays) keeps combat.magnetDeg / meleeMagnetDeg
     *  with lead and no sight test. The spatial path (bolt, orb, beam through the chase crosshair) has none for any device */
    /** [C] Phase 3: false = `assist` is ignored and every planar cast keeps the legacy cone whatever its device (the
     *  Phase 2C behaviour exactly; the older test layers set it) */
    deviceAssist: true,
    assist: {
      mouse: { shotDeg: 0, meleeDeg: 0, lead: false, los: true },
      stick: { shotDeg: 12, meleeDeg: 28, lead: true, los: true },
      touch: { shotDeg: 12, meleeDeg: 28, lead: true, los: true },
    } as Record<'mouse' | 'stick' | 'touch', { shotDeg: number; meleeDeg: number; lead: boolean; los: boolean }>,
  },
  player: {
    radius: 0.55, // [C]
    gravity: 30, // [C]
    jumpVelocity: 10.5, // [B]
    glideFallSpeed: 2, // [C] flyers holding jump
    stepHeight: 0.6, // [C] blocked if ground ahead rises more than this
    groundAccel: 16, // [C] 1/s: planar velocity response on a support (× the surface's grip; sim/locomotion.ts)
    airAccel: 7, // [C] 1/s: planar velocity response in the air (air control)
    knockDecay: 8, // [C] knockback decays by exp(-8*dt)
    // [B] R6c jump acceptance (sim/locomotion.ts jumpControl; edge-sending input only, InputFrame.jumpPressed): a press
    // stays eligible for a ground jump this long (7 ticks), and a body that walked off a ledge may still jump this long
    // (6 ticks). 0 = pure edges. Input without the edge field (the bot, replays) keeps the held rule and ignores both
    jumpBuffer: 0.12,
    coyote: 0.1,
    iframes: 0.55, // [B]
    knockback: 9, // [B]
    crowdPush: 3, // [B]
    dashSpeed: 24, // [B]
    dashTime: 0.17, // [B]
    dashCooldown: 1.5, // [B] legacy; Dash now spends a Reflex charge (combat.reflexRecharge)
    pickupRadius: 1.1, // [B]
    moveSlots: 3, // [C] (4 later)
    moveSlotsLate: 3, // [C] 4 in PokéBonk; 3 here, because the squad carries three Pokémon (blueprint section 5)
    lateSlotLevel: 20, // [I]
    regenPerSec: 0.25, // [B]
  },
  // [D] Training targets (src/rules/targets.ts, src/sim/targets.ts; docs/hero-shooter-pivot.md Q17, Q20): health from the
  // canon curve × the kind's multiplier, a strafer's damage scaled down, a fixed respawn (seconds, as ticks: no RNG)
  targets: { hp: { dummy: 1, patrol: 1, strafe: 1 }, strafeDamage: 0.3, respawn: 3 },
  // [D] Breakthrough (evolution; src/sim/evolution.ts, docs/STATS_GROWTH_TARGET.md "Breakthroughs"): rooted and
  // invulnerable for breakSeconds, then the next form at full health. freeTrigger (the range Mode): holding Touch for
  // holdTime starts one for free, until Candy prices exist
  evolution: { breakSeconds: 2, holdTime: 0.4, freeTrigger: false },
  // [D] Hero stats (docs/STATS_GROWTH_TARGET.md "Stats", src/rules/stats.ts). Level-50 Canon Curve, k = 0.6, no Upkeep:
  // a stat's multiplier m = ((base + statOffset) / statRef) ^ k; health = health × ((HP + hpOffset) / hpRef) ^ k. Base 80
  // is ×1.0 and 250 health. Levels add nothing.
  hero: {
    k: 0.6, statOffset: 20, statRef: 100,
    health: 250, hpOffset: 75, hpRef: 155,
    /** top speed (m/s): a logistic band in Spe, `speedBand` wide (5.6–6.4), centred on `topSpeed` at Spe `speedMid` */
    topSpeed: 6.0, speedBand: 0.8, speedMid: 80, speedScale: 25,
    /** every move slot's level (sim/moves.ts level scaling; 1 = the move as authored). Mastery is survivor-only */
    moveLevel: 1,
    /** range mode fills Ability 2 (E) with the next learnset move, for testing (docs/hero-shooter-pivot.md Q27) */
    fillE: false,
    /** how many Pokémon a player brings (Q10): 1, one Pokémon per player; a mode that registers swapping raises it and
     *  names the others in RunOptions.loadout */
    loadout: 1,
    /** seconds a player who faints with no Pokémon left waits before coming back at the spawn at full health; 0 = the
     *  run ends instead (the survivor loop). The range Mode has no fail state (docs/hero-shooter-pivot.md Q17) */
    respawn: 0,
  },
  camera: {
    // DS-style fixed three-quarter view (see docs/ART_BIBLE.md). PokéBonk used an orbit camera
    // (distance 9, pitch 0.45 [C]); Poke-Watch keeps a fixed route-like camera.
    pitch: 0.82, // [B] rad (~47°) above the horizon
    fov: 30, // [B] degrees; narrow lens keeps tiles nearly square across the screen
    pxPerMetre: 16, // [B] one texel of every sprite and tile = one screen pixel at the focus
    lead: 1.2, // [B] metres the view leads in the movement direction
    height: 0.6, // [B] look-at point above the player's feet
    shakeDecay: 1.8,
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
    holdRelocate: 6, // [B] s a wide body may hold with no wide route to the player before it is moved like a far one (sim/enemies.ts)
    navHold: 0.4, // [B] s a ground walker keeps to the flow field after its way ahead was last blocked (size geometry on; sim/enemies.ts)
    spawnRadius: [21, 27], // [B] just outside the fixed view (±15 m wide, ±11 m deep)
    roles: {
      elite: { hp: 4.5, dmg: 1.5, size: 2 }, // [C] hp; size [B] whole-number scales only, so texels stay square (1.5x doubled every other texel and shimmered)
      alpha: { hp: 22, dmg: 2, size: 3 }, // [C] hp; size [B] whole-number scale
      boss: { hp: 70, dmg: 2.2, size: 1 }, // [C] hp
    },
    rangedRange: 13, rangedCooldown: 2.6, rangedShotSpeed: 11, // [B]
    chargeWindup: 0.6, chargeSpeedMult: 2.8, chargeTime: 0.7, chargeCooldown: 3.5, // [B]
  },
  // Spawning (src/rules/spawning.ts, docs/SPAWNING.md). Preference changes odds, never eligibility.
  spawning: {
    preference: { native: 2, foreign: 0.55 }, // [B] odds x on a tile with / without one of the species' preferred habitats
    /** the spawn preset each region fields, in stage order (meadow, badlands, frost, dusk; presets in src/rules/spawning.ts).
     *  The `*-classic` presets are the tables before the 2026-11 roster wave: older rule layers select them. */
    regions: ['meadow', 'badlands', 'frost', 'dusk'] as string[],
    /** a pool layered over every region's and map's (a mode or mod sets it; see SpawnPoolDef in src/rules/spawning.ts) */
    override: null as SpawnPoolDef | null,
    retries: 4, // [B] spots tried for a species before the director picks another or skips the spawn
    /** roster waves in play (content/roster.json `wave`): a wave set false leaves every pool, so neither the director nor
     *  the habitat navigation profiles (spawnableSpecies) see its species. Older replay layers turn `catalogue` off */
    waves: { catalogue: true } as Record<string, boolean>,
    /** canon.special values (the snapshot's legendary / mythical flags) an `everyWild` layer leaves out: such a species
     *  appears only in a pool that names it (`only`, `include`) */
    everyWildSkips: ['legendary', 'mythical'] as string[],
  },
  // The default role rule (src/rules/roles.ts, docs/SPECIES.md "Default roles"): a wild roster entry with no behaviour
  // takes one from its base stats, types, shape, abilities and level-up moves; a field the entry sets always wins. The
  // first matching row decides. Read once when the roster loads (src/rules/species.ts), so these are the defaults' values.
  wildRole: {
    /** healer: learns one of these at level-up (they heal allies' HP) and its base-stat total is under healBstBelow */
    healMoves: ['heal_pulse', 'floral_healing', 'life_dew', 'pollen_puff'] as string[],
    healBstBelow: 500, // [B] keeps legendary and late-evolution supports out of the Mender job
    /** swarm: a flyer of the extent class swarmMaxClass or smaller, base-stat total at most swarmBstMax */
    swarmMaxClass: 'medium' as 'tiny' | 'small' | 'medium' | 'large' | 'xl',
    swarmBstMax: 300, // [B]
    rangedMargin: 10, // [B] ranged: Sp. Atk ≥ Atk + this (the shot is the primary type's element, the sim default)
    tankRatio: 1.15, // [B] tank: HP + Def ≥ this × (max(Atk, Sp. Atk) + Spe)
    chargerSpeed: 80, // [B] charger: Speed at least this; otherwise chase
    /** flying: a Flying type flies unless its shape is grounded; any other species flies with a float ability, a float
     *  shape, or as a Ghost type with a ghost float shape */
    groundedShapes: ['legs'] as string[],
    floatAbilities: ['levitate'] as string[],
    floatShapes: ['bug-wings'] as string[],
    ghostFloatShapes: ['ball', 'arms', 'squiggle', 'tentacles', 'heads'] as string[],
  },
  // Size classes (src/rules/sizing.ts, docs/SIZING.md). Each Pokémon belongs to one class, picked from its canonical
  // extent (`below` is the class's upper cut in metres) or pinned in src/rules/profiles.ts. A class fixes how big the
  // Pokémon is drawn (`visual`, metres of visible core) and how big its body is in the sim (`radius`, `height`).
  // Within a class an extent near the top cut reads up to `tilt` larger, near the bottom cut up to `tilt` smaller,
  // so an evolution inside one class still grows a little; the classes themselves never overlap.
  // `body` is the movement footprint: the circle that collides with walls, faces and deck slabs (World.moveBody) and
  // decides which navigation class a Pokémon routes on (docs/SIZING.md "Footprint"). It is set per class with no
  // tilt, so passability belongs to the class: a one-tile passage (1.0 m) fits Tiny, Small and Medium bodies
  // (body < heavyRadius); Large and Extra Large bodies need two tiles. It is configured on its own, apart from the
  // drawn size (`visual`) and the hurtbox (`radius`): Medium's body is 0.46 m, under its 0.52 m hurtbox, so the most
  // common wild class keeps using the locations' one-tile chokepoints.
  size: {
    classes: [
      { id: 'tiny', name: 'Tiny', below: 0.35, visual: 0.7, radius: 0.32, height: 0.6, body: 0.3 }, // [B]
      { id: 'small', name: 'Small', below: 0.65, visual: 0.98, radius: 0.42, height: 0.9, body: 0.4 }, // [B]
      { id: 'medium', name: 'Medium', below: 1.15, visual: 1.37, radius: 0.52, height: 1.2, body: 0.46 }, // [B]
      { id: 'large', name: 'Large', below: 2.05, visual: 1.92, radius: 0.68, height: 1.7, body: 0.66 }, // [B]
      { id: 'xl', name: 'Extra Large', below: Infinity, visual: 2.69, radius: 0.9, height: 2.4, body: 0.88 }, // [B]
    ],
    tilt: 0.08, // [B] ± share of the class values, by where the extent sits inside the class (log scale)
    extentRange: [0.1, 6] as [number, number], // [B] bottom of Tiny and top of Extra Large for the tilt (m)
    wideRatio: 1.5, // [B] an idle frame at least this much wider than tall is normalised on width / wideRatio
    geometry: true, // false = pre-size-class sim bodies (radius from sprite height, one shared partner radius): replay checksums unchanged
    playerRadius: [0.48, 0.72] as [number, number], // [B] partner hurtbox clamp around the old shared 0.55 m (0.42 floor: +17 % bot survival, 0.48: +10 %)
    heavyRadius: 0.5, // [B] a footprint (`body`) at or above this routes on the wide (2 × 2 block) navigation field (sim/world.ts)
    // [B] role-scaled footprints (elite ×2, alpha ×3, bosses) stop here: pursuers must fit the two-tile routes the
    // location and habitat gates guarantee to every essential space (a body ≥ 1 m needs three tiles; docs/SIZING.md)
    bodyCap: 0.95,
    wideSeed: 4, // [B] tiles (ordinary-field steps) around the player that seed the wide field when the player stands where a wide body does not fit
    /** [C] R1 headroom (docs/SIZING.md "Headroom"): a body's sim height (class height × tilt × role size) meets deck
     *  slabs. A jump stops with the head at the underside, a body taller than the gap under a deck cannot walk in
     *  (World.moveBody), and wide routing leaves such gaps out for that body. false = heads pass through slabs, as before
     *  (the older checksum layers set it) */
    headroom: true,
    /** [C] Measurement axis (docs/SIZING.md "Measurement axis"): a species whose official shape lists its body length
     *  (src/rules/shapes.ts: `squiggle`, `fish`, or an approved SPECIES_AXIS row such as Eternatus) takes `lengthRise` ×
     *  that length as its extent, unless an approved
     *  NEUTRAL_CORE_EXTENT_M entry gives one. On by default since the size-extremes flip (owner 2026-11-18); false = every
     *  listed figure is read as height, as before (`giants-off` and every older checksum layer set it) */
    axis: true,
    lengthRise: 0.5, // [B] share of a listed body length that stands up as the extent (serpents, fish); owner 2026-11-18
    /** [C] Continuous Extra Large (docs/SIZING.md "Giants"): an XL species' drawn core grows with its extent,
     *  min(xlVisualCap, xlFloor × (S / Large's cut) ^ xlExponent), so giants stay visibly bigger than a 2.1 m XL.
     *  Drawn size only: XL radius, height and footprint keep the class values and tilt, and no sim system reads the
     *  drawn size (unless xlTall is on too). On by default since the size-extremes flip; false = the fixed XL target ± tilt,
     *  as before */
    xlContinuous: true,
    xlVisualCap: 4.0, // [B] m: provisional visual cap on the largest giants, to be tested (handoff decision 3)
    xlFloor: 2.69 * 0.92, // [B] m: today's lowest XL draw (class visual × (1 − tilt)), the draw at Large's cut
    xlExponent: 0.3, // [B] growth with extent, a fixed constant (owner 2026-11-18): never fitted to the largest species, so a new
    // generation's giant cannot move every other XL draw. Reaches the cap at about 10.2 m of extent
    /** [C] Tall giants (docs/SIZING.md "Giants", owner 2026-11-18, size-extremes-plan §S3.10 A): with xlContinuous on too, an
     *  Extra Large body's sim height follows its drawn size, visualM × (class height ÷ class visual), so the hit window,
     *  headroom (deck slabs, the wide fields' height classes, spawn fit) and the spatial muzzle cover a giant as drawn.
     *  Radius and footprint keep the class values. Authored bosses keep their encounter body. On by default since the
     *  size-extremes flip; false, or xlContinuous off = the class height × tilt, as before (bit for bit) */
    xlTall: true,
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
    /** the basic attack a species with no damaging level-up move opens a run with and tags in with (its opening move
     *  and Tag Action: src/sim/progression.ts firstAttacks, src/rules/tags.ts tagLineOf). Must be a damaging move row */
    fallbackAttack: 'tackle',
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
  stage: {
    count: 4, // [I] stages per region
    bossAt: 300, // [B] s
    finalSwarmAt: 480, // [B] s (if the boss is still alive the swarm begins)
    portalRadius: 2.2,
  },
  // Aimed combat (blueprint section 4). Every slot casts while its button is held (hold repeats on cooldown):
  // slot 0, the basic attack, is primary fire; slots 1-3 are Move A, Move B and the Signature. Dash and Guard share
  // Reflex charges.
  combat: {
    /** 'aimed' = the basic attack fires on its button along your aim; 'assist' = it fires on its button at the
     *  nearest enemy; 'auto' = every move fires on its own at the nearest enemy (the original survivor controls) */
    mode: 'aimed' as 'aimed' | 'assist' | 'auto',
    /** true = the basic attack, even while its button is held, casts only at an enemy in reach (the rule before
     *  primary fire; the replay-hash regression tests use it to match older builds). false = it fires along the aim */
    basicNeedsTarget: false,
    magnetDeg: 12, // shots bend toward an enemy this close to the aim line
    meleeMagnetDeg: 28, // strikes, cones and spins
    manualCdMult: 1.5, // Move A / B / Signature on their buttons: longer cooldown... (never the basic attack)
    manualDmgMult: 1.5, // ...and harder hits, so damage per second matches the automatic tuning
    /** [C] Phase 3 fire buffer, s per slot (basic attack, Move A, Move B, Signature): a press (InputFrame.press) that
     *  arrives while the slot is no more than this from ready (cooldown, or wind-up then cooldown) is queued and casts
     *  exactly once on the ready tick, even if the button was let go. Earlier presses are dropped ('early'), a second
     *  press while one waits adds nothing, and Tag or carrying the egg cancels it. 0 = no buffer (presses during the
     *  cooldown are dropped, the rule before Phase 3). Holding still repeats on the cooldown either way. Only explicit
     *  presses queue: the bot and scripted input that send no `press` never do, so no replay hash depends on it.
     *  Move A / B and the Signature stay 0 until playtested (the Signature's button is also Tag) */
    fireBuffer: [0.15, 0, 0, 0] as number[],
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
    /** the Tag Action's move level, flat since the pivot (Q26): the old squad-level-10 value (1 + floor(10 / 5)) */
    tagActionLevel: 3,
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
    /** a bramble cell (src/sim/cells.ts): how long it lasts (s) and the speed × of a non-Grass enemy in it */
    brambleTime: 10, brambleSlow: 0.55,
    lightIcd: 1, // s between light coats or light reactions on the same creature
    steam: { light: { r: 2, t: 2 }, deep: { r: 4, t: 4 } }, // cloud: enemies inside lose their target and stop shooting
    freeze: { light: 1, deep: 3, shatter: 2 }, // s frozen; the next physical hit or push deals x2
    conduct: { light: { r: 2, stun: 0.3, mult: 0.5 }, deep: { r: 6, stun: 1, mult: 1 }, maxTargets: 12 },
    overload: { light: { r: 1.5, mult: 0.6, knock: 6 }, deep: { r: 3, mult: 1.2, knock: 12 } },
    /** base damage of a reaction that a tile starts (no hit to scale from): flat since the pivot (Q26), the old
     *  squad-level-10 value (10 + 2 × 10) */
    tileStrength: 30,
    /** burn strength a burning tile gives a creature standing on it (no attacker to scale from; Q40): the old
     *  squad-level-10 value (6 + 0.8 × 10) */
    tileBurn: 14,
    soakedFire: 0.5, // Fire damage into a Soaked creature
    /** crowd-control meter: after `limit` s of stun / freeze / root inside the decay window, immune for `immune` s */
    cc: { limit: 2, decay: 1 / 3, immune: 4, bossMult: 2 },
  },
  // [I] Procedural world (docs/WORLDGEN.md, Procedural Pokémon World Blueprint). `mode: 'authored'` keeps the
  // handcrafted arenas exactly (replay checksums unchanged); 'generated' builds each listed biome's region from the
  // stage seed (seed + stage*7919 + loop*104729) with src/world/gen. Biomes not listed stay authored.
  worldgen: {
    mode: 'authored' as 'authored' | 'generated',
    biomes: ['meadow', 'badlands', 'frost', 'dusk'] as string[],
    size: 128, // tiles (m) per side of a generated region
    version: 2, // goes in the map id, the map checksum and the replay; bump when the generator's output changes
    regionSeed: -1, // ≥ 0: use this region seed for every stage instead of the run's (experiments: hold the map, vary the run)
    /** an authored arena that replaces every stage's map: 'range' is the training range (src/world/arenas.ts) */
    arena: '',
    /** Pokémon locations (src/world/locations, docs/LOCATIONS.md): a stage biome listed here is built by the location
     *  generator (src/world/locgen) from that location's data instead of the classic generator. '' = classic. Chosen
     *  where the stage's spawn table fits the place's canonical ecology; any location can be forced with ?loc=. */
    locations: { meadow: 'viridian-forest', dusk: 'mt-moon', badlands: '', frost: '' } as Record<string, string>,
  },
  // [I] W4 materials (rules/surfaces.ts): trees, bushes and rocks have a material, burn, break and leave stumps or
  // rubble; wall and platform become a mutable overlay; a watchdog keeps the map reachable. false = today's rules.
  // [I] Habitat maps (src/world/habitat, docs/HABITATS.md): vent fields erupt on a fixed cycle of stage time, so the
  // hazard state is a pure function of time (the validator checks the dormant and venting states; the warning is the
  // escape window for anyone already in the field: 1.5 s at a walk covers more than the 4-tile exit bound).
  // `pct` is the share of an actor's maximum HP one damage tick takes (5 ticks per eruption = 10 %), the same for the
  // trainer and every creature; `bossMult` scales it for bosses and alphas. `ice` is the lifecycle of a frozen water
  // tile (docs/HABITAT_STATES.md): it cracks `crack` s before it thaws (a cue), and an actor still on it when it opens
  // is put on the nearest dry shore and loses `dunk` of its maximum HP (never its last HP).
  habitat: {
    vent: { period: 10, warn: 1.5, active: 2.5, pct: 0.02, bossMult: 0.3, tick: 0.5 },
    ice: { crack: 2, dunk: 0.1 },
    // a tidal map (HabMeta.tide, docs/HABITATS.md "Tide"): one cycle of `period` s of stage time, low water for the first
    // `low` s, then `warn` s of rising-water warning (still dry), then high water to the end of the cycle (the tidal floor is
    // open water). low = period: always low; low = warn = 0: always high. A pure function of the sim tick, like the vents.
    tide: { period: 90, low: 44, warn: 8 },
  },
  // [I] Liquid exposure and exposed falls (sim/hazards.ts, docs/HAZARDS.md). Every Pokémon can walk into open water
  // or lava and back out; only actual geometry (walls, faces higher than a step, decks) stops movement. A Pokémon in
  // contact with a liquid it is not safe in loses maxHp / `lethal` per second of simulation time (whole HP points,
  // the fraction carried between ticks), and is knocked out when its exposure reaches `lethal` s, whatever healing it
  // got meanwhile. Reaching supported dry ground (or becoming compatible) ends the exposure; crossing between cells of
  // the same liquid, or a hop above it, does not. Overlapping liquids: the shorter `lethal` wins.
  //   water  safe for the Water type (any slot of a dual type) or a Pokémon whose move set holds a `safeMoves` move
  //   lava   safe only for species listed in `safeSpecies` (an explicit flag: nothing is configured, so every
  //          Pokémon is vulnerable; a Fire-type rule would be a design decision, not a default)
  // `speed` multiplies an exposed Pokémon's walking speed (a safe swimmer keeps `safeSpeed`); `jump`: whether an
  // exposed Pokémon can jump out of the liquid. A ground actor whose centre is over a void tile (a location map's
  // chasm) has no support and falls; below the map's floor minus `killDepth` m it is knocked out (once). After a
  // hazard knockout the next Pokémon comes in on the last supported dry ground the trainer stood on (`recover`).
  // `enabled: false` restores the earlier rules (liquids and chasms block as walls): replay checksums unchanged.
  hazards: {
    enabled: true,
    water: { lethal: 5, speed: 0.75, safeSpeed: 0.95, jump: false, safeTypes: ['tide'] as string[], safeMoves: ['surf'] as string[] },
    lava: { lethal: 3, speed: 0.7, safeSpeed: 0.9, jump: false, safeSpecies: [] as string[] },
    /** m: feet within this of a liquid's surface are in contact with it (the volume's top) */
    contact: 0.3,
    /** m: the highest bank a body in a liquid can climb out onto (a dry step is rules.player.stepHeight); some banks
     *  stand 0.75 m above the water on classic regions */
    climbOut: 0.8,
    killDepth: 3,
    /** knockback (m/s) above which an enemy at a lip is carried over it rather than holding its footing */
    forcedKnock: 2,
    /** s between damage-number cues while exposed */
    cueEvery: 0.25,
    recover: 'lastSafe' as 'lastSafe',
  },
  // [C] Traversal capability templates (src/rules/traversal.ts, docs/LOCOMOTION.md "Capabilities"). A species names
  // template ids (src/rules/profiles.ts `traversalOf`); these rows hold their numbers. Retuning a row changes every
  // species that holds it; a species that needs different numbers names a template of its own.
  locomotion: {
    templates: TRAVERSAL_TEMPLATES,
  },
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
    /** carrying a body (src/sim/carry.ts): the carrier's speed ×, the pick-up reach beyond body + partner radius (m), a
     *  Raider's grab reach (m), and where it rides: ahead of the player, behind an enemy (m) */
    carry: { speed: 0.7, reach: 0.3, raiderReach: 1.2, front: 0.9, behind: 0.6 },
    /** Lasso on a creature (a move's `lasso` spec flag, src/sim/capabilities.ts creatureForce): s it is suspended before
     *  the throw (a manual move lets go early); the throw's speed rule is the body rule, 8 x (1 + 0.5 x (Power - Weight)) m/s */
    lassoHold: 0.6,
    /** capability events kept for the death recap and pokewatch.debug('caps') */
    logSize: 512,
    recapSeconds: 5,
  },
  /** enemy actions any behaviour can use (src/sim/actions.ts) */
  actions: {
    /** a thrown heavy body (Rock Throw): wind-up (s, its path drawn this long and wide, m), the roll's speed (m/s), its
     *  damage × the thrower's contact damage at full speed, the gap before a queued second throw (s), how far ahead of
     *  the thrower's radius it starts (m), and the body template */
    throw: { windup: 0.6, speed: 11, dmg: 1.5, again: 1.5, offset: 1.3, lineLength: 26, lineWidth: 2.2, template: 'boulder' },
  },
  bosses: {
    // extra attacks layered on a boss's roster kit: Rock-type bosses roll boulders at you
    extraAttacks: { sudowoodo: ['boulder'], magcargo: ['boulder'] } as Record<string, string[]>,
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
