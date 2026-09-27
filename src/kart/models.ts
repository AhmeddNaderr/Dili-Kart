import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import * as T from "./textures";
import type { CharId, SkinId } from "../../shared/rules";
import { animateCape, blink, buildMascot, disposeMascots, type DriverId, type EvilLook, type MascotRig } from "./mascot";
import type { SkinDriver } from "./chibi";
import { rimLight } from "./rim";

/**
 * Procedural 3D models, built from rounded primitives and glossy materials
 * in the style of the Dlicom concept art: chunky toy proportions, big head,
 * big tyres. Every model faces +Z with its origin on the ground.
 *
 * Handedness note: a model facing +Z has its local +X on the driver's LEFT.
 */

/* ------------------------------------------------------------------ */
/* Shared building blocks                                              */
/* ------------------------------------------------------------------ */

const geoCache = new Map<string, THREE.BufferGeometry>();
function cached<G extends THREE.BufferGeometry>(key: string, make: () => G): G {
  let g = geoCache.get(key) as G | undefined;
  if (!g) { g = make(); geoCache.set(key, g); }
  return g;
}

const rbox = (w: number, h: number, d: number, r: number) =>
  cached(`rb${w},${h},${d},${r}`, () => new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2, h / 2, d / 2) * 0.999));
const sphere = (r: number, ws = 24, hs = 16) => cached(`s${r},${ws}`, () => new THREE.SphereGeometry(r, ws, hs));
const cyl = (rt: number, rb: number, h: number, seg = 20) =>
  cached(`c${rt},${rb},${h},${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg));
const capsule = (r: number, len: number) => cached(`cap${r},${len}`, () => new THREE.CapsuleGeometry(r, len, 6, 12));
const torus = (r: number, t: number, arc = Math.PI * 2) =>
  cached(`t${r},${t},${arc}`, () => new THREE.TorusGeometry(r, t, 10, 28, arc));

export function disposeModels() {
  for (const g of geoCache.values()) g.dispose();
  geoCache.clear();
  for (const m of matCache.values()) m.dispose();
  matCache.clear();
  disposeMascots();
}

const matCache = new Map<string, THREE.Material>();

/** Glossy toy plastic. */
export function plastic(color: string, rough = 0.34, metal = 0.05): THREE.MeshStandardMaterial {
  const k = `p${color}${rough}${metal}`;
  let m = matCache.get(k) as THREE.MeshStandardMaterial | undefined;
  if (!m) {
    m = rimLight(new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }));
    matCache.set(k, m);
  }
  return m;
}
/** Something that lights itself — lamps, visors, exhaust glow. */
export function glow(color: string, strength = 2.2): THREE.MeshStandardMaterial {
  const k = `g${color}${strength}`;
  let m = matCache.get(k) as THREE.MeshStandardMaterial | undefined;
  if (!m) {
    // Scaled so glows sit above the bloom threshold.
    m = new THREE.MeshStandardMaterial({
      color: "#000000", emissive: color, emissiveIntensity: strength * 1.9, roughness: 0.4,
    });
    matCache.set(k, m);
  }
  return m;
}
/** Thin double-sided fabric: flags, banners. */
export function cloth(color: string): THREE.MeshStandardMaterial {
  const k = `c${color}`;
  let m = matCache.get(k) as THREE.MeshStandardMaterial | undefined;
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.6, side: THREE.DoubleSide });
    matCache.set(k, m);
  }
  return m;
}
const chrome = () => plastic("#dfe6f5", 0.18, 1);

function add(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material,
  x = 0, y = 0, z = 0, shadow = true): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  parent.add(m);
  return m;
}

/* ------------------------------------------------------------------ */
/* Karts                                                               */
/* ------------------------------------------------------------------ */

export interface KartLook {
  body: string;      // main paint
  trim: string;      // pods, skirt, wing plates
  accent: string;    // stripe, valve covers, harness
  glow: string;      // exhaust and lamps
  number: string;    // race number on the side pods
  driver: DriverId | "custodian";
  /** A printed paint job instead of plain paint (shop skins). */
  livery?: T.Livery;
  /** Letter on the nose badge. */
  letter?: string;
}

/** Karts for the shop skins: Quang and Cipher bring their own; liveries repaint the squad kart. */
export const SKIN_LOOKS: Record<SkinDriver, KartLook> = {
  quang: { body: "#ffffff", trim: "#1fb2ef", accent: "#0b7fc4", glow: "#7fe6ff", number: "8", driver: "quang", livery: "waves", letter: "Q" },
  cipher: { body: "#ffffff", trim: "#2f4dff", accent: "#1a2cc2", glow: "#4d7bff", number: "01", driver: "cipher", livery: "matrix", letter: "C" },
};

/** The kart a player drives: their squad driver's, dressed in any equipped skin. */
export function lookFor(char: CharId, skin: SkinId | null | undefined): KartLook {
  if (skin === "quang" || skin === "cipher") return SKIN_LOOKS[skin];
  const base = DRIVER_LOOKS[char];
  if (skin === "gold") return { ...base, body: "#ffffff", trim: "#15161f", accent: "#2a2b36", glow: "#ffd24d", livery: "gold" };
  if (skin === "carbon") return { ...base, body: "#ffffff", trim: "#1c2030", accent: "#8fe3ff", glow: "#8fe3ff", livery: "carbon" };
  return base;
}

/** The player's kart, in each squad member's colours. */
export const DRIVER_LOOKS: Record<CharId, KartLook> = {
  dili: { body: "#f3f5fc", trim: "#3d63ff", accent: "#2446d8", glow: "#58c8ff", number: "1", driver: "dili" },
  dcoded: { body: "#1d1f2a", trim: "#ffc21a", accent: "#ffae00", glow: "#ffd24d", number: "7", driver: "dcoded" },
  dco: { body: "#f7f2fb", trim: "#e447d2", accent: "#b52fae", glow: "#ff7df0", number: "0", driver: "dco" },
};
export const DILI_LOOK = DRIVER_LOOKS.dili;

/** Custodian crews: same villain, different team colours so you can tell them apart. */
export const RIVAL_LOOKS: KartLook[] = [
  ["#e8384f", "#ff5a6e", "#ff3048"], ["#ff8a1f", "#ffb04d", "#ff8a1f"], ["#9b5cff", "#c09bff", "#b77dff"],
  ["#19c37d", "#56e3a6", "#2cff9a"], ["#ff4fb4", "#ff8bd0", "#ff4fb4"], ["#ffd21f", "#ffe266", "#ffd21f"],
  ["#16c1e0", "#6fe6ff", "#16c1e0"],
].map(([trim, accent, glowC], i) => ({ body: "#1a1926", trim, accent, glow: glowC, number: String(i + 2), driver: "custodian" as const }));

export interface KartPose {
  speed: number;
  steer: number;        // -1..1, + is right
  slide: number;        // visual yaw offset from drifting, radians, + is right
  hop: number;          // extra lift, metres
  squash: number;       // 1 = rest; <1 squashed, >1 stretched
  roll: number;         // spin-out / trick rotation, radians
  flip: number;         // trick barrel roll, radians
  boost: number;        // 0..1 flame strength
  glide: number;        // 0..1 cape spread (and glider, once airborne)
  pitch?: number;       // nose up (+) / down (−) in the air, radians
  wave: number;         // 0 driving, 1 one-arm wave, 2 both arms up
  time: number;
  /** Extra head turn for directed shots: yaw (+ left) and nod (+ down), radians. */
  look?: { yaw: number; nod: number };
}

/** Glossy clear-coated car paint. */
export function paint(color: string): THREE.MeshPhysicalMaterial {
  const k = `paint${color}`;
  let m = matCache.get(k) as THREE.MeshPhysicalMaterial | undefined;
  if (!m) {
    m = rimLight(new THREE.MeshPhysicalMaterial({ color, roughness: 0.3, metalness: 0.12, clearcoat: 1, clearcoatRoughness: 0.06 }), 0.38);
    matCache.set(k, m);
  }
  return m;
}

/** Printed paint under the same deep clearcoat as the plain paint. */
function liveryPaint(kind: T.Livery): THREE.MeshPhysicalMaterial {
  const k = `livery${kind}`;
  let m = matCache.get(k) as THREE.MeshPhysicalMaterial | undefined;
  if (!m) {
    const metal = kind === "gold" ? 0.55 : kind === "carbon" ? 0.3 : 0.1;
    m = rimLight(new THREE.MeshPhysicalMaterial({
      map: T.liveryTex(kind), roughness: kind === "gold" ? 0.22 : 0.3, metalness: metal, clearcoat: 1, clearcoatRoughness: 0.05,
    }), 0.38);
    matCache.set(k, m);
  }
  return m;
}

function texMat(key: string, make: () => THREE.Material) {
  let m = matCache.get(key);
  if (!m) { m = make(); matCache.set(key, m); }
  return m;
}

/** Side profile of the body shell, extruded across the kart's width. */
function shellGeo(extra: number, width: number) {
  return cached(`shell${extra}${width}`, () => {
    const s = new THREE.Shape();
    s.moveTo(-1.0, 0.32);
    s.lineTo(-1.0, 0.58);
    s.quadraticCurveTo(-1.0, 0.72, -0.84, 0.72);
    s.lineTo(-0.62, 0.72);
    s.quadraticCurveTo(-0.5, 0.72, -0.46, 0.62);
    s.lineTo(0.16, 0.6);
    s.quadraticCurveTo(0.32, 0.6, 0.42, 0.8);
    s.quadraticCurveTo(0.55, 0.9, 0.78, 0.8);
    s.quadraticCurveTo(1.18, 0.6, 1.38, 0.45);
    s.quadraticCurveTo(1.48, 0.37, 1.4, 0.32);
    s.lineTo(-1.0, 0.32);
    const g = new THREE.ExtrudeGeometry(s, {
      depth: width, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.1 + extra, bevelSegments: 5, curveSegments: 16,
    });
    g.rotateY(-Math.PI / 2);
    g.translate(width / 2, 0, 0);
    g.computeVertexNormals();
    return g;
  });
}

/** Side pod, seen from above; `s` is the side (+1 left, -1 right). */
function podGeo(s: number) {
  return cached(`pod${s}`, () => {
    const p = new THREE.Shape();
    const y = (v: number) => v * s;
    p.moveTo(-0.4, 0);
    p.lineTo(-0.4, y(0.2));
    p.quadraticCurveTo(-0.4, y(0.34), -0.24, y(0.34));
    p.lineTo(0.3, y(0.34));
    p.quadraticCurveTo(0.56, y(0.34), 0.56, y(0.1));
    p.lineTo(0.56, 0);
    p.lineTo(-0.4, 0);
    const g = new THREE.ExtrudeGeometry(p, { depth: 0.28, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 4, curveSegments: 12 });
    // Shape x → forward (z), shape y → sideways (x), extrusion → up (y).
    g.rotateX(-Math.PI / 2);
    g.rotateY(-Math.PI / 2);
    g.computeVertexNormals();
    return g;
  });
}

/** Exhaust pipe that curves back and up out of the engine. */
function exhaustGeo(s: number) {
  return cached(`exhaust${s}`, () => new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.24 * s, 0.62, -0.82),
    new THREE.Vector3(0.3 * s, 0.6, -1.08),
    new THREE.Vector3(0.33 * s, 0.7, -1.32),
    new THREE.Vector3(0.34 * s, 0.84, -1.46),
  ]), 20, 0.075, 12, false));
}

/** A coil spring for the rear shocks. */
function springGeo() {
  return cached("spring", () => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 80; i++) {
      const t = i / 80;
      const a = t * Math.PI * 2 * 6;
      pts.push(new THREE.Vector3(Math.cos(a) * 0.055, t * 0.3, Math.sin(a) * 0.055));
    }
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 160, 0.012, 6, false);
  });
}

export class KartModel {
  /** Placed on the track by the game each frame. */
  readonly root = new THREE.Group();
  /** Everything that bounces, leans and slides. */
  readonly body = new THREE.Group();
  private chassis = new THREE.Group();
  /** Fine parts, hidden when the kart is far from the camera. */
  private detail = new THREE.Group();
  /** The seated driver; the intro film hides it and drops it into the seat. */
  readonly driver = new THREE.Group();
  private steerGroups: THREE.Object3D[] = [];
  private flames: THREE.Mesh[] = [];
  private exhaustGlow: THREE.Mesh[] = [];
  private head = new THREE.Group();
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private rig: MascotRig | null = null;
  private rimTexture: THREE.Texture | null = null;
  private tyreTexture: THREE.Texture | null = null;
  private keepApart = new Set<THREE.Object3D>();
  /** Soft contact shadow. Positioned on the road separately, so it stays down during jumps. */
  readonly shadowRoot = new THREE.Group();
  readonly shadow: THREE.Mesh;
  private bob = 0;
  private bobV = 0;
  /** Hang-glider that pops open over the lake. */
  private glider = new THREE.Group();
  private gliderK = 0;
  private gliderV = 0;
  private tips: THREE.Object3D[] = [];
  /** Pennant on a whip antenna, waving with speed. */
  private flag: THREE.Mesh | null = null;
  private flagBase: Float32Array | null = null;

  constructor(readonly look: KartLook, shadowTex: THREE.Texture) {
    this.root.add(this.body);
    this.body.add(this.chassis, this.driver);
    this.chassis.add(this.detail);
    this.buildKart();
    if (look.driver === "custodian") this.buildMascotDriver("dili", { team: look.trim, glow: look.glow });
    else this.buildMascotDriver(look.driver);
    this.buildGlider();

    // Collapse every static part into one mesh per material.
    for (const x of [...this.exhaustGlow, ...this.flames]) this.keepApart.add(x);
    mergeChildren(this.chassis, this.keepApart);
    mergeChildren(this.detail, this.keepApart, false);
    mergeChildren(this.head, this.keepApart);
    mergeChildren(this.driver, this.keepApart);

    this.shadow = new THREE.Mesh(
      cached("shadowPlane", () => new THREE.PlaneGeometry(2.7, 3.6).rotateX(-Math.PI / 2)),
      new THREE.MeshBasicMaterial({
        map: shadowTex, transparent: true, depthWrite: false, opacity: 0.75,
        polygonOffset: true, polygonOffsetFactor: -2,
      }),
    );
    this.shadow.renderOrder = 1;
    this.shadowRoot.add(this.shadow);
    this.shadow.position.y = 0.05;
    if (look.driver === "custodian") {
      // Villain underglow on the road in the team colour.
      const under = new THREE.Mesh(
        cached("underglow", () => new THREE.PlaneGeometry(3.4, 4.4).rotateX(-Math.PI / 2)),
        texMat(`under${look.glow}`, () => new THREE.MeshBasicMaterial({
          map: T.blobTex("rgba(255,255,255,.75)", "rgba(255,255,255,0)"), color: look.glow, transparent: true,
          blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -3,
        })),
      );
      under.position.y = 0.06;
      under.renderOrder = 1;
      this.shadowRoot.add(under);
    }
  }

  /**
   * Night racing: soft headlight beams, a pool of light on the road ahead,
   * and brighter tail lights. Neon Town turns these on.
   */
  lightsOn() {
    const beamMat = texMat(`beam${this.look.glow}`, () => {
      const c = document.createElement("canvas");
      c.width = 4; c.height = 128;
      const g = c.getContext("2d")!;
      const gr = g.createLinearGradient(0, 0, 0, 128);
      gr.addColorStop(0, "rgba(255,255,255,0.9)");
      gr.addColorStop(0.35, "rgba(255,255,255,0.3)");
      gr.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = gr;
      g.fillRect(0, 0, 4, 128);
      const t = new THREE.CanvasTexture(c);
      return new THREE.MeshBasicMaterial({
        map: t, color: new THREE.Color(this.look.driver === "custodian" ? this.look.glow : "#dff1ff").multiplyScalar(0.55),
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
      });
    });
    // Cone with its apex at the lamp, opening forward and a little down.
    const coneGeo = cached("beamCone", () => new THREE.ConeGeometry(1.1, 6, 20, 1, true).translate(0, -3, 0).rotateX(-Math.PI / 2 + 0.1));
    for (const s of [1, -1]) {
      const b = new THREE.Mesh(coneGeo, beamMat);
      b.position.set(0.3 * s, 0.53, 1.35);
      b.renderOrder = 2;
      b.frustumCulled = false;
      this.body.add(b);
    }
    const pool = new THREE.Mesh(cached("beamPool", () => new THREE.PlaneGeometry(4.2, 7).rotateX(-Math.PI / 2)), texMat(`pool${this.look.glow}`, () => new THREE.MeshBasicMaterial({
      map: T.blobTex("rgba(255,255,255,.75)", "rgba(255,255,255,0)"),
      color: new THREE.Color(this.look.driver === "custodian" ? this.look.glow : "#e8f4ff").multiplyScalar(0.5),
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, toneMapped: false,
    })));
    pool.position.set(0, 0.07, 5.2);
    pool.renderOrder = 1;
    this.shadowRoot.add(pool);
  }

  /** Show or hide the fine detail (suspension, springs, harness...). */
  setDetail(on: boolean) {
    this.detail.visible = on;
  }

  private buildKart() {
    const L = this.look;
    const c = this.chassis;
    const d = this.detail;
    const body = L.livery ? liveryPaint(L.livery) : paint(L.body);
    const trim = paint(L.trim);
    const accent = paint(L.accent);
    const carbon = texMat("carbon", () => new THREE.MeshPhysicalMaterial({ map: T.carbonTex(), roughness: 0.35, metalness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.1 }));
    const dark = plastic("#1b1e29", 0.5, 0.3);
    const metal = plastic("#3a3f52", 0.32, 0.7);
    const chromeM = chrome();

    // Shell, a raised centre stripe, and a two-tone skirt along the bottom.
    add(c, shellGeo(0, 0.98), body);
    add(c, shellGeo(0.014, 0.16), accent);
    const skirt = add(c, rbox(1.3, 0.16, 2.3, 0.07), trim, 0, 0.3, 0.2);
    skirt.receiveShadow = true;
    add(c, rbox(1.36, 0.08, 2.5, 0.04), carbon, 0, 0.22, 0.22);        // floor tray

    // Side pods with livery.
    const decal = texMat(`pod${L.trim}${L.number}`, () => new THREE.MeshStandardMaterial({
      map: T.podDecalTex(L.accent, L.trim, L.number), transparent: true, roughness: 0.35, polygonOffset: true, polygonOffsetFactor: -2,
    }));
    for (const s of [1, -1]) {
      const pod = add(c, podGeo(s), trim, 0.5 * s, 0.3, 0);
      pod.receiveShadow = true;
      const dec = add(c, cached("podDecal", () => new THREE.PlaneGeometry(0.56, 0.21)), decal, 0.905 * s, 0.46, 0.04, false);
      dec.rotation.y = (s * Math.PI) / 2;
      if (s < 0) dec.scale.x = -1;
    }

    // Front wing: carbon mainplane, a flap, trim-coloured end plates, nose pylon.
    add(c, rbox(1.84, 0.07, 0.4, 0.03), carbon, 0, 0.26, 1.42);
    const flap = add(d, rbox(1.56, 0.05, 0.18, 0.02), trim, 0, 0.34, 1.36);
    flap.rotation.x = 0.35;
    for (const s of [1, -1]) add(c, rbox(0.06, 0.3, 0.52, 0.03), trim, 0.94 * s, 0.34, 1.38);
    add(c, rbox(0.22, 0.14, 0.3, 0.05), carbon, 0, 0.34, 1.34);

    // Headlights: chrome bezel, glass lens, bright core.
    const lamp = glow(L.driver === "custodian" ? L.glow : "#d9f2ff", 2.5);
    for (const s of [1, -1]) {
      const bez = add(c, torus(0.085, 0.022), chromeM, 0.3 * s, 0.53, 1.31);
      bez.rotation.y = 0.25 * s;
      add(c, sphere(0.07, 14, 10), lamp, 0.3 * s, 0.53, 1.3, false);
    }
    const emblem = add(c, cached("emblemPlane", () => new THREE.CircleGeometry(0.16, 28)),
      texMat(`emb${L.trim}${L.driver}${L.letter ?? ""}`, () => new THREE.MeshStandardMaterial({
        map: L.driver === "custodian" ? T.lockEmblemTex(L.trim) : T.emblemTex(L.trim, "#ffffff", "#ffffff", L.letter),
        roughness: 0.35, polygonOffset: true, polygonOffsetFactor: -2,
      })), 0, 0.745, 1.02, false);
    emblem.rotation.x = -Math.PI / 2 + 0.52;

    // Cockpit: bucket seat, headrest, harness, steering wheel, dash screen.
    const seat = add(c, rbox(0.74, 0.66, 0.16, 0.07), dark, 0, 0.96, -0.58);
    seat.rotation.x = -0.14;
    for (const s of [1, -1]) add(c, rbox(0.12, 0.5, 0.36, 0.05), dark, 0.36 * s, 0.84, -0.48);
    add(c, rbox(0.4, 0.2, 0.14, 0.06), accent, 0, 1.36, -0.64);
    for (const s of [1, -1]) add(d, rbox(0.06, 0.46, 0.02, 0.01), accent, 0.14 * s, 1.0, -0.49);
    const col = add(c, cyl(0.035, 0.035, 0.42, 8), dark, 0, 0.86, 0.5);
    col.rotation.x = -0.9;
    const wheel = add(c, cached("steer", () => new THREE.TorusGeometry(0.2, 0.034, 10, 26, Math.PI * 1.55).rotateZ(-Math.PI * 0.28)), dark, 0, 1.0, 0.36);
    wheel.rotation.x = -0.6;
    const bar = add(c, rbox(0.34, 0.05, 0.05, 0.02), dark, 0, 0.93, 0.4);
    bar.rotation.x = -0.6;
    const hub = add(c, cyl(0.06, 0.06, 0.05, 14), trim, 0, 0.99, 0.37);
    hub.rotation.x = Math.PI / 2 - 0.6;
    const dash = add(d, cached("dash", () => new THREE.PlaneGeometry(0.26, 0.13)),
      texMat(`dash${L.glow}`, () => new THREE.MeshBasicMaterial({ map: T.dashTex(L.glow), toneMapped: false })), 0, 0.9, 0.62, false);
    dash.rotation.x = -0.5;
    dash.rotation.y = Math.PI;

    // A small tinted windscreen wrapping round in front of the wheel.
    const screenMat = texMat(`ws${L.glow}`, () => new THREE.MeshPhysicalMaterial({
      color: L.glow, transparent: true, opacity: 0.28, roughness: 0.05, clearcoat: 1, side: THREE.DoubleSide, depthWrite: false,
    }));
    const ws = add(c, cached("windscreen", () => new THREE.CylinderGeometry(0.44, 0.47, 0.24, 28, 1, true, -0.95, 1.9)), screenMat, 0, 0.93, 0.2, false);
    ws.rotation.x = -0.32;

    // Engine: block, valve covers, intake trumpets, curved exhausts.
    add(c, rbox(0.82, 0.38, 0.56, 0.1), metal, 0, 0.72, -0.94);
    for (const s of [1, -1]) {
      const vc = add(c, rbox(0.2, 0.1, 0.5, 0.04), accent, 0.2 * s, 0.93, -0.94);
      vc.rotation.z = 0.3 * s;
      for (let i = 0; i < 2; i++) add(d, cyl(0.04, 0.05, 0.14, 10), chromeM, 0.2 * s, 1.03, -0.84 - i * 0.2);
      add(c, exhaustGeo(s), chromeM);
      const tip = add(c, cached("tip", () => new THREE.CylinderGeometry(0.11, 0.08, 0.14, 16, 1, true)), chromeM, 0.34 * s, 0.86, -1.49);
      tip.rotation.x = Math.PI / 2 + 0.55;
      const g = add(c, cyl(0.075, 0.075, 0.02, 14), glow(L.glow, 1.1), 0.34 * s, 0.87, -1.51, false);
      g.rotation.x = Math.PI / 2 + 0.55;
      this.exhaustGlow.push(g);
      const flame = add(c, cached("flame", () => new THREE.ConeGeometry(0.13, 0.9, 12, 1, true).rotateX(-Math.PI / 2).translate(0, 0, -0.45)),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(L.glow).multiplyScalar(3), transparent: true, opacity: 0.85,
          blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
        }), 0.34 * s, 0.88, -1.54, false);
      flame.rotation.x = 0.55;
      flame.visible = false;
      this.flames.push(flame);
    }
    // Diffuser with fins.
    const diff = add(c, rbox(1.2, 0.06, 0.4, 0.02), carbon, 0, 0.3, -1.12);
    diff.rotation.x = -0.35;
    for (let i = -2; i <= 2; i++) add(d, rbox(0.03, 0.14, 0.34, 0.01), carbon, i * 0.24, 0.32, -1.14);

    // Rear wing: mainplane, flap, end plates with the D, struts, lettering.
    add(c, rbox(1.64, 0.06, 0.44, 0.025), carbon, 0, 1.2, -1.28);
    const rflap = add(c, rbox(1.56, 0.05, 0.2, 0.02), trim, 0, 1.3, -1.44);
    rflap.rotation.x = -0.45;
    const wingDecal = add(c, cached("wingDecal", () => new THREE.PlaneGeometry(1.2, 0.2).rotateX(-Math.PI / 2)),
      texMat(`wing${L.trim}`, () => new THREE.MeshStandardMaterial({ map: T.wingTex(L.trim, "#ffffff"), roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -2 })),
      0, 1.235, -1.26, false);
    wingDecal.rotation.z = Math.PI;
    for (const s of [1, -1]) {
      add(c, rbox(0.05, 0.36, 0.56, 0.02), trim, 0.84 * s, 1.24, -1.32);
      add(c, rbox(0.06, 0.34, 0.1, 0.02), dark, 0.36 * s, 1.0, -1.22);
    }

    // Suspension: front wishbones, rear coil-overs.
    for (const s of [1, -1]) {
      for (const [y, z] of [[0.3, 0.9], [0.42, 1.0]]) {
        const rod = add(d, cyl(0.022, 0.022, 0.36, 6), chromeM, 0.62 * s, y, z, false);
        rod.rotation.z = Math.PI / 2;
      }
      add(d, springGeo(), accent, 0.62 * s, 0.4, -0.86, false);
      add(d, cyl(0.02, 0.02, 0.34, 6), chromeM, 0.62 * s, 0.56, -0.86, false);
    }

    // Wheels: fat rear, smaller front. Rears are baked into the chassis; the
    // fronts sit in groups that steer. Spokes and tread spin by texture.
    const tyreTex = T.tyreTex();
    this.tyreTexture = tyreTex;
    const tyreMat = new THREE.MeshStandardMaterial({ map: tyreTex, roughness: 0.78 });
    const rimT = T.rimTex(L.driver === "custodian" ? "#3a3f52" : "#e6eaf5", L.trim);
    this.rimTexture = rimT;
    const rimMat = new THREE.MeshStandardMaterial({ map: rimT, roughness: 0.3, metalness: 0.45, alphaTest: 0.5, side: THREE.DoubleSide });
    const discMat = plastic("#8d93a6", 0.35, 0.85);
    const hubMat = plastic("#23263a", 0.5, 0.4);
    const caliperMat = plastic(L.driver === "custodian" ? L.glow : L.trim, 0.3, 0.3);
    const mk = (x: number, z: number, r: number, w: number, front: boolean) => {
      const holder = front ? new THREE.Group() : c;
      const o = front ? new THREE.Vector3() : new THREE.Vector3(x, r, z);
      if (front) {
        holder.position.set(x, r, z);
        c.add(holder);
        this.steerGroups.push(holder);
      }
      add(holder, tyreGeo(r, w), tyreMat, o.x, o.y, o.z).rotation.z = Math.PI / 2;
      // Inside the wheel: a dark well, a drilled disc and the caliper.
      add(holder, cached(`well${r}`, () => new THREE.CylinderGeometry(r * 0.63, r * 0.63, w * 0.6, 24)), hubMat, o.x, o.y, o.z, false).rotation.z = Math.PI / 2;
      for (const sd of [1, -1]) {
        const disc = add(holder, cached(`disc${r}`, () => new THREE.CylinderGeometry(r * 0.5, r * 0.5, 0.03, 28)), discMat, o.x + sd * (w * 0.5 - 0.045), o.y, o.z, false);
        disc.rotation.z = Math.PI / 2;
        add(holder, rbox(0.06, r * 0.34, r * 0.22, 0.02), caliperMat, o.x + sd * (w * 0.5 - 0.075), o.y + r * 0.33, o.z - r * 0.2, false).rotation.x = 0.5;
        const f = add(holder, cached(`rimface${r}`, () => new THREE.CircleGeometry(r * 0.64, 24)), rimMat, o.x + sd * w * 0.5, o.y, o.z, false);
        f.rotation.y = (sd * Math.PI) / 2;
        const lip = add(holder, cached(`lip${r}`, () => new THREE.TorusGeometry(r * 0.64, 0.025, 8, 28)), chromeM, o.x + sd * w * 0.49, o.y, o.z, false);
        lip.rotation.y = Math.PI / 2;
      }
      if (front) mergeChildren(holder, new Set());
    };
    mk(0.92, -0.86, 0.45, 0.46, false);
    mk(-0.92, -0.86, 0.45, 0.46, false);
    mk(0.82, 0.98, 0.36, 0.34, true);
    mk(-0.82, 0.98, 0.36, 0.34, true);

    // Mirrors on stalks, a rubber nose bumper, a red light bar at the back.
    for (const s of [1, -1]) {
      const stalk = add(d, cyl(0.018, 0.018, 0.26, 6), dark, 0.56 * s, 0.86, 0.34, false);
      stalk.rotation.z = 0.9 * s;
      add(c, rbox(0.2, 0.12, 0.06, 0.03), trim, 0.66 * s, 0.94, 0.34);
      add(d, cached("mirror", () => new THREE.PlaneGeometry(0.16, 0.08)), chromeM, 0.66 * s, 0.94, 0.305, false).rotation.y = Math.PI;
    }
    add(c, rbox(1.2, 0.1, 0.12, 0.05), dark, 0, 0.22, 1.64);
    add(c, rbox(0.9, 0.06, 0.05, 0.025), glow("#ff2a3a", 1.8), 0, 0.42, -1.33, false);

    // Whip antenna with a waving pennant in the team colour.
    add(d, cyl(0.014, 0.022, 1.6, 6), dark, -0.62, 1.6, -1.02, false);
    add(d, sphere(0.04, 8, 6), glow(L.glow, 2), -0.62, 2.41, -1.02, false);
    const flagGeo = new THREE.PlaneGeometry(0.78, 0.4, 10, 3).translate(0.39, -0.1, 0);
    const fp = flagGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < fp.count; i++) fp.setY(i, (fp.getY(i) + 0.1) * (1 - fp.getX(i) / 0.95) - 0.1);   // pennant taper
    const flag = new THREE.Mesh(flagGeo, cloth(L.driver === "custodian" ? L.glow : L.trim));
    flag.position.set(-0.62, 2.3, -1.02);
    flag.rotation.y = Math.PI / 2;
    this.body.add(flag);
    this.keepApart.add(flag);
    this.flag = flag;
    this.flagBase = (fp.array as Float32Array).slice();

    if (L.driver === "custodian") {
      // Custodian hardware: spikes on the wings and the nose, spiked rear hubs,
      // and neon strips along the skirts.
      const spikeM = plastic("#3a3850", 0.22, 0.75);
      const cone = cached("kspike", () => new THREE.ConeGeometry(0.06, 0.24, 10).translate(0, 0.12, 0));
      for (const s of [1, -1]) {
        for (const z of [1.24, 1.5]) add(c, cone, spikeM, 0.94 * s, 0.5, z).rotation.z = -0.25 * s;
        for (const z of [-1.14, -1.34, -1.54]) add(c, cone, spikeM, 0.84 * s, 1.42, z).rotation.z = -0.3 * s;
        const hub = add(c, cached("hubspike", () => new THREE.ConeGeometry(0.1, 0.3, 12).translate(0, 0.15, 0)), spikeM, 1.16 * s, 0.45, -0.86);
        hub.rotation.z = -Math.PI / 2 * s;
        add(c, rbox(0.05, 0.05, 1.7, 0.02), glow(L.glow, 2.4), 0.66 * s, 0.24, 0.1, false);
      }
      const horn = add(c, cone, spikeM, 0, 0.5, 1.58);
      horn.rotation.x = Math.PI / 2 - 0.2;
    }
  }

  /**
   * A hang-glider in the team colours: an arched delta canopy on a tube
   * frame, a control bar the driver grabs, and lights on the wingtips that
   * trail streaks through the air.
   */
  private buildGlider() {
    const L = this.look;
    const evil = L.driver === "custodian";
    const g = this.glider;
    g.position.set(0, 2.62, -0.1);
    g.visible = false;
    this.body.add(g);
    this.keepApart.add(g);
    const span = 2.3;
    const canopy = new THREE.Mesh(cached("canopy", () => {
      const geo = new THREE.PlaneGeometry(1, 1, 24, 6);
      const pos = geo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const u = pos.getX(i) * 2;          // −1..1 across the span
        const v = pos.getY(i) + 0.5;        // 0 trailing … 1 leading
        const au = Math.abs(u);
        const le = 1.0 - 1.2 * au, te = -0.9 + 0.15 * au;
        pos.setXYZ(i, u * span, 0.44 * (1 - u * u) + 0.1 * Math.sin(v * Math.PI), te + (le - te) * v);
      }
      geo.computeVertexNormals();
      return geo;
    }), texMat(`glider${L.trim}${evil}`, () => {
      const map = T.gliderTex(evil ? L.glow : L.trim, evil ? L.trim : "#ffffff", evil);
      return new THREE.MeshPhysicalMaterial({
        map, roughness: 0.55, sheen: 0.5, sheenColor: new THREE.Color("#ffffff"), side: THREE.DoubleSide,
        emissive: "#ffffff", emissiveMap: map, emissiveIntensity: 0.28,
      });
    }));
    canopy.castShadow = true;
    g.add(canopy);
    // Frame: leading-edge tubes, keel, control bar.
    const tube = chrome();
    const rod = (a: THREE.Vector3, b: THREE.Vector3, r = 0.028) => {
      const m = new THREE.Mesh(cached(`rod${r}`, () => new THREE.CylinderGeometry(r, r, 1, 8)), tube);
      m.position.copy(a).add(b).multiplyScalar(0.5);
      m.scale.y = a.distanceTo(b);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      g.add(m);
    };
    const nose = new THREE.Vector3(0, 0.5, 1.0);
    for (const s of [1, -1]) {
      const tip = new THREE.Vector3(span * s, 0.02, -0.2);
      rod(nose, tip);
      const light = new THREE.Mesh(sphere(0.07, 10, 8), glow(evil ? L.glow : "#8fe3ff", 3));
      light.position.copy(tip);
      g.add(light);
      this.tips.push(light);
      rod(new THREE.Vector3(0, 0.3, 0), new THREE.Vector3(0.48 * s, -0.92, 0.32), 0.022);
    }
    rod(nose, new THREE.Vector3(0, 0.42, -0.9));
    rod(new THREE.Vector3(0.48, -0.92, 0.32), new THREE.Vector3(-0.48, -0.92, 0.32), 0.03);
    rod(new THREE.Vector3(0, 0.3, -0.3), new THREE.Vector3(0, -1.2, -0.52), 0.035);   // mast down to the seat
  }

  /** World positions of the wingtip lights, for the air trails. */
  gliderTips(): THREE.Object3D[] | null {
    return this.glider.visible && this.gliderK > 0.6 ? this.tips : null;
  }

  /** A member of the Dlicom squad, sitting in the seat. */
  private buildMascotDriver(char: DriverId, evil?: EvilLook) {
    const rig = buildMascot(char, true, evil);
    this.rig = rig;
    this.driver.add(rig.root);
    this.head = rig.head;
    this.armL = rig.armL;
    this.armR = rig.armR;
    for (const k of rig.keep) this.keepApart.add(k);
    // Arms and head are posed every frame, so each merges on its own.
    for (const g of [rig.armL, rig.armR]) mergeChildren(g, new Set());
    mergeChildren(rig.root, this.keepApart);
  }

  /** Pose everything for this frame. */
  update(p: KartPose, dt: number) {
    // Suspension: a damped spring that bumps rise through, plus road buzz.
    const k = 140, damp = 12;
    this.bobV += (-k * this.bob - damp * this.bobV) * dt;
    this.bob += this.bobV * dt;
    const buzz = Math.sin(p.time * 38) * 0.012 * Math.min(1, p.speed / 20);

    this.body.position.y = p.hop + this.bob + buzz;
    this.body.rotation.set(0, 0, 0);
    this.body.rotation.y = -p.slide + p.roll;
    this.body.rotation.z = p.steer * 0.07 + p.flip;          // lean into the turn
    this.body.rotation.x = -Math.min(0.06, p.boost * 0.06) - (p.pitch ?? 0);  // nose lifts under boost and on take-off

    // Glider: springs open once properly airborne, folds away on landing.
    const want = p.glide > 0.55 ? 1 : 0;
    this.gliderV += ((want - this.gliderK) * (want ? 90 : 160) - this.gliderV * (want ? 9 : 18)) * dt;
    this.gliderK = Math.max(0, this.gliderK + this.gliderV * dt);
    const gk = this.gliderK;
    this.glider.visible = gk > 0.02;
    if (this.glider.visible) {
      this.glider.scale.set(gk, Math.min(1, gk * 1.4), Math.min(1.2, 0.4 + gk * 0.6));
      this.glider.rotation.set(-0.2 + Math.sin(p.time * 1.7) * 0.04, 0, -p.steer * 0.22 + Math.sin(p.time * 2.3) * 0.05);
    }
    this.body.scale.set(1 / Math.sqrt(p.squash), p.squash, 1 / Math.sqrt(p.squash));

    if (this.rimTexture) this.rimTexture.rotation -= (p.speed / 0.45) * dt;
    if (this.tyreTexture) this.tyreTexture.offset.x -= (p.speed / (Math.PI * 2 * 0.45)) * dt;
    for (const g of this.steerGroups) g.rotation.y = -p.steer * 0.38;

    const f = p.boost;
    this.flames.forEach((fl, i) => {
      fl.visible = f > 0.02;
      if (fl.visible) {
        const flick = 0.75 + Math.sin(p.time * 60 + i * 2) * 0.15 + Math.random() * 0.2;
        fl.scale.set(0.8 + f * 0.5, 0.8 + f * 0.5, f * flick * 1.6);
      }
    });
    for (const g of this.exhaustGlow) g.scale.setScalar(1 + f * 0.8);

    // The pennant streams back and flutters harder with speed.
    if (this.flag && this.flagBase) {
      const a = this.flag.geometry.attributes.position as THREE.BufferAttribute;
      const b = this.flagBase;
      const arr = a.array as Float32Array;
      const sp = Math.min(1.3, 0.25 + p.speed / 26);
      for (let i = 0; i < arr.length; i += 3) {
        const x = b[i];
        arr[i + 2] = Math.sin(p.time * 14 * sp - x * 11) * 0.07 * x * 3 * sp;
        arr[i + 1] = b[i + 1] - x * x * 0.4 * (1.3 - sp);
      }
      a.needsUpdate = true;
    }

    // Head leans into the turn and looks where it's going.
    this.head.rotation.z = -p.steer * 0.12;
    this.head.rotation.y = -p.steer * 0.25 + (p.look?.yaw ?? 0);
    this.head.rotation.x = p.look?.nod ?? 0;

    // Arms hang along -Y from the shoulder. X pitch swings them forward and
    // up; Z swings them in toward the wheel or out to the side. Driving:
    // both hands on the wheel. Waving: the right arm goes up and waves.
    // Cheering (wave > 1): both arms up.
    for (const [arm, s] of [[this.armL, 1], [this.armR, -1]] as const) {
      const w = Math.min(1, s < 0 ? p.wave : Math.max(0, p.wave - 1));
      const wiggle = w > 0 ? Math.sin(p.time * 11 + (s > 0 ? 1.4 : 0)) * 0.32 * w : 0;
      arm.rotation.x = -1.02 + p.steer * 0.14 * s + (-2.55 + 1.02) * w;
      arm.rotation.z = (-0.22 + 0.95 * w) * s + wiggle;
      // Hanging on to the glider's bar.
      const hang = Math.min(1, this.gliderK);
      if (hang > 0) {
        arm.rotation.x += (-2.45 - arm.rotation.x) * hang;
        arm.rotation.z += (0.12 * s - arm.rotation.z) * hang;
      }
    }

    if (this.rig) {
      animateCape(this.rig, p.time, Math.min(1.25, 0.2 + p.speed / 26), p.glide);
      blink(this.rig, p.time);
    }
  }

  /** Called on landings and bumps: kick the suspension. */
  thump(v: number) {
    this.bobV -= v;
  }
}

/** Merge a group's direct mesh children, one mesh per material. */
function mergeChildren(group: THREE.Object3D, skip: Set<THREE.Object3D>, shadows = true) {
  const buckets = new Map<THREE.Material, { geos: THREE.BufferGeometry[]; shadow: boolean }>();
  const drop: THREE.Object3D[] = [];
  for (const c of group.children) {
    const m = c as THREE.Mesh;
    if (!m.isMesh || skip.has(m) || Array.isArray(m.material)) continue;
    m.updateMatrix();
    let g = m.geometry.clone().applyMatrix4(m.matrix);
    for (const name of Object.keys(g.attributes)) {
      if (!["position", "normal", "uv"].includes(name)) g.deleteAttribute(name);
    }
    if (g.index) g = g.toNonIndexed();
    const b = buckets.get(m.material) ?? { geos: [], shadow: false };
    b.geos.push(g);
    b.shadow ||= m.castShadow;
    buckets.set(m.material, b);
    drop.push(m);
  }
  for (const d of drop) group.remove(d);
  for (const [mat, b] of buckets) {
    const merged = mergeGeometries(b.geos, false);
    b.geos.forEach((g) => g.dispose());
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = shadows && b.shadow;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
}

/** A rounded tyre profile, revolved. */
function tyreGeo(r: number, w: number) {
  return cached(`tyre${r},${w}`, () => {
    const pts: THREE.Vector2[] = [];
    const hw = w / 2, bev = Math.min(0.11, r * 0.28);
    const inner = r * 0.6;
    pts.push(new THREE.Vector2(inner, -hw));
    for (let i = 0; i <= 6; i++) {
      const a = -Math.PI / 2 + (i / 6) * (Math.PI / 2);
      pts.push(new THREE.Vector2(r - bev + Math.cos(a) * bev, -hw + bev + Math.sin(a) * bev));
    }
    for (let i = 0; i <= 6; i++) {
      const a = (i / 6) * (Math.PI / 2);
      pts.push(new THREE.Vector2(r - bev + Math.cos(a) * bev, hw - bev + Math.sin(a) * bev));
    }
    pts.push(new THREE.Vector2(inner, hw));
    return new THREE.LatheGeometry(pts, 32);
  });
}

/* ------------------------------------------------------------------ */
/* Pickups and track furniture                                         */
/* ------------------------------------------------------------------ */

export const COIN_R: Record<T.CoinKind, number> = { dli: 0.62, eth: 0.72, btc: 0.84 };

/** A real coin: bevelled rim and two printed faces. One geometry per kind. */
export function coinGeometry(kind: T.CoinKind) {
  return cached(`coin${kind}`, () => {
    const R = COIN_R[kind];
    const h = R * 0.22;
    const prof = [
      new THREE.Vector2(R * 0.84, -h / 2), new THREE.Vector2(R * 0.97, -h * 0.42),
      new THREE.Vector2(R, -h * 0.2), new THREE.Vector2(R, h * 0.2),
      new THREE.Vector2(R * 0.97, h * 0.42), new THREE.Vector2(R * 0.84, h / 2),
    ];
    const rim = new THREE.LatheGeometry(prof, 36).rotateX(Math.PI / 2);
    const front = new THREE.CircleGeometry(R * 0.86, 36).translate(0, 0, h / 2);
    const back = new THREE.CircleGeometry(R * 0.86, 36).rotateY(Math.PI).translate(0, 0, -h / 2);
    const merged = mergeWithGroups([rim, front, back]);
    return merged;
  });
}

export function coinMaterials(kind: T.CoinKind): THREE.Material[] {
  const rimCol = kind === "eth" ? "#b9a6ff" : kind === "btc" ? "#ffaa2b" : "#ffc933";
  const emi = kind === "eth" ? "#3b2a9a" : "#7a4200";
  const face = T.coinFaceTex(kind);
  return [
    new THREE.MeshStandardMaterial({ color: rimCol, metalness: 0.85, roughness: 0.22, emissive: emi, emissiveIntensity: 0.55 }),
    new THREE.MeshStandardMaterial({ map: face, metalness: 0.45, roughness: 0.3, emissive: "#ffffff", emissiveMap: face, emissiveIntensity: 0.32 }),
  ];
}

/** Concatenate geometries, one draw group each: rim → material 0, faces → material 1. */
function mergeWithGroups(geos: THREE.BufferGeometry[]) {
  const nonIndexed = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  let count = 0;
  for (const g of nonIndexed) count += g.attributes.position.count;
  const pos = new Float32Array(count * 3);
  const nrm = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  const out = new THREE.BufferGeometry();
  let o = 0;
  nonIndexed.forEach((g, gi) => {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array as Float32Array, o * 3);
    nrm.set(g.attributes.normal.array as Float32Array, o * 3);
    uv.set(g.attributes.uv.array as Float32Array, o * 2);
    out.addGroup(o, n, gi === 0 ? 0 : 1);
    o += n;
  });
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
  out.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return out;
}

/** Additive glow sprite, for lamps and energy that should read from far away. */
function haloSprite(color: string, size: number, opacity = 0.9) {
  const mat = texMat(`halo${color}${opacity}`, () => new THREE.SpriteMaterial({
    map: T.blobTex("rgba(255,255,255,1)", "rgba(255,255,255,0)"), color, transparent: true, opacity,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  }));
  const s = new THREE.Sprite(mat as THREE.SpriteMaterial);
  s.scale.setScalar(size);
  return s;
}

/**
 * Item box: a thick iridescent glass cube with glossy bevelled edges, an
 * embossed "?" on every face, a golden gem spinning inside, glints orbiting
 * it and a pool of coloured light on the road below. The game cycles its
 * colours and spins the parts against each other.
 */
export function itemBox(face: THREE.Texture, spark: THREE.Texture) {
  const g = new THREE.Group();
  const shellGeo = rbox(1.5, 1.5, 1.5, 0.3);
  // The glass: a front shell, plus a dimmer back shell that gives it depth.
  const cube = new THREE.Mesh(shellGeo, new THREE.MeshPhysicalMaterial({
    color: "#9fd0ff", transparent: true, opacity: 0.5, roughness: 0.04, metalness: 0.1,
    iridescence: 0.8, iridescenceIOR: 1.9, iridescenceThicknessRange: [180, 950],
    clearcoat: 1, clearcoatRoughness: 0.02, emissive: "#3f7dff", emissiveIntensity: 0.55,
    depthWrite: false, side: THREE.FrontSide,
  }));
  cube.renderOrder = 4;
  g.add(cube);
  const inner = new THREE.Mesh(shellGeo, new THREE.MeshBasicMaterial({
    color: "#6f9bff", transparent: true, opacity: 0.22, depthWrite: false, side: THREE.BackSide,
    blending: THREE.AdditiveBlending, toneMapped: false,
  }));
  inner.renderOrder = 2;
  cube.add(inner);
  // "?" decals, one per face, just proud of the glass.
  const decal = new THREE.Mesh(cached("boxDecal", () => new THREE.BoxGeometry(1.51, 1.51, 1.51)), texMat("boxFace", () => new THREE.MeshBasicMaterial({
    map: face, transparent: true, depthWrite: false, toneMapped: false, side: THREE.FrontSide,
  })));
  decal.renderOrder = 5;
  cube.add(decal);
  // Glossy bevelled edges and corner studs, riding on the cube as it tumbles.
  const frameMat = new THREE.MeshPhysicalMaterial({
    color: "#c9d6ff", emissive: "#7fb4ff", emissiveIntensity: 1.9, roughness: 0.18, metalness: 0.2,
    clearcoat: 1, clearcoatRoughness: 0.05,
  });
  const frame = new THREE.Mesh(cached("boxFrame2", () => {
    const parts: THREE.BufferGeometry[] = [];
    const e = 0.69;
    for (const [a, b] of [[e, e], [e, -e], [-e, e], [-e, -e]]) {
      parts.push(new THREE.CapsuleGeometry(0.075, 1.24, 4, 10).translate(a, 0, b));
      parts.push(new THREE.CapsuleGeometry(0.075, 1.24, 4, 10).rotateZ(Math.PI / 2).translate(0, a, b));
      parts.push(new THREE.CapsuleGeometry(0.075, 1.24, 4, 10).rotateX(Math.PI / 2).translate(a, b, 0));
    }
    for (const x of [e, -e]) for (const y of [e, -e]) for (const z of [e, -e]) parts.push(new THREE.SphereGeometry(0.14, 14, 10).translate(x, y, z));
    return mergeGeometries(parts)!;
  }), frameMat);
  frame.renderOrder = 6;
  cube.add(frame);
  // A golden gem turning the other way inside.
  const core = new THREE.Mesh(cached("boxGem", () => new THREE.OctahedronGeometry(0.34, 0).scale(1, 1.35, 1)), texMat("boxGem", () => new THREE.MeshPhysicalMaterial({
    color: "#ffd84a", emissive: "#ff9d00", emissiveIntensity: 1.1, roughness: 0.12, metalness: 0.6,
    clearcoat: 1, flatShading: true,
  })));
  core.renderOrder = 3;
  g.add(core);
  const halo = haloSprite("#9fc8ff", 3.8, 0.4);
  halo.renderOrder = 1;
  g.add(halo);
  // Glints orbiting the box.
  const orbit = new THREE.Group();
  const sparkMat = texMat("boxSpark", () => new THREE.SpriteMaterial({
    map: spark, color: "#ffffff", transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  }));
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    const s = new THREE.Sprite(sparkMat as THREE.SpriteMaterial);
    s.position.set(Math.cos(a) * 1.35, Math.sin(a * 2) * 0.55, Math.sin(a) * 1.35);
    s.scale.setScalar(0.5);
    s.userData.k = k;
    orbit.add(s);
  }
  g.add(orbit);
  // Coloured light pooled on the road under the box.
  const poolBase = texMat("boxPool", () => new THREE.MeshBasicMaterial({
    map: T.blobTex("rgba(255,255,255,1)", "rgba(255,255,255,0)"), color: "#7fb4ff", transparent: true, opacity: 0.55,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  }));
  // Own copy of the material (sharing the texture) so each box tints its own pool.
  const pool = new THREE.Mesh(cached("boxPool", () => new THREE.PlaneGeometry(3.4, 3.4).rotateX(-Math.PI / 2)), poolBase.clone());
  pool.position.y = -1.25;
  g.add(pool);
  g.userData.cube = cube;
  g.userData.frame = frameMat;
  g.userData.inner = inner.material;
  g.userData.core = core;
  g.userData.orbit = orbit;
  g.userData.pool = pool;
  return g;
}

/**
 * Coin Magnet field: two counter-spinning rings of red and white light and
 * a faint dome, around the player while the magnet is on.
 */
export function magnetAura() {
  const g = new THREE.Group();
  const ringMat = (color: string, o: number) => new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  });
  const a = new THREE.Mesh(cached("magRingA", () => new THREE.TorusGeometry(1.9, 0.045, 8, 64)), ringMat("#ff3d5a", 0.95));
  const b = new THREE.Mesh(cached("magRingB", () => new THREE.TorusGeometry(2.15, 0.03, 8, 64)), ringMat("#ffffff", 0.7));
  a.rotation.x = Math.PI / 2;
  b.rotation.x = Math.PI / 2;
  g.add(a, b);
  // Dashed field lines: short arcs that sweep round.
  const dash = new THREE.Group();
  for (let k = 0; k < 6; k++) {
    const m = new THREE.Mesh(cached("magDash", () => new THREE.TorusGeometry(2.45, 0.05, 6, 12, Math.PI / 7)), ringMat(k % 2 ? "#ff8a9a" : "#ffd84a", 0.9));
    m.rotation.set(Math.PI / 2, 0, (k / 6) * Math.PI * 2);
    dash.add(m);
  }
  g.add(dash);
  g.add(haloSprite("#ff3d5a", 4.2, 0.28));
  g.position.y = 0.7;
  g.userData.a = a;
  g.userData.b = b;
  g.userData.dash = dash;
  return g;
}

/** Boost pad: glowing chevrons that scroll forward, between lit metal rails. */
export function boostPad(chev: THREE.Texture, frame: THREE.Texture) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(
    cached("padBase", () => new THREE.PlaneGeometry(3.4, 5.2).rotateX(-Math.PI / 2)),
    new THREE.MeshStandardMaterial({ map: frame, roughness: 0.5, transparent: true, polygonOffset: true, polygonOffsetFactor: -1 }),
  );
  base.receiveShadow = true;
  g.add(base);
  const c = chev.clone();
  c.repeat.set(1, 2);
  c.needsUpdate = true;
  const panel = new THREE.Mesh(
    cached("padPanel", () => new THREE.PlaneGeometry(2.7, 4.4).rotateX(-Math.PI / 2)),
    new THREE.MeshBasicMaterial({ map: c, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2 }),
  );
  panel.position.y = 0.01;
  g.add(panel);
  // Side rails with light strips, and bolted end caps.
  const rail = plastic("#262b40", 0.3, 0.7);
  for (const sx of [1, -1]) {
    add(g, rbox(0.3, 0.16, 5.3, 0.07), rail, sx * 1.74, 0.08, 0);
    add(g, rbox(0.1, 0.05, 4.9, 0.025), glow("#ffb300", 2.4), sx * 1.74, 0.17, 0, false);
    for (const sz of [1, -1]) add(g, cyl(0.07, 0.07, 0.05, 10), chrome(), sx * 1.74, 0.17, sz * 2.52, false);
  }
  add(g, rbox(3.2, 0.1, 0.22, 0.05), rail, 0, 0.05, 2.62);
  add(g, rbox(3.2, 0.1, 0.22, 0.05), rail, 0, 0.05, -2.62);
  g.userData.chev = c;
  return g;
}

/**
 * Heavy-duty track bollard: bolted steel plinth, striped sleeve with
 * reflective bands, a warning plate, and a caged amber beacon that blinks.
 */
export function bollard(stripes: THREE.Texture) {
  const g = new THREE.Group();
  const steel = plastic("#2a3048", 0.32, 0.65);
  add(g, cyl(0.6, 0.7, 0.22, 8), steel, 0, 0.11, 0);
  add(g, cyl(0.5, 0.58, 0.08, 8), plastic("#1a1e2e", 0.5, 0.4), 0, 0.26, 0);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    add(g, cyl(0.06, 0.06, 0.06, 8), chrome(), Math.cos(a) * 0.5, 0.25, Math.sin(a) * 0.5, false);
  }
  const sleeve = texMat("bollardSleeve", () => new THREE.MeshPhysicalMaterial({ map: stripes, roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.2 }));
  add(g, cyl(0.33, 0.37, 1.24, 24), sleeve, 0, 0.92, 0);
  const reflect = texMat("reflect", () => new THREE.MeshStandardMaterial({ color: "#f2f6ff", roughness: 0.25, metalness: 0.3, emissive: "#c8d8ff", emissiveIntensity: 0.35 }));
  add(g, cyl(0.352, 0.36, 0.07, 24), reflect, 0, 0.62, 0, false);
  add(g, cyl(0.338, 0.345, 0.07, 24), reflect, 0, 1.22, 0, false);
  // Warning plate on the side facing oncoming karts.
  const warn = texMat("warnPlate", () => new THREE.MeshStandardMaterial({ map: T.warnTex(), roughness: 0.4, emissive: "#ffffff", emissiveMap: T.warnTex(), emissiveIntensity: 0.25 }));
  const plate = add(g, rbox(0.42, 0.42, 0.05, 0.04), warn, 0, 0.92, -0.37, false);
  plate.rotation.y = Math.PI;
  // Beacon: collar, lens, cage and glow.
  add(g, cyl(0.26, 0.33, 0.12, 20), steel, 0, 1.6, 0);
  const lamp = new THREE.Group();
  lamp.position.y = 1.78;
  add(lamp, sphere(0.22, 18, 12), glow("#ffae00", 3), 0, 0, 0, false).scale.y = 1.15;
  const halo = haloSprite("#ffb040", 1.9, 0.75);
  lamp.add(halo);
  g.add(lamp);
  add(g, torus(0.25, 0.025), steel, 0, 1.78, 0, false).rotation.x = Math.PI / 2;
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2;
    add(g, cyl(0.022, 0.022, 0.44, 6), steel, Math.cos(a) * 0.25, 1.86, Math.sin(a) * 0.25, false);
  }
  add(g, cyl(0.12, 0.27, 0.08, 16), steel, 0, 2.09, 0);
  g.userData.lamp = lamp;
  return g;
}

/** Traffic cone: moulded base, two reflective collars, a darker tip. */
export function cone() {
  const g = new THREE.Group();
  const orange = texMat("coneBody", () => new THREE.MeshPhysicalMaterial({ color: "#ff6f12", roughness: 0.32, clearcoat: 0.6, clearcoatRoughness: 0.25 }));
  add(g, rbox(0.95, 0.1, 0.95, 0.05), orange, 0, 0.05, 0);
  add(g, cyl(0.4, 0.44, 0.06, 24), plastic("#e5580a", 0.4), 0, 0.12, 0);
  // Slightly concave sides, lathed.
  add(g, cached("coneLathe", () => {
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      pts.push(new THREE.Vector2(0.37 - 0.31 * t + Math.sin(t * Math.PI) * 0.018, 0.12 + t * 1.02));
    }
    pts.push(new THREE.Vector2(0.03, 1.16), new THREE.Vector2(0, 1.17));
    return new THREE.LatheGeometry(pts, 28);
  }), orange, 0, 0, 0);
  const r = (y: number) => 0.37 - 0.31 * ((y - 0.12) / 1.02) + 0.012;
  const band = texMat("coneBand", () => new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.2, metalness: 0.3, emissive: "#dde8ff", emissiveIntensity: 0.4 }));
  add(g, cached("coneBandA", () => new THREE.CylinderGeometry(r(0.62), r(0.46), 0.16, 28, 1, true).translate(0, 0.54, 0)), band, 0, 0, 0, false);
  add(g, cached("coneBandB", () => new THREE.CylinderGeometry(r(0.9), r(0.8), 0.1, 28, 1, true).translate(0, 0.85, 0)), band, 0, 0, 0, false);
  add(g, sphere(0.045, 10, 8), plastic("#c24400", 0.4), 0, 1.16, 0, false);
  return g;
}

/**
 * Custodian drone: a glossy dark pod with one big angry eye, four ducted
 * rotors, an antenna, and a red scanner beam sweeping the road below.
 */
export function drone() {
  const g = new THREE.Group();
  // Dark, villainous gloss: no rim light, little environment reflection.
  const shell = texMat("droneShell", () => new THREE.MeshPhysicalMaterial({
    color: "#231c38", roughness: 0.28, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.1, envMapIntensity: 0.45,
  }));
  const metal = plastic("#1b1726", 0.35, 0.6);
  const body = add(g, sphere(0.85, 32, 20), shell, 0, 0, 0);
  body.scale.set(1, 0.8, 1);
  add(g, torus(0.86, 0.045), metal, 0, 0, 0, false).rotation.x = Math.PI / 2;
  // The eye: dark socket, glowing iris ring, hot core, and an angry brow.
  const socket = add(g, cyl(0.4, 0.44, 0.16, 28), metal, 0, 0.05, 0.62);
  socket.rotation.x = Math.PI / 2;
  add(g, cyl(0.34, 0.34, 0.02, 28), glow("#3a0c2e", 0.6), 0, 0.05, 0.71, false).rotation.x = Math.PI / 2;
  add(g, torus(0.24, 0.055), glow("#ff3fd8", 3.2), 0, 0.05, 0.72, false);
  add(g, sphere(0.13, 16, 12), glow("#ffd6f6", 4), 0, 0.05, 0.73, false);
  const eyeHalo = haloSprite("#ff4fd8", 1.3, 0.6);
  eyeHalo.position.set(0, 0.05, 0.8);
  g.add(eyeHalo);
  const brow = add(g, rbox(0.72, 0.12, 0.2, 0.05), plastic("#9b3fff", 0.3), 0, 0.36, 0.64, false);
  brow.rotation.x = -0.35;
  // Antenna with a blinking tip.
  add(g, cyl(0.025, 0.035, 0.5, 6), metal, 0, 0.88, -0.1, false);
  const tip = add(g, sphere(0.07, 10, 8), glow("#ff2d55", 3.2), 0, 1.15, -0.1, false);
  // Four ducted rotors on arms.
  const rotors: THREE.Object3D[] = [];
  const bladeMat = plastic("#d8dcef", 0.3, 0.4);
  const blur = texMat("rotorBlur", () => new THREE.MeshBasicMaterial({ color: "#c9b8ff", transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }));
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    const x = Math.cos(a) * 1.05, z = Math.sin(a) * 1.05;
    const arm = add(g, capsule(0.06, 0.6), metal, x * 0.62, 0.12, z * 0.62, false);
    arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(Math.cos(a), 0, Math.sin(a)));
    add(g, torus(0.38, 0.05), plastic("#9b3fff", 0.3), x, 0.18, z, false).rotation.x = Math.PI / 2;
    add(g, cyl(0.07, 0.07, 0.12, 10), metal, x, 0.18, z, false);
    const rotor = new THREE.Group();
    rotor.position.set(x, 0.22, z);
    add(rotor, rbox(0.7, 0.02, 0.1, 0.01), bladeMat, 0, 0, 0, false);
    add(rotor, rbox(0.1, 0.02, 0.7, 0.01), bladeMat, 0, 0, 0, false);
    const disc = new THREE.Mesh(cached("rotorDisc", () => new THREE.CircleGeometry(0.34, 24).rotateX(-Math.PI / 2)), blur);
    rotor.add(disc);
    g.add(rotor);
    rotors.push(rotor);
  }
  // Side fins.
  for (const s of [1, -1]) {
    const fin = add(g, rbox(0.12, 0.62, 0.52, 0.05), plastic("#9b3fff", 0.3), 0.86 * s, -0.08, -0.25);
    fin.rotation.z = 0.35 * s;
  }
  // Thruster and scanner beam.
  const jet = add(g, cyl(0.24, 0.14, 0.26, 16), metal, 0, -0.72, 0, false);
  jet.rotation.x = Math.PI;
  add(g, cyl(0.16, 0.16, 0.03, 16), glow("#ff4fe0", 3), 0, -0.86, 0, false);
  const beam = new THREE.Mesh(
    cached("droneBeam", () => new THREE.ConeGeometry(1.25, 1.15, 28, 1, true).translate(0, -0.8 - 0.575, 0)),
    texMat("droneBeamMat", () => new THREE.MeshBasicMaterial({
      color: "#ff2d55", transparent: true, opacity: 0.13, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    })),
  );
  g.add(beam);
  g.userData.rotors = rotors;
  g.userData.tip = tip;
  return g;
}

/**
 * Custodian goo: a glossy raised puddle with bubbles that swell and pop,
 * a few splashes around it, and a faint purple glow so you see it coming.
 */
export function goo() {
  const g = new THREE.Group();
  const mat = texMat("gooMat", () => new THREE.MeshPhysicalMaterial({
    color: "#6a22d0", roughness: 0.1, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.04,
    emissive: "#3a0a90", emissiveIntensity: 0.55,
  }));
  const puddle = new THREE.Mesh(cached("gooBlob", () => {
    const rings = 7, segs = 44, H = 0.16;
    const edge = (a: number) => 1.3 + Math.sin(a * 5) * 0.22 + Math.sin(a * 3 + 1) * 0.15;
    const pos: number[] = [0, H, 0];
    const idx: number[] = [];
    for (let i = 1; i <= rings; i++) {
      const t = i / rings;
      for (let j = 0; j < segs; j++) {
        const a = (j / segs) * Math.PI * 2;
        const r = edge(a) * t;
        const h = H * Math.pow(Math.max(0, 1 - t * t), 0.55) + Math.sin(a * 7 + t * 5) * 0.012 * (1 - t);
        pos.push(Math.cos(a) * r, Math.max(0.004, h), Math.sin(a) * r);
      }
    }
    const at = (i: number, j: number) => 1 + (i - 1) * segs + (j % segs);
    for (let j = 0; j < segs; j++) idx.push(0, at(1, j + 1), at(1, j));
    for (let i = 1; i < rings; i++) {
      for (let j = 0; j < segs; j++) {
        const i0 = at(i, j), i1 = at(i, j + 1), o0 = at(i + 1, j), o1 = at(i + 1, j + 1);
        idx.push(i0, i1, o1, i0, o1, o0);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  }), mat);
  puddle.position.y = 0.02;
  puddle.receiveShadow = true;
  g.add(puddle);
  // Bubbles that grow and pop (animated by the race).
  const bubbleMat = texMat("gooBubble", () => new THREE.MeshPhysicalMaterial({
    color: "#b27dff", roughness: 0.05, clearcoat: 1, transparent: true, opacity: 0.85, emissive: "#5a1fb0", emissiveIntensity: 0.6,
  }));
  const bubbles: THREE.Mesh[] = [];
  for (let i = 0; i < 6; i++) {
    const a = i * 2.4, r = 0.25 + (i % 3) * 0.28;
    const b = add(g, sphere(0.2, 16, 12), bubbleMat, Math.cos(a) * r, 0.14, Math.sin(a) * r, false);
    b.userData.phase = i * 0.37;
    bubbles.push(b);
  }
  // Splashes around the edge.
  for (let i = 0; i < 7; i++) {
    const a = i * 0.9 + 0.3, r = 1.55 + (i % 3) * 0.18;
    const d = add(g, sphere(0.12 + (i % 2) * 0.05, 10, 8), mat, Math.cos(a) * r, 0.02, Math.sin(a) * r, false);
    d.scale.y = 0.35;
  }
  const glowDisc = new THREE.Mesh(
    cached("gooGlow", () => new THREE.PlaneGeometry(4.2, 4.2).rotateX(-Math.PI / 2)),
    texMat("gooGlowMat", () => new THREE.MeshBasicMaterial({
      map: T.blobTex("rgba(170,90,255,.55)", "rgba(170,90,255,0)"), transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2,
    })),
  );
  glowDisc.position.y = 0.01;
  g.add(glowDisc);
  g.userData.bubbles = bubbles;
  return g;
}

/**
 * Freeze orb: a spiked crystal core burning red, two energy rings, a
 * fresnel shell and a glow that trails sparks.
 */
export function orb() {
  const g = new THREE.Group();
  const core = new THREE.Mesh(
    cached("orbCore", () => new THREE.IcosahedronGeometry(0.4, 1)),
    texMat("orbCoreMat", () => new THREE.MeshStandardMaterial({ color: "#000000", emissive: "#ff2a4a", emissiveIntensity: 3.2, flatShading: true })),
  );
  g.add(core);
  const spikes = new THREE.Mesh(cached("orbSpikes", () => {
    const parts: THREE.BufferGeometry[] = [];
    const ico = new THREE.IcosahedronGeometry(1, 0);
    const p = ico.attributes.position as THREE.BufferAttribute;
    const seen = new Set<string>();
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < p.count; i++) {
      const d = new THREE.Vector3().fromBufferAttribute(p, i).normalize();
      const key = d.toArray().map((v) => v.toFixed(2)).join();
      if (seen.has(key)) continue;
      seen.add(key);
      const c = new THREE.ConeGeometry(0.08, 0.34, 8).translate(0, 0.17, 0);
      c.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, d));
      c.translate(d.x * 0.38, d.y * 0.38, d.z * 0.38);
      parts.push(c);
    }
    return mergeGeometries(parts)!;
  }), plastic("#3a2a44", 0.25, 0.7));
  g.add(spikes);
  const ringMat = glow("#ff6a7e", 2.8);
  const r1 = add(g, torus(0.66, 0.03), ringMat, 0, 0, 0, false);
  r1.rotation.set(0.6, 0, 0.3);
  const r2 = add(g, torus(0.72, 0.025), ringMat, 0, 0, 0, false);
  r2.rotation.set(-0.7, 0, -0.5);
  const shell = new THREE.Mesh(sphere(0.78, 24, 16), texMat("orbShell", () => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: new THREE.Color("#ff4a64") } },
    vertexShader: `varying vec3 vN; varying vec3 vV;
      void main(){ vec4 mv = modelViewMatrix * vec4(position,1.); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uColor; varying vec3 vN; varying vec3 vV;
      void main(){ float f = pow(1. - abs(dot(vN, vV)), 2.); gl_FragColor = vec4(uColor * (0.15 + f * 1.6), f * .9 + .08); }`,
  })));
  g.add(shell);
  g.add(haloSprite("#ff3050", 3.2, 0.7));
  return g;
}

/** Shield bubble around the player. */
export function shieldBubble() {
  const m = new THREE.Mesh(sphere(1.9, 32, 20), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color("#5ec8ff") } },
    vertexShader: `
      varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position,1.);
        vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); vP = position;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform float uTime; uniform vec3 uColor;
      varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){
        float f = pow(1. - abs(dot(vN, vV)), 2.2);
        float hex = .5 + .5 * sin(vP.y * 9. + uTime * 4.) * sin(vP.x * 9. - uTime * 3.);
        gl_FragColor = vec4(uColor * (f * 1.4 + hex * .08), f * .9 + .05);
      }`,
  }));
  m.position.y = 1.1;
  return m;
}

/* ------------------------------------------------------------------ */
/* Scenery                                                             */
/* ------------------------------------------------------------------ */

/** Puffy cartoon cloud: a cluster of squashed spheres. */
export function cloud(seed: number) {
  const g = new THREE.Group();
  // Dusk clouds: lit warm pink from the low sun.
  const mat = new THREE.MeshStandardMaterial({ color: "#ffe6f0", roughness: 1, emissive: "#ff9a86", emissiveIntensity: 0.32 });
  const r = (i: number) => {
    const x = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453;
    return x - Math.floor(x);
  };
  const n = 5 + Math.floor(r(0) * 4);
  for (let i = 0; i < n; i++) {
    const s = 9 + r(i + 1) * 12;
    const m = add(g, sphere(1, 18, 12), mat, (i - n / 2) * 11 + r(i + 7) * 6, r(i + 3) * 6, r(i + 5) * 10 - 5, false);
    m.scale.set(s * 1.2, s * 0.8, s);
  }
  return g;
}

/** Lollipop tree. */
export function tree(variant: number) {
  const g = new THREE.Group();
  add(g, cyl(0.32, 0.42, 3.2, 10), plastic("#8a5a36", 0.7), 0, 1.6, 0);
  const cols = ["#3fbf4a", "#58d15a", "#2fae5a", "#7bd84a"];
  const leaf = plastic(cols[variant % cols.length], 0.6);
  const top = add(g, sphere(2.4, 18, 12), leaf, 0, 4.6, 0);
  top.scale.set(1, 1.08, 1);
  add(g, sphere(1.5, 14, 10), leaf, 1.4, 3.8, 0.6);
  add(g, sphere(1.3, 14, 10), leaf, -1.3, 4.0, -0.5);
  return g;
}

/** Round bush. */
export function bush(variant: number) {
  const g = new THREE.Group();
  const leaf = plastic(["#46c24a", "#5cd65a", "#39b04c"][variant % 3], 0.65);
  add(g, sphere(1.3, 14, 10), leaf, 0, 0.8, 0);
  add(g, sphere(0.9, 12, 8), leaf, 1.0, 0.6, 0.3);
  add(g, sphere(0.85, 12, 8), leaf, -0.9, 0.55, -0.2);
  if (variant % 2 === 0) {
    for (let i = 0; i < 4; i++) {
      add(g, sphere(0.16, 8, 6), plastic(["#ff5c8a", "#ffd24d", "#ffffff"][i % 3], 0.5), Math.cos(i * 1.6) * 1.1, 1.3 + (i % 2) * 0.4, Math.sin(i * 1.6) * 0.9, false);
    }
  }
  return g;
}

/** A floating balloon cluster. */
export function balloons(seed: number) {
  const g = new THREE.Group();
  const cols = ["#ff4d6d", "#ffd24d", "#4dd2ff", "#7dff8a", "#b18bff", "#2f6bff"];
  for (let i = 0; i < 5; i++) {
    const b = add(g, sphere(1, 16, 12), plastic(cols[(seed + i) % cols.length], 0.2), Math.cos(i * 1.3) * 1.4, 6 + (i % 3) * 1.2, Math.sin(i * 1.3) * 1.2, false);
    b.scale.set(0.9, 1.1, 0.9);
  }
  return g;
}

/** Stripe of little triangular flags between two points. */
export function bunting(a: THREE.Vector3, b: THREE.Vector3, sag: number) {
  const g = new THREE.Group();
  const cols = ["#ff4d6d", "#ffd24d", "#4dd2ff", "#ffffff", "#2f6bff", "#7dff8a"];
  const n = Math.max(6, Math.round(a.distanceTo(b) / 1.3));
  const flagGeo = cached("flag", () => {
    const s = new THREE.Shape();
    s.moveTo(-0.45, 0);
    s.lineTo(0.45, 0);
    s.lineTo(0, -0.95);
    s.closePath();
    return new THREE.ShapeGeometry(s);
  });
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = new THREE.Vector3().lerpVectors(a, b, t);
    p.y -= Math.sin(t * Math.PI) * sag;
    pts.push(p);
  }
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color: "#ffffff" }),
  );
  g.add(line);
  const dir = new THREE.Vector3().subVectors(b, a).normalize();
  const yaw = Math.atan2(dir.x, dir.z) - Math.PI / 2;
  for (let i = 0; i < n; i++) {
    const p = pts[i].clone().lerp(pts[i + 1], 0.5);
    const f = new THREE.Mesh(flagGeo, cloth(cols[i % cols.length]));
    f.position.copy(p);
    f.rotation.y = yaw;
    g.add(f);
  }
  return g;
}

/** Rounded rectangle helper for other modules. */
export { rbox, sphere, cyl, torus, add };

/**
 * The player's Seeker Orb: a golden core with the Dlicom D, a blue ring
 * orbiting it, and a warm halo, so it reads as "ours" next to the
 * Custodians' red freeze orbs.
 */
export function seeker() {
  const g = new THREE.Group();
  const core = new THREE.Mesh(sphere(0.42, 24, 16), texMat("seekerCore", () => new THREE.MeshStandardMaterial({
    color: "#000000", emissive: "#ffc21a", emissiveIntensity: 3, roughness: 0.3,
  })));
  g.add(core);
  const em = new THREE.Mesh(cached("seekerEm", () => new THREE.CircleGeometry(0.3, 24)), texMat("seekerEmMat", () => new THREE.MeshBasicMaterial({
    map: T.emblemTex("#ffc21a", "#ffffff", "#ffffff"), toneMapped: false,
  })));
  em.position.z = 0.43;
  g.add(em);
  const ringMat = glow("#6f93ff", 3);
  add(g, torus(0.72, 0.045), ringMat, 0, 0, 0, false).rotation.set(1.2, 0, 0.4);
  add(g, torus(0.62, 0.03), glow("#ffe680", 2.6), 0, 0, 0, false).rotation.set(-0.5, 0.8, 0);
  g.add(haloSprite("#ffc21a", 3.4, 0.75));
  return g;
}
