import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import * as T from "./textures";
import * as M from "./models";
import { EDGE, ROAD_HALF, WALL, Track, newFrame } from "./track";
import { buildSky } from "./sky";
import { billboards, streetLamps } from "./trackside";
import { Skyline, monorail, skyTraffic } from "./skyline";
import {
  WALL_H, WALL_T, buildJump, buildStart, embankment, haloTex, keep, mergeStatic, strip, takeStatic, underside,
  type Quality, type World,
} from "./world";

/**
 * Neon Town: a street circuit through Dlicom City at night. Wet tarmac
 * that mirrors the neon, sidewalks and jersey barriers with light strips,
 * blocks of lit towers with shopfronts and blade signs, string lights and
 * neon gates over the road, and a jump over the canal.
 */

const rnd = (i: number, k: number) => {
  const v = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return v - Math.floor(v);
};
const hot = (hex: string, k: number) => new THREE.Color(hex).multiplyScalar(k);

const NEON = ["#ff3fa4", "#2ee6ff", "#ffd84a", "#8f6bff", "#39ff9e", "#ff6a3d"];
const SHOPS = ["RAMEN", "ARCADE", "DLI MART", "CAFE 24", "HODL", "GM GM", "PIXEL", "NOODLES", "KARAOKE", "BUBBLE TEA", "DLICOM", "GARAGE"];

export function buildTown(scene: THREE.Scene, renderer: THREE.WebGLRenderer, track: Track, diliImg: HTMLImageElement | null, quality: Quality = "high"): World {
  void diliImg;
  /* ---------- light: a neon-lit night ---------- */
  scene.environment = nightEnvironment(renderer);
  scene.environmentIntensity = 0.85;
  scene.add(new THREE.HemisphereLight("#4a5cc0", "#0b0a18", 0.55));
  const moon = new THREE.DirectionalLight("#a9bcff", 1.05);
  moon.castShadow = true;
  moon.shadow.mapSize.setScalar(quality === "low" ? 1024 : 4096);
  const sc = moon.shadow.camera;
  sc.left = -38; sc.right = 38; sc.top = 38; sc.bottom = -38; sc.near = 1; sc.far = 220;
  moon.shadow.bias = -0.0004;
  moon.shadow.normalBias = 0.03;
  scene.add(moon, moon.target);

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of track.outline(8)) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  const center = new THREE.Vector3((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
  const MOON_DIR = new THREE.Vector3(-0.5, 0.42, 0.62).normalize();
  const sky = buildSky(scene, MOON_DIR, center, "night");
  scene.fog = new THREE.Fog("#160f38", 170, 820);

  /* ---------- ground: city blocks ---------- */
  const paving = T.pavingTex();
  paving.repeat.set(700, 700);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(3000, 3000).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ map: paving, color: "#5b6078", roughness: 0.75, metalness: 0.05 }),
  );
  ground.position.set(center.x, -0.06, center.z);
  ground.receiveShadow = true;
  scene.add(ground);

  /* ---------- the street ---------- */
  const N = track.N;
  const lipI = Math.round(track.lipU / track.ds);
  const landI = Math.round(track.landU / track.ds);
  const runFrom = landI, runTo = lipI + N;

  // Wet asphalt: the painted lanes, darkened, with puddles that are glassy.
  const wet = T.wetTex();
  const road = new THREE.MeshStandardMaterial({
    map: T.asphaltTex(), color: "#7d849c", roughness: 1, roughnessMap: wet, metalness: 0.12, envMapIntensity: 0.7,
  });
  const m = strip(track, runFrom, runTo, 2, [-ROAD_HALF, 0], [ROAD_HALF, 0], 1 / 10, road, false);
  m.receiveShadow = true;
  scene.add(m);

  // Curbs: hot pink on the left, electric cyan on the right, faintly lit.
  for (const s of [-1, 1]) {
    const col = s < 0 ? "#ff3fa4" : "#2ee6ff";
    const tex = T.curbTex(col, "#f7f9ff");
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45, emissive: "#ffffff", emissiveMap: tex, emissiveIntensity: 0.25 });
    const inner: [number, number] = [ROAD_HALF * s, 0.01];
    const outer: [number, number] = [EDGE * s, 0.12];
    const c = strip(track, runFrom, runTo, 2, s < 0 ? outer : inner, s < 0 ? inner : outer, 1 / 3.2, mat, false);
    c.receiveShadow = true;
    scene.add(c);
  }

  // Sidewalks between the curbs and the barriers.
  const walkTex = T.pavingTex();
  walkTex.repeat.set(1, 1);
  const walk = new THREE.MeshStandardMaterial({ map: walkTex, color: "#9aa0b8", roughness: 1, roughnessMap: wet, envMapIntensity: 0.7 });
  for (const s of [-1, 1]) {
    const inner: [number, number] = [(EDGE - 0.05) * s, 0.12];
    const outer: [number, number] = [WALL * s, 0.12];
    const w = strip(track, runFrom, runTo, 2, s < 0 ? outer : inner, s < 0 ? inner : outer, 1 / 4, walk, false);
    w.receiveShadow = true;
    scene.add(w);
  }

  // Jersey barriers with a neon strip along the top, pink left, cyan right.
  const barrierTex = T.barrierTex();
  const barrier = new THREE.MeshStandardMaterial({ map: barrierTex, roughness: 0.7 });
  const cap = M.plastic("#d9dce8", 0.5);
  const haloT = haloTex();
  for (const s of [-1, 1]) {
    const col = s < 0 ? new THREE.Color(1.8, 0.25, 0.9) : new THREE.Color(0.2, 1.5, 1.9);
    const neonMat = new THREE.MeshBasicMaterial({ color: col, toneMapped: false });
    const haloMat = new THREE.MeshBasicMaterial({
      map: haloT, color: col.clone().multiplyScalar(0.7), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    const w = WALL * s, wo = (WALL + WALL_T) * s;
    const face = s > 0
      ? strip(track, runFrom, runTo, 2, [w, -0.3], [w, WALL_H], 1 / 8, barrier, true, -1)
      : strip(track, runFrom, runTo, 2, [w, WALL_H], [w, -0.3], 1 / 8, barrier, true, 1);
    face.castShadow = true;
    face.receiveShadow = true;
    scene.add(face);
    const wn = (WALL + 0.2) * s;
    const neon = s > 0
      ? strip(track, runFrom, runTo, 2, [w - 0.01, WALL_H + 0.012], [wn, WALL_H + 0.012], 1, neonMat, false)
      : strip(track, runFrom, runTo, 2, [wn, WALL_H + 0.012], [w + 0.01, WALL_H + 0.012], 1, neonMat, false);
    const halo = s > 0
      ? strip(track, runFrom, runTo, 2, [w - 0.05, WALL_H - 0.6], [w - 0.05, WALL_H + 0.35], 1, haloMat, true, -1)
      : strip(track, runFrom, runTo, 2, [w + 0.05, WALL_H + 0.35], [w + 0.05, WALL_H - 0.6], 1, haloMat, true, 1);
    halo.renderOrder = 2;
    scene.add(neon, halo);
    scene.add(strip(track, runFrom, runTo, 2, s < 0 ? [wo, WALL_H] : [w, WALL_H], s < 0 ? [w, WALL_H] : [wo, WALL_H], 1 / 4, cap, false));
    const back = s > 0
      ? strip(track, runFrom, runTo, 2, [wo, WALL_H], [wo, -3], 1 / 8, barrier, true, 1)
      : strip(track, runFrom, runTo, 2, [wo, -3], [wo, WALL_H], 1 / 8, barrier, true, -1);
    scene.add(back);
  }

  // The ramp up to the bridge: concrete slopes and a closed underside.
  const concrete = new THREE.MeshStandardMaterial({ map: T.stoneTex(), color: "#8c90a4", roughness: 0.9 });
  for (const s of [-1, 1]) {
    const e = embankment(track, runFrom, runTo, s, concrete);
    e.receiveShadow = true;
    scene.add(e);
  }
  scene.add(underside(track, runFrom, runTo, M.plastic("#3a3f55", 0.8)));

  /* ---------- the canal jump ---------- */
  const water = T.waterTex();
  water.repeat.set(10, 2);
  buildJump(scene, track, water, false);
  const f = newFrame();
  track.frame((track.lipU + track.landU) / 2, f);
  const canal = new THREE.Vector3(f.pos.x, 0, f.pos.z);
  // The canal runs east–west under the gap, out to the edge of town.
  const canalW = 30, canalLen = 480;
  const cx0 = canal.x - 36, cx1 = canal.x - 36 + canalLen;
  const waterMesh = new THREE.Mesh(new THREE.PlaneGeometry(canalLen, canalW).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({
    map: water, color: "#243768", roughness: 0.1, metalness: 0.4, envMapIntensity: 1.8,
    emissive: "#10286a", emissiveMap: water, emissiveIntensity: 0.4,
  }));
  waterMesh.position.set((cx0 + cx1) / 2, 0.03, canal.z);
  waterMesh.receiveShadow = true;
  scene.add(waterMesh);
  // The city's lights, smeared across the water in long wobbling streaks.
  const streakTex = T.blobTex("rgba(255,255,255,.9)", "rgba(255,255,255,0)");
  for (let k = 0; k < 26; k++) {
    const col = k % 3 === 0 ? "#ffc873" : NEON[k % NEON.length];
    const len = 8 + rnd(k, 40) * 14;
    const streak = new THREE.Mesh(new THREE.PlaneGeometry(1.4 + rnd(k, 41) * 2.2, len).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({
      map: streakTex, color: hot(col, 1.8), transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    }));
    const x = cx0 + 10 + rnd(k, 42) * (canalLen - 20);
    if (Math.abs(x - canal.x) < WALL + 2) continue;
    streak.position.set(x, 0.06, canal.z + (rnd(k, 43) - 0.5) * (canalW - 6));
    streak.renderOrder = 2;
    scene.add(streak);
  }
  // Canal walls, a quay edge with bollards and railings, and lamp posts.
  const quay = M.plastic("#4a4f66", 0.85);
  const rail = new THREE.MeshStandardMaterial({ color: "#c9cfdf", roughness: 0.35, metalness: 0.8 });
  for (const s of [-1, 1]) {
    const z = canal.z + (canalW / 2) * s;
    const wallM = new THREE.Mesh(new THREE.BoxGeometry(canalLen, 1.4, 1.2), quay);
    wallM.position.set((cx0 + cx1) / 2, -0.62, z + 0.6 * s);
    scene.add(keep(wallM));
    const edge = new THREE.Mesh(new THREE.BoxGeometry(canalLen, 0.2, 1.6), M.plastic("#c9ccd8", 0.7));
    edge.position.set((cx0 + cx1) / 2, 0.08, z + 0.8 * s);
    scene.add(keep(edge));
    for (let x = cx0 + 4; x < cx1; x += 3) {
      if (Math.abs(x - canal.x) < WALL + 6) continue;
      const post = new THREE.Mesh(M.cyl(0.05, 0.05, 1.1, 6), rail);
      post.position.set(x, 0.65, z + 1.4 * s);
      scene.add(keep(post));
    }
    const bar = new THREE.Mesh(M.cyl(0.05, 0.05, canalLen, 6), rail);
    bar.rotation.z = Math.PI / 2;
    bar.position.set((cx0 + cx1) / 2, 1.18, z + 1.4 * s);
    scene.add(keep(bar));
  }
  // Houseboats and a water taxi moored along the quay, windows lit.
  for (let k = 0; k < 6; k++) {
    const x = canal.x + 40 + k * 55 + rnd(k, 1) * 20;
    if (x > cx1 - 20) break;
    const boat = houseboat(k);
    boat.position.set(x, -0.35, canal.z + (k % 2 ? 1 : -1) * (canalW / 2 - 4));
    boat.rotation.y = Math.PI / 2 + (rnd(k, 2) - 0.5) * 0.1;
    scene.add(keep(boat));
  }

  /* ---------- start line and gate ---------- */
  const gateLamps = buildStart(scene, track, "NEON TOWN");

  /* ---------- the city ---------- */
  const centre: { u: number; x: number; z: number }[] = [];
  for (let u = 0; u < track.length; u += 3) {
    const p = track.point(u, 0, 0);
    centre.push({ u, x: p.x, z: p.z });
  }
  const clearOfRoad = (x: number, z: number, margin: number) => {
    for (const c of centre) if ((c.x - x) ** 2 + (c.z - z) ** 2 < margin * margin) return false;
    return !(Math.abs(z - canal.z) < canalW / 2 + 3 && x > cx0 - 4 && x < cx1 + 4);
  };
  const blocks = new CityBlocks(quality !== "low");
  const skyline = new Skyline(scene);
  // The monorail crosses town east-west on this line; nothing is built on it.
  const RAIL_Z = 18, RAIL_Y = 27;
  const onRail = (z: number, half: number) => Math.abs(z - RAIL_Z) < half + 6;
  // Frontage: a row of buildings facing the street on each side.
  let n = 0;
  for (const s of [-1, 1]) {
    let u = 4;
    while (u < track.length) {
      n++;
      const w = 12 + rnd(n, 1) * 14;
      const uc = track.wrap(u + w / 2);
      u += w + 1.5 + rnd(n, 9) * 3;
      if (Math.abs(track.delta(uc, track.startU)) < 12) continue;
      if (track.delta(track.lipU - 26, uc) > 0 && track.delta(track.landU + 12, uc) < 0) continue;
      track.frame(uc, f);
      const flat = new THREE.Vector3(f.side.x, 0, f.side.z).normalize();
      const d = 12 + rnd(n, 2) * 10;
      const off = WALL + WALL_T + 5 + d / 2 + Math.max(0, f.pos.y) * 2.4;
      const x = f.pos.x + flat.x * off * s, z = f.pos.z + flat.z * off * s;
      const yaw = Math.atan2(flat.x * s, flat.z * s);   // local +Z faces away from the road
      if (!footprintClear(x, z, w, d, yaw, clearOfRoad, WALL + WALL_T + 3.5)) continue;
      if (onRail(z, Math.max(w, d) / 2)) continue;
      const h = 12 + rnd(n, 3) ** 1.6 * 44 + (rnd(n, 4) < 0.12 ? 30 : 0);
      blocks.add(x, z, w, d, h, yaw, n, true);
    }
  }
  // Fill: towers across the blocks inside and around the loop.
  // Phones get a smaller, sparser city beyond the street frontage.
  const reach = quality === "low" ? 90 : 160, pitch = quality === "low" ? 34 : 26;
  for (let gx = minX - reach; gx < maxX + reach; gx += pitch) {
    for (let gz = minZ - reach; gz < maxZ + reach; gz += pitch) {
      n++;
      const x = gx + (rnd(n, 5) - 0.5) * 8, z = gz + (rnd(n, 6) - 0.5) * 8;
      const w = 14 + rnd(n, 7) * 10, d = 14 + rnd(n, 8) * 10;
      if (!footprintClear(x, z, w, d, 0, clearOfRoad, WALL + WALL_T + 30)) continue;
      if (onRail(z, Math.max(w, d) / 2)) continue;
      const far = Math.hypot(x - center.x, z - center.z);
      // Every so often, a signature skyscraper instead of a plain block.
      if (quality !== "low" && rnd(n, 12) < 0.34 && footprintClear(x, z, 26, 26, 0, clearOfRoad, WALL + WALL_T + 34) && !onRail(z, 14)) {
        const size = 18 + rnd(n, 13) * 8;
        const ht = 110 + rnd(n, 14) ** 0.8 * 120 + Math.min(40, far * 0.1);
        const face = Math.atan2(center.x - x, center.z - z);
        skyline.tower(x, z, size, ht, n, face);
        continue;
      }
      const h = 18 + rnd(n, 10) ** 1.4 * 60 + Math.min(40, far * 0.08);
      blocks.add(x, z, w, d, h, (rnd(n, 11) < 0.5 ? 0 : Math.PI / 2), n, false);
    }
  }
  blocks.build(scene);
  skyline.build();
  const train = monorail(scene, minX - 220, maxX + 220, RAIL_Z, RAIL_Y, (x, z) => clearOfRoad(x, z, WALL + WALL_T + 4));
  const traffic = skyTraffic(scene, center, quality === "low" ? 10 : 26);

  // Zebra crossings on the approach to each corner.
  const zebraTex = T.stripeTex("#e9ecf5", "rgba(0,0,0,0)", 8);
  zebraTex.center.set(0.5, 0.5);
  zebraTex.rotation = Math.PI / 2;   // bars run with the traffic, alternating across the road
  const zebraMat = new THREE.MeshStandardMaterial({ map: zebraTex, transparent: true, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 });
  for (const i of [3, 7, 12, 16]) {
    track.frame(track.ctrlU[i] - 16, f);
    const zebra = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_HALF * 2 - 1, 3.2).rotateX(-Math.PI / 2), zebraMat);
    zebra.position.copy(f.pos).addScaledVector(f.up, 0.025);
    zebra.rotation.y = Math.atan2(f.tan.x, f.tan.z);
    zebra.receiveShadow = true;
    scene.add(zebra);
  }

  // Landmark: the Dlicom tower at the top of the boulevard, crowned with a
  // giant sign you drive straight at off the start line.
  {
    track.frame(track.ctrlU[2], f);
    const ahead = new THREE.Vector3(f.tan.x, 0, f.tan.z).normalize();
    let spot = f.pos.clone().addScaledVector(ahead, 80);
    for (let k = 0; k < 12 && !clearOfRoad(spot.x, spot.z, WALL + 22); k++) spot = spot.addScaledVector(ahead, 10);
    const tower = new THREE.Group();
    tower.position.set(spot.x, 0, spot.z);
    tower.rotation.y = Math.atan2(-ahead.x, -ahead.z);
    const { map, glow } = T.facadeTex(0);
    const body = new THREE.Mesh(new THREE.BoxGeometry(26, 96, 22), new THREE.MeshStandardMaterial({
      map, emissive: "#ffffff", emissiveMap: glow, emissiveIntensity: 1.1, roughness: 0.4, metalness: 0.5,
    }));
    const uv = body.geometry.attributes.uv as THREE.BufferAttribute;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * 2, uv.getY(k) * 6);
    body.position.y = 48;
    tower.add(body);
    // Crown: stepped top, blue light bands, and the sign.
    M.add(tower, new THREE.BoxGeometry(22, 8, 18), M.plastic("#1b1e2c", 0.4, 0.6), 0, 100, 0);
    const band = new THREE.MeshBasicMaterial({ color: hot("#3d63ff", 2.4), toneMapped: false });
    for (const y of [96.2, 104.2]) M.add(tower, new THREE.BoxGeometry(26.4, 0.4, 22.4), band, 0, y, 0, false);
    const signTex = T.bladeSignTex("DLICOM", "#5f86ff", true);
    for (const sd of [1, -1]) {
      const face = new THREE.Mesh(new THREE.PlaneGeometry(40, 7.5), new THREE.MeshBasicMaterial({ map: signTex, color: new THREE.Color(1.8, 1.8, 1.8), toneMapped: false }));
      face.position.set(0, 114, 0.3 * sd);
      if (sd < 0) face.rotation.y = Math.PI;
      tower.add(face);
    }
    M.add(tower, new THREE.BoxGeometry(41, 8.3, 0.5), M.plastic("#0b0c14", 0.4), 0, 114, 0);
    for (const x of [-14, 14]) M.add(tower, M.cyl(0.4, 0.4, 6, 8), M.plastic("#2a2f45", 0.4, 0.6), x, 107, 0);
    const beacon = new THREE.Mesh(M.sphere(0.8, 12, 8), new THREE.MeshBasicMaterial({ color: hot("#ff2d55", 3), toneMapped: false }));
    beacon.position.set(0, 126, 0);
    M.add(tower, M.cyl(0.25, 0.4, 8, 8), M.plastic("#2a2f45", 0.4, 0.6), 0, 122, 0);
    tower.add(beacon);
    scene.add(keep(tower));
  }

  // Traffic lights on the corners, stuck on amber-flash for race night.
  for (const i of [3, 7, 12, 16]) {
    track.frame(track.ctrlU[i], f);
    const flat = new THREE.Vector3(f.side.x, 0, f.side.z).normalize();
    const s = f.curv > 0 ? -1 : 1;   // the outside of the bend
    const base = f.pos.clone().addScaledVector(flat, (WALL + WALL_T + 1.6) * s);
    const tl = new THREE.Group();
    tl.position.set(base.x, Math.max(0, f.pos.y - 0.2), base.z);
    tl.rotation.y = Math.atan2(-f.tan.x, -f.tan.z);
    M.add(tl, M.cyl(0.14, 0.18, 6.2, 8), M.plastic("#2a2f45", 0.4, 0.6), 0, 3.1, 0);
    M.add(tl, M.rbox(0.8, 2.2, 0.6, 0.12), M.plastic("#15161f", 0.5), 0, 5.6, 0);
    [["#ff2d3a", 0.2], ["#ffb31c", 2.6], ["#1bff6a", 0.2]].forEach(([c, k], j) => {
      const lamp = new THREE.Mesh(M.sphere(0.2, 12, 8), new THREE.MeshBasicMaterial({ color: hot(c as string, k as number), toneMapped: false }));
      lamp.position.set(0, 6.25 - j * 0.65, 0.32);
      tl.add(lamp);
    });
    scene.add(keep(tl));
  }

  /* ---------- over the street ---------- */
  const spinners: THREE.Object3D[] = [];
  // Neon gates: rounded frames of light spanning the road.
  const gateAt = [track.ctrlU[2] - 8, track.ctrlU[5], track.ctrlU[12] + 6, track.ctrlU[15]];
  gateAt.forEach((u, i) => {
    track.frame(u, f);
    const g = neonGate(NEON[i % NEON.length], NEON[(i + 3) % NEON.length]);
    g.position.copy(f.pos);
    g.rotation.y = Math.atan2(f.tan.x, f.tan.z);
    scene.add(keep(g));
  });
  // String lights, sagging between the buildings.
  for (let k = 0; k < 9; k++) {
    const u = track.wrap(track.startU + 50 + k * (track.length / 9.3));
    if (track.delta(track.lipU - 30, u) > 0 && track.delta(track.landU + 20, u) < 0) continue;
    track.frame(u, f);
    const a = f.pos.clone().addScaledVector(f.side, -(WALL + 1)).setY(f.pos.y + 8.5);
    const b = f.pos.clone().addScaledVector(f.side, WALL + 1).setY(f.pos.y + 8.5);
    const lights = stringLights(a, b, 2.4, k);
    scene.add(keep(lights));
  }

  /* ---------- street furniture ---------- */
  billboards(scene, track, [
    { u: track.startU + 70, side: 1, kind: "ad", accent: "#ff3fa4" },
    { u: track.ctrlU[4], side: -1, kind: "app", accent: "#2ee6ff" },
    { u: track.ctrlU[7] - 6, side: 1, kind: "tge", accent: "#ffd84a" },
    { u: track.ctrlU[13], side: -1, kind: "keys", accent: "#8f6bff" },
    { u: track.ctrlU[16], side: 1, kind: "ad", accent: "#39ff9e" },
  ], WALL + 2, keep);
  streetLamps(scene, track, quality === "low" ? 34 : 22, WALL, ROAD_HALF, keep, (u) =>
    Math.abs(track.delta(u, track.startU)) < 14
    || (track.delta(track.lipU - 10, u) > 0 && track.delta(track.landU + 8, u) < 0), 0.16, quality !== "low");
  // Vending machines, planters and hydrants on the sidewalk behind the barrier.
  for (let k = 0; k < 40; k++) {
    const u = track.wrap(k * (track.length / 40) + rnd(k, 1) * 8);
    if (Math.abs(track.delta(u, track.startU)) < 16) continue;
    if (track.delta(track.lipU - 30, u) > 0 && track.delta(track.landU + 10, u) < 0) continue;
    track.frame(u, f);
    const s = k % 2 ? 1 : -1;
    const flat = new THREE.Vector3(f.side.x, 0, f.side.z).normalize();
    const off = WALL + WALL_T + 2.2;
    const x = f.pos.x + flat.x * off * s, z = f.pos.z + flat.z * off * s;
    if (!clearOfRoad(x, z, WALL + 1.5)) continue;
    const kind = k % 3;
    const obj = kind === 0 ? vending(NEON[k % NEON.length]) : kind === 1 ? planter(k) : hydrant();
    obj.position.set(x, Math.max(0, f.pos.y - 0.2), z);
    obj.rotation.y = Math.atan2(-flat.x * s, -flat.z * s);
    scene.add(keep(obj));
  }

  mergeStatic(scene, takeStatic(), true);

  return { sun: moon, gateLamps, sky, water, balloons: [], spinners, flags: [], center, weather: quality === "low" ? undefined : drizzle(scene),
    animate: (t: number) => { skyline.animate(t); train.update(t); traffic.update(t); } };
}

/**
 * Rain: tapered streaks (bright at the tip, fading up the tail) in a box
 * that rides just ahead of the camera, slanting against the camera's
 * motion, plus splashes popping on the tarmac around the player.
 */
function drizzle(scene: THREE.Scene) {
  const N = 2600, BOX = 44, H = 26;
  const pos = new Float32Array(N * 6);
  const col = new Float32Array(N * 6);
  const seeds = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    seeds[i * 4] = (rnd(i, 60) - 0.5) * BOX;
    seeds[i * 4 + 1] = rnd(i, 61) * H;
    seeds[i * 4 + 2] = (rnd(i, 62) - 0.5) * BOX;
    seeds[i * 4 + 3] = 0.55 + rnd(i, 63) * 0.9;   // length and brightness
    const k = 0.35 + rnd(i, 64) * 0.65;
    // Tail (first vertex) black = invisible under additive blending; tip lit.
    col.set([0, 0, 0, 0.62 * k, 0.72 * k, 1.0 * k], i * 6);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.42, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  }));
  lines.frustumCulled = false;
  scene.add(lines);

  // Splashes: little rings that grow and fade on the road.
  const S = 180;
  const sp = new Float32Array(S * 3), age = new Float32Array(S);
  for (let i = 0; i < S; i++) age[i] = rnd(i, 70);
  const sgeo = new THREE.BufferGeometry();
  sgeo.setAttribute("position", new THREE.BufferAttribute(sp, 3));
  sgeo.setAttribute("aAge", new THREE.BufferAttribute(age, 1));
  const splashes = new THREE.Points(sgeo, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `attribute float aAge; varying float vAge;
      void main(){ vAge = aAge; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
        gl_PointSize = min(40.0, (1.5 + aAge * 7.0) * (40.0 / max(1.0, -mv.z))); }`,
    fragmentShader: `varying float vAge;
      void main(){ vec2 d = gl_PointCoord - 0.5; float r = length(d) * 2.0;
        float ring = smoothstep(0.55, 0.8, r) * (1.0 - smoothstep(0.8, 1.0, r));
        gl_FragColor = vec4(vec3(0.55, 0.65, 0.95) * ring * (1.0 - vAge) * 0.55, 1.0); }`,
  }));
  splashes.frustumCulled = false;
  scene.add(splashes);

  let fall = 0;
  const prev = new THREE.Vector3(), vel = new THREE.Vector3(), fwd = new THREE.Vector3();
  let first = true;
  return {
    update(cam: THREE.Camera, dt: number, focus?: THREE.Vector3) {
      fall += dt * 30;
      const c = cam.position;
      if (first) { prev.copy(c); first = false; }
      // Camera velocity, smoothed: rain appears to slant into the direction of travel.
      vel.lerp(new THREE.Vector3().subVectors(c, prev).divideScalar(Math.max(dt, 1e-3)), Math.min(1, dt * 6));
      prev.copy(c);
      cam.getWorldDirection(fwd);
      const ox = c.x + fwd.x * 14, oz = c.z + fwd.z * 14;
      const sx = -vel.x * 0.035, sz = -vel.z * 0.035;
      for (let i = 0; i < N; i++) {
        const x = ox + seeds[i * 4], z = oz + seeds[i * 4 + 2];
        const len = seeds[i * 4 + 3];
        const y = c.y - 8 + H - ((seeds[i * 4 + 1] + fall * (0.8 + len * 0.3)) % H);
        const o = i * 6;
        pos[o] = x - sx * len; pos[o + 1] = y + 1.1 * len; pos[o + 2] = z - sz * len;
        pos[o + 3] = x; pos[o + 4] = y; pos[o + 5] = z;
      }
      geo.attributes.position.needsUpdate = true;
      if (focus) {
        for (let i = 0; i < S; i++) {
          age[i] += dt * (2.2 + (i % 5) * 0.3);
          if (age[i] >= 1) {
            age[i] -= 1;
            const a = Math.random() * Math.PI * 2, r = 3 + Math.random() * 18;
            sp[i * 3] = focus.x + Math.cos(a) * r + fwd.x * 10;
            sp[i * 3 + 1] = focus.y + 0.06;
            sp[i * 3 + 2] = focus.z + Math.sin(a) * r + fwd.z * 10;
          }
        }
        sgeo.attributes.position.needsUpdate = true;
        sgeo.attributes.aAge.needsUpdate = true;
      }
    },
  };
}

/**
 * Darkens surfaces toward the ground: the grime and bounce-shadow at the
 * foot of real buildings, which makes them sit in the street.
 */
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

/** Is a rotated w×d footprint centred at (x, z) clear of the street? */
function footprintClear(x: number, z: number, w: number, d: number, yaw: number,
  clear: (x: number, z: number, m: number) => boolean, margin: number) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  for (const [lx, lz] of [[0, 0], [-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2], [0, -d / 2], [0, d / 2], [-w / 2, 0], [w / 2, 0]]) {
    const px = x + lx * c + lz * s, pz = z - lx * s + lz * c;
    if (!clear(px, pz, margin)) return false;
  }
  return true;
}

/**
 * The buildings, gathered and merged: a few facade materials with lit
 * windows, street-level shopfronts with awnings, blade signs and rooftop
 * neon, water tanks and antenna beacons.
 */
class CityBlocks {
  /** Rooftop tanks and antennas; skipped on phones. */
  constructor(private detail: boolean) {}
  private facades = [0, 1, 2, 3, 4, 5, 6, 7].map((v) => {
    // Four punched-window facades and four glass curtain walls.
    const { map, glow, rough } = v < 4 ? T.facadeTex(v) : T.curtainTex(v - 4);
    if (v >= 4) {
      return {
        mat: grounded(new THREE.MeshStandardMaterial({
          map, emissive: "#ffffff", emissiveMap: glow, emissiveIntensity: 1.1,
          roughness: 1, roughnessMap: rough, metalness: 0.65, envMapIntensity: 1.6,
        })),
        geos: [] as THREE.BufferGeometry[],
      };
    }
    return {
      mat: grounded(new THREE.MeshStandardMaterial({
        map, emissive: "#ffffff", emissiveMap: glow, emissiveIntensity: 1.0,
        roughness: 1, roughnessMap: rough, metalness: 0.35, envMapIntensity: 1.3,
      })),
      geos: [] as THREE.BufferGeometry[],
    };
  });
  private roof = { mat: M.plastic("#23263a", 0.85), geos: [] as THREE.BufferGeometry[] };
  private plinth = { mat: grounded(new THREE.MeshStandardMaterial({ map: T.stoneTex(), color: "#6d6f80", roughness: 0.8 })), geos: [] as THREE.BufferGeometry[] };
  private ac = { mat: M.plastic("#b9bdcb", 0.6, 0.3), geos: [] as THREE.BufferGeometry[] };
  private shops = [0, 1, 2, 3, 4, 5].map((v) => {
    const tex = T.shopfrontTex(SHOPS[v * 2], SHOPS[v * 2 + 1], NEON[v % NEON.length]);
    return { mat: new THREE.MeshStandardMaterial({ map: tex, emissive: "#ffffff", emissiveMap: tex, emissiveIntensity: 1.1, roughness: 0.4 }), geos: [] as THREE.BufferGeometry[] };
  });
  private awnings = NEON.map((c) => ({ mat: M.plastic(c, 0.5), geos: [] as THREE.BufferGeometry[] }));
  private signs = new Map<string, { mat: THREE.Material; geos: THREE.BufferGeometry[] }>();
  private neon = NEON.map((c) => ({ mat: new THREE.MeshBasicMaterial({ color: hot(c, 2.2), toneMapped: false }), geos: [] as THREE.BufferGeometry[] }));
  private tanks = { mat: M.plastic("#6b5a4a", 0.8), geos: [] as THREE.BufferGeometry[] };
  private beacons = { mat: new THREE.MeshBasicMaterial({ color: hot("#ff2d55", 2.5), toneMapped: false }), geos: [] as THREE.BufferGeometry[] };

  add(x: number, z: number, w: number, d: number, h: number, yaw: number, seed: number, front: boolean) {
    const place = (g: THREE.BufferGeometry, lx: number, ly: number, lz: number, ry = 0) => {
      g.rotateY(ry);
      g.translate(lx, ly, lz);
      g.rotateY(yaw);
      g.translate(x, 0, z);
      // Remember which block it belongs to (for culling chunks) and whether
      // it lines the street (only those are worth a shadow).
      g.userData.cx = x;
      g.userData.cz = z;
      g.userData.front = front;
      return g;
    };
    // Body, UVs scaled so windows keep a constant size.
    const body = new THREE.BoxGeometry(w, h, d);
    const uv = body.attributes.uv as THREE.BufferAttribute;
    const nrm = body.attributes.normal as THREE.BufferAttribute;
    for (let k = 0; k < uv.count; k++) {
      const side = Math.abs(nrm.getX(k)) > 0.5 ? d : w;
      if (Math.abs(nrm.getY(k)) > 0.5) uv.setXY(k, 0, 0);
      else uv.setXY(k, (uv.getX(k) * side) / 14, (uv.getY(k) * h) / 16);
    }
    const v = rnd(seed, 19) < 0.35 ? 4 + Math.floor(rnd(seed, 20) * 4) : Math.floor(rnd(seed, 20) * 4);
    // Tall towers step back near the top, like real ones.
    const setback = h > 34 && rnd(seed, 40) < 0.7;
    const hb = setback ? Math.round(h * (0.62 + rnd(seed, 41) * 0.15)) : h;
    if (setback) {
      body.dispose();
      const lower = new THREE.BoxGeometry(w, hb, d);
      const upper = new THREE.BoxGeometry(w * 0.74, h - hb, d * 0.74);
      for (const [g, gw, gh, gd] of [[lower, w, hb, d], [upper, w * 0.74, h - hb, d * 0.74]] as const) {
        const u = g.attributes.uv as THREE.BufferAttribute, nn = g.attributes.normal as THREE.BufferAttribute;
        for (let k = 0; k < u.count; k++) {
          const side = Math.abs(nn.getX(k)) > 0.5 ? gd : gw;
          if (Math.abs(nn.getY(k)) > 0.5) u.setXY(k, 0, 0);
          else u.setXY(k, (u.getX(k) * side) / 14, (u.getY(k) * gh) / 16);
        }
      }
      this.facades[v].geos.push(place(lower, 0, hb / 2, 0));
      this.facades[v].geos.push(place(upper, 0, hb + (h - hb) / 2, 0));
      // Cornice where it steps back.
      this.roof.geos.push(place(new THREE.BoxGeometry(w + 0.8, 0.7, d + 0.8), 0, hb + 0.35, 0));
    } else {
      this.facades[v].geos.push(place(body, 0, h / 2, 0));
    }
    // A stone plinth at street level, and a cornice at the roof.
    this.plinth.geos.push(place(new THREE.BoxGeometry(w + 0.5, 4.8, d + 0.5), 0, 2.4, 0));
    const tw = setback ? w * 0.74 : w, td = setback ? d * 0.74 : d;
    this.roof.geos.push(place(new THREE.BoxGeometry(tw + 0.6, 0.8, td + 0.6), 0, h + 0.4, 0));
    // Air-con units hung under windows on the street side.
    if (front) {
      const n = Math.floor(rnd(seed, 42) * 5);
      for (let k = 0; k < n; k++) {
        const ax = (rnd(seed, 43 + k) - 0.5) * (w - 3);
        const ay = 7 + Math.floor(rnd(seed, 50 + k) * Math.max(1, (hb - 9) / 4)) * 4;
        this.ac.geos.push(place(new THREE.BoxGeometry(1.0, 0.7, 0.55), ax, ay, -(d / 2 + 0.28)));
      }
    }
    if (this.detail && rnd(seed, 21) < 0.5) {
      const tank = new THREE.CylinderGeometry(1.6, 1.6, 3, 12);
      this.tanks.geos.push(place(tank, (rnd(seed, 22) - 0.5) * tw * 0.5, h + 2.3, (rnd(seed, 23) - 0.5) * td * 0.5));
      this.tanks.geos.push(place(new THREE.ConeGeometry(1.8, 1, 12), (rnd(seed, 22) - 0.5) * tw * 0.5, h + 4.3, (rnd(seed, 23) - 0.5) * td * 0.5));
    }
    if (this.detail && (h > 40 || rnd(seed, 24) < 0.3)) {
      const ah = 4 + rnd(seed, 25) * 8;
      this.roof.geos.push(place(new THREE.CylinderGeometry(0.12, 0.2, ah, 6), tw * 0.25, h + ah / 2, -td * 0.2));
      this.beacons.geos.push(place(new THREE.SphereGeometry(0.4, 8, 6), tw * 0.25, h + ah, -td * 0.2));
    }
    // Neon edge on some roofs.
    if (rnd(seed, 26) < 0.45) {
      const c = Math.floor(rnd(seed, 27) * NEON.length);
      this.neon[c].geos.push(place(new THREE.BoxGeometry(tw + 0.7, 0.14, 0.14), 0, h + 0.85, -(td / 2 + 0.3)));
      this.neon[c].geos.push(place(new THREE.BoxGeometry(0.14, 0.14, td + 0.7), tw / 2 + 0.3, h + 0.85, 0));
      this.neon[c].geos.push(place(new THREE.BoxGeometry(0.14, 0.14, td + 0.7), -(tw / 2 + 0.3), h + 0.85, 0));
    }
    if (!front) return;
    // Street level (local −Z faces the road): shopfront, awning, blade sign.
    const sv = Math.floor(rnd(seed, 30) * this.shops.length);
    this.shops[sv].geos.push(place(new THREE.PlaneGeometry(w - 0.6, 4.6), 0, 2.4, -(d / 2 + 0.05), Math.PI));
    const aw = Math.floor(rnd(seed, 31) * this.awnings.length);
    const awning = new THREE.BoxGeometry(w - 1, 0.18, 2.2);
    awning.rotateX(-0.28);
    this.awnings[aw].geos.push(place(awning, 0, 5.1, -(d / 2 + 1.05)));
    if (rnd(seed, 32) < 0.7 && h > 14) {
      // A vertical blade sign sticking out from the corner of the facade.
      const text = SHOPS[Math.floor(rnd(seed, 33) * SHOPS.length)];
      const col = NEON[Math.floor(rnd(seed, 34) * NEON.length)];
      const key = text + col;
      let sgn = this.signs.get(key);
      if (!sgn) {
        const tex = T.bladeSignTex(text, col);
        sgn = { mat: new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1.6, 1.6, 1.6), toneMapped: false }), geos: [] };
        this.signs.set(key, sgn);
      }
      const sh = Math.min(h - 7, 9 + rnd(seed, 35) * 5);
      const sx = (w / 2 - 1.2) * (rnd(seed, 36) < 0.5 ? -1 : 1);
      // Two faces, each seen from one side of the street.
      sgn.geos.push(place(new THREE.PlaneGeometry(2.2, sh), sx, 7 + sh / 2, -(d / 2 + 1.35), Math.PI / 2));
      sgn.geos.push(place(new THREE.PlaneGeometry(2.2, sh), sx, 7 + sh / 2, -(d / 2 + 1.35), -Math.PI / 2));
      this.roof.geos.push(place(new THREE.BoxGeometry(0.2, sh + 0.4, 2.5), sx, 7 + sh / 2, -(d / 2 + 1.35)));
    }
  }

  build(scene: THREE.Scene) {
    // Merged per material and per 120 m chunk, so blocks off-screen (and out
    // of the moon's shadow box) are culled instead of drawn every frame.
    const CHUNK = 120;
    const all = [...this.facades, this.roof, this.plinth, this.ac, ...this.shops, ...this.awnings, ...this.signs.values(), ...this.neon, this.tanks, this.beacons];
    for (const b of all) {
      const groups = new Map<string, { geos: THREE.BufferGeometry[]; front: boolean }>();
      for (const g of b.geos) {
        const front = g.userData.front === true;
        const key = `${Math.floor((g.userData.cx as number) / CHUNK)}:${Math.floor((g.userData.cz as number) / CHUNK)}:${front}`;
        let grp = groups.get(key);
        if (!grp) { grp = { geos: [], front }; groups.set(key, grp); }
        grp.geos.push(g.index ? g.toNonIndexed() : g);
      }
      const glow = b.mat instanceof THREE.MeshBasicMaterial;
      for (const grp of groups.values()) {
        const g = mergeGeometries(grp.geos, false);
        grp.geos.forEach((x) => x.dispose());
        if (!g) continue;
        g.computeBoundingSphere();
        const mesh = new THREE.Mesh(g, b.mat);
        mesh.castShadow = !glow && grp.front;
        mesh.receiveShadow = !glow;
        scene.add(mesh);
      }
      b.geos.forEach((x) => x.dispose());
    }
  }
}

/** A glowing gate over the road: a rounded frame of neon tube on dark posts. */
function neonGate(a: string, b: string) {
  const g = new THREE.Group();
  const span = WALL + 0.8, top = 9;
  const shape = new THREE.CurvePath<THREE.Vector3>();
  const r = 3;
  const pts = [
    new THREE.Vector3(-span, 0, 0), new THREE.Vector3(-span, top - r, 0),
  ];
  shape.add(new THREE.LineCurve3(pts[0], pts[1]));
  shape.add(new THREE.QuadraticBezierCurve3(new THREE.Vector3(-span, top - r, 0), new THREE.Vector3(-span, top, 0), new THREE.Vector3(-span + r, top, 0)));
  shape.add(new THREE.LineCurve3(new THREE.Vector3(-span + r, top, 0), new THREE.Vector3(span - r, top, 0)));
  shape.add(new THREE.QuadraticBezierCurve3(new THREE.Vector3(span - r, top, 0), new THREE.Vector3(span, top, 0), new THREE.Vector3(span, top - r, 0)));
  shape.add(new THREE.LineCurve3(new THREE.Vector3(span, top - r, 0), new THREE.Vector3(span, 0, 0)));
  const frame = new THREE.TubeGeometry(shape, 120, 0.45, 10, false);
  g.add(new THREE.Mesh(frame, M.plastic("#1b1e2c", 0.4, 0.6)));
  for (const [z, col] of [[0.5, a], [-0.5, b]] as const) {
    const tube = new THREE.TubeGeometry(shape, 160, 0.12, 8, false);
    const m = new THREE.Mesh(tube, new THREE.MeshBasicMaterial({ color: hot(col, 2.6), toneMapped: false }));
    m.position.z = z;
    g.add(m);
  }
  // A sign hanging from the top bar.
  const board = new THREE.Mesh(new THREE.BoxGeometry(9, 1.8, 0.3), M.plastic("#141726", 0.4));
  board.position.y = top - 1.4;
  g.add(board);
  const tex = T.bladeSignTex("NEON TOWN", a, true);
  for (const s of [1, -1]) {
    const face = new THREE.Mesh(new THREE.PlaneGeometry(8.6, 1.5), new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1.6, 1.6, 1.6), toneMapped: false }));
    face.position.set(0, top - 1.4, 0.16 * s);
    if (s < 0) face.rotation.y = Math.PI;
    g.add(face);
  }
  return g;
}

/** A sagging wire of warm bulbs strung from a to b. */
function stringLights(a: THREE.Vector3, b: THREE.Vector3, sag: number, seed: number) {
  const g = new THREE.Group();
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    pts.push(a.clone().lerp(b, t).setY(a.y + (b.y - a.y) * t - Math.sin(t * Math.PI) * sag));
  }
  const wire = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.03, 4, false);
  g.add(new THREE.Mesh(wire, M.plastic("#15161f", 0.6)));
  const cols = seed % 2 ? ["#ffd28a", "#ff9ad5", "#9ae8ff"] : ["#ffd28a"];
  const mats = cols.map((c) => new THREE.MeshBasicMaterial({ color: hot(c, 2.4), toneMapped: false }));
  const bulb = new THREE.SphereGeometry(0.16, 8, 6);
  for (let i = 1; i < 24; i++) {
    const m = new THREE.Mesh(bulb, mats[i % mats.length]);
    m.position.copy(pts[i]).y -= 0.18;
    g.add(m);
  }
  // Poles at either end.
  for (const p of [a, b]) {
    const pole = new THREE.Mesh(M.cyl(0.14, 0.18, p.y + 0.5, 8), M.plastic("#2a2f45", 0.4, 0.6));
    pole.position.set(p.x, (p.y + 0.5) / 2 - 0.5, p.z);
    g.add(pole);
  }
  return g;
}

function vending(col: string) {
  const g = new THREE.Group();
  M.add(g, M.rbox(1.3, 2.1, 0.9, 0.08), M.plastic("#e9ecf5", 0.4), 0, 1.05, 0);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.4), new THREE.MeshBasicMaterial({ color: hot(col, 1.3), toneMapped: false }));
  face.position.set(0, 1.25, -0.46);
  face.rotation.y = Math.PI;
  g.add(face);
  const slot = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.25), M.plastic("#15161f", 0.5));
  slot.position.set(0, 0.3, -0.46);
  slot.rotation.y = Math.PI;
  g.add(slot);
  return g;
}

function planter(seed: number) {
  const g = new THREE.Group();
  M.add(g, M.rbox(1.8, 0.8, 1.8, 0.12), M.plastic("#3a3f55", 0.8), 0, 0.4, 0);
  M.add(g, M.sphere(1.1, 14, 10), M.plastic(seed % 2 ? "#2f7a4a" : "#3d8f56", 0.8), 0, 1.7, 0).scale.set(1, 1.15, 1);
  M.add(g, M.cyl(0.12, 0.16, 1.2, 6), M.plastic("#5b4232", 0.8), 0, 1.0, 0);
  // Fairy lights wound through the leaves.
  const mat = new THREE.MeshBasicMaterial({ color: hot("#ffd28a", 2.2), toneMapped: false });
  for (let k = 0; k < 10; k++) {
    const a = k * 2.4, y = 1.2 + (k / 10) * 1.2;
    const m = new THREE.Mesh(M.sphere(0.06, 6, 4), mat);
    m.position.set(Math.cos(a) * 1.05, y, Math.sin(a) * 1.05);
    g.add(m);
  }
  return g;
}

function hydrant() {
  const g = new THREE.Group();
  const red = M.plastic("#ff3048", 0.35);
  M.add(g, M.cyl(0.22, 0.26, 0.8, 12), red, 0, 0.4, 0);
  M.add(g, M.sphere(0.24, 12, 8), red, 0, 0.82, 0);
  for (const s of [-1, 1]) M.add(g, M.cyl(0.09, 0.09, 0.2, 8), M.plastic("#d9dce8", 0.3), 0.26 * s, 0.55, 0).rotation.z = Math.PI / 2;
  return g;
}

function houseboat(seed: number) {
  const g = new THREE.Group();
  const hull = M.plastic(seed % 2 ? "#2f4a8a" : "#7a2f5a", 0.5);
  M.add(g, M.rbox(14, 1.6, 4.6, 0.6), hull, 0, 0.6, 0);
  M.add(g, M.rbox(8, 2.4, 3.6, 0.3), M.plastic("#e9ecf5", 0.5), -1, 2.4, 0);
  M.add(g, M.rbox(8.6, 0.25, 4.2, 0.1), M.plastic("#23263a", 0.6), -1, 3.7, 0);
  const lit = new THREE.MeshBasicMaterial({ color: hot("#ffcf7a", 1.8), toneMapped: false });
  for (let k = 0; k < 4; k++) {
    for (const s of [-1, 1]) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.9), lit);
      w.position.set(-4 + k * 2, 2.5, 1.81 * s);
      if (s < 0) w.rotation.y = Math.PI;
      g.add(w);
    }
  }
  return g;
}

/**
 * A night environment for reflections: a dark room with a few coloured
 * light panels, so wet tarmac and paint pick up pink, cyan and warm neon
 * instead of a grey studio.
 */
function nightEnvironment(renderer: THREE.WebGLRenderer) {
  const env = new THREE.Scene();
  env.background = new THREE.Color("#05060f");
  const room = new THREE.Mesh(new THREE.BoxGeometry(40, 20, 40), new THREE.MeshBasicMaterial({ color: "#0b0d1f", side: THREE.BackSide }));
  env.add(room);
  const panel = (col: string, k: number, x: number, y: number, z: number, w: number, h: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: hot(col, k), side: THREE.DoubleSide }));
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    env.add(m);
  };
  panel("#ff3fa4", 1.5, -18, 3, 6, 10, 5);
  panel("#2ee6ff", 1.2, 18, 2, -6, 10, 5);
  panel("#ffcf7a", 2.5, 4, 4, 18, 14, 3);
  panel("#6b8bff", 1.6, -6, 5, -18, 12, 4);
  panel("#c9d6ff", 1.4, 0, 9.5, 0, 20, 8);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(env, 0.02).texture;
  pmrem.dispose();
  return tex;
}
