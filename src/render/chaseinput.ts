// What the third-person rig (render/camera.ts) is told about the world each frame. Shared by the renderer and the
// headless camera diagnostics (scripts/camstats.ts) so both drive the rig through exactly the same probes.
// Reads the sim, never writes it.
import { bodyOf } from '../rules/sizing';
import type { SimContext } from '../sim/types';
import { DECK_SLAB } from '../world/tiles';
import type { ChaseFrame } from './camera';
import { classOutline, type Outline } from './framing';

/** ground height the lens sees beyond the map edge (m) */
const EDGE_WALL = 60;

export interface ChaseSubject {
  dt: number;
  /** interpolated feet position of the active Pokémon (where the renderer draws it this frame) */
  x: number; y: number; z: number;
  lookPitch: number;
  /** the body was on its support at both ends of the span drawn, the previous tick and the latest (default:
   *  ctx.player.pgrounded && grounded); replays of a recorded path pass the recorded flags, since ctx.player is not where
   *  they draw it */
  grounded?: boolean;
  /** the active Pokémon's sprite outline as drawn (render/framing.ts outlineOf: the renderer from its loaded art, the
   *  Node diagnostics from scripts/lib/silhouette.ts). Absent = the fallback for its size class (classOutline) */
  outline?: Outline;
}

/** The size class of the active Pokémon (rules/sizing.ts bodyOf): only the fallback outline reads it, for a subject whose
 *  art is not measured */
export function chaseSubject(ctx: SimContext): { visual: number; height: number } {
  const b = bodyOf(ctx.player.species, ctx.rules.size);
  return { visual: b.visualM, height: b.height };
}

/** the rig's input for this frame: the subject, its outline and the world probes (terrain, decks, bare walls).
 *  Nothing about enemies, combat or the Pokémon's traversal mode reaches the camera */
export function chaseFrameFor(ctx: SimContext, s: ChaseSubject): ChaseFrame {
  const W = ctx.world, wall = W.map.wall, tops = W.wallTop, over = W.over, py = s.y, sub = chaseSubject(ctx);
  return {
    dt: s.dt, x: s.x, y: s.y, z: s.z, ...sub, outline: s.outline ?? classOutline(sub.visual), grounded: s.grounded ?? (ctx.player.pgrounded && ctx.player.grounded), lookYaw: 0, lookPitch: s.lookPitch,
    // the floor at the Pokémon's own layer (a deck when it stands on one, the ground under it otherwise); beyond the
    // map edge a wall the lens never enters (a cave's border is raised rock, and nothing out there is meant to be seen
    // from)
    // over open air (a chasm, sim/hazards.ts) the floor is the subject's own height: a fall is not a jump to damp, and the
    // lens stays above the lip rather than dropping into the chasm
    ground: (x, z) => { const k = W.tile(x, z); return k < 0 ? EDGE_WALL : W.isVoid(k) && W.support(x, z, py + 1) === -Infinity ? py : W.height(x, z, py + 1); },
    ceiling: W.over ? (x, z) => W.ceilingAt(x, z, py) : undefined,
    // bare walls (rock masses, cave walls, sealed ground, the habitats' low ruin walls): solid at every height, as they
    // are for bodies and shots. Wall props (trees, boulders, fences, buildings: a tile with a World.wallTop) never stop
    // the lens: they dissolve around it (render/tilestage.ts; owner decision 2026-11-18, which replaces R1b Q10's "the
    // lens reads wallTop")
    // (a wall with a deck over it ends at the slab's underside, as in sim/spatial.ts: on the deck the rock is below the feet)
    solid: (x, y, z) => {
      const k = W.tile(x, z);
      if (k < 0 || wall[k] !== 1 || (tops && tops[k] !== Infinity)) return false;
      const ov = over ? over[k] : 0;
      return !(ov > 0) || y < ov - DECK_SLAB;
    },
  };
}
