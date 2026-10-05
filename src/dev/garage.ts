import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { KartModel, RIVAL_LOOKS, lookFor } from "../kart/models";
import { MascotModel, type DriverId, type Pose } from "../kart/mascot";
import { blobTex } from "../kart/textures";
import { isSkinDriver } from "../kart/chibi";
import type { CharId } from "../../shared/rules";

/**
 * Model garage (dev only): /garage.html?what=kart&char=dili&yaw=0.6&dist=6
 *
 *   what   kart | mascot | rival      char  a driver id    pose  a mascot pose
 *   yaw    camera angle round the model (radians)          dist  camera distance
 *   h      camera height                                   look  look-at height
 *   t      animation time (seconds)
 *
 * Renders one still with the menu's studio light, for close inspection.
 */
const q = new URLSearchParams(location.search);
const num = (k: string, d: number) => (q.has(k) ? Number(q.get(k)) : d);
const what = q.get("what") ?? "kart";
const char = (q.get("char") ?? "dili") as DriverId;

const host = document.getElementById("stage")!;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.25;
renderer.shadowMap.enabled = true;
host.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color("#10132a");
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;
scene.add(new THREE.HemisphereLight("#b9c8ff", "#1a1530", 0.9));
const key = new THREE.DirectionalLight("#fff3e2", 2.4);
key.position.set(-4, 8, 7);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5 });
key.shadow.bias = -0.0004;
scene.add(key);
const rim = new THREE.DirectionalLight("#5d86ff", 2.2);
rim.position.set(6, 5, -6);
scene.add(rim);
const floor = new THREE.Mesh(new THREE.CircleGeometry(6, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: "#1d2136", roughness: 0.6, metalness: 0.2 }));
floor.receiveShadow = true;
scene.add(floor);

const t = num("t", 1.2);
const draw = () => {
  renderer.render(scene, cam);
  const w = window as unknown as { __done: boolean; __calls: number; __tris: number };
  w.__calls = renderer.info.render.calls;
  w.__tris = renderer.info.render.triangles;
  w.__done = true;
};
let lookY = 1.0;
if (what === "mascot") {
  const m = new MascotModel(char);
  m.pose = (q.get("pose") ?? "idle") as Pose;
  m.root.traverse((o) => { (o as THREE.Mesh).castShadow = true; });
  scene.add(m.root);
  for (let i = 0; i < 90; i++) m.update(t * i / 90, 1 / 60);
  lookY = 1.25;
} else {
  const skin = q.get("skin") ?? (isSkinDriver(char) ? char : null);
  const look = what === "rival" ? RIVAL_LOOKS[num("n", 0)] : lookFor((skin ? "dili" : char) as CharId, skin as never);
  const k = new KartModel(look, blobTex("rgba(0,0,0,.55)", "rgba(0,0,0,0)"), { lite: q.has("lite") });
  scene.add(k.root, k.shadowRoot);
  k.update({ speed: 0, steer: 0, slide: 0, hop: 0, squash: 1, roll: 0, flip: 0, boost: 0, glide: 0, wave: num("wave", 0), time: t }, 1 / 60);
  lookY = 0.9;
}

const cam = new THREE.PerspectiveCamera(num("fov", 32), innerWidth / innerHeight, 0.05, 100);
const yaw = num("yaw", 0.6), dist = num("dist", 6.5);
cam.position.set(Math.sin(yaw) * dist, num("h", 2.2), Math.cos(yaw) * dist);
cam.lookAt(0, num("look", lookY), 0);
// Studio HDRI, like the menus.
void import("../kart/hdri").then(({ hdriEnvironment }) => hdriEnvironment(renderer, "studio")).then((env) => {
  scene.environment = env;
  scene.environmentIntensity = 0.8;
  draw();
}).catch(draw);
