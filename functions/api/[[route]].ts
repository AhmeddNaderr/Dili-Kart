/**
 * Dili Cart API — one Cloudflare Pages Function handling every /api/* route,
 * backed by a D1 (SQLite) database.
 *
 *   POST /api/signup       { handle, password }        → { token, player }
 *   POST /api/login        { handle, password }        → { token, player }
 *   POST /api/logout                                   → { }
 *   GET  /api/me                                       → { player }
 *   POST /api/race         { score, position, time, coins } → RaceReply
 *   POST /api/char         { char }                    → { player }
 *   GET  /api/leaderboard?by=best|points               → { entries, me }
 *   GET  /api/stats                                    → { players, races }
 *
 * Passwords are hashed with PBKDF2-SHA256 and a per-user salt. Sessions are
 * random tokens; only their SHA-256 hash is stored.
 */

import {
  CHAR_UNLOCK, PASSWORD_MAX, PASSWORD_MIN, RACE_LIMITS, isCharId, normaliseHandle,
  streakMultiplier, tierOf, type BoardEntry, type PlayerDTO, type RaceReply,
} from "../../shared/rules";

/* ---- Minimal D1 / Pages types, so no extra type packages are needed ---- */
interface D1Stmt {
  bind(...values: unknown[]): D1Stmt;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}
interface D1Database {
  prepare(sql: string): D1Stmt;
  batch(stmts: D1Stmt[]): Promise<unknown[]>;
}
interface Env {
  DB: D1Database;
  /** Optional override for the PBKDF2 work factor. */
  PBKDF2_ITERATIONS?: string;
}
interface Ctx {
  request: Request;
  env: Env;
}

interface PlayerRow {
  handle: string;
  pass: string;
  created_at: number;
  points: number;
  best: number;
  best_time: number | null;
  races: number;
  wins: number;
  podiums: number;
  streak: number;
  last_day: string;
  last_race_at: number;
  char: string;
}

const SESSION_DAYS = 60;
const enc = new TextEncoder();

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export const onRequest = async (ctx: Ctx): Promise<Response> => {
  try {
    return await route(ctx);
  } catch (e) {
    if (e instanceof HttpError) return json({ ok: false, error: e.message }, e.status);
    console.error(e);
    return json({ ok: false, error: "Something went wrong. Try again." }, 500);
  }
};

async function route({ request, env }: Ctx): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");
  const m = request.method;

  if (m === "POST" && path === "signup") return signup(request, env);
  if (m === "POST" && path === "login") return login(request, env);
  if (m === "POST" && path === "logout") return logout(request, env);
  if (m === "GET" && path === "me") {
    const p = await authed(request, env);
    return json({ ok: true, player: dto(p) });
  }
  if (m === "POST" && path === "race") return race(request, env);
  if (m === "POST" && path === "char") return setChar(request, env);
  if (m === "GET" && path === "leaderboard") return board(request, env, url);
  if (m === "GET" && path === "stats") return json({ ok: true, ...(await stats(env, url)) });
  if (m === "GET" && path === "health") {
    await env.DB.prepare("SELECT 1").first();
    return json({ ok: true });
  }
  throw new HttpError(404, "Not found");
}

/* ------------------------------------------------------------------ */
/* Accounts                                                            */
/* ------------------------------------------------------------------ */

async function signup(req: Request, env: Env) {
  const body = await readJson(req);
  const handle = normaliseHandle(String(body.handle ?? ""));
  const password = String(body.password ?? "");
  if (!handle) throw new HttpError(400, "Handles are 3–15 letters, numbers or underscores.");
  checkPassword(password);
  await limit(env, `signup:${clientIp(req)}`, 6, 3600, "Too many new accounts from here. Try again later.");
  // Housekeeping: old rate-limit windows are no longer needed.
  await env.DB.prepare("DELETE FROM attempts WHERE window < ?").bind(Math.floor(Date.now() / 1000) - 86_400).run();

  const exists = await env.DB.prepare("SELECT 1 FROM players WHERE handle = ?").bind(handle).first();
  if (exists) throw new HttpError(409, "That handle is already taken. Log in instead?");

  const pass = await hashPassword(password, iterations(env));
  const now = Date.now();
  await env.DB.prepare("INSERT INTO players (handle, pass, created_at) VALUES (?, ?, ?)").bind(handle, pass, now).run();
  const token = await newSession(env, handle);
  const player = await getPlayer(env, handle);
  return json({ ok: true, token, player: dto(player!) });
}

async function login(req: Request, env: Env) {
  const body = await readJson(req);
  const handle = normaliseHandle(String(body.handle ?? ""));
  const password = String(body.password ?? "");
  if (!handle || !password) throw new HttpError(400, "Enter your handle and password.");
  await limit(env, `login:${handle}`, 8, 600, "Too many attempts. Wait a few minutes and try again.");

  const player = await getPlayer(env, handle);
  // Hash even when the handle doesn't exist, so timing doesn't reveal it.
  const ok = player
    ? await verifyPassword(password, player.pass)
    : (await hashPassword(password, iterations(env)), false);
  if (!player || !ok) throw new HttpError(401, "Wrong handle or password.");

  // Quietly upgrade old hashes when the work factor changes.
  const iters = Number(player.pass.split("$")[1]);
  if (iters < iterations(env)) {
    await env.DB.prepare("UPDATE players SET pass = ? WHERE handle = ?").bind(await hashPassword(password, iterations(env)), handle).run();
  }
  const token = await newSession(env, handle);
  return json({ ok: true, token, player: dto(player) });
}

async function logout(req: Request, env: Env) {
  const token = bearer(req);
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
  return json({ ok: true });
}

async function setChar(req: Request, env: Env) {
  const p = await authed(req, env);
  const body = await readJson(req);
  if (!isCharId(body.char)) throw new HttpError(400, "Unknown driver.");
  if (p.points < CHAR_UNLOCK[body.char]) throw new HttpError(403, "That driver is still locked.");
  await env.DB.prepare("UPDATE players SET char = ? WHERE handle = ?").bind(body.char, p.handle).run();
  return json({ ok: true, player: dto({ ...p, char: body.char }) });
}

/* ------------------------------------------------------------------ */
/* Races and the board                                                 */
/* ------------------------------------------------------------------ */

async function race(req: Request, env: Env) {
  const p = await authed(req, env);
  const b = await readJson(req);
  const rid = typeof b.rid === "string" && /^[0-9a-f]{16,32}$/.test(b.rid) ? b.rid : null;
  if (rid) {
    // Already recorded (a retry after a dropped connection): answer as if new.
    const seen = await env.DB.prepare("SELECT earned FROM races WHERE rid = ?").bind(rid).first<{ earned: number }>();
    if (seen) {
      const ahead = await env.DB.prepare("SELECT COUNT(*) AS n FROM players WHERE best > ?").bind(p.best).first<{ n: number }>();
      const reply: RaceReply = { player: dto(p), earned: seen.earned, multiplier: streakMultiplier(p.streak), isBest: false, rank: (ahead?.n ?? 0) + 1 };
      return json({ ok: true, ...reply });
    }
  }
  const score = Math.round(Number(b.score));
  const position = Math.round(Number(b.position));
  const time = Number(b.time);
  const coins = Math.round(Number(b.coins));
  const L = RACE_LIMITS;
  if (!(score >= 0 && score <= L.maxScore)) throw new HttpError(400, "That score isn't possible.");
  if (!(position >= 1 && position <= 8)) throw new HttpError(400, "Bad finishing position.");
  if (!(time >= L.minTime && time <= L.maxTime)) throw new HttpError(400, "That race time isn't possible.");
  if (!(coins >= 0 && coins <= L.maxCoins)) throw new HttpError(400, "Bad coin count.");

  const now = Date.now();
  if (now - p.last_race_at < L.cooldown * 1000) throw new HttpError(429, "Races can't finish that quickly.");

  // Daily streak, on UTC days.
  const today = utcDay(now);
  const yesterday = utcDay(now - 86_400_000);
  const streak = p.last_day === today ? Math.max(1, p.streak) : p.last_day === yesterday ? p.streak + 1 : 1;
  const multiplier = streakMultiplier(streak);
  const earned = Math.round(score * multiplier);
  const isBest = score > p.best;
  const bestTime = p.best_time === null ? time : Math.min(p.best_time, time);

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE players SET points = points + ?, best = MAX(best, ?), best_time = ?, races = races + 1,
         wins = wins + ?, podiums = podiums + ?, streak = ?, last_day = ?, last_race_at = ?
       WHERE handle = ?`,
    ).bind(earned, score, bestTime, position === 1 ? 1 : 0, position <= 3 ? 1 : 0, streak, today, now, p.handle),
    env.DB.prepare(
      "INSERT INTO races (handle, score, position, time, coins, earned, created_at, rid) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(p.handle, score, position, time, coins, earned, now, rid),
  ]);

  const fresh = (await getPlayer(env, p.handle))!;
  const ahead = await env.DB.prepare("SELECT COUNT(*) AS n FROM players WHERE best > ?").bind(fresh.best).first<{ n: number }>();
  const reply: RaceReply = { player: dto(fresh), earned, multiplier, isBest, rank: (ahead?.n ?? 0) + 1 };
  return json({ ok: true, ...reply });
}

async function board(req: Request, env: Env, url: URL) {
  const by = url.searchParams.get("by") === "points" ? "points" : "best";
  const entries = await topList(env, url, by);

  // Where the signed-in player stands, even if they're outside the top 50.
  let me: { rank: number; value: number } | null = null;
  const token = bearer(req);
  if (token) {
    const p = await sessionPlayer(env, token);
    if (p && p.races > 0) {
      const value = by === "points" ? p.points : p.best;
      const ahead = await env.DB.prepare(`SELECT COUNT(*) AS n FROM players WHERE ${by} > ?`).bind(value).first<{ n: number }>();
      me = { rank: (ahead?.n ?? 0) + 1, value };
    }
  }
  return json({ ok: true, entries, me });
}

/**
 * The top 50, cached at the edge for 15 seconds. Under a rush of players
 * the database answers this query a few times a minute instead of on every
 * page view.
 */
async function topList(env: Env, url: URL, by: "best" | "points"): Promise<BoardEntry[]> {
  const cache = (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default;
  const key = new Request(`${url.origin}/api/_board/${by}`);
  if (cache) {
    const hit = await cache.match(key).catch(() => undefined);
    if (hit) return hit.json();
  }
  const rows = await env.DB.prepare(
    `SELECT handle, best, points, races, wins FROM players WHERE races > 0
     ORDER BY ${by} DESC, created_at ASC LIMIT 50`,
  ).all<Omit<BoardEntry, "tier">>();
  const entries: BoardEntry[] = rows.results.map((r) => ({ ...r, tier: tierOf(r.points) }));
  if (cache) {
    await cache.put(key, new Response(JSON.stringify(entries), {
      headers: { "content-type": "application/json", "cache-control": "public, max-age=15" },
    })).catch(() => undefined);
  }
  return entries;
}

/** Totals for the landing page, cached at the edge for 30 seconds. */
async function stats(env: Env, url: URL): Promise<{ players: number; races: number }> {
  const cache = (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default;
  const key = new Request(`${url.origin}/api/_stats`);
  if (cache) {
    const hit = await cache.match(key).catch(() => undefined);
    if (hit) return hit.json();
  }
  const row = await env.DB.prepare(
    "SELECT (SELECT COUNT(*) FROM players) AS players, (SELECT COUNT(*) FROM races) AS races",
  ).first<{ players: number; races: number }>();
  const out = { players: row?.players ?? 0, races: row?.races ?? 0 };
  if (cache) {
    await cache.put(key, new Response(JSON.stringify(out), {
      headers: { "content-type": "application/json", "cache-control": "public, max-age=30" },
    })).catch(() => undefined);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (text.length > 4096) throw new HttpError(413, "Request too large.");
  try {
    const v = JSON.parse(text || "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    throw new HttpError(400, "Bad request.");
  }
}

function checkPassword(pw: string) {
  if (pw.length < PASSWORD_MIN) throw new HttpError(400, `Passwords need at least ${PASSWORD_MIN} characters.`);
  if (pw.length > PASSWORD_MAX) throw new HttpError(400, `Passwords can be at most ${PASSWORD_MAX} characters.`);
}

function clientIp(req: Request) {
  return req.headers.get("cf-connecting-ip") ?? "local";
}

function bearer(req: Request) {
  const h = req.headers.get("authorization") ?? "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() : "";
}

async function getPlayer(env: Env, handle: string) {
  return env.DB.prepare("SELECT * FROM players WHERE handle = ?").bind(handle).first<PlayerRow>();
}

async function sessionPlayer(env: Env, token: string) {
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  return env.DB.prepare(
    `SELECT p.* FROM sessions s JOIN players p ON p.handle = s.handle
     WHERE s.token_hash = ? AND s.expires > ?`,
  ).bind(await sha256(token), Date.now()).first<PlayerRow>();
}

async function authed(req: Request, env: Env): Promise<PlayerRow> {
  const token = bearer(req);
  const p = token ? await sessionPlayer(env, token) : null;
  if (!p) throw new HttpError(401, "Please log in again.");
  return p;
}

async function newSession(env: Env, handle: string) {
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO sessions (token_hash, handle, expires) VALUES (?, ?, ?)")
      .bind(await sha256(token), handle, now + SESSION_DAYS * 86_400_000),
    // Housekeeping: drop this player's expired sessions.
    env.DB.prepare("DELETE FROM sessions WHERE handle = ? AND expires < ?").bind(handle, now),
  ]);
  return token;
}

/** Fixed-window rate limit. Throws once `max` hits land inside `windowSec`. */
async function limit(env: Env, key: string, max: number, windowSec: number, message: string) {
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare("SELECT count, window FROM attempts WHERE key = ?").bind(key).first<{ count: number; window: number }>();
  if (!row || now - row.window >= windowSec) {
    await env.DB.prepare("INSERT OR REPLACE INTO attempts (key, count, window) VALUES (?, 1, ?)").bind(key, now).run();
    return;
  }
  if (row.count >= max) throw new HttpError(429, message);
  await env.DB.prepare("UPDATE attempts SET count = count + 1 WHERE key = ?").bind(key).run();
}

function dto(p: PlayerRow): PlayerDTO {
  return {
    handle: p.handle,
    points: p.points,
    best: p.best,
    bestTime: p.best_time,
    races: p.races,
    wins: p.wins,
    podiums: p.podiums,
    streak: p.streak,
    char: isCharId(p.char) ? p.char : "dili",
    tier: tierOf(p.points),
  };
}

function iterations(env: Env) {
  const n = Number(env.PBKDF2_ITERATIONS);
  // The free Workers plan allows ~10 ms of CPU per request, and PBKDF2 is
  // pure CPU. 12k iterations fits comfortably; on the paid plan set
  // PBKDF2_ITERATIONS higher and old hashes upgrade on their next log-in.
  return Number.isFinite(n) && n >= 10_000 && n <= 100_000 ? Math.round(n) : 12_000;
}

async function pbkdf2(password: string, salt: Uint8Array<ArrayBuffer>, iters: number) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iters }, key, 256);
  return new Uint8Array(bits);
}

async function hashPassword(password: string, iters: number) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, iters);
  return `pbkdf2$${iters}$${b64(salt)}$${b64(hash)}`;
}

async function verifyPassword(password: string, stored: string) {
  const [kind, it, s, h] = stored.split("$");
  if (kind !== "pbkdf2") return false;
  const want = unb64(h);
  const got = await pbkdf2(password, unb64(s), Number(it));
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got[i] ^ want[i];
  return diff === 0;
}

async function sha256(s: string) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s))));
}

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const unb64 = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const utcDay = (t: number) => new Date(t).toISOString().slice(0, 10);
