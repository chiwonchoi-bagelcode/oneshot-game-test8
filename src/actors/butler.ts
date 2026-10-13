import * as THREE from 'three';
import { ctx, addSurface, TABLE } from '../game/ctx';
import type { Surface } from '../game/types';
import type { MessKind, MessTarget } from '../world/mess';
import type { Guest } from './guest';
import { Rig } from './rig';
import { lookFor, decorate } from './looks';
import { clay, glassMaterial, invisibleMat } from '../render/materials';
import { blob, cylinder, lathe } from '../render/shapes';
import { clamp01, randRange, rand, V3, easeOutCubic } from '../core/math';
import { noMerge } from '../render/merge';

type BState = 'walk' | 'serve' | 'wobble' | 'fall' | 'fetch' | 'leave' | 'gone' | 'puff';

const LOOP: [number, number][] = [
  [-1.62, -2.95], [-1.62, 2.45], [1.62, 2.45], [1.62, -2.95],
];
const SERVE: [number, number, number][] = [
  // x, z, index of loop edge it hangs off
  [-0.8, -0.6, 0], [-0.8, 0.5, 0], [0.8, -0.02, 2], [0.8, 1.2, 2], [-0.8, -1.65, 0], [0.8, -1.3, 2],
];

export class Butler implements MessTarget {
  readonly rig: Rig;
  readonly root: THREE.Group;
  active = true;
  st: BState = 'walk';
  private stT = 0;
  private wpIdx = 0;
  private path: [number, number][] = [];
  private tray: THREE.Group;
  private trayItems: { obj: THREE.Object3D; kind: MessKind; color: string; r: number }[] = [];
  hasTray = true;
  readonly noseSurface: Surface;
  readonly traySurface: Surface;
  readonly headSurface: Surface;
  private nextServe = 6;
  private wobbleT = 0;
  private dropped = 0;
  name = '집사 홉스';

  constructor() {
    this.rig = new Rig(lookFor('butler'));
    decorate('butler', this.rig);
    this.root = this.rig.root;
    this.rig.hipsBaseY = 0.86;
    this.rig.stand = 1;
    this.rig.standT = 1;
    this.rig.headTurnSpeed = 4;
    this.root.position.set(1.62, 0, -2.4);
    ctx.scene.add(this.root);
    // tray on the left hand
    this.tray = new THREE.Group();
    const silver = clay('#dfe3e8', { metal: 0.9, rough: 0.2, normal: 0.08 });
    const disc = cylinder(0.2, 0.19, 0.015, silver, 28);
    this.tray.add(disc);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.008, 6, 28), silver);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.008;
    this.tray.add(rim);
    this.restock();
    this.rig.arms[1].hand.add(noMerge(this.tray));
    this.tray.position.set(0, 0.04, 0.08);
    this.rig.finalize();

    const noseP = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), invisibleMat);
    noseP.position.copy(this.rig.noseTip.position);
    this.rig.head.add(noseP);
    this.noseSurface = addSurface({ kind: 'nose', proxy: noseP, anchor: this.rig.head, butler: this, enabled: true, priority: 5 });
    const headP = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), invisibleMat);
    this.rig.head.add(headP);
    this.headSurface = addSurface({ kind: 'head', proxy: headP, anchor: this.rig.head, butler: this, enabled: true, priority: 3 });
    const trayP = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.12, 14), invisibleMat);
    trayP.position.y = 0.05;
    this.tray.add(trayP);
    this.traySurface = addSurface({ kind: 'tray', proxy: trayP, anchor: this.tray, butler: this, enabled: true, priority: 2 });
    this.path = [LOOP[3], LOOP[0], LOOP[1], LOOP[2]];
  }

  private restock() {
    for (const it of this.trayItems) this.tray.remove(it.obj);
    this.trayItems = [];
    for (let i = 0; i < 2; i++) {
      const g = new THREE.Group();
      const gl = lathe([[0, 0], [0.026, 0.002], [0.004, 0.01], [0.004, 0.08], [0.016, 0.09], [0.02, 0.18]], glassMaterial('#fff9e0'), 14, false);
      g.add(gl);
      const liq = lathe([[0, 0.088], [0.014, 0.095], [0.017, 0.16], [0, 0.16]], clay('#f1d77a', { rough: 0.1 }), 12, false);
      g.add(liq);
      g.position.set(-0.08 + i * 0.07, 0.01, -0.05 + i * 0.05);
      this.tray.add(g);
      this.trayItems.push({ obj: g, kind: 'wine', color: '#f1d77a', r: 0.04 });
    }
    const jm = new THREE.MeshPhysicalMaterial({ color: '#e0304a', roughness: 0.12, clearcoat: 1, emissive: new THREE.Color('#e0304a').multiplyScalar(0.18) });
    const j = blob(0.06, 0.055, 0.06, jm, 14);
    j.position.set(0.07, 0.06, 0.03);
    this.tray.add(j);
    this.trayItems.push({ obj: j, kind: 'jelly', color: '#e0304a', r: 0.06 });
    this.hasTray = true;
  }

  headSphere(out: THREE.Vector3) {
    this.rig.head.getWorldPosition(out);
    return 0.15;
  }
  bodySphere(out: THREE.Vector3) {
    this.rig.torso.localToWorld(out.set(0, 0.25, 0.02));
    return 0.2;
  }
  receiveMess(kind: MessKind, color: string, point: THREE.Vector3, part: 'head' | 'body', source: Guest | Butler | null, obj?: THREE.Object3D): boolean {
    if (!this.active) return false;
    if (kind === 'toupee') return false;
    if (obj && kind === 'jelly' && part === 'head') {
      this.rig.head.attach(obj);
      obj.position.set(0, this.rig.b * 0.95, 0);
      obj.rotation.set(0, 0, 0);
      obj.scale.set(this.rig.a * 0.95, 0.085, this.rig.c * 0.95);
      ctx.prank('jellyhat', point);
    } else if (obj) ctx.scene.remove(obj);
    // utterly stoic
    this.rig.faceTarget.lid = 0.3;
    ctx.audio.sfx('splat', point);
    ctx.emit({ type: 'messOn', pos: point.clone(), loud: 0.6, gross: 0.04, source, chain: true });
    void color;
    return true;
  }

  smacked(by: Guest | null, at: THREE.Vector3) {
    if (!this.active) return;
    ctx.audio.voice(this, 'ow');
    this.dropTray(by, 'smack');
    void at;
  }

  trayHit(at: THREE.Vector3, r: number) {
    if (!this.hasTray || !this.active) return false;
    const tp = this.tray.getWorldPosition(V3());
    if (tp.distanceTo(at) < 0.22 + r) {
      this.dropTray(null, 'tray');
      return true;
    }
    return false;
  }

  bumped(by: Guest) {
    if (this.st === 'fall' || this.st === 'fetch' || this.st === 'gone' || this.st === 'leave') return;
    this.st = 'fall';
    this.stT = 0;
    ctx.audio.voice(this, 'ow');
    this.dropTray(by, 'bump');
  }

  get voicePitch() {
    return 98;
  }

  dropTray(by: Guest | null, why: string) {
    if (!this.hasTray) return;
    this.hasTray = false;
    this.dropped++;
    this.traySurface.enabled = false;
    const tp = this.tray.getWorldPosition(V3());
    const fwd = this.rig.forwardWorld(V3()).setY(0).normalize();
    for (const it of this.trayItems) {
      const from = it.obj.getWorldPosition(V3());
      ctx.scene.attach(it.obj);
      const victim = ctx.mess.pickVictimNear(from, fwd, 2.0, null);
      ctx.mess.launchAt(it.obj, from, victim, it.kind, it.color, it.r, by, fwd.clone().multiplyScalar(randRange(0.8, 1.4)));
    }
    this.trayItems = [];
    // the tray itself clatters to the lawn
    ctx.scene.attach(this.tray);
    ctx.mess.launchObject(this.tray, tp, V3(fwd.x * 0.5, 1.6, fwd.z * 0.5), 'toupee', '#dfe3e8', 0.05, null, this);
    ctx.audio.sfx('crash', tp);
    ctx.audio.sfx('clatter', tp);
    ctx.prank('butler', tp);
    ctx.emit({ type: 'tray', pos: tp, loud: 1.2, gross: 0.05, source: this, chain: true });
    ctx.game.chainHit(null, tp);
    ctx.game.shake(0.3);
    if (ctx.fly.landedOn?.butler === this) ctx.fly.knockOff(fwd, 0.6);
    if (this.st !== 'fall') {
      this.st = 'fall';
      this.stT = 0;
    }
    void why;
  }

  update(dt: number) {
    if (this.st === 'gone') return;
    const r = this.rig;
    const t = ctx.time;
    this.stT += dt;
    const fly = ctx.fly;
    const [R, L] = r.arms;
    // right hand tucked behind his back, tray held high
    R.target.copy(r.torso.localToWorld(V3(-0.08, 0.2, -0.22)));
    L.target.copy(r.torso.localToWorld(V3(0.28, 0.52, 0.22)));
    L.handUp.set(0, 0, 1);
    R.speed = L.speed = 8;
    const f = r.faceTarget;
    f.smile = 0.05;
    f.lid = 0.55;
    f.browAng = 0;
    f.cross = 0;
    f.bulge = 0;
    f.open = 0;
    f.lowerLid = 0.15;
    r.running = 0;
    r.fallen = Math.max(0, r.fallen - dt * 2);
    r.leanT = 0;

    const onNose = fly.state === 'landed' && fly.landedOn === this.noseSurface;
    const onTray = fly.state === 'landed' && fly.landedOn === this.traySurface;
    if (onNose && (this.st === 'walk' || this.st === 'serve' || this.st === 'puff')) {
      this.st = 'wobble';
      this.stT = 0;
      this.wobbleT = 0;
      ctx.prank('crosseye', r.noseTip.getWorldPosition(V3()));
    }
    if (onTray && this.st === 'walk' && this.stT > 0.5) {
      this.st = 'puff';
      this.stT = 0;
    }
    const pos = this.root.position;

    switch (this.st) {
      case 'walk':
      case 'leave':
      case 'fetch': {
        const target = this.path[this.wpIdx];
        if (!target) {
          if (this.st === 'leave') {
            this.st = 'gone';
            this.active = false;
            this.root.visible = false;
            this.noseSurface.enabled = this.headSurface.enabled = this.traySurface.enabled = false;
            return;
          }
          if (this.st === 'fetch') {
            // back from the kitchen with a fresh tray
            this.restock();
            this.traySurface.enabled = true;
            if (this.tray.parent !== L.hand) {
              L.hand.add(this.tray);
              this.tray.position.set(0, 0.04, 0.08);
              this.tray.rotation.set(0, 0, 0);
            }
            this.st = 'walk';
            this.path = [[0, -6.5], [1.62, -2.95], LOOP[0]];
            this.wpIdx = 0;
          }
          this.nextLoop();
          break;
        }
        const to = V3(target[0] - pos.x, 0, target[1] - pos.z);
        const d = to.length();
        const speed = this.st === 'leave' || this.st === 'fetch' ? 1.4 : 0.85;
        if (d < 0.08) {
          this.wpIdx++;
          if (this.st === 'walk' && this.servingTarget(target)) {
            this.st = 'serve';
            this.stT = 0;
          }
        } else {
          to.normalize();
          pos.addScaledVector(to, Math.min(d, speed * dt));
          this.face(Math.atan2(to.x, to.z), dt);
          r.running = this.st === 'walk' ? 0.4 : 0.7;
          r.runPhase += dt * (this.st === 'walk' ? 7 : 11);
          if (Math.floor(r.runPhase / Math.PI) !== Math.floor((r.runPhase - dt * 7) / Math.PI)) ctx.audio.sfx('step', pos, 0.2);
        }
        // spilled wine underfoot?
        if (this.hasTray && this.st !== 'leave' && ctx.mess.slipAt(pos)) {
          ctx.audio.sfx('slip', pos);
          ctx.prank('slip', pos);
          this.st = 'fall';
          this.stT = 0;
          this.dropTray(null, 'slip');
        }
        r.lookAt(pos.clone().add(V3(Math.sin(this.root.rotation.y), 1.55, Math.cos(this.root.rotation.y))));
        f.smile = 0.1;
        break;
      }
      case 'serve': {
        // offer the tray toward the table, nose in the air
        L.target.copy(r.torso.localToWorld(V3(0.2, 0.45, 0.35)));
        const toTable = V3(-pos.x, 0, 0).normalize();
        this.face(Math.atan2(toTable.x, toTable.z), dt);
        r.lookAt(V3(0, 1.3, pos.z));
        if (this.stT > 2.2) {
          this.st = 'walk';
          this.stT = 0;
        }
        break;
      }
      case 'puff': {
        // blows the fly off the tray with dignity
        f.pucker = 1;
        f.puff = this.stT < 0.4 ? 1 : 0;
        r.lookAt(this.tray.getWorldPosition(V3()));
        if (this.stT > 0.45 && onTray) {
          fly.knockOff(this.rig.forwardWorld(V3()), 0.5);
          ctx.audio.sfx('whoosh', fly.pos, 0.5);
        }
        if (this.stT > 0.8) {
          this.st = 'walk';
          this.stT = 0;
        }
        break;
      }
      case 'wobble': {
        // cross-eyed, teetering, trying to keep the tray level
        this.wobbleT += dt;
        f.cross = 1;
        f.bulge = 0.6;
        f.browAng = -0.5;
        f.open = 0.2;
        const w = Math.sin(this.wobbleT * 9) * Math.min(1, this.wobbleT);
        r.sideLeanT = w * 0.25;
        r.leanT = Math.cos(this.wobbleT * 7) * 0.15;
        L.target.copy(r.torso.localToWorld(V3(0.28 + w * 0.15, 0.52 + Math.abs(w) * 0.1, 0.22)));
        r.lookAt(r.noseTip.getWorldPosition(V3()).add(r.forwardWorld(V3()).multiplyScalar(0.2)));
        if (!onNose) {
          this.st = 'walk';
          this.stT = 0;
        } else if (this.wobbleT > 1.8) {
          ctx.audio.voice(this, 'achoo');
          const mouth = r.mouthWorld(V3());
          ctx.mess.spray(mouth, r.forwardWorld(V3()), '#d8ecf2', 'sneeze', this);
          fly.knockOff(r.forwardWorld(V3()), 0.8);
          this.dropTray(null, 'sneeze');
        }
        break;
      }
      case 'fall': {
        r.fallen = Math.min(1, r.fallen + dt * 5);
        r.running = 0;
        f.cross = 0.6;
        f.open = 0.6;
        f.bulge = 0.8;
        L.target.copy(r.headWorld(V3()).add(V3(0.2, 0.3, 0)));
        if (this.stT > 1.8 && ctx.game.cakeOpen) {
          this.leave();
        } else if (this.stT > 1.8) {
          // dust off, fetch another tray
          this.st = 'fetch';
          this.stT = 0;
          this.tray.visible = true;
          this.path = [[pos.x > 0 ? 1.62 : -1.62, -2.95], [0, -6.5]];
          this.wpIdx = 0;
        }
        break;
      }
      default:
        break;
    }
    r.update(dt, t);
    // keep the tray level in world space (tilting only when he teeters)
    if (this.hasTray && this.tray.parent === L.hand) {
      L.hand.updateWorldMatrix(true, false);
      const pq = new THREE.Quaternion();
      L.hand.getWorldQuaternion(pq);
      const want = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, this.root.rotation.y, this.st === 'wobble' ? Math.sin(this.wobbleT * 9) * 0.3 : 0));
      this.tray.quaternion.copy(pq.invert().multiply(want));
    }
  }

  private servingTarget(t: [number, number]) {
    return SERVE.some(([x, z]) => x === t[0] && z === t[1]);
  }

  private face(yaw: number, dt: number) {
    let d = yaw - this.root.rotation.y;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.root.rotation.y += d * Math.min(1, dt * 5);
  }

  /** Build the next lap around the table, maybe with a serving detour. */
  private nextLoop() {
    const p: [number, number][] = [];
    const pos = this.root.position;
    // nearest corner
    let start = 0;
    let best = 1e9;
    LOOP.forEach((c, i) => {
      const d = Math.hypot(c[0] - pos.x, c[1] - pos.z);
      if (d < best) {
        best = d;
        start = i;
      }
    });
    for (let k = 0; k < 4; k++) {
      const i = (start + k) % 4;
      p.push(LOOP[i]);
      // detours along this edge
      const options = SERVE.filter((s) => s[2] === i);
      if (options.length && rand() < 0.85) {
        const s = options[Math.floor(rand() * options.length)];
        const edgeX = i === 0 ? -1.62 : 1.62;
        p.push([edgeX, s[1]], [s[0], s[1]], [edgeX, s[1]]);
      }
    }
    this.path = p;
    this.wpIdx = 0;
  }

  /** Everyone has gone: the butler retires with dignity. */
  leave() {
    if (this.st === 'gone' || this.st === 'leave') return;
    this.st = 'leave';
    const pos = this.root.position;
    this.path = [[pos.x > 0 ? 1.62 : -1.62, -2.95], [0, -6.5], [0, -11]];
    this.wpIdx = 0;
  }
}

export const _butlerUnused = { TABLE, clamp01, easeOutCubic };
