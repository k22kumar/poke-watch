# Size extremes plan

Progress record for `docs/size-extremes-handoff.md` (Prompts S1–S3). One section per prompt.
Written for the Claude Code sessions that run S2 and S3, and for the owner deciding the flags.

- **Stage completed:** S1, revised after the owner's decisions on 2026-11-18 (§S1.9). The measurement axis and the XL visual law exist behind two `rules.size` flags. **[Superseded: `axis`, `xlContinuous` and `xlTall` are on by default since 2026-11-18, "Default flip" below.]**
- **S2:** skipped for now (owner). **[Done 2026-11-18/19 on branch `size-extremes-s2` (§S2.7–§S2.12): 162 species imported, 7 skipped for want of art. Not merged.]**
- **S3:** done (§S3). The owner decided on the adjustments on 2026-11-18 (§S3.10): A approved behind a new flag, B and C rejected, D accepted (F2), E goes to the camera session (F3). **[Since done: F1, A as `xlTall`, then the default flip ("Default flip" below).]**
- **Next, in order:** the camera session commits → rebase this branch onto `main` → F1 → A (`rules.size.xlTall`) → S2 (§S3.10). [Done up to A; then the default flip (2026-11-18, "Default flip") and F3 ("F3 done" below). Next: S2. Gate before S2 makes Eternatus a partner: its lens regression ("F3 done").]
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
5. **The older checksum sets don't pin the new flags.** When a flag becomes a default, add `size: { axis: false, xlContinuous: false }` to every older set. [Resolved in the default flip: `S1_OFF` with all three flags.]
6. **Before the flip, the gameplay side of the axis rule needs `/grilling`:** Silicobra and Ekans as Mediums, and Magcargo labelled Small while its boss body is 1.35 m. [Resolved 2026-11-18, "Default flip" decisions 2–3: every class change accepted; Magcargo keeps the label because a boss can no longer reach any spawn filter.]

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
- **F3 [done 2026-11-18, "F3 done" below]: giant framing** (owner sent E there, §S3.10). **F3 must be fixed before S2 makes Eternatus playable as a partner** (owner, default flip). Accepted meanwhile (default flip): Onix as a partner sits at the back-distance cap, and its neutral crosshair ground point (27.4 m) is clamped to `CHASE_CONFIG.aim.max` 26 m by `chaseAim`, about 0.46° of planar heading; `tests/camframe.test.ts` gives every capped partner looser ceilings until F3 lands. From the S3 numbers (§S3.7) on the chase rig at `b89fb55`:
  - **Pivot cap:** the pivot caps at `pivot.max` 2.4 m for every giant except Snorlax. With flags on it sits at 60% (Eternatus) and 66% (Wailord) of the drawn height, against about 80% (`chest`) for smaller Pokémon.
  - **Size-factor cap:** the factor caps at `size.max` 1.8 (Explore boom 7.56 m) for Wailord and Eternatus with flags on, so the largest giants get no more boom than a 4 m one.
  - **Crosshair:** Eternatus seen from behind covers the screen centre, where the crosshair is, **even with flags off**. Its card's right edge is at 658 px off and 706 px on, against a centre of 640 px (1280 × 720).
  - **HUD:** with Eternatus, the feet sit behind the action bar (bottom margin 53 px).

  [Re-run on the rig at `90fc1b7`: §F3 below supersedes these numbers.] The `size-frame-*` scenes in `tools/sizescenes.json` (run with `tools/sizecap.mjs` against the capture builds) **must be re-run after the camera rework**, because its outline-based arm and crosshair keep-out change every number here. The rework's outline data needs Wailord and Eternatus as well.
- **F4: the hit radius beside wide sprites** (owner 2026-11-18, after the xlTall targeting rerun). xlTall fixed the height
  share; the width share stays: Snorlax 21%, Wailord 13%, Eternatus 40% of the idle silhouette lies beside the hurt
  cylinder within its height (radius = the class value). **Stays as it is for now.** Candidate fix: a hurt radius from
  the sprite's measured width, separate from contact and crowd reach (footprint, `enemyRadius` for pushing and contact
  damage). **When:** decided after S2.

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

> **2026-11-18, after the merge:** the raw `.capture/out*` outputs (`out/`, `out-f1/`, `out-tall/`) and the private `on`/`off`
> builds were deleted with the S1 worktree. Only the pack (`.capture/giants/`) and its loader (`.capture/build.mjs`) were kept,
> in the main checkout's `.capture/` (git-ignored through `.git/info/exclude`). Regenerate the outputs with the commands above:
> `node .capture/build.mjs on|off` for the builds, `tools/sizecap.mjs` for the captures, and `scripts/sizegiants.ts` for the
> numbers. The figures quoted in this plan are the record.

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
headroom tests, not by the replays. [Owner chose a deck-map replay, no aimed set: "xlTall replay" below.]

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

### Owner decisions after the xlTall report (2026-11-18)

- **Onix at 2.9 m decks: accepted.** With all three flags Onix (2.78 m sim height) still walks under a 2.9 m deck while
  its sprite shows 0.21 m (7%) above the underside. Accepted as is.
- **Width share:** logged as F4 (§S1.10): stays for now; candidate fix a hurt radius from the measured sprite width,
  separate from contact and crowd reach, decided after S2.
- **A replay that covers xlTall:** a deck map with 2.9 m gaps and Onix in the pool, default and giants variants; no
  aimed set. Built below.

### xlTall replay (`deck`, `deck-giants`, `deck-tall`)

`scripts/checksum.ts` sets that replay their own config (`SET_CONFIGS`): Totodile, seed 5, classic, 240 s, generated
regions with **Mt. Moon** in every region (`regionSeed` 1; its decks leave 2.9 m gaps), and a spawn override with Onix at
weight 6 and as the elite.

| set | flags | hash (end) | Onix ticks under a deck |
|---|---|---|---:|
| `deck` | defaults | `415b8ef9` | 207 |
| `deck-giants` | axis + xlContinuous + xlTall | `8e461982` | 404 |
| `deck-tall` | xlContinuous + xlTall | `5cba0b9b` | 0 |

(Under-deck counts are from a probe of the same configuration, not printed by checksum.ts.)

**What `deck-giants` does and does not cover.** Its hash differs from `deck`, but through the axis alone: on this
configuration, and on Volcanic Ridge and with Onix as the partner, `giants` prints exactly what `axis + xlContinuous`
prints (`xlContinuous` alone moves no sim value). With the axis on Onix is 2.48 m at the class height and 2.78 m with
xlTall. The generators make deck gaps of 2.4 m or at least 2.9 m (`CLEARANCE`), so both heights fall in the same height
class on every shipped map: refused at 2.4 m, admitted at 2.9 m and above. No other runtime XL body crosses a gap either
(Feraligatr and Hariyama 2.25 → 2.29 m, under 2.4 m). The bot's planar shots never test a body's top. So **with all three
flags on, xlTall changes no routing on any shipped map and no bot-replay state**; it changes the hit window above the
class height (spatial shots, which only the aimed sets fire) and the partner muzzle of an XL partner. Its routing effect
is real only where a giant is taller than 2.9 m: Wailord, Eternatus and future giants, or Onix without the axis.

**So `deck-tall` was added** beside the two requested sets: without the axis Onix is 3.42 m, the 2.9 m decks keep it out
(0 ticks under a deck, 207 at the default), and its hash differs from `deck`. It is the replay that exercises xlTall's
routing. An aimed set would cover the hit window; not added (owner: no aimed set).

Every existing set prints what it printed before (full `checksum.ts` run, 2026-11-18).

---

## Default flip: `axis`, `xlContinuous` and `xlTall` on by default (2026-11-18)

Grilled with the owner before any change (`/grilling`, Q1–Q18 and Q15b). Facts came from throwaway worktrees at
`96423d2` with the three defaults flipped (checksums, `npm test`, habitat and location fingerprints, partner and reader
survey, root causes of the two deeper test failures).

### Owner decisions

1. **Where:** the flip is its own commit on `size-extremes-s1`, after two preparatory commits. Merging into `main` is a
   separate step with the owner's go-ahead. Before merging, delete the untracked `docs/size-extremes-handoff.md` in the
   main checkout; the branch's committed copy replaces it.
2. **Axis class changes accepted as rule output**, with no per-species pins: Lapras XL → Large (stays on the wide field),
   Silicobra XL → Medium and Ekans Large → Medium (both leave the wide field), Slugma Medium → Small, Dreepy Small → Tiny,
   tilt only for Onix and Snom. This resolves §S1.6 #6.
3. **Magcargo keeps its Small label** (its authored boss body is unchanged). The owner's condition: no spawn pool or
   `sizeClasses` filter may select an authored boss by its extent class. It did not hold, because a boss named in
   `only` / `include` / `weights` (a map pool, a mode or mod override, or `?pool=`) entered the spawns, where a filter
   saw its label and it was spawned as an ordinary enemy. **Fixed first (commit 1):**
   - every pool layer drops boss ids from the spawns before its filter runs, silently, with no logging inside the sim;
   - `validateSpawnConfig` reports a boss named there;
   - a mode's or mod's `rules.spawning.override` runs through `validateSpawnOverride` where it loads
     (`modeSpawnProblems`, `src/main.ts` `startRun` warns);
   - `?pool=` warns in `src/main.ts` beside its unknown-id warning.
4. **Checksum layering.**
   - `giants-off`, `gen-giants-off` and `deck-giants-off` turn the three flags off and print the pre-flip `on`, `gen` and
     `deck` hashes exactly.
   - Every older set pins them off: `S1_OFF` inside `HEADROOM_OFF`, and `size: S1_OFF` on `aim-pole-off` and
     `aim-tops-off`.
   - `aim-off` stays unpinned, so it keeps printing the current `on`.
   - `deck-tall` is pinned to `axis: false, xlContinuous: true, xlTall: true` and stays the replay that covers xlTall's
     routing.
   - Retired, because each printed the same as a current set: `axis`, `gen-axis`, `xl`, `tall`, `gen-tall`, `giants`,
     `gen-giants`, `deck-giants`.
   - In place of an aimed replay, one unit test in `tests/spatial.test.ts` ("giants"): a ray at 0.85 × Onix's flags-on
     drawn height (2.64 m) hits with the flags on and misses with them off, and a 0.3 m bolt at 95 % of the drawn height
     hits with them on.
5. **Tests that assumed the flags off by default** now pass their flags explicitly on both sides, or build from an
   explicit all-off base. The same-class ±tilt check covers Tiny to Large under the defaults and every class with the
   flags off. Extra Large under the defaults has its own check: drawn = `xlVisual(extent)`, height = 0.892 × drawn.
6. **Rubble test (commit 2).** `tests/caps.test.ts` "Lasso the rubble…" passed only because its basic-attack press
   (Vine Whip) reached the target at 6 m; the rubble never touched it there. It now:
   - presses no attack button;
   - asserts the rubble's own (Stone) hit;
   - places the target 5 m ahead (z 13 → 12), with Slugma kept as the target.

   **Gameplay note:** thrown rubble rides the ground, has no height window, and is lethal only while it moves at 5 m/s or
   more, about 3.1 m past release at 8 m/s against friction 6. At 6 m only an enemy radius near 0.8 m is reached. This
   is recorded only; nothing was changed.
7. **Camera framing (criterion B, `tests/camframe.test.ts`).** The exception is keyed on a condition, not a species: any
   partner whose chase back distance is capped at `CHASE_CONFIG.frame.max` gets looser ceilings. Every other partner
   keeps today's limits. The exception stops applying once F3 raises `frame.max`. A capped partner over the ceilings
   fails, on purpose, which enforces F3 before S2's giants become partners.

   | Check | Capped partner | Every other partner |
   |---|---|---|
   | bottomY | ≤ 0.96 | ≤ 0.95 |
   | drawn share | ≤ 0.42 | ≤ 0.40 |
   | move-bar overlap at 1280 × 720 | ≤ 4 % | ≤ 2.5 % |
   | E4 neutral crosshair ground point | ≤ 28 m | ≤ 26 m |

   Capped today: Onix (bottomY 0.957, drawn 0.415, 3.78 %, E4 27.4 m with the flip) and Furret (capped before the flip
   too, inside the ordinary limits). Onix's E4 point is clamped to 26 m by `chaseAim`, about 0.46° of planar heading:
   accepted and recorded under F3.
8. **No `HAB_VERSION` / `LOC_VERSION` bump, no new baseline, no habaudit run.**
   - Habitat profiles (`profilesFor`) are identical under both flag states, because footprints are the class `body`.
   - 36 habitat maps (6 recipes × 2 variants × seeds 1–3), 12 location maps and 12 classic-generator maps hash identical.
   - `habaudit --child` on all 24 fresh loads matches `docs/habaudit/baseline.json`.
9. **Not waiting on** F2, F3, F4 or S2. F3 must be fixed before S2 makes Eternatus playable as a partner.
10. **Commit order:** boss validator → rubble test → the flip → gates → stop. No merge and no push until the owner says.

### What changed

- `src/rules/defaults.ts`: `size.axis`, `xlContinuous` and `xlTall` are `true`.
- `scripts/checksum.ts`: the sets in decision 4.
- `scripts/lib/sizeflags.ts`: `--size` also takes `name=false`. The flags are on by default, so a bare name could no
  longer select the flags-off or no-axis runs. `--size axis=false` is the no-axis worst case.
- Tests:
  - `sizing` (an `OFF` base; a new Extra Large default check);
  - `spawning` (Ekans is Medium by default and Large with the axis off);
  - `catalogue` (widest wild radius 0.93, Onix);
  - `headroom` (every flag set pinned explicitly, plus an `off` set);
  - `camframe` (the capped-partner ceilings);
  - `spatial` (the giants ray and bolt).
- Docs: `docs/SIZING.md`, `docs/SPECIES.md`, `docs/HABITATS.md`, `CLAUDE.md`, `README.md` §Build, and a pointer line
  at the top of the handoff.

### Runtime species after the flip (defaults vs flags off)

| species | class | drawn (m) | radius | height | footprint |
|---|---|---|---|---|---|
| Onix | XL | 2.91 → 3.11 | 0.97 → 0.93 | 2.59 → 2.78 | 0.88 |
| Feraligatr, Hariyama | XL | 2.52 → 2.56 | 0.84 | 2.25 → 2.29 | 0.88 |
| Snorlax | XL | 2.48 → 2.49 | 0.83 | 2.22 | 0.88 |
| Lapras | XL → Large | 2.55 → 1.81 | 0.85 → 0.64 | 2.28 → 1.60 | 0.88 → 0.66 |
| Silicobra | XL → Medium | 2.50 → 1.46 | 0.84 → 0.56 | 2.23 → 1.28 | 0.88 → 0.46 |
| Ekans | Large → Medium | 2.06 → 1.43 | 0.73 → 0.54 | 1.82 → 1.25 | 0.66 → 0.46 |
| Slugma | Medium → Small | 1.29 → 0.90 | 0.49 → 0.39 | 1.13 → 0.83 | 0.46 → 0.40 |
| Dreepy | Small → Tiny | 0.99 → 0.73 | 0.43 → 0.33 | 0.91 → 0.62 | 0.40 → 0.30 |
| Snom | Tiny | 0.74 → 0.68 | 0.34 → 0.31 | 0.64 → 0.58 | 0.30 |
| Magcargo (boss) | Medium → Small (label only) | 3.38 | 1.35 | 3.38 | 0.95 |

Every playability tier is unchanged (68 ready, 4 partial).

### Hashes

Every older-layer set (`off`, `build-off`, `world-off`, `hazards-off`, `size-off`, `roster-off`, `gen-classic`, `gen-size-off`, `gen-headroom-off`, `aim-2b`, `aim-pole-off`, `aim-tops-off`), `aim` and `deck-tall` (`5cba0b9b`) print exactly what they printed before the flip.

| set | cyndaquil s2 | totodile s7 | bulbasaur s3 | charmander s11 | was |
|---|---|---|---|---|---|
| `on` | `632d7d25` | `74eccc9d` | `93ae9839` | `a94be2d9` | = old `giants` |
| `gen` | `bc465079` | `72710e43` | `bd080f0c` | `db985697` | = old `gen-giants` |
| `aim-off` | `632d7d25` | `74eccc9d` | `93ae9839` | `a94be2d9` | = new `on` |
| `giants-off` | `632d7d25` | `17978323` | `93ae9839` | `53516479` | = old `on` |
| `gen-giants-off` | `bc465079` | `72710e43` | `bd080f0c` | `7708b606` | = old `gen` |

`deck` (Totodile s5, Mt. Moon): end `8e461982` (= old `deck-giants`); `deck-giants-off`: end `415b8ef9` (= old `deck`).

Moved against the pre-flip `on`: totodile (7th mark `d634f7af` → `f9b91e67`, kills 1872 → 1873) and charmander (4th mark `47a9cb47` → `a5fb0e08`, kills 491 → 480); `gen` charmander (4th mark `1ca1a931` → `eb41c399`). The moves come from the axis (§S1.3); `xlContinuous` and `xlTall` move no replay state on these configs.

### Gates (worktree, at the new defaults)

| Gate | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm test` | 611 tests: 605 pass, 4 fail, 2 todo. The 4 fails are the known pointer-lock tests (`docs/tasks/pointerlock-red-tests.md`), red on `main` too. |
| `npx tsx scripts/checksum.ts` | the hashes above (rerun at the commit, identical) |
| `navwalk all 5` | 0 failures (xl arrive 291/291, xl refuse 5/5, elite 291/291, trainer-xl 83/83, narrow 313/313) |
| `stuckwatch all 3` | 67 bot episodes (1 pinned, **0 trapped**); 2 enemy episodes over 115,807 enemy-s (the same as the all-three-flags run of the xlTall gates) |
| `habplay all 6 1 --raid` | 72/72 |
| `habstate` | 24/24 (20 live, 4 static) |
| `hazplay` | 49/49 |
| `perf-sim 500 --repeat 3 --gate` | min of 3: p50 0.399, p95 0.531, p99 0.863 ms: PASS |
| `npm run build` (the worktree's own `dist/`) | pass, `dist/index.html` 17,258 KB |
| habaudit | not run (owner: profiles and fresh loads already match the baseline) |

Not merged, not pushed.

---

## F3 done: giant framing (2026-11-18)

Grilled with the owner, then built on `main`; full record in `docs/THIRD_PERSON_IMPLEMENTATION.md` §26 and
`docs/THIRD_PERSON.md` "Composition".

- **Measured first:** a per-subject pitch alone cannot pass criterion B (it moves E4, not the feet or the drawn share);
  only distance brings the drawn share to 0.40, and distance alone leaves E4 failing for Onix (27.1 m) and Eternatus
  (31.0 m).
- **Built:** `frame.max` 9 → 14 m (the law sets every partner's distance under it; Eternatus wants 13.75 m), and a
  condition-bound subject tilt (`chaseTilt`): zero unless a partner's neutral crosshair ground point lies past
  `aim.max` (26 m), then just enough extra pitch to bring it back. Onix 0.52°, Eternatus 2.35°, every other partner 0.
  Eased over `frame.settle` on a tag swap, an evolution or any size change; a deliberate exception to §24.2.
- **Result:** all 70 partners (68 game species, Wailord and Eternatus from `tests/fixtures/giants-frame.json`) pass
  criterion B at the normal limits; the `frame.max` exception in `tests/camframe.test.ts` is gone; criterion A (nothing
  in the keep-out) covers the giants too. Captures: Eternatus' feet back in frame (bottom margin −76 → 77 px), Onix 31 →
  58 px, Wailord 30 → 84 px; every card left of the crosshair. Every checksum set identical.
- **Gate before S2 makes Eternatus a partner:** its lens regression at 13.75 m must be fixed or explicitly re-accepted.
  Tuning clear share 87.6 → 83.3 % forward and 78.1 → 73.3 % reverse; lens pops reverse 19.2 → 32.6 /min, strafeR 43.0
  → 52.1 /min with the largest 4.7 → 9.8 m; holdout approach hard pull-ins 4.8 → 11.9 %. Onix and Wailord move within
  about 1.5 points; Furret strafeR pops 25.7 → 35.7 /min; Feraligatr (control) identical. Full tables:
  `docs/camaudit/2026-11-18-f3-{before,after}.json`.
- **Furret's strafe-right lens jumps** rose from 25.7 to 35.7 a minute with F3 (owner, 2026-11-18). Not a blocker.
  Tracked under `docs/THIRD_PERSON_IMPLEMENTATION.md` §25.8, beside the Eternatus lens regression.
- **The fixture goes with S2:** when Wailord and Eternatus become game species, `tests/camframe.test.ts` switches to them
  and fails until `tests/fixtures/giants-frame.json` is deleted.
- **Capture tooling:** `.capture/build.mjs` (local, git-ignored) now builds one variant at the current defaults
  (`node .capture/build.mjs defaults --out <dir>`); its old `on` variant could not build once the flags were default-on.


---

## S2. Catalogue families as runtime actors (started 2026-11-18)

### S2.0 Owner updates since the handoff (2026-11-18)

1. The size flags are on by default. Judge the 169 new species under the current rules: their class, their share on wide
   navigation, and how many reach `frame.max` (14 m).
2. **Eternatus imports as wild only, not as a partner**, until its lens gate ("F3 done") is fixed or the owner signs it off.
3. When Wailord and Eternatus become real species, `tests/camframe.test.ts` switches to them and
   `tests/fixtures/giants-frame.json` is deleted, as the test requires.
4. Once a giant whose sim height is over 2.9 m is in a spawn pool, confirm that a default replay sends it against a deck,
   so the replays cover xlTall in normal play.
5. The new species sit behind a checksum layer (the `roster-off` pattern) whose off setting prints today's hashes.
6. **This step only:** fetch the sources, report the coverage gaps, and propose the default role rule with a role table.
   Stop for approval before writing any roster entry.

### S2.1 Sources (step 1)

- **The 169** are the species-default records of the 108 families in `content/catalogue.json` whose species is not in
  `SPECIES`. That is 210 − 41, matching the handoff count.
- **`npm run fetch-sources` cannot fetch them yet.** `scripts/fetch-sources.sh` takes its names from
  `content/roster.json`, and the 169 have no roster entry. I ran a scratch copy that reads a scratch roster instead: the
  real roster plus the 169 as empty `wild` keys. The repository is unchanged. Once the 169 are in `roster.json`, the
  plain `npm run fetch-sources` covers them with no script change.
- **Result:** 241 species (72 runtime + 169), 574 level-up moves, 42 s, into `../src-data`, which is shared and outside
  the repo. Only the sparse sets grew. The clone revisions are unchanged: api-data `88fdb728`, SpriteCollab `2f5d22b`,
  cries `b3a9044`, catalogue CSVs `8a92bfa7`.

### S2.2 Coverage gaps (13 of 169)

Every one of the 169 has a portrait (`portrait/<dex>/Normal.png`). The other 158 have Idle and Walk in all 8 directions,
with shadow sheets and no column mismatches.

| Gap | Species (dex) | Upstream state | Effect on `npm run content` today |
|---|---|---|---|
| No sprite folder | Crustle (558), Amoonguss (591), Carkol (838), Coalossal (839), Shroodle (944), Toedscruel (949) | SpriteCollab tracker `sprite_complete` 0; portrait only | `importSprites` fetches `AnimData.xml` with no fallback and throws |
| Sprites only for a non-default form | Falinks (870): the Brass (`0002`) and Trooper (`0003`) forms have full sheets. Gimmighoul (999): only the Roaming form (`0001`) has sheets, not the default Chest form | the root folder is empty | throws, as above |
| Idle but no Walk | Gouging Fire (1020), Grafaiai (945), Raging Bolt (1021) | Idle and Rotate (Raging Bolt also has Double) | throws `no usable Walk animation` |
| No playable cry | Meltan (808), Melmetal (809) | `latest/<id>.ogg` is an MP3 under an `.ogg` name (bytes `FF FB`), and there is no legacy file | imports; the cry counts as missing, so the game synthesises a call. There is no ffmpeg on the Mac |

- **One throw aborts the whole import** (`import-pack.mjs` `main().catch` exits 1). So the 11 sprite gaps block
  `npm run content` for every species, not only for themselves.
- **The runtime already plays Idle for walking** (`ANIM_FALLBACKS.walk = ['Walk', 'Idle']`, `src/assets/art.ts`). The 3
  Idle-only species need only an importer change: accept Idle when Walk is missing.
- **Other clips:** after the 11, the most common missing clips are Faint (151 of 169), Strike (42), Shoot (18) and Hurt
  (13). Each has an `ANIM_FALLBACKS` chain, so none of them blocks anything.
- **Extent source:** every one of the 169 has a PokéAPI height, so none should land on `sprite-fallback`. Confirm this
  after the import.

### S2.3 Sizes under the current rules (flags on by default)

From `bodyOf` and `footprintOf` at role size 1, built from each species' canonical height and shape (scratch harness):

| Class | Tiny | Small | Medium | Large | XL |
|---|---|---|---|---|---|
| New species | 37 | 21 | 34 | 41 | 36 |

- **Wide navigation:** 77 of 169 (46 %), which is every Large and every XL species. 18 take their extent from
  `length-rise`.
- **Sim height over 2.9 m** (decision 4):

  | Species | Sim height (m) | Flies (proposed rule) |
  |---|---|---|
  | Eternatus | 3.55 | no |
  | Celesteela | 3.46 | yes |
  | Wailord | 3.23 | no |
  | Yveltal | 3.02 | yes |
  | Guzzlord | 2.97 | no |
  | Stakataka | 2.97 | no |
  | Lugia | 2.92 | yes |
  | Raging Bolt | 2.92 | no |

  The deck replay check needs a ground walker from this list. Flyers do not route under decks.
- **`frame.max` count: not measured yet.** The partner camera law reads the measured sprite outline, which exists only
  after import. Count it after the import, or earlier from a capture-only pack as in §S3.1.

### S2.4 Proposed default role rule (awaiting owner approval)

The rule applies only to a `wild` entry that names no behaviour. The 50 hand-authored wild roles stay as they are, so no
existing hash moves. Each condition is checked in order, and the first one that matches sets the behaviour:

| # | Behaviour | Condition (base stats, types, shape, level-up moves) |
|---|---|---|
| 1 | `healer` | learns at level-up a move that heals allies' HP (`heal-pulse`, `floral-healing`, `life-dew`, `pollen-puff`), and BST < 500 |
| 2 | `swarm` | flies (rule below), class Medium or smaller, and BST ≤ 300 |
| 3 | `ranged` | SpA > Atk. The shot is the primary type's element, which is already the sim's default (`sp.shot ?? sp.elements[0]`), so the entry omits `shot` |
| 4 | `tank` | HP + Def ≥ 1.15 × (max(Atk, SpA) + Spe) |
| 5 | `charger` | Spe ≥ 80 |
| 6 | `chase` | everything else |

**Flying:**
- A Flying type flies, unless its shape is `legs`. Only Doduo and Dodrio are grounded by that.
- Any other species flies if it has the ability Levitate, has the shape `bug-wings`, or is a Ghost type with the shape
  `ball`, `arms`, `squiggle`, `tentacles` or `heads`.
- Grounding every `upright`, `humanoid` or `quadruped` Flying type was tested and rejected: it grounded Dragonite,
  Togetic, Tropius and Celesteela.

**How the thresholds were picked.** I swept the tank factor from 1.0 to 1.4 and the charger speed from 60 to 90 against
the 50 hand roles. Agreement stayed between 26 and 29 of 50 across the whole sweep.
- 1.15 and 80 give a chase/charger split close to the hand set.
- BST < 500 keeps the healer share at 3.6 %, close to the roster's 4 %. Without that limit Ho-oh, Xerneas, Calyrex,
  Togekiss, Hatterene and Sinistcha would be healers too.

**Against the 50 hand roles:**
- Behaviour agrees for 29 of 50.
- The primary-element shot agrees for 8 of the 9 where both say `ranged`. The exception is Oddish: the rule gives bloom,
  the roster has venom.
- Flying agrees for 49 of 50. The exception is Cutiefly: its shape is `armor`, so no data marks it as a flyer.
- The hand roles include balance decisions, such as Pichu moving from `swarm` to `chase` (`docs/SPECIES.md`). Matching
  them all is not the goal.

**Role counts:**

| Set | ranged | charger | tank | chase | healer | swarm | flying |
|---|---|---|---|---|---|---|---|
| Hand-authored (50) | 12 | 9 | 8 | 13 | 2 | 6 | 10 |
| Rule on the 169 | 55 (33 %) | 39 | 34 | 33 | 6 | 2 | 39 |

- **Ranged share:** the rule makes 33 % of the new species ranged, against 24 % in the hand set. Option: require
  SpA ≥ Atk + 10. That gives ranged 47, tank 37, charger 41 and chase 36, with 27 of 50 agreement.
- **Few swarms:** there are only 2 (Tynamo, Rookidee), because most of the 169 are evolved or legendary.

### S2.5 Decisions needed before any roster entry

1. **The rule:** approve it as written, with the thresholds 1.15, 80 and 500, the shot margin (0 or 10), and the
   flying rule. Also decide where it lives:
   - (a) a data-driven default in `src/rules/` (tunables in rules, applied wherever a `wild` entry names no behaviour);
   - (b) applied in `scripts/build-content.mjs`, written into the generated `pokedex.ts`.
2. **The 11 sprite gaps:**
   - Idle-only (3): let the importer accept Idle when Walk is missing.
   - Form folders (Falinks, Gimmighoul): use one form's sheets, and choose which. Gimmighoul's Roaming form is not its
     default Chest form.
   - No sprite at all (6): keep them catalogue-only until SpriteCollab has sprites, or add placeholder art. Owner
     decision 1 says every Pokémon is meant to be playable.
3. **Meltan and Melmetal cries:** accept the synthesised call, or decode the MP3 (needs ffmpeg or a decoder).
4. **Eternatus as wild only:** recruitment today is `recruitables` (`src/sim/objectives.ts`), which takes any spawnable
   species with a tag line (`tagLineOf`). Keeping Eternatus out of the squad needs a data-level exclusion that sim and
   tests read. Decide its shape when the roster work starts.
5. **Checksum layer:** `'all-wild': { everyWild: true }` adds every wild species to the spawns
   (`src/rules/spawning.ts`). So the layer has to keep the 169 out of the spawns, and out of everything else that
   iterates `SPECIES`, when it is off. Habitat `profilesFor` also reads the species set (`src/rules/catalogue.ts`).

### S2.6 Role table (169 new species, proposed rule)

**[Superseded by §S2.11: this table is the proposal at shot margin 0. The approved rule uses Sp. Atk ≥ Atk + 10, and §S2.11 lists the roles as imported.]** The rule column shows the condition that matched. Stats are base stats from PokéAPI.

| species (dex) | types | shape | class | HP/Atk/Def/SpA/SpD/Spe (BST) | behaviour · shot | flying | rule fired | coverage gap |
|---|---|---|---|---|---|---|---|---|
| raticate (20) | normal | quadruped | Medium | 55/81/60/50/70/97 (413) | charger |  | Atk ≥ SpA, Spe 97 ≥ 80 |  |
| arbok (24) | poison | squiggle | Large · wide | 60/95/69/65/79/80 (448) | charger |  | Atk ≥ SpA, Spe 80 ≥ 80 |  |
| raichu (26) | electric | upright | Medium | 60/90/55/90/80/110 (485) | charger |  | Atk ≥ SpA, Spe 110 ≥ 80 |  |
| dugtrio (51) | ground | heads | Medium | 35/100/50/50/70/120 (425) | charger |  | Atk ≥ SpA, Spe 120 ≥ 80 |  |
| tentacool (72) | water/poison | tentacles | Medium | 40/40/35/50/100/70 (335) | ranged · tide |  | SpA 50 > Atk 40 |  |
| tentacruel (73) | water/poison | tentacles | Large · wide | 80/70/65/80/120/100 (515) | ranged · tide |  | SpA 80 > Atk 70 |  |
| magnemite (81) | electric/steel | arms | Tiny | 25/35/70/95/55/45 (325) | ranged · volt |  | SpA 95 > Atk 35 |  |
| magneton (82) | electric/steel | heads | Medium | 50/60/95/120/70/70 (465) | ranged · volt |  | SpA 120 > Atk 60 |  |
| dodrio (85) | normal/flying | legs | Large · wide | 60/110/70/60/60/110 (470) | charger | no (legs) | Atk ≥ SpA, Spe 110 ≥ 80 |  |
| exeggcute (102) | grass/psychic | heads | Small | 60/40/80/60/45/40 (325) | ranged · bloom |  | SpA 60 > Atk 40 |  |
| exeggutor (103) | grass/psychic | legs | Large · wide | 95/95/85/125/75/55 (530) | ranged · bloom |  | SpA 125 > Atk 95 |  |
| hitmonlee (106) | fighting | humanoid | Large · wide | 50/120/53/35/110/87 (455) | charger |  | Atk ≥ SpA, Spe 87 ≥ 80 |  |
| hitmonchan (107) | fighting | humanoid | Large · wide | 50/105/79/35/110/76 (455) | chase |  | Atk ≥ SpA, Spe 76 < 80 |  |
| weezing (110) | poison | heads | Large · wide | 65/90/120/85/70/60 (490) | tank | yes | HP+Def 185 ≥ 1.15×(Atk+Spe) 150 |  |
| porygon (137) | normal | legs | Medium | 65/60/70/85/75/40 (395) | ranged · plain |  | SpA 85 > Atk 60 |  |
| dratini (147) | dragon | squiggle | Medium | 41/64/45/50/50/50 (300) | chase |  | Atk ≥ SpA, Spe 50 < 80 |  |
| dragonair (148) | dragon | squiggle | Large · wide | 61/84/65/70/70/70 (420) | chase |  | Atk ≥ SpA, Spe 70 < 80 |  |
| dragonite (149) | dragon/flying | upright | XL · wide | 91/134/95/100/100/80 (600) | charger | yes | Atk ≥ SpA, Spe 80 ≥ 80 |  |
| togetic (176) | fairy/flying | humanoid | Small | 55/40/85/80/105/40 (405) | healer | yes | ally-heal life-dew, BST 405 < 500 |  |
| natu (177) | psychic/flying | wings | Tiny | 40/50/45/70/45/70 (320) | ranged · mind | yes | SpA 70 > Atk 50 |  |
| xatu (178) | psychic/flying | wings | Large · wide | 65/75/70/95/70/95 (470) | ranged · mind | yes | SpA 95 > Atk 75 |  |
| marill (183) | water/fairy | upright | Small | 70/20/50/20/50/40 (250) | tank |  | HP+Def 120 ≥ 1.15×(Atk+Spe) 60 |  |
| azumarill (184) | water/fairy | upright | Medium | 100/50/80/60/80/50 (420) | ranged · tide |  | SpA 60 > Atk 50 |  |
| unown (201) | psychic | ball | Small | 48/72/48/72/48/48 (336) | chase | yes | Atk ≥ SpA, Spe 48 < 80 |  |
| dunsparce (206) | normal | squiggle | Medium | 100/70/70/65/65/45 (415) | tank |  | HP+Def 170 ≥ 1.15×(Atk+Spe) 115 |  |
| steelix (208) | steel/ground | squiggle | XL · wide | 75/85/200/55/65/30 (510) | tank |  | HP+Def 275 ≥ 1.15×(Atk+Spe) 115 |  |
| mantine (226) | water/flying | wings | XL · wide | 85/40/70/80/140/70 (485) | ranged · tide | yes | SpA 80 > Atk 40 |  |
| porygon2 (233) | normal | legs | Small | 85/80/90/105/95/60 (515) | ranged · plain |  | SpA 105 > Atk 80 |  |
| tyrogue (236) | fighting | humanoid | Medium | 35/35/35/35/35/35 (210) | chase |  | Atk ≥ SpA, Spe 35 < 80 |  |
| hitmontop (237) | fighting | upright | Large · wide | 50/95/95/35/110/70 (455) | chase |  | Atk ≥ SpA, Spe 70 < 80 |  |
| lugia (249) | psychic/flying | wings | XL · wide | 106/90/130/90/154/110 (680) | tank | yes | HP+Def 236 ≥ 1.15×(Atk+Spe) 200 |  |
| ho-oh (250) | fire/flying | wings | XL · wide | 106/130/90/110/154/90 (680) | charger | yes | Atk ≥ SpA, Spe 90 ≥ 80 |  |
| nincada (290) | bug/ground | armor | Small | 31/45/90/30/30/40 (266) | tank |  | HP+Def 121 ≥ 1.15×(Atk+Spe) 85 |  |
| ninjask (291) | bug/flying | bug-wings | Medium | 61/90/45/50/50/160 (456) | charger | yes | Atk ≥ SpA, Spe 160 ≥ 80 |  |
| shedinja (292) | bug/ghost | blob | Medium | 1/90/45/30/30/40 (236) | chase |  | Atk ≥ SpA, Spe 40 < 80 |  |
| azurill (298) | normal/fairy | legs | Tiny | 50/20/40/20/40/20 (190) | tank |  | HP+Def 90 ≥ 1.15×(Atk+Spe) 40 |  |
| roselia (315) | grass/poison | humanoid | Tiny | 50/60/45/100/80/65 (400) | ranged · bloom |  | SpA 100 > Atk 60 |  |
| wailmer (320) | water | fish | Medium | 130/70/35/70/35/60 (400) | tank |  | HP+Def 165 ≥ 1.15×(Atk+Spe) 130 |  |
| wailord (321) | water | fish | XL · wide | 170/90/45/90/45/60 (500) | tank |  | HP+Def 215 ≥ 1.15×(Atk+Spe) 150 |  |
| castform (351) | normal | ball | Tiny | 70/70/70/70/70/70 (420) | chase |  | Atk ≥ SpA, Spe 70 < 80 |  |
| tropius (357) | grass/flying | quadruped | Large · wide | 99/68/83/72/87/51 (460) | ranged · bloom | yes | SpA 72 > Atk 68 |  |
| glalie (362) | ice | ball | Large · wide | 80/80/80/80/80/80 (480) | charger |  | Atk ≥ SpA, Spe 80 ≥ 80 |  |
| groudon (383) | ground | upright | XL · wide | 100/150/140/100/90/90 (670) | charger |  | Atk ≥ SpA, Spe 90 ≥ 80 |  |
| rayquaza (384) | dragon/flying | squiggle | XL · wide | 105/150/90/150/90/95 (680) | charger | yes | Atk ≥ SpA, Spe 95 ≥ 80 |  |
| grotle (388) | grass | quadruped | Medium | 75/89/85/55/65/36 (405) | tank |  | HP+Def 160 ≥ 1.15×(Atk+Spe) 125 |  |
| torterra (389) | grass/ground | quadruped | XL · wide | 95/109/105/75/85/56 (525) | tank |  | HP+Def 200 ≥ 1.15×(Atk+Spe) 165 |  |
| roserade (407) | grass/poison | humanoid | Medium | 60/70/65/125/105/90 (515) | ranged · bloom |  | SpA 125 > Atk 70 |  |
| honchkrow (430) | dark/flying | wings | Medium | 100/125/52/105/52/71 (505) | chase | yes | Atk ≥ SpA, Spe 71 < 80 |  |
| munchlax (446) | normal | humanoid | Small | 135/85/40/40/85/5 (390) | tank |  | HP+Def 175 ≥ 1.15×(Atk+Spe) 90 |  |
| mantyke (458) | water/flying | wings | Medium | 45/20/50/60/120/50 (345) | ranged · tide | yes | SpA 60 > Atk 20 |  |
| weavile (461) | dark/ice | upright | Medium | 70/120/65/45/85/125 (510) | charger |  | Atk ≥ SpA, Spe 125 ≥ 80 |  |
| magnezone (462) | electric/steel | arms | Large · wide | 70/70/115/130/90/60 (535) | ranged · volt |  | SpA 130 > Atk 70 |  |
| togekiss (468) | fairy/flying | wings | Large · wide | 85/50/95/120/115/80 (545) | ranged · fae | yes | SpA 120 > Atk 50 |  |
| porygon-z (474) | normal | arms | Medium | 85/80/70/135/75/90 (535) | ranged · plain |  | SpA 135 > Atk 80 |  |
| froslass (478) | ice/ghost | arms | Large · wide | 70/80/70/80/70/110 (480) | charger | yes | Atk ≥ SpA, Spe 110 ≥ 80 |  |
| rotom (479) | electric/ghost | ball | Tiny | 50/50/77/95/77/91 (440) | ranged · volt | yes | SpA 95 > Atk 50 |  |
| palkia (484) | water/dragon | upright | XL · wide | 90/120/100/150/120/100 (680) | ranged · tide |  | SpA 150 > Atk 120 |  |
| giratina (487) | ghost/dragon | tentacles | XL · wide | 150/100/120/100/120/90 (680) | tank | yes | HP+Def 270 ≥ 1.15×(Atk+Spe) 190 |  |
| dwebble (557) | bug/rock | armor | Tiny | 50/65/85/35/35/55 (325) | chase |  | Atk ≥ SpA, Spe 55 < 80 |  |
| crustle (558) | bug/rock | armor | Large · wide | 70/105/125/65/75/45 (485) | tank |  | HP+Def 195 ≥ 1.15×(Atk+Spe) 150 | no sprite folder |
| foongus (590) | grass/poison | arms | Tiny | 69/55/45/55/55/15 (294) | tank |  | HP+Def 114 ≥ 1.15×(Atk+Spe) 70 |  |
| amoonguss (591) | grass/poison | arms | Small | 114/85/70/85/80/30 (464) | tank |  | HP+Def 184 ≥ 1.15×(Atk+Spe) 115 | no sprite folder |
| galvantula (596) | bug/electric | armor | Medium | 70/77/60/97/60/108 (472) | ranged · hive |  | SpA 97 > Atk 77 |  |
| tynamo (602) | electric | fish | Tiny | 35/55/40/45/40/60 (275) | swarm | yes | flyer, tiny ≤ medium, BST 275 ≤ 300 |  |
| eelektrik (603) | electric | fish | Small | 65/85/70/75/70/40 (405) | chase | yes | Atk ≥ SpA, Spe 40 < 80 |  |
| eelektross (604) | electric | fish | Medium | 85/115/80/105/80/50 (515) | chase | yes | Atk ≥ SpA, Spe 50 < 80 |  |
| lampent (608) | ghost/fire | arms | Small | 60/40/60/95/60/55 (370) | ranged · wisp | yes | SpA 95 > Atk 40 |  |
| chandelure (609) | ghost/fire | arms | Medium | 60/55/90/145/90/80 (520) | ranged · wisp | yes | SpA 145 > Atk 55 |  |
| mienfoo (619) | fighting | upright | Medium | 45/85/50/55/50/65 (350) | chase |  | Atk ≥ SpA, Spe 65 < 80 |  |
| mienshao (620) | fighting | upright | Large · wide | 65/125/60/95/60/105 (510) | charger |  | Atk ≥ SpA, Spe 105 ≥ 80 |  |
| flabebe (669) | fairy | arms | Tiny | 44/38/39/61/79/42 (303) | ranged · fae |  | SpA 61 > Atk 38 |  |
| floette (670) | fairy | arms | Tiny | 54/45/47/75/98/52 (371) | ranged · fae |  | SpA 75 > Atk 45 |  |
| florges (671) | fairy | arms | Medium | 78/65/68/112/154/75 (552) | ranged · fae |  | SpA 112 > Atk 65 |  |
| doublade (680) | steel/ghost | heads | Medium | 59/110/150/45/49/35 (448) | tank | yes | HP+Def 209 ≥ 1.15×(Atk+Spe) 145 |  |
| aegislash (681) | steel/ghost | blob | Large · wide | 60/50/140/50/140/60 (500) | tank |  | HP+Def 200 ≥ 1.15×(Atk+Spe) 110 |  |
| inkay (686) | dark/psychic | tentacles | Small | 53/54/53/37/46/45 (288) | chase |  | Atk ≥ SpA, Spe 45 < 80 |  |
| malamar (687) | dark/psychic | blob | Large · wide | 86/92/88/68/75/73 (482) | chase |  | Atk ≥ SpA, Spe 73 < 80 |  |
| carbink (703) | rock/fairy | ball | Tiny | 50/50/150/50/150/50 (500) | tank |  | HP+Def 200 ≥ 1.15×(Atk+Spe) 100 |  |
| klefki (707) | steel/fairy | ball | Tiny | 57/80/91/80/87/75 (470) | chase |  | Atk ≥ SpA, Spe 75 < 80 |  |
| avalugg (713) | ice | quadruped | Large · wide | 95/117/184/44/46/28 (514) | tank |  | HP+Def 279 ≥ 1.15×(Atk+Spe) 145 |  |
| noivern (715) | flying/dragon | wings | Large · wide | 85/70/80/97/80/123 (535) | ranged · gale | yes | SpA 97 > Atk 70 |  |
| xerneas (716) | fairy | quadruped | XL · wide | 126/131/95/131/98/99 (680) | charger |  | Atk ≥ SpA, Spe 99 ≥ 80 |  |
| yveltal (717) | dark/flying | wings | XL · wide | 126/131/95/131/98/99 (680) | charger | yes | Atk ≥ SpA, Spe 99 ≥ 80 |  |
| hoopa (720) | psychic/ghost | arms | Small | 80/110/60/150/130/70 (600) | ranged · mind | yes | SpA 150 > Atk 110 |  |
| ribombee (743) | bug/fairy | bug-wings | Tiny | 60/55/60/95/70/124 (464) | healer | yes | ally-heal pollen-puff, BST 464 < 500 |  |
| wishiwashi (746) | water | fish | Tiny | 45/20/20/25/25/40 (175) | ranged · tide |  | SpA 25 > Atk 20 |  |
| comfey (764) | fairy | ball | Tiny | 51/52/90/82/110/100 (485) | healer |  | ally-heal floral-healing, BST 485 < 500 |  |
| minior (774) | rock/flying | ball | Tiny | 60/60/100/60/100/60 (440) | tank | yes | HP+Def 160 ≥ 1.15×(Atk+Spe) 120 |  |
| dhelmise (781) | ghost/grass | blob | XL · wide | 70/131/100/86/90/40 (517) | chase |  | Atk ≥ SpA, Spe 40 < 80 |  |
| cosmog (789) | psychic | ball | Tiny | 43/29/31/29/31/37 (200) | chase |  | Atk ≥ SpA, Spe 37 < 80 |  |
| cosmoem (790) | psychic | ball | Tiny | 43/29/131/29/131/37 (400) | tank |  | HP+Def 174 ≥ 1.15×(Atk+Spe) 66 |  |
| solgaleo (791) | psychic/steel | quadruped | XL · wide | 137/137/107/113/89/97 (680) | charger |  | Atk ≥ SpA, Spe 97 ≥ 80 |  |
| lunala (792) | psychic/ghost | wings | XL · wide | 137/113/89/137/107/97 (680) | ranged · mind |  | SpA 137 > Atk 113 |  |
| buzzwole (794) | bug/fighting | tentacles | XL · wide | 107/139/139/53/53/79 (570) | chase |  | Atk ≥ SpA, Spe 79 < 80 |  |
| celesteela (797) | steel/flying | humanoid | XL · wide | 97/101/103/107/101/61 (570) | ranged · alloy | yes | SpA 107 > Atk 101 |  |
| kartana (798) | grass/steel | humanoid | Tiny | 59/181/131/59/31/109 (570) | charger |  | Atk ≥ SpA, Spe 109 ≥ 80 |  |
| guzzlord (799) | dark/dragon | upright | XL · wide | 223/101/53/97/53/43 (570) | tank |  | HP+Def 276 ≥ 1.15×(Atk+Spe) 144 |  |
| stakataka (805) | rock/steel | quadruped | XL · wide | 61/131/211/53/101/13 (570) | tank |  | HP+Def 272 ≥ 1.15×(Atk+Spe) 144 |  |
| meltan (808) | steel | ball | Tiny | 46/65/65/55/35/34 (300) | chase |  | Atk ≥ SpA, Spe 34 < 80 | no playable cry (latest ÿûÄ, legacy absent) |
| melmetal (809) | steel | humanoid | XL · wide | 135/143/143/80/65/34 (600) | tank |  | HP+Def 278 ≥ 1.15×(Atk+Spe) 177 | no playable cry (latest ÿûÄ, legacy absent) |
| grookey (810) | grass | upright | Tiny | 50/65/50/40/40/65 (310) | chase |  | Atk ≥ SpA, Spe 65 < 80 |  |
| thwackey (811) | grass | upright | Medium | 70/85/70/55/60/80 (420) | charger |  | Atk ≥ SpA, Spe 80 ≥ 80 |  |
| rillaboom (812) | grass | humanoid | XL · wide | 100/125/90/60/70/85 (530) | charger |  | Atk ≥ SpA, Spe 85 ≥ 80 |  |
| scorbunny (813) | fire | upright | Tiny | 50/71/40/40/40/69 (310) | chase |  | Atk ≥ SpA, Spe 69 < 80 |  |
| raboot (814) | fire | upright | Small | 65/86/60/55/60/94 (420) | charger |  | Atk ≥ SpA, Spe 94 ≥ 80 |  |
| cinderace (815) | fire | upright | Large · wide | 80/116/75/65/75/119 (530) | charger |  | Atk ≥ SpA, Spe 119 ≥ 80 |  |
| sobble (816) | water | quadruped | Tiny | 50/40/40/70/40/70 (310) | ranged · tide |  | SpA 70 > Atk 40 |  |
| drizzile (817) | water | upright | Medium | 65/60/55/95/55/90 (420) | ranged · tide |  | SpA 95 > Atk 60 |  |
| inteleon (818) | water | upright | Large · wide | 70/85/65/125/65/120 (530) | ranged · tide |  | SpA 125 > Atk 85 |  |
| rookidee (821) | flying | wings | Tiny | 38/47/35/33/35/57 (245) | swarm | yes | flyer, tiny ≤ medium, BST 245 ≤ 300 |  |
| corvisquire (822) | flying | wings | Medium | 68/67/55/43/55/77 (365) | chase | yes | Atk ≥ SpA, Spe 77 < 80 |  |
| corviknight (823) | flying/steel | wings | XL · wide | 98/87/105/53/85/67 (495) | tank | yes | HP+Def 203 ≥ 1.15×(Atk+Spe) 154 |  |
| carkol (838) | rock/fire | legs | Medium | 80/60/90/60/70/50 (410) | tank |  | HP+Def 170 ≥ 1.15×(Atk+Spe) 110 | no sprite folder |
| coalossal (839) | rock/fire | humanoid | XL · wide | 110/80/120/80/90/30 (510) | tank |  | HP+Def 230 ≥ 1.15×(Atk+Spe) 110 | no sprite folder |
| applin (840) | grass/dragon | squiggle | Tiny | 40/40/80/40/40/20 (260) | tank |  | HP+Def 120 ≥ 1.15×(Atk+Spe) 60 |  |
| flapple (841) | grass/dragon | wings | Tiny | 70/110/80/95/60/70 (485) | chase |  | Atk ≥ SpA, Spe 70 < 80 |  |
| appletun (842) | grass/dragon | quadruped | Small | 110/85/80/100/80/30 (485) | ranged · bloom |  | SpA 100 > Atk 85 |  |
| sandaconda (844) | ground | squiggle | Large · wide | 72/107/125/65/70/71 (510) | chase |  | Atk ≥ SpA, Spe 71 < 80 |  |
| toxel (848) | electric/poison | upright | Small | 40/38/35/54/35/40 (242) | ranged · volt |  | SpA 54 > Atk 38 |  |
| toxtricity (849) | electric/poison | upright | Large · wide | 75/98/70/114/70/75 (502) | ranged · volt |  | SpA 114 > Atk 98 |  |
| centiskorch (851) | fire/bug | tentacles | XL · wide | 100/115/65/90/90/65 (525) | chase |  | Atk ≥ SpA, Spe 65 < 80 |  |
| clobbopus (852) | fighting | tentacles | Small | 50/68/60/50/50/32 (310) | chase |  | Atk ≥ SpA, Spe 32 < 80 |  |
| grapploct (853) | fighting | tentacles | Large · wide | 80/118/90/70/80/42 (480) | chase |  | Atk ≥ SpA, Spe 42 < 80 |  |
| sinistea (854) | ghost | ball | Tiny | 40/45/45/74/54/50 (308) | ranged · wisp | yes | SpA 74 > Atk 45 |  |
| polteageist (855) | ghost | ball | Tiny | 60/65/65/134/114/70 (508) | ranged · wisp | yes | SpA 134 > Atk 65 |  |
| hatenna (856) | psychic | legs | Small | 42/30/45/56/53/39 (265) | healer |  | ally-heal heal-pulse/life-dew, BST 265 < 500 |  |
| hattrem (857) | psychic | humanoid | Small | 57/40/65/86/73/49 (370) | healer |  | ally-heal heal-pulse/life-dew, BST 370 < 500 |  |
| hatterene (858) | psychic/fairy | blob | XL · wide | 57/90/95/136/103/29 (510) | ranged · mind |  | SpA 136 > Atk 90 |  |
| morgrem (860) | dark/fairy | humanoid | Medium | 65/60/45/75/55/70 (370) | ranged · gloom |  | SpA 75 > Atk 60 |  |
| grimmsnarl (861) | dark/fairy | humanoid | Large · wide | 95/120/65/95/75/60 (510) | chase |  | Atk ≥ SpA, Spe 60 < 80 |  |
| falinks (870) | fighting | heads | XL · wide | 65/100/100/70/60/75 (470) | chase |  | Atk ≥ SpA, Spe 75 < 80 | no sprite folder |
| frosmoth (873) | ice/bug | bug-wings | Large · wide | 70/65/60/125/90/65 (475) | ranged · frost | yes | SpA 125 > Atk 65 |  |
| morpeko (877) | electric/dark | humanoid | Tiny | 58/95/58/70/58/97 (436) | charger |  | Atk ≥ SpA, Spe 97 ≥ 80 |  |
| duraludon (884) | steel/dragon | upright | Large · wide | 70/95/115/120/50/85 (535) | ranged · alloy |  | SpA 120 > Atk 95 |  |
| drakloak (886) | dragon/ghost | arms | Large · wide | 68/80/50/60/50/102 (410) | charger | yes | Atk ≥ SpA, Spe 102 ≥ 80 |  |
| dragapult (887) | dragon/ghost | upright | XL · wide | 88/120/75/100/75/142 (600) | charger |  | Atk ≥ SpA, Spe 142 ≥ 80 |  |
| zacian (888) | fairy | quadruped | XL · wide | 92/120/115/80/115/138 (660) | charger |  | Atk ≥ SpA, Spe 138 ≥ 80 |  |
| zamazenta (889) | fighting | quadruped | XL · wide | 92/120/115/80/115/138 (660) | charger |  | Atk ≥ SpA, Spe 138 ≥ 80 |  |
| eternatus (890) | poison/dragon | wings | XL · wide | 140/85/95/145/95/130 (690) | ranged · venom |  | SpA 145 > Atk 85 |  |
| kubfu (891) | fighting | upright | Small | 60/90/60/53/50/72 (385) | chase |  | Atk ≥ SpA, Spe 72 < 80 |  |
| urshifu (892) | fighting/dark | humanoid | Large · wide | 100/130/100/63/60/97 (550) | charger |  | Atk ≥ SpA, Spe 97 ≥ 80 |  |
| calyrex (898) | psychic/grass | humanoid | Medium | 100/80/80/80/80/80 (500) | charger |  | Atk ≥ SpA, Spe 80 ≥ 80 |  |
| sneasler (903) | fighting/poison | upright | Large · wide | 80/130/60/40/80/120 (510) | charger |  | Atk ≥ SpA, Spe 120 ≥ 80 |  |
| pawmi (921) | electric | quadruped | Tiny | 45/50/20/40/25/60 (240) | chase |  | Atk ≥ SpA, Spe 60 < 80 |  |
| pawmo (922) | electric/fighting | upright | Small | 60/75/40/50/40/85 (350) | charger |  | Atk ≥ SpA, Spe 85 ≥ 80 |  |
| pawmot (923) | electric/fighting | upright | Medium | 70/115/70/70/60/105 (490) | charger |  | Atk ≥ SpA, Spe 105 ≥ 80 |  |
| shroodle (944) | poison/normal | quadruped | Tiny | 40/65/35/40/35/75 (290) | chase |  | Atk ≥ SpA, Spe 75 < 80 | no sprite folder |
| grafaiai (945) | poison/normal | upright | Medium | 63/95/65/80/72/110 (485) | charger |  | Atk ≥ SpA, Spe 110 ≥ 80 | Walk absent (import throws) |
| toedscool (948) | ground/grass | legs | Medium | 40/40/35/50/100/70 (335) | ranged · quake |  | SpA 50 > Atk 40 |  |
| toedscruel (949) | ground/grass | tentacles | Large · wide | 80/70/65/80/120/100 (515) | ranged · quake |  | SpA 80 > Atk 70 | no sprite folder |
| wiglett (960) | water | blob | Large · wide | 10/55/25/35/25/95 (245) | charger |  | Atk ≥ SpA, Spe 95 ≥ 80 |  |
| wugtrio (961) | water | blob | Large · wide | 35/100/50/50/70/120 (425) | charger |  | Atk ≥ SpA, Spe 120 ≥ 80 |  |
| orthworm (968) | steel | squiggle | Large · wide | 70/85/145/60/55/65 (480) | tank |  | HP+Def 215 ≥ 1.15×(Atk+Spe) 150 |  |
| cetitan (975) | ice | upright | XL · wide | 170/113/65/45/55/73 (521) | tank |  | HP+Def 235 ≥ 1.15×(Atk+Spe) 186 |  |
| tatsugiri (978) | dragon/water | fish | Tiny | 68/50/60/120/95/82 (475) | ranged · wyrm |  | SpA 120 > Atk 50 |  |
| dudunsparce (982) | normal | squiggle | Large · wide | 125/100/80/85/75/55 (520) | tank |  | HP+Def 205 ≥ 1.15×(Atk+Spe) 155 |  |
| slither-wing (988) | bug/fighting | quadruped | XL · wide | 85/135/79/85/105/81 (570) | charger |  | Atk ≥ SpA, Spe 81 ≥ 80 |  |
| iron-hands (992) | fighting/electric | humanoid | Large · wide | 154/140/108/50/68/50 (570) | tank |  | HP+Def 262 ≥ 1.15×(Atk+Spe) 190 |  |
| gimmighoul (999) | ghost | blob | Tiny | 45/30/70/75/70/10 (300) | ranged · wisp |  | SpA 75 > Atk 30 | no sprite folder |
| gholdengo (1000) | steel/ghost | humanoid | Large · wide | 87/60/95/133/91/84 (550) | ranged · alloy |  | SpA 133 > Atk 60 |  |
| koraidon (1007) | fighting/dragon | upright | XL · wide | 100/135/115/85/100/135 (670) | charger |  | Atk ≥ SpA, Spe 135 ≥ 80 |  |
| dipplin (1011) | grass/dragon | heads | Small | 80/80/110/95/80/40 (485) | ranged · bloom |  | SpA 95 > Atk 80 |  |
| poltchageist (1012) | grass/ghost | ball | Tiny | 40/45/45/74/54/50 (308) | healer | yes | ally-heal life-dew, BST 308 < 500 |  |
| sinistcha (1013) | grass/ghost | ball | Tiny | 71/60/106/121/80/70 (508) | ranged · bloom | yes | SpA 121 > Atk 60 |  |
| archaludon (1018) | steel/dragon | upright | Large · wide | 90/105/130/125/65/85 (600) | ranged · alloy |  | SpA 125 > Atk 105 |  |
| hydrapple (1019) | grass/dragon | heads | Large · wide | 106/80/110/120/80/44 (540) | ranged · bloom |  | SpA 120 > Atk 80 |  |
| gouging-fire (1020) | fire/dragon | quadruped | XL · wide | 105/115/121/65/93/91 (590) | charger |  | Atk ≥ SpA, Spe 91 ≥ 80 | Walk absent (import throws) |
| raging-bolt (1021) | electric/dragon | quadruped | XL · wide | 125/73/91/137/89/75 (590) | ranged · volt |  | SpA 137 > Atk 73 | Walk absent (import throws) |
| terapagos (1024) | normal | quadruped | Tiny | 90/65/85/65/85/60 (450) | tank |  | HP+Def 175 ≥ 1.15×(Atk+Spe) 125 |  |

### S2.7 Owner decisions (2026-11-18)

1. **Role rule approved**, with ranged at Sp. Atk ≥ Atk + 10. It lives in `src/rules/` with its thresholds in the rules
   defaults, and applies wherever a wild entry has no behaviour; hand roles always win.
2. **Importer:** use Idle when Walk is missing; skip and report a species with no usable art instead of throwing.
   Falinks uses the folder of its ordinary formation (not a Mega or variant). Gimmighoul and the 6 with no sprite folder
   stay catalogue-only; a later fetch picks them up when art appears.
3. **Meltan and Melmetal:** the synthesised call is accepted.
4. **A general `recruitable: false` field with a reason** in `SPECIES_OVERRIDES`, set for Eternatus pending its lens gate.
5. **The checksum layer's off setting** keeps the new species out of the spawn pools and the habitat profiles.
6. **New:** legendary and mythical species (from the catalogue flags) are excluded from `all-wild` by default and
   appear only in pools that name them.
7. Then import, commit on `size-extremes-s2`, run the gates, report, and stop before merging.

### S2.8 What was built

| Area | Change |
|---|---|
| Roster | `content/roster.json`: the 169 as `wild` entries `{ "wave": "catalogue" }`, keyed by PokéAPI Pokémon slug (`aegislash-shield`, `giratina-altered`, … 9 differ from the species slug), in dex order; `spriteFolders: { "falinks": "0003" }` |
| Role rule | `src/rules/roles.ts` (`defaultRole`, `defaultFlying`), thresholds in `rules.wildRole` (`src/rules/defaults.ts`); applied once when the roster loads (`src/rules/species.ts`), marking `roleFrom: 'rule'`. The size class comes from the new leaf module `src/rules/extent.ts` (moved out of `sizing.ts`, which re-exports it) so the roster can read a class without an import cycle |
| Importer | `scripts/import-pack.mjs`: `--sprite-folders`; no sprite folder / `AnimData.xml`, or neither Idle nor Walk, throws `NoUsableArt`, which `main` catches, skips and reports (`report.json` `skipped`); Idle-only imports with a warning; no damaging level-up move warns instead of stopping; `canon.levelUpOther` |
| Content build | `scripts/build-content.mjs`: wave entries import after the bosses (older registry indices unchanged); wild defs carry `wild: true` and `wave`; `behaviour` / `flying` only when authored (the importer's type-based `flying` only beside an authored behaviour); `canon.special` from `scripts/catalogue-pack.mjs`'s new `special` map (`pokemon_species.is_legendary` / `is_mythical`); skips printed and reported |
| Fetch | `scripts/fetch-sources.sh`: a roster key resolves through its species or the species' default variety; pinned form folders are checked out |
| Spawning | `rules.spawning.waves` (`catalogue: true`): a wave set false leaves every pool, so `spawnableSpecies` and the habitat profiles too (`waveOn`); `rules.spawning.everyWildSkips` (`legendary`, `mythical`): `everyWild` leaves those out |
| Recruiting | `SPECIES_OVERRIDES` `recruitable: false` + `recruitableReason` (`validateProfiles` requires the reason); `isRecruitable`; `recruitables` (`src/sim/objectives.ts`), the only source of Hunt targets and recruit offers, filters on it. Set for Eternatus and Stakataka (§S2.9) |
| Art | `ANIM_FALLBACKS.faint` gains `Idle@0:sink`: an Idle-only species (Gouging Fire, Grafaiai, Raging Bolt) threw `no animation available for "faint"` |
| Checksum | every older set pins `waves.catalogue: false`; new `catalogue-off`, `gen-catalogue-off`, `deck-catalogue-off`, `deck-xl`, `deck-xl-tall-off` |
| Camera fixture | `tests/fixtures/giants-frame.json` deleted; `tests/camframe.test.ts` frames the real Wailord and Eternatus |
| Tests | new `tests/roles.test.ts`; pins updated in `catalogue`, `spawning` (all-wild skips, wave off), `playability` (Cosmog, Cosmoem), `camframe` (criterion A count split, the `frame.max` check over recruitable partners); `aim3d` / `beam3d` pick their target species from the pre-wave roster (their aim heights are tuned to its bodies: the alphabetically first Medium became Azumarill, whose 1.17 m top is under the tests' 1.2 m aim) |
| Docs | `docs/SPECIES.md` (catalogue wave, default roles), `docs/SPAWNING.md`, `docs/CUSTOMISING.md` §1, `docs/PIPELINE.md`, `README.md`, `CLAUDE.md` |

### S2.9 Results

**Import.** 234 species (72 + 162), 396 moves; `src/content/art.json` 3.0 → 11.3 MB, `pokedex.ts` 127 → 329 KB.
- **Skipped (no usable art):** Crustle, Amoonguss, Carkol, Coalossal, Shroodle, Toedscruel (no sprite folder) and
  Gimmighoul (only its Roaming form has sheets).
- **Falinks: `0003` Trooper**, the one form folder the SpriteCollab tracker marks canon. Its root folder (the six-member
  formation) has no sprites; `0001` is a non-canon Mega and `0002` Brass a non-canon variant, both empty or excluded.
  The Trooper sheet draws a **single trooper** (24 × 32 px frames), while the class comes from the formation's listed
  3.0 m: Falinks is drawn as one Extra Large trooper. Owner check. **[Since §S2.12: an approved 0.5 m extent makes it Small.]**
- **Idle-only (walk on Idle):** Gouging Fire, Grafaiai, Raging Bolt. **No damaging level-up move:** Cosmog, Cosmoem.
  **Synthesised cry:** Meltan, Melmetal.
- **Legendary or mythical (`canon.special`): 23 imported** (20 legendary, 3 mythical: Hoopa, Meltan, Melmetal), so 23
  are out of `all-wild`: Lugia, Ho-Oh, Groudon, Rayquaza, Palkia, Giratina, Xerneas, Yveltal, Hoopa, Cosmog, Cosmoem,
  Solgaleo, Lunala, Meltan, Melmetal, Zacian, Zamazenta, Eternatus, Kubfu, Urshifu, Calyrex, Koraidon, Terapagos. Ultra
  Beasts (Buzzwole, Celesteela, Kartana, Guzzlord, Stakataka) and Paradox Pokémon carry neither flag and stay in it.
  Articuno is flagged too, but it is a boss, so no pool fields it as a wild spawn.

**Sizes (162 imported, current defaults).** Tiny 35, Small 20, Medium 33, Large 39, XL 35. **Wide navigation: 74 of
162 (46 %)**, every Large and XL. Sim height over 2.9 m: Eternatus 3.55, Celesteela 3.46, Wailord 3.23, Yveltal 3.02,
Guzzlord 2.97, Stakataka 2.97, Lugia 2.92, Raging Bolt 2.92.

**Roles (approved rule).** ranged 50, charger 39, chase 33, tank 32, healer 6 (Togetic, Ribombee, Comfey, Hatenna,
Hattrem, Poltchageist), swarm 2 (Tynamo, Rookidee); 39 fly; Dodrio is the one grounded Flying type.

**Partners and `frame.max`.** 158 of the 162 can join the squad: all but Cosmog and Cosmoem (no Tag Action), Eternatus
(owner) and Stakataka (below). Of the 160 with a Tag Action, **one reaches `frame.max` (14 m): Stakataka.** Its chase
arm wants more than 14 m, which criterion B refuses (`tests/camframe.test.ts`: "a future giant that needs more than it
fails here"). **I set Stakataka `recruitable: false`** with that reason rather than commit a red test or loosen the
check. One line to undo; owner call. Next longest: Eternatus 13.75 (not recruitable), Guzzlord 11.30, Gouging Fire 11.13,
Centiskorch 11.04, Groudon 10.90 m. Every other camera check (criteria A and B, E4, the move bar, both aspects) passes for
all 230 framed species. Combat frames past the 4° allowance: 21 pre-wave species and 37 of the wave (the test's count
cap is now split: ≤ 24 pre-wave, ≤ 40 wave).

**Playability grades.** Pre-wave unchanged (68 ready, 4 partial bosses). Wave: **160 ready, 2 unavailable** (Cosmog,
Cosmoem: `openingKit: no damaging move to open a run with`; `tagAction: no Tag Action`). **[Since §S2.12 both are `ready`: the basic-attack fallback.]** The grade does not read
`recruitable`, so Eternatus and Stakataka grade `ready` (they could still be picked in the `?dev=1` roster).
Per-species grades are in §S2.11.

**Moved hashes: none.** No region preset names a wave species, so `on`, `gen`, `aim`, `aim-off` and `deck` replay
exactly as before; so does every older set. The habitat profiles keep every number (trainer 0.88, wild-small 0.30,
wild-elite 1.42, boss 0.95); only the `wild-small` note's count changes (40 → 146 ground species), because `all-wild` is
among the presets `spawnableSpecies` resolves.

| New set | Replays | End hash |
|---|---|---|
| `catalogue-off` | `on`, wave off | `632d7d25` `74eccc9d` `93ae9839` `a94be2d9` (= `on`) |
| `gen-catalogue-off` | `gen`, wave off | `bc465079` `72710e43` `bd080f0c` `db985697` (= `gen`) |
| `deck-catalogue-off` | `deck`, wave off | `8e461982` (= `deck`) |
| `deck-xl` | Mt. Moon, Wailord ×6 and elite, Totodile seed 3 | `81375292` |
| `deck-xl-tall-off` | `deck-xl` with xlTall off | `5f8ea139` |

**Deck replay with a ground giant over 2.9 m (decision 4).** No default replay meets one: no region pool fields one. On
the `deck` configuration (Totodile seed 5) with Wailord, Guzzlord, Stakataka or tall Onix (axis off) in the pool, neither
the bot nor the giant ever comes near a deck: closest approach 36.3, 37.5, ≥ 20 and 22.7 m, and the bot is never within
6 m of one. **The existing `deck-tall` set had the same gap: its 0 under-deck ticks were never a refusal.** A seed sweep
(1–9) found seed 3, where Wailord spends **2409 ticks within 3 m of a deck and 0 under one**, and with xlTall off 126
under one. `deck-xl` / `deck-xl-tall-off` replay that seed: xlTall's routing is now covered by a replay that actually
reaches a deck. (Probe: under-deck ticks are the giant's ground tile under a slab with its feet below the slab top;
scratch harness, not committed.)

**Gates (branch `size-extremes-s2`, 2026-11-19).**

| Gate | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm test` | 622 tests: 616 pass, 4 fail, 2 todo. The 4 are the known pointer-lock tests (`docs/tasks/pointerlock-red-tests.md`), red on `main` too. So `npm run check` stops before its build |
| `npm run build` | pass, `dist/index.html` 25,660 KB (was 17,258 KB) |
| handoff suites (`sizing`, `navsize`, `footprint`, `headroom`, `walltops`, `playability`, `catalogue`) | 72/72 |
| `npx tsx scripts/checksum.ts` | every existing set identical; the new sets as above |
| `navwalk all 5` | 0 failures (xl arrive 291/291, xl refuse 5/5, elite 291/291, large 297/297, narrow 313/313, trainer-xl 83/83) |
| `stuckwatch all 3` | 67 bot episodes (1 pinned, **0 trapped**); 2 enemy episodes over 115,807 enemy-s: identical to the flip's run |
| `habstate` | 24/24 |
| `hazplay` | 49/49 |
| `habplay all 6 1 --raid` | 72/72 |
| `perf-sim 500 --repeat 3 --gate` | min of 3: p50 0.402, p95 0.525, p99 0.881 ms: PASS |
| habaudit | not run: the habitat profiles' numbers are unchanged, and they are the habitat generator's only input from the roster |

### S2.10 Follow-ups for the owner

- **Stakataka** (`recruitable: false`, §S2.9): undo the override, or give it a framing exception, or raise `frame.max`.
- **Falinks** draws one trooper at the formation's Extra Large size (§S2.9).
- **The dev roster:** `?dev=1` lists every graded `ready` species as playable, including Eternatus and Stakataka;
  `controlReadiness` does not read `recruitable`.
- **Bundle:** 25.7 MB, from 17.3 MB; art is 11.3 MB of it.
- **Spawn pools:** no region preset names a wave species. They play only through `all-wild` or a pool naming them.
- **The seven without art** come in on a later `npm run fetch-sources && npm run content` once SpriteCollab has them;
  update `SKIPPED` in `tests/catalogue.test.ts`.
- **F4** (hit radius beside wide sprites) was to be decided after S2.

### S2.11 The catalogue wave as imported (162 species, approved rule)

Partner back: the chase arm's back distance as a partner (`frame.max` 14 m), — when it never partners.

| species (dex) | types | class | sim height (m) | role | rule fired | playability | partner back (m) | notes |
|---|---|---|---|---|---|---|---|---|
| raticate (20) | normal | Medium | 1.13 | charger | Speed 97 ≥ 80 | ready | 4.70 |  |
| arbok (24) | poison | Large · wide | 1.76 | charger | Speed 80 ≥ 80 | ready | 6.23 |  |
| raichu (26) | electric | Medium | 1.17 | charger | Speed 110 ≥ 80 | ready | 4.68 |  |
| dugtrio (51) | ground | Medium | 1.13 | charger | Speed 120 ≥ 80 | ready | 6.21 |  |
| tentacool (72) | water/poison | Medium | 1.21 | ranged | Sp. Atk 50 ≥ Atk 40 + 10 | ready | 3.82 |  |
| tentacruel (73) | water/poison | Large · wide | 1.72 | ranged | Sp. Atk 80 ≥ Atk 70 + 10 | ready | 5.39 |  |
| magnemite (81) | electric/steel | Tiny | 0.64 | ranged | Sp. Atk 95 ≥ Atk 35 + 10 | ready | 2.10 |  |
| magneton (82) | electric/steel | Medium | 1.25 | ranged | Sp. Atk 120 ≥ Atk 60 + 10 | ready | 4.55 |  |
| dodrio (85) | normal/flying | Large · wide | 1.77 | charger | Speed 110 ≥ 80 | ready | 5.58 |  |
| exeggcute (102) | grass/psychic | Small | 0.86 | ranged | Sp. Atk 60 ≥ Atk 40 + 10 | ready | 4.23 |  |
| exeggutor (103) | grass/psychic | Large · wide | 1.82 | ranged | Sp. Atk 125 ≥ Atk 95 + 10 | ready | 5.97 |  |
| hitmonlee (106) | fighting | Large · wide | 1.69 | charger | Speed 87 ≥ 80 | ready | 6.28 |  |
| hitmonchan (107) | fighting | Large · wide | 1.66 | chase | Speed 76 < 80 | ready | 7.06 |  |
| weezing (110) | poison | Large · wide | 1.58 | tank · flies | HP + Def 185 ≥ 1.15 × 150 | ready | 5.17 |  |
| porygon (137) | normal | Medium | 1.17 | ranged | Sp. Atk 85 ≥ Atk 60 + 10 | ready | 3.99 |  |
| dratini (147) | dragon | Medium | 1.21 | chase | Speed 50 < 80 | ready | 5.57 |  |
| dragonair (148) | dragon | Large · wide | 1.82 | chase | Speed 70 < 80 | ready | 7.27 |  |
| dragonite (149) | dragon/flying | XL · wide | 2.26 | charger · flies | Speed 80 ≥ 80 | ready | 7.63 |  |
| togetic (176) | fairy/flying | Small | 0.95 | healer · flies | ally-heal life_dew, BST 405 < 500 | ready | 3.13 |  |
| natu (177) | psychic/flying | Tiny | 0.61 | ranged · flies | Sp. Atk 70 ≥ Atk 50 + 10 | ready | 2.34 |  |
| xatu (178) | psychic/flying | Large · wide | 1.69 | ranged · flies | Sp. Atk 95 ≥ Atk 75 + 10 | ready | 5.49 |  |
| marill (183) | water/fairy | Small | 0.86 | tank | HP + Def 120 ≥ 1.15 × 60 | ready | 2.52 |  |
| azumarill (184) | water/fairy | Medium | 1.17 | ranged | Sp. Atk 60 ≥ Atk 50 + 10 | ready | 4.09 |  |
| unown (201) | psychic | Small | 0.91 | chase · flies | Speed 48 < 80 | ready | 2.78 |  |
| dunsparce (206) | normal | Medium | 1.15 | tank | HP + Def 170 ≥ 1.15 × 115 | ready | 6.35 |  |
| steelix (208) | steel/ground | XL · wide | 2.81 | tank | HP + Def 275 ≥ 1.15 × 115 | ready | 9.87 |  |
| mantine (226) | water/flying | XL · wide | 2.22 | ranged · flies | Sp. Atk 80 ≥ Atk 40 + 10 | ready | 8.76 |  |
| porygon2 (233) | normal | Small | 0.95 | ranged | Sp. Atk 105 ≥ Atk 80 + 10 | ready | 3.29 |  |
| tyrogue (236) | fighting | Medium | 1.13 | chase | Speed 35 < 80 | ready | 3.93 |  |
| hitmontop (237) | fighting | Large · wide | 1.66 | chase | Speed 70 < 80 | ready | 6.26 |  |
| lugia (249) | psychic/flying | XL · wide | 2.92 | tank · flies | HP + Def 236 ≥ 1.15 × 200 | ready | 9.63 | legendary |
| ho-oh (250) | fire/flying | XL · wide | 2.66 | charger · flies | Speed 90 ≥ 80 | ready | 7.94 | legendary |
| nincada (290) | bug/ground | Small | 0.91 | tank | HP + Def 121 ≥ 1.15 × 85 | ready | 3.96 |  |
| ninjask (291) | bug/flying | Medium | 1.17 | charger · flies | Speed 160 ≥ 80 | ready | 4.14 |  |
| shedinja (292) | bug/ghost | Medium | 1.17 | chase | Speed 40 < 80 | ready | 3.48 |  |
| azurill (298) | normal/fairy | Tiny | 0.61 | tank | HP + Def 90 ≥ 1.15 × 40 | ready | 2.80 |  |
| roselia (315) | grass/poison | Tiny | 0.64 | ranged | Sp. Atk 100 ≥ Atk 60 + 10 | ready | 2.03 |  |
| wailmer (320) | water | Medium | 1.25 | tank | HP + Def 165 ≥ 1.15 × 130 | ready | 3.81 |  |
| wailord (321) | water | XL · wide | 3.23 | tank | HP + Def 215 ≥ 1.15 × 150 | ready | 10.76 |  |
| castform (351) | normal | Tiny | 0.64 | chase | Speed 70 < 80 | ready | 2.03 |  |
| tropius (357) | grass/flying | Large · wide | 1.82 | tank · flies | HP + Def 182 ≥ 1.15 × 123 | ready | 9.12 |  |
| glalie (362) | ice | Large · wide | 1.69 | charger | Speed 80 ≥ 80 | ready | 5.44 |  |
| groudon (383) | ground | XL · wide | 2.59 | charger | Speed 90 ≥ 80 | ready | 10.90 | legendary |
| rayquaza (384) | dragon/flying | XL · wide | 2.59 | charger · flies | Speed 95 ≥ 80 | ready | 8.69 | legendary |
| grotle (388) | grass | Medium | 1.28 | tank | HP + Def 160 ≥ 1.15 × 125 | ready | 4.53 |  |
| torterra (389) | grass/ground | XL · wide | 2.26 | tank | HP + Def 200 ≥ 1.15 × 165 | ready | 9.30 |  |
| roserade (407) | grass/poison | Medium | 1.21 | ranged | Sp. Atk 125 ≥ Atk 70 + 10 | ready | 3.95 |  |
| honchkrow (430) | dark/flying | Medium | 1.21 | chase · flies | Speed 71 < 80 | ready | 4.78 |  |
| munchlax (446) | normal | Small | 0.95 | tank | HP + Def 175 ≥ 1.15 × 90 | ready | 2.78 |  |
| mantyke (458) | water/flying | Medium | 1.25 | ranged · flies | Sp. Atk 60 ≥ Atk 20 + 10 | ready | 5.10 |  |
| weavile (461) | dark/ice | Medium | 1.28 | charger | Speed 125 ≥ 80 | ready | 3.92 |  |
| magnezone (462) | electric/steel | Large · wide | 1.58 | ranged | Sp. Atk 130 ≥ Atk 70 + 10 | ready | 4.80 |  |
| togekiss (468) | fairy/flying | Large · wide | 1.69 | ranged · flies | Sp. Atk 120 ≥ Atk 50 + 10 | ready | 5.58 |  |
| porygon-z (474) | normal | Medium | 1.21 | ranged | Sp. Atk 135 ≥ Atk 80 + 10 | ready | 3.76 |  |
| froslass (478) | ice/ghost | Large · wide | 1.62 | charger · flies | Speed 110 ≥ 80 | ready | 5.18 |  |
| rotom (479) | electric/ghost | Tiny | 0.64 | ranged · flies | Sp. Atk 95 ≥ Atk 50 + 10 | ready | 2.24 |  |
| palkia (484) | water/dragon | XL · wide | 2.74 | ranged | Sp. Atk 150 ≥ Atk 120 + 10 | ready | 9.98 | legendary |
| giratina-altered (487) | ghost/dragon | XL · wide | 2.80 | tank · flies | HP + Def 270 ≥ 1.15 × 190 | ready | 10.54 | legendary |
| dwebble (557) | bug/rock | Tiny | 0.64 | chase | Speed 55 < 80 | ready | 2.80 |  |
| foongus (590) | grass/poison | Tiny | 0.61 | tank | HP + Def 114 ≥ 1.15 × 70 | ready | 2.05 |  |
| galvantula (596) | bug/electric | Medium | 1.17 | ranged | Sp. Atk 97 ≥ Atk 77 + 10 | ready | 5.06 |  |
| tynamo (602) | electric | Tiny | 0.55 | swarm · flies | flyer, tiny, BST 275 ≤ 300 | ready | 1.80 |  |
| eelektrik (603) | electric | Small | 0.95 | chase · flies | Speed 40 < 80 | ready | 4.51 |  |
| eelektross (604) | electric | Medium | 1.27 | chase · flies | Speed 50 < 80 | ready | 4.90 |  |
| lampent (608) | ghost/fire | Small | 0.95 | ranged · flies | Sp. Atk 95 ≥ Atk 40 + 10 | ready | 3.52 |  |
| chandelure (609) | ghost/fire | Medium | 1.25 | ranged · flies | Sp. Atk 145 ≥ Atk 55 + 10 | ready | 4.42 |  |
| mienfoo (619) | fighting | Medium | 1.21 | chase | Speed 65 < 80 | ready | 4.62 |  |
| mienshao (620) | fighting | Large · wide | 1.66 | charger | Speed 105 ≥ 80 | ready | 5.70 |  |
| flabebe (669) | fairy | Tiny | 0.55 | ranged | Sp. Atk 61 ≥ Atk 38 + 10 | ready | 1.80 |  |
| floette (670) | fairy | Tiny | 0.61 | ranged | Sp. Atk 75 ≥ Atk 45 + 10 | ready | 1.83 |  |
| florges (671) | fairy | Medium | 1.28 | ranged | Sp. Atk 112 ≥ Atk 65 + 10 | ready | 3.92 |  |
| doublade (680) | steel/ghost | Medium | 1.17 | tank · flies | HP + Def 209 ≥ 1.15 × 145 | ready | 4.35 |  |
| aegislash-shield (681) | steel/ghost | Large · wide | 1.75 | tank | HP + Def 200 ≥ 1.15 × 110 | ready | 5.11 |  |
| inkay (686) | dark/psychic | Small | 0.86 | chase | Speed 45 < 80 | ready | 2.41 |  |
| malamar (687) | dark/psychic | Large · wide | 1.69 | chase | Speed 73 < 80 | ready | 5.55 |  |
| carbink (703) | rock/fairy | Tiny | 0.64 | tank | HP + Def 200 ≥ 1.15 × 100 | ready | 2.27 |  |
| klefki (707) | steel/fairy | Tiny | 0.61 | chase | Speed 75 < 80 | ready | 2.08 |  |
| avalugg (713) | ice | Large · wide | 1.82 | tank | HP + Def 279 ≥ 1.15 × 145 | ready | 6.99 |  |
| noivern (715) | flying/dragon | Large · wide | 1.69 | ranged · flies | Sp. Atk 97 ≥ Atk 70 + 10 | ready | 6.01 |  |
| xerneas (716) | fairy | XL · wide | 2.48 | charger | Speed 99 ≥ 80 | ready | 7.56 | legendary |
| yveltal (717) | dark/flying | XL · wide | 3.02 | charger · flies | Speed 99 ≥ 80 | ready | 10.69 | legendary |
| hoopa (720) | psychic/ghost | Small | 0.91 | ranged · flies | Sp. Atk 150 ≥ Atk 110 + 10 | ready | 2.99 | mythical |
| ribombee (743) | bug/fairy | Tiny | 0.61 | healer · flies | ally-heal pollen_puff, BST 464 < 500 | ready | 1.80 |  |
| wishiwashi-solo (746) | water | Tiny | 0.55 | chase | Speed 40 < 80 | ready | 1.80 |  |
| comfey (764) | fairy | Tiny | 0.55 | healer | ally-heal floral_healing, BST 485 < 500 | ready | 1.80 |  |
| minior-red-meteor (774) | rock/flying | Tiny | 0.64 | tank · flies | HP + Def 160 ≥ 1.15 × 120 | ready | 2.08 |  |
| dhelmise (781) | ghost/grass | XL · wide | 2.68 | chase | Speed 40 < 80 | ready | 7.40 |  |
| cosmog (789) | psychic | Tiny | 0.61 | chase | Speed 37 < 80 | unavailable: no damaging move to open a run with; no Tag Action (tagging it in fires nothing) | — | no damaging level-up move: no starting move; legendary |
| cosmoem (790) | psychic | Tiny | 0.55 | tank | HP + Def 174 ≥ 1.15 × 66 | unavailable: no damaging move to open a run with; no Tag Action (tagging it in fires nothing) | — | no damaging level-up move: no starting move; legendary |
| solgaleo (791) | psychic/steel | XL · wide | 2.57 | charger | Speed 97 ≥ 80 | ready | 8.02 | legendary |
| lunala (792) | psychic/ghost | XL · wide | 2.70 | ranged | Sp. Atk 137 ≥ Atk 113 + 10 | ready | 9.14 | legendary |
| buzzwole (794) | bug/fighting | XL · wide | 2.31 | chase | Speed 79 < 80 | ready | 8.15 |  |
| celesteela (797) | steel/flying | XL · wide | 3.46 | tank · flies | HP + Def 200 ≥ 1.15 × 168 | ready | 10.33 |  |
| kartana (798) | grass/steel | Tiny | 0.64 | charger | Speed 109 ≥ 80 | ready | 1.80 |  |
| guzzlord (799) | dark/dragon | XL · wide | 2.97 | tank | HP + Def 276 ≥ 1.15 × 144 | ready | 11.30 |  |
| stakataka (805) | rock/steel | XL · wide | 2.97 | tank | HP + Def 272 ≥ 1.15 × 144 | ready | — | not recruitable |
| meltan (808) | steel | Tiny | 0.61 | chase | Speed 34 < 80 | ready | 2.16 | cry missing or not an OGG/WAV file; the game will synthesise a call; mythical |
| melmetal (809) | steel | XL · wide | 2.34 | tank | HP + Def 278 ≥ 1.15 × 177 | ready | 6.95 | cry missing or not an OGG/WAV file; the game will synthesise a call; mythical |
| grookey (810) | grass | Tiny | 0.64 | chase | Speed 65 < 80 | ready | 2.24 |  |
| thwackey (811) | grass | Medium | 1.13 | charger | Speed 80 ≥ 80 | ready | 3.70 |  |
| rillaboom (812) | grass | XL · wide | 2.22 | charger | Speed 85 ≥ 80 | ready | 6.61 |  |
| scorbunny (813) | fire | Tiny | 0.64 | chase | Speed 69 < 80 | ready | 2.16 |  |
| raboot (814) | fire | Small | 0.95 | charger | Speed 94 ≥ 80 | ready | 3.06 |  |
| cinderace (815) | fire | Large · wide | 1.66 | charger | Speed 119 ≥ 80 | ready | 5.18 |  |
| sobble (816) | water | Tiny | 0.64 | ranged | Sp. Atk 70 ≥ Atk 40 + 10 | ready | 2.52 |  |
| drizzile (817) | water | Medium | 1.13 | ranged | Sp. Atk 95 ≥ Atk 60 + 10 | ready | 3.98 |  |
| inteleon (818) | water | Large · wide | 1.80 | ranged | Sp. Atk 125 ≥ Atk 85 + 10 | ready | 5.61 |  |
| rookidee (821) | flying | Tiny | 0.61 | swarm · flies | flyer, tiny, BST 245 ≤ 300 | ready | 3.06 |  |
| corvisquire (822) | flying | Medium | 1.17 | chase · flies | Speed 77 < 80 | ready | 5.00 |  |
| corviknight (823) | flying/steel | XL · wide | 2.26 | tank · flies | HP + Def 203 ≥ 1.15 × 154 | ready | 9.30 |  |
| applin (840) | grass/dragon | Tiny | 0.55 | tank | HP + Def 120 ≥ 1.15 × 60 | ready | 2.33 |  |
| flapple (841) | grass/dragon | Tiny | 0.64 | chase | Speed 70 < 80 | ready | 1.87 |  |
| appletun (842) | grass/dragon | Small | 0.86 | ranged | Sp. Atk 100 ≥ Atk 85 + 10 | ready | 3.12 |  |
| sandaconda (844) | ground | Large · wide | 1.80 | chase | Speed 71 < 80 | ready | 7.40 |  |
| toxel (848) | electric/poison | Small | 0.86 | ranged | Sp. Atk 54 ≥ Atk 38 + 10 | ready | 2.65 |  |
| toxtricity-amped (849) | electric/poison | Large · wide | 1.72 | ranged | Sp. Atk 114 ≥ Atk 98 + 10 | ready | 5.27 |  |
| centiskorch (851) | fire/bug | XL · wide | 2.48 | chase | Speed 65 < 80 | ready | 11.04 |  |
| clobbopus (852) | fighting | Small | 0.95 | chase | Speed 32 < 80 | ready | 4.44 |  |
| grapploct (853) | fighting | Large · wide | 1.72 | chase | Speed 42 < 80 | ready | 6.11 |  |
| sinistea (854) | ghost | Tiny | 0.55 | ranged · flies | Sp. Atk 74 ≥ Atk 45 + 10 | ready | 1.80 |  |
| polteageist (855) | ghost | Tiny | 0.61 | ranged · flies | Sp. Atk 134 ≥ Atk 65 + 10 | ready | 2.04 |  |
| hatenna (856) | psychic | Small | 0.86 | healer | ally-heal heal_pulse/life_dew, BST 265 < 500 | ready | 3.33 |  |
| hattrem (857) | psychic | Small | 0.95 | healer | ally-heal heal_pulse/life_dew, BST 370 < 500 | ready | 3.31 |  |
| hatterene (858) | psychic/fairy | XL · wide | 2.22 | ranged | Sp. Atk 136 ≥ Atk 90 + 10 | ready | 6.70 |  |
| morgrem (860) | dark/fairy | Medium | 1.17 | ranged | Sp. Atk 75 ≥ Atk 60 + 10 | ready | 4.14 |  |
| grimmsnarl (861) | dark/fairy | Large · wide | 1.69 | chase | Speed 60 < 80 | ready | 5.55 |  |
| falinks (870) | fighting | XL · wide | 2.48 | chase | Speed 75 < 80 | ready | 9.66 |  |
| frosmoth (873) | ice/bug | Large · wide | 1.62 | ranged · flies | Sp. Atk 125 ≥ Atk 65 + 10 | ready | 5.18 |  |
| morpeko-full-belly (877) | electric/dark | Tiny | 0.64 | charger | Speed 97 ≥ 80 | ready | 2.15 |  |
| duraludon (884) | steel/dragon | Large · wide | 1.77 | ranged | Sp. Atk 120 ≥ Atk 95 + 10 | ready | 5.88 |  |
| drakloak (886) | dragon/ghost | Large · wide | 1.66 | charger · flies | Speed 102 ≥ 80 | ready | 5.47 |  |
| dragapult (887) | dragon/ghost | XL · wide | 2.48 | charger | Speed 142 ≥ 80 | ready | 8.49 |  |
| zacian (888) | fairy | XL · wide | 2.42 | charger | Speed 138 ≥ 80 | ready | 7.56 | legendary |
| zamazenta (889) | fighting | XL · wide | 2.45 | charger | Speed 138 ≥ 80 | ready | 7.64 | legendary |
| eternatus (890) | poison/dragon | XL · wide | 3.55 | ranged | Sp. Atk 145 ≥ Atk 85 + 10 | ready | — | legendary; not recruitable |
| kubfu (891) | fighting | Small | 0.95 | chase | Speed 72 < 80 | ready | 3.20 | legendary |
| urshifu-single-strike (892) | fighting/dark | Large · wide | 1.80 | charger | Speed 97 ≥ 80 | ready | 6.09 | legendary |
| calyrex (898) | psychic/grass | Medium | 1.28 | charger | Speed 80 ≥ 80 | ready | 3.75 | legendary |
| sneasler (903) | fighting/poison | Large · wide | 1.62 | charger | Speed 120 ≥ 80 | ready | 5.03 |  |
| pawmi (921) | electric | Tiny | 0.64 | chase | Speed 60 < 80 | ready | 3.85 |  |
| pawmo (922) | electric/fighting | Small | 0.86 | charger | Speed 85 ≥ 80 | ready | 2.98 |  |
| pawmot (923) | electric/fighting | Medium | 1.21 | charger | Speed 105 ≥ 80 | ready | 4.26 |  |
| grafaiai (945) | poison/normal | Medium | 1.13 | charger | Speed 110 ≥ 80 | ready | 3.59 | no Walk animation: the game walks on Idle |
| toedscool (948) | ground/grass | Medium | 1.21 | ranged | Sp. Atk 50 ≥ Atk 40 + 10 | ready | 3.51 |  |
| wiglett (960) | water | Large · wide | 1.58 | charger | Speed 95 ≥ 80 | ready | 6.88 |  |
| wugtrio (961) | water | Large · wide | 1.58 | charger | Speed 120 ≥ 80 | ready | 5.03 |  |
| orthworm (968) | steel | Large · wide | 1.60 | tank | HP + Def 215 ≥ 1.15 × 150 | ready | 7.38 |  |
| cetitan (975) | ice | XL · wide | 2.80 | tank | HP + Def 235 ≥ 1.15 × 186 | ready | 8.76 |  |
| tatsugiri-curly (978) | dragon/water | Tiny | 0.58 | ranged | Sp. Atk 120 ≥ Atk 50 + 10 | ready | 2.25 |  |
| dudunsparce-two-segment (982) | normal | Large · wide | 1.77 | tank | HP + Def 205 ≥ 1.15 × 155 | ready | 7.03 |  |
| slither-wing (988) | bug/fighting | XL · wide | 2.52 | charger | Speed 81 ≥ 80 | ready | 8.00 |  |
| iron-hands (992) | fighting/electric | Large · wide | 1.77 | tank | HP + Def 262 ≥ 1.15 × 190 | ready | 5.89 |  |
| gholdengo (1000) | steel/ghost | Large · wide | 1.58 | ranged | Sp. Atk 133 ≥ Atk 60 + 10 | ready | 5.17 |  |
| koraidon (1007) | fighting/dragon | XL · wide | 2.34 | charger | Speed 135 ≥ 80 | ready | 8.21 | legendary |
| dipplin (1011) | grass/dragon | Small | 0.86 | ranged | Sp. Atk 95 ≥ Atk 80 + 10 | ready | 2.89 |  |
| poltchageist (1012) | grass/ghost | Tiny | 0.55 | healer · flies | ally-heal life_dew, BST 308 < 500 | ready | 1.97 |  |
| sinistcha (1013) | grass/ghost | Tiny | 0.61 | ranged · flies | Sp. Atk 121 ≥ Atk 60 + 10 | ready | 1.80 |  |
| archaludon (1018) | steel/dragon | Large · wide | 1.82 | ranged | Sp. Atk 125 ≥ Atk 105 + 10 | ready | 5.87 |  |
| hydrapple (1019) | grass/dragon | Large · wide | 1.77 | ranged | Sp. Atk 120 ≥ Atk 80 + 10 | ready | 6.26 |  |
| gouging-fire (1020) | fire/dragon | XL · wide | 2.59 | charger | Speed 91 ≥ 80 | ready | 11.13 | no Walk animation: the game walks on Idle |
| raging-bolt (1021) | electric/dragon | XL · wide | 2.92 | ranged | Sp. Atk 137 ≥ Atk 73 + 10 | ready | 8.05 | no Walk animation: the game walks on Idle |
| terapagos (1024) | normal | Tiny | 0.61 | tank | HP + Def 175 ≥ 1.15 × 125 | ready | 2.40 | legendary |

### S2.12 Owner decisions on §S2.10 (2026-11-19) and what changed

| Decision | Change |
|---|---|
| Stakataka stays `recruitable: false` | unchanged; tracked in the follow-up below |
| Falinks: an approved `NEUTRAL_CORE_EXTENT_M` entry of 0.5 m (one trooper; the listed 3.0 m measures the six-trooper formation), recorded as reviewed | `src/rules/extent.ts`: `falinks: { m: 0.5, axis: 'height', basis: … }`. **Falinks is now Small** (was Extra Large): drawn 0.99 m, radius 0.43, height 0.91 m, off the wide field. `tests/sizing.test.ts` pins the table to reviewed entries with a basis |
| A species with no damaging level-up move gets a basic attack as its opening move and Tag Action | `rules.moves.fallbackAttack: 'tackle'`, read by `firstAttacks` (`src/sim/progression.ts`) and `tagLineOf` (`src/rules/tags.ts`). **Cosmog and Cosmoem grade `ready`**, open with Tackle and tag in with it; they can now be recruited (Hunt) wherever a pool fields them |
| `?dev=1` lists non-recruitable species with their reason | `unrecruitableReason` (`src/rules/profiles.ts`); the developer roster card shows "Wild only: …" beside the grade reasons (`src/ui/ui.ts`) |
| Build size is the blocker for the remaining species; propose a separate stage for sprite loading | below; no implementation |

**Why Tackle.** It is already a move row (Bulbasaur, Squirtle and others learn it), Normal type, physical, 40 power, no
side effect, and it is the attack most Pokémon learn first in the main games. The main games' own "no move left" attack
is Struggle, but it has no row: it would need a typeless element and recoil, which the move system does not model.
Tackle needs no new mechanics. `tests/playability.test.ts` asserts the fallback is a damaging row.

No replay hash moves: no region pool fields Falinks, Cosmog or Cosmoem.

### Follow-up: giant partners and the camera

One item for the camera session, covering the two partners held out by the chase framing:

- **Stakataka** (`recruitable: false`): as a partner the framing law asks for a back distance past `frame.max` (14 m),
  which criterion B refuses (`tests/camframe.test.ts` asserts it is the only species held at the cap).
- **Eternatus** (`recruitable: false`): the lens regression at its 13.75 m back distance ("F3 done": clear share
  87.6 → 83.3 % forward, 78.1 → 73.3 % reverse; lens pops reverse 19.2 → 32.6 /min, strafe-right 43.0 → 52.1 /min;
  holdout hard pull-ins 4.8 → 11.9 %). `docs/THIRD_PERSON_IMPLEMENTATION.md` §25.8 has the candidate ("a shorter arm for
  Large and Extra Large near rock"), with Furret's strafe-right jumps (25.7 → 35.7 /min, not a blocker).
- **Done when:** both pass criterion B at the normal limits and the lens audit is accepted or re-accepted; then delete
  their `recruitable: false` overrides and the `['stakataka']` pin in `tests/camframe.test.ts`.

### Blocker for the remaining species: the build size

The single-file build grew from 17.3 MB to **25.7 MB** with this wave (`dist/index.html`). The art bundle
(`src/content/art.json`, 11.3 MB for 234 species) is imported by `src/main.ts`, inlined into the page as base64, and
every atlas is decoded at boot (`renderer.loadArt`). Its make-up: cries 4.5 MB (40 %), portraits 0.5 MB, atlases and
frame tables the rest; a median species is 45 KB, the largest 138 KB (Stakataka). At that rate the remaining species of
the national dex (about 790 more) would add roughly 37 MB of art, a page near 65 MB that decodes every species before the
title screen. **No further species wave until art loads separately from the HTML.**

### Proposed stage A1: Pokémon art outside the HTML (not started)

1. **Build output.** `scripts/build.mjs` writes each species' art as its own content-hashed files (atlas PNG, frame
   table, portrait, cry) under `dist/art/`, plus `dist/art/manifest.json`. The manifest carries what the game needs
   before any art arrives: ids, file names and sizes, the idle reference height and the measured outline the chase
   framing reads (`scripts/lib/silhouette.ts` today measures it from the atlas). The page itself keeps only the code.
2. **Loader.** At boot, the manifest plus the partner's line. When a stage starts (`ctx.spawnTable` is known), fetch
   that table's species (spawns, elites, boss) and prefetch the next region's. Anything else (`?pool=`, `all-wild`, a
   recruit) is fetched on first sight. Until it arrives, a Pokémon draws as a class-sized placeholder (the size class
   already fixes its drawn size). Cries load on first use (40 % of the bytes).
3. **Determinism.** Render and audio only: the sim never waits for art, so no replay hash moves. Capture mode
   (`?capture=1`) and the browser tools gain a `pokewatch.ready()` that resolves when the art in view has loaded.
4. **Kept as is.** Node tests and scripts keep reading `src/content/art.json`; the content build is unchanged.
5. **Single-file variants.** `dist/poke-watch-artifact.html` (for hosts that wrap the page) cannot fetch side files. Keep
   an `--inline` build limited to a named subset, or drop that variant: owner decision.
6. **Gates.** A size budget on `dist/index.html` (for example ≤ 3 MB); boot-to-title time measured before and after;
   a capture parity check (the same frames with inline and loaded art); the GitHub Pages workflow deploying `dist/art/`.

Open for the owner before A1: the inline variant (5), whether portraits stay inline for the partner screen, and whether
the dev roster's "All Pokémon" view should load every portrait on open.

### S2.13 Gates after §S2.12 (2026-11-19)

| Gate | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm test` | 623 tests: 617 pass, 4 fail (the known pointer-lock tests), 2 todo |
| `npm run build` | pass, `dist/index.html` 25,661 KB |
| handoff suites | 73/73 |
| `checksum.ts` | every set identical to §S2.9's run (no hash moved) |
| `navwalk all 5` | 0 failures |
| `stuckwatch all 3` | 67 bot episodes (1 pinned, 0 trapped); 2 enemy episodes over 115,807 enemy-s (unchanged) |
| `habstate` / `hazplay` / `habplay all 6 1 --raid` | 24/24, 49/49, 72/72 |
| `perf-sim 500 --repeat 3 --gate` | min of 3: p50 0.393, p95 0.506, p99 0.850 ms: PASS |

Next (owner): `/grilling` on how new species are placed into region spawn pools. Not merged.
