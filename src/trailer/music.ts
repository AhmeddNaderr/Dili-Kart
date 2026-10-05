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

import { N, SR, createKit, master as finish } from "./synth";

export const BPM = 120;
const BEAT = 60 / BPM;

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
  const { lp, master, kick, snare, hat, bass, arp, pad, riser, impact, whoosh, beep, stab } = createKit(ctx, BEAT);

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

  return finish(await ctx.startRendering());
}
