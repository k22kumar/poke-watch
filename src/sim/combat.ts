// Damage pipeline (PokéBonk order): base x STAB x type effectiveness (x superEffective when > 1)
// x weather x crit x sleep bonus x hooks. Statuses: burn, poison, sleep, root, confuse, chill, stun, knock.

import { dcos, dhypot, dpow, dsin } from '../core/detmath';
import { ELEMENTS, ELEMENT_DEFS, effectiveness, type Ailment, type Element } from '../rules/elements';
import { SPECIES_BY_ID, weightClass } from '../rules/species';
import { ABILITY_IDS, abilityOf } from '../rules/abilities';
import { AG, agentIndex } from '../rules/reactions';
import { ccApply, coatEnemy, shatter } from './coats';
import { maybeOfferRecruit, onHpLoss } from './squad';
import { applyAfterHit, creatureForce } from './capabilities';
import { rec, setSrc, type LogKind } from './caplog';
import { TB } from '../rules/build';
import { guardWeight, onGuardDeflect } from './techniques';

const AB = (id: string) => ABILITY_IDS.indexOf(id) + 1;
const A = { levitate: AB('levitate'), flash: AB('flash_fire'), wabsorb: AB('water_absorb'), dry: AB('dry_skin'), sturdy: AB('sturdy'), magma: AB('magma_armor'), early: AB('early_bird'), vital: AB('vital_spirit'), guts: AB('guts'), swarm: AB('swarm'), stat: AB('static'), spore: AB('effect_spore') };
const PINCH: Record<string, Element> = { overgrow: 'bloom', blaze: 'blaze', torrent: 'tide', swarm: 'hive' };

/** the field Pokémon's ability as an index into ABILITY_IDS (+1; 0 = none) */
export function playerAbility(ctx: SimContext): number {
  const ab = abilityOf(ctx.player.species);
  return ab ? AB(ab) : 0;
}
function abilityPop(ctx: SimContext, name: string) {
  ctx.events.push({ t: 'ability', name, x: ctx.player.x, z: ctx.player.z, enemy: -1 });
}

/** true while the player's pinch ability (Overgrow/Blaze/Torrent) is active */
export function pinchActive(ctx: SimContext): boolean {
  const ab = abilityOf(ctx.player.species);
  return !!ab && !!PINCH[ab] && ctx.player.hp <= ctx.player.maxHp / 3;
}

/** enemy-side attack multiplier from abilities (Guts, Swarm, armed Flash Fire) */
export function enemyAttackMult(ctx: SimContext, e: number): number {
  const E = ctx.enemies, a = E.ability[e];
  let m = 1;
  if (a === A.guts && (E.burn[e] > 0 || E.poison[e] > 0 || E.sleep[e] > 0 || E.chill[e] > 0 || E.confuse[e] > 0 || E.stun[e] > 0)) m *= 1.5;
  if (a === A.swarm && E.hp[e] <= E.maxHp[e] / 3) m *= 1.5;
  if (a === A.flash && E.abilityFlag[e]) m *= 1.5;
  return m;
}
import { ROLE } from './pools';
import type { Hit, SimContext } from './types';

export const AILMENTS: Ailment[] = ['knock', 'burn', 'poison', 'sleep', 'root', 'confuse', 'chill', 'stun'];
export const ailmentIndex = (a: Ailment) => Math.max(0, AILMENTS.indexOf(a));
export const elementIndex = (e: Element) => ELEMENTS.indexOf(e);

export interface DamageSpec {
  element: Element;
  cls: 'physical' | 'special' | 'status';
  ailment: Ailment;
  chance: number;
  knock: number;
  kx: number; // knock direction (unnormalised ok)
  kz: number;
  drain: number;
  source: string;
  /** a contact move (strike, dash, spin, trail): triggers contact abilities */
  contact?: boolean;
  /** Hold Power: pulls targets no heavier than this toward the player instead of knocking them away */
  hold?: number;
  /** coat depth this hit applies with its type's agent: 0 none, 1 light (basic attack), 2 deep (moves A/B, Tag) */
  depth?: number;
  /** Phase 8b: the hit's Push Power (Undertow), Lasso (Hold suspends Light creatures), a root time override (Snare)
   *  and an extra agent it carries (Slipstream) */
  push?: number;
  lasso?: boolean;
  ccT?: number;
  extra?: number;
}

const hit: Hit = { enemy: -1, amount: 0, element: 'plain', cls: 'physical', crit: false, effectiveness: 1, stab: false, source: '' };

export function enemyElements(ctx: SimContext, e: number) {
  return ctx.speciesIndex[ctx.enemies.species[e]].elements;
}

/** Applies a player-side hit to enemy e. Returns damage dealt. */
export function damageEnemy(ctx: SimContext, e: number, base: number, spec: DamageSpec): number {
  const E = ctx.enemies;
  if (!E.alive[e] || E.spawnT[e] < 0.25) return 0;
  const R = ctx.rules.damage;
  const P = ctx.player;
  const d = P.derived;
  let amount = base * R.playerMult * (spec.cls === 'physical' ? d.atk : d.spa) * (P.buffT > 0 ? 1 + P.buffAtk : 1);
  const stab = P.species.elements.includes(spec.element);
  if (stab) amount *= P.species.ability === 'adaptive' ? R.stabAdaptive : R.stab;
  // player ability: Overgrow / Blaze / Torrent (canonical x1.5 for the matching type at <= 1/3 HP)
  { const ab = abilityOf(P.species); if (ab && PINCH[ab] === spec.element && P.hp <= P.maxHp / 3) amount *= 1.5; }
  // armed Flash Fire: its Fire moves hit x1.5; Guts: contact moves x1.5 while coated or paralysed
  if (P.m.flashT > 0 && spec.element === 'blaze') amount *= 1.5;
  if (spec.contact && (P.m.coat || P.m.paraT > 0) && abilityOf(P.species) === 'guts') amount *= 1.5;
  // enemy abilities that absorb or ignore the hit
  const ea = E.ability[e];
  if ((ea === A.levitate && spec.element === 'quake') || (ea === A.flash && spec.element === 'blaze')) {
    if (ea === A.flash && !E.abilityFlag[e]) { E.abilityFlag[e] = 1; ctx.events.push({ t: 'ability', name: 'Flash Fire', x: E.x[e], z: E.z[e], enemy: e }); }
    else if (ea === A.levitate && ctx.rng.combat.next() < 0.1) ctx.events.push({ t: 'ability', name: 'Levitate', x: E.x[e], z: E.z[e], enemy: e });
    ctx.events.push({ t: 'hit', x: E.x[e], y: E.y[e] + E.size[e], z: E.z[e], amount: 0, crit: false, eff: 0, element: spec.element, enemy: e });
    return 0;
  }
  if ((ea === A.wabsorb || ea === A.dry) && spec.element === 'tide') {
    const before = E.hp[e];
    E.hp[e] = Math.min(E.maxHp[e], E.hp[e] + E.maxHp[e] * 0.25);
    if (E.hp[e] > before + 0.5 && ctx.rng.combat.next() < 0.25) ctx.events.push({ t: 'ability', name: ea === A.dry ? 'Dry Skin' : 'Water Absorb', x: E.x[e], z: E.z[e], enemy: e });
    return 0;
  }
  if (ea === A.dry && spec.element === 'blaze') amount *= 1.25;
  // contact abilities that affect the player (Static, Effect Spore): paralysis = half speed
  if ((ea === A.stat || ea === A.spore) && spec.contact && P.paraT <= 0 && ctx.rng.combat.next() < 0.3) {
    P.paraT = 1.5;
    ctx.events.push({ t: 'ability', name: ea === A.stat ? 'Static' : 'Effect Spore', x: E.x[e], z: E.z[e], enemy: e });
  }
  const eff = effectiveness(ctx.chart, spec.element, enemyElements(ctx, e));
  amount *= eff;
  // coats: Fire into a Soaked creature is damped; a physical hit shatters a frozen one
  if (E.coat[e] === AG.wet && spec.element === 'blaze') amount *= ctx.rules.reactions.soakedFire;
  if (spec.cls === 'physical' && E.frozen[e] > 0) amount *= shatter(ctx, e);
  if (eff > 1) amount *= R.superEffectiveBonus;
  if (ctx.weather.element) {
    if (ctx.weather.element === spec.element) amount *= R.weatherBoost;
  }
  const crit = ctx.rng.combat.next() < d.crit;
  if (crit) amount *= R.critMult;
  if (E.sleep[e] > 0) {
    amount *= R.sleepBonus;
    E.sleep[e] = 0; // wakes up
  }

  hit.enemy = e; hit.amount = amount; hit.element = spec.element; hit.cls = spec.cls;
  hit.crit = crit; hit.effectiveness = eff; hit.stab = stab; hit.source = spec.source;
  for (const h of ctx.hooks.modifyDamage) h(ctx, hit);
  amount = Math.max(0, hit.amount);

  // Sturdy: survive one lethal hit at 1 HP from full health
  if (ea === A.sturdy && !E.abilityFlag[e] && E.hp[e] >= E.maxHp[e] - 0.01 && amount >= E.hp[e]) {
    amount = E.hp[e] - 1; E.abilityFlag[e] = 1;
    ctx.events.push({ t: 'ability', name: 'Sturdy', x: E.x[e], z: E.z[e], enemy: e });
  }
  E.hp[e] -= amount;
  E.flash[e] = 0.12;
  ctx.stats.damageDealt += amount;
  if (amount > ctx.stats.maxHit) ctx.stats.maxHit = amount;

  // a Bulwark's shield breaks for 4 s under a Fighting blow, a hold, or a shove strong enough to move it
  if (E.roles[e] & ROLE.shielder && E.guardDown[e] <= 0 && ((spec.element === 'brawl' && spec.cls === 'physical') || spec.hold || spec.knock >= 8)) {
    E.guardDown[e] = ctx.rules.roles.bulwarkBreak;
    ctx.events.push({ t: 'ability', name: 'Guard broken', x: E.x[e], z: E.z[e], enemy: e });
  }
  // knockback (bosses mostly ignore it) or a Hold that reels it in: the shared creature force rule
  creatureForce(ctx, e, spec);
  // status roll
  if (spec.chance > 0 && spec.ailment !== 'knock' && ctx.rng.combat.next() < spec.chance) applyAilment(ctx, e, spec.ailment, amount, spec.ccT);

  if (spec.drain > 0) healPlayer(ctx, amount * spec.drain);

  ctx.events.push({ t: 'hit', x: E.x[e], y: E.y[e] + E.size[e], z: E.z[e], amount, crit, eff, element: spec.element, enemy: e });
  if (E.hp[e] <= 0) { killEnemy(ctx, e); return amount; }
  // the hit's agent coats the creature, or reacts with the coat it already carries
  if (spec.depth) coatEnemy(ctx, e, agentIndex(spec.element), spec.depth, amount, true);
  // Phase 8b: Undertow (your Pushes also Apply Wet) and Slipstream (the next Move carries a copied coat)
  if (spec.depth && spec.push && E.alive[e] && ctx.player.techMask & TB.undertow) applyAfterHit(ctx, e, AG.wet, spec.depth, amount, 'Undertow');
  if (spec.extra && E.alive[e]) applyAfterHit(ctx, e, spec.extra, 2, amount, 'Slipstream');
  return amount;
}

export function applyAilment(ctx: SimContext, e: number, a: Ailment, hitAmount: number, rootT?: number) {
  const E = ctx.enemies;
  const T = ctx.rules.damage.statusTime;
  const bossy = E.roles[e] & (ROLE.boss | ROLE.alpha) ? 0.3 : 1;
  switch (a) {
    case 'burn': E.burn[e] = T.burn; E.dot[e] = Math.max(E.dot[e], hitAmount * ctx.rules.damage.burnDps * 10); break;
    case 'poison': E.poison[e] = T.poison; E.dot[e] = Math.max(E.dot[e], hitAmount * ctx.rules.damage.poisonDps * 10); break;
    case 'sleep': if (E.ability[e] === A.vital) break; E.sleep[e] = T.sleep * bossy * (E.ability[e] === A.early ? 0.5 : 1); break;
    case 'root': E.root[e] = Math.max(E.root[e], ccApply(ctx, e, (rootT ?? T.root) * bossy)); break;
    case 'confuse': E.confuse[e] = T.confuse * bossy; break;
    case 'chill': if (E.ability[e] === A.magma) break; E.chill[e] = T.chill; break;
    case 'stun': E.stun[e] = Math.max(E.stun[e], ccApply(ctx, e, T.stun * bossy)); break;
  }
}

export function healPlayer(ctx: SimContext, amount: number) {
  const P = ctx.player;
  const before = P.hp;
  P.hp = Math.min(P.maxHp, P.hp + amount);
  if (P.hp - before > 0.5) ctx.events.push({ t: 'heal', amount: P.hp - before });
}

export function killEnemy(ctx: SimContext, e: number) {
  const E = ctx.enemies;
  if (!E.alive[e]) return;
  const sp = ctx.speciesIndex[E.species[e]];
  ctx.stats.kills++;
  ctx.events.push({ t: 'kill', x: E.x[e], y: E.y[e], z: E.z[e], species: E.species[e], roles: E.roles[e], element: sp.elements[0] });
  for (const h of ctx.hooks.onKill) h(ctx, e);
  // xp drop
  dropXp(ctx, E.x[e], E.z[e], E.xp[e], E.roles[e]);
  if (E.roles[e] & ROLE.boss) {
    ctx.stats.bosses++;
    ctx.director.bossDead = true;
    ctx.director.bossIndex = -1;
    ctx.events.push({ t: 'bossDead', species: sp.id, x: E.x[e], z: E.z[e] });
    ctx.events.push({ t: 'hitstop', dur: ctx.rules.feel.hitstopBossKill });
    ctx.events.push({ t: 'shake', amount: 1, x: E.x[e], z: E.z[e] });
    ctx.projectiles.clearHostile();
    const [px, pz] = ctx.world.walkable(E.x[e], E.z[e]) ? [E.x[e], E.z[e]] : ctx.world.nearestWalkable(E.x[e], E.z[e]);
    ctx.portal = { active: true, x: px, z: pz };
    ctx.events.push({ t: 'portal', x: E.x[e], z: E.z[e] });
  } else if (E.roles[e] & (ROLE.elite | ROLE.alpha)) {
    ctx.events.push({ t: 'hitstop', dur: ctx.rules.feel.hitstopKillBig });
    maybeOfferRecruit(ctx);
  }
  E.kill(e);
}

export function dropXp(ctx: SimContext, x: number, z: number, value: number, roles: number) {
  const Pk = ctx.pickups;
  const big = roles & (ROLE.elite | ROLE.alpha | ROLE.boss);
  const pieces = roles & ROLE.boss ? 12 : roles & ROLE.alpha ? 6 : big ? 3 : 1;
  for (let k = 0; k < pieces; k++) {
    const v = value / pieces;
    // merge when the floor is crowded [C] (> 260 gems)
    if (Pk.count > ctx.rules.pickups.mergeThreshold) {
      let best = -1, bd = 1e9;
      const start = (ctx.tick * 7) % Math.max(1, Pk.hi);
      for (let s = 0; s < Math.min(Pk.hi, 64); s++) {
        const j = (start + s) % Pk.hi;
        if (!Pk.alive[j] || Pk.kind[j] !== 0) continue;
        const d = Math.abs(Pk.x[j] - x) + Math.abs(Pk.z[j] - z);
        if (d < bd) { bd = d; best = j; }
      }
      if (best >= 0) { Pk.value[best] += v; continue; }
    }
    const i = Pk.spawn();
    if (i < 0) return;
    const a = ctx.rng.combat.range(0, Math.PI * 2), r = pieces > 1 ? ctx.rng.combat.range(0.3, 2.2) : 0;
    Pk.x[i] = x + dcos(a) * r;
    Pk.z[i] = z + dsin(a) * r;
    Pk.y[i] = ctx.world.height(Pk.x[i], Pk.z[i]);
    Pk.value[i] = v;
    Pk.kind[i] = 0;
  }
  // occasional heal / magnet drops
  if (ctx.rng.combat.next() < (big ? 0.25 : ctx.rules.pickups.healChance)) {
    const i = Pk.spawn();
    if (i >= 0) {
      Pk.x[i] = x + 0.8; Pk.z[i] = z; Pk.y[i] = ctx.world.height(x + 0.8, z);
      Pk.kind[i] = big && ctx.rng.combat.next() < 0.4 ? 2 : 1; Pk.value[i] = 0;
    }
  }
}

/** Damage to the player from enemies / hostile projectiles / boss attacks.
 *  `weight` is the attacker's weight class: a Guard deflect window parries attacks no heavier than the
 *  player's own class; Brace halves damage and cancels knockback. Returns 'parry' | 'brace' | 'hit' | 'none'. */
export function damagePlayer(ctx: SimContext, raw: number, fromX: number, fromZ: number, knockMult = 1, weight = 1, element?: Element, src?: HurtSrc): 'parry' | 'brace' | 'hit' | 'none' {
  const P = ctx.player;
  if (P.iframes > 0 || P.dashT > 0 || ctx.state !== 'play') return 'none';
  let eff = 1;
  // the field Pokémon's own ability can ignore, absorb or blunt the hit (blueprint section 7)
  const pa = playerAbility(ctx);
  if (element) {
    if (pa === A.levitate && element === 'quake') { abilityPop(ctx, 'Levitate'); return 'none'; }
    if (pa === A.flash && element === 'blaze') {
      if (P.m.flashT <= 0) abilityPop(ctx, 'Flash Fire');
      P.m.flashT = ctx.rules.combat.flashFireTime; P.iframes = Math.max(P.iframes, 0.2);
      return 'none';
    }
    if ((pa === A.wabsorb || pa === A.dry) && element === 'tide') {
      abilityPop(ctx, pa === A.wabsorb ? 'Water Absorb' : 'Dry Skin');
      healPlayer(ctx, Math.min(P.maxHp * 0.25, raw * 0.5)); P.iframes = Math.max(P.iframes, 0.2);
      return 'none';
    }
    if (pa === A.dry && element === 'blaze') raw *= 1.25;
    // the type chart, softened: a weakness hurts x1.41, a resist x0.71 (rules.combat.incomingTypeExp)
    eff = effectiveness(ctx.chart, element, P.species.elements);
    raw *= dpow(eff, ctx.rules.combat.incomingTypeExp);
  }
  const G = ctx.rules.combat;
  if (P.guardT >= 0) {
    if (P.guardT <= G.guardWindow && weight <= guardWeight(ctx)) {
      P.guardHit = true;
      onGuardDeflect(ctx);
      ctx.events.push({ t: 'parry', x: P.x, z: P.z, enemy: -1 });
      ctx.events.push({ t: 'hitstop', dur: 0.05 });
      logHurt(ctx, 'parry', 0, eff, weight, element, src, fromX, fromZ);
      return 'parry';
    }
    raw *= G.braceMult;
    knockMult = 0;
    ctx.events.push({ t: 'brace', x: P.x, z: P.z, amount: raw });
  }
  const R = ctx.rules.player;
  let amt = raw * ctx.rules.mode.difficulty * (R.defenseRef / (R.defenseRef + P.derived.def));
  // Sturdy: once per region, a hit from full health leaves it at 1 HP
  if (pa === A.sturdy && !P.m.sturdyUsed && P.hp >= P.maxHp - 0.01 && amt >= P.hp) { amt = P.hp - 1; P.m.sturdyUsed = true; abilityPop(ctx, 'Sturdy'); }
  logHurt(ctx, P.guardT >= 0 ? 'brace' : 'hit', amt, eff, weight, element, src, fromX, fromZ);
  P.hp -= amt;
  P.iframes = R.iframes;
  P.hurtFlash = 0.25;
  ctx.stats.damageTaken += amt;
  const dx = P.x - fromX, dz = P.z - fromZ, L = dhypot(dx, dz) || 1;
  if (P.techMask & TB.heavy) knockMult *= ctx.rules.build.tech.heavyFooting.knock;
  P.kx += (dx / L) * R.knockback * knockMult;
  P.kz += (dz / L) * R.knockback * knockMult;
  ctx.events.push({ t: 'playerHurt', amount: amt, x: P.x, z: P.z });
  ctx.events.push({ t: 'shake', amount: ctx.rules.feel.shakePlayerHurt, x: P.x, z: P.z });
  ctx.events.push({ t: 'hitstop', dur: ctx.rules.feel.hitstopPlayerHurt });
  if (P.hp <= 0) P.hp = 0;
  onHpLoss(ctx, amt);
  return P.guardT >= 0 ? 'brace' : 'hit';
}

/** what hurt the player, for the death recap */
export interface HurtSrc { kind: LogKind; name: string }

function logHurt(ctx: SimContext, out: 'parry' | 'brace' | 'hit', amt: number, eff: number, weight: number, element: Element | undefined, src: HurtSrc | undefined, x: number, z: number) {
  setSrc(src?.kind ?? '', src?.name ?? '');
  const r = rec(ctx, 'hit', out, true);
  if (!r) return;
  r.amount = amt; r.eff = eff; r.srcW = weight; r.type = element ?? 'plain'; r.tgt = 'player'; r.tgtName = ctx.player.species.name; r.x = x; r.z = z;
}

export function elementName(e: Element) {
  return ELEMENT_DEFS[e].name;
}
export { SPECIES_BY_ID };
