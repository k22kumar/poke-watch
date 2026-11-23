// Swapping (docs/hero-shooter-pivot.md Q10, Q11): an opt-in system a Mode registers (the `swap` Mod, src/mods). With a
// loadout of one it never has anything to do. It owns Tag input (tap: back to the last Pokémon; hold + primary /
// secondary: the first / second reserve), the swap cooldown, the faint replacement (the next Pokémon comes in after a
// moment with a free Tag Action), Tag Actions, and grey health with the bench (refill, cooldowns and timers run there).
import { dexp } from '../core/detmath';
import { MOVE_BY_KEY } from '../rules/moves';
import { tagLineOf, type TagDef } from '../rules/tags';
import { lineage } from '../rules/heroes';
import { spawnBody, TEAM } from './bodies';
import { resolve, setCastSlot } from './capabilities';
import { ARCHETYPES, compileMove, resolveAim, setCastDepth, aimPoint } from './moves';
import { firstAlive } from './squad';
import { BTN, type Member, type MoveSpec, type SimContext, type System } from './types';

/** move slot index stamped on a Tag Action's projectiles and zones (any slot other than 0 coats deep) */
export const TAG_SLOT = 9;

/** the Tag Action a member fires: its line's base or variant move */
export function tagDefOf(m: Member): TagDef | null {
  const line = tagLineOf(lineage(m.species)[0].id) ?? tagLineOf(m.species.id);
  if (!line) return null;
  return line.base;
}

/** the Tag Action as a cast spec: at the flat rules.squad.tagActionLevel (Q26), hitting like a strong manual move */
export function tagSpec(ctx: SimContext, m: Member): MoveSpec | null {
  const def = tagDefOf(m);
  if (!def || !MOVE_BY_KEY[def.move]) return null;
  const s = compileMove(ctx.rules, def.move);
  const R = ctx.rules.squad, M = ctx.rules.moves;
  const L = Math.min(M.maxLevel, R.tagActionLevel) - 1;
  const caps = def.create ? [...(s.caps ?? []), { verb: 'create' as const, template: def.create }] : s.caps;
  return { ...s, dmg: s.dmg * (1 + M.levelDmg * L) * R.tagDmgMult, knock: s.knock * R.tagKnockMult, cd: 0, caps };
}

/** reserves in squad order (not the field Pokémon), fainted ones included */
function reserves(ctx: SimContext): number[] {
  const P = ctx.player;
  const out: number[] = [];
  for (let k = 0; k < P.squad.length; k++) if (k !== P.active) out.push(k);
  return out;
}

function canTag(ctx: SimContext, to: number): boolean {
  const P = ctx.player;
  return ctx.state === 'play' && to >= 0 && to < P.squad.length && to !== P.active && !P.squad[to].fainted
    && P.tagCd <= 0 && P.guardLock <= 0 && P.faintT < 0 && P.dashT <= 0;
}

/** swap the field Pokémon; a free tag (after a faint) skips the cooldown check and does not start it */
function tagTo(ctx: SimContext, to: number, free = false) {
  const P = ctx.player, R = ctx.rules.squad;
  if (!free && !canTag(ctx, to)) return false;
  const from = P.m;
  if (P.guardT >= 0) P.guardT = -1; // Guard ends with the Pokémon that raised it
  P.lastActive = P.active;
  P.active = to;
  P.fieldT = 0;
  P.iframes = Math.max(P.iframes, R.tagInvuln);
  if (!free) P.tagCd = R.tagCooldown;
  P.tagPending = R.tagDelay;
  for (const s of P.m.moves) s.windup = undefined;
  ctx.events.push({ t: 'tag', from: from.species.id, to: P.m.species.id, free });
  return true;
}

/** release the incoming Pokémon's Tag Action toward the aim (or the nearest enemy without aim) */
function castTagAction(ctx: SimContext) {
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
    // Create goes through the resolver (Phase 8a: capped per player, logged)
    resolve(ctx, { verb: 'create', power: 0, type: spec.element, owner: TEAM.player, x, z, dx: 0, dz: 0, source: { kind: 'tag', id: TAG_SLOT, name: spec.name }, target: { kind: 'tile', id: -1 }, template: def.create });
  }
  ctx.events.push({ t: 'tagAction', species: m.species.id, key: spec.key, element: spec.element, x: ax, z: az });
}

export const swapSystem: System = {
  name: 'swap',
  update(ctx: SimContext, dt: number) {
    const P = ctx.player, R = ctx.rules.squad;
    if (P.tagCd > 0) P.tagCd -= dt;

    // a fainted field Pokémon is replaced after a moment, with a free Tag Action
    if (P.faintT >= 0) {
      P.faintT -= dt;
      if (P.faintT < 0) { const next = firstAlive(ctx, P.active); if (next >= 0) tagTo(ctx, next, true); }
    }

    // Tag input: tap swaps to the last Pokémon; hold + primary / secondary fire picks the first / second reserve
    const btn = ctx.input.btn ?? 0;
    const down = (btn & BTN.sig) !== 0;
    if (down && P.squad.length > 1) {
      if (P.tagDownT < 0) { P.tagDownT = 0; P.tagPicked = false; } else P.tagDownT += dt;
      const res = reserves(ctx);
      const edgeA = (btn & BTN.basic) && !(P.tagBtnPrev & BTN.basic), edgeB = (btn & BTN.a) && !(P.tagBtnPrev & BTN.a);
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
      if (m.fainted) continue;
      if (k === P.active) { m.grey *= drain; continue; }
      if (m.grey > 0) { const r = Math.min(m.grey, m.maxHp * R.benchRefill * dt); m.hp = Math.min(m.maxHp, m.hp + r); m.grey -= r; }
      for (const s of m.moves) if (s.cd > 0) s.cd -= dt * R.benchCdRate;
      if (m.paraT > 0) m.paraT -= dt * 2;
      if (m.buffT > 0) m.buffT -= dt;
    }
  },
};
