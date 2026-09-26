// Renders the intro film (dev only). Needs the dev server running
// (`npm run dev:web`), Playwright with Chromium, and ffmpeg with libx264
// (pass its path in FFMPEG, or have it on PATH).
//
//   node tools/render-intro.cjs            render every frame, then encode
//   FROM=400 node tools/render-intro.cjs   resume: frames before 400 are
//                                          simulated but not drawn again
//
// Frames go to .intro-frames/ (git-ignored); the finished film goes to
// public/intro/: dili-intro.mp4 (1080p), dili-intro-720.mp4 and a poster.
const { chromium } = require(process.env.PLAYWRIGHT ?? "playwright");
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const FRAMES = path.join(ROOT, ".intro-frames");
const OUT = path.join(ROOT, "public/intro");
const PAGE = process.env.PAGE ?? "http://localhost:5173/intro.html";
const FFMPEG = process.env.FFMPEG ?? "ffmpeg";
const FROM = Number(process.env.FROM ?? 0);

(async () => {
  fs.mkdirSync(FRAMES, { recursive: true });
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  if (process.env.FONTS) {
    // Serve Google Fonts from local files when the network can't reach them.
    const dir = process.env.FONTS;
    await ctx.route("https://fonts.googleapis.com/**", (r) => {
      let css = "";
      for (const w of [400, 600, 700, 800, 900]) for (const st of ["normal", "italic"])
        css += `@font-face{font-family:'Inter';font-style:${st};font-weight:${w};font-display:block;src:url(https://fonts.gstatic.com/local/inter-latin-${w}-${st}.woff2) format('woff2');}\n`;
      r.fulfill({ status: 200, contentType: "text/css", body: css });
    });
    await ctx.route("https://fonts.gstatic.com/**", (r) => {
      const f = path.join(dir, path.basename(new URL(r.request().url()).pathname));
      if (fs.existsSync(f)) r.fulfill({ status: 200, contentType: "font/woff2", body: fs.readFileSync(f), headers: { "access-control-allow-origin": "*" } });
      else r.abort();
    });
  }
  const page = await ctx.newPage();
  page.setDefaultTimeout(0);
  page.on("pageerror", (e) => console.error("page error:", e.message));
  await page.goto(PAGE);
  await page.waitForFunction(() => window.__intro, null, { timeout: 0 });
  const { frames, fps } = await page.evaluate(() => ({ frames: window.__intro.frames, fps: window.__intro.fps }));
  console.log(`${frames} frames at ${fps} fps`);

  if (!fs.existsSync(path.join(FRAMES, "score.wav"))) {
    const wav = await page.evaluate(() => window.__intro.audio());
    fs.writeFileSync(path.join(FRAMES, "score.wav"), Buffer.from(wav, "base64"));
    console.log("soundtrack done");
  }

  if (FROM > 0) await page.evaluate((n) => { for (let k = 0; k < n; k++) window.__intro.frame(k, false); }, FROM);
  const t0 = Date.now();
  for (let i = FROM; i < frames; i++) {
    const url = await page.evaluate((k) => window.__intro.frame(k, true), i);
    fs.writeFileSync(path.join(FRAMES, `${String(i).padStart(5, "0")}.jpg`), Buffer.from(url.split(",")[1], "base64"));
    if (i % 15 === 0) {
      const per = (Date.now() - t0) / 1000 / (i - FROM + 1);
      console.log(`frame ${i}/${frames} · ${per.toFixed(1)} s/frame · ~${Math.round(per * (frames - i) / 60)} min left`);
    }
  }
  await browser.close();

  console.log("encoding…");
  const input = ["-y", "-framerate", String(fps), "-i", path.join(FRAMES, "%05d.jpg"), "-i", path.join(FRAMES, "score.wav")];
  const enc = (scale, crf, file) => execFileSync(FFMPEG, [
    ...input, ...(scale ? ["-vf", `scale=${scale}:flags=lanczos`] : []),
    "-c:v", "libx264", "-preset", "slow", "-crf", String(crf), "-pix_fmt", "yuv420p", "-profile:v", "high",
    "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", path.join(OUT, file),
  ], { stdio: "inherit" });
  enc(null, 20, "dili-intro.mp4");
  enc("1280:720", 22, "dili-intro-720.mp4");
  // Poster: the logo, from near the end.
  const poster = String(Math.round(frames - fps * 2.2)).padStart(5, "0");
  execFileSync(FFMPEG, ["-y", "-i", path.join(FRAMES, `${poster}.jpg`), "-vf", "scale=1280:720", "-q:v", "3", path.join(OUT, "poster.jpg")], { stdio: "inherit" });
  console.log("done");
})().catch((e) => { console.error(e); process.exit(1); });
