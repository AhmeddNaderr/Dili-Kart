/**
 * The loading screen from index.html: Dili's kart drives along the road as
 * `progress` climbs, then crosses the flag and the screen wipes away.
 */

const el = () => document.getElementById("loader");
const shownAt = performance.now();
let current = 0.04;

export function progress(p: number, message?: string) {
  const l = el();
  if (!l) return;
  current = Math.max(current, Math.min(1, p));
  l.style.setProperty("--p", current.toFixed(3));
  const pct = document.getElementById("ld-pct");
  if (pct) pct.textContent = `${Math.round(current * 100)}%`;
  if (message) {
    const m = document.getElementById("ld-msg");
    if (m) m.textContent = message;
  }
}

/**
 * Finish: fill the bar, let the kart cross the line, fade out. Waits for
 * the loader to have been up for at least `minMs`, so the animation is
 * seen rather than flashed.
 */
export async function finishLoader(minMs = 1500) {
  const l = el();
  if (!l) return;
  progress(1, "Ready!");
  const wait = Math.max(0, minMs - (performance.now() - shownAt));
  await new Promise((r) => setTimeout(r, wait + 350));
  l.classList.add("done");
  await new Promise((r) => setTimeout(r, 420));
  l.classList.add("out");
  setTimeout(() => l.remove(), 800);
}

/** Dev shortcuts skip the show. */
export function dropLoader() {
  el()?.remove();
}
