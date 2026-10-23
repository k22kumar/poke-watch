# Roles, objectives and the beat director: what is built (phase 7)

Design: *Poke-Watch Unified Squad Blueprint*, section 9. This file records what the code does, its numbers and what was
measured. Tunables live in `src/rules/defaults.ts` (`roles`, `objectives`, `beats`); compositions are data in
`src/rules/compositions.ts`.

## Enemy roles (`sim/enemies.ts`, `sim/effects.ts`, `sim/combat.ts`)

| Role | Bit | Pressure | Behaviour | Answers |
| --- | --- | --- | --- | --- |
| Pursue | (default) | Where you can stand | v8 chase, swarm, charger | Autofire, Push, terrain, Dash |
| Disrupt: Hexer | `hexer` | Answer it now | Keeps ~9 m away; every 4.5 s marks where you are heading (0.8 s ring in its type colour), then lays a deep Wet / Heat / Cold / Charge puddle (2 m) and deep-coats you if you are on it | Move off the ring, Dash, Jump, Tag out the coated Pokémon, kill it |
| Protect: Bulwark | `shielder` | Who dies first | Blocks your shots that reach its front (90° arc, 2.4 m); a pale ring shows a raised shield | Flank, lobs (they fly over), melee, a Fighting hit, a hold or a big shove breaks the guard for 4 s |
| Protect: Mender | `healer` | Who dies first | Heals everything within 5 m by 12% every 3.2 s; keeps 7 m from you | Reach it through the pack, ranged moves |
| Raid | `raider` | Divided attention | 1.25× speed, 0.8× HP; goes for the Hold pad (drains it) or the loose Egg (steals it and runs) | Kill or freeze it; stay on the pad |

Natural spawns keep their v8 behaviours; the roles arrive through compositions and objectives.

## Compositions (`rules/compositions.ts`)

Filled from the region's own Pokémon (spawns and elites); a composition whose jobs a region cannot fill is skipped.

| Composition | Members | Question | Regions |
| --- | --- | --- | --- |
| Wall and guns | Bulwark (elite from region 2) + 2 ranged | Flank, go over, or push the wall? | All four |
| Pack with a medic | 6 pursuers + Mender | Kill the medic through the pack? | Meadow (Oddish), Frost (Delibird), Dusk (Paras) |
| Soak and strike | Wet Hexer + 3 Electric chargers | Tag out, jump the flood, or steam the water? | Meadow (Poliwag + Mareep) |
| Hex ambush | Hexer + 4 pursuers | Leave the puddle or kill the Hexer? | All four |
| Raid party | 4 Raiders + Bulwark | Defend the objective or chase? | Sent when Hold or Transport becomes active |

Mareep was added to Sunpetal Meadow's spawns (weight 1.2) so Soak and strike — the blueprint's walkthrough A — can form
somewhere; no region had both a Wet Hexer and Electric chargers before.

## Objectives (`sim/objectives.ts`)

Two per region: the first at the first Peak after 1:30, the second after 3:20 of the stage. Region 1 opens with Hold
then Hunt (first recruit around 4:00), region 2 with Transport then Hunt (second recruit around 9:00); later regions
draw at random, and a Hunt with a full squad becomes a Hold or Transport. Each has a 45 s window to engage; an
objective that lapses or is lost brings a Peak forward (without a new objective). None opens once the boss is out.

| Objective | Play | Limit | Reward |
| --- | --- | --- | --- |
| Hold | Stand within 5 m of the pad: it charges in 30 s; each Raider on it drains 0.015/s | 60 s | An item ball (techniques in Phase 8) |
| Hunt | A marked alpha of a recruitable species with 4 escorts; under half health it runs to a Mender ~14 m beyond it | 75 s | It offers to join you (plus one other); item ball when the squad is full |
| Transport | Walk into the Egg to carry it (70% speed, no Move A / B; Guard, Dash, Tag or a faint drops it) or push it (Medium: Power 2); deliver it ~36 m away | 90 s | The field Pokémon evolves now (or the first that can); otherwise a full squad heal |

With objectives on, recruits come only from the Hunt (v8's alpha at 3:30 and elite-kill recruits return with
`objectives.enabled: false`).

## The beat director (`sim/director.ts`)

v8's spawner is unchanged underneath (spawn curve, caps, elites, ring swarms, boss at 5:00). On top:

| Beat | Length | Spawn rate | What happens |
| --- | --- | --- | --- |
| Build | 35–45 s | 0.75× → 1.15× | — |
| Peak | 20–30 s (ends early after 5 s at intensity ≥ 0.85) | 1.3× | An objective when due; else regional weather (30% where the region has weather); else a composition (not before 1:15 of a stage) |
| Relax | 10–15 s | 0.3×, no ring swarms | Time to spend banked picks |

Intensity = 0.45 × recent damage (≈10 s, against 35% of max HP) + 0.35 × enemies within 6 m (of 14) + 0.2 × missing
health, smoothed. Beats rest while the boss is out. Weather: Rain (Meadow, Dusk) soaks open ground near you every
0.5 s and weakens Fire; harsh Sun (Meadow, Badlands) strengthens Fire, doubles Chlorophyll speed and now and then
lights tall grass; Frost (Rimefrost Heights) freezes nearby wet ground and ponds into slippery, walkable ice. These
regional weather events last 30 s.

## Measurements (2026-10-21, headless, this build)

| Check | Result |
| --- | --- |
| Tests | 79/79 (8 new in `tests/phase7.test.ts`) |
| Sim cost at ~500 enemies | p50 0.62 ms, p95 1.42 ms (gate ≤ 2 ms), p99 3.7 ms (Phase 6: 1.9 ms; watch before rollback) |
| Bot survival, 6 partners × 3 seeds, Classic, 600 s | 11/18 reach 600 s (Phase 6: 11/18). A first version that allowed compositions from the first Peak (~0:40) and an elite Bulwark in region 1 fell to 7/18, nearly all deaths before 2:00 |
| H6 proxy, bot engaging vs ignoring objectives (`scripts/h6.ts`, 6 partners × 3 seeds, 900 s cap) | Engaging: 96% engaged, 36 of 52 completed (Hunt 19/21, Transport 11/18, Hold 6/13), 1.06 recruits per run, mean 583 s, 8/18 reach region 3. Ignoring: 0 Holds and 0 Transports completed (Hunts still end in a fight: 16/19), 0.89 recruits, mean 509 s, 7/18 reach region 3. Engaging pays; ignoring every objective is survivable. Hold is the hardest for the bot because it leaves the pad under pressure |

The bot moves toward the objective when it is not under pressure; it is not a substitute for H5 and H6 with people
(blueprint section 16).

## Not built yet

- Hexers are any regional Pokémon with a Fire, Water, Ice or Electric type (Mareep lays Charge, which floods wet
  ground); a dedicated Hexer species list per region would make them easier to recognise.
- Relax beats do not yet surface the tray with a prompt; banked picks are always in the tray (Phase 4).
- Techniques (the Hold reward), the three-card offer, Tag assist: Phase 8. Co-op scaling (parallel compositions,
  two objectives at once, √players HP): Phase 9.

## Test hooks

`window.pokewatch.objective('hold' | 'hunt' | 'transport')` and `window.pokewatch.composition('<id>')` in a running game;
`tools/phase7scenes.json` captures a Hold, a Hunt, a Transport, Wall and guns, and Soak and strike in the rain.
