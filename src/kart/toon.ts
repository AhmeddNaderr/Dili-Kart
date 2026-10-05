import * as THREE from "three";
import { rimLight } from "./rim";

/**
 * Shared toon materials and parts for the characters: cached geometry and
 * materials, vinyl and fabric finishes, trim metal, and the glass dome.
 */

/**
 * Detail level for the characters: 1 on phones, where curves are built with
 * about half the facets (see `seg`). The kart sets it before building its
 * driver; cache keys include it.
 */
export let TOON_LOD = 0;
export const setToonLOD = (v: number) => { TOON_LOD = v; };
/** Segment count for a curve at the current detail level. */
export const seg = (n: number, min = 6) => (TOON_LOD ? Math.max(min, Math.round(n * 0.6)) : n);

const cache = new Map<string, THREE.BufferGeometry | THREE.Material>();
export function once<T extends THREE.BufferGeometry | THREE.Material>(key: string, make: () => T): T {
  const k = TOON_LOD ? `${key}|lod` : key;
  let v = cache.get(k) as T | undefined;
  if (!v) { v = make(); cache.set(k, v); }
  return v;
}
const texCache = new Map<string, THREE.Texture>();
export function onceTex(key: string, make: () => THREE.Texture) {
  let t = texCache.get(key);
  if (!t) { t = make(); texCache.set(key, t); }
  return t;
}

export const lighten = (hex: string, k: number) => "#" + new THREE.Color(hex).lerp(new THREE.Color("#ffffff"), k).getHexString();

/** A fine twill weave as a normal map, so the suits read as fabric up close. */
export function fabricNormal() {
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
export const suitMat = (color: string) => once(`suit${color}`, () => rimLight(new THREE.MeshPhysicalMaterial({
  color, roughness: 0.6, metalness: 0, sheen: 0.6, sheenRoughness: 0.45,
  sheenColor: new THREE.Color(color).lerp(new THREE.Color("#ffffff"), 0.5),
  normalMap: fabricNormal(), normalScale: new THREE.Vector2(0.16, 0.16),
}), 0.3));

/** Polished trim metal: badges, buckles, collar rings. */
export const chromeTrim = () => once("chromeTrim", () => new THREE.MeshPhysicalMaterial({
  color: "#eef1f8", metalness: 0.9, roughness: 0.18, clearcoat: 0.7, clearcoatRoughness: 0.1,
}));

export const vinyl = (color: string) => once(`vinyl${color}`, () => rimLight(new THREE.MeshPhysicalMaterial({
  color, roughness: 0.45, metalness: 0, clearcoat: 0.4, clearcoatRoughness: 0.4,
  sheen: 0.25, sheenColor: new THREE.Color(color).lerp(new THREE.Color("#ffffff"), 0.35),
}), 0.3));
export const flat = (color: string, rough = 0.5) => once(`flat${color}${rough}`, () => new THREE.MeshStandardMaterial({ color, roughness: rough }));

export function dome(tint: string, radius: number, opacity = 0.2, rimTint = tint) {
  const g = new THREE.Group();
  const glass = new THREE.Mesh(
    once(`domegeo${radius}`, () => new THREE.SphereGeometry(radius, seg(40), seg(28))),
    once(`glass${tint}${opacity}`, () => new THREE.MeshPhysicalMaterial({
      color: tint, transparent: true, opacity, roughness: 0.03, metalness: 0,
      clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.6, depthWrite: false,
    })),
  );
  glass.renderOrder = 3;
  g.add(glass);
  const rim = new THREE.Mesh(
    once(`domegeo${radius}`, () => new THREE.SphereGeometry(radius, seg(40), seg(28))),
    once(`rim${rimTint}`, () => new THREE.ShaderMaterial({
      // Additive light that leaves the destination alpha alone, so the rim
      // doesn't punch a dark disc into menus drawn on a transparent canvas.
      transparent: true, depthWrite: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
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

export const glowMat = (color: string, k = 2.4) => once(`eglow${color}${k}`, () => new THREE.MeshStandardMaterial({
  color: "#000000", emissive: color, emissiveIntensity: k * 1.9, roughness: 0.4,
}));

export function darken(hex: string, amt: number) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(1 - amt);
  return "#" + c.getHexString();
}

export function disposeToon() {
  for (const v of cache.values()) v.dispose();
  cache.clear();
  for (const t of texCache.values()) t.dispose();
  texCache.clear();
}
