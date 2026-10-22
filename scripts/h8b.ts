// Phase 8b balance sweeps with the bot (blueprint sections 6, 14, 15 and 16):
//  1. dominance: every partner x every technique (and none); a pair whose mean bot survival is more than 1.5x the
//     median goes to review (the 8b acceptance), below 0.67x is reported as weak
//  2. technique frequency: in the same runs, how often an offer holds a technique and the longest run without one
//  3. "plays differently" (V3 proxy): Jensen-Shannon divergence between technique groups' distributions of
//     capability outcomes (pushes, holds, deflects, reactions, breaks...)
//  4. transforms: each transform on its slice carrier against the untransformed move
// `npx tsx scripts/h8b.ts [seeds=3] [seconds=1200] [part=all] [shard=0/1]` (then `... merge` for sharded runs). Results also go to h8b-results.json.
// The bot cannot aim, time a Guard or hold on purpose, so techniques whose gain needs skill (Riposte, Lodestone,
// Slipstream, Heavy Footing's deflects) mostly show their cost here: read low numbers as "not exercised", not "weak".
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRun, step } from '../src/sim/run';
import { botInput, setBotCards } from '../src/sim/bot';
import { TECHNIQUES, TRANSFORMS } from '../src/rules/build';
import type { SimEvent } from '../src/sim/types';

const seeds = Number(process.argv[2] ?? 3), seconds = Number(process.argv[3] ?? 1200), part = process.argv[4] ?? 'all';
const [shard, shards] = (process.argv[5] ?? '0/1').split('/').map(Number);
const PARTNERS = ['bulbasaur', 'charmander', 'squirtle', 'chikorita', 'cyndaquil', 'totodile'];

interface Run { time: number; kills: number; level: number; got: number; offers: number; withTech: number; maxGap: number; dist: Record<string, number>; stray: number }
function run(species: string, seed: number, plan: { techs?: string[]; xfs?: string[] }): Run {
  setBotCards('plan', plan, seed);
  // sweep-only: unlimited skips, so the plan bot never has to take a technique outside its plan when an offer holds
  // nothing else (late in a run the Kit and Wildcard pools can run dry). A skip's 8% heal applies to every config alike.
  const ctx = createRun({ seed, species, ruleOverrides: { cards: { skips: 99999 } } as never });
  const r: Run = { time: 0, kills: 0, level: 0, got: -1, offers: 0, withTech: 0, maxGap: 0, dist: {}, stray: 0 };
  let gap = 0, lastId = '';
  const count = (k: string) => { r.dist[k] = (r.dist[k] ?? 0) + 1; };
  while (ctx.time < seconds && ctx.state !== 'over' && ctx.state !== 'victory') {
    const ev: SimEvent[] = step(ctx, botInput(ctx));
    for (const e of ev) {
      if (e.t === 'cards' && (ctx.cards.source === 'level' || ctx.cards.source === 'chest')) {
        const id = e.cards.map((c) => c.id).join();
        if (id === lastId) continue; lastId = id;
        r.offers++;
        if (e.cards.some((c) => c.kind === 'technique')) { r.withTech++; gap = 0; } else { gap++; r.maxGap = Math.max(r.maxGap, gap); }
      }
      else if (e.t === 'push') count(e.ok ? (e.combined ? 'push+' : 'push') : 'pushFail');
      else if (e.t === 'react') count('react:' + e.kind);
      else if (e.t === 'deflect') count('deflect');
      else if (e.t === 'parry') count('parry');
      else if (e.t === 'break') count('break');
      else if (e.t === 'block') count('block');
      else if (e.t === 'cell') count('cell:' + e.change);
      else if (e.t === 'tagAction') count('tag');
    }
    if (r.got < 0 && plan.techs?.length && plan.techs.every((t) => ctx.player.techs.includes(t))) r.got = ctx.time;
    if (r.got < 0 && plan.xfs?.length && ctx.player.squad.some((m) => m.moves.some((s) => plan.xfs!.includes(s.xf ?? '')))) r.got = ctx.time;
  }
  r.time = ctx.time; r.kills = ctx.stats.kills; r.level = ctx.player.level;
  // a technique outside the plan (taken only when an offer held nothing else and no skip was left)
  r.stray = ctx.player.techs.filter((t) => !(plan.techs ?? []).includes(t)).length;
  return r;
}
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
function jsd(p: Record<string, number>, q: Record<string, number>): number {
  const keys = new Set([...Object.keys(p), ...Object.keys(q)]);
  const sp = Object.values(p).reduce((a, b) => a + b, 0), sq = Object.values(q).reduce((a, b) => a + b, 0);
  let d = 0;
  for (const k of keys) {
    const a = (p[k] ?? 0) / (sp || 1), b = (q[k] ?? 0) / (sq || 1), m = (a + b) / 2;
    if (a > 0) d += 0.5 * a * Math.log2(a / m);
    if (b > 0) d += 0.5 * b * Math.log2(b / m);
  }
  return d;
}
const add = (into: Record<string, number>, from: Record<string, number>) => { for (const [k, v] of Object.entries(from)) into[k] = (into[k] ?? 0) + v; };

if (part === 'merge') {
  const files = readdirSync('.').filter((f) => /^h8b-results\.\d+\.json$/.test(f)).sort();
  console.log(report(files.map((f) => JSON.parse(readFileSync(f, 'utf8')))));
  process.exit(0);
}
const out: Record<string, unknown> = { seeds, seconds, date: new Date().toISOString().slice(0, 10) };
let job = 0;
const mine = () => job++ % shards === shard;

if (part === 'all' || part === 'tech') {
  const techs = ['none', ...TECHNIQUES.map((t) => t.id)];
  const table: Record<string, Record<string, { time: number; got: number; kills: number }>> = {};
  const dists: Record<string, Record<string, number>> = {};
  let offers = 0, withTech = 0, worstGap = 0, stray = 0;
  for (const sp of PARTNERS) for (const t of techs) {
    if (!mine()) continue;
    const rs: Run[] = [];
    for (let s = 1; s <= seeds; s++) rs.push(run(sp, s, t === 'none' ? { techs: [] } : { techs: [t] }));
    (table[sp] ??= {})[t] = { time: mean(rs.map((r) => r.time)), got: mean(rs.map((r) => (r.got < 0 ? NaN : r.got)).filter((x) => !isNaN(x))), kills: mean(rs.map((r) => r.kills)) };
    for (const r of rs) { offers += r.offers; withTech += r.withTech; worstGap = Math.max(worstGap, r.maxGap); add((dists[t] ??= {}), r.dist); stray += r.stray; }
    process.stderr.write(`${sp} ${t}: ${table[sp][t].time.toFixed(0)} s\n`);
  }
  out.tech = { table, offers, withTech, worstGap, dists, stray };
}

if (part === 'all' || part === 'xf') {
  const CARRIER: Record<string, string> = { water_gun: 'totodile', bite: 'totodile', ember: 'cyndaquil', flame_wheel: 'cyndaquil', vine_whip: 'bulbasaur', seed_bomb: 'bulbasaur' };
  const xt: Record<string, { species: string; time: number; got: number; base: number }> = {};
  const baseCache: Record<string, number> = {};
  for (const T of TRANSFORMS) {
    if (!mine()) continue;
    const sp = CARRIER[T.move];
    const rs: Run[] = [];
    for (let s = 1; s <= seeds; s++) rs.push(run(sp, s, { techs: [], xfs: [T.id] }));
    if (baseCache[sp] === undefined) { const b: Run[] = []; for (let s = 1; s <= seeds; s++) b.push(run(sp, s, { techs: [], xfs: ['__none__'] })); baseCache[sp] = mean(b.map((r) => r.time)); }
    xt[T.id] = { species: sp, time: mean(rs.map((r) => r.time)), got: mean(rs.map((r) => r.got).filter((g) => g >= 0)), base: baseCache[sp] };
    process.stderr.write(`${T.id} on ${sp}: ${xt[T.id].time.toFixed(0)} s (no transform ${baseCache[sp].toFixed(0)} s)\n`);
  }
  out.xf = xt;
}
setBotCards('first');
const file = shards > 1 ? `h8b-results.${shard}.json` : 'h8b-results.json';
writeFileSync(file, JSON.stringify(out, null, 1));

/** print the summary from one or more result files (merged) */
export function report(parts: Record<string, any>[]) {
  const table: Record<string, Record<string, any>> = {};
  const dists: Record<string, Record<string, number>> = {};
  let offers = 0, withTech = 0, worstGap = 0, stray = 0;
  const xf: Record<string, any> = {};
  for (const p of parts) {
    if (p.tech) { for (const [sp, row] of Object.entries(p.tech.table)) Object.assign((table[sp] ??= {}), row); offers += p.tech.offers; withTech += p.tech.withTech; stray += p.tech.stray ?? 0; worstGap = Math.max(worstGap, p.tech.worstGap); for (const [t, d] of Object.entries(p.tech.dists)) add((dists[t] ??= {}), d as Record<string, number>); }
    if (p.xf) Object.assign(xf, p.xf);
  }
  const lines: string[] = [];
  if (Object.keys(table).length) {
    const all: number[] = [];
    for (const row of Object.values(table)) for (const [t, v] of Object.entries(row)) if (t !== 'none') all.push(v.time);
    const med = median(all);
    const capped = all.filter((t) => t >= parts[0].seconds - 0.5).length;
    lines.push(`Technique x partner, mean bot survival (s, cap ${parts[0].seconds}); median ${med.toFixed(0)} s; review > ${(1.5 * med).toFixed(0)} s; pairs at the cap ${capped}/${all.length}${1.5 * med > parts[0].seconds ? ' (the cap is below the review line: raise it)' : ''}`);
    const techs = Object.keys(Object.values(table)[0]);
    lines.push(['partner', ...techs].join(' | '));
    let over = 0, weak = 0;
    for (const [sp, row] of Object.entries(table)) lines.push([sp, ...techs.map((t) => { const v = row[t]?.time ?? NaN; const flag = t !== 'none' && v > 1.5 * med ? ' ▲' : t !== 'none' && v < 0.67 * med ? ' ▼' : ''; if (flag === ' ▲') over++; if (flag === ' ▼') weak++; return v.toFixed(0) + flag; })].join(' | '));
    lines.push(`pairs above 1.5x median: ${over}; below 0.67x: ${weak}`);
    lines.push(`techniques outside the bot's plan held at the end of a run: ${stray}`);
    lines.push(`technique offered in ${withTech}/${offers} offers (${((withTech / Math.max(1, offers)) * 100).toFixed(0)}%); longest run of offers without one: ${worstGap}`);
    const ids = Object.keys(dists).filter((t) => t !== 'none');
    const js = ids.map((t) => [t, jsd(dists[t], dists.none ?? {})] as const);
    lines.push('JSD of capability outcomes vs no technique: ' + js.map(([t, d]) => `${t} ${d.toFixed(3)}`).join(', '));
    const pair: number[] = [];
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) pair.push(jsd(dists[ids[i]], dists[ids[j]]));
    lines.push(`pairwise JSD between techniques: mean ${mean(pair).toFixed(3)}, max ${Math.max(...pair).toFixed(3)}`);
  }
  if (Object.keys(xf).length) {
    lines.push('Transforms (bot takes only this one): mean survival vs the same partner without transforms');
    for (const [id, v] of Object.entries(xf)) lines.push(`${id} (${v.species}): ${v.time.toFixed(0)} s vs ${v.base.toFixed(0)} s; taken at ${isNaN(v.got) ? 'never' : v.got.toFixed(0) + ' s'}`);
  }
  return lines.join('\n');
}
if (shards === 1) console.log(report([out]));
