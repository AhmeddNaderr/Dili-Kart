import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { MascotRig } from "./mascot";
import { HEAD, TORSO_PTS, basic, hairMat, onHead, onceC, skinMat, torsoGeo } from "./chibi";
import { chromeTrim, darken, fabricNormal, flat, glowMat, lighten, onceTex, suitMat, vinyl } from "./toon";
import { rimLight } from "./rim";

/**
 * Four more shop drivers, drawn from their profile pictures, on the same
 * chibi rig as Quang and Retree (same shoulders, head and hips, so they
 * drive, wave and cheer with the same animation):
 *
 *   Rehan      — messy blue-black hair and a long fringe, a cool sideways
 *                look under heavy lids, a black hoodie (hood down,
 *                drawstrings, kangaroo pocket) with a white "R" on the chest.
 *   Abu Bakker — black tousled hair over an undercut fade, calm downcast
 *                eyes, a white blazer over a black tee.
 *   Vic        — a green zombie in an orange beanie: X eyes, fangs, a long
 *                purple tongue and a string of green drool, a cross earring
 *                and hoops, a frayed sleeveless denim vest over a white
 *                shirt and a black tie.
 *   Abhishek   — slick side-swept hair, thick brows and a strong jaw, a black
 *                suit over an open-collar white shirt, a pocket square and a
 *                gold watch.
 *
 * Clothes are laid over the torso as real panels with edges (lapels,
 * pockets, the vest), parented to the torso so they breathe with it; hair
 * is built from tapered locks draped over the head. Everything static sits
 * directly under a few groups, so the kart merges it into a handful of
 * draw calls.
 */

export const CREW = ["rehan", "abubakker", "vic", "abhishek"] as const;
export type Crew = (typeof CREW)[number];
export const isCrew = (x: unknown): x is Crew => typeof x === "string" && (CREW as readonly string[]).includes(x);

type V3 = THREE.Vector3;
const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const Z = v3(0, 0, 1);
const toZ = () => Z;

/* ------------------------------------------------------------------ */
/* Surfaces                                                            */
/* ------------------------------------------------------------------ */

/** A point on the head, `lift` × its radius above it: θ down from the crown, φ round from the face (+x is the left ear). */
const ell = (th: number, ph: number, lift = 0) =>
  v3(HEAD.a * Math.sin(th) * Math.sin(ph), HEAD.b * Math.cos(th), HEAD.c * Math.sin(th) * Math.cos(ph)).multiplyScalar(1 + lift);
/** The top of the head above (x, z), raised by `lift` (points past the rim are pulled back onto it). */
function scalp(x: number, z: number, lift = 0) {
  const q = (x / HEAD.a) ** 2 + (z / HEAD.c) ** 2;
  if (q > 0.97) { const k = Math.sqrt(0.97 / q); x *= k; z *= k; }
  return v3(x, HEAD.b * Math.sqrt(Math.max(0, 1 - (x / HEAD.a) ** 2 - (z / HEAD.c) ** 2)), z).multiplyScalar(1 + lift);
}
/** Straight out of the scalp at a point. */
const headUp = (p: V3) => v3(p.x / HEAD.a ** 2, p.y / HEAD.b ** 2, p.z / HEAD.c ** 2);

// The torso is a lathe; these work in its own space (before the torso
// mesh's scale), where φ = 0 is the chest and +φ turns toward the left arm.
const PROF = new THREE.SplineCurve(TORSO_PTS.map(([x, y]) => new THREE.Vector2(x, y))).getPoints(20);
function torsoR(y: number) {
  for (let i = 1; i < PROF.length; i++) {
    const a = PROF[i - 1], b = PROF[i];
    if (b.y > a.y && y <= b.y) return a.x + (b.x - a.x) * THREE.MathUtils.clamp((y - a.y) / (b.y - a.y), 0, 1);
  }
  return 0;
}
function torsoN(phi: number, y: number, out = v3(0, 0, 0)) {
  const y1 = Math.min(0.448, y + 0.02), y0 = y - 0.02;
  const d = (torsoR(y1) - torsoR(y0)) / (y1 - y0);
  return out.set(Math.sin(phi), -d, Math.cos(phi)).normalize();
}
const _tn = v3(0, 0, 0);
function torsoAt(phi: number, y: number, off = 0, out = v3(0, 0, 0)) {
  const r = torsoR(y);
  return out.set(r * Math.sin(phi), y, r * Math.cos(phi)).addScaledVector(torsoN(phi, y, _tn), off);
}
/** Put something on the torso surface, facing out. */
function onTorso<T extends THREE.Object3D>(o: T, phi: number, y: number, off = 0): T {
  torsoAt(phi, y, off, o.position);
  o.quaternion.setFromUnitVectors(Z, torsoN(phi, y));
  return o;
}
/** Undo the torso's squash on small parts, so buttons stay round. */
const TORSO_K = v3(0.84, 0.98, 0.78);
const unsquash = (o: THREE.Object3D) => o.scale.set(1 / TORSO_K.x, 1 / TORSO_K.y, 1 / TORSO_K.z);

/**
 * A piece of cloth over the torso: rows from y0 up to y1, each spanning the
 * angles `span(y)`, `off` above the shirt and `th` thick, with walls round
 * the edge so lapels, pockets and the vest have real edges.
 */
function panelGeo(y0: number, y1: number, span: (y: number) => [number, number], off: number, th: number, rows = 16, cols = 18) {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const p = v3(0, 0, 0);
  const at = (i: number, j: number, o: number) => {
    const y = y0 + (y1 - y0) * (i / rows);
    const [a0, a1] = span(y);
    return torsoAt(a0 + (a1 - a0) * (j / cols), y, o, p);
  };
  for (let i = 0; i <= rows; i++) for (let j = 0; j <= cols; j++) {
    at(i, j, off + th);
    pos.push(p.x, p.y, p.z);
    uv.push(j / cols, i / rows);
  }
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
    const a = i * (cols + 1) + j, b = a + 1, c = a + cols + 1, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  if (th > 0) {
    // The edge, walked anticlockwise as seen from outside.
    const ring: [number, number][] = [];
    for (let j = 0; j <= cols; j++) ring.push([0, j]);
    for (let i = 1; i <= rows; i++) ring.push([i, cols]);
    for (let j = cols - 1; j >= 0; j--) ring.push([rows, j]);
    for (let i = rows - 1; i >= 1; i--) ring.push([i, 0]);
    const base = pos.length / 3;
    for (const [i, j] of ring) {
      at(i, j, off + th);
      pos.push(p.x, p.y, p.z);
      at(i, j, off);
      pos.push(p.x, p.y, p.z);
      uv.push(0, 0, 0, 0);
    }
    for (let k = 0; k < ring.length; k++) {
      const o1 = base + k * 2, i1 = o1 + 1, o2 = base + ((k + 1) % ring.length) * 2, i2 = o2 + 1;
      idx.push(o1, i1, o2, o2, i1, i2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

type Taper = (t: number) => number;
const pointed: Taper = (t) => Math.pow(1 - t, 0.7) * (1 + 0.9 * t);
const even: Taper = () => 1;
const blunt: Taper = (t) => Math.sqrt(Math.max(0, 1 - Math.pow(t, 6)));

/**
 * A tapering strip with an oval section along a path: locks of hair, lash
 * lines, cords, the tongue. `up` says which way its flat side faces.
 */
function ribbon(path: V3[], w: number, th: number, up: (p: V3) => V3, taper: Taper = pointed, n = 14, m = 8) {
  const curve = new THREE.CatmullRomCurve3(path, false, "centripetal");
  const pos: number[] = [], idx: number[] = [];
  const P = v3(0, 0, 0), T = v3(0, 0, 0), U = v3(0, 0, 0), B = v3(0, 0, 0);
  const ends: V3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    curve.getPointAt(t, P);
    curve.getTangentAt(t, T);
    U.copy(up(P));
    U.addScaledVector(T, -U.dot(T));
    if (U.lengthSq() < 1e-8) U.set(-T.y, T.x, 0.01);
    U.normalize();
    B.crossVectors(T, U).normalize();
    const f = taper(t);
    for (let j = 0; j < m; j++) {
      const a = (j / m) * Math.PI * 2, cw = Math.cos(a) * w * f, st = Math.sin(a) * th * f;
      pos.push(P.x + B.x * cw + U.x * st, P.y + B.y * cw + U.y * st, P.z + B.z * cw + U.z * st);
    }
    if (i === 0 || i === n) ends.push(P.clone());
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
    const a = i * m + j, b = i * m + ((j + 1) % m), c = a + m, d = b + m;
    idx.push(a, c, b, b, c, d);
  }
  const c0 = pos.length / 3;
  pos.push(ends[0].x, ends[0].y, ends[0].z, ends[1].x, ends[1].y, ends[1].z);
  for (let j = 0; j < m; j++) {
    idx.push(c0, j, (j + 1) % m);
    idx.push(c0 + 1, n * m + ((j + 1) % m), n * m + j);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A lock of hair over the head: path points as [θ, φ, lift]. */
const lockAt = (key: string, pts: [number, number, number][], w: number, th: number, taper: Taper = pointed) =>
  onceC(key, () => ribbon(pts.map(([t, p, l]) => ell(t, p, l)), w, th, headUp, taper));

/**
 * The base of a hairdo: the head raised by `lift`, from the crown down to a
 * hairline at θ = tmax(φ). The locks lie on top of it, so it only has to
 * hide the scalp between them.
 */
function shellGeo(lift: number | ((th: number, ph: number) => number), tmax: (ph: number) => number, rows = 22, cols = 56) {
  const pos: number[] = [], idx: number[] = [];
  for (let i = 0; i <= rows; i++) for (let j = 0; j < cols; j++) {
    const ph = -Math.PI + (j / cols) * Math.PI * 2;
    const tm = tmax(ph), th = Math.max(0.002, (i / rows) * tm);
    const edge = 0.25 + 0.75 * THREE.MathUtils.smoothstep(tm - th, 0, 0.14);
    const p = ell(th, ph, (typeof lift === "number" ? lift : lift(th, ph)) * edge);
    pos.push(p.x, p.y, p.z);
  }
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
    const a = i * cols + j, b = i * cols + ((j + 1) % cols), c = a + cols, d = b + cols;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
/** 0 at the face, 1 at the back of the head. */
const backness = (ph: number) => (1 - Math.cos(ph)) / 2;
/** A hairline: θ at the forehead, over the ears, and at the nape, dropping fast behind the ears. */
const hairline = (front: number, side: number, nape: number) => (ph: number) => {
  const b = backness(ph);
  if (b < 0.5) return front + (side - front) * (b / 0.5);
  const t = (b - 0.5) / 0.5;
  return side + (nape - side) * Math.min(1, t * (2 - t) * 1.15);
};

/* ------------------------------------------------------------------ */
/* Materials and prints                                                */
/* ------------------------------------------------------------------ */

/** Cotton fleece: deep and soft, with a cool sheen like the blue rim light in Rehan's picture. */
const fleece = (color: string, sheen: string) => onceC(`fleece${color}${sheen}`, () => rimLight(new THREE.MeshPhysicalMaterial({
  color, roughness: 0.9, sheen: 0.8, sheenRoughness: 0.5, sheenColor: new THREE.Color(sheen),
  normalMap: fabricNormal(), normalScale: new THREE.Vector2(0.22, 0.22),
}), 0.42));

/** Knit ribs as a normal map: cuffs, hems, the beanie. */
function ribNormal(rep: number) {
  return onceTex(`ribN${rep}`, () => {
    const W = 64, H = 4;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const g = c.getContext("2d")!;
    const img = g.createImageData(W, H);
    for (let x = 0; x < W; x++) {
      const dx = Math.cos((x / W) * Math.PI * 2 * 4) * 0.8;
      const n = v3(-dx, 0, 1).normalize();
      for (let y = 0; y < H; y++) {
        const i = (y * W + x) * 4;
        img.data[i] = (n.x * 0.5 + 0.5) * 255;
        img.data[i + 1] = 128;
        img.data[i + 2] = (n.z * 0.5 + 0.5) * 255;
        img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(rep, 1);
    return t;
  });
}
const ribbed = (color: string, rep = 10) => onceC(`ribbed${color}${rep}`, () => rimLight(new THREE.MeshPhysicalMaterial({
  color, roughness: 0.85, sheen: 0.7, sheenRoughness: 0.5, sheenColor: new THREE.Color(lighten(color, 0.4)),
  normalMap: ribNormal(rep), normalScale: new THREE.Vector2(0.8, 0.8),
}), 0.3));

/** Vic's beanie: orange rib knit, the grooves a shade darker. */
function beanieTex() {
  return onceTex("beanieTex", () => {
    const W = 256, H = 8;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const g = c.getContext("2d")!;
    for (let x = 0; x < W; x++) {
      const k = 0.5 + 0.5 * Math.cos((x / W) * Math.PI * 2 * 16);
      g.fillStyle = `#${new THREE.Color("#c94d06").lerp(new THREE.Color("#ff8a2a"), k).getHexString()}`;
      g.fillRect(x, 0, 1, H);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(3, 1);
    t.anisotropy = 4;
    return t;
  });
}
const beanieMat = () => onceC("beanie", () => rimLight(new THREE.MeshPhysicalMaterial({
  map: beanieTex(), roughness: 0.9, sheen: 0.8, sheenRoughness: 0.5, sheenColor: new THREE.Color("#ffc08a"),
  normalMap: ribNormal(48), normalScale: new THREE.Vector2(0.9, 0.9),
}), 0.32));

/** Washed denim for Vic's vest: twill, faded wear, a frayed hem and copper stitching round the edges. */
function denimTex() {
  return onceTex("denim", () => {
    const W = 1024, H = 384;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const g = c.getContext("2d")!;
    g.fillStyle = "#3c5f92";
    g.fillRect(0, 0, W, H);
    let seed = 5;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    // Faded patches and whiskers.
    for (let i = 0; i < 26; i++) {
      const x = rnd() * W, y = rnd() * H, r = 30 + rnd() * 90;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, "rgba(150,180,220,.28)");
      gr.addColorStop(1, "rgba(150,180,220,0)");
      g.fillStyle = gr;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // Twill: fine diagonal ribs.
    g.lineWidth = 1;
    for (let k = -H; k < W; k += 4) {
      g.strokeStyle = `rgba(${rnd() > 0.5 ? "20,35,70" : "200,220,250"},${0.12 + rnd() * 0.12})`;
      g.beginPath(); g.moveTo(k, H); g.lineTo(k + H, 0); g.stroke();
    }
    // White weft flecks.
    for (let i = 0; i < 2600; i++) {
      g.fillStyle = `rgba(230,240,255,${0.08 + rnd() * 0.16})`;
      g.fillRect(rnd() * W, rnd() * H, 2, 1);
    }
    // Lighter, worn edges and double copper stitching along the front edges and hem.
    const wear = (x0: number, y0: number, x1: number, y1: number) => {
      const gr = g.createLinearGradient(x0, y0, x1, y1);
      gr.addColorStop(0, "rgba(190,210,240,.45)");
      gr.addColorStop(1, "rgba(190,210,240,0)");
      g.fillStyle = gr;
      g.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0) || W, Math.abs(y1 - y0) || H);
    };
    wear(0, 0, 40, 0);
    wear(W, 0, W - 40, 0);
    wear(0, H, 0, H - 30);
    g.strokeStyle = "#d39a45";
    g.lineWidth = 2.2;
    g.setLineDash([7, 5]);
    for (const x of [14, 22, W - 14, W - 22]) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
    for (const y of [H - 14, H - 22]) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    g.setLineDash([]);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  });
}
const denimMat = () => onceC("denim", () => rimLight(new THREE.MeshPhysicalMaterial({
  map: denimTex(), roughness: 0.88, sheen: 0.5, sheenRoughness: 0.6, sheenColor: new THREE.Color("#9fb8e0"),
  normalMap: fabricNormal(), normalScale: new THREE.Vector2(0.35, 0.35),
}), 0.3));

/**
 * Abu Bakker's undercut: skin at the neck and temples, fading up into short
 * dark hair. `mask` draws how much skin shows instead (white = skin), for
 * the skin's sheen.
 */
function fadeTex(skin: string, hair: string, mask = false) {
  return onceTex(`fade${skin}${hair}${mask}`, () => {
    const S = 128;
    const c = document.createElement("canvas");
    c.width = c.height = S;
    const g = c.getContext("2d")!;
    const img = g.createImageData(S, S);
    const sk = new THREE.Color(skin), hr = new THREE.Color(hair), col = new THREE.Color();
    let seed = 9;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const ss = (a: number, b: number, x: number) => { const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = x / (S - 1), v = 1 - y / (S - 1);           // v = 1 up at the crown
      const sides = ss(0, 0.07, u) * ss(0, 0.07, 1 - u);     // softens into the sideburns
      let k = ss(0.12, 0.5, v) * sides;
      // Stubble: speckle where it's thin.
      k = THREE.MathUtils.clamp(k + (rnd() - 0.5) * 0.4 * k * (1 - k) * 2, 0, 1);
      if (mask) col.setRGB(1 - k, 1 - k, 1 - k);
      else col.copy(sk).lerp(hr, k * 0.96);
      const i = (y * S + x) * 4;
      const gm = mask ? 1 : 1 / 2.2;
      img.data[i] = Math.round(Math.pow(col.r, gm) * 255);
      img.data[i + 1] = Math.round(Math.pow(col.g, gm) * 255);
      img.data[i + 2] = Math.round(Math.pow(col.b, gm) * 255);
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    if (!mask) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
}

/**
 * Short hair fading into skin round the sides and back: a band over the
 * scalp from just under the hairline (`top`) down to `bottom`, so the fade
 * follows the hairline all the way round.
 */
function fadeShell(c: Ctx, key: string, skin: string, hair: string, top: (ph: number) => number, bottom: (ph: number) => number) {
  const geo = onceC(`${c.kind}:${key}`, () => {
    const rows = 16, cols = 48, p0 = 0.95, p1 = Math.PI * 2 - 0.95;
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    for (let i = 0; i <= rows; i++) for (let j = 0; j <= cols; j++) {
      const ph = p0 + (p1 - p0) * (j / cols), t0 = top(ph), t1 = bottom(ph);
      const p = ell(t0 + (t1 - t0) * (i / rows), ph, 0.014);
      pos.push(p.x, p.y, p.z);
      uv.push(j / cols, 1 - i / rows);
    }
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
      const a = i * (cols + 1) + j, b = a + 1, cc = a + cols + 1, d = cc + 1;
      idx.push(a, cc, b, b, cc, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  });
  return mesh(geo, onceC(`fadeMat${skin}${hair}`, () => rimLight(new THREE.MeshPhysicalMaterial({
    map: fadeTex(skin, hair), roughness: 0.62, sheen: 0.4, sheenRoughness: 0.6, sheenColor: new THREE.Color("#ffd9c9"),
    sheenColorMap: fadeTex(skin, hair, true), clearcoat: 0.12, clearcoatRoughness: 0.6,
  }), 0.22)), c.head);
}

const satin = (color: string) => onceC(`satin${color}`, () => rimLight(new THREE.MeshPhysicalMaterial({
  color, roughness: 0.32, sheen: 0.7, sheenRoughness: 0.35, sheenColor: new THREE.Color("#7c8296"), clearcoat: 0.35, clearcoatRoughness: 0.3,
}), 0.32));
const gold = () => onceC("gold", () => new THREE.MeshPhysicalMaterial({
  color: "#f2c15a", metalness: 1, roughness: 0.22, clearcoat: 0.6, clearcoatRoughness: 0.15,
}));
/** Anime hair with its own sheen colour; `slick` combs it glossier. */
const crewHair = (color: string, sheen: string, slick = false) => onceC(`crewHair${color}${sheen}${slick}`, () => rimLight(new THREE.MeshPhysicalMaterial({
  color, roughness: slick ? 0.4 : 0.55, clearcoat: slick ? 0.5 : 0.22, clearcoatRoughness: slick ? 0.32 : 0.45,
  sheen: 0.55, sheenRoughness: 0.4, sheenColor: new THREE.Color(sheen), envMapIntensity: slick ? 0.7 : 0.6,
}), 0.3));
const wet = (color: string, glow: string, k: number) => onceC(`wet${color}`, () => new THREE.MeshPhysicalMaterial({
  color, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05, emissive: glow, emissiveIntensity: k,
}));

/** Rehan's "R", extruded: the chest print. */
const rGeo = () => onceC("rehanR", () => {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(0, 12);
  s.lineTo(4.6, 12);
  s.absarc(4.6, 8.8, 3.2, Math.PI / 2, -Math.PI / 2, true);
  s.lineTo(7.9, 0);
  s.lineTo(5.0, 0);
  s.lineTo(2.7, 4.6);
  s.lineTo(2.7, 0);
  s.lineTo(0, 0);
  const hole = new THREE.Path();
  hole.moveTo(2.7, 7.4);
  hole.lineTo(4.5, 7.4);
  hole.absarc(4.5, 8.8, 1.4, -Math.PI / 2, Math.PI / 2, false);
  hole.lineTo(2.7, 10.2);
  hole.lineTo(2.7, 7.4);
  s.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.9, bevelEnabled: true, bevelThickness: 0.3, bevelSize: 0.25, bevelSegments: 2, curveSegments: 14 });
  g.center();
  g.scale(0.011, 0.011, 0.011);
  return g;
});

/** A small cross for Vic's earring. */
const crossGeo = () => onceC("vicCross", () => {
  const s = new THREE.Shape();
  const a = 0.6, b = 3.4, c = 1.6;   // arm half-width, long arm, short arms
  s.moveTo(-a, -b); s.lineTo(a, -b); s.lineTo(a, c - 2 * a); s.lineTo(c, c - 2 * a); s.lineTo(c, c);
  s.lineTo(a, c); s.lineTo(a, c + 1.4); s.lineTo(-a, c + 1.4); s.lineTo(-a, c); s.lineTo(-c, c);
  s.lineTo(-c, c - 2 * a); s.lineTo(-a, c - 2 * a); s.lineTo(-a, -b);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.5, bevelEnabled: true, bevelThickness: 0.2, bevelSize: 0.15, bevelSegments: 2 });
  g.center();
  g.scale(0.011, 0.011, 0.011);
  return g;
});

/* ------------------------------------------------------------------ */
/* The build                                                           */
/* ------------------------------------------------------------------ */

interface Ctx {
  kind: Crew;
  root: THREE.Group;
  head: THREE.Group;
  torso: THREE.Mesh;
  /** Cloth details on the torso (torso space, so they breathe with it). */
  wear: THREE.Group;
  keep: Set<THREE.Object3D>;
  skin: THREE.Material;
  ink: THREE.Material;
}

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}
const panel = (c: Ctx, key: string, mat: THREE.Material, y0: number, y1: number, span: (y: number) => [number, number], off: number, th: number, rows?: number, cols?: number) =>
  mesh(onceC(`${c.kind}:${key}`, () => panelGeo(y0, y1, span, off, th, rows, cols)), mat, c.wear);
/** A thin cord or seam over the torso, through [φ, y] points `off` above it. */
const seam = (c: Ctx, key: string, mat: THREE.Material, pts: [number, number][], off: number, r: number, parent: THREE.Object3D = c.wear) =>
  mesh(onceC(`${c.kind}:${key}`, () => ribbon(pts.map(([p, y]) => torsoAt(p, y, off)), r, r, toZ, even, 10, 6)), mat, parent);
/** Mirror a [φ0, φ1] span to the right side. */
const mirror = ([a, b]: [number, number]): [number, number] => [-b, -a];

interface EyeSpec {
  x: number; y: number;     // centre on the face
  w: number; h: number;     // the white's half-size
  iris: string; deep: string;
  look: [number, number];   // where both irises point
  ik: number;               // iris size against the white
  lid: number;              // upper lid: 0 wide open … 1 shut
  slant: number;            // outer corner of the lid up (+) or down (−)
  lash: number;             // lash line weight
  lower: number;            // lower lash weight (0: none)
  flick: number;            // outer lash flick
}

function buildEyes(c: Ctx, e: EyeSpec): THREE.Object3D[] {
  const ball = onceC("crewBall", () => new THREE.SphereGeometry(1, 28, 20));
  const irisM = onceC(`crewIris${e.iris}`, () => new THREE.MeshPhysicalMaterial({
    color: e.iris, roughness: 0.15, clearcoat: 1, emissive: e.deep, emissiveIntensity: 0.45,
  }));
  const out: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const eye = onHead(new THREE.Group(), e.x * s, e.y, -0.02);
    c.head.add(eye);
    mesh(ball, basic("#fbfcff"), eye).scale.set(e.w, e.h, 0.03);
    const [lx, ly] = e.look;
    const iw = e.w * e.ik, ih = e.h * e.ik * 1.04;
    mesh(ball, irisM, eye, lx, ly, 0.012).scale.set(iw, ih, 0.026);
    const ring = mesh(onceC("crewIrisRing", () => new THREE.TorusGeometry(1, 0.1, 8, 32)), flat(darken(e.iris, 0.6), 0.3), eye, lx, ly, 0.026);
    ring.scale.set(iw, ih, 0.05);
    ring.castShadow = false;
    mesh(ball, c.ink, eye, lx, ly - ih * 0.05, 0.03).scale.set(iw * 0.46, ih * 0.5, 0.012);
    for (const [gx, gy, gr] of [[-0.36, 0.36, 0.28], [0.24, -0.4, 0.14]]) {
      const gl = mesh(onceC("crewGlint", () => new THREE.SphereGeometry(1, 12, 8)), basic("#ffffff"), eye, lx + gx * iw, ly + gy * ih, 0.042);
      gl.scale.set(gr * iw, gr * iw, 0.005);
      gl.castShadow = false;
    }
    // The upper lid: skin coming down over the top of the eye, slanted.
    const cut = 1 - 2 * e.lid;
    if (e.lid > 0) {
      const lid = mesh(onceC(`crewLid${e.lid}`, () => new THREE.SphereGeometry(1, 28, 12, 0, Math.PI * 2, 0, Math.acos(cut))), c.skin, eye);
      lid.scale.set(e.w * 1.12, e.h * 1.12, 0.05);
      lid.rotation.z = e.slant * s;
      lid.castShadow = false;
    }
    // Lash line along the lid's edge, heavier toward the outer corner, flicking out.
    const lash = mesh(onceC(`${c.kind}:lash${s}`, () => {
      const W = e.w * 1.12, H = e.h * 1.12, k = Math.sqrt(Math.max(0, 1 - cut * cut));
      const ca = Math.cos(e.slant * s), sa = Math.sin(e.slant * s);
      const pts: V3[] = [];
      for (let i = 0; i <= 8; i++) {
        const al = (i / 8) * Math.PI;
        const x = -s * W * k * Math.cos(al), y = cut * H, z = 0.05 * k * Math.sin(al) + 0.006;
        pts.push(v3(x * ca - y * sa, x * sa + y * ca, z));
      }
      const end = pts[pts.length - 1];
      pts.push(v3(end.x + s * 0.028 * e.flick, end.y + 0.016 * e.flick, end.z - 0.004));
      return ribbon(pts, e.lash, 0.008, toZ, (t) => (t < 0.8 ? 0.5 + 0.6 * t : 0.98 * (1 - (t - 0.8) / 0.2) + 0.02), 18, 6);
    }), c.ink, eye);
    lash.castShadow = false;
    if (e.lower > 0) {
      const low = mesh(onceC(`${c.kind}:lower${s}`, () => {
        const pts: V3[] = [];
        for (let i = 0; i <= 5; i++) {
          const g = 0.12 * Math.PI + (i / 5) * 0.42 * Math.PI;
          pts.push(v3(s * e.w * 1.02 * Math.cos(g), -e.h * 1.02 * Math.sin(g), 0.014));
        }
        return ribbon(pts, e.lower, 0.005, toZ, pointed, 10, 6);
      }), c.ink, eye);
      low.castShadow = false;
    }
    out.push(eye);
  }
  return out;
}

/** Brows: a capsule each, `tilt` > 0 drops the inner ends (serious), `arch` bends them. */
function brows(c: Ctx, mat: THREE.Material, x: number, y: number, len: number, r: number, tilt: number) {
  for (const s of [-1, 1]) {
    const b = onHead(mesh(onceC(`crewBrow${len}${r}`, () => new THREE.CapsuleGeometry(r, len, 4, 10).rotateZ(Math.PI / 2)), mat, c.head), x * s, y, 0.006);
    b.rotateZ(tilt * s);
    b.scale.z = 0.55;
  }
}

function ears(c: Ctx, inner: string) {
  for (const s of [-1, 1]) {
    const ear = mesh(onceC("crewEar", () => new THREE.SphereGeometry(1, 20, 14)), c.skin, c.head, 0.43 * s, -0.04, -0.02);
    ear.scale.set(0.05, 0.1, 0.075);
    const inn = mesh(onceC("crewEarIn", () => new THREE.SphereGeometry(1, 14, 10)), flat(inner, 0.6), c.head, 0.455 * s, -0.045, 0);
    inn.scale.set(0.02, 0.06, 0.04);
  }
}

function nose(c: Ctx, w = 0.022, y = -0.1) {
  const n = onHead(mesh(onceC("crewNose", () => new THREE.SphereGeometry(1, 14, 10)), c.skin, c.head), 0, y, -0.004);
  n.scale.set(w, w * 0.75, w * 0.85);
}

/** A small mouth: an arc of the given radius and sweep, its middle turned to `turn`. */
function arcMouth(c: Ctx, r: number, sweep: number, tube: number, turn: number, x = 0.0, y = -0.19) {
  const m = onHead(new THREE.Group(), x, y, 0.002);
  c.head.add(m);
  const a = mesh(onceC(`crewArc${r}${sweep}${tube}`, () => new THREE.TorusGeometry(r, tube, 6, 20, sweep)), c.ink, m);
  a.rotation.z = turn - sweep / 2;
  a.scale.z = 0.5;
  a.castShadow = false;
  return m;
}

interface ArmSpec {
  sleeve: THREE.Material;
  profile: number[][];      // sleeve lathe, from the shoulder down
  cuff?: [THREE.Material, number, number, number];   // material, y, radius, tube
  forearm?: THREE.Material;  // bare forearm below a short sleeve
  hand: THREE.Material;
  extra?: (g: THREE.Group, s: number) => void;
}
const SLEEVE = [[0, 0.06], [0.07, 0.056], [0.105, 0.025], [0.11, -0.04], [0.1, -0.25], [0.09, -0.42], [0, -0.42]];

function arm(c: Ctx, s: number, a: ArmSpec) {
  const g = new THREE.Group();
  g.position.set(0.37 * s, 1.36, -0.16);
  c.root.add(g);
  mesh(onceC(`crewSleeve${a.profile.flat().join()}`, () => new THREE.LatheGeometry(a.profile.map(([x, y]) => new THREE.Vector2(x, y)), 24)), a.sleeve, g);
  if (a.cuff) {
    const [m, y, r, tube] = a.cuff;
    mesh(onceC(`crewCuff${r}${tube}`, () => new THREE.TorusGeometry(r, tube, 10, 24).rotateX(Math.PI / 2)), m, g, 0, y, 0);
  }
  if (a.forearm) {
    mesh(onceC("crewForearm", () => new THREE.LatheGeometry([
      [0, -0.1], [0.072, -0.12], [0.074, -0.2], [0.066, -0.34], [0.058, -0.45], [0, -0.46],
    ].map(([x, y]) => new THREE.Vector2(x, y)), 20)), a.forearm, g);
  }
  mesh(onceC("wrist", () => new THREE.CylinderGeometry(0.052, 0.058, 0.08, 14)), a.hand, g, 0, -0.47, 0);
  const palm = mesh(onceC("cPalm", () => new THREE.SphereGeometry(1, 20, 14)), a.hand, g, 0, -0.56, 0.01);
  palm.scale.set(0.085, 0.095, 0.062);
  for (let f = 0; f < 4; f++) {
    const finger = mesh(onceC("cFinger", () => new THREE.CapsuleGeometry(0.02, 0.06, 4, 8)), a.hand, g, (f - 1.5) * 0.036, -0.645, 0.03);
    finger.rotation.set(-0.5, 0, (f - 1.5) * -0.08);
  }
  const thumb = mesh(onceC("cThumb", () => new THREE.CapsuleGeometry(0.024, 0.055, 4, 8)), a.hand, g, -0.07 * s, -0.55, 0.05);
  thumb.rotation.set(0.5, 0, 0.8 * s);
  a.extra?.(g, s);
  return g;
}

interface LegSpec {
  pants: THREE.Material;
  hem: "turnup" | "rib" | "plain";
  hemMat?: THREE.Material;
  upper: THREE.Material;
  sole: THREE.Material;
  toe: THREE.Material;
  lace: THREE.Material;
  collar: THREE.Material;
  laces?: boolean;
}
function leg(c: Ctx, s: number, l: LegSpec) {
  const g = new THREE.Group();
  g.position.set(0.16 * s, 0.72, -0.18);
  c.root.add(g);
  mesh(onceC("trouser", () => new THREE.LatheGeometry([
    [0, 0.06], [0.12, 0.05], [0.135, 0.0], [0.125, -0.2], [0.118, -0.4], [0, -0.4],
  ].map(([x, y]) => new THREE.Vector2(x, y)), 24)), l.pants, g);
  if (l.hem === "turnup") mesh(onceC("turnup", () => new THREE.TorusGeometry(0.118, 0.022, 8, 24).rotateX(Math.PI / 2)), l.hemMat ?? l.pants, g, 0, -0.39, 0);
  if (l.hem === "rib") mesh(onceC("crewAnkleRib", () => new THREE.CylinderGeometry(0.105, 0.112, 0.07, 20)), l.hemMat ?? l.pants, g, 0, -0.39, 0);
  const sole = mesh(onceC("snSole", () => new THREE.CylinderGeometry(0.15, 0.14, 0.06, 28)), l.sole, g, 0, -0.625, 0.07);
  sole.scale.set(1, 1, 1.5);
  const upper = mesh(onceC("snUpper", () => new THREE.SphereGeometry(1, 24, 16)), l.upper, g, 0, -0.53, 0.06);
  upper.scale.set(0.15, 0.11, 0.22);
  const toe = mesh(onceC("snToe", () => new THREE.SphereGeometry(1, 18, 12)), l.toe, g, 0, -0.565, 0.2);
  toe.scale.set(0.11, 0.065, 0.1);
  if (l.laces !== false) {
    for (let k = 0; k < 3; k++) {
      const lace = mesh(onceC("snLace", () => new RoundedBoxGeometry(0.09, 0.014, 0.02, 2, 0.006)), l.lace, g, 0, -0.46 - k * 0.028, 0.14 + k * 0.022);
      lace.rotation.x = -0.9;
    }
  }
  mesh(onceC("snCollar", () => new THREE.TorusGeometry(0.112, 0.024, 8, 24).rotateX(Math.PI / 2)), l.collar, g, 0, -0.43, 0.0);
  return g;
}

/** A collar band round the back of the neck (root space), its ends at the front of the shoulders. */
function neckBand(c: Ctx, key: string, mat: THREE.Material, spread: number, y: number, back: number, w: number, th: number, front = 0.0, taper: Taper = (t) => 0.75 + 0.25 * Math.sin(Math.PI * t)) {
  return mesh(onceC(`${c.kind}:${key}`, () => ribbon([
    v3(spread * 0.8, y - 0.06, front), v3(spread, y - 0.02, -0.12), v3(spread * 0.62, y + 0.01, back + 0.06),
    v3(0, y + 0.02, back), v3(-spread * 0.62, y + 0.01, back + 0.06), v3(-spread, y - 0.02, -0.12), v3(-spread * 0.8, y - 0.06, front),
  ], w, th, (p) => v3(p.x, 0, p.z + 0.17), taper, 24, 8)), mat, c.root);
}

export function buildCrew(kind: Crew, seated: boolean): MascotRig {
  const root = new THREE.Group();
  const keep = new Set<THREE.Object3D>();
  const head = new THREE.Group();
  head.position.set(0, 1.98, -0.16);
  root.add(head);
  const skinTone = { rehan: "#f3d2b8", abubakker: "#eec8a6", vic: "#8cc551", abhishek: "#d9a179" }[kind];
  const skin = kind === "vic"
    ? onceC("vicSkin", () => rimLight(new THREE.MeshPhysicalMaterial({
      color: skinTone, roughness: 0.6, sheen: 0.5, sheenRoughness: 0.5, sheenColor: new THREE.Color("#d8ff9a"), clearcoat: 0.2, clearcoatRoughness: 0.5,
    }), 0.3))
    : skinMat(skinTone);
  const top = {
    rehan: fleece("#1b1c23", "#3a4b80"),
    abubakker: suitMat("#f1f0ec"),
    vic: suitMat("#f1f1ec"),
    abhishek: suitMat("#18181c"),
  }[kind];
  const torso = mesh(torsoGeo(), top, root, 0, 1.1, -0.18);
  torso.scale.copy(TORSO_K);
  const wear = new THREE.Group();
  torso.add(wear);
  const c: Ctx = { kind, root, head, torso, wear, keep, skin, ink: flat("#15161f", 0.35) };

  mesh(onceC("neck", () => new THREE.CylinderGeometry(0.11, 0.13, 0.22, 18)), skin, root, 0, 1.56, -0.17);
  const skull = mesh(onceC("chibiHead", () => new THREE.SphereGeometry(1, 48, 36)), skin, head);
  skull.scale.set(HEAD.a, HEAD.b, HEAD.c);
  const jaw = mesh(onceC("jaw", () => new THREE.SphereGeometry(1, 32, 24)), skin, head, 0, kind === "abhishek" ? -0.125 : -0.12, 0);
  if (kind === "abhishek") jaw.scale.set(0.378, 0.305, 0.334);
  else jaw.scale.set(0.37, 0.3, 0.33);

  const build = { rehan, abubakker, vic, abhishek }[kind];
  const { eyes, mouth, arms, legs } = build(c);

  const hips = mesh(onceC("hips", () => new THREE.CylinderGeometry(0.33, 0.3, 0.16, 28)), legs.pants, root, 0, 0.72, -0.18);
  hips.scale.z = 0.82;
  const armL = arm(c, 1, arms);
  const armR = arm(c, -1, arms);
  let legL: THREE.Group | null = null, legR: THREE.Group | null = null;
  if (!seated) {
    legL = leg(c, 1, legs);
    legR = leg(c, -1, legs);
  }
  return { root, head, eyes, mouth, torso, armL, armR, legL, legR, cape: null, capeBase: new Float32Array(0), keep };
}

interface Look { eyes: THREE.Object3D[]; mouth: THREE.Object3D; arms: ArmSpec; legs: LegSpec }

/* ------------------------------------------------------------------ */
/* Rehan                                                               */
/* ------------------------------------------------------------------ */

function rehan(c: Ctx): Look {
  const hair = crewHair("#16171f", "#5a78d8");
  const fl = fleece("#1b1c23", "#3a4b80");
  const rib = ribbed("#17181e", 14);
  const white = onceC("rehanPrint", () => new THREE.MeshStandardMaterial({ color: "#f4f6ff", emissive: "#ffffff", emissiveIntensity: 0.1, roughness: 0.5 }));
  const cord = flat("#e7eaf2", 0.55);

  // Hoodie: kangaroo pocket, ribbed hem, the hood lying down round the
  // neck and over the shoulders, drawstrings with metal tips, the "R".
  const pk = (y: number): [number, number] => { const k = 0.47 + ((0.03 - y) / 0.24) * 0.15; return [-k, k]; };
  panel(c, "pocket", fl, -0.21, 0.03, pk, 0.004, 0.016, 8, 20);
  for (const s of [-1, 1]) seam(c, `pocketLip${s}`, rib, [[s * 0.47, 0.03], [s * 0.54, -0.09], [s * 0.62, -0.21]], 0.022, 0.009);
  seam(c, "pocketTop", onceC("rehanSeam", () => new THREE.MeshStandardMaterial({ color: "#2a2c37", roughness: 0.8 })), [[-0.45, 0.026], [0, 0.03], [0.45, 0.026]], 0.022, 0.005);
  panel(c, "hem", rib, -0.31, -0.22, () => [-Math.PI, Math.PI], 0.006, 0.014, 3, 48);
  const roll = neckBand(c, "hood", fl, 0.25, 1.5, -0.36, 0.085, 0.07, 0.07, (t) => 0.42 + 0.58 * Math.sin(Math.PI * t));
  roll.castShadow = true;
  const hood = mesh(onceC("rehanHoodBack", () => new THREE.SphereGeometry(1, 24, 16)), fl, c.root, 0, 1.33, -0.5);
  hood.scale.set(0.25, 0.2, 0.09);
  hood.rotation.x = 0.28;
  seam(c, "hoodSeam", c.ink, [[Math.PI - 0.001, 0.36], [Math.PI, 0.2], [Math.PI + 0.001, 0.05]], 0.12, 0.004);
  const tip = onceC("rehanAglet", () => new THREE.CylinderGeometry(0.011, 0.009, 0.04, 10));
  for (const s of [-1, 1]) {
    seam(c, `cord${s}`, cord, [[s * 0.15, 0.4], [s * 0.16, 0.33], [s * 0.168, 0.26], [s * 0.17, 0.2]], 0.026, 0.011);
    const a = mesh(tip, chromeTrim(), c.wear);
    torsoAt(s * 0.17, 0.18, 0.026, a.position);
    const eyelet = onTorso(mesh(onceC("rehanEyelet", () => new THREE.TorusGeometry(0.016, 0.005, 6, 14)), chromeTrim(), c.wear), s * 0.15, 0.4, 0.03);
    unsquash(eyelet);
  }
  const r = onTorso(mesh(rGeo(), white, c.wear), 0, 0.12, 0.012);
  unsquash(r);

  // Face: heavy lids, a cool look off to the side, straight serious brows.
  ears(c, "#e3ad92");
  const eyes = buildEyes(c, {
    x: 0.158, y: -0.025, w: 0.084, h: 0.094, iris: "#3c5291", deep: "#1b2a60", look: [-0.026, -0.006], ik: 0.72,
    lid: 0.36, slant: 0.05, lash: 0.014, lower: 0.0045, flick: 1,
  });
  brows(c, hair, 0.16, 0.14, 0.085, 0.014, 0.16);
  nose(c);
  const mouth = onHead(new THREE.Group(), 0.012, -0.195, 0.002);
  c.head.add(mouth);
  const line = mesh(onceC("rehanMouth", () => new RoundedBoxGeometry(0.062, 0.012, 0.01, 2, 0.005)), c.ink, mouth);
  line.rotation.z = -0.08;
  line.castShadow = false;

  // Hair: a shell from a high front hairline down to the nape, a long
  // messy fringe swept to his right, locks over the ears, two layers of
  // spiky locks down the back and a few crown tufts.
  mesh(onceC("rehan:shell", () => shellGeo(0.05, hairline(0.95, 1.55, 2.32))), hair, c.head);
  const ends = [1.3, 1.38, 1.26, 1.45, 1.32, 1.5, 1.36, 1.44, 1.28, 1.4, 1.25, 1.34, 1.22, 1.27];
  ends.forEach((te, i) => {
    const u = (i / (ends.length - 1)) * 2 - 1;
    const p0 = u * 0.95, sw = -0.3 + u * 0.05;
    const lift = te > 1.36 ? 0.14 : 0.11;
    mesh(lockAt(`rehan:fr${i}`, [
      [0.36, p0 * 0.7, 0.1], [0.8, p0 * 0.92 + sw * 0.4, 0.15], [1.08, p0 + sw * 0.75, 0.13], [te, p0 + sw + (i % 3 - 1) * 0.05, lift],
    ], 0.058 + (i % 3) * 0.006, 0.026), hair, c.head);
  });
  for (const s of [-1, 1]) {
    for (let k = 0; k < 4; k++) {
      const p0 = s * (1.02 + k * 0.12), te = 1.78 + k * 0.08 - (s > 0 ? 0 : 0.06);
      mesh(lockAt(`rehan:side${s}${k}`, [
        [0.7, p0, 0.09], [1.2, p0 + s * 0.05, 0.1], [te - 0.15, p0 + s * 0.02 - 0.06 * s, 0.1], [te, p0 - s * 0.1, 0.15],
      ], 0.062, 0.03), hair, c.head);
    }
  }
  for (let k = 0; k < 9; k++) {
    const p0 = Math.PI + (k / 8 - 0.5) * 2.7;
    mesh(lockAt(`rehan:bu${k}`, [
      [0.3, p0, 0.1], [0.8, p0 + 0.03, 0.16], [1.25, p0 + 0.05, 0.16], [1.5 + (k % 2) * 0.12, p0 + (k % 2 ? 0.1 : -0.1), 0.22],
    ], 0.078, 0.036), hair, c.head);
  }
  for (let k = 0; k < 11; k++) {
    const p0 = Math.PI + ((k + 0.5) / 11 - 0.5) * 3.0, te = 2.2 + (k % 3) * 0.07 - Math.abs(k - 5) * 0.03;
    mesh(lockAt(`rehan:bl${k}`, [
      [0.95, p0, 0.08], [1.5, p0 + 0.04, 0.1], [te - 0.2, p0 + 0.06, 0.1], [te, p0 + (k % 2 ? 0.12 : -0.12), 0.16],
    ], 0.074, 0.034), hair, c.head);
  }
  for (const [t0, p0, l] of [[0.25, 2.6, 0.26], [0.2, 3.3, 0.3], [0.32, 3.9, 0.24], [0.38, 2.2, 0.22], [0.16, 2.95, 0.32], [0.4, 3.6, 0.22]]) {
    mesh(lockAt(`rehan:tuft${t0}${p0}`, [[t0 - 0.1, p0, 0.07], [t0 + 0.12, p0, 0.16], [t0 + 0.32, p0 + 0.08, l]], 0.05, 0.03), hair, c.head);
  }
  mesh(lockAt("rehan:ahoge", [[0.1, 0.4, 0.06], [0.02, 0.9, 0.2], [0.2, 1.4, 0.31], [0.34, 1.25, 0.3]], 0.024, 0.014), hair, c.head);

  return {
    eyes, mouth,
    arms: {
      sleeve: fl, hand: c.skin,
      profile: [[0, 0.07], [0.075, 0.066], [0.115, 0.03], [0.122, -0.05], [0.115, -0.24], [0.103, -0.38], [0, -0.38]],
      cuff: [rib, -0.4, 0.08, 0.034],
    },
    legs: {
      pants: fleece("#1e1f27", "#3a4b80"), hem: "rib", hemMat: rib,
      upper: vinyl("#f4f5f8"), sole: flat("#17181f", 0.45), toe: flat("#e4e7ef", 0.4), lace: flat("#3d8bff", 0.4), collar: flat("#17181f", 0.45),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Abu Bakker                                                          */
/* ------------------------------------------------------------------ */

function abubakker(c: Ctx): Look {
  const hair = crewHair("#131317", "#7d8396");
  const blazer = suitMat("#f1f0ec");
  const tee = suitMat("#141418");
  const btn = vinyl("#26272e");

  // A black tee in the V of a white blazer: notched lapels, a button,
  // hip flaps and a breast welt.
  const V = (y: number) => 0.02 + Math.max(0, y) * 0.9;
  panel(c, "tee", tee, 0.0, 0.43, (y) => [-V(y), V(y)], 0.003, 0, 12, 12);
  const crew = mesh(onceC("abuCrew", () => new THREE.TorusGeometry(0.145, 0.022, 8, 32).rotateX(Math.PI / 2)), ribbed("#141418", 18), c.root, 0, 1.525, -0.17);
  crew.scale.z = 0.92;
  for (const s of [-1, 1]) {
    const lapel = (y: number): [number, number] => [V(y) - 0.012, V(y) + 0.07 + y * 0.33];
    const coll = (y: number): [number, number] => [V(y) - 0.012, V(y) + 0.1];
    panel(c, `lapel${s}`, blazer, 0.0, 0.315, s > 0 ? lapel : (y) => mirror(lapel(y)), 0.006, 0.014, 12, 6);
    panel(c, `collar${s}`, blazer, 0.34, 0.425, s > 0 ? coll : (y) => mirror(coll(y)), 0.006, 0.014, 4, 6);
    seam(c, `edge${s}`, flat("#c9cacf", 0.7), [[s * 0.012, -0.02], [s * 0.06, -0.16], [s * 0.16, -0.3]], 0.004, 0.004);
    panel(c, `hipFlap${s}`, blazer, -0.18, -0.125, () => (s > 0 ? [0.55, 0.95] : [-0.95, -0.55]), 0.004, 0.011, 2, 8);
  }
  panel(c, "welt", blazer, 0.12, 0.155, () => [0.44, 0.74], 0.004, 0.009, 2, 8);
  for (const y of [-0.02, -0.16]) unsquash(onTorso(mesh(onceC("crewBtn", () => new THREE.CylinderGeometry(0.019, 0.019, 0.009, 16).rotateX(Math.PI / 2)), btn, c.wear), 0, y, 0.008));
  neckBand(c, "collar", blazer, 0.19, 1.5, -0.335, 0.05, 0.024, -0.02);

  // Face: calm, downcast eyes under heavy lids, soft brows, a small smile.
  ears(c, "#dca386");
  const eyes = buildEyes(c, {
    x: 0.158, y: -0.035, w: 0.084, h: 0.09, iris: "#4a3426", deep: "#20150d", look: [0.0, -0.034], ik: 0.74,
    lid: 0.56, slant: -0.05, lash: 0.016, lower: 0, flick: 0.7,
  });
  brows(c, hair, 0.158, 0.138, 0.1, 0.011, -0.05);
  nose(c);
  const mouth = arcMouth(c, 0.032, Math.PI * 0.55, 0.0065, -Math.PI / 2, 0.01, -0.2);

  // Hair: an undercut fade round the sides and back, and a mop of tousled
  // locks on top, falling forward and to his left.

  // The top: a full mound of hair, with locks over it falling forward and
  // flicking out at the edges.
  const TM = (ph: number) => 0.94 + 0.2 * backness(ph);
  const mound = (th: number, ph: number) => 0.06 + 0.16 * Math.max(0, 1 - (th / TM(ph)) ** 2);
  const on = (pts: [number, number, number][]) => pts.map(([t, p, e]): [number, number, number] => [t, p, mound(t, p) + e]);
  mesh(onceC("abu:shell", () => shellGeo(mound, TM)), hair, c.head);
  fadeShell(c, "fade", "#eec8a6", "#1b1b21", (ph) => TM(ph) - 0.1, (ph) => 1.98 + 0.12 * backness(ph));
  for (let i = 0; i < 9; i++) {
    const p0 = -0.76 + i * 0.19, te = 1.06 + (i % 3) * 0.05;
    mesh(lockAt(`abu:fr${i}`, on([
      [0.15, p0 * 0.4, 0.04], [0.5, p0 * 0.8 + 0.08, 0.06], [0.85, p0 + 0.18, 0.06], [te, p0 + 0.3 + (i % 2) * 0.08, 0.1 + (i % 2) * 0.04],
    ]), 0.074, 0.04), hair, c.head);
  }
  const reach = [0.02, -0.16, 0.08, -0.08, 0.12, -0.2];
  for (let k = 0; k < 12; k++) {
    const p0 = (k / 12) * Math.PI * 2 + 0.2, d = k % 2 ? 0.42 : -0.34, te = TM(p0) + reach[k % 6];
    mesh(lockAt(`abu:top${k}`, on([
      [0.1, p0, 0.03], [0.45, p0 + d * 0.3, 0.06], [te - 0.25, p0 + d * 0.7, 0.07], [te, p0 + d, 0.12 + (k % 3) * 0.05],
    ]), 0.08, 0.042), hair, c.head);
  }
  for (let k = 0; k < 8; k++) {
    const p0 = Math.PI + (k / 7 - 0.5) * 2.4, d = k % 2 ? 0.3 : -0.25;
    mesh(lockAt(`abu:back${k}`, on([[0.4, p0, 0.04], [0.8, p0 + d * 0.5, 0.05], [TM(p0) + reach[(k + 2) % 6] * 0.8 + 0.06, p0 + d, 0.09 + (k % 3) * 0.03]]), 0.08, 0.04), hair, c.head);
  }
  for (const [t0, p0, d] of [[0.05, 0.9, 0.5], [0.12, 2.3, -0.5], [0.1, 3.6, 0.6], [0.18, 5.0, -0.5], [0.08, -0.2, 0.45], [0.2, 1.6, -0.6], [0.25, 2.9, 0.5], [0.22, 4.3, -0.4]]) {
    mesh(lockAt(`abu:mess${p0}`, on([[t0, p0, 0.05], [t0 + 0.2, p0 + d * 0.6, 0.13], [t0 + 0.4, p0 + d, 0.17]]), 0.058, 0.034), hair, c.head);
  }

  return {
    eyes, mouth,
    arms: {
      sleeve: blazer, hand: c.skin, profile: SLEEVE,
      cuff: [blazer, -0.42, 0.088, 0.026],
      extra: (g, s) => {
        for (let k = 0; k < 3; k++) {
          const b = mesh(onceC("abuCuffBtn", () => new THREE.CylinderGeometry(0.011, 0.011, 0.008, 10).rotateZ(Math.PI / 2)), btn, g, 0.1 * s, -0.33 - k * 0.03, -0.02);
          b.rotation.y = -0.2 * s;
        }
      },
    },
    legs: {
      pants: suitMat("#16161b"), hem: "plain",
      upper: vinyl("#f6f6f7"), sole: flat("#e3e4e8", 0.5), toe: flat("#ececf0", 0.4), lace: flat("#dcdde2", 0.5), collar: flat("#e3e4e8", 0.5),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Vic                                                                 */
/* ------------------------------------------------------------------ */

function vic(c: Ctx): Look {
  const shirt = suitMat("#f1f1ec");
  const tie = satin("#141318");
  const denim = denimMat();
  const fray = flat("#a8bedc", 0.8);
  const deep = flat("#5c8a2e", 0.6);

  // White shirt and black tie under a frayed, sleeveless denim vest.
  for (const s of [-1, 1]) {
    const pt = (y: number): [number, number] => [0.045 + (0.43 - y) * 0.55, 0.3 - (0.43 - y) * 1.9];
    panel(c, `collarPt${s}`, shirt, 0.34, 0.43, s > 0 ? pt : (y) => mirror(pt(y)), 0.006, 0.009, 5, 6);
  }
  const knot = onTorso(mesh(onceC("vicKnot", () => new RoundedBoxGeometry(0.075, 0.06, 0.035, 2, 0.014)), tie, c.wear), 0, 0.37, 0.02);
  unsquash(knot);
  const blade = (y: number): [number, number] => { const h = y < -0.1 ? (0.086 * (y + 0.16)) / 0.06 : 0.04 + (0.355 - y) * 0.1; return [-h, h]; };
  panel(c, "tie", tie, -0.16, 0.355, blade, 0.006, 0.012, 14, 4);
  const open = (y: number) => 0.38 + Math.max(0, y) * 0.95;
  const vest = panel(c, "vest", denim, -0.3, 0.42, (y) => [open(y), Math.PI * 2 - open(y)], 0.008, 0.018, 16, 48);
  vest.castShadow = true;
  for (const s of [-1, 1]) {
    const fl = (): [number, number] => (s > 0 ? [0.76, 1.16] : [-1.16, -0.76]);
    panel(c, `flap${s}`, denim, 0.13, 0.2, fl, 0.028, 0.012, 2, 6);
    unsquash(onTorso(mesh(onceC("vicStud", () => new THREE.CylinderGeometry(0.014, 0.014, 0.01, 12).rotateX(Math.PI / 2)), chromeTrim(), c.wear), s * 0.96, 0.135, 0.044));
  }
  neckBand(c, "vestCollar", denim, 0.23, 1.5, -0.35, 0.055, 0.026, 0.0);
  // Frayed threads along the hem.
  const thread = (len: number) => onceC(`vicThread${len}`, () => new THREE.CylinderGeometry(0.0045, 0.002, len, 4).translate(0, -len / 2, 0));
  let seed = 4;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let a = open(-0.3) + 0.03; a < Math.PI * 2 - open(-0.3); a += 0.055) {
    const t = mesh(thread([0.025, 0.035, 0.045][Math.floor(rnd() * 3)]), fray, c.wear);
    torsoAt(a, -0.3, 0.017, t.position);
    t.rotation.set((rnd() - 0.5) * 0.4, 0, (rnd() - 0.5) * 0.5);
    t.castShadow = false;
  }
  const pin = onTorso(new THREE.Group(), 0.98, -0.04, 0.03);
  c.wear.add(pin);
  unsquash(pin);
  mesh(onceC("vicPin", () => new THREE.CylinderGeometry(0.038, 0.038, 0.012, 20).rotateX(Math.PI / 2)), vinyl("#8a3df0"), pin);
  for (const r of [0.785, -0.785]) mesh(onceC("vicPinX", () => new RoundedBoxGeometry(0.05, 0.012, 0.01, 2, 0.004)), glowMat("#8dff4a", 0.5), pin, 0, 0, 0.008).rotation.z = r;

  // Face: X eyes in sunken sockets, stitches, an open mouth with fangs, a
  // long purple tongue and a string of drool.
  ears(c, "#5c8a2e");
  const eyes: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const eye = onHead(new THREE.Group(), 0.158 * s, -0.01, -0.006);
    c.head.add(eye);
    const sock = mesh(onceC("vicSocket", () => new THREE.CircleGeometry(0.1, 28)), deep, eye, 0, 0, 0.004);
    sock.scale.set(s > 0 ? 1.05 : 0.95, 0.92, 1);
    sock.castShadow = false;
    const big = s > 0 ? 1.08 : 0.94;
    for (const r of [0.785, -0.785]) {
      const bar = mesh(onceC("vicX", () => new THREE.CapsuleGeometry(0.017, 0.11, 4, 10)), c.ink, eye, 0, 0, 0.012);
      bar.rotation.z = r;
      bar.scale.set(1, big, 0.55);
      bar.castShadow = false;
    }
    eyes.push(eye);
  }
  const stitch = onHead(new THREE.Group(), -0.25, -0.08, 0.004);
  c.head.add(stitch);
  mesh(onceC("vicScar", () => new THREE.CapsuleGeometry(0.006, 0.12, 4, 6).rotateZ(Math.PI / 2 - 0.35)), deep, stitch);
  for (let k = 0; k < 4; k++) {
    const st = mesh(onceC("vicStitch", () => new THREE.CapsuleGeometry(0.0045, 0.03, 3, 6)), c.ink, stitch, -0.045 + k * 0.03, -0.016 + k * 0.011, 0.004);
    st.rotation.z = -0.35;
    st.castShadow = false;
  }
  for (const s of [-1, 1]) {
    const n = onHead(mesh(onceC("vicNostril", () => new THREE.SphereGeometry(1, 10, 8)), deep, c.head), 0.018 * s, -0.11, 0.002);
    n.scale.set(0.009, 0.006, 0.004);
  }
  const mouth = onHead(new THREE.Group(), 0, -0.2, 0.002);
  c.head.add(mouth);
  const hole = mesh(onceC("vicMouth", () => new THREE.CircleGeometry(1, 32, Math.PI, Math.PI)), flat("#3a0d22", 0.7), mouth, 0, 0.034, 0.002);
  hole.scale.set(0.125, 0.1, 1);
  hole.castShadow = false;
  const lip = mesh(onceC("vicLip", () => new THREE.TorusGeometry(1, 0.06, 6, 24, Math.PI)), flat("#4f7a28", 0.6), mouth, 0, 0.034, 0.003);
  lip.scale.set(0.128, 0.103, 0.3);
  lip.rotation.z = Math.PI;
  lip.castShadow = false;
  const teeth = mesh(onceC("vicTeeth", () => new RoundedBoxGeometry(0.2, 0.028, 0.012, 2, 0.006)), basic("#f6f3e6"), mouth, 0, 0.021, 0.006);
  teeth.castShadow = false;
  for (const s of [-1, 1]) {
    const fang = mesh(onceC("vicFang", () => new THREE.ConeGeometry(0.018, 0.056, 10).rotateX(Math.PI)), basic("#fbf8ec"), mouth, 0.068 * s, -0.012, 0.008);
    fang.scale.z = 0.6;
    fang.castShadow = false;
  }
  const tongue = mesh(onceC("vicTongue", () => ribbon([
    v3(0, -0.2, 0.33), v3(0.0, -0.245, 0.385), v3(0.01, -0.31, 0.38), v3(0.02, -0.37, 0.345), v3(0.026, -0.41, 0.3),
  ], 0.05, 0.02, headUp, blunt, 16, 10)), wet("#a64ae6", "#4a1477", 0.25), c.head);
  tongue.castShadow = true;
  mesh(onceC("vicTongueLine", () => ribbon([
    v3(0.001, -0.25, 0.402), v3(0.011, -0.31, 0.398), v3(0.02, -0.355, 0.37),
  ], 0.004, 0.003, headUp, pointed, 10, 6)), flat("#6b1f9c", 0.5), c.head).castShadow = false;
  const goo = wet("#94ff5a", "#3fb816", 0.5);
  mesh(onceC("vicDrool", () => ribbon([
    v3(-0.075, -0.205, 0.345), v3(-0.082, -0.25, 0.35), v3(-0.086, -0.3, 0.335), v3(-0.088, -0.335, 0.325),
  ], 0.008, 0.008, headUp, (t) => 0.9 - 0.5 * t, 12, 8)), goo, c.head);
  mesh(onceC("vicDrop", () => new THREE.SphereGeometry(0.019, 16, 12)), goo, c.head, -0.088, -0.35, 0.322).scale.y = 1.25;

  // Earrings: a cross on his left ear, two hoops on his right.
  const cross = mesh(crossGeo(), chromeTrim(), c.head, 0.47, -0.2, -0.01);
  cross.rotation.y = Math.PI / 2;
  mesh(onceC("vicRing", () => new THREE.TorusGeometry(0.012, 0.004, 6, 14)), chromeTrim(), c.head, 0.47, -0.145, -0.01).rotation.y = Math.PI / 2;
  for (const [y, z, r] of [[-0.16, 0.0, 0.034], [-0.13, -0.03, 0.026]]) {
    const hoop = mesh(onceC(`vicHoop${r}`, () => new THREE.TorusGeometry(r, 0.0055, 8, 24)), chromeTrim(), c.head, -0.468, y, z);
    hoop.rotation.y = Math.PI / 2;
  }

  // Beanie: a slouchy rib-knit crown and a thick folded cuff, tilted back,
  // with a little label.
  const hat = new THREE.Group();
  hat.position.set(0, 0.03, -0.02);
  hat.rotation.x = -0.26;
  c.head.add(hat);
  const knit = beanieMat();
  const crown = mesh(onceC("vicCrown", () => new THREE.SphereGeometry(1, 40, 24, 0, Math.PI * 2, 0, 1.5)), knit, hat, 0, 0.0, 0);
  crown.scale.set(0.482, 0.53, 0.47);
  const cuff = mesh(onceC("vicCuff", () => new THREE.LatheGeometry([
    [1.0, -0.005], [1.07, 0.0], [1.095, 0.05], [1.09, 0.1], [1.06, 0.135], [0.99, 0.14],
  ].map(([x, y]) => new THREE.Vector2(x, y)), 48)), onceC("vicCuffMat", () => rimLight(new THREE.MeshPhysicalMaterial({
    map: beanieTex(), roughness: 0.9, sheen: 0.8, sheenRoughness: 0.5, sheenColor: new THREE.Color("#ffc08a"),
    normalMap: ribNormal(60), normalScale: new THREE.Vector2(1, 1),
  }), 0.32)), hat, 0, 0.02, 0);
  cuff.scale.set(0.482, 1, 0.47);
  const label = mesh(onceC("vicLabel", () => new RoundedBoxGeometry(0.09, 0.055, 0.012, 2, 0.006)), flat("#18161f", 0.6), hat);
  label.position.set(0.24, 0.085, 0.452);
  label.rotation.y = 0.5;
  for (const r of [0.785, -0.785]) {
    const x = mesh(onceC("vicLabelX", () => new RoundedBoxGeometry(0.04, 0.008, 0.006, 2, 0.003)), glowMat("#8dff4a", 0.5), label, 0, 0, 0.007);
    x.rotation.z = r;
    x.castShadow = false;
  }
  const strands = hairMat("#1d2614");
  for (const [p0, te] of [[-0.82, 1.42], [-0.62, 1.32], [0.7, 1.36], [0.9, 1.46]]) {
    mesh(lockAt(`vic:strand${p0}`, [[1.0, p0, 0.07], [1.2, p0 + 0.04, 0.08], [te, p0 + 0.1, 0.07]], 0.03, 0.018), strands, c.head);
  }

  return {
    eyes, mouth,
    arms: {
      sleeve: shirt, hand: c.skin, forearm: c.skin,
      profile: [[0, 0.065], [0.075, 0.06], [0.112, 0.028], [0.118, -0.05], [0.112, -0.17], [0.0, -0.17]],
      cuff: [shirt, -0.165, 0.105, 0.018],
      extra: (g, s) => {
        if (s > 0) return;
        // Bandages round his right forearm.
        for (let k = 0; k < 3; k++) {
          const b = mesh(onceC("vicBandage", () => new THREE.TorusGeometry(0.07, 0.013, 6, 20).rotateX(Math.PI / 2)), flat("#e8e2cf", 0.85), g, 0, -0.26 - k * 0.045, 0);
          b.rotation.set(0.25 - k * 0.12, 0, 0.15);
        }
      },
    },
    legs: {
      pants: suitMat("#2c303d"), hem: "turnup", hemMat: denim,
      upper: vinyl("#2c2342"), sole: flat("#f1f1f3", 0.45), toe: flat("#3a2f57", 0.4), lace: glowMat("#7dff3a", 0.6), collar: flat("#8a3df0", 0.45),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Abhishek                                                            */
/* ------------------------------------------------------------------ */

function abhishek(c: Ctx): Look {
  const hair = crewHair("#0f0f13", "#6d7fb8", true);
  const suit = suitMat("#18181c");
  const lapelM = satin("#111115");
  const shirt = suitMat("#f6f6f3");

  // Black suit, notched satin lapels, an open-collar white shirt, a white
  // pocket square, one button done up.
  const V = (y: number) => 0.03 + Math.max(0, y + 0.04) * 0.78;
  panel(c, "shirt", shirt, -0.04, 0.43, (y) => [-V(y), V(y)], 0.003, 0, 12, 12);
  const sv = (y: number) => Math.max(0, y - 0.24) * 0.95;
  panel(c, "chest", c.skin, 0.24, 0.43, (y) => [-sv(y), sv(y)], 0.0045, 0, 6, 6);
  for (const y of [0.06, 0.15]) unsquash(onTorso(mesh(onceC("abhiShirtBtn", () => new THREE.CylinderGeometry(0.011, 0.011, 0.006, 12).rotateX(Math.PI / 2)), flat("#d9dae0", 0.4), c.wear), 0, y, 0.006));
  for (const s of [-1, 1]) {
    const lapel = (y: number): [number, number] => [V(y) - 0.012, V(y) + 0.07 + (y + 0.04) * 0.34];
    const coll = (y: number): [number, number] => [V(y) - 0.012, V(y) + 0.11];
    panel(c, `lapel${s}`, lapelM, -0.04, 0.31, s > 0 ? lapel : (y) => mirror(lapel(y)), 0.006, 0.016, 12, 6);
    panel(c, `collar${s}`, lapelM, 0.335, 0.425, s > 0 ? coll : (y) => mirror(coll(y)), 0.006, 0.016, 4, 6);
    const pt = (y: number): [number, number] => [0.17 + (0.43 - y) * 0.75, 0.42 - (0.43 - y) * 1.0];
    panel(c, `shirtPt${s}`, shirt, 0.31, 0.43, s > 0 ? pt : (y) => mirror(pt(y)), 0.024, 0.008, 5, 6);
    seam(c, `edge${s}`, flat("#2c2d34", 0.6), [[s * 0.012, -0.08], [s * 0.07, -0.2], [s * 0.17, -0.31]], 0.004, 0.004);
    panel(c, `hipFlap${s}`, suit, -0.19, -0.135, () => (s > 0 ? [0.55, 0.95] : [-0.95, -0.55]), 0.004, 0.011, 2, 8);
  }
  panel(c, "welt", suit, 0.12, 0.15, () => [0.46, 0.74], 0.004, 0.009, 2, 8);
  const sq = onceC("abhiSquare", () => new THREE.ConeGeometry(0.02, 0.05, 4));
  for (const [p, h] of [[0.52, 0.17], [0.6, 0.18], [0.68, 0.168]]) {
    const pk = onTorso(mesh(sq, shirt, c.wear), p, h, 0.012);
    pk.quaternion.setFromUnitVectors(v3(0, 1, 0), torsoN(p, h).multiplyScalar(0.3).add(v3(0, 1, 0)).normalize());
  }
  unsquash(onTorso(mesh(onceC("crewBtn", () => new THREE.CylinderGeometry(0.019, 0.019, 0.009, 16).rotateX(Math.PI / 2)), vinyl("#0d0d10"), c.wear), 0, -0.08, 0.008));
  neckBand(c, "shirtBand", shirt, 0.15, 1.52, -0.31, 0.04, 0.016, 0.0);
  neckBand(c, "collar", lapelM, 0.2, 1.49, -0.345, 0.05, 0.024, -0.04);

  // Face: sharp almond eyes, thick brows, a strong jaw, a smirk.
  ears(c, "#c08360");
  const eyes = buildEyes(c, {
    x: 0.16, y: -0.02, w: 0.088, h: 0.08, iris: "#4a2d1a", deep: "#21120a", look: [0.004, -0.004], ik: 0.72,
    lid: 0.22, slant: 0.1, lash: 0.018, lower: 0.0055, flick: 1.2,
  });
  brows(c, hair, 0.165, 0.13, 0.1, 0.021, 0.14);
  nose(c, 0.025, -0.105);
  const ridge = onHead(mesh(onceC("abhiRidge", () => new THREE.CapsuleGeometry(0.012, 0.05, 4, 8)), c.skin, c.head), 0, -0.06, -0.002);
  ridge.scale.z = 0.7;
  const mouth = arcMouth(c, 0.046, Math.PI * 0.42, 0.0075, -Math.PI / 2 + 0.3, 0.012, -0.2);
  const dimple = mesh(onceC("abhiDimple", () => new THREE.CapsuleGeometry(0.004, 0.014, 3, 6)), c.ink, mouth, 0.046, 0.022, 0.0);
  dimple.rotation.z = 0.5;
  dimple.castShadow = false;

  // Hair: combed up from a side part over his right eye, swept across the
  // top with a lift at the front, tight and glossy at the sides and back.
  const line = hairline(0.72, 1.2, 1.95);
  mesh(onceC("abhi:shell", () => shellGeo(0.05, line)), hair, c.head);
  fadeShell(c, "taper", "#d9a179", "#141418", (ph) => line(ph) - 0.1, (ph) => Math.min(2.35, line(ph) + 0.55));
  for (let k = 0; k < 10; k++) {
    const z0 = 0.27 - k * 0.058, lift = k < 3 ? 0.3 - k * 0.06 : 0.14;
    mesh(onceC(`abhi:sweep${k}`, () => ribbon([
      scalp(-0.19, z0, 0.1), scalp(-0.04, z0 - 0.02, lift), scalp(0.17, z0 - 0.06, lift * 0.75), scalp(0.32, z0 - 0.11, 0.09), scalp(0.4, z0 - 0.17, 0.06),
    ], 0.07, 0.03, headUp, (t) => Math.pow(1 - t, 0.6) * (1 + 0.6 * t), 16, 8)), hair, c.head);
  }
  for (let k = 0; k < 6; k++) {
    const z0 = 0.2 - k * 0.09;
    mesh(onceC(`abhi:part${k}`, () => ribbon([
      scalp(-0.2, z0, 0.1), scalp(-0.33, z0 - 0.06, 0.08), scalp(-0.41, z0 - 0.14, 0.06),
    ], 0.06, 0.026, headUp, pointed, 12, 8)), hair, c.head);
  }
  for (let k = 0; k < 9; k++) {
    const p0 = Math.PI + (k / 8 - 0.5) * 2.3, te = 1.98 - Math.abs(k - 4) * 0.07;
    mesh(lockAt(`abhi:back${k}`, [[0.45, p0, 0.1], [1.0, p0, 0.1], [1.5, p0 + 0.02, 0.085], [te, p0 + 0.03, 0.04]], 0.085, 0.03, (t) => Math.pow(1 - t, 0.45) * (1 + 0.4 * t)), hair, c.head);
  }

  return {
    eyes, mouth,
    arms: {
      sleeve: suit, hand: c.skin, profile: SLEEVE,
      cuff: [shirt, -0.43, 0.074, 0.022],
      extra: (g, s) => {
        if (s < 0) return;
        // A gold watch on his left wrist, face on the back of the wrist.
        mesh(onceC("abhiStrap", () => new THREE.TorusGeometry(0.06, 0.014, 8, 24).rotateX(Math.PI / 2)), gold(), g, 0, -0.46, 0);
        const face = mesh(onceC("abhiDial", () => new THREE.CylinderGeometry(0.032, 0.032, 0.014, 24).rotateX(Math.PI / 2)), gold(), g, 0, -0.46, -0.07);
        face.scale.set(1, 1, 1);
        mesh(onceC("abhiGlass", () => new THREE.CylinderGeometry(0.025, 0.025, 0.004, 24).rotateX(Math.PI / 2)), flat("#101318", 0.2), g, 0, -0.46, -0.0785);
      },
    },
    legs: {
      pants: suit, hem: "plain",
      upper: onceC("abhiShoe", () => new THREE.MeshPhysicalMaterial({ color: "#121215", roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.08 })),
      sole: flat("#3b2416", 0.6), toe: onceC("abhiToe", () => new THREE.MeshPhysicalMaterial({ color: "#17171b", roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05 })),
      lace: flat("#101013", 0.5), collar: flat("#121215", 0.5), laces: true,
    },
  };
}
