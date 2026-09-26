import { RaceAudio } from "../kart/sound";

/**
 * Dev only: render the race audio offline through a scripted moment (grid
 * revs, launch, gear shifts, a lift-off, a drift, a boost, the glider, a
 * Custodian passing) and save it as trailer/race-sound-demo.wav.
 */
export async function soundDemo() {
  const SR = 48000, DUR = 16;
  const ctx = new OfflineAudioContext(2, SR * DUR, SR);
  const a = new RaceAudio();
  a.start(ctx);
  a.setMusic(0.7);
  const dt = 1 / 30;
  let speed = 0, boost = 0, gas = false, drift = 0, air = false;
  const events: [number, () => void][] = [
    [1.0, () => a.beep(false)], [2.0, () => a.beep(false)], [3.0, () => a.beep(false)], [4.0, () => { a.beep(true); a.boost(); boost = 1; }],
    [5.2, () => a.coin(0)], [5.35, () => a.coin(1)], [5.5, () => a.coin(2)],
    [7.2, () => a.roll()], [7.3, () => a.roll()], [7.4, () => a.roll()], [7.6, () => a.get()],
    [9.0, () => a.drift(1)], [9.8, () => a.drift(2)], [10.5, () => a.drift(3)], [11.2, () => { a.boost(); boost = 1; }],
    [12.4, () => { air = true; }], [12.62, () => a.glide()], [14.0, () => { air = false; a.land(); }],
    [14.6, () => a.pass()], [15.2, () => a.bonk()],
  ];
  for (let t = 0; t < DUR - 0.05; t += dt) {
    const at = t;
    ctx.suspend(at).then(() => {
      for (const [et, fn] of events) if (et >= at && et < at + dt) fn();
      // Grid revs, then flat out, a lift at 8.2 s, a drift 9–11 s.
      gas = at < 4 ? (at > 1.5 && Math.sin(at * 6) > 0) : !(at > 8.2 && at < 8.7);
      if (at >= 4) speed = Math.min(boost > 0 ? 32 : 24, speed + (gas ? 7 : -9) * dt);
      boost = Math.max(0, boost - dt * 0.9);
      drift = at > 9 && at < 11.2 ? Math.min(3, Math.floor((at - 9) / 0.7) + 1) : 0;
      const rivalGap = 14.2 - at;   // a Custodian comes past around 14 s
      a.drive({ speed, boost, running: at >= 4, gas, offroad: at > 6.2 && at < 6.9, air,
        rival: Math.abs(rivalGap) < 25 ? { gap: rivalGap * 8, side: 3, speed: speed + 6 } : null });
      a.squealing(drift > 0, drift);
      a.pump();
      void ctx.resume();
    });
  }
  const buf = await ctx.startRendering();
  // Levels, for the log.
  let peak = 0, sum = 0;
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  for (let i = 0; i < L.length; i++) { peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i])); sum += L[i] * L[i]; }
  const rmsDb = 10 * Math.log10(sum / L.length + 1e-12);
  // 16-bit WAV.
  const n = L.length, bytes = 44 + n * 4;
  const out = new DataView(new ArrayBuffer(bytes));
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); out.setUint32(4, bytes - 8, true); str(8, "WAVE"); str(12, "fmt ");
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 2, true); out.setUint32(24, SR, true);
  out.setUint32(28, SR * 4, true); out.setUint16(32, 4, true); out.setUint16(34, 16, true); str(36, "data"); out.setUint32(40, n * 4, true);
  const g = peak > 0.98 ? 0.98 / peak : 1;
  for (let i = 0; i < n; i++) {
    out.setInt16(44 + i * 4, Math.max(-1, Math.min(1, L[i] * g)) * 32767, true);
    out.setInt16(46 + i * 4, Math.max(-1, Math.min(1, R[i] * g)) * 32767, true);
  }
  await fetch("/__save?name=race-sound-demo.wav", { method: "POST", body: out.buffer });
  // Per-second loudness.
  const secs: string[] = [];
  for (let s = 0; s < DUR; s++) {
    let e = 0;
    for (let i = s * SR; i < (s + 1) * SR; i++) e += L[i] * L[i];
    secs.push(`${s}:${(10 * Math.log10(e / SR + 1e-12)).toFixed(0)}`);
  }
  return { peak: peak.toFixed(2), rmsDb: rmsDb.toFixed(1), secs: secs.join(" "), nan: L.some(Number.isNaN) };
}
