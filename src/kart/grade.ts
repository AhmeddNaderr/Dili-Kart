import * as THREE from "three";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";

/**
 * Final colour grade, applied after tone mapping, matched to the intro
 * film: richer saturation and contrast, cool shadows and warm highlights
 * (the dusk look), a soft vignette to pull the eye to the kart, a little
 * lens fringing toward the corners and a fine moving grain.
 */
export function gradePass() {
  const pass = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      uSat: { value: 1.16 },
      uContrast: { value: 1.08 },
      uVignette: { value: 0.3 },
      uFringe: { value: 0.006 },
      uGrain: { value: 0.012 },
      uSeed: { value: 0 },
      /** 0..1 radial speed blur, for boosts. */
      uBlur: { value: 0 },
    },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform sampler2D tDiffuse; uniform float uSat, uContrast, uVignette, uFringe, uGrain, uSeed, uBlur;
      varying vec2 vUv;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + uSeed) * 43758.5453); }
      void main(){
        vec2 d = vUv - 0.5;
        // Chromatic fringe, growing toward the corners like a real lens
        // (about two pixels at the corners of a 1080p frame).
        vec2 off = d * dot(d, d) * uFringe;
        vec4 c = texture2D(tDiffuse, vUv);
        c.r = texture2D(tDiffuse, vUv - off).r;
        c.b = texture2D(tDiffuse, vUv + off).b;
        if (uBlur > 0.01) {
          // Speed blur: smear outward from the centre, strongest at the edges,
          // leaving the kart in the middle sharp.
          float edge = smoothstep(0.12, 0.7, length(d * vec2(1.4, 1.0)));
          vec2 step = d * uBlur * edge * 0.012;
          vec3 acc = c.rgb;
          for (int i = 1; i < 7; i++) acc += texture2D(tDiffuse, vUv - step * float(i)).rgb;
          c.rgb = acc / 7.0;
        }
        float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
        vec3 col = mix(vec3(l), c.rgb, uSat);
        col = (col - 0.5) * uContrast + 0.5;
        // Split tone: shadows lean blue-violet, highlights lean warm gold.
        col += vec3(-0.012, -0.004, 0.03) * (1.0 - l);
        col += vec3(0.03, 0.012, -0.02) * l * l;
        col *= 1.0 - uVignette * smoothstep(0.35, 0.95, length(d * vec2(1.25, 1.0)) * 1.4);
        col += (hash(vUv * 1024.0) - 0.5) * uGrain;
        gl_FragColor = vec4(clamp(col, 0.0, 1.0), c.a);
      }`,
  });
  // New grain every frame.
  const u = pass.uniforms as Record<string, THREE.IUniform>;
  const render = pass.render.bind(pass);
  pass.render = (...args: Parameters<ShaderPass["render"]>) => {
    u.uSeed.value = (u.uSeed.value + 1.618) % 97;
    render(...args);
  };
  return pass;
}

/**
 * Ambient occlusion (GTAO): soft contact shadows where karts meet the road,
 * in the creases of the models and under the stands, like the film. Glass,
 * glows, sprites and particles are left out of it, so domes and halos don't
 * cast grey smudges.
 */
export class ContactAO extends GTAOPass {
  constructor(scene: THREE.Scene, camera: THREE.Camera, w: number, h: number) {
    super(scene, camera, w, h);
    this.output = GTAOPass.OUTPUT.Default;
    this.blendIntensity = 0.85;
    this.updateGtaoMaterial({ radius: 0.55, distanceExponent: 1.6, thickness: 1.2, scale: 1.1, samples: 12, distanceFallOff: 1 });
    this.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
  }

  _overrideVisibility() {
    const self = this as unknown as { scene: THREE.Scene; _visibilityCache: THREE.Object3D[] };
    const cache = self._visibilityCache;
    self.scene.traverse((o) => {
      if (!o.visible) return;
      const x = o as THREE.Mesh & { isPoints?: boolean; isLine?: boolean; isSprite?: boolean };
      const m = x.material as THREE.Material | THREE.Material[] | undefined;
      const see = Array.isArray(m) ? m.some((k) => k.transparent || k.blending === THREE.AdditiveBlending) : m ? m.transparent || m.blending === THREE.AdditiveBlending : false;
      if (x.isPoints || x.isLine || x.isSprite || see) {
        o.visible = false;
        cache.push(o);
      }
    });
  }
}

/**
 * Scrubs invalid pixels (NaN or infinity) out of the HDR frame and caps
 * extreme highlights before bloom. A single bad pixel from a shader edge
 * case would otherwise be smeared across the whole screen by the bloom blur
 * and flash the frame black — which some GPUs (Apple's especially) hit and
 * others never do.
 */
export function sanitizePass() {
  return new ShaderPass({
    uniforms: { tDiffuse: { value: null } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform sampler2D tDiffuse; varying vec2 vUv;
      void main(){
        vec4 c = texture2D(tDiffuse, vUv);
        // NaN is the only value not equal to itself; infinities fail the range test.
        bool bad = !(c.r == c.r && c.g == c.g && c.b == c.b) || max(max(abs(c.r), abs(c.g)), abs(c.b)) > 60000.0;
        gl_FragColor = bad ? vec4(0.0, 0.0, 0.0, 1.0) : vec4(min(c.rgb, vec3(48.0)), c.a);
      }`,
  });
}
