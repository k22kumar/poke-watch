# Builds: offers, transforms and techniques (deleted)

The survivor run's build layer (Phase 8b: level-up and item-ball card offers, move transforms, trainer techniques,
mastery, vitamins, rerolls, banishes) was deleted at hero-shooter pivot step 9 (`docs/hero-shooter-pivot.md` §8, §10
Q1–Q2). The last version of this document, the code (`src/rules/build.ts`, `src/sim/build.ts`, `src/sim/techniques.ts`)
and its tests are on the `survivor-final` tag.

What stayed, because the hero kits and the carry-and-throw foundation use it (§8a):

- The move-spec flags a transform used to set (`MoveFlags` in `src/sim/types.ts`: `spread`, `coatDepth`, `selfRoot`,
  `lasso`, `bramble`, …) and the sim paths that read them.
- The Lasso's hold time, `rules.caps.lassoHold`, and the bramble cell's numbers, `rules.reactions.brambleTime` /
  `brambleSlow`.
- The technique helpers' no-technique values, inlined: a Guard's Weight is the Pokémon's weight class
  (`guardWeight`, `src/sim/player.ts`), a Hold lasts `rules.caps.holdTime`, and move levels stay at
  `rules.hero.moveLevel`.
