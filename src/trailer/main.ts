import * as THREE from "three";
import { ArrayBufferTarget, Muxer } from "mp4-muxer";
import { DiliCart } from "../kart/race";
import { newFrame } from "../kart/track";
import { LOGO, portrait } from "../ui/icons";
import { MASCOT } from "../kart/mascot";
import { COL, Gfx, H, W, clamp01, inOutCubic, lerp, loadImage } from "./gfx";
import { BPM, renderSoundtrack } from "./music";

/**
 * DILI CART trailer (dev only: open /trailer.html on the dev server).
 *
 * The real game runs frame by frame at 60 fps with scripted cameras; motion
 * graphics are drawn over each frame; the soundtrack is synthesised offline;
 * WebCodecs encodes H.264 + AAC into an MP4 saved to trailer/.
 *
 *   ?stills=2.5,9,15   render only those moments as JPEGs (fast preview)
 *   (no params)        render and encode the whole trailer
 */

const FPS = 60;
const DUR = 26;
const BEAT = 60 / BPM;
const params = new URLSearchParams(location.search);
const stills = params.get("stills")?.split(",").map(Number).filter((n) => !isNaN(n)) ?? null;
const status = document.getElementById("status")!;
const log = (s: string) => { status.textContent = s; console.log("[trailer]", s); };

// Same take every time: seed the randomness the race and effects use.
{
  let a = Number(params.get("seed") ?? 7) >>> 0;
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
const v1 = V(), v2 = V(), v3 = V();

/* ------------------------------------------------------------------ */
/* Shots                                                               */
/* ------------------------------------------------------------------ */

interface Shot {
  from: number;
  to: number;
  name: string;
  /** Before the first frame: fast-forward the race, trigger events. */
  enter?(): void;
  /** Place the camera; `lt` is time into the shot. Returns the fov. */
  cam(c: THREE.PerspectiveCamera, lt: number, dt: number): number;
  /** Simulation speed (1 = real time), for slow motion. */
  speed?(lt: number): number;
  /** Titles over the footage. */
  over?(g: Gfx, lt: number, t: number): void;
  dim?(lt: number): number;
}

let game: DiliCart;
let rig: Rig;
const smooth = { pos: V(), look: V(), ready: false };

const kart = (k: number) => rig.karts[k];
const kPos = (k: number) => kart(k).root.position;
const kFwd = (k: number, out = V()) => kart(k).root.getWorldDirection(out).setY(0).normalize();
const kRight = (k: number, out = V()) => out.crossVectors(kFwd(k, v3), new THREE.Vector3(0, 1, 0)).normalize();
const frameAt = (u: number) => rig.track.frame(rig.track.wrap(u), f);
const uOf = (k: number) => rig.track.wrap(rig.track.startU + kart(k).dist);

function place(c: THREE.PerspectiveCamera, pos: THREE.Vector3, look: THREE.Vector3, ease = 0, dt = 1 / 60) {
  if (!smooth.ready || ease <= 0) { smooth.pos.copy(pos); smooth.look.copy(look); smooth.ready = true; }
  else {
    smooth.pos.lerp(pos, 1 - Math.exp(-dt * ease));
    smooth.look.lerp(look, 1 - Math.exp(-dt * ease * 1.4));
  }
  c.position.copy(smooth.pos);
  c.up.set(0, 1, 0);
  c.lookAt(smooth.look);
}

/** Run the race forward without drawing until `until()` says stop. */
function fastForward(until: () => boolean, maxSec = 30) {
  for (let i = 0; i < maxSec * FPS && !until(); i++) game.advance(1 / FPS, false);
}

/** The Custodian nearest ahead of (dir > 0) or behind (dir < 0) Dili. */
function rivalNear(dir: 1 | -1) {
  let best = 1, gap = Infinity;
  for (let k = 1; k < rig.karts.length; k++) {
    const d = (kart(k).dist - kart(0).dist) * dir;
    if (d > 2 && d < gap) { gap = d; best = k; }
  }
  return best;
}

const SHOTS: Shot[] = [
  {
    from: 0, to: 2, name: "open",
    cam(c, lt) {
      const ctr = rig.world.center;
      const a = 2.2 + lt * 0.07;
      place(c, v1.set(ctr.x + Math.cos(a) * 330, 130 - lt * 12, ctr.z + Math.sin(a) * 330), v2.copy(ctr).setY(15));
      return 48;
    },
    dim: (lt) => lerp(0.8, 0.45, clamp01(lt / 1.6)),
    over(g, lt) {
      g.letterbox(1);
      g.logoReveal(lt - 0.1);
    },
  },
  {
    from: 2, to: 4, name: "grid",
    cam(c, lt) {
      // Down the grid from the front row to Dili at the back.
      const k = inOutCubic(lt / 2);
      const u = rig.track.startU + lerp(-1, -30, k);
      frameAt(u);
      const pos = v1.copy(f.pos).addScaledVector(f.side, -7.2).addScaledVector(f.up, 1.25);
      frameAt(u - 6);
      const look = v2.copy(f.pos).addScaledVector(f.side, 1.8).addScaledVector(f.up, 1.0);
      place(c, pos, look);
      return 44;
    },
    over(g, lt, t) {
      g.letterbox(1 - clamp01((lt - 1.5) / 0.5));
      g.bubble("THE DLICOM", 150, 690, 44, lt - 0.05, { out: 1.65 });
      g.kinetic("GRAND PRIX", 140, 860, 190, lt - 0.2, { fill: "gold", out: 1.6 });
      g.ticker(t, 1000, clamp01(lt / 0.3) * (1 - clamp01((lt - 1.7) / 0.3)));
    },
  },
  {
    from: 4, to: 5, name: "stadium",
    cam(c, lt) {
      frameAt(rig.track.startU);
      const pos = v1.copy(f.pos).addScaledVector(f.tan, 45 - lt * 30).addScaledVector(f.side, -26).add(v3.set(0, 34 - lt * 14, 0));
      const look = v2.copy(f.pos).addScaledVector(f.tan, -16).add(v3.set(0, 2, 0));
      place(c, pos, look);
      return 55;
    },
    over(g, lt) {
      g.stamp("8", "RACERS", 520, 560, lt, 0.8);
      g.stamp("3", "LAPS", 960, 560, lt - BEAT * 0.5, 0.8);
      g.stamp("1", "CROWN", 1400, 560, lt - BEAT, 0.8);
    },
  },
  {
    from: 5, to: 6, name: "lamps",
    enter() { game.go(); },
    cam(c, lt) {
      const lamps = rig.world.gateLamps;
      const mid = v2.set(0, 0, 0);
      for (const l of lamps) mid.add(l.getWorldPosition(v3));
      mid.multiplyScalar(1 / lamps.length);
      frameAt(rig.track.startU);
      const pos = v1.copy(mid).addScaledVector(f.tan, -7 + lt * 1.5).add(v3.set(0, -1.6, 0)).addScaledVector(f.side, 2.5);
      place(c, pos, mid);
      return 34;
    },
    over(g, lt) { g.countdown("3", lt, "#ff3d5a"); },
  },
  {
    from: 6, to: 7, name: "dili",
    cam(c, lt) {
      const P = kPos(0), F = kFwd(0, v3.clone());
      const R = kRight(0);
      const pos = v1.copy(P).addScaledVector(F, 3.3 - lt * 0.5).addScaledVector(R, -1.7).add(new THREE.Vector3(0, 1.75, 0));
      place(c, pos, v2.copy(P).add(new THREE.Vector3(0, 1.2, 0)));
      return 38;
    },
    over(g, lt) {
      g.countdown("2", lt, COL.gold);
      g.bubble("DILI BOY", 140, 180, 40, lt - 0.1, { bg: COL.blue, fg: "#fff" });
    },
  },
  {
    from: 7, to: 8, name: "rival",
    cam(c, lt) {
      const P = kPos(7), F = kFwd(7, v3.clone());
      const R = kRight(7);
      const pos = v1.copy(P).addScaledVector(F, 2.5 - lt * 0.4).addScaledVector(R, 2.5).add(new THREE.Vector3(0, 1.55, 0));
      place(c, pos, v2.copy(P).add(new THREE.Vector3(0, 1.1, 0)));
      return 38;
    },
    over(g, lt) {
      g.countdown("1", lt, COL.pink);
      g.bubble("THE CUSTODIANS", 1340, 180, 40, lt - 0.1, { bg: COL.pink, fg: "#fff" });
    },
  },
  {
    from: 8, to: 10, name: "launch",
    cam(c, lt, dt) {
      const P = kPos(0), F = kFwd(0, v3.clone());
      const pos = v1.copy(P).addScaledVector(F, -6.8).add(new THREE.Vector3(0, 1.7, 0));
      const look = v2.copy(P).addScaledVector(F, 6).add(new THREE.Vector3(0, 1.0, 0));
      place(c, pos, look, lt < 0.02 ? 0 : 7, dt);
      return 66 + Math.min(12, kart(0).speed * 0.35);
    },
    over(g, lt, t) {
      g.speedLines(t, clamp01(lt / 0.4));
      g.countdown("GO!", lt, "#1bff4f");
      g.kinetic("RACE.", 120, 980, 170, lt - 1.05, { out: 1.8 });
    },
  },
  {
    from: 10, to: 12, name: "coins",
    cam(c, lt, dt) {
      const P = kPos(0), F = kFwd(0, v3.clone());
      const R = kRight(0);
      const pos = v1.copy(P).addScaledVector(F, 7.5).addScaledVector(R, -2.4).add(new THREE.Vector3(0, 1.3, 0));
      place(c, pos, v2.copy(P).add(new THREE.Vector3(0, 1.0, 0)), lt < 0.02 ? 0 : 10, dt);
      return 50;
    },
    over(g, lt, t) {
      g.speedLines(t, 0.5);
      g.kinetic("STACK", 120, 820, 150, lt - 0.15, { out: 1.75 });
      g.kinetic("COINS.", 120, 970, 150, lt - 0.35, { fill: "gold", out: 1.75 });
    },
  },
  {
    from: 12, to: 14, name: "items",
    enter() { fastForward(() => kart(0).dist >= 100); },
    cam(c, lt, dt) {
      frameAt(rig.track.startU + 134);
      const pos = v1.copy(f.pos).addScaledVector(f.side, -9.5).add(new THREE.Vector3(0, 2.4, 0));
      place(c, pos, v2.copy(kPos(0)).add(new THREE.Vector3(0, 1.1, 0)), lt < 0.02 ? 0 : 6, dt);
      return 44;
    },
    over(g, lt) {
      g.kinetic("GRAB", 1150, 820, 150, lt - 0.15, { out: 1.75 });
      g.kinetic("ITEMS.", 1150, 970, 150, lt - 0.35, { fill: "gold", out: 1.75 });
      g.bubble("?", 1640, 700, 70, lt - 0.55, { bg: COL.blue, fg: "#fff", out: 1.7 });
    },
  },
  {
    from: 14, to: 16, name: "drift",
    enter() { fastForward(() => kart(0).dist >= 168 && rig.drift().dir !== 0); },
    cam(c, lt, dt) {
      const P = kPos(0), F = kFwd(0, v3.clone());
      const R = kRight(0);
      const d = rig.drift().dir || 1;
      const pos = v1.copy(P).addScaledVector(F, -4.2).addScaledVector(R, -d * 3.0).add(new THREE.Vector3(0, 2.9, 0));
      place(c, pos, v2.copy(P).addScaledVector(F, 2.2).add(new THREE.Vector3(0, 0.6, 0)), lt < 0.02 ? 0 : 8, dt);
      return 54;
    },
    over(g, lt) {
      g.kinetic("DRIFT.", 120, 980, 210, lt - 0.1, { out: 1.75 });
      const tier = rig.drift().tier;
      if (tier >= 1) g.chip(tier === 3 ? "ULTRA TURBO!" : tier === 2 ? "SUPER TURBO!" : "MINI TURBO!", 1500, 200, 1,
        tier === 3 ? "#9b3fff" : tier === 2 ? "#ff8a1f" : COL.blue);
    },
  },
  {
    from: 16, to: 17, name: "drone",
    enter() { fastForward(() => kart(0).dist >= 286); },
    cam(c, lt) {
      const drone = rig.hazards().filter((h) => h.kind === "drone").sort((a, b) =>
        Math.abs(rig.track.delta(uOf(0), a.u)) - Math.abs(rig.track.delta(uOf(0), b.u)))[0];
      const D = drone.obj.position;
      frameAt(drone.u);
      const pos = v1.copy(D).addScaledVector(f.tan, -5.2 + lt * 0.8).addScaledVector(f.side, 1.4).add(new THREE.Vector3(0, -0.5, 0));
      place(c, pos, v2.copy(D).add(new THREE.Vector3(0, -0.25, 0)));
      return 44;
    },
    over(g, lt) {
      g.kinetic("DODGE.", 120, 980, 190, lt - 0.05, { out: 0.8 });
    },
  },
  {
    from: 17, to: 19, name: "jump",
    enter() { fastForward(() => kart(0).dist >= 352); smooth.ready = false; },
    speed: (lt) => (lt > 0.45 && lt < 1.65 ? 0.3 : 1),
    cam(c, _lt, dt) {
      const lip = rig.track.lipU;
      frameAt(lip + 12);
      const pos = v1.copy(f.pos).addScaledVector(f.side, 15).add(new THREE.Vector3(0, 3.2, 0));
      place(c, pos, v2.copy(kPos(0)).add(new THREE.Vector3(0, 1, 0)), 7, dt);
      return 42;
    },
    over(g, lt) {
      g.kinetic("FLY.", 1260, 980, 230, lt - 0.45, { out: 1.8 });
    },
  },
  {
    from: 19, to: 19.5, name: "goo",
    enter() { gooFrom = rivalNear(1); game.custodianGoo(gooFrom); },
    cam(c, lt) {
      const goo = rig.hazards().filter((h) => h.kind === "goo").pop();
      if (!goo) return 50;
      const G = goo.obj.position;
      frameAt(goo.u);
      const pos = v1.copy(G).addScaledVector(f.tan, 3.8 + lt).addScaledVector(f.side, 1.2).add(new THREE.Vector3(0, 1.3, 0));
      place(c, pos, v2.copy(G).addScaledVector(f.tan, -2));
      return 50;
    },
    over(g, _lt, t) { custodiansTitle(g, t); },
  },
  {
    from: 19.5, to: 20, name: "orb",
    enter() { game.custodianOrb(rivalNear(-1)); },
    cam(c) {
      const orb = rig.orbs()[0];
      const O = orb ? orb.position : kPos(0);
      frameAt(uOf(0));
      const pos = v1.copy(O).addScaledVector(f.side, 3.2).addScaledVector(f.tan, 1.5).add(new THREE.Vector3(0, 0.6, 0));
      place(c, pos, v2.copy(O));
      return 46;
    },
    over(g, _lt, t) { custodiansTitle(g, t); },
  },
  {
    from: 20, to: 22, name: "squad",
    cam(c, lt) {
      const ctr = rig.world.center;
      const a = 3.9 + lt * 0.05;
      place(c, v1.set(ctr.x + Math.cos(a) * 250, 60 + lt * 6, ctr.z + Math.sin(a) * 250),
        v2.set(ctr.x + Math.cos(a) * 900, 150, ctr.z + Math.sin(a) * 900));
      return 58;
    },
    dim: () => 0.45,
    over(g, lt) {
      g.kinetic("PICK YOUR DRIVER", W / 2, 230, 110, lt - 0.05, { align: "center", stagger: 0.018, out: 1.8 });
      g.cards(lt, [["DILI BOY", "Common", COL.blue2], ["DCODED", "Rare", COL.gold], ["DCO", "Ultra-rare", COL.pink]]);
    },
  },
  {
    from: 22, to: 26, name: "finale",
    enter() { fastForward(() => kart(0).dist >= 512); game.boostPlayer(2.5); smooth.ready = false; },
    cam(c, lt, dt) {
      // Crane up behind Dili as the kart boosts away toward the city.
      const P = kPos(0), F = kFwd(0, v3.clone());
      const k = inOutCubic(lt / 3.5);
      const pos = v1.copy(P).addScaledVector(F, -(6 + k * 10)).add(new THREE.Vector3(0, 2.2 + k * 16, 0));
      const look = v2.copy(P).addScaledVector(F, 14 + k * 30).add(new THREE.Vector3(0, 1 + k * 8, 0));
      place(c, pos, look, lt < 0.02 ? 0 : 6, dt);
      return 58;
    },
    dim: (lt) => lerp(0.3, 0.6, clamp01(lt / 1.2)),
    over(g, lt) {
      g.endCard(lt);
    },
  },
];

let gooFrom = 1;
function custodiansTitle(g: Gfx, t: number) {
  const lt = t - 19;
  g.bubble("BEAT", 140, 760, 60, lt, { bg: COL.pink, fg: "#fff" });
  g.kinetic("THE CUSTODIANS", 130, 950, 150, lt - 0.1, { stagger: 0.02 });
}

/* ------------------------------------------------------------------ */
/* Global effects: flashes, wipes, beat zoom, shake                    */
/* ------------------------------------------------------------------ */

const CUT_FLASH: [number, number][] = [[2, 0.8], [8, 1], [14, 0.6], [22, 1]];
const WIPES = [10, 12, 16, 20];

function treatment(t: number) {
  let zoom = 1, sx = 0, sy = 0, flash = 0;
  for (const [at, k] of CUT_FLASH) {
    const d = t - at;
    if (d >= 0 && d < 0.45) flash = Math.max(flash, k * (1 - d / 0.45) ** 2);
    if (d >= 0 && d < 0.5) {
      const s = k * 16 * (1 - d / 0.5);
      sx += Math.sin(d * 90) * s;
      sy += Math.cos(d * 77) * s;
    }
  }
  // Pump the picture on every beat of the groove.
  if (t >= 8 && t < 20) {
    const bp = ((t - 8) / BEAT) % 1;
    zoom += 0.022 * Math.exp(-bp * 7);
  }
  if (t >= 22) zoom += 0.04 * Math.exp(-(t - 22) * 5);
  return { zoom, sx, sy, flash };
}

/* ------------------------------------------------------------------ */
/* Render                                                              */
/* ------------------------------------------------------------------ */

async function main() {
  log("Loading fonts and the stadium…");
  await Promise.all([
    document.fonts.load("italic 900 100px Inter"),
    document.fonts.load("900 100px Inter"),
    document.fonts.load("800 100px Inter"),
    document.fonts.load("700 100px Inter"),
  ]);
  const logo = await loadImage(LOGO.replace(/currentColor/g, "#ffffff"), 400);
  const faces = await Promise.all((["dili", "dcoded", "dco"] as const).map((c) => loadImage(portrait(MASCOT[c].head, MASCOT[c].dome, MASCOT[c].mouth), 400)));

  const stage = document.getElementById("stage")!;
  game = new DiliCart();
  await new Promise<void>((resolve) => game.mount(stage, { onEnd() {}, onRestart() {}, onQuit() {}, onReady: resolve }, "dili", { trailer: true }));
  rig = game.rig();

  const out = document.getElementById("out") as HTMLCanvasElement;
  out.width = W; out.height = H;
  const gfx = new Gfx(out, logo, faces);

  let shotIdx = -1;
  let shot = SHOTS[0];
  game.director = (c, dt) => shot.cam(c, curT - shot.from, dt);
  let curT = 0;

  const frames = Math.round(DUR * FPS);
  const want = stills ? new Set(stills.map((s) => Math.round(s * FPS))) : null;
  const lastWanted = want ? Math.max(...want) : frames - 1;

  // Encoder (full render only).
  let muxer: Muxer<ArrayBufferTarget> | null = null;
  let venc: VideoEncoder | null = null;
  if (!want) {
    muxer = new Muxer({
      target: new ArrayBufferTarget(),
      video: { codec: "avc", width: W, height: H, frameRate: FPS },
      audio: { codec: "aac", numberOfChannels: 2, sampleRate: 48000 },
      fastStart: "in-memory",
    });
    venc = new VideoEncoder({
      output: (chunk, meta) => muxer!.addVideoChunk(chunk, meta),
      error: (e) => log("Video encoder error: " + e.message),
    });
    venc.configure({ codec: "avc1.64002a", width: W, height: H, bitrate: 14_000_000, framerate: FPS, latencyMode: "quality" });
  }

  const t0 = performance.now();
  for (let i = 0; i <= lastWanted; i++) {
    curT = i / FPS;
    const idx = SHOTS.findIndex((s) => curT >= s.from && curT < s.to);
    if (idx !== shotIdx && idx >= 0) {
      shotIdx = idx;
      shot = SHOTS[idx];
      smooth.ready = false;
      shot.enter?.();
    }
    const lt = curT - shot.from;
    const draw = !want || want.has(i);
    game.advance((shot.speed?.(lt) ?? 1) / FPS, draw);
    if (!draw) continue;

    const fx = treatment(curT);
    gfx.footage(rig.canvas, fx.zoom, fx.sx, fx.sy, shot.dim?.(lt) ?? 0);
    shot.over?.(gfx, lt, curT);
    for (const w of WIPES) gfx.wipe((curT - (w - 0.28)) / 0.56);
    gfx.flash(fx.flash);
    gfx.finish(i, 0.05);
    gfx.black(curT < 0.25 ? 1 - curT / 0.25 : curT > DUR - 0.8 ? (curT - (DUR - 0.8)) / 0.8 : 0);

    if (want) {
      await fetch(`/__shot?name=tr_${curT.toFixed(2).replace(".", "_")}`, { method: "POST", body: out.toDataURL("image/jpeg", 0.88) });
      log(`still ${curT.toFixed(2)}s (${shot.name})`);
    } else {
      const frame = new VideoFrame(out, { timestamp: Math.round(i * 1e6 / FPS), duration: Math.round(1e6 / FPS) });
      venc!.encode(frame, { keyFrame: i % (FPS * 2) === 0 });
      frame.close();
      while (venc!.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 1));
      if (i % 30 === 0) {
        const el = (performance.now() - t0) / 1000;
        log(`frame ${i}/${frames} · ${shot.name} · ${el.toFixed(0)}s elapsed`);
      }
    }
  }

  if (!want && muxer && venc) {
    await venc.flush();
    log("Rendering the soundtrack…");
    const audio = await renderSoundtrack(DUR);
    const aenc = new AudioEncoder({
      output: (chunk, meta) => muxer!.addAudioChunk(chunk, meta),
      error: (e) => log("Audio encoder error: " + e.message),
    });
    aenc.configure({ codec: "mp4a.40.2", sampleRate: 48000, numberOfChannels: 2, bitrate: 192_000 });
    const L = audio.getChannelData(0), R = audio.getChannelData(1);
    const block = 1024;
    for (let s = 0; s < L.length; s += block) {
      const n = Math.min(block, L.length - s);
      const data = new Float32Array(n * 2);
      data.set(L.subarray(s, s + n), 0);
      data.set(R.subarray(s, s + n), n);
      const ad = new AudioData({ format: "f32-planar", sampleRate: 48000, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round(s * 1e6 / 48000), data });
      aenc.encode(ad);
      ad.close();
    }
    await aenc.flush();
    muxer.finalize();
    const buf = muxer.target.buffer;
    log(`Saving ${(buf.byteLength / 1e6).toFixed(1)} MB…`);
    await fetch("/__save?name=dili-cart-trailer.mp4", { method: "POST", body: buf });
    log(`DONE · trailer/dili-cart-trailer.mp4 · ${(buf.byteLength / 1e6).toFixed(1)} MB · ${((performance.now() - t0) / 1000).toFixed(0)}s`);
  } else {
    log(`DONE · ${want?.size} stills`);
  }
  (window as unknown as { __trailerDone: boolean }).__trailerDone = true;
}

main().catch((e) => log("FAILED: " + (e instanceof Error ? e.stack ?? e.message : String(e))));
