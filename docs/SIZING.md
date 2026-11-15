# Size classes

Every Pokémon belongs to one of five size classes. A class decides how big the Pokémon is drawn and how big its body is in the sim, so a Pokémon that looks bigger is also hit, pushed and routed as bigger. Tunable numbers are in `rules.size` in `src/rules/defaults.ts`. The logic is in `src/rules/sizing.ts`.

## The classes

| Class | Canonical extent | Drawn core (`visual`) | Sim radius | Sim height | Examples |
|---|---|---|---|---|---|
| Tiny | < 0.35 m | 0.70 m | 0.32 m | 0.6 m | Rattata, Joltik, Pichu, Diglett, Litwick |
| Small | 0.35 – 0.65 m | 0.98 m | 0.42 m | 0.9 m | Charmander, Sandshrew, Pikachu, Murkrow |
| Medium | 0.65 – 1.15 m | 1.37 m | 0.52 m | 1.2 m | Bulbasaur, Slugma, Sentret, Sneasel |
| Large | 1.15 – 2.05 m | 1.92 m | 0.68 m | 1.7 m | Charizard, Heracross, Gengar, Furret |
| Extra Large | ≥ 2.05 m | 2.69 m | 0.90 m | 2.4 m | Onix, Snorlax, Lapras, Feraligatr |

- **Steps between classes.** Each class is about 1.4× the one below.
- **Tilt.** Within a class a Pokémon is tilted by at most ±8 % (`rules.size.tilt`). The tilt depends on where its extent sits in the class band, on a log scale. The open ends use `rules.size.extentRange` (0.1 m and 6 m). Two Pokémon in the same class therefore look nearly the same size, and an evolution that stays in one class still grows a little.
- **No overlap.** The largest Small is drawn at 1.06 m and the smallest Medium at 1.26 m. `tests/sizing.test.ts` asserts this.

### Why fixed class targets

The previous version (and the reference `pokemon-size-classifier.ts`) drew from a continuous curve, `clamp(1.25 · S^0.45, 0.78, 2.55)`. With that curve the class was only a label. A 0.64 m Small and a 0.65 m Medium drew identically, and neighbouring classes were only about 25 % apart. Before and after, at one fixed camera (`tools/sizescenes.json`, scene `size-class-row`):

| | Rattata | Sandshrew | Slugma | Heracross | Onix |
|---|---|---|---|---|---|
| continuous curve | 0.78 | 0.99 | 1.06 | 1.50 | 2.55 |
| class targets | 0.74 | 1.04 | 1.29 | 1.91 | 2.91 |

What was kept from the classifier:
- The five bands and their cuts.
- Neutral-body versus listed-extent inputs.
- A narrow version of its projected profile (Wide, below).
- The idea that encounter-scale Pokémon (bosses) keep authored scale.

What was dropped:
- The continuous curve and its clamp.
- The 3-axis shape profile, because no asset has 3-axis bounds.
- `scaleSpriteFrame`, because the renderer already scales against the idle feet anchor.

## Which class a Pokémon gets

`bodyOf(species)` in `src/rules/sizing.ts` checks these in order:

1. **`sizeClass`** in `SPECIES_OVERRIDES` (`src/rules/profiles.ts`) pins the class. The Pokémon sits at the class centre, with no tilt.
2. **`NEUTRAL_CORE_EXTENT_M`** (`src/rules/sizing.ts`) is a reviewed figure for a Pokémon whose listed extent measures the wrong axis. Onix's 8.8 m, for example, is the serpent's length.
3. **`canon.heightM`** is the published figure, imported from PokéAPI.
4. **`SpeciesDef.height`** is the old sprite-derived number. It is used only by a species with no canonical record.

Bosses (`SpeciesDef.scale`, authored 2–3×) keep their encounter scale. The class rules don't change how they are drawn, and their sim body is the drawn one.

## Who reads what

| Concern | Reads | Where |
|---|---|---|
| Drawn size | `visualM ÷` the asset's neutral core | `src/render/renderer.ts` (`speciesSizing`) |
| Enemy collision and hurt radius | class radius × role size (elite ×2, alpha ×3) | `src/sim/enemies.ts` (`enemyRadius`) |
| Enemy vertical hit window, hit-number height | class height × role size (`E.tall`) | `src/sim/effects.ts`, `combat.ts`, `hazards.ts`, `cells.ts`, `coats.ts` |
| Partner collision and hurt radius | class radius clamped to `rules.size.playerRadius` (0.48–0.72 m) | `partnerRadius`, read by `effects.ts`, `enemies.ts`, `bodies.ts`, `objectives.ts`, `cells.ts`, `hazards.ts` |
| Partner vertical hurt window | class height | `partnerHeight`, `effects.ts` |
| Wide-body routing | radius > `rules.size.heavyRadius` (0.55 m) | `src/sim/world.ts` (heavy field), `src/sim/director.ts` (spawn room) |
| Habitat navigation profiles | partner and enemy radii from the spawn pools | `src/world/habitat/mode.ts` (`profilesFor`) |
| Weight class (guard, push, knockback) | canonical mass, not size | `weightClass` in `src/rules/species.ts` |

Shots still leave a partner from a fixed +0.8 m, so muzzle and eye heights for the habitat validator stay on the sprite-derived heights.

- **The neutral asset reference.** The renderer divides by the idle frame 0 facing the camera: `CreatureArt.heightPx / 16`. This is never the frame being drawn, so proportions and feet anchors survive animation.
- **Wide normalisation.** An idle frame at least `rules.size.wideRatio` (1.5) times wider than tall is normalised on `width / 1.5` instead of its height. This applies to long and low bodies such as Lapras, Cetoddle and Diglett's mound, so they are not drawn oversized.

### Partners

Partners are size-aware too. Small starter forms get a 0.48 m hurt radius (it used to be a shared 0.55 m), and evolved Large and Extra Large forms grow to 0.72 m. Evolving trades a bigger target for more push. The clamp keeps the change modest.

Measured over 36 bot runs (6 partners × 6 seeds, 7 minutes, `rules.size.geometry` on versus off):

| Partner radius floor | Bot survival |
|---|---|
| 0.42 m | +17 % |
| 0.48 m (default) | +10 % |
| 0.55 m | ±0 % |

Movement and wall collision use a point probe for every body, so the partner's radius changes what hits it, not where it can walk.

### Navigation

A ground body wider than `rules.size.heavyRadius` follows a second flow field. That field only crosses tiles inside a level 2 × 2 block of open ground (`World.fitsHeavy`, `src/sim/world.ts`; on decked maps it covers both layers), so the body goes round a one-tile gap. Where the wide field does not reach the body, it falls back to the ordinary field and squeezes through rather than stopping. `tests/navsize.test.ts` covers both cases.

A wide body is also never spawned in a one-tile pocket (`allowedAt` in `src/sim/director.ts`).

Measured reach of the wide field from the player spawn (`fitsHeavy` tiles reachable on wide routes, seeds 1–4):

| Map | Wide reach |
|---|---|
| Classic generated regions | 73–98 % of walkable ground |
| Pokémon locations | 45–100 % |

The location generator reports `wideBoss` and `wideAnchors` (`src/world/locgen/validate.ts`): whether the boss hall and how many enemy entrances are joined to the hub by a two-tile route. Over 30 seeds:

| Location | Seeds with a wide boss route |
|---|---|
| Viridian Forest | 73 % |
| Mt. Moon | 50 % |
| Chargestone Cave | 37 % |

On the remaining seeds the route is a deliberate one-tile chokepoint that wide bodies squeeze through. Widening those routes inside the generator would need a `LOC_VERSION` bump; it is not done yet.

## Turning it off

`rules.size.geometry: false` brings back the pre-size-class sim:
- radius `clamp(sprite height × 0.4, 0.35, 3.2)`;
- the role size as the hit height;
- one shared 0.55 m partner radius and a fixed 1.2 m hurt window;
- no wide-body routing.

`npx tsx scripts/checksum.ts size-off` prints those hashes. With the classic region tables it reproduces the earlier `on` set. The only exception is the `World.shore` fix that landed with this work: a bank behind a wall is no longer preferred. Every older layer (`off`, `build-off`, `world-off`, `hazards-off`) turns size geometry off too.

## Checking it

- `npx tsx --test tests/sizing.test.ts tests/navsize.test.ts`
- `pokewatch.renderer.sizes()` in the browser prints class, target, multiplier and the Wide flag for every loaded sheet.
- `node tools/cap.mjs <html> tools/sizescenes.json <outdir> size-` captures a one-per-class row (`size-class-row`), a same-class row (`size-same-class-small`) and each region's newer Pokémon (`size-wave-*`). Build to a private folder first (CLAUDE.md).
