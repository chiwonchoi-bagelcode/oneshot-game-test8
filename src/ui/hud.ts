import type { Game, Results } from '../game/game';
import { DURATION } from '../game/game';
import type { Guest } from '../actors/guest';
import type { PrankInfo } from '../game/pranks';
import { PRANKS } from '../game/pranks';
import { ctx } from '../game/ctx';
import { V3 } from '../core/math';

const FLY_SVG = `<svg viewBox="0 0 40 32" class="life"><ellipse cx="13" cy="9" rx="11" ry="6" fill="#dbe9ff" opacity=".85" transform="rotate(-25 13 9)"/><ellipse cx="27" cy="9" rx="11" ry="6" fill="#dbe9ff" opacity=".85" transform="rotate(25 27 9)"/><ellipse cx="20" cy="19" rx="8" ry="10" fill="#2350c8"/><ellipse cx="18" cy="16" rx="3" ry="4" fill="#9cc0ff" opacity=".8"/><circle cx="15" cy="9.5" r="4" fill="#9a1a14"/><circle cx="25" cy="9.5" r="4" fill="#9a1a14"/><circle cx="14" cy="8.5" r="1.2" fill="#fff"/><circle cx="24" cy="8.5" r="1.2" fill="#fff"/></svg>`;

const SHORT: Record<string, [string, string, string]> = {
  colonel: ['대령', '#a52a32', '🎖'],
  reverend: ['목사', '#3a3a46', '✝'],
  granny: ['노부인', '#9c86bd', '📯'],
  prudence: ['프루던스', '#7d4f85', '🧷'],
  dandy: ['폽스워스', '#d9cfb4', '🎩'],
  hostess: ['안주인', '#6b3d91', '👒'],
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

export class Hud {
  readonly root: HTMLElement;
  private hudEl: HTMLElement;
  private livesEl: HTMLElement;
  private clockEl: HTMLElement;
  private rosterEl: HTMLElement;
  private eleEl: HTMLElement;
  private hintEl: HTMLElement;
  private badgeLayer: HTMLElement;
  private fxLayer: HTMLElement;
  private chips = new Map<Guest, HTMLElement>();
  private badges = new Map<Guest, HTMLElement>();
  private hintT = 0;
  private screen: HTMLElement | null = null;
  onStart: () => void = () => {};
  onRetry: () => void = () => {};
  onPause: (p: boolean) => void = () => {};
  onMute: () => boolean = () => false;
  paused = false;

  constructor(root: HTMLElement) {
    this.root = root;
    this.badgeLayer = el('div');
    this.fxLayer = el('div');
    this.hudEl = el('div', 'hud hidden');
    const top = el('div', 'topbar');
    this.livesEl = el('div', 'pill lives');
    this.clockEl = el('div', 'pill clock');
    const btns = el('div', 'row');
    btns.style.gap = '6px';
    const mute = el('button', 'iconbtn interactive', '🔊');
    mute.setAttribute('aria-label', '소리');
    mute.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      const m = this.onMute();
      mute.textContent = m ? '🔇' : '🔊';
    });
    const pause = el('button', 'iconbtn interactive', 'Ⅱ');
    pause.setAttribute('aria-label', '일시정지');
    pause.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.togglePause();
    });
    btns.append(mute, pause);
    top.append(this.livesEl, this.clockEl, btns);
    this.rosterEl = el('div', 'roster');
    this.eleEl = el('div', 'elegance', '파티의 품격<div class="bar"><i></i></div>');
    this.hudEl.append(top, this.rosterEl, this.eleEl);
    this.hintEl = el('div', 'hint');
    root.append(this.badgeLayer, this.hudEl, this.fxLayer, this.hintEl);
  }

  reset() {
    this.badgeLayer.innerHTML = '';
    this.fxLayer.innerHTML = '';
    this.rosterEl.innerHTML = '';
    this.chips.clear();
    this.badges.clear();
    for (const g of ctx.guests) {
      const [nm, col, icon] = SHORT[g.id];
      const chip = el('div', 'chip', `<div class="face" style="--c:${col}"><span>${icon}</span></div><span class="nm">${nm}</span>`);
      this.rosterEl.append(chip);
      this.chips.set(g, chip);
      const b = el('div', 'badge', '<div class="ind"></div><div class="gauge"><i></i></div>');
      this.badgeLayer.append(b);
      this.badges.set(g, b);
    }
    this.lives(3, false);
    this.hint('');
    this.showHUD(false);
    if (this.screen) this.screen.remove();
    this.screen = null;
    this.paused = false;
  }

  showHUD(on: boolean) {
    this.hudEl.classList.toggle('hidden', !on);
    this.badgeLayer.style.display = on ? '' : 'none';
  }

  lives(n: number, animate: boolean) {
    const prev = this.livesEl.children.length;
    this.livesEl.innerHTML = '';
    for (let i = 0; i < 3; i++) {
      const wrap = el('span', '', FLY_SVG);
      const svg = wrap.firstElementChild as SVGElement;
      if (i >= n) svg.classList.add('lost');
      if (animate && i === n) svg.classList.add('pop');
      this.livesEl.append(svg);
    }
    void prev;
  }

  hint(text: string, dur = 0, urgent = false) {
    if (text && this.screen) return;
    if (!text) {
      this.hintEl.classList.remove('on', 'urgent');
      this.hintT = 0;
      return;
    }
    this.hintEl.textContent = text;
    this.hintEl.classList.add('on');
    this.hintEl.classList.toggle('urgent', urgent);
    this.hintT = dur > 0 ? dur : 0;
  }

  prank(info: PrankInfo, first: boolean, pos: { x: number; y: number; behind: boolean } | null) {
    if (first) {
      const c = el('div', 'card', `<small>✦ 새 장난 발견 ✦</small><b>${info.name}</b><p>${info.desc}</p>`);
      this.fxLayer.append(c);
      setTimeout(() => c.remove(), 2900);
    } else if (pos && !pos.behind) {
      this.float(info.name + '!', pos.x, pos.y - 30, '');
    }
  }

  chain(n: number, pos: { x: number; y: number; behind: boolean }) {
    const x = pos.behind ? this.root.clientWidth / 2 : pos.x;
    const y = pos.behind ? this.root.clientHeight * 0.4 : pos.y;
    this.float(`연쇄 ×${n}!`, x, y - 60, 'chain');
  }

  closeCall(pos: { x: number; y: number; behind: boolean }) {
    this.float('아슬아슬!', pos.behind ? this.root.clientWidth / 2 : pos.x, (pos.behind ? this.root.clientHeight / 2 : pos.y) - 40, 'close');
  }

  private float(text: string, x: number, y: number, cls: string) {
    const f = el('div', 'float ' + cls);
    f.textContent = text;
    f.style.left = `${Math.max(60, Math.min(this.root.clientWidth - 60, x))}px`;
    f.style.top = `${Math.max(150, Math.min(this.root.clientHeight - 80, y))}px`;
    this.fxLayer.append(f);
    setTimeout(() => f.remove(), 1500);
  }

  guestLeft(g: Guest, count: number, total: number) {
    this.banner(`${g.name} 퇴장!`, `${count} / ${total} 명 질려서 떠났다`);
  }

  banner(title: string, sub: string, stay = false) {
    const b = el('div', 'banner' + (stay ? ' stay' : ''), `<b>${title}</b><span>${sub}</span>`);
    this.fxLayer.append(b);
    if (!stay) setTimeout(() => b.remove(), 3500);
  }

  // ---------------------------------------------------------------------------
  showTitle() {
    const s = el('div', 'screen title-screen interactive');
    s.innerHTML = `
      <div class="invite">
        <small>~ 정중히 초대받지 않았습니다 ~</small>
        <h1>쉬<em>파리</em>의<br/>가든파티</h1>
        <div class="sub">The Bluebottle's Garden Party</div>
        <div class="strike">하이아신스 부인의 우아한 오후 다과회<br/><s>파리 출입 금지</s> 🪰 장난 대환영</div>
      </div>
      <div>
        <button class="bigbtn interactive" id="startbtn">윙윙~ 파티 망치러 가기</button>
        <div class="howto">식탁 위 원하는 곳을 <b>탭</b> — 그곳으로 쌩 날아갑니다<br/>날면 <b>윙윙</b>, 앉으면 조용. 신문이 말리면 <b>도망!</b><br/>손님을 모두 질리게 하고 <b>케이크</b>를 차지하세요<br/><span style="opacity:.8">🔊 소리를 켜고 플레이하세요 — 윙윙 소리가 무기입니다</span></div>
      </div>`;
    this.root.append(s);
    this.screen = s;
    const btn = s.querySelector('#startbtn') as HTMLElement;
    const go = (e: Event) => {
      e.stopPropagation();
      e.preventDefault();
      s.classList.add('fade');
      setTimeout(() => s.remove(), 600);
      this.screen = null;
      this.onStart();
    };
    btn.addEventListener('pointerdown', go);
  }

  togglePause() {
    if (this.screen && !this.paused) return;
    this.paused = !this.paused;
    this.onPause(this.paused);
    if (this.paused) {
      const s = el('div', 'screen interactive');
      s.style.background = 'rgba(30,40,20,0.55)';
      const p = el('div', 'panel');
      p.innerHTML = `<h2>잠시 쉬는 중</h2><div class="row" id="pauserow" style="margin:10px 0 6px"></div><div class="journal">${this.journalHTML(ctx.game.pranksFound)}</div>`;
      const row = el('div', 'row');
      const resume = el('button', 'bigbtn interactive', '계속하기');
      const restart = el('button', 'bigbtn sec interactive', '처음부터');
      resume.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        this.togglePause();
      });
      restart.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        this.paused = false;
        this.onPause(false);
        this.onRetry();
      });
      row.append(resume, restart);
      row.style.margin = '10px 0 6px';
      (p.querySelector('#pauserow') as HTMLElement).replaceWith(row);
      s.append(p);
      this.root.append(s);
      this.screen = s;
    } else if (this.screen) {
      this.screen.remove();
      this.screen = null;
    }
  }

  private journalHTML(found: Set<string>) {
    const list = PRANKS.map((p) => {
      const on = found.has(p.id);
      return `<li class="${on ? '' : 'off'}"><b>${on ? p.name : '???'}</b>${on ? p.desc : p.hint}</li>`;
    }).join('');
    return `<h3>장난 도감 ${PRANKS.filter((p) => found.has(p.id)).length} / ${PRANKS.length}</h3><ul>${list}</ul>`;
  }

  results(r: Results) {
    this.hint('');
    const s = el('div', 'screen interactive');
    s.style.background = r.win ? 'rgba(40,30,10,0.35)' : 'rgba(40,10,10,0.45)';
    const mm = Math.floor(r.time / 60), ss = Math.floor(r.time % 60);
    let rank = '';
    if (r.win) {
      rank = r.score > 6200 ? '전설의 쉬파리 경' : r.score > 4600 ? '가든파티 파괴자' : r.score > 3200 ? '식탁의 무법자' : '말썽꾸러기 쉬파리';
    } else {
      rank = r.reason === 'time' ? '파티는 계속된다…' : r.reason === 'gulp' ? '디저트가 된 쉬파리' : '납작해진 쉬파리';
    }
    const title = r.win ? '케이크는 내 것!' : r.reason === 'time' ? '시간 초과' : r.reason === 'gulp' ? '꿀꺽…' : '찰싹!';
    const p = el('div', 'panel');
    p.innerHTML = `
      <h2 class="${r.win ? '' : 'bad'}">${title}</h2>
      <div class="rank">${rank}</div>
      <div class="score">점수 <b>${r.score.toLocaleString()}</b></div>
      <div class="row" id="againrow"></div>
      <div class="stats">
        <div class="stat"><b>${mm}:${String(ss).padStart(2, '0')}</b><span>걸린 시간</span></div>
        <div class="stat"><b>${r.gone} / 6</b><span>질려서 떠난 손님</span></div>
        <div class="stat"><b>×${r.maxChain}</b><span>최대 연쇄</span></div>
        <div class="stat"><b>${r.closeCalls}</b><span>아슬아슬 회피</span></div>
      </div>
      <div class="journal">${this.journalHTML(r.pranks as Set<string>)}</div>`;
    const row = el('div', 'row');
    const again = el('button', 'bigbtn interactive', r.win ? '한 판 더!' : '다시 도전');
    again.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.onRetry();
    });
    row.append(again);
    (p.querySelector('#againrow') as HTMLElement).replaceWith(row);
    row.style.margin = '2px 0 12px';
    s.append(p);
    this.root.append(s);
    this.screen = s;
  }

  // ---------------------------------------------------------------------------
  update(game: Game, dt: number) {
    if (this.hintT > 0) {
      this.hintT -= dt;
      if (this.hintT <= 0) this.hint('');
    }
    // clock 3:00pm → 5:00pm
    const k = Math.min(1, game.clock / DURATION);
    const mins = Math.floor(k * 120);
    const h = 3 + Math.floor(mins / 60);
    const m = mins % 60;
    this.clockEl.innerHTML = `<span class="dial" style="--p:${(k * 100).toFixed(1)}%"></span>오후 ${h}:${String(m).padStart(2, '0')}`;
    this.clockEl.classList.toggle('warn', k > 0.86 && game.phase === 'play');
    (this.eleEl.querySelector('i') as HTMLElement).style.width = `${(game.elegance * 100).toFixed(1)}%`;

    const rect = this.root.getBoundingClientRect();
    for (const g of ctx.guests) {
      const chip = this.chips.get(g)!;
      const face = chip.firstElementChild as HTMLElement;
      face.style.setProperty('--fed', `${Math.min(100, g.fedDisplay * 100).toFixed(0)}%`);
      chip.classList.toggle('gone', !g.active);
      chip.classList.toggle('alert', g.active && (g.st === 'windup' || g.st === 'strike' || g.st === 'flail'));
      const b = this.badges.get(g)!;
      if (!g.active || game.phase !== 'play' || g.st === 'flee' || g.st === 'slip') {
        b.style.display = 'none';
        continue;
      }
      const top = g.rig.headWorld(V3());
      top.y += g.rig.b * 1.25 + (g.props.hasHat ? 0.1 : 0) + (g.id === 'prudence' ? 0.05 : 0);
      const sp = top.project(ctx.camera);
      if (sp.z > 1 || Math.abs(sp.x) > 1.2 || Math.abs(sp.y) > 1.2) {
        b.style.display = 'none';
        continue;
      }
      b.style.display = '';
      const x = (sp.x * 0.5 + 0.5) * rect.width;
      const y = (-sp.y * 0.5 + 0.5) * rect.height;
      b.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
      const ind = b.firstElementChild as HTMLElement;
      const gauge = b.lastElementChild as HTMLElement;
      const i = g.indicator;
      ind.className = 'ind' + (i ? ' on' : '') + (i === '!' ? ' bang' : '') + (i === 'Zz' ? ' zz' : '');
      ind.textContent = i === 'Zz' ? 'Zzz' : i;
      gauge.classList.toggle('on', g.fedDisplay > 0.03);
      gauge.classList.toggle('pulse', g.fedPulse > 0.15);
      (gauge.firstElementChild as HTMLElement).style.width = `${Math.min(100, g.fedDisplay * 100).toFixed(0)}%`;
    }
  }
}
