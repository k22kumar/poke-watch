// The build layer (blueprint section 6, Phase 8b): three-card offers, transforms, techniques, mastery.
//
// Every pick shows three cards, one from each pool:
//   Kit       - the field Pokémon: learn a move into an empty slot, replace a move, or transform a move
//   Technique - a trainer-wide rule with a written cost (at most 3 held; a 4th means discarding one)
//   Wildcard  - a benched Pokémon's transform, a Tag Action variant you passed on, an early evolution, a heal
// Each eligible card has a weight  w = base x (1 + 0.6 s) x n x f :
//   s = the card's capability tags the kit already uses (capped at 2): synergy without forcing it
//   n = 1.5 for a capability the squad lacks, during the first 4 picks: early picks widen the kit
//   f = 0.5 for a card shown in the previous offer
// Once 3 techniques are held the Technique slot shows a replacement only some of the time, but a technique is
// guaranteed at least once every 3 picks. Rerolls (2) and banishes (1) are per region.
// Raw power comes from squad level and evolution: a move's level follows the squad level (mastery).
// All randomness uses the cards stream, in a fixed order, so offers are deterministic.

import { MOVE_BY_KEY } from '../rules/moves';
import { capTag, compileCaps, type Cap, type CapVerb } from '../rules/capabilities';
import { ELEMENT_DEFS } from '../rules/elements';
import { SPECIES_BY_ID, SPECIES } from '../rules/species';
import { TAG_ACTIONS } from '../rules/tags';
import { TECHNIQUES, TECHNIQUE_BY_ID, TECH_BIT, TRANSFORMS_OF, TRANSFORM_BY_ID, type TransformDef } from '../rules/build';
import type { Rules } from '../rules/defaults';
import { compileMove } from './moves';
import { healPlayer } from './combat';
import { learnsetOf, lineage, recomputeMember } from './progression';
import { queueVariant } from './squad';
import { logTech } from './techniques';
import type { Card, Member, MoveSlot, MoveSpec, SimContext } from './types';

export const buildOn = (ctx: SimContext) => ctx.rules.build.enabled;
/** move levels come from mastery (squad level), not from power-up cards */
export const masteryOn = (ctx: SimContext) => ctx.rules.build.enabled && !ctx.rules.build.legacyNumeric;

// ------------------------------------------------------------------ transforms
const xfCache = new WeakMap<Rules, Map<string, MoveSpec>>();

/** the compiled spec of `key` with transform `xf` applied (cached, like compileMove) */
export function transformSpec(rules: Rules, key: string, xf: string): MoveSpec {
  let c = xfCache.get(rules);
  if (!c) { c = new Map(); xfCache.set(rules, c); }
  const id = key + '|' + xf;
  const hit = c.get(id);
  if (hit) return hit;
  const T = TRANSFORM_BY_ID[xf];
  const base = compileMove(rules, key);
  if (!T || T.move !== key) throw new Error(`transform ${xf} is not for ${key}`);
  const s: MoveSpec = { ...base, ...(T.set ?? {}), xf, name: T.title } as MoveSpec;
  for (const [k, v] of Object.entries(T.mul ?? {})) (s as unknown as Record<string, number>)[k] *= v as number;
  // capabilities re-derived from the edited spec (a dash derives Push, a beam keeps Water's Push...), then edited
  const derived = compileCaps(s);
  const rm = T.caps?.remove ?? [], add = T.caps?.add ?? [];
  const kept = derived.filter((cp) => !rm.includes(cp.verb) && !add.some((a) => a.verb === cp.verb));
  s.caps = [...kept, ...add];
  c.set(id, s);
  return s;
}

/** the verbs a move's caps add over the base move */
function addedVerbs(rules: Rules, T: TransformDef): CapVerb[] {
  const before = new Set((compileMove(rules, T.move).caps ?? []).map((c) => c.verb));
  return (transformSpec(rules, T.move, T.id).caps ?? []).map((c) => c.verb).filter((v) => !before.has(v));
}

/** every force / chemistry verb a Pokémon's line has anywhere: its learnsets (all forms), coverage and Tag Actions */
export function lineVerbs(rules: Rules, m: Member): Set<string> {
  const out = new Set<string>();
  const line = lineage(m.species);
  // later forms too: what the line will learn belongs to its identity
  let cur = m.species;
  while (cur.evolvesTo && SPECIES_BY_ID[cur.evolvesTo]) { cur = SPECIES_BY_ID[cur.evolvesTo]; line.push(cur); }
  const keys = new Set<string>();
  for (const sp of line) {
    for (const [, k] of learnsetOf(sp)) keys.add(k);
    for (const [, k] of sp.coverage ?? []) keys.add(k);
    if (sp.starter) keys.add(sp.starter);
  }
  for (const s of m.moves) keys.add(s.key);
  const tag = TAG_ACTIONS[line[0].id];
  if (tag) { keys.add(tag.base.move); keys.add(tag.variant.move); if (tag.base.create || tag.variant.create) out.add('create'); }
  for (const k of keys) if (MOVE_BY_KEY[k]) for (const c of compileMove(rules, k).caps ?? []) out.add(c.verb);
  return out;
}

/** a transform may only add Push or Hold when the line already has it (pillar 3); Create of a tile state is the
 *  Grass type's own setup verb and is allowed (the blueprint gives Seed Bomb Burrow) */
export function transformAllowed(rules: Rules, m: Member, T: TransformDef): boolean {
  const added = addedVerbs(rules, T).filter((v) => v === 'push' || v === 'hold');
  if (!added.length) return true;
  const have = lineVerbs(rules, m);
  return added.every((v) => have.has(v));
}

/** apply transform `xf` to a move slot (once; the other transform of that move is gone for the run) */
export function setTransform(ctx: SimContext, slot: MoveSlot, xf: string) {
  if (slot.xf) return false;
  slot.xf = xf;
  slot.spec = transformSpec(ctx.rules, slot.key, xf);
  return true;
}

/** casts a move needs before its transforms are offered */
function usesNeeded(ctx: SimContext, slotIndex: number) {
  const U = ctx.rules.build.transformUses;
  return slotIndex === 0 ? U.basic : U.move;
}

// ------------------------------------------------------------------ mastery
export function masteryLevel(ctx: SimContext): number {
  const B = ctx.rules.build;
  return Math.min(ctx.rules.moves.maxLevel, 1 + Math.floor((ctx.player.level - 1) / B.masteryEvery));
}
/** every squad member's moves follow the squad level */
export function applyMastery(ctx: SimContext) {
  if (!masteryOn(ctx)) return;
  const L = masteryLevel(ctx);
  for (const m of ctx.player.squad) for (const s of m.moves) if (s.level < L) s.level = L;
}

// ------------------------------------------------------------------ tags and weights
/** a capability tag without its Power: push, hold, apply:wet, create */
const norm = (c: Cap) => (c.verb === 'apply' ? 'apply:' + c.agent : c.verb);
const UNIVERSAL = new Set(['hit', 'deflect']); // everyone hits and everyone can Guard: no synergy from them

/** the capability tags a member's kit uses now: its moves and its Tag Action */
export function kitTags(ctx: SimContext, m: Member): Set<string> {
  const out = new Set<string>();
  for (const s of m.moves) for (const c of s.spec.caps ?? []) out.add(norm(c));
  const line = TAG_ACTIONS[lineage(m.species)[0].id];
  const def = line ? (m.tagVariant ? line.variant : line.base) : null;
  if (def && MOVE_BY_KEY[def.move]) for (const c of compileMove(ctx.rules, def.move).caps ?? []) out.add(norm(c));
  if (def?.create) out.add('create');
  if (ctx.player.squad.length > 1) out.add('tag');
  for (const u of UNIVERSAL) out.delete(u);
  return out;
}
/** tags the whole squad has */
export function squadTags(ctx: SimContext): Set<string> {
  const out = new Set<string>();
  for (const m of ctx.player.squad) for (const t of kitTags(ctx, m)) out.add(t);
  return out;
}
const has = (set: Set<string>, t: string) => (t === 'apply' ? [...set].some((x) => x.startsWith('apply:')) : set.has(t));

/** w = base x (1 + synergy x s) x n x f (exported for tests) */
export function cardWeight(ctx: SimContext, card: Card, base: number, kit: Set<string>, squad: Set<string>): number {
  const B = ctx.rules.build;
  const tags = (card.tags ?? []).filter((t) => !UNIVERSAL.has(t));
  let s = 0;
  for (const t of tags) if (has(kit, t)) s++;
  s = Math.min(B.synergyCap, s);
  const n = ctx.build.picks < B.noveltyPicks && tags.some((t) => !has(squad, t)) ? B.novelty : 1;
  const f = ctx.build.lastShown.has(card.id) ? B.repeat : 1;
  return base * (1 + B.synergy * s) * n * f;
}

// ------------------------------------------------------------------ the pools
interface Entry { card: Card; w: number }

function slotsMax(ctx: SimContext) {
  const R = ctx.rules.player;
  return ctx.player.level >= R.lateSlotLevel ? R.moveSlotsLate : R.moveSlots;
}

function learnCardFor(ctx: SimContext, k: number, key: string, group: Card['group'], replaceSlot = -1): Card {
  const spec = compileMove(ctx.rules, key);
  const md = MOVE_BY_KEY[key];
  const m = ctx.player.squad[k];
  const tags = (spec.caps ?? []).map(norm);
  if (replaceSlot >= 0) {
    const old = m.moves[replaceSlot];
    return { id: 'rp:' + key, kind: 'replace', key, member: k, slot: replaceSlot, group, rarity: 'rare', element: md.element, archetype: spec.archetype, title: md.name, level: 1, tags,
      desc: `${m.species.name} forgets ${old.spec.name} and learns ${md.name}` };
  }
  return { id: key, kind: 'learn', key, member: k, group, rarity: 'rare', element: md.element, archetype: spec.archetype, title: md.name, level: 1, tags,
    desc: `New ${ELEMENT_DEFS[md.element].name} move · ${spec.archetype}${md.power ? ' · power ' + md.power : ''}` };
}

/** the slot a Replace card overwrites: Move A or B, not transformed, lowest base power (the basic attack stays) */
function replaceTarget(m: Member): number {
  let best = -1, bp = Infinity;
  for (let i = 1; i < m.moves.length; i++) {
    const s = m.moves[i];
    if (s.xf) continue;
    const p = MOVE_BY_KEY[s.key]?.power ?? 0;
    if (p < bp) { bp = p; best = i; }
  }
  return best;
}

/** learnable moves of member k (its line's learnset up to the squad level, then the rare coverage moves) */
function learnables(ctx: SimContext, k: number): [string, number][] {
  const P = ctx.player, m = P.squad[k];
  const out: [string, number][] = [];
  const seen = new Set<string>();
  const banished = ctx.cards.banished;
  const B = ctx.rules.build;
  let next: [string, number] | null = null; // the nearest move beyond the look-ahead (the Kit slot's last resort)
  for (const sp of lineage(m.species)) {
    for (const [lv, key] of learnsetOf(sp)) {
      if (seen.has(key)) continue;
      seen.add(key);
      if (m.learned.has(key) || banished.has(key) || banished.has('rp:' + key) || !MOVE_BY_KEY[key]) continue;
      if (lv > P.level + B.learnAhead) { if (!next || lv < next[1]) next = [key, lv]; continue; }
      out.push([key, lv > P.level ? 2 * B.learnAheadMult : 2]); // a few levels early: a filler, weighted lower
    }
  }
  if (!out.length && next) out.push([next[0], 2 * B.learnAheadMult]);
  for (const [lv, key] of lineage(m.species).flatMap((s) => s.coverage ?? [])) {
    if (lv > P.level || seen.has(key) || m.learned.has(key) || banished.has(key) || !MOVE_BY_KEY[key]) continue;
    seen.add(key);
    out.push([key, 0.2]);
  }
  return out;
}

function transformCards(ctx: SimContext, k: number, group: Card['group']): Card[] {
  const m = ctx.player.squad[k];
  const out: Card[] = [];
  m.moves.forEach((s, i) => {
    if (s.xf || (s.uses ?? 0) < usesNeeded(ctx, i)) return;
    for (const T of TRANSFORMS_OF[s.key] ?? []) {
      const id = `xf:${T.id}@${k}`; // per Pokémon: two squad members may both know Ember
      if (ctx.cards.banished.has(id) || !transformAllowed(ctx.rules, m, T)) continue;
      const spec = transformSpec(ctx.rules, s.key, T.id);
      out.push({ id, kind: 'transform', key: T.id, member: k, slot: i, group, rarity: 'epic', element: spec.element, archetype: spec.archetype,
        title: `${s.spec.name} → ${T.title}`, desc: T.gain, tags: (spec.caps ?? []).map(norm) });
    }
  });
  return out;
}

function kitPool(ctx: SimContext): Entry[] {
  const P = ctx.player, k = P.active, m = P.m, W = ctx.rules.build.weights;
  const out: Entry[] = [];
  if (m.fainted) return out;
  const free = m.moves.length < slotsMax(ctx);
  const target = free ? -1 : replaceTarget(m);
  for (const [key, mult] of learnables(ctx, k)) {
    if (free) out.push({ card: learnCardFor(ctx, k, key, 'kit'), w: W.learn * mult });
    else if (target >= 0) out.push({ card: learnCardFor(ctx, k, key, 'kit', target), w: W.replace * mult });
  }
  for (const c of transformCards(ctx, k, 'kit')) out.push({ card: c, w: W.transform });
  if (ctx.rules.build.legacyNumeric) {
    // compatibility: move power-ups (the v10 numeric card)
    for (const slot of m.moves) {
      if (slot.level >= ctx.rules.moves.maxLevel || ctx.cards.banished.has(slot.key)) continue;
      out.push({ card: { id: 'up:' + slot.key, kind: 'upgrade', key: slot.key, member: k, group: 'kit', rarity: 'common', element: slot.spec.element, archetype: slot.spec.archetype, title: slot.spec.name, level: slot.level + 1,
        desc: `Lv ${slot.level} → ${slot.level + 1}: +${Math.round(ctx.rules.moves.levelDmg * 100)}% damage, faster cooldown`, tags: (slot.spec.caps ?? []).map(norm) }, w: W.upgrade });
    }
  }
  return out;
}

function techniquePool(ctx: SimContext): Entry[] {
  const P = ctx.player, full = P.techs.length >= ctx.rules.build.maxTechniques;
  const out: Entry[] = [];
  for (const T of TECHNIQUES) {
    if (P.techs.includes(T.id) || ctx.cards.banished.has('tech:' + T.id)) continue;
    out.push({ card: { id: 'tech:' + T.id, kind: 'technique', key: T.id, group: 'technique', rarity: 'rare', title: T.title, desc: `${T.gain}. Cost: ${T.cost}`, tags: T.tags, swap: full }, w: ctx.rules.build.weights.technique });
  }
  return out;
}

/** a member whose Tag variant is unlocked but who kept the base Tag Action */
function variantOpen(ctx: SimContext, m: Member, k: number): boolean {
  if (m.tagVariant || ctx.recruit.variants.includes(k)) return false;
  const line = lineage(m.species);
  if (!TAG_ACTIONS[line[0].id]) return false;
  const evolves = line.some((s) => s.evolvesTo) || !!m.species.evolvesTo;
  return evolves ? line.length > 1 : ctx.player.level >= ctx.rules.squad.variantLevel;
}

function wildPool(ctx: SimContext): Entry[] {
  const P = ctx.player, W = ctx.rules.build.weights, B = ctx.rules.build;
  const out: Entry[] = [];
  const banished = ctx.cards.banished;
  P.squad.forEach((m, k) => {
    if (m.fainted) return;
    if (k !== P.active) for (const c of transformCards(ctx, k, 'wildcard')) out.push({ card: c, w: W.benchTransform });
    if (variantOpen(ctx, m, k) && !banished.has(`tag:${k}:1`)) {
      const line = TAG_ACTIONS[lineage(m.species)[0].id];
      const md = MOVE_BY_KEY[line.variant.move];
      const spec = compileMove(ctx.rules, md.key);
      out.push({ card: { id: `tag:${k}:1`, kind: 'tag', key: '1', member: k, group: 'wildcard', rarity: 'epic', element: md.element, title: md.name, desc: `New Tag Action for ${m.species.name}`, tags: compileCaps(spec, { create: line.variant.create }).map(norm) }, w: W.tagVariant });
    }
    const sp = m.species;
    if (sp.evolvesTo && sp.evolveLevel && P.level < sp.evolveLevel && sp.evolveLevel - P.level <= B.evolveWithin && !banished.has('evo:' + k) && SPECIES_BY_ID[sp.evolvesTo]) {
      const to = SPECIES_BY_ID[sp.evolvesTo];
      out.push({ card: { id: 'evo:' + k, kind: 'evolve', key: to.id, member: k, group: 'wildcard', rarity: 'epic', element: to.elements[0], title: `Evolve ${sp.name}`, desc: `${sp.name} evolves into ${to.name} now (Lv ${sp.evolveLevel} otherwise)`, tags: [] }, w: W.evolve });
    }
  });
  if (P.hp < P.maxHp * B.healBelow && !banished.has('heal')) out.push({ card: { id: 'heal', kind: 'heal', key: 'heal', group: 'wildcard', rarity: 'common', title: 'Sitrus Berry', desc: 'Restore 35% HP', tags: [] }, w: W.heal });
  if (B.legacyNumeric) {
    // compatibility: the numeric vitamins (blueprint decision 21 retires them; the flag brings them back)
    const held = Object.keys(P.vitamins).filter((key) => P.vitamins[key] > 0);
    for (const [key, v] of Object.entries(ctx.rules.vitamins)) {
      if (banished.has('vit:' + key) || (held.length >= ctx.rules.player.vitaminSlots && !held.includes(key))) continue;
      out.push({ card: { id: 'vit:' + key, kind: 'vitamin', key, group: 'wildcard', rarity: 'common', title: v.label + ' Vitamin', desc: `+${Math.round(v.add * 100)}% ${v.label}`, tags: [] }, w: W.vitamin });
    }
  }
  return out;
}

// ------------------------------------------------------------------ the offer
/** draw one card from the pools together (weighted) and remove it from its pool */
function draw(ctx: SimContext, pools: Entry[][], kit: Set<string>, squad: Set<string>): Card | null {
  const all: Entry[] = [];
  for (const p of pools) for (const e of p) all.push(e);
  if (!all.length) return null;
  const pick = ctx.rng.cards.weighted(all, (e) => cardWeight(ctx, e.card, e.w, kitOf(ctx, e.card, kit), squad));
  for (const p of pools) { const i = p.indexOf(pick); if (i >= 0) p.splice(i, 1); }
  return pick.card;
}
/** synergy is judged against the kit of the Pokémon the card is for (a benched member's transform: its own kit) */
function kitOf(ctx: SimContext, c: Card, field: Set<string>): Set<string> {
  if (c.member === undefined || c.member === ctx.player.active) return field;
  return kitTags(ctx, ctx.player.squad[c.member]);
}

/** Generate the Kit / Technique / Wildcard offer. */
export function generateBuildOffer(ctx: SimContext): Card[] {
  const P = ctx.player, B = ctx.rules.build;
  const kit = kitTags(ctx, P.m), squad = squadTags(ctx);
  const kits = kitPool(ctx), techs = techniquePool(ctx), wilds = wildPool(ctx);
  const out: Card[] = [];
  const take = (c: Card | null) => { if (c && !out.some((o) => o.id === c.id)) out.push(c); };
  // 1. Kit (falls back to a Wildcard when the field Pokémon has nothing to learn or transform)
  take(draw(ctx, [kits], kit, squad) ?? draw(ctx, [wilds], kit, squad));
  // 2. Technique: always while fewer than 3 are held; once full, sometimes, and at least once every 3 picks
  const full = P.techs.length >= B.maxTechniques;
  const roll = ctx.rng.cards.next();
  const forced = ctx.build.sinceTech >= B.techniqueEvery - 1;
  if (techs.length && (!full || forced || roll < B.techniqueWhenFull)) take(draw(ctx, [techs], kit, squad));
  else take(draw(ctx, [kits, wilds], kit, squad));
  // 3. Wildcard (then a Kit card, then a second technique). The berry is a filler: alone in the pool it takes the
  //    slot only some of the time
  const onlyHeal = wilds.length === 1 && wilds[0].card.kind === 'heal';
  const fill = ctx.rng.cards.next();
  const w3 = onlyHeal && fill >= B.healFill ? null : draw(ctx, [wilds], kit, squad);
  take(w3 ?? draw(ctx, [kits], kit, squad) ?? (full ? null : draw(ctx, [techs], kit, squad)) ?? draw(ctx, [wilds], kit, squad));
  // never fewer than three: fill with techniques while fewer than 3 are held (a choice of first techniques), else with
  // the berry (once the build is complete, offers thin out instead of forcing technique swaps)
  while (out.length < 3) {
    const c = (full ? null : draw(ctx, [techs], kit, squad)) ?? draw(ctx, [wilds], kit, squad);
    if (c) { take(c); continue; }
    if (out.some((o) => o.kind === 'heal') || ctx.cards.banished.has('heal')) break;
    take({ id: 'heal', kind: 'heal', key: 'heal', group: 'wildcard', rarity: 'common', title: 'Sitrus Berry', desc: 'Restore 35% HP', tags: [] });
  }
  ctx.build.lastShown = new Set(out.map((c) => c.id));
  return out;
}

/** a pick (or skip) resolved a level-up / item-ball offer: count it for the technique guarantee and novelty */
export function notePick(ctx: SimContext, offer: Card[] | null, picked: Card | null) {
  ctx.build.picks++;
  ctx.build.sinceTech = offer && offer.some((c) => c.kind === 'technique') ? 0 : ctx.build.sinceTech + 1;
  if (picked) ctx.build.history.push(picked.id);
}

// ------------------------------------------------------------------ applying
export function addTechnique(ctx: SimContext, id: string) {
  const P = ctx.player;
  if (P.techs.includes(id) || !TECHNIQUE_BY_ID[id]) return false;
  P.techs.push(id);
  P.techMask |= TECH_BIT[id];
  logTech(ctx, id, 'learned', P.x, P.z);
  return true;
}
export function removeTechnique(ctx: SimContext, id: string) {
  const P = ctx.player;
  const i = P.techs.indexOf(id);
  if (i < 0) return;
  P.techs.splice(i, 1);
  P.techMask &= ~TECH_BIT[id];
}

/** member k learns `key` (into a free slot, or over `slot`) at the current mastery level */
export function learnFor(ctx: SimContext, k: number, key: string, slot = -1) {
  const m = ctx.player.squad[k];
  if (!m) return;
  const level = masteryOn(ctx) ? masteryLevel(ctx) : 1;
  const ms: MoveSlot = { key, level, cd: 0.3, spec: compileMove(ctx.rules, key), uses: 0 };
  if (slot >= 0 && slot < m.moves.length) m.moves[slot] = ms; else m.moves.push(ms);
  m.learned.add(key);
  ctx.events.push({ t: 'learn', key });
}

export function evolveNow(ctx: SimContext, k: number) {
  const P = ctx.player, m = P.squad[k];
  const to = m?.species.evolvesTo;
  if (!m || !to || !SPECIES_BY_ID[to]) return;
  const first = lineage(m.species).length === 1;
  const from = m.species.id;
  m.species = SPECIES_BY_ID[to];
  recomputeMember(ctx, m);
  m.hp = m.maxHp; m.grey = 0;
  ctx.events.push({ t: 'benchEvolve', from, to });
  if (first) queueVariant(ctx, k);
}

/** Apply a build card. Returns 'swap' when the pick opened the technique-swap choice (the pick is not spent yet). */
export function applyBuildCard(ctx: SimContext, card: Card): 'done' | 'swap' {
  const P = ctx.player;
  const k = card.member ?? P.active;
  switch (card.kind) {
    case 'learn': if (P.squad[k] && P.squad[k].moves.length < slotsMax(ctx)) learnFor(ctx, k, card.key); break;
    case 'replace': learnFor(ctx, k, card.key, card.slot ?? -1); break;
    case 'transform': {
      const s = P.squad[k]?.moves[card.slot ?? -1];
      if (s && TRANSFORM_BY_ID[card.key]?.move === s.key) setTransform(ctx, s, card.key);
      break;
    }
    case 'technique':
      if (P.techs.length < ctx.rules.build.maxTechniques) addTechnique(ctx, card.key);
      else return 'swap';
      break;
    case 'evolve': evolveNow(ctx, k); break;
    case 'heal': healPlayer(ctx, P.maxHp * 0.35); break;
    case 'tag': { const m = P.squad[k]; if (m) m.tagVariant = card.key === '1' ? 1 : 0; break; }
    case 'upgrade': { const s = P.squad[k]?.moves.find((x) => x.key === card.key); if (s) s.level = Math.min(ctx.rules.moves.maxLevel, s.level + 1); break; }
    case 'vitamin': P.vitamins[card.key] = (P.vitamins[card.key] ?? 0) + ctx.rules.vitamins[card.key].add; for (const m of P.squad) recomputeMember(ctx, m); break;
  }
  return 'done';
}

/** the discard choice when a 4th technique is taken: one card per held technique, and "keep" */
export function swapCards(ctx: SimContext, incoming: string): Card[] {
  const T = TECHNIQUE_BY_ID[incoming];
  const cards: Card[] = ctx.player.techs.map((id) => ({ id: 'swap:' + id, kind: 'swap' as const, key: id, group: 'technique' as const, rarity: 'common' as const, title: `Discard ${TECHNIQUE_BY_ID[id].title}`, desc: `Take ${T.title} instead`, tags: TECHNIQUE_BY_ID[id].tags }));
  cards.push({ id: 'swap:keep', kind: 'swap', key: '', group: 'technique', rarity: 'common', title: 'Keep my techniques', desc: `Back to the offer (${T.title} is not taken)`, tags: [] });
  return cards;
}

/** all species that can carry a transform (for docs and tests) */
export function transformCarriers(): string[] {
  return SPECIES.filter((sp) => [...learnsetOf(sp).map(([, k]) => k), sp.starter ?? ''].some((k) => TRANSFORMS_OF[k])).map((s) => s.id);
}
export { capTag };
