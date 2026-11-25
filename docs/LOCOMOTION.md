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
matters only for an exact 0.6 m gap). The height is the body's `tall` on a map with decks and its footprint's class
height elsewhere: on an adapter map only deck slabs are overhead, as for the tile model's headroom (ROADMAP F72).
Numbers: `rules.physics.controller` (offset 0.01, headMargin 0.001, maxSlopeDeg and minSlideDeg 46, snap 0.35, the
step rule's margin 0.04, tolerance 0.002, minRise 0.01, short 0.98). The step height is `LocoTick.stepUp`
(`rules.player.stepHeight`, 0.6, or the climb out of a liquid).

**One tick on the controller** (`resolveOnController`, then `CharacterKit.move`):
1. The vertical drive sets `vy`; the desired translation is `(vx + kx, vy, vz + kz) · dt`.
2. Rapier's controller slides it against everything that stops a body (collision mode `MODE_MOVE`: the model's
   colliders, liquids at their surface, the map edge, a wall prop's column above its top, the stair wedges). Autostep
   and Rapier's snap are off. A supported body sends a planar move only (Rapier returns no movement at all for a capsule
   resting at its offset asked to move even slightly into the floor).
3. The step rule, when a supported move came up short against a face: lift the capsule by the step height plus two
   offsets, carry it along the face's inward normal by radius + margin (then turned 45° to the wish's side, then 45° to
   the other, where a higher block meets the step at a corner), set it down, and take it only on a stand (the
   capsule's own contact normal within the climb angle) whose contact point is between `minRise` and the step height
   (+ tolerance) above what the capsule rested on at the start of the tick (a short cast down from there: the floor, a
   ramp, or the block edge it is perched on), and only where the capsule fits. Contact to contact, not feet to feet:
   a wide capsule climbs the location maps' diagonal tile staircases perched on block edges.
4. Our snap: a supported body (or one the controller calls grounded) is set down within the snap distance on a shape
   cast; it stays supported on a stand, or while the floor under its axis is within the snap (the tile stick: walking
   off a 0.3 m ledge never leaves the ground). A falling body lands only when its fall was cut short or it ends
   touching. A set-down of more than a millimetre is taken only to a pose the capsule fits, backing off up to three
   offsets (casts grazing an edge can stop past contact, F58).
5. The seat: a grounded capsule that dipped more than half its offset into the floor (Rapier lets it sink up to its
   offset where two boxes meet, S1 §7 "Seams") is lifted back, only into free room.
6. A rising head cut short by a slab spends the jump's speed; grounded is "on the ground and not rising"; x and z keep
   the tile model's clamp to the map bound.

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
- A step is a hop: up to the step height and radius + 4 cm forward in one tick (the tile body walks its centre over the
  edge first, overlapping the step, then rises).
- A round bottom rides small lips: the controller climbs a lip lower than about 0.3 × the radius as a slope, and a body
  perched on a block's edge stands up to that much below the block's top.
- Walking off a ledge: the round bottom rides the edge down while the floor under its axis comes within the snap, so a
  drop deeper than the tile stick (0.35 m) is walked down: every class 0.4 m, Medium to Extra Large 0.5 m, Extra Large
  0.6 m; 0.8 m is a fall for every class (ROADMAP F66).
- The crowd's and resting bodies' shoves of the partner are summed over their system's loop and resolved in one move
  (`Shoves`, `flushShoves`): the tile model moves the footprint at each shove, so a later shove there starts from where
  the earlier one left it.
- Grounded feet sit within the controller's offset of the floor (f32 contact, a few mm after a slide), not exactly on it;
  a landing can come a tick earlier or later than on tiles from that millimetre (`scripts/jumptiming.ts --physics
  rapier`: 8 Hz taps jump at ticks 12 53 94 against 12 54 96).

**Checks.** `tests/stepping.test.ts` (every class climbs 0.3, 0.5, 0.55 and 0.6 m at 0.5–9 m/s head-on and at 45°,
refuses 0.62, 0.65 and 0.8 m; crease stalls, risk R13: 0 ticks on the climbs and on the range's stair flight; the 2.4 m
underpass; the drops). The tile tests run unedited on the flag with a preload:
`npx tsx --import ./tests/setup/physics-on.ts --test tests/locomotion.test.ts tests/jumpcontrol.test.ts` (26 of 27
pass). The cases that are about tile geometry, not feel:
- `locomotion: a ballistic body falls under gravity and lands on the support` asserts `y === 0` exactly at the first
  supported tick: on the controller the feet land 4.7e-9 m below the floor (f32 contact). Its timing (within 2
  ticks of free fall) holds. The one failure on the flag.
- `locomotion: the medium is derived from the world` reads the tile model's liquids on a map edited after the physics
  world was built (`mediumAt` asks `liquidContact`, which stays on the tile World on both resolvers): it passes, but
  says nothing about the controller.
- `coyote time` and `jump buffer` walk off a 2 m ledge and fall from 3 m on a flat tile map: they pass, on adapter
  geometry.
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
