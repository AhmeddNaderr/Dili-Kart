import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import * as T from "./textures";

/**
 * Neon Town's showpiece architecture: glass skyscrapers with fins and
 * spires, round towers ringed in light, stepped art-deco towers, a twisting
 * tower, giant LED screens, an elevated monorail with a train running on
 * it, and hover traffic crossing the sky.
 *
 * Everything static is merged per material in 150 m chunks, so a whole
 * district costs a handful of draw calls and still culls off-screen.
 */

const rnd = (i: number, k: number) => {
  const v = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return v - Math.floor(v);
};
const hot = (hex: string, k: number) => new THREE.Color(hex).multiplyScalar(k);
const NEON = ["#ff3fa4", "#2ee6ff", "#ffd84a", "#8f6bff", "#39ff9e"];

/** Darkens toward street level (grime, bounce shadow), like the other buildings. */
function grounded<M extends THREE.MeshStandardMaterial>(m: M): M {
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying float vWorldY;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvWorldY = (modelMatrix * vec4(transformed, 1.0)).y;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vWorldY;")
      .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb *= mix(0.42, 1.0, smoothstep(0.0, 9.0, vWorldY));");
  };
  m.customProgramCacheKey = () => "grounded";
  return m;
}

/** Scale a geometry's side UVs so the facade texture keeps a fixed size (16 m tiles). */
function wrapUV(g: THREE.BufferGeometry, around: number, height: number) {
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * around / 16, uv.getY(i) * height / 16);
  return g;
}

type Bucket = { mat: THREE.Material; geos: THREE.BufferGeometry[]; shadow: boolean };

export class Skyline {
  private buckets = new Map<string, Bucket>();
  private glass = [0, 1, 2, 3].map((v) => {
    const { map, glow, rough } = T.curtainTex(v);
    return grounded(new THREE.MeshStandardMaterial({
      map, emissive: "#ffffff", emissiveMap: glow, emissiveIntensity: 1.15,
      roughness: 1, roughnessMap: rough, metalness: 0.65, envMapIntensity: 1.6,
    }));
  });
  private steel = new THREE.MeshStandardMaterial({ color: "#aeb6c8", metalness: 0.9, roughness: 0.25 });
  private dark = new THREE.MeshStandardMaterial({ color: "#1b1e2c", metalness: 0.5, roughness: 0.45 });
  private neon = NEON.map((c) => new THREE.MeshBasicMaterial({ color: hot(c, 2.4), toneMapped: false }));
  private gold = new THREE.MeshBasicMaterial({ color: hot("#ffd27a", 2.2), toneMapped: false });
  private beacon = new THREE.MeshBasicMaterial({ color: hot("#ff2d55", 3), toneMapped: false });
  /** LED screen contents; they scroll from ad to ad. */
  private leds = [0, 1, 2, 3].map((s) => T.ledTex(s));
  private ledMats = this.leds.map((t) => new THREE.MeshBasicMaterial({ map: t, color: new THREE.Color(1.35, 1.35, 1.35), toneMapped: false }));
  private screens: THREE.Mesh[] = [];

  constructor(private scene: THREE.Scene) {}

  private put(key: string, mat: THREE.Material, g: THREE.BufferGeometry, x: number, z: number, shadow = false) {
    const k = `${key}:${Math.floor(x / 150)}:${Math.floor(z / 150)}`;
    let b = this.buckets.get(k);
    if (!b) { b = { mat, geos: [], shadow }; this.buckets.set(k, b); }
    b.geos.push(g.index ? g.toNonIndexed() : g);
  }

  /** A signature tower of one of four designs, standing at (x, z). */
  /** Where the towers went (dev inspection). */
  readonly spots: [number, number, number, number][] = [];

  tower(x: number, z: number, size: number, h: number, seed: number, face: number) {
    const kind = seed % 4;
    this.spots.push([Math.round(x), Math.round(z), Math.round(h), kind]);
    const gi = seed % this.glass.length;
    const glass = this.glass[gi];
    const neonI = seed % this.neon.length;
    const at = (g: THREE.BufferGeometry, y: number, ry = 0) => g.rotateY(ry).translate(x, y, z);
    const put = (key: string, mat: THREE.Material, g: THREE.BufferGeometry) => this.put(key, mat, g, x, z);

    if (kind === 0) {
      // Glass octagon with steel fins, a tapered crown and a spire.
      const r = size / 2;
      const around = 2 * Math.PI * r;
      put(`glass${gi}`, glass, at(wrapUV(new THREE.CylinderGeometry(r, r * 1.04, h, 8, 1), around, h), h / 2, Math.PI / 8));
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        put("steel", this.steel, at(new THREE.BoxGeometry(0.5, h, 1.3).rotateY(-a).translate(Math.cos(a) * r * 1.02, 0, Math.sin(a) * r * 1.02), h / 2));
      }
      put(`glass${gi}`, glass, at(wrapUV(new THREE.CylinderGeometry(r * 0.3, r * 0.92, 14, 8, 1), around * 0.6, 14), h + 7, Math.PI / 8));
      put("steel", this.steel, at(new THREE.CylinderGeometry(0.25, 0.7, 26, 8), h + 27));
      put("beacon", this.beacon, at(new THREE.SphereGeometry(0.9, 10, 8), h + 40));
      put(`neon${neonI}`, this.neon[neonI], at(new THREE.TorusGeometry(r * 0.95, 0.22, 6, 32).rotateX(Math.PI / 2), h + 0.5));
    } else if (kind === 1) {
      // Round tower ringed with chrome bands and two light rings, a helipad on top.
      const r = size / 2;
      const around = 2 * Math.PI * r;
      put(`glass${gi}`, glass, at(wrapUV(new THREE.CylinderGeometry(r, r, h, 32, 1), around, h), h / 2));
      for (let y = 16; y < h; y += 16) put("steel", this.steel, at(new THREE.TorusGeometry(r + 0.15, 0.28, 6, 40).rotateX(Math.PI / 2), y));
      for (const y of [h * 0.35, h - 2]) put(`neon${neonI}`, this.neon[neonI], at(new THREE.TorusGeometry(r + 0.4, 0.18, 6, 48).rotateX(Math.PI / 2), y));
      put("dark", this.dark, at(new THREE.CylinderGeometry(r * 0.7, r * 0.7, 1.2, 32), h + 0.6));
      put("gold", this.gold, at(new THREE.TorusGeometry(r * 0.55, 0.15, 6, 40).rotateX(Math.PI / 2), h + 1.3));
      put("steel", this.steel, at(new THREE.CylinderGeometry(0.2, 0.35, 14, 6).translate(r * 0.5, 0, 0), h + 7));
      put("beacon", this.beacon, at(new THREE.SphereGeometry(0.6, 8, 6).translate(r * 0.5, 0, 0), h + 14.3));
    } else if (kind === 2) {
      // Stepped art-deco tower: three tiers outlined in gold, a lit pyramid cap.
      let y = 0, w = size;
      const tiers = [0.55, 0.28, 0.17];
      for (const f of tiers) {
        const th = h * f;
        put(`glass${gi}`, glass, at(wrapUV(new THREE.BoxGeometry(w, th, w), w, th), y + th / 2));
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          put("gold", this.gold, at(new THREE.BoxGeometry(0.35, th, 0.35).translate(sx * w / 2, 0, sz * w / 2), y + th / 2));
        }
        put("dark", this.dark, at(new THREE.BoxGeometry(w + 1.2, 1.2, w + 1.2), y + th + 0.6));
        y += th + 1.2;
        w *= 0.72;
      }
      put("gold", this.gold, at(new THREE.ConeGeometry(w * 0.75, 12, 4).rotateY(Math.PI / 4), y + 6));
      put("steel", this.steel, at(new THREE.CylinderGeometry(0.15, 0.3, 16, 6), y + 20));
      put("beacon", this.beacon, at(new THREE.SphereGeometry(0.6, 8, 6), y + 28));
    } else {
      // Twisting tower: a square plan turning 70° from street to sky.
      const seg = 30;
      const g = new THREE.BoxGeometry(size, h, size, 1, seg, 1);
      wrapUV(g, size, h);
      const p = g.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const t = (p.getY(i) + h / 2) / h;
        const a = t * 1.22;
        const px = p.getX(i), pz = p.getZ(i);
        p.setXYZ(i, px * Math.cos(a) - pz * Math.sin(a), p.getY(i), px * Math.sin(a) + pz * Math.cos(a));
      }
      g.computeVertexNormals();
      put(`glass${gi}`, glass, at(g, h / 2));
      const top = 1.22;
      put(`neon${neonI}`, this.neon[neonI], at(new THREE.BoxGeometry(size + 0.6, 0.3, size + 0.6).rotateY(top), h + 0.2));
      put("dark", this.dark, at(new THREE.BoxGeometry(size * 0.8, 4, size * 0.8).rotateY(top), h + 2));
      put("steel", this.steel, at(new THREE.CylinderGeometry(0.2, 0.5, 22, 6), h + 15));
      put("beacon", this.beacon, at(new THREE.SphereGeometry(0.7, 8, 6), h + 26));
    }

    // A giant LED screen on the face turned toward the track.
    if (seed % 3 !== 2 && kind !== 3) {
      const sw = Math.min(size * 0.75, 16), sh = Math.min(h * 0.3, 36);
      const cy = h * 0.55;
      const off = size / 2 + (kind === 1 ? 0.8 : 0.4);
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), this.ledMats[seed % this.ledMats.length]);
      scr.position.set(x + Math.sin(face) * off, cy, z + Math.cos(face) * off);
      scr.rotation.y = face;
      this.scene.add(scr);
      this.screens.push(scr);
      const frame = new THREE.BoxGeometry(sw + 1, sh + 1, 0.5).rotateY(face).translate(scr.position.x - Math.sin(face) * 0.3, cy, scr.position.z - Math.cos(face) * 0.3);
      this.put("dark", this.dark, frame, x, z);
    }
  }

  build() {
    if (import.meta.env.DEV) (window as unknown as { __towers: unknown }).__towers = this.spots;
    for (const [key, b] of this.buckets) {
      const g = mergeGeometries(b.geos, false);
      b.geos.forEach((x) => x.dispose());
      if (!g) continue;
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, b.mat);
      const glow = b.mat instanceof THREE.MeshBasicMaterial;
      m.receiveShadow = !glow;
      m.castShadow = false;
      m.name = key;
      this.scene.add(m);
    }
    this.buckets.clear();
  }

  /** Screens roll from one ad to the next every few seconds. */
  animate(t: number) {
    this.leds.forEach((tx, i) => {
      const cycle = (t / 4.5 + i * 0.37) % 4;
      const k = Math.floor(cycle), f = cycle - k;
      const ease = f < 0.82 ? 0 : (f - 0.82) / 0.18;
      tx.offset.y = (k + ease * ease * (3 - 2 * ease)) / 4;
    });
  }
}

/**
 * An elevated monorail on a straight line across the city (x from x0 to
 * x1 at z, height y), on pillars that avoid the road, with a lit train
 * gliding along it.
 */
export function monorail(scene: THREE.Scene, x0: number, x1: number, z: number, y: number, pillarOk: (x: number, z: number) => boolean) {
  const len = x1 - x0;
  const concrete = new THREE.MeshStandardMaterial({ color: "#8a8fa3", roughness: 0.75, metalness: 0.1 });
  const geos: THREE.BufferGeometry[] = [];
  geos.push(new THREE.BoxGeometry(len, 1.6, 2.6).translate((x0 + x1) / 2, y, z));
  for (let x = x0 + 10; x < x1; x += 34) {
    if (!pillarOk(x, z)) continue;
    geos.push(new THREE.CylinderGeometry(0.9, 1.1, y, 12).translate(x, y / 2, z));
    geos.push(new THREE.BoxGeometry(3.4, 1.2, 3.4).translate(x, y - 1.2, z));
  }
  const beam = new THREE.Mesh(mergeGeometries(geos.map((g) => g.toNonIndexed()), false)!, concrete);
  beam.receiveShadow = true;
  scene.add(beam);
  // Light strips under the beam, one in each colour.
  for (const [dz, col] of [[-1.35, "#2ee6ff"], [1.35, "#ff3fa4"]] as const) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(len, 0.14, 0.14), new THREE.MeshBasicMaterial({ color: hot(col, 2.4), toneMapped: false }));
    strip.position.set((x0 + x1) / 2, y - 0.75, z + dz);
    scene.add(strip);
  }

  // The train: four cars, white with a blue belt and a strip of lit windows.
  const train = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: "#eef2fa", metalness: 0.35, roughness: 0.3 });
  const belt = new THREE.MeshStandardMaterial({ color: "#3d63ff", metalness: 0.3, roughness: 0.35 });
  const win = new THREE.MeshBasicMaterial({ color: hot("#ffe2a8", 1.8), toneMapped: false });
  const head = new THREE.MeshBasicMaterial({ color: hot("#e8f4ff", 3), toneMapped: false });
  for (let k = 0; k < 4; k++) {
    const car = new THREE.Group();
    car.position.x = -k * 12.4;
    const shell = new THREE.Mesh(new THREE.CapsuleGeometry(1.5, 9, 6, 16).rotateZ(Math.PI / 2), body);
    shell.scale.set(1, 1.1, 1);
    car.add(shell);
    const b = new THREE.Mesh(new THREE.BoxGeometry(11.6, 0.5, 3.12), belt);
    b.position.y = -0.55;
    car.add(b);
    for (const s of [-1, 1]) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(9.5, 0.9), win);
      w.position.set(0, 0.35, 1.52 * s);
      if (s < 0) w.rotation.y = Math.PI;
      car.add(w);
    }
    if (k === 0) {
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8), head);
      lamp.position.set(7.2, 0.2, 0);
      car.add(lamp);
    }
    train.add(car);
  }
  train.position.set(x0, y + 2.3, z);
  scene.add(train);
  return {
    update(t: number) {
      // Runs east, wraps round off the edge of town.
      const span = len + 60;
      train.position.x = x0 - 30 + ((t * 26) % span);
    },
  };
}

/** Hover cars and drones crossing the sky on long straight lanes. */
export function skyTraffic(scene: THREE.Scene, center: THREE.Vector3, count: number) {
  const body = new THREE.MeshStandardMaterial({ color: "#20232f", metalness: 0.7, roughness: 0.3 });
  const tail = new THREE.MeshBasicMaterial({ color: hot("#ff2d55", 2.6), toneMapped: false });
  const headL = new THREE.MeshBasicMaterial({ color: hot("#e8f4ff", 2.8), toneMapped: false });
  const under = NEON.map((c) => new THREE.MeshBasicMaterial({ color: hot(c, 2), toneMapped: false }));
  const cars: { g: THREE.Group; a: THREE.Vector3; b: THREE.Vector3; speed: number; phase: number }[] = [];
  for (let i = 0; i < count; i++) {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.CapsuleGeometry(0.9, 2.6, 4, 10).rotateX(Math.PI / 2), body));
    const u = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.12, 3.2), under[i % under.length]);
    u.position.y = -0.8;
    g.add(u);
    for (const s of [-1, 1]) {
      const t = new THREE.Mesh(new THREE.SphereGeometry(0.22, 6, 4), tail);
      t.position.set(0.6 * s, 0, -2.2);
      g.add(t);
      const h = new THREE.Mesh(new THREE.SphereGeometry(0.2, 6, 4), headL);
      h.position.set(0.55 * s, 0, 2.2);
      g.add(h);
    }
    const ang = rnd(i, 1) * Math.PI * 2, r = 180 + rnd(i, 2) * 260, y = 48 + rnd(i, 3) * 70;
    const dir = ang + Math.PI / 2 + (rnd(i, 4) - 0.5) * 0.8;
    const mid = new THREE.Vector3(center.x + Math.cos(ang) * r * 0.4, y, center.z + Math.sin(ang) * r * 0.4);
    const d = new THREE.Vector3(Math.cos(dir), 0, Math.sin(dir)).multiplyScalar(r * 1.6);
    const a = mid.clone().sub(d), b = mid.clone().add(d);
    g.rotation.set(0, Math.atan2(b.x - a.x, b.z - a.z), 0);
    scene.add(g);
    cars.push({ g, a, b, speed: 0.02 + rnd(i, 5) * 0.03, phase: rnd(i, 6) });
  }
  return {
    update(t: number) {
      for (const c of cars) {
        const k = (c.phase + t * c.speed) % 1;
        c.g.position.lerpVectors(c.a, c.b, k);
        c.g.position.y += Math.sin(t * 1.3 + c.phase * 9) * 0.6;
      }
    },
  };
}
