# HGSS environment reference sheet

The target is the look of a HeartGold/SoulSilver Johto route, adapted to a free-moving survival arena with PMD Pokémon sprites. This sheet records what was compared, what differs, and the decisions applied in code.

## Sources and how sure we are

| Tag | Source | What it can tell us |
|---|---|---|
| **O-hgss** observed | HGSS graphics extracted in the `pret/pokeheartgold` decompilation: the location preview illustrations (`fielddata/graphic/preview_graphic`, National Park, Ilex Forest, Viridian Forest, Ruins of Alph…) and the route-name signs (`data/gs_areawindow`). The PNGs are tile sheets, so the images are scrambled, but every pixel is a genuine HGSS colour. | Exact palettes (hue/value/saturation of grass, foliage, shadow, path, highlight), sign-frame construction. Used for reference only; nothing is shipped. |
| **O-ours** observed | Our own gameplay frames from `tools/cap.mjs` (seeded, deterministic), at the same internal resolution as play (426 × 240; a DS screen is 256 × 192). | Exactly what the game draws. |
| **R** recalled | Knowledge of how HGSS route fields are built (tree shapes, tall-grass tiles, ledges, water edges, composition). The 3D field textures are not in the decompilation, and screenshot sites were unreachable from this workspace (archives.bulbagarden.net refused), so these points are not pixel-verified. | Shapes, proportions and layout conventions. Treat as assumptions. |

## Palette (O-hgss → decision)

Dominant colours counted in the National Park, Ilex Forest and Viridian Forest previews (HGSS 15-bit colours):

| Role | HGSS colours observed | Hue / sat / light | Our baseline | Decision |
|---|---|---|---|---|
| Light grass | `#83d573` `#8be662` `#9ccd52` `#acde62` | 83–110°, 53–72 %, 56–64 % | `#78dcac` (151°): the meadow base sat at HGSS's *shadow* hue | Base `#8cd060` (96°), tuft `#68b048`, highlight `#b4e884` |
| Mid grass / tall-grass body | `#5ab462` `#4aa452` `#399c29` `#73b439` | 91–125°, 37–58 %, 38–52 % | tall grass `#98f0b8`/`#60d090` (pastel mint, close to the ground value) | Tall grass `#4ea83e` body, `#2f8a34` shade, `#7cc850` tips: clearly darker than the ground |
| Foliage shadow | `#088b41` `#007b41` `#105a4a` `#296a5a` | 138–170°, deep | trees olive `#678038`/`#566a3a` | Shadow masses shift toward teal: `#2e8a46` → `#1c6248`, outline `#173a2e` |
| Foliage highlight | `#c5ffa4` `#ffffac` `#acff62` | pale yellow-green | olive `#a8c850` | `#c4f080` on upper-left lumps only |
| Path | `#d5bd9c` `#cdbd83` `#e6d5b4` `#decdac`; shade `#9c946a` `#94836a` | 34–47°, 35–49 %, 62–80 % | `#f0d898` (brighter, more yellow) with dark double outline | Path `#e0c890`, shade `#c8ac76`, edge `#a88a5a`; loop trail `#cdb07a` (no muddy brown) |
| Sky/water blue | `#4abdff` `#41acff` `#39a4f6` | 201–206° | water `#3283dd` with blotches | Water `#4c94e8`, ripple `#8cc4f8`, crest `#e6f6ff`, no blotches |

Overall: HGSS routes are **warm yellow-green in the light and teal in the shadow**, with saturated but not neon greens and warm beige paths. Our meadow was cool mint throughout.

## Element by element (O-ours vs O-hgss / R)

| Element | What we draw (O-ours) | HGSS (R unless noted) | Decision |
|---|---|---|---|
| **Trees** | Tiered conifers (4 stacked ellipses), olive, placed on a strict 2-tile grid: the border reads as a lattice of pines. | Johto route trees are broad, rounded deciduous crowns built from lumpy clusters, lit upper-left, with a heavy teal shadow under the crown, a short visible trunk, a dark outline; packed in staggered rows so each row's canopies cover the trunks behind. Conifers are for snowy/mountain routes. | New `paintJohtoTree` (32 × 42): 6–7 lumps, highlight lumps upper-left, a shadow band on the lower third, 5 px trunk with root flare. Border rows offset by one tile on alternate rows. Conifers kept for frost only. |
| **Ground** | Random 'v' strokes in 55 % of 8 px cells plus 2 % light speckles: a busy carpet. | One flat base with a sparse, regular tuft motif per tile (R). | Two tufts per 16 px tile at one of three fixed layouts; 40 % of tiles plain. No random speckle. |
| **Path edges** | Smoothed field with 0.34 noise and two dark outline rows → jagged, stair-stepped, grimy. | Smooth rounded edges at tile scale, a thin darker border, grass blades overlapping the edge (R). | Noise 0.06, one 1 px border in `pathEdge`, 2 px blade overhangs along north edges, rounded corners from the bilinear field. |
| **Tall grass** | 18 × 13 pastel tufts, almost the ground colour. | Distinct darker tiles with a crown of pointed blades; patches read as a solid block with a scalloped top (R). | 16 × 14 tuft, four pointed crowns, dark base row, 2-frame rustle; ground under patches tinted to the tall-grass body. |
| **Shrubs** | 3 pastel ellipses. | Small round shrubs with the tree palette (R). | Bush uses the tree ramps; berry variant keeps red berries (a real gameplay platform, not an item). |
| **Rocks / cliffs** | Rock face of vertical plates, red-brown. | Horizontal strata, lighter top edge, darker base (R). | Cliff painter rewritten as horizontal bands with a grass lip on top; ledge face: grass lip + short earth face. |
| **Water** | Saturated blue with 35 % dark blotches; tiny wavelets. | Clean blue with moving light ripple lines; light rim at the shore (R). | Clean base, two ripple rows per tile drifting each frame; sand banks kept as the rim. |
| **Bridge** | Planks run along the direction of travel. | Planks run across the direction of travel, posts on both sides (R). | Plank seams follow the bridge's orientation. |
| **Composition** | One 40-tile open plain around the spawn; clumps scattered randomly. | Routes are corridors between tree walls, with tall-grass rectangles, ledges and a few landmarks (R). | Survival needs space, so the central clearing stays (≈ 20 × 16) but the plains are broken into lanes and rooms by tree lines, hedge rows and tall-grass blocks; every landmark sits on a path. |
| **Scale** | Pokémon 24–40 px, tiles 16 px, trees 32 × 44. | Player ≈ 1 × 2 tiles, trees ≈ 2 × 2.5 tiles (R). | Keep 16 px/m; trees 32 × 42 (2 tiles wide, 2.6 tall). Bosses at whole-number scales only. |

## Route-name sign (O-hgss)

`gs_areawindow` shows nine frame styles: a 2 px dark outline, rounded ends, a light inner panel, and a themed border (wood, tan, cream, stone, leaves with a berry, water, sky, grey). Our region plaque now uses the same construction: dark outline, themed 3 px border per region (leaf green for the meadow, sandstone for the badlands, ice blue for the frost, deep blue stone for the dusk), cream panel.
