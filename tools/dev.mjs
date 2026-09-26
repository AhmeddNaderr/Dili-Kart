// Starts the local API (Cloudflare Pages Functions + D1 via Wrangler) and the
// Vite dev server together. Ctrl+C stops both.
import { spawn, spawnSync } from "node:child_process";

const npx = process.platform === "win32" ? "npx.cmd" : "npx";

// Make sure the local database has the latest schema. Safe to run every time.
spawnSync(npx, ["wrangler", "d1", "migrations", "apply", "dili-cart", "--local"], { stdio: "ignore" });

const procs = [
  spawn(npx, ["wrangler", "pages", "dev", "public", "--port", "8788", "--ip", "127.0.0.1"], { stdio: ["ignore", "ignore", "inherit"] }),
  spawn(npx, ["vite"], { stdio: "inherit" }),
];
const stop = () => { for (const p of procs) p.kill(); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const p of procs) p.on("exit", stop);
