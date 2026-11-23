// S2 spike (docs/spikes/S2-renderer.md): ?render=three draws the tile adapter's WorldModel surfaces with three.js, in one
// of three renderer configurations, while the sim runs unchanged and the existing ChaseRig drives the camera. The old
// renderer is not built on this path. Spike code: never merged.
//
// Query: ?render=three&backend=webgl|webgpu|webgpu-gl&map=range|river-gorge&actors=240&shadow=1&shadowSize=2048
//        &shadowExtent=40&cshadow=1&props=none|instanced|batched&propN=500&edges=0|1&res=1280x720&orbit=20&freeze=1&perf=1&species=charmander
import {
  BatchedMesh, BufferAttribute, BufferGeometry, CanvasTexture, Color, DirectionalLight, DynamicDrawUsage, Fog,
  HemisphereLight, IcosahedronGeometry, InstancedBufferAttribute, InstancedBufferGeometry, InstancedMesh, Matrix4, Mesh,
  MeshLambertMaterial, NearestFilter, PerspectiveCamera, Scene, SRGBColorSpace, type Material, type Object3D,
} from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { TEXELS_PER_METRE, dirIndex, frameAt, clipLength, type AnimState, type CreatureArt } from '../../assets/art';
import { artLoader } from '../../assets/loader';
import { RANGE } from '../../mods';
import { ART_DIRECTION } from '../../render/artdirection';
import { CHASE_CONFIG, ChaseRig, lookPitchRange } from '../../render/camera';
import { chaseFrameFor } from '../../render/chaseinput';
import { LEAN_FROM, outlineOf, type Outline } from '../../render/framing';
import { skyFor } from '../../render/sky';
import { BIOMES } from '../../rules/stages';
import { SPECIES, SPECIES_BY_ID } from '../../rules/species';
import { speciesSizing } from '../../rules/sizing';
import { HABITAT_TARGETS, RANGE_TARGETS } from '../../rules/targets';
import { spawnEnemy } from '../../sim/enemies';
import { matchArt } from '../../sim/matchart';
import { createRun, step } from '../../sim/run';
import type { InputFrame, SimContext } from '../../sim/types';
import { fromArenaMap } from '../../world/adapter';
import { worldgenFromQuery } from '../../world/replay';
import type { Backend, BackendId } from './backend';
import { BACKENDS } from './backends';

/** chase walkers across the size classes (scripts/lib/crowd.ts CROWD_SPECIES) */
const CROWD = ['rattata', 'sandshrew', 'sentret', 'ekans', 'poliwag', 'gengar', 'geodude', 'zubat', 'cetoddle', 'centiskorch'];
const FLOATS = 20; // per instance: iA x y z scale | iB w h ax ay | iUV u0 v0 u1 v1 | iC flash dissolve dx bias | iD rgb dy
const ATTRS = ['iA', 'iB', 'iUV', 'iC', 'iD'] as const;

interface Sheet {
  art: CreatureArt; tex: CanvasTexture; scale: number; walkRate: number; outline?: Outline;
  geo: InstancedBufferGeometry; mesh: Mesh; attrs: InstancedBufferAttribute[]; n: number; cap: number;
}

const q = (a: number[], p: number) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]; };
const r2 = (x: number) => Math.round(x * 100) / 100;

function quad(): { pos: BufferAttribute; nrm: BufferAttribute; idx: BufferAttribute } {
  return {
    pos: new BufferAttribute(new Float32Array([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0]), 3),
    nrm: new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]), 3),
    idx: new BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1),
  };
}

export async function bootS2(params: URLSearchParams) {
  const T: Record<string, number> = { script: performance.now() };
  const backendId = (params.get('backend') ?? 'webgl') as BackendId;
  const mapId = params.get('map') ?? 'range';
  const nActors = Number(params.get('actors') ?? 240);
  const shadows = params.get('shadow') !== '0';
  const shadowSize = Number(params.get('shadowSize') ?? 2048);
  const shadowExtent = Number(params.get('shadowExtent') ?? 40);
  const propsMode = params.get('props') ?? 'none';
  const propN = Number(params.get('propN') ?? 500);
  const orbit = Number(params.get('orbit') ?? 0) * (Math.PI / 180);
  const res = params.get('res')?.split('x').map(Number);
  const speciesId = params.get('species') ?? 'charmander';
  // ?freeze=1: no sim ticks after the spawn (the crowd stays on its ring), so every configuration draws the same frames
  const freeze = params.get('freeze') === '1';
  // ?cshadow=1: creature billboards cast shadows too
  const creatureShadows = params.get('cshadow') === '1' && params.get('shadow') !== '0';
  const factory = BACKENDS[backendId];
  if (!factory) throw new Error(`backend ${backendId} is not in this build (built with: ${Object.keys(BACKENDS).join(', ')})`);

  for (const id of ['app']) { const el = document.getElementById(id); if (el) el.style.display = 'none'; }
  document.body.style.cssText = 'margin:0;background:#000;overflow:hidden';
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'display:block';
  document.body.appendChild(canvas);
  const size = () => (res ? [res[0], res[1]] : [window.innerWidth, window.innerHeight]);

  // the sim: the range arena with its targets, or a habitat map (river-gorge seed 1) with the habitat targets
  const biomes = Object.keys(BIOMES);
  const range = mapId === 'range';
  const wg = range ? { ...worldgenFromQuery({ world: 'locations', loc: null, mapseed: null, biomes }), arena: 'range' } : worldgenFromQuery({ world: 'locations', loc: mapId, mapseed: params.get('mapseed') ?? '1', biomes });
  const ctx: SimContext = createRun({ seed: 1, species: speciesId, mode: RANGE, ruleOverrides: { worldgen: wg } as never, targets: range ? RANGE_TARGETS : HABITAT_TARGETS });
  T.run = performance.now();

  // art: the manifest, then the match's species and the crowd's
  const arts = new Map<string, CreatureArt>();
  artLoader.onArt = (id, art) => arts.set(id, art);
  await artLoader.boot();
  const crowd = CROWD.filter((id) => SPECIES_BY_ID[id] && artLoader.has(id));
  await artLoader.ensure([...matchArt(ctx, RANGE), ...crowd]);
  T.art = performance.now();

  // 240 actors: chase walkers on a golden-angle ring around the player (the player cannot be hurt: iframes each tick)
  const P = ctx.player, GOLD = Math.PI * (3 - Math.sqrt(5));
  for (let k = 0; k < nActors; k++) {
    const a = k * GOLD, r = 6 + 24 * ((k * 0.618034) % 1);
    try { spawnEnemy(ctx, crowd[k % crowd.length], P.x + Math.cos(a) * r, P.z + Math.sin(a) * r, 0); } catch { /* a spot the species may not use */ }
  }

  // frozen runs: half a second of ticks first, so the crowd is past its spawn dissolve
  if (freeze) for (let k = 0; k < 30; k++) { P.iframes = 1; step(ctx, { mx: 0, mz: 0, jump: false, dash: false }); }

  // the renderer
  const B: Backend = await factory(canvas);
  const [w0, h0] = size();
  B.setSize(w0, h0);
  B.setShadows(shadows);
  T.renderer = performance.now();

  // the scene: the adapter's surfaces, a hemisphere light, a sun with a shadow map, fog
  const scene = new Scene();
  const artKey = ctx.world.map.gen?.loc?.art ?? ctx.world.biome.id;
  const sky = skyFor(artKey);
  const AD = ART_DIRECTION[ctx.world.biome.id];
  scene.background = new Color(...sky.hor);
  scene.fog = new Fog(new Color(...sky.hor), sky.fogNear, sky.fogFar * 1.5);
  scene.add(new HemisphereLight(new Color(...sky.zen), new Color(0.32, 0.3, 0.26), 1.1));
  const sun = new DirectionalLight(new Color(1, 0.96, 0.88), 2.2);
  // the sun's direction (toward it); the default stands north of a camera that starts looking north, so shadows fall
  // toward the lens and can be seen
  const SUN = (params.get('sun') ?? '0.35,0.7,-0.6').split(',').map(Number);
  sun.castShadow = shadows;
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  sun.shadow.radius = 2;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.03;
  Object.assign(sun.shadow.camera, { left: -shadowExtent, right: shadowExtent, top: shadowExtent, bottom: -shadowExtent, near: 1, far: 200 });
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun, sun.target);

  const wm = fromArenaMap(ctx.world.map);
  T.adapter = performance.now();
  const terrain = new MeshLambertMaterial({ vertexColors: true });
  const liquid = new MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.78, depthWrite: false });
  let terrainTris = 0;
  for (const c of wm.surfaces) {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(c.positions, 3));
    g.setAttribute('normal', new BufferAttribute(c.normals, 3));
    g.setAttribute('color', new BufferAttribute(c.colours, 3));
    g.setIndex(new BufferAttribute(c.indices, 1));
    g.computeBoundingSphere();
    terrainTris += c.indices.length / 3;
    const m = new Mesh(g, c.material === 'liquid' ? liquid : terrain);
    m.castShadow = c.material !== 'liquid'; m.receiveShadow = true;
    scene.add(m);
  }

  // 500 identical props as one InstancedMesh or one BatchedMesh (draw-call comparison)
  if (propsMode !== 'none') {
    const pg = mergeVertices(new IcosahedronGeometry(1, 1)); pg.scale(0.9, 1.3, 0.9); pg.translate(0, 1.2, 0);
    const pm = new MeshLambertMaterial({ color: 0x4f7a3a });
    const mats: Matrix4[] = [];
    for (let k = 0; k < propN; k++) {
      const a = k * GOLD + 0.3, r = 10 + 40 * ((k * 0.381966) % 1);
      const x = P.x + Math.cos(a) * r, z = P.z + Math.sin(a) * r;
      mats.push(new Matrix4().makeTranslation(x, ctx.world.height(x, z), z));
    }
    let o: Object3D;
    if (propsMode === 'batched') {
      const bm = new BatchedMesh(propN, pg.attributes.position.count, pg.index!.count, pm);
      const gid = bm.addGeometry(pg);
      for (const m of mats) bm.setMatrixAt(bm.addInstance(gid), m);
      o = bm;
    } else {
      const im = new InstancedMesh(pg, pm, propN);
      mats.forEach((m, i) => im.setMatrixAt(i, m));
      o = im;
    }
    o.castShadow = o.receiveShadow = true;
    scene.add(o);
  }

  // creatures: one instanced billboard mesh per atlas, like the game's InstanceBatch per sheet
  const sheets = new Map<string, Sheet>();
  const Q = quad();
  const sheetOf = (id: string): Sheet | undefined => {
    let s = sheets.get(id);
    if (s) return s;
    const art = arts.get(id);
    if (!art) return undefined;
    const sp = SPECIES_BY_ID[id];
    const tex = new CanvasTexture(art.atlas);
    tex.magFilter = tex.minFilter = NearestFilter; tex.generateMipmaps = false; tex.flipY = false; tex.colorSpace = SRGBColorSpace;
    const cap = id === speciesId ? 2 : 256;
    const geo = new InstancedBufferGeometry();
    geo.setAttribute('position', Q.pos); geo.setAttribute('normal', Q.nrm); geo.setIndex(Q.idx);
    const attrs = ATTRS.map((n) => { const a = new InstancedBufferAttribute(new Float32Array(cap * 4), 4); a.setUsage(DynamicDrawUsage); geo.setAttribute(n, a); return a; });
    geo.instanceCount = 0;
    const mesh = new Mesh(geo, B.creatureMaterial(tex, false));
    mesh.frustumCulled = false;
    if (creatureShadows) B.creatureShadow(mesh, tex);
    scene.add(mesh);
    const sz = speciesSizing(sp, art.heightPx / TEXELS_PER_METRE, (art.widthPx ?? 0) / TEXELS_PER_METRE, ctx.rules.size);
    const walk = art.clips.walk;
    s = { art, tex, scale: sz.scale, walkRate: (clipLength(walk) / Math.max(1, walk.durations.length)) * 1.6, outline: art.silhouette ? outlineOf(art.silhouette, sz.scale * (sp?.scale ?? 1)) : undefined, geo, mesh, attrs, n: 0, cap };
    sheets.set(id, s);
    return s;
  };
  for (const id of arts.keys()) sheetOf(id);
  // the x-ray silhouette: the player's own sprite again, depth GREATER, drawn after the opaque pass
  const ps = sheetOf(speciesId)!;
  const xgeo = new InstancedBufferGeometry();
  xgeo.setAttribute('position', Q.pos); xgeo.setAttribute('normal', Q.nrm); xgeo.setIndex(Q.idx);
  const xattrs = ATTRS.map((n) => { const a = new InstancedBufferAttribute(new Float32Array(4), 4); a.setUsage(DynamicDrawUsage); xgeo.setAttribute(n, a); return a; });
  xgeo.instanceCount = 1;
  const xray = new Mesh(xgeo, B.creatureMaterial(ps.tex, true));
  xray.frustumCulled = false; xray.renderOrder = 10;
  scene.add(xray);
  const creatureMeshes = [...[...sheets.values()].map((s) => s.mesh), xray];

  const camera = new PerspectiveCamera(64, w0 / h0, 0.3, 240);
  camera.rotation.order = 'YXZ';
  scene.userData.cam = camera; // debug: tools read the camera with the scene
  const rig = new ChaseRig();
  rig.snapTo(P.x, P.y, P.z, Math.PI);
  if (params.get('edges') === '1') B.enableEdges(scene, camera, creatureMeshes);
  T.scene = performance.now();

  // input: WASD relative to the camera yaw, drag or pointer lock to look
  const keys = new Set<string>();
  addEventListener('keydown', (e) => keys.add(e.code));
  addEventListener('keyup', (e) => keys.delete(e.code));
  let ldx = 0, ldy = 0, drag = false;
  canvas.addEventListener('mousedown', () => { drag = true; canvas.requestPointerLock?.(); });
  addEventListener('mouseup', () => (drag = false));
  addEventListener('mousemove', (e) => { if (drag || document.pointerLockElement === canvas) { ldx += e.movementX; ldy += e.movementY; } });
  const input = (): InputFrame => {
    const f = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0), s = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    const y = rig.yaw, fx = Math.sin(y), fz = Math.cos(y), rx = -Math.cos(y), rz = Math.sin(y);
    let mx = fx * f + rx * s, mz = fz * f + rz * s; const l = Math.hypot(mx, mz); if (l > 1) { mx /= l; mz /= l; }
    return { mx, mz, jump: keys.has('Space'), dash: false };
  };

  // stats: frame intervals, CPU render time, sim time, renderer info
  const st = { iv: [] as number[], cpu: [] as number[], sim: [] as number[], gpu: [] as number[], calls: 0, tris: 0, drawn: 0 };
  const overlay = params.has('perf') ? document.createElement('pre') : null;
  if (overlay) { overlay.style.cssText = 'position:fixed;left:8px;top:8px;margin:0;z-index:9;background:rgba(10,14,24,.84);color:#e8eefc;font:12px/1.4 ui-monospace,Menlo,monospace;padding:8px 10px;border-radius:6px;pointer-events:none'; document.body.appendChild(overlay); }
  let textT = 0;
  const report = (ivs = st.iv, cpus = st.cpu, sims = st.sim, gpus = st.gpu) => ({
    backend: B.id, actual: B.actual, map: mapId, creatureShadows, res: `${canvas.width}x${canvas.height}`, shadows, shadowSize, props: propsMode, propN, edges: B.edges, actors: nActors,
    frames: ivs.length, fps: r2(1000 / q(ivs, 0.5)),
    frameMs: { p50: r2(q(ivs, 0.5)), p95: r2(q(ivs, 0.95)), p99: r2(q(ivs, 0.99)), max: r2(q(ivs, 1)) },
    cpuRenderMs: { p50: r2(q(cpus, 0.5)), p95: r2(q(cpus, 0.95)) }, simMs: { p50: r2(q(sims, 0.5)), p95: r2(q(sims, 0.95)) },
    gpuMs: gpus.length ? { p50: r2(q(gpus, 0.5)), p95: r2(q(gpus, 0.95)) } : null,
    calls: st.calls, triangles: st.tris, terrainTris, creaturesDrawn: st.drawn, surfaces: wm.surfaces.length,
    boot: Object.fromEntries(Object.entries(T).map(([k, v]) => [k, Math.round(v)])), notes: B.notes, ua: navigator.userAgent,
  });

  const fillCreatures = (alpha: number) => {
    for (const s of sheets.values()) s.n = 0;
    const yaw = rig.yaw, E = ctx.enemies;
    let drawn = 0;
    const push = (s: Sheet, x: number, y: number, z: number, scale: number, facing: number, state: AnimState, t: number, flash: number, dis: number, tint: number[], out = s) => {
      const clip = s.art.clips[state];
      const dir = dirIndex(facing - (yaw - Math.PI));
      const row = clip.frames[dir] ?? clip.frames[0];
      const f = row[Math.min(frameAt(clip, t), row.length - 1)];
      if (out.n >= out.cap) return;
      const k = out.n++ * 4, tw = s.art.atlas.width, th = s.art.atlas.height;
      const v = [[x, y, z, scale * s.scale], [f.w, f.h, f.ax, f.ay], [f.x / tw, f.y / th, (f.x + f.w) / tw, (f.y + f.h) / th], [flash, dis, 0, 0], [tint[0], tint[1], tint[2], 0]];
      for (let a = 0; a < 5; a++) out.attrs[a].array.set(v[a], k);
      drawn++;
    };
    for (let i = 0; i < E.hi; i++) {
      if (!E.alive[i]) continue;
      const sp = SPECIES[E.species[i]], s = sheetOf(sp.id);
      if (!s) continue;
      const x = E.px[i] + (E.x[i] - E.px[i]) * alpha, y = E.py[i] + (E.y[i] - E.py[i]) * alpha, z = E.pz[i] + (E.z[i] - E.pz[i]) * alpha;
      const hurt = E.flash[i] > 0;
      push(s, x, y, z, E.size[i] * (sp.scale ?? 1), E.facing[i], hurt ? 'hurt' : 'walk', hurt ? 0.12 - E.flash[i] : E.animT[i] * s.walkRate, hurt ? 0.85 : 0, E.spawnT[i] < 0.25 ? (1 - E.spawnT[i] / 0.25) * 0.9 : 0, [1, 1, 1]);
    }
    const px = P.px + (P.x - P.px) * alpha, py = P.py + (P.y - P.py) * alpha, pz = P.pz + (P.z - P.pz) * alpha;
    const state: AnimState = P.moving || !P.grounded ? 'walk' : 'idle';
    const t = state === 'walk' ? P.animT * ps.walkRate : performance.now() / 1000;
    push(ps, px, py + rig.spriteStep, pz, 1, P.facing, state, t, 0, 0, [1, 1, 1]);
    const xs = { ...ps, attrs: xattrs, n: 0, cap: 1 };
    push(ps, px, py + rig.spriteStep, pz, 1, P.facing, state, t, 0, 0, [1, 1, 1], xs);
    for (const a of xattrs) a.needsUpdate = true;
    for (const s of sheets.values()) {
      s.geo.instanceCount = s.n; s.mesh.visible = s.n > 0;
      if (s.n) for (const a of s.attrs) { a.clearUpdateRanges(); a.addUpdateRange(0, s.n * 4); a.needsUpdate = true; }
    }
    st.drawn = drawn;
  };

  let last = performance.now(), acc = 0, first = true;
  const DT = 1 / 60;
  const frame = (now: number) => {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000);
    if (!first) st.iv.push(now - last);
    last = now;
    // sim: fixed ticks, the player kept alive
    const t0 = performance.now();
    acc += dt;
    let n = 0;
    while (!freeze && acc >= DT && n < 4) { P.iframes = 1; step(ctx, input()); acc -= DT; n++; }
    if (n === 4 || freeze) acc = 0;
    const t1 = performance.now();
    // camera: look input, then the rig's one update per frame (render/renderer.ts order)
    if (orbit) rig.look(orbit * dt, 0);
    if (ldx || ldy) { rig.look(ldx * 0.0025, ldy * 0.0025); ldx = ldy = 0; }
    const alpha = acc / DT;
    const px = P.px + (P.x - P.px) * alpha, py = P.py + (P.y - P.py) * alpha, pz = P.pz + (P.z - P.pz) * alpha;
    rig.update(chaseFrameFor(ctx, { dt, x: px, y: py, z: pz, lookPitch: 0, outline: ps.outline }), { pitchRange: lookPitchRange(), fovOffset: 0 });
    const [cw, ch] = size();
    if (canvas.width !== cw || canvas.height !== ch) { B.setSize(cw, ch); camera.aspect = cw / ch; }
    camera.position.set(rig.eye[0], rig.eye[1], rig.eye[2]);
    camera.rotation.set(-rig.viewPitch, rig.yaw - Math.PI, 0);
    camera.fov = (rig.fov * 180) / Math.PI; camera.updateProjectionMatrix();
    // the sun's shadow box follows the player
    sun.target.position.set(px, py, pz); sun.position.set(px + SUN[0] * 60, py + SUN[1] * 60, pz + SUN[2] * 60);
    // creature uniforms
    B.cu.right.set(-Math.cos(rig.yaw), 0, Math.sin(rig.yaw)); B.cu.fwd.set(Math.sin(rig.yaw), 0, Math.cos(rig.yaw));
    B.cu.cam.set(rig.eye[0], rig.eye[1], rig.eye[2]); B.cu.lean.value = CHASE_CONFIG.lean ? LEAN_FROM : 0;
    if (AD) B.cu.light.set(...AD.actor);
    fillCreatures(alpha);
    const t2 = performance.now();
    B.render(scene, camera);
    const t3 = performance.now();
    const inf = B.info();
    st.calls = inf.calls; st.tris = inf.triangles;
    if (!first) { st.cpu.push(t3 - t2); st.sim.push(t1 - t0); if (inf.gpuMs !== null && inf.gpuMs > 0) st.gpu.push(inf.gpuMs); }
    for (const k of ['iv', 'cpu', 'sim', 'gpu'] as const) if (st[k].length > 6000) st[k].splice(0, 3000);
    if (first) { first = false; T.firstRender = t3; requestAnimationFrame(() => { T.firstFrame = performance.now(); S2.ready = true; console.info('[s2] first frame at', Math.round(T.firstFrame), 'ms'); }); }
    textT -= dt;
    if (overlay && textT <= 0) {
      textT = 0.25;
      const n2 = Math.min(st.iv.length, 240), r = report(st.iv.slice(-n2), st.cpu.slice(-n2), st.sim.slice(-n2), st.gpu.slice(-n2));
      overlay.textContent = `S2 three.js spike  ${r.actual}\n${r.map} ${r.res}  actors ${r.creaturesDrawn}  shadows ${shadows ? shadowSize : 'off'}  props ${propsMode}  edges ${r.edges ? 'on' : 'off'}\n` +
        `fps ${r.fps}   frame p50 ${r.frameMs.p50}  p95 ${r.frameMs.p95}  p99 ${r.frameMs.p99} ms\n` +
        `cpu render p50 ${r.cpuRenderMs.p50}  p95 ${r.cpuRenderMs.p95} ms   sim p95 ${r.simMs.p95} ms\n` +
        `gpu ${r.gpuMs ? `p50 ${r.gpuMs.p50}  p95 ${r.gpuMs.p95} ms` : 'n/a'}\n` +
        `draw calls ${r.calls}   triangles ${r.triangles}\nboot first frame ${r.boot.firstFrame ?? '…'} ms\n${B.notes.join('  ')}`;
    }
  };
  // tools/s2perf.mjs: collect `seconds` of frames from now and report percentiles
  const S2 = {
    ready: false, report: () => report(),
    collect: (seconds: number) => new Promise((res2) => { for (const k of ['iv', 'cpu', 'sim', 'gpu'] as const) st[k].length = 0; setTimeout(() => res2(report()), seconds * 1000); }),
    ctx, rig, scene, B,
  };
  (window as unknown as { s2: typeof S2 }).s2 = S2;
  requestAnimationFrame(frame);
  void (null as unknown as Material);
}
