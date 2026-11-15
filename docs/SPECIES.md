# Species identity

The research and translation method is in [Pokémon-first design](./POKEMON_FIRST.md). This page records how canonical data from across the Pokémon games is kept separate from Poke-Watch's action-game balance.

## Cross-game data policy

The content importer reads each species' level-up move entries from every official main-series game version represented by PokéAPI. If a move is learned at different levels, `canon.levelUp` records its earliest listed level. Curated move choices and unlock levels in `content/roster.json` are Poke-Watch design decisions; they are checked against the merged learnsets, not copied from a single game's progression.

The importer also retains the Pokémon's listed abilities, including hidden abilities, species measurements, and evolution-chain data. These facts are not all identical across every generation or game. Where the API presents one shared species or move record rather than a version-by-version history, Poke-Watch uses that shared record as reference data and does not claim it represents every historical rules change.

## Learnsets and evolution

The six starter lines have curated move selections in `content/roster.json`. Their game levels are paced for a short action run; canonical move levels only establish that a move belongs to the evolutionary line and gate occasional coverage offers. The importer attaches a move to the earliest form in the line that learns it in the merged data. Unsupported or non-damaging moves can be omitted or adapted where the action game has no useful equivalent.

Wild Pokémon receive a small automatically paced set from their cross-game level-up moves. A move of a different type may appear as a rare coverage offer. This gives species a broader move history without requiring the game to reproduce every generation's TM, tutor, breeding, event, or version-exclusive move system.

Poke-Watch preserves recognizable evolution lines but compresses progression to fit its run. It does not reproduce every game-specific evolution trigger; conditional, trade, item, time, and location requirements are evaluated as design inputs rather than literal player-facing rules.

## Two registries: game species and the reference catalogue

`SPECIES` (`src/rules/species.ts`) is the game's roster: 40 Pokémon with art, moves, behaviour and roles. The reference catalogue (`src/rules/catalogue.ts`, 269 records over 210 species) is a separate authority holding canonical facts for Pokémon the game can *describe* but does not play. The two overlap on 9 identities (`charmander`, `charmeleon`, `charizard`, `rattata`, `gastly`, `slugma`, `magcargo`, and the two deliberate additions `joltik` and `onix`), where the pokedex stays the gameplay authority and the catalogue the reference one; `tests/catalogue.test.ts` asserts they agree on types, canonical height and canonical weight for all 9. An overlap is created only by giving a species a role in `content/roster.json` and regenerating; a catalogue record never becomes a game species on its own.

The split is structural, not stylistic. `profilesFor()` and `playableLine()` (`src/world/habitat/mode.ts`) take min/max over the whole of `SPECIES` to produce habitat navigation radii, so a reference record inside that set would change which habitat layouts are accepted and move every replay hash. Nothing in `src/sim/`, `src/world/`, `src/render/`, `src/ui/` or `src/rules/species.ts` imports the catalogue.

Canonical families live only in the catalogue, as complete chains with every branch kept. The game's paced progression remains `evolvesTo` / `evolveLevel` on a `SpeciesDef` — the only thing `progression.ts`, `lineage()`, `starterFamilyRoot()` and `playableLine()` read. A canonical edge never becomes an in-run evolution: of the catalogue's 102 directed edges, only `charmander>charmeleon` and `charmeleon>charizard` also exist as in-run pacing, and the ten other in-run edges (the five non-Charmander starter lines) are outside the catalogue's scope. `docs/PIPELINE.md` covers how the catalogue is generated and what its measurement qualifiers mean.

## Joltik and Onix (Meadow and Badlands wild encounters)

Two ordinary wild Pokémon added through the normal pipeline — `content/roster.json` role entries plus `npm run content`; no new behaviour, no new spawn mechanic.

| | Joltik | Onix |
|---|---|---|
| PokéAPI identity | `pokemon/joltik` id 595, species 595 | `pokemon/onix` id 95, species 95 |
| Typing (slot order) | bug, electric | rock, ground |
| Listed extent / mass | 0.1 m / 0.6 kg | 8.8 m / 210.0 kg |
| SpriteCollab | `sprite/0595`, 8 of 13 animations used, portrait, shadow 0 | `sprite/0095`, 7 of 13 used, portrait, shadow 2 |
| Role | wild `ranged`, shot `hive`, Meadow weight 1.4 | wild `tank`, Badlands weight 1.2 |
| Tag Action (`rules/tags.ts`) | Electroweb → Discharge | Rock Throw (leaves a rock) → Rock Slide |
| Native habitat tags (`rules/habitats.ts`) | grass, forest | rock, dry |
| Gameplay height (sprite rule) | 0.9 m (clamp floor) | 3.02 m |
| Weight class | Light (0.6 kg) | Massive (210 kg) |
| Visible size (`rules/sizing.ts`) | Tiny, core 0.78 m (clamped), scale ×1.248 | Extra Large, core 2.55 m (clamped), scale ×0.887 |

Neither has a `Faint` animation in SpriteCollab; both fall back through `src/assets/art.ts` like the rest of the roster. Onix has `Slam` where the importer wants `Strike`, so it uses seven states.

**Onix's listed extent measures the wrong axis.** 8.8 m is the length of the whole serpent, most of it tail on the ground; the PMD idle pose is a rearing column 46 px tall and 24 px wide, so the visible upright silhouette is roughly a third of the listed figure. The curve clamps anything over ~5 m of extent to the same 2.55 m core, so Onix renders identically whether the input is 8.8 m or a reviewed upright figure of 5 m or more, and the listed number is kept rather than guessed. A reviewed upright extent **below** 5 m would change what is drawn and belongs in `NEUTRAL_CORE_EXTENT_M` (`src/rules/sizing.ts`), which stays empty until such a figure is approved.

**Joltik shoots Bug, not Electric.** A `volt` projectile lays the Charge agent (`sim/cells.ts`), which floods up to 30
connected wet or water cells; the Meadow has ponds and a river, so a Joltik line of fire turned most of the region into
a repeating flood. Measured on the bot with a 4000 HP partner: with `volt` every seed tried (1–7) ended in a Charge
flood before the 5:00 boss, 500–1500 damage in the last five seconds; with `hive` the same seeds clear region 1
normally. Bug is Joltik's first type slot and its early STAB (Bug Bite, Signal Beam, Bug Buzz), so the shot stays
canonical. Its Electric identity is intact elsewhere: typing, weakness chart, the Electroweb / Discharge Tag Action,
and the type rule that makes any Electric creature discharge while it stands in water.

Onix is also the first ordinary wild Pokémon taller than the partner forms (3.02 m, collision radius 1.21 m). It is not in any region's `elites`, so it never spawns at elite or alpha scale; `profilesFor()` (`src/world/habitat/mode.ts`) therefore applies the elite multiplier only to elite-capable species and keeps the validated 1.42 m headroom as a floor, which leaves every habitat layout, accepted seed and `docs/habaudit/baseline.json` checksum unchanged.

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

`tests/identity.test.ts` checks that curated moves are supported by their evolutionary line's canonical list and that progression remains separate from canonical evolution data. `tests/pack.test.ts` exercises merging duplicate move entries across game versions, retaining the earliest level, and preserving hidden abilities in imported data. `tests/catalogue.test.ts` asserts the catalogue's exact inventory (269 records, 210 species, 59 varieties, 108 families, 102 edges, 39 singletons, 28 form/region conditions), that measurement placeholders are never exposed as values, and that no catalogue record reaches `SPECIES` or the sim bundle.
