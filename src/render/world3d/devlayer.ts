// The dev experiment layer (WORLDGEN3D Q18.4a; docs/RENDER3D.md "Dev parameters"): URL overrides on the resolved
// style, dev only. The 3D scene and scripts/toplint.ts read variants through this one parser. No three.
import { MATERIAL_ROLES } from '../../rules/materialroles';
import type { LookLayer } from '../../rules/styles/resolve';

/** the overlay a page URL asks for, or undefined when it asks for none */
export function devLayer(q: URLSearchParams): LookLayer | undefined {
  const num = (k: string) => (q.has(k) ? Number(q.get(k)) : undefined);
  const L: LookLayer = {};
  if (q.has('ink')) L.ink = { weight: num('ink')! };
  if (q.has('bloom') || q.has('bloomres')) L.bloom = { ...(q.has('bloom') ? { strength: num('bloom')! } : {}), ...(q.has('bloomres') ? { resolution: num('bloomres')! } : {}) };
  const paint: LookLayer['paint'] = {};
  if (q.has('edge')) paint.edgeLight = num('edge');
  if (q.has('facet')) paint.facetTone = num('facet');
  if (q.has('vgrad')) paint.verticalGradient = num('vgrad');
  if (q.has('strata')) paint.strata = num('strata');
  if (Object.keys(paint).length) L.paint = paint;
  if (q.has('bands') || q.has('inkshare')) {
    const ramp = q.has('bands') ? { ramp: { bands: num('bands')!, soft: num('soft') ?? 0.15 } } : {};
    const ink = q.has('inkshare') ? { ink: num('inkshare')! } : {};
    L.roles = Object.fromEntries(MATERIAL_ROLES.map((r) => [r, { ...ramp, ...ink }]));
  }
  if (q.has('grade')) {
    const [lift, gamma, gain, sat] = q.get('grade')!.split(',').map(Number);
    L.grade = { lift: [lift, lift, lift], gamma: [gamma, gamma, gamma], gain: [gain, gain, gain], saturation: sat };
  }
  return Object.keys(L).length ? L : undefined;
}
