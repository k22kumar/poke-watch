// Validation and repair for location maps (docs/LOCATIONS.md, "Gates").
// Hard gates must all pass or the attempt is re-rolled; quality metrics are measured on every map and some are gated
// at thresholds calibrated on the first 30 seeds of each location (see the doc for the numbers and why).
import { dcos, dsin } from '../../core/detmath';
import type { GateResult } from '../gen/context';
import { navOpen } from '../gen/util';
import { T } from '../tiles';
import { K, type LocCtx } from './ctx';
import { enemyCore, pathBetween, playerReach, sightTiles, wideCore } from './nav';

export interface LocValidation { ok: boolean; gates: GateResult[]; failed: string[]; metrics: Record<string, number> }

/** Repair: seal enemy-walkable tiles outside the spawn's strongly connected component (pockets boxed in by cover or
 *  a ramp that missed). Small pockets become rock or thicket; returns how many tiles were sealed. */
export function sealPockets(g: LocCtx): number {
  const m = g.m, S = g.S, hub = g.zone('hub')!;
  const core = enemyCore(m, Math.floor(hub.y) * S + Math.floor(hub.x), g.def.gameplay.dropNav);
  let sealed = 0;
  for (let k = 0; k < S * S; k++) {
    if (!navOpen(m, k) || core[k]) continue;
    m.wall[k] = 1; sealed++;
    // what you can see should look blocked: rock rises, forest grows a thicket
    if (g.def.enclosure.kind === 'rock') { m.elev[k] += 2.5; m.terrain[k] = T.stone; g.kind[k] = K.mass; }
    else { m.wall[k] = 0; if (!g.b.prop(g.def.props.massFill, k % S, (k / S) | 0, { force: true, allowPath: true })) m.wall[k] = 1; g.kind[k] = K.mass; }
  }
  return sealed;
}

export function validateLocation(g: LocCtx, sealed: number): LocValidation {
  const m = g.m, S = g.S, n = S * S, D = g.def, G = D.gameplay;
  const gates: GateResult[] = [];
  const gate = (id: string, ok: boolean, value: string) => gates.push({ id, ok, value });
  const hub = g.zone('hub')!, boss = g.zone('boss')!;
  const hubK = Math.floor(hub.y) * S + Math.floor(hub.x), bossK = Math.floor(boss.y) * S + Math.floor(boss.x);
  const core = enemyCore(m, hubK, G.dropNav);
  let coreN = 0, open = 0;
  for (let k = 0; k < n; k++) if (navOpen(m, k)) { open++; if (core[k]) coreN++; }
  // decks (locgen/decks.ts) are nodes of their own: every one must be in the same space
  let decksN = 0, decksIn = 0;
  if (m.over) for (let k = 0; k < n; k++) if (m.over[k] > 0) { decksN++; if (core[n + k]) decksIn++; }

  // connected: everything enemies can stand on is one strongly connected space (sealed pockets are counted)
  gate('connected', coreN === open && decksIn === decksN && sealed <= 260, `${coreN}/${open} tiles${decksN ? `, ${decksIn}/${decksN} deck` : ''}, ${sealed} sealed`);
  // every zone's centre region is in it
  const lost = g.zones.filter((z) => {
    if (z.kind === 'entrance') return false; // entrances only feed anchors; an unreachable one is dropped
    for (let r = 0; r <= 3; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const x = Math.floor(z.x) + dx, y = Math.floor(z.y) + dy; if (g.in(x, y) && core[g.idx(x, y)]) return false; }
    return true;
  });
  gate('zones', lost.length === 0, lost.length ? 'unreachable: ' + lost.map((z) => z.kind + z.id).join(',') : `${g.zones.length} reachable`);
  // the player can never stand anywhere enemies cannot follow (props excepted: they are low)
  const pr = playerReach(m, hubK);
  let perch = 0;
  for (let k = 0; k < n; k++) if (pr[k] && navOpen(m, k) && !core[k]) perch++;
  if (m.over) for (let k = 0; k < n; k++) if (m.over[k] > 0 && pr[n + k] && !core[n + k]) perch++;
  gate('perches', perch === 0, `${perch} player-only tiles`);
  // raised zones: at least two enemy ways in, realised on the map
  const access = new Map<number, number>();
  for (const L of g.links) {
    const inCore = L.tiles.filter((k) => core[k]).length;
    if (inCore < L.tiles.length * 0.5 || !L.tiles.length) continue;
    for (const id of [L.a, L.b]) access.set(id, (access.get(id) ?? 0) + 1);
  }
  const weak = g.zones.filter((z) => z.tier > 0 && z.kind !== 'entrance' && z.kind !== 'nook' && (access.get(z.id) ?? 0) < 2);
  gate('access', weak.length === 0, weak.length ? 'one way in: ' + weak.map((z) => z.kind + z.id).join(',') : 'every raised space has 2+ ways in');
  // vertical: real ground on at least two tiers (the largest tier holds at most 75 %, the next at least 15 %)
  const perTier = new Map<number, number>();
  for (let k = 0; k < n; k++) if (core[k] && navOpen(m, k)) { const t = Math.round(m.elev[k] / G.tierGap); perTier.set(t, (perTier.get(t) ?? 0) + 1); }
  const shares = [...perTier.values()].sort((a, b) => b - a).map((c) => c / Math.max(1, coreN));
  const vshare = 1 - (shares[0] ?? 1);
  gate('vertical', (shares[0] ?? 1) <= 0.75 && (shares[1] ?? 0) >= 0.15, `tiers ${shares.map((x) => (x * 100).toFixed(0) + '%').join('/')}`);
  // loop: a second spawn→boss route sharing under 60 % of the first
  const p1 = pathBetween(m, hubK, bossK, core);
  let share = 1;
  if (p1) {
    const pen = new Uint8Array(core.length);
    for (const k of p1) pen[k] = 1;
    const p2 = pathBetween(m, hubK, bossK, core, pen);
    if (p2) share = p2.filter((k) => pen[k]).length / p2.length;
  }
  gate('loop', !!p1 && share < 0.6, p1 ? `second route shares ${(share * 100).toFixed(0)}%` : 'no route to the boss');
  // spawn clearing
  let blockers = 0;
  const so = G.spawnOpen;
  for (let dy = -so; dy <= so; dy++) for (let dx = -so; dx <= so; dx++) {
    if (dx * dx + dy * dy > so * so) continue;
    const k = hubK + dy * S + dx;
    if (m.wall[k] || m.platform[k] > 0 || m.terrain[k] === T.water) blockers++;
  }
  gate('spawnOpen', blockers === 0, `${blockers} blockers within ${so} m`);
  // boss hall: two ways in, open centre
  gate('bossHall', (access.get(boss.id) ?? 0) >= 2, `${access.get(boss.id) ?? 0} ways in`);
  // approach anchors enemies can use
  const anchorsOk = g.anchors.filter(([x, y]) => core[g.idx(x, y)]).length;
  gate('anchors', anchorsOk >= 3, `${anchorsOk} usable`);
  // canonical landmarks present
  const missing = D.landmarks.filter((L) => L.canon && g.zones.filter((z) => z.marks.includes(L.id)).length < L.count[0]).map((L) => L.id);
  gate('landmarks', missing.length === 0, missing.length ? 'missing ' + missing.join(',') : 'all canonical landmarks placed');
  // pinch: one-tile passages (camera and large bodies)
  let pinch = 0;
  for (let k = S; k < n - S; k++) {
    if (!core[k]) continue;
    const blockedEW = !navOpen(m, k - 1) && !navOpen(m, k + 1) && (m.wall[k - 1] || m.wall[k + 1]);
    const blockedNS = !navOpen(m, k - S) && !navOpen(m, k + S) && (m.wall[k - S] || m.wall[k + S]);
    if (blockedEW || blockedNS) pinch++;
  }
  gate('pinch', pinch <= 24, `${pinch} one-tile passages`);
  const metrics = measure(g, core, coreN, vshare, share, pinch);
  // wide bodies (footprint ≥ 0.5 m: Large and Extra Large Pokémon, elites; docs/SIZING.md "Navigation classes") route
  // on 2 × 2 blocks (world/navblocks.ts, the sim's wide field reads the same lattice). The strictest wide body (an
  // Extra Large partner, 0.88 m: no diagonal-only links) must reach every mandatory space from the hub: the boss hall
  // and every arena (the main-route spaces), and at least three enemy anchors so wide enemies always have a way in.
  // Chambers and nooks are side spaces off trails and may be size-restricted: a one-tile neck or a trail stepping
  // along a diagonal keeps big bodies out on purpose (docs/LOCATIONS.md "Size-restricted spaces").
  const wide = wideCore(m, hubK, G.dropNav);
  const near = (x: number, y: number, R: number) => {
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      if (!g.in(Math.floor(x) + dx, Math.floor(y) + dy)) continue;
      const k = g.idx(Math.floor(x) + dx, Math.floor(y) + dy);
      if (wide[k] || (m.over && wide[n + k])) return true;
    }
    return false;
  };
  const mandatory = g.zones.filter((z) => z.kind === 'boss' || z.kind === 'arena' || z.kind === 'hub');
  const wideLost = mandatory.filter((z) => !near(z.x, z.y, 3));
  metrics.wideBoss = near(boss.x, boss.y, 3) ? 1 : 0;
  metrics.wideAnchors = g.anchors.filter(([x, y]) => near(x, y, 0)).length;
  gate('wide', wideLost.length === 0 && metrics.wideAnchors >= Math.min(3, anchorsOk), wideLost.length ? 'no wide route: ' + wideLost.map((z) => z.kind + z.id).join(',') : `${mandatory.length} mandatory spaces, ${metrics.wideAnchors} anchors on wide routes`);
  gate('overlooks', metrics.overlooks >= 2, `${metrics.overlooks} raised spaces overlook lower ground`);
  return { ok: gates.every((x) => x.ok), gates, failed: gates.filter((x) => !x.ok).map((x) => x.id), metrics };
}

/** quality metrics (reported; see docs/LOCATIONS.md for what each one means) */
function measure(g: LocCtx, core: Uint8Array, coreN: number, vshare: number, share: number, pinch: number): Record<string, number> {
  const m = g.m, S = g.S, G = g.def.gameplay, R = g.rng('measure');
  const inner = g.zones.filter((z) => z.kind !== 'entrance');
  const links = g.links.filter((L) => g.zones[L.a].kind !== 'entrance' && g.zones[L.b].kind !== 'entrance');
  // exposure of raised spaces: share of sampled rim tiles (the raised zone's own edge or its terrace) that a shooter
  // on lower ground within 16 m can see; 0 for a raised zone with no rim at all (nothing to overlook)
  let expSum = 0, expN = 0, minExp = 1;
  // a rim tile: raised ground within 2 tiles of a drop of most of a tier onto playable ground (where you stand to
  // shoot down, and where you can be shot from below)
  const rim = (k: number) => {
    const x = k % S, y = (k / S) | 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      if (!g.in(x + dx, y + dy)) continue;
      const b = g.idx(x + dx, y + dy);
      if (core[b] && m.elev[k] - m.elev[b] >= G.tierGap * 0.8) return true;
    }
    return false;
  };
  const tilesOf = (pred: (k: number) => boolean) => { const out: number[] = []; for (let k = 0; k < S * S; k++) if (core[k] && pred(k)) out.push(k); return out; };
  for (const z of inner) {
    if (z.tier === 0 || z.kind === 'nook') continue;
    const mine = tilesOf((k) => Math.abs(m.elev[k] - z.h) < 0.1 && ((k % S) - z.x) ** 2 + (((k / S) | 0) - z.y) ** 2 <= (z.r + 8) ** 2 && rim(k));
    if (!mine.length) continue; // a raised floor with no drop beside it overlooks nothing (an upper room)
    let seen = 0;
    const tries = 12;
    for (let s = 0; s < tries; s++) {
      const a = mine[R.int(0, mine.length - 1)], ax = a % S, ay = (a / S) | 0;
      let vis = false;
      for (let dy = -16; dy <= 16 && !vis; dy += 2) for (let dx = -16; dx <= 16 && !vis; dx += 2) {
        const bx = ax + dx, by = ay + dy;
        if (!g.in(bx, by) || dx * dx + dy * dy > 256) continue;
        const b = g.idx(bx, by);
        if (!core[b] || m.elev[b] > m.elev[a] - G.tierGap * 0.8) continue;
        if (sightTiles(m, b, 0.9, a, 0.6)) vis = true;
      }
      if (vis) seen++;
    }
    const e = seen / tries;
    expSum += e; expN++; minExp = Math.min(minExp, e);
  }
  // cover: share of 12 m rays from combat-space floors that something stops
  let rays = 0, blocked = 0;
  for (const z of inner) {
    if (z.kind === 'nook') continue;
    const mine = tilesOf((k) => g.zoneOf[k] === z.id);
    for (let s = 0; s < 6 && mine.length; s++) {
      const a = mine[R.int(0, mine.length - 1)], ax = a % S, ay = (a / S) | 0;
      for (let r = 0; r < 8; r++) {
        const ang = (r / 8) * 6.283 + s;
        const bx = Math.round(ax + dcos(ang) * 12), by = Math.round(ay + dsin(ang) * 12);
        if (!g.in(bx, by)) continue;
        rays++;
        if (!sightTiles(m, a, 0.9, g.idx(bx, by), 0.9)) blocked++;
      }
    }
  }
  const hubLinks = g.links.filter((L) => g.zones[L.a].kind === 'hub' || g.zones[L.b].kind === 'hub').length;
  const counts = (k: string) => g.links.filter((L) => L.kind === k).length;
  return {
    zones: inner.length, links: links.length, loops: links.length - inner.length + 1,
    tiers: new Set(inner.map((z) => z.tier)).size, raisedShare: +vshare.toFixed(3),
    ramps: counts('ramp'), bridges: counts('bridge'), paths: counts('path'), trails: counts('trail'), hops: g.notes.filter((x) => x.startsWith('hop')).length,
    entrances: g.zones.filter((z) => z.kind === 'entrance').length, anchors: g.anchors.length, hubLinks,
    overlooks: expN, exposure: +(expSum / Math.max(1, expN)).toFixed(3), minExposure: expN ? +minExp.toFixed(3) : 1,
    losBlocked: +(blocked / Math.max(1, rays)).toFixed(3), routeShare: +share.toFixed(3),
    playable: coreN, pinch, props: m.props.length,
  };
}
