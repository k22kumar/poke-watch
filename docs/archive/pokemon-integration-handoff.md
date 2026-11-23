# Poke-watch Pokémon integration handoff

## Run next

1. Put this revision at `docs/archive/pokemon-integration-handoff.md` in Poke-watch.
2. Paste **Prompt 3** into Claude Code. Prompt 2 is complete at `5b82fa0`. Reuse its results if the current repository inputs still match.
3. Claude Code writes `docs/archive/pokemon-integration-plan.md` with exact roster coverage, a content-generation plan and the next ready step. Continue from that report.

The static audit covered the survivor game on `main` at `7e6f137379e2898ae1dfdc2f164df767505d810b`. The baseline report confirms that the one commit between the audit and the baseline changed only `docs/Pokemon_Environment_Interaction_Specification.md`. Verify any subsequent changes against the affected checks.

## Integration scope

The completed **Pokémon physical extremes by type** report supplies the working roster. The published PokéAPI source snapshot confirms its exact record identities, typings, listed dimensions and species-family edges. Appendix A preserves selection reasons and the 18 type lists. Appendices B and C define the expected roster and families.

| What to account for | Count |
|---|---:|
| Selected `pokemon` records and family or form additions | 269 |
| Distinct species, each with its default `pokemon` record | 210 |
| Additional `pokemon` varieties among the 269 | 59 |
| Records directly selected by the research tables | 146 |
| Complete species evolution families | 108 |
| Directed species evolution edges | 102 |
| Families consisting of one species | 39 |

### Pasted list

The pasted list contains **164 valid species slugs**. There are **77** species also in the report and **87** additional picks. The full species families of the pasted list contain **168** species. The omitted members are **Tyrogue, Hitmonchan, Hitmontop and Gardevoir**. The report already covers the first three. Gardevoir belongs with the pasted Ralts line. See Appendix D for the exact list, default-record mappings and evidence.

Use the completed report as the working scope. The pasted additions are available for an explicit expansion. If the intended scope is the report plus all pasted picks and their species evolution relatives, tell Claude Code when starting Prompt 3. Appendix D adds **88 default records** to the report in that case, for **357 Pokémon records, 298 species, 155 families and 143 species edges**. Any extra varieties outside Appendix B require their own inclusion decision.

### Gameplay scope

- **Required.** Every expected `pokemon` identity and all expected species-family edges resolve through the existing content pipeline. Preserve the source typing order, family joins, measurement qualifiers and supported identity mappings. A catalogue entry counts when the game content path can resolve its identity. A reference entry can use lightweight data without a sprite, cry, learnset or spawn role.
- **Working default.** Reference coverage for entries without an established game role. Start with the repo's existing roles and team progression rules. A verified persistent form can become a runtime actor when an existing or explicitly requested role calls for it. Keep temporary forms and Koraidon's ride builds as canonical reference records. Check the current repo before assuming support or gaps for any entry.
- **Conditional.** Runtime actor work covers the correct asset variant, supported moves, game-size or push tuning, and the existing role and habitat hooks when needed for an established role. Diagnose failures and use existing overrides if justified. Missing art, moves or role rules can block the affected actor while canonical reference integration proceeds.
- **Optional.** A branch picker, franchise evolution triggers, transformation mechanics, new locomotion profiles, new abilities, new encounters for reference entries and bulk art loading all require a gameplay reason. The current integration can preserve their source facts and test cases independently.

PokéAPI separates `pokemon-species`, `pokemon` and `pokemon-form` IDs. Join `pokemon.species_id` to the species table and `pokemon_forms.pokemon_id` to the Pokémon table in the pinned CSV data, or use the corresponding REST links. The audited game uses the Pokémon slug as the game ID and the species number for the base sprite directory. A species default can have a different slug, and a Pokémon record can have multiple cosmetic form rows. [PokéAPI v2 documentation](https://pokeapi.co/docs/v2)

Listed extent is in decimetres and mass is in hectograms. Divide by 10 for metres or kilograms. Extent can describe length along the body. Gigantamax heights are lower bounds, its raw mass of 10,000 hg is unknown, and Eternamax's raw mass of 0 hg is unknown. Eternamax is temporary under the research rules even though its source form flag is false. Use these distinctions when checking catalogue metadata or push classes. [Official Gigantamax example](https://swordshield.pokemon.com/en-ca/pokemon-galar-region/gigantamax-centiskorch/) · [Eternamax reference](https://bulbapedia.bulbagarden.net/wiki/Eternamax)

Width and thickness are qualitative shape examples or licensed display-figure measurements for particular poses. Keep those different from canonical dimensions and gameplay bounds. Anatomy and locomotion in Appendix A describe the franchise. The test ideas apply where the game already has an affected system or an explicit requirement. Collision, camera, hovering, water safety, burrowing, flying and ability behavior follow the game's own rules. The separate **Pokémon Size and Body Proportions** study supplies test ideas for size and clearance.

## Dependency order

| Prompt | Scope and prerequisite | Evidence to proceed |
|---|---|---|
| 2. Baseline | Complete at `5b82fa0` for the checks recorded below. | Current tree, commands, measured results and deferred checks documented. |
| 3. Reconcile | Next. Compare the exact expected sets with current authored and generated content. | Per-entry and per-edge coverage, confirmed roles and the exact route for generating content safely. |
| 4. Catalogue and families | Required where Prompt 3 finds gaps. The audited importer follows one child and imports wild entries without relatives. Canonical data must be resolvable before using additional rows at runtime. Resolve the input source and output paths recorded in Prompt 3 for generator verification. | Exact inventory and edges resolve from reproducible inputs. Existing roles and paced paths pass focused checks. |
| 5. Runtime actors | Conditional. Depends on IDs, data, asset/source support and a confirmed role. | Every affected actor resolves, renders and exercises its assigned path. Scope with no runtime changes can be verified and marked complete. |
| 6. Data gate | Required after content work. | Expected and actual inventories, edges and qualifiers match by ID. Generation and references pass. |
| 7. Runtime gate | Required after applicable stages. Use baseline results to identify regressions. | Relevant runtime, replay, performance and build evidence. Runtime coverage is reported per affected actor or feature. |
| 8. Acceptance | Required after both gates. | Final diff, test evidence, accurate coverage totals and explicit remaining blockers. |

The audited content path is `content/roster.json` → `scripts/build-content.mjs` and `scripts/import-pack.mjs` → `src/content/pokedex.ts`, `src/content/art.json` and `content/report.json` → `src/rules/species.ts` and the survivor simulation. `scripts/fetch-sources.sh` is the documented local-source preparation path. Authored inputs and generators own changes to generated content. The separate Maplebrook overworld reads its own roster. Source for the audit is **Poke-watch repository discovery**.

## Recorded baseline

Source is the **Poke-watch integration baseline** report for `main` at `5b82fa0ea5f48305c514d1c47f8486f6954a508f`, using Node 24.21.0, npm 11.19.0 and macOS Darwin 25.5.0. The report records only the pre-existing untracked handoff. SHA-256 checks for `package-lock.json`, `content/roster.json` and `src/content/pokedex.ts` were identical before and after.

| Check | Baseline result |
|---|---|
| `npm run typecheck` | Exit 0. |
| `npm test` | 318 of 318 passed across 31 test files. |
| `npx tsx scripts/perf-sim.ts 500 --repeat 3 --gate` | Passed with p95/p99 of 0.397/0.604 ms raw and 0.354/0.485 ms for the min-of-three run. Gate limits were 2/3 ms. |
| `npx tsx scripts/habstate.ts` | 24 of 24, including 20 live and 4 static cases. |
| `npx tsx scripts/hazplay.ts` | 49 of 49. |
| `npx tsx scripts/habplay.ts all 6 1 --raid` and `npx tsx scripts/habplay.ts all 6 1` | 72 of 72 each. The shorter `habplay.ts all --raid` form reported 0 of 0 with exit 0. Verify the executed case count. |
| `npx tsx scripts/habaudit.ts --out <isolated-output>` | All checks passed. At `HAB_VERSION` 2, the four shared recipes and all 12 overlapping layout checksums match `docs/habaudit/baseline.json`. Tropical Lagoon and Spear Sanctuary are absent from the committed file. Each passed 30 of 30 on the first attempt. A field-level `freshLoads` comparison is still open. |
| Isolated run of `scripts/build.mjs` | Production `index.html` was 3,019,256 bytes. The artifact variant was 3,019,084 bytes. The baseline used an isolated copy of the build script with the esbuild import resolved and the destination redirected. Use production output for size comparisons. |

### Observed replay hashes

Each pair is the first emitted mark and end hash from the specified `npx tsx scripts/checksum.ts <mode>` run. These are observed reference values for a later like-for-like comparison. The script prints hashes and completed successfully in all five modes. The suite's pinned assertions cover other configurations.

| Mode | Cyndaquil · seed 2 · classic · 420 s | Totodile · seed 7 · classic · 420 s | Bulbasaur · seed 3 · survival · 300 s | Charmander · seed 11 · boss rush · 240 s |
|---|---|---|---|---|
| `on` | `688e1596` → `b8036b96` | `b69ae52f` → `fa137f2f` | `3fb4ff12` → `e321d842` | `89cbb4c2` → `225ae97` |
| `off` | `14d3ea2e` → `34551320` | `aba3242f` → `5220c549` | `5ce1f134` → `75e0dbb1` | `93747fa7` → `4c169003` |
| `build-off` | `636c0285` → `1043e0cb` | `9dc634b4` → `e571a212` | `9ec499ea` → `994fae51` | `33e000b8` → `a53b4e2c` |
| `world-off` | `599d6e37` → `28812419` | `87568d0b` → `e17005e8` | `3ae0acdd` → `5a8617f8` | `4a48f18c` → `22694bf3` |
| `hazards-off` | `599d6e37` → `28812419` | `87568d0b` → `e17005e8` | `3ae0acdd` → `5a8617f8` | `4a48f18c` → `22694bf3` |

### Pending checks and prerequisites

- **Content generation for Prompts 4 and 6.** The baseline used the committed generated data. Full regeneration is pending. The documented `../src-data` directory was absent. Prompt 3 should inspect the actual source selection, available cache or pinned public inputs, the fixture workflow and every output destination. An offline fixture exercise can verify importer behavior. Full regeneration needs inputs covering the selected roster and an isolated destination or checkout.
- **World generation.** Record pre-change `checksum.ts gen` and `gen-classic` output before a stage that can change world generation or location selection. Run the corresponding after-check when applicable.
- **Browser smoke and build.** Playwright was unavailable at baseline. Resolve the supported browser setup for affected render and art checks when needed. Use isolated build output when the active dev server shares `dist/`. Use `habaudit.ts --out` for habitat comparisons so they have their own outputs.

## Prompt 2 — Record the baseline if the tested inputs change

```text
Record the pre-change baseline for the Poke-watch survivor integration. Read repo instructions, docs/archive/pokemon-integration-handoff.md through the dependency table, and the relevant parts of README.md, docs/PIPELINE.md, docs/SPECIES.md, and package.json. Record branch, HEAD, Node/npm versions, and git status. The audit used 7e6f137379e2898ae1dfdc2f164df767505d810b. If relevant code or scripts changed, record the differences that affect the baseline. Preserve existing edits and use local tooling. Reuse a documented equivalent baseline for the same code and environment where available.

Confirm the current commands before running them. Use the Recorded baseline section for the known working commands. Run typecheck, npm test, applicable checksum modes and the simulation performance gate. Save the observed hashes for comparison and record any pinned assertions separately. Where needed, capture an isolated production build and the habitat/hazard baseline. Use habplay.ts all 6 1 --raid for the recorded raid sample, confirm a nonzero case count, and redirect habaudit.ts with --out. Skip or defer only checks with a concrete prerequisite or output conflict. Keep source, authored data, reference hashes, generated content and deployment state intact. Use checked-in scripts and installed executables.

Return “Poke-watch integration baseline” in chat. Give the commit, working-tree context, exact commands and exit statuses, measured results, pre-existing failures, deferred checks and reasons. Identify which later checks each gap affects. Preserve the results so Prompt 3 can record them. Confirm which next step can proceed.
```

## Prompt 3 — Reconcile the verified roster against the current repository

```text
Inspect Poke-watch and write only docs/archive/pokemon-integration-plan.md or its existing project equivalent. Read repo instructions, the handoff's scope and Recorded baseline, and the relevant sections of docs/PIPELINE.md and docs/SPECIES.md. Compare HEAD and relevant working-tree inputs with the tested 5b82fa0 baseline. Carry forward the findings and name any baseline checks affected by subsequent changes.

Read Appendices B and C in full. Parse the fenced CSV blocks directly and confirm 269 Pokémon records, 210 species, 108 families and 102 edges before comparing with the repo. If explicitly expanding the roster, also read Appendix D and use the corresponding scope totals. Trace the match from content/roster.json and the checked-in generated content through scripts/fetch-sources.sh, scripts/build-content.mjs, scripts/import-pack.mjs and src/rules/species.ts. Use explicit source identities and account for alternate defaults, dual types, form conditions, every branch and singletons. Record covered, missing, mismapped, duplicate and unresolved identities and edges. Preserve canonical data and game values in distinct fields.

For each expected record, mark catalogue only or the existing or explicitly confirmed runtime role. Identify the smallest change in data, code or assets and the evidence for each actual gap. Check family lookup and primary in-run evolution independently. Use existing gameplay decisions and flag material unresolved role choices with the simplest suitable option.

Inspect source selection and writes for fetch-sources, content/content:net and the fixture workflow. Check whether available source data or cache covers the required records and which inputs are missing. Record the exact source, revisions where available, commands and safe output paths for Prompt 4 and Prompt 6. If scripts hardcode outputs, specify a way to use an isolated checkout or equivalent disposable directory. State what a fixture run can verify and what needs full input coverage. If planned edits can affect world generation or location selection, schedule gen and gen-classic before those edits. Capture any applicable browser setup for runtime verification. Keep this session to read-only repository inspection plus the plan. Leave setup, generation and tests to the stages that need them.

Put exact discrepancy IDs and evidence in the plan, with reusable paths, required/conditional/optional work, commands, acceptance criteria and stage progress. Return a short summary with coverage totals, the first ready step, the safe generation route or the exact missing inputs, and any scoped blocker. Identify which work can proceed if full generation is unavailable.
```

## Prompt 4 — Integrate the canonical catalogue and full families

```text
Integrate the expected roster as canonical game content. Read repo instructions, docs/archive/pokemon-integration-handoff.md (scope and Appendices B–C, plus Appendix D when adopted), docs/archive/pokemon-integration-plan.md and confirmed baseline results. Verify the plan's current coverage, HEAD and working tree. Limit edits to the generator, source input/data contract and consumers necessary to resolve catalogue identities and canonical family relationships. If the acceptance criteria already hold, run the focused checks and record the evidence.

Inspect content/roster.json, scripts/fetch-sources.sh, scripts/build-content.mjs, scripts/import-pack.mjs and identity lookup before editing. Reuse existing authoring and generation. Resolve aliases and default varieties explicitly through the source linkage. Walk every species-family branch from the root, accounting for all directed edges, singleton families and known form or regional restrictions. Preserve canonical relationships independently of the game's primary evolvesTo and pacing fields. Keep existing lineage, role, art and stage consumers on their supported path unless the actual data contract requires a minimal compatible change.

Fit reference-only entries to the existing catalogue boundary without requiring runtime art, moves, decoding or role assignment. Use the source route and isolated outputs established in Prompt 3. Prepare any missing generation inputs in those paths as needed. Protect merge uniqueness across types, families and role passes. Validate identities, type order, qualifiers and edges before accepting generated output. Exercise the supported generator and verify reproducible records and references. Report fixture checks separately from full-roster regeneration. If an input is still missing, complete independent checks and name precisely which outputs and claims remain pending.

Prove every expected record is resolvable and the full edge set matches. Exercise Tyrogue's three edges, the extended Applin branch, Nincada's Shedinja by-product, a regional restriction, an alternate default slug and an existing starter line. Use existing tests and add targeted coverage for any concrete gap. Compare typecheck and focused tests with baseline. Keep current role assignments within verified scope. Update the plan with files, commands, exact results, source revision, skips, unresolved entries and the next ready stage.
```

## Prompt 5 — Support confirmed runtime actors

```text
Apply this stage to actors with an existing or explicitly confirmed gameplay role in docs/archive/pokemon-integration-plan.md. Read repo instructions, the scope and relevant research entries in docs/archive/pokemon-integration-handoff.md, and the catalogue and baseline results. Verify current coverage before editing. If current roles already resolve and no new runtime role is confirmed, verify the existing paths and record this stage as satisfied without changes.

Trace each affected actor through the current authored roster, generated identity and art, the registry, and the normal role entry point. Where required, extend scripts/fetch-sources.sh and scripts/import-pack.mjs to resolve the exact Pokémon variant and approved asset path. SpriteCollab's species folder and the game art key are different identities. Verify assets, animation fallback, cry/provenance policy, and supported move availability before enabling a role. If a form uses a documented asset alias, verify render and data resolution explicitly. Report missing art or unsupported moves as scoped blockers and keep the affected actor disabled until resolved. Avoid expanding art payload for catalogue entries.

Use existing roster hooks for partner learnsets, wild behaviour, boss kits, stages or Tag Actions where the confirmed role requires them. Inspect src/rules/species.ts, src/sim/progression.ts, src/sim/squad.ts, src/sim/enemies.ts and src/world/habitat/mode.ts only as relevant to the affected role. Preserve paced evolution and branch handling per the plan. Use existing form, size, weight and traversal overrides where a demonstrated case needs one. Leave new game rules to explicit scope.

Validate each affected game ID from its normal start, spawn, recruit or evolution path, including correct art and attacks and any role-specific behaviour. Verify registry references, representative existing roles and any changed habitat profile or spawn table. Measure art/bundle or simulation impact when the actor change affects those paths. Use existing tooling first. Update the plan with the exact IDs, files, checks, results, unverified behaviours, blockers and readiness for the data and runtime gates.
```

## Prompt 6 — Verify exact data and evolution coverage

```text
Independently verify Poke-watch catalogue coverage after the content stages. Read repo instructions, docs/archive/pokemon-integration-handoff.md Appendices B and C (and Appendix D if adopted), docs/archive/pokemon-integration-plan.md and the stage reports. Inspect the authored data, generated content, lookup path and recorded source revision. Generate expected identity and edge sets independently from the handoff or pinned authoritative source. Exercise normal generation and resolution using the input and output paths established in Prompt 3. If only fixtures are available, report their scope and keep full-roster reproducibility pending while verifying every actual output and reference you can.

Compare exact sets for Pokémon records, species, selected varieties, complete families, directed edges and singletons. Report present and validated, missing, duplicate, mis-mapped and blocked entries. Check the source namespace joins, default slugs, ordered types, raw units and qualifiers, form and regional constraints, stable existing IDs and reference integrity across active roles. Treat external form-rule targets explicitly documented as source context as such. Confirm the current source and generation outputs agree, including no duplicate identity across role passes. Count catalogue and proposed or active runtime coverage with separate totals.

Record commands, results, source and any discrepancy by ID and path in the plan. A gate passes when the expected sets and qualifications match, required runtime references resolve and applicable regeneration is verified. Mark coverage partial when required evidence is unavailable. Trace each failure to the smallest responsible stage and give its recheck. Keep verification local and use the existing validation path.
```

## Prompt 7 — Verify gameplay and regressions

```text
Verify Poke-watch survivor behaviour using the current repository, the Recorded baseline, the integration plan and the data gate. Read the handoff's scope and research examples for the affected entries. Inspect the current test and smoke entry points. Use isolated build outputs as needed. Exercise each newly activated or materially changed game ID through its assigned role. Record each tested ID and path. For affected render and art checks, use the supported browser setup from the plan, or record the exact setup gap and which cases it blocks. Use targeted cases for changed movement, combat, spawning, collision, evolution, targeting and camera paths, plus an existing starter progression and map traversal case.

Run the documented typecheck, tests, local build and applicable replay checksum modes. Compare against the observed hashes for the same flags, seeds and durations. If world generation or location selection changed, compare gen and gen-classic against their pre-change outputs. Investigate drift before any reference update. Run the performance gate and applicable habitat/hazard checks when roles, geometry, stages or roster-derived profiles change. For the raid sample use habplay.ts all 6 1 --raid and confirm that cases executed. Redirect habaudit.ts with --out, compare shared layout cases and account for later recipes independently. Apply the repository's HAB_VERSION rule if its condition holds. Compare production output size or startup costs when adding runtime art.

Record commands and results, per-actor coverage, regression findings, comparable measured results and unavailable checks in the plan. Report whether the runtime gate passed for the agreed scope. For a failure, identify the reproduction, responsible stage and smallest recheck. Keep the work local.
```

## Prompt 8 — Review and report acceptance

```text
Review the completed integration diff alongside repo instructions, docs/archive/pokemon-integration-handoff.md, docs/archive/pokemon-integration-plan.md, the baseline, stage reports and both verification gates. Verify the changed files and test outputs. Look for duplicate authorities, hardcoded species exceptions, mismatched asset/identity references, unsupported gameplay changes, validation gaps, avoidable performance costs and deviations from repo conventions. Ground each finding in a path and symbol with a concrete effect. Route material fixes through their original stage and repeat their checks.

Scan changed files for private conversation, project, file or upload links and identifiers before handoff. Cite those sources by title and use public URLs or repository-relative paths for reader references. Keep work local. Record a concise acceptance report in the plan and return it in chat. Include the expected and validated totals for species, Pokémon records, varieties and family edges, runtime actors and their exercised roles, missing or blocked IDs, commands and outcomes, and remaining uncertainties. Assess completion for the agreed scope from observed evidence. For any untested behaviour, state the missing check.
```

## Public data provenance

All record, type, extent, mass and family joins in this handoff use PokéAPI's published CSV snapshot at `8a92bfa7dab2f12b84b5d151562f9857c133ff30`. The comparison used the source files. REST links provide a convenient lookup and can reflect later revisions. The numeric rank rows for shortest, tallest by published value or minimum, lightest and heaviest were recomputed against the 1,351 records under the report's placeholder policy. Every first-place set matched the report. Original fallback categories and qualitative picks are retained. [Pokémon records](https://github.com/PokeAPI/pokeapi/blob/8a92bfa7dab2f12b84b5d151562f9857c133ff30/data/v2/csv/pokemon.csv) · [Species and family IDs](https://github.com/PokeAPI/pokeapi/blob/8a92bfa7dab2f12b84b5d151562f9857c133ff30/data/v2/csv/pokemon_species.csv) · [Current type slots](https://github.com/PokeAPI/pokeapi/blob/8a92bfa7dab2f12b84b5d151562f9857c133ff30/data/v2/csv/pokemon_types.csv)

[Form records](https://github.com/PokeAPI/pokeapi/blob/8a92bfa7dab2f12b84b5d151562f9857c133ff30/data/v2/csv/pokemon_forms.csv) · [Form display names](https://github.com/PokeAPI/pokeapi/blob/8a92bfa7dab2f12b84b5d151562f9857c133ff30/data/v2/csv/pokemon_form_names.csv) · [Evolution condition records](https://github.com/PokeAPI/pokeapi/blob/8a92bfa7dab2f12b84b5d151562f9857c133ff30/data/v2/csv/pokemon_evolution.csv)

## Appendix A — Selections by type

Identifiers in these tables are `pokemon` slugs. The shape entries are qualitative or pose-specific, and the numeric rank rows use the raw-value rules above. Read the full row with Appendix B for its form label, scope and measurement qualifiers. Family members can appear in a type's final list even if they have different typing. The Pokédex text comes from franchise sources. Test ideas are conditional.

### Normal

| Category | Selected Pokémon records | Measurement or shape | Shape or special-source evidence |
|---|---|---|---|
| Shortest | `azurill`, `shroodle`, `terapagos` | 0.2 m |  |
| Thinnest candidate | `furret` | Qualitative · long, slim torso | [Pokédex artwork](https://www.pokemon.com/us/pokedex/furret) |
| Lightest | `shroodle` | 0.7 kg |  |
| Tallest | `snorlax-gmax` | ≥35.0 m |  |
| Tallest · non-temporary | `dudunsparce-three-segment` | 4.5 m |  |
| Widest candidate | `snorlax` | Qualitative · broad torso and wide resting footprint | [Pokédex artwork](https://www.pokemon.com/us/pokedex/snorlax) |
| Heaviest | `snorlax` | 460.0 kg |  |

| Selected Pokémon records | Documented trait | Test idea | Evidence |
|---|---|---|---|
| `furret` | Its slim body fits narrow burrows. It can also turn and move quickly. | Test low, winding passages with a flexible body envelope. | [In-game Pokédex entries](https://pokemondb.net/pokedex/furret#dex-entries) |
| `porygon` | A man-made program Pokémon that can turn itself back into data and travel through cyberspace. | Test access to designated digital terminals. | [In-game Pokédex entries](https://pokemondb.net/pokedex/porygon#dex-entries) |
| `doduo` | A two-headed bird that runs on long legs and struggles to fly. | Test a ground-first route profile for a Flying-type. | [In-game Pokédex entries](https://pokemondb.net/pokedex/doduo#dex-entries) |

**Type list with families and selected varieties**

```text
azumarill, azurill, dodrio, doduo, dudunsparce-three-segment, dudunsparce-two-segment, dunsparce, furret, grafaiai, marill, munchlax, porygon, porygon-z, porygon2, sentret, shroodle, snorlax, snorlax-gmax, terapagos
```

### Fire

| Category | Selected Pokémon records | Measurement or shape | Shape or special-source evidence |
|---|---|---|---|
| Shortest | `litwick`, `scorbunny`, `rotom-heat`, `castform-sunny` | 0.3 m |  |
| Shortest · non-temporary | `litwick`, `scorbunny`, `rotom-heat` | 0.3 m |  |
| Thinnest candidate | `centiskorch` | Qualitative · slender segmented cross-section relative to its length | [Pokédex artwork](https://www.pokemon.com/us/pokedex/centiskorch) · [Anatomy](https://swordshield.pokemon.com/en-us/pokemon-galar-region/centiskorch/) |
| Lightest | `rotom-heat` | 0.3 kg |  |
| Tallest | `centiskorch-gmax` | ≥75.0 m | [Official Gigantamax listing](https://swordshield.pokemon.com/en-ca/pokemon-galar-region/gigantamax-centiskorch/) |
| Tallest · non-temporary | `ho-oh` | 3.8 m |  |
| Widest candidate | `ho-oh` | Figure only · approximately 315 mm across a 1:20 figure (~6.3 m scale-equivalent) | [Pokédex artwork](https://www.pokemon.com/us/pokedex/ho-oh) · [Bandai](https://www.bandai.co.jp/candy/products/2025/1000221328.html) |
| Heaviest | `groudon-primal` | 999.7 kg |  |
| Heaviest · non-temporary | `gouging-fire` | 590.0 kg |  |

| Selected Pokémon records | Documented trait | Test idea | Evidence |
|---|---|---|---|
| `centiskorch` | It raises and coils its long, hot body around targets. | Test clearance for coiling and a segmented heat zone. | [Official Pokémon source](https://swordshield.pokemon.com/en-us/pokemon-galar-region/centiskorch/) |
| `magcargo` | Its shell is cooled magma, and it stores fire energy inside. | Test a shell collider paired with a surface heat effect. | [Official Pokémon source](https://www.pokemon.com/us/pokedex/0219) |

**Type list with families and selected varieties**

```text
castform, castform-sunny, centiskorch, centiskorch-gmax, chandelure, cinderace, gouging-fire, groudon, groudon-primal, ho-oh, lampent, litwick, magcargo, raboot, rotom, rotom-heat, scorbunny, sizzlipede, slugma
```

### Water

| Category | Selected Pokémon records | Measurement or shape | Shape or special-source evidence |
|---|---|---|---|
| Shortest | `wishiwashi-solo` | 0.2 m |  |
| Thinnest candidate | `wugtrio` | Qualitative · slender individual bodies, excluding the shared rock | [Pokédex artwork](https://www.pokemon.com/us/pokedex/wugtrio) |
| Lightest | `wishiwashi-solo`, `rotom-wash` | 0.3 kg |  |
| Tallest | `inteleon-gmax` | ≥40.0 m |  |
| Tallest · non-temporary | `wailord` | 14.5 m |  |
| Widest candidate | `mantine` | Qualitative · broad span across the pectoral fins | [Pokédex artwork](https://www.pokemon.com/us/pokedex/mantine) |
| Heaviest | `palkia-origin` | 659.0 kg |  |

| Selected Pokémon records | Documented trait | Test idea | Evidence |
|---|---|---|---|
| `wugtrio` | This fish wraps its long bodies around prey and pulls it into its den. | Test a fixed rock base with separately animated exposed bodies. | [Official Pokémon source](https://www.pokemon.com/us/pokedex/0961) |
| `tentacruel` | It extends up to 80 tentacles to trap targets in a poisonous net. | Test a deployed reach zone beyond the swimming body. | [Official Pokémon source](https://www.pokemon.com/us/pokedex/tentacruel) |
| `mantine` | It builds speed swimming, then leaps above waves and glides. | Test water-to-air transitions with a speed requirement. | [Official Pokémon source](https://www.pokemon.com/us/pokedex/0226) |
| `tatsugiri-curly` | Curly Form has Commander, which lets it enter an allied Dondozo’s mouth in battle. | Test an enterable ally socket and a safe exit. | [Official Pokémon source](https://www.pokemon.com/us/pokedex/0978) |

**Type list with families and selected varieties**

```text
drizzile, inteleon, inteleon-gmax, mantine, mantyke, palkia, palkia-origin, rotom, rotom-wash, sobble, tatsugiri-curly, tentacool, tentacruel, wailmer, wailord, wiglett, wishiwashi-solo, wugtrio
```

### Electric

| Category | Selected Pokémon records | Measurement or shape | Shape or special-source evidence |
|---|---|---|---|
| Shortest | `joltik` | 0.1 m |  |
| Thinnest candidate | `eelektross` | Qualitative · elongated eel-like trunk, excluding the arms | [Pokédex artwork](https://www.pokemon.com/us/pokedex/eelektross) |
| Lightest | `rotom`, `tynamo`, `rotom-heat`, `rotom-wash`, `rotom-frost`, `rotom-fan`, `rotom-mow` | 0.3 kg |  |
| Tallest | `toxtricity-amped-gmax`, `toxtricity-low-key-gmax` | ≥24.0 m |  |
| Tallest · non-temporary | `raging-bolt` | 5.2 m |  |
| Widest candidate | `magnezone` | Qualitative · disc-shaped body with lateral magnets | [Pokédex artwork](https://www.pokemon.com/us/pokedex/magnezone) |
| Heaviest | `raging-bolt` | 480.0 kg |  |

| Selected Pokémon records | Documented trait | Test idea | Evidence |
|---|---|---|---|
| `eelektross` | It uses its arms to crawl out of the ocean and returns underwater with prey. | Test shore transitions and limb-assisted movement out of water. | [In-game Pokédex entries](https://pokemondb.net/pokedex/eelektross#dex-entries) |
| `raichu-alola` | It levitates using psychic power and rides on its tail. | Test a low hover and clearance for banked turns. | [Official Pokémon source](https://www.pokemon.com/br/pokedex/0026) |

**Type list with families and selected varieties**

```text
eelektrik, eelektross, galvantula, joltik, magnemite, magneton, magnezone, pichu, pikachu, raging-bolt, raichu, raichu-alola, rotom, rotom-fan, rotom-frost, rotom-heat, rotom-mow, rotom-wash, toxel, toxtricity-amped, toxtricity-amped-gmax, toxtricity-low-key-gmax, tynamo
```

### Grass

| Category | Selected Pokémon records | Measurement or shape | Shape or special-source evidence |
|---|---|---|---|
| Shortest | `poltchageist` | 0.1 m |  |
| Thinnest candidate | `toedscool` | Qualitative · thin legs beneath its cap | [Pokédex artwork](https://www.pokemon.com/us/pokedex/toedscool) · [Anatomy](https://www.pokemon.com/us/pokedex/toedscool) |
| Lightest | `kartana` | 0.1 kg |  |
| Tallest | `rillaboom-gmax` | ≥28.0 m |  |
| Tallest · non-temporary | `exeggutor-alola` | 10.9 m |  |
| Widest candidate | `tropius` | Qualitative · broad leaf wings held to either side | [Pokédex artwork](https://www.pokemon.com/us/pokedex/tropius) |
| Heaviest | `exeggutor-alola` | 415.6 kg |  |

| Selected Pokémon records | Documented trait | Test idea | Evidence |
|---|---|---|---|
| `toedscool` | Its two thin legs can carry it at 30 mph (about 48 km/h). | Test fast foot placement on uneven ground. | [Official Pokémon source](https://www.pokemon.com/us/pokedex/toedscool) |
| `dhelmise` | Seaweed fused with sunken debris. It lowers its anchor while waiting for prey. | Test a tethered anchor and a separate swept envelope. | [Official Pokémon source](https://www.pokemon.com/us/pokedex/0781) |

**Type list with families and selected varieties**

```text
dhelmise, exeggcute, exeggutor, exeggutor-alola, grookey, kartana, poltchageist, rillaboom, rillaboom-gmax, sinistcha, thwackey, toedscool, toedscruel, tropius
```

### Ice

| Category | Selected Pokémon records | Measurement or shape | Shape or special-source evidence |
|---|---|---|---|
| Shortest | `snom`, `rotom-frost`, `castform-snowy` | 0.3 m |  |
| Shortest · non-temporary | `snom`, `rotom-frost` | 0.3 m |  |
| Thinnest candidate | `froslass` | Qualitative · slender central silhouette, excluding sleeves and sash | [Pokédex artwork](https://www.pokemon.com/us/pokedex/froslass) |
| Lightest | `rotom-frost` | 0.3 kg |  |
| Tallest | `lapras-gmax` | ≥24.0 m |  |
| Tallest · non-temporary | `cetitan` | 4.5 m |  |
| Widest candidate | `frosmoth` | Qualitative · expanded span with wings open | [Pokédex artwork](https://www.pokemon.com/us/pokedex/frosmoth) · [Pokédex entry](https://www.pokemon.com/us/pokedex/0873) |
| Heaviest | `calyrex-ice` | 809.1 kg |  |

| Selected Pokémon records | Documented trait | Test idea | Evidence |
|---|---|---|---|
| `froslass` | Its body-like exterior is hollow. | Test a compact collision core within a wider silhouette. | [Official Pokémon source](https://www.pokemon.com/us/pokedex/0478) |
| `avalugg` | It walks with Bergmite on its broad, icy back. Bergmite lore also describes riding it across seas. | Test a moving support surface for small allies. | [Official Pokémon source](https://www.pokemon.com/us/pokedex/0712) |

**Type list with families and selected varieties**

```text
avalugg, bergmite, calyrex, calyrex-ice, castform, castform-snowy, cetitan, cetoddle, froslass, frosmoth, glalie, lapras, lapras-gmax, rotom, rotom-frost, snom, snorunt
```

### Fighting

| Category | Selected Pokémon records | Measurement or shape | Shape or special-source evidence |
|---|---|---|---|
| Shortest | `pawmo` | 0.4 m |  |
| Thinnest candidate | `mienshao` | Qualitative · narrow torso, excluding loose arm fur | [Pokédex artwork](https://www.pokemon.com/us/pokedex/mienshao) |
| Lightest | `clobbopus` | 4.0 kg |  |
| Tallest | `urshifu-single-strike-gmax` | ≥29.0 m |  |
| Tallest · non-temporary | `koraidon-limited-build`, `koraidon-sprinting-build`, `koraidon-swimming-build`, `koraidon-gliding-build` | 3.5 m |  |
| Tallest · ordinary battle form | `slither-wing` | 3.2 m |  |
| Widest candidate | `hariyama` | Qualitative · broad upper body with hands spread | [Pokédex artwork](https://www.pokemon.com/us/pokedex/hariyama) |
| Heaviest | `zamazenta-crowned` | 785.0 kg |  |
| Heaviest · non-temporary | `iron-hands` | 380.7 kg |  |

| Selected Pokémon records | Documented trait | Test idea | Evidence |
|---|---|---|---|
| `falinks` | One leader and five troopers move as a single formation. | Test single-file navigation and turns with trailing members. | [Official Pokémon source](https://www.pokemon.com/uk/pokemon-news/squad-up-with-falinks-in-pokemon-unite) |
| `hitmonlee` | Its legs stretch to reach targets from farther away. | Test extending attack reach independently of body clearance. | [In-game Pokédex entries](https://pokemondb.net/pokedex/hitmonlee#dex-entries) |
| `koraidon-swimming-build` | Koraidon uses distinct builds to sprint, swim and glide as a ride Pokémon. | Test transitions between ground, water and air with a single roster identity. | [Official Pokémon source](https://press.pokemon.com/en-CA/NEW-DETAILS-REVEALED-FOR-POKEMON-SCARLET-AND-POKEMON-VIOLET-INCLUDING-) |

**Type list with families and selected varieties**

```text
clobbopus, falinks, grapploct, hariyama, hitmonchan, hitmonlee, hitmontop, iron-hands, koraidon, koraidon-gliding-build, koraidon-limited-build, koraidon-sprinting-build, koraidon-swimming-build, kubfu, makuhita, mienfoo, mienshao, pawmi, pawmo, pawmot, slither-wing, tyrogue, urshifu-rapid-strike, urshifu-single-strike, urshifu-single-strike-gmax, zamazenta, zamazenta-crowned
```

### Poison

| Category | Selected Pokémon records | Measurement or shape | Shape or special-source evidence |
|---|---|---|---|
| Shortest | `budew`, `foongus`, `shroodle` | 0.2 m |  |
| Thinnest candidate | `ekans` | Qualitative · low-diameter trunk relative to its length | [Pokédex artwork](https://www.pokemon.com/us/pokedex/ekans) |
| Lightest | `gastly`, `haunter` | 0.1 kg |  |
| Tallest | `eternatus-eternamax` | 100.0 m | [Eternamax listing](https://bulbapedia.bulbagarden.net/wiki/Eternamax) |
| Tallest · non-temporary | `eternatus` | 20.0 m |  |
| Widest candidate | `tentacruel` | Qualitative · large lateral sweep when tentacles extend | [Pokédex artwork](https://www.pokemon.com/us/pokedex/tentacruel) · [Anatomy](https://www.pokemon.com/us/pokedex/tentacruel) |
| Heaviest | `eternatus` | 950.0 kg |  |

| Selected Pokémon records | Documented trait | Test idea | Evidence |
|---|---|---|---|
| `gastly` | Most of its body is gas. Strong winds can disperse it. | Test airflow sensitivity and a shifting visual envelope. | [In-game Pokédex entries](https://pokemondb.net/pokedex/gastly#dex-entries) |
| `tentacruel` | It extends up to 80 tentacles to trap targets in a poisonous net. | Test a deployed reach zone beyond the swimming body. | [Official Pokémon source](https://www.pokemon.com/us/pokedex/tentacruel) |

**Type list with families and selected varieties**

```text
amoonguss, arbok, budew, ekans, eternatus, eternatus-eternamax, foongus, gastly, gengar, grafaiai, haunter, roselia, roserade, shroodle, tentacool, tentacruel
```

### Ground

| Category | Selected Pokémon records | Measurement or shape | Shape or special-source evidence |
|---|---|---|---|
| Shortest | `diglett`, `diglett-alola` | 0.2 m |  |
| Thinnest candidate | `toedscool` | Qualitative · thin legs with sparse ground contact | [Pokédex artwork](https://www.pokemon.com/us/pokedex/toedscool) · [Anatomy](https://www.pokemon.com/us/pokedex/toedscool) |
| Lightest | `diglett` | 0.8 kg |  |
| Tallest | `sandaconda-gmax` | ≥22.0 m |  |
| Tallest · non-temporary | `steelix` | 9.2 m |  |
| Widest candidate | `torterra` | Qualitative · wide four-legged shell and back canopy | [Pokédex artwork](https://www.pokemon.com/us/pokedex/torterra) |
| Heaviest | `groudon-primal` | 999.7 kg |  |
| Heaviest · non-temporary | `groudon` | 950.0 kg |  |

| Selected Pokémon records | Documented trait | Test idea | Evidence |
|---|---|---|---|
| `diglett` | It spends much of its time underground, moving through soil. | Test a tunnel entry and a distinct emergence collision state. | [In-game Pokédex entries](https://pokemondb.net/pokedex/diglett#dex-entries) |
| `toedscool` | Its two thin legs can carry it at 30 mph (about 48 km/h). | Test fast foot placement on uneven ground. | [Official Pokémon source](https://www.pokemon.com/us/pokedex/toedscool) |
| `onix` | It digs through the ground and absorbs hard material as it travels. | Test turns in tunnels with a long articulated body. | [Official Pokémon source](https://www.pokemon.com/us/pokedex/onix) |

**Type list with families and selected varieties**

```text
diglett, diglett-alola, dugtrio, dugtrio-alola, grotle, groudon, groudon-primal, onix, sandaconda, sandaconda-gmax, silicobra, steelix, toedscool, toedscruel, torterra, turtwig
```

### Flying

| Category | Selected Pokémon records | Measurement or shape | Shape or special-source evidence |
|---|---|---|---|
| Shortest | `natu`, `rookidee` | 0.2 m |  |
| Thinnest candidate | `rayquaza` | Qualitative · slender serpentine trunk relative to body length | [Pokédex artwork](https://www.pokemon.com/us/pokedex/rayquaza) |
| Lightest | `rotom-fan`, `minior-red`, `minior-orange`, `minior-yellow`, `minior-green`, `minior-blue`, `minior-indigo`, `minior-violet` | 0.3 kg |  |
| Tallest | `charizard-gmax` | ≥28.0 m |  |
| Tallest · non-temporary | `celesteela` | 9.2 m |  |
| Widest candidate | `lugia` | Figure only · approximately 400 mm across a 1:20 figure (~8.0 m scale-equivalent) | [Pokédex artwork](https://www.pokemon.com/us/pokedex/lugia) · [Bandai](https://www.bandai.co.jp/candy/products/2025/1000221889.html) |
| Heaviest | `celesteela` | 999.9 kg |  |

| Selected Pokémon records | Documented trait | Test idea | Evidence |
|---|---|---|---|
| `doduo` | A two-headed bird that runs on long legs and struggles to fly. | Test a ground-first route profile for a Flying-type. | [In-game Pokédex entries](https://pokemondb.net/pokedex/doduo#dex-entries) |
| `mantine` | It builds speed swimming, then leaps above waves and glides. | Test water-to-air transitions with a speed requirement. | [Official Pokémon source](https://www.pokemon.com/us/pokedex/0226) |
| `celesteela` | Gas expelled from its arms gives it powerful propulsion. | Test launch clearance with two large lateral thrusters. | [In-game Pokédex entries](https://pokemondb.net/pokedex/celesteela#dex-entries) |

**Type list with families and selected varieties**

```text
celesteela, charizard, charizard-gmax, charmander, charmeleon, corviknight, corvisquire, dodrio, doduo, lugia, mantine, mantyke, minior-blue, minior-green, minior-indigo, minior-orange, minior-red, minior-red-meteor, minior-violet, minior-yellow, natu, rayquaza, rookidee, rotom, rotom-fan, xatu
```

### Psychic

| Category | Selected Pokémon records | Measurement or shape | Shape or special-source evidence |
|---|---|---|---|
| Shortest | `cosmoem` | 0.1 m |  |
| Thinnest candidate | `unown` | Qualitative · thin glyph-like profile viewed edge-on | [Pokédex artwork](https://www.pokemon.com/us/pokedex/unown) · [Anatomy](https://pokemondb.net/pokedex/unown#dex-entries) |
| Lightest | `cosmog` | 0.1 kg |  |
| Tallest | `hatterene-gmax` | ≥26.0 m |  |
| Tallest · non-temporary | `hoopa-unbound` | 6.5 m |  |
| Widest candidate | `lugia` | Figure only · approximately 400 mm across a 1:20 figure (~8.0 m scale-equivalent) | [Pokédex artwork](https://www.pokemon.com/us/pokedex/lugia) · [Bandai](https://www.bandai.co.jp/candy/products/2025/1000221889.html) |
| Heaviest | `cosmoem` | 999.9 kg |  |

| Selected Pokémon records | Documented trait | Test idea | Evidence |
|---|---|---|---|
| `unown` | Its different shapes resemble written characters. Pokédex entries describe it as flat. | Test clearance as the glyph rotates edge-on. | [In-game Pokédex entries](https://pokemondb.net/pokedex/unown#dex-entries) |
| `raichu-alola` | It levitates using psychic power and rides on its tail. | Test a low hover and clearance for banked turns. | [Official Pokémon source](https://www.pokemon.com/br/pokedex/0026) |
| `malamar` | It can control targets by hypnosis. | Test indirect interaction with terrain controls through a target. | [Official Pokémon source](https://www.pokemon.com/br/pokedex/malamar) |

**Type list with families and selected varieties**

```text
cosmoem, cosmog, hatenna, hatterene, hatterene-gmax, hattrem, hoopa, hoopa-unbound, inkay, lugia, lunala, malamar, pichu, pikachu, raichu, raichu-alola, solgaleo, unown
```

### Bug

| Category | Selected Pokémon records | Measurement or shape | Shape or special-source evidence |
|---|---|---|---|
| Shortest | `joltik`, `cutiefly` | 0.1 m |  |
| Thinnest candidate | `sizzlipede` | Qualitative · low side profile of flattened segments | [Pokédex artwork](https://www.pokemon.com/us/pokedex/sizzlipede) |
| Lightest | `cutiefly` | 0.2 kg |  |
| Tallest | `centiskorch-gmax` | ≥75.0 m | [Official Gigantamax listing](https://swordshield.pokemon.com/en-ca/pokemon-galar-region/gigantamax-centiskorch/) |
| Tallest · non-temporary | `slither-wing` | 3.2 m |  |
| Widest candidate | `frosmoth` | Qualitative · expanded span with wings open | [Pokédex artwork](https://www.pokemon.com/us/pokedex/frosmoth) · [Pokédex entry](https://www.pokemon.com/us/pokedex/0873) |
| Heaviest | `buzzwole` | 333.6 kg |  |

| Selected Pokémon records | Documented trait | Test idea | Evidence |
|---|---|---|---|
| `sizzlipede` | It stores flammable gas and wraps prey in its heated coils. | Test a low crawl posture and separate coil reach. | [Official Pokémon source](https://www.pokemon.com/br/pokedex/sizzlipede) |
| `shedinja` | Its body is a hollow shell. It stays aloft without flapping and needs no breath. | Test stable hovering and a shell-shaped hit region. | [Official Pokémon source](https://www.pokemon.com/br/pokedex/shedinja) |

**Type list with families and selected varieties**

```text
buzzwole, centiskorch, centiskorch-gmax, cutiefly, frosmoth, galvantula, joltik, nincada, ninjask, ribombee, shedinja, sizzlipede, slither-wing, snom
```

### Rock

| Category | Selected Pokémon records | Measurement or shape | Shape or special-source evidence |
|---|---|---|---|
| Shortest | `dwebble`, `carbink`, `rolycoly`, `minior-red-meteor`, `minior-orange-meteor`, `minior-yellow-meteor`, `minior-green-meteor`, `minior-blue-meteor`, `minior-indigo-meteor`, `minior-violet-meteor`, `minior-red`, `minior-orange`, `minior-yellow`, `minior-green`, `minior-blue`, `minior-indigo`, `minior-violet` | 0.3 m |  |
| Thinnest candidate | `onix` | Qualitative · narrow segmented cross-section relative to its length | [Pokédex artwork](https://www.pokemon.com/us/pokedex/onix) |
| Lightest | `minior-red`, `minior-orange`, `minior-yellow`, `minior-green`, `minior-blue`, `minior-indigo`, `minior-violet` | 0.3 kg |  |
| Tallest | `coalossal-gmax` | ≥42.0 m |  |
| Tallest · non-temporary | `onix` | 8.8 m |  |
| Widest candidate | `stakataka` | Qualitative · wide, roughly rectangular support footprint | [Pokédex artwork](https://www.pokemon.com/us/pokedex/stakataka) |
| Heaviest | `stakataka` | 820.0 kg |  |

| Selected Pokémon records | Documented trait | Test idea | Evidence |
|---|---|---|---|
| `onix` | It digs through the ground and absorbs hard material as it travels. | Test turns in tunnels with a long articulated body. | [Official Pokémon source](https://www.pokemon.com/us/pokedex/onix) |
| `stakataka` | A wall-like organism made up of many stacked life-forms can move and attack. | Test a large rectangular footprint and clearance when turning. | [In-game Pokédex entries](https://pokemondb.net/pokedex/stakataka#dex-entries) |
| `magcargo` | Its shell is cooled magma, and it stores fire energy inside. | Test a shell collider paired with a surface heat effect. | [Official Pokémon source](https://www.pokemon.com/us/pokedex/0219) |

**Type list with families and selected varieties**

```text
carbink, carkol, coalossal, coalossal-gmax, crustle, dwebble, magcargo, minior-blue, minior-blue-meteor, minior-green, minior-green-meteor, minior-indigo, minior-indigo-meteor, minior-orange, minior-orange-meteor, minior-red, minior-red-meteor, minior-violet, minior-violet-meteor, minior-yellow, minior-yellow-meteor, onix, rolycoly, slugma, stakataka, steelix
```

### Ghost

| Category | Selected Pokémon records | Measurement or shape | Shape or special-source evidence |
|---|---|---|---|
| Shortest | `sinistea`, `poltchageist`, `gimmighoul-roaming` | 0.1 m |  |
| Thinnest candidate | `honedge` | Qualitative · flat blade edge-on, excluding its sash | [Pokédex artwork](https://www.pokemon.com/us/pokedex/honedge) |
| Lightest | `gastly`, `haunter` | 0.1 kg |  |
| Tallest | `gengar-gmax` | ≥20.0 m |  |
| Tallest · non-temporary | `giratina-origin` | 6.9 m |  |
| Widest candidate | `dhelmise` | Qualitative · broad anchor flukes and lateral sweep | [Pokédex artwork](https://www.pokemon.com/us/pokedex/dhelmise) · [Anatomy](https://www.pokemon.com/us/pokedex/0781) |
| Heaviest | `giratina-altered` | 750.0 kg |  |

| Selected Pokémon records | Documented trait | Test idea | Evidence |
|---|---|---|---|
| `gastly` | Most of its body is gas. Strong winds can disperse it. | Test airflow sensitivity and a shifting visual envelope. | [In-game Pokédex entries](https://pokemondb.net/pokedex/gastly#dex-entries) |
| `shedinja` | Its body is a hollow shell. It stays aloft without flapping and needs no breath. | Test stable hovering and a shell-shaped hit region. | [Official Pokémon source](https://www.pokemon.com/br/pokedex/shedinja) |
| `dhelmise` | Seaweed fused with sunken debris. It lowers its anchor while waiting for prey. | Test a tethered anchor and a separate swept envelope. | [Official Pokémon source](https://www.pokemon.com/us/pokedex/0781) |
| `dragapult` | It carries Dreepy in its horns. When it turns invisible, the Dreepy can disappear from sight with it. | Test dependent entities attached to a moving carrier. | [Official Pokémon source](https://www.pokemon.com/us/pokedex/0887) |

**Type list with families and selected varieties**

```text
aegislash-shield, dhelmise, doublade, dragapult, drakloak, dreepy, gastly, gengar, gengar-gmax, gholdengo, gimmighoul, gimmighoul-roaming, giratina-altered, giratina-origin, haunter, honedge, nincada, ninjask, poltchageist, polteageist, shedinja, sinistcha, sinistea
```

### Dragon

| Category | Selected Pokémon records | Measurement or shape | Shape or special-source evidence |
|---|---|---|---|
| Shortest | `applin` | 0.2 m |  |
| Thinnest candidate | `dratini` | Qualitative · slender serpentine trunk | [Pokédex artwork](https://www.pokemon.com/us/pokedex/dratini) |
| Lightest | `applin` | 0.5 kg |  |
| Tallest | `eternatus-eternamax` | 100.0 m | [Eternamax listing](https://bulbapedia.bulbagarden.net/wiki/Eternamax) |
| Tallest · non-temporary | `eternatus` | 20.0 m |  |
| Widest candidate | `noivern` | Qualitative · large lateral span with wings open | [Pokédex artwork](https://www.pokemon.com/us/pokedex/noivern) |
| Heaviest | `eternatus` | 950.0 kg |  |

| Selected Pokémon records | Documented trait | Test idea | Evidence |
|---|---|---|---|
| `dragapult` | It carries Dreepy in its horns. When it turns invisible, the Dreepy can disappear from sight with it. | Test dependent entities attached to a moving carrier. | [Official Pokémon source](https://www.pokemon.com/us/pokedex/0887) |
| `tatsugiri-curly` | Curly Form has Commander, which lets it enter an allied Dondozo’s mouth in battle. | Test an enterable ally socket and a safe exit. | [Official Pokémon source](https://www.pokemon.com/us/pokedex/0978) |
| `koraidon-swimming-build` | Koraidon uses distinct builds to sprint, swim and glide as a ride Pokémon. | Test transitions between ground, water and air with a single roster identity. | [Official Pokémon source](https://press.pokemon.com/en-CA/NEW-DETAILS-REVEALED-FOR-POKEMON-SCARLET-AND-POKEMON-VIOLET-INCLUDING-) |

**Type list with families and selected varieties**

```text
appletun, applin, dipplin, dragapult, dragonair, dragonite, drakloak, dratini, dreepy, eternatus, eternatus-eternamax, flapple, hydrapple, koraidon, koraidon-swimming-build, noibat, noivern, tatsugiri-curly
```

### Dark

| Category | Selected Pokémon records | Measurement or shape | Shape or special-source evidence |
|---|---|---|---|
| Shortest | `morpeko-full-belly`, `rattata-alola`, `morpeko-hangry` | 0.3 m |  |
| Shortest · non-temporary | `morpeko-full-belly`, `rattata-alola` | 0.3 m |  |
| Thinnest candidate | `sneasel` | Qualitative · slender trunk, excluding claws and head feathers | [Pokédex artwork](https://www.pokemon.com/us/pokedex/sneasel) |
| Lightest | `murkrow` | 2.1 kg |  |
| Tallest | `grimmsnarl-gmax` | ≥32.0 m |  |
| Tallest · non-temporary | `hoopa-unbound` | 6.5 m |  |
| Widest candidate | `yveltal` | Qualitative · broad three-pronged wing-and-tail silhouette | [Pokédex artwork](https://www.pokemon.com/us/pokedex/yveltal) |
| Heaviest | `guzzlord` | 888.0 kg |  |

| Selected Pokémon records | Documented trait | Test idea | Evidence |
|---|---|---|---|
| `malamar` | It can control targets by hypnosis. | Test indirect interaction with terrain controls through a target. | [Official Pokémon source](https://www.pokemon.com/br/pokedex/malamar) |
| `morpeko-full-belly` | Its fast metabolism drives constant feeding. Hunger Switch changes its form during battle. | Test a reversible appearance state with a stable footprint. | [Official Pokémon source](https://swordshield.pokemon.com/en-us/pokemon-galar-region/morpeko/) |

**Type list with families and selected varieties**

```text
grimmsnarl, grimmsnarl-gmax, guzzlord, honchkrow, hoopa, hoopa-unbound, impidimp, inkay, malamar, morgrem, morpeko-full-belly, morpeko-hangry, murkrow, raticate, raticate-alola, rattata, rattata-alola, sneasel, sneasel-hisui, sneasler, weavile, yveltal
```

### Steel

| Category | Selected Pokémon records | Measurement or shape | Shape or special-source evidence |
|---|---|---|---|
| Shortest | `klefki`, `meltan`, `diglett-alola` | 0.2 m |  |
| Thinnest candidate | `honedge` | Qualitative · flat blade edge-on, excluding its sash | [Pokédex artwork](https://www.pokemon.com/us/pokedex/honedge) |
| Lightest | `kartana` | 0.1 kg |  |
| Tallest | `duraludon-gmax` | ≥43.0 m |  |
| Tallest · non-temporary | `steelix`, `celesteela` | 9.2 m |  |
| Widest candidate | `celesteela` | Qualitative · wide silhouette when the large lateral arms spread | [Pokédex artwork](https://www.pokemon.com/us/pokedex/celesteela) |
| Heaviest | `celesteela` | 999.9 kg |  |

| Selected Pokémon records | Documented trait | Test idea | Evidence |
|---|---|---|---|
| `orthworm` | It lives in deserts, consumes iron from soil and can use its tendrils like fists. | Test reach from side appendages while the main body stays low. | [Official Pokémon source](https://www.pokemon.com/us/pokedex/0968) |
| `celesteela` | Gas expelled from its arms gives it powerful propulsion. | Test launch clearance with two large lateral thrusters. | [In-game Pokédex entries](https://pokemondb.net/pokedex/celesteela#dex-entries) |
| `klefki` | It collects keys. Noble households once entrusted it with vault keys. | Test carried-key interactions at doors and locks. | [Official Pokémon source](https://www.pokemon.com/us/pokedex/klefki) |

**Type list with families and selected varieties**

```text
aegislash-shield, archaludon, celesteela, diglett, diglett-alola, doublade, dugtrio, dugtrio-alola, duraludon, duraludon-gmax, honedge, kartana, klefki, melmetal, meltan, onix, orthworm, steelix
```

### Fairy

| Category | Selected Pokémon records | Measurement or shape | Shape or special-source evidence |
|---|---|---|---|
| Shortest | `flabebe`, `cutiefly`, `comfey` | 0.1 m |  |
| Thinnest candidate | `flabebe` | Qualitative · tiny, slender body, excluding its flower | [Pokédex artwork](https://www.pokemon.com/us/pokedex/flabebe) |
| Lightest | `flabebe` | 0.1 kg |  |
| Tallest | `grimmsnarl-gmax` | ≥32.0 m |  |
| Tallest · non-temporary | `xerneas`, `weezing-galar` | 3.0 m |  |
| Widest candidate | `togekiss` | Qualitative · broad wing planform relative to body length | [Pokédex artwork](https://www.pokemon.com/us/pokedex/togekiss) |
| Heaviest | `zacian-crowned` | 355.0 kg |  |
| Heaviest · non-temporary | `xerneas` | 215.0 kg |  |

| Selected Pokémon records | Documented trait | Test idea | Evidence |
|---|---|---|---|
| `flabebe` | It flies in search of a flower and then rides the flower it chooses. | Test an airborne core and a flower attachment with its own visual clearance. | [Official Pokémon source](https://www.pokemon.com/us/pokedex/flabebe) |
| `klefki` | It collects keys. Noble households once entrusted it with vault keys. | Test carried-key interactions at doors and locks. | [Official Pokémon source](https://www.pokemon.com/us/pokedex/klefki) |

**Type list with families and selected varieties**

```text
comfey, cutiefly, flabebe, floette, florges, grimmsnarl, grimmsnarl-gmax, impidimp, klefki, koffing, morgrem, ribombee, togekiss, togepi, togetic, weezing, weezing-galar, xerneas, zacian, zacian-crowned
```

## Appendix B — Expected report records

Use `pokemon_slug` and `pokemon_id` for an exact Pokémon variety. `species_slug` and `species_id` resolve its family. The form columns give the source form corresponding to that record. Shared cosmetic form IDs can remain source context. An empty label means the source has no named English label for that form row. The `inclusion` column marks direct table picks and records supplied by families or form relationships.

### Record data

```csv
pokemon_slug,pokemon_id,species_slug,species_id,species_name,pokemon_form_slug,pokemon_form_id,form_label,types_in_slot_order,height_dm,height_kind,weight_hg,weight_kind,form_status,inclusion
aegislash-shield,681,aegislash,681,Aegislash,aegislash-shield,681,Shield Forme,steel+ghost,17,listed,530,listed,species-default,family-or-form
amoonguss,591,amoonguss,591,Amoonguss,amoonguss,591,,grass+poison,6,listed,105,listed,species-default,family-or-form
appletun,842,appletun,842,Appletun,appletun,842,,grass+dragon,4,listed,130,listed,species-default,family-or-form
applin,840,applin,840,Applin,applin,840,,grass+dragon,2,listed,5,listed,species-default,selected
arbok,24,arbok,24,Arbok,arbok,24,,poison,35,listed,650,listed,species-default,family-or-form
archaludon,1018,archaludon,1018,Archaludon,archaludon,1018,,steel+dragon,20,listed,600,listed,species-default,family-or-form
avalugg,713,avalugg,713,Avalugg,avalugg,713,,ice,20,listed,5050,listed,species-default,selected
azumarill,184,azumarill,184,Azumarill,azumarill,184,,water+fairy,8,listed,285,listed,species-default,family-or-form
azurill,298,azurill,298,Azurill,azurill,298,,normal+fairy,2,listed,20,listed,species-default,selected
bergmite,712,bergmite,712,Bergmite,bergmite,712,,ice,10,listed,995,listed,species-default,family-or-form
budew,406,budew,406,Budew,budew,406,,grass+poison,2,listed,12,listed,species-default,selected
buzzwole,794,buzzwole,794,Buzzwole,buzzwole,794,,bug+fighting,24,listed,3336,listed,species-default,selected
calyrex,898,calyrex,898,Calyrex,calyrex,898,,psychic+grass,11,listed,77,listed,species-default,family-or-form
calyrex-ice,10193,calyrex,898,Calyrex,calyrex-ice,10362,Ice Rider,psychic+ice,24,listed,8091,listed,persistent-fusion,selected
carbink,703,carbink,703,Carbink,carbink,703,,rock+fairy,3,listed,57,listed,species-default,selected
carkol,838,carkol,838,Carkol,carkol,838,,rock+fire,11,listed,780,listed,species-default,family-or-form
castform,351,castform,351,Castform,castform,351,Normal,normal,3,listed,8,listed,species-default,family-or-form
castform-snowy,10015,castform,351,Castform,castform-snowy,10030,Snowy Form,ice,3,listed,8,listed,temporary,selected
castform-sunny,10013,castform,351,Castform,castform-sunny,10028,Sunny Form,fire,3,listed,8,listed,temporary,selected
celesteela,797,celesteela,797,Celesteela,celesteela,797,,steel+flying,92,listed,9999,listed,species-default,selected
centiskorch,851,centiskorch,851,Centiskorch,centiskorch,851,,fire+bug,30,listed,1200,listed,species-default,selected
centiskorch-gmax,10220,centiskorch,851,Centiskorch,centiskorch-gmax,10389,Gigantamax Form,fire+bug,750,lower-bound,10000,unknown-placeholder,temporary,selected
cetitan,975,cetitan,975,Cetitan,cetitan,975,,ice,45,listed,7000,listed,species-default,selected
cetoddle,974,cetoddle,974,Cetoddle,cetoddle,974,,ice,12,listed,450,listed,species-default,family-or-form
chandelure,609,chandelure,609,Chandelure,chandelure,609,,ghost+fire,10,listed,343,listed,species-default,family-or-form
charizard,6,charizard,6,Charizard,charizard,6,,fire+flying,17,listed,905,listed,species-default,family-or-form
charizard-gmax,10196,charizard,6,Charizard,charizard-gmax,10365,Gigantamax Form,fire+flying,280,lower-bound,10000,unknown-placeholder,temporary,selected
charmander,4,charmander,4,Charmander,charmander,4,,fire,6,listed,85,listed,species-default,family-or-form
charmeleon,5,charmeleon,5,Charmeleon,charmeleon,5,,fire,11,listed,190,listed,species-default,family-or-form
cinderace,815,cinderace,815,Cinderace,cinderace,815,,fire,14,listed,330,listed,species-default,family-or-form
clobbopus,852,clobbopus,852,Clobbopus,clobbopus,852,,fighting,6,listed,40,listed,species-default,selected
coalossal,839,coalossal,839,Coalossal,coalossal,839,,rock+fire,28,listed,3105,listed,species-default,family-or-form
coalossal-gmax,10215,coalossal,839,Coalossal,coalossal-gmax,10384,Gigantamax Form,rock+fire,420,lower-bound,10000,unknown-placeholder,temporary,selected
comfey,764,comfey,764,Comfey,comfey,764,,fairy,1,listed,3,listed,species-default,selected
corviknight,823,corviknight,823,Corviknight,corviknight,823,,flying+steel,22,listed,750,listed,species-default,family-or-form
corvisquire,822,corvisquire,822,Corvisquire,corvisquire,822,,flying,8,listed,160,listed,species-default,family-or-form
cosmoem,790,cosmoem,790,Cosmoem,cosmoem,790,,psychic,1,listed,9999,listed,species-default,selected
cosmog,789,cosmog,789,Cosmog,cosmog,789,,psychic,2,listed,1,listed,species-default,selected
crustle,558,crustle,558,Crustle,crustle,558,,bug+rock,14,listed,2000,listed,species-default,family-or-form
cutiefly,742,cutiefly,742,Cutiefly,cutiefly,742,,bug+fairy,1,listed,2,listed,species-default,selected
dhelmise,781,dhelmise,781,Dhelmise,dhelmise,781,,ghost+grass,39,listed,2100,listed,species-default,selected
diglett,50,diglett,50,Diglett,diglett,50,,ground,2,listed,8,listed,species-default,selected
diglett-alola,10105,diglett,50,Diglett,diglett-alola,10207,Alolan Form,ground+steel,2,listed,10,listed,regional,selected
dipplin,1011,dipplin,1011,Dipplin,dipplin,1011,,grass+dragon,4,listed,97,listed,species-default,family-or-form
dodrio,85,dodrio,85,Dodrio,dodrio,85,,normal+flying,18,listed,852,listed,species-default,family-or-form
doduo,84,doduo,84,Doduo,doduo,84,,normal+flying,14,listed,392,listed,species-default,selected
doublade,680,doublade,680,Doublade,doublade,680,,steel+ghost,8,listed,45,listed,species-default,family-or-form
dragapult,887,dragapult,887,Dragapult,dragapult,887,,dragon+ghost,30,listed,500,listed,species-default,selected
dragonair,148,dragonair,148,Dragonair,dragonair,148,,dragon,40,listed,165,listed,species-default,family-or-form
dragonite,149,dragonite,149,Dragonite,dragonite,149,,dragon+flying,22,listed,2100,listed,species-default,family-or-form
drakloak,886,drakloak,886,Drakloak,drakloak,886,,dragon+ghost,14,listed,110,listed,species-default,family-or-form
dratini,147,dratini,147,Dratini,dratini,147,,dragon,18,listed,33,listed,species-default,selected
dreepy,885,dreepy,885,Dreepy,dreepy,885,,dragon+ghost,5,listed,20,listed,species-default,family-or-form
drizzile,817,drizzile,817,Drizzile,drizzile,817,,water,7,listed,115,listed,species-default,family-or-form
dudunsparce-three-segment,10255,dudunsparce,982,Dudunsparce,dudunsparce-three-segment,10424,Three-Segment Form,normal,45,listed,474,listed,persistent-alternate,selected
dudunsparce-two-segment,982,dudunsparce,982,Dudunsparce,dudunsparce-two-segment,982,Two-Segment Form,normal,36,listed,392,listed,species-default,family-or-form
dugtrio,51,dugtrio,51,Dugtrio,dugtrio,51,,ground,7,listed,333,listed,species-default,family-or-form
dugtrio-alola,10106,dugtrio,51,Dugtrio,dugtrio-alola,10208,Alolan Form,ground+steel,7,listed,666,listed,regional,family-or-form
dunsparce,206,dunsparce,206,Dunsparce,dunsparce,206,,normal,15,listed,140,listed,species-default,family-or-form
duraludon,884,duraludon,884,Duraludon,duraludon,884,,steel+dragon,18,listed,400,listed,species-default,family-or-form
duraludon-gmax,10225,duraludon,884,Duraludon,duraludon-gmax,10394,Gigantamax Form,steel+dragon,430,lower-bound,10000,unknown-placeholder,temporary,selected
dwebble,557,dwebble,557,Dwebble,dwebble,557,,bug+rock,3,listed,145,listed,species-default,selected
eelektrik,603,eelektrik,603,Eelektrik,eelektrik,603,,electric,12,listed,220,listed,species-default,family-or-form
eelektross,604,eelektross,604,Eelektross,eelektross,604,,electric,21,listed,805,listed,species-default,selected
ekans,23,ekans,23,Ekans,ekans,23,,poison,20,listed,69,listed,species-default,selected
eternatus,890,eternatus,890,Eternatus,eternatus,890,,poison+dragon,200,listed,9500,listed,species-default,selected
eternatus-eternamax,10190,eternatus,890,Eternatus,eternatus-eternamax,10359,Eternamax,poison+dragon,1000,listed,0,unknown-placeholder,temporary,selected
exeggcute,102,exeggcute,102,Exeggcute,exeggcute,102,,grass+psychic,4,listed,25,listed,species-default,family-or-form
exeggutor,103,exeggutor,103,Exeggutor,exeggutor,103,,grass+psychic,20,listed,1200,listed,species-default,family-or-form
exeggutor-alola,10114,exeggutor,103,Exeggutor,exeggutor-alola,10216,Alolan Form,grass+dragon,109,listed,4156,listed,regional,selected
falinks,870,falinks,870,Falinks,falinks,870,,fighting,30,listed,620,listed,species-default,selected
flabebe,669,flabebe,669,Flabébé,flabebe-red,669,Red Flower,fairy,1,listed,1,listed,species-default,selected
flapple,841,flapple,841,Flapple,flapple,841,,grass+dragon,3,listed,10,listed,species-default,family-or-form
floette,670,floette,670,Floette,floette-red,670,Red Flower,fairy,2,listed,9,listed,species-default,family-or-form
florges,671,florges,671,Florges,florges-red,671,Red Flower,fairy,11,listed,100,listed,species-default,family-or-form
foongus,590,foongus,590,Foongus,foongus,590,,grass+poison,2,listed,10,listed,species-default,selected
froslass,478,froslass,478,Froslass,froslass,478,,ice+ghost,13,listed,266,listed,species-default,selected
frosmoth,873,frosmoth,873,Frosmoth,frosmoth,873,,ice+bug,13,listed,420,listed,species-default,selected
furret,162,furret,162,Furret,furret,162,,normal,18,listed,325,listed,species-default,selected
galvantula,596,galvantula,596,Galvantula,galvantula,596,,bug+electric,8,listed,143,listed,species-default,family-or-form
gastly,92,gastly,92,Gastly,gastly,92,,ghost+poison,13,listed,1,listed,species-default,selected
gengar,94,gengar,94,Gengar,gengar,94,,ghost+poison,15,listed,405,listed,species-default,family-or-form
gengar-gmax,10202,gengar,94,Gengar,gengar-gmax,10371,Gigantamax Form,ghost+poison,200,lower-bound,10000,unknown-placeholder,temporary,selected
gholdengo,1000,gholdengo,1000,Gholdengo,gholdengo,1000,,steel+ghost,12,listed,300,listed,species-default,family-or-form
gimmighoul,999,gimmighoul,999,Gimmighoul,gimmighoul-chest,999,Chest Form,ghost,3,listed,50,listed,species-default,family-or-form
gimmighoul-roaming,10263,gimmighoul,999,Gimmighoul,gimmighoul-roaming,10432,Roaming Form,ghost,1,listed,10,listed,persistent-alternate,selected
giratina-altered,487,giratina,487,Giratina,giratina-altered,487,Altered Forme,ghost+dragon,45,listed,7500,listed,species-default,selected
giratina-origin,10007,giratina,487,Giratina,giratina-origin,10063,Origin Forme,ghost+dragon,69,listed,6500,listed,persistent-alternate,selected
glalie,362,glalie,362,Glalie,glalie,362,,ice,15,listed,2565,listed,species-default,family-or-form
gouging-fire,1020,gouging-fire,1020,Gouging Fire,gouging-fire,1020,,fire+dragon,35,listed,5900,listed,species-default,selected
grafaiai,945,grafaiai,945,Grafaiai,grafaiai,945,,poison+normal,7,listed,272,listed,species-default,family-or-form
grapploct,853,grapploct,853,Grapploct,grapploct,853,,fighting,16,listed,390,listed,species-default,family-or-form
grimmsnarl,861,grimmsnarl,861,Grimmsnarl,grimmsnarl,861,,dark+fairy,15,listed,610,listed,species-default,family-or-form
grimmsnarl-gmax,10222,grimmsnarl,861,Grimmsnarl,grimmsnarl-gmax,10391,Gigantamax Form,dark+fairy,320,lower-bound,10000,unknown-placeholder,temporary,selected
grookey,810,grookey,810,Grookey,grookey,810,,grass,3,listed,50,listed,species-default,family-or-form
grotle,388,grotle,388,Grotle,grotle,388,,grass,11,listed,970,listed,species-default,family-or-form
groudon,383,groudon,383,Groudon,groudon,383,Groudon,ground,35,listed,9500,listed,species-default,selected
groudon-primal,10078,groudon,383,Groudon,groudon-primal,10180,Primal Reversion,ground+fire,50,listed,9997,listed,temporary,selected
guzzlord,799,guzzlord,799,Guzzlord,guzzlord,799,,dark+dragon,55,listed,8880,listed,species-default,selected
hariyama,297,hariyama,297,Hariyama,hariyama,297,,fighting,23,listed,2538,listed,species-default,selected
hatenna,856,hatenna,856,Hatenna,hatenna,856,,psychic,4,listed,34,listed,species-default,family-or-form
hatterene,858,hatterene,858,Hatterene,hatterene,858,,psychic+fairy,21,listed,51,listed,species-default,family-or-form
hatterene-gmax,10221,hatterene,858,Hatterene,hatterene-gmax,10390,Gigantamax Form,psychic+fairy,260,lower-bound,10000,unknown-placeholder,temporary,selected
hattrem,857,hattrem,857,Hattrem,hattrem,857,,psychic,6,listed,48,listed,species-default,family-or-form
haunter,93,haunter,93,Haunter,haunter,93,,ghost+poison,16,listed,1,listed,species-default,selected
hitmonchan,107,hitmonchan,107,Hitmonchan,hitmonchan,107,,fighting,14,listed,502,listed,species-default,family-or-form
hitmonlee,106,hitmonlee,106,Hitmonlee,hitmonlee,106,,fighting,15,listed,498,listed,species-default,selected
hitmontop,237,hitmontop,237,Hitmontop,hitmontop,237,,fighting,14,listed,480,listed,species-default,family-or-form
ho-oh,250,ho-oh,250,Ho-Oh,ho-oh,250,,fire+flying,38,listed,1990,listed,species-default,selected
honchkrow,430,honchkrow,430,Honchkrow,honchkrow,430,,dark+flying,9,listed,273,listed,species-default,family-or-form
honedge,679,honedge,679,Honedge,honedge,679,,steel+ghost,8,listed,20,listed,species-default,selected
hoopa,720,hoopa,720,Hoopa,hoopa,720,Hoopa Confined,psychic+ghost,5,listed,90,listed,species-default,family-or-form
hoopa-unbound,10086,hoopa,720,Hoopa,hoopa-unbound,10188,Hoopa Unbound,psychic+dark,65,listed,4900,listed,persistent-alternate,selected
hydrapple,1019,hydrapple,1019,Hydrapple,hydrapple,1019,,grass+dragon,18,listed,930,listed,species-default,family-or-form
impidimp,859,impidimp,859,Impidimp,impidimp,859,,dark+fairy,4,listed,55,listed,species-default,family-or-form
inkay,686,inkay,686,Inkay,inkay,686,,dark+psychic,4,listed,35,listed,species-default,family-or-form
inteleon,818,inteleon,818,Inteleon,inteleon,818,,water,19,listed,452,listed,species-default,family-or-form
inteleon-gmax,10211,inteleon,818,Inteleon,inteleon-gmax,10380,Gigantamax Form,water,400,lower-bound,10000,unknown-placeholder,temporary,selected
iron-hands,992,iron-hands,992,Iron Hands,iron-hands,992,,fighting+electric,18,listed,3807,listed,species-default,selected
joltik,595,joltik,595,Joltik,joltik,595,,bug+electric,1,listed,6,listed,species-default,selected
kartana,798,kartana,798,Kartana,kartana,798,,grass+steel,3,listed,1,listed,species-default,selected
klefki,707,klefki,707,Klefki,klefki,707,,steel+fairy,2,listed,30,listed,species-default,selected
koffing,109,koffing,109,Koffing,koffing,109,,poison,6,listed,10,listed,species-default,family-or-form
koraidon,1007,koraidon,1007,Koraidon,koraidon-apex-build,1007,Apex Build,fighting+dragon,25,listed,3030,listed,species-default,family-or-form
koraidon-gliding-build,10267,koraidon,1007,Koraidon,koraidon-gliding-build,10436,Gliding Build,fighting+dragon,35,listed,3030,listed,out-of-battle-build,selected
koraidon-limited-build,10264,koraidon,1007,Koraidon,koraidon-limited-build,10433,Limited Build,fighting+dragon,35,listed,3030,listed,out-of-battle-build,selected
koraidon-sprinting-build,10265,koraidon,1007,Koraidon,koraidon-sprinting-build,10434,Sprinting Build,fighting+dragon,35,listed,3030,listed,out-of-battle-build,selected
koraidon-swimming-build,10266,koraidon,1007,Koraidon,koraidon-swimming-build,10435,Swimming Build,fighting+dragon,35,listed,3030,listed,out-of-battle-build,selected
kubfu,891,kubfu,891,Kubfu,kubfu,891,,fighting,6,listed,120,listed,species-default,family-or-form
lampent,608,lampent,608,Lampent,lampent,608,,ghost+fire,6,listed,130,listed,species-default,family-or-form
lapras,131,lapras,131,Lapras,lapras,131,,water+ice,25,listed,2200,listed,species-default,family-or-form
lapras-gmax,10204,lapras,131,Lapras,lapras-gmax,10373,Gigantamax Form,water+ice,240,lower-bound,10000,unknown-placeholder,temporary,selected
litwick,607,litwick,607,Litwick,litwick,607,,ghost+fire,3,listed,31,listed,species-default,selected
lugia,249,lugia,249,Lugia,lugia,249,,psychic+flying,52,listed,2160,listed,species-default,selected
lunala,792,lunala,792,Lunala,lunala,792,,psychic+ghost,40,listed,1200,listed,species-default,family-or-form
magcargo,219,magcargo,219,Magcargo,magcargo,219,,fire+rock,8,listed,550,listed,species-default,selected
magnemite,81,magnemite,81,Magnemite,magnemite,81,,electric+steel,3,listed,60,listed,species-default,family-or-form
magneton,82,magneton,82,Magneton,magneton,82,,electric+steel,10,listed,600,listed,species-default,family-or-form
magnezone,462,magnezone,462,Magnezone,magnezone,462,,electric+steel,12,listed,1800,listed,species-default,selected
makuhita,296,makuhita,296,Makuhita,makuhita,296,,fighting,10,listed,864,listed,species-default,family-or-form
malamar,687,malamar,687,Malamar,malamar,687,,dark+psychic,15,listed,470,listed,species-default,selected
mantine,226,mantine,226,Mantine,mantine,226,,water+flying,21,listed,2200,listed,species-default,selected
mantyke,458,mantyke,458,Mantyke,mantyke,458,,water+flying,10,listed,650,listed,species-default,family-or-form
marill,183,marill,183,Marill,marill,183,,water+fairy,4,listed,85,listed,species-default,family-or-form
melmetal,809,melmetal,809,Melmetal,melmetal,809,,steel,25,listed,8000,listed,species-default,family-or-form
meltan,808,meltan,808,Meltan,meltan,808,,steel,2,listed,80,listed,species-default,selected
mienfoo,619,mienfoo,619,Mienfoo,mienfoo,619,,fighting,9,listed,200,listed,species-default,family-or-form
mienshao,620,mienshao,620,Mienshao,mienshao,620,,fighting,14,listed,355,listed,species-default,selected
minior-blue,10140,minior,774,Minior,minior-blue,10259,Blue Core,rock+flying,3,listed,3,listed,persistent-alternate,selected
minior-blue-meteor,10133,minior,774,Minior,minior-blue-meteor,10252,Meteor Form,rock+flying,3,listed,400,listed,persistent-alternate,selected
minior-green,10139,minior,774,Minior,minior-green,10258,Green Core,rock+flying,3,listed,3,listed,persistent-alternate,selected
minior-green-meteor,10132,minior,774,Minior,minior-green-meteor,10251,Meteor Form,rock+flying,3,listed,400,listed,persistent-alternate,selected
minior-indigo,10141,minior,774,Minior,minior-indigo,10260,Indigo Core,rock+flying,3,listed,3,listed,persistent-alternate,selected
minior-indigo-meteor,10134,minior,774,Minior,minior-indigo-meteor,10253,Meteor Form,rock+flying,3,listed,400,listed,persistent-alternate,selected
minior-orange,10137,minior,774,Minior,minior-orange,10256,Orange Core,rock+flying,3,listed,3,listed,persistent-alternate,selected
minior-orange-meteor,10130,minior,774,Minior,minior-orange-meteor,10249,Meteor Form,rock+flying,3,listed,400,listed,persistent-alternate,selected
minior-red,10136,minior,774,Minior,minior-red,10255,Red Core,rock+flying,3,listed,3,listed,persistent-alternate,selected
minior-red-meteor,774,minior,774,Minior,minior-red-meteor,774,Meteor Form,rock+flying,3,listed,400,listed,species-default,selected
minior-violet,10142,minior,774,Minior,minior-violet,10261,Violet Core,rock+flying,3,listed,3,listed,persistent-alternate,selected
minior-violet-meteor,10135,minior,774,Minior,minior-violet-meteor,10254,Meteor Form,rock+flying,3,listed,400,listed,persistent-alternate,selected
minior-yellow,10138,minior,774,Minior,minior-yellow,10257,Yellow Core,rock+flying,3,listed,3,listed,persistent-alternate,selected
minior-yellow-meteor,10131,minior,774,Minior,minior-yellow-meteor,10250,Meteor Form,rock+flying,3,listed,400,listed,persistent-alternate,selected
morgrem,860,morgrem,860,Morgrem,morgrem,860,,dark+fairy,8,listed,125,listed,species-default,family-or-form
morpeko-full-belly,877,morpeko,877,Morpeko,morpeko-full-belly,877,Full Belly Mode,electric+dark,3,listed,30,listed,species-default,selected
morpeko-hangry,10187,morpeko,877,Morpeko,morpeko-hangry,10356,Hangry Mode,electric+dark,3,listed,30,listed,temporary,selected
munchlax,446,munchlax,446,Munchlax,munchlax,446,,normal,6,listed,1050,listed,species-default,family-or-form
murkrow,198,murkrow,198,Murkrow,murkrow,198,,dark+flying,5,listed,21,listed,species-default,selected
natu,177,natu,177,Natu,natu,177,,psychic+flying,2,listed,20,listed,species-default,selected
nincada,290,nincada,290,Nincada,nincada,290,,bug+ground,5,listed,55,listed,species-default,family-or-form
ninjask,291,ninjask,291,Ninjask,ninjask,291,,bug+flying,8,listed,120,listed,species-default,family-or-form
noibat,714,noibat,714,Noibat,noibat,714,,flying+dragon,5,listed,80,listed,species-default,family-or-form
noivern,715,noivern,715,Noivern,noivern,715,,flying+dragon,15,listed,850,listed,species-default,selected
onix,95,onix,95,Onix,onix,95,,rock+ground,88,listed,2100,listed,species-default,selected
orthworm,968,orthworm,968,Orthworm,orthworm,968,,steel,25,listed,3100,listed,species-default,selected
palkia,484,palkia,484,Palkia,palkia,484,,water+dragon,42,listed,3360,listed,species-default,family-or-form
palkia-origin,10246,palkia,484,Palkia,palkia-origin,10415,Origin Forme,water+dragon,63,listed,6590,listed,persistent-alternate,selected
pawmi,921,pawmi,921,Pawmi,pawmi,921,,electric,3,listed,25,listed,species-default,family-or-form
pawmo,922,pawmo,922,Pawmo,pawmo,922,,electric+fighting,4,listed,65,listed,species-default,selected
pawmot,923,pawmot,923,Pawmot,pawmot,923,,electric+fighting,9,listed,410,listed,species-default,family-or-form
pichu,172,pichu,172,Pichu,pichu,172,,electric,3,listed,20,listed,species-default,family-or-form
pikachu,25,pikachu,25,Pikachu,pikachu,25,,electric,4,listed,60,listed,species-default,family-or-form
poltchageist,1012,poltchageist,1012,Poltchageist,poltchageist-counterfeit,1012,Counterfeit Form,grass+ghost,1,listed,11,listed,species-default,selected
polteageist,855,polteageist,855,Polteageist,polteageist-phony,855,Phony Form,ghost,2,listed,4,listed,species-default,family-or-form
porygon,137,porygon,137,Porygon,porygon,137,,normal,8,listed,365,listed,species-default,selected
porygon-z,474,porygon-z,474,Porygon-Z,porygon-z,474,,normal,9,listed,340,listed,species-default,family-or-form
porygon2,233,porygon2,233,Porygon2,porygon2,233,,normal,6,listed,325,listed,species-default,family-or-form
raboot,814,raboot,814,Raboot,raboot,814,,fire,6,listed,90,listed,species-default,family-or-form
raging-bolt,1021,raging-bolt,1021,Raging Bolt,raging-bolt,1021,,electric+dragon,52,listed,4800,listed,species-default,selected
raichu,26,raichu,26,Raichu,raichu,26,,electric,8,listed,300,listed,species-default,family-or-form
raichu-alola,10100,raichu,26,Raichu,raichu-alola,10202,Alolan Form,electric+psychic,7,listed,210,listed,regional,selected
raticate,20,raticate,20,Raticate,raticate,20,,normal,7,listed,185,listed,species-default,family-or-form
raticate-alola,10092,raticate,20,Raticate,raticate-alola,10194,Alolan Form,dark+normal,7,listed,255,listed,regional,family-or-form
rattata,19,rattata,19,Rattata,rattata,19,,normal,3,listed,35,listed,species-default,family-or-form
rattata-alola,10091,rattata,19,Rattata,rattata-alola,10193,Alolan Form,dark+normal,3,listed,38,listed,regional,selected
rayquaza,384,rayquaza,384,Rayquaza,rayquaza,384,,dragon+flying,70,listed,2065,listed,species-default,selected
ribombee,743,ribombee,743,Ribombee,ribombee,743,,bug+fairy,2,listed,5,listed,species-default,family-or-form
rillaboom,812,rillaboom,812,Rillaboom,rillaboom,812,,grass,21,listed,900,listed,species-default,family-or-form
rillaboom-gmax,10209,rillaboom,812,Rillaboom,rillaboom-gmax,10378,Gigantamax Form,grass,280,lower-bound,10000,unknown-placeholder,temporary,selected
rolycoly,837,rolycoly,837,Rolycoly,rolycoly,837,,rock,3,listed,120,listed,species-default,selected
rookidee,821,rookidee,821,Rookidee,rookidee,821,,flying,2,listed,18,listed,species-default,selected
roselia,315,roselia,315,Roselia,roselia,315,,grass+poison,3,listed,20,listed,species-default,family-or-form
roserade,407,roserade,407,Roserade,roserade,407,,grass+poison,9,listed,145,listed,species-default,family-or-form
rotom,479,rotom,479,Rotom,rotom,479,Rotom,electric+ghost,3,listed,3,listed,species-default,selected
rotom-fan,10011,rotom,479,Rotom,rotom-fan,10061,Fan Rotom,electric+flying,3,listed,3,listed,persistent-alternate,selected
rotom-frost,10010,rotom,479,Rotom,rotom-frost,10060,Frost Rotom,electric+ice,3,listed,3,listed,persistent-alternate,selected
rotom-heat,10008,rotom,479,Rotom,rotom-heat,10058,Heat Rotom,electric+fire,3,listed,3,listed,persistent-alternate,selected
rotom-mow,10012,rotom,479,Rotom,rotom-mow,10062,Mow Rotom,electric+grass,3,listed,3,listed,persistent-alternate,selected
rotom-wash,10009,rotom,479,Rotom,rotom-wash,10059,Wash Rotom,electric+water,3,listed,3,listed,persistent-alternate,selected
sandaconda,844,sandaconda,844,Sandaconda,sandaconda,844,,ground,38,listed,655,listed,species-default,family-or-form
sandaconda-gmax,10218,sandaconda,844,Sandaconda,sandaconda-gmax,10387,Gigantamax Form,ground,220,lower-bound,10000,unknown-placeholder,temporary,selected
scorbunny,813,scorbunny,813,Scorbunny,scorbunny,813,,fire,3,listed,45,listed,species-default,selected
sentret,161,sentret,161,Sentret,sentret,161,,normal,8,listed,60,listed,species-default,family-or-form
shedinja,292,shedinja,292,Shedinja,shedinja,292,,bug+ghost,8,listed,12,listed,species-default,selected
shroodle,944,shroodle,944,Shroodle,shroodle,944,,poison+normal,2,listed,7,listed,species-default,selected
silicobra,843,silicobra,843,Silicobra,silicobra,843,,ground,22,listed,76,listed,species-default,family-or-form
sinistcha,1013,sinistcha,1013,Sinistcha,sinistcha-unremarkable,1013,Unremarkable Form,grass+ghost,2,listed,22,listed,species-default,family-or-form
sinistea,854,sinistea,854,Sinistea,sinistea-phony,854,Phony Form,ghost,1,listed,2,listed,species-default,selected
sizzlipede,850,sizzlipede,850,Sizzlipede,sizzlipede,850,,fire+bug,7,listed,10,listed,species-default,selected
slither-wing,988,slither-wing,988,Slither Wing,slither-wing,988,,bug+fighting,32,listed,920,listed,species-default,selected
slugma,218,slugma,218,Slugma,slugma,218,,fire,7,listed,350,listed,species-default,family-or-form
sneasel,215,sneasel,215,Sneasel,sneasel,215,,dark+ice,9,listed,280,listed,species-default,selected
sneasel-hisui,10235,sneasel,215,Sneasel,sneasel-hisui,10404,Hisuian Form,fighting+poison,9,listed,270,listed,regional,family-or-form
sneasler,903,sneasler,903,Sneasler,sneasler,903,,fighting+poison,13,listed,430,listed,species-default,family-or-form
snom,872,snom,872,Snom,snom,872,,ice+bug,3,listed,38,listed,species-default,selected
snorlax,143,snorlax,143,Snorlax,snorlax,143,,normal,21,listed,4600,listed,species-default,selected
snorlax-gmax,10206,snorlax,143,Snorlax,snorlax-gmax,10375,Gigantamax Form,normal,350,lower-bound,10000,unknown-placeholder,temporary,selected
snorunt,361,snorunt,361,Snorunt,snorunt,361,,ice,7,listed,168,listed,species-default,family-or-form
sobble,816,sobble,816,Sobble,sobble,816,,water,3,listed,40,listed,species-default,family-or-form
solgaleo,791,solgaleo,791,Solgaleo,solgaleo,791,,psychic+steel,34,listed,2300,listed,species-default,family-or-form
stakataka,805,stakataka,805,Stakataka,stakataka,805,,rock+steel,55,listed,8200,listed,species-default,selected
steelix,208,steelix,208,Steelix,steelix,208,,steel+ground,92,listed,4000,listed,species-default,selected
tatsugiri-curly,978,tatsugiri,978,Tatsugiri,tatsugiri-curly,978,Curly Form,dragon+water,3,listed,80,listed,species-default,selected
tentacool,72,tentacool,72,Tentacool,tentacool,72,,water+poison,9,listed,455,listed,species-default,family-or-form
tentacruel,73,tentacruel,73,Tentacruel,tentacruel,73,,water+poison,16,listed,550,listed,species-default,selected
terapagos,1024,terapagos,1024,Terapagos,terapagos,1024,Normal Form,normal,2,listed,65,listed,species-default,selected
thwackey,811,thwackey,811,Thwackey,thwackey,811,,grass,7,listed,140,listed,species-default,family-or-form
toedscool,948,toedscool,948,Toedscool,toedscool,948,,ground+grass,9,listed,330,listed,species-default,selected
toedscruel,949,toedscruel,949,Toedscruel,toedscruel,949,,ground+grass,19,listed,580,listed,species-default,family-or-form
togekiss,468,togekiss,468,Togekiss,togekiss,468,,fairy+flying,15,listed,380,listed,species-default,selected
togepi,175,togepi,175,Togepi,togepi,175,,fairy,3,listed,15,listed,species-default,family-or-form
togetic,176,togetic,176,Togetic,togetic,176,,fairy+flying,6,listed,32,listed,species-default,family-or-form
torterra,389,torterra,389,Torterra,torterra,389,,grass+ground,22,listed,3100,listed,species-default,selected
toxel,848,toxel,848,Toxel,toxel,848,,electric+poison,4,listed,110,listed,species-default,family-or-form
toxtricity-amped,849,toxtricity,849,Toxtricity,toxtricity-amped,849,Amped Form,electric+poison,16,listed,400,listed,species-default,family-or-form
toxtricity-amped-gmax,10219,toxtricity,849,Toxtricity,toxtricity-amped-gmax,10388,Gigantamax Form,electric+poison,240,lower-bound,10000,unknown-placeholder,temporary,selected
toxtricity-low-key-gmax,10228,toxtricity,849,Toxtricity,toxtricity-low-key-gmax,10397,Gigantamax Form,electric+poison,240,lower-bound,10000,unknown-placeholder,temporary,selected
tropius,357,tropius,357,Tropius,tropius,357,,grass+flying,20,listed,1000,listed,species-default,selected
turtwig,387,turtwig,387,Turtwig,turtwig,387,,grass,4,listed,102,listed,species-default,family-or-form
tynamo,602,tynamo,602,Tynamo,tynamo,602,,electric,2,listed,3,listed,species-default,selected
tyrogue,236,tyrogue,236,Tyrogue,tyrogue,236,,fighting,7,listed,210,listed,species-default,family-or-form
unown,201,unown,201,Unown,unown-a,201,A,psychic,5,listed,50,listed,species-default,selected
urshifu-rapid-strike,10191,urshifu,892,Urshifu,urshifu-rapid-strike,10360,Rapid Strike Style,fighting+water,19,listed,1050,listed,persistent-alternate,family-or-form
urshifu-single-strike,892,urshifu,892,Urshifu,urshifu-single-strike,892,Single Strike Style,fighting+dark,19,listed,1050,listed,species-default,family-or-form
urshifu-single-strike-gmax,10226,urshifu,892,Urshifu,urshifu-single-strike-gmax,10395,Gigantamax Form,fighting+dark,290,lower-bound,10000,unknown-placeholder,temporary,selected
wailmer,320,wailmer,320,Wailmer,wailmer,320,,water,20,listed,1300,listed,species-default,family-or-form
wailord,321,wailord,321,Wailord,wailord,321,,water,145,listed,3980,listed,species-default,selected
weavile,461,weavile,461,Weavile,weavile,461,,dark+ice,11,listed,340,listed,species-default,family-or-form
weezing,110,weezing,110,Weezing,weezing,110,,poison,12,listed,95,listed,species-default,family-or-form
weezing-galar,10167,weezing,110,Weezing,weezing-galar,10326,Galarian Form,poison+fairy,30,listed,160,listed,regional,selected
wiglett,960,wiglett,960,Wiglett,wiglett,960,,water,12,listed,18,listed,species-default,family-or-form
wishiwashi-solo,746,wishiwashi,746,Wishiwashi,wishiwashi-solo,746,Solo Form,water,2,listed,3,listed,species-default,selected
wugtrio,961,wugtrio,961,Wugtrio,wugtrio,961,,water,12,listed,54,listed,species-default,selected
xatu,178,xatu,178,Xatu,xatu,178,,psychic+flying,15,listed,150,listed,species-default,family-or-form
xerneas,716,xerneas,716,Xerneas,xerneas-neutral,10132,Neutral Mode,fairy,30,listed,2150,listed,species-default,selected
yveltal,717,yveltal,717,Yveltal,yveltal,717,,dark+flying,58,listed,2030,listed,species-default,selected
zacian,888,zacian,888,Zacian,zacian,888,Hero of Many Battles,fairy,28,listed,1100,listed,species-default,family-or-form
zacian-crowned,10188,zacian,888,Zacian,zacian-crowned,10357,Crowned Sword,fairy+steel,28,listed,3550,listed,temporary,selected
zamazenta,889,zamazenta,889,Zamazenta,zamazenta,889,Hero of Many Battles,fighting,29,listed,2100,listed,species-default,family-or-form
zamazenta-crowned,10189,zamazenta,889,Zamazenta,zamazenta-crowned,10358,Crowned Shield,fighting+steel,29,listed,7850,listed,temporary,selected
```

### Master PokéAPI slug list

```text
aegislash-shield, amoonguss, appletun, applin, arbok, archaludon, avalugg, azumarill, azurill, bergmite, budew, buzzwole, calyrex, calyrex-ice, carbink, carkol, castform, castform-snowy, castform-sunny, celesteela, centiskorch, centiskorch-gmax, cetitan, cetoddle, chandelure, charizard, charizard-gmax, charmander, charmeleon, cinderace, clobbopus, coalossal, coalossal-gmax, comfey, corviknight, corvisquire, cosmoem, cosmog, crustle, cutiefly, dhelmise, diglett, diglett-alola, dipplin, dodrio, doduo, doublade, dragapult, dragonair, dragonite, drakloak, dratini, dreepy, drizzile, dudunsparce-three-segment, dudunsparce-two-segment, dugtrio, dugtrio-alola, dunsparce, duraludon, duraludon-gmax, dwebble, eelektrik, eelektross, ekans, eternatus, eternatus-eternamax, exeggcute, exeggutor, exeggutor-alola, falinks, flabebe, flapple, floette, florges, foongus, froslass, frosmoth, furret, galvantula, gastly, gengar, gengar-gmax, gholdengo, gimmighoul, gimmighoul-roaming, giratina-altered, giratina-origin, glalie, gouging-fire, grafaiai, grapploct, grimmsnarl, grimmsnarl-gmax, grookey, grotle, groudon, groudon-primal, guzzlord, hariyama, hatenna, hatterene, hatterene-gmax, hattrem, haunter, hitmonchan, hitmonlee, hitmontop, ho-oh, honchkrow, honedge, hoopa, hoopa-unbound, hydrapple, impidimp, inkay, inteleon, inteleon-gmax, iron-hands, joltik, kartana, klefki, koffing, koraidon, koraidon-gliding-build, koraidon-limited-build, koraidon-sprinting-build, koraidon-swimming-build, kubfu, lampent, lapras, lapras-gmax, litwick, lugia, lunala, magcargo, magnemite, magneton, magnezone, makuhita, malamar, mantine, mantyke, marill, melmetal, meltan, mienfoo, mienshao, minior-blue, minior-blue-meteor, minior-green, minior-green-meteor, minior-indigo, minior-indigo-meteor, minior-orange, minior-orange-meteor, minior-red, minior-red-meteor, minior-violet, minior-violet-meteor, minior-yellow, minior-yellow-meteor, morgrem, morpeko-full-belly, morpeko-hangry, munchlax, murkrow, natu, nincada, ninjask, noibat, noivern, onix, orthworm, palkia, palkia-origin, pawmi, pawmo, pawmot, pichu, pikachu, poltchageist, polteageist, porygon, porygon-z, porygon2, raboot, raging-bolt, raichu, raichu-alola, raticate, raticate-alola, rattata, rattata-alola, rayquaza, ribombee, rillaboom, rillaboom-gmax, rolycoly, rookidee, roselia, roserade, rotom, rotom-fan, rotom-frost, rotom-heat, rotom-mow, rotom-wash, sandaconda, sandaconda-gmax, scorbunny, sentret, shedinja, shroodle, silicobra, sinistcha, sinistea, sizzlipede, slither-wing, slugma, sneasel, sneasel-hisui, sneasler, snom, snorlax, snorlax-gmax, snorunt, sobble, solgaleo, stakataka, steelix, tatsugiri-curly, tentacool, tentacruel, terapagos, thwackey, toedscool, toedscruel, togekiss, togepi, togetic, torterra, toxel, toxtricity-amped, toxtricity-amped-gmax, toxtricity-low-key-gmax, tropius, turtwig, tynamo, tyrogue, unown, urshifu-rapid-strike, urshifu-single-strike, urshifu-single-strike-gmax, wailmer, wailord, weavile, weezing, weezing-galar, wiglett, wishiwashi-solo, wugtrio, xatu, xerneas, yveltal, zacian, zacian-crowned, zamazenta, zamazenta-crowned
```

## Appendix C — Complete report evolution families

The entries use `pokemon-species` slugs. Read `>` as a parent-to-child edge and `|` as an edge delimiter. A singleton has no evolution links beyond itself. A chain can be inspected using the documented `/api/v2/evolution-chain/{chain_id}/` route. Preserve the entire graph during import and keep the existing in-run progression data independently. [PokéAPI evolution-chain documentation](https://pokeapi.co/docs/v2#evolution-chains)

### Species family graph

```csv
chain_id,root_species_slug,species_edges
2,charmander,charmander>charmeleon|charmeleon>charizard
7,rattata,rattata>raticate
9,ekans,ekans>arbok
10,pichu,pichu>pikachu|pikachu>raichu
21,diglett,diglett>dugtrio
30,tentacool,tentacool>tentacruel
34,magnemite,magnemite>magneton|magneton>magnezone
36,doduo,doduo>dodrio
40,gastly,gastly>haunter|haunter>gengar
41,onix,onix>steelix
45,exeggcute,exeggcute>exeggutor
47,tyrogue,tyrogue>hitmonlee|tyrogue>hitmonchan|tyrogue>hitmontop
49,koffing,koffing>weezing
65,lapras,singleton
68,porygon,porygon>porygon2|porygon2>porygon-z
72,munchlax,munchlax>snorlax
76,dratini,dratini>dragonair|dragonair>dragonite
82,sentret,sentret>furret
87,togepi,togepi>togetic|togetic>togekiss
88,natu,natu>xatu
90,azurill,azurill>marill|marill>azumarill
97,murkrow,murkrow>honchkrow
99,unown,singleton
103,dunsparce,dunsparce>dudunsparce
109,sneasel,sneasel>weavile|sneasel>sneasler
111,slugma,slugma>magcargo
116,mantyke,mantyke>mantine
127,lugia,singleton
128,ho-oh,singleton
144,nincada,nincada>ninjask|nincada>shedinja
146,makuhita,makuhita>hariyama
158,budew,budew>roselia|roselia>roserade
161,wailmer,wailmer>wailord
179,castform,singleton
183,tropius,singleton
186,snorunt,snorunt>glalie|snorunt>froslass
199,groudon,singleton
200,rayquaza,singleton
203,turtwig,turtwig>grotle|grotle>torterra
240,rotom,singleton
245,palkia,singleton
248,giratina,singleton
284,dwebble,dwebble>crustle
300,foongus,foongus>amoonguss
303,joltik,joltik>galvantula
306,tynamo,tynamo>eelektrik|eelektrik>eelektross
308,litwick,litwick>lampent|lampent>chandelure
314,mienfoo,mienfoo>mienshao
344,flabebe,flabebe>floette|floette>florges
349,honedge,honedge>doublade|doublade>aegislash
352,inkay,inkay>malamar
361,carbink,singleton
363,klefki,singleton
366,bergmite,bergmite>avalugg
367,noibat,noibat>noivern
368,xerneas,singleton
369,yveltal,singleton
372,hoopa,singleton
382,cutiefly,cutiefly>ribombee
384,wishiwashi,singleton
393,comfey,singleton
400,minior,singleton
407,dhelmise,singleton
413,cosmog,cosmog>cosmoem|cosmoem>solgaleo|cosmoem>lunala
415,buzzwole,singleton
418,celesteela,singleton
419,kartana,singleton
420,guzzlord,singleton
425,stakataka,singleton
428,meltan,meltan>melmetal
430,grookey,grookey>thwackey|thwackey>rillaboom
431,scorbunny,scorbunny>raboot|raboot>cinderace
432,sobble,sobble>drizzile|drizzile>inteleon
434,rookidee,rookidee>corvisquire|corvisquire>corviknight
441,rolycoly,rolycoly>carkol|carkol>coalossal
442,applin,applin>flapple|applin>appletun|applin>dipplin|dipplin>hydrapple
443,silicobra,silicobra>sandaconda
446,toxel,toxel>toxtricity
447,sizzlipede,sizzlipede>centiskorch
448,clobbopus,clobbopus>grapploct
449,sinistea,sinistea>polteageist
450,hatenna,hatenna>hattrem|hattrem>hatterene
451,impidimp,impidimp>morgrem|morgrem>grimmsnarl
453,falinks,singleton
455,snom,snom>frosmoth
459,morpeko,singleton
465,duraludon,duraludon>archaludon
466,dreepy,dreepy>drakloak|drakloak>dragapult
467,zacian,singleton
468,zamazenta,singleton
469,eternatus,singleton
470,kubfu,kubfu>urshifu
476,calyrex,singleton
484,pawmi,pawmi>pawmo|pawmo>pawmot
494,shroodle,shroodle>grafaiai
496,toedscool,toedscool>toedscruel
502,wiglett,wiglett>wugtrio
507,orthworm,singleton
511,cetoddle,cetoddle>cetitan
514,tatsugiri,singleton
519,slither-wing,singleton
523,iron-hands,singleton
528,gimmighoul,gimmighoul>gholdengo
535,koraidon,singleton
539,poltchageist,poltchageist>sinistcha
544,gouging-fire,singleton
545,raging-bolt,singleton
548,terapagos,singleton
```

### Species edge exceptions and form conditions

- Nincada has two source edges. Shedinja can appear as a by-product of evolving Nincada into Ninjask. Keep that qualifier with the family data. [Chain 144](https://pokeapi.co/api/v2/evolution-chain/144/) · [Official Pokédex](https://www.pokemon.com/br/pokedex/shedinja)
- Weavile comes from Johtonian Sneasel and Sneasler comes from Hisuian Sneasel. Preserve the source form on the second edge. [Chain 109](https://pokeapi.co/api/v2/evolution-chain/109/) · [Sneasel evolution chart](https://pokemondb.net/pokedex/sneasel#evolution)
- Tyrogue has three outcomes. Applin has two terminal branches plus a third branch that continues through Dipplin to Hydrapple. These families exercise both sibling and extended-branch coverage. [Chain 47](https://pokeapi.co/api/v2/evolution-chain/47/) · [Chain 442](https://pokeapi.co/api/v2/evolution-chain/442/)

The table lists explicit form or region fields from the pinned evolution source for these families. A blank source field is shown as unspecified. Form columns use `pokemon-form` IDs. Some rows mention cosmetic, regional or other forms outside the report's record selection. Preserve these as source condition references with explicit scope, and require roster resolution for targets used in runtime. Version-specific trigger details are available in the public source.

| Chain | Species edge | Required form | Evolved form | Region | Source version group |
|---:|---|---|---|---|---|
| 7 | `rattata` → `raticate` | `rattata-alola` #10193 | `raticate-alola` #10194 | unspecified | sun-moon |
| 10 | `pikachu` → `raichu` | `pikachu` #25 | unspecified | unspecified | red-blue |
| 10 | `pikachu` → `raichu` | `pikachu` #25 | `raichu-alola` #10202 | alola | sun-moon |
| 21 | `diglett` → `dugtrio` | `diglett-alola` #10207 | `dugtrio-alola` #10208 | unspecified | sun-moon |
| 45 | `exeggcute` → `exeggutor` | unspecified | `exeggutor-alola` #10216 | alola | sun-moon |
| 49 | `koffing` → `weezing` | unspecified | `weezing-galar` #10326 | galar | sword-shield |
| 344 | `flabebe` → `floette` | `flabebe-yellow` #10103 | `floette-yellow` #10107 | unspecified | x-y |
| 344 | `flabebe` → `floette` | `flabebe-orange` #10104 | `floette-orange` #10108 | unspecified | x-y |
| 344 | `flabebe` → `floette` | `flabebe-blue` #10105 | `floette-blue` #10109 | unspecified | x-y |
| 344 | `flabebe` → `floette` | `flabebe-white` #10106 | `floette-white` #10110 | unspecified | x-y |
| 344 | `flabebe` → `floette` | `flabebe-red` #669 | `floette-red` #670 | unspecified | x-y |
| 344 | `floette` → `florges` | `floette-yellow` #10107 | `florges-yellow` #10111 | unspecified | x-y |
| 344 | `floette` → `florges` | `floette-orange` #10108 | `florges-orange` #10112 | unspecified | x-y |
| 344 | `floette` → `florges` | `floette-blue` #10109 | `florges-blue` #10113 | unspecified | x-y |
| 344 | `floette` → `florges` | `floette-white` #10110 | `florges-white` #10114 | unspecified | x-y |
| 344 | `floette` → `florges` | `floette-red` #670 | `florges-red` #671 | unspecified | x-y |
| 366 | `bergmite` → `avalugg` | unspecified | `avalugg-hisui` #10412 | hisui | legends-arceus |
| 446 | `toxel` → `toxtricity` | unspecified | `toxtricity-low-key` #10343 | unspecified | sword-shield |
| 446 | `toxel` → `toxtricity` | unspecified | `toxtricity-amped` #849 | unspecified | sword-shield |
| 449 | `sinistea` → `polteageist` | `sinistea-antique` #10344 | `polteageist-antique` #10345 | unspecified | sword-shield |
| 449 | `sinistea` → `polteageist` | `sinistea-phony` #854 | `polteageist-phony` #855 | unspecified | sword-shield |
| 470 | `kubfu` → `urshifu` | unspecified | `urshifu-rapid-strike` #10360 | unspecified | scarlet-violet, the-isle-of-armor |
| 470 | `kubfu` → `urshifu` | unspecified | `urshifu-single-strike` #892 | unspecified | scarlet-violet, the-isle-of-armor |
| 109 | `sneasel` → `sneasler` | `sneasel-hisui` #10404 | unspecified | unspecified | legends-arceus |
| 103 | `dunsparce` → `dudunsparce` | unspecified | `dudunsparce-three-segment` #10424 | unspecified | scarlet-violet |
| 103 | `dunsparce` → `dudunsparce` | unspecified | `dudunsparce-two-segment` #982 | unspecified | scarlet-violet |
| 539 | `poltchageist` → `sinistcha` | `poltchageist-counterfeit` #1012 | `sinistcha-unremarkable` #1013 | unspecified | the-teal-mask |
| 539 | `poltchageist` → `sinistcha` | `poltchageist-artisan` #10447 | `sinistcha-masterpiece` #10448 | unspecified | the-teal-mask |

## Appendix D — Pasted list and possible additions

Read these records as optional additions to the report scope. The following line preserves the 164 supplied identifiers in their original order, in the `pokemon-species` namespace.

```text
azurill, marill, azumarill, sentret, furret, dunsparce, dudunsparce, munchlax, snorlax, ditto, wailmer, wailord, kecleon, castform, torchic, combusken, blaziken, litwick, lampent, chandelure, rolycoly, carkol, coalossal, fennekin, braixen, delphox, sizzlipede, centiskorch, heatran, charmander, charmeleon, charizard, wishiwashi, frillish, jellicent, magikarp, gyarados, dratini, dragonair, dragonite, rufflet, braviary, fletchling, fletchinder, talonflame, cutiefly, ribombee, flabebe, floette, florges, turtwig, grotle, torterra, kartana, tangela, tangrowth, carnivine, joltik, galvantula, toxel, toxtricity, tynamo, eelektrik, eelektross, xurkitree, regieleki, zekrom, rotom, snom, frosmoth, vanillite, vanillish, vanilluxe, cubchoo, beartic, kyurem, glastrier, cryogonal, pancham, pangoro, makuhita, hariyama, machop, machoke, machamp, ralts, kirlia, gallade, riolu, lucario, sawk, hitmonlee, hawlucha, foongus, amoonguss, gastly, haunter, gengar, poipole, naganadel, trubbish, garbodor, eternatus, diglett, dugtrio, onix, steelix, sandshrew, sandslash, groudon, beldum, metang, metagross, deoxys, cresselia, necrozma, grubbin, charjabug, vikavolt, nincada, ninjask, shedinja, pinsir, minior, roggenrola, boldore, gigalith, stakataka, carbink, sinistea, polteageist, giratina, gible, gabite, garchomp, axew, fraxure, haxorus, jangmo-o, hakamo-o, kommo-o, rayquaza, nickit, thievul, zorua, zoroark, impidimp, morgrem, grimmsnarl, purrloin, liepard, guzzlord, sableye, klink, klang, klinklang, klefki, celesteela, mawile, ferroseed, ferrothorn, mimikyu, xerneas, diancie
```

### Default-record slug mappings

| Pasted species slug | Default `pokemon` slug | Pokémon ID |
|---|---|---:|
| `dudunsparce` | `dudunsparce-two-segment` | 982 |
| `wishiwashi` | `wishiwashi-solo` | 746 |
| `frillish` | `frillish-male` | 592 |
| `jellicent` | `jellicent-male` | 593 |
| `toxtricity` | `toxtricity-amped` | 849 |
| `deoxys` | `deoxys-normal` | 386 |
| `minior` | `minior-red-meteor` | 774 |
| `giratina` | `giratina-altered` | 487 |
| `mimikyu` | `mimikyu-disguised` | 778 |

### Family completion for the pasted list

| Family | Complete graph | Members omitted from the pasted list | Evidence |
|---|---|---|---|
| Tyrogue | `tyrogue` → `hitmonlee`, `tyrogue` → `hitmonchan`, `tyrogue` → `hitmontop` | Hitmonchan, Tyrogue, Hitmontop | [PokéAPI chain 47](https://pokeapi.co/api/v2/evolution-chain/47/) |
| Ralts | `ralts` → `kirlia`, `kirlia` → `gardevoir`, `kirlia` → `gallade` | Gardevoir | [PokéAPI chain 140](https://pokeapi.co/api/v2/evolution-chain/140/) |

The 88 default records below fill the gap between the report and the combined scope. They include the 87 additional pasted species and Gardevoir. New gameplay roles and additional varieties can be considered per entry when an expansion is requested.

```csv
pokemon_slug,pokemon_id,species_slug,species_id,species_name,pokemon_form_slug,pokemon_form_id,form_label,types_in_slot_order,height_dm,height_kind,weight_hg,weight_kind,form_status,inclusion
axew,610,axew,610,Axew,axew,610,,dragon,6,listed,180,listed,species-default,pasted-candidate
beartic,614,beartic,614,Beartic,beartic,614,,ice,26,listed,2600,listed,species-default,pasted-candidate
beldum,374,beldum,374,Beldum,beldum,374,,steel+psychic,6,listed,952,listed,species-default,pasted-candidate
blaziken,257,blaziken,257,Blaziken,blaziken,257,,fire+fighting,19,listed,520,listed,species-default,pasted-candidate
boldore,525,boldore,525,Boldore,boldore,525,,rock,9,listed,1020,listed,species-default,pasted-candidate
braixen,654,braixen,654,Braixen,braixen,654,,fire,10,listed,145,listed,species-default,pasted-candidate
braviary,628,braviary,628,Braviary,braviary,628,,normal+flying,15,listed,410,listed,species-default,pasted-candidate
carnivine,455,carnivine,455,Carnivine,carnivine,455,,grass,14,listed,270,listed,species-default,pasted-candidate
charjabug,737,charjabug,737,Charjabug,charjabug,737,,bug+electric,5,listed,105,listed,species-default,pasted-candidate
combusken,256,combusken,256,Combusken,combusken,256,,fire+fighting,9,listed,195,listed,species-default,pasted-candidate
cresselia,488,cresselia,488,Cresselia,cresselia,488,,psychic,15,listed,856,listed,species-default,pasted-candidate
cryogonal,615,cryogonal,615,Cryogonal,cryogonal,615,,ice,11,listed,1480,listed,species-default,pasted-candidate
cubchoo,613,cubchoo,613,Cubchoo,cubchoo,613,,ice,5,listed,85,listed,species-default,pasted-candidate
delphox,655,delphox,655,Delphox,delphox,655,,fire+psychic,15,listed,390,listed,species-default,pasted-candidate
deoxys-normal,386,deoxys,386,Deoxys,deoxys-normal,386,Normal Forme,psychic,17,listed,608,listed,species-default,pasted-candidate
diancie,719,diancie,719,Diancie,diancie,719,,rock+fairy,7,listed,88,listed,species-default,pasted-candidate
ditto,132,ditto,132,Ditto,ditto,132,,normal,3,listed,40,listed,species-default,pasted-candidate
fennekin,653,fennekin,653,Fennekin,fennekin,653,,fire,4,listed,94,listed,species-default,pasted-candidate
ferroseed,597,ferroseed,597,Ferroseed,ferroseed,597,,grass+steel,6,listed,188,listed,species-default,pasted-candidate
ferrothorn,598,ferrothorn,598,Ferrothorn,ferrothorn,598,,grass+steel,10,listed,1100,listed,species-default,pasted-candidate
fletchinder,662,fletchinder,662,Fletchinder,fletchinder,662,,fire+flying,7,listed,160,listed,species-default,pasted-candidate
fletchling,661,fletchling,661,Fletchling,fletchling,661,,normal+flying,3,listed,17,listed,species-default,pasted-candidate
fraxure,611,fraxure,611,Fraxure,fraxure,611,,dragon,10,listed,360,listed,species-default,pasted-candidate
frillish-male,592,frillish,592,Frillish,frillish-male,592,Male,water+ghost,12,listed,330,listed,species-default,pasted-candidate
gabite,444,gabite,444,Gabite,gabite,444,,dragon+ground,14,listed,560,listed,species-default,pasted-candidate
gallade,475,gallade,475,Gallade,gallade,475,,psychic+fighting,16,listed,520,listed,species-default,pasted-candidate
garbodor,569,garbodor,569,Garbodor,garbodor,569,,poison,19,listed,1073,listed,species-default,pasted-candidate
garchomp,445,garchomp,445,Garchomp,garchomp,445,,dragon+ground,19,listed,950,listed,species-default,pasted-candidate
gardevoir,282,gardevoir,282,Gardevoir,gardevoir,282,,psychic+fairy,16,listed,484,listed,species-default,family-completion
gible,443,gible,443,Gible,gible,443,,dragon+ground,7,listed,205,listed,species-default,pasted-candidate
gigalith,526,gigalith,526,Gigalith,gigalith,526,,rock,17,listed,2600,listed,species-default,pasted-candidate
glastrier,896,glastrier,896,Glastrier,glastrier,896,,ice,22,listed,8000,listed,species-default,pasted-candidate
grubbin,736,grubbin,736,Grubbin,grubbin,736,,bug,4,listed,44,listed,species-default,pasted-candidate
gyarados,130,gyarados,130,Gyarados,gyarados,130,,water+flying,65,listed,2350,listed,species-default,pasted-candidate
hakamo-o,783,hakamo-o,783,Hakamo-o,hakamo-o,783,,dragon+fighting,12,listed,470,listed,species-default,pasted-candidate
hawlucha,701,hawlucha,701,Hawlucha,hawlucha,701,,fighting+flying,8,listed,215,listed,species-default,pasted-candidate
haxorus,612,haxorus,612,Haxorus,haxorus,612,,dragon,18,listed,1055,listed,species-default,pasted-candidate
heatran,485,heatran,485,Heatran,heatran,485,,fire+steel,17,listed,4300,listed,species-default,pasted-candidate
jangmo-o,782,jangmo-o,782,Jangmo-o,jangmo-o,782,,dragon,6,listed,297,listed,species-default,pasted-candidate
jellicent-male,593,jellicent,593,Jellicent,jellicent-male,593,Male,water+ghost,22,listed,1350,listed,species-default,pasted-candidate
kecleon,352,kecleon,352,Kecleon,kecleon,352,,normal,10,listed,220,listed,species-default,pasted-candidate
kirlia,281,kirlia,281,Kirlia,kirlia,281,,psychic+fairy,8,listed,202,listed,species-default,pasted-candidate
klang,600,klang,600,Klang,klang,600,,steel,6,listed,510,listed,species-default,pasted-candidate
klink,599,klink,599,Klink,klink,599,,steel,3,listed,210,listed,species-default,pasted-candidate
klinklang,601,klinklang,601,Klinklang,klinklang,601,,steel,6,listed,810,listed,species-default,pasted-candidate
kommo-o,784,kommo-o,784,Kommo-o,kommo-o,784,,dragon+fighting,16,listed,782,listed,species-default,pasted-candidate
kyurem,646,kyurem,646,Kyurem,kyurem,646,Kyurem,dragon+ice,30,listed,3250,listed,species-default,pasted-candidate
liepard,510,liepard,510,Liepard,liepard,510,,dark,11,listed,375,listed,species-default,pasted-candidate
lucario,448,lucario,448,Lucario,lucario,448,,fighting+steel,12,listed,540,listed,species-default,pasted-candidate
machamp,68,machamp,68,Machamp,machamp,68,,fighting,16,listed,1300,listed,species-default,pasted-candidate
machoke,67,machoke,67,Machoke,machoke,67,,fighting,15,listed,705,listed,species-default,pasted-candidate
machop,66,machop,66,Machop,machop,66,,fighting,8,listed,195,listed,species-default,pasted-candidate
magikarp,129,magikarp,129,Magikarp,magikarp,129,,water,9,listed,100,listed,species-default,pasted-candidate
mawile,303,mawile,303,Mawile,mawile,303,,steel+fairy,6,listed,115,listed,species-default,pasted-candidate
metagross,376,metagross,376,Metagross,metagross,376,,steel+psychic,16,listed,5500,listed,species-default,pasted-candidate
metang,375,metang,375,Metang,metang,375,,steel+psychic,12,listed,2025,listed,species-default,pasted-candidate
mimikyu-disguised,778,mimikyu,778,Mimikyu,mimikyu-disguised,778,Disguised Form,ghost+fairy,2,listed,7,listed,species-default,pasted-candidate
naganadel,804,naganadel,804,Naganadel,naganadel,804,,poison+dragon,36,listed,1500,listed,species-default,pasted-candidate
necrozma,800,necrozma,800,Necrozma,necrozma,800,,psychic,24,listed,2300,listed,species-default,pasted-candidate
nickit,827,nickit,827,Nickit,nickit,827,,dark,6,listed,89,listed,species-default,pasted-candidate
pancham,674,pancham,674,Pancham,pancham,674,,fighting,6,listed,80,listed,species-default,pasted-candidate
pangoro,675,pangoro,675,Pangoro,pangoro,675,,fighting+dark,21,listed,1360,listed,species-default,pasted-candidate
pinsir,127,pinsir,127,Pinsir,pinsir,127,,bug,15,listed,550,listed,species-default,pasted-candidate
poipole,803,poipole,803,Poipole,poipole,803,,poison,6,listed,18,listed,species-default,pasted-candidate
purrloin,509,purrloin,509,Purrloin,purrloin,509,,dark,4,listed,101,listed,species-default,pasted-candidate
ralts,280,ralts,280,Ralts,ralts,280,,psychic+fairy,4,listed,66,listed,species-default,pasted-candidate
regieleki,894,regieleki,894,Regieleki,regieleki,894,,electric,12,listed,1450,listed,species-default,pasted-candidate
riolu,447,riolu,447,Riolu,riolu,447,,fighting,7,listed,202,listed,species-default,pasted-candidate
roggenrola,524,roggenrola,524,Roggenrola,roggenrola,524,,rock,4,listed,180,listed,species-default,pasted-candidate
rufflet,627,rufflet,627,Rufflet,rufflet,627,,normal+flying,5,listed,105,listed,species-default,pasted-candidate
sableye,302,sableye,302,Sableye,sableye,302,,dark+ghost,5,listed,110,listed,species-default,pasted-candidate
sandshrew,27,sandshrew,27,Sandshrew,sandshrew,27,,ground,6,listed,120,listed,species-default,pasted-candidate
sandslash,28,sandslash,28,Sandslash,sandslash,28,,ground,10,listed,295,listed,species-default,pasted-candidate
sawk,539,sawk,539,Sawk,sawk,539,,fighting,14,listed,510,listed,species-default,pasted-candidate
talonflame,663,talonflame,663,Talonflame,talonflame,663,,fire+flying,12,listed,245,listed,species-default,pasted-candidate
tangela,114,tangela,114,Tangela,tangela,114,,grass,10,listed,350,listed,species-default,pasted-candidate
tangrowth,465,tangrowth,465,Tangrowth,tangrowth,465,,grass,20,listed,1286,listed,species-default,pasted-candidate
thievul,828,thievul,828,Thievul,thievul,828,,dark,12,listed,199,listed,species-default,pasted-candidate
torchic,255,torchic,255,Torchic,torchic,255,,fire,4,listed,25,listed,species-default,pasted-candidate
trubbish,568,trubbish,568,Trubbish,trubbish,568,,poison,6,listed,310,listed,species-default,pasted-candidate
vanillish,583,vanillish,583,Vanillish,vanillish,583,,ice,11,listed,410,listed,species-default,pasted-candidate
vanillite,582,vanillite,582,Vanillite,vanillite,582,,ice,4,listed,57,listed,species-default,pasted-candidate
vanilluxe,584,vanilluxe,584,Vanilluxe,vanilluxe,584,,ice,13,listed,575,listed,species-default,pasted-candidate
vikavolt,738,vikavolt,738,Vikavolt,vikavolt,738,,bug+electric,15,listed,450,listed,species-default,pasted-candidate
xurkitree,796,xurkitree,796,Xurkitree,xurkitree,796,,electric,38,listed,1000,listed,species-default,pasted-candidate
zekrom,644,zekrom,644,Zekrom,zekrom,644,,dragon+electric,29,listed,3450,listed,species-default,pasted-candidate
zoroark,571,zoroark,571,Zoroark,zoroark,571,,dark,16,listed,811,listed,species-default,pasted-candidate
zorua,570,zorua,570,Zorua,zorua,570,,dark,7,listed,125,listed,species-default,pasted-candidate
```

### Additional species families

```csv
chain_id,root_species_slug,species_edges
11,sandshrew,sandshrew>sandslash
28,machop,machop>machoke|machoke>machamp
52,tangela,tangela>tangrowth
62,pinsir,singleton
64,magikarp,magikarp>gyarados
66,ditto,singleton
131,torchic,torchic>combusken|combusken>blaziken
140,ralts,ralts>kirlia|kirlia>gardevoir|kirlia>gallade
149,sableye,singleton
150,mawile,singleton
180,kecleon,singleton
192,beldum,beldum>metang|metang>metagross
202,deoxys,singleton
230,gible,gible>gabite|gabite>garchomp
232,riolu,riolu>lucario
236,carnivine,singleton
246,heatran,singleton
249,cresselia,singleton
261,purrloin,purrloin>liepard
268,roggenrola,roggenrola>boldore|boldore>gigalith
275,sawk,singleton
290,trubbish,trubbish>garbodor
291,zorua,zorua>zoroark
296,vanillite,vanillite>vanillish|vanillish>vanilluxe
301,frillish,frillish>jellicent
304,ferroseed,ferroseed>ferrothorn
305,klink,klink>klang|klang>klinklang
309,axew,axew>fraxure|fraxure>haxorus
310,cubchoo,cubchoo>beartic
311,cryogonal,singleton
319,rufflet,rufflet>braviary
331,zekrom,singleton
333,kyurem,singleton
338,fennekin,fennekin>braixen|braixen>delphox
341,fletchling,fletchling>fletchinder|fletchinder>talonflame
346,pancham,pancham>pangoro
359,hawlucha,singleton
371,diancie,singleton
379,grubbin,grubbin>charjabug|charjabug>vikavolt
404,mimikyu,singleton
408,jangmo-o,jangmo-o>hakamo-o|hakamo-o>kommo-o
417,xurkitree,singleton
421,necrozma,singleton
424,poipole,poipole>naganadel
436,nickit,nickit>thievul
472,regieleki,singleton
474,glastrier,singleton
```

The expansion includes the species defaults. The source also records Alolan Sandshrew → Alolan Sandslash, Hisuian Zorua → Hisuian Zoroark and Rufflet → Hisuian Braviary with their form or regional constraints. Those varieties can be resolved from PokéAPI if an expanded scope includes them. [Sandshrew family](https://pokeapi.co/api/v2/evolution-chain/11/) · [Evolution condition records](https://github.com/PokeAPI/pokeapi/blob/8a92bfa7dab2f12b84b5d151562f9857c133ff30/data/v2/csv/pokemon_evolution.csv)
