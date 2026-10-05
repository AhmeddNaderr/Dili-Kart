import { audioCtx, master } from "../engine/audio";

/**
 * Everything you hear during a race, synthesised live with WebAudio — no
 * audio files:
 *
 *  - Your engine: a firing-pulse voice with gears, a putt-putt idle, a
 *    gritty growl on throttle, intake roar, backfire pops when you lift,
 *    and a turbo whistle under boost.
 *  - The nearest Custodian's engine, panned and pitch-shifted as it passes.
 *  - Tyre screech while drifting, wind, road rumble (rougher on grass), and
 *    a stadium crowd that roars on big moments.
 *  - A synthwave soundtrack (the trailer's style) and every one-shot effect,
 *    through a shared stadium reverb and a glue compressor.
 */

/** Music level (the bus gain at full volume). */
const MUSIC = 0.2;
const lite = typeof document !== "undefined" && document.documentElement.classList.contains("lite");

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

/* ---------------- soundtrack: 128 BPM, A minor, Am – F – C – G ---------------- */
const BPM = 128;
const STEP = 60 / BPM / 4;
const PROG = [
  { root: 45, notes: [57, 60, 64] },   // Am
  { root: 41, notes: [53, 57, 60] },   // F
  { root: 48, notes: [60, 64, 67] },   // C
  { root: 43, notes: [55, 59, 62] },   // G
];
const LEAD = [
  [76, 0, 76, 74, 72, 0, 69, 0, 72, 0, 74, 0, 76, 0, 0, 0],
  [77, 0, 76, 74, 72, 0, 0, 72, 74, 0, 72, 0, 69, 0, 0, 0],
  [76, 0, 79, 0, 76, 0, 74, 72, 74, 0, 76, 0, 72, 0, 0, 0],
  [74, 0, 71, 67, 71, 0, 74, 0, 79, 0, 77, 76, 74, 0, 71, 0],
];
const ARP = [0, 1, 2, 1, 0, 2, 1, 2];

/** Neon Town's night drive: D minor, Dm – B♭ – F – C, a moodier synthwave line. */
const PROG_NIGHT = [
  { root: 38, notes: [53, 57, 62] },   // Dm
  { root: 46, notes: [53, 58, 62] },   // B♭
  { root: 41, notes: [53, 57, 60] },   // F
  { root: 48, notes: [55, 60, 64] },   // C
];
const LEAD_NIGHT = [
  [74, 0, 0, 72, 69, 0, 0, 0, 72, 0, 74, 0, 77, 0, 0, 0],
  [74, 0, 0, 72, 70, 0, 0, 0, 69, 0, 67, 0, 65, 0, 0, 0],
  [69, 0, 72, 0, 77, 0, 0, 76, 74, 0, 72, 0, 69, 0, 0, 0],
  [67, 0, 69, 0, 72, 0, 0, 0, 76, 0, 74, 0, 72, 0, 0, 0],
];

/** The Skyway (Infinite): a soaring C – G – Am – F, brighter and driving. */
const PROG_SKY = [
  { root: 48, notes: [60, 64, 67] },   // C
  { root: 43, notes: [59, 62, 67] },   // G
  { root: 45, notes: [60, 64, 69] },   // Am
  { root: 41, notes: [60, 65, 69] },   // F
];
const LEAD_SKY = [
  [79, 0, 79, 0, 76, 0, 79, 0, 81, 0, 79, 76, 74, 0, 72, 0],
  [74, 0, 74, 0, 71, 0, 74, 0, 79, 0, 77, 76, 74, 0, 0, 0],
  [76, 0, 76, 0, 72, 0, 76, 0, 81, 0, 79, 0, 76, 0, 74, 0],
  [72, 0, 74, 0, 77, 0, 76, 0, 74, 0, 72, 0, 69, 0, 72, 0],
];

/** Speed bands for the gearbox, m/s. */
const GEARS = [0, 7, 13, 19, 25, 45];

export interface DriveState {
  speed: number;
  boost: number;
  running: boolean;
  gas: boolean;
  offroad: boolean;
  air: boolean;
  /** Nearest Custodian: metres ahead (+) or behind (−), sideways offset, speed. */
  rival: { gap: number; side: number; speed: number } | null;
}

interface Loop { src: AudioBufferSourceNode; g: GainNode; f: BiquadFilterNode; f2?: BiquadFilterNode }

export class RaceAudio {
  private c: BaseAudioContext | null = null;
  private out!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private engBus!: GainNode;
  private verbIn!: GainNode;
  private delayIn!: GainNode;
  private noise!: AudioBuffer;
  private brown!: AudioBuffer;
  private stoppers: (() => void)[] = [];
  private arpBus: StereoPannerNode[] = [];

  private eng: {
    osc: OscillatorNode; sub: OscillatorNode; rasp: OscillatorNode; lfo: OscillatorNode; lfoDepth: GainNode;
    raspG: GainNode; raspF: BiquadFilterNode; lp: BiquadFilterNode; g: GainNode; intake: Loop; whistle: OscillatorNode; whistleG: GainNode;
  } | null = null;
  private rival: { osc: OscillatorNode; sub: OscillatorNode; lp: BiquadFilterNode; pan: StereoPannerNode; g: GainNode } | null = null;
  private squeal: { band: Loop; band2: Loop; hiss: Loop; vib: OscillatorNode } | null = null;
  private wind: Loop | null = null;
  private rumble: Loop | null = null;
  private crowd: Loop | null = null;

  private rpm = 0.15;
  private gear = 0;
  private wasGas = false;
  private cheerLevel = 0;
  private timer = 0;
  private nextNote = 0;
  private step = 0;
  private stepLen = STEP;

  /** `ctx` lets tests render offline; the game uses the shared live context. */
  start(ctx?: BaseAudioContext) {
    const c = ctx ?? audioCtx();
    if (!c) return;
    this.c = c;

    // The race's own glue compressor, then the shared master chain (phone
    // speaker tuning and the limiter).
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 8; comp.ratio.value = 3; comp.attack.value = 0.005; comp.release.value = 0.2;
    this.out = c.createGain();
    this.out.gain.value = 1.1;
    comp.connect(this.out).connect(master(c));
    const bus = (v: number) => { const g = c.createGain(); g.gain.value = v; g.connect(comp); return g; };
    this.sfxBus = bus(0.9);
    this.musicBus = bus(MUSIC);
    this.engBus = bus(0.85);
    // The arpeggio bounces left and right: the music gets some width.
    for (const side of [-0.45, 0.45]) {
      const p = c.createStereoPanner(); p.pan.value = side;
      p.connect(this.musicBus);
      this.arpBus.push(p);
    }

    // Stadium reverb and a dotted-eighth delay, shared by music and effects.
    const verb = c.createConvolver();
    // A shorter tail on phones: convolution is the priciest thing in here.
    const ir = c.createBuffer(2, Math.floor(c.sampleRate * (lite ? 1.1 : 1.9)), c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
    }
    verb.buffer = ir;
    this.verbIn = c.createGain();
    this.verbIn.gain.value = 0.3;
    this.verbIn.connect(verb).connect(comp);
    const delay = c.createDelay(1);
    delay.delayTime.value = STEP * 3;
    const fb = c.createGain(); fb.gain.value = 0.32;
    const dlp = c.createBiquadFilter(); dlp.type = "lowpass"; dlp.frequency.value = 2800;
    this.delayIn = c.createGain();
    this.delayIn.connect(delay).connect(dlp).connect(fb).connect(delay);
    dlp.connect(this.musicBus);

    // Noise beds: white, and brown for rumble and wind.
    this.noise = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    this.brown = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    {
      const w = this.noise.getChannelData(0), b = this.brown.getChannelData(0);
      let last = 0;
      for (let i = 0; i < w.length; i++) {
        w[i] = Math.random() * 2 - 1;
        last = (last + 0.02 * w[i]) / 1.02;
        b[i] = last * 3.5;
      }
    }

    this.buildEngine();
    this.buildRival();
    this.buildSqueal();
    this.wind = this.loop(this.brown, "highpass", 500, 0.5, this.engBus, "lowpass", 3500);
    this.rumble = this.loop(this.brown, "lowpass", 160, 0.8, this.engBus);
    this.crowd = this.loop(this.noise, "bandpass", 850, 0.6, this.sfxBus, "bandpass", 1500);
    this.crowd.g.gain.value = 0.018;

    this.nextNote = c.currentTime + 0.1;
    this.step = 0;
    if (!ctx) this.timer = window.setInterval(() => this.schedule(), 25);
  }

  /** Offline rendering: queue the music up to the context's current time. */
  pump() { this.schedule(); }

  stop() {
    clearInterval(this.timer);
    for (const s of this.stoppers) { try { s(); } catch { /* already stopped */ } }
    this.stoppers = [];
    this.out?.disconnect();
    this.arpBus = [];
    this.c = null;
    this.eng = null;
    this.rival = null;
    this.squeal = null;
    this.wind = this.rumble = this.crowd = null;
  }

  /* ================================================================ */
  /* Continuous voices                                                */
  /* ================================================================ */

  private loop(buf: AudioBuffer, type: BiquadFilterType, freq: number, q: number, dest: AudioNode, type2?: BiquadFilterType, freq2?: number): Loop {
    const c = this.c!;
    const src = c.createBufferSource();
    src.buffer = buf; src.loop = true;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); g.gain.value = 0;
    let tail: AudioNode = f;
    let f2: BiquadFilterNode | undefined;
    if (type2) {
      f2 = c.createBiquadFilter(); f2.type = type2; f2.frequency.value = freq2 ?? 1000;
      f.connect(f2); tail = f2;
    }
    src.connect(f); tail.connect(g).connect(dest);
    src.start(0, Math.random());
    this.stoppers.push(() => src.stop());
    return { src, g, f, f2 };
  }

  private osc(type: OscillatorType | PeriodicWave, freq: number) {
    const o = this.c!.createOscillator();
    if (type instanceof PeriodicWave) o.setPeriodicWave(type); else o.type = type;
    o.frequency.value = freq;
    o.start();
    this.stoppers.push(() => o.stop());
    return o;
  }

  /** The engine: a pulse-rich firing wave, half-rate sub for the lope, rasp and intake. */
  private buildEngine() {
    const c = this.c!;
    const N = 40;
    const real = new Float32Array(N), imag = new Float32Array(N);
    for (let n = 1; n < N; n++) imag[n] = (n % 2 ? 1 : 0.55) / Math.pow(n, 0.85) * (n === 2 || n === 3 ? 1.4 : 1);
    const wave = c.createPeriodicWave(real, imag);
    const osc = this.osc(wave, 50);
    const sub = this.osc("square", 25);
    const rasp = this.osc("sawtooth", 100);
    const lfo = this.osc("sine", 25);

    const mix = c.createGain(); mix.gain.value = 0.6;
    const subG = c.createGain(); subG.gain.value = 0.12;
    osc.connect(mix); sub.connect(subG).connect(mix);
    // Amplitude lope at half the firing rate: the kart "putt-putt".
    const am = c.createGain(); am.gain.value = 0.75;
    const lfoDepth = c.createGain(); lfoDepth.gain.value = 0.3;
    lfo.connect(lfoDepth).connect(am.gain);
    mix.connect(am);
    const shaper = c.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1; curve[i] = Math.tanh(x * 2.6) / Math.tanh(2.6); }
    shaper.curve = curve;
    const body = c.createBiquadFilter(); body.type = "peaking"; body.frequency.value = 150; body.gain.value = 2.5; body.Q.value = 0.9;
    const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 600; lp.Q.value = 1.4;
    const g = c.createGain(); g.gain.value = 0;
    am.connect(shaper).connect(body).connect(lp).connect(g).connect(this.engBus);
    const raspF = c.createBiquadFilter(); raspF.type = "bandpass"; raspF.frequency.value = 1200; raspF.Q.value = 1.1;
    const raspG = c.createGain(); raspG.gain.value = 0;
    rasp.connect(raspF).connect(raspG).connect(lp);
    const intake = this.loop(this.noise, "bandpass", 900, 1.3, g);
    const whistle = this.osc("sine", 2200);
    const whistleG = c.createGain(); whistleG.gain.value = 0;
    whistle.connect(whistleG).connect(this.engBus);
    this.eng = { osc, sub, rasp, lfo, lfoDepth, raspG, raspF, lp, g, intake, whistle, whistleG };
  }

  private buildRival() {
    const c = this.c!;
    const osc = this.osc("sawtooth", 60);
    const sub = this.osc("square", 30);
    const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 900; lp.Q.value = 2;
    const pan = c.createStereoPanner();
    const g = c.createGain(); g.gain.value = 0;
    const sg = c.createGain(); sg.gain.value = 0.5;
    osc.connect(lp); sub.connect(sg).connect(lp);
    lp.connect(pan).connect(g).connect(this.engBus);
    this.rival = { osc, sub, lp, pan, g };
  }

  /**
   * Tyre screech: rubber singing is a narrow, restless band of noise, not a
   * clean tone. Two resonant bands wander at unrelated rates (so it never
   * sounds like a synth vibrato), over a wider hiss of scrubbing rubber.
   */
  private buildSqueal() {
    const c = this.c!;
    const band = this.loop(this.noise, "bandpass", 1150, 16, this.engBus, "peaking", 1150);
    band.f2!.gain.value = 6;
    const band2 = this.loop(this.noise, "bandpass", 2300, 12, band.g);
    band2.g.gain.value = 0.45;
    const wob = (hz: number, depth: number, target: AudioParam) => {
      const o = this.osc("sine", hz);
      const g = c.createGain(); g.gain.value = depth;
      o.connect(g).connect(target);
      return o;
    };
    const vib = wob(5.3, 55, band.f.frequency);
    wob(13.7, 25, band.f.frequency);
    wob(7.9, 70, band2.f.frequency);
    const hiss = this.loop(this.noise, "bandpass", 2400, 3, this.engBus);
    this.squeal = { band, band2, hiss, vib };
  }

  /** Gear and rpm from road speed, with the gearbox's shift points. */
  private rpmFor(speed: number) {
    let g = 0;
    while (g < GEARS.length - 2 && speed >= GEARS[g + 1]) g++;
    const k = (speed - GEARS[g]) / (GEARS[g + 1] - GEARS[g]);
    return { gear: g, rpm: 0.24 + 0.76 * Math.min(1, Math.max(0, k)) };
  }

  /** Called every frame with the player's state. */
  drive(s: DriveState) {
    const c = this.c, e = this.eng;
    if (!c || !e) return;
    const t = c.currentTime;
    const { gear, rpm } = this.rpmFor(s.speed);
    let target = s.running ? rpm : this.wasGas ? 0.55 : 0.14;
    if (!s.running && s.gas) target = 0.62 + Math.random() * 0.05;      // revving on the grid
    if (s.air) target = Math.min(1, target + 0.28);                      // wheels off the ground: it screams
    if (s.running && gear > this.gear && s.speed > 4) this.shift();
    this.gear = gear;
    this.rpm += (target - this.rpm) * (target > this.rpm ? 0.25 : 0.12);
    const r = this.rpm;
    const th = s.gas ? 1 : 0.4;
    const f = 34 + r * 118 + s.boost * 24;
    e.osc.frequency.setTargetAtTime(f, t, 0.03);
    e.sub.frequency.setTargetAtTime(f / 2, t, 0.03);
    e.rasp.frequency.setTargetAtTime(f * 2, t, 0.03);
    e.lfo.frequency.setTargetAtTime(f / 2, t, 0.03);
    e.lfoDepth.gain.setTargetAtTime(0.4 - r * 0.25, t, 0.1);
    e.lp.frequency.setTargetAtTime(650 + r * 2800 * th + s.boost * 1600, t, 0.05);
    e.raspG.gain.setTargetAtTime((0.09 + r * 0.22) * th, t, 0.05);
    e.raspF.frequency.setTargetAtTime(900 + r * 1500, t, 0.05);
    e.g.gain.setTargetAtTime((s.running || s.gas ? 0.12 + 0.07 * th : 0.07) * (1 + s.boost * 0.35), t, 0.06);
    e.intake.g.gain.setTargetAtTime(0.08 * th * r, t, 0.08);
    e.intake.f.frequency.setTargetAtTime(700 + r * 1900, t, 0.08);
    e.whistle.frequency.setTargetAtTime(1900 + s.boost * 1900 + r * 500, t, 0.1);
    e.whistleG.gain.setTargetAtTime(s.boost * 0.022 + (r > 0.85 && s.gas ? 0.004 : 0), t, 0.08);
    // Lift off at high revs: the exhaust pops and crackles.
    if (this.wasGas && !s.gas && this.rpm > 0.55 && s.running) this.backfire();
    this.wasGas = s.gas;

    // Road and air.
    const v = Math.min(1.4, s.speed / 24);
    if (this.rumble) {
      this.rumble.g.gain.setTargetAtTime(s.air ? 0 : (s.offroad ? 0.16 : 0.04) * v, t, 0.06);
      this.rumble.f.frequency.setTargetAtTime(s.offroad ? 420 : 150, t, 0.1);
    }
    if (this.wind) this.wind.g.gain.setTargetAtTime(0.06 * v * v * (s.air ? 2 : 1) + s.boost * 0.03, t, 0.1);

    // The nearest Custodian: louder close by, panned, pitch dropping as it passes.
    if (this.rival) {
      const rv = this.rival;
      if (s.rival && Math.abs(s.rival.gap) < 30) {
        const d = Math.hypot(s.rival.gap, s.rival.side);
        const { rpm: rr } = this.rpmFor(s.rival.speed);
        const closing = (s.rival.speed - s.speed) * -Math.sign(s.rival.gap);   // + when approaching
        const doppler = 1 + Math.max(-0.12, Math.min(0.12, closing * 0.012));
        const rf = (32 + rr * 112) * doppler;
        rv.osc.frequency.setTargetAtTime(rf, t, 0.05);
        rv.sub.frequency.setTargetAtTime(rf / 2, t, 0.05);
        rv.lp.frequency.setTargetAtTime(500 + rr * 1400, t, 0.08);
        rv.pan.pan.setTargetAtTime(Math.max(-0.8, Math.min(0.8, s.rival.side / 6)), t, 0.08);
        rv.g.gain.setTargetAtTime(0.09 * Math.max(0, 1 - d / 30) ** 1.5, t, 0.08);
      } else {
        rv.g.gain.setTargetAtTime(0, t, 0.2);
      }
    }

    // Crowd bed, swelling on big moments.
    this.cheerLevel = Math.max(0, this.cheerLevel - 0.012);
    if (this.crowd) {
      this.crowd.g.gain.setTargetAtTime(0.016 + this.cheerLevel * 0.12, t, 0.15);
      this.crowd.f.frequency.setTargetAtTime(850 + this.cheerLevel * 400, t, 0.2);
    }
  }

  /** Old entry point, kept for callers that only know speed and boost. */
  engine(speed: number, boost: number, running: boolean) {
    this.drive({ speed, boost, running, gas: running, offroad: false, air: false, rival: null });
  }

  squealing(on: boolean, tier: number) {
    const c = this.c, q = this.squeal;
    if (!c || !q) return;
    const t = c.currentTime;
    q.band.g.gain.setTargetAtTime(on ? 0.5 + tier * 0.08 : 0, t, on ? 0.04 : 0.08);
    q.band.f.frequency.setTargetAtTime(1050 + tier * 170, t, 0.08);
    q.band.f2!.frequency.setTargetAtTime(1050 + tier * 170, t, 0.08);
    q.band2.f.frequency.setTargetAtTime(2150 + tier * 300, t, 0.08);
    q.hiss.g.gain.setTargetAtTime(on ? 0.02 + tier * 0.006 : 0, t, 0.05);
    q.hiss.f.frequency.setTargetAtTime(2200 + tier * 400, t, 0.08);
    // Sparks crackle as the charge builds.
    if (on && tier > 0 && Math.random() < 0.18 + tier * 0.1) this.click(3500 + Math.random() * 3000, 0.012, 0.03);
  }

  /** The crowd roars. */
  cheer(k = 1) { this.cheerLevel = Math.min(1.2, this.cheerLevel + k); }

  /** Speed the soundtrack up (×1.1 for the final lap; Infinite ramps it per stage). */
  hurry(k = 1.1) { this.stepLen = STEP / k; }

  setMusic(level: number) {
    if (this.c) this.musicBus.gain.setTargetAtTime(level * MUSIC, this.c.currentTime, 0.3);
  }

  /* ================================================================ */
  /* One-shot building blocks                                         */
  /* ================================================================ */

  private env(t: number, peak: number, attack: number, decay: number, dest: AudioNode) {
    const g = this.c!.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(dest);
    return g;
  }

  private tone(freq: number, dur: number, type: OscillatorType, gain: number, o: { slide?: number; delay?: number; dest?: AudioNode; verb?: number; attack?: number } = {}) {
    const c = this.c;
    if (!c) return;
    const t = c.currentTime + (o.delay ?? 0);
    const osc = c.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (o.slide) osc.frequency.exponentialRampToValueAtTime(o.slide, t + dur);
    osc.connect(this.env(t, gain, o.attack ?? 0.004, dur, o.dest ?? this.sfxBus));
    if (o.verb) osc.connect(this.env(t, gain * o.verb, o.attack ?? 0.004, dur, this.verbIn));
    osc.start(t);
    osc.stop(t + dur + (o.attack ?? 0.004) + 0.05);
  }

  private burst(dur: number, gain: number, type: BiquadFilterType, freq: number, o: { to?: number; delay?: number; q?: number; dest?: AudioNode; verb?: number; buf?: AudioBuffer } = {}) {
    const c = this.c;
    if (!c) return;
    const t = c.currentTime + (o.delay ?? 0);
    const src = c.createBufferSource();
    src.buffer = o.buf ?? this.noise;
    const f = c.createBiquadFilter();
    f.type = type; f.Q.value = o.q ?? 1;
    f.frequency.setValueAtTime(freq, t);
    if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t + dur);
    src.connect(f);
    f.connect(this.env(t, gain, 0.003, dur, o.dest ?? this.sfxBus));
    if (o.verb) f.connect(this.env(t, gain * o.verb, 0.003, dur, this.verbIn));
    src.start(t, Math.random() * 1.2, dur + 0.1);
  }

  private click(freq: number, dur: number, gain: number) { this.burst(dur, gain, "bandpass", freq, { q: 4 }); }

  private shift() {
    const c = this.c, e = this.eng;
    if (!c || !e) return;
    const t = c.currentTime;
    e.g.gain.cancelScheduledValues(t);
    e.g.gain.setValueAtTime(e.g.gain.value * 0.45, t);
    this.rpm *= 0.72;
    this.burst(0.05, 0.05, "bandpass", 700, { q: 2, dest: this.engBus });
  }

  private backfire() {
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const d = 0.05 + Math.random() * 0.4;
      this.burst(0.05, 0.12, "bandpass", 500 + Math.random() * 700, { q: 1.5, delay: d, dest: this.engBus });
      this.tone(70 + Math.random() * 30, 0.08, "sine", 0.12, { slide: 40, delay: d, dest: this.engBus });
    }
  }

  /* ================================================================ */
  /* Effects                                                          */
  /* ================================================================ */

  /** Coin bling; a streak climbs the scale. */
  coin(streak: number, vol = 1) {
    const k = Math.pow(2, [0, 2, 4, 7, 9, 12, 14, 16][Math.min(7, streak)] / 12);
    this.tone(988 * k, 0.07, "square", 0.035 * vol);
    this.tone(1319 * k, 0.32, "sine", 0.07 * vol, { delay: 0.06, verb: 0.4 });
    this.tone(2638 * k, 0.18, "sine", 0.02 * vol, { delay: 0.06 });
  }

  /** Countdown: lower beeps, then a bright chord for GO. */
  beep(high: boolean) {
    if (!high) {
      this.tone(587, 0.28, "square", 0.05, { verb: 0.5 });
      this.tone(1174, 0.2, "sine", 0.03);
      return;
    }
    for (const f of [1046, 1318, 1568]) this.tone(f, 0.7, "square", 0.035, { verb: 0.6 });
    this.tone(2093, 0.5, "sine", 0.03, { verb: 0.5 });
    this.burst(0.5, 0.12, "highpass", 3000, { verb: 0.5 });
    this.cheer(0.8);
  }

  boost() {
    this.burst(0.6, 0.22, "bandpass", 400, { to: 3500, q: 1.2, verb: 0.3 });
    this.tone(110, 0.55, "sawtooth", 0.05, { slide: 520 });
    this.tone(60, 0.3, "sine", 0.18, { slide: 35 });
  }

  bonk() {
    this.tone(130, 0.3, "sine", 0.22, { slide: 45 });
    this.burst(0.18, 0.2, "bandpass", 650, { q: 1.4 });
    this.tone(540, 0.28, "triangle", 0.05, { slide: 480 });
    this.tone(1320, 0.22, "sine", 0.03, { slide: 1180, verb: 0.4 });
    this.cheer(0.3);
  }

  pass() {
    this.burst(0.35, 0.08, "bandpass", 700, { to: 2400, q: 1.5 });
    this.tone(880, 0.09, "triangle", 0.05);
    this.tone(1318, 0.16, "triangle", 0.05, { delay: 0.07, verb: 0.4 });
    this.cheer(0.25);
  }

  land() {
    this.tone(95, 0.22, "sine", 0.24, { slide: 42 });
    this.burst(0.25, 0.14, "lowpass", 900, { to: 200, buf: this.brown });
    this.tone(1900, 0.06, "sine", 0.012, { slide: 1500, delay: 0.05 });
  }

  /** Item roulette tick. */
  roll() {
    this.tone(1300 + Math.random() * 500, 0.035, "sine", 0.05);
    this.click(4000, 0.01, 0.03);
  }

  /** Got an item. */
  get() {
    [1046, 1318, 1568, 2093].forEach((f, i) => this.tone(f, 0.14, "triangle", 0.05, { delay: i * 0.045, verb: 0.4 }));
  }

  trick() {
    this.burst(0.3, 0.1, "bandpass", 500, { to: 3000, q: 2 });
    this.tone(784, 0.1, "square", 0.04, { delay: 0.05 });
    this.tone(1175, 0.22, "square", 0.04, { delay: 0.13, verb: 0.5 });
    this.cheer(0.4);
  }

  zap() {
    this.tone(1800, 0.45, "sawtooth", 0.05, { slide: 90 });
    this.tone(90, 0.35, "square", 0.04, { slide: 45 });
    for (let i = 0; i < 6; i++) this.burst(0.03, 0.06, "highpass", 3000, { delay: i * 0.05 });
  }

  shield() {
    for (const [f, d] of [[523, 0], [659, 0.05], [784, 0.1], [1046, 0.15]] as const) this.tone(f, 0.5, "sine", 0.05, { slide: f * 1.5, delay: d, verb: 0.6 });
  }

  /** A drift charge level reached: spark ting, brighter each tier. */
  drift(tier: number) {
    const f = [0, 1400, 1800, 2300][tier];
    this.tone(f, 0.16, "triangle", 0.05, { verb: 0.4 });
    this.tone(f * 1.5, 0.12, "sine", 0.025, { delay: 0.03 });
    this.burst(0.12, 0.05, "highpass", 5000);
  }

  /** The glider snaps open. */
  glide() {
    this.burst(0.35, 0.16, "bandpass", 1800, { to: 300, q: 1.3 });
    this.tone(110, 0.2, "sine", 0.12, { slide: 60 });
    this.tone(660, 0.25, "triangle", 0.035, { delay: 0.1, verb: 0.5 });
  }

  lap() {
    [72, 76, 79, 84].forEach((n, i) => this.tone(midi(n), 0.18, "square", 0.04, { delay: i * 0.09, verb: 0.5 }));
    this.cheer(0.6);
  }

  /** Infinite: a heart lost — a heavy thud and a falling tone. */
  heartLost() {
    this.tone(150, 0.45, "sine", 0.3, { slide: 55 });
    this.tone(420, 0.5, "triangle", 0.07, { slide: 140, verb: 0.4 });
    this.burst(0.3, 0.16, "lowpass", 900, { to: 160, buf: this.brown });
  }

  /** Infinite: a heart found — a bright rising sparkle. */
  heartGain() {
    [72, 76, 79, 84, 88].forEach((n, i) => this.tone(midi(n), 0.2, "triangle", 0.05, { delay: i * 0.05, verb: 0.6 }));
    this.tone(midi(96), 0.4, "sine", 0.025, { delay: 0.25, verb: 0.6 });
  }

  /** Infinite: a near miss — air ripping past. */
  whoosh() {
    this.burst(0.32, 0.14, "bandpass", 500, { to: 2600, q: 1.8 });
    this.tone(1250, 0.12, "sine", 0.03, { slide: 1700, delay: 0.05 });
  }

  /** Infinite: the multiplier steps up. */
  multUp(m: number) {
    const base = 72 + m * 2;
    [0, 4, 7, 12].forEach((d, i) => this.tone(midi(base + d), 0.16, "square", 0.035, { delay: i * 0.06, verb: 0.5 }));
    this.cheer(0.4);
  }

  /** Infinite: out of hearts. */
  gameOver() {
    this.tone(220, 1.1, "sawtooth", 0.06, { slide: 55, verb: 0.6 });
    this.tone(110, 0.9, "square", 0.05, { slide: 40 });
    this.burst(0.8, 0.2, "lowpass", 1400, { to: 120, buf: this.brown, verb: 0.5 });
  }

  fanfare() {
    const brass = (n: number, d: number, len: number) => {
      const c = this.c;
      if (!c) return;
      const t = c.currentTime + d;
      for (const det of [-8, 8]) {
        const o = c.createOscillator();
        o.type = "sawtooth"; o.frequency.value = midi(n); o.detune.value = det;
        const f = c.createBiquadFilter(); f.type = "lowpass";
        f.frequency.setValueAtTime(600, t); f.frequency.linearRampToValueAtTime(3200, t + 0.06); f.frequency.exponentialRampToValueAtTime(1200, t + len);
        o.connect(f);
        f.connect(this.env(t, 0.035, 0.02, len, this.sfxBus));
        f.connect(this.env(t, 0.03, 0.02, len, this.verbIn));
        o.start(t); o.stop(t + len + 0.1);
      }
    };
    [[67, 0, 0.16], [72, 0.14, 0.16], [76, 0.28, 0.16], [79, 0.42, 0.4], [76, 0.72, 0.14], [79, 0.86, 1.0]].forEach(([n, d, l]) => brass(n, d, l));
    for (const n of [60, 64, 67, 72]) brass(n, 0.86, 1.2);
    [0.42, 0.86].forEach((d) => this.tone(80, 0.5, "sine", 0.18, { slide: 50, delay: d }));
    this.cheer(1.2);
  }

  /* ================================================================ */
  /* Soundtrack                                                       */
  /* ================================================================ */

  private schedule() {
    const c = this.c;
    if (!c) return;
    while (this.nextNote < c.currentTime + 0.14) {
      this.playStep(this.step, this.nextNote);
      this.nextNote += this.stepLen;
      this.step = (this.step + 1) % (16 * 8);
    }
  }

  /** Neon Town plays the night version of the soundtrack; the Skyway its own. */
  night = false;
  sky = false;

  private playStep(step: number, t: number) {
    const bar = Math.floor(step / 16) % 4;
    const s = step % 16;
    const withLead = Math.floor(step / 64) === 1;
    const ch = (this.sky ? PROG_SKY : this.night ? PROG_NIGHT : PROG)[bar];
    if (s % 4 === 0) this.mKick(t);
    // At night the backbeat drops to half time, which makes it feel wider.
    if (this.night ? s === 8 : s === 4 || s === 12) this.mSnare(t);
    this.mHat(t, s % 4 === 2, s % 2 ? 0.5 : 0.8);
    if (s % 2 === 0) this.mBass(t, midi(ch.root + (s % 4 === 2 ? 12 : 0)), STEP * 1.8);
    this.mArp(t, midi(ch.notes[ARP[s % 8]] + 12));
    if (s === 0) this.mPad(t, ch.notes, STEP * 16);
    if (withLead) {
      const n = (this.sky ? LEAD_SKY : this.night ? LEAD_NIGHT : LEAD)[bar][s];
      if (n) this.mLead(t, midi(n), STEP * 1.7);
    }
  }

  private mKick(t: number) {
    const c = this.c!;
    const o = c.createOscillator();
    o.frequency.setValueAtTime(190, t);
    o.frequency.exponentialRampToValueAtTime(50, t + 0.11);
    o.connect(this.env(t, 0.6, 0.002, 0.28, this.musicBus));
    o.start(t); o.stop(t + 0.4);
    // The beater click: what makes a kick punch through a phone speaker.
    const src = c.createBufferSource(); src.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 3200; f.Q.value = 1.2;
    src.connect(f).connect(this.env(t, 0.22, 0.001, 0.018, this.musicBus));
    src.start(t, Math.random(), 0.05);
  }
  private mSnare(t: number) {
    const c = this.c!;
    const src = c.createBufferSource(); src.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 1900; f.Q.value = 0.8;
    src.connect(f);
    f.connect(this.env(t, 0.45, 0.002, 0.2, this.musicBus));
    f.connect(this.env(t, 0.35, 0.002, 0.3, this.verbIn));
    src.start(t, Math.random(), 0.3);
    const o = c.createOscillator(); o.type = "triangle";
    o.frequency.setValueAtTime(210, t); o.frequency.exponentialRampToValueAtTime(150, t + 0.08);
    o.connect(this.env(t, 0.35, 0.002, 0.1, this.musicBus));
    o.start(t); o.stop(t + 0.2);
  }
  private mHat(t: number, open: boolean, k: number) {
    const c = this.c!;
    const src = c.createBufferSource(); src.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 7500;
    src.connect(f).connect(this.env(t, (open ? 0.16 : 0.1) * k, 0.001, open ? 0.2 : 0.035, this.musicBus));
    src.start(t, Math.random(), 0.3);
  }
  private mBass(t: number, freq: number, len: number) {
    const c = this.c!;
    const f = c.createBiquadFilter(); f.type = "lowpass"; f.Q.value = 5;
    f.frequency.setValueAtTime(1500, t); f.frequency.exponentialRampToValueAtTime(240, t + len);
    f.connect(this.env(t, 0.26, 0.004, len, this.musicBus));
    for (const [type, det] of [["sawtooth", -6], ["square", 6]] as const) {
      const o = c.createOscillator(); o.type = type; o.frequency.value = freq; o.detune.value = det;
      o.connect(f); o.start(t); o.stop(t + len + 0.05);
    }
  }
  private mArp(t: number, freq: number) {
    const c = this.c!;
    const o = c.createOscillator(); o.type = "square"; o.frequency.value = freq;
    const f = c.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 2400;
    o.connect(f);
    f.connect(this.env(t, 0.06, 0.003, 0.12, this.arpBus[this.step & 1] ?? this.musicBus));
    f.connect(this.env(t, 0.05, 0.003, 0.12, this.delayIn));
    o.start(t); o.stop(t + 0.2);
  }
  private mPad(t: number, notes: number[], len: number) {
    const c = this.c!;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.045, t + 0.3);
    g.gain.setValueAtTime(0.045, t + len - 0.2);
    g.gain.linearRampToValueAtTime(0.0001, t + len + 0.3);
    g.connect(this.musicBus); g.connect(this.verbIn);
    // Two detuned layers spread left and right: a wide, lush pad.
    for (const det of [-9, 9]) {
      const f = c.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 1300;
      const p = c.createStereoPanner(); p.pan.value = det > 0 ? 0.6 : -0.6;
      f.connect(p).connect(g);
      for (const n of notes) {
        const o = c.createOscillator(); o.type = "sawtooth"; o.frequency.value = midi(n); o.detune.value = det;
        o.connect(f); o.start(t); o.stop(t + len + 0.4);
      }
    }
  }
  private mLead(t: number, freq: number, len: number) {
    const c = this.c!;
    const o = c.createOscillator(); o.type = "sawtooth"; o.frequency.value = freq;
    const vib = c.createOscillator(); vib.frequency.value = 5.5;
    const vg = c.createGain(); vg.gain.value = freq * 0.006;
    vib.connect(vg).connect(o.frequency);
    const f = c.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 2800;
    o.connect(f);
    f.connect(this.env(t, 0.07, 0.01, len, this.musicBus));
    f.connect(this.env(t, 0.05, 0.01, len, this.delayIn));
    o.start(t); o.stop(t + len + 0.1);
    vib.start(t); vib.stop(t + len + 0.1);
  }
}
