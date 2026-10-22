// Handcrafted survivor arenas, one per region. Each is a 112 x 112 tile (metre) wilderness
// route laid out like a DS-era Pokémon route: a forest wall around the edge, a central
// clearing to fight in, paths between landmarks, a raised bluff with stairs, a pond and a
// stream with a bridge, a ledge terrace, tall-grass fields and an open glade for the boss.
// Biomes reuse the same skeleton with their own props and palette; Sunpetal Meadow is the
// fully dressed vertical slice.
import { ArenaBuilder, hash3 } from './builder';
import { T, type ArenaMap, type ArenaPropKind } from './tiles';

export const ARENA_SIZE = 112;

interface Dressing {
  wall: ArenaPropKind[]; // border forest
  clump: ArenaPropKind[]; // tree clumps
  accent: ArenaPropKind; // landmark tree
  low: ArenaPropKind[]; // low standable obstacles
  flowers: ArenaPropKind[];
  extra: ArenaPropKind[]; // biome sprinkles
  water: boolean; // lava / ice still use the water tile; the palette differs
  tallGrass: boolean;
}

const DRESS: Record<string, Dressing> = {
  meadow: { wall: ['tree', 'tree2', 'tree', 'round'], clump: ['tree', 'round', 'tree2'], accent: 'elder', low: ['bush', 'bushR', 'rock', 'bush', 'stump'], flowers: ['flowerR', 'flowerW', 'flowerY', 'flowerB'], extra: ['berry'], water: true, tallGrass: true },
  badlands: { wall: ['deadtree', 'boulder', 'deadtree'], clump: ['boulder', 'deadtree'], accent: 'statue', low: ['rock', 'rock', 'vent', 'stump'], flowers: ['flowerY'], extra: ['crystal', 'vent'], water: true, tallGrass: true },
  frost: { wall: ['icepine', 'icepine', 'tree2'], clump: ['icepine', 'boulder'], accent: 'elder', low: ['rock', 'bushB', 'rock', 'stump'], flowers: ['flowerW', 'flowerB'], extra: ['crystal'], water: true, tallGrass: true },
  dusk: { wall: ['round', 'tree2', 'round'], clump: ['round', 'tree2', 'deadtree'], accent: 'elder', low: ['mushroom', 'rock', 'bushB', 'stump'], flowers: ['flowerB', 'flowerW'], extra: ['mushroom', 'crystal', 'lantern'], water: true, tallGrass: true },
};

const NAMES: Record<string, string> = { meadow: 'Sunpetal Meadow', badlands: 'Cinder Badlands', frost: 'Rimefrost Heights', dusk: 'Duskwood Hollow' };

const cache = new Map<string, ArenaMap>();

export function getArena(biome: string): ArenaMap {
  const key = DRESS[biome] ? biome : 'meadow';
  let m = cache.get(key);
  if (!m) { m = buildArena(key); cache.set(key, m); }
  return m;
}

function buildArena(biome: string): ArenaMap {
  const D = DRESS[biome];
  const S = ARENA_SIZE;
  const b = new ArenaBuilder(biome, NAMES[biome] ?? biome, S, S);
  const seed = { meadow: 1, badlands: 2, frost: 3, dusk: 4 }[biome] ?? 1;
  const C: [number, number] = [56, 58];

  // ---------------------------------------------------------------- landforms
  // NW bluff (1 m) with ruins on top
  b.elevBlob(28, 27, 14, 10, 2, 2, seed);
  // SW ledge terrace (0.5 m): a gentle step you can walk up and hop down
  b.elevBlob(24, 86, 17, 11, 0.5, 1.5, seed + 2);
  b.elevRect(8, 86, 20, 20, 0.5);
  // NE pond fed by a stream from the north; a second stream drains SE past the east path
  b.blob(82, 29, 10, 7, T.water, 1.5, seed);
  b.river([[86, 2], [87, 10], [85, 20]], 3);
  b.river([[88, 35], [93, 45], [96, 55], [99, 65], [106, 72], [114, 76]], 3);
  // a little SE pool
  b.blob(76, 98, 4, 3, T.water, 0.8, seed + 4);

  // ---------------------------------------------------------------- paths
  // N–S route and E–W route through the clearing, plus a loop trail and spurs to landmarks
  b.path([[56, 2], [56, 18], [55, 36], [54, 50], C, [58, 74], [56, 92], [57, 112]], 3, T.path);
  b.path([[0, 55], [14, 56], [34, 55], C, [76, 61], [96, 59], [112, 58]], 3, T.path);
  // loop trail: axis-aligned runs with rounded corners (the ground painter rounds them), like the
  // orthogonal trails of an HGSS route, rather than a staircase circle
  b.path([[33, 38], [79, 38], [79, 80], [33, 80], [33, 38]], 2, T.dirt);
  b.path([[31, 38], [31, 44]], 2, T.dirt); // bluff stairs come down onto the trail
  b.path([[76, 38], [76, 34]], 2, T.dirt); // to the pond shore
  b.path([[28, 80], [33, 80]], 2, T.dirt); // to the terrace

  // bridge where the E–W route crosses the drain stream
  b.bridge(86, 57, 20, 4);
  b.banks(biome === 'badlands' ? T.dirt : T.sand, 1);

  // ---------------------------------------------------------------- the bluff: stairs + ruins
  // stairs: cut a 2-wide flight into the bluff's south edge where the spur path arrives
  cutStairs(b, 30, 2);
  b.blob(28, 26, 7, 5, T.stone, 1, seed + 1);
  for (const [x, y] of [[22, 22], [34, 22], [22, 30], [34, 30], [28, 19]] as [number, number][]) b.prop(hash3(x, y, seed) < 0.4 ? 'pillarBroken' : 'pillar', x, y, { allowPath: true });
  b.prop('shrine', 27, 20, { allowPath: true });
  b.prop('lantern', 25, 24, { allowPath: true }); b.prop('lantern', 31, 24, { allowPath: true });
  b.landmark(28, 24, biome === 'meadow' ? 'Old Shrine Ruins' : 'Ruins');
  if (D.tallGrass) b.tall(18, 31, 4, 3, seed + 3);
  b.chest(33, 27);

  // ---------------------------------------------------------------- pond shore
  b.scatter(['reeds'], 82, 29, 12, 9, 0.35, seed + 5);
  if (biome === 'meadow' || biome === 'dusk') b.scatter(['lily'], 82, 29, 8, 5, 0.12, seed + 6);
  b.landmark(82, 29, biome === 'meadow' ? 'Mirror Pond' : biome === 'badlands' ? 'Ember Pool' : biome === 'frost' ? 'Frozen Tarn' : 'Glimmer Pool');
  b.chest(70, 26);

  // ---------------------------------------------------------------- elder tree clearing (N centre)
  if (!b.prop(D.accent, 63, 28)) throw new Error(`${biome}: landmark tree could not be placed`);
  b.scatter(D.flowers, 65, 32, 7, 3, 0.35, seed + 7);
  b.landmark(65, 30, biome === 'meadow' ? 'Elder Oak' : 'Landmark');
  b.chest(60, 31);

  // ---------------------------------------------------------------- SW terrace meadow
  b.scatter(D.flowers, 24, 87, 13, 8, 0.32, seed + 8);
  b.dots(8, 76, 34, 26, 0.35, seed);
  for (const [x, y] of [[14, 79], [33, 95], [18, 97]] as [number, number][]) b.prop(D.extra[0] === 'berry' ? 'berry' : D.low[0], x, y);
  b.landmark(24, 86, biome === 'meadow' ? 'Petal Terrace' : 'Terrace');
  b.chest(20, 92);

  // ---------------------------------------------------------------- SE tall grass fields
  if (D.tallGrass) {
    b.tallRect(70, 84, 22, 9, seed + 9); b.tallRect(62, 98, 10, 6, seed + 10);
    b.tallRect(37, 62, 7, 5, seed + 11); b.tallRect(70, 44, 7, 5, seed + 12);
    b.tallRect(84, 66, 8, 4, seed + 16); b.tallRect(14, 64, 8, 6, seed + 17); b.tallRect(42, 22, 6, 4, seed + 18);
  }
  b.chest(86, 90);

  // ---------------------------------------------------------------- south battle glade (boss)
  b.m.bossSpot = [56, 88];
  b.blob(56, 88, 10, 7, biome === 'badlands' ? T.dirt : T.sand, 1, seed + 20);
  b.path([[56, 80], [56, 96]], 3, T.path);
  for (const [x, y] of [[44, 88], [67, 88], [50, 79], [62, 79], [50, 97], [62, 97]] as [number, number][]) b.prop(y === 88 ? 'pillar' : 'lantern', x, y, { allowPath: true });
  b.landmark(56, 88, 'Battle Glade');

  // ---------------------------------------------------------------- clumps and rocks (cover to kite around)
  // groves: dense enough to read as deliberate tree masses that split the plains into rooms
  const clumps: [number, number, number, number][] = [[41, 45, 7, 3.5], [72, 71, 8, 4], [40, 71, 6, 3.5], [84, 46, 5, 3], [46, 30, 6, 3.5], [94, 84, 7, 4], [22, 60, 6, 3.5], [70, 103, 5, 3], [98, 38, 6, 3.5], [14, 42, 7, 4], [42, 100, 6, 3.5], [96, 100, 6, 3.5], [20, 72, 4, 3], [88, 26, 4, 3]];
  clumps.forEach(([x, y, n, r], k) => b.clump(x, y, n, D.clump, seed * 31 + k, r));
  // tree lines along the trail: hedgerows that frame the central clearing without closing it
  b.treeLine(36, 41, 4, 2, 0, D.clump, seed + 40); b.treeLine(68, 41, 4, 2, 0, D.clump, seed + 41);
  b.treeLine(36, 75, 4, 2, 0, D.clump, seed + 42); b.treeLine(68, 75, 4, 2, 0, D.clump, seed + 43);
  b.scatter(D.low, 56, 58, 44, 44, 0.012, seed + 13);
  b.scatter(D.extra, 56, 58, 46, 46, biome === 'meadow' ? 0.002 : 0.008, seed + 14);
  // flower beds at the junctions, HGSS-style compact clusters instead of a thin sprinkle
  b.flowerBed(51, 52, 3, 2, D.flowers, seed + 15); b.flowerBed(60, 62, 3, 2, D.flowers, seed + 19);
  b.flowerBed(52, 34, 2, 2, D.flowers, seed + 21); b.flowerBed(81, 55, 3, 2, D.flowers, seed + 22);
  b.scatter(D.flowers, C[0], C[1], 16, 14, 0.015, seed + 15);
  b.dots(30, 30, 52, 52, 0.08, seed + 2);
  b.chest(46, 58); b.chest(98, 50);

  // signpost at the central crossroads
  b.prop('sign', 60, 54, { text: `${NAMES[biome]}: Shrine ↖ · Pond ↗ · Glade ↓`, allowPath: true });

  // ---------------------------------------------------------------- border forest (last, so it fills around everything)
  b.border(4, 4, D.wall, seed);
  b.ledgeLips();
  b.m.spawn = C;
  b.sealPockets();
  // keep the spawn clearing clear
  return b.m;
}

/** cut a `w`-wide stair flight into the south edge of a plateau around column x */
function cutStairs(b: ArenaBuilder, x: number, w: number) {
  const M = b.m;
  // find the southmost high row common to the columns
  let edge = -1;
  const top = M.elev[b.i(x, Math.floor(M.h / 4))] || 2;
  for (let y = M.h - 1; y > 0; y--) {
    let ok = true;
    for (let i = x; i < x + w; i++) if (M.elev[b.i(i, y)] < top) ok = false;
    if (ok) { edge = y; break; }
  }
  if (edge < 0) return;
  // square off the flight: high tiles north of it, low tiles south of it
  // two-row flight (1 m rise per tile keeps it within the step rule); high landing north, low south
  for (let i = x - 1; i < x + w + 1; i++) { M.elev[b.i(i, edge - 2)] = top; M.elev[b.i(i, edge - 1)] = top; M.elev[b.i(i, edge)] = top; M.elev[b.i(i, edge + 1)] = 0; }
  b.stairs(x, edge - 1, w); b.stairs(x, edge, w);
  for (let i = x; i < x + w; i++) { M.elev[b.i(i, edge - 1)] = top * 0.75; M.elev[b.i(i, edge)] = top * 0.25; M.terrain[b.i(i, edge - 2)] = T.stone; M.terrain[b.i(i, edge + 1)] = T.dirt; }
}
