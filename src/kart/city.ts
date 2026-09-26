import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { boardTexture } from "./trackside";
import { portrait } from "../ui/icons";

/**
 * Dlicom City at dusk, standing around the stadium: slab towers with
 * setbacks, round towers wrapped in scrolling LED tickers, spires with
 * blinking antennas, twin towers joined by a sky bridge. Rooftop
 * billboards, facade screens showing Dili, neon edges, and searchlights
 * sweeping the sky.
 *
 * Everything that glows ignores fog so it reads from 800 m away; the tower
 * bodies are dark silhouettes against the sunset.
 */

export interface City {
  group: THREE.Group;
  update(t: number): void;
}

const ACCENTS = ["#4f7bff", "#ff4fb4", "#ffc84a", "#2ee6c9"];
const TILE = 64;
const BEACON_ON = new THREE.Color("#ff2d55").multiplyScalar(3);
const BEACON_OFF = new THREE.Color("#ff2d55").multiplyScalar(0.25);

export function buildCity(center: THREE.Vector3): City {
  const group = new THREE.Group();
  const rnd = mulberry(20270925);

  const office = windowTexture("office");
  const glass = windowTexture("glass");
  const officeMat = new THREE.MeshStandardMaterial({
    color: "#1a1d3c", roughness: 0.6, metalness: 0.3,
    map: office, emissive: "#ffffff", emissiveMap: office, emissiveIntensity: 1.1, fog: false,
  });
  const glassMat = new THREE.MeshStandardMaterial({
    color: "#1b2a5c", roughness: 0.25, metalness: 0.6,
    map: glass, emissive: "#ffffff", emissiveMap: glass, emissiveIntensity: 1.1, fog: false,
  });
  const roofMat = new THREE.MeshStandardMaterial({ color: "#1a1d36", roughness: 0.7, fog: false });

  const bodiesOffice: THREE.BufferGeometry[] = [];
  const bodiesGlass: THREE.BufferGeometry[] = [];
  let bodies = bodiesOffice;
  const roofs: THREE.BufferGeometry[] = [];
  const neon: THREE.BufferGeometry[][] = ACCENTS.map(() => []);
  const beaconSpots: THREE.Vector3[] = [];
  const tops: { pos: THREE.Vector3; face: number; h: number; w: number; d: number }[] = [];
  const tickers: { pos: THREE.Vector3; r: number; y: number; h: number }[] = [];

  /** Rooftop plant: AC units, a water tank or two, a helipad on the big ones. */
  const clutter = (x: number, y: number, z: number, rot: number, w: number, d: number, big: boolean) => {
    const c = Math.cos(rot), s = Math.sin(rot);
    const at = (lx: number, lz: number) => [x + lx * c + lz * s, z - lx * s + lz * c];
    const n = big ? 5 : 3;
    for (let k = 0; k < n; k++) {
      const lx = (rnd() - 0.5) * w * 0.7, lz = (rnd() - 0.5) * d * 0.7;
      const [px, pz] = at(lx, lz);
      if (rnd() < 0.35) {
        roofs.push(new THREE.CylinderGeometry(2.6, 2.6, 6, 10).translate(px, y + 3, pz));
        roofs.push(new THREE.ConeGeometry(2.8, 2, 10).translate(px, y + 7, pz));
      } else {
        const bw = 4 + rnd() * 6, bh = 2 + rnd() * 3;
        roofs.push(new THREE.BoxGeometry(bw, bh, bw * 0.7).rotateY(rot).translate(px, y + bh / 2, pz));
      }
    }
    if (big && rnd() < 0.5) {
      const [px, pz] = at(-w * 0.18, d * 0.12);
      const pad = new THREE.CylinderGeometry(9, 9, 0.6, 24).translate(px, y + 0.4, pz);
      neon[3].push(new THREE.TorusGeometry(8.4, 0.5, 4, 32).rotateX(Math.PI / 2).translate(px, y + 0.8, pz));
      roofs.push(pad);
    }
  };

  /**
   * A box with window UVs in metres (one texture tile = 64 m, 16 floors), and
   * a random offset per tower so no two facades light up alike.
   */
  let uvOff = [0, 0];
  const block = (w: number, h: number, d: number, x: number, y: number, z: number, rot: number) => {
    const g = new THREE.BoxGeometry(w, h, d);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    const n = g.attributes.normal as THREE.BufferAttribute;
    const floor0 = (y - h / 2) / TILE;
    for (let k = 0; k < uv.count; k++) {
      const side = Math.abs(n.getX(k)) > 0.5 ? d : w;
      uv.setXY(k, uv.getX(k) * side / TILE + uvOff[0], floor0 + uv.getY(k) * h / TILE + uvOff[1]);
    }
    g.rotateY(rot);
    g.translate(x, y, z);
    return g;
  };

  /** Glowing vertical lines up a block's four corners, and a crown band. */
  const trim = (w: number, h: number, d: number, x: number, y0: number, z: number, rot: number, acc: number) => {
    const c = Math.cos(rot), s = Math.sin(rot);
    for (const [dx, dz] of [[w / 2, d / 2], [-w / 2, d / 2], [w / 2, -d / 2], [-w / 2, -d / 2]]) {
      const line = new THREE.BoxGeometry(2.2, h, 2.2);
      line.translate(x + dx * c + dz * s, y0 + h / 2, z - dx * s + dz * c);
      neon[acc].push(line);
    }
    const band = new THREE.BoxGeometry(w + 1.6, 2.4, d + 1.6);
    band.rotateY(rot);
    band.translate(x, y0 + h - 5, z);
    neon[acc].push(band);
  };

  const N = 46;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 + (rnd() - 0.5) * 0.05;
    const ring = i % 3 === 0 ? 860 : 740;
    const r = ring + rnd() * 90;
    const x = center.x + Math.cos(a) * r, z = center.z + Math.sin(a) * r;
    const face = Math.atan2(center.x - x, center.z - z);   // turn toward the stadium
    const kind = i % 7 === 3 ? "cyl" : i % 7 === 5 ? "spire" : i % 11 === 2 ? "twin" : i % 4 === 1 ? "tiered" : "slab";
    const acc = i % ACCENTS.length;
    const H = 170 + rnd() * 150 + (i % 9 === 0 ? 90 : 0);
    bodies = kind === "cyl" || i % 3 === 1 ? bodiesGlass : bodiesOffice;
    uvOff = [Math.floor(rnd() * 16) / 16, Math.floor(rnd() * 16) / 16];

    if (kind === "slab") {
      const w = 48 + rnd() * 24, d = 34 + rnd() * 16;
      const h1 = H * (0.62 + rnd() * 0.1);
      bodies.push(block(w, h1, d, x, h1 / 2, z, face));
      trim(w, h1, d, x, 0, z, face, acc);
      const w2 = w * 0.72, d2 = d * 0.78, h2 = H - h1;
      bodies.push(block(w2, h2, d2, x, h1 + h2 / 2, z, face));
      trim(w2, h2, d2, x, h1, z, face, acc);
      roofs.push(new THREE.BoxGeometry(w2 + 2, 3, d2 + 2).rotateY(face).translate(x, H + 1.5, z));
      roofs.push(new THREE.BoxGeometry(w + 2, 2.5, d + 2).rotateY(face).translate(x, h1 + 1.2, z));
      clutter(x, H + 3, z, face, w2, d2, true);
      clutter(x, h1 + 2.5, z, face, w, d, false);
      tops.push({ pos: new THREE.Vector3(x, H + 3, z), face, h: H, w: w2, d });
      beaconSpots.push(new THREE.Vector3(x, H + 3.5, z));
    } else if (kind === "cyl") {
      const rad = 22 + rnd() * 8;
      const g = new THREE.CylinderGeometry(rad, rad * 1.05, H, 24, 1, false);
      const uv = g.attributes.uv as THREE.BufferAttribute;
      for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * (Math.PI * 2 * rad) / 40, uv.getY(k) * H / 40);
      g.translate(x, H / 2, z);
      bodies.push(g);
      roofs.push(new THREE.CylinderGeometry(rad * 0.8, rad, 6, 24).translate(x, H + 3, z));
      tickers.push({ pos: new THREE.Vector3(x, 0, z), r: rad + 0.6, y: H - 18, h: H });
      // Vertical LED ribs.
      for (let k = 0; k < 8; k++) {
        const ang = (k / 8) * Math.PI * 2;
        const rib = new THREE.BoxGeometry(1.8, H - 30, 1.8);
        rib.translate(x + Math.sin(ang) * (rad + 0.4), (H - 30) / 2, z + Math.cos(ang) * (rad + 0.4));
        neon[acc].push(rib);
      }
      beaconSpots.push(new THREE.Vector3(x, H + 7, z));
    } else if (kind === "tiered") {
      // Three setbacks and a lit crown, art-deco style.
      let w = 50 + rnd() * 14, d = 42 + rnd() * 10, y0 = 0;
      for (const f of [0.5, 0.3, 0.2]) {
        const h = H * f;
        bodies.push(block(w, h, d, x, y0 + h / 2, z, face));
        trim(w, h, d, x, y0, z, face, acc);
        roofs.push(new THREE.BoxGeometry(w + 2, 2.5, d + 2).rotateY(face).translate(x, y0 + h + 1.2, z));
        y0 += h;
        w *= 0.74; d *= 0.74;
      }
      clutter(x, H + 2.5, z, face, w * 1.3, d * 1.3, false);
      roofs.push(new THREE.CylinderGeometry(0.6, 1.4, 36, 6).translate(x, H + 20, z));
      beaconSpots.push(new THREE.Vector3(x, H + 39, z));
    } else if (kind === "spire") {
      const w = 40 + rnd() * 12;
      bodies.push(block(w, H, w, x, H / 2, z, face));
      trim(w, H, w, x, 0, z, face, acc);
      roofs.push(new THREE.ConeGeometry(w * 0.72, 40, 4).rotateY(face + Math.PI / 4).translate(x, H + 20, z));
      roofs.push(new THREE.CylinderGeometry(0.8, 1.2, 50, 6).translate(x, H + 65, z));
      beaconSpots.push(new THREE.Vector3(x, H + 91, z));
    } else {
      const w = 34, d = 34, gap = 30;
      const ox = Math.cos(face) * gap, oz = -Math.sin(face) * gap;
      for (const s of [-1, 1]) {
        const hh = H * (s < 0 ? 1 : 0.9);
        bodies.push(block(w, hh, d, x + ox * s, hh / 2, z + oz * s, face));
        trim(w, hh, d, x + ox * s, 0, z + oz * s, face, acc);
        beaconSpots.push(new THREE.Vector3(x + ox * s, hh + 2, z + oz * s));
        roofs.push(new THREE.BoxGeometry(w + 2, 3, d + 2).rotateY(face).translate(x + ox * s, hh + 1.5, z + oz * s));
        clutter(x + ox * s, hh + 3, z + oz * s, face, w, d, false);
      }
      bodies.push(block(gap * 2 - w, 10, 14, x, H * 0.62, z, face));
    }
  }

  const merge = (list: THREE.BufferGeometry[]) => {
    const m = mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)));
    list.forEach((g) => g.dispose());
    return m!;
  };
  group.add(new THREE.Mesh(merge(bodiesOffice), officeMat));
  group.add(new THREE.Mesh(merge(bodiesGlass), glassMat));
  group.add(new THREE.Mesh(merge(roofs), roofMat));
  neon.forEach((list, k) => {
    if (!list.length) return;
    group.add(new THREE.Mesh(merge(list), new THREE.MeshBasicMaterial({
      color: new THREE.Color(ACCENTS[k]).multiplyScalar(2.2), toneMapped: false, fog: false,
    })));
  });

  // Rooftop billboards on the tallest slabs, facing the stadium.
  const kinds: ("ad" | "app" | "tge" | "keys" | "cart")[] = ["cart", "ad", "app", "tge", "ad", "keys", "cart", "ad"];
  const frameMat = new THREE.MeshStandardMaterial({ color: "#0d0f1f", roughness: 0.5, fog: false });
  tops.sort((p, q) => q.h - p.h).slice(0, kinds.length).forEach((t, i) => {
    const k = kinds[i];
    const tex = k === "cart" ? cartLogoTexture() : boardTexture(k, ACCENTS[i % ACCENTS.length]);
    const w = Math.min(96, t.w * 1.6), hgt = w / 2;
    const g = new THREE.Group();
    g.position.copy(t.pos);
    g.rotation.y = t.face;
    const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 3, hgt + 3, 2), frameMat);
    frame.position.y = hgt / 2 + 14;
    g.add(frame);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(w, hgt), new THREE.MeshBasicMaterial({ map: tex, fog: false }));
    screen.position.set(0, hgt / 2 + 14, 1.05);
    g.add(screen);
    for (const s of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(2, 14, 2), frameMat);
      leg.position.set(s * w * 0.3, 7, 0);
      g.add(leg);
    }
    group.add(g);
  });

  // Facade screens with Dili, on three towers facing the track.
  const facade = facadeTexture();
  tops.slice(0, 12).filter((_, i) => i % 4 === 1).forEach((t) => {
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(30, 60), new THREE.MeshBasicMaterial({ map: facade, fog: false }));
    const fwd = new THREE.Vector3(Math.sin(t.face), 0, Math.cos(t.face));
    scr.position.copy(t.pos).addScaledVector(fwd, t.d / 2 + 1.4);
    scr.position.y = t.h * 0.42;
    scr.rotation.y = t.face;
    group.add(scr);
  });

  // Scrolling LED ticker bands around the round towers.
  const tickerTex = tickerTexture();
  for (const tk of tickers) {
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(tk.r, tk.r, 12, 32, 1, true),
      new THREE.MeshBasicMaterial({ map: tickerTex, fog: false, side: THREE.DoubleSide }),
    );
    band.position.set(tk.pos.x, tk.y, tk.pos.z);
    group.add(band);
  }

  // Antenna beacons, in two groups that blink out of step.
  const beaconA = new THREE.MeshBasicMaterial({ color: BEACON_ON.clone(), toneMapped: false, fog: false });
  const beaconB = beaconA.clone();
  const bGeo = new THREE.SphereGeometry(2.6, 10, 8);
  beaconSpots.forEach((p, i) => {
    const m = new THREE.Mesh(bGeo, i % 2 ? beaconA : beaconB);
    m.position.copy(p);
    group.add(m);
  });

  // Searchlights sweeping the sky from behind the skyline: soft cones that
  // fade with height and glow brightest where you look through their core.
  const beams: { m: THREE.Mesh; phase: number }[] = [];
  const beamGeo = new THREE.CylinderGeometry(52, 3, 1200, 24, 1, true).translate(0, 600, 0);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.4;
    const cone = new THREE.Mesh(beamGeo, beamMaterial(i % 2 ? "#a9c8ff" : "#ffe2a0"));
    cone.position.set(center.x + Math.cos(a) * 960, 0, center.z + Math.sin(a) * 960);
    cone.renderOrder = 2;
    group.add(cone);
    beams.push({ m: cone, phase: i * 1.7 });
  }

  // A giant golden Dlicom diamond turning above the tallest round tower.
  const crown = tickers.sort((p, q) => q.h - p.h)[0];
  const diamond = new THREE.Group();
  if (crown) {
    diamond.position.set(crown.pos.x, crown.h + 46, crown.pos.z);
    const gem = new THREE.Mesh(
      new THREE.OctahedronGeometry(16, 0).scale(1, 1.45, 1),
      new THREE.MeshStandardMaterial({
        color: "#ffd24a", emissive: "#ffb000", emissiveIntensity: 0.9, metalness: 0.8, roughness: 0.25,
        flatShading: true, fog: false,
      }),
    );
    diamond.add(gem);
    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(26, 1.1, 6, 48).rotateX(Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: new THREE.Color("#ffd24a").multiplyScalar(2.4), toneMapped: false, fog: false }),
    );
    diamond.add(halo);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(1, 2.5, 34, 8), roofMat);
    mast.position.y = -30;
    diamond.add(mast);
    group.add(diamond);
  }

  // The Dlicom blimp, circling the stadium with an LED banner on each side.
  const blimp = buildBlimp();
  group.add(blimp.group);

  // City streets under the towers, glowing orange at dusk.
  const street = streetTexture();
  const ground = new THREE.Mesh(
    (() => {
      const g = new THREE.RingGeometry(560, 2300, 96, 4).rotateX(-Math.PI / 2);
      const pos = g.attributes.position as THREE.BufferAttribute;
      const uv = g.attributes.uv as THREE.BufferAttribute;
      for (let k = 0; k < pos.count; k++) uv.setXY(k, pos.getX(k) / 160, pos.getZ(k) / 160);
      g.translate(center.x, 0.9, center.z);
      return g;
    })(),
    new THREE.MeshLambertMaterial({
      color: "#23253d", map: street, emissive: "#ffffff", emissiveMap: street, emissiveIntensity: 0.55,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    }),
  );
  group.add(ground);

  return {
    group,
    update(t: number) {
      tickerTex.offset.x = -(t * 0.035) % 1;
      const blink = Math.sin(t * 3) > 0;
      beaconA.color.copy(blink ? BEACON_ON : BEACON_OFF);
      beaconB.color.copy(blink ? BEACON_OFF : BEACON_ON);
      for (const b of beams) {
        b.m.rotation.z = Math.sin(t * 0.21 + b.phase) * 0.42;
        b.m.rotation.x = Math.cos(t * 0.16 + b.phase) * 0.28;
      }
      diamond.rotation.y = t * 0.6;
      diamond.children[0]?.position.set(0, Math.sin(t * 1.3) * 3, 0);
      blimp.update(t, center);
    },
  };
}

function beamMaterial(color: string) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: 0.3 } },
    vertexShader: `
      varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main() {
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vN = normalize(mat3(modelMatrix) * normal);
        vV = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uOpacity;
      varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main() {
        float core = pow(abs(dot(normalize(vN), normalize(vV))), 2.5);
        float fade = pow(1.0 - vUv.y, 1.6);
        gl_FragColor = vec4(uColor, core * fade * uOpacity);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}

/** A chunky cartoon airship with the Dlicom colours and scrolling side banners. */
function buildBlimp() {
  const group = new THREE.Group();
  const ship = new THREE.Group();
  group.add(ship);
  const skin = new THREE.MeshStandardMaterial({ color: "#eef1ff", roughness: 0.45, metalness: 0.05 });
  const blue = new THREE.MeshStandardMaterial({ color: "#2f5bff", roughness: 0.4 });
  const hull = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 20).scale(34, 11, 11), skin);
  ship.add(hull);
  const band = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 20, 0, Math.PI * 2, Math.PI * 0.46, Math.PI * 0.08).scale(34.2, 11.2, 11.2), blue);
  ship.add(band);
  // Tail fins in a cross.
  for (let k = 0; k < 4; k++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(9, 8, 0.8), blue);
    fin.geometry.translate(0, 6, 0);
    fin.position.x = -28;
    fin.rotation.x = (k * Math.PI) / 2;
    ship.add(fin);
  }
  const gondola = new THREE.Mesh(new THREE.CapsuleGeometry(2.4, 9, 6, 12).rotateZ(Math.PI / 2), blue);
  gondola.position.set(3, -11.5, 0);
  ship.add(gondola);
  // LED banners on both flanks.
  const tex = blimpBannerTexture();
  const bannerMat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
  for (const phi of [Math.PI / 2, Math.PI * 1.5]) {
    // A patch of a slightly larger ellipsoid, so the banner hugs the hull.
    const geo = new THREE.SphereGeometry(1, 48, 12, phi - 0.62, 1.24, Math.PI / 2 - 0.34, 0.68).scale(34.4, 11.35, 11.35);
    ship.add(new THREE.Mesh(geo, bannerMat));
  }
  // Nav lights.
  const red = new THREE.MeshBasicMaterial({ color: new THREE.Color("#ff2d55").multiplyScalar(3), toneMapped: false });
  const green = new THREE.MeshBasicMaterial({ color: new THREE.Color("#3dff9a").multiplyScalar(3), toneMapped: false });
  const navGeo = new THREE.SphereGeometry(0.9, 8, 6);
  const navA = new THREE.Mesh(navGeo, red); navA.position.set(-32, 10, 0); ship.add(navA);
  const navB = new THREE.Mesh(navGeo, green); navB.position.set(33.5, 0, 0); ship.add(navB);
  return {
    group,
    update(t: number, center: THREE.Vector3) {
      const a = t * 0.028;
      const rx = 380, rz = 460;
      group.position.set(center.x + Math.cos(a) * rx, 150 + Math.sin(t * 0.3) * 4, center.z + Math.sin(a) * rz);
      // Nose along the direction of travel.
      const dx = -Math.sin(a) * rx, dz = Math.cos(a) * rz;
      group.rotation.y = Math.atan2(-dz, dx);
      ship.rotation.z = Math.sin(t * 0.5) * 0.03;
      tex.offset.x = (t * 0.05) % 1;
      navA.visible = Math.sin(t * 4) > 0;
    },
  };
}

/* ------------------------------------------------------------------ */
/* Textures                                                            */
/* ------------------------------------------------------------------ */

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function tex(c: HTMLCanvasElement, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/**
 * Facade at dusk, one tile = 64 m = 16 floors. "office": punched windows lit
 * in runs, as whole departments stay late. "glass": a curtain wall with a
 * faint blue glow and bright cyan/white clusters.
 */
function windowTexture(kind: "office" | "glass") {
  const S = 256, FLOOR = 16;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  const r = mulberry(kind === "office" ? 7 : 11);
  g.fillStyle = "#000";
  g.fillRect(0, 0, S, S);
  const warm = ["#ffcf7a", "#ffd98f", "#ffe7b8", "#ffffff"];
  const cool = ["#8fd0ff", "#bfe6ff", "#ffffff", "#9fb8ff"];
  for (let y = 0; y < S; y += FLOOR) {
    const mood = r();
    const allOn = mood > 0.93, allOff = mood < 0.22;
    let on = r() < 0.4, run = 0;
    let tint = (kind === "office" ? warm : cool)[Math.floor(r() * 4)];
    if (kind === "office") {
      for (let x = 0; x < S; x += 16) {
        if (--run <= 0) { on = r() < 0.42; run = 1 + Math.floor(r() * 6); if (r() < 0.3) tint = warm[Math.floor(r() * 4)]; }
        const lit = allOn || (!allOff && on);
        g.fillStyle = lit ? tint : "#0c0f26";
        g.fillRect(x + 3, y + 4, 10, FLOOR - 7);
        if (lit && r() < 0.25) {   // blinds half down
          g.fillStyle = "#3a2a18";
          g.fillRect(x + 3, y + 4, 10, 3);
        }
      }
    } else {
      g.fillStyle = "#0c1840";
      g.fillRect(0, y + 2, S, FLOOR - 3);
      for (let x = 0; x < S; x += 8) {
        if (--run <= 0) { on = r() < 0.3; run = 2 + Math.floor(r() * 10); if (r() < 0.3) tint = cool[Math.floor(r() * 4)]; }
        if (allOn || (!allOff && on)) {
          g.fillStyle = tint;
          g.globalAlpha = 0.75 + r() * 0.25;
          g.fillRect(x + 1, y + 3, 6, FLOOR - 5);
          g.globalAlpha = 1;
        }
      }
      // Mullions.
      g.fillStyle = "#050818";
      for (let x = 0; x < S; x += 8) g.fillRect(x, y, 1, FLOOR);
    }
    // Floor slab.
    g.fillStyle = kind === "office" ? "#141833" : "#16225a";
    g.fillRect(0, y, S, 2);
  }
  return tex(c);
}

/** "DILI CART" rooftop sign in the game's title style. */
function cartLogoTexture() {
  const W = 1024, H = 512;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d")!;
  g.fillStyle = "#05060d";
  g.fillRect(0, 0, W, H);
  const glow = g.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W * 0.6);
  glow.addColorStop(0, "rgba(61,99,255,.5)");
  glow.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = glow;
  g.fillRect(0, 0, W, H);
  g.textBaseline = "middle";
  g.font = "italic 900 190px 'Inter', 'Arial Black', sans-serif";
  const a = g.measureText("DILI ").width, b = g.measureText("CART").width;
  const x0 = (W - a - b) / 2;
  g.textAlign = "left";
  g.fillStyle = "#ffffff";
  g.fillText("DILI ", x0, H * 0.46);
  const gold = g.createLinearGradient(0, H * 0.25, 0, H * 0.7);
  gold.addColorStop(0, "#fff6c2");
  gold.addColorStop(0.5, "#ffd84a");
  gold.addColorStop(1, "#ffb000");
  g.fillStyle = gold;
  g.fillText("CART", x0 + a, H * 0.46);
  g.textAlign = "center";
  g.font = "700 40px 'Inter', sans-serif";
  g.fillStyle = "rgba(255,255,255,.75)";
  g.fillText("THE DLICOM GRAND PRIX", W / 2, H * 0.84);
  return tex(c, false);
}

/** Tall facade screen: Dili's portrait over the Dlicom wordmark. */
function facadeTexture() {
  const W = 512, H = 1024;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d")!;
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#2a3cd6");
  bg.addColorStop(1, "#0b0f3a");
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  g.fillStyle = "rgba(255,255,255,.06)";
  for (let y = 0; y < H; y += 6) g.fillRect(0, y, W, 2);
  g.textAlign = "center";
  g.fillStyle = "#ffffff";
  g.font = "900 96px 'Inter', 'Arial Black', sans-serif";
  g.fillText("DLICOM", W / 2, H * 0.84);
  g.font = "700 36px 'Inter', sans-serif";
  g.fillStyle = "#ffd84a";
  g.fillText("GO DILI GO!", W / 2, H * 0.92);
  const t = tex(c, false);
  // Draw Dili's portrait once the SVG has decoded.
  const img = new Image();
  img.onload = () => {
    g.drawImage(img, W * 0.08, H * 0.12, W * 0.84, W * 0.84);
    t.needsUpdate = true;
  };
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(
    portrait("#2448f2", "#b3d2ff", "smile").replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" '),
  );
  return t;
}

/** A scrolling LED ticker strip. */
function tickerTexture() {
  const W = 2048, H = 96;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d")!;
  g.fillStyle = "#05060d";
  g.fillRect(0, 0, W, H);
  g.font = "900 58px 'Inter', 'Arial Black', sans-serif";
  g.textBaseline = "middle";
  const items = [["DLICOM", "#ffffff"], ["$DLI TGE 2027", "#ffd84a"], ["DILI CART", "#6fb2ff"], ["YOUR AD $5 · @00xmado", "#ff8fd6"]];
  let x = 20;
  while (x < W) {
    for (const [txt, col] of items) {
      g.fillStyle = col;
      g.fillText(txt, x, H / 2 + 3);
      x += g.measureText(txt).width + 30;
      g.fillStyle = "#3d63ff";
      g.fillText("◆", x, H / 2 + 2);
      x += 70;
    }
  }
  const t = tex(c);
  t.repeat.set(2, 1);
  return t;
}

/** Night streets from above: dark blocks, orange-lit avenues, car lights. */
function streetTexture() {
  const S = 512;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  g.fillStyle = "#000";
  g.fillRect(0, 0, S, S);
  const r = mulberry(99);
  // Lit windows and courtyards dotted over the blocks.
  for (let k = 0; k < 900; k++) {
    g.fillStyle = r() < 0.7 ? "rgba(255,190,110,.35)" : "rgba(150,200,255,.3)";
    g.fillRect(r() * S, r() * S, 2 + r() * 3, 2 + r() * 3);
  }
  // Avenues every 128 px, lanes every 64 px.
  for (let k = 0; k < S; k += 64) {
    const main = k % 128 === 0;
    g.fillStyle = main ? "rgba(255,170,80,.9)" : "rgba(255,170,80,.45)";
    g.fillRect(k, 0, main ? 5 : 3, S);
    g.fillRect(0, k, S, main ? 5 : 3);
    // Car head/tail lights along the avenues.
    for (let q = 0; q < 20; q++) {
      const p = r() * S;
      g.fillStyle = r() < 0.5 ? "#ffffff" : "#ff3b3b";
      g.fillRect(k + 1, p, 2, 3);
      g.fillRect(p, k + 1, 3, 2);
    }
  }
  return tex(c);
}

/** The blimp's side banner: a long scrolling LED strip. */
function blimpBannerTexture() {
  const W = 2048, H = 256;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d")!;
  g.fillStyle = "#070a1c";
  g.fillRect(0, 0, W, H);
  g.textBaseline = "middle";
  const items: [string, string][] = [["DLICOM", "#ffffff"], ["$DLI TGE 2027", "#ffd84a"], ["DILI CART", "#7fb4ff"], ["HOLD YOUR KEYS", "#2ee6c9"]];
  g.font = "italic 900 150px 'Inter', 'Arial Black', sans-serif";
  let x = 30;
  for (const [txt, col] of items) {
    g.fillStyle = col;
    g.fillText(txt, x, H / 2 + 6);
    x += g.measureText(txt).width + 50;
    g.fillStyle = "#3d63ff";
    g.fillText("◆", x, H / 2);
    x += 150;
  }
  // LED dot mask.
  g.fillStyle = "rgba(0,0,0,.35)";
  for (let y = 0; y < H; y += 8) g.fillRect(0, y, W, 3);
  const t = tex(c);
  t.repeat.set(W / x, 1);
  return t;
}
