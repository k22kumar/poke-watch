# Target control scheme (owner decisions, 2026-11-16)

These are the owner's decisions for the hero-shooter controls. They describe the target design, not today's bindings, which
are in `docs/CONTROLS.md`. The source is the "Poke Watch Research" project note *Control scheme decisions*, copied here
on 2026-11-19 so that Claude Code sessions can cite it. The full reasoning, sources and stress tests are in that
project's artifact. When this file and `docs/CONTROLS.md` disagree, `docs/CONTROLS.md` says what ships today and this
file says where it is going.

> **Superseded in part (2026-11-19).** The confirmed stats and growth design (`docs/STATS_GROWTH_TARGET.md`) changes
> two things here: evolution is no longer rest-gated; it is a **Breakthrough**, triggered by holding F (Touch) at any
> time you can afford it. Rest (Down) now opens the **dream shop**. Where this file says otherwise, that file wins.

## Layout (keyboard and mouse)

Ten buttons beyond WASD and mouse-look. Each has one universal meaning. A species changes numbers and animation, never
the meaning.

| Input | Meaning | Notes |
| --- | --- | --- |
| Space | Up | Jump, mantle, species air move, ascend in water or flight |
| Left Ctrl | Down | Crouch, slide after a dash, dive, descend; still and passive for about 1.5 s = rest |
| Left Shift | Burst | Dash on shared stamina; a dash that hits something is a Tackle |
| Left click | Attack | Primary move; throw when carrying |
| Right click (hold) | Focus | Modifies the primary: Aim, Charge, Guard or Alternate pattern; channels your type into a carried object |
| Q, E | Ability 1, Ability 2 | Press to use, same key cancels, never hold-to-channel |
| R | Ultimate | Drops a carried object first |
| F | Touch | Pick up, drop, talk; **hold** to Breakthrough (evolve) when you can afford it (superseded the rest-gated trigger) |
| Middle click | Point | Ping; with NPC followers the same ping is a command |

Optional: Mouse 4 as a second Touch binding, Mouse 5 as a second Point binding, V reserved for a standing Tackle.

## Decisions

- **Removed:** reload, dedicated melee key, universal block and parry, Shift as a modifier, double-tap dash.
- **Combined:**
  - crouch, slide, dive, descend and rest into Down;
  - grab, hold, throw and use into carrying;
  - pickup, talk and evolve-confirm into Touch;
  - ping and NPC command into Point.
- **Pokémon-specific:** block, parry and reflect moves; flight, glide, burrow and wall-climb.
- **Deferred:** grabbing enemy players, ping and command wheels, sprint on held Shift, wall-running.
- **Rules that generate emergent play:**
  - conserved momentum with mass-scaled impact;
  - an element-on-material table;
  - carried objects keep their state.

## Confidence

- **Well supported:**
  - no modifier chords;
  - hold-only Focus;
  - holds only as held states or extensions;
  - full remapping with toggles;
  - a shared three-verb movement kit.
- **Needs a prototype:**
  - dash-Tackle replacing melee;
  - ~~evolution gated behind rest~~ (superseded: evolution is a hold-F Breakthrough; rest opens the dream shop);
  - the four Focus archetypes;
  - Ultimate on R instead of Q;
  - third-person camera at steep vertical aim.

## Build order

1. Core eight buttons: Space, Ctrl, Shift, left click, right click, Q, E, R.
2. Touch and carrying, with four materials and four elements.
3. Point for teammates.
4. Rest (dream shop), then evolution as a hold-F Breakthrough.
5. NPC Pokémon: talk on Touch, command on Point.
6. Only then consider the V Tackle, ping wheels and grabbing players.
