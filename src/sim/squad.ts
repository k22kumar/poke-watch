// Squad and Tag (blueprint section 6, Phase 6).
//
// Three Pokémon, one on the field. Tag (Q / Y) swaps the field Pokémon; the incoming one arrives where the
// outgoing one stood, invulnerable for 0.15 s, and 0.2 s later fires its Tag Action toward the aim point.
// A tap swaps back to the last Pokémon; holding Tag and pressing Move A or Move B picks the first or the
// second reserve. One squad-wide cooldown (4 s) limits how often you can switch, and Reflex charges
// belong to the trainer, so switching never refills Dash or Guard.
//
// Benched Pokémon rest: their cooldowns keep ticking, grey health (part of each recent hit) refills, and
// their coats and paralysis wear off twice as fast. They give no passive bonuses and take no actions.
// A fainted Pokémon is replaced automatically (with a free Tag Action); the run ends when all three faint.

import { dexp } from '../core/detmath';
import { MOVE_BY_KEY } from '../rules/moves';
import { SPECIES_BY_ID, type SpeciesDef } from '../rules/species';
import { STAGES } from '../rules/stages';
import { TAG_ACTIONS, type TagDef } from '../rules/tags';
import { spawnBody, TEAM } from './bodies';
import { resolve, setCastSlot } from './capabilities';
import { buildRecap, rec, setSrc } from './caplog';
import { ARCHETYPES, compileMove, resolveAim, setCastDepth, aimPoint } from './moves';
import { learnsetOf, lineage, makeMember, recomputeMember } from './progression';
import { BTN, type Card, type Member, type MoveSpec, type SimContext } from './types';
import { TB } from '../rules/build';
import { logTech, techSpec } from './techniques';
import { applyMastery } from './build';

/** move slot index stamped on a Tag Action's projectiles and zones (any slot other than 0 coats deep) */
export const TAG_SLOT = 9;

/** the Tag Action a member fires: its line's base or variant move */
export function tagDefOf(m: Member): TagDef | null {
  const line = TAG_ACTIONS[lineage(m.species)[0].id] ?? TAG_ACTIONS[m.species.id];
  if (!line) return null;
  return m.tagVariant ? line.variant : line.base;
}

/** the Tag Action as a cast spec: scaled with squad level and hitting like a strong manual move */
export function tagSpec(ctx: SimContext, m: Member): MoveSpec | null {
  const def = tagDefOf(m);
  if (!def || !MOVE_BY_KEY[def.move]) return null;
  const s = compileMove(ctx.rules, def.move);
  const R = ctx.rules.squad, M = ctx.rules.moves;
  const L = Math.min(M.maxLevel, 1 + Math.floor(ctx.player.level / 5)) - 1;
  const caps = def.create ? [...(s.caps ?? []), { verb: 'create' as const, template: def.create }] : s.caps;
  return techSpec(ctx, { ...s, dmg: s.dmg * (1 + M.levelDmg * L) * R.tagDmgMult, knock: s.knock * R.tagKnockMult, cd: 0, caps });
}

/** reserves in squad order (not the field Pokémon), fainted ones included */
export function reserves(ctx: SimContext): number[] {
  const P = ctx.player;
  const out: number[] = [];
  for (let k = 0; k < P.squad.length; k++) if (k !== P.active) out.push(k);
  return out;
}

function firstAlive(ctx: SimContext, except: number): number {
  const P = ctx.player;
  for (let k = 0; k < P.squad.length; k++) if (k !== except && !P.squad[k].fainted) return k;
  return -1;
}

export function canTag(ctx: SimContext, to: number): boolean {
  const P = ctx.player;
  return ctx.state === 'play' && to >= 0 && to < P.squad.length && to !== P.active && !P.squad[to].fainted
    && P.tagCd <= 0 && P.guardLock <= 0 && P.faintT < 0 && P.dashT <= 0;
}

/** swap the field Pokémon; a free tag (after a faint) skips the cooldown check and does not start it */
export function tagTo(ctx: SimContext, to: number, free = false) {
  const P = ctx.player, R = ctx.rules.squad;
  if (!free && !canTag(ctx, to)) return false;
  const from = P.m;
  if (P.guardT >= 0) P.guardT = -1; // Guard ends with the Pokémon that raised it
  P.lastActive = P.active;
  P.active = to;
  P.fieldT = 0;
  P.iframes = Math.max(P.iframes, R.tagInvuln);
  const secondWind = (P.techMask & TB.secondWind) !== 0;
  if (!free) P.tagCd = secondWind ? ctx.rules.build.tech.secondWind.tagCooldown : R.tagCooldown;
  // Second Wind: the incoming Pokémon arrives clean
  if (secondWind && P.m.coat) { P.m.coat = 0; P.m.coatDeep = 0; P.m.coatT = 0; logTech(ctx, 'second_wind', 'coat cleared', P.x, P.z); }
  P.tagPending = R.tagDelay;
  for (const s of P.m.moves) s.windup = undefined;
  ctx.events.push({ t: 'tag', from: from.species.id, to: P.m.species.id, free });
  return true;
}

/** release the incoming Pokémon's Tag Action toward the aim (or the nearest enemy without aim) */
export function castTagAction(ctx: SimContext) {
  const P = ctx.player;
  const m = P.m;
  if (m.fainted) return;
  const spec = tagSpec(ctx, m);
  if (!spec) return;
  const impl = ARCHETYPES[spec.archetype];
  if (!impl) return;
  setCastDepth(2);
  setCastSlot(TAG_SLOT);
  const aimed = resolveAim(ctx, spec, true, false);
  if (aimed) impl.cast(ctx, spec, TAG_SLOT);
  setCastDepth(1);
  setCastSlot(-1);
  const [ax, az] = aimPoint();
  const def = tagDefOf(m)!;
  if (def.create === 'rock') {
    const [x, z] = ctx.world.walkable(ax, az) ? [ax, az] : ctx.world.nearestWalkable(ax, az);
    // Create goes through the resolver (Phase 8a: capped per player, logged); v10 spawned the rock directly
    if (ctx.rules.caps.enabled) resolve(ctx, { verb: 'create', power: 0, type: spec.element, owner: TEAM.player, x, z, dx: 0, dz: 0, source: { kind: 'tag', id: TAG_SLOT, name: spec.name }, target: { kind: 'tile', id: -1 }, template: def.create });
    else spawnBody(ctx, 'rock', x, z, 0, 0, TEAM.neutral);
  }
  ctx.events.push({ t: 'tagAction', species: m.species.id, key: spec.key, element: spec.element, x: ax, z: az });
}

/** health lost by the field Pokémon: part of it becomes grey; at zero it faints. Returns true if the run ended. */
export function onHpLoss(ctx: SimContext, amt: number): boolean {
  const P = ctx.player, m = P.m, R = ctx.rules.squad;
  if (m.fainted) return false;
  if (m.hp > 0) { m.grey = Math.min(m.maxHp - m.hp, m.grey + amt * R.greyShare); return false; }
  return faint(ctx);
}

/** the field Pokémon faints: the next one comes in after a moment, or the run ends */
export function faint(ctx: SimContext): boolean {
  const P = ctx.player, m = P.m, R = ctx.rules.squad;
  m.hp = 0; m.grey = 0; m.fainted = true; m.coat = 0; m.coatDeep = 0; m.coatT = 0; m.paraT = 0;
  const next = firstAlive(ctx, P.active);
  setSrc('player', m.species.name);
  const r = rec(ctx, 'faint', 'none', true);
  if (r) { r.tgt = 'player'; r.tgtName = m.species.name; r.x = P.x; r.z = P.z; }
  if (next < 0) {
    // the death recap: which rules decided the last few seconds (blueprint section 10)
    if (ctx.rules.caps.enabled) ctx.recap = buildRecap(ctx.caplog, ctx.time, ctx.rules.caps.recapSeconds);
    ctx.events.push({ t: 'faint', species: m.species.id, out: true });
    ctx.state = 'dead';
    ctx.stateTimer = ctx.rules.sim.deathSlowmoSeconds;
    ctx.events.push({ t: 'death' });
    return true;
  }
  ctx.events.push({ t: 'faint', species: m.species.id, out: false });
  P.faintT = R.faintDelay;
  P.iframes = Math.max(P.iframes, R.faintDelay + 0.3);
  P.tagPending = -1;
  return false;
}

/** at the next region's portal, fainted Pokémon come back */
export function reviveFainted(ctx: SimContext) {
  const P = ctx.player, R = ctx.rules.squad;
  for (const m of P.squad) if (m.fainted) { m.fainted = false; m.hp = m.maxHp * R.reviveHp; m.grey = 0; }
}

// ------------------------------------------------------------------ recruiting
/** add a Pokémon to the squad at the squad's level, with its first moves */
export function addMember(ctx: SimContext, id: string): Member | null {
  const P = ctx.player;
  const sp = SPECIES_BY_ID[id];
  if (!sp || P.squad.length >= ctx.rules.squad.max) return null;
  const m = makeMember(sp);
  P.squad.push(m);
  recomputeMember(ctx, m);
  m.hp = m.maxHp;
  // its first two attacks from its HGSS level-up moves, the earliest first (it becomes the basic attack)
  const keys = learnsetOf(sp).filter(([lv, k]) => lv <= Math.max(P.level, 1) && MOVE_BY_KEY[k] && MOVE_BY_KEY[k].cls !== 'status').map(([, k]) => k);
  const moveKeys = [...new Set(keys)].slice(0, 2);
  if (!moveKeys.length) { const any = learnsetOf(sp).find(([, k]) => MOVE_BY_KEY[k] && MOVE_BY_KEY[k].cls !== 'status'); if (any) moveKeys.push(any[1]); }
  for (const k of moveKeys) { m.moves.push({ key: k, level: 1, cd: 0.3, spec: compileMove(ctx.rules, k), uses: 0 }); m.learned.add(k); }
  applyMastery(ctx); // Phase 8b: recruits' moves follow the squad level too
  ctx.events.push({ t: 'recruit', species: id });
  return m;
}

/** an elite went down: offer a recruit when the squad has room and the run is far enough along */
export function maybeOfferRecruit(ctx: SimContext) {
  const P = ctx.player, R = ctx.rules.squad, Q = ctx.recruit;
  if (ctx.rules.objectives.enabled) return; // the Hunt objective pays recruits (sim/objectives.ts)
  if (Q.pending || P.squad.length >= R.max) return;
  const after = R.recruitAfter[Math.min(Q.offered, R.recruitAfter.length - 1)];
  if (ctx.time < after) return;
  const table = STAGES[ctx.stage % STAGES.length];
  const have = new Set(P.squad.map((m) => lineage(m.species)[0].id));
  const pool = [...new Set(table.spawns.map(([id]) => id))].filter((id) => !have.has(id) && SPECIES_BY_ID[id] && TAG_ACTIONS[id]);
  if (!pool.length) return;
  const picks: string[] = [];
  const bag = [...pool];
  while (picks.length < 2 && bag.length) picks.push(bag.splice(ctx.rng.cards.int(0, bag.length - 1), 1)[0]);
  Q.pending = picks;
  Q.offered++;
}

export function recruitCards(ctx: SimContext): Card[] {
  const ids = ctx.recruit.pending ?? [];
  const cards: Card[] = ids.map((id) => {
    const sp = SPECIES_BY_ID[id];
    return { id: 'recruit:' + id, kind: 'recruit', key: id, rarity: 'rare', element: sp.elements[0], title: sp.name, desc: `Join your squad` };
  });
  cards.push({ id: 'recruit:none', kind: 'recruit', key: '', rarity: 'common', title: 'Let it go', desc: 'Keep the squad as it is' });
  return cards;
}

/** the two Tag Action choices for member k */
export function variantCards(ctx: SimContext, k: number): Card[] {
  const m = ctx.player.squad[k];
  const line = TAG_ACTIONS[lineage(m.species)[0].id];
  if (!line) return [];
  const mk = (def: TagDef, v: number): Card => {
    const md = MOVE_BY_KEY[def.move];
    return { id: `tag:${k}:${v}`, kind: 'tag', key: String(v), member: k, rarity: v ? 'epic' : 'common', element: md.element, title: md.name, desc: v ? `New Tag Action for ${m.species.name}` : `Keep ${m.species.name}'s Tag Action` };
  };
  return [mk(line.variant, 1), mk(line.base, 0)];
}

/** a member reached its first evolution (or the variant level): queue its Tag variant choice */
export function queueVariant(ctx: SimContext, k: number) {
  if (!ctx.recruit.variants.includes(k)) ctx.recruit.variants.push(k);
}

export function variantDue(ctx: SimContext, m: Member, sp: SpeciesDef) {
  return !m.tagVariant && !sp.evolvesTo && !lineage(sp).some((s) => s.evolvesTo) && ctx.player.level >= ctx.rules.squad.variantLevel;
}

// ------------------------------------------------------------------ the system
export const squadSystem = {
  name: 'squad',
  update(ctx: SimContext, dt: number) {
    const P = ctx.player, R = ctx.rules.squad;
    if (P.tagCd > 0) P.tagCd -= dt;
    P.fieldT += dt;

    // a fainted field Pokémon is replaced after a moment, with a free Tag Action
    if (P.faintT >= 0) {
      P.faintT -= dt;
      if (P.faintT < 0) { const next = firstAlive(ctx, P.active); if (next >= 0) tagTo(ctx, next, true); }
    }

    // Tag input: tap swaps to the last Pokémon; hold + Move A / Move B picks the first / second reserve
    const btn = ctx.input.btn ?? 0;
    const down = (btn & BTN.sig) !== 0;
    if (down && P.squad.length > 1) {
      if (P.tagDownT < 0) { P.tagDownT = 0; P.tagPicked = false; } else P.tagDownT += dt;
      const res = reserves(ctx);
      const edgeA = (btn & BTN.a) && !(P.tagBtnPrev & BTN.a), edgeB = (btn & BTN.b) && !(P.tagBtnPrev & BTN.b);
      if (edgeA || edgeB) { P.tagPicked = true; const to = edgeA ? res[0] : res[1]; if (to !== undefined) tagTo(ctx, to); }
    } else if (P.tagDownT >= 0) {
      if (!P.tagPicked && P.tagDownT < R.holdPick) {
        const back = P.lastActive >= 0 && P.lastActive < P.squad.length && !P.squad[P.lastActive].fainted && P.lastActive !== P.active ? P.lastActive : firstAlive(ctx, P.active);
        tagTo(ctx, back);
      }
      P.tagDownT = -1;
    }
    P.tagBtnPrev = btn;

    // the Tag Action releases a moment after the Pokémon arrives
    if (P.tagPending >= 0) {
      P.tagPending -= dt;
      if (P.tagPending < 0) castTagAction(ctx);
    }

    // grey health and resting on the bench
    const drain = dexp((-dt * Math.LN2) / R.greyHalfLife);
    for (let k = 0; k < P.squad.length; k++) {
      const m = P.squad[k];
      if (m.flashT > 0) m.flashT -= dt;
      if (m.fainted) continue;
      if (k === P.active) { m.grey *= drain; continue; }
      if (m.grey > 0) { const r = Math.min(m.grey, m.maxHp * R.benchRefill * dt); m.hp = Math.min(m.maxHp, m.hp + r); m.grey -= r; }
      for (const s of m.moves) if (s.cd > 0) s.cd -= dt * R.benchCdRate;
      if (m.paraT > 0) m.paraT -= dt * 2;
      if (m.buffT > 0) m.buffT -= dt;
    }
  },
};
