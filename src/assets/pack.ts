// Pack format: what scripts/import-pack.mjs produces from PokéAPI data, PMD SpriteCollab sheets
// and PokeAPI cries. scripts/build-content.mjs merges the packs into src/content/ (pokedex.ts +
// art.json), which the game ships with. Sprites arrive pre-packed into one atlas per species
// with per-frame anchors, so loading is decode + register (see builtin.ts).
import { ELEMENTS, type Element } from '../rules/elements';
import { MOVES, type MoveData } from '../rules/moves';
import { SPECIES_BY_ID, type SpeciesDef, type Stats } from '../rules/species';
import { ANIM_STATES, DIRS, NATIVE_CLIP, canvasFrom, type CreatureArt, type FrameRect } from './art';
import { resolveClips, type SourceAnim } from './clips';

export const PACK_FORMAT = 'poke-watch-pack';
export const PACK_VERSION = 1;

export interface PackAnim {
  /** [dir][frame] -> [x, y, w, h, anchorX, anchorY] in atlas texels */
  frames: [number, number, number, number, number, number][][];
  /** frame durations in PMD ticks (1/60 s) */
  durations: number[];
  hit?: number;
}

export interface PackSpecies {
  id: string; name: string; dex?: number;
  types?: string[]; // canonical types, for display
  elements: Element[]; // Poke-Watch elements used by the rules
  stats: Stats;
  height?: number; // m, gameplay size (hitbox); visuals come from texels
  flying?: boolean;
  playable?: boolean; blurb?: string;
  starter?: string; learnset?: [number, string][];
  evolvesTo?: string; evolveLevel?: number;
  canon?: SpeciesDef['canon'];
  art: {
    source: string; // e.g. "PMD SpriteCollab sprite/0004"
    atlas: string; // data: URL (PNG)
    anims: Record<string, PackAnim>;
    shadowSize?: number;
    portrait?: string; // data: URL (PNG)
    credits?: string[]; license?: string; url?: string;
  };
  cry?: { src: string; source?: string; license?: string; gain?: number; alt?: string; altSource?: string; era?: string; meanDb?: number; seconds?: number };
  provenance?: { data?: string; dataLicense?: string; fetched?: string; sha256?: Record<string, string> };
}

export interface PackFile {
  format: typeof PACK_FORMAT; version: number;
  id: string; name: string;
  generator?: string; created?: string; notice?: string;
  licenses?: { scope: string; name: string; url?: string; holder?: string; note?: string }[];
  species: PackSpecies[];
  moves: (MoveData & { archetype?: string; source?: string })[];
}

/** Structural validation. Returns human-readable problems; empty means loadable. */
export function validatePack(p: unknown): string[] {
  const errs: string[] = [];
  const P = p as PackFile;
  if (!P || typeof P !== 'object') return ['not a JSON object'];
  if (P.format !== PACK_FORMAT) errs.push(`format must be "${PACK_FORMAT}"`);
  if (P.version !== PACK_VERSION) errs.push(`unsupported pack version ${P.version}`);
  if (!P.id || !/^[a-z0-9-_]+$/.test(P.id)) errs.push('id must be lower-case letters, digits, - or _');
  if (!Array.isArray(P.species) || !P.species.length) errs.push('species list is empty');
  const moveKeys = new Set([...(P.moves ?? []).map((m) => m.key), ...MOVES.map((m) => m.key)]);
  for (const m of P.moves ?? []) {
    if (!ELEMENTS.includes(m.element)) errs.push(`move ${m.key}: unknown element ${m.element}`);
    if (!['physical', 'special', 'status'].includes(m.cls)) errs.push(`move ${m.key}: bad class ${m.cls}`);
  }
  const ids = new Set((P.species ?? []).map((s) => s.id));
  for (const s of P.species ?? []) {
    const at = `species ${s.id}`;
    if (!s.id || !/^[a-z0-9-_]+$/.test(s.id)) errs.push(`${at}: bad id`);
    if (!s.elements?.length || s.elements.some((e) => !ELEMENTS.includes(e))) errs.push(`${at}: bad elements ${s.elements}`);
    for (const k of ['hp', 'atk', 'def', 'spa', 'spd', 'spe'] as const) if (!(s.stats?.[k] > 0)) errs.push(`${at}: stat ${k} missing`);
    if (s.playable && !s.starter) errs.push(`${at}: playable species needs a starter move`);
    if (s.starter && !moveKeys.has(s.starter)) errs.push(`${at}: starter ${s.starter} not in moves`);
    for (const [, k] of s.learnset ?? []) if (!moveKeys.has(k)) errs.push(`${at}: learnset move ${k} not in moves`);
    if (s.evolvesTo && !ids.has(s.evolvesTo) && !SPECIES_BY_ID[s.evolvesTo]) errs.push(`${at}: evolvesTo ${s.evolvesTo} not included`);
    if (!s.art?.atlas?.startsWith('data:image/')) errs.push(`${at}: art.atlas must be an embedded PNG`);
    const walk = s.art?.anims?.Walk;
    if (!walk) errs.push(`${at}: no Walk animation`);
    for (const [name, a] of Object.entries(s.art?.anims ?? {})) {
      if (a.frames?.length !== DIRS) errs.push(`${at}: ${name} needs ${DIRS} direction rows`);
      else if (a.frames.some((row) => row.length !== a.durations.length)) errs.push(`${at}: ${name} frame count differs from durations`);
    }
    if (!s.art?.license) errs.push(`${at}: art licence missing`);
  }
  return errs;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('image failed to decode')); im.src = src; });
}

function toCanvas(im: HTMLImageElement): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
  c.getContext('2d')!.drawImage(im, 0, 0);
  return c;
}

/** Decode one creature's packed art (atlas + anims + portrait) into a CreatureArt. */
export async function buildArt(id: string, a: PackSpecies['art']): Promise<{ art: CreatureArt; report: Record<string, string>; notes: string[] }> {
  const notes: string[] = [];
  const atlas = toCanvas(await loadImage(a.atlas));
  const src: Record<string, SourceAnim> = {};
  for (const [name, an] of Object.entries(a.anims)) {
    src[name] = {
      frames: an.frames.map((row) => row.map(([x, y, w, h, ax, ay]): FrameRect => ({ x, y, w, h, ax, ay }))),
      durations: an.durations.map((d) => d / 60),
      hit: an.hit,
    };
  }
  const { clips, report } = resolveClips(src);
  // every state not served by its own PMD animation is recorded as a substitution
  for (const st of ANIM_STATES) if (report[st] !== undefined && report[st] !== NATIVE_CLIP[st]) notes.push(`${st}: substitute ${report[st]}`);
  // visible height from the front-facing idle frame
  const f = clips.idle.frames[0][0];
  const g = atlas.getContext('2d')!.getImageData(f.x, f.y, f.w, f.h).data;
  let top = f.ay;
  for (let y = 0; y < f.h && top === f.ay; y++) for (let x = 0; x < f.w; x++) if (g[(y * f.w + x) * 4 + 3] > 0) { top = y; break; }
  const heightPx = Math.max(8, f.ay - top);
  let portrait: HTMLCanvasElement;
  if (a.portrait) portrait = toCanvas(await loadImage(a.portrait));
  else { portrait = canvasFrom(f.w, f.h, g); notes.push('no portrait; using the idle frame'); }
  return { art: { id, kind: 'pmd', atlas, clips, heightPx, shadowSize: a.shadowSize ?? 1, portrait, credits: a.credits, license: a.license, sourceUrl: a.url }, report, notes };
}
