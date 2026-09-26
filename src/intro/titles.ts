/**
 * Titles for the intro film, drawn over each finished frame on a 2D canvas:
 * a quiet caption at the open, and the DILI CART logo lockup at the end.
 */

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const outBack = (x: number) => { const c = 1.9, k = clamp01(x) - 1; return 1 + (c + 1) * k * k * k + c * k * k; };
const outCubic = (x: number) => 1 - Math.pow(1 - clamp01(x), 3);

export class Titles {
  /** Letter fills go here first so the light sweep only touches the letters. */
  private layer = document.createElement("canvas");
  private lg: CanvasRenderingContext2D;

  constructor(private g: CanvasRenderingContext2D, private w: number, private h: number) {
    this.layer.width = w;
    this.layer.height = h;
    this.lg = this.layer.getContext("2d")!;
  }

  /** Small spaced caption, bottom left, fading in and out over `dur`. */
  caption(top: string, bottom: string, lt: number, dur: number) {
    const g = this.g;
    const a = clamp01(lt / 0.6) * clamp01((dur - lt) / 0.6);
    if (a <= 0) return;
    g.save();
    g.globalAlpha = a;
    g.shadowColor = "rgba(0,0,0,.55)";
    g.shadowBlur = 18;
    g.fillStyle = "#ffd84a";
    g.font = "800 22px Inter, sans-serif";
    g.letterSpacing = "6px";
    g.fillText(top, 110, this.h - 150 + (1 - outCubic(lt / 0.8)) * 14);
    g.fillStyle = "#ffffff";
    g.font = "800 44px Inter, sans-serif";
    g.letterSpacing = "1px";
    g.fillText(bottom, 108, this.h - 100 + (1 - outCubic((lt - 0.1) / 0.8)) * 18);
    g.restore();
  }

  /**
   * The logo: DILI (chrome) CART (gold) in heavy italic, letters springing
   * in one by one with an extruded edge, then a light sweep; the Dlicom
   * Grand Prix line fades in underneath.
   */
  logo(lt: number, fade = 1) {
    const g = this.g;
    if (lt <= 0 || fade <= 0) return;
    const size = 250;
    const cx = this.w / 2, cy = this.h * 0.42;
    g.save();
    g.globalAlpha = fade;
    g.font = `italic 900 ${size}px Inter, sans-serif`;
    g.textBaseline = "alphabetic";
    g.letterSpacing = "-10px";
    const word = "DILI CART";
    const widths = [...word].map((c) => g.measureText(c).width - 10);
    const total = widths.reduce((a, b) => a + b, 0);
    let x = cx - total / 2;
    const base = cy + size * 0.35;
    // A soft dark glow behind the whole word so it reads over the sky.
    g.save();
    const grd = g.createRadialGradient(cx, cy, 40, cx, cy, 760);
    grd.addColorStop(0, `rgba(6,8,30,${0.5 * clamp01(lt / 0.6)})`);
    grd.addColorStop(1, "rgba(6,8,30,0)");
    g.fillStyle = grd;
    g.fillRect(0, 0, this.w, this.h);
    g.restore();
    const lg = this.lg;
    lg.clearRect(0, 0, this.w, this.h);
    lg.font = g.font;
    lg.textBaseline = "alphabetic";
    lg.letterSpacing = "-10px";
    [...word].forEach((ch, i) => {
      const w = widths[i];
      if (ch !== " ") {
        const k = (lt - 0.1 - i * 0.07) / 0.55;
        if (k > 0) {
          const s = 0.55 + 0.45 * outBack(k);
          const gold = i >= 5;
          const lx = x + w / 2;
          const place = (c: CanvasRenderingContext2D) => {
            c.translate(lx, base);
            c.scale(s, s);
            c.translate(-w / 2, (1 - outCubic(k)) * 60);
          };
          const alpha = clamp01(k * 2);
          // Extrusion: stacked copies in darker tones, then the drop shadow.
          g.save();
          place(g);
          g.globalAlpha = fade * alpha;
          const ext = gold ? ["#e39200", "#b56800", "#7c4400"] : ["#8795c9", "#5d6899", "#3c4470"];
          g.shadowColor = "rgba(0,0,0,.5)";
          g.shadowBlur = 40;
          g.shadowOffsetY = 26;
          g.fillStyle = ext[2];
          g.fillText(ch, 0, 16);
          g.shadowColor = "transparent";
          g.fillStyle = ext[1];
          g.fillText(ch, 0, 11);
          g.fillStyle = ext[0];
          g.fillText(ch, 0, 5);
          g.restore();
          // The face of the letter, on the layer.
          lg.save();
          place(lg);
          lg.globalAlpha = alpha;
          const fill = lg.createLinearGradient(0, -size * 0.75, 0, 10);
          if (gold) {
            fill.addColorStop(0, "#fffbe6"); fill.addColorStop(0.3, "#ffe680"); fill.addColorStop(0.62, "#ffc21f"); fill.addColorStop(1, "#ff9500");
          } else {
            fill.addColorStop(0, "#ffffff"); fill.addColorStop(0.4, "#f4f6ff"); fill.addColorStop(0.72, "#c8d1f2"); fill.addColorStop(1, "#97a4d6");
          }
          lg.fillStyle = fill;
          lg.fillText(ch, 0, 0);
          lg.restore();
        }
      }
      x += w;
    });
    // A band of light sweeps across the letters, left to right.
    const sweep = (lt - 1.15) / 0.9;
    if (sweep > 0 && sweep < 1) {
      lg.save();
      lg.globalCompositeOperation = "source-atop";
      const sx = cx - total / 2 - 200 + sweep * (total + 400);
      const sh = lg.createLinearGradient(sx - 90, 0, sx + 90, 0);
      sh.addColorStop(0, "rgba(255,255,255,0)");
      sh.addColorStop(0.5, "rgba(255,255,255,.85)");
      sh.addColorStop(1, "rgba(255,255,255,0)");
      lg.fillStyle = sh;
      lg.setTransform(1, 0, -0.35, 1, 0, 0);
      lg.fillRect(sx - 90 + base * 0.35, 0, 180, this.h);
      lg.restore();
    }
    g.save();
    g.globalAlpha = fade;
    g.drawImage(this.layer, 0, 0);
    g.restore();
    // Subtitle.
    const k2 = clamp01((lt - 0.9) / 0.6);
    if (k2 > 0) {
      g.globalAlpha = fade * k2;
      g.font = "800 34px Inter, sans-serif";
      g.letterSpacing = "14px";
      g.textAlign = "center";
      g.fillStyle = "#ffffff";
      g.shadowColor = "rgba(0,0,0,.6)";
      g.shadowBlur = 16;
      g.fillText("DLICOM GRAND PRIX", cx + 7, base + 90 + (1 - outCubic(k2)) * 12);
      // Thin rules either side.
      g.shadowBlur = 0;
      g.fillStyle = "#ffd84a";
      const rw = 120 * outCubic(k2);
      g.fillRect(cx - 290 - rw, base + 78, rw, 3);
      g.fillRect(cx + 290, base + 78, rw, 3);
    }
    g.restore();
  }
}
