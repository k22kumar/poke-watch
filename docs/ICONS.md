# Icons and item presentation

Poke-Watch shows Pokémon items only where the item's real effect matches what the game does with it. Survival-only ideas (cooldowns, area, pickup radius, EXP) get original pixel icons with plain names, so no icon suggests a mechanic the game doesn't have.

Imported graphics come from PokeAPI/sprites (CC0 repository; its LICENCE says all image contents are © The Pokémon Company) and are embedded by `npm run content` from `content/icons.json` into `src/content/icons.json`. Original glyphs are drawn in code in `src/ui/pixicons.ts` and `src/render/pixelart.ts`, on the same pixel grid and outline rules as the imported icons.

## Inventory

### Level-up cards (`src/ui/items.ts`)

| Card | Shown as | Graphic | Origin | Why it fits |
|---|---|---|---|---|
| Max HP up | HP Up | `hp-up` bag icon | Imported (DS-era) | HP Up raises HP |
| Attack up | Protein | `protein` | Imported | Protein raises Attack |
| Sp. Attack up | Calcium | `calcium` | Imported | Calcium raises Sp. Atk |
| Defense up | Iron | `iron` | Imported | Iron raises Defense |
| Speed up | Carbos | `carbos` | Imported | Carbos raises Speed |
| Crit chance up | Scope Lens | `scope-lens` | Imported | Scope Lens raises the critical-hit ratio |
| Cooldowns faster | Cooldown Charm | hourglass glyph | Original | No Pokémon item shortens move cooldowns |
| Area up | Area Charm | ring glyph | Original | No item enlarges attacks |
| Pickup radius up | Pickup Charm | magnet glyph | Original | The Magnet item boosts Electric moves, so it would mislead |
| Heal | Sitrus Berry | `sitrus-berry` | Imported | Restores HP (the card heals 35 % at common rarity) |
| New move | TM (in the move's type colour) | `tm-<type>` | Imported | A TM teaches a move. The card also shows the HGSS type badge and category icon |
| Move power-up | Move power-up | arrow glyph | Original | PP Up raises PP, which doesn't exist here, so it isn't used |

Each card lists concrete numbers (for example `Speed +7% → +14%`, or `Damage 12 → 15, Cooldown 0.90 s → 0.81 s`) and, for imported items, one line saying what the item does in HGSS, so the difference between the game and the original is explicit.

### Field pickups (in the 3D scene)

| Pickup | Shown as | Graphic | Origin |
|---|---|---|---|
| EXP gem | EXP Shard | blue shard sprite | Original |
| Heal drop | Oran Berry | blue berry sprite drawn after the HGSS berry | Original drawing of a Pokémon item (restores HP, as in HGSS) |
| Chest | Item ball | Poké Ball sprite in the field | Original drawing; the HUD uses the imported `poke-ball` icon |
| Lure | Lure | pink lure glyph | Original |

### Types and categories

| Graphic | Origin |
|---|---|
| Type badges for the 17 Gen IV types (48 × 16) | Imported: HGSS type badges (`generation-iv/heartgold-soulsilver`) |
| Fairy type badge | Original, in the same badge style (Fairy didn't exist in Gen IV) |
| Physical, Special and Status category icons (20 × 14) | Original, after the Gen IV split icons' colours (orange, blue, grey) |

### HUD

| Element | Origin |
|---|---|
| Move slots: an attack-shape glyph for each of the 20 shapes (strike, dash, bolt, beam, nova, cone, …) plus the dash slot | Original |
| Status chips: PAR, ability active (e.g. "Blaze!"), Boost, "Fire weather" | Text chips in the box style; no icon, so no false item reference |
| Info box, boss box, HP and EXP bars, region sign | Original CSS, after the HGSS info box and area sign (`docs/HGSS_REFERENCE.md`) |
| Key caps in the control hints | Original CSS |
| Font | Pixelify Sans (SIL OFL 1.1), embedded as a WOFF subset; licence in `content/fonts/OFL.txt` |

## Rules for adding icons

1. Use a Pokémon item only if its HGSS effect is the same kind of effect the card or pickup has. Say what the item does in HGSS on the card.
2. Otherwise draw an original glyph at 16 × 16 with a 1 px dark outline and top-left light, and give it a plain descriptive name.
3. Add imported icons to `content/icons.json` and rebuild content; don't paste data URLs into source files.
