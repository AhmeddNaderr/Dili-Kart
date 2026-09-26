import "./style.css";
import "./ui/hub.css";
import { DiliCart, LAPS, type RaceResult } from "./kart/race";
import { buildIntro, greetedThisSession } from "./ui/intro";
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
liveEl.innerHTML = `<div class="live-shade"></div><div class="live-cut"></div>`;
document.body.insertBefore(liveEl, app);
let live: DiliCart | null = null;
const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;

function backdrop(on: boolean) {
  if (on && !live && !calm) {
    live = new DiliCart();
    const cut = liveEl.querySelector<HTMLElement>(".live-cut")!;
    live.mount(liveEl, {
      onEnd() {}, onRestart() {}, onQuit() {},
      onReady: () => liveEl.classList.add("on"),
      onCut: () => { cut.classList.remove("go"); void cut.offsetWidth; cut.classList.add("go"); },
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
  liveEl.dataset.screen = view.classList[1] ?? "";
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

/** Chequered flag for the big Race button. */
const FLAG = `<svg viewBox="0 0 48 48"><path d="M10 6v38" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>
  <path d="M12 8c8-4 14 4 24 0v20c-10 4-16-4-24 0z" fill="#fff"/>
  <path d="M12 8c2-1 4-1 6-.6v6.4c-2-.4-4-.4-6 .4zM24 9.4c2 .8 4 1 6 .6v6.4c-2 .4-4 .2-6-.6zM18 13.8c2 .4 4 1 6 1.6v6.4c-2-.6-4-1.2-6-1.6zM30 16.4c2-.2 4-.8 6-1.6v6.4c-2 .8-4 1.4-6 1.6zM12 21c2-.8 4-1 6-.8v6.4c-2-.2-4 0-6 .8zM24 21.8c2 .6 4 1 6 .8v6.2c-2 .2-4-.2-6-.8z" fill="#0b0c14"/></svg>`;

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
/* Sign in                                                             */
/* ================================================================== */

function auth(mode: "signup" | "login" = "signup") {
  const view = h(`<div class="screen auth">
    <header class="bar">${brand()}<div class="bar-right">${soundButton()}</div></header>
    <main class="auth-grid">
      <section class="auth-copy">
        <div class="chip live-chip"><i class="live-dot"></i>Live now · Dlicom Grand Prix</div>
        <h1 class="hero-title">
          <span class="w" style="--i:0">Race.</span> <span class="w" style="--i:1">Drift.</span><br>
          <span class="w hl" style="--i:2">Beat the</span> <span class="w hl" style="--i:3">Custodians.</span>
        </h1>
        <p class="lead rise" style="--i:4">A 3D kart racer from the Dlicom universe. Claim your handle, keep every score, and climb the global board.</p>
        <form class="panel form rise" id="form" novalidate style="--i:5">
          <div class="seg" role="tablist">
            <button type="button" data-mode="signup">Create account</button>
            <button type="button" data-mode="login">Log in</button>
          </div>
          <label class="field"><span class="at">@</span>
            <input id="handle" name="username" autocomplete="username" placeholder="your X handle" maxlength="16" spellcheck="false" autocapitalize="off" />
          </label>
          <label class="field">
            <input id="pw" name="password" type="password" placeholder="Password (${PASSWORD_MIN}+ characters)" maxlength="64" />
            <button type="button" class="eye" id="eye">Show</button>
          </label>
          <p class="msg" id="msg" role="status"></p>
          <button class="btn primary" id="submit" type="submit">Create account</button>
          <button type="button" class="link" id="guest">Just play as a guest</button>
        </form>
        <p class="fine rise" style="--i:6">No email, no wallet, no personal data — just a handle and a password.<br>Race points are for fun and have no monetary value.</p>
      </section>
      <section class="auth-stage" id="stage3d" title="Click the squad to say hi"></section>
    </main>
    <div class="live-stats rise" style="--i:7">
      <div><b data-count="8">0</b><span>racers a race</span></div>
      <div><b data-count="3">0</b><span>laps of Dili Circuit</span></div>
      <div><b id="st-players" data-count="0">0</b><span>drivers signed up</span></div>
      <div><b id="st-races" data-count="0">0</b><span>races run</span></div>
    </div>
    ${marquee()}
    <a class="scroll-hint" href="#inside">See what's inside <span>↓</span></a>
    ${landingSections()}
  </div>`);

  const form = view.querySelector<HTMLFormElement>("#form")!;
  const handleEl = view.querySelector<HTMLInputElement>("#handle")!;
  const pwEl = view.querySelector<HTMLInputElement>("#pw")!;
  const msg = view.querySelector<HTMLElement>("#msg")!;
  const submit = view.querySelector<HTMLButtonElement>("#submit")!;

  const setMode = (m: typeof mode) => {
    mode = m;
    view.querySelectorAll<HTMLElement>("[data-mode]").forEach((b) => b.classList.toggle("on", b.dataset.mode === m));
    submit.textContent = m === "signup" ? "Create account" : "Log in";
    pwEl.autocomplete = m === "signup" ? "new-password" : "current-password";
    msg.textContent = "";
    msg.className = "msg";
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
    msg.textContent = text;
    msg.className = "msg err";
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
    submit.textContent = mode === "signup" ? "Creating…" : "Logging in…";
    try {
      if (mode === "signup") await api.signup(handle, pwEl.value);
      else await api.login(handle, pwEl.value);
      sfx.start();
      intro(hub, mode === "signup");
    } catch (err) {
      fail(err instanceof Error ? err.message : "Something went wrong.");
      submit.disabled = false;
      submit.textContent = mode === "signup" ? "Create account" : "Log in";
    }
  });

  view.querySelector("#guest")!.addEventListener("click", () => {
    sfx.ui();
    api.playAsGuest();
    intro(hub);
  });

  wireCommon(view);
  show(view, true);
  stage3d = mountStage(view.querySelector<HTMLElement>("#stage3d")!, { kind: "squad", chars: ["dcoded", "dili", "dco"] }, () => sfx.pop());
  handleEl.focus({ preventScroll: true });
  cleanup = animateLanding(view);
  void api.stats().then((st) => {
    if (!st || !view.isConnected) return;
    const set = (id: string, n: number) => {
      const b = view.querySelector<HTMLElement>(id);
      if (!b) return;
      b.dataset.count = String(n);
      countUp(b, n);
    };
    set("#st-players", st.players);
    set("#st-races", st.races);
  });

  void api.serverUp().then((up) => {
    if (up || !view.isConnected) return;
    msg.textContent = "Online accounts aren't reachable right now — you can still play as a guest.";
    msg.className = "msg warn";
  });
}

/** Everything below the sign-in hero: features, squad, controls, ads, Dlicom. */
function landingSections() {
  let n = 0;
  const feature = (icon: string, title: string, text: string) =>
    `<article class="feat panel tilt" data-reveal style="--d:${n++ * 0.08}s"><div class="feat-ico">${icon}</div><h3>${title}</h3><p>${text}</p></article>`;
  const ico = {
    kart: `<svg viewBox="0 0 24 24"><path d="M3 15h18l-2-5H8L6 7H3z" fill="currentColor"/><circle cx="7" cy="17" r="2.6" fill="currentColor"/><circle cx="17" cy="17" r="2.6" fill="currentColor"/></svg>`,
    drift: `<svg viewBox="0 0 24 24"><path d="M4 18c4-1 7-4 8-8s4-6 8-6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><circle cx="6" cy="20" r="1.6" fill="#6fb2ff"/><circle cx="9" cy="19" r="1.3" fill="#ffae3d"/><circle cx="12" cy="17" r="1.1" fill="#d59bff"/></svg>`,
    items: `<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="4" fill="currentColor"/><text x="12" y="17" text-anchor="middle" font-size="13" font-weight="900" fill="#05060d" font-family="Inter">?</text></svg>`,
    board: ICON.trophy,
  };
  const squad = CHAR_IDS.map((id, k) => `<article class="mate panel tilt" data-reveal style="--d:${k * 0.1}s">
      <div class="mate-pic">${face(id)}</div>
      <h3>${CHAR_INFO[id].name}</h3>
      <span class="tag">${CHAR_INFO[id].rarity}</span>
      <p>${id === "dili" ? "Dlicom's delivery hero. Brave, fast and always smiling." : id === "dcoded" ? "Reads the fine print so you don't have to. Unlocks at 3,000 points." : "Ultra-rare. Only seven of them exist. Unlocks at 12,000 points."}</p>
    </article>`).join("");
  return `
    <section class="land" id="inside">
      <div class="land-head" data-reveal><div class="chip">What's inside</div><h2>Built like a real <span>kart racer.</span></h2></div>
      <div class="feats">
        ${feature(ico.kart, "Real 3D karts", "Every kart, driver and Custodian is modelled in 3D — with drifts, jumps and a cape glide over the lake.")}
        ${feature(ico.drift, "Drift for turbo", "Hold a turn to drift. Sparks go blue, orange, then purple — let go for a boost.")}
        ${feature(ico.items, "Items & rivals", "DLI Rocket, D-Shield, Coin Magnet, Freeze Zap. The Custodians fight back with goo and freeze orbs.")}
        ${feature(ico.board, "Global leaderboard", "Every race is saved to your account. Climb from Rookie to Founder.")}
      </div>
    </section>
    <section class="land">
      <div class="land-head" data-reveal><div class="chip">The squad</div><h2>Pick your <span>driver.</span></h2></div>
      <div class="mates">${squad}</div>
    </section>
    <section class="land">
      <div class="land-head" data-reveal><div class="chip">How to play</div><h2>Arrows. <span>That's it.</span></h2></div>
      <div class="keys panel" data-reveal>
        <div><span class="kc k1">←</span><span class="kc k2">→</span><b>Steer</b></div>
        <div><span class="kc wide k3">hold</span><b>Drift, then let go for turbo</b></div>
        <div><span class="kc k4">↑</span><b>Gas</b></div>
        <div><span class="kc k5">↓</span><b>Fire your item</b></div>
        <div><span class="kc wide">Esc</span><b>Pause</b></div>
        <p>On a phone, big on-screen arrows appear automatically.</p>
      </div>
    </section>
    <section class="land">
      <div class="ad panel" data-reveal>
        <div class="ad-copy">
          <div class="chip">Advertise in Dili Cart</div>
          <h2>Your ad on a stadium billboard. <span>$5.</span></h2>
          <p>Put your ad or post in front of every racer, on the big boards around the track. Reach out to <b>@00xmado</b> on X for details.</p>
          <a class="btn primary" href="https://x.com/00xmado" target="_blank" rel="noopener">DM @00xmado on X</a>
        </div>
        <div class="ad-board" aria-hidden="true">
          <div class="ad-screen"><span class="ad-bubble">YOUR AD HERE</span><b>$5</b><small>DM @00xmado on X</small><em class="scan"></em></div>
          <i></i><i></i>
        </div>
      </div>
    </section>
    <section class="land">
      <div class="about panel" data-reveal>
        <div class="brand big">${appIcon("lg")}<span class="brand-text"><b>Dlicom</b></span></div>
        <h2>One app for your whole crypto life.</h2>
        <p>Encrypted messages, a social feed, DliClips, communities — and a wallet built right in, on Base. You hold your own keys.</p>
        <div class="tge"><span class="bubble">$DLI TGE</span><span>The token generation event is scheduled for <b>2027</b>. Follow <a href="https://x.com/DlicomApp" target="_blank" rel="noopener">@DlicomApp</a> for the date.</span></div>
      </div>
    </section>
    <footer class="foot">Dili Cart · made for the Dlicom AI Game Jam · Race points are for fun and have no monetary value.</footer>`;
}

/** The scrolling LED ticker from the stadium, as a band across the page. */
function marquee() {
  const items = [
    ["DLICOM", ""], ["$DLI TGE 2027", "y"], ["DILI CART", "b"], ["YOUR AD HERE · $5 · DM @00xmado", "p"],
    ["HOLD YOUR KEYS", "t"], ["BEAT THE CUSTODIANS", ""], ["DRIFT FOR TURBO", "y"],
  ];
  const row = items.map(([t, c]) => `<span class="${c}">${t}</span><i>◆</i>`).join("");
  return `<div class="marquee" aria-hidden="true"><div class="mq-track">${row}${row}</div></div>`;
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

/**
 * Landing motion: sections rise in as they scroll into view, cards tilt
 * toward the pointer with a glow that follows it, stats count up.
 */
function animateLanding(view: HTMLElement) {
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add("in");
      io.unobserve(e.target);
    }
  }, { threshold: 0.18 });
  view.querySelectorAll("[data-reveal]").forEach((el) => io.observe(el));

  const stats = view.querySelector(".live-stats");
  if (stats) {
    const so = new IntersectionObserver(([e]) => {
      if (!e?.isIntersecting) return;
      so.disconnect();
      stats.querySelectorAll<HTMLElement>("[data-count]").forEach((b) => countUp(b, Number(b.dataset.count)));
    });
    so.observe(stats);
  }

  const fine = matchMedia("(pointer: fine)").matches;
  const onMove = (e: PointerEvent) => {
    const card = (e.target as HTMLElement).closest<HTMLElement>(".tilt");
    if (!card) return;
    const r = card.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    card.style.setProperty("--mx", `${x * 100}%`);
    card.style.setProperty("--my", `${y * 100}%`);
    card.style.setProperty("--ry", `${(x - 0.5) * 10}deg`);
    card.style.setProperty("--rx", `${(0.5 - y) * 8}deg`);
  };
  const onLeave = (e: PointerEvent) => {
    const card = (e.target as HTMLElement).closest<HTMLElement>(".tilt");
    if (card && !card.contains(e.relatedTarget as Node)) { card.style.removeProperty("--rx"); card.style.removeProperty("--ry"); }
  };
  if (fine) {
    view.addEventListener("pointermove", onMove);
    view.addEventListener("pointerout", onLeave);
  }

  // The hero drifts up and fades as you scroll into the sections.
  const hero = view.querySelector<HTMLElement>(".auth-grid");
  const onScroll = () => {
    if (!hero) return;
    const y = view.scrollTop;
    hero.style.setProperty("--scroll", String(Math.min(1, y / 600)));
    liveEl.style.setProperty("--scroll", String(Math.min(1, y / 700)));
  };
  view.addEventListener("scroll", onScroll, { passive: true });
  return () => {
    io.disconnect();
    liveEl.style.removeProperty("--scroll");
  };
}

/* ================================================================== */
/* Hub                                                                 */
/* ================================================================== */

/** Small line glyphs for the hub's stat tiles and cards. */
const GLYPH = {
  star: `<svg viewBox="0 0 24 24"><path d="m12 3.5 2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.8l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z" fill="currentColor"/></svg>`,
  gem: `<svg viewBox="0 0 24 24"><path d="M12 3 21 12l-9 9-9-9z" fill="currentColor" opacity=".35"/><path d="m12 7.5 4.5 4.5-4.5 4.5L7.5 12z" fill="currentColor"/></svg>`,
  crown: `<svg viewBox="0 0 24 24"><path d="M4 8l4 3.5L12 5l4 6.5L20 8l-1.6 10H5.6z" fill="currentColor"/></svg>`,
  clock: `<svg viewBox="0 0 24 24"><circle cx="12" cy="13" r="7.5" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M12 9.5V13l2.5 1.8M10 3h4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>`,
  arrow: `<svg viewBox="0 0 24 24"><path d="M5 12h13M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  check: `<svg viewBox="0 0 24 24"><path d="m6 12.5 4 4 8-9" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  chevron: `<svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
};

function hub() {
  const p = api.player();
  if (!p) return auth();
  const next = nextTier(p.points);
  const floor = [...TIERS].reverse().find((t) => p.points >= t.at)?.at ?? 0;
  const tierPct = next ? Math.min(1, Math.max(0, (p.points - floor) / (next.at - floor))) : 1;

  const squad = CHAR_IDS.map((id, k) => {
    const need = CHAR_UNLOCK[id];
    const open = p.points >= need;
    const on = p.char === id;
    const pct = open ? 100 : Math.floor((p.points / need) * 100);
    return `<button class="driver glass ${on ? "on" : ""} ${open ? "" : "locked"}" data-char="${id}" style="--i:${k}; --tint:${CHAR_INFO[id].color}" ${open ? "" : "aria-disabled=\"true\""}>
      <span class="pic">${face(id)}${open ? "" : `<i class="lock">${ICON.lock}</i>`}</span>
      <b>${CHAR_INFO[id].name}</b>
      <small>${open ? CHAR_INFO[id].rarity : `${fmt(need)} pts`}</small>
      ${open ? "" : `<span class="bar"><i style="width:${pct}%"></i></span>`}
      <i class="tick">${GLYPH.check}</i>
    </button>`;
  }).join("");

  const stat = (k: number, icon: string, tone: string, value: string, count: number | null, label: string) =>
    `<div class="stat glass rise" style="--i:${4 + k * 0.5}; --tone:${tone}"><i>${icon}</i><b ${count !== null ? `data-count="${count}"` : ""}>${count !== null ? "0" : value}</b><span>${label}</span></div>`;

  // Letters of the wordmark, each with its own spring-in and shine.
  const letters = (word: string, from: number) =>
    [...word].map((c, i) => `<span class="wm-l" style="--i:${from + i}" data-l="${c}">${c}</span>`).join("");

  const streakLine = p.streak >= 2
    ? `You're on a <b>${p.streak}-day</b> streak. Race daily for up to <b>2×</b> points.`
    : `Race every day to build a streak: up to <b>2×</b> points by day seven.`;
  const news = [
    p.guest ? { tag: "Guest mode", tone: "#6fb2ff", html: `Scores stay on this device. <button class="link" id="claim2">Create an account</button> to join the global board.` } : null,
    { tag: "$DLI TGE", tone: "#ffd84a", html: `The Dlicom token generation event is scheduled for <b>2027</b>. Follow <a href="https://x.com/DlicomApp" target="_blank" rel="noopener">@DlicomApp</a> for the date.` },
    { tag: "Daily streak", tone: "#ff7ad9", html: streakLine },
    { tag: "Ad space · $5", tone: "#5fe3a1", html: `Your ad on a stadium billboard, in front of every racer. DM <a href="https://x.com/00xmado" target="_blank" rel="noopener">@00xmado</a> on X.` },
  ].filter((x): x is { tag: string; tone: string; html: string } => !!x);

  const view = h(`<div class="screen hub">
    <header class="bar hub-bar">${brand()}
      <div class="bar-right">
        ${soundButton()}
        ${canFullscreen() ? `<button class="iconbtn" data-act="full" title="Fullscreen" aria-label="Fullscreen">${ICON.full}</button>` : ""}
        <div class="who glass">
          <span class="who-pic" style="--p:${tierPct.toFixed(3)}"><span>${face(p.char)}</span></span>
          <span class="who-name"><b>${p.guest ? "Guest" : "@" + esc(p.handle)}</b><small>${p.tier}${next ? ` · ${fmt(next.at - p.points)} to ${next.name}` : " · top tier"}</small></span>
          <button class="pill-btn" id="out">${p.guest ? "Sign up" : "Log out"}</button>
        </div>
      </div>
    </header>
    <main class="hub-grid">
      <section class="hub-copy">
        <div class="chip live-chip rise" style="--i:1"><i class="live-dot"></i>Dlicom Grand Prix · 3 laps · 8 racers</div>
        <h1 class="wm" aria-label="Dili Cart">
          <span class="wm-row" aria-hidden="true">${letters("DILI", 0)}</span>
          <span class="wm-row wm-gold" aria-hidden="true">${letters("CART", 4)}</span>
        </h1>
        <p class="lead rise" style="--i:3">Seven Custodians want the crown. Drift, boost, glide over the lake — and bring it home for Dlicom.</p>
        <div class="stats">
          ${stat(0, GLYPH.star, "#ffd84a", "—", p.best ? p.best : null, "Best score")}
          ${stat(1, GLYPH.gem, "#8fa8ff", "0", p.points, "Points")}
          ${stat(2, GLYPH.crown, "#ff9f5a", "0", p.wins, "Wins")}
          ${stat(3, GLYPH.clock, "#5fe3c1", fmtTime(p.bestTime), null, "Best time")}
        </div>
        <div class="race-wrap rise" style="--i:6">
          <span class="rb-glow" aria-hidden="true"></span>
          <button class="race-btn" id="race">
            <span class="rb-icon" aria-hidden="true">${FLAG}</span>
            <span class="rb-text"><b>Race</b><small>Dili Circuit · 3 laps</small></span>
            <span class="rb-go" aria-hidden="true"><kbd>Enter ↵</kbd><i class="rb-arrow">${GLYPH.arrow}</i></span>
            <i class="rb-shine" aria-hidden="true"></i>
          </button>
        </div>
        <div class="cta rise" style="--i:7">
          <button class="btn ghost sm" id="board">${ICON.trophy} Leaderboard</button>
          ${p.guest ? `<button class="btn ghost sm" id="claim">Create account</button>` : ""}
        </div>
      </section>
      <section class="hub-stage">
        <div class="stage3d" id="stage3d" title="Drag to spin · click to wave"></div>
        <div class="squad rise" style="--i:5"><p class="eyebrow">Choose your driver <span>← →</span></p><div class="drivers">${squad}</div></div>
      </section>
      <aside class="hub-side">
        <div class="mini-board glass rise" style="--i:4">
          <div class="mini-head"><b>Top racers</b><button class="link" id="board2">See all ${GLYPH.chevron}</button></div>
          <ol id="mini"><li class="muted">Loading…</li></ol>
        </div>
        <div class="news glass rise" style="--i:6" aria-live="polite">
          <div class="news-slides">${news.map((n, i) => `<div class="news-slide ${i ? "" : "on"}" style="--tone:${n.tone}"><span class="news-tag">${n.tag}</span><p>${n.html}</p></div>`).join("")}</div>
          <div class="news-dots">${news.map((_, i) => `<button class="${i ? "" : "on"}" aria-label="Show news ${i + 1}"><i></i></button>`).join("")}</div>
        </div>
      </aside>
    </main>
  </div>`);

  let leaving = false;
  const go = () => {
    if (leaving) return;
    leaving = true;
    sfx.start();
    view.classList.add("launch");
    setTimeout(race, calm ? 0 : 320);
  };
  const raceBtn = view.querySelector<HTMLButtonElement>("#race")!;
  raceBtn.addEventListener("click", go);
  for (const id of ["#board", "#board2"]) view.querySelector(id)?.addEventListener("click", () => { sfx.ui(); void board("best"); });
  view.querySelector("#out")!.addEventListener("click", async () => {
    sfx.ui();
    if (p.guest) return auth("signup");
    await api.logout();
    auth("login");
  });
  for (const id of ["#claim", "#claim2"]) view.querySelector(id)?.addEventListener("click", () => { sfx.ui(); auth("signup"); });

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
  const drivers = [...view.querySelectorAll<HTMLElement>("[data-char]")];
  drivers.forEach((b) => b.addEventListener("click", () => void pick(b)));

  wireCommon(view);
  show(view, true);
  stage3d = mountStage(view.querySelector<HTMLElement>("#stage3d")!, { kind: "kart", char: p.char }, () => sfx.pop());

  // Enter races; ← → flip through the unlocked drivers.
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter") go();
    else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      const open = drivers.filter((d) => !d.classList.contains("locked"));
      const at = open.findIndex((d) => d.classList.contains("on"));
      const nextD = open[(at + (e.key === "ArrowRight" ? 1 : open.length - 1)) % open.length];
      if (nextD && open.length > 1) void pick(nextD);
    }
  };
  addEventListener("keydown", onKey);
  const stopMotion = animateHub(view, raceBtn);
  const stopNews = rotateNews(view);
  cleanup = () => { removeEventListener("keydown", onKey); stopMotion(); stopNews(); };

  // Numbers count up once the tiles have landed.
  setTimeout(() => view.querySelectorAll<HTMLElement>(".stat [data-count]").forEach((b) => countUp(b, Number(b.dataset.count), 1100)), calm ? 0 : 450);

  void miniBoard(view.querySelector<HTMLElement>("#mini")!, p);
  // Races that finished offline get sent now; refresh the board if any did.
  if (!p.guest && api.pendingCount()) {
    void api.syncPending().then((n) => { if (n && view.isConnected) hub(); });
  }
}

/**
 * Hub motion: the layers drift against each other with the pointer, glass
 * catches a highlight where the pointer is, and the Race button leans
 * toward it and ripples when pressed.
 */
function animateHub(view: HTMLElement, btn: HTMLElement) {
  const fine = matchMedia("(pointer: fine)").matches && !calm;
  let raf = 0, tx = 0, ty = 0, x = 0, y = 0;
  const loop = () => {
    x += (tx - x) * 0.08;
    y += (ty - y) * 0.08;
    view.style.setProperty("--px", x.toFixed(4));
    view.style.setProperty("--py", y.toFixed(4));
    liveEl.style.setProperty("--px", x.toFixed(4));
    liveEl.style.setProperty("--py", y.toFixed(4));
    raf = Math.abs(tx - x) + Math.abs(ty - y) > 0.001 ? requestAnimationFrame(loop) : 0;
  };
  const onMove = (e: PointerEvent) => {
    tx = (e.clientX / innerWidth) * 2 - 1;
    ty = (e.clientY / innerHeight) * 2 - 1;
    if (!raf) raf = requestAnimationFrame(loop);
    const card = (e.target as HTMLElement).closest<HTMLElement>(".glass");
    if (card) {
      const r = card.getBoundingClientRect();
      card.style.setProperty("--mx", `${e.clientX - r.left}px`);
      card.style.setProperty("--my", `${e.clientY - r.top}px`);
    }
  };
  const onBtnMove = (e: PointerEvent) => {
    const r = btn.getBoundingClientRect();
    const dx = (e.clientX - r.left) / r.width - 0.5, dy = (e.clientY - r.top) / r.height - 0.5;
    btn.style.setProperty("--tx", `${dx * 8}px`);
    btn.style.setProperty("--ty", `${dy * 6}px`);
    btn.style.setProperty("--ry", `${dx * 6}deg`);
    btn.style.setProperty("--rx", `${-dy * 8}deg`);
    btn.style.setProperty("--sx", `${e.clientX - r.left}px`);
    btn.style.setProperty("--sy", `${e.clientY - r.top}px`);
  };
  const onBtnLeave = () => { for (const k of ["--tx", "--ty", "--rx", "--ry"]) btn.style.removeProperty(k); };
  const ripple = (e: PointerEvent) => {
    const r = btn.getBoundingClientRect();
    const d = document.createElement("i");
    d.className = "rb-ripple";
    d.style.left = `${e.clientX - r.left}px`;
    d.style.top = `${e.clientY - r.top}px`;
    btn.appendChild(d);
    d.addEventListener("animationend", () => d.remove());
  };
  if (fine) {
    view.addEventListener("pointermove", onMove);
    btn.addEventListener("pointermove", onBtnMove);
    btn.addEventListener("pointerleave", onBtnLeave);
  }
  btn.addEventListener("pointerdown", ripple);
  return () => {
    cancelAnimationFrame(raf);
    liveEl.style.removeProperty("--px");
    liveEl.style.removeProperty("--py");
  };
}

/**
 * The news card flips to its next story when the active dot's progress bar
 * fills; hovering the card pauses the bar, and the dots jump straight to a story.
 */
function rotateNews(view: HTMLElement) {
  const slides = [...view.querySelectorAll<HTMLElement>(".news-slide")];
  const dots = [...view.querySelectorAll<HTMLElement>(".news-dots button")];
  const card = view.querySelector<HTMLElement>(".news");
  if (!card || slides.length < 2) return () => {};
  let at = 0;
  const set = (i: number) => {
    at = (i + slides.length) % slides.length;
    slides.forEach((s, k) => s.classList.toggle("on", k === at));
    dots.forEach((d, k) => d.classList.toggle("on", k === at));
  };
  dots.forEach((d, k) => d.addEventListener("click", () => { sfx.ui(); set(k); }));
  card.addEventListener("pointerenter", () => card.classList.add("hold"));
  card.addEventListener("pointerleave", () => card.classList.remove("hold"));
  card.addEventListener("animationend", (e) => { if ((e.target as HTMLElement).parentElement?.classList.contains("on")) set(at + 1); });
  // With reduced motion there's no progress bar to wait on.
  const id = calm ? setInterval(() => set(at + 1), 6000) : 0;
  return () => clearInterval(id);
}

async function miniBoard(el: HTMLElement, p: api.Player) {
  try {
    const { entries, me } = await api.leaderboard("best");
    if (!el.isConnected) return;
    if (!entries.length) {
      el.innerHTML = `<li class="muted">No races yet. Be the first on the board.</li>`;
      return;
    }
    el.innerHTML = entries.slice(0, 5).map((e, i) => `<li class="${e.handle === p.handle && !p.guest ? "me" : ""}" style="--i:${i}">
      <i>${i + 1}</i><span>@${esc(e.handle)}</span><b>${fmt(e.best)}</b></li>`).join("")
      + (me && me.rank > 5 ? `<li class="me" style="--i:5"><i>${me.rank}</i><span>You</span><b>${fmt(me.value)}</b></li>` : "");
  } catch {
    if (el.isConnected) el.innerHTML = `<li class="muted">The global board is offline right now.</li>`;
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
  // Logged in from last time: Dili says hello once per visit, then the hub.
  if (!p) auth();
  else if (!greetedThisSession()) intro(hub, false);
  else hub();
})();
