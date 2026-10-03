/**
 * A small offline synth kit shared by the trailer and the intro film: a mix
 * bus with a master low-pass (for slow-motion moments) and a glue
 * compressor, a generated reverb, a dotted-eighth delay, and the drums,
 * bass, arps, pads, risers and hits the soundtracks are written with.
 */

export const SR = 48000;

export const N = (name: string) => {
  const notes: Record<string, number> = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 };
  const oct = Number(name.slice(-1));
  return 440 * Math.pow(2, (notes[name[0]] + (oct - 4) * 12) / 12);
};

export function createKit(ctx: OfflineAudioContext, beat: number) {

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
  delay.delayTime.value = beat * 0.75;
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


  return { ctx, bus, lp, comp, master, verb, delay, noiseSrc, env, pan, kick, snare, hat, bass, arp, pad, riser, impact, whoosh, beep, stab };
}

export type Kit = ReturnType<typeof createKit>;

/**
 * Soft limiter: raise the loudness without hard clipping, then normalise to
 * -1 dBFS.
 */
export function master(buf: AudioBuffer) {
  let pk = 0;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) for (const v of buf.getChannelData(ch)) pk = Math.max(pk, Math.abs(v));
  const drive = 2.2 / (pk || 1);
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < d.length; i++) d[i] = Math.tanh(d[i] * drive);
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
