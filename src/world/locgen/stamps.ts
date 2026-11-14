// Landmark stamps: small authored pieces a location's data asks for by id (LocationDef.landmarks[].stamp). Each one
// places props inside one zone, names the place, and may add chest spots or loose-stone spots. A stamp never blocks a
// corridor: every prop goes through `Dresser.place`, which refuses reserved tiles (centre lines, ramps, decks, the
// spawn clearing) and tiles outside the zone.
import { dcos, dsin } from '../../core/detmath';
import type { ArenaPropKind } from '../tiles';
import type { LocCtx, Zone } from './ctx';

export interface Dresser {
  /** place a prop whose whole footprint is free, flat, unreserved and inside `zone` (any zone when -1) */
  place(kind: ArenaPropKind, x: number, y: number, zone: number, opts?: { text?: string }): boolean;
  /** try `place` at (x, y) and then outward up to `r` tiles */
  near(kind: ArenaPropKind, x: number, y: number, zone: number, r?: number, opts?: { text?: string }): [number, number] | null;
  reserve(x: number, y: number, r: number): void;
}

type Stamp = (g: LocCtx, z: Zone, D: Dresser, n: number) => boolean;

/** direction (unit) from the map centre to the zone: "outward" */
const outward = (g: LocCtx, z: Zone): [number, number] => { const dx = z.x - g.S / 2, dy = z.y - g.S / 2, L = Math.sqrt(dx * dx + dy * dy) || 1; return [dx / L, dy / L]; };

export const STAMPS: Record<string, Stamp> = {
  /** a Route gatehouse at the forest's edge (canon: gatehouses at both ends of Viridian Forest) */
  gate(g, z, D) {
    const [ux, uy] = outward(g, z);
    const at = D.near('gatehouse', Math.round(z.x + ux * 3 - 2), Math.round(z.y + uy * 3 - 1.5), z.id, 3);
    if (!at) return false;
    D.near('sign', Math.round(z.x - ux * 2), Math.round(z.y - uy * 2), z.id, 2, { text: 'ROUTE 2' });
    return true;
  },
  /** a Trainer Tips sign with an item tucked beside it (canon: items lie near the forest's signs) */
  tips(g, z, D) {
    const R = g.rng('stamp:tips');
    const a = R.range(0, 6.28), r = z.r * 0.7;
    const at = D.near('sign', Math.round(z.x + dcos(a) * r), Math.round(z.y + dsin(a) * r), z.id, 3, { text: 'TRAINER TIPS' });
    if (!at) return false;
    g.m.chestSpots.push([at[0] + 1, at[1]]);
    return true;
  },
  /** an old forest giant in the boss clearing, off centre so the clearing stays open */
  greatTree(g, z, D) {
    const R = g.rng('stamp:tree');
    const a = R.range(0, 6.28), r = z.r * 0.5;
    return !!D.near('elder', Math.round(z.x + dcos(a) * r - 2), Math.round(z.y + dsin(a) * r - 1), z.id, 4);
  },
  /** a Bug Catcher camp: a tent with a bug net, a log seat and a sign */
  camp(g, z, D) {
    const R = g.rng('stamp:camp');
    const a = R.range(0, 6.28), r = z.r * 0.55, cx = Math.round(z.x + dcos(a) * r), cy = Math.round(z.y + dsin(a) * r);
    const at = D.near('log', cx, cy, z.id, 3);
    if (!at) return false;
    D.near('tent', at[0] + 2, at[1] - 2, z.id, 3);
    D.near('sign', at[0], at[1] - 2, z.id, 2, { text: 'BUG CATCHER CAMP' });
    g.m.chestSpots.push([at[0] + 1, at[1] + 2]);
    return true;
  },
  /** the Moon Stone on the highest floor (canon: Mt. Moon Square's large Moon Stone, Gen II / HGSS) */
  moonstone(g, z, D) {
    const at = D.near('moonstone', Math.round(z.x) - 1, Math.round(z.y) - 1, z.id, 4);
    if (!at) return false;
    for (let i = 0; i < 5; i++) { const a = (i / 5) * 6.283; D.near('rock', Math.round(at[0] + 0.5 + dcos(a) * 3.5), Math.round(at[1] + 0.5 + dsin(a) * 3.5), z.id, 1); }
    D.reserve(at[0], at[1], 2);
    return true;
  },
  /** the fossil dig on the deepest floor (canon: Dome / Helix Fossils on B2F, Team Rocket digging) */
  dig(g, z, D) {
    const R = g.rng('stamp:dig');
    const a = R.range(0, 6.28), cx = Math.round(z.x + dcos(a) * z.r * 0.35), cy = Math.round(z.y + dsin(a) * z.r * 0.35);
    let placed = 0;
    for (const [dx, dy] of [[0, 0], [2, 1], [-2, 1], [1, -2]]) if (D.near('fossil', cx + dx, cy + dy, z.id, 1)) placed++;
    D.near('crate', cx + 3, cy - 1, z.id, 2); D.near('crate', cx - 3, cy - 1, z.id, 2);
    D.near('sign', cx, cy + 3, z.id, 2, { text: 'FOSSIL DIG' });
    g.m.chestSpots.push([cx, cy + 1]);
    return placed >= 2;
  },
  /** a cave mouth: stalagmites frame the passage an enemy wave walks out of */
  tunnel(g, z, D) {
    const [ux, uy] = outward(g, z);
    const px = -uy, py = ux;
    D.near(g.def.props.massFill === 'crystal' ? 'crystal' : 'stalagmite', Math.round(z.x + px * 2.5), Math.round(z.y + py * 2.5), z.id, 1);
    D.near(g.def.props.massFill === 'crystal' ? 'crystal' : 'stalagmite', Math.round(z.x - px * 2.5), Math.round(z.y - py * 2.5), z.id, 1);
    return true;
  },
  /** a large magnetic crystal with charged stones loose beside it (canon: Chargestone's floating-stone puzzle) */
  magnet(g, z, D, n) {
    const R = g.rng('stamp:magnet' + n);
    const a = R.range(0, 6.28), r = z.r * R.range(0.3, 0.5);
    const at = D.near('magnetite', Math.round(z.x + dcos(a) * r) - 1, Math.round(z.y + dsin(a) * r) - 1, z.id, 4);
    if (!at) return false;
    for (let i = 0; i < 4; i++) { const b = a + (i / 4) * 6.283 + 0.4; D.near('crystal', Math.round(at[0] + 0.5 + dcos(b) * 3.2), Math.round(at[1] + 0.5 + dsin(b) * 3.2), z.id, 1); }
    // two loose stones on open floor beside it
    for (const b of [a + 1.6, a - 1.6]) {
      const x = Math.round(at[0] + 0.5 + dcos(b) * 5), y = Math.round(at[1] + 0.5 + dsin(b) * 5);
      if (g.in(x, y) && g.zoneOf[g.idx(x, y)] === z.id) g.bodySpots.push([x, y]);
    }
    return true;
  },
};
