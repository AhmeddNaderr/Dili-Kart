import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import * as T from "./textures";
import * as M from "./models";
import { CURB_W, EDGE, ROAD_HALF, WALL, Track, newFrame } from "./track";
import { grassTufts, plantAll, type Plant } from "./nature";
import { buildSky, type Sky } from "./sky";
import { billboards, streetLamps } from "./trackside";
import { blimp, floodMasts, pitBuilding } from "./circuit";

export type Quality = "high" | "low";

/** The ellipse the stadium bowl sits on, fitted around the circuit. */
function bowl(track: Track) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of track.outline(8)) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  return { cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, rx: (maxX - minX) / 2 + 62, rz: (maxZ - minZ) / 2 + 58 };
}

/** Is (x, z) inside the bowl with at least `margin` metres to spare? */
function insideBowl(b: ReturnType<typeof bowl>, x: number, z: number, margin: number) {
  const dx = (x - b.cx) / (b.rx - margin), dz = (z - b.cz) / (b.rz - margin);
  return dx * dx + dz * dz < 1;
}

/**
 * Builds the stadium: lights, sky, road and its trim, the jump, the start
 * gate, the stands, and the props dotted around the infield. Returns the
 * handful of things that animate so the game can drive them each frame.
 */

export interface World {
  sun: THREE.DirectionalLight;
  /** Start gate lamps, left to right: red, red, red, then all green on GO. */
  gateLamps: THREE.Mesh[];
  sky: Sky;
  water: THREE.Texture;
  balloons: THREE.Object3D[];
  spinners: THREE.Object3D[];
  flags: THREE.Object3D[];
  /** Middle of the stadium bowl, at ground level. */
  center: THREE.Vector3;
  /** Weather that follows the camera (Neon Town's drizzle). */
  weather?: { update(cam: THREE.Camera, dt: number, focus?: THREE.Vector3): void };
  /** Anything else in the world that moves (screens, trains, traffic). */
  animate?: (t: number, dt: number) => void;
}

export const WALL_T = 0.7;
export const WALL_H = 1.25;

/** Props that never move. Merged into a few big meshes once the world is built. */
let STATIC: THREE.Object3D[] = [];
export const keep = <O extends THREE.Object3D>(o: O) => { STATIC.push(o); return o; };
/** Hand over (and clear) the props gathered by `keep`, for merging. */
export function takeStatic() { const s = STATIC; STATIC = []; return s; }

export function buildWorld(scene: THREE.Scene, renderer: THREE.WebGLRenderer, track: Track, diliImg: HTMLImageElement | null, quality: Quality = "high"): World {
  /* ---------- light ---------- */
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.42;
  pmrem.dispose();

  // Lights are kept modest and the renderer's exposure lifts the image.
  // Bloom sees the scene before exposure, so only real glows (emissives,
  // hot highlights) cross its threshold — sunlit grass doesn't haze over.
  // Dusk: a cool blue sky fill and a low, warm golden sun.
  scene.add(new THREE.HemisphereLight("#8fa4ff", "#2a2f3e", 0.72));
  const sun = new THREE.DirectionalLight("#ffc07a", 2.1);
  sun.castShadow = true;
  sun.shadow.mapSize.setScalar(quality === "low" ? 1024 : 4096);
  const sc = sun.shadow.camera;
  sc.left = -38; sc.right = 38; sc.top = 38; sc.bottom = -38; sc.near = 1; sc.far = 220;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);

  /* ---------- sky ---------- */
  const SUN_DIR = new THREE.Vector3(-0.62, 0.16, 0.5).normalize();
  const bw = bowl(track);
  const sky = buildSky(scene, SUN_DIR, new THREE.Vector3(bw.cx, 0, bw.cz));
  // Distance haze in the dusk colour: the skyline sits softly behind it.
  scene.fog = new THREE.Fog("#57508f", 320, 1350);

  /* ---------- ground ---------- */
  const grassBig = T.grassTex(true);
  grassBig.repeat.set(160, 160);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(4400, 4400).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ map: grassBig, roughness: 0.95 }),
  );
  ground.position.set(80, -0.06, -40);
  ground.receiveShadow = true;
  scene.add(ground);

  /* ---------- the circuit ---------- */
  const N = track.N;
  const lipI = Math.round(track.lipU / track.ds);
  const landI = Math.round(track.landU / track.ds);
  // Everything except the gap: from the landing all the way round to the lip.
  const runFrom = landI, runTo = lipI + N;

  const asphalt = new THREE.MeshStandardMaterial({ map: T.asphaltTex(), roughness: 0.82 });
  const candy = new THREE.MeshStandardMaterial({ map: T.candyTex(), roughness: 0.55 });
  const idx = (u: number) => Math.round(u / track.ds);
  const candyRanges: [number, number][] = [
    [idx(track.ctrlU[3]), idx(track.ctrlU[6])],
    [idx(track.ctrlU[14]), idx(track.ctrlU[17])],
  ];
  // Split the drivable run into asphalt / candy stretches.
  const cuts = [runFrom, ...candyRanges.flat().map((i) => (i < runFrom ? i + N : i)), runTo]
    .filter((i) => i >= runFrom && i <= runTo).sort((a, b) => a - b);
  for (let k = 0; k < cuts.length - 1; k++) {
    const a = cuts[k], b = cuts[k + 1];
    if (b - a < 2) continue;
    const mid = ((a + b) / 2) % N;
    const isCandy = candyRanges.some(([s, e]) => mid >= s && mid <= e);
    const m = strip(track, a, b, 2, [-ROAD_HALF, 0], [ROAD_HALF, 0], 1 / 10, isCandy ? candy : asphalt, false);
    m.receiveShadow = true;
    scene.add(m);
  }

  // Curbs: Dlicom blue and white, red and white through the hairpins.
  const curbBlue = new THREE.MeshStandardMaterial({ map: T.curbTex("#2f6bff", "#f7f9ff"), roughness: 0.5 });
  const curbRed = new THREE.MeshStandardMaterial({ map: T.curbTex("#ff4057", "#f7f9ff"), roughness: 0.5 });
  for (let k = 0; k < cuts.length - 1; k++) {
    const a = cuts[k], b = cuts[k + 1];
    if (b - a < 2) continue;
    const mid = ((a + b) / 2) % N;
    const mat = candyRanges.some(([s, e]) => mid >= s && mid <= e) ? curbRed : curbBlue;
    for (const s of [-1, 1]) {
      const inner: [number, number] = [ROAD_HALF * s, 0.01];
      const outer: [number, number] = [EDGE * s, 0.12];
      const m = strip(track, a, b, 2, s < 0 ? outer : inner, s < 0 ? inner : outer, 1 / 3.2, mat, false);
      m.receiveShadow = true;
      scene.add(m);
    }
  }

  // Runoff grass between curbs and walls.
  const runoffTex = T.grassTex(false);
  const runoff = new THREE.MeshStandardMaterial({ map: runoffTex, roughness: 0.9 });
  for (const s of [-1, 1]) {
    const inner: [number, number] = [(EDGE - 0.05) * s, -0.02];
    const outer: [number, number] = [WALL * s, -0.02];
    const m = strip(track, runFrom, runTo, 2, s < 0 ? outer : inner, s < 0 ? inner : outer, 1 / 12, runoff, false);
    m.receiveShadow = true;
    scene.add(m);
  }

  // Barrier walls: blue Dlicom panels facing the road, white caps.
  // The wall boards are backlit, like LED panels.
  const wallTexture = T.wallTex();
  const wallFront = new THREE.MeshStandardMaterial({
    map: wallTexture, roughness: 0.45, emissive: "#ffffff", emissiveMap: wallTexture, emissiveIntensity: 0.55,
  });
  const wallCap = M.plastic("#f4f7ff", 0.4);
  // Saturated core plus a wide, faint additive halo reads as neon without
  // blowing out to white.
  const neonMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.22, 0.45, 1.7), toneMapped: false });
  const haloMat = new THREE.MeshBasicMaterial({
    map: haloTex(), color: new THREE.Color(0.2, 0.4, 1.2), transparent: true, blending: THREE.AdditiveBlending,
    depthWrite: false, toneMapped: false,
  });
  for (const s of [-1, 1]) {
    const w = WALL * s, wo = (WALL + WALL_T) * s;
    // Inner face — orientation chosen so the normal faces the road.
    const face = s > 0
      ? strip(track, runFrom, runTo, 2, [w, -0.3], [w, WALL_H], 1 / 18, wallFront, true, -1)
      : strip(track, runFrom, runTo, 2, [w, WALL_H], [w, -0.3], 1 / 18, wallFront, true, 1);
    face.castShadow = true;
    face.receiveShadow = true;
    scene.add(face);
    // Dlicom-blue neon line along the top of each wall.
    // The line runs along the top of the wall, where the chase camera sees it.
    const wn = (WALL + 0.22) * s;
    const neon = s > 0
      ? strip(track, runFrom, runTo, 2, [w - 0.01, WALL_H + 0.012], [wn, WALL_H + 0.012], 1, neonMat, false)
      : strip(track, runFrom, runTo, 2, [wn, WALL_H + 0.012], [w + 0.01, WALL_H + 0.012], 1, neonMat, false);
    const halo = s > 0
      ? strip(track, runFrom, runTo, 2, [w - 0.05, WALL_H - 0.55], [w - 0.05, WALL_H + 0.25], 1, haloMat, true, -1)
      : strip(track, runFrom, runTo, 2, [w + 0.05, WALL_H + 0.25], [w + 0.05, WALL_H - 0.55], 1, haloMat, true, 1);
    halo.renderOrder = 2;
    scene.add(neon, halo);
    const top = strip(track, runFrom, runTo, 2, s < 0 ? [wo, WALL_H] : [w, WALL_H], s < 0 ? [w, WALL_H] : [wo, WALL_H], 1 / 4, wallCap, false);
    scene.add(top);
    const back = s > 0
      ? strip(track, runFrom, runTo, 2, [wo, WALL_H], [wo, -3], 1 / 18, wallFront, true, 1)
      : strip(track, runFrom, runTo, 2, [wo, -3], [wo, WALL_H], 1 / 18, wallFront, true, -1);
    scene.add(back);
  }

  // Grass embankments wherever the road is raised off the ground.
  const bank = new THREE.MeshStandardMaterial({ map: runoffTex, roughness: 0.95 });
  for (const s of [-1, 1]) {
    const m = embankment(track, runFrom, runTo, s, bank);
    m.receiveShadow = true;
    scene.add(m);
  }
  scene.add(underside(track, runFrom, runTo, M.plastic("#8d96ad", 0.8)));

  /* ---------- the jump ---------- */
  const water = T.waterTex();
  water.repeat.set(6, 6);
  buildJump(scene, track, water);

  /* ---------- start line, grid and gate ---------- */
  const gateLamps = buildStart(scene, track);

  /* ---------- stadium ---------- */
  buildStadium(scene, track, diliImg);
  pitBuilding(scene, track, keep);
  const bowlC = new THREE.Vector3(bw.cx, 0, bw.cz);
  floodMasts(scene, bowlC, bw.rx, bw.rz, keep);
  const airship = blimp(scene, bowlC, Math.min(bw.rx, bw.rz) * 0.55);

  /* ---------- props ---------- */
  const props = dressInfield(scene, track, quality);
  mergeStatic(scene, STATIC, true);
  STATIC = [];

  return { sun, gateLamps, sky, water, ...props, center: new THREE.Vector3(bw.cx, 0, bw.cz), animate: (t: number) => airship.update(t) };
}

/* ================================================================== */
/* Mesh builders                                                       */
/* ================================================================== */

/**
 * A ribbon following the track between two cross-section points, a and b,
 * each [lateral, lift]. The normal is cross(b - a, forward), so pass them in
 * the order that makes the surface face where you want. `alongU` swaps the
 * texture axes, for things like walls whose artwork runs along the track;
 * `uSign` flips that direction so lettering reads the right way round.
 */
export function strip(
  track: Track, from: number, to: number, step: number,
  a: [number, number], b: [number, number], vPerM: number,
  mat: THREE.Material, alongU: boolean, uSign = 1,
) {
  const pos: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  let rings = 0;
  for (const i of ringIndices(from, to, step)) {
    const s = track.sample(i);
    const d = i * track.ds * vPerM;
    for (const [lat, lift] of [a, b]) {
      pos.push(
        s.pos.x + s.side.x * lat + s.up.x * lift,
        s.pos.y + s.side.y * lat + s.up.y * lift,
        s.pos.z + s.side.z * lat + s.up.z * lift,
      );
    }
    // Along-track artwork: V always runs bottom (0) to top (1).
    const va = a[1] <= b[1] ? 0 : 1;
    if (alongU) uv.push(d * uSign, va, d * uSign, 1 - va);
    else uv.push(0, d, 1, d);
    rings++;
  }
  for (let r = 0; r < rings - 1; r++) {
    const A = r * 2, B = A + 1, C = A + 2, D = A + 3;
    index.push(A, B, C, B, D, C);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return new THREE.Mesh(g, mat);
}

/** Vertical glow falloff for the neon halo: dark → bright at the line → dark. */
export function haloTex() {
  const c = document.createElement("canvas");
  c.width = 4;
  c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 64, 0, 0);
  grad.addColorStop(0, "#000");
  grad.addColorStop(0.5, "#fff");
  grad.addColorStop(0.6, "#fff");
  grad.addColorStop(1, "#000");
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 64);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

/** Sample indices from..to in steps, always ending exactly on `to` so neighbouring strips meet. */
function ringIndices(from: number, to: number, step: number) {
  const out: number[] = [];
  for (let i = from; i < to; i += step) out.push(i);
  out.push(to);
  return out;
}

/**
 * Slope from the outside of the wall down to the ground, where the road is
 * raised. Its width is clamped so it never folds across the inside of a
 * tight bend, and never reaches over another stretch of road — where the
 * track descends through a hairpin, an unclamped slope from the high side
 * would sit on top of the low side.
 */
export function embankment(track: Track, from: number, to: number, s: number, mat: THREE.Material) {
  const pos: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  let rings = 0;
  // Centreline, sampled every 3 m, for the "over another road" test.
  const centre: { u: number; x: number; z: number }[] = [];
  for (let u = 0; u < track.length; u += 3) {
    const p = track.point(u, 0, 0);
    centre.push({ u, x: p.x, z: p.z });
  }
  const minOff = WALL + WALL_T + 0.25;
  const keepOut = WALL + WALL_T + 0.8;
  const overRoad = (x: number, z: number, u: number) => {
    for (const c of centre) {
      const du = Math.abs(track.delta(u, c.u));
      if (du < 24) continue;
      if ((c.x - x) ** 2 + (c.z - z) ** 2 < keepOut * keepOut) return true;
    }
    return false;
  };
  for (const i of ringIndices(from, to, 3)) {
    const f = track.sample(i);
    const u = i * track.ds;
    const h = Math.max(0, f.pos.y);
    const inner = f.pos.clone().addScaledVector(f.side, (WALL + WALL_T) * s).addScaledVector(f.up, -0.02);
    const flat = new THREE.Vector3(f.side.x, 0, f.side.z).normalize();
    let off = WALL + WALL_T + 1 + h * 2.4;
    // Inside of a bend: stay well short of the centre of the turn.
    if (Math.sign(f.curv) === s && Math.abs(f.curv) > 1e-4) off = Math.min(off, 0.8 / Math.abs(f.curv));
    off = Math.max(minOff, off);
    while (off > minOff && overRoad(f.pos.x + flat.x * off * s, f.pos.z + flat.z * off * s, u)) off = Math.max(minOff, off - 0.5);
    const outer = new THREE.Vector3(f.pos.x, -0.02, f.pos.z).addScaledVector(flat, off * s);
    const d = i * track.ds / 12;
    const pair = s > 0 ? [inner, outer] : [outer, inner];
    for (const p of pair) pos.push(p.x, p.y, p.z);
    uv.push(0, d, 1, d);
    rings++;
  }
  for (let r = 0; r < rings - 1; r++) {
    const A = r * 2, B = A + 1, C = A + 2, D = A + 3;
    index.push(A, B, C, B, D, C);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return new THREE.Mesh(g, mat);
}

/** Closes the underside of raised road so there's no see-through gap. */
export function underside(track: Track, from: number, to: number, mat: THREE.Material) {
  const m = strip(track, from, to, 4, [WALL + WALL_T, -3], [-(WALL + WALL_T), -3], 1 / 10, mat, false);
  return m;
}

/* ================================================================== */
/* Landmarks                                                           */
/* ================================================================== */

export function buildJump(scene: THREE.Scene, track: Track, water: THREE.Texture, withLake = true) {
  const f = newFrame();
  // Kicker ramp: the last few metres before the lip rise into a lip.
  const rampLen = 7;
  const chev = T.chevronTex();
  chev.repeat.set(3, 1);
  const rampMat = new THREE.MeshStandardMaterial({ map: chev, roughness: 0.4, emissive: "#ff8a00", emissiveIntensity: 0.25 });
  const pos: number[] = [], uv: number[] = [], index: number[] = [];
  const steps = 10;
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    const u = track.lipU - rampLen + t * rampLen;
    track.frame(u, f);
    const lift = 0.02 + t * t * 0.9;
    for (const lat of [-ROAD_HALF, ROAD_HALF]) {
      const p = f.pos.clone().addScaledVector(f.side, lat).addScaledVector(f.up, lift);
      pos.push(p.x, p.y, p.z);
    }
    uv.push(0, t, 1, t);
  }
  for (let k = 0; k < steps; k++) {
    const A = k * 2;
    index.push(A, A + 1, A + 2, A + 1, A + 3, A + 2);
  }
  const rg = new THREE.BufferGeometry();
  rg.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  rg.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  rg.setIndex(index);
  rg.computeVertexNormals();
  const ramp = new THREE.Mesh(rg, rampMat);
  ramp.receiveShadow = true;
  scene.add(ramp);

  // Stone abutments where the road stops and starts again. Each one is the
  // full cross-section — embankment slopes, walls and deck — so every cut
  // end at the gap is closed off.
  const stoneTex = T.stoneTex();
  stoneTex.repeat.set(0.28, 0.28);
  const stone = new THREE.MeshStandardMaterial({ map: stoneTex, roughness: 0.9, side: THREE.DoubleSide });
  const stripe = new THREE.MeshStandardMaterial({ map: T.stripeTex("#ffcc33", "#1d2233", 6), roughness: 0.5 });
  for (const [u, dir] of [[track.lipU, 1], [track.landU, -1]] as const) {
    track.frame(u, f);
    const flat = new THREE.Vector3(f.side.x, 0, f.side.z).normalize();
    const h = Math.max(0, f.pos.y);
    const toe = WALL + WALL_T + 1 + h * 2.4;
    const W2 = WALL + WALL_T;
    const y = (lat: number, lift: number) => track.point(u, lat, lift).y;
    const shape = new THREE.Shape();
    shape.moveTo(-toe, -0.05);
    shape.lineTo(toe, -0.05);
    shape.lineTo(W2, y(W2, WALL_H));
    shape.lineTo(WALL, y(WALL, WALL_H));
    shape.lineTo(WALL, y(WALL, 0) - 0.03);
    shape.lineTo(-WALL, y(-WALL, 0) - 0.03);
    shape.lineTo(-WALL, y(-WALL, WALL_H));
    shape.lineTo(-W2, y(-W2, WALL_H));
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 1.6, bevelEnabled: false });
    // Shape x → across the track, y → height, extrusion → along the track (into the gap).
    const m = new THREE.Matrix4().makeBasis(flat, new THREE.Vector3(0, 1, 0), new THREE.Vector3(f.tan.x, 0, f.tan.z).normalize().multiplyScalar(dir));
    geo.applyMatrix4(m);
    const block = new THREE.Mesh(geo, stone);
    block.position.set(f.pos.x, 0, f.pos.z);
    block.castShadow = true;
    block.receiveShadow = true;
    scene.add(keep(block));
    const band = new THREE.Mesh(new THREE.BoxGeometry(WALL * 2, 0.7, 0.08), stripe);
    band.position.copy(f.pos).addScaledVector(f.tan, 1.62 * dir);
    band.position.y = h - 0.42;
    band.rotation.y = Math.atan2(f.tan.x, f.tan.z);
    scene.add(keep(band));
  }

  if (!withLake) return;
  // A round lake under the gap, with a sandy shore and lily pads.
  track.frame((track.lipU + track.landU) / 2, f);
  const c = new THREE.Vector3(f.pos.x, 0, f.pos.z);
  const shore = new THREE.Mesh(new THREE.CircleGeometry(31, 48).rotateX(-Math.PI / 2), M.plastic("#f3d99a", 0.95));
  shore.position.set(c.x, 0.02, c.z);
  shore.receiveShadow = true;
  scene.add(shore);
  const lake = new THREE.Mesh(new THREE.CircleGeometry(28, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({
    map: water, color: "#bfe6ff", roughness: 0.12, metalness: 0.1, transparent: true, opacity: 0.95,
  }));
  lake.position.set(c.x, 0.07, c.z);
  lake.receiveShadow = true;
  scene.add(lake);
  for (let i = 0; i < 9; i++) {
    const a = i * 2.3, r = 8 + (i % 4) * 4.5;
    const pad = new THREE.Mesh(new THREE.CircleGeometry(1.4, 16, 0.3, Math.PI * 1.8).rotateX(-Math.PI / 2), M.plastic("#3fbf4a", 0.6));
    pad.position.set(c.x + Math.cos(a) * r, 0.11, c.z + Math.sin(a) * r);
    scene.add(keep(pad));
  }
}

export function buildStart(scene: THREE.Scene, track: Track, banner = "DLICOM GRAND PRIX") {
  const f = newFrame();
  track.frame(track.startU, f);
  const yaw = Math.atan2(f.tan.x, f.tan.z);

  const line = new THREE.Mesh(
    new THREE.PlaneGeometry(ROAD_HALF * 2 + CURB_W * 2, 2.4).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ map: T.checkerTex(16, 2), roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 }),
  );
  line.position.copy(f.pos).addScaledVector(f.up, 0.02);
  line.rotation.y = yaw;
  line.receiveShadow = true;
  scene.add(line);

  // Grid boxes behind the line.
  const boxMat = new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.85, polygonOffset: true, polygonOffsetFactor: -2 });
  for (let k = 0; k < 8; k++) {
    const g = gridSlot(k);
    track.frame(track.startU + g.du, f);
    const bar = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.3).rotateX(-Math.PI / 2), boxMat);
    bar.position.copy(f.pos).addScaledVector(f.side, g.lat).addScaledVector(f.tan, 1.7).addScaledVector(f.up, 0.02);
    bar.rotation.y = Math.atan2(f.tan.x, f.tan.z);
    scene.add(keep(bar));
    for (const s of [-1, 1]) {
      const side = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 1.4).rotateX(-Math.PI / 2), boxMat);
      side.position.copy(f.pos).addScaledVector(f.side, g.lat + 1.2 * s).addScaledVector(f.tan, 1.1).addScaledVector(f.up, 0.02);
      side.rotation.y = Math.atan2(f.tan.x, f.tan.z);
      scene.add(keep(side));
    }
  }

  // The gate: two yellow towers, a banner and a hanging light board.
  track.frame(track.startU, f);
  const gate = new THREE.Group();
  gate.position.copy(f.pos);
  gate.rotation.y = yaw;
  scene.add(keep(gate));
  // The lamps change colour, so they live outside the merged gate.
  const lampGroup = new THREE.Group();
  lampGroup.position.copy(f.pos);
  lampGroup.rotation.y = yaw;
  scene.add(lampGroup);
  const yellow = M.plastic("#ffc21f", 0.35);
  const panel = M.glow("#fff7d6", 0.9);
  const px = WALL + 1.6;
  for (const s of [-1, 1]) {
    const t = M.add(gate, M.rbox(3.2, 12, 3.2, 0.5), yellow, px * s, 6, 0);
    t.receiveShadow = true;
    for (let r = 0; r < 4; r++) {
      M.add(gate, M.rbox(2.2, 1.6, 0.2, 0.25), panel, px * s, 3 + r * 2.1, 1.62, false);
      M.add(gate, M.rbox(2.2, 1.6, 0.2, 0.25), panel, px * s, 3 + r * 2.1, -1.62, false);
    }
    M.add(gate, M.sphere(0.9, 18, 12), M.plastic("#2f6bff", 0.25), px * s, 12.8, 0);
  }
  const span = px * 2 + 3.2;
  M.add(gate, M.rbox(span, 2.6, 1.4, 0.5), M.plastic("#2f6bff", 0.3), 0, 11.1, 0);
  const bannerMat = new THREE.MeshStandardMaterial({
    map: T.bannerTex(banner, "#2f6bff", "#ffffff", 1024, 160),
    roughness: 0.4, emissive: "#ffffff", emissiveIntensity: 0.15,
  });
  for (const z of [0.72, -0.72]) {
    const b = new THREE.Mesh(new THREE.PlaneGeometry(span - 3.6, 2.2), bannerMat);
    b.position.set(0, 11.1, z);
    if (z < 0) b.rotation.y = Math.PI;
    gate.add(b);
  }
  // Round emblem on top.
  const em = new THREE.Mesh(new THREE.CircleGeometry(1.9, 32), new THREE.MeshStandardMaterial({
    map: T.emblemTex("#2f6bff", "#ffffff", "#ffc21f"), roughness: 0.35,
  }));
  em.position.set(0, 14.1, 0.1);
  gate.add(em);
  const em2 = em.clone();
  em2.rotation.y = Math.PI;
  em2.position.z = -0.1;
  gate.add(em2);
  M.add(gate, M.cyl(2.05, 2.05, 0.18, 32), M.plastic("#ffc21f", 0.3), 0, 14.1, 0).rotation.x = Math.PI / 2;

  // Light board: hangs under the beam on the approach side.
  const board = M.add(gate, M.rbox(6.4, 1.9, 0.6, 0.3), M.plastic("#1d2233", 0.5), 0, 8.6, -0.5);
  board.castShadow = true;
  M.add(gate, M.cyl(0.06, 0.06, 1.2, 6), M.plastic("#1d2233", 0.5), -2, 9.9, -0.5);
  M.add(gate, M.cyl(0.06, 0.06, 1.2, 6), M.plastic("#1d2233", 0.5), 2, 9.9, -0.5);
  const lamps: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const lamp = new THREE.Mesh(M.sphere(0.62, 20, 14), new THREE.MeshStandardMaterial({
      color: "#2a0d12", emissive: "#ff2a3a", emissiveIntensity: 0, roughness: 0.3,
    }));
    lamp.position.set(-2 + i * 2, 8.6, -0.85);
    lamp.scale.z = 0.5;
    lampGroup.add(lamp);
    lamps.push(lamp);
  }
  return lamps;
}

/** Grid slot k (0 = pole). Two staggered columns behind the line. */
export function gridSlot(k: number) {
  return { du: -5 - k * 4.2, lat: k % 2 === 0 ? -3.3 : 3.3 };
}

function buildStadium(scene: THREE.Scene, track: Track, diliImg: HTMLImageElement | null) {
  const { cx, cz, rx, rz } = bowl(track);

  // Profile going outward and up: front wall, crowd slope, back wall, roof.
  const prof: [number, number, string][] = [
    [0, -0.1, "front"], [0, 3.2, "front"], [2.5, 3.2, "cap"], [34, 24, "crowd"],
    [34, 29, "back"], [37, 29, "cap"],
  ];
  const SEG = 160;
  const mats: Record<string, THREE.Material> = {
    front: new THREE.MeshStandardMaterial({ map: (() => { const t = T.wallTex(); t.repeat.set(60, 1); return t; })(), roughness: 0.5 }),
    cap: M.plastic("#f4f7ff", 0.5),
    crowd: crowdMaterial(),
    back: M.plastic("#2f6bff", 0.4),
  };
  const ringPoint = (a: number, d: number, h: number) => {
    const ex = Math.cos(a) * rx, ez = Math.sin(a) * rz;
    const nx = Math.cos(a) / rx, nz = Math.sin(a) / rz;
    const nl = Math.hypot(nx, nz);
    return new THREE.Vector3(cx + ex + (nx / nl) * d, h, cz + ez + (nz / nl) * d);
  };
  for (let p = 0; p < prof.length - 1; p++) {
    const [d0, h0] = prof[p];
    const [d1, h1, kind] = prof[p + 1];
    const pos: number[] = [], uv: number[] = [], index: number[] = [];
    for (let i = 0; i <= SEG; i++) {
      const a = (i / SEG) * Math.PI * 2;
      const A = ringPoint(a, d0, h0), B = ringPoint(a, d1, h1);
      pos.push(A.x, A.y, A.z, B.x, B.y, B.z);
      uv.push(i / SEG, 0, i / SEG, 1);
      if (i < SEG) {
        const k = i * 2;
        index.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(index);
    g.computeVertexNormals();
    mats[kind].side = THREE.DoubleSide;
    const m = new THREE.Mesh(g, mats[kind]);
    m.receiveShadow = true;
    scene.add(m);
  }

  // LED ring along the top of the stand fronts.
  const led: number[] = [], ledIdx: number[] = [];
  for (let i = 0; i <= SEG; i++) {
    const a = (i / SEG) * Math.PI * 2;
    const A = ringPoint(a, -0.06, 2.75), B = ringPoint(a, -0.06, 3.1);
    led.push(A.x, A.y, A.z, B.x, B.y, B.z);
    if (i < SEG) {
      const k = i * 2;
      ledIdx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const lg = new THREE.BufferGeometry();
  lg.setAttribute("position", new THREE.Float32BufferAttribute(led, 3));
  lg.setIndex(ledIdx);
  scene.add(new THREE.Mesh(lg, new THREE.MeshBasicMaterial({
    color: new THREE.Color("#ffc84a").multiplyScalar(2.4), toneMapped: false, side: THREE.DoubleSide,
  })));

  // Roof canopy ring over the top tiers, with a line of floodlights.
  const roof: number[] = [], roofIdx: number[] = [];
  for (let i = 0; i <= SEG; i++) {
    const a = (i / SEG) * Math.PI * 2;
    const A = ringPoint(a, 14, 33), B = ringPoint(a, 40, 31);
    roof.push(A.x, A.y, A.z, B.x, B.y, B.z);
    if (i < SEG) {
      const k = i * 2;
      roofIdx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const rg = new THREE.BufferGeometry();
  rg.setAttribute("position", new THREE.Float32BufferAttribute(roof, 3));
  rg.setIndex(roofIdx);
  rg.computeVertexNormals();
  scene.add(new THREE.Mesh(rg, new THREE.MeshStandardMaterial({ color: "#3b4262", roughness: 0.45, metalness: 0.4, side: THREE.DoubleSide })));
  // Gold LED edge along the inner lip of the roof.
  const edge: number[] = [], edgeIdx: number[] = [];
  for (let i = 0; i <= SEG; i++) {
    const a = (i / SEG) * Math.PI * 2;
    const A = ringPoint(a, 13.8, 32.4), B = ringPoint(a, 13.8, 33.2);
    edge.push(A.x, A.y, A.z, B.x, B.y, B.z);
    if (i < SEG) {
      const k = i * 2;
      edgeIdx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const eg = new THREE.BufferGeometry();
  eg.setAttribute("position", new THREE.Float32BufferAttribute(edge, 3));
  eg.setIndex(edgeIdx);
  scene.add(new THREE.Mesh(eg, new THREE.MeshBasicMaterial({
    color: new THREE.Color("#ffc84a").multiplyScalar(2.2), toneMapped: false, side: THREE.DoubleSide,
  })));
  const lightMat = M.glow("#fffbe8", 2.2);
  const trussMat = M.plastic("#ffc21f", 0.4);
  for (let i = 0; i < 44; i++) {
    const a = (i / 44) * Math.PI * 2;
    const p = ringPoint(a, 15, 32.2);
    const l = new THREE.Mesh(M.rbox(3.4, 0.6, 1.4, 0.2), lightMat);
    l.position.copy(p);
    l.lookAt(cx, 0, cz);
    scene.add(keep(l));
    if (i % 2 === 0) {
      const col = new THREE.Mesh(M.cyl(0.6, 0.6, 31, 8), trussMat);
      const q = ringPoint(a, 38.5, 15.5);
      col.position.copy(q);
      scene.add(keep(col));
    }
  }

  // Jumbotrons on the front of the stands, angled at the track.
  const screens = [
    { a: Math.PI * 1.02, cap: "DLICOM\nTV" },
    { a: Math.PI * 1.5, cap: "DELIVER\nANYTHING" },
    { a: Math.PI * 0.08, cap: "GO DILI\nGO!" },
    { a: Math.PI * 0.5, cap: "DLICOM\nTV" },
  ];
  screens.forEach((s, i) => {
    const p = ringPoint(s.a, 6, 17);
    const grp = new THREE.Group();
    grp.position.copy(p);
    grp.lookAt(cx, 17, cz);
    scene.add(keep(grp));
    const w = 24, h = 13.5;
    M.add(grp, M.rbox(w + 1.4, h + 1.4, 1.2, 0.5), M.plastic("#1d2233", 0.4), 0, 0, -0.7);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({
      map: T.screenTex(diliImg, s.cap, i % 2 ? "#2f6bff" : "#7b3fff"), toneMapped: false,
    }));
    grp.add(scr);
    M.add(grp, M.cyl(0.8, 0.8, 12, 10), M.plastic("#e8edf8", 0.5), -w * 0.3, -h / 2 - 5, -1);
    M.add(grp, M.cyl(0.8, 0.8, 12, 10), M.plastic("#e8edf8", 0.5), w * 0.3, -h / 2 - 5, -1);
  });
}

function dressInfield(scene: THREE.Scene, track: Track, quality: Quality) {
  const f = newFrame();
  const balloonsList: THREE.Object3D[] = [];
  const spinners: THREE.Object3D[] = [];
  const flags: THREE.Object3D[] = [];
  const statics = STATIC;

  const L = track.length;
  const nearTrack = (x: number, z: number, clear: number) => {
    for (const [px, pz] of track.outline(6)) {
      if ((px - x) ** 2 + (pz - z) ** 2 < clear * clear) return true;
    }
    return false;
  };

  // Trees, bushes and grass. Everything is instanced (see nature.ts).
  const bowlE = bowl(track);
  track.frame((track.lipU + track.landU) / 2, f);
  const lake = { x: f.pos.x, z: f.pos.z };
  const plants: Plant[] = [];
  const tufts: { x: number; y: number; z: number; s: number }[] = [];
  const rnd = (i: number, k: number) => {
    const v = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
    return v - Math.floor(v);
  };
  const clear = (x: number, z: number, margin: number) =>
    !nearTrack(x, z, WALL + margin)
    && Math.hypot(x - lake.x, z - lake.z) > 34
    && Math.hypot(x - 58, z + 60) > 15
    && insideBowl(bowlE, x, z, 10);
  const pick = (k: number): Plant["species"] => (k < 0.42 ? "oak" : k < 0.62 ? "pine" : k < 0.78 ? "blossom" : "bush");
  const density = quality === "low" ? 0.5 : 1;

  // Along the track, just outside the walls.
  let n = 0;
  for (let u = 0; u < L; u += 8 / density) {
    const w = track.wrap(u);
    if (Math.abs(track.delta(w, track.startU)) < 26) continue;
    for (const s of [-1, 1]) {
      n++;
      track.frame(w + rnd(n, 1) * 6, f);
      const flat = new THREE.Vector3(f.side.x, 0, f.side.z).normalize();
      const off = (WALL + 5 + rnd(n, 2) * 10 + Math.max(0, f.pos.y) * 2.4) * s;
      const x = f.pos.x + flat.x * off, z = f.pos.z + flat.z * off;
      if (!clear(x, z, 3)) continue;
      const sp = pick(rnd(n, 3));
      plants.push({ species: sp, x, z, scale: (sp === "bush" ? 0.9 : 0.8) + rnd(n, 4) * 0.45, rot: rnd(n, 5) * 6.28 });
      for (let k = 0; k < 4; k++) tufts.push({ x: x + (rnd(n, 10 + k) - 0.5) * 6, y: 0, z: z + (rnd(n, 20 + k) - 0.5) * 6, s: 0.8 + rnd(n, 30 + k) * 0.7 });
    }
  }
  // Trees by the track keep full detail and shadows; the groves further out
  // are lighter and don't cast (they're rarely inside the shadow box anyway).
  const nearCount = plants.length;
  // Groves across the open ground: clusters read as natural, even spacing doesn't.
  for (let gI = 0; gI < 70 * density; gI++) {
    const cx = bowlE.cx + (rnd(gI, 40) - 0.5) * bowlE.rx * 1.8;
    const cz = bowlE.cz + (rnd(gI, 41) - 0.5) * bowlE.rz * 1.8;
    if (!clear(cx, cz, 8)) continue;
    const count = 3 + Math.floor(rnd(gI, 42) * 6);
    const main = pick(rnd(gI, 43));
    for (let k = 0; k < count; k++) {
      const a = rnd(gI, 50 + k) * Math.PI * 2, r = 2 + rnd(gI, 60 + k) * 9;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      if (!clear(x, z, 7)) continue;
      const sp = rnd(gI, 70 + k) < 0.7 ? main : pick(rnd(gI, 80 + k));
      plants.push({ species: sp, x, z, scale: 0.75 + rnd(gI, 90 + k) * 0.6, rot: rnd(gI, 95 + k) * 6.28 });
      for (let t = 0; t < 3; t++) tufts.push({ x: x + (rnd(gI * 7 + k, t) - 0.5) * 5, y: 0, z: z + (rnd(gI * 5 + k, t + 9) - 0.5) * 5, s: 0.7 + rnd(k, t) * 0.8 });
    }
  }
  plantAll(scene, plants.slice(0, nearCount), quality === "low" ? 2 : 3);
  plantAll(scene, plants.slice(nearCount), 2, false);
  if (quality !== "low") grassTufts(scene, tufts);

  // The giant Dlicom "D" in the infield, like the landmark letter in the reference.
  const d = dSculpture();
  d.position.set(58, 0, -60);
  d.rotation.y = -Math.PI / 2 + 0.35;
  scene.add(keep(d));
  // The orbiting ring spins, so it comes out of the merge.
  const ring = d.userData.ring as THREE.Object3D;
  d.updateMatrixWorld(true);
  const ringWorld = ring.matrixWorld.clone();
  d.remove(ring);
  ring.matrix.copy(ringWorld);
  ring.matrix.decompose(ring.position, ring.quaternion, ring.scale);
  scene.add(ring);
  spinners.push(ring);

  // Balloon clusters bobbing over the stands and infield.
  const spots: [number, number][] = [[-40, -40], [60, -150], [175, -40], [90, 60], [-30, 140], [200, 120], [30, -250]];
  spots.forEach(([x, z], i) => {
    const b = M.balloons(i);
    b.position.set(x, 8 + (i % 3) * 6, z);
    b.userData.base = b.position.y;
    scene.add(b);
    balloonsList.push(b);
  });

  // Bunting strung across the track at a few points.
  for (const u of [track.startU + 90, track.ctrlU[10] + 10, track.ctrlU[16], track.ctrlU[5]]) {
    track.frame(u, f);
    const a = f.pos.clone().addScaledVector(f.side, -(WALL + 0.4)).setY(f.pos.y + 7.5);
    const b = f.pos.clone().addScaledVector(f.side, WALL + 0.4).setY(f.pos.y + 7.5);
    for (const p of [a, b]) {
      const pole = new THREE.Mesh(M.cyl(0.18, 0.22, 8, 8), M.plastic("#f4f7ff", 0.4));
      pole.position.copy(p).setY(p.y - 4);
      scene.add(keep(pole));
      const cap = new THREE.Mesh(M.sphere(0.34, 12, 8), M.plastic("#ff4057", 0.3));
      cap.position.copy(p).setY(p.y + 0.1);
      scene.add(keep(cap));
    }
    const bt = M.bunting(a, b, 1.6);
    scene.add(bt);
    statics.push(bt);
  }

  // Inflatable arches over the road.
  for (const u of [track.ctrlU[2] + 5, track.ctrlU[12], track.ctrlU[18] - 6]) {
    const arch = inflatableArch();
    track.frame(u, f);
    arch.position.copy(f.pos);
    arch.rotation.y = Math.atan2(f.tan.x, f.tan.z);
    scene.add(keep(arch));
  }

  // Billboards: four ad slots and three Dlicom promos, where drivers look.
  const c = track.ctrlU;
  billboards(scene, track, [
    { u: track.startU + 70, side: 1, kind: "ad", accent: "#3d63ff" },
    { u: c[3] - 6, side: -1, kind: "app", accent: "#3d63ff" },
    { u: c[6] + 22, side: -1, kind: "ad", accent: "#e447d2" },
    { u: c[7] - 30, side: 1, kind: "tge", accent: "#ffd84a" },
    { u: c[11] + 6, side: -1, kind: "ad", accent: "#2ec27e" },
    { u: c[15] + 4, side: 1, kind: "keys", accent: "#e447d2" },
    { u: c[19] - 18, side: 1, kind: "ad", accent: "#ff7a1a" },
  ], WALL, keep);

  // Dusk street lamps, skipping the jump and the start gate.
  streetLamps(scene, track, quality === "low" ? 48 : 32, WALL, ROAD_HALF, keep, (u) =>
    Math.abs(track.delta(u, track.startU)) < 14
    || (track.delta(track.lipU - 10, u) > 0 && track.delta(track.landU + 8, u) < 0));

  return { balloons: balloonsList, spinners, flags };
}

/**
 * Collapse many small static props into one mesh per material per map
 * chunk. Hundreds of trees become a dozen draw calls, and chunking keeps
 * frustum and shadow culling useful.
 */
export function mergeStatic(scene: THREE.Scene, objs: THREE.Object3D[], shadows: boolean) {
  const CHUNK = 110;
  const buckets = new Map<string, { mat: THREE.Material; geos: THREE.BufferGeometry[] }>();
  for (const o of objs) {
    o.updateMatrixWorld(true);
    o.traverse((c) => {
      const m = c as THREE.Mesh;
      if (!m.isMesh || Array.isArray(m.material)) return;
      const p = new THREE.Vector3().setFromMatrixPosition(m.matrixWorld);
      const key = `${m.material.uuid}:${Math.floor(p.x / CHUNK)}:${Math.floor(p.z / CHUNK)}`;
      let b = buckets.get(key);
      if (!b) { b = { mat: m.material, geos: [] }; buckets.set(key, b); }
      const g = m.geometry.clone();
      g.applyMatrix4(m.matrixWorld);
      for (const name of Object.keys(g.attributes)) {
        if (!["position", "normal", "uv"].includes(name)) g.deleteAttribute(name);
      }
      b.geos.push(g);
    });
    // Lines (bunting strings) survive as they are; meshes are replaced.
    const keep: THREE.Object3D[] = [];
    o.traverse((c) => { if ((c as THREE.Line).isLine) keep.push(c); });
    for (const k of keep) {
      k.updateMatrixWorld(true);
      const clone = k.clone();
      clone.applyMatrix4(k.matrixWorld);
      scene.add(clone);
    }
    scene.remove(o);
  }
  for (const b of buckets.values()) {
    const indexed = b.geos.filter((g) => g.index);
    const plain = b.geos.filter((g) => !g.index);
    for (const set of [indexed, plain]) {
      if (!set.length) continue;
      const merged = mergeGeometries(set, false);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, b.mat);
      mesh.castShadow = shadows;
      mesh.receiveShadow = true;
      scene.add(mesh);
    }
    for (const g of b.geos) g.dispose();
  }
}

/**
 * The stands: the painted crowd with a glow map for phones and glow-sticks,
 * and a vertex-free bounce — each column of fans hops on its own rhythm by
 * nudging the texture lookup, which costs nothing.
 */
export const crowdTime = { value: 0 };
function crowdMaterial() {
  const { map, glow } = T.crowdTex();
  map.repeat.set(30, 1.9);
  glow.repeat.copy(map.repeat);
  const m = new THREE.MeshStandardMaterial({
    map, emissive: "#ffffff", emissiveMap: glow, emissiveIntensity: 1.6, roughness: 0.9,
  });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uCrowdT = crowdTime;
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uCrowdT;")
      .replace("#include <map_fragment>", `
        vec2 cuv = vMapUv;
        float col = floor(cuv.x * 68.0);
        float hop = max(0.0, sin(uCrowdT * 7.0 + col * 1.7 + floor(cuv.y * 10.0) * 2.3));
        cuv.y += hop * hop * 0.012;
        vec4 sampledDiffuseColor = texture2D(map, cuv);
        diffuseColor *= sampledDiffuseColor;`)
      .replace("#include <emissivemap_fragment>", `
        vec4 emissiveColor = texture2D(emissiveMap, cuv);
        float twinkle = 0.55 + 0.45 * sin(uCrowdT * 3.0 + col * 0.9);
        totalEmissiveRadiance *= emissiveColor.rgb * twinkle;`);
  };
  return m;
}

export function inflatableArch() {
  const g = new THREE.Group();
  const R = WALL + 0.8;
  const segs = 10;
  const a = M.plastic("#ff4fb4", 0.3), b = M.plastic("#ffffff", 0.3);
  for (let i = 0; i < segs; i++) {
    const t = new THREE.Mesh(new THREE.TorusGeometry(R, 1.1, 14, 8, Math.PI / segs + 0.01), i % 2 ? a : b);
    t.rotation.z = (i / segs) * Math.PI;
    t.castShadow = true;
    g.add(t);
  }
  // The torus lies in XY. The caller turns the group so +Z runs along the
  // track, which makes XY the road's cross-section.
  const wrap = new THREE.Group();
  wrap.add(g);
  for (const s of [-1, 1]) {
    const foot = new THREE.Mesh(M.cyl(1.4, 1.6, 0.8, 16), M.plastic("#2f6bff", 0.4));
    foot.position.set(R * s, 0.4, 0);
    wrap.add(foot);
  }
  return wrap;
}

function dSculpture() {
  const g = new THREE.Group();
  const s = new THREE.Shape();
  // A chunky "D": flat back, round front, with a hole.
  s.moveTo(0, 0);
  s.lineTo(4, 0);
  s.absarc(4, 6, 6, -Math.PI / 2, Math.PI / 2, false);
  s.lineTo(0, 12);
  s.lineTo(0, 0);
  const hole = new THREE.Path();
  hole.moveTo(2.6, 2.6);
  hole.lineTo(4, 2.6);
  hole.absarc(4, 6, 3.4, -Math.PI / 2, Math.PI / 2, false);
  hole.lineTo(2.6, 9.4);
  hole.lineTo(2.6, 2.6);
  s.holes.push(hole);
  const geo = new THREE.ExtrudeGeometry(s, { depth: 2.4, bevelEnabled: true, bevelSize: 0.45, bevelThickness: 0.45, bevelSegments: 4, curveSegments: 28 });
  geo.center();
  const letter = new THREE.Mesh(geo, M.plastic("#2f6bff", 0.18, 0.1));
  letter.position.y = 11;
  letter.castShadow = true;
  g.add(letter);
  const ped = M.add(g, M.cyl(6.5, 7.5, 3, 32), M.plastic("#f4f7ff", 0.4), 0, 1.5, 0);
  ped.receiveShadow = true;
  M.add(g, M.cyl(7.6, 7.6, 0.6, 32), M.plastic("#ffc21f", 0.35), 0, 0.3, 0);
  // A gold ring orbiting the letter.
  const ring = new THREE.Group();
  ring.position.y = 11;
  const tor = new THREE.Mesh(new THREE.TorusGeometry(9.5, 0.35, 10, 60), M.plastic("#ffc21f", 0.2, 0.8));
  tor.rotation.x = Math.PI / 2.3;
  ring.add(tor);
  g.add(ring);
  g.userData.ring = ring;
  return g;
}
