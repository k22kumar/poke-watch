// XP, levels, level-up cards (reroll / skip / banish), vitamins, evolution, pickups, chests.
// XP to next level [C]: round(8 + 5.5*L + L^1.8).

import { dhypot, dpow } from '../core/detmath';
import { ELEMENT_DEFS } from '../rules/elements';
import { MOVE_BY_KEY, MOVES } from '../rules/moves';
import { SPECIES, SPECIES_BY_ID, type SpeciesDef } from '../rules/species';
import type { Rules } from '../rules/defaults';
import { healPlayer } from './combat';
import { compileMove } from './moves';
import { addMember, queueVariant, recruitCards, variantCards, variantDue } from './squad';
import { Player, type Card, type Derived, type Member, type SimContext } from './types';
import { applyBuildCard, applyMastery, buildOn, generateBuildOffer, masteryLevel, masteryOn, notePick, removeTechnique, addTechnique, swapCards } from './build';

export function xpNext(rules: Rules, level: number, endless = false): number {
  const X = rules.xp;
  const v = Math.round(X.base + X.linear * level + dpow(level, X.exponent));
  return endless ? Math.round(v * X.endlessMult) : v;
}

/** recompute every squad member's derived stats (they share the squad level) */
export function recompute(ctx: SimContext) {
  for (const m of ctx.player.squad) recomputeMember(ctx, m);
}

export function recomputeMember(ctx: SimContext, P: Member) {
  const level = ctx.player.level;
  const R = ctx.rules.player;
  const s = P.species.stats;
  const grow = 1 + R.growthPerLevel * (level - 1);
  const v = (k: string) => (P.vitamins[k] ?? 0);
  const d: Derived = {
    maxHp: (R.hpBase + s.hp * R.hpPerStat * grow + level * R.hpPerLevel) * (1 + v('hp')),
    atk: ((s.atk * grow) / R.statRef) * (1 + v('atk')),
    spa: ((s.spa * grow) / R.statRef) * (1 + v('spa')),
    def: s.def * grow * (1 + v('def')),
    speed: R.baseSpeed * (0.85 + s.spe / 300) * (1 + v('spe')),
    haste: 1 + v('haste'),
    area: 1 + v('area'),
    crit: ctx.rules.damage.critChance + v('crit'),
    magnet: R.magnetRadius * (1 + v('magnet')),
  };
  const ratio = P.maxHp > 0 ? P.hp / P.maxHp : 1;
  P.derived = d;
  const oldMax = P.maxHp;
  P.maxHp = d.maxHp;
  P.hp = oldMax > 0 ? Math.min(P.maxHp, P.hp + Math.max(0, P.maxHp - oldMax)) : P.maxHp * ratio;
}

/** a species' level-up moves: the curated partner set, else its cross-game level-up moves */
export function learnsetOf(sp: SpeciesDef): [number, string][] {
  if (sp.learnset?.length) return sp.learnset;
  return (sp.canon?.levelUp ?? []).filter(([, k]) => MOVE_BY_KEY[k]);
}

/** All forms in this line (base first) so evolved creatures keep earlier learnsets. */
export function lineage(sp: SpeciesDef): SpeciesDef[] {
  const out = [sp];
  let cur = sp;
  for (;;) {
    const pre = SPECIES.find((s) => s.evolvesTo === cur.id);
    if (!pre) break;
    out.unshift(pre);
    cur = pre;
  }
  return out;
}

function moveSlots(ctx: SimContext) {
  const R = ctx.rules.player;
  return ctx.player.level >= R.lateSlotLevel ? R.moveSlotsLate : R.moveSlots;
}

function rollRarity(ctx: SimContext, chest: boolean): Card['rarity'] {
  const R = ctx.rules.cards.rarity;
  const r = ctx.rng.cards.next();
  if (r < R.epic * (chest ? 3 : 1)) return 'epic';
  if (r < R.rare * (chest ? 2.5 : 1) || chest) return 'rare';
  return 'common';
}

const LEVEL_STEP: Record<Card['rarity'], number> = { common: 1, rare: 2, epic: 3 };

export function generateCards(ctx: SimContext, chest = false): Card[] {
  if (buildOn(ctx)) {
    // Phase 8b: Kit / Technique / Wildcard (sim/build.ts)
    let cards = generateBuildOffer(ctx);
    for (const f of ctx.hooks.filterCards) cards = f(ctx, cards);
    return cards;
  }
  const P = ctx.player;
  const C = ctx.rules.cards;
  const pool: { card: Card; w: number }[] = [];
  const banished = ctx.cards.banished;
  const slotsFree = P.moves.length < moveSlots(ctx);

  if (slotsFree) {
    const seen = new Set<string>();
    for (const sp of lineage(P.species)) {
      for (const [lv, key] of learnsetOf(sp)) {
        if (seen.has(key)) continue;
        seen.add(key); // future learnset moves never leak in as 'coverage'
        if (lv > P.level || P.learned.has(key) || banished.has(key)) continue;
        pool.push({ card: learnCard(ctx, key), w: C.weights.learn * 2 });
      }
    }
    // coverage: only the line's own other canonical level-up attacks (generated per line), never
    // an arbitrary move of the right type; species without a coverage list get none
    for (const [lv, key] of lineage(P.species).flatMap((s) => s.coverage ?? [])) {
      if (lv > P.level || seen.has(key) || P.learned.has(key) || banished.has(key) || !MOVE_BY_KEY[key]) continue;
      seen.add(key);
      pool.push({ card: learnCard(ctx, key), w: C.weights.learn * 0.2 });
    }
  }
  for (const slot of P.moves) {
    if (slot.level >= ctx.rules.moves.maxLevel || banished.has(slot.key)) continue;
    const rarity = rollRarity(ctx, chest);
    const add = Math.min(LEVEL_STEP[rarity], ctx.rules.moves.maxLevel - slot.level);
    pool.push({
      card: {
        id: slot.key, kind: 'upgrade', key: slot.key, rarity, element: slot.spec.element, archetype: slot.spec.archetype,
        title: slot.spec.name, level: slot.level + add,
        desc: `Lv ${slot.level} → ${slot.level + add}: +${Math.round(ctx.rules.moves.levelDmg * add * 100)}% damage, faster cooldown`,
      },
      w: C.weights.upgrade,
    });
  }
  const held = Object.keys(P.vitamins).filter((k) => P.vitamins[k] > 0);
  for (const [k, v] of Object.entries(ctx.rules.vitamins)) {
    if (banished.has('vit:' + k)) continue;
    if (held.length >= ctx.rules.player.vitaminSlots && !held.includes(k)) continue;
    const rarity = rollRarity(ctx, chest);
    const amt = v.add * C.rarityMult[rarity];
    pool.push({
      card: { id: 'vit:' + k, kind: 'vitamin', key: k, rarity, title: v.label + ' Vitamin', desc: `+${Math.round(amt * 100)}% ${v.label}` },
      w: C.weights.vitamin,
    });
  }
  if (P.hp < P.maxHp * 0.7) {
    const rarity = rollRarity(ctx, chest);
    pool.push({ card: { id: 'heal', kind: 'heal', key: 'heal', rarity, title: 'Sitrus Berry', desc: `Restore ${Math.round(35 * C.rarityMult[rarity])}% HP` }, w: C.weights.heal });
  }

  const out: Card[] = [];
  const used = new Set<string>();
  while (out.length < C.choices && pool.length) {
    const pick = ctx.rng.cards.weighted(pool, (p) => p.w);
    pool.splice(pool.indexOf(pick), 1);
    if (used.has(pick.card.id)) continue;
    used.add(pick.card.id);
    out.push(pick.card);
  }
  let cards = out;
  for (const f of ctx.hooks.filterCards) cards = f(ctx, cards);
  return cards;
}

function learnCard(ctx: SimContext, key: string): Card {
  const spec = compileMove(ctx.rules, key);
  const m = MOVE_BY_KEY[key];
  return {
    id: key, kind: 'learn', key, rarity: 'rare', element: m.element, archetype: spec.archetype, title: m.name, level: 1,
    desc: `New ${ELEMENT_DEFS[m.element].name} move · ${spec.archetype}${m.power ? ' · power ' + m.power : ''}`,
  };
}

export function learnMove(ctx: SimContext, key: string) {
  const P = ctx.player;
  P.moves.push(masteryOn(ctx) ? { key, level: masteryLevel(ctx), cd: 0.3, spec: compileMove(ctx.rules, key), uses: 0 } : { key, level: 1, cd: 0.3, spec: compileMove(ctx.rules, key) });
  P.learned.add(key);
  ctx.events.push({ t: 'learn', key });
}

export function applyCard(ctx: SimContext, card: Card): 'done' | 'swap' | void {
  const P = ctx.player;
  const mult = ctx.rules.cards.rarityMult[card.rarity];
  if (buildOn(ctx) && card.kind !== 'recruit' && card.kind !== 'swap') return applyBuildCard(ctx, card);
  switch (card.kind) {
    case 'learn':
      if (P.moves.length < moveSlots(ctx)) learnMove(ctx, card.key);
      break;
    case 'upgrade': {
      const slot = P.moves.find((m) => m.key === card.key);
      if (slot) slot.level = Math.min(ctx.rules.moves.maxLevel, card.level ?? slot.level + 1);
      break;
    }
    case 'vitamin':
      P.vitamins[card.key] = (P.vitamins[card.key] ?? 0) + ctx.rules.vitamins[card.key].add * mult;
      recompute(ctx);
      break;
    case 'heal':
      healPlayer(ctx, P.maxHp * 0.35 * mult);
      break;
    case 'recruit':
      if (card.key) addMember(ctx, card.key);
      ctx.recruit.pending = null;
      break;
    case 'tag': {
      const m = P.squad[card.member ?? -1];
      if (m) m.tagVariant = card.key === '1' ? 1 : 0;
      break;
    }
  }
}

/** Handle card input while the level-up modal is open. */
export function handleCardInput(ctx: SimContext) {
  const inp = ctx.input.card;
  const offer = ctx.cards.offer;
  if (!inp || !offer) return;
  const C = ctx.cards;
  const special = C.source === 'recruit' || C.source === 'tag' || C.source === 'swap';
  switch (inp.action) {
    case 'pick': {
      const card = offer[inp.index];
      if (!card) return;
      if (C.source === 'swap') { resolveSwap(ctx, card); return; }
      if (applyCard(ctx, card) === 'swap') { openSwap(ctx, card); return; }
      ctx.events.push({ t: 'cardPicked', card });
      closeOffer(ctx, card);
      break;
    }
    case 'reroll':
      if (C.rerolls <= 0 || special) return;
      C.rerolls--;
      C.offer = generateCards(ctx, C.chest);
      ctx.events.push({ t: 'cards', cards: C.offer, chest: C.chest });
      break;
    case 'skip':
      if (C.source === 'swap') { resolveSwap(ctx, offer[offer.length - 1]); return; }
      if (C.source === 'recruit' || C.source === 'tag') {
        // declining a recruit or keeping the Tag Action is free: pick the last card (let it go / keep)
        const last = offer[offer.length - 1];
        applyCard(ctx, last);
        ctx.events.push({ t: 'cardPicked', card: last });
        closeOffer(ctx);
        return;
      }
      if (C.skips <= 0) return;
      C.skips--;
      healPlayer(ctx, ctx.player.maxHp * 0.08);
      ctx.events.push({ t: 'cardPicked', card: null });
      closeOffer(ctx, null);
      break;
    case 'banish': {
      const card = offer[inp.index];
      if (!card || C.banishes <= 0 || special) return;
      C.banishes--;
      C.banished.add(card.id);
      C.offer = generateCards(ctx, C.chest);
      ctx.events.push({ t: 'cards', cards: C.offer, chest: C.chest });
      break;
    }
  }
}

/** Phase 8b: a 4th technique was taken: choose one to discard (or keep yours and go back to the offer) */
function openSwap(ctx: SimContext, card: Card) {
  const C = ctx.cards;
  ctx.build.swap = { tech: card.key, offer: C.offer!, chest: C.chest, source: C.source === 'chest' ? 'chest' : 'level' };
  C.offer = swapCards(ctx, card.key);
  C.source = 'swap';
  ctx.events.push({ t: 'cards', cards: C.offer, chest: false });
}
function resolveSwap(ctx: SimContext, card: Card) {
  const C = ctx.cards, S = ctx.build.swap;
  if (!S) return;
  ctx.build.swap = null;
  if (!card.key) {
    // keep: back to the same offer (no free reroll, the pick is not spent)
    C.offer = S.offer; C.source = S.source; C.chest = S.chest;
    ctx.events.push({ t: 'cards', cards: C.offer, chest: C.chest });
    return;
  }
  removeTechnique(ctx, card.key);
  addTechnique(ctx, S.tech);
  C.source = S.source;
  const taken = S.offer.find((c) => c.kind === 'technique' && c.key === S.tech) ?? null;
  ctx.events.push({ t: 'cardPicked', card: taken });
  closeOffer(ctx, taken, S.offer);
}

function closeOffer(ctx: SimContext, picked: Card | null = null, shown: Card[] | null = ctx.cards.offer) {
  const source = ctx.cards.source;
  if (buildOn(ctx) && (source === 'level' || source === 'chest')) notePick(ctx, shown, picked);
  ctx.cards.offer = null;
  ctx.cards.chest = false;
  ctx.cards.source = 'level';
  if (source === 'level') ctx.player.pendingLevels--;
  maybeOpenCards(ctx);
}

export function openOffer(ctx: SimContext, chest: boolean) {
  const cards = generateCards(ctx, chest);
  if (!cards.length) {
    if (!chest) ctx.player.pendingLevels--;
    return;
  }
  ctx.cards.offer = cards;
  ctx.cards.chest = chest;
  ctx.cards.source = chest ? 'chest' : 'level';
  ctx.events.push({ t: 'cards', cards, chest });
}

/** Open a nonblocking squad offer (recruit or Tag variant). */
function openSpecial(ctx: SimContext, source: 'recruit' | 'tag', cards: Card[]) {
  if (!cards.length) return false;
  ctx.cards.offer = cards;
  ctx.cards.chest = false;
  ctx.cards.source = source;
  ctx.events.push({ t: 'cards', cards, chest: false });
  return true;
}

export function maybeOpenCards(ctx: SimContext) {
  if (ctx.state !== 'play') return;
  const P = ctx.player;
  // benched Pokémon evolve on the bench, without the cinematic
  for (let k = 0; k < P.squad.length; k++) {
    if (k === P.active) continue;
    const m = P.squad[k];
    const bs = m.species;
    if (!m.fainted && bs.evolvesTo && bs.evolveLevel && P.level >= bs.evolveLevel) {
      const first = lineage(bs).length === 1;
      m.species = SPECIES_BY_ID[bs.evolvesTo];
      recomputeMember(ctx, m);
      m.hp = m.maxHp;
      ctx.events.push({ t: 'benchEvolve', from: bs.id, to: m.species.id });
      if (first) queueVariant(ctx, k);
    }
    if (variantDue(ctx, m, m.species)) queueVariant(ctx, k);
  }
  if (variantDue(ctx, P.m, P.species)) queueVariant(ctx, P.active);
  // evolution first
  const sp = P.species;
  if (sp.evolvesTo && sp.evolveLevel && P.level >= sp.evolveLevel) {
    ctx.state = 'evolving';
    ctx.stateTimer = ctx.rules.sim.evolveSeconds;
    ctx.events.push({ t: 'evolveStart', from: sp.id, to: sp.evolvesTo });
    return;
  }
  // squad choices come before level-up cards: a Tag variant, then a recruit
  if (!ctx.cards.offer) {
    while (ctx.recruit.variants.length) {
      const k = ctx.recruit.variants.shift()!;
      if (P.squad[k] && !P.squad[k].tagVariant && openSpecial(ctx, 'tag', variantCards(ctx, k))) return;
    }
    if (ctx.recruit.pending && openSpecial(ctx, 'recruit', recruitCards(ctx))) return;
  }
  if (P.pendingLevels > 0 && !ctx.cards.offer) openOffer(ctx, false);
}

export function finishEvolution(ctx: SimContext) {
  const P = ctx.player;
  if (lineage(P.species).length === 1) queueVariant(ctx, P.active); // first evolution: Tag variant choice
  const next = SPECIES_BY_ID[P.species.evolvesTo!];
  P.species = next;
  recompute(ctx);
  P.hp = P.maxHp; // [C] evolution heals
  ctx.state = 'play';
  ctx.events.push({ t: 'evolveEnd', species: next.id });
  maybeOpenCards(ctx);
}

export function gainXp(ctx: SimContext, v: number) {
  const P = ctx.player;
  P.xp += v;
  ctx.stats.xp += v;
  while (P.xp >= P.xpNext) {
    P.xp -= P.xpNext;
    P.level++;
    P.pendingLevels++;
    P.xpNext = xpNext(ctx.rules, P.level, ctx.rules.mode.endless);
    recompute(ctx);
    applyMastery(ctx);
    ctx.events.push({ t: 'levelUp', level: P.level });
    for (const h of ctx.hooks.onLevelUp) h(ctx);
  }
}

export const pickupSystem = {
  name: 'pickups',
  update(ctx: SimContext, dt: number) {
    const Pk = ctx.pickups;
    const P = ctx.player;
    const mag = P.derived.magnet;
    const pr = ctx.rules.player.pickupRadius;
    const ms = ctx.rules.pickups.magnetSpeed;
    for (let i = 0; i < Pk.hi; i++) {
      if (!Pk.alive[i]) continue;
      Pk.t[i] += dt;
      const dx = P.x - Pk.x[i], dz = P.z - Pk.z[i];
      const d = dhypot(dx, dz);
      if (!Pk.magnet[i] && d < mag && Pk.t[i] > 0.2) Pk.magnet[i] = 1;
      if (Pk.magnet[i]) {
        const sp = ms + Pk.t[i] * 4;
        const step = Math.min(d, sp * dt);
        Pk.x[i] += (dx / (d || 1)) * step;
        Pk.z[i] += (dz / (d || 1)) * step;
        Pk.y[i] += (P.y + 0.5 - Pk.y[i]) * Math.min(1, 8 * dt);
      }
      if (d < pr) {
        const kind = Pk.kind[i];
        if (kind === 0) gainXp(ctx, Pk.value[i]);
        else if (kind === 1) healPlayer(ctx, P.maxHp * 0.2);
        else if (kind === 2) for (let j = 0; j < Pk.hi; j++) if (Pk.alive[j] && Pk.kind[j] === 0) Pk.magnet[j] = 1;
        ctx.events.push({ t: 'pickup', value: Pk.value[i], kind });
        Pk.kill(i);
      }
    }
  },
};

export const progressionSystem = {
  name: 'progression',
  update(ctx: SimContext) {
    const P = ctx.player;
    // chests
    for (const c of ctx.world.chests) {
      if (c.open) continue;
      if (dhypot(P.x - c.x, P.z - c.z) < 1.8) {
        c.open = true;
        ctx.events.push({ t: 'chest', x: c.x, z: c.z });
        if (ctx.state === 'play') { if (ctx.cards.offer) ctx.cards.chestsQueued++; else openOffer(ctx, true); }
      }
    }
    if (ctx.state === 'play' && !ctx.cards.offer && ctx.cards.chestsQueued > 0) { ctx.cards.chestsQueued--; openOffer(ctx, true); }
    if (ctx.state === 'play') maybeOpenCards(ctx);
  },
};

export function makeMember(species: SpeciesDef): Member {
  return {
    species, hp: 1, maxHp: 0, grey: 0, moves: [], vitamins: {}, buffT: 0, buffAtk: 0, buffSpe: 0, paraT: 0,
    trailT: 0, trailSpec: null, trailLevel: 0, trailAcc: 0, regenAcc: 0,
    derived: { maxHp: 1, atk: 1, spa: 1, def: 1, speed: 7, haste: 1, area: 1, crit: 0.05, magnet: 4 },
    learned: new Set(), coat: 0, coatDeep: 0, coatT: 0, fainted: false, tagVariant: 0, flashT: 0, sturdyUsed: false,
  };
}

export function makePlayer(ctx: { rules: Rules }, species: SpeciesDef): Player {
  const P = new Player();
  P.xpNext = xpNext(ctx.rules, 1);
  P.reflex = ctx.rules.combat.reflexCharges;
  P.squad.push(makeMember(species));
  return P;
}
