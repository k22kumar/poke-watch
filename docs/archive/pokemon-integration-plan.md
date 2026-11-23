# Poke-watch Pokémon integration plan

Progress record for the staged integration described in `docs/archive/pokemon-integration-handoff.md`.
Written for the Claude Code sessions that run Prompts 4–8 and for the maintainer supervising them.

- **Stage completed by this session:** Prompt 4 — Integrate the canonical catalogue and full families. Prompt 5 is recorded as satisfied without changes; Prompt 6 can proceed.
- **Earlier stages:** Prompt 3 (reconciliation, §§1–12 below) and Prompt 2 (baseline, recorded in the handoff at `5b82fa0`).
- **Adopted scope:** the 269-record report scope (Appendices B and C). **Appendix D is not adopted** — no explicit expansion was requested.

> **Prompt 4 results are in §14.** Sections 1–13 are the Prompt 3 reconciliation, kept as written except where a claim became stale; those corrections are marked **[corrected]** and listed in §14.8.

---

## 1. Repository state inspected

| Item | Value |
|---|---|
| Branch | `main` |
| HEAD | `5b82fa0` "Remove external ChatGPT links" |
| Audit commit cited by the handoff | `7e6f137` |
| `7e6f137..HEAD` diff | `docs/Pokemon_Environment_Interaction_Specification.md` only (6 insertions, 6 deletions) |
| Working tree | clean except untracked `docs/archive/pokemon-integration-handoff.md` and this file |
| Node / npm | v24.21.0 / 11.19.0 |
| Parallel sessions | `dist/index.html` (11.7 MB, 2026-11-14 20:06) is another session's build; do not overwrite |

**Audited boundaries re-checked and confirmed valid at HEAD.** No script, source or generated content file changed between the audit commit and HEAD, so every boundary the handoff's audit asserts still holds. The findings in §4 were verified against the working tree, not inherited from the audit.

### 1.1 Baseline status — recorded **[corrected]**

The original text of this section said Prompt 2 had never run. That was wrong, and it was wrong when written: the handoff revision this plan cites carries a **Recorded baseline** section for `main` at `5b82fa0ea5f48305c514d1c47f8486f6954a508f` — the same commit, Node and OS this session used — with typecheck, `npm test` (318/318 across 31 files), the performance gate, `habstate` (24/24), `hazplay` (49/49), `habplay` (72/72), `habaudit` and an isolated production build, plus 20 observed replay-hash pairs across five modes. Prompt 2 was therefore complete for these inputs and was **not** a blocker.

**Inputs tested at `5b82fa0` are unchanged at this session's HEAD** (same commit; working tree clean apart from untracked documents), so the baseline was reused rather than re-measured, exactly as the handoff's "Run next" step 2 allows. Prompt 4's comparisons in §14.4 are against those recorded values.

Two baseline checks had no recorded values and were measured this session for later stages: `checksum.ts gen` and `gen-classic` (§14.4).

---

## 2. Expected sets — exact pointers

The handoff is the stable authority. Extract with these commands from the repository root; each is a fenced block in `docs/archive/pokemon-integration-handoff.md` at the revision committed with this plan.

| Set | Command | Must yield |
|---|---|---|
| Appendix B records (CSV, 15 columns) | `sed -n '618,887p' docs/archive/pokemon-integration-handoff.md` | 1 header + **269** rows |
| Appendix B master slug list | `sed -n '893p' docs/archive/pokemon-integration-handoff.md` | **269** comma-separated slugs |
| Appendix C families (CSV) | `sed -n '903,1011p' docs/archive/pokemon-integration-handoff.md` | 1 header + **108** rows |
| Appendix C edge exceptions and form conditions | `sed -n '1014,1051p' docs/archive/pokemon-integration-handoff.md` | prose + 28-row condition table |

**[corrected]** Every line range in this table was wrong by about 35 lines when written, and the ranges above are the verified ones for the handoff revision in the working tree. The advice below is what caught it, so follow it rather than the numbers: re-anchor on the headings `### Record data`, `### Master PokéAPI slug list`, `### Species family graph` and `### Species edge exceptions and form conditions` and assert the counts above before use. All seven counts in §2.1 reproduce from the re-anchored ranges.

### 2.1 Appendix B and C verified internally consistent

Every count in the handoff's "Integration scope" table reproduces exactly from the appendices:

| Handoff claim | Count | Verified |
|---|---:|---|
| Selected `pokemon` records and family or form additions | 269 | ✅ 269 rows, 269 distinct `pokemon_slug`, 269 distinct `pokemon_id`, **0 duplicates** |
| Distinct species, each with its default `pokemon` record | 210 | ✅ 210 distinct `species_slug`, exactly one `form_status=species-default` row each |
| Additional `pokemon` varieties among the 269 | 59 | ✅ 269 − 210 |
| Records directly selected by the research tables | 146 | ✅ `inclusion=selected`; remaining 123 are `family-or-form` |
| Complete species evolution families | 108 | ✅ 108 rows, 108 distinct `chain_id` |
| Directed species evolution edges | 102 | ✅ 102 edges, **0 duplicate edges** |
| Families consisting of one species | 39 | ✅ 39 rows whose `species_edges` is the literal `singleton` |

Cross-checks: the master slug list and the CSV agree exactly in both directions (0 differences). Appendix C's 171 edge-participating species plus its 39 singleton roots = **210**, matching Appendix B's species set exactly, with no species in one appendix and absent from the other.

**Note for parsers:** a singleton family encodes `species_edges` as the literal string `singleton`, **not** as the root slug. A parser that splits that column on `>` will emit a phantom species named `singleton`. Guard on it explicitly.

### 2.2 Shape of the expected data

- **Types.** 171 records dual-type, 98 mono-type. `types_in_slot_order` is `+`-joined and slot-ordered; preserve the order (it is display-visible and feeds `elements`).
- **Measurement qualifiers.** `height_kind` ∈ {`listed`, `lower-bound`}; `weight_kind` ∈ {`listed`, `unknown-placeholder`}. **16 records** carry a non-`listed` qualifier: 15 Gigantamax records (`height_kind=lower-bound`, `weight_hg=10000` `unknown-placeholder`) and `eternatus-eternamax` (`height_dm=1000` listed, `weight_hg=0` `unknown-placeholder`). Units are decimetres and hectograms; divide by 10.
- **Form status.** `species-default` 210, `persistent-alternate` 24, `temporary` 22, `regional` 8, `out-of-battle-build` 4 (Koraidon's rides), `persistent-fusion` 1 (`calyrex-ice`).
- **Alternate default slugs — 9 species whose default record's slug is not the species slug.** These cannot be resolved by name from the species slug; `pokemon/aegislash` and `pokemon/tatsugiri` do not exist as PokéAPI resources:

  `aegislash`→`aegislash-shield`, `dudunsparce`→`dudunsparce-two-segment`, `giratina`→`giratina-altered`, `minior`→`minior-red-meteor`, `morpeko`→`morpeko-full-belly`, `tatsugiri`→`tatsugiri-curly`, `toxtricity`→`toxtricity-amped`, `urshifu`→`urshifu-single-strike`, `wishiwashi`→`wishiwashi-solo`.

- **Branching parents — 6.** The expected graph has six parents with more than one child:

  `tyrogue` → hitmonlee, hitmonchan, hitmontop · `applin` → flapple, appletun, dipplin · `sneasel` → weavile, sneasler · `nincada` → ninjask, shedinja · `snorunt` → glalie, froslass · `cosmoem` → solgaleo, lunala.

- **Maximum family depth is 2 edges from the root** (83 of the 108 families have edges: 44 at depth 1, 25 at depth 2 — the remaining 39 are singletons). Depth alone is therefore cheap; **branching is the structural problem**, not depth.

---

## 3. Coverage disposition for all 269 expected records

Matched by explicit source identity: Appendix B `pokemon_slug` against the `id` field of `POKEDEX_SPECIES` in `src/content/pokedex.ts` (the game ID is the PokéAPI `pokemon` slug, confirmed at `scripts/import-pack.mjs:325`).

| Disposition | Records | Needs |
|---|---:|---|
| **Already supported, with an existing runtime role** | 7 | Nothing. Verified value-identical to Appendix B. |
| **Catalogue only** (reference entry, no game role) | 262 | Data + code (new catalogue lane). No assets, no moves, no role rules. |
| **Mismapped** | 0 | — |
| **Duplicate** | 0 | — |

### 3.1 The 7 already-supported records

All 7 are exact `pokemon_slug` matches with existing, established runtime roles. **No data change is required for any of them.**

| Record | Existing role (from `content/roster.json`) | Appendix B inclusion |
|---|---|---|
| `charmander` | partner (playable starter), curated learnset, `partnerEvolutions: 2` | family-or-form |
| `charmeleon` | partner evolution stage 1 | family-or-form |
| `charizard` | partner evolution stage 2 | family-or-form |
| `rattata` | wild `chase`; also `sudowoodo`'s boss summon; stage-1 and stage-3 spawn | family-or-form |
| `gastly` | wild `ranged`/`wisp`, `flying: true`; stage-4 spawn | **selected** |
| `slugma` | wild `chase`; also `magcargo`'s boss summon; stage-2 spawn | family-or-form |
| `magcargo` | **boss**, stage 2, "Molten shell", summons `slugma` | **selected** |

**Source revision check — no differences found.** For all 7, types in slot order, `canon.heightM`, `canon.weightKg` and `dex` agree exactly with Appendix B at the pinned CSV revision `8a92bfa7dab2f12b84b5d151562f9857c133ff30`. Example: `magcargo` fire,rock / 0.8 m / 55.0 kg / dex 219 — exact. No value drift to reconcile and no expected value to override.

Observe that gameplay and canonical values are **already separate and already diverge**, which is the pattern to preserve: `gastly` has `canon.heightM = 1.3` but gameplay `height = 1.97`; `magcargo` has `canon.heightM = 0.8` but gameplay `height = 3.38`. Gameplay `height` is derived from the sprite's pixel height clamped to [0.9, 3.2] (`scripts/import-pack.mjs:360`), independent of the canonical figure.

### 3.2 The 262 catalogue-only records

262 records = 269 − 7. Of these, **203 species-default** records and **59 varieties**. Full list regenerable with:

```bash
sed -n '583,852p' docs/archive/pokemon-integration-handoff.md | tail -n +2 | cut -d, -f1 \
  | grep -vxE 'charmander|charmeleon|charizard|rattata|gastly|slugma|magcargo'
```

Every one of the 262 is **catalogue only**: no existing game role, and none was explicitly requested as a runtime actor. Per the handoff's working default they stay canonical reference records. Temporary forms (22) and Koraidon's 4 ride builds are canonical reference by rule and are not candidates for runtime promotion.

### 3.3 Family lookup and in-run evolution — checked independently

The handoff requires these be checked separately, and in this repository they are genuinely different things.

**In-run evolution (`evolvesTo` / `evolveLevel`)** is the game's paced progression. It currently holds **12 edges**, all of them the six starter lines: bulbasaur→ivysaur→venusaur, charmander→charmeleon→charizard, squirtle→wartortle→blastoise, chikorita→bayleef→meganium, cyndaquil→quilava→typhlosion, totodile→croconaw→feraligatr. Consumers: `src/sim/progression.ts:356` (player evolve), `:325` (bench evolve), `src/ui/ui.ts:1241` (line display), and three **reverse scans** that search `SPECIES` for a predecessor — `src/rules/species.ts:54` (`starterFamilyRoot`), `src/sim/progression.ts:61` (`lineage`), `src/world/habitat/mode.ts:51` (`playableLine`).

**Of Appendix C's 102 expected edges, 2 are already present**: `charmander>charmeleon` and `charmeleon>charizard`. The other 10 existing edges (the five non-Charmander starter lines) are **outside** the expected scope and must stay untouched.

**Canonical family lookup does not exist in this repository.** There is no family, chain or evolution-graph structure anywhere in `src/` or in the generated content. `canon` (`src/rules/species.ts:34`) carries `evolveLevel` and `evolveTrigger` but no parent, child or chain identity. So all 108 families and all 102 edges need new storage — this is a build, not a reconciliation.

**This is also the reason the 100 missing edges must not be written into `evolvesTo`.** Those three reverse scans would then walk canonical predecessors: `starterFamilyRoot` would resolve a starter's root through a catalogue record, and `playableLine()` would extend the trainer body-profile set. Prompt 4's instruction to "preserve canonical relationships independently of the game's primary `evolvesTo` and pacing fields" is load-bearing here, not stylistic.

---

## 4. Findings that shape the work

Each was verified against the working tree at HEAD.

### F1 — Catalogue records must not enter `POKEDEX_SPECIES` (blocking design constraint)

`src/rules/species.ts:46` is `export const SPECIES = POKEDEX_SPECIES`, so anything added to the generated pokedex enters the sim's species universe. Two consumers derive **values from the whole set**, not by lookup:

```
src/world/habitat/mode.ts:64   const wild = SPECIES.filter((s) => !s.boss && !s.flying);
src/world/habitat/mode.ts:65   const bosses = SPECIES.filter((s) => s.boss && !s.flying);
```

`profilesFor()` takes min/max over those sets to produce the `wild-small`, `wild-elite` and `boss` navigation radii, and `playableLine()` (`:48`) feeds the `trainer` profile's height extremes. Adding 262 records changes those radii, which changes which habitat layouts are accepted — forcing a `HAB_VERSION` bump, a `docs/habaudit/baseline.json` regeneration and replay checksum drift, **for a change that is supposed to be data-only**.

Other whole-set consumers: `src/sim/build.ts:436` (transform-capable species list), `src/sim/run.ts:84` (`speciesIndex`), `src/ui/ui.ts:365` and `:408` (starter offers, filtered by `playable` — safe).

Two test invariants were checked and are **not** at risk, which is worth recording so Prompt 4 does not over-engineer:
- `tests/identity.test.ts:55` asserts every `abilityOf(sp)` is supported. `abilityOf` (`src/rules/abilities.ts:52`) only ever returns an ability already marked `supported` (17 of 26 defined), so unknown abilities return `null`. The assertion is vacuous for new entries.
- `tests/squad.test.ts:24` requires a Tag Action for every species that is `playable` or whose line base is a stage spawn. Catalogue records are neither, so they are skipped — **provided** they do not acquire `evolvesTo` edges that make `lineage(sp)[0]` resolve into a recruitable base.

### F2 — Art is mandatory in the importer and keyed to the species, not the variety

`importOne` calls `importSprites(dex)` unconditionally (`scripts/import-pack.mjs:331`), and `buildSpecies` (`:364`) requires `e.sprites.atlasPng`. `importSprites` fetches `sprite/<dex4>/AnimData.xml` **non-optionally**, so a species with no SpriteCollab folder throws `missing source:` (`:137`) and fails the whole import. Many expected species are recent (`gouging-fire`, `raging-bolt`, `archaludon`, `terapagos`, `poltchageist`, `sinistcha`) and plausibly have no sheets.

`dex` is the **species** id (`:330`), so `importSprites` resolves `weezing-galar` to `sprite/0110` — base Weezing art. This is exactly the identity mismatch the handoff flags ("SpriteCollab's species folder and the game art key are different identities"). It is harmless while no variety is a runtime actor, and would be a correctness bug the moment one is.

**The catalogue lane must bypass `importSprites` and the cry fetch entirely.**

### F3 — Art payload makes a bundled catalogue infeasible

`src/content/art.json` is 1.67 MB for 38 species, averaging **43.9 KB per species** (32 KB `rattata` … 70 KB `typhlosion`). At that rate 269 records project to **≈11.5 MB** of additional art. `src/main.ts:39` imports `art.json` statically, so it all lands in the single-file build; `dist/index.html` is already 11.7 MB. This independently confirms the handoff's "avoid expanding art payload for catalogue entries" as a hard requirement, not a preference.

### F4 — The importer follows one child only

```
scripts/import-pack.mjs:191  async function evolutionInfo(speciesJson, pokemonName) {
scripts/import-pack.mjs:195    const next = node?.evolves_to?.[0];
```

It returns a single `{to, level, trigger}` and discards siblings. The six branching parents in §2.2 cannot be represented. Wild and boss entries are imported with `--evolutions 0` (`scripts/build-content.mjs:41`) so they get no relatives at all. Both match the handoff's audit. A full-graph walk is new code.

### F5 — `scripts/fetch-sources.sh` cannot see a catalogue list

Its `NAMES` (l. 10) and `IDS` (l. 17) derivations read only `[...r.partners, ...Object.keys(r.wild), ...Object.keys(r.bosses)]` from `content/roster.json`. A new authored catalogue input is invisible to it, so sparse checkouts would omit every catalogue record. It also drives the `spritecollab` (l. 35) and `cries` (l. 37) sparse sets from the same `IDS` list — catalogue ids must be added to the `api-data` checkout **only**.

### F6 — The local cache covers the current 38 species only

`.import-cache` holds 1094 entries / 27 MB, of which 359 are JSON: 38 `pokemon`, 38 `pokemon-species`, 24 `evolution-chain`, 259 `move`. Spot probes confirm misses for `pokemon/applin`, `pokemon-species/tyrogue`, `evolution-chain/47`, `pokemon/weezing-galar`, `pokemon/dudunsparce-two-segment`, `pokemon/snorlax`. `../src-data` does not exist. The fixture mirror (`tests/fixtures/mirror`) covers only the three test starters.

**Prompt 4 therefore needs fresh source acquisition** — roughly 269 `pokemon` + 210 `pokemon-species` + 108 `evolution-chain` ≈ **587 JSON documents** — via network or new sparse clones. Everything fetched is cached, so the fetch is paid once.

### F7 — Canonical measurement qualifiers have nowhere to live, and placeholders would poison a gameplay rule

`canon` (`src/rules/species.ts:34`) is `{ levelUp, abilities, heightM, weightKg, evolveLevel?, evolveTrigger? }` — no qualifier fields. `weightClass()` (`:85`) reads `sp.canon?.weightKg ?? 20`. Storing the Gigantamax placeholder `weight_hg = 10000` as `weightKg = 1000` yields class 4 "Massive", and `eternatus-eternamax`'s `0` yields class 0 "Weightless", both from values the source marks as unknown. While catalogue records stay out of `SPECIES` (F1) `weightClass` never sees them, so this is latent rather than live — but the qualifier must be stored for the 16 affected records, and any future runtime promotion of a Gigantamax form must consult it.

### F8 — No test asserts content inventory

No test in `tests/` references `content/roster.json` or `src/content/pokedex.ts`; only `tests/camstability.test.ts:13` imports `art.json`. There is no existing coverage that would catch a missing record, a dropped edge or a mismapped identity. Prompt 6's data gate needs a **new** test file; there is nothing to extend.

---

## 5. Scoped decisions

Required-scope choices with no existing precedent in the repository. Each gives plain-language options and the simplest suitable default. **Prompt 4 should adopt the defaults unless the maintainer says otherwise, and record the choice here.**

### D1 — Where catalogue records live · default: a separate generated module

- **A (default). Separate authority.** Generate `src/content/catalogue.ts` (`CATALOGUE_RECORDS`, `CATALOGUE_FAMILIES`) and a thin `src/rules/catalogue.ts` for types and lookup. `POKEDEX_SPECIES` and `SPECIES` are untouched. Nothing in `src/sim/`, `src/world/` or `src/render/` imports it, so the sim universe, the habitat profiles and every replay hash are unchanged by construction, and esbuild drops it from the bundle until something imports it.
- **B. One merged list with a flag.** Add the records to `POKEDEX_SPECIES` with `catalogue: true` and filter at each whole-set consumer. Touches at least `mode.ts:64-65`, `mode.ts:51`, `build.ts:436`, `species.ts:54`, `progression.ts:61`. Any missed site is a silent habitat or checksum regression.
- **C. Out-of-bundle data file.** Ship as JSON read only by tests and tooling. Cheapest, but a future Pokédex UI could not use it without new loading code.

**Why A:** it makes F1 structurally impossible rather than a thing to remember, and it is the only option under which "no replay hash moved" is a provable claim instead of a test result.

### D2 — Authored input · default: a new `content/catalogue.json`

- **A (default). New file.** `content/catalogue.json` pins all 269 identities explicitly as `{pokemon_slug, pokemon_id, species_slug, species_id}`, transcribed from Appendix B. `content/roster.json` keeps its stated job — "what role each Pokémon plays" — and gains nothing.
- **B. A `catalogue` array inside `roster.json`.** One fewer file, but mixes the gameplay-role authority with a reference list and enlarges the file every role consumer reads.

**Why A:** separation of authorities, and it is the file Prompt 8 will check for duplicate authorities.

Pinning `pokemon_id` is **required either way, not cosmetic**: the 9 alternate defaults in §2.2 cannot be fetched by species slug, so resolution must go by numeric id or through `species.varieties[].is_default`. Fetch by id and assert the returned `pokemon.name` equals the expected `pokemon_slug`.

### D3 — Overlap of the 7 supported records · default: catalogue covers all 269

- **A (default). Catalogue holds all 269; the pokedex stays the gameplay authority for its 38.** The catalogue carries canonical facts only (no `playable`, `learnset`, `behaviour`, `boss`, `art`); the pokedex carries gameplay. Appendix B verification reads one self-contained set. A gate test asserts the two agree on types, `heightM` and `weightKg` for the 7 overlapping ids.
- **B. Catalogue excludes the 38 pokedex ids.** No duplicated field values anywhere, but the data gate must union two sets and special-case 7 ids, and the catalogue stops being a faithful image of Appendix B.

**Why A:** the duplication is two records of different kinds about one identity, not two competing authorities, and the agreement test turns the overlap into a continuous cross-check of the pipeline.

### D4 — Canonical level-up moves for catalogue records · default: omit

- **A (default). Omit `levelUp`.** Store types, dimensions with qualifiers, abilities, form fields and family edges. Abilities and the move list with levels already arrive inside the `pokemon` payload, so no extra fetch is needed for what is kept. Building `canon.levelUp` the way `importOne` does (`:333-337`) requires one `move/<name>` fetch per distinct move to produce a `MoveData` row — thousands of requests — and moves are Optional/Conditional scope with no confirmed runtime actor to need them.
- **B. Store raw level/move-name pairs** from the `pokemon` payload without fetching move data. No extra requests, but adds roughly 1–2 KB per record (≈400 KB total) of data nothing reads.
- **C. Full `canon.levelUp` with `MoveData` rows.** Only if a runtime role is later confirmed, and then only for that actor.

**Why A:** smallest artifact that satisfies required scope. Option B is a one-line change if a Pokédex UI later wants it.

**`POKEDEX_MOVES` must not grow.** `src/rules/moves.ts:29` derives `MOVES` from it, and `src/rules/moves.ts:37` derives the archetype table; growth would reach `src/sim/build.ts` and the combat tests. Assert its length is unchanged.

### D5 — Family edge storage · default: a dedicated table keyed by chain

- **A (default).** `CATALOGUE_FAMILIES: { chainId, root, edges: [parent, child][], singleton }[]` plus the Appendix C form/region conditions as a parallel reference list. Represents all 6 branching parents and all 39 singletons directly. `evolvesTo` / `evolveLevel` are not touched.
- **B.** Per-record `canon.family` fields. Duplicates each family across its members and makes branch reconstruction a join.

**Why A:** one row per chain matches the source's own shape and the verification set, and it keeps canonical relationships provably independent of in-run pacing (§3.3).

---

## 6. Affected paths and symbols

| Path | Symbol / site | Change under the §5 defaults |
|---|---|---|
| `content/catalogue.json` | — | **New.** 269 pinned identities (D2). |
| `scripts/fetch-sources.sh` | `NAMES` (l. 10), `IDS` (l. 17), sparse-checkout calls (l. 16, 24, 35, 37) | Add catalogue ids to the **`api-data`** checkout only (`pokemon/<id>/`, `pokemon-species/`, `evolution-chain/`). Leave `spritecollab` (l. 35) and `cries` (l. 37) driven by the role `IDS`. (F5) |
| `scripts/import-pack.mjs` | new `catalogueOne()`; new `familyGraph()` | **New catalogue lane** that skips `importSprites` (l. 331) and the cry block, and does not build move rows. Full-graph walk alongside `evolutionInfo` (l. 191), which stays as-is for the role lane. (F2, F4) |
| `scripts/build-content.mjs` | after `runImport` (l. 39–41); `art[s.id]` (l. 78); `defs` (l. 80) | Run the catalogue import; write `src/content/catalogue.ts`. **Do not** add catalogue entries to `species`, `art`, `defs` or `moves`. Extend `content/report.json` provenance. (F1, F3) |
| `src/content/catalogue.ts` | `CATALOGUE_RECORDS`, `CATALOGUE_FAMILIES` | **New, generated.** Add the "do not edit by hand" header and list it in CLAUDE.md §Generated files. |
| `src/rules/catalogue.ts` | types, `CATALOGUE_BY_ID`, `familyOf()` | **New.** Must run in Node: no `render/`, `ui/`, `audio/`, `input/`, `assets/` imports. |
| `tests/catalogue.test.ts` | — | **New.** The data gate (F8). |
| `src/rules/species.ts` | `SPECIES`, `SPECIES_BY_ID`, `canon` | **Expected diff: none.** A non-zero diff here is a signal to re-read D1. |
| `src/world/habitat/mode.ts` | `profilesFor`, `playableLine` | **Expected diff: none.** (F1) |
| `src/content/pokedex.ts`, `src/content/art.json` | — | **Expected diff: none** beyond regeneration noise. |
| `docs/SPECIES.md`, `docs/PIPELINE.md` | — | Update when the catalogue lane lands (CLAUDE.md: update the subsystem doc with its rules). |

Qualifier fields from F7 (`heightKind`, `weightKind`) belong on the catalogue record. Extending `SpeciesDef.canon` is **not** required under D1 and should be deferred until a runtime actor needs it.

---

## 7. Validation commands

Run from the repository root.

**Content regeneration**
```bash
bash scripts/fetch-sources.sh ../src-data        # or: npm run content:net  (network)
node scripts/build-content.mjs --clones ../src-data
```

**Required gates**
```bash
npm run typecheck
npx tsx --test tests/catalogue.test.ts            # new data gate
npm test
npx tsx scripts/checksum.ts                       # all modes; must match the Prompt 2 baseline exactly
npx tsx scripts/perf-sim.ts 500 --repeat 3 --gate # p95 <= 2 ms, p99 <= 3 ms
```

**Habitat guard** — expected unaffected under D1; `habstate` is the cheap proof:
```bash
npx tsx scripts/habstate.ts
npx tsx scripts/habplay.ts all --raid
npx tsx scripts/hazplay.ts
npx tsx scripts/habaudit.ts                       # slow; only if a profile value moved
```

**Build** — `npm run build`, `npm run dev` and `npm run check` all write `dist/`, which another session owns (§1). Copy `scripts/build.mjs` to the scratchpad with the output path changed and build there; compare that size against the baseline's isolated build, not against the current `dist/index.html`.

---

## 8. Stage dependencies and boundaries

| Prompt | Boundary | Depends on | Status |
|---|---|---|---|
| 2 · Baseline | Required | — | **Done** at `5b82fa0` (handoff §Recorded baseline). **[corrected]** |
| 3 · Reconcile | Required | — | **Done** (§§1–13) |
| 4 · Catalogue and families | **Required** — 262 records and 100 edges missing | Prompt 2; D1–D5 adopted; source acquisition (F6) | **Done** (§14) |
| 5 · Runtime actors | **Conditional — satisfied without changes** | Prompt 4 | **Done**, verified in §14.5. No new role in scope. |
| 6 · Data gate | Required | Prompt 4 | **Ready.** `tests/catalogue.test.ts` exists (F8 closed); Prompt 6 verifies it independently |
| 7 · Runtime gate | Required | Prompts 4–6; Prompt 2 for hash comparison | Ready. §14.4 already holds the comparable runtime evidence |
| 8 · Acceptance | Required | Both gates | Blocked on Prompt 6 |

**Prompt order is followed as written.** Deviation recorded: Appendix D is not adopted. The earlier claim that Prompt 2 was skipped and had to run out of order was mistaken (§1.1).

**Optional scope, explicitly excluded** (handoff §Gameplay scope): branch picker, franchise evolution triggers, transformation mechanics, new locomotion profiles, new abilities, new encounters for reference entries, bulk art loading. None has a gameplay reason in this scope. Appendix C's 28 form/region conditions are preserved as **source condition references**; only targets used at runtime would need roster resolution, and none is.

### 8.1 Runtime Actors (Prompt 5) — satisfied without changes

No new runtime role is confirmed or requested. All 262 missing records are catalogue only (§3.2), and the 7 supported records keep the roles they already have (§3.1) with no data change. Prompt 5's own instruction covers this case: "If current roles already resolve and no new runtime role is confirmed, verify the existing paths and record this stage as satisfied without changes."

**No independently testable prerequisite is outstanding for this stage.** Verification is confined to showing nothing moved:

1. The 7 ids still resolve through `SPECIES_BY_ID` with unchanged types, stats and gameplay `height`.
2. `charmander` runs its start → evolve → `charizard` path; `magcargo` spawns as the stage-2 boss and summons `slugma`; `gastly` and `rattata` spawn from their stage tables.
3. All replay checksum modes match the baseline exactly.
4. `profilesFor()` returns identical values; `HAB_VERSION` stays 2 and `docs/habaudit/baseline.json` is not regenerated.

Should a runtime role later be requested, F2 (variety art resolves to the species folder) becomes a blocking prerequisite for any non-default variety and must be fixed and tested on its own before that actor is enabled.

---

## 9. Acceptance criteria

**Required scope — catalogue and families**
1. All **269** expected `pokemon` identities resolve from reproducible inputs; 0 missing, 0 duplicate, 0 mismapped. Matched on `pokemon_slug` **and** `pokemon_id`.
2. All **210** species present, each with exactly one default record; the **9** alternate default slugs resolve to the Appendix B slug via source linkage, not by name guess.
3. All **102** directed edges and all **39** singletons present. The **6** branching parents keep every child: `tyrogue`'s three, `applin`'s three plus `dipplin`→`hydrapple`, `nincada`'s `shedinja` by-product, `sneasel`'s two, `snorunt`'s two, `cosmoem`'s two.
4. Types preserved in slot order for all 269 (171 dual, 98 mono).
5. Measurement qualifiers preserved for the **16** non-`listed` records; no placeholder is exposed as a plain value.
6. Canonical facts and gameplay values remain separate fields, per the existing `canon` precedent.
7. Appendix C's 28 form/region conditions retained as scoped source references.

**Invariance — what must not move**
8. `npx tsx scripts/checksum.ts` matches the Prompt 2 baseline in **every** mode (`on`, `off`, `build-off`, `world-off`, `hazards-off`, `gen`, `gen-classic`).
9. `POKEDEX_SPECIES` still has 38 entries; `POKEDEX_MOVES` length unchanged; `STAGE_TABLES` unchanged.
10. `profilesFor()` values unchanged; `HAB_VERSION` still 2; `docs/habaudit/baseline.json` not regenerated.
11. `src/content/art.json` byte size unchanged (±0 species). Isolated build size within noise of the baseline.
12. `npm run typecheck` and `npm test` at least as green as the baseline, with no newly skipped test.
13. `perf-sim 500 --repeat 3 --gate` passes p95 ≤ 2 ms and p99 ≤ 3 ms.

**Provenance and hygiene**
14. `content/report.json` records the source revision for catalogue fetches. The expected pinned revision is `8a92bfa7dab2f12b84b5d151562f9857c133ff30`; any difference is recorded with the fields it affects, and the expected scope is retained regardless.
15. Generated files carry the "do not edit by hand" header and are listed in CLAUDE.md §Generated files.
16. No private conversation, project or upload links or identifiers in any changed file (Prompt 8).

---

## 10. Progress table

| # | Stage | Boundary | Status | Evidence |
|---|---|---|---|---|
| 2 | Baseline | Required | ✅ Done at `5b82fa0` **[corrected]** | Handoff §Recorded baseline; inputs unchanged at this session's HEAD (§1.1) |
| 3 | Reconcile | Required | ✅ Done | §§1–13. 269/210/59/146 and 108/102/39 verified; 7 supported, 262 catalogue only, 0 mismapped, 0 duplicate |
| 4 | Catalogue and families | Required | ✅ Done | §14. 269/269 records, 210 species, 59 varieties, 108 families, 102 edges, 39 singletons, 28 conditions; 12/12 new gate tests |
| 5 | Runtime actors | Conditional | ✅ Satisfied without changes | §14.5. 7 ids resolve unchanged; 0 new roles; all 20 baseline hash pairs identical |
| 6 | Data gate | Required | ✅ **Done — PASS** | §15. Appendices B/C re-parsed independently; 269/210/59/108/102/39/28 and 146 selections reproduce at all three layers, 0 discrepancies; catalogue byte-identical from two routes |
| 7 | Runtime gate | Required | ✅ **Done — PASS** | §16. 28/28 replay pairs identical (20 recorded + 8 `gen`/`gen-classic`); 330/330 tests; perf gate PASS; habstate 24/24, hazplay 49/49, habplay 72/72 ×2; habaudit `HAB_VERSION` 2 with only the 8 pre-existing `nav` rows; build byte-identical to pristine HEAD; browser smoke passes |
| 8 | Acceptance | Required | ✅ **Done — PASS** | §17. Appendices B/C re-derived against all three layers: 269/210/59/146 and 108/102/39/28, 0 discrepancies by ID; 7-record gameplay evidence and the 38-id runtime registry reported separately; all 16 §9 criteria hold; open items are the deferred role-lane regeneration, the 8 pre-existing `nav` rows and latent F2 |

**Totals to carry forward:** expected 269 records / 210 species / 59 varieties / 108 families / 102 edges / 39 singletons. **Validated: 269 records, 210 species, 59 varieties, 108 families, 102 edges, 39 singletons, 28 form/region conditions — the full expected set, 0 missing, 0 duplicate, 0 mismapped.** Catalogue-only coverage: 262 records. Runtime actors: 5 species in 4 existing roles (1 partner line of 3, 3 wild, 1 boss), 0 new, 0 blocked. **Independently re-verified in §15, including the 146 direct selections (the one column a source-derived diff cannot check).** Coverage is reported in two separate figures: **catalogue lookup coverage 269/269**, **playable/shipped runtime coverage 38 ids** with an intersection of exactly 7.

---

## 11. Blockers by stage

All Prompt 4 blockers are resolved. Original entries with their outcome:

| Stage | Blocker | Outcome |
|---|---|---|
| 4 | ~~No baseline~~ | **Was never a blocker** — recorded at `5b82fa0` (§1.1). |
| 4 | **Source data absent** (F6) — cache covers 38 species, `../src-data` missing | **Resolved without the ≈587 JSON documents.** The pinned CSV snapshot supplies every required field in 10 files (§14.2), so no per-record fetch was needed. |
| 4 | **`fetch-sources.sh` cannot see a catalogue list** (F5) | **Resolved differently from the plan's proposal:** the catalogue needs no `api-data`, sprites or cries at all, so the roster-driven sets are untouched and a new pinned `pokeapi-csv` checkout was added instead (§14.3). |
| 4 | **Importer requires art and throws without it** (F2) | **Resolved.** The catalogue lane is a separate script and never calls `importSprites` or the cry fetch (§14.3). |
| 4 | **Single-child evolution walk** (F4) | **Resolved.** `scripts/catalogue-pack.mjs` walks every branch from the root; `evolutionInfo` is untouched for the role lane. |
| 4 | D1–D5 unconfirmed | **All five defaults adopted** (§14.1), with the two deviations above recorded. |
| 6 | **No inventory test exists** (F8) | **Closed.** `tests/catalogue.test.ts`, 12 tests. |
| 5 | None outstanding | Verified in §14.5. |
| 7 | ~~Inherits the Prompt 2 blocker~~ | Hash comparison done against the recorded baseline: 20/20 pairs identical (§14.4). |

**Risk to watch, still not a blocker:** SpriteCollab coverage for recent species (F2). Catalogue records carry no art, so it cannot bite; it becomes blocking only if a variety is promoted to a runtime actor. The identity mismatch itself (F2: `dex` is the *species* id, so `weezing-galar` would resolve to base Weezing art) is unchanged and untested, because no variety has a role.

---

## 12. First ready next step **[corrected]**

~~Run Prompt 2.~~ That instruction was based on the mistaken claim in §1.1 that no baseline existed; the baseline was already recorded at `5b82fa0`, so Prompt 4 was ready immediately and ran this session.

~~The next ready step is Prompt 6 — Verify exact data and evolution coverage.~~ **Prompt 6 ran and passed** (§15): Appendices B and C were re-parsed independently of the generator and of `tests/catalogue.test.ts` (which was treated as a subject of the gate, not evidence for it), and the catalogue was regenerated byte-identically from the pinned snapshot by two routes.

**The next ready step is Prompt 7 — Verify gameplay and regressions.** The data gate passed, so Prompt 7 has no unmet prerequisite: Prompt 4 is complete (§14), Prompt 5 is satisfied without changes (§14.5), and §14.4 holds the comparable runtime, replay, performance and build evidence it must measure against. §15.9 hands it the eight pre-existing `nav` rows in `docs/habaudit/baseline.json`, already attributed to `046a5b5`/`800e804` with pristine-checkout evidence and left unabsorbed, since Prompt 7 owns the `HAB_VERSION` rule and the decision whether to refresh that file. §15.8 also notes that Playwright is now installed, so the render-check gap recorded in §14.9 should be re-checked rather than assumed.

## 13. Sources

- `docs/archive/pokemon-integration-handoff.md` — scope, prompts, Appendices A–D.
- PokéAPI published CSV snapshot, revision `8a92bfa7dab2f12b84b5d151562f9857c133ff30` — record identities, typings, dimensions, family joins. [PokéAPI v2 documentation](https://pokeapi.co/docs/v2)
- This repository at `5b82fa0`: `content/roster.json`, `scripts/fetch-sources.sh`, `scripts/build-content.mjs`, `scripts/import-pack.mjs`, `src/content/pokedex.ts`, `src/content/art.json`, `content/report.json`, `src/rules/species.ts`, `src/rules/abilities.ts`, `src/world/habitat/mode.ts`, `src/sim/progression.ts`, `tests/`.

---

## 14. Prompt 4 — Catalogue and families (this session)

Branch `main`, HEAD `5b82fa0` (unchanged; nothing committed by this session). Working tree at start: clean apart from untracked `docs/archive/pokemon-integration-handoff.md` and `docs/archive/pokemon-integration-plan.md`. Node 24.21.0 / npm 11.19.0. No other session's work was touched: `dist/` was not written, and the only pre-existing modified files remain the two untracked documents.

### 14.1 Decisions as adopted

All five §5 defaults were adopted (**D1-A** separate generated module, **D2-A** new `content/catalogue.json`, **D3-A** catalogue holds all 269, **D4-A** omit `levelUp`, **D5-A** family table keyed by chain), with two deviations from §6's proposed mechanics:

1. **Source is the pinned CSV snapshot, not ≈587 REST documents.** §6 and F6 assumed per-record `pokemon`, `pokemon-species` and `evolution-chain` fetches. The pinned revision's ten CSV tables supply every required field, including the form and regional restrictions (`pokemon_evolution.region_id`, `required_pokemon_form_id`, `evolved_pokemon_form_id`, `version_group_id`), so nothing is fetched per record. Checked before fetching anything, as the stage requires.
2. **The lane is its own script, not a `catalogueOne()` inside `import-pack.mjs`.** `scripts/import-pack.mjs` is built around per-species PokéAPI JSON plus mandatory art (F2) and a single-child chain walk (F4); a CSV-driven reference lane shares no code with it. `scripts/catalogue-pack.mjs` sits beside it and is orchestrated by `build-content.mjs` the same way, which keeps the documented generation path intact while leaving the role lane untouched. A consequence worth keeping: `--catalogue-only` regenerates the catalogue **without** rewriting `src/content/pokedex.ts` or `src/content/art.json`, so acceptance criterion 11 holds by construction.

As a result of (1), F5's resolution also changed: the catalogue needs no `api-data`, SpriteCollab or cries entry, so those roster-driven sparse sets are untouched and `fetch-sources.sh` gained a separate `pokeapi-csv` checkout pinned to the catalogue's revision.

### 14.2 Source and provenance

| Item | Value |
|---|---|
| Source | PokéAPI published CSV snapshot, `PokeAPI/pokeapi` `data/v2/csv` |
| Revision | `8a92bfa7dab2f12b84b5d151562f9857c133ff30` — the revision the handoff pins, confirmed unchanged |
| Files | 10 CSVs: `pokemon`, `pokemon_species`, `pokemon_species_names`, `pokemon_types`, `types`, `pokemon_forms`, `pokemon_form_names`, `pokemon_evolution`, `version_groups`, `regions` |
| Recorded in | `content/catalogue.json` (`source.revision`), `src/content/catalogue.ts` (`CATALOGUE_SOURCE`), `content/report.json` (`catalogue.source`, with each file's URL, byte count and SHA-256) |
| Routes verified | network, `--clones` checkout, and `--offline` cache — all three produce a **byte-identical** `catalogue.ts` |

**Appendix B and C reproduce exactly from this snapshot.** An independent derivation (the 269 pinned ids joined straight to the CSVs) was diffed field by field against both appendices before any repository file was written: **0 mismatches** across all 14 compared columns for all 269 records, and 0 across all 108 families. Two source details worth recording:

- **Four records have no form row flagged default.** Koraidon's ride builds (`pokemon_id` 10264–10267) each have exactly one `pokemon_forms` row with `is_default=0`. The rule is therefore "the flagged default row, else the only row", which Appendix B agrees with.
- **Appendix C's 28-row condition table comes from 30 source rows.** The two Kubfu → Urshifu edges each appear once per version group (`scarlet-violet`, `the-isle-of-armor`); Appendix C presents them comma-joined. The generator groups them into one condition with both groups listed, giving 28 entries from 30 rows.

### 14.3 Changed files

| Path | Change |
|---|---|
| `content/catalogue.json` | **New** authored input, 46 KB. The 269 identities pinned as `{pokemon, pokemonId, species, speciesId}` plus the two research-owned fields the source cannot supply (`formStatus`, `inclusion`), and the pinned source revision. |
| `scripts/catalogue-pack.mjs` | **New.** The reference lane: reads the pinned CSVs (checkout, cache or network), resolves identity by number and confirms it by name, derives ordered typing, form row, measurements with qualifiers and complete families, validates everything, and **refuses to write if any check fails**. No sprites, cries, move rows or gameplay fields. |
| `scripts/build-content.mjs` | Runs the catalogue lane and writes `src/content/catalogue.ts`; appends `catalogue` provenance to `content/report.json` without disturbing the role lane's. New `--catalogue-only` and `--catalogue-out DIR`. Deduplicated the generated-file header. **No catalogue entry is added to `species`, `art`, `defs` or `moves`.** |
| `scripts/fetch-sources.sh` | Adds the pinned `pokeapi-csv` sparse checkout. Roster-driven `NAMES`/`IDS` and the `spritecollab`/`cries` sets are unchanged. |
| `src/content/catalogue.ts` | **New, generated**, 130 KB. `CATALOGUE_SOURCE`, `CATALOGUE_RECORDS`, `CATALOGUE_FAMILIES`, `CATALOGUE_FORM_CONDITIONS`. Carries the do-not-edit header. |
| `src/rules/catalogue.ts` | **New.** Types and lookups (`catalogueRecord`, `defaultRecordOf`, `familyOfSpecies`, `childrenOfSpecies`, `parentOfSpecies`, `formConditionsFor`, `heightMeters`, `weightKilograms`). Node-safe: no `render/`, `ui/`, `audio/`, `input/`, `assets/` import. |
| `tests/catalogue.test.ts` | **New**, 12 tests. The data gate (F8). |
| `content/report.json` | Gains the `catalogue` key. Role provenance (38 species, 1217 files) and `generated` untouched. |
| `CLAUDE.md`, `docs/PIPELINE.md`, `docs/SPECIES.md` | Catalogue added to the generated-file list; the lane, its rules and the two-registry split documented. |
| `src/content/pokedex.ts`, `src/content/art.json`, `src/content/icons.json`, `src/rules/species.ts`, `src/world/habitat/mode.ts` | **Unchanged** — `git diff` is empty for all five, as §6 predicted. |

### 14.4 Commands and results

Every command was run from the repository root. `dist/` was never written: the production build used an isolated copy of `scripts/build.mjs` with the destination redirected, and `habaudit.ts` was redirected with `--out`.

| Command | Result | Against baseline |
|---|---|---|
| `node scripts/catalogue-pack.mjs --out <iso>` | exit 0 — 269 records (210 species + 59 varieties), 108 families, 102 edges, 39 singletons, 28 conditions | new |
| `node scripts/build-content.mjs --catalogue-only` | exit 0 — `src/content/catalogue.ts`, 130 KB | new |
| Regeneration to a second directory | **byte-identical** to the committed file (no timestamp in the output) | new |
| `--clones` and `--offline` routes | both byte-identical to the network route | new |
| `npm run typecheck` | exit 0 | **= baseline** (exit 0) |
| `npm test` | **330/330 across 32 files**, 0 failed, 0 skipped | baseline 318/318 across 31; +12 new tests, no pre-existing test changed or skipped |
| `npx tsx --test tests/catalogue.test.ts` | 12/12 | new |
| `npx tsx scripts/checksum.ts` (all 7 modes) | all printed, exit 0 | **all 20 recorded hash pairs identical** in `on`, `off`, `build-off`, `world-off`, `hazards-off` |
| `npx tsx scripts/perf-sim.ts 500 --repeat 3 --gate` | PASS — p95 0.365 ms, p99 0.505 ms (min of 3); raw p95 0.446, p99 0.657 | baseline 0.354/0.485 min-of-3, 0.397/0.604 raw; same order, gate limits 2/3 ms |
| `npx tsx scripts/habstate.ts` | 24/24 (20 live, 4 static) | **= baseline** |
| `npx tsx scripts/hazplay.ts` | 49/49 | **= baseline** |
| `npx tsx scripts/habplay.ts all 6 1 --raid` | 72/72, nonzero case count confirmed | **= baseline** |
| `npx tsx scripts/habaudit.ts --out <iso>` | all checks passed; `HAB_VERSION` 2; each recipe 30/30 first attempt | = baseline; see §14.6 |
| Isolated `scripts/build.mjs` | `index.html` **3,019,256 bytes**, artifact variant **3,019,084** | **byte-identical to baseline** — the catalogue is tree-shaken out, since nothing in the bundle imports it |

`checksum.ts gen` and `gen-classic` had no recorded baseline (the baseline deferred them). Measured this session, as the reference for later stages — first mark → end hash:

| Mode | Cyndaquil · seed 2 · classic · 420 s | Totodile · seed 7 · classic · 420 s | Bulbasaur · seed 3 · survival · 300 s | Charmander · seed 11 · boss rush · 240 s |
|---|---|---|---|---|
| `gen` | `e3908673` → `78375fae` | `a0aaf292` → `1b6a1ba8` | `dab2804b` → `28913c80` | `edd95335` → `2678162d` |
| `gen-classic` | `6e5ef12c` → `5a25a860` | `f736da7f` → `174d96dc` | `2c512cd0` → `87151f50` | `4691661f` → `f7230089` |

### 14.5 Coverage and verification

**Exact sets — the full expected inventory resolves.** 269/269 records by explicit source identity (pinned numeric id, then confirmed against the snapshot's `pokemon.identifier`), 210 species each with exactly one default record, 59 varieties, 108 families, 102 directed edges, 39 singletons, 28 form/region conditions. 0 missing, 0 duplicate (checked on `pokemon_slug`, `pokemon_id` **and** `pokemon_form_id`), 0 mismapped, 0 blocked.

| Required exercise | Evidence |
|---|---|
| Tyrogue's three edges | chain 47, `tyrogue>hitmonlee\|hitmonchan\|hitmontop`; each child terminal with `tyrogue` as parent |
| Extended Applin branch | chain 442, `applin>flapple\|appletun\|dipplin` **plus** `dipplin>hydrapple`; `hydrapple`'s family root is `applin` |
| Nincada's Shedinja by-product | chain 144, both `nincada>ninjask` and `nincada>shedinja`; `shedinja` is its own catalogue record |
| A regional restriction | `koffing>weezing` requires evolved form `weezing-galar` #10326 in region `galar` (`sword-shield`); `weezing-galar` has `formStatus: regional`. Also checked: `sneasel>sneasler` requires source form `sneasel-hisui` #10404 while `sneasel>weavile` carries no form field |
| An alternate default slug | `tatsugiri` → `tatsugiri-curly` #978, Curly Form, dragon+water; `catalogueRecord('tatsugiri')` is `null` because PokéAPI has no such `pokemon` resource. All 9 asserted as an exact map |
| An existing starter line | `charmander` → `charmeleon` at level 16 → `charizard` via `evolvesTo`/`evolveLevel`, unchanged; its canonical family holds the same two edges separately |

**Qualifiers.** 15 lower-bound heights and 16 unknown-mass placeholders, matching Appendix B. `weightKilograms` returns `null` for all 16, so the Gigantamax 10,000 hg placeholder can never read as 1000 kg ("Massive") nor Eternamax's 0 hg as 0 kg ("Weightless") — the F7 hazard. Eternamax's listed 100 m height is kept as a real figure. Raw `heightDm`/`weightHg` are preserved for all 269.

**Typing.** 171 dual and 98 mono, in source slot order, asserted per record and spot-checked where order is visible (`weezing-galar` poison+fairy, `toedscool` ground+grass, `zamazenta-crowned` fighting+steel).

**Agreement on the 7 overlapping records.** `charmander`, `charmeleon`, `charizard`, `rattata`, `gastly`, `slugma`, `magcargo` agree between `SPECIES_BY_ID` and the catalogue on types in slot order, `dex`, `canon.heightM` and `canon.weightKg`. The intersection of the catalogue and the active roster is **exactly** those 7. Gameplay and canonical values stay separate and still diverge as before (`gastly` canon 1.3 m vs gameplay 1.97).

**Prompt 5 — satisfied without changes.** No new runtime role is in scope and none was requested, so nothing was enabled. Verified rather than assumed: the active roster is still exactly the same 38 ids (asserted as a pinned list), `POKEDEX_SPECIES` 38, `POKEDEX_MOVES` 187 (unchanged — the catalogue adds no move rows), `STAGE_TABLES` the same four biomes, the height extremes `profilesFor()` reads unchanged at 0.9/4.5 m, `HAB_VERSION` still 2, `docs/habaudit/baseline.json` not regenerated, and all 20 recorded replay-hash pairs identical. The 262 catalogue-only records resolve through `src/rules/catalogue.ts` without art, cries or learnsets and carry no gameplay field at all (asserted key by key).

**Isolation is structural, and tested two ways.** `tests/catalogue.test.ts` asserts no record reaches `SPECIES_BY_ID`, and scans `src/sim/`, `src/world/`, `src/render/`, `src/ui/`, `src/audio/`, `src/input/`, `src/assets/`, `src/main.ts` and `src/rules/species.ts` for any import of `rules/catalogue` or `content/catalogue` — currently none. The byte-identical build size is independent confirmation that the bundle never sees it.

### 14.6 The one difference found, and its cause

The isolated `habaudit` run matches `docs/habaudit/baseline.json` on `checksum`, `geometry`, `sim`, `requested`, `accepted` and `attempts` for all 16 committed rows, and the script's own comparison reported **all checks passed** at `HAB_VERSION` 2. A field-level comparison — the one the recorded baseline explicitly left open — shows 8 of the 16 rows differing on the `nav` field only (`river-gorge` and `volcanic-ridge`, both variants, seeds 3 and 7).

**This is not caused by this stage, and it is not new.** `nav` is the enemy flow field plus the Raiders' `goalDir` on every route tile (`scripts/habaudit.ts:61-64`). **[corrected — see §15.8]** ~~The committed `baseline.json` was last written in `7e6f137`, the same commit that changed `goalDir`~~; in fact the eight stale values were written in `046a5b5` and invalidated by the `goalDir` `climb` guard added in `800e804`, and neither `800e804` nor `7e6f137` refreshed them — each only appended its own new rows. The stored `nav` values therefore predate that change for the two oldest recipes, while the layout checksums do not depend on it. Attribution was confirmed by re-running the full audit against a pristine `git archive` copy of HEAD with no catalogue files present (§14.7) — the same 8 `nav` values appear there.

Nothing was done to absorb it: no reference hash was updated and `docs/habaudit/baseline.json` was not regenerated. It is a pre-existing gap in that committed file, carried forward for Prompt 7, which owns the `HAB_VERSION` rule and the decision whether to refresh it.

### 14.7 Fixture checks, reported separately from full-roster regeneration

- **Full-roster regeneration of the catalogue: done.** All 269 records and 108 families were generated from the pinned source — not from fixtures — three times over (network, checkout, cache), byte-identically.
- **Full regeneration of the *role* lane (`pokedex.ts`, `art.json`): not run, deliberately.** It needs the SpriteCollab and cries checkouts plus ffmpeg, and it would rewrite committed generated art that acceptance criterion 11 requires to stay byte-identical. It is also not required by this stage: no role changed. `--catalogue-only` exists so the catalogue can be regenerated without it. **Claim left pending:** that a full `npm run content` reproduces the current `pokedex.ts` and `art.json` byte-for-byte is unverified, and was already unverified at baseline.
- **The role lane's offline fixture path is unchanged and still passes:** `tests/pack.test.ts` (end-to-end importer, validator and fallbacks over `tests/fixtures/mirror`) passed inside the 330.
- **The catalogue lane has no fixture mirror** — the mirror is PokéAPI-JSON-shaped and this lane reads CSVs. Its equivalent guarantees are the three verified source routes, byte-reproducibility, the generator's refuse-on-invalid validation, and `tests/catalogue.test.ts` checking the committed output against the authored pins.

### 14.8 Corrections to the Prompt 3 sections

1. **§1.1 said Prompt 2 had never run.** It had, at this same commit, with results recorded in the handoff. The claim was wrong when written, and it propagated into §8, §10, §11 and §12 as a blocker that did not exist. All five are corrected and marked.
2. **§2's `sed` line ranges were all wrong by about 35 lines.** Corrected to the verified ranges; the re-anchoring advice in that section is what caught it.
3. **§12's "first ready next step" was Prompt 2.** Corrected to Prompt 6, since Prompts 4 and 5 are now complete.

Not corrected, because they proved accurate: every count in §2.1 and §2.2, the 7-record overlap and its value agreement in §3.1, the 262 catalogue-only split in §3.2, the 12 in-run edges and the 2-of-102 overlap in §3.3, and findings F1–F8 (F5 and F6 were resolved by a better source route rather than disproved).

### 14.9 Still unverified

- A full `npm run content` byte-for-byte reproduction of `pokedex.ts` and `art.json` (§14.7).
- The 8 `nav` rows in the committed `docs/habaudit/baseline.json` (§14.6) — a pre-existing gap, for Prompt 7. **Re-confirmed and attributed in §15.9 with pristine-checkout evidence.**
- Browser smoke and render checks: ~~Playwright is still not installed, as at baseline.~~ **[corrected — see §15.8: Playwright is present in `node_modules`.]** Nothing in this stage renders, so no case is blocked by it.
- F2's variety-art identity mismatch stays latent and untested: no variety has a runtime role. It must be fixed and tested before any non-default variety is promoted.
- `content/preview/` contact sheets were not regenerated; the catalogue lane produces no previews, having no art.

---

## 15. Prompt 6 — Independent data gate (this session)

Branch `main`, HEAD `5b82fa0ea5f48305c514d1c47f8486f6954a508f` (unchanged; nothing committed by this session). The uncommitted Prompt 4 implementation was preserved exactly: `git status` is byte-for-byte the same before and after, and the six modified plus seven untracked paths were left as they were apart from this section. Node 24.21.0. `dist/` was not written, `docs/habaudit/baseline.json` was not regenerated, and `content/report.json`, `src/content/catalogue.ts` and the role-lane artifacts were never rewritten — every regeneration and audit went to an isolated directory.

**Assessment: PASS** for the catalogue data gate's agreed scope. 0 data discrepancies at any layer. Two documentation errors in §14 were found and are corrected in §15.8; neither changes a result.

### 15.1 Method — independent of the generator and its test

Appendices B and C were parsed straight from `docs/archive/pokemon-integration-handoff.md` by a purpose-written reader (fenced-block extraction, then a strict split of the CSV and of the markdown condition table). It shares no code with `scripts/catalogue-pack.mjs` or `tests/catalogue.test.ts`, reads none of their fixtures, and derives every total itself. `tests/catalogue.test.ts` was treated as a subject of the gate, not evidence for it: it was run, but every count below was re-derived from the handoff.

The parser refuses a record row whose cell count differs from the 15-column header, so a silent column shift cannot pass. Expected sets were then compared against three layers independently: the **authored inventory** (`content/catalogue.json`), the **generated catalogue** (`src/content/catalogue.ts`) and the **normal lookup path** (`src/rules/catalogue.ts`, through its exported functions only).

### 15.2 Exact identities and mappings — all reproduce

Every headline number was re-derived from the appendices, not read from §14:

| Expected | From Appendix B/C | Authored | Generated | Lookup (`CATALOGUE_TOTALS`) |
|---|---|---|---|---|
| 269 Pokémon records | 269 rows, and 269 slugs in the master list | 269 | 269 | 269 |
| 210 species | 210 distinct `species_slug` | — | — | 210 |
| 59 additional varieties | 269 − 210 = 59 non-default rows | — | — | 59 |
| 108 families | 108 `chain_id` rows | — | 108 | 108 |
| 102 edges | 102 `>` edges | — | 102 | 102 |
| 39 singletons | 39 `singleton` rows | — | 39 | 39 |
| 28 form/region conditions | 28 table rows | — | 28 | 28 |

**Missing, duplicate, extra or mismapped records by ID: none, at any layer.** Both set differences are empty in both directions for records (by `pokemon_slug`) and for families (by `chain_id`). Duplicate scan: 0 on `pokemon_slug`, 0 on `pokemon_id`, 0 on `pokemon_form_id`, 0 on `chain_id`. The Appendix B master slug list has no duplicate and agrees with the record rows exactly in both directions. Each of the 210 species has **exactly one** `species-default` row — 0 species with none or with two.

Appendix B's species set and Appendix C's species set are **identical**: 210 each, 0 in B missing from C, 0 in C missing from B.

Field comparison: **3,766 generated-field assertions (269 × 14) and 1,345 authored-field assertions, 0 mismatches.** `pokemon_slug` is the join key; the other 14 columns were each compared per record.

### 15.3 The field excluded from Prompt 4's 14-column comparison

Appendix B has **15 columns**. Prompt 4 (§14.2) compared **14** against a derivation from the CSVs, so exactly one was excluded: **`inclusion`**. It is the only Appendix B column with no source counterpart at all — the research report's own record of which rows were direct table picks. (`form_status`, the other field `content/catalogue.json` calls research-owned, is partly derivable: its `species-default` / non-default split follows `pokemon_forms.is_default`, which is why §14.2 could compare it and could state the "flagged default row, else the only row" rule.)

That column is verified here, as the one thing a source-derived diff structurally cannot check:

- **146 direct selections** (`inclusion: selected`) in Appendix B — matching the figure carried in §10.
- The selected **set**, compared slug by slug and not merely counted, is identical in all three layers: Appendix B = authored = generated, 146/146.
- The complement is consistent too: **123** `family-or-form` rows, 146 + 123 = 269, in all three layers.

### 15.4 Alternate defaults, typing, measurements

**Nine alternate defaults, asserted as an exact map** — each verified through `defaultRecordOf` on slug, `pokemonId`, form label and ordered typing, and each species slug confirmed to be *absent* from `catalogueRecord`:

| Species | Default record | Form label | Types |
|---|---|---|---|
| `aegislash` | `aegislash-shield` #681 | Shield Forme | steel+ghost |
| `dudunsparce` | `dudunsparce-two-segment` #982 | Two-Segment Form | normal |
| `giratina` | `giratina-altered` #487 | Altered Forme | ghost+dragon |
| `minior` | `minior-red-meteor` #774 | Meteor Form | rock+flying |
| `morpeko` | `morpeko-full-belly` #877 | Full Belly Mode | electric+dark |
| `tatsugiri` | `tatsugiri-curly` #978 | Curly Form | dragon+water |
| `toxtricity` | `toxtricity-amped` #849 | Amped Form | electric+poison |
| `urshifu` | `urshifu-single-strike` #892 | Single Strike Style | fighting+dark |
| `wishiwashi` | `wishiwashi-solo` #746 | Solo Form | water |

**Exact record lookup vs species-to-default lookup — the distinction holds in both directions.** For all 269 records `catalogueRecord(pokemon_slug)` resolves to the pinned `pokemon_id`; for all 210 species `defaultRecordOf(species_slug)` resolves to the appendix's default row. The two paths are not interchangeable, and that is asserted rather than assumed: `catalogueRecord('tatsugiri')` is `null` while `defaultRecordOf('tatsugiri')` is `tatsugiri-curly`; conversely `defaultRecordOf('tatsugiri-curly')` is `null`, because it takes a species slug and not a record slug. Where the two namespaces coincide (`charmander`) both paths return the same record.

**Ordered types.** All 269 type lists match Appendix B *in slot order* — compared as an ordered join, so a sorted or reversed pair would fail. **171 dual, 98 mono.** The order-visible cases were additionally re-read from the appendix itself before comparing: `weezing-galar` poison+fairy, `toedscool` ground+grass, `zamazenta-crowned` fighting+steel, `aegislash-shield` steel+ghost, `tatsugiri-curly` dragon+water.

**Raw measurement units preserved.** `heightDm` and `weightHg` equal Appendix B's raw decimetre and hectogram figures for all 269 records — no record stores a converted value.

**15 lower-bound heights**, all Gigantamax: `centiskorch-gmax`, `charizard-gmax`, `coalossal-gmax`, `duraludon-gmax`, `gengar-gmax`, `grimmsnarl-gmax`, `hatterene-gmax`, `inteleon-gmax`, `lapras-gmax`, `rillaboom-gmax`, `sandaconda-gmax`, `snorlax-gmax`, `toxtricity-amped-gmax`, `toxtricity-low-key-gmax`, `urshifu-single-strike-gmax`. Each returns `lowerBound: true` from `heightMeters`, with `m` equal to `height_dm / 10`.

**16 unknown masses** — those same 15 plus `eternatus-eternamax`. **`weightKilograms` returns `null` for all 16**, and the F7 hazard was checked at its two extremes: the 15 Gigantamax records carry a raw `10000` hg that must never read as 1000 kg ("Massive"), and `eternatus-eternamax` carries `0` hg that must never read as 0 kg ("Weightless") — both resolve to `null`. Eternamax's 100 m height is kept as a real figure (`heightDm` 1000, `heightMeters().m` 100, not lower-bound). Every `listed` weight converts to `weight_hg / 10`, and every `listed` height reports `lowerBound: false`.

### 15.5 Families, edges and form conditions

All 108 families match on `chainId`, `root` and the `singleton` flag, and every family's edge list matches Appendix C **as a set of directed `parent>child` pairs** — 102 edges, 39 singletons, with each singleton confirmed to hold zero edges. Each family's `species` array was checked to be exactly the species reachable in that chain, with no extra and no omission.

The lookup path was then exercised for **every** species in every chain, not a sample: `familyOfSpecies` returns the right `chainId` for all 210; `childrenOfSpecies` matches the appendix's children for each; `parentOfSpecies` matches the appendix's parent, and is `null` at each root. The required exercises all pass — Tyrogue's three edges, Applin's three branches plus `dipplin>hydrapple` with `hydrapple`'s root resolving to `applin`, and `nincada>ninjask` plus `nincada>shedinja` with `shedinja` its own record.

**All 28 form/region condition rows match**, compared as a composite key of chain, edge, required form slug and id, evolved form slug and id, region and the version-group set — 0 missing, 0 extra. Every row is also reachable through `formConditionsFor(parent, child)`. The documented exceptions hold: `koffing>weezing` requires evolved form `weezing-galar` #10326 in region `galar`, and `weezing-galar`'s own record carries `formStatus: regional`; `sneasel>sneasler` carries required form `sneasel-hisui` #10404 while `sneasel>weavile` carries no form condition at all; and the two `kubfu>urshifu` rows each list **both** version groups (`scarlet-violet`, `the-isle-of-armor`), which is the 28-rows-from-30-source-rows grouping §14.2 recorded.

**Form conditions outside the selected roster are preserved as source references, and are confirmed not to be records.** 25 distinct form slugs appear in condition rows without being any of the 269 records — the five `flabebe`/`floette`/`florges` colour chains (15), `avalugg-hisui`, `sinistea-antique`, `sinistea-phony`, `polteageist-antique`, `polteageist-phony`, `poltchageist-counterfeit`, `poltchageist-artisan`, `sinistcha-unremarkable`, `sinistcha-masterpiece` and `toxtricity-low-key`. Each was asserted to return `null` from `catalogueRecord`, so the scope stays explicit: they are retained condition context, never catalogue inventory.

### 15.6 Coverage — catalogue lookup reported apart from runtime

These are two different numbers and are kept separate, as the stage requires:

- **Catalogue lookup coverage: 269/269 (100 %).** Every expected record resolves through `src/rules/catalogue.ts`, and every expected family and condition resolves through its documented function. This is descriptive reference coverage only.
- **Playable / shipped runtime coverage: 38 ids**, unchanged — `SPECIES_BY_ID` 38, `POKEDEX_SPECIES` 38, `POKEDEX_MOVES` 187. The catalogue adds no role, no move row and no species.
- **Intersection: exactly 7.** **262 catalogue-only records have no runtime role** and carry no gameplay field — asserted key by key against `evolvesTo`, `evolveLevel`, `moves`, `spawn`, `stage`, `behaviour`, `art`, `cry`, `learnset` and `role`.

**The seven existing role records still agree with the catalogue and resolve through their established paths.** Each was compared against *Appendix B* (not against the generator) and against its `SpeciesDef`:

| Record | dex | Types (slot order) | Canonical | Chain |
|---|---|---|---|---|
| `charmander` | 4 | fire | 0.6 m / 8.5 kg | 2 |
| `charmeleon` | 5 | fire | 1.1 m / 19 kg | 2 |
| `charizard` | 6 | fire+flying | 1.7 m / 90.5 kg | 2 |
| `rattata` | 19 | normal | 0.3 m / 3.5 kg | 7 |
| `gastly` | 92 | ghost+poison | 1.3 m / 0.1 kg | 40 |
| `slugma` | 218 | fire | 0.7 m / 35 kg | 111 |
| `magcargo` | 219 | fire+rock | 0.8 m / 55 kg | 111 |

`SPECIES_BY_ID` agrees with the catalogue on ordered types, `dex`, `canon.heightM` and `canon.weightKg` for all seven, and each resolves through both `defaultRecordOf` and `familyOfSpecies`. Canonical and gameplay values remain distinct authorities and still diverge as before (`gastly` canon 1.3 m vs gameplay 1.97 m; `magcargo` canon 0.8 m vs gameplay 3.38 m).

**Isolation re-checked independently of the stage's own test.** A fresh grep for `rules/catalogue` and `content/catalogue` across `src/` and `scripts/` finds **no consumer in `src/` outside `src/rules/catalogue.ts` itself** — the only other hits are the two generator scripts (comments and paths) and `tests/catalogue.test.ts`. No catalogue record other than the 7 role ids appears in `POKEDEX_SPECIES`.

### 15.7 Regeneration from the pinned snapshot, and byte comparison

Output paths were inspected **before** running anything. `scripts/build-content.mjs:81-86` shows `--catalogue-only` writes only `<CATALOGUE_OUT>/catalogue.ts`, and that the provenance write (`reportCatalogue`, line 82) is guarded to the default `src/content` destination — so `--catalogue-out DIR` cannot touch `content/report.json`, `src/content/pokedex.ts`, `src/content/art.json` or `dist/`. That was then confirmed empirically: `git status` is unchanged after every run.

**The pinned source was validated before trusting any regeneration.** All ten CSVs were fetched fresh from `raw.githubusercontent.com/PokeAPI/pokeapi` at revision `8a92bfa7dab2f12b84b5d151562f9857c133ff30` into a disposable directory, and every one matches the byte count and SHA-256 recorded in `content/report.json` → `catalogue.source.files`: **10/10 exact.** The pinned revision therefore still yields the recorded bytes.

| Route | Command | Result |
|---|---|---|
| Offline cache | `node scripts/build-content.mjs --catalogue-only --catalogue-out <iso>` | exit 0 — 269 records, 108 families, 102 edges, 39 singletons, 28 conditions; source reported `(cache)` |
| Disposable checkout | `node scripts/build-content.mjs --catalogue-only --clones <iso-srcdata> --catalogue-out <iso>` | exit 0 — same totals; source reported `(clone)` |

Both regenerated files are **byte-identical** to the working-tree artifact, by `cmp` (silent) and by SHA-256:

```
bc19380017bba3dcb045bc2af1f8d9ff3d07d35ec722e09c7197749aea227f9d  src/content/catalogue.ts
bc19380017bba3dcb045bc2af1f8d9ff3d07d35ec722e09c7197749aea227f9d  <iso>/regen-offline/catalogue.ts
bc19380017bba3dcb045bc2af1f8d9ff3d07d35ec722e09c7197749aea227f9d  <iso>/regen-clone/catalogue.ts
```

132,732 bytes each. The authored input and the generated module both record revision `8a92bfa7dab2f12b84b5d151562f9857c133ff30`, which is the revision the handoff pins (it appears 8× there), and `content/report.json` carries all ten file URLs with byte counts and SHA-256.

**Source revision and commands recorded:** repository HEAD `5b82fa0ea5f48305c514d1c47f8486f6954a508f`; catalogue source `PokeAPI/pokeapi@8a92bfa7dab2f12b84b5d151562f9857c133ff30`, `data/v2/csv`, 10 files.

**Checks run:**

| Command | Result | Against §14.4 |
|---|---|---|
| `npm run typecheck` | exit 0 | = |
| `npx tsx --test tests/catalogue.test.ts` | **12/12**, 0 failed | = |
| `npx tsx --test tests/pack.test.ts tests/identity.test.ts` | **13/13**, 0 failed | = (registry / importer lane) |
| `npm test` | **330/330 across 32 files**, 0 failed, **0 skipped** | = |
| `npx tsx scripts/habaudit.ts --out <iso>` | all checks passed; `HAB_VERSION` 2; 0 failures | = (see §15.9) |

### 15.8 Corrections to §14

1. **§14.6 attributes the stale `nav` rows to the wrong commit.** It states the committed `baseline.json` "was last written in `7e6f137`, the same commit that changed `goalDir`". Both halves are wrong. `7e6f137` only *appended* the four `forest-cemetery` rows and left the twelve pre-existing rows untouched; `800e804` likewise only appended the four `tidal-cave` rows. The eight stale `nav` values were written in **`046a5b5`**, the commit that first added those rows, and `goalDir` (`src/sim/world.ts`) was changed in **`800e804`** — which added the `climb` guard to its neighbour loop, so it now refuses a cheaper tile up a face higher than a step. Neither later commit refreshed the eight rows it invalidated. **The conclusion of §14.6 is unaffected and now has a mechanism:** the gap is pre-existing, and the change that caused it is identified.
2. **§14.9 says Playwright is not installed.** It is present in `node_modules` at this session's HEAD. Nothing in this gate renders, so no case here depended on it; Prompt 7 should re-check rather than assume the gap.

### 15.9 The eight habitat `nav` differences — carried to Prompt 7 with pristine evidence

Confirmed, attributed and **not absorbed**: no reference hash was updated and `docs/habaudit/baseline.json` was not regenerated. Prompt 7 owns the `HAB_VERSION` rule and the decision whether to refresh that file.

Three-way comparison, all runs redirected with `--out`:

- **[A] Working tree vs pristine HEAD — 0 of 24 rows differ on any field.** A `git archive HEAD` copy containing **no** catalogue files (`content/catalogue.json`, `src/content/catalogue.ts`, `src/rules/catalogue.ts`, `scripts/catalogue-pack.mjs` all absent) produces an identical audit to the working tree. The Prompt 4 implementation changes nothing in habitat navigation. This is the pristine comparison evidence.
- **[B] Pristine HEAD vs committed `docs/habaudit/baseline.json` — 8 of 16 rows differ, on `nav` only.** `HAB_VERSION` 2 in both; 0 failures in both; `checksum`, `geometry`, `paint`, `sim`, `requested`, `accepted`, `attempts` and `rejected` all match on all 16 rows.
- **[C]** For those 8 rows, working-tree `nav` equals pristine `nav` **8/8** — so the difference is reproducible without any catalogue file present.

| Row | Committed `nav` | Pristine HEAD `nav` |
|---|---|---|
| `river-gorge` seed 3 | `f8d454a5.68ac9cad` | `f8d454a5.c644e8e3` |
| `river-gorge` seed 7 | `0dcf5484.ac202381` | `0dcf5484.3fb54dcf` |
| `river-gorge/snow` seed 3 | `f8d454a5.68ac9cad` | `f8d454a5.c644e8e3` |
| `river-gorge/snow` seed 7 | `0dcf5484.ac202381` | `0dcf5484.3fb54dcf` |
| `volcanic-ridge` seed 3 | `2b7ade24.65c1b8cb` | `2b7ade24.0831547f` |
| `volcanic-ridge` seed 7 | `0719466b.def3146b` | `0719466b.afec8ecd` |
| `volcanic-ridge/ash` seed 3 | `2b7ade24.65c1b8cb` | `2b7ade24.0831547f` |
| `volcanic-ridge/ash` seed 7 | `0719466b.def3146b` | `0719466b.afec8ecd` |

**[D] The hash localises the cause.** `nav` is `fnv(flow) + '.' + fnv(goalDir dirs)` (`scripts/habaudit.ts:61-64`). In all 8 rows the **flow half is identical** and only the **`goalDir` half differs** — the enemy flow field is unchanged and only the Raiders' per-route-tile direction moved. That is exactly the signature of `800e804`'s `climb` guard inside `goalDir`, and it is why only the two oldest recipes (whose layouts have the faces and lips the guard acts on) are affected while their layout checksums are untouched.

### 15.10 Legacy sprite and cry regeneration — recorded separately from the catalogue gate

Not part of the catalogue gate, and **not run**. Reported here on its own so it is not read as covered:

- **Full role-lane regeneration (`src/content/pokedex.ts`, `src/content/art.json`, `src/content/icons.json`, sprites, cries) was not run.** It is blocked in this environment by two concrete prerequisites, both verified absent: **`ffmpeg` is not installed**, and the **`../src-data` checkout does not exist** (`scripts/fetch-sources.sh` would need the `api-data`, `spritecollab` and `cries` clones). It would also rewrite committed generated art that acceptance criterion 11 requires to stay byte-identical.
- All four role-lane artifacts and `content/preview/` are **unchanged** by this session (`git status` empty for each). `--catalogue-only` never writes them, by construction.
- **Claim still pending, unchanged from §14.7 and from the baseline:** that a full `npm run content` reproduces `pokedex.ts` and `art.json` byte-for-byte is unverified.
- The role lane's offline fixture path is unaffected and still passes: `tests/pack.test.ts` + `tests/identity.test.ts` 13/13.

### 15.11 Discrepancies and unverified checks

**Data discrepancies found: none.** 0 missing, 0 duplicate, 0 extra, 0 mismapped records, families, edges or conditions at any of the three layers; 0 field mismatches in 3,766 + 1,345 assertions. The two findings in §15.8 are documentation errors in §14, not data defects.

Unverified, carried forward:

- A full `npm run content` byte-for-byte reproduction of `pokedex.ts` and `art.json` — blocked here (§15.10), pending since baseline.
- The 8 `nav` rows in the committed `docs/habaudit/baseline.json` (§15.9) — pre-existing, attributed, **for Prompt 7**.
- Browser smoke and render checks were **not run** this session. Playwright is now installed (§15.8), so the setup gap §14.9 recorded may no longer hold; nothing in this gate renders.
- The isolated production build was **not re-run** this session, so §14.4's byte-identical `index.html` (3,019,256 bytes) is carried from Prompt 4 rather than re-measured. The independent import grep in §15.6 covers the same claim structurally.
- Replay checksums, the performance gate, `habstate.ts`, `hazplay.ts` and `habplay.ts` were **not re-run** here — they are Prompt 7's scope; §14.4 holds their evidence.
- F2's variety-art identity mismatch remains latent and untested: no variety has a runtime role.

## 16. Prompt 7 — Runtime and regression gate (this session)

Branch `main`, HEAD `5b82fa0ea5f48305c514d1c47f8486f6954a508f` (unchanged; nothing committed, nothing staged). Node 24.21.0 / npm 11.19.0, macOS Darwin 25.5.0. Working tree at start and at end is identical: the same 6 modified and 7 untracked paths §14.3 lists. `dist/` was never written — the production build used an isolated copy of `scripts/build.mjs` with the destination redirected and the esbuild import resolved, and `habaudit.ts` was redirected with `--out`. The uncommitted integration was preserved throughout.

Inputs confirmed unchanged against §15.7 before anything ran: `src/content/catalogue.ts` SHA-256 `bc19380017bba3dcb045bc2af1f8d9ff3d07d35ec722e09c7197749aea227f9d`, the same value §15.7 records.

### 16.1 Verdict

**Runtime gate: PASS for the agreed scope.** 0 regressions. Every baseline comparison is identical or equal-or-better; the only differences anywhere are the 8 pre-existing `nav` rows §15.9 attributed to `800e804`, reproduced here exactly, with no additional drift.

### 16.2 Commands and results

| Command | Result | Against the recorded baseline |
|---|---|---|
| `npm run typecheck` | exit 0 | **=** baseline (exit 0) |
| `npm test` | **330/330 across 32 files**, 0 failed, 0 skipped, 46.8 s | baseline 318/318 / 31 files; +12 catalogue tests, no pre-existing test changed or skipped (**=** §14.4, §15.7) |
| `npx tsx scripts/checksum.ts` (all 7 modes, 28 configurations) | exit 0, every hash printed | **all 20 recorded first-mark/end-hash pairs identical**; the 8 `gen`/`gen-classic` pairs also identical to the §14.4 reference — 28/28 |
| `npx tsx scripts/perf-sim.ts 500 --repeat 3 --gate` | **PASS** — min of 3: p95 0.367 ms, p99 0.516 ms; raw p95 0.457, p99 0.740; 8000 ticks at ~500 enemies | baseline min-of-3 0.354/0.485 (§14.4: 0.365/0.505). Same order, far inside the 2 ms / 3 ms gate; like-for-like (same script, count, repeat, machine) |
| `npx tsx scripts/habstate.ts` | **24/24** (20 live, 4 static) | **=** baseline |
| `npx tsx scripts/hazplay.ts` | **49/49** | **=** baseline |
| `npx tsx scripts/habplay.ts all 6 1 --raid` | **72/72**, nonzero case count confirmed | **=** baseline (the short `all --raid` form still reports 0 of 0, as the baseline warns) |
| `npx tsx scripts/habplay.ts all 6 1` | **72/72** | **=** baseline |
| `npx tsx scripts/habaudit.ts --out <iso>` | exit 0, **all checks passed**, `HAB_VERSION` 2, 24 rows | see §16.4 |
| Isolated `scripts/build.mjs` | `index.html` **3,019,256 bytes**, artifact **3,019,084 bytes** | **= the 3,019,256-byte baseline, exactly**; see §16.5 for the byte-identity comparison |
| `node <scratch>/p7-smoke.mjs <iso>/index.html` (Playwright 1.65.0, Chromium 158.0.8127.18) | startup and all sprite cases pass, 0 page errors | baseline deferred this; see §16.6 |

Hash comparison was mechanical, not read by eye: a script parsed `checksum.ts` output and compared each `(mode, species, seed)` against the handoff table and the §14.4 `gen`/`gen-classic` reference — `compared 28 pairs: 28 identical, 0 differ; missing from run: none`.

### 16.3 Gameplay paths exercised (reported apart from catalogue lookups)

Driven through the normal sim entry points (`createRun` / `step` / `botInput` from `src/sim/run.ts`, `src/sim/bot.ts`), the same ones `scripts/headless.ts` and `scripts/checksum.ts` use. All seven records that overlap the catalogue were exercised in their established roles:

| Record | Role | Exercised by | Evidence |
|---|---|---|---|
| `charmander` | starter / player form | classic, survival, boss-rush starts | run starts at `charmander`, art key `pokemon:charmander`, lvl 1 hp 109 |
| `charmeleon` | player form, level-16 evolution | **natural level-up path** (build layer off), survival seed 2 and classic seeds 2 and 3 | `evolveStart charmander->charmeleon lvl16` → `evolveEnd charmeleon hp=244/244` at 202.7 s / 187.3 s / 190.1 s |
| `charizard` | player form, level-36 evolution | survival seed 2, classic seeds 2 and 3 (build off); classic seed 5 (build on) | run ends at `charizard`; renders as the player in the browser smoke |
| `rattata` | wild spawn (meadow, frost) | classic seed 5, 1800 s | 56,859 live samples; drawn in-browser |
| `slugma` | wild spawn (badlands) | classic seed 5 | 89,593 live samples; drawn in-browser |
| `gastly` | wild spawn (dusk) | classic seed 5 reaching stage 4 | 172,624 live samples; drawn in-browser |
| `magcargo` | **stage-2 boss** | classic seed 5 (`bossSpawn magcargo hp=62211` at 673.2 s, `bossDead` at 750.9 s) | boss killed and the stage advanced; art key `pokemon:magcargo` |

Supporting coverage in the same sweep: all four biomes (`meadow > badlands > frost > dusk`), all four stage bosses (`sudowoodo`, `magcargo`, `articuno`, `houndoom`), 20 distinct enemy species spawned, Tag/recruit species swap (`charmeleon -> poliwag -> charmeleon`), map traversal, combat, targeting, hazards and camera via the 330-test suite and the habitat/hazard harnesses above.

**One behaviour worth recording, not a regression.** With the build layer on (the shipped default), the Wildcard **early-evolution card** fires before the level threshold — `charmander -> charmeleon` at level 14 on every seed tried — so the level-16 evolution is normally pre-empted by a player choice. The level-16 path itself is intact and was exercised with `build: { enabled: false }`. Setting `build.weights.evolve = 0` is **not** enough to suppress the card: `draw()` in `src/sim/build.ts:306` picks from the wildcard pool even at weight 0 when that card is the pool's only entry. Pre-existing behaviour, identical on pristine HEAD, and consistent with the unchanged replay hashes.

### 16.4 Habitat comparison — the §15.9 pristine result, reproduced exactly

A fresh `habaudit.ts --out <iso>` run was compared field by field against committed `docs/habaudit/baseline.json` (`ms` excluded as a timing field):

- `version` 2 in both. **`HAB_VERSION` preserved; `docs/habaudit/baseline.json` not regenerated; no reference hash updated.**
- 16 comparable rows: **8 identical on every field, 8 differing on `nav` and nothing else.** `checksum`, `geometry`, `sim`, `requested`, `accepted`, `attempts`, `rejected`, `loads` and `agree` match on all 16.
- The 8 differing rows and their values are **exactly** the table in §15.9 (`river-gorge` and `volcanic-ridge`, both variants, seeds 3 and 7) — for example `river-gorge seed 3`: committed `f8d454a5.68ac9cad`, fresh `f8d454a5.c644e8e3`. **The flow half of the hash is identical in all 8; only the `goalDir` half differs**, the signature §15.9[D] identified.
- This session's fresh output therefore equals §15.9's pristine-HEAD result row for row. **No additional drift, and nothing attributable to the integration.** §15.9[A] (working tree vs pristine `git archive HEAD` with no catalogue file present: 0 of 24 rows differ) is reused as the pristine comparison; its inputs — habitat, hazard and nav code — are untouched by this session and by the integration diff.
- 8 further rows (`tropical-lagoon`, `spear-sanctuary`, both variants, seeds 3 and 7) are absent from the committed file, as the baseline records. Accounted for independently; they are later recipes, not drift.

`checksum.ts gen` and `gen-classic` were run even though the diff touches no world generation or location selection (nothing in `src/sim/`, `src/world/` or the bundle imports the catalogue — §15.6, and §16.5's byte-identical build). Both reproduce the §14.4 reference exactly, so the "run only if affected" condition is satisfied either way.

### 16.5 Production build — byte identity established against pristine HEAD

The isolated build produced `index.html` at **3,019,256 bytes**, the recorded baseline size to the byte, and the artifact variant at **3,019,084 bytes**.

Byte identity was then established the only way the available artifacts allow: the baseline's own `index.html` was not kept (only its size is recorded), so a second build was made from a **pristine `git archive HEAD` checkout containing no catalogue files** and compared with `cmp` and SHA-256:

```
cmp index.html (working tree) index.html (pristine HEAD)          -> identical
cmp poke-watch-artifact.html (both)                               -> identical
4a9c8a8a89104fa24b0c252808d3643d54454c23cd30979e5f79180a68a5e8ea  index.html (working tree)
4a9c8a8a89104fa24b0c252808d3643d54454c23cd30979e5f79180a68a5e8ea  index.html (pristine HEAD)
```

So the integration adds **zero bytes** to the shipped bundle, by comparison and not by inference. The claim "byte-identical to the 3,019,256-byte baseline artifact" itself remains a size match only, because that baseline artifact no longer exists to compare against.

### 16.6 Browser smoke — Playwright works; startup and sprites verified

The §14.9 setup gap no longer holds. Playwright **1.65.0** is installed and its Chromium **158.0.8127.18** launches here. All cases ran against the isolated build, in capture mode, with `frames = seconds × 60` as `CLAUDE.md` requires.

| Case | Result |
|---|---|
| Startup / title | `ready: true`, canvas present, 4 modes listed, **0 console errors, 0 page errors** |
| Player sprite, `charmander` / `charmeleon` / `charizard` | each boots at its own species with art keys `pokemon:charmander` / `charmeleon` / `charizard`, WebGL context live, 0 errors |
| Wild and boss sprites | `rattata`, `gastly`, `slugma` spawned wild and `magcargo` spawned as a boss beside the trainer: all four alive, correct art keys, correct boss HP (386 vs ~62 wild), **visually confirmed in the capture** — Magcargo's shell, Gastly's gas cloud, Slugma and Rattata all drawn |
| `pokewatch.metrics()` | actors 132,162 px, mean ΔE 67.4, camouflaged 0.006, overlay cover 0.0275 — actors render and separate from the background |

Captures are in the session scratchpad (`smoke/records-mid.png`, `smoke/title.png`, `smoke/player-*.png`); they are verification evidence, not artifacts to commit.

**Cases not exercised, and why:** a canvas pixel read-back inside the page returns blank because the WebGL context has no `preserveDrawingBuffer`; the page screenshots and `pokewatch.metrics()` cover the same claim, so nothing is blocked. No alternate-form art was exercised because **no alternate form is activated for gameplay** — all 59 varieties stay catalogue-only, so F2's variety-art identity mismatch remains latent and untested, as in §§14.9 and 15.11. The wider `tools/` suites (`cap.mjs` scene sets, `navcheck`, `audiocheck`, `perf.mjs`) were not run: nothing in the diff touches render, UI, audio or input.

### 16.7 Catalogue lookups — reported separately from the gameplay paths above

Re-verified this session, independent of §16.3 and of the stage's own test, by resolving every authored identity through `src/rules/catalogue.ts`:

- **269/269 authored records resolve**, each matching its pinned `pokemonId`; 0 unresolved.
- **210 distinct species, each with exactly one `species-default` record**; 108 families; **102 unique directed edges**; 39 singleton families; 28 form/region conditions.
- 16 records return `null` from `weightKilograms` (the unknown-mass placeholders); 0 return `null` from `heightMeters` — the §14.5 figures.
- **Runtime registry unchanged: `SPECIES_BY_ID` holds 38 ids; the intersection with the catalogue is exactly the 7 records in §16.3.** The other 262 catalogue records have no runtime role, and none entered the bundle (§16.5).

These 269 lookups are reference-data resolution only. They are **not** gameplay coverage; the gameplay coverage this gate established is the 7 records and the paths in §16.3.

### 16.8 Regressions, reused evidence and remaining gaps

**Regressions found: none.** No finding needs routing to an earlier stage.

**Reused rather than re-run, with the reason:**

- §15.9[A]'s pristine `git archive HEAD` audit (0 of 24 rows differ from the working tree) is reused as the pristine comparison. Its inputs are unchanged, and this session's fresh audit reproduces its 8 `nav` values exactly, which re-confirms it from a second direction.
- The role-lane fixture evidence (`tests/pack.test.ts`, `tests/identity.test.ts`) is reused through the full suite, where both passed inside the 330.

**Still unverified, carried to Prompt 8:**

- A full `npm run content` byte-for-byte reproduction of `pokedex.ts` and `art.json`. Blocked here by the same two prerequisites §15.10 records: `ffmpeg` is absent and the `../src-data` checkout does not exist. **Legacy sprite and cry regeneration therefore stays deferred, not verified.**
- The 8 `nav` rows in committed `docs/habaudit/baseline.json`: pre-existing, attributed to `800e804`, reproduced, **not absorbed**. Refreshing that file is a decision for a habitat-owning change, not for this integration, which does not touch nav.
- F2's variety-art identity mismatch: latent, untested, and correctly out of scope while no variety has a runtime role.
- Byte identity against the baseline's own build artifact, which was not retained (§16.5).

### 16.9 Progress

Stage 7 (Runtime gate) is **done and passing**. **Prompt 8 (Review and report acceptance) is ready to run.** Commit and deployment state were left alone.

---

## 17. Prompt 8 — Acceptance report (this session)

Branch `main`, HEAD `5b82fa0ea5f48305c514d1c47f8486f6954a508f` — unchanged; nothing committed, nothing staged, no deployment touched. `dist/` was not written. The only file this session edited is this section.

### 17.1 Overall assessment: **PASS** for the agreed catalogue scope

All 16 acceptance criteria in §9 hold on observed evidence. Every headline total was re-derived this session from Appendices B and C and compared against all three layers independently — **0 discrepancies, by ID, at any layer**. No material defect was found, so nothing is routed back to an earlier stage. The open items are the ones §§15–16 already recorded as deferred or pre-existing; none is in the agreed scope.

### 17.2 Working tree — in-scope diff, and a second session's unrelated work preserved

`git status` now shows **11 modified + 9 untracked** paths where §14.3 and §16 recorded 6 modified + 7 untracked. The difference is a **parallel session's audio/YouTube work, which is out of this scope and was left untouched**: modified `docs/AUDIO.md`, `src/audio/audio.ts`, `src/main.ts`, `src/ui/style.css`, `src/ui/ui.ts`, and untracked `src/audio/youtube.ts`, `tools/musiccheck.mjs`. Their mtimes are 00:44–00:45 on 2026-11-15; every in-scope file's mtime is 23:23–23:34 on 2026-11-14, i.e. **no in-scope file has changed since the Prompt 7 gate ran**. `src/content/catalogue.ts` still hashes to `bc19380017bba3dcb045bc2af1f8d9ff3d07d35ec722e09c7197749aea227f9d` (132,732 bytes), the value §15.7 and §16 record.

In scope and reviewed (6 modified, 7 untracked): `CLAUDE.md`, `content/report.json`, `docs/PIPELINE.md`, `docs/SPECIES.md`, `scripts/build-content.mjs`, `scripts/fetch-sources.sh`; `content/catalogue.json`, `scripts/catalogue-pack.mjs`, `src/content/catalogue.ts`, `src/rules/catalogue.ts`, `tests/catalogue.test.ts`, `docs/archive/pokemon-integration-handoff.md`, `docs/archive/pokemon-integration-plan.md`.

**Committed reference files are unchanged**, confirmed by an empty `git status` for each: `docs/habaudit/baseline.json`, `src/content/pokedex.ts`, `src/content/art.json`, `src/content/icons.json`, `content/roster.json`, `src/rules/species.ts`, `src/world/habitat/mode.ts`, `content/preview/`.

### 17.3 Verified coverage — re-derived from the appendices this session

Appendix B's 269 CSV rows (parsed with a strict 15-column check, so a column shift cannot pass), its 269-slug master list, and Appendix C's 108 family rows and 28-row condition table were parsed directly from `docs/archive/pokemon-integration-handoff.md`, then compared against the **authored inventory** (`content/catalogue.json`), the **generated catalogue** (`src/content/catalogue.ts`) and the **public lookup** (`src/rules/catalogue.ts`, through its exported functions only).

| Expected | Appendix B/C | Authored | Generated | Lookup (`CATALOGUE_TOTALS`) |
|---|---|---|---|---|
| 269 records | 269 rows, 269 master slugs | 269 | 269 | 269 |
| 210 species | 210 distinct `species_slug` | — | — | 210 |
| 59 additional varieties | 269 − 210 | — | — | 59 |
| 108 families | 108 `chain_id` rows | — | 108 | 108 |
| 102 evolution edges | 102 `>` edges | — | 102 | 102 |
| 39 singletons | 39 `singleton` rows | — | 39 | 39 |
| 28 form/region conditions | 28 table rows | — | 28 | 28 |
| 146 direct selections | 146 `inclusion: selected` | 146 | 146 | 146 |

**Discrepancies by ID: none.** Set differences are empty in both directions for records (`pokemon_slug`) and families (`chain_id`); the master slug list agrees with the record rows both ways; duplicates are 0 on `pokemon_slug`, 0 on `pokemon_id` and 0 on `pokemon_form_id`; every one of the 210 species has exactly one `species-default` record. Field comparison: **269 × 14 generated-field assertions and 269 × 5 authored-pin assertions, 0 mismatches** (`pokemon_slug` is the join key, so all 15 Appendix B columns are covered — `inclusion` included).

Also reproduced independently: the **9** alternate default slugs as an exact map (`defaultRecordOf(species)` → the Appendix B slug, `catalogueRecord(species)` `null`, `defaultRecordOf(record_slug)` `null` for each); **171 dual / 98 mono** typings in slot order; **15** lower-bound heights and **16** unknown-mass placeholders with `weightKilograms` returning `null` for all 16 and the raw value for all 253 `listed` records; Eternamax's 100 m height kept as a real figure. Families were exercised for **every** species, not sampled: `familyOfSpecies` for all 210, and `childrenOfSpecies` / `parentOfSpecies` for all 102 edges with `null` at each of the 108 roots. All 28 conditions match as a composite key of chain, edge, required form slug+id, evolved form slug+id, region and version-group set, and each is reachable through `formConditionsFor`.

### 17.4 Gameplay evidence for the seven overlapping records, reported apart from lookup coverage

The intersection of the catalogue and the active roster is **exactly 7**, re-computed this session: `charizard`, `charmander`, `charmeleon`, `gastly`, `magcargo`, `rattata`, `slugma`. Each agrees with **Appendix B** (not with the generator) and with its `SpeciesDef` on ordered types, `dex`, `canon.heightM` and `canon.weightKg`, and each resolves through `defaultRecordOf` and `familyOfSpecies`. Gameplay and canonical values remain separate authorities and still diverge as before (`gastly` canon 1.3 m vs gameplay 1.97 m).

Their exercised roles are §16.3's evidence, reused unchanged — driven through the normal sim entry points (`createRun` / `step` / `botInput`), not through a test harness shortcut:

| Record | Role | Evidence (§16.3) |
|---|---|---|
| `charmander` | starter / player form | classic, survival and boss-rush starts; art key `pokemon:charmander` |
| `charmeleon` | level-16 evolution | natural level-up path with the build layer off — `evolveStart charmander->charmeleon lvl16` → `evolveEnd hp=244/244`, 3 seeds |
| `charizard` | level-36 evolution | run ends at `charizard`; drawn as the player in the browser smoke |
| `rattata` | wild spawn (meadow, frost) | 56,859 live samples, classic seed 5 |
| `slugma` | wild spawn (badlands) | 89,593 live samples |
| `gastly` | wild spawn (dusk) | 172,624 live samples |
| `magcargo` | stage-2 boss | `bossSpawn magcargo hp=62211` at 673.2 s, `bossDead` at 750.9 s, stage advanced |

**The two coverage figures stay separate:**

- **Catalogue lookup coverage: 269/269 (100 %)** — reference-data resolution only, re-verified here through `src/rules/catalogue.ts`. It is **not** gameplay coverage.
- **Runtime registry: 38 ids**, unchanged (`SPECIES_BY_ID` 38). The catalogue adds no species, no move row and no role; the **262** catalogue-only records carry no gameplay field at all (asserted key by key this session) and **exactly 7** catalogue records appear in `SPECIES_BY_ID`.

### 17.5 Gate results

Reused from the completed gates, with the two cheap checks re-run on the current tree to confirm the parallel session's files changed nothing:

| Gate | Result | Status |
|---|---|---|
| `npm run typecheck` | exit 0 | **re-run this session** on the current tree (audio work present) |
| `npx tsx --test tests/catalogue.test.ts` | 12/12, 0 failed, 0 skipped | **re-run this session** |
| `npm test` | 330/330 across 32 files, 0 failed, **0 skipped** (baseline 318/31; +12 new, none changed or skipped) | reused, §16.2 |
| Replay hashes, `checksum.ts` all 7 modes / 28 configurations | **28/28 pairs identical** — the 20 recorded baseline pairs plus the 8 `gen`/`gen-classic` reference pairs | reused, §16.2 |
| `perf-sim.ts 500 --repeat 3 --gate` | PASS — min-of-3 p95 0.367 ms / p99 0.516 ms against 2 ms / 3 ms limits | reused, §16.2 |
| `habstate.ts` | 24/24 (20 live, 4 static) | reused, §16.2 |
| `hazplay.ts` | 49/49 | reused, §16.2 |
| `habplay.ts all 6 1 --raid` and `all 6 1` | 72/72 each, nonzero case count confirmed | reused, §16.2 |
| `habaudit.ts --out <iso>` | all checks passed, `HAB_VERSION` 2, 24 rows; 8 of 16 committed rows differ on `nav` only — pre-existing, see 17.7 | reused, §16.4 |
| Browser smoke (Playwright 1.65.0 / Chromium 158.0.8127.18, capture mode, `frames = seconds × 60`) | startup, player, wild and boss sprite cases pass; 0 console errors, 0 page errors | reused, §16.6 |
| Production build (isolated copy of `scripts/build.mjs`; `dist/` never written) | `index.html` 3,019,256 bytes, artifact 3,019,084 bytes | reused, §16.5 |

**The two build claims are different claims, and stay distinguished:**

1. **Byte identity against pristine HEAD — established.** A build from a `git archive HEAD` checkout containing no catalogue files produced an `index.html` identical by `cmp` and by SHA-256 (`4a9c8a8a89104fa24b0c252808d3643d54454c23cd30979e5f79180a68a5e8ea`), as did the artifact variant. The integration adds **zero bytes** to the shipped bundle, by comparison rather than inference — consistent with the independent import grep (no `src/` consumer outside `src/rules/catalogue.ts`).
2. **Size match against the Prompt 2 baseline — a size match only.** The baseline's own `index.html` was not retained, so 3,019,256 bytes is a byte-count agreement with a recorded number, not a byte-for-byte comparison against that artifact.

Both build measurements were taken on the **catalogue-only tree**, before the parallel audio session's edits. Those edits touch `src/main.ts` and `src/audio/`, which do enter the bundle, so a whole-tree build taken now would no longer match pristine HEAD — for that unrelated reason, not because of the catalogue. Criterion 11 is assessed against the catalogue diff, which is what it scopes.

### 17.6 Review findings — no material defect

Checked for duplicate sources of truth, output-path and default-build regressions, mismapped IDs, unsupported gameplay changes and avoidable runtime dependencies.

**Clean:**

- **No duplicate authority.** `content/catalogue.json` stores only `{pokemon, pokemonId, species, speciesId, formStatus, inclusion}` — the identity pins plus the two research-owned fields the source cannot supply. Types, measurements, form rows, families and conditions are all derived, never authored twice. `species`/`speciesId`/`formStatus` are not trusted either: `scripts/catalogue-pack.mjs` cross-checks each against `pokemon.csv` and fails the run on disagreement.
- **No mismapped ID.** Identity is pinned by number and then confirmed by name (`p.identifier === r.pokemon`, `p.species_id === r.speciesId`, `sp.identifier === r.species`), which is what makes the 9 alternate defaults resolvable without a name guess. 269 × 14 field assertions against Appendix B mismatch on nothing.
- **No output-path regression.** `--catalogue-only` writes only `<CATALOGUE_OUT>/catalogue.ts`, and its provenance write is guarded to the default destination, so `--catalogue-out DIR` cannot touch `content/report.json`, `src/content/pokedex.ts`, `src/content/art.json` or `dist/`. The role lane's artifacts are not rewritten by the catalogue lane at all, which is why criterion 11 holds by construction. `content/report.json` keeps the role lane's 38 species / 1217 files intact and appends only `catalogue`.
- **No unsupported gameplay change.** No new role, species, move row, stage table or habitat profile. `SPECIES_BY_ID` 38, `POKEDEX_SPECIES` 38, `POKEDEX_MOVES` 187, `HAB_VERSION` 2, `profilesFor()` extremes 0.9/4.5 m, all 28 replay-hash pairs identical.
- **No avoidable runtime dependency.** `src/rules/catalogue.ts` imports only the generated module, is Node-safe, and has no `render/`, `ui/`, `audio/`, `input/` or `assets/` import. Grepping `src/` and `scripts/` for `rules/catalogue` / `content/catalogue` finds no consumer in `src/` outside the module itself; the bundle is byte-identical to pristine HEAD.
- **Conventions and hygiene.** `src/content/catalogue.ts` carries the do-not-edit header and is listed in CLAUDE.md §Generated files (criterion 15). `content/report.json` records the pinned revision `8a92bfa7dab2f12b84b5d151562f9857c133ff30` with all ten CSV URLs, byte counts and SHA-256s, matching `content/catalogue.json` and `CATALOGUE_SOURCE` (criterion 14). **Criterion 16: no private conversation, project, file or upload link or identifier in any in-scope changed file** — the only external hosts referenced are `raw.githubusercontent.com`, `pokeapi.co` and `github.com`, plus the pre-existing `localhost:5173` dev-server note; sources are cited by title with public URLs or repository-relative paths.

**Minor observations, none blocking and none requiring a fix for acceptance:**

1. `scripts/build-content.mjs` — in the **full** build path `reportCatalogue()` is called unconditionally, so `node scripts/build-content.mjs --catalogue-out DIR` *without* `--catalogue-only` writes `catalogue.ts` to `DIR` yet still records that catalogue's provenance in the repository's `content/report.json`. The documented isolation route (`--catalogue-only --catalogue-out DIR`) is guarded and unaffected, and a full build rewrites repository files by design, so no isolation guarantee is broken.
2. `scripts/fetch-sources.sh` — the new `pokeapi-csv` block was inserted between the `# UI icons: …` comment and the `clone PokeAPI/sprites sprites` line that comment describes, so the comment now reads as a header for the catalogue checkout. Cosmetic.
3. A fully offline `npm run content` (`--clones ../src-data`) now needs `DIR/pokeapi-csv`, which the updated `fetch-sources.sh` creates. An older `src-data` does not fail: `catalogue-pack.mjs` falls back to `.import-cache/` and then the network, recording the route in provenance. Because the catalogue lane runs **after** the role lane has written its artifacts, a network failure there aborts the build with `pokedex.ts` / `art.json` already written and `content/report.json` lacking the `catalogue` key. Re-running fixes it; worth knowing before an offline regeneration.
4. `content/report.json` records each CSV's fetch route (`from: "cache" | "clone" | "network"`), so the report differs by route even when `catalogue.ts` is byte-identical. The file already carries a `generated` timestamp, so no determinism is newly lost.
5. `parseCsv` pads a short row's missing trailing columns with `''` instead of rejecting it, so a source column shift is caught only by the downstream name and species-id confirmations. All 269 records are name-confirmed, so such a shift would fail validation rather than pass silently.

### 17.7 Remaining limitations

- **Legacy sprite and cry regeneration: deferred, not verified.** A full `npm run content` byte-for-byte reproduction of `src/content/pokedex.ts` and `src/content/art.json` remains unverified — pending since the Prompt 2 baseline, and blocked here by two prerequisites confirmed absent: **`ffmpeg` is not installed** and the **`../src-data` checkout does not exist**. `--catalogue-only` exists so the catalogue never needs it. **Missing check:** a role-lane regeneration in an isolated destination with those prerequisites present, compared with `cmp` against the committed artifacts. `content/preview/` contact sheets were likewise not regenerated (the catalogue lane produces no previews).
- **Alternate-form art: unexercised.** No alternate form is activated for gameplay — all 59 varieties stay catalogue-only — so F2's variety-art identity mismatch (`dex` is the *species* id, so `weezing-galar` would resolve to base Weezing art) remains latent and untested. **Missing check:** promote one non-default variety to a runtime role behind a flag and assert the resolved art key, which is Prompt 5's scope if a variety is ever given a role. It must be fixed and tested before that happens.
- **The eight habitat `nav` differences: pre-existing.** 8 of 16 committed `docs/habaudit/baseline.json` rows differ on `nav` only (`river-gorge` and `volcanic-ridge`, both variants, seeds 3 and 7). Attributed to `046a5b5` writing those rows and `800e804` adding the `goalDir` `climb` guard that invalidated them; the flow half of the hash is identical in all 8 and only the `goalDir` half moved. Reproduced from a pristine `git archive HEAD` checkout with no catalogue file present, so it is not attributable to this integration. **Not absorbed:** no reference hash was updated, `HAB_VERSION` stays 2 and `docs/habaudit/baseline.json` was not regenerated. Refreshing it belongs to a habitat-owning change.
- **Wildcard early evolution: pre-existing behaviour.** With the build layer on (the shipped default) the Wildcard early-evolution card fires before the level threshold — `charmander -> charmeleon` at level 14 on every seed tried — so the level-16 path is normally pre-empted by a player choice; it was exercised with `build: { enabled: false }`. `build.weights.evolve = 0` does not suppress the card, because `draw()` (`src/sim/build.ts:306`) still picks from the wildcard pool at weight 0 when that card is the pool's only entry. Identical on pristine HEAD and consistent with the unchanged replay hashes.
- **Build byte identity against the baseline's own artifact** is unavailable: that artifact was not retained (17.5), so the baseline comparison is a size match.
- **No catalogue fixture mirror.** The role lane's `tests/fixtures/mirror` is PokéAPI-JSON-shaped; the catalogue lane reads CSVs. Its equivalent guarantees are the three verified source routes, byte-reproducibility, refuse-on-invalid validation and `tests/catalogue.test.ts`.

### 17.8 Follow-up

Nothing is required for this scope to be accepted. Optional, in priority order:

1. Before any non-default variety gets a runtime role: fix and test F2's variety-art identity mapping (Prompt 5).
2. When a habitat-owning change next runs: refresh the eight stale `nav` rows in `docs/habaudit/baseline.json` under its `HAB_VERSION` rule, and add the four `tropical-lagoon` and `spear-sanctuary` rows the committed file still lacks.
3. When `ffmpeg` and a `../src-data` checkout are available: close the role-lane byte-reproduction claim that has been open since the baseline.
4. Optionally tidy observations 1–2 of 17.6 (the unguarded full-build provenance write and the displaced comment in `fetch-sources.sh`).

### 17.9 Progress

Stage 8 (Acceptance) is **done — PASS** for the agreed scope. Commit and deployment state were left alone; the parallel audio/YouTube session's files were preserved untouched.
