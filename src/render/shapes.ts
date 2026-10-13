import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

const geoCache = new Map<string, THREE.BufferGeometry>();
function cached<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  let g = geoCache.get(key) as T | undefined;
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g;
}

export function sphereGeo(r = 1, w = 24, h = 16) {
  return cached(`s${r}_${w}_${h}`, () => new THREE.SphereGeometry(r, w, h));
}

export function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, shadow = true) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}

/** Ellipsoid blob. */
export function blob(rx: number, ry: number, rz: number, mat: THREE.Material, seg = 24, shadow = true) {
  const m = mesh(sphereGeo(1, seg, Math.max(8, Math.round(seg * 0.66))), mat, shadow);
  m.scale.set(rx, ry, rz);
  return m;
}

export function capsule(r: number, len: number, mat: THREE.Material, seg = 12, shadow = true) {
  const g = cached(`c${r}_${len}_${seg}`, () => new THREE.CapsuleGeometry(r, len, 4, seg));
  return mesh(g, mat, shadow);
}

export function cylinder(rt: number, rb: number, h: number, mat: THREE.Material, seg = 20, shadow = true, open = false) {
  const g = cached(`cy${rt}_${rb}_${h}_${seg}_${open}`, () => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open));
  return mesh(g, mat, shadow);
}

export function rbox(w: number, h: number, d: number, r: number, mat: THREE.Material, shadow = true) {
  const g = cached(`rb${w}_${h}_${d}_${r}`, () => new RoundedBoxGeometry(w, h, d, 3, r));
  return mesh(g, mat, shadow);
}

export function torus(r: number, tube: number, mat: THREE.Material, arc = Math.PI * 2, shadow = true) {
  const g = cached(`t${r}_${tube}_${arc}`, () => new THREE.TorusGeometry(r, tube, 10, 28, arc));
  return mesh(g, mat, shadow);
}

export function lathe(points: [number, number][], mat: THREE.Material, seg = 28, shadow = true) {
  const key = 'l' + JSON.stringify(points) + seg;
  const g = cached(key, () => new THREE.LatheGeometry(points.map(([x, y]) => new THREE.Vector2(x, y)), seg));
  return mesh(g, mat, shadow);
}

const _yAxis = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();
/** Orient a Y-aligned mesh so it spans from a to b (positions in parent space). */
export function placeBetween(m: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3) {
  _dir.subVectors(b, a);
  const len = _dir.length();
  m.position.addVectors(a, b).multiplyScalar(0.5);
  if (len > 1e-6) m.quaternion.setFromUnitVectors(_yAxis, _dir.multiplyScalar(1 / len));
  return len;
}

/** A flat disc lying on XZ plane (for decals / shadows / rings). */
export function flatDisc(r: number, mat: THREE.Material) {
  const g = cached(`fd${r}`, () => {
    const p = new THREE.PlaneGeometry(r * 2, r * 2);
    p.rotateX(-Math.PI / 2);
    return p;
  });
  const m = new THREE.Mesh(g, mat);
  m.receiveShadow = false;
  m.castShadow = false;
  return m;
}
