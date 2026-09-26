import { sfx } from "../engine/audio";
import type { Pose } from "../kart/mascot";

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
}

/**
 * Dili Boy introduces Dlicom and the race. The token line sticks to the
 * official announcement: a year, no promises.
 */
const BEATS: Beat[] = [
  { pose: "wave", text: "" },   // the greeting, written for whoever just logged in
  {
    pose: "talk",
    text: "Dlicom is one app for your whole crypto life — encrypted messages, a social feed, DliClips, communities, and a wallet built right in.",
  },
  { pose: "point", text: "And the big one: the $DLI Token Generation Event is scheduled for 2027.\nThe exact date comes later — follow @DlicomApp." },
  { pose: "talk", text: "The Custodians want to hold everyone's keys. With Dlicom, you hold your own.\nSo today, they're racing me for the crown." },
  { pose: "point", text: "← → steer. Hold a turn to drift, let go for a turbo.\n↑ is gas, ↓ fires your item. Hit the ramp and I glide." },
  { pose: "cheer", text: "Grab coins, smash item boxes, beat all seven Custodians over three laps.\nLet's race!" },
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
        <div class="say-name">Dili Boy <span>· Dlicom</span></div>
        <div class="say-bubble"><p id="text"></p></div>
        <button class="btn primary intro-next" id="next">Next</button>
      </div>
    </div>
    <p class="fine">Click, tap or press Enter to continue.</p>`;

  const textEl = view.querySelector<HTMLElement>("#text")!;
  const nextEl = view.querySelector<HTMLButtonElement>("#next")!;
  const dotsEl = view.querySelector<HTMLElement>("#dots")!;
  const skipEl = view.querySelector<HTMLElement>("#skip")!;

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
    showNext();
  }

  function showNext() {
    nextEl.classList.add("on");
    nextEl.textContent = i === beats.length - 1 ? "Let's race!" : "Next";
  }

  function type(full: string, at: number) {
    if (at >= full.length) {
      typing = false;
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
    const bubble = view.querySelector<HTMLElement>(".say-bubble")!;
    bubble.classList.remove("pop");
    void bubble.offsetWidth;
    bubble.classList.add("pop");
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
