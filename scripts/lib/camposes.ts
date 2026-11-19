// Tight camera poses on real maps, for the aim and framing checks (scripts/camaim.ts, tests/camaim.test.ts): a walkable
// tile with solid rock (a bare wall, or a rise of 2 m or more) right behind the view, on its right, or both, a tile under
// a deck, and a 0.5 m tile step to walk across. The same search the browser scenes use (tools/camframescenes.gen.mjs).
import type { SimContext } from '../../src/sim/types';

export interface Pose { name: string; x: number; z: number; yaw: number }

/** put the trainer on a pose (feet on the ground there, at rest) */
export function place(ctx: SimContext, p: Pose) {
  const P = ctx.player, W = ctx.world;
  P.x = P.px = p.x; P.z = P.pz = p.z; P.y = P.py = W.height(p.x, p.z, p.name === 'deck' ? 0 : undefined);
  P.vx = P.vz = P.vy = 0; P.grounded = P.pgrounded = true; P.facing = p.yaw;
}

function finder(ctx: SimContext) {
  const W = ctx.world, M = W.map, w = M.w, n = w * M.h, tops = W.wallTop;
  const rock = (k: number, q: number) => q < 0 || q >= n || (M.wall[q] === 1 && (!tops || tops[q] === Infinity)) || (!M.wall[q] && !M.stairs[q] && M.elev[q] - M.elev[k] >= 2);
  const open = (k: number, q: number) => q >= 0 && q < n && !M.wall[q] && !M.stairs[q] && M.terrain[q] === M.terrain[k] && Math.abs(M.elev[q] - M.elev[k]) < 0.1 && !(M.over && M.over[q] > 0);
  const sx = M.spawn[0], sy = M.spawn[1];
  /** the open tile nearest the spawn with rock `gap` tiles away in every direction of `dirs` and `room` open tiles the other way */
  const find = (dirs: [number, number][], gap: number, room: number): [number, number] | null => {
    let best = -1, bd = Infinity;
    for (let j = 8; j < M.h - 8; j++) for (let i = 8; i < w - 8; i++) {
      const k = j * w + i;
      if (M.wall[k] || M.stairs[k] || M.terrain[k] !== M.terrain[sy * w + sx] || (M.over && M.over[k] > 0)) continue;
      let ok = true;
      for (const [dx, dy] of dirs) {
        for (let s = 1; s < gap && ok; s++) if (!open(k, (j + dy * s) * w + i + dx * s)) ok = false;
        if (ok && !rock(k, (j + dy * gap) * w + i + dx * gap)) ok = false;
        for (let s = 1; s <= room && ok; s++) if (!open(k, (j - dy * s) * w + i - dx * s)) ok = false;
        if (!ok) break;
      }
      if (!ok) continue;
      const d = (i - sx) ** 2 + (j - sy) ** 2;
      if (d < bd) { bd = d; best = k; }
    }
    return best < 0 ? null : [best % w, (best / w) | 0];
  };
  const at = (name: string, t: [number, number] | null, yaw: number): Pose | null => (t ? { name, x: t[0] - W.half + 0.5, z: t[1] - W.half + 0.5, yaw } : null);
  return { find, at, M, W };
}

/** the wall poses of a map: the view looks along -z (yaw π), so +z is behind it and +x on its right */
export function wallPoses(ctx: SimContext): Pose[] {
  const F = finder(ctx);
  return [F.at('wall behind 1', F.find([[0, 1]], 1, 5), Math.PI), F.at('wall behind 2', F.find([[0, 1]], 2, 5), Math.PI), F.at('wall right', F.find([[1, 0]], 1, 5), Math.PI), F.at('corner', F.find([[0, 1], [1, 0]], 1, 4), Math.PI)].filter((p): p is Pose => !!p);
}

/** the spawn, looking along -z */
export function openPose(ctx: SimContext): Pose {
  return { name: 'open', x: ctx.player.x, z: ctx.player.z, yaw: Math.PI };
}

/** a tile under a deck with open sides (the lens has to stay under the slab) */
export function deckPose(ctx: SimContext): Pose | null {
  const { M, W } = finder(ctx);
  if (!M.over) return null;
  for (let k = 0; k < M.w * M.h; k++) {
    if (!(M.over[k] > 0) || M.wall[k] || M.terrain[k] === 6) continue;
    const i = k % M.w, j = (k / M.w) | 0;
    let o = 0;
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) if (!M.wall[(j + dy) * M.w + i + dx]) o++;
    if (o >= 3) return { name: 'deck', x: i - W.half + 0.5, z: j - W.half + 0.5, yaw: Math.PI };
  }
  return null;
}

/** two tiles before a tile step of `rise` m along +x (three level tiles either side), looking along +x */
export function stepPose(ctx: SimContext, rise = 0.5): Pose | null {
  const { M, W } = finder(ctx), w = M.w;
  const lvl = (k: number, q: number) => q >= 0 && !M.wall[q] && !M.stairs[q] && Math.abs(M.elev[q] - M.elev[k]) < 0.02 && !(M.over && M.over[q] > 0);
  for (let j = 8; j < M.h - 8; j++) for (let i = 8; i < w - 8; i++) {
    const k = j * w + i, q = k + 1;
    if (M.wall[k] || M.wall[q] || M.stairs[k] || M.stairs[q] || Math.abs(M.elev[q] - M.elev[k] - rise) > 0.01) continue;
    if (!lvl(k, k - 1) || !lvl(k, k - 2) || !lvl(k, k - 3) || !lvl(q, q + 1) || !lvl(q, q + 2) || !lvl(q, q + 3) || !lvl(k, k - w) || !lvl(k, k + w) || !lvl(q, q - w) || !lvl(q, q + w)) continue;
    return { name: `step ${rise}`, x: i - 2 - W.half + 0.5, z: j - W.half + 0.5, yaw: Math.PI / 2 };
  }
  return null;
}
