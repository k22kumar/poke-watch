// The closed registry of post passes (docs/WORLDGEN3D.md Q14.1, Q18.4 as superseded by Q23): ids here, a `Record` of
// implementations in src/render/three/passes.ts. A profile lists the passes it runs, in order; biome bindings, a map's
// `look` and overlays set pass parameters and never add one. A pass at zero weight is not built, and the normals target
// exists only when a built pass needs it. Every list ends in grading, `renderOutput` and the signal composite, which
// are fixed steps, not registry passes.

export const POST_PASS_IDS = ['ink', 'bloom'] as const;
export type PostPassId = (typeof POST_PASS_IDS)[number];

/** what a pass reads from the scene pass besides colour */
export const PASS_NEEDS: Record<PostPassId, { normals: boolean; depth: boolean }> = {
  ink: { normals: true, depth: true },
  bloom: { normals: false, depth: false },
};

export const isPostPassId = (s: string): s is PostPassId => (POST_PASS_IDS as readonly string[]).includes(s);
