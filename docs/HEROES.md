# Heroes: stats, speed, kit

What a Pokémon brings to a match in the hero shooter: its stats, its top speed, its kit, and which species are heroes. This is the implemented layer. The target design it follows is `docs/STATS_GROWTH_TARGET.md` (owner-confirmed); the decisions are `docs/hero-shooter-pivot.md` §10 (Q12, Q13, Q25–Q28, Q33–Q37, Q40).

Code: `src/rules/stats.ts` (the curve, the band, channels), `src/rules/heroes.ts` (kit, featured lines, exclusions), `rules.hero` in `src/rules/defaults.ts`. The sim reads them in `recomputeMember` (`src/sim/progression.ts`), `damagePlayer` / `damageEnemy` (`src/sim/combat.ts`) and `createRun` (`src/sim/run.ts`). Tests: `tests/stats.test.ts`, `tests/heroes.test.ts`.

## Stats: the Level-50 Canon Curve

k = 0.6, no Upkeep. `base + 20` is the canonical level-50 stat at IV 31, EV 0.

| Quantity | Formula | Base 80 |
|---|---|---|
| A stat's multiplier m | `((base + statOffset) / statRef) ^ k` | ×1.0 |
| Health | `health × ((HP + hpOffset) / hpRef) ^ k` | 250 |

`rules.hero`: `k` 0.6, `statOffset` 20, `statRef` 100, `health` 250, `hpOffset` 75, `hpRef` 155.

- **Levels add nothing.** `P.level` still exists for the survivor loop until it is deleted, but no stat reads it. "No Upkeep" means no BST-keyed cost multiplier on strong Pokémon.
- **Channels.** A move's class (`physical` / `special`) is its channel. Outgoing damage scales by the attacker's m(Atk) or m(SpA); incoming damage is divided by the target's m(Def) or m(SpD). This holds for the player and for enemies. An enemy's contact, shots and slams have no move class: they take the channel of its higher attack stat (`channelOf`, Attack on a tie).
- **Burn and deflect.** A burn from a move is its hit amount × `rules.damage.burnDps`, so it already scales with the attacker's m. A deflected shot does `rules.combat.deflectDmg` through the player damage pipeline on the shot's own channel (the shooter's), so it scales with the deflector's m.
- **Flat terms** (no attacker to scale from): a burning tile's burn `rules.reactions.tileBurn` 14, a tile-started reaction `rules.reactions.tileStrength` 30, the Tag Action's level `rules.squad.tagActionLevel` 3. These are the old squad-level-10 values.
- Vitamins (survivor items) still multiply on top until they are deleted.

## Top speed: a narrow band

`v = topSpeed − speedBand / 2 + speedBand / (1 + exp(−(Spe − speedMid) / speedScale))`, through `detmath`.

| Spe | 30 | 80 | 130 | 150 |
|---|---|---|---|---|
| m/s | 5.70 | 6.00 | 6.30 | 6.36 |

`rules.hero`: `topSpeed` 6.0 (the centre), `speedBand` 0.8 (5.6–6.4), `speedMid` 80, `speedScale` 25. Buff, swim, paralysis, carry and stance multiply on top. Targets and enemies keep their own speed formula; they move onto the band with the co-op wave. Acceleration and Burst refill come with the Burst system.

The old formula gave 6.6–9.7 m/s (Spe 80: 8.04). The band exposed two footprint bugs, both fixed (docs/SIZING.md "Drops and landings"), and two findings that are still open (`docs/hero-shooter-pivot.md` §11): the habtide seed 7 warning-escape driver stops short on a tidal tile, and the viewsample camera course meets rock for 7 consecutive frames.

## Kit

`heroKit(sp, { fillE })`:

- **Primary** (left click): `openingMove(sp)`, the curated starter, else the line's, else the first damaging move.
- **Q** (Ability 1): the first other move of the canonical learnset (`canon.levelUp` in level order, status moves allowed).
- **E** (Ability 2): empty. The `range` mode sets `rules.hero.fillE`, which fills it with the next canonical move for testing.
- **Ultimate** (R): unbound until it exists.
- `HERO_KITS` overrides any field per species (the featured heroes' tuning). Every slot sits at `rules.hero.moveLevel` 1, the move as authored.
- `KIT_TUNING` logs the kits the rule gets wrong, for the kit-tuning pass: Bagon (an Ember primary on a Dragon), Graveler and Golem (a power-0 Bide primary), and the power-0 E slots of Magneton (Sonic Boom), Magnezone (Mirror Coat) and Diglett (Magnitude). Each is fixed later by a `HERO_KITS` entry; `tests/heroes.test.ts` refuses a logged species that already has one, and fails on any power-0 damaging move in a `PROTOTYPE` kit (E filled, as in range mode) that is neither overridden nor logged.

## Which species are heroes

- Hero pick shows the prototype list (`PROTOTYPE`, 58 forms in 22 families, approved at pivot step 8), with `FEATURED` first: the Caterpie, Charmander, Tauros and Mewtwo lines. The baseline and tests use them. The developer roster still picks any `ready` species.
- The list's rule: a whole canonical line, every form `ready`, recruitable and inside the frozen profile, spread across elements and traversal, and no branching line (how a Breakthrough would choose a branch is open, pivot §11). Every line is linked by `evolvesTo`: the content build links every species to its single next form (`scripts/build-content.mjs`), with no `evolveLevel` outside the paced partner lines. The Geodude and Bagon lines' later forms came in as the roster's `heroes` wave. `tests/heroes.test.ts` checks the lines are whole.
- `NEEDS_ABILITY_RULE`: Shedinja, Slaking, Regigigas and Wishiwashi are held out until their Ability has a rule. Shedinja (a game species) carries `recruitable: false` with that reason; `tests/heroes.test.ts` refuses one of the others imported without it.
- Every hero must fit the frozen habitat trainer profile (`VALIDATED_PROFILES`: footprint ≤ 0.88 m, eye ≤ 1.42 m); `tests/habitat.test.ts` checks every `PROTOTYPE` form. 54 `ready` species exceed it today (Onix, Lugia, Wailord…); making one a hero needs a planned habitat version bump (pivot §11).
