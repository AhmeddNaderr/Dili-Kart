import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";

/**
 * Final colour grade, applied after tone mapping: a touch more saturation
 * and contrast, cool shadows and warm highlights (the dusk look), and a
 * soft vignette to pull the eye to the kart.
 */
export function gradePass() {
  return new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      uSat: { value: 1.14 },
      uContrast: { value: 1.06 },
      uVignette: { value: 0.28 },
    },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform sampler2D tDiffuse; uniform float uSat, uContrast, uVignette;
      varying vec2 vUv;
      void main(){
        vec4 c = texture2D(tDiffuse, vUv);
        float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
        vec3 col = mix(vec3(l), c.rgb, uSat);
        col = (col - 0.5) * uContrast + 0.5;
        // Split tone: shadows lean blue-violet, highlights lean warm gold.
        col += vec3(-0.012, -0.004, 0.03) * (1.0 - l);
        col += vec3(0.03, 0.012, -0.02) * l * l;
        vec2 d = vUv - 0.5;
        col *= 1.0 - uVignette * smoothstep(0.35, 0.95, length(d * vec2(1.25, 1.0)) * 1.4);
        gl_FragColor = vec4(clamp(col, 0.0, 1.0), c.a);
      }`,
  });
}

