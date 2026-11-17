// Primary-fire timing at tick level (docs/THIRD_PERSON_IMPLEMENTATION.md §15): for one representative species of
// every basic-attack family, the real sim (createRun + step) measures
//   ready press  ticks from a one-tick press (btn + press edge) on a ready slot to the accept (wind-up start) and to the
//                release (the cast)
//   hold         the cadence of a held button: casts in 10 s, ticks between accepts, against the move's cooldown
//   pre-ready    one tap k ticks before the slot is ready: whether it casts, and the ticks from the press to the accept
//   tap streams  tapping at 3, 5 and 8 Hz for 10 s (one tick down each): casts and damage per second against holding
// Usage: npx tsx scripts/firetiming.ts [legacy] [species...]   (`legacy` = rules.combat.fireBuffer 0 on every slot)
import { createRun, step } from '../src/sim/run';
import { spawnEnemy } from '../src/sim/enemies';
import { slotSpec } from '../src/sim/moves';
import { BTN, NO_INPUT, type InputFrame, type SimContext } from '../src/sim/types';

const FAMILIES: [string, string][] = [
  ['bolt', 'cyndaquil'], ['orb', 'squirtle'], ['strike', 'bulbasaur'], ['dash', 'impidimp'], ['nova', 'magcargo'],
  ['chain', 'pichu'], ['lob', 'slugma'], ['cone', 'snom'], ['boomerang', 'chikorita'], ['barrage', 'heracross'], ['drain', 'oddish'],
];
const args = process.argv.slice(2);
const legacy = args.includes('legacy');
const only = args.filter((a) => a !== 'legacy');

function calm(species: string): { ctx: SimContext; aim: Partial<InputFrame> } {
  const ctx = createRun({ seed: 3, species, ruleOverrides: { director: { spawnBase: -99, spawnPerMin: 0, spawnPerStage: 0 }, ...(legacy ? { combat: { fireBuffer: [0, 0, 0, 0] } } : {}) } as never });
  for (let i = 0; i < 30; i++) step(ctx, NO_INPUT);
  const P = ctx.player;
  const [ex, ez] = ctx.world.nearestWalkable(P.x + 5, P.z);
  const e = spawnEnemy(ctx, 'rattata', ex, ez);
  ctx.enemies.hp[e] = ctx.enemies.maxHp[e] = 1e9; ctx.enemies.speed[e] = 0;
  for (let i = 0; i < 20; i++) step(ctx, NO_INPUT);
  return { ctx, aim: { aimX: ex, aimZ: ez } };
}

/** run `n` ticks; `down(t)` says whether the basic button is held on tick t and `edge(t)` whether it went down then.
 *  Returns the ticks of every accept (wind-up start, or the cast of a move with no wind-up) and every release (cast) */
function drive(ctx: SimContext, aim: Partial<InputFrame>, n: number, down: (t: number) => boolean, edge: (t: number) => boolean) {
  const key = ctx.player.moves[0].key, w = ctx.rules.feel.windup[slotSpec(ctx, 0).archetype] ?? 0;
  const acc: number[] = [], rel: number[] = [];
  const d0 = ctx.stats.damageDealt;
  for (let t = 0; t < n; t++) {
    const inp: InputFrame = { ...NO_INPUT, ...aim, btn: down(t) || edge(t) ? BTN.basic : 0, press: edge(t) ? BTN.basic : 0 };
    for (const ev of step(ctx, inp)) {
      if (ev.t === 'windup' && ev.slot === 0) acc.push(t);
      if (ev.t === 'cast' && ev.key === key) { rel.push(t); if (w <= 0) acc.push(t); }
    }
  }
  return { acc, rel, dmg: ctx.stats.damageDealt - d0 };
}

const pad = (s: string | number, n: number) => String(s).padStart(n);
console.log(`primary fire timing (${legacy ? 'legacy: no fire buffer' : 'default rules'}), ticks of 1/60 s`);
console.log('family     species    move           cd(s) w(s) | press→accept →release | hold: casts gap(t) cd(t) | pre-ready tap k=1,3,6,9,12,15,20,30 (delay or -) | taps 3/5/8 Hz casts (hold) | dps tap8/hold');
for (const [fam, sp] of FAMILIES) {
  if (only.length && !only.includes(sp) && !only.includes(fam)) continue;
  // ready press
  let { ctx, aim } = calm(sp);
  const spec = slotSpec(ctx, 0);
  const w = ctx.rules.feel.windup[spec.archetype] ?? 0;
  const one = drive(ctx, aim, 240, () => false, (t) => t === 0);
  const pa = one.acc[0] ?? NaN, pr = one.rel[0] ?? NaN;
  // hold
  ({ ctx, aim } = calm(sp));
  const hold = drive(ctx, aim, 600, () => true, (t) => t === 0);
  const gaps = hold.acc.slice(1).map((t, i) => t - hold.acc[i]);
  const gap = gaps.length ? gaps[gaps.length - 1] : NaN;
  // pre-ready taps: accept at tick 0, then one tap k ticks before the next ready tick (= the hold cadence)
  const pre = [1, 3, 6, 9, 12, 15, 20, 30].map((k) => {
    const r = calm(sp);
    const at = gap - k;
    const lg = drive(r.ctx, r.aim, gap + 120, () => false, (t) => t === 0 || t === at);
    const next = lg.acc.find((t) => t > 0);
    return next === undefined ? '-' : String(next - at);
  });
  // tap streams
  const taps = [3, 5, 8].map((hz) => {
    const r = calm(sp);
    const per = Math.round(60 / hz);
    return drive(r.ctx, r.aim, 600, () => false, (t) => t % per === 0);
  });
  console.log(`${fam.padEnd(10)} ${sp.padEnd(10)} ${spec.key.padEnd(14)} ${spec.cd.toFixed(3)} ${w.toFixed(2)} | ${pad(pa, 6)} ${pad(pr, 8)} | ${pad(hold.acc.length, 11)} ${pad(gap, 6)} ${pad((spec.cd * 60).toFixed(1), 5)} | ${pre.map((s) => pad(s, 2)).join(' ').padEnd(47)} | ${taps.map((x) => pad(x.acc.length, 2)).join(' ')} (${hold.acc.length}) | ${pad((taps[2].dmg / 10).toFixed(0), 5)} / ${(hold.dmg / 10).toFixed(0)}`);
}
