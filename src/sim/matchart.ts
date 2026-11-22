// The species a match can show, so their art is loaded before it starts (docs/ROADMAP.md "Item 3: A1 plan"; the
// browser's loader is src/assets/loader.ts). Read from the run itself, after createRun: every squad member's whole line
// (a Breakthrough reaches the later forms), the run's training targets, and what the mode's mods can put on the field
// (Mod.shows: the Hold's Raid party). tests/matchart.test.ts plays the modes and checks nothing else appears.
import type { Mode } from '../mods/types';
import { lineage } from '../rules/heroes';
import { SPECIES_BY_ID, type SpeciesDef } from '../rules/species';
import type { SimContext } from './types';

/** a species' whole line: lineage back to the base form, then evolvesTo forward to the last */
export function wholeLine(sp: SpeciesDef): SpeciesDef[] {
  const out = lineage(sp);
  for (let s = SPECIES_BY_ID[sp.evolvesTo ?? '']; s && !out.includes(s); s = SPECIES_BY_ID[s.evolvesTo ?? '']) out.push(s);
  return out;
}

export function matchArt(ctx: SimContext, mode?: Mode): string[] {
  const out = new Set<string>();
  for (const m of ctx.player.squad) for (const s of wholeLine(m.species)) out.add(s.id);
  if (ctx.targets) for (const d of ctx.targets.set.targets) out.add(d.species);
  for (const mod of mode?.mods ?? []) for (const id of mod.shows ?? []) out.add(id);
  return [...out];
}
