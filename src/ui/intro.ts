import { sfx } from "../engine/audio";
import type { Pose } from "../kart/mascot";
import type { Prop } from "./stage3d";
import { MASCOT } from "../kart/mascot";
import { portrait } from "./icons";

const SEEN_KEY = "dlicom.arcade.intro.v3";
/** Set once Dili has greeted this browser tab, so a reload goes straight in. */
const SESSION_KEY = "dilicart.intro.session";

export function hasSeenIntro(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

/** Has Dili already said hello in this browser session? */
export function greetedThisSession(): boolean {
  try {
    return sessionStorage.getItem(SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

function markSeen() {
  try {
    localStorage.setItem(SEEN_KEY, "1");
    sessionStorage.setItem(SESSION_KEY, "1");
  } catch {
    /* private mode — they'll just see it again, which is harmless */
  }
}

export interface IntroWho {
  /** The player's handle, or null for a guest. */
  handle: string | null;
  /** True right after sign-up, false after a log-in; unset = go by this browser. */
  isNew?: boolean;
}

interface Beat {
  pose: Pose;
  text: string;
  /** Small caption over the line. */
  title: string;
  /** What pops up beside Dili while he says it. */
  prop: Prop;
  /** Little tags under the line: [label, colour]. */
  chips?: [string, string][];
}

/**
 * Dili Boy introduces Dlicom and the race. The token line sticks to the
 * official announcement: a year, no promises.
 */
const BEATS: Beat[] = [
  { pose: "wave", title: "Welcome", prop: "none", text: "" },   // the greeting, written for whoever just logged in
  {
    pose: "present", title: "What's Dlicom?", prop: "phone",
    text: "Dlicom is one app for your whole crypto life — encrypted messages, a social feed, DliClips, communities, and a wallet built right in.",
    chips: [["Messages", "#3d63ff"], ["Feed", "#e447d2"], ["DliClips", "#ff6a3d"], ["Wallet", "#ffc21a"]],
  },
  {
    pose: "point", title: "$DLI", prop: "coin",
    text: "And the big one: the $DLI Token Generation Event is scheduled for 2027.\nThe exact date comes later — follow @DlicomApp.",
    chips: [["TGE 2027", "#ffc21a"], ["@DlicomApp", "#3d63ff"]],
  },
  {
    pose: "think", title: "The Custodians", prop: "custodian",
    text: "The Custodians want to hold everyone's keys. With Dlicom, you hold your own.\nSo today, they're racing me for the crown.",
    chips: [["Self-custody", "#2fd872"], ["7 rivals", "#ff3048"]],
  },
  {
    pose: "talk", title: "How to drive", prop: "keys",
    text: "← → steer. Hold a turn to drift, let go for a turbo.\n↑ is gas, ↓ fires your item. Hit the ramp and I glide.",
    chips: [["Drift = turbo", "#2ee6ff"], ["Items: ↓", "#ffd84a"], ["Coins → shop", "#ffc21a"]],
  },
  {
    pose: "cheer", title: "Race day", prop: "kart",
    text: "Grab coins, smash item boxes, beat all seven Custodians.\nDili Circuit or Neon Town at night — let's race!",
    chips: [["Dili Circuit", "#ffb45c"], ["Neon Town", "#ff3fa4"]],
  },
];

/** Typing rhythm: punctuation gets a beat, line breaks a longer one. */
function delayFor(ch: string): number {
  if (ch === "\n") return 110;
  if (".!?".includes(ch)) return 170;
  if (",;—".includes(ch)) return 80;
  return 16;
}

/** Dili's first line: by name, and "welcome back" for people he's met. */
function greeting(who: IntroWho) {
  const name = who.handle ? `@${who.handle}` : "racer";
  const back = who.isNew === undefined ? hasSeenIntro() : !who.isNew;
  return back
    ? `Welcome back, ${name}! Dili Boy here.\nThe Dlicom Grand Prix is waiting for you.`
    : `Hey ${name}! I'm Dili Boy.\nWelcome to the Dlicom Grand Prix!`;
}

export function buildIntro(onDone: () => void, who: IntroWho = { handle: null }): HTMLElement {
  const beats = BEATS.map((b, n) => (n === 0 ? { ...b, text: greeting(who) } : b));
  let i = 0;
  let typing = false;
  let timer = 0;
  let blips = 0;

  const view = document.createElement("div");
  view.className = "screen intro";
  view.tabIndex = -1;
  view.innerHTML = `
    <div class="intro-top">
      <div class="intro-dots" id="dots">${beats.map(() => "<i></i>").join("")}</div>
      <button class="intro-skip" id="skip">Skip intro <kbd>Esc</kbd></button>
    </div>
    <div class="intro-body">
      <div class="intro-3d" id="intro3d" title="Click Dili"></div>
      <div class="intro-say">
        <div class="say-card">
          <div class="say-head">
            <span class="say-avatar" aria-hidden="true">${portrait(MASCOT.dili.head, MASCOT.dili.dome, MASCOT.dili.mouth)}</span>
            <span class="say-who"><b>Dili Boy</b><small>Dlicom mascot · your co-driver</small></span>
            <span class="say-step" id="step"></span>
          </div>
          <div class="say-title" id="title"></div>
          <p id="text" class="say-text"></p>
          <div class="say-chips" id="chips"></div>
          <div class="say-foot">
            <span class="say-hint">Tap or press <kbd>Enter</kbd></span>
            <button class="say-next" id="next">Next <svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
          </div>
        </div>
      </div>
    </div>
    `;

  const textEl = view.querySelector<HTMLElement>("#text")!;
  const nextEl = view.querySelector<HTMLButtonElement>("#next")!;
  const dotsEl = view.querySelector<HTMLElement>("#dots")!;
  const skipEl = view.querySelector<HTMLElement>("#skip")!;
  const titleEl = view.querySelector<HTMLElement>("#title")!;
  const stepEl = view.querySelector<HTMLElement>("#step")!;
  const chipsEl = view.querySelector<HTMLElement>("#chips")!;

  function finish() {
    window.clearTimeout(timer);
    removeEventListener("keydown", onKey);
    markSeen();
    onDone();
  }

  function completeLine() {
    window.clearTimeout(timer);
    typing = false;
    textEl.textContent = beats[i].text;
    view.dispatchEvent(new CustomEvent("intro:speak", { detail: false }));
    showNext();
  }

  function showNext() {
    nextEl.classList.add("on");
    nextEl.firstChild!.textContent = i === beats.length - 1 ? "Let's race! " : "Next ";
    chipsEl.querySelectorAll("span").forEach((c, n) => setTimeout(() => c.classList.add("on"), n * 90));
  }

  function type(full: string, at: number) {
    if (at >= full.length) {
      typing = false;
      view.dispatchEvent(new CustomEvent("intro:speak", { detail: false }));
      showNext();
      view.dispatchEvent(new CustomEvent("intro:pose", { detail: beats[i].pose === "talk" ? "idle" : beats[i].pose }));
      return;
    }
    const ch = full[at];
    textEl.textContent = full.slice(0, at + 1);
    if (++blips % 3 === 0 && ch.trim()) sfx.type();
    timer = window.setTimeout(() => type(full, at + 1), delayFor(ch));
  }

  function render() {
    const beat = beats[i];
    dotsEl.querySelectorAll("i").forEach((d, n) => d.classList.toggle("on", n <= i));
    view.dispatchEvent(new CustomEvent("intro:pose", { detail: beat.pose === "wave" || beat.pose === "cheer" ? beat.pose : "talk" }));
    view.dispatchEvent(new CustomEvent("intro:prop", { detail: beat.prop }));
    view.dispatchEvent(new CustomEvent("intro:speak", { detail: true }));
    const card = view.querySelector<HTMLElement>(".say-card")!;
    card.classList.remove("pop");
    void card.offsetWidth;
    card.classList.add("pop");
    titleEl.textContent = beat.title;
    stepEl.textContent = `${i + 1} / ${beats.length}`;
    chipsEl.innerHTML = (beat.chips ?? []).map(([t, c]) => `<span style="--c:${c}">${t}</span>`).join("");
    nextEl.classList.remove("on");
    textEl.textContent = "";
    typing = true;
    type(beat.text, 0);
  }

  function advance() {
    if (typing) return completeLine();
    if (i >= beats.length - 1) return finish();
    i += 1;
    sfx.ui();
    render();
  }

  const onKey = (e: KeyboardEvent) => {
    if (!view.isConnected) return removeEventListener("keydown", onKey);
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); advance(); }
    if (e.key === "Escape") finish();
  };
  addEventListener("keydown", onKey);

  nextEl.addEventListener("click", (e) => { e.stopPropagation(); advance(); });
  skipEl.addEventListener("click", (e) => { e.stopPropagation(); sfx.ui(); finish(); });
  view.querySelector(".intro-say")!.addEventListener("click", advance);

  // Wait a frame so the 3D stage is mounted before the first pose fires.
  requestAnimationFrame(render);
  return view;
}
