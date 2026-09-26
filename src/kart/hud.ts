import "./hud.css";

/**
 * The race HUD: plain DOM over the WebGL canvas, laid out like the kart
 * games it's modelled on. Item slot top-left, minimap top-right, coins and
 * score bottom-left, position bottom-right. Everything animates.
 */

export type ItemKind = "turbo" | "shield" | "magnet" | "zap";

export const ITEM_NAME: Record<ItemKind, string> = {
  turbo: "DLI Rocket", shield: "D-Shield", magnet: "Coin Magnet", zap: "Freeze Zap",
};

const ICON: Record<ItemKind, string> = {
  turbo: `<svg viewBox="0 0 64 64"><path d="M20 46c-6 4-8 12-8 12s8-2 12-8z" fill="#ff9f1a"/><path d="M18 44c-3 3-4 8-4 8s5-1 8-4z" fill="#fff3a0"/>
    <path d="M22 42 42 22c6-6 14-8 16-8 0 2-2 10-8 16L30 50z" fill="#f4f7ff" stroke="#1b1f4d" stroke-width="3" stroke-linejoin="round"/>
    <path d="M22 42l-8-2 8-10 8 2zM30 50l2 8 10-8-2-8z" fill="#2f6bff" stroke="#1b1f4d" stroke-width="3" stroke-linejoin="round"/>
    <circle cx="43" cy="29" r="6" fill="#2f6bff" stroke="#1b1f4d" stroke-width="3"/><text x="43" y="33" font-size="9" font-family="Inter,Arial Black" font-weight="900" fill="#fff" text-anchor="middle">D</text></svg>`,
  shield: `<svg viewBox="0 0 64 64"><defs><radialGradient id="sg" cx=".35" cy=".3"><stop offset="0" stop-color="#e6fbff"/><stop offset=".6" stop-color="#5ec8ff"/><stop offset="1" stop-color="#2f6bff"/></radialGradient></defs>
    <circle cx="32" cy="32" r="25" fill="url(#sg)" stroke="#1b1f4d" stroke-width="3.5"/><ellipse cx="24" cy="21" rx="8" ry="5" fill="#fff" opacity=".8"/>
    <text x="33" y="42" font-size="28" font-family="Inter,Arial Black" font-weight="900" fill="#fff" stroke="#1b1f4d" stroke-width="2.5" paint-order="stroke" text-anchor="middle">D</text></svg>`,
  magnet: `<svg viewBox="0 0 64 64"><path d="M14 12h12v22a6 6 0 0 0 12 0V12h12v22a18 18 0 0 1-36 0z" fill="#ff3d5a" stroke="#1b1f4d" stroke-width="3.5" stroke-linejoin="round"/>
    <path d="M14 12h12v9H14zM38 12h12v9H38z" fill="#e8eef9" stroke="#1b1f4d" stroke-width="3.5" stroke-linejoin="round"/>
    <circle cx="52" cy="46" r="7" fill="#ffc21f" stroke="#1b1f4d" stroke-width="3"/><circle cx="12" cy="50" r="5" fill="#ffc21f" stroke="#1b1f4d" stroke-width="3"/></svg>`,
  zap: `<svg viewBox="0 0 64 64"><path d="M36 4 12 36h16l-6 24 28-34H32z" fill="#ffe14d" stroke="#1b1f4d" stroke-width="3.5" stroke-linejoin="round"/>
    <path d="M34 10 20 32h8" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".8"/></svg>`,
};

const COIN = `<svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="17" fill="#ffc21f" stroke="#1b1f4d" stroke-width="3"/><circle cx="20" cy="20" r="12" fill="none" stroke="#fff1a6" stroke-width="2.4"/><text x="20.5" y="26.5" font-size="17" font-family="Inter,Arial Black" font-weight="900" fill="#2f6bff" stroke="#fff" stroke-width="1.6" paint-order="stroke" text-anchor="middle">D</text></svg>`;

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

  constructor(parent: HTMLElement, private actions: HudActions) {
    this.el = document.createElement("div");
    this.el.className = "kh";
    this.el.innerHTML = `
      <div class="kh-lines"></div>
      <div class="kh-vignette"></div>
      <div class="kh-item"><div class="kh-slot"><div class="kh-ico"></div></div><div class="kh-key">↓</div></div>
      <div class="kh-top"><div class="kh-lap">LAP <b>1</b><i>/3</i></div><div class="kh-clock">0:00.00</div></div>
      <svg class="kh-map" viewBox="0 0 170 200"><g class="kh-map-g"></g></svg>
      <div class="kh-bl">
        <div class="kh-coins"><span class="kh-coin">${COIN}</span><b>0</b></div>
        <div class="kh-score"><b>0</b><span>SCORE</span></div>
      </div>
      <div class="kh-pos"><b data-t="8">8</b><sup data-t="th">th</sup></div>
      <div class="kh-pops"></div>
      <div class="kh-count"></div>
      <div class="kh-banner"></div>
      <div class="kh-warn">INCOMING!</div>
      <div class="kh-title">
        <div class="kh-title-card">
          <small>DLICOM GRAND PRIX</small>
          <strong>Dili Circuit</strong>
          <span>3 laps · 8 racers · beat the Custodians</span>
        </div>
        <em>press any arrow to skip</em>
      </div>
      <div class="kh-hint"><span><b>← →</b> steer</span><span><b>hold</b> to drift</span><span><b>↑</b> gas</span><span><b>↓</b> use item</span><span><b>Esc</b> pause</span></div>
      <div class="kh-pause">
        <div class="kh-pause-card">
          <strong>Paused</strong>
          <button data-a="resume">Resume</button>
          <button data-a="restart" class="ghost">Restart race</button>
          <button data-a="quit" class="ghost">Quit to hub</button>
        </div>
      </div>
      <div class="kh-touch">
        <div class="kh-tl"><button data-k="ArrowLeft" aria-label="Steer left">◀</button><button data-k="ArrowRight" aria-label="Steer right">▶</button></div>
        <div class="kh-tr"><button data-k="ArrowDown" class="small" aria-label="Use item">▼</button><button data-k="ArrowUp" class="gas" aria-label="Gas">▲</button></div>
      </div>
      <div class="kh-load"><div class="kh-spin"></div><span>Building the stadium…</span></div>`;
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
    if (!kind) {
      ico.innerHTML = "";
      slot.classList.remove("has", "rolling");
      return;
    }
    if (rollMs <= 0) {
      ico.innerHTML = ICON[kind];
      slot.classList.add("has");
      slot.classList.remove("rolling");
      bump(slot, 1.3);
      return;
    }
    const kinds = Object.keys(ICON) as ItemKind[];
    let i = 0;
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
