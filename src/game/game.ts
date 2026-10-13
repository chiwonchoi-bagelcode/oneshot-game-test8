import * as THREE from 'three';
import { ctx, TABLE } from './ctx';
import type { GameEvent, PrankId, Surface } from './types';
import { buildScene, Stage } from '../render/stage';
import { buildGarden, buildChair } from '../world/garden';
import { Mess } from '../world/mess';
import { SEATS } from '../world/layout';
import { CakeItem, JellyItem, StandItem, TeapotItem, VaseItem } from '../world/items';
import { Guest } from '../actors/guest';
import { Butler } from '../actors/butler';
import { Fly, TapTarget } from '../fly/fly';
import { CameraRig } from './camera';
import { PRANK_BY_ID, PRANKS } from './pranks';
import type { Hud } from '../ui/hud';
import { clamp, clamp01, damp, V3, pick } from '../core/math';

export type Phase = 'title' | 'intro' | 'play' | 'victory' | 'lose' | 'timeup';

export interface Results {
  win: boolean;
  reason: 'cake' | 'swat' | 'gulp' | 'time';
  time: number;
  lives: number;
  maxChain: number;
  closeCalls: number;
  pranks: Set<PrankId>;
  score: number;
  gone: number;
  culprit?: string;
}

export const DURATION = 420; // 3:00pm → 5:00pm

/** Korean subject particle: 이 after a final consonant, 가 otherwise. */
function iga(word: string) {
  const c = word.charCodeAt(word.length - 1);
  if (c < 0xac00 || c > 0xd7a3) return word + '이(가)';
  return word + ((c - 0xac00) % 28 ? '이' : '가');
}

export class Game {
  phase: Phase = 'title';
  lives = 3;
  clock = 0;
  cakeOpen = false;
  pranksFound = new Set<PrankId>();
  chain = 0;
  private chainT = -9;
  maxChain = 0;
  score = 0;
  closeCalls = 0;
  goneCount = 0;
  private lastFleeT = -99;
  readonly cam = new CameraRig();
  cake!: CakeItem;
  hornBlast = false;
  private hornT = 0;
  private phaseT = 0;
  private slowmo = 0;
  private hintFlags = new Set<string>();
  private nextTip = 45;
  private lastPrankT = 0;
  private raycaster = new THREE.Raycaster();
  private results: Results | null = null;
  private warned = false;
  private timers: { at: number; fn: () => void }[] = [];

  constructor(private stage: Stage, private hud: Hud) {
    ctx.game = this;
    ctx.emit = (e) => this.emit(e);
    ctx.prank = (id, pos) => this.prank(id, pos);
    ctx.later = (sec, fn) => this.timers.push({ at: ctx.time + sec, fn });
    this.build();
    stage.container.addEventListener('pointerdown', (e) => this.onPointer(e), { passive: false });
  }

  // ---------------------------------------------------------------------------
  build() {
    ctx.surfaces = [];
    ctx.items = [];
    ctx.guests = [];
    this.timers = [];
    ctx.time = 0;
    ctx.timeScale = 1;
    buildScene(this.stage);
    ctx.stage = this.stage;
    ctx.scene = this.stage.scene;
    ctx.camera = this.stage.camera;
    ctx.garden = buildGarden();
    ctx.mess = new Mess();
    for (const seat of SEATS) {
      const chair = buildChair(seat.id === 'hostess' ? 'throne' : 'garden');
      chair.position.set(seat.x, 0, seat.z);
      chair.rotation.y = seat.yaw;
      ctx.scene.add(chair);
      const g = new Guest(seat);
      g.chair = chair;
      ctx.guests.push(g);
    }
    for (const g of ctx.guests) g.setupItems();
    this.cake = new CakeItem().place(0, -0.32);
    ctx.items.push(
      this.cake,
      new JellyItem('#5fbf3a').place(0.1, 0.3),
      new JellyItem('#e0304a').place(-0.18, -1.55),
      new StandItem().place(0.26, -1.32),
      new TeapotItem().place(0.22, 1.3),
      new VaseItem().place(-0.12, 0.72),
    );
    ctx.butler = new Butler();
    ctx.fly = new Fly();
    ctx.fly.root.visible = false;
    this.cam.setMode('title');
    this.phase = 'title';
    this.lives = 3;
    this.clock = 0;
    this.cakeOpen = false;
    this.pranksFound = new Set();
    this.chain = 0;
    this.chainT = -9;
    this.hornT = 0;
    this.maxChain = 0;
    this.score = 0;
    this.closeCalls = 0;
    this.goneCount = 0;
    this.lastFleeT = -99;
    this.hintFlags.clear();
    this.nextTip = 45;
    this.lastPrankT = 0;
    this.results = null;
    this.warned = false;
    this.slowmo = 0;
    this.hud.reset();
  }

  reset() {
    // free GPU buffers of the old scene; shared geometries are simply re-uploaded when reused
    const seen = new Set<THREE.BufferGeometry>();
    this.stage.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.geometry && !seen.has(m.geometry)) {
        seen.add(m.geometry);
        m.geometry.dispose();
      }
    });
    this.stage.sun.shadow.map?.dispose();
    this.stage.sun.dispose();
    this.build();
  }

  // ---------------------------------------------------------------------------
  start() {
    if (this.phase !== 'title') return;
    this.phase = 'intro';
    this.phaseT = 0;
    this.cam.setMode('intro');
    const fly = ctx.fly;
    fly.root.visible = true;
    fly.pos.set(1.4, 2.6, 3.4);
    fly.state = 'hover';
    const land = this.surfacePoint(ctx.garden.tableSurface, V3(0.08, TABLE.y, 1.05));
    fly.flyTo(land);
    ctx.audio.startMusic();
    this.hud.showHUD(true);
  }

  private surfacePoint(s: Surface, p: THREE.Vector3): TapTarget {
    return { point: p.clone(), normal: V3(0, 1, 0), surface: s };
  }

  get inPlay() {
    return this.phase === 'play';
  }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------
  private onPointer(e: PointerEvent) {
    if (e.button !== undefined && e.button > 0) return;
    if (!e.isPrimary) return;
    e.preventDefault();
    ctx.audio.unlock();
    if (this.phase === 'title') return;
    if (this.phase !== 'play' && this.phase !== 'intro') return;
    const fly = ctx.fly;
    if (!fly.canControl) return;
    if (this.phase === 'intro' && fly.state === 'flying') return;
    const rect = this.stage.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.tapAt(ndc);
  }

  /** Public so automated tests can drive the fly. */
  tapAt(ndc: THREE.Vector2) {
    const fly = ctx.fly;
    this.raycaster.setFromCamera(ndc, ctx.camera);
    const proxies: THREE.Object3D[] = [];
    for (const s of ctx.surfaces) if (s.enabled) proxies.push(s.proxy);
    const hits = this.raycaster.intersectObjects(proxies, false);
    let chosen: THREE.Intersection | null = null;
    if (hits.length) {
      const d0 = hits[0].distance;
      let best = -1;
      for (const h of hits) {
        const s = h.object.userData.surface as Surface;
        const pr = s.priority ?? 1;
        // noses are tiny and precious: be generous with them
        if (h.distance > d0 + (pr >= 5 ? 0.16 : 0.05)) continue;
        if (pr > best) {
          best = pr;
          chosen = h;
        }
      }
    }
    if (chosen) {
      const s = chosen.object.userData.surface as Surface;
      const n = chosen.face ? chosen.face.normal.clone().transformDirection(chosen.object.matrixWorld) : V3(0, 1, 0);
      const p = chosen.point.clone();
      if (s.kind === 'ground') {
        p.x = clamp(p.x, -3.0, 3.0);
        p.z = clamp(p.z, -3.8, 3.0);
        p.y = 0;
        n.set(0, 1, 0);
      }
      fly.flyTo({ point: p, normal: n, surface: s });
    } else {
      // empty air: hover (buzzing!) where the ray crosses head height
      const plane = new THREE.Plane(V3(0, 1, 0), -1.15);
      const p = V3();
      if (!this.raycaster.ray.intersectPlane(plane, p)) return;
      p.x = clamp(p.x, -2.8, 2.8);
      p.z = clamp(p.z, -3.6, 3.0);
      fly.flyTo(null, p);
    }
    ctx.audio.tap();
    if (!this.hintFlags.has('tapped')) {
      this.hintFlags.add('tapped');
      this.hud.hint('');
    }
  }

  // ---------------------------------------------------------------------------
  // Events & scoring
  // ---------------------------------------------------------------------------
  private emit(e: GameEvent) {
    for (const g of ctx.guests) g.onEvent(e);
    if (e.loud > 0.8 && e.type !== 'gag') this.cam.nudge(e.pos, 1.2);
  }

  prank(id: PrankId, pos?: THREE.Vector3) {
    if (this.phase !== 'play') return;
    const info = PRANK_BY_ID.get(id);
    if (!info) return;
    const first = !this.pranksFound.has(id);
    this.pranksFound.add(id);
    this.score += first ? info.points : Math.round(info.points * 0.25);
    this.lastPrankT = this.clock;
    this.nextTip = Math.max(this.nextTip, this.clock + 40);
    this.hud.prank(info, first, pos ? this.toScreen(pos) : null);
    if (first) ctx.audio.sfx('discover');
  }

  chainHit(_victim: Guest | null, pos: THREE.Vector3) {
    if (this.phase !== 'play') return;
    if (ctx.time - this.chainT < 3.5) this.chain++;
    else this.chain = 1;
    this.chainT = ctx.time;
    this.maxChain = Math.max(this.maxChain, this.chain);
    this.score += 20 * this.chain;
    if (this.chain >= 2) {
      this.hud.chain(this.chain, this.toScreen(pos));
      ctx.audio.sfx('chain', undefined, Math.min(1, 0.4 + this.chain * 0.1));
    }
  }

  toScreen(p: THREE.Vector3) {
    const v = p.clone().project(ctx.camera);
    const r = this.stage.renderer.domElement.getBoundingClientRect();
    return { x: (v.x * 0.5 + 0.5) * r.width, y: (-v.y * 0.5 + 0.5) * r.height, behind: v.z > 1 };
  }

  shake(a: number) {
    this.cam.shake(a);
  }

  // ---------------------------------------------------------------------------
  // Callbacks from actors
  // ---------------------------------------------------------------------------
  onFlyTakeoff(_s: Surface | null) {}

  onFlyLanded(s: Surface) {
    if (this.phase === 'intro') {
      this.phase = 'play';
      this.cam.setMode('follow');
      this.hud.hint('식탁 위 원하는 곳을 탭하면 그곳으로 쌩 날아갑니다');
      return;
    }
    if (this.phase !== 'play') return;
    if (this.cakeOpen && s.kind === 'cake') {
      this.victory();
      return;
    }
    if (!this.hintFlags.has('landed') && this.hintFlags.has('tapped')) {
      this.hintFlags.add('landed');
      this.hud.hint('윙윙 소리는 손님들 귀에 들립니다. 앉아 있는 동안은 조용해요', 4.5);
    }
    if (s.item?.isFood && s.item.owner && !this.hintFlags.has('food')) {
      this.hintFlags.add('food');
      ctx.later(1.2, () => this.phase === 'play' && this.hud.hint('주인이 음식 위의 파리를 보면 점점 질려요 — 초록 게이지가 차면 자리를 뜹니다', 5));
    }
  }

  flyHit(by: Guest | null) {
    if (this.phase !== 'play') return;
    this.lives--;
    this.hud.lives(this.lives, true);
    ctx.audio.sfx('squish');
    this.cam.shake(0.6);
    this.slowmo = 0.5;
    if (by) ctx.audio.voice(by, 'laugh');
    if (this.lives <= 0) this.lose('swat', by);
    else this.hud.hint(this.lives === 1 ? '마지막 목숨! 손님이 무기를 들면 즉시 피하세요' : '찰싹! 목숨 하나를 잃었다', 2.5);
  }

  flySwallowed(by: Guest) {
    if (this.phase !== 'play') return false;
    this.lives--;
    this.hud.lives(this.lives, true);
    ctx.audio.sfx('gulp');
    this.cam.shake(0.4);
    if (this.lives <= 0) {
      this.lose('gulp', by);
      return true;
    }
    this.hud.hint('꿀꺽! …퉤. 목숨 하나와 맞바꾼 굉장한 효과', 2.5);
    return true;
  }

  onSwatWindup(g: Guest) {
    if (!this.hintFlags.has('windup')) {
      this.hintFlags.add('windup');
      this.hud.hint(`${iga(g.name)} 반격 준비! 내려치기 전에 다른 곳을 탭!`, 2.6, true);
    }
  }

  onSwatMiss(g: Guest, aim: THREE.Vector3, _hitSomething: boolean) {
    if (this.phase !== 'play') return;
    const lt = ctx.fly.lastTakeoff;
    const dt = ctx.time - lt.time;
    if (dt < 0.45 && lt.from.distanceTo(aim) < g.p.hitR + 0.1) {
      this.closeCalls++;
      this.score += 60;
      this.hud.closeCall(this.toScreen(aim));
      this.slowmo = 0.45;
      ctx.audio.sfx('closecall');
    }
  }

  onGuestFlee(g: Guest) {
    if (this.phase !== 'play') return;
    this.goneCount++;
    this.score += 300;
    if (this.clock - this.lastFleeT < 9) this.prank('domino', g.rig.headWorld(V3()));
    this.lastFleeT = this.clock;
    this.cam.nudge(g.rig.headWorld(V3()), 2.2);
    this.slowmo = 0.6;
    this.hud.guestLeft(g, this.goneCount, ctx.guests.length);
    ctx.audio.sfx('flee');
    if (!this.hintFlags.has('flee')) {
      this.hintFlags.add('flee');
      ctx.later(1.6, () => this.phase === 'play' && this.hud.hint('한 명 퇴장! 모두 쫓아내고 한가운데 케이크를 차지하세요', 4));
    }
  }

  onGuestGone(_g: Guest) {
    if (ctx.guests.every((x) => !x.active) && !this.cakeOpen && this.phase === 'play') this.openCake();
  }

  private openCake() {
    this.cakeOpen = true;
    ctx.butler.leave();
    this.hud.banner('모두 떠났다!', '텅 빈 식탁 한가운데, 케이크 위에 내려앉아라');
    ctx.audio.musicMood('triumph');
    // already sitting on the cake? then it's ours right now
    if (ctx.fly.state === 'landed' && ctx.fly.landedOn?.kind === 'cake') ctx.later(1.2, () => this.phase === 'play' && this.victory());
  }

  // ---------------------------------------------------------------------------
  private victory() {
    this.phase = 'victory';
    this.phaseT = 0;
    this.prank('cake');
    this.pranksFound.add('cake');
    const fly = ctx.fly;
    fly.celebrate = true;
    this.cam.focus.copy(this.cake.topWorld(V3()));
    this.cam.setMode('victory');
    ctx.audio.victory();
    this.hud.showHUD(false);
    this.hud.banner('케이크 정복!', '우아한 가든파티를 혼자서 무너뜨렸다');
    const timeBonus = Math.round((DURATION - this.clock) * 6);
    this.score += timeBonus + this.lives * 400;
    this.results = this.makeResults(true, 'cake');
  }

  private lose(reason: 'swat' | 'gulp' | 'time', by: Guest | null) {
    if (this.phase !== 'play') return;
    this.phase = reason === 'time' ? 'timeup' : 'lose';
    this.phaseT = 0;
    const fly = ctx.fly;
    if (reason !== 'time') {
      fly.state = 'dead';
      this.cam.focus.copy(fly.pos);
      this.cam.setMode('lose');
    }
    ctx.audio.defeat();
    this.hud.showHUD(false);
    if (reason === 'time') {
      for (const g of ctx.guests) if (g.active) g.cheer();
      this.hud.banner('오후 5시, 케이크 커팅!', '파티는 우아하게 끝나 버렸다…');
    } else if (reason === 'gulp') {
      this.hud.banner('꿀꺽!', `${by?.name ?? '손님'}의 뱃속으로…`);
    } else {
      this.hud.banner('찰싹!', `${by?.name ?? '손님'}에게 납작해졌다`);
    }
    this.results = this.makeResults(false, reason, by?.name);
  }

  private makeResults(win: boolean, reason: Results['reason'], culprit?: string): Results {
    return {
      win, reason, culprit,
      time: this.clock,
      lives: this.lives,
      maxChain: this.maxChain,
      closeCalls: this.closeCalls,
      pranks: new Set(this.pranksFound),
      score: this.score,
      gone: this.goneCount,
    };
  }

  // ---------------------------------------------------------------------------
  update(rawDt: number) {
    // slow-motion beats for the big moments
    const wantScale = this.slowmo > 0 ? 0.35 : 1;
    if (this.slowmo > 0) this.slowmo -= rawDt;
    ctx.timeScale += (wantScale - ctx.timeScale) * damp(10, rawDt);
    const dt = rawDt * ctx.timeScale;
    ctx.time += dt;
    this.phaseT += rawDt;

    if (this.phase === 'play') {
      this.clock += dt;
      if (this.clock >= DURATION && !this.cakeOpen) this.lose('time', null);
      if (!this.warned && this.clock > DURATION - 60) {
        this.warned = true;
        this.hud.hint('곧 오후 5시 — 케이크 커팅 시간입니다! 서두르세요', 4, true);
        ctx.audio.sfx('bell');
      }
      this.tips();
    }

    // the gramophone horn amplifies a buzzing fly
    const fly = ctx.fly;
    const horn = ctx.garden.gramophone.hornMouth;
    this.hornBlast = fly.buzzing && fly.pos.distanceTo(horn) < 0.36 && this.phase === 'play';
    if (this.hornBlast) {
      this.hornT += dt;
      if (this.hornT > 0.25) this.prank('gramophone', horn);
      for (const g of ctx.guests) if (g.active) g.irritation = Math.min(1.1, g.irritation + dt * 0.25 * g.p.hearing);
    } else this.hornT = 0;

    if (this.timers.length) {
      const due = this.timers.filter((t) => t.at <= ctx.time);
      if (due.length) {
        this.timers = this.timers.filter((t) => t.at > ctx.time);
        for (const t of due) t.fn();
      }
    }
    // 33⅓ rpm — a fly riding the record drags it (and the music) down a little
    const rec = ctx.garden.gramophone.record;
    const riding = fly.state === 'landed' && fly.landedOn?.anchor === rec;
    rec.rotation.y += dt * (riding ? 2.4 : 3.5);
    ctx.audio.recordDrag = riding ? 1 : 0;
    for (const g of ctx.guests) g.update(dt);
    ctx.butler.update(dt);
    for (const it of ctx.items) it.update(dt);
    fly.update(dt);
    ctx.mess.update(dt);
    this.cam.update(rawDt);
    ctx.audio.update(rawDt);

    if ((this.phase === 'victory' || this.phase === 'lose' || this.phase === 'timeup') && this.results && this.phaseT > (this.phase === 'victory' ? 4.5 : 3.0)) {
      this.hud.results(this.results);
      this.results = null;
    }
    this.hud.update(this, rawDt);
  }

  /** Fixed-step simulation without rendering (used by automated play-tests). */
  step(seconds: number, dt = 1 / 30) {
    const n = Math.round(seconds / dt);
    for (let i = 0; i < n; i++) this.update(dt);
  }

  get elegance() {
    return clamp01(1 - (ctx.mess.score * 0.012 + this.goneCount * 0.08));
  }

  private tips() {
    if (this.clock < this.nextTip) return;
    this.nextTip = this.clock + 38;
    const active = ctx.guests.filter((g) => g.active);
    const rev = active.find((g) => g.id === 'reverend');
    // the stubborn ones get a nudge toward the trick that works on them
    if (rev && active.length <= 2) {
      this.hud.hint('💡 무던한 목사님은 웬만해선 안 질려요. 그의 접시에 앉아 포크에 실려 가다가… 입 바로 앞에서 탈출!', 6);
      return;
    }
    const granny = active.find((g) => g.id === 'granny');
    if (granny && active.length <= 3 && !this.pranksFound.has('trumpet')) {
      this.hud.hint('💡 귀 어두운 할머니도 보청 나팔 속 윙윙 소리는 들립니다', 5);
      return;
    }
    const undiscovered = PRANKS.filter((p) => !this.pranksFound.has(p.id) && p.id !== 'cake' && p.id !== 'gulp');
    if (!undiscovered.length) return;
    this.hud.hint('💡 ' + pick(undiscovered).hint, 5);
  }
}
