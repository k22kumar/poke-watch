// W3 gates for generated regions (procedural world blueprint, "Vertical slice and the tests that decide"):
//   not worse     — bot survival in Classic, 6 partners × 4 seeds × 300 s, authored vs generated Meadow (within 10 %)
//   different play — 20 region seeds × 3 run seeds (map held fixed with worldgen.regionSeed): between-map variance of
//                    damage taken and clear time against same-map noise (one-way ANOVA F-ratio, threshold 2)
// `npx tsx scripts/worldsurvival.ts [survival|variety|all]`
import { createRun, step } from '../src/sim/run';
import { botInput } from '../src/sim/bot';

const which = process.argv[2] ?? 'all';
const PARTNERS = ['bulbasaur', 'charmander', 'squirtle', 'chikorita', 'cyndaquil', 'totodile'];

function play(species: string, seed: number, seconds: number, over: object) {
  const ctx = createRun({ seed, species, ruleOverrides: over as never });
  while (ctx.time < seconds && ctx.state !== 'over' && ctx.state !== 'victory' && ctx.stage === 0) step(ctx, botInput(ctx));
  return { t: ctx.time, survived: ctx.time >= seconds - 0.01 && ctx.state !== 'over', dmg: ctx.stats.damageTaken, kills: ctx.stats.kills, lost: ctx.world.propField?.lost ?? 0 };
}

if (which === 'survival' || which === 'all') {
  for (const [label, over] of [['authored', { worldgen: { mode: 'authored' } }], ['generated', { worldgen: { mode: 'generated' } }]] as const) {
    let n = 0, ok = 0, t = 0, dmg = 0, kills = 0, lost = 0;
    const per: string[] = [];
    for (const sp of PARTNERS) {
      let pOk = 0;
      for (const seed of [1, 2, 3, 4]) {
        const r = play(sp, seed, 300, over);
        n++; t += r.t; dmg += r.dmg; kills += r.kills; lost += r.lost;
        if (r.survived) { ok++; pOk++; }
      }
      per.push(`${sp} ${pOk}/4`);
    }
    console.log(`${label.padEnd(9)}: ${ok}/${n} reach 300 s, mean ${(t / n).toFixed(0)} s, ${(kills / n).toFixed(0)} KOs, ${(dmg / n).toFixed(0)} damage taken, ${(lost / n).toFixed(0)} cover lost | ${per.join(', ')}`);
  }
}

if (which === 'variety' || which === 'all') {
  // one-way ANOVA over groups (one per region seed, three runs each)
  const anova = (groups: number[][]) => {
    const all = groups.flat(), N = all.length, k = groups.length, mean = all.reduce((a, b) => a + b, 0) / N;
    let ssb = 0, ssw = 0;
    for (const g of groups) { const m = g.reduce((a, b) => a + b, 0) / g.length; ssb += g.length * (m - mean) ** 2; for (const v of g) ssw += (v - m) ** 2; }
    return (ssb / (k - 1)) / (ssw / (N - k) || 1e-9);
  };
  const dmgG: number[][] = [], timeG: number[][] = [], killG: number[][] = [];
  for (let map = 1; map <= 20; map++) {
    const d: number[] = [], tt: number[] = [], kk: number[] = [];
    for (const run of [11, 22, 33]) {
      const r = play('totodile', run, 180, { worldgen: { mode: 'generated', regionSeed: map } });
      d.push(r.dmg / Math.max(1, r.t / 60)); tt.push(r.t); kk.push(r.kills / Math.max(1, r.t / 60));
    }
    dmgG.push(d); timeG.push(tt); killG.push(kk);
  }
  console.log(`variety (20 maps × 3 runs, Totodile, 180 s): F damage/min ${anova(dmgG).toFixed(2)}, F survival time ${anova(timeG).toFixed(2)}, F KOs/min ${anova(killG).toFixed(2)} (threshold 2)`);
}
