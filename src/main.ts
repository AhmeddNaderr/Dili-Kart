import "./style.css";
import "./ui/console.css";
import { DiliCart, type RaceResult } from "./kart/race";
import { buildIntro, greetedThisSession } from "./ui/intro";
import { filmSeen, playFilm, prepareFilm } from "./ui/film";
import { dropLoader, finishLoader, progress } from "./ui/loader";
import { mountStage, type MenuStage } from "./ui/stage3d";
import { ICON, portrait, skinPortrait } from "./ui/icons";
import { lookFor } from "./kart/models";
import { MASCOT } from "./kart/mascot";
import { sfx, setMuted, isMuted } from "./engine/audio";
import * as api from "./app/api";
import {
  CHAR_IDS, CHAR_INFO, CHAR_UNLOCK, PASSWORD_MIN, SKIN_IDS, SKIN_INFO, TIERS, TRACK_IDS, TRACK_INFO, isTrackId, nextTier, normaliseHandle,
  type BoardEntry, type CharId, type RaceReply, type SkinId, type TrackId,
} from "../shared/rules";

/**
 * App shell: sign in → Dili's intro → hub → race → results → leaderboard.
 * One screen at a time; each one can register a cleanup for WebGL views and
 * key handlers, which runs when the next screen replaces it.
 */

const app = document.getElementById("app")!;
let racer: DiliCart | null = null;
let stage3d: MenuStage | null = null;
let cleanup: (() => void) | null = null;

// Dlicom backdrop: light stripes up top, a gold glow, mounted once.
{
  const bg = document.createElement("div");
  bg.className = "bg";
  bg.innerHTML = `<div class="stripes"></div><div class="glow g1"></div><div class="glow g2"></div>`;
  document.body.insertBefore(bg, app);
}

// Live stadium behind the landing page and Dili's intro: the real race,
// every kart on autopilot, shot like a broadcast. Kept alive across those
// two screens so logging in doesn't rebuild the world.
const liveEl = document.createElement("div");
liveEl.className = "live-bg";
liveEl.innerHTML = `<div class="live-shade"></div>`;
document.body.insertBefore(liveEl, app);
let live: DiliCart | null = null;
const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;

let liveTrack: TrackId = "circuit";
let backdropTimer = 0;
function backdrop(on: boolean) {
  // The backdrop shows whichever track is picked; switching rebuilds it.
  if (on && live && liveTrack !== trackPick) {
    live.destroy();
    live = null;
    liveEl.classList.remove("on");
  }
  if (on && !live && !calm) {
    liveTrack = trackPick;
    live = new DiliCart();
    // Camera changes are clean cuts, like a broadcast; no dip to black.
    live.mount(liveEl, {
      onEnd() {}, onRestart() {}, onQuit() {},
      onReady: () => liveEl.classList.add("on"),
    }, "dili", { attract: true, track: liveTrack });
    if (import.meta.env.DEV) (window as unknown as { __live: DiliCart }).__live = live;
  } else if (!on && live) {
    live.destroy();
    live = null;
    liveEl.classList.remove("on");
  }
}

const MUTE_KEY = "dlicom.muted";
try { if (localStorage.getItem(MUTE_KEY) === "1") setMuted(true); } catch { /* storage blocked */ }

function h(html: string): HTMLElement {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
}

function show(view: HTMLElement, withBackdrop = false) {
  racer?.destroy();
  racer = null;
  stage3d?.dispose();
  stage3d = null;
  cleanup?.();
  cleanup = null;
  backdrop(withBackdrop);
  liveEl.dataset.screen = view.dataset.scene ?? view.classList[1] ?? "";
  app.replaceChildren(view);
}

const fmt = (n: number) => n.toLocaleString("en-US");
const ORD = (n: number) => `${n}${n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"}`;
const fmtTime = (t: number | null) => {
  if (t === null || !isFinite(t)) return "–";
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s < 10 ? "0" : ""}${s.toFixed(2)}`;
};
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const face = (c: CharId) => portrait(MASCOT[c].head, MASCOT[c].dome, MASCOT[c].mouth);
/** The player's portrait: a skin driver's if one is in the seat. */
const faceOf = (p: api.Player) => (p.skin === "quang" || p.skin === "cipher" ? skinPortrait(p.skin) : face(p.char));
/** The track picked in the hub, remembered between visits. */
const TRACK_KEY = "dilicart.track";
let trackPick: TrackId = (() => { try { const t = localStorage.getItem(TRACK_KEY); return isTrackId(t) ? t : "circuit"; } catch { return "circuit"; } })();
function setTrack(t: TrackId) {
  trackPick = t;
  try { localStorage.setItem(TRACK_KEY, t); } catch { /* storage blocked */ }
}
const trackLabel = (t: TrackId) => `${TRACK_INFO[t].name} · ${TRACK_INFO[t].laps} laps`;

const canFullscreen = () => document.fullscreenEnabled === true;

/** The app mark: the Dlicom swoosh on a glossy squircle, like a home-screen icon. */
function appIcon(size = "") {
  return `<span class="app-icon ${size}" aria-hidden="true"><img src="logo.jpg" alt="" draggable="false" /><i class="ai-shine"></i></span>`;
}

function brand(name = "Dili Cart", by = "by Dlicom") {
  return `<div class="brand">${appIcon()}<span class="brand-text"><b>${name}</b>${by ? `<span>${by}</span>` : ""}</span></div>`;
}

function soundButton() {
  return `<button class="iconbtn" data-act="mute" title="Sound" aria-label="Toggle sound">${isMuted() ? ICON.muted : ICON.sound}</button>`;
}

function wireCommon(view: HTMLElement) {
  view.querySelectorAll<HTMLElement>("[data-act=mute]").forEach((b) => b.addEventListener("click", () => {
    const m = !isMuted();
    setMuted(m);
    try { localStorage.setItem(MUTE_KEY, m ? "1" : "0"); } catch { /* storage blocked */ }
    if (!m) sfx.ui();
    b.innerHTML = m ? ICON.muted : ICON.sound;
  }));
  view.querySelectorAll<HTMLElement>("[data-act=full]").forEach((b) => b.addEventListener("click", () => {
    sfx.ui();
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => {});
  }));
}

/* ================================================================== */
/* Intro                                                               */
/* ================================================================== */

/** Dili greets whoever just logged in (or came back), then hands over. */
function intro(then: () => void, isNew?: boolean) {
  const p = api.player();
  const view = buildIntro(then, { handle: p && !p.guest ? p.handle : null, isNew });
  show(view, true);
  const host = view.querySelector<HTMLElement>("#intro3d");
  if (host) {
    stage3d = mountStage(host, { kind: "solo", char: "dili" }, () => sfx.pop());
    view.addEventListener("intro:pose", (e) => stage3d?.setPose((e as CustomEvent).detail));
    view.addEventListener("intro:prop", (e) => stage3d?.setProp((e as CustomEvent).detail));
    view.addEventListener("intro:speak", (e) => stage3d?.setSpeaking((e as CustomEvent).detail));
    stage3d.setPose("wave");
  }
}

/* ================================================================== */
/* Sign in: the title screen                                           */
/* ================================================================== */

/** The DILI CART wordmark: each letter springs in and catches the light. */
function wordmark() {
  const letters = (word: string, from: number) =>
    [...word].map((c, i) => `<span class="wm-l" style="--i:${from + i}" data-l="${c}">${c}</span>`).join("");
  return `<h1 class="wm" aria-label="Dili Cart"><span class="wm-row" aria-hidden="true">${letters("DILI", 0)}</span><span class="wm-row wm-gold" aria-hidden="true">${letters("CART", 4)}</span></h1>`;
}

/** The LED ticker set into the console's hood. */
function ticker(items: [string, string][]) {
  const row = items.map(([t, c]) => `<span class="${c}">${t}</span><i>◆</i>`).join("");
  return `<div class="ticker" aria-hidden="true"><div class="ticker-track">${row}${row}</div></div>`;
}

const LEDS = `<span class="leds"><i class="con-dot" style="--c:#ff3d5a"></i><i class="con-dot" style="--c:#ffb31c"></i><i class="con-dot" style="--c:#27ff7a"></i></span>`;

function auth(mode: "signup" | "login" = "signup") {
  const view = h(`<div class="screen stage-screen title-screen" data-scene="title">
    <header class="bar">${brand()}<div class="bar-right">
      <button class="key cream replay" id="replay" title="Watch the intro film">▶ Intro</button>
      ${soundButton()}
    </div></header>
    <section class="title-top">
      ${wordmark()}
      <p class="title-sub">Dlicom Grand Prix</p>
    </section>
    <form class="console" id="form" novalidate>
      <div class="con-hood">${LEDS}${ticker([
        ["New: Neon Town at night", "p"], ["8 racers · 2 tracks", ""], ["Skins for Dili coins", "y"], ["Beat the Custodians", "y"], ["Drift for turbo", ""], ["$DLI TGE 2027", "y"],
        ["Your ad on a stadium board · $5 · DM @00xmado", "p"], ["Hold your keys", "g"],
      ])}</div>
      <div class="con-body">
        <div class="gauge rev con-left" style="--v:0.12" aria-hidden="true">
          <i class="gauge-needle"></i><i class="gauge-cap"></i>
          <span class="gauge-read"><b id="st-players">0</b><small>DRIVERS</small></span>
        </div>
        <div class="screen-bezel"><div class="crt crt-in">
          <i class="crt-boot"></i>
          <div class="px-tabs glow" role="tablist" style="--i:0">
            <button type="button" data-mode="signup">New driver</button>
            <button type="button" data-mode="login">Log in</button>
          </div>
          <div class="px-field" style="--i:1"><label for="handle">Handle</label><span class="at">@</span>
            <input id="handle" name="username" autocomplete="username" placeholder="your X handle" maxlength="16" spellcheck="false" autocapitalize="off" />
          </div>
          <div class="px-field" style="--i:2"><label for="pw">Password</label>
            <input id="pw" name="password" type="password" placeholder="${PASSWORD_MIN}+ characters" maxlength="64" />
            <button type="button" class="eye" id="eye">Show</button>
          </div>
          <p class="px-msg glow" id="msg" role="status" style="--i:3"></p>
        </div></div>
        <div class="go-wrap">
          <button class="go-btn" id="submit" type="submit" aria-label="Start"><span class="go-dome"><span>START</span></span></button>
          <span class="go-label" id="go-label">Create account</span>
        </div>
      </div>
      <div class="con-foot">
        <button type="button" class="key yellow" id="guest">Play as guest</button>
        <p class="con-fine">No email, no wallet, no personal data — a handle and a password.<br>Race points are for fun and have no monetary value.</p>
      </div>
    </form>
  </div>`);

  const form = view.querySelector<HTMLFormElement>("#form")!;
  const handleEl = view.querySelector<HTMLInputElement>("#handle")!;
  const pwEl = view.querySelector<HTMLInputElement>("#pw")!;
  const msg = view.querySelector<HTMLElement>("#msg")!;
  const submit = view.querySelector<HTMLButtonElement>("#submit")!;
  const goLabel = view.querySelector<HTMLElement>("#go-label")!;
  const idle = () => (mode === "signup" ? "> Pick a handle and a password" : "> Welcome back, driver");
  const say = (text: string, cls = "") => { msg.textContent = text; msg.className = `px-msg glow ${cls}`; };

  const setMode = (m: typeof mode) => {
    mode = m;
    view.querySelectorAll<HTMLElement>("[data-mode]").forEach((b) => b.classList.toggle("on", b.dataset.mode === m));
    goLabel.textContent = m === "signup" ? "Create account" : "Log in";
    pwEl.autocomplete = m === "signup" ? "new-password" : "current-password";
    say(idle());
  };
  view.querySelectorAll<HTMLElement>("[data-mode]").forEach((b) => b.addEventListener("click", () => { sfx.ui(); setMode(b.dataset.mode as typeof mode); }));
  setMode(mode);

  view.querySelector("#eye")!.addEventListener("click", (e) => {
    const b = e.currentTarget as HTMLButtonElement;
    const hidden = pwEl.type === "password";
    pwEl.type = hidden ? "text" : "password";
    b.textContent = hidden ? "Hide" : "Show";
  });

  const fail = (text: string) => {
    sfx.miss();
    say(`! ${text}`, "err");
    form.classList.remove("shake");
    void form.offsetWidth;
    form.classList.add("shake");
  };

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const handle = normaliseHandle(handleEl.value);
    if (!handle) return fail("Handles are 3–15 letters, numbers or underscores.");
    if (pwEl.value.length < PASSWORD_MIN) return fail(`Passwords need at least ${PASSWORD_MIN} characters.`);
    submit.disabled = true;
    say(mode === "signup" ? "> Registering driver…" : "> Checking the garage…");
    msg.insertAdjacentHTML("beforeend", `<span class="px-blink">_</span>`);
    try {
      if (mode === "signup") await api.signup(handle, pwEl.value);
      else await api.login(handle, pwEl.value);
      sfx.start();
      say("> Engine on!");
      intro(hub, mode === "signup");
    } catch (err) {
      fail(err instanceof Error ? err.message : "Something went wrong.");
      submit.disabled = false;
    }
  });

  view.querySelector("#guest")!.addEventListener("click", () => {
    sfx.ui();
    api.playAsGuest();
    intro(hub);
  });
  view.querySelector("#replay")!.addEventListener("click", () => { sfx.ui(); playFilm(() => {}); });

  wireCommon(view);
  show(view, true);
  handleEl.focus({ preventScroll: true });
  cleanup = parallax(view);

  // The gauge reads out how many drivers have signed up.
  void api.stats().then((st) => {
    if (!st || !view.isConnected) return;
    const b = view.querySelector<HTMLElement>("#st-players")!;
    countUp(b, st.players, 1600);
    view.querySelector<HTMLElement>(".gauge")!.style.setProperty("--v", String(Math.min(0.92, 0.18 + Math.log10(1 + st.players) / 4)));
  });

  void api.serverUp().then((up) => {
    if (up || !view.isConnected) return;
    say("! Online accounts are offline — you can still play as a guest.", "warn");
  });
}

/** Count a number up from zero with an ease-out. */
function countUp(el: HTMLElement, to: number, ms = 1400) {
  const t0 = performance.now();
  const tick = (now: number) => {
    const k = Math.min(1, (now - t0) / ms);
    el.textContent = fmt(Math.round(to * (1 - Math.pow(1 - k, 4))));
    if (k < 1 && el.isConnected) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** The stadium behind drifts gently against the pointer. */
function parallax(view: HTMLElement) {
  if (calm || !matchMedia("(pointer: fine)").matches) return () => {};
  let raf = 0, tx = 0, ty = 0, x = 0, y = 0;
  const loop = () => {
    x += (tx - x) * 0.06;
    y += (ty - y) * 0.06;
    liveEl.style.setProperty("--px", x.toFixed(4));
    liveEl.style.setProperty("--py", y.toFixed(4));
    raf = Math.abs(tx - x) + Math.abs(ty - y) > 0.001 ? requestAnimationFrame(loop) : 0;
  };
  const onMove = (e: PointerEvent) => {
    tx = (e.clientX / innerWidth) * 2 - 1;
    ty = (e.clientY / innerHeight) * 2 - 1;
    if (!raf) raf = requestAnimationFrame(loop);
  };
  view.addEventListener("pointermove", onMove);
  return () => {
    cancelAnimationFrame(raf);
    liveEl.style.removeProperty("--px");
    liveEl.style.removeProperty("--py");
  };
}

/* ================================================================== */
/* Hub: the garage                                                     */
/* ================================================================== */

function hub() {
  const p = api.player();
  if (!p) return auth();
  const next = nextTier(p.points);
  const floor = [...TIERS].reverse().find((t) => p.points >= t.at)?.at ?? 0;
  const tierPct = next ? Math.min(1, Math.max(0, (p.points - floor) / (next.at - floor))) : 1;
  const driverSkin = p.skin === "quang" || p.skin === "cipher" ? p.skin : null;

  const drivers = CHAR_IDS.map((id) => {
    const need = CHAR_UNLOCK[id];
    const open = p.points >= need;
    const pct = open ? 100 : Math.floor((p.points / need) * 100);
    return `<button type="button" class="driver ${p.char === id && !driverSkin ? "on" : ""} ${open ? "" : "locked"}" data-char="${id}" style="--tint:${CHAR_INFO[id].color}" ${open ? "" : "aria-disabled=\"true\""}>
      <span class="pic">${face(id)}${open ? "" : `<i class="lock">${ICON.lock}</i>`}</span>
      <span><b>${CHAR_INFO[id].name}</b><small>${open ? CHAR_INFO[id].rarity : `${fmt(need)} pts`}</small>${open ? "" : `<span class="bar"><i style="width:${pct}%"></i></span>`}</span>
      <i class="led"></i>
    </button>`;
  }).join("");

  const streak = p.streak >= 2 ? `${p.streak}-day streak · up to 2× points` : "Race daily for up to 2× points";
  const news: [string, string][] = [
    ["New track: Neon Town · 5 laps at night", "p"],
    ["Dili Circuit · 3 laps · 8 racers", ""],
    ["New: skins in the shop · pay in Dili coins", "y"],
    [streak, "g"],
    ["$DLI TGE 2027 · follow @DlicomApp", "y"],
    ["Your ad on a stadium board · $5 · DM @00xmado", "p"],
    ...(p.guest ? [["Guest mode · scores stay on this device", "y"] as [string, string]] : []),
  ];
  const tierName = p.tier;

  const view = h(`<div class="screen stage-screen garage" data-scene="hub">
    <header class="bar">${brand()}
      <div class="bar-right">
        ${soundButton()}
        ${canFullscreen() ? `<button class="iconbtn" data-act="full" title="Fullscreen" aria-label="Fullscreen">${ICON.full}</button>` : ""}
        <button type="button" class="wallet" id="wallet" title="Dili coins · open the shop">${ICON.coin}<b data-count="${p.coins}">${fmt(p.coins)}</b></button>
        <div class="plate">
          <span class="who-pic" style="--p:${tierPct.toFixed(3)}"><span>${faceOf(p)}</span></span>
          <span class="who-name"><b>${p.guest ? "Guest" : "@" + esc(p.handle)}</b><small>${tierName.toUpperCase()}${next ? ` · ${fmt(next.at - p.points)} TO ${next.name.toUpperCase()}` : " · TOP TIER"}</small></span>
          <button class="key" id="out">${p.guest ? "Sign up" : "Log out"}</button>
        </div>
      </div>
    </header>
    <section class="garage-top">
      <div class="stage3d" id="stage3d" title="Drag to spin · click to wave"></div>
      ${wordmark()}
      <div class="now-driving"><span>${driverSkin ? SKIN_INFO[driverSkin].rarity : CHAR_INFO[p.char].rarity}</span><b>${driverSkin ? SKIN_INFO[driverSkin].name : CHAR_INFO[p.char].name}</b>${p.skin && !driverSkin ? `<i>${SKIN_INFO[p.skin].name} livery</i>` : ""}</div>
    </section>
    <div class="console">
      <div class="con-hood">${LEDS}${ticker(news)}</div>
      <div class="con-body">
        <div class="drivers con-left" role="radiogroup" aria-label="Driver">${drivers}</div>
        <div class="dash-bezel"><div class="dash">
          <section class="dash-stats">
            <header class="dash-h"><span>Your stats</span><span class="dash-chip">${tierName}</span></header>
            <div class="dstats">
              <div class="dstat hero"><small>Best score</small><b data-count="${p.best}">${p.best ? "0" : "–"}</b></div>
              <div class="dstat"><small>Points</small><b data-count="${p.points}">0</b></div>
              <div class="dstat"><small>Wins</small><b data-count="${p.wins}">0</b></div>
              <div class="dstat"><small>Best time</small><b>${fmtTime(p.bestTime)}</b></div>
            </div>
            <div class="dtier"><div class="dtier-row"><span>${tierName}</span><span>${next ? `${fmt(next.at - p.points)} to ${next.name}` : "Top tier"}</span></div>
              <div class="dtier-bar"><i style="--w:${Math.max(3, tierPct * 100).toFixed(1)}%"></i></div></div>
          </section>
          <section class="dash-board">
            <header class="dash-h"><span>Top racers</span><button type="button" id="board2">See all <svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button></header>
            <ol id="mini" class="dboard">${Array.from({ length: 4 }, () => `<li class="sk"><i></i><span></span><b></b></li>`).join("")}</ol>
          </section>
        </div></div>
        <div class="go-wrap">
          <div class="tracks" role="radiogroup" aria-label="Track">${TRACK_IDS.map((t) => `<button type="button" class="trk ${t} ${t === trackPick ? "on" : ""}" data-track="${t}" role="radio" aria-checked="${t === trackPick}"><i></i><span><b>${TRACK_INFO[t].name}</b><small>${TRACK_INFO[t].laps} laps · ${t === "town" ? "night" : "dusk"}</small></span></button>`).join("")}</div>
          <button class="launch" id="race" aria-label="Race">
            <span class="launch-ring"></span>
            <span class="launch-body">
              <span class="launch-shine"></span>
              <span class="launch-chev"><i></i><i></i><i></i></span>
              <b>RACE</b>
              <small id="go-track">${trackLabel(trackPick)}</small>
            </span>
          </button>
          <span class="go-label"><kbd>Enter</kbd> to race</span>
        </div>
      </div>
      <div class="con-foot">
        <span style="display:flex;gap:10px">
          <button type="button" class="key cream" id="board">${ICON.trophy} Leaderboard</button>
          <button type="button" class="key yellow" id="shop">${ICON.bag} Shop</button>
          ${p.guest ? `<button type="button" class="key" id="claim">Create account</button>` : ""}
        </span>
        ${LEDS}
      </div>
    </div>
  </div>`);

  let leaving = false;
  const raceBtn = view.querySelector<HTMLButtonElement>("#race")!;
  const go = () => {
    if (leaving) return;
    leaving = true;
    sfx.start();
    raceBtn.classList.add("press");
    view.classList.add("launch-out");
    setTimeout(race, calm ? 0 : 420);
  };
  raceBtn.addEventListener("click", go);
  for (const id of ["#board", "#board2"]) view.querySelector(id)?.addEventListener("click", () => { sfx.ui(); void board("best"); });
  view.querySelectorAll<HTMLElement>("[data-track]").forEach((b) => b.addEventListener("click", () => {
    const t = b.dataset.track as TrackId;
    if (t === trackPick) return;
    sfx.pop();
    setTrack(t);
    view.querySelectorAll<HTMLElement>("[data-track]").forEach((x) => {
      x.classList.toggle("on", x === b);
      x.setAttribute("aria-checked", String(x === b));
    });
    view.querySelector("#go-track")!.textContent = trackLabel(t);
    // Rebuild the backdrop only once the choice has settled, and never if
    // the player goes straight to the race (that builds the track anyway).
    clearTimeout(backdropTimer);
    backdropTimer = window.setTimeout(() => { if (view.isConnected && !leaving && trackPick === t) backdrop(true); }, 1400);
  }));
  for (const id of ["#shop", "#wallet"]) view.querySelector(id)?.addEventListener("click", () => { sfx.ui(); shop(); });
  view.querySelector("#out")!.addEventListener("click", async () => {
    sfx.ui();
    if (p.guest) return auth("signup");
    await api.logout();
    auth("login");
  });
  view.querySelector("#claim")?.addEventListener("click", () => { sfx.ui(); auth("signup"); });

  const pick = async (b: HTMLElement) => {
    const c = b.dataset.char as CharId;
    if (b.classList.contains("locked")) {
      sfx.miss();
      b.classList.remove("nope");
      void b.offsetWidth;
      b.classList.add("nope");
      return;
    }
    if (b.classList.contains("on")) return;
    sfx.pop();
    view.querySelectorAll(".driver").forEach((x) => x.classList.toggle("on", x === b));
    // A squad driver takes the seat back from a skin driver; liveries stay.
    const cur = api.player()!;
    const keepSkin = cur.skin === "quang" || cur.skin === "cipher" ? null : cur.skin;
    stage3d?.setLook(lookFor(c, keepSkin));
    const nd = view.querySelector<HTMLElement>(".now-driving")!;
    nd.innerHTML = `<span>${CHAR_INFO[c].rarity}</span><b>${CHAR_INFO[c].name}</b>${keepSkin ? `<i>${SKIN_INFO[keepSkin].name} livery</i>` : ""}`;
    nd.animate([{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], { duration: 400, easing: "cubic-bezier(.22,1,.36,1)" });
    const pic = view.querySelector<HTMLElement>(".who-pic span")!;
    pic.innerHTML = face(c);
    pic.animate([{ transform: "scale(.6)", opacity: 0 }, { transform: "scale(1)", opacity: 1 }], { duration: 450, easing: "cubic-bezier(.34,1.56,.64,1)" });
    try {
      if (cur.skin !== keepSkin) await api.equipSkin(keepSkin);
      await api.chooseChar(c);
    } catch { /* keep the local choice; the server will catch up */ }
  };
  const keys = [...view.querySelectorAll<HTMLElement>("[data-char]")];
  keys.forEach((b) => b.addEventListener("click", () => void pick(b)));

  wireCommon(view);
  show(view, true);
  stage3d = mountStage(view.querySelector<HTMLElement>("#stage3d")!, { kind: "kart", look: lookFor(p.char, p.skin) }, () => sfx.pop());

  // Enter races; ← → flip through the unlocked drivers.
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter") go();
    else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      const open = keys.filter((d) => !d.classList.contains("locked"));
      const at = open.findIndex((d) => d.classList.contains("on"));
      const nextD = open[(at + (e.key === "ArrowRight" ? 1 : open.length - 1)) % open.length];
      if (nextD && open.length > 1) void pick(nextD);
    }
  };
  addEventListener("keydown", onKey);
  const stopParallax = parallax(view);
  cleanup = () => { removeEventListener("keydown", onKey); stopParallax(); };

  // The numbers count up once the console has landed.
  setTimeout(() => view.querySelectorAll<HTMLElement>(".dstat [data-count]").forEach((b) => {
    const n = Number(b.dataset.count);
    if (n) countUp(b, n, 1100);
  }), calm ? 0 : 1100);

  void miniBoard(view.querySelector<HTMLElement>("#mini")!, p);
  // Races that finished offline get sent now; refresh the board if any did.
  if (!p.guest && api.pendingCount()) {
    void api.syncPending().then((n) => { if (n && view.isConnected) hub(); });
  }
}

async function miniBoard(el: HTMLElement, p: api.Player) {
  const row = (rank: number, handle: string, sub: string, value: number, me: boolean) => `<li class="${rank <= 3 ? `r${rank}` : ""} ${me ? "me" : ""}" style="--d:${rank * 0.06}s">
      <i class="medal">${rank}</i>
      <span class="av" style="--h:${[...handle].reduce((a, c) => a + c.charCodeAt(0), 0) % 360}">${esc(handle.slice(0, 1).toUpperCase())}</span>
      <span class="nm"><b>${esc(handle)}</b><small>${sub}</small></span>
      <b class="sc">${fmt(value)}</b></li>`;
  try {
    const { entries, me } = await api.leaderboard("best");
    if (!el.isConnected) return;
    if (!entries.length) {
      el.innerHTML = `<li class="empty">No races yet. Be the first on the board.</li>`;
      return;
    }
    el.innerHTML = entries.slice(0, 4).map((e, i) => row(i + 1, e.handle, `${e.tier} · ${e.wins} win${e.wins === 1 ? "" : "s"}`, e.best, e.handle === p.handle && !p.guest)).join("")
      + (me && me.rank > 4 ? row(me.rank, p.handle, "You", me.value, true) : "");
  } catch {
    if (el.isConnected) el.innerHTML = `<li class="empty">The board is offline right now.</li>`;
  }
}

/* ================================================================== */
/* Shop: kart skins for Dili coins                                     */
/* ================================================================== */

function shop(focus?: SkinId) {
  const p = api.player();
  if (!p) return auth();
  let sel: SkinId = focus ?? (p.skin ?? "quang");

  const card = (id: SkinId) => {
    const s = SKIN_INFO[id];
    const art = s.kind === "driver" ? skinPortrait(id as "quang" | "cipher") : `<span class="swatch ${id}"></span>`;
    return `<button type="button" class="skin" data-skin="${id}" style="--tint:${s.color}">
      <span class="skin-art">${art}</span>
      <span class="skin-txt"><small>${s.rarity} · ${s.kind === "driver" ? "Driver + kart" : "Livery"}</small><b>${s.name}</b></span>
      <span class="skin-tag"></span>
    </button>`;
  };

  const view = h(`<div class="screen stage-screen shop" data-scene="hub">
    <header class="bar">
      <button class="iconbtn" id="back" aria-label="Back to the hub">${ICON.back}</button>
      <div class="shop-title"><b>Kart Shop</b><span>Skins for Dili coins</span></div>
      <div class="bar-right">
        ${soundButton()}
        <span class="wallet big" id="wallet">${ICON.coin}<b>${fmt(p.coins)}</b></span>
      </div>
    </header>
    <div class="shop-body">
      <section class="shop-stage">
        <div class="stage3d" id="stage3d" title="Drag to spin"></div>
        <div class="shop-info" id="info"></div>
      </section>
      <aside class="shop-list">
        <div class="shop-list-h">Drivers</div>
        ${SKIN_IDS.filter((x) => SKIN_INFO[x].kind === "driver").map(card).join("")}
        <div class="shop-list-h">Liveries</div>
        ${SKIN_IDS.filter((x) => SKIN_INFO[x].kind === "livery").map(card).join("")}
        <p class="shop-fine">Every coin you grab on track goes in your wallet. Liveries repaint whichever squad driver you pick.</p>
      </aside>
    </div>
  </div>`);

  const info = view.querySelector<HTMLElement>("#info")!;
  const wallet = view.querySelector<HTMLElement>("#wallet b")!;
  const render = () => {
    const cur = api.player()!;
    const s = SKIN_INFO[sel];
    const owned = cur.skins.includes(sel);
    const on = cur.skin === sel;
    const short = s.price - cur.coins;
    view.querySelectorAll<HTMLElement>(".skin").forEach((b) => {
      const id = b.dataset.skin as SkinId;
      b.classList.toggle("sel", id === sel);
      b.classList.toggle("owned", cur.skins.includes(id));
      b.querySelector(".skin-tag")!.innerHTML = cur.skin === id ? "Equipped" : cur.skins.includes(id) ? "Owned" : `${ICON.coin}${fmt(SKIN_INFO[id].price)}`;
    });
    info.style.setProperty("--tint", s.color);
    info.innerHTML = `<small>${s.rarity} ${s.kind === "driver" ? "driver" : "livery"}</small>
      <h2>${s.name}</h2><p>${s.blurb}</p>
      <div class="shop-acts">
        ${on ? `<button class="buy ghost" data-do="unequip">Equipped · take off</button>`
          : owned ? `<button class="buy" data-do="equip">Equip</button>`
          : `<button class="buy" data-do="buy" ${short > 0 ? "disabled" : ""}>${ICON.coin}<span>Buy for ${fmt(s.price)}</span></button>`}
        ${!owned && short > 0 ? `<span class="need">${fmt(short)} more coins · grab them on track</span>` : ""}
      </div>
      <p class="shop-msg" id="msg"></p>`;
    info.querySelector<HTMLButtonElement>("[data-do]")?.addEventListener("click", (e) => void act((e.currentTarget as HTMLElement).dataset.do!));
    wallet.textContent = fmt(cur.coins);
  };
  const preview = () => {
    const cur = api.player()!;
    stage3d?.setLook(lookFor(cur.char, sel));
  };
  const act = async (what: string) => {
    const btn = info.querySelector<HTMLButtonElement>("[data-do]");
    if (btn) btn.disabled = true;
    try {
      if (what === "buy") {
        await api.buySkin(sel);
        sfx.perfect(3);
        confetti(info);
      } else if (what === "equip") {
        await api.equipSkin(sel);
        sfx.pop();
      } else {
        await api.equipSkin(null);
        sfx.ui();
      }
      render();
    } catch (e) {
      sfx.miss();
      render();
      const m = view.querySelector<HTMLElement>("#msg");
      if (m) m.textContent = e instanceof Error ? e.message : "That didn't work. Try again.";
    }
  };
  view.querySelectorAll<HTMLElement>(".skin").forEach((b) => b.addEventListener("click", () => {
    const id = b.dataset.skin as SkinId;
    if (id === sel) return;
    sel = id;
    sfx.pop();
    render();
    preview();
  }));
  view.querySelector("#back")!.addEventListener("click", () => { sfx.ui(); hub(); });
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") hub(); };
  addEventListener("keydown", onKey);

  wireCommon(view);
  show(view, true);
  cleanup = () => removeEventListener("keydown", onKey);
  stage3d = mountStage(view.querySelector<HTMLElement>("#stage3d")!, { kind: "kart", look: lookFor(p.char, sel), far: true }, () => sfx.pop());
  render();
}

/** A burst of coins and sparks from an element, for a purchase. */
function confetti(from: HTMLElement) {
  if (calm) return;
  const r = from.getBoundingClientRect();
  for (let i = 0; i < 26; i++) {
    const s = document.createElement("i");
    s.className = "coin-burst";
    const a = Math.random() * Math.PI * 2, d = 80 + Math.random() * 160;
    s.style.left = `${r.left + r.width / 2}px`;
    s.style.top = `${r.top + r.height * 0.7}px`;
    document.body.appendChild(s);
    s.animate([
      { transform: "translate(-50%,-50%) scale(.4)", opacity: 1 },
      { transform: `translate(calc(-50% + ${Math.cos(a) * d}px), calc(-50% + ${Math.sin(a) * d - 60}px)) rotate(${Math.random() * 720}deg) scale(1)`, opacity: 0 },
    ], { duration: 900 + Math.random() * 500, easing: "cubic-bezier(.22,1,.36,1)" }).onfinish = () => s.remove();
  }
}

/* ================================================================== */
/* Race                                                                */
/* ================================================================== */

function race() {
  const p = api.player();
  if (!p) return auth();

  const view = h(`<div class="screen race-view">
    <div class="race-stage" id="stage"></div>
    <div class="race-ui">
      <button class="rbtn" id="pause" title="Pause (Esc)" aria-label="Pause">${ICON.pause}</button>
      <button class="rbtn" data-act="mute" title="Sound" aria-label="Toggle sound">${isMuted() ? ICON.muted : ICON.sound}</button>
      ${canFullscreen() ? `<button class="rbtn" data-act="full" title="Fullscreen" aria-label="Fullscreen">${ICON.full}</button>` : ""}
    </div>
  </div>`);
  const stageEl = view.querySelector<HTMLElement>("#stage")!;
  show(view);
  wireCommon(view);
  view.querySelector("#pause")!.addEventListener("click", () => dispatchEvent(new KeyboardEvent("keydown", { code: "Escape" })));

  const game = new DiliCart();
  racer = game;
  game.mount(stageEl, {
    onEnd: (r) => void results(stageEl, r),
    onRestart: () => { sfx.ui(); race(); },
    onQuit: () => { sfx.ui(); hub(); },
  }, p.char, { skin: p.skin, track: trackPick });
}

const RI = {
  coin: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="currentColor"/><path d="M9.5 7.5h2.6a4.5 4.5 0 0 1 0 9H9.5z" fill="#0b0d1c" opacity=".55"/></svg>`,
  turbo: `<svg viewBox="0 0 24 24"><path d="M13 2 5 13h6l-1 9 8-11h-6z" fill="currentColor"/></svg>`,
  star: `<svg viewBox="0 0 24 24"><path d="m12 2.5 2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z" fill="currentColor"/></svg>`,
  pass: `<svg viewBox="0 0 24 24"><path d="M4 17 10 11l4 4 6-7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M15 8h5v5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  hit: `<svg viewBox="0 0 24 24"><path d="M12 2v5M12 17v5M2 12h5M17 12h5M5 5l3.5 3.5M15.5 15.5 19 19M19 5l-3.5 3.5M8.5 15.5 5 19" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>`,
  flag: `<svg viewBox="0 0 24 24"><path d="M5 3v18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M6 4h12l-2.5 4L18 12H6z" fill="currentColor"/></svg>`,
  clock: `<svg viewBox="0 0 24 24"><circle cx="12" cy="13" r="8" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M12 9v4l3 2M9 2h6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>`,
  home: `<svg viewBox="0 0 24 24"><path d="M4 11 12 4l8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/></svg>`,
  share: `<svg viewBox="0 0 24 24"><path d="M12 15V3m0 0L7.5 7.5M12 3l4.5 4.5M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  replay: `<svg viewBox="0 0 24 24"><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4v4h4" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
};

/** End-of-race card, over the still-running finish camera. */
async function results(stageEl: HTMLElement, r: RaceResult) {
  const p = api.player()!;
  const podium = r.position <= 3;
  const tiles: [string, string, number, string, string][] = [
    // icon, label, points, detail, accent
    [RI.coin, "Coins", r.tally.coins, `${r.coins} grabbed`, "#ffc21a"],
    [RI.turbo, "Mini-turbos", r.tally.turbos, `${r.turbos} fired`, "#2ee6ff"],
    [RI.star, "Stunts", r.tally.stunts, `${r.tricks} tricks`, "#b58cff"],
    [RI.pass, "Overtakes", r.tally.passes, "passes", "#39ff9e"],
    [RI.hit, "Takedowns", r.tally.takedowns, `${r.takedowns} Custodians`, "#ff5c7a"],
    [RI.flag, "Laps", r.tally.laps, `${r.laps} laps`, "#9db4ff"],
  ];
  const title = r.position === 1 ? "Custodians defeated!" : podium ? "On the podium!" : "Good race. Go again!";
  const over = h(`<div class="rr ${podium ? "podium" : ""} p${r.position}">
    <div class="rr-card">
      <header class="rr-head">
        <div class="rr-medal"><b>${r.position}</b><sup>${ORD(r.position).replace(/\d+/, "")}</sup></div>
        <div class="rr-cap">
          <small>${TRACK_INFO[r.track].name} · ${r.laps} laps</small>
          <b>${title}</b>
          <div class="rr-chips">
            <span>${RI.clock}${fmtTime(r.time)}</span>
            <span>${RI.turbo}Best lap ${fmtTime(r.bestLap)}</span>
          </div>
        </div>
      </header>

      <div class="rr-grid">
        ${tiles.map(([icon, label, v, note, c], i) => `<div class="rr-tile ${v ? "" : "zero"}" style="--c:${c};--d:${0.15 + i * 0.07}s">
          <i class="ico">${icon}</i>
          <span class="lab">${label}<small>${note}</small></span>
          <b data-n="${v}">0</b>
        </div>`).join("")}
      </div>

      <div class="rr-bonus" style="--d:${0.6}s">
        <span class="pill gold">${ORD(r.position)} place <b data-n="${r.finishBonus}">0</b></span>
        <span class="pill">Time bonus <b data-n="${r.timeBonus}">0</b></span>
      </div>

      <div class="rr-total" style="--d:0.75s">
        <span>Total score</span>
        <b data-n="${r.score}" data-total="1">0</b>
        <i class="rr-ribbon" hidden>New best</i>
      </div>

      <div class="rr-rewards" id="earn">
        <div class="rw sk"></div><div class="rw sk"></div><div class="rw sk"></div>
      </div>
      <div class="rr-unlocks" id="unlocks"></div>

      <div class="rr-acts">
        <button class="rr-go" id="again" aria-label="Race again">
          <span class="rr-go-face">
            <span class="rr-go-shine"></span>
            <span class="rr-go-ico">${RI.replay}</span>
            <span class="rr-go-txt"><b>Race again</b><small>${TRACK_INFO[r.track].name} · ${r.laps} laps</small></span>
            <span class="rr-go-chev"><i></i><i></i><i></i></span>
          </span>
          <kbd class="rr-go-key">Enter ↵</kbd>
        </button>
        <div class="rr-row2">
          <button class="rr-sec" id="home"><i>${RI.home}</i><span>Hub</span></button>
          <button class="rr-sec" id="rank"><i>${ICON.trophy}</i><span>Leaderboard</span></button>
          <button class="rr-sec" id="share"><i>${RI.share}</i><span>Share</span></button>
        </div>
      </div>
    </div>
  </div>`);
  stageEl.appendChild(over);

  over.querySelectorAll<HTMLElement>("[data-n]").forEach((b, i) => {
    const target = Number(b.dataset.n);
    const total = b.dataset.total === "1";
    setTimeout(() => {
      const t0 = performance.now();
      const dur = total ? 1200 : 500;
      const tick = (now: number) => {
        const k = Math.min(1, (now - t0) / dur);
        b.textContent = (total ? "" : "+") + fmt(Math.round(target * (1 - Math.pow(1 - k, 3))));
        if (k < 1) requestAnimationFrame(tick);
        else if (target > 0) {
          sfx.good(Math.min(9, i));
          if (total) b.closest(".rr-total")!.classList.add("done");
        }
      };
      requestAnimationFrame(tick);
    }, calm ? 0 : (total ? 950 : 220 + i * 90));
  });

  const again = () => { sfx.ui(); race(); };
  const onKey = (e: KeyboardEvent) => { if (e.key === "Enter") again(); };
  addEventListener("keydown", onKey);
  cleanup = () => removeEventListener("keydown", onKey);
  over.querySelector("#again")!.addEventListener("click", again);
  over.querySelector("#home")!.addEventListener("click", () => { sfx.ui(); hub(); });
  over.querySelector("#rank")!.addEventListener("click", () => { sfx.ui(); void board("best"); });
  const shareBtn = over.querySelector<HTMLButtonElement>("#share")!;
  shareBtn.addEventListener("click", async () => {
    const line = `I finished ${ORD(r.position)} on ${TRACK_INFO[r.track].name} in DILI CART with ${fmt(r.score)} points. Beat me: ${location.origin}`;
    const label = shareBtn.querySelector("span")!;
    try {
      if (navigator.share) await navigator.share({ text: line });
      else { await navigator.clipboard.writeText(line); label.textContent = "Copied!"; }
    } catch { /* cancelled */ }
    setTimeout(() => (label.textContent = "Share"), 1600);
  });

  // Save the race and show what it earned.
  const earn = over.querySelector<HTMLElement>("#earn")!;
  let reply: (RaceReply & { offline?: boolean }) | null = null;
  try {
    reply = await api.submitRace({ score: r.score, position: r.position, time: r.time, coins: r.coins });
  } catch (e) {
    earn.innerHTML = `<div class="rw err"><b>Couldn't save this race</b><small>${esc(e instanceof Error ? e.message : "unknown error")}</small></div>`;
    return;
  }
  if (!over.isConnected) return;
  if (reply.isBest) over.querySelector<HTMLElement>(".rr-ribbon")!.hidden = false;

  // Coins: progress toward the cheapest skin not owned yet.
  const wallet = reply.player.coins ?? 0;
  const next = SKIN_IDS.filter((id) => !(reply.player.skins ?? []).includes(id)).sort((a, b) => SKIN_INFO[a].price - SKIN_INFO[b].price)[0];
  const price = next ? SKIN_INFO[next].price : 0;
  const canBuy = !!next && wallet >= price;
  const rankTxt = p.guest ? "Guest" : reply.offline ? "Offline" : reply.rank ? `#${fmt(reply.rank)}` : "—";
  const rankSub = p.guest ? "sign up to get ranked" : reply.offline ? "syncs when you're back online" : "worldwide · best race";
  earn.innerHTML = `
    <div class="rw pts"><small>Points earned</small><b>+${fmt(reply.earned)}</b>${reply.multiplier > 1 ? `<em>${reply.multiplier.toFixed(1)}× streak</em>` : `<em class="dim">race daily for up to 2×</em>`}</div>
    <div class="rw rank"><small>Rank</small><b>${rankTxt}</b><em class="dim">${rankSub}</em></div>
    <div class="rw coins ${canBuy ? "ready" : ""}">
      <small>${ICON.coin}Wallet</small><b>${fmt(wallet)}</b>
      ${next ? (canBuy
        ? `<button class="rw-shop" id="toshop">${SKIN_INFO[next].name} is yours · Shop</button>`
        : `<div class="rw-bar"><i style="width:${Math.min(100, (wallet / price) * 100).toFixed(1)}%"></i></div><em class="dim">${fmt(price - wallet)} to ${SKIN_INFO[next].name}</em>`)
        : `<em class="dim">every skin owned</em>`}
    </div>`;
  earn.querySelector("#toshop")?.addEventListener("click", () => { sfx.ui(); shop(next); });

  // Newly unlocked drivers.
  const unlocks = over.querySelector<HTMLElement>("#unlocks")!;
  const before = reply.player.points - reply.earned;
  for (const id of CHAR_IDS) {
    if (before < CHAR_UNLOCK[id] && reply.player.points >= CHAR_UNLOCK[id]) {
      unlocks.insertAdjacentHTML("beforeend", `<div class="rr-unlock" style="--c:${CHAR_INFO[id].color}">
        <span class="pic">${face(id)}</span><span><small>New driver unlocked</small><b>${CHAR_INFO[id].name}</b></span><em>${CHAR_INFO[id].rarity}</em></div>`);
      sfx.perfect(9);
    }
  }
}

/* ================================================================== */
/* Leaderboard                                                         */
/* ================================================================== */

async function board(by: "best" | "points") {
  const p = api.player();
  const view = h(`<div class="screen board">
    <header class="bar">
      <button class="iconbtn back" id="back" aria-label="Back">${ICON.back}</button>
      ${brand()}
      <div class="bar-right">${soundButton()}</div>
    </header>
    <main class="board-main">
      <h1>Leaderboard</h1>
      <div class="seg tabs">
        <button data-by="best" class="${by === "best" ? "on" : ""}">Best race</button>
        <button data-by="points" class="${by === "points" ? "on" : ""}">Total points</button>
      </div>
      <div class="panel lb" id="lb"><p class="muted">Loading…</p></div>
      ${p?.guest ? `<p class="guestnote">Guests aren't on the global board. <button class="link" id="claim">Create an account</button> to get ranked.</p>` : ""}
    </main>
  </div>`);
  view.querySelector("#back")!.addEventListener("click", () => { sfx.ui(); hub(); });
  view.querySelector("#claim")?.addEventListener("click", () => { sfx.ui(); auth("signup"); });
  view.querySelectorAll<HTMLElement>("[data-by]").forEach((b) => b.addEventListener("click", () => { sfx.ui(); void board(b.dataset.by as "best" | "points"); }));
  wireCommon(view);
  show(view, true);

  const lb = view.querySelector<HTMLElement>("#lb")!;
  try {
    const { entries, me } = await api.leaderboard(by);
    if (!lb.isConnected) return;
    if (!entries.length) {
      lb.innerHTML = `<p class="muted">Nobody has finished a race yet. Go and take first place.</p>`;
      return;
    }
    const row = (e: BoardEntry, i: number) => `<div class="lb-row ${p && !p.guest && e.handle === p.handle ? "me" : ""} ${i < 3 ? "top t" + i : ""}">
      <i class="rank">${i + 1}</i>
      <span class="lb-av" style="--h:${[...e.handle].reduce((a, c) => a + c.charCodeAt(0), 0) % 360}">${esc(e.handle.slice(0, 1).toUpperCase())}</span>
      <span class="who">@${esc(e.handle)}<small>${e.tier} · ${e.races} race${e.races === 1 ? "" : "s"} · ${e.wins} win${e.wins === 1 ? "" : "s"}</small></span>
      <b>${fmt(by === "best" ? e.best : e.points)}</b>
    </div>`;
    lb.innerHTML = entries.map(row).join("")
      + (me && me.rank > entries.length ? `<div class="lb-row me"><i class="rank">${me.rank}</i><span class="who">You</span><b>${fmt(me.value)}</b></div>` : "");
  } catch (e) {
    if (lb.isConnected) lb.innerHTML = `<p class="muted">${esc(e instanceof Error ? e.message : "The board is offline.")}</p>`;
  }
}

/* ================================================================== */
/* Boot                                                                */
/* ================================================================== */

void (async () => {
  progress(0.12, "Checking your garage");
  const p = await api.restore();
  const dev = import.meta.env.DEV ? location.hash : "";
  if (dev === "#race" || dev === "#town") {
    dropLoader();
    if (!p) api.playAsGuest();
    setTrack(dev === "#town" ? "town" : "circuit");
    return race();
  }
  // Dev shortcuts for screenshots: open a screen directly.
  if (dev.startsWith("#auth")) { dropLoader(); return auth(); }
  if (dev === "#hub") {
    dropLoader();
    if (!p) api.playAsGuest();
    return hub();
  }
  if (dev === "#intro") { dropLoader(); return intro(hub); }

  // Fonts, then the film: the loader's kart drives as they arrive.
  progress(0.3, "Painting the karts");
  await Promise.race([document.fonts?.ready, new Promise((r) => setTimeout(r, 2500))]);
  const showFilm = !filmSeen() && !calm;
  let film: HTMLVideoElement | undefined;
  if (showFilm) {
    progress(0.42, "Loading the intro film");
    film = await prepareFilm((k) => progress(0.42 + 0.53 * k));
  }
  await finishLoader();

  // First visit this session: the film, then sign-in (or Dili's hello for
  // someone already signed in), then the hub. The next screen mounts as the
  // film fades out, so a phone never plays the film and runs the race at once.
  const next = () => {
    if (!p) auth();
    else if (!greetedThisSession()) intro(hub, false);
    else hub();
  };
  if (showFilm) playFilm(next, film);
  else next();
})();
