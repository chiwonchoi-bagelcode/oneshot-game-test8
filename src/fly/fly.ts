import * as THREE from 'three';
import { ctx, TABLE } from '../game/ctx';
import type { Surface } from '../game/types';
import { clay } from '../render/materials';
import { mergeStatic, noMerge } from '../render/merge';
import { blob, capsule, sphereGeo } from '../render/shapes';
import { makeBlobTexture, makeGlintTexture, makeRingTexture, makeWingTexture } from '../render/textures';
import {
  clamp, clamp01, cubicBezier, cubicBezierTangent, easeOutElastic, rand, randRange, randSign, V3, UP, noise1, smoothstep,
} from '../core/math';

export type FlyState = 'landed' | 'flying' | 'hover' | 'stunned' | 'scripted' | 'dead';

export interface TapTarget {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  surface: Surface | null;
}

const SCALE = 1.25;
let waveTexture: THREE.Texture | null = null;

export class Fly {
  readonly root = new THREE.Group();
  readonly body = new THREE.Group();
  state: FlyState = 'scripted';
  readonly pos = new THREE.Vector3(0, 1.4, 3);
  readonly vel = new THREE.Vector3();
  speed = 0;
  landedOn: Surface | null = null;
  /** Seconds since the fly last landed (0 while airborne). */
  landedTime = 0;
  airTime = 0;
  invuln = 0;
  /** Victory jig on top of the cake. */
  celebrate = false;
  /** Recently-taken-off-from surface (for "escaped at the last moment" tricks). */
  lastTakeoff: { surface: Surface | null; time: number; from: THREE.Vector3 } = { surface: null, time: -9, from: V3() };

  // flight path
  private p0 = V3();
  private p1 = V3();
  private p2 = V3();
  private p3 = V3();
  private flightT = 0;
  private flightDur = 0.3;
  private target: TapTarget | null = null;
  private hoverPoint = V3();
  private tLocal = V3();
  private tNormalLocal = V3();
  private hoverT = 0;
  private prevVel = V3();
  private roll = 0;
  private stretch = 0;
  private perp = V3();
  private wobSeed = 0;

  // attachment
  private anchor: THREE.Object3D | null = null;
  private localPos = V3();
  private localQuat = new THREE.Quaternion();
  private landSquash = 1;
  private rubT = 0;
  private groomT = 0;
  private groomKind = 0;
  private stunT = 0;

  // visuals
  private wings: THREE.Object3D[] = [];
  private wingBlur: THREE.Mesh[] = [];
  private legs: { hip: THREE.Vector3; upper: THREE.Mesh; lower: THREE.Mesh; side: number; idx: number }[] = [];
  private glint: THREE.Sprite;
  private shadow: THREE.Mesh;
  private marker: THREE.Mesh;
  private markerT = 1;
  private stars: THREE.Sprite[] = [];
  private waves: { s: THREE.Sprite; t: number }[] = [];
  private waveT = 0;
  private bodyMat: THREE.MeshPhysicalMaterial;
  private trail: THREE.Mesh;
  private trailPts: THREE.Vector3[] = [];
  readonly worldQuat = new THREE.Quaternion();

  constructor() {
    this.bodyMat = new THREE.MeshPhysicalMaterial({
      color: '#1f55d8',
      metalness: 0.7,
      roughness: 0.2,
      iridescence: 1,
      iridescenceIOR: 1.75,
      iridescenceThicknessRange: [180, 620],
      clearcoat: 1,
      clearcoatRoughness: 0.12,
      envMapIntensity: 1.6,
      emissive: new THREE.Color('#0a1a55'),
      emissiveIntensity: 0.35,
    });
    const dark = clay('#14161f', { rough: 0.35, normal: 0.6 });
    const eyeMat = new THREE.MeshPhysicalMaterial({ color: '#8a1410', roughness: 0.18, clearcoat: 1, envMapIntensity: 1.2, emissive: new THREE.Color('#2a0303') });

    const b = this.body;
    const thorax = blob(0.026, 0.024, 0.03, this.bodyMat, 18);
    thorax.position.set(0, 0.002, 0.006);
    const abdomen = blob(0.03, 0.026, 0.04, this.bodyMat, 18);
    abdomen.position.set(0, -0.002, -0.042);
    const head = blob(0.023, 0.021, 0.017, dark, 14);
    head.position.set(0, 0.004, 0.04);
    b.add(thorax, abdomen, head);
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(sphereGeo(0.0165, 16, 12), eyeMat);
      eye.position.set(s * 0.0155, 0.009, 0.045);
      eye.castShadow = true;
      b.add(eye);
      const hl = new THREE.Mesh(sphereGeo(0.004, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
      hl.position.set(s * 0.019, 0.02, 0.054);
      b.add(hl);
    }
    const prob = capsule(0.004, 0.012, dark, 6, false);
    prob.position.set(0, -0.016, 0.05);
    prob.rotation.x = 0.5;
    b.add(prob);
    // bristles
    for (let i = 0; i < 8; i++) {
      const br = capsule(0.0014, 0.012, dark, 4, false);
      const a = (i / 8) * Math.PI * 2;
      br.position.set(Math.cos(a) * 0.018, 0.022, 0.004 + Math.sin(a) * 0.018);
      br.rotation.set(Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6);
      b.add(br);
    }
    // wings
    const wingTex = makeWingTexture();
    const wingMat = new THREE.MeshPhysicalMaterial({ map: wingTex, transparent: true, side: THREE.DoubleSide, depthWrite: false, roughness: 0.1, iridescence: 0.8, iridescenceIOR: 1.3, envMapIntensity: 1.2 });
    const wingGeo = new THREE.PlaneGeometry(0.075, 0.034);
    wingGeo.translate(0.0375, 0, 0);
    wingGeo.rotateX(-Math.PI / 2);
    for (const s of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(s * 0.01, 0.022, 0.006);
      const w = new THREE.Mesh(wingGeo, wingMat);
      if (s < 0) w.scale.x = -1;
      pivot.add(w);
      b.add(noMerge(pivot));
      this.wings.push(pivot);
      const blur = new THREE.Mesh(new THREE.CircleGeometry(0.07, 20, -0.9, 1.8), new THREE.MeshBasicMaterial({ color: '#e8f2ff', transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }));
      blur.rotation.x = -Math.PI / 2;
      blur.position.set(s * 0.01, 0.024, 0.0);
      if (s < 0) blur.rotation.z = Math.PI;
      blur.visible = false;
      b.add(noMerge(blur));
      this.wingBlur.push(blur);
    }
    // legs
    const legGeo = new THREE.CylinderGeometry(0.0026, 0.002, 1, 5);
    const legMat = clay('#16161c', { rough: 0.4, flat: true });
    const hips: [number, number][] = [[0.006, 0.018], [0.009, 0.004], [0.008, -0.01]];
    for (let i = 0; i < 3; i++) {
      for (const s of [-1, 1]) {
        const up = new THREE.Mesh(legGeo, legMat);
        const lo = new THREE.Mesh(legGeo, legMat);
        up.castShadow = lo.castShadow = false;
        b.add(noMerge(up), noMerge(lo));
        this.legs.push({ hip: V3(s * hips[i][0], -0.012, hips[i][1]), upper: up, lower: lo, side: s, idx: i });
      }
    }
    mergeStatic(b);
    b.scale.setScalar(SCALE);
    this.root.add(b);
    ctx.scene.add(this.root);

    this.glint = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeGlintTexture(), color: '#bfe0ff', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.glint.scale.setScalar(0.07);
    ctx.scene.add(this.glint);

    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: makeBlobTexture('rgba(20,30,10,0.6)'), transparent: true, depthWrite: false }));
    this.shadow.renderOrder = 3;
    ctx.scene.add(this.shadow);

    this.marker = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), new THREE.MeshBasicMaterial({ map: makeRingTexture(), color: '#8fd3ff', transparent: true, depthWrite: false, opacity: 0 }));
    this.marker.renderOrder = 4;
    ctx.scene.add(this.marker);

    const starTex = makeGlintTexture();
    for (let i = 0; i < 4; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: starTex, color: '#ffe066', transparent: true, depthWrite: false }));
      s.scale.setScalar(0.05);
      s.visible = false;
      ctx.scene.add(s);
      this.stars.push(s);
    }

    // buzz "sound waves": make the noise visible
    const waveTex = waveTexture ?? (waveTexture = (() => {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 64;
      const g = cv.getContext('2d')!;
      g.lineCap = 'round';
      for (const [style, wdt] of [['rgba(50,30,10,0.6)', 13], ['rgba(255,236,140,1)', 7]] as const) {
        g.strokeStyle = style;
        g.lineWidth = wdt;
        for (const a0 of [-0.6, Math.PI - 0.6]) {
          g.beginPath();
          g.arc(32, 32, 22, a0, a0 + 1.2);
          g.stroke();
        }
      }
      const t = new THREE.CanvasTexture(cv);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })());
    for (let i = 0; i < 6; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: waveTex, transparent: true, depthWrite: false, opacity: 0 }));
      sp.visible = false;
      ctx.scene.add(sp);
      this.waves.push({ s: sp, t: 1 });
    }

    // speed trail ribbon
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(16 * 2 * 3), 3));
    const idx: number[] = [];
    for (let i = 0; i < 15; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    tg.setIndex(idx);
    const alphas = new Float32Array(32);
    for (let i = 0; i < 16; i++) alphas[i * 2] = alphas[i * 2 + 1] = 1 - i / 15;
    tg.setAttribute('alpha', new THREE.BufferAttribute(alphas, 1));
    this.trail = new THREE.Mesh(
      tg,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        uniforms: { uOpacity: { value: 0 } },
        vertexShader: 'attribute float alpha; varying float vA; void main(){ vA=alpha; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
        fragmentShader: 'uniform float uOpacity; varying float vA; void main(){ gl_FragColor=vec4(0.75,0.88,1.0, vA*vA*uOpacity*0.55);}',
      }),
    );
    this.trail.frustumCulled = false;
    ctx.scene.add(this.trail);
    for (let i = 0; i < 16; i++) this.trailPts.push(this.pos.clone());
  }

  get buzzing() {
    return this.state === 'flying' || this.state === 'hover';
  }

  get canControl() {
    return this.state === 'landed' || this.state === 'flying' || this.state === 'hover';
  }

  /** Normalized loudness of the buzz (0 silent .. ~1.3 zipping). */
  get loudness() {
    if (!this.buzzing) return 0;
    return this.state === 'hover' ? 0.65 : 0.7 + clamp01(this.speed / 5) * 0.6;
  }

  // ---------------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------------
  flyTo(t: TapTarget | null, hoverAt?: THREE.Vector3) {
    if (!this.canControl && this.state !== 'scripted') return;
    const wasLanded = this.state === 'landed';
    if (wasLanded) this.takeoffFrom();
    this.target = t;
    if (!t && hoverAt) this.hoverPoint.copy(hoverAt);
    const end = t ? t.point.clone().addScaledVector(t.normal, 0.012 * SCALE) : this.hoverPoint.clone();
    // remember the landing spot in the anchor's own space: heads turn, glasses get lifted, butlers walk
    if (t?.surface) {
      const a = t.surface.anchor;
      a.updateWorldMatrix(true, false);
      this.tLocal.copy(t.point);
      a.worldToLocal(this.tLocal);
      const iq = new THREE.Quaternion();
      a.getWorldQuaternion(iq);
      this.tNormalLocal.copy(t.normal).applyQuaternion(iq.invert());
    }
    this.p0.copy(this.pos);
    this.p3.copy(end);
    const dvec = V3().subVectors(this.p3, this.p0);
    const dist = Math.max(0.05, dvec.length());
    const dir = dvec.clone().divideScalar(dist);
    this.perp.crossVectors(dir, UP);
    if (this.perp.lengthSq() < 1e-4) this.perp.set(1, 0, 0);
    this.perp.normalize();
    const twist = randSign() * randRange(0.2, 0.42) * Math.min(dist, 2.2);
    const arch = randRange(0.05, 0.22) * Math.min(dist, 2);
    let startTan: THREE.Vector3;
    if (wasLanded) {
      const n = this.lastTakeoff.from.clone();
      n.copy(this.getUp());
      startTan = n.multiplyScalar(0.1 + dist * 0.12).addScaledVector(dir, dist * 0.12);
    } else if (this.vel.lengthSq() > 0.01) {
      // keep momentum: banking redirect instead of a dead stop
      startTan = this.vel.clone().multiplyScalar(0.11 + dist * 0.03);
      startTan.clampLength(0, dist * 0.6 + 0.1);
    } else startTan = dir.clone().multiplyScalar(dist * 0.3);
    this.p1.copy(this.p0).add(startTan).addScaledVector(this.perp, twist).addScaledVector(UP, arch);
    const endN = t ? t.normal : UP;
    const s = rand() < 0.55 ? -0.45 : 0.6; // S-curve or C-curve
    this.p2.copy(this.p3).addScaledVector(endN, 0.06 + dist * 0.12).addScaledVector(this.perp, twist * s).addScaledVector(dir, -dist * 0.1);
    this.flightDur = 0.11 + dist / 5.4;
    this.flightT = 0;
    this.wobSeed = rand() * 100;
    this.state = 'flying';
    this.landedOn = null;
    this.anchor = null;
    this.landedTime = 0;
    ctx.audio.buzzKick(wasLanded ? 1 : 0.6);
    // tap marker
    this.marker.position.copy(end);
    if (t) {
      this.marker.position.addScaledVector(t.normal, 0.004);
      this.marker.quaternion.setFromUnitVectors(V3(0, 0, 1), t.normal);
    } else this.marker.quaternion.setFromUnitVectors(V3(0, 0, 1), UP);
    this.markerT = 0;
  }

  private takeoffFrom() {
    this.lastTakeoff = { surface: this.landedOn, time: ctx.time, from: this.pos.clone() };
    ctx.game?.onFlyTakeoff(this.landedOn);
  }

  /** Something knocked the fly off its perch (sneeze, hand flick, falling item). */
  knockOff(dir: THREE.Vector3, power = 0.6) {
    if (this.state === 'stunned' || this.state === 'dead' || this.state === 'scripted') return;
    const d = dir.clone().setY(0);
    if (d.lengthSq() < 1e-4) d.set(randRange(-1, 1), 0, randRange(-1, 1));
    d.normalize();
    const p = this.pos.clone().addScaledVector(d, power).setY(Math.max(this.pos.y + 0.25, TABLE.y + 0.35));
    p.x = clamp(p.x, -2.8, 2.8);
    p.z = clamp(p.z, -3.6, 3.2);
    if (this.state === 'landed') this.takeoffFrom();
    this.state = 'hover';
    this.flyTo(null, p);
  }

  /** Swatted! Returns false if invulnerable. */
  squash(): boolean {
    if (this.invuln > 0 || this.state === 'stunned' || this.state === 'dead' || this.state === 'scripted') return false;
    const wasLanded = this.state === 'landed';
    this.state = 'stunned';
    this.stunT = 1.25;
    this.vel.set(0, 0, 0);
    this.speed = 0;
    // swatted out of the air: drop flat onto whatever is below
    if (!wasLanded) {
      this.anchor = null;
      this.landedOn = null;
      const onTable = Math.abs(this.pos.x) < TABLE.halfW && Math.abs(this.pos.z) < TABLE.halfL;
      this.pos.y = onTable && this.pos.y > TABLE.y ? TABLE.y + 0.012 : 0.012;
    }
    return true;
  }

  /** Attach to a surface immediately (used by scripts and carried morsels). */
  attachTo(anchor: THREE.Object3D, worldPos: THREE.Vector3, normal: THREE.Vector3, surface: Surface | null) {
    this.anchor = anchor;
    anchor.updateWorldMatrix(true, false);
    this.pos.copy(worldPos);
    this.localPos.copy(worldPos);
    anchor.worldToLocal(this.localPos);
    const fwd = this.vel.lengthSq() > 1e-4 ? this.vel.clone() : V3(0, 0, -1);
    fwd.addScaledVector(normal, -fwd.dot(normal));
    if (fwd.lengthSq() < 1e-5) fwd.set(1, 0, 0).addScaledVector(normal, -normal.x);
    fwd.normalize();
    const m = new THREE.Matrix4();
    const x = V3().crossVectors(normal, fwd).normalize();
    m.makeBasis(x, normal.clone().normalize(), fwd);
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    const aq = new THREE.Quaternion();
    anchor.getWorldQuaternion(aq);
    this.localQuat.copy(aq.invert()).multiply(q);
    this.landedOn = surface;
    this.state = 'landed';
    this.landedTime = 0;
  }

  /** Move the attachment to another anchor (e.g. a morsel lifted on a fork). */
  reanchor(anchor: THREE.Object3D, surface: Surface | null) {
    if (this.state !== 'landed') return;
    const q = this.worldQuat.clone();
    this.anchor = anchor;
    anchor.updateWorldMatrix(true, false);
    this.localPos.copy(this.pos);
    anchor.worldToLocal(this.localPos);
    const aq = new THREE.Quaternion();
    anchor.getWorldQuaternion(aq);
    this.localQuat.copy(aq.invert()).multiply(q);
    this.landedOn = surface;
  }

  getUp(out = new THREE.Vector3()) {
    return out.set(0, 1, 0).applyQuaternion(this.worldQuat);
  }

  // ---------------------------------------------------------------------------
  update(dt: number) {
    const t = ctx.time;
    if (this.invuln > 0) this.invuln -= dt;
    this.prevVel.copy(this.vel);

    switch (this.state) {
      case 'flying':
        this.updateFlight(dt);
        break;
      case 'hover': {
        this.hoverT += dt;
        const h = this.hoverT;
        const tgt = V3(
          this.hoverPoint.x + Math.sin(h * 2.3) * 0.06 + noise1(h * 3 + 7) * 0.02,
          this.hoverPoint.y + Math.sin(h * 3.7) * 0.035,
          this.hoverPoint.z + Math.cos(h * 1.9) * 0.06 + noise1(h * 3) * 0.02,
        );
        const prev = this.pos.clone();
        this.pos.lerp(tgt, 1 - Math.exp(-8 * dt));
        this.vel.subVectors(this.pos, prev).divideScalar(Math.max(dt, 1e-4));
        this.speed = this.vel.length();
        this.orientToVelocity(dt, 0.6);
        this.airTime += dt;
        break;
      }
      case 'landed': {
        this.landedTime += dt;
        if (this.anchor) {
          this.anchor.updateWorldMatrix(true, false);
          this.pos.copy(this.localPos);
          this.anchor.localToWorld(this.pos);
          const aq = new THREE.Quaternion();
          this.anchor.getWorldQuaternion(aq);
          this.worldQuat.copy(aq).multiply(this.localQuat);
        }
        const prev = this.root.position;
        this.vel.subVectors(this.pos, prev).divideScalar(Math.max(dt, 1e-4));
        this.speed = 0;
        if (this.landedOn?.item) this.landedOn.item.flyTick(dt);
        if (this.landedOn && !this.landedOn.enabled) this.knockOff(V3(randRange(-1, 1), 0, randRange(-1, 1)), 0.3);
        // carried out of the arena on someone's head? hop off.
        if (Math.abs(this.pos.x) > 3.4 || this.pos.z < -4.6 || this.pos.z > 3.8) this.knockOff(V3(-this.pos.x, 0, -this.pos.z - 1), 1.2);
        this.airTime = 0;
        break;
      }
      case 'stunned': {
        this.stunT -= dt;
        if (this.anchor) {
          this.pos.copy(this.localPos);
          this.anchor.localToWorld(this.pos);
        }
        if (this.stunT <= 0) {
          this.invuln = 1.6;
          // pop back up into a hover just above where we got flattened
          this.state = 'hover';
          this.anchor = null;
          this.landedOn = null;
          this.hoverPoint.copy(this.pos).setY(Math.max(this.pos.y + 0.35, TABLE.y + 0.4));
          this.hoverT = 0;
          ctx.audio.sfx('boing', this.pos);
          ctx.audio.buzzKick(0.8);
        }
        break;
      }
      case 'scripted':
      case 'dead':
        break;
    }

    // ------------------------------------------------------------ visuals
    this.root.position.copy(this.pos);
    this.root.quaternion.copy(this.worldQuat);
    this.animateBody(dt, t);
    this.updateShadowAndGlint(dt, t);
    this.updateTrail(dt);
    this.updateWaves(dt);
    this.markerT = Math.min(1, this.markerT + dt * 2.2);
    const mm = this.marker.material as THREE.MeshBasicMaterial;
    mm.opacity = (1 - this.markerT) * 0.9;
    this.marker.scale.setScalar(1.1 - this.markerT * 0.6);
    this.marker.visible = mm.opacity > 0.01;
  }

  private updateFlight(dt: number) {
    this.flightT += dt;
    // home in on a moving landing spot
    const tg = this.target;
    if (tg?.surface) {
      const a = tg.surface.anchor;
      a.updateWorldMatrix(true, false);
      const np = a.localToWorld(this.tLocal.clone());
      const aq = new THREE.Quaternion();
      a.getWorldQuaternion(aq);
      const nn = this.tNormalLocal.clone().applyQuaternion(aq);
      tg.point.copy(np);
      tg.normal.copy(nn);
      const end = np.clone().addScaledVector(nn, 0.012 * SCALE);
      const delta = end.clone().sub(this.p3);
      if (delta.lengthSq() > 1e-10) {
        this.p3.add(delta);
        this.p2.add(delta);
      }
    }
    const s = clamp01(this.flightT / this.flightDur);
    // fast launch, soft-ish arrival: derivative 1.65 at s=0, 0.35 at s=1
    const u = s * (1.65 - 0.65 * s);
    const prev = this.pos.clone();
    cubicBezier(this.pos, this.p0, this.p1, this.p2, this.p3, u);
    // Minuscule-style wobble: small jinks that vanish at both ends
    const env = Math.sin(s * Math.PI);
    const w = this.wobSeed + this.flightT;
    this.pos.addScaledVector(this.perp, env * (noise1(w * 9) * 0.03 + Math.sin(w * 31) * 0.006));
    this.pos.y += env * (noise1(w * 7 + 3) * 0.022 + Math.cos(w * 27) * 0.005);
    this.vel.subVectors(this.pos, prev).divideScalar(Math.max(dt, 1e-4));
    this.speed = this.vel.length();
    this.orientToVelocity(dt, 1);
    this.airTime += dt;
    if (s >= 1) this.arrive();
  }

  private arrive() {
    const t = this.target;
    if (!t || !t.surface || !t.surface.enabled) {
      this.state = 'hover';
      this.hoverT = 0;
      if (t) this.hoverPoint.copy(this.pos);
      return;
    }
    this.pos.copy(t.point).addScaledVector(t.normal, 0.012 * SCALE);
    this.attachTo(t.surface.anchor, this.pos, t.normal, t.surface);
    this.root.quaternion.copy(this.worldQuat);
    // compute world quat right away
    const aq = new THREE.Quaternion();
    t.surface.anchor.getWorldQuaternion(aq);
    this.worldQuat.copy(aq).multiply(this.localQuat);
    this.landSquash = 0;
    this.rubT = randRange(1.1, 1.6);
    this.groomT = randRange(3, 5);
    this.vel.set(0, 0, 0);
    this.speed = 0;
    ctx.audio.buzzLand();
    ctx.game?.onFlyLanded(t.surface);
  }

  private orientToVelocity(dt: number, bankK: number) {
    const v = this.vel;
    if (v.lengthSq() < 1e-4) return;
    const fwd = v.clone().normalize();
    // lateral acceleration for banking
    const acc = V3().subVectors(this.vel, this.prevVel).divideScalar(Math.max(dt, 1e-4));
    const right = V3().crossVectors(fwd, UP);
    if (right.lengthSq() < 1e-4) right.set(1, 0, 0);
    right.normalize();
    const lat = acc.dot(right);
    const targetRoll = clamp(-lat * 0.022 * bankK, -1.2, 1.2);
    this.roll += (targetRoll - this.roll) * (1 - Math.exp(-12 * dt));
    const pitchFwd = fwd.clone();
    pitchFwd.y *= 0.6;
    pitchFwd.normalize();
    const m = new THREE.Matrix4().lookAt(V3(), pitchFwd.clone().negate(), UP);
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    const rq = new THREE.Quaternion().setFromAxisAngle(V3(0, 0, 1), this.roll);
    q.multiply(rq);
    // body pitched slightly nose-down when zipping
    q.multiply(new THREE.Quaternion().setFromAxisAngle(V3(1, 0, 0), 0.15 + clamp01(this.speed / 6) * 0.2));
    this.worldQuat.slerp(q, 1 - Math.exp(-20 * dt));
    this.stretch += (clamp01(this.speed / 6) - this.stretch) * (1 - Math.exp(-14 * dt));
  }

  private animateBody(dt: number, t: number) {
    const b = this.body;
    const flying = this.buzzing;
    // squash & stretch
    if (this.state === 'stunned') {
      const k = clamp01(this.stunT / 1.25);
      b.scale.set(SCALE * (1 + 0.6 * k), SCALE * (1 - 0.72 * k), SCALE * (1 + 0.6 * k));
    } else if (this.state === 'landed') {
      this.landSquash = Math.min(1, this.landSquash + dt * 2.2);
      const e = easeOutElastic(this.landSquash);
      b.scale.set(SCALE * (1 + (1 - e) * 0.35), SCALE * (0.65 + 0.35 * e), SCALE * (1 + (1 - e) * 0.2));
    } else {
      const st = this.stretch;
      b.scale.set(SCALE * (1 - st * 0.12), SCALE * (1 - st * 0.12), SCALE * (1 + st * 0.3));
    }
    if (this.invuln > 0) b.visible = Math.floor(this.invuln * 14) % 2 === 0;
    else b.visible = true;

    // wings
    const flap = Math.sin(t * Math.PI * 2 * 26);
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? -1 : 1;
      const w = this.wings[i];
      if (flying) {
        w.rotation.set(0, s * 0.2, s * flap * 1.05);
        this.wingBlur[i].visible = true;
      } else {
        // folded back over the abdomen
        w.rotation.set(0.05, s * (Math.PI / 2 + 0.38) * -1 + (s < 0 ? 0 : 0), s * 0.12);
        w.rotation.y = s < 0 ? Math.PI / 2 + 0.38 + Math.PI : -(Math.PI / 2 + 0.38);
        if (s < 0) w.rotation.y = -(Math.PI / 2 - 0.38) - Math.PI;
        this.wingBlur[i].visible = false;
      }
    }
    // Simple, explicit folded pose (cleaner than above juggling)
    if (!flying) {
      this.wings[0].rotation.set(0.04, Math.PI / 2 + 0.42, -0.08); // left (scale.x = -1 inside)
      this.wings[1].rotation.set(0.04, -(Math.PI / 2 + 0.42), 0.08);
      // wing-cleaning: hind legs sweep wings occasionally
      if (this.groomKind === 2 && this.groomActive()) {
        const k = Math.sin(t * 16) * 0.12;
        this.wings[0].rotation.z -= 0.15 + k;
        this.wings[1].rotation.z += 0.15 + k;
      }
    }

    // legs
    if (this.state === 'landed') {
      if (this.rubT > 0) this.rubT -= dt;
      else {
        this.groomT -= dt;
        if (this.groomT < -1.4) {
          this.groomT = randRange(2.5, 5.5);
          this.groomKind = Math.floor(rand() * 3);
        }
      }
    }
    if (this.celebrate) {
      this.rubT = 1;
      const hop = Math.max(0, Math.sin(t * 7)) * 0.025;
      b.position.y = hop;
      b.rotation.y = Math.sin(t * 3.5) * 0.5;
    }
    const rubbing = this.state === 'landed' && (this.rubT > 0 || (this.groomActive() && this.groomKind === 0));
    const headWash = this.state === 'landed' && this.groomActive() && this.groomKind === 1;
    const wingWash = this.state === 'landed' && this.groomActive() && this.groomKind === 2;
    for (const L of this.legs) {
      const foot = V3();
      const s = L.side;
      if (this.state === 'landed' || this.state === 'stunned') {
        const spread = [0.034, 0.04, 0.034][L.idx];
        const fz = [0.042, 0.002, -0.04][L.idx];
        foot.set(s * spread, -0.03, fz);
        if (L.idx === 0 && rubbing) {
          const ph = t * 19 + (s > 0 ? Math.PI : 0);
          foot.set(s * (0.006 + Math.sin(ph) * 0.004), -0.008 + Math.cos(ph) * 0.006, 0.058);
        }
        if (L.idx === 0 && headWash) {
          const ph = t * 12;
          foot.set(s * (0.012 + Math.sin(ph) * 0.004), 0.012 + Math.cos(ph) * 0.008, 0.05);
        }
        if (L.idx === 2 && wingWash) {
          const ph = t * 14 + (s > 0 ? Math.PI : 0);
          foot.set(s * 0.024, 0.006 + Math.sin(ph) * 0.01, -0.07);
        }
      } else {
        // tucked, dangling back in flight
        foot.set(s * 0.016, -0.03, L.hip.z - 0.02 - L.idx * 0.006);
      }
      const knee = L.hip.clone().lerp(foot, 0.5);
      knee.y += 0.012;
      knee.x += s * 0.012;
      setLeg(L.upper, L.hip, knee);
      setLeg(L.lower, knee, foot);
    }
  }

  private groomActive() {
    return this.groomT < 0;
  }

  private updateShadowAndGlint(dt: number, t: number) {
    // blob shadow on the surface below
    const onTable = Math.abs(this.pos.x) < TABLE.halfW && Math.abs(this.pos.z) < TABLE.halfL;
    const floorY = onTable && this.pos.y > TABLE.y - 0.02 ? TABLE.y : 0;
    const h = Math.max(0, this.pos.y - floorY);
    this.shadow.position.set(this.pos.x, floorY + 0.003, this.pos.z);
    const sc = 1 + h * 0.8;
    this.shadow.scale.set(sc, 1, sc);
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = clamp01(1 - h * 0.7) * (this.state === 'landed' ? 0.0 : 1);
    this.shadow.visible = this.state !== 'landed' && this.state !== 'dead';
    // sparkle: blue sheen catching the sun
    const up = this.getUp(V3());
    const sunDir = V3(-0.35, 0.9, 0.4).normalize();
    const facing = clamp01(up.dot(sunDir));
    const tw = 0.55 + 0.45 * Math.sin(t * 9.3) * Math.sin(t * 4.1 + 1);
    const m = this.glint.material as THREE.SpriteMaterial;
    m.opacity = (this.state === 'dead' ? 0 : 1) * (0.25 + facing * 0.75) * tw * (this.body.visible ? 1 : 0);
    this.glint.position.copy(this.pos).addScaledVector(up, 0.03);
    this.glint.scale.setScalar(0.05 + tw * 0.05 + (this.buzzing ? 0.02 : 0));
    m.rotation = t * 0.8;

    // stars when stunned
    for (let i = 0; i < this.stars.length; i++) {
      const s = this.stars[i];
      s.visible = this.state === 'stunned';
      if (!s.visible) continue;
      const a = t * 6 + (i / this.stars.length) * Math.PI * 2;
      s.position.set(this.pos.x + Math.cos(a) * 0.07, this.pos.y + 0.07, this.pos.z + Math.sin(a) * 0.07);
    }
  }

  private updateWaves(dt: number) {
    const loud = this.loudness;
    this.waveT -= dt;
    if (loud > 0 && this.waveT <= 0) {
      this.waveT = 0.2 - Math.min(0.1, loud * 0.06);
      const w = this.waves.find((x) => x.t >= 1);
      if (w) {
        w.t = 0;
        w.s.position.copy(this.pos);
        (w.s.material as THREE.SpriteMaterial).rotation = Math.random() * Math.PI;
        w.s.userData.k = loud;
      }
    }
    for (const w of this.waves) {
      if (w.t >= 1) {
        w.s.visible = false;
        continue;
      }
      w.t = Math.min(1, w.t + dt * 2.6);
      w.s.visible = true;
      const k = w.s.userData.k as number;
      w.s.scale.setScalar(0.08 + w.t * (0.22 + k * 0.12));
      (w.s.material as THREE.SpriteMaterial).opacity = Math.pow(1 - w.t, 0.7) * 0.95 * Math.min(1, k * 1.4);
    }
  }

  private updateTrail(dt: number) {
    const pts = this.trailPts;
    for (let i = pts.length - 1; i > 0; i--) pts[i].lerp(pts[i - 1], Math.min(1, dt * 30));
    pts[0].copy(this.pos);
    const pos = this.trail.geometry.attributes.position as THREE.BufferAttribute;
    const cam = ctx.camera.position;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const nxt = pts[Math.min(pts.length - 1, i + 1)];
      const tan = V3().subVectors(p, nxt);
      if (tan.lengthSq() < 1e-8) tan.set(0, 0, 1);
      const toCam = V3().subVectors(cam, p).normalize();
      const side = V3().crossVectors(tan, toCam).normalize().multiplyScalar(0.012 * (1 - i / pts.length));
      pos.setXYZ(i * 2, p.x + side.x, p.y + side.y, p.z + side.z);
      pos.setXYZ(i * 2 + 1, p.x - side.x, p.y - side.y, p.z - side.z);
    }
    pos.needsUpdate = true;
    const u = (this.trail.material as THREE.ShaderMaterial).uniforms.uOpacity;
    u.value += ((this.state === 'flying' ? clamp01(this.speed / 4) : 0) - u.value) * Math.min(1, dt * 10);
  }
}

const _yAx = new THREE.Vector3(0, 1, 0);
function setLeg(m: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3) {
  const d = V3().subVectors(b, a);
  const len = d.length();
  m.position.addVectors(a, b).multiplyScalar(0.5);
  m.scale.set(1, Math.max(0.001, len), 1);
  if (len > 1e-6) m.quaternion.setFromUnitVectors(_yAx, d.divideScalar(len));
}

export const _flyUnused = { smoothstep };
