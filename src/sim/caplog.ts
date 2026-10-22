// Capability event log (blueprint sections 10 and 12, Phase 8a).
//
// Every capability event the resolver settles (a push that moved a body or failed, a hold, a deflect, an
// interception, a body impact or break, a hit on the player) is written here as a record. The log is a fixed
// ring of preallocated records, so recording allocates nothing and never touches an RNG stream: it cannot change
// the simulation. Two readers use it: the death recap (the last 5 s, as short lines that name the rule which
// decided each outcome) and pokewatch.debug('caps') (the last 3 s, drawn over the world).

import { WEIGHT_NAMES } from '../rules/species';
import { guardWeight } from './techniques';
import type { SimContext } from './types';
import { ELEMENT_DEFS, type Element } from '../rules/elements';
import type { CapVerb } from '../rules/capabilities';

export type LogVerb = CapVerb | 'intercept' | 'release' | 'impact' | 'break' | 'tile' | 'faint' | 'technique';
export type LogOut = 'ok' | 'fail' | 'combined' | 'parry' | 'brace' | 'hit' | 'immune' | 'cancel' | 'catch' | 'drop' | 'none';
export type LogKind = 'move' | 'tag' | 'body' | 'shot' | 'tile' | 'creature' | 'player' | 'zone' | 'trainer' | '';

export interface CapRecord {
  t: number; tick: number;
  /** write order across both rings */
  seq: number;
  verb: LogVerb; out: LogOut;
  /** the force's Power (push / hold / deflect = guard Weight) and the target's Weight */
  power: number; weight: number;
  type: Element;
  src: LogKind; srcName: string; srcW: number;
  tgt: LogKind; tgtName: string;
  /** damage dealt (hits), type effectiveness */
  amount: number; eff: number;
  x: number; z: number;
  /** the field Pokémon's Weight class when the record was written (what its Guard could stop) */
  guardW: number;
}

const blank = (): CapRecord => ({ t: 0, tick: 0, seq: 0, verb: 'hit', out: 'none', power: 0, weight: 0, type: 'plain', src: '', srcName: '', srcW: 0, tgt: '', tgtName: '', amount: 0, eff: 1, x: 0, z: 0, guardW: 0 });

export class CapLog {
  /** every capability event (world forces, interceptions, impacts…) */
  readonly recs: CapRecord[];
  /** events that hurt the player or concern its squad, kept apart so a dense shot field cannot push them out
   *  of the window the death recap reads */
  readonly mine: CapRecord[];
  /** records written so far, all rings together */
  n = 0;
  private nw = 0; private nm = 0;
  constructor(size: number) {
    this.recs = Array.from({ length: Math.max(8, size) }, blank);
    this.mine = Array.from({ length: 64 }, blank);
  }
  /** the next record to fill (overwrites the oldest of its ring) */
  next(t: number, tick: number, player = false): CapRecord {
    const r = player ? this.mine[this.nm++ % this.mine.length] : this.recs[this.nw++ % this.recs.length];
    r.seq = this.n++;
    r.t = t; r.tick = tick; r.power = 0; r.weight = 0; r.amount = 0; r.eff = 1; r.srcW = 0; r.srcName = ''; r.tgtName = ''; r.src = ''; r.tgt = ''; r.out = 'none'; r.type = 'plain';
    return r;
  }
  /** records newer than `since` (sim time), from both rings, in write order */
  since(since: number): CapRecord[] {
    const out: CapRecord[] = [];
    const take = (ring: CapRecord[], n: number) => { const L = ring.length; for (let k = Math.max(0, n - L); k < n; k++) { const r = ring[k % L]; if (r.t >= since) out.push(r); } };
    take(this.recs, this.nw); take(this.mine, this.nm);
    return out.sort((a, b) => a.seq - b.seq);
  }
  clear() { this.n = 0; this.nw = 0; this.nm = 0; }
}

// ------------------------------------------------------------------ writing
/** who is acting now: set by the resolver (and the few direct callers) before a rule runs */
const SRC = { kind: '' as LogKind, name: '' };
export function setSrc(kind: LogKind, name: string) { SRC.kind = kind; SRC.name = name; }

/** A new record for the current source, or null when the capability layer is off (v10 behaviour). */
export function rec(ctx: SimContext, verb: LogVerb, out: LogOut, player = false): CapRecord | null {
  if (!ctx.rules.caps.enabled) return null;
  const r = ctx.caplog.next(ctx.time, ctx.tick, player);
  r.verb = verb; r.out = out; r.src = SRC.kind; r.srcName = SRC.name;
  r.guardW = guardWeight(ctx);
  return r;
}

// ------------------------------------------------------------------ wording
const W = (w: number) => `${WEIGHT_NAMES[Math.max(0, Math.min(4, w))]} (${w})`;
const typeName = (e: Element) => ELEMENT_DEFS[e]?.name ?? e;
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const bodyName = (k: string) => cap(k);
const n0 = (x: number) => Math.round(x);

/** one line for a record that hurt (or tried to hurt) the player, naming the rule that decided it */
function hurtLine(r: CapRecord): string {
  const dmg = r.amount > 0 ? ` for ${n0(r.amount)}` : '';
  const sup = r.eff > 1.01 ? ' (super effective)' : r.eff < 0.99 ? ' (resisted)' : '';
  const canGuard = r.srcW <= r.guardW;
  const guardNote = canGuard ? 'A timed Guard (0.15 s) could have deflected it.' : `Your Guard: ${W(r.guardW)}. Only a Pokémon of Weight ${r.srcW} or more can deflect it — dodge it, push it, or break it.`;
  if (r.out === 'parry') return `You deflected ${r.src === 'body' ? 'a ' + bodyName(r.srcName) : r.srcName || 'a hit'} with a timed Guard.`;
  if (r.src === 'body') {
    const head = `${bodyName(r.srcName)} (Weight ${r.srcW}, ${typeName(r.type)}) hit you${dmg}${sup}.`;
    if (r.out === 'brace') return `${head} Brace halved it. ${canGuard ? 'Tap Guard just before impact to deflect it.' : 'Too heavy to deflect: Dash, or push it with two moves at once.'}`;
    return `${head} ${guardNote}`;
  }
  if (r.src === 'shot') {
    const who = r.srcName ? `${r.srcName}'s ` : '';
    const head = `${who}${typeName(r.type)} shot (Weight ${r.srcW}) hit you${dmg}${sup}.`;
    if (r.out === 'brace') return `${head} Brace halved it.`;
    return `${head} ${canGuard ? 'A timed Guard deflects it; a Push or your own shot can stop it too.' : 'Too heavy for your Guard; shoot it down with a shot as heavy, or step aside.'}`;
  }
  if (r.src === 'zone') return `${r.srcName ? r.srcName + "'s " : ''}slam hit you${dmg}${sup}. Leave the red ring before it lands, or Jump.`;
  if (r.src === 'tile') {
    if (r.srcName === 'burn') return `Burning grass scorched you${dmg}. Fire spreads through tall grass: stand on bare ground or ash.`;
    if (r.srcName === 'charge') return `A Charge flood ran through the wet ground under you${dmg}. Jump over it, or dry the ground with Heat.`;
    return `The ground hurt you${dmg}.`;
  }
  if (r.src === 'creature') {
    const head = `${r.srcName || 'An enemy'} (Weight ${r.srcW}) hit you${dmg}${sup}.`;
    if (r.out === 'brace') return `${head} Brace halved it.`;
    return `${head} ${canGuard ? 'A timed Guard would have parried it.' : `Too heavy to parry with ${W(r.guardW)}: Dash away.`}`;
  }
  return `Something hit you${dmg}.`;
}

/** Build the death recap: the last `seconds` of capability events, as short lines (oldest first). */
export function buildRecap(log: CapLog, now: number, seconds: number, maxLines = 6): string[] {
  const recs = log.since(now - seconds);
  const lines: string[] = [];
  const counts: number[] = [];
  const bySource = new Map<string, number>();
  let total = 0;
  for (const r of recs) {
    let line = '';
    if (r.tgt === 'player' && (r.verb === 'hit' || r.verb === 'tile')) {
      if (r.out === 'immune' || r.out === 'none') continue;
      line = hurtLine(r);
      const key = r.src === 'body' ? bodyName(r.srcName) : r.src === 'tile' ? (r.srcName === 'burn' ? 'Burning grass' : 'Charge flood') : r.srcName || r.src;
      bySource.set(key, (bySource.get(key) ?? 0) + r.amount);
      total += r.amount;
    } else if (r.verb === 'faint') line = `${r.srcName} fainted.`;
    else if (r.src === 'move' || r.src === 'tag') {
      // your own forces that failed show what would have worked
      if ((r.verb === 'push' || r.verb === 'hold') && r.out === 'fail' && r.tgt === 'body') line = `Your ${r.srcName} (${cap(r.verb)} ${r.power}) could not move the ${bodyName(r.tgtName)} (Weight ${r.weight}). Two forces within 0.2 s and 45° add +1 Power.`;
      else continue;
    } else continue;
    if (lines.length && lines[lines.length - 1] === line) { counts[counts.length - 1]++; continue; }
    lines.push(line); counts.push(1);
  }
  let out = lines.map((l, k) => (counts[k] > 1 ? `${l} (×${counts[k]})` : l));
  if (out.length > maxLines) out = out.slice(out.length - maxLines);
  if (total > 0 && bySource.size > 1) {
    let best = '', bv = -1;
    for (const [k, v] of bySource) if (v > bv) { bv = v; best = k; }
    out.push(`Most of it came from ${best}: ${n0(bv)} of ${n0(total)} damage in the last ${seconds} s.`);
  }
  return out;
}

/** one compact line per record, for pokewatch.debug('caps') and the console */
export function debugLine(r: CapRecord, now: number): string {
  const age = (now - r.t).toFixed(1);
  const pw = r.power ? ` P${r.power}` : '';
  const wt = r.tgt === 'body' || r.tgt === 'shot' || r.tgt === 'creature' ? ` W${r.weight}` : '';
  const amt = r.amount ? ` ${n0(r.amount)}` : '';
  return `-${age}s ${r.verb}${pw} ${r.src}:${r.srcName || '?'} → ${r.tgt}:${r.tgtName || '?'}${wt} = ${r.out}${amt}`;
}

/** short label drawn at the event's position in the debug overlay */
export function debugTag(r: CapRecord): string {
  switch (r.verb) {
    case 'push': case 'hold': return `${r.verb} ${r.power}${r.weight ? (r.power >= r.weight ? '≥' : '<') + r.weight : ''} ${r.out === 'fail' ? 'x' : r.out === 'combined' ? '+1' : 'ok'}`;
    case 'deflect': return 'deflect';
    case 'intercept': return r.out === 'cancel' ? 'cancel' : r.out === 'catch' ? 'catch' : 'intercept';
    case 'release': return `release ${r.power}`;
    case 'impact': return `impact ${n0(r.amount)}`;
    case 'break': return 'break';
    case 'create': return `create ${r.tgtName}`;
    case 'technique': return r.srcName;
    case 'hit': return r.tgt === 'player' ? `hurt ${n0(r.amount)}` : `hit ${n0(r.amount)}`;
    default: return r.verb;
  }
}
