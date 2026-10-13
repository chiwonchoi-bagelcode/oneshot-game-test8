import * as THREE from 'three';
import { ctx, TABLE } from '../game/ctx';
import { makeSplatTexture } from '../render/textures';
import { clay } from '../render/materials';
import { blob } from '../render/shapes';
import { clamp, rand, randRange, V3, _v1, pick } from '../core/math';
import type { Guest } from '../actors/guest';
import type { Butler } from '../actors/butler';
import type { Item } from './items';

export type MessKind = 'food' | 'cream' | 'jelly' | 'wine' | 'tea' | 'sneeze' | 'water' | 'toupee';

export interface MessTarget {
  active: boolean;
  headSphere(out: THREE.Vector3): number;
  bodySphere(out: THREE.Vector3): number;
  receiveMess(kind: MessKind, color: string, point: THREE.Vector3, part: 'head' | 'body', source: Guest | Butler | null, obj?: THREE.Object3D): boolean;
}

interface Projectile {
  obj: THREE.Object3D;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  kind: MessKind;
  color: string;
  radius: number;
  source: Guest | Butler | null;
  age: number;
  ignore?: MessTarget | null;
}

interface Stain {
  pool: StainPool;
  idx: number;
  pos: THREE.Vector3;
  rot: number;
  target: number;
  grow: number;
}

interface StainPool {
  mesh: THREE.InstancedMesh;
  n: number;
}

const POOL_CAP = 90;

export interface Puddle {
  pos: THREE.Vector3;
  r: number;
  color: string;
}

const G = 7.5; // cartoon gravity: slightly floaty arcs read better

export class Mess {
  stains: Stain[] = [];
  puddles: Puddle[] = [];
  projectiles: Projectile[] = [];
  score = 0;
  private splatTex: THREE.Texture[] = [];
  private stainCount = 0;
  private drops: THREE.InstancedMesh;
  private dropData: { p: THREE.Vector3; v: THREE.Vector3; life: number; s: number }[] = [];
  private dropIdx = 0;
  private dummy = new THREE.Object3D();
  private dropColor = new THREE.Color();
  private recentAim = new Map<MessTarget, number>();

  constructor() {
    for (let i = 0; i < 5; i++) this.splatTex.push(makeSplatTexture(i));
    const N = 260;
    this.drops = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshStandardMaterial({ roughness: 0.15, envMapIntensity: 1.2 }), N);
    this.drops.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.drops.frustumCulled = false;
    for (let i = 0; i < N; i++) {
      this.dropData.push({ p: V3(), v: V3(), life: 0, s: 0 });
      this.dummy.scale.setScalar(0);
      this.dummy.updateMatrix();
      this.drops.setMatrixAt(i, this.dummy.matrix);
      this.drops.setColorAt(i, this.dropColor.set('#ffffff'));
    }
    ctx.scene.add(this.drops);
  }

  targets(): MessTarget[] {
    const t: MessTarget[] = [];
    for (const g of ctx.guests) if (g.active) t.push(g);
    if (ctx.butler?.active) t.push(ctx.butler);
    return t;
  }

  // -------------------------------------------------------------------------
  // Stains (persistent decals)
  // -------------------------------------------------------------------------
  private pools = new Map<string, StainPool>();

  private pool(kind: 'food' | 'liquid', tex: number): StainPool {
    const key = kind + tex;
    let p = this.pools.get(key);
    if (!p) {
      const mat = new THREE.MeshStandardMaterial({
        color: '#ffffff',
        alphaMap: this.splatTex[tex],
        transparent: true,
        depthWrite: false,
        roughness: kind === 'liquid' ? 0.08 : 0.4,
        envMapIntensity: kind === 'liquid' ? 1.4 : 0.8,
        polygonOffset: true,
        polygonOffsetFactor: -2 - this.pools.size * 0.3,
        polygonOffsetUnits: -4,
        opacity: kind === 'liquid' ? 0.92 : 1,
      });
      const geo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
      const mesh = new THREE.InstancedMesh(geo, mat, POOL_CAP);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.receiveShadow = true;
      mesh.renderOrder = 2 + this.pools.size;
      const zero = new THREE.Matrix4().makeScale(0, 0, 0);
      for (let i = 0; i < POOL_CAP; i++) {
        mesh.setMatrixAt(i, zero);
        mesh.setColorAt(i, this.dropColor.set('#ffffff'));
      }
      ctx.scene.add(mesh);
      p = { mesh, n: 0 };
      this.pools.set(key, p);
    }
    return p;
  }

  stain(pos: THREE.Vector3, r: number, color: string, kind: 'food' | 'liquid', onGround = false) {
    const onTable = !onGround && Math.abs(pos.x) < TABLE.halfW && Math.abs(pos.z) < TABLE.halfL;
    const y = onTable ? TABLE.y : 0.0;
    const pool = this.pool(kind, Math.floor(rand() * this.splatTex.length));
    const idx = pool.n % POOL_CAP;
    pool.n++;
    pool.mesh.setColorAt(idx, this.dropColor.set(color));
    if (pool.mesh.instanceColor) pool.mesh.instanceColor.needsUpdate = true;
    this.stainCount++;
    this.stains.push({ pool, idx, pos: V3(pos.x, y + 0.0015 + (this.stainCount % 30) * 0.00012, pos.z), rot: rand() * Math.PI * 2, target: r, grow: 0 });
    this.score += onTable ? 1.2 : 0.6;
  }

  /** Liquid poured out at `mouth`. Soaks the cloth and, near an edge, drips into a slippery puddle. */
  spillAt(mouth: THREE.Vector3, vol: number, color: string, src?: Item) {
    const p = mouth.clone();
    const r = clamp(0.09 + vol * 0.14, 0.07, 0.26);
    const insideTable = Math.abs(p.x) < TABLE.halfW + 0.05 && Math.abs(p.z) < TABLE.halfL + 0.05;
    if (insideTable) this.stain(V3(clamp(p.x, -TABLE.halfW + 0.04, TABLE.halfW - 0.04), TABLE.y, clamp(p.z, -TABLE.halfL + 0.04, TABLE.halfL - 0.04)), r, color, 'liquid');
    const toSide = TABLE.halfW - Math.abs(p.x);
    const toEnd = TABLE.halfL - Math.abs(p.z);
    if (vol > 0.25 && (toSide < 0.3 || toEnd < 0.3 || !insideTable)) {
      // the cloth soaks it up and it drips onto the lawn
      const side = toSide < toEnd || !insideTable;
      const gx = side ? Math.sign(p.x || 1) * (TABLE.halfW + 0.18) : clamp(p.x, -TABLE.halfW, TABLE.halfW);
      const gz = side ? clamp(p.z, -TABLE.halfL, TABLE.halfL) : Math.sign(p.z || 1) * (TABLE.halfL + 0.18);
      const gp = V3(gx, 0, gz);
      const ex = side ? Math.sign(gx) * (TABLE.halfW + 0.01) : gx;
      const ez = side ? gz : Math.sign(gz) * (TABLE.halfL + 0.01);
      for (let i = 0; i < 14; i++) {
        ctx.later(i * 0.07, () => this.drop(V3(ex + randRange(-0.04, 0.04), TABLE.y - 0.05, ez + randRange(-0.04, 0.04)), V3(randRange(-0.05, 0.05), randRange(-0.6, -0.1), randRange(-0.05, 0.05)), color, 0.008));
      }
      ctx.later(0.6, () => this.puddle(gp, 0.26 + vol * 0.16, color));
    }
    for (let i = 0; i < 8; i++) this.drop(p, V3(randRange(-0.6, 0.6), randRange(0.3, 1.2), randRange(-0.6, 0.6)), color, 0.008);
    // Splash anyone sitting right next to it
    for (const t of this.targets()) {
      const c = V3();
      t.bodySphere(c);
      if (c.distanceTo(p) < 0.42 && rand() < 0.6) {
        t.receiveMess(color === '#6d0f1e' ? 'wine' : 'tea', color, c.clone().lerp(p, 0.5), 'body', null);
      }
    }
    void src;
  }

  puddle(pos: THREE.Vector3, r: number, color: string) {
    // merge with an existing puddle nearby
    for (const pd of this.puddles) {
      if (pd.pos.distanceTo(pos) < pd.r) {
        pd.r = Math.min(0.6, pd.r + r * 0.4);
        this.stain(pos, r, color, 'liquid', true);
        return;
      }
    }
    this.puddles.push({ pos: pos.clone(), r, color });
    this.stain(pos, r, color, 'liquid', true);
    this.score += 2;
  }

  slipAt(pos: THREE.Vector3): Puddle | null {
    for (const pd of this.puddles) {
      const dx = pd.pos.x - pos.x, dz = pd.pos.z - pos.z;
      if (dx * dx + dz * dz < pd.r * pd.r) return pd;
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Projectiles
  // -------------------------------------------------------------------------
  /** Choose a likely head to land on, so slapstick reads instead of random noise. */
  private pickVictim(from: THREE.Vector3, dir: THREE.Vector3, maxDist: number, exclude?: Guest | Butler | null): MessTarget | null {
    let best: MessTarget | null = null;
    let bestScore = -1;
    const d = V3(dir.x, 0, dir.z);
    if (d.lengthSq() > 1e-5) d.normalize();
    for (const t of this.targets()) {
      if (t === exclude) continue;
      const c = V3();
      t.headSphere(c);
      const to = c.clone().sub(from).setY(0);
      const dist = to.length();
      if (dist > maxDist || dist < 0.12) continue;
      to.normalize();
      const align = d.lengthSq() > 0 ? to.dot(d) : 0.3;
      const s = align + 0.7 - dist * 0.25 + rand() * 0.6;
      if (s > bestScore) {
        bestScore = s;
        best = t;
      }
    }
    return bestScore > 0.35 ? best : null;
  }

  private ballistic(from: THREE.Vector3, to: THREE.Vector3, T: number) {
    return V3((to.x - from.x) / T, (to.y - from.y) / T + 0.5 * G * T, (to.z - from.z) / T);
  }

  flingChunk(from: THREE.Vector3, dir: THREE.Vector3, color: string, kind: 'food' | 'cream', source: Guest | Butler | null, speedMul = 1) {
    const r = kind === 'cream' ? 0.03 : 0.026;
    const obj = blob(r * 1.2, r, r * 1.1, clay(color, { normal: 0.9 }), 10);
    obj.position.copy(from);
    ctx.scene.add(obj);
    let vel: THREE.Vector3;
    let victim = rand() < 0.5 ? this.pickVictim(from, dir, 1.6, null) : null;
    // one aimed chunk per head per moment — keeps it funny rather than punishing
    if (victim && this.recentAim.get(victim)! > ctx.time - 0.6) victim = null;
    if (victim) this.recentAim.set(victim, ctx.time);
    if (victim) {
      const c = V3();
      victim.headSphere(c);
      c.x += randRange(-0.05, 0.05);
      c.z += randRange(-0.05, 0.05);
      vel = this.ballistic(from, c, randRange(0.45, 0.65));
    } else {
      const d = V3(dir.x + randRange(-0.8, 0.8), 0, dir.z + randRange(-0.8, 0.8));
      if (d.lengthSq() < 1e-4) d.set(randRange(-1, 1), 0, randRange(-1, 1));
      d.normalize().multiplyScalar(randRange(0.9, 1.8) * speedMul);
      vel = d.setY(randRange(1.6, 2.6));
    }
    this.projectiles.push({ obj, vel, spin: V3(randRange(-9, 9), randRange(-9, 9), randRange(-9, 9)), kind, color, radius: r, source, age: 0 });
  }

  launchJelly(from: THREE.Vector3, dir: THREE.Vector3, color: string, source: Guest | Butler | null) {
    const mat = new THREE.MeshPhysicalMaterial({ color, roughness: 0.12, clearcoat: 1, emissive: new THREE.Color(color).multiplyScalar(0.18) });
    const obj = blob(0.075, 0.07, 0.075, mat, 16);
    obj.position.copy(from);
    ctx.scene.add(obj);
    const victim = this.pickVictim(from, dir, 1.9, null) ?? this.pickVictim(from, V3(), 1.9, null);
    let vel: THREE.Vector3;
    if (victim) {
      const c = V3();
      victim.headSphere(c);
      c.y += 0.06;
      vel = this.ballistic(from, c, 0.75);
    } else {
      vel = V3(dir.x, 0, dir.z).normalize().multiplyScalar(1.4).setY(2.8);
    }
    this.projectiles.push({ obj, vel, spin: V3(randRange(-4, 4), randRange(-6, 6), randRange(-4, 4)), kind: 'jelly', color, radius: 0.07, source, age: 0 });
  }

  /** Generic flying object (toupee, hat, tray contents...). */
  launchObject(obj: THREE.Object3D, from: THREE.Vector3, vel: THREE.Vector3, kind: MessKind, color: string, radius: number, source: Guest | Butler | null, ignore?: MessTarget | null) {
    obj.position.copy(from);
    ctx.scene.add(obj);
    this.projectiles.push({ obj, vel, spin: V3(randRange(-6, 6), randRange(-6, 6), randRange(-6, 6)), kind, color, radius, source, age: 0, ignore });
  }

  launchAt(obj: THREE.Object3D, from: THREE.Vector3, target: MessTarget | null, kind: MessKind, color: string, radius: number, source: Guest | Butler | null, fallbackDir: THREE.Vector3) {
    let vel: THREE.Vector3;
    if (target) {
      const c = V3();
      target.headSphere(c);
      vel = this.ballistic(from, c, randRange(0.5, 0.7));
    } else vel = fallbackDir.clone().setY(2.2);
    this.launchObject(obj, from, vel, kind, color, radius, source);
  }

  pickVictimNear(from: THREE.Vector3, dir: THREE.Vector3, maxDist: number, exclude?: Guest | Butler | null) {
    return this.pickVictim(from, dir, maxDist, exclude);
  }

  // -------------------------------------------------------------------------
  // Sprays: spit-takes and sneezes
  // -------------------------------------------------------------------------
  spray(origin: THREE.Vector3, dir: THREE.Vector3, color: string, kind: 'wine' | 'tea' | 'sneeze', source: Guest | Butler | null) {
    const d = dir.clone().normalize();
    const n = kind === 'sneeze' ? 40 : 55;
    for (let i = 0; i < n; i++) {
      const v = d.clone().multiplyScalar(randRange(1.6, 3.4));
      v.x += randRange(-0.6, 0.6);
      v.y += randRange(-0.1, 0.9);
      v.z += randRange(-0.6, 0.6);
      this.drop(origin, v, color, kind === 'sneeze' ? 0.006 : 0.009);
    }
    const hits: MessTarget[] = [];
    for (const t of this.targets()) {
      if (t === source) continue;
      const c = V3();
      t.headSphere(c);
      const to = c.clone().sub(origin);
      const dist = to.length();
      if (dist > 1.75) continue;
      const ang = to.normalize().angleTo(d);
      if (ang < 0.5) {
        hits.push(t);
        t.receiveMess(kind, color, c, 'head', source);
      }
    }
    // contaminate / stain what's on the table in front
    const land = origin.clone().addScaledVector(V3(d.x, 0, d.z).normalize(), 0.55).setY(TABLE.y);
    if (Math.abs(land.x) < TABLE.halfW && Math.abs(land.z) < TABLE.halfL) {
      this.stain(land, kind === 'sneeze' ? 0.09 : 0.17, color, 'liquid');
      for (const it of ctx.items) {
        if (!it.isFood) continue;
        if (it.worldPos(_v1).distanceTo(land) < 0.35) it.contam = Math.min(1, it.contam + 0.6);
      }
    }
    return hits;
  }

  drop(p: THREE.Vector3, v: THREE.Vector3, color: string, size: number) {
    const d = this.dropData[this.dropIdx];
    d.p.copy(p);
    d.v.copy(v);
    d.life = 1.4;
    d.s = size * randRange(0.7, 1.4);
    this.drops.setColorAt(this.dropIdx, this.dropColor.set(color));
    if (this.drops.instanceColor) this.drops.instanceColor.needsUpdate = true;
    this.dropIdx = (this.dropIdx + 1) % this.dropData.length;
  }

  // -------------------------------------------------------------------------
  update(dt: number) {
    for (let i = this.stains.length - 1; i >= 0; i--) {
      const st = this.stains[i];
      st.grow = Math.min(1, st.grow + dt * 3);
      const k = 1 - Math.pow(1 - st.grow, 3);
      this.dummy.position.copy(st.pos);
      this.dummy.rotation.set(0, st.rot, 0);
      this.dummy.scale.setScalar(Math.max(0.001, st.target * k));
      this.dummy.updateMatrix();
      st.pool.mesh.setMatrixAt(st.idx, this.dummy.matrix);
      st.pool.mesh.instanceMatrix.needsUpdate = true;
      if (st.grow >= 1) this.stains.splice(i, 1);
    }
    // droplets
    for (let i = 0; i < this.dropData.length; i++) {
      const d = this.dropData[i];
      if (d.life <= 0) continue;
      d.life -= dt;
      d.v.y -= G * dt;
      d.p.addScaledVector(d.v, dt);
      const onTable = Math.abs(d.p.x) < TABLE.halfW && Math.abs(d.p.z) < TABLE.halfL;
      const floor = onTable ? TABLE.y : 0;
      if (d.p.y < floor) {
        d.life = 0;
      }
      this.dummy.position.copy(d.p);
      this.dummy.scale.setScalar(d.life > 0 ? d.s : 0);
      this.dummy.updateMatrix();
      this.drops.setMatrixAt(i, this.dummy.matrix);
    }
    this.drops.instanceMatrix.needsUpdate = true;

    // projectiles
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.age += dt;
      p.vel.y -= G * dt;
      p.obj.position.addScaledVector(p.vel, dt);
      p.obj.rotation.x += p.spin.x * dt;
      p.obj.rotation.y += p.spin.y * dt;
      p.obj.rotation.z += p.spin.z * dt;
      if (p.kind === 'jelly') {
        const w = Math.sin(p.age * 25) * 0.18;
        p.obj.scale.set(0.075 * (1 + w), 0.07 * (1 - w), 0.075 * (1 + w));
      }
      if (this.collide(p)) {
        this.projectiles.splice(i, 1);
        continue;
      }
      if (p.age > 6) {
        ctx.scene.remove(p.obj);
        this.projectiles.splice(i, 1);
      }
    }
  }

  private collide(p: Projectile): boolean {
    const pos = p.obj.position;
    if (p.age > 0.06) {
      for (const t of this.targets()) {
        if (t === p.ignore) continue;
        if (t === p.source && p.age < 0.25) continue;
        const c = V3();
        const hr = t.headSphere(c);
        if (c.distanceTo(pos) < hr + p.radius) {
          if (t.receiveMess(p.kind, p.color, pos.clone(), 'head', p.source, p.obj)) {
            this.score += 3;
            return true;
          }
        }
        const br = t.bodySphere(c);
        if (c.distanceTo(pos) < br + p.radius) {
          if (t.receiveMess(p.kind, p.color, pos.clone(), 'body', p.source, p.obj)) {
            this.score += 2;
            return true;
          }
        }
      }
    }
    const onTable = Math.abs(pos.x) < TABLE.halfW && Math.abs(pos.z) < TABLE.halfL;
    if (p.vel.y < 0 && onTable && pos.y < TABLE.y + p.radius * 0.6) {
      this.landOn(p, TABLE.y);
      return true;
    }
    if (p.vel.y < 0 && pos.y < p.radius * 0.6) {
      this.landOn(p, 0);
      return true;
    }
    return false;
  }

  private landOn(p: Projectile, y: number) {
    const pos = p.obj.position;
    pos.y = y + p.radius * 0.4;
    if (p.kind === 'toupee') {
      p.obj.rotation.set(0, p.obj.rotation.y, 0);
      pos.y = y + 0.01;
      ctx.audio.sfx('flop', pos);
      return;
    }
    if (p.kind === 'jelly') {
      p.obj.scale.set(0.11, 0.035, 0.11);
      p.obj.rotation.set(0, 0, 0);
      this.stain(pos, 0.12, p.color, 'food', y === 0);
      ctx.audio.sfx('splat', pos);
    } else {
      p.obj.scale.multiplyScalar(1.0);
      p.obj.scale.y *= 0.4;
      p.obj.rotation.set(0, p.obj.rotation.y, 0);
      this.stain(pos, 0.06, p.color, 'food', y === 0);
      ctx.audio.sfx('plop', pos);
    }
    // landing on someone's plate contaminates it
    for (const it of ctx.items) {
      if (it.isFood && it.worldPos(_v1).distanceTo(pos) < it.radius + 0.04) {
        it.contam = Math.min(1, it.contam + 0.25);
        it.bump(0.4, pos);
      }
    }
    if (y > 0) ctx.emit({ type: 'splat', pos: pos.clone(), loud: 0.35, gross: 0.02, chain: true });
  }
}
