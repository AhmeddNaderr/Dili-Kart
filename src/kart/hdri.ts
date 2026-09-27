import * as THREE from "three";
import { EXRLoader } from "three/examples/jsm/loaders/EXRLoader.js";

/**
 * Real-world lighting from photographed HDR panoramas (Poly Haven, CC0, via
 * @pmndrs/assets). Each one is fetched on demand as its own small chunk, so
 * the first screen never waits for it.
 */
const SOURCES = {
  studio: () => import("@pmndrs/assets/hdri/studio.exr.js"),
  sunset: () => import("@pmndrs/assets/hdri/sunset.exr.js"),
  night: () => import("@pmndrs/assets/hdri/night.exr.js"),
} as const;
export type HdriName = keyof typeof SOURCES;

const cache = new Map<HdriName, Promise<THREE.DataTexture>>();

function load(name: HdriName) {
  let p = cache.get(name);
  if (!p) {
    p = SOURCES[name]().then((m) => new EXRLoader().loadAsync((m as { default: string }).default)).then((t) => {
      t.mapping = THREE.EquirectangularReflectionMapping;
      return t;
    });
    cache.set(name, p);
  }
  return p;
}

/** A pre-filtered environment map for this renderer, ready for scene.environment. */
export async function hdriEnvironment(renderer: THREE.WebGLRenderer, name: HdriName): Promise<THREE.Texture> {
  const tex = await load(name);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromEquirectangular(tex);
  pmrem.dispose();
  return rt.texture;
}
