/**
 * Motion graphics for the trailer, drawn on a 2D canvas over the game
 * footage: kinetic type, speech-bubble tags, wipes, flashes, speed lines,
 * countdown numbers, character cards and the end card. Dlicom look: ink
 * black, gold, electric blue, hot pink, heavy italic Inter.
 */

export const W = 1920;
export const H = 1080;

export const COL = {
  ink: "#0b0c14",
  gold: "#ffd84a",
  gold2: "#ffb800",
  blue: "#3d63ff",
  blue2: "#6b8cff",
  pink: "#e447d2",
  teal: "#2ee6c9",
  white: "#ffffff",
};

/* ---------- easing ---------- */
export const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
export const outCubic = (x: number) => 1 - Math.pow(1 - clamp01(x), 3);
export const inCubic = (x: number) => Math.pow(clamp01(x), 3);
export const inOutCubic = (x: number) => { x = clamp01(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
export const outExpo = (x: number) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * clamp01(x)));
export const outBack = (x: number, s = 1.9) => { x = clamp01(x); const c = s + 1; return 1 + c * Math.pow(x - 1, 3) + s * Math.pow(x - 1, 2); };

const font = (size: number, weight = 900, italic = true) => `${italic ? "italic " : ""}${weight} ${size}px Inter, "Arial Black", sans-serif`;

function rrect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: [number, number, number, number]) {
  g.beginPath();
  g.moveTo(x + r[0], y);
  g.lineTo(x + w - r[1], y); g.quadraticCurveTo(x + w, y, x + w, y + r[1]);
  g.lineTo(x + w, y + h - r[2]); g.quadraticCurveTo(x + w, y + h, x + w - r[2], y + h);
  g.lineTo(x + r[3], y + h); g.quadraticCurveTo(x, y + h, x, y + h - r[3]);
  g.lineTo(x, y + r[0]); g.quadraticCurveTo(x, y, x + r[0], y);
  g.closePath();
}

export function loadImage(svg: string, size: number): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(
    svg.replace("<svg ", `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" `),
  );
  return img.decode().then(() => img);
}

export class Gfx {
  readonly g: CanvasRenderingContext2D;
  private grain: HTMLCanvasElement[] = [];
  private vig: CanvasGradient;
  constructor(readonly canvas: HTMLCanvasElement, private logo: HTMLImageElement, private faces: HTMLImageElement[]) {
    this.g = canvas.getContext("2d", { alpha: false })!;
    // Film grain tiles, cycled per frame.
    for (let k = 0; k < 4; k++) {
      const c = document.createElement("canvas");
      c.width = c.height = 256;
      const x = c.getContext("2d")!;
      const im = x.createImageData(256, 256);
      for (let i = 0; i < im.data.length; i += 4) {
        const v = Math.random() * 255;
        im.data[i] = im.data[i + 1] = im.data[i + 2] = v;
        im.data[i + 3] = 255;
      }
      x.putImageData(im, 0, 0);
      this.grain.push(c);
    }
    const v = this.g.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.95);
    v.addColorStop(0, "rgba(0,0,0,0)");
    v.addColorStop(1, "rgba(0,0,0,0.55)");
    this.vig = v;
  }

  /** The game frame, with zoom punch, shake and optional darkening. */
  footage(src: CanvasImageSource, zoom = 1, sx = 0, sy = 0, dim = 0) {
    const g = this.g;
    g.fillStyle = "#000";
    g.fillRect(0, 0, W, H);
    const w = W * zoom, h = H * zoom;
    g.drawImage(src, (W - w) / 2 + sx, (H - h) / 2 + sy, w, h);
    if (dim > 0) {
      g.fillStyle = `rgba(4,5,11,${dim})`;
      g.fillRect(0, 0, W, H);
    }
  }

  finish(frame: number, grain = 0.05) {
    const g = this.g;
    g.fillStyle = this.vig;
    g.fillRect(0, 0, W, H);
    g.save();
    g.globalAlpha = grain;
    g.globalCompositeOperation = "overlay";
    g.fillStyle = g.createPattern(this.grain[frame % 4], "repeat")!;
    g.fillRect(0, 0, W, H);
    g.restore();
  }

  black(a: number) {
    if (a <= 0) return;
    this.g.fillStyle = `rgba(0,0,0,${clamp01(a)})`;
    this.g.fillRect(0, 0, W, H);
  }

  flash(a: number, color = "255,255,255") {
    if (a <= 0) return;
    const g = this.g;
    g.save();
    g.globalCompositeOperation = "lighter";
    g.fillStyle = `rgba(${color},${clamp01(a)})`;
    g.fillRect(0, 0, W, H);
    g.restore();
  }

  letterbox(k: number) {
    const h = H * 0.11 * clamp01(k);
    if (h <= 0) return;
    this.g.fillStyle = "#000";
    this.g.fillRect(0, 0, W, h);
    this.g.fillRect(0, H - h, W, h);
  }

  /** Speed lines streaming out from the centre. */
  speedLines(t: number, k: number) {
    if (k <= 0) return;
    const g = this.g;
    g.save();
    g.lineCap = "round";
    for (let i = 0; i < 70; i++) {
      const a = (i * 2.399) % (Math.PI * 2);
      const ph = ((t * 2.2 + i * 0.137) % 1);
      const r0 = 380 + ph * 900;
      const len = 90 + (i % 5) * 50;
      const alpha = Math.sin(ph * Math.PI) * 0.42 * k;
      g.strokeStyle = `rgba(255,255,255,${alpha})`;
      g.lineWidth = 2 + (i % 3);
      g.beginPath();
      g.moveTo(W / 2 + Math.cos(a) * r0, H / 2 + Math.sin(a) * r0 * 0.62);
      g.lineTo(W / 2 + Math.cos(a) * (r0 + len), H / 2 + Math.sin(a) * (r0 + len) * 0.62);
      g.stroke();
    }
    g.restore();
  }

  /** Diagonal colour bands sweeping across: p runs 0 → 1, the cut sits at 0.5. */
  wipe(p: number) {
    if (p <= 0 || p >= 1) return;
    const g = this.g;
    const cols = [COL.blue, COL.gold, COL.pink, COL.ink];
    g.save();
    cols.forEach((c, i) => {
      const k = inOutCubic(clamp01((p - i * 0.06) / 0.76));
      const x = lerp(-W * 1.1, W * 1.5, k);
      g.fillStyle = c;
      g.beginPath();
      const bw = W * 0.55;
      g.moveTo(x, 0); g.lineTo(x + bw, 0); g.lineTo(x + bw - H * 0.5, H); g.lineTo(x - H * 0.5, H);
      g.closePath();
      g.fill();
    });
    g.restore();
  }

  /**
   * Kinetic type: letters spring up one after another, with a solid ink
   * block shadow for a chunky 3D look. `out` is when they leave.
   */
  kinetic(text: string, x: number, y: number, size: number, t: number, o: {
    align?: "left" | "center" | "right"; fill?: "white" | "gold" | string; stagger?: number; out?: number; shadow?: boolean; stroke?: boolean;
  } = {}) {
    if (t < 0) return;
    const g = this.g;
    g.save();
    g.font = font(size);
    g.textBaseline = "alphabetic";
    const total = g.measureText(text).width;
    let x0 = o.align === "center" ? x - total / 2 : o.align === "right" ? x - total : x;
    const stagger = o.stagger ?? 0.03;
    const fill = o.fill && o.fill !== "gold" ? o.fill : "#fff";
    let gold: CanvasGradient | null = null;
    if (o.fill === "gold") {
      gold = g.createLinearGradient(0, y - size * 0.8, 0, y + size * 0.1);
      gold.addColorStop(0, "#fff6c2"); gold.addColorStop(0.45, COL.gold); gold.addColorStop(1, COL.gold2);
    }
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const adv = g.measureText(text.slice(0, i + 1)).width - g.measureText(text.slice(0, i)).width;
      const lt = t - i * stagger;
      if (lt > 0 && ch !== " ") {
        const k = outBack(lt / 0.42);
        let a = clamp01(lt / 0.1);
        let dy = (1 - k) * size * 0.75;
        let dx = 0;
        if (o.out !== undefined && t > o.out) {
          const e = inCubic((t - o.out - i * stagger * 0.5) / 0.3);
          a *= 1 - e;
          dx = -e * size * 0.8;
          dy -= e * size * 0.2;
        }
        if (a > 0) {
          g.globalAlpha = a;
          const cx = x0 + dx, cy = y + dy;
          if (o.shadow !== false) {
            g.fillStyle = COL.ink;
            g.fillText(ch, cx + size * 0.045, cy + size * 0.06);
          }
          if (o.stroke) {
            g.lineWidth = size * 0.05;
            g.strokeStyle = "#fff";
            g.strokeText(ch, cx, cy);
          } else {
            g.fillStyle = gold ?? fill ?? "#fff";
            g.fillText(ch, cx, cy);
          }
        }
      }
      x0 += adv;
    }
    g.restore();
    return total;
  }

  /** A Dlicom speech-bubble tag that pops in (and out at `out`). */
  bubble(text: string, x: number, y: number, size: number, t: number, o: { bg?: string; fg?: string; out?: number; align?: "left" | "center" } = {}) {
    if (t < 0) return;
    const g = this.g;
    let s = outBack(t / 0.38, 2.4);
    if (o.out !== undefined && t > o.out) s *= 1 - inCubic((t - o.out) / 0.2);
    if (s <= 0.001) return;
    g.save();
    g.font = font(size, 900, false);
    const tw = g.measureText(text).width;
    const pw = size * 0.75, ph = size * 0.45;
    const w = tw + pw * 2, h = size + ph * 2;
    const ax = o.align === "center" ? x : x + w / 2;
    g.translate(ax, y);
    g.scale(s, s);
    g.translate(-w / 2, -h / 2);
    g.fillStyle = o.bg ?? COL.gold;
    g.shadowColor = "rgba(0,0,0,.35)";
    g.shadowBlur = 24;
    g.shadowOffsetY = 8;
    rrect(g, 0, 0, w, h, [h / 2, h / 2, h / 2, h * 0.16]);
    g.fill();
    g.beginPath();
    g.moveTo(h * 0.3, h - 2); g.lineTo(h * 0.12, h + h * 0.38); g.lineTo(h * 0.75, h - 2);
    g.fill();
    g.shadowColor = "transparent";
    g.fillStyle = o.fg ?? COL.ink;
    g.textBaseline = "middle";
    g.fillText(text, pw, h / 2 + size * 0.04);
    g.restore();
  }

  /** A big number with a label under it, stamped in. */
  stamp(big: string, small: string, x: number, y: number, t: number, out?: number) {
    if (t < 0) return;
    const g = this.g;
    let s = outBack(t / 0.3, 2.2);
    let a = clamp01(t / 0.08);
    if (out !== undefined && t > out) { const e = inCubic((t - out) / 0.25); a *= 1 - e; s *= 1 + e * 0.3; }
    if (a <= 0) return;
    g.save();
    g.globalAlpha = a;
    g.translate(x, y);
    g.scale(s, s);
    g.textAlign = "center";
    g.font = font(170);
    g.fillStyle = COL.ink;
    g.fillText(big, 8, 10);
    const grad = g.createLinearGradient(0, -140, 0, 0);
    grad.addColorStop(0, "#fff6c2"); grad.addColorStop(0.5, COL.gold); grad.addColorStop(1, COL.gold2);
    g.fillStyle = grad;
    g.fillText(big, 0, 0);
    g.font = font(44, 900, false);
    g.fillStyle = "#fff";
    g.fillText(small, 0, 62);
    g.restore();
  }

  /** Countdown number with a shock ring. */
  countdown(label: string, t: number, color: string) {
    if (t < 0 || t > 1) return;
    const g = this.g;
    const s = lerp(2.2, 1, outExpo(t / 0.35));
    const a = t < 0.75 ? 1 : 1 - (t - 0.75) / 0.25;
    g.save();
    g.globalAlpha = clamp01(a);
    // Ring.
    const r = lerp(80, 620, outCubic(t / 0.6));
    g.lineWidth = lerp(40, 2, outCubic(t / 0.6));
    g.strokeStyle = color;
    g.beginPath(); g.arc(W / 2, H / 2, r, 0, Math.PI * 2); g.stroke();
    g.translate(W / 2, H / 2 + 120);
    g.scale(s, s);
    g.textAlign = "center";
    g.font = font(label.length > 1 ? 300 : 380);
    g.fillStyle = COL.ink;
    g.fillText(label, 14, 18);
    g.fillStyle = color;
    g.fillText(label, 0, 0);
    g.lineWidth = 8;
    g.strokeStyle = "#fff";
    g.strokeText(label, 0, 0);
    g.restore();
  }

  /** The Dlicom mark and "DLICOM PRESENTS". */
  logoReveal(t: number) {
    if (t < 0) return;
    const g = this.g;
    const s = outBack(t / 0.7, 1.4);
    const a = clamp01(t / 0.25) * (t > 1.7 ? 1 - (t - 1.7) / 0.3 : 1);
    g.save();
    g.globalAlpha = clamp01(a);
    // Glow ring.
    const r = lerp(40, 260, outExpo(t / 1.2));
    const glow = g.createRadialGradient(W / 2, H / 2 - 40, 0, W / 2, H / 2 - 40, r * 1.3);
    glow.addColorStop(0, "rgba(61,99,255,.55)");
    glow.addColorStop(1, "rgba(61,99,255,0)");
    g.fillStyle = glow;
    g.fillRect(0, 0, W, H);
    g.translate(W / 2, H / 2 - 40);
    g.scale(s, s);
    g.rotate((1 - outCubic(t / 0.8)) * -0.6);
    g.drawImage(this.logo, -130, -104, 260, 208);
    g.restore();
    // Letter-spaced line.
    const lt = t - 0.55;
    if (lt > 0) {
      g.save();
      g.globalAlpha = clamp01(lt / 0.4) * clamp01(a);
      g.font = font(34, 800, false);
      g.textAlign = "center";
      g.fillStyle = "#fff";
      const sp = lerp(40, 22, outCubic(lt / 1));
      const txt = "D L I C O M   P R E S E N T S";
      g.letterSpacing = `${sp * 0.2}px`;
      g.fillText(txt, W / 2, H / 2 + 150);
      g.restore();
    }
  }

  /** The stadium's LED ticker, as a band across the frame. */
  ticker(t: number, y: number, a: number) {
    if (a <= 0) return;
    const g = this.g;
    g.save();
    g.globalAlpha = clamp01(a);
    g.translate(0, y);
    g.rotate(-0.02);
    g.fillStyle = "rgba(5,6,14,.92)";
    g.fillRect(-20, -34, W + 40, 68);
    g.fillStyle = COL.blue2;
    g.fillRect(-20, -34, W + 40, 2);
    g.fillRect(-20, 32, W + 40, 2);
    g.font = font(32);
    g.textBaseline = "middle";
    const items: [string, string][] = [["DLICOM", "#fff"], ["DILI CART", "#7fb4ff"], ["$DLI TGE 2027", COL.gold], ["HOLD YOUR KEYS", COL.teal], ["BEAT THE CUSTODIANS", "#ff8fd6"]];
    let x = -((t * 260) % 1400);
    while (x < W + 40) {
      for (const [s, c] of items) {
        g.fillStyle = c;
        g.shadowColor = c; g.shadowBlur = 14;
        g.fillText(s, x, 2);
        x += g.measureText(s).width + 28;
        g.shadowBlur = 0;
        g.fillStyle = COL.blue;
        g.fillText("◆", x, 0);
        x += 56;
      }
    }
    g.restore();
  }

  /** "ULTRA TURBO!" style chip. */
  chip(text: string, x: number, y: number, t: number, color: string) {
    if (t < 0) return;
    const g = this.g;
    const s = outBack(t / 0.25, 2.6);
    g.save();
    g.translate(x, y);
    g.scale(s, s);
    g.rotate(-0.06);
    g.font = font(64);
    const w = g.measureText(text).width + 60;
    g.fillStyle = COL.ink;
    rrect(g, -w / 2 + 8, -48 + 8, w, 96, [48, 48, 48, 14]); g.fill();
    g.fillStyle = color;
    rrect(g, -w / 2, -48, w, 96, [48, 48, 48, 14]); g.fill();
    g.fillStyle = "#fff";
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(text, 0, 4);
    g.restore();
  }

  /** Character select: three cards dealt in. */
  cards(t: number, names: [string, string, string][]) {
    const g = this.g;
    names.forEach(([name, tag, color], i) => {
      const lt = t - 0.35 - i * 0.5;
      if (lt < 0) return;
      const k = outBack(lt / 0.45, 1.6);
      const cw = 380, ch = 470;
      const cx = W / 2 + (i - 1) * 440;
      const cy = H / 2 + 90 + (1 - k) * 500;
      g.save();
      g.translate(cx, cy);
      g.rotate((1 - k) * (i - 1) * 0.4 + (i - 1) * 0.04);
      // Card.
      g.fillStyle = COL.ink;
      rrect(g, -cw / 2 + 10, -ch / 2 + 12, cw, ch, [36, 36, 36, 12]); g.fill();
      const bg = g.createLinearGradient(0, -ch / 2, 0, ch / 2);
      bg.addColorStop(0, "#1c2250"); bg.addColorStop(1, "#0b0e26");
      g.fillStyle = bg;
      rrect(g, -cw / 2, -ch / 2, cw, ch, [36, 36, 36, 12]); g.fill();
      g.lineWidth = 5; g.strokeStyle = color; g.stroke();
      // Glow behind the face.
      const gl = g.createRadialGradient(0, -60, 0, 0, -60, 190);
      gl.addColorStop(0, color + "99"); gl.addColorStop(1, color + "00");
      g.fillStyle = gl; g.fillRect(-cw / 2, -ch / 2, cw, ch);
      const bob = Math.sin((t + i) * 4) * 6;
      g.drawImage(this.faces[i], -130, -210 + bob, 260, 260);
      g.textAlign = "center";
      g.font = font(52);
      g.fillStyle = "#fff";
      g.fillText(name, 0, 130);
      g.font = font(26, 800, false);
      g.fillStyle = color;
      g.fillText(tag.toUpperCase(), 0, 178);
      g.restore();
    });
  }

  /** The end card: DILI CART, the button, the link. */
  endCard(t: number) {
    const g = this.g;
    // Logo slam.
    const s = t < 0.35 ? lerp(2.6, 0.94, outExpo(t / 0.35)) : lerp(0.94, 1, outBack((t - 0.35) / 0.4, 3));
    g.save();
    g.translate(W / 2, H / 2 - 70);
    g.scale(s, s);
    g.textAlign = "center";
    g.font = font(250);
    const a = g.measureText("DILI ").width, b = g.measureText("CART").width;
    const x0 = -(a + b) / 2;
    g.textAlign = "left";
    // Rainbow energy glow.
    g.shadowColor = `hsl(${(t * 120) % 360}, 100%, 60%)`;
    g.shadowBlur = 60;
    g.fillStyle = COL.ink;
    g.fillText("DILI CART", x0 + 14, 16);
    g.shadowBlur = 0;
    g.fillStyle = "#fff";
    g.fillText("DILI ", x0, 0);
    const grad = g.createLinearGradient(0, -200, 0, 10);
    grad.addColorStop(0, "#fff6c2"); grad.addColorStop(0.45, COL.gold); grad.addColorStop(1, COL.gold2);
    g.fillStyle = grad;
    g.fillText("CART", x0 + a, 0);
    // Shine sweep across the letters.
    const sw = ((t - 0.6) / 0.9);
    if (sw > 0 && sw < 1) {
      g.save();
      g.globalCompositeOperation = "source-atop";
      const sx = lerp(x0 - 300, x0 + a + b + 300, sw);
      const sh = g.createLinearGradient(sx - 120, 0, sx + 120, 0);
      sh.addColorStop(0, "rgba(255,255,255,0)"); sh.addColorStop(0.5, "rgba(255,255,255,.9)"); sh.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = sh;
      g.fillRect(x0 - 400, -260, a + b + 800, 320);
      g.restore();
    }
    g.restore();

    // Tagline bubble.
    this.bubble("THE DLICOM GRAND PRIX", W / 2, H / 2 + 60, 40, t - 0.5, { align: "center", bg: COL.blue, fg: "#fff" });

    // Play button.
    const bt = t - 0.9;
    if (bt > 0) {
      const k = outBack(bt / 0.45, 2);
      const bw = 620, bh = 120;
      g.save();
      g.translate(W / 2, H / 2 + 225);
      g.scale(k, k);
      const pulse = 1 + Math.sin(bt * 6) * 0.015;
      g.scale(pulse, pulse);
      // Rainbow ring.
      g.save();
      g.filter = "blur(12px)";
      const ring = g.createConicGradient(bt * 3, 0, 0);
      [COL.gold, COL.pink, "#7b5cff", COL.blue, COL.teal, COL.gold].forEach((c, i, arr) => ring.addColorStop(i / (arr.length - 1), c));
      g.fillStyle = ring;
      rrect(g, -bw / 2 - 10, -bh / 2 - 10, bw + 20, bh + 20, [60, 60, 60, 20]); g.fill();
      g.restore();
      g.fillStyle = "#a86c00";
      rrect(g, -bw / 2, -bh / 2 + 10, bw, bh, [56, 56, 56, 16]); g.fill();
      const bg = g.createLinearGradient(0, -bh / 2, 0, bh / 2);
      bg.addColorStop(0, "#fff3b0"); bg.addColorStop(0.4, COL.gold); bg.addColorStop(1, "#ffba0a");
      g.fillStyle = bg;
      rrect(g, -bw / 2, -bh / 2, bw, bh, [56, 56, 56, 16]); g.fill();
      g.fillStyle = COL.ink;
      g.textAlign = "center"; g.textBaseline = "middle";
      g.font = font(60);
      g.fillText("PLAY FREE NOW", 0, 4);
      g.restore();
    }
    // Link and credit.
    const lt = t - 1.3;
    if (lt > 0) {
      g.save();
      g.globalAlpha = clamp01(lt / 0.3);
      g.textAlign = "center";
      g.font = font(46, 800, false);
      g.fillStyle = "#fff";
      g.fillText("dili-cart.pages.dev", W / 2, H / 2 + 370 + (1 - outCubic(lt / 0.4)) * 30);
      g.font = font(26, 700, false);
      g.fillStyle = "rgba(255,255,255,.7)";
      g.fillText("Made for the @DlicomApp AI Game Jam", W / 2, H / 2 + 420 + (1 - outCubic(lt / 0.4)) * 30);
      g.restore();
    }
  }
}
