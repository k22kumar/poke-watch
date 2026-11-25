// NavWorld: one map's navigation (task I3). Placeholder while the build is measured.
import type { Rules } from '../rules/defaults';
import type { NavConfig } from './build';

/** the shared Recast settings of rules.nav */
export function navConfig(rules: Rules): NavConfig {
  const N = rules.nav;
  return {
    cs: N.cs, ch: N.ch, walkableClimb: N.walkableClimb, walkableSlopeAngle: N.walkableSlopeAngle, tileSize: N.tileSize, inset: N.inset,
    maxSimplificationError: N.maxSimplificationError, maxEdgeLen: N.maxEdgeLen, minRegionArea: N.minRegionArea, mergeRegionArea: N.mergeRegionArea,
    maxVertsPerPoly: N.maxVertsPerPoly,
  };
}
