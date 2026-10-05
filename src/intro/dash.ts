import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { MASCOT } from "../kart/mascot";

/**
 * The close-up set for the intro film: Dili's dashboard, built at "macro"
 * scale like a vinyl toy. A glowing pixel screen boots up and offers the
 * race modes, a rev gauge sweeps, a big green START button lights, and
 * Dili's glove (with a pointing finger) reaches in to press them.
 *
 * The panel faces +Z; the screen centre is the origin of `root`.
 */

const vinyl = (color: string, rough = 0.38, coat = 0.55) => new THREE.MeshPhysicalMaterial({
  color, roughness: rough, metalness: 0, clearcoat: coat, clearcoatRoughness: 0.25,
  sheen: 0.3, sheenColor: new THREE.Color(color).lerp(new THREE.Color("#ffffff"), 0.4),
});

function roundedRect(w: number, h: number, r: number) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2 + r, -h / 2);
  s.lineTo(w / 2 - r, -h / 2);
  s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  s.lineTo(w / 2, h / 2 - r);
  s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  s.lineTo(-w / 2 + r, h / 2);
  s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  s.lineTo(-w / 2, -h / 2 + r);
  s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  return s;
}

function frameGeo(ow: number, oh: number, or: number, iw: number, ih: number, ir: number, depth: number) {
  const s = roundedRect(ow, oh, or);
  const hole = roundedRect(iw, ih, ir);
  s.holes.push(new THREE.Path(hole.getPoints(48)));
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: 0.035, bevelSize: 0.035, bevelSegments: 5, curveSegments: 24 });
  g.computeVertexNormals();
  return g;
}

/* ------------------------------------------------------------------ */
/* Screen: pixel art painted small, scaled up without smoothing         */
/* ------------------------------------------------------------------ */

const SW = 1024, SH = 556;
const PW = 256, PH = 139;
const CYAN = "#5ff3ff";
const INK = "#061526";

export interface ScreenState {
  /** Seconds into the dashboard shot. */
  t: number;
  /** 0..1 how pressed GRAND PRIX is; 0..1 how pressed START is. */
  pressMode: number;
  pressStart: number;
}

class Screen {
  readonly canvas = document.createElement("canvas");
  readonly tex: THREE.CanvasTexture;
  private small = document.createElement("canvas");
  private g: CanvasRenderingContext2D;
  private s: CanvasRenderingContext2D;

  constructor() {
    this.canvas.width = SW; this.canvas.height = SH;
    this.small.width = PW; this.small.height = PH;
    this.g = this.canvas.getContext("2d")!;
    this.s = this.small.getContext("2d")!;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 8;
  }

  private text(str: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = "left", weight = 900) {
    const s = this.s;
    s.font = `${weight} ${size}px Inter, "Arial Black", sans-serif`;
    s.textAlign = align;
    s.textBaseline = "middle";
    s.fillStyle = color;
    s.fillText(str, x, y);
  }

  draw(st: ScreenState) {
    const { t } = st;
    const s = this.s, g = this.g;
    s.imageSmoothingEnabled = false;
    s.fillStyle = INK;
    s.fillRect(0, 0, PW, PH);

    const on = THREE.MathUtils.clamp((t - 0.3) / 0.3, 0, 1);
    if (on > 0) {
      // Frame lines and little status glyphs, like a cockpit HUD.
      s.fillStyle = CYAN;
      s.globalAlpha = 0.5;
      s.fillRect(16, 12, PW / 2 - 40, 1);
      s.fillRect(PW / 2 + 24, 12, PW / 2 - 40, 1);
      s.fillRect(PW / 2 - 12, 9, 24, 7);
      s.globalAlpha = 1;
      s.fillStyle = INK;
      s.fillRect(PW / 2 - 10, 11, 20, 3);
      s.fillStyle = CYAN;
      for (let i = 0; i < 12; i++) if ((i * 7 + Math.floor(t * 3)) % 5) s.fillRect(22 + i * 8, PH - 16, 5, 1);
      for (let i = 0; i < 9; i++) if ((i * 3 + Math.floor(t * 4)) % 4) s.fillRect(PW - 96 + i * 8, PH - 16, 5, 1);
      s.strokeStyle = CYAN;
      s.strokeRect(PW / 2 - 6.5, PH - 20.5, 13, 9);
    }

    if (t < 1.7) {
      // Boot: the Dlicom mark and the title, with a loading bar.
      const k = THREE.MathUtils.clamp((t - 0.55) / 0.35, 0, 1);
      if (k > 0) {
        s.globalAlpha = k;
        this.text("DLICOM", PW / 2, 34, 10, CYAN, "center", 800);
        this.text("DILI CART", PW / 2, 64, 32, CYAN, "center", 900);
        s.strokeStyle = CYAN;
        s.strokeRect(PW / 2 - 60.5, 90.5, 120, 8);
        const fill = THREE.MathUtils.clamp((t - 0.85) / 0.7, 0, 1);
        s.fillStyle = CYAN;
        s.fillRect(PW / 2 - 58, 93, Math.round(116 * fill), 4);
        s.globalAlpha = 1;
      }
    } else if (t < 3.2) {
      // Mode select.
      this.text("SELECT RACE", PW / 2, 28, 9, CYAN, "center", 800);
      const rows: [string, number][] = [["PRACTICE", 52], ["GRAND PRIX", 86]];
      rows.forEach(([label, y], i) => {
        const hot = i === 1 && st.pressMode > 0.35;
        s.strokeStyle = CYAN;
        s.lineWidth = 1;
        if (hot) {
          s.fillStyle = CYAN;
          s.fillRect(38, y - 13, PW - 76, 26);
          this.text(label, 48, y + 1, 19, INK, "left", 900);
        } else {
          s.strokeRect(38.5, y - 12.5, PW - 77, 25);
          this.text(label, 48, y + 1, 19, i === 0 ? "#dffcff" : CYAN, "left", 900);
        }
      });
      // Side bars, like the reference cockpit menus.
      s.fillStyle = CYAN;
      s.fillRect(26, 40, 3, 60);
      s.fillRect(PW - 29, 40, 3, 60);
    } else {
      // Locked in: the race, then START.
      this.text("GRAND PRIX", PW / 2, 34, 22, CYAN, "center", 900);
      this.text("8 RACERS · 3 LAPS", PW / 2, 58, 10, "#bff8ff", "center", 800);
      if (st.pressStart > 0.3) {
        s.fillStyle = "#53ff8a";
        s.fillRect(PW / 2 - 70, 72, 140, 30);
        this.text("ENGINE ON", PW / 2, 88, 18, INK, "center", 900);
      } else if (Math.floor(t * 4) % 2 === 0) {
        s.strokeStyle = CYAN;
        s.strokeRect(PW / 2 - 69.5, 72.5, 139, 29);
        this.text("PRESS START", PW / 2, 88, 16, CYAN, "center", 900);
      }
    }

    // Upscale with hard pixels, then a soft glow copy and scanlines.
    g.save();
    g.fillStyle = "#020812";
    g.fillRect(0, 0, SW, SH);
    g.imageSmoothingEnabled = false;
    const bright = on;
    g.globalAlpha = bright;
    g.drawImage(this.small, 0, 0, SW, SH);
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = 0.45 * bright;
    g.filter = "blur(7px)";
    g.drawImage(this.small, 0, 0, SW, SH);
    g.filter = "none";
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = 1;
    g.fillStyle = "rgba(0,0,0,.28)";
    for (let y = 0; y < SH; y += SH / PH) g.fillRect(0, Math.round(y + SH / PH * 0.7), SW, 1);
    // Power-on: a bright line that opens into the picture.
    if (t > 0.25 && t < 0.62) {
      const k = (t - 0.25) / 0.37;
      g.fillStyle = `rgba(190,250,255,${1 - k})`;
      const h = Math.max(3, SH * k * k);
      g.fillRect(0, SH / 2 - h / 2, SW, h);
    }
    g.restore();
    this.tex.needsUpdate = true;
  }
}

/** The rev gauge face: dark dial, cyan arcs and ticks. */
function gaugeTex() {
  const S = 512;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(S / 2, S / 2, 20, S / 2, S / 2, S / 2);
  grd.addColorStop(0, "#123a66");
  grd.addColorStop(1, "#071a33");
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  g.translate(S / 2, S / 2);
  const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
  g.lineWidth = 34;
  g.strokeStyle = "#1f6fae";
  g.beginPath(); g.arc(0, 0, 180, a0, a1); g.stroke();
  g.strokeStyle = "#5ff3ff";
  g.beginPath(); g.arc(0, 0, 180, a0, a0 + (a1 - a0) * 0.72); g.stroke();
  g.strokeStyle = "#ff4d6d";
  g.beginPath(); g.arc(0, 0, 180, a0 + (a1 - a0) * 0.82, a1); g.stroke();
  for (let i = 0; i <= 10; i++) {
    const a = a0 + (a1 - a0) * (i / 10);
    g.strokeStyle = "#dffcff";
    g.lineWidth = i % 5 === 0 ? 10 : 5;
    g.beginPath();
    g.moveTo(Math.cos(a) * 128, Math.sin(a) * 128);
    g.lineTo(Math.cos(a) * 150, Math.sin(a) * 150);
    g.stroke();
  }
  g.fillStyle = "#bff8ff";
  g.font = "900 44px Inter, sans-serif";
  g.textAlign = "center";
  g.fillText("RPM", 0, 110);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function labelTex(text: string, fg: string) {
  const c = document.createElement("canvas");
  c.width = 512; c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = fg;
  g.font = "900 84px Inter, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, 256, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ------------------------------------------------------------------ */
/* The set                                                              */
/* ------------------------------------------------------------------ */

export class Dash {
  readonly root = new THREE.Group();
  readonly hand = new THREE.Group();
  /** Where the fingertip should go to press each control (in root space). */
  readonly targets = {
    mode: new THREE.Vector3(0.36, -0.1, 0.25),
    start: new THREE.Vector3(1.28, -0.02, 0.36),
  };
  private screen = new Screen();
  private needle = new THREE.Group();
  private startCap: THREE.Mesh;
  private startMat: THREE.MeshPhysicalMaterial;
  private leds: THREE.MeshStandardMaterial[] = [];

  constructor() {
    const cream = vinyl("#f4efe6", 0.42, 0.5);
    const blue = vinyl(MASCOT.dili.suit, 0.3, 0.8);
    const deep = vinyl("#1d2a66", 0.35, 0.6);

    // Body: a deep rounded slab with a blue hood along the top.
    const panel = new THREE.Mesh(new RoundedBoxGeometry(4.2, 1.5, 0.5, 5, 0.22), cream);
    panel.position.set(0, 0, -0.08);
    this.root.add(panel);
    const hood = new THREE.Mesh(new RoundedBoxGeometry(4.5, 0.34, 0.8, 5, 0.15), blue);
    hood.position.set(0, 0.86, 0.05);
    this.root.add(hood);
    const lip = new THREE.Mesh(new RoundedBoxGeometry(4.3, 0.14, 0.5, 4, 0.06), deep);
    lip.position.set(0, -0.8, 0.12);
    this.root.add(lip);

    // Screen: bezel, glowing picture, glass.
    const bezel = new THREE.Mesh(frameGeo(1.7, 1.02, 0.2, 1.42, 0.78, 0.1, 0.07), blue);
    bezel.position.z = 0.15;
    this.root.add(bezel);
    // Unlit, so the picture stays deep navy with glowing cyan (lights and
    // reflections would wash it out); values over 1 feed the bloom.
    const pic = new THREE.Mesh(new THREE.PlaneGeometry(1.44, 0.8), new THREE.MeshBasicMaterial({
      map: this.screen.tex, color: new THREE.Color(1.5, 1.5, 1.5),
    }));
    // Just proud of the panel's front face (z 0.17), inside the bezel.
    pic.position.z = 0.19;
    this.root.add(pic);

    // Rev gauge on the left.
    const gauge = new THREE.Group();
    gauge.position.set(-1.35, -0.02, 0.18);
    this.root.add(gauge);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.07, 18, 64), blue);
    gauge.add(ring);
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.36, 64), new THREE.MeshStandardMaterial({
      map: gaugeTex(), emissive: "#ffffff", emissiveIntensity: 0.9, roughness: 0.3,
    }));
    face.material.emissiveMap = face.material.map;
    face.position.z = -0.02;
    gauge.add(face);
    this.needle.position.z = 0.01;
    const needleMesh = new THREE.Mesh(new RoundedBoxGeometry(0.035, 0.3, 0.02, 2, 0.01), new THREE.MeshStandardMaterial({
      color: "#ffffff", emissive: "#ffd0d8", emissiveIntensity: 1.4,
    }));
    needleMesh.position.y = 0.13;
    this.needle.add(needleMesh);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 12), blue);
    this.needle.add(cap);
    gauge.add(this.needle);

    // START: a big glossy green button on a dark collar, and its label.
    const btn = new THREE.Group();
    btn.position.set(1.28, -0.02, 0.1);
    this.root.add(btn);
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.4, 0.14, 48).rotateX(Math.PI / 2), vinyl("#2a2f45", 0.4, 0.6));
    collar.position.z = 0.07;
    btn.add(collar);
    this.startMat = new THREE.MeshPhysicalMaterial({
      color: "#29c464", roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.08, emissive: "#1bff6a", emissiveIntensity: 0.03,
    });
    this.startCap = new THREE.Mesh(new THREE.SphereGeometry(0.3, 48, 32).scale(1, 1, 0.5), this.startMat);
    this.startCap.position.z = 0.16;
    btn.add(this.startCap);
    const label = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.115), new THREE.MeshBasicMaterial({ map: labelTex("START", "#1d2a66"), transparent: true }));
    label.position.set(0, -0.5, 0.18);
    btn.add(label);

    // Status lights under the screen.
    ["#ff3d5a", "#ffb31c", "#27ff7a"].forEach((c, i) => {
      const m = new THREE.MeshStandardMaterial({ color: "#222", emissive: c, emissiveIntensity: 0.15, roughness: 0.2 });
      this.leds.push(m);
      const led = new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 12), m);
      led.position.set(-0.16 + i * 0.16, -0.62, 0.2);
      this.root.add(led);
    });

    // The steering wheel's rim, big and soft in the foreground.
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(1.35, 0.15, 24, 96, Math.PI * 0.8), blue);
    wheel.rotation.z = Math.PI * 1.1;
    wheel.position.set(0, -0.2, 1.05);
    this.root.add(wheel);

    this.buildHand();
    this.root.add(this.hand);
    this.root.traverse((o) => { (o as THREE.Mesh).castShadow = true; (o as THREE.Mesh).receiveShadow = true; });
  }

  /** Dili's glove: a mitten with the index finger out. The fingertip is at the origin. */
  private buildHand() {
    const glove = vinyl(MASCOT.dili.glove, 0.45, 0.4);
    const suit = vinyl(MASCOT.dili.suit, 0.45, 0.4);
    const finger = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.24, 8, 16).rotateX(Math.PI / 2), glove);
    finger.position.z = 0.19;
    this.hand.add(finger);
    const palm = new THREE.Mesh(new THREE.SphereGeometry(0.21, 32, 24), glove);
    palm.scale.set(1.05, 0.9, 1.15);
    palm.position.set(0.02, -0.08, 0.5);
    this.hand.add(palm);
    const knuckles = new THREE.Mesh(new THREE.SphereGeometry(0.14, 24, 16), glove);
    knuckles.scale.set(1.1, 0.7, 0.9);
    knuckles.position.set(0.02, -0.19, 0.38);
    this.hand.add(knuckles);
    const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.12, 6, 12), glove);
    thumb.position.set(-0.16, -0.02, 0.42);
    thumb.rotation.set(0.6, 0, 0.7);
    this.hand.add(thumb);
    const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.05, 14, 32), glove);
    cuff.position.set(0.04, -0.1, 0.74);
    this.hand.add(cuff);
    const sleeve = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 1.2, 8, 24).rotateX(Math.PI / 2), suit);
    sleeve.position.set(0.06, -0.12, 1.4);
    this.hand.add(sleeve);
  }

  /**
   * Pose everything for time `t` into the shot. The hand travels between
   * rest (off frame, bottom right), the GRAND PRIX row and the START button.
   */
  update(t: number) {
    const ease = (x: number) => { const k = THREE.MathUtils.clamp(x, 0, 1); return k * k * (3 - 2 * k); };
    const rest = new THREE.Vector3(2.9, -1.6, 1.3);
    const hover = (p: THREE.Vector3) => p.clone().add(new THREE.Vector3(0.18, -0.06, 0.22));
    const P = this.targets;
    let pos: THREE.Vector3;
    let pressMode = 0, pressStart = 0;
    const press = (a: number, b: number) => Math.sin(THREE.MathUtils.clamp((t - a) / (b - a), 0, 1) * Math.PI);
    if (t < 1.6) pos = rest.clone();
    else if (t < 2.5) pos = rest.clone().lerp(hover(P.mode), ease((t - 1.6) / 0.9));
    else if (t < 3.05) {
      const k = press(2.6, 2.95);
      pos = hover(P.mode).lerp(P.mode, k);
      pressMode = t > 2.72 ? 1 : k;
    } else if (t < 3.8) { pos = hover(P.mode).lerp(hover(P.start), ease((t - 3.05) / 0.75)); pressMode = 1; }
    else if (t < 4.3) {
      const k = press(3.85, 4.2);
      pos = hover(P.start).lerp(P.start, k);
      pressMode = 1;
      pressStart = t > 3.97 ? 1 : k;
    } else { pos = hover(P.start).lerp(rest, ease((t - 4.3) / 0.8)); pressMode = 1; pressStart = 1; }
    this.hand.position.copy(pos);
    // The arm comes in from the right and a little below, the finger
    // pointing into the panel at an angle, like pressing a touch screen.
    this.hand.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0.78, -0.3, 0.55).normalize());
    this.hand.rotateZ(-0.5);

    // Button travel and glow.
    const push = t > 3.85 && t < 4.25 ? press(3.85, 4.2) : 0;
    this.startCap.position.z = 0.16 - push * 0.07;
    this.startMat.emissiveIntensity = pressStart > 0 ? 0.9 + Math.sin(t * 12) * 0.12 : 0.05;

    // Gauge: idle flicker, then a rev sweep with overshoot once started.
    const a0 = 2.35, a1 = -2.35;
    let v = 0.08 + Math.sin(t * 9) * 0.01;
    if (t > 3.95) {
      const k = t - 3.95;
      v = 0.82 - 0.5 * Math.exp(-k * 5) * Math.cos(k * 14) + Math.sin(t * 30) * 0.015;
      v = Math.min(0.95, Math.max(0.08, v));
    }
    this.needle.rotation.z = a0 + (a1 - a0) * v;
    this.leds.forEach((m, i) => { m.emissiveIntensity = t > 0.5 + i * 0.15 ? (pressStart > 0 && i === 2 ? 3 : 1.4) : 0.1; });

    this.screen.draw({ t, pressMode, pressStart });
  }
}
