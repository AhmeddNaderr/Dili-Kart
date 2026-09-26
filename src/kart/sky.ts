import * as THREE from "three";
import { buildCity } from "./city";

/**
 * Dusk over the Dlicom Grand Prix: a graded sky with a low sun and stars
 * coming out overhead, layers of painted clouds, and the lit skyline of
 * Dlicom City peeking over the stadium roof.
 */

export interface Sky {
  dome: THREE.Mesh;
  clouds: THREE.Group;
  skyline: THREE.Group;
  update(t: number): void;
}

export function buildSky(scene: THREE.Scene, sunDir: THREE.Vector3, center: THREE.Vector3): Sky {
  const uTime = { value: 0 };
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(2600, 48, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        uTop: { value: new THREE.Color("#050a26") },
        uMid: { value: new THREE.Color("#23349c") },
        uViolet: { value: new THREE.Color("#8a4fb8") },
        uPink: { value: new THREE.Color("#f07aa8") },
        uHor: { value: new THREE.Color("#ffb45c") },
        uSun: { value: sunDir },
        uTime,
      },
      vertexShader: `varying vec3 vD; void main(){ vD = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.); gl_Position = p.xyww; }`,
      fragmentShader: `
        uniform vec3 uTop, uMid, uViolet, uPink, uHor, uSun; uniform float uTime;
        varying vec3 vD;
        float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        void main(){
          vec3 d = normalize(vD);
          float h = d.y;
          // How much the sun's side of the sky is warmed.
          float sunSide = pow(max(dot(normalize(vec3(d.x, 0.0, d.z)), normalize(vec3(uSun.x, 0.0, uSun.z))), 0.0), 2.0);
          vec3 hor = mix(uPink, uHor, 0.35 + sunSide * 0.65);
          vec3 c = mix(hor, uViolet, smoothstep(0.02, 0.16, h));
          c = mix(c, uMid, smoothstep(0.12, 0.38, h));
          c = mix(c, uTop, smoothstep(0.34, 0.9, h));
          // Sun: a hot disc, a soft glow and a wide warm haze.
          float s = max(dot(d, uSun), 0.0);
          c += vec3(1.0, 0.86, 0.6) * (smoothstep(0.9993, 0.9996, s) * 2.2 + pow(s, 60.0) * 0.55 + pow(s, 8.0) * 0.16);
          // Stars come out overhead, twinkling.
          vec3 cell = floor(d * 380.0);
          float st = hash(cell);
          float star = step(0.9965, st) * smoothstep(0.28, 0.75, h);
          float tw = 0.6 + 0.4 * sin(uTime * (2.0 + st * 5.0) + st * 60.0);
          c += vec3(0.85, 0.9, 1.0) * star * tw * 0.9;
          gl_FragColor = vec4(c, 1.0);
        }`,
    }),
  );
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  scene.add(dome);

  // Painted clouds: soft sprites in two rings, lit pink/gold from the sun side.
  const clouds = new THREE.Group();
  const tex = [0, 1, 2, 3].map((i) => cloudTexture(i));
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + Math.sin(i * 3.1) * 0.12;
    const far = i % 2 === 0;
    const r = far ? 1550 + (i % 5) * 60 : 1080 + (i % 4) * 50;
    const pos = new THREE.Vector3(center.x + Math.cos(a) * r, (far ? 300 : 190) + (i % 3) * 40, center.z + Math.sin(a) * r);
    const toward = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const lit = Math.max(0, toward.dot(new THREE.Vector3(sunDir.x, 0, sunDir.z).normalize()));
    const mat = new THREE.SpriteMaterial({
      map: tex[i % tex.length], transparent: true, depthWrite: false, fog: false,
      color: new THREE.Color().setRGB(1, 0.78 + lit * 0.2, 0.86 - lit * 0.18),
      opacity: far ? 0.75 : 0.95,
    });
    const sp = new THREE.Sprite(mat);
    const w = (far ? 560 : 400) * (0.8 + (i % 4) * 0.2);
    sp.scale.set(w, w * 0.42, 1);
    sp.position.copy(pos);
    clouds.add(sp);
  }
  scene.add(clouds);

  // Dlicom City: detailed towers around the stadium, and a hazy far layer
  // of plain towers behind them for depth.
  const city = buildCity(center);
  const skyline = city.group;
  const windows = windowTexture();
  const farMat = new THREE.MeshLambertMaterial({
    color: "#3a336e", emissive: "#ffffff", emissiveMap: windows, emissiveIntensity: 0.28, fog: false,
  });
  const geos: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2 + Math.sin(i * 7.7) * 0.03;
    const r = 1250 + ((i * 53) % 7) * 30;
    const h = 120 + ((i * 37) % 9) * 24 + (i % 5 === 0 ? 90 : 0);
    const w = 44 + ((i * 17) % 5) * 12;
    const b = new THREE.BoxGeometry(w, h, w * 0.8);
    // Scale UVs so windows keep a constant size whatever the tower's shape.
    const uv = b.attributes.uv as THREE.BufferAttribute;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * w / 24, uv.getY(k) * h / 24);
    b.rotateY(-a);
    b.translate(center.x + Math.cos(a) * r, h / 2 - 2, center.z + Math.sin(a) * r);
    geos.push(b);
  }
  skyline.add(new THREE.Mesh(mergeBoxes(geos), farMat));
  scene.add(skyline);

  return {
    dome, clouds, skyline,
    update(t: number) {
      uTime.value = t;
      clouds.rotation.y = t * 0.003;
      city.update(t);
    },
  };
}

function mergeBoxes(geos: THREE.BufferGeometry[]) {
  const nonIdx = geos.map((g) => g.toNonIndexed());
  let count = 0;
  for (const g of nonIdx) count += g.attributes.position.count;
  const pos = new Float32Array(count * 3), nrm = new Float32Array(count * 3), uv = new Float32Array(count * 2);
  let o = 0;
  for (const g of nonIdx) {
    pos.set(g.attributes.position.array as Float32Array, o * 3);
    nrm.set(g.attributes.normal.array as Float32Array, o * 3);
    uv.set(g.attributes.uv.array as Float32Array, o * 2);
    o += g.attributes.position.count;
    g.dispose();
  }
  geos.forEach((g) => g.dispose());
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
  out.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return out;
}

/** A cumulus painted from many overlapping soft puffs, flat base, lit top. */
function cloudTexture(seed: number) {
  const W = 512, H = 220;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d")!;
  let s = seed * 9301 + 49297;
  const r = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  const base = H * 0.78;
  for (let i = 0; i < 46; i++) {
    const x = W * 0.12 + r() * W * 0.76;
    const peak = 1 - Math.abs(x / W - 0.5) * 1.6;
    const rad = 26 + r() * 46 * Math.max(0.35, peak);
    const y = base - rad * (0.3 + r() * 0.9) * Math.max(0.3, peak);
    const gr = g.createRadialGradient(x - rad * 0.2, y - rad * 0.35, rad * 0.1, x, y, rad);
    gr.addColorStop(0, "rgba(255,255,255,0.95)");
    gr.addColorStop(0.6, "rgba(240,236,255,0.75)");
    gr.addColorStop(1, "rgba(200,190,240,0)");
    g.fillStyle = gr;
    g.beginPath();
    g.arc(x, y, rad, 0, Math.PI * 2);
    g.fill();
  }
  // Cool shadow along the flat underside.
  g.globalCompositeOperation = "source-atop";
  const under = g.createLinearGradient(0, H * 0.35, 0, base);
  under.addColorStop(0, "rgba(120,100,190,0)");
  under.addColorStop(1, "rgba(120,100,190,0.55)");
  g.fillStyle = under;
  g.fillRect(0, 0, W, H);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Office windows: mostly dark, a warm scatter lit up for the evening. */
function windowTexture() {
  const S = 128;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  g.fillStyle = "#000000";
  g.fillRect(0, 0, S, S);
  let s = 7;
  const r = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  for (let y = 4; y < S; y += 16) {
    for (let x = 4; x < S; x += 12) {
      const k = r();
      g.fillStyle = k < 0.22 ? (k < 0.07 ? "#8fd0ff" : "#ffcf7a") : "#0d1026";
      g.fillRect(x, y, 7, 9);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
