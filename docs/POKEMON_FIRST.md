# Pokémon-first design

Poke-Watch starts with the creature, not its type or a combat class. A Pokémon's body, instincts, ecology, and canon are the brief; the action game is the translation. The goal is not to simulate every Pokédex sentence or reproduce a traditional RPG move list. It is to make the player recognize the Pokémon through what it does, while keeping the action legible, responsive, fair, and affordable to simulate.

This is the content-design method. The canonical facts and the current implementation are tracked separately in [Species identity](./SPECIES.md), [Systemic combat](./SYSTEMIC.md), and [Roles and encounters](./ENCOUNTERS.md).

## Evidence before mechanics

Build a short evidence sheet for each Pokémon before proposing its kit. Prefer sources in this order:

1. **Official Pokédex descriptions** from Pokémon / Nintendo across the main series and official spin-offs for body, temperament, behavior, habitat, and ecology. Use multiple entries when they add useful context; note differences rather than treating one description as a complete biography.
2. **The roster's canonical game data** for species, types, height, weight, abilities, moves, and evolution. Poke-Watch merges level-up learnsets across official main-series game versions; `canon` keeps those facts separate from game tuning.
3. **Other official Pokémon material** when the games are silent, clearly identifying the source and continuity. Treat anime, manga, and promotional appearances as additional inspiration, not interchangeable game canon.
4. **Structured community mirrors** such as PokéAPI as indexes and cross-checks, not as the authority for interpretation. Verify consequential claims against official material when available.

For each claim, record the source, game/version where relevant, and confidence (directly stated, repeated implication, or interpretation). Separate the observed fact from the design inference. Do not turn a single flavor-text line into a universal behavior or invent a biological fact to justify a mechanic.

## The species-to-action worksheet

Use this once per species, including enemies and support Pokémon. Keep it concise; `not a distinct hook` is a valid answer when that dimension does not suggest a good mechanic.

| Lens | Questions to answer |
| --- | --- |
| **Body and scale** | What are its anatomy, locomotion, silhouette, size, weight, reach, and physical limitations? What must animation, hitbox, movement, or collision communicate? |
| **Temperament and behavior** | Is it playful, territorial, cautious, social, solitary, persistent, evasive, or protective? How does it approach, attack, defend, hunt, flee, or help? |
| **Habitat and ecology** | Where does it live, what conditions does it exploit or avoid, and what does it do in that environment? Could terrain, weather, water, vegetation, cover, or another creature matter? |
| **Type and natural properties** | What elemental effects are actually supported by canon? What strengths, vulnerabilities, or interactions are useful in this game, without reducing the species to a type label? |
| **Moves and abilities** | Which real moves, abilities, or characteristic actions best express its identity? What must be adapted, combined, omitted, or made readable in real time? |
| **Evolution** | What changes in its body, behavior, role, or capabilities across the line? How can evolution add or transform an identity beat, not just raise numbers? |
| **Action-game expression** | What is its distinctive verb or decision loop? Consider movement, attack, defense, escape, support, squad play, and environmental interaction—not just damage shape. |
| **Counterplay and implementation** | What cue tells the player what is happening? What timely response can they choose? Can the mechanic use existing systems, remain deterministic, and fit the simulation and rendering budgets? |

Finish the worksheet with:

- **Identity sentence:** “This Pokémon feels like itself when it ___.”
- **Signature behavior:** at least one characteristic action or decision that remains recognizable without relying on its type color or character model. It may be AI, movement, defense, support, or environment use; it need not be a bespoke subsystem.
- **Player read:** the cue, threat, and useful response.
- **System fit:** existing rules/art/input surfaces reused, plus any measured cost or explicit reason a new primitive is worth it.
- **Omissions:** tempting traits deliberately left out, and why (unsupported by evidence, redundant, unreadable, unbalanced, or too expensive).

## Translation rules

1. **Start from a behavior, then choose a game verb.** Translate “rolls downhill” into a rolling approach, “shares food” into a support decision, or “hides as a rock” into an ambush cue. Do not start with “Rock type = rock projectile.”
2. **Express identity through a small number of strong beats.** One memorable movement/decision plus one supporting detail is better than a pile of weak passives. Reuse the shared combat, coat, body, surface, squad, and encounter systems where they fit.
3. **Treat type as a property, not a class.** Type can shape damage, elemental interactions, and visual language, but two Pokémon of the same type should still have different behaviors, pacing, silhouettes, or decisions.
4. **Let body data matter where it earns its cost.** Height, weight, wings, jaws, limbs, shell, reach, and mass can inform movement, guard, shove, attack range, and collision. Canon measurements are inputs, not a demand for literal real-world physics.
5. **Make ecology an opportunity, not a required gimmick.** A habitat matters when it creates a meaningful choice—such as an Electric action interacting with already-wet ground. Do not add a special terrain system merely because a Pokédex entry mentions a habitat.
6. **Adapt moves to the action loop.** Keep a move's recognizable intent and species context; change duration, area, targeting, and effect as needed for responsive real-time play. RPG power, turn order, accuracy, PP, and stat stages are not requirements.
7. **Use abilities and evolution selectively.** Implement an ability when its actual effect maps cleanly to an existing rule and has a visible trigger or decision. Evolution should visibly grow or redirect a behavior; it need not add complexity at every stage.
8. **Design counterplay with the threat.** Attacks need a readable wind-up, active shape, and recovery or other reliable response. Avoid unavoidable chains, ambiguous overlapping cues, and effects that make the optimal action unclear.
9. **Respect the simulation.** Prefer data-driven parameters and shared capabilities over per-species code paths. New simulation behavior must be deterministic, bounded, testable, and profiled at encounter scale. Visual identity must survive the game's camera, pixel density, and crowded screen.
10. **Do not force false uniqueness.** If research yields no sound gameplay hook, keep the Pokémon's identity in its animation, timing, formation, habitat placement, or encounter role. Record the gap; do not invent lore or attach an arbitrary elemental shot.

## Examples of the reasoning

These are design prompts, not locked implementations:

| Pokémon | Evidence-led identity | Action translation to explore | Read and answer |
| --- | --- | --- | --- |
| **Geodude** | Compact rocky body, arms, substantial mass, and a rolling association with rocky slopes; not simply “a Ground type.” Compare official entries and the [species record](https://pokeapi.co/api/v2/pokemon-species/geodude). | A committed rolling approach that changes direction or bounces off a heavy obstacle; its mass could move loose bodies or resist a light shove. A tunnel mechanic is only justified if the arena and navigation can support it. | Show the roll direction and impact window; sidestep, interrupt, or use terrain/body interactions. Avoid making it an ordinary ranged rock shooter. |
| **Mareep** | Wool and stored static electricity are the identity, with Electric typing as one expression of it. Compare official entries and the [species record](https://pokeapi.co/api/v2/pokemon-species/mareep). | Telegraph a charge in its fleece, then let the discharge interact with existing Wet/Charge surface rules or nearby targets. The wool can also carry a clear overcharge/decay visual. | The charged silhouette and target path are visible before discharge; leave the wet/conductive area or interrupt it. Avoid an untelegraphed chain across the screen. |
| **Totodile** | A small, energetic body with notably powerful jaws; its bite is a more species-specific starting point than a generic Water projectile. Compare official entries and the [species record](https://pokeapi.co/api/v2/pokemon-species/totodile). | A quick, short-range bite or snap-lunge with a deliberate approach window; later forms can grow its reach or follow-through while preserving the close-range identity. | Show the lunge line and recovery; bait it, evade laterally, or punish the recovery. Keep the move responsive and do not make the small form feel like a slow tank. |

The examples deliberately separate canon evidence, design inference, and tuning. Before shipping any of them, verify the relevant entries and move data, check that the hook fits existing code, then test it in crowded play.

## Review gate for new content

Before content is accepted, ask:

- Can a player describe what makes this Pokémon play differently from another with the same type or role?
- Is that difference supported by an identified source or unmistakable anatomy/behavior, rather than a stereotype?
- Does the game communicate the behavior before it can punish the player, and is there a useful response?
- Does the mechanic fit the Pokémon at its actual scale and stage of evolution?
- Does it work with existing targeting, collision, surfaces, squad, determinism, and accessibility/readability rules?
- Are tests covering its rule and edge cases, and has performance been measured under the relevant enemy/body count?
- If the hook is removed, does the species lose a recognizable behavior—or only a generic damage effect?

If a proposal fails, revise the action hook or express the identity in animation, movement, composition, or habitat instead. Do not ship lore as an encyclopedia tooltip while leaving every Pokémon to play the same.
