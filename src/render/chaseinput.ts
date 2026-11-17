// What the third-person rig (render/camera.ts) is told about the world each frame. Shared by the renderer and the
// headless camera diagnostics (scripts/camstats.ts) so both drive the rig through exactly the same probes.
// Reads the sim, never writes it.
import { TEXELS_PER_METRE } from '../assets/art';
import { ROLE } from '../sim/pools';
import { traversalOf } from '../rules/profiles';
import type { SimContext } from '../sim/types';
import { CHASE_CONFIG, NO_THREAT, type ChaseFrame, type ChaseThreat } from './camera';

/** ground height the lens sees beyond the map edge (m) */
const EDGE_WALL = 60;

/** hostiles near (x, z): nearest, weighted crowd within 12 m, nearest boss */
export function threatOf(ctx: SimContext, x: number, z: number): ChaseThreat {
  const E = ctx.enemies;
  let nearest = Infinity, boss = Infinity, weight = 0;
  for (let i = 0; i < E.hi; i++) {
    if (!E.alive[i]) continue;
    const dx = E.x[i] - x, dz = E.z[i] - z, d2 = dx * dx + dz * dz;
    if (d2 > 900) continue;
    const d = Math.sqrt(d2), r = E.roles[i];
    if (d < nearest) nearest = d;
    if (r & ROLE.boss) { if (d < boss) boss = d; }
    if (d < 12) weight += r & ROLE.boss ? 8 : r & ROLE.alpha ? 4 : r & ROLE.elite ? 3 : 1;
  }
  return nearest === Infinity && boss === Infinity ? NO_THREAT : { nearest, weight, boss };
}

export interface ChaseSubject {
  dt: number;
  /** interpolated feet position of the active Pokémon */
  x: number; y: number; z: number;
  /** drawn idle-frame size of the active Pokémon (m) */
  height: number; width?: number;
  lookPitch: number;
  shake?: [number, number, number];
}

/** The subject size the rig frames (m): the idle reference frame (assets/art.ts `clips.idle.frames[0][0]`, in texels)
 *  times the species' visible-size multiplier (rules/sizing.ts `speciesSizing(...).scale`, the one the sprite is drawn
 *  at). The renderer and the Node diagnostics (scripts/lib/chasesize.ts) both build it here. No frame: 1.1 m. */
export function chaseSubjectSize(f: { w: number; h: number } | undefined, scale: number): { height: number; width: number | undefined } {
  return f ? { height: (f.h / TEXELS_PER_METRE) * scale, width: (f.w / TEXELS_PER_METRE) * scale } : { height: 1.1, width: undefined };
}

/** the rig's input for this frame: the subject plus the world probes (terrain, decks, solid props, threat) */
export function chaseFrameFor(ctx: SimContext, s: ChaseSubject): ChaseFrame {
  const W = ctx.world, wall = W.map.wall, py = s.y;
  return {
    dt: s.dt, x: s.x, y: s.y, z: s.z, height: s.height, width: s.width, flying: traversalOf(ctx.player.species, ctx.rules).air,
    threat: threatOf(ctx, s.x, s.z), lookYaw: 0, lookPitch: s.lookPitch,
    // the floor at the Pokémon's own layer (a deck when it stands on one, the ground under it otherwise); beyond the
    // map edge a wall the lens never enters (a cave's border is raised rock, and nothing out there is meant to be seen
    // from)
    // over open air (a chasm, sim/hazards.ts) the floor is the subject's own height: a fall is not a jump to damp, and the
    // lens stays above the lip rather than dropping into the chasm
    ground: (x, z) => { const k = W.tile(x, z); return k < 0 ? EDGE_WALL : W.isVoid(k) && W.support(x, z, py + 1) === -Infinity ? py : W.height(x, z, py + 1); },
    ceiling: W.over ? (x, z) => W.ceilingAt(x, z, py) : undefined,
    // props (trees, boulders, buildings: billboards that dissolve near the lens) only when CHASE_CONFIG.propsBlockLens
    solid: CHASE_CONFIG.propsBlockLens
      ? (x, y, z) => { const k = W.tile(x, z); return k >= 0 && wall[k] === 1 && y < W.height(x, z) + CHASE_CONFIG.lens.solidTop; }
      : undefined,
    shake: s.shake,
  };
}
