/**
 * The intro film, full screen, before the title screen. It starts muted
 * (browsers only allow silent autoplay), with a Sound on key and a Skip
 * key; any key or tap skips. When it ends, or is skipped, it fades away
 * and `done` runs. Shown once per browser session unless asked for again.
 */

const SEEN_KEY = "dilicart.film.session";
const SOUND_KEY = "dilicart.film.sound";

export function filmSeen(): boolean {
  try { return sessionStorage.getItem(SEEN_KEY) === "1"; } catch { return true; }
}

function pickSource() {
  // Phones and small windows get the 720p cut; it's a third of the size.
  const px = Math.max(innerWidth, innerHeight) * Math.min(devicePixelRatio || 1, 2);
  return px >= 1500 ? "intro/dili-intro.mp4" : "intro/dili-intro-720.mp4";
}

/**
 * Start downloading the film before it's shown, reporting how much is
 * buffered (0..1). Resolves with the element once it can play through, or
 * after `maxMs` with whatever has arrived; playFilm takes it from there.
 */
export function prepareFilm(onProgress: (k: number) => void, maxMs = 8000): Promise<HTMLVideoElement> {
  const v = document.createElement("video");
  v.className = "film-v";
  v.playsInline = true;
  v.muted = true;
  v.preload = "auto";
  v.poster = "intro/poster.jpg";
  v.src = pickSource();
  return new Promise((resolve) => {
    let settled = false;
    const done = () => { if (!settled) { settled = true; clearInterval(poll); resolve(v); } };
    const poll = setInterval(() => {
      if (!v.duration || !v.buffered.length) return;
      const k = v.buffered.end(v.buffered.length - 1) / v.duration;
      onProgress(Math.min(1, k / 0.45));
      // Enough to start playing without a stall on most connections.
      if (k >= 0.45) done();
    }, 120);
    v.addEventListener("canplaythrough", done, { once: true });
    v.addEventListener("error", done, { once: true });
    setTimeout(done, maxMs);
    v.load();
  });
}

export function playFilm(done: () => void, ready?: HTMLVideoElement) {
  try { sessionStorage.setItem(SEEN_KEY, "1"); } catch { /* storage blocked */ }
  const el = document.createElement("div");
  el.className = "film";
  el.innerHTML = `
    <div class="film-back" style="background-image:url(intro/poster.jpg)"></div>
    <video class="film-v" playsinline preload="auto" poster="intro/poster.jpg"></video>
    <div class="film-ui">
      <button class="film-key" data-f="sound" aria-label="Sound on">
        <svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path class="w" d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path class="x" d="m16 9 6 6m0-6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        <span>Sound on</span>
      </button>
      <button class="film-key" data-f="skip">Skip <kbd>↵</kbd></button>
    </div>
    <div class="film-bar"><i></i></div>`;
  document.body.appendChild(el);
  let v = el.querySelector<HTMLVideoElement>("video")!;
  if (ready) {
    // Use the element that's already been buffering.
    v.replaceWith(ready);
    v = ready;
  }
  const bar = el.querySelector<HTMLElement>(".film-bar i")!;
  const soundBtn = el.querySelector<HTMLButtonElement>("[data-f=sound]")!;

  let wantSound = false;
  try { wantSound = localStorage.getItem(SOUND_KEY) === "1"; } catch { /* storage blocked */ }
  const setSound = (on: boolean) => {
    v.muted = !on;
    el.classList.toggle("sound", on);
    soundBtn.querySelector("span")!.textContent = on ? "Sound off" : "Sound on";
    soundBtn.setAttribute("aria-label", on ? "Sound off" : "Sound on");
    try { localStorage.setItem(SOUND_KEY, on ? "1" : "0"); } catch { /* storage blocked */ }
  };

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    removeEventListener("keydown", onKey);
    el.classList.add("out");
    // Fade the sound down with the picture.
    const t0 = performance.now(), vol = v.volume;
    const fade = (now: number) => {
      const k = Math.min(1, (now - t0) / 700);
      v.volume = vol * (1 - k);
      if (k < 1) requestAnimationFrame(fade);
    };
    requestAnimationFrame(fade);
    done();
    setTimeout(() => { v.pause(); v.removeAttribute("src"); v.load(); el.remove(); }, 900);
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "m" || e.key === "M") { setSound(v.muted); return; }
    e.preventDefault();
    finish();
  };
  addEventListener("keydown", onKey);
  el.querySelector("[data-f=skip]")!.addEventListener("click", (e) => { e.stopPropagation(); finish(); });
  soundBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    setSound(v.muted);
    if (v.paused) void v.play().catch(() => {});
  });
  // Tapping the picture: if nothing is playing yet (autoplay was blocked),
  // start it with sound; otherwise skip.
  el.addEventListener("click", () => {
    if (v.paused && v.currentTime < 0.1) { setSound(true); void v.play().catch(finish); return; }
    finish();
  });

  v.addEventListener("ended", finish);
  v.addEventListener("error", finish);
  // A preloaded film that already failed (no network, no codec) won't fire again.
  if (v.error) { finish(); return; }
  v.addEventListener("timeupdate", () => { if (v.duration) bar.style.transform = `scaleX(${v.currentTime / v.duration})`; });
  v.addEventListener("playing", () => el.classList.add("on"));

  if (!ready) v.src = pickSource();
  setSound(wantSound);
  void v.play().catch(() => {
    // Sound-on autoplay needs a gesture: try again muted.
    setSound(false);
    return v.play().catch(() => el.classList.add("blocked"));
  });
}
