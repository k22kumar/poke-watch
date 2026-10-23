# Species identity

The research and translation method is in [Pokémon-first design](./POKEMON_FIRST.md). This page records how canonical data from across the Pokémon games is kept separate from Poke-Watch's action-game balance.

## Cross-game data policy

The content importer reads each species' level-up move entries from every official main-series game version represented by PokéAPI. If a move is learned at different levels, `canon.levelUp` records its earliest listed level. Curated move choices and unlock levels in `content/roster.json` are Poke-Watch design decisions; they are checked against the merged learnsets, not copied from a single game's progression.

The importer also retains the Pokémon's listed abilities, including hidden abilities, species measurements, and evolution-chain data. These facts are not all identical across every generation or game. Where the API presents one shared species or move record rather than a version-by-version history, Poke-Watch uses that shared record as reference data and does not claim it represents every historical rules change.

## Learnsets and evolution

The six starter lines have curated move selections in `content/roster.json`. Their game levels are paced for a short action run; canonical move levels only establish that a move belongs to the evolutionary line and gate occasional coverage offers. The importer attaches a move to the earliest form in the line that learns it in the merged data. Unsupported or non-damaging moves can be omitted or adapted where the action game has no useful equivalent.

Wild Pokémon receive a small automatically paced set from their cross-game level-up moves. A move of a different type may appear as a rare coverage offer. This gives species a broader move history without requiring the game to reproduce every generation's TM, tutor, breeding, event, or version-exclusive move system.

Poke-Watch preserves recognizable evolution lines but compresses progression to fit its run. It does not reproduce every game-specific evolution trigger; conditional, trade, item, time, and location requirements are evaluated as design inputs rather than literal player-facing rules.

## Ability adaptations

Each species keeps all listed abilities in canonical data. `abilityOf` (`src/rules/abilities.ts`) chooses the first ability with a supported action-game adaptation. That adaptation is deliberately not a full simulation of every generation's ability rules; it should create a visible trigger, counterplay, or meaningful interaction.

| Ability | Action-game adaptation |
|---|---|
| Overgrow / Blaze / Torrent | Matching-type moves gain power at low health; a type-coloured aura and HUD chip show the trigger. |
| Levitate | Immune to Ground damage. |
| Flash Fire | Immune to Fire damage; absorbing it boosts attacks. |
| Water Absorb / Dry Skin | Water interactions heal. |
| Sturdy | Once per run, a lethal hit from full health leaves the Pokémon at 1 HP. |
| Magma Armor | Immune to chill. |
| Early Bird / Vital Spirit | Sleep ends sooner or is prevented. |
| Guts / Swarm | Contact damage is stronger under the relevant status or health condition. |
| Static / Effect Spore | Contact can apply the supported status effect. |
| Chlorophyll | Moves faster during the game's sun-like Fire weather. |
| Pressure | Nearby opponents' cooldowns recover more slowly. |

Other abilities remain data-only until their canonical behavior maps cleanly to an existing rule and can be communicated clearly. For example, an ability whose only purpose is preventing a mechanic the game does not have should not receive an arbitrary substitute.

## Move translation

Moves are classified into action shapes using shared move data and Poke-Watch's classifier. The move's recognizable intent matters more than exact RPG turn mechanics: cooldowns replace PP, and targeting, wind-up, area, hit timing, and effects are tuned for real-time play.

The game does not model every move-specific rule across the series. Examples include two-turn charge states, recoil, lock-in and confusion, user stat drops, fixed damage, and effects dependent on turn order or accuracy checks. Where a move has no useful action-game equivalent, it is simplified or omitted rather than represented inaccurately.

Move power and effects have changed between games. The importer uses PokéAPI's shared move record for reference; the simulation then uses its own damage, cooldown, capability, and type-effectiveness rules. A listed base power is not a promise that the in-game move behaves exactly as it did in every Pokémon title.

## Verification

`tests/identity.test.ts` checks that curated moves are supported by their evolutionary line's canonical list and that progression remains separate from canonical evolution data. `tests/pack.test.ts` exercises merging duplicate move entries across game versions, retaining the earliest level, and preserving hidden abilities in imported data.
