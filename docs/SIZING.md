# Size classes

Every Pokémon belongs to one of five size classes. A class decides how big the Pokémon is drawn and how big its body is in the sim, so a Pokémon that looks bigger is also hit, pushed and routed as bigger. Tunable numbers are in `rules.size` in `src/rules/defaults.ts`. The logic is in `src/rules/sizing.ts`.

## The classes

| Class | Canonical extent | Drawn core (`visual`) | Hurt radius (`radius`) | Sim height | Footprint (`body`) | Examples |
|---|---|---|---|---|---|---|
| Tiny | < 0.35 m | 0.70 m | 0.32 m | 0.6 m | 0.30 m | Rattata, Joltik, Pichu, Diglett, Litwick |
| Small | 0.35 – 0.65 m | 0.98 m | 0.42 m | 0.9 m | 0.40 m | Charmander, Sandshrew, Pikachu, Murkrow |
| Medium | 0.65 – 1.15 m | 1.37 m | 0.52 m | 1.2 m | 0.46 m | Bulbasaur, Slugma, Sentret, Sneasel |
| Large | 1.15 – 2.05 m | 1.92 m | 0.68 m | 1.7 m | 0.66 m | Charizard, Heracross, Gengar, Furret |
| Extra Large | ≥ 2.05 m | 2.69 m | 0.90 m | 2.4 m | 0.88 m | Onix, Snorlax, Lapras, Feraligatr |

Three sizes are configured separately, and nothing derives one from another at runtime: `visual` is how big it is drawn, `radius` is what hits it (hurtbox, contact and crowd reach), and `body` is the movement footprint, the circle walls, faces and deck slabs stop (see "Footprint" below).

- **Steps between classes.** Each class is about 1.4× the one below.
- **Tilt.** Within a class a Pokémon is tilted by at most ±8 % (`rules.size.tilt`). The tilt depends on where its extent sits in the class band, on a log scale. The open ends use `rules.size.extentRange` (0.1 m and 6 m). Two Pokémon in the same class therefore look nearly the same size, and an evolution that stays in one class still grows a little.
- **No overlap.** The largest Small is drawn at 1.06 m and the smallest Medium at 1.26 m. `tests/sizing.test.ts` asserts this.

### Why fixed class targets

The previous version (and the reference `pokemon-size-classifier.ts`) drew from a continuous curve, `clamp(1.25 · S^0.45, 0.78, 2.55)`. With that curve the class was only a label. A 0.64 m Small and a 0.65 m Medium drew identically, and neighbouring classes were only about 25 % apart. Before and after, at one fixed camera (`tools/sizescenes.json`, scene `size-class-row`):

| | Rattata | Sandshrew | Slugma | Heracross | Onix |
|---|---|---|---|---|---|
| continuous curve | 0.78 | 0.99 | 1.06 | 1.50 | 2.55 |
| class targets | 0.74 | 1.04 | 1.29 | 1.91 | 2.91 |

What was kept from the classifier:
- The five bands and their cuts.
- Neutral-body versus listed-extent inputs.
- A narrow version of its projected profile (Wide, below).
- The idea that encounter-scale Pokémon (bosses) keep authored scale.

What was dropped:
- The continuous curve and its clamp.
- The 3-axis shape profile, because no asset has 3-axis bounds.
- `scaleSpriteFrame`, because the renderer already scales against the idle feet anchor.

## Which class a Pokémon gets

`bodyOf(species)` in `src/rules/sizing.ts` checks these in order:

1. **`sizeClass`** in `SPECIES_OVERRIDES` (`src/rules/profiles.ts`) pins the class. The Pokémon sits at the class centre, with no tilt.
2. **`NEUTRAL_CORE_EXTENT_M`** (`src/rules/sizing.ts`) is a reviewed figure for a Pokémon whose listed extent measures the wrong axis. Onix's 8.8 m, for example, is the serpent's length.
3. **`canon.heightM`** is the published figure, imported from PokéAPI.
4. **`SpeciesDef.height`** is the old sprite-derived number. It is used only by a species with no canonical record.

Bosses (`SpeciesDef.scale`, authored 2–3×) keep their encounter scale. The class rules don't change how they are drawn, and their sim body is the drawn one.

## Who reads what

| Concern | Reads | Where |
|---|---|---|
| Drawn size | `visualM ÷` the asset's neutral core | `src/render/renderer.ts` (`speciesSizing`) |
| Enemy collision and hurt radius | class radius × role size (elite ×2, alpha ×3) | `src/sim/enemies.ts` (`enemyRadius`) |
| Enemy vertical hit window, hit-number height | class height × role size (`E.tall`) | `src/sim/effects.ts`, `combat.ts`, `hazards.ts`, `cells.ts`, `coats.ts` |
| Partner collision and hurt radius | class radius clamped to `rules.size.playerRadius` (0.48–0.72 m) | `partnerRadius`, read by `effects.ts`, `enemies.ts`, `bodies.ts`, `objectives.ts`, `cells.ts`, `hazards.ts` |
| Partner vertical hurt window | class height | `partnerHeight`, `effects.ts` |
| Spatial shot and beam muzzle (Phase 2B, beams Phase 2C) | class height × `rules.aim.muzzle.up` (0.6) above the feet, footprint × `muzzle.fwd` (0.9) ahead | `src/sim/aim.ts` (`resolveSpatial`); beams `src/sim/moves.ts` (`beam3D`) |
| Spatial beam contact (Phase 2C) | enemy cylinder `E.y .. E.y + E.tall` × `E.radius` (class × role) met by the beam's half-width, up and sideways | `src/sim/moves.ts` (`beam3D`) through `src/sim/spatial.ts` `sweep` |
| Wall and terrain collision | footprint (`footprintOf`, `partnerFootprint`) | `World.moveBody`, read by `player.ts`, `enemies.ts`, `bodies.ts` (resting-body contact) |
| Headroom under decks (R1) | sim height: partner `partnerHeight`, enemy `E.tall` (class height × tilt × role size) | `World.collides` / `moveBody` / `fits` / `nearestFit`, `World.headroomAt` (jump clamp in `player.ts`), wide fields per height class (`World.wideDir`, `wideGoalDir`, `wideReached`), `director.ts` spawn gate |
| Navigation class | footprint ≥ `rules.size.heavyRadius` (0.5 m) is wide (`navWide`) | `src/sim/world.ts` (wide field), `src/sim/director.ts` (spawn room), `src/world/locgen/validate.ts` (`wide` gate) |
| Habitat navigation profiles | partner and enemy footprints from the spawn pools | `src/world/habitat/mode.ts` (`profilesFor`) |
| Weight class (guard, push, knockback) | canonical mass, not size | `weightClass` in `src/rules/species.ts` |
| Third-person camera framing (2026-11-18) | `visualM` sets the boom (one law, `CHASE_CONFIG.frame`) and so the shoulder offset; class height × 0.8 sets the pivot | `src/render/chaseinput.ts` (`chaseSubject`), `src/render/camera.ts` (`chaseBoom`, `chasePivot`); `docs/THIRD_PERSON.md` "Size" |

Planar (legacy) shots still leave a partner from a fixed +0.8 m, so muzzle and eye heights for the habitat validator stay on the sprite-derived heights. Spatial shots (the chase camera's direct shots, `docs/THIRD_PERSON_IMPLEMENTATION.md` §13) leave from the class muzzle in the row above: Tiny 0.36 m, Medium 0.72 m, Extra Large 1.44 m up.

- **The neutral asset reference.** The renderer divides by the idle frame 0 facing the camera: `CreatureArt.heightPx / 16`. This is never the frame being drawn, so proportions and feet anchors survive animation.
- **Wide normalisation.** An idle frame at least `rules.size.wideRatio` (1.5) times wider than tall is normalised on `width / 1.5` instead of its height. This applies to long and low bodies such as Lapras, Cetoddle and Diglett's mound, so they are not drawn oversized.

### Partners

Partners are size-aware too. Small starter forms get a 0.48 m hurt radius (it used to be a shared 0.55 m), and evolved Large and Extra Large forms grow to 0.72 m. Evolving trades a bigger target for more push. The clamp keeps the change modest.

Measured over 36 bot runs (6 partners × 6 seeds, 7 minutes, `rules.size.geometry` on versus off):

| Partner radius floor | Bot survival |
|---|---|
| 0.42 m | +17 % |
| 0.48 m (default) | +10 % |
| 0.55 m | ±0 % |

The partner's footprint is its class `body`, uncapped: an Extra Large partner (Feraligatr, 0.88 m) is physically bigger than a Large one (0.66 m), while its hurtbox stays inside the 0.48–0.72 m clamp above. Large and Extra Large partners cannot use one-tile chokepoints.

## Footprint

Every ground body collides with solid geometry as a circle of its footprint (`World.moveBody`, `src/sim/world.ts`), with size geometry on. One rule decides what is solid: `World.collides` read at the centre and at the circle's nearest point inside each tile it covers.

- **Values.** A one-tile passage (1.0 m) fits Tiny, Small and Medium bodies (footprint < 0.5 m) and stops Large and Extra Large ones. Medium's footprint (0.46 m) sits under its 0.52 m hurtbox on purpose, so the most common wild class keeps using the locations' chokepoints. There is no tilt: passability belongs to the class.
- **Role sizes.** An elite (×2), an alpha (×3) or a boss scales its footprint up to `rules.size.bodyCap` (0.95 m). Pursuers must fit the two-tile routes the location and habitat gates guarantee to every mandatory space. Three-tile routes reach the boss hall on only 6–14 of 30 location seeds, and widening every essential route would flatten the locations. So an elite Tiny is 0.60 m, an elite Small 0.80 m, an elite Medium 0.92 m and anything bigger 0.95 m, smaller than its hurtbox. Raising the cap means a config value plus a three-tile gate (the lattice takes the block size as a parameter).
- **Substeps.** A move is cut into steps of at most 0.25 m, so a dash (24 m/s) or a knockback never tunnels through a corner.
- **Corners and pinholes.** The circle is pushed out of what it overlaps, so it glides round a corner into a passage it fits. Two walls touching only at a corner are closed: the point collision let the trainer through that zero-width gap.
- **Where faces are measured from.** While grounded (feet within a step of the surface), faces are measured from the surface under the centre. The feet lag a tick on a slope, and a terrace beside a ramp read as a step from them. While airborne (a jump, a ledge drop, a fall), faces are measured from the feet. A tile diagonal to the centre's tile is measured from the higher of the two orthogonal tiles between them, which is the block rule below.
- **Drops and landings.** A body only drops off a ledge where it fits once it lands, and it lands clear of the lip it left. A body landing from a fall has its footprint cleared on the landing tick, because faces were measured from its feet on the way down.
- **Escape.** A move is accepted when the overlap does not grow, so a body left in a tight spot (an evolution inside a corridor) walks out of it and never further in. A push is applied only when it clears something.
- **Resting bodies.** A loose rock pushes the partner out by rock radius plus footprint. The hurtbox only decides what a thrown body hits. Loose rocks (`seedBodies`) are only scattered where a 7 × 7 patch is walkable, so a wide route always goes round one.

With size geometry off, every footprint is 0 and the old point collision runs unchanged. Headroom is a separate flag
(`rules.size.headroom`); every older checksum layer turns it off too.

### Navigation classes

A footprint under `rules.size.heavyRadius` (0.5 m) is **narrow**: it routes on tile centres, the ordinary flow field. A circle under 0.5 m at a tile centre fits its tile, and a four-way step stays inside the two tiles, so a route on that field is traversable.

A footprint from 0.5 m up is **wide**: it routes on the wide block lattice (`src/world/navblocks.ts`). A node there is a 2 × 2 block of tiles, centred on their shared corner. A block is wide when each tile gives one node (its ground, or its deck on a bridge) and the four orthogonal edges inside it are symmetric steps. Two blocks are linked when their shared tiles are the same nodes.

- A circle under 1 m moved between linked block centres stays inside their open union.
- Footprints under 0.7 m (Large) may also take a diagonal-only link (`DIAG_R`). That is how a Large body follows a two-tile trail stepping along a diagonal, which is about 1.41 m across, where an Extra Large body does not fit.
- Wide routes take no ledge drops, so they are conservative.

The sim (`World.wideDir`, `wideGoalDir`) and the location validator (`wideCore`, the `wide` gate) read the same predicate.

- **The field is the authority.** A wide body follows the wide field whenever it has a route, and steers straight only beside the player. Point probes cannot tell whether a lane its width needs is clear: a drop off a bridge it would not fit below reads as open.
- **Seeding.** The field starts from the blocks covering the player's own node when it stands on wide ground. Otherwise it starts from the closest wide blocks within `rules.size.wideSeed` (4) ordinary steps, so a wide body comes as close as the ground allows. Seeding every nearby block at its ordinary distance made false minima, which held a walker 3.7 m short.
- **Cost.** The field is rebuilt when navigation changes, when the player changes layer, or when the player moves more than a tile from where it was built, not on every tile crossed. Each wide block's nodes are cached with the mask, and so are its links (`wideLink`, filled on first use and dropped with the mask on every navigation change). The field search pops every block it reaches, and recomputing up to 8 link tests on each pop made a rebuild cost 0.65 ms. With the cache it costs 0.18 ms, with the same fields (checked against the uncached search on every rebuild over all maps, with ice and tide). The field-agreement check below runs every fourth tick per walker. `perf-sim 500 --repeat 3`, min of 3: p50 0.38, p95 0.49, p99 0.84 ms (before the size classes: 0.24 / 0.47 / 0.54 ms; with the uncached search: p99 1.78 ms; the gate is 2 / 3 ms). The same loop on generated maps gives p99 0.85 ms on Mt. Moon (0.58 before the size classes) and 1.43 ms on River Gorge (0.92). River Gorge's top ticks are an ice change: the mask rebuild (0.7 ms), the first search after it (it fills the links), and footprint substeps in the same tick.
- **No route.** A wide body whose block is off the field, with no reached block within 2 tiles, has no route and holds: `wideDir` returns -1, and it never squeezes. After `rules.enemy.holdRelocate` (6 s) it is moved like a far enemy, onto ground the wide field reaches. If there is none, it keeps holding.
- **Placement.** Spawns, relocations and rescues put a body where it fits (`World.nearestFit`). A wide body goes on a block the wide field reaches, so it is never left in a pocket only narrow routes join, and it is never spawned at a narrow-only anchor (`allowedAt`).

The same pass fixed four pursuit defects, all present with point collision too and gated on size geometry so replay layers keep their hashes:

- The ordinary field now only steers at a neighbour the walker can step to. It used to point a walker at a cheaper tile across a face beside a diagonal ramp, forever.
- Once its way ahead is blocked, a walker keeps to the field for `rules.enemy.navHold` (0.4 s). A probe sitting on a tile edge flipped the test every tick, and the walker stood still.
- A walker steers straight only while straight agrees with the field (less than 90° apart). A player on a terrace reached by a ramp behind the walker used to draw it back and forth between a dead end and the ramp.
- A walker does not steer straight off a ledge (ground more than 0.6 m below its feet at the near probe) toward a player who is not below it. A Sandshrew that had climbed a ramp to the player's terrace walked off the terrace edge, landed at the ramp's foot and climbed again, round and round (tropical-lagoon seed 3). With the player below, the drop is still the short way down.

Earlier both the sim and the validator accepted a 2 × 2 block only when the spread of its four heights was ≤ 0.6 m. On a diagonal ramp the orthogonal steps are ≤ 0.45 m but the diagonal spans 0.61–0.67 m. Every ramp tile read as too narrow, and a bridge abutment (two ground tiles, two deck tiles) fitted neither layer. That is why a two-tile boss route looked missing on 27–63 % of location seeds. With the edge rule it exists on 30 of 30 seeds in each location (wideAnchors 99–100 %).

## Headroom

A body's sim height meets deck slabs (`rules.size.headroom`, on by default; R1 of the spatial roadmap, ledger Stage 6C in
`docs/THIRD_PERSON_IMPLEMENTATION.md`). The height is the one the hurt window already uses: the class height with its tilt,
times the role size for enemies (`E.tall`), the class height for the partner (`partnerHeight`).

- **Gaps.** A deck is a 0.6 m slab (`DECK_SLAB`). The generators keep every deck top 2.9 m above the ground under it
  (`CLEARANCE` in `locgen/decks.ts` and `habitat/validate.ts`, a rule against hopping on from below), so the gap under the
  slab is at least 2.3 m. On the shipped maps it is exactly 2.40 m on Viridian Forest, Chargestone Cave, River Gorge and
  Tidal Cave (a 3.0 m deck on flat ground) and at least 2.9 m on Mt. Moon and Volcanic Ridge (5 seeds each, 2026-11-16).
- **Who fits.** Every Tiny, Small, Medium and Large body, and every Extra Large one except Onix (2.59 m), fits a 2.4 m
  gap. An Extra Large body at exactly the class height (2.4 m) fits it (`HEAD_EPS`, 1 mm, absorbs float32 heights). Elites
  from Medium up (2.26–5.18 m), alphas and bosses (3.4–4.5 m) do not.
- **Movement.** `World.collides` treats a deck tile as solid for a body whose head would be in the slab: it stands at its
  feet or on the ground there, whichever is higher, plus its height. Through `World.moveBody` the footprint test applies
  it to every tile the circle covers, so a tall body stops with its edge at the deck's edge, walking or in the air.
- **Jumps.** A rising head stops at the lowest underside over the footprint (`World.headroomAt`); the jump's speed is
  spent and gravity brings the body down. A falling body is never clamped. A head already inside a slab (a body evolved
  under one) rises no further.
- **Routing.** The wide fields come in height classes. Each wide block knows its lowest gap under a deck; the distinct
  gaps of the map are the class steps, and a body's class is how many of them it is taller than. The fields for class
  *c* leave out the blocks whose gap is one of the *c* lowest. So a body routes under a deck it fits and round one it does
  not, and the director's spawn gate (`allowedAt`) and placement (`nearestFit`) judge reach the same way. Maps without
  decks, and bodies that fit every gap, have one class (0), which is the field from before.
- **The ordinary field has no height classes.** That is sound while no narrow body (footprint under `heavyRadius`) is
  taller than the lowest gap the generators allow. `tests/headroom.test.ts` asserts it for every species and role size.
- **What it changed.** `navwalk all 5`: every mandatory space is still reached by every class, including Onix and a
  Heracross elite (3.38 m); no mandatory route needs the space under a deck. Only the `gen` checksum set moves (two of its
  four runs): an elite reroutes round a low gap, and a generated map's spawn spot drops Onix from the pool where its
  height class has no route (the same draw then picks another species). `gen-headroom-off` prints the earlier `gen`
  hashes.
- **Not covered here.** Enemy fliers hover with no wall or slab test (R7 moves them onto the shared movement).
- **The chase camera (F5, fixed 2026-11-18).** The camera's pivot used to follow the drawn sprite (0.8 × 2.7 m for Extra
  Large), above a 2.4 m slab's lens clearance, so an Extra Large partner that fits the gap folded the lens onto its back
  (815 safety-net slides in a camstats run, 9 m lens jumps walking out from under a deck). Since the camera's second pass
  (2026-11-18) the pivot sits on the sprite's outline again, as drawn, and the slab decides: a deck over the Pokémon, the
  shoulder arm or the back arm lowers the pivot to 0.45 m under it and caps the arm's elevation, both eased
  (`docs/THIRD_PERSON.md` "Decks").

## Wall tops

A wall prop (tree, fence, boulder, building) is solid only up to its measured height, for every reader that opts in
(`rules.world.wallTops`, on by default; R1b of the spatial roadmap, ledger §23 in `docs/THIRD_PERSON_IMPLEMENTATION.md`).
Before it every wall tile was a column of infinite height for bodies, shots and the lens.

- **One height per kind.** `PROP_RULES[kind].top` (`world/tiles.ts`): the tallest drawn variant over the eight biome
  palettes, unstretched (the sprite's opaque rows at the billboard shader's alpha cut, ÷ 16 px per m), rounded **up** to
  0.05 m so the art never pokes out of the collision. `tests/walltops.test.ts` re-measures the painters and fails when the
  table and the art drift apart. Values (m): fence 0.90 · hedge 1.00 · sign 1.10 · thicket 1.20 · crystal 1.35 · boulder,
  berry 1.60 · lantern 1.65 · well 1.90 · tent 1.95 · pillar, stalagmite, moonstone 2.00 · lamp 2.40 · statue 2.50 ·
  shrine 2.60 · blossom 2.65 · round 2.70 · tree, tree2, icepine, magnetite 2.75 · deadtree 2.95 · gatehouse 3.20 ·
  cabin 3.75 · elder 5.20.
- **Per tile.** `World.wallTop` (`wallTopsOf`): a footprint tile's top is the prop's footing (the elevation of its
  bottom-left tile, where the renderer stands the card) plus its `top`, and never less than the tile's own ground (a prop
  forced across a cliff keeps the higher tile's rock). A tile with no wall prop is `Infinity`. A prop that burns or breaks
  clears its tiles' tops in the same `World.setBlock` call.
- **Bare walls stay infinite.** Rock masses, cave walls, sealed ground, the map edge, and the habitat's low ruin, broken
  and cemetery walls (1.1–1.4 m, stored as wall tiles with raised elevation and no prop): containment, the validators'
  reachability and sealed zones assume them. The low walls are a recorded limitation, for when generation, navigation and
  validation change together.
- **No roofs.** Caves are open-top by design (the dark vault, `docs/LOCATIONS.md`); nothing overhead exists for a roof to
  follow. A flier's altitude limit is R6d's movement rule.

Who reads the tops (everyone else keeps every wall infinite):

| Reader | How it opts in |
|---|---|
| The player's attack traces: the camera trace, the muzzle, bolt and orb flight, beams, device assist, and the aimbot of the `aim` sets | `QF.tops` from `combatFlags` (`sim/aim.ts`) on `sim/spatial.ts`'s wall column |
| The chase lens | `render/chaseinput.ts`: it no longer reads `wallTop`. No prop stops the lens (trees, boulders, fences, buildings dissolve around it; owner decision 2026-11-18, which replaces Q10). Only a bare wall is solid for it, at every height, or up to the underside of a deck over it |
| A body with the crossing permission | `over` on `World.blocks` / `collides` / `fits` / `moveBody` and `LocoTick.over`. **No driver passes it before R6d** (a traversal template grants it); walking, jumping, gliding and every enemy meet walls as before |

- **Crossing above a top** (bodies with the permission): the feet must be at or above the top. The swept vertical move
  stops a descending body at the top (`World.topUnder`) without grounding it: a top is not a support (`World.height`,
  `support` and navigation never report one), the body keeps its integrator, and nothing relocates it. The rock recovery
  (`World.inRock`) leaves a permitted body above a top alone and snaps everything else exactly as before. Losing the
  permission while above a prop (a Tag swap, a capability ending) is R6d's declared transition (T31).
- **Level fire over low cover** (muzzle = 0.6 × class height): Large (1.02 m) and Extra Large (1.44 m) clear a fence;
  Extra Large alone clears a sign, a thicket and a crystal; no class fires level over a boulder (1.60 m). Hedges and berry
  bushes are foliage, already open to the player's shots at any height (Phase 2C); their tops matter to permitted
  bodies. A shot
  clears a prop only where its own line is above the top at the prop: an aimed-up shot passes a boulder, a level one stops
  on it (`tests/walltops.test.ts`, G11).
- **Steep views.** Billboards stretch up to 1.6× (third person) and lean back past 51°, so from above a canopy is drawn
  taller than its collision. The collision follows the unstretched art and never grows to match the presentation: a shot
  seen from overhead can pass through the top of a drawn crown it physically clears.
- **Not changed here.** `World.sight` (enemy line of sight) and enemy fire stay infinite until R7 moves both together;
  planar player families (homing, boomerang, lob…) until R4; enemy fliers skip every wall (R7); the habitat and location
  validators (`sightAbs`, `laneField`, `sightTiles`) keep infinite walls, so on some lines combat and validation now
  disagree (the cover report, `scripts/covercheck.ts`).
- **Hashes.** Only `aim` moves (one run, a Water Gun bolt passing 6.6 m over a border tree); `aim-tops-off` prints the
  `aim` hashes from before, and every older set turns the flag off.

## Turning it off

`rules.size.geometry: false` brings back the pre-size-class sim:
- radius `clamp(sprite height × 0.4, 0.35, 3.2)`;
- the role size as the hit height;
- one shared 0.55 m partner radius and a fixed 1.2 m hurt window;
- point collision (no footprint) and no wide-body routing;
- the older pursuit rules (no step check on the field, no hysteresis or field agreement) and the older bot probes.

`npx tsx scripts/checksum.ts size-off` prints those hashes. With the classic region tables it reproduces the earlier `on` set. The only exception is the `World.shore` fix that landed with this work: a bank behind a wall is no longer preferred. Every older layer (`off`, `build-off`, `world-off`, `hazards-off`) turns size geometry off too.

## Checking it

- `npx tsx --test tests/sizing.test.ts tests/navsize.test.ts tests/footprint.test.ts tests/walltops.test.ts`
- `npx tsx scripts/covercheck.ts [seeds] [pairs]` reports what wall tops change for cover: the census, which barrier props
  each class fires over level, sampled lines of fire opened by the tops, and the objective sightlines where combat and the
  validators now disagree. Report only.
- `npx tsx scripts/navwalk.ts [location|habitat|all] [seeds]` drives real walkers of every class (Medium, Large, Extra Large, an elite) and the trainer (Small and Extra Large) to every target. Mandatory targets must be reached. A size-restricted optional target must be reached by the narrow body and refused by the wide ones. No grounded walker may end a tick overlapping solid geometry.
- `npx tsx scripts/stuckwatch.ts [map|all] [seeds] [seconds]` watches live bot runs for movement deadlocks of the bot and of enemies that have a route. A relocated enemy (far or holding) starts a new episode. A bot episode is `pinned` when the bot also walked under 2 m in the 5 s; the others are the bot walking back and forth between threats or shoved in a crowd. Every bot episode is also checked for a way out (`escapeOf`, with the partner's own footprint through `World.moveBody`). It is `TRAPPED` when no heading moves it onto ground it may stand on, or when the ground it can walk to is a pocket under 48 tiles (`World.shore`'s trap size). The walk is a flood over the world's 0.5 m points (tile centres and corners, the middles of one- and two-tile passages), so a one-tile exit lets a Small partner out but not an Extra Large one (`tests/footprint.test.ts`). The probe only reads: `STUCK_PROBE_ALL=1` runs it every window, and the end states match a run without it. `TRAPPED` must be 0. `all 3` on 2026-11-16: 34 bot episodes (1 pinned, 0 trapped), 1 enemy episode in 114,805 enemy-seconds; with `STUCK_RULES='{"size":{"geometry":false}}'`, 55 bot and 796 enemy episodes.
  - The pinned one (tropical-lagoon seed 3, Totodile, at -24.4,-21.4) is the bot's heading search: the only way out is a one-tile strip due south, and none of the sampled turns points down it. The partner fits the strip (`escapeOf`: 9 of 16 headings free, 48+ tiles). This is a limit of the bot (`?autoplay` and the test driver, not play), and the bot is left as it is: changing it would move every bot-driven replay hash to make a harness look better.
  - The enemy one (river-gorge seed 2, a Poliwag) is a route change: Totodile's ice bridge melted (27 tiles) and the route to the player grew by 54 steps, so the walker turned back.
- `pokewatch.renderer.sizes()` in the browser prints class, target, multiplier and the Wide flag for every loaded sheet.
- `node tools/cap.mjs <html> tools/sizescenes.json <outdir> size-` captures a one-per-class row (`size-class-row`), a same-class row (`size-same-class-small`) and each region's newer Pokémon (`size-wave-*`). Build to a private folder first (CLAUDE.md).
