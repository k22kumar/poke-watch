# Loadout, swap, Tag and coats

Design: *Poke-Watch Unified Squad Blueprint*, cut down by the hero-shooter pivot (docs/hero-shooter-pivot.md Q10, Q11):
one Pokémon per player by default, and swapping as a system a mode opts into. Every number lives in
`src/rules/defaults.ts` (`hero`, `squad`, `reactions`, `combat`).

## The loadout (`sim/types.ts`, `sim/squad.ts`)

- `Player` is the trainer's body (position, input, Reflex) plus `squad: Member[]` and `active`. Creature fields (`hp`,
  `species`, `moves`, …) are accessors onto the active member, so systems written for one Pokémon run unchanged.
  `ctx.players` holds every player (one today; T2's hero bots join it).
- `rules.hero.loadout` (1) caps how many Pokémon a player brings; `RunOptions.loadout` names the others, each with its
  hero kit (`addLoadoutMember`, docs/HEROES.md). The `range` and `hold` modes bring one.
- The squad's core (`squadSystem`) runs in every mode: the field timer, Flash Fire, and the faint. A fainted player with
  no Pokémon left comes back at the spawn at full health after `rules.hero.respawn` s (3 in `range`); 0 ends the run.

## Swapping (`sim/swap.ts`, the `swap` Mod)

Registered only by a mode that wants it (`RANGE_SWAP` in `src/mods/index.ts`, docs/RANGE.md; not in `MODES`, so not on
the title screen). With one Pokémon it never runs, and the
`tagAction` readiness check counts only where `hero.loadout` > 1.

| Rule | Value |
| --- | --- |
| Loadout | `range-swap`: 3 (`hero.loadout`); `squad.max` 3 is the ceiling |
| Tag | Q / Y. Tap: back to the last Pokémon. Hold (`squad.holdPick` 0.25 s) + primary / secondary fire (left / right mouse, RT / LT): first / second reserve |
| Tag cooldown | 4 s, squad-wide; not during the Guard whiff lock or a dash. Reflex belongs to the trainer, so a swap never refills Dash or Guard |
| Arrival | Same spot, 0.15 s invulnerable; Tag Action 0.2 s later toward the aim |
| Tag Action | One move per line (`rules/tags.ts`: an authored `TAG_ACTIONS` entry, else `tagLineOf` derives one from the line's own moves: its earliest damaging move of its type, then its strongest by Lv 30), at the flat `squad.tagActionLevel` (3, Q26), ×1.8 damage, ×1.5 knockback, deep coat. Tag variants were deleted at pivot step 9 |
| Grey health | 40 % of each hit; drains on the field (half-life 2.8 s); refills 3 % max HP/s on the bench |
| Bench | Cooldowns tick at 1.0× (`benchCdRate`); coats and paralysis wear off 2× faster; no auras, no actions |
| Fainting | The next Pokémon comes in after 1 s with a free Tag Action; with none left, the respawn above |

`range-swap` is kept alive by the `range-swap` replay scenario (`tests/fixtures/scenarios.ts`: Tag taps, a Tag Action,
grey health).

## Coats and reactions (`rules/reactions.ts`, `sim/coats.ts`)

- The four tile agents (Heat, Wet, Cold, Charge) also coat creatures. **Light** coats come from the basic attack (3 s);
  **deep** coats come from Abilities, Tag Actions, deflected shots and tiles (8 s). A light agent never spends a deep
  coat. Coat strength is a flat tunable since the pivot (`reactions.tileStrength` 30, Q40).
- Reactions: Steam (Heat + Wet), Freeze then Shatter (Wet + Cold; next physical hit or push ×2), Conduct (Charge into
  Wet, chains through Soaked creatures), Overload (Heat + Charge, outward push), Cancel (Heat + Cold).
- Crowd-control meter per creature (`reactions.cc`): 2 s of stun, freeze or root within the decay window → 4 s immune.
  Ground types ignore Charge.

## Incoming types and abilities

Every player-damage source carries an element (enemy contact = the species' first type, shots, thrown bodies) and a
channel (physical or special, docs/HEROES.md). The type chart applies to the power `combat.incomingTypeExp` = 0.5: weak
×1.41, resist ×0.71, immune ×0.5. Defensive abilities work on your side: Levitate (no Ground damage), Flash Fire
(absorbs Fire, then your Fire moves ×1.5 for 10 s), Water Absorb and Dry Skin (Water heals), Sturdy (once per match),
Static and Effect Spore (30 % to stun whatever touches you), Guts (contact ×1.5 while coated or paralysed), Swarm (Bug
×1.5 at ≤ 1/3 HP).

Feedback: the incoming Pokémon's cry and a white puff on Tag, the Tag Action's name over the player. With a loadout of
more than one, the squad strip shows each Pokémon, its HP and grey health, its Tag input and the Tag cooldown.

## Not built yet

- Tag assist (the glyph on the reserve that answers the nearest threat).
- T2 hero bots in `ctx.players` and a mode that gives them loadouts (docs/hero-shooter-pivot.md Q1, Q38).

## Test hooks

`RANGE_SWAP` has no URL or menu entry; its replay scenario (`range-swap`) and `tests/squad.test.ts` drive it. In the
browser, `?go=1&species=totodile&squad=mareep,geodude` adds the members to a `range` run, where nothing swaps them.
Survivor-era measurements (the G4 refactor gate, H2 rotation damage, bot survival) are on the `survivor-final` tag.
