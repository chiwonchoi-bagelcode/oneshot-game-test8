import type { PrankId } from './types';

export interface PrankInfo {
  id: PrankId;
  name: string;
  desc: string;
  hint: string;
  points: number;
}

export const PRANKS: PrankInfo[] = [
  { id: 'crosseye', name: '사팔뜨기', desc: '코끝에 앉아 눈을 한가운데로 모았다', hint: '얼굴 한가운데, 가장 튀어나온 곳에 앉아 보면?', points: 50 },
  { id: 'selfslap', name: '제 뺨 찰싹', desc: '자기 얼굴을 스스로 후려치게 했다', hint: '코 위에서 버티다가, 손이 올라오면…', points: 120 },
  { id: 'sneeze', name: '재채기 폭탄', desc: '에취! 맞은편 음식에 재채기가 쏟아졌다', hint: '무던한 사람의 코는 간질간질에 약하다', points: 120 },
  { id: 'spittake', name: '와인 뿜기', desc: '마시는 순간 날아올라 와인을 뿜게 했다', hint: '잔 가장자리에서 기다려 보자', points: 150 },
  { id: 'friendlyfire', name: '엉뚱한 과녁', desc: '휘두른 무기가 엉뚱한 사람을 때렸다', hint: '옆 사람 머리 위에 앉으면 누가 때릴까?', points: 150 },
  { id: 'jellyhat', name: '젤리 모자', desc: '날아간 젤리가 누군가의 머리에 안착', hint: '젤리 위에 앉아 신문을 유도해 보자', points: 150 },
  { id: 'flysnack', name: '파리 반찬', desc: '파리가 앉았던 음식을 먹는 모습을 모두가 봤다', hint: '대식가의 접시에 앉아 사람들 눈에 띄어 보자', points: 120 },
  { id: 'mouthescape', name: '입속 탈출', desc: '포크에 실려 가다 입 바로 앞에서 탈출했다', hint: '접시 위에서 기다리면 포크가 데려다준다', points: 200 },
  { id: 'gulp', name: '꿀꺽!', desc: '먹혀 버렸다… 하지만 효과는 굉장했다', hint: '너무 오래 버티면…', points: 100 },
  { id: 'slip', name: '미끄덩!', desc: '쏟아진 와인에 누군가 미끄러졌다', hint: '식탁 가장자리의 잔을 쓰러뜨리면 잔디에 웅덩이가…', points: 180 },
  { id: 'butler', name: '집사 와르르', desc: '집사의 쟁반이 하늘을 날았다', hint: '집사의 코, 혹은 발밑을 노려라', points: 200 },
  { id: 'trumpet', name: '보청 나팔 대소동', desc: '나팔 속 윙윙 소리에 할머니가 펄쩍', hint: '귀 어두운 할머니가 귀에 대고 있는 그것', points: 180 },
  { id: 'toupee', name: '가발 실종', desc: '멋쟁이의 가발이 날아갔다', hint: '멋쟁이의 머리 위에 앉아 누군가의 매를 부르자', points: 200 },
  { id: 'domino', name: '도미노 구역질', desc: '한 사람이 떠나자 연달아 또 한 사람이', hint: '질린 사람을 보면 옆 사람도 질린다', points: 250 },
  { id: 'scream', name: '비명 경보', desc: '결벽증 비명에 모두가 돌아봤다', hint: '가장 예민한 손님을 놀래 보자', points: 80 },
  { id: 'tablebang', name: '식탁 쿵!', desc: '식탁이 들썩, 잔들이 와르르', hint: '세게 내려치는 무기는 식탁 전체를 흔든다', points: 120 },
  { id: 'cream', name: '크림 세례', desc: '케이크가 얻어맞아 크림이 튀었다', hint: '케이크 근처에서 신문을 유도하면?', points: 150 },
  { id: 'gramophone', name: '축음기 확성기', desc: '축음기 나팔로 윙윙 소리를 키웠다', hint: '소리를 크게 키워 주는 금빛 나팔이 있다', points: 150 },
];

export const PRANK_BY_ID = new Map(PRANKS.map((p) => [p.id, p]));
