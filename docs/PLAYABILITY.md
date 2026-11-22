# Playing as any Pokémon (developer roster)

Any species in the game can be the hero of a run. The developer roster lists all of them, works out from the game's own data which ones work under player control, and lets you start or switch to any of them without editing code. No list of Pokémon is kept by hand: a Pokémon added to `content/roster.json` and generated with `npm run content` shows up in the roster the next time the game starts.

## Using it

| Where | How |
|---|---|
| Hero pick | Open the game with `?dev=1` (e.g. `http://localhost:5173/?dev=1`), then Play. **All Pokémon (dev)** lists every species grouped Ready / Partial / Not playable yet, with a filter (name, type, role, size class). Click a card, then Start run. **Show heroes** switches back to the prototype list. |
| During a run | Open the tuning panel (backtick, or Pause → Tuning panel). **Play as**, then **Restart as**, restarts the run as that species, with the same mode and seed. Works with or without `?dev`. |
| Console | `console.table(pokewatch.roster())` prints every species with its tier, opening move and reasons. `pokewatch.become('lapras')` restarts the current run as Lapras. |
| URL | `?go=1&species=lapras` starts directly; it composes with `seed`, `mode` (`range`, `hold`), `loc` and `mapseed`, `evolve` and `tp`. |

Switching restarts the run instead of swapping in place. A restart goes through the same `startRun` as a new game (state, camera, HUD and audio all reset), so switching cannot leave stale state behind.

Without `?dev`, the hero screen shows the prototype list (`PROTOTYPE`, `FEATURED` first; `src/rules/heroes.ts`); the starter offer and mulligan were deleted at hero-shooter pivot step 9. `playable` on a species marks the partner lines. It is not the same as "can be played as", and the developer roster never reads it as a gate.

## Readiness

`src/sim/playability.ts` grades each species in `SPECIES` with a list of checks. Each check returns `null` when the species passes, or the reason it fails.

| Check | Severity | Passes when |
|---|---|---|
| `registered` | block | base stats are complete (hp > 0) and it has at least one type |
| `openingKit` | block | it has an opening move (below) that is in the move database, is not a status move, and compiles to an archetype with a behaviour |
| `body` | warn | `bodyOf` gives a finite radius, height and footprint, and the body is not an authored encounter-scale body (see below) |
| `tagAction` | warn | its line resolves a Tag Action (`tagLineOf`) whose moves exist; counted only in a mode whose `hero.loadout` > 1 (docs/SQUAD.md) |
| `art` (browser only) | block | its sprite art and portrait loaded (`renderer.portrait`); added by `src/main.ts` as a host check |

- **Tiers.** `ready` passes every check. `partial` fails only warn checks: it is selectable, with the reasons shown. `unavailable` fails a block check: it is listed with the reason but cannot be picked. A species marked `recruitable: false` in `SPECIES_OVERRIDES` (Eternatus, Stakataka, Shedinja: "needs its Ability rule") stays out of `PROTOTYPE` but is still listed and playable here, with its reason shown.
- **Opening move** (`openingMove`, `rules/heroes.ts`). In order: the species' curated `starter`; else its line's starter (an evolved partner picked directly, e.g. Ivysaur opens with Vine Whip); else its first attack (`firstAttacks`: the earliest non-status level-up move, else any non-status move it learns, else the basic attack `rules.moves.fallbackAttack`, Tackle, for a species that learns no damaging move, such as Cosmog; its derived Tag Action uses the same move). Starters take the first branch, so runs led by a starter, and their replay hashes, are unchanged.
- **The four former bosses are partial.** Sudowoodo, Magcargo, Articuno and Houndoom are ordinary species since pivot step 9 (Q28), but keep the authored encounter-scale body from their boss days (`sp.scale`, `bodyOf().authored`): a hurt height of 3.4 to 4.5 m and a capped footprint, with the sprite drawn at 1× as the player. They play, but their hitbox is larger than they look. Fixing this means dropping `scale` from their roster entries (their body then follows the size classes).

**Current roster (2026-11-20):** 244 species: 240 ready and 4 partial (the four former bosses, `body`).

## Adding or changing a check

- **A new requirement.** Add an entry to `READINESS_CHECKS` in `src/sim/playability.ts`. The roster UI, the console table and the tests all read the same list.
- **Something only the browser knows.** Pass it as an extra `ReadinessCheck` (see `ART_CHECK` in `src/main.ts`).
- **Hold back one species.** Rather than adding a per-species flag, make the reason a check can detect. A per-species override in `SPECIES_OVERRIDES` (`src/rules/profiles.ts`) is the place if one is ever needed.

## Tests

`tests/playability.test.ts`:

- every species is graded, and anything short of ready carries a reason;
- the current tiers (everything ready but the four authored-scale bodies, partial on `body`);
- the opening-move rule (starters keep theirs, evolved partners take their line's);
- every selectable species starts a run with its opening move and deals damage to nearby enemies under the bot within 8 s;
- every species ships an atlas, a portrait and a Walk or Idle clip in `src/content/art.json` (every other animation state falls back to those); in the browser the roster's art check reads the art manifest (`dist/art/`), not loaded art, which arrives only when a match needs it;
- a failing host check makes a species unavailable;
- `starterEligibleSpecies()` is the six partner lines and the Caterpie test line; the dev roster never reads `playable`.

A new Pokémon that cannot actually play fails `npm test`, with the reason in the message.
