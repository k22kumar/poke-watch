# Locomotion

How a Pokémon body's velocity becomes motion. Code: `src/sim/locomotion.ts`. Tests: `tests/locomotion.test.ts`.
Capabilities: `src/rules/traversal.ts`, `traversalOf` in `src/rules/profiles.ts`, tests `tests/traversal.test.ts`.
Roadmap: R6 in the architecture audit plan (R6a landed: the seam; R6b: capability data; neither changes behaviour;
R6c: the Jump control and the vertical intent, behaviour changed only for edge-sending input, see "Controls").
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

All three run the same body step after their drive (`advanceBody`): knockback decay, the planar move (step rule,
footprint through `World.moveBody`, the centre-point look-ahead with size geometry off), take-off, gravity and the lift
row, headroom, the support (landing with the footprint clear, slope stick, leaving the support), and the rock recovery on
location maps. A scripted tick keeps gravity and support under it: a dash off a ledge falls, a grounded dash can jump.

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
  not touched. Every driver that sends no edge (the bot, AI after R7, the checksum sets, older replays) keeps it.
- **Edge intent**: the §12.6 table (`docs/CONTROLS.md` "In the sim"): a press jumps from a support or inside the coyote
  window, waits in the buffer otherwise, and gives an airborne press the template's one `airPress` meaning
  (`doubleJump` once per airtime; `takeoff` returns `ACT.takeoff`, which nothing acts on before R6d's volume integrator;
  `none`). Holding never jumps again; holding is the lift row (glide). A scripted tick (the Dash) keeps today's ground
  jump and ignores air presses.
- Windows are whole ticks: `round(jumpBuffer / dt)` = 7, `round(coyote / dt)` = 6 at the default rules.
- `my` is carried in the intent and read by no integrator here; look pitch is an input of nothing in this file.
- Allowed driver difference (contract below): only an edge-sending driver buffers. AI intents carry no edge.

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
