// Hand-authored maps for the vertical slice: Maplebrook Town + Fernwood Trail (one connected
// outdoor map) and four interiors. Original layout; every element is placed by hand.
import { MapBuilder, type MapDef } from './mapdef';
import { T } from './terrain';

function maplebrook(): MapDef {
  const b = new MapBuilder('maple', 'Maplebrook Town', 36, 62);
  b.m.music = { root: 62, scale: [0, 2, 4, 7, 9], tempo: 100 };
  b.area(0, 0, 36, 30, 'Fernwood Trail').area(0, 30, 36, 32, 'Maplebrook Town');
  b.m.start = { x: 7, y: 52, dir: 0 };

  // ================= FERNWOOD TRAIL (north half) =================
  b.ter(4, 13, 28, 3, T.water); // Willow River
  b.path([[17.5, 29.5], [17.5, 25], [13.5, 22.5], [13.5, 18.5], [17.5, 17.5], [17.5, 11], [21.5, 9.5], [21.5, 4], [17.5, 2.5], [17.5, 0]], 2);
  b.ter(17, 13, 2, 3, T.wood); // bridge
  b.zone({ x: 15, y: 11, w: 6, h: 6, pitch: 0.5, yaw: -0.32, dist: 20 });
  // borders
  b.trees(0, 0, 4, 30).trees(32, 0, 4, 30).trees(4, 0, 12, 2).trees(20, 0, 12, 2);
  b.prop('log', 17, 0, { text: 'A fallen tree blocks the trail north. Maybe another day.' });
  // riverbanks
  b.trees(4, 16, 6, 2).trees(26, 16, 6, 2).trees(4, 11, 4, 2);
  b.prop('bush', 10, 16).prop('bushR', 11, 17).prop('bush', 24, 16).prop('bush', 25, 17);
  b.prop('log', 9, 11, { text: 'A mossy log. Something small skitters away underneath.' });
  b.prop('rock', 14, 11).prop('rock', 24, 11).prop('bush', 11, 12).prop('bushB', 26, 12);
  b.prop('sign', 16, 11, { text: 'WILLOW RIVER\nPlease leave the river critters in peace.' });
  // west meadow
  b.tall(5, 23, 7, 5).tall(5, 18, 6, 4);
  b.prop('rock', 11, 20).prop('bush', 4, 22).prop('bushR', 12, 27);
  b.flowers(9, 22, 2, 1);
  // east meadow above a ledge
  b.tall(21, 18, 9, 5);
  b.ledge(20, 25, 12);
  b.prop('rock', 30, 24).prop('bush', 20, 23).flowers(21, 26, 3, 1).flowers(27, 27, 4, 1, ['flowerY', 'flowerW']);
  b.dots(19, 26, 13, 3, 0.4, 3);
  // north woods + lookout plateau
  b.tall(5, 3, 7, 6);
  b.trees(12, 3, 2, 4, 'tree');
  b.prop('rock', 14, 7).prop('rock', 15, 9).prop('bushR', 13, 9);
  b.elev(25, 2, 7, 7, 1);
  b.path([[23.5, 9.5], [26.5, 9.5]], 1, T.dirt);
  b.stairs(26, 9);
  b.ter(26, 9, 1, 1, T.stone);
  b.prop('berry', 28, 3, { text: 'A berry bush heavy with fruit. The berries smell like honey.' });
  b.prop('sign', 27, 7, { text: 'LOOKOUT POINT\nOn clear days you can see the sea from here.' });
  b.prop('rock', 30, 6).prop('bush', 25, 3).flowers(29, 5, 2, 1, ['flowerW']);
  b.tall(25, 5, 2, 2);
  b.dots(5, 9, 10, 2, 0.35, 5);
  b.prop('sign', 15, 28, { text: 'FERNWOOD TRAIL\nSouth: Maplebrook Town' });
  b.npc({ id: 'hiker', look: 'hiker', x: 20, y: 6, dir: 2, move: 'look', lines: ['The lookout up there is my favourite spot.', 'Take the stone steps on the right. Mind the edge!'] });
  b.npc({ id: 'routekid', look: 'kid', x: 8, y: 20, dir: 0, move: 'wander', radius: 2, lines: ['Shh! Something is moving in the tall grass…', 'I bet it\'s a Gnatling. They love sunny meadows.'] });

  // ================= MAPLEBROOK TOWN (south half) =================
  b.trees(0, 30, 4, 32).trees(32, 30, 4, 32).trees(4, 60, 28, 2).trees(4, 30, 12, 2).trees(20, 30, 12, 2);
  b.path([[17.5, 29.5], [17.5, 39]], 2);
  b.ter(13, 39, 10, 7, T.stone); // plaza
  b.prop('well', 17, 41, { text: 'An old stone well. The water is cold and very clear.' });
  b.prop('lamp', 13, 39).prop('lamp', 22, 39).prop('lamp', 13, 45).prop('lamp', 22, 45);
  b.prop('bench', 14, 43).prop('bench', 20, 43);
  b.prop('planterP', 14, 40).prop('planterY', 21, 40);
  b.prop('sign', 15, 32, { text: 'MAPLEBROOK TOWN\nWhere the wind smells of maple leaves.' });
  b.prop('round', 13, 33).prop('round2', 20, 33);
  b.dots(4, 32, 28, 4, 0.18, 7);

  // traditional house (north-west)
  b.building({ x: 5, y: 33, w: 7, d: 4, wallH: 2.1, style: 'japanese', roof: 'hip', roofColor: '#5a6478', door: 3, warp: 'tatami', rise: 1.6 });
  b.path([[8.5, 37.5], [13.5, 37.5], [13.5, 39.5]], 2);
  b.prop('lantern', 4, 37).prop('bush', 12, 36).prop('planterP', 10, 37);
  // pond + fisher
  b.ter(5, 40, 6, 4, T.water);
  b.prop('rock', 4, 40).prop('bush', 11, 41).prop('bushB', 4, 44);
  b.flowers(9, 44, 3, 1, ['flowerW', 'flowerY']);
  b.npc({ id: 'fisher', look: 'fisher', x: 7, y: 44, dir: 1, move: 'stand', lines: ['Nothing is biting today.', 'Still, an afternoon by the pond is never wasted.'] });

  // general store (north-east)
  b.building({ x: 24, y: 33, w: 6, d: 4, wallH: 2.2, style: 'shop', roof: 'gable', roofColor: '#48a068', door: 2, awning: '#e85050', sign: 'STORE', warp: 'shop' });
  b.path([[26.5, 37.5], [21.5, 37.5], [21.5, 39.5]], 2);
  b.prop('planterY', 23, 36).prop('planterP', 30, 36);
  b.npc({ id: 'lady', look: 'lady', x: 23, y: 38, dir: 3, move: 'pace', radius: 2, lines: ['The store just got a delivery of sweet buns.', 'Everyone in town lines up on baking day!'] });

  // shrine terrace (east)
  b.elev(24, 39, 8, 7, 1);
  b.building({ x: 26, y: 39, w: 3, d: 3, wallH: 1.7, style: 'japanese', roof: 'hip', roofColor: '#3f6a5a', door: 1, rise: 1.5, doorStyle: 'sliding' });
  b.ter(27, 42, 1, 4, T.stone);
  b.prop('gate', 26, 43);
  b.prop('lantern', 25, 42).prop('lantern', 29, 42);
  b.prop('blossom', 30, 39).prop('round', 24, 39);
  b.prop('bush', 30, 44).prop('bush', 24, 45);
  b.stairs(27, 46);
  b.ter(27, 46, 1, 1, T.stone);
  b.path([[22.5, 44.5], [22.5, 47.5], [27.5, 47.5]], 2);
  b.npc({ id: 'elder', look: 'elder', x: 26, y: 44, dir: 0, move: 'look', lines: ['This shrine is older than the town itself.', 'They say the blossom tree only flowers for kind travellers.'] });

  // player's house (south-west)
  b.building({ x: 5, y: 47, w: 6, d: 4, wallH: 2.7, style: 'wood', roof: 'gable', roofColor: '#4878c8', door: 2, chimney: 4, warp: 'house' });
  b.prop('mailB', 6, 51, { text: 'A blue mailbox with your name on it. It\'s empty.' });
  b.prop('planterP', 4, 51);
  // neighbour's house (south-east)
  b.building({ x: 24, y: 48, w: 6, d: 4, wallH: 2.4, style: 'plaster', roof: 'hip', roofColor: '#d05848', door: 3, chimney: 1 });
  b.prop('mailR', 23, 51, { text: 'The Okada family. A postcard is sticking out.' });
  b.prop('bushR', 30, 52);
  // east-west street + lab approach
  b.path([[7.5, 51.5], [7.5, 52.5], [28.5, 52.5]], 2);
  b.path([[27.5, 52], [27.5, 52]], 2);
  b.path([[15.5, 46], [15.5, 52]], 2).path([[19.5, 46], [19.5, 52]], 2);
  b.path([[10.5, 53], [10.5, 59.5], [23.5, 59.5], [23.5, 53]], 2);
  // field lab (south)
  b.building({ x: 12, y: 55, w: 11, d: 4, wallH: 2.6, style: 'lab', roof: 'gable', roofColor: '#3a98a8', door: 5, sign: 'FIELD LAB', warp: 'lab' });
  b.ter(12, 59, 11, 1, T.stone);
  // garden with fence + flowerbeds
  b.ter(4, 55, 6, 4, T.flowerbed);
  for (let j = 55; j < 59; j++) for (let i = 4; i < 10; i++) if ((i + j) % 2 === 0) b.prop((['flowerR', 'flowerW', 'flowerY'] as const)[(i * 3 + j) % 3], i, j);
  for (let x = 4; x < 10; x++) b.prop('fence', x, 54);
  b.prop('round2', 25, 55).prop('bush', 27, 57).prop('bushR', 29, 55).prop('hedge', 30, 57).prop('hedge', 31, 57);
  b.dots(24, 53, 8, 7, 0.3, 11).dots(11, 46, 3, 5, 0.3, 13);
  // town dressing: flower patches, bushes and signs that frame the streets
  b.flowers(12, 47, 2, 1, ['flowerY', 'flowerW']).flowers(21, 46, 2, 1, ['flowerR', 'flowerW']);
  b.prop('bushR', 12, 50).prop('bush', 13, 51).prop('bushB', 21, 48).prop('bush', 22, 50);
  b.prop('sign', 14, 46, { text: 'TOWN SQUARE\nThe well water here is the sweetest in the valley.' });
  b.prop('sign', 11, 58, { text: 'FIELD LAB\nResearch into creatures and their habitats.' });
  b.prop('lamp', 9, 53).prop('lamp', 25, 53);
  b.flowers(4, 46, 1, 1, ['flowerR']).flowers(12, 39, 1, 1, ['flowerW']).flowers(23, 41, 1, 1, ['flowerY']);
  b.prop('bush', 4, 38).prop('bushR', 12, 38).prop('rock', 31, 47).prop('bush', 31, 53);
  b.prop('bench', 25, 59);
  b.npc({ id: 'kid', look: 'kid', x: 17, y: 48, dir: 0, move: 'wander', radius: 3, lines: ['Race you to the well!', '…Hey, your partner is way faster than you.'] });
  b.npc({ id: 'girl', look: 'girl', x: 21, y: 50, dir: 2, move: 'look', lines: ['Do you like my flowers? I planted them myself!'] });
  b.npc({ id: 'keeper', look: 'keeper', x: 21, y: 59, dir: 2, move: 'stand', lines: ['The professor is out collecting samples again.', 'If you head north to Fernwood Trail, watch the tall grass!'] });

  // warps (door tile -> interior entry)
  b.warp({ x: 7, y: 50, to: 'house', tx: 5, ty: 7, dir: 1, kind: 'door' });
  b.warp({ x: 8, y: 36, to: 'tatami', tx: 4, ty: 6, dir: 1, kind: 'door' });
  b.warp({ x: 26, y: 36, to: 'shop', tx: 4, ty: 6, dir: 1, kind: 'door' });
  b.warp({ x: 17, y: 58, to: 'lab', tx: 6, ty: 8, dir: 1, kind: 'door' });
  b.zone({ x: 24, y: 39, w: 8, h: 7, pitch: 0.84, dist: 21 });
  return b.m;
}

function room(id: string, name: string, w: number, h: number, floor: number, wallpaper: string, exitX: number, back: { to: string; x: number; y: number }): MapBuilder {
  const b = new MapBuilder(id, name, w, h, true);
  b.ter(0, 1, w, h - 1, floor);
  b.block(0, 0, w, 1);
  b.m.wallpaper = wallpaper;
  b.m.music = { root: 65, scale: [0, 2, 4, 5, 7, 9], tempo: 92 };
  b.warp({ x: exitX, y: h - 1, to: back.to, tx: back.x, ty: back.y, dir: 0, kind: 'mat' });
  b.zone({ x: 0, y: 0, w, h, pitch: 0.82, dist: 17 });
  return b;
}

function house(): MapDef {
  const b = room('house', 'Your House', 11, 8, T.floor, '#f0d8b0', 5, { to: 'maple', x: 7, y: 51 });
  b.prop('bookcase', 1, 1).prop('tv', 3, 1).prop('plant', 0, 1).prop('stove', 8, 1).prop('counter', 9, 1).prop('shelf', 7, 1);
  b.prop('rug', 4, 4, { w: 3, h: 2, block: false });
  b.prop('table', 4, 3, { w: 2 }).prop('plant', 10, 6);
  b.npc({ id: 'mom', look: 'mom', x: 7, y: 3, dir: 0, move: 'look', lines: ['Heading out again? Take your partner and stay on the paths!', 'Dinner is stew tonight. Be home before the lamps come on.'] });
  return b.m;
}
function shop(): MapDef {
  const b = room('shop', 'General Store', 10, 7, T.floor, '#d8eed8', 4, { to: 'maple', x: 26, y: 37 });
  b.prop('shelf', 4, 1).prop('shelf', 5, 1).prop('shelf', 6, 1).prop('shelf', 7, 1).prop('crate', 9, 1).prop('plant', 0, 5);
  b.prop('counter', 1, 3).prop('counter', 2, 3);
  b.prop('shelf', 6, 4).prop('shelf', 8, 4);
  b.npc({ id: 'clerk', look: 'clerk', x: 1, y: 2, dir: 0, move: 'stand', lines: ['Welcome! Sorry, the register is closed for stocktaking.', 'Come back tomorrow for fresh sweet buns.'] });
  return b.m;
}
function lab(): MapDef {
  const b = room('lab', 'Field Lab', 13, 9, T.floor, '#e0eef4', 6, { to: 'maple', x: 17, y: 59 });
  b.prop('bookcase', 1, 1).prop('bookcase', 2, 1).prop('bookcase', 3, 1).prop('machine', 8, 1).prop('machine', 9, 1).prop('machine', 10, 1).prop('plant', 12, 1);
  b.prop('desk', 2, 4, { w: 2 }).prop('desk', 8, 4, { w: 2 }).prop('plant', 0, 7).prop('crate', 12, 7);
  b.npc({ id: 'aide', look: 'clerk', x: 6, y: 3, dir: 0, move: 'look', lines: ['We study how creatures and people share the land.', 'Did you know Kindlamb wool stays warm even in the rain?'] });
  return b.m;
}
function tatami(): MapDef {
  const b = room('tatami', 'Teahouse', 9, 7, T.tatami, '#f4ecd8', 4, { to: 'maple', x: 8, y: 37 });
  b.prop('scroll', 4, 1).prop('shelf', 1, 1).prop('plant', 8, 1);
  b.prop('lowtable', 3, 3, { w: 2 }).prop('cushion', 3, 4).prop('cushion', 4, 4).prop('cushion', 5, 3);
  b.npc({ id: 'grandma', look: 'keeper', x: 6, y: 3, dir: 2, move: 'stand', lines: ['Sit, sit. The kettle will sing in a moment.', 'My husband spends every afternoon up at the shrine.'] });
  return b.m;
}

export const MAPS: Record<string, () => MapDef> = { maple: maplebrook, house, shop, lab, tatami };
