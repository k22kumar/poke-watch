
/** Simple textured box (furniture, counters, bridge rails): returns pos3 uv2 shade1 into `out` using a solid-colour pixel texture region. */
export function boxGeo(out: number[], x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, uvTop: number[], uvSide: number[]) {
  const q = (a: number[], b: number[], c: number[], d: number[], uv: number[], s: number) => {
    const [u0, v0, u1, v1] = uv;
    out.push(...a, u0, v1, s, ...b, u1, v1, s, ...c, u1, v0, s, ...a, u0, v1, s, ...c, u1, v0, s, ...d, u0, v0, s);
  };
  q([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], uvTop, 1);
  q([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], uvSide, 0.85);
  q([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], uvSide, 0.7);
  q([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], uvSide, 0.62);
}
