// Headless balance runner: `npm run sim -- --species charmander --seconds 600 --seed 1 --mode classic`
import { createRun, step } from '../src/sim/run';
import { botInput } from '../src/sim/bot';
import { MODES } from '../src/mods';

const args = Object.fromEntries(
  process.argv.slice(2).reduce<[string, string][]>((acc, a, i, arr) => (a.startsWith('--') ? [...acc, [a.slice(2), arr[i + 1]]] : acc), []),
);
const species = args.species ?? 'charmander';
const seconds = Number(args.seconds ?? 600);
const seed = Number(args.seed ?? 1);
const mode = MODES.find((m) => m.id === (args.mode ?? 'classic'));

const ctx = createRun({ seed, species, mode });
const t0 = performance.now();
let lastReport = 0;
let maxEnemies = 0;
const log: string[] = [];
while (ctx.time < seconds && ctx.state !== 'over' && ctx.state !== 'victory') {
  const ev = step(ctx, botInput(ctx));
  maxEnemies = Math.max(maxEnemies, ctx.enemies.count);
  for (const e of ev) {
    if (e.t === 'evolveEnd') log.push(`${ctx.time.toFixed(0)}s evolved -> ${e.species}`);
    if (e.t === 'bossSpawn') log.push(`${ctx.time.toFixed(0)}s boss ${e.species} (hp ${ctx.enemies.maxHp[e.enemy].toFixed(0)})`);
    if (e.t === 'bossDead') log.push(`${ctx.time.toFixed(0)}s boss down`);
    if (e.t === 'stageStart') log.push(`${ctx.time.toFixed(0)}s stage ${e.stage + 1} ${e.biome}`);
    if (e.t === 'learn') log.push(`${ctx.time.toFixed(0)}s learned ${e.key}`);
  }
  if (ctx.time - lastReport >= 60) {
    lastReport = ctx.time;
    const P = ctx.player;
    console.log(
      `t=${ctx.time.toFixed(0).padStart(4)}s st=${ctx.stage + 1} lvl=${P.level} hp=${P.hp.toFixed(0)}/${P.maxHp.toFixed(0)} kills=${ctx.stats.kills} live=${ctx.enemies.count} moves=${P.moves.map((m) => m.key + ':' + m.level).join(',')}`,
    );
  }
}
const ms = performance.now() - t0;
console.log(log.join('\n'));
console.log(`\nend state=${ctx.state} time=${ctx.time.toFixed(1)}s level=${ctx.player.level} kills=${ctx.stats.kills} dmgTaken=${ctx.stats.damageTaken.toFixed(0)} maxLive=${maxEnemies}`);
console.log(`sim speed: ${((ctx.tick / ms) * 1000).toFixed(0)} ticks/s (${(((ctx.tick / ms) * 1000) / 60).toFixed(1)}x realtime)`);
