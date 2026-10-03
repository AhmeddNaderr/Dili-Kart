import * as THREE from "three";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";

/**
 * Offline cinema pipeline for the intro film (dev only). Heavier than the
 * game's real-time chain because every frame can take seconds:
 *
 *   scene (4× MSAA, half-float, depth) → depth of field (a gather bokeh with
 *   hundreds of taps per pixel) → bloom → filmic tone map + grade, grain,
 *   vignette, a little chromatic fringing → accumulate sub-frames for
 *   motion blur → canvas.
 */

export interface Lens {
  /** Distance to the focal plane, in metres. */
  focus: number;
  /** Blur strength; ~0 for deep focus, 3–8 for a macro/toy look. */
  aperture: number;
  /** Largest blur radius, in output pixels. */
  maxBlur: number;
}

export interface Look {
  exposure: number;
  bloom: number;
  bloomRadius: number;
  bloomThreshold: number;
  /** 0 = none. Warm/cool balance: positive is warmer. */
  warmth: number;
  saturation: number;
  contrast: number;
  vignette: number;
  grain: number;
  fringe: number;
  /** 0..1 fade to black, 0..1 flash to white. */
  black: number;
  white: number;
}

export const DEFAULT_LOOK: Look = {
  exposure: 1.12, bloom: 0.3, bloomRadius: 0.32, bloomThreshold: 1.7,
  warmth: 0.03, saturation: 1.16, contrast: 1.1, vignette: 0.32, grain: 0.014, fringe: 0.6, black: 0, white: 0,
};

const QUAD_VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

/** Single-pass gather bokeh (after Dennis Gustafsson), with foreground-aware weighting. */
const DOF_FS = `
  uniform sampler2D uColor; uniform sampler2D uDepth;
  uniform vec2 uPixel; uniform float uNear, uFar, uFocus, uAperture, uMaxBlur, uStep;
  varying vec2 vUv;
  const float GOLDEN = 2.39996323;
  float viewZ(float d) { float z = d * 2.0 - 1.0; return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear)); }
  float coc(float z) { return clamp(uAperture * abs(1.0 / uFocus - 1.0 / z) * uFocus * 12.0, 0.0, uMaxBlur); }
  void main() {
    vec3 base = texture2D(uColor, vUv).rgb;
    if (uMaxBlur < 0.5) { gl_FragColor = vec4(base, 1.0); return; }
    float cz = viewZ(texture2D(uDepth, vUv).r);
    float cs = coc(cz);
    vec3 acc = base; float tot = 1.0;
    float r = uStep;
    float ang = 0.0;
    for (int i = 0; i < 900; i++) {
      if (r >= uMaxBlur) break;
      vec2 tc = vUv + vec2(cos(ang), sin(ang)) * uPixel * r;
      vec3 sc = texture2D(uColor, tc).rgb;
      float sz = viewZ(texture2D(uDepth, tc).r);
      float ss = coc(sz);
      // A sharp thing in front can't be smeared over by what's behind it.
      if (sz > cz) ss = clamp(ss, 0.0, cs * 2.0);
      float m = smoothstep(r - 0.5, r + 0.5, ss);
      acc += mix(acc / tot, sc, m);
      tot += 1.0;
      r += uStep / r;
      ang += GOLDEN;
    }
    gl_FragColor = vec4(acc / tot, 1.0);
  }`;

/** Tone map + grade + grain + vignette + fringe, to sRGB. */
const FINISH_FS = `
  uniform sampler2D uColor; uniform vec2 uPixel;
  uniform float uExposure, uWarmth, uSat, uContrast, uVignette, uGrain, uFringe, uBlack, uWhite, uSeed;
  varying vec2 vUv;
  // Khronos PBR Neutral: the game's own tone curve. Keeps hues true (ACES
  // pushes saturated blues toward purple, and Dili is very blue).
  vec3 neutral(vec3 c) {
    float x = min(c.r, min(c.g, c.b));
    float off = x < 0.08 ? x - 6.25 * x * x : 0.04;
    c -= off;
    float peak = max(c.r, max(c.g, c.b));
    if (peak < 0.76) return c;
    float d = 0.24;
    float np = 1.0 - d * d / (peak + d - 0.76);
    c *= np / peak;
    float g = 1.0 - 1.0 / (0.15 * (peak - np) + 1.0);
    return mix(c, vec3(np), g);
  }
  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + uSeed) * 43758.5453); }
  vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
  void main() {
    vec2 d = vUv - 0.5;
    // Chromatic fringe grows toward the corners, like a real lens.
    vec2 off = d * uPixel * uFringe * 6.0 * dot(d, d) * 4.0;
    vec3 c;
    c.r = texture2D(uColor, vUv - off).r;
    c.g = texture2D(uColor, vUv).g;
    c.b = texture2D(uColor, vUv + off).b;
    c *= uExposure;
    c *= vec3(1.0 + uWarmth, 1.0, 1.0 - uWarmth);
    c = neutral(c);
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(vec3(l), c, uSat);
    c = (c - 0.5) * uContrast + 0.5;
    c += vec3(-0.01, -0.004, 0.024) * (1.0 - l) * (1.0 - l);
    c += vec3(0.026, 0.012, -0.018) * l * l;
    float v = smoothstep(0.3, 0.95, length(d * vec2(1.3, 1.0)) * 1.35);
    c *= 1.0 - uVignette * v;
    c = clamp(c, 0.0, 1.0);
    c = toSRGB(c);
    c += (hash(vUv * 1024.0) - 0.5) * uGrain;
    c = mix(c, vec3(0.0), uBlack);
    c = mix(c, vec3(1.0), uWhite);
    gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
  }`;

const ACC_FS = `uniform sampler2D uColor; uniform float uWeight; varying vec2 vUv;
  void main(){ gl_FragColor = vec4(texture2D(uColor, vUv).rgb * uWeight, uWeight); }`;
const COPY_FS = `uniform sampler2D uColor; varying vec2 vUv; void main(){ gl_FragColor = vec4(texture2D(uColor, vUv).rgb, 1.0); }`;

export class Cine {
  readonly width: number;
  readonly height: number;
  private scene: THREE.WebGLRenderTarget;
  private dof: THREE.WebGLRenderTarget;
  private finished: THREE.WebGLRenderTarget;
  private accum: THREE.WebGLRenderTarget;
  private bloom: UnrealBloomPass;
  private dofQuad: FullScreenQuad;
  private finishQuad: FullScreenQuad;
  private accQuad: FullScreenQuad;
  private copyQuad: FullScreenQuad;
  private seed = 0;

  constructor(private renderer: THREE.WebGLRenderer, width: number, height: number) {
    this.width = width;
    this.height = height;
    const hf = { type: THREE.HalfFloatType, colorSpace: THREE.LinearSRGBColorSpace } as const;
    this.scene = new THREE.WebGLRenderTarget(width, height, { ...hf, samples: 4, depthTexture: new THREE.DepthTexture(width, height, THREE.FloatType) });
    this.dof = new THREE.WebGLRenderTarget(width, height, hf);
    this.finished = new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType });
    this.accum = new THREE.WebGLRenderTarget(width, height, { type: THREE.FloatType });
    this.bloom = new UnrealBloomPass(new THREE.Vector2(width / 2, height / 2), 0.6, 0.55, 0.9);
    const mat = (fs: string, uniforms: Record<string, THREE.IUniform>, blending: THREE.Blending = THREE.NoBlending) =>
      new THREE.ShaderMaterial({ vertexShader: QUAD_VS, fragmentShader: fs, uniforms, depthTest: false, depthWrite: false, blending });
    this.dofQuad = new FullScreenQuad(mat(DOF_FS, {
      uColor: { value: null }, uDepth: { value: null }, uPixel: { value: new THREE.Vector2(1 / width, 1 / height) },
      uNear: { value: 0.1 }, uFar: { value: 1000 }, uFocus: { value: 10 }, uAperture: { value: 0 }, uMaxBlur: { value: 0 }, uStep: { value: 1.1 },
    }));
    this.finishQuad = new FullScreenQuad(mat(FINISH_FS, {
      uColor: { value: null }, uPixel: { value: new THREE.Vector2(1 / width, 1 / height) },
      uExposure: { value: 1 }, uWarmth: { value: 0 }, uSat: { value: 1 }, uContrast: { value: 1 }, uVignette: { value: 0 },
      uGrain: { value: 0 }, uFringe: { value: 0 }, uBlack: { value: 0 }, uWhite: { value: 0 }, uSeed: { value: 0 },
    }));
    // Additive accumulation: colour × weight into rgb, weight into alpha.
    const acc = mat(ACC_FS, { uColor: { value: null }, uWeight: { value: 1 } }, THREE.CustomBlending);
    acc.blendEquation = THREE.AddEquation;
    acc.blendSrc = THREE.OneFactor;
    acc.blendDst = THREE.OneFactor;
    this.accQuad = new FullScreenQuad(acc);
    this.copyQuad = new FullScreenQuad(mat(COPY_FS, { uColor: { value: null } }));
  }

  /** Clear the motion-blur accumulator; call once per output frame. */
  begin() {
    const r = this.renderer;
    r.setRenderTarget(this.accum);
    r.setClearColor(0x000000, 0);
    r.clear(true, false, false);
  }

  /** Render one sub-frame through the full chain and add it to the accumulator. */
  sub(scene: THREE.Scene, camera: THREE.PerspectiveCamera, lens: Lens, look: Look, weight: number) {
    const r = this.renderer;
    const prevTone = r.toneMapping;
    r.toneMapping = THREE.NoToneMapping;

    r.setRenderTarget(this.scene);
    r.setClearColor(0x000000, 1);
    r.clear();
    r.render(scene, camera);

    // Blur radii are specified for a 1080p frame; scale to the working size.
    const px = this.height / 1080;
    const du = (this.dofQuad.material as THREE.ShaderMaterial).uniforms;
    du.uColor.value = this.scene.texture;
    du.uDepth.value = this.scene.depthTexture;
    du.uNear.value = camera.near;
    du.uFar.value = camera.far;
    du.uFocus.value = Math.max(0.05, lens.focus);
    du.uAperture.value = lens.aperture * px;
    du.uMaxBlur.value = lens.aperture > 0 ? lens.maxBlur * px : 0;
    r.setRenderTarget(this.dof);
    this.dofQuad.render(r);

    this.bloom.strength = look.bloom;
    this.bloom.radius = look.bloomRadius;
    this.bloom.threshold = look.bloomThreshold;
    if (look.bloom > 0) this.bloom.render(r, this.dof, this.dof, 1 / 60, false);

    const fu = (this.finishQuad.material as THREE.ShaderMaterial).uniforms;
    fu.uColor.value = this.dof.texture;
    fu.uExposure.value = look.exposure;
    fu.uWarmth.value = look.warmth;
    fu.uSat.value = look.saturation;
    fu.uContrast.value = look.contrast;
    fu.uVignette.value = look.vignette;
    fu.uGrain.value = look.grain;
    fu.uFringe.value = look.fringe;
    fu.uBlack.value = look.black;
    fu.uWhite.value = look.white;
    fu.uSeed.value = (this.seed = (this.seed + 1.618) % 97);
    r.setRenderTarget(this.finished);
    this.finishQuad.render(r);

    const au = (this.accQuad.material as THREE.ShaderMaterial).uniforms;
    au.uColor.value = this.finished.texture;
    au.uWeight.value = weight;
    r.setRenderTarget(this.accum);
    // Add on top of the sub-frames already there: no clear.
    const autoClear = r.autoClear;
    r.autoClear = false;
    this.accQuad.render(r);
    r.autoClear = autoClear;

    r.toneMapping = prevTone;
  }

  /** Write the accumulated frame to the canvas. */
  present() {
    const r = this.renderer;
    (this.copyQuad.material as THREE.ShaderMaterial).uniforms.uColor.value = this.accum.texture;
    r.setRenderTarget(null);
    this.copyQuad.render(r);
  }
}
