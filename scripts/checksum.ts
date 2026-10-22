// Replay checksums: the same seed and bot inputs must give the same state, tick for tick.
// `npx tsx scripts/checksum.ts` prints one hash per configuration; compare before and after a refactor.
import { createRun, step } from '../src/sim/run';
import { botInput } from '../src/sim/bot';
import { MODES } from '../src/mods';
import { StateHasher } from '../src/sim/checksum';
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
// the pre-worldgen `on` hashes exactly; `gen` plays the generated Meadow (region seeds from the run seed).
const SETS: Record<string, object | undefined> = {
  off: { caps: { enabled: false }, build: { enabled: false }, surfaces: { enabled: false } },
  'build-off': { build: { enabled: false }, surfaces: { enabled: false } },
  'world-off': { surfaces: { enabled: false } },
  on: undefined,
  gen: { worldgen: { mode: 'generated' } },
};
for (const caps of which === 'all' ? Object.keys(SETS) : [which]) {
  for (const [species, seed, mode, seconds] of CONFIGS) {
    const ctx = createRun({ seed, species, mode: MODES.find((m) => m.id === mode), ruleOverrides: SETS[caps] as never });
    const marks: string[] = [];
    while (ctx.time < seconds && ctx.state !== 'over' && ctx.state !== 'victory') {
      step(ctx, botInput(ctx));
      if (ctx.tick % 3600 === 0) marks.push(legacyHash(ctx).toString(16));
    }
    console.log(`${caps.padEnd(9)}: ${species} seed ${seed} ${mode} ${seconds}s: ${marks.join(' ')} end=${legacyHash(ctx).toString(16)} lvl=${ctx.player.level} kills=${ctx.stats.kills}`);
  }
}
