import * as THREE from 'three';
import { ctx, addSurface, TABLE } from '../game/ctx';
import type { Surface, Impact } from '../game/types';
import type { Guest } from '../actors/guest';
import { clay, glassMaterial, invisibleMat, clayUnique } from '../render/materials';
import { blob, capsule, cylinder, lathe, mesh, torus, rbox, sphereGeo } from '../render/shapes';
import { clamp, clamp01, easeInCubic, rand, randRange, randSign, V3, _v1, _v2 } from '../core/math';
import { mergeStatic, noMerge } from '../render/merge';
import type { FoodKind, DrinkKind } from './layout';

export type ItemKind = 'plate' | 'glass' | 'jelly' | 'cake' | 'teapot' | 'vase' | 'stand';
export type ItemState = 'ok' | 'tipped' | 'smashed' | 'held' | 'launched';

const COLORS = {
  plate: '#fbf8f1',
  rim: '#3f63a8',
  bread: '#f2dfb4',
  crust: '#c98f45',
  cucumber: '#7fb84a',
  scone: '#d9a45a',
  jam: '#b8202a',
  cream: '#fffaf0',
  pie: '#b8732f',
  sausage: '#d08a3c',
  wine: '#6d0f1e',
  tea: '#8a5323',
  champagne: '#f1d77a',
};

let stinkTex: THREE.Texture | null = null;
function makeStinkTex() {
  if (stinkTex) return stinkTex;
  const c = document.createElement('canvas');
  c.width = 64; c.height = 96;
  const g = c.getContext('2d')!;
  g.strokeStyle = 'rgba(120,170,40,0.95)';
  g.lineWidth = 5;
  g.lineCap = 'round';
  for (let k = 0; k < 3; k++) {
    g.beginPath();
    const x0 = 14 + k * 18;
    for (let y = 92; y > 8; y -= 4) {
      const x = x0 + Math.sin(y * 0.16 + k) * 5;
      if (y === 92) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }
  stinkTex = new THREE.CanvasTexture(c);
  stinkTex.colorSpace = THREE.SRGBColorSpace;
  return stinkTex;
}

export abstract class Item {
  readonly group = new THREE.Group();
  owner: Guest | null = null;
  state: ItemState = 'ok';
  /** How much the fly has walked on it (0..1). */
  contam = 0;
  /** Guests who have seen the fly on this item. */
  readonly seenBy = new Set<Guest>();
  readonly surfaces: Surface[] = [];
  readonly home = new THREE.Vector3();
  wobble = 0;
  wobbleT = 0;
  isFood = false;
  isLiquid = false;
  radius = 0.1;
  height = 0.1;
  /** Topple animation */
  protected toppleT = -1;
  protected toppleAxis = new THREE.Vector3();
  protected toppleFrom = new THREE.Quaternion();
  protected toppleTo = new THREE.Quaternion();
  protected stink?: THREE.Sprite;

  constructor(public kind: ItemKind) {
    this.group.userData.item = this;
  }

  place(x: number, z: number, y = TABLE.y) {
    this.group.position.set(x, y, z);
    this.home.set(x, y, z);
    ctx.scene.add(this.group);
    return this;
  }

  protected addProxy(kind: Surface['kind'], geo: THREE.BufferGeometry, y: number, priority = 1): Surface {
    const p = new THREE.Mesh(geo, invisibleMat);
    p.position.y = y;
    this.group.add(p);
    return this.pushSurface({ kind, proxy: p, anchor: this.group, item: this, guest: this.owner, enabled: true, priority });
  }

  protected pushSurface(s: Surface) {
    this.surfaces.push(addSurface(s));
    return s;
  }

  setOwner(g: Guest) {
    this.owner = g;
    for (const s of this.surfaces) s.guest = g;
    return this;
  }

  get flyOn() {
    return ctx.fly && ctx.fly.landedOn?.item === this;
  }

  worldPos(out = new THREE.Vector3()) {
    return this.group.getWorldPosition(out);
  }

  /** Center top of the item in world space (where things splash from). */
  topPos(out = new THREE.Vector3()) {
    this.group.getWorldPosition(out);
    out.y += this.height * (this.state === 'tipped' ? 0.3 : 1);
    return out;
  }

  update(dt: number) {
    if (this.wobble > 0.001) {
      this.wobbleT += dt * 22;
      this.wobble *= Math.exp(-dt * 3.5);
      this.applyWobble();
    }
    if (this.toppleT >= 0) {
      this.toppleT = Math.min(1, this.toppleT + dt / 0.32);
      const k = easeInCubic(this.toppleT);
      this.group.quaternion.slerpQuaternions(this.toppleFrom, this.toppleTo, k);
      if (this.toppleT >= 1) {
        this.toppleT = -1;
        this.onToppled();
      }
    }
    if (this.isFood) this.updateStink(dt);
  }

  protected updateStink(dt: number) {
    if (this.contam < 0.12 || this.state === 'launched') {
      if (this.stink) this.stink.visible = false;
      return;
    }
    if (!this.stink) {
      this.stink = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeStinkTex(), transparent: true, depthWrite: false }));
      this.stink.scale.set(0.09, 0.14, 1);
      ctx.scene.add(this.stink);
    }
    this.stink.visible = true;
    this.topPos(this.stink.position);
    const t = ctx.time;
    this.stink.position.y += 0.08 + Math.sin(t * 3) * 0.01;
    (this.stink.material as THREE.SpriteMaterial).opacity = clamp01(this.contam * 1.3) * (0.75 + Math.sin(t * 5) * 0.2);
    (this.stink.material as THREE.SpriteMaterial).rotation = Math.sin(t * 2.2) * 0.15;
  }

  protected applyWobble() {
    const w = this.wobble * Math.sin(this.wobbleT);
    if (this.state === 'ok') {
      this.group.rotation.z = w * 0.12;
      this.group.rotation.x = w * 0.08 * Math.cos(this.wobbleT * 0.7);
    }
  }

  /** Small table shake. */
  bump(strength: number, from: THREE.Vector3) {
    if (this.state !== 'ok') return;
    this.wobble = Math.min(1.2, this.wobble + strength);
  }

  /** Heavy hit (swat, flail, handbag). */
  abstract impact(imp: Impact): void;

  topple(dir: THREE.Vector3) {
    if (this.state === 'tipped' || this.state === 'launched') return false;
    this.state = 'tipped';
    const d = _v1.set(dir.x, 0, dir.z);
    if (d.lengthSq() < 1e-4) d.set(randSign(), 0, randSign());
    d.normalize();
    // axis perpendicular to dir, rotate so object's +y goes toward dir
    this.toppleAxis.set(d.z, 0, -d.x);
    this.toppleFrom.copy(this.group.quaternion);
    const q = new THREE.Quaternion().setFromAxisAngle(this.toppleAxis, Math.PI / 2 - 0.08);
    this.toppleTo.copy(q).multiply(this.toppleFrom);
    this.toppleT = 0;
    this.group.position.y = TABLE.y + 0.0;
    return true;
  }

  protected onToppled() {}

  /** Called when the fly sits on this item. */
  flyTick(dt: number) {
    if (this.isFood) this.contam = Math.min(1, this.contam + dt * 0.55);
  }
}

// ---------------------------------------------------------------------------
// Plates of food
// ---------------------------------------------------------------------------
function buildPlate(r = 0.13) {
  const g = new THREE.Group();
  const p = lathe(
    [
      [0, 0.004],
      [r * 0.62, 0.004],
      [r * 0.7, 0.012],
      [r, 0.022],
      [r * 1.02, 0.03],
      [r * 0.97, 0.03],
      [r * 0.66, 0.017],
      [0, 0.015],
    ],
    clay(COLORS.plate, { rough: 0.25, normal: 0.15 }),
    28,
  );
  g.add(p);
  const rim = torus(r * 0.9, 0.004, clay(COLORS.rim, { rough: 0.3, normal: 0.1 }), Math.PI * 2, false);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.025;
  g.add(rim);
  return mergeStatic(g, false) as THREE.Group;
}

function sandwichGeo() {
  const s = new THREE.Shape();
  const r = 0.05;
  s.moveTo(-r, -r * 0.6);
  s.lineTo(r, -r * 0.6);
  s.lineTo(0, r * 0.95);
  s.closePath();
  return new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 2 });
}
let _sandGeo: THREE.ExtrudeGeometry | null = null;

function buildFoodPiece(kind: FoodKind): THREE.Group {
  const g = new THREE.Group();
  switch (kind) {
    case 'sandwich': {
      _sandGeo ??= sandwichGeo();
      const b1 = mesh(_sandGeo, clay(COLORS.bread, { normal: 0.6 }));
      b1.rotation.x = -Math.PI / 2;
      g.add(b1);
      const cu = mesh(_sandGeo, clay(COLORS.cucumber, { normal: 0.3 }), false);
      cu.rotation.x = -Math.PI / 2;
      cu.scale.set(1.04, 1.04, 0.35);
      cu.position.y = 0.019;
      g.add(cu);
      const b2 = mesh(_sandGeo, clay(COLORS.bread, { normal: 0.6 }));
      b2.rotation.x = -Math.PI / 2;
      b2.position.y = 0.026;
      g.add(b2);
      break;
    }
    case 'scone': {
      const base = lathe([[0, 0], [0.036, 0], [0.04, 0.012], [0.038, 0.03], [0.028, 0.042], [0, 0.046]], clay(COLORS.scone, { normal: 0.8 }), 18);
      g.add(base);
      const cream = blob(0.03, 0.014, 0.03, clay(COLORS.cream, { normal: 0.5 }), 14);
      cream.position.y = 0.05;
      g.add(cream);
      const jam = blob(0.018, 0.012, 0.018, clay(COLORS.jam, { rough: 0.2, normal: 0.2 }), 12, false);
      jam.position.set(0.004, 0.062, 0.003);
      g.add(jam);
      break;
    }
    case 'pie': {
      const body = cylinder(0.042, 0.046, 0.05, clay(COLORS.pie, { normal: 0.8 }), 18);
      body.position.y = 0.025;
      g.add(body);
      const crimp = torus(0.04, 0.009, clay('#c98a45', { normal: 0.7 }));
      crimp.rotation.x = Math.PI / 2;
      crimp.position.y = 0.05;
      g.add(crimp);
      break;
    }
    case 'sausage': {
      const c = capsule(0.018, 0.06, clay(COLORS.sausage, { normal: 0.8 }), 10);
      c.rotation.z = Math.PI / 2;
      c.position.y = 0.02;
      g.add(c);
      const m = blob(0.012, 0.012, 0.012, clay('#a0522d'), 8, false);
      m.position.set(0.048, 0.02, 0);
      g.add(m);
      break;
    }
    case 'petitfour': {
      const col = ['#f7b8c8', '#c9e4a6', '#fff0b3', '#c7b8f0'][Math.floor(rand() * 4)];
      const b = rbox(0.04, 0.032, 0.04, 0.008, clay(col, { normal: 0.4 }));
      b.position.y = 0.016;
      g.add(b);
      const top = blob(0.008, 0.008, 0.008, clay('#d8253a', { rough: 0.2 }), 8, false);
      top.position.y = 0.036;
      g.add(top);
      break;
    }
  }
  return mergeStatic(g) as THREE.Group;
}

export const FOOD_COLOR: Record<FoodKind, string> = {
  sandwich: COLORS.bread,
  scone: COLORS.scone,
  pie: COLORS.pie,
  sausage: COLORS.sausage,
  petitfour: '#f7b8c8',
};

export class PlateItem extends Item {
  pieces: THREE.Group[] = [];
  bitesLeft: number[] = [];
  readonly food: FoodKind;
  plateGroup: THREE.Group;

  constructor(food: FoodKind, count = 3) {
    super('plate');
    this.isFood = true;
    this.food = food;
    this.radius = 0.15;
    this.height = 0.06;
    this.plateGroup = buildPlate();
    this.group.add(this.plateGroup);
    const n = food === 'petitfour' ? 4 : count;
    for (let i = 0; i < n; i++) {
      const p = buildFoodPiece(food);
      const a = (i / n) * Math.PI * 2 + rand() * 0.4;
      const r = n === 1 ? 0 : 0.048;
      p.position.set(Math.cos(a) * r, 0.018, Math.sin(a) * r);
      p.rotation.y = rand() * Math.PI * 2;
      this.group.add(p);
      this.pieces.push(p);
      this.bitesLeft.push(2);
    }
    this.addProxy('food', new THREE.CylinderGeometry(0.16, 0.16, 0.08, 16), 0.04, 2);
  }

  get remaining() {
    return this.pieces.filter((p) => p.visible).length;
  }

  /** Take a bite-sized morsel: returns a small mesh to put on a fork / in a hand. */
  takeBite(): THREE.Object3D | null {
    if (this.state === 'smashed') return null;
    for (let i = this.pieces.length - 1; i >= 0; i--) {
      const p = this.pieces[i];
      if (!p.visible) continue;
      this.bitesLeft[i]--;
      const morsel = buildFoodPiece(this.food);
      morsel.scale.setScalar(0.55);
      if (this.bitesLeft[i] <= 0) p.visible = false;
      else p.scale.multiplyScalar(0.72);
      return morsel;
    }
    return null;
  }

  impact(imp: Impact) {
    const top = this.topPos(V3());
    const mess = ctx.mess;
    const color = FOOD_COLOR[this.food];
    if (this.state !== 'smashed') {
      this.state = 'smashed';
      // Squash every piece flat and smear them
      for (const p of this.pieces) {
        if (!p.visible) continue;
        p.scale.set(p.scale.x * 1.35, p.scale.y * 0.3, p.scale.z * 1.35);
        p.position.x += randRange(-0.03, 0.03);
        p.position.z += randRange(-0.03, 0.03);
      }
      this.plateGroup.rotation.z = randRange(-0.12, 0.12);
      this.plateGroup.rotation.x = randRange(-0.12, 0.12);
    }
    mess.stain(top.clone().setY(TABLE.y), randRange(0.1, 0.16), color, 'food');
    if (this.food === 'scone') mess.stain(top.clone().setY(TABLE.y).add(V3(0.05, 0, 0.02)), 0.07, COLORS.jam, 'food');
    // Fling chunks
    const n = 2 + Math.floor(rand() * 2);
    for (let i = 0; i < n; i++) {
      mess.flingChunk(top, imp.dir, color, this.food === 'scone' && i === 0 ? 'cream' : 'food', imp.source);
    }
    ctx.audio.sfx('splat', top);
    ctx.emit({ type: 'splat', pos: top, loud: 0.65, gross: 0.06, source: imp.source, chain: true });
  }
}

// ---------------------------------------------------------------------------
// Drinks
// ---------------------------------------------------------------------------
export class GlassItem extends Item {
  fill = 1;
  readonly drink: DrinkKind;
  liquid: THREE.Mesh;
  mouthLocal = new THREE.Vector3();
  spilled = false;

  constructor(drink: DrinkKind) {
    super('glass');
    this.isLiquid = true;
    this.drink = drink;
    this.radius = 0.06;
    const lc = drink === 'wine' ? COLORS.wine : drink === 'tea' ? COLORS.tea : COLORS.champagne;
    const liqMat = clay(lc, { rough: 0.12, normal: 0.05, envI: 1.2 });
    if (drink === 'tea') {
      // Porcelain teacup on a saucer
      this.height = 0.07;
      const saucer = lathe([[0, 0.002], [0.06, 0.004], [0.075, 0.014], [0.07, 0.016], [0, 0.009]], clay('#f8f4ff', { rough: 0.22, normal: 0.12 }), 24);
      this.group.add(saucer);
      const cup = lathe([[0, 0.012], [0.026, 0.012], [0.03, 0.02], [0.045, 0.05], [0.05, 0.07], [0.046, 0.07], [0.04, 0.05], [0.024, 0.022], [0, 0.02]], clay('#f8f4ff', { rough: 0.22, normal: 0.12 }), 24);
      this.group.add(cup);
      const band = torus(0.048, 0.003, clay('#d4a840', { metal: 0.6, rough: 0.3, normal: 0.05 }), Math.PI * 2, false);
      band.rotation.x = Math.PI / 2;
      band.position.y = 0.066;
      this.group.add(band);
      const handle = torus(0.016, 0.004, clay('#f8f4ff', { rough: 0.22, normal: 0.12 }), Math.PI * 1.4, false);
      handle.position.set(0.052, 0.045, 0);
      handle.rotation.z = -Math.PI * 0.7;
      this.group.add(handle);
      this.liquid = cylinder(0.042, 0.042, 0.004, liqMat, 20, false);
      this.liquid.position.y = 0.058;
      this.group.add(this.liquid);
      this.mouthLocal.set(0, 0.07, 0);
    } else if (drink === 'wine') {
      this.height = 0.17;
      const g = lathe([[0, 0], [0.034, 0.002], [0.032, 0.006], [0.006, 0.01], [0.004, 0.08], [0.02, 0.09], [0.038, 0.12], [0.036, 0.17]], glassMaterial(), 24, false);
      this.group.add(g);
      this.liquid = lathe([[0, 0.084], [0.018, 0.09], [0.033, 0.115], [0.034, 0.128], [0, 0.128]], liqMat, 20, false);
      this.group.add(this.liquid);
      this.mouthLocal.set(0, 0.17, 0);
    } else {
      this.height = 0.2;
      const g = lathe([[0, 0], [0.03, 0.002], [0.028, 0.006], [0.005, 0.01], [0.004, 0.09], [0.018, 0.1], [0.022, 0.2]], glassMaterial('#fff9e0'), 20, false);
      this.group.add(g);
      this.liquid = lathe([[0, 0.096], [0.016, 0.104], [0.019, 0.17], [0, 0.17]], liqMat, 16, false);
      this.group.add(this.liquid);
      this.mouthLocal.set(0, 0.2, 0);
    }
    noMerge(this.liquid);
    mergeStatic(this.group, false);
    this.addProxy('glass', new THREE.CylinderGeometry(0.075, 0.07, this.height + 0.02, 12), this.height * 0.55, 3);
  }

  get liquidColor() {
    return this.drink === 'wine' ? COLORS.wine : this.drink === 'tea' ? COLORS.tea : COLORS.champagne;
  }

  mouthWorld(out = new THREE.Vector3()) {
    return this.group.localToWorld(out.copy(this.mouthLocal));
  }

  sip() {
    this.fill = Math.max(0.15, this.fill - 0.18);
    this.liquid.scale.y = 0.4 + this.fill * 0.6;
  }

  impact(imp: Impact) {
    if (this.state === 'held') return;
    const d = _v2.copy(imp.dir);
    if (this.state === 'ok') {
      this.topple(d);
      ctx.audio.sfx('clink', this.worldPos(V3()));
    } else {
      // already tipped: shove it along
      this.group.position.addScaledVector(V3(d.x, 0, d.z).normalize(), 0.06);
      this.spill(0.5);
    }
  }

  bump(strength: number, from: THREE.Vector3) {
    super.bump(strength, from);
    if (this.state !== 'ok') return;
    const dist = this.worldPos(V3()).distanceTo(from);
    if (strength > 0.55 && rand() < strength * 0.75 - dist * 0.25) {
      const dir = this.worldPos(V3()).sub(from).setY(0);
      this.topple(dir.lengthSq() > 1e-4 ? dir : V3(randSign(), 0, randSign()));
      ctx.audio.sfx('clink', this.worldPos(V3()));
    }
  }

  protected onToppled() {
    this.spill(1);
  }

  spill(amount: number) {
    if (this.fill <= 0.05) return;
    const mouth = this.mouthWorld(V3());
    this.liquid.visible = false;
    const vol = this.fill * amount;
    this.fill = Math.max(0, this.fill - amount);
    this.spilled = true;
    ctx.mess.spillAt(mouth, vol, this.liquidColor, this);
    ctx.audio.sfx('pour', mouth);
    ctx.emit({ type: 'spill', pos: mouth, loud: 0.55, gross: 0.04, chain: true });
  }
}

// ---------------------------------------------------------------------------
// Jelly — wobbly, flies beautifully, makes an excellent hat
// ---------------------------------------------------------------------------
export class JellyItem extends Item {
  jelly: THREE.Mesh;
  color: string;
  constructor(color: string) {
    super('jelly');
    this.color = color;
    this.isFood = true;
    this.radius = 0.12;
    this.height = 0.13;
    this.group.add(buildPlate(0.12));
    const pts: [number, number][] = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      pts.push([0.085 - t * 0.035 + Math.sin(t * Math.PI * 3) * 0.004, 0.015 + t * 0.1]);
    }
    pts.push([0.03, 0.118], [0, 0.12]);
    pts.unshift([0, 0.015]);
    const mat = new THREE.MeshPhysicalMaterial({ color, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.1, transmission: 0, emissive: new THREE.Color(color).multiplyScalar(0.18), envMapIntensity: 1.3 });
    this.jelly = lathe(pts, mat, 24);
    // fluting
    const pos = this.jelly.geometry.attributes.position;
    const geo = this.jelly.geometry.clone();
    const p2 = geo.attributes.position;
    for (let i = 0; i < p2.count; i++) {
      const x = p2.getX(i), z = p2.getZ(i);
      const a = Math.atan2(z, x);
      const f = 1 + Math.sin(a * 8) * 0.06;
      p2.setX(i, x * f);
      p2.setZ(i, z * f);
    }
    geo.computeVertexNormals();
    this.jelly.geometry = geo;
    void pos;
    this.group.add(noMerge(this.jelly));
    const cherry = blob(0.014, 0.014, 0.014, clay('#c4102a', { rough: 0.15 }), 10);
    cherry.position.y = 0.128;
    this.jelly.add(cherry);
    this.addProxy('jelly', new THREE.CylinderGeometry(0.11, 0.12, 0.14, 14), 0.07, 2);
  }

  protected applyWobble() {
    const w = this.wobble * Math.sin(this.wobbleT);
    this.jelly.scale.set(1 + w * 0.12, 1 - w * 0.15, 1 + w * 0.12);
    this.jelly.rotation.z = w * 0.15 * Math.cos(this.wobbleT * 0.6);
  }

  flyTick(dt: number) {
    super.flyTick(dt);
    if (rand() < dt * 2) this.wobble = Math.max(this.wobble, 0.15);
  }

  impact(imp: Impact) {
    if (this.state === 'launched') {
      ctx.mess.stain(this.worldPos(V3()).setY(TABLE.y), 0.08, this.color, 'food');
      return;
    }
    this.state = 'launched';
    this.jelly.visible = false;
    if (this.stink) this.stink.visible = false;
    const from = this.worldPos(V3()).setY(TABLE.y + 0.07);
    ctx.mess.launchJelly(from, imp.dir, this.color, imp.source);
    ctx.mess.stain(from.clone().setY(TABLE.y), 0.1, this.color, 'food');
    ctx.audio.sfx('boing', from);
    ctx.emit({ type: 'crash', pos: from, loud: 0.7, gross: 0.04, source: imp.source, chain: true });
  }
}

// ---------------------------------------------------------------------------
// The Cake — the prize
// ---------------------------------------------------------------------------
export class CakeItem extends Item {
  dents = 0;
  beacon: THREE.Mesh;
  tiers: THREE.Mesh[] = [];
  constructor() {
    super('cake');
    this.isFood = true;
    this.radius = 0.2;
    this.height = 0.42;
    const silver = clay('#d9dde3', { metal: 0.85, rough: 0.25, normal: 0.1 });
    const stand = lathe([[0, 0], [0.1, 0.002], [0.09, 0.02], [0.025, 0.04], [0.02, 0.07], [0.2, 0.075], [0.21, 0.085], [0, 0.085]], silver, 28);
    this.group.add(stand);
    const icing = clay('#fff4f6', { rough: 0.35, normal: 0.55 });
    const pink = clay('#f6b3c5', { rough: 0.35, normal: 0.55 });
    const tierDefs: [number, number, number, THREE.Material][] = [
      [0.17, 0.1, 0.085, icing],
      [0.125, 0.09, 0.185, pink],
      [0.08, 0.08, 0.275, icing],
    ];
    for (const [r, h, y, m] of tierDefs) {
      const t = lathe([[0, 0], [r, 0], [r + 0.004, 0.01], [r + 0.002, h - 0.012], [r - 0.012, h], [0, h]], m, 32);
      t.position.y = y;
      this.group.add(t);
      this.tiers.push(t);
      // piped cream rosettes around the top edge
      const n = Math.round(r * 70);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const ros = blob(0.016, 0.014, 0.016, clay('#fffdf5', { normal: 0.9 }), 8, false);
        ros.position.set(Math.cos(a) * (r - 0.012), y + h + 0.004, Math.sin(a) * (r - 0.012));
        this.group.add(ros);
      }
      // drip of jam
      const band = torus(r + 0.004, 0.006, clay('#d0405a', { rough: 0.25 }), Math.PI * 2, false);
      band.rotation.x = Math.PI / 2;
      band.position.y = y + 0.025;
      this.group.add(band);
    }
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const ch = blob(0.017, 0.017, 0.017, clay('#c0102a', { rough: 0.12 }), 12);
      ch.position.set(Math.cos(a) * 0.04, 0.37, Math.sin(a) * 0.04);
      this.group.add(ch);
    }
    const topCh = blob(0.022, 0.022, 0.022, clay('#c0102a', { rough: 0.12 }), 12);
    topCh.position.y = 0.375;
    this.group.add(topCh);
    const stem = cylinder(0.002, 0.002, 0.04, clay('#3d6b1f'), 6, false);
    stem.position.set(0.006, 0.405, 0);
    stem.rotation.z = -0.3;
    this.group.add(stem);
    // beacon (shown when the cake can be claimed)
    this.beacon = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.32, 2.4, 24, 1, true),
      new THREE.MeshBasicMaterial({ color: '#fff3a0', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
    );
    this.beacon.position.y = 1.3;
    this.group.add(noMerge(this.beacon));
    mergeStatic(this.group);
    this.addProxy('cake', new THREE.CylinderGeometry(0.15, 0.22, 0.42, 16), 0.21, 4);
  }

  topWorld(out = new THREE.Vector3()) {
    return this.group.localToWorld(out.set(0, 0.4, 0));
  }

  flyTick(dt: number) {
    this.contam = Math.min(1, this.contam + dt * 0.3);
  }

  impact(imp: Impact) {
    this.dents++;
    const top = this.worldPos(V3()).setY(TABLE.y + 0.3);
    const n = 3;
    for (let i = 0; i < n; i++) ctx.mess.flingChunk(top, imp.dir, '#fff4f6', 'cream', imp.source, 1.25);
    // a big cream dent on the cake itself
    const dent = blob(0.06, 0.03, 0.06, clay('#fffaf2', { normal: 1 }), 10, false);
    const a = rand() * Math.PI * 2;
    dent.position.set(Math.cos(a) * 0.11, 0.2 + rand() * 0.12, Math.sin(a) * 0.11);
    this.group.add(dent);
    ctx.mess.stain(top.clone().setY(TABLE.y), 0.16, '#fff4f6', 'food');
    ctx.audio.sfx('splat', top);
    ctx.emit({ type: 'splat', pos: top, loud: 0.8, gross: 0.08, source: imp.source, chain: true });
    ctx.prank('cream', top);
  }

  update(dt: number) {
    super.update(dt);
    const m = this.beacon.material as THREE.MeshBasicMaterial;
    const want = ctx.game?.cakeOpen ? 0.22 + Math.sin(ctx.time * 3) * 0.08 : 0;
    m.opacity += (want - m.opacity) * Math.min(1, dt * 3);
    this.beacon.visible = m.opacity > 0.01;
  }
}

// ---------------------------------------------------------------------------
// Props: teapot, vase, tiered stand
// ---------------------------------------------------------------------------
export class TeapotItem extends Item {
  fill = 1;
  constructor() {
    super('teapot');
    this.isLiquid = true;
    this.radius = 0.11;
    this.height = 0.2;
    const china = clay('#f4f7ff', { rough: 0.22, normal: 0.15 });
    const blue = clay('#3a5fae', { rough: 0.3, normal: 0.1 });
    const body = blob(0.1, 0.085, 0.1, china, 24);
    body.position.y = 0.09;
    this.group.add(body);
    const band = torus(0.098, 0.006, blue, Math.PI * 2, false);
    band.rotation.x = Math.PI / 2;
    band.position.y = 0.09;
    this.group.add(band);
    const lid = blob(0.055, 0.03, 0.055, china, 16);
    lid.position.y = 0.17;
    this.group.add(lid);
    const knob = blob(0.016, 0.016, 0.016, blue, 10);
    knob.position.y = 0.205;
    this.group.add(knob);
    const spout = capsule(0.014, 0.09, china, 8);
    spout.position.set(0.12, 0.12, 0);
    spout.rotation.z = -0.9;
    this.group.add(spout);
    const handle = torus(0.045, 0.011, china, Math.PI * 1.2);
    handle.position.set(-0.1, 0.1, 0);
    handle.rotation.z = Math.PI * 0.4;
    this.group.add(handle);
    mergeStatic(this.group);
    this.addProxy('prop', new THREE.CylinderGeometry(0.12, 0.12, 0.22, 12), 0.11, 1);
  }
  impact(imp: Impact) {
    if (this.state === 'ok') {
      this.topple(imp.dir);
      ctx.audio.sfx('crash', this.worldPos(V3()));
    }
  }
  protected onToppled() {
    const p = this.worldPos(V3());
    p.y = TABLE.y + 0.05;
    ctx.mess.spillAt(p, 1.2, COLORS.tea, this);
    ctx.emit({ type: 'spill', pos: p, loud: 0.6, gross: 0.03, chain: true });
  }
  bump(strength: number, from: THREE.Vector3) {
    super.bump(strength * 0.5, from);
  }
}

export class VaseItem extends Item {
  constructor() {
    super('vase');
    this.radius = 0.08;
    this.height = 0.3;
    const v = lathe([[0, 0], [0.045, 0], [0.06, 0.05], [0.05, 0.12], [0.03, 0.16], [0.04, 0.18], [0, 0.18]], clay('#7fb3c9', { rough: 0.2, normal: 0.2 }), 20);
    this.group.add(v);
    const colors = ['#e2445c', '#f59ab3', '#fff3f0', '#e2445c', '#f7c548'];
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const r = i === 0 ? 0 : 0.05;
      const stem = cylinder(0.003, 0.003, 0.1, clay('#3f7a2a'), 5, false);
      stem.position.set(Math.cos(a) * r * 0.5, 0.21, Math.sin(a) * r * 0.5);
      this.group.add(stem);
      const f = blob(0.03, 0.026, 0.03, clay(colors[i % colors.length], { normal: 0.9 }), 12);
      f.position.set(Math.cos(a) * r, 0.27 + (i === 0 ? 0.03 : 0), Math.sin(a) * r);
      this.group.add(f);
      const leaf = blob(0.022, 0.006, 0.012, clay('#4f8a30'), 8, false);
      leaf.position.set(Math.cos(a + 0.5) * 0.05, 0.22, Math.sin(a + 0.5) * 0.05);
      leaf.rotation.y = -a;
      this.group.add(leaf);
    }
    mergeStatic(this.group);
    this.addProxy('prop', new THREE.CylinderGeometry(0.1, 0.08, 0.32, 12), 0.16, 1);
  }
  impact(imp: Impact) {
    if (this.state === 'ok') {
      this.topple(imp.dir);
      ctx.audio.sfx('crash', this.worldPos(V3()));
    }
  }
  bump(strength: number, from: THREE.Vector3) {
    super.bump(strength, from);
    if (this.state === 'ok' && strength > 0.8 && rand() < 0.35) this.topple(this.worldPos(V3()).sub(from));
  }
  protected onToppled() {
    const p = this.worldPos(V3());
    ctx.mess.spillAt(p.setY(TABLE.y + 0.04), 0.7, '#9fc7d8', this);
    ctx.emit({ type: 'spill', pos: p, loud: 0.5, gross: 0.0, chain: true });
  }
}

/** Three-tier afternoon tea stand — shared food for everyone. */
export class StandItem extends Item {
  pieces: THREE.Group[] = [];
  constructor() {
    super('stand');
    this.isFood = true;
    this.radius = 0.14;
    this.height = 0.36;
    const gold = clay('#d6b25e', { metal: 0.7, rough: 0.3, normal: 0.1 });
    const pole = cylinder(0.006, 0.006, 0.38, gold, 8);
    pole.position.y = 0.19;
    this.group.add(pole);
    const ring = torus(0.012, 0.004, gold);
    ring.position.y = 0.385;
    this.group.add(ring);
    const tiers: [number, number, FoodKind][] = [
      [0.13, 0.01, 'sandwich'],
      [0.105, 0.14, 'scone'],
      [0.085, 0.26, 'petitfour'],
    ];
    for (const [r, y, food] of tiers) {
      const p = buildPlate(r);
      p.position.y = y;
      this.group.add(p);
      const n = food === 'petitfour' ? 4 : 3;
      for (let i = 0; i < n; i++) {
        const piece = buildFoodPiece(food);
        const a = (i / n) * Math.PI * 2;
        piece.position.set(Math.cos(a) * r * 0.5, y + 0.02, Math.sin(a) * r * 0.5);
        piece.rotation.y = -a;
        piece.scale.setScalar(food === 'sandwich' ? 0.8 : 0.9);
        this.group.add(piece);
        this.pieces.push(piece);
      }
    }
    mergeStatic(this.group);
    this.addProxy('food', new THREE.CylinderGeometry(0.14, 0.15, 0.4, 14), 0.2, 2);
  }
  impact(imp: Impact) {
    const top = this.topPos(V3());
    if (this.state === 'ok') this.topple(imp.dir);
    for (let i = 0; i < 3; i++) ctx.mess.flingChunk(top, imp.dir, pickFood(), rand() < 0.3 ? 'cream' : 'food', imp.source);
    ctx.audio.sfx('crash', top);
    ctx.emit({ type: 'crash', pos: top, loud: 0.85, gross: 0.05, source: imp.source, chain: true });
  }
  protected onToppled() {
    const p = this.worldPos(V3()).setY(TABLE.y);
    ctx.mess.stain(p, 0.18, COLORS.cream, 'food');
  }
}

function pickFood() {
  return [COLORS.scone, COLORS.bread, '#f7b8c8', COLORS.jam][Math.floor(rand() * 4)];
}

export function makeDrink(kind: DrinkKind) {
  return new GlassItem(kind);
}

export { COLORS as ITEM_COLORS };
export const _unused = { clamp, clayUnique, sphereGeo };
