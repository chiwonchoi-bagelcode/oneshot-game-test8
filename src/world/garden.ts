import * as THREE from 'three';
import { ctx, addSurface, TABLE } from '../game/ctx';
import { clay, invisibleMat } from '../render/materials';
import { blob, capsule, cylinder, lathe, mesh, rbox, torus } from '../render/shapes';
import { makeClothTexture, makeLawnTexture, makeGravelTexture, makeStripeTexture } from '../render/textures';
import { rand, randRange } from '../core/math';
import { mergeStatic, noMerge } from '../render/merge';
import type { Surface } from '../game/types';

export interface Garden {
  group: THREE.Group;
  table: THREE.Group;
  tableSurface: Surface;
  groundSurface: Surface;
  gramophone: { group: THREE.Group; hornMouth: THREE.Vector3; surface: Surface; record: THREE.Mesh; knocked: boolean };
  chairs: Map<string, THREE.Group>;
}

function hedge(w: number, h: number, d: number) {
  const g = new THREE.Group();
  const mat = clay('#3f6b2a', { normal: 1.2, repeat: 4, rough: 0.7 });
  const body = rbox(w, h, d, 0.18, mat);
  body.position.y = h / 2;
  g.add(body);
  // lumpy top
  const n = Math.max(2, Math.round(Math.max(w, d) / 0.5));
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n - 0.5;
    const b = blob(0.32, 0.18, 0.32, clay('#4a7a30', { normal: 1.2, repeat: 3, rough: 0.7 }), 12);
    b.position.set(w > d ? t * w : randRange(-0.05, 0.05), h - 0.02, w > d ? randRange(-0.05, 0.05) : t * d);
    g.add(b);
  }
  return g;
}

function roseBush(colors: string[]) {
  const g = new THREE.Group();
  const leaf = clay('#3d6e2c', { normal: 1, rough: 0.65 });
  for (let i = 0; i < 4; i++) {
    const b = blob(randRange(0.25, 0.35), randRange(0.22, 0.3), randRange(0.25, 0.35), leaf, 12);
    b.position.set(randRange(-0.25, 0.25), 0.25, randRange(-0.25, 0.25));
    g.add(b);
  }
  for (let i = 0; i < 9; i++) {
    const r = blob(0.06, 0.05, 0.06, clay(colors[i % colors.length], { normal: 1.1 }), 10);
    const a = rand() * Math.PI * 2;
    r.position.set(Math.cos(a) * randRange(0.15, 0.38), randRange(0.3, 0.5), Math.sin(a) * randRange(0.15, 0.38));
    g.add(r);
  }
  return g;
}

function topiary() {
  const g = new THREE.Group();
  const pot = lathe([[0, 0], [0.18, 0], [0.24, 0.3], [0.26, 0.32], [0, 0.32]], clay('#b5653a', { normal: 0.8 }), 18);
  g.add(pot);
  const trunk = cylinder(0.03, 0.03, 0.5, clay('#6b4a2a'), 8);
  trunk.position.y = 0.55;
  g.add(trunk);
  const ball = blob(0.34, 0.34, 0.34, clay('#40702a', { normal: 1.3, repeat: 3, rough: 0.7 }), 18);
  ball.position.y = 1.0;
  g.add(ball);
  return g;
}

export function buildChair(style: 'garden' | 'throne') {
  const g = new THREE.Group();
  if (style === 'garden') {
    const white = clay('#f3efe6', { rough: 0.35, normal: 0.4 });
    const cushion = clay('#9cc4a8', { normal: 0.6, map: makeStripeTexture('#a8d0b4', '#eef4ea', 6) });
    const seat = rbox(0.44, 0.05, 0.42, 0.02, white);
    seat.position.y = 0.43;
    g.add(seat);
    const cush = rbox(0.4, 0.05, 0.38, 0.025, cushion);
    cush.position.y = 0.475;
    g.add(cush);
    for (const [x, z] of [[-0.19, -0.18], [0.19, -0.18], [-0.19, 0.18], [0.19, 0.18]]) {
      const leg = cylinder(0.018, 0.014, 0.43, white, 8);
      leg.position.set(x, 0.215, z);
      g.add(leg);
    }
    // back (behind the sitter: local -z)
    for (const x of [-0.19, 0.19]) {
      const p = cylinder(0.016, 0.016, 0.5, white, 8);
      p.position.set(x, 0.7, -0.2);
      g.add(p);
    }
    const top = torus(0.19, 0.018, white, Math.PI);
    top.position.set(0, 0.92, -0.2);
    g.add(top);
    for (let i = -2; i <= 2; i++) {
      const s = cylinder(0.008, 0.008, 0.42, white, 6, false);
      s.position.set(i * 0.065, 0.69, -0.2);
      g.add(s);
    }
  } else {
    const wood = clay('#7a4a26', { rough: 0.4, normal: 0.6 });
    const velvet = clay('#9b2335', { rough: 0.6, normal: 0.8 });
    const seat = rbox(0.52, 0.08, 0.48, 0.03, wood);
    seat.position.y = 0.42;
    g.add(seat);
    const cush = rbox(0.48, 0.07, 0.44, 0.035, velvet);
    cush.position.y = 0.49;
    g.add(cush);
    for (const [x, z] of [[-0.22, -0.2], [0.22, -0.2], [-0.22, 0.2], [0.22, 0.2]]) {
      const leg = cylinder(0.025, 0.02, 0.42, wood, 8);
      leg.position.set(x, 0.21, z);
      g.add(leg);
    }
    const back = rbox(0.5, 0.9, 0.07, 0.035, wood);
    back.position.set(0, 0.92, -0.23);
    g.add(back);
    const pad = rbox(0.4, 0.7, 0.04, 0.03, velvet);
    pad.position.set(0, 0.9, -0.19);
    g.add(pad);
    const crest = blob(0.12, 0.09, 0.05, wood, 14);
    crest.position.set(0, 1.4, -0.23);
    g.add(crest);
  }
  return mergeStatic(g) as THREE.Group;
}

function gramophone(): Garden['gramophone'] {
  const g = new THREE.Group();
  const wood = clay('#6e3f1f', { rough: 0.35, normal: 0.6 });
  const brass = clay('#d8a94a', { metal: 0.85, rough: 0.28, normal: 0.15 });
  // little side table
  const top = cylinder(0.32, 0.32, 0.04, clay('#f3efe6', { rough: 0.35 }), 24);
  top.position.y = 0.68;
  g.add(top);
  const leg = cylinder(0.03, 0.05, 0.66, clay('#f3efe6', { rough: 0.35 }), 10);
  leg.position.y = 0.34;
  g.add(leg);
  const box = rbox(0.34, 0.14, 0.34, 0.02, wood);
  box.position.y = 0.77;
  g.add(box);
  const record = cylinder(0.14, 0.14, 0.01, clay('#1a1a1a', { rough: 0.2, normal: 0.05 }), 28);
  record.position.y = 0.85;
  g.add(noMerge(record));
  const label = cylinder(0.04, 0.04, 0.012, clay('#c0302a'), 16, false);
  record.add(label);
  const dot = cylinder(0.008, 0.008, 0.014, clay('#f4e0a0'), 8, false);
  dot.position.x = 0.025;
  record.add(dot);
  // the fly can ride the spinning record
  const recProxy = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.03, 16), invisibleMat);
  recProxy.position.y = 0.01;
  record.add(recProxy);
  addSurface({ kind: 'prop', proxy: recProxy, anchor: record, enabled: true, priority: 3 });
  const arm = capsule(0.008, 0.14, brass, 6);
  arm.position.set(0.1, 0.9, 0.04);
  arm.rotation.set(0, 0, Math.PI / 2 - 0.3);
  g.add(arm);
  // the horn
  const hornPts: [number, number][] = [];
  for (let i = 0; i <= 14; i++) {
    const t = i / 14;
    hornPts.push([0.02 + Math.pow(t, 2.6) * 0.3, t * 0.55]);
  }
  const hornMat = clay('#d8a94a', { metal: 0.85, rough: 0.28, normal: 0.15, side: THREE.DoubleSide });
  const horn = lathe(hornPts, hornMat, 28);
  const hornPivot = new THREE.Group();
  hornPivot.position.set(-0.08, 0.92, 0);
  hornPivot.rotation.set(0.0, 0, 0.95);
  hornPivot.add(horn);
  g.add(hornPivot);
  const neck = torus(0.12, 0.025, brass, Math.PI * 0.6);
  neck.position.set(0.02, 0.9, 0);
  neck.rotation.z = Math.PI * 0.85;
  g.add(neck);
  const proxy = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.06, 0.6, 12), invisibleMat);
  proxy.position.y = 0.3;
  hornPivot.add(proxy);
  const mouthLocal = new THREE.Vector3(0, 0.55, 0);
  const surface = addSurface({ kind: 'horn', proxy, anchor: hornPivot, enabled: true, priority: 2 });
  g.updateMatrixWorld(true);
  return { group: g, hornMouth: hornPivot.localToWorld(mouthLocal.clone()), surface, record, knocked: false };
}

export function buildGarden(): Garden {
  const group = new THREE.Group();
  ctx.scene.add(group);

  // Lawn
  const lawnTex = makeLawnTexture();
  lawnTex.repeat.set(9, 9);
  const lawn = new THREE.Mesh(new THREE.PlaneGeometry(70, 70), clay('#ffffff', { map: lawnTex, rough: 0.85, normal: 0.6, repeat: 30 }));
  lawn.rotation.x = -Math.PI / 2;
  lawn.receiveShadow = true;
  group.add(lawn);
  const groundProxy = new THREE.Mesh(new THREE.PlaneGeometry(9, 12).rotateX(-Math.PI / 2), invisibleMat);
  groundProxy.position.set(0, 0, -0.5);
  group.add(groundProxy);
  const groundSurface = addSurface({ kind: 'ground', proxy: groundProxy, anchor: group, enabled: true, priority: 0 });

  // Gravel path toward the manor
  const gravel = makeGravelTexture();
  gravel.repeat.set(2, 10);
  const path = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 14), clay('#ffffff', { map: gravel, rough: 0.9, normal: 0.8, repeat: 6 }));
  path.rotation.x = -Math.PI / 2;
  path.position.set(0, 0.003, -11);
  path.receiveShadow = true;
  group.add(path);

  // Hedges framing the lawn
  const backL = hedge(5.4, 1.3, 0.9);
  backL.position.set(-4.5, 0, -8.2);
  const backR = hedge(5.4, 1.3, 0.9);
  backR.position.set(4.5, 0, -8.2);
  const sideL = hedge(0.9, 1.2, 12);
  sideL.position.set(-6.4, 0, -1.5);
  const sideR = hedge(0.9, 1.2, 12);
  sideR.position.set(6.4, 0, -1.5);
  group.add(backL, backR, sideL, sideR);
  // Arch over the gap
  const arch = torus(1.25, 0.09, clay('#f3efe6', { rough: 0.35 }), Math.PI);
  arch.position.set(0, 1.1, -8.2);
  group.add(arch);
  for (const x of [-1.25, 1.25]) {
    const p = cylinder(0.09, 0.09, 1.1, clay('#f3efe6', { rough: 0.35 }), 10);
    p.position.set(x, 0.55, -8.2);
    group.add(p);
    const climb = roseBush(['#e2445c', '#f59ab3']);
    climb.scale.set(0.7, 1.4, 0.7);
    climb.position.set(x, 0.2, -8.0);
    group.add(climb);
  }

  // Rose beds and topiary
  const roseSets = [['#e2445c', '#fff3f0'], ['#f59ab3', '#f7c548'], ['#fff3f0', '#e2445c'], ['#c93a5a', '#f59ab3']];
  const rosePos: [number, number][] = [[-4.6, -5.6], [-4.8, -2.4], [-4.5, 1.2], [4.6, -5.4], [4.8, -1.8], [4.5, 1.8], [-3.2, -7.2], [3.3, -7.3], [-4.2, 4.5], [4.3, 4.2]];
  rosePos.forEach(([x, z], i) => {
    const r = roseBush(roseSets[i % roseSets.length]);
    r.position.set(x, 0, z);
    r.scale.setScalar(randRange(1.1, 1.5));
    group.add(r);
  });
  for (const [x, z] of [[-2.6, -6.6], [2.6, -6.6], [-3.4, 3.6], [3.4, 3.6]]) {
    const t = topiary();
    t.position.set(x, 0, z);
    group.add(t);
  }

  // Manor facade in the distance
  const stone = clay('#e8dcc2', { rough: 0.6, normal: 0.6, repeat: 4 });
  const manor = rbox(16, 7, 1.2, 0.1, stone);
  manor.position.set(0, 3.5, -16);
  group.add(manor);
  const roof = rbox(16.6, 0.5, 1.6, 0.1, clay('#7c6f6a', { rough: 0.6 }));
  roof.position.set(0, 7.1, -16);
  group.add(roof);
  const winMat = clay('#3c5a78', { rough: 0.1, normal: 0.05, envI: 1.5 });
  const frameMat = clay('#fbf8f0', { rough: 0.4 });
  for (let i = -3; i <= 3; i++) {
    for (const y of [1.6, 4.4]) {
      if (i === 0 && y === 1.6) continue;
      const f = rbox(1.2, 1.7, 0.1, 0.04, frameMat, false);
      f.position.set(i * 2.1, y, -15.36);
      group.add(f);
      const w = rbox(1.0, 1.5, 0.1, 0.03, winMat, false);
      w.position.set(i * 2.1, y, -15.32);
      group.add(w);
    }
  }
  const door = rbox(1.3, 2.4, 0.15, 0.06, clay('#2f4a3a', { rough: 0.4 }));
  door.position.set(0, 1.2, -15.35);
  group.add(door);

  // Bunting between two poles behind the hostess
  const poleMat = clay('#f3efe6', { rough: 0.35 });
  for (const x of [-3.2, 3.2]) {
    const p = cylinder(0.04, 0.05, 2.6, poleMat, 8);
    p.position.set(x, 1.3, -4.2);
    group.add(p);
    const knob = blob(0.07, 0.07, 0.07, clay('#d6b25e', { metal: 0.6, rough: 0.3 }), 10);
    knob.position.set(x, 2.63, -4.2);
    group.add(knob);
  }
  const flagCols = ['#c8102e', '#ffffff', '#1d3f8f'];
  const flagGeo = new THREE.BufferGeometry();
  flagGeo.setAttribute('position', new THREE.Float32BufferAttribute([-0.1, 0, 0, 0.1, 0, 0, 0, -0.2, 0], 3));
  flagGeo.computeVertexNormals();
  const nFlags = 22;
  for (let i = 0; i < nFlags; i++) {
    const t = (i + 0.5) / nFlags;
    const x = -3.2 + t * 6.4;
    const y = 2.5 - Math.sin(t * Math.PI) * 0.55;
    const f = new THREE.Mesh(flagGeo, clay(flagCols[i % 3], { side: THREE.DoubleSide, normal: 0.3 }));
    f.position.set(x, y, -4.2);
    f.rotation.z = Math.cos(t * Math.PI) * 0.3;
    f.castShadow = true;
    group.add(f);
  }

  // Striped marquee corner
  const tentMat = clay('#ffffff', { map: makeStripeTexture('#e9e3d6', '#7aa7c7', 12), rough: 0.6, normal: 0.4 });
  const tent = new THREE.Mesh(new THREE.ConeGeometry(2.2, 1.6, 12, 1, true), tentMat);
  tent.position.set(-6.2, 2.7, -7.5);
  tent.castShadow = true;
  group.add(tent);
  const tentWall = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 1.9, 12, 1, true), tentMat);
  tentWall.position.set(-6.2, 0.95, -7.5);
  group.add(tentWall);

  // Bird bath near the camera end
  const bath = lathe([[0, 0], [0.2, 0], [0.08, 0.1], [0.06, 0.7], [0.32, 0.78], [0.34, 0.86], [0, 0.82]], clay('#d8d3c8', { rough: 0.7, normal: 1 }), 20);
  bath.position.set(2.6, 0, 3.4);
  group.add(bath);

  // ------------------------------------------------------------------ table
  const table = new THREE.Group();
  ctx.scene.add(table);
  const clothTex = makeClothTexture();
  clothTex.repeat.set(2, 8);
  const clothMat = clay('#ffffff', { map: clothTex, rough: 0.62, normal: 0.35, repeat: 4 });
  const cloth = rbox(TABLE.halfW * 2, 0.42, TABLE.halfL * 2, 0.04, clothMat);
  cloth.position.y = TABLE.y - 0.21;
  table.add(cloth);
  // scalloped lace hem (instanced)
  const hemMat = clay('#fffdf8', { rough: 0.5, normal: 0.5 });
  const per = 2 * (TABLE.halfW * 2 + TABLE.halfL * 2);
  const count = Math.round(per / 0.075);
  const hem = new THREE.InstancedMesh(new THREE.SphereGeometry(0.04, 10, 6), hemMat, count);
  const dm = new THREE.Object3D();
  for (let i = 0; i < count; i++) {
    let d = (i / count) * per;
    let x = 0, z = 0;
    const W = TABLE.halfW * 2 + 0.02, L = TABLE.halfL * 2 + 0.02;
    if (d < W) { x = -W / 2 + d; z = L / 2; }
    else if ((d -= W) < L) { x = W / 2; z = L / 2 - d; }
    else if ((d -= L) < W) { x = W / 2 - d; z = -L / 2; }
    else { d -= W; x = -W / 2; z = -L / 2 + d; }
    dm.position.set(x, TABLE.y - 0.425, z);
    dm.scale.set(1, 0.7, 1);
    dm.updateMatrix();
    hem.setMatrixAt(i, dm.matrix);
  }
  hem.castShadow = false;
  hem.receiveShadow = true;
  table.add(hem);
  // sage runner down the middle
  const runner = rbox(0.42, 0.006, TABLE.halfL * 2 - 0.3, 0.003, clay('#b9cfa0', { rough: 0.6, normal: 0.6 }), false);
  runner.position.y = TABLE.y + 0.003;
  table.add(runner);
  const topProxy = new THREE.Mesh(new THREE.BoxGeometry(TABLE.halfW * 2, 0.02, TABLE.halfL * 2), invisibleMat);
  topProxy.position.y = TABLE.y - 0.01;
  table.add(topProxy);
  const tableSurface = addSurface({ kind: 'table', proxy: topProxy, anchor: table, enabled: true, priority: 0 });
  // table cloth sides are landable too (fly can cling to the drape)
  const sideProxy = new THREE.Mesh(new THREE.BoxGeometry(TABLE.halfW * 2 + 0.01, 0.4, TABLE.halfL * 2 + 0.01), invisibleMat);
  sideProxy.position.y = TABLE.y - 0.22;
  table.add(sideProxy);
  addSurface({ kind: 'table', proxy: sideProxy, anchor: table, enabled: true, priority: 0 });

  mergeStatic(group);
  const gram = gramophone();
  gram.group.position.set(1.45, 0, -3.15);
  gram.group.rotation.y = -0.5;
  ctx.scene.add(gram.group);
  mergeStatic(gram.group);
  gram.group.updateMatrixWorld(true);
  const hornPivot = gram.surface.anchor;
  gram.hornMouth = hornPivot.localToWorld(new THREE.Vector3(0, 0.55, 0));

  void mesh;
  return { group, table, tableSurface, groundSurface, gramophone: gram, chairs: new Map() };
}
