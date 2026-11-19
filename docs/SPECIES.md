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

`SPECIES` (`src/rules/species.ts`) is the game's roster: 234 Pokémon with art, moves, behaviour and roles. The reference catalogue (`src/rules/catalogue.ts`, 269 records over 210 species) is a separate authority. It holds canonical facts for Pokémon the game can *describe* but does not play. The two overlap on 203 identities: the 7 that already had a role, then `joltik` and `onix`, then the 32 of the 2026-11 wave, then the 162 of the catalogue wave (below). For those, the pokedex stays the gameplay authority and the catalogue the reference one. `tests/catalogue.test.ts` asserts the two agree on types, canonical height and canonical weight for all 203. An overlap is created only by giving a species a role in `content/roster.json` and regenerating; a catalogue record never becomes a game species on its own.

The split is structural, not stylistic. A reference record inside `SPECIES` would join `all-wild` spawn pools and the habitat navigation profiles (`profilesFor()`, `src/world/habitat/mode.ts`), which would change which habitat layouts are accepted and move every replay hash. Nothing in `src/sim/`, `src/world/`, `src/render/`, `src/ui/` or `src/rules/species.ts` imports the catalogue.

Canonical families live only in the catalogue, as complete chains with every branch kept. The game's paced progression remains `evolvesTo` / `evolveLevel` on a `SpeciesDef` — the only thing `progression.ts`, `lineage()`, `starterFamilyRoot()` and `playableLine()` read. A canonical edge never becomes an in-run evolution: of the catalogue's 102 directed edges, only `charmander>charmeleon` and `charmeleon>charizard` also exist as in-run pacing, and the ten other in-run edges (the five non-Charmander starter lines) are outside the catalogue's scope. `docs/PIPELINE.md` covers how the catalogue is generated and what its measurement qualifiers mean.

## Why the catalogue Pokémon were not in the game

The earlier integration (docs/pokemon-integration-plan.md) delivered the 269 catalogue records as reference data only, by agreed scope: no sprite, move, behaviour or spawn entry. That is why the researched roster was not visible in play. A catalogue record becomes a game species only through `content/roster.json` (docs/CUSTOMISING.md §1). Since the catalogue wave, every catalogue species with SpriteCollab art is a game species; the 66 catalogue-only records are the 59 varieties (Gigantamax, regional and other forms; F2 in docs/pokemon-integration-plan.md) and 7 species with no usable art yet.

## The 2026-11 wave (32 wild Pokémon)

32 catalogue species became ordinary wild encounters: `content/roster.json` `wild` entries, `npm run content` from `fetch-sources` clones, and a place in each region's preset (`src/rules/spawning.ts`, composed over the `*-classic` tables). They needed no new mechanics. Tag Actions are derived from each Pokémon's own moves (`tagLineOf`, `src/rules/tags.ts`); Snorlax has an authored one. Habitat preferences are in `src/rules/profiles.ts`. None has a hard restriction.

| Region | Pokémon (size class) |
|---|---|
| Sunpetal Meadow | Pichu (T), Togepi (T), Budew (T), Cutiefly (T, flies), Pikachu (S), Turtwig (S), Sentret (M), Furret (L), Doduo (L, grounded), Snorlax (XL) |
| Cinder Badlands | Diglett (T), Rolycoly (T), Koffing (S, floats), Sizzlipede (M), Makuhita (M), Ekans (M), Silicobra (M), Hariyama (XL) |
| Rimefrost Heights | Snom (T), Snorunt (M), Sneasel (M), Bergmite (M), Cetoddle (L), Lapras (L) |
| Duskwood Hollow | Litwick (T), Murkrow (S, flies), Impidimp (S), Noibat (S, flies), Dreepy (T, flies), Honedge (M), Haunter (L, flies), Gengar (L) |

Notes:
- **Size letters** are the default classes since the size-extremes flip (measurement axis on, `docs/SIZING.md` "Measurement axis"): Ekans and Silicobra are Medium, Lapras Large and Dreepy Tiny by their listed body lengths. With the axis off they are Large, Extra Large, Extra Large and Small.
- **All 32 have SpriteCollab sheets.** Pikachu's `latest` cry upstream is an MP3 under an `.ogg` name. The importer now treats a recording in the wrong format as missing and takes the `legacy` one, and `fetch-sources` checks out both eras.
- **Electric Pokémon in a wet region make Charge floods** (see Joltik below). With Pichu swarming in fours and Pikachu at full weight, Meadow Charge hits doubled and tank-bot deaths appeared. Pichu now `chase`s at weight 0.5 and Pikachu sits at 0.7. Over 16 seeds, deaths match the classic tables, with about 30 % more Charge hits.
- **Doduo** is a Flying type that cannot fly, so the roster sets `"flying": false`.
- **Verified.** Every new Pokémon spawned in its region on both authored and generated maps (bot runs, seeds 1–2). Each one fired its Tag Action after recruiting, and the browser drew each region's row (`tools/sizescenes.json` `size-wave-*`).
- **Balance.** Over 36 bot runs, survival matches the classic tables (313 s each). Deaths are 12 vs 14, and kills are about the same. Fewer runs clear region 1 by 7:00 (stage mean 0.39 vs 0.53).

## The catalogue wave (162 wild Pokémon) and default roles

The 169 species of the catalogue's families that had no role came in on 2026-11-18 (docs/size-extremes-plan.md §S2) as
`wild` entries with `"wave": "catalogue"` and no authored role. Keys are PokéAPI Pokémon slugs, the catalogue's id
namespace (`aegislash-shield`, `giratina-altered`); `fetch-sources` resolves a slug through its species' default variety.

- **Seven are skipped for want of art** and stay catalogue-only: Crustle, Amoonguss, Carkol, Coalossal, Shroodle and
  Toedscruel have no SpriteCollab sprite folder, and Gimmighoul has sheets only for its Roaming form. The importer
  reports them (`content/report.json` `skipped`) instead of stopping; a later fetch picks them up once art exists.
- **Falinks** draws from SpriteCollab's `Trooper` folder (`0003`, the folder the tracker marks canon; `spriteFolders` in
  the roster). Its own folder, the six-member formation, has no sprites, and `Brass` (`0002`) is a non-canon variant. The
  Trooper sheet draws a single trooper, so an owner-reviewed `NEUTRAL_CORE_EXTENT_M` entry of 0.5 m (one trooper; the
  listed 3.0 m measures the six-trooper formation) makes it Small, not Extra Large.
- **Gouging Fire, Grafaiai and Raging Bolt** have Idle but no Walk; the game walks them on Idle.
- **Meltan and Melmetal** have no playable cry (upstream's `latest` file is an MP3, with no `legacy` one); the game
  synthesises a call.
- **Not in any region's pool.** They are eligible wherever a pool uses `all-wild`, except the 23 legendary and mythical
  ones (`canon.special`, from the pinned snapshot's flags), which appear only in a pool that names them.
- **Eternatus and Stakataka are wild only** (`recruitable: false` in `SPECIES_OVERRIDES`, with the reason): Eternatus
  until its chase-lens regression is fixed or signed off, Stakataka because its partner framing needs more than
  `frame.max` (14 m); both are the follow-up "giant partners and the camera" (docs/size-extremes-plan.md §S2.12). The
  `?dev=1` roster still lists them, with the reason. Cosmog and Cosmoem learn no damaging move, so they open with and
  tag in with the basic attack (`rules.moves.fallbackAttack`, Tackle), and grade `ready`.
- **Checksum layer:** `rules.spawning.waves.catalogue` off takes the wave out of every pool and the habitat profiles;
  `catalogue-off`, `gen-catalogue-off` and `deck-catalogue-off` print the hashes from before it.

### Default roles

A wild entry that names no behaviour takes one from the default role rule (`src/rules/roles.ts`, thresholds in
`rules.wildRole`), read once when the roster loads. A field the entry sets always wins, so the 50 hand roles written
before the rule keep theirs. The first matching row decides:

| Row | Behaviour | Condition |
|---|---|---|
| 1 | `healer` | learns an ally-heal move at level-up (`heal_pulse`, `floral_healing`, `life_dew`, `pollen_puff`) and BST < 500 |
| 2 | `swarm` | flies, extent class Medium or smaller, BST ≤ 300 |
| 3 | `ranged` | Sp. Atk ≥ Atk + 10; no `shot`, so it fires its primary type's element |
| 4 | `tank` | HP + Def ≥ 1.15 × (max(Atk, Sp. Atk) + Speed) |
| 5 | `charger` | Speed ≥ 80 |
| 6 | `chase` | everything else |

**Flying:** a Flying type flies unless its shape is `legs` (Dodrio). Any other species flies with the ability Levitate,
the shape `bug-wings`, or as a Ghost type shaped `ball`, `arms`, `squiggle`, `tentacles` or `heads`.

The move lists read `canon.levelUp` and `canon.levelUpOther` (level-up moves with no game row, such as status moves).
On the catalogue wave the rule gives ranged 50, charger 39, chase 33, tank 32, healer 6 and swarm 2, with 39 flyers.
Against the 50 hand roles it agrees on about 29: those carry balance decisions (Pichu moved off `swarm`), which the rule
does not try to reproduce.

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
| Sprite-derived height (`SpeciesDef.height`) | 0.9 m (clamp floor) | 3.02 m |
| Weight class | Light (0.6 kg) | Massive (210 kg) |
| Size class (`rules/sizing.ts`) | Tiny, drawn 0.64 m, body r 0.30 m | Extra Large, drawn 3.11 m, body r 0.93 m, 2.78 m tall (with the size flags off: 2.91 m, r 0.97 m, 2.59 m) |

Neither has a `Faint` animation in SpriteCollab; both fall back through `src/assets/art.ts` like the rest of the roster. Onix has `Slam` where the importer wants `Strike`, so it uses seven states.

**Onix's listed extent measures the wrong axis.** 8.8 m is the length of the whole serpent, most of it tail on the ground. The PMD idle pose is a rearing column 46 px tall and 24 px wide, so the visible upright silhouette is roughly a third of the listed figure. Any reviewed upright figure of 2.05 m or more keeps Onix Extra Large. Only the ±8 % tilt would change (it sits at the top of the class now), so the listed number is kept rather than guessed. A reviewed figure belongs in `NEUTRAL_CORE_EXTENT_M` (`src/rules/sizing.ts`), and a class pin in `SPECIES_OVERRIDES` (docs/SIZING.md).

**Joltik shoots Bug, not Electric.** A `volt` projectile lays the Charge agent (`sim/cells.ts`), which floods up to 30
connected wet or water cells; the Meadow has ponds and a river, so a Joltik line of fire turned most of the region into
a repeating flood. Measured on the bot with a 4000 HP partner: with `volt` every seed tried (1–7) ended in a Charge
flood before the 5:00 boss, 500–1500 damage in the last five seconds; with `hive` the same seeds clear region 1
normally. Bug is Joltik's first type slot and its early STAB (Bug Bite, Signal Beam, Bug Buzz), so the shot stays
canonical. Its Electric identity is intact elsewhere: typing, weakness chart, the Electroweb / Discharge Tag Action,
and the type rule that makes any Electric creature discharge while it stands in water.

Onix is not in any region's `elites`, so it never spawns at elite or alpha scale. `profilesFor()` (`src/world/habitat/mode.ts`) applies the elite multiplier only to elite-capable species and keeps the validated 1.42 m headroom as a floor. With size classes, Onix's body is 0.97 m, under that floor.

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
