import * as THREE from 'three';
import { ctx, TABLE } from './ctx';
import { clamp, damp, V3 } from '../core/math';

export type CamMode = 'title' | 'follow' | 'victory' | 'lose' | 'intro';

export class CameraRig {
  mode: CamMode = 'title';
  readonly target = V3(0, 0.85, 0);
  private side = 0.7;
  private sideWant = 0.7;
  private shakeAmt = 0;
  private orbit = 0;
  private modeT = 0;
  readonly focus = V3();
  private bias = V3();
  private biasT = 0;

  shake(a: number) {
    this.shakeAmt = Math.min(0.6, this.shakeAmt + a);
  }

  setMode(m: CamMode) {
    this.mode = m;
    this.modeT = 0;
  }

  /** Briefly pull the frame toward a slapstick moment (a guest fleeing, a tray flying). */
  nudge(p: THREE.Vector3, dur = 1.6) {
    this.bias.copy(p);
    this.biasT = dur;
  }

  update(dt: number) {
    const cam = ctx.camera;
    const fly = ctx.fly;
    this.modeT += dt;
    const aspect = cam.aspect;
    const vfov = aspect < 0.7 ? 55 : 46;
    if (Math.abs(cam.fov - vfov) > 0.01) {
      cam.fov = vfov;
      cam.updateProjectionMatrix();
    }
    const tanH = Math.tan(THREE.MathUtils.degToRad(vfov / 2));
    // keep ~1.8m of table width in view at the focus point (the fly stays big enough to read)
    const D = clamp(0.9 / (tanH * Math.min(aspect, 1.1)), 2.4, 4.2);
    const pos = V3();
    if (this.mode === 'title') {
      this.orbit += dt * 0.12;
      const r = 4.6;
      this.target.lerp(V3(0, 0.9, -0.4), damp(2, dt));
      pos.set(Math.sin(this.orbit) * r * 0.7 + 0.6, 3.1 + Math.sin(this.orbit * 0.7) * 0.3, Math.cos(this.orbit) * r * 0.35 + 3.9);
    } else if (this.mode === 'victory') {
      this.orbit += dt * 0.25;
      const c = this.focus;
      this.target.lerp(c, damp(3, dt));
      const r = 1.6 + Math.min(1, this.modeT * 0.2) * 1.6;
      pos.set(c.x + Math.sin(this.orbit) * r, c.y + 0.9 + Math.min(1, this.modeT * 0.3) * 1.2, c.z + Math.cos(this.orbit) * r);
    } else if (this.mode === 'lose') {
      const c = this.focus;
      this.target.lerp(c, damp(4, dt));
      pos.copy(c).add(V3(0.35, 0.9, 0.9));
    } else {
      // follow the fly
      // swing across the table so the faces nearest the fly are toward us
      if (fly.pos.x < -0.22) this.sideWant = 0.8;
      else if (fly.pos.x > 0.22) this.sideWant = -0.8;
      else if (fly.pos.z < -1.9) this.sideWant = this.side > 0 ? 0.45 : -0.45;
      this.side += (this.sideWant - this.side) * damp(1.1, dt);
      const want = V3(clamp(fly.pos.x * 0.55, -0.75, 0.75), clamp((fly.pos.y + 0.8) * 0.5, 0.78, 1.05), clamp(fly.pos.z - 0.28, -TABLE.halfL - 0.7, TABLE.halfL - 0.6));
      if (this.biasT > 0) {
        this.biasT -= dt;
        want.lerp(V3(this.bias.x * 0.6, 0.8, clamp(this.bias.z, -3, 2.2)), 0.3 * Math.min(1, this.biasT));
      }
      const lam = this.mode === 'intro' ? 1.5 : 2.6;
      this.target.lerp(want, damp(lam, dt));
      const dir = V3(this.side * 0.58, 0.62, 0.55).normalize();
      pos.copy(this.target).addScaledVector(dir, D);
    }
    if (this.mode === 'follow' || this.mode === 'intro') {
      cam.position.lerp(pos, damp(this.mode === 'intro' ? 1.8 : 6, dt));
    } else cam.position.lerp(pos, damp(2.2, dt));
    if (this.shakeAmt > 0.001) {
      const s = this.shakeAmt * 0.05;
      cam.position.add(V3((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s));
      this.shakeAmt *= Math.exp(-dt * 7);
    }
    cam.lookAt(this.target);
  }

  snap() {
    this.update(10);
  }
}
