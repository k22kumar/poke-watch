# Fidelity assessment and test results

## Side-by-side with PokéBonk

| Area | PokéBonk | Poke-Watch | Match |
|---|---|---|---|
| Creatures | Pokémon species drawn from PMD sprites | 32 original creatures (6 two-form partner lines, 16 wild, 4 bosses) | **Different by design** |
| Rendering technique | Instanced camera-facing 8-direction sprite billboards in a 3D heightfield world, blob shadows, rings, beams, floating text | Same technique. Sheets are baked from original low-poly models at load; dissolve on death, flash on hit, status tints | Close |
| Look | PMD pixel sprites, AI-made biome textures and props, bloom, colour grade | Pixel-outlined toon sprites, procedural low-poly props, speckled pixel ground, SNES-style dithered sky, fog 40–160 m, screen-door prop fading. No bloom pass; additive glows instead | Similar genre feel, own art |
| Camera | Third-person orbit, distance 9, pitch 0.45, lock-on, trauma shake | Same distance and pitch, mouse/pad orbit, trauma shake. No lock-on | Close |
| Movement | Heightfield, 0.6 m step rule, gravity 30, glide 2 m/s, dash | Same numbers and rules | Match |
| Moves | ~20 archetypes derived from move data by classifier + power/priority scaling | 23 archetypes, same classifier order and scaling clamps, 70 original moves | Match (system) |
| Damage | STAB, 18×18 chart, weather, crit, sleep bonus, statuses | Same pipeline and constants; own chart contents | Match (system) |
| Enemies | SoA pool (2,200), grid separation, seek steering, roles (elite, alpha, boss, ranged, swarm…), boss kits | Same pool, grid, steering constants and HP/speed/damage formulas. Roles: elite, alpha, boss, ranged, swarm, healer, charger, tank. Bosses have phases, charge, slam, radial, spiral, volley and summon attacks | Close |
| Director | HP curve per stage and minute, toughness, speed curve, final swarm ×4^min, quality cap + FPS governor | All implemented with the confirmed constants. Spawn rate and cap ramp are Poke-Watch's own (the originals are unknown) | Close |
| Progression | XP round(8 + 5.5L + L^1.8), card modal with reroll/skip/banish, 3→4 move slots, 3 vitamin slots, evolution cinematic with heal | All implemented | Match |
| Stages | Several stages per region, boss, portal | 4 regions (meadow, badlands, frost, dusk), boss at 5:00, portal, final swarm at 8:00 | Close (timings inferred) |
| Modes | Classic, Survival (+curses), difficulty tiers | Classic, Survival (endless laps), Glass Cannon, Boss Rush; `mode.difficulty` knob | Partial |
| Audio | Procedural SFX recipes + OGG music | Procedural SFX recipes + generative chiptune per biome | Close (no recorded music) |
| UI | Vanilla DOM HUD, cards, menus | Vanilla DOM; own layout and style | Own design |
| Online | Accounts, ranked runs, clans, leaderboards, seasons | Not implemented (offline only) | Missing |
| Capture / League / pacts / items / abilities | Present | Not implemented | Missing |
| Timestep | Variable, clamped 1/20 s (non-reproducible) | Fixed 60 Hz, seeded streams. Runs replay exactly from the seed and inputs | Deliberate improvement |

## DS-era pixel presentation (course correction, 2026-10-20)

The survivor game stays the core product; the Maplebrook overworld is parked as a separate page. The arena now uses the DS-style pixel toolchain:

- **Rendering.** The 3D arena renders at about 270 internal lines with an integer upscale and nearest filtering, so terrain, props, creatures and effects share one pixel grid.
- **Pixel density.** Creatures are baked at 24 texels per metre, the same density as every prop and effect sprite. Damage numbers use the pixel font on the same grid.
- **Arena props.** Pixel-art billboards replace the low-poly props in every biome: tiered and round trees, snow-capped pines, dead trees, dusk trees, bushes, rocks, crystals, mushrooms, vents, tall-grass tufts and swaying flower clumps.
- **Ground.** A pixel detail texture covers the ground, and path edges are crisp and outlined per texel, in the style of HGSS tile transitions. The meadow palette is mint.
- **Combat effects.** Each element has its own sprite set. Blaze uses fireballs, flames and embers; Tide uses bubbles and drops; Bloom uses leaves and petals; Volt uses sparks; Frost uses shards and snowflakes; Mind uses psi orbs and stars; and so on. Projectiles orient along their flight, impact stars mark hits (bigger for crits and super-effective hits), and fades are stippled rather than soft.
- **HUD.** The HUD uses a pixel typeface with squarer panels.

## What was tested

**Headless (Node, `npm test`): 9/9 passing**

- The RNG stream is stable.
- The XP curve equals round(8 + 5.5L + L^1.8) for L = 1..40.
- The HP, toughness and speed curves equal the confirmed formulas.
- All 70 moves classify to defined archetypes, and scaling stays within the clamps.
- All learnsets reference real moves.
- Determinism: two 90 s bot runs with the same seed produce identical state hashes, and a different seed produces a different hash.
- Classic flow: the boss spawns at exactly 5:00, and region 1 clears to region 2 through the portal.
- Mods and modes merge rules, register hooks, and fire `onKill` once per KO.
- Pool capacity holds under 40× spawn pressure.

**Headless balance (`npm run sim`), with a simple kiting bot over 25 min and 2 seeds per partner.** All six partners evolve and clear 1 to 4 regions. Rayling won Classic on both seeds (about 21–23 min). Hootz died early on one seed. The bot never engages on purpose, so melee partners under-perform with it. The sim runs at about 40–70× real time.

**Browser (headless Chromium with SwiftShader software WebGL).**

- Every screen was exercised: loading, title with an attract-mode flyover, partner select, HUD, level-up cards (a pick applied a vitamin), pause, tuning panel.
- Combat ran with hundreds of creatures, damage numbers, statuses and elites.
- All four biomes and all four boss spawns rendered with no console or page errors. The only failed request is the Google Fonts load, because this sandbox is offline.
- Sprite facing was checked for left and right movement. Evolution (Rayling → Mantide, Psiquid → Cerebrosquid) and stage transitions were checked in Boss Rush.
- Per-frame CPU cost measured in the browser: sim about 2–6 ms, render submission about 1 ms.

## Not verified here

- **Frame rate on real GPUs.** The test browser rasterises in software (about 4–9 fps at 1100×650). The CPU-side cost is small, and draw calls are about 30 instanced batches, so 60 fps is expected on any discrete or recent integrated GPU, but this was not measured.
- **Audio output.** Recipes run without errors, but nobody listened to them.
- **Inputs in a real browser.** Pointer lock, gamepad and touch were not exercised. There are no touch controls.
- **Balance with human play.** Tune it with the backtick panel or `src/rules/defaults.ts`.

## Known limitations

- The player sprite can be hidden behind very large bosses (no silhouette pass).
- Props have no collision, as in the original. Only terrain steps block movement.
- The tuning panel edits the live run's rules, so that run is no longer reproducible from its seed.
- The `npm run dev` watcher rebuilds on TypeScript changes. Edits to `style.css` or `index.html` need a save of any `.ts` file, or a re-run.
