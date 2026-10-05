import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { MascotRig } from "./mascot";
import { chromeTrim, dome, fabricNormal, flat, glowMat, lighten, once, onceTex, suitMat, vinyl } from "./toon";
import { rimLight } from "./rim";

/**
 * The skin drivers from the shop, as chibi vinyl figures with the same rig
 * as the squad (same shoulders, head and hips), so they drive, wave and
 * cheer with the same animation.
 *
 *   Quang  — black hair with a white streak in the bangs, thin glasses over
 *            big teal eyes, an open smile, a white mandarin-collar shirt
 *            with two chest pockets.
 *   Retree — a charcoal face in a glass bubble, a spiky black mop, round
 *            white eyes behind blue dotted pixel glasses, a dark sweater
 *            speckled with stars.
 */

export const SKIN_DRIVERS = ["quang", "cipher", "rehan", "abubakker", "vic", "abhishek"] as const;
export type SkinDriver = (typeof SKIN_DRIVERS)[number];
export const isSkinDriver = (x: unknown): x is SkinDriver => typeof x === "string" && (SKIN_DRIVERS as readonly string[]).includes(x);

type Mesh = THREE.Mesh;

/** The cache is shared with the squad's builder, so keys get their own prefix. */
export const onceC = <T extends THREE.BufferGeometry | THREE.Material>(key: string, make: () => T): T => once(`chibi:${key}`, make);

/** The head is an ellipsoid; face parts sit on its surface, facing out. */
export const HEAD = { a: 0.44, b: 0.42, c: 0.4 };

export function onHead(o: THREE.Object3D, x: number, y: number, off = 0, h = HEAD) {
  const k = Math.max(0, 1 - (x / h.a) ** 2 - (y / h.b) ** 2);
  const z = h.c * Math.sqrt(k);
  const n = new THREE.Vector3(x / (h.a * h.a), y / (h.b * h.b), z / (h.c * h.c)).normalize();
  o.position.set(x, y, z).addScaledVector(n, off);
  o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
  return o;
}

/**
 * Fold a helper group's transform into its meshes and hand them to its
 * parent, so they merge with their neighbours instead of costing a draw
 * call each.
 */
function adopt(g: THREE.Object3D) {
  const parent = g.parent!;
  g.updateMatrix();
  for (const m of [...g.children]) {
    m.updateMatrix();
    m.matrix.premultiply(g.matrix);
    m.matrix.decompose(m.position, m.quaternion, m.scale);
    parent.add(m);
  }
  parent.remove(g);
}

/** A tapered, slightly curved lock of hair, pointing down −Y from its root. */
function lockGeo(len: number, r: number, bend: number) {
  return onceC(`lock${len}${r}${bend}`, () => {
    // Apex down at −len, base at the root; flattened, and bent forward toward the tip.
    const g = new THREE.ConeGeometry(r, len, 10, 6).rotateX(Math.PI).translate(0, -len / 2, 0);
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const t = Math.min(1, Math.max(0, -p.getY(i) / len));
      p.setZ(i, p.getZ(i) * 0.55 + bend * t * t);
    }
    g.computeVertexNormals();
    return g;
  });
}

/** A knitted sweater speckled with little white stars. */
function starKnitTex(base: string) {
  return onceTex(`starknit${base}`, () => {
    const S = 256;
    const c = document.createElement("canvas");
    c.width = c.height = S;
    const g = c.getContext("2d")!;
    g.fillStyle = base;
    g.fillRect(0, 0, S, S);
    // Knit ribs.
    g.globalAlpha = 0.12;
    g.fillStyle = "#000";
    for (let x = 0; x < S; x += 8) g.fillRect(x, 0, 3, S);
    g.globalAlpha = 1;
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 70; i++) {
      const x = rnd() * S, y = rnd() * S, r = 0.8 + rnd() * 1.6;
      g.fillStyle = `rgba(255,255,255,${0.55 + rnd() * 0.45})`;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
      if (r > 2) {
        g.strokeStyle = "rgba(255,255,255,.5)";
        g.lineWidth = 0.8;
        g.beginPath();
        g.moveTo(x - r * 2.2, y); g.lineTo(x + r * 2.2, y);
        g.moveTo(x, y - r * 2.2); g.lineTo(x, y + r * 2.2);
        g.stroke();
      }
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(2, 1.5);
    t.anisotropy = 4;
    return t;
  });
}

const knit = (base: string) => onceC(`knit${base}`, () => rimLight(new THREE.MeshPhysicalMaterial({
  map: starKnitTex(base), roughness: 0.85, sheen: 0.8, sheenRoughness: 0.5, sheenColor: new THREE.Color("#8fa6ff"),
  normalMap: fabricNormal(), normalScale: new THREE.Vector2(0.35, 0.35),
}), 0.35));

/** Glossy anime hair: dark, with a cool blue sheen along the rim. */
export const hairMat = (color: string) => onceC(`hair${color}`, () => rimLight(new THREE.MeshPhysicalMaterial({
  color, roughness: 0.52, clearcoat: 0.25, clearcoatRoughness: 0.45,
  sheen: 0.55, sheenRoughness: 0.4, sheenColor: new THREE.Color("#5a78d8"), envMapIntensity: 0.6,
}), 0.3));

export const skinMat = (color: string) => onceC(`skin${color}`, () => rimLight(new THREE.MeshPhysicalMaterial({
  color, roughness: 0.55, sheen: 0.4, sheenRoughness: 0.6, sheenColor: new THREE.Color("#ffd9c9"),
  clearcoat: 0.15, clearcoatRoughness: 0.6,
}), 0.22));

export const basic = (color: string) => onceC(`basic${color}`, () => new THREE.MeshBasicMaterial({ color }));

/** The torso's profile, revolved: the squad's bean, slimmer. */
export const TORSO_PTS = [
  [0, -0.44], [0.26, -0.42], [0.39, -0.3], [0.44, -0.08], [0.43, 0.12], [0.37, 0.3], [0.22, 0.42], [0, 0.45],
];
export const torsoGeo = () => onceC("torso", () =>
  new THREE.LatheGeometry(new THREE.SplineCurve(TORSO_PTS.map(([x, y]) => new THREE.Vector2(x, y))).getPoints(20), 32));

export function buildChibi(kind: "quang" | "cipher", seated: boolean): MascotRig {
  const quang = kind === "quang";
  const root = new THREE.Group();
  const keep = new Set<THREE.Object3D>();
  const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0): Mesh => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };

  const skin = quang ? skinMat("#f7d3b2") : onceC("charcoal", () => rimLight(new THREE.MeshPhysicalMaterial({
    color: "#17181e", roughness: 0.66, sheen: 0.15, sheenColor: new THREE.Color("#5b6590"), envMapIntensity: 0.35,
  }), 0.35));
  const hair = hairMat(quang ? "#1a2130" : "#141419");
  const top = quang ? suitMat("#f3f5fa") : knit("#2c2d36");
  const pants = suitMat(quang ? "#2a3552" : "#1b1c24");
  const ink = flat("#15161f", 0.35);
  const shoe = vinyl(quang ? "#f6f7fb" : "#23242e");
  const soleM = flat(quang ? "#35b6f2" : "#2f4dff", 0.45);

  // Torso: the squad's bean, slimmer, as a shirt or a sweater.
  const torso = mesh(torsoGeo(), top, root, 0, 1.1, -0.18);
  torso.scale.set(0.84, 0.98, 0.78);
  // Neck.
  mesh(onceC("neck", () => new THREE.CylinderGeometry(0.11, 0.13, 0.22, 18)), skin, root, 0, 1.56, -0.17);
  // Hips: trousers showing under the hem.
  const hips = mesh(onceC("hips", () => new THREE.CylinderGeometry(0.33, 0.3, 0.16, 28)), pants, root, 0, 0.72, -0.18);
  hips.scale.z = 0.82;

  if (quang) {
    // Mandarin collar, open at the throat.
    const collar = mesh(onceC("mandarin", () => new THREE.CylinderGeometry(0.17, 0.19, 0.1, 28, 1, true, 0.35, Math.PI * 2 - 0.7)), top, root, 0, 1.56, -0.17);
    collar.material = onceC("mandarinMat", () => rimLight(new THREE.MeshPhysicalMaterial({
      color: "#f7f8fc", roughness: 0.6, sheen: 0.6, side: THREE.DoubleSide,
    }), 0.25));
    mesh(onceC("vneck", () => new THREE.CircleGeometry(0.07, 3)), skin, root, 0, 1.47, 0.135).rotation.set(-0.15, 0, -Math.PI / 2);
    // Button placket down the middle, and two buttoned chest pockets.
    const placket = mesh(onceC("placket", () => new RoundedBoxGeometry(0.055, 0.66, 0.03, 2, 0.012)), top, root, 0, 1.08, 0.155);
    placket.rotation.x = -0.05;
    const btn = onceC("shirtBtn", () => new THREE.CylinderGeometry(0.014, 0.014, 0.012, 12).rotateX(Math.PI / 2));
    const btnMat = flat("#dfe3ec", 0.3);
    for (let i = 0; i < 4; i++) mesh(btn, btnMat, root, 0, 1.36 - i * 0.16, 0.176 - i * 0.004);
    const seam = flat("#c9d0de", 0.7);
    for (const s of [-1, 1]) {
      const pk = new THREE.Group();
      pk.position.set(0.155 * s, 1.2, 0.128);
      pk.rotation.set(-0.08, 0.36 * s, 0);
      root.add(pk);
      mesh(onceC("pocket", () => new RoundedBoxGeometry(0.15, 0.14, 0.025, 2, 0.01)), top, pk);
      mesh(onceC("pocketFlap", () => new RoundedBoxGeometry(0.165, 0.045, 0.035, 2, 0.012)), top, pk, 0, 0.075, 0.006);
      mesh(onceC("pocketSeam", () => new THREE.BoxGeometry(0.004, 0.1, 0.028)), seam, pk, 0, -0.01, 0.002);
      mesh(btn, btnMat, pk, 0, 0.068, 0.028);
      adopt(pk);
    }
  } else {
    // Ribbed crew neck and hem, and a blue edge on the shoulders like the art.
    const rib = suitMat("#23242c");
    const neckRib = mesh(onceC("crewRib", () => new THREE.TorusGeometry(0.16, 0.045, 10, 32).rotateX(Math.PI / 2)), rib, root, 0, 1.52, -0.17);
    neckRib.scale.z = 0.9;
    const hem = mesh(onceC("hemRib", () => new THREE.TorusGeometry(0.355, 0.045, 10, 48).rotateX(Math.PI / 2)), rib, root, 0, 0.72, -0.18);
    hem.scale.z = 0.8;
    for (const s of [-1, 1]) {
      const edge = mesh(onceC("blueEdge", () => new THREE.TorusGeometry(0.34, 0.012, 6, 24, Math.PI * 0.42)), glowMat("#3d63ff", 0.9), root, 0.02 * s, 1.18, -0.18);
      edge.rotation.set(0, (Math.PI / 2) * s, s > 0 ? 0.4 : Math.PI - 0.4 - Math.PI * 0.42);
      edge.castShadow = false;
    }
  }

  // Head.
  const head = new THREE.Group();
  head.position.set(0, 1.98, -0.16);
  root.add(head);
  const skull = mesh(onceC("chibiHead", () => new THREE.SphereGeometry(1, 48, 36)), skin, head);
  skull.scale.set(HEAD.a, HEAD.b, HEAD.c);
  // Cheeks puff a little lower on the face.
  const jaw = mesh(onceC("jaw", () => new THREE.SphereGeometry(1, 32, 24)), skin, head, 0, -0.12, 0.0);
  jaw.scale.set(0.37, 0.3, 0.33);

  const eyes: THREE.Object3D[] = [];
  let mouth: THREE.Object3D;

  if (quang) {
    // Ears.
    for (const s of [-1, 1]) {
      const ear = mesh(onceC("ear", () => new THREE.SphereGeometry(1, 20, 14)), skin, head, 0.43 * s, -0.04, -0.02);
      ear.scale.set(0.05, 0.1, 0.075);
      const inner = mesh(onceC("earIn", () => new THREE.SphereGeometry(1, 14, 10)), flat("#e3a98c", 0.6), head, 0.455 * s, -0.04, 0);
      inner.scale.set(0.02, 0.06, 0.04);
    }
    // Big anime eyes: white, a teal iris with a darker rim, pupil, and two
    // sparkles; an upper lash line.
    const irisMat = onceC("irisTeal", () => new THREE.MeshPhysicalMaterial({
      color: "#1fa7b8", roughness: 0.15, clearcoat: 1, emissive: "#0c6d7a", emissiveIntensity: 0.35,
    }));
    for (const s of [-1, 1]) {
      const eye = onHead(new THREE.Group(), 0.16 * s, -0.02, -0.02);
      head.add(eye);
      const white = mesh(onceC("qEyeW", () => new THREE.SphereGeometry(1, 28, 20)), basic("#fbfcff"), eye);
      white.scale.set(0.085, 0.1, 0.03);
      const iris = mesh(onceC("qIris", () => new THREE.SphereGeometry(1, 28, 20)), irisMat, eye, -0.012 * s, -0.008, 0.012);
      iris.scale.set(0.062, 0.078, 0.026);
      const ring = mesh(onceC("qIrisRing", () => new THREE.TorusGeometry(1, 0.1, 8, 32)), flat("#0f4b5a", 0.3), eye, -0.012 * s, -0.008, 0.024);
      ring.scale.set(0.062, 0.078, 0.06);
      const pupil = mesh(onceC("qPupil", () => new THREE.SphereGeometry(1, 20, 14)), ink, eye, -0.012 * s, -0.012, 0.03);
      pupil.scale.set(0.028, 0.036, 0.012);
      for (const [gx, gy, gr] of [[-0.03, 0.028, 0.017], [0.012, -0.03, 0.009]]) {
        const gl = mesh(onceC("glint", () => new THREE.SphereGeometry(1, 12, 8)), basic("#ffffff"), eye, gx - 0.012 * s, gy, 0.04);
        gl.scale.set(gr, gr, 0.005);
        gl.castShadow = false;
      }
      const lash = mesh(onceC("qLash", () => new THREE.TorusGeometry(0.092, 0.012, 6, 20, Math.PI * 0.9)), ink, eye, 0, -0.006, 0.02);
      lash.rotation.z = Math.PI * 0.05;
      lash.scale.set(1, 1.1, 1);
      eyes.push(eye);
      // Eyebrow, peeking under the bangs.
      const brow = onHead(mesh(onceC("brow", () => new THREE.CapsuleGeometry(0.012, 0.07, 4, 8).rotateZ(Math.PI / 2)), hair, head), 0.16 * s, 0.14, 0.004);
      brow.rotateZ(-0.12 * s);
      // Glasses: a thin dark frame round each eye, with faint glass.
      const lens = onHead(new THREE.Group(), 0.165 * s, -0.02, 0.05);
      head.add(lens);
      const rim = mesh(onceC("glassRim", () => {
        const shape = new THREE.Shape();
        const w = 0.115, h = 0.085, r = 0.04;
        shape.moveTo(-w + r, -h); shape.lineTo(w - r, -h); shape.quadraticCurveTo(w, -h, w, -h + r);
        shape.lineTo(w, h - r); shape.quadraticCurveTo(w, h, w - r, h); shape.lineTo(-w + r, h);
        shape.quadraticCurveTo(-w, h, -w, h - r); shape.lineTo(-w, -h + r); shape.quadraticCurveTo(-w, -h, -w + r, -h);
        const pts = shape.getSpacedPoints(64).map((p) => new THREE.Vector3(p.x, p.y, 0));
        return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 96, 0.008, 6, true);
      }), flat("#1c1f2a", 0.25), lens);
      rim.castShadow = false;
      const glass = mesh(onceC("glassPane", () => new THREE.PlaneGeometry(0.22, 0.16)), onceC("glassPaneMat", () => new THREE.MeshPhysicalMaterial({
        color: "#dff4ff", transparent: true, opacity: 0.12, roughness: 0.02, clearcoat: 1, depthWrite: false,
      })), lens);
      glass.castShadow = false;
      keep.add(glass);
      adopt(lens);
      // Arm of the glasses back to the ear.
      const temple = mesh(onceC("temple", () => new THREE.CylinderGeometry(0.007, 0.007, 0.3, 6).rotateX(Math.PI / 2)), flat("#1c1f2a", 0.25), head, 0.405 * s, 0.0, 0.14);
      temple.rotation.y = 0.28 * s;
    }
    const bridge = onHead(mesh(onceC("bridge", () => new THREE.TorusGeometry(0.05, 0.007, 6, 12, Math.PI)), flat("#1c1f2a", 0.25), head), 0, -0.01, 0.05);
    bridge.scale.y = 0.45;
    bridge.castShadow = false;
    // Nose, blush and an open smile with teeth.
    const nose = onHead(mesh(onceC("nose", () => new THREE.SphereGeometry(1, 12, 8)), skin, head), 0.0, -0.1, -0.004);
    nose.scale.set(0.022, 0.016, 0.018);
    for (const s of [-1, 1]) {
      const b = onHead(mesh(onceC("qBlush", () => new THREE.CircleGeometry(0.045, 20)), onceC("qBlushMat", () => new THREE.MeshBasicMaterial({
        color: "#ff9a8a", transparent: true, opacity: 0.4, depthWrite: false,
      })), head), 0.25 * s, -0.12, 0.004);
      b.scale.y = 0.6;
      b.castShadow = false;
    }
    const m = onHead(new THREE.Group(), 0.02, -0.19, 0.0);
    head.add(m);
    mesh(onceC("qMouth", () => new THREE.CircleGeometry(0.06, 24, Math.PI, Math.PI)), flat("#6a2b2b", 0.5), m, 0, 0.008, 0.004).scale.set(1, 0.9, 1);
    mesh(onceC("qTeeth", () => new RoundedBoxGeometry(0.1, 0.022, 0.01, 2, 0.006)), basic("#ffffff"), m, 0, -0.004, 0.008);
    mesh(onceC("qTongue", () => new THREE.CircleGeometry(0.03, 16, Math.PI, Math.PI)), flat("#d86a6a", 0.6), m, 0.004, -0.03, 0.006).scale.y = 0.5;
    mouth = m;

    // Hair: a cap swept back over the crown, a fringe of pointed locks with
    // one white streak, fuller sides over the ears and a few crown tufts.
    const cap = mesh(onceC("hairCap", () => new THREE.SphereGeometry(1, 40, 28, 0, Math.PI * 2, 0, Math.PI * 0.62)), hair, head, 0, 0.02, -0.03);
    cap.scale.set(0.475, 0.47, 0.455);
    cap.rotation.x = -0.62;
    const back = mesh(onceC("hairBack", () => new THREE.SphereGeometry(1, 32, 20)), hair, head, 0, -0.03, -0.1);
    back.scale.set(0.46, 0.42, 0.38);
    const white = hairMat("#eef3fb");
    const fringe: [number, number, number, number][] = [];
    // x, length, tilt, bend: a full fringe down to the glasses, parted a little right of centre.
    for (let i = 0; i < 11; i++) {
      const x = -0.34 + i * 0.068;
      fringe.push([x, 0.36 - Math.abs(x) * 0.28 + (i % 2) * 0.03, -x * 1.5, 0.06]);
    }
    fringe.forEach(([x, len, tilt, bend], i) => {
      const lk = onHead(new THREE.Group(), x, 0.3, 0.035);
      head.add(lk);
      lk.rotateX(-0.2);
      const m2 = mesh(lockGeo(len, 0.1, -bend), i === 7 ? white : hair, lk);
      m2.rotation.z = tilt;
      adopt(lk);
    });
    // The white streak continues back over the top as a highlight ribbon.
    const streak = mesh(onceC("streak", () => new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.16, 0.3, 0.3), new THREE.Vector3(0.13, 0.42, 0.18), new THREE.Vector3(0.09, 0.46, 0.0), new THREE.Vector3(0.06, 0.42, -0.18),
    ]), 24, 0.02, 8, false)), white, head);
    streak.scale.set(1.6, 1, 1);
    for (const s of [-1, 1]) {
      for (let k = 0; k < 3; k++) {
        const side = new THREE.Group();
        side.position.set((0.4 - k * 0.02) * s, 0.14 - k * 0.02, 0.12 - k * 0.12);
        head.add(side);
        const lm = mesh(lockGeo(0.26 - k * 0.03, 0.08, 0.02), hair, side);
        lm.rotation.set(0.1, 0, 0.18 * s);
        adopt(side);
      }
    }
    for (const [x, z, r] of [[-0.05, -0.05, -0.5], [0.08, -0.12, 0.4], [0.0, -0.22, 0.1]]) {
      const tuft = mesh(onceC("tuft", () => new THREE.ConeGeometry(0.06, 0.16, 8).translate(0, 0.08, 0)), hair, head, x, 0.44, z);
      tuft.rotation.set(-0.6, 0, r);
    }
  } else {
    // Retree: round white eyes with a dark outline and a ring of star
    // specks, a small flat mouth, pixel glasses of glowing blue dots.
    for (const s of [-1, 1]) {
      const eye = onHead(new THREE.Group(), 0.155 * s, 0.02, -0.01);
      head.add(eye);
      const outline = mesh(onceC("cOutline", () => new THREE.CircleGeometry(0.1, 32)), ink, eye, 0, 0, 0.012);
      outline.castShadow = false;
      const white = mesh(onceC("cEye", () => new THREE.SphereGeometry(1, 28, 20)), onceC("cEyeMat", () => new THREE.MeshStandardMaterial({
        color: "#f4f6fb", emissive: "#dfe7ff", emissiveIntensity: 0.55, roughness: 0.3,
      })), eye, 0, 0, 0.012);
      white.scale.set(0.085, 0.085, 0.03);
      const shade = mesh(onceC("cEyeShade", () => new THREE.RingGeometry(0.05, 0.085, 32, 1, Math.PI * 1.1, Math.PI * 0.8)), onceC("cShade", () => new THREE.MeshBasicMaterial({
        color: "#9aa3b8", transparent: true, opacity: 0.55, depthWrite: false,
      })), eye, 0, 0, 0.043);
      shade.castShadow = false;
      for (let k = 0; k < 14; k++) {
        const a = (k / 14) * Math.PI * 2;
        const sp = mesh(onceC("speck", () => new THREE.SphereGeometry(0.0065, 6, 4)), basic("#ffffff"), eye, Math.cos(a) * 0.112, Math.sin(a) * 0.112, 0.02);
        sp.castShadow = false;
      }
      eyes.push(eye);
    }
    // Pixel glasses: blue dots tracing two lenses, a bridge and the arms.
    const dot = onceC("pixDot", () => new THREE.BoxGeometry(0.024, 0.024, 0.02));
    const blue = glowMat("#2448ff", 0.75);
    const place = (x: number, y: number) => {
      const d = onHead(mesh(dot, blue, head), x, y, 0.035);
      d.castShadow = false;
    };
    for (const s of [-1, 1]) {
      const cx = 0.16 * s, cy = 0.0, w = 0.13, h = 0.085;
      for (let i = 0; i <= 8; i++) {
        const x = cx - w + (2 * w * i) / 8;
        place(x, cy + h);
        if (i > 0 && i < 8) place(x, cy - h + (Math.abs(i - 4) < 3 ? -0.01 : 0));
      }
      for (let j = 1; j < 5; j++) {
        place(cx - w, cy + h - (2 * h * j) / 5);
        place(cx + w, cy + h - (2 * h * j) / 5);
      }
      // Arms to the side of the head.
      for (let j = 1; j <= 3; j++) place((0.29 + j * 0.035) * s, cy + h - 0.005);
    }
    place(0, 0.075);
    place(-0.02, 0.07);
    place(0.02, 0.07);
    mouth = onHead(mesh(onceC("cMouth", () => new RoundedBoxGeometry(0.075, 0.012, 0.01, 2, 0.005)), ink, head), 0.0, -0.17, 0.002);
    // A few star specks on the face, like the drawing.
    let seed = 3;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 16; k++) {
      const sp = onHead(mesh(onceC("faceSpeck", () => new THREE.SphereGeometry(0.006, 6, 4)), basic("#ffffff"), head), (rnd() - 0.5) * 0.66, (rnd() - 0.5) * 0.4 - 0.06, 0.002);
      sp.castShadow = false;
    }

    // Spiky mop: a cap, spikes all over the crown, and a fringe of spikes
    // hanging over the forehead, all inside the dome.
    const cap = mesh(onceC("cHairCap", () => new THREE.SphereGeometry(1, 36, 24, 0, Math.PI * 2, 0, Math.PI * 0.58)), hair, head, 0, 0.02, -0.02);
    cap.scale.set(0.47, 0.46, 0.45);
    cap.rotation.x = -0.35;
    const back = mesh(onceC("hairBack", () => new THREE.SphereGeometry(1, 32, 20)), hair, head, 0, -0.03, -0.1);
    back.scale.set(0.46, 0.42, 0.38);
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < 34; i++) {
      const yk = 1 - (i / 33) * 0.95;           // 1 at the top … 0.05
      const r = Math.sqrt(1 - yk * yk);
      const a = i * golden;
      const dir = new THREE.Vector3(Math.cos(a) * r, yk, Math.sin(a) * r);
      if (dir.z > 0.45 && dir.y < 0.75) continue;  // keep the face clear
      const base = new THREE.Vector3(dir.x * 0.42, dir.y * 0.42 + 0.02, dir.z * 0.4 - 0.03);
      // Messy: locks fall outward and down, the crown ones flick back.
      const out = dir.clone().multiplyScalar(0.8).add(new THREE.Vector3(0, -0.55 + yk * 0.2, yk > 0.8 ? -0.5 : 0)).normalize();
      const len = 0.16 + ((i * 37) % 10) * 0.012;
      const m2 = mesh(lockGeo(Math.round(len * 100) / 100, 0.085, -0.03), hair, head, base.x, base.y, base.z);
      m2.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), out);
    }
    for (const [x, len, tilt] of [[-0.3, 0.24, 0.6], [-0.2, 0.3, 0.25], [-0.09, 0.3, -0.05], [0.03, 0.33, 0.12], [0.14, 0.29, -0.2], [0.24, 0.27, -0.4], [0.32, 0.22, -0.7]]) {
      const lk = onHead(new THREE.Group(), x, 0.3, 0.035);
      head.add(lk);
      lk.rotateX(-0.2);
      const m2 = mesh(lockGeo(len, 0.1, -0.05), hair, lk);
      m2.rotation.z = tilt;
      adopt(lk);
    }
    // The bubble.
    const bubble = dome("#cfe0ff", 0.68, 0.16, "#7fa6ff");
    bubble.position.y = 0.02;
    head.add(bubble);
    keep.add(bubble);
    // A collar ring the bubble seats into.
    mesh(onceC("cCollar", () => new THREE.TorusGeometry(0.33, 0.03, 10, 48).rotateX(Math.PI / 2)), chromeTrim(), root, 0, 1.6, -0.17);
  }

  // Arms: a sleeve (rolled shirt cuff or a ribbed knit cuff) and a hand.
  const hand = skin;
  const arm = (s: number) => {
    const g = new THREE.Group();
    g.position.set(0.37 * s, 1.36, -0.16);
    root.add(g);
    mesh(onceC("chibiSleeve", () => new THREE.LatheGeometry([
      [0, 0.06], [0.07, 0.056], [0.105, 0.025], [0.11, -0.04], [0.1, -0.25], [0.09, -0.42], [0, -0.42],
    ].map(([x, y]) => new THREE.Vector2(x, y)), 24)), top, g);
    const cuffMat = quang ? top : suitMat("#23242c");
    mesh(onceC("chibiCuff", () => new THREE.TorusGeometry(0.088, 0.03, 10, 24).rotateX(Math.PI / 2)), cuffMat, g, 0, -0.42, 0);
    mesh(onceC("wrist", () => new THREE.CylinderGeometry(0.052, 0.058, 0.08, 14)), hand, g, 0, -0.47, 0);
    const palm = mesh(onceC("cPalm", () => new THREE.SphereGeometry(1, 20, 14)), hand, g, 0, -0.56, 0.01);
    palm.scale.set(0.085, 0.095, 0.062);
    for (let f = 0; f < 4; f++) {
      const finger = mesh(onceC("cFinger", () => new THREE.CapsuleGeometry(0.02, 0.06, 4, 8)), hand, g, (f - 1.5) * 0.036, -0.645, 0.03);
      finger.rotation.set(-0.5, 0, (f - 1.5) * -0.08);
    }
    const thumb = mesh(onceC("cThumb", () => new THREE.CapsuleGeometry(0.024, 0.055, 4, 8)), hand, g, -0.07 * s, -0.55, 0.05);
    thumb.rotation.set(0.5, 0, 0.8 * s);
    return g;
  };
  const armL = arm(1);
  const armR = arm(-1);

  // Legs: trousers and sneakers, standing only.
  let legL: THREE.Group | null = null, legR: THREE.Group | null = null;
  if (!seated) {
    const leg = (s: number) => {
      const g = new THREE.Group();
      g.position.set(0.16 * s, 0.72, -0.18);
      root.add(g);
      mesh(onceC("trouser", () => new THREE.LatheGeometry([
        [0, 0.06], [0.12, 0.05], [0.135, 0.0], [0.125, -0.2], [0.118, -0.4], [0, -0.4],
      ].map(([x, y]) => new THREE.Vector2(x, y)), 24)), pants, g);
      mesh(onceC("turnup", () => new THREE.TorusGeometry(0.118, 0.022, 8, 24).rotateX(Math.PI / 2)), pants, g, 0, -0.39, 0);
      const sole = mesh(onceC("snSole", () => new THREE.CylinderGeometry(0.15, 0.14, 0.06, 28)), soleM, g, 0, -0.625, 0.07);
      sole.scale.set(1, 1, 1.5);
      const upper = mesh(onceC("snUpper", () => new THREE.SphereGeometry(1, 24, 16)), shoe, g, 0, -0.53, 0.06);
      upper.scale.set(0.15, 0.11, 0.22);
      const toe = mesh(onceC("snToe", () => new THREE.SphereGeometry(1, 18, 12)), flat(quang ? "#e3e7ef" : "#34364a", 0.4), g, 0, -0.565, 0.2);
      toe.scale.set(0.11, 0.065, 0.1);
      for (let k = 0; k < 3; k++) {
        const lace = mesh(onceC("snLace", () => new RoundedBoxGeometry(0.09, 0.014, 0.02, 2, 0.006)), flat(quang ? "#35b6f2" : "#2f5bff", 0.4), g, 0, -0.46 - k * 0.028, 0.14 + k * 0.022);
        lace.rotation.x = -0.9;
      }
      mesh(onceC("snCollar", () => new THREE.TorusGeometry(0.112, 0.024, 8, 24).rotateX(Math.PI / 2)), soleM, g, 0, -0.43, 0.0);
      return g;
    };
    legL = leg(1);
    legR = leg(-1);
  }

  // Seated drivers are posed for the kart; menus lift the standing ones.
  if (!quang) {
    // Retree's stars glint a little in the dark.
    const glintMat = glowMat(lighten("#8fb0ff", 0.4), 0.8);
    for (const [x, y, z] of [[0.18, 1.3, 0.1], [-0.22, 1.05, 0.12], [0.1, 0.9, 0.14]]) {
      const st = mesh(onceC("starGlint", () => new THREE.OctahedronGeometry(0.018, 0)), glintMat, root, x, y, z);
      st.castShadow = false;
    }
  }

  return {
    root, head, eyes, mouth, torso, armL, armR, legL, legR,
    cape: null, capeBase: new Float32Array(0), keep,
  };
}
