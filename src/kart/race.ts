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
import { Confetti, Particles, ReplayTape, SkidMarks } from "./fx";
import { RaceAudio } from "./sound";
import { Hud, ITEM_NAME, type ItemKind } from "./hud";
import { TRACK_INFO, type CharId, type SkinId, type TrackId } from "../../shared/rules";
import { MASCOT } from "./mascot";
import { tickNature } from "./nature";
import { ContactAO, gradePass, sanitizePass } from "./grade";
import { portrait, skinPortrait } from "../ui/icons";
import { F, S, botId, type GameEvent, type NetPlayer } from "../../shared/net";
import type { RoomClient } from "../net/room";

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

/** A multiplayer race: the room, and who's on the grid (in grid order). */
export interface NetRace {
  room: RoomClient;
  raceId: number;
  grid: NetPlayer[];
  /** When the lights go out, if the room already said (a rejoin mid-race). */
  goAt?: () => number;
}

export interface MountOptions {
  /** Race other players in a room (see src/net/room.ts). */
  net?: NetRace;
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
  /** Coins carried: each one adds a little top speed (up to 10); a spin-out drops 3. */
  purse: number;
  /** How far a Custodian will swerve for a coin (0 never, 1 always). */
  greed: number;
  /** Seconds a Custodian has spent sliding through the current bend. */
  cornerT: number;
  /** Already lost coins for the current spin-out. */
  hurt: boolean;
  /** Stable id every game in a room agrees on: a player's id, or bot0, bot1… */
  id: string;
  /** A person (here or remote); false for Custodian bots and players who left. */
  human: boolean;
  name: string;
  /** Visual slide angle as last drawn (what the others are sent). */
  yaw: number;
  /** Multiplayer: states from the network, for karts another game drives. */
  net: NetKart | null;
}

/** A kart driven by another game, drawn a moment in the past, interpolated. */
interface NetKart {
  buf: number[][];
  /** How late states arrive (mean and spread, ms), and the render delay from them. */
  lateMean: number;
  lateDev: number;
  /** The last couple of seconds of lateness samples. */
  lates: number[];
  /** The delay the samples call for; `delay` eases toward it. */
  want: number;
  /** Typical time between the states it sends (a slow device sends less often). */
  gap: number;
  delay: number;
  primed: boolean;
  yaw: number;
  boost: number;
  glide: number;
  pitch: number;
  tier: number;
  flags: number;
  /** How far ahead of its drawn position the kart really is (m), for standings. */
  lead: number;
  /** Along-track prediction added to the interpolated position (m, smoothed). */
  ahead: number;
  /** Where it was drawn last frame. */
  shown: number;
  label: THREE.Sprite | null;
  shield: THREE.Mesh | null;
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
  /** Multiplayer: goo shared between games. */
  hid?: string;
}
interface Orb { u: number; lat: number; speed: number; life: number; obj: THREE.Object3D; target: Racer; oid: string; }
/** The player's Seeker Orb: flies up the track and homes in on the racer ahead. */
interface Seeker { u: number; lat: number; speed: number; life: number; obj: THREE.Object3D; target: Racer | null; sid: string; mine: boolean; }

const V = () => new THREE.Vector3();
/** Multiplayer: send kart states every this many ms. */
const SEND_MS = 50;
const NO_RENDER = import.meta.env.DEV && new URLSearchParams(location.search).has("norender");

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
  private puffs = new Particles(900, false);
  private skids: SkidMarks | null = null;
  /** The last few seconds of every kart, for the replay after the finish. */
  private tape: ReplayTape | null = null;
  private poses: M.KartPose[] = [];
  private replay: { t: number; from: number; to: number; shot: number; shotT: number; pos: THREE.Vector3; side: number } | null = null;
  /** Live broadcast feed on the circuit's jumbotrons. */
  private tv: { rt: THREE.WebGLRenderTarget; cam: THREE.PerspectiveCamera; screens: THREE.Mesh[]; n: number; shot: number; t: number; pos: THREE.Vector3 } | null = null;
  private boostKick = 0;
  private wasBoost = false;

  // Multiplayer
  private room: RoomClient | null = null;
  private netRace: NetRace | null = null;
  /** Racers by id, and the shared order bot messages index into. */
  private byId = new Map<string, Racer>();
  private order: string[] = [];
  /** Server time the lights go out (0 until the room says). */
  private goAt = 0;
  private sendT = 0;
  private netOff: (() => void)[] = [];
  private nextId = 0;
  private menuOpen = false;
  /** Online: finishing times (room clock) by racer id, bots included. */
  private finTimes = new Map<string, number>();
  /** Goo used mid-jump, dropped when the kart lands. */
  private gooOnLand = false;
  /** Dev: per-frame positions of every kart, for smoothness tests. */
  private trace: { t: number; k: Record<string, number[]> }[] | null = null;
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
  private seekers: Seeker[] = [];
  /** Ghost Mode: the player phases through karts, hazards and orbs. */
  private ghostT = 0;
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
  /** Dev: let the player's kart drive itself (for soak tests). */
  autopilot = false;
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
    this.audio.night = this.trackId === "town";
    this.attract = opts.attract === true;
    this.trailer = opts.trailer === true;
    if (opts.net) {
      this.netRace = opts.net;
      this.room = opts.net.room;
    }
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
    // Retina-sharp on capable machines; the frame-rate watchdog steps it down if needed.
    const maxRatio = this.trailer ? 1 : this.attract ? (this.quality === "low" ? 0.75 : 1) : this.quality === "low" ? 1.25 : 2;
    if (this.trailer) this.quality = "high";
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, maxRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.24;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    const cv = this.renderer.domElement;
    // If the GPU drops the context (driver reset, memory pressure), don't sit
    // on a black canvas: let it come back, then restart the race cleanly.
    cv.addEventListener("webglcontextlost", (e) => { e.preventDefault(); cancelAnimationFrame(this.raf); }, false);
    cv.addEventListener("webglcontextrestored", () => { if (this.alive && !this.attract && !this.trailer) this.hooks.onRestart(); }, false);
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
    const town = this.trackId === "town";
    // On the wet street a slide wipes the water off, leaving a dull grey
    // stripe; on the dry circuit it lays down rubber.
    this.skids = new SkidMarks(this.quality === "low" ? 900 : 2200, town ? "#56607a" : "#0d0d12", town ? 0.32 : 0.5);
    this.scene.add(this.skids.mesh);
    this.buildRacers();
    if (!this.attract) this.tape = new ReplayTape(this.racers.length);
    this.buildTv();
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
    // AO pays off in the sunlit stadium; at night the city is lit by neon
    // and the frame budget goes further without it.
    if (this.quality === "high" && !this.attract && !this.trailer && this.trackId !== "town") {
      this.ao = new ContactAO(this.scene, this.camera, 256, 256);
      this.composer.addPass(this.ao);
      // Softer sun shadows to go with it.
      this.world.sun.shadow.radius = 2.5;
    }
    this.composer.addPass(sanitizePass());
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.45, 2.9);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.grade = gradePass();
    this.composer.addPass(this.grade);
    this.resize();

    // Warm the GPU: compile every shader before the first visible frame.
    this.placeAll(0);
    this.captureReflections();
    if (this.attract) this.startAttract();
    else this.startIntro();
    this.renderer.compile(this.scene, this.camera);

    this.hud.loaded();
    if (this.room) this.joinNet();
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
      // Multiplayer probes: every kart as this game sees it, and a per-frame
      // trace of the network karts (to measure smoothness).
      w.__net = () => ({
        phase: this.phase, goAt: this.goAt, now: this.room?.now() ?? 0, wall: Date.now(), clk: this.room ? (this.room.now() - this.goAt) / 1000 : 0, host: this.room?.isHost() ?? false, rtt: this.room?.rtt ?? 0,
        pos: this.lastPos, finished: this.racers[0].finished, raceT: this.raceT,
        karts: this.racers.map((r) => ({ id: r.id, human: r.human, sim: this.sims(r), dist: +r.dist.toFixed(2), lat: +r.lat.toFixed(2), speed: +r.speed.toFixed(1), delay: r.net ? Math.round(r.net.delay) : 0, buf: r.net?.buf.length ?? 0, late: r.net ? Math.round(r.net.lateMean) : 0, dev: r.net ? Math.round(r.net.lateDev) : 0, gap: r.net ? Math.round(r.net.gap) : 0 })),
        fps: this.frameMs.length ? Math.round(1000 / (this.frameMs.reduce((a, b) => a + b, 0) / this.frameMs.length)) : 0,
      });
      w.__room = this.room;
      w.__fins = () => Object.fromEntries([...this.finTimes].map(([k, v]) => [k, +v.toFixed(2)]));
      w.__trace = (on: boolean) => { this.trace = on ? [] : null; return this.trace; };
      w.__traced = () => this.trace;
      w.__step = (sec: number, fps = 60) => {
        const n = Math.max(0, Math.round(sec * fps));
        for (let i = 0; i < n; i++) { this.update(1 / fps); this.pressed.clear(); }
        this.composer.render();
        document.querySelector(".kh-load")?.remove();
        return { phase: this.phase, t: +this.phaseT.toFixed(2), pos: this.lastPos, score: this.score };
      };
      w.__keys = (k: Partial<typeof this.input>) => Object.assign(this.input, k);
      w.__press = (code: string) => this.pressed.add(code);
      w.__nearFinish = () => { const p = this.racers[0]; p.dist = this.laps * this.track.length - 12; this.lap = this.laps; this.camReady = false; };
      // Average brightness of a freshly rendered frame (0..255), to catch black frames.
      w.__lum = () => {
        this.composer.render();
        const c = document.createElement("canvas");
        c.width = 32; c.height = 18;
        const g = c.getContext("2d")!;
        g.drawImage(this.renderer.domElement, 0, 0, 32, 18);
        const d = g.getImageData(0, 0, 32, 18).data;
        let s = 0;
        for (let i = 0; i < d.length; i += 4) s += (d[i] + d[i + 1] + d[i + 2]) / 3;
        return s / (d.length / 4);
      };
      w.__use = (k: ItemKind) => { this.item = k; this.useItem(this.racers[0]); };
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
    const make = (i: number, look: M.KartLook, slot: number, id = i === 0 ? "me" : botId(i - 1), human = i === 0, name = "") => {
      const model = new M.KartModel(look, shadowTex);
      this.scene.add(model.root, model.shadowRoot);
      if (this.trackId === "town") model.lightsOn();
      const g = gridSlot(slot);
      const r: Racer = {
        i, player: i === 0, model,
        dist: g.du, lat: g.lat, latV: 0, speed: 0, steer: 0, slide: 0,
        hop: 0, hopV: 0, squash: 1, air: false, y: 0, vy: 0, airT: 0,
        spin: 0, spinAng: 0, flip: 0, boostT: 0, finished: false,
        skill: 1, bias: 0, aggro: 0, itemT: 12, shoveT: 0, bumpT: 0, frozen: 0,
        prevU: 0, color: look.trim, purse: 0, greed: 0, cornerT: 0, hurt: false,
        id, human, name, yaw: 0, net: null,
      };
      r.prevU = this.track.wrap(this.track.startU + r.dist);
      this.racers.push(r);
      this.byId.set(id, r);
      return r;
    };
    const skills = [0.97, 0.961, 0.952, 0.943, 0.934, 0.925, 0.916];
    const bot = (r: Racer, k: number) => {
      r.skill = skills[k % skills.length];
      r.bias = ((k * 37) % 7) / 3 - 1;
      r.aggro = k % 3 === 0 ? 0.9 : k % 3 === 1 ? 0.5 : 0.2;
      r.itemT = 8 + k * 1.8;
      r.greed = [0.4, 0.9, 0.6, 0.85, 0.35, 0.8, 0.7][k % 7];
    };

    if (this.netRace) {
      // Online: the people at the back of the grid in join order, Custodian
      // bots filling the front. Every game builds the same order.
      const grid = this.netRace.grid.slice(0, RIVALS + 1);
      const me = this.room!.you;
      const bots = RIVALS + 1 - grid.length;
      this.order = [...grid.map((g) => g.id), ...Array.from({ length: bots }, (_, k) => botId(k))];
      const mine = grid.find((g) => g.id === me);
      make(0, M.lookFor(mine?.char ?? this.char, mine ? mine.skin : this.skin), bots + Math.max(0, grid.findIndex((g) => g.id === me)), me, true, mine?.name ?? "");
      grid.forEach((g, k) => {
        if (g.id === me) return;
        const r = make(this.racers.length, M.lookFor(g.char, g.skin), bots + k, g.id, true, g.name);
        r.net = this.newNetKart(r);
      });
      for (let k = 0; k < bots; k++) {
        const r = make(this.racers.length, M.RIVAL_LOOKS[k], k, botId(k), false);
        bot(r, k);
        r.net = this.newNetKart(r);
      }
      return;
    }
    // The player starts at the back of the grid, like the reference — the
    // whole race is a climb through the field.
    make(0, M.lookFor(this.char, this.skin), RIVALS);
    // Front of the grid is quickest. All of them are a touch slower than a
    // player holding the gas, so passes come steadily rather than in a burst.
    for (let k = 0; k < RIVALS; k++) {
      const r = make(k + 1, M.RIVAL_LOOKS[k], k);
      bot(r, k);
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
      if (this.phase === "race" || this.phase === "countdown") this.setPaused(!(this.paused || this.menuOpen));
      e.preventDefault();
      return;
    }
    if (down && k === "Enter" && (this.paused || this.menuOpen)) { this.setPaused(false); return; }
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
    // Online the race goes on underneath the menu.
    if (this.room) { this.hud.paused(p); this.menuOpen = p; return; }
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
    // Dev tests without drawing tick on a 60 Hz timer (headless rAF is
    // either throttled or, unthrottled, a busy loop).
    if (NO_RENDER) this.raf = window.setTimeout(() => this.frame(performance.now()), 16) as unknown as number;
    else this.raf = requestAnimationFrame(this.frame);
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
    // Online a slow device must keep real time with the others, so it may
    // take bigger steps; offline a hitch just slows the game for a frame.
    const dt = Math.min(raw + this.skipped, this.room ? 1 / 12 : 1 / 20);
    this.skipped = 0;
    if (!this.paused) this.update(dt);
    // Dev: ?norender=1 runs the game without drawing, so headless
    // multiplayer tests get a real frame rate.
    if (!NO_RENDER) {
      this.renderTv(dt);
      this.composer.render();
    }
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
      case "race":
        // Online the race clock is the room's, so every game agrees on it.
        if (this.room && this.goAt) this.raceT = Math.max(0, (this.room.now() - this.goAt) / 1000);
        else this.raceT += dt;
        break;
      case "finish":
        if (this.phaseT > 3.4 && !this.result) this.endRace();
        if (this.result && !this.replay && this.phaseT > 5.5) this.startReplay();
        break;
    }

    const moving = this.phase === "race" || this.phase === "finish";
    if (moving && this.attract) {
      for (const r of this.racers) this.updateRival(r, dt);
      this.bumps(dt);
      // Endless race: roll everyone back a lap together so nobody "finishes".
      if (player.dist > this.track.length * 2) for (const r of this.racers) { r.dist -= this.track.length; r.finished = false; }
    } else if (moving) {
      this.updatePlayer(player, dt);
      for (let k = 1; k < this.racers.length; k++) if (this.sims(this.racers[k])) this.updateRival(this.racers[k], dt);
      this.bumps(dt);
      this.collide(player, dt);
      this.updateOrbs(dt);
      this.updateSeekers(dt);
      this.standings();
    }
    if (this.room) this.netTick(dt);
    this.updateHazards(dt);
    this.updateProps(dt);
    if (this.replay) this.playReplay(dt);
    else {
      this.placeAll(dt);
      this.recordTape(dt);
      this.driftFx();
    }
    this.skids?.update();
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
    if (this.room) {
      // Online the lights go out for everyone at once: wait for the room.
      const now = this.room.now();
      if (!this.goAt) this.hud.waiting("Waiting for racers…");
      else if (now >= this.goAt - 3000) {
        this.hud.waiting(null);
        this.startCountdown();
        this.phaseT = (now - (this.goAt - 3000)) / 1000;
      } else this.hud.waiting(null);
      return;
    }
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
    // Online, the countdown runs on the room's clock so GO is shared.
    if (this.room && this.goAt) this.phaseT = (this.room.now() - (this.goAt - 3000)) / 1000;
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
      if (!this.sims(r)) continue;
      r.speed = 5 + (k % 3) * 1.5;
      if (k <= 2) r.boostT = 0.6;
    }
    if (this.room) {
      // Same clock and the same drone sweeps in every game from here on.
      this.raceT = Math.max(0, (this.room.now() - this.goAt) / 1000);
      this.time = 0;
      this.hazards.forEach((h, i) => { if (h.kind === "drone") h.phase = i * 1.37; });
    }
  }

  private finishRace() {
    const p = this.racers[0];
    p.finished = true;
    this.phase = "finish";
    this.phaseT = 0;
    this.driftDir = 0; this.driftTier = 0; this.driftT = 0;
    this.hud.banner("FINISH!", "", 2600);
    if (this.room && this.netRace) {
      this.finTimes.set(this.room.you, this.raceT);
      this.room.send({ t: "fin", time: this.raceT, raceId: this.netRace.raceId });
    }
    this.audio.fanfare();
    this.audio.setMusic(0.45);
    this.confetti.burst(this.v1.copy(this.racers[0].model.root.position).add(new THREE.Vector3(0, 5, 0)), 160, 9, 12);
  }

  private endRace() {
    let pos = this.lastPos;
    // Online, finishing times on the room clock decide places: a photo
    // finish reads the same in every game.
    const mine = this.room ? this.finTimes.get(this.room.you) : undefined;
    if (mine !== undefined) pos = 1 + [...this.finTimes.values()].filter((t) => t < mine).length;
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
    if (this.trailer || this.autopilot) this.autoDrive(p, dt);
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
        if (want !== 0 && p.speed > 13) {
          this.turnHeld += dt;
          if (this.turnHeld > 0.32) {
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
    // Ghost Mode: the kart flickers like a hologram and trails violet wisps.
    if (this.ghostT > 0) {
      this.ghostT = Math.max(0, this.ghostT - dt);
      const on = this.ghostT > 0;
      p.model.body.visible = !on || Math.sin(this.time * 38) > (this.ghostT < 1.2 ? -0.2 : 0.35);
      if (on && Math.random() < 0.7) {
        const q = p.model.root.position;
        this.puffs.spawn(q.x + (Math.random() - 0.5) * 1.6, q.y + 0.6 + Math.random(), q.z + (Math.random() - 0.5) * 1.6, 0, 0.6, 0,
          this.col.set("#b58cff"), 0.5, 0.4, { grow: 1.3, drag: 2 });
      }
    }
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
      case "seeker": {
        // Lock onto the nearest racer ahead.
        let target: Racer | null = null, best = 160;
        for (let k = 1; k < this.racers.length; k++) {
          const r = this.racers[k];
          const d = r.dist - p.dist;
          if (d > 2 && d < best && !r.finished) { best = d; target = r; }
        }
        const obj = M.seeker();
        this.scene.add(obj);
        const sk: Seeker = { u: this.track.wrap(this.track.startU + p.dist + 2.5), lat: p.lat, speed: p.speed + 14, life: 6, obj, target, sid: this.uid(), mine: true };
        this.seekers.push(sk);
        this.emit({ e: "seek", sid: sk.sid, target: target?.id ?? "", u: sk.u, lat: sk.lat, speed: sk.speed });
        this.audio.boost();
        this.hud.flash("#ffd84a");
        break;
      }
      case "ghost":
        this.ghostT = 5;
        p.boostT = Math.max(p.boostT, 0.8);
        this.audio.shield();
        this.hud.flash("#b58cff");
        break;
      case "goo":
        // Mid-jump there's no road to drop it on: it goes down on landing.
        if (p.air) this.gooOnLand = true;
        else this.dropGoo(p);
        this.audio.land();
        this.hud.flash("#6dff9e");
        break;
      case "zap": {
        const n = this.applyZap(p, p.dist);
        this.emit({ e: "zap", dist: p.dist });
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
      ? [["shield", 4], ["magnet", 3.5], ["goo", 3], ["turbo", 2]]
      : pos <= 3
        ? [["turbo", 3], ["seeker", 2.5], ["shield", 2], ["magnet", 2], ["goo", 2], ["zap", 1.2], ["ghost", 1.2]]
        : [["turbo", 3.5], ["seeker", 3], ["zap", 2.5], ["ghost", 2], ["magnet", 1.2], ["shield", 1.2]];
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
    // Coins carried add up to 3.5% top speed, for everyone.
    let top = TOP * r.skill * (gas ? 1 : CRUISE) * cap * (1 + Math.min(10, r.purse) * 0.0035);
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
      // A drift carves an arc through the bend: the slide soaks up most of
      // the corner's pull, and the stick sets how tight the arc is — hold
      // into the drift to tighten it, lean the other way to run it wider.
      // In a typical bend holding in creeps gently to the inside and
      // counter-steering drifts gently out, so the line is yours to steer.
      r.steer += (this.driftDir * (this.driftHold > 0 ? 0.9 : 0.45) - r.steer) * Math.min(1, dt * 8);
      const arc = this.driftHold > 0 ? 0.42 : 0.06;
      target = this.driftDir * steerRate * arc + push * 0.6;
    } else {
      r.steer += (steerIn - r.steer) * Math.min(1, dt * 9);
      target = r.steer * steerRate + push;
    }
    // A drifting kart carries its momentum: it answers the stick a beat slower.
    r.latV += (target - r.latV) * Math.min(1, dt * (drifting ? 4.5 : 6));
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
    if (r.spin > 0 && !r.hurt) { r.hurt = true; r.purse = Math.max(0, r.purse - 3); }
    if (r.spin <= 0) r.hurt = false;
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
      if (r.player && this.gooOnLand) { this.gooOnLand = false; this.dropGoo(r); }
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
    const p = this.focusHuman(r);
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
    // Swerve for coins on the way, if they're close to the line.
    if (r.greed > 0 && !r.air) {
      let best = Infinity;
      for (const c of this.coins) {
        if (!c.alive || c.h > 2) continue;
        const d = tr.delta(u, c.u);
        if (d < 5 || d > 30) continue;
        const off = Math.abs(c.lat - target);
        if (off < 1.6 + r.greed * 3.4 && off + d * 0.1 < best) { best = off + d * 0.1; target = c.lat; }
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
    if (gapToPlayer > 22) band = 1 + Math.min(0.18, (gapToPlayer - 22) * 0.004);
    if (gapToPlayer < -40) band = 1 - Math.min(0.12, (-gapToPlayer - 40) * 0.003);
    // Catch-up never makes a Custodian faster than you at full gas.
    const skill = r.skill;
    r.skill = band > 1 ? Math.min(skill * band, 0.985) : skill * band;
    this.drive(r, steer, true, false, dt);
    r.skill = skill;

    // Custodians drift the bends too, and fire a mini-turbo on the way out.
    const bend = Math.abs(tr.curvature(u));
    if (!r.air && bend > 0.018 && r.speed > 14) r.cornerT += dt;
    else if (bend < 0.01) {
      if (r.cornerT > 0.9 && r.spin <= 0 && Math.random() < 0.35 + r.skill * 0.4) r.boostT = Math.max(r.boostT, 0.45 + Math.min(0.5, (r.cornerT - 0.9) * 0.25));
      r.cornerT = 0;
    }
    this.rivalCoins(r, u);

    if (r.air && Math.random() < dt * 0.6 && r.flip === 0) r.flip = 0.001;
    if (r.flip > 0) r.flip = Math.min(Math.PI * 2, r.flip + dt * 11);
    if (!r.air && r.flip >= Math.PI * 2) r.flip = 0;

    // Custodian tricks: goo behind them if you're close behind, a freeze orb
    // if you've got away from them.
    // Attacks share one cooldown across the whole pack, so they never pile up.
    r.itemT -= dt;
    if (r.itemT <= 0 && this.attackCool <= 0 && this.phase === "race" && this.raceT > 7 && !r.finished) {
      r.itemT = 11 + Math.random() * 7;
      if (gapToPlayer < -12 && gapToPlayer > -40 && this.hazards.filter((h) => h.kind === "goo").length < 2) {
        this.dropGoo(r);
        this.attackCool = 4;
      } else if (gapToPlayer > 14 && gapToPlayer < 70 && this.orbs.length < 1) {
        this.fireOrb(r);
        this.attackCool = 15 + Math.random() * 6;
      }
    }

    if (!r.finished && r.dist >= this.laps * tr.length) {
      r.finished = true;
      // Online the host reports its bots' finishes, so every game's
      // standings agree.
      if (this.room && this.netRace && this.phase !== "load") {
        // The room clock, not raceT: that stops when our own race ends.
        const t = Math.max(0, (this.room.now() - this.goAt) / 1000);
        this.finTimes.set(r.id, t);
        this.room.send({ t: "fin", time: t, raceId: this.netRace.raceId, who: r.id });
      }
    }
  }

  /** A Custodian drives through a coin: it's gone for everyone until it respawns. */
  private rivalCoins(r: Racer, u: number) {
    if (r.air || r.spin > 0) return;
    const tr = this.track;
    for (let ci = 0; ci < this.coins.length; ci++) {
      const c = this.coins[ci];
      if (!c.alive || c.h > 2) continue;
      if (Math.abs(tr.delta(u, c.u)) < 1.9 && Math.abs(c.lat - r.lat) < 1.7) {
        c.alive = false;
        c.pop = 0.35;
        c.respawn = 7;
        r.purse++;
        this.emit({ e: "coin", i: ci });
        const w = tr.point(c.u, c.lat, c.h, this.v1);
        if (w.distanceToSquared(this.camera.position) < 70 * 70) {
          this.burst(w, c.kind === "eth" ? "#c9b8ff" : "#ffd84d", 8, 3);
          if (w.distanceToSquared(this.camera.position) < 30 * 30) this.audio.coin(1, 0.35);
        }
      }
    }
  }

  private dropGoo(r: Racer) {
    const at = this.track.wrap(this.track.startU + r.dist - 3.5);
    if (r.air || this.track.inGap(at)) return;
    const obj = M.goo();
    this.scene.add(obj);
    const u = this.track.wrap(this.track.startU + r.dist - 3.5);
    const hid = this.room ? this.uid() : undefined;
    this.hazards.push({ kind: "goo", u, lat: r.lat, r: 1.3, obj, life: 14, phase: 0, knocked: 0, kv: V(), base: r.lat, span: 0, ring: null, hid });
    obj.scale.setScalar(0.01);
    if (hid) this.emit({ e: "goo", hid, u, lat: r.lat });
  }

  private fireOrb(r: Racer) {
    const obj = M.orb();
    this.scene.add(obj);
    const target = this.focusHuman(r);
    const o: Orb = { u: this.track.wrap(this.track.startU + r.dist + 2), lat: r.lat, speed: r.speed + 6, life: 6, obj, target, oid: this.uid() };
    this.orbs.push(o);
    this.emit({ e: "orb", oid: o.oid, target: target.id, u: o.u, lat: o.lat, speed: o.speed });
  }

  private updateOrbs(dt: number) {
    let warn = false;
    for (const o of this.orbs) {
      const p = o.target;
      const pu = this.track.wrap(this.track.startU + p.dist);
      o.life -= dt;
      o.speed = Math.min(40, Math.max(o.speed, p.speed + 7));
      o.u = this.track.wrap(o.u + o.speed * dt);
      o.lat += THREE.MathUtils.clamp(p.lat - o.lat, -2 * dt, 2 * dt);
      const d = this.track.delta(o.u, pu);
      if (d > 0 && d < 45 && p.player) warn = true;
      this.track.point(o.u, o.lat, 1.1 + Math.sin(this.time * 12) * 0.15, o.obj.position);
      o.obj.rotation.y += dt * 8;
      if (Math.random() < 0.8) {
        const q = o.obj.position;
        this.sparks.spawn(q.x, q.y, q.z, (Math.random() - 0.5), Math.random(), (Math.random() - 0.5), this.col.set("#ff4a5e"), 0.9, 0.35);
      }
      if (Math.abs(d) < 1.5 && Math.abs(o.lat - p.lat) < 1.5 && !p.air && !(p.player && this.ghostT > 0)) {
        o.life = 0;
        this.burst(o.obj.position, "#ff4a5e", 30, 8);
        // Only the game driving the target settles the hit; elsewhere the
        // orb just vanishes into the kart.
        if (this.sims(p)) {
          if (p.player) this.hitPlayer(p, "FROZEN!");
          else if (p.spin <= 0) { p.spin = 1; p.frozen = 1.2; p.speed *= 0.5; }
          this.emit({ e: "orbEnd", oid: o.oid });
        }
      }
    }
    this.orbs = this.orbs.filter((o) => {
      if (o.life > 0) return true;
      this.scene.remove(o.obj);
      return false;
    });
    this.hud.warn(warn && this.phase === "race");
  }

  private updateSeekers(dt: number) {
    const tr = this.track;
    for (const o of this.seekers) {
      o.life -= dt;
      o.speed = Math.min(52, o.speed + dt * 20);
      o.u = tr.wrap(o.u + o.speed * dt);
      const t = o.target;
      if (t) {
        o.lat += THREE.MathUtils.clamp(t.lat - o.lat, -7 * dt, 7 * dt);
        const tu = tr.wrap(tr.startU + t.dist);
        const d = tr.delta(o.u, tu);
        if (Math.abs(d) < 1.8 && Math.abs(o.lat - t.lat) < 1.8 && !t.air) {
          o.life = 0;
          this.burst(t.model.root.position, "#ffd84a", 34, 9);
          // The game driving the target settles it (so a shield works).
          if (this.sims(t)) {
            if (t.player) this.hitPlayer(t, "SEEKER!");
            else { t.spin = 1.4; t.frozen = 1.1; t.speed *= 0.4; }
            if (o.mine) this.seekerScored(t);
            if (this.room) this.emit({ e: "seekEnd", sid: o.sid, hit: true });
          }
        } else if (d < -6) {
          // Overshot (the target jumped or dodged): pick them up again next lap.
          o.target = null;
        }
      }
      tr.point(o.u, o.lat, 1.2 + Math.sin(this.time * 10) * 0.12, o.obj.position);
      o.obj.rotation.y += dt * 10;
      o.obj.rotation.x += dt * 4;
      if (Math.random() < 0.9) {
        const q = o.obj.position;
        this.sparks.spawn(q.x, q.y, q.z, (Math.random() - 0.5) * 2, Math.random(), (Math.random() - 0.5) * 2, this.col.set(Math.random() < 0.5 ? "#ffd84a" : "#7fb0ff"), 1.0, 0.4);
      }
    }
    this.seekers = this.seekers.filter((o) => {
      if (o.life > 0) return true;
      this.scene.remove(o.obj);
      return false;
    });
  }

  private seekerScored(t: Racer | null) {
    this.takedowns++;
    this.addScore(60, "takedowns");
    this.hud.pop(t?.human && !t.player ? `HIT ${t.name}! +60` : "SEEKER HIT! +60", "gold big");
    this.audio.bonk();
  }

  /** A zap from `zapper` at race distance `dist`: freeze everyone just ahead of it. */
  private applyZap(zapper: Racer, dist: number): number {
    let n = 0;
    for (const r of this.racers) {
      if (r === zapper || r.finished) continue;
      const d = r.dist - dist;
      if (d <= -15 || d >= 110) continue;
      n++;
      this.burst(r.model.root.position, "#8fe3ff", 26, 7);
      if (!this.sims(r)) continue;
      if (r.player) {
        const shielded = this.shieldT > 0 || this.ghostT > 0;
        this.hitPlayer(r, "ZAPPED!");
        if (!shielded) r.frozen = 1.8;
      } else {
        r.spin = 1.6;
        r.frozen = 2.2;
      }
    }
    return n;
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
        if (this.ghostT > 0 && (A.player || B.player)) continue;
        // Online, each game only pushes the karts it drives.
        const simA = this.sims(A), simB = this.sims(B);
        if (!simA && !simB) continue;
        if ((A.net && !simA && A.net.flags & F.ghost) || (B.net && !simB && B.net.flags & F.ghost)) continue;
        const du = tr.delta(tr.wrap(tr.startU + A.dist), tr.wrap(tr.startU + B.dist));
        const dl = B.lat - A.lat;
        if (Math.abs(du) > 2.7 || Math.abs(dl) > 1.95) continue;
        const s = Math.sign(dl) || 1;
        const overlap = 1.95 - Math.abs(dl);
        // A kart that only this game moves takes the whole shove.
        const shareA = simA ? (simB ? 0.5 : 1) : 0, shareB = simB ? (simA ? 0.5 : 1) : 0;
        A.lat -= s * overlap * shareA;
        B.lat += s * overlap * shareB;
        if (simA) A.latV -= s * 3.5;
        if (simB) B.latV += s * 3.5;
        if (A.bumpT > 0 || B.bumpT > 0) continue;
        A.bumpT = B.bumpT = 0.6;
        if (A.player || B.player) {
          const me = A.player ? A : B, them = A.player ? B : A;
          if (me.boostT > 0 && them.spin <= 0) {
            if (this.sims(them)) {
              them.spin = 1.2;
              them.speed *= 0.5;
            } else this.emit({ e: "strike", who: them.id });
            this.takedowns++;
            this.addScore(100, "takedowns");
            this.hud.pop("TAKEDOWN! +100", "pink big");
            this.audio.bonk();
            this.burst(them.model.root.position, "#ffe14d", 24, 7);
          } else if (this.shieldT > 0) {
            if (this.sims(them)) them.spin = 0.9;
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
        if (this.sims(back)) back.speed *= 0.96;
      }
    }
  }

  private standings() {
    const p = this.racers[0];
    if (p.finished) return;
    let pos = 1;
    for (let k = 1; k < this.racers.length; k++) {
      const r = this.racers[k];
      if (r.dist + (r.net && !this.sims(r) ? r.net.lead : 0) > p.dist) pos++;
    }
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

    for (let ci = 0; ci < this.coins.length; ci++) {
      const c = this.coins[ci];
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
        this.emit({ e: "coin", i: ci });
        const val = c.kind === "btc" ? 60 : c.kind === "eth" ? 30 : 10;
        this.addScore(val, "coins");
        this.coinCount++;
        p.purse++;
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
        this.emit({ e: "box", i: this.boxes.indexOf(b) });
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
      if (!this.sims(r)) continue;
      const ru = tr.wrap(tr.startU + r.dist);
      for (const pad of this.pads) {
        if (Math.abs(tr.delta(ru, pad.u)) < 2.7 && Math.abs(pad.lat - r.lat) < 1.8 && r.boostT < 0.5) r.boostT = 1.0;
      }
    }

    for (const h of this.hazards) {
      if (h.knocked > 0 || this.ghostT > 0) continue;
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
        if (h.hid) this.emit({ e: "gooEnd", hid: h.hid });
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
      if (!this.sims(r)) continue;
      const ru = tr.wrap(tr.startU + r.dist);
      for (const h of this.hazards) {
        if (h.knocked > 0 || r.air) continue;
        if (Math.abs(tr.delta(ru, h.u)) > h.r + 1.2 || Math.abs(h.lat - r.lat) > h.r + 0.8) continue;
        if (h.kind === "cone") { h.knocked = 4; h.kv.set((Math.random() - 0.5) * 6, 7, r.speed * 0.6); }
        else if (h.kind === "goo" && r.spin <= 0) {
          r.spin = 0.9; r.speed *= 0.5; h.life = 0;
          if (h.hid) this.emit({ e: "gooEnd", hid: h.hid });
        }
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
    w.weather?.update(this.camera, dt, this.racers[0]?.model.root.position);
    w.animate?.(t, dt);
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

      // Visual yaw: sideways velocity, plus the drift slide. A kart another
      // game drives arrives with its own.
      const n = r.net && !this.sims(r) ? r.net : null;
      let yaw: number;
      if (n) {
        yaw = n.yaw;
        r.slide = n.yaw;
      } else {
        const slideTarget = r.player
          ? this.driftDir * (this.driftHold < 0 ? 0.3 : 0.48)
          : (Math.abs(this.f.curv) > 0.018 && r.speed > 14 && !r.air ? Math.sign(this.f.curv) * 0.28 : 0);
        r.slide += (slideTarget - r.slide) * Math.min(1, dt * 7);
        yaw = Math.atan2(r.latV, Math.max(4, r.speed)) * 0.9 + r.slide;
      }
      r.yaw = yaw;
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
        boost: n ? n.boost : r.boostT > 0 ? Math.min(1, r.boostT * 2) : 0,
        glide: n ? n.glide : r.air ? Math.min(1, r.airT * 2.5) : 0,
        pitch: n ? n.pitch : r.air ? THREE.MathUtils.clamp(r.vy * 0.035, -0.28, 0.3) : 0,
        wave,
        time: this.time + r.i,
      };
      r.model.update(this.poseOverride ? this.poseOverride(r.i, pose) : pose, dt);
      this.poses[r.i] = pose;
      if (r.net) this.dressNetKart(r);
    }
  }

  /* ---------------- Multiplayer ---------------- */

  /**
   * Is this kart simulated by this game? The player always; bots (and
   * players who left) by the host, or by us offline. Everything else is
   * drawn from the network.
   */
  private sims(r: Racer): boolean {
    return r.player || (!r.human && (!this.room || this.room.isHost()));
  }

  private newNetKart(r: Racer): NetKart {
    return {
      buf: [], lateMean: 0, lateDev: 0, lates: [], want: 120, gap: SEND_MS, delay: 120, primed: false,
      yaw: 0, boost: 0, glide: 0, pitch: 0, tier: 0, flags: 0, lead: 0, ahead: 0, shown: -Infinity,
      label: r.human ? this.nameLabel(r.name) : null, shield: null,
    };
  }

  /** Once the track is built: listen to the room and tell it we're ready. */
  private joinNet() {
    const room = this.room!, nr = this.netRace!;
    this.netOff.push(
      room.on("state", (id, d) => this.onState(id, d)),
      room.on("bots", (list) => {
        if (room.isHost()) return;
        for (const e of list) {
          const r = this.byId.get(this.order[e[0]]);
          if (r && !r.player) this.pushState(r, e.slice(1));
        }
      }),
      room.on("go", (m) => { if (m.raceId === nr.raceId) this.goAt = m.at; }),
      room.on("ev", (m) => this.onEvent(m.id, m.ev)),
      room.on("left", (m) => this.netLeft(m.id)),
      room.on("fin", (m) => {
        if (m.raceId !== nr.raceId) return;
        this.finTimes.set(m.id, m.time);
        const r = this.byId.get(m.id);
        if (r && !r.player) r.finished = true;
      }),
    );
    room.send({ t: "loaded", raceId: nr.raceId });
    const known = nr.goAt?.() ?? 0;
    if (known) this.goAt = known;
  }

  private onState(id: string, d: number[]) {
    const r = this.byId.get(id);
    if (!r || r.player || !r.net || !Array.isArray(d) || d.length < 12) return;
    // They're back (a reconnect after we'd handed their kart to the host).
    if (!r.human && this.netRace?.grid.some((g) => g.id === id)) r.human = true;
    this.pushState(r, d);
  }

  /** Keep a state in time order, and learn how late states tend to arrive. */
  private pushState(r: Racer, d: number[]) {
    const n = r.net!;
    const buf = n.buf;
    const ts = d[S.ts];
    if (buf.length && ts > buf[buf.length - 1][S.ts]) n.gap += (Math.min(1000, ts - buf[buf.length - 1][S.ts]) - n.gap) * 0.1;
    if (buf.length && ts <= buf[buf.length - 1][S.ts]) {
      if (buf.some((x) => x[S.ts] === ts)) return;
      buf.push(d);
      buf.sort((a, b) => a[S.ts] - b[S.ts]);
    } else buf.push(d);
    if (buf.length > 40) buf.splice(0, buf.length - 40);
    // Lateness = clock error + one-way trip + jitter. Render far enough in
    // the past that the next state has almost always arrived: mean plus a
    // few deviations plus one send interval.
    const late = this.room!.now() - ts;
    if (!n.primed) { n.lateMean = late; n.lateDev = 12; n.primed = true; }
    else {
      n.lateMean += (late - n.lateMean) * 0.08;
      n.lateDev += (Math.abs(late - n.lateMean) - n.lateDev) * 0.08;
    }
    // Render far enough back that ~90% of states have arrived in time (the
    // rest are bridged by a short extrapolation), plus one send interval.
    n.lates.push(late);
    if (n.lates.length > 40) n.lates.shift();
    const sorted = [...n.lates].sort((x, y) => x - y);
    const p90 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))];
    const want = THREE.MathUtils.clamp(p90 + Math.max(SEND_MS, n.gap) + 10, 50, 600);
    n.want = want;
  }

  private netTick(dt: number) {
    const room = this.room!;
    const now = room.now();
    for (const r of this.racers) {
      if (!r.net || this.sims(r)) continue;
      // Ease the render delay toward what the network needs. Changing it
      // bends the kart's apparent speed, so slowly: shrinking by at most 6%
      // of real time (invisible), growing by up to 25% (a starving buffer
      // looks worse than a brief slow-down).
      const n = r.net, ms = dt * 1000;
      n.delay += THREE.MathUtils.clamp(n.want - n.delay, -0.06 * ms, 0.25 * ms);
      this.followNet(r, now, dt);
    }
    if (this.trace && this.trace.length < 3000) {
      const k: Record<string, number[]> = {};
      for (const r of this.racers) k[r.id] = [+r.dist.toFixed(3), +r.lat.toFixed(3), r.net && !this.sims(r) ? Math.round(r.net.delay - (r.speed > 0.5 ? r.net.ahead / r.speed * 1000 : 0)) : 0, r.net ? Math.round(r.net.lateMean) : 0, r.net ? Math.round(r.net.lateDev) : 0, r.net ? Math.round(r.net.gap) : 0];
      this.trace.push({ t: +now.toFixed(1), k });
    }

    // Send ours 20 times a second (and the bots', if we're the host).
    this.sendT += dt;
    if (this.sendT < SEND_MS / 1000) return;
    this.sendT = Math.min(this.sendT - SEND_MS / 1000, SEND_MS / 1000);
    if (this.phase === "load") return;
    room.sendState(this.packState(this.racers[0], now));
    if (room.isHost()) {
      const list: number[][] = [];
      for (const r of this.racers) {
        if (r.player || r.human) continue;
        list.push([this.order.indexOf(r.id), ...this.packState(r, now)]);
      }
      if (list.length) room.sendBots(list);
    }
  }

  private packState(r: Racer, now: number): number[] {
    const pose = this.poses[r.i];
    const me = r.player;
    const flags = (r.air ? F.air : 0) | (r.spin > 0 ? F.spin : 0) | (r.finished ? F.finished : 0) | (r.frozen > 0 ? F.frozen : 0)
      | (me && this.shieldT > 0 ? F.shield : 0) | (me && this.ghostT > 0 ? F.ghost : 0) | (me && this.magnetT > 0 ? F.magnet : 0)
      | ((me ? this.driftDir !== 0 : Math.abs(r.slide) > 0.2) ? F.drift : 0);
    const q = (v: number, k = 100) => Math.round(v * k) / k;
    return [
      Math.round(now), q(r.dist), q(r.lat), q(r.speed), q(r.y), flags, q(r.yaw, 1000), q(r.steer), q(r.hop), q(r.flip),
      q(r.spinAng), me ? this.driftTier : 0, q(pose?.glide ?? 0), q(pose?.pitch ?? 0, 1000), q(pose?.boost ?? 0), q(r.squash),
    ];
  }

  /** Put a network kart where it was `delay` ms ago, between the two states either side. */
  private followNet(r: Racer, now: number, dt: number) {
    const n = r.net!;
    const buf = n.buf;
    if (!buf.length) return;
    const t = now - n.delay;
    // Drop states we've moved past (keeping one behind for the blend).
    while (buf.length > 2 && buf[1][S.ts] <= t) buf.shift();
    let a = buf[0], b = buf[0];
    if (buf.length > 1 && buf[0][S.ts] <= t) { a = buf[0]; b = buf[1]; }
    const span = b[S.ts] - a[S.ts];
    const k = span > 0 ? THREE.MathUtils.clamp((t - a[S.ts]) / span, 0, 1) : 1;
    const L = (i: number) => a[i] + (b[i] - a[i]) * k;
    const near = k < 0.5 ? a : b;
    let dist = L(S.dist);
    // Ran out of states (a hiccup): carry on at the pace it was really
    // making (not its speedo — a struggling device moves slower), briefly.
    if (t > b[S.ts] && span > 0) {
      const pace = Math.max(0, (b[S.dist] - a[S.dist]) / (span / 1000));
      dist += Math.min(pace, b[S.speed] + 2) * Math.min(0.25, (t - b[S.ts]) / 1000);
    }
    r.lat = L(S.lat);
    r.speed = L(S.speed);
    // Karts mostly just go forward, so predict along the road to show them
    // closer to where they really are now (sideways stays interpolated —
    // that's where the surprises are). Eased, so a sudden stop doesn't snap.
    const pace = span > 0 ? Math.min(r.speed, Math.max(0, (b[S.dist] - a[S.dist]) / (span / 1000)) + 1) : r.speed;
    const stopped = (near[S.flags] & (F.spin | F.frozen)) !== 0;
    const look = stopped ? 0 : THREE.MathUtils.clamp(n.delay - 60, 0, 160) / 1000;
    n.ahead += (pace * look - n.ahead) * Math.min(1, dt * 8);
    // Never roll a kart backwards to fix an over-prediction: hold it for a
    // moment and let the real position catch up (a big jump still snaps).
    let shown = dist + n.ahead;
    if (shown < n.shown && n.shown - shown < 4) shown = n.shown;
    n.shown = shown;
    r.dist = shown;
    r.latV = span > 0 ? (b[S.lat] - a[S.lat]) / (span / 1000) : 0;
    r.y = L(S.y);
    const fl = near[S.flags];
    r.air = (fl & F.air) !== 0;
    r.spin = fl & F.spin ? 0.3 : 0;
    r.frozen = fl & F.frozen ? 0.3 : 0;
    r.finished = r.finished || (fl & F.finished) !== 0;
    r.boostT = near[S.boost] > 0 ? 0.2 : 0;
    r.steer = L(S.steer);
    r.hop = L(S.hop);
    r.flip = L(S.flip);
    r.spinAng = near[S.roll];
    r.squash = L(S.squash);
    n.yaw = L(S.yaw);
    n.boost = L(S.boost);
    n.glide = L(S.glide);
    n.pitch = L(S.pitch);
    n.tier = near[S.tier];
    n.flags = fl;
    // Where it really is now, for fair standings.
    n.lead = Math.max(0, r.speed * n.delay / 1000 - n.ahead);
  }

  /** Name over the kart, the shield bubble and ghost flicker for other players. */
  private dressNetKart(r: Racer) {
    const n = r.net!;
    if (n.label) {
      const w = r.model.root.position;
      n.label.position.set(w.x, w.y + 2.55 + r.hop, w.z);
      const d = w.distanceTo(this.camera.position);
      const k = THREE.MathUtils.clamp(d / 14, 0.55, 2.4);
      n.label.scale.set(2.6 * k, 0.62 * k, 1);
      (n.label.material as THREE.SpriteMaterial).opacity = THREE.MathUtils.clamp(1.3 - d / 140, 0, 1);
    }
    if (this.sims(r)) return;
    const shield = (n.flags & F.shield) !== 0;
    if (shield && !n.shield) {
      n.shield = M.shieldBubble();
      r.model.body.add(n.shield);
    }
    if (n.shield) {
      n.shield.visible = shield;
      if (shield) (n.shield.material as THREE.ShaderMaterial).uniforms.uTime.value = this.time;
    }
    r.model.body.visible = !(n.flags & F.ghost) || Math.sin(this.time * 38 + r.i) > 0.35;
  }

  private nameLabel(name: string): THREE.Sprite {
    const c = document.createElement("canvas");
    c.width = 512; c.height = 122;
    const g = c.getContext("2d")!;
    g.font = "800 58px Inter, system-ui, sans-serif";
    const text = name.length > 16 ? name.slice(0, 15) + "…" : name;
    const w = Math.min(500, g.measureText(text).width + 64);
    const x = (512 - w) / 2;
    g.fillStyle = "rgba(10,12,32,.78)";
    g.beginPath(); g.roundRect(x, 14, w, 86, 43); g.fill();
    g.strokeStyle = "rgba(143,160,255,.55)";
    g.lineWidth = 4;
    g.stroke();
    g.fillStyle = "#fff";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text, 256, 60);
    // A little pointer down at the kart.
    g.fillStyle = "rgba(10,12,32,.78)";
    g.beginPath(); g.moveTo(240, 99); g.lineTo(272, 99); g.lineTo(256, 118); g.fill();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }));
    sp.renderOrder = 8;
    this.scene.add(sp);
    return sp;
  }

  /** A player dropped out: their kart becomes a bot the host drives. */
  private netLeft(id: string) {
    const r = this.byId.get(id);
    if (!r || r.player || !r.human) return;
    r.human = false;
    r.skill = 0.95;
    r.greed = 0.6;
    r.aggro = 0.3;
    r.itemT = 10;
    if (r.net?.label) (r.net.label.material as THREE.SpriteMaterial).color.set("#9aa3c7");
  }

  /** The person a bot races against: whoever is nearest on the road. */
  private focusHuman(r: Racer): Racer {
    let best = this.racers[0], gap = Infinity;
    for (const o of this.racers) {
      if (!o.human || o.finished) continue;
      const d = Math.abs(o.dist - r.dist);
      if (d < gap) { gap = d; best = o; }
    }
    return best;
  }

  private emit(ev: GameEvent) {
    this.room?.event(ev);
  }

  private uid() {
    return `${this.room?.you ?? "me"}:${++this.nextId}`;
  }

  private onEvent(from: string, ev: GameEvent) {
    const tr = this.track;
    switch (ev.e) {
      case "coin": {
        const c = this.coins[ev.i];
        if (c?.alive) { c.alive = false; c.pop = 0.35; c.respawn = 12; }
        break;
      }
      case "box": {
        const b = this.boxes[ev.i];
        if (b?.alive) { b.alive = false; b.respawn = 3; b.obj.visible = false; this.burst(b.obj.position, "#9fd4ff", 10, 5); }
        break;
      }
      case "seek": {
        const obj = M.seeker();
        this.scene.add(obj);
        this.seekers.push({ u: ev.u, lat: ev.lat, speed: ev.speed, life: 6, obj, target: this.byId.get(ev.target) ?? null, sid: ev.sid, mine: false });
        break;
      }
      case "seekEnd": {
        const o = this.seekers.find((x) => x.sid === ev.sid);
        if (o) o.life = 0;
        // Our seeker landed on someone in another game: our points.
        if (ev.hit && ev.sid.startsWith(this.room!.you + ":")) this.seekerScored(o?.target ?? null);
        break;
      }
      case "zap": {
        const zapper = this.byId.get(from);
        if (zapper) this.applyZap(zapper, ev.dist);
        break;
      }
      case "goo": {
        const obj = M.goo();
        this.scene.add(obj);
        obj.scale.setScalar(0.01);
        this.hazards.push({ kind: "goo", u: tr.wrap(ev.u), lat: ev.lat, r: 1.3, obj, life: 14, phase: 0, knocked: 0, kv: V(), base: ev.lat, span: 0, ring: null, hid: ev.hid });
        break;
      }
      case "gooEnd": {
        const h = this.hazards.find((x) => x.hid === ev.hid);
        if (h) h.life = 0;
        break;
      }
      case "orb": {
        const target = this.byId.get(ev.target);
        if (!target) break;
        const obj = M.orb();
        this.scene.add(obj);
        this.orbs.push({ u: ev.u, lat: ev.lat, speed: ev.speed, life: 6, obj, target, oid: ev.oid });
        break;
      }
      case "orbEnd": {
        const o = this.orbs.find((x) => x.oid === ev.oid);
        if (o) { o.life = 0; this.burst(o.obj.position, "#ff4a5e", 20, 7); }
        break;
      }
      case "strike": {
        const r = this.byId.get(ev.who);
        if (!r || !this.sims(r)) break;
        if (r.player) this.hitPlayer(r, "RAMMED!");
        else if (r.spin <= 0) { r.spin = 1.2; r.speed *= 0.5; }
        break;
      }
    }
  }

  /* ---------------- Replay ---------------- */

  private recordTape(dt: number) {
    if (!this.tape || !(this.phase === "race" || this.phase === "finish")) return;
    this.tape.record(dt, (k, out, o) => {
      const r = this.racers[k];
      const m = r.model;
      const p = this.poses[k];
      m.root.position.toArray(out, o);
      m.root.quaternion.toArray(out, o + 3);
      m.shadowRoot.position.toArray(out, o + 7);
      m.shadowRoot.quaternion.toArray(out, o + 10);
      if (p) {
        out[o + 14] = p.speed; out[o + 15] = p.steer; out[o + 16] = p.slide; out[o + 17] = p.hop; out[o + 18] = p.squash;
        out[o + 19] = p.roll; out[o + 20] = p.flip; out[o + 21] = p.boost; out[o + 22] = p.glide; out[o + 23] = p.pitch ?? 0;
      }
      out[o + 24] = (m.shadow.material as THREE.MeshBasicMaterial).opacity;
      out[o + 25] = r.dist;
    });
  }

  /** The finish again from trackside cameras, looping behind the results. */
  private startReplay() {
    const tape = this.tape;
    if (!tape || tape.length < 5) return;
    // The newest frame is phaseT after the line; play from 6 s before it.
    const cross = this.phaseT;
    const from = Math.min(tape.length - 0.1, cross + 6);
    const to = Math.max(0, cross - 1.4);
    this.replay = { t: 0, from, to, shot: -1, shotT: 99, pos: V(), side: 1 };
    this.hud.replay(true);
  }

  private playReplay(dt: number) {
    const rp = this.replay!;
    const tape = this.tape!;
    const len = rp.from - rp.to;
    rp.t += dt;
    if (rp.t > len) { rp.t = 0; rp.shotT = 99; }
    const back = rp.from - rp.t;
    const qa = this.q1, qb = new THREE.Quaternion();
    for (let k = 0; k < this.racers.length; k++) {
      const [d, a, b, f] = tape.at(k, back);
      const lerp = (i: number) => d[a + i] + (d[b + i] - d[a + i]) * f;
      const m = this.racers[k].model;
      m.root.position.set(lerp(0), lerp(1), lerp(2));
      m.root.quaternion.copy(qa.fromArray(d, a + 3).slerp(qb.fromArray(d, b + 3), f));
      m.shadowRoot.position.set(lerp(7), lerp(8), lerp(9));
      m.shadowRoot.quaternion.copy(qa.fromArray(d, a + 10).slerp(qb.fromArray(d, b + 10), f));
      (m.shadow.material as THREE.MeshBasicMaterial).opacity = lerp(24);
      m.setDetail(k === 0 || m.root.position.distanceToSquared(this.camera.position) < 48 * 48);
      m.update({
        speed: lerp(14), steer: lerp(15), slide: lerp(16), hop: lerp(17), squash: lerp(18), roll: lerp(19),
        flip: lerp(20), boost: lerp(21), glide: lerp(22), pitch: lerp(23), wave: 0, time: this.time + k,
      }, dt);
    }
  }

  /** Where the player's kart is in the replay, and how far round the lap. */
  private replayDist() {
    const [d, a, b, f] = this.tape!.at(0, this.replay!.from - this.replay!.t);
    return d[a + 25] + (d[b + 25] - d[a + 25]) * f;
  }

  private replayCamera(dt: number) {
    const rp = this.replay!;
    const cam = this.camera;
    const tr = this.track;
    const kart = this.racers[0].model.root.position;
    const u = tr.wrap(tr.startU + this.replayDist());
    rp.shotT += dt;
    if (rp.shotT > 2.6) {
      rp.shotT = 0;
      rp.shot++;
      rp.side = Math.random() < 0.5 ? -1 : 1;
      // Kerb camera, planted up the road for the kart to rush past.
      rp.pos.copy(tr.point(u + 24, rp.side * (EDGE - 2.2), 0)).y += 1.1;
    }
    tr.frame(u, this.f2);
    const f = this.f2;
    let fov = 50;
    const kind = rp.shot % 4;
    if (kind === 0) {
      // Long lens from the trackside, panning as the kart flies by.
      cam.position.copy(rp.pos);
      // Zoom to hold the kart at a steady size, like a camera operator.
      const d = cam.position.distanceTo(kart);
      fov = THREE.MathUtils.clamp(2 * THREE.MathUtils.radToDeg(Math.atan(3.2 / d)), 9, 45);
      cam.up.set(0, 1, 0);
      cam.lookAt(this.v1.copy(kart).setY(kart.y + 0.8));
    } else if (kind === 1) {
      // Low tracking shot just ahead of the front wheel.
      const want = this.v1.copy(kart).addScaledVector(f.tan, 3.4).addScaledVector(f.side, rp.side * 2.3);
      want.y = kart.y + 0.45;
      if (rp.shotT < dt * 1.5) this.camPos.copy(want);
      this.camPos.lerp(want, 1 - Math.exp(-dt * 10));
      cam.position.copy(this.camPos);
      cam.up.set(0, 1, 0);
      cam.lookAt(this.v2.copy(kart).setY(kart.y + 0.9).addScaledVector(f.tan, -1));
      fov = 58;
    } else if (kind === 2) {
      // Helicopter, high and behind, the field strung out ahead.
      const want = this.v1.copy(kart).addScaledVector(f.tan, -16).addScaledVector(f.side, rp.side * 6);
      want.y = kart.y + 11;
      if (rp.shotT < dt * 1.5) this.camPos.copy(want);
      this.camPos.lerp(want, 1 - Math.exp(-dt * 4));
      cam.position.copy(this.camPos);
      cam.up.set(0, 1, 0);
      cam.lookAt(this.v2.copy(kart).addScaledVector(f.tan, 8));
      fov = 48;
    } else {
      // Slow orbit round the driver, rolling with them.
      const a = rp.shotT * 0.7 + rp.side;
      const dir = this.v3.copy(f.tan).multiplyScalar(Math.cos(a)).addScaledVector(f.side, Math.sin(a));
      cam.position.copy(kart).addScaledVector(dir, 4.6).setY(kart.y + 1.5);
      cam.up.set(0, 1, 0);
      cam.lookAt(this.v2.copy(kart).setY(kart.y + 0.9));
      fov = 52;
    }
    // The results card covers the right of wide screens: shift the lens so
    // the action sits in the open space on the left.
    const w = this.renderer.domElement.width, h = this.renderer.domElement.height;
    if (cam.aspect > 1) cam.setViewOffset(w, h, w * 0.2, 0, w, h);
    return fov;
  }

  /* ---------------- Live TV ---------------- */

  /** Point the circuit's jumbotrons at a live broadcast camera. */
  private buildTv() {
    const screens = this.world.liveScreens;
    if (!screens?.length || this.attract || this.quality === "low") return;
    const rt = new THREE.WebGLRenderTarget(512, 288, { type: THREE.HalfFloatType, samples: 2 });
    const cam = new THREE.PerspectiveCamera(30, 16 / 9, 0.5, 650);
    for (const s of screens) {
      const m = s.material as THREE.MeshBasicMaterial;
      m.map = rt.texture;
      m.color.setScalar(0.8);
      m.needsUpdate = true;
    }
    this.tv = { rt, cam, screens, n: 0, shot: 0, t: 99, pos: V() };
  }

  private renderTv(dt: number) {
    const tv = this.tv;
    if (!tv || this.lowered) return;
    tv.t += dt;
    if (++tv.n % 3) return;
    const tr = this.track;
    const p = this.racers[0];
    const kart = p.model.root.position;
    const u = tr.wrap(tr.startU + p.dist);
    if (tv.t > 5) { tv.t = 0; tv.shot++; }
    const cam = tv.cam;
    tr.frame(u, this.f2);
    const f = this.f2;
    const shot = tv.shot % 3;
    if (shot === 0) {
      // Leader cam: a camera bike just ahead, looking back at the driver.
      cam.position.copy(kart).addScaledVector(f.tan, 8).addScaledVector(f.side, 1.8).setY(kart.y + 2.4);
      cam.lookAt(this.v1.copy(kart).setY(kart.y + 0.9));
      cam.fov = 38;
    } else if (shot === 1) {
      // Chase helicopter.
      cam.position.copy(kart).addScaledVector(f.tan, -14).setY(kart.y + 9);
      cam.lookAt(this.v1.copy(kart).addScaledVector(f.tan, 10));
      cam.fov = 44;
    } else {
      // The blimp's view: high above, long lens on the pack.
      cam.position.copy(kart).addScaledVector(f.tan, -22).addScaledVector(f.side, 12).setY(kart.y + 42);
      cam.lookAt(this.v1.copy(kart).addScaledVector(f.tan, 6));
      cam.fov = 26;
    }
    cam.updateProjectionMatrix();
    const r = this.renderer;
    // Never sample the feed while drawing it, and reuse this frame's shadows.
    for (const s of tv.screens) s.visible = false;
    const auto = r.shadowMap.autoUpdate;
    r.shadowMap.autoUpdate = false;
    r.setRenderTarget(tv.rt);
    r.render(this.scene, cam);
    r.setRenderTarget(null);
    r.shadowMap.autoUpdate = auto;
    for (const s of tv.screens) s.visible = true;
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
      if (r.air || r.spin > 0) { this.skids?.lift(r.i * 2); this.skids?.lift(r.i * 2 + 1); continue; }
      this.track.frame(this.track.wrap(this.track.startU + r.dist), this.f2);
      const nk = r.net && !this.sims(r) ? r.net : null;
      const drifting = r.player ? this.driftDir !== 0 : nk ? (nk.flags & F.drift) !== 0 : Math.abs(r.slide) > 0.2;
      this.tyreFx(r, drifting);
      const tier = r.player ? this.driftTier : nk ? nk.tier : 0;
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

  /** Rubber on the road, smoke off the tyres, spray on the wet street. */
  private tyreFx(r: Racer, drifting: boolean) {
    const root = r.model.root;
    const wet = this.trackId === "town";
    const near = r.player || root.position.distanceToSquared(this.camera.position) < 55 * 55;
    const side = this.v3.set(1, 0, 0).applyQuaternion(root.quaternion);
    const sliding = drifting && r.speed > (r.player ? 8 : 12);
    for (const w of [0, 1]) {
      const key = r.i * 2 + w;
      const sx = w ? -0.95 : 0.95;
      if (!sliding || !this.skids) { this.skids?.lift(key); continue; }
      const p = root.localToWorld(this.v1.set(sx, 0.035, -0.95));
      this.skids.mark(key, p, side, 0.36, r.player ? 1 : 0.55);
    }
    if (!near) return;
    const back = this.v2.copy(this.f2.tan).multiplyScalar(-1);
    if (sliding && !wet && Math.random() < (r.player ? 0.9 : 0.35)) {
      for (const sx of [0.95, -0.95]) {
        const w = root.localToWorld(this.v1.set(sx, 0.35, -1.05));
        const g = 0.82 + Math.random() * 0.12;
        this.puffs.spawn(w.x, w.y, w.z,
          back.x * 2 + (Math.random() - 0.5) * 1.6, 0.7 + Math.random() * 0.8, back.z * 2 + (Math.random() - 0.5) * 1.6,
          this.col.setRGB(g, g, g * 1.03), 0.75 + this.driftTier * 0.12, 1.1 + Math.random() * 0.5,
          { grow: 4, drag: 1.4, grav: -0.4, alpha: 0.26 });
      }
    }
    if (wet && r.speed > 9) {
      // Rooster tails of spray off the rear tyres, and a fine mist.
      const k = Math.min(1, r.speed / 30);
      const n = (r.player ? 2 : 1) + (sliding ? 1 : 0);
      for (let j = 0; j < n; j++) {
        for (const sx of [0.95, -0.95]) {
          if (!r.player && Math.random() < 0.5) continue;
          const w = root.localToWorld(this.v1.set(sx, 0.15, -1.15));
          const sp = r.speed * (0.25 + Math.random() * 0.2);
          this.sparks.spawn(w.x, w.y, w.z,
            back.x * sp + side.x * sx * 1.2 + (Math.random() - 0.5), 2 + Math.random() * 2.5 * k, back.z * sp + side.z * sx * 1.2 + (Math.random() - 0.5),
            this.col.set("#9fc4ff"), 0.14 + Math.random() * 0.08, 0.35 + Math.random() * 0.25, { grav: 16, drag: 1.2, alpha: 0.5 });
        }
      }
      if (Math.random() < (r.player ? 0.8 : 0.3) * k) {
        const w = root.localToWorld(this.v1.set((Math.random() - 0.5) * 1.8, 0.3, -1.4));
        this.puffs.spawn(w.x, w.y, w.z, back.x * r.speed * 0.15, 0.5, back.z * r.speed * 0.15,
          this.col.set("#7d8fb0"), 0.9, 0.7, { grow: 2.6, drag: 2, alpha: 0.18 + (sliding ? 0.12 : 0) });
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
    } else if (this.replay) {
      wantFov = this.replayCamera(dt);
      this.fov = wantFov;
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
      // A punch of FOV the moment a boost fires, easing into the boost FOV.
      const boosting = p.boostT > 0;
      if (boosting && !this.wasBoost) { this.boostKick = 1; this.shake = Math.max(this.shake, 0.18); }
      this.wasBoost = boosting;
      this.boostKick = Math.max(0, this.boostKick - dt * 2.4);
      wantFov = 64 + (boosting ? 10 : 0) + this.boostKick * 7 + Math.max(0, p.speed - 18) * 0.35 + Math.max(0, 1 - cam.aspect) * 22;
      // Road rumble: a smooth, fast tremble that grows with speed and on the grass.
      if (!p.air && this.phase === "race") {
        const off = Math.abs(p.lat) > EDGE + 0.4 ? 3 : 1;
        const amp = (Math.max(0, p.speed - 14) * 0.0016 + (boosting ? 0.012 : 0)) * off;
        const t = this.time;
        cam.position.x += (Math.sin(t * 41.3) + Math.sin(t * 23.7 + 1.3)) * amp;
        cam.position.y += (Math.sin(t * 37.9 + 0.7) + Math.sin(t * 19.1 + 2.1)) * amp * 0.8;
        cam.position.z += Math.sin(t * 29.3 + 2.6) * amp;
      }
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

  /**
   * Real reflections: photograph the finished track (neon, towers, stands,
   * sky) into a cube map once at load and light every material with it, so
   * paint, glass and wet tarmac mirror what's actually around them.
   */
  private captureReflections() {
    // Neon Town's reflections are hand-tuned (pink and cyan light panels that
    // make the wet streets glow), which reads better than a photo of dark towers.
    if (this.trackId === "town") return;
    const size = this.quality === "low" ? 128 : 256;
    const cubeRT = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType });
    const cubeCam = new THREE.CubeCamera(0.5, 3000, cubeRT);
    // Hide the karts and particles so the capture is just the world.
    const hidden: THREE.Object3D[] = [];
    for (const r of this.racers) for (const o of [r.model.root, r.model.shadowRoot]) if (o.visible) { o.visible = false; hidden.push(o); }
    for (const o of [this.sparks.points, this.puffs.points, this.confetti.mesh]) if (o.visible) { o.visible = false; hidden.push(o); }
    const at = this.track.point(this.track.startU + 60, 0, 9);
    cubeCam.position.copy(at);
    this.scene.add(cubeCam);
    cubeCam.update(this.renderer, this.scene);
    this.scene.remove(cubeCam);
    for (const o of hidden) o.visible = true;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const env = pmrem.fromCubemap(cubeRT.texture);
    pmrem.dispose();
    cubeRT.dispose();
    this.scene.environment?.dispose();
    this.scene.environment = env.texture;
    this.scene.environmentIntensity = 0.8;
  }

  /** Keep the shadow camera centred on the player, and size particles for the view. */
  private followSun() {
    // Speed blur while boosting (not in the menus' backdrop).
    if (this.grade && !this.attract && this.racers[0]) {
      const p = this.racers[0];
      const want = p.boostT > 0 && this.phase === "race" ? Math.min(1, 0.55 + p.speed / 90) : 0;
      this.speedBlur += (want - this.speedBlur) * (want > this.speedBlur ? 0.18 : 0.06);
      (this.grade.uniforms as Record<string, THREE.IUniform>).uBlur.value = this.speedBlur < 0.02 ? 0 : this.speedBlur;
    }
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
    hud.vignette(this.ghostT > 0 ? "rgba(181,140,255,.55)" : this.shieldT > 0 ? "rgba(94,200,255,.55)" : this.magnetT > 0 ? "rgba(255,61,90,.4)" : null);
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

  /**
   * Keep the frame rate up: every couple of seconds, if frames average over
   * ~23 ms, step down — AO first, then the pixel ratio in stages, and only
   * as a last resort a cheaper bloom. Once lowered it stays lowered.
   */
  private perfStep = 0;
  private grade: ReturnType<typeof gradePass> | null = null;
  private speedBlur = 0;
  private watchPerf(raw: number) {
    if (this.lowered || this.phase === "load" || this.paused) return;
    this.frameMs.push(raw * 1000);
    if (this.frameMs.length < 120) return;
    const sorted = [...this.frameMs].sort((a, b) => a - b);
    // The median ignores one-off hitches (a tab switch, a GC pause).
    const avg = sorted[sorted.length >> 1];
    this.frameMs.length = 0;
    if (avg <= 23) return;
    if (this.ao?.enabled) { this.ao.enabled = false; return; }
    const steps = [1.25, 1, 0.85, 0.75];
    const cur = this.renderer.getPixelRatio();
    const next = steps.find((r) => r < cur - 0.01);
    if (next !== undefined && this.perfStep < steps.length) {
      this.perfStep++;
      this.renderer.setPixelRatio(next);
      this.resize();
      return;
    }
    // Bloom at quarter resolution keeps the neon glow for a fraction of the cost.
    this.lowered = true;
    const r = this.mountEl.getBoundingClientRect();
    this.bloom.resolution.set(r.width / 4, r.height / 4);
  }

  stats() {
    return this.result;
  }

  destroy() {
    this.alive = false;
    this.mountEl?.classList.remove("attract");
    cancelAnimationFrame(this.raf);
    clearTimeout(this.raf);
    removeEventListener("resize", this.resize);
    removeEventListener("keydown", this.onKey);
    for (const off of this.netOff) off();
    this.netOff = [];
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
    this.skids?.dispose();
    this.tv?.rt.dispose();
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
