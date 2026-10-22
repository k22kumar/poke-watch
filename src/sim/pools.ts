// Struct-of-arrays pools with free lists (PokéBonk keeps enemies, projectiles, pickups
// and particles this way; enemy capacity 2,200). Allocation-free during play.

class FreeList {
  private free: Int32Array;
  private top: number;
  constructor(cap: number) {
    this.free = new Int32Array(cap);
    for (let i = 0; i < cap; i++) this.free[i] = cap - 1 - i;
    this.top = cap;
  }
  take(): number {
    return this.top > 0 ? this.free[--this.top] : -1;
  }
  give(i: number) {
    this.free[this.top++] = i;
  }
  get available() {
    return this.top;
  }
}

/** role bits. Phase 7 roles (blueprint section 9): shielder = Bulwark (blocks shots in its front arc), healer =
 *  Mender, hexer lays deep agents on you and the ground, raider goes for the objective, hunt marks the Hunt target */
export const ROLE = { elite: 1, alpha: 2, boss: 4, ranged: 8, flying: 16, healer: 32, shielder: 64, hexer: 128, raider: 256, swarm: 512, stampede: 1024, hunt: 2048 } as const;

export class EnemyPool {
  readonly cap: number;
  private fl: FreeList;
  count = 0; // live
  hi = 0; // highest index ever used + 1 (iteration bound)
  alive: Uint8Array;
  gen: Uint32Array;
  x: Float32Array; y: Float32Array; z: Float32Array;
  px: Float32Array; pz: Float32Array; py: Float32Array;
  vx: Float32Array; vz: Float32Array;
  kx: Float32Array; kz: Float32Array;
  hp: Float32Array; maxHp: Float32Array;
  speed: Float32Array; dmg: Float32Array; radius: Float32Array; size: Float32Array;
  species: Int16Array; roles: Uint16Array;
  flash: Float32Array; contactCd: Float32Array; attackCd: Float32Array;
  state: Uint8Array; stateT: Float32Array; tx: Float32Array; tz: Float32Array;
  burn: Float32Array; poison: Float32Array; sleep: Float32Array; root: Float32Array;
  confuse: Float32Array; chill: Float32Array; stun: Float32Array; dot: Float32Array;
  facing: Float32Array; animT: Float32Array; xp: Float32Array; hover: Float32Array; spawnT: Float32Array;
  bossPhase: Uint8Array;
  sx: Float32Array; sz: Float32Array;
  /** index into ABILITY_IDS (+1; 0 = none) and per-enemy ability state (Flash Fire armed, Sturdy spent) */
  ability: Uint8Array; abilityFlag: Uint8Array;
  /** coat (rules/reactions.ts AG index), its depth (1 light, 2 deep) and time left; light-coat cooldown */
  coat: Uint8Array; coatDeep: Uint8Array; coatT: Float32Array; coatIcd: Float32Array;
  /** frozen solid (s) and whether the next physical hit shatters it; lost in steam (s) */
  frozen: Float32Array; blind: Float32Array;
  /** crowd-control meter (s of stun / freeze / root, decaying) and immunity left */
  ccAcc: Float32Array; ccImmune: Float32Array;
  /** Bulwark shield down (s left; a Fighting hit or a push breaks it) */
  guardDown: Float32Array;
  /** Phase 8b Lasso: s left suspended in front of the holder, the hold's Power and the button that keeps it */
  heldT: Float32Array; heldP: Uint8Array; heldBtn: Uint8Array;

  constructor(cap: number) {
    this.cap = cap;
    this.fl = new FreeList(cap);
    const F = () => new Float32Array(cap);
    this.alive = new Uint8Array(cap);
    this.gen = new Uint32Array(cap);
    this.x = F(); this.y = F(); this.z = F(); this.px = F(); this.pz = F(); this.py = F();
    this.vx = F(); this.vz = F(); this.kx = F(); this.kz = F();
    this.hp = F(); this.maxHp = F(); this.speed = F(); this.dmg = F(); this.radius = F(); this.size = F();
    this.species = new Int16Array(cap); this.roles = new Uint16Array(cap);
    this.flash = F(); this.contactCd = F(); this.attackCd = F();
    this.state = new Uint8Array(cap); this.stateT = F(); this.tx = F(); this.tz = F();
    this.burn = F(); this.poison = F(); this.sleep = F(); this.root = F();
    this.confuse = F(); this.chill = F(); this.stun = F(); this.dot = F();
    this.facing = F(); this.animT = F(); this.xp = F(); this.hover = F(); this.spawnT = F();
    this.bossPhase = new Uint8Array(cap);
    this.sx = F(); this.sz = F();
    this.ability = new Uint8Array(cap); this.abilityFlag = new Uint8Array(cap);
    this.coat = new Uint8Array(cap); this.coatDeep = new Uint8Array(cap); this.coatT = F(); this.coatIcd = F();
    this.frozen = F(); this.blind = F(); this.ccAcc = F(); this.ccImmune = F();
    this.guardDown = F();
    this.heldT = F(); this.heldP = new Uint8Array(cap); this.heldBtn = new Uint8Array(cap);
  }

  spawn(): number {
    const i = this.fl.take();
    if (i < 0) return -1;
    this.alive[i] = 1;
    this.gen[i]++;
    this.count++;
    if (i >= this.hi) this.hi = i + 1;
    this.vx[i] = this.vz[i] = this.kx[i] = this.kz[i] = 0;
    this.flash[i] = this.contactCd[i] = this.attackCd[i] = this.stateT[i] = 0;
    this.burn[i] = this.poison[i] = this.sleep[i] = this.root[i] = this.confuse[i] = this.chill[i] = this.stun[i] = this.dot[i] = 0;
    this.state[i] = 0; this.roles[i] = 0; this.bossPhase[i] = 0; this.animT[i] = 0; this.spawnT[i] = 0; this.hover[i] = 0;
    this.ability[i] = 0; this.abilityFlag[i] = 0;
    this.coat[i] = 0; this.coatDeep[i] = 0; this.coatT[i] = 0; this.coatIcd[i] = 0;
    this.frozen[i] = 0; this.blind[i] = 0; this.ccAcc[i] = 0; this.ccImmune[i] = 0;
    this.guardDown[i] = 0;
    this.heldT[i] = 0; this.heldP[i] = 0; this.heldBtn[i] = 0;
    return i;
  }

  kill(i: number) {
    if (!this.alive[i]) return;
    this.alive[i] = 0;
    this.count--;
    this.fl.give(i);
  }

  clear() {
    for (let i = 0; i < this.hi; i++) if (this.alive[i]) this.kill(i);
  }
}

export const PK = { straight: 0, homing: 1, lob: 2, boomerang: 3, orbit: 4, hostile: 5 } as const;
const HIT_RING = 8;

export class ProjectilePool {
  readonly cap: number;
  private fl: FreeList;
  count = 0;
  hi = 0;
  alive: Uint8Array;
  x: Float32Array; y: Float32Array; z: Float32Array;
  vx: Float32Array; vy: Float32Array; vz: Float32Array;
  life: Float32Array; maxLife: Float32Array; dmg: Float32Array; radius: Float32Array; pierce: Int16Array;
  kind: Uint8Array; element: Uint8Array; target: Int32Array; t: Float32Array;
  ox: Float32Array; oz: Float32Array; ax: Float32Array; az: Float32Array; speed: Float32Array;
  ailment: Uint8Array; chance: Float32Array; knock: Float32Array; drain: Float32Array; aoe: Float32Array;
  cls: Uint8Array; move: Int16Array; size: Float32Array;
  hitE: Int32Array; hitT: Float32Array; hitN: Uint8Array;
  /** Phase 8a profile: a projectile is a light body. Weight 0 (shots) or 1 (lobs, heavy shots); the Push and
   *  Hold Power it carries from its move's capabilities; held state (s left, the button that keeps it); the
   *  species index of the enemy that fired it (-1 = the player's) */
  weight: Uint8Array; pushP: Uint8Array; holdP: Uint8Array; heldT: Float32Array; heldBtn: Uint8Array; src: Int16Array;
  /** Phase 8b: coat depth override (255 = by slot, as before), what happens where it ends (0 none, 1 Heat on the
   *  ground, 2 a Grass patch) and its radius, and an extra agent it carries (Slipstream; 0 none) */
  depth: Uint8Array; fx: Uint8Array; fxR: Float32Array; extra: Uint8Array;

  constructor(cap: number) {
    this.cap = cap;
    this.fl = new FreeList(cap);
    const F = () => new Float32Array(cap);
    this.alive = new Uint8Array(cap);
    this.x = F(); this.y = F(); this.z = F(); this.vx = F(); this.vy = F(); this.vz = F();
    this.life = F(); this.maxLife = F(); this.dmg = F(); this.radius = F(); this.pierce = new Int16Array(cap);
    this.kind = new Uint8Array(cap); this.element = new Uint8Array(cap); this.target = new Int32Array(cap); this.t = F();
    this.ox = F(); this.oz = F(); this.ax = F(); this.az = F(); this.speed = F();
    this.ailment = new Uint8Array(cap); this.chance = F(); this.knock = F(); this.drain = F(); this.aoe = F();
    this.cls = new Uint8Array(cap); this.move = new Int16Array(cap); this.size = F();
    this.hitE = new Int32Array(cap * HIT_RING); this.hitT = new Float32Array(cap * HIT_RING); this.hitN = new Uint8Array(cap);
    this.weight = new Uint8Array(cap); this.pushP = new Uint8Array(cap); this.holdP = new Uint8Array(cap);
    this.heldT = F(); this.heldBtn = new Uint8Array(cap); this.src = new Int16Array(cap);
    this.depth = new Uint8Array(cap); this.fx = new Uint8Array(cap); this.fxR = F(); this.extra = new Uint8Array(cap);
  }

  spawn(): number {
    const i = this.fl.take();
    if (i < 0) return -1;
    this.alive[i] = 1;
    this.count++;
    if (i >= this.hi) this.hi = i + 1;
    this.hitN[i] = 0;
    this.weight[i] = 0; this.pushP[i] = 0; this.holdP[i] = 0; this.heldT[i] = 0; this.heldBtn[i] = 0; this.src[i] = -1;
    this.depth[i] = 255; this.fx[i] = 0; this.fxR[i] = 0; this.extra[i] = 0;
    this.t[i] = 0; this.vy[i] = 0; this.y[i] = 0; this.aoe[i] = 0; this.drain[i] = 0; this.target[i] = -1; this.size[i] = 1;
    for (let k = 0; k < HIT_RING; k++) this.hitE[i * HIT_RING + k] = -1;
    return i;
  }

  kill(i: number) {
    if (!this.alive[i]) return;
    this.alive[i] = 0;
    this.count--;
    this.fl.give(i);
  }

  /** true if projectile i hit enemy e within the last `cool` seconds (time = sim time) */
  recentlyHit(i: number, e: number, now: number): boolean {
    const b = i * HIT_RING;
    for (let k = 0; k < HIT_RING; k++) if (this.hitE[b + k] === e && this.hitT[b + k] > now) return true;
    return false;
  }
  markHit(i: number, e: number, until: number) {
    const k = this.hitN[i]++ % HIT_RING;
    this.hitE[i * HIT_RING + k] = e;
    this.hitT[i * HIT_RING + k] = until;
  }

  clearHostile() {
    for (let i = 0; i < this.hi; i++) if (this.alive[i] && this.kind[i] === PK.hostile) this.kill(i);
  }
  clear() {
    for (let i = 0; i < this.hi; i++) if (this.alive[i]) this.kill(i);
  }
}

export const ZK = { damage: 0, root: 1, meteor: 2, hostileSlam: 3, dashHit: 4, heal: 5, steam: 6 } as const;

export class ZonePool {
  readonly cap: number;
  private fl: FreeList;
  count = 0;
  hi = 0;
  alive: Uint8Array;
  x: Float32Array; z: Float32Array; radius: Float32Array; life: Float32Array; maxLife: Float32Array;
  tick: Float32Array; tickT: Float32Array; dmg: Float32Array; element: Uint8Array; attach: Uint8Array;
  pull: Float32Array; kind: Uint8Array; ailment: Uint8Array; chance: Float32Array; knock: Float32Array;
  delay: Float32Array; cls: Uint8Array; move: Int16Array;
  /** Phase 8a: the Push and Hold Power a zone carries (Tag Actions have no move slot to read them from), and the
   *  species index of the enemy behind a hostile zone (-1 = none) */
  pushP: Uint8Array; holdP: Uint8Array; src: Int16Array;
  /** Phase 8b: coat depth override (255 = by slot) and an extra agent (Slipstream) */
  depth: Uint8Array; extra: Uint8Array;

  constructor(cap: number) {
    this.cap = cap;
    this.fl = new FreeList(cap);
    const F = () => new Float32Array(cap);
    this.alive = new Uint8Array(cap);
    this.x = F(); this.z = F(); this.radius = F(); this.life = F(); this.maxLife = F();
    this.tick = F(); this.tickT = F(); this.dmg = F(); this.element = new Uint8Array(cap); this.attach = new Uint8Array(cap);
    this.pull = F(); this.kind = new Uint8Array(cap); this.ailment = new Uint8Array(cap); this.chance = F(); this.knock = F();
    this.delay = F(); this.cls = new Uint8Array(cap); this.move = new Int16Array(cap);
    this.pushP = new Uint8Array(cap); this.holdP = new Uint8Array(cap); this.src = new Int16Array(cap);
    this.depth = new Uint8Array(cap); this.extra = new Uint8Array(cap);
  }
  spawn(): number {
    const i = this.fl.take();
    if (i < 0) return -1;
    this.alive[i] = 1;
    this.count++;
    if (i >= this.hi) this.hi = i + 1;
    this.pushP[i] = 0; this.holdP[i] = 0; this.src[i] = -1; this.depth[i] = 255; this.extra[i] = 0;
    this.tickT[i] = 0; this.delay[i] = 0; this.pull[i] = 0; this.attach[i] = 0; this.chance[i] = 0; this.knock[i] = 0;
    return i;
  }
  kill(i: number) {
    if (!this.alive[i]) return;
    this.alive[i] = 0;
    this.count--;
    this.fl.give(i);
  }
  clear() {
    for (let i = 0; i < this.hi; i++) if (this.alive[i]) this.kill(i);
  }
}

export class PickupPool {
  readonly cap: number;
  private fl: FreeList;
  count = 0;
  hi = 0;
  alive: Uint8Array;
  x: Float32Array; y: Float32Array; z: Float32Array; value: Float32Array; kind: Uint8Array; magnet: Uint8Array; t: Float32Array;
  constructor(cap: number) {
    this.cap = cap;
    this.fl = new FreeList(cap);
    this.alive = new Uint8Array(cap);
    this.x = new Float32Array(cap); this.y = new Float32Array(cap); this.z = new Float32Array(cap);
    this.value = new Float32Array(cap); this.kind = new Uint8Array(cap); this.magnet = new Uint8Array(cap); this.t = new Float32Array(cap);
  }
  spawn(): number {
    const i = this.fl.take();
    if (i < 0) return -1;
    this.alive[i] = 1;
    this.count++;
    if (i >= this.hi) this.hi = i + 1;
    this.magnet[i] = 0;
    this.t[i] = 0;
    return i;
  }
  kill(i: number) {
    if (!this.alive[i]) return;
    this.alive[i] = 0;
    this.count--;
    this.fl.give(i);
  }
  clear() {
    for (let i = 0; i < this.hi; i++) if (this.alive[i]) this.kill(i);
  }
}
