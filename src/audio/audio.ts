import * as THREE from 'three';
import { ctx as G } from '../game/ctx';
import { clamp, clamp01, noise1, smoothstep } from '../core/math';

type VoiceKind = 'hmm' | 'hmph' | 'harrumph' | 'eugh' | 'gasp' | 'scream' | 'ow' | 'laugh' | 'hwurp' | 'ahh' | 'achoo' | 'mmph' | 'chatter';
type Who = { p?: { voice: number }; voicePitch?: number; rig: { headWorld(o?: THREE.Vector3): THREE.Vector3 } };

const VOWELS: Record<string, [number, number, number]> = {
  a: [800, 1200, 2500],
  e: [500, 1850, 2600],
  i: [320, 2300, 3000],
  o: [520, 880, 2400],
  u: [360, 760, 2300],
  y: [560, 1300, 2450], // schwa "uh"
  m: [260, 1000, 2400],
};

// Petzold's Minuet in G (public domain). [midi, beats]
const MINUET: [number, number][] = [
  [74, 1], [67, 0.5], [69, 0.5], [71, 0.5], [72, 0.5],
  [74, 1], [67, 1], [67, 1],
  [76, 1], [72, 0.5], [74, 0.5], [76, 0.5], [78, 0.5],
  [79, 1], [67, 1], [67, 1],
  [72, 1], [74, 0.5], [72, 0.5], [71, 0.5], [69, 0.5],
  [71, 1], [72, 0.5], [71, 0.5], [69, 0.5], [67, 0.5],
  [66, 1], [67, 0.5], [69, 0.5], [71, 0.5], [67, 0.5],
  [69, 3],
  [74, 1], [67, 0.5], [69, 0.5], [71, 0.5], [72, 0.5],
  [74, 1], [67, 1], [67, 1],
  [76, 1], [72, 0.5], [74, 0.5], [76, 0.5], [78, 0.5],
  [79, 1], [67, 1], [67, 1],
  [72, 1], [74, 0.5], [72, 0.5], [71, 0.5], [69, 0.5],
  [71, 1], [72, 0.5], [71, 0.5], [69, 0.5], [67, 0.5],
  [69, 1], [71, 0.5], [69, 0.5], [67, 0.5], [66, 0.5],
  [67, 3],
];
const BASS = [55, 59, 60, 59, 57, 55, 50, 54, 55, 59, 60, 59, 57, 55, 50, 43];

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export class AudioEngine {
  ac: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private voiceBus!: GainNode;
  private buzzOut!: GainNode;
  private buzzPan!: StereoPannerNode;
  private oscs: OscillatorNode[] = [];
  private buzzFilter!: BiquadFilterNode;
  private hornGain!: GainNode;
  private lfo!: OscillatorNode;
  private lfoDepth!: GainNode;
  private noiseBuf!: AudioBuffer;
  private buzzNoiseGain!: GainNode;
  muted = false;
  private kick = 0;
  private landBlip = 0;
  private musicOn = false;
  private musicT = 0;
  private noteIdx = 0;
  private beat = 0;
  private tempo = 104;
  private mood: 'normal' | 'triumph' | 'off' = 'normal';
  private nextBird = 2;
  private crackleT = 0;
  private smoothGain = 0;
  private smoothPitch = 165;

  unlock() {
    if (!this.ac) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ac = new AC();
      this.build();
    }
    if (this.ac.state === 'suspended') void this.ac.resume();
  }

  private build() {
    const ac = this.ac!;
    this.master = ac.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ac.destination);
    this.sfxBus = ac.createGain();
    this.sfxBus.gain.value = 0.8;
    this.voiceBus = ac.createGain();
    this.voiceBus.gain.value = 0.75;
    this.musicBus = ac.createGain();
    this.musicBus.gain.value = 0.2;
    this.sfxBus.connect(this.master);
    this.voiceBus.connect(this.master);
    // gramophone colouring
    const hp = ac.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 280;
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3200;
    this.musicBus.connect(hp).connect(lp).connect(this.master);

    // noise buffer
    this.noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    // ---- the buzz: three detuned wings + hiss, through a nasal formant and a flutter
    const mix = ac.createGain();
    mix.gain.value = 0.35;
    const types: OscillatorType[] = ['sawtooth', 'sawtooth', 'square'];
    const det = [0, 9, -1200];
    for (let i = 0; i < 3; i++) {
      const o = ac.createOscillator();
      o.type = types[i];
      o.frequency.value = 165;
      o.detune.value = det[i];
      const g = ac.createGain();
      g.gain.value = i === 2 ? 0.35 : 0.5;
      o.connect(g).connect(mix);
      o.start();
      this.oscs.push(o);
    }
    const nsrc = ac.createBufferSource();
    nsrc.buffer = this.noiseBuf;
    nsrc.loop = true;
    const nbp = ac.createBiquadFilter();
    nbp.type = 'bandpass';
    nbp.frequency.value = 4200;
    nbp.Q.value = 0.8;
    this.buzzNoiseGain = ac.createGain();
    this.buzzNoiseGain.gain.value = 0.25;
    nsrc.connect(nbp).connect(this.buzzNoiseGain).connect(mix);
    nsrc.start();
    const shaper = ac.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * 2 - 1;
      curve[i] = Math.tanh(x * 2.4);
    }
    shaper.curve = curve;
    this.buzzFilter = ac.createBiquadFilter();
    this.buzzFilter.type = 'bandpass';
    this.buzzFilter.frequency.value = 900;
    this.buzzFilter.Q.value = 0.9;
    const nasal = ac.createBiquadFilter();
    nasal.type = 'peaking';
    nasal.frequency.value = 2300;
    nasal.Q.value = 2;
    nasal.gain.value = 9;
    const am = ac.createGain();
    am.gain.value = 0.75;
    this.lfo = ac.createOscillator();
    this.lfo.frequency.value = 26;
    this.lfoDepth = ac.createGain();
    this.lfoDepth.gain.value = 0.25;
    this.lfo.connect(this.lfoDepth).connect(am.gain);
    this.lfo.start();
    this.buzzPan = ac.createStereoPanner();
    this.buzzOut = ac.createGain();
    this.buzzOut.gain.value = 0;
    mix.connect(shaper).connect(this.buzzFilter).connect(nasal).connect(am).connect(this.buzzPan).connect(this.buzzOut).connect(this.master);
    // gramophone horn path: big resonant honk + slap-back echo
    this.hornGain = ac.createGain();
    this.hornGain.gain.value = 0;
    const hornPk = ac.createBiquadFilter();
    hornPk.type = 'peaking';
    hornPk.frequency.value = 1100;
    hornPk.Q.value = 3;
    hornPk.gain.value = 14;
    const delay = ac.createDelay(0.5);
    delay.delayTime.value = 0.09;
    const fb = ac.createGain();
    fb.gain.value = 0.45;
    am.connect(this.hornGain).connect(hornPk);
    hornPk.connect(this.master);
    hornPk.connect(delay).connect(fb).connect(delay);
    fb.connect(this.master);
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ac!.currentTime, 0.05);
  }

  // ---------------------------------------------------------------------------
  // Buzz
  // ---------------------------------------------------------------------------
  buzzKick(k: number) {
    this.kick = Math.max(this.kick, k);
  }
  buzzLand() {
    this.landBlip = 1;
  }
  tap() {
    this.sfx('tap', undefined, 0.35);
  }

  update(dt: number) {
    if (!this.ac) return;
    const ac = this.ac;
    const now = ac.currentTime;
    const fly = G.fly;
    if (!fly) return;
    // loudness: big buzz in flight, swelling as it passes someone's ear
    let near = 0;
    let radial = 0;
    const heads: THREE.Vector3[] = [];
    for (const g of G.guests) if (g.active) heads.push(g.rig.headWorld(new THREE.Vector3()));
    if (G.butler?.active) heads.push(G.butler.rig.headWorld(new THREE.Vector3()));
    let best = 9;
    for (const h of heads) {
      const dd = h.distanceTo(fly.pos);
      if (dd < best) {
        best = dd;
        const dir = h.clone().sub(fly.pos).normalize();
        radial = fly.vel.dot(dir);
      }
    }
    near = smoothstep(0.75, 0.08, best);
    const speedN = clamp01(fly.speed / 5);
    let target = 0;
    if (fly.state === 'flying') target = 0.2 + speedN * 0.16;
    else if (fly.state === 'hover') target = 0.2;
    target *= 1 + near * 1.7;
    if (G.game?.hornBlast) target *= 1.6;
    this.kick = Math.max(0, this.kick - dt * 3);
    this.landBlip = Math.max(0, this.landBlip - dt * 6);
    target += this.landBlip * 0.12;
    this.smoothGain += (target - this.smoothGain) * Math.min(1, dt * (target > this.smoothGain ? 30 : 9));
    // pitch with attitude: surges on takeoff, doppler past heads, cranky wobble
    const t = G.time;
    const attitude = 1 + noise1(t * 1.3) * 0.05 + Math.sin(t * 7.3) * 0.012;
    const doppler = clamp(18 / (18 - clamp(radial, -8, 8) * near), 0.8, 1.35);
    let pitch = 158 * (1 + speedN * 0.28 + this.kick * 0.35 - this.landBlip * 0.25) * attitude * doppler;
    if (fly.state === 'hover') pitch *= 1 + Math.sin(t * 2.1) * 0.06;
    this.smoothPitch += (pitch - this.smoothPitch) * Math.min(1, dt * 18);
    for (const o of this.oscs) o.frequency.setTargetAtTime(this.smoothPitch, now, 0.015);
    this.buzzOut.gain.setTargetAtTime(this.smoothGain, now, 0.02);
    this.buzzFilter.frequency.setTargetAtTime(700 + speedN * 700 + near * 500, now, 0.03);
    this.lfo.frequency.setTargetAtTime(22 + speedN * 10 + noise1(t * 3) * 3, now, 0.05);
    this.buzzNoiseGain.gain.setTargetAtTime(0.18 + speedN * 0.25, now, 0.05);
    this.hornGain.gain.setTargetAtTime(G.game?.hornBlast ? 0.9 : 0, now, 0.05);
    // pan from the fly's screen position
    const sp = fly.pos.clone().project(G.camera);
    this.buzzPan.pan.setTargetAtTime(clamp(sp.x * 0.8, -0.9, 0.9), now, 0.03);

    this.updateMusic(dt);
    // ambience
    this.nextBird -= dt;
    if (this.nextBird <= 0) {
      this.nextBird = 2.5 + Math.random() * 5;
      this.bird();
    }
  }

  // ---------------------------------------------------------------------------
  // SFX
  // ---------------------------------------------------------------------------
  private out(pos?: THREE.Vector3, vol = 1, bus?: GainNode) {
    const ac = this.ac!;
    const g = ac.createGain();
    let v = vol;
    const p = ac.createStereoPanner();
    if (pos && G.camera) {
      const sp = pos.clone().project(G.camera);
      p.pan.value = clamp(sp.x * 0.7, -0.85, 0.85);
      const d = pos.distanceTo(G.camera.position);
      v *= 1 / (1 + Math.max(0, d - 2.5) * 0.25);
    }
    g.gain.value = v;
    g.connect(p).connect(bus ?? this.sfxBus);
    return g;
  }

  private noise(dest: AudioNode, t0: number, dur: number, type: BiquadFilterType, freq: number, q: number, env: (g: AudioParam, t: number) => void, freqEnd?: number) {
    const ac = this.ac!;
    const s = ac.createBufferSource();
    s.buffer = this.noiseBuf;
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ac.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t0);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t0 + dur);
    f.Q.value = q;
    const g = ac.createGain();
    g.gain.value = 0;
    env(g.gain, t0);
    s.connect(f).connect(g).connect(dest);
    s.start(t0, Math.random() * 1.5);
    s.stop(t0 + dur + 0.05);
  }

  private tone(dest: AudioNode, t0: number, dur: number, type: OscillatorType, f0: number, f1: number, peak: number, attack = 0.005) {
    const ac = this.ac!;
    const o = ac.createOscillator();
    o.type = type;
    f0 = Math.min(f0, 18000);
    f1 = Math.min(f1, 18000);
    o.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    o.connect(g).connect(dest);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
    return o;
  }

  private perc = (peak: number, decay: number) => (g: AudioParam, t: number) => {
    g.setValueAtTime(0, t);
    g.linearRampToValueAtTime(peak, t + 0.004);
    g.exponentialRampToValueAtTime(0.0008, t + decay);
  };

  sfx(name: string, pos?: THREE.Vector3, vol = 1) {
    if (!this.ac || this.muted) return;
    const ac = this.ac;
    const t = ac.currentTime + 0.005;
    const o = this.out(pos, vol);
    switch (name) {
      case 'thwack':
        this.noise(o, t, 0.16, 'bandpass', 1900, 0.9, this.perc(1.2, 0.14));
        this.tone(o, t, 0.12, 'sine', 140, 55, 0.9);
        break;
      case 'whack':
        this.noise(o, t, 0.1, 'bandpass', 2800, 1.5, this.perc(1, 0.09));
        this.tone(o, t, 0.08, 'triangle', 600, 300, 0.4);
        break;
      case 'slap':
        this.noise(o, t, 0.1, 'highpass', 1300, 0.7, this.perc(1.1, 0.08));
        this.tone(o, t, 0.06, 'sine', 420, 200, 0.4);
        break;
      case 'thump':
        this.tone(o, t, 0.3, 'sine', 95, 40, 1.2);
        this.noise(o, t, 0.2, 'lowpass', 500, 0.7, this.perc(0.8, 0.18));
        break;
      case 'splat':
        this.noise(o, t, 0.3, 'lowpass', 1100, 1.5, this.perc(1, 0.25), 300);
        this.tone(o, t, 0.18, 'sine', 320, 70, 0.6);
        break;
      case 'plop':
        this.tone(o, t, 0.12, 'sine', 500, 180, 0.5);
        this.noise(o, t, 0.08, 'lowpass', 900, 1, this.perc(0.4, 0.07));
        break;
      case 'squish':
        this.noise(o, t, 0.35, 'lowpass', 1400, 2, this.perc(1.2, 0.3), 250);
        this.tone(o, t + 0.05, 0.4, 'square', 1400, 300, 0.12);
        break;
      case 'clink':
        for (const [f, a] of [[2150, 0.3], [3420, 0.2], [5230, 0.12]] as const) this.tone(o, t, 0.5, 'sine', f * (0.97 + Math.random() * 0.06), f, a);
        break;
      case 'crash':
        for (let i = 0; i < 5; i++) this.tone(o, t + Math.random() * 0.06, 0.4, 'sine', 1800 + Math.random() * 3500, 1500, 0.15);
        this.noise(o, t, 0.3, 'highpass', 3000, 0.7, this.perc(0.7, 0.28));
        break;
      case 'clatter': {
        // a spinning tray on the lawn: wob-wob-wob-b-b-b
        const tr = this.tone(o, t, 1.4, 'triangle', 1250, 1150, 0.18);
        const lfo = ac.createOscillator();
        lfo.frequency.setValueAtTime(5, t);
        lfo.frequency.exponentialRampToValueAtTime(24, t + 1.3);
        const lg = ac.createGain();
        lg.gain.value = 120;
        lfo.connect(lg).connect(tr.frequency);
        lfo.start(t);
        lfo.stop(t + 1.5);
        this.tone(o, t, 1.2, 'sine', 2730, 2700, 0.08);
        break;
      }
      case 'pour': {
        const s = ac.createBufferSource();
        s.buffer = this.noiseBuf;
        const f = ac.createBiquadFilter();
        f.type = 'bandpass';
        f.Q.value = 6;
        f.frequency.value = 700;
        const lfo = ac.createOscillator();
        lfo.frequency.value = 9;
        const lg = ac.createGain();
        lg.gain.value = 300;
        lfo.connect(lg).connect(f.frequency);
        const g = ac.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.9, t + 0.05);
        g.gain.linearRampToValueAtTime(0, t + 0.8);
        s.connect(f).connect(g).connect(o);
        s.start(t);
        s.stop(t + 0.85);
        lfo.start(t);
        lfo.stop(t + 0.85);
        break;
      }
      case 'spit':
        this.noise(o, t, 0.45, 'bandpass', 1500, 0.8, (g, tt) => {
          g.setValueAtTime(0, tt);
          g.linearRampToValueAtTime(1.2, tt + 0.03);
          g.linearRampToValueAtTime(0.5, tt + 0.2);
          g.exponentialRampToValueAtTime(0.001, tt + 0.45);
        });
        this.tone(o, t, 0.25, 'sawtooth', 90, 70, 0.15);
        break;
      case 'boing': {
        const b = this.tone(o, t, 0.6, 'sine', 210, 330, 0.5);
        const lfo = ac.createOscillator();
        lfo.frequency.value = 13;
        const lg = ac.createGain();
        lg.gain.setValueAtTime(70, t);
        lg.gain.exponentialRampToValueAtTime(1, t + 0.6);
        lfo.connect(lg).connect(b.frequency);
        lfo.start(t);
        lfo.stop(t + 0.65);
        break;
      }
      case 'whoosh':
        this.noise(o, t, 0.28, 'bandpass', 400, 1.2, (g, tt) => {
          g.setValueAtTime(0, tt);
          g.linearRampToValueAtTime(0.7, tt + 0.1);
          g.exponentialRampToValueAtTime(0.001, tt + 0.28);
        }, 2200);
        break;
      case 'rustle':
        for (let i = 0; i < 9; i++) this.noise(o, t + i * 0.035 + Math.random() * 0.02, 0.03, 'bandpass', 3200 + Math.random() * 1500, 1.2, this.perc(0.6, 0.03));
        break;
      case 'snap':
        this.noise(o, t, 0.05, 'highpass', 2500, 1, this.perc(1, 0.04));
        this.noise(o, t + 0.04, 0.05, 'highpass', 3500, 1, this.perc(0.6, 0.04));
        break;
      case 'gulp':
        this.tone(o, t, 0.25, 'sine', 240, 90, 0.9);
        this.tone(o, t + 0.22, 0.15, 'sine', 400, 900, 0.3);
        break;
      case 'chomp':
        this.noise(o, t, 0.07, 'lowpass', 700, 1, this.perc(0.6, 0.06));
        this.noise(o, t + 0.16, 0.07, 'lowpass', 700, 1, this.perc(0.4, 0.06));
        break;
      case 'slip':
        this.tone(o, t, 0.4, 'sine', 380, 1400, 0.35, 0.05);
        this.tone(o, t + 0.45, 0.3, 'sine', 110, 45, 1.0);
        this.noise(o, t + 0.45, 0.2, 'lowpass', 600, 1, this.perc(0.7, 0.2));
        break;
      case 'step':
        this.noise(o, t, 0.05, 'lowpass', 900, 0.7, this.perc(0.3, 0.05));
        break;
      case 'chair':
        for (let i = 0; i < 3; i++) this.tone(o, t + i * 0.09 + Math.random() * 0.03, 0.12, 'triangle', 220 - i * 30, 140, 0.4);
        this.noise(o, t + 0.2, 0.15, 'lowpass', 1200, 1, this.perc(0.4, 0.15));
        break;
      case 'bang':
        this.tone(o, t, 0.25, 'sine', 120, 50, 1.0);
        for (let i = 0; i < 6; i++) this.tone(o, t + 0.03 + Math.random() * 0.15, 0.12, 'sine', 2500 + Math.random() * 2500, 2400, 0.08);
        break;
      case 'fwip':
        this.noise(o, t, 0.2, 'bandpass', 600, 2, this.perc(0.8, 0.18), 3500);
        break;
      case 'flop':
        this.noise(o, t, 0.12, 'lowpass', 500, 1, this.perc(0.5, 0.1));
        break;
      case 'discover':
        [84, 88, 91, 96].forEach((m, i) => this.bell(o, t + i * 0.08, mtof(m), 0.25));
        break;
      case 'chain':
        [76, 79, 83].forEach((m, i) => this.tone(o, t + i * 0.06, 0.2, 'triangle', mtof(m), mtof(m), 0.25));
        break;
      case 'closecall':
        this.noise(o, t, 0.25, 'bandpass', 3000, 1.5, this.perc(0.6, 0.22), 800);
        this.bell(o, t + 0.05, mtof(93), 0.3);
        break;
      case 'flee':
        [79, 76, 72, 67, 64, 60].forEach((m, i) => this.tone(o, t + i * 0.055, 0.14, 'triangle', mtof(m), mtof(m), 0.25));
        break;
      case 'bell':
        for (let i = 0; i < 3; i++) this.bell(o, t + i * 0.5, 1046, 0.35);
        break;
      case 'tap':
        this.tone(o, t, 0.04, 'sine', 1800, 1200, 0.15);
        break;
    }
  }

  private bell(dest: AudioNode, t: number, f: number, a: number) {
    for (const [r, k] of [[1, 1], [2.76, 0.4], [5.4, 0.2], [8.9, 0.1]] as const) this.tone(dest, t, 1.2 / r + 0.3, 'sine', f * r, f * r, a * k);
  }

  private bird() {
    if (!this.ac || this.muted || !this.musicOn) return;
    const t = this.ac.currentTime;
    const o = this.out(undefined, 0.07 + Math.random() * 0.05);
    const n = 2 + Math.floor(Math.random() * 4);
    const base = 2600 + Math.random() * 1800;
    for (let i = 0; i < n; i++) this.tone(o, t + i * 0.11, 0.09, 'sine', base * (1 + Math.random() * 0.3), base * 1.4, 0.4, 0.01);
  }

  // ---------------------------------------------------------------------------
  // Voices: wordless, Shaun-the-Sheep style grumbles through a formant filter
  // ---------------------------------------------------------------------------
  voice(who: Who, kind: VoiceKind, vol = 1) {
    if (!this.ac || this.muted) return;
    const f0 = who.p?.voice ?? who.voicePitch ?? 120;
    const pos = who.rig.headWorld(new THREE.Vector3());
    const o = this.out(pos, vol, this.voiceBus);
    const t = this.ac.currentTime + 0.01;
    switch (kind) {
      case 'hmm': this.syl(o, t, f0, f0 * 1.25, 'm', 'm', 0.38, 0.5); break;
      case 'hmph':
        this.syl(o, t, f0 * 1.1, f0 * 0.8, 'm', 'm', 0.2, 0.6);
        this.noise(o, t + 0.12, 0.15, 'bandpass', 1200, 1, this.perc(0.25, 0.14));
        break;
      case 'harrumph':
        this.syl(o, t, f0 * 1.1, f0, 'y', 'y', 0.1, 0.55, 0.4);
        this.syl(o, t + 0.12, f0 * 1.3, f0 * 0.75, 'o', 'm', 0.3, 0.75, 0.5);
        break;
      case 'eugh': this.syl(o, t, f0 * 1.35, f0 * 0.75, 'e', 'y', 0.55, 0.7, 0.45); break;
      case 'gasp': this.syl(o, t, f0 * 1.2, f0 * 1.6, 'a', 'a', 0.28, 0.5, 0.9); break;
      case 'scream': this.syl(o, t, f0 * 2.2, f0 * 2.9, 'a', 'i', 0.85, 0.9, 0.25, 9); break;
      case 'ow': this.syl(o, t, f0 * 1.6, f0 * 0.9, 'a', 'u', 0.35, 0.8, 0.2); break;
      case 'laugh':
        for (let i = 0; i < 4; i++) this.syl(o, t + i * 0.16, f0 * (1.25 - i * 0.05), f0 * (1.15 - i * 0.05), 'o', 'a', 0.12, 0.55, 0.45);
        break;
      case 'hwurp':
        this.syl(o, t, f0 * 1.1, f0 * 0.55, 'u', 'y', 0.32, 0.8, 0.5);
        this.noise(o, t + 0.25, 0.12, 'lowpass', 400, 2, this.perc(0.6, 0.1));
        break;
      case 'ahh': this.syl(o, t, f0 * 1.1, f0 * 1.6, 'a', 'a', 0.35, 0.55, 0.4); break;
      case 'achoo':
        this.noise(o, t, 0.12, 'highpass', 2500, 0.7, this.perc(1.2, 0.1));
        this.syl(o, t + 0.06, f0 * 1.9, f0 * 0.9, 'u', 'u', 0.35, 1, 0.35);
        break;
      case 'mmph': this.syl(o, t, f0 * 1.3, f0 * 1.5, 'm', 'm', 0.25, 0.7, 0.2, 14); break;
      case 'chatter': this.chatterTo(o, t, f0); break;
    }
  }

  chatter(who: Who) {
    this.voice(who, 'chatter', 0.35);
  }

  private chatterTo(o: AudioNode, t: number, f0: number) {
    const keys = 'aeiouy';
    const n = 3 + Math.floor(Math.random() * 4);
    let tt = t;
    for (let i = 0; i < n; i++) {
      const v1 = keys[Math.floor(Math.random() * keys.length)];
      const v2 = keys[Math.floor(Math.random() * keys.length)];
      const d = 0.09 + Math.random() * 0.1;
      const p = f0 * (0.95 + Math.random() * 0.35);
      this.syl(o, tt, p, p * (0.85 + Math.random() * 0.3), v1, v2, d, 0.35, 0.3);
      tt += d + 0.03;
    }
  }

  private syl(dest: AudioNode, t: number, p0: number, p1: number, v0: string, v1: string, dur: number, vol: number, breath = 0.3, vib = 5) {
    const ac = this.ac!;
    const src = ac.createOscillator();
    src.type = 'sawtooth';
    src.frequency.setValueAtTime(p0, t);
    src.frequency.exponentialRampToValueAtTime(Math.max(30, p1), t + dur);
    const vl = ac.createOscillator();
    vl.frequency.value = vib;
    const vg = ac.createGain();
    vg.gain.value = p0 * 0.02;
    vl.connect(vg).connect(src.frequency);
    const env = ac.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(vol, t + Math.min(0.04, dur * 0.3));
    env.gain.setValueAtTime(vol, t + dur * 0.7);
    env.gain.linearRampToValueAtTime(0, t + dur);
    const scale = p0 > 200 ? 1.18 : 1;
    const F0 = VOWELS[v0] ?? VOWELS.y;
    const F1 = VOWELS[v1] ?? VOWELS.y;
    const nasal = v0 === 'm' ? 0.35 : 1;
    for (let k = 0; k < 3; k++) {
      const f = ac.createBiquadFilter();
      f.type = 'bandpass';
      f.Q.value = 6 + k * 3;
      f.frequency.setValueAtTime(F0[k] * scale, t);
      f.frequency.linearRampToValueAtTime(F1[k] * scale, t + dur);
      const g = ac.createGain();
      g.gain.value = [1.6, 1.0, 0.45][k] * nasal * 3;
      src.connect(f).connect(g).connect(env);
    }
    if (breath > 0) {
      const ns = ac.createBufferSource();
      ns.buffer = this.noiseBuf;
      const nf = ac.createBiquadFilter();
      nf.type = 'bandpass';
      nf.frequency.value = F0[1] * scale;
      nf.Q.value = 1.5;
      const ng = ac.createGain();
      ng.gain.value = breath * 0.6;
      ns.connect(nf).connect(ng).connect(env);
      ns.start(t, Math.random());
      ns.stop(t + dur + 0.05);
    }
    env.connect(dest);
    src.start(t);
    vl.start(t);
    src.stop(t + dur + 0.05);
    vl.stop(t + dur + 0.05);
  }

  // ---------------------------------------------------------------------------
  // Music: a gramophone minuet that frays as the party falls apart
  // ---------------------------------------------------------------------------
  startMusic() {
    this.unlock();
    this.musicOn = true;
    this.mood = 'normal';
    this.noteIdx = 0;
    this.beat = 0;
    if (this.ac) this.musicT = this.ac.currentTime + 0.2;
  }

  stopMusic() {
    this.musicOn = false;
  }

  musicMood(m: 'normal' | 'triumph') {
    this.mood = m;
  }

  private updateMusic(dt: number) {
    if (!this.ac || !this.musicOn || this.mood === 'off') return;
    const ac = this.ac;
    const ele = G.game ? G.game.elegance : 1;
    const late = G.game ? clamp01((G.game.clock - 300) / 120) : 0;
    this.tempo = (this.mood === 'triumph' ? 126 : 100 + late * 26) * (1 + (1 - ele) * 0.06);
    const spb = 60 / this.tempo;
    const wow = (1 - ele) * 45 + (G.game?.hornBlast ? 60 : 0);
    // crackle
    this.crackleT -= dt;
    if (this.crackleT <= 0) {
      this.crackleT = 0.05 + Math.random() * (0.3 * ele + 0.05);
      const c = ac.createGain();
      c.gain.value = 0.25 + (1 - ele) * 0.6;
      c.connect(this.musicBus);
      this.noise(c, ac.currentTime, 0.01, 'highpass', 3000, 0.5, this.perc(0.5, 0.008));
    }
    while (this.musicT < ac.currentTime + 0.25) {
      const [midi, beats] = MINUET[this.noteIdx % MINUET.length];
      const tr = this.mood === 'triumph' ? 5 : 0;
      // the needle skips when the party is in tatters
      if (ele < 0.45 && Math.random() < (0.45 - ele) * 0.25 && beats <= 1) {
        this.noise(this.musicBus, this.musicT, 0.06, 'bandpass', 2000, 1, this.perc(1, 0.05));
        this.noteIdx = Math.max(0, this.noteIdx - 2);
      }
      const det = Math.sin(this.musicT * 1.3) * wow + (Math.random() - 0.5) * wow * 0.4;
      this.pluck(this.musicT, mtof(midi + tr), beats * spb, det, 0.5);
      // bass on the downbeat of each bar
      const barBeat = this.beat % 3;
      if (barBeat < 0.01) {
        const bar = Math.floor(this.beat / 3) % BASS.length;
        this.pluck(this.musicT, mtof(BASS[bar] - 12 + tr), spb * 2.5, det, 0.45);
        this.pluck(this.musicT + spb, mtof(BASS[bar] + tr), spb * 0.8, det, 0.18);
        this.pluck(this.musicT + spb * 2, mtof(BASS[bar] + 4 + tr - (bar % 2)), spb * 0.8, det, 0.15);
      }
      this.musicT += beats * spb;
      this.beat += beats;
      this.noteIdx++;
    }
  }

  private pluck(t: number, f: number, dur: number, detune: number, amp: number) {
    const ac = this.ac!;
    const o1 = ac.createOscillator();
    o1.type = 'sawtooth';
    o1.frequency.value = f;
    o1.detune.value = detune;
    const o2 = ac.createOscillator();
    o2.type = 'square';
    o2.frequency.value = f * 2;
    o2.detune.value = detune + 6;
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(Math.min(6000, f * 7), t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(300, f * 1.5), t + Math.min(0.6, dur));
    const g = ac.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(amp * 0.5, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0008, t + Math.max(0.25, dur * 1.1));
    const g2 = ac.createGain();
    g2.gain.value = 0.25;
    o1.connect(lp);
    o2.connect(g2).connect(lp);
    lp.connect(g).connect(this.musicBus);
    o1.start(t);
    o2.start(t);
    o1.stop(t + dur * 1.2 + 0.1);
    o2.stop(t + dur * 1.2 + 0.1);
  }

  victory() {
    if (!this.ac) return;
    this.musicOn = false;
    const ac = this.ac;
    const t = ac.currentTime + 0.1;
    const o = this.out(undefined, 0.9);
    // a cheeky kazoo-and-tuba fanfare
    const notes: [number, number, number][] = [
      [67, 0, 0.14], [67, 0.15, 0.14], [67, 0.3, 0.14], [72, 0.45, 0.5], [76, 1.0, 0.25], [74, 1.27, 0.12], [76, 1.4, 0.12], [79, 1.55, 0.9],
    ];
    for (const [m, at, d] of notes) {
      this.syl(o, t + at, mtof(m), mtof(m) * 1.01, 'u', 'y', d, 0.55, 0.15, 6);
      this.tone(o, t + at, d, 'sawtooth', mtof(m - 24), mtof(m - 24), 0.12, 0.01);
    }
    [84, 88, 91, 96, 100].forEach((m, i) => this.bell(o, t + 1.6 + i * 0.07, mtof(m), 0.18));
    setTimeout(() => {
      this.musicOn = true;
      this.mood = 'triumph';
      this.musicT = this.ac ? this.ac.currentTime + 0.1 : 0;
    }, 2800);
  }

  defeat() {
    if (!this.ac) return;
    this.musicOn = false;
    const t = this.ac.currentTime + 0.15;
    const o = this.out(undefined, 0.9);
    // sad trombone: wah, wah, wah, wahhhh
    const seq: [number, number][] = [[58, 0.38], [57, 0.38], [56, 0.38], [55, 1.3]];
    let at = 0;
    for (const [m, d] of seq) {
      const tb = this.tone(o, t + at, d, 'sawtooth', mtof(m), mtof(m) * (d > 1 ? 0.97 : 1), 0.25, 0.03);
      if (d > 1) {
        const l = this.ac.createOscillator();
        l.frequency.value = 6;
        const lg = this.ac.createGain();
        lg.gain.value = 6;
        l.connect(lg).connect(tb.frequency);
        l.start(t + at);
        l.stop(t + at + d);
      }
      at += d + 0.04;
    }
  }
}
