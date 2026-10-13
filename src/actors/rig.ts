import * as THREE from 'three';
import { clay, skinMaterial } from '../render/materials';
import { blob, capsule, cylinder, mesh, placeBetween, sphereGeo } from '../render/shapes';
import { clamp, damp, lerp, V3 } from '../core/math';
import { mergeStatic, noMerge } from '../render/merge';
import { Mouth } from './mouth';

export interface Look {
  skin: string;
  headR: number;
  headS: [number, number, number];
  jaw: number;
  eyeR: number;
  eyeGap: number;
  eyeY: number;
  noseKind: 'bulb' | 'long' | 'hook' | 'button' | 'potato';
  noseSize: number;
  noseColor?: string;
  browColor: string;
  browThick: number;
  browLen: number;
  mouthW: number;
  mouthY: number;
  torsoColor: string;
  torsoTex?: THREE.Texture;
  torsoW: number;
  torsoH: number;
  torsoD: number;
  belly: number;
  bust?: number;
  sleeveColor: string;
  handColor: string;
  trouser: string;
  shoe: string;
  neckLen: number;
  ears: number;
  rosy: number;
  armLen?: number;
  skirt?: boolean;
}

export interface FaceParams {
  smile: number;
  open: number;
  wobble: number;
  pucker: number;
  browAng: number; // + = angry (inner ends down), - = worried
  browY: number;
  lid: number; // 1 open .. 0 closed
  lowerLid: number; // 0 none .. 1 squint
  puff: number;
  green: number;
  blush: number;
  cross: number;
  bulge: number;
}

export const neutralFace = (): FaceParams => ({
  smile: 0.35, open: 0, wobble: 0, pucker: 0, browAng: 0, browY: 0, lid: 0.85, lowerLid: 0, puff: 0, green: 0, blush: 0, cross: 0, bulge: 0,
});

interface Eye {
  group: THREE.Group;
  pupilPivot: THREE.Group;
  upper: THREE.Mesh;
  lower: THREE.Mesh;
  ball: THREE.Mesh;
}

export interface Arm {
  side: number;
  shoulder: THREE.Vector3; // torso-local
  l1: number;
  l2: number;
  upper: THREE.Mesh;
  lower: THREE.Mesh;
  hand: THREE.Group;
  /** World-space hand target */
  target: THREE.Vector3;
  /** current (smoothed) world target */
  cur: THREE.Vector3;
  speed: number;
  pole: THREE.Vector3;
  /** Hand roll so items can be held upright etc. */
  handUp: THREE.Vector3;
  elbow: THREE.Vector3;
}

export interface Leg {
  side: number;
  hip: THREE.Vector3; // hips-local
  thigh: THREE.Mesh;
  shin: THREE.Mesh;
  shoe: THREE.Mesh;
  foot: THREE.Vector3; // hips-local target
}

const GREEN = new THREE.Color('#93b84a');
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _m = new THREE.Matrix4();

export function solveTwoBone(shoulder: THREE.Vector3, target: THREE.Vector3, l1: number, l2: number, pole: THREE.Vector3, outElbow: THREE.Vector3, outEnd: THREE.Vector3) {
  const d = _a.subVectors(target, shoulder);
  let dist = d.length();
  const maxR = l1 + l2 - 1e-3;
  const minR = Math.abs(l1 - l2) + 0.02;
  if (dist < 1e-5) d.set(0, -1, 0), (dist = 1e-5);
  const dir = d.divideScalar(dist);
  dist = clamp(dist, minR, maxR);
  outEnd.copy(shoulder).addScaledVector(dir, dist);
  const cosA = clamp((l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  const pd = _b.copy(pole).addScaledVector(dir, -pole.dot(dir));
  if (pd.lengthSq() < 1e-6) pd.set(0, -1, 0).addScaledVector(dir, dir.y);
  pd.normalize();
  outElbow.copy(shoulder).addScaledVector(dir, l1 * cosA).addScaledVector(pd, l1 * sinA);
}

export class Rig {
  readonly root = new THREE.Group();
  readonly hips = new THREE.Group();
  readonly torso = new THREE.Group();
  readonly headPivot = new THREE.Group();
  readonly head = new THREE.Group();
  readonly skinMat: THREE.MeshPhysicalMaterial;
  readonly baseSkin: THREE.Color;
  readonly look: Look;
  readonly eyes: Eye[] = [];
  readonly brows: THREE.Mesh[] = [];
  nose!: THREE.Mesh;
  readonly noseTip = new THREE.Object3D();
  readonly mouth: Mouth;
  readonly cheeks: THREE.Mesh[] = [];
  readonly blushes: THREE.Mesh[] = [];
  readonly blushMat: THREE.MeshBasicMaterial;
  readonly arms: Arm[] = [];
  readonly legs: Leg[] = [];
  readonly headSurf: (x: number, y: number) => number;
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly face = neutralFace();
  readonly faceTarget = neutralFace();
  /** Head orientation targets (radians, relative to torso) */
  headYaw = 0;
  headPitch = 0;
  headRoll = 0;
  headYawT = 0;
  headPitchT = 0;
  headRollT = 0;
  headTurnSpeed = 7;
  /** Pupil aim in head-local space (normalized dir) */
  readonly gaze = new THREE.Vector3(0, 0, 1);
  readonly gazeT = new THREE.Vector3(0, 0, 1);
  lean = 0;
  leanT = 0;
  sideLean = 0;
  sideLeanT = 0;
  twist = 0;
  twistT = 0;
  stand = 0;
  standT = 0;
  bob = 0;
  hipsBaseY = 0.47;
  runPhase = 0;
  running = 0;
  fallen = 0;
  private sweat: THREE.Mesh;
  private torsoMesh: THREE.Mesh;

  constructor(look: Look) {
    this.look = look;
    this.baseSkin = new THREE.Color(look.skin);
    this.skinMat = skinMaterial(look.skin);
    const cloth = clay(look.torsoColor, { map: look.torsoTex ?? null, normal: 0.7, rough: 0.55, repeat: 2 });
    const sleeve = clay(look.sleeveColor, { normal: 0.7, rough: 0.55 });

    this.root.add(this.hips);
    this.hips.position.y = this.hipsBaseY;
    this.hips.add(this.torso);

    // --- torso: a soft pear of clay
    const T = look;
    const tm = blob(T.torsoW, T.torsoH * 0.55, T.torsoD, cloth, 24);
    tm.position.y = T.torsoH * 0.5;
    this.torso.add(noMerge(tm));
    this.torsoMesh = tm;
    if (T.belly > 0) {
      const belly = blob(T.torsoW * 0.9, T.torsoH * 0.38, T.torsoD * 0.9, cloth, 20);
      belly.position.set(0, T.torsoH * 0.28, T.belly);
      this.torso.add(belly);
    }
    if (T.bust) {
      const bust = blob(T.torsoW * 0.85, T.torsoH * 0.2, T.torsoD * 0.7, cloth, 20);
      bust.position.set(0, T.torsoH * 0.68, T.bust);
      this.torso.add(bust);
    }
    if (T.skirt) {
      const sk = blob(T.torsoW * 1.25, T.torsoH * 0.3, T.torsoD * 1.5, cloth, 20);
      sk.position.set(0, 0.0, 0.08);
      this.torso.add(sk);
    }
    const neck = cylinder(0.045, 0.055, T.neckLen + 0.04, this.skinMat, 12);
    neck.position.y = T.torsoH * 1.02 + T.neckLen / 2;
    this.torso.add(neck);
    this.headPivot.position.y = T.torsoH * 1.02 + T.neckLen;
    this.torso.add(noMerge(this.headPivot));
    this.headPivot.add(this.head);

    // --- head: an ellipsoid with heavy, jowly lower half
    const a = T.headR * T.headS[0], b = T.headR * T.headS[1], c = T.headR * T.headS[2];
    this.a = a; this.b = b; this.c = c;
    this.head.position.y = b * 0.92;
    const hg = new THREE.SphereGeometry(1, 36, 28);
    const p = hg.attributes.position;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i) * a, y = p.getY(i) * b, z = p.getZ(i) * c;
      const k = Math.max(0, -y / b);
      x *= 1 + T.jaw * k;
      z *= 1 + T.jaw * 0.5 * k;
      p.setXYZ(i, x, y, z);
    }
    hg.computeVertexNormals();
    const headMesh = mesh(hg, this.skinMat);
    this.head.add(headMesh);
    this.headSurf = (x: number, y: number) => {
      const yn = y / b;
      const k = Math.max(0, -yn);
      const x0 = x / (1 + T.jaw * k);
      const inner = 1 - (x0 / a) * (x0 / a) - yn * yn;
      return inner > 0 ? c * Math.sqrt(inner) * (1 + T.jaw * 0.5 * k) : 0;
    };

    // --- eyes
    const white = new THREE.MeshPhysicalMaterial({ color: '#fbfbf7', roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 0.9 });
    const black = new THREE.MeshPhysicalMaterial({ color: '#0d0d10', roughness: 0.1, clearcoat: 1 });
    const hlMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
    for (const s of [-1, 1]) {
      const g = new THREE.Group();
      const ex = s * T.eyeGap;
      g.position.set(ex, T.eyeY, this.headSurf(ex, T.eyeY) - T.eyeR * 0.3);
      const ball = new THREE.Mesh(sphereGeo(T.eyeR, 20, 14), white);
      g.add(ball);
      const pp = new THREE.Group();
      const pupil = new THREE.Mesh(sphereGeo(T.eyeR * 0.42, 14, 10), black);
      pupil.position.z = T.eyeR * 0.8;
      pupil.scale.z = 0.5;
      pp.add(pupil);
      const hl = new THREE.Mesh(sphereGeo(T.eyeR * 0.12, 8, 6), hlMat);
      hl.position.set(T.eyeR * 0.15, T.eyeR * 0.18, T.eyeR * 0.98);
      pp.add(hl);
      g.add(pp);
      const lidGeoU = new THREE.SphereGeometry(T.eyeR * 1.1, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2);
      const up = new THREE.Mesh(lidGeoU, this.skinMat);
      g.add(up);
      const lidGeoL = new THREE.SphereGeometry(T.eyeR * 1.07, 18, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
      const lo = new THREE.Mesh(lidGeoL, this.skinMat);
      g.add(lo);
      this.head.add(noMerge(g));
      g.traverse((o) => (o.castShadow = false));
      this.eyes.push({ group: g, pupilPivot: pp, upper: up, lower: lo, ball });
      // brows
      const brow = capsule(T.browThick, T.browLen, clay(T.browColor, { normal: 1, rough: 0.7 }), 8, false);
      brow.rotation.z = Math.PI / 2;
      this.head.add(noMerge(brow));
      this.brows.push(brow);
      // ears
      if (T.ears > 0) {
        const ear = blob(T.ears * 0.5, T.ears, T.ears * 0.7, this.skinMat, 12);
        ear.position.set(s * a * 1.0, T.eyeY - 0.015, -c * 0.05);
        this.head.add(ear);
      }
      // cheeks (puff when about to be sick)
      const ck = blob(T.mouthW * 0.32, T.mouthW * 0.28, T.mouthW * 0.24, this.skinMat, 14, false);
      ck.castShadow = false;
      const cx = s * T.mouthW * 0.62;
      const cy = T.mouthY + T.mouthW * 0.1;
      ck.position.set(cx, cy, this.headSurf(cx, cy) - T.mouthW * 0.2);
      ck.userData.base = ck.position.clone();
      this.head.add(noMerge(ck));
      this.cheeks.push(ck);
    }
    // rosy blush spots
    this.blushMat = new THREE.MeshBasicMaterial({ color: '#ff5a6a', transparent: true, opacity: 0, depthWrite: false });
    for (const s of [-1, 1]) {
      const bx = s * (T.eyeGap + T.eyeR * 0.6), by = T.eyeY - T.eyeR * 1.6;
      const bm = new THREE.Mesh(sphereGeo(1, 12, 8), this.blushMat);
      bm.scale.set(T.eyeR * 0.9, T.eyeR * 0.55, 0.004);
      bm.position.set(bx, by, this.headSurf(bx, by) + 0.002);
      bm.lookAt(bm.position.clone().multiplyScalar(2));
      this.head.add(bm);
      this.blushes.push(bm);
    }

    // --- nose
    const nmat = T.noseColor ? clay(T.noseColor, { normal: 0.6 }) : this.skinMat;
    const ny = T.eyeY - T.eyeR * 1.15;
    const nz = this.headSurf(0, ny);
    const ns = T.noseSize;
    switch (T.noseKind) {
      case 'bulb':
        this.nose = blob(ns * 0.85, ns * 0.8, ns, nmat, 18);
        this.nose.position.set(0, ny - ns * 0.2, nz + ns * 0.45);
        break;
      case 'potato':
        this.nose = blob(ns * 1.05, ns * 0.85, ns * 0.9, nmat, 18);
        this.nose.position.set(0, ny - ns * 0.25, nz + ns * 0.4);
        break;
      case 'long':
        this.nose = blob(ns * 0.45, ns * 0.55, ns * 1.4, nmat, 16);
        this.nose.position.set(0, ny - ns * 0.1, nz + ns * 0.9);
        this.nose.rotation.x = 0.35;
        break;
      case 'hook':
        this.nose = blob(ns * 0.5, ns * 0.9, ns * 1.1, nmat, 16);
        this.nose.position.set(0, ny, nz + ns * 0.7);
        this.nose.rotation.x = -0.25;
        break;
      case 'button':
        this.nose = blob(ns * 0.7, ns * 0.6, ns * 0.65, nmat, 14);
        this.nose.position.set(0, ny - ns * 0.2, nz + ns * 0.3);
        break;
    }
    this.head.add(this.nose);
    this.noseTip.position.copy(this.nose.position);
    this.noseTip.position.z += ns * (T.noseKind === 'long' ? 1.3 : 0.8);
    this.noseTip.position.y += T.noseKind === 'long' ? -ns * 0.4 : 0;
    this.head.add(this.noseTip);

    // --- mouth
    this.mouth = new Mouth(T.mouthW, T.mouthY, this.headSurf);
    this.head.add(noMerge(this.mouth.mesh));

    // sweat drop
    this.sweat = blob(0.012, 0.018, 0.01, new THREE.MeshPhysicalMaterial({ color: '#bfe6ff', roughness: 0.05, clearcoat: 1, transparent: true, opacity: 0.85 }), 10, false);
    this.sweat.position.set(a * 0.75, T.eyeY + b * 0.3, c * 0.55);
    this.sweat.visible = false;
    this.head.add(noMerge(this.sweat));

    // --- arms
    const handMat = T.handColor === T.skin ? this.skinMat : clay(T.handColor, { normal: 0.5 });
    const L = T.armLen ?? 0.27;
    for (const s of [-1, 1]) {
      const up = capsule(0.036, L - 0.02, sleeve, 10);
      const lo = capsule(0.032, L - 0.03, sleeve, 10);
      const hand = new THREE.Group();
      const palm = blob(0.04, 0.03, 0.045, handMat, 14);
      palm.position.z = 0.02;
      hand.add(palm);
      const thumb = capsule(0.012, 0.02, handMat, 6, false);
      thumb.position.set(-s * 0.035, 0.01, 0.02);
      thumb.rotation.z = s * 0.8;
      hand.add(thumb);
      const cuff = cylinder(0.038, 0.034, 0.03, clay('#fbf7ee', { normal: 0.4 }), 12, false);
      cuff.rotation.x = Math.PI / 2;
      cuff.position.z = -0.02;
      hand.add(cuff);
      this.torso.add(noMerge(up), noMerge(lo), noMerge(hand));
      const sh = V3(s * T.torsoW * 0.95, T.torsoH * 0.86, 0);
      const arm: Arm = {
        side: s,
        shoulder: sh,
        l1: L,
        l2: L,
        upper: up,
        lower: lo,
        hand,
        target: V3(),
        cur: V3(),
        speed: 10,
        pole: V3(s * 0.9, -0.6, -0.6),
        handUp: V3(0, 1, 0),
        elbow: V3(),
      };
      this.arms.push(arm);
    }
    // index 0 = left side (+x? no: s=-1 → -x → the diner's RIGHT hand). Keep explicit:
    // arms[0] is at local -x = right hand, arms[1] is at local +x = left hand.

    // --- legs
    const trouser = clay(T.trouser, { normal: 0.7, rough: 0.6 });
    const shoeMat = clay(T.shoe, { rough: 0.25, normal: 0.3 });
    for (const s of [-1, 1]) {
      const th = capsule(0.055, 0.3, trouser, 10);
      const sh = capsule(0.045, 0.36, trouser, 10);
      const shoe = blob(0.055, 0.04, 0.09, shoeMat, 14);
      this.hips.add(noMerge(th), noMerge(sh), noMerge(shoe));
      this.legs.push({ side: s, hip: V3(s * 0.095, 0.02, 0), thigh: th, shin: sh, shoe, foot: V3() });
    }

    this.root.updateMatrixWorld(true);
    for (const arm of this.arms) {
      this.restHand(arm, arm.target);
      arm.cur.copy(arm.target);
    }
  }

  /** Bake static clay bits into a handful of meshes once accessories are attached. */
  finalize() {
    for (const a of this.arms) mergeStatic(a.hand);
    mergeStatic(this.head);
    mergeStatic(this.torso);
  }

  /** Default resting hand position in world space (on the table edge / lap). */
  restHand(arm: Arm, out: THREE.Vector3) {
    out.set(arm.side * 0.16, 0.81, 0.42);
    this.root.localToWorld(out);
    return out;
  }

  headWorld(out = new THREE.Vector3()) {
    return this.head.getWorldPosition(out);
  }

  mouthWorld(out = new THREE.Vector3()) {
    out.set(0, this.look.mouthY, this.headSurf(0, this.look.mouthY) + 0.01);
    return this.head.localToWorld(out);
  }

  forwardWorld(out = new THREE.Vector3()) {
    return out.set(0, 0, 1).transformDirection(this.head.matrixWorld);
  }

  setSweat(v: boolean) {
    this.sweat.visible = v;
  }

  /** Aim head toward a world point (sets targets; limited by neck range). */
  lookAt(world: THREE.Vector3) {
    const local = this.torso.worldToLocal(_c.copy(world));
    local.sub(this.headPivot.position);
    local.y -= this.b * 0.9;
    const yaw = Math.atan2(local.x, local.z);
    const pitch = -Math.atan2(local.y, Math.sqrt(local.x * local.x + local.z * local.z));
    this.headYawT = clamp(yaw, -1.5, 1.5);
    this.headPitchT = clamp(pitch, -0.7, 0.75);
    // eyes follow too
    const hl = this.head.worldToLocal(_c.copy(world));
    this.gazeT.copy(hl).normalize();
    // twist the torso if the head would need to turn a lot
    this.twistT = clamp(yaw * 0.35, -0.5, 0.5);
  }

  update(dt: number, t: number) {
    const f = this.face, ft = this.faceTarget;
    const k = damp(11, dt);
    for (const key of Object.keys(f) as (keyof FaceParams)[]) f[key] += (ft[key] - f[key]) * k;

    // posture
    this.lean += (this.leanT - this.lean) * damp(8, dt);
    this.sideLean += (this.sideLeanT - this.sideLean) * damp(6, dt);
    this.twist += (this.twistT - this.twist) * damp(5, dt);
    this.stand += (this.standT - this.stand) * damp(5, dt);
    const ht = damp(this.headTurnSpeed, dt);
    this.headYaw += (this.headYawT - this.headYaw) * ht;
    this.headPitch += (this.headPitchT - this.headPitch) * ht;
    this.headRoll += (this.headRollT - this.headRoll) * ht;

    const breathe = Math.sin(t * 1.7 + this.root.id) * 0.006;
    const runBounce = this.running * Math.abs(Math.sin(this.runPhase)) * 0.06;
    this.hips.position.y = lerp(this.hipsBaseY, 0.86, this.stand) + this.bob + runBounce - this.fallen * 0.6;
    this.torso.rotation.set(this.lean + this.running * 0.25 - this.fallen * 1.2, this.twist, this.sideLean);
    this.torsoMesh.scale.y = this.look.torsoH * 0.55 * (1 + breathe);
    this.headPivot.rotation.set(this.headPitch, this.headYaw * 0.8, this.headRoll);
    this.head.rotation.set(0, this.headYaw * 0.2, 0);

    // face
    this.mouth.smile = f.smile;
    this.mouth.open = Math.max(0, f.open - f.puff * 0.8);
    this.mouth.wobble = f.wobble;
    this.mouth.pucker = Math.max(f.pucker, f.puff * 0.6);
    this.mouth.update(t);
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? -1 : 1;
      const e = this.eyes[i];
      const lidOpen = clamp(f.lid + f.bulge * 0.3, 0, 1.2);
      // lid edge sits at elevation -θ: neutral shows a heavy-ish Aardman lid, bulging eyes go wide
      e.upper.rotation.x = lerp(1.42, -1.35, lidOpen);
      e.lower.rotation.x = lerp(1.0, -0.25, f.lowerLid);
      const eb = 1 + f.bulge * 0.35;
      e.ball.scale.setScalar(eb);
      e.pupilPivot.scale.setScalar(eb * (1 - f.bulge * 0.25));
      // gaze
      this.gaze.lerp(this.gazeT, damp(14, dt)).normalize();
      let gy = Math.atan2(this.gaze.x, this.gaze.z);
      let gp = -Math.atan2(this.gaze.y, Math.sqrt(this.gaze.x * this.gaze.x + this.gaze.z * this.gaze.z));
      gy = clamp(gy, -0.6, 0.6);
      gp = clamp(gp, -0.5, 0.5);
      // cross-eyed: both pupils toward the nose
      gy = lerp(gy, -s * 0.5, f.cross);
      gp = lerp(gp, 0.22, f.cross);
      e.pupilPivot.rotation.set(gp, gy, 0);
      // brows
      const br = this.brows[i];
      const by = this.look.eyeY + this.look.eyeR * (1.3 + f.browY * 0.6 + f.bulge * 0.3);
      const bx = s * this.look.eyeGap;
      br.position.set(bx, by, this.headSurf(bx, by) + this.look.browThick * 0.4);
      br.rotation.set(0, 0, Math.PI / 2 + s * f.browAng * 0.55);
      br.rotation.y = -s * 0.25;
      // cheeks
      const ck = this.cheeks[i];
      const base = ck.userData.base as THREE.Vector3;
      const puff = 1 + f.puff * 0.9;
      ck.scale.set(this.look.mouthW * 0.32 * puff, this.look.mouthW * 0.28 * puff, this.look.mouthW * 0.24 * (1 + f.puff * 1.6));
      ck.position.set(base.x * (1 + f.puff * 0.15), base.y, base.z + f.puff * 0.012);
    }
    this.blushMat.opacity = clamp(this.look.rosy * 0.35 + f.blush * 0.7, 0, 0.85);
    // skin turns green
    const g = clamp(f.green, 0, 1);
    this.skinMat.color.copy(this.baseSkin).lerp(GREEN, g * 0.85);
    if (f.blush > 0.3) this.skinMat.color.lerp(new THREE.Color('#e88a7a'), (f.blush - 0.3) * 0.25);
    if (this.sweat.visible) {
      this.sweat.position.y = this.look.eyeY + this.b * 0.3 - ((t * 0.15) % 0.06);
    }

    this.root.updateMatrixWorld(true);
    this.updateArms(dt);
    this.updateLegs(dt, t);
  }

  private updateArms(dt: number) {
    for (const arm of this.arms) {
      arm.cur.lerp(arm.target, damp(arm.speed, dt));
      const tl = this.torso.worldToLocal(_c.copy(arm.cur));
      const elbow = arm.elbow;
      const end = V3();
      solveTwoBone(arm.shoulder, tl, arm.l1, arm.l2, arm.pole, elbow, end);
      placeBetween(arm.upper, arm.shoulder, elbow);
      placeBetween(arm.lower, elbow, end);
      arm.hand.position.copy(end);
      // orient hand: +z along forearm, +y as close to handUp as possible
      const fz = V3().subVectors(end, elbow).normalize();
      const upL = arm.handUp.clone();
      const fx = V3().crossVectors(upL, fz);
      if (fx.lengthSq() < 1e-4) fx.set(1, 0, 0);
      fx.normalize();
      const fy = V3().crossVectors(fz, fx);
      _m.makeBasis(fx, fy, fz);
      arm.hand.quaternion.setFromRotationMatrix(_m);
    }
  }

  private updateLegs(dt: number, t: number) {
    const st = this.stand;
    for (const leg of this.legs) {
      const s = leg.side;
      // seated: knees forward, feet on the lawn
      const seated = V3(s * 0.11, -0.44, 0.42);
      const ph = this.runPhase + (s > 0 ? Math.PI : 0);
      const standing = V3(s * 0.1, -0.8 + this.running * Math.max(0, Math.cos(ph)) * 0.16, this.running * Math.sin(ph) * 0.26);
      leg.foot.copy(seated).lerp(standing, st);
      if (this.fallen > 0) leg.foot.lerp(V3(s * 0.15, -0.1, 0.6), this.fallen);
      const knee = V3();
      const foot = V3();
      solveTwoBone(leg.hip, leg.foot, 0.4, 0.42, V3(0, 0.3, 1), knee, foot);
      placeBetween(leg.thigh, leg.hip, knee);
      placeBetween(leg.shin, knee, foot);
      leg.shoe.position.copy(foot).add(V3(0, -0.01, 0.05));
    }
  }
}
