import type { GuestId } from '../world/layout';

export type Weapon = 'newspaper' | 'cane' | 'fan' | 'handbag' | 'hand' | 'flail';

export interface Personality {
  name: string;
  title: string;
  blurb: string;
  /** Multiplier on all disgust ("질림") gains. */
  fedMul: number;
  /** Multiplier on disgust from witnessing others' misfortune. */
  sympathy: number;
  hearing: number;
  irritability: number;
  /** Irritation level at which they strike. */
  swatAt: number;
  windup: number;
  weapon: Weapon;
  reach: number;
  hitR: number;
  cooldown: number;
  eatEvery: [number, number];
  drinkEvery: [number, number];
  noseReact: 'slap' | 'sneeze' | 'flail';
  voice: number;
  headTurn: number;
  /** Extra multiplier for mess landing on their own person. */
  vanity: number;
  glutton?: boolean;
  dozes?: boolean;
  reads?: boolean;
  hostess?: boolean;
  squeamish?: boolean;
  bald?: boolean;
}

export const PERSONALITIES: Record<GuestId, Personality> = {
  colonel: {
    name: '크럼프 대령', title: '깐깐한 퇴역 대령', blurb: '금방 질리지만 신문 반격이 번개 같다',
    fedMul: 1.3, sympathy: 0.8, hearing: 1.1, irritability: 1.5, swatAt: 0.42, windup: 0.66, weapon: 'newspaper', reach: 1.05, hitR: 0.13,
    cooldown: 1.1, eatEvery: [7, 12], drinkEvery: [9, 15], noseReact: 'slap', voice: 92, headTurn: 9, vanity: 1, reads: true,
  },
  reverend: {
    name: '플럼트리 목사', title: '무던한 대식가', blurb: '좀처럼 질리지 않는다. 대신 그가 먹는 모습이…',
    fedMul: 0.4, sympathy: 0.45, hearing: 0.75, irritability: 0.45, swatAt: 0.9, windup: 1.05, weapon: 'hand', reach: 0.55, hitR: 0.1,
    cooldown: 3, eatEvery: [3.5, 6], drinkEvery: [8, 13], noseReact: 'sneeze', voice: 118, headTurn: 4, vanity: 0.8, glutton: true, bald: true,
  },
  granny: {
    name: '그림스비 노부인', title: '귀 어두운 노부인', blurb: '꾸벅꾸벅 존다. 보청 나팔만은 조심',
    fedMul: 0.95, sympathy: 0.9, hearing: 0.18, irritability: 1.0, swatAt: 0.55, windup: 1.05, weapon: 'handbag', reach: 0.78, hitR: 0.22,
    cooldown: 2.2, eatEvery: [8, 14], drinkEvery: [9, 15], noseReact: 'sneeze', voice: 245, headTurn: 3.5, vanity: 1, dozes: true,
  },
  prudence: {
    name: '프루던스 양', title: '결벽증 노처녀', blurb: '가장 먼저 질린다. 비명과 허우적거림 주의',
    fedMul: 1.75, sympathy: 1.5, hearing: 1.3, irritability: 1.7, swatAt: 0.48, windup: 0.3, weapon: 'flail', reach: 0.62, hitR: 0.12,
    cooldown: 2.6, eatEvery: [9, 14], drinkEvery: [7, 12], noseReact: 'flail', voice: 330, headTurn: 10, vanity: 1.2, squeamish: true,
  },
  dandy: {
    name: '폽스워스 경', title: '허영심 많은 멋쟁이', blurb: '하얀 양복에 얼룩이 묻는 걸 못 견딘다',
    fedMul: 1.0, sympathy: 0.9, hearing: 1.0, irritability: 1.1, swatAt: 0.55, windup: 0.85, weapon: 'cane', reach: 1.12, hitR: 0.12,
    cooldown: 1.6, eatEvery: [8, 13], drinkEvery: [7, 12], noseReact: 'slap', voice: 140, headTurn: 7, vanity: 2.2,
  },
  hostess: {
    name: '하이아신스 부인', title: '파티의 안주인', blurb: '체면이 무너질수록 무너진다',
    fedMul: 0.8, sympathy: 1.0, hearing: 0.9, irritability: 1.0, swatAt: 0.6, windup: 0.55, weapon: 'fan', reach: 0.72, hitR: 0.11,
    cooldown: 1.4, eatEvery: [10, 16], drinkEvery: [8, 14], noseReact: 'slap', voice: 215, headTurn: 6, vanity: 1.4, hostess: true,
  },
};
