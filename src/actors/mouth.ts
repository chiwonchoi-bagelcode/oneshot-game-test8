import * as THREE from 'three';

/**
 * A procedurally-shaped mouth that hugs the front of an ellipsoid head.
 * Wide Aardman grin, tight disgusted line, wobbling nausea, or a big gaping O.
 */
export class Mouth {
  readonly mesh: THREE.Mesh;
  smile = 0.4;
  open = 0;
  wobble = 0;
  pucker = 0;
  /** Lower-lip push (pout) */
  teeth = true;
  private geo: THREE.BufferGeometry;
  private N = 18;
  private last = '';

  constructor(
    private width: number,
    private y: number,
    private surf: (x: number, y: number) => number,
  ) {
    const N = this.N;
    this.geo = new THREE.BufferGeometry();
    // rows: upper lip outer, upper inner(teeth bottom), lower inner, lower outer
    const verts = new Float32Array((N + 1) * 4 * 3);
    const cols = new Float32Array((N + 1) * 4 * 3);
    this.geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    const idx: number[] = [];
    for (let i = 0; i < N; i++) {
      for (let r = 0; r < 3; r++) {
        const a = r * (N + 1) + i;
        const b = (r + 1) * (N + 1) + i;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    this.geo.setIndex(idx);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.castShadow = false;
    this.mesh.renderOrder = 1;
    this.update(0);
  }

  update(t: number) {
    const key = [this.smile, this.open, this.wobble, this.pucker].map((v) => v.toFixed(3)).join() + (this.wobble > 0.01 ? Math.floor(t * 30) : '');
    if (key === this.last) return;
    this.last = key;
    const N = this.N;
    const pos = this.geo.attributes.position as THREE.BufferAttribute;
    const col = this.geo.attributes.color as THREE.BufferAttribute;
    const W = this.width * (1 - this.pucker * 0.62) * (1 + this.open * 0.08);
    const lip = 0.006;
    const dark = new THREE.Color('#3b0d10');
    const tongue = new THREE.Color('#a8374a');
    const white = new THREE.Color('#fbf7ee');
    for (let i = 0; i <= N; i++) {
      const u = (i / N) * 2 - 1;
      const x = (u * W) / 2;
      const prof = Math.pow(Math.max(0, 1 - u * u), 0.75);
      const yc = this.smile * 0.32 * W * (u * u - 0.35) + this.wobble * 0.05 * W * Math.sin(u * Math.PI * 2.6 + t * 9) - this.pucker * 0.0;
      const openU = this.open * W * (0.1 + this.pucker * 0.25) * prof;
      const openL = this.open * W * (0.42 + this.pucker * 0.2) * prof;
      const yUo = yc + openU + lip;
      const yLo = yc - openL - lip;
      const teethH = this.teeth ? Math.min(openU + openL, W * 0.09) * (1 - this.pucker) * (Math.abs(u) < 0.8 ? 1 : 0.2) : 0;
      const yUi = yc + openU - teethH;
      const yLi = yc - openL * 0.15;
      const rows = [yUo, yUi, yLi, yLo];
      for (let r = 0; r < 4; r++) {
        const yy = this.y + rows[r];
        const z = this.surf(x, yy) + 0.003;
        const k = r * (N + 1) + i;
        pos.setXYZ(k, x, yy, z);
        const c = r === 0 ? white : r === 1 ? (teethH > 0.0005 ? dark : dark) : r === 2 ? tongue : dark;
        col.setXYZ(k, c.r, c.g, c.b);
      }
      // row 0..1 band = teeth (white), so colour row0 and row1 white when teeth visible
      if (teethH > 0.0005) {
        col.setXYZ(0 * (N + 1) + i, white.r, white.g, white.b);
        col.setXYZ(1 * (N + 1) + i, white.r * 0.92, white.g * 0.9, white.b * 0.85);
      } else {
        col.setXYZ(0 * (N + 1) + i, dark.r, dark.g, dark.b);
        col.setXYZ(1 * (N + 1) + i, dark.r, dark.g, dark.b);
      }
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    this.geo.computeVertexNormals();
    this.geo.computeBoundingSphere();
  }
}
