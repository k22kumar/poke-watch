# Capabilities, interception and Hold: what is built (Phase 8a)

Design: *Poke-Watch Systemic Combat Blueprint* (sections 5, 7, 8, 10, 12 and 16). This file records what the code does,
the numbers it uses and what was measured. Every number lives in `src/rules/defaults.ts` (`caps`).

## Capability tags (`rules/capabilities.ts`)

Each compiled move (`MoveSpec.caps`) carries its capabilities as data, derived once from type, damage class, base
power and shape. The UI shows them on learn, upgrade and Tag cards and in the move-slot tooltip ("Push 2 · Apply Wet").

| Tag | Derived from |
| --- | --- |
| `hit` | every damaging move |
| `push:P` | Water moves, physical Fighting / Rock / Ground moves, special Flying moves, dash moves |
| `hold:P` | binding and telekinetic moves (`HOLD_MOVES`: Vine Whip, Wrap, Bind, Whirlpool, Fire Spin; Confusion and Psychic are listed for a future Psychic recruit) |
| `apply:agent` | Fire, Water, Ice and Electric moves (Heat, Wet, Cold, Charge) |
| `create:template` | Tag Action data (`rules/tags.ts`: Rock Throw's rock) |

Power from base power: under 60 = 1, 60–90 = 2, over 90 = 3; a combined force can reach 4. `CAP_OVERRIDES` adds or
removes tags per move (Phase 8b transforms compile their own edited caps instead; see `docs/BUILDS.md`). A test checks that the compiled Push and Hold Power of
all 187 cross-version moves equals the v10 derivation.

## The resolver (`sim/capabilities.ts`)

One event shape (`CapEvent`: verb, Power, type, owner, position, direction, source, target) and one entry point,
`resolve(ctx, ev)`, for every target kind. The per-target rules stay next to their data and are shared by every source:

| Target | Hit | Push | Hold | Deflect | Apply | Create |
| --- | --- | --- | --- | --- | --- | --- |
| Creature | `damageEnemy` (type chart, abilities, coats) | knockback (`creatureForce`, v10 rule) | reel in 2 m if Hold ≥ Weight | Guard parry (contact) | coat (`coatEnemy`) | — |
| Body | integrity × type chart | Power ≥ Weight moves it at 8 × (1 + 0.5 × (P − W)) m/s, else × (1 − 0.15 P); +1 when combined | suspend (below) | Guard, Weight ≤ guard's | — | — |
| Projectile | opposing shots cancel by Weight | deflects it along the push | catches it if Power ≥ its Weight | Guard, Weight ≤ guard's | — | — |
| Tile | — | — | — | — | `applyAgent` | spawns a body (`createBody`) |

Cover props (Phase 8c) are a reserved target kind.

Order inside a tick is v10's: moves emit their effects, projectiles move, **then the interception pass runs (lower
index first)**, then zones, then bodies (integrate, enemy impacts, **body impacts**, the player). Deflect (the Guard
window) is checked before Hit.

## Projectiles as light bodies (`sim/pools.ts`, `sim/effects.ts`)

New projectile fields: `weight`, `pushP`, `holdP`, `heldT`, `heldBtn`, `src` (the shooter's species, for the recap).
Zones carry `pushP`, `holdP` and `src` too, so Tag Action shots and zones (which have no move slot) push and hold.

| Rule | Value |
| --- | --- |
| Weight | 0 for shots; 1 for lobs and shots with radius ≥ `heavyShotRadius` (0.6 m: Sudowoodo's radial shots, orbs, boomerangs, orbits) |
| Push on a shot | any Power deflects an enemy shot it overlaps, along the push; the shot becomes yours (same speed and damage rule as a Guard deflect) |
| Hold on a shot | Power ≥ its Weight catches it; it waits 1.5 m in front of you for up to 1 s, then flies along your aim |
| Shot against shot | the player's shots against enemy shots: a pushing shot deflects, a holding shot catches, otherwise the lighter is cancelled, equal Weights cancel both, and a heavier shot survives but spends one pierce |
| Same team | shots of one team never interact |
| Lobs | in the air: never intercepted |
| Budget | at most `maxInterceptsPerTick` = 32 interceptions per tick |
| Guard | deflects only shots no heavier than the guarding Pokémon (Gastly, Weightless, can deflect shots but not heavy shots) |

Area forces (strike, nova, aura, smite, cone, beam, and pushing or holding zones such as a dash or Fire Spin) act on
enemy shots inside their shape through `forceOnShots`.

## Suspend-and-release Hold (`sim/bodies.ts`)

| Rule | Value |
| --- | --- |
| Suspend | Hold Power ≥ Weight lifts the body to `holdDistance` = 1.5 m in front of you (further for big bodies) at up to 14 m/s; the owner changes (25% integrity if it changes hands) |
| Duration | up to `holdTime` = 1 s; a Move A / Move B hold ends early when you let go of its button; the basic attack and Tag Actions hold for the full second |
| Release | a Push of the hold's Power along your aim: 8 × (1 + 0.5 × (P − W)) m/s. It counts as that tick's push, so a partner's push within 0.2 s and 45° combines with the throw |
| Combine | a second hold within `combineWindow` = 0.2 s and 45° counts as the stronger Power + 1 |
| Too light | Power < Weight only slows it, × (1 − 0.15 P), like a push |
| Drops | a stunned (paralysed) or fainted holder drops it where it is; a carried Transport egg cannot be held |
| Passes | your own shots and strikes pass a body you are holding |

The holder is not rooted; the *Lodestone* technique (Phase 8b, `docs/BUILDS.md`) is where "you cannot move while holding"
belongs as a cost. `suspendHold: false` restores v10's pull (7 m/s toward you).

## Body-on-body impacts

A body moving at 5 m/s or more that runs into another body strikes it for 10 × Weight × speed / 10 integrity, typed as
itself, and shoves it as a Push of its own Weight (so the combine rule and owner change apply). Something as heavy
stops it (× −0.3, it bounces back); something lighter only slows it (× 0.6). Pieces of one break do not strike each
other in their first 0.25 s; a pair strikes at most once per 0.5 s.

## Fire in the flow field (`sim/world.ts`, `sim/cells.ts`)

While any tile burns, the enemy flow field is a weighted one: entering a burning tile costs `burnNavCost` = 8 steps
(Dial's bucket queue). The 10 Hz cell pass rebuilds it when the set of burning tiles changes. Enemies that see fire
underfoot or within 2.4 m ahead follow the field around it; Fire types walk through. With no fire anywhere the plain
BFS runs, unchanged.

## Create

`createBody` is the Create verb (Rock Throw's rock as a Tag Action). Each player keeps at most `createCap` = 6
created bodies; the oldest breaks first.

## Event log, death recap and debugging (`sim/caplog.ts`)

Every settled capability event is written to a fixed ring of preallocated records (`ctx.caplog`, 512 world records plus
a 64-record ring for hits on the player and faints, so a dense shot field cannot push those out). Recording never
allocates and never draws from an RNG stream. When the whole squad faints, `ctx.recap` gets the last `recapSeconds` = 5 s
as lines that name the rule that decided each outcome, and the end screen shows them under "What happened":

- *Boulder (Weight 3, Rock) hit you for 34. Your Guard: Light (1). Only a Pokémon of Weight 3 or more can deflect it — dodge it, push it, or break it.*
- *Oddish's Poison shot (Weight 0) hit you for 5. A timed Guard deflects it; a Push or your own shot can stop it too. (×6)*
- *Your Water Pulse (Push 2) could not move the Boulder (Weight 3). Two forces within 0.2 s and 45° add +1 Power.*
- *Most of it came from Oddish: 28 of 34 damage in the last 5 s.*

In the browser console: `pokewatch.debug('caps')` toggles the overlay (Weight badges on bodies, shots and nearby enemies,
your Guard's Weight, Power pips per move, hold tethers, and the last 3 s of capability events where they happened, plus
a text list); `pokewatch.caps(seconds)` returns the log as lines; `pokewatch.recap()` builds the recap now. `?debug=caps` starts
with the overlay on.

## Flags

| Flag | Default | Off means |
| --- | --- | --- |
| `caps.enabled` | true | the v10 rules exactly (no log, no recap) |
| `caps.interception` | true | shots ignore each other and every force; Guard deflects any shot |
| `caps.suspendHold` | true | Hold pulls (v10) |
| `caps.bodyCollisions` | true | bodies pass through each other |
| `caps.burnNavCost` | 8 | 1 = fire does not change paths |

## Measurements (2026-10-21, headless, this build)

| Check | Result |
| --- | --- |
| Tests | 104/104 (`npm test`): the 79 from v10 plus 25 in `tests/caps.test.ts` (rule, property, scenario, regression and determinism tests) |
| Typecheck | clean |
| Flags off = v10 | `scripts/checksum.ts` "caps off" prints the v10 hashes exactly at every 60 s mark of all four configurations (420 / 420 / 300 / 240 s); `tests/caps.test.ts` checks the same at 30 s marks |
| Determinism with every feature on | two runs with the same seed and scripted inputs (aim sweeps, Move A/B holds, Guard taps, dashes) give the same state hash every 10 s and the same number of log records |
| Sim cost at ~500 enemies, min of 3 replays | **p50 0.53 ms, p95 0.92 ms, p99 1.13 ms** (`perf-sim.ts 500 --repeat 3 --gate`: both gates PASS). v10 measured the same way: p50 0.53, p95 1.00, p99 1.24 ms; this build with `caps.enabled: false`: p95 0.98, p99 1.15 ms |
| Sim cost, raw single pass | p95 1.3–2.1 ms, p99 3.5–6.6 ms on every build including v10: this container is shared and noisy (identical v10 runs ranged from p99 3.5 to 6.0 ms). The min-of-N figure is the intrinsic cost; re-check raw p99 on a quiet machine |
| Weighted flow field | 0.5 ms per rebuild (BFS 0.25–0.35 ms); a first binary-heap version cost 1.9 ms and was replaced by Dial's bucket queue |
| Bot survival, 6 partners × 4 seeds × 300 s, Classic | all features on: 13/24 reach 300 s (mean 205 s, 922 KOs, 219 damage taken); `caps.enabled: false` (= v10): 12/24 (196 s, 872 KOs, 233); interception off, the rest on: 10/24 (182 s, 750 KOs, 231). Interception helps a little; fire routing makes pursuers slightly better at reaching you. One changed event reshuffles a whole run, so single seeds swing both ways (Totodile seed 7 dies at 76 s with the features on, 130 s without); judge by the sweep |

## Known limits (Phase 8a)

- **Cues outside the debug overlay.** Normal play shows a held body lifted 0.6 m and the usual push/deflect effects, but no
  tether, Weight badge or Power pip; those are Phase 8c's "Weight and Power cues". `pokewatch.debug('caps')` shows all of them.
- **Hold on creatures** still reels them in 2 m (v10). Suspending Light enemies is the *Lasso* transform (built in Phase 8b).
- **No Hold of Power 3 exists in the content**, so catching a boulder alone is still impossible: it takes two holds
  combined (Power 2) plus one more, i.e. a Psychic recruit or *Lodestone* (deferred by the blueprint, decision 19).
- **The 0.3 s Tag Action combine window** (section 8, "honest limit, solo") is not in this phase; holds and pushes combine
  within 0.2 s.
- **Enemies have no Push or Hold sources**, so enemy forces never act on the player's shots; the resolver is symmetric
  and will apply the same rules when they do.
- **Shot against shot** follows one reading of the rule: the lighter shot is cancelled, equal Weights cancel both, and a
  heavier shot survives but spends one pierce. Lobs and held shots never intercept.
- **Bodies** collide only while one moves at 5 m/s or more; resting bodies can overlap (no stacking, no separation).
- **Fire routing** is consulted when fire is underfoot or within 2.4 m ahead; elsewhere enemies still steer straight at you.
  The field is rebuilt at most 10 times a second (when the burning set changes) and on each new player tile.
- **One player.** Holds, the Create cap and the recap read `ctx.player`; the `ctx.players` refactor (Phase 9) will move them.
- **Bot coverage.** The balance bot never aims, guards or holds on purpose, so sweeps exercise interception and impacts
  far more than Hold. Readability and the recap wording are untested with people (hypotheses V4, V6, V7).
