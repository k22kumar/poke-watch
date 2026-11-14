// Aggregates scripts/habtac.ts --json output: node scripts/habtac-sum.mjs a.json [b.json ...] [--by map,seed,horde,raid,route]
import { readFileSync } from 'node:fs';
const files = process.argv.slice(2).filter((a) => a.endsWith('.json'));
const byI = process.argv.indexOf('--by'); const by = (byI > 0 ? process.argv[byI + 1] : 'map,seed,horde,raid').split(',');
const rows = files.flatMap((f) => JSON.parse(readFileSync(f, 'utf8')));
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const f = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : '-');
const groups = new Map();
for (const r of rows) { const k = by.map((b) => (b === 'horde' ? (r.horde ? 'horde' : 'raid-only') : b === 'seed' ? 's' + r.seed : r[b])).join(' '); (groups.get(k) ?? groups.set(k, []).get(k)).push(r); }
console.log(['group'.padEnd(46), 'n', 'reach', 'contact(t@%)', 'raidAt', 'raidersReach%', 'used d/f/m', 'hold done/fail/wipe', 'holdT', 'drain', 'out s', 'dmg%', 'faints', 'back s', 'back dmg%', 'kill d(m)'].join(' | '));
for (const [k, g] of [...groups].sort()) {
  const reach = g.map((r) => r.reach).filter((x) => x != null);
  const contact = g.filter((r) => r.contactAny);
  const raid = g.map((r) => r.raidAt).filter((x) => x != null);
  const used = { shortest: 0, other: 0, mixed: 0 }; for (const r of g) for (const u of r.raidersUsed) if (u in used) used[u]++;
  const done = g.filter((r) => r.hold === 'done').length, fail = g.filter((r) => r.hold === 'failed').length, wipe = g.filter((r) => r.hold === 'wiped').length;
  const kd = g.flatMap((r) => r.raidKills.map((x) => x.d));
  console.log([k.padEnd(46), g.length, f(mean(reach)), `${f(mean(contact.map((r) => r.contactAny.t)))}@${f(mean(contact.map((r) => r.contactAny.frac)) * 100, 0)}% (${contact.length}/${g.length})`, f(mean(raid)), f(100 * raid.length / g.length, 0), `${used.shortest}/${used.other}/${used.mixed}`, `${done}/${fail}/${wipe}`, f(mean(g.filter((r) => r.holdT).map((r) => r.holdT))), f(mean(g.map((r) => r.drained)), 2), f(mean(g.map((r) => r.outSeconds))), f(mean(g.map((r) => r.holdDmg)) * 100, 0), f(mean(g.map((r) => r.faints))), f(mean(g.map((r) => r.backT).filter((x) => x != null))), f(mean(g.map((r) => r.backDmg)) * 100, 0), f(mean(kd))].join(' | '));
}
