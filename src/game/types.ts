import type * as THREE from 'three';
import type { Guest } from '../actors/guest';
import type { Item } from '../world/items';
import type { Butler } from '../actors/butler';

export type SurfaceKind =
  | 'table'
  | 'food'
  | 'glass'
  | 'cake'
  | 'jelly'
  | 'nose'
  | 'head'
  | 'hat'
  | 'toupee'
  | 'hand'
  | 'trumpet'
  | 'tray'
  | 'ground'
  | 'chair'
  | 'prop'
  | 'newspaper'
  | 'horn'
  | 'body';

export interface Surface {
  kind: SurfaceKind;
  /** Mesh hit by the tap raycast (often an invisible, generous proxy). */
  proxy: THREE.Mesh;
  /** The fly attaches (in local space) to this object while landed. */
  anchor: THREE.Object3D;
  guest?: Guest | null;
  butler?: Butler | null;
  item?: Item | null;
  enabled: boolean;
  /** Higher priority wins when two proxies are hit at nearly the same depth. */
  priority?: number;
}

export type GameEventType =
  | 'crash'
  | 'splat'
  | 'spill'
  | 'scream'
  | 'spit'
  | 'sneeze'
  | 'slap'
  | 'gag'
  | 'flee'
  | 'smack'
  | 'startle'
  | 'slip'
  | 'bang'
  | 'eatfly'
  | 'eatContam'
  | 'toupee'
  | 'tray'
  | 'swatMiss'
  | 'messOn';

export interface GameEvent {
  type: GameEventType;
  pos: THREE.Vector3;
  /** How attention-grabbing (0..1.5). */
  loud: number;
  /** Disgust added to a fully-sensitive witness who sees it. */
  gross: number;
  source?: Guest | Butler | null;
  victim?: Guest | null;
  /** Is the event a link in a player-caused chain? */
  chain?: boolean;
}

export type PrankId =
  | 'crosseye'
  | 'selfslap'
  | 'sneeze'
  | 'spittake'
  | 'friendlyfire'
  | 'jellyhat'
  | 'flysnack'
  | 'slip'
  | 'butler'
  | 'trumpet'
  | 'toupee'
  | 'domino'
  | 'scream'
  | 'tablebang'
  | 'cream'
  | 'gramophone'
  | 'gulp'
  | 'mouthescape'
  | 'cake';

export interface Impact {
  pos: THREE.Vector3;
  radius: number;
  strength: number;
  dir: THREE.Vector3;
  source: Guest | Butler | null;
  kind: 'swat' | 'flail' | 'bag' | 'slap' | 'land' | 'bump';
}
