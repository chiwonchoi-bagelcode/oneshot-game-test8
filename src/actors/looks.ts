import * as THREE from 'three';
import type { Look } from './rig';
import { Rig } from './rig';
import { clay } from '../render/materials';
import { blob, capsule, cylinder, lathe, rbox, torus } from '../render/shapes';
import { makeNewsprintTexture, makeTweedTexture } from '../render/textures';
import { rand, randRange } from '../core/math';
import { mergeStatic, noMerge } from '../render/merge';
import type { GuestId } from '../world/layout';

export interface Props {
  hat?: THREE.Object3D;
  toupee?: THREE.Object3D;
  newspaper?: Newspaper;
  fan?: Fan;
  handbag?: THREE.Object3D;
  trumpet?: THREE.Object3D;
  trumpetBell?: THREE.Object3D;
  cane?: THREE.Object3D;
  napkin?: THREE.Object3D;
  headTop: THREE.Object3D;
  hasHat: boolean;
}

/** The Colonel's copy of The Times: open for reading, rolled into a weapon. */
export class Newspaper {
  readonly group = new THREE.Group();
  readonly sheet: THREE.Mesh;
  readonly roll: THREE.Mesh;
  rolled = 0;
  rolledT = 0;
  constructor() {
    const tex = makeNewsprintTexture();
    const g = new THREE.PlaneGeometry(0.36, 0.44, 8, 1);
    // gentle fold
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setZ(i, -Math.abs(p.getX(i)) * 0.25);
    g.computeVertexNormals();
    this.sheet = new THREE.Mesh(g, clay('#ffffff', { map: tex, side: THREE.DoubleSide, normal: 0.3, rough: 0.8 }));
    this.sheet.castShadow = true;
    this.group.add(this.sheet);
    this.roll = cylinder(0.026, 0.026, 0.42, clay('#ece4cf', { map: tex, normal: 0.4, rough: 0.8 }), 12);
    this.roll.visible = false;
    this.group.add(this.roll);
  }
  update(dt: number) {
    this.rolled += (this.rolledT - this.rolled) * Math.min(1, dt * 9);
    const r = this.rolled;
    this.sheet.visible = r < 0.85;
    this.sheet.scale.set(1 - r * 0.85, 1, 1);
    this.roll.visible = r > 0.5;
    this.roll.scale.set(1, 0.6 + r * 0.4, 1);
  }
}

export class Fan {
  readonly group = new THREE.Group();
  readonly leaf: THREE.Mesh;
  readonly stick: THREE.Mesh;
  open = 1;
  openT = 1;
  constructor(color: string) {
    this.leaf = new THREE.Mesh(new THREE.CircleGeometry(0.16, 20, 0, Math.PI), clay(color, { side: THREE.DoubleSide, normal: 0.5 }));
    this.leaf.rotation.z = -Math.PI / 2;
    this.leaf.castShadow = true;
    this.group.add(this.leaf);
    this.stick = capsule(0.012, 0.15, clay('#6b3d22'), 6);
    this.stick.position.y = 0.08;
    this.group.add(this.stick);
  }
  update(dt: number) {
    this.open += (this.openT - this.open) * Math.min(1, dt * 12);
    this.leaf.visible = this.open > 0.08;
    this.leaf.scale.set(1, Math.max(0.05, this.open), 1);
  }
}

const SKIN = {
  ruddy: '#eaa287',
  pink: '#f2bf9e',
  pale: '#f4d4c2',
  warm: '#efc29f',
  rose: '#f3c9b2',
};

export function lookFor(id: GuestId | 'butler'): Look {
  switch (id) {
    case 'colonel':
      return {
        skin: SKIN.ruddy, headR: 0.15, headS: [1.0, 1.02, 0.95], jaw: 0.38,
        eyeR: 0.033, eyeGap: 0.043, eyeY: 0.035, noseKind: 'bulb', noseSize: 0.052, noseColor: '#df7a68',
        browColor: '#f4f1ea', browThick: 0.017, browLen: 0.05, mouthW: 0.105, mouthY: -0.07,
        torsoColor: '#a52a32', torsoW: 0.2, torsoH: 0.42, torsoD: 0.16, belly: 0.06, sleeveColor: '#a52a32',
        handColor: SKIN.ruddy, trouser: '#262a3f', shoe: '#141414', neckLen: 0.03, ears: 0.035, rosy: 0.6,
      };
    case 'reverend':
      return {
        skin: SKIN.pink, headR: 0.16, headS: [1.06, 0.98, 1.0], jaw: 0.55,
        eyeR: 0.03, eyeGap: 0.042, eyeY: 0.04, noseKind: 'potato', noseSize: 0.046,
        browColor: '#9a9590', browThick: 0.012, browLen: 0.04, mouthW: 0.13, mouthY: -0.065,
        torsoColor: '#25252d', torsoW: 0.22, torsoH: 0.42, torsoD: 0.18, belly: 0.11, sleeveColor: '#25252d',
        handColor: SKIN.pink, trouser: '#25252d', shoe: '#141414', neckLen: 0.02, ears: 0.036, rosy: 1,
      };
    case 'granny':
      return {
        skin: SKIN.rose, headR: 0.13, headS: [1.0, 1.0, 0.95], jaw: 0.25,
        eyeR: 0.027, eyeGap: 0.036, eyeY: 0.03, noseKind: 'button', noseSize: 0.034,
        browColor: '#d8d4d0', browThick: 0.008, browLen: 0.035, mouthW: 0.085, mouthY: -0.06,
        torsoColor: '#9c86bd', torsoTex: makeTweedTexture('#9c86bd', '#c8b8e0'), torsoW: 0.17, torsoH: 0.38, torsoD: 0.15, belly: 0.03, bust: 0.05, skirt: true,
        sleeveColor: '#9c86bd', handColor: SKIN.rose, trouser: '#6e5a8a', shoe: '#3b2a20', neckLen: 0.03, ears: 0.028, rosy: 0.5,
      };
    case 'prudence':
      return {
        skin: SKIN.pale, headR: 0.13, headS: [0.82, 1.22, 0.9], jaw: 0.0,
        eyeR: 0.03, eyeGap: 0.033, eyeY: 0.045, noseKind: 'long', noseSize: 0.04,
        browColor: '#3a2a22', browThick: 0.007, browLen: 0.038, mouthW: 0.072, mouthY: -0.075,
        torsoColor: '#7d4f85', torsoW: 0.15, torsoH: 0.4, torsoD: 0.13, belly: 0, bust: 0.03, skirt: true,
        sleeveColor: '#7d4f85', handColor: SKIN.pale, trouser: '#4a2f50', shoe: '#1d1414', neckLen: 0.1, ears: 0.026, rosy: 0.15,
      };
    case 'dandy':
      return {
        skin: SKIN.warm, headR: 0.145, headS: [0.94, 1.1, 0.98], jaw: 0.62,
        eyeR: 0.03, eyeGap: 0.04, eyeY: 0.04, noseKind: 'hook', noseSize: 0.042,
        browColor: '#1e1612', browThick: 0.011, browLen: 0.042, mouthW: 0.11, mouthY: -0.07,
        torsoColor: '#f1e8d2', torsoW: 0.19, torsoH: 0.43, torsoD: 0.15, belly: 0.02, sleeveColor: '#f1e8d2',
        handColor: SKIN.warm, trouser: '#e8dec6', shoe: '#6a3a1f', neckLen: 0.04, ears: 0.032, rosy: 0.2,
      };
    case 'hostess':
      return {
        skin: SKIN.rose, headR: 0.15, headS: [1.04, 1.0, 0.97], jaw: 0.35,
        eyeR: 0.031, eyeGap: 0.04, eyeY: 0.035, noseKind: 'button', noseSize: 0.04,
        browColor: '#7a5a3a', browThick: 0.009, browLen: 0.042, mouthW: 0.095, mouthY: -0.068,
        torsoColor: '#6b3d91', torsoW: 0.2, torsoH: 0.42, torsoD: 0.16, belly: 0.03, bust: 0.08, skirt: true,
        sleeveColor: '#6b3d91', handColor: '#f6f2ea', trouser: '#4e2a6b', shoe: '#2a1630', neckLen: 0.04, ears: 0.03, rosy: 0.45,
      };
    case 'butler':
      return {
        skin: SKIN.warm, headR: 0.14, headS: [0.86, 1.2, 0.94], jaw: 0.3,
        eyeR: 0.028, eyeGap: 0.035, eyeY: 0.04, noseKind: 'long', noseSize: 0.046,
        browColor: '#141010', browThick: 0.01, browLen: 0.04, mouthW: 0.08, mouthY: -0.08,
        torsoColor: '#1d1d24', torsoW: 0.18, torsoH: 0.46, torsoD: 0.14, belly: 0.0, sleeveColor: '#1d1d24',
        handColor: '#f8f6f0', trouser: '#1d1d24', shoe: '#0c0c0c', neckLen: 0.05, ears: 0.03, rosy: 0,
        armLen: 0.3,
      };
  }
}

function spectacles(rig: Rig, r: number, color: string, round = true) {
  const g = new THREE.Group();
  const m = clay(color, { metal: 0.6, rough: 0.3, normal: 0.1 });
  const L = rig.look;
  for (const s of [-1, 1]) {
    const ring = torus(r, 0.004, m, Math.PI * 2, false);
    const x = s * L.eyeGap;
    ring.position.set(x, L.eyeY, rig.headSurf(x, L.eyeY) + L.eyeR * 0.85);
    if (!round) ring.scale.set(1, 0.7, 1);
    g.add(ring);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(r, 16), new THREE.MeshPhysicalMaterial({ color: '#e8f4ff', transparent: true, opacity: 0.25, roughness: 0.05, envMapIntensity: 2 }));
    lens.position.copy(ring.position);
    lens.scale.copy(ring.scale);
    g.add(lens);
  }
  const bridge = capsule(0.003, L.eyeGap * 0.6, m, 4, false);
  bridge.rotation.z = Math.PI / 2;
  bridge.position.set(0, L.eyeY + 0.004, rig.headSurf(0, L.eyeY) + L.eyeR * 0.9);
  g.add(bridge);
  rig.head.add(g);
  return g;
}

export function decorate(id: GuestId | 'butler', rig: Rig): Props {
  const L = rig.look;
  const h = rig.head;
  const a = rig.a, b = rig.b, c = rig.c;
  const headTop = new THREE.Object3D();
  headTop.position.set(0, b * 0.98, 0);
  h.add(headTop);
  const props: Props = { headTop, hasHat: false };
  const torso = rig.torso;
  const T = L.torsoH;

  switch (id) {
    case 'colonel': {
      const white = clay('#f6f3ec', { normal: 1.1, rough: 0.7 });
      // walrus moustache
      for (const s of [-1, 1]) {
        const m = blob(0.055, 0.026, 0.03, white, 14);
        const x = s * 0.04, y = L.mouthY + 0.03;
        m.position.set(x, y, rig.headSurf(x, y) + 0.012);
        m.rotation.z = s * -0.35;
        h.add(m);
        const tip = blob(0.022, 0.035, 0.02, white, 10, false);
        tip.position.set(s * 0.085, L.mouthY + 0.0, rig.headSurf(s * 0.085, L.mouthY) + 0.0);
        h.add(tip);
        const side = blob(0.03, 0.05, 0.05, white, 12);
        side.position.set(s * a * 0.95, 0.0, -c * 0.35);
        h.add(side);
      }
      // monocle on his right eye (eyes[0] is at -x = his right)
      const mon = torus(L.eyeR * 1.2, 0.0045, clay('#d8b04a', { metal: 0.9, rough: 0.2, normal: 0.1 }), Math.PI * 2, false);
      const ex = -L.eyeGap;
      mon.position.set(ex, L.eyeY, rig.headSurf(ex, L.eyeY) + L.eyeR * 0.9);
      h.add(mon);
      const chain = capsule(0.002, 0.14, clay('#d8b04a', { metal: 0.9, rough: 0.2 }), 4, false);
      chain.position.set(ex - 0.02, L.eyeY - 0.08, rig.headSurf(ex, L.eyeY) + 0.01);
      chain.rotation.z = 0.25;
      h.add(chain);
      // gold buttons + medals
      const gold = clay('#e0b84a', { metal: 0.85, rough: 0.25, normal: 0.1 });
      for (let i = 0; i < 4; i++) {
        const btn = blob(0.012, 0.012, 0.008, gold, 8, false);
        btn.position.set(0, T * (0.2 + i * 0.17), L.torsoD * 0.98 + (i < 2 ? 0.05 : 0.02));
        torso.add(btn);
      }
      const ribbons = ['#2a5cad', '#e0b84a', '#2d8a4b'];
      for (let i = 0; i < 3; i++) {
        const rb = rbox(0.025, 0.035, 0.008, 0.004, clay(ribbons[i]), false);
        rb.position.set(0.06 + i * 0.03, T * 0.72, L.torsoD * 0.88);
        rb.rotation.x = -0.2;
        torso.add(rb);
        const medal = cylinder(0.012, 0.012, 0.005, gold, 10, false);
        medal.rotation.x = Math.PI / 2;
        medal.position.set(0.06 + i * 0.03, T * 0.65, L.torsoD * 0.9);
        torso.add(medal);
      }
      // epaulettes
      for (const s of [-1, 1]) {
        const ep = blob(0.06, 0.018, 0.05, gold, 12);
        ep.position.set(s * L.torsoW * 0.85, T * 0.98, 0);
        torso.add(ep);
      }
      const np = new Newspaper();
      props.newspaper = np;
      break;
    }
    case 'reverend': {
      const grey = clay('#c9c4bc', { normal: 1.2, rough: 0.7 });
      for (const s of [-1, 1]) {
        const tuft = blob(0.03, 0.04, 0.05, grey, 10);
        tuft.position.set(s * a * 0.98, 0.03, -c * 0.25);
        h.add(tuft);
        const tuft2 = blob(0.025, 0.03, 0.035, grey, 10);
        tuft2.position.set(s * a * 0.8, 0.075, -c * 0.45);
        h.add(tuft2);
      }
      // a little shine on that dome (the fly's favourite landing pad)
      const shine = blob(0.035, 0.012, 0.025, new THREE.MeshBasicMaterial({ color: '#fff4ea', transparent: true, opacity: 0.55 }), 10, false);
      shine.position.set(-0.03, b * 0.93, 0.04);
      shine.rotation.x = -0.3;
      h.add(shine);
      spectacles(rig, L.eyeR * 1.2, '#b8a060');
      // dog collar
      const coll = cylinder(0.062, 0.066, 0.035, clay('#fbfbf7', { rough: 0.3 }), 16, false);
      coll.position.y = T * 1.03;
      torso.add(coll);
      const tab = rbox(0.03, 0.025, 0.01, 0.004, clay('#fbfbf7'), false);
      tab.position.set(0, T * 1.02, 0.062);
      torso.add(tab);
      break;
    }
    case 'granny': {
      const perm = clay('#c9c3d8', { normal: 1.3, rough: 0.7 });
      for (let i = 0; i < 26; i++) {
        const u = rand() * Math.PI * 2;
        const v = randRange(0.0, 1.15);
        const r = 1.02;
        const x = Math.cos(u) * Math.sin(v) * a * r;
        const z = Math.sin(u) * Math.sin(v) * c * r - 0.01;
        const y = Math.cos(v) * b * r + 0.01;
        if (z > c * 0.55 && y < b * 0.75) continue;
        const curl = blob(0.032, 0.03, 0.032, perm, 10);
        curl.position.set(x, y, z);
        h.add(curl);
      }
      spectacles(rig, L.eyeR * 1.35, '#3a2a20');
      // pearls
      const pearl = clay('#fbf6ec', { rough: 0.15, normal: 0.05, envI: 1.4 });
      for (let i = 0; i < 14; i++) {
        const ang = (i / 13) * Math.PI - Math.PI;
        const pb = blob(0.012, 0.012, 0.012, pearl, 8, false);
        pb.position.set(Math.cos(ang) * 0.08, T * 0.9 + Math.sin(ang) * 0.05, 0.1 + Math.sin(-ang) * 0.02);
        torso.add(pb);
      }
      // ear trumpet (held in her left hand)
      const brass = clay('#d1a24a', { metal: 0.85, rough: 0.28, normal: 0.12, side: THREE.DoubleSide });
      const tr = new THREE.Group();
      const pts: [number, number][] = [];
      for (let i = 0; i <= 10; i++) {
        const t = i / 10;
        pts.push([0.008 + Math.pow(t, 2.4) * 0.07, t * 0.2]);
      }
      const horn = lathe(pts, brass, 20);
      horn.rotation.x = -Math.PI / 2; // points along -z then we orient
      tr.add(horn);
      const bell = new THREE.Object3D();
      bell.position.set(0, 0, -0.2);
      tr.add(bell);
      props.trumpet = tr;
      props.trumpetBell = bell;
      // handbag
      const bag = new THREE.Group();
      const body = rbox(0.18, 0.13, 0.08, 0.03, clay('#5a2e2a', { rough: 0.35, normal: 0.6 }));
      body.position.y = 0.065;
      bag.add(body);
      const clasp = rbox(0.06, 0.015, 0.02, 0.005, clay('#d1a24a', { metal: 0.8, rough: 0.3 }), false);
      clasp.position.set(0, 0.13, 0.03);
      bag.add(clasp);
      const handle = torus(0.06, 0.008, clay('#3a1d1a'), Math.PI);
      handle.position.y = 0.13;
      bag.add(handle);
      props.handbag = bag;
      break;
    }
    case 'prudence': {
      const hair = clay('#4a2e22', { normal: 0.9, rough: 0.45 });
      const cap = blob(a * 1.04, b * 0.6, c * 1.02, hair, 20);
      cap.position.set(0, b * 0.48, -0.006);
      h.add(cap);
      const bun = blob(0.055, 0.05, 0.05, hair, 14);
      bun.position.set(0, b * 1.05, -c * 0.3);
      h.add(bun);
      // pince-nez on the long nose
      const pm = clay('#d8b04a', { metal: 0.9, rough: 0.2, normal: 0.1 });
      for (const s of [-1, 1]) {
        const ring = torus(0.018, 0.0035, pm, Math.PI * 2, false);
        ring.position.set(s * 0.022, L.eyeY - 0.03, rig.headSurf(0, L.eyeY) + 0.05);
        h.add(ring);
      }
      // high lace collar
      const lace = clay('#fbf8f2', { normal: 1.2 });
      for (let i = 0; i < 12; i++) {
        const ang = (i / 12) * Math.PI * 2;
        const l = blob(0.022, 0.035, 0.012, lace, 8, false);
        l.position.set(Math.cos(ang) * 0.058, T * 1.08, Math.sin(ang) * 0.058);
        l.rotation.y = -ang + Math.PI / 2;
        torso.add(l);
      }
      const brooch = blob(0.016, 0.02, 0.008, clay('#2d7a5a', { rough: 0.1 }), 8, false);
      brooch.position.set(0, T * 0.92, L.torsoD * 0.95);
      torso.add(brooch);
      const nap = blob(0.07, 0.006, 0.07, clay('#fbf8f2', { normal: 0.8 }), 10);
      props.napkin = nap;
      break;
    }
    case 'dandy': {
      // shiny toupee (can be knocked off — revealing the truth)
      const tp = new THREE.Group();
      const hairMat = clay('#3b2416', { rough: 0.22, normal: 0.5 });
      const main = blob(a * 0.95, b * 0.32, c * 0.95, hairMat, 18);
      tp.add(main);
      const quiff = blob(a * 0.55, b * 0.3, c * 0.55, hairMat, 14);
      quiff.position.set(a * 0.15, b * 0.12, c * 0.4);
      quiff.rotation.z = -0.3;
      tp.add(quiff);
      tp.position.set(0, b * 0.82, 0);
      h.add(tp);
      props.toupee = tp;
      // fringe of real hair at the sides
      for (const s of [-1, 1]) {
        const side = blob(0.03, 0.05, 0.06, hairMat, 10);
        side.position.set(s * a * 0.96, 0.02, -c * 0.2);
        h.add(side);
      }
      // curly moustache
      const mm = clay('#1e1612', { rough: 0.3 });
      for (const s of [-1, 1]) {
        const curl = torus(0.018, 0.006, mm, Math.PI * 1.3, false);
        const x = s * 0.03, y = L.mouthY + 0.025;
        curl.position.set(x, y, rig.headSurf(x, y) + 0.006);
        curl.rotation.set(0, 0, s > 0 ? -0.6 : Math.PI - 0.6 + 0.6 + Math.PI * 0.0);
        if (s < 0) curl.scale.x = -1;
        h.add(curl);
      }
      // cravat + carnation
      const crav = blob(0.04, 0.05, 0.03, clay('#b3202e', { rough: 0.3, normal: 0.6 }), 12);
      crav.position.set(0, T * 0.92, L.torsoD * 0.85);
      torso.add(crav);
      const carn = blob(0.022, 0.022, 0.018, clay('#e23a4f', { normal: 1.2 }), 10, false);
      carn.position.set(0.09, T * 0.78, L.torsoD * 0.9);
      torso.add(carn);
      const lap = rbox(0.04, 0.18, 0.01, 0.004, clay('#e3d9c0'), false);
      for (const s of [-1, 1]) {
        const lp = lap.clone();
        lp.position.set(s * 0.05, T * 0.75, L.torsoD * 0.92);
        lp.rotation.z = s * 0.3;
        torso.add(lp);
      }
      // walking cane
      const cane = new THREE.Group();
      const shaft = cylinder(0.011, 0.011, 0.75, clay('#2a1a10', { rough: 0.2 }), 8);
      shaft.position.y = -0.375;
      cane.add(shaft);
      const knob = blob(0.022, 0.022, 0.022, clay('#e0b84a', { metal: 0.9, rough: 0.2 }), 10);
      cane.add(knob);
      props.cane = cane;
      break;
    }
    case 'hostess': {
      const hairMat = clay('#d9c08a', { normal: 1.1, rough: 0.5 });
      for (const s of [-1, 1]) {
        for (let i = 0; i < 3; i++) {
          const curl = blob(0.035, 0.03, 0.03, hairMat, 10);
          curl.position.set(s * a * 0.92, 0.02 - i * 0.035, -c * 0.2 - i * 0.03);
          h.add(curl);
        }
      }
      const back = blob(a * 0.9, b * 0.7, c * 0.6, hairMat, 14);
      back.position.set(0, b * 0.2, -c * 0.45);
      h.add(back);
      // the HAT: wide brim + crown + feathers + flowers
      const hat = new THREE.Group();
      const brimMat = clay('#7d4aa6', { normal: 0.6, rough: 0.5 });
      const brim = cylinder(0.3, 0.3, 0.016, brimMat, 32);
      hat.add(brim);
      const crown = blob(a * 0.95, 0.07, c * 0.95, brimMat, 18);
      crown.position.y = 0.035;
      hat.add(crown);
      const band = torus(a * 0.95, 0.012, clay('#f4d0e0', { normal: 0.4 }), Math.PI * 2, false);
      band.rotation.x = Math.PI / 2;
      band.position.y = 0.025;
      hat.add(band);
      const featherCols = ['#f17fb0', '#ffffff', '#9a5fcf'];
      for (let i = 0; i < 3; i++) {
        const fth = blob(0.025, 0.16, 0.012, clay(featherCols[i], { normal: 1.4 }), 10);
        fth.position.set(-0.07 + i * 0.03, 0.14, -0.05);
        fth.rotation.set(-0.5, 0, -0.5 + i * 0.35);
        hat.add(fth);
      }
      for (let i = 0; i < 5; i++) {
        const ang = 0.4 + i * 0.35;
        const fl = blob(0.03, 0.025, 0.03, clay(['#f05a7e', '#fff3f0', '#f7c548'][i % 3], { normal: 1.2 }), 10);
        fl.position.set(Math.cos(ang) * a * 0.95, 0.045, Math.sin(ang) * c * 0.95);
        hat.add(fl);
      }
      hat.position.set(0, b * 0.6, -0.01);
      hat.rotation.x = -0.12;
      h.add(hat);
      props.hat = hat;
      props.hasHat = true;
      // pearls (double string)
      const pearl = clay('#fbf6ec', { rough: 0.15, normal: 0.05, envI: 1.4 });
      for (let k = 0; k < 2; k++)
        for (let i = 0; i < 16; i++) {
          const ang = (i / 15) * Math.PI - Math.PI;
          const pb = blob(0.012, 0.012, 0.012, pearl, 8, false);
          pb.position.set(Math.cos(ang) * (0.085 + k * 0.012), T * 0.92 + Math.sin(ang) * (0.05 + k * 0.03), 0.11 + k * 0.012);
          torso.add(pb);
        }
      props.fan = new Fan('#f4d0e0');
      break;
    }
    case 'butler': {
      const hair = clay('#121212', { rough: 0.15, normal: 0.3 });
      const cap = blob(a * 1.03, b * 0.5, c * 1.03, hair, 18);
      cap.position.set(0, b * 0.55, -0.008);
      h.add(cap);
      for (const s of [-1, 1]) {
        const burn = blob(0.012, 0.04, 0.02, hair, 8, false);
        burn.position.set(s * a * 0.98, 0.0, 0.0);
        h.add(burn);
      }
      const shirt = blob(0.09, 0.15, 0.04, clay('#fbfbf7', { rough: 0.3 }), 14);
      shirt.position.set(0, T * 0.7, L.torsoD * 0.78);
      torso.add(shirt);
      for (const s of [-1, 1]) {
        const bw = blob(0.03, 0.018, 0.014, clay('#111111'), 10, false);
        bw.position.set(s * 0.025, T * 0.98, L.torsoD * 0.85);
        torso.add(bw);
      }
      // tails
      for (const s of [-1, 1]) {
        const tail = blob(0.06, 0.2, 0.02, clay('#1d1d24'), 10);
        tail.position.set(s * 0.06, -0.08, -L.torsoD * 0.85);
        tail.rotation.x = 0.15;
        torso.add(tail);
      }
      break;
    }
  }
  for (const o of [props.hat, props.toupee, props.trumpet, props.handbag, props.cane, props.napkin, props.newspaper?.group, props.fan?.group]) {
    if (o) noMerge(o);
  }
  if (props.hat) mergeStatic(props.hat);
  if (props.toupee) mergeStatic(props.toupee);
  if (props.handbag) mergeStatic(props.handbag);
  if (props.cane) mergeStatic(props.cane);
  return props;
}
