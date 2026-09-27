import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { DILI_LOOK, KartModel, add, coinGeometry, coinMaterials, glow, plastic, rbox, torus, type KartLook } from "../kart/models";
import { MascotModel, type DriverId, type Pose } from "../kart/mascot";
import { blobTex } from "../kart/textures";
import type { CharId } from "../../shared/rules";

/**
 * Small 3D scenes for the menus: the squad line-up on the sign-in screen,
 * the kart turntable in the hub, and Dili posing through the intro. All of
 * them use the real race models, lit like a Dlicom promo render: warm key
 * light, blue rim, glowing platform, dark backdrop.
 */

export interface MenuStage {
  dispose(): void;
  setChar(c: DriverId): void;
  setLook(l: KartLook): void;
  setPose(p: Pose): void;
  /** Intro: a prop that pops in beside Dili for the current line. */
  setProp(p: Prop): void;
  /** Intro: flap the mouth while text is typing. */
  setSpeaking(on: boolean): void;
}

export type Prop = "none" | "phone" | "coin" | "custodian" | "keys" | "kart";

type Mode = { kind: "squad"; chars: CharId[] } | { kind: "kart"; look: KartLook } | { kind: "solo"; char: DriverId };

export function mountStage(host: HTMLElement, mode: Mode, onPoke?: () => void): MenuStage {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.3;
  renderer.shadowMap.enabled = true;
  const cv = renderer.domElement;
  Object.assign(cv.style, { width: "100%", height: "100%", display: "block", touchAction: "pan-y", cursor: mode.kind === "kart" ? "grab" : "pointer" });
  host.appendChild(cv);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.5;
  pmrem.dispose();
  scene.add(new THREE.HemisphereLight("#b9c8ff", "#1a1530", 0.9));
  const key = new THREE.DirectionalLight("#fff3e2", 2.4);
  key.position.set(-4, 8, 7);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.radius = 4;
  Object.assign(key.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6 });
  key.shadow.bias = -0.0005;
  scene.add(key);
  const rim = new THREE.DirectionalLight("#5d86ff", 2.2);
  rim.position.set(6, 5, -6);
  scene.add(rim);
  const rim2 = new THREE.DirectionalLight("#ffc84a", 1.0);
  rim2.position.set(-7, 3, -4);
  scene.add(rim2);

  // Glowing platform.
  const stageR = mode.kind === "squad" ? 3.3 : mode.kind === "kart" ? 2.35 : 2.1;
  const plat = new THREE.Group();
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(stageR, stageR + 0.15, 0.45, 64), new THREE.MeshPhysicalMaterial({
    color: "#171a2b", roughness: 0.35, metalness: 0.4, clearcoat: 0.6,
  }));
  drum.position.y = -0.23;
  drum.receiveShadow = true;
  plat.add(drum);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(stageR + 0.05, 0.035, 8, 96), new THREE.MeshBasicMaterial({ color: new THREE.Color("#4f7bff").multiplyScalar(2.2), toneMapped: false }));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.0;
  plat.add(ring);
  const ring2 = new THREE.Mesh(ring.geometry, new THREE.MeshBasicMaterial({ color: new THREE.Color("#ffc84a").multiplyScalar(1.6), toneMapped: false }));
  ring2.rotation.x = Math.PI / 2;
  ring2.scale.setScalar(0.72);
  ring2.position.y = 0.01;
  plat.add(ring2);
  const top = new THREE.Mesh(new THREE.CircleGeometry(stageR, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: "#1d2136", roughness: 0.6, metalness: 0.2 }));
  top.position.y = 0.005;
  top.receiveShadow = true;
  plat.add(top);
  scene.add(plat);
  if (mode.kind === "kart" || mode.kind === "solo") {
    // Showroom touches: a chrome lip, light ticks round the rim, and a
    // soft beam from above.
    const lip = new THREE.Mesh(new THREE.TorusGeometry(stageR + 0.13, 0.06, 12, 96), new THREE.MeshPhysicalMaterial({ color: "#dfe6f5", metalness: 1, roughness: 0.14, clearcoat: 1 }));
    lip.rotation.x = Math.PI / 2;
    lip.position.y = -0.03;
    plat.add(lip);
    const ticks = new THREE.InstancedMesh(new THREE.BoxGeometry(0.05, 0.02, 0.22), new THREE.MeshBasicMaterial({ color: new THREE.Color("#8fb0ff").multiplyScalar(1.8), toneMapped: false }), 60);
    const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), s4 = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2;
      q4.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a);
      m4.compose(new THREE.Vector3(Math.cos(a) * (stageR - 0.25), 0.012, Math.sin(a) * (stageR - 0.25)), q4, s4.setScalar(i % 5 ? 0.6 : 1));
      ticks.setMatrixAt(i, m4);
    }
    plat.add(ticks);
    const spot = new THREE.SpotLight("#fff6ea", 45, 20, 0.42, 0.7, 1.4);
    spot.position.set(0.5, 9, 1.5);
    scene.add(spot, spot.target);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.6, stageR * 1.05, 7, 48, 1, true), new THREE.ShaderMaterial({
      // Pure additive light that leaves the canvas alpha alone (the page shows through it).
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
      vertexShader: "varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position,1.); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }",
      fragmentShader: "varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ float edge = pow(abs(dot(vN, vV)), 1.5); float fade = smoothstep(0.0, 0.35, vUv.y) * (1.0 - vUv.y * 0.6); gl_FragColor = vec4(vec3(0.55, 0.65, 1.0) * edge * fade * 0.09, 0.0); }",
    }));
    beam.position.y = 3.4;
    // In the intro the beam would run off the edge of the stage's box.
    if (mode.kind === "kart") scene.add(beam);
  }

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  const spin = new THREE.Group();
  scene.add(spin);

  // Cast.
  let kart: KartModel | null = null;
  let mascots: MascotModel[] = [];
  const coins: THREE.Object3D[] = [];
  const shadowTex = blobTex("rgba(0,0,0,.55)", "rgba(0,0,0,0)");

  const buildKart = (l: KartLook) => {
    if (kart) spin.remove(kart.root, kart.shadowRoot);
    kart = new KartModel(l, shadowTex);
    kart.root.rotation.y = 0.5;
    spin.add(kart.root, kart.shadowRoot);
  };
  const buildMascots = (chars: DriverId[]) => {
    for (const m of mascots) spin.remove(m.root);
    mascots = chars.map((c, i) => {
      const m = new MascotModel(c, i);
      const n = chars.length;
      const x = n === 1 ? 0 : (i - (n - 1) / 2) * 1.75;
      m.root.position.set(x, 0, n === 1 ? 0 : -Math.abs(x) * 0.25);
      m.root.rotation.y = -x * 0.14;
      m.root.traverse((o) => { (o as THREE.Mesh).castShadow = true; });
      spin.add(m.root);
      return m;
    });
  };

  if (mode.kind === "kart") {
    buildKart(mode.look);
    camera.position.set(0, 3.0, 9.6);
    camera.lookAt(0, 0.9, 0);
  } else {
    buildMascots(mode.kind === "squad" ? mode.chars : [mode.char]);
    if (mode.kind === "squad") {
      camera.position.set(0, 2.6, 11.6);
      camera.lookAt(0, 1.15, 0);
      // Floating coins, like the Dlicom promo renders.
      // Placed behind and above the squad so they frame it without covering anyone.
      const spots: [("dli" | "btc" | "eth"), number, number, number, number][] = [
        ["eth", -2.9, 3.4, -1.6, 1.0], ["btc", 3.0, 3.6, -2.0, 1.15], ["dli", -3.3, 1.2, -2.4, 0.85],
        ["dli", 3.4, 1.4, -2.6, 0.8], ["btc", -1.1, 4.3, -3.2, 0.7], ["dli", 1.4, 4.4, -3.0, 0.7],
      ];
      spots.forEach(([k, x, y, z, sc], i) => {
        const coin = new THREE.Mesh(coinGeometry(k), coinMaterials(k));
        coin.position.set(x, y, z);
        coin.scale.setScalar(sc);
        coin.userData.phase = i * 1.3;
        scene.add(coin);
        coins.push(coin);
      });
    } else {
      // Framed a little right of Dili, leaving room for the props.
      camera.position.set(1.0, 2.3, 9.2);
      camera.lookAt(0.95, 1.3, 0);
    }
  }

  // Intro props: each pops in beside Dili with a spring, the old one shrinks away.
  const props = new Map<Prop, THREE.Object3D>();
  let prop: Prop = "none";
  let propK = 0;
  let prevProp: THREE.Object3D | null = null;
  let prevK = 0;
  let custodian: MascotModel | null = null;
  let introKart: KartModel | null = null;
  const makeProp = (p: Prop): THREE.Object3D => {
    const g = new THREE.Group();
    if (p === "coin") {
      const coin = new THREE.Mesh(coinGeometry("dli"), coinMaterials("dli"));
      coin.scale.setScalar(1.45);
      coin.name = "spin";
      g.add(coin);
      add(g, torus(1.25, 0.03), glow("#ffd84a", 2.6), 0, 0, 0, false).rotation.set(1.25, 0.3, 0);
      g.position.set(2.0, 2.2, 0.2);
    } else if (p === "phone") {
      const ph = new THREE.Group();
      ph.name = "spin";
      add(ph, rbox(1.0, 1.95, 0.1, 0.14), plastic("#15161f", 0.3, 0.4));
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.84), new THREE.MeshBasicMaterial({ map: appScreenTex(), toneMapped: false }));
      screen.position.z = 0.056;
      ph.add(screen);
      g.add(ph);
      g.position.set(1.95, 1.95, 0.4);
      g.scale.setScalar(0.9);
    } else if (p === "custodian") {
      custodian = new MascotModel("dili", 3, { team: "#e8384f", glow: "#ff3048" });
      custodian.root.scale.setScalar(0.9);
      custodian.root.rotation.y = -0.55;
      custodian.root.traverse((o) => { (o as THREE.Mesh).castShadow = true; });
      g.add(custodian.root);
      g.position.set(2.3, 0, -0.9);
    } else if (p === "keys") {
      const k = (label: string, x: number, y: number, col: string) => {
        const cap = new THREE.Group();
        add(cap, rbox(0.62, 0.62, 0.3, 0.12), plastic(col, 0.35));
        const face = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), new THREE.MeshBasicMaterial({ map: keyTex(label), transparent: true }));
        face.position.z = 0.16;
        cap.add(face);
        cap.position.set(x, y, 0);
        cap.userData.base = y;
        g.add(cap);
      };
      k("↑", 0, 0.72, "#2fd872");
      k("←", -0.72, 0, "#f4f6fb");
      k("↓", 0, 0, "#ffd84a");
      k("→", 0.72, 0, "#f4f6fb");
      g.position.set(2.0, 1.7, 0.3);
      g.rotation.y = -0.35;
    } else if (p === "kart") {
      introKart = new KartModel(DILI_LOOK, shadowTex);
      introKart.root.rotation.y = -0.9;
      introKart.driver.visible = false;   // Dili is standing right there
      g.add(introKart.root, introKart.shadowRoot);
      g.position.set(2.1, 0, -1.5);
    }
    g.visible = false;
    spin.add(g);
    return g;
  };
  let speaking = false;

  // Interaction: drag to spin the kart; click a character to make it wave.
  let vel = mode.kind === "kart" ? 0.35 : 0;
  let dragging = false, lastX = 0, moved = 0;
  cv.addEventListener("pointerdown", (e) => {
    dragging = true;
    moved = 0;
    lastX = e.clientX;
    cv.setPointerCapture(e.pointerId);
  });
  cv.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    lastX = e.clientX;
    moved += Math.abs(dx);
    if (mode.kind === "kart") {
      spin.rotation.y += dx * 0.012;
      vel = dx * 0.6;
    }
  });
  const up = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    cv.releasePointerCapture(e.pointerId);
    if (moved < 6) {
      onPoke?.();
      waveT = 2.2;
      for (const m of mascots) m.pose = "wave";
    }
  };
  cv.addEventListener("pointerup", up);
  cv.addEventListener("pointercancel", up);

  const resize = () => {
    const r = host.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Keep the whole cast in frame on narrow screens.
    camera.fov = w / h < 1 ? 30 + (1 - w / h) * 26 : 30;
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();

  let raf = 0, last = performance.now(), t = 0, waveT = mode.kind === "kart" ? 1.8 : 0;
  let heldPose: Pose = "idle";
  let hopT = 9;
  const tick = (now: number) => {
    raf = requestAnimationFrame(tick);
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    t += dt;
    if (mode.kind === "kart" && !dragging) {
      vel += (0.35 - vel) * Math.min(1, dt * 1.5);
      spin.rotation.y += vel * dt;
    }
    if (mode.kind === "squad") spin.rotation.y = Math.sin(t * 0.35) * 0.18;
    waveT -= dt;
    if (waveT <= 0) for (const m of mascots) if (m.pose === "wave") m.pose = heldPose;
    // In the line-up, someone waves now and then.
    if (mode.kind === "squad" && Math.floor(t / 4) % 3 === 1 && mascots[1]) mascots[1].pose = t % 4 < 2 ? "wave" : "idle";
    for (const m of mascots) {
      m.speaking += ((speaking ? 1 : 0) - m.speaking) * Math.min(1, dt * 12);
      m.update(t, dt);
    }
    if (mode.kind === "solo") {
      const cur = props.get(prop);
      propK = Math.min(1, propK + dt * 1.8);
      if (cur) {
        cur.visible = true;
        const e = propK >= 1 ? 1 : 1 - Math.pow(2, -9 * propK) * Math.cos(propK * 9);
        cur.scale.setScalar(Math.max(0.001, e) * (prop === "kart" ? 0.72 : prop === "phone" ? 0.9 : 1));
        const sp = cur.getObjectByName("spin");
        if (sp) {
          sp.rotation.y = prop === "coin" ? t * 1.6 : Math.sin(t * 0.8) * 0.35 - 0.3;
          sp.position.y = Math.sin(t * 1.7) * 0.08;
        }
        if (prop === "keys") cur.children.forEach((c, i) => { c.position.y = (c.userData.base as number) + Math.max(0, Math.sin(t * 5 - i * 0.9)) * 0.1; });
      }
      if (prevProp) {
        prevK = Math.max(0, prevK - dt * 4);
        prevProp.scale.setScalar(Math.max(0.001, prevK));
        if (prevK <= 0) { prevProp.visible = false; prevProp = null; }
      }
      custodian?.update(t, dt);
      introKart?.update({ speed: 3, steer: Math.sin(t) * 0.2, slide: 0, hop: 0, squash: 1, roll: 0, flip: 0, boost: Math.max(0, Math.sin(t * 1.3)) * 0.6, glide: 0, wave: 0, time: t }, dt);
    }
    if (kart) {
      hopT += dt;
      const hop = hopT < 0.6 ? Math.sin((hopT / 0.6) * Math.PI) * 0.6 : 0;
      const squash = hopT < 0.6 ? 1 + Math.sin((hopT / 0.6) * Math.PI) * 0.08 : hopT < 0.9 ? 1 - Math.sin(((hopT - 0.6) / 0.3) * Math.PI) * 0.1 : 1;
      kart.update({
        speed: 5, steer: Math.sin(t * 0.9) * 0.35, slide: 0, hop, squash, roll: 0, flip: 0,
        boost: Math.max(0, Math.sin(t * 0.7)) * 0.7, glide: 0, wave: waveT > 0 ? 1 : 0, time: t,
      }, dt);
    }
    for (const c of coins) {
      const ph = c.userData.phase as number;
      c.rotation.y = t * 1.4 + ph;
      c.rotation.x = Math.sin(t * 0.8 + ph) * 0.4;
      c.position.y += Math.sin(t * 1.6 + ph) * 0.004;
    }
    ring.rotation.z += dt * 0.3;
    renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(tick);

  return {
    setChar(c: DriverId) {
      if (mode.kind === "solo") buildMascots([c]);
    },
    setLook(l: KartLook) {
      if (mode.kind !== "kart") return;
      buildKart(l);
      waveT = 1.6;
      // A little hop onto the platform.
      hopT = 0;
    },
    setProp(p: Prop) {
      if (mode.kind !== "solo" || p === prop) return;
      const old = props.get(prop);
      if (old) { prevProp = old; prevK = 1; }
      prop = p;
      propK = 0;
      if (p !== "none" && !props.has(p)) props.set(p, makeProp(p));
    },
    setSpeaking(on: boolean) {
      speaking = on;
    },
    setPose(p: Pose) {
      heldPose = p;
      for (const m of mascots) m.pose = p;
    },
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      // Models and textures are shared with the live backdrop (and cached for
      // the next menu), so only this stage's own GL context is released;
      // dropping the context frees everything it uploaded.
      scene.environment?.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      cv.remove();
    },
  };
}

/** The Dlicom app on the intro phone: chat, a clip, and the wallet. */
function appScreenTex() {
  const W = 256, H = 520;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d")!;
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#0f1633");
  bg.addColorStop(1, "#070a1c");
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  g.fillStyle = "#3d63ff";
  g.font = "900 italic 26px Inter, sans-serif";
  g.fillText("Dlicom", 18, 44);
  g.fillStyle = "rgba(255,255,255,.5)";
  g.font = "600 12px Inter, sans-serif";
  g.fillText("Messages · Feed · Wallet", 18, 64);
  const bubble = (x: number, y: number, w: number, me: boolean, text: string) => {
    g.fillStyle = me ? "#3d63ff" : "rgba(255,255,255,.1)";
    g.beginPath();
    g.roundRect(x, y, w, 34, 14);
    g.fill();
    g.fillStyle = "#fff";
    g.font = "600 13px Inter, sans-serif";
    g.fillText(text, x + 12, y + 22);
  };
  bubble(16, 86, 170, false, "gm! race tonight? 🏁");
  bubble(70, 128, 170, true, "always. keys in hand 🔑");
  bubble(16, 170, 150, false, "see you at the line");
  // Wallet card.
  const card = g.createLinearGradient(16, 230, 240, 360);
  card.addColorStop(0, "#ffd84a");
  card.addColorStop(1, "#ff9500");
  g.fillStyle = card;
  g.beginPath();
  g.roundRect(16, 226, 224, 128, 18);
  g.fill();
  g.fillStyle = "#2a1a00";
  g.font = "700 12px Inter, sans-serif";
  g.fillText("SELF-CUSTODY WALLET", 30, 254);
  g.font = "900 34px Inter, sans-serif";
  g.fillText("$DLI", 30, 300);
  g.font = "700 12px Inter, sans-serif";
  g.fillText("TGE · 2027", 30, 330);
  // Tab bar.
  g.fillStyle = "rgba(255,255,255,.08)";
  g.fillRect(0, H - 64, W, 64);
  ["#3d63ff", "rgba(255,255,255,.4)", "rgba(255,255,255,.4)", "rgba(255,255,255,.4)"].forEach((col, i) => {
    g.fillStyle = col;
    g.beginPath();
    g.arc(40 + i * 58, H - 32, 10, 0, Math.PI * 2);
    g.fill();
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** A keycap legend. */
function keyTex(label: string) {
  const S = 128;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  g.fillStyle = "#15161f";
  g.font = "900 84px Inter, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(label, S / 2, S / 2 + 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
