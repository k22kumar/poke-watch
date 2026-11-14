// State one location-generation attempt carries between its layers. Every layer draws from its own named Rng stream
// (gen streams are independent, so adding a draw in one layer never reshuffles another).
import { Rng, streamSeed } from '../../core/rng';
import { ArenaBuilder } from '../builder';
import type { ArenaMap } from '../tiles';
import type { LinkKind, LocationDef, ZoneKind } from '../locations/types';

export interface Zone {
  id: number;
  kind: ZoneKind;
  /** centre, tile space (float) */
  x: number; y: number;
  /** nominal radius and the ellipse radii it is drawn with */
  r: number; rx: number; ry: number;
  tier: number;
  /** floor height (m) = tier × tierGap */
  h: number;
  name?: string;
  /** landmark stamps placed in this zone */
  marks: string[];
}

export interface Link {
  id: number;
  a: number; b: number;
  kind: LinkKind;
  /** width (tiles) */
  w: number;
  /** ramp links only: a wide terrace junction (the upper zone's cliff edge overlooks the lower one; the ramp climbs
   *  along one side) instead of an enclosed ramp corridor */
  terrace?: boolean;
  /** centre line (tile space), filled by the realise layer */
  pts: [number, number][];
  /** tiles it claimed */
  tiles: number[];
}

/** what each tile became (Layer B) */
export const K = { mass: 0, zone: 1, corridor: 2, ramp: 3, deck: 4, chasm: 5, step: 6 } as const;

export class LocCtx {
  readonly S: number;
  readonly def: LocationDef;
  readonly seed: number;
  readonly b: ArenaBuilder;
  readonly m: ArenaMap;
  landform = '';
  rot = 0; mir = false;
  zones: Zone[] = [];
  links: Link[] = [];
  /** player-only shortcuts planned by Layer A, realised by Layer B */
  hops: [number, number][] = [];
  /** per tile: K kind */
  kind: Uint8Array;
  /** per tile: owning zone id, or -1 */
  zoneOf: Int16Array;
  /** per tile: owning link id, or -1 */
  linkOf: Int16Array;
  /** per tile: playable surface height before props (m) */
  H: Float32Array;
  /** per tile: where a flat trail runs under a bridge deck, the trail's height there (else -1); decks.ts makes it an
   *  underpass (the deck moves to ArenaMap.over, the trail keeps the ground) */
  under: Float32Array;
  /** HAB bits per tile (rules/habitats.ts) */
  habitat: Uint8Array = new Uint8Array(0);
  anchors: [number, number][] = [];
  bodySpots: [number, number][] = [];
  notes: string[] = [];
  /** tiles with an overhead deck (locgen/decks.ts) */
  deckTiles = 0;
  /** hop steps (realize.ts): the step tile against the upper cliff, one per hop */
  steps: [number, number][] = [];
  /** bridges a trail already passes under (decks.ts) */
  crossed = new Set<number>();
  repairs = 0;
  private streams = new Map<string, Rng>();

  constructor(def: LocationDef, size: number, seed: number) {
    this.def = def; this.S = size; this.seed = seed >>> 0;
    this.b = new ArenaBuilder(`${def.id}@${seed >>> 0}`, def.name, size, size);
    this.m = this.b.m;
    const n = size * size;
    this.kind = new Uint8Array(n);
    this.zoneOf = new Int16Array(n).fill(-1);
    this.linkOf = new Int16Array(n).fill(-1);
    this.H = new Float32Array(n);
    this.under = new Float32Array(n).fill(-1);
  }

  rng(stage: string): Rng {
    let r = this.streams.get(stage);
    if (!r) { r = new Rng(streamSeed(this.seed, 'loc:' + stage)); this.streams.set(stage, r); }
    return r;
  }

  idx(x: number, y: number) { return y * this.S + x; }
  in(x: number, y: number) { return x >= 0 && y >= 0 && x < this.S && y < this.S; }
  /** is tile k playable ground (not mass or chasm)? */
  play(k: number) { const t = this.kind[k]; return t !== K.mass && t !== K.chasm; }

  /** canonical (u, v in tiles) → map tile coords, by quarter turns and a mirror (keeps the grid exact) */
  toMap(cx: number, cy: number): [number, number] {
    const S1 = this.S - 1;
    let x = this.mir ? S1 - cx : cx, y = cy;
    for (let r = 0; r < this.rot; r++) { const nx = S1 - y; y = x; x = nx; }
    return [x, y];
  }

  zone(kind: ZoneKind) { return this.zones.find((z) => z.kind === kind); }
}
