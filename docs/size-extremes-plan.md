# Size extremes plan

Progress record for `docs/size-extremes-handoff.md` (Prompts S1–S3). One section per prompt.
Written for the Claude Code sessions that run S2 and S3, and for the owner deciding the flags.

- **Stage completed:** S1, revised after the owner's decisions on 2026-11-18 (§S1.9). The measurement axis and the XL visual law exist behind two `rules.size` flags. **Both flags are off.**
- **S2:** skipped for now (owner).
- **S3:** done (§S3). The owner decided on the adjustments on 2026-11-18 (§S3.10): A approved behind a new flag, B and C rejected, D accepted (F2), E goes to the camera session (F3). **Nothing is implemented yet, and both flags are still off.**
- **Next, in order:** the camera session commits → rebase this branch onto `main` → F1 → A (`rules.size.xlTall`) → S2 (§S3.10).
- **Branch:** `size-extremes-s1`, in its own worktree (`../poke-watch-s1`), based on `b89fb55`. The main checkout has another session's uncommitted camera work, and switching its branch would have moved that session's work. S1 and S3 are committed on the branch (§S3.10). It is not pushed and not merged into `main`.
- **Owner decisions:** recorded in §S1.9, §S3.1 and §S3.10. Follow-ups F1–F3 are in §S1.10.
- **Separate task:** the pre-existing `tests/pointerlock.test.ts` failures, in `docs/tasks/pointerlock-red-tests.md`.
- **Worktree hygiene:** `/node_modules`, `/.import-cache` and `/.capture/` are in `info/exclude`. In a linked worktree that file is the shared `../poke-watch/.git/info/exclude` (`git rev-parse --git-path info/exclude`). The main checkout already ignores the first two through `.gitignore`, so nothing changes there.

---

## S1. Measurement axis and XL visual law (flagged, default off)

### S1.1 What changed

| Path | Change |
|---|---|
| `content/catalogue.json` | `pokemon_shapes` added to the pinned CSV list (same revision `8a92bfa7`). |
| `scripts/catalogue-pack.mjs` | Each record gets `shape` (`pokemon_species.shape_id` → `pokemon_shapes.identifier`). The pack also returns `shapes` (every species in the snapshot, by dex), which is not written to `catalogue.ts`. |
| `scripts/build-content.mjs` | The catalogue pack now builds before the role lane writes `pokedex.ts`. Each runtime species' `canon` gets `shape` from that pack, and the build fails on a missing shape. |
| `src/content/pokedex.ts`, `catalogue.ts`, `art.json`, `content/report.json` | Regenerated with `node scripts/build-content.mjs --clones ../src-data` (11 s). Checked: `pokedex.ts` and `catalogue.ts` gain only `shape`. `art.json` is equal to the old file apart from the `generated` and `fetched` timestamps. `report.json` gains the shapes CSV in its provenance and a new timestamp. |
| `src/rules/shapes.ts` (new) | `MeasureAxis`, `SHAPE_AXIS` (`squiggle`, `fish` → `length`), `axisOfShape` (any other or unknown shape → `height`). After §S1.9: `SPECIES_AXIS` (reviewed axis-only overrides; `eternatus: 'length'`) and `axisOf(id, shape)`. |
| `src/rules/species.ts` | `canon.shape`, `canon.axis`. `axis` is filled from `SHAPE_AXIS` when the roster loads, so it is rules data, not generated content. |
| `src/rules/catalogue.ts` | `CatalogueRecord.shape`. |
| `src/rules/defaults.ts` | `rules.size.axis: false`, `lengthRise: 0.5` (was 0.35, §S1.9), `xlContinuous: false`, `xlVisualCap: 4.0`, `xlFloor: 2.69 × 0.92`, `xlExponent: 0.3` (was 0.21, now a fixed constant, §S1.9). |
| `src/rules/sizing.ts` | `speciesExtent(sp, size)` adds the axis rule and returns `axis`. New source `length-rise`. `NEUTRAL_CORE_EXTENT_M` accepts `{ m, axis, basis }` (the only way to `span`). `xlVisual()`. `bodyOf` uses it for XL when `xlContinuous` is on. |
| `scripts/checksum.ts` | New sets `axis`, `gen-axis`, `xl`. |
| `scripts/sizetable.ts` (new) | Prints the S1.5 table (`--changes` prints only the class changes). |
| `tests/sizing.test.ts`, `tests/catalogue.test.ts` | Axis and XL tests. The extent test now expects the `axis` field. A shape test covers every record and runtime species. |
| `docs/SIZING.md`, `CLAUDE.md` | New sections "Measurement axis" and "Giants". New checksum set names. The SIZING.md hunks were checked with `git merge-file` against the other session's uncommitted SIZING.md: 0 conflicts. `README.md` §Build is **not** updated because the other session has it modified. |

### S1.2 The rules as built

**Axis.** `speciesExtent(sp, size)` checks these in order:
1. An approved `NEUTRAL_CORE_EXTENT_M` entry. It applies with the flag on or off, as before. A bare number keeps the species' axis, and `{ m, axis: 'span' }` is the only way to get `span`.
2. With `size.axis` on and a `length` axis (`SPECIES_AXIS`, else the shape): `lengthRise × listed` (source `length-rise`).
3. The listed figure.
4. The sprite height.

No species gets `span` without an approved entry (tested).

**XL law.** `xlVisual(S) = min(xlVisualCap, xlFloor × max(1, S / 2.05) ^ xlExponent)`, where 2.05 is Large's cut, read from `rules.size.classes`.
- XL `radius`, `height`, `body` and `factor` keep today's class values and tilt.
- Tiny to Large are unchanged.
- An authored boss is untouched.
- An extent below the cut (only possible through a pin) draws the floor.
- The floor (2.475 m) is above Large's largest draw (1.92 × 1.08 = 2.074 m), so classes still never overlap (tested).

### S1.3 Replay hashes [revised after §S1.9]

All 64 existing hashes (16 sets × 4 configs) are **identical** before and after S1. I checked this both with the first S1 rules and again with `lengthRise` 0.5, exponent 0.30 and the Eternatus override.

| Set | cyndaquil s2 classic | totodile s7 classic | bulbasaur s3 survival | charmander s11 boss-rush |
|---|---|---|---|---|
| `on` (= off layer for both flags) | end `632d7d25` | end `17978323` | end `93ae9839` | end `53516479` |
| `axis` (lengthRise 0.5) | same | **moves at the 7th mark** (`d634f7af` → `f9b91e67`), end `74eccc9d`, kills 1872 → 1873 | same | **moves at the 4th mark** (`47a9cb47` → `a5fb0e08`), end `a94be2d9`, kills 491 → 480 |
| `gen` | end `bc465079` | end `72710e43` | end `bd080f0c` | end `7708b606` |
| `gen-axis` (lengthRise 0.5) | same | same | same | **moves at the 4th mark** (`1ca1a931` → `eb41c399`), end `db985697`, kills 670 |
| `xl` (exponent 0.30) | same | same | same | same |

Superseded values at `lengthRise` 0.35:
- `axis` totodile: end `c43fe827`.
- `axis` charmander: 4th mark `570f7953`, end `df5625a4`, kills 462.
- `gen-axis` charmander: 4th mark `6ef60422`, end `6d3c51b`.

`xl` prints the `on` hashes exactly because no sim system reads `visualM`. Its readers are the renderer, `src/render/chaseinput.ts` (chase boom) and `scripts/lib/camrig.ts`. Eternatus is not a runtime species, so its override moves no hash.

The `axis` changes come from the length-axis species in the spawn pools:
- `badlands`: Slugma and Onix (classic table), Ekans and Silicobra (2026-11 wave), and the boss Magcargo, whose body is authored and unchanged.
- `frost`: Snom, Lapras.
- `dusk`: Dreepy.

The `aim*` sets were not given an axis variant. The bot plus the aim ray reaches the same bodies as `axis`.

### S1.4 Runtime species whose class or extent changes with `axis` on [revised: lengthRise 0.5]

| Species | shape | listed | extent | class | body change (radius, height, footprint) |
|---|---|---:|---:|---|---|
| Lapras | fish | 2.50 | 1.25 | XL → **Large** | 0.85 → 0.64, 2.28 → 1.60, 0.88 → 0.66; stays on the wide field |
| Silicobra | squiggle | 2.20 | 1.10 | XL → **Medium** | 0.84 → 0.56, 2.23 → 1.28, 0.88 → 0.46; wide → narrow |
| Ekans | squiggle | 2.00 | 1.00 | Large → **Medium** | 0.73 → 0.54, 1.82 → 1.25, 0.66 → 0.46; wide → narrow |
| Slugma | squiggle | 0.70 | 0.35 | Medium → **Small** | 0.49 → 0.39, 1.13 → 0.83, 0.46 → 0.40 |
| Magcargo | squiggle | 0.80 | 0.40 | Medium → **Small** | none: authored boss body (radius 1.35, footprint 0.95). Only the class label changes. |
| Dreepy | squiggle | 0.50 | 0.25 | Small → **Tiny** | 0.43 → 0.33, 0.91 → 0.62, 0.40 → 0.30 |
| Onix | squiggle | 8.80 | 4.40 | XL (same) | tilt only: 0.97 → 0.93, 2.59 → 2.48 |
| Snom | squiggle | 0.30 | 0.15 | Tiny (same) | tilt only: 0.34 → 0.31, 0.64 → 0.58 |

Catalogue-only species that change class:
- XL → Large: Dragonair, Sandaconda, Dudunsparce, Arbok, Orthworm.
- XL → Medium: Eelektross.
- Large → Medium: Wailmer, Dratini, Dunsparce.
- Large → Small: Eelektrik.

These stay XL: Wailord (14.5 → 7.25), Steelix (9.2 → 4.6), Rayquaza (7.0 → 3.5) and Eternatus (20 → 10, through its override).

### S1.5 Eternatus [decided, §S1.9]

The first S1 report proposed `NEUTRAL_CORE_EXTENT_M.eternatus = { m: 7.0, axis: 'length' }`. The owner approved an **axis-only override instead, with no metres**: `SPECIES_AXIS.eternatus = 'length'` (`src/rules/shapes.ts`). Its extent comes from the shared rule, `lengthRise × 20 m` = 10.0 m with `axis` on. It is the 20 m listed figure with `axis` off. It stays XL either way, and draws 3.98 m with both flags on.

Evidence kept from the first report: its SpriteCollab idle side silhouette has a height-to-width ratio of 0.72, close to the runtime serpents (Onix 0.82, Silicobra 0.80, Snom 0.78, Magcargo 0.86). PMD draws it as a body raised along its length. The ratio supports reading 20 m as a length, but cannot give a height.

### S1.6 Findings for the owner [revised after §S1.9]

1. **Giants at the decided rules** (`lengthRise` 0.5, exponent 0.30, cap 4.0 m, reached at 10.16 m of extent):

   | | listed | extent with axis | today | axis + xl |
   |---|---:|---:|---:|---:|
   | Snorlax (height) | 2.1 | 2.10 | 2.48 | 2.49 |
   | Feraligatr, Hariyama (XL partners) | 2.3 | 2.30 | 2.52 | 2.56 |
   | Groudon (height) | 3.5 | 3.50 | 2.69 | 2.91 |
   | Onix (length) | 8.8 | 4.40 | 2.91 | 3.11 |
   | Steelix (length) | 9.2 | 4.60 | 2.91 | 3.15 |
   | Wailord (length) | 14.5 | 7.25 | 2.91 | 3.62 |
   | Celesteela (height) | 9.2 | 9.20 | 2.91 | 3.88 |
   | Eternatus (length, override) | 20 | 10.00 | 2.91 | 3.98 |

   Wailord is 1.45× Snorlax and Onix is 1.25×. Every length giant now draws bigger than today. The first report's problem (Onix drawing smaller than today) is gone.
2. **Lapras stays on the wide field.** It now drops only to Large (footprint 0.88 → 0.66). Silicobra (XL → Medium) and Ekans (Large → Medium) still leave it (footprint → 0.46). That changes routing, crowd contact and which one-tile passages they take. The replay moves come from these.
3. **Readers that use the default rules, not `ctx.rules`.** These call `bodyOf(sp)` with `defaultRules.size`:
   - `speciesSizing` in `src/render/renderer.ts`;
   - the class label and search in `src/ui/ui.ts`;
   - the spawn-filter `sizeClasses` in `src/rules/spawning.ts` (`passes`).

   A flag turned on through `ruleOverrides` or a mod doesn't reach them. Follow-up F1 (§S1.10) fixes this. For S3, the capture build switches the defaults instead (§S3.2). `chaseinput.ts` already passes `ctx.rules.size`.
4. **The XL hurt window doesn't grow.** This is by design (handoff decision 4). With a 3.6–4.0 m draw, the sim height stays ≤ 2.59 m. S3 measures how much of the sprite sits outside the window.
5. **The older checksum sets don't pin the new flags.** When a flag becomes a default, add `size: { axis: false, xlContinuous: false }` to every older set.
6. **Before the flip, the gameplay side of the axis rule needs `/grilling`:** Silicobra and Ekans as Mediums, and Magcargo labelled Small while its boss body is 1.35 m.

### S1.7 Gates (run in the worktree, first S1 rules; rerun scope after §S1.9 is listed there)

| Gate | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm test` (inside `npm run check`) | 585 pass, **4 fail**: `tests/pointerlock.test.ts` (lines 104, 122, 133, 139). The same 4 fail on a clean `b89fb55` checkout (6 pass, 4 fail), so they are already red at HEAD and not from S1. `check` stops there, so the build was run on its own. |
| `npm run build` | pass, `dist/index.html` 17,253 KB (the worktree's own `dist/`) |
| sizing, navsize, footprint, headroom, walltops, playability, catalogue tests | 67 / 67 pass |
| `npx tsx scripts/navwalk.ts all 5` | 0 failures (xl arrive 291/291, xl refuse 5/5, trainer-xl 83/83) |
| `npx tsx scripts/stuckwatch.ts all 3` | TRAPPED 0. 67 bot episodes (1 pinned), 2 enemy episodes in 115,818 enemy-seconds. Identical on a clean `b89fb55`. The 34 in SIZING.md is from 2026-11-16, before later commits. |
| `npx tsx scripts/checksum.ts` | all 64 existing hashes identical (S1.3) |
| `npx tsx scripts/perf-sim.ts 500 --repeat 3 --gate` | PASS: min-of-3 p95 0.501 ms, p99 0.841 ms |

Not run: the habitat gates (`habstate`, `habplay`, `hazplay`, `habaudit`). S1 changes no habitat, hazard or objective code, and the hashes prove the sim is unchanged with the flags off.

### S1.8 Size table (S1 step 5) [regenerated after §S1.9]

Generated by `npx tsx scripts/sizetable.ts` at `lengthRise` 0.5 and exponent 0.30. Rows are every runtime species (**bold**) and every catalogue species' default record with a listed height, sorted by listed extent. Gigantamax lower bounds and the 59 varieties are left out.

- **Extent used**, **radius**, **height** and **footprint** are the `axis`-on values, shown as `today → axis` where they differ.
- **XL draw today** is the fixed class target ± tilt. **draw, axis + xl** is the drawn core with both flags on. Both columns are filled for species that are XL today or with `axis` on.
- The owner dropped the fitted-exponent column: the exponent is a fixed constant.
- **nav** is the wide-field flag (`navWide(footprint)`). The sprite Wide flag needs decoded art and is S3's.
- Footprints are class values before role scaling.

| Pokémon | shape | axis | listed m | extent used | class today | class with axis | XL draw today | draw, axis + xl @ 0.3 | radius | height | footprint | nav |
|---|---|---|---:|---:|---|---|---:|---:|---:|---:|---:|---|
| Eternatus | wings | length | 20.00 | 10.00 | XL | XL | 2.91 | 3.98 | 0.97 | 2.59 | 0.88 | wide |
| Wailord | fish | length | 14.50 | 7.25 | XL | XL | 2.91 | 3.62 | 0.97 | 2.59 | 0.88 | wide |
| Celesteela | humanoid | height | 9.20 | 9.20 | XL | XL | 2.91 | 3.88 | 0.97 | 2.59 | 0.88 | wide |
| Steelix | squiggle | length | 9.20 | 4.60 | XL | XL | 2.91 | 3.15 | 0.97 → 0.94 | 2.59 → 2.50 | 0.88 | wide |
| **Onix** | squiggle | length | 8.80 | 4.40 | XL | XL | 2.91 | 3.11 | 0.97 → 0.93 | 2.59 → 2.48 | 0.88 | wide |
| Rayquaza | squiggle | length | 7.00 | 3.50 | XL | XL | 2.91 | 2.91 | 0.97 → 0.90 | 2.59 → 2.40 | 0.88 | wide |
| Yveltal | wings | height | 5.80 | 5.80 | XL | XL | 2.89 | 3.38 | 0.97 | 2.58 | 0.88 | wide |
| Guzzlord | upright | height | 5.50 | 5.50 | XL | XL | 2.87 | 3.33 | 0.96 | 2.56 | 0.88 | wide |
| Stakataka | quadruped | height | 5.50 | 5.50 | XL | XL | 2.87 | 3.33 | 0.96 | 2.56 | 0.88 | wide |
| Lugia | wings | height | 5.20 | 5.20 | XL | XL | 2.85 | 3.27 | 0.95 | 2.54 | 0.88 | wide |
| Raging Bolt | quadruped | height | 5.20 | 5.20 | XL | XL | 2.85 | 3.27 | 0.95 | 2.54 | 0.88 | wide |
| Cetitan | upright | height | 4.50 | 4.50 | XL | XL | 2.79 | 3.13 | 0.93 | 2.49 | 0.88 | wide |
| Giratina | tentacles | height | 4.50 | 4.50 | XL | XL | 2.79 | 3.13 | 0.93 | 2.49 | 0.88 | wide |
| Palkia | upright | height | 4.20 | 4.20 | XL | XL | 2.76 | 3.07 | 0.92 | 2.46 | 0.88 | wide |
| Dragonair | squiggle | length | 4.00 | 2.00 | XL | **Large** | 2.74 | 2.06 | 0.92 → 0.73 | 2.45 → 1.82 | 0.88 → 0.66 | wide |
| Lunala | wings | height | 4.00 | 4.00 | XL | XL | 2.74 | 3.02 | 0.92 | 2.45 | 0.88 | wide |
| Dhelmise | blob | height | 3.90 | 3.90 | XL | XL | 2.73 | 3.00 | 0.91 | 2.44 | 0.88 | wide |
| Ho-Oh | wings | height | 3.80 | 3.80 | XL | XL | 2.72 | 2.98 | 0.91 | 2.43 | 0.88 | wide |
| Sandaconda | squiggle | length | 3.80 | 1.90 | XL | **Large** | 2.72 | 2.03 | 0.91 → 0.72 | 2.43 → 1.80 | 0.88 → 0.66 | wide |
| Dudunsparce | squiggle | length | 3.60 | 1.80 | XL | **Large** | 2.70 | 2.00 | 0.90 → 0.71 | 2.41 → 1.77 | 0.88 → 0.66 | wide |
| Arbok | squiggle | length | 3.50 | 1.75 | XL | **Large** | 2.69 | 1.99 | 0.90 → 0.70 | 2.40 → 1.76 | 0.88 → 0.66 | wide |
| Gouging Fire | quadruped | height | 3.50 | 3.50 | XL | XL | 2.69 | 2.91 | 0.90 | 2.40 | 0.88 | wide |
| Groudon | upright | height | 3.50 | 3.50 | XL | XL | 2.69 | 2.91 | 0.90 | 2.40 | 0.88 | wide |
| Solgaleo | quadruped | height | 3.40 | 3.40 | XL | XL | 2.68 | 2.88 | 0.90 | 2.39 | 0.88 | wide |
| Slither Wing | quadruped | height | 3.20 | 3.20 | XL | XL | 2.65 | 2.83 | 0.89 | 2.37 | 0.88 | wide |
| Centiskorch | tentacles | height | 3.00 | 3.00 | XL | XL | 2.63 | 2.77 | 0.88 | 2.34 | 0.88 | wide |
| Dragapult | upright | height | 3.00 | 3.00 | XL | XL | 2.63 | 2.77 | 0.88 | 2.34 | 0.88 | wide |
| Falinks | heads | height | 3.00 | 3.00 | XL | XL | 2.63 | 2.77 | 0.88 | 2.34 | 0.88 | wide |
| Xerneas | quadruped | height | 3.00 | 3.00 | XL | XL | 2.63 | 2.77 | 0.88 | 2.34 | 0.88 | wide |
| Zamazenta | quadruped | height | 2.90 | 2.90 | XL | XL | 2.61 | 2.75 | 0.87 | 2.33 | 0.88 | wide |
| Coalossal | humanoid | height | 2.80 | 2.80 | XL | XL | 2.60 | 2.72 | 0.87 | 2.32 | 0.88 | wide |
| Zacian | quadruped | height | 2.80 | 2.80 | XL | XL | 2.60 | 2.72 | 0.87 | 2.32 | 0.88 | wide |
| Koraidon | upright | height | 2.50 | 2.50 | XL | XL | 2.55 | 2.63 | 0.85 | 2.28 | 0.88 | wide |
| **Lapras** | fish | length | 2.50 | 1.25 | XL | **Large** | 2.55 | 1.81 | 0.85 → 0.64 | 2.28 → 1.60 | 0.88 → 0.66 | wide |
| Melmetal | humanoid | height | 2.50 | 2.50 | XL | XL | 2.55 | 2.63 | 0.85 | 2.28 | 0.88 | wide |
| Orthworm | squiggle | length | 2.50 | 1.25 | XL | **Large** | 2.55 | 1.81 | 0.85 → 0.64 | 2.28 → 1.60 | 0.88 → 0.66 | wide |
| Buzzwole | tentacles | height | 2.40 | 2.40 | XL | XL | 2.54 | 2.59 | 0.85 | 2.26 | 0.88 | wide |
| **Feraligatr** | upright | height | 2.30 | 2.30 | XL | XL | 2.52 | 2.56 | 0.84 | 2.25 | 0.88 | wide |
| **Hariyama** | humanoid | height | 2.30 | 2.30 | XL | XL | 2.52 | 2.56 | 0.84 | 2.25 | 0.88 | wide |
| Corviknight | wings | height | 2.20 | 2.20 | XL | XL | 2.50 | 2.53 | 0.84 | 2.23 | 0.88 | wide |
| Dragonite | upright | height | 2.20 | 2.20 | XL | XL | 2.50 | 2.53 | 0.84 | 2.23 | 0.88 | wide |
| **Silicobra** | squiggle | length | 2.20 | 1.10 | XL | **Medium** | 2.50 | 1.46 | 0.84 → 0.56 | 2.23 → 1.28 | 0.88 → 0.46 | wide → narrow |
| Torterra | quadruped | height | 2.20 | 2.20 | XL | XL | 2.50 | 2.53 | 0.84 | 2.23 | 0.88 | wide |
| Eelektross | fish | length | 2.10 | 1.05 | XL | **Medium** | 2.48 | 1.44 | 0.83 → 0.55 | 2.22 → 1.27 | 0.88 → 0.46 | wide → narrow |
| Hatterene | blob | height | 2.10 | 2.10 | XL | XL | 2.48 | 2.49 | 0.83 | 2.22 | 0.88 | wide |
| Mantine | wings | height | 2.10 | 2.10 | XL | XL | 2.48 | 2.49 | 0.83 | 2.22 | 0.88 | wide |
| Rillaboom | humanoid | height | 2.10 | 2.10 | XL | XL | 2.48 | 2.49 | 0.83 | 2.22 | 0.88 | wide |
| **Snorlax** | humanoid | height | 2.10 | 2.10 | XL | XL | 2.48 | 2.49 | 0.83 | 2.22 | 0.88 | wide |
| Archaludon | upright | height | 2.00 | 2.00 | Large | Large | — | — | 0.73 | 1.82 | 0.66 | wide |
| Avalugg | quadruped | height | 2.00 | 2.00 | Large | Large | — | — | 0.73 | 1.82 | 0.66 | wide |
| **Ekans** | squiggle | length | 2.00 | 1.00 | Large | **Medium** | — | — | 0.73 → 0.54 | 1.82 → 1.25 | 0.66 → 0.46 | wide → narrow |
| Exeggutor | legs | height | 2.00 | 2.00 | Large | Large | — | — | 0.73 | 1.82 | 0.66 | wide |
| Tropius | quadruped | height | 2.00 | 2.00 | Large | Large | — | — | 0.73 | 1.82 | 0.66 | wide |
| **Venusaur** | quadruped | height | 2.00 | 2.00 | Large | Large | — | — | 0.73 | 1.82 | 0.66 | wide |
| Wailmer | fish | length | 2.00 | 1.00 | Large | **Medium** | — | — | 0.73 → 0.54 | 1.82 → 1.25 | 0.66 → 0.46 | wide → narrow |
| Inteleon | upright | height | 1.90 | 1.90 | Large | Large | — | — | 0.72 | 1.80 | 0.66 | wide |
| Toedscruel | tentacles | height | 1.90 | 1.90 | Large | Large | — | — | 0.72 | 1.80 | 0.66 | wide |
| Urshifu | humanoid | height | 1.90 | 1.90 | Large | Large | — | — | 0.72 | 1.80 | 0.66 | wide |
| Dodrio | legs | height | 1.80 | 1.80 | Large | Large | — | — | 0.71 | 1.77 | 0.66 | wide |
| Dratini | squiggle | length | 1.80 | 0.90 | Large | **Medium** | — | — | 0.71 → 0.53 | 1.77 → 1.21 | 0.66 → 0.46 | wide → narrow |
| Duraludon | upright | height | 1.80 | 1.80 | Large | Large | — | — | 0.71 | 1.77 | 0.66 | wide |
| **Furret** | quadruped | height | 1.80 | 1.80 | Large | Large | — | — | 0.71 | 1.77 | 0.66 | wide |
| Hydrapple | heads | height | 1.80 | 1.80 | Large | Large | — | — | 0.71 | 1.77 | 0.66 | wide |
| Iron Hands | humanoid | height | 1.80 | 1.80 | Large | Large | — | — | 0.71 | 1.77 | 0.66 | wide |
| **Meganium** | quadruped | height | 1.80 | 1.80 | Large | Large | — | — | 0.71 | 1.77 | 0.66 | wide |
| Aegislash | blob | height | 1.70 | 1.70 | Large | Large | — | — | 0.70 | 1.75 | 0.66 | wide |
| **Articuno** | wings | height | 1.70 | 1.70 | Large | Large | — | — | 1.80 | 4.50 | 0.95 | wide |
| **Charizard** | upright | height | 1.70 | 1.70 | Large | Large | — | — | 0.70 | 1.75 | 0.66 | wide |
| **Typhlosion** | quadruped | height | 1.70 | 1.70 | Large | Large | — | — | 0.70 | 1.75 | 0.66 | wide |
| **Blastoise** | upright | height | 1.60 | 1.60 | Large | Large | — | — | 0.69 | 1.72 | 0.66 | wide |
| Grapploct | tentacles | height | 1.60 | 1.60 | Large | Large | — | — | 0.69 | 1.72 | 0.66 | wide |
| **Haunter** | arms | height | 1.60 | 1.60 | Large | Large | — | — | 0.69 | 1.72 | 0.66 | wide |
| Tentacruel | tentacles | height | 1.60 | 1.60 | Large | Large | — | — | 0.69 | 1.72 | 0.66 | wide |
| Toxtricity | upright | height | 1.60 | 1.60 | Large | Large | — | — | 0.69 | 1.72 | 0.66 | wide |
| Dunsparce | squiggle | length | 1.50 | 0.75 | Large | **Medium** | — | — | 0.68 → 0.50 | 1.69 → 1.15 | 0.66 → 0.46 | wide → narrow |
| **Gengar** | upright | height | 1.50 | 1.50 | Large | Large | — | — | 0.68 | 1.69 | 0.66 | wide |
| Glalie | ball | height | 1.50 | 1.50 | Large | Large | — | — | 0.68 | 1.69 | 0.66 | wide |
| Grimmsnarl | humanoid | height | 1.50 | 1.50 | Large | Large | — | — | 0.68 | 1.69 | 0.66 | wide |
| **Heracross** | humanoid | height | 1.50 | 1.50 | Large | Large | — | — | 0.68 | 1.69 | 0.66 | wide |
| Hitmonlee | humanoid | height | 1.50 | 1.50 | Large | Large | — | — | 0.68 | 1.69 | 0.66 | wide |
| Malamar | blob | height | 1.50 | 1.50 | Large | Large | — | — | 0.68 | 1.69 | 0.66 | wide |
| Noivern | wings | height | 1.50 | 1.50 | Large | Large | — | — | 0.68 | 1.69 | 0.66 | wide |
| Togekiss | wings | height | 1.50 | 1.50 | Large | Large | — | — | 0.68 | 1.69 | 0.66 | wide |
| Xatu | wings | height | 1.50 | 1.50 | Large | Large | — | — | 0.68 | 1.69 | 0.66 | wide |
| Cinderace | upright | height | 1.40 | 1.40 | Large | Large | — | — | 0.66 | 1.66 | 0.66 | wide |
| Crustle | armor | height | 1.40 | 1.40 | Large | Large | — | — | 0.66 | 1.66 | 0.66 | wide |
| **Doduo** | legs | height | 1.40 | 1.40 | Large | Large | — | — | 0.66 | 1.66 | 0.66 | wide |
| Drakloak | arms | height | 1.40 | 1.40 | Large | Large | — | — | 0.66 | 1.66 | 0.66 | wide |
| Hitmonchan | humanoid | height | 1.40 | 1.40 | Large | Large | — | — | 0.66 | 1.66 | 0.66 | wide |
| Hitmontop | upright | height | 1.40 | 1.40 | Large | Large | — | — | 0.66 | 1.66 | 0.66 | wide |
| **Houndoom** | quadruped | height | 1.40 | 1.40 | Large | Large | — | — | 1.80 | 4.50 | 0.95 | wide |
| Mienshao | upright | height | 1.40 | 1.40 | Large | Large | — | — | 0.66 | 1.66 | 0.66 | wide |
| Froslass | arms | height | 1.30 | 1.30 | Large | Large | — | — | 0.65 | 1.62 | 0.66 | wide |
| Frosmoth | bug-wings | height | 1.30 | 1.30 | Large | Large | — | — | 0.65 | 1.62 | 0.66 | wide |
| **Gastly** | ball | height | 1.30 | 1.30 | Large | Large | — | — | 0.65 | 1.62 | 0.66 | wide |
| Sneasler | upright | height | 1.30 | 1.30 | Large | Large | — | — | 0.65 | 1.62 | 0.66 | wide |
| **Bayleef** | quadruped | height | 1.20 | 1.20 | Large | Large | — | — | 0.63 | 1.58 | 0.66 | wide |
| **Cetoddle** | upright | height | 1.20 | 1.20 | Large | Large | — | — | 0.63 | 1.58 | 0.66 | wide |
| Eelektrik | fish | length | 1.20 | 0.60 | Large | **Small** | — | — | 0.63 → 0.44 | 1.58 → 0.95 | 0.66 → 0.40 | wide → narrow |
| Gholdengo | humanoid | height | 1.20 | 1.20 | Large | Large | — | — | 0.63 | 1.58 | 0.66 | wide |
| Magnezone | arms | height | 1.20 | 1.20 | Large | Large | — | — | 0.63 | 1.58 | 0.66 | wide |
| **Sudowoodo** | humanoid | height | 1.20 | 1.20 | Large | Large | — | — | 1.65 | 4.13 | 0.95 | wide |
| Weezing | heads | height | 1.20 | 1.20 | Large | Large | — | — | 0.63 | 1.58 | 0.66 | wide |
| Wiglett | blob | height | 1.20 | 1.20 | Large | Large | — | — | 0.63 | 1.58 | 0.66 | wide |
| Wugtrio | blob | height | 1.20 | 1.20 | Large | Large | — | — | 0.63 | 1.58 | 0.66 | wide |
| Calyrex | humanoid | height | 1.10 | 1.10 | Medium | Medium | — | — | 0.56 | 1.28 | 0.46 |  |
| Carkol | legs | height | 1.10 | 1.10 | Medium | Medium | — | — | 0.56 | 1.28 | 0.46 |  |
| **Charmeleon** | upright | height | 1.10 | 1.10 | Medium | Medium | — | — | 0.56 | 1.28 | 0.46 |  |
| **Croconaw** | upright | height | 1.10 | 1.10 | Medium | Medium | — | — | 0.56 | 1.28 | 0.46 |  |
| Florges | arms | height | 1.10 | 1.10 | Medium | Medium | — | — | 0.56 | 1.28 | 0.46 |  |
| Grotle | quadruped | height | 1.10 | 1.10 | Medium | Medium | — | — | 0.56 | 1.28 | 0.46 |  |
| Weavile | upright | height | 1.10 | 1.10 | Medium | Medium | — | — | 0.56 | 1.28 | 0.46 |  |
| **Bergmite** | quadruped | height | 1.00 | 1.00 | Medium | Medium | — | — | 0.54 | 1.25 | 0.46 |  |
| Chandelure | arms | height | 1.00 | 1.00 | Medium | Medium | — | — | 0.54 | 1.25 | 0.46 |  |
| **Ivysaur** | quadruped | height | 1.00 | 1.00 | Medium | Medium | — | — | 0.54 | 1.25 | 0.46 |  |
| **Ledyba** | wings | height | 1.00 | 1.00 | Medium | Medium | — | — | 0.54 | 1.25 | 0.46 |  |
| Magneton | heads | height | 1.00 | 1.00 | Medium | Medium | — | — | 0.54 | 1.25 | 0.46 |  |
| **Makuhita** | humanoid | height | 1.00 | 1.00 | Medium | Medium | — | — | 0.54 | 1.25 | 0.46 |  |
| Mantyke | wings | height | 1.00 | 1.00 | Medium | Medium | — | — | 0.54 | 1.25 | 0.46 |  |
| **Wartortle** | upright | height | 1.00 | 1.00 | Medium | Medium | — | — | 0.54 | 1.25 | 0.46 |  |
| **Chikorita** | quadruped | height | 0.90 | 0.90 | Medium | Medium | — | — | 0.53 | 1.21 | 0.46 |  |
| **Delibird** | wings | height | 0.90 | 0.90 | Medium | Medium | — | — | 0.53 | 1.21 | 0.46 |  |
| Honchkrow | wings | height | 0.90 | 0.90 | Medium | Medium | — | — | 0.53 | 1.21 | 0.46 |  |
| Mienfoo | upright | height | 0.90 | 0.90 | Medium | Medium | — | — | 0.53 | 1.21 | 0.46 |  |
| Pawmot | upright | height | 0.90 | 0.90 | Medium | Medium | — | — | 0.53 | 1.21 | 0.46 |  |
| Porygon-Z | arms | height | 0.90 | 0.90 | Medium | Medium | — | — | 0.53 | 1.21 | 0.46 |  |
| **Quilava** | quadruped | height | 0.90 | 0.90 | Medium | Medium | — | — | 0.53 | 1.21 | 0.46 |  |
| Roserade | humanoid | height | 0.90 | 0.90 | Medium | Medium | — | — | 0.53 | 1.21 | 0.46 |  |
| **Sneasel** | upright | height | 0.90 | 0.90 | Medium | Medium | — | — | 0.53 | 1.21 | 0.46 |  |
| Tentacool | tentacles | height | 0.90 | 0.90 | Medium | Medium | — | — | 0.53 | 1.21 | 0.46 |  |
| Toedscool | legs | height | 0.90 | 0.90 | Medium | Medium | — | — | 0.53 | 1.21 | 0.46 |  |
| Azumarill | upright | height | 0.80 | 0.80 | Medium | Medium | — | — | 0.51 | 1.17 | 0.46 |  |
| Corvisquire | wings | height | 0.80 | 0.80 | Medium | Medium | — | — | 0.51 | 1.17 | 0.46 |  |
| Doublade | heads | height | 0.80 | 0.80 | Medium | Medium | — | — | 0.51 | 1.17 | 0.46 |  |
| Galvantula | armor | height | 0.80 | 0.80 | Medium | Medium | — | — | 0.51 | 1.17 | 0.46 |  |
| **Honedge** | blob | height | 0.80 | 0.80 | Medium | Medium | — | — | 0.51 | 1.17 | 0.46 |  |
| **Magcargo** | squiggle | length | 0.80 | 0.40 | Medium | **Small** | — | — | 1.35 | 3.38 | 0.95 | wide |
| Morgrem | humanoid | height | 0.80 | 0.80 | Medium | Medium | — | — | 0.51 | 1.17 | 0.46 |  |
| Ninjask | bug-wings | height | 0.80 | 0.80 | Medium | Medium | — | — | 0.51 | 1.17 | 0.46 |  |
| Porygon | legs | height | 0.80 | 0.80 | Medium | Medium | — | — | 0.51 | 1.17 | 0.46 |  |
| Raichu | upright | height | 0.80 | 0.80 | Medium | Medium | — | — | 0.51 | 1.17 | 0.46 |  |
| **Sentret** | quadruped | height | 0.80 | 0.80 | Medium | Medium | — | — | 0.51 | 1.17 | 0.46 |  |
| Shedinja | blob | height | 0.80 | 0.80 | Medium | Medium | — | — | 0.51 | 1.17 | 0.46 |  |
| **Zubat** | wings | height | 0.80 | 0.80 | Medium | Medium | — | — | 0.51 | 1.17 | 0.46 |  |
| **Bulbasaur** | quadruped | height | 0.70 | 0.70 | Medium | Medium | — | — | 0.49 | 1.13 | 0.46 |  |
| Drizzile | upright | height | 0.70 | 0.70 | Medium | Medium | — | — | 0.49 | 1.13 | 0.46 |  |
| Dugtrio | heads | height | 0.70 | 0.70 | Medium | Medium | — | — | 0.49 | 1.13 | 0.46 |  |
| Grafaiai | upright | height | 0.70 | 0.70 | Medium | Medium | — | — | 0.49 | 1.13 | 0.46 |  |
| Raticate | quadruped | height | 0.70 | 0.70 | Medium | Medium | — | — | 0.49 | 1.13 | 0.46 |  |
| **Sizzlipede** | tentacles | height | 0.70 | 0.70 | Medium | Medium | — | — | 0.49 | 1.13 | 0.46 |  |
| **Slugma** | squiggle | length | 0.70 | 0.35 | Medium | **Small** | — | — | 0.49 → 0.39 | 1.13 → 0.83 | 0.46 → 0.40 |  |
| **Snorunt** | humanoid | height | 0.70 | 0.70 | Medium | Medium | — | — | 0.49 | 1.13 | 0.46 |  |
| Thwackey | upright | height | 0.70 | 0.70 | Medium | Medium | — | — | 0.49 | 1.13 | 0.46 |  |
| Tyrogue | humanoid | height | 0.70 | 0.70 | Medium | Medium | — | — | 0.49 | 1.13 | 0.46 |  |
| Amoonguss | arms | height | 0.60 | 0.60 | Small | Small | — | — | 0.44 | 0.95 | 0.40 |  |
| **Charmander** | upright | height | 0.60 | 0.60 | Small | Small | — | — | 0.44 | 0.95 | 0.40 |  |
| Clobbopus | tentacles | height | 0.60 | 0.60 | Small | Small | — | — | 0.44 | 0.95 | 0.40 |  |
| Hattrem | humanoid | height | 0.60 | 0.60 | Small | Small | — | — | 0.44 | 0.95 | 0.40 |  |
| **Houndour** | quadruped | height | 0.60 | 0.60 | Small | Small | — | — | 0.44 | 0.95 | 0.40 |  |
| **Koffing** | ball | height | 0.60 | 0.60 | Small | Small | — | — | 0.44 | 0.95 | 0.40 |  |
| Kubfu | upright | height | 0.60 | 0.60 | Small | Small | — | — | 0.44 | 0.95 | 0.40 |  |
| Lampent | arms | height | 0.60 | 0.60 | Small | Small | — | — | 0.44 | 0.95 | 0.40 |  |
| **Mareep** | quadruped | height | 0.60 | 0.60 | Small | Small | — | — | 0.44 | 0.95 | 0.40 |  |
| Munchlax | humanoid | height | 0.60 | 0.60 | Small | Small | — | — | 0.44 | 0.95 | 0.40 |  |
| **Poliwag** | legs | height | 0.60 | 0.60 | Small | Small | — | — | 0.44 | 0.95 | 0.40 |  |
| Porygon2 | legs | height | 0.60 | 0.60 | Small | Small | — | — | 0.44 | 0.95 | 0.40 |  |
| Raboot | upright | height | 0.60 | 0.60 | Small | Small | — | — | 0.44 | 0.95 | 0.40 |  |
| **Sandshrew** | upright | height | 0.60 | 0.60 | Small | Small | — | — | 0.44 | 0.95 | 0.40 |  |
| Togetic | humanoid | height | 0.60 | 0.60 | Small | Small | — | — | 0.44 | 0.95 | 0.40 |  |
| **Totodile** | upright | height | 0.60 | 0.60 | Small | Small | — | — | 0.44 | 0.95 | 0.40 |  |
| **Vulpix** | quadruped | height | 0.60 | 0.60 | Small | Small | — | — | 0.44 | 0.95 | 0.40 |  |
| **Cyndaquil** | humanoid | height | 0.50 | 0.50 | Small | Small | — | — | 0.43 | 0.91 | 0.40 |  |
| **Dreepy** | squiggle | length | 0.50 | 0.25 | Small | **Tiny** | — | — | 0.43 → 0.33 | 0.91 → 0.62 | 0.40 → 0.30 |  |
| Hoopa | arms | height | 0.50 | 0.50 | Small | Small | — | — | 0.43 | 0.91 | 0.40 |  |
| **Murkrow** | wings | height | 0.50 | 0.50 | Small | Small | — | — | 0.43 | 0.91 | 0.40 |  |
| Nincada | armor | height | 0.50 | 0.50 | Small | Small | — | — | 0.43 | 0.91 | 0.40 |  |
| **Noibat** | wings | height | 0.50 | 0.50 | Small | Small | — | — | 0.43 | 0.91 | 0.40 |  |
| **Oddish** | legs | height | 0.50 | 0.50 | Small | Small | — | — | 0.43 | 0.91 | 0.40 |  |
| **Squirtle** | upright | height | 0.50 | 0.50 | Small | Small | — | — | 0.43 | 0.91 | 0.40 |  |
| Unown | ball | height | 0.50 | 0.50 | Small | Small | — | — | 0.43 | 0.91 | 0.40 |  |
| Appletun | quadruped | height | 0.40 | 0.40 | Small | Small | — | — | 0.40 | 0.86 | 0.40 |  |
| Dipplin | heads | height | 0.40 | 0.40 | Small | Small | — | — | 0.40 | 0.86 | 0.40 |  |
| Exeggcute | heads | height | 0.40 | 0.40 | Small | Small | — | — | 0.40 | 0.86 | 0.40 |  |
| **Geodude** | arms | height | 0.40 | 0.40 | Small | Small | — | — | 0.40 | 0.86 | 0.40 |  |
| Hatenna | legs | height | 0.40 | 0.40 | Small | Small | — | — | 0.40 | 0.86 | 0.40 |  |
| **Impidimp** | humanoid | height | 0.40 | 0.40 | Small | Small | — | — | 0.40 | 0.86 | 0.40 |  |
| Inkay | tentacles | height | 0.40 | 0.40 | Small | Small | — | — | 0.40 | 0.86 | 0.40 |  |
| Marill | upright | height | 0.40 | 0.40 | Small | Small | — | — | 0.40 | 0.86 | 0.40 |  |
| Pawmo | upright | height | 0.40 | 0.40 | Small | Small | — | — | 0.40 | 0.86 | 0.40 |  |
| **Pikachu** | quadruped | height | 0.40 | 0.40 | Small | Small | — | — | 0.40 | 0.86 | 0.40 |  |
| **Swinub** | quadruped | height | 0.40 | 0.40 | Small | Small | — | — | 0.40 | 0.86 | 0.40 |  |
| Toxel | upright | height | 0.40 | 0.40 | Small | Small | — | — | 0.40 | 0.86 | 0.40 |  |
| **Turtwig** | quadruped | height | 0.40 | 0.40 | Small | Small | — | — | 0.40 | 0.86 | 0.40 |  |
| Carbink | ball | height | 0.30 | 0.30 | Tiny | Tiny | — | — | 0.34 | 0.64 | 0.30 |  |
| Castform | ball | height | 0.30 | 0.30 | Tiny | Tiny | — | — | 0.34 | 0.64 | 0.30 |  |
| Dwebble | armor | height | 0.30 | 0.30 | Tiny | Tiny | — | — | 0.34 | 0.64 | 0.30 |  |
| Flapple | wings | height | 0.30 | 0.30 | Tiny | Tiny | — | — | 0.34 | 0.64 | 0.30 |  |
| Gimmighoul | blob | height | 0.30 | 0.30 | Tiny | Tiny | — | — | 0.34 | 0.64 | 0.30 |  |
| Grookey | upright | height | 0.30 | 0.30 | Tiny | Tiny | — | — | 0.34 | 0.64 | 0.30 |  |
| Kartana | humanoid | height | 0.30 | 0.30 | Tiny | Tiny | — | — | 0.34 | 0.64 | 0.30 |  |
| **Litwick** | blob | height | 0.30 | 0.30 | Tiny | Tiny | — | — | 0.34 | 0.64 | 0.30 |  |
| Magnemite | arms | height | 0.30 | 0.30 | Tiny | Tiny | — | — | 0.34 | 0.64 | 0.30 |  |
| Minior | ball | height | 0.30 | 0.30 | Tiny | Tiny | — | — | 0.34 | 0.64 | 0.30 |  |
| Morpeko | humanoid | height | 0.30 | 0.30 | Tiny | Tiny | — | — | 0.34 | 0.64 | 0.30 |  |
| **Paras** | armor | height | 0.30 | 0.30 | Tiny | Tiny | — | — | 0.34 | 0.64 | 0.30 |  |
| Pawmi | quadruped | height | 0.30 | 0.30 | Tiny | Tiny | — | — | 0.34 | 0.64 | 0.30 |  |
| **Pichu** | quadruped | height | 0.30 | 0.30 | Tiny | Tiny | — | — | 0.34 | 0.64 | 0.30 |  |
| **Rattata** | quadruped | height | 0.30 | 0.30 | Tiny | Tiny | — | — | 0.34 | 0.64 | 0.30 |  |
| **Rolycoly** | ball | height | 0.30 | 0.30 | Tiny | Tiny | — | — | 0.34 | 0.64 | 0.30 |  |
| Roselia | humanoid | height | 0.30 | 0.30 | Tiny | Tiny | — | — | 0.34 | 0.64 | 0.30 |  |
| Rotom | ball | height | 0.30 | 0.30 | Tiny | Tiny | — | — | 0.34 | 0.64 | 0.30 |  |
| Scorbunny | upright | height | 0.30 | 0.30 | Tiny | Tiny | — | — | 0.34 | 0.64 | 0.30 |  |
| **Snom** | squiggle | length | 0.30 | 0.15 | Tiny | Tiny | — | — | 0.34 → 0.31 | 0.64 → 0.58 | 0.30 |  |
| Sobble | quadruped | height | 0.30 | 0.30 | Tiny | Tiny | — | — | 0.34 | 0.64 | 0.30 |  |
| Tatsugiri | fish | length | 0.30 | 0.15 | Tiny | Tiny | — | — | 0.34 → 0.31 | 0.64 → 0.58 | 0.30 |  |
| **Togepi** | humanoid | height | 0.30 | 0.30 | Tiny | Tiny | — | — | 0.34 | 0.64 | 0.30 |  |
| Applin | squiggle | length | 0.20 | 0.10 | Tiny | Tiny | — | — | 0.32 → 0.29 | 0.61 → 0.55 | 0.30 |  |
| Azurill | legs | height | 0.20 | 0.20 | Tiny | Tiny | — | — | 0.32 | 0.61 | 0.30 |  |
| **Budew** | humanoid | height | 0.20 | 0.20 | Tiny | Tiny | — | — | 0.32 | 0.61 | 0.30 |  |
| Cosmog | ball | height | 0.20 | 0.20 | Tiny | Tiny | — | — | 0.32 | 0.61 | 0.30 |  |
| **Diglett** | blob | height | 0.20 | 0.20 | Tiny | Tiny | — | — | 0.32 | 0.61 | 0.30 |  |
| Floette | arms | height | 0.20 | 0.20 | Tiny | Tiny | — | — | 0.32 | 0.61 | 0.30 |  |
| Foongus | arms | height | 0.20 | 0.20 | Tiny | Tiny | — | — | 0.32 | 0.61 | 0.30 |  |
| Klefki | ball | height | 0.20 | 0.20 | Tiny | Tiny | — | — | 0.32 | 0.61 | 0.30 |  |
| Meltan | ball | height | 0.20 | 0.20 | Tiny | Tiny | — | — | 0.32 | 0.61 | 0.30 |  |
| Natu | wings | height | 0.20 | 0.20 | Tiny | Tiny | — | — | 0.32 | 0.61 | 0.30 |  |
| Polteageist | ball | height | 0.20 | 0.20 | Tiny | Tiny | — | — | 0.32 | 0.61 | 0.30 |  |
| Ribombee | bug-wings | height | 0.20 | 0.20 | Tiny | Tiny | — | — | 0.32 | 0.61 | 0.30 |  |
| Rookidee | wings | height | 0.20 | 0.20 | Tiny | Tiny | — | — | 0.32 | 0.61 | 0.30 |  |
| Shroodle | quadruped | height | 0.20 | 0.20 | Tiny | Tiny | — | — | 0.32 | 0.61 | 0.30 |  |
| Sinistcha | ball | height | 0.20 | 0.20 | Tiny | Tiny | — | — | 0.32 | 0.61 | 0.30 |  |
| Terapagos | quadruped | height | 0.20 | 0.20 | Tiny | Tiny | — | — | 0.32 | 0.61 | 0.30 |  |
| Tynamo | fish | length | 0.20 | 0.10 | Tiny | Tiny | — | — | 0.32 → 0.29 | 0.61 → 0.55 | 0.30 |  |
| Wishiwashi | fish | length | 0.20 | 0.10 | Tiny | Tiny | — | — | 0.32 → 0.29 | 0.61 → 0.55 | 0.30 |  |
| Comfey | ball | height | 0.10 | 0.10 | Tiny | Tiny | — | — | 0.29 | 0.55 | 0.30 |  |
| Cosmoem | ball | height | 0.10 | 0.10 | Tiny | Tiny | — | — | 0.29 | 0.55 | 0.30 |  |
| **Cutiefly** | armor | height | 0.10 | 0.10 | Tiny | Tiny | — | — | 0.29 | 0.55 | 0.30 |  |
| Flabébé | arms | height | 0.10 | 0.10 | Tiny | Tiny | — | — | 0.29 | 0.55 | 0.30 |  |
| **Joltik** | armor | height | 0.10 | 0.10 | Tiny | Tiny | — | — | 0.29 | 0.55 | 0.30 |  |
| Poltchageist | ball | height | 0.10 | 0.10 | Tiny | Tiny | — | — | 0.29 | 0.55 | 0.30 |  |
| Sinistea | ball | height | 0.10 | 0.10 | Tiny | Tiny | — | — | 0.29 | 0.55 | 0.30 |  |

### S1.9 Owner decisions (2026-11-18)

1. **Eternatus:** approved as an axis override `{ axis: 'length' }` with no fixed metres. Its extent comes from the shared rule. Built as `SPECIES_AXIS` in `src/rules/shapes.ts`, read through `axisOf(id, shape)` by `species.ts` (`canon.axis`), `listedAxis` in `sizing.ts` and `scripts/sizetable.ts`. An override can name `height` or `length`, never `span`. The `NEUTRAL_CORE_EXTENT_M` proposal (7.0 m) is withdrawn.
2. **`rules.size.lengthRise` = 0.5.** The S1 table, the class-change list and the moved hashes were rerun (§S1.3, §S1.4, §S1.8).
3. **`rules.size.xlExponent` = 0.30, a fixed constant.** It is never derived from the largest species. The cap stays 4.0 m. `tests/sizing.test.ts` pins both 0.30 and 0.5.
4. **Both flags stay off by default.**
5. **S3 capture build:** built into a private folder inside the S1 worktree (`.capture/`, excluded), with both flags' defaults switched on. That switch is not committed. `renderer.ts` is not touched.
6. **Follow-up F1** (§S1.10).
7. **Symlinks** `node_modules` and `.import-cache` are in `info/exclude` (header note).
8. **The pointerlock failures are a separate task:** `docs/tasks/pointerlock-red-tests.md`.
9. **S2 is skipped for now.** S3's giants are Snorlax and Onix from the roster, plus Wailord and Eternatus loaded only in the capture build. Stop if those two need art imported.

Gates after these changes:
- typecheck: pass.
- `tests/sizing.test.ts` and `tests/catalogue.test.ts`: 29/29.
- `npx tsx scripts/checksum.ts`: 64 existing hashes identical, the flag sets as in §S1.3.
- The navigation and performance gates were not rerun. With the flags off, the sim code paths are unchanged and the hashes prove it.

### S1.10 Follow-up items

- **F1 [done 2026-11-18, §F1 below]: the renderer, UI and spawn size filters read `ctx.rules`.** `speciesSizing` in `src/render/renderer.ts`, the class label and search in `src/ui/ui.ts`, and `passes` in `src/rules/spawning.ts` (the `sizeClasses` filter) must take the run's `rules.size`, not `defaultRules.size`. **When:** after the camera session commits (`renderer.ts` and `ui.ts` are its files) and **before any S1 flag becomes a default.** With the flags off it moves no hash: classes and draws equal the defaults. Add a test that a `ruleOverrides` flag reaches all three readers.
- **F2: props near large sprites fade** (owner accepted D, §S3.10). Wall props (trees, buildings, rock) that a large creature card overlaps fade or dissolve, the way the chase lens dissolves props near the lens. That way a giant's wide sprite (Eternatus' widest frame crosses a wall at 15% of standable positions, §S3.4) is not cut by the crowns in front of it. Renderer work (`src/render/renderer.ts`, `tilestage.ts`). **When:** after the camera session commits. Moves no sim hash.
- **F3 (for the camera session): giant framing** (owner sent E there, §S3.10). From the S3 numbers (§S3.7) on the chase rig at `b89fb55`:
  - **Pivot cap:** the pivot caps at `pivot.max` 2.4 m for every giant except Snorlax. With flags on it sits at 60% (Eternatus) and 66% (Wailord) of the drawn height, against about 80% (`chest`) for smaller Pokémon.
  - **Size-factor cap:** the factor caps at `size.max` 1.8 (Explore boom 7.56 m) for Wailord and Eternatus with flags on, so the largest giants get no more boom than a 4 m one.
  - **Crosshair:** Eternatus seen from behind covers the screen centre, where the crosshair is, **even with flags off**. Its card's right edge is at 658 px off and 706 px on, against a centre of 640 px (1280 × 720).
  - **HUD:** with Eternatus, the feet sit behind the action bar (bottom margin 53 px).

  [Re-run on the rig at `90fc1b7`: §F3 below supersedes these numbers.] The `size-frame-*` scenes in `tools/sizescenes.json` (run with `tools/sizecap.mjs` against the capture builds) **must be re-run after the camera rework**, because its outline-based arm and crosshair keep-out change every number here. The rework's outline data needs Wailord and Eternatus as well.

---

## S3. The giant comparison and the checks

### S3.1 Capture-only import of Wailord and Eternatus (owner decision, 2026-11-18)

The owner approved a capture-only network import. I ran `node scripts/import-pack.mjs wailord eternatus --no-cries --evolutions 0 --out .capture/giants --id giants`:
- 5.5 s, 2 species, 26 moves, 125 KB pack, no warnings;
- new files only in the shared, ignored `.import-cache`.

The pack is merged only into the private capture builds, at bundle time. `content/roster.json`, `src/content/pokedex.ts` and `src/content/art.json` are untouched. Nothing is committed.

**SpriteCollab coverage (pack report):**

| | Wailord (0321) | Eternatus (0890) |
|---|---|---|
| available upstream | Walk, Attack, Strike, Shoot, Rumble, RearUp, Sleep, Hurt, Idle, Swing, Double, Hop, Charge, Rotate | the same 14 |
| imported | Idle, Walk, Attack, Strike, Shoot, Charge, Hurt, Sleep | the same 8 |
| Idle | 8 directions × 6 frames | 8 directions × 4 frames |
| Walk | 8 directions × 12 frames | 8 directions × 6 frames |
| camera-facing idle frame (direction 0, frame 0) | present: cell 47 × 60 px, opaque 54 px tall × 47 px wide | present: cell 61 × 62 px, opaque 57 px tall × 61 px wide |
| import warnings | none | none |
| extent source in the capture build | `length-rise` (listed 14.5 m, fish) | `length-rise` (listed 20 m, length through `SPECIES_AXIS`) |
| sprite-fallback | no | no |

Neither front idle frame is wide (width ÷ height 0.87 and 1.07, against `wideRatio` 1.5). So neither draws at 1.5 × its visual height across, contrary to the expectation in the request. The front frames draw 3.15 m (Wailord) and 4.26 m (Eternatus) wide with both flags on. Their **side-facing** frames are wider, and the clipping and framing checks use them:
- Wailord 4.28 m (idle, direction 2);
- Eternatus 6.01 m (walk, direction 2), 1.51 × its visual height.

### S3.2 Tooling (all capture-only, nothing in the game loads it)

| Path | Role | Committed? |
|---|---|---|
| `.capture/build.mjs` | Private build. An esbuild `onLoad` plugin merges the pack into `pokedex.ts` / `art.json` and, for `on`, switches `axis` and `xlContinuous` to `true` in `defaults.ts` as it bundles. Sources unchanged (checked: the `on` bundle has `xlContinuous:!0`, the `off` bundle `!1`). | no (excluded) |
| `.capture/on/index.html`, `.capture/off/index.html` | The two builds, 17.4 MB each | no |
| `tools/sizeoverlay.js` | The debug overlay, injected into the page, on its own 2D canvas over `#game`, projected with `pokewatch.renderer.project()`. White = footprint; red = hurt cylinder (radius × height); yellow = the idle reference frame's opaque bounds, placed as `CREATURE_VS` places the card (`renderer.right`, anchor, scale, view stretch); a label with listed m, axis, extent, class, `visualM`, drawn size, radius, height and footprint. `measure()` and `frame()` return the numbers below. | new file, uncommitted |
| `tools/sizecap.mjs` | Driver like `tools/cap.mjs`, plus a build per scene, overlay injection and whole eval results (`<scene>.json`). `cap.mjs` is not touched: the camera session has it modified. | new file, uncommitted |
| `tools/sizegiants.gen.mjs` → `tools/sizescenes.json` | 30 scenes: `size-giants-*`, `size-ref-*`, `size-target-*`, `size-deck-24/29-*`, `size-clip-wall-*`, `size-clip-edge-*`, `size-frame-*`, each `on` and `off`. The 14 existing scenes are kept. | modified, uncommitted |
| `scripts/sizegiants.ts` | Headroom, targeting rays, the terrain-clipping scan and the rig's framing maths, on the real sim and World code. `--pack` adds the giants to that process only. | new file, uncommitted |

`renderer.ts` and `main.ts` are untouched. The overlay reads private renderer fields at run time (`sheets`, `right`, `stretch`, `eye`, `rig`) and writes nothing. Reproduce:

```
node .capture/build.mjs on && node .capture/build.mjs off
node tools/sizegiants.gen.mjs
node tools/sizecap.mjs --builds on=.capture/on/index.html,off=.capture/off/index.html tools/sizescenes.json .capture/out size-
npx tsx scripts/sizegiants.ts --pack .capture/giants/giants.bonkpack.json --measure-on .capture/out/size-giants-on.json --measure-off .capture/out/size-giants-off.json --out .capture/out
```

Captures are in `.capture/out/` (PNG and JSON per scene).

**Scene setup:**
- **Comparison rows** (`size-giants-*`, `size-ref-*`, `size-target-*`, `size-deck-*`): the authored meadow arena (`world=authored`), `cam=classic`. The same fixed camera height, distance and zoom are used in both builds.
- **Placement:** the partner moves to the nearest open, flat, dry stretch without decks. The giants spawn 2 m north of it, 5.5 m apart (4 m for the reference row), frozen and unkillable.
- **Facing:** they are turned to the camera (`facing 0`, the idle reference frame) for the render only.

**Reading the numbers:** "drawn" sizes are the idle frame's opaque texels × the species multiplier at a level view. The classic view also stretches every card vertically by 1/cos(pitch) = 1.47 to keep texels square on screen. The third-person view stretches by 1.0–1.6 depending on viewing elevation (1.13–1.14 in the framing captures).

### S3.3 The comparison (captures)

| Scene | What it shows |
|---|---|
| `size-giants-off`, `size-giants-on` | Snorlax, Onix, Wailord, Eternatus. **Off:** 2.48, 2.91, 2.91, 2.91 m; Onix, Wailord and Eternatus are the same height. **On:** 2.49, 3.11, 3.62, 3.98 m. |
| `size-ref-off`, `size-ref-on` | One per class: Rattata (Tiny 0.74), Sandshrew (Small 1.04), Charmeleon (Medium 1.46), Heracross (Large 1.91), Snorlax (XL 2.49). The same with flags on, because none has a length axis and Snorlax sits at the XL floor. |

#### Sizes (class values, role size 1; drawn = idle reference frame at level view, from the capture build)

| | flags | class | extent | visual | drawn h × w (front) | widest frame | radius | sim height | footprint |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|
| Snorlax | off | XL | 2.10 | 2.48 | 2.48 × 2.78 | 2.98 (idle dir 0) | 0.83 | 2.22 | 0.88 |
| Snorlax | on | XL | 2.10 | 2.49 | 2.49 × 2.79 | 2.99 (idle dir 0) | 0.83 | 2.22 | 0.88 |
| Onix | off | XL | 8.80 | 2.91 | 2.91 × 1.52 | 4.99 (idle dir 2) | 0.97 | 2.59 | 0.88 |
| Onix | on | XL | 4.40 | 3.11 | 3.11 × 1.62 | 5.34 (idle dir 2) | 0.93 | 2.48 | 0.88 |
| Wailord | off | XL | 14.50 | 2.91 | 2.91 × 2.53 | 3.44 (idle dir 2) | 0.97 | 2.59 | 0.88 |
| Wailord | on | XL | 7.25 | 3.62 | 3.62 × 3.15 | 4.28 (idle dir 2) | 0.97 | 2.59 | 0.88 |
| Eternatus | off | XL | 20.00 | 2.91 | 2.91 × 3.11 | 4.38 (walk dir 2) | 0.97 | 2.59 | 0.88 |
| Eternatus | on | XL | 10.00 | 3.98 | 3.98 × 4.26 | 6.01 (walk dir 2) | 0.97 | 2.59 | 0.88 |

#### Headroom (deck underside 2.4 m and 2.9 m)

Sim: `World.collides` with the body's sim height under the slab (true = cannot stand there). Drawn: the idle frame's top above the underside at level view; in play the card is also stretched by the view (classic ×1.47).

| | flags | sim height | elite ×2 | 2.4 m: sim enters? | 2.4 m: drawn above underside | 2.9 m: sim enters? | 2.9 m: drawn above underside |
|---|---|---:|---:|---|---|---|---|
| Snorlax | off | 2.22 | 4.43 | yes | 0.08 m (3%) | yes | 0.00 m (0%) |
| Snorlax | on | 2.22 | 4.43 | yes | 0.09 m (4%) | yes | 0.00 m (0%) |
| Onix | off | 2.59 | 5.18 | **no** | 0.51 m (17%) | yes | 0.01 m (0%) |
| Onix | on | 2.48 | 4.96 | **no** | 0.71 m (23%) | yes | 0.21 m (7%) |
| Wailord | off | 2.59 | 5.18 | **no** | 0.51 m (17%) | yes | 0.01 m (0%) |
| Wailord | on | 2.59 | 5.18 | **no** | 1.22 m (34%) | yes | 0.72 m (20%) |
| Eternatus | off | 2.59 | 5.18 | **no** | 0.51 m (17%) | yes | 0.01 m (0%) |
| Eternatus | on | 2.59 | 5.18 | **no** | 1.58 m (40%) | yes | 1.08 m (27%) |

#### Targeting (shots at the drawn sprite)

A horizontal shot from 10 m in front, through the drawn point, against the sim cylinder (`spatial.sweep`, enemies only). "ray" is a crosshair trace (radius 0); "bolt" a 0.3 m shot. Silhouette shares are the idle frame's opaque texels above the hurt window, and outside the cylinder's side view (above it or wider than its radius).

| | flags | hurt window | feet 0.15 m | middle | top (95% drawn) | wing (middle, 75% of half-width) | silhouette above window | outside cylinder |
|---|---|---|---|---|---|---|---:|---:|
| Snorlax | off | 0–2.22 m × r 0.83 | hit / hit (y 0.15) | hit / hit (y 1.24) | **miss** / hit (y 2.36) | **miss** / hit (y 1.24, x 1.04) | 8% | 30% |
| Snorlax | on | 0–2.22 m × r 0.83 | hit / hit (y 0.15) | hit / hit (y 1.25) | **miss** / hit (y 2.37) | **miss** / hit (y 1.25, x 1.05) | 8% | 30% |
| Onix | off | 0–2.59 m × r 0.97 | hit / hit (y 0.15) | hit / hit (y 1.45) | **miss** / hit (y 2.76) | hit / hit (y 1.45, x 0.57) | 4% | 4% |
| Onix | on | 0–2.48 m × r 0.93 | hit / hit (y 0.15) | hit / hit (y 1.56) | **miss** / **miss** (y 2.96) | hit / hit (y 1.56, x 0.61) | 11% | 11% |
| Wailord | off | 0–2.59 m × r 0.97 | hit / hit (y 0.15) | hit / hit (y 1.45) | **miss** / hit (y 2.76) | hit / hit (y 1.45, x 0.93) | 6% | 11% |
| Wailord | on | 0–2.59 m × r 0.97 | hit / hit (y 0.15) | hit / hit (y 1.81) | **miss** / **miss** (y 3.43) | **miss** / hit (y 1.81, x 1.15) | 12% | 25% |
| Eternatus | off | 0–2.59 m × r 0.97 | hit / hit (y 0.15) | hit / hit (y 1.45) | **miss** / hit (y 2.76) | **miss** / hit (y 1.45, x 1.15) | 5% | 29% |
| Eternatus | on | 0–2.59 m × r 0.97 | hit / hit (y 0.15) | hit / hit (y 1.99) | **miss** / **miss** (y 3.78) | **miss** / **miss** (y 1.99, x 1.57) | 24% | 53% |

#### Terrain clipping (every map a run plays: 4 arenas + 4 generated regions, seed 1)

Positions where the body stands clear (a 0.5 m grid: tile centres, edges and corners, so a body can stand against a wall) × 4 camera headings. The card spans the front idle frame ("front") or the widest Idle/Walk frame in any direction, centred ("widest"). "in a wall" = some of the card's width is inside rock or a prop below its top (mean width inside when it is); "edge" = past the map edge; "cliff" = over ground > 0.5 m above the feet, so its lower edge is buried.

| | flags | card | card width | in a wall | mean inside | past the edge | cliff (> 0.5 m) | max rise |
|---|---|---|---:|---:|---:|---:|---:|---:|
| Charmeleon | off | front | 1.32 | 2% | 0.26 m | 0% | 1% | 4.20 m |
| Charmeleon | off | widest | 1.97 | 6% | 0.44 m | 0% | 2% | 4.20 m |
| Snorlax | off | front | 2.78 | 2% | 0.53 m | 0% | 1% | 4.20 m |
| Snorlax | off | widest | 2.98 | 3% | 0.39 m | 0% | 1% | 4.20 m |
| Onix | off | front | 1.52 | 0% | 0.00 m | 0% | 0% | 0.00 m |
| Onix | off | widest | 4.99 | 10% | 0.90 m | 0% | 4% | 4.20 m |
| Wailord | off | front | 2.53 | 2% | 0.39 m | 0% | 1% | 4.20 m |
| Wailord | off | widest | 3.44 | 6% | 0.47 m | 0% | 2% | 4.20 m |
| Eternatus | off | front | 3.11 | 5% | 0.38 m | 0% | 2% | 4.20 m |
| Eternatus | off | widest | 4.38 | 9% | 0.74 m | 0% | 3% | 4.20 m |
| | | maps: arena:meadow, arena:badlands, arena:frost, arena:dusk, gen:viridian-forest@1v2, gen:badlands@7920v2, gen:frost@15839v2, gen:mt-moon@23758v2 | | | | | | |
| Charmeleon | on | front | 1.32 | 2% | 0.26 m | 0% | 1% | 4.20 m |
| Charmeleon | on | widest | 1.97 | 6% | 0.44 m | 0% | 2% | 4.20 m |
| Snorlax | on | front | 2.79 | 2% | 0.53 m | 0% | 1% | 4.20 m |
| Snorlax | on | widest | 2.99 | 3% | 0.39 m | 0% | 1% | 4.20 m |
| Onix | on | front | 1.62 | 0% | 0.00 m | 0% | 0% | 0.00 m |
| Onix | on | widest | 5.34 | 12% | 1.03 m | 0% | 4% | 4.20 m |
| Wailord | on | front | 3.15 | 4% | 0.42 m | 0% | 1% | 4.20 m |
| Wailord | on | widest | 4.28 | 9% | 0.70 m | 0% | 3% | 4.20 m |
| Eternatus | on | front | 4.26 | 9% | 0.70 m | 0% | 3% | 4.20 m |
| Eternatus | on | widest | 6.01 | 15% | 1.12 m | 0% | 5% | 4.20 m |

#### Camera framing as a partner (read-only; the chase rig at `b89fb55`)

The rig frames max(drawn height, 0.6 × drawn width), clamped 0.35–5 m, from the idle frame's cell (not its opaque bounds); boom = state boom × clamp((size / 1.2)^0.55, 0.7, 1.8); pivot = size × 0.8, clamped 0.5–2.4 m. Explore boom 4.2, Pressure 6.2.

| | flags | framing size (cell) | size factor | boom explore / pressure | pivot | pivot / drawn height |
|---|---|---:|---:|---:|---:|---:|
| Snorlax | off | 2.68 | 1.56 | 6.54 / 9.65 | 2.15 | 86% |
| Snorlax | on | 2.69 | 1.56 | 6.55 / 9.67 | 2.15 | 86% |
| Onix | off | 2.97 | 1.65 | 6.91 / 10.20 | 2.37 | 82% |
| Onix | on | 3.18 | 1.71 | 7.18 / 10.60 | 2.40 (max) | 77% |
| Wailord | off | 3.23 | 1.72 | 7.24 / 10.68 | 2.40 (max) | 83% |
| Wailord | on | 4.02 | 1.80 (max) | 7.56 / 11.16 | 2.40 (max) | 66% |
| Eternatus | off | 3.16 | 1.70 | 7.15 / 10.56 | 2.40 (max) | 83% |
| Eternatus | on | 4.33 | 1.80 (max) | 7.56 / 11.16 | 2.40 (max) | 60% |


#### Framing captures (chase camera, partner on open ground in the authored meadow, after 2 s)

| Partner | flags | rig size | pivot | eye: distance / height | card (back view) w × h | in frame | margins L / R / T / B (px, 1280 × 720) | covers screen centre? |
|---|---|---:|---:|---|---|---|---|---|
| Snorlax | off | 2.68 | 2.15 | 6.65 / 3.17 | 2.78 × 2.75 | yes | 376 / 655 / 337 / 140 | no (right edge 625) |
| Snorlax | on | 2.69 | 2.15 | 6.66 / 3.18 | 2.79 × 2.76 | yes | 376 / 655 / 337 / 139 | no |
| Onix | off | 2.97 | 2.37 | 7.03 / 3.46 | 1.52 × 3.66 | yes | 434 / 712 / 282 / 108 | no |
| Onix | on | 3.18 | 2.40 (max) | 7.30 / 3.52 | 1.62 × 3.91 | yes | 432 / 710 / 268 / 112 | no |
| Wailord | off | 3.23 | 2.40 (max) | 7.36 / 3.53 | 2.42 × 2.86 | yes | 401 / 682 / 353 / 103 | no (598) |
| Wailord | on | 4.02 | 2.40 (max) | 7.68 / 3.58 | 3.01 × 3.55 | yes | 380 / 665 / 302 / 103 | no (615) |
| Eternatus | off | 3.16 | 2.40 (max) | 7.27 / 3.52 | 3.82 × 3.34 | yes | 345 / 622 / 314 / 66 | **yes** (658) |
| Eternatus | on | 4.33 | 2.40 (max) | 7.68 / 3.58 | 5.24 × 4.55 | yes | 294 / 574 / 223 / 53 | **yes** (706) |

The first framing run started at `tp=64,64` in Viridian Forest. There the lens was pulled in by props behind the partner, and Snorlax filled the screen (card bottom 92 px below the viewport). That is a terrain pull-in, not a size effect, so the scenes now use open ground. The partner labels show `r 0 h 0 foot 0`: the overlay doesn't read the partner's hurt values (cosmetic).

### S3.4 Terrain clipping

- **Numbers:** the clipping table above. Eternatus' card crosses a wall at 9% of standable positions (front card) or 15% (widest frame), against 5% / 9% with flags off and 2% / 6% for a Medium (Charmeleon). Where it crosses, about 0.7–1.1 m of the card's width is inside the wall. A rise over 0.5 m under the card (a cliff burying its lower edge) occurs at 3–5% of positions. No card reached past the map edge, because every map is ringed by border wall at least 6 tiles deep (the arena's band), so an edge case is a wall case.
- **Captures:**
  - `size-clip-wall-*`: each giant with its footprint against a tree (wall top 2.75 m) to its right. Eternatus' right wing disappears behind the tree crowns.
  - `size-clip-edge-wailord/eternatus-*`: against the west border trees. Eternatus' left half is drawn into the border wood.

### S3.5 Headroom

- **Numbers:** the headroom table above. At 2.4 m, the sim refuses Onix, Wailord and Eternatus (sim height 2.48–2.59 m), and their drawn tops would rise 0.5–1.6 m into the slab: sim and sprite agree that they don't fit. Snorlax enters (sim 2.22 m), and its drawn top reaches 0.09 m into the slab (4%).
- **At 2.9 m, sim and sprite disagree with flags on.** The sim lets every giant under it, while the drawn sprite rises through the slab: Wailord by 0.72 m (20%), Eternatus by 1.08 m (27%), Onix by 0.21 m (7%). With flags off the most is 0.01 m. 2.9 m gaps ship on Mt. Moon and Volcanic Ridge (docs/SIZING.md "Headroom").
- **Captures** (`size-deck-24-*`, `size-deck-29-*`): a slab over each frozen giant, added at run time and redrawn. From the classic view, only what stands above the slab's top shows through it (exaggerated there by the 1.47 card stretch). The sim was not asked whether the giants fit; the numbers above are.

### S3.6 Targeting

- **Numbers:** the targeting table above. A crosshair ray at the drawn top (95% of the drawn height) misses every giant, **with flags off too**: the top sliver of every XL draw already sits above its 2.22–2.59 m hurt window. With flags on, the gap is 0.48 m (Onix), 0.84 m (Wailord) and 1.19 m (Eternatus), and even a 0.3 m bolt misses there. The share of the silhouette outside the hurt window:
  - Eternatus: 24% above the window, 53% outside the cylinder's side view (5% and 29% with flags off);
  - Wailord: 12% and 25% (6% and 11% off).
- **Capture** (`size-target-on/off`): marks at the shot heights, green for a hit and pink for a miss (crosshair ray).

### S3.7 Camera framing (read-only)

The rig at `b89fb55` frames the idle frame's **cell**, not its opaque bounds, from `max(height, 0.6 × width)`.
- **Capped growth:** with flags on, Wailord and Eternatus reach the rig's size cap (factor 1.8, Explore boom 7.56 m). Every giant except Snorlax reaches the pivot cap (2.4 m). So the pivot sits at 60% (Eternatus) and 66% (Wailord) of the drawn height, against about 80% (`chest`) for anything smaller.
- **In frame:** all four stay in frame on open ground. The feet are 53–140 px above the bottom edge; with Eternatus that puts them behind the action bar.
- **Aim point:** Eternatus' back-view card (5.24 m wide with flags on, 3.82 m off) crosses the screen centre, where the crosshair is: its right edge is at 706 px with flags on and 658 px off.
- **Not measured:** the camera session's uncommitted second pass (an L-arm from the measured sprite outline, and a crosshair keep-out) changes all of this. Its outline data has no Wailord or Eternatus.

### S3.8 Mismatches and proposed adjustments (none applied)

| # | Mismatch (flags on) | Evidence |
|---|---|---|
| M1 | **Shots at the drawn top miss.** The hurt window stays at the class height (≤ 2.59 m) while the draw reaches 3.62 m (Wailord) and 3.98 m (Eternatus). 24% of Eternatus' silhouette is above its window and 53% outside its cylinder. | §S3.6 |
| M2 | **Headroom: the sim lets Wailord and Eternatus under a 2.9 m deck their sprites rise through** (by 0.72 m and 1.08 m). | §S3.5 |
| M3 | **Clipping: wide giant cards cross walls more often.** Eternatus' widest card crosses a wall at 15% of standable positions, by up to about 1.1 m on average (9% with flags off). | §S3.4 |
| M4 | **The camera's pivot and size caps stop scaling for giants**, and Eternatus' card covers the crosshair point. Today's rig does this with flags off too. | §S3.7 |
| M5 | **Wide normalisation reads only the front idle frame.** Neither giant is wide from the front. Side frames of long bodies are much wider (Onix 1.62 m front, 5.34 m side), and that width never feeds the drawn size. Not a defect: recorded because the request assumed both giants were wide. | §S3.1 |

| Option | Fixes | Cost |
|---|---|---|
| **A. XL sim height follows the drawn size**: `height = visualM × (class height ÷ class visual)` (0.892) for XL only, radius and footprint unchanged. Onix 2.78, Wailord 3.22, Eternatus 3.55 m; Snorlax unchanged at 2.22. | M1 and M2 together: the window covers about 89% of the draw, and the giants stop entering 2.9 m gaps. | Moves hashes: `xl` would no longer equal `on`, since Onix and Hariyama spawn in `badlands` and Feraligatr is a partner, and `gen` sets with decks move. Gates: navwalk and stuckwatch (wide fields are per height class), `tests/headroom.test.ts`, habplay / habaudit tactical numbers for XL. No `HAB_VERSION` or `LOC_VERSION` bump (layouts unchanged). The partner muzzle rises with class height (`aim.muzzle.up`), which touches aim tests the camera session has modified (`tests/aim3d.test.ts`, untracked `tests/camaim.test.ts`). Needs `/grilling` (contract read by headroom, aim, hazards). |
| **B. Split hit height from body height**: hits read a drawn-size window, headroom and navigation keep the class height. | M1 only. M2 stays. | A new enemy field read by `effects.ts`, `combat.ts`, `moves.ts` (`beam3D`) and `spatial.ts`. The partner side needs `src/sim/types.ts` and `src/sim/player.ts`, which the camera session has modified, so wait for its commit. Moves hashes wherever an XL body is hit above its class height. |
| **C. Lower cap**, for example 3.2 m. | Shrinks M1–M3 (Eternatus' top overshoot 0.61 m instead of 1.39 m). | No hashes or gates. But Wailord, Eternatus and Celesteela would all draw 3.2 m, so the giants stop differing, against decision 3. |
| **D. Accept M3** as normal 2.5D billboard overlap; optionally dissolve props near a large card the way the chase lens dissolves props. | M3 (visual only) | The dissolve would live in `renderer.ts` (camera session). Accepting costs nothing. |
| **E. Camera framing (M4)**: raise the rig's `pivot.max` and `size.max` for XL, or use the sprite outline for the crosshair keep-out. | M4 | Camera session's files only. The second pass already moves toward the outline. Re-run `size-frame-*` after it commits. No sim hashes. |

Recommended order for the owner: **A** if the giants should be hittable where they are drawn and kept out of gaps they visibly don't fit (one rule, data-driven, no per-species exceptions). **B** only if navigation must not change. **C** only as a fallback, because it gives up the giant spread. Whichever is picked, F1 (§S1.10) first, then the flag flip with `/grilling`.

### S3.9 What was not done

- No adjustment applied, no flag default changed, no hash moved.
- `tools/README.md` (where `cap.mjs` is documented) has no `sizecap.mjs` entry, because the camera session has that file modified. Add one after that session commits.
- Clip-state substitutions inside the game's asset registry (for example a missing Faint) were not listed: the registry isn't exposed on `pokewatch`. The import report has no warnings.

### S3.10 Owner decisions on S3 (2026-11-18)

1. **Commit S1 and S3** on `size-extremes-s1` in the worktree. Commit source, tests, docs, tools and the regenerated content. Leave out `.capture/`, the symlinks and the pack output. No push and no merge to `main`.
2. **A approved behind a new flag `rules.size.xlTall`, default off.** When it is on, an Extra Large body's hit height and headroom height are 0.892 × its drawn height (`visualM`). It needs a checksum layer whose off setting reproduces today's hashes.
   - **When:** after the camera session commits. Rebase this branch onto `main`, then use `/grilling` for the hash and gate questions.
   - **Then run:** `npx tsx scripts/navwalk.ts all 5`, `npx tsx scripts/stuckwatch.ts all 3`, the headroom tests and `npx tsx scripts/habplay.ts all 6 1 --raid`.
   - **Then rerun the S3 targeting check** and report how much of each giant's sprite is still outside its hitbox, split into height (above the window) and width (wider than the radius).
3. **B and C rejected.**
4. **D accepted:** wall clipping is accepted as normal billboard overlap. Logged as F2 (props near large sprites fade), renderer work after the camera commit.
5. **E goes to the camera session:** logged as F3, with the S3 numbers and the note that `size-frame-*` must be re-run after their rework.
6. **Order from here:** the camera session commits → rebase onto `main` → F1 (renderer, UI and spawn filters read `ctx.rules`) → A (`xlTall`) → S2 (import the 169 species; propose the default role rule and stop for approval).

---

## Rebase onto the camera commit, F1, and fresh F3 numbers (2026-11-18)

### Rebase

`size-extremes-s1` was rebased onto `main` at `90fc1b7` (the camera commit). The only file both sides changed was
`docs/SIZING.md`; git merged it without a conflict and both sessions' text is kept (the camera rows in "Who reads what"
and "Wall tops", the S1 "Measurement axis" and "Giants" sections). No generated file conflicted. The one break was
`scripts/sizegiants.ts`, whose framing table read the old rig's `CHASE_CONFIG.size / pivot / states`; it now reads the
new rig (below).

Gates after the rebase and F1: typecheck clean; `npm test` 597 / 603, the 4 reds are the pointer-lock tests that fail on
`main` too (`docs/tasks/pointerlock-red-tests.md`); the size tests (`sizing`, `navsize`, `footprint`, `headroom`,
`walltops`, `playability`, `catalogue`, `spawning`) 77 / 77; `scripts/checksum.ts`: every set `main` prints is
identical, and `axis`, `gen-axis`, `xl` are unchanged from before the rebase (`xl` still prints the `on` hashes).

### F1: the renderer, UI and spawn size filters read the run's rules

| Reader | Before | Now |
|---|---|---|
| `src/render/renderer.ts` sheet size and outline | `speciesSizing(…)` with `defaultRules.size` at art load | `sizedArt` under `this.sizeRules`; `useSizeRules(ctx.rules.size)` from `setStage` and `render` re-sizes every sheet (size and the outline the chase rig frames) when a run's size rules differ |
| `src/ui/ui.ts` developer roster class label and search | `bodyOf(sp)` | `bodyOf(sp, hooks.sizeRules())`; `src/main.ts` returns `runSizeRules(ctx)`: the run on screen's `rules.size`, the defaults before one |
| `src/rules/spawning.ts` filters | `bodyOf(sp)`, `traversalOf(sp)` | `passes(sp, f, rules)`; `spawnTableFor(rules, stage, …layers)` is what `startStage` calls; `spawnableSpecies(pools, rules)` for the habitat profiles; `resolveSpawnTable` keeps the defaults for the static `STAGES` and tests |

The `fly` filter had the same defect (`traversalOf` with the default rules) and is fixed with it. `SizeRules` is now
exported from `src/rules/sizing.ts`.

Checks: `tests/spawning.test.ts` "a size filter reads the run's rules.size" (Ekans is Large by default and Medium with
`ruleOverrides.size.axis`, and the run's pool drops it under a Large-only filter). In the browser, the flags-off capture
page given `createRun({ ruleOverrides: { size: { axis: true, xlContinuous: true } } })` and `renderer.setStage` draws
Snorlax, Onix, Wailord, Eternatus, Lapras and Ekans with exactly the class, `visualM`, multiplier and outline top of the
flags-on page, and goes back to the defaults with the next default run. The UI hook reads `runSizeRules(ctx)`
(`src/rules/sizing.ts`), tested in `tests/sizing.test.ts` (the run's rules during a run, the defaults with none).

Not changed (outside F1's three readers, all default-rules by design or tooling): `controlRoster(defaultRules)` in
`src/main.ts` (the playability grades), `profilesFor(defaultRules)` as the default of `src/world/habitat/index.ts`,
`scripts/lib/silhouette.ts` and `scripts/lib/camrig.ts` (the camera session's Node diagnostics).

A consequence for later captures: a flag can now be captured with `ruleOverrides` on an ordinary build. The private
build plugin (`.capture/build.mjs`) is still needed for the capture-only Wailord and Eternatus pack.

### F3: giant framing on the rig at `90fc1b7` (read-only, for the camera session)

Re-run of `size-giants-*` (measurements) and `size-frame-*` (chase captures) against fresh private builds, then
`scripts/sizegiants.ts`. Output: `.capture/out-f1/` (not committed). The rig now frames the sprite's measured outline:
back distance = 4.3 × (outline top + drop) / 1.9, inside 1.8–9 m (`CHASE_CONFIG.frame`); the shoulder puts the
outline's top-right corner 7° left of the crosshair; the pivot sits on the outline's top as drawn.

Ideal arm on open ground (`scripts/sizegiants.ts`, neutral elevation 14°):

| | flags | outline top / drop / right (m) | drawn height | back | shoulder | pivot |
|---|---|---|---:|---:|---:|---:|
| Snorlax | off | 3.28 / 0.50 / 1.49 | 3.78 | 8.55 | 2.54 | 4.00 |
| Snorlax | on | 3.29 / 0.50 / 1.50 | 3.79 | 8.58 | 2.55 | 4.02 |
| Onix | off | 3.66 / 0.38 / 2.91 | 4.04 | 9.00 (max) | 4.01 | 4.45 |
| Onix | on | 3.92 / 0.41 / 3.11 | 4.33 | 9.00 (max) | 4.22 | 4.84 |
| Wailord | off | 2.96 / 0.86 / 1.83 | 3.82 | 8.64 | 2.89 | 3.50 |
| Wailord | on | 3.68 / 1.07 / 2.28 | 4.75 | 9.00 (max) | 3.38 | 4.53 |
| Eternatus | off | 3.31 / 1.12 / 2.55 | 4.43 | 9.00 (max) | 3.65 | 3.95 |
| Eternatus | on | 4.54 / 1.54 / 3.49 | 6.08 | 9.00 (max) | 4.60 | 5.85 |

Captures (partner on open ground in the authored meadow, 1280 × 720, after 2 s; the card is the idle reference frame
from behind; the move bar spans about x 398–885, y 657–712):

| Partner | flags | boom / shoulder in use | eye: distance / height | card w × h (m) | card x / y (px) | bottom margin | in frame | over the move bar |
|---|---|---|---|---|---|---:|---|---|
| Snorlax | off | 8.55 / 2.54 | 8.67 / 6.07 | 2.78 × 3.03 | 380–569 / 452–638 | 82 | yes | no |
| Snorlax | on | 8.58 / 2.55 | 8.70 / 6.09 | 2.79 × 3.04 | 380–569 / 452–638 | 82 | yes | no |
| Onix | off | 9.00 / 4.01 | 9.61 / 6.63 | 1.52 × 3.99 | 337–451 / 419–667 | 53 | yes | yes, 10 px |
| Onix | on | 9.00 / 4.22 | 9.70 / 7.02 | 1.62 × 4.34 | 321–444 / 421–689 | 31 | yes | yes, 32 px |
| Wailord | off | 8.64 / 2.89 | 8.87 / 5.59 | 2.42 × 3.05 | 367–536 / 419–636 | 84 | yes | no |
| Wailord | on | 9.00 / 3.38 | 9.36 / 6.71 | 3.01 × 3.95 | 328–530 / 426–690 | 30 | yes | yes, 33 px |
| Eternatus | off | 9.00 / 3.65 | 9.47 / 6.12 | 3.82 × 3.58 | 288–541 / 413–677 | 43 | yes | yes, 20 px |
| Eternatus | on | 9.00 / 4.60 | 9.87 / 8.03 | 5.24 × 5.31 | 185–533 / 423–796 | −76 | **no** (feet 76 px below the frame) | yes, through it |

What changed against §S3.7 (rig at `b89fb55`):
- **Crosshair: fixed by the rework.** Every giant's card ends left of the screen centre (640 px): rightmost 569 px
  (Snorlax), Eternatus 541 px off and 533 px on, where the old rig had it at 658 / 706 px.
- **Pivot cap: gone.** The pivot follows the outline's top (3.5–5.85 m); nothing caps it at 2.4 m any more.
- **New limit: the back-distance cap `frame.max` 9 m.** The law wants 9.1 m (Onix off) to 13.8 m (Eternatus on). Once
  capped, the top stays pinned under the crosshair line but the arm is too short for the body, so the feet drop. The
  rework's promise (lowest drawn point at 0.88–0.94 of the frame height) holds for Snorlax (0.886) and Wailord off
  (0.883). Capped: Onix off 0.93, Onix on 0.96, Wailord on 0.96, Eternatus off 0.94, Eternatus on 1.11 (out of frame).
  With flags off only Eternatus, which isn't a runtime species, crosses the move bar by more than 10 px; with flags on,
  Onix and Wailord sit on it and Eternatus runs through it.
- **Back distances wanted** (4.3 × drawn height / 1.9): Onix 9.14 off / 9.80 on, Wailord 8.64 / 10.75, Eternatus 10.02 /
  13.76.

Options for the camera session (none applied; camera files): raise `frame.max` to about 14 m (a farther lens is pulled in
by walls and decks more often, and the giant draws smaller on screen, which the law intends); or keep 9 m and accept the
feet on the move bar for the largest XL draws; or, on the size side, lower `xlVisualCap` (S1 decision, owner). The cap
alone decides it: Eternatus on is the only out-of-frame case, and only with `xlContinuous` on.

**Owner decisions on F3 (2026-11-18), for the camera session:**
- `frame.max` (9 m) holds the giants short of the 9.1–13.8 m back distance the law wants for them.
- **Preferred fix:** frame an Extra Large partner by aiming lower and tilting the pitch, not only by raising
  `frame.max`.
- If the distance is raised, cap it around **14 m** and measure how often the lens is blocked at that range.
- Until then, **feet on the move bar for Onix and Wailord are accepted.**
- **`xlVisualCap` stays at 4.0.**

---

## xlTall: Extra Large sim height follows the drawn size (2026-11-18, flag off)

Grilled before implementation (owner answers 2026-11-18):
1. **Rule.** With `rules.size.xlTall` and `xlContinuous` both on, an XL body's height is `visualM × (C.height ÷ C.visual)`,
   the exact class ratio (0.892), not a literal. Otherwise today's `C.height × tilt` branch runs unchanged, so `xlTall`
   alone is bit-identical to today.
2. **Readers.** One height feeds everything: the hit window, headroom (`moveBody`, the wide fields' height classes,
   spawn fit, `nearestFit`) and the spatial muzzle (0.6 × height).
3. **Scope.** Partners and enemies alike. Authored bosses unchanged. Role sizes multiply the new height.
4. **Checksum.** Sets `tall` (`xlContinuous` + `xlTall`), `gen-tall`, `giants` (all three), `gen-giants`. A unit test
   proves `xlTall` alone leaves every body identical. No aim variant unless a flag-on set shows the partner affected.
5. **Gates** under defaults, all three flags, and the no-axis worst case (`xlContinuous` + `xlTall`). The worst case is
   report-only, except that any mandatory space Onix can't reach in navwalk is a blocker. Headroom tests include an
   xlTall case and the narrow-body-vs-lowest-gap check under each flag set. `perf-sim` under defaults and all three flags.
6. **Targeting** rerun split into height (above the window) and width (beside the cylinder, within the window).
7. No `HAB_VERSION` / `LOC_VERSION` bump, no baseline regeneration.
8. Own commit, flag off; stop before any default flips.

### What was built

- `src/rules/defaults.ts`: `size.xlTall: false`. `src/rules/sizing.ts` `bodyOf`: the height rule above.
- `scripts/checksum.ts`: `tall`, `gen-tall`, `giants`, `gen-giants`.
- `scripts/lib/sizeflags.ts`: `--size a,b,c` for navwalk, stuckwatch, habplay and perf-sim (boolean `rules.size` flags
  only; the pair is removed from `process.argv`, so positional arguments keep their places).
- Tests: `tests/sizing.test.ts` (xlTall alone identical; with `xlContinuous` the class ratio, radius and footprint
  unchanged; Onix 2.78 / 3.42 m); `tests/headroom.test.ts` (at a 2.7 m gap Onix walks under at the class height and
  stops at the edge with all three flags and without `axis`, Feraligatr walks under, a wild Onix's `E.tall` carries the
  height; no narrow body taller than the lowest generator gap under defaults, `axis`, `xl`, `tall`, `giants`).
- `tools/sizeoverlay.js` `measure` returns per-row texel counts, so `scripts/sizegiants.ts` splits the silhouette for any
  hit height; `sizegiants.ts` adds a `tall` column set (`on` + `xlTall`; same drawing as `on`).
- Docs: `docs/SIZING.md` "Tall giants", the checksum paragraph and "Checking it"; `CLAUDE.md` checksum list and `--size`.

### Hashes

Every set `main` prints is unchanged, and `axis`, `gen-axis`, `xl` are unchanged. The new sets print existing hashes:
`tall` = `on`, `gen-tall` = `gen`, `giants` = `axis`, `gen-giants` = `gen-axis`. **No replay config exercises xlTall**:
the bot's planar shots never reach an XL body above its class height, the authored arenas have no decks, and the `gen`
runs never put a changed XL body against a deck it no longer fits. The flag's behaviour is covered by the unit and
headroom tests, not by the replays. A replay that does cover it (for example an `aim`-style set with the giants flags,
or a deck map in the replay configs) is a choice for the owner before the flag flips.

### Gates (worktree, 2026-11-18)

| Gate | defaults | all three flags | no axis (worst case: Onix 3.42 m) |
|---|---|---|---|
| `navwalk all 5` | 0 failures (xl arrive 291/291, trainer-xl 83/83) | 0 failures, same tallies | 0 failures, same tallies: Onix reaches every mandatory space |
| `stuckwatch all 3` | 67 bot episodes (1 pinned, **0 trapped**), 2 enemy episodes / 115,818 enemy-s | 67 (1 pinned, 0 trapped), 2 / 115,807 | 67 (1 pinned, 0 trapped), 2 / 115,807 |
| `habplay all 6 1 --raid` | 72/72 | 72/72 | 72/72 |
| headroom + sizing tests | pass | pass (flag sets inside the tests) | pass |
| `perf-sim 500 --repeat 3 --gate` (min of 3) | p50 0.400, p95 0.530, p99 0.860 ms: PASS | p50 0.394, p95 0.514, p99 0.874 ms: PASS | not run (agreed sets only) |

`npm test`: 601 pass, 4 fail, 2 todo of 607; the four reds are the known pointer-lock tests, which fail on `main` too
(`docs/tasks/pointerlock-red-tests.md`). Typecheck clean.

**Routing cost (height classes).** perf-sim plays the authored arenas, which have no decks, so it cannot show the cost.
Measured directly on generated maps (seeds 1–3): every location map and every habitat except Volcanic Ridge has at most
one distinct deck gap (2.4 or 2.9 m), so wide bodies fall in classes 0–1 under every flag set; xlTall never adds a
class there. It only moves Onix between existing ones (Mt. Moon, 2.9 m gap: class 0 → 1 without `axis`, unchanged with
it). Volcanic Ridge has 46–66 distinct gaps (2.9–4.4 m), so continuous heights land in more classes: the wide bodies the
pools can field use 9–11 classes with defaults, 11–12 with all three flags, 10–12 without `axis`. Fields are built on
demand per class present. Live cost there, `stuckwatch volcanic-ridge 3 120`: 9.17 s defaults, 9.22 s all three flags,
9.11 s without `axis` (noise).

### Targeting rerun (S3 check; `tall` = all three flags)

Hurt window and the share of each giant's idle silhouette outside the cylinder. **Height** = above the window; **width**
= within the window's height but further than the radius from the centre line. Shots are ray / 0.3 m bolt, from 10 m.

| | flags | window | height | width | outside | top (95% drawn) ray / bolt | wing ray / bolt |
|---|---|---|---:|---:|---:|---|---|
| Snorlax | off | 0–2.22 × r 0.83 | 8% | 21% | 30% | miss / hit | miss / hit |
| Snorlax | all three | 0–2.22 × r 0.83 | 8% | 21% | 30% | miss / hit | miss / hit |
| Onix | off | 0–2.59 × r 0.97 | 4% | 0% | 4% | miss / hit | hit / hit |
| Onix | axis + xlContinuous | 0–2.48 × r 0.93 | 11% | 0% | 11% | miss / miss | hit / hit |
| Onix | all three | 0–2.78 × r 0.93 | 4% | 0% | 4% | miss / hit | hit / hit |
| Wailord | off | 0–2.59 × r 0.97 | 6% | 6% | 11% | miss / hit | hit / hit |
| Wailord | axis + xlContinuous | 0–2.59 × r 0.97 | 12% | 13% | 25% | miss / miss | miss / hit |
| Wailord | all three | 0–3.23 × r 0.97 | 6% | 13% | 19% | miss / hit | miss / hit |
| Eternatus | off | 0–2.59 × r 0.97 | 5% | 24% | 29% | miss / hit | miss / hit |
| Eternatus | axis + xlContinuous | 0–2.59 × r 0.97 | 24% | 30% | 53% | miss / miss | miss / miss |
| Eternatus | all three | 0–3.55 × r 0.97 | 5% | 40% | 45% | miss / hit | miss / miss |

- **Height is fixed by xlTall.** Above-window shares return to the flags-off level (4–8%), and a bolt at the drawn top
  hits every giant again.
- **Width is what remains.** Radius is the class value (0.93–0.97 m), so what was above the window and is now inside it
  adds to the width share: Eternatus 30% → 40%, Wailord 13%. Eternatus' wing misses with a bolt. Onix (narrow front) has
  none. This is the agreed scope (radius and footprint unchanged), reported, not changed.
- **Headroom (2.9 m deck):** with all three flags the sim now refuses Wailord (3.23 m) and Eternatus (3.55 m), whose
  sprites rise 0.72 / 1.08 m through it; Onix (2.78 m) still enters, its sprite 0.21 m (7%) over the underside. At 2.4 m
  every giant but Snorlax is refused, as before. The 0.892 ratio leaves the top ~11% of a giant's draw above its window
  by design (the class's own height-to-visual ratio).
- Raw output: `.capture/out-tall/sizegiants.md` (not committed).

