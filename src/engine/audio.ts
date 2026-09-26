/**
 * Procedural WebAudio. No files, no load time, no iOS autoplay surprises —
 * the context is created lazily on the first real user gesture.
 */
let ctx: AudioContext | null = null;
let muted = false;

function ac(): AudioContext | null {
  if (muted) return null;
  if (!ctx) {
    const C = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!C) return null;
    ctx = new C();
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
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
  osc.connect(amp).connect(c.destination);
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
  src.connect(filt).connect(amp).connect(c.destination);
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
