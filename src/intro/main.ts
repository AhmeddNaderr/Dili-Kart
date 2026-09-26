import * as THREE from "three";
import { DiliCart } from "../kart/race";
import { MascotModel } from "../kart/mascot";
import { newFrame } from "../kart/track";
import type { KartPose } from "../kart/models";
import { Cine, DEFAULT_LOOK, type Look } from "./cine";
import { Dash } from "./dash";
import { Titles } from "./titles";
import { CUE } from "./cues";
import { renderScore } from "./score";

/**
 * DILI CART intro film (dev only: /intro.html on the dev server, driven
 * frame by frame by tools/render-intro.cjs).
 *
 * The real stadium, karts and squad, staged shot by shot: Dili walks up to
 * his kart on the grid, waves, hops in, wakes the dashboard and picks the
 * Grand Prix, revs through the start lights, launches, flies the lake in
 * slow motion, and the logo lands in the sky. Each frame goes through the
 * offline cinema chain in cine.ts (depth of field, bloom, filmic grade,
 * motion blur from sub-frames).
 */

const W = 1920, H = 1080;
export const FPS = 30;
const FRAMES = Math.round(CUE.end * FPS);
/** Fraction of the frame interval the shutter is open (a 144° shutter). */
const SHUTTER = 0.4;

const status = document.getElementById("status")!;
const log = (s: string) => { status.textContent = s; console.log("[intro] " + s); };

// Same take every time.
{
  let a = 7;
  Math.random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (x: number) => { const k = clamp01(x); return k * k * (3 - 2 * k); };
const inOut = (x: number) => { const k = clamp01(x); return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; };
const bump = (x: number, a: number, b: number, ramp = 0.25) => smooth((x - a) / ramp) * (1 - smooth((x - b + ramp) / ramp));

let game: DiliCart;
let rig: ReturnType<DiliCart["rig"]>;
let cine: Cine;
let dash: Dash;
let dili: MascotModel;
let titles: Titles;
let out: HTMLCanvasElement;
let g2: CanvasRenderingContext2D;
const key = new THREE.DirectionalLight("#ffe3c4", 0);
const rim = new THREE.DirectionalLight("#a9c8ff", 0);

/** Dili's grid slot: kart position and the track's axes there. */
const f0 = newFrame();
const kart0 = V();
/** A point near Dili's grid slot: forward, to the right, and up (metres). */
const G = (fw: number, sd: number, up: number) => kart0.clone().addScaledVector(f0.tan, fw).addScaledVector(f0.side, sd).add(V(0, up, 0));

/* ------------------------------------------------------------------ */
/* Shots                                                               */
/* ------------------------------------------------------------------ */

interface CamSet {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  fov: number;
  /** The point to hold in focus. */
  focus: THREE.Vector3;
  aperture: number;
  maxBlur?: number;
}

interface Shot {
  name: string;
  from: number;
  to: number;
  /** Motion-blur sub-frames per output frame. */
  subs?: number;
  enter?(): void;
  /** Simulation speed (1 = real time). */
  speed?(lt: number): number;
  cam(lt: number, dt: number): CamSet;
  look?(lt: number): Partial<Look>;
  /** Key and rim light strength. */
  lights?(lt: number): [number, number];
  over?(lt: number): void;
}

const kartPos = () => rig.models[0].root.position;
const cam = { pos: V(), look: V(), ready: false };
function follow(pos: THREE.Vector3, look: THREE.Vector3, rate: number, dt: number) {
  if (!cam.ready) { cam.pos.copy(pos); cam.look.copy(look); cam.ready = true; }
  cam.pos.lerp(pos, 1 - Math.exp(-dt * rate));
  cam.look.lerp(look, 1 - Math.exp(-dt * rate * 1.3));
  return { pos: cam.pos.clone(), look: cam.look.clone() };
}

/** Where Dili stands beside the cockpit before he hops in. */
const STAND = () => G(-0.3, 1.9, 0);
const diliHead = () => dili.root.position.clone().add(V(0, 1.95, 0));

const SHOTS: Shot[] = [
  {
    name: "establish", from: CUE.open, to: CUE.wave,
    cam(lt) {
      const k = inOut(lt / (CUE.wave - CUE.open));
      const pos = G(-14, 8.6, 3.8).lerp(G(-6.6, 5.8, 1.75), k);
      const gate = G(26, 0, 4.5);
      const look = gate.clone().lerp(diliHead().add(V(0, -0.5, 0)), smooth((lt - 0.4) / 2.6));
      const focus = gate.clone().lerp(diliHead(), smooth((lt - 0.8) / 1.6));
      return { pos, look, fov: 36, focus, aperture: 0.8 + k * 0.4 };
    },
    look: (lt) => ({ black: 1 - smooth(lt / 0.9) }),
    lights: () => [0.4, 0.8],
    over(lt) { titles.caption("RACE DAY", "DLICOM GRAND PRIX", lt - 0.9, 3.0); },
  },
  {
    name: "wave", from: CUE.wave, to: CUE.hop,
    cam(lt) {
      const pos = G(2.9, 5.5, 1.35).add(V(0, lt * 0.03, 0)).addScaledVector(f0.tan, -lt * 0.12);
      return { pos, look: diliHead().add(V(0, -0.25, 0)), fov: 30, focus: diliHead(), aperture: 1.9 };
    },
    lights: () => [1.2, 1.3],
  },
  {
    name: "hop", from: CUE.hop, to: CUE.cockpit, subs: 3,
    cam(lt) {
      const k = smooth(lt / 2);
      const pos = G(5.6, 6.4, 1.7).lerp(G(4.9, 5.7, 1.8), k);
      return { pos, look: G(-0.3, 1.0, 1.35), fov: 36, focus: G(-0.2, 1.1, 1.3), aperture: 1.1 };
    },
    lights: () => [0.8, 1.0],
  },
  {
    name: "cockpit", from: CUE.cockpit, to: CUE.dash,
    cam(lt) {
      const k = smooth(lt / 2.6);
      const pos = G(3.3, 1.45, 1.9).lerp(G(2.85, 1.25, 1.85), k);
      const head = kartPos().clone().add(V(0, 1.95, 0));
      return { pos, look: head.clone().add(V(0, -0.2, 0)), fov: 28, focus: head, aperture: 2.3 };
    },
    lights: () => [1.3, 1.6],
  },
  {
    name: "dash", from: CUE.dash, to: CUE.rev,
    enter() { dash.root.visible = true; },
    cam(lt) {
      const k = smooth(lt / 5);
      const P = dash.root.position;
      const back = V().copy(f0.tan).multiplyScalar(-1);
      const pos = P.clone().addScaledVector(back, 2.55 - 0.35 * k).addScaledVector(f0.side, 0.2 - 0.12 * k).add(V(0, 0.08 + Math.sin(lt * 0.9) * 0.01, 0));
      const look = P.clone().addScaledVector(f0.side, 0.08).add(V(0, -0.04, 0));
      const focus = P.clone().addScaledVector(back, 0.18);
      return { pos, look, fov: 30, focus, aperture: 2.8, maxBlur: 28 };
    },
    lights: () => [1.0, 0.7],
  },
  {
    name: "rev", from: CUE.rev, to: CUE.lamps,
    enter() { dash.root.visible = false; game.go(); },
    cam(lt) {
      const pos = G(-3.7, -2.0, 0.55).lerp(G(-3.3, -1.75, 0.62), smooth(lt / 1.8));
      return { pos, look: G(1.8, 0.35, 0.95), fov: 40, focus: G(-1.3, 0, 0.9), aperture: 1.3 };
    },
    lights: () => [0.4, 1.2],
  },
  {
    name: "lamps", from: CUE.lamps, to: CUE.launch,
    cam(lt) {
      const mid = V();
      for (const l of rig.world.gateLamps) mid.add(l.getWorldPosition(V()));
      mid.multiplyScalar(1 / rig.world.gateLamps.length);
      const pos = mid.clone().addScaledVector(f0.tan, -(7.2 - lt * 0.6)).addScaledVector(f0.side, 2.4).add(V(0, -2.2, 0));
      return { pos, look: mid.clone().add(V(0, 0.2, 0)), fov: 30, focus: mid, aperture: 1.5 };
    },
    lights: () => [0, 0.8],
  },
  {
    name: "launch", from: CUE.launch, to: CUE.fly, subs: 6,
    enter() { cam.ready = false; },
    cam(lt) {
      // A low camera by the barrier that pans with the kart as it rockets past.
      const k = kartPos().clone().add(V(0, 0.85, 0));
      return { pos: G(8.8, 4.7, 0.42), look: k, fov: 44 - smooth(lt / 1.4) * 6, focus: k, aperture: 0.75 };
    },
    lights: () => [0.3, 1.0],
  },
  {
    name: "fly", from: CUE.fly, to: CUE.logo, subs: 5,
    enter() {
      const lip = rig.track.wrap(rig.track.lipU - rig.track.startU);
      for (let i = 0; i < 60 * 60 && rig.karts[0].dist < lip - 21; i++) game.advance(1 / 60, false);
      cam.ready = false;
    },
    speed(lt) {
      const t = CUE.fly + lt;
      return 1 - 0.72 * smooth((t - CUE.slowFrom) / 0.25) * (1 - smooth((t - (CUE.slowTo - 0.3)) / 0.3));
    },
    cam(lt) {
      const kp = kartPos();
      const f = rig.track.frame(rig.track.wrap(rig.track.startU + rig.karts[0].dist), newFrame());
      const orbit = smooth((lt - 0.8) / 3.2);
      const pos = kp.clone().addScaledVector(f.side, -8.5 + orbit * 2.5).addScaledVector(f.tan, 2.5 - orbit * 6).add(V(0, 1.9 + orbit * 1.2, 0));
      const look = kp.clone().addScaledVector(f.tan, 1.5).add(V(0, 1.4, 0));
      // Locked to the kart, like a camera car flying alongside.
      return { pos, look, fov: 42, focus: kp.clone().add(V(0, 1.2, 0)), aperture: 0.6 };
    },
    look: () => ({ bloom: 0.14 }),
    lights: () => [0.6, 1.3],
  },
  {
    name: "logo", from: CUE.logo, to: CUE.end, subs: 3,
    cam(lt, dt) {
      const kp = kartPos();
      const f = rig.track.frame(rig.track.wrap(rig.track.startU + rig.karts[0].dist), newFrame());
      const k = inOut(lt / 3.2);
      const pos = kp.clone().addScaledVector(f.side, -6 - 5 * k).addScaledVector(f.tan, -3.5 - 6 * k).add(V(0, 3.1 + 11 * k, 0));
      const look = kp.clone().addScaledVector(f.tan, 14 + 50 * k).add(V(0, 1.5 + 30 * k, 0));
      const s = follow(pos, look, 4, dt);
      return { pos: s.pos, look: s.look, fov: 44 + 8 * k, focus: kp, aperture: 0.55 };
    },
    look: (lt) => ({ black: smooth((lt - (CUE.end - CUE.logo - 0.7)) / 0.7) }),
    lights: () => [0.4, 0.8],
    over(lt) { titles.logo(lt - 0.25, 1); },
  },
];

/* ------------------------------------------------------------------ */
/* Acting                                                              */
/* ------------------------------------------------------------------ */

/** Dili on foot: the walk up, the wave, the hop. Hidden once he's in the seat. */
function actDili(T: number, dt: number) {
  const r = dili.rig;
  const start = G(-6.6, 6.9, 0), stand = STAND();
  const faceKart = Math.atan2(-f0.side.x, -f0.side.z);
  const faceFwd = Math.atan2(f0.tan.x, f0.tan.z);
  dili.root.visible = T < CUE.land;
  if (!dili.root.visible) return;
  dili.root.scale.set(1, 1, 1);
  if (T < CUE.walkTo) {
    // Walk in, slowing for the last few steps.
    const u = T / CUE.walkTo;
    const k = u < 0.8 ? u / 0.9 : 0.8 / 0.9 + (1 - 0.8 / 0.9) * smooth((u - 0.8) / 0.2);
    const p = start.clone().lerp(stand, k);
    dili.root.position.copy(p);
    const dir = stand.clone().sub(start);
    const along = Math.atan2(dir.x, dir.z);
    dili.root.rotation.y = along + (faceKart - along) * smooth((u - 0.85) / 0.15);
    const speed = dir.length() / CUE.walkTo * (u < 0.8 ? 1.12 : 1 - smooth((u - 0.8) / 0.2));
    dili.stride += speed * dt * (Math.PI / 0.85);
    dili.walk = 1 - smooth((u - 0.9) / 0.1);
    dili.pose = "idle";
  } else if (T < CUE.hop) {
    // Turn to camera and wave, then back to the kart.
    dili.walk = 0;
    dili.root.position.copy(stand);
    const toCam = G(2.9, 5.5, 0).sub(stand);
    const faceCam = Math.atan2(toCam.x, toCam.z);
    const lt = T - CUE.wave;
    const turn = T < CUE.wave ? 0 : smooth(lt / 0.45) * (1 - smooth((lt - 1.75) / 0.4));
    dili.root.rotation.y = faceKart + (faceCam - faceKart) * turn;
    dili.pose = lt > 0.4 && lt < 1.7 ? "wave" : "idle";
  } else {
    // Crouch, spring up and over the side pod, drop into the seat.
    dili.walk = 0;
    dili.pose = "idle";
    const crouch = smooth((T - (CUE.jump - 0.3)) / 0.25) * (1 - smooth((T - CUE.jump) / 0.08));
    const s = clamp01((T - CUE.jump) / (CUE.land - CUE.jump));
    const seat = kartPos().clone();
    const p = stand.clone().lerp(seat, s < 1 ? 1 - Math.pow(1 - s, 1.6) * (1 - s * 0.4) : 1);
    p.y += Math.sin(Math.PI * s) * 0.95 - crouch * 0.14;
    dili.root.position.copy(p);
    dili.root.rotation.y = faceKart + (faceFwd - faceKart) * smooth(s * 1.2);
    const stretch = s > 0 && s < 1 ? 1 + 0.12 * Math.sin(Math.PI * Math.min(1, s * 2)) : 1 - crouch * 0.1;
    dili.root.scale.set(1 / Math.sqrt(stretch), stretch, 1 / Math.sqrt(stretch));
  }
  dili.update(T + 1.3, dt);
  // In the air: arms up, knees tucked.
  if (T > CUE.jump && T < CUE.land) {
    const a = Math.sin(Math.PI * clamp01((T - CUE.jump) / (CUE.land - CUE.jump)));
    r.armL.rotation.x = -2.3 * a; r.armR.rotation.x = -2.3 * a;
    r.armL.rotation.z = 0.5 * a; r.armR.rotation.z = -0.5 * a;
    if (r.legL && r.legR) { r.legL.rotation.x = -1.1 * a; r.legR.rotation.x = -0.9 * a; }
  }
}

/** Dili in the seat: hidden until he lands, then waves, looks, nods; revs on the grid. */
function actDriver(T: number) {
  rig.models[0].driver.visible = T >= CUE.land;
  game.poseOverride = (i, p: KartPose): KartPose => {
    if (i !== 0) return p;
    const q = { ...p, time: T + 0.5 };
    if (T < CUE.dash) {
      const lt = T - CUE.cockpit;
      q.wave = bump(lt, 0.5, 1.5);
      q.look = { yaw: -0.5 * bump(lt, 0.05, 2.35, 0.35), nod: 0.16 * bump(lt, 1.8, 2.3, 0.15) };
    }
    // The autopilot fires items in the air, and any key just after the ramp
    // counts as a trick; keep Dili upright for the flight and the logo.
    if (T >= CUE.fly) { q.flip = 0; q.roll = 0; }
    if (T >= CUE.lights && T < CUE.go) {
      const beat = (T - CUE.lights) % 1;
      q.boost = Math.max(q.boost, 0.75 * Math.exp(-beat * 5) * (beat < 0.6 ? 1 : 0));
    }
    return q;
  };
}

/* ------------------------------------------------------------------ */
/* Render loop                                                         */
/* ------------------------------------------------------------------ */

let T = 0;              // film time the simulation has reached
let shotIdx = -1;
let landed = false;

function shotAt(t: number) {
  return SHOTS.findIndex((s) => t >= s.from - 1e-6 && t < s.to - 1e-6);
}

/** Move the film (and the race under it) forward to time `to`. */
function advanceTo(to: number) {
  while (T < to - 1e-7) {
    const idx = Math.max(0, shotAt(T));
    const shot = SHOTS[idx];
    const step = Math.min(to - T, 1 / 120, shot.to - T);
    const dt = Math.max(step, 1e-5);
    actDili(T, dt);
    actDriver(T);
    if (!landed && T >= CUE.land) { landed = true; rig.models[0].thump(3.2); }
    const sim = shot.speed ? shot.speed(T - shot.from) : 1;
    game.advance(dt * sim, false);
    T += dt;
  }
}

function placeCamera(shot: Shot, dt: number) {
  const c = shot.cam(T - shot.from, dt);
  const camera = rig.camera;
  camera.position.copy(c.pos);
  camera.up.set(0, 1, 0);
  camera.lookAt(c.look);
  camera.fov = c.fov;
  camera.near = 0.05;
  camera.far = 2600;
  camera.updateProjectionMatrix();
  // Key light from front-left above the camera, rim from behind the subject.
  const fwd = c.look.clone().sub(c.pos).normalize();
  const right = fwd.clone().cross(V(0, 1, 0)).normalize();
  const [kk, rr] = shot.lights ? shot.lights(T - shot.from) : [0, 0];
  key.intensity = kk * 1.4;
  key.position.copy(c.focus).addScaledVector(fwd, -6).addScaledVector(right, -5).add(V(0, 6, 0));
  key.target.position.copy(c.focus);
  rim.intensity = rr * 1.8;
  rim.position.copy(c.focus).addScaledVector(fwd, 7).addScaledVector(right, 3).add(V(0, 4, 0));
  rim.target.position.copy(c.focus);
  const focus = c.focus.clone().sub(c.pos).dot(fwd);
  return { lens: { focus: Math.max(0.2, focus), aperture: c.aperture, maxBlur: c.maxBlur ?? 22 } };
}

/** Render output frame `i` (frames must be requested in order). */
function frame(i: number, draw = true) {
  const t0 = performance.now();
  const t = i / FPS;
  const idx = shotAt(t);
  const shot = SHOTS[Math.max(0, idx)];
  if (idx !== shotIdx) {
    shotIdx = idx;
    advanceTo(shot.from);
    shot.enter?.();
  }
  if (!draw) { advanceTo((i + 1) / FPS); return null; }
  const subs = shot.subs ?? 1;
  const look: Look = { ...DEFAULT_LOOK, ...(shot.look?.(t - shot.from) ?? {}) };
  cine.begin();
  for (let k = 0; k < subs; k++) {
    const ts = t + (subs > 1 ? (k / subs) * SHUTTER / FPS : 0);
    const prev = T;
    advanceTo(ts);
    if (shot.name === "dash") dash.update(T - CUE.dash);
    const { lens } = placeCamera(shot, Math.max(1 / 240, T - prev));
    cine.sub(rig.scene, rig.camera, lens, look, 1 / subs);
  }
  cine.present();
  advanceTo((i + 1) / FPS);
  g2.drawImage(rig.canvas, 0, 0, W, H);
  shot.over?.(t - shot.from);
  const url = out.toDataURL("image/jpeg", 0.95);
  if (i % 10 === 0) log(`frame ${i}/${FRAMES} · ${shot.name} · ${Math.round(performance.now() - t0)} ms`);
  return url;
}

/** The soundtrack as a 16-bit stereo WAV, base64. */
async function audio() {
  const buf = await renderScore(CUE.end);
  const n = buf.length, ch = 2;
  const bytes = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const w = (o: number, s: string) => { for (let k = 0; k < s.length; k++) bytes.setUint8(o + k, s.charCodeAt(k)); };
  w(0, "RIFF"); bytes.setUint32(4, 36 + n * ch * 2, true); w(8, "WAVE"); w(12, "fmt ");
  bytes.setUint32(16, 16, true); bytes.setUint16(20, 1, true); bytes.setUint16(22, ch, true);
  bytes.setUint32(24, buf.sampleRate, true); bytes.setUint32(28, buf.sampleRate * ch * 2, true);
  bytes.setUint16(32, ch * 2, true); bytes.setUint16(34, 16, true); w(36, "data"); bytes.setUint32(40, n * ch * 2, true);
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  for (let k = 0, o = 44; k < n; k++, o += 4) {
    bytes.setInt16(o, Math.max(-1, Math.min(1, L[k])) * 32767, true);
    bytes.setInt16(o + 2, Math.max(-1, Math.min(1, R[k])) * 32767, true);
  }
  let s = "";
  const u8 = new Uint8Array(bytes.buffer);
  for (let k = 0; k < u8.length; k += 0x8000) s += String.fromCharCode(...u8.subarray(k, k + 0x8000));
  return btoa(s);
}

async function main() {
  log("Loading fonts and the stadium…");
  await Promise.all(["italic 900 100px Inter", "900 100px Inter", "800 100px Inter"].map((f) => document.fonts.load(f)));
  const stage = document.getElementById("stage")!;
  game = new DiliCart();
  await new Promise<void>((resolve) => game.mount(stage, { onEnd() {}, onRestart() {}, onQuit() {}, onReady: resolve }, "dili", { trailer: true }));
  rig = game.rig();
  game.director = (c) => c.fov;
  game.advance(1 / 60, false);

  // Dili's slot on the grid, and the frame of the track there.
  kart0.copy(kartPos());
  rig.track.frame(rig.track.wrap(rig.track.startU + rig.karts[0].dist), f0);

  // Sharper, softer sun shadows for close-ups.
  const r = rig.renderer;
  r.shadowMap.type = THREE.PCFSoftShadowMap;
  const sun = rig.world.sun;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.map?.dispose();
  (sun.shadow as unknown as { map: THREE.WebGLRenderTarget | null }).map = null;
  Object.assign(sun.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.radius = 3;
  rig.scene.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (m) for (const x of Array.isArray(m) ? m : [m]) x.needsUpdate = true;
  });

  // Cinema lights, the standing Dili, and the dashboard set.
  rig.scene.add(key, key.target, rim, rim.target);
  dili = new MascotModel("dili", 0);
  dili.root.traverse((o) => { (o as THREE.Mesh).castShadow = true; });
  rig.scene.add(dili.root);
  dash = new Dash();
  dash.root.visible = false;
  const P = G(6.2, 0, 1.75);
  dash.root.position.copy(P);
  dash.root.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(f0.side, V(0, 1, 0), f0.tan.clone().multiplyScalar(-1)));
  rig.scene.add(dash.root);

  cine = new Cine(r, W, H);
  out = document.getElementById("out") as HTMLCanvasElement;
  out.width = W; out.height = H;
  g2 = out.getContext("2d")!;
  titles = new Titles(g2, W, H);
  (window as unknown as Record<string, unknown>).__intro = { frame, audio, frames: FRAMES, fps: FPS };
  log("ready");
}

main().catch((e) => log("FAILED: " + (e instanceof Error ? e.stack ?? e.message : String(e))));
