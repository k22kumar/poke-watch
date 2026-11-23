# Size extremes handoff: giant scaling, measurement axis, catalogue families as runtime actors

> **Historical record (the original S1–S3 prompt).** What is current, including the size-flag default flip of 2026-11-18
> (`axis`, `xlContinuous` and `xlTall` on by default), is in `docs/archive/size-extremes-plan.md`.

Written 2026-11-18 from a read-only audit of `main` at `b89fb55`, for the Claude Code sessions that run Prompts S1–S3.
Progress goes in `docs/archive/size-extremes-plan.md` (create it in S1), one section per prompt, in the style of
`docs/archive/pokemon-integration-plan.md`.

## Owner decisions (2026-11-18)

1. **Every Pokémon is meant to be playable, now and in future generations.** No species is excluded for being too big
   or too small. Rules must be shared and data-driven, not per-species exceptions, so a new generation needs no redesign.
2. **Keep the five size classes and fixed class targets** (`docs/SIZING.md` "Why fixed class targets" stands).
3. **Inside Extra Large only, the drawn size scales continuously with the extent**, so giants stay visibly different
   from smaller XL Pokémon. About **4 m is a provisional visual cap to test**, not a final value.
4. **Preserve body proportions** (one uniform sprite multiplier per species, as today).
5. **Account for what the listed measurement represents**: height, body length or span.
6. **Before finalising**, show Snorlax, Onix, Wailord and Eternatus together at a fixed camera distance and zoom, with
   their calculated sizes and collision/hurtbox overlays, and check terrain clipping, headroom, targeting and camera
   framing. Report any mismatch that needs a supporting gameplay adjustment instead of silently changing it.
7. **Import scope:** the 108 catalogue families in `content/catalogue.json` (210 species; 41 already runtime actors,
   169 new). Appendix C of `docs/archive/pokemon-integration-handoff.md` is the authority for the family list.

## Audit facts this handoff relies on

Recomputed from PokéAPI tables (all 1,025 default species) against the current `rules.size`:

- Under today's cuts the full roster would be Tiny 114, Small 234, Medium 247, Large 329, XL 101. XL spans 2.1–20 m
  listed but draws 2.48–2.91 m: Snorlax 2.48, Groudon 2.69, Wailord 2.91, Eternatus 2.91 (`extentRange` tops out at 6 m).
- Large + XL is 42% of species, all routed on the wide field. Footprints are already capped (XL body 0.88 m, role
  bodies `bodyCap` 0.95 m), so navigation is already giant-proof. Don't change footprints in these prompts.
- PokéAPI's shape field (`pokemon_species.shape_id` → `pokemon_shapes`) marks serpentine (`squiggle`) and fins
  (`fish`) bodies, whose listed figure is body length: 87 species, 23 of them XL by length, 7 with a 0.35 × length
  rule. `NEUTRAL_CORE_EXTENT_M` is empty. Eternatus is a known exception: shape `wings`, figure is length.
- No span figures exist in PokéAPI. Winged shapes list body height. Record "span" as an axis value that only an
  approved `NEUTRAL_CORE_EXTENT_M` entry can select.
- Collision mismatch to expect: XL sim height is 2.4 m × tilt (≤ 2.59 m) and deck gaps are 2.4 m. A drawn giant near
  4 m has its top ~35% outside the hurt window.

## Rules for every prompt

- Follow `CLAUDE.md`. Work on a new branch. Check `git status` first.
- **Another session has uncommitted camera work** (`src/render/camera.ts`, `chaseinput.ts`, `renderer.ts`,
  `docs/SIZING.md`, `docs/THIRD_PERSON*.md` and tests). Don't edit, stage, revert or commit those hunks. If a change
  needs one of those files, stop and report. For `docs/SIZING.md`, wait until that work is committed, or stage only
  your own hunks with `git add -p`.
- Every behaviour change is behind a `rules.size` flag with a checksum layer whose `-off` set reproduces today's hashes
  exactly (`scripts/checksum.ts`, as `size-off` and `gen-headroom-off` do).
- Use `/grilling` before turning a flag on by default, moving replay hashes, or bumping `HAB_VERSION`.
- Gates: `npm run check`; `npx tsx --test tests/sizing.test.ts tests/navsize.test.ts tests/footprint.test.ts tests/headroom.test.ts tests/walltops.test.ts tests/playability.test.ts tests/catalogue.test.ts`;
  `npx tsx scripts/navwalk.ts all 5`; `npx tsx scripts/stuckwatch.ts all 3`; `npx tsx scripts/checksum.ts`;
  `npx tsx scripts/perf-sim.ts 500 --repeat 3 --gate`. Build captures into a private folder (CLAUDE.md).

## Prompt S1: measurement axis and XL visual law (flagged, default off)

1. Carry the official shape into content: extend the content build so each runtime species' `canon` gets `shape`
   (PokéAPI shape identifier), from the pinned CSV snapshot the catalogue lane already uses. Regenerate generated files
   only through their scripts.
2. Add `canon.axis: 'height' | 'length' | 'span'`: `squiggle` and `fish` give `length`, every other shape `height`.
   Put the shape-to-axis map in `src/rules/` so new shapes or generations need data only.
3. In `speciesExtent`, behind `rules.size.axis` (default **false**):
   - an approved `NEUTRAL_CORE_EXTENT_M` entry still wins;
   - otherwise `length` uses `rules.size.lengthRise` × the listed figure (default 0.35);
   - otherwise use the listed figure.
   Report Eternatus as needing a reviewed `NEUTRAL_CORE_EXTENT_M` figure, with a proposed value and how you got it.
   Don't approve it yourself.
4. In `bodyOf`, behind `rules.size.xlContinuous` (default **false**), XL `visualM` becomes
   `min(rules.size.xlVisualCap, xlFloor × (S / 2.05) ^ rules.size.xlExponent)`:
   - `xlVisualCap` defaults to 4.0, `xlFloor` to today's lowest XL draw (2.69 × 0.92), `xlExponent` to 0.21.
   - Classes Tiny–Large are unchanged.
   - XL `radius`, `height` and `body` keep today's class values and tilt.
   - The no-overlap test in `tests/sizing.test.ts` must still hold.
5. Write a table into the plan for every runtime species and every catalogue species with a listed height. Columns:
   shape, axis, listed m, extent used, class today, class with `axis`, XL visual at exponent 0.21, XL visual at the
   exponent that puts the largest extent in the set at 4.0 m, radius, height, footprint, wide flag.
   List every current runtime species whose class changes with `axis` on (expect Lapras, Ekans, Onix, Silicobra and
   others), and every replay hash that moves with each flag.
6. Stop. Report, and don't turn either flag on.

## Prompt S2: catalogue families as runtime actors (role lane)

1. On the Mac (needs network): `npm run fetch-sources`, then import the 169 new species through the role lane
   (`content/roster.json` → `npm run content`). Varieties stay catalogue-only (F2 in `docs/archive/pokemon-integration-plan.md`
   is unresolved).
2. Each species needs a role. Propose one default rule from data, never per-species hand edits, and stop for owner
   approval before writing it:
   - behaviour from stats and types, for example `ranged` with `shot` = primary element when Sp. Atk > Atk, `tank`
     when HP + Def lead;
   - `flying` from type and shape.
   Report the role table.
3. Add the new species behind a checksum layer, so spawn pools and every existing replay hash are unchanged with it
   off. Update the roster pins in `tests/catalogue.test.ts`.
4. Report:
   - SpriteCollab gaps (missing species, missing idle or walk animations) and any species left on `sprite-fallback`;
   - missing cries;
   - the `tests/playability.test.ts` grade for every new species, with each not-ready reason.

## Prompt S3: the giant comparison and the checks

1. Add capture scenes to `tools/sizescenes.json` and a capture-only debug overlay. The overlay is render-side, reads sim
   values, is off by default and moves no hash. It draws the footprint circle, hurt cylinder (radius × height) and
   drawn sprite bounds, and labels listed m, axis, extent, class, `visualM`, radius, height and footprint.
2. Scene `size-giants`: Snorlax, Onix, Wailord and Eternatus side by side at one fixed camera distance, height and zoom
   (`cam=classic`), with S1's flags on. Add the same row with flags off for before/after. Add a reference row of one
   Pokémon per class.
3. Checks, each with a capture and a number:
   - **Terrain clipping:** drawn bounds against wall tops, cliffs and the map edge; a wide sprite's drawn width is
     1.5 × visual (`wideRatio`).
   - **Headroom:** each giant at a 2.4 m deck gap and a 2.9 m one; whether the sim height and the drawn sprite agree.
   - **Targeting:** shots at the drawn top, middle and feet of each giant; report the share of the drawn silhouette
     outside the hurt window.
   - **Camera framing:** read-only, because the camera is another session's work. Report the chase boom and pivot that
     `visualM` produces for each giant as a partner, and whether the sprite leaves the frame.
4. Report every mismatch with a proposed gameplay adjustment and its cost: hashes moved, gates affected, files owned by
   another session. Options include hurt height following `visualM` for XL only, a taller XL headroom height, or
   a different cap. Don't apply them. Owner decides, then a follow-up prompt turns flags on.
