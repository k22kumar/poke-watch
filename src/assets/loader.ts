// The game's Pokémon art, fetched from dist/art/ (docs/ROADMAP.md "Item 3: A1 plan"; the files are written by
// scripts/lib/artfiles.mjs). Boot fetches the manifest and the hero sheet (every PROTOTYPE portrait); a species' atlas,
// frame table and portrait are fetched when a match needs them (ensure) or on first sight (request), and go through the
// same path as any other creature art: decode -> clips via the fallback table -> registry -> renderer. Cries are
// registered with their file names and fetched on first use (assets/cries.ts).
import { SPECIES_BY_ID } from '../rules/species';
import { ANIM_STATES, canvasFrom, type AnimState, type CreatureArt } from './art';
import { resolveClips, type SourceAnim } from './clips';
import { cries } from './cries';
import { buildArt, type PackAnim, type PackSpecies } from './pack';
import { registry, type AssetRecord } from './registry';

/** the manifest's and the hero sheet's names, given to the bundle by scripts/build.mjs */
declare const __ART__: { manifest: string; heroes: string };

export interface ArtManifestEntry {
  atlas: string; frames: string; portrait?: string;
  art: { source: string; license?: string; credits: string[]; url?: string };
  clips: Partial<Record<AnimState, string>>; notes: string[];
  cry?: { src: string; alt?: string; gain?: number; source?: string; license?: string; era?: string; altSource?: string };
  provenance?: PackSpecies['provenance'];
}
export interface ArtManifest {
  generated: string; notice?: string;
  licenses: { scope: string; name: string; url?: string; holder?: string; note?: string }[];
  heroes: { file: string; cells: Record<string, [number, number, number, number]> };
  species: Record<string, ArtManifestEntry>;
}

/** at most this many species fetched and decoded at once */
const PARALLEL = 6;

async function fetchOk(url: string): Promise<Response> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r;
}
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error(`${src}: image failed to load`)); im.src = src; });
}

/** fetch and decode one species' art (atlas, frame table, portrait) from the manifest's files */
async function fetchSpeciesArt(base: string, id: string, e: ArtManifestEntry): Promise<CreatureArt> {
  const table = await fetchOk(base + e.frames).then((r) => r.json() as Promise<{ anims: Record<string, PackAnim>; shadowSize?: number }>);
  const { art } = await buildArt(id, { source: e.art.source, atlas: base + e.atlas, anims: table.anims, shadowSize: table.shadowSize, portrait: e.portrait ? base + e.portrait : undefined, credits: e.art.credits, license: e.art.license, url: e.art.url });
  return art;
}

export class ArtLoader {
  /** `fetchArt` is the network and decode step (tests/loader.test.ts gives a fake one) */
  constructor(private readonly fetchArt: typeof fetchSpeciesArt = fetchSpeciesArt) {}
  manifest: ArtManifest | null = null;
  /** the directory the manifest's file names are relative to */
  private base = '';
  /** called with every species' art as it arrives (the renderer uploads it) */
  onArt: ((id: string, art: CreatureArt) => void) | null = null;
  private done = new Set<string>();
  private inflight = new Map<string, Promise<void>>();
  private queue: (() => void)[] = [];
  private active = 0;
  /** portraits known before (or without) the species' art: the hero sheet's cells, and the dev roster's fetched ones */
  private portraits = new Map<string, HTMLCanvasElement>();
  private portraitWait = new Map<string, Promise<HTMLCanvasElement | undefined>>();
  readonly failed = new Map<string, string>();
  readonly stats = { species: 0, portraits: 0, ms: 0 };

  /** Boot: the manifest and the hero sheet, fetched together. Registers every species' credits and cry. */
  async boot(names: { manifest: string; heroes: string } = __ART__) {
    const t0 = performance.now();
    this.base = names.manifest.slice(0, names.manifest.lastIndexOf('/') + 1);
    const [manifest, sheet] = await Promise.all([fetchOk(names.manifest).then((r) => r.json() as Promise<ArtManifest>), loadImage(names.heroes)]);
    this.manifest = manifest;
    for (const [id, [x, y, w, h]] of Object.entries(manifest.heroes.cells)) {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d')!.drawImage(sheet, x, y, w, h, 0, 0, w, h);
      this.portraits.set(id, c);
    }
    for (const [id, e] of Object.entries(manifest.species)) {
      // recordings only (docs/hero-shooter-pivot.md Q51): a species with no cry is silent
      if (e.cry?.src) cries.sample(id, this.base + e.cry.src, e.cry.gain ?? 1, e.cry.alt ? this.base + e.cry.alt : undefined);
      registry.record(this.recordOf(id, e));
    }
    registry.addPack({ id: 'pokedex', name: 'Pokémon', species: Object.keys(manifest.species), moves: 0, created: manifest.generated, notice: manifest.notice, licenses: manifest.licenses ?? [] });
    this.stats.ms = performance.now() - t0;
  }

  private recordOf(id: string, e: ArtManifestEntry): AssetRecord {
    const sp = SPECIES_BY_ID[id];
    return {
      id, name: sp?.name ?? id, origin: 'pokedex',
      data: { source: e.provenance?.data ?? 'PokéAPI', license: e.provenance?.dataLicense ?? 'PokéAPI' },
      art: { kind: 'pmd', source: e.art.source, license: e.art.license ?? 'CC BY-NC 4.0', credits: e.art.credits ?? [], url: e.art.url, clips: e.clips },
      cry: { kind: e.cry?.src ? 'sample' : 'none', source: e.cry?.source ?? 'none', license: e.cry?.license ?? '—', era: e.cry?.era, alt: e.cry?.altSource },
      status: e.notes.length ? 'fallback' : 'ok', notes: e.notes, checksum: e.provenance?.sha256?.atlas,
    };
  }

  /** the game has art for this species (whether or not it has been fetched) */
  has(id: string) { return !!this.manifest?.species[id]; }
  isLoaded(id: string) { return this.done.has(id); }
  /** portraits being fetched alone (fetchPortrait) */
  private portraitsPending = 0;
  /** art or a portrait is being fetched or decoded */
  get loading() { return this.inflight.size > 0 || this.portraitsPending > 0; }

  /** Fetch these species' art (the ones not loaded yet); resolves when all have arrived or failed. A species whose
   *  fetch failed earlier is tried again here (once per call: a match start, a hero pick), so one dropped request does
   *  not leave it missing for the session; first sight (request) does not retry. */
  ensure(ids: Iterable<string>): Promise<void> {
    const list = [...new Set(ids)].filter((id) => this.has(id));
    for (const id of list) this.failed.delete(id);
    return Promise.all(list.map((id) => this.load(id))).then(() => undefined);
  }

  /** first sight of a species nothing asked for in advance (a dev parameter): fetch it in the background */
  request(id: string) { if (this.has(id) && !this.done.has(id) && !this.inflight.has(id) && !this.failed.has(id)) void this.load(id); }

  private load(id: string): Promise<void> {
    if (this.done.has(id) || this.failed.has(id)) return Promise.resolve();
    let p = this.inflight.get(id);
    if (p) return p;
    p = new Promise<void>((res) => { this.queue.push(() => { void this.fetchSpecies(id).finally(() => { this.inflight.delete(id); this.active--; this.pump(); res(); }); }); });
    this.inflight.set(id, p);
    this.pump();
    return p;
  }
  private pump() { while (this.active < PARALLEL && this.queue.length) { this.active++; this.queue.shift()!(); } }

  private async fetchSpecies(id: string) {
    const e = this.manifest!.species[id];
    try {
      const art = await this.fetchArt(this.base, id, e);
      registry.setArt(id, art);
      this.done.add(id);
      this.stats.species++;
      this.onArt?.(id, art);
    } catch (err) {
      const why = String((err as Error)?.message ?? err);
      this.failed.set(id, why);
      console.warn(`art for ${id} could not be loaded (${why})`);
    }
  }

  /** a species' portrait as known now: its loaded art's, else the hero sheet's, else one fetched for the dev roster */
  portrait(id: string): HTMLCanvasElement | undefined {
    return registry.getArt(id)?.portrait ?? this.portraits.get(id);
  }

  /** a species' portrait, fetched alone when it is not known yet (the dev roster's rows, as they scroll into view) */
  fetchPortrait(id: string): Promise<HTMLCanvasElement | undefined> {
    const now = this.portrait(id);
    if (now) return Promise.resolve(now);
    const file = this.manifest?.species[id]?.portrait;
    if (!file) return Promise.resolve(undefined);
    let p = this.portraitWait.get(id);
    if (!p) {
      this.portraitsPending++;
      p = loadImage(this.base + file).then((im) => {
        const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
        c.getContext('2d')!.drawImage(im, 0, 0);
        this.portraits.set(id, c);
        this.stats.portraits++;
        return c;
      }, () => undefined).finally(() => { this.portraitsPending--; });
      this.portraitWait.set(id, p);
    }
    return p;
  }
}

export const artLoader = new ArtLoader();

/** What a Pokémon draws as while its art loads (a species nothing could know in advance: docs/ROADMAP.md "Item 3: A1
 *  plan"): a plain grey body with a dark outline. The renderer sizes it by the species' size class like any art. */
export function placeholderArt(): CreatureArt {
  const w = 12, h = 16, px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    // an upright capsule: a 5.5-texel radius around a vertical segment
    const cy = Math.min(Math.max(y + 0.5, 6), 10), dx = x + 0.5 - 6, dy = y + 0.5 - cy, d = Math.hypot(dx, dy);
    if (d > 5.5) continue;
    const o = (y * w + x) * 4, edge = d > 4.4;
    px[o] = px[o + 1] = edge ? 40 : 150; px[o + 2] = edge ? 52 : 168; px[o + 3] = 210;
  }
  const atlas = canvasFrom(w, h, px);
  const still: SourceAnim = { frames: Array.from({ length: 8 }, () => [{ x: 0, y: 0, w, h, ax: 6, ay: h - 1 }]), durations: [1] };
  const { clips } = resolveClips({ Idle: still });
  for (const st of ANIM_STATES) clips[st].overlay = clips[st].overlay === 'sink' ? 'sink' : 'none';
  return { id: 'placeholder', kind: 'baked', atlas, clips, heightPx: h, widthPx: w, shadowSize: 1, portrait: atlas };
}
