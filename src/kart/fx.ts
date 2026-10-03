import * as THREE from "three";

/**
 * GPU point particles. One draw call per system, attributes rewritten on
 * the CPU each frame. Sparks use additive blending so they glow and bloom;
 * puffs (dust, smoke) blend normally.
 */
export class Particles {
  readonly points: THREE.Points;
  private n = 0;
  private readonly max: number;
  private pos: Float32Array;
  private vel: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private grow: Float32Array;
  private grav: Float32Array;
  private drag: Float32Array;
  private baseSize: Float32Array;
  private baseAlpha: Float32Array;
  private geo: THREE.BufferGeometry;
  private mat: THREE.ShaderMaterial;

  constructor(max: number, additive: boolean) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.baseSize = new Float32Array(max);
    this.baseAlpha = new Float32Array(max);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute("aColor", new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute("aAlpha", new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uScale: { value: 600 } },
      vertexShader: `
        attribute vec3 aColor; attribute float aSize; attribute float aAlpha;
        uniform float uScale;
        varying vec3 vC; varying float vA;
        void main(){
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          float dist = -mv.z;
          gl_PointSize = min(aSize * uScale / max(0.5, dist), 140.0);
          // Fade out anything drifting right up to the lens, so a stray puff
          // never becomes a huge blurry disc in front of the camera.
          vC = aColor; vA = aAlpha * smoothstep(2.0, 5.5, dist);
        }`,
      fragmentShader: additive
        ? `varying vec3 vC; varying float vA;
           void main(){
             float r = length(gl_PointCoord - 0.5) * 2.0;
             float core = smoothstep(1.0, 0.0, r);
             gl_FragColor = vec4(vC * (core * core + pow(core, 8.0) * 1.5) * vA, 1.0);
           }`
        : `varying vec3 vC; varying float vA;
           void main(){
             float r = length(gl_PointCoord - 0.5) * 2.0;
             float a = smoothstep(1.0, 0.55, r);
             gl_FragColor = vec4(vC, a * vA);
           }`,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 6 : 5;
  }

  /** Pixels per metre at distance 1, from the camera's vertical FOV. */
  setScale(viewportHeight: number, fovDeg: number) {
    this.mat.uniforms.uScale.value = viewportHeight / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2));
  }

  spawn(
    x: number, y: number, z: number, vx: number, vy: number, vz: number,
    color: THREE.Color, size: number, life: number,
    opt: { grow?: number; grav?: number; drag?: number; alpha?: number } = {},
  ) {
    let i: number;
    if (this.n < this.max) i = this.n++;
    else {
      // Full: recycle the particle closest to dying.
      i = 0;
      let lo = Infinity;
      for (let k = 0; k < this.max; k++) if (this.life[k] < lo) { lo = this.life[k]; i = k; }
    }
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 3] = color.r; this.col[i * 3 + 1] = color.g; this.col[i * 3 + 2] = color.b;
    this.baseSize[i] = size;
    this.size[i] = size;
    this.baseAlpha[i] = opt.alpha ?? 1;
    this.alpha[i] = this.baseAlpha[i];
    this.life[i] = life;
    this.maxLife[i] = life;
    this.grow[i] = opt.grow ?? 0;
    this.grav[i] = opt.grav ?? 0;
    this.drag[i] = opt.drag ?? 0;
  }

  update(dt: number) {
    let i = 0;
    while (i < this.n) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        // Swap-remove with the last live particle.
        const last = --this.n;
        if (i !== last) this.copy(last, i);
        continue;
      }
      const k = 1 - this.drag[i] * dt;
      this.vel[i * 3] *= k;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k - this.grav[i] * dt;
      this.vel[i * 3 + 2] *= k;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const t = 1 - this.life[i] / this.maxLife[i];
      this.size[i] = this.baseSize[i] * (1 + this.grow[i] * t);
      // Full strength for most of the life, then fade out.
      this.alpha[i] = this.baseAlpha[i] * Math.min(1, (1 - t) * 1.8);
      i++;
    }
    this.geo.setDrawRange(0, this.n);
    for (const a of ["position", "aColor", "aSize", "aAlpha"]) this.geo.attributes[a].needsUpdate = true;
  }

  private copy(from: number, to: number) {
    for (const arr of [this.pos, this.vel, this.col]) {
      arr[to * 3] = arr[from * 3]; arr[to * 3 + 1] = arr[from * 3 + 1]; arr[to * 3 + 2] = arr[from * 3 + 2];
    }
    for (const arr of [this.size, this.alpha, this.life, this.maxLife, this.grow, this.grav, this.drag, this.baseSize, this.baseAlpha]) {
      arr[to] = arr[from];
    }
  }

  dispose() {
    this.geo.dispose();
    this.mat.dispose();
  }
}

/**
 * Confetti: little paper rectangles that tumble and flutter down. An
 * instanced mesh, so a few hundred pieces cost one draw call.
 */
export class Confetti {
  readonly mesh: THREE.InstancedMesh;
  private readonly max = 360;
  private p: { x: number; y: number; z: number; vx: number; vy: number; vz: number; rx: number; ry: number; sx: number; sy: number; life: number }[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private s = new THREE.Vector3(1, 1, 1);
  private v = new THREE.Vector3();

  constructor() {
    this.mesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.22, 0.36),
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false }),
      this.max,
    );
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    const cols = ["#ff4d6d", "#ffd24d", "#4dd2ff", "#7dff8a", "#b18bff", "#2f6bff", "#ffffff"];
    const c = new THREE.Color();
    for (let i = 0; i < this.max; i++) this.mesh.setColorAt(i, c.set(cols[i % cols.length]));
  }

  burst(at: THREE.Vector3, n: number, spread = 6, up = 9) {
    for (let i = 0; i < n; i++) {
      if (this.p.length >= this.max) this.p.shift();
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * spread;
      this.p.push({
        x: at.x + Math.cos(a) * r * 0.3, y: at.y, z: at.z + Math.sin(a) * r * 0.3,
        vx: Math.cos(a) * r, vy: up * (0.6 + Math.random() * 0.7), vz: Math.sin(a) * r,
        rx: Math.random() * 6, ry: Math.random() * 6, sx: (Math.random() - 0.5) * 14, sy: (Math.random() - 0.5) * 14,
        life: 2.6 + Math.random() * 1.6,
      });
    }
  }

  update(dt: number) {
    this.p = this.p.filter((c) => (c.life -= dt) > 0);
    this.p.forEach((c, i) => {
      c.vx *= 1 - 1.4 * dt; c.vz *= 1 - 1.4 * dt;
      c.vy = Math.max(-2.4, c.vy - 12 * dt);
      c.x += (c.vx + Math.sin(c.rx) * 0.8) * dt;
      c.y += c.vy * dt;
      c.z += c.vz * dt;
      c.rx += c.sx * dt; c.ry += c.sy * dt;
      this.q.setFromEuler(this.e.set(c.rx, c.ry, 0));
      const k = Math.min(1, c.life * 2);
      this.s.set(k, k, k);
      this.m.compose(this.v.set(c.x, c.y, c.z), this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
    });
    this.mesh.count = this.p.length;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/**
 * Skid marks that stay on the track: a ring buffer of quads laid behind
 * each drifting tyre, joined edge to edge so a slide reads as one rubber
 * stripe. One draw call; the oldest marks fade out as the ring wraps.
 */
export class SkidMarks {
  readonly mesh: THREE.Mesh;
  private readonly max: number;
  private head = 0;
  private pos: Float32Array;
  private seg: Float32Array;
  private lo = Infinity;
  private hi = -1;
  private last = new Map<number, { p: THREE.Vector3; l: THREE.Vector3; r: THREE.Vector3 }>();
  private mat: THREE.ShaderMaterial;

  constructor(max = 1800, color = "#101014", opacity = 0.55) {
    this.max = max;
    this.pos = new Float32Array(max * 4 * 3);
    this.seg = new Float32Array(max * 4);
    const alpha = new Float32Array(max * 4);
    const idx = new Uint32Array(max * 6);
    for (let i = 0; i < max; i++) {
      const v = i * 4;
      idx.set([v, v + 2, v + 1, v + 1, v + 2, v + 3], i * 6);
      this.seg.fill(i, v, v + 4);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("aSeg", new THREE.BufferAttribute(this.seg, 1));
    geo.setAttribute("aStr", new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(max * 8), 2));
    // uv.x across the tyre (0 left, 1 right), for the tread pattern.
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < max; i++) for (let c = 0; c < 4; c++) uv.setXY(i * 4 + c, c & 1 ? 1 : 0, c >> 1);
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
      uniforms: { uHead: { value: 0 }, uMax: { value: max }, uColor: { value: new THREE.Color(color) }, uOp: { value: opacity } },
      vertexShader: `
        attribute float aSeg; attribute float aStr;
        uniform float uHead; uniform float uMax;
        varying float vA; varying vec2 vUv;
        void main(){
          float age = mod(uHead - aSeg + uMax, uMax) / uMax;
          vA = aStr * (1.0 - smoothstep(0.75, 1.0, age));
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 uColor; uniform float uOp;
        varying float vA; varying vec2 vUv;
        void main(){
          // Tread: a few darker grooves across, fading at the tyre's shoulders.
          float edge = smoothstep(0.0, 0.18, vUv.x) * smoothstep(1.0, 0.82, vUv.x);
          float tread = 0.75 + 0.25 * step(0.5, fract(vUv.x * 4.0));
          gl_FragColor = vec4(uColor, uOp * vA * edge * tread);
        }`,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  /** Extend wheel `key`'s stripe to `p` (on the road), `side` across the tyre. */
  mark(key: number, p: THREE.Vector3, side: THREE.Vector3, width: number, strength: number) {
    const l = p.clone().addScaledVector(side, -width / 2);
    const r = p.clone().addScaledVector(side, width / 2);
    const prev = this.last.get(key);
    if (!prev || prev.p.distanceToSquared(p) > 9) { this.last.set(key, { p: p.clone(), l, r }); return; }
    if (prev.p.distanceToSquared(p) < 0.35 * 0.35) return;
    const i = this.head;
    this.head = (this.head + 1) % this.max;
    const o = i * 12;
    this.pos.set([prev.l.x, prev.l.y, prev.l.z, prev.r.x, prev.r.y, prev.r.z, l.x, l.y, l.z, r.x, r.y, r.z], o);
    const str = (this.mesh.geometry.attributes.aStr as THREE.BufferAttribute).array as Float32Array;
    str.set([strength, strength, strength, strength], i * 4);
    this.lo = Math.min(this.lo, i);
    this.hi = Math.max(this.hi, i);
    prev.p.copy(p); prev.l.copy(l); prev.r.copy(r);
  }

  /** The tyre stopped sliding: the next mark starts a new stripe. */
  lift(key: number) { this.last.delete(key); }

  update() {
    this.mat.uniforms.uHead.value = this.head;
    if (this.hi < 0) return;
    const g = this.mesh.geometry;
    const pa = g.attributes.position as THREE.BufferAttribute;
    const sa = g.attributes.aStr as THREE.BufferAttribute;
    pa.clearUpdateRanges(); sa.clearUpdateRanges();
    pa.addUpdateRange(this.lo * 12, (this.hi - this.lo + 1) * 12);
    sa.addUpdateRange(this.lo * 4, (this.hi - this.lo + 1) * 4);
    pa.needsUpdate = true; sa.needsUpdate = true;
    this.lo = Infinity; this.hi = -1;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}

/** One kart's frame of a replay: where it was and how it looked. */
export const REPLAY_STRIDE = 7 + 7 + 10 + 1 + 1;

/**
 * A rolling recording of every kart's transform and pose, sampled at 30 Hz,
 * so the finish can be shown again from trackside cameras.
 */
export class ReplayTape {
  readonly rate = 30;
  private readonly frames: number;
  private data: Float32Array;
  private count = 0;
  private head = 0;
  private acc = 0;
  constructor(readonly karts: number, seconds = 14) {
    this.frames = Math.round(seconds * this.rate);
    this.data = new Float32Array(this.frames * karts * REPLAY_STRIDE);
  }

  /** Call every frame; `write(k, out)` fills kart k's slice. */
  record(dt: number, write: (k: number, out: Float32Array, o: number) => void) {
    this.acc += dt;
    if (this.acc < 1 / this.rate && this.count > 0) return;
    this.acc = Math.min(this.acc - 1 / this.rate, 1 / this.rate);
    const base = this.head * this.karts * REPLAY_STRIDE;
    for (let k = 0; k < this.karts; k++) write(k, this.data, base + k * REPLAY_STRIDE);
    this.head = (this.head + 1) % this.frames;
    this.count = Math.min(this.count + 1, this.frames);
  }

  /** Seconds of tape held. */
  get length() { return this.count / this.rate; }

  /**
   * Read kart k at `t` seconds before the newest frame, interpolating
   * between samples. Returns [slice array, offset a, offset b, blend].
   */
  at(k: number, back: number): [Float32Array, number, number, number] {
    const f = Math.max(0, Math.min(this.count - 1.001, back * this.rate));
    const i0 = Math.floor(f);
    const fa = (this.head - 1 - i0 + this.frames * 2) % this.frames;
    const fb = (fa - 1 + this.frames) % this.frames;
    const stride = this.karts * REPLAY_STRIDE;
    // fa is newer, fb older; blend goes from fa (0) toward fb (1).
    return [this.data, fa * stride + k * REPLAY_STRIDE, fb * stride + k * REPLAY_STRIDE, f - i0];
  }

  clear() { this.count = 0; this.head = 0; this.acc = 0; }
}
