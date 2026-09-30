/**
 * Procedural WebAudio. No files, no load time, no iOS autoplay surprises —
 * the context is created lazily on the first real user gesture.
 *
 * Everything plays through one master chain tuned for phone speakers as
 * much as headphones (see `master`).
 */
let ctx: AudioContext | null = null;
let muted = false;
const lite = typeof document !== "undefined" && document.documentElement.classList.contains("lite");

function ac(): AudioContext | null {
  if (muted) return null;
  if (!ctx) {
    const C = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!C) return null;
    // Phones get a little more buffer: no crackles when the page is busy.
    try { ctx = new C({ latencyHint: lite ? "balanced" : "interactive" }); } catch { ctx = new C(); }
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

const chains = new WeakMap<BaseAudioContext, AudioNode>();

/**
 * The master chain every sound goes through:
 *
 *   rumble cut → "virtual bass" → presence → glue compressor → limiter
 *
 * Phone speakers can't move air below ~200 Hz, so the engine and the kick
 * used to vanish while their inaudible energy still pushed the mix into
 * distortion. The low end is cut where no speaker plays it, and harmonics of
 * the bass are added an octave or two up, where a phone *can* play them —
 * the ear fills in the fundamental. A brick-wall limiter at the end keeps
 * it loud and clean however much is going on.
 */
export function master(c: BaseAudioContext): AudioNode {
  const have = chains.get(c);
  if (have) return have;
  const input = c.createGain();
  // Phones: a steep cut at 110 Hz (two stages), since nothing below plays.
  const hp = c.createBiquadFilter();
  hp.type = "highpass"; hp.frequency.value = lite ? 110 : 30; hp.Q.value = 0.7;
  if (lite) {
    const hp0 = c.createBiquadFilter(); hp0.type = "highpass"; hp0.frequency.value = 110; hp0.Q.value = 0.7;
    input.connect(hp0).connect(hp);
  } else input.connect(hp);

  // Virtual bass: saturate the lows, keep only the new harmonics, mix them in.
  const lowTap = c.createBiquadFilter(); lowTap.type = "lowpass"; lowTap.frequency.value = 180; lowTap.Q.value = 0.7;
  const sat = c.createWaveShaper();
  const curve = new Float32Array(2048);
  for (let i = 0; i < curve.length; i++) { const x = (i / (curve.length - 1)) * 2 - 1; curve[i] = Math.tanh(x * 4) * 0.8 + x * Math.abs(x) * 0.25; }
  sat.curve = curve;
  sat.oversample = "2x";
  // Keep only the new harmonics: the saturated fundamental is cut steeply.
  const h1 = c.createBiquadFilter(); h1.type = "highpass"; h1.frequency.value = 220; h1.Q.value = 0.7;
  const h2 = c.createBiquadFilter(); h2.type = "highpass"; h2.frequency.value = 220; h2.Q.value = 0.7;
  const harm = c.createBiquadFilter(); harm.type = "lowpass"; harm.frequency.value = 1100; harm.Q.value = 0.7;
  const harmG = c.createGain(); harmG.gain.value = lite ? 0.5 : 0.15;
  const pre = c.createGain(); pre.gain.value = 3;
  input.connect(lowTap).connect(pre).connect(sat).connect(h1).connect(h2).connect(harm).connect(harmG);

  // Tone: tame the boxy low-mids, a touch of presence and air.
  const mud = c.createBiquadFilter(); mud.type = "peaking"; mud.frequency.value = 320; mud.Q.value = 1.1; mud.gain.value = -2;
  const pres = c.createBiquadFilter(); pres.type = "peaking"; pres.frequency.value = 2600; pres.Q.value = 0.9; pres.gain.value = lite ? 3 : 1.5;
  const air = c.createBiquadFilter(); air.type = "highshelf"; air.frequency.value = 9000; air.gain.value = 2;
  hp.connect(mud); harmG.connect(mud);
  mud.connect(pres).connect(air);

  const glue = c.createDynamicsCompressor();
  glue.threshold.value = -18; glue.knee.value = 10; glue.ratio.value = 3; glue.attack.value = 0.006; glue.release.value = 0.18;
  const makeup = c.createGain(); makeup.gain.value = lite ? 1.9 : 1.5;
  const limit = c.createDynamicsCompressor();
  limit.threshold.value = -3; limit.knee.value = 0; limit.ratio.value = 20; limit.attack.value = 0.001; limit.release.value = 0.08;
  const trim = c.createGain(); trim.gain.value = 0.86;
  air.connect(glue).connect(makeup).connect(limit).connect(trim).connect(c.destination);
  chains.set(c, input);
  return input;
}

/** Menu sounds: a short plate reverb so they sound like the game, not a beep. */
let menuOut: AudioNode | null = null;
function menuBus(c: AudioContext): AudioNode {
  if (menuOut) return menuOut;
  const dry = c.createGain(); dry.gain.value = 1.6;
  const verb = c.createConvolver();
  const ir = c.createBuffer(2, Math.floor(c.sampleRate * 0.7), c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 4);
  }
  verb.buffer = ir;
  const wet = c.createGain(); wet.gain.value = 0.16;
  dry.connect(master(c));
  dry.connect(verb).connect(wet).connect(master(c));
  return (menuOut = dry);
}

/**
 * Unlock audio on the first touch or key: iOS only lets a page make sound
 * after a gesture, and plays WebAudio through the ringer (silent switch!)
 * unless the page says it's media playback.
 */
if (typeof window !== "undefined") {
  const nav = navigator as Navigator & { audioSession?: { type: string } };
  try { if (nav.audioSession) nav.audioSession.type = "playback"; } catch { /* older Safari */ }
  const unlock = () => {
    const c = ac();
    if (!c) return;
    // A silent blip inside the gesture is what actually opens iOS's output.
    const b = c.createBuffer(1, 1, c.sampleRate);
    const src = c.createBufferSource();
    src.buffer = b; src.connect(c.destination); src.start();
    if (c.state === "running") for (const e of ["pointerdown", "touchend", "keydown"]) removeEventListener(e, unlock, true);
  };
  for (const e of ["pointerdown", "touchend", "keydown"]) addEventListener(e, unlock, true);
  // Coming back to the tab (or out of a phone call): wake the context up.
  document.addEventListener("visibilitychange", () => { if (!document.hidden && ctx?.state !== "running" && !muted) void ctx?.resume().catch(() => {}); });
}

type Wave = OscillatorType;

function tone(freq: number, dur: number, type: Wave, gain: number, slideTo?: number) {
  const c = ac();
  if (!c) return;
  const osc = c.createOscillator();
  const amp = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, c.currentTime);
  if (slideTo !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), c.currentTime + dur);
  }
  amp.gain.setValueAtTime(0.0001, c.currentTime);
  amp.gain.exponentialRampToValueAtTime(gain, c.currentTime + 0.008);
  amp.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
  osc.connect(amp).connect(menuBus(c));
  osc.start();
  osc.stop(c.currentTime + dur + 0.02);
}

function noise(dur: number, gain: number) {
  const c = ac();
  if (!c) return;
  const n = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, n, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = c.createBufferSource();
  const amp = c.createGain();
  const filt = c.createBiquadFilter();
  filt.type = "lowpass";
  filt.frequency.value = 1400;
  amp.gain.value = gain;
  src.buffer = buf;
  src.connect(filt).connect(amp).connect(menuBus(c));
  src.start();
}

/** Pentatonic ladder — consecutive hits climb, so a combo literally sounds better. */
const LADDER = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51, 1567.98, 1760];

export const sfx = {
  /** Soft glassy click. */
  ui: () => {
    tone(880, 0.05, "sine", 0.05, 1320);
    tone(1760, 0.03, "triangle", 0.015);
  },
  /** Dialogue typing. Very short and quiet — it plays a few hundred times. */
  type: () => tone(700 + Math.random() * 120, 0.016, "triangle", 0.018),
  /** A character appearing: a bubbly pop. */
  pop: () => {
    tone(260, 0.08, "sine", 0.08, 820);
    setTimeout(() => tone(1240, 0.12, "sine", 0.04), 50);
    setTimeout(() => tone(1860, 0.08, "triangle", 0.015), 70);
  },
  perfect: (step: number) => {
    const f = LADDER[Math.min(step, LADDER.length - 1)];
    tone(f, 0.16, "triangle", 0.12);
    tone(f * 2, 0.1, "sine", 0.05);
  },
  good: (step: number) => tone(LADDER[Math.min(step, LADDER.length - 1)] * 0.75, 0.12, "sine", 0.08),
  miss: () => {
    tone(150, 0.22, "sawtooth", 0.07, 60);
    noise(0.12, 0.05);
  },
  over: () => {
    tone(330, 0.5, "sine", 0.09, 110);
    setTimeout(() => tone(220, 0.6, "triangle", 0.07, 82), 90);
  },
  /** Let's go: a bright rising chime. */
  start: () => {
    tone(523.25, 0.12, "triangle", 0.07);
    setTimeout(() => tone(659.25, 0.12, "triangle", 0.07), 70);
    setTimeout(() => { tone(783.99, 0.3, "triangle", 0.08); tone(1567.98, 0.25, "sine", 0.03); }, 140);
  },
};

export function setMuted(v: boolean) {
  muted = v;
  if (v && ctx) void ctx.suspend();
}
export function isMuted() {
  return muted;
}

/** The shared context, for modules that build their own audio graphs. Null when muted. */
export function audioCtx(): AudioContext | null {
  return ac();
}
