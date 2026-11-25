// Material roles (docs/WORLDGEN3D.md Q16): what a face is for, not what it is made of. The generator emits roles and
// nothing else about material. Two bindings keep them apart from the rest:
//   physical  role → MaterialId (rules/surfaces.ts), in the recipe's biome binding; gameplay data, hashed
//   visual    role → style material, in the world style; render data, never hashed
// A liquid surface takes its id from the liquids registry (Q9.4), not a role.
//
// The union is contract: adding, removing or renaming a role bumps MODEL_VERSION (src/world/model.ts, Q16.9). This
// file is not src/rules/roles.ts, which holds the species role rule.

/** the 15 roles of Q16.2, v1 */
export const MATERIAL_ROLES = [
  // natural
  'ground', 'path', 'soil', 'rock', 'cliff', 'bed',
  // built
  'floor', 'wall', 'roof', 'trim',
  // props
  'cover', 'foliage', 'trunk',
  // marked
  'objective', 'hazard',
] as const;

export type MaterialRole = (typeof MATERIAL_ROLES)[number];

const ROLE_SET: ReadonlySet<string> = new Set(MATERIAL_ROLES);
export const isMaterialRole = (s: string): s is MaterialRole => ROLE_SET.has(s);
