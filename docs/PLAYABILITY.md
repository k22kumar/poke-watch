# Playing as any Pokémon (developer roster)

Any species in the game can lead a run. The developer roster lists all of them, works out from the game's own data which ones work under player control, and lets you start or switch to any of them without editing code. No list of Pokémon is kept by hand: a Pokémon added to `content/roster.json` and generated with `npm run content` shows up in the roster the next time the game starts.

## Using it

| Where | How |
|---|---|
| Partner screen | Open the game with `?dev=1` (e.g. `http://localhost:5173/?dev=1`), then Play. The All Pokémon view lists every species grouped Ready / Partial / Not playable yet, with a filter (name, type, role, size class). Click a card, then Start run. **Show starters** switches back to the normal three-starter offer. |
| During a run | Open the tuning panel (backtick, or Pause → Tuning panel). **Play as**, then **Restart as**, restarts the run as that species, with the same mode and seed. Works with or without `?dev`. |
| Console | `console.table(pokewatch.roster())` prints every species with its tier, opening move and reasons. `pokewatch.become('lapras')` restarts the current run as Lapras. |
| URL | `?go=1&species=lapras` still starts directly; it composes with `calm`, `level`, `squad`, `stage`, `seed`, `mode`. |

Switching restarts the run instead of swapping in place. A restart goes through the same `startRun` as a new game (state, camera, HUD and audio all reset), so switching cannot leave stale state behind. Use `?level=` or **+1 level** to get back to a later point quickly.

Without `?dev`, the partner screen is unchanged: three seeded starters from the partner lines and one mulligan. `playable` on a species still means "offered as a starter" (`starterChoices`, `rules/species.ts`). It is not the same as "can be played as", and the developer roster never reads it as a gate.

## Readiness

`src/sim/playability.ts` grades each species in `SPECIES` with a list of checks. Each check returns `null` when the species passes, or the reason it fails.

| Check | Severity | Passes when |
|---|---|---|
| `registered` | block | base stats are complete (hp > 0) and it has at least one type |
| `openingKit` | block | it has an opening move (below) that is in the move database, is not a status move, and compiles to an archetype with a behaviour |
| `body` | warn | `bodyOf` gives a finite radius, height and footprint, and the body is not an authored boss body (see below) |
| `tagAction` | warn | its line resolves a Tag Action (`tagLineOf`) whose moves exist |
| `art` (browser only) | block | its sprite art and portrait loaded (`renderer.portrait`); added by `src/main.ts` as a host check |

- **Tiers.** `ready` passes every check. `partial` fails only warn checks: it is selectable, with the reasons shown. `unavailable` fails a block check: it is listed with the reason but cannot be picked. A species that never joins the squad in a run (`recruitable: false` in `SPECIES_OVERRIDES`: Eternatus, Stakataka) is still listed and playable here, with its reason shown as "Wild only: …".
- **Opening move** (`openingMove`, `sim/progression.ts`). In order: the species' curated `starter`; else its line's starter (an evolved partner picked directly, e.g. Ivysaur opens with Vine Whip); else its first attack, using the same rule recruits join with (`firstAttacks`: the earliest non-status level-up move, else any non-status move it learns, else the basic attack `rules.moves.fallbackAttack`, Tackle, for a species that learns no damaging move, such as Cosmog; its derived Tag Action uses the same move). Starters take the first branch, so runs led by a starter, and their replay hashes, are unchanged.
- **Bosses are partial.** A boss keeps its encounter-scale body (`sp.scale`, `bodyOf().authored`): a hurt height of 3.4 to 4.5 m and a capped footprint. The player sprite, though, is drawn at 1×. A boss therefore plays, but its hitbox is larger than it looks. Fixing this means giving bosses a separate player-scale body (rules/sizing.ts) or drawing them at their authored scale as the player.

**Current roster (2026-11-16):** 68 ready (the six partner lines with their evolutions, and every wild species) and 4 partial (the four bosses, `body`).

## Adding or changing a check

- **A new requirement.** Add an entry to `READINESS_CHECKS` in `src/sim/playability.ts`. The roster UI, the console table and the tests all read the same list.
- **Something only the browser knows.** Pass it as an extra `ReadinessCheck` (see `ART_CHECK` in `src/main.ts`).
- **Hold back one species.** Rather than adding a per-species flag, make the reason a check can detect. A per-species override in `SPECIES_OVERRIDES` (`src/rules/profiles.ts`) is the place if one is ever needed.

## Tests

`tests/playability.test.ts`:

- every species is graded, and anything short of ready carries a reason;
- the current tiers (non-bosses ready, bosses partial on `body`);
- the opening-move rule (starters keep theirs, evolved partners take their line's);
- every selectable species starts a run with its opening move and deals damage to nearby enemies under the bot within 8 s;
- every species ships an atlas, a portrait and a Walk or Idle clip in `src/content/art.json` (every other animation state falls back to those);
- a failing host check makes a species unavailable;
- the production starter pool is still the six partner lines.

A new Pokémon that cannot actually play fails `npm test`, with the reason in the message.
