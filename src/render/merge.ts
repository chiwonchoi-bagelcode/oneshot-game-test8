import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const KEEP = ['position', 'normal', 'uv'];

/**
 * Bake every static descendant mesh of `root` into one mesh per material
 * (draw-call diet for phones). Objects flagged `userData.noMerge` — and
 * anything beneath them — are left alone, as are invisible tap proxies.
 */
export function mergeStatic(root: THREE.Object3D, castShadow?: boolean) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const casts = new Map<THREE.Material, boolean>();
  const victims: THREE.Mesh[] = [];
  const walk = (o: THREE.Object3D) => {
    for (const ch of o.children) {
      if (ch.userData.noMerge) continue;
      const m = ch as THREE.Mesh;
      if (m.isMesh && !(m as unknown as THREE.InstancedMesh).isInstancedMesh && !Array.isArray(m.material) && (m.material as THREE.Material).visible && m.visible) {
        let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
        for (const k of Object.keys(g.attributes)) if (!KEEP.includes(k)) g.deleteAttribute(k);
        if (!g.attributes.normal) g.computeVertexNormals();
        if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
        const mtx = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld);
        g.applyMatrix4(mtx);
        if (mtx.determinant() < 0) g = flipWinding(g);
        g.morphAttributes = {};
        const mat = m.material as THREE.Material;
        if (!buckets.has(mat)) buckets.set(mat, []);
        buckets.get(mat)!.push(g);
        casts.set(mat, (casts.get(mat) ?? false) || m.castShadow);
        victims.push(m);
      }
      walk(ch);
    }
  };
  walk(root);
  if (victims.length < 2) return root;
  for (const v of victims) {
    // keep children that are not meshes (anchors, groups) attached to the root
    for (const ch of [...v.children]) root.attach(ch);
    v.parent?.remove(v);
  }
  for (const [mat, geos] of buckets) {
    const merged = mergeGeometries(geos, false);
    if (!merged) continue;
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = castShadow ?? casts.get(mat) ?? true;
    mesh.receiveShadow = true;
    root.add(mesh);
  }
  return root;
}

function flipWinding(g: THREE.BufferGeometry) {
  for (const k of Object.keys(g.attributes)) {
    const a = g.attributes[k] as THREE.BufferAttribute;
    const n = a.itemSize;
    const arr = a.array as Float32Array;
    for (let i = 0; i < a.count; i += 3) {
      for (let c = 0; c < n; c++) {
        const t = arr[(i + 1) * n + c];
        arr[(i + 1) * n + c] = arr[(i + 2) * n + c];
        arr[(i + 2) * n + c] = t;
      }
    }
    a.needsUpdate = true;
  }
  return g;
}

export function noMerge<T extends THREE.Object3D>(o: T): T {
  o.userData.noMerge = true;
  return o;
}
