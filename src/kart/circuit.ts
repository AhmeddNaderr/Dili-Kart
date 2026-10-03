import * as THREE from "three";
import * as T from "./textures";
import * as M from "./models";
import { WALL, Track, newFrame } from "./track";

/**
 * Big-event dressing for Dili Circuit: a pit building with team garages
 * and a race-control tower along the main straight, stadium floodlight
 * masts, and a Dlicom blimp circling overhead.
 */

const hot = (hex: string, k: number) => new THREE.Color(hex).multiplyScalar(k);
const TEAMS = ["#e8384f", "#ff8a1f", "#9b5cff", "#19c37d", "#ff4fb4", "#ffd21f", "#16c1e0", "#3d63ff"];

/**
 * Pit building: a long white block of garages (each lit inside, with its
 * team's colour band and number), a glass hospitality deck on top, a roof
 * canopy with the Dlicom name, and a race-control tower at the far end.
 * Built on the outside of the main straight. `keep` adds parts to the
 * static merge.
 */
export function pitBuilding(scene: THREE.Scene, track: Track, keep: <O extends THREE.Object3D>(o: O) => O) {
  const f = newFrame();
  const u0 = track.startU - 50, u1 = track.startU + 60;
  // The outside of the straight is the side facing away from the infield.
  track.frame(track.startU, f);
  const probe = (s: number) => track.point(track.startU, s * (WALL + 30), 0);
  const mid = new THREE.Vector3();
  for (const [x, z] of track.outline(20)) mid.add(new THREE.Vector3(x, 0, z));
  mid.divideScalar(track.outline(20).length);
  const side = probe(1).distanceTo(mid) > probe(-1).distanceTo(mid) ? 1 : -1;

  const len = u1 - u0, depth = 16, off = WALL + 1.2 + depth / 2;
  const g = new THREE.Group();
  track.frame((u0 + u1) / 2, f);
  const flat = new THREE.Vector3(f.side.x, 0, f.side.z).normalize();
  const base = f.pos.clone().addScaledVector(flat, off * side);
  g.position.set(base.x, Math.max(0, f.pos.y - 0.3), base.z);
  // Local +X runs along the track, local −Z faces the road.
  g.rotation.y = Math.atan2(f.tan.x, f.tan.z) - Math.PI / 2 + (side > 0 ? 0 : Math.PI);
  scene.add(g);

  const white = M.plastic("#eef2fa", 0.45);
  const dark = M.plastic("#1b1e2c", 0.5, 0.3);
  const steel = M.plastic("#aeb6c8", 0.25, 0.9);
  const interior = new THREE.MeshBasicMaterial({ color: hot("#fff1d6", 1.25), toneMapped: false });

  // Garage block.
  M.add(g, M.rbox(len, 8, depth, 0.3), white, 0, 4, 0);
  const bays = Math.floor(len / 9);
  for (let i = 0; i < bays; i++) {
    const x = -len / 2 + 4.5 + i * (len / bays);
    // Open garage: dark frame, lit back wall, the car's team stripe above.
    M.add(g, new THREE.BoxGeometry(6.4, 5.4, 0.6), dark, x, 2.8, -depth / 2 - 0.05, false);
    const inner = new THREE.Mesh(new THREE.PlaneGeometry(5.8, 4.9), interior);
    inner.position.set(x, 2.7, -depth / 2 - 0.36);
    inner.rotation.y = Math.PI;
    g.add(inner);
    const team = TEAMS[i % TEAMS.length];
    M.add(g, new THREE.BoxGeometry(6.4, 0.9, 0.3), M.plastic(team, 0.35), x, 6.2, -depth / 2 - 0.2);
    const num = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.4), new THREE.MeshBasicMaterial({
      map: T.emblemTex(team, "#ffffff", "#ffffff", String((i % 9) + 1)), transparent: true,
    }));
    num.position.set(x + 2.4, 6.2, -depth / 2 - 0.38);
    num.rotation.y = Math.PI;
    g.add(num);
  }

  // Hospitality deck: a glass box set back, with a balcony and a light rail.
  const { map, glow, rough } = T.curtainTex(0);
  map.repeat.set(len / 16, 0.4);
  glow.repeat.copy(map.repeat);
  rough.repeat.copy(map.repeat);
  const glass = new THREE.MeshStandardMaterial({
    map, emissive: "#ffffff", emissiveMap: glow, emissiveIntensity: 1.2,
    roughness: 1, roughnessMap: rough, metalness: 0.6, envMapIntensity: 1.5,
  });
  M.add(g, new THREE.BoxGeometry(len - 4, 6, depth - 5), glass, 0, 11, 2.5);
  M.add(g, new THREE.BoxGeometry(len, 0.5, depth), white, 0, 8.2, 0);
  const rail = new THREE.MeshBasicMaterial({ color: hot("#5f86ff", 2.4), toneMapped: false });
  M.add(g, new THREE.BoxGeometry(len - 1, 0.15, 0.15), rail, 0, 9.4, -depth / 2 + 0.4, false);
  for (let x = -len / 2 + 2; x < len / 2; x += 3) M.add(g, M.cyl(0.05, 0.05, 1.2, 4), steel, x, 8.9, -depth / 2 + 0.4, false);

  // Roof canopy, cantilevered over the pit lane, with the Dlicom name.
  M.add(g, new THREE.BoxGeometry(len + 2, 0.8, depth + 6), dark, 0, 14.6, -2);
  const nameTex = T.bannerTex("DLICOM GRAND PRIX · PIT LANE", "#2f6bff", "#ffffff", 1024, 96);
  const name = new THREE.Mesh(new THREE.PlaneGeometry(len * 0.8, 2.2), new THREE.MeshStandardMaterial({
    map: nameTex, emissive: "#ffffff", emissiveMap: nameTex, emissiveIntensity: 0.9, roughness: 0.4,
  }));
  name.position.set(0, 15.2, -depth / 2 - 5.05);
  name.rotation.y = Math.PI;
  g.add(name);
  const edge = new THREE.MeshBasicMaterial({ color: hot("#ffc84a", 2.2), toneMapped: false });
  M.add(g, new THREE.BoxGeometry(len + 2, 0.18, 0.18), edge, 0, 14.2, -depth / 2 - 5, false);

  // Race control: a round tower at the far end with a glass pod on top.
  const tx = len / 2 + 6;
  M.add(g, M.cyl(2.6, 3, 26, 20), white, tx, 13, 2);
  const pod = new THREE.Mesh(new THREE.CylinderGeometry(6.5, 5, 5, 24), glass);
  pod.position.set(tx, 28, 2);
  g.add(pod);
  M.add(g, M.cyl(7, 7, 0.8, 24), dark, tx, 31, 2);
  M.add(g, new THREE.TorusGeometry(6.6, 0.14, 6, 40).rotateX(Math.PI / 2), rail, tx, 30.4, 2, false);
  M.add(g, M.cyl(0.15, 0.3, 10, 6), steel, tx, 36, 2, false);
  const beacon = new THREE.Mesh(M.sphere(0.5, 10, 8), new THREE.MeshBasicMaterial({ color: hot("#ff2d55", 3), toneMapped: false }));
  beacon.position.set(tx, 41.2, 2);
  g.add(beacon);
  const rc = T.bannerTex("RACE CONTROL", "#15161f", "#ffc84a", 512, 96);
  for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(7, 1.3), new THREE.MeshBasicMaterial({ map: rc, toneMapped: false }));
    sign.position.set(tx + Math.sin(a) * 7.05, 31, 2 + Math.cos(a) * 7.05);
    sign.rotation.y = a;
    g.add(sign);
  }
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  keep(g);
}

/**
 * Stadium floodlight masts: tall lattice towers standing outside the bowl
 * with a bank of lamps angled down at the circuit.
 */
export function floodMasts(scene: THREE.Scene, center: THREE.Vector3, rx: number, rz: number, keep: <O extends THREE.Object3D>(o: O) => O) {
  const steel = M.plastic("#c9cfdf", 0.35, 0.8);
  const frame = M.plastic("#1b1e2c", 0.45, 0.4);
  const lamp = new THREE.MeshBasicMaterial({ color: hot("#fffbe8", 3), toneMapped: false });
  const H = 68;
  for (const a of [Math.PI * 0.25, Math.PI * 0.75, Math.PI * 1.25, Math.PI * 1.75]) {
    const g = new THREE.Group();
    g.position.set(center.x + Math.cos(a) * (rx + 60), 0, center.z + Math.sin(a) * (rz + 60));
    g.lookAt(center.x, 0, center.z);
    scene.add(g);
    // Three legs tapering in, with cross braces every 8 m.
    const legs: THREE.Vector3[] = [];
    for (let k = 0; k < 3; k++) {
      const la = (k / 3) * Math.PI * 2;
      legs.push(new THREE.Vector3(Math.cos(la) * 3.2, 0, Math.sin(la) * 3.2));
    }
    const top = (v: THREE.Vector3) => v.clone().multiplyScalar(0.35).setY(H);
    const rod = (a0: THREE.Vector3, b0: THREE.Vector3, r: number) => {
      const m = new THREE.Mesh(M.cyl(r, r, 1, 6), steel);
      m.position.copy(a0).add(b0).multiplyScalar(0.5);
      m.scale.y = a0.distanceTo(b0);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b0.clone().sub(a0).normalize());
      g.add(m);
    };
    legs.forEach((l) => rod(l, top(l), 0.35));
    for (let y = 8; y < H; y += 8) {
      const t = y / H;
      const ring = legs.map((l) => l.clone().multiplyScalar(1 - 0.65 * t).setY(y));
      for (let k = 0; k < 3; k++) rod(ring[k], ring[(k + 1) % 3], 0.12);
    }
    // Lamp bank: a frame tilted toward the track, 4×4 lamps.
    const head = new THREE.Group();
    head.position.set(0, H + 4, 1);
    head.rotation.x = 0.45;
    g.add(head);
    head.add(new THREE.Mesh(M.rbox(14, 8, 1, 0.3), frame));
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
      const l = new THREE.Mesh(M.cyl(1.1, 1.1, 0.4, 14), lamp);
      l.rotation.x = Math.PI / 2;
      l.position.set(-5.1 + c * 3.4, -2.7 + r * 1.8, 0.6);
      head.add(l);
    }
    keep(g);
  }
}

/** The Dlicom blimp, slowly circling the stadium with its nav lights blinking. */
export function blimp(scene: THREE.Scene, center: THREE.Vector3, radius: number) {
  const g = new THREE.Group();
  const skinTex = T.bannerTex("DLICOM", "#f4f6fb", "#2f6bff", 1024, 256, "ONE APP · EVERY CHAIN");
  const hull = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 24), new THREE.MeshStandardMaterial({ color: "#f4f6fb", roughness: 0.45, metalness: 0.1 }));
  hull.scale.set(7, 7, 22);
  g.add(hull);
  for (const s of [-1, 1]) {
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(26, 6.5), new THREE.MeshStandardMaterial({
      map: skinTex, emissive: "#ffffff", emissiveMap: skinTex, emissiveIntensity: 0.5, roughness: 0.5,
    }));
    banner.position.set(7.02 * s, 0.4, 0);
    banner.rotation.y = s * Math.PI / 2;
    g.add(banner);
  }
  const fin = M.plastic("#2f6bff", 0.4);
  for (const [rx, rz] of [[0, 0], [0, Math.PI / 2], [0, Math.PI], [0, -Math.PI / 2]]) {
    const f = new THREE.Mesh(new THREE.BoxGeometry(0.4, 6, 5), fin);
    const holder = new THREE.Group();
    holder.rotation.set(rx, 0, rz);
    f.position.set(0, 7, -18);
    holder.add(f);
    g.add(holder);
  }
  const gondola = new THREE.Mesh(M.rbox(3, 2, 7, 0.8), M.plastic("#1b1e2c", 0.4));
  gondola.position.set(0, -7.4, 2);
  g.add(gondola);
  const win = new THREE.MeshBasicMaterial({ color: hot("#ffe2a8", 1.8), toneMapped: false });
  for (const s of [-1, 1]) {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(5, 0.8), win);
    w.position.set(1.52 * s, -7.2, 2);
    w.rotation.y = s * Math.PI / 2;
    g.add(w);
  }
  const red = new THREE.MeshBasicMaterial({ color: hot("#ff2d3a", 3), toneMapped: false });
  const green = new THREE.MeshBasicMaterial({ color: hot("#1bff6a", 3), toneMapped: false });
  const navL = new THREE.Mesh(M.sphere(0.4, 8, 6), red);
  navL.position.set(-7, 0, 0);
  const navR = new THREE.Mesh(M.sphere(0.4, 8, 6), green);
  navR.position.set(7, 0, 0);
  g.add(navL, navR);
  g.traverse((o) => { o.castShadow = false; });
  scene.add(g);
  return {
    update(t: number) {
      const a = t * 0.025;
      g.position.set(center.x + Math.cos(a) * radius, 115 + Math.sin(t * 0.2) * 3, center.z + Math.sin(a) * radius);
      // Nose along the direction of travel.
      g.rotation.set(0, -a, Math.sin(t * 0.3) * 0.02);
      const on = Math.sin(t * 4) > 0.6;
      navL.visible = navR.visible = on;
    },
  };
}

/**
 * Circuit furniture: stacked tyre walls on the outside of the tight corners
 * (instanced, one draw call), and marshal posts with a flag and a light.
 */
export function cornerDetail(scene: THREE.Scene, track: Track, keep: <O extends THREE.Object3D>(o: O) => O) {
  const f = newFrame();
  // Find the tight corners from the track's curvature.
  const corners: { u: number; s: number }[] = [];
  for (let u = 0; u < track.length; u += 4) {
    const k = track.curvature(u);
    if (Math.abs(k) > 0.022 && !corners.some((c) => Math.abs(track.delta(c.u, u)) < 40)) corners.push({ u, s: k > 0 ? -1 : 1 });
  }
  const tyre = new THREE.TorusGeometry(0.42, 0.2, 6, 14).rotateX(Math.PI / 2);
  const spots: THREE.Matrix4[] = [];
  const cols: THREE.Color[] = [];
  const q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1);
  for (const c of corners) {
    if (track.inGap(c.u) || Math.abs(track.delta(c.u, track.startU)) < 30) continue;
    for (let du = -14; du <= 14; du += 1.1) {
      track.frame(c.u + du, f);
      const flat = new THREE.Vector3(f.side.x, 0, f.side.z).normalize();
      const base = f.pos.clone().addScaledVector(flat, (WALL - 0.9) * c.s);
      for (let row = 0; row < 3; row++) {
        const p = base.clone();
        p.y = Math.max(f.pos.y, 0) + 0.2 + row * 0.38;
        spots.push(new THREE.Matrix4().compose(p, q, sc));
        // Mostly black tyres, every few a red or white one, like real barriers.
        const band = Math.floor((du + 14) / 3.3) % 3;
        cols.push(new THREE.Color(row === 2 && band === 0 ? "#e8384f" : row === 2 && band === 1 ? "#f4f6fb" : "#1c1d24"));
      }
    }
  }
  if (spots.length) {
    const im = new THREE.InstancedMesh(tyre, new THREE.MeshStandardMaterial({ roughness: 0.85 }), spots.length);
    spots.forEach((m, i) => { im.setMatrixAt(i, m); im.setColorAt(i, cols[i]); });
    im.castShadow = true;
    im.receiveShadow = true;
    im.computeBoundingSphere();
    scene.add(im);
  }
  // Marshal posts just before each corner: a little booth, a light and a flag.
  const booth = M.plastic("#f4f6fb", 0.5);
  const roof = M.plastic("#e8384f", 0.4);
  const flag = M.cloth("#ffd21f");
  corners.forEach((c, i) => {
    if (track.inGap(c.u - 22)) return;
    track.frame(c.u - 22, f);
    const flat = new THREE.Vector3(f.side.x, 0, f.side.z).normalize();
    const pos = f.pos.clone().addScaledVector(flat, (WALL + 2.4) * -c.s);
    const g = new THREE.Group();
    g.position.set(pos.x, Math.max(0, f.pos.y - 0.2), pos.z);
    g.rotation.y = Math.atan2(flat.x * -c.s, flat.z * -c.s) + Math.PI;
    M.add(g, M.rbox(1.6, 2.2, 1.4, 0.12), booth, 0, 1.1, 0);
    M.add(g, M.rbox(1.9, 0.18, 1.7, 0.06), roof, 0, 2.3, 0);
    M.add(g, new THREE.BoxGeometry(1.2, 0.7, 0.05), new THREE.MeshBasicMaterial({ color: hot("#ffe2a8", 1.4), toneMapped: false }), 0, 1.4, -0.71, false);
    M.add(g, M.cyl(0.03, 0.03, 1.8, 6), M.plastic("#2a2f45", 0.4), 0.95, 2.6, -0.3);
    const fl = M.add(g, new THREE.PlaneGeometry(0.8, 0.5), flag, 1.35, 3.2, -0.3);
    fl.rotation.y = (i % 2 ? 0.3 : -0.3);
    const lamp = new THREE.Mesh(M.sphere(0.14, 10, 8), new THREE.MeshBasicMaterial({ color: hot("#ffb31c", 2.6), toneMapped: false }));
    lamp.position.set(-0.5, 2.55, 0);
    g.add(lamp);
    scene.add(keep(g));
  });
}
