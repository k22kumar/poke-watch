# Size classes

Every Pokémon belongs to one of five size classes. A class decides how big the Pokémon is drawn and how big its body is in the sim, so a Pokémon that looks bigger is also hit, pushed and routed as bigger. Tunable numbers are in `rules.size` in `src/rules/defaults.ts`. The logic is in `src/rules/sizing.ts`.

## The classes

| Class | Canonical extent | Drawn core (`visual`) | Hurt radius (`radius`) | Sim height | Footprint (`body`) | Examples |
|---|---|---|---|---|---|---|
| Tiny | < 0.35 m | 0.70 m | 0.32 m | 0.6 m | 0.30 m | Rattata, Joltik, Pichu, Diglett, Litwick |
| Small | 0.35 – 0.65 m | 0.98 m | 0.42 m | 0.9 m | 0.40 m | Charmander, Sandshrew, Pikachu, Murkrow |
| Medium | 0.65 – 1.15 m | 1.37 m | 0.52 m | 1.2 m | 0.46 m | Bulbasaur, Bergmite, Sentret, Sneasel |
| Large | 1.15 – 2.05 m | 1.92 m | 0.68 m | 1.7 m | 0.66 m | Charizard, Heracross, Gengar, Furret |
| Extra Large | ≥ 2.05 m | 2.69 m | 0.90 m | 2.4 m | 0.88 m | Onix, Snorlax, Feraligatr, Hariyama |

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
2. **`NEUTRAL_CORE_EXTENT_M`** (`src/rules/sizing.ts`) is a reviewed figure for a Pokémon whose listed extent measures the wrong axis. Onix's 8.8 m, for example, is the serpent's length. Each entry is owner-reviewed and records its basis. Today there is one: Falinks, 0.5 m (the game draws one trooper; the listed 3.0 m is the six-trooper formation), Small instead of Extra Large.
3. **`canon.heightM`** is the published figure, imported from PokéAPI. A figure whose axis is `length` counts `rules.size.lengthRise` (0.5) × itself ("Measurement axis" below).
4. **`SpeciesDef.height`** is the old sprite-derived number. It is used only by a species with no canonical record.

Authored-scale species (`SpeciesDef.scale`, 2–3×: the four former bosses, ordinary species since pivot step 9) keep that scale. The class rules don't change how they are drawn, and their sim body is the drawn one.

### Measurement axis

A listed figure measures one of three things: standing height, body length or span. The official body shape decides which, through one data table, `SHAPE_AXIS` in `src/rules/shapes.ts`. `squiggle` (serpents) and `fish` (fins, flippers) list a length. Every other shape, and any shape added by a future generation, lists a height until a row says otherwise. The content build carries the shape into `canon.shape` from the pinned PokéAPI CSV snapshot (`pokemon_species.shape_id` → `pokemon_shapes`). `canon.axis` is derived from it when the roster loads. Catalogue records carry `shape` too. A species whose figure measures another axis than its shape says gets a reviewed row in `SPECIES_AXIS` (same file). The row names the axis only, never metres, so the shared rule still sets the extent. Eternatus (`wings`, 20 m of body length) is the one row, approved by the owner on 2026-11-18.

PokéAPI has no span figures, so no shape or `SPECIES_AXIS` row maps to `span`. Only an approved `NEUTRAL_CORE_EXTENT_M` entry written as `{ m, axis: 'span' }` can select it. An approved entry always wins.

The rule landed with the size-extremes flip (owner 2026-11-18; `docs/archive/size-extremes-plan.md` "Default flip") and is hard-wired since pivot step 10. Against reading every figure as a height:
- Onix's 8.8 m length reads as 4.4 m and it stays Extra Large.
- Lapras drops from Extra Large to Large, and Silicobra from Extra Large to Medium.
- Ekans drops from Large to Medium.
- Slugma and Magcargo drop from Medium to Small; Magcargo's authored body is unchanged.
- Dreepy drops from Small to Tiny. `npx tsx scripts/sizetable.ts` prints every runtime and catalogue species with its listed-figure class and its class. The decisions are recorded in `docs/archive/size-extremes-plan.md`.

### Giants: continuous Extra Large

An Extra Large Pokémon is drawn at `min(xlVisualCap, xlFloor × (S / 2.05) ^ xlExponent)`. The values are cap 4.0 m (provisional), floor 2.69 × 0.92 (today's lowest XL draw) and exponent 0.30. The exponent is a fixed constant, never fitted to the largest species, so a new generation's giant can't change every other XL draw. The cap is reached at about 10.2 m of extent. 2.05 m is Large's cut, so the floor stays above Large's largest draw and the classes never overlap. XL radius and footprint keep the class values and tilt; the sim height follows the draw (below). Tiny to Large are unchanged.

### Tall giants

An Extra Large body is as tall as it is drawn: its sim height is `visualM × (class height ÷ class visual)` (2.4 ÷ 2.69 = 0.892). That one height is what the sim reads everywhere a body's height matters: the hit window (`E.tall`, the partner's hurt window), headroom (deck slabs in `World.moveBody`, the wide fields' height classes, spawn fit and `nearestFit`) and the spatial muzzle (0.6 × height). Radius and footprint keep the class values, so the width of a giant's sprite stays outside its cylinder. Authored-scale bodies keep their own. Owner decision 2026-11-18 (`docs/archive/size-extremes-plan.md` §S3.10 A, xlTall section).

Heights: Onix 2.78 m, Hariyama and Feraligatr 2.29, Snorlax 2.22; the capture-only giants Wailord 3.23 and Eternatus 3.55. Layouts and the worldgen gates read footprints, not sim heights, so no `HAB_VERSION` or `LOC_VERSION` moves with it.

## Who reads what

| Concern | Reads | Where |
|---|---|---|
| Drawn size | `visualM ÷` the asset's neutral core, under the drawn run's `rules.size` (re-sized when a run's size rules differ) | `src/render/renderer.ts` (`speciesSizing`, `useSizeRules`) |
| Class label in the developer roster | the run on screen's `rules.size` (the defaults before a run) | `src/ui/ui.ts` (`UIHooks.sizeRules`) |
| Enemy collision and hurt radius | class radius × body size (`E.size`, 1 since the elite and alpha roles went) | `src/sim/enemies.ts` (`enemyRadius`) |
| Enemy vertical hit window, hit-number height | class height (`E.tall`) | `src/sim/effects.ts`, `combat.ts`, `hazards.ts`, `cells.ts`, `coats.ts` |
| Partner collision and hurt radius | class radius clamped to `rules.size.playerRadius` (0.48–0.72 m) | `partnerRadius`, read by `effects.ts`, `enemies.ts`, `bodies.ts`, `objectives.ts`, `cells.ts`, `hazards.ts` |
| Partner vertical hurt window | class height | `partnerHeight`, `effects.ts` |
| Spatial shot and beam muzzle (Phase 2B, beams Phase 2C) | class height × `rules.aim.muzzle.up` (0.6) above the feet, footprint × `muzzle.fwd` (0.9) ahead | `src/sim/aim.ts` (`resolveSpatial`); beams `src/sim/moves.ts` (`beam3D`) |
| Spatial beam contact (Phase 2C) | enemy cylinder `E.y .. E.y + E.tall` × `E.radius` (class) met by the beam's half-width, up and sideways | `src/sim/moves.ts` (`beam3D`) through `src/sim/spatial.ts` `sweep` |
| Wall and terrain collision | footprint (`footprintOf`, `partnerFootprint`) | `World.moveBody`, read by `player.ts`, `enemies.ts`, `bodies.ts` (resting-body contact) |
| Headroom under decks (R1) | sim height: partner `partnerHeight`, enemy `E.tall` (class height × tilt) | `World.collides` / `moveBody` / `fits` / `nearestFit`, `World.headroomAt` (jump clamp in `player.ts`), wide fields per height class (`World.wideDir`, `wideGoalDir`, `wideReached`), the spawn gate in `placement.ts` |
| Navigation class | footprint ≥ `rules.size.heavyRadius` (0.5 m) is wide (`navWide`); on the navmesh, wide and under `DIAG_R` is the large group, else extra large | `src/sim/world.ts` (wide field), `src/sim/navseam.ts` (width group, `rules.nav.groups`), `src/sim/placement.ts` (spawn room), `src/world/locgen/validate.ts` (`wide` gate) |
| Habitat navigation profiles | frozen validated constants (`VALIDATED_PROFILES`, pivot step 3; they no longer read species) | `src/world/habitat/mode.ts` (`profilesFor`) |
| Weight class (guard, push, knockback) | canonical mass, not size | `weightClass` in `src/rules/species.ts` |
| Third-person camera framing (2026-11-18) | `visualM` sets the boom (one law, `CHASE_CONFIG.frame`) and so the shoulder offset; class height × 0.8 sets the pivot | `src/render/chaseinput.ts` (`chaseSubject`), `src/render/camera.ts` (`chaseBoom`, `chasePivot`); `docs/THIRD_PERSON.md` "Size" |

Planar (legacy) shots still leave a partner from a fixed +0.8 m, so muzzle and eye heights for the habitat validator stay on the sprite-derived heights. Spatial shots (the chase camera's direct shots, `docs/THIRD_PERSON_IMPLEMENTATION.md` §13) leave from the class muzzle in the row above: Tiny 0.36 m, Medium 0.72 m, Extra Large 1.44 m up.

- **The neutral asset reference.** The renderer divides by the idle frame 0 facing the camera: `CreatureArt.heightPx / 16`. This is never the frame being drawn, so proportions and feet anchors survive animation.
- **Wide normalisation.** An idle frame at least `rules.size.wideRatio` (1.5) times wider than tall is normalised on `width / 1.5` instead of its height. This applies to long and low bodies such as Lapras, Cetoddle and Diglett's mound, so they are not drawn oversized.

### Partners

Partners are size-aware too. Small starter forms get a 0.48 m hurt radius (it used to be a shared 0.55 m), and evolved Large and Extra Large forms grow to 0.72 m. Evolving trades a bigger target for more push. The clamp keeps the change modest.

Measured on the survivor build over 36 bot runs (6 partners × 6 seeds, 7 minutes, size classes against the old shared radius):

| Partner radius floor | Bot survival |
|---|---|
| 0.42 m | +17 % |
| 0.48 m (default) | +10 % |
| 0.55 m | ±0 % |

The partner's footprint is its class `body`, uncapped: an Extra Large partner (Feraligatr, 0.88 m) is physically bigger than a Large one (0.66 m), while its hurtbox stays inside the 0.48–0.72 m clamp above. Large and Extra Large partners cannot use one-tile chokepoints.

## Footprint

Every ground body collides with solid geometry as a circle of its footprint (`World.moveBody`, `src/sim/world.ts`). One rule decides what is solid: `World.collides` read at the centre and at the circle's nearest point inside each tile it covers.

- **Values.** A one-tile passage (1.0 m) fits Tiny, Small and Medium bodies (footprint < 0.5 m) and stops Large and Extra Large ones. Medium's footprint (0.46 m) sits under its 0.52 m hurtbox on purpose, so the most common wild class keeps using the locations' chokepoints. There is no tilt: passability belongs to the class.
- **The cap.** A footprint scaled by a body size (`E.size`; every spawner uses 1 since the elite, alpha and boss roles went at pivot step 10) stops at `rules.size.bodyCap` (0.95 m). Pursuers must fit the two-tile routes the location and habitat gates guarantee to every mandatory space. Three-tile routes reach the hall on only 6–14 of 30 location seeds, and widening every essential route would flatten the locations. Raising the cap means a config value plus a three-tile gate (the lattice takes the block size as a parameter).
- **Substeps.** A move is cut into steps of at most 0.25 m, so a dash (24 m/s) or a knockback never tunnels through a corner.
- **Corners and pinholes.** The circle is pushed out of what it overlaps, so it glides round a corner into a passage it fits. Two walls touching only at a corner are closed: the point collision let the trainer through that zero-width gap.
- **Where faces are measured from.** While grounded (feet within a step of the surface), faces are measured from the surface under the centre. The feet lag a tick on a slope, and a terrace beside a ramp read as a step from them. While airborne (a jump, a ledge drop, a fall), faces are measured from the feet. A tile diagonal to the centre's tile is measured from the higher of the two orthogonal tiles between them, which is the block rule below.
- **Drops and landings.** A body only drops off a ledge where it fits once it lands, and it lands clear of the lip it left. A body landing from a fall has its footprint cleared on the landing tick, because faces were measured from its feet on the way down.
  - The landing push applies only to a drop within the map's drop rule (`World.dropNav`, 4 m on habitat and location maps; maps with no drop rule keep the older reading). From the floor of a deeper chasm the whole bank reads as a wall, and the summed push shoved a body whose centre grazed a chasm's corner 0.91 m out over it in one tick (navwalk location seed 4, 2026-11-20; `tests/footprint.test.ts` "grazing a chasm").
  - A body still airborne after the tick's vertical move has its footprint cleared at its new feet in the same tick. Once its feet come within a step of the floor below, the ledge it drops past becomes a face, and the planar move had been resolved at the tick's starting feet. An Extra Large body ended a tick 0.13 m inside the ledge (navwalk location seed 3; `tests/footprint.test.ts` "falling Extra Large").
- **Escape.** A move is accepted when the overlap does not grow, so a body left in a tight spot (an evolution inside a corridor) walks out of it and never further in. A push is applied only when it clears something.
- **Resting bodies.** A loose rock pushes the partner out by rock radius plus footprint. The hurtbox only decides what a thrown body hits. Loose rocks (`seedBodies`) are only scattered where a 7 × 7 patch is walkable, so a wide route always goes round one.



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

#### On the navmesh (I3, `rules.nav.engine = 'navmesh'`)

With the navigation flag on, the same split routes on recast-navigation navmeshes (docs/OVERHAUL_3D.md "Navigation (I3)"), one per **width group** (WORLDGEN3D Q7): **narrow** (Tiny, Small, Medium), **large** and **extra large**. A body's group follows the classes above: a narrow footprint is narrow; a wide one under `DIAG_R` (0.7 m) is large, else extra large. Each group's agent is written in cells in `rules.nav.groups`, its radius the group's widest footprint and its height the tallest body today's gates (`scripts/navwalk.ts`) carry for it, rounded up:

| Group | Classes | Radius (0.1 m cells, m) | Height (2 cm cells, m) | From |
|---|---|---|---|---|
| narrow | Tiny, Small, Medium | 4, 0.4 on adapter maps; 5, 0.5 on generated maps | 48, 0.96 | Medium 0.46 m (owner's F77 decision on adapter maps); Totodile 0.953 m |
| large | Large | 7, 0.7 | 85, 1.70 | Large 0.66 m; Heracross 1.689 m |
| xl | Extra Large | 9, 0.9 | 139, 2.78 | Extra Large 0.88 m; Onix 2.777 m |

- **Width.** Recast erodes the walkable area by the agent's radius, so a group passes a gap at least twice its radius wide: narrow 0.8 m on adapter maps (1.0 m on generated maps), large 1.4 m, extra large 1.8 m (and 1.2, 1.6, 2.0 m gaps admit one, two and three groups: `tests/nav.test.ts`). **One-tile necks (owner, F77, 2026-11-25)**: at the class rule's 5 cells (Medium's 0.46 m rounded up) a 1.0 m neck erodes away and 16 optional narrow-only targets of `navwalk all 5` closed; so on adapter maps the narrow agent is 4 cells (`rules.nav.adapterRadius`), every narrow walk arrives (313/313) and Medium overlaps a neck's walls by 6 cm, which I1c re-checks once enemies leave the tile World. Generated maps keep 5 cells: G1 sizes narrow necks to stay open at 5, which on a fixture takes 1.18 m (a neck from 1.18 m is open at every plan offset to the cells, one of 1.17 m shuts at some), more than WORLDGEN3D's 1.10 m narrow rung (ROADMAP F77). At 4 cells the same holds from 0.98 m. Every mandatory target is reached by every group.
- **Height.** One agent height per group, so the height classes of the wide fields go: extra large routes keep out of every gap under 2.8 m, the 2.4 m deck gaps included, for Feraligatr (2.29 m) too. No mandatory route needs the space under a deck (navwalk). A giant at the 3.57 m draw cap (`rules.nav.giantHeight`, 72 cells) loses none of the 484 targets the extra large navmesh reaches on `scripts/navgiant.ts 5` (30 Hold contests, 30 spawns, 176 zones, 248 anchors: navwalk's Extra Large set and more), only 26–48 m² under the 2.9 m decks of Mt. Moon and Volcanic Ridge (WORLDGEN3D Q7's deck gap fault, reported, not gated).
- **Steps.** The sim's 0.6 m step is the authority. Heights are in 2 cm cells (`rules.nav.ch`): the agent's step is 30 cells and Recast's build tests 29 (`rules.nav.recastClimb`), because it rounds tops to cells: no rise over 0.6 m is joined, every rise up to 0.58 m is, and one in (0.58, 0.6] m may be routed round (8 of 223 on the adapter maps, each about 2 m; ROADMAP F79, `scripts/navrises.ts`). Radii stay in 0.1 m cells.
- **Routes.** No ledge drops (no off-mesh links on the tile maps), as the wide lattice. Diagonal trails need the width across them; the lattice's diagonal-only links have no navmesh counterpart.

Earlier both the sim and the validator accepted a 2 × 2 block only when the spread of its four heights was ≤ 0.6 m. On a diagonal ramp the orthogonal steps are ≤ 0.45 m but the diagonal spans 0.61–0.67 m. Every ramp tile read as too narrow, and a bridge abutment (two ground tiles, two deck tiles) fitted neither layer. That is why a two-tile boss route looked missing on 27–63 % of location seeds. With the edge rule it exists on 30 of 30 seeds in each location (wideAnchors 99–100 %).

## Headroom

A body's sim height meets deck slabs (R1 of the spatial roadmap, ledger Stage 6C in
`docs/THIRD_PERSON_IMPLEMENTATION.md`). The height is the one the hurt window already uses: the class height with its tilt,
for enemies (`E.tall`) and the partner (`partnerHeight`).

- **Gaps.** A deck is a 0.6 m slab (`DECK_SLAB`). The generators keep every deck top 2.9 m above the ground under it
  (`CLEARANCE` in `locgen/decks.ts` and `habitat/validate.ts`, a rule against hopping on from below), so the gap under the
  slab is at least 2.3 m. On the shipped maps it is exactly 2.40 m on Viridian Forest, Chargestone Cave, River Gorge and
  Tidal Cave (a 3.0 m deck on flat ground) and at least 2.9 m on Mt. Moon and Volcanic Ridge (5 seeds each, 2026-11-16).
- **Who fits.** Every Tiny, Small, Medium and Large body, and every Extra Large one except Onix (2.78 m), fits a 2.4 m
  gap. An Extra Large body at exactly the class height (2.4 m) fits it (`HEAD_EPS`, 1 mm, absorbs float32 heights). The
  four authored-scale bodies (3.4–4.5 m) do not.
- **Movement.** `World.collides` treats a deck tile as solid for a body whose head would be in the slab: it stands at its
  feet or on the ground there, whichever is higher, plus its height. Through `World.moveBody` the footprint test applies
  it to every tile the circle covers, so a tall body stops with its edge at the deck's edge, walking or in the air.
- **Jumps.** A rising head stops at the lowest underside over the footprint (`World.headroomAt`); the jump's speed is
  spent and gravity brings the body down. A falling body is never clamped. A head already inside a slab (a body evolved
  under one) rises no further.
- **Routing.** The wide fields come in height classes. Each wide block knows its lowest gap under a deck; the distinct
  gaps of the map are the class steps, and a body's class is how many of them it is taller than. The fields for class
  *c* leave out the blocks whose gap is one of the *c* lowest. So a body routes under a deck it fits and round one it does
  not, and the spawn gate (`allowedAt`, `src/sim/placement.ts`) and placement (`nearestFit`) judge reach the same way. Maps without
  decks, and bodies that fit every gap, have one class (0), which is the field from before.
- **The ordinary field has no height classes.** That is sound while no narrow body (footprint under `heavyRadius`) is
  taller than the lowest gap the generators allow. `tests/headroom.test.ts` asserts it for every species.
- **What it changed.** `navwalk all 5`: every mandatory space is still reached by every class, including Onix; no
  mandatory route needs the space under a deck. (On the survivor build only the `gen` checksum set moved.)
- **Not covered here.** Enemy fliers hover with no wall or slab test (R7 moves them onto the shared movement).
- **The chase camera (F5, fixed 2026-11-18).** The camera's pivot used to follow the drawn sprite (0.8 × 2.7 m for Extra
  Large), above a 2.4 m slab's lens clearance, so an Extra Large partner that fits the gap folded the lens onto its back
  (815 safety-net slides in a camstats run, 9 m lens jumps walking out from under a deck). Since the camera's second pass
  (2026-11-18) the pivot sits on the sprite's outline again, as drawn, and the slab decides: a deck over the Pokémon, the
  shoulder arm or the back arm lowers the pivot to 0.45 m under it and caps the arm's elevation, both eased
  (`docs/THIRD_PERSON.md` "Decks").

## Wall tops

A wall prop (tree, fence, boulder, building) is solid only up to its measured height, for every reader that opts in
(R1b of the spatial roadmap, ledger §23 in `docs/THIRD_PERSON_IMPLEMENTATION.md`).
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
| The player's attack traces: the camera trace, the muzzle, bolt and orb flight, beams, device assist, and the aimbot (`scripts/lib/aimbot.ts`) | `QF.tops` from `combatFlags` (`sim/aim.ts`) on `sim/spatial.ts`'s wall column |
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
- **Hashes.** On the survivor build only the `aim` checksum set moved (one run, a Water Gun bolt passing 6.6 m over a
  border tree).

## The flags that were here

`rules.size.geometry`, `size.headroom`, `size.axis`, `size.xlContinuous`, `size.xlTall` and `rules.world.wallTops` were
hard-wired on, with their off paths deleted, at pivot step 10 (docs/hero-shooter-pivot.md Q18). The pre-size-class sim
(a radius from the sprite height, one shared partner radius, point collision), the giants before the flip and the
infinite wall props are on the `survivor-final` tag, with the checksum sets that pinned each layer.

## Checking it

- `npx tsx --test tests/sizing.test.ts tests/navsize.test.ts tests/footprint.test.ts tests/walltops.test.ts`
- `npx tsx scripts/covercheck.ts [seeds] [pairs]` reports what wall tops change for cover: the census, which barrier props
  each class fires over level, sampled lines of fire opened by the tops, and the objective sightlines where combat and the
  validators now disagree. Report only.
- `npx tsx scripts/navwalk.ts [location|habitat|all] [seeds]` drives real walkers of every class (Medium, Large, Extra Large) and the trainer (Small and Extra Large) to every target. Mandatory targets must be reached. A size-restricted optional target must be reached by the narrow body and refused by the wide ones. No grounded walker may end a tick overlapping solid geometry. `--nav navmesh` runs the same walks on the navmesh (enemies steer by it, the trainer follows its group's straight path round the resting bodies); every expectation is the lattice's ("On the navmesh" above).
- `npx tsx scripts/stuckwatch.ts [map|all] [seeds] [seconds]` watches live bot runs for movement deadlocks of the bot and of enemies that have a route. A relocated enemy (far or holding) starts a new episode. A bot episode is `pinned` when the bot also walked under 2 m in the 5 s; the others are the bot walking back and forth between threats or shoved in a crowd. Every bot episode is also checked for a way out (`escapeOf`, with the partner's own footprint through `World.moveBody`; since 2026-11-20 a jump up to the real apex plus the step, and swimming in a liquid the partner is safe in, count as ways out). It is `TRAPPED` when no heading moves it onto ground it may stand on, or when the ground it can walk to is a pocket under 48 tiles (`World.shore`'s trap size). The walk is a flood over the world's 0.5 m points (tile centres and corners, the middles of one- and two-tile passages), so a one-tile exit lets a Small partner out but not an Extra Large one (`tests/footprint.test.ts`). The probe only reads: `STUCK_PROBE_ALL=1` runs it every window, and the end states match a run without it. `TRAPPED` must be 0. `all 3` on 2026-11-20, against a chasing crowd of 120 (`scripts/lib/crowd.ts`): 14 bot episodes (4 pinned, 3 TRAPPED, all at River Gorge seed 3 (−28.6, 16.4), an open pocket), 31 enemy episodes in 217,415 enemy-seconds. The 31 are navigation (crowd jams at chokes, the wide field against `moveBody` at prop corners, the walkers above the Gorge pocket), classified and left for the co-op wave in docs/hero-shooter-pivot.md §11.
  - A pinned episode is often the bot's heading search, not geometry: on tropical-lagoon seed 3 the only way out is a one-tile strip due south, and none of the sampled turns points down it, though the partner fits it. This is a limit of the bot (`?autoplay` and the gate driver, not play).
- `pokewatch.renderer.sizes()` in the browser prints class, target, multiplier and the Wide flag for every loaded sheet.
- `node tools/cap.mjs <html> tools/sizescenes.json <outdir> size-` captures a one-per-class row (`size-class-row`), a same-class row (`size-same-class-small`) and each region's newer Pokémon (`size-wave-*`). Build to a private folder first (CLAUDE.md).
