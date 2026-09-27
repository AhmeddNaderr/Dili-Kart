import * as THREE from "three";
import type { Track } from "./track";
import { newFrame } from "./track";

/**
 * Things along the edge of the circuit: backlit billboards (the ad slots
 * and Dlicom promos) and dusk street lamps that throw warm pools of light
 * onto the road.
 */

export interface BoardSpec {
  u: number;
  side: 1 | -1;
  kind: "ad" | "app" | "tge" | "keys";
  accent: string;
}

const W = 1024, H = 512;

function canvas() {
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  return [c, c.getContext("2d")!] as const;
}

function rr(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** Dlicom-style backdrop: near-black, blue light stripes, a coloured glow. */
function backdrop(g: CanvasRenderingContext2D, glow: string) {
  g.fillStyle = "#05060d";
  g.fillRect(0, 0, W, H);
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, W * 0.8);
  gr.addColorStop(0, glow);
  gr.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, W, H);
  g.globalAlpha = 0.35;
  for (let x = 0; x < W; x += 22) {
    g.fillStyle = x % 44 ? "#3d63ff" : "#6b8cff";
    g.fillRect(x, 0, 2, H * 0.6);
  }
  g.globalAlpha = 1;
  const fade = g.createLinearGradient(0, H * 0.2, 0, H * 0.65);
  fade.addColorStop(0, "rgba(5,6,13,0)");
  fade.addColorStop(1, "rgba(5,6,13,1)");
  g.fillStyle = fade;
  g.fillRect(0, 0, W, H);
}

function logoMark(g: CanvasRenderingContext2D, x: number, y: number, s: number, color: string) {
  g.save();
  g.translate(x, y);
  g.scale(s / 100, s / 100);
  g.fillStyle = color;
  const p1 = new Path2D("M22 44C18 24 36 13 58 13L97 6 63 27C50 26 42 30 39 38Z");
  const p2 = new Path2D("M78 36C82 56 64 67 42 67L3 74 37 53C50 54 58 50 61 42Z");
  g.fill(p1);
  g.fill(p2);
  g.strokeStyle = color;
  g.lineWidth = 5;
  g.lineJoin = "round";
  g.stroke(new Path2D("M50 28 62 40 50 52 38 40Z"));
  g.restore();
}

/** Artwork for each billboard kind. */
export function boardTexture(kind: BoardSpec["kind"], accent: string) {
  const [c, g] = canvas();
  const font = (w: number, size: number, italic = false) => `${italic ? "italic " : ""}${w} ${size}px 'Inter', 'Arial Black', sans-serif`;
  g.textBaseline = "alphabetic";
  if (kind === "ad") {
    backdrop(g, "rgba(255,200,40,.45)");
    // Speech bubble headline, like the Dlicom posts.
    g.fillStyle = "#ffd84a";
    rr(g, 60, 70, 640, 150, 60);
    g.fill();
    g.beginPath();
    g.moveTo(120, 205); g.lineTo(100, 262); g.lineTo(190, 212);
    g.fill();
    g.fillStyle = "#0b0c14";
    g.font = font(900, 76);
    g.fillText("YOUR AD HERE", 100, 172);
    g.fillStyle = "#ffffff";
    g.font = font(800, 44);
    g.fillText("Put your ad or post in Dili Cart", 64, 330);
    g.fillStyle = "rgba(255,255,255,.7)";
    g.font = font(700, 36);
    g.fillText("DM @00xmado on X for details", 64, 392);
    // Price roundel.
    g.fillStyle = accent;
    g.beginPath();
    g.arc(870, 190, 118, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#ffffff";
    g.font = font(900, 136, true);
    g.textAlign = "center";
    g.fillText("$5", 866, 236);
    g.textAlign = "left";
    logoMark(g, 64, 430, 70, "#ffffff");
    g.fillStyle = "#ffffff";
    g.font = font(900, 34);
    g.fillText("Dili Cart", 150, 480);
  } else if (kind === "app") {
    backdrop(g, "rgba(61,99,255,.55)");
    logoMark(g, 64, 70, 140, "#ffffff");
    g.fillStyle = "#ffffff";
    g.font = font(900, 110);
    g.fillText("DLICOM", 230, 170);
    g.font = font(900, 64);
    g.fillText("One app for your", 64, 300);
    g.fillStyle = "#ffd84a";
    g.fillText("whole crypto life.", 64, 372);
    g.fillStyle = "rgba(255,255,255,.72)";
    g.font = font(700, 32);
    g.fillText("Messages · Feed · DliClips · Communities · Wallet", 64, 450);
  } else if (kind === "tge") {
    backdrop(g, "rgba(255,200,40,.5)");
    g.fillStyle = "#ffd84a";
    rr(g, 64, 64, 330, 110, 44);
    g.fill();
    g.fillStyle = "#0b0c14";
    g.font = font(900, 64);
    g.fillText("$DLI TGE", 92, 140);
    g.fillStyle = "#ffffff";
    g.font = font(900, 190, true);
    g.fillText("2027", 60, 380);
    g.fillStyle = "rgba(255,255,255,.72)";
    g.font = font(700, 34);
    g.fillText("Token generation event scheduled for 2027.", 64, 440);
    g.fillText("Follow @DlicomApp for the date.", 64, 484);
    logoMark(g, 800, 90, 150, "#ffffff");
  } else {
    backdrop(g, "rgba(228,71,210,.45)");
    g.fillStyle = "#ffffff";
    g.font = font(900, 100);
    g.fillText("Hold your", 64, 190);
    g.fillStyle = "#ffd84a";
    g.fillText("own keys.", 64, 300);
    g.fillStyle = "rgba(255,255,255,.72)";
    g.font = font(700, 36);
    g.fillText("You sign. Nobody signs for you.", 64, 380);
    g.fillText("That's Dlicom.", 64, 430);
    logoMark(g, 790, 150, 170, "#ffffff");
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/**
 * Billboards on two legs just outside the wall, angled toward oncoming
 * karts. The screen is self-lit so it glows at dusk.
 */
export function billboards(scene: THREE.Scene, track: Track, specs: BoardSpec[], wall: number, keep: (o: THREE.Object3D) => void) {
  const f = newFrame();
  const frameMat = new THREE.MeshStandardMaterial({ color: "#1b1e2c", roughness: 0.45, metalness: 0.5 });
  const legMat = new THREE.MeshStandardMaterial({ color: "#c9cfdf", roughness: 0.4, metalness: 0.7 });
  const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color("#fff2c4").multiplyScalar(2.5), toneMapped: false });
  // Boards share artwork (and GPU memory) when kind and colour match.
  const art = new Map<string, THREE.Material>();
  const face = (kind: BoardSpec["kind"], accent: string) => {
    const key = kind + accent;
    let m = art.get(key);
    if (!m) {
      const tex = boardTexture(kind, accent);
      m = new THREE.MeshStandardMaterial({ map: tex, emissive: "#ffffff", emissiveMap: tex, emissiveIntensity: 0.85, roughness: 0.35 });
      art.set(key, m);
    }
    return m;
  };
  specs.forEach((b, idx) => {
    track.frame(b.u, f);
    const flat = new THREE.Vector3(f.side.x, 0, f.side.z).normalize();
    const base = f.pos.clone().addScaledVector(flat, (wall + 9) * b.side);
    const roadY = Math.max(0, f.pos.y);
    const g = new THREE.Group();
    g.position.set(base.x, 0, base.z);
    // Face back down the track toward oncoming karts, turned in toward the road.
    const back = Math.atan2(-f.tan.x, -f.tan.z);
    g.rotation.y = back + 0.62 * b.side;
    scene.add(g);
    const w = 15, h = 7.5, cy = roadY + 7.5;
    const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 0.8, h + 0.8, 0.6), frameMat);
    frame.position.y = cy;
    frame.castShadow = true;
    g.add(frame);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(w, h), face(b.kind, b.accent));
    screen.position.set(0, cy, 0.31);
    g.add(screen);
    // Double-sided: the back carries the next board's artwork, so karts on
    // the far side of the circuit see an ad rather than a dark panel.
    const next = specs[(idx + 1) % specs.length];
    const rear = new THREE.Mesh(new THREE.PlaneGeometry(w, h), face(next.kind, next.accent));
    rear.position.set(0, cy, -0.31);
    rear.rotation.y = Math.PI;
    g.add(rear);
    for (const s of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, cy - h / 2 + 0.4, 10), legMat);
      leg.position.set(s * w * 0.3, (cy - h / 2 + 0.4) / 2, -0.2);
      leg.castShadow = true;
      g.add(leg);
    }
    // Two little spotlights on arms above the screen.
    for (const s of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 1.4), legMat);
      arm.position.set(s * w * 0.28, cy + h / 2 + 0.6, 0.6);
      g.add(arm);
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.3, 0.4), lampMat);
      lamp.position.set(s * w * 0.28, cy + h / 2 + 0.5, 1.25);
      g.add(lamp);
    }
    keep(g);
  });
}

/**
 * Street lamps behind the walls, leaning out over the road, each throwing a
 * warm pool of light onto the tarmac below.
 */
export function streetLamps(scene: THREE.Scene, track: Track, every: number, wall: number, roadHalf: number, keep: (o: THREE.Object3D) => void, skip: (u: number) => boolean, poolOpacity = 0.32) {
  const f = newFrame();
  const pole = new THREE.MeshStandardMaterial({ color: "#2a2f45", roughness: 0.4, metalness: 0.6 });
  const head = new THREE.MeshBasicMaterial({ color: new THREE.Color("#ffe3a3").multiplyScalar(2.2), toneMapped: false });
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  let quad = 0;
  let side = 1;
  for (let u = 10; u < track.length; u += every) {
    side = -side;
    if (skip(u)) continue;
    track.frame(u, f);
    const flat = new THREE.Vector3(f.side.x, 0, f.side.z).normalize();
    const roadY = f.pos.y;
    const base = f.pos.clone().addScaledVector(flat, (wall + 1.6) * side);
    const g = new THREE.Group();
    g.position.set(base.x, Math.max(0, roadY - 1.5), base.z);
    g.rotation.y = Math.atan2(flat.x * side, flat.z * side);
    scene.add(g);
    const height = roadY - g.position.y + 8;
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, height, 8), pole);
    p.position.y = height / 2;
    p.castShadow = true;
    g.add(p);
    // The arm reaches back toward the road (local −Z after the rotation).
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 3.2), pole);
    arm.position.set(0, height - 0.1, -1.5);
    g.add(arm);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.22, 1.1), head);
    lamp.position.set(0, height - 0.28, -2.9);
    g.add(lamp);
    keep(g);

    // Light pool on the road under the lamp.
    // Centred just inside the road edge, so the pool stays round rather than
    // being squashed against the curb.
    const cLat = Math.min(wall - 3.5, roadHalf - 1.5) * side;
    const r = 6.5;
    for (const [du, dl, su, sv] of [[-r, -r, 0, 0], [r, -r, 1, 0], [r, r, 1, 1], [-r, r, 0, 1]] as const) {
      const q = track.point(u + du, cLat + dl, 0.05);
      pos.push(q.x, q.y, q.z);
      uv.push(su, sv);
    }
    const k = quad * 4;
    idx.push(k, k + 1, k + 2, k, k + 2, k + 3);
    quad++;
  }
  const pg = new THREE.BufferGeometry();
  pg.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  pg.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  pg.setIndex(idx);
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g2 = c.getContext("2d")!;
  const gr = g2.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, "rgba(255,210,140,1)");
  gr.addColorStop(0.5, "rgba(255,180,110,.35)");
  gr.addColorStop(1, "rgba(255,160,90,0)");
  g2.fillStyle = gr;
  g2.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  const pools = new THREE.Mesh(pg, new THREE.MeshBasicMaterial({
    map: t, transparent: true, opacity: poolOpacity, blending: THREE.AdditiveBlending, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -4, side: THREE.DoubleSide,
  }));
  pools.renderOrder = 1;
  scene.add(pools);
}
