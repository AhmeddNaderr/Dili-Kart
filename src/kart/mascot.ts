import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { CharId } from "../../shared/rules";
import { rimLight } from "./rim";

/**
 * The Dlicom squad, modelled after the official mascots: a speech-bubble
 * head with square pixel eyes, inside a big glass dome; a chubby suit with a
 * raised silver "D"; cape, mitten gloves and chunky white boots.
 *
 * `buildMascot` is shared by the standing menu characters and the drivers
 * sitting in the karts, so they're always the same character.
 */

export interface MascotColors {
  suit: string;
  head: string;
  glove: string;
  cape: string;
  dome: string;
  mouth: "smile" | "o";
}

export const MASCOT: Record<CharId, MascotColors> = {
  dili: { suit: "#3d68ff", head: "#2448f2", glove: "#3159ff", cape: "#2242dc", dome: "#b3d2ff", mouth: "smile" },
  dcoded: { suit: "#ffc93a", head: "#ffb31c", glove: "#ffbd2c", cape: "#f2a012", dome: "#ffe9a8", mouth: "smile" },
  dco: { suit: "#ec63df", head: "#d942cb", glove: "#e454d6", cape: "#c531b8", dome: "#ffc6f6", mouth: "o" },
};

const cache = new Map<string, THREE.BufferGeometry | THREE.Material>();
function once<T extends THREE.BufferGeometry | THREE.Material>(key: string, make: () => T): T {
  let v = cache.get(key) as T | undefined;
  if (!v) { v = make(); cache.set(key, v); }
  return v;
}
const texCache = new Map<string, THREE.Texture>();
function onceTex(key: string, make: () => THREE.Texture) {
  let t = texCache.get(key);
  if (!t) { t = make(); texCache.set(key, t); }
  return t;
}
export function disposeMascots() {
  for (const v of cache.values()) v.dispose();
  cache.clear();
  for (const t of texCache.values()) t.dispose();
  texCache.clear();
}

const lighten = (hex: string, k: number) => "#" + new THREE.Color(hex).lerp(new THREE.Color("#ffffff"), k).getHexString();

/** A fine twill weave as a normal map, so the suits read as fabric up close. */
function fabricNormal() {
  return onceTex("fabricN", () => {
    const S = 128;
    const c = document.createElement("canvas");
    c.width = c.height = S;
    const g = c.getContext("2d")!;
    const h = (x: number, y: number) => {
      // Whole periods across the tile so it wraps without a seam.
      const t = ((x + y * 0.5) / 8) * Math.PI * 2;
      return 0.5 + 0.35 * Math.sin(t) + 0.15 * Math.sin(((x - y) / 16) * Math.PI * 2);
    };
    const img = g.createImageData(S, S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const dx = h(x + 1, y) - h(x - 1, y), dy = h(x, y + 1) - h(x, y - 1);
      const n = new THREE.Vector3(-dx * 1.6, -dy * 1.6, 1).normalize();
      const i = (y * S + x) * 4;
      img.data[i] = (n.x * 0.5 + 0.5) * 255;
      img.data[i + 1] = (n.y * 0.5 + 0.5) * 255;
      img.data[i + 2] = (n.z * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(5, 5);
    t.anisotropy = 4;
    return t;
  });
}

/** Racing-suit fabric: soft sheen, a woven normal, the same rim light as the vinyl. */
const suitMat = (color: string) => once(`suit${color}`, () => rimLight(new THREE.MeshPhysicalMaterial({
  color, roughness: 0.6, metalness: 0, sheen: 0.6, sheenRoughness: 0.45,
  sheenColor: new THREE.Color(color).lerp(new THREE.Color("#ffffff"), 0.5),
  normalMap: fabricNormal(), normalScale: new THREE.Vector2(0.16, 0.16),
}), 0.3));

/** Polished trim metal: badges, buckles, collar rings. */
const chromeTrim = () => once("chromeTrim", () => new THREE.MeshPhysicalMaterial({
  color: "#eef1f8", metalness: 0.9, roughness: 0.18, clearcoat: 0.7, clearcoatRoughness: 0.1,
}));

/** The cape, printed: a trim border and the squad emblem (drawn mirrored, since it's seen from behind). */
function capeTex(color: string, trim: string, emblem: boolean) {
  return onceTex(`cape${color}${trim}${emblem}`, () => {
    const W = 256, H = 320;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const g = c.getContext("2d")!;
    const grd = g.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, lighten(color, 0.08));
    grd.addColorStop(1, "#" + new THREE.Color(color).multiplyScalar(0.72).getHexString());
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);
    g.strokeStyle = trim;
    g.lineWidth = 12;
    g.strokeRect(14, -10, W - 28, H - 4);
    g.globalAlpha = 0.5;
    g.lineWidth = 3;
    g.strokeRect(30, -10, W - 60, H - 22);
    g.globalAlpha = 1;
    if (emblem) {
      g.save();
      g.translate(W / 2, 96);
      g.scale(-1, 1);
      g.fillStyle = trim;
      g.beginPath();
      g.arc(0, 0, 50, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = color;
      g.font = "900 64px Inter, 'Arial Black', sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText("D", 2, 4);
      g.restore();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  });
}

/** Soft vinyl-toy finish, like the renders. */
const vinyl = (color: string) => once(`vinyl${color}`, () => rimLight(new THREE.MeshPhysicalMaterial({
  color, roughness: 0.45, metalness: 0, clearcoat: 0.4, clearcoatRoughness: 0.4,
  sheen: 0.25, sheenColor: new THREE.Color(color).lerp(new THREE.Color("#ffffff"), 0.35),
}), 0.3));
const flat = (color: string, rough = 0.5) => once(`flat${color}${rough}`, () => new THREE.MeshStandardMaterial({ color, roughness: rough }));

/** The speech-bubble head: a pill with a little tail underneath. */
function bubbleGeo() {
  return once("bubble", () => {
    const w = 0.5, h = 0.3, r = h;
    const s = new THREE.Shape();
    s.moveTo(-w + r, -h);
    s.lineTo(0.02, -h);
    s.quadraticCurveTo(0.05, -h - 0.08, 0.0, -h - 0.16);   // tail tip
    s.quadraticCurveTo(0.14, -h - 0.06, 0.22, -h);
    s.lineTo(w - r, -h);
    s.absarc(w - r, 0, r, -Math.PI / 2, Math.PI / 2, false);
    s.lineTo(-w + r, h);
    s.absarc(-w + r, 0, r, Math.PI / 2, Math.PI * 1.5, false);
    const g = new THREE.ExtrudeGeometry(s, {
      depth: 0.3, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.07, bevelSegments: 6, curveSegments: 24,
    });
    g.translate(0, 0, -0.15);
    g.computeVertexNormals();
    return g;
  });
}

/** A chunky "D", shared by the chest badge and the kart noses. */
export function dLetterGeo(height: number, depth: number) {
  return once(`dletter${height}${depth}`, () => {
    const k = height / 12;
    const s = new THREE.Shape();
    s.moveTo(0, 0);
    s.lineTo(4 * k, 0);
    s.absarc(4 * k, 6 * k, 6 * k, -Math.PI / 2, Math.PI / 2, false);
    s.lineTo(0, 12 * k);
    s.lineTo(0, 0);
    const hole = new THREE.Path();
    hole.moveTo(3 * k, 3.2 * k);
    hole.lineTo(4 * k, 3.2 * k);
    hole.absarc(4 * k, 6 * k, 2.8 * k, -Math.PI / 2, Math.PI / 2, false);
    hole.lineTo(3 * k, 8.8 * k);
    hole.lineTo(3 * k, 3.2 * k);
    s.holes.push(hole);
    const g = new THREE.ExtrudeGeometry(s, {
      depth, bevelEnabled: true, bevelThickness: depth * 0.5, bevelSize: k * 0.7, bevelSegments: 3, curveSegments: 18,
    });
    g.center();
    return g;
  });
}

/** Glass dome: a clear physical shell plus an additive fresnel rim. */
function dome(tint: string, radius: number, opacity = 0.2, rimTint = tint) {
  const g = new THREE.Group();
  const glass = new THREE.Mesh(
    once(`domegeo${radius}`, () => new THREE.SphereGeometry(radius, 40, 28)),
    once(`glass${tint}${opacity}`, () => new THREE.MeshPhysicalMaterial({
      color: tint, transparent: true, opacity, roughness: 0.03, metalness: 0,
      clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.6, depthWrite: false,
    })),
  );
  glass.renderOrder = 3;
  g.add(glass);
  const rim = new THREE.Mesh(
    once(`domegeo${radius}`, () => new THREE.SphereGeometry(radius, 40, 28)),
    once(`rim${rimTint}`, () => new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uColor: { value: new THREE.Color(rimTint) } },
      vertexShader: `varying vec3 vN; varying vec3 vV;
        void main(){ vec4 mv = modelViewMatrix * vec4(position,1.); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
      fragmentShader: `uniform vec3 uColor; varying vec3 vN; varying vec3 vV;
        void main(){ float f = pow(1. - abs(dot(vN, vV)), 3.0); gl_FragColor = vec4(uColor * f * 0.9, 1.0); }`,
    })),
  );
  rim.renderOrder = 4;
  g.add(rim);
  g.userData.keepApart = true;
  return g;
}

/**
 * A Custodian: the same squad body, gone bad. Dark vinyl, horns, angry
 * glowing eyes, a jagged neon grin, a smoked dome, a padlock on the chest
 * (they want to hold everyone's keys), a villain's high collar and a
 * tattered cape, all in the crew's team colour.
 */
export interface EvilLook {
  team: string;
  glow: string;
}

const glowMat = (color: string, k = 2.4) => once(`eglow${color}${k}`, () => new THREE.MeshStandardMaterial({
  color: "#000000", emissive: color, emissiveIntensity: k * 1.9, roughness: 0.4,
}));

function darken(hex: string, amt: number) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(1 - amt);
  return "#" + c.getHexString();
}

export interface MascotRig {
  root: THREE.Group;
  head: THREE.Group;
  eyes: THREE.Object3D[];
  mouth: THREE.Object3D;
  torso: THREE.Object3D;
  armL: THREE.Group;
  armR: THREE.Group;
  legL: THREE.Group | null;
  legR: THREE.Group | null;
  cape: THREE.Mesh;
  capeBase: Float32Array;
  /** Parts that animate or are transparent — never merged. */
  keep: Set<THREE.Object3D>;
}

/**
 * Build a character. Seated drivers skip the legs; everything is placed for
 * a kart seat at the origin (torso ~1.2 up). Standing characters are lifted
 * by the caller.
 */
export function buildMascot(char: CharId, seated: boolean, evil?: EvilLook): MascotRig {
  const c: MascotColors = evil
    ? { suit: "#25243a", head: "#1c1a2a", glove: evil.team, cape: darken(evil.team, 0.45), dome: evil.glow, mouth: "smile" }
    : MASCOT[char];
  const root = new THREE.Group();
  const keep = new Set<THREE.Object3D>();
  const suit = suitMat(c.suit);
  const headMat = vinyl(c.head);
  const glove = vinyl(c.glove);
  const white = vinyl("#f6f7fb");
  const ink = flat("#15161f", 0.35);
  const silver = chromeTrim();
  // Pads, cuffs and heel tabs in the cape's deeper shade; piping in white
  // (the Custodians pipe theirs in their neon).
  const pad = suitMat(c.cape);
  const piping = evil ? glowMat(evil.glow, 1.4) : white;
  const sole = flat(evil ? "#15141f" : "#3a4058", 0.6);

  const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };

  // Torso: a soft bean, a little flatter front to back.
  const torso = mesh(once("torso", () => {
    const pts = [
      [0, -0.44], [0.26, -0.42], [0.39, -0.3], [0.44, -0.08], [0.43, 0.12], [0.37, 0.3], [0.22, 0.42], [0, 0.45],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    return new THREE.LatheGeometry(new THREE.SplineCurve(pts).getPoints(20), 32);
  }), suit, root, 0, 1.12, -0.18);
  torso.scale.set(1, 1, 0.82);
  // Belt with a polished buckle, and piping down each side of the suit.
  const belt = mesh(once("belt", () => new THREE.TorusGeometry(0.405, 0.042, 12, 56).rotateX(Math.PI / 2)), flat(evil ? "#0f0e17" : "#1e2236", 0.45), root, 0, 0.86, -0.18);
  belt.scale.z = 0.82;
  mesh(once("buckle", () => new RoundedBoxGeometry(0.15, 0.1, 0.05, 3, 0.02)), silver, root, 0, 0.86, 0.19);
  for (const sx of [-1, 1]) {
    const pipe = mesh(once("pipeT", () => new THREE.CapsuleGeometry(0.016, 0.46, 4, 8)), piping, root, 0.437 * sx, 1.13, -0.18);
    pipe.rotation.z = -0.04 * sx;
  }
  if (evil) {
    // Padlock: body, shackle and a glowing keyhole.
    const lockMat = once(`lock${evil.team}`, () => new THREE.MeshStandardMaterial({
      color: evil.team, metalness: 0.65, roughness: 0.28, emissive: evil.team, emissiveIntensity: 0.25,
    }));
    const lock = new THREE.Group();
    lock.position.set(0, 1.16, 0.2);
    lock.rotation.x = -0.12;
    root.add(lock);
    mesh(once("lockBody", () => new THREE.BoxGeometry(0.24, 0.18, 0.06)), lockMat, lock);
    mesh(once("lockShackle", () => new THREE.TorusGeometry(0.075, 0.022, 8, 18, Math.PI)), silver, lock, 0, 0.09, 0);
    mesh(once("keyhole", () => new THREE.CylinderGeometry(0.022, 0.022, 0.02, 10).rotateX(Math.PI / 2)), glowMat(evil.glow, 3), lock, 0, 0.01, 0.035);
    mesh(once("keyslot", () => new THREE.BoxGeometry(0.014, 0.045, 0.02)), glowMat(evil.glow, 3), lock, 0, -0.025, 0.035);
    // Spiked shoulder pads.
    const spikeMat = once("spikeMetal", () => new THREE.MeshStandardMaterial({ color: "#3a3850", metalness: 0.7, roughness: 0.25 }));
    for (const sx of [-1, 1]) {
      const pad = mesh(once("spad", () => new THREE.SphereGeometry(0.17, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2)), vinyl(evil.team), root, 0.38 * sx, 1.46, -0.18);
      pad.rotation.z = -0.4 * sx;
      for (let k = 0; k < 3; k++) {
        const sp = mesh(once("spike", () => new THREE.ConeGeometry(0.035, 0.14, 8).translate(0, 0.07, 0)), spikeMat, root,
          (0.4 + k * 0.04) * sx, 1.56 - k * 0.03, -0.3 + k * 0.1);
        sp.rotation.z = (-0.6 - k * 0.15) * sx;
      }
    }
  } else {
    const badge = mesh(dLetterGeo(0.26, 0.05), silver, root, 0.01, 1.2, 0.2);
    badge.rotation.x = -0.12;
    for (const sx of [-1, 1]) {
      const sp = mesh(once("spadH", () => new THREE.SphereGeometry(0.16, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2)), pad, root, 0.37 * sx, 1.44, -0.18);
      sp.rotation.z = -0.5 * sx;
      sp.scale.set(1, 0.8, 1.05);
    }
  }

  // Collar ring the dome seats into.
  const collar = mesh(once("collar", () => new THREE.TorusGeometry(0.3, 0.075, 12, 32)), once(`collar${c.dome}`, () => new THREE.MeshPhysicalMaterial({
    color: c.dome, transparent: true, opacity: 0.75, roughness: 0.1, clearcoat: 1,
  })), root, 0, 1.54, -0.18);
  collar.rotation.x = Math.PI / 2;
  mesh(once("collarRing", () => new THREE.TorusGeometry(0.335, 0.028, 10, 48).rotateX(Math.PI / 2)), silver, root, 0, 1.585, -0.18);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    mesh(once("bolt", () => new THREE.SphereGeometry(0.02, 8, 6)), silver, root, Math.cos(a) * 0.335, 1.615, -0.18 + Math.sin(a) * 0.335);
  }

  // Head: bubble, pixel eyes, mouth, dome.
  const head = new THREE.Group();
  head.position.set(0, 1.98, -0.16);
  root.add(head);
  mesh(bubbleGeo(), headMat, head);
  const eyes: THREE.Object3D[] = [];
  if (evil) {
    // Angry slanted eyes (inner ends low), glowing, with a white-hot core.
    for (const s of [-1, 1]) {
      const eye = new THREE.Group();
      eye.position.set(0.2 * s, 0.07, 0.232);
      eye.rotation.z = 0.42 * s;
      head.add(eye);
      mesh(once("evilEye", () => new THREE.BoxGeometry(0.2, 0.075, 0.04)), glowMat(evil.glow, 2.6), eye);
      mesh(once("evilCore", () => new THREE.BoxGeometry(0.12, 0.022, 0.02)), glowMat("#ffffff", 1.6), eye, 0.01 * s, 0, 0.022);
      eyes.push(eye);
    }
    // Horns.
    for (const s of [-1, 1]) {
      const horn = mesh(once("horn", () => new THREE.ConeGeometry(0.075, 0.27, 14).translate(0, 0.135, 0)), vinyl(evil.team), head, 0.3 * s, 0.26, 0.02);
      horn.rotation.z = -0.55 * s;
    }
  } else for (const s of [-1, 1]) {
    const eye = new THREE.Group();
    eye.position.set(0.21 * s, 0.06, 0.235);
    head.add(eye);
    const w = mesh(once("eyeW", () => new THREE.BoxGeometry(0.15, 0.15, 0.04)), white, eye);
    w.rotation.z = Math.PI / 4;
    const b = mesh(once("eyeB", () => new THREE.BoxGeometry(0.095, 0.095, 0.05)), ink, eye, -0.035 * s, 0, 0.012);
    b.rotation.z = Math.PI / 4;
    // A glint in each eye: the thing that makes a toy look alive.
    const hi = mesh(once("eyeHi", () => new THREE.BoxGeometry(0.03, 0.03, 0.02)), once("glint", () => new THREE.MeshBasicMaterial({ color: "#ffffff" })), eye, -0.035 * s - 0.018, 0.022, 0.04);
    hi.rotation.z = Math.PI / 4;
    hi.castShadow = false;
    eyes.push(eye);
    const cheek = mesh(once("cheek", () => new THREE.CircleGeometry(0.058, 24)), once("blush", () => new THREE.MeshBasicMaterial({
      color: "#ff8fb8", transparent: true, opacity: 0.45, depthWrite: false,
    })), head, 0.34 * s, -0.09, 0.239);
    cheek.castShadow = false;
    cheek.scale.y = 0.7;
  }
  let mouth: THREE.Mesh;
  if (evil) {
    // A wide jagged grin in neon.
    mouth = mesh(once("grin", () => {
      const path = new THREE.CurvePath<THREE.Vector3>();
      let prev: THREE.Vector3 | null = null;
      for (let i = 0; i <= 8; i++) {
        const x = -0.14 + i * 0.035;
        const p = new THREE.Vector3(x, (i % 2 ? -0.026 : 0.01) + x * x * 1.6, 0);
        if (prev) path.add(new THREE.LineCurve3(prev, p));
        prev = p;
      }
      return new THREE.TubeGeometry(path, 64, 0.011, 6, false);
    }), glowMat(evil.glow, 2.2), head, 0, -0.1, 0.236);
  } else {
    mouth = c.mouth === "smile"
      ? mesh(once("smile", () => new THREE.TorusGeometry(0.055, 0.016, 8, 18, Math.PI)), ink, head, 0, -0.1, 0.235)
      : mesh(once("omouth", () => new THREE.SphereGeometry(0.035, 12, 10)), ink, head, 0, -0.1, 0.235);
    if (c.mouth === "smile") mouth.rotation.z = Math.PI;
    else mouth.scale.z = 0.5;
  }
  const d = evil ? dome(darken(evil.team, 0.7), 0.68, 0.3, evil.glow) : dome(c.dome, 0.68);
  d.position.y = 0.02;
  head.add(d);
  keep.add(d);

  if (evil) {
    // A villain's high collar standing up behind the dome.
    const collarBack = mesh(once("vcollar", () => new THREE.CylinderGeometry(0.76, 0.52, 0.4, 28, 1, true, Math.PI * 0.68, Math.PI * 0.64)),
      once(`vcollar${evil.team}`, () => new THREE.MeshPhysicalMaterial({
        color: darken(evil.team, 0.62), roughness: 0.35, clearcoat: 0.8, side: THREE.DoubleSide,
      })), root, 0, 1.62, -0.18);
    collarBack.castShadow = true;
    const trim = mesh(once("vcollarTrim", () => new THREE.TorusGeometry(0.76, 0.018, 6, 40, Math.PI * 0.64).rotateX(Math.PI / 2).rotateY(Math.PI * 0.82)),
      glowMat(evil.glow, 1.8), root, 0, 1.82, -0.18);
    trim.castShadow = false;
  }

  // Arms: pivot at the shoulder, hanging down −Y. A tapered sleeve with
  // white piping, a flared glove cuff, and a cartoon glove: palm, three
  // fingers and a thumb.
  const arm = (s: number) => {
    const g = new THREE.Group();
    g.position.set(0.4 * s, 1.36, -0.16);
    root.add(g);
    mesh(once("sleeve2", () => new THREE.LatheGeometry([
      [0, 0.07], [0.08, 0.065], [0.12, 0.03], [0.128, -0.04], [0.118, -0.25], [0.106, -0.44], [0.098, -0.47], [0, -0.47],
    ].map(([x, y]) => new THREE.Vector2(x, y)), 24)), suit, g);
    mesh(once("pipeA", () => new THREE.BoxGeometry(0.022, 0.4, 0.03)), piping, g, 0.116 * s, -0.24, 0).rotation.z = 0.025 * s;
    mesh(once("gcuff", () => new THREE.CylinderGeometry(0.128, 0.1, 0.1, 24, 1, true)), glove, g, 0, -0.475, 0);
    mesh(once("gcuffRim", () => new THREE.TorusGeometry(0.126, 0.018, 8, 28).rotateX(Math.PI / 2)), glove, g, 0, -0.43, 0);
    const palm = mesh(once("palm", () => new THREE.SphereGeometry(0.13, 24, 18)), glove, g, 0, -0.59, 0.01);
    palm.scale.set(1, 1.02, 0.8);
    for (let f = 0; f < 3; f++) {
      const fx = (f - 1) * 0.056;
      const finger = mesh(once("finger", () => new THREE.CapsuleGeometry(0.041, 0.075, 6, 12)), glove, g, fx, -0.7, 0.045);
      finger.rotation.set(-0.45, 0, (f - 1) * -0.12);
    }
    const thumb = mesh(once("thumb2", () => new THREE.CapsuleGeometry(0.046, 0.07, 6, 12)), glove, g, -0.105 * s, -0.56, 0.07);
    thumb.rotation.set(0.5, 0, 0.75 * s);
    return g;
  };
  const armL = arm(1);
  const armR = arm(-1);

  // Legs and sneaker boots, standing only.
  let legL: THREE.Group | null = null, legR: THREE.Group | null = null;
  if (!seated) {
    const leg = (s: number) => {
      const g = new THREE.Group();
      g.position.set(0.19 * s, 0.72, -0.18);
      root.add(g);
      mesh(once("leg2", () => new THREE.LatheGeometry([
        [0, 0.08], [0.1, 0.07], [0.15, 0.02], [0.145, -0.12], [0.132, -0.3], [0.125, -0.4], [0, -0.4],
      ].map(([x, y]) => new THREE.Vector2(x, y)), 24)), suit, g);
      const knee = mesh(once("knee", () => new THREE.SphereGeometry(0.08, 18, 12)), pad, g, 0, -0.2, 0.1);
      knee.scale.set(1.25, 1, 0.42);
      mesh(once("pipeL", () => new THREE.BoxGeometry(0.022, 0.34, 0.03)), piping, g, 0.14 * s, -0.16, 0);
      // Boot: sole, upper, toe cap, laces, ankle cuff, heel tab.
      // Rounded rubber sole that follows the upper, with a tread band.
      const soleM = mesh(once("sole3", () => new THREE.CylinderGeometry(0.182, 0.17, 0.07, 32)), sole, g, 0, -0.625, 0.075);
      soleM.scale.set(1, 1, 1.42);
      const band = mesh(once("soleBand", () => new THREE.CylinderGeometry(0.186, 0.186, 0.022, 32, 1, true)), pad, g, 0, -0.603, 0.075);
      band.scale.set(1, 1, 1.42);
      const upper = mesh(once("boot2", () => new THREE.SphereGeometry(0.19, 26, 16)), white, g, 0, -0.5, 0.06);
      upper.scale.set(0.93, 0.7, 1.28);
      const toe = mesh(once("toe", () => new THREE.SphereGeometry(0.12, 20, 12)), flat("#dfe3ee", 0.45), g, 0, -0.555, 0.215);
      toe.scale.set(1.15, 0.62, 1);
      for (let k = 0; k < 3; k++) {
        const lace = mesh(once("lace", () => new RoundedBoxGeometry(0.11, 0.018, 0.024, 2, 0.008)), sole, g, 0, -0.43 - k * 0.032, 0.17 + k * 0.02);
        lace.rotation.x = -0.9;
      }
      mesh(once("ankle", () => new THREE.TorusGeometry(0.132, 0.034, 10, 28).rotateX(Math.PI / 2)), pad, g, 0, -0.395, 0.005);
      mesh(once("heelTab", () => new RoundedBoxGeometry(0.08, 0.11, 0.04, 2, 0.015)), pad, g, 0, -0.47, -0.17);
      return g;
    };
    legL = leg(1);
    legR = leg(-1);
  }

  // Cape: a cloth grid, animated on the CPU.
  const capeGeo = new THREE.PlaneGeometry(0.8, 1.0, 6, 10).translate(0, -0.5, 0);
  if (evil) {
    // Tattered hem: every other point along the bottom pulled up.
    const cp = capeGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < cp.count; i++) {
      if (cp.getY(i) < -0.99) {
        const col = Math.round((cp.getX(i) + 0.4) / (0.8 / 6));
        if (col % 2 === 1) cp.setY(i, -0.8);
      }
    }
  }
  const cape = new THREE.Mesh(capeGeo, once(`cape2${c.cape}${!!evil}`, () => new THREE.MeshPhysicalMaterial({
    map: capeTex(c.cape, evil ? evil.glow : lighten(c.cape, 0.72), !evil),
    roughness: 0.5, sheen: 0.7, sheenRoughness: 0.4, sheenColor: new THREE.Color("#ffffff"), side: THREE.DoubleSide,
  })));
  cape.position.set(0, 1.5, -0.56);
  cape.castShadow = true;
  root.add(cape);
  keep.add(cape);

  return {
    root, head, eyes, mouth, torso, armL, armR, legL, legR, cape,
    capeBase: (capeGeo.attributes.position.array as Float32Array).slice(), keep,
  };
}

/** Flutter the cape. `wind` 0..1.3, `spread` 0..1 for the glide. */
export function animateCape(rig: MascotRig, time: number, wind: number, spread: number) {
  const pos = rig.cape.geometry.attributes.position as THREE.BufferAttribute;
  const a = pos.array as Float32Array;
  const b = rig.capeBase;
  for (let i = 0; i < a.length; i += 3) {
    const x = b[i], y = b[i + 1];
    const t = -y / 1.0;
    const flutter = Math.sin(time * 15 + t * 6 + x * 4) * 0.07 * t * wind;
    const lift = t * t * wind * 0.55;
    a[i] = x * (1 + t * (0.3 + spread * 1.6));
    a[i + 1] = y * (1 - spread * 0.55) + lift * (1 - spread) + flutter * 0.5;
    a[i + 2] = -t * (0.15 + wind * 0.75 + spread * 0.4) + flutter;
  }
  pos.needsUpdate = true;
  rig.cape.geometry.computeVertexNormals();
}

/** Blink every few seconds: squash the eyes flat for a moment. */
export function blink(rig: MascotRig, time: number, seed = 0) {
  const t = (time + seed * 1.7) % 3.6;
  const k = t < 0.12 ? 0.15 : 1;
  for (const e of rig.eyes) e.scale.y = k;
}

export type Pose = "idle" | "wave" | "cheer" | "talk" | "sad" | "point";

/**
 * A standing character for the menus, intro and results. Poses blend
 * smoothly; everything idles (breathing, blinking, cape in a light breeze).
 */
export class MascotModel {
  readonly root = new THREE.Group();
  readonly rig: MascotRig;
  pose: Pose = "idle";
  /** 0..1 blend into a walk cycle; `stride` advances it (radians of leg swing). */
  walk = 0;
  stride = 0;
  private w = { wave: 0, cheer: 0, talk: 0, sad: 0, point: 0 };
  private seed: number;

  constructor(readonly char: CharId, seed = 0) {
    this.rig = buildMascot(char, false);
    this.rig.root.position.y = -0.02;
    this.root.add(this.rig.root);
    this.seed = seed;
  }

  update(time: number, dt: number) {
    const r = this.rig;
    const t = time + this.seed * 2.3;
    for (const k of Object.keys(this.w) as (keyof typeof this.w)[]) {
      const target = this.pose === k ? 1 : 0;
      this.w[k] += (target - this.w[k]) * Math.min(1, dt * 7);
    }
    const { wave, cheer, talk, sad, point } = this.w;

    const breathe = Math.sin(t * 2.2) * 0.02;
    const hop = cheer * Math.abs(Math.sin(t * 6)) * 0.22;
    r.root.position.y = hop - sad * 0.06;
    r.torso.scale.set(1 + breathe * 0.5, 1 + breathe, 0.82);
    r.head.position.y = 1.98 + breathe * 0.6 - sad * 0.08;
    r.head.rotation.z = Math.sin(t * 1.3) * 0.06 + talk * Math.sin(t * 7) * 0.05 + wave * 0.1;
    r.head.rotation.x = sad * 0.28 - cheer * 0.12 + talk * Math.sin(t * 9) * 0.04;
    r.head.rotation.y = Math.sin(t * 0.7) * 0.12;
    r.mouth.scale.y = 1 + talk * (0.6 + Math.sin(t * 18) * 0.6);
    blink(r, t, this.seed);

    // Arms: rest by the sides, wave (right arm), cheer (both), point (right forward).
    const sideSway = Math.sin(t * 2.2) * 0.04;
    for (const [arm, s] of [[r.armL, 1], [r.armR, -1]] as const) {
      const right = s < 0;
      const up = cheer + (right ? wave : 0);
      const wig = right ? Math.sin(t * 11) * 0.35 * wave : 0;
      const cheerWig = Math.sin(t * 12 + s) * 0.2 * cheer;
      arm.rotation.x = -up * 2.6 - (right ? point * 1.4 : 0) + sad * 0.15;
      arm.rotation.z = s * (0.18 + sideSway + up * 0.55 - sad * 0.1) + wig + cheerWig;
    }
    if (r.legL && r.legR) {
      r.legL.rotation.x = -cheer * Math.max(0, Math.sin(t * 6)) * 0.3;
      r.legR.rotation.x = -cheer * Math.max(0, Math.sin(t * 6 + Math.PI)) * 0.3;
    }
    // Walk: legs swing, arms swing against them, the body bobs and leans in.
    const w = this.walk;
    if (w > 0.001 && r.legL && r.legR) {
      const ph = this.stride;
      r.legL.rotation.x = r.legL.rotation.x * (1 - w) + Math.sin(ph) * 0.62 * w;
      r.legR.rotation.x = r.legR.rotation.x * (1 - w) - Math.sin(ph) * 0.62 * w;
      r.armL.rotation.x = r.armL.rotation.x * (1 - w) - Math.sin(ph) * 0.55 * w;
      r.armR.rotation.x = r.armR.rotation.x * (1 - w) + Math.sin(ph) * 0.55 * w;
      r.root.position.y += Math.abs(Math.cos(ph)) * 0.07 * w;
      r.root.rotation.x = 0.07 * w;
      r.head.rotation.z += Math.sin(ph) * 0.05 * w;
      r.torso.rotation.y = Math.sin(ph) * 0.08 * w;
    } else {
      r.root.rotation.x = 0;
      r.torso.rotation.y = 0;
    }
    animateCape(r, t, 0.25 + cheer * 0.5 + w * 0.35, 0);
  }
}
