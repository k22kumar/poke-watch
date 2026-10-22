// Overworld runtime: tile-grid movement (walk 0.25 s/tile, run 0.125 s), turning in place,
// a following partner creature, wandering NPCs, signs, doors, ledges, stairs, tall grass,
// camera zones and the DS-style text box. Rendering is delegated to OverworldRenderer.
import { MAPS } from './maps';
import type { MapDef, NpcDef, Prop } from './mapdef';
import { T } from './terrain';
import { Atlas, OverworldRenderer, type Billboard, type Shadow } from './render';
import { CAST } from './cast';
import * as S from './sprites';
import { drawText, textWidth, wrap } from './font';
import { bakeSheet } from '../render/baker';
import { DESIGNS } from '../render/designs';
import { ORIGINALS_BY_ID as SPECIES_BY_ID } from '../rules/originals';
import type { Audio } from '../audio/audio';

const DIRS = [[0, 1], [0, -1], [-1, 0], [1, 0]] as const; // down up left right
export const PARTNERS = ['kindlamb', 'rayling', 'mosscub', 'hootz', 'frostkit', 'psiquid'];
export const WILD = ['burrowbun', 'gnatling', 'mudpup', 'bogtoad', 'sparkmite'];

interface Actor {
  sheet: string; // atlas key
  kind: 'person' | 'creature';
  tx: number; ty: number; // current tile (destination while moving)
  fx: number; fy: number; // move origin
  t: number; // 0..1 progress (1 = idle)
  dur: number;
  dir: number;
  step: number; // walk cycle parity
  hop: boolean; hopH: number;
  anim: number;
  npc?: NpcDef & { home: [number, number]; timer: number };
  emote?: { kind: '!' | '?' | '♪'; t: number };
}

export interface Keys { up: boolean; down: boolean; left: boolean; right: boolean; a: boolean; b: boolean; aPressed: boolean; bPressed: boolean; swap: boolean }

export class Overworld {
  map!: MapDef;
  maps = new Map<string, MapDef>();
  player: Actor;
  follower: Actor;
  npcs: Actor[] = [];
  atlas = new Atlas(2048);
  time = 0;
  dialog: { lines: string[]; idx: number; shown: number; onDone?: () => void } | null = null;
  banner: { text: string; t: number } | null = null;
  fade = 0; fadeDir = 0; pendingWarp: (() => void) | null = null;
  rustle = new Map<number, number>();
  turnT = 0;
  partner = 0;
  cam = { pitch: 0.7, yaw: Math.PI, dist: 25, tx: 0, ty: 0, tz: 0 };
  area = '';
  smoke: { x: number; y: number; z: number; t: number }[] = [];
  creatureMeta = new Map<string, { px: number; footV: number }>();
  ui: CanvasRenderingContext2D;
  bumpT = 0;
  encounter: { t: 0 | number; phase: 'wipe' | 'show' | 'leave'; wild: Actor; species: string } | null = null;
  encounterRate = 0.09;
  title = true;

  constructor(public r: OverworldRenderer, uiCanvas: HTMLCanvasElement, public audio: Audio | null) {
    this.ui = uiCanvas.getContext('2d')!;
    this.buildAtlas();
    this.player = this.actor('p:player', 'person', 0, 0);
    this.follower = this.actor('c:' + PARTNERS[0], 'creature', 0, 0);
    this.loadMap('maple');
    const s = this.map.start!;
    this.place(this.player, s.x, s.y, s.dir);
    this.place(this.follower, s.x, s.y - 1, 0);
  }

  private actor(sheet: string, kind: Actor['kind'], x: number, y: number): Actor {
    return { sheet, kind, tx: x, ty: y, fx: x, fy: y, t: 1, dur: 0.25, dir: 0, step: 0, hop: false, hopH: 0, anim: 0 };
  }
  private place(a: Actor, x: number, y: number, dir: number) { a.tx = a.fx = x; a.ty = a.fy = y; a.t = 1; a.dir = dir; }

  // ---------------------------------------------------------------- assets
  private buildAtlas() {
    const A = this.atlas;
    for (const [id, p] of Object.entries(CAST)) A.add('p:' + id, S.personSheet(p).canvas());
    A.add('tree', S.paintTree(0)); A.add('tree2', S.paintTree(1));
    A.add('round', S.paintRoundTree(0)); A.add('round2', S.paintRoundTree(1)); A.add('blossom', S.paintRoundTree(2));
    A.add('bush', S.paintBush(0)); A.add('bushR', S.paintBush(1)); A.add('bushB', S.paintBush(2));
    for (const [k, c] of [['flowerR', '#ff5878'], ['flowerW', '#ffffff'], ['flowerY', '#ffd838']] as const) { A.add(k + '0', S.paintFlowers(c, 0)); A.add(k + '1', S.paintFlowers(c, 1)); }
    for (let f = 0; f < 3; f++) A.add('tall' + f, S.paintTallGrass(f));
    A.add('rock', S.paintRock()); A.add('sign', S.paintSign()); A.add('lamp', S.paintLamp());
    A.add('mailR', S.paintMailbox('#e04848')); A.add('mailB', S.paintMailbox('#4878d8'));
    A.add('lantern', S.paintStoneLantern()); A.add('log', S.paintLog()); A.add('bench', S.paintBench()); A.add('fence', S.paintFence());
    A.add('planterP', S.paintPlanter('#ff80b0')); A.add('planterY', S.paintPlanter('#ffe050')); A.add('hedge', S.paintHedge());
    A.add('berry', S.paintBerryTree()); A.add('well', S.paintWell()); A.add('gate', S.paintGate());
    A.add('e!', S.paintEmote('!')); A.add('e?', S.paintEmote('?')); A.add('e♪', S.paintEmote('♪')); A.add('smoke', S.paintSmoke());
    for (const f of ['table', 'counter', 'shelf', 'plant', 'desk', 'machine', 'stove', 'bookcase', 'tv', 'lowtable', 'cushion', 'scroll', 'crate']) A.add(f, S.paintFurniture(f));
    // partner creatures: baked from the Poke-Watch designs at overworld pixel density
    for (const id of [...PARTNERS, ...WILD]) {
      const sp = SPECIES_BY_ID[id];
      const sheet = bakeSheet(this.r.gl, DESIGNS[sp.art], { density: 16, height: 1.05 + (sp.height - 1.15) * 0.4 }, { elevation: 0.62, outline: [40, 40, 48] });
      const px = sheet.px;
      const c = document.createElement('canvas'); c.width = px * 4; c.height = px * 4;
      const g = c.getContext('2d')!;
      const img = g.createImageData(px * 4, px * 4);
      const rows = [0, 4, 6, 2]; // down, up, left, right
      for (let d = 0; d < 4; d++)
        for (let f = 0; f < 4; f++)
          for (let y = 0; y < px; y++)
            for (let x = 0; x < px; x++) {
              const sy = rows[d] * px + (px - 1 - y), sx = f * px + x; // GL rows are bottom-up
              const si = (sy * sheet.w + sx) * 4, di = ((d * px + y) * px * 4 + f * px + x) * 4;
              img.data[di] = sheet.pixels[si]; img.data[di + 1] = sheet.pixels[si + 1]; img.data[di + 2] = sheet.pixels[si + 2]; img.data[di + 3] = sheet.pixels[si + 3];
            }
      g.putImageData(img, 0, 0);
      A.add('c:' + id, c);
      this.creatureMeta.set('c:' + id, { px, footV: sheet.footV });
      this.r.gl.deleteTexture(sheet.tex);
    }
    this.r.setAtlas(A);
  }

  // ---------------------------------------------------------------- maps
  loadMap(id: string) {
    let m = this.maps.get(id);
    if (!m) { m = MAPS[id](); this.maps.set(id, m); }
    this.map = m;
    this.r.loadMap(m, (x, y) => this.groundAt(x, y));
    this.npcs = m.npcs.map((n) => {
      const a = this.actor('p:' + n.look, 'person', n.x, n.y);
      a.dir = n.dir;
      a.npc = { ...n, home: [n.x, n.y], timer: 1 + Math.random() * 2 };
      a.dur = 0.32;
      return a;
    });
    this.rustle.clear();
    this.smoke = [];
    this.audio?.setBiome({ music: m.music } as any);
    if (m.indoor) this.showBanner(m.name);
  }

  showBanner(text: string) { this.banner = { text, t: 2.6 }; }

  tile(x: number, y: number) { return y * this.map.w + x; }
  inMap(x: number, y: number) { return x >= 0 && y >= 0 && x < this.map.w && y < this.map.h; }
  elev(x: number, y: number) { return this.inMap(x, y) ? this.map.elev[this.tile(x, y)] : 0; }

  /** walkable ground height at a continuous position (stairs slope northward) */
  groundAt(x: number, z: number) {
    const tx = Math.floor(x), tz = Math.floor(z);
    if (!this.inMap(tx, tz)) return 0;
    if (this.map.stairs[this.tile(tx, tz)]) {
      const lo = this.elev(tx, tz + 1), hi = this.elev(tx, tz - 1);
      const f = 1 - (z - tz);
      return lo + (hi - lo) * Math.max(0, Math.min(1, f));
    }
    if (this.map.terrain[this.tile(tx, tz)] === T.wood && !this.map.indoor) return 0.05;
    return this.elev(tx, tz);
  }

  occupied(x: number, y: number, except?: Actor) {
    for (const n of this.npcs) if (n !== except && ((n.tx === x && n.ty === y) || (n.t < 1 && n.fx === x && n.fy === y))) return n;
    return null;
  }

  /** returns 'ok' | 'hop' | 'warp' | 'block' */
  canMove(a: Actor, dir: number): 'ok' | 'hop' | 'warp' | 'block' {
    const [dx, dy] = DIRS[dir];
    const x = a.tx + dx, y = a.ty + dy;
    const m = this.map;
    if (a === this.player) {
      const w = m.warps.find((w) => w.x === x && w.y === y && w.kind === 'door');
      if (w && dir === 1) return 'warp';
    }
    if (!this.inMap(x, y)) return 'block';
    const i = this.tile(x, y);
    if (m.ledge[i]) {
      if (dir !== 0) return 'block';
      const x2 = x, y2 = y + 1;
      if (!this.inMap(x2, y2) || m.block[this.tile(x2, y2)] || this.occupied(x2, y2)) return 'block';
      return 'hop';
    }
    if (m.block[i] || m.terrain[i] === T.water || m.terrain[i] === T.void) return 'block';
    if (this.occupied(x, y, a)) return 'block';
    if (a !== this.player && this.player.tx === x && this.player.ty === y) return 'block';
    if (a.npc && this.follower.tx === x && this.follower.ty === y) return 'block';
    const st = m.stairs[i] || m.stairs[this.tile(a.tx, a.ty)];
    const de = Math.abs(this.elev(x, y) - this.elev(a.tx, a.ty));
    if (de > 0.01 && !(st && dx === 0)) return 'block';
    return 'ok';
  }

  startMove(a: Actor, dir: number, dur: number, hop = false) {
    const [dx, dy] = DIRS[dir];
    a.fx = a.tx; a.fy = a.ty;
    a.tx += dx * (hop ? 2 : 1); a.ty += dy * (hop ? 2 : 1);
    a.dir = dir; a.t = 0; a.dur = hop ? 0.42 : dur; a.hop = hop;
    a.step ^= 1;
  }

  // ---------------------------------------------------------------- update
  update(dt: number, k: Keys) {
    this.time += dt;
    if (this.title) {
      if (k.aPressed || k.bPressed) { this.title = false; this.area = ''; this.audio?.unlock(); this.audio?.setBiome({ music: this.map.music } as any); this.audio?.pick(); this.checkArea(); }
      this.cam.ty += 0; this.updateActor(this.follower, dt);
      for (const n of this.npcs) { this.npcThink(n, dt); this.updateActor(n, dt); }
      return;
    }
    // fade transitions
    if (this.fadeDir) {
      this.fade += this.fadeDir * dt * 4;
      if (this.fade >= 1 && this.fadeDir > 0) { this.fade = 1; this.pendingWarp?.(); this.pendingWarp = null; this.fadeDir = -1; }
      if (this.fade <= 0 && this.fadeDir < 0) { this.fade = 0; this.fadeDir = 0; }
    }
    if (this.banner) { this.banner.t -= dt; if (this.banner.t <= 0) this.banner = null; }
    for (const [i, t] of this.rustle) { if (t - dt <= 0) this.rustle.delete(i); else this.rustle.set(i, t - dt); }
    for (const a of [this.player, this.follower, ...this.npcs]) if (a.emote) { a.emote.t -= dt; if (a.emote.t <= 0) a.emote = undefined; }

    if (this.encounter) {
      const e = this.encounter;
      e.t += dt;
      if (e.phase === 'wipe' && e.t > 0.9) {
        e.phase = 'show'; e.t = 0;
        const name = SPECIES_BY_ID[e.species].name;
        this.player.emote = { kind: '!', t: 2.2 };
        this.say([`A wild ${name} popped out of the grass!`, `${name} stared at you for a moment… then darted back into the meadow.`], () => { e.phase = 'leave'; e.t = 0; this.startMove(e.wild, this.player.dir, 0.18, true); });
      }
      if (e.phase === 'leave') { this.updateActor(e.wild, dt); if (e.t > 0.45) this.encounter = null; return; }
      if (e.phase === 'wipe') return;
    }
    if (this.dialog) {
      const line = this.dialog.lines[this.dialog.idx];
      if (this.dialog.shown < line.length) this.dialog.shown = Math.min(line.length, this.dialog.shown + dt * 45);
      if (k.aPressed || k.bPressed) {
        if (this.dialog.shown < line.length) this.dialog.shown = line.length;
        else if (++this.dialog.idx >= this.dialog.lines.length) { const done = this.dialog.onDone; this.dialog = null; done?.(); }
        else { this.dialog.shown = 0; this.audio?.ui(); }
      }
      this.updateActor(this.follower, dt);
      for (const n of this.npcs) this.updateActor(n, dt);
      this.updateCamera(dt);
      return;
    }
    if (k.swap && this.player.t >= 1) {
      this.partner = (this.partner + 1) % PARTNERS.length;
      this.follower.sheet = 'c:' + PARTNERS[this.partner];
      this.follower.emote = { kind: '♪', t: 1 };
      this.showBanner(SPECIES_BY_ID[PARTNERS[this.partner]].name + ' is following you');
    }

    const P = this.player;
    this.updateActor(P, dt);
    this.updateActor(this.follower, dt);
    if (P.t >= 1 && !this.fadeDir) {
      // input
      const want = k.down ? 0 : k.up ? 1 : k.left ? 2 : k.right ? 3 : -1;
      if (k.aPressed) this.interact();
      else if (want >= 0) {
        if (want !== P.dir && this.turnT <= 0 && !this.wasMoving) { P.dir = want; this.turnT = 0.11; }
        else if (this.turnT > 0) this.turnT -= dt;
        else {
          const res = this.canMove(P, want);
          P.dir = want;
          if (res === 'warp') this.doorWarp(want);
          else if (res === 'ok' || res === 'hop') {
            const fromX = P.tx, fromY = P.ty;
            this.startMove(P, want, k.b ? 0.13 : 0.25, res === 'hop');
            if (res === 'hop') this.audio?.jump();
            this.followTo(fromX, fromY, P.dur, res === 'hop' ? want : -1);
          } else {
            // bump: walk in place
            this.bumpT -= dt;
            if (this.bumpT <= 0) { this.audio?.ui(); this.bumpT = 0.4; P.step ^= 1; P.anim = 0.25; }
          }
        }
      } else { this.turnT = 0; }
      this.wasMoving = want >= 0;
    }
    for (const n of this.npcs) { this.npcThink(n, dt); this.updateActor(n, dt); }
    // occasional partner mood emote
    if (Math.random() < dt * 0.04 && !this.follower.emote) this.follower.emote = { kind: '♪', t: 1.2 };
    // chimney smoke
    if (!this.map.indoor && Math.random() < dt * 2.2) for (const b of this.map.buildings) if (b.chimney != null && Math.random() < 0.5) this.smoke.push({ x: b.x + b.chimney + 0.5, y: this.elev(b.x, b.y) + b.wallH + (b.rise ?? Math.min(2.2, b.d * 0.42 + 0.4)) + 0.6, z: b.y + b.d / 2 - 0.35, t: 0 });
    for (const s of this.smoke) { s.t += dt; s.y += dt * 0.6; s.x += dt * 0.25; }
    this.smoke = this.smoke.filter((s) => s.t < 2.4);
    this.updateCamera(dt);
    this.checkArea();
  }
  private wasMoving = false;

  private followTo(x: number, y: number, dur: number, hopDir: number) {
    const F = this.follower;
    if (F.t < 1) { F.tx = F.tx; }
    if (F.tx === x && F.ty === y) return;
    const dx = Math.sign(x - F.tx), dy = Math.sign(y - F.ty);
    const dir = dy > 0 ? 0 : dy < 0 ? 1 : dx < 0 ? 2 : 3;
    if (hopDir >= 0) {
      // follower takes the player's old spot by hopping along the same line
      F.fx = F.tx; F.fy = F.ty; F.tx = x; F.ty = y; F.dir = dir; F.t = 0; F.dur = 0.42; F.hop = Math.abs(x - F.fx) + Math.abs(y - F.fy) > 1; F.step ^= 1;
      return;
    }
    const dist = Math.abs(x - F.tx) + Math.abs(y - F.ty);
    if (dist > 2) { this.place(F, x, y, this.player.dir); return; }
    F.fx = F.tx; F.fy = F.ty; F.tx = x; F.ty = y; F.dir = dir; F.t = 0; F.dur = dur * (dist > 1 ? 1.4 : 1); F.hop = false; F.step ^= 1;
    if (this.map.terrain[this.tile(x, y)] === T.tall) this.rustle.set(this.tile(x, y), 0.35);
  }

  private updateActor(a: Actor, dt: number) {
    if (a.anim > 0) a.anim -= dt;
    if (a.t >= 1) return;
    a.t = Math.min(1, a.t + dt / a.dur);
    if (a.t >= 1) {
      // arrived
      const i = this.tile(a.tx, a.ty);
      if (this.inMap(a.tx, a.ty) && this.map.terrain[i] === T.tall) {
        this.rustle.set(i, 0.35);
        if (a === this.player) { this.audio?.pickup(); if (Math.random() < this.encounterRate && !this.encounter) this.startEncounter(); }
      }
      if (a === this.player) {
        const w = this.map.warps.find((w) => w.x === a.tx && w.y === a.ty && w.kind === 'mat');
        if (w) this.warpTo(w.to, w.tx, w.ty, w.dir);
      }
    } else if (a.t > 0.5 && a === this.player) {
      const i = this.tile(a.tx, a.ty);
      if (this.inMap(a.tx, a.ty) && this.map.terrain[i] === T.tall && !this.rustle.has(i)) this.rustle.set(i, 0.35);
    }
  }

  private npcThink(n: Actor, dt: number) {
    const d = n.npc!;
    if (n.t < 1) return;
    d.timer -= dt;
    if (d.timer > 0) return;
    d.timer = 1.2 + Math.random() * 2.6;
    if (d.move === 'look') { n.dir = Math.floor(Math.random() * 4); return; }
    if (d.move === 'stand') return;
    const dir = d.move === 'pace' ? (n.dir === 2 ? 3 : 2) : Math.floor(Math.random() * 4);
    const [dx, dy] = DIRS[dir];
    const r = d.radius ?? 2;
    if (Math.abs(n.tx + dx - d.home[0]) > r || Math.abs(n.ty + dy - d.home[1]) > r) { n.dir = dir; return; }
    if (this.canMove(n, dir) === 'ok' && !(this.follower.tx === n.tx + dx && this.follower.ty === n.ty + dy)) this.startMove(n, dir, 0.32);
    else n.dir = dir;
  }

  private interact() {
    const P = this.player;
    const [dx, dy] = DIRS[P.dir];
    const x = P.tx + dx, y = P.ty + dy;
    // NPC
    const n = this.occupied(x, y);
    if (n && n.npc) {
      n.dir = [1, 0, 3, 2][P.dir];
      n.npc.timer = 3;
      this.say(n.npc.lines);
      return;
    }
    // partner
    if (this.follower.tx === x && this.follower.ty === y) {
      const sp = SPECIES_BY_ID[PARTNERS[this.partner]];
      const moods = [`${sp.name} is humming happily.`, `${sp.name} sniffs the air. It smells something sweet nearby!`, `${sp.name} gazes at you with sparkling eyes.`, `${sp.name} is a little sleepy but keeps up bravely.`];
      this.follower.dir = [1, 0, 3, 2][P.dir];
      this.follower.emote = { kind: '♪', t: 1.4 };
      this.say([moods[Math.floor(this.time * 7) % moods.length]]);
      return;
    }
    // props with text
    const pr = this.propAt(x, y);
    if (pr?.text) { this.say(pr.text.split('\n').length > 1 ? [pr.text] : [pr.text]); return; }
    if (pr && (pr.kind === 'bookcase' || pr.kind === 'shelf')) { this.say(['Rows of well-loved books about creatures and travel.']); return; }
    if (pr && pr.kind === 'tv') { this.say(['A weather report is on. Sunny all week across the region!']); return; }
    if (pr && pr.kind === 'machine') { this.say(['The machine hums softly. A screen reads: "Habitat survey 74% complete."']); return; }
    if (pr && pr.kind === 'stove') { this.say(['Something delicious is simmering.']); return; }
    // locked doors
    for (const b of this.map.buildings) {
      if (y === b.y + b.d - 1 && x === b.x + b.door && !b.warp) { this.say([b.style === 'japanese' ? 'The shrine is quiet. A cool breeze drifts out from inside.' : "It's locked. Nobody seems to be home."]); return; }
    }
    if (this.inMap(x, y) && this.map.terrain[this.tile(x, y)] === T.water) { this.say(['The water is clear and cold. Small fish dart between the stones.']); return; }
  }

  startEncounter() {
    const P = this.player;
    const [dx, dy] = DIRS[P.dir];
    let x = P.tx + dx, y = P.ty + dy;
    if (!this.inMap(x, y) || this.map.block[this.tile(x, y)] || this.occupied(x, y)) { x = P.tx + 1; y = P.ty; }
    const species = WILD[Math.floor(Math.random() * WILD.length)];
    const wild = this.actor('c:' + species, 'creature', x, y);
    wild.dir = [1, 0, 3, 2][P.dir];
    wild.hop = true; wild.fx = x; wild.fy = y; wild.t = 0; wild.dur = 0.35;
    this.encounter = { t: 0, phase: 'wipe', wild, species };
    this.rustle.set(this.tile(x, y), 0.8);
    this.audio?.boss();
  }

  propAt(x: number, y: number): Prop | undefined {
    return this.map.props.find((p) => x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h && p.block);
  }

  say(lines: string[], onDone?: () => void) {
    this.dialog = { lines, idx: 0, shown: 0, onDone };
    this.audio?.ui();
  }

  private doorWarp(dir: number) {
    const P = this.player;
    const [dx, dy] = DIRS[dir];
    const w = this.map.warps.find((w) => w.x === P.tx + dx && w.y === P.ty + dy && w.kind === 'door')!;
    this.warpTo(w.to, w.tx, w.ty, w.dir);
  }

  warpTo(map: string, x: number, y: number, dir: number) {
    this.audio?.portal();
    this.fadeDir = 1;
    this.pendingWarp = () => {
      this.loadMap(map);
      this.place(this.player, x, y, dir);
      const [dx, dy] = DIRS[dir];
      const fx = x - dx, fy = y - dy;
      const ok = this.inMap(fx, fy) && !this.map.block[this.tile(fx, fy)];
      this.place(this.follower, ok ? fx : x, ok ? fy : y, dir);
      this.snapCamera();
      if (!this.map.indoor) { this.area = ''; this.checkArea(); }
    };
  }

  private checkArea() {
    const P = this.player;
    for (const a of this.map.areas ?? []) {
      if (P.tx >= a.x && P.tx < a.x + a.w && P.ty >= a.y && P.ty < a.y + a.h) {
        if (a.name !== this.area) { this.area = a.name; this.showBanner(a.name); }
        return;
      }
    }
  }

  // ---------------------------------------------------------------- camera
  private camTarget() {
    const P = this.player;
    const [x, z] = this.pos(P);
    let pitch = 0.7, yaw = Math.PI, dist = 25;
    for (const zn of this.map.zones) if (x >= zn.x && x < zn.x + zn.w && z >= zn.y && z < zn.y + zn.h) { pitch = zn.pitch ?? pitch; yaw = Math.PI + (zn.yaw ?? 0); dist = zn.dist ?? dist; }
    return { x, y: this.groundAt(x, z) * 0.85, z, pitch, yaw, dist };
  }
  snapCamera() { const t = this.camTarget(); Object.assign(this.cam, { tx: t.x, ty: t.y, tz: t.z, pitch: t.pitch, yaw: t.yaw, dist: t.dist }); }
  private updateCamera(dt: number) {
    const t = this.camTarget();
    const k = 1 - Math.exp(-dt * 3.2);
    const C = this.cam;
    C.pitch += (t.pitch - C.pitch) * k; C.yaw += (t.yaw - C.yaw) * k; C.dist += (t.dist - C.dist) * k;
    C.tx = t.x; C.tz = t.z; C.ty += (t.y - C.ty) * (1 - Math.exp(-dt * 8));
  }

  pos(a: Actor): [number, number] {
    const f = a.t;
    return [a.fx + (a.tx - a.fx) * f + 0.5, a.fy + (a.ty - a.fy) * f + 0.5];
  }

  // ---------------------------------------------------------------- render
  render() {
    const r = this.r;
    const C = this.cam;
    r.setCamera(C.tx, C.ty + 0.5, C.tz, C.pitch, C.yaw, C.dist);
    const bbs: Billboard[] = [];
    const shadows: Shadow[] = [];
    const A = this.atlas;
    const m = this.map;
    const st = r.stretch;
    const add = (key: string, x: number, y: number, z: number, opts: Partial<Billboard> = {}) => {
      const e = A.map.get(key)!;
      const [u0, v0, u1, v1] = A.uv(key);
      bbs.push({ key, x, y, z, w: e.w / 16, h: e.h / 16, u0, v0, u1, v1, ...opts });
    };
    const flowerFrame = Math.floor(this.time * 1.6) % 2;
    // props
    for (const p of m.props) {
      const cx = p.x + p.w / 2, base = p.y + p.h;
      const y = this.elev(p.x, p.y + p.h - 1);
      switch (p.kind) {
        case 'tall': {
          const rs = this.rustle.get(this.tile(p.x, p.y));
          const f = rs ? 1 + (Math.floor(rs * 14) % 2) : 0;
          add('tall' + f, cx, y, base - 0.08, { bias: 0.02 });
          break;
        }
        case 'flowerR': case 'flowerW': case 'flowerY': { const jx = (((p.x * 7 + p.y * 13) % 5) - 2) * 0.09, jz = (((p.x * 11 + p.y * 3) % 5) - 2) * 0.08; add(p.kind + ((flowerFrame + p.x + p.y) % 2), cx + jx, y, base - 0.3 + jz); break; }
        case 'tree': case 'tree2': add(p.kind, cx, y, base - 0.55); break;
        case 'round': case 'round2': case 'blossom': add(p.kind, cx, y, base - 0.55); break;
        case 'gate': add('gate', cx, y, base - 0.5, { bias: -0.05 }); break;
        case 'rug': break;
        case 'lamp': add('lamp', cx, y, base - 0.4); break;
        case 'fence': add('fence', cx, y, base - 0.35); break;
        default: if (A.has(p.kind)) add(p.kind, cx, y, base - 0.4);
      }
      if (p.kind === 'tree' || p.kind === 'tree2' || p.kind === 'round' || p.kind === 'round2' || p.kind === 'blossom') shadows.push({ x: cx, y, z: base - 0.6, rx: 1.0, rz: 0.45, a: 0.18 });
    }
    // decorative forest beyond the map edges (outdoor)
    if (!m.indoor) {
      const margin = 10;
      for (let y = -margin; y < m.h + margin; y += 2)
        for (let x = -margin; x < m.w + margin; x += 2) {
          if (x >= 0 && y >= 0 && x < m.w && y < m.h) continue;
          add((((x >> 1) + (y >> 1)) % 3 === 0) ? 'tree2' : 'tree', x + 1, 0, y + 2 - 0.55);
        }
    }
    // smoke
    for (const s of this.smoke) add('smoke', s.x, s.y, s.z, { bright: 1 - s.t / 3 });
    // actors
    const drawActor = (a: Actor) => {
      const [x, z] = this.pos(a);
      let y = this.groundAt(x, z);
      if (a.hop) y = Math.max(this.groundAt(a.fx + 0.5, a.fy + 0.5), this.groundAt(a.tx + 0.5, a.ty + 0.5)) + Math.sin(a.t * Math.PI) * 0.55;
      const moving = a.t < 1 || a.anim > 0;
      const phase = a.t < 1 ? (a.t < 0.5 ? 1 : 0) : a.anim > 0 ? 1 : 0;
      const frame = moving && phase ? (a.step ? 1 : 3) : 0;
      const gy = this.groundAt(x, z);
      if (a.kind === 'person') {
        const [u0, v0, u1, v1] = A.uv(a.sheet, frame, a.dir, S.CELL_W, S.CELL_H);
        const h = S.CELL_H / 16;
        bbs.push({ key: a.sheet, x, y: y - (2 / 32) * h * st, z: z + 0.05, w: S.CELL_W / 16, h, u0, v0, u1, v1 });
        shadows.push({ x, y: gy, z: z + 0.02, rx: 0.42, rz: 0.2, a: 0.32 });
      } else {
        const meta = this.creatureMeta.get(a.sheet)!;
        const f = moving ? (phase ? 1 : 3) : Math.floor(this.time * 2.5) % 2 === 0 ? 0 : 2;
        const [u0, v0, u1, v1] = A.uv(a.sheet, f, a.dir, meta.px, meta.px);
        const s = meta.px / 16;
        const inGrass = this.inMap(Math.floor(x), Math.floor(z)) && this.map.terrain[this.tile(Math.floor(x), Math.floor(z))] === T.tall;
        bbs.push({ key: a.sheet, x, y: y - meta.footV * s * st, z: z + 0.05, w: s, h: s, u0, v0, u1, v1, bias: inGrass ? 0.48 : 0 });
        shadows.push({ x, y: gy, z: z + 0.02, rx: 0.36, rz: 0.17, a: 0.3 });
      }
      if (a.emote) {
        const [eu0, ev0, eu1, ev1] = A.uv('e' + a.emote.kind);
        bbs.push({ key: 'e', x: x + 0.35, y: y + (a.kind === 'person' ? 1.9 : 1.2), z: z + 0.1, w: 12 / 16, h: 14 / 16, u0: eu0, v0: ev0, u1: eu1, v1: ev1, bias: 0.6 });
      }
    };
    drawActor(this.follower);
    drawActor(this.player);
    if (this.encounter && this.encounter.phase !== 'wipe') { if (this.encounter.wild.t < 1 && this.encounter.phase === 'show') this.updateActor(this.encounter.wild, 1 / 60); drawActor(this.encounter.wild); }
    for (const n of this.npcs) drawActor(n);
    const clear: [number, number, number] = m.indoor ? [0.06, 0.06, 0.09] : [0.47, 0.86, 0.67];
    r.draw(this.time, bbs, shadows, clear, this.fade * 0.999);
    this.drawUI();
  }

  private drawTitle(g: CanvasRenderingContext2D, W: number, H: number) {
    g.fillStyle = 'rgba(16,20,40,0.45)'; g.fillRect(0, 0, W, H);
    const bw = Math.min(W - 20, 220), bh = 92, x = Math.floor((W - bw) / 2), y = Math.floor(H * 0.2);
    g.fillStyle = '#3a2818'; g.fillRect(x, y, bw, bh);
    g.fillStyle = '#c89058'; g.fillRect(x + 1, y + 1, bw - 2, bh - 2);
    g.fillStyle = '#f8ecd0'; g.fillRect(x + 4, y + 4, bw - 8, bh - 8);
    // big title: pixel font drawn at 2x
    const tw = textWidth('MAPLEBROOK') + 3;
    const big = document.createElement('canvas'); big.width = tw; big.height = 10;
    drawText(big.getContext('2d')!, 'MAPLEBROOK', 1, 1, '#d05040', '#7a2818');
    g.imageSmoothingEnabled = false;
    g.drawImage(big, Math.floor(W / 2 - tw), y + 12, tw * 2, 20);
    drawText(g, 'A small-town creature adventure', x + 14, y + 38, '#5a4a38');
    drawText(g, 'Arrows: walk   X: run   Z: talk / read', x + 10, y + 54, '#40382c');
    drawText(g, 'C: switch partner', x + 10, y + 64, '#40382c');
    if (Math.floor(this.time * 2) % 2 === 0) drawText(g, 'Press Z to start', Math.floor(W / 2 - 38), y + bh + 12, '#ffffff', '#303040');
  }

  // ---------------------------------------------------------------- UI (low-res canvas)
  private drawUI() {
    const g = this.ui;
    const W = this.r.W, H = this.r.H;
    if (g.canvas.width !== W || g.canvas.height !== H) { g.canvas.width = W; g.canvas.height = H; }
    g.clearRect(0, 0, W, H);
    g.imageSmoothingEnabled = false;
    if (this.fade > 0) { g.fillStyle = `rgba(0,0,0,${this.fade})`; g.fillRect(0, 0, W, H); }
    if (this.title) { this.drawTitle(g, W, H); return; }
    // encounter wipe: flashing, then horizontal bars closing in from alternate sides
    if (this.encounter && this.encounter.phase === 'wipe') {
      const t = this.encounter.t;
      if (t < 0.3) { if (Math.floor(t * 20) % 2 === 0) { g.fillStyle = 'rgba(255,255,255,0.85)'; g.fillRect(0, 0, W, H); } }
      else {
        const f = Math.min(1, (t - 0.3) / 0.55);
        const bars = 12, bh = Math.ceil(H / bars);
        g.fillStyle = '#101018';
        for (let i = 0; i < bars; i++) { const w = Math.round(W * f); if (i % 2) g.fillRect(W - w, i * bh, w, bh); else g.fillRect(0, i * bh, w, bh); }
      }
    }
    // location banner: wooden plaque sliding in at top-left
    if (this.banner) {
      const t = this.banner.t;
      const slide = Math.min(1, (2.6 - t) * 5, t * 4);
      const text = this.banner.text;
      const bw = Math.max(96, text.length * 6 + 24), bh = 22;
      const x = 6, y = Math.round(-bh + (bh + 6) * slide);
      g.fillStyle = '#3a2818'; g.fillRect(x, y, bw, bh);
      g.fillStyle = '#c89058'; g.fillRect(x + 1, y + 1, bw - 2, bh - 2);
      g.fillStyle = '#e8b878'; g.fillRect(x + 2, y + 2, bw - 4, 2);
      g.fillStyle = '#a06c3c'; g.fillRect(x + 2, y + bh - 4, bw - 4, 2);
      g.fillStyle = '#f8ecd0'; g.fillRect(x + 6, y + 5, bw - 12, 12);
      g.fillStyle = '#3a2818'; g.fillRect(x + 6, y + 5, bw - 12, 1);
      drawText(g, text, x + 10, y + 7, '#40382c', '#d8c8a8');
    }
    // dialog box
    if (this.dialog) {
      const bw = Math.min(W - 12, 300), bh = 44;
      const x = Math.floor((W - bw) / 2), y = H - bh - 6;
      g.fillStyle = '#48586a'; g.fillRect(x, y, bw, bh);
      g.fillStyle = '#e8f0f8'; g.fillRect(x + 1, y + 1, bw - 2, bh - 2);
      g.fillStyle = '#ffffff'; g.fillRect(x + 3, y + 3, bw - 6, bh - 6);
      g.fillStyle = '#90a8c0'; g.fillRect(x + 3, y + bh - 4, bw - 6, 1);
      // corner rounding
      g.clearRect(x, y, 1, 1); g.clearRect(x + bw - 1, y, 1, 1); g.clearRect(x, y + bh - 1, 1, 1); g.clearRect(x + bw - 1, y + bh - 1, 1, 1);
      const line = this.dialog.lines[this.dialog.idx];
      const lines = wrap(line, bw - 24);
      let shown = Math.floor(this.dialog.shown);
      lines.slice(0, 3).forEach((l, i) => {
        drawText(g, l, x + 10, y + 8 + i * 11, '#404850', '#c8d0d8', shown);
        shown -= l.length + 1;
      });
      if (this.dialog.shown >= line.length && Math.floor(this.time * 3) % 2 === 0) {
        g.fillStyle = '#e05040';
        const ax = x + bw - 14, ay = y + bh - 12;
        g.fillRect(ax, ay, 7, 1); g.fillRect(ax + 1, ay + 1, 5, 1); g.fillRect(ax + 2, ay + 2, 3, 1); g.fillRect(ax + 3, ay + 3, 1, 1);
      }
    }
  }
}
