// H5/H6 proxies (blueprint section 16) with the bot: Classic runs with objectives engaged and ignored.
// `npx tsx scripts/h6.ts [seeds=4] [seconds=900]` prints, per policy: objectives opened, engaged, completed,
// recruits, how far runs got, and whether the run cleared Classic. A human playtest is the real test;
// this checks the plumbing and that ignoring every objective is still survivable.
import { createRun, step } from '../src/sim/run';
import { botInput, setBotObjectives } from '../src/sim/bot';

const seeds = Number(process.argv[2] ?? 4), seconds = Number(process.argv[3] ?? 900);
const PARTNERS = ['bulbasaur', 'charmander', 'squirtle', 'chikorita', 'cyndaquil', 'totodile'];
for (const engage of [true, false]) {
  setBotObjectives(engage);
  let opened = 0, engaged = 0, done = 0, recruits = 0, cleared = 0, stages = 0, runs = 0, time = 0;
  const kinds: Record<string, [number, number]> = {};
  for (const sp of PARTNERS) for (let s = 1; s <= seeds; s++) {
    const ctx = createRun({ seed: s, species: sp });
    while (ctx.time < seconds && ctx.state !== 'over' && ctx.state !== 'victory') {
      for (const e of step(ctx, botInput(ctx))) {
        if (e.t === 'objective') {
          kinds[e.kind] ??= [0, 0];
          if (e.phase === 'offer') { opened++; kinds[e.kind][0]++; }
          if (e.phase === 'active') engaged++;
          if (e.phase === 'done') { done++; kinds[e.kind][1]++; }
        }
        if (e.t === 'recruit') recruits++;
      }
    }
    runs++; time += ctx.time; stages += ctx.stage + ctx.loop * 4; if (ctx.state === 'victory' || ctx.stage >= 2) cleared++;
  }
  console.log(`${engage ? 'engage' : 'ignore'}: runs ${runs}, objectives opened ${opened}, engaged ${engaged} (${((engaged / Math.max(1, opened)) * 100).toFixed(0)}%), completed ${done}, recruits ${recruits / runs} per run, ` +
    `mean time ${(time / runs).toFixed(0)} s, mean regions cleared ${(stages / runs).toFixed(2)}, reached region 3 ${cleared}/${runs}`);
  console.log('  by kind (opened/completed): ' + Object.entries(kinds).map(([k, [o, d]]) => `${k} ${o}/${d}`).join(', '));
}
setBotObjectives(true);
