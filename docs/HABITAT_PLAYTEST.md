# Tactical Hold evaluation: Shrine Gorge and Cinder Crater

Scope: `river-gorge` and `volcanic-ridge` with the real Hold objective, the real Raid party, the squad and the director's ordinary
horde (docs/HABITATS.md, docs/ENCOUNTERS.md, docs/SQUAD.md). Seeds: Gorge 3, 7 and 25 (25 is the one flagged for 15.6 % approach-time
skew); Crater 3 (a retry: loads 548672811) and 7. Everything below was measured on 2026-11-13 in the headless sim with the scripts
listed at the end; **no human played this session**, so what only a person can judge is a replayable checklist (section 7).

**What the numbers are.** The trainer is a script: it follows a route derived from the final collision, fights with the balance
bot's buttons (the moves fire on cooldown at the nearest enemy, Tag and cards as the bot does), never dashes or jumps, and stays on
the pad during the Hold. It is a committed, competent player, not a good one. Squads: *solo* = a level 8 partner (what a first Hold
meets, because habitat maps never offer a Hunt and so no recruits), *squad* = Bulbasaur + Mareep + Geodude at level 10 after a
100 s warm-up against the live director (the level the bot has at the first offer, ~2:00). *calm* = the director's horde is off
(the Raid party only; a few elites and swarms still spawn); *horde* = everything live. The Raid party is 4 Raiders + a Bulwark.
Control maps for "map or ordinary enemy pressure": Viridian Forest and the classic generator on the same stage, same squad, same
warm-up, same Hold (`scripts/habtac.ts viridian-forest|classic`).

## 1. Verdict

| | Shrine Gorge | Cinder Crater |
| --- | --- | --- |
| both approaches walkable, contestable, retreat works | yes, all five seeds: direct 8.8-9.4 s, flank 13.4-14.6 s (calm, trainer); retreat 9-15 s | yes: direct 9.5-9.9 s, flank 11.2-14.1 s; retreat 10-16 s. Seed 7 direct under a live horde: **15-49 s** (below) |
| Raiders' natural route | always the direct approach (96/96 Raiders, calm) | **was random** (as shipped: 42 direct, 12 flank, 10 mixed of 64): fixed, now 64/64 direct |
| Raid arrival after the Hold opens (natural) | 9.2 / 11.0 / 10.9 s (seeds 3 / 7 / 25) | **was 4.9 s, now 12.1 s** (design intent: B's approach at Raider speed) |
| forced onto the other approach | 16-19 s to 14 m of the pad (seed 7: not within 14 m by 30 s); **0-3 of 4 reach it before the Hold completes**, the ones that are hit die 12-18 m out: the flank is a kill zone | 13.5-16.2 s, **4 of 4 reach it**, die at 1-2 m: both approaches deliver the party |
| rim / terrace / crest denies both approaches | no: no position off the pad covers 50 % of both Raider approaches at weapon range (0 spots, seeds 3, 7, 25); the pad sees 22-41 % of the last 40 m of each | no high position (rim, crest) either; floor spots 10-12 m off the pad cover 56-61 % of both (seeds 3, 7); seed 5 has four spots on the pad ring itself (best 56 / 54 %) and one at 68 %, seed 8 has 12 on the 3.5 m floor |
| Hold control with the squad | 96/96 done, 30.1-31.1 s, charge drained 0.00-0.03 (control: Viridian Forest, 30-32 s, 0.00-0.01) | 64/64 done, 31-44 s, drained 0.00-0.09 (control: classic badlands, same stage, 45 s, 0.10) |
| camera on the causeways / in the tunnels | causeways and bridges read well; the tight frames are at wall-hugging ramps | tunnels read when the camera follows the route; with a fixed camera the lens collapses to the rock |
| hazard readability | the river is not on any route; not part of this pass | **vent warning was invisible from a chase camera: fixed**; a player who reacts in time takes 0 hits in 90-95 % of start phases |

## 2. Fixes (small, each re-run on the live case)

| # | Observed | Fix | Check |
| --- | --- | --- | --- |
| 1 | **The Raid party never walked team B's approaches on the Crater, and on some Gorge seeds.** `rules.enemy.despawnDistance` (46 m) relocates any non-boss enemy that far from the trainer onto a 30 m ring ahead of the trainer's heading. Team B's staging is 42-47 m (Crater, every seed 1-30) or 33-43 m (Gorge) from the point, plus up to 5 m for where on the pad the trainer stands, so the party was relocated the tick it spawned. Evidence: Crater Raiders appeared at four different foot-plain tiles 25-34 m from the pad, took the direct, flank or "mixed" way depending on where they landed (42/12/10), reached the pad 4.9 s after the Hold opened instead of ~12 s, and one stood against rock at (77,34) for the whole Hold (seed 7). With `despawnDistance` raised, all four left the staging and took the direct approach. | `src/sim/enemies.ts`: Raiders of an active Hold on a habitat map are never relocated (`raiding`). Ordinary enemies, Hunts and classic maps unchanged. | `tests/habtac.test.ts` (Crater 7 and 3, Gorge 25: the party starts within 4 m of B's staging with the trainer past 46 m, and a Raider reaches the pad in 20 s), `scripts/habtac.ts` before/after (section 3), full `npm test` 281/281 |
| 2 | **The vent warning is invisible from the chase camera.** The 1.5 s cue was steam particles (white, ice-like, 0.7 s lifetime) on every third vent tile. From 3 tiles the frame at 6.1 s is indistinguishable from the dormant frame; the vent next to the trainer shows nothing (`tools/habplayscenes.json`, `vent-C7-3tiles-*`). No sound, no HUD. | `src/sim/hazards.ts`: on the first step of the warning one hostile telegraph ring (the existing red ring and fill) is put on **every** vent tile for the whole 1.5 s. The footprint is the cue; the steam stays. No renderer change, no new event type. | `tests/habtac.test.ts` (one ring per vent tile, once per cycle, on the right step, none on a seed without a vent branch); browser frames before / after in section 6 |
| 3 | `scripts/habplay.ts --raid` failed on Gorge 5 (flank retreat; the same without fix 1): knocked off the causeway, the trainer stood under it and the driver (a Water type never triggers the shore rescue) stalled 14 times. | the driver plans again from where it stands after a stall, and with less clearance if it must | raid 24/24 (was 23/24), geometry 24/24 |

Not changed: the sightline gate, route lengths, generation (no `HAB_VERSION` bump, every checksum in docs/HABITAT_AUDIT.md still
holds), the rules numbers, the camera (docs/THIRD_PERSON.md and `src/render/camera.ts` are being changed in the working tree by
other sessions; section 5 is for them).

## 3. Before and after the Raid fix (squad, horde on / calm, 2 run seeds each, both routes, both retreats)

| | Gorge before | Gorge after | Crater before | Crater after |
| --- | --- | --- | --- | --- |
| Raiders reach 5 m of the pad (calm, natural) | 92 % at 10.0 s | 92 % at 10.5 s | 100 % at **4.9 s** | 100 % at **12.1 s** |
| Raiders' route (natural, calm): direct / flank / mixed | 96 / 0 / 0 | 96 / 0 / 0 | **42 / 12 / 10** | **64 / 0 / 0** |
| same, horde | 84 / 2 / 10 | 84 / 2 / 10 | 36 / 18 / 10 | 64 / 0 / 0 |
| Hold done, time (horde) | 24/24, 31.1 s | 24/24, 31.1 s | 14/16, 39.7 s | 16/16, 41.6 s |
| Hold done, time (calm) | 24/24, 30.3 s | 24/24, 30.3 s | 16/16, 35.3 s | 16/16, 33.4 s |

## 4. The evidence, per recipe

### 4.1 Approach: both routes, arrival, exposure (movement-only trainer, then active combat)

`scripts/habplay.ts` (movement only; Hold held, retreat walked): all 24 runs of seeds 1-6 pass in all three modes that apply
(geometry only 24/24, Raid party live 24/24; with every enemy live and a non-fighting trainer 0/24, as docs/HABITATS.md says).

| Trainer, calm | Gorge 3 | Gorge 7 | Gorge 25 | Crater 3 | Crater 7 |
| --- | --- | --- | --- | --- | --- |
| direct: reach / retreat | 8.8 / 10.6 s | 9.4 / 9.1 s | 9.3 / 9.4 s | 9.7 / 29.4 s¹ | 9.5 / 9.9 s |
| flank: reach / retreat | 13.9 / 14.9 s | 14.0 / 13.5 s | 14.6 / 13.9 s | 11.2 / 10.5 s | 11.7 / 10.6 s |
| route length A direct / flank, B direct / flank (m) | 80/114, 78/122 | 78/112, 85/125 | 78/116, **91**/131 | 78/94, 78/92 | 80/98, 80/98 |
| trainer, live horde: reach direct / flank | 9.0 / 13.4 s | 9.4 / 13.8 s | 9.3 / 13.4 s | 9.9 / 14.1 s | **32.3 / 25.2 s** |

¹ the movement-only driver stalled four times on a convex wall corner at (92,64) on the way back and took 29 s: a driver artifact (the
combat harness replans and returns in 11-16 s), not a map defect.

**Seed 7, direct, live horde (Crater).** Two runs: 15.3 s and 49.2 s to the pad. In the slow one the trainer climbs the grounded
switchback, reaches the 1.8 m shelf at tiles x 72-77, y 88-94, is knocked off its open east edge (x 78, 1.8 m above the foot plain)
and starts the climb again, several times. The first tenth of the route also takes 31-37 HP of damage in all Crater runs (the horde
that formed during the warm-up). A map-side rail on that edge would need a generator change (`HAB_VERSION` 3, new checksums); it
is **not done**, and a person fighting while walking is knocked far less than this script, so replay it first (checklist 4).

**First contact.** Travel: with the horde on, a hostile is within 2.2 m after 0.8-3.8 s on the Gorge and at the first step on the
Crater (the warm-up horde is already at the staging); calm, when one is met at all (4-8 of 8 runs) it is a residual elite or swarm 7-12 s in, 49-92 % along the route. At the pad (calm, natural, seconds after the Hold opens; first Raider within 14 m, first hit by the squad, on the
pad, mean distance from the pad where they die; the first hit was not recorded on the Gorge): Gorge 3: 7.7 / - / 9.2 s / 6.1 m; Gorge 7: 9.2 / - / 11.0 s / 3.5 m; Gorge 25: 9.2 / - / 10.9 s / 6.1 m; Crater 3: 10.1 / 12.7 s at 3.1 m / 12.1 s / 1.1 m; Crater 7: 10.3 / 12.8 s at 4.4 m / 12.1 s / 1.0 m. On the Gorge the squad kills the party 3.5-6 m out; on the Crater **the first Raider is on the pad (12.1 s) before the first hit lands (12.7-12.8 s)** and the party dies 1 m from its centre: the forecourt is flat, ringed by ruin stubs, and a Raider is in view of the pad only 12-19 m out (Gorge 8-19 m).

**Pressure at the contest floor** (mean count within 8 m of the pad during the Hold): Gorge 0.1 Raiders, 0.8 others calm and 0.3 / 25
with the horde (peak 78); Crater 0.4 / 4.3 calm and 0.4 / 27 with the horde (peak 89). A Raider stood on the pad for 0.1-1.4 s on
the Gorge and 3.6-4.9 s on the Crater, draining 0.00 and 0.01-0.09 of the charge. Controls (Viridian Forest, classic meadow): 30-32 s, 0.00-0.01;
classic badlands with the horde: 45 s, 0.10, 5 s off the pad; the Crater is no harder than ordinary badlands pressure (41.6 s, 0.05).
With a solo level 8 partner the Gorge Hold is still 12/12 (31-34 s); on badlands the partner is **wiped in the 100 s warm-up before the
Hold is offered, on the Crater (8/8) and on the classic badlands control (6/6)**: that is enemy pressure, not the map.

**Where the Gorge jams.** Gorge 3 with the horde: only 50 % of the Raiders get within 5 m of the pad; the rest stand at tiles
(65-67, 57), 8-9 m south of it, at the foot of the island, pressed by the horde crowd for the whole Hold. Raid-only they arrive (75 %). The bridge landing is a choke, so the horde the trainer attracts plugs it. Seeds 7 and 25 with the horde: 100 %.

**Retreat** (calm / horde, seconds, same or the other approach): Gorge direct 9.3 / 14.4, via the flank 14.4 / 22.0, flank 13.8 / 17.7,
via the direct 9.0 / 10.9; Crater direct 10.7 / 16.0, via the flank 12.6 / 21.2, flank 14.0 / 20.8, via the direct 11.5 / 22.2. Damage is
within -9 % to +2 % of squad HP every time (healing and grey health). With the horde the flank retreats end with 7-16 enemies within 8 m, the direct ones with 4-10. Retreat works on both approaches and both recipes; the flank is 5-8 s slower and more pressured.

### 4.2 Contestability: can high ground deny both routes?

`scripts/habgeom.ts` (final collision; positions the player can stand on within 32 m of the point, off both of team B's routes;
"watching" = at least half of the last 40 m of **each** of B's two approaches within 14 m and in sight):

| | spots watching both | on the pad ring | high (≥ 1.5 m over the route) | strongest single spot |
| --- | --- | --- | --- | --- |
| Gorge 3, 7, 25 | 0, 0, 0 | 0 | 0 | 41 % / 41 % / 37 % (all at the foot or on the terrace, 3-16 m off) |
| Gorge 1, 2, 4, 5, 6, 9 | 0 | 0 | 0 | 37-49 % |
| Gorge 10 | 2 | 0 | 2 (3.0 m terrace, 7.4 m off) | 59 % / 54 % |
| **Gorge 8** | 78 | 17 | 26 | the second B approach is within 5 tiles of the first for part of its length (passes the 4-tile gate); one search for a route 5 tiles clear of the first found none (88 m / 88 m), so the result is about one approach, not two |
| Crater 3, 7 | 26, 18 | 0 | 0 | 61 % / 59 % at 12.5 m, 56 % / 56 % at 10.5 m (floor, 3.5 m) |
| Crater 1, 2, 5 | 6, 16, 39 | 0, 0, 4 | 0 | 54 %, 56 %, **68 %** (seed 5, tile 76,55, 11 m off) |
| Crater 4, 6, 9, 10 | 0 | 0 | 0 | 41-49 % |
| Crater 8 | 12 | 0 | 12 (3.5 m floor over the foot plain) | 56 % / 66 % at 9.7 m |

The rim, the terrace and the crest do not deny both routes on any of the target seeds (the only spots on a pad ring that do are four tiles on Crater 5). On the Crater a trainer who steps 8-12 m
off the pad onto the forecourt floor can shoot both approaches, but the Hold charges only inside 5 m, so that trades the objective
for the fight; the gate (`perch`, 14 m range here) is doing its job for high ground.

### 4.3 Camera (read-only diagnostic, `scripts/habcam.ts`, frames in `tools/habplayscenes.json`)

The rig is walked along each approach at 60 fps with the lens yaw following the route ("ahead"), 90° off it ("side") and at the
default yaw ("fixed"). Terrain stood between the lens and the Pokémon in 0.0-0.2 % of frames (worst single walk 0.7 %); props are dithered by the renderer and are not counted.

| Stretch | policy | boom, median / worst (share of open boom) | lens nearest the Pokémon | route visible ahead (p10) |
| --- | --- | --- | --- | --- |
| Gorge **bridge / causeway deck** | ahead / side / fixed | 100 / 61 %, 99 / 44 %, 99 / 46 % | 2.69 / 1.95 / 2.02 m | 3 / 7 / 7 m (worst walk) |
| Gorge ramp (switchback, bench ramp) | ahead | 85 / **9 %** | **0.40 m** (Pokémon dissolved) | 0 m at a hairpin |
| Gorge open ground at the route start | ahead | 100 / 9 % | 0.40 m | 2 m |
| Crater tunnel | ahead / side / fixed | 85 / 58 %, 45 / 11 %, **36 / 9 %** | 2.57 / 0.47 / 0.41 m | 0 m at the crest |
| Crater ramp | ahead / side / fixed | 67 / 9 %, 10 / 9 %, 14 / 9 % | 0.40 m | 2-3 m |

Gorge causeways and bridges read well in the frames viewed (the shrine, both banks, the route; `cam-G3-flank-deck-*`,
`cam-G25-direct-deck-*`). Crater tunnels read when the camera follows the route (`cam-C3-direct-tunnel-ahead`: walls frame the
corridor, the route and an item are visible) and do not when it does not (`cam-C7-direct-tunnel-fixed`: the Pokémon fills 45 % of
the frame against rock, the route is out of sight). Tight frames with the camera following the route, for the camera owners:

| Map, seed | Route, kind | Tile | Boom | Lens |
| --- | --- | --- | --- | --- |
| Gorge 3 | direct, start of the wall switchback | 56,92 | 10 % | 0.42 m |
| Gorge 3 | flank, foot of the bench ramp | 73,95 / 74,96 | 17 % | 0.73 m |
| Gorge 7 | direct, wall at the start | 66,91 | 9 % | 0.41 m |
| Gorge 7 | flank, bench ramp foot | 46,95 | 9 % | 0.40 m (`cam-G7-flank-ramp-ahead`: a wall fills the right quarter, the Pokémon is readable) |
| Gorge 25 | direct, ramp | 52,31 | 42 % | 1.87 m |
| Crater 7 | flank, ramp cut into the flank | 47,79 / 48,78 | 9 % | 0.40 m (`cam-C7-flank-ramp-ahead`: a blurred rock column fills the left 40 %) |

No camera code was changed and no map was moved for these: each is a wall-hugging route start or ramp foot, which is how the rig
treats any corridor (docs/THIRD_PERSON.md, "Collision" and "Safety net"); whether it is a rig matter or a map matter is for the
people working on the rig. Re-run `npx tsx scripts/habcam.ts <recipe> <seeds> --yaw all` after any camera change; the walk and the
frames are deterministic. (The script prints an `fpsDev` column that is not reliable; use `scripts/camstats.ts --fps 60,144`.)

### 4.4 Hazard readability: the vent warning

The vent clock: 10 s, quiet 6.0 s, warning 1.5 s, eruption 2.5 s with five ticks of 2 % maximum HP (docs/HABITAT_STATES.md). Fields
on seeds 1-9: 4-27 vent tiles, never more than 2 tiles from safe ground, each in a side branch of a cave chamber 10-20 m from the
pad. `scripts/habvent.ts` walks the trainer into the field at every 0.1 s phase of the cycle (100 phases per case; top speed 7.2 m/s,
also 5.4), through the real sim:

| Player | start phases with at least one hit | mean hits / worst (2 % each) |
| --- | --- | --- |
| stands at the deepest vent tile for 4 s (never looks at the ground) | **60-62 %** | 2.0-2.1 / 5 (4 % / 10 % of maximum HP) |
| turns for the nearest safe tile 0.35, 0.5 or 0.8 s after the warning starts | 5 % (10 % on seeds 2 and 5 at 5.4 m/s) | 0.05-0.1 / **1** |

Seeds 1, 2, 3, 5, 7, 9 at 5.4 and 7.2 m/s. The reactive player is hit once at most, in the phases where the walker is still on its way in when the field erupts (the model leaves the field after the reaction time but does not stop short of it), and a slower reaction (0.8 s) changes nothing: the budget (1.5 s warning against 0.3 s to leave 2 tiles) is not the limit. The limit was whether a player saw the warning, and from a chase camera they did not (section 2, fix 2): the ring on every
tile is the footprint and the exit direction, and costs the eruption nothing. The damage is small (never above 10 % per eruption), so the field
is a nuisance more than a denial; that is a tuning question for people (`rules.habitat.vent.pct`).

## 5. For the people working on the camera

Everything in 4.3 is read-only and replayable; the three frames above that matter most for the Gorge are the wall-hugging route
starts (Gorge 3 at 56,92 and 73,95, Gorge 7 at 66,91 and 46,95). `tools/habplayscenes.json` holds the frames
(`node tools/cap.mjs dist/index.html tools/habplayscenes.json out cam-`). Nothing was added to `tools/chasecheck.json` or
`scripts/camstats.ts`.

## 6. Browser frames (before / after)

`node tools/cap.mjs <build>/index.html tools/habplayscenes.json out vent-C7-3tiles` captured with a private build of the tree before
and after fix 2. Seed 7, standing 3 tiles from the nearest vent, facing it: dormant, 0.1 s into the warning, 1.3 s into it, erupting.
Before: the three pre-eruption frames are the same picture (a few embers; the vent beside the trainer shows nothing); the
eruption shows small white sprites over part of the field. After: the 1.3 s frame has red rings and fill on the vent tiles, one of
them beside the trainer (half behind the sprite, as any ground cue is from behind); the far cluster is outlined in red.

## 7. Replayable checklist (what the harness cannot judge)

Run `npm run dev`; `index.html?go=1&loc=<recipe>&mapseed=<seed>&species=bulbasaur&level=10&squad=mareep,geodude` starts the match.
`pokewatch.ctx.world.hab` has the contest, the stagings and the vent tiles (tile coordinates, `&tp=<i>,<j>` teleports).

1. **Raid on the Crater, both approaches** (`volcanic-ridge`, seed 7 then 3). Walk to the pad by the direct approach and stand on
   it. At about 12 s a party of five should come up B's notch from the south-west staging (tile ~52,20), together. Record: where you
   first see a Raider, whether you hit one before it is on the pad, whether the forecourt is somewhere you can fight (0-9 % charge
   lost is expected). Repeat with the flank (take the cave).
2. **The flagged seed** (`river-gorge`, seed 25). Stand on the shrine terrace; Raiders arrive at ~11 s from the east rim path
   (B's staging 41 m away). Does anything about the 91 m B route against your 78 m feel unfair? Expected: no.
3. **Gorge flank as an attack route.** Same seed, `&tp` to B's staging, open the Hold, walk B's flank with the Raid party spawned: do
   you die before the terrace (12-35 m out in the harness)?
4. **Switchback knockback** (`volcanic-ridge`, seed 7). Walk the direct approach with the horde on and fight as you go. At the 1.8 m
   shelf (tiles x 72-77, y 88-94) let enemies hit you from the east. Are you pushed off the open edge (x 78)? How often, and does the
   trek take 10 s or 30?
5. **Bridge jam** (`river-gorge`, seed 3, horde on). Hold the pad for 30 s and watch tiles (65-67, 57): do Raiders stand there? Does
   the pad feel safe because of it?
6. **Camera, wall-hugging frames.** `&calm=1&tp=56,92` (Gorge 3), `&tp=46,95` (Gorge 7), `&tp=48,78` (Crater 7); walk on with the
   mouse off, then with the camera on the route. Is the lens inside the cliff, is the route readable? Compare with
   `tools/habplayscenes.json`. Then the causeway (`river-gorge` seed 3, `&tp=70,86`) and the Crater tunnel (seed 3, `&tp=92,62`).
7. **Vent warning** (`volcanic-ridge`, seed 7, `&calm=1&stageTime=5&tp=39,78`, facing north; also seed 2 for a 25-tile field). At
   stage time 6.0 s red rings should appear on every vent tile, at 7.5 s steam and damage, at 10 s quiet. Record: can you tell the edge
   of the field and which way is out, from 3 tiles and from 8, with the Pokémon between you and it; would a sound help?
8. **Denial from the floor** (`volcanic-ridge`, seed 5, `&tp=76,55`; seed 8, `&tp=55,78`). Open the Hold at the pad, run to the spot
   and shoot: do you kill Raiders on both approaches before they reach the pad, and does skipping the pad feel like a strategy or like
   cheating?
9. **Retreat.** After a Hold with the horde on, retreat by the flank and by the direct approach on each recipe: is the flank worth its 5-8 s?
10. **Recruits.** Habitat maps open only Holds, so a run on them never gets a recruit (squad stays at 1). Does the Hold feel
    right for one Pokémon, and is that intended?
11. **Tide warning and flood** (`tidal-cave`, seed 7, `&calm=1&stageTime=40`, then walk down a hall ramp; frames in
    `tools/tidescenes.json`). At 44 s the banner and the blue pulse on the floor that will flood; at 52 s the water. Record: from the
    middle of the hall, is it clear which way is out (the exit ramps, the beach), is 8 s enough with a non-swimmer, does the pulse read
    through the camera at the hall's ends? Repeat with a Water type and swim the flooded hall to the up-ramp: is the swim worth it?
12. **Tidal Hold** (`tidal-cave`, seed 1 and 2, horde on). Take the low-water shortcut to the point at ~10 s; open the Hold so it
    runs across the flood (offer it at ~35-45 s). Do Raiders caught in the hall feel like a reward (they wade, lose HP, arrive late)
    or noise? Does the gallery's causeway, with the hall under it, give a view worth holding?

## 8. Seeds to keep for the next playtest

| Seed | Why |
| --- | --- |
| Gorge 3 | the reference: short and symmetric (A 80 / B 78 m), the bridge jam, the clean causeway camera frames |
| Gorge 25 | the flagged seed (reproduces: 11.3 s vs 13.3 s, 15.6 %): longest B route (91 m), B's staging 41 m from the pad (the despawn-rule case), Hold 24/24. In its real role the skew does not exist: the validator compares both sides at the trainer's speed, but Raiders move 1.25x (B's 91 m is a ~10.6 s walk against the trainer's 11.3 s) and appear only when the defender has arrived, so the defender is on the point at 9.3 s (direct) and the Raiders reach it 10.9 s after that, within 2 s of seeds 3 and 7 (9.2 and 11.0 s) |
| Gorge 7 | the other orientation (B 85 m); the tightest wall-hugging camera frames (46,95, 66,91) |
| Crater 7 | the longest trek under a horde (15-49 s), the open shelf, the tightest camera ramp (48,78), a 14-tile field |
| Crater 3 | a retry seed (loads 548672811): exercises the plaque and replay link; the mild approach (9.9 s); 7 vent tiles |
| Crater 2 | the largest vent field (25 tiles) for the warning test |
| Crater 5, 8 | the denial probes (68 % at 76,55; 12 floor spots at 55,78) |
| not Gorge 8 | the second B approach is not 5 tiles from the first: a single-route map for approach-independence tests |
| Tidal cave 1, 2, 7 | the validated tide seeds (`scripts/habtide.ts`): 7 has the farthest flooded tile (10.5 m) and the shortest swim (8.1 s vs 9.9 s dry) |

## Reproduce

| What | Command |
| --- | --- |
| movement only: arrival, Hold, retreat | `npx tsx scripts/habplay.ts all 6 1` (`--raid`, `--enemies`) |
| active combat Hold | `npx tsx scripts/habtac.ts <river-gorge,volcanic-ridge\|viridian-forest\|classic> <3,7,25> [--runs 1,2] [--stage N] [--squad bulbasaur,mareep,geodude] [--level 10] [--horde on\|off\|both] [--raid natural\|alt\|both] [--route direct\|flank\|both] [--back same\|other\|both] [--recycle off] --json out.json -v` ; aggregate with `node scripts/habtac-sum.mjs out.json --by map,seed,horde,raid` |
| static routes, sight from the pad, denial scan | `npx tsx scripts/habgeom.ts river-gorge 3,7,25 [--range 14] [--thr 0.5]` |
| camera along an approach | `npx tsx scripts/habcam.ts volcanic-ridge 3,7 --yaw all [--shots out.json]` |
| vent warning and reaction | `npx tsx scripts/habvent.ts 1,2,3,5,7,9` |
| regression | `npx tsx --test tests/habtac.test.ts` (and `npm test`) |
| browser frames | `node tools/cap.mjs dist/index.html tools/habplayscenes.json out [cam-\|vent-]` |

Not established here: human play (everything above is a script), more than two run seeds per case, other CPUs, the sound of any cue, whether
a rail on the Crater shelf is worth a generator version, and the solo squad on the Crater (the partner dies in the warm-up on that stage,
which the classic badlands control also does).
