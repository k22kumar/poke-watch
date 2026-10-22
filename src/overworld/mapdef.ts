// Map data model + a small authoring API used by maps.ts.
import { T } from './terrain';
import type { BuildingDef } from './buildings';
import type { Person } from './sprites';

export type PropKind =
  | 'tree' | 'tree2' | 'round' | 'round2' | 'blossom' | 'bush' | 'bushR' | 'bushB' | 'rock' | 'sign' | 'lamp' | 'mailR' | 'mailB'
  | 'lantern' | 'log' | 'bench' | 'fence' | 'planterP' | 'planterY' | 'hedge' | 'berry' | 'well' | 'gate'
  | 'flowerR' | 'flowerW' | 'flowerY' | 'tall'
  // interior furniture
  | 'table' | 'counter' | 'shelf' | 'bed' | 'plant' | 'desk' | 'machine' | 'rug' | 'stove' | 'bookcase' | 'tv' | 'lowtable' | 'cushion' | 'scroll' | 'crate';

export interface Prop { kind: PropKind; x: number; y: number; w: number; h: number; block: boolean; text?: string }
export interface NpcDef { id: string; look: string; x: number; y: number; dir: number; move: 'stand' | 'wander' | 'look' | 'pace'; radius?: number; lines: string[]; emote?: '!' | '?' | '♪' }
export interface Warp { x: number; y: number; to: string; tx: number; ty: number; dir: number; kind: 'door' | 'mat' | 'edge' }
export interface CamZone { x: number; y: number; w: number; h: number; pitch?: number; yaw?: number; dist?: number }

export interface MapDef {
  id: string; name: string; w: number; h: number; indoor: boolean;
  terrain: Uint8Array; elev: Float32Array; dots: Uint8Array; ledge: Uint8Array; stairs: Uint8Array; block: Uint8Array;
  props: Prop[]; buildings: BuildingDef[]; npcs: NpcDef[]; warps: Warp[]; zones: CamZone[];
  music: { root: number; scale: number[]; tempo: number };
  wallpaper?: string; // indoor back wall colour
  areas?: { x: number; y: number; w: number; h: number; name: string }[];
  start?: { x: number; y: number; dir: number };
}

export interface Look { person?: Person; }

export class MapBuilder {
  m: MapDef;
  constructor(id: string, name: string, w: number, h: number, indoor = false) {
    const n = w * h;
    this.m = {
      id, name, w, h, indoor,
      terrain: new Uint8Array(n).fill(indoor ? T.void : T.grass), elev: new Float32Array(n), dots: new Uint8Array(n),
      ledge: new Uint8Array(n), stairs: new Uint8Array(n), block: new Uint8Array(n),
      props: [], buildings: [], npcs: [], warps: [], zones: [], music: { root: 60, scale: [0, 2, 4, 7, 9], tempo: 112 },
    };
  }
  private i(x: number, y: number) { return y * this.m.w + x; }
  in(x: number, y: number) { return x >= 0 && y >= 0 && x < this.m.w && y < this.m.h; }
  ter(x: number, y: number, w: number, h: number, t: number) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (this.in(i, j)) this.m.terrain[this.i(i, j)] = t;
    return this;
  }
  elev(x: number, y: number, w: number, h: number, e: number) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (this.in(i, j)) this.m.elev[this.i(i, j)] = e;
    return this;
  }
  dots(x: number, y: number, w: number, h: number, density = 0.5, seed = 1) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) {
      if (!this.in(i, j)) continue;
      const r = Math.abs(Math.sin(i * 12.9898 + j * 78.233 + seed) * 43758.5453) % 1;
      if (r < density) this.m.dots[this.i(i, j)] = 1;
    }
    return this;
  }
  /** path polyline with width (tiles) */
  path(pts: [number, number][], width = 2, t: number = T.path) {
    for (let k = 0; k < pts.length - 1; k++) {
      const [ax, ay] = pts[k], [bx, by] = pts[k + 1];
      const n = Math.max(Math.abs(bx - ax), Math.abs(by - ay)) * 2 + 1;
      for (let s = 0; s <= n; s++) {
        const x = ax + ((bx - ax) * s) / n, y = ay + ((by - ay) * s) / n;
        this.ter(Math.round(x - width / 2), Math.round(y - width / 2), width, width, t);
      }
    }
    return this;
  }
  prop(kind: PropKind, x: number, y: number, opts: Partial<Prop> = {}) {
    const big = kind === 'tree' || kind === 'tree2' || kind === 'round' || kind === 'round2' || kind === 'blossom' || kind === 'well';
    const w = opts.w ?? (big ? 2 : kind === 'log' || kind === 'bench' ? 2 : kind === 'gate' ? 3 : 1);
    const h = opts.h ?? (big ? 2 : 1);
    const walkable = kind.startsWith('flower') || kind === 'tall' || kind === 'rug' || kind === 'gate' || kind === 'cushion';
    const block = opts.block ?? !walkable;
    // never stack two blockers on one tile
    if (block) for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (this.in(i, j) && this.m.block[this.i(i, j)]) return this;
    this.m.props.push({ kind, x, y, w, h, block, text: opts.text });
    if (block) for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (this.in(i, j)) this.m.block[this.i(i, j)] = 1;
    if (kind === 'tall') this.m.terrain[this.i(x, y)] = T.tall;
    return this;
  }
  /** fill a rectangle with 2x2 trees (a solid tree wall) */
  trees(x: number, y: number, w: number, h: number, kind: PropKind = 'tree') {
    for (let j = y; j + 1 < y + h + 1; j += 2) for (let i = x; i + 1 < x + w + 1; i += 2) {
      if (!this.in(i, j)) continue;
      const alt = ((i >> 1) + (j >> 1)) % 3 === 0 && kind === 'tree' ? 'tree2' : kind;
      this.prop(alt, i, j);
    }
    return this;
  }
  tall(x: number, y: number, w: number, h: number) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (this.in(i, j) && !this.m.block[this.i(i, j)]) this.prop('tall', i, j);
    return this;
  }
  flowers(x: number, y: number, w: number, h: number, kinds: PropKind[] = ['flowerR', 'flowerW', 'flowerY']) {
    let k = 0;
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (this.in(i, j) && !this.m.block[this.i(i, j)]) this.prop(kinds[k++ % kinds.length], i, j);
    return this;
  }
  ledge(x: number, y: number, w: number) { for (let i = x; i < x + w; i++) this.m.ledge[this.i(i, y)] = 1; return this; }
  stairs(x: number, y: number) { this.m.stairs[this.i(x, y)] = 1; return this; }
  building(b: Omit<import('./buildings').BuildingDef, 'id'> & { id?: string }) {
    const def = { id: b.id ?? `b${this.m.buildings.length}`, ...b } as BuildingDef;
    this.m.buildings.push(def);
    for (let j = def.y; j < def.y + def.d; j++) for (let i = def.x; i < def.x + def.w; i++) if (this.in(i, j)) this.m.block[this.i(i, j)] = 1;
    return this;
  }
  npc(n: NpcDef) { this.m.npcs.push(n); return this; }
  warp(w: Warp) { this.m.warps.push(w); return this; }
  zone(z: CamZone) { this.m.zones.push(z); return this; }
  area(x: number, y: number, w: number, h: number, name: string) { (this.m.areas ??= []).push({ x, y, w, h, name }); return this; }
  block(x: number, y: number, w = 1, h = 1) { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (this.in(i, j)) this.m.block[this.i(i, j)] = 1; return this; }
  unblock(x: number, y: number) { if (this.in(x, y)) this.m.block[this.i(x, y)] = 0; return this; }
}
