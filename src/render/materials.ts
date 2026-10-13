import * as THREE from 'three';
import { makeClayNormal } from './textures';

let clayNormal: THREE.Texture | null = null;
const normalByRepeat = new Map<number, THREE.Texture>();
const cache = new Map<string, THREE.Material>();

function normalMap(repeat: number) {
  if (!clayNormal) clayNormal = makeClayNormal(256);
  let t = normalByRepeat.get(repeat);
  if (!t) {
    t = clayNormal.clone();
    t.repeat.set(repeat, repeat);
    t.needsUpdate = true;
    normalByRepeat.set(repeat, t);
  }
  return t;
}

export interface ClayOpts {
  rough?: number;
  metal?: number;
  normal?: number;
  repeat?: number;
  map?: THREE.Texture | null;
  emissive?: THREE.ColorRepresentation;
  emissiveIntensity?: number;
  transparent?: boolean;
  opacity?: number;
  side?: THREE.Side;
  envI?: number;
  flat?: boolean;
}

/** Glossy modelling-clay material. Shared (cached) unless `unique` is used. */
export function clay(color: THREE.ColorRepresentation, o: ClayOpts = {}): THREE.MeshStandardMaterial {
  const key = JSON.stringify([new THREE.Color(color).getHex(), o.rough, o.metal, o.normal, o.repeat, o.map?.uuid, o.emissive, o.transparent, o.opacity, o.side, o.envI]);
  const hit = cache.get(key);
  if (hit) return hit as THREE.MeshStandardMaterial;
  const m = clayUnique(color, o);
  cache.set(key, m);
  return m;
}

export function clayUnique(color: THREE.ColorRepresentation, o: ClayOpts = {}): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    color,
    roughness: o.rough ?? 0.46,
    metalness: o.metal ?? 0.0,
    map: o.map ?? null,
    transparent: o.transparent ?? false,
    opacity: o.opacity ?? 1,
    side: o.side ?? THREE.FrontSide,
    envMapIntensity: o.envI ?? 0.75,
  });
  if (!o.flat) {
    m.normalMap = normalMap(o.repeat ?? 1.5);
    const n = o.normal ?? 0.45;
    m.normalScale.set(n, n);
  }
  if (o.emissive !== undefined) {
    m.emissive = new THREE.Color(o.emissive);
    m.emissiveIntensity = o.emissiveIntensity ?? 1;
  }
  return m;
}

/** Skin uses a physical material with a faint clearcoat: the "freshly handled clay" sheen. */
export function skinMaterial(color: THREE.ColorRepresentation) {
  const m = new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.5,
    clearcoat: 0.35,
    clearcoatRoughness: 0.45,
    envMapIntensity: 0.7,
  });
  m.normalMap = normalMap(1.2);
  m.normalScale.set(0.4, 0.4);
  return m;
}

export function glassMaterial(tint: THREE.ColorRepresentation = 0xe8f4ff) {
  const key = 'glass' + new THREE.Color(tint).getHex();
  const hit = cache.get(key);
  if (hit) return hit as THREE.MeshPhysicalMaterial;
  const m = new THREE.MeshPhysicalMaterial({
    color: tint,
    roughness: 0.08,
    metalness: 0,
    transparent: true,
    opacity: 0.38,
    envMapIntensity: 1.6,
    clearcoat: 1,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  cache.set(key, m);
  return m;
}

export const invisibleMat = new THREE.MeshBasicMaterial({ visible: false });
