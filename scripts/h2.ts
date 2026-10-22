// H2 (blueprint section 16): rotating purely for cooldowns must add at most 15% damage over staying in.
// `npx tsx scripts/h2.ts [seconds=240] [seeds=10] [overrides-json]` runs three squads with the bot staying in
// ('off') and with the bot cycling Tag whenever its moves are cooling ('rotate'). At 60 s the squad jumps to
// level 15 and the two recruits join with the moves that level gives them, as they would in play; health is topped up so
// both policies fight for the full time. Prints the damage difference per squad.
import { createRun, step } from '../src/sim/run';
import { botInput, setBotTagPolicy, type BotTagPolicy } from '../src/sim/bot';
import { addMember } from '../src/sim/squad';
import { gainXp } from '../src/sim/progression';

const seconds = Number(process.argv[2] ?? 240);
const seeds = Number(process.argv[3] ?? 10);
const ruleOverrides = process.argv[4] ? JSON.parse(process.argv[4]) : undefined;
const JOIN_AT = 60, JOIN_LEVEL = 15;
const SQUADS: [string, string, string][] = [
  ['totodile', 'mareep', 'geodude'],
  ['cyndaquil', 'poliwag', 'heracross'],
  ['bulbasaur', 'vulpix', 'swinub'],
];

function run(squad: [string, string, string], seed: number, policy: BotTagPolicy) {
  setBotTagPolicy(policy);
  const ctx = createRun({ seed, species: squad[0], ruleOverrides });
  let tags = 0, joined = false;
  while (ctx.time < seconds && ctx.state !== 'over' && ctx.state !== 'dead' && ctx.state !== 'victory') {
    if (!joined && ctx.time >= JOIN_AT) {
      // a mid-run squad: level 15 (about where a run is at the 2:00 recruit), the banked picks spent by the bot
      while (ctx.player.level < JOIN_LEVEL) gainXp(ctx, ctx.player.xpNext - ctx.player.xp);
      addMember(ctx, squad[1]); addMember(ctx, squad[2]); joined = true;
    }
    for (const m of ctx.player.squad) { m.hp = m.maxHp; m.fainted = false; }
    for (const e of step(ctx, botInput(ctx))) if (e.t === 'tag') tags++;
  }
  return { dmg: ctx.stats.damageDealt, tags };
}

let worst = -Infinity;
for (const squad of SQUADS) {
  let stay = 0, rot = 0, tags = 0;
  for (let s = 1; s <= seeds; s++) {
    const a = run(squad, s, 'off'), b = run(squad, s, 'rotate');
    stay += a.dmg; rot += b.dmg; tags += b.tags;
  }
  const gain = rot / stay - 1;
  worst = Math.max(worst, gain);
  console.log(`${squad.join(' + ').padEnd(32)} stay ${(stay / seeds).toFixed(0).padStart(8)}  rotate ${(rot / seeds).toFixed(0).padStart(8)}  gain ${(gain * 100).toFixed(1).padStart(6)}%  tags/min ${(tags / seeds / ((seconds - JOIN_AT) / 60)).toFixed(1)}`);
}
console.log(`\nH2 ${worst <= 0.15 ? 'PASS' : 'FAIL'}: largest rotation gain ${(worst * 100).toFixed(1)}% (ceiling 15%)${ruleOverrides ? ' with ' + JSON.stringify(ruleOverrides) : ''}`);
setBotTagPolicy('smart');
