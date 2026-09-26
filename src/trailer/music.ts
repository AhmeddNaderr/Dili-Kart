/**
 * The trailer soundtrack, synthesised offline so every hit lands exactly on
 * the edit: 120 BPM synthwave in A minor (Am – F – C – G).
 *
 *   0–2   pad and riser, impact on the first cut
 *   2–5   half-time groove under the grid shots
 *   5–8   countdown beeps (3, 2, 1) and a snare roll into GO
 *   8–20  full groove; the jump (17–19) goes muffled like slow motion
 *   20–22 breakdown and riser
 *   22    the logo slam, then the last chord rings out
 */

export const BPM = 120;
const BEAT = 60 / BPM;
const SR = 48000;

const N = (name: string) => {
  const notes: Record<string, number> = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 };
  const oct = Number(name.slice(-1));
  return 440 * Math.pow(2, (notes[name[0]] + (oct - 4) * 12) / 12);
};

/** Chord per bar: root for the bass, and the notes for pads and arps. */
const PROG: [string, string[]][] = [
  ["A2", ["A3", "C4", "E4"]],
  ["F2", ["F3", "A3", "C4"]],
  ["C3", ["C4", "E4", "G4"]],
  ["G2", ["G3", "B3", "D4"]],
];
const chordAt = (t: number) => PROG[Math.floor(t / (BEAT * 4)) % 4];

export async function renderSoundtrack(duration: number): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, Math.ceil(SR * duration), SR);

  // Mix bus → master low-pass (for the slow-motion moment) → glue compressor.
  const bus = ctx.createGain();
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 20000;
  lp.Q.value = 0.8;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.ratio.value = 4;
  comp.attack.value = 0.004;
  comp.release.value = 0.18;
  const master = ctx.createGain();
  master.gain.value = 0.9;
  bus.connect(lp).connect(comp).connect(master).connect(ctx.destination);

  // Reverb send: a generated stereo impulse.
  const verb = ctx.createConvolver();
  const ir = ctx.createBuffer(2, SR * 2.4, SR);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3.2);
  }
  verb.buffer = ir;
  const verbGain = ctx.createGain();
  verbGain.gain.value = 0.35;
  verb.connect(verbGain).connect(bus);

  // Dotted-eighth delay for the arp.
  const delay = ctx.createDelay(1);
  delay.delayTime.value = BEAT * 0.75;
  const fb = ctx.createGain();
  fb.gain.value = 0.34;
  const dlp = ctx.createBiquadFilter();
  dlp.type = "lowpass";
  dlp.frequency.value = 3200;
  delay.connect(dlp).connect(fb).connect(delay);
  const delayOut = ctx.createGain();
  delayOut.gain.value = 0.4;
  dlp.connect(delayOut).connect(bus);

  const noise = ctx.createBuffer(1, SR, SR);
  { const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
  const noiseSrc = (t: number, dur: number) => {
    const s = ctx.createBufferSource();
    s.buffer = noise;
    s.loop = true;
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur);
    return s;
  };
  const env = (t: number, peak: number, attack: number, decay: number, to: AudioNode, curve: "exp" | "lin" = "exp") => {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    if (curve === "exp") g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    else g.gain.linearRampToValueAtTime(0, t + attack + decay);
    g.connect(to);
    return g;
  };
  const pan = (v: number, to: AudioNode) => {
    const p = ctx.createStereoPanner();
    p.pan.value = v;
    p.connect(to);
    return p;
  };

  /* ---------- instruments ---------- */
  const kick = (t: number, gain = 1) => {
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(170, t);
    o.frequency.exponentialRampToValueAtTime(44, t + 0.13);
    o.connect(env(t, 1.1 * gain, 0.002, 0.42, bus));
    o.start(t); o.stop(t + 0.5);
    const click = noiseSrc(t, 0.02);
    const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 2500;
    click.connect(hp).connect(env(t, 0.25 * gain, 0.001, 0.015, bus));
  };
  const snare = (t: number, gain = 1) => {
    const n = noiseSrc(t, 0.3);
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1900; bp.Q.value = 0.7;
    const out = env(t, 0.55 * gain, 0.001, 0.22, bus);
    n.connect(bp).connect(out);
    n.connect(bp).connect(env(t, 0.25 * gain, 0.001, 0.3, verb));
    const o = ctx.createOscillator(); o.type = "triangle";
    o.frequency.setValueAtTime(200, t); o.frequency.exponentialRampToValueAtTime(140, t + 0.08);
    o.connect(env(t, 0.5 * gain, 0.001, 0.1, bus));
    o.start(t); o.stop(t + 0.2);
  };
  const hat = (t: number, open = false, gain = 1) => {
    const n = noiseSrc(t, open ? 0.3 : 0.06);
    const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 7500;
    n.connect(hp).connect(env(t, (open ? 0.2 : 0.13) * gain, 0.001, open ? 0.24 : 0.04, pan(open ? -0.2 : 0.25, bus)));
  };
  const bass = (t: number, f: number, len: number) => {
    const f1 = ctx.createBiquadFilter(); f1.type = "lowpass"; f1.Q.value = 6;
    f1.frequency.setValueAtTime(1700, t); f1.frequency.exponentialRampToValueAtTime(260, t + len * 0.9);
    const out = env(t, 0.42, 0.004, len, bus);
    f1.connect(out);
    for (const [type, det] of [["sawtooth", -6], ["square", 6]] as const) {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = det;
      o.connect(f1); o.start(t); o.stop(t + len + 0.05);
    }
  };
  const arp = (t: number, f: number, gain = 1) => {
    const o = ctx.createOscillator(); o.type = "square"; o.frequency.value = f;
    const fl = ctx.createBiquadFilter(); fl.type = "lowpass"; fl.frequency.value = 2600;
    const out = env(t, 0.1 * gain, 0.003, 0.14, pan(Math.sin(t * 3) * 0.4, bus));
    o.connect(fl).connect(out);
    fl.connect(env(t, 0.08 * gain, 0.003, 0.14, delay));
    o.start(t); o.stop(t + 0.2);
  };
  const pad = (t: number, notes: string[], len: number, gain = 1) => {
    const fl = ctx.createBiquadFilter(); fl.type = "lowpass"; fl.frequency.value = 1500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.06 * gain, t + 0.35);
    g.gain.setValueAtTime(0.06 * gain, t + len - 0.1);
    g.gain.linearRampToValueAtTime(0.0001, t + len + 0.5);
    fl.connect(g); g.connect(bus); g.connect(verb);
    for (const n of notes) for (const det of [-9, 9]) {
      const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = N(n); o.detune.value = det;
      o.connect(fl); o.start(t); o.stop(t + len + 0.6);
    }
  };
  const riser = (t0: number, t1: number, gain = 1) => {
    const n = noiseSrc(t0, t1 - t0 + 0.05);
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 2;
    bp.frequency.setValueAtTime(300, t0); bp.frequency.exponentialRampToValueAtTime(7000, t1);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.45 * gain, t1 - 0.02); g.gain.linearRampToValueAtTime(0, t1);
    n.connect(bp).connect(g); g.connect(bus); g.connect(verb);
    const o = ctx.createOscillator(); o.type = "sawtooth";
    o.frequency.setValueAtTime(110, t0); o.frequency.exponentialRampToValueAtTime(880, t1);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t0); og.gain.exponentialRampToValueAtTime(0.06 * gain, t1 - 0.02); og.gain.linearRampToValueAtTime(0, t1);
    o.connect(og).connect(bus); o.start(t0); o.stop(t1 + 0.05);
  };
  const impact = (t: number, gain = 1) => {
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(28, t + 1.1);
    o.connect(env(t, 1.0 * gain, 0.003, 1.3, bus)); o.start(t); o.stop(t + 1.5);
    const n = noiseSrc(t, 1.8);
    const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 1800;
    n.connect(hp).connect(env(t, 0.35 * gain, 0.002, 1.5, bus));
    n.connect(hp).connect(env(t, 0.4 * gain, 0.002, 1.8, verb));
    kick(t, gain);
  };
  const whoosh = (t: number, dur: number) => {
    const n = noiseSrc(t, dur);
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 1.5;
    bp.frequency.setValueAtTime(400, t); bp.frequency.exponentialRampToValueAtTime(3500, t + dur * 0.6); bp.frequency.exponentialRampToValueAtTime(600, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.35, t + dur * 0.55); g.gain.linearRampToValueAtTime(0, t + dur);
    n.connect(bp).connect(g).connect(pan(0, bus));
  };
  const beep = (t: number, f: number, len: number) => {
    const o = ctx.createOscillator(); o.type = "square"; o.frequency.value = f;
    const fl = ctx.createBiquadFilter(); fl.type = "lowpass"; fl.frequency.value = 3000;
    o.connect(fl).connect(env(t, 0.22, 0.004, len, bus, "lin"));
    fl.connect(env(t, 0.12, 0.004, len, verb, "lin"));
    o.start(t); o.stop(t + len + 0.05);
  };
  const stab = (t: number, notes: string[], gain = 1) => {
    for (const n of notes) for (const det of [-12, 12]) {
      const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = N(n) * 2; o.detune.value = det;
      const fl = ctx.createBiquadFilter(); fl.type = "lowpass"; fl.frequency.setValueAtTime(5000, t); fl.frequency.exponentialRampToValueAtTime(600, t + 0.6);
      o.connect(fl).connect(env(t, 0.05 * gain, 0.003, 0.7, bus));
      fl.connect(env(t, 0.05 * gain, 0.003, 1.2, verb));
      o.start(t); o.stop(t + 1);
    }
  };

  /* ---------- arrangement ---------- */
  const ARP = [0, 1, 2, 1, 0, 2, 1, 2];   // chord-tone pattern over 16ths
  const groove = (from: number, to: number, full: boolean) => {
    for (let t = from; t < to - 1e-6; t += BEAT / 4) {
      const step = Math.round((t - from) / (BEAT / 4));
      const beat = Math.floor(step / 4);
      const sub = step % 4;
      const [root, notes] = chordAt(t);
      if (sub === 0 && (full || beat % 2 === 0)) kick(t);
      if (sub === 0 && beat % 2 === 1) snare(t, full ? 1 : 0.6);
      if (full) hat(t, sub === 2, sub === 2 ? 1 : 0.7);
      else if (sub === 2) hat(t, false, 0.8);
      if (sub % 2 === 0) bass(t, N(root) * (sub === 2 && full ? 2 : 1), BEAT / 2 * 0.9);
      if (full) arp(t, N(notes[ARP[step % 8]]) * 2, 0.9);
    }
  };

  // 0–2: pad and riser.
  pad(0, PROG[0][1], 2);
  riser(0.2, 2.0, 0.8);
  // 2–5: half-time groove.
  impact(2.0, 0.8);
  pad(2, PROG[1][1], 2, 0.8);
  pad(4, PROG[2][1], 1, 0.8);
  groove(2, 5, false);
  // 5–8: countdown.
  for (const [t, f] of [[5, 440], [6, 440], [7, 440]] as const) beep(t, f, 0.3);
  for (const t of [5, 6, 7]) kick(t, 0.8);
  pad(5, PROG[3][1], 3, 0.9);
  for (let t = 7; t < 8; t += BEAT / (t < 7.5 ? 4 : 8)) snare(t, 0.35 + (t - 7) * 0.6);
  riser(6, 8, 0.9);
  // 8–20: full groove, GO!
  beep(8, 880, 0.6);
  impact(8, 1);
  stab(8, PROG[0][1]);
  groove(8, 20, true);
  for (let b = 8; b < 20; b += 2) pad(b, chordAt(b)[1], 2, 0.9);
  impact(14, 0.5);                  // the drift
  whoosh(16.6, 1.0);                // off the ramp
  stab(19, chordAt(19)[1], 0.8);    // the Custodians
  // Slow motion over the jump: the whole mix goes muffled, then snaps back.
  lp.frequency.setValueAtTime(20000, 17.2);
  lp.frequency.exponentialRampToValueAtTime(700, 17.45);
  lp.frequency.setValueAtTime(700, 18.5);
  lp.frequency.exponentialRampToValueAtTime(20000, 19.0);
  // 20–22: breakdown into the logo.
  pad(20, PROG[0][1], 2, 1.1);
  for (let t = 20; t < 22; t += BEAT / 4) arp(t, N(chordAt(t)[1][ARP[Math.round(t * 8) % 8]]) * 2, 0.6);
  for (let t = 20; t < 22; t += BEAT) kick(t, 0.5);
  riser(20.4, 22, 1.1);
  // 22: logo slam, last chord rings out.
  impact(22, 1.2);
  stab(22, ["A3", "C4", "E4", "B4"], 1.2);
  pad(22, ["A3", "C4", "E4", "B4"], 3, 1.2);
  bass(22, N("A1"), 2.5);
  for (let t = 22; t < 24; t += BEAT / 2) arp(t, N(["A4", "E5", "C5", "B4"][Math.round((t - 22) * 2) % 4]), 0.5 * (1 - (t - 22) / 2.5));
  master.gain.setValueAtTime(0.9, duration - 1.6);
  master.gain.linearRampToValueAtTime(0, duration);

  const buf = await ctx.startRendering();
  // Soft limiter: raise the loudness for social feeds without hard clipping,
  // then normalise to -1 dBFS.
  {
    let pk = 0;
    for (let ch = 0; ch < buf.numberOfChannels; ch++) for (const v of buf.getChannelData(ch)) pk = Math.max(pk, Math.abs(v));
    const drive = 2.2 / (pk || 1);
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < d.length; i++) d[i] = Math.tanh(d[i] * drive);
    }
  }
  let peak = 0;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  }
  const k = peak > 0 ? 0.89 / peak : 1;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < d.length; i++) d[i] *= k;
  }
  return buf;
}
