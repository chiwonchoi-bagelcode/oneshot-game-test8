import type * as THREE from 'three';
import type { Stage } from '../render/stage';
import type { Surface, GameEvent, PrankId } from './types';
import type { Guest } from '../actors/guest';
import type { Butler } from '../actors/butler';
import type { Item } from '../world/items';
import type { Fly } from '../fly/fly';
import type { Mess } from '../world/mess';
import type { AudioEngine } from '../audio/audio';
import type { Game } from './game';
import type { Garden } from '../world/garden';

export interface Ctx {
  stage: Stage;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  time: number;
  surfaces: Surface[];
  items: Item[];
  guests: Guest[];
  butler: Butler;
  fly: Fly;
  mess: Mess;
  audio: AudioEngine;
  game: Game;
  garden: Garden;
  emit: (e: GameEvent) => void;
  prank: (id: PrankId, pos?: THREE.Vector3) => void;
  /** Global time-scale for slow-mo beats. */
  timeScale: number;
  /** Run `fn` after `sec` seconds of game time (respects pause and slow-motion). */
  later: (sec: number, fn: () => void) => void;
}

export const ctx = {} as Ctx;

export function addSurface(s: Surface) {
  ctx.surfaces.push(s);
  s.proxy.userData.surface = s;
  return s;
}

export function removeSurface(s: Surface) {
  s.enabled = false;
  const i = ctx.surfaces.indexOf(s);
  if (i >= 0) ctx.surfaces.splice(i, 1);
}

export const TABLE = {
  y: 0.78,
  halfW: 0.6,
  halfL: 1.78,
};
