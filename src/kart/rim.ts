import * as THREE from "three";

/**
 * A cool sky-coloured rim light on the silhouette, the thing that makes
 * cartoon racers pop off the background. Added as emissive so it costs one
 * dot product and needs no extra light.
 */
export function rimLight<M extends THREE.MeshStandardMaterial>(m: M, strength = 0.32): M {
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
      {
        float rimF = 1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
        totalEmissiveRadiance += vec3(0.62, 0.72, 1.0) * pow(rimF, 3.0) * ${strength.toFixed(3)};
      }`);
  };
  m.customProgramCacheKey = () => `rim${strength}`;
  return m;
}
