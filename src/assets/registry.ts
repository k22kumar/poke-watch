// Asset registry: one record per creature saying where its data, art and cry came from,
// under which licence, how each animation state resolved, and whether anything fell back.
// The UI's Credits panel and the validation tooling read from here.
import type { AnimState, CreatureArt } from './art';

export type AssetStatus = 'ok' | 'fallback' | 'error';

export interface AssetRecord {
  id: string;
  name: string;
  origin: string; // 'builtin' or 'pack:<id>'
  data: { source: string; license: string };
  art: { kind: 'baked' | 'pmd'; source: string; license: string; credits: string[]; url?: string; clips: Partial<Record<AnimState, string>> };
  cry: { kind: 'synth' | 'sample' | 'none'; source: string; license: string; era?: string; alt?: string };
  status: AssetStatus;
  notes: string[];
  checksum?: string;
}

export interface PackInfo {
  id: string; name: string; species: string[]; moves: number;
  generator?: string; created?: string; notice?: string;
  licenses: { scope: string; name: string; url?: string; holder?: string; note?: string }[];
}

class AssetRegistry {
  readonly art = new Map<string, CreatureArt>();
  readonly records = new Map<string, AssetRecord>();
  readonly packs: PackInfo[] = [];
  private listeners: (() => void)[] = [];

  setArt(id: string, a: CreatureArt) { this.art.set(id, a); }
  getArt(id: string): CreatureArt | undefined { return this.art.get(id); }
  record(r: AssetRecord) { this.records.set(r.id, r); this.emit(); }
  addPack(p: PackInfo) { const i = this.packs.findIndex((q) => q.id === p.id); if (i >= 0) this.packs[i] = p; else this.packs.push(p); this.emit(); }
  onChange(f: () => void) { this.listeners.push(f); }
  private emit() { for (const f of this.listeners) f(); }

  /** clips that used a procedural overlay or a substitute animation */
  fallbacks(): { id: string; state: string; via: string }[] {
    const out: { id: string; state: string; via: string }[] = [];
    for (const r of this.records.values())
      for (const [state, via] of Object.entries(r.art.clips)) if (via && (via.includes('+') || via.includes('@') || !via.toLowerCase().startsWith(state.slice(0, 3)))) out.push({ id: r.id, state, via });
    return out;
  }
}

export const registry = new AssetRegistry();
