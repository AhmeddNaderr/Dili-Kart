import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * Trees, bushes, flowers and grass tufts — all instanced, so hundreds of
 * them cost a handful of draw calls, and all swaying in a light breeze via
 * a small vertex-shader hook.
 *
 * Canopies are clusters of noise-displaced icospheres with baked vertex
 * shading (dark underneath, lit on top) and a painted leaf texture, which
 * reads as foliage rather than as smooth balls.
 */

export type Species = "oak" | "pine" | "blossom" | "bush";

export interface Plant {
  species: Species;
  x: number;
  z: number;
  y?: number;
  scale: number;
  rot: number;
}

const wind = { value: 0 };

/** Advance the breeze. Call once per frame. */
export function tickNature(t: number) {
  wind.value = t;
}

/** Deterministic hash noise for displacing vertices. */
function hash3(x: number, y: number, z: number) {
  const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return s - Math.floor(s);
}

function noise3(x: number, y: number, z: number) {
  // Cheap value noise: blend of hashed lattice points, smoothed.
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  let acc = 0;
  for (let dz = 0; dz <= 1; dz++) for (let dy = 0; dy <= 1; dy++) for (let dx = 0; dx <= 1; dx++) {
    const k = hash3(xi + dx, yi + dy, zi + dz);
    acc += k * (dx ? u : 1 - u) * (dy ? v : 1 - v) * (dz ? w : 1 - w);
  }
  return acc;
}

/** A lumpy clump of leaves, with vertex colours: shade below, light above. */
/** Canopy mesh detail: 3 on desktop, 2 on phones. */
let DETAIL = 3;

function clump(r: number, cx: number, cy: number, cz: number, seed: number, bottom: THREE.Color, top: THREE.Color) {
  // Weld the icosphere first so the displaced surface shades smoothly
  // instead of in flat facets; UVs are rebuilt spherically afterwards.
  const raw = new THREE.IcosahedronGeometry(r, DETAIL);
  raw.deleteAttribute("uv");
  raw.deleteAttribute("normal");
  const g = mergeVertices(raw);
  raw.dispose();
  const pos = g.attributes.position as THREE.BufferAttribute;
  const uv = new Float32Array(pos.count * 2);
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = v.clone().normalize();
    uv[i * 2] = Math.atan2(n.z, n.x) / (Math.PI * 2) + 0.5;
    uv[i * 2 + 1] = Math.acos(THREE.MathUtils.clamp(n.y, -1, 1)) / Math.PI;
    const d = noise3(n.x * 2.2 + seed, n.y * 2.2, n.z * 2.2) * 0.34 + noise3(n.x * 5 + seed, n.y * 5, n.z * 5) * 0.12;
    v.multiplyScalar(1 + d - 0.2);
    v.y *= 0.86;
    pos.setXYZ(i, v.x + cx, v.y + cy, v.z + cz);
    // Light from above, occlusion toward the bottom and the centre.
    const k = THREE.MathUtils.clamp(0.5 + n.y * 0.5 + d * 0.6, 0, 1);
    c.copy(bottom).lerp(top, k);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/** Trunk with a gentle bend, a flared root base, and branches reaching into the crown. */
function trunk(h: number, r0: number, r1: number) {
  const parts: THREE.BufferGeometry[] = [];
  const main = new THREE.CylinderGeometry(r1, r0, h, 12, 10, false).translate(0, h / 2, 0);
  const p = main.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const t = y / h;
    const ang = Math.atan2(p.getZ(i), p.getX(i));
    // Roots: the base swells, in four lobes.
    const flare = y < 0.7 ? 1 + ((0.7 - y) / 0.7) ** 2 * (0.55 + 0.35 * Math.sin(ang * 4)) : 1;
    p.setX(i, p.getX(i) * flare + Math.sin(t * 2.2) * 0.18 * t);
    p.setZ(i, p.getZ(i) * flare);
  }
  main.computeVertexNormals();
  parts.push(main);
  for (const [a, y, len, tilt] of [[0.9, h * 0.55, 1.7, 0.85], [-2.2, h * 0.68, 1.5, 0.95], [2.6, h * 0.78, 1.2, 0.7]] as const) {
    const b = new THREE.CylinderGeometry(r1 * 0.35, r1 * 0.7, len, 7).translate(0, len / 2, 0);
    b.rotateZ(tilt);
    b.rotateY(a);
    b.translate(0, y, 0);
    parts.push(b);
  }
  const m = mergeGeometries(parts.map((g) => g.toNonIndexed()));
  parts.forEach((g) => g.dispose());
  return m!;
}

/**
 * Leaf cards: small alpha-cut clusters of leaves standing out from the
 * crown's surface, so silhouettes read as leafy instead of as smooth blobs.
 */
function leafCards(clumps: [number, number, number, number][], count: number, seed: number, bottom: THREE.Color, top: THREE.Color, sizeK = 1) {
  const parts: THREE.BufferGeometry[] = [];
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const h = (k: number) => hash3(i * 1.7 + seed, k * 3.1, seed * 0.37);
    const [r, cx, cy, cz] = clumps[Math.floor(h(1) * clumps.length)];
    // Mostly around the sides and top, a few underneath.
    const th = h(2) * Math.PI * 2, ph = Math.acos(THREE.MathUtils.clamp(1 - h(3) * 1.6, -1, 1));
    const dir = new THREE.Vector3(Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th));
    const size = (0.9 + h(4) * 0.8) * sizeK;
    const card = new THREE.PlaneGeometry(size, size).translate(0, size * 0.35, 0);
    card.rotateX(0.9 + h(7) * 0.5);          // stand up off the surface, like a tuft
    card.rotateZ(h(5) * Math.PI * 2);
    card.lookAt(dir);
    const pos = new THREE.Vector3(cx, cy, cz).addScaledVector(dir, r * (0.82 + h(6) * 0.18));
    pos.y *= 1;
    card.translate(pos.x, pos.y, pos.z);
    const g = card.toNonIndexed();
    const k = THREE.MathUtils.clamp(0.55 + dir.y * 0.45, 0, 1);
    c.copy(bottom).lerp(top, k);
    const col = new Float32Array(g.attributes.position.count * 3);
    for (let v = 0; v < g.attributes.position.count; v++) { col[v * 3] = c.r; col[v * 3 + 1] = c.g; col[v * 3 + 2] = c.b; }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    parts.push(g);
    card.dispose();
  }
  return mergeGeometries(parts)!;
}

/** A cluster of leaves on a transparent card, shaded for the vertex colours to tint. */
function leafClusterTex() {
  const S = 128;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2 + Math.random() * 0.4;
    const d = 12 + Math.random() * 30;
    const x = S / 2 + Math.cos(a) * d, y = S / 2 + Math.sin(a) * d;
    const l = 16 + Math.random() * 12;
    const shade = 170 + Math.floor(Math.random() * 85);
    g.save();
    g.translate(x, y);
    g.rotate(a + Math.PI / 2 + (Math.random() - 0.5) * 0.6);
    const lg = g.createLinearGradient(0, -l, 0, l);
    lg.addColorStop(0, `rgb(${shade},${shade},${shade})`);
    lg.addColorStop(1, `rgb(${shade - 60},${shade - 60},${shade - 60})`);
    g.fillStyle = lg;
    g.beginPath();
    g.ellipse(0, 0, l * 0.42, l, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function barkTex() {
  const c = document.createElement("canvas");
  c.width = 64; c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = "#6b4630";
  g.fillRect(0, 0, 64, 256);
  for (let i = 0; i < 60; i++) {
    const x = Math.random() * 64;
    g.strokeStyle = Math.random() < 0.5 ? "rgba(40,24,14,.55)" : "rgba(150,110,80,.35)";
    g.lineWidth = 1 + Math.random() * 2.5;
    g.beginPath();
    g.moveTo(x, 0);
    for (let y = 0; y <= 256; y += 32) g.lineTo(x + Math.sin(y * 0.05 + i) * 3, y);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Pine needles: fine streaks running down each tier. */
function needleTex() {
  const c = document.createElement("canvas");
  c.width = 128; c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "#e4e4e4";
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 260; i++) {
    const x = Math.random() * 128, y = Math.random() * 128;
    const shade = 150 + Math.floor(Math.random() * 105);
    g.strokeStyle = `rgb(${shade},${shade},${shade})`;
    g.lineWidth = 1 + Math.random() * 1.5;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (Math.random() - 0.5) * 4, y + 8 + Math.random() * 10); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(4, 2);
  return t;
}

/** Painted leaf pattern, multiplied over the canopy's vertex shading. */
function leafTex() {
  const S = 256;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  g.fillStyle = "#d8d8d8";
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 900; i++) {
    const x = Math.random() * S, y = Math.random() * S;
    const l = 5 + Math.random() * 7;
    const shade = 150 + Math.floor(Math.random() * 105);
    g.fillStyle = `rgb(${shade},${shade},${shade})`;
    g.save();
    g.translate(x, y);
    g.rotate(Math.random() * Math.PI * 2);
    g.beginPath();
    g.ellipse(0, 0, l, l * 0.45, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 3);
  return t;
}

/** Add wind sway to a material: displacement grows with height above `from`. */
function sway(mat: THREE.Material, from: number, amount: number, translucent = false) {
  mat.onBeforeCompile = (sh) => {
    if (translucent) {
      // Sun through the leaves: silhouettes glow softly in their own colour.
      sh.fragmentShader = sh.fragmentShader.replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
        {
          float rimF = 1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0);
          totalEmissiveRadiance += diffuseColor.rgb * (pow(rimF, 2.2) * 0.42 + 0.06);
        }`);
    }
    sh.uniforms.uWind = wind;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uWind;")
      .replace("#include <begin_vertex>", `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 ip = vec3(instanceMatrix[3]);
        #else
          vec3 ip = vec3(0.0);
        #endif
        float hgt = max(0.0, transformed.y - ${from.toFixed(2)});
        float ph = ip.x * 0.21 + ip.z * 0.17;
        float sw = (sin(uWind * 1.25 + ph) + 0.45 * sin(uWind * 2.7 + ph * 1.7)) * ${amount.toFixed(3)} * hgt;
        transformed.x += sw;
        transformed.z += sw * 0.6;`);
  };
  mat.customProgramCacheKey = () => `sway${from}${amount}${translucent}`;
}

interface Kind {
  parts: { geo: THREE.BufferGeometry; mat: THREE.Material; shadow: boolean }[];
  hueJitter: number;
}

function buildKinds(): Record<Species, Kind> {
  const bark = new THREE.MeshStandardMaterial({ map: barkTex(), roughness: 0.95 });
  sway(bark, 1.5, 0.02);
  const leaves = leafTex();
  const canopyMat = () => {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, map: leaves, roughness: 0.85 });
    sway(m, 2.0, 0.035, true);
    return m;
  };
  const cluster = leafClusterTex();
  const cardMat = () => {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, map: cluster, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.8 });
    sway(m, 2.0, 0.035, true);
    return m;
  };

  // Broadleaf: a crown of five clumps.
  const oakDark = new THREE.Color("#1e6b34"), oakLight = new THREE.Color("#8ee872");
  const oakClumps: [number, number, number, number][] = [
    [2.1, 0, 5.3, 0], [1.6, 1.5, 4.5, 0.6], [1.5, -1.4, 4.7, -0.5], [1.45, 0.3, 4.3, -1.5], [1.3, -0.4, 6.5, 0.5],
    [1.2, 1.2, 5.8, -0.8], [1.15, -1.1, 5.9, 0.9], [1.0, 0.6, 3.8, 1.4], [0.95, -1.6, 3.9, 0.8],
  ];
  const oakCanopy = mergeGeometries(oakClumps.map(([r, x, y, z], i) => clump(r, x, y, z, 1 + i, oakDark, oakLight).toNonIndexed()))!;
  const oakCards = leafCards(oakClumps, 110, 3, oakDark, oakLight, 0.85);

  const blossomDark = new THREE.Color("#b0307e"), blossomLight = new THREE.Color("#ffc8ee");
  const blossomClumps: [number, number, number, number][] = [
    [1.8, 0, 4.9, 0], [1.4, 1.3, 4.3, 0.5], [1.3, -1.2, 4.4, -0.4], [1.2, 0.2, 6.0, 0.3], [1.05, 0.9, 5.4, -1.0], [1.0, -0.8, 5.5, 1.0],
  ];
  const blossomCanopy = mergeGeometries(blossomClumps.map(([r, x, y, z], i) => clump(r, x, y, z, 11 + i, blossomDark, blossomLight).toNonIndexed()))!;
  const blossomCards = leafCards(blossomClumps, 90, 17, blossomDark, blossomLight, 0.8);

  // Pine: stacked cones with a ragged hem.
  const pineDark = new THREE.Color("#0f4a3a"), pineLight = new THREE.Color("#3fae6c");
  const tiers: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    const r = 2.4 - i * 0.42, h = 2.3 - i * 0.17, y = 2.0 + i * 1.12;
    const g = new THREE.ConeGeometry(r, h, 18, 4).translate(0, y, 0).toNonIndexed();
    const p = g.attributes.position as THREE.BufferAttribute;
    const col = new Float32Array(p.count * 3);
    const c = new THREE.Color();
    for (let k = 0; k < p.count; k++) {
      const vy = p.getY(k) - y;
      const ang = Math.atan2(p.getZ(k), p.getX(k));
      if (vy < -h * 0.45) {
        const tooth = Math.sin(ang * 9) > 0;
        const jag = 1 + (tooth ? 0.14 : -0.06);
        p.setX(k, p.getX(k) * jag);
        p.setZ(k, p.getZ(k) * jag);
        p.setY(k, p.getY(k) - (tooth ? 0.28 : 0));
      }
      const t = THREE.MathUtils.clamp((vy / h) + 0.55 + i * 0.08, 0, 1);
      c.copy(pineDark).lerp(pineLight, t);
      col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
    }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    tiers.push(g);
  }
  const pineCanopy = mergeGeometries(tiers)!;
  const pineMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, map: needleTex() });
  sway(pineMat, 2.5, 0.025, true);

  // Bush: three clumps low to the ground.
  const bushDark = new THREE.Color("#1f6a37"), bushLight = new THREE.Color("#86e36f");
  const bushGeo = mergeGeometries([
    clump(1.1, 0, 0.8, 0, 21, bushDark, bushLight),
    clump(0.8, 0.9, 0.6, 0.3, 22, bushDark, bushLight),
    clump(0.75, -0.85, 0.55, -0.2, 23, bushDark, bushLight),
  ].map((g) => g.toNonIndexed()))!;
  const bushMat = canopyMat();
  const bushCards = leafCards([[1.1, 0, 0.8, 0], [0.8, 0.9, 0.6, 0.3], [0.75, -0.85, 0.55, -0.2]], 26, 29, bushDark, bushLight, 0.55);
  // Flowers dotted over the bushes.
  const flowerGeo = mergeGeometries(Array.from({ length: 9 }, (_, i) => {
    const a = i * 2.4, r = 0.9 + (i % 3) * 0.25;
    return new THREE.IcosahedronGeometry(0.13, 0).translate(Math.cos(a) * r, 1.0 + (i % 2) * 0.45, Math.sin(a) * r * 0.8).toNonIndexed();
  }))!;

  return {
    oak: {
      hueJitter: 0.05,
      parts: [
        { geo: trunk(4.2, 0.42, 0.26), mat: bark, shadow: true },
        { geo: oakCanopy, mat: canopyMat(), shadow: true },
        { geo: oakCards, mat: cardMat(), shadow: false },
      ],
    },
    blossom: {
      hueJitter: 0.04,
      parts: [
        { geo: trunk(3.8, 0.36, 0.22), mat: bark, shadow: true },
        { geo: blossomCanopy, mat: canopyMat(), shadow: true },
        { geo: blossomCards, mat: cardMat(), shadow: false },
      ],
    },
    pine: {
      hueJitter: 0.03,
      parts: [
        { geo: new THREE.CylinderGeometry(0.2, 0.34, 2.6, 8).translate(0, 1.3, 0), mat: bark, shadow: true },
        { geo: pineCanopy, mat: pineMat, shadow: true },
      ],
    },
    bush: {
      hueJitter: 0.06,
      parts: [
        { geo: bushGeo, mat: bushMat, shadow: false },
        { geo: bushCards, mat: cardMat(), shadow: false },
        { geo: flowerGeo, mat: new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.5, emissive: "#ff9fd8", emissiveIntensity: 0.25 }), shadow: false },
      ],
    },
  };
}

/** Build every plant as instanced meshes. Returns the meshes, already added to the scene. */
export function plantAll(scene: THREE.Scene, plants: Plant[], detail = 3): THREE.Object3D[] {
  DETAIL = detail;
  const kinds = buildKinds();
  const out: THREE.Object3D[] = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const col = new THREE.Color();
  const flowerCols = ["#ff5c8a", "#ffd24d", "#ffffff", "#8fd0ff", "#c89bff"];
  for (const sp of Object.keys(kinds) as Species[]) {
    const list = plants.filter((x) => x.species === sp);
    if (!list.length) continue;
    kinds[sp].parts.forEach((part, pi) => {
      const im = new THREE.InstancedMesh(part.geo, part.mat, list.length);
      im.castShadow = part.shadow;
      im.receiveShadow = true;
      list.forEach((pl, i) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), pl.rot);
        s.setScalar(pl.scale);
        p.set(pl.x, pl.y ?? 0, pl.z);
        m.compose(p, q, s);
        im.setMatrixAt(i, m);
        // Per-instance tint so no two trees are quite the same.
        const j = kinds[sp].hueJitter;
        const k = hash3(pl.x, pl.z, pi);
        if (sp === "bush" && pi === kinds[sp].parts.length - 1) col.set(flowerCols[Math.floor(k * flowerCols.length)]);
        else col.setHSL(0, 0, 1).offsetHSL((k - 0.5) * j, 0, (k - 0.5) * 0.12);
        im.setColorAt(i, col);
      });
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.computeBoundingSphere();
      scene.add(im);
      out.push(im);
    });
  }
  return out;
}

/**
 * Grass tufts: crossed blade cards scattered over the grass, one draw call.
 */
export function grassTufts(scene: THREE.Scene, spots: { x: number; y: number; z: number; s: number }[]) {
  const c = document.createElement("canvas");
  c.width = 128; c.height = 128;
  const g = c.getContext("2d")!;
  for (let i = 0; i < 26; i++) {
    const x = 10 + Math.random() * 108, h = 60 + Math.random() * 60, lean = (Math.random() - 0.5) * 30;
    const shade = 120 + Math.floor(Math.random() * 90);
    g.strokeStyle = `rgb(${Math.floor(shade * 0.45)},${shade},${Math.floor(shade * 0.4)})`;
    g.lineWidth = 3 + Math.random() * 3;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(x, 128);
    g.quadraticCurveTo(x + lean * 0.3, 128 - h * 0.6, x + lean, 128 - h);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const blade = new THREE.PlaneGeometry(1, 0.8).translate(0, 0.4, 0);
  const geo = mergeGeometries([blade.clone(), blade.clone().rotateY(Math.PI / 2)])!;
  const mat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9 });
  sway(mat, 0.1, 0.12);
  const im = new THREE.InstancedMesh(geo, mat, spots.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
  spots.forEach((t, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), hash3(t.x, t.z, 7) * Math.PI);
    sc.setScalar(t.s);
    p.set(t.x, t.y, t.z);
    m.compose(p, q, sc);
    im.setMatrixAt(i, m);
  });
  im.instanceMatrix.needsUpdate = true;
  im.computeBoundingSphere();
  im.receiveShadow = true;
  scene.add(im);
  return im;
}
