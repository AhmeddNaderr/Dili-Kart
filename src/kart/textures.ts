import * as THREE from "three";

/**
 * Every surface pattern in the race is painted here at load time on a 2D
 * canvas. Nothing to download, and each one is tuned to the exact geometry
 * it lands on (lane positions, curb stripe length, coin face size).
 */

const made: THREE.Texture[] = [];

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!];
}

function tex(c: HTMLCanvasElement, repeat = true, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  made.push(t);
  return t;
}

export function disposeTextures() {
  for (const t of made) t.dispose();
  made.length = 0;
}

/** Tiny deterministic noise so the textures look the same every load. */
function rand(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function speckle(g: CanvasRenderingContext2D, w: number, h: number, n: number, cols: string[], seed: number) {
  const r = rand(seed);
  for (let i = 0; i < n; i++) {
    g.fillStyle = cols[Math.floor(r() * cols.length)];
    const s = 1 + r() * 2;
    g.fillRect(r() * w, r() * h, s, s);
  }
}

/* ------------------------------------------------------------------ */
/* Track surfaces                                                      */
/* ------------------------------------------------------------------ */

/**
 * Road cross-section. U runs 0..1 across all four lanes, V repeats along the
 * track. White edges, white dashed lane dividers, and a Dlicom-blue dashed
 * centre line like the stadium circuit in the reference.
 */
export function asphaltTex() {
  const W = 512, H = 512;
  const [c, g] = canvas(W, H);
  g.fillStyle = "#666e82";
  g.fillRect(0, 0, W, H);
  speckle(g, W, H, 9000, ["#5d6578", "#737b8f", "#6b7388", "#7d8599"], 11);
  // Worn racing grooves in the middle of each lane.
  for (let l = 0; l < 4; l++) {
    const x = (l + 0.5) * (W / 4);
    const grad = g.createLinearGradient(x - 40, 0, x + 40, 0);
    grad.addColorStop(0, "rgba(40,44,60,0)");
    grad.addColorStop(0.5, "rgba(40,44,60,.14)");
    grad.addColorStop(1, "rgba(40,44,60,0)");
    g.fillStyle = grad;
    g.fillRect(x - 40, 0, 80, H);
  }
  g.fillStyle = "#f4f6ff";
  g.fillRect(6, 0, 9, H);
  g.fillRect(W - 15, 0, 9, H);
  for (const f of [0.25, 0.75]) {
    for (let y = 0; y < H; y += 128) g.fillRect(f * W - 3, y + 20, 6, 70);
  }
  g.fillStyle = "#3d7bff";
  for (let y = 0; y < H; y += 64) g.fillRect(W / 2 - 5, y + 8, 10, 34);
  return tex(c);
}

/** The pastel four-colour lanes from the stadium reference. */
export function candyTex() {
  const W = 512, H = 512;
  const [c, g] = canvas(W, H);
  const lanes = ["#ff94c9", "#ffd95c", "#7fe6c4", "#86c8ff"];
  lanes.forEach((col, i) => {
    g.fillStyle = col;
    g.fillRect((i * W) / 4, 0, W / 4, H);
  });
  // Soft diagonal sheen so the flat colour has some material to it.
  g.globalAlpha = 0.12;
  g.fillStyle = "#ffffff";
  for (let y = -W; y < H; y += 48) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(W, y + W * 0.5);
    g.lineTo(W, y + W * 0.5 + 16);
    g.lineTo(0, y + 16);
    g.fill();
  }
  g.globalAlpha = 1;
  speckle(g, W, H, 2500, ["rgba(255,255,255,.35)", "rgba(0,0,0,.06)"], 5);
  g.fillStyle = "#ffffff";
  g.fillRect(4, 0, 12, H);
  g.fillRect(W - 16, 0, 12, H);
  for (const f of [0.25, 0.5, 0.75]) g.fillRect(f * W - 4, 0, 8, H);
  return tex(c);
}

/** Curb stripes. V wraps every stripe pair. */
export function curbTex(a: string, b: string) {
  const [c, g] = canvas(32, 128);
  g.fillStyle = a;
  g.fillRect(0, 0, 32, 64);
  g.fillStyle = b;
  g.fillRect(0, 64, 32, 64);
  g.fillStyle = "rgba(0,0,0,.12)";
  g.fillRect(0, 0, 3, 128);
  return tex(c);
}

/**
 * Grass: soft colour variation from layered blobs, thousands of little
 * blade strokes, and gentle mowing bands (stripes or a checker).
 */
export function grassTex(checker: boolean) {
  const W = 512, H = 512;
  const [c, g] = canvas(W, H);
  const A = "#47a842", B = "#3f9a3d";
  if (checker) {
    for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
      g.fillStyle = (x + y) % 2 ? A : B;
      g.fillRect((x * W) / 2, (y * H) / 2, W / 2, H / 2);
    }
  } else {
    g.fillStyle = A;
    g.fillRect(0, 0, W, H / 2);
    g.fillStyle = B;
    g.fillRect(0, H / 2, W, H / 2);
  }
  const r = rand(3);
  // Large soft patches of lighter and darker growth, wrapped at the edges.
  for (let i = 0; i < 70; i++) {
    const x = r() * W, y = r() * H, rad = 20 + r() * 70;
    const light = r() < 0.5;
    for (const [ox, oy] of [[0, 0], [W, 0], [-W, 0], [0, H], [0, -H]]) {
      const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad);
      gr.addColorStop(0, light ? "rgba(140,210,90,.16)" : "rgba(20,70,30,.16)");
      gr.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = gr;
      g.fillRect(x + ox - rad, y + oy - rad, rad * 2, rad * 2);
    }
  }
  // Blades.
  g.lineCap = "round";
  for (let i = 0; i < 9000; i++) {
    const x = r() * W, y = r() * H, len = 3 + r() * 6, lean = (r() - 0.5) * 3;
    const k = r();
    g.strokeStyle = k < 0.4 ? "rgba(120,200,90,.55)" : k < 0.8 ? "rgba(40,110,45,.5)" : "rgba(170,225,120,.45)";
    g.lineWidth = 1 + r();
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + lean, y - len);
    g.stroke();
  }
  // The odd tiny flower.
  for (let i = 0; i < 40; i++) {
    g.fillStyle = r() < 0.5 ? "rgba(255,240,170,.8)" : "rgba(255,255,255,.75)";
    g.beginPath();
    g.arc(r() * W, r() * H, 1.4, 0, Math.PI * 2);
    g.fill();
  }
  return tex(c);
}

/** Barrier wall: Dlicom blue panels with the wordmark, white top stripe. */
export function wallTex() {
  const W = 1024, H = 128;
  const [c, g] = canvas(W, H);
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, "#4f8cff");
  grad.addColorStop(1, "#2350d8");
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, W, 16);
  g.fillRect(0, H - 10, W, 10);
  g.font = "900 64px 'Inter', 'Arial Black', sans-serif";
  g.textBaseline = "middle";
  g.textAlign = "center";
  g.fillStyle = "#ffffff";
  g.fillText("DLICOM", W * 0.27, H * 0.56);
  g.fillText("DLICOM", W * 0.77, H * 0.56);
  g.fillStyle = "#ffcc33";
  g.beginPath();
  g.arc(W * 0.52, H * 0.56, 26, 0, Math.PI * 2);
  g.arc(W * 0.02, H * 0.56, 26, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#2350d8";
  g.font = "900 34px 'Inter', 'Arial Black', sans-serif";
  g.fillText("D", W * 0.52, H * 0.58);
  g.fillText("D", W * 0.02, H * 0.58);
  return tex(c);
}

export function checkerTex(cols = 10, rows = 2) {
  const s = 32;
  const [c, g] = canvas(cols * s, rows * s);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      g.fillStyle = (x + y) % 2 ? "#1b1f2e" : "#ffffff";
      g.fillRect(x * s, y * s, s, s);
    }
  }
  const t = tex(c, false);
  t.magFilter = THREE.NearestFilter;
  return t;
}

/** Glowing chevrons for boost pads. Scrolled along V at runtime. */
export function chevronTex() {
  const W = 128, H = 128;
  const [c, g] = canvas(W, H);
  g.fillStyle = "#ff7a00";
  g.fillRect(0, 0, W, H);
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, "#fff4a8");
  grad.addColorStop(1, "#ffb300");
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(W * 0.12, H * 0.78);
  g.lineTo(W * 0.5, H * 0.3);
  g.lineTo(W * 0.88, H * 0.78);
  g.lineTo(W * 0.88, H * 0.98);
  g.lineTo(W * 0.5, H * 0.5);
  g.lineTo(W * 0.12, H * 0.98);
  g.closePath();
  g.fill();
  return tex(c);
}

/** Dark frame around the boost pad. */
export function padFrameTex() {
  const W = 128, H = 192;
  const [c, g] = canvas(W, H);
  g.fillStyle = "#23283a";
  roundRect(g, 0, 0, W, H, 22);
  g.fill();
  g.fillStyle = "#3a4058";
  roundRect(g, 6, 6, W - 12, H - 12, 18);
  g.fill();
  g.fillStyle = "#ffcf3d";
  for (let y = 18; y < H - 12; y += 30) {
    g.fillRect(8, y, 4, 12);
    g.fillRect(W - 12, y, 4, 12);
  }
  return tex(c, false);
}

/* ------------------------------------------------------------------ */
/* Characters and pickups                                              */
/* ------------------------------------------------------------------ */

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/**
 * Dili's face, painted as an equirectangular map for a sphere. The front of
 * a three.js sphere (+Z) sits at U = 0.25, so that is where the face goes.
 */
export function diliFaceTex() {
  const W = 512, H = 256;
  const [c, g] = canvas(W, H);
  g.fillStyle = "#f7f9ff";
  g.fillRect(0, 0, W, H);
  const cx = W * 0.25, cy = H * 0.49;
  // Eyes: tall glossy ovals.
  for (const dx of [-27, 27]) {
    g.fillStyle = "#141a33";
    g.beginPath();
    g.ellipse(cx + dx, cy, 8.5, 13, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#ffffff";
    g.beginPath();
    g.ellipse(cx + dx + 2.5, cy - 5, 3, 4, 0, 0, Math.PI * 2);
    g.fill();
  }
  // Cheeks.
  g.fillStyle = "rgba(255,140,170,.45)";
  for (const dx of [-44, 44]) {
    g.beginPath();
    g.ellipse(cx + dx, cy + 16, 9, 5, 0, 0, Math.PI * 2);
    g.fill();
  }
  // Big open smile with a tongue.
  g.fillStyle = "#141a33";
  g.beginPath();
  g.moveTo(cx - 20, cy + 17);
  g.quadraticCurveTo(cx, cy + 20, cx + 20, cy + 17);
  g.quadraticCurveTo(cx + 17, cy + 40, cx, cy + 41);
  g.quadraticCurveTo(cx - 17, cy + 40, cx - 20, cy + 17);
  g.fill();
  g.fillStyle = "#ff6f8e";
  g.beginPath();
  g.ellipse(cx, cy + 34, 9, 5.5, 0, 0, Math.PI * 2);
  g.fill();
  return tex(c, false);
}

/** A round emblem: the Dlicom "D" on a disc. */
export function emblemTex(bg: string, fg: string, ring: string, letter = "D") {
  const S = 128;
  const [c, g] = canvas(S, S);
  g.fillStyle = ring;
  g.beginPath();
  g.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = bg;
  g.beginPath();
  g.arc(S / 2, S / 2, S / 2 - 12, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = fg;
  g.font = "900 78px 'Inter', 'Arial Black', sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(letter, S / 2 + 2, S / 2 + 5);
  return tex(c, false);
}

export type Livery = "waves" | "matrix" | "gold" | "carbon";

/**
 * Paint jobs for the shop skins, tiled over the kart shell (about one tile
 * per metre): Quang's sky and surf, Retree's falling code, gold flake with
 * pinstripes, and bare carbon weave.
 */
export function liveryTex(kind: Livery) {
  const S = 512;
  const [c, g] = canvas(S, S);
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  if (kind === "waves") {
    const sky = g.createLinearGradient(0, 0, 0, S);
    sky.addColorStop(0, "#e9f8ff");
    sky.addColorStop(0.45, "#8fdcff");
    sky.addColorStop(1, "#1fb2ef");
    g.fillStyle = sky;
    g.fillRect(0, 0, S, S);
    // Rolling surf: white crests over deeper bands, drawn to wrap sideways.
    for (let band = 0; band < 5; band++) {
      const y0 = 150 + band * 80;
      g.fillStyle = band % 2 ? "rgba(255,255,255,.85)" : "rgba(10,140,210,.55)";
      g.beginPath();
      g.moveTo(0, S);
      for (let x = 0; x <= S; x += 8) {
        const k = (x / S) * Math.PI * 2;
        g.lineTo(x, y0 + Math.sin(k * 2 + band) * 18 + Math.sin(k * 5 + band * 2) * 6);
      }
      g.lineTo(S, S);
      g.closePath();
      g.fill();
    }
    // Clouds up top.
    g.fillStyle = "rgba(255,255,255,.9)";
    for (let i = 0; i < 9; i++) {
      const x = rnd() * S, y = 30 + rnd() * 70, r = 18 + rnd() * 26;
      for (let k = 0; k < 4; k++) {
        g.beginPath();
        g.arc(x + k * r * 0.7, y + Math.sin(k) * 6, r * (1 - k * 0.12), 0, Math.PI * 2);
        g.fill();
      }
    }
  } else if (kind === "matrix") {
    g.fillStyle = "#0a1450";
    g.fillRect(0, 0, S, S);
    const glow = g.createRadialGradient(S / 2, S / 2, 20, S / 2, S / 2, S * 0.7);
    glow.addColorStop(0, "rgba(47,77,255,.55)");
    glow.addColorStop(1, "rgba(47,77,255,0)");
    g.fillStyle = glow;
    g.fillRect(0, 0, S, S);
    g.font = "700 22px ui-monospace, 'Courier New', monospace";
    g.textAlign = "center";
    g.textBaseline = "middle";
    for (let y = 12; y < S; y += 24) {
      for (let x = 10; x < S; x += 20) {
        const a = 0.25 + rnd() * 0.6;
        g.fillStyle = rnd() > 0.93 ? "rgba(220,235,255,.95)" : `rgba(120,150,255,${a})`;
        g.fillText(String(Math.floor(rnd() * 10)), x, y);
      }
    }
  } else if (kind === "gold") {
    const base = g.createLinearGradient(0, 0, S, S);
    base.addColorStop(0, "#ffe27a");
    base.addColorStop(0.5, "#ffb81c");
    base.addColorStop(1, "#ffd24d");
    g.fillStyle = base;
    g.fillRect(0, 0, S, S);
    // Metal flake.
    for (let i = 0; i < 2600; i++) {
      g.fillStyle = rnd() > 0.5 ? "rgba(255,255,230,.35)" : "rgba(170,110,0,.25)";
      g.fillRect(rnd() * S, rnd() * S, 2, 2);
    }
    g.strokeStyle = "#15161f";
    g.lineWidth = 6;
    for (const y of [120, 138, 380, 398]) {
      g.beginPath(); g.moveTo(0, y); g.lineTo(S, y); g.stroke();
    }
  } else {
    const n = 16, q = S / n;
    g.fillStyle = "#101219";
    g.fillRect(0, 0, S, S);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const horiz = (x + y) % 2 === 0;
      const grad = horiz ? g.createLinearGradient(x * q, 0, x * q + q, 0) : g.createLinearGradient(0, y * q, 0, y * q + q);
      grad.addColorStop(0, "#171a24");
      grad.addColorStop(0.5, "#3a4052");
      grad.addColorStop(1, "#171a24");
      g.fillStyle = grad;
      g.fillRect(x * q + 1, y * q + 1, q - 2, q - 2);
    }
    // An ice-blue speed line.
    g.fillStyle = "#8fe3ff";
    g.fillRect(0, S * 0.62, S, 10);
  }
  return tex(c);
}

/**
 * Glider canopy. U runs across the span, V from trailing edge (0) to leading
 * edge (1). Dlicom blue with a white D for the squad; black with the team
 * colour and a padlock for the Custodians.
 */
export function gliderTex(base: string, stripe: string, evil: boolean) {
  const W = 512, H = 256;
  const [c, g] = canvas(W, H);
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, evil ? "#232033" : shade(base, 0.25));
  grad.addColorStop(1, evil ? "#0f0e18" : shade(base, -0.25));
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  // Chevrons pointing forward, and a bright leading edge.
  g.fillStyle = stripe;
  for (const k of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const x0 = W / 2 + k * (70 + i * 62);
      g.beginPath();
      g.moveTo(x0, H * 0.15); g.lineTo(x0 + k * 26, H * 0.15); g.lineTo(x0 + k * 26 + k * 40, H * 0.85); g.lineTo(x0 + k * 40, H * 0.85);
      g.closePath();
      g.globalAlpha = 0.85 - i * 0.2;
      g.fill();
    }
  }
  g.globalAlpha = 1;
  g.fillRect(0, 0, W, 14);
  g.fillStyle = evil ? stripe : "#ffd84a";
  g.fillRect(0, 14, W, 6);
  // Centre badge.
  g.fillStyle = evil ? "#0b0a12" : "#ffffff";
  g.beginPath(); g.arc(W / 2, H * 0.52, 58, 0, Math.PI * 2); g.fill();
  if (evil) {
    g.strokeStyle = stripe; g.lineWidth = 10;
    g.beginPath(); g.arc(W / 2, H * 0.44, 18, Math.PI, 0); g.stroke();
    g.fillStyle = stripe;
    g.fillRect(W / 2 - 28, H * 0.44, 56, 44);
  } else {
    g.fillStyle = base;
    g.font = "900 84px 'Inter', 'Arial Black', sans-serif";
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText("D", W / 2 + 3, H * 0.54);
  }
  // Canopy seams.
  g.strokeStyle = "rgba(0,0,0,.18)";
  g.lineWidth = 3;
  for (let i = 1; i < 8; i++) { g.beginPath(); g.moveTo((W / 8) * i, 20); g.lineTo((W / 8) * i, H); g.stroke(); }
  return tex(c, false);
}

/** The Custodians' badge: a padlock in their team colour. */
export function lockEmblemTex(ring: string) {
  const S = 128;
  const [c, g] = canvas(S, S);
  g.fillStyle = ring;
  g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2); g.fill();
  g.fillStyle = "#12111b";
  g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 12, 0, Math.PI * 2); g.fill();
  g.strokeStyle = ring;
  g.lineWidth = 9;
  g.beginPath(); g.arc(S / 2, 54, 17, Math.PI, 0); g.stroke();
  g.fillStyle = ring;
  g.fillRect(S / 2 - 27, 52, 54, 42);
  g.fillStyle = "#12111b";
  g.beginPath(); g.arc(S / 2, 68, 6, 0, Math.PI * 2); g.fill();
  g.fillRect(S / 2 - 3, 68, 6, 14);
  return tex(c, false);
}

export type CoinKind = "dli" | "eth" | "btc";

/** Coin faces, drawn flat so they read correctly on a real 3D disc. */
export function coinFaceTex(kind: CoinKind) {
  const S = 256;
  const [c, g] = canvas(S, S);
  const R = S / 2;
  const pal = kind === "eth"
    ? { a: "#efe9ff", b: "#9d86ff", c: "#5b3fd6", ring: "#c9bcff" }
    : kind === "btc"
      ? { a: "#ffe7a3", b: "#ffa51f", c: "#d9670b", ring: "#ffd36b" }
      : { a: "#fff1a6", b: "#ffc21f", c: "#d98a07", ring: "#ffe06b" };
  const grad = g.createRadialGradient(R * 0.7, R * 0.6, 10, R, R, R);
  grad.addColorStop(0, pal.a);
  grad.addColorStop(0.55, pal.b);
  grad.addColorStop(1, pal.c);
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  // Raised inner ring.
  g.lineWidth = 10;
  g.strokeStyle = pal.ring;
  g.beginPath();
  g.arc(R, R, R * 0.8, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = 4;
  g.strokeStyle = pal.c;
  g.beginPath();
  g.arc(R, R, R * 0.72, 0, Math.PI * 2);
  g.stroke();

  g.textAlign = "center";
  g.textBaseline = "middle";
  if (kind === "dli") {
    g.font = "900 150px 'Inter', 'Arial Black', sans-serif";
    g.lineWidth = 16;
    g.strokeStyle = "#ffffff";
    g.strokeText("D", R + 4, R + 10);
    const dg = g.createLinearGradient(0, R - 70, 0, R + 70);
    dg.addColorStop(0, "#6fb2ff");
    dg.addColorStop(1, "#1f55e0");
    g.fillStyle = dg;
    g.fillText("D", R + 4, R + 10);
  } else if (kind === "btc") {
    g.font = "900 150px 'Arial Black', sans-serif";
    g.lineWidth = 12;
    g.strokeStyle = "#b85405";
    g.strokeText("₿", R, R + 8);
    g.fillStyle = "#ffffff";
    g.fillText("₿", R, R + 8);
  } else {
    // Ethereum diamond: two stacked kites.
    const top = R - 78, mid = R + 8, bot = R + 84, w = 52;
    g.fillStyle = "#ffffff";
    g.beginPath();
    g.moveTo(R, top);
    g.lineTo(R + w, mid);
    g.lineTo(R, mid + 28);
    g.lineTo(R - w, mid);
    g.closePath();
    g.fill();
    g.fillStyle = "#e3dcff";
    g.beginPath();
    g.moveTo(R - w, mid + 12);
    g.lineTo(R, mid + 40);
    g.lineTo(R + w, mid + 12);
    g.lineTo(R, bot);
    g.closePath();
    g.fill();
    g.fillStyle = "rgba(91,63,214,.35)";
    g.beginPath();
    g.moveTo(R, top);
    g.lineTo(R, mid + 28);
    g.lineTo(R - w, mid);
    g.closePath();
    g.fill();
  }
  return tex(c, false);
}

/**
 * One face of an item box: a bevelled inner frame and a big embossed "?"
 * with a soft glow, on a transparent ground so the glass shows through.
 */
export function itemFaceTex() {
  const S = 256;
  const [c, g] = canvas(S, S);
  const rr = (x: number, y: number, w: number, h: number, r: number) => {
    g.beginPath();
    g.roundRect(x, y, w, h, r);
  };
  // Inner bevel: a bright hairline with a darker line inside it.
  rr(22, 22, S - 44, S - 44, 34);
  g.lineWidth = 7;
  g.strokeStyle = "rgba(255,255,255,.75)";
  g.stroke();
  rr(34, 34, S - 68, S - 68, 26);
  g.lineWidth = 3;
  g.strokeStyle = "rgba(255,255,255,.28)";
  g.stroke();
  // Corner glints.
  g.fillStyle = "rgba(255,255,255,.9)";
  for (const [x, y] of [[40, 40], [S - 40, 40], [40, S - 40], [S - 40, S - 40]]) {
    g.beginPath();
    g.arc(x, y, 4, 0, Math.PI * 2);
    g.fill();
  }
  // Soft glow behind the mark.
  const glow = g.createRadialGradient(S / 2, S / 2, 8, S / 2, S / 2, S * 0.36);
  glow.addColorStop(0, "rgba(255,255,255,.55)");
  glow.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = glow;
  g.fillRect(0, 0, S, S);
  // The "?": deep outline, drop shadow, gradient fill, top highlight.
  g.font = "900 172px 'Inter', 'Arial Black', sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  const x = S / 2 + 2, y = S / 2 + 12;
  g.lineJoin = "round";
  g.lineWidth = 22;
  g.strokeStyle = "rgba(20,24,80,.55)";
  g.strokeText("?", x, y + 7);
  g.lineWidth = 16;
  g.strokeStyle = "#2140c8";
  g.strokeText("?", x, y);
  const fill = g.createLinearGradient(0, y - 80, 0, y + 80);
  fill.addColorStop(0, "#ffffff");
  fill.addColorStop(0.55, "#fff4c2");
  fill.addColorStop(1, "#ffc63a");
  g.fillStyle = fill;
  g.fillText("?", x, y);
  return tex(c, false);
}

/** Four-point sparkle, for glints that orbit pickups. */
export function sparkleTex() {
  const S = 64;
  const [c, g] = canvas(S, S);
  const core = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  core.addColorStop(0, "rgba(255,255,255,1)");
  core.addColorStop(0.18, "rgba(255,255,255,.8)");
  core.addColorStop(0.4, "rgba(255,255,255,.12)");
  core.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = core;
  g.fillRect(0, 0, S, S);
  g.fillStyle = "rgba(255,255,255,.95)";
  for (const [w, h] of [[3, S], [S, 3]]) {
    g.beginPath();
    g.ellipse(S / 2, S / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    g.fill();
  }
  return tex(c, false, false);
}

/** Soft round blob, used for shadows, glows and particles. */
export function blobTex(inner = "rgba(0,0,0,.55)", outer = "rgba(0,0,0,0)") {
  const S = 128;
  const [c, g] = canvas(S, S);
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, inner);
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  return tex(c, false, false);
}

/** Hazard plate: a yellow warning triangle with a bold "!" on a dark plate. */
export function warnTex() {
  const S = 128;
  const [c, g] = canvas(S, S);
  g.fillStyle = "#15182a";
  g.fillRect(0, 0, S, S);
  g.fillStyle = "#ffd21f";
  g.strokeStyle = "#ffd21f";
  g.lineJoin = "round";
  g.lineWidth = 14;
  g.beginPath();
  g.moveTo(S / 2, 20); g.lineTo(S - 16, S - 22); g.lineTo(16, S - 22); g.closePath();
  g.fill(); g.stroke();
  g.fillStyle = "#15182a";
  g.font = "900 64px 'Inter', 'Arial Black', sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("!", S / 2, S * 0.62);
  return tex(c, false);
}

/** Striped bollard sleeve. */
export function stripeTex(a: string, b: string, n = 4) {
  const [c, g] = canvas(64, 256);
  for (let i = 0; i < n * 2; i++) {
    g.fillStyle = i % 2 ? b : a;
    const h = 256 / (n * 2);
    g.fillRect(0, i * h, 64, h + 1);
  }
  return tex(c);
}

/** A wide banner with bold lettering. */
export function bannerTex(text: string, bg: string, fg: string, w = 1024, h = 192, sub?: string) {
  const [c, g] = canvas(w, h);
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, bg);
  grad.addColorStop(1, shade(bg, -0.25));
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  g.fillStyle = "rgba(255,255,255,.9)";
  g.fillRect(0, 0, w, h * 0.07);
  g.fillRect(0, h * 0.93, w, h * 0.07);
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = `900 ${Math.round(h * (sub ? 0.46 : 0.58))}px 'Inter', 'Arial Black', sans-serif`;
  g.lineWidth = h * 0.06;
  g.strokeStyle = shade(bg, -0.5);
  const y = sub ? h * 0.4 : h * 0.54;
  g.strokeText(text, w / 2, y);
  g.fillStyle = fg;
  g.fillText(text, w / 2, y);
  if (sub) {
    g.font = `700 ${Math.round(h * 0.2)}px 'Inter', sans-serif`;
    g.fillStyle = "rgba(255,255,255,.92)";
    g.fillText(sub, w / 2, h * 0.76);
  }
  return tex(c, false);
}

/** A jumbotron frame showing an image with a caption. */
export function screenTex(img: HTMLImageElement | null, caption: string, bg: string) {
  const W = 512, H = 288;
  const [c, g] = canvas(W, H);
  const grad = g.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, bg);
  grad.addColorStop(1, shade(bg, -0.45));
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  // Scanline shimmer so it reads as a screen, not a poster.
  g.fillStyle = "rgba(255,255,255,.05)";
  for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 2);
  if (img && img.complete && img.naturalWidth) {
    const s = H * 0.92;
    g.drawImage(img, W * 0.02, H * 0.06, s, s);
  }
  g.textAlign = "left";
  g.textBaseline = "middle";
  const lines = caption.split("\n");
  // Shrink the caption until the longest line fits beside the picture.
  let size = 58;
  const room = W * 0.43;
  do {
    g.font = `900 ${size}px 'Inter', 'Arial Black', sans-serif`;
    size -= 2;
  } while (size > 24 && Math.max(...lines.map((l) => g.measureText(l).width)) > room);
  g.fillStyle = "#ffffff";
  g.lineWidth = 8;
  g.strokeStyle = "rgba(10,20,60,.6)";
  lines.forEach((ln, i) => {
    const y = H * 0.36 + i * 64;
    g.strokeText(ln, W * 0.54, y);
    g.fillText(ln, W * 0.54, y);
  });
  g.fillStyle = "#ff4d6d";
  g.beginPath();
  g.arc(W - 40, 34, 10, 0, Math.PI * 2);
  g.fill();
  g.font = "700 22px 'Inter', sans-serif";
  g.fillStyle = "#ffffff";
  g.fillText("LIVE", W - 104, 35);
  return tex(c, false);
}

/**
 * Painted crowd for the stadium tiers: rows of fans in Dlicom colours with
 * heads, shoulders, raised arms, scarves and flags. Returns the colour map
 * and a matching glow map (phone screens and glow-sticks) so the stands
 * sparkle at dusk.
 */
export function crowdTex() {
  const W = 1024, H = 512;
  const [c, g] = canvas(W, H);
  const [e, ge] = canvas(W, H);
  ge.fillStyle = "#000";
  ge.fillRect(0, 0, W, H);
  const r = rand(7);
  const shirts = ["#3d63ff", "#ffc21a", "#e447d2", "#ffffff", "#2ec27e", "#ff5c5c", "#6b8cff", "#ff9f43", "#1d2233"];
  const skins = ["#ffd7b5", "#e9b48c", "#c98e62", "#8d5a3b", "#f3c7a1"];
  const rows = 10, rowH = H / rows;
  for (let row = 0; row < rows; row++) {
    const y0 = row * rowH;
    // Seat row: stand colour with a lip.
    const sg = g.createLinearGradient(0, y0, 0, y0 + rowH);
    sg.addColorStop(0, "#22306e");
    sg.addColorStop(1, "#141c47");
    g.fillStyle = sg;
    g.fillRect(0, y0, W, rowH);
    g.fillStyle = "rgba(120,150,255,.25)";
    g.fillRect(0, y0 + rowH - 5, W, 3);
    for (let x = 4 + r() * 8; x < W - 4; x += 15 + r() * 7) {
      if (r() < 0.07) continue; // the odd empty seat
      // Fans sit in team-colour sections, like real stadium blocks.
      const section = ["#3d63ff", "#ffc21a", "#3d63ff", "#e447d2", "#ffffff", "#3d63ff", "#ffc21a", "#2ec27e"][Math.floor(x / 128) % 8];
      const shirt = r() < 0.72 ? section : shirts[Math.floor(r() * shirts.length)];
      const skin = skins[Math.floor(r() * skins.length)];
      const by = y0 + rowH * 0.62;
      // Body.
      g.fillStyle = shirt;
      g.beginPath();
      g.ellipse(x, by, 7, 9, 0, Math.PI, 0);
      g.fill();
      g.fillRect(x - 7, by, 14, rowH * 0.3);
      // Head and hair.
      g.fillStyle = skin;
      g.beginPath();
      g.arc(x, by - 13, 5.2, 0, Math.PI * 2);
      g.fill();
      if (r() < 0.6) {
        g.fillStyle = ["#2a1b12", "#5a3a22", "#e8c070", "#111"][Math.floor(r() * 4)];
        g.beginPath();
        g.arc(x, by - 15, 5.2, Math.PI, 0);
        g.fill();
      }
      const k = r();
      if (k < 0.3) {
        // Arms up, cheering.
        g.strokeStyle = skin;
        g.lineWidth = 3;
        g.lineCap = "round";
        g.beginPath();
        g.moveTo(x - 5, by - 3); g.lineTo(x - 9, by - 20);
        g.moveTo(x + 5, by - 3); g.lineTo(x + 9, by - 20);
        g.stroke();
        if (r() < 0.45) {
          // A phone held up: bright screen.
          g.fillStyle = "#dff3ff";
          g.fillRect(x + 7, by - 26, 4, 6);
          ge.fillStyle = "#cfe8ff";
          ge.fillRect(x + 7, by - 26, 4, 6);
        }
      } else if (k < 0.42) {
        // Glow-stick in Dlicom yellow or blue.
        const col = r() < 0.5 ? "#ffd84a" : "#6fb2ff";
        g.strokeStyle = col;
        g.lineWidth = 3;
        g.beginPath();
        g.moveTo(x + 6, by - 4); g.lineTo(x + 10, by - 22);
        g.stroke();
        ge.strokeStyle = col;
        ge.lineWidth = 4;
        ge.beginPath();
        ge.moveTo(x + 6, by - 4); ge.lineTo(x + 10, by - 22);
        ge.stroke();
      } else if (k < 0.5) {
        // A little flag.
        g.strokeStyle = "#dddddd";
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(x + 6, by); g.lineTo(x + 6, by - 26);
        g.stroke();
        g.fillStyle = r() < 0.5 ? "#3d63ff" : "#ffd84a";
        g.fillRect(x + 6, by - 26, 12, 8);
      } else if (k < 0.58) {
        // Scarf.
        g.fillStyle = r() < 0.5 ? "#ffd84a" : "#3d63ff";
        g.fillRect(x - 6, by - 7, 12, 3);
      }
    }
  }
  const t = tex(c);
  const glowT = tex(e);
  return { map: t, glow: glowT };
}

/** Stadium tier concrete with seat rows, for the parts the crowd doesn't cover. */
export function seatsTex() {
  const [c, g] = canvas(128, 128);
  g.fillStyle = "#e9eefc";
  g.fillRect(0, 0, 128, 128);
  for (let y = 0; y < 128; y += 16) {
    g.fillStyle = "#3a6df0";
    g.fillRect(0, y + 4, 128, 8);
  }
  return tex(c);
}

/** Water ripples for the river under the jump. */
export function waterTex() {
  const S = 256;
  const [c, g] = canvas(S, S);
  g.fillStyle = "#2fa9ff";
  g.fillRect(0, 0, S, S);
  const r = rand(21);
  g.strokeStyle = "rgba(255,255,255,.45)";
  g.lineWidth = 3;
  g.lineCap = "round";
  for (let i = 0; i < 40; i++) {
    const x = r() * S, y = r() * S, w = 10 + r() * 26;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + w / 2, y - 5, x + w, y);
    g.stroke();
  }
  return tex(c);
}

/** Shift a hex colour lighter (+) or darker (-). */
export function shade(hex: string, amt: number) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, gg = (n >> 8) & 255, b = n & 255;
  const f = (v: number) => Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt);
  r = f(r); gg = f(gg); b = f(b);
  return `#${((1 << 24) | (r << 16) | (gg << 8) | b).toString(16).slice(1)}`;
}

/* ------------------------------------------------------------------ */
/* Kart detail                                                         */
/* ------------------------------------------------------------------ */

/** Carbon-fibre weave for floors, wings and the diffuser. */
export function carbonTex() {
  const S = 128;
  const [c, g] = canvas(S, S);
  g.fillStyle = "#15171f";
  g.fillRect(0, 0, S, S);
  const n = 8, q = S / n;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const horiz = (x + y) % 2 === 0;
      const grad = horiz ? g.createLinearGradient(x * q, 0, x * q + q, 0) : g.createLinearGradient(0, y * q, 0, y * q + q);
      grad.addColorStop(0, "#1c1f2a");
      grad.addColorStop(0.5, "#343949");
      grad.addColorStop(1, "#1c1f2a");
      g.fillStyle = grad;
      g.fillRect(x * q + 1, y * q + 1, q - 2, q - 2);
    }
  }
  const t = tex(c);
  t.repeat.set(3, 3);
  return t;
}

/** Tyre: tread blocks across the running surface, lettering on the walls. */
export function tyreTex() {
  const W = 1024, H = 128;
  const [c, g] = canvas(W, H);
  g.fillStyle = "#22242d";
  g.fillRect(0, 0, W, H);
  // Running surface is the middle band of the lathe profile.
  g.fillStyle = "#15161c";
  for (let x = 0; x < W; x += 32) {
    g.beginPath();
    g.moveTo(x, H * 0.3);
    g.lineTo(x + 14, H * 0.5);
    g.lineTo(x, H * 0.7);
    g.lineTo(x + 8, H * 0.7);
    g.lineTo(x + 22, H * 0.5);
    g.lineTo(x + 8, H * 0.3);
    g.closePath();
    g.fill();
  }
  g.fillStyle = "#3a3d49";
  g.font = "900 22px 'Inter', 'Arial Black', sans-serif";
  g.textBaseline = "middle";
  for (let x = 20; x < W; x += 256) {
    g.fillText("DLICOM", x, H * 0.12);
    g.fillText("DLICOM", x + 128, H * 0.9);
  }
  const t = tex(c);
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** Rim face: six spokes, bolts and a centre cap, drawn flat and spun at runtime. */
export function rimTex(spoke: string, cap: string) {
  const S = 256;
  const [c, g] = canvas(S, S);
  const R = S / 2;
  // Transparent between the spokes: the brake disc and caliper modelled
  // behind the rim show through.
  g.clearRect(0, 0, S, S);
  // Spokes.
  for (let i = 0; i < 6; i++) {
    g.save();
    g.translate(R, R);
    g.rotate((i / 6) * Math.PI * 2);
    const grad = g.createLinearGradient(-18, 0, 18, 0);
    grad.addColorStop(0, shade(spoke, -0.25));
    grad.addColorStop(0.5, shade(spoke, 0.25));
    grad.addColorStop(1, shade(spoke, -0.25));
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(-14, 26);
    g.lineTo(14, 26);
    g.lineTo(26, R - 8);
    g.lineTo(-26, R - 8);
    g.closePath();
    g.fill();
    g.restore();
  }
  // Outer lip.
  g.lineWidth = 14;
  g.strokeStyle = "#e6eaf5";
  g.beginPath();
  g.arc(R, R, R - 8, 0, Math.PI * 2);
  g.stroke();
  // Centre cap and bolts.
  g.fillStyle = cap;
  g.beginPath();
  g.arc(R, R, 30, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#e6eaf5";
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    g.beginPath();
    g.arc(R + Math.cos(a) * 19, R + Math.sin(a) * 19, 4, 0, Math.PI * 2);
    g.fill();
  }
  g.font = "900 34px 'Inter', 'Arial Black', sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = "#ffffff";
  g.fillText("D", R + 1, R + 2);
  const t = tex(c, false);
  t.center.set(0.5, 0.5);
  return t;
}

/** Side-pod livery: a speed stripe, the Dlicom D and a race number. */
export function podDecalTex(stripe: string, badge: string, number: string) {
  const W = 512, H = 192;
  const [c, g] = canvas(W, H);
  g.clearRect(0, 0, W, H);
  // Speed stripe that tapers towards the back.
  g.fillStyle = stripe;
  g.beginPath();
  g.moveTo(0, H * 0.62);
  g.lineTo(W * 0.62, H * 0.5);
  g.lineTo(W, H * 0.5);
  g.lineTo(W, H * 0.66);
  g.lineTo(W * 0.62, H * 0.66);
  g.lineTo(0, H * 0.76);
  g.closePath();
  g.fill();
  g.fillStyle = "rgba(255,255,255,.85)";
  g.fillRect(W * 0.08, H * 0.8, W * 0.5, 5);
  // Number roundel.
  const cx = W * 0.78, cy = H * 0.45, r = H * 0.36;
  g.fillStyle = "#ffffff";
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 8;
  g.strokeStyle = badge;
  g.stroke();
  g.fillStyle = "#15161f";
  g.font = "900 italic 92px 'Inter', 'Arial Black', sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(number, cx, cy + 5);
  g.font = "900 44px 'Inter', 'Arial Black', sans-serif";
  g.fillStyle = "#ffffff";
  g.textAlign = "left";
  g.fillText("DLICOM", W * 0.08, H * 0.36);
  return tex(c, false);
}

/** Text across the rear wing. */
export function wingTex(bg: string, fg: string, text = "DLICOM") {
  const W = 512, H = 96;
  const [c, g] = canvas(W, H);
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  g.fillStyle = fg;
  g.font = "900 italic 64px 'Inter', 'Arial Black', sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, W / 2, H / 2 + 3);
  return tex(c, false);
}

/** Small driver-screen on the dashboard. */
export function dashTex(color: string) {
  const W = 128, H = 64;
  const [c, g] = canvas(W, H);
  g.fillStyle = "#050814";
  g.fillRect(0, 0, W, H);
  g.strokeStyle = color;
  g.lineWidth = 5;
  g.beginPath();
  g.arc(W / 2, H * 0.95, H * 0.7, Math.PI * 1.1, Math.PI * 1.9);
  g.stroke();
  g.fillStyle = color;
  g.font = "900 22px 'Inter', sans-serif";
  g.textAlign = "center";
  g.fillText("GO", W / 2, H * 0.78);
  return tex(c, false);
}

/** Stone blocks in a running bond, for the jump abutments. */
export function stoneTex() {
  const S = 256;
  const [c, g] = canvas(S, S);
  g.fillStyle = "#3a3d52";
  g.fillRect(0, 0, S, S);
  const r = rand(33);
  const rows = 6, bh = S / rows;
  for (let row = 0; row < rows; row++) {
    const off = row % 2 ? 0.5 : 0;
    const n = 3;
    for (let k = -1; k <= n; k++) {
      const x = (k + off) * (S / n);
      const shadeV = 0.85 + r() * 0.3;
      const base = [Math.round(98 * shadeV), Math.round(104 * shadeV), Math.round(132 * shadeV)];
      const grad = g.createLinearGradient(0, row * bh, 0, row * bh + bh);
      grad.addColorStop(0, `rgb(${base[0] + 22},${base[1] + 22},${base[2] + 26})`);
      grad.addColorStop(1, `rgb(${base[0] - 12},${base[1] - 12},${base[2] - 8})`);
      g.fillStyle = grad;
      g.fillRect(x + 3, row * bh + 3, S / n - 6, bh - 6);
    }
  }
  speckle(g, S, S, 1800, ["rgba(255,255,255,.08)", "rgba(0,0,0,.12)"], 9);
  return tex(c);
}

/* ------------------------------------------------------------------ */
/* Neon Town                                                           */
/* ------------------------------------------------------------------ */

/** Square paving slabs with dark joints. */
export function pavingTex() {
  const S = 256;
  const [c, g] = canvas(S, S);
  g.fillStyle = "#7e8398";
  g.fillRect(0, 0, S, S);
  speckle(g, S, S, 4000, ["#737890", "#8a8fa4", "#6c7188"], 21);
  g.strokeStyle = "#3b3f52";
  g.lineWidth = 4;
  for (let i = 0; i <= 4; i++) {
    g.beginPath(); g.moveTo(i * 64, 0); g.lineTo(i * 64, S); g.stroke();
    g.beginPath(); g.moveTo(0, i * 64); g.lineTo(S, i * 64); g.stroke();
  }
  return tex(c);
}

/**
 * Roughness for rain-soaked tarmac (green channel): mostly damp, with dark
 * glassy puddles that turn into mirrors for the neon.
 */
export function wetTex() {
  const S = 512;
  const [c, g] = canvas(S, S);
  g.fillStyle = "rgb(0,120,0)";
  g.fillRect(0, 0, S, S);
  const r = rand(77);
  for (let i = 0; i < 26; i++) {
    const x = r() * S, y = r() * S, rad = 20 + r() * 70;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, "rgba(0,52,0,1)");
    gr.addColorStop(0.7, "rgba(0,70,0,.7)");
    gr.addColorStop(1, "rgba(0,120,0,0)");
    g.fillStyle = gr;
    g.beginPath();
    g.ellipse(x, y, rad, rad * (0.4 + r() * 0.5), r() * 3, 0, Math.PI * 2);
    g.fill();
  }
  // Streaky drying marks along the lanes.
  g.globalAlpha = 0.25;
  for (let i = 0; i < 60; i++) {
    g.fillStyle = r() < 0.5 ? "rgb(0,170,0)" : "rgb(0,60,0)";
    g.fillRect(r() * S, r() * S, 2 + r() * 5, 30 + r() * 120);
  }
  g.globalAlpha = 1;
  const t = tex(c, true, false);
  return t;
}

/** Concrete jersey barrier with hazard chevrons along the foot. */
export function barrierTex() {
  const W = 256, H = 64;
  const [c, g] = canvas(W, H);
  g.fillStyle = "#b8bccb";
  g.fillRect(0, 0, W, H);
  speckle(g, W, H, 1500, ["#a9adbd", "#c6cad8", "#9ea2b3"], 31);
  g.fillStyle = "#23263a";
  g.fillRect(0, H - 16, W, 16);
  g.fillStyle = "#ffd84a";
  for (let x = -16; x < W; x += 32) {
    g.beginPath();
    g.moveTo(x, H); g.lineTo(x + 12, H - 16); g.lineTo(x + 24, H - 16); g.lineTo(x + 12, H);
    g.fill();
  }
  g.fillStyle = "rgba(0,0,0,.25)";
  for (let x = 0; x < W; x += 64) g.fillRect(x, 0, 2, H - 16);
  return tex(c);
}

/**
 * Tower facades: a colour map (cladding, mullions, dark glass) and a glow
 * map with a scatter of lit windows, warm and cool. One tile is a 12 m
 * square: four floors of four bays.
 */
export function facadeTex(variant: number) {
  const S = 512;
  const [c, g] = canvas(S, S);
  const [c2, g2] = canvas(S, S);
  // Roughness (green): matte cladding, glossy glass that mirrors the neon.
  const [c3, g3] = canvas(S, S);
  g3.fillStyle = "rgb(0,215,0)";
  g3.fillRect(0, 0, S, S);
  const clad = ["#23273d", "#3a2c3e", "#1f2c3a", "#34323f"][variant];
  const glassC = ["#0b1130", "#140d22", "#0a1822", "#12121d"][variant];
  g.fillStyle = clad;
  g.fillRect(0, 0, S, S);
  speckle(g, S, S, 3000, ["rgba(255,255,255,.04)", "rgba(0,0,0,.12)"], 50 + variant);
  g2.fillStyle = "#000";
  g2.fillRect(0, 0, S, S);
  const r = rand(100 + variant * 7);
  const rows = variant === 1 ? 5 : 4, cols = variant === 0 ? 8 : variant === 3 ? 5 : 6;
  const cw = S / cols, rh = S / rows;
  // Floor slabs.
  g.fillStyle = "rgba(255,255,255,.07)";
  for (let y = 0; y < rows; y++) g.fillRect(0, y * rh + rh - 10, S, 6);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const inset = variant === 0 ? 3 : variant === 1 ? 14 : 9;
      const px = x * cw + inset, py = y * rh + 12, w = cw - inset * 2, h = rh - 30;
      g.fillStyle = glassC;
      g.fillRect(px, py, w, h);
      g3.fillStyle = "rgb(0,28,0)";
      g3.fillRect(px, py, w, h);
      g.fillStyle = "rgba(150,170,255,.07)";
      g.beginPath();
      g.moveTo(px, py + h); g.lineTo(px + w * 0.5, py); g.lineTo(px + w * 0.75, py); g.lineTo(px + w * 0.25, py + h);
      g.fill();
      const k = r();
      if (k < 0.3) {
        const warm = k < 0.22;
        const col = warm ? (r() < 0.6 ? "#ffc873" : "#ffe0a6") : (r() < 0.5 ? "#7fc4ff" : "#b89cff");
        const a = 0.35 + r() * 0.5;
        g2.globalAlpha = a;
        const gr = g2.createLinearGradient(0, py, 0, py + h);
        gr.addColorStop(0, col);
        gr.addColorStop(1, "#000");
        g2.fillStyle = col;
        g2.fillRect(px, py, w, h);
        g2.globalAlpha = a * 0.8;
        g2.fillStyle = gr;
        g2.fillRect(px, py + h * 0.5, w, h * 0.5);
        g2.globalAlpha = 1;
        g2.fillStyle = "rgba(0,0,0,.6)";
        const kind = r();
        if (kind < 0.35) for (let b = 0; b < h; b += 6) g2.fillRect(px, py + b, w, 2);
        else if (kind < 0.6) { g2.fillRect(px + w * 0.25, py + h * 0.4, w * 0.18, h * 0.6); g2.fillRect(px + w * 0.21, py + h * 0.3, w * 0.26, h * 0.14); }
        else if (kind < 0.8) g2.fillRect(px, py, w * 0.5, h);
        g.fillStyle = col;
        g.globalAlpha = 0.25;
        g.fillRect(px, py, w, h);
        g.globalAlpha = 1;
      }
      // Mullion and sill.
      g.fillStyle = "rgba(0,0,0,.35)";
      g.fillRect(px + w / 2 - 1, py, 2, h);
      g.fillStyle = "rgba(255,255,255,.1)";
      g.fillRect(px - 2, py + h, w + 4, 3);
    }
  }
  if (variant === 3) {
    // Vertical fins.
    g.fillStyle = "rgba(255,255,255,.08)";
    for (let x = 0; x < cols; x++) g.fillRect(x * cw - 3, 0, 6, S);
  }
  return { map: tex(c), glow: tex(c2), rough: tex(c3, true, false) };
}

/** A street-level shopfront: two lit shop windows, each with a neon name. */
export function shopfrontTex(a: string, b: string, neon: string) {
  const W = 512, H = 160;
  const [c, g] = canvas(W, H);
  g.fillStyle = "#15161f";
  g.fillRect(0, 0, W, H);
  [a, b].forEach((name, i) => {
    const x0 = i * (W / 2) + 8, w = W / 2 - 16;
    // Sign band.
    g.fillStyle = "#0b0c14";
    g.fillRect(x0, 6, w, 42);
    g.font = "900 30px 'Inter', 'Arial Black', sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.shadowColor = i ? neon : "#ffd28a";
    g.shadowBlur = 14;
    g.fillStyle = i ? neon : "#ffe2a8";
    g.fillText(name, x0 + w / 2, 28);
    g.shadowBlur = 0;
    // Warm interior behind glass, with shelves and a door.
    const gr = g.createLinearGradient(0, 54, 0, H);
    gr.addColorStop(0, "#ffe6b8");
    gr.addColorStop(1, "#ffb86b");
    g.fillStyle = gr;
    g.fillRect(x0, 54, w, H - 60);
    g.fillStyle = "rgba(60,30,20,.35)";
    for (let s = 70; s < H - 10; s += 22) g.fillRect(x0 + 8, s, w * 0.55, 4);
    g.fillStyle = "#2a1c18";
    g.fillRect(x0 + w * 0.7, 62, w * 0.22, H - 68);
    g.strokeStyle = "#0b0c14";
    g.lineWidth = 4;
    g.strokeRect(x0, 54, w, H - 60);
  });
  return tex(c, false);
}

/** A neon sign: vertical blade (letters stacked) or a horizontal board. */
export function bladeSignTex(text: string, neon: string, horizontal = false) {
  const W = horizontal ? 512 : 96, H = horizontal ? 96 : 384;
  const [c, g] = canvas(W, H);
  g.fillStyle = "#0b0c14";
  g.fillRect(0, 0, W, H);
  g.strokeStyle = neon;
  g.lineWidth = 5;
  g.shadowColor = neon;
  g.shadowBlur = 12;
  g.strokeRect(6, 6, W - 12, H - 12);
  g.fillStyle = "#ffffff";
  g.textAlign = "center";
  g.textBaseline = "middle";
  if (horizontal) {
    g.font = "900 italic 58px 'Inter', 'Arial Black', sans-serif";
    g.fillStyle = neon;
    g.fillText(text, W / 2, H / 2 + 2);
    g.shadowBlur = 0;
    g.fillStyle = "rgba(255,255,255,.85)";
    g.font = "900 italic 58px 'Inter', 'Arial Black', sans-serif";
    g.globalAlpha = 0.6;
    g.fillText(text, W / 2, H / 2 + 2);
  } else {
    const letters = text.replace(/\s+/g, "").slice(0, 7).split("");
    const step = (H - 40) / letters.length;
    g.font = `900 ${Math.min(56, step * 0.9)}px 'Inter', 'Arial Black', sans-serif`;
    letters.forEach((ch, i) => {
      g.fillStyle = neon;
      g.fillText(ch, W / 2, 24 + step * (i + 0.5));
      g.shadowBlur = 0;
      g.globalAlpha = 0.55;
      g.fillStyle = "#ffffff";
      g.fillText(ch, W / 2, 24 + step * (i + 0.5));
      g.globalAlpha = 1;
      g.shadowBlur = 12;
    });
  }
  g.globalAlpha = 1;
  return tex(c, false);
}
