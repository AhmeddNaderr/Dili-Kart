import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import * as T from "./textures";
import * as M from "./models";
import { EDGE, ROAD_HALF, WALL, Track, newFrame } from "./track";
import { buildSky, cloudTexture } from "./sky";
import { skyTraffic } from "./skyline";
import { blimp } from "./circuit";
import { WALL_H, WALL_T, buildRamp, buildStart, haloTex, keep, mergeStatic, strip, takeStatic, type Quality, type World } from "./world";

/**
 * The Dlicom Skyway, home of Infinite mode: a glassy highway held up on
 * pylons high above a sea of sunset clouds. Neon arches span the road,
 * floating islands drift past, the towers of Dlicom City rise out of the
 * cloud tops on the horizon, and the summit ends in a leap across a gap
 * with nothing underneath but sky.
 */

const rnd = (i: number, k: number) => {
  const v = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return v - Math.floor(v);
};
const hot = (hex: string, k: number) => new THREE.Color(hex).multiplyScalar(k);

/** Height of the cloud tops: the pylons and the city's towers sink into them. */
const CLOUD_Y = 3;
const SUN_DIR = new THREE.Vector3(-0.66, 0.13, 0.53).normalize();

export function buildSkyway(scene: THREE.Scene, renderer: THREE.WebGLRenderer, track: Track, quality: Quality = "high"): World {
  const lite = quality === "low";

  /* ---------- light: golden hour above the clouds ---------- */
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.5;
  pmrem.dispose();
  // Fill from a violet sky above and warm bounce off the sunlit cloud tops.
  scene.add(new THREE.HemisphereLight("#93a6ff", "#ff9a78", 0.8));
  const sun = new THREE.DirectionalLight("#ffc286", 2.3);
  sun.castShadow = true;
  sun.shadow.mapSize.setScalar(lite ? 1024 : 4096);
  const sc = sun.shadow.camera;
  sc.left = -38; sc.right = 38; sc.top = 38; sc.bottom = -38; sc.near = 1; sc.far = 220;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of track.outline(8)) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  const center = new THREE.Vector3((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
  // The dusk sky, its clouds, and Dlicom City on the horizon (the towers'
  // feet disappear into the cloud sea).
  const sky = buildSky(scene, SUN_DIR, center, "dusk", false);
  scene.fog = new THREE.Fog("#c48fb0", 420, 1900);

  /* ---------- glass spires of Dlicom City on the horizon ---------- */
  scene.add(spires(center, lite));

  /* ---------- the cloud sea ---------- */
  const sea = cloudSea(center, lite);
  scene.add(sea.mesh);

  /* ---------- the highway ---------- */
  const N = track.N;
  const lipI = Math.round(track.lipU / track.ds);
  const landI = Math.round(track.landU / track.ds);
  const runFrom = landI, runTo = lipI + N;

  // Deck: dark, faintly metallic tarmac that catches the sunset.
  const road = new THREE.MeshStandardMaterial({
    map: T.asphaltTex(), color: "#8790b4", roughness: 0.5, metalness: 0.28, envMapIntensity: 1.15,
  });
  const deck = strip(track, runFrom, runTo, 2, [-ROAD_HALF, 0], [ROAD_HALF, 0], 1 / 10, road, false);
  deck.receiveShadow = true;
  scene.add(deck);

  // Curbs: hot pink on the left, electric cyan on the right, lit from within.
  for (const s of [-1, 1]) {
    const tex = T.curbTex(s < 0 ? "#ff4fb4" : "#2ee6ff", "#f7f9ff");
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4, emissive: "#ffffff", emissiveMap: tex, emissiveIntensity: 0.35 });
    const inner: [number, number] = [ROAD_HALF * s, 0.01];
    const outer: [number, number] = [EDGE * s, 0.12];
    const c = strip(track, runFrom, runTo, 2, s < 0 ? outer : inner, s < 0 ? inner : outer, 1 / 3.2, mat, false);
    c.receiveShadow = true;
    scene.add(c);
  }

  // Shoulders: graphite deck plates with glowing studs.
  const plates = deckTex();
  const shoulder = new THREE.MeshStandardMaterial({
    map: plates, roughness: 0.45, metalness: 0.55, emissive: "#ffffff", emissiveMap: plates.userData.glow as THREE.Texture, emissiveIntensity: 0.9,
  });
  for (const s of [-1, 1]) {
    const inner: [number, number] = [(EDGE - 0.05) * s, 0.1];
    const outer: [number, number] = [(WALL + WALL_T) * s, 0.1];
    const w = strip(track, runFrom, runTo, 2, s < 0 ? outer : inner, s < 0 ? inner : outer, 1 / 6, shoulder, false);
    w.receiveShadow = true;
    scene.add(w);
  }

  // Glass barriers with a neon rail on top: you can see the drop through them.
  const glass = new THREE.MeshStandardMaterial({
    color: "#bfe4ff", transparent: true, opacity: 0.2, roughness: 0.05, metalness: 0.9, envMapIntensity: 2.2,
    side: THREE.DoubleSide, depthWrite: false,
  });
  const haloT = haloTex();
  const fascia = fasciaTex();
  const fasciaMat = new THREE.MeshStandardMaterial({
    map: fascia, roughness: 0.5, metalness: 0.6, emissive: "#ffffff", emissiveMap: fascia.userData.glow as THREE.Texture, emissiveIntensity: 1.6,
  });
  const steel = M.plastic("#2b3150", 0.35, 0.75);
  for (const s of [-1, 1]) {
    const col = s < 0 ? new THREE.Color(1.9, 0.3, 1.0) : new THREE.Color(0.2, 1.5, 2.0);
    const neonMat = new THREE.MeshBasicMaterial({ color: col, toneMapped: false });
    const haloMat = new THREE.MeshBasicMaterial({
      map: haloT, color: col.clone().multiplyScalar(0.7), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    const w = WALL * s, wo = (WALL + WALL_T) * s;
    const pane = strip(track, runFrom, runTo, 3, [w, 0.1], [w, WALL_H + 0.25], 1, glass, false);
    pane.renderOrder = 1;
    scene.add(pane);
    const top = WALL_H + 0.25;
    const rail = s > 0
      ? strip(track, runFrom, runTo, 2, [w - 0.12, top], [w + 0.12, top], 1, neonMat, false)
      : strip(track, runFrom, runTo, 2, [w + 0.12, top], [w - 0.12, top], 1, neonMat, false);
    const halo = s > 0
      ? strip(track, runFrom, runTo, 2, [w - 0.05, top - 0.55], [w - 0.05, top + 0.3], 1, haloMat, true, -1)
      : strip(track, runFrom, runTo, 2, [w + 0.05, top + 0.3], [w + 0.05, top - 0.55], 1, haloMat, true, 1);
    halo.renderOrder = 2;
    scene.add(rail, halo);
    // The deck's outer face: steel with a running light strip.
    const face = s > 0
      ? strip(track, runFrom, runTo, 2, [wo, 0.1], [wo, -1.7], 1 / 8, fasciaMat, true, 1)
      : strip(track, runFrom, runTo, 2, [wo, -1.7], [wo, 0.1], 1 / 8, fasciaMat, true, -1);
    scene.add(face);
  }
  // Glass posts every few metres.
  const f = newFrame();
  for (let u = 0; u < track.length; u += lite ? 9 : 6) {
    if (track.inGap(u) || track.inGap(u + 2) || track.inGap(u - 2)) continue;
    track.frame(u, f);
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(M.rbox(0.16, WALL_H + 0.3, 0.16, 0.05), steel);
      post.position.copy(f.pos).addScaledVector(f.side, WALL * s).addScaledVector(f.up, (WALL_H + 0.3) / 2);
      post.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(f.side, f.up, f.tan));
      scene.add(keep(post));
    }
  }
  // Underside of the deck.
  const under = M.plastic("#1d2138", 0.6, 0.5);
  scene.add(strip(track, runFrom, runTo, 4, [WALL + WALL_T, -1.7], [-(WALL + WALL_T), -1.7], 1 / 10, under, false));

  /* ---------- pylons into the clouds ---------- */
  const pylons = pylonSet(track, lite ? 64 : 44);
  for (const m of pylons) scene.add(m);

  /* ---------- the leap: ramp, cut deck ends, rings across the gap ---------- */
  buildRamp(scene, track);
  const endMat = M.plastic("#232845", 0.45, 0.6);
  const chevron = new THREE.MeshStandardMaterial({ map: T.stripeTex("#ffcc33", "#1d2233", 8), roughness: 0.5, emissive: "#ffaa22", emissiveIntensity: 0.25 });
  for (const [u, dir] of [[track.lipU, 1], [track.landU, -1]] as const) {
    track.frame(u, f);
    const w2 = (WALL + WALL_T) * 2;
    const block = new THREE.Mesh(new THREE.BoxGeometry(w2, 1.8, 1.2), endMat);
    block.position.copy(f.pos).addScaledVector(f.tan, 0.6 * dir).addScaledVector(f.up, -0.8);
    block.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(f.side, f.up, f.tan));
    scene.add(keep(block));
    const band = new THREE.Mesh(new THREE.PlaneGeometry(w2, 0.9), chevron);
    band.position.copy(f.pos).addScaledVector(f.tan, 1.22 * dir).addScaledVector(f.up, -0.8);
    band.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(f.side.clone().multiplyScalar(dir), f.up, f.tan.clone().multiplyScalar(dir)));
    scene.add(keep(band));
  }
  // Three rings of light hang over the gap along the glide line.
  const gapRing = new THREE.MeshBasicMaterial({ color: hot("#ffd84a", 2.4), toneMapped: false });
  for (let k = 0; k < 3; k++) {
    const u = track.lipU + 5 + k * 7;
    track.frame(u, f);
    const lipY = track.point(track.lipU, 0, 0).y + 0.9;
    const x = 5 + k * 7, t = x / 24;
    const y = lipY + 7.5 * t - 5 * t * t + 1.4;
    const ring = new THREE.Mesh(M.torus(3.4, 0.16), gapRing);
    ring.position.set(f.pos.x, y, f.pos.z);
    ring.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(f.side, f.up, f.tan));
    scene.add(keep(ring));
  }

  /* ---------- start gate ---------- */
  const gateLamps = buildStart(scene, track, "DLICOM SKYWAY");

  /* ---------- neon arches over the road ---------- */
  const ARCH = ["#ff3fa4", "#2ee6ff", "#ffd84a", "#8f6bff"];
  const archMats = ARCH.map((c) => new THREE.MeshBasicMaterial({ color: hot(c, 2.2), toneMapped: false }));
  const archDim = ARCH.map((c) => new THREE.MeshBasicMaterial({ color: hot(c, 0.55), toneMapped: false }));
  const footMat = M.plastic("#20243a", 0.4, 0.7);
  let a = 0;
  for (let u = track.startU + 120; u < track.startU + track.length - 40; u += lite ? 260 : 170) {
    const w = track.wrap(u);
    if (track.inGap(w) || track.inGap(w + 30) || track.inGap(w - 30)) continue;
    track.frame(w, f);
    const g = new THREE.Group();
    g.position.copy(f.pos);
    g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(f.side, f.up, f.tan));
    const R = WALL + 0.6;
    const outer = new THREE.Mesh(M.torus(R, 0.42, Math.PI), archMats[a % ARCH.length]);
    const inner = new THREE.Mesh(M.torus(R - 1.1, 0.14, Math.PI), archDim[(a + 1) % ARCH.length]);
    g.add(outer, inner);
    for (const s of [-1, 1]) {
      const foot = new THREE.Mesh(M.rbox(1.4, 1.2, 1.4, 0.2), footMat);
      foot.position.set(R * s, 0.6, 0);
      g.add(foot);
    }
    scene.add(keep(g));
    a++;
  }

  /* ---------- floating islands ---------- */
  const centre: { x: number; z: number }[] = [];
  for (let u = 0; u < track.length; u += 10) { const p = track.point(u, 0, 0); centre.push({ x: p.x, z: p.z }); }
  const clear = (x: number, z: number, r: number) => centre.every((c) => (c.x - x) ** 2 + (c.z - z) ** 2 > r * r);
  scene.add(islands(center, lite ? 9 : 18, clear));

  /* ---------- wisps of cloud drifting just off the road ---------- */
  const wisps: THREE.Sprite[] = [];
  if (!lite) {
    const tex = [0, 1, 2].map((i) => cloudTexture(i + 7));
    for (let i = 0; i < 26; i++) {
      const u = track.wrap(i * (track.length / 26) + rnd(i, 1) * 30);
      track.frame(u, f);
      const flat = new THREE.Vector3(f.side.x, 0, f.side.z).normalize();
      const s = i % 2 ? 1 : -1;
      const off = WALL + 30 + rnd(i, 2) * 70;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex[i % 3], transparent: true, depthWrite: false, opacity: 0.85,
        color: new THREE.Color().setRGB(1, 0.86, 0.9),
      }));
      const w = 60 + rnd(i, 3) * 60;
      sp.scale.set(w, w * 0.42, 1);
      sp.position.set(f.pos.x + flat.x * off * s, f.pos.y - 6 - rnd(i, 4) * 12, f.pos.z + flat.z * off * s);
      sp.userData.base = sp.position.clone();
      scene.add(sp);
      wisps.push(sp);
    }
  }

  /* ---------- holographic Dlicom emblems in the sky ---------- */
  const spinners: THREE.Object3D[] = [];
  const emblem = T.emblemTex("#2f6bff", "#ffffff", "#ffc21f");
  const holoMat = new THREE.MeshBasicMaterial({ map: emblem, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false, toneMapped: false, color: new THREE.Color(1.3, 1.3, 1.5) });
  for (let k = 0; k < (lite ? 2 : 4); k++) {
    const u = track.wrap(track.startU + 260 + k * (track.length / 4.2));
    if (track.inGap(u)) continue;
    track.frame(u, f);
    const flat = new THREE.Vector3(f.side.x, 0, f.side.z).normalize();
    const s = k % 2 ? 1 : -1;
    const g = new THREE.Group();
    g.position.set(f.pos.x + flat.x * 70 * s, f.pos.y + 34 + k * 6, f.pos.z + flat.z * 70 * s);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(11, 48), holoMat);
    const ring = new THREE.Mesh(M.torus(11.6, 0.35), new THREE.MeshBasicMaterial({ color: hot("#5f86ff", 2.4), toneMapped: false }));
    g.add(disc, ring);
    scene.add(g);
    spinners.push(g);
  }

  /* ---------- traffic in the sky ---------- */
  const airship = blimp(scene, center, 520);
  const traffic = skyTraffic(scene, center, lite ? 8 : 22);

  mergeStatic(scene, takeStatic(), true);

  const water = T.waterTex();
  return {
    sun, gateLamps, sky, water, balloons: [], spinners, flags: [], center,
    animate: (t: number) => {
      sea.uTime.value = t;
      airship.update(t);
      traffic.update(t);
      for (let i = 0; i < wisps.length; i++) {
        const b = wisps[i].userData.base as THREE.Vector3;
        wisps[i].position.set(b.x + Math.sin(t * 0.05 + i) * 6, b.y + Math.sin(t * 0.3 + i * 2) * 1.2, b.z);
      }
    },
  };
}

/* ================================================================== */
/* Pieces                                                              */
/* ================================================================== */

/**
 * The cloud sea: one big plane with a shader. Two layers of drifting noise
 * make the cloud tops, lit gold where they face the sun and lavender in the
 * hollows, fading into the horizon colour far away. Phones use fewer layers.
 */
function cloudSea(center: THREE.Vector3, lite: boolean) {
  const uTime = { value: 0 };
  const uCam = { value: new THREE.Vector3() };
  const mat = new THREE.ShaderMaterial({
    fog: false,
    defines: { OCT: lite ? 3 : 5, HQ: lite ? 0 : 1 },
    uniforms: {
      uTime, uCam,
      uSun: { value: SUN_DIR },
      uLit: { value: new THREE.Color("#ffe1c2") },
      uMid: { value: new THREE.Color("#e7a3c4") },
      uShade: { value: new THREE.Color("#6c5aa6") },
      uHorA: { value: new THREE.Color("#d58ab8") },
      uHorB: { value: new THREE.Color("#ffbf7a") },
    },
    vertexShader: `varying vec3 vW;
      void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `
      uniform float uTime; uniform vec3 uCam, uSun, uLit, uMid, uShade, uHorA, uHorB;
      varying vec3 vW;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p){
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
      }
      float fbm(vec2 p){
        float v = 0.0, a = 0.5;
        for (int i = 0; i < OCT; i++) { v += a * noise(p); p = p * 2.03 + vec2(17.0, 9.0); a *= 0.5; }
        return v;
      }
      void main(){
        vec2 p = vW.xz * 0.0055 + vec2(uTime * 0.006, uTime * 0.004);
        float h = fbm(p);
        // Puffy tops: push the mid-range up so the clouds look heaped.
        h = smoothstep(0.22, 0.8, h);
        #if HQ
          float hs = smoothstep(0.22, 0.8, fbm(p + normalize(uSun.xz) * 0.06));
          float lit = clamp(0.55 + (h - hs) * 5.0, 0.0, 1.0);
        #else
          float lit = h;
        #endif
        vec3 col = mix(uShade, uMid, smoothstep(0.0, 0.55, h));
        col = mix(col, uLit, smoothstep(0.45, 1.0, h) * (0.45 + lit * 0.55));
        vec2 to = vW.xz - uCam.xz;
        float d = length(to);
        vec2 dir = to / max(d, 1.0);
        float sunSide = pow(max(dot(dir, normalize(uSun.xz)), 0.0), 3.0);
        vec3 hor = mix(uHorA, uHorB, sunSide);
        col = mix(col, hor, smoothstep(220.0, 2200.0, d));
        // A golden path on the clouds towards the low sun.
        col += vec3(1.0, 0.7, 0.4) * pow(sunSide, 6.0) * smoothstep(300.0, 1800.0, d) * 0.45;
        gl_FragColor = vec4(col * 0.95, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(7000, 7000).rotateX(-Math.PI / 2), mat);
  mesh.position.set(center.x, CLOUD_Y, center.z);
  mesh.renderOrder = -5;
  mesh.onBeforeRender = (_r, _s, cam) => { uCam.value.copy(cam.position); };
  return { mesh, uTime };
}

/**
 * The city on the horizon: slim tapered glass spires rising out of the
 * clouds, lit windows running up them and a neon crown on each, hazed pink
 * by the distance. Two meshes (bodies and crowns) for the whole skyline.
 */
function spires(center: THREE.Vector3, lite: boolean) {
  const g = new THREE.Group();
  const bodies: THREE.BufferGeometry[] = [];
  const crowns: THREE.BufferGeometry[] = [];
  const n = lite ? 22 : 40;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (rnd(i, 1) - 0.5) * 0.12;
    const r = 1150 + rnd(i, 2) * 380;
    const h = 170 + rnd(i, 3) ** 1.5 * 300 + (i % 7 === 0 ? 140 : 0);
    const w = 22 + rnd(i, 4) * 26;
    const sides = rnd(i, 5) < 0.5 ? 4 : 6;
    const body = new THREE.CylinderGeometry(w * (0.35 + rnd(i, 6) * 0.3), w, h, sides, 1).translate(0, h / 2 - 20, 0);
    // Windows: UVs in metres so every spire gets the same window size.
    const uv = body.attributes.uv as THREE.BufferAttribute;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * (w * 3) / 40 + rnd(i, 7), uv.getY(k) * h / 40);
    body.rotateY(rnd(i, 8) * Math.PI);
    const x = center.x + Math.cos(a) * r, z = center.z + Math.sin(a) * r;
    body.translate(x, CLOUD_Y, z);
    bodies.push(body);
    // Crown: a ring of light and a needle with a beacon.
    const top = CLOUD_Y + h - 20;
    crowns.push(new THREE.TorusGeometry(w * 0.42, 1.2, 4, 18).rotateX(Math.PI / 2).translate(x, top - 6, z));
    crowns.push(new THREE.CylinderGeometry(0.6, 1.4, 40 + rnd(i, 9) * 40, 6).translate(x, top + 20, z));
  }
  const { map, glow } = T.curtainTex(1);
  const bodyMat = new THREE.MeshStandardMaterial({
    map, color: "#b8a6e8", emissive: "#ffffff", emissiveMap: glow, emissiveIntensity: 1.4, roughness: 0.3, metalness: 0.6,
  });
  g.add(new THREE.Mesh(mergeGeometries(bodies)!, bodyMat));
  g.add(new THREE.Mesh(mergeGeometries(crowns)!, new THREE.MeshBasicMaterial({ color: hot("#ff7ad0", 2.2), toneMapped: false })));
  return g;
}

/** Pylons: a tapered column from the deck down into the clouds, a cap, and a ring of light. */
function pylonSet(track: Track, every: number) {
  const f = newFrame();
  const spots: { pos: THREE.Vector3; tan: THREE.Vector3; h: number }[] = [];
  for (let u = 8; u < track.length; u += every) {
    if (track.inGap(u) || track.inGap(u + 12) || track.inGap(u - 12)) continue;
    track.frame(u, f);
    spots.push({ pos: f.pos.clone(), tan: f.tan.clone(), h: f.pos.y - 1.7 - (CLOUD_Y - 30) });
  }
  const colGeo = new THREE.CylinderGeometry(1.15, 1.7, 1, 16, 1, true).translate(0, -0.5, 0);
  const capGeo = mergeGeometries([
    new THREE.BoxGeometry(14, 1.4, 3).translate(0, -0.7, 0),
    new THREE.BoxGeometry(5, 2.2, 3.4).translate(0, -1.8, 0),
  ])!;
  const ringGeo = new THREE.TorusGeometry(1.5, 0.12, 6, 24).rotateX(Math.PI / 2);
  const col = new THREE.InstancedMesh(colGeo, M.plastic("#c7cde0", 0.4, 0.55), spots.length);
  const cap = new THREE.InstancedMesh(capGeo, M.plastic("#2a2f4a", 0.45, 0.6), spots.length);
  const ring = new THREE.InstancedMesh(ringGeo, new THREE.MeshBasicMaterial({ color: hot("#5fd0ff", 2.4), toneMapped: false }), spots.length * 2);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  spots.forEach((sp, i) => {
    const yaw = Math.atan2(sp.tan.x, sp.tan.z);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    p.set(sp.pos.x, sp.pos.y - 1.7, sp.pos.z);
    m.compose(p, q, s.set(1, sp.h, 1));
    col.setMatrixAt(i, m);
    m.compose(p, q, s.set(1, 1, 1));
    cap.setMatrixAt(i, m);
    for (let k = 0; k < 2; k++) {
      p.set(sp.pos.x, sp.pos.y - 7 - k * 9, sp.pos.z);
      m.compose(p, q, s.set(1 + k * 0.08, 1, 1 + k * 0.08));
      ring.setMatrixAt(i * 2 + k, m);
    }
  });
  col.castShadow = false;
  cap.receiveShadow = true;
  return [col, cap, ring];
}

/**
 * Floating islands: rock cones with grassy, blossom-dotted tops and little
 * pines, all merged into one vertex-coloured mesh (one draw call).
 */
function islands(center: THREE.Vector3, count: number, clear: (x: number, z: number, r: number) => boolean) {
  const parts: THREE.BufferGeometry[] = [];
  const c = new THREE.Color();
  const paint = (g: THREE.BufferGeometry, color: (y: number, i: number) => THREE.Color) => {
    const pos = g.attributes.position as THREE.BufferAttribute;
    const cols = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const k = color(pos.getY(i), i);
      cols[i * 3] = k.r; cols[i * 3 + 1] = k.g; cols[i * 3 + 2] = k.b;
    }
    g.setAttribute("color", new THREE.BufferAttribute(cols, 3));
    return g;
  };
  const grass = new THREE.Color("#79d36a"), blossom = new THREE.Color("#ff9cc9"), rock = new THREE.Color("#8a77a8"), deep = new THREE.Color("#3b2f5c");
  let placed = 0;
  for (let n = 0; n < count * 6 && placed < count; n++) {
    const a = rnd(n, 1) * Math.PI * 2, r = 260 + rnd(n, 2) * 640;
    const x = center.x + Math.cos(a) * r, z = center.z + Math.sin(a) * r;
    const size = 14 + rnd(n, 3) * 34;
    if (!clear(x, z, size + 70)) continue;
    const y = 25 + rnd(n, 4) * 120;
    placed++;
    // The rock: an icosphere, flattened on top and drawn down into a cone.
    const g = new THREE.IcosahedronGeometry(1, 2).toNonIndexed();
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      let vx = p.getX(i), vy = p.getY(i), vz = p.getZ(i);
      const wob = 1 + (rnd(i + n * 97, 5) - 0.5) * 0.25;
      if (vy > 0) vy *= 0.22;
      else { const k = 1 + vy * 0.55; vx *= k; vz *= k; vy *= 2.4 * wob; }
      p.setXYZ(i, vx * size * wob, vy * size, vz * size * wob);
    }
    g.computeVertexNormals();
    paint(g, (vy) => vy > size * 0.12 ? c.copy(grass).lerp(blossom, rnd(n, 6) * 0.5) : c.copy(rock).lerp(deep, Math.min(1, -vy / (size * 2.2))));
    g.translate(x, y, z);
    parts.push(g);
    // Trees on top.
    for (let k = 0; k < 3 + Math.floor(size / 10); k++) {
      const ta = rnd(n * 7 + k, 7) * Math.PI * 2, tr = rnd(n * 7 + k, 8) * size * 0.6;
      const th = 4 + rnd(n * 7 + k, 9) * 6;
      const tx = x + Math.cos(ta) * tr, tz = z + Math.sin(ta) * tr, ty = y + size * 0.2;
      const pink = rnd(n * 7 + k, 10) < 0.35;
      const leaf = new THREE.ConeGeometry(th * 0.42, th, 7).toNonIndexed().translate(tx, ty + th * 0.75, tz);
      paint(leaf, () => c.set(pink ? "#ff86bd" : "#3fae6a"));
      const trunk = new THREE.CylinderGeometry(0.35, 0.5, th * 0.4, 5).toNonIndexed().translate(tx, ty + th * 0.2, tz);
      paint(trunk, () => c.set("#6b4a3a"));
      parts.push(leaf, trunk);
    }
  }
  for (const g of parts) for (const name of Object.keys(g.attributes)) if (!["position", "normal", "color"].includes(name)) g.deleteAttribute(name);
  const merged = mergeGeometries(parts)!;
  merged.computeVertexNormals();
  const mesh = new THREE.Mesh(merged, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 }));
  mesh.receiveShadow = false;
  return mesh;
}

/** Shoulder plates: graphite panels with seams, and a glow map of small studs. */
function deckTex() {
  const W = 256, H = 256;
  const c = document.createElement("canvas"), cg = document.createElement("canvas");
  c.width = cg.width = W; c.height = cg.height = H;
  const g = c.getContext("2d")!, gg = cg.getContext("2d")!;
  g.fillStyle = "#3a4060"; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = ["#353b58", "#40476a", "#3b4264"][i % 3];
    g.fillRect(Math.random() * W, Math.random() * H, 2, 2);
  }
  g.strokeStyle = "#20243a"; g.lineWidth = 4;
  g.strokeRect(2, 2, W - 4, H - 4);
  g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke();
  gg.fillStyle = "#000"; gg.fillRect(0, 0, W, H);
  for (const [x, y] of [[W / 2, H / 4], [W / 2, (H * 3) / 4]]) {
    for (const [cc, gc] of [[g, "#7fe6ff"], [gg, "#4fd2ff"]] as const) {
      cc.fillStyle = gc;
      cc.beginPath(); cc.arc(x, y, 7, 0, Math.PI * 2); cc.fill();
    }
  }
  const t = new THREE.CanvasTexture(c), tg = new THREE.CanvasTexture(cg);
  for (const x of [t, tg]) { x.wrapS = x.wrapT = THREE.RepeatWrapping; x.colorSpace = THREE.SRGBColorSpace; x.anisotropy = 8; }
  t.userData.glow = tg;
  return t;
}

/** The deck's outer face: brushed steel with two running light strips. */
function fasciaTex() {
  const W = 256, H = 64;
  const c = document.createElement("canvas"), cg = document.createElement("canvas");
  c.width = cg.width = W; c.height = cg.height = H;
  const g = c.getContext("2d")!, gg = cg.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, "#4a5274"); grad.addColorStop(1, "#262b45");
  g.fillStyle = grad; g.fillRect(0, 0, W, H);
  gg.fillStyle = "#000"; gg.fillRect(0, 0, W, H);
  for (const [y, col] of [[H * 0.3, "#ff5fc0"], [H * 0.72, "#4fd8ff"]] as const) {
    for (const cc of [g, gg]) {
      cc.fillStyle = col;
      for (let x = 0; x < W; x += 32) cc.fillRect(x + 2, y - 2, 26, 4);
    }
  }
  const t = new THREE.CanvasTexture(c), tg = new THREE.CanvasTexture(cg);
  for (const x of [t, tg]) { x.wrapS = x.wrapT = THREE.RepeatWrapping; x.colorSpace = THREE.SRGBColorSpace; }
  t.userData.glow = tg;
  return t;
}
