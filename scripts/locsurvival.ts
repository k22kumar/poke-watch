// Bot playtest of location maps against the authored Meadow and the classic generator:
// `npx tsx scripts/locsurvival.ts [runs] [seconds]`. The bot does not aim, guard or use terrain, so these numbers
// say whether the maps work for the director and navigation (enemies arrive, nobody is stranded), not how good the
// spaces are for a person. Per configuration: survival, KOs/min, damage taken/min, share of ground enemies with no
// path to the player, share of time the player spends above the lowest floor, and how many spawns used anchors.
import { createRun, step } from '../src/sim/run';
import { botInput } from '../src/sim/bot';

const RUNS = Number(process.argv[2] ?? 8), SECS = Number(process.argv[3] ?? 180);
const CONFIGS: [string, object][] = [
  ['authored meadow', { worldgen: { mode: 'authored' } }],
  ['classic generated', { worldgen: { mode: 'generated', locations: { meadow: '' } } }],
  ['viridian-forest', { worldgen: { mode: 'generated', locations: { meadow: 'viridian-forest' } } }],
  ['mt-moon', { worldgen: { mode: 'generated', locations: { meadow: 'mt-moon' } } }],
  ['chargestone-cave', { worldgen: { mode: 'generated', locations: { meadow: 'chargestone-cave' } } }],
];
for (const [label, over] of CONFIGS) {
  let surv = 0, reached = 0, kills = 0, taken = 0, stuck = 0, ground = 0, raised = 0, samples = 0;
  for (let r = 0; r < RUNS; r++) {
    for (const species of ['totodile', 'cyndaquil']) {
      const ctx = createRun({ seed: 100 + r, species, ruleOverrides: over as never });
      const low = ctx.world.map.gen?.loc ? Math.min(...ctx.world.map.gen.loc.zones.map((z) => z.tier)) : 0;
      while (ctx.time < SECS && ctx.state !== 'over') {
        step(ctx, botInput(ctx));
        if (ctx.tick % 60) continue;
        const E = ctx.enemies, W = ctx.world, P = ctx.player;
        samples++;
        if (ctx.world.map.gen?.loc && P.y > low * 3 + 2) raised++;
        for (let i = 0; i < E.hi; i++) if (E.alive[i] && E.hover[i] === 0) { ground++; if (W.flowDist(E.x[i], E.z[i], E.y[i]) === Infinity) stuck++; }
      }
      surv += ctx.time; if (ctx.time >= SECS) reached++;
      kills += ctx.stats.kills; taken += ctx.stats.damageTaken;
    }
  }
  const n = RUNS * 2, mins = surv / 60;
  console.log(`${label.padEnd(18)} survive ${reached}/${n} (mean ${(surv / n).toFixed(0)} s)  KOs/min ${(kills / mins).toFixed(1)}  dmg/min ${(taken / mins).toFixed(0)}  no-path ${(100 * stuck / Math.max(1, ground)).toFixed(1)}%  raised time ${(100 * raised / Math.max(1, samples)).toFixed(0)}%`);
}
