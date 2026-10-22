# PokéBonk: what was verified

Source: inspection of the live site (pokebonk.com, v0.7.8 beta, build `mvgfxz8a`) on 2026-10-20. That inspection covered the HTML, network requests, runtime globals, the minified bundles, the `data/*.json` files and the legal page. The full report is the "PokéBonk: Technical Investigation & Rebuild Plan" doc in the project.

Tags: **[C]** confirmed in the shipped bundle · **[O]** observed in play or traffic · **[I]** inferred · **[U]** unknown.

## Technology

| Finding | Tag |
|---|---|
| three.js r186 `WebGLRenderer` (`antialias:false`), Vite code-splitting, almost certainly TypeScript | C / C / I (high) |
| Vanilla DOM UI built with a small hyperscript helper; no UI framework | C |
| No physics library: a heightfield plus circle collisions | C |
| REST backend `api.pokebonk.com` (auth, server seeds, checkpoints, `/finish`, clans, leaderboards). No WebSocket or WebRTC | C |
| Hosting on Hetzner behind Cloudflare | C (legal page) |
| Source maps or public repository | U (none found) |
| Developer: Charcher (@ImCharcher). Assets partly AI-generated, as the developer disclosed | C |

## Content pipeline

| Finding | Tag |
|---|---|
| PokeAPI-derived JSON: 1,025 species, 919 moves, 314 abilities, 18x18 type chart, learnsets | C |
| Creatures are PMD SpriteCollab sheets (CC BY-NC 4.0) drawn as instanced 8-direction billboards; direction row chosen from heading vs camera | C |
| Moves are not hand-authored. Each one is classified into about 20 archetypes: status → buff/weather/trap; override table; zero-power physical → strike; drain → drain; multi-hit → barrage; regex on key; accuracy-less special → homing; per-type fallback | C |
| Archetype scaling: dmg × clamp(0.72 + power/260, 0.85, 1.3); cd × clamp(0.88 + (power−60)/500, 0.85, 1.15); ×0.85 for priority | C |
| Ailment chance clamp(chance/100 × 1.6, 0.15, 0.8); default status 12 % | C |

## Simulation

| Finding | Tag |
|---|---|
| Struct-of-arrays typed-array pools with free lists; enemy cap 2,200 | C |
| Uniform grid, 3 m cells, counting sort rebuilt every frame | C |
| Variable timestep: `min(dt, 1/20) × timeScale × (hitstop ? 0.08 : 1)`; death slow-mo ×0.25; world frozen in the evolving / cinematic / capturing states | C |
| mulberry32 RNG (constant 0x6D2B79F5) and FNV-1a hashing | C |
| Enemy HP = (12 + BST × 0.055) × hpMult × toughness × roleMult | C |
| hpMult = (1 + 0.3t + max(0, t − 1.5)² r) × n, t in minutes, n = [1, 5.5, 13, 20], r = [0.15, 0.07, 0.05, 0.05] | C |
| Toughness = 1.35 + 1.05 × max(0, 1 − t/480 s) | C |
| Speed = min(6.2, 3 + Spe/55) × difficulty × director; director = min(1.3, 1 + 0.02t + 0.06(stage − 1)) | C |
| Damage = 5 + Atk/16 + SpA/24; role multipliers boss HP ×70, alpha ×22, elite ×4.5 | C |
| Steering toward the player, velocity eased by min(1, 10dt), knockback decay exp(−7dt), separation within 2r + 1 | C |
| Final swarm: HP × 4^(minutes since swarm start) | C |
| Live-enemy cap by quality 500 / 900 / 1,400, plus an FPS governor (every 2 s: drop to 82 %, or +50 after three good windows) | C |
| XP to next level: round(8 + 5.5L + L^1.8) | C |
| Player: radius 0.55 m, gravity 30, glide fall speed 2 m/s, 0.6 m step rule, 3 move slots (4 later), 3 vitamin slots | C |
| Damage pipeline: STAB 1.25 (1.5625 adaptive) × type × weather 1.3/0.75 × crit × sleep 1.8 × hooks | C |
| Level-up cards with reroll (F), skip (X), banish (Z) | C |
| Camera: third-person orbit, distance 9, pitch 0.45, trauma shake, hit-stop 0.06–0.5 s | C |
| Procedural Web Audio SFX recipes; OGG music with loop points | C |
| Stages per region (four) and their exact durations and boss timings | I / U |
| Exact player damage formula and stat growth per level | U |
| Ranked anti-cheat validation logic | U |

## Second pass for the DS-style overhaul (2026-10-20)

The overhaul brief named specific bundles and data files. This is what could be established about each, with the same tags. Nothing below is inferred from a filename alone.

| Item | Tag | Finding |
|---|---|---|
| `assets/main-DNwekBOB-mvdmwnj4.js`, `assets/news-cobu-PSz-mvdmwnj4.js` | U | Not retrievable from this environment (the request to pokebonk.com failed), and no saved copy exists in the project, the source archive, its git history or the earlier investigation doc. The `mvdmwnj4` suffix doesn't match the build inspected on 2026-10-20 (`mvgfxz8a`), so they're probably from an older build. No conclusions are drawn from them. |
| "October 18 research snapshot" | U | No snapshot of that date was found anywhere available to this session. |
| `data/pokemon.json` (529 KB: 1,025 species with stats, BST, types, abilities, capture rate, evolution links) | C | From the earlier inspection of the live bundle and network traffic. |
| `data/moves.json` (356 KB: 919 moves with power, accuracy, class, type, priority, ailment, drain, crit, flinch, hit counts) | C | Same. |
| `data/learnsets.json` (129 KB, level-up learnsets) | C | Same. |
| `version.json` (`{build, version}`), polled to trigger a reload on new builds | C | Same. |
| `data/sprites.json` + `assets/pmd/<id>.png` (~25 KB each): one repacked PMD SpriteCollab sheet per species with the animations idle, walk, attack, charge, hurt, faint | C | Same. This is the strongest evidence for the hybrid approach: species-specific *art* with entirely shared systems. |
| `assets/env/<biome>/atlas.png` plus ground, cliff and path textures (35–85 KB each) | C | Per-biome environment atlases over a heightfield. |
| Cries fetched on demand from `cries/<id>.ogg` | C | Same. |
| Creatures as instanced 8-direction billboards; direction row chosen from heading vs camera | C | Same. |
| Moves are generic archetypes chosen by classification, never per-species code | C | Same. |
| How cries and animations are synchronised to gameplay events | I | Cries play on events; attack clips presumably on casts. Not traced in code. |
| Use of SpriteCollab `HitFrame` timing | U | Not established. |

### What the overhaul took from this

- **Kept**: 2D PMD-style sprites as billboards in a 3D world; one packed sheet per species; generic archetypes; per-biome environment atlases.
- **Changed**: a fixed DS-style camera instead of the orbit camera, so sprites and tiles share one pixel density (16 px/m); handcrafted tile arenas instead of a heightfield; 8 gameplay animation states (adds shoot and sleep) with an explicit fallback table; species data, sprites and cries generated from PokéAPI, SpriteCollab and PokeAPI/cries by a build script and shipped in the game, as PokéBonk does.
