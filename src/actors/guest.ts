import * as THREE from 'three';
import { ctx, addSurface, TABLE } from '../game/ctx';
import type { GameEvent, Impact, Surface } from '../game/types';
import type { SeatDef, GuestId } from '../world/layout';
import { seatToWorld } from '../world/layout';
import { PlateItem, GlassItem, Item } from '../world/items';
import type { MessKind, MessTarget } from '../world/mess';
import { Rig } from './rig';
import { lookFor, decorate, Props } from './looks';
import { PERSONALITIES, Personality } from './personalities';
import type { Butler } from './butler';
import { invisibleMat, clay } from '../render/materials';
import { blob, flatDisc } from '../render/shapes';
import { makeRingTexture } from '../render/textures';
import { clamp, clamp01, lerp, rand, randRange, smoothstep, V3, easeOutCubic, easeInCubic, pick } from '../core/math';

export type GState =
  | 'idle' | 'eat' | 'drink' | 'windup' | 'strike' | 'recover' | 'shoo' | 'crosseyed' | 'sneeze' | 'spit'
  | 'react' | 'gag' | 'flail' | 'startle' | 'flee' | 'slip' | 'gone';

type ReactKind = 'shock' | 'splattered' | 'smacked' | 'refuse' | 'gasp' | 'triumph' | 'glare' | 'wipe' | 'mortified' | 'chuckle';

let ringTex: THREE.Texture | null = null;

const _p = new THREE.Vector3();
const _q = new THREE.Vector3();

export class Guest implements MessTarget {
  readonly id: GuestId;
  readonly p: Personality;
  readonly rig: Rig;
  readonly props: Props;
  readonly seat: SeatDef;
  plate!: PlateItem;
  drink!: GlassItem;
  chair!: THREE.Group;
  active = true;
  gone = false;

  // meters
  fed = 0;
  irritation = 0;
  private fedShown = 0;
  /** Recent disgust gains, for floating feedback. */
  fedPulse = 0;
  /** Where the disgust came from (debug/tuning). */
  fedLog: Record<string, number> = {};

  // state machine
  st: GState = 'idle';
  stT = 0;
  private phase = 0;
  private react: ReactKind = 'shock';
  private reactDur = 1;
  private reactAfter: GState = 'idle';

  // perception
  tracking = false;
  seesFly = false;
  private interest = 0;
  private noticedVisit = false;
  private lastSeen = V3();
  private hear = 0;
  private noticeDelay = -1;
  private attention: { pos: THREE.Vector3; until: number } | null = null;
  private idleLook = V3();
  private idleLookT = 0;
  private talkT = 0;
  private talking = 0;
  private laughT = 0;

  // timers
  private nextEat = 0;
  private nextDrink = 0;
  private nextGag = 0;
  private swatCD = 0;
  private flinchCD = 0;
  private gagLevel = 0;
  private startleCD = 0;
  private witnessFatigue = 0;

  // modes
  reading = false;
  private readT = 0;
  dozing = false;
  private dozeT = 0;
  private listen = 0;

  // actions
  private aim = V3();
  private aimLocked = false;
  private ring: THREE.Mesh;
  private morsel: THREE.Object3D | null = null;
  private morselSurface: Surface | null = null;
  private holdingGlass = false;
  private glassStartQuat = new THREE.Quaternion();
  private flailHits = 0;
  private fleeIdx = 0;
  private slipT = 0;
  private sneezeDir = V3();
  private rageBoost = 0;
  private wipeT = 0;
  hatSquashed = false;
  toupeeLost = false;
  private messBlobs: THREE.Object3D[] = [];
  private lastMessT = -9;
  private chairFall = 0;
  private chairFallDir = 1;
  private strikeFrom = V3();

  // surfaces
  readonly noseSurface: Surface;
  readonly headSurface: Surface;
  trumpetSurface: Surface | null = null;

  /** Floating indicator for the HUD ('!', '?', 'Zz', '') */
  indicator = '';
  /** "Saw the fly on this item" memory, so they refuse to eat it. */
  private disgustedBy = new Set<Item>();

  constructor(seat: SeatDef) {
    this.seat = seat;
    this.id = seat.id;
    this.p = PERSONALITIES[seat.id];
    this.rig = new Rig(lookFor(seat.id));
    this.props = decorate(seat.id, this.rig);
    this.rig.headTurnSpeed = this.p.headTurn;
    const r = this.rig;
    r.root.position.set(seat.x, 0, seat.z);
    r.root.rotation.y = seat.yaw;
    ctx.scene.add(r.root);
    r.root.updateMatrixWorld(true);

    // landing proxies on the person
    const noseP = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), invisibleMat);
    noseP.position.copy(r.noseTip.position);
    noseP.position.z += 0.01;
    r.head.add(noseP);
    this.noseSurface = addSurface({ kind: 'nose', proxy: noseP, anchor: r.head, guest: this, enabled: true, priority: 5 });
    const headP = new THREE.Mesh(new THREE.SphereGeometry(Math.max(r.a, r.b, r.c) * 1.12, 14, 10), invisibleMat);
    r.head.add(headP);
    const headKind = this.props.hasHat ? 'hat' : this.props.toupee ? 'toupee' : 'head';
    this.headSurface = addSurface({ kind: headKind, proxy: headP, anchor: r.head, guest: this, enabled: true, priority: 3 });
    // whole body: lets the fly perch on shoulders / backs
    const bodyP = new THREE.Mesh(new THREE.SphereGeometry(r.look.torsoW * 1.25, 10, 8), invisibleMat);
    bodyP.scale.set(1, 1.7, 1.1);
    bodyP.position.y = r.look.torsoH * 0.55;
    r.torso.add(bodyP);
    addSurface({ kind: 'body', proxy: bodyP, anchor: r.torso, guest: this, enabled: true, priority: 1 });

    ringTex ??= makeRingTexture();
    this.ring = flatDisc(0.16, new THREE.MeshBasicMaterial({ map: ringTex, color: '#ff3b2f', transparent: true, depthWrite: false, opacity: 0 }));
    this.ring.renderOrder = 5;
    this.ring.visible = false;
    ctx.scene.add(this.ring);

    // weapon/prop placement
    this.setupProps();
    this.rig.finalize();

    this.nextEat = randRange(2, this.p.eatEvery[1]);
    this.nextDrink = randRange(4, this.p.drinkEvery[1]);
    this.nextGag = 0;
    if (this.p.reads) {
      this.reading = true;
      this.readT = randRange(6, 10);
    }
    if (this.p.dozes) {
      this.dozing = false;
      this.dozeT = randRange(6, 10);
    }
    this.pickIdleLook();
  }

  /** Place this guest's tableware. */
  setupItems() {
    const s = this.seat;
    const [px, pz] = s.side === 'H' ? [0, s.z + 0.62] : seatToWorld(s, 0.58, 0);
    this.plate = new PlateItem(s.food).place(px, pz).setOwner(this) as PlateItem;
    const [gx, gz] = s.side === 'H' ? [-0.24, s.z + 0.6] : seatToWorld(s, 0.6, 0.23);
    this.drink = new GlassItem(s.drink).place(gx, gz).setOwner(this) as GlassItem;
    ctx.items.push(this.plate, this.drink);
    if (this.props.handbag) {
      const [bx, bz] = seatToWorld(s, 0.48, -0.26);
      this.props.handbag.position.set(bx, TABLE.y, bz);
      this.props.handbag.rotation.y = s.yaw + 0.3;
      ctx.scene.add(this.props.handbag);
    }
    if (this.props.cane) {
      const [cx, cz] = seatToWorld(s, 0.3, 0.28);
      this.props.cane.position.set(cx, 0.82, cz);
      this.props.cane.rotation.set(0.25, s.yaw, 0.1);
      ctx.scene.add(this.props.cane);
    }
  }

  private setupProps() {
    const r = this.rig;
    const pr = this.props;
    if (pr.newspaper) r.torso.add(pr.newspaper.group);
    if (pr.fan) {
      r.arms[1].hand.add(pr.fan.group);
      pr.fan.group.position.set(0, 0.0, 0.05);
      pr.fan.group.rotation.set(Math.PI / 2, 0, 0);
    }
    if (pr.trumpet) {
      r.arms[1].hand.add(pr.trumpet);
      pr.trumpet.position.set(0, 0.0, 0.03);
      const bellProxy = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), invisibleMat);
      bellProxy.position.set(0, 0, -0.17);
      pr.trumpet.add(bellProxy);
      this.trumpetSurface = addSurface({ kind: 'trumpet', proxy: bellProxy, anchor: pr.trumpet, guest: this, enabled: true, priority: 4 });
    }
    if (pr.napkin) {
      r.arms[0].hand.add(pr.napkin);
      pr.napkin.position.set(0, -0.02, 0.05);
    }
  }

  get name() {
    return this.p.name;
  }
  get weaponArm() {
    return this.p.weapon === 'fan' ? this.rig.arms[1] : this.rig.arms[0];
  }
  get eatArm() {
    return this.p.reads || this.p.dozes ? (this.p.reads ? this.rig.arms[1] : this.rig.arms[0]) : this.rig.arms[0];
  }

  // ---------------------------------------------------------------------------
  // MessTarget
  // ---------------------------------------------------------------------------
  headSphere(out: THREE.Vector3) {
    this.rig.head.getWorldPosition(out);
    return Math.max(this.rig.a, this.rig.b) * 1.1;
  }
  bodySphere(out: THREE.Vector3) {
    this.rig.torso.localToWorld(out.set(0, this.rig.look.torsoH * 0.55, 0.02));
    return this.rig.look.torsoW * 1.15;
  }

  receiveMess(kind: MessKind, color: string, point: THREE.Vector3, part: 'head' | 'body', source: Guest | Butler | null, obj?: THREE.Object3D): boolean {
    if (!this.active || this.st === 'gone') return false;
    const r = this.rig;
    let gain = 0;
    if (kind === 'toupee') return false;
    if (part === 'head') {
      if (kind === 'jelly' && obj) {
        // wear it like a hat
        r.head.attach(obj);
        obj.position.set(0, r.b * 0.95, 0.0);
        obj.rotation.set(0, 0, 0);
        obj.scale.set(r.a * 0.95, 0.085, r.c * 0.95);
        this.messBlobs.push(obj);
        gain = 0.3;
        ctx.prank('jellyhat', point);
        ctx.audio.sfx('splat', point);
      } else if (kind === 'wine' || kind === 'tea' || kind === 'sneeze' || kind === 'water') {
        // dripping face
        for (let i = 0; i < 3; i++) {
          const d = blob(0.012, 0.02, 0.008, clay(color, { rough: 0.08 }), 8, false);
          const x = randRange(-0.06, 0.06), y = randRange(-0.06, 0.04);
          d.position.set(x, y, r.headSurf(x, y) + 0.004);
          r.head.add(d);
          this.messBlobs.push(d);
        }
        gain = kind === 'sneeze' ? 0.26 : 0.22;
      } else {
        if (obj) ctx.scene.remove(obj);
        if (this.props.toupee && !this.toupeeLost && rand() < 0.5) this.smacked(source, point, 0.5);
        const s = kind === 'cream' ? 0.05 : 0.04;
        const d = blob(s, s * 0.6, s * 0.5, clay(color, { normal: 0.9 }), 10, false);
        const x = randRange(-0.05, 0.05), y = randRange(-0.04, 0.06);
        d.position.set(x, y, r.headSurf(x, y) + 0.008);
        r.head.add(d);
        this.messBlobs.push(d);
        gain = kind === 'cream' ? 0.22 : 0.17;
        ctx.audio.sfx('splat', point);
      }
      this.wipeT = 2.2;
    } else {
      if (obj) ctx.scene.remove(obj);
      const d = blob(0.07, 0.06, 0.02, clay(color, { rough: kind === 'wine' ? 0.1 : 0.5, normal: 0.6 }), 10, false);
      d.position.set(randRange(-0.06, 0.06), r.look.torsoH * randRange(0.35, 0.75), r.look.torsoD * 0.95 + r.look.belly * 0.6);
      r.torso.add(d);
      this.messBlobs.push(d);
      gain = kind === 'wine' ? 0.17 : 0.13;
      ctx.audio.sfx('plop', point);
    }
    // a second splat right after the first stings less
    const fresh = ctx.time - this.lastMessT > 1.5 ? 1 : 0.45;
    this.lastMessT = ctx.time;
    const g = gain * this.p.vanity * fresh;
    this.addFed(g, 'mess');
    this.startReact('splattered', 1.6);
    ctx.emit({ type: 'messOn', pos: point.clone(), loud: 0.7, gross: 0.07, source, victim: this, chain: true });
    ctx.audio.voice(this, kind === 'jelly' ? 'gasp' : 'eugh');
    ctx.game.chainHit(this, point);
    return true;
  }

  // ---------------------------------------------------------------------------
  // Disgust / reactions API
  // ---------------------------------------------------------------------------
  addFed(v: number, why: string, direct = false) {
    if (!this.active || this.st === 'flee' || this.st === 'gone') return;
    const k = direct ? 1 : this.p.fedMul * 0.85;
    this.fed = Math.min(1.05, this.fed + v * k);
    const key = why.split(':')[0] + (why.includes(':') ? ':' + why.split(':')[1] : '');
    this.fedLog[key] = (this.fedLog[key] ?? 0) + v * k;
    this.fedPulse = Math.min(1, this.fedPulse + v * k * 3);
    void why;
  }

  private startReact(kind: ReactKind, dur: number, after: GState = 'idle') {
    if (this.st === 'flee' || this.st === 'gone' || this.st === 'slip') return;
    this.dropHeld();
    this.react = kind;
    this.reactDur = dur;
    this.reactAfter = after;
    this.setState('react');
  }

  /** Something hit this guest on the head/face (swat, slap, handbag). */
  smacked(by: Guest | Butler | null, at: THREE.Vector3, strength: number) {
    if (!this.active) return;
    const r = this.rig;
    const self = by === this;
    if (this.props.toupee && !this.toupeeLost) {
      this.toupeeLost = true;
      const tp = this.props.toupee;
      const from = tp.getWorldPosition(V3());
      ctx.scene.attach(tp);
      this.headSurface.kind = 'head';
      const away = from.clone().sub(at).setY(0);
      if (away.lengthSq() < 1e-4) away.set(rand() - 0.5, 0, rand() - 0.5);
      away.normalize().multiplyScalar(1.2);
      ctx.mess.launchObject(tp, from, away.setY(2.4), 'toupee', '#3b2416', 0.06, this);
      ctx.audio.sfx('fwip', from);
      this.addFed(0.38, 'toupee', true);
      ctx.prank('toupee', from);
      ctx.emit({ type: 'toupee', pos: from, loud: 0.9, gross: 0.05, source: by, victim: this, chain: true });
    }
    if (this.props.hat && !this.hatSquashed && !self) {
      this.hatSquashed = true;
      this.props.hat.scale.set(1.1, 0.45, 1.1);
      this.props.hat.rotation.z = 0.35;
      this.props.hat.position.y -= 0.04;
      this.addFed(0.18 * this.p.vanity, 'hat');
    }
    // dizzy pose
    r.headRollT = randRange(-0.4, 0.4);
    const g = (self ? 0.13 : 0.22) * (self ? 1 : this.p.vanity);
    this.addFed(g, 'smack');
    if (this.st === 'crosseyed' || this.st === 'windup' || this.st === 'strike') this.aimLocked = false;
    this.startReact('smacked', 1.5);
    ctx.audio.voice(this, 'ow');
    ctx.emit({ type: 'smack', pos: at.clone(), loud: 0.9, gross: 0.06, source: by, victim: this, chain: true });
    if (self) ctx.prank('selfslap', at);
    else if (by) ctx.prank('friendlyfire', at);
    ctx.game.chainHit(this, at);
    if (!self && by && 'irritation' in by) {
      // glare at the culprit
      this.attention = { pos: (by as Guest).rig.headWorld(V3()), until: ctx.time + 2.5 };
    }
  }

  /** Heard/seen something happen at the table. */
  onEvent(e: GameEvent) {
    if (!this.active || this.st === 'gone' || this.st === 'flee') return;
    if (e.source === this) return;
    const head = this.rig.headWorld(_p);
    const dist = head.distanceTo(e.pos);
    const asleep = this.dozing;
    const hearK = asleep ? 0.6 : 1;
    const heard = (e.loud * hearK) / (1 + (dist / 1.6) ** 2);
    if (heard < 0.12 && !this.canSee(e.pos, false)) return;
    if (asleep && heard > 0.35) this.wake(true);
    if (this.dozing) return;
    // turn to look
    this.attention = { pos: e.pos.clone(), until: ctx.time + 1.8 };
    if (e.victim === this) return;
    // disgust from witnessing, applied after they've turned their head
    // habituation: a second ghastly sight right after the first lands softer
    const g = (0.45 * e.gross * this.p.sympathy * (1 / (1 + (dist / 2.2) ** 2))) / (1 + this.witnessFatigue);
    this.witnessFatigue += g * 6;
    if (g > 0.001) {
      ctx.later(randRange(0.25, 0.45), () => {
        if (!this.active || this.st === 'flee') return;
        this.addFed(g, 'witness:' + e.type);
        if (g > 0.05 && this.st === 'idle' && rand() < 0.6) {
          this.startReact(e.type === 'eatContam' || e.type === 'eatfly' ? 'shock' : 'gasp', 0.9);
          ctx.audio.voice(this, e.type === 'eatContam' || e.type === 'gag' ? 'eugh' : 'gasp');
        }
      });
    }
    if (e.type === 'scream' && this.st === 'idle') {
      this.irritation = Math.min(1, this.irritation + 0.12);
    }
    if (e.type === 'flee' && this.p.hostess) this.addFed(0.08, 'host-shame', false);
  }

  private wake(startle: boolean) {
    if (!this.dozing) return;
    this.dozing = false;
    this.dozeT = randRange(10, 16);
    if (startle) {
      this.startReact('shock', 0.8);
      ctx.audio.voice(this, 'hmm');
    }
  }

  // ---------------------------------------------------------------------------
  // Perception
  // ---------------------------------------------------------------------------
  canSee(point: THREE.Vector3, focus: boolean) {
    if (this.dozing || !this.active) return false;
    const head = this.rig.headWorld(_q);
    const to = V3().subVectors(point, head);
    const dist = to.length();
    if (dist > (focus ? 2.3 : 3.2)) return false;
    const fwd = this.rig.forwardWorld(V3());
    const ang = fwd.angleTo(to);
    if (ang > (focus ? 0.55 : 1.15)) return false;
    // the open newspaper blocks the view of the table
    if (this.reading && this.st === 'idle' && point.y < head.y + 0.05) return false;
    return true;
  }

  private flyIsOnMe() {
    const s = ctx.fly.landedOn;
    return !!s && s.guest === this && (s.kind === 'nose' || s.kind === 'head' || s.kind === 'hat' || s.kind === 'toupee' || s.kind === 'body');
  }

  private perceive(dt: number) {
    const fly = ctx.fly;
    const head = this.rig.headWorld(_p);
    const d = head.distanceTo(fly.pos);
    // hearing: the buzz swells as it passes the ear
    let hear = fly.loudness * this.p.hearing / (1 + (d / 0.32) ** 2);
    if (this.dozing) hear *= 0.35;
    // ear trumpet: a fly buzzing into the bell is deafening
    if (this.props.trumpetBell && this.listen > 0.5 && fly.buzzing) {
      const bell = this.props.trumpetBell.getWorldPosition(V3());
      const db = bell.distanceTo(fly.pos);
      if (db < 0.26) hear = 3;
    }
    // the gramophone horn blasts the buzz across the whole lawn
    if (ctx.game.hornBlast) hear = Math.max(hear, this.props.trumpet && this.listen > 0.5 ? 3 : 0.5 * this.p.hearing);
    this.hear = hear;
    const onMe = this.flyIsOnMe();
    const onNose = onMe && fly.landedOn?.kind === 'nose';
    const concern = this.flyConcernsMe();
    let sees = false;
    if (fly.state !== 'scripted' && fly.state !== 'dead' && this.active) {
      if (onNose) sees = true;
      else if (onMe) sees = false;
      else if (fly.state === 'landed') sees = this.tracking ? this.canSee(fly.pos, false) : this.lookingNear(fly.pos) && (concern || rand() < dt * 0.6);
      else sees = this.canSee(fly.pos, false) && (this.tracking || d < 0.9);
    }
    this.seesFly = sees;
    if (sees) {
      this.lastSeen.copy(fly.pos);
      if (fly.buzzing && d < 1.2) this.interest = Math.max(this.interest, 2.6);
      else if (fly.state === 'landed' && (concern || onNose)) this.interest = Math.max(this.interest, 2.6);
      else if (fly.state === 'landed' && this.onNeighbourInReach()) this.interest = Math.max(this.interest, 1.6);
      else if (!this.tracking) this.interest = Math.max(this.interest, 1.2);
      if (!this.tracking) {
        this.tracking = true;
        if (this.st === 'idle' && fly.state === 'landed' && !onNose && !concern) ctx.audio.voice(this, 'hmm', 0.5);
      }
      // first time spotting the fly ON my food: a horrified double-take
      if (fly.state === 'landed' && concern && !onNose && !onMe && !this.noticedVisit && (this.st === 'idle' || this.st === 'eat')) {
        this.noticedVisit = true;
        if (fly.landedOn?.item?.isFood) this.addFed(0.05, 'notice');
        this.dropHeld();
        this.attention = { pos: fly.pos.clone(), until: ctx.time + 1 };
        this.startReact('shock', this.p.reads ? 0.55 : 0.75);
        ctx.audio.voice(this, this.p.glutton ? 'hmm' : 'gasp');
      }
    }
    if (fly.state !== 'landed') this.noticedVisit = false;
    this.interest -= dt;
    if (this.tracking && this.interest <= 0) {
      this.tracking = false;
    }
    // hearing triggers tracking with a small reaction delay
    if (!this.tracking && hear > 0.14 && !this.dozing) {
      if (this.noticeDelay < 0) this.noticeDelay = randRange(0.15, 0.4) / Math.max(0.5, this.p.hearing);
    }
    if (this.noticeDelay >= 0) {
      this.noticeDelay -= dt;
      if (this.noticeDelay < 0) {
        this.tracking = true;
        this.interest = Math.max(this.interest, 1.8);
        this.lastSeen.copy(fly.pos);
        this.noticeDelay = -1;
      }
    }
    if (hear > 0.14 && this.tracking) this.interest = Math.max(this.interest, 1.5);
    // tickle: something on my bald head
    if (onMe && !onNose && fly.landedOn?.kind === 'head' && this.p.bald) {
      this.irritation += dt * 0.22 * this.p.irritability;
    }
  }

  /** Is the fly on something of mine, or right under my nose? */
  private flyConcernsMe() {
    const fly = ctx.fly;
    const s = fly.landedOn;
    if (fly.state !== 'landed' || !s) return false;
    if (s.guest === this) return true;
    const it = s.item;
    if (!it) return false;
    if (it.owner === this) return true;
    if (it.kind === 'cake' && this.p.hostess) return true;
    if (it.isFood && !it.owner && it.worldPos(_q).distanceTo(this.plate.worldPos(V3())) < 0.55) return true;
    return false;
  }

  /** The fly is sitting on a neighbour I could swat at. */
  private onNeighbourInReach() {
    const fly = ctx.fly;
    const s = fly.landedOn;
    if (fly.state !== 'landed' || !s || s.item || (!s.guest && !s.butler) || s.guest === this) return false;
    if (this.p.weapon === 'flail' || this.p.weapon === 'hand') return false;
    return this.inReach(fly.pos);
  }

  private lookingNear(p: THREE.Vector3) {
    // landed fly is noticed if it's where they're looking (plate, glass, focus)
    return this.canSee(p, true);
  }

  // ---------------------------------------------------------------------------
  // Meters
  // ---------------------------------------------------------------------------
  private updateMeters(dt: number) {
    const fly = ctx.fly;
    const s = fly.landedOn;
    // early on, guests are a little slower to anger (time to learn the ropes)
    const warm = clamp(0.55 + ctx.game.clock / 100, 0.55, 1);
    const calm = this.st === 'react' ? 0.4 : 1;
    const irr0 = this.irritation;
    this.irritation += this.hear * this.p.irritability * dt * 0.5;
    if (this.seesFly) {
      const head = this.rig.headWorld(_p);
      const d = head.distanceTo(fly.pos);
      if (fly.buzzing && d < 0.55) this.irritation += dt * 0.35 * this.p.irritability;
      if (fly.state === 'landed' && s) {
        const item = s.item;
        if (item && (item.isFood || item.kind === 'glass')) {
          const mine = item.owner === this;
          const near = item.worldPos(_q).distanceTo(this.rig.root.position) < 1.1;
          let rate = 0;
          if (item.isFood) {
            rate = mine ? 0.11 : item.kind === 'cake' ? (this.p.hostess ? 0.13 : 0.06) : near ? 0.05 : 0.025;
            if (this.p.glutton && mine) rate *= 0.6;
            item.seenBy.add(this);
            this.disgustedBy.add(item);
          } else if (mine) rate = 0.03;
          this.addFed(rate * dt, 'see-food');
          const glass = item.kind === 'glass';
          this.irritation += dt * (mine ? (glass ? 0.13 : 0.3) : item.kind === 'cake' ? (this.p.hostess ? 0.6 : 0.25) : glass ? 0.04 : 0.14) * this.p.irritability;
        } else if (s.kind === 'nose' && s.guest === this) {
          this.irritation += dt * 0.9;
        } else if (s.guest && s.guest !== this && !s.item) {
          // a fly on somebody else: irritating — and within swatting range, very tempting
          this.irritation += dt * (this.onNeighbourInReach() ? 0.26 : 0.08) * this.p.irritability;
        }
      }
    }
    if (this.irritation > irr0) this.irritation = irr0 + (this.irritation - irr0) * warm * calm;
    // sympathetic nausea: looking at somebody turning green
    for (const o of ctx.guests) {
      if (o === this || !o.active || o.fed < 0.55) continue;
      if (!this.canSee(o.rig.headWorld(_q), false)) continue;
      this.addFed(dt * 0.016 * ((o.fed - 0.55) / 0.45) * this.p.sympathy, 'sympathy');
    }
    // the slow collapse of the party
    const messK = clamp01(ctx.mess.score / 70);
    this.addFed(dt * 0.0016 * messK * (this.p.hostess ? 2.5 : 1), 'ambient');
    // irritation decays when nothing is bothering them
    if (!this.seesFly && this.hear < 0.05) this.irritation = Math.max(0, this.irritation - dt * 0.07);
    this.irritation = clamp(this.irritation, 0, 1.2);
    this.swatCD -= dt;
    this.flinchCD -= dt;
    this.fedPulse = Math.max(0, this.fedPulse - dt * 1.5);
    this.witnessFatigue = Math.max(0, this.witnessFatigue - dt * 0.12);
    // the last stragglers at a ruined party feel ever more awkward
    const left = ctx.guests.filter((x) => x.active).length;
    if (left <= 2) this.addFed(dt * (left === 1 ? 0.004 : 0.0022) * (0.5 + messK), 'awkward', true);
    this.fedShown += (this.fed - this.fedShown) * Math.min(1, dt * 4);
  }

  get fedDisplay() {
    return this.fedShown;
  }

  // ---------------------------------------------------------------------------
  // Main update
  // ---------------------------------------------------------------------------
  update(dt: number) {
    if (this.gone) return;
    const t = ctx.time;
    this.stT += dt;
    if (this.active && this.st !== 'flee' && this.st !== 'slip') {
      this.perceive(dt);
      this.updateMeters(dt);
      this.modes(dt);
      this.decide();
    }
    this.runState(dt, t);
    this.faceAndBody(dt, t);
    this.rig.update(dt, t);
    if (this.props.newspaper) this.props.newspaper.update(dt);
    if (this.props.fan) this.props.fan.update(dt);
    this.updateIndicator();
    this.updateChair(dt);
  }

  private modes(dt: number) {
    if (this.p.reads && this.st === 'idle') {
      this.readT -= dt;
      if (this.readT <= 0) {
        this.reading = !this.reading;
        this.readT = this.reading ? randRange(6, 11) : randRange(5, 9);
        if (this.reading && (this.tracking || this.irritation > 0.3)) {
          this.reading = false;
          this.readT = 3;
        }
        ctx.audio.sfx('rustle', this.rig.headWorld(V3()), 0.5);
      }
      if (this.reading && this.tracking) {
        this.reading = false;
        this.readT = randRange(4, 7);
        ctx.audio.sfx('rustle', this.rig.headWorld(V3()), 0.6);
      }
    }
    if (this.p.dozes && (this.st === 'idle')) {
      this.dozeT -= dt;
      if (this.dozeT <= 0) {
        if (this.dozing) this.wake(false);
        else if (!this.tracking && this.irritation < 0.2) {
          this.dozing = true;
          this.dozeT = randRange(13, 20);
        } else this.dozeT = 4;
      }
    }
    // granny holds her ear trumpet up when awake
    if (this.props.trumpet) this.listen += ((!this.dozing && (this.st === 'idle' || this.st === 'react')) ? 1 : 0) - this.listen > 0 ? dt * 2 : -dt * 2;
    this.listen = clamp01(this.listen);
  }

  private decide() {
    const fly = ctx.fly;
    const st = this.st;
    const busy = st !== 'idle' && st !== 'eat' && st !== 'drink' && st !== 'recover' && st !== 'shoo';
    // flee?
    if (this.fed >= 1 && st !== 'spit' && st !== 'sneeze' && st !== 'strike') {
      this.startFlee();
      return;
    }
    // trumpet blast
    if (this.hear >= 2.5 && st !== 'startle' && st !== 'react' && ctx.time > this.startleCD) {
      this.startleCD = ctx.time + 14;
      this.dropHeld();
      this.setState('startle');
      return;
    }
    if (busy) return;
    const onMe = this.flyIsOnMe();
    const onNose = onMe && fly.landedOn?.kind === 'nose';
    if (onNose && fly.state === 'landed' && this.flinchCD <= 0) {
      if (this.dozing) {
        this.wake(false);
      }
      this.dropHeld();
      this.setState('crosseyed');
      return;
    }
    // swat?
    if (this.tracking && this.seesFly && this.swatCD <= 0 && this.irritation >= this.p.swatAt - this.rageBoost * 0.1) {
      if (this.p.weapon === 'flail') {
        if (fly.pos.distanceTo(this.rig.headWorld(_p)) < 1.15) {
          this.dropHeld();
          this.setState('flail');
          return;
        }
      } else if (this.inReach(fly.pos) && (fly.state === 'landed' || fly.state === 'hover' || fly.speed < 1.5)) {
        if (this.p.weapon === 'hand' && fly.state !== 'landed') {
          // lazy wave instead
        } else {
          this.dropHeld();
          this.aim.copy(fly.pos);
          this.aimLocked = false;
          this.setState('windup');
          return;
        }
      }
    }
    // bald-head tickle → slap own head (if a fly is on it)
    if (onMe && fly.landedOn?.kind === 'head' && this.p.bald && this.irritation > 0.5 && this.swatCD <= 0) {
      this.dropHeld();
      this.aim.copy(fly.pos);
      this.aimLocked = false;
      this.setState('windup');
      return;
    }
    // shoo a hovering fly from the face
    if (st === 'idle' && fly.buzzing && this.seesFly && this.irritation > 0.22 && this.flinchCD <= 0) {
      if (fly.pos.distanceTo(this.rig.headWorld(_p)) < 0.45) {
        this.setState('shoo');
        return;
      }
    }
    if (st !== 'idle') return;
    // periodic nausea
    if (this.fed > 0.55 && ctx.time > this.nextGag) {
      this.nextGag = ctx.time + randRange(3.5, 6.5) * (1.4 - this.fed);
      this.setState('gag');
      return;
    }
    if (this.dozing) return;
    // eat / drink
    if (ctx.time > this.nextEat) {
      this.nextEat = ctx.time + randRange(...this.p.eatEvery);
      if (this.plate.state !== 'smashed' && this.plate.remaining > 0) {
        if (this.plate.contam > 0.12 && this.disgustedBy.has(this.plate) && !this.p.glutton) {
          this.startReact('refuse', 1.3);
          this.addFed(0.04, 'refuse');
          ctx.audio.voice(this, 'hmph');
        } else {
          this.reading = false;
          this.setState('eat');
        }
        return;
      }
    }
    if (ctx.time > this.nextDrink) {
      // the queasier they get, the more they reach for a steadying sip
      this.nextDrink = ctx.time + randRange(...this.p.drinkEvery) * (1 - clamp01(this.fed) * 0.45);
      const fs = fly.landedOn;
      const flyOnGlassSeen = fs?.item === this.drink && this.seesFly;
      if (flyOnGlassSeen && rand() < 0.45) {
        // wave it off the glass instead
        this.setState('shoo');
        return;
      }
      if (this.drink.state === 'ok' && this.drink.fill > 0.12) {
        this.reading = false;
        this.setState('drink');
        return;
      }
    }
  }

  inReach(p: THREE.Vector3) {
    const arm = this.weaponArm;
    const sh = this.rig.torso.localToWorld(_q.copy(arm.shoulder));
    const d = sh.distanceTo(p);
    if (d > this.p.reach + 0.18 + this.rageBoost * 0.08) return false;
    // must be roughly in front
    const fwd = V3(Math.sin(this.seat.yaw), 0, Math.cos(this.seat.yaw));
    const to = V3().subVectors(p, this.rig.root.position).setY(0).normalize();
    return fwd.dot(to) > -0.25 || d < 0.35;
  }

  setState(s: GState) {
    this.st = s;
    this.stT = 0;
    this.phase = 0;
  }

  // ---------------------------------------------------------------------------
  // State behaviours
  // ---------------------------------------------------------------------------
  private runState(dt: number, t: number) {
    const r = this.rig;
    const fly = ctx.fly;
    const [R, Lh] = r.arms;
    // default targets
    let lookAt: THREE.Vector3 | null = null;
    for (const a of r.arms) {
      a.speed = 9;
      a.handUp.set(0, 1, 0);
    }
    r.leanT = 0.05;
    r.sideLeanT = 0;
    r.headRollT *= 0.9;
    r.bob = 0;
    this.ring.visible = false;
    this.indicator = '';

    switch (this.st) {
      case 'idle': {
        this.idleBody(dt, t);
        lookAt = this.idleLookTarget(dt);
        break;
      }
      case 'eat': {
        const arm = this.eatArm;
        const plate = this.plate;
        const mouth = r.mouthWorld(V3());
        const fwd = r.forwardWorld(V3());
        if (this.phase === 0) {
          plate.topPos(arm.target);
          arm.target.y += 0.04;
          lookAt = plate.worldPos(V3());
          r.leanT = 0.25;
          if (this.stT > 0.55) {
            this.phase = 1;
            this.stT = 0;
            const m = plate.takeBite();
            if (!m) {
              this.setState('idle');
              break;
            }
            this.morsel = m;
            ctx.scene.add(m);
            this.morselSurface = { kind: 'food', proxy: new THREE.Mesh(), anchor: m, item: plate, guest: this, enabled: true };
            this.positionMorsel(arm);
            // the fly gets scooped up with the bite!
            if (fly.state === 'landed' && fly.landedOn?.item === plate) {
              fly.reanchor(m, this.morselSurface);
            }
          }
        } else if (this.phase === 1) {
          // lift to mouth
          const k = easeOutCubic(clamp01(this.stT / 0.6));
          const p0 = plate.topPos(V3()).setY(TABLE.y + 0.1);
          const p1 = mouth.clone().addScaledVector(fwd, 0.06);
          arm.target.copy(p0).lerp(p1, k);
          arm.speed = 20;
          this.positionMorsel(arm);
          lookAt = this.morsel ? this.morsel.position : mouth;
          this.faceOverride = { open: k * 0.8, smile: 0.5 };
          // fly escapes from the fork right in front of them
          const lt = fly.lastTakeoff;
          if (lt.surface === this.morselSurface && t - lt.time < 0.05 && k > 0.45) {
            this.mouthEscape();
            break;
          }
          if (this.stT > 0.6) {
            this.phase = 2;
            this.stT = 0;
            this.bite();
          }
        } else {
          // chew
          arm.target.copy(r.restHand(arm, V3()));
          const chew = Math.abs(Math.sin(this.stT * 14));
          this.faceOverride = { open: chew * 0.35, smile: 0.5 + (this.p.glutton ? 0.3 : 0) };
          r.bob = Math.sin(this.stT * 14) * 0.004;
          if (this.stT > 1.1) this.setState('idle');
        }
        break;
      }
      case 'drink': {
        const arm = this.eatArm;
        const glass = this.drink;
        const mouth = r.mouthWorld(V3());
        const fwd = r.forwardWorld(V3());
        lookAt = glass.worldPos(V3());
        if (glass.state === 'tipped' || glass.state === 'smashed') {
          this.releaseGlass();
          this.setState('idle');
          break;
        }
        if (this.phase === 0) {
          glass.worldPos(arm.target);
          arm.target.y += glass.height * 0.45;
          r.leanT = 0.2;
          if (this.stT > 0.45) {
            this.phase = 1;
            this.stT = 0;
            this.holdingGlass = true;
            glass.state = 'held';
            this.glassStartQuat.copy(glass.group.quaternion);
          }
        } else if (this.phase === 1 || this.phase === 2) {
          const k = this.phase === 1 ? easeOutCubic(clamp01(this.stT / 0.6)) : 1;
          const p0 = glass.home.clone().setY(TABLE.y + glass.height * 0.45);
          const p1 = mouth.clone().addScaledVector(fwd, 0.08).add(V3(0, -glass.height * 0.55, 0));
          arm.target.copy(p0).lerp(p1, k);
          arm.speed = 16;
          this.positionGlass(arm, this.phase === 2 ? 1 : k * 0.3);
          lookAt = glass.mouthWorld(V3());
          const flyOn = fly.state === 'landed' && fly.landedOn?.item === glass;
          const lt = fly.lastTakeoff;
          const justLeft = lt.surface?.item === glass && t - lt.time < 0.08;
          if (this.phase === 1) {
            this.faceOverride = { open: 0.15, pucker: 0.5 * k };
            if (this.stT > 0.6) {
              this.phase = 2;
              this.stT = 0;
              if (flyOn) {
                // a fly on the rim — right at the lips!
                this.spitTake(true);
                break;
              }
            }
            if (justLeft && k > 0.6) {
              // startled by a fly bursting off the rim: slosh wine down the shirt
              this.startleSpill();
              break;
            }
          } else {
            this.faceOverride = { pucker: 0.85, open: 0.1, lid: 0.5 };
            if (this.stT < 0.05) glass.sip();
            if (flyOn || (justLeft && this.stT > 0.05)) {
              this.spitTake(flyOn);
              break;
            }
            if (this.stT > 0.85) {
              this.phase = 3;
              this.stT = 0;
            }
          }
        } else {
          const k = easeOutCubic(clamp01(this.stT / 0.5));
          const p1 = glass.home.clone().setY(TABLE.y + glass.height * 0.45);
          arm.target.lerp(p1, k);
          this.positionGlass(arm, 1 - k);
          if (this.stT > 0.5) {
            this.releaseGlass();
            this.setState('idle');
          }
        }
        break;
      }
      case 'windup':
      case 'strike':
      case 'recover':
        lookAt = this.runSwat(dt, t);
        break;
      case 'shoo': {
        const head = r.headWorld(V3());
        const fwd = r.forwardWorld(V3());
        const wave = Math.sin(this.stT * 18);
        const side = V3(-fwd.z, 0, fwd.x);
        const base = head.clone().addScaledVector(fwd, 0.22).add(V3(0, -0.02, 0));
        const arm = this.p.weapon === 'fan' ? Lh : R;
        arm.target.copy(base).addScaledVector(side, wave * 0.14);
        arm.speed = 26;
        lookAt = fly.pos;
        this.faceOverride = { smile: -0.4, browAng: 0.6, lowerLid: 0.4 };
        if (fly.state === 'landed' && fly.landedOn?.item === this.drink) {
          arm.target.copy(this.drink.mouthWorld(V3())).addScaledVector(side, wave * 0.1).add(V3(0, 0.06, 0));
          lookAt = this.drink.worldPos(V3());
          if (this.stT > 0.45) {
            fly.knockOff(V3().subVectors(fly.pos, head).setY(0), 0.45);
            ctx.audio.sfx('whoosh', fly.pos, 0.6);
          }
        } else if (fly.buzzing && arm.hand.getWorldPosition(V3()).distanceTo(fly.pos) < 0.13) {
          fly.knockOff(V3().subVectors(fly.pos, head), 0.5);
          ctx.audio.sfx('whoosh', fly.pos, 0.6);
        }
        if (this.stT > 0.9) {
          this.flinchCD = 1.2;
          this.setState('idle');
        }
        break;
      }
      case 'crosseyed': {
        // staring at the fly on the tip of the nose
        this.faceOverride = { cross: 1, bulge: 0.6, open: 0.25, smile: -0.2, browAng: -0.5 };
        r.headPitchT = 0.25;
        r.leanT = -0.1;
        this.indicator = '!';
        if (this.stT < dt * 1.5) {
          ctx.prank('crosseye', r.noseTip.getWorldPosition(V3()));
          ctx.audio.voice(this, 'hmm');
        }
        const still = fly.state === 'landed' && fly.landedOn?.guest === this && fly.landedOn.kind === 'nose';
        if (!still && this.stT > 0.25) {
          // it left — blink, relief, mild annoyance
          this.flinchCD = 1.0;
          this.irritation = Math.min(1, this.irritation + 0.2);
          this.startReact('glare', 0.7);
          break;
        }
        if (this.stT > 0.95) {
          if (this.p.noseReact === 'sneeze') {
            this.sneezeDir.copy(r.forwardWorld(V3()));
            this.setState('sneeze');
          } else if (this.p.noseReact === 'flail') {
            this.setState('flail');
          } else {
            this.aim.copy(r.noseTip.getWorldPosition(V3()));
            this.aimLocked = false;
            this.setState('windup');
          }
        }
        break;
      }
      case 'sneeze': {
        const build = this.stT < 1.15;
        if (build) {
          const k = this.stT / 1.15;
          r.headPitchT = -0.35 * k;
          r.leanT = -0.15 * k;
          this.faceOverride = { open: 0.3 + k * 0.4, lid: 0.85 - k * 0.7, browAng: -0.6, cross: this.flyIsOnMe() ? 0.6 : 0, smile: 0 };
          if (this.phase === 0) {
            this.phase = 1;
            ctx.audio.voice(this, 'ahh');
          }
          if (this.stT > 0.6 && this.phase === 1) {
            this.phase = 2;
            ctx.audio.voice(this, 'ahh');
          }
        } else {
          if (this.phase < 3) {
            this.phase = 3;
            this.doSneeze();
          }
          r.headPitchT = 0.45;
          r.leanT = 0.35;
          this.faceOverride = { open: 0.7, lid: 0.1, smile: 0 };
          if (this.stT > 1.9) this.setState('idle');
        }
        break;
      }
      case 'spit': {
        // cheeks bulge, then PFFFT
        const arm = this.eatArm;
        if (this.holdingGlass) this.positionGlass(arm, 0.4);
        if (this.stT < 0.3) {
          this.faceOverride = { puff: 1, bulge: 0.9, cross: this.phase === 1 ? 0.7 : 0, smile: 0 };
          r.leanT = -0.12;
        } else {
          if (this.phase < 5) {
            this.phase = 5;
            const mouth = r.mouthWorld(V3());
            const dir = r.forwardWorld(V3());
            dir.y -= 0.15;
            ctx.mess.spray(mouth, dir, this.drink.liquidColor, this.drink.drink === 'tea' ? 'tea' : 'wine', this);
            ctx.audio.sfx('spit', mouth);
            ctx.emit({ type: 'spit', pos: mouth, loud: 1.0, gross: 0.12, source: this, chain: true });
            ctx.prank('spittake', mouth);
            ctx.game.chainHit(this, mouth);
            this.addFed(0.12, 'spit', true);
            this.drink.fill = Math.max(0.1, this.drink.fill - 0.3);
            this.drink.liquid.scale.y = 0.4 + this.drink.fill * 0.6;
            if (fly.state === 'landed' && fly.landedOn?.item === this.drink) fly.knockOff(dir, 0.5);
          }
          r.leanT = 0.3;
          this.faceOverride = { open: 0.7, pucker: 0.6, bulge: 0.4, smile: -0.3 };
          if (this.holdingGlass && this.stT > 0.9) this.positionGlass(arm, 0);
          if (this.stT > 1.3) {
            this.releaseGlass();
            this.startReact('wipe', 1.0);
          }
        }
        break;
      }
      case 'react': {
        lookAt = this.runReact(dt, t);
        break;
      }
      case 'gag': {
        // hand clamps to mouth, cheeks puff, eyes water
        const mouth = r.mouthWorld(V3());
        const fwd = r.forwardWorld(V3());
        R.target.copy(mouth).addScaledVector(fwd, 0.06);
        R.speed = 18;
        const k = Math.sin(clamp01(this.stT / 1.0) * Math.PI);
        this.faceOverride = { puff: k, bulge: 0.5 * k, lid: 0.55, green: Math.min(1, this.fed + 0.25) };
        r.leanT = 0.15 + 0.15 * k;
        r.bob = -k * 0.02;
        if (this.phase === 0) {
          this.phase = 1;
          ctx.audio.voice(this, 'hwurp');
          ctx.emit({ type: 'gag', pos: r.headWorld(V3()), loud: 0.5, gross: 0.03 * this.fed, source: this, chain: true });
        }
        if (this.stT > 1.0) this.setState('idle');
        break;
      }
      case 'flail': {
        lookAt = this.runFlail(dt, t);
        break;
      }
      case 'startle': {
        // granny leaps out of her skin — and the table jumps with her
        const k = this.stT;
        if (this.phase === 0) {
          this.phase = 1;
          this.wake(false);
          ctx.audio.voice(this, 'scream');
          ctx.audio.sfx('bang', r.headWorld(V3()));
          ctx.prank('trumpet', r.headWorld(V3()));
          this.addFed(0.09, 'startle', true);
          this.irritation = 1.1;
          const p = this.plate.worldPos(V3());
          this.tableBang(p, 1.0, 1.15);
          ctx.emit({ type: 'startle', pos: r.headWorld(V3()), loud: 1.2, gross: 0.04, source: this, chain: true });
          ctx.game.chainHit(this, p);
          if (fly.state === 'landed' && fly.landedOn?.guest === this) fly.knockOff(r.forwardWorld(V3()), 0.6);
        }
        r.bob = Math.max(0, Math.sin(Math.min(1, k / 0.5) * Math.PI)) * 0.12;
        for (const a of r.arms) {
          a.target.copy(r.headWorld(V3())).add(V3(a.side * 0.25, 0.2, 0)).applyMatrix4(new THREE.Matrix4());
          a.speed = 20;
        }
        this.faceOverride = { open: 1, bulge: 1, browY: 1, smile: -0.2 };
        if (k > 1.1) this.setState('idle');
        break;
      }
      case 'flee':
      case 'slip':
        lookAt = this.runFlee(dt, t);
        break;
      case 'gone':
        break;
    }
    // ring indicator for incoming swats
    if (lookAt) r.lookAt(lookAt);
    else if (this.tracking && this.active) r.lookAt(this.seesFly ? fly.pos : this.searchPoint(t));
  }

  private faceOverride: Partial<Record<keyof import('./rig').FaceParams, number>> | null = null;

  private searchPoint(t: number) {
    return this.lastSeen.clone().add(V3(Math.sin(t * 2.5) * 0.3, 0, Math.cos(t * 1.7) * 0.2));
  }

  private idleBody(dt: number, t: number) {
    const r = this.rig;
    const [R, Lh] = r.arms;
    r.restHand(R, R.target);
    r.restHand(Lh, Lh.target);
    // personality idles
    const head = r.headWorld(V3());
    const fwd = r.forwardWorld(V3());
    if (this.p.reads && this.reading && !this.tracking) {
      const np = this.props.newspaper!;
      np.rolledT = 0;
      if (np.group.parent !== r.torso) r.torso.add(np.group);
      const hy = r.headPivot.position.y + r.b * 0.6;
      np.group.position.set(0, hy, 0.3);
      np.group.rotation.set(0.1, 0, 0);
      for (const a of r.arms) {
        a.target.copy(r.torso.localToWorld(V3(a.side * 0.17, hy - 0.05, 0.27)));
      }
      r.headPitchT = 0.1;
    } else if (this.props.newspaper) {
      const np = this.props.newspaper;
      np.rolledT = 0.55;
      if (np.group.parent !== R.hand) {
        R.hand.add(np.group);
      }
      np.group.position.set(0, 0, 0.12);
      np.group.rotation.set(Math.PI / 2, 0, 0);
    }
    if (this.props.fan && !this.tracking) {
      // lazily fanning herself
      this.props.fan.openT = 1;
      Lh.target.copy(head).addScaledVector(fwd, 0.18).add(V3(0, -0.06, 0)).addScaledVector(V3(fwd.z, 0, -fwd.x), -0.12 + Math.sin(t * 6) * 0.04);
      Lh.handUp.set(0, 1, 0);
    }
    if (this.props.trumpet) {
      const k = this.listen;
      const ear = r.head.localToWorld(V3(r.a * 1.1, 0.0, 0.0));
      const lap = r.restHand(Lh, V3());
      Lh.target.copy(lap).lerp(ear.add(V3(0.03, -0.02, 0)), k);
      Lh.handUp.set(0, 1, 0);
      this.props.trumpet.rotation.set(0, k * -1.2, 0);
    }
    if (this.p.squeamish && Math.sin(t * 0.7 + 1) > 0.85) {
      // dab the lips with a napkin
      R.target.copy(r.mouthWorld(V3())).addScaledVector(fwd, 0.07);
    }
    if (this.id === 'dandy' && Math.sin(t * 0.5) > 0.8 && !this.toupeeLost) {
      // pat the hair-piece... and feel something crawling on it
      R.target.copy(r.headWorld(V3())).add(V3(0, r.b * 0.9, 0)).addScaledVector(fwd, -0.02);
      const fs = ctx.fly.landedOn;
      if (ctx.fly.state === 'landed' && fs?.guest === this && fs.kind === 'toupee' && this.swatCD <= 0) {
        this.irritation = 1;
        this.aim.copy(ctx.fly.pos);
        this.aimLocked = false;
        ctx.audio.voice(this, 'gasp');
        this.setState('windup');
      }
    }
    // chatting
    this.talkT -= dt;
    if (this.talkT <= 0) {
      this.talking = rand() < 0.45 ? randRange(1, 2.5) : 0;
      this.talkT = randRange(2, 4);
      if (this.talking > 0 && rand() < 0.4) ctx.audio.chatter(this);
    }
    this.laughT -= dt;
    if (this.laughT < -randRange(8, 16) && this.fed < 0.35) {
      this.laughT = 1.2;
      ctx.audio.voice(this, 'laugh');
    }
    if (this.p.hostess && !this.tracking && this.fed < 0.6) {
      // nose in the air
      r.headPitchT = -0.28;
    }
    if (this.dozing) {
      r.headPitchT = 0.55;
      r.headRollT = 0.25;
      r.leanT = -0.05;
      r.bob = Math.sin(t * 1.2) * 0.008;
      this.indicator = 'Zz';
    }
  }

  private pickIdleLook() {
    const opts: THREE.Vector3[] = [];
    for (const g of ctx.guests ?? []) if (g !== this && g.active) opts.push(g.rig.headWorld(V3()));
    if (this.plate) opts.push(this.plate.worldPos(V3()), this.plate.worldPos(V3()));
    opts.push(V3(0, 1.0, -0.2));
    this.idleLook.copy(opts.length ? pick(opts) : V3(0, 1, 0));
    this.idleLookT = randRange(1.8, 4.5);
  }

  private idleLookTarget(dt: number): THREE.Vector3 | null {
    if (this.attention && ctx.time < this.attention.until) return this.attention.pos;
    if (this.tracking) return null;
    this.idleLookT -= dt;
    if (this.idleLookT <= 0) this.pickIdleLook();
    if (this.dozing) return null;
    if (this.reading) return this.props.newspaper!.group.getWorldPosition(V3());
    return this.idleLook;
  }

  // ---------------------------------------------------------------------------
  // Eating and drinking helpers
  // ---------------------------------------------------------------------------
  private positionMorsel(arm: import('./rig').Arm) {
    if (!this.morsel) return;
    arm.hand.updateWorldMatrix(true, false);
    arm.hand.localToWorld(this.morsel.position.set(0, 0.035, 0.07));
  }

  private bite() {
    const fly = ctx.fly;
    const plate = this.plate;
    const mouth = this.rig.mouthWorld(V3());
    if (fly.state === 'landed' && fly.landedOn === this.morselSurface) {
      // GULP. The fly went in.
      this.gulpFly();
    } else {
      ctx.audio.sfx('chomp', mouth, 0.6);
      if (plate.contam > 0.12) {
        // eats contaminated food; anyone who saw the fly on it is appalled
        let witnesses = 0;
        for (const g of ctx.guests) {
          if (g === this || !g.active) continue;
          if (plate.seenBy.has(g) && g.canSee(mouth, false)) witnesses++;
        }
        if (witnesses > 0 || plate.seenBy.size > 0) {
          ctx.emit({ type: 'eatContam', pos: mouth, loud: 0.5, gross: 0.2, source: this, chain: true });
          ctx.prank('flysnack', mouth);
          ctx.game.chainHit(this, mouth);
        }
        if (plate.seenBy.has(this) && !this.p.glutton) this.addFed(0.2, 'ate-contam');
      }
    }
    if (this.morsel) {
      ctx.scene.remove(this.morsel);
      this.morsel = null;
      this.morselSurface = null;
    }
  }

  private gulpFly() {
    const fly = ctx.fly;
    const mouth = this.rig.mouthWorld(V3());
    const lifeLost = ctx.game.flySwallowed(this);
    this.addFed(0.7, 'gulp', true);
    ctx.prank('gulp', mouth);
    ctx.emit({ type: 'eatfly', pos: mouth, loud: 1.0, gross: 0.25, source: this, chain: true });
    ctx.game.chainHit(this, mouth);
    ctx.audio.voice(this, 'hwurp');
    this.startReact('shock', 1.4);
    // cough it back out
    if (fly.state === 'landed' || fly.state === 'stunned') {
      fly.knockOff(this.rig.forwardWorld(V3()), 0.6);
    }
    void lifeLost;
  }

  private mouthEscape() {
    const mouth = this.rig.mouthWorld(V3());
    this.addFed(0.45, 'mouth-escape', true);
    ctx.prank('mouthescape', mouth);
    ctx.emit({ type: 'eatfly', pos: mouth, loud: 0.8, gross: 0.15, source: this, chain: true });
    ctx.game.chainHit(this, mouth);
    ctx.audio.voice(this, 'eugh');
    if (this.morsel) {
      // drops the forkful
      const m = this.morsel;
      this.morsel = null;
      ctx.mess.launchObject(m, m.position.clone(), V3(randRange(-0.3, 0.3), 0.5, randRange(-0.3, 0.3)), 'food', '#d9a45a', 0.03, this, this);
    }
    this.morselSurface = null;
    this.startReact('shock', 1.6);
  }

  private positionGlass(arm: import('./rig').Arm, tilt: number) {
    const g = this.drink.group;
    arm.hand.updateWorldMatrix(true, false);
    const hp = arm.hand.getWorldPosition(V3());
    const fwd = this.rig.forwardWorld(V3()).setY(0).normalize();
    g.position.copy(hp).add(V3(0, -this.drink.height * 0.4, 0)).addScaledVector(fwd, 0.02);
    // tilt toward the face
    const axis = V3(fwd.z, 0, -fwd.x);
    g.quaternion.setFromAxisAngle(axis, -tilt * 1.1);
  }

  private releaseGlass() {
    if (!this.holdingGlass) return;
    this.holdingGlass = false;
    const g = this.drink;
    if (g.state === 'held') {
      g.state = 'ok';
      g.group.position.copy(g.home);
      g.group.quaternion.identity();
    }
  }

  private dropHeld() {
    if (this.holdingGlass) this.releaseGlass();
    if (this.morsel) {
      // drop the morsel back on the plate
      ctx.scene.remove(this.morsel);
      if (ctx.fly.landedOn === this.morselSurface && ctx.fly.state === 'landed') {
        ctx.fly.knockOff(V3(0, 1, 0), 0.25);
      }
      this.morsel = null;
      this.morselSurface = null;
    }
  }

  private spitTake(sawFly: boolean) {
    this.setState('spit');
    this.phase = sawFly ? 1 : 0;
    ctx.audio.voice(this, 'mmph');
  }

  private startleSpill() {
    // jerks the glass and sloshes it down the front
    const pos = this.rig.torso.localToWorld(V3(0, this.rig.look.torsoH * 0.6, this.rig.look.torsoD));
    this.drink.fill = Math.max(0.1, this.drink.fill - 0.35);
    this.drink.liquid.scale.y = 0.4 + this.drink.fill * 0.6;
    this.receiveMess(this.drink.drink === 'tea' ? 'tea' : 'wine', this.drink.liquidColor, pos, 'body', null);
    ctx.audio.sfx('pour', pos);
    this.releaseGlass();
  }

  private doSneeze() {
    const r = this.rig;
    const mouth = r.mouthWorld(V3());
    const dir = this.sneezeDir.clone().setY(-0.25).normalize();
    ctx.audio.voice(this, 'achoo');
    const hits = ctx.mess.spray(mouth, dir, '#d8ecf2', 'sneeze', this);
    ctx.emit({ type: 'sneeze', pos: mouth, loud: 1.0, gross: 0.16, source: this, chain: true });
    ctx.prank('sneeze', mouth);
    ctx.game.chainHit(this, mouth);
    if (ctx.fly.landedOn?.guest === this) ctx.fly.knockOff(dir, 0.9);
    this.wake(false);
    this.addFed(0.05, 'sneeze');
    void hits;
  }

  // ---------------------------------------------------------------------------
  // Swatting
  // ---------------------------------------------------------------------------
  private weaponLen() {
    switch (this.p.weapon) {
      case 'newspaper': return 0.32;
      case 'cane': return 0.55;
      case 'fan': return 0.14;
      case 'handbag': return 0.12;
      default: return 0.04;
    }
  }

  private runSwat(dt: number, t: number): THREE.Vector3 | null {
    const r = this.rig;
    const fly = ctx.fly;
    const arm = this.isSelfNoseSlap() ? r.arms[0] : this.weaponArm;
    const sh = r.torso.localToWorld(V3().copy(arm.shoulder));
    const wind = Math.max(0.32, this.p.windup * (1 - this.rageBoost * 0.08));
    const selfSlap = this.isSelfNoseSlap();
    const prepT = wind * 0.45;
    const raiseT = wind * 0.55;
    this.indicator = '!';
    // weapon in hand
    this.equipWeapon(arm, true);
    if (this.st === 'windup') {
      if (this.stT < dt * 1.5 && this.phase === 0) {
        this.phase = 1;
        ctx.audio.sfx(this.p.weapon === 'newspaper' ? 'rustle' : this.p.weapon === 'fan' ? 'snap' : 'whoosh', r.headWorld(V3()), 0.8);
        ctx.audio.voice(this, this.p.weapon === 'newspaper' ? 'harrumph' : 'hmph');
        ctx.game.onSwatWindup(this);
      }
      // track the fly until we commit
      const prep = this.stT < prepT;
      if (prep && (this.seesFly || this.flyIsOnMe()) && !this.aimLocked) {
        this.aim.lerp(fly.pos, Math.min(1, dt * 14));
      }
      if (!prep && !this.aimLocked) {
        this.aimLocked = true;
        ctx.audio.sfx('whoosh', this.aim, 0.4);
      }
      // raise high
      const up = this.aim.clone().lerp(sh, 0.45).add(V3(0, 0.42 + (this.p.weapon === 'handbag' ? 0.2 : 0), 0));
      arm.target.copy(up);
      arm.speed = 14;
      arm.handUp.set(0, 0, -1);
      if (this.p.weapon === 'handbag') r.arms[1].target.copy(up).add(V3(0.05, 0, 0));
      r.leanT = -0.12;
      this.faceOverride = { browAng: 1, smile: -0.3, lowerLid: 0.45, open: 0.12 };
      // warning ring on the target
      const k = clamp01(this.stT / wind);
      this.showRing(k);
      if (this.stT >= wind) {
        this.setState('strike');
        this.strikeFrom.copy(arm.cur);
      }
      return this.aim;
    }
    if (this.st === 'strike') {
      const dur = 0.09;
      const k = easeInCubic(clamp01(this.stT / dur));
      const dir = V3().subVectors(this.aim, sh).normalize();
      const hit = this.aim.clone().addScaledVector(dir, -this.weaponLen() * 0.85).add(V3(0, 0.03, 0));
      arm.target.copy(this.strikeFrom).lerp(hit, k);
      arm.cur.copy(arm.target);
      arm.speed = 60;
      arm.handUp.set(0, 1, 0);
      if (this.p.weapon === 'handbag') r.arms[1].target.copy(arm.target).add(V3(0.05, 0, 0));
      r.leanT = 0.45;
      this.showRing(1);
      this.faceOverride = { browAng: 1, smile: -0.5, open: 0.5 };
      if (this.stT >= dur) {
        this.doImpact(selfSlap);
        this.setState('recover');
      }
      return this.aim;
    }
    // recover
    arm.target.copy(this.aim).lerp(sh, 0.3).add(V3(0, 0.05, 0));
    arm.speed = this.stT < 0.35 ? 3 : 8;
    if (this.p.weapon === 'handbag') r.arms[1].target.copy(arm.target);
    r.leanT = this.stT < 0.35 ? 0.4 : 0.1;
    if (this.stT > 0.75) {
      this.equipWeapon(arm, false);
      this.setState('idle');
    }
    return this.stT < 0.4 ? this.aim : null;
  }

  private isSelfNoseSlap() {
    // aim at own face → use the bare hand
    const head = this.rig.headWorld(_q);
    return head.distanceTo(this.aim) < 0.24;
  }

  private equipWeapon(arm: import('./rig').Arm, on: boolean) {
    const pr = this.props;
    if (this.isSelfNoseSlap() && on) return;
    if (pr.cane) {
      if (on && pr.cane.parent !== arm.hand) {
        arm.hand.add(pr.cane);
        pr.cane.position.set(0, 0, 0.02);
        pr.cane.rotation.set(-Math.PI / 2, 0, 0);
      } else if (!on && pr.cane.parent === arm.hand) {
        ctx.scene.add(pr.cane);
        const [cx, cz] = seatToWorld(this.seat, 0.3, 0.28);
        pr.cane.position.set(cx, 0.82, cz);
        pr.cane.rotation.set(0.25, this.seat.yaw, 0.1);
      }
    }
    if (pr.fan) pr.fan.openT = on ? 0 : 1;
    if (pr.newspaper && on) {
      pr.newspaper.rolledT = 1;
      if (pr.newspaper.group.parent !== arm.hand) arm.hand.add(pr.newspaper.group);
      pr.newspaper.group.position.set(0, 0, 0.14);
      pr.newspaper.group.rotation.set(Math.PI / 2, 0, 0);
    }
    if (pr.handbag) {
      if (on && pr.handbag.parent !== arm.hand) {
        arm.hand.add(pr.handbag);
        pr.handbag.position.set(0, -0.04, 0.06);
        pr.handbag.rotation.set(0, 0, 0);
      } else if (!on && pr.handbag.parent === arm.hand) {
        ctx.scene.add(pr.handbag);
        const [bx, bz] = seatToWorld(this.seat, 0.48, -0.26);
        pr.handbag.position.set(bx, TABLE.y, bz);
        pr.handbag.rotation.set(0, this.seat.yaw + 0.3, 0);
      }
    }
  }

  private showRing(k: number) {
    this.ring.visible = true;
    const m = this.ring.material as THREE.MeshBasicMaterial;
    m.opacity = 0.35 + k * 0.6;
    const flash = this.aimLocked ? 1 + Math.sin(ctx.time * 40) * 0.08 : 1;
    this.ring.scale.setScalar((1.6 - k * 0.6) * (this.p.hitR / 0.13) * flash);
    this.ring.position.copy(this.aim);
    // lay it on the surface under the aim
    const onTable = Math.abs(this.aim.x) < TABLE.halfW && Math.abs(this.aim.z) < TABLE.halfL;
    if (this.aim.y < TABLE.y + 0.25 && onTable) this.ring.position.y = Math.max(TABLE.y + 0.004, Math.min(this.aim.y, TABLE.y + 0.004));
    else this.ring.position.y = this.aim.y + 0.005;
    m.color.set(this.aimLocked ? '#ff2a1a' : '#ff9a2a');
  }

  private doImpact(selfSlap: boolean) {
    const fly = ctx.fly;
    const aim = this.aim.clone();
    const hitR = selfSlap ? 0.09 : this.p.hitR;
    const dir = V3().subVectors(aim, this.rig.root.position).setY(0).normalize();
    const imp: Impact = { pos: aim, radius: hitR, strength: 1, dir, source: this, kind: this.p.weapon === 'handbag' ? 'bag' : 'swat' };
    let hitSomething = false;
    // the fly
    const flyHit = fly.pos.distanceTo(aim) < hitR + 0.035 && fly.state !== 'dead';
    const snd = this.p.weapon === 'newspaper' ? 'thwack' : this.p.weapon === 'handbag' ? 'thump' : this.p.weapon === 'cane' ? 'whack' : 'slap';
    ctx.audio.sfx(snd, aim);
    ctx.game.shake(this.p.weapon === 'handbag' ? 0.5 : 0.25);
    if (flyHit && fly.squash()) {
      hitSomething = true;
      ctx.game.flyHit(this);
      this.irritation = 0;
      this.rageBoost = 0;
      this.startReact('triumph', 1.4);
    }
    // heads (own face for nose-slaps, neighbours for misses)
    for (const g of ctx.guests) {
      if (!g.active) continue;
      const c = V3();
      const r = g.headSphere(c);
      if (c.distanceTo(aim) < r + hitR * 0.7) {
        g.smacked(this, aim, 1);
        hitSomething = true;
      }
    }
    if (ctx.butler?.active) {
      const c = V3();
      const r = ctx.butler.headSphere(c);
      if (c.distanceTo(aim) < r + hitR * 0.7) {
        ctx.butler.smacked(this, aim);
        hitSomething = true;
      }
      if (ctx.butler.trayHit(aim, hitR)) hitSomething = true;
    }
    // things on the table
    let tableHit = false;
    for (const it of ctx.items) {
      const ip = it.worldPos(V3());
      const dxz = Math.hypot(ip.x - aim.x, ip.z - aim.z);
      if (dxz < it.radius + hitR && aim.y < ip.y + it.height + 0.12 && aim.y > ip.y - 0.1) {
        it.impact(imp);
        hitSomething = true;
        tableHit = true;
      }
    }
    if (!selfSlap && Math.abs(aim.x) < TABLE.halfW + 0.02 && Math.abs(aim.z) < TABLE.halfL + 0.02 && aim.y < TABLE.y + 0.2) {
      this.tableBang(aim, this.p.weapon === 'handbag' ? 0.9 : 0.6, this.p.weapon === 'handbag' ? 0.75 : 0.5);
      tableHit = true;
    }
    if (!flyHit) {
      // missed!
      this.rageBoost = Math.min(4, this.rageBoost + 1);
      this.irritation = Math.max(this.irritation * 0.75, this.p.swatAt * 0.8);
      this.swatCD = this.p.cooldown * (this.p.reads ? 0.7 : 1);
      ctx.game.onSwatMiss(this, aim, hitSomething || tableHit);
      ctx.emit({ type: 'swatMiss', pos: aim, loud: 0.8, gross: 0.02, source: this, chain: hitSomething });
      if (!selfSlap) ctx.audio.voice(this, 'harrumph', 0.6);
    } else {
      this.swatCD = this.p.cooldown;
    }
  }

  tableBang(at: THREE.Vector3, strength: number, radius: number) {
    for (const it of ctx.items) {
      const d = it.worldPos(V3()).distanceTo(at);
      if (d < radius) it.bump(strength * (1 - d / radius) + 0.2, at);
    }
    ctx.emit({ type: 'bang', pos: at.clone(), loud: 0.7 * strength, gross: 0.0, source: this, chain: true });
    if (strength >= 0.9) ctx.prank('tablebang', at);
    if (ctx.fly.state === 'landed' && ctx.fly.landedOn?.kind === 'table' && ctx.fly.pos.distanceTo(at) < radius * 0.6) {
      ctx.fly.knockOff(V3().subVectors(ctx.fly.pos, at), 0.3);
    }
  }

  // ---------------------------------------------------------------------------
  private runFlail(dt: number, t: number): THREE.Vector3 | null {
    const r = this.rig;
    const fly = ctx.fly;
    const head = r.headWorld(V3());
    const fwd = r.forwardWorld(V3()).setY(0).normalize();
    const side = V3(-fwd.z, 0, fwd.x);
    if (this.phase === 0) {
      this.phase = 1;
      this.flailHits = 0;
      ctx.audio.voice(this, 'scream');
      ctx.emit({ type: 'scream', pos: head.clone(), loud: 1.4, gross: 0.03, source: this, chain: true });
      ctx.prank('scream', head);
      this.addFed(0.02, 'panic');
    }
    const dur = 1.7;
    this.indicator = '!';
    this.faceOverride = { open: 0.95, bulge: 1, browY: 1, browAng: -0.8, smile: -0.3 };
    for (const a of r.arms) {
      const ph = t * 13 + (a.side > 0 ? 1.7 : 0);
      a.target.copy(head).addScaledVector(fwd, 0.3 + Math.sin(ph * 0.7) * 0.2).addScaledVector(side, a.side * (0.15 + Math.sin(ph) * 0.3)).add(V3(0, -0.2 + Math.cos(ph * 1.3) * 0.25, 0));
      a.speed = 24;
    }
    r.sideLeanT = Math.sin(t * 9) * 0.15;
    r.headRollT = Math.sin(t * 11) * 0.25;
    // flailing hands smack whatever they pass
    const beat = Math.floor(this.stT / 0.2);
    if (beat > this.flailHits && this.stT < dur) {
      this.flailHits = beat;
      const a = r.arms[beat % 2];
      const hp = a.hand.getWorldPosition(V3());
      // aim the flail a bit downward onto the table
      const p = hp.clone();
      if (p.y > TABLE.y + 0.12) p.y = lerp(p.y, TABLE.y + 0.05, 0.6);
      const imp: Impact = { pos: p, radius: 0.1, strength: 0.7, dir: fwd.clone(), source: this, kind: 'flail' };
      if (fly.pos.distanceTo(hp) < 0.12 && fly.squash()) {
        ctx.game.flyHit(this);
      }
      for (const it of ctx.items) {
        const ip = it.worldPos(V3());
        if (Math.hypot(ip.x - p.x, ip.z - p.z) < it.radius + 0.08 && p.y < ip.y + it.height + 0.1) {
          if (it.kind === 'glass' || rand() < 0.6) it.impact(imp);
        }
      }
      for (const g of ctx.guests) {
        if (g === this || !g.active) continue;
        const c = V3();
        const rr = g.headSphere(c);
        if (c.distanceTo(hp) < rr + 0.06) g.smacked(this, hp, 0.6);
      }
      ctx.audio.sfx('whoosh', hp, 0.5);
    }
    if (this.stT > dur) {
      this.irritation = 0.15;
      this.swatCD = this.p.cooldown + 1.5;
      this.startReact('wipe', 0.8);
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  private runReact(dt: number, t: number): THREE.Vector3 | null {
    const r = this.rig;
    const [R, Lh] = r.arms;
    r.restHand(R, R.target);
    r.restHand(Lh, Lh.target);
    const k = this.stT / this.reactDur;
    let look: THREE.Vector3 | null = null;
    switch (this.react) {
      case 'shock':
      case 'gasp': {
        this.faceOverride = { open: 0.8, bulge: 0.8, browY: 1, browAng: -0.6, smile: -0.2 };
        r.leanT = -0.25;
        r.bob = Math.sin(Math.min(1, k * 3) * Math.PI) * 0.03;
        Lh.target.copy(r.torso.localToWorld(V3(0.05, r.look.torsoH * 0.8, r.look.torsoD + 0.08)));
        look = this.attention && ctx.time < this.attention.until ? this.attention.pos : null;
        break;
      }
      case 'splattered':
      case 'wipe': {
        // freeze, blink, then slowly wipe the face
        if (k < 0.45) {
          this.faceOverride = { open: 0.3, lid: 0.15 + Math.abs(Math.sin(this.stT * 9)) * 0.5, smile: -0.4, browAng: 0.3 };
          r.leanT = -0.1;
        } else {
          const fwd = r.forwardWorld(V3());
          const sweep = Math.sin((k - 0.45) * 12);
          R.target.copy(r.headWorld(V3())).addScaledVector(fwd, 0.15).add(V3(sweep * 0.06, -0.03, 0));
          R.speed = 14;
          this.faceOverride = { lid: 0.4, smile: -0.6, browAng: 0.5, lowerLid: 0.4 };
        }
        break;
      }
      case 'smacked': {
        this.faceOverride = { cross: 0.7, open: 0.4, lid: 0.7, smile: -0.2, browY: 0.5 };
        r.headRollT = Math.sin(this.stT * 7) * 0.35;
        r.bob = -0.02;
        break;
      }
      case 'refuse': {
        // push the plate away with a sniff
        const pp = this.plate.worldPos(V3());
        R.target.copy(pp).add(V3(0, 0.05, 0));
        this.faceOverride = { smile: -0.6, browAng: 0.5, lowerLid: 0.5, pucker: 0.4 };
        r.leanT = -0.15;
        r.headPitchT = -0.2;
        if (this.stT < dt * 1.5) {
          const away = V3().subVectors(pp, this.rig.root.position).setY(0).normalize().multiplyScalar(0.06);
          this.plate.group.position.add(away);
        }
        look = pp;
        break;
      }
      case 'triumph': {
        this.faceOverride = { smile: 1, open: 0.45, lid: 0.7, browAng: 0.3 };
        r.leanT = -0.15;
        r.bob = Math.sin(this.stT * 10) * 0.01;
        break;
      }
      case 'glare': {
        this.faceOverride = { smile: -0.5, browAng: 1, lowerLid: 0.5 };
        break;
      }
      case 'mortified': {
        Lh.target.copy(r.headWorld(V3())).add(V3(0, 0.12, 0)).addScaledVector(r.forwardWorld(V3()), 0.1);
        this.faceOverride = { lid: 0.3, smile: -0.7, browAng: -1, wobble: 0.5 };
        r.headPitchT = -0.4;
        r.leanT = -0.3;
        break;
      }
      case 'chuckle': {
        this.faceOverride = { smile: 0.9, open: Math.abs(Math.sin(this.stT * 12)) * 0.5, lid: 0.5 };
        r.bob = Math.abs(Math.sin(this.stT * 12)) * 0.01;
        break;
      }
    }
    if (this.stT > this.reactDur) this.setState(this.reactAfter);
    return look;
  }

  // ---------------------------------------------------------------------------
  // Leaving the party
  // ---------------------------------------------------------------------------
  private startFlee() {
    this.dropHeld();
    this.equipWeapon(this.weaponArm, false);
    this.setState('flee');
    this.fleeIdx = 0;
    this.ring.visible = false;
    this.indicator = '';
    this.chairFall = 0;
    this.chairFallDir = rand() < 0.5 ? 1 : -1;
    ctx.audio.voice(this, 'hwurp');
    ctx.audio.sfx('chair', this.rig.root.position);
    // the plate is shoved away, the glass goes over, the napkin hits the lawn
    const away = V3().subVectors(this.plate.worldPos(V3()), this.rig.root.position).setY(0).normalize().multiplyScalar(0.07);
    this.plate.group.position.add(away);
    if (this.drink.state === 'ok' && rand() < 0.65) {
      ctx.later(0.5, () => {
        const toward = V3().subVectors(this.rig.root.position, this.drink.worldPos(V3())).setY(0);
        this.drink.topple(toward.lengthSq() > 1e-4 ? toward : V3(rand() - 0.5, 0, rand() - 0.5));
        ctx.audio.sfx('clink', this.drink.worldPos(V3()));
      });
    }
    const nap = blob(0.08, 0.025, 0.07, clay('#fbf8f2', { normal: 1.2 }), 10);
    nap.position.copy(this.rig.root.position).add(V3(randRange(-0.2, 0.2), 0.02, randRange(-0.2, 0.2)));
    nap.rotation.y = rand() * 3;
    ctx.scene.add(nap);
    ctx.game.onGuestFlee(this);
    ctx.emit({ type: 'flee', pos: this.rig.headWorld(V3()), loud: 1.0, gross: 0.1, source: this, chain: true });
  }

  private runFlee(dt: number, t: number): THREE.Vector3 | null {
    const r = this.rig;
    const [R, Lh] = r.arms;
    const mouth = r.mouthWorld(V3());
    const fwd = r.forwardWorld(V3());
    // hand clamped over mouth throughout
    R.target.copy(mouth).addScaledVector(fwd, 0.05);
    R.speed = 20;
    this.faceOverride = { puff: 1, green: 1, bulge: 0.8, lid: 0.9, browAng: -0.8 };
    if (this.st === 'slip') {
      // flat on the back, legs in the air
      r.fallen = Math.min(1, r.fallen + dt * 6);
      r.running = 0;
      r.standT = 1;
      Lh.target.copy(r.headWorld(V3())).add(V3(0, 0.3, 0));
      this.faceOverride = { open: 0.9, bulge: 1, cross: 0.6, green: 1 };
      if (this.stT > 1.3) {
        this.setState('flee');
        this.phase = 2;
      }
      return null;
    }
    r.fallen = Math.max(0, r.fallen - dt * 3);
    if (this.phase === 0) {
      // freeze, cheeks bulging
      r.bob = 0.01;
      if (this.stT > 0.4) {
        this.phase = 1;
        this.stT = 0;
        r.standT = 1;
      }
      return null;
    }
    if (this.phase === 1) {
      // stand up, push the chair back
      this.chairFall = Math.min(1, this.chairFall + dt * 2.5);
      if (this.stT > 0.45) {
        this.phase = 2;
        this.stT = 0;
        // check for spilled wine right by the chair
        const pd = ctx.mess.slipAt(this.rig.root.position);
        if (pd && rand() < 0.8) this.doSlip();
        if (pd) this.slipT = 2.5;
      }
      return null;
    }
    // run the exit path
    const path = this.seat.exit;
    const wp = path[Math.min(this.fleeIdx, path.length - 1)];
    const pos = r.root.position;
    const to = V3(wp[0] - pos.x, 0, wp[1] - pos.z);
    const dist = to.length();
    const speed = 2.1;
    if (dist < 0.15) {
      this.fleeIdx++;
      if (this.fleeIdx >= path.length) {
        this.vanish();
        return null;
      }
    } else {
      to.normalize();
      pos.addScaledVector(to, Math.min(dist, speed * dt));
      const yaw = Math.atan2(to.x, to.z);
      let dy = yaw - r.root.rotation.y;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      r.root.rotation.y += dy * Math.min(1, dt * 10);
    }
    r.running = 1;
    r.runPhase += dt * 15;
    r.standT = 1;
    Lh.target.copy(r.torso.localToWorld(V3(0.3, r.look.torsoH * 0.6 + Math.sin(r.runPhase) * 0.15, 0.1)));
    if (Math.floor(r.runPhase / Math.PI) !== Math.floor((r.runPhase - dt * 15) / Math.PI)) ctx.audio.sfx('step', pos, 0.35);
    // slippery!
    if (this.phase === 2 && ctx.mess.slipAt(pos) && this.slipT <= 0) this.doSlip();
    this.slipT -= dt;
    // collide with the butler
    if (ctx.butler?.active && ctx.butler.root.position.distanceTo(pos) < 0.45) ctx.butler.bumped(this);
    return null;
  }

  private doSlip() {
    this.setState('slip');
    this.slipT = 2.5;
    ctx.audio.sfx('slip', this.rig.root.position);
    ctx.audio.voice(this, 'scream');
    ctx.prank('slip', this.rig.root.position);
    ctx.emit({ type: 'slip', pos: this.rig.headWorld(V3()), loud: 1.0, gross: 0.06, source: this, chain: true });
    ctx.game.chainHit(this, this.rig.root.position);
    ctx.game.shake(0.35);
    // grabbing at the tablecloth on the way down
    const near = V3(Math.sign(this.seat.x) * TABLE.halfW, TABLE.y, this.rig.root.position.z);
    if (Math.abs(this.rig.root.position.x) < 1.5) this.tableBang(near, 1.0, 0.7);
  }

  private vanish() {
    this.st = 'gone';
    this.gone = true;
    this.active = false;
    this.rig.root.visible = false;
    this.noseSurface.enabled = false;
    this.headSurface.enabled = false;
    if (this.trumpetSurface) this.trumpetSurface.enabled = false;
    ctx.game.onGuestGone(this);
  }

  private updateChair(dt: number) {
    if (!this.chair || this.chairFall <= 0) return;
    const k = easeOutCubic(this.chairFall);
    const yaw = this.seat.yaw;
    this.chair.rotation.set(0, yaw, 0);
    // tip backwards
    const back = V3(-Math.sin(yaw), 0, -Math.cos(yaw));
    this.chair.position.set(this.seat.x + back.x * 0.25 * k, 0, this.seat.z + back.z * 0.25 * k);
    this.chair.rotateX(-k * 1.35);
    this.chair.rotateZ(this.chairFallDir * k * 0.2);
  }

  // ---------------------------------------------------------------------------
  // Face from feelings
  // ---------------------------------------------------------------------------
  private faceAndBody(dt: number, t: number) {
    const f = this.rig.faceTarget;
    const fed = clamp01(this.fed);
    // baseline: polite smile → frown → green grimace → about to be sick
    f.smile = lerp(0.4, -0.9, smoothstep(0.08, 0.85, fed));
    f.wobble = smoothstep(0.4, 0.9, fed) * 0.9;
    f.green = smoothstep(0.3, 0.95, fed);
    f.browAng = fed < 0.3 ? lerp(0, 0.5, fed / 0.3) * (this.irritation > 0.3 ? 1 : 0.4) : lerp(0.2, -0.9, smoothstep(0.3, 0.9, fed));
    f.browY = fed > 0.5 ? (fed - 0.5) * 0.8 : 0;
    f.lid = lerp(0.85, 0.55, smoothstep(0.5, 1, fed));
    f.lowerLid = smoothstep(0.15, 0.6, fed) * 0.45;
    f.puff = 0;
    f.open = 0;
    f.pucker = 0;
    f.cross = 0;
    f.bulge = 0;
    f.blush = this.fedPulse * 0.6 + (this.toupeeLost ? 0.5 : 0);
    if (this.irritation > 0.35 && fed < 0.5) {
      f.browAng = Math.max(f.browAng, this.irritation * 0.8);
      f.lowerLid = Math.max(f.lowerLid, 0.35);
      f.smile = Math.min(f.smile, 0.1);
    }
    // talking flap
    if (this.st === 'idle' && this.talking > 0 && !this.dozing && fed < 0.7) {
      this.talking -= dt;
      f.open = Math.max(0, Math.sin(t * 13 + this.rig.root.id) * 0.3);
    }
    if (this.laughT > 0 && this.st === 'idle') {
      f.open = 0.5 + Math.sin(t * 20) * 0.2;
      f.smile = 0.9;
      f.lid = 0.4;
      this.rig.bob = Math.abs(Math.sin(t * 20)) * 0.012;
      this.rig.headPitchT = -0.25;
    }
    if (this.dozing) {
      f.lid = 0.02;
      f.open = 0.15 + Math.sin(t * 1.2) * 0.1;
      f.smile = 0.2;
    }
    if (this.tracking && this.st === 'idle' && fed < 0.5) {
      f.browAng = Math.max(f.browAng, 0.35);
    }
    this.rig.setSweat(fed > 0.5 || this.st === 'flee');
    if (this.faceOverride) {
      for (const [k, v] of Object.entries(this.faceOverride)) (f as unknown as Record<string, number>)[k] = v as number;
      this.faceOverride = null;
    }
    // wiping mess off the face over time
    if (this.wipeT > 0) this.wipeT -= dt;
  }

  private updateIndicator() {
    if (!this.active) {
      this.indicator = '';
      return;
    }
    if (this.indicator) return;
    if (this.dozing) this.indicator = 'Zz';
    else if (this.tracking && !this.seesFly) this.indicator = '?';
    else if (this.tracking && this.irritation > this.p.swatAt * 0.7) this.indicator = '!';
  }

  /** Scripted: stand and applaud at the end (cake cutting) */
  cheer() {
    this.startReact('chuckle', 99);
  }
}

export const _guestUnused = { Item };
