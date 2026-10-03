import * as THREE from "three";
import { DiliCart } from "../kart/race";
import { newFrame } from "../kart/track";
import { LOGO, portrait } from "../ui/icons";
import { MASCOT } from "../kart/mascot";
import { COL, Gfx, H, W, clamp01, inOutCubic, lerp, loadImage } from "./gfx";
import { N, SR, createKit, master as finish } from "./synth";

/**
 * Dili Kart 2.0 teaser (dev only: open /teaser.html on the dev server).
 *
 * Five and a half seconds of the real game on the Dlicom Skyway: the leap
 * over the clouds, a pack of karts, an Infinite obstacle wave, and the end
 * card. A test driver steps it frame by frame through `window.__teaser`
 * (each frame as a JPEG, plus the soundtrack as a WAV) and ffmpeg muxes the
 * MP4, so it plays everywhere (H.264 + AAC).
 */

const FPS = 60;
const DUR = 5.8;
const BPM = 128;
const BEAT = 60 / BPM;
const status = document.getElementById("status")!;
const log = (s: string) => { status.textContent = s; console.log("[teaser]", s); };

// Same take every time.
{
  let a = 11 >>> 0;
  Math.random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rig = ReturnType<DiliCart["rig"]>;
const V = () => new THREE.Vector3();
const f = newFrame();
const v1 = V(), v2 = V();
const UP = new THREE.Vector3(0, 1, 0);
let game: DiliCart;
let rig: Rig;
const smooth = { pos: V(), look: V(), ready: false };

const kPos = (k: number) => rig.karts[k].root.position;
const meDist = () => rig.karts[0].dist;
const frameOf = (k: number) => rig.track.frame(rig.track.wrap(rig.track.startU + rig.karts[k].dist), f);

function place(c: THREE.PerspectiveCamera, pos: THREE.Vector3, look: THREE.Vector3, ease = 0, dt = 1 / FPS) {
  if (!smooth.ready || ease <= 0) { smooth.pos.copy(pos); smooth.look.copy(look); smooth.ready = true; }
  else {
    smooth.pos.lerp(pos, 1 - Math.exp(-dt * ease));
    smooth.look.lerp(look, 1 - Math.exp(-dt * ease * 1.4));
  }
  c.position.copy(smooth.pos);
  c.up.set(0, 1, 0);
  c.lookAt(smooth.look);
}

function fastForward(until: () => boolean, maxSec = 90) {
  for (let i = 0; i < maxSec * FPS && !until(); i++) game.advance(1 / FPS, false);
}

interface Shot {
  from: number; to: number; name: string;
  enter?(): void;
  cam(c: THREE.PerspectiveCamera, lt: number, dt: number): number;
  speed?(lt: number): number;
  over?(g: Gfx, lt: number): void;
  dim?(lt: number): number;
}

const SHOTS: Shot[] = [
  {
    // The leap over the clouds, in slow motion once the karts are airborne.
    from: 0, to: 1.7, name: "leap",
    enter() {
      fastForward(() => meDist() >= 686);
      const d = meDist();
      game.placeKart(0, { lat: 0.5, speed: 30, boost: 1.2 });
      game.placeKart(1, { dist: d - 5, lat: -5, speed: 29 });
      game.placeKart(2, { dist: d - 9, lat: 5.5, speed: 29 });
    },
    cam(c, _lt, dt) {
      frameOf(0);
      const P = kPos(0);
      const pos = v1.copy(P).addScaledVector(f.tan, 5).addScaledVector(f.side, -10).add(v2.set(0, 0.6, 0));
      const look = v2.copy(P).addScaledVector(f.tan, -2).add(new THREE.Vector3(0, 0.8, 0));
      place(c, pos, look, smooth.ready ? 7 : 0, dt);
      return 60;
    },
    speed: () => (rig.karts[0].air ? 0.45 : 1),
    over(g, lt) {
      const w = g.kinetic("DILI KART", 130, 930, 190, lt - 0.15, { stagger: 0.025, out: 1.35 }) ?? 0;
      g.bubble("2.0", 130 + w + 30, 850, 84, lt - 0.45, { bg: COL.gold, out: 1.4 });
    },
  },
  {
    // A pack of karts coming at the camera, boosting.
    from: 1.7, to: 2.9, name: "pack",
    enter() {
      fastForward(() => meDist() >= 905);
      const d = meDist();
      game.placeKart(0, { lat: 0, speed: 30, boost: 1.4 });
      game.placeKart(1, { dist: d + 3.5, lat: -3.8, speed: 30, boost: 1 });
      game.placeKart(2, { dist: d + 6.5, lat: 3.6, speed: 30 });
      game.placeKart(3, { dist: d - 3, lat: -6.5, speed: 30, boost: 1 });
      game.placeKart(4, { dist: d - 5, lat: 6, speed: 30 });
      smooth.ready = false;
    },
    cam(c, lt) {
      frameOf(0);
      const P = kPos(0);
      const k = inOutCubic(lt / 1.2);
      const pos = v1.copy(P).addScaledVector(f.tan, 15 - k * 3).addScaledVector(f.side, 2.5 - k * 3).add(v2.set(0, 1.1 + k * 0.6, 0));
      const look = v2.copy(P).addScaledVector(f.tan, 1).add(new THREE.Vector3(0, 0.9, 0));
      place(c, pos, look);
      return 50;
    },
    over(g, lt) {
      g.bubble("ONLINE · ROOM CODES", 130, 770, 42, lt - 0.05, { bg: COL.blue, fg: "#fff", out: 1.0 });
      g.kinetic("RACE YOUR FRIENDS", 130, 940, 140, lt - 0.12, { stagger: 0.018, out: 0.95 });
    },
  },
  {
    // Into an Infinite wave: an obstacle dead ahead.
    from: 2.9, to: 3.9, name: "infinite",
    enter() {
      fastForward(() => rig.hazards().some((h) => h.dist !== undefined && h.kind !== "cone" && h.dist - meDist() > 40 && h.dist - meDist() < 52), 60);
      game.placeKart(0, { speed: 30, boost: 0.8 });
      // Clear the shot: the other karts drop well back.
      for (let k = 1; k < rig.karts.length; k++) game.placeKart(k, { dist: meDist() - 70 - k * 8, speed: 20 });
      smooth.ready = false;
    },
    cam(c, lt, dt) {
      frameOf(0);
      const P = kPos(0);
      const pos = v1.copy(P).addScaledVector(f.tan, -6.5 + lt * 1.5).add(v2.copy(UP).multiplyScalar(2.6));
      const look = v2.copy(P).addScaledVector(f.tan, 22).add(new THREE.Vector3(0, 0.6, 0));
      place(c, pos, look, smooth.ready ? 10 : 0, dt);
      return 62;
    },
    over(g, lt) {
      g.hearts(4, 175, 640, 84, lt - 0.05, 0.85);
      g.kinetic("SURVIVE", 130, 840, 140, lt - 0.1, { stagger: 0.02, out: 0.8 });
      g.kinetic("INFINITE", 130, 990, 150, lt - 0.2, { fill: "gold", stagger: 0.02, out: 0.82 });
    },
  },
  {
    // The end card over the cloud sea.
    from: 3.9, to: DUR, name: "end",
    enter() { smooth.ready = false; },
    cam(c, lt) {
      frameOf(0);
      const P = kPos(0);
      const k = inOutCubic(lt / 1.5);
      const pos = v1.copy(P).addScaledVector(f.tan, -10 - k * 6).add(v2.set(0, 4 + k * 10, 0));
      const look = v2.copy(P).addScaledVector(f.tan, 45).add(new THREE.Vector3(0, 6 + k * 10, 0));
      place(c, pos, look);
      return 58;
    },
    dim: (lt) => lerp(0.35, 0.6, clamp01(lt / 0.5)),
    over(g, lt) {
      g.endCard(lt * 1.5, {
        first: "DILI KART ", second: "2.0", size: 220,
        tag: "RACE FRIENDS · SURVIVE INFINITE", credit: "Built for the Dlicom community",
      });
    },
  },
];

const CUTS: [number, number][] = [[1.7, 0.7], [2.9, 0.6], [3.9, 1]];

function treatment(t: number) {
  let zoom = 1, sx = 0, sy = 0, flash = 0;
  for (const [at, k] of CUTS) {
    const d = t - at;
    if (d >= 0 && d < 0.4) flash = Math.max(flash, k * (1 - d / 0.4) ** 2);
    if (d >= 0 && d < 0.45) {
      const s = k * 14 * (1 - d / 0.45);
      sx += Math.sin(d * 90) * s;
      sy += Math.cos(d * 77) * s;
      zoom += 0.035 * k * Math.exp(-d * 9);
    }
  }
  // Pump on the beat through the action.
  if (t < 3.9) zoom += 0.012 * Math.exp(-((t / BEAT) % 1) * 7);
  return { zoom, sx, sy, flash };
}

/** The soundtrack: a punchy 128 BPM synthwave hit, cut to the edit. */
async function soundtrack(): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, Math.ceil(SR * DUR), SR);
  const { lp, master, kick, snare, hat, bass, arp, pad, riser, impact, whoosh, stab } = createKit(ctx, BEAT);
  const PROG: [string, string[]][] = [["A2", ["A3", "C4", "E4"]], ["F2", ["F3", "A3", "C4"]], ["C3", ["C4", "E4", "G4"]], ["G2", ["G3", "B3", "D4"]]];
  const chordAt = (t: number) => PROG[Math.floor(t / (BEAT * 4)) % 4];
  const ARP = [0, 1, 2, 1, 0, 2, 1, 2];
  for (let t = 0; t < 3.9 - 1e-6; t += BEAT / 4) {
    const step = Math.round(t / (BEAT / 4));
    const beat = Math.floor(step / 4), sub = step % 4;
    const [root, notes] = chordAt(t);
    if (sub === 0) kick(t);
    if (sub === 0 && beat % 2 === 1) snare(t);
    hat(t, sub === 2, sub === 2 ? 1 : 0.7);
    if (sub % 2 === 0) bass(t, N(root) * (sub === 2 ? 2 : 1), BEAT / 2 * 0.9);
    arp(t, N(notes[ARP[step % 8]]) * 2, 0.9);
  }
  for (let b = 0; b < 3.9; b += BEAT * 4) pad(b, chordAt(b)[1], BEAT * 4, 0.9);
  impact(0, 0.9);
  stab(0, PROG[0][1], 0.9);
  whoosh(0.3, 1.0);
  // The slow-motion leap: the mix goes muffled, then snaps back on the cut.
  lp.frequency.setValueAtTime(20000, 0.75);
  lp.frequency.exponentialRampToValueAtTime(800, 0.95);
  lp.frequency.setValueAtTime(800, 1.5);
  lp.frequency.exponentialRampToValueAtTime(20000, 1.7);
  impact(1.7, 0.7);
  impact(2.9, 0.6);
  riser(3.0, 3.9, 1.1);
  for (let t = 3.4; t < 3.9; t += BEAT / 4) snare(t, 0.3 + (t - 3.4) * 1.2);
  // Logo slam and the last chord ringing out.
  impact(3.9, 1.2);
  stab(3.9, ["A3", "C4", "E4", "B4"], 1.2);
  pad(3.9, ["A3", "C4", "E4", "B4"], 1.9, 1.2);
  bass(3.9, N("A1"), 1.5);
  for (let t = 3.9; t < 5.5; t += BEAT / 2) arp(t, N(["A4", "E5", "C5", "B4"][Math.round((t - 3.9) / (BEAT / 2)) % 4]), 0.5 * (1 - (t - 3.9) / 1.6));
  master.gain.setValueAtTime(0.9, DUR - 0.7);
  master.gain.linearRampToValueAtTime(0, DUR);
  return finish(await ctx.startRendering());
}

function wav(buf: AudioBuffer): string {
  const L = buf.getChannelData(0), R = buf.getChannelData(1), n = L.length;
  const out = new DataView(new ArrayBuffer(44 + n * 4));
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); out.setUint32(4, 36 + n * 4, true); str(8, "WAVE"); str(12, "fmt ");
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 2, true); out.setUint32(24, SR, true);
  out.setUint32(28, SR * 4, true); out.setUint16(32, 4, true); out.setUint16(34, 16, true); str(36, "data"); out.setUint32(40, n * 4, true);
  for (let i = 0; i < n; i++) {
    out.setInt16(44 + i * 4, Math.max(-1, Math.min(1, L[i])) * 32767, true);
    out.setInt16(46 + i * 4, Math.max(-1, Math.min(1, R[i])) * 32767, true);
  }
  const bytes = new Uint8Array(out.buffer);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function main() {
  log("Loading…");
  await Promise.all(["italic 900 100px Inter", "900 100px Inter", "800 100px Inter", "700 100px Inter"].map((x) => document.fonts.load(x)));
  const logo = await loadImage(LOGO.replace(/currentColor/g, "#ffffff"), 400);
  const faces = await Promise.all((["dili", "dcoded", "dco"] as const).map((c) => loadImage(portrait(MASCOT[c].head, MASCOT[c].dome, MASCOT[c].mouth), 400)));
  const stage = document.getElementById("stage")!;
  game = new DiliCart();
  await new Promise<void>((resolve) => game.mount(stage, { onEnd() {}, onRestart() {}, onQuit() {}, onReady: resolve }, "dili", { trailer: true, endless: true }));
  rig = game.rig();
  // Lights out, then on to the shots.
  game.go();
  fastForward(() => rig.phase() === "race", 6);

  const out = document.getElementById("out") as HTMLCanvasElement;
  out.width = W; out.height = H;
  const gfx = new Gfx(out, logo, faces);
  let shot = SHOTS[0], shotIdx = -1, curT = 0;
  game.director = (c, dt) => shot.cam(c, curT - shot.from, dt);
  const frames = Math.round(DUR * FPS);

  (window as unknown as { __teaser: unknown }).__teaser = {
    frames,
    async frame(i: number) {
      curT = i / FPS;
      const idx = SHOTS.findIndex((s) => curT >= s.from && curT < s.to);
      if (idx !== shotIdx && idx >= 0) { shotIdx = idx; shot = SHOTS[idx]; smooth.ready = false; shot.enter?.(); }
      const lt = curT - shot.from;
      game.advance((shot.speed?.(lt) ?? 1) / FPS, true);
      const fx = treatment(curT);
      gfx.footage(rig.canvas, fx.zoom, fx.sx, fx.sy, shot.dim?.(lt) ?? 0);
      shot.over?.(gfx, lt);
      gfx.flash(fx.flash);
      gfx.finish(i, 0.04);
      gfx.black(curT < 0.12 ? 1 - curT / 0.12 : curT > DUR - 0.35 ? (curT - (DUR - 0.35)) / 0.35 : 0);
      if (i % 30 === 0) log(`frame ${i}/${frames} · ${shot.name}`);
      return out.toDataURL("image/jpeg", 0.95);
    },
    async audio() { return wav(await soundtrack()); },
  };
  log("Ready");
}

main().catch((e) => log("FAILED: " + (e instanceof Error ? e.stack ?? e.message : String(e))));
