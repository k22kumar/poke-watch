# Squad, Tag and coats: what is built (phases 4–6)

Design: *Poke-Watch Unified Squad Blueprint*. This file records what the code does, the numbers it uses
and what was measured. Every number lives in `src/rules/defaults.ts` (`squad`, `reactions`, `cards`, `combat`).

## Phase 4 — trainer and squad (`sim/types.ts`, `sim/progression.ts`)

- `Player` is the trainer's body (position, input, Reflex, squad level and XP) plus `squad: Member[]` and `active`.
  Creature fields (`hp`, `species`, `moves`, …) are accessors onto the active member, so systems written for one
  Pokémon run unchanged. `ctx.players` exists for multiplayer; it holds one trainer today.
- **G4 (refactor gate): passed.** `scripts/checksum.ts` replays four bot runs (Cyndaquil, Totodile, Bulbasaur,
  Charmander; Classic, Survival, Boss Rush; 240–420 s). The v8 source and the Phase 4 refactor commit give
  identical hashes at every 60 s mark.
- **Banked picks.** Level-ups wait in a tray above the move slots (1 / 2 / 3, or the gamepad d-pad) and the run
  keeps going. `cards.tray: false` restores the pausing modal.

## Phase 5 — coats and reactions (`rules/reactions.ts`, `sim/coats.ts`)

- The four tile agents (Heat, Wet, Cold, Charge) also coat creatures. **Light** coats come from the basic attack
  (3 s, fodder only); **deep** coats come from Move A / B, Tag Actions, deflected shots and tiles (8 s, everything).
  A light agent never spends a deep coat.
- Reactions: Steam (Heat + Wet), Freeze then Shatter (Wet + Cold; next physical hit or push ×2), Conduct (Charge
  into Wet, chains through Soaked creatures), Overload (Heat + Charge, outward push), Cancel (Heat + Cold).
- Crowd-control meter per creature: 2 s of stun, freeze or root within the decay window → 4 s immune; bosses fill
  it twice as fast. Ground types ignore Charge.

## Phase 6 — squad and Tag (`sim/squad.ts`, `rules/tags.ts`)

| Rule | Value |
| --- | --- |
| Squad size | 3; start with the partner |
| Recruits | Offered after an elite or alpha falls, from 2:00 (first) and 5:00 (second): two wild species from the region, plus "Let it go". They join at squad level with their first two attacking level-up moves |
| Tag | Q / Y. Tap: back to the last Pokémon. Hold + Move A / Move B: first / second reserve |
| Tag cooldown | 4 s, squad-wide; not during the Guard whiff lock or a dash |
| Arrival | Same spot, 0.15 s invulnerable; Tag Action 0.2 s later toward the aim |
| Tag Action | One move per line (`rules/tags.ts`), ×1.8 damage, ×1.5 knockback, deep coat. Variant chosen at the first evolution (level 18 for lines that do not evolve) |
| Move slots | 3 per Pokémon (v8 had a 4th from level 20) |
| Grey health | 40% of each hit; drains on the field (half-life 2.8 s); refills 3% max HP/s on the bench |
| Bench | Cooldowns tick at 1.0×; coats and paralysis wear off 2× faster; no auras, no actions; benched Pokémon evolve on the bench |
| Fainting | Next Pokémon in after 1 s with a free Tag Action; run ends when all faint; the portal revives at 30% |

**Your Pokémon's type and ability now count when it is hit** (blueprint section 7). Every player-damage source
carries an element (enemy contact = the species' first type, shots, boss slams, thrown bodies). The type chart
applies to the power `combat.incomingTypeExp` = 0.5: weak ×1.41, resist ×0.71, immune ×0.5. Defensive abilities
work on your side: Levitate (no Ground damage), Flash Fire (absorbs Fire, then your Fire moves ×1.5 for 10 s),
Water Absorb and Dry Skin (Water heals), Sturdy (once per region), Static and Effect Spore (30% to stun whatever
touches you), Guts (contact ×1.5 while coated or paralysed), Swarm (Bug ×1.5 at ≤ 1/3 HP).

Feedback: the incoming Pokémon's cry and a white puff on Tag, the Tag Action's name over the player, banners for
faints, recruits and bench evolutions, portraits on recruit cards. The squad strip (top left) shows each Pokémon,
its HP and grey health, its Tag input and the Tag cooldown.

## Measurements (2026-10-21, headless, this build)

| Check | Result |
| --- | --- |
| Tests | 71/71 (`npm test`) |
| Sim cost at ~500 enemies | p50 0.68 ms, p95 1.34 ms, p99 1.88 ms per tick (`scripts/perf-sim.ts`; gate p95 ≤ 2 ms) |
| **H2** — rotating for cooldowns adds ≤ 15% damage | **Pass.** 10 seeds × 240 s, squad level 15 with two recruits at 60 s: Totodile + Mareep + Geodude +3.8%; Cyndaquil + Poliwag + Heracross −19.1%; Bulbasaur + Vulpix + Swinub −13.2% (`scripts/h2.ts`) |
| Bot survival, 6 partners × 3 seeds, Classic, 600 s | 11/18 runs reach 600 s (v8: 7/18). Chikorita 0/3 (v8 1/3) and Squirtle 1/3 (v8 2/3): watch Grass in Region 1 now that incoming types count |

The bot dies in the first two minutes in about a third of runs in v8 as well, so its survival is not a balance
verdict; H1, H3 and H4 need human players (blueprint section 16).

## Not built yet

- Phase 7 (enemy roles, objectives, the beat director, weather) is built: see `docs/ENCOUNTERS.md`. With objectives on,
  recruits come from the Hunt objective; elite-kill recruits remain only for `objectives.enabled: false`.
- Level-up cards still target the field Pokémon only; the three-card offer (member, technique, wildcard) is Phase 8.
- Tag assist (the glyph on the reserve that answers the nearest threat) and the Auto-mode automatic Tag.
- Multiplayer and PvP (phases 9–10).

## Test hooks

`index.html?go=1&species=totodile&level=14&squad=mareep,geodude` starts with a full squad.
`tools/squadscenes.json` captures the squad HUD, a Tag and a recruit offer with `tools/cap.mjs`.
