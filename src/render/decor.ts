// Ground decor (docs/ART_DIRECTION.md, "Floor" and "Frame" layers): small, muted, non-colliding sprites that make the
// ground read as a habitat rather than a fill colour, plus one piece of expedition storytelling (a cold camp by the
// crossroads signpost). Presentation only: placed from the arena map with a fixed hash, never read by the simulation,
// never on a tile that holds a prop, water or a wall, and thinned out where fights happen (spawn clearing, boss glade).
//
// Rules every decor sprite follows:
//   - lower than a Pokémon's knee (<= 10 px tall at 16 px/m), so it can never hide a body or a telegraph;
//   - drawn from the ground's own ramp, one step darker or lighter, never a signal hue (no red/orange/cyan/yellow) and
//     nothing round and bright that could be mistaken for a pickup;
//   - density rises toward forest edges (where it softens the floor-to-frame transition) and falls in the open.
import { Sprite, type Ramp } from '../overworld/paint';
import { T, type ArenaMap } from '../world/tiles';

type Pal = 'meadow' | 'badlands' | 'frost' | 'dusk';
interface DecorPal { clump: Ramp; clumpOut: string; litter: Ramp; litterOut: string; fern: Ramp; fernOut: string; stone: Ramp; stoneOut: string; cloth: Ramp; cloth2: Ramp }

const PAL: Record<Pal, DecorPal> = {
  meadow: { clump: ['#8cc064', '#6ea44e', '#548a40'], clumpOut: '#4a7a3c', litter: ['#b8a466', '#98864e', '#7a6a3e'], litterOut: '#6e6040', fern: ['#78b058', '#5a9446', '#407838', '#2e6030'], fernOut: '#24502c', stone: ['#d6d0c0', '#b0a898', '#8a8476'], stoneOut: '#5a5650', cloth: ['#8ab4b0', '#6a9894', '#4e7a78'], cloth2: ['#e0d4b0', '#c4b48c', '#a08e6a'] },
  badlands: { clump: ['#d8b47a', '#bc9660', '#9a7a4a'], clumpOut: '#6a4e30', litter: ['#a07e66', '#846650', '#684e3e'], litterOut: '#4a3428', fern: ['#c8a868', '#a88a50', '#88703e', '#6a5630'], fernOut: '#4a3a22', stone: ['#d0a690', '#ac826c', '#886452'], stoneOut: '#583c30', cloth: ['#9aa0b0', '#7a8090', '#5e6474'], cloth2: ['#e0ccaa', '#c4ae88', '#a08a68'] },
  frost: { clump: ['#e6eef6', '#c0d0e0', '#98acc4'], clumpOut: '#6a809c', litter: ['#a8987e', '#8a7c66', '#6c604e'], litterOut: '#4e4638', fern: ['#a8c8c0', '#84aaa2', '#628a84', '#4a6c68'], fernOut: '#3a5258', stone: ['#dce4ee', '#b4c0d0', '#8c9aae'], stoneOut: '#5a6a80', cloth: ['#a0a8c8', '#8088ac', '#626a90'], cloth2: ['#e8e0cc', '#ccc2aa', '#aaa088'] },
  dusk: { clump: ['#5a9460', '#467c50', '#346442'], clumpOut: '#26463a', litter: ['#7a6e5a', '#625848', '#4c4438'], litterOut: '#2e2a26', fern: ['#5aa060', '#3e8450', '#2c6a44', '#1e5038'], fernOut: '#14303a', stone: ['#a09cb0', '#7c7890', '#5e5a72'], stoneOut: '#34304a', cloth: ['#7a8cb0', '#5e6e94', '#465478'], cloth2: ['#c8bca0', '#aa9e84', '#8a7e68'] },
};

const palOf = (b: string): Pal => (b === 'badlands' || b === 'frost' || b === 'dusk' ? b : 'meadow');

/** decor sprite set for a biome (keys are prefixed `d.` so they never collide with prop keys) */
export function decorSprites(biome: string): Map<string, ImageData> {
  const P = PAL[palOf(biome)], out = new Map<string, ImageData>();
  // low grass clump, two shapes
  for (let v = 0; v < 2; v++) {
    const s = new Sprite(12, 7); s.outline = P.clumpOut;
    const r = s.ramp(P.clump);
    const blades = v ? [[2, 3], [4, 1], [6, 2], [8, 0], [10, 3]] : [[3, 2], [5, 0], [7, 1], [9, 3]];
    for (const [x, top] of blades) s.line(x, 6, x + (x < 6 ? -1 : 1), top, r);
    s.rect(2, 5, 9, 2, r);
    out.set('d.clump' + v, s.render());
  }
  // pebbles
  {
    const s = new Sprite(12, 6); s.outline = P.stoneOut;
    s.ellipse(3.5, 3.5, 2.5, 1.8, s.ramp(P.stone)); s.ellipse(8.5, 4, 2, 1.4, s.ramp(P.stone)); s.px(6, 1, s.ramp(P.stone));
    out.set('d.pebbles', s.render());
  }
  // litter: fallen leaves / dry twigs, flat
  {
    const s = new Sprite(14, 5); s.outline = P.litterOut;
    const r = s.ramp(P.litter);
    s.ellipse(3, 2.5, 2.5, 1.2, r); s.ellipse(9, 3, 2.5, 1.2, r); s.line(5, 4, 12, 1, r);
    out.set('d.litter', s.render({ shade: false }));
  }
  // forest-edge fern (frost: a frosted shrub, badlands: dry scrub), two sway frames
  for (let f = 0; f < 2; f++) {
    const s = new Sprite(14, 10); s.outline = P.fernOut;
    const r = s.ramp(P.fern);
    const sw = f;
    s.line(7, 9, 7 + sw, 1, r);
    s.line(6, 9, 1 + sw, 3, r); s.line(8, 9, 13 + sw, 3, r);
    s.line(6, 9, 3 + sw, 1, r); s.line(8, 9, 11 + sw, 1, r);
    s.rect(4, 7, 7, 3, r);
    out.set('d.fern' + f, s.render());
  }
  // camp: a cold fire ring, a bedroll and an explorer's satchel
  {
    const s = new Sprite(20, 10); s.outline = P.stoneOut;
    const st = s.ramp(P.stone);
    for (let k = 0; k < 9; k++) { const a = (k / 9) * Math.PI * 2; s.ellipse(10 + Math.cos(a) * 7, 5 + Math.sin(a) * 3.2, 1.6, 1.2, st); }
    s.ellipse(10, 5, 4.5, 1.8, s.ramp(['#6a6460', '#54504c', '#403c3a']));
    const wood = s.ramp(['#8a6a4a', '#6a4e36', '#4c3826']);
    s.line(7, 6, 13, 4, wood); s.line(7, 4, 13, 6, wood);
    out.set('d.firering', s.render());
  }
  {
    const s = new Sprite(20, 9); s.outline = '#3a3430';
    s.rect(1, 3, 14, 5, s.ramp(P.cloth));
    s.ellipse(15.5, 5.5, 3.5, 3, s.ramp(P.cloth2));
    s.rect(4, 3, 1, 5, s.ramp(['#7a5a3a', '#5e4430', '#463222'])); s.rect(10, 3, 1, 5, s.ramp(['#7a5a3a', '#5e4430', '#463222']));
    out.set('d.bedroll', s.render());
  }
  {
    const s = new Sprite(12, 12); s.outline = '#3a2a1e';
    const bag = s.ramp(['#c09a68', '#a07c50', '#80603c', '#604428']);
    s.rect(2, 4, 8, 7, bag); s.ellipse(6, 4, 4, 2, bag);
    s.rect(3, 6, 6, 3, s.ramp(['#a88458', '#8a6a44', '#6c5032']));
    s.line(1, 2, 3, 5, s.ramp(['#7a5a3a', '#5e4430', '#463222'])); s.line(11, 2, 9, 5, s.ramp(['#7a5a3a', '#5e4430', '#463222']));
    s.dot(6, 7, '#d8c8a0');
    out.set('d.satchel', s.render());
  }
  // habitat signs (procedural regions): a burrow mound where Sandshrew would dig, a tuft of wool where Mareep graze,
  // small prints in the mud where Poliwag come out of the water
  {
    const sd = new Sprite(12, 6); sd.outline = P.litterOut;
    sd.ellipse(6, 4, 5, 2.2, sd.ramp(P.litter)); sd.ellipse(6, 4.2, 2, 1, sd.ramp(['#4a3a2a', '#3a2c20', '#2a2018']));
    out.set('d.burrow', sd.render());
    const sw = new Sprite(9, 6); sw.outline = '#b8b0a0';
    sw.ellipse(3, 3.5, 2.5, 2, sw.ramp(['#ffffff', '#f0ecd8', '#d8d2bc'])); sw.ellipse(6, 3, 2.2, 1.8, sw.ramp(['#ffffff', '#f0ecd8', '#d8d2bc']));
    out.set('d.wool', sw.render({ shade: false }));
    const sp = new Sprite(12, 6); sp.outline = P.litterOut;
    for (const [x, y] of [[2, 4], [5, 2], [8, 4], [10, 1]]) sp.ellipse(x, y, 1.2, 0.8, sp.ramp([P.litter[1], P.litter[2], P.litter[2]]));
    out.set('d.prints', sp.render({ shade: false }));
  }
  return out;
}

export interface DecorItem { key: string; frames: number; x: number; z: number; tile: number; sway: number; flip: boolean; shade: number; burns: boolean }

const h = (x: number, y: number, s: number) => {
  let n = (x * 374761393 + y * 668265263 + s * 2246822519) >>> 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177) >>> 0;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
};

/**
 * Lay decor out over an arena. `edge` is the ground's forest-edge shade per tile (0..1), the same grid the ground
 * painter used, so decor collects where the ground already darkens toward the frame.
 */
export function layoutDecor(m: ArenaMap, edge: Float32Array): DecorItem[] {
  const W = m.w, H = m.h, out: DecorItem[] = [];
  const taken = new Uint8Array(W * H);
  for (const p of m.props) for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) if (x >= 0 && y >= 0 && x < W && y < H) taken[y * W + x] = 1;
  for (const [x, y] of m.chestSpots) if (x >= 0 && y >= 0 && x < W && y < H) taken[y * W + x] = 1;
  const free = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && !taken[y * W + x] && !m.wall[y * W + x] && m.terrain[y * W + x] !== T.water && m.terrain[y * W + x] !== T.tall;
  const nearWall = (x: number, y: number) => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const a = x + dx, b = y + dy; if (a >= 0 && b >= 0 && a < W && b < H && m.wall[b * W + a]) return true; }
    return false;
  };
  const d2 = (x: number, y: number, c: [number, number]) => (x - c[0]) ** 2 + (y - c[1]) ** 2;
  // the camp: beside the crossroads signpost, on the side away from the spawn
  const sign = m.props.find((p) => p.kind === 'sign');
  // each piece tries a few spots (first free, non-path tile wins) so the camp survives small layout changes
  const camp: [string, [number, number][]][] = [['d.firering', [[3, -2], [3, -3], [4, -2]]], ['d.bedroll', [[5, -3], [5, -2], [6, -3]]], ['d.satchel', [[2, -3], [3, -4], [1, -2], [4, -4]]]];
  if (sign) for (const [key, spots] of camp) {
    const at = spots.map(([dx, dy]) => [sign.x + dx, sign.y + dy]).find(([x, y]) => free(x, y) && m.terrain[y * W + x] !== T.path);
    if (!at) continue;
    const [x, y] = at;
    out.push({ key, frames: 1, x: x + 0.5, z: y + 0.75, tile: y * W + x, sway: 0, flip: false, shade: 1, burns: false });
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (x + dx >= 0 && y + dy >= 0 && x + dx < W && y + dy < H) taken[(y + dy) * W + x + dx] = 1;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!free(x, y)) continue;
    const k = y * W + x, t = m.terrain[k], e = edge[k];
    // fights happen here: keep the floor quiet
    const calm = d2(x, y, m.spawn) < 64 || d2(x, y, m.bossSpot) < 100 ? 0.25 : 1;
    const r = h(x, y, 7), jx = (h(x, y, 11) - 0.5) * 0.6, jz = (h(x, y, 13) - 0.5) * 0.5;
    const flip = h(x, y, 17) < 0.5, shade = 1 - 0.3 * e;
    let key = '', frames = 1, sway = 0, burns = false;
    if (t === T.grass) {
      if (e > 0.3 && nearWall(x, y) && r < 0.45) { key = 'd.fern'; frames = 2; sway = 0.4; burns = true; }
      else if (r < (0.035 + 0.12 * e) * calm) { key = 'd.clump' + (h(x, y, 19) < 0.5 ? 0 : 1); sway = 0.25; burns = true; }
      else if (r < (0.045 + 0.2 * e) * calm) key = 'd.litter';
      else if (r < 0.055 * calm) key = 'd.pebbles';
    } else if (t === T.path || t === T.dirt || t === T.sand) {
      // stones kicked to the edge of a trail
      if (r < 0.03 * calm) key = 'd.pebbles';
    }
    // habitat signs on generated regions (cosmetic; the director still spawns on its ring)
    const hab = m.gen?.habitat;
    if (!key && hab && calm === 1) {
      const hv = h(x, y, 23);
      if (hab[k] & 16 && t !== T.path && hv < 0.012) key = 'd.burrow';
      else if (hab[k] & 1 && t === T.grass && hv < 0.006) key = 'd.wool';
      else if (hab[k] & 4 && (t === T.sand || t === T.grass) && hv < 0.02) key = 'd.prints';
    }
    if (!key) continue;
    out.push({ key, frames, x: x + 0.5 + jx, z: y + 0.6 + jz, tile: k, sway, flip, shade, burns });
  }
  return out;
}
