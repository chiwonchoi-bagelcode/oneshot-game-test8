import * as THREE from 'three';
import { rand, randRange } from '../core/math';

function canvas(w: number, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function tex(c: HTMLCanvasElement, srgb = true, repeat = false) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
  }
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

/**
 * Tileable "modelling clay" normal map: soft lumps, thumb-print ridges and
 * tool smudges. This is the single most important ingredient for the
 * hand-made plasticine look.
 */
export function makeClayNormal(size = 256): THREE.Texture {
  const h = new Float32Array(size * size);
  const add = (x: number, y: number, v: number) => {
    const xi = ((x % size) + size) % size;
    const yi = ((y % size) + size) % size;
    h[yi * size + xi] += v;
  };
  // Soft lumps
  for (let i = 0; i < 60; i++) {
    const cx = rand() * size, cy = rand() * size;
    const r = randRange(10, 34);
    const a = randRange(-0.6, 0.6);
    for (let y = -r; y <= r; y++)
      for (let x = -r; x <= r; x++) {
        const d = Math.sqrt(x * x + y * y) / r;
        if (d < 1) add(Math.round(cx + x), Math.round(cy + y), a * (1 - d * d) * (1 - d * d));
      }
  }
  // Thumb prints: concentric elliptical ridges
  for (let i = 0; i < 14; i++) {
    const cx = rand() * size, cy = rand() * size;
    const r = randRange(14, 30);
    const ang = rand() * Math.PI;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const freq = randRange(1.4, 2.0);
    const amp = randRange(0.08, 0.16);
    for (let y = -r; y <= r; y++)
      for (let x = -r; x <= r; x++) {
        const u = (x * ca + y * sa) / 1.0;
        const v = (-x * sa + y * ca) / 0.65;
        const d = Math.sqrt(u * u + v * v);
        if (d < r) {
          const f = 1 - d / r;
          add(Math.round(cx + x), Math.round(cy + y), Math.sin(d * freq) * amp * f * f);
        }
      }
  }
  // Tool smudges (short strokes)
  for (let i = 0; i < 40; i++) {
    let x = rand() * size, y = rand() * size;
    const ang = rand() * Math.PI * 2;
    const len = randRange(8, 26);
    const amp = randRange(-0.25, 0.25);
    for (let s = 0; s < len; s++) {
      x += Math.cos(ang);
      y += Math.sin(ang);
      for (let k = -2; k <= 2; k++) add(Math.round(x - Math.sin(ang) * k), Math.round(y + Math.cos(ang) * k), amp * (1 - Math.abs(k) / 3) * 0.4);
    }
  }
  // Fine grain
  for (let i = 0; i < size * size; i++) h[i] += (rand() - 0.5) * 0.04;

  const c = canvas(size);
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const s = 2.2;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const l = h[y * size + ((x - 1 + size) % size)];
      const r = h[y * size + ((x + 1) % size)];
      const u = h[((y - 1 + size) % size) * size + x];
      const d = h[((y + 1) % size) * size + x];
      let nx = (l - r) * s, ny = (u - d) * s, nz = 1;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx /= len; ny /= len; nz /= len;
      const i = (y * size + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  return tex(c, false, true);
}

export function makeLawnTexture(): THREE.Texture {
  const c = canvas(512);
  const ctx = c.getContext('2d')!;
  const stripes = 4;
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 ? '#6f9a3c' : '#7fab45';
    ctx.fillRect(0, (i * 512) / stripes, 512, 512 / stripes);
  }
  for (let i = 0; i < 9000; i++) {
    const x = rand() * 512, y = rand() * 512;
    ctx.fillStyle = rand() < 0.5 ? 'rgba(60,95,30,0.25)' : 'rgba(160,200,90,0.22)';
    ctx.fillRect(x, y, 1.5, randRange(2, 5));
  }
  // Tiny daisies
  for (let i = 0; i < 26; i++) {
    const x = rand() * 512, y = rand() * 512;
    ctx.fillStyle = 'rgba(255,255,245,0.9)';
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * 2.2, y + Math.sin(a) * 2.2, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#f2c230';
    ctx.beginPath();
    ctx.arc(x, y, 1.4, 0, Math.PI * 2);
    ctx.fill();
  }
  return tex(c, true, true);
}

export function makeGravelTexture(): THREE.Texture {
  const c = canvas(256);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#d8c7a2';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) {
    const x = rand() * 256, y = rand() * 256;
    const g = Math.floor(randRange(170, 235));
    ctx.fillStyle = `rgb(${g},${g - 14},${g - 40})`;
    ctx.beginPath();
    ctx.ellipse(x, y, randRange(1, 2.6), randRange(0.8, 2), rand() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  return tex(c, true, true);
}

export function makeClothTexture(): THREE.Texture {
  const c = canvas(256);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fbf6ec';
  ctx.fillRect(0, 0, 256, 256);
  // subtle damask diamonds
  ctx.strokeStyle = 'rgba(214,200,175,0.45)';
  ctx.lineWidth = 2;
  for (let y = 0; y <= 256; y += 64)
    for (let x = 0; x <= 256; x += 64) {
      ctx.beginPath();
      ctx.moveTo(x, y - 22);
      ctx.quadraticCurveTo(x + 14, y, x, y + 22);
      ctx.quadraticCurveTo(x - 14, y, x, y - 22);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x + 32, y + 32, 5, 0, Math.PI * 2);
      ctx.stroke();
    }
  for (let i = 0; i < 3000; i++) {
    ctx.fillStyle = rand() < 0.5 ? 'rgba(0,0,0,0.025)' : 'rgba(255,255,255,0.05)';
    ctx.fillRect(rand() * 256, rand() * 256, 2, 2);
  }
  return tex(c, true, true);
}

export function makeNewsprintTexture(): THREE.Texture {
  const c = canvas(256, 320);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ece4cf';
  ctx.fillRect(0, 0, 256, 320);
  ctx.fillStyle = '#2b2620';
  ctx.font = 'bold 34px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.fillText('THE TIMES', 128, 40);
  ctx.fillRect(12, 50, 232, 3);
  ctx.font = 'bold 16px Georgia, serif';
  ctx.fillText('FLY MENACE GRIPS SHIRE', 128, 76);
  ctx.fillStyle = 'rgba(40,35,30,0.55)';
  for (let col = 0; col < 3; col++) {
    for (let y = 92; y < 305; y += 7) {
      const w = randRange(48, 72);
      ctx.fillRect(14 + col * 78, y, w, 3);
    }
  }
  ctx.fillStyle = 'rgba(60,55,50,0.6)';
  ctx.fillRect(92, 120, 72, 56);
  return tex(c);
}

export function makeWingTexture(): THREE.Texture {
  const c = canvas(128, 64);
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 128, 0);
  g.addColorStop(0, 'rgba(200,215,230,0.75)');
  g.addColorStop(1, 'rgba(230,240,255,0.35)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(64, 32, 62, 28, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(60,50,40,0.75)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    ctx.moveTo(4, 32);
    ctx.quadraticCurveTo(60, 32 + (i - 2) * 6, 124, 32 + (i - 2) * 11);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(60, 12);
  ctx.lineTo(70, 52);
  ctx.moveTo(92, 10);
  ctx.lineTo(96, 54);
  ctx.stroke();
  return tex(c);
}

/** Soft radial alpha blob (shadows, glows). */
export function makeBlobTexture(inner = 'rgba(0,0,0,0.55)', outer = 'rgba(0,0,0,0)'): THREE.Texture {
  const c = canvas(128);
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return tex(c);
}

/** Irregular splat silhouette in white; tint via material color. */
export function makeSplatTexture(seedShift = 0): THREE.Texture {
  const c = canvas(128);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  const n = 14;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = 34 + rand() * 18 + (i % 3 === seedShift % 3 ? 8 : 0);
    const x = 64 + Math.cos(a) * r, y = 64 + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.quadraticCurveTo(64 + Math.cos(a - 0.2) * (r + 10), 64 + Math.sin(a - 0.2) * (r + 10), x, y);
  }
  ctx.fill();
  for (let i = 0; i < 7; i++) {
    const a = rand() * Math.PI * 2;
    const r = randRange(48, 60);
    ctx.beginPath();
    ctx.arc(64 + Math.cos(a) * r, 64 + Math.sin(a) * r, randRange(2.5, 6), 0, Math.PI * 2);
    ctx.fill();
  }
  return tex(c);
}

export function makeRingTexture(): THREE.Texture {
  const c = canvas(128);
  const ctx = c.getContext('2d')!;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.arc(64, 64, 52, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 4;
  ctx.setLineDash([10, 10]);
  ctx.beginPath();
  ctx.arc(64, 64, 34, 0, Math.PI * 2);
  ctx.stroke();
  return tex(c);
}

export function makeGlintTexture(): THREE.Texture {
  const c = canvas(64);
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(190,230,255,0.6)');
  g.addColorStop(1, 'rgba(120,180,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.beginPath();
  ctx.moveTo(32, 0); ctx.lineTo(34, 30); ctx.lineTo(64, 32); ctx.lineTo(34, 34);
  ctx.lineTo(32, 64); ctx.lineTo(30, 34); ctx.lineTo(0, 32); ctx.lineTo(30, 30);
  ctx.closePath();
  ctx.fill();
  return tex(c);
}

export function makeStripeTexture(a: string, b: string, n = 8): THREE.Texture {
  const c = canvas(128);
  const ctx = c.getContext('2d')!;
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = i % 2 ? a : b;
    ctx.fillRect((i * 128) / n, 0, 128 / n, 128);
  }
  return tex(c, true, true);
}

export function makeTweedTexture(base: string, fleck: string): THREE.Texture {
  const c = canvas(128);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 128, 128);
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = fleck;
  for (let i = 0; i < 128; i += 6) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 128); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(128, i); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  return tex(c, true, true);
}

export function makeTextSprite(text: string, color = '#ffffff', font = 'bold 64px Georgia, serif'): THREE.Texture {
  const c = canvas(256, 128);
  const ctx = c.getContext('2d')!;
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 10;
  ctx.strokeStyle = 'rgba(40,20,10,0.9)';
  ctx.strokeText(text, 128, 64);
  ctx.fillStyle = color;
  ctx.fillText(text, 128, 64);
  return tex(c);
}
