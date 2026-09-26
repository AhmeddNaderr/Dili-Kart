import "./style.css";
import "./ui/console.css";
import { DiliCart, LAPS, type RaceResult } from "./kart/race";
import { buildIntro, greetedThisSession } from "./ui/intro";
import { filmSeen, playFilm } from "./ui/film";
import { mountStage, type MenuStage } from "./ui/stage3d";
import { ICON, LOGO, portrait } from "./ui/icons";
import { MASCOT } from "./kart/mascot";
import { sfx, setMuted, isMuted } from "./engine/audio";
import * as api from "./app/api";
import {
  CHAR_IDS, CHAR_INFO, CHAR_UNLOCK, PASSWORD_MIN, TIERS, nextTier, normaliseHandle,
  type BoardEntry, type CharId, type RaceReply,
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

function backdrop(on: boolean) {
  if (on && !live && !calm) {
    live = new DiliCart();
    // Camera changes are clean cuts, like a broadcast; no dip to black.
    live.mount(liveEl, {
      onEnd() {}, onRestart() {}, onQuit() {},
      onReady: () => liveEl.classList.add("on"),
    }, "dili", { attract: true });
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

const canFullscreen = () => document.fullscreenEnabled === true;

/** The app mark: the Dlicom swoosh on a glossy squircle, like a home-screen icon. */
function appIcon(size = "") {
  return `<span class="app-icon ${size}" aria-hidden="true"><i class="ai-gloss"></i>${LOGO}<i class="ai-shine"></i></span>`;
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
        ["8 racers · 3 laps", ""], ["Beat the Custodians", "y"], ["Drift for turbo", ""], ["$DLI TGE 2027", "y"],
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

  const drivers = CHAR_IDS.map((id) => {
    const need = CHAR_UNLOCK[id];
    const open = p.points >= need;
    const pct = open ? 100 : Math.floor((p.points / need) * 100);
    return `<button type="button" class="driver ${p.char === id ? "on" : ""} ${open ? "" : "locked"}" data-char="${id}" style="--tint:${CHAR_INFO[id].color}" ${open ? "" : "aria-disabled=\"true\""}>
      <span class="pic">${face(id)}${open ? "" : `<i class="lock">${ICON.lock}</i>`}</span>
      <span><b>${CHAR_INFO[id].name}</b><small>${open ? CHAR_INFO[id].rarity : `${fmt(need)} pts`}</small>${open ? "" : `<span class="bar"><i style="width:${pct}%"></i></span>`}</span>
      <i class="led"></i>
    </button>`;
  }).join("");

  const streak = p.streak >= 2 ? `${p.streak}-day streak · up to 2× points` : "Race daily for up to 2× points";
  const news: [string, string][] = [
    ["Dili Circuit · 3 laps · 8 racers", ""],
    [streak, "g"],
    ["$DLI TGE 2027 · follow @DlicomApp", "y"],
    ["Your ad on a stadium board · $5 · DM @00xmado", "p"],
    ...(p.guest ? [["Guest mode · scores stay on this device", "y"] as [string, string]] : []),
  ];

  const view = h(`<div class="screen stage-screen garage" data-scene="hub">
    <header class="bar">${brand()}
      <div class="bar-right">
        ${soundButton()}
        ${canFullscreen() ? `<button class="iconbtn" data-act="full" title="Fullscreen" aria-label="Fullscreen">${ICON.full}</button>` : ""}
        <div class="plate">
          <span class="who-pic" style="--p:${tierPct.toFixed(3)}"><span>${face(p.char)}</span></span>
          <span class="who-name"><b>${p.guest ? "Guest" : "@" + esc(p.handle)}</b><small>${p.tier.toUpperCase()}${next ? ` · ${fmt(next.at - p.points)} TO ${next.name.toUpperCase()}` : " · TOP TIER"}</small></span>
          <button class="key" id="out">${p.guest ? "Sign up" : "Log out"}</button>
        </div>
      </div>
    </header>
    <section class="garage-top">
      <div class="stage3d" id="stage3d" title="Drag to spin · click to wave"></div>
      ${wordmark()}
    </section>
    <div class="console">
      <div class="con-hood">${LEDS}${ticker(news)}</div>
      <div class="con-body">
        <div class="drivers con-left" role="radiogroup" aria-label="Driver">${drivers}</div>
        <div class="screen-bezel"><div class="crt crt-in hub-crt">
          <i class="crt-boot"></i>
          <div class="px-stats glow" style="--i:0">
            <div class="px-stat"><small>BEST</small><b data-count="${p.best}">${p.best ? "0" : "—"}</b></div>
            <div class="px-stat"><small>POINTS</small><b data-count="${p.points}">0</b></div>
            <div class="px-stat"><small>WINS</small><b data-count="${p.wins}">0</b></div>
            <div class="px-stat"><small>BEST TIME</small><b>${fmtTime(p.bestTime)}</b></div>
            <div class="px-stat px-tier"><small><span>${p.tier.toUpperCase()}</span><span>${next ? next.name.toUpperCase() : "MAX"}</span></small><div class="px-bar"><i style="width:${Math.max(3, tierPct * 100).toFixed(1)}%"></i></div></div>
          </div>
          <div class="px-board glow" style="--i:1">
            <div class="px-head"><span>TOP RACERS</span><button type="button" id="board2">ALL ▸</button></div>
            <ol id="mini"><li class="muted">LOADING<span class="px-blink">_</span></li></ol>
          </div>
        </div></div>
        <div class="go-wrap">
          <button class="go-btn" id="race" aria-label="Race"><span class="go-dome"><span>RACE</span></span></button>
          <span class="go-label"><kbd>Enter</kbd> to race</span>
        </div>
      </div>
      <div class="con-foot">
        <span style="display:flex;gap:10px">
          <button type="button" class="key cream" id="board">${ICON.trophy} Leaderboard</button>
          ${p.guest ? `<button type="button" class="key yellow" id="claim">Create account</button>` : ""}
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
    view.classList.add("launch");
    setTimeout(race, calm ? 0 : 320);
  };
  raceBtn.addEventListener("click", go);
  for (const id of ["#board", "#board2"]) view.querySelector(id)?.addEventListener("click", () => { sfx.ui(); void board("best"); });
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
    stage3d?.setChar(c);
    const pic = view.querySelector<HTMLElement>(".who-pic span")!;
    pic.innerHTML = face(c);
    pic.animate([{ transform: "scale(.6)", opacity: 0 }, { transform: "scale(1)", opacity: 1 }], { duration: 450, easing: "cubic-bezier(.34,1.56,.64,1)" });
    try { await api.chooseChar(c); } catch { /* keep the local choice; the server will catch up */ }
  };
  const keys = [...view.querySelectorAll<HTMLElement>("[data-char]")];
  keys.forEach((b) => b.addEventListener("click", () => void pick(b)));

  wireCommon(view);
  show(view, true);
  stage3d = mountStage(view.querySelector<HTMLElement>("#stage3d")!, { kind: "kart", char: p.char }, () => sfx.pop());

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

  // The screen boots, then the numbers count up.
  setTimeout(() => view.querySelectorAll<HTMLElement>(".px-stat [data-count]").forEach((b) => {
    const n = Number(b.dataset.count);
    if (n) countUp(b, n, 1100);
  }), calm ? 0 : 1500);

  void miniBoard(view.querySelector<HTMLElement>("#mini")!, p);
  // Races that finished offline get sent now; refresh the board if any did.
  if (!p.guest && api.pendingCount()) {
    void api.syncPending().then((n) => { if (n && view.isConnected) hub(); });
  }
}

async function miniBoard(el: HTMLElement, p: api.Player) {
  try {
    const { entries, me } = await api.leaderboard("best");
    if (!el.isConnected) return;
    if (!entries.length) {
      el.innerHTML = `<li class="muted">NO RACES YET. BE THE FIRST.</li>`;
      return;
    }
    el.innerHTML = entries.slice(0, 5).map((e, i) => `<li class="${e.handle === p.handle && !p.guest ? "me" : ""}">
      <i>${i + 1}</i><span>${esc(e.handle)}</span><b>${fmt(e.best)}</b></li>`).join("")
      + (me && me.rank > 5 ? `<li class="me"><i>${me.rank}</i><span>YOU</span><b>${fmt(me.value)}</b></li>` : "");
  } catch {
    if (el.isConnected) el.innerHTML = `<li class="muted">BOARD OFFLINE</li>`;
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
  }, p.char);
}

/** End-of-race card, over the still-running finish camera. */
async function results(stageEl: HTMLElement, r: RaceResult) {
  const p = api.player()!;
  const podium = r.position <= 3;
  const rows: [string, number, string][] = [
    ["Coins", r.tally.coins, `${r.coins} grabbed`],
    ["Mini-turbos", r.tally.turbos, `${r.turbos} fired`],
    ["Stunts", r.tally.stunts, `${r.tricks} tricks`],
    ["Overtakes", r.tally.passes, ""],
    ["Takedowns", r.tally.takedowns, r.takedowns ? `${r.takedowns} Custodians` : ""],
    ["Laps", r.tally.laps, `${LAPS} laps`],
    [`${ORD(r.position)} place`, r.finishBonus, "finish bonus"],
    ["Time bonus", r.timeBonus, fmtTime(r.time)],
  ];
  const over = h(`<div class="rr ${podium ? "podium" : ""}">
    <div class="rr-card">
      <div class="rr-top">
        <div class="rr-place" data-t="${ORD(r.position)}">${ORD(r.position)}</div>
        <div class="rr-cap"><b>${r.position === 1 ? "Custodians defeated!" : podium ? "On the podium!" : "Good race — go again!"}</b>
          <span>${fmtTime(r.time)} · best lap ${fmtTime(r.bestLap)}</span></div>
      </div>
      <div class="rr-rows">
        ${rows.map(([k, v, note], i) => `<div class="rr-row" style="--d:${0.2 + i * 0.1}s">
          <span>${k}${note ? `<i>${note}</i>` : ""}</span><b data-n="${v}">0</b></div>`).join("")}
      </div>
      <div class="rr-total" style="--d:${0.3 + rows.length * 0.1}s"><span>Total</span><b data-n="${r.score}">0</b></div>
      <div class="rr-earn" id="earn">Saving your race…</div>
      <div class="rr-acts">
        <button class="btn primary" id="again">Race again <kbd>Enter</kbd></button>
        <div class="rr-row2">
          <button class="btn ghost" id="rank">Leaderboard</button>
          <button class="btn ghost" id="share">Share</button>
          <button class="btn ghost" id="home">Hub</button>
        </div>
      </div>
    </div>
  </div>`);
  stageEl.appendChild(over);

  over.querySelectorAll<HTMLElement>("[data-n]").forEach((b, i) => {
    const target = Number(b.dataset.n);
    const total = !!b.closest(".rr-total");
    setTimeout(() => {
      const t0 = performance.now();
      const dur = total ? 1100 : 450;
      const tick = (now: number) => {
        const k = Math.min(1, (now - t0) / dur);
        b.textContent = fmt(Math.round(target * (1 - Math.pow(1 - k, 3))));
        if (k < 1) requestAnimationFrame(tick);
        else if (target > 0) sfx.good(Math.min(9, i));
      };
      requestAnimationFrame(tick);
    }, 200 + i * 100 + (total ? 200 : 0));
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
    const line = `I finished ${ORD(r.position)} in DILI CART with ${fmt(r.score)} points. Beat me on the Dlicom Grand Prix.`;
    try { await navigator.clipboard.writeText(line); shareBtn.textContent = "Copied!"; } catch { shareBtn.textContent = "Copy failed"; }
    setTimeout(() => (shareBtn.textContent = "Share"), 1600);
  });

  // Save the race and show what it earned.
  const earn = over.querySelector<HTMLElement>("#earn")!;
  let reply: (RaceReply & { offline?: boolean }) | null = null;
  try {
    reply = await api.submitRace({ score: r.score, position: r.position, time: r.time, coins: r.coins });
  } catch (e) {
    earn.innerHTML = `<span class="err">Couldn't save this race: ${esc(e instanceof Error ? e.message : "unknown error")}</span>`;
    return;
  }
  const bits = [`+${fmt(reply.earned)} points`];
  if (reply.multiplier > 1) bits.push(`${reply.multiplier.toFixed(1)}× streak`);
  if (reply.rank && !p.guest) bits.push(`#${reply.rank} worldwide`);
  earn.innerHTML = `${reply.isBest ? '<span class="rr-best">New personal best!</span>' : ""}<span>${bits.join(" · ")}</span>`
    + (p.guest ? `<span class="muted">Guest score — saved on this device only.</span>` : "")
    + (reply.offline ? `<span class="muted">No connection — this race is saved on your device and will sync to the board automatically.</span>` : "");
  // Newly unlocked drivers.
  const before = reply.player.points - reply.earned;
  for (const id of CHAR_IDS) {
    if (before < CHAR_UNLOCK[id] && reply.player.points >= CHAR_UNLOCK[id]) {
      earn.insertAdjacentHTML("beforeend", `<span class="unlock">${face(id)} ${CHAR_INFO[id].name} unlocked!</span>`);
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
  app.innerHTML = `<div class="boot">${appIcon("xl")}</div>`;
  const p = await api.restore();
  if (import.meta.env.DEV && location.hash === "#race") {
    if (!p) api.playAsGuest();
    return race();
  }
  // Dev shortcuts for screenshots: open a screen directly.
  if (import.meta.env.DEV && location.hash.startsWith("#auth")) {
    auth();
    // "#auth@1200" scrolls the page down, for screenshots of the sections.
    const y = Number(location.hash.split("@")[1] ?? 0);
    if (y) setTimeout(() => { const sc = document.querySelector<HTMLElement>(".screen"); if (sc) { sc.style.scrollBehavior = "auto"; sc.scrollTop = y; } }, 300);
    return;
  }
  if (import.meta.env.DEV && location.hash === "#hub") {
    if (!p) api.playAsGuest();
    return hub();
  }
  if (import.meta.env.DEV && location.hash === "#intro") return intro(hub);
  // First visit this session: the intro film, then the title screen.
  // Logged in from last time: Dili says hello once per visit, then the hub.
  if (!p) {
    // The title screen (and its live stadium) mounts as the film fades out,
    // so a phone never has to play the film and run the race at once.
    if (!filmSeen() && !calm) playFilm(() => auth());
    else auth();
  } else if (!greetedThisSession()) intro(hub, false);
  else hub();
})();
