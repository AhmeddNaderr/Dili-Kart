import * as THREE from "three";
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
export function disposeMascots() {
  for (const v of cache.values()) v.dispose();
  cache.clear();
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
  const suit = vinyl(c.suit);
  const headMat = vinyl(c.head);
  const glove = vinyl(c.glove);
  const white = vinyl("#f6f7fb");
  const ink = flat("#15161f", 0.35);
  const silver = once("silver", () => new THREE.MeshStandardMaterial({ color: "#e9ecf5", metalness: 0.55, roughness: 0.28 }));

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
  }

  // Collar ring the dome seats into.
  const collar = mesh(once("collar", () => new THREE.TorusGeometry(0.3, 0.075, 12, 32)), once(`collar${c.dome}`, () => new THREE.MeshPhysicalMaterial({
    color: c.dome, transparent: true, opacity: 0.75, roughness: 0.1, clearcoat: 1,
  })), root, 0, 1.54, -0.18);
  collar.rotation.x = Math.PI / 2;

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
    eyes.push(eye);
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

  // Arms: pivot at the shoulder, hanging down −Y. Mitten gloves.
  const arm = (s: number) => {
    const g = new THREE.Group();
    g.position.set(0.4 * s, 1.36, -0.16);
    root.add(g);
    mesh(once("sleeve", () => new THREE.CapsuleGeometry(0.12, 0.32, 6, 14)), suit, g, 0, -0.26, 0);
    const mitt = mesh(once("mitt", () => new THREE.SphereGeometry(0.15, 16, 12)), glove, g, 0, -0.58, 0);
    mitt.scale.set(1, 1.1, 0.82);
    mesh(once("thumb", () => new THREE.SphereGeometry(0.065, 10, 8)), glove, g, -0.1 * s, -0.52, 0.06);
    return g;
  };
  const armL = arm(1);
  const armR = arm(-1);

  // Legs and boots, standing only.
  let legL: THREE.Group | null = null, legR: THREE.Group | null = null;
  if (!seated) {
    const leg = (s: number) => {
      const g = new THREE.Group();
      g.position.set(0.19 * s, 0.72, -0.18);
      root.add(g);
      mesh(once("leg", () => new THREE.CapsuleGeometry(0.14, 0.26, 6, 14)), suit, g, 0, -0.2, 0);
      const boot = mesh(once("boot", () => new THREE.SphereGeometry(0.2, 18, 12)), white, g, 0, -0.52, 0.05);
      boot.scale.set(0.95, 0.72, 1.25);
      const sole = mesh(once("sole", () => new THREE.CylinderGeometry(0.19, 0.2, 0.06, 18)), flat("#d8dbe6"), g, 0, -0.64, 0.05);
      sole.scale.z = 1.25;
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
  const cape = new THREE.Mesh(capeGeo, once(`cape${c.cape}`, () => new THREE.MeshPhysicalMaterial({
    color: c.cape, roughness: 0.5, sheen: 0.6, sheenColor: new THREE.Color("#ffffff"), side: THREE.DoubleSide,
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
    animateCape(r, t, 0.25 + cheer * 0.5, 0);
  }
}
