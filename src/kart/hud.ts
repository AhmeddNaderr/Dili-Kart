import "./hud.css";

/**
 * The race HUD: plain DOM over the WebGL canvas, laid out like the kart
 * games it's modelled on and finished like a native app: frosted-glass
 * panels, system type, spring motion. Item slot top-left, minimap
 * top-right, coins and score bottom-left, position bottom-right.
 */

export type ItemKind = "turbo" | "shield" | "magnet" | "zap" | "seeker" | "ghost" | "goo";

export const ITEM_NAME: Record<ItemKind, string> = {
  turbo: "DLI Rocket", shield: "D-Shield", magnet: "Coin Magnet", zap: "Freeze Zap",
  seeker: "Seeker Orb", ghost: "Ghost Mode", goo: "Goo Bomb",
};

/**
 * Power-up art: glossy, lit-from-the-top illustrations in the style of an
 * app icon. Each has its own gradient ids so they can sit side by side.
 */
const ICON: Record<ItemKind, string> = {
  turbo: `<svg viewBox="0 0 64 64"><defs>
      <linearGradient id="it-body" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ffffff"/><stop offset=".6" stop-color="#e3e9ff"/><stop offset="1" stop-color="#9eaae0"/></linearGradient>
      <linearGradient id="it-fin" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7d97ff"/><stop offset="1" stop-color="#2537c9"/></linearGradient>
      <linearGradient id="it-nose" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff8a9b"/><stop offset="1" stop-color="#e3143f"/></linearGradient>
      <radialGradient id="it-fl" cx=".5" cy=".15" r=".85"><stop offset="0" stop-color="#ffffff"/><stop offset=".3" stop-color="#fff0a0"/><stop offset=".62" stop-color="#ffab1f"/><stop offset="1" stop-color="#ff3d6e" stop-opacity="0"/></radialGradient>
      <radialGradient id="it-win" cx=".35" cy=".3"><stop offset="0" stop-color="#8fd0ff"/><stop offset="1" stop-color="#1a2a9a"/></radialGradient>
    </defs>
    <g stroke="#fff" stroke-width="2.4" stroke-linecap="round" opacity=".55"><path d="M6 40l8-8M4 50l10-10M13 56l8-8"/></g>
    <g transform="rotate(45 32 32)">
      <path d="M24 44c0 10 4 18 8 20 4-2 8-10 8-20z" fill="url(#it-fl)"/>
      <path d="M22 34 11 47l1 3 12-4zM42 34l11 13-1 3-12-4z" fill="url(#it-fin)"/>
      <path d="M32 3c9 6 12 17 11 29l-1 13H22l-1-13C20 20 23 9 32 3z" fill="url(#it-body)"/>
      <path d="M32 3c5 3.5 8 8.5 9.6 14H22.4C24 11.5 27 6.5 32 3z" fill="url(#it-nose)"/>
      <rect x="23" y="43" width="18" height="5" rx="2.5" fill="#2b3160"/>
      <rect x="30" y="36" width="4" height="15" rx="2" fill="url(#it-fin)"/>
      <circle cx="32" cy="27" r="6.4" fill="url(#it-win)" stroke="#fff" stroke-width="2.6"/>
      <circle cx="30" cy="25" r="1.8" fill="#fff" opacity=".85"/>
      <path d="M26.5 17c-1.6 6-1.8 14-1 22" stroke="#fff" stroke-width="2.4" stroke-linecap="round" fill="none" opacity=".9"/>
    </g></svg>`,
  shield: `<svg viewBox="0 0 64 64"><defs>
      <linearGradient id="is-rim" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#8cc4ff"/></linearGradient>
      <linearGradient id="is-body" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6ff0ff"/><stop offset=".5" stop-color="#2f7bff"/><stop offset="1" stop-color="#4a2bd6"/></linearGradient>
      <radialGradient id="is-glow"><stop offset="0" stop-color="#5ec8ff" stop-opacity=".55"/><stop offset="1" stop-color="#5ec8ff" stop-opacity="0"/></radialGradient>
    </defs>
    <circle cx="32" cy="33" r="31" fill="url(#is-glow)"/>
    <path d="M32 3 55 11.5V30c0 15-10 25.5-23 31C19 55.5 9 45 9 30V11.5z" fill="url(#is-rim)"/>
    <path d="M32 8.4 50 15v15c0 11.8-7.6 20.4-18 25.4C21.6 50.4 14 41.8 14 30V15z" fill="url(#is-body)"/>
    <path d="M32 8.4 50 15v8.6c-10-2.4-24 .6-36 7.6V15z" fill="#fff" opacity=".22"/>
    <path d="M24.5 21.5h8.6c6.4 0 10.4 4 10.4 10.2S39.5 42 33.1 42h-8.6zm6.2 5.3v9.9h2.2c2.8 0 4.5-1.8 4.5-4.9s-1.7-5-4.5-5z" fill="#fff"/>
  </svg>`,
  magnet: `<svg viewBox="0 0 64 64"><defs>
      <linearGradient id="im-red" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff8595"/><stop offset=".5" stop-color="#ff2d55"/><stop offset="1" stop-color="#b80f38"/></linearGradient>
      <linearGradient id="im-tip" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#aeb8d4"/></linearGradient>
      <radialGradient id="im-coin" cx=".35" cy=".3"><stop offset="0" stop-color="#fff6b8"/><stop offset=".6" stop-color="#ffc21f"/><stop offset="1" stop-color="#e08600"/></radialGradient>
    </defs>
    <g fill="none" stroke="#ffd84a" stroke-width="2.2" stroke-linecap="round" opacity=".85"><path d="M19 9.5c2.2-2.2 4.2-3 6-3.2M45 9.5c-2.2-2.2-4.2-3-6-3.2"/></g>
    <circle cx="11" cy="8" r="6" fill="url(#im-coin)"/><circle cx="11" cy="8" r="3.4" fill="none" stroke="#fff6b8" stroke-width="1.4"/>
    <circle cx="53" cy="8" r="6" fill="url(#im-coin)"/><circle cx="53" cy="8" r="3.4" fill="none" stroke="#fff6b8" stroke-width="1.4"/>
    <path d="M11 15h14v20a7 7 0 0 0 14 0V15h14v20a21 21 0 0 1-42 0z" fill="url(#im-red)"/>
    <rect x="11" y="15" width="14" height="9" rx="2.2" fill="url(#im-tip)"/>
    <rect x="39" y="15" width="14" height="9" rx="2.2" fill="url(#im-tip)"/>
    <path d="M15 28v7a17 17 0 0 0 7 13.7" stroke="#fff" stroke-width="3" stroke-linecap="round" fill="none" opacity=".5"/>
  </svg>`,
  zap: `<svg viewBox="0 0 64 64"><defs>
      <linearGradient id="iz-b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".45" stop-color="#a6f3ff"/><stop offset="1" stop-color="#2b9dff"/></linearGradient>
      <radialGradient id="iz-g"><stop offset="0" stop-color="#9ff0ff" stop-opacity=".7"/><stop offset="1" stop-color="#9ff0ff" stop-opacity="0"/></radialGradient>
    </defs>
    <circle cx="32" cy="32" r="30" fill="url(#iz-g)"/>
    <path d="M37.5 3 12.5 36H28l-5 25 28.5-35H35.8z" fill="url(#iz-b)" stroke="#1d5bd8" stroke-width="2.6" stroke-linejoin="round"/>
    <path d="M34.5 10 19.5 31.5" stroke="#fff" stroke-width="2.8" stroke-linecap="round"/>
    <g stroke="#fff" stroke-width="2.2" stroke-linecap="round"><path d="M52 6v12M46 12h12M47.8 7.8l8.4 8.4M56.2 7.8l-8.4 8.4"/></g>
    <g stroke="#dff9ff" stroke-width="1.8" stroke-linecap="round"><path d="M10 48v8M6 52h8"/></g>
  </svg>`,
  seeker: `<svg viewBox="0 0 64 64"><defs>
      <radialGradient id="ik-core" cx=".38" cy=".32"><stop offset="0" stop-color="#ffffff"/><stop offset=".35" stop-color="#fff0a0"/><stop offset=".75" stop-color="#ffb81c"/><stop offset="1" stop-color="#e07a00"/></radialGradient>
      <radialGradient id="ik-glow"><stop offset="0" stop-color="#ffd84a" stop-opacity=".6"/><stop offset="1" stop-color="#ffd84a" stop-opacity="0"/></radialGradient>
      <linearGradient id="ik-ring" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9fc0ff"/><stop offset="1" stop-color="#2f4dff"/></linearGradient>
    </defs>
    <circle cx="34" cy="30" r="29" fill="url(#ik-glow)"/>
    <g stroke="#fff" stroke-width="2.4" stroke-linecap="round" opacity=".6"><path d="M4 46l10-6M6 56l12-8M16 60l8-6"/></g>
    <ellipse cx="36" cy="28" rx="21" ry="8" fill="none" stroke="url(#ik-ring)" stroke-width="3.2" transform="rotate(-24 36 28)"/>
    <circle cx="36" cy="28" r="14" fill="url(#ik-core)" stroke="#fff" stroke-width="2.4"/>
    <path d="M30.5 21h5.2c4.4 0 7.3 2.8 7.3 7s-2.9 7-7.3 7h-5.2z" fill="#fff" opacity=".95"/>
    <path d="M34 24.6h1.4c2 0 3.3 1.3 3.3 3.4s-1.3 3.4-3.3 3.4H34z" fill="#ffb81c"/>
    <circle cx="31" cy="22.5" r="2.6" fill="#fff" opacity=".8"/>
    <path d="M52 8l2.4 5 5 2.4-5 2.4L52 23l-2.4-5-5-2.4 5-2.4z" fill="#fff"/>
  </svg>`,
  ghost: `<svg viewBox="0 0 64 64"><defs>
      <linearGradient id="ig-b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".55" stop-color="#d9c8ff"/><stop offset="1" stop-color="#8f6bff"/></linearGradient>
      <radialGradient id="ig-g"><stop offset="0" stop-color="#b58cff" stop-opacity=".7"/><stop offset="1" stop-color="#b58cff" stop-opacity="0"/></radialGradient>
    </defs>
    <circle cx="32" cy="32" r="30" fill="url(#ig-g)"/>
    <path d="M32 6c11 0 19 8.4 19 19.5V56l-6-4.5-6.3 5-6.7-5-6.7 5-6.3-5-6 4.5V25.5C13 14.4 21 6 32 6z" fill="url(#ig-b)" stroke="#6a4bd6" stroke-width="2.4" stroke-linejoin="round"/>
    <ellipse cx="25" cy="27" rx="4" ry="5.4" fill="#2a1a5e"/><ellipse cx="39" cy="27" rx="4" ry="5.4" fill="#2a1a5e"/>
    <circle cx="23.8" cy="25.2" r="1.5" fill="#fff"/><circle cx="37.8" cy="25.2" r="1.5" fill="#fff"/>
    <path d="M28 37q4 3 8 0" fill="none" stroke="#2a1a5e" stroke-width="2.4" stroke-linecap="round"/>
    <path d="M19 16c2.5-4 6.5-6 10-6" stroke="#fff" stroke-width="3" stroke-linecap="round" fill="none" opacity=".8"/>
  </svg>`,
  goo: `<svg viewBox="0 0 64 64"><defs>
      <radialGradient id="ib-g" cx=".35" cy=".3"><stop offset="0" stop-color="#d6ffe4"/><stop offset=".45" stop-color="#39ff9e"/><stop offset="1" stop-color="#0f9a52"/></radialGradient>
    </defs>
    <ellipse cx="32" cy="54" rx="26" ry="6" fill="#0f9a52" opacity=".45"/>
    <path d="M14 50c-6 0-6-7 0-8 1-8 6-12 10-12 1-9 7-16 14-15 7 1 10 8 9 15 6 1 9 6 8 12 6 2 5 8-1 8z" fill="url(#ib-g)" stroke="#0a7a40" stroke-width="2.4" stroke-linejoin="round"/>
    <circle cx="26" cy="38" r="3.6" fill="#0a3a22"/><circle cx="40" cy="38" r="3.6" fill="#0a3a22"/>
    <circle cx="25" cy="37" r="1.2" fill="#fff"/><circle cx="39" cy="37" r="1.2" fill="#fff"/>
    <path d="M28 45q5 3 10 0" fill="none" stroke="#0a3a22" stroke-width="2.4" stroke-linecap="round"/>
    <circle cx="33" cy="22" r="3" fill="#fff" opacity=".7"/>
    <circle cx="52" cy="14" r="4" fill="url(#ib-g)"/><circle cx="12" cy="20" r="3" fill="url(#ib-g)"/>
  </svg>`,
};


const COIN = `<svg viewBox="0 0 40 40"><defs><radialGradient id="hc-g" cx=".35" cy=".3"><stop offset="0" stop-color="#fff6b8"/><stop offset=".55" stop-color="#ffc21f"/><stop offset="1" stop-color="#e08600"/></radialGradient></defs><circle cx="20" cy="20" r="18" fill="url(#hc-g)"/><circle cx="20" cy="20" r="13.5" fill="none" stroke="#fff3b0" stroke-width="2" opacity=".9"/><path d="M15 12.5h5.2c4.6 0 7.5 2.9 7.5 7.5s-2.9 7.5-7.5 7.5H15zm4.4 3.9v7.2h.9c2 0 3.2-1.4 3.2-3.6s-1.2-3.6-3.2-3.6z" fill="#fff"/></svg>`;

/** Line-style glyphs for the on-screen controls and the pause card. */
const G = {
  left: `<svg viewBox="0 0 24 24"><path d="M15 5 8 12l7 7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  right: `<svg viewBox="0 0 24 24"><path d="m9 5 7 7-7 7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  up: `<svg viewBox="0 0 24 24"><path d="M5 15l7-7 7 7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  item: `<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="5" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M10 10a2.2 2.2 0 1 1 3 2c-.7.3-1 .8-1 1.5M12 16.6v.1" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>`,
  play: `<svg viewBox="0 0 24 24"><path d="M7 5.5v13a1 1 0 0 0 1.5.9l10.4-6.5a1 1 0 0 0 0-1.8L8.5 4.6A1 1 0 0 0 7 5.5z" fill="currentColor"/></svg>`,
  restart: `<svg viewBox="0 0 24 24"><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4v4h4" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  home: `<svg viewBox="0 0 24 24"><path d="M4 11 12 4l8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/></svg>`,
  warn: `<svg viewBox="0 0 24 24"><path d="M12 3 2 20h20z" fill="currentColor"/><path d="M12 9v5M12 17v.1" stroke="#ff2d55" stroke-width="2.4" stroke-linecap="round"/></svg>`,
};

const ORD = (n: number) => (n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th");

export interface HudActions {
  resume(): void;
  restart(): void;
  quit(): void;
}

export class Hud {
  readonly el: HTMLElement;
  private q = <T extends HTMLElement = HTMLElement>(s: string) => this.el.querySelector<T>(s)!;
  private last: Record<string, string | number> = {};
  private mapDots: SVGCircleElement[] = [];
  private mapXf: (x: number, z: number) => [number, number] = () => [0, 0];
  private rollTimer = 0;

  constructor(parent: HTMLElement, private actions: HudActions, course: { name: string; laps: number; night: boolean; online?: { code: string; people: number } } = { name: "Dili Circuit", laps: 3, night: false }) {
    this.el = document.createElement("div");
    this.el.className = "kh";
    this.el.innerHTML = `
      <div class="kh-lines"></div>
      <div class="kh-vignette"></div>
      <div class="kh-item">
        <div class="kh-slot"><i class="kh-ring"></i><div class="kh-ico"></div></div>
        <div class="kh-iname"><span></span><kbd>↓</kbd></div>
      </div>
      <div class="kh-top"><div class="kh-lap">LAP <b>1</b><i>/${course.laps}</i></div><span class="kh-sep"></span><div class="kh-clock">0:00.00</div></div>
      <div class="kh-mapbox"><svg class="kh-map" viewBox="0 0 170 200"><g class="kh-map-g"></g></svg></div>
      <div class="kh-bl">
        <div class="kh-coins"><span class="kh-coin">${COIN}</span><b>0</b></div>
        <div class="kh-score"><b>0</b><span>Score</span></div>
      </div>
      <div class="kh-pos"><b data-t="8">8</b><sup data-t="th">th</sup></div>
      <div class="kh-pops"></div>
      <div class="kh-count"></div>
      <div class="kh-banner"></div>
      <div class="kh-replay"><i></i>REPLAY<span>Dlicom TV</span></div>
      <div class="kh-wait"><i></i><span></span></div>
      <div class="kh-warn">${G.warn}Incoming</div>
      <div class="kh-title">
        <div class="kh-title-card">
          <small>${course.online ? `Online · Room ${course.online.code}` : course.night ? "Dlicom Night Series" : "Dlicom Grand Prix"}</small>
          <strong>${course.name}</strong>
          <span>${course.online ? `${course.laps} laps · ${course.online.people} players${course.online.people < 8 ? ` + ${8 - course.online.people} Custodians` : ""}` : `${course.laps} laps · 8 racers · beat the Custodians`}</span>
        </div>
        <em>Press any arrow to skip</em>
      </div>
      <div class="kh-hint"><span><kbd>←</kbd><kbd>→</kbd>Steer</span><span><kbd>hold</kbd>Drift</span><span><kbd>↑</kbd>Gas</span><span><kbd>↓</kbd>Item</span><span><kbd>Esc</kbd>Pause</span></div>
      <div class="kh-pause">
        <div class="kh-pause-card">
          <strong>Paused</strong>
          <p>${course.online ? "The race keeps going online." : "The Custodians are waiting."}</p>
          <button data-a="resume" class="primary">${G.play}Resume</button>
          ${course.online ? "" : `<button data-a="restart">${G.restart}Restart race</button>`}
          <button data-a="quit">${G.home}${course.online ? "Leave the room" : "Quit to hub"}</button>
        </div>
      </div>
      <div class="kh-touch">
        <div class="kh-tl"><button data-k="ArrowLeft" aria-label="Steer left">${G.left}</button><button data-k="ArrowRight" aria-label="Steer right">${G.right}</button></div>
        <div class="kh-tr"><button data-k="ArrowDown" class="small" aria-label="Use item">${G.item}</button><button data-k="ArrowUp" class="gas" aria-label="Gas">${G.up}</button></div>
      </div>
      <div class="kh-load"><div class="kh-spin"><i></i></div><b>${course.name}</b><span>${course.night ? "Lighting up the city…" : "Building the stadium…"}</span></div>`;
    parent.appendChild(this.el);
    this.wireTouch();
    this.el.querySelectorAll<HTMLButtonElement>("[data-a]").forEach((b) => {
      b.addEventListener("click", () => {
        const a = b.dataset.a as keyof HudActions;
        this.actions[a]();
      });
    });
  }

  /**
   * On-screen arrows, only on touch screens. They send the same key events
   * the keyboard does, so the game can't tell the difference.
   */
  private wireTouch() {
    if (!matchMedia("(pointer: coarse)").matches) return;
    this.el.classList.add("touch");
    this.el.querySelectorAll<HTMLButtonElement>("[data-k]").forEach((b) => {
      const code = b.dataset.k!;
      const send = (type: "keydown" | "keyup") => dispatchEvent(new KeyboardEvent(type, { code, key: code }));
      b.addEventListener("pointerdown", (e) => { e.preventDefault(); b.setPointerCapture(e.pointerId); b.classList.add("on"); send("keydown"); });
      const up = () => { if (!b.classList.contains("on")) return; b.classList.remove("on"); send("keyup"); };
      b.addEventListener("pointerup", up);
      b.addEventListener("pointercancel", up);
      b.addEventListener("lostpointercapture", up);
    });
  }

  loaded() {
    this.q(".kh-load").classList.add("gone");
  }

  /* ---------------- persistent readouts ---------------- */

  private set(key: string, v: string | number, fn: () => void) {
    if (this.last[key] === v) return;
    this.last[key] = v;
    fn();
  }

  score(n: number) {
    this.set("score", n, () => {
      const b = this.q(".kh-score b");
      b.textContent = n.toLocaleString("en-US");
      bump(b);
    });
  }

  coins(n: number) {
    this.set("coins", n, () => {
      const b = this.q(".kh-coins b");
      b.textContent = String(n);
      bump(this.q(".kh-coins"));
    });
  }

  position(p: number) {
    this.set("pos", p, () => {
      const b = this.q(".kh-pos b");
      const s = this.q(".kh-pos sup");
      b.textContent = String(p);
      b.dataset.t = String(p);
      s.textContent = ORD(p);
      s.dataset.t = ORD(p);
      const el = this.q(".kh-pos");
      el.classList.toggle("first", p === 1);
      bump(el, 1.25);
    });
  }

  lap(n: number, of: number) {
    this.set("lap", n, () => {
      this.q(".kh-lap").innerHTML = `LAP <b>${n}</b><i>/${of}</i>`;
      bump(this.q(".kh-lap"));
    });
  }

  clock(sec: number) {
    const m = Math.floor(sec / 60);
    const s = sec - m * 60;
    const txt = `${m}:${s < 10 ? "0" : ""}${s.toFixed(2)}`;
    this.set("clock", txt, () => { this.q(".kh-clock").textContent = txt; });
  }

  /** Show an item, or spin the roulette for `ms` before landing on it. */
  item(kind: ItemKind | null, rollMs = 0, onLand?: () => void, tick?: () => void) {
    clearInterval(this.rollTimer);
    const ico = this.q(".kh-ico");
    const slot = this.q(".kh-item");
    const name = this.q(".kh-iname span");
    if (!kind) {
      ico.innerHTML = "";
      name.textContent = "";
      slot.classList.remove("has", "rolling");
      return;
    }
    if (rollMs <= 0) {
      ico.innerHTML = ICON[kind];
      name.textContent = ITEM_NAME[kind];
      slot.classList.add("has");
      slot.classList.remove("rolling");
      bump(this.q(".kh-slot"), 1.22);
      return;
    }
    name.textContent = "";
    const kinds = Object.keys(ICON) as ItemKind[];
    let i = Math.floor(Math.random() * kinds.length);
    slot.classList.add("rolling");
    slot.classList.remove("has");
    const start = performance.now();
    this.rollTimer = window.setInterval(() => {
      ico.innerHTML = ICON[kinds[i++ % kinds.length]];
      tick?.();
      if (performance.now() - start > rollMs) {
        clearInterval(this.rollTimer);
        this.item(kind);
        onLand?.();
      }
    }, 70);
  }

  /* ---------------- minimap ---------------- */

  buildMap(outline: [number, number][], racers: number) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [x, z] of outline) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
    const pad = 14, W = 170, H = 200;
    const s = Math.min((W - pad * 2) / (maxX - minX), (H - pad * 2) / (maxZ - minZ));
    const ox = (W - (maxX - minX) * s) / 2, oz = (H - (maxZ - minZ) * s) / 2;
    this.mapXf = (x, z) => [ox + (x - minX) * s, oz + (z - minZ) * s];
    const d = outline.map(([x, z], i) => {
      const [px, py] = this.mapXf(x, z);
      return `${i ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`;
    }).join("") + "Z";
    const g = this.q(".kh-map-g") as unknown as SVGGElement;
    g.innerHTML = `<path d="${d}" fill="none" stroke="rgba(15,20,60,.55)" stroke-width="13" stroke-linejoin="round"/>
      <path d="${d}" fill="none" stroke="#fff" stroke-width="7" stroke-linejoin="round"/>`;
    this.mapDots = [];
    for (let i = 0; i < racers; i++) {
      const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      c.setAttribute("r", i === 0 ? "7" : "5");
      c.setAttribute("class", i === 0 ? "me" : "rv");
      g.appendChild(c);
      this.mapDots.push(c);
    }
    // Player on top.
    g.appendChild(this.mapDots[0]);
  }

  /** Another person (online): a bigger dot with a white ring. */
  mapHuman(i: number) {
    const c = this.mapDots[i];
    if (!c || i === 0) return;
    c.setAttribute("r", "6");
    c.setAttribute("stroke", "#fff");
    c.setAttribute("stroke-width", "2");
  }

  mapDot(i: number, x: number, z: number, color?: string) {
    const c = this.mapDots[i];
    if (!c) return;
    const [px, py] = this.mapXf(x, z);
    c.setAttribute("cx", px.toFixed(1));
    c.setAttribute("cy", py.toFixed(1));
    if (color && c.getAttribute("fill") !== color) c.setAttribute("fill", color);
  }

  /* ---------------- moments ---------------- */

  /** A short callout that floats up from the kart. */
  pop(text: string, cls = "") {
    const box = this.q(".kh-pops");
    const el = document.createElement("div");
    el.className = `kh-pop ${cls}`;
    el.textContent = text;
    box.appendChild(el);
    while (box.children.length > 3) box.firstElementChild?.remove();
    el.animate([
      { transform: "translateY(18px) scale(.4)", opacity: 0 },
      { transform: "translateY(0) scale(1.18)", opacity: 1, offset: 0.18 },
      { transform: "translateY(0) scale(1)", opacity: 1, offset: 0.3 },
      { transform: "translateY(-6px) scale(1)", opacity: 1, offset: 0.75 },
      { transform: "translateY(-30px) scale(.9)", opacity: 0 },
    ], { duration: 1300, easing: "ease-out" }).onfinish = () => el.remove();
  }

  /** Huge centre text: LAP 2, FINAL LAP, FINISH. */
  banner(text: string, cls = "", ms = 1600) {
    const box = this.q(".kh-banner");
    box.innerHTML = `<div class="kh-ban ${cls}" data-t="${text}">${text}</div>`;
    const el = box.firstElementChild as HTMLElement;
    el.animate([
      { transform: "translateX(60%) skewX(-12deg) scale(.6)", opacity: 0 },
      { transform: "translateX(-3%) skewX(-12deg) scale(1.08)", opacity: 1, offset: 0.14 },
      { transform: "translateX(0) skewX(-12deg) scale(1)", opacity: 1, offset: 0.22 },
      { transform: "translateX(0) skewX(-12deg) scale(1)", opacity: 1, offset: 0.8 },
      { transform: "translateX(-60%) skewX(-12deg) scale(.8)", opacity: 0 },
    ], { duration: ms, easing: "cubic-bezier(.2,.8,.3,1)", fill: "forwards" });
  }

  countdown(text: string | null, go = false) {
    this.set("count", text ?? "", () => {
      const box = this.q(".kh-count");
      if (!text) { box.innerHTML = ""; return; }
      box.innerHTML = `<div class="kh-num ${go ? "go" : ""}" data-t="${text}">${text}</div>`;
      (box.firstElementChild as HTMLElement).animate([
        { transform: "scale(2.6) rotate(-8deg)", opacity: 0 },
        { transform: "scale(.9) rotate(2deg)", opacity: 1, offset: 0.25 },
        { transform: "scale(1.05) rotate(0)", opacity: 1, offset: 0.4 },
        { transform: "scale(1) rotate(0)", opacity: 1, offset: 0.8 },
        { transform: "scale(.7)", opacity: go ? 1 : 0 },
      ], { duration: go ? 900 : 950, easing: "ease-out", fill: "forwards" });
    });
  }

  /** A coin flies from where it was grabbed into the counter. */
  coinFly(x: number, y: number) {
    const target = this.q(".kh-coin").getBoundingClientRect();
    const host = this.el.getBoundingClientRect();
    const el = document.createElement("div");
    el.className = "kh-fly";
    el.innerHTML = COIN;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    this.el.appendChild(el);
    const tx = target.left - host.left + target.width / 2 - x;
    const ty = target.top - host.top + target.height / 2 - y;
    const mx = tx * 0.35 + (Math.random() - 0.5) * 60, my = ty * 0.2 - 70;
    el.animate([
      { transform: "translate(-50%,-50%) scale(.6)", opacity: 1 },
      { transform: `translate(calc(-50% + ${mx}px), calc(-50% + ${my}px)) scale(1.25)`, opacity: 1, offset: 0.35 },
      { transform: `translate(calc(-50% + ${tx}px), calc(-50% + ${ty}px)) scale(.7)`, opacity: 0.9 },
    ], { duration: 620, easing: "cubic-bezier(.5,0,.6,1)" }).onfinish = () => {
      el.remove();
      bump(this.q(".kh-coin"), 1.35);
    };
  }

  speedLines(level: number) {
    const v = level.toFixed(2);
    this.set("lines", v, () => { this.q(".kh-lines").style.opacity = v; });
  }

  vignette(color: string | null) {
    this.set("vig", color ?? "", () => {
      const el = this.q(".kh-vignette");
      el.style.setProperty("--vig", color ?? "transparent");
      el.classList.toggle("on", !!color);
    });
  }

  warn(on: boolean) {
    this.set("warn", on ? 1 : 0, () => this.q(".kh-warn").classList.toggle("on", on));
  }

  title(on: boolean) {
    this.set("title", on ? 1 : 0, () => this.q(".kh-title").classList.toggle("on", on));
  }

  hint(on: boolean) {
    this.set("hint", on ? 1 : 0, () => this.q(".kh-hint").classList.toggle("on", on));
  }

  paused(on: boolean) {
    this.q(".kh-pause").classList.toggle("on", on);
  }

  /** Online: a quiet line while the room gets everyone ready. */
  waiting(text: string | null) {
    const el = this.q(".kh-wait");
    if (text) el.querySelector("span")!.textContent = text;
    el.classList.toggle("on", !!text);
  }

  replay(on: boolean) {
    this.el.classList.toggle("replaying", on);
  }

  racing(on: boolean) {
    this.el.classList.toggle("live", on);
  }

  flash(color: string) {
    const f = document.createElement("div");
    f.className = "kh-flash";
    f.style.background = color;
    this.el.appendChild(f);
    f.animate([{ opacity: 0.55 }, { opacity: 0 }], { duration: 380, easing: "ease-out" }).onfinish = () => f.remove();
  }

  destroy() {
    clearInterval(this.rollTimer);
    this.el.remove();
  }
}

function bump(el: Element, k = 1.18) {
  (el as HTMLElement).animate([
    { transform: "scale(1)" }, { transform: `scale(${k})`, offset: 0.35 }, { transform: "scale(1)" },
  ], { duration: 260, easing: "ease-out" });
}
