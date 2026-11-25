# Locomotion

How a Pokémon body's velocity becomes motion. Code: `src/sim/locomotion.ts`. Tests: `tests/locomotion.test.ts`.
Capabilities: `src/rules/traversal.ts`, `traversalOf` in `src/rules/profiles.ts`, tests `tests/traversal.test.ts`.
Roadmap: R6 in the architecture audit plan (R6a landed: the seam; R6b: capability data; neither changes behaviour;
R6c: the Jump control and the vertical intent, behaviour changed only for edge-sending input, see "Controls"). The 3D
overhaul's I1b (2026-11-25): the partner's body on Rapier's character controller behind `rules.physics.engine`, see
"Resolvers"; code `src/physics/controller.ts`, tests `tests/stepping.test.ts`.
Related: `docs/SIZING.md` (footprints, headroom, `World.moveBody`), `docs/HAZARDS.md` (liquids and falls),
`docs/CONTROLS.md` (bindings, the input side of the Jump edge, descend).

## Model

One shared body step, driven by an **intent**. The driver differs (player input today, AI steering after R7); the
physics does not.

| Piece | What it is | Where |
|---|---|---|
| Body | `LocoBody`: `x y z`, `vx vy vz`, knockback `kx kz`, `grounded`, and the jump acceptance `ctl` (R6c: buffered press, coyote ticks, airborne press spent). `Player` satisfies it directly; a pool driver loads one scratch body per creature (R7) | `locomotion.ts` |
| Intent | `LocoIntent`: planar wish `mx, mz` (length ≤ 1, world axes), held `jump`, and (R6c) the Jump edge `jumpPressed` (absent = the legacy held rule) and the vertical intent `my` (ascend − descend, −1..1; absent = 0) | built by the driver |
| Numbers | `LocoNumbers`: gravity, jump velocity, glide fall speed, step height, ground / air acceleration, knockback decay, jump buffer and coyote time (R6c). `rules.player` (R6b's capability templates carry only what their rows need; body numbers per template arrive with the integrators that use them, R6d / R6e) | `src/rules/defaults.ts` |
| Tick numbers | `LocoTick`: this tick's top speed and stance factor, surface speed and grip, `canJump`, `lift`, `airPress` (R6c), step-up, footprint, height, wide lattice. The caller turns its gameplay rules (buffs, Brace, liquids, carrying, footing) into these | caller |
| State | `LocoState = { integrator, medium }` (`Player.loco`) | `types.ts` |

### Integrators (closed set)

| Integrator | Drive (planar velocity) | Exists today as |
|---|---|---|
| `supported` | eases toward the wish at `groundAccel × grip`, wish scaled by the surface's footing speed | walking |
| `ballistic` | eases toward the wish at `airAccel` (air control) | jump, fall, glide |
| `scripted` | an ability owns planar velocity (direction × speed) | Dash, dash-shaped moves |
| `volume` | 3-axis thrust, drag, limits | **R6d** (not built) |

All three run the same body step after their drive (`advanceBody`): knockback decay, take-off, gravity and the lift row
(`driveVertical`), then a resolver: on the tile model the planar move (step rule, footprint through `World.moveBody`),
headroom, the support (landing with the footprint clear, an airborne footprint cleared at its new feet, slope stick,
leaving the support); on physics the character controller ("Resolvers"). Then the rock recovery on location maps. A
scripted tick keeps gravity and support under it: a dash off a ledge falls, a grounded dash can jump.

**Crossing above wall tops (R1b, docs/SIZING.md "Wall tops").** `LocoTick.over` is an explicit permission to cross above
a wall prop's finite top. It is separate from the integrator: no integrator grants it by itself, and no driver sets it
before R6d, where a traversal template that needs it adds the policy (with its first user, not before). With it, the
planar move passes over a top the feet clear (`World.moveBody` / `collides` with `over`), a descent stops at the top
(`World.topUnder`, from the feet at the start of the tick: downward speed spent, `grounded`, the integrator and the
support untouched, so it is a stop and not a landing), and the rock recovery leaves a body above a top alone
(`World.inRock`). Absent: every wall is solid to any height and every path is the one before R1b (the per-tick oracle in
ledger §23). Losing the permission while above a prop is R6d's declared transition (T31).

The integrator a tick runs is `selectIntegrator(scripted, grounded)` from the body's state at the start of the tick
(scripted wins, then support). Transitions within a tick: supported → ballistic (jump pressed, support ends), ballistic →
supported (contact). `Player.loco.integrator` records the state at the end of the player tick; other systems that change
the body later in the same tick (a lunge in `moves.ts`, a respawn in `hazards.ts`) are picked up by the next tick's
selection, which reads the body, not the record.

### Medium

`mediumAt(world, body, contact)`: a liquid the body is in contact with (`World.liquidAt`), else its support, else air.
Derived from the world, never chosen. Nothing reads it yet (camera envelopes and the volume integrator will, from R6d).

### Lift

`LocoTick.lift` is the glide row: holding Jump clamps the fall to `glideFallSpeed`. The player sets it from
`traversalOf(species, rules).glide` (the `glider` template).

### Controls (R6c)

`jumpControl(body, intent, tick, numbers, dt, integrator)` decides what Jump does this tick, inside the shared body step
(`moveVertical`, where the jump take-off always was), from the body's state at the start of the tick. It returns
`ACT.none | jump | airJump | takeoff`.

- **Legacy intent** (no `jumpPressed`): `jump && grounded && canJump` → jump, exactly the pre-R6c condition; `ctl` is
  not touched. Every driver that sends no edge (the bot, AI after R7, older replays) keeps it.
- **Edge intent**: the §12.6 table (`docs/CONTROLS.md` "In the sim"): a press jumps from a support or inside the coyote
  window, waits in the buffer otherwise, and gives an airborne press the template's one `airPress` meaning
  (`doubleJump` once per airtime; `takeoff` returns `ACT.takeoff`, which nothing acts on before R6d's volume integrator;
  `none`). Holding never jumps again; holding is the lift row (glide). A scripted tick (the Dash) keeps today's ground
  jump and ignores air presses.
- Windows are whole ticks: `round(jumpBuffer / dt)` = 7, `round(coyote / dt)` = 6 at the default rules.
- `my` is carried in the intent and read by no integrator here; look pitch is an input of nothing in this file.
- Allowed driver difference (contract below): only an edge-sending driver buffers. AI intents carry no edge.

## Resolvers (I1b)

The flag picks the resolver, never the integrator: the drives, the Jump control, gravity and the lift row are one code
path (`driveVertical` and the three drives), and `advanceBody` hands the tick's translation to the world's `mover` when
it has one (`rules.physics.engine = 'rapier'`: `World.mover`, `sim/physseam.ts` `PhysicsMover`), else to the tile
model. Only the partner moves on the controller: enemies and bodies stay on the tile World (I1c, owner O2). The crowd's
and a resting body's shove of the partner go through the same choice (`pushFootprint`).

**The body.** One capsule per footprint and height (`capsuleOf`, S1 §8): radius footprint − `offset`, the shape
`height − 2·offset − headMargin` tall, so the controller's envelope is the body with a 1 mm head margin (owner O5).
Tiny (0.30 m, 0.6 m) leaves no cylinder: a ball of 0.29 m, envelope 0.60 m, no head margin (S1 review finding 5; it
matters only for an exact 0.6 m gap). Per class (radius, cylinder half-height): Tiny 0.29, ball; Small 0.39, 0.0495;
Medium 0.45, 0.1395; Large 0.65, 0.1895; Extra Large 0.87, 0.3195 (`tests/stepping.test.ts` "capsules"). **The height
is the body's own on every map, and required (ROADMAP F72):** `LocoTick.height` and `BodyMove.h` have no fallback (the
player's tick and the summed shoves carry `partnerHeight`); a move without a positive height throws.
Numbers: `rules.physics.controller`: `offset` 0.01, `headMargin` 0.001, `maxSlopeDeg` and `minSlideDeg` 46, `snap` 0.35
(the support rule's stick), `probe` 0.25 (the support ray starts this far above the feet, inside every capsule), `rest`
0.015, `edge` 0.02, `backoff` 3, the roll's `step.tolerance` 0.002, and `step.margin` 0.04 (the roll-off's reach). The step height is `LocoTick.stepUp` (`rules.player.stepHeight`, 0.6, or the climb out of a liquid).
No other probe distance is a literal.

**Exact unless cut (ROADMAP F70).** A move Rapier's controller reports no collision on is the desired translation
itself, in 64-bit (its own answer is the f32 sum); a move it reports collisions on is its answer. "Cut" is read from the
collisions it reports, never from comparing its answer with the wish. Floor heights are the world model's:
`PhysicsWorld.supportBelow` returns a box's f64 top (a liquid's surface) when its ray enters the box from above, and the
height of a contact a cast meets is the touched box's f64 top (a cast's f32 witness is centimetres off along an edge a
round bottom barely overhangs). Meshes (the stair ramps) keep the f32 contact; on G1's generated terrain the exact height
must come from the model's triangles in 64-bit. Whether a capsule fits is decided in 64-bit too (`clearOf`, used by
`fits` and the harness's `clearAt`): the candidates are the colliders whose bounding boxes meet the capsule's (Rapier's
broad phase), and a box among them is tested exactly from the model's bounds (the distance from the vertical capsule's
core segment to the axis-aligned box, under its radius); a mesh or hull by Rapier's intersection test. Neither of
Rapier's own tests is exact within a centimetre: its intersection test reports a capsule over a box top as intersecting
at gaps up to its offset (at about a third of positions), and its contact query put a capsule 5 mm into a box's vertical
edge at +6e-5 m (`navwalk` mt-moon seed 5).

**One tick on the controller** (`resolveOnController`, then `CharacterKit.move`; positions are kept as the feet, the
centre is the capsule's lift above them only for Rapier's calls):
1. The vertical drive sets `vy`; the desired translation is `(vx + kx, vy, vz + kz) · dt`.
2. Rapier's controller slides it against everything that stops a body (collision mode `MODE_MOVE`: the model's
   colliders, liquids at their surface, the map edge, a wall prop's column above its top, the stair wedges). Autostep
   and Rapier's snap are off. A supported body sends a planar move only (Rapier returns no movement at all for a capsule
   resting at its offset asked to move even slightly into the floor). No collision: the exact desired move.
3. **The roll (ROADMAP F69).** A supported move the controller cut, and the move of a body resting on an edge ahead of
   its wish (its feet more than `rest` above the support under its axis: part way up a rise, or on a ramp), goes the
   tick's own travel, lifted by the least height at which the capsule fits there:
   - where the capsule fits at its own height there is nothing to roll over (the controller's 1 cm skin cut the move
     short of a face it has not reached): the move is the desired one, and a body part way up an edge holds its height
     (the support would set it back down onto the edge by its skin);
   - else the planar carry is the controller's own move at the body's height with what it may roll over left out (the
     boxes whose top is within the step of what it rests on: Rapier's query predicate): the wish itself, or slid at its
     full radius along what stands higher (a corner where a higher block meets the rise, the location maps' diagonal
     staircases: the tile footprint glides off the higher block as it steps up). Then lift the capsule by the step
     height plus two offsets (a ceiling cuts it short), carry it over (a slab refuses it), cast it down onto what is under
     it, and take it when what it lands on is a rise (above the support under its axis), its top no more than the step
     (+ `tolerance`) above what it rested on, the landing lifts it, and it fits. What it rested on: its feet when they
     stand on the support under its axis (within `rest` of it: a block edge it is pressed against is not what it rests
     on); perched higher, the top of the edge under its round bottom (a wide body climbs a diagonal staircase from block
     edge to block edge). Top to top, never past the step (S1's over-climb).
   The round bottom rolls up the edge tick by tick at the body's own speed and arrives on the top as its axis crosses
   the edge, as the tile body rises onto it then. Every tick of a roll is grounded (a Jump press there is a ground
   jump). I1b's first cut carried the capsule a hop of up to the step height and radius + 4 cm in one tick (a flight of
   steps 20–57 % faster than flat ground); S1's "tick's own travel" rule perched and fell back at slow and 45°
   approaches (the skin stopped a body slower than 0.6 m/s short of the face for good, and the support set a body part
   way up back down onto the edge): the roll's first case answers both.
4. **The support rule (ROADMAP F66, owner 2026-11-25: the tile model's, for every size class).** A supported body stays
   supported while its feet after the tick's gravity (the support under its axis at the start, plus `vy·dt`) are less
   than `snap` above the support under its axis at the end: the tile model's `STICK` (`b.y − g < 0.35`). Drops up to
   0.3583 m (0.35 + g·dt²) are walked down, every deeper drop is a fall, whatever the class, speed or approach. A body
   walking down is set down by a shape cast onto what is under it: the floor under its axis, or the edge of the ledge
   its round bottom then rides down over the next ticks (the tile body drops the full height in one tick). A fall leaves
   the support this tick: ballistic from the next, with coyote time and the air press as on tiles. The contact's own
   slope does not decide it: a round bottom on a ledge's edge reads as a walkable slope until it has ridden 0.3 × its
   radius down, which is what made I1b's first cut walk Medium to Extra Large down 0.5 m and Extra Large 0.6 m.
5. **Landing.** A falling body lands as the tile body does: feet at or below the support under its axis (the world
   model's height) land on it on that tick, else the fall goes on. A fall the controller met only floors on (every
   reported collision a stand) keeps the exact desired planar end and height (its offset cut such a fall a hair above
   the floor, a tick early: F70). A ledge's edge that cuts a fall is not a landing (the tile body falls past it, its
   footprint over the ledge; the edge is a contact whose tangent plane, carried to the axis, passes more than `edge`
   above the support there, or a contact steeper than the climb angle): the capsule is carried clear by the least
   horizontal shift away from the ledge (found from a ring of eight support rays at 0.9 × the radius) that lets the
   tick's fall go on, its round bottom rolling off the edge, and it falls on. Two exceptions: where the tick's own planar
   move once more takes the axis over a support higher than the one under it and at or above its feet (a corner cut
   across the corner of a chasm: the tile body falls one tick and lands back up there), the capsule waits on the edge,
   airborne, and lands there next tick; where the shift has no room, it lands on the edge, perched.
6. **Rest.** A grounded body whose feet end within `rest` of the support under its axis stands exactly at that height,
   where the capsule fits: the tile model's feet on its support, and the dip Rapier lets a walking capsule sink where
   two boxes meet (S1 §7 "Seams") lifted out. A capsule on a ramp or rolling over an edge stands where the controller
   left it.
7. A rising move cut by a ceiling (a reported collision with a surface facing down within the climb angle of straight
   down) spends the jump's speed; grounded is "on the ground and not rising"; x and z keep the tile model's clamp to
   the map bound.

**Not on the controller:** `LocoTick.over` (R1b's crossing permission; no driver sets it before R6d, so a wall prop's
column is solid to any height here) and the landing clear (a capsule never stands in a lip). The rock recovery runs on
both resolvers.

**Liquids** keep today's behaviour (owner, 2026-11-25): the adapter puts no bed under a liquid (F25), so a liquid is a
floor at its surface for the controller, as the tile model supports a body at the surface; contact (`liquidContact`),
exposure and the shipped `swim` kind are unchanged. WORLDGEN3D Q9's wade, float, dive and depth-relative damage are
I4's, with the liquids registry, on maps that have beds.

**State.** The capsule colliders (collision groups 0: no query meets them) are moved to the body before each move, and
the controller object holds settings only: the Rapier world keeps nothing a later tick reads, so nothing of it is in
the replay hash (ROADMAP F62). A restored snapshot reuses the capsule colliders by handle.

**Where it differs from the tile resolver** (all measured on the adapter maps):
- A rise is rolled up, not popped: the tile body walks its axis to the edge at full speed, overlapping the step, and
  rises onto it in one tick; the capsule's round bottom meets the edge first and rises over the ticks until its axis
  crosses the edge, at the same speed. Crossing time is the same: a flight of four 0.3 m or 0.5 m steps (1 m treads) is
  crossed in exactly the ticks of flat ground by every class at 0.5, 2, 6 and 9 m/s on both resolvers, and no tick
  moves a body further than its own travel (ROADMAP F69).
- A round bottom rides small lips: the controller climbs a lip lower than about 0.3 × the radius as a slope, and a body
  perched on a block's edge stands up to that much below the block's top.
- Walking off a ledge: supported and airborne exactly as on tiles (rule 4), from the tick the axis crosses the edge
  (the stepping test's 420 walks: identical, tick for tick). The round bottom rides the edge down a drop it walks down
  (x identical to the tile body's), and rolls off the edge of one it falls from (rule 5): up to 0.154 m beyond the
  tick's own travel in one tick (Extra Large walking at 0.5 m/s), 0.78 m in all over a 0.8 m fall; at 6 m/s up to
  0.114 m. The roll-off is the one place a tick moves a body further than its own travel. After a fall the tile body
  is elsewhere too: its footprint is cleared of the ledge at its new feet (a Large body off 0.6 m at 2 m/s moves
  1.32 m in its first airborne tick on tiles), so x differs by up to 1.6 m after a fall.
- The crowd's and resting bodies' shoves of the partner are summed over their system's loop and resolved in one move
  (`Shoves`, `flushShoves`): the tile model moves the footprint at each shove, so a later shove there starts from where
  the earlier one left it.
- Free moves are the tile model's own: on flat ground the controller's x, y and z are the tile body's bit for bit (a
  3 m walk at 0.5, 3 and 9 m/s: 0 difference; the first cut drifted 0.7 mm), a flat-floor jump flies the tile arc and
  lands on the tile's tick at y === 0, and `jumptiming --physics rapier` taps jump at ticks 12 54 96 as on tiles.

**Checks.** `tests/stepping.test.ts` (11 cases): the capsules; every class climbs 0.3, 0.5, 0.55 and 0.6 m at 0.5–9 m/s
head-on and at 45° and refuses 0.62, 0.65 and 0.8 m; crease stalls (risk R13) 0 ticks on the climbs and on the range's
stair flight; the 2.4 m underpass; **the drops (F66):** every class at 0.5–9 m/s from two starts off 0.3, 0.3582,
0.359, 0.4, 0.5, 0.6 and 0.8 m, grounded per tick from the edge as on tiles (420 walks, 0 differences), coyote time on
every fall; **liquids:** a plain body walks into a deep pool and rests at its surface in contact on both resolvers, and
`scripts/hazplay.ts`'s wade-in on Shrine Gorge seed 3 runs on the flag (Totodile swims safely at the surface, Rattata is
exposed, takes damage and wades out); **collision groups:** with a capsule at the body, the shot and aim ray, beam and
orb sweeps, sight, solidAt, overlaps, the support below and the liquid at a point all pass through it in every query
mode; **the roll (F69):** over every controller move of the step matrices no tick moves the body further than its own
travel along the wish or at all, and on every climb each tick from the first roll to standing on the top is grounded,
goes its whole travel and never sinks; a four-step flight takes the ticks of flat ground, every class, both resolvers;
**exact unless cut (F70):** a free walk, fall and take-off return the desired 64-bit translation, and a flat-floor jump
flies the tile arc bit for bit and lands at y === 0 on the tile tick. The tile tests run on the flag with a preload:
`npx tsx --import ./tests/setup/physics-on.ts --test tests/locomotion.test.ts tests/jumpcontrol.test.ts` (27 of 27; the
test inputs give each tick its height, ROADMAP F72). The cases about tile geometry, not feel:
- `locomotion: the medium is derived from the world` reads the tile model's liquids on a map edited after the physics
  world was built (`mediumAt` asks `liquidContact`, which stays on the tile World on both resolvers): it passes, but
  says nothing about the controller (the stepping test's liquids case does).
- `coyote time` and `jump buffer` walk off a 2 m ledge and fall from 3 m on a flat tile map: they pass, on adapter
  geometry.
- `a press that cannot jump yet (exposed in a liquid)` and `jump takes off … a liquid that forbids the jump` set
  `canJump` false on dry ground: the liquid is only the reason given; they pass.
`scripts/navwalk.ts all 5 --physics rapier` (the trainer of every size class to every mandatory target, capsule clear
of the physics world every tick) and `scripts/stuckwatch.ts all 3 --physics rapier` (TRAPPED by the controller's own
headings) are the reachability gates.

## Capabilities (R6b)

What a body CAN do to get around is data: reusable **template rows** in `rules.locomotion.templates`, a **list of
template ids** per species, and one accessor, `traversalOf(species, rules)`, that every system reads (sim, world,
render, UI). Elemental type and named abilities are never read: a Flying type does not imply flight, and the Levitate
ability (`rules/abilities.ts`) stays a Ground-damage immunity.

| Kind | Template (shipped) | What it does today | Driver today | Reader |
|---|---|---|---|---|
| `glide` | `glider` | ballistic lift row: Jump held in the air clamps the fall to `rules.player.glideFallSpeed` | player | `player.ts` → `LocoTick.lift` |
| `hover` | `fixed-hover` (`height` 0.9, `step` 0.05, `levels` 10, `bob` 0.15, `bobRate` 3) | wild body at `height + ((slot × 37) mod levels) × step` above the terrain, bobbing; no footprint, no wall test | AI (`enemies.ts`, until R7) | `enemies.ts` spawn and bob |
| `swim` | `surface-swimmer` | safe in open water: no exposure, `rules.hazards.water.safeSpeed` | both | `canSwim` → `hazards.safeIn` |
| `fly` | reserved, R6d | sustained flight: volume × air | — | validator rejects |
| `levitate` | reserved, R6e | constrained, timed levitation above the support: volume × air | — | validator rejects |
| `dive` | reserved, R8 | underwater movement: volume × liquid | — | validator rejects |

A species may hold several templates (Charizard: `glider` + `fixed-hover`), at most one per kind. Glide and hover are
separate rows on purpose: they are the two different things the roster's `flying` flag meant (the player's glide, the
wild float), and each driver uses the row it can drive. R7 puts both drivers on the same rows.

**Where the list comes from.** `SPECIES_OVERRIDES[id].traversal` (`src/rules/profiles.ts`) when present, replacing
everything below (`[]` = no capability). Otherwise derived: the roster's legacy `flying: true` → `LEGACY_FLYING`
(`glider`, `fixed-hover`); a type in `rules.hazards.water.safeTypes` (the Water type) → `LEGACY_SWIM`
(`surface-swimmer`), the swim rule the older layers keep. `traversalOf` is the only reader of the `flying` field
(`tests/traversal.test.ts` gates the source). Swimming lent by a move (Surf, `rules.hazards.water.safeMoves`) stays in
`canSwim`: it depends on the move set, not the species (R6f's `grant` primitive is its eventual home).

**Policies.** The old flag also decided rules that are not movement. They are separate fields of `Traversal`, each with
its own readers, defaulted from the capabilities:

| Field | Meaning | Default | Readers |
|---|---|---|---|
| `air` | holds an air capability (glide or hover) | derived | camera framing (`chaseinput.ts` → `ChaseFrame.flying`), roster label "flies" (`ui.ts`) |
| `groundNav` | a wild body routes on the ground: footprint, walkable placement and relocation, spawn room check, Hold raid parties, habitat ground profiles, spawn-pool `fly` filter | no hover row (derived; R7 separates it when fliers get real altitude and wall tests) | `enemies.ts`, `director.ts`, `compositions.ts`, `spawning.ts`, `habitat/mode.ts` |
| `ventImmune` | habitat vents do not hurt the trainer's partner standing on them (wild bodies are judged by height) | `air`; `SPECIES_OVERRIDES[id].ventImmune` overrides | `hazards.ts` |

Spawn *permission* (`requires` / `avoids`, `docs/SPAWNING.md`) is unrelated and untouched.

**Numbers and caching.** Rows are rules data, so a rule set may retune them (`ruleOverrides.locomotion.templates`).
`traversalOf` caches one resolution per rules object and species object (rules are cloned per run and not mutated
after). Content-time readers without a run (`spawning.ts` filters, `compositions.ts` jobs) use the default rules, as
`habitatAllows` does. `validateTraversal(rules)` reports unknown kinds, reserved kinds, bad hover numbers, unknown or
duplicate template ids in a species list; `tests/traversal.test.ts` asserts none for the shipped data.

## Acceptance (R6c)

Every `scripts/checksum.ts` line identical to R6b (60 of 60). The R6b per-tick oracle, extended with input variants
(bot; held Jump injected without an edge; the same plus `my` every tick; bot plus `jumpPressed: false`), on the
pre-R6c tree and the R6c tree: identical. `tests/jumpcontrol.test.ts`: legacy and edge rules, buffer and coyote windows
tick by tick, `airPress` meanings, the Dash, `my` and look pitch inert, determinism. `docs/CONTROLS.md` has the input
side and `scripts/jumptiming.ts`.

## Contract for later phases

- Functions take numbers and an intent and write to caller-owned scratch. No `Player`, no pool, no `ctx`, no
  allocation (500 enemies).
- Allowed driver differences, each with its reason: float32 storage in pools (the caller rounds before the wall test and
  on store); no input buffering for AI (an AI intent sends no `jumpPressed`, so `jumpControl` takes the legacy path and
  `ctl` stays zero); relocation and spawn placement are director rules, not physics.
- R6d acts on `ACT.takeoff` (→ volume × air) and reads `my` in `stepVolume`; the volume rows of the §12.6 table (Jump
  pressed: nothing; held: ascend; descend held: descend, landing on support contact) belong there.
- Enemy motion stays in `src/sim/enemies.ts` until R7 moves it here behind its flag (one planned hash migration). Shared
  now: the landing clear (`clearLanding`), which was already the same `World.moveBody` call on both sides.
- `tests/locomotion.test.ts` gates the player half of T38: `src/sim/player.ts` holds no gravity, jump, glide, support,
  headroom or wall arithmetic, and the player controller and a plain body on the shared step move bit-identically.

## Acceptance (R6b)

Every `scripts/checksum.ts` line identical to R6a; the R6a per-tick oracle, extended to every enemy's hover height,
footprint and roles, hazard events, gliders, hoverers and swimmers as the player and two habitat maps (vents, river):
identical. Pure policy readers (spawn tables and filters, composition jobs, habitat ground profiles, `canSwim`,
spawn placement per species, the camera's air flag) and a vent-exposure run of every species: identical.

## Acceptance (R6a)

Every `scripts/checksum.ts` line identical; `navwalk all 5` and `stuckwatch all 3` unchanged; `perf-sim --gate` passes.
The checksum hash skips `vy`, knockback and `grounded`, and the bot never jumps, so R6a was also checked with a stricter
per-tick oracle (every player motion field and every enemy's height, bot input plus injected jumps, Charizard for the
glide row, seven rule sets): identical before and after.
