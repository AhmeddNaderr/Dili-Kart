import { N, SR, createKit, master as finish } from "../trailer/synth";
import { CUE } from "./cues";

/**
 * The intro film's soundtrack, synthesised offline against the edit (see
 * cues.ts): a warm stadium morning, the dashboard coming to life, the
 * engine, the countdown, then a 128 BPM groove from GO to the logo.
 */

const BPM = 128;
const BEAT = 60 / BPM;
const PROG: [string, string[]][] = [
  ["D2", ["D3", "F#3", "A3", "C#4"]],
  ["B1", ["B2", "D3", "F#3", "A3"]],
  ["G2", ["G3", "B3", "D4", "F#4"]],
  ["A2", ["A3", "C#4", "E4", "G4"]],
];

export async function renderScore(duration: number): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, Math.ceil(SR * duration), SR);
  const K = createKit(ctx, BEAT);
  const { bus, verb, lp, master, noiseSrc, env, pan, kick, snare, hat, bass, arp, riser, impact, whoosh, beep, stab } = K;
  // Note names above use sharps; the kit's note parser reads the letter and
  // octave, so bend the sharps up a semitone here.
  const F = (n: string) => (n.includes("#") ? N(n.replace("#", "")) * Math.pow(2, 1 / 12) : N(n));
  const padF = (t: number, notes: string[], len: number, gain = 1) => {
    // Same voice as the kit's pad, but with sharps.
    const fl = ctx.createBiquadFilter(); fl.type = "lowpass"; fl.frequency.value = 1300;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.05 * gain, t + 0.8);
    g.gain.setValueAtTime(0.05 * gain, t + len - 0.2);
    g.gain.linearRampToValueAtTime(0.0001, t + len + 0.8);
    fl.connect(g); g.connect(bus); g.connect(verb);
    for (const n of notes) for (const det of [-8, 8]) {
      const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = F(n); o.detune.value = det;
      o.connect(fl); o.start(t); o.stop(t + len + 1);
    }
  };
  const chordAt = (t: number) => PROG[Math.floor(Math.max(0, t - CUE.go) / (BEAT * 4)) % 4];

  /* ---------- stadium morning ---------- */
  // Crowd: band-passed noise with slow swells, panned wide.
  for (const [pv, f] of [[-0.6, 900], [0.6, 1300]] as const) {
    const n = noiseSrc(0, duration);
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = f; bp.Q.value = 0.6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, 0);
    g.gain.linearRampToValueAtTime(0.05, 1.5);
    for (let t = 2; t < duration; t += 2.5) g.gain.linearRampToValueAtTime(0.035 + Math.random() * 0.03, t);
    g.gain.linearRampToValueAtTime(0.09, CUE.go + 0.3);
    g.gain.linearRampToValueAtTime(0.02, duration);
    n.connect(bp).connect(g).connect(pan(pv, bus));
  }
  padF(0, PROG[0][1], 4.4, 0.9);
  padF(4.4, PROG[2][1], 4.4, 0.9);
  padF(8.8, PROG[3][1], 2.6, 0.8);
  // Footsteps: soft thuds while Dili walks.
  for (let t = CUE.walkFrom; t < CUE.walkTo; t += 0.42) {
    const n = noiseSrc(t, 0.08);
    const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 500;
    n.connect(f).connect(env(t, 0.22, 0.004, 0.07, bus));
  }
  // The hop: a springy boing up, a thump and a creak of suspension down.
  {
    const o = ctx.createOscillator(); o.type = "sine";
    o.frequency.setValueAtTime(260, CUE.jump); o.frequency.exponentialRampToValueAtTime(760, CUE.jump + 0.3);
    o.connect(env(CUE.jump, 0.12, 0.01, 0.34, bus)); o.start(CUE.jump); o.stop(CUE.jump + 0.4);
    kick(CUE.land, 0.55);
    const c = ctx.createOscillator(); c.type = "triangle";
    c.frequency.setValueAtTime(180, CUE.land + 0.05); c.frequency.linearRampToValueAtTime(120, CUE.land + 0.3);
    c.connect(env(CUE.land + 0.05, 0.06, 0.01, 0.25, bus)); c.start(CUE.land); c.stop(CUE.land + 0.4);
  }
  // A gentle arp while he settles in and the dash wakes up.
  for (let t = CUE.cockpit; t < CUE.rev; t += BEAT / 2) {
    const i = Math.round((t - CUE.cockpit) / (BEAT / 2));
    arp(t, F(["A4", "D5", "F#5", "A5", "E5", "D5"][i % 6]), 0.45 + 0.25 * ((t - CUE.cockpit) / (CUE.rev - CUE.cockpit)));
  }
  padF(11.4, PROG[1][1], 5, 0.8);

  /* ---------- dashboard ---------- */
  const blip = (t: number, f: number, len = 0.09, gain = 1) => {
    const o = ctx.createOscillator(); o.type = "square"; o.frequency.value = f;
    const fl = ctx.createBiquadFilter(); fl.type = "lowpass"; fl.frequency.value = 4200;
    o.connect(fl).connect(env(t, 0.12 * gain, 0.002, len, bus));
    fl.connect(env(t, 0.06 * gain, 0.002, len, verb));
    o.start(t); o.stop(t + len + 0.05);
  };
  blip(CUE.boot, F("A5"), 0.12); blip(CUE.boot + 0.12, F("D6"), 0.12); blip(CUE.boot + 0.24, F("F#6"), 0.35);
  blip(CUE.hover, F("E6"), 0.05, 0.6);
  blip(CUE.select, F("A6"), 0.07); blip(CUE.select + 0.07, F("D7"), 0.16);
  // START: a chunky button clunk, the starter, then the engine idling.
  kick(CUE.start, 0.5);
  {
    const starter = ctx.createOscillator(); starter.type = "sawtooth";
    starter.frequency.setValueAtTime(40, CUE.start + 0.05);
    for (let k = 0; k < 5; k++) starter.frequency.linearRampToValueAtTime(k % 2 ? 36 : 58, CUE.start + 0.1 + k * 0.08);
    const sf = ctx.createBiquadFilter(); sf.type = "lowpass"; sf.frequency.value = 700;
    starter.connect(sf).connect(env(CUE.start + 0.05, 0.25, 0.01, 0.45, bus, "lin"));
    starter.start(CUE.start); starter.stop(CUE.start + 0.6);
  }
  // Engine: two detuned saws through a growling low-pass, with a throb.
  {
    const e0 = CUE.start + 0.5;
    const eng = ctx.createGain();
    eng.gain.setValueAtTime(0.0001, e0);
    eng.gain.linearRampToValueAtTime(0.22, e0 + 0.15);
    eng.gain.setValueAtTime(0.22, CUE.go);
    eng.gain.linearRampToValueAtTime(0.3, CUE.go + 0.4);
    eng.gain.linearRampToValueAtTime(0.0001, CUE.fly);
    const ef = ctx.createBiquadFilter(); ef.type = "lowpass"; ef.Q.value = 5;
    ef.frequency.setValueAtTime(420, e0);
    // Revs during the countdown, then a climb through the gears at GO.
    for (const t of [CUE.lights, CUE.lights + 1, CUE.lights + 2]) {
      ef.frequency.setValueAtTime(420, t);
      ef.frequency.linearRampToValueAtTime(1500, t + 0.15);
      ef.frequency.linearRampToValueAtTime(420, t + 0.6);
    }
    ef.frequency.setValueAtTime(600, CUE.go);
    ef.frequency.linearRampToValueAtTime(2600, CUE.go + 1.2);
    const throb = ctx.createOscillator(); throb.frequency.value = 11;
    const tg = ctx.createGain(); tg.gain.value = 0.08;
    throb.connect(tg).connect(eng.gain);
    throb.start(e0); throb.stop(CUE.fly);
    for (const det of [-10, 10]) {
      const o = ctx.createOscillator(); o.type = "sawtooth"; o.detune.value = det;
      o.frequency.setValueAtTime(46, e0);
      for (const t of [CUE.lights, CUE.lights + 1, CUE.lights + 2]) {
        o.frequency.setValueAtTime(46, t);
        o.frequency.linearRampToValueAtTime(92, t + 0.15);
        o.frequency.linearRampToValueAtTime(46, t + 0.6);
      }
      o.frequency.setValueAtTime(60, CUE.go);
      o.frequency.exponentialRampToValueAtTime(150, CUE.go + 1.1);
      o.frequency.exponentialRampToValueAtTime(110, CUE.go + 1.3);
      o.frequency.exponentialRampToValueAtTime(190, CUE.fly - 0.2);
      o.connect(ef);
      o.start(e0); o.stop(CUE.fly + 0.1);
    }
    ef.connect(eng).connect(bus);
  }

  /* ---------- countdown and GO ---------- */
  for (let k = 0; k < 3; k++) beep(CUE.lights + k, 440, 0.32);
  riser(CUE.lights, CUE.go, 0.9);
  for (let t = CUE.go - 1; t < CUE.go; t += BEAT / (t < CUE.go - 0.5 ? 4 : 8)) snare(t, 0.3 + (t - (CUE.go - 1)) * 0.6);
  beep(CUE.go, 880, 0.6);
  impact(CUE.go, 1);
  stab(CUE.go, ["D3", "A3", "D4"], 1);
  whoosh(CUE.go + 0.7, 0.9);
  // The groove, GO to the logo.
  const ARP = [0, 1, 2, 3, 2, 1, 2, 3];
  for (let t = CUE.go; t < CUE.logo - 1e-6; t += BEAT / 4) {
    const step = Math.round((t - CUE.go) / (BEAT / 4));
    const sub = step % 4, beat = Math.floor(step / 4);
    const [root, notes] = chordAt(t);
    if (sub === 0) kick(t);
    if (sub === 0 && beat % 2 === 1) snare(t);
    hat(t, sub === 2, sub === 2 ? 1 : 0.6);
    if (sub % 2 === 0) bass(t, F(root) * (sub === 2 ? 2 : 1), BEAT / 2 * 0.9);
    arp(t, F(notes[ARP[step % 8]]) * 2, 0.8);
  }
  for (let b = CUE.go; b < CUE.logo; b += BEAT * 4) padF(b, chordAt(b + 0.01)[1], BEAT * 4, 1);

  // Off the ramp: whoosh, then everything goes muffled for the slow motion.
  whoosh(CUE.slowFrom - 0.4, 1.1);
  lp.frequency.setValueAtTime(20000, CUE.slowFrom);
  lp.frequency.exponentialRampToValueAtTime(650, CUE.slowFrom + 0.3);
  lp.frequency.setValueAtTime(650, CUE.slowTo - 0.4);
  lp.frequency.exponentialRampToValueAtTime(20000, CUE.slowTo);
  riser(CUE.slowTo - 1.2, CUE.logo, 1.1);

  /* ---------- the logo ---------- */
  impact(CUE.logo, 1.2);
  stab(CUE.logo, ["D3", "F3", "A3", "E4"], 1.2);
  padF(CUE.logo, ["D3", "F#3", "A3", "C#4", "E4"], duration - CUE.logo, 1.3);
  bass(CUE.logo, F("D1"), 2.8);
  for (let t = CUE.logo; t < CUE.logo + 2.4; t += BEAT / 2) {
    const i = Math.round((t - CUE.logo) * 2 / BEAT);
    arp(t, F(["D5", "A5", "F#5", "E5", "D5", "C#5"][i % 6]), 0.55 * (1 - (t - CUE.logo) / 2.8));
  }
  master.gain.setValueAtTime(0.9, duration - 1.6);
  master.gain.linearRampToValueAtTime(0, duration);

  return finish(await ctx.startRendering());
}
