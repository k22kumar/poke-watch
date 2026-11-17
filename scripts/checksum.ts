// Replay checksums: the same seed and bot inputs must give the same state, tick for tick.
// `npx tsx scripts/checksum.ts` prints one hash per configuration; compare before and after a refactor.
import { createRun, step } from '../src/sim/run';
import { botInput } from '../src/sim/bot';
import { MODES } from '../src/mods';
import { StateHasher } from '../src/sim/checksum';
import { CLASSIC_REGIONS } from '../src/rules/spawning';
import { withAim } from './lib/aimbot';
import type { SimContext } from '../src/sim/types';

/** hash built only from fields every version has (ctx.player), so it compares across refactors */
function legacyHash(ctx: SimContext) {
  const h = new StateHasher();
  const P = ctx.player;
  h.num(ctx.tick).num(ctx.stage).num(ctx.stats.kills).num(ctx.stats.damageTaken).num(ctx.stats.xp);
  h.num(P.x).num(P.y).num(P.z).num(P.vx).num(P.vz).num(P.reflex).num(P.level).num(P.xp).num(P.hp).num(P.maxHp);
  for (const s of P.moves) h.num(s.cd).num(s.level);
  const E = ctx.enemies;
  for (let i = 0; i < E.hi; i++) if (E.alive[i]) h.num(i).num(E.x[i]).num(E.z[i]).num(E.hp[i]);
  const B = ctx.bodies;
  for (let i = 0; i < B.hi; i++) if (B.alive[i]) h.num(B.x[i]).num(B.z[i]);
  return h.h;
}

const CONFIGS: [string, number, string, number][] = [
  ['cyndaquil', 2, 'classic', 420],
  ['totodile', 7, 'classic', 420],
  ['bulbasaur', 3, 'survival', 300],
  ['charmander', 11, 'boss-rush', 240],
];

// Phase 8a: `caps off` must print the v10 hashes exactly (the capability layer flagged off changes nothing).
// Phase 8b: `build off` (caps on, the build layer off) must print the Phase 8a `caps on` hashes exactly; `on` is the
// current game. Pass `off`, `build-off` or `on` to print only one set.
const which = process.argv[2] ?? 'all';
// W0/W4: `world-off` (materials off) and `on` (materials apply to generated regions only, by default) must both print
// the pre-worldgen `on` hashes exactly; `gen` plays the default generated regions (Viridian Forest and Mt. Moon
// from Pokémon locations, the classic generator elsewhere); `gen-classic` turns locations off.
// Hazards (liquid exposure and falls, docs/HAZARDS.md): `hazards-off` must print the `on` hashes from before that layer;
// every older set turns it off too.
// Size classes and the 2026-11 roster wave (docs/SIZING.md, docs/SPAWNING.md): `size-off` (sim bodies from sprite height,
// one shared partner radius, the classic region tables) prints the `on` hashes from before both, apart from the World.shore
// fix that landed with them (a bank behind a wall is no longer preferred); every older set turns both off too.
// `roster-off` keeps size-class bodies and only selects the classic tables. `gen-size-off` is `size-off` on `gen`.
// Spatial aim (Phase 2B): `aim` covers it (the bot plus a crosshair ray); `aim-off` must print the `on` hashes exactly.
// Spatial beams and the foliage cover rule (Phase 2C): `aim` covers them too; `aim-2b` (beams planar, foliage as cover)
// must print the Phase 2B `aim` hashes exactly.
// Headroom (R1, docs/SIZING.md "Headroom"): bodies meet deck slabs. Only maps with decks change (`gen`); `gen-headroom-off`
// must print the `gen` hashes from before it, and every older set turns it off too.
// Pole-safe aim maths (R2, docs/THIRD_PERSON_IMPLEMENTATION.md §18): only `aim` reaches it (multi-shot fans at a pitch);
// `aim-pole-off` must print the `aim` hashes from before it, and `aim-2b` turns it off too.
const HEADROOM_OFF = { headroom: false };
const CLASSIC = { spawning: { regions: CLASSIC_REGIONS }, size: HEADROOM_OFF };
const SIZE_OFF = { ...CLASSIC, size: { geometry: false, ...HEADROOM_OFF } };
const SETS: Record<string, object | undefined> = {
  off: { caps: { enabled: false }, build: { enabled: false }, surfaces: { enabled: false }, hazards: { enabled: false }, ...SIZE_OFF },
  'build-off': { build: { enabled: false }, surfaces: { enabled: false }, hazards: { enabled: false }, ...SIZE_OFF },
  'world-off': { surfaces: { enabled: false }, hazards: { enabled: false }, ...SIZE_OFF },
  'hazards-off': { hazards: { enabled: false }, ...SIZE_OFF },
  'size-off': SIZE_OFF,
  'roster-off': CLASSIC,
  on: undefined,
  gen: { worldgen: { mode: 'generated' } },
  // the classic generator everywhere (Pokémon locations off): must print the pre-location `gen` hashes exactly
  'gen-classic': { worldgen: { mode: 'generated', locations: { meadow: '', dusk: '', badlands: '', frost: '' } }, size: HEADROOM_OFF },
  'gen-size-off': { worldgen: { mode: 'generated' }, ...SIZE_OFF },
  // R1: `gen` with bodies' heads passing through deck slabs again
  'gen-headroom-off': { worldgen: { mode: 'generated' }, size: HEADROOM_OFF },
  // Phase 2B (docs/THIRD_PERSON_IMPLEMENTATION.md §13): the bot never aims, so no set above reaches the spatial aim. `aim`
  // replays the `on` bot with a chase-style crosshair ray added to each input (withAim below): the direct shots then take
  // the spatial path. `aim-off` sends the same rays with rules.aim.spatial off and must print the `on` hashes exactly
  aim: undefined,
  'aim-off': { aim: { spatial: false } },
  // Phase 2C (§14): beams back on the planar path and foliage back to cover: the Phase 2B `aim` hashes exactly
  'aim-2b': { aim: { archetypes: ['bolt', 'orb'], foliageCover: true, poleSafe: false }, size: HEADROOM_OFF },
  // R2 (§18): `aim` with the pre-R2 muzzle and fan maths
  'aim-pole-off': { aim: { poleSafe: false } },
};
const AIMED = new Set(['aim', 'aim-off', 'aim-2b', 'aim-pole-off']);

for (const caps of which === 'all' ? Object.keys(SETS) : [which]) {
  for (const [species, seed, mode, seconds] of CONFIGS) {
    const ctx = createRun({ seed, species, mode: MODES.find((m) => m.id === mode), ruleOverrides: SETS[caps] as never });
    const marks: string[] = [];
    while (ctx.time < seconds && ctx.state !== 'over' && ctx.state !== 'victory') {
      step(ctx, AIMED.has(caps) ? withAim(ctx, botInput(ctx)) : botInput(ctx));
      if (ctx.tick % 3600 === 0) marks.push(legacyHash(ctx).toString(16));
    }
    console.log(`${caps.padEnd(9)}: ${species} seed ${seed} ${mode} ${seconds}s: ${marks.join(' ')} end=${legacyHash(ctx).toString(16)} lvl=${ctx.player.level} kills=${ctx.stats.kills}`);
  }
}
