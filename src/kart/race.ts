import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { DRIVE_LIMIT, EDGE, TRACKS, Track, laneX, newFrame, type Frame } from "./track";
import { buildTown } from "./town";
import { buildWorld, crowdTime, gridSlot, type Quality, type World } from "./world";
import * as M from "./models";
import * as T from "./textures";
import { Confetti, Particles } from "./fx";
import { RaceAudio } from "./sound";
import { Hud, ITEM_NAME, type ItemKind } from "./hud";
import { TRACK_INFO, type CharId, type SkinId, type TrackId } from "../../shared/rules";
import { MASCOT } from "./mascot";
import { tickNature } from "./nature";
import { ContactAO, gradePass } from "./grade";
import { portrait, skinPortrait } from "../ui/icons";

/**
 * DILI CART — a three-lap Grand Prix against the Custodians.
 *
 * Score comes from coins, mini-turbos, tricks, overtakes and takedowns,
 * plus a finishing bonus for position and time. The Custodians race for
 * real, rubber-band to stay close, and throw goo and freeze orbs at you.
 */

export const LAPS = 3;
const TOP = 24;               // m/s with the gas held
const CRUISE = 0.66;          // fraction of TOP when you let go of the gas
const BOOST_TOP = 34;
const CENTRIFUGAL = 0.3;
const RIVALS = 7;

export type TallyKey = "coins" | "turbos" | "stunts" | "passes" | "takedowns" | "laps";

export interface RaceResult {
  tally: Record<TallyKey, number>;
  score: number;
  position: number;
  coins: number;
  time: number;
  bestLap: number;
  takedowns: number;
  turbos: number;
  tricks: number;
  finishBonus: number;
  timeBonus: number;
  laps: number;
  track: TrackId;
}

export interface RaceHooks {
  onEnd(r: RaceResult): void;
  onRestart(): void;
  onQuit(): void;
  /** Attract mode: the camera director just cut to a new shot. */
  onCut?(): void;
  /** The world is built and the first frame is about to draw. */
  onReady?(): void;
}

export interface MountOptions {
  /**
   * A live backdrop for the menus: every kart on autopilot, a camera director
   * cutting between broadcast shots, no HUD, no sound, no input.
   */
  attract?: boolean;
  /**
   * Dev only: the trailer renderer drives the race frame by frame (no
   * animation loop), films it with its own cameras and lets the player's
   * kart drive itself. Silent, no HUD.
   */
  trailer?: boolean;
  /** The player's equipped shop skin. */
  skin?: SkinId | null;
  /** Which track to race on. */
  track?: TrackId;
}

type ShotKind = "heli" | "chase" | "front" | "trackside" | "jump" | "low";

/** Plays the audio API but makes no sound, for the attract-mode backdrop. */
const SILENT = new Proxy({}, { get: () => () => undefined }) as unknown as RaceAudio;

type Phase = "load" | "intro" | "countdown" | "race" | "finish";

interface Racer {
  i: number;
  player: boolean;
  model: M.KartModel;
  dist: number;
  lat: number;
  latV: number;
  speed: number;
  steer: number;
  slide: number;
  hop: number;
  hopV: number;
  squash: number;
  air: boolean;
  y: number;
  vy: number;
  airT: number;
  spin: number;
  spinAng: number;
  flip: number;
  boostT: number;
  finished: boolean;
  skill: number;
  bias: number;
  aggro: number;
  itemT: number;
  shoveT: number;
  bumpT: number;
  frozen: number;
  prevU: number;
  color: string;
}

interface Coin { kind: T.CoinKind; u: number; lat: number; h: number; alive: boolean; respawn: number; pop: number; phase: number; }
interface Box { u: number; lat: number; obj: THREE.Group; alive: boolean; respawn: number; phase: number; }
interface Pad { u: number; lat: number; tex: THREE.Texture; }
interface Hazard {
  kind: "bollard" | "cone" | "drone" | "goo";
  u: number; lat: number; r: number; obj: THREE.Object3D;
  life: number; phase: number; knocked: number; kv: THREE.Vector3; base: number; span: number;
  /** Warning ring painted on the road under a drone. */
  ring: THREE.Mesh | null;
}
interface Orb { u: number; lat: number; speed: number; life: number; obj: THREE.Object3D; }

const V = () => new THREE.Vector3();

export class DiliCart {
  private renderer!: THREE.WebGLRenderer;
  private composer!: EffectComposer;
  private bloom!: UnrealBloomPass;
  /** Ambient occlusion, on capable machines during a real race only. */
  private ao: ContactAO | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(64, 1, 0.4, 4000);
  private track = new Track();
  private world!: World;
  private hud!: Hud;
  private audio = new RaceAudio();
  private sparks = new Particles(1400, true);
  private puffs = new Particles(500, false);
  private confetti = new Confetti();
  private mountEl!: HTMLElement;
  private hooks!: RaceHooks;
  private raf = 0;
  private timer = new THREE.Timer();
  private alive = true;

  private phase: Phase = "load";
  private phaseT = 0;
  private time = 0;
  private raceT = 0;
  private paused = false;

  private racers: Racer[] = [];
  private coins: Coin[] = [];
  private coinMesh = new Map<T.CoinKind, THREE.InstancedMesh>();
  private boxes: Box[] = [];
  private pads: Pad[] = [];
  private hazards: Hazard[] = [];
  private orbs: Orb[] = [];
  private shield!: THREE.Mesh;
  private magnet!: THREE.Group;

  // Player state
  private input = { left: false, right: false, gas: false, down: false };
  private pressed = new Set<string>();
  private driftDir = 0;
  private driftT = 0;
  private driftTier = 0;
  private turnHeld = 0;
  /** During a drift: 1 holding into it, -1 counter-steering, 0 neither. */
  private driftHold = 0;
  /** How long the player has been counter-steering the current drift. */
  private counterT = 0;
  private item: ItemKind | null = null;
  private rolling = false;
  private shieldT = 0;
  private magnetT = 0;
  private trick = false;
  private gasSince = -1;
  private coinCount = 0;
  private coinStreak = 0;
  private coinStreakT = 0;
  private score = 0;
  private tally: Record<TallyKey, number> = { coins: 0, turbos: 0, stunts: 0, passes: 0, takedowns: 0, laps: 0 };
  private takedowns = 0;
  private turbos = 0;
  private tricks = 0;
  private lastPos = RIVALS + 1;
  private lap = 1;
  private lapStart = 0;
  private bestLap = Infinity;
  private shake = 0;
  private hitCool = 0;
  /** Seconds until any Custodian may throw goo or an orb again. */
  private attackCool = 6;
  private result: RaceResult | null = null;
  private skipIntro = false;

  // Camera
  private camPos = V();
  private camLook = V();
  private camReady = false;
  private fov = 64;
  private introPath: THREE.CatmullRomCurve3 | null = null;
  private introLook: THREE.CatmullRomCurve3 | null = null;

  // Scratch
  private f = newFrame();
  private f2 = newFrame();
  private m4 = new THREE.Matrix4();
  private v1 = V();
  private v2 = V();
  private v3 = V();
  private col = new THREE.Color();
  private q1 = new THREE.Quaternion();

  // Perf
  private frameMs: number[] = [];
  private lowered = false;

  /* ================================================================ */
  /* Setup                                                            */
  /* ================================================================ */

  private char: CharId = "dili";
  private skin: SkinId | null = null;
  private trackId: TrackId = "circuit";
  private laps = LAPS;
  private attract = false;
  private trailer = false;
  /** Trailer: films the frame instead of the game's own cameras; returns the fov. */
  director: ((cam: THREE.PerspectiveCamera, dt: number) => number) | null = null;
  /** Trailer autopilot: fire items as they come. The intro film turns this off. */
  autoItems = true;
  /** Intro film (dev only): adjust a kart's pose before it's applied. */
  poseOverride: ((i: number, pose: M.KartPose) => M.KartPose) | null = null;
  private shot = { kind: "heli" as ShotKind, t: 0, dur: 0, who: 0, n: 0, pos: V(), look: V(), side: 1 };
  private frameSkip = false;
  private skipped = 0;
  /**
   * Phones and low-core machines get a lighter build: fewer and simpler
   * trees, smaller shadows, lower resolution. Everything else is the same.
   */
  private quality: Quality = matchMedia("(pointer: coarse)").matches
    || Math.min(screen.width, screen.height) < 700
    || (navigator.hardwareConcurrency ?? 8) <= 4 ? "low" : "high";

  mount(el: HTMLElement, hooks: RaceHooks, char: CharId = "dili", opts: MountOptions = {}) {
    this.mountEl = el;
    this.hooks = hooks;
    this.char = char;
    this.skin = opts.skin ?? null;
    this.trackId = opts.track ?? "circuit";
    if (this.trackId !== "circuit") this.track = new Track(TRACKS[this.trackId]);
    this.laps = TRACK_INFO[this.trackId].laps;
    this.attract = opts.attract === true;
    this.trailer = opts.trailer === true;
    if (this.attract || this.trailer) {
      this.audio = SILENT;
      el.classList.add("attract");
    }
    this.hud = new Hud(el, {
      resume: () => this.setPaused(false),
      restart: () => this.hooks.onRestart(),
      quit: () => this.hooks.onQuit(),
    }, { name: TRACK_INFO[this.trackId].name, laps: this.laps, night: this.trackId === "town" });

    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    // The attract backdrop sits behind the menus, so it can afford fewer pixels.
    const maxRatio = this.trailer ? 1 : this.attract ? (this.quality === "low" ? 0.75 : 1) : this.quality === "low" ? 1.25 : 1.5;
    if (this.trailer) this.quality = "high";
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, maxRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.24;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    const cv = this.renderer.domElement;
    Object.assign(cv.style, { width: "100%", height: "100%", display: "block", position: "absolute", inset: "0" });
    el.prepend(cv);

    addEventListener("resize", this.resize);
    if (!this.attract && !this.trailer) {
      addEventListener("keydown", this.onKey);
      addEventListener("keyup", this.onKey);
      addEventListener("blur", this.onBlur);
      document.addEventListener("visibilitychange", this.onVis);
      // A click or tap skips the intro fly-over too.
      el.addEventListener("pointerdown", this.onTap);
    }

    void this.load();
  }

  private async load() {
    // Canvas textures paint text, so the display font must be ready first.
    // The jumbotrons show the player's squad member, drawn from the same
    // SVG portrait the menus use.
    const c = MASCOT[this.char];
    const img = new Image();
    const svg = this.skin === "quang" || this.skin === "cipher" ? skinPortrait(this.skin) : portrait(c.head, c.dome, c.mouth);
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg.replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" '));
    await Promise.race([
      Promise.all([
        document.fonts?.load("900 64px 'Inter'").catch(() => undefined),
        document.fonts?.load("italic 900 64px 'Inter'").catch(() => undefined),
        img.decode().catch(() => undefined),
      ]),
      new Promise((r) => setTimeout(r, 2500)),
    ]);
    if (!this.alive) return;

    const portraitImg = img.complete && img.naturalWidth ? img : null;
    this.world = this.trackId === "town"
      ? buildTown(this.scene, this.renderer, this.track, portraitImg, this.quality)
      : buildWorld(this.scene, this.renderer, this.track, portraitImg, this.quality);
    this.scene.add(this.sparks.points, this.puffs.points, this.confetti.mesh);
    this.buildRacers();
    this.buildPickups();
    this.shield = M.shieldBubble();
    this.shield.visible = false;
    this.racers[0].model.body.add(this.shield);
    this.magnet = M.magnetAura();
    this.magnet.visible = false;
    this.racers[0].model.body.add(this.magnet);

    this.hud.buildMap(this.track.outline(10), this.racers.length);

    const composerTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: this.quality === "low" ? 2 : 4 });
    this.composer = new EffectComposer(this.renderer, composerTarget);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    if (this.quality === "high" && !this.attract && !this.trailer) {
      this.ao = new ContactAO(this.scene, this.camera, 256, 256);
      this.composer.addPass(this.ao);
      // Softer sun shadows to go with it.
      this.world.sun.shadow.radius = 2.5;
    }
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.45, 2.9);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.composer.addPass(gradePass());
    this.resize();

    // Warm the GPU: compile every shader before the first visible frame.
    this.placeAll(0);
    if (this.attract) this.startAttract();
    else this.startIntro();
    this.renderer.compile(this.scene, this.camera);

    this.hud.loaded();
    if (this.trailer) {
      this.hooks.onReady?.();
      return;
    }
    this.timer.reset();
    this.raf = requestAnimationFrame(this.frame);
    requestAnimationFrame(() => requestAnimationFrame(() => this.alive && this.hooks.onReady?.()));
    if (import.meta.env.DEV && !this.attract) {
      // Test hooks: step the simulation by hand (the preview pane throttles rAF).
      const w = window as unknown as Record<string, unknown>;
      w.__race = this;
      w.__step = (sec: number, fps = 60) => {
        const n = Math.max(0, Math.round(sec * fps));
        for (let i = 0; i < n; i++) { this.update(1 / fps); this.pressed.clear(); }
        this.composer.render();
        document.querySelector(".kh-load")?.remove();
        return { phase: this.phase, t: +this.phaseT.toFixed(2), pos: this.lastPos, score: this.score };
      };
      w.__keys = (k: Partial<typeof this.input>) => Object.assign(this.input, k);
      w.__press = (code: string) => this.pressed.add(code);
      // Free camera for inspection: render from anywhere and save the frame.
      w.__cam = async (px: number, py: number, pz: number, tx: number, ty: number, tz: number, name = "cam") => {
        this.camera.position.set(px, py, pz);
        this.camera.up.set(0, 1, 0);
        this.camera.lookAt(tx, ty, tz);
        this.composer.render();
        const url = this.renderer.domElement.toDataURL("image/jpeg", 0.85);
        await fetch(`/__shot?name=${name}`, { method: "POST", body: url });
        return name;
      };
      w.__pt = (u: number, lat = 0, lift = 0) => this.track.point(u, lat, lift).toArray().map((v) => +v.toFixed(1));
      // Render a frame and save it via the dev server (see vite.config.ts).
      w.__shot = async (name = "shot") => {
        this.composer.render();
        const url = this.renderer.domElement.toDataURL("image/jpeg", 0.85);
        await fetch(`/__shot?name=${name}`, { method: "POST", body: url });
        return name;
      };
      // Teleport the player to track position u (metres), for inspection.
      w.__warp = (u: number, lat = 0) => {
        const p = this.racers[0];
        const lapBase = Math.floor(p.dist / this.track.length) * this.track.length;
        p.dist = lapBase + this.track.wrap(u - this.track.startU);
        p.lat = lat;
        p.latV = 0;
        p.air = false;
        p.vy = 0;
        this.camReady = false;
        return this.track.ctrlU.map((x) => Math.round(x));
      };
    }
  }

  private buildRacers() {
    const shadowTex = T.blobTex("rgba(10,12,40,.62)", "rgba(10,12,40,0)");
    const make = (i: number, look: M.KartLook, slot: number) => {
      const model = new M.KartModel(look, shadowTex);
      this.scene.add(model.root, model.shadowRoot);
      const g = gridSlot(slot);
      const r: Racer = {
        i, player: i === 0, model,
        dist: g.du, lat: g.lat, latV: 0, speed: 0, steer: 0, slide: 0,
        hop: 0, hopV: 0, squash: 1, air: false, y: 0, vy: 0, airT: 0,
        spin: 0, spinAng: 0, flip: 0, boostT: 0, finished: false,
        skill: 1, bias: 0, aggro: 0, itemT: 12, shoveT: 0, bumpT: 0, frozen: 0,
        prevU: 0, color: look.trim,
      };
      r.prevU = this.track.wrap(this.track.startU + r.dist);
      this.racers.push(r);
      return r;
    };
    // The player starts at the back of the grid, like the reference — the
    // whole race is a climb through the field.
    make(0, M.lookFor(this.char, this.skin), RIVALS);
    // Front of the grid is quickest. All of them are a touch slower than a
    // player holding the gas, so passes come steadily rather than in a burst.
    const skills = [0.955, 0.94, 0.925, 0.91, 0.895, 0.88, 0.865];
    for (let k = 0; k < RIVALS; k++) {
      const r = make(k + 1, M.RIVAL_LOOKS[k], k);
      r.skill = skills[k];
      r.bias = ((k * 37) % 7) / 3 - 1;
      r.aggro = k % 3 === 0 ? 0.9 : k % 3 === 1 ? 0.5 : 0.2;
      r.itemT = 10 + k * 2.3;
    }
  }

  /** Coins, item boxes, boost pads and hazards, all placed by landmark. */
  private buildPickups() {
    const tr = this.track;
    const coin = (kind: T.CoinKind, u: number, lat: number, h = 1.15) =>
      this.coins.push({ kind, u: tr.wrap(u), lat, h, alive: true, respawn: 0, pop: 0, phase: Math.random() * 6 });
    const face = T.itemFaceTex();
    const spark = T.sparkleTex();
    const boxRow = (u: number) => {
      for (let l = 0; l < 4; l++) {
        const obj = M.itemBox(face, spark);
        this.scene.add(obj);
        this.boxes.push({ u: tr.wrap(u), lat: laneX(l), obj, alive: true, respawn: 0, phase: l * 0.7 });
      }
    };
    const chev = T.chevronTex();
    const frame = T.padFrameTex();
    const pad = (u: number, lat: number) => {
      const g = M.boostPad(chev, frame);
      tr.frame(u, this.f);
      this.orient(g, this.f, lat, 0.03);
      this.scene.add(g);
      this.pads.push({ u: tr.wrap(u), lat, tex: g.userData.chev as THREE.Texture });
    };
    // Hazards — always with an obvious free lane.
    const stripes = T.stripeTex("#ff7a1a", "#ffffff", 4);
    const hz = (kind: Hazard["kind"], u: number, lat: number) => {
      const obj = kind === "bollard" ? M.bollard(stripes) : kind === "cone" ? M.cone() : kind === "drone" ? M.drone() : M.goo();
      obj.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = kind !== "goo"; });
      this.scene.add(obj);
      const h: Hazard = {
        kind, u: tr.wrap(u), lat, r: kind === "bollard" ? 0.9 : kind === "cone" ? 0.7 : kind === "drone" ? 0.95 : 1.3,
        obj, life: kind === "goo" ? 14 : Infinity, phase: Math.random() * 6, knocked: 0, kv: V(), base: lat, span: 0, ring: null,
      };
      this.hazards.push(h);
      return h;
    };
    const ringMat = new THREE.MeshBasicMaterial({
      color: "#ff3355", transparent: true, opacity: 0.55,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3,
    });
    const ringGeo = new THREE.RingGeometry(1.1, 1.55, 32).rotateX(-Math.PI / 2);
    const drone = (u: number, span: number, phase = 0) => {
      const h = hz("drone", u, 0);
      h.ring = new THREE.Mesh(ringGeo, ringMat);
      this.scene.add(h.ring);
      h.span = span;
      h.phase += phase;
      return h;
    };
    // Over the gap: coins along the glide arc, BTC at the top.
    const glideCoins = () => {
      const lipY = tr.point(tr.lipU, 0, 0).y + 0.9;
      [[8, "dli"], [15, "eth"], [22, "btc"], [30, "eth"], [38, "dli"]].forEach(([dx, k]) => {
        const x = dx as number;
        const t = x / 24;
        const y = lipY + 7.5 * t - 5 * t * t;
        const u = tr.lipU + x;
        const road = tr.point(u, 0, 0).y;
        coin(k as T.CoinKind, u, 0, Math.max(1.4, y - road + 0.4));
      });
    };

    const c = tr.ctrlU;
    if (this.trackId === "town") {
      // Boulevard: two rails of coins, then a row of boxes.
      for (let k = 0; k < 5; k++) {
        coin("dli", tr.startU + 36 + k * 5, laneX(0));
        coin("dli", tr.startU + 36 + k * 5, laneX(3));
      }
      boxRow(tr.startU + 80);
      // First corner: an arc on the inside with an ETH at the apex.
      for (let k = 0; k < 5; k++) coin(k === 2 ? "eth" : "dli", c[3] + k * ((c[4] - c[3]) / 5), 5);
      // High street: a zigzag, and a BTC tucked against the far curb.
      for (let k = 0; k < 7; k++) coin("dli", c[5] + k * 6, (k % 2 ? 1 : -1) * 4.2);
      coin("btc", c[6] + 6, -7.6);
      boxRow(c[6] - 8);
      // The ramp: coins up the middle, boost pads, and over the canal.
      for (let k = 0; k < 4; k++) coin("dli", c[8] - 14 + k * 5, laneX(2) - 0.6);
      pad(c[8] + 6, laneX(1));
      pad(c[8] + 6, laneX(2));
      glideCoins();
      // Waterfront: ETH on the curb edge.
      coin("eth", c[11] + 4, 8.2);
      coin("eth", c[11] + 10, 8.2);
      pad(c[12] + 10, laneX(1));
      // Market street: weave along the racing line.
      for (let k = 0; k < 8; k++) coin(k === 4 ? "eth" : "dli", c[13] + k * ((c[16] - c[13]) / 8), Math.sin(k * 0.9) * 5);
      boxRow(c[14] + 4);
      coin("btc", c[16] + 4, 7.6);
      pad(c[17] + 4, laneX(2));
      // Hazards.
      hz("bollard", c[2] - 8, laneX(0));
      hz("bollard", c[2] - 8, laneX(1));
      for (let k = 0; k < 3; k++) hz("cone", c[5] - 6 + k * 2.2, laneX(3) + (k - 1) * 1.1);
      hz("bollard", c[11] + 16, laneX(3));
      hz("bollard", c[11] + 16, laneX(2));
      for (let k = 0; k < 3; k++) hz("cone", c[15] + 3 + k * 2.2, laneX(0) - 0.3 + (k % 2) * 0.8);
      drone(c[7] - 16, 6.5);
      drone(c[13] + 10, 6.5, Math.PI);
      drone(c[17] - 6, 5.5);
    } else {
      // Main straight: two rails of coins.
      for (let k = 0; k < 5; k++) {
        coin("dli", tr.startU + 46 + k * 5, laneX(0));
        coin("dli", tr.startU + 46 + k * 5, laneX(3));
      }
      // Top hairpin: an arc on the inside line, with an ETH at the apex.
      for (let k = 0; k < 6; k++) {
        const u = c[3] + 6 + k * ((c[5] - c[3]) / 6);
        coin(k === 3 ? "eth" : "dli", u, 4.8);
      }
      // BTC on the outside of the hairpin exit — you have to commit to it.
      coin("btc", c[6] - 4, -6.8);
      // Back straight, lined up for the jump.
      for (let k = 0; k < 4; k++) coin("dli", c[7] - 18 + k * 6, laneX(1) + 1);
      glideCoins();
      // S-bends: coins weaving along the ideal line.
      for (let k = 0; k < 8; k++) {
        const u = c[14] + k * ((c[17] - c[14]) / 8);
        coin(k === 4 ? "eth" : "dli", u, Math.sin(k * 0.9) * 5);
      }
      // Bottom hairpin exit: two ETH on the edge of the curb.
      coin("eth", c[19] - 10, -8.2);
      coin("eth", c[19] - 4, -8.2);
      for (const u of [tr.startU + 120, c[10] + 18, c[16] - 12]) boxRow(u);
      // Boost pads: before the jump (two), hairpin exit, S entry, onto the straight.
      pad(c[7] + 4, laneX(1));
      pad(c[7] + 4, laneX(2));
      pad(c[6] + 12, laneX(2));
      pad(c[12] + 8, laneX(1));
      pad(c[19] + 6, laneX(2));
      hz("bollard", c[2] + 14, laneX(0));
      hz("bollard", c[2] + 14, laneX(1));
      hz("bollard", c[11] + 4, laneX(3));
      hz("bollard", c[11] + 4, laneX(2));
      hz("bollard", c[15] + 2, laneX(1) + 0.6);
      for (let k = 0; k < 3; k++) hz("cone", c[13] + 6 + k * 2.2, laneX(3) + (k - 1) * 1.1);
      for (let k = 0; k < 3; k++) hz("cone", c[4] + 3 + k * 2.2, laneX(0) - 0.3 + (k % 2) * 0.8);
      drone(c[7] - 34, 6.5);
      drone(c[10] + 44, 6.5, Math.PI);
      drone(c[18] + 6, 5.5);
    }

    // Instanced coin meshes, one per kind.
    for (const kind of ["dli", "eth", "btc"] as T.CoinKind[]) {
      const n = this.coins.filter((x) => x.kind === kind).length;
      const im = new THREE.InstancedMesh(M.coinGeometry(kind), M.coinMaterials(kind), n);
      im.castShadow = true;
      im.frustumCulled = false;
      this.scene.add(im);
      this.coinMesh.set(kind, im);
    }
  }

  /* ================================================================ */
  /* Input                                                            */
  /* ================================================================ */

  private onKey = (e: KeyboardEvent) => {
    const down = e.type === "keydown";
    const k = e.code;
    if (down && (k === "Escape" || k === "KeyP")) {
      if (this.phase === "race" || this.phase === "countdown") this.setPaused(!this.paused);
      e.preventDefault();
      return;
    }
    if (down && k === "Enter" && this.paused) { this.setPaused(false); return; }
    let handled = true;
    switch (k) {
      case "ArrowLeft": case "KeyA": this.input.left = down; break;
      case "ArrowRight": case "KeyD": this.input.right = down; break;
      case "ArrowUp": case "KeyW":
        if (down && !this.input.gas) this.gasSince = this.phaseT;
        this.input.gas = down;
        break;
      case "ArrowDown": case "KeyS": case "Space": this.input.down = down; break;
      default: handled = false;
    }
    if (!handled) return;
    e.preventDefault();
    if (down && !e.repeat) this.pressed.add(k === "KeyA" ? "ArrowLeft" : k === "KeyD" ? "ArrowRight" : k === "KeyW" ? "ArrowUp" : k === "KeyS" || k === "Space" ? "ArrowDown" : k);
  };

  private onTap = () => {
    if (this.phase === "intro" && this.phaseT > 0.3) this.skipIntro = true;
  };

  private onBlur = () => {
    this.input = { left: false, right: false, gas: false, down: false };
    if (this.phase === "race") this.setPaused(true);
  };

  private onVis = () => {
    if (document.hidden) this.onBlur();
  };

  private setPaused(p: boolean) {
    if (this.phase !== "race" && this.phase !== "countdown") p = false;
    this.paused = p;
    this.hud.paused(p);
    this.audio.setMusic(p ? 0.3 : 1);
    this.audio.engine(0, 0, false);
    if (!p) this.timer.reset();
  }

  /* ================================================================ */
  /* Loop                                                             */
  /* ================================================================ */

  private frame = (now: number) => {
    if (!this.alive) return;
    this.raf = requestAnimationFrame(this.frame);
    this.timer.update(now);
    // The rAF timestamp can land a hair before the timer's reset point, so
    // the raw delta can be slightly negative; never let time run backwards.
    const got = this.timer.getDelta();
    const raw = Number.isFinite(got) ? Math.max(0, got) : 0;
    // Phones run the attract backdrop at half rate to leave room for the menus.
    if (this.attract && this.quality === "low") {
      this.frameSkip = !this.frameSkip;
      if (this.frameSkip) { this.skipped += raw; return; }
    }
    const dt = Math.min(raw + this.skipped, 1 / 20);
    this.skipped = 0;
    if (!this.paused) this.update(dt);
    this.composer.render();
    this.pressed.clear();
    this.watchPerf(raw);
  };

  private update(dt: number) {
    this.time += dt;
    this.phaseT += dt;
    const player = this.racers[0];

    switch (this.phase) {
      case "intro": this.updateIntro(); break;
      case "countdown": this.updateCountdown(); break;
      case "race": this.raceT += dt; break;
      case "finish": if (this.phaseT > 3.4 && !this.result) this.endRace(); break;
    }

    const moving = this.phase === "race" || this.phase === "finish";
    if (moving && this.attract) {
      for (const r of this.racers) this.updateRival(r, dt);
      this.bumps(dt);
      // Endless race: roll everyone back a lap together so nobody "finishes".
      if (player.dist > this.track.length * 2) for (const r of this.racers) { r.dist -= this.track.length; r.finished = false; }
    } else if (moving) {
      this.updatePlayer(player, dt);
      for (let k = 1; k < this.racers.length; k++) this.updateRival(this.racers[k], dt);
      this.bumps(dt);
      this.collide(player, dt);
      this.updateOrbs(dt);
      this.standings();
    }
    this.updateHazards(dt);
    this.updateProps(dt);
    this.placeAll(dt);
    this.driftFx();
    this.sparks.update(dt);
    this.puffs.update(dt);
    this.confetti.update(dt);
    this.updateCamera(dt);
    if (!this.attract) this.updateHud();
    this.audio.drive({
      speed: player.speed,
      boost: Math.min(1, player.boostT),
      running: moving,
      gas: this.input.gas,
      offroad: !player.air && Math.abs(player.lat) > EDGE + 0.4,
      air: player.air,
      rival: this.nearestRival(player),
    });
    this.audio.squealing(this.driftDir !== 0 && !player.air, this.driftTier);
  }

  /** The closest Custodian, for the engine sound that passes you. */
  private nearestRival(p: Racer) {
    let best: Racer | null = null, gap = Infinity;
    for (let k = 1; k < this.racers.length; k++) {
      const d = this.racers[k].dist - p.dist;
      if (Math.abs(d) < Math.abs(gap)) { gap = d; best = this.racers[k]; }
    }
    return best ? { gap, side: best.lat - p.lat, speed: best.speed } : null;
  }

  /* ================================================================ */
  /* Phases                                                           */
  /* ================================================================ */

  /** Attract mode: the race is already on when the backdrop fades in. */
  private startAttract() {
    this.phase = "race";
    this.phaseT = 0;
    this.raceT = 30;
    this.attackCool = Infinity;
    const p = this.racers[0];
    p.skill = 0.93;
    p.bias = 0.3;
    // Spread the field a little so every shot has karts in it.
    this.racers.forEach((r, k) => {
      r.dist = 140 - k * 7 + (k % 2) * 2;
      r.speed = 16;
      r.prevU = this.track.wrap(this.track.startU + r.dist);
    });
    this.nextShot(true);
  }

  /** Broadcast-style shots, cut every few seconds. */
  private nextShot(first = false) {
    const order: ShotKind[] = ["heli", "chase", "trackside", "front", "jump", "low", "chase", "heli", "front", "trackside"];
    const s = this.shot;
    s.n = first ? 0 : s.n + 1;
    s.kind = order[s.n % order.length];
    s.t = 0;
    s.dur = s.kind === "heli" ? 9 : s.kind === "trackside" || s.kind === "jump" ? 6.5 : 7;
    s.who = Math.floor(Math.random() * this.racers.length);
    s.side = Math.random() < 0.5 ? -1 : 1;
    const tr = this.track;
    // Leader of the pack, for shots that wait for the field to arrive.
    const lead = this.racers.reduce((a, b) => (b.dist > a.dist ? b : a));
    const lu = tr.wrap(tr.startU + lead.dist);
    if (s.kind === "trackside") {
      const u = lu + 55;
      tr.frame(u, this.f2);
      s.pos.copy(tr.point(u, s.side * (EDGE + 3.5), 0)).y += 1.6;
      s.look.copy(lead.model.root.position);
    } else if (s.kind === "jump") {
      // If the pack is near the jump, watch them fly; otherwise go wide.
      const toJump = tr.delta(lu, tr.lipU);
      if (toJump > 10 && toJump < 90) {
        const u = tr.lipU + 12;
        s.pos.copy(tr.point(u, s.side * 22, 0)).y += 7;
        s.look.copy(tr.point(tr.lipU, 0, 2));
      } else {
        s.kind = "low";
      }
    }
    if (!first) this.hooks.onCut?.();
  }

  private directCamera(dt: number) {
    const s = this.shot;
    const cam = this.camera;
    s.t += dt;
    if (s.t > s.dur) this.nextShot();
    const who = this.racers[s.who];
    const kart = who.model.root.position;
    const tr = this.track;
    let fov = 50;
    if (s.kind === "heli") {
      // Slow orbit high over the stands, the city skyline behind.
      const c = this.world.center;
      const a = this.time * 0.05 + s.n;
      cam.position.set(c.x + Math.cos(a) * 330, 95 + Math.sin(this.time * 0.1) * 10, c.z + Math.sin(a) * 330);
      this.v1.copy(c).setY(10);
      cam.up.set(0, 1, 0);
      cam.lookAt(this.v1);
      fov = 52;
    } else if (s.kind === "chase") {
      const c = this.chaseTarget(who);
      if (s.t < 0.05) { this.camPos.copy(c.pos); this.camLook.copy(c.look); }
      this.camPos.lerp(c.pos, 1 - Math.exp(-dt * 9));
      this.camLook.lerp(c.look, 1 - Math.exp(-dt * 14));
      cam.position.copy(this.camPos);
      cam.up.set(0, 1, 0);
      cam.lookAt(this.camLook);
      fov = 62;
    } else if (s.kind === "front" || s.kind === "low") {
      // Tracking shot ahead of a kart, looking back at the driver.
      const u = tr.wrap(tr.startU + who.dist);
      tr.frame(u, this.f2);
      const f = this.f2;
      const ahead = s.kind === "front" ? 6.5 : 9;
      const want = this.v1.copy(kart).addScaledVector(f.tan, ahead).addScaledVector(f.side, s.side * (s.kind === "front" ? 1.6 : 3.2));
      want.y += s.kind === "front" ? 1.5 : 0.6;
      if (s.t < 0.05) this.camPos.copy(want);
      this.camPos.lerp(want, 1 - Math.exp(-dt * 6));
      cam.position.copy(this.camPos);
      cam.up.set(0, 1, 0);
      cam.lookAt(this.v2.copy(kart).setY(kart.y + (s.kind === "front" ? 1.1 : 1.6)));
      fov = s.kind === "front" ? 46 : 58;
    } else {
      // A fixed camera that pans with the nearest kart.
      let near = who;
      let best = Infinity;
      for (const r of this.racers) {
        const d = r.model.root.position.distanceToSquared(s.pos);
        if (d < best) { best = d; near = r; }
      }
      s.look.lerp(this.v1.copy(near.model.root.position).setY(near.model.root.position.y + 1), 1 - Math.exp(-dt * 4));
      cam.position.copy(s.pos);
      cam.up.set(0, 1, 0);
      cam.lookAt(s.look);
      fov = s.kind === "jump" ? 55 : 48;
      // Cut away once the pack has gone by.
      if (s.t > 2.5 && best > 110 * 110) s.t = s.dur;
    }
    return fov;
  }

  private startIntro() {
    this.phase = "intro";
    this.phaseT = 0;
    const tr = this.track;
    const p = this.racers[0];
    const u = tr.wrap(tr.startU + p.dist);
    tr.frame(u, this.f);
    const f = this.f;
    const kart = tr.point(u, p.lat, 0);
    const at = (fw: number, sd: number, up: number, base = kart) =>
      base.clone().addScaledVector(f.tan, fw).addScaledVector(f.side, sd).add(new THREE.Vector3(0, up, 0));
    const gate = tr.point(tr.startU, 0, 0);
    // Swoop over the stands, past the gate, down to Dili's face while he
    // waves, then round his side into the chase position. In town the
    // street is walled in by buildings, so the swoop comes down the street.
    const chase = this.chaseTarget(p);
    const town = this.trackId === "town";
    this.introPath = new THREE.CatmullRomCurve3([
      town ? at(-80, 0, 30, gate) : at(-60, -42, 34, gate),
      town ? at(16, -7, 13, gate) : at(16, -28, 15, gate),
      at(11, 8, 5),
      at(5.4, 1.8, 2.1),
      at(4.6, -0.9, 2.2),
      at(0.4, -5.2, 2.6),
      at(-5.6, -3.2, 3.1),
      chase.pos,
    ], false, "centripetal");
    this.introLook = new THREE.CatmullRomCurve3([
      at(40, 0, 2, gate),
      at(0, 0, 8, gate),
      at(0, 0, 1.4),
      at(0, 0, 1.8),
      at(0, 0, 1.8),
      at(0, 0, 1.6),
      at(3, 0, 1.4),
      chase.look,
    ], false, "centripetal");
    this.hud.title(true);
    this.audio.start();
    this.audio.setMusic(0.6);
  }

  private updateIntro() {
    if (this.trailer) return;   // the trailer starts the countdown itself
    const t = Math.min(1, this.phaseT / INTRO_LEN);
    if (this.phaseT > 2.4) this.hud.title(false);
    const any = this.pressed.size > 0;
    if (any && this.phaseT > 0.3) this.skipIntro = true;
    if (t >= 1 || this.skipIntro) this.startCountdown();
  }

  private startCountdown() {
    this.phase = "countdown";
    this.phaseT = 0;
    this.gasSince = this.input.gas ? -10 : -1;
    this.hud.title(false);
    this.camReady = false;
    this.hud.racing(true);
    this.audio.setMusic(0.5);
  }

  private updateCountdown() {
    const t = this.phaseT;
    const n = t < 1 ? 3 : t < 2 ? 2 : t < 3 ? 1 : 0;
    const lamps = this.world.gateLamps;
    lamps.forEach((l, i) => {
      const mat = l.material as THREE.MeshStandardMaterial;
      // Modest intensity keeps the lamps saturated red/green after tone mapping.
      if (n === 0) {
        mat.emissive.set("#1bff4f");
        mat.emissiveIntensity = 1.5;
      } else {
        mat.emissive.set("#ff1a2e");
        mat.emissiveIntensity = i < 4 - n ? 1.6 : 0;
      }
    });
    const label = n === 0 ? "GO!" : String(n);
    if (this.hudLast !== label) {
      this.hudLast = label;
      this.audio.beep(n === 0);
    }
    this.hud.countdown(label, n === 0);
    if (t >= 3) this.startRace();
  }
  private hudLast = "";

  private startRace() {
    this.phase = "race";
    this.phaseT = 0;
    this.raceT = 0;
    this.lapStart = 0;
    this.audio.setMusic(1);
    setTimeout(() => this.hud.countdown(null), 800);
    this.hud.hint(true);
    setTimeout(() => this.alive && this.hud.hint(false), 7000);
    const p = this.racers[0];
    // Rocket start: press ↑ once "2" is showing and hold it through GO.
    if (this.input.gas && this.gasSince >= 1.0) {
      p.boostT = 1.0;
      p.speed = 12;
      this.hud.pop("ROCKET START!", "gold big");
      this.addScore(50, "stunts");
      this.audio.boost();
      this.hud.flash("#ffe14d");
    } else if (this.input.gas) {
      p.speed = 4;
    }
    // The Custodians get a clean launch too.
    for (let k = 1; k < this.racers.length; k++) {
      const r = this.racers[k];
      r.speed = 5 + (k % 3) * 1.5;
      if (k <= 2) r.boostT = 0.6;
    }
  }

  private finishRace() {
    const p = this.racers[0];
    p.finished = true;
    this.phase = "finish";
    this.phaseT = 0;
    this.driftDir = 0; this.driftTier = 0; this.driftT = 0;
    this.hud.banner("FINISH!", "", 2600);
    this.audio.fanfare();
    this.audio.setMusic(0.45);
    this.confetti.burst(this.v1.copy(this.racers[0].model.root.position).add(new THREE.Vector3(0, 5, 0)), 160, 9, 12);
  }

  private endRace() {
    const pos = this.lastPos;
    const finishBonus = [1000, 700, 500, 350, 250, 150, 100, 50][pos - 1] ?? 50;
    const timeBonus = Math.max(0, Math.round((this.track.def.par - this.raceT) * 8));
    const r: RaceResult = {
      tally: { ...this.tally },
      score: this.score + finishBonus + timeBonus,
      position: pos,
      coins: this.coinCount,
      time: this.raceT,
      bestLap: this.bestLap,
      takedowns: this.takedowns,
      turbos: this.turbos,
      tricks: this.tricks,
      finishBonus,
      timeBonus,
      laps: this.laps,
      track: this.trackId,
    };
    this.result = r;
    this.hud.racing(false);
    this.hooks.onEnd(r);
  }

  /* ================================================================ */
  /* Player                                                           */
  /* ================================================================ */

  private updatePlayer(p: Racer, dt: number) {
    if (this.trailer) this.autoDrive(p, dt);
    const auto = this.phase === "finish";
    let want = 0;
    if (!auto) {
      if (this.input.left) want -= 1;
      if (this.input.right) want += 1;
    }
    const u = this.track.wrap(this.track.startU + p.dist);
    const curv = this.track.curvature(u + 10);

    // Tricks: tap any arrow just after leaving the ramp.
    if (p.air && !this.trick && p.airT < 0.7 && this.pressed.size > 0 && !auto) {
      this.trick = true;
      p.flip = 0;
      this.audio.trick();
    }

    // Drift: hold a direction and the kart hops into a slide. Keep holding
    // to charge blue → orange → purple; let go to fire the mini-turbo.
    if (!auto && !p.air && p.spin <= 0) {
      if (this.driftDir === 0) {
        if (want !== 0 && p.speed > 12) {
          this.turnHeld += dt;
          if (this.turnHeld > 0.28) {
            this.driftDir = want;
            this.driftT = 0;
            this.driftTier = 0;
            p.hopV = 3.4;
          }
        } else this.turnHeld = 0;
      } else if (want !== 0 && p.speed > 9 && this.counterT < 0.5) {
        // Holding into the drift tightens it; a quick tap the other way
        // widens it without losing the charge. Holding the other way for a
        // moment, or letting go of both, ends it and fires the turbo.
        this.counterT = want === -this.driftDir ? this.counterT + dt : 0;
        const cornerBoost = (0.55 + Math.min(1.1, Math.abs(curv) * 45)) * (want === this.driftDir ? 1 : 0.8);
        this.driftT += dt * cornerBoost;
        const tier = this.driftT > 2.6 ? 3 : this.driftT > 1.6 ? 2 : this.driftT > 0.75 ? 1 : 0;
        if (tier > this.driftTier) {
          this.driftTier = tier;
          this.audio.drift(tier);
        }
      } else {
        this.releaseDrift(p);
      }
    } else if (this.driftDir !== 0 && (p.spin > 0 || auto)) {
      this.driftDir = 0; this.driftT = 0; this.driftTier = 0; this.turnHeld = 0;
    }

    // Items.
    if (!auto && this.pressed.has("ArrowDown") && this.item && !this.rolling) this.useItem(p);
    const braking = !auto && this.input.down && !this.item;

    let steerIn = want;
    this.driftHold = want === this.driftDir ? 1 : want === -this.driftDir ? -1 : 0;
    if (auto) {
      // Autopilot after the flag: drift to the centre and coast down.
      steerIn = THREE.MathUtils.clamp(-p.lat * 0.15 - p.latV * 0.1 + curv * p.speed * p.speed * CENTRIFUGAL / 12, -1, 1);
    }
    const gas = auto ? this.phaseT < 2 : this.input.gas;
    this.drive(p, steerIn, gas, braking, dt, auto ? Math.max(0, 16 - this.phaseT * 3) / TOP : 1);

    // Timers.
    this.shieldT = Math.max(0, this.shieldT - dt);
    this.magnetT = Math.max(0, this.magnetT - dt);
    this.hitCool = Math.max(0, this.hitCool - dt);
    this.attackCool = Math.max(0, this.attackCool - dt);
    this.coinStreakT -= dt;
    if (this.coinStreakT <= 0) this.coinStreak = 0;
    this.shield.visible = this.shieldT > 0;
    if (this.shield.visible) {
      (this.shield.material as THREE.ShaderMaterial).uniforms.uTime.value = this.time;
      this.shield.scale.setScalar(this.shieldT < 2 ? 0.9 + Math.sin(this.time * 30) * 0.1 : 1);
    }
    this.magnet.visible = this.magnetT > 0;
    if (this.magnet.visible) {
      const ud = this.magnet.userData;
      (ud.a as THREE.Mesh).rotation.z = this.time * 2.4;
      (ud.b as THREE.Mesh).rotation.z = -this.time * 1.6;
      (ud.dash as THREE.Group).rotation.y = -this.time * 3.2;
      const pulse = 1 + Math.sin(this.time * 6) * 0.05;
      // Flicker for the last two seconds, like the shield.
      this.magnet.scale.setScalar(this.magnetT < 2 ? pulse * (0.9 + Math.sin(this.time * 30) * 0.1) : pulse);
    }

    // Laps.
    const lapNow = Math.min(this.laps, Math.floor(p.dist / this.track.length) + 1);
    if (p.dist >= this.laps * this.track.length && !p.finished) {
      this.closeLap();
      this.finishRace();
    } else if (lapNow > this.lap && p.dist > 0) {
      this.closeLap();
      this.lap = lapNow;
      this.addScore(100, "laps");
      if (lapNow === this.laps) {
        this.hud.banner("FINAL LAP!", "", 1900);
        this.audio.lap();
        this.audio.hurry();
      } else {
        this.hud.banner(`LAP ${lapNow}`, "white", 1500);
        this.audio.lap();
      }
      this.confetti.burst(this.v1.copy(p.model.root.position).add(new THREE.Vector3(0, 6, 0)), 70, 7, 8);
    }
  }

  private closeLap() {
    const t = this.raceT - this.lapStart;
    if (t < this.bestLap) this.bestLap = t;
    this.lapStart = this.raceT;
  }

  private releaseDrift(p: Racer) {
    if (this.driftTier > 0) {
      const dur = [0, 0.75, 1.3, 1.9][this.driftTier];
      p.boostT = Math.max(p.boostT, dur);
      const names = ["", "MINI-TURBO!", "SUPER TURBO!", "ULTRA TURBO!"];
      const cls = ["", "blue", "orange", "purple"];
      const pts = [0, 15, 30, 60][this.driftTier];
      this.hud.pop(`${names[this.driftTier]} +${pts}`, cls[this.driftTier]);
      this.addScore(pts, "turbos");
      this.turbos++;
      this.audio.boost();
      this.shake = Math.max(this.shake, 0.25 + this.driftTier * 0.1);
    }
    this.driftDir = 0;
    this.driftT = 0;
    this.driftTier = 0;
    this.turnHeld = 0;
    this.counterT = 0;
  }

  private useItem(p: Racer) {
    const it = this.item!;
    this.item = null;
    this.hud.item(null);
    switch (it) {
      case "turbo":
        p.boostT = Math.max(p.boostT, 1.8);
        this.audio.boost();
        this.hud.flash("#ffb300");
        this.shake = 0.5;
        break;
      case "shield":
        this.shieldT = 10;
        this.audio.shield();
        this.hud.flash("#5ec8ff");
        break;
      case "magnet":
        this.magnetT = 8;
        this.audio.get();
        this.hud.flash("#ff3d5a");
        break;
      case "zap": {
        let n = 0;
        for (let k = 1; k < this.racers.length; k++) {
          const r = this.racers[k];
          const d = r.dist - p.dist;
          if (d > -15 && d < 110 && !r.finished) {
            r.spin = 1.6;
            r.frozen = 2.2;
            n++;
            this.burst(r.model.root.position, "#8fe3ff", 26, 7);
          }
        }
        this.audio.zap();
        this.hud.flash("#8fe3ff");
        this.hud.pop(n ? `ZAPPED ${n}!` : "ZAP!", "blue");
        break;
      }
    }
    this.hud.pop(ITEM_NAME[it].toUpperCase(), "gold");
  }

  private grantItem() {
    if (this.item || this.rolling) return;
    const pos = this.lastPos;
    const table: [ItemKind, number][] = pos === 1
      ? [["shield", 4], ["magnet", 4], ["turbo", 2]]
      : pos <= 3
        ? [["turbo", 3.5], ["shield", 2.5], ["magnet", 2.5], ["zap", 1.5]]
        : [["turbo", 4], ["zap", 3], ["magnet", 1.5], ["shield", 1.5]];
    let roll = Math.random() * table.reduce((s, [, w]) => s + w, 0);
    let pick: ItemKind = "turbo";
    for (const [k, w] of table) { if ((roll -= w) <= 0) { pick = k; break; } }
    this.rolling = true;
    this.hud.item(pick, 1000, () => {
      this.item = pick;
      this.rolling = false;
      this.audio.get();
    }, () => this.audio.roll());
  }

  /** Dev stats: what spun the player out, and how often. */
  private hitLog: Record<string, number> = {};

  private hitPlayer(p: Racer, what: string) {
    if (this.hitCool > 0 || p.spin > 0) return;
    this.hitLog[what] = (this.hitLog[what] ?? 0) + 1;
    this.hitCool = 1.2;
    if (this.shieldT > 0) {
      this.shieldT = 0;
      this.audio.shield();
      this.hud.pop("BLOCKED!", "blue");
      this.burst(p.model.root.position, "#5ec8ff", 30, 8);
      return;
    }
    p.spin = 0.8;
    p.speed *= 0.5;
    p.boostT = 0;
    this.driftDir = 0; this.driftT = 0; this.driftTier = 0; this.turnHeld = 0;
    this.shake = 0.8;
    this.coinStreak = 0;
    this.audio.bonk();
    this.hud.flash("#ff3d5a");
    this.hud.pop(what, "red");
    for (let k = 0; k < 10; k++) {
      this.puffs.spawn(p.model.root.position.x, p.model.root.position.y + 0.8, p.model.root.position.z,
        (Math.random() - 0.5) * 5, 2 + Math.random() * 2, (Math.random() - 0.5) * 5,
        this.col.set("#d9dce8"), 1.4, 0.7, { grow: 1.6, drag: 2 });
    }
  }

  private addScore(n: number, cat: TallyKey) {
    this.score += n;
    this.tally[cat] += n;
  }

  /* ================================================================ */
  /* Shared driving model                                             */
  /* ================================================================ */

  private drive(r: Racer, steerIn: number, gas: boolean, brake: boolean, dt: number, cap = 1) {
    const tr = this.track;
    const u0 = tr.wrap(tr.startU + r.dist);
    tr.frame(u0, this.f);
    const f = this.f;

    // Speed.
    const offroad = !r.air && Math.abs(r.lat) > EDGE + 0.4;
    let top = TOP * r.skill * (gas ? 1 : CRUISE) * cap;
    if (offroad) top *= 0.62;
    if (r.boostT > 0) top = BOOST_TOP * (r.player ? 1 : 0.94);
    if (r.frozen > 0) top *= 0.2;
    if (r.spin > 0) top = 3;
    if (this.driftDir !== 0 && r.player) top *= 0.985;
    const rate = r.boostT > 0 ? 5 : r.speed < top ? (gas ? 1.05 : 0.8) : offroad ? 2.4 : 1.4;
    r.speed += (top - r.speed) * Math.min(1, rate * dt);
    if (brake) r.speed = Math.max(0, r.speed - 20 * dt);

    // Steering in track space, with an outward push through corners.
    const drifting = r.player && this.driftDir !== 0 && !r.air;
    const steerRate = (Math.min(r.speed, 16) * 0.62 + 1.2) * (r.air ? 0.45 : 1);
    const push = r.air ? 0 : -f.curv * r.speed * r.speed * CENTRIFUGAL;
    let target: number;
    if (drifting) {
      // A drift is a committed arc: it mostly cancels the corner's pull and
      // creeps inward. Counter-steering holds the line wide.
      r.steer += (this.driftDir * 0.8 - r.steer) * Math.min(1, dt * 9);
      target = this.driftHold > 0
        ? this.driftDir * steerRate * 0.62 + push * 0.45
        : -this.driftDir * steerRate * 0.38 + push * 0.3;
    } else {
      r.steer += (steerIn - r.steer) * Math.min(1, dt * 9);
      target = r.steer * steerRate + push;
    }
    r.latV += (target - r.latV) * Math.min(1, dt * 6);
    r.lat += r.latV * dt;

    // Soft walls: bounce back, scrub a little speed, throw sparks.
    if (Math.abs(r.lat) > DRIVE_LIMIT) {
      const s = Math.sign(r.lat);
      r.lat = s * DRIVE_LIMIT;
      if (r.latV * s > 0) {
        const hard = Math.abs(r.latV);
        r.latV = -s * Math.max(1.5, hard * 0.4);
        r.speed *= hard > 4 ? 0.9 : 0.97;
        if (r.player && hard > 3) {
          this.shake = Math.max(this.shake, 0.25);
          this.audio.land();
        }
        // Scraping the wall ends a drift, so you're never pinned against it.
        if (r.player && this.driftDir === s) this.releaseDrift(r);
        this.burst(this.v1.copy(r.model.root.position).addScaledVector(f.side, s * 1), "#ffb347", 8, 5);
      }
    }

    // Timers.
    r.boostT = Math.max(0, r.boostT - dt);
    r.frozen = Math.max(0, r.frozen - dt);
    if (r.spin > 0) {
      r.spin -= dt;
      r.spinAng += dt * Math.PI * 2 / 0.8;
      if (r.spin <= 0) r.spinAng = 0;
    }

    // Advance, and check the jump lip.
    r.prevU = u0;
    r.dist += r.speed * dt;
    const u1 = tr.wrap(tr.startU + r.dist);
    const crossedLip = !r.air && tr.delta(u0, tr.lipU) > 0 && tr.delta(u1, tr.lipU) <= 0;
    if (crossedLip && r.speed > 4) {
      r.air = true;
      r.airT = 0;
      r.y = tr.point(tr.lipU, r.lat, 0.95).y;
      r.vy = 3 + r.speed * 0.18;
      if (r.player) {
        this.trick = false;
        this.audio.boost();
      }
    }
    if (r.air) this.airborne(r, u1, dt);

    // Hop spring (drift hops, bumps).
    r.hopV -= 30 * dt;
    r.hop = Math.max(0, r.hop + r.hopV * dt);
    if (r.hop === 0 && r.hopV < 0) r.hopV = 0;
    r.squash += (1 - r.squash) * Math.min(1, dt * 10);
  }

  private airborne(r: Racer, u: number, dt: number) {
    const tr = this.track;
    if (r.player && r.airT < 0.22 && r.airT + dt >= 0.22) this.audio.glide();
    r.airT += dt;
    const gravity = 10;
    r.vy -= gravity * dt;
    r.y += r.vy * dt;
    const road = tr.point(u, r.lat, 0).y;
    if (tr.inGap(u)) {
      // The virtual road never lets you fall into the lake.
      if (r.y < road + 1.2) { r.y = road + 1.2; r.vy = Math.max(r.vy, 0); }
    } else if (r.y <= road && r.vy < 0) {
      r.air = false;
      r.squash = 0.72;
      r.model.thump(2.4);
      const pos = r.model.root.position;
      for (let k = 0; k < 14; k++) {
        const a = (k / 14) * Math.PI * 2;
        this.puffs.spawn(pos.x, pos.y + 0.3, pos.z, Math.cos(a) * 5, 0.8, Math.sin(a) * 5,
          this.col.set("#f2f4ff"), 1.3, 0.6, { grow: 1.4, drag: 3 });
      }
      if (r.player) {
        this.audio.land();
        this.shake = Math.max(this.shake, 0.35);
        if (this.trick) {
          r.boostT = Math.max(r.boostT, 1.1);
          this.tricks++;
          this.addScore(50, "stunts");
          this.hud.pop("TRICK! +50", "green big");
          this.audio.boost();
          this.trick = false;
        }
      }
    }
    if (r.player && this.trick) r.flip = Math.min(Math.PI * 2, r.flip + dt * Math.PI * 2 / 0.55);
    else if (!r.air) r.flip = 0;
  }

  /* ================================================================ */
  /* Rivals                                                           */
  /* ================================================================ */

  private updateRival(r: Racer, dt: number) {
    const tr = this.track;
    const p = this.racers[0];
    const u = tr.wrap(tr.startU + r.dist);
    const ahead = tr.curvature(u + 14);

    // Racing line: hug the inside of whatever corner is coming.
    let target = THREE.MathUtils.clamp(ahead * 190, -5.5, 5.5) + r.bias * 2.4;

    // Stay out of each other's way.
    for (const o of this.racers) {
      if (o === r) continue;
      const d = o.dist - r.dist;
      if (d > 0 && d < 9 && Math.abs(o.lat - r.lat) < 2.4) {
        target = o.lat + (r.lat >= o.lat ? 3.2 : -3.2);
      }
    }
    // Dodge hazards on the line.
    for (const h of this.hazards) {
      const d = tr.delta(u, h.u);
      if (d > 0 && d < 22 && Math.abs(h.lat - target) < h.r + 1.6) target = h.lat + (target > h.lat ? 1 : -1) * (h.r + 2.4);
    }
    // The aggressive ones lean on you.
    const gapToPlayer = p.dist - r.dist;
    r.shoveT = Math.max(0, r.shoveT - dt);
    if (Math.abs(gapToPlayer) < 7 && r.aggro > 0.4 && r.shoveT <= 0 && Math.random() < dt * r.aggro * 0.9) r.shoveT = 1.4;
    if (r.shoveT > 0) target = p.lat;
    target = THREE.MathUtils.clamp(target, -EDGE + 1.2, EDGE - 1.2);

    // Feed-forward against the corner push, then steer onto the line.
    const need = tr.curvature(u) * r.speed * r.speed * CENTRIFUGAL;
    const rate = Math.min(r.speed, 16) * 0.62 + 1.2;
    const steer = THREE.MathUtils.clamp(need / rate + (target - r.lat) * 0.28 - r.latV * 0.06, -1, 1);

    // Rubber band: close enough to fight, never a runaway.
    let band = 1;
    if (gapToPlayer > 30) band = 1 + Math.min(0.16, (gapToPlayer - 30) * 0.004);
    if (gapToPlayer < -25) band = 1 - Math.min(0.22, (-gapToPlayer - 25) * 0.005);
    // Catch-up never makes a Custodian faster than you at full gas.
    const skill = r.skill;
    r.skill = band > 1 ? Math.min(skill * band, 0.975) : skill * band;
    this.drive(r, steer, true, false, dt);
    r.skill = skill;

    if (r.air && Math.random() < dt * 0.6 && r.flip === 0) r.flip = 0.001;
    if (r.flip > 0) r.flip = Math.min(Math.PI * 2, r.flip + dt * 11);
    if (!r.air && r.flip >= Math.PI * 2) r.flip = 0;

    // Custodian tricks: goo behind them if you're close behind, a freeze orb
    // if you've got away from them.
    // Attacks share one cooldown across the whole pack, so they never pile up.
    r.itemT -= dt;
    if (r.itemT <= 0 && this.attackCool <= 0 && this.phase === "race" && this.raceT > 8 && !r.finished) {
      r.itemT = 14 + Math.random() * 9;
      if (gapToPlayer < -12 && gapToPlayer > -40 && this.hazards.filter((h) => h.kind === "goo").length < 2) {
        this.dropGoo(r);
        this.attackCool = 5;
      } else if (gapToPlayer > 14 && gapToPlayer < 70 && this.orbs.length < 1) {
        this.fireOrb(r);
        this.attackCool = 17 + Math.random() * 7;
      }
    }

    if (!r.finished && r.dist >= this.laps * tr.length) r.finished = true;
  }

  private dropGoo(r: Racer) {
    const obj = M.goo();
    this.scene.add(obj);
    const u = this.track.wrap(this.track.startU + r.dist - 3.5);
    this.hazards.push({ kind: "goo", u, lat: r.lat, r: 1.3, obj, life: 14, phase: 0, knocked: 0, kv: V(), base: r.lat, span: 0, ring: null });
    obj.scale.setScalar(0.01);
  }

  private fireOrb(r: Racer) {
    const obj = M.orb();
    this.scene.add(obj);
    this.orbs.push({ u: this.track.wrap(this.track.startU + r.dist + 2), lat: r.lat, speed: r.speed + 6, life: 6, obj });
  }

  private updateOrbs(dt: number) {
    const p = this.racers[0];
    const pu = this.track.wrap(this.track.startU + p.dist);
    let warn = false;
    for (const o of this.orbs) {
      o.life -= dt;
      o.speed = Math.min(40, Math.max(o.speed, p.speed + 7));
      o.u = this.track.wrap(o.u + o.speed * dt);
      o.lat += THREE.MathUtils.clamp(p.lat - o.lat, -2 * dt, 2 * dt);
      const d = this.track.delta(o.u, pu);
      if (d > 0 && d < 45) warn = true;
      this.track.point(o.u, o.lat, 1.1 + Math.sin(this.time * 12) * 0.15, o.obj.position);
      o.obj.rotation.y += dt * 8;
      if (Math.random() < 0.8) {
        const q = o.obj.position;
        this.sparks.spawn(q.x, q.y, q.z, (Math.random() - 0.5), Math.random(), (Math.random() - 0.5), this.col.set("#ff4a5e"), 0.9, 0.35);
      }
      if (Math.abs(d) < 1.5 && Math.abs(o.lat - p.lat) < 1.5 && !p.air) {
        o.life = 0;
        this.hitPlayer(p, "FROZEN!");
        this.burst(o.obj.position, "#ff4a5e", 30, 8);
      }
    }
    this.orbs = this.orbs.filter((o) => {
      if (o.life > 0) return true;
      this.scene.remove(o.obj);
      return false;
    });
    this.hud.warn(warn && this.phase === "race");
  }

  /** Kart-to-kart contact. */
  private bumps(dt: number) {
    const tr = this.track;
    const rs = this.racers;
    for (const r of rs) r.bumpT = Math.max(0, r.bumpT - dt);
    for (let a = 0; a < rs.length; a++) {
      for (let b = a + 1; b < rs.length; b++) {
        const A = rs[a], B = rs[b];
        if (A.air || B.air) continue;
        const du = tr.delta(tr.wrap(tr.startU + A.dist), tr.wrap(tr.startU + B.dist));
        const dl = B.lat - A.lat;
        if (Math.abs(du) > 2.7 || Math.abs(dl) > 1.95) continue;
        const s = Math.sign(dl) || 1;
        const overlap = 1.95 - Math.abs(dl);
        A.lat -= s * overlap * 0.5;
        B.lat += s * overlap * 0.5;
        A.latV -= s * 3.5;
        B.latV += s * 3.5;
        if (A.bumpT > 0 || B.bumpT > 0) continue;
        A.bumpT = B.bumpT = 0.6;
        if (A.player || B.player) {
          const me = A.player ? A : B, them = A.player ? B : A;
          if (me.boostT > 0 && them.spin <= 0) {
            them.spin = 1.2;
            them.speed *= 0.5;
            this.takedowns++;
            this.addScore(100, "takedowns");
            this.hud.pop("TAKEDOWN! +100", "pink big");
            this.audio.bonk();
            this.burst(them.model.root.position, "#ffe14d", 24, 7);
          } else if (this.shieldT > 0) {
            them.spin = 0.9;
            this.hud.pop("BOUNCED!", "blue");
          } else {
            me.speed *= 0.92;
            me.model.thump(1.5);
            this.shake = Math.max(this.shake, 0.3);
            this.audio.land();
          }
        }
        // The one behind loses a touch of speed.
        const back = du > 0 ? A : B;
        back.speed *= 0.96;
      }
    }
  }

  private standings() {
    const p = this.racers[0];
    if (p.finished) return;
    let pos = 1;
    for (let k = 1; k < this.racers.length; k++) if (this.racers[k].dist > p.dist) pos++;
    if (this.phase === "race" && pos < this.lastPos && this.raceT > 1.5) {
      const gained = this.lastPos - pos;
      this.addScore(25 * gained, "passes");
      this.hud.pop(gained > 1 ? `PASSED ${gained}! +${25 * gained}` : "PASSED! +25", "gold");
      this.audio.pass();
    }
    this.lastPos = pos;
  }

  /* ================================================================ */
  /* Pickups and hazards                                              */
  /* ================================================================ */

  private collide(p: Racer, dt: number) {
    const tr = this.track;
    const pu = tr.wrap(tr.startU + p.dist);
    const roadY = tr.point(pu, p.lat, 0).y;
    const above = p.air ? p.y - roadY : 0;

    for (const c of this.coins) {
      if (!c.alive) continue;
      let du = tr.delta(pu, c.u);
      let dl = c.lat - p.lat;
      if (this.magnetT > 0 && Math.abs(du) < 16 && Math.abs(dl) < 12 && Math.abs(c.h - above) < 4) {
        // Pull towards the kart.
        c.u = tr.wrap(c.u - Math.sign(du) * Math.min(Math.abs(du), 30 * dt));
        c.lat += THREE.MathUtils.clamp(-dl, -24 * dt, 24 * dt);
        du = tr.delta(pu, c.u);
        dl = c.lat - p.lat;
      }
      if (Math.abs(du) < 1.9 && Math.abs(dl) < 1.7 && Math.abs(c.h - 1.15 - above) < 2.2) {
        c.alive = false;
        c.pop = 0.35;
        c.respawn = 12;
        const val = c.kind === "btc" ? 60 : c.kind === "eth" ? 30 : 10;
        this.addScore(val, "coins");
        this.coinCount++;
        this.coinStreak++;
        this.coinStreakT = 1.2;
        this.audio.coin(this.coinStreak);
        const w = tr.point(c.u, c.lat, c.h, this.v1);
        this.burst(w, c.kind === "eth" ? "#c9b8ff" : "#ffd84d", 12, 4);
        this.flyToHud(w);
        if (c.kind !== "dli") this.hud.pop(`${c.kind.toUpperCase()} +${val}`, c.kind === "btc" ? "orange" : "purple");
      }
    }

    for (const b of this.boxes) {
      if (!b.alive) continue;
      if (Math.abs(tr.delta(pu, b.u)) < 1.9 && Math.abs(b.lat - p.lat) < 1.9 && !p.air) {
        b.alive = false;
        b.respawn = 3;
        b.obj.visible = false;
        this.burst(b.obj.position, "#9fd4ff", 18, 6);
        this.burst(b.obj.position, "#ff9fe0", 12, 6);
        this.grantItem();
        this.audio.get();
      }
    }

    for (const pad of this.pads) {
      if (Math.abs(tr.delta(pu, pad.u)) < 2.7 && Math.abs(pad.lat - p.lat) < 1.8 && !p.air && p.boostT < 1.0) {
        p.boostT = 1.3;
        this.audio.boost();
        this.shake = Math.max(this.shake, 0.3);
        this.hud.flash("#ffb300");
      }
    }
    // Rivals use pads too.
    for (let k = 1; k < this.racers.length; k++) {
      const r = this.racers[k];
      const ru = tr.wrap(tr.startU + r.dist);
      for (const pad of this.pads) {
        if (Math.abs(tr.delta(ru, pad.u)) < 2.7 && Math.abs(pad.lat - r.lat) < 1.8 && r.boostT < 0.5) r.boostT = 1.0;
      }
    }

    for (const h of this.hazards) {
      if (h.knocked > 0) continue;
      const du = tr.delta(pu, h.u);
      if (Math.abs(du) > h.r + 1.3 || Math.abs(h.lat - p.lat) > h.r + 0.9) continue;
      if (p.air && h.kind !== "drone") continue;
      if (h.kind === "cone") {
        h.knocked = 4;
        h.kv.set((Math.random() - 0.5) * 6, 7, p.speed * 0.6);
        p.speed *= 0.9;
        this.audio.land();
        this.hud.pop("BONK!", "orange");
        continue;
      }
      if (h.kind === "goo") {
        // Goo is a slip, not a crash: you lose speed and wobble.
        h.life = 0;
        if (this.shieldT > 0) { this.hitPlayer(p, "GOOED!"); continue; }
        this.hitLog.GOOED = (this.hitLog.GOOED ?? 0) + 1;
        p.speed *= 0.6;
        p.latV += (Math.random() < 0.5 ? -1 : 1) * 5;
        p.model.thump(2);
        this.shake = Math.max(this.shake, 0.4);
        this.coinStreak = 0;
        this.audio.bonk();
        this.hud.pop("SLIPPED!", "purple");
        for (let k = 0; k < 12; k++) {
          const q = p.model.root.position;
          this.sparks.spawn(q.x, q.y + 0.3, q.z, (Math.random() - 0.5) * 6, 2 + Math.random() * 3, (Math.random() - 0.5) * 6,
            this.col.set("#b36bff"), 0.5, 0.5, { grav: 12 });
        }
        continue;
      }
      if (h.kind === "bollard" && p.boostT > 0 && this.shieldT <= 0) {
        p.lat += Math.sign(p.lat - h.lat || 1) * 1.2;
      }
      this.hitPlayer(p, h.kind === "drone" ? "ZAPPED!" : "CRASH!");
    }
    // Rivals spin on goo and knock cones too.
    for (let k = 1; k < this.racers.length; k++) {
      const r = this.racers[k];
      const ru = tr.wrap(tr.startU + r.dist);
      for (const h of this.hazards) {
        if (h.knocked > 0 || r.air) continue;
        if (Math.abs(tr.delta(ru, h.u)) > h.r + 1.2 || Math.abs(h.lat - r.lat) > h.r + 0.8) continue;
        if (h.kind === "cone") { h.knocked = 4; h.kv.set((Math.random() - 0.5) * 6, 7, r.speed * 0.6); }
        else if (h.kind === "goo" && r.spin <= 0) { r.spin = 0.9; r.speed *= 0.5; h.life = 0; }
      }
    }
  }

  private flyToHud(w: THREE.Vector3) {
    const v = this.v2.copy(w).project(this.camera);
    if (v.z > 1) return;
    const rect = this.mountEl.getBoundingClientRect();
    this.hud.coinFly((v.x * 0.5 + 0.5) * rect.width, (-v.y * 0.5 + 0.5) * rect.height);
  }

  private updateHazards(dt: number) {
    const tr = this.track;
    for (const h of this.hazards) {
      if (h.kind === "drone") {
        for (const r of h.obj.userData.rotors as THREE.Object3D[]) r.rotation.y += dt * 38;
        (h.obj.userData.tip as THREE.Object3D).visible = Math.sin(this.time * 6 + h.phase) > 0;
        h.phase += dt * 0.9;
        h.lat = Math.sin(h.phase) * h.span;
        tr.frame(h.u, this.f);
        this.orient(h.obj, this.f, h.lat, 1.9 + Math.sin(this.time * 3 + h.phase) * 0.25);
        // Eye on the oncoming karts, banking into each sweep.
        h.obj.rotateY(Math.PI);
        h.obj.rotateZ(Math.cos(h.phase) * 0.22);
        if (h.ring) {
          this.orient(h.ring, this.f, h.lat, 0.05);
          h.ring.scale.setScalar(1 + Math.sin(this.time * 6 + h.phase) * 0.12);
        }
        continue;
      }
      if (h.kind === "goo") {
        h.life -= dt;
        const s = Math.min(1, (14 - h.life) * 4) * Math.min(1, Math.max(0, h.life) * 2);
        h.obj.scale.setScalar(Math.max(0.01, s));
        // Bubbles swell, then pop and start again.
        for (const b of h.obj.userData.bubbles as THREE.Mesh[]) {
          const k = (this.time * 0.7 + (b.userData.phase as number)) % 1;
          b.scale.setScalar(k < 0.92 ? 0.25 + k * 0.9 : 0.01);
        }
      }
      if (h.knocked > 0) {
        h.knocked -= dt;
        h.kv.y -= 20 * dt;
        h.obj.position.addScaledVector(h.kv, dt);
        h.obj.rotation.x += dt * 9;
        h.obj.rotation.z += dt * 6;
        if (h.knocked <= 0) {
          h.obj.rotation.set(0, 0, 0);
          tr.frame(h.u, this.f);
          this.orient(h.obj, this.f, h.lat, 0);
        }
        continue;
      }
      tr.frame(h.u, this.f);
      this.orient(h.obj, this.f, h.lat, 0);
      if (h.kind === "bollard") {
        const lamp = h.obj.userData.lamp as THREE.Mesh;
        lamp.visible = Math.sin(this.time * 7 + h.phase) > -0.2;
      }
    }
    this.hazards = this.hazards.filter((h) => {
      if (h.kind !== "goo" || h.life > 0) return true;
      this.scene.remove(h.obj);
      return false;
    });
  }

  private updateProps(dt: number) {
    const tr = this.track;
    const t = this.time;
    const w = this.world;

    // Coins: spin, bob, pop when grabbed, pop back in when they respawn.
    const idx: Record<string, number> = { dli: 0, eth: 0, btc: 0 };
    const q = this.q1;
    const s = this.v3;
    for (const c of this.coins) {
      const im = this.coinMesh.get(c.kind)!;
      const i = idx[c.kind]++;
      if (!c.alive) {
        c.respawn -= dt;
        if (c.respawn <= 0) { c.alive = true; c.pop = -0.35; }
      }
      tr.frame(c.u, this.f);
      let lift = c.h + Math.sin(t * 2.6 + c.phase) * 0.18;
      let scale = 1;
      let spin = t * 3 + c.phase;
      if (!c.alive) {
        if (c.pop > 0) {
          c.pop -= dt;
          const k = 1 - c.pop / 0.35;
          lift += k * 2.2;
          scale = 1 - k * 0.8;
          spin += k * 18;
        } else scale = 0;
      } else if (c.pop < 0) {
        c.pop = Math.min(0, c.pop + dt);
        scale = 1 + c.pop / 0.35;
        scale = elastic(Math.max(0, scale));
      }
      const pos = this.v1.copy(this.f.pos).addScaledVector(this.f.side, c.lat).addScaledVector(this.f.up, lift);
      q.setFromAxisAngle(this.v2.set(0, 1, 0), spin + Math.atan2(this.f.tan.x, this.f.tan.z));
      s.setScalar(Math.max(0.0001, scale));
      this.m4.compose(pos, q, s);
      im.setMatrixAt(i, this.m4);
    }
    for (const im of this.coinMesh.values()) im.instanceMatrix.needsUpdate = true;

    // Item boxes.
    for (const b of this.boxes) {
      if (!b.alive) {
        b.respawn -= dt;
        if (b.respawn <= 0) { b.alive = true; b.obj.visible = true; b.phase = -0.4; }
        continue;
      }
      tr.frame(b.u, this.f);
      const lift = 1.3 + Math.sin(t * 2 + b.phase) * 0.2;
      this.orient(b.obj, this.f, b.lat, lift);
      const ud = b.obj.userData;
      const cube = ud.cube as THREE.Mesh;
      cube.rotation.set(t * 0.9 + b.phase, t * 1.3 + b.phase, 0);
      (ud.core as THREE.Mesh).rotation.set(-t * 0.6, -t * 2.2 + b.phase, 0);
      const orbit = ud.orbit as THREE.Group;
      orbit.rotation.y = t * 1.4 + b.phase;
      for (const s of orbit.children) s.scale.setScalar(0.3 + 0.28 * Math.max(0, Math.sin(t * 5 + (s.userData.k as number) * 1.9 + b.phase)));
      const pool = ud.pool as THREE.Mesh;
      pool.position.y = 0.06 - lift;
      const cm = cube.material as THREE.MeshPhysicalMaterial;
      const hue = (t * 0.25 + b.phase * 0.2) % 1;
      cm.color.setHSL(hue, 0.95, 0.56);
      cm.emissive.setHSL((hue + 0.08) % 1, 1, 0.42);
      (ud.inner as THREE.MeshBasicMaterial).color.setHSL((hue + 0.15) % 1, 1, 0.55);
      (pool.material as THREE.MeshBasicMaterial).color.setHSL(hue, 1, 0.6);
      (ud.frame as THREE.MeshStandardMaterial).emissive.setHSL((hue + 0.5) % 1, 1, 0.55);
      let k = 1;
      if (b.phase < 0) {
        b.phase = Math.min(0, b.phase + dt);
        k = elastic(1 + b.phase / 0.4);
      }
      b.obj.scale.setScalar(Math.max(0.01, k));
    }

    tickNature(t);
    for (const pad of this.pads) pad.tex.offset.y -= dt * 1.6;
    w.water.offset.x += dt * 0.02;
    w.water.offset.y += dt * 0.012;
    w.sky.update(t);
    crowdTime.value = t;
    for (const b of w.balloons) b.position.y = (b.userData.base as number) + Math.sin(t * 0.8 + b.position.x) * 1.2;
    for (const sp of w.spinners) sp.rotation.y += dt * 0.6;
  }

  /* ================================================================ */
  /* Placement and effects                                            */
  /* ================================================================ */

  /** Stand an object on the track at (u, lat), facing along it. */
  private orient(obj: THREE.Object3D, f: Frame, lat: number, lift: number) {
    obj.position.copy(f.pos).addScaledVector(f.side, lat).addScaledVector(f.up, lift);
    this.v3.copy(f.side).negate();
    this.m4.makeBasis(this.v3, f.up, f.tan);
    obj.quaternion.setFromRotationMatrix(this.m4);
  }

  private placeAll(dt: number) {
    const tr = this.track;
    for (const r of this.racers) {
      const u = tr.wrap(tr.startU + r.dist);
      tr.frame(u, this.f);
      this.orient(r.model.root, this.f, r.lat, 0);
      this.orient(r.model.shadowRoot, this.f, r.lat, 0);
      if (r.air) r.model.root.position.y = r.y;
      const height = r.air ? Math.max(0, r.y - r.model.shadowRoot.position.y) : 0;
      const sm = r.model.shadow.material as THREE.MeshBasicMaterial;
      sm.opacity = 0.75 / (1 + height * 0.35);
      r.model.shadow.scale.setScalar(1 + height * 0.08);

      // Visual yaw: sideways velocity, plus the drift slide.
      const slideTarget = r.player
        ? this.driftDir * 0.42
        : (Math.abs(this.f.curv) > 0.018 && r.speed > 14 && !r.air ? Math.sign(this.f.curv) * 0.28 : 0);
      r.slide += (slideTarget - r.slide) * Math.min(1, dt * 7);
      const yaw = Math.atan2(r.latV, Math.max(4, r.speed)) * 0.9 + r.slide;
      const wave = !r.player ? 0
        : this.phase === "finish" ? 2
        : this.phase === "intro" && this.phaseT > 2.2 && this.phaseT < 4.9 ? 1 : 0;
      // Distant karts drop their fine detail.
      r.model.setDetail(r.player || r.model.root.position.distanceToSquared(this.camera.position) < 48 * 48);
      const pose: M.KartPose = {
        speed: r.speed,
        steer: r.steer,
        slide: yaw,
        hop: r.hop,
        squash: r.squash,
        roll: r.spinAng,
        flip: r.flip,
        boost: r.boostT > 0 ? Math.min(1, r.boostT * 2) : 0,
        glide: r.air ? Math.min(1, r.airT * 2.5) : 0,
        pitch: r.air ? THREE.MathUtils.clamp(r.vy * 0.035, -0.28, 0.3) : 0,
        wave,
        time: this.time + r.i,
      };
      r.model.update(this.poseOverride ? this.poseOverride(r.i, pose) : pose, dt);
    }
  }

  /** Drift sparks, boost embers, grass spray. */
  private driftFx() {
    const tiers = ["#fff6c8", "#4fc3ff", "#ff9d2e", "#d66bff"];
    for (const r of this.racers) {
      const root = r.model.root;
      if (r.frozen > 0 && Math.random() < 0.7) {
        const w = root.localToWorld(this.v1.set((Math.random() - 0.5) * 2.4, 0.4 + Math.random() * 2.2, (Math.random() - 0.5) * 2.6));
        this.sparks.spawn(w.x, w.y, w.z, 0, 0.6, 0, this.col.set(Math.random() < 0.5 ? "#bff3ff" : "#5ec8ff"), 0.5, 0.5);
      }
      // Wind streaks off the glider's wingtips.
      if (r.air) {
        const tips = r.model.gliderTips();
        if (tips) {
          // Three points per frame back along the flight path, so the
          // streak reads as a continuous ribbon rather than dots.
          const back = root.getWorldDirection(this.v2).multiplyScalar(-r.speed / 60 / 3);
          back.y = -r.vy / 60 / 3;
          for (const t of tips) {
            const w = t.getWorldPosition(this.v1);
            for (let k = 0; k < 3; k++) {
              this.sparks.spawn(w.x, w.y, w.z, 0, -0.15, 0, this.col.set(r.player ? "#cdeeff" : r.color), 0.45, 0.85);
              w.add(back);
            }
          }
        }
      }
      if (r.air || r.spin > 0) continue;
      this.track.frame(this.track.wrap(this.track.startU + r.dist), this.f2);
      const drifting = r.player ? this.driftDir !== 0 : Math.abs(r.slide) > 0.2;
      const tier = r.player ? this.driftTier : 0;
      if (drifting && r.speed > 8) {
        const n = r.player ? 3 : 1;
        for (let k = 0; k < n; k++) {
          for (const sx of [0.95, -0.95]) {
            const w = root.localToWorld(this.v1.set(sx, 0.12, -0.95));
            const back = this.v2.copy(this.f2.tan).multiplyScalar(-2 - Math.random() * 3);
            this.sparks.spawn(w.x, w.y, w.z,
              back.x + (Math.random() - 0.5) * 3, 1.5 + Math.random() * 3, back.z + (Math.random() - 0.5) * 3,
              this.col.set(tiers[tier]), tier > 0 ? 0.55 : 0.32, 0.28 + Math.random() * 0.15, { grav: 14, drag: 2 });
          }
        }
        if (r.player && tier > 0 && Math.random() < 0.5) {
          for (const sx of [0.95, -0.95]) {
            const w = root.localToWorld(this.v1.set(sx, 0.3, -0.9));
            this.sparks.spawn(w.x, w.y, w.z, 0, 0.4, 0, this.col.set(tiers[tier]), 1.6, 0.09);
          }
        }
      }
      if (r.boostT > 0) {
        for (const sx of [0.26, -0.26]) {
          const w = root.localToWorld(this.v1.set(sx, 0.74, -1.7));
          this.sparks.spawn(w.x, w.y, w.z, (Math.random() - 0.5) * 2, Math.random() * 1.5, (Math.random() - 0.5) * 2,
            this.col.set(r.player ? "#7fd8ff" : r.color), 0.6, 0.25, { drag: 3 });
        }
      }
      if (Math.abs(r.lat) > EDGE + 0.4 && r.speed > 8 && Math.random() < 0.6) {
        const w = root.localToWorld(this.v1.set(0, 0.2, -1.2));
        this.puffs.spawn(w.x, w.y, w.z, (Math.random() - 0.5) * 2, 1.5, (Math.random() - 0.5) * 2,
          this.col.set(Math.random() < 0.5 ? "#7bd65c" : "#b9e68f"), 0.7, 0.5, { grav: 5, grow: 0.8 });
      }
    }
  }

  private burst(at: THREE.Vector3, color: string, n: number, speed: number) {
    this.col.set(color);
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * Math.PI - Math.PI / 2;
      const v = speed * (0.4 + Math.random() * 0.6);
      this.sparks.spawn(at.x, at.y + 0.6, at.z, Math.cos(a) * Math.cos(e) * v, Math.abs(Math.sin(e)) * v + 2, Math.sin(a) * Math.cos(e) * v,
        this.col, 0.45 + Math.random() * 0.3, 0.45 + Math.random() * 0.3, { grav: 9, drag: 1.5 });
    }
  }

  /* ================================================================ */
  /* Camera                                                           */
  /* ================================================================ */

  private chaseTarget(p: Racer) {
    const tr = this.track;
    const u = tr.wrap(tr.startU + p.dist);
    tr.frame(u, this.f2);
    const f = this.f2;
    const kart = tr.point(u, p.lat, 0, V());
    if (p.air) kart.y = p.y;
    const boost = p.boostT > 0 ? 1 : 0;
    // Heading swings a little with the slide, so drifts feel like drifts.
    const yaw = -(p.slide * 0.25);
    const fwd = f.tan.clone().applyAxisAngle(f.up, yaw);
    // Tall phone screens see a narrow slice; pull back so the kart fits.
    const portrait = Math.max(0, 1 - this.camera.aspect);
    const back = 7.4 + boost * 1.3 + (p.air ? 2.2 : 0) + portrait * 2.6;
    const up = 2.9 + (p.air ? 1.4 : 0);
    const pos = kart.clone().addScaledVector(fwd, -back).addScaledVector(f.up, up * 0.5).add(new THREE.Vector3(0, up * 0.5, 0));
    // Never dip below the road surface behind a crest.
    const behind = tr.point(u - back, p.lat * 0.6, 0);
    pos.y = Math.max(pos.y, behind.y + 1.6);
    const look = kart.clone().addScaledVector(fwd, 5).addScaledVector(f.up, 1.3);
    return { pos, look, up: f.up.clone() };
  }

  private updateCamera(dt: number) {
    const p = this.racers[0];
    const cam = this.camera;
    let wantFov = 64;

    if (this.director) {
      const fov = this.director(cam, dt);
      if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
      this.fov = fov;
      this.followSun();
      return;
    }

    if (this.attract) {
      wantFov = this.directCamera(dt);
    } else if (this.phase === "intro" && this.introPath && this.introLook) {
      const t = introParam(this.phaseT);
      this.introPath.getPoint(t, this.camPos);
      this.introLook.getPoint(t, this.camLook);
      cam.position.copy(this.camPos);
      cam.up.set(0, 1, 0);
      cam.lookAt(this.camLook);
      wantFov = 58;
    } else if (this.phase === "finish") {
      // Swing round to the front of the kart, like the reference's finish.
      const tr = this.track;
      const u = tr.wrap(tr.startU + p.dist);
      tr.frame(u, this.f2);
      const f = this.f2;
      const kart = p.model.root.position;
      const a = Math.min(Math.PI * 0.92, this.phaseT * 1.1) + Math.max(0, this.phaseT - 3) * 0.25;
      const dir = f.tan.clone().multiplyScalar(-Math.cos(a)).addScaledVector(f.side, Math.sin(a) * 0.8);
      const want = kart.clone().addScaledVector(dir, 6.4).add(new THREE.Vector3(0, 2.2, 0));
      const look = this.v1.copy(kart).add(new THREE.Vector3(0, 1.5, 0));
      // Once the results card is up (on the right), slide the view so the
      // driver sits in the open space on the left.
      if (this.result && cam.aspect > 1) {
        const side = this.v2.subVectors(look, want).normalize().cross(cam.up).normalize();
        want.addScaledVector(side, 2.6);
        look.addScaledVector(side, 2.6);
      }
      this.camPos.lerp(want, 1 - Math.exp(-dt * (this.result ? 2.5 : 6)));
      this.camLook.lerp(look, 1 - Math.exp(-dt * (this.result ? 3 : 12)));
      cam.position.copy(this.camPos);
      cam.up.set(0, 1, 0);
      cam.lookAt(this.camLook);
      wantFov = 55;
    } else {
      const c = this.chaseTarget(p);
      if (!this.camReady) {
        this.camReady = true;
        if (this.phase !== "countdown") { this.camPos.copy(c.pos); this.camLook.copy(c.look); }
      }
      const k = 1 - Math.exp(-dt * (this.phase === "countdown" ? 3 : 9));
      this.camPos.lerp(c.pos, k);
      this.camLook.lerp(c.look, 1 - Math.exp(-dt * 14));
      cam.position.copy(this.camPos);
      cam.up.set(0, 1, 0).lerp(c.up, 0.5).normalize();
      cam.lookAt(this.camLook);
      wantFov = 64 + (p.boostT > 0 ? 10 : 0) + Math.max(0, p.speed - 18) * 0.35 + Math.max(0, 1 - cam.aspect) * 22;
    }

    if (this.shake > 0) {
      const s = this.shake * 0.35;
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
      cam.position.z += (Math.random() - 0.5) * s;
      this.shake = Math.max(0, this.shake - dt * 2.2);
    }

    this.fov += (wantFov - this.fov) * Math.min(1, dt * 5);
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }

    this.followSun();
  }

  /** Keep the shadow camera centred on the player, and size particles for the view. */
  private followSun() {
    const sun = this.world.sun;
    const pp = this.racers[0].model.root.position;
    sun.target.position.copy(pp);
    sun.position.set(pp.x - 70, pp.y + 42, pp.z + 56);
    const h = this.renderer.domElement.height;
    this.sparks.setScale(h, this.camera.fov);
    this.puffs.setScale(h, this.camera.fov);
  }

  /* ================================================================ */
  /* Trailer (dev only)                                               */
  /* ================================================================ */

  /**
   * The player's kart on autopilot: rocket start, racing line, drifts through
   * the long bends for the full blue → orange → purple turbo, and it fires
   * whatever item it picks up.
   */
  private autoDrive(p: Racer, dt: number) {
    const tr = this.track;
    const u = tr.wrap(tr.startU + p.dist);
    const here = tr.curvature(u + 4), ahead = tr.curvature(u + 12);
    this.input.down = false;
    if (this.phase === "countdown") {
      this.input.gas = this.phaseT > 1.2;   // hold ↑ from "2" for a rocket start
      return;
    }
    this.input.gas = true;
    let want = 0;
    if (!p.air) {
      if (this.driftDir !== 0) {
        // Ride the drift; widen it if it's running onto the inside kerb, and
        // let go once the bend straightens out.
        if (Math.abs(here) < 0.008) want = 0;
        else want = p.lat * this.driftDir > EDGE - 2.2 ? -this.driftDir : this.driftDir;
      } else if (Math.abs(here) > 0.014 && Math.abs(ahead) > 0.012 && p.speed > 14) {
        want = Math.sign(here);
      } else {
        const target = THREE.MathUtils.clamp(ahead * 190, -5, 5);
        const need = tr.curvature(u) * p.speed * p.speed * CENTRIFUGAL;
        const rate = Math.min(p.speed, 16) * 0.62 + 1.2;
        const s = need / rate + (target - p.lat) * 0.3 - p.latV * 0.08;
        want = Math.abs(s) > 0.3 ? Math.sign(s) : 0;
      }
      if (this.driftDir === 0 && Math.abs(p.lat) > EDGE - 1.4 && want === Math.sign(p.lat)) want = 0;
    }
    this.input.left = want < 0;
    this.input.right = want > 0;
    if (this.autoItems && this.item && !this.rolling && Math.random() < dt * 0.7) this.pressed.add("ArrowDown");
  }

  /** Trailer: run the race forward one step and (optionally) draw it. */
  advance(dt: number, draw = true) {
    if (this.phase === "load") return;
    this.update(dt);
    if (draw) this.composer.render();
    this.pressed.clear();
  }

  /** Trailer: start the countdown now; GO comes three seconds later. */
  go() {
    this.startCountdown();
  }

  /** Trailer: light the player's boost flames for a moment. */
  boostPlayer(sec: number) { this.racers[0].boostT = Math.max(this.racers[0].boostT, sec); }

  /** Trailer: a Custodian drops goo, or fires a freeze orb, right now. */
  custodianGoo(k: number) { this.dropGoo(this.racers[k]); }
  custodianOrb(k: number) { this.fireOrb(this.racers[k]); }

  /** Trailer: the live objects its cameras and titles need. */
  rig() {
    return {
      camera: this.camera,
      canvas: this.renderer.domElement,
      scene: this.scene,
      renderer: this.renderer,
      models: this.racers.map((r) => r.model),
      track: this.track,
      world: this.world,
      karts: this.racers.map((r) => ({
        root: r.model.root,
        get dist() { return r.dist; },
        get lat() { return r.lat; },
        get speed() { return r.speed; },
        get air() { return r.air; },
        get boost() { return r.boostT; },
      })),
      hazards: () => this.hazards.map((h) => ({ kind: h.kind, obj: h.obj, u: h.u })),
      orbs: () => this.orbs.map((o) => o.obj),
      boxes: this.boxes.map((b) => b.obj),
      drift: () => ({ dir: this.driftDir, tier: this.driftTier }),
      phase: () => this.phase,
      raceTime: () => this.raceT,
      time: () => this.time,
    };
  }

  /* ================================================================ */
  /* HUD                                                              */
  /* ================================================================ */

  private updateHud() {
    const p = this.racers[0];
    const hud = this.hud;
    hud.score(this.score);
    hud.coins(this.coinCount);
    hud.position(this.lastPos);
    hud.lap(Math.min(this.laps, this.lap), this.laps);
    hud.clock(this.raceT);
    for (const r of this.racers) {
      const w = r.model.root.position;
      hud.mapDot(r.i, w.x, w.z, r.player ? undefined : r.color);
    }
    const boosting = p.boostT > 0 && (this.phase === "race");
    hud.speedLines(boosting ? 0.9 : p.speed > 23 && this.phase === "race" ? 0.18 : 0);
    hud.vignette(this.shieldT > 0 ? "rgba(94,200,255,.55)" : this.magnetT > 0 ? "rgba(255,61,90,.4)" : null);
  }

  /* ================================================================ */
  /* Housekeeping                                                     */
  /* ================================================================ */

  private resize = () => {
    if (!this.renderer) return;
    const r = this.mountEl.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width));
    const h = Math.max(1, Math.round(r.height));
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h);
    const bs = this.quality === "low" ? 4 : 2;
    this.bloom?.resolution.set(w / bs, h / bs);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  /** If the machine can't hold ~45 fps, drop resolution and bloom once. */
  private watchPerf(raw: number) {
    if (this.lowered || this.phase === "load" || this.paused) return;
    this.frameMs.push(raw * 1000);
    if (this.frameMs.length < 120) return;
    const avg = this.frameMs.reduce((a, b) => a + b, 0) / this.frameMs.length;
    this.frameMs.length = 0;
    if (avg > 23 && this.ao?.enabled) {
      // First, drop the ambient occlusion and measure again.
      this.ao.enabled = false;
      return;
    }
    if (avg > 23) {
      this.lowered = true;
      this.renderer.setPixelRatio(1);
      this.bloom.enabled = avg > 30 ? false : this.bloom.enabled;
      this.resize();
    }
  }

  stats() {
    return this.result;
  }

  destroy() {
    this.alive = false;
    this.mountEl?.classList.remove("attract");
    cancelAnimationFrame(this.raf);
    removeEventListener("resize", this.resize);
    removeEventListener("keydown", this.onKey);
    removeEventListener("keyup", this.onKey);
    removeEventListener("blur", this.onBlur);
    document.removeEventListener("visibilitychange", this.onVis);
    this.mountEl?.removeEventListener("pointerdown", this.onTap);
    this.audio.stop();
    this.hud?.destroy();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
    this.sparks.dispose();
    this.puffs.dispose();
    T.disposeTextures();
    M.disposeModels();
    this.scene.environment?.dispose();
    this.ao?.dispose();
    this.composer?.dispose();
    this.renderer?.dispose();
    this.renderer?.domElement.remove();
  }
}

/** When the intro camera reaches each keyframe, in seconds. */
const INTRO_KEYS = [0, 1.5, 2.5, 3.2, 4.3, 5.0, 5.6, 6.2];
export const INTRO_LEN = INTRO_KEYS[INTRO_KEYS.length - 1];

/** Map intro time onto the keyframed camera curve's 0..1 parameter. */
function introParam(t: number) {
  const k = INTRO_KEYS;
  if (!(t > 0)) return 0;
  if (t >= k[k.length - 1]) return 1;
  let i = 0;
  while (t > k[i + 1]) i++;
  let local = (t - k[i]) / (k[i + 1] - k[i]);
  // Ease in at the very start and out at the very end only.
  if (i === 0) local = local * local * (1.5 - 0.5 * local);
  if (i === k.length - 2) local = 1 - (1 - local) * (1 - local);
  return (i + local) / (k.length - 1);
}

/** Overshooting pop-in, 0..1 → 0..1. */
function elastic(t: number) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return Math.pow(2, -8 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
}
