# Builds: offers, transforms and techniques (Phase 8b)

Design: *Poke-Watch Systemic Combat Blueprint*, section 6 (and 5, 12, 13, 14, 16). This file records what the code
does, the numbers it uses and what was measured. Every number lives in `src/rules/defaults.ts` (`build`); the
transforms and techniques are data in `src/rules/build.ts`; the offer generator is `src/sim/build.ts` and the
run-time technique hooks are `src/sim/techniques.ts`.

## The offer

Every level-up (and every item ball) shows three cards, banked in the tray as before:

| Slot | Draws from | Falls back to |
| --- | --- | --- |
| Kit | the **field** Pokémon: learn a move into an empty slot; replace Move A or B (the lower-power one, never a transformed one); transform one of its moves | a Wildcard |
| Technique | a trainer-wide technique not held and not banished. While fewer than 3 are held this slot is always a technique; once 3 are held it shows a replacement 35% of the time (else a Kit or Wildcard card), and a technique is guaranteed when the last 2 resolved offers had none | another Kit or Wildcard card |
| Wildcard | a **benched** Pokémon's transform; a Tag Action variant a Pokémon passed on; an early evolution (within 2 levels of its evolution level); a Sitrus Berry (35% HP, only below 50% HP and only 40% of the time when it is the only Wildcard) | a Kit card, then a technique, then the berry |

An offer always has three cards while any pool has one. The Kit slot looks up to 4 levels ahead in the learnset (at
half weight, labelled *Early move (Lv N)*); if nothing is within reach it offers the next move in the learnset, so
gaps such as Bulbasaur's (Tackle at 3, Razor Leaf at 6) do not empty it.

**Weights.** Each eligible card has `w = base × (1 + 0.6 s) × n × f`:

| Term | Rule | Code |
| --- | --- | --- |
| base | learn 3 (×2 for the line's own learnset, ×0.2 for coverage, ×0.5 for early), replace 1, transform 4, technique 1, bench transform 2.5, Tag variant 1.5, evolution 1, berry 0.6 | `build.weights` |
| s | the card's capability tags the kit already uses, capped at 2. Tags are `push`, `hold`, `apply:agent`, `create`, `tag`; `hit` and `deflect` are universal and never count; a technique's `apply` matches any agent | `cardWeight` |
| n | 1.5 when the card brings a tag the whole squad lacks, during the first 4 picks; 1 afterwards | `novelty`, `noveltyPicks` |
| f | 0.5 for a card shown in the previous offer (so a reroll tends to show new cards) | `repeat` |

A benched Pokémon's card is judged against its own kit. All draws use the `cards` RNG stream in a fixed order.

**Rerolls and banish:** 2 rerolls and 1 banish **per region** (reset at each region's start); skips stay 2 per run.
A banished card (a technique, one transform, a move) never returns that run.

**Numbers come from levels.** Move power-up cards are gone: a move's level is `1 + floor((squad level − 1) / 5)`, up
to 8, for every move of every squad member, learned or recruited (*mastery*). Vitamins are retired. Evolution is
the other source of raw power, and can now come two levels early as a Wildcard.

## Transforms (`rules/build.ts`)

Each of the six slice moves has two transforms, A and B. A transform is offered once the move has been cast 25 times
as the basic attack or 8 times as Move A / B. Taking one rules out the other for that move for the run; a move takes
one transform, once. It survives evolution, Tag switches and benching. Damage edits keep damage per second per target
close to the base move: what changes is the shape, a verb or a rule.

| Move | Transform | Gain | Cost |
| --- | --- | --- | --- |
| Water Gun (bolt, Push 1, Wet) | **Pressure Jet** | a 10 m beam with Push 2 (rolls rocks, shoves a line, deflects shots along it) | rooted 0.3 s each time it fires |
| | **Scatter** | 3 shots in a 40° fan; each leaves a light Wet coat, even as Move A or B | no Push; each shot stops at the first enemy and hits for half |
| Ember (bolt, Heat) | **Kindle** | where the shot ends, the ground within 1.6 m gets Heat (lights grass, dries Wet, thaws ice) | stops at the first enemy |
| | **Searing** | pierces 1; always a deep Heat coat, even as the basic attack (elites and bosses too) | range −30%; pierce never grows with level |
| Flame Wheel (dash, Push 2, Heat) | **Ram** | Push 3: rolls a boulder alone | dash distance −25% |
| | **Wheel Trail** | a 4 m trail of burning zones for 3 s (lights grass, deep Heat coats) | Push 1 (a rock no longer rolls), knockback 5 instead of 9 |
| Vine Whip (strike, Hold 1) | **Lasso** | Hold 2: suspends rocks and **Light enemies** 1.5 m in front for 0.6 s, then throws them along your aim at the body rule's speed | one target per lash |
| | **Snare** | every lash roots for 0.8 s (through the crowd-control meter) | no Hold (no catching shots, rubble or enemies) |
| Seed Bomb (lob) | **Cluster** | 3 lobs scattered around the target | each blast 55% as wide, 45% damage |
| | **Burrow** | a 2.2 m Grass patch for 10 s (Create): enemies that are not Grass type cross it at 55% speed; it burns like tall grass | blast 30% narrower, 20% weaker |
| Bite (strike, Dark) | **Crunch Down** | Push 2 on one target, knockback 9 (breaks a Bulwark guard), rolls rocks | one target |
| | **Lunge** | becomes a 5 m lunge through the target; untouchable while lunging | cooldown ×1.5; no Push |

The blueprint names the first ten; the Bite pair is Poke-Watch's own (the blueprint lists Bite among the twelve without
specifying them).

**Identity (pillar 3).** A transform may add Push or Hold only if the Pokémon's line already has that verb somewhere:
its learnsets (every form), coverage moves or Tag Actions (`transformAllowed`). Crunch Down is offered to Totodile,
Squirtle and Rattata but not to Houndour, whose line never pushes; Lunge, which removes Push, is offered to all.
Burrow's Create makes a tile state (the Grass type's own setup), which the blueprint gives Seed Bomb, so Create is
not gated. A transform never changes a move's type, so agents still follow type.

**Who carries them.** Water Gun: Totodile (starter), the Squirtle line, Poliwag. Ember: Cyndaquil (starter),
Charmander, Slugma, Vulpix, Houndour. Flame Wheel: Cyndaquil (Lv 10). Vine Whip: Bulbasaur (starter). Seed Bomb:
Bulbasaur (Lv 20). Bite: Totodile, Squirtle, Rattata, Zubat, Houndour. **Chikorita's line has none**; its build is
techniques only (see the hypotheses below). Transforms apply to move slots; a Tag Action that happens to be the same
move (Cyndaquil's Flame Wheel, Bulbasaur's Vine Whip) is not transformed.

## Techniques

The trainer holds at most 3. They apply to whoever is on the field, so each plays differently per Pokémon. Taking a
fourth opens a discard choice: three *Discard X* cards and *Keep my techniques*. The level-up is spent only when
one is discarded; Keep (or X) returns to the same three cards, so it is never a free reroll.

| Technique | Gain | Cost | Hooks |
| --- | --- | --- | --- |
| Undertow | your Pushes also Apply Wet: a deep (or light, for the basic attack) Wet coat on what they hit, and Wet ground under a rock they roll | Push moves deal 20% less damage | `damageEnemy`, `forceOnBody`, `techSpec` |
| Riposte | a Guard deflect or parry (shot, body or contact) refunds Move A's cooldown | no Brace: Guard ends when the 0.15 s window closes | `onGuardDeflect`, player |
| Lodestone | your Holds have +1 Power (only moves that already hold) and last 1.5 s | you cannot walk while you hold something (Dash and Jump still work) | `techSpec`, `holdSeconds`, player |
| Heavy Footing | +1 Weight class for Guard (never above Heavy) and half the knockback you take | move speed −15%; Dash 30% shorter | `guardWeight`, player, `damagePlayer` |
| Catalyst | a reaction your own hit triggers (Steam, Freeze, Shatter, Conduct, Overload, Cancel) takes 1 s off Move A and B | your basic attack applies no light coats | `coats.ts react`, moves |
| Slipstream | dashing through a coated enemy (within 1.3 m) copies its coat; your next Move A or B carries it as a deep coat | Dash costs 1.3 Reflex charges | player, moves, effects |
| Quarry | a rock or boulder you break leaves 2 extra rubble, yours, flung outward at 6 m/s (fast enough to strike) | your hits deal 25% less integrity damage | `damageBody`, `breakBody` |
| Second Wind | tagging in clears the incoming Pokémon's coat | Tag cooldown 5 s instead of 4 s | `tagTo` |

**Lodestone departs from the blueprint text.** Section 6 gives it "Hold suspends a body 1.5 m in front of you for up
to 1 s, then releases it along your aim", but Phase 8a made that the rule for every Hold. Its gain is now the one
section 8 and the 8a notes ask of it: +1 Hold Power (Lasso + Lodestone = Hold 3, so Bulbasaur can catch a boulder
alone) and a longer hold. The cost is the blueprint's. Decision 19 defers Lodestone until after the slice while
section 15 lists all 8 for the slice; this build follows section 15.

Technique effects write `technique` records to the capability log (`pokewatch.debug('caps')`, `pokewatch.caps()`).

## Compatibility flags

| Flag | Default | Off / on means |
| --- | --- | --- |
| `build.enabled` | true | false: the Phase 8a cards exactly (replay checksums identical; `scripts/checksum.ts build-off`) |
| `build.legacyNumeric` | false | true: vitamins return as Wildcards and move power-ups as Kit cards, and move levels come from those cards again (no mastery). The retired numbers stay available until the replacements are verified with people |

## Playtest and debug hooks

`?techs=undertow,lodestone&xf=lasso` starts with a build (with `go=1`); in the console `pokewatch.tech(id)`,
`pokewatch.xf(id)` and `pokewatch.build()`. The end screen lists the run's build under *Your build*. The HUD shows held
techniques at the bottom right (hover for gain and cost); a transformed move's slot name turns yellow and its tooltip
gives the transform, its gain and its cost.

## Measurements (2026-10-21, headless, this build)

| Check | Result |
| --- | --- |
| Tests | **145/145** (`npm test`): the 104 from Phase 8a plus 41 in `tests/build.test.ts` (data, offers, weights, guarantee, rerolls and banish, exclusions, identity, stacking, mastery, the technique limit and swap, all 12 transforms and all 8 techniques as micro-scenes, learnsets, squad switching, evolution, capability log, build diversity, determinism, regression) |
| Typecheck | clean (`npm run typecheck`: src, tests, scripts) |
| Flag off = Phase 8a | `scripts/checksum.ts` prints `build-off` hashes equal to Phase 8a's at every 60 s mark of all four configurations; `off` (caps and build) still equals v10. `tests/build.test.ts` checks hashes recorded from the untouched 8a commit (3a92f49) at 30 s marks |
| Determinism | same seed and inputs (scripted aim, Move A, Guard, Dash and card picks) give the same offers, the same picks and the same state hash every 10 s |
| Sim cost at ~500 enemies, min of 3 | **p50 0.35 ms, p95 0.61 ms, p99 0.72 ms** (`perf-sim.ts 500 --repeat 3 --gate`: both gates PASS; Phase 8a measured p95 0.92, p99 1.13 the same way on a noisy shared container) |
| Technique guarantee | with 3 held, 400 generated offers: a technique in 46% of them, never 3 offers in a row without one (test); below 3 held, every offer has one |
| Build diversity | random picks, 3 partners x 4 seeds x 150 s: at least 10 distinct builds in 12 runs, at least 6 techniques and 3 transforms seen, no technique in every build (test) |
| v10-style bot (always card 1), 6 partners x 4 seeds x 300 s | build off (= 8a): 13/24 reach 300 s, 922 KOs; build on: 19/24, 1317 KOs; build on with `legacyNumeric`: 19/24, 1333 KOs. The gain comes from the offer's structure (card 1 is now always a Kit card, so this bot always grows its kit), not from mastery: with the numeric cards inside the new structure it is the same |
| Move level by squad level | 8a bot: L9 3.2, L15 4.5, L21 5.8 (spread unevenly across moves); mastery: L9 2, L15 3, L21 5, every move |

### Dominance sweep (`scripts/h8b.ts 3 1200`)

Bot survival in Classic, mean of 3 seeds, cap 1200 s. The plan bot takes its one technique whenever offered and no
other (sweep-only unlimited skips; 0 techniques outside the plan in 144 runs), transforms when offered, else learns.

| Partner | none | Riposte | Heavy Footing | Slipstream | Second Wind | Undertow | Lodestone | Catalyst | Quarry |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Bulbasaur | 1200 | 1013 | 1200 | 1200 | 554 ▼ | 1200 | 813 | 1055 | 1029 |
| Charmander | 1200 | 918 | 1086 | 923 | 839 | 1047 | 825 | 918 | 835 |
| Squirtle | 465 | 294 ▼ | 118 ▼ | 167 ▼ | 600 ▼ | 1200 | 839 | 481 ▼ | 505 ▼ |
| Chikorita | 887 | 1200 | 510 ▼ | 1200 | 1200 | 709 | 1200 | 1200 | 831 |
| Cyndaquil | 752 | 1200 | 844 | 916 | 878 | 1088 | 1104 | 1200 | 1200 |
| Totodile | 821 | 821 | 821 | 821 | 1200 | 481 ▼ | 821 | 517 ▼ | 821 |

Median 897 s. **No pair measured above 1.5x the median, but the acceptance is not demonstrated:** 13 of 48 pairs hit
the 1200 s cap, so the largest ratio this run can show is 1.34x; the review line (1346 s) is above the cap. Ten pairs
fall below 0.67x (▼). Re-run with a cap of 1800 s or more (`npx tsx scripts/h8b.ts 3 1800`, about 3 hours on 2 cores)
before treating dominance as checked. Three seeds per cell is noisy: one early death moves a cell by hundreds of
seconds.

**Plays differently (V3 proxy).** Jensen-Shannon divergence of the bot's capability outcomes (pushes, holds,
deflects, reactions, breaks, cell changes, Tag Actions) between technique groups: mean 0.015, max 0.033; against no
technique at most 0.035 (Second Wind). Far below the blueprint's 0.2. The bot plays every build the same way
(it never aims, guards, holds or dashes on purpose), so this measures the bot, not the builds: V3 needs people.

**Transforms** (the bot takes only that one; survival vs the same partner with no transform):

| Transform | Carrier | With | Without | Taken at |
| --- | --- | --- | --- | --- |
| Pressure Jet | Totodile | 1080 | 722 | 31 s |
| Scatter | Totodile | 821 | 722 | 28 s |
| Crunch Down | Totodile | 490 | 722 | 41 s |
| Lunge | Totodile | 1200 | 722 | 42 s |
| Kindle | Cyndaquil | 848 | 931 | 29 s |
| Searing | Cyndaquil | 1104 | 931 | 31 s |
| Ram | Cyndaquil | 1104 | 931 | 48 s |
| Wheel Trail | Cyndaquil | 1104 | 931 | 54 s |
| Lasso | Bulbasaur | 1200 | 1200 | 50 s |
| Snare | Bulbasaur | 634 | 1200 | 60 s |
| Cluster | Bulbasaur | 1200 | 1200 | (Lv 20) |
| Burrow | Bulbasaur | 1200 | 1200 | (Lv 20) |

## Balancing hypotheses (unresolved; for the slice playtest)

1. **Dominance is unchecked above 1.34x.** See above. Candidates to watch: Lunge and Pressure Jet on Totodile
   (+66% and +50% bot survival), Undertow on Squirtle (465 → 1200 s), Second Wind on Totodile and Chikorita.
2. **Totodile's Water Gun pair may be lopsided.** Pressure Jet's beam pierces a line and its 0.3 s root barely costs
   a bot; a kiting human may feel the root more. Crunch Down (490 s) and Scatter look weak for a bot because they
   trade area for one target or for Push. Hypothesis: Pressure Jet's root should be 0.4–0.5 s on the basic attack.
3. **Lunge as an escape.** Its untouchable lunge every ~1.1 s (cooldown ×1.5) doubles as a free dodge that spends no
   Reflex. If people use it that way, cut the i-frames or tie them to hitting the target.
4. **Snare halves Bulbasaur's survival for a bot** (1200 → 634 s): losing Hold also loses shot-catching from the
   autofired Vine Whip. Expected to read as a control pick for people; watch whether anyone takes it twice.
5. **Costs a bot cannot avoid dominate the low cells.** Heavy Footing (slower kiting), Slipstream (dearer dashes),
   Riposte (no Brace) and Lodestone (rooted while the autofired Vine Whip holds a shot) show only their cost because
   the bot never times a Guard or aims a hold. Read ▼ cells as "gain not exercised", not "weak", until people play.
6. **Lodestone + an autofired Hold roots you often.** Bulbasaur's basic attack is Vine Whip, so with Lodestone it is
   rooted whenever its autofire catches a shot (1.5 s each). Hypothesis: root only for holds from Move A / B.
7. **Squirtle is the weakest partner under this bot** (465 s with no technique, 7 of 8 techniques below 0.67x
   median except Undertow and Lodestone). Its kit gets no transform until Water Gun at Lv 6 and Bite at Lv 10.
8. **Chikorita has no transform.** Its line learns none of the six slice moves, so its build is techniques only.
   The 8a note "Grass in Region 1" stands; Burrow and Snare (the blueprint's Grass answers) belong to Bulbasaur.
9. **The structure itself is easier for a simple bot** (19/24 vs 13/24 at 300 s) because card 1 is always a Kit card.
   Whether people find runs easier depends on how they pick; enemy scaling was not retuned.
10. **Mastery is flatter early.** Move levels trail the 8a bot's by about one level from Lv 6 to Lv 18 and catch up by
    Lv 21; evolution two levels early (Wildcard) partly fills the gap. "Power feels flat" is decision 6's named risk.
11. **Late offers thin out.** Once the learnset is spent, transforms are taken and 3 techniques are held, the
    Technique slot shows a replacement 35% of the time and the berry fills the rest. Expect more skips late in
    Survival mode; a late filler that changes a verb (Tag variants, conversion technique) is the open design question.
12. **Second Wind is either useless or strong.** It does nothing with no squad and cleared coats save Totodile's runs
    (1200 s). The 1 s Tag cost is likely too small; a real squad playtest decides.

## Known limits (Phase 8b)

- **Bite's transforms are Poke-Watch's own** (the blueprint lists Bite among the twelve but does not specify them).
- **Lodestone's gain differs from the blueprint text** (see Techniques); the conversion technique (section 5, "trade
  one capability for another") is not built: it is not one of the eight.
- **Transforms apply to move slots only**, not to Tag Actions that are the same move.
- **Lasso throws a creature as a knockback**, not as a projectile: a thrown Rattata does not strike the enemies it
  flies into (a thrown rock does).
- **Slipstream's copied coat** goes on creatures the Move hits, not on the ground.
- **Burrow's Grass patch** is not barred near objective pads (blueprint section 9's 3 m rule belongs with Phase 8c's
  cover and Create limits).
- **Tray keys.** In the banked tray, keys 1–3 pick; the swap offer's fourth card (Keep) is X or a click. The modal
  (`cards.tray: false`) also takes 4.
- **Typecheck dependency.** `npm run typecheck` needs `@types/node`, which is not in `devDependencies` (true before
  this phase too).
- **One player**, as in 8a: techniques live on `ctx.player`.
