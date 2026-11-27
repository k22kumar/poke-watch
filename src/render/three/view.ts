// The three.js scene (task I2a; docs/RENDER3D.md): the WorldModel's chunks as world meshes in the material family,
// the light rig read from one time-of-day value, the sky and the fog curve, the creature billboards S2 ported, and the
// RenderPipeline. It draws from the page renderer's lens and reads sim state, never writes it.
//
// Dev URL parameters (docs/RENDER3D.md "Dev parameters"): backend, profile, tod (D12), shadow, perf, the dev
// experiment layer of Q18.4a (ink, inkshare, bloom, bloomres, edge, facet, vgrad, strata, bands, soft, grade), lamps=0, signalcheck
// and bench3.
import {
  BoxGeometry, BufferAttribute, BufferGeometry, CanvasTexture, Color, DirectionalLight, IcosahedronGeometry, InstancedBufferAttribute, InstancedBufferGeometry,
  InstancedMesh, Matrix4, Mesh, MeshBasicNodeMaterial, NearestFilter, PCFShadowMap, PerspectiveCamera, PlaneGeometry, Scene, SRGBColorSpace, AdditiveBlending, type NodeMaterial,
} from 'three/webgpu';
import { Fn, attribute, clamp, floor, fog, length, mix, mod, positionGeometry, positionView, positionWorldDirection, pow, screenCoordinate, uniform, vec3, vec4, float, uv } from 'three/tsl';
import { dirIndex, frameAt, type AnimState, type CreatureArt } from '../../assets/art';
import type { SimContext } from '../../sim/types';
import { isProfileId, type ProfileId } from '../../rules/styles/profiles';
import { PASS_NEEDS } from '../../rules/styles/passes';
import { resolve, type ResolvedStyle } from '../../rules/styles/resolve';
import { hourFromParam } from '../../rules/styles/timeofday';
import type { CreateThreeView, ThreeCamera, ThreeReport, ThreeSheet, ThreeView } from '../threehost';
import { devLayer } from '../world3d/devlayer';
import { lightAt, type LightUniforms } from '../world3d/lighting';
import { buildWorld, type WorldBuild } from '../world3d/mesh';
import { createBackend, backendPick } from './backend';
import { CardBatch, CreatureUniforms, creatureMaterial } from './billboard';
import { Grade, bayer4, buildPipeline, type Pipeline } from './passes';
import { WorldLight, liquidMaterial, worldMaterial } from './worldmat';

type N = any; // TSL node chains are loosely typed in @types/three 0.187 (S2 F42)

/** the fog veil past `far` (render/view.ts FOG_VEIL: today's curve) */
const FOG_VEIL = 0.5;
/** the sun's shadow box follows the player (S2: ±40 m, 2048²) */
const SHADOW_EXTENT = 40, SHADOW_SIZE = 2048;

const q = (a: number[], p: number) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]; };
const r2 = (x: number) => Math.round(x * 100) / 100;

interface Sheet { art: CreatureArt; tex: CanvasTexture; batch: CardBatch; info: ThreeSheet }

export const createThreeView: CreateThreeView = async (host) => {
  const P0 = host.params;
  const perf = P0.has('perf') || P0.has('bench3');
  const T: Record<string, number> = { start: performance.now() };
  const B = await createBackend(host.canvas, backendPick(P0.get('backend')), perf);
  const R = B.renderer;
  const shadows = P0.get('shadow') !== '0';
  R.shadowMap.enabled = shadows; R.shadowMap.type = PCFShadowMap;
  R.setClearColor(0x000000, 0);
  T.renderer = performance.now();
  const profile: ProfileId = isProfileId(P0.get('profile')) ? (P0.get('profile') as ProfileId) : 'lowpoly';
  const dev = devLayer(P0);

  const scene = new Scene();
  const signals = P0.has('signalcheck') ? new Scene() : null;
  const camera = new PerspectiveCamera(64, 1, 0.3, 240);
  camera.rotation.order = 'YXZ';

  // the light rig's consumers: every one is written by `apply` alone (the one path, D12)
  const W = new WorldLight(), G = new Grade(), CU = new CreatureUniforms();
  const uFog: N = uniform(new Color()), uFogNear: N = uniform(30), uFogFar: N = uniform(130), uFogK: N = uniform(0.85);
  const uHor: N = uniform(new Color()), uZen: N = uniform(new Color());
  // today's fog curve (render/tilestage.ts FOG_GLSL): a squared ramp to the biome's amount at `far`, then a veil
  const dist: N = length(positionView);
  const f: N = clamp(dist.sub(uFogNear).div(uFogFar.sub(uFogNear)), 0, 1);
  const veil: N = clamp(dist.sub(uFogFar).div(uFogFar.mul(FOG_VEIL)), 0, 1);
  scene.fogNode = (fog as N)(uFog, f.mul(f).mul(uFogK).add(float(1).sub(uFogK).mul(veil)));
  // today's sky (render/renderer.ts SKY_FS): horizon to zenith in six dithered bands, the fog colour below the horizon
  scene.backgroundNode = Fn(() => {
    const t = clamp(positionWorldDirection.y.div(0.75), 0, 1);
    const th = bayer4(mod(floor(screenCoordinate.xy), 4.0));
    const qn = floor(pow(t, 0.7).mul(6).add(th)).div(6);
    return (vec4 as N)(mix(uHor, uZen, qn), 1);
  })();

  const sun = new DirectionalLight(0xffffff, 1);
  sun.castShadow = shadows;
  sun.shadow.mapSize.set(SHADOW_SIZE, SHADOW_SIZE);
  // S2's bias left acne on level ground under a low sun; 0.08 m of normal bias clears it down to about 15° of sun
  // elevation, and whole-tile stripes remain below that (ROADMAP F110)
  sun.shadow.radius = 2; sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.08;
  Object.assign(sun.shadow.camera, { left: -SHADOW_EXTENT, right: SHADOW_EXTENT, top: SHADOW_EXTENT, bottom: -SHADOW_EXTENT, near: 1, far: 200 });
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun, sun.target);
  let sunDir: [number, number, number] = [0.5, 0.8, 0.3];

  /** apply one instant's lighting: the only writer of every light, fog, sky and grading uniform */
  let applied: LightUniforms | null = null;
  const apply = (L: LightUniforms) => {
    applied = L;
    W.apply(L); G.apply(L);
    sun.color.setRGB(L.sun[0], L.sun[1], L.sun[2]); sun.intensity = 1; sunDir = L.sunDir;
    (uFog.value as Color).setRGB(...L.fogColour); uFogNear.value = L.fogNear; uFogFar.value = L.fogFar; uFogK.value = L.fogAmount;
    (uHor.value as Color).setRGB(...L.skyHor); (uZen.value as Color).setRGB(...L.skyZen);
  };

  // ---- the world ----------------------------------------------------------------------------------------------
  let map: unknown = null, style: ResolvedStyle | null = null, built: WorldBuild | null = null, pipeline: Pipeline | null = null, hour = 0;
  let worldMeshes: Mesh[] = [];
  const mats: NodeMaterial[] = [];
  const setWorld = (ctx: SimContext) => {
    const t0 = performance.now();
    for (const m of worldMeshes) { scene.remove(m); m.geometry.dispose(); }
    for (const m of mats) m.dispose();
    worldMeshes = []; mats.length = 0;
    pipeline?.pipe.dispose();
    const w = host.world(ctx);
    const stagings = w.model.markers.filter((m) => m.kind === 'staging').map((m) => [m.position[0], m.position[2]] as [number, number]);
    style = resolve(profile, w.artKey, { overlay: dev, stagings });
    const S = style;
    built = buildWorld(w.model, { normalMode: (r) => S.roles[r].normal, creaseAngle: S.creaseAngle, lamps: P0.get('lamps') === '0' ? [] : w.lamps });
    const byRole = new Map<string, NodeMaterial>();
    const normalsNeeded = S.passes.some((id) => PASS_NEEDS[id].normals);
    for (const c of built.chunks) {
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(c.positions, 3));
      g.setAttribute('normal', new BufferAttribute(c.normals, 3));
      g.setAttribute('aSky', new BufferAttribute(c.sky, 1));
      g.setAttribute('aLamp', new BufferAttribute(c.lamp, 3));
      g.setAttribute('aFacet', new BufferAttribute(c.facet, 1));
      g.setAttribute('aDepth', new BufferAttribute(c.depth, 1));
      g.setIndex(new BufferAttribute(c.indices, 1));
      g.computeBoundingSphere();
      const id = c.kind === 'liquid' ? `liquid:${c.liquid}` : c.role!;
      let mat = byRole.get(id);
      if (!mat) {
        if (c.kind === 'liquid') {
          const L = S.liquids[c.liquid!] ?? S.liquids.water;
          mat = liquidMaterial(hexToRgb(L.colour), L.emissive, S.liquid.opacity, S.liquid.ramp, W);
        } else mat = worldMaterial(S.roles[c.role!], S.paint, W, normalsNeeded);
        byRole.set(id, mat); mats.push(mat);
      }
      const mesh = new Mesh(g, mat);
      mesh.castShadow = c.kind !== 'liquid'; mesh.receiveShadow = true;
      scene.add(mesh); worldMeshes.push(mesh);
    }
    CU.light.set(...S.actor);
    hour = hourFromParam(P0.get('tod'), S.time.hour);
    apply(lightAt(S.time, hour));
    pipeline = buildPipeline(R, scene, signals, camera, S, G);
    map = ctx.world.map;
    T.world = performance.now() - t0;
    if (S.log.length) console.info('[three] style clamps:', S.log.join('; '));
  };

  // ---- creatures (S2's port) ----------------------------------------------------------------------------------
  const arts = new Map<string, CreatureArt>();
  const sheets = new Map<string, Sheet>();
  const sheetOf = (id: string): Sheet | undefined => {
    let s = sheets.get(id);
    if (s) return s;
    const art = arts.get(id), info = host.sheet(id);
    if (!art || !info) return undefined;
    const tex = new CanvasTexture(art.atlas);
    tex.magFilter = tex.minFilter = NearestFilter; tex.generateMipmaps = false; tex.flipY = false; tex.colorSpace = SRGBColorSpace;
    const mat = creatureMaterial(CU, tex, false);
    // the player's species may also walk as enemies: one batch per atlas, room for the crowd
    const batch = new CardBatch(256, mat);
    scene.add(batch.mesh);
    s = { art, tex, batch, info };
    sheets.set(id, s);
    return s;
  };
  let xray: { id: string; batch: CardBatch } | null = null;
  const xrayOf = (s: Sheet, id: string) => {
    if (xray?.id === id) return xray.batch;
    if (xray) { scene.remove(xray.batch.mesh); xray.batch.geo.dispose(); }
    const m = creatureMaterial(CU, s.tex, true);
    const b = new CardBatch(1, m);
    b.mesh.renderOrder = 10;
    scene.add(b.mesh);
    xray = { id, batch: b };
    return b;
  };
  const v20 = new Float32Array(20);
  const push = (s: Sheet, out: CardBatch, yaw: number, x: number, y: number, z: number, scale: number, facing: number, state: AnimState, t: number, flash: number, dis: number) => {
    const clip = s.art.clips[state] ?? s.art.clips.idle;
    const row = clip.frames[dirIndex(facing - (yaw - Math.PI))] ?? clip.frames[0];
    const fr = row[Math.min(frameAt(clip, t), row.length - 1)];
    const tw = s.art.atlas.width, th = s.art.atlas.height;
    v20.set([x, y, z, scale * s.info.scale, fr.w, fr.h, fr.ax, fr.ay, fr.x / tw, fr.y / th, (fr.x + fr.w) / tw, (fr.y + fr.h) / th, flash, dis, 0, 0, 1, 1, 1, 0]);
    out.push(v20);
  };
  let drawn = 0;
  const fillCreatures = (ctx: SimContext, alpha: number, cam: ThreeCamera) => {
    for (const s of sheets.values()) s.batch.n = 0;
    const E = ctx.enemies, yaw = cam.yaw;
    drawn = 0;
    for (let i = 0; i < E.hi; i++) {
      if (!E.alive[i]) continue;
      const sp = ctx.speciesIndex[E.species[i]], s = sheetOf(sp.id);
      if (!s) continue;
      const x = E.px[i] + (E.x[i] - E.px[i]) * alpha, y = E.py[i] + (E.y[i] - E.py[i]) * alpha, z = E.pz[i] + (E.z[i] - E.pz[i]) * alpha;
      const hurt = E.flash[i] > 0;
      push(s, s.batch, yaw, x, y, z, E.size[i] * (sp.scale ?? 1), E.facing[i], hurt ? 'hurt' : 'walk', hurt ? 0.12 - E.flash[i] : E.animT[i] * s.info.walkRate, hurt ? 0.85 : 0, E.spawnT[i] < 0.25 ? (1 - E.spawnT[i] / 0.25) * 0.9 : 0);
      drawn++;
    }
    const P = ctx.player, ps = sheetOf(P.species.id);
    if (ps) {
      const px = P.px + (P.x - P.px) * alpha, py = P.py + (P.y - P.py) * alpha + cam.spriteStep, pz = P.pz + (P.z - P.pz) * alpha;
      const state: AnimState = P.moving || !P.grounded ? 'walk' : 'idle';
      const t = state === 'walk' ? P.animT * ps.info.walkRate : ctx.time;
      push(ps, ps.batch, yaw, px, py, pz, 1, P.facing, state, t, 0, 0);
      const xb = xrayOf(ps, P.species.id);
      xb.n = 0;
      push(ps, xb, yaw, px, py, pz, 1, P.facing, state, t, 0, 0);
      xb.commit();
      drawn++;
    }
    for (const s of sheets.values()) s.batch.commit();
  };

  // ---- dev: the signal check and the budget benches -------------------------------------------------------------
  // the signal check (tools/three-signal.mjs): signal cards in the signal scene and world cards of the same colour in
  // the world scene, a pair 3 m ahead of the lens and a pair 100 m ahead (inside the fog), each sized to the same share
  // of the screen. Grading, fog and bloom change the world cards and must leave the signal cards alone
  const SIGNAL_LIN: [number, number, number] = [1, 0.1329, 0.0144]; // sRGB (255, 102, 31), a hostile orange
  const cards: { mesh: Mesh; dist: number; side: number }[] = [];
  if (signals) {
    for (const [dist, side] of [[3, -1], [100, -1], [3, 1], [100, 1]] as const) {
      const m = new MeshBasicNodeMaterial(); m.colorNode = vec4(vec3(...SIGNAL_LIN), 1);
      const signal = cards.length < 2;
      if (signal) m.fog = false;
      const mesh = new Mesh(new PlaneGeometry(1, 1), m);
      mesh.scale.setScalar(dist * 0.12);
      (signal ? signals : scene).add(mesh);
      cards.push({ mesh, dist, side });
    }
  }
  /** each check card's centre on screen (CSS px), signal cards first: near, far */
  const probe = () => cards.map((c) => { const v = c.mesh.position.clone().project(camera); return [Math.round((v.x * 0.5 + 0.5) * w0), Math.round((-v.y * 0.5 + 0.5) * h0)]; });
  const bench = new Map((P0.get('bench3') ?? '').split(',').filter(Boolean).map((s) => { const [k, v] = s.split(':'); return [k, Number(v)] as const; }));
  const benchStats: Record<string, number> = {};
  let benchCards: { geo: InstancedBufferGeometry; uR: N; uU: N } | null = null;
  const addBench = (ctx: SimContext) => {
    const P = ctx.player, GOLD = Math.PI * (3 - Math.sqrt(5)), M = new Matrix4();
    if (bench.has('backdrop') && style) {
      // a backdrop: low-poly hulls (an 80-triangle icosphere) on a ring past the map bounds, no shadow casting (Q17.8)
      const n = bench.get('backdrop')!, g = new IcosahedronGeometry(1, 1), mesh = new InstancedMesh(g, worldMaterial(style.roles.rock, style.paint, W), n);
      const b = built!.field;
      const rx = (b.nx * b.cell) / 2 + 8, rz = (b.nz * b.cell) / 2 + 8, cx = b.x0 + (b.nx * b.cell) / 2, cz = b.z0 + (b.nz * b.cell) / 2;
      for (let k = 0; k < n; k++) { const a = k * GOLD, r = 1 + ((k * 0.618) % 1) * 0.6, s = 3 + ((k * 0.381) % 1) * 9; M.makeScale(s, s * 1.4, s).setPosition(cx + Math.cos(a) * rx * r, P.y - 2, cz + Math.sin(a) * rz * r); mesh.setMatrixAt(k, M); }
      mesh.geometry.setAttribute('aSky', new InstancedBufferAttribute(new Float32Array(n).fill(1), 1));
      g.setAttribute('aSky', new BufferAttribute(new Float32Array(g.attributes.position.count).fill(1), 1));
      g.setAttribute('aLamp', new BufferAttribute(new Float32Array(g.attributes.position.count * 3), 3));
      mesh.castShadow = false; mesh.receiveShadow = false; mesh.frustumCulled = false;
      scene.add(mesh); benchStats.backdropTris = n * 80;
    }
    if (bench.has('strokes') && style) {
      // painted accents as stroke geometry (Q23.6): thin raised quads on the ground around the player
      const n = bench.get('strokes')!, g = new BoxGeometry(0.5, 0.02, 0.05);
      g.setAttribute('aSky', new BufferAttribute(new Float32Array(g.attributes.position.count).fill(1), 1));
      g.setAttribute('aLamp', new BufferAttribute(new Float32Array(g.attributes.position.count * 3), 3));
      const mesh = new InstancedMesh(g, worldMaterial(style.roles.path, style.paint, W), n);
      for (let k = 0; k < n; k++) { const a = k * GOLD, r = 1 + 30 * Math.sqrt((k + 0.5) / n); M.makeRotationY(a * 3).setPosition(P.x + Math.cos(a) * r, P.y + 0.012, P.z + Math.sin(a) * r); mesh.setMatrixAt(k, M); }
      mesh.receiveShadow = true; mesh.frustumCulled = false;
      scene.add(mesh); benchStats.strokeTris = n * 12;
    }
    if (bench.has('cards')) {
      // particle cards (Q23 effect cards): additive glow sprites from shader maths, camera-facing, over the lens's view
      const n = bench.get('cards')!, geo = new InstancedBufferGeometry();
      geo.setAttribute('position', new BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
      geo.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
      geo.setIndex(new BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1));
      const ip = new Float32Array(n * 4);
      for (let k = 0; k < n; k++) { const a = k * GOLD, r = 2 + 10 * ((k * 0.618) % 1); ip.set([P.x + Math.cos(a) * r, P.y + 0.5 + ((k * 0.37) % 1) * 2.5, P.z + Math.sin(a) * r, 1.2], k * 4); }
      geo.setAttribute('iP', new InstancedBufferAttribute(ip, 4));
      geo.instanceCount = n;
      const uR: N = uniform(new Color(1, 0, 0)), uU: N = uniform(new Color(0, 1, 0));
      const m = new MeshBasicNodeMaterial();
      const iP: N = attribute('iP', 'vec4');
      m.positionNode = iP.xyz.add(vec3(uR).mul(positionGeometry.x.mul(iP.w))).add(vec3(uU).mul(positionGeometry.y.mul(iP.w)));
      const d: N = length(uv().sub(0.5)).mul(2);
      m.colorNode = vec4(vec3(1, 0.7, 0.35).mul(pow(clamp(float(1).sub(d), 0, 1), 2)), 1);
      m.transparent = true; m.depthWrite = false; m.blending = AdditiveBlending;
      const mesh = new Mesh(geo, m); mesh.frustumCulled = false; scene.add(mesh);
      benchCards = { geo, uR, uU }; benchStats.cards = n;
    }
  };

  // ---- the frame ------------------------------------------------------------------------------------------------
  const st = { iv: [] as number[], cpu: [] as number[], gpu: [] as number[], calls: 0, tris: 0 };
  let last = -1, w0 = 1, h0 = 1, benched = false;
  const overlay = P0.has('perf') ? document.createElement('pre') : null;
  if (overlay) { overlay.style.cssText = 'position:fixed;right:8px;top:8px;margin:0;z-index:9;background:rgba(10,14,24,.84);color:#e8eefc;font:12px/1.4 ui-monospace,Menlo,monospace;padding:8px 10px;border-radius:6px;pointer-events:none'; document.body.appendChild(overlay); }
  let textT = 0;
  const report = (iv = st.iv, cpu = st.cpu, gpu = st.gpu): ThreeReport => ({
    backend: B.actual, pick: B.pick, profile, passes: pipeline?.built ?? [], normals: pipeline?.normals ?? false, signals: pipeline?.signals ?? false,
    res: `${host.canvas.width}x${host.canvas.height}`, shadows, hour, binding: style?.binding,
    frames: iv.length, frameMs: { p50: r2(q(iv, 0.5)), p95: r2(q(iv, 0.95)), p99: r2(q(iv, 0.99)) },
    cpuRenderMs: { p50: r2(q(cpu, 0.5)), p95: r2(q(cpu, 0.95)) }, gpuMs: gpu.length ? { p50: r2(q(gpu, 0.5)), p95: r2(q(gpu, 0.95)) } : null,
    calls: st.calls, triangles: st.tris, creaturesDrawn: drawn, world: built?.stats ?? null, bench: benchStats,
    boot: Object.fromEntries(Object.entries(T).map(([k, v]) => [k, Math.round(v)])),
  });

  const view: ThreeView & { scene: Scene; renderer: typeof R; lighting: () => LightUniforms | null; setHour: (h: number) => void; probe: () => number[][] } = {
    backend: B.actual, scene, renderer: R, probe,
    lighting: () => applied,
    setHour: (h: number) => { if (style) { hour = h; apply(lightAt(style.time, h)); } },
    addArt(id, art) { arts.set(id, art); },
    resize(w, h) { w0 = Math.max(1, Math.floor(w)); h0 = Math.max(1, Math.floor(h)); R.setSize(w0, h0, true); camera.aspect = w0 / h0; camera.updateProjectionMatrix(); },
    render(ctx, alpha, cam, _dt) {
      const now = performance.now();
      if (last >= 0) st.iv.push(now - last);
      last = now;
      if (ctx.world.map !== map) setWorld(ctx);
      if (!benched && bench.size) { addBench(ctx); benched = true; }
      camera.position.set(cam.eye[0], cam.eye[1], cam.eye[2]);
      camera.rotation.set(-cam.pitch, cam.yaw - Math.PI, 0);
      camera.fov = (cam.fov * 180) / Math.PI; camera.near = cam.near; camera.far = cam.far; camera.aspect = w0 / h0;
      camera.updateProjectionMatrix();
      const P = ctx.player, px = P.px + (P.x - P.px) * alpha, py = P.py + (P.y - P.py) * alpha, pz = P.pz + (P.z - P.pz) * alpha;
      sun.target.position.set(px, py, pz); sun.position.set(px + sunDir[0] * 60, py + sunDir[1] * 60, pz + sunDir[2] * 60);
      CU.right.set(-Math.cos(cam.yaw), 0, Math.sin(cam.yaw)); CU.fwd.set(Math.sin(cam.yaw), 0, Math.cos(cam.yaw));
      CU.cam.set(cam.eye[0], cam.eye[1], cam.eye[2]); CU.uLean.value = cam.leanFrom;
      if (benchCards) {
        // camera right and up for the camera-facing cards
        camera.updateMatrixWorld();
        const e = camera.matrixWorld.elements;
        (benchCards.uR.value as Color).setRGB(e[0], e[1], e[2]); (benchCards.uU.value as Color).setRGB(e[4], e[5], e[6]);
      }
      if (cards.length) {
        // the cards straight ahead of the lens, either side of centre, facing it
        camera.updateMatrixWorld();
        const e = camera.matrixWorld.elements, fx = -e[8], fy = -e[9], fz = -e[10];
        for (const c of cards) {
          // near cards 0.1 rad either side of centre; far cards 0.3 rad out and 0.35 rad up, in open sky over any terrain
          const far = c.dist > 10, off = c.side * c.dist * (far ? 0.3 : 0.1), up = c.dist * (far ? 0.35 : 0.08);
          c.mesh.position.set(cam.eye[0] + fx * c.dist + e[0] * off, cam.eye[1] + fy * c.dist + e[1] * off + up, cam.eye[2] + fz * c.dist + e[2] * off);
          c.mesh.quaternion.copy(camera.quaternion);
        }
      }
      fillCreatures(ctx, alpha, cam);
      const t0 = performance.now();
      // one node frame per drawn frame: PassNode renders once per frame id, and three advances the id only on its own
      // rAF tick, so capture mode (many frames in one task, pokewatch.advance) would redraw a stale scene pass
      (R as N)._nodes.nodeFrame.update();
      R.info.autoReset = false; R.info.reset();
      pipeline!.pipe.render();
      R.info.autoReset = true;
      const t1 = performance.now();
      if (B.timestamps) void R.resolveTimestampsAsync('render');
      const inf = R.info.render as unknown as { drawCalls: number; triangles: number; timestamp: number };
      st.calls = inf.drawCalls; st.tris = inf.triangles;
      st.cpu.push(t1 - t0);
      if (B.timestamps && inf.timestamp > 0) st.gpu.push(inf.timestamp);
      for (const k of ['iv', 'cpu', 'gpu'] as const) if (st[k].length > 6000) st[k].splice(0, 3000);
      if (T.firstRender === undefined) T.firstRender = t1;
      if (overlay && (textT -= _dt) <= 0) {
        textT = 0.25;
        const n = Math.min(st.iv.length, 240), r = report(st.iv.slice(-n), st.cpu.slice(-n), st.gpu.slice(-n)) as N;
        overlay.textContent = `three ${r.backend}  ${r.profile}  passes ${r.passes.join('+') || 'none'}  ${r.res}\n` +
          `frame p50 ${r.frameMs.p50}  p95 ${r.frameMs.p95}  p99 ${r.frameMs.p99} ms\ncpu render p50 ${r.cpuRenderMs.p50}  p95 ${r.cpuRenderMs.p95} ms\n` +
          `gpu ${r.gpuMs ? `p50 ${r.gpuMs.p50}  p95 ${r.gpuMs.p95} ms` : 'n/a'}\ndraw calls ${r.calls}  triangles ${r.triangles}  actors ${r.creaturesDrawn}\nhour ${hour.toFixed(2)} (${r.binding})`;
      }
    },
    report: () => report(),
    collect: (seconds) => new Promise((res) => { st.iv.length = st.cpu.length = st.gpu.length = 0; setTimeout(() => res(report()), seconds * 1000); }),
  };
  return view;
};

const hexToRgb = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
