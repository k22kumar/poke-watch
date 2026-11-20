# Target stats and growth design (owner-confirmed, 2026-11-19)

These are the owner's confirmed decisions for in-match stats and growth in the hero shooter. They describe the target
design, not today's code. The source is the "Poke Watch Research" project note *In-match stats and growth: confirmed
design*, copied here on 2026-11-19 so that Claude Code sessions can cite it. The full specification, with every item
tagged Decided, Assumed or Playtest, is in that project's artifact. Where this file and older docs disagree, this file
wins. That includes the rest-gated evolution in `docs/CONTROL_SCHEME_TARGET.md`.

## Frame

- One ruleset for PvP, co-op and PvE, up to 6v6, also valid in free-for-all and multi-team modes.
- Power is real and is paid for outside the fight. Mewtwo wins the duel.

## Stats

- **Level-50 Canon Curve**, k = 0.6, no Upkeep: `m = ((base + 20) / 100) ^ k`, health = `250 × ((HP + 75) / 155) ^ k`.
  A base stat of 80 is ×1.0 and 250 health. (`base + 20` is the canonical level-50 stat at IV 31, EV 0.)
- **"No Upkeep"** means no extra cost multiplier on strong Pokémon, such as the rejected BST-keyed stamina cost
  `clamp((BST/500)^0.45, 0.6, 1.5)`. Separately, levels add no stat growth, because levels do nothing but pay Candy
  (see Growth).
- HP is health. Attack and Sp. Atk scale physical and special moves. Defense and Sp. Def divide incoming damage of
  their class. Damage = move power × power ÷ guard, per channel (physical, special).
- Speed sets Burst pip refill and acceleration. Top speed stays in a narrow band (the research's 5.6–6.4 m/s logistic
  band). Speed is not move speed.
- Stats multiply what a move does; the learnset decides which moves a Pokémon can have.
- **Duel value** (offence × durability, Tauros about 1) is the one number read by Stake, Presence and prices.

## Growth

- Everyone starts at base stage. A flat exp bar pays one Candy per fill, about one every 30 s. Levels do nothing else.
- Exp comes from knockouts with assists, objectives and side objectives, wild Pokémon and a small trickle. Death costs
  no Candy.

## Breakthroughs (evolution)

- Hold F any time you can afford it: rooted and invulnerable for about 2 s, status cleared, full heal.
- An evolver's breakthroughs are its evolutions. A non-evolver gets one burst with no stat step (count is a playtest
  dial: 0, 1 or 2).
- Price = a flat part + a part in proportion to duel value gained. The last breakthrough has a minimum price and
  unlocks the Ultimate.
- Pacing: first evolution at 2 to 3 minutes, final form at 7 to 9.

## Rest and the dream shop

- Resting is sleep: slow heal, dark screen, audio and damage cues stay, about 0.75 s to wake.
- Three offers: the next learnset move, a PP Up for an owned move, a stat boost. A reroll costs Candy.

## Kit and gating

- Primary and Ultimate are fixed by species. Q and E are learned from the level-up learnset in canonical order and can
  be replaced. Start with the primary plus the first learnset move.
- Kits are generated from move templates and official move data, with an override table.
- Mixed gating: cooldowns from PP; movement and protect moves also cost a Burst pip; moves with a built-in drawback have
  no cooldown.
- Burst is three pips for everyone. The primary is free, with ammo that refills itself; no reload key.
- The Ultimate charges from damage dealt and taken.

## Paying for power

- **Stake:** a knockout costs your side in proportion to your duel value (tickets, own score in free-for-all, shared
  continues in co-op). In two-team modes it is shown as the enemy's gain. Cap 15% of the pool per death.
- **Presence:** duel value sets how far away you appear on enemy maps and how strongly AI enemies target you.
- Both grow with a capped streak of knockouts and assists since your last death. Evolving raises both.
- Fix order if win rate still follows power: tune Stake and Presence; Upkeep on Burst pips (keyed on duel value); lower
  k (0.6, 0.5, 0.4); then equal power with a separate growth number.

## Fight length

- Time to kill: 1.2 to 2.0 s at perfect aim, 2.5 to 5 s in practice. Duels 4 to 9 s; team fights 15 to 40 s.

## Prototype scope

- About 50 playable forms (roughly 20 to 25 families) from the current roster plus the four test lines (Caterpie,
  Charmander, Tauros, Mewtwo), which are calibrated first with scripted duels.
- One map, 3v3, plus one co-op wave.
- Out: per-species senses, signatures and passive Abilities, Mega, the type chart, and Slaking, Regigigas, Wishiwashi
  and Shedinja.

## Starting values (assumed, to be tuned)

Shop item 2 Candy · reroll 1 · burst flat part 3 · price rate 10 Candy per 1.0 duel value gained · last-breakthrough
minimum 8 · stat boost +10% to one random base stat before the curve, 5 per stat · streak +10% per knockout or assist,
cap +50% · trickle one-third of average income · matches 10 to 15 minutes with respawns.

## Open playtest questions

1. Does stat shape feel different within 30 seconds of play?
2. Is evolve-or-hold a real choice, or does everyone evolve at the same moment?
3. Does win rate still follow duel value after tuning Stake and Presence?
4. Do players rest and spend, or is the blind nap too punishing?
5. Should non-evolvers get zero, one or two bursts?
6. Do generated kits hold up across 50 Pokémon?
7. How much of a fight do players spend with no Burst pips?
