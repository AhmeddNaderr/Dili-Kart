import {
  CHAR_UNLOCK, SKIN_INFO, isCharId, parseSkins, streakMultiplier, tierOf,
  type BoardEntry, type CharId, type PlayerDTO, type RaceReply, type RaceSubmit, type SkinId,
} from "../../shared/rules";

/**
 * Talks to the Dili Cart API (Cloudflare Pages Functions + D1).
 *
 * Signed-in players keep a session token in localStorage. Guests play with
 * a local-only profile — handy when the API isn't deployed yet, or for a
 * judge who wants to try the game without making an account.
 */

export type Player = PlayerDTO & { guest?: boolean };

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

const TOKEN_KEY = "dilicart.token";
const PLAYER_KEY = "dilicart.player";
const GUEST_KEY = "dilicart.guest";
/** Races that finished while the server couldn't be reached, waiting to sync. */
const PENDING_KEY = "dilicart.pending";

const store = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  del(k: string) { try { localStorage.removeItem(k); } catch { /* private mode */ } },
};

let current: Player | null = null;

export const player = () => current;

/** Profiles saved before the shop existed have no wallet yet. */
function fill(p: Player): Player {
  const skins = parseSkins((p.skins ?? []).join(","));
  return { ...p, coins: Number.isFinite(p.coins) ? p.coins : 0, skins, skin: p.skin && skins.includes(p.skin) ? p.skin : null };
}

function remember(p: Player) {
  p = fill(p);
  current = p;
  store.set(p.guest ? GUEST_KEY : PLAYER_KEY, JSON.stringify(p));
}

/** Network hiccups and server errors are worth another try; 4xx answers aren't. */
const retryable = (e: unknown) => e instanceof ApiError && (e.status === 0 || e.status >= 500);

async function once<T>(path: string, opts: { method?: string; body?: unknown; auth?: boolean }): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  const token = store.get(TOKEN_KEY);
  if (opts.auth && token) headers.authorization = `Bearer ${token}`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 12_000);
  let res: Response;
  try {
    res = await fetch(`api/${path}`, {
      method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: ctl.signal,
    });
  } catch {
    throw new ApiError("Can't reach the Dili Cart server. Check your connection.", 0);
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => null);
  if (!data || typeof data !== "object") throw new ApiError("The server isn't available right now.", res.status >= 500 || !res.status ? res.status || 0 : 503);
  if (!res.ok || !(data as { ok?: boolean }).ok) {
    throw new ApiError((data as { error?: string }).error ?? "Something went wrong.", res.status);
  }
  return data as T;
}

/** A request with up to two retries and a short backoff on transient failures. */
async function call<T>(path: string, opts: { method?: string; body?: unknown; auth?: boolean; retries?: number } = {}): Promise<T> {
  const tries = (opts.retries ?? 2) + 1;
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await once<T>(path, opts);
    } catch (e) {
      last = e;
      if (!retryable(e) || i === tries - 1) break;
      await new Promise((r) => setTimeout(r, 450 * (i + 1) ** 2));
    }
  }
  throw last;
}

/** Is the API reachable? Checked once per page load. */
let health: Promise<boolean> | null = null;
export function serverUp(): Promise<boolean> {
  health ??= fetch("api/health")
    .then((r) => r.ok && r.headers.get("content-type")?.includes("json") === true)
    .catch(() => false);
  return health;
}

/** Restore whoever was playing last time. */
export async function restore(): Promise<Player | null> {
  const token = store.get(TOKEN_KEY);
  if (token) {
    try {
      const { player: p } = await call<{ player: PlayerDTO }>("me", { auth: true });
      remember(p);
      if (readPending().length) void syncPending();
      return p;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        store.del(TOKEN_KEY);
        store.del(PLAYER_KEY);
      } else {
        // Offline: fall back to the cached profile so the game still opens.
        const cached = store.get(PLAYER_KEY);
        if (cached) { current = fill(JSON.parse(cached)); return current; }
      }
    }
  }
  const guest = store.get(GUEST_KEY);
  if (guest) {
    current = fill({ ...JSON.parse(guest), guest: true });
    return current;
  }
  return null;
}

export async function signup(handle: string, password: string): Promise<Player> {
  const r = await call<{ token: string; player: PlayerDTO }>("signup", { body: { handle, password }, retries: 1 });
  store.set(TOKEN_KEY, r.token);
  remember(r.player);
  return r.player;
}

export async function login(handle: string, password: string): Promise<Player> {
  const r = await call<{ token: string; player: PlayerDTO }>("login", { body: { handle, password }, retries: 1 });
  store.set(TOKEN_KEY, r.token);
  remember(r.player);
  return r.player;
}

export async function logout() {
  if (current && !current.guest) await call("logout", { method: "POST", auth: true }).catch(() => undefined);
  store.del(TOKEN_KEY);
  store.del(PLAYER_KEY);
  current = null;
}

/** A local-only profile. Guests race normally but aren't on the global board. */
export function playAsGuest(): Player {
  const saved = store.get(GUEST_KEY);
  const p: Player = saved ? { ...JSON.parse(saved), guest: true } : {
    handle: "guest", points: 0, best: 0, bestTime: null, races: 0, wins: 0, podiums: 0,
    streak: 0, char: "dili", tier: tierOf(0), guest: true, coins: 0, skins: [], skin: null,
  };
  remember(p);
  return p;
}

export async function chooseChar(char: CharId): Promise<Player> {
  const p = current!;
  if (p.points < CHAR_UNLOCK[char]) throw new ApiError("That driver is still locked.", 403);
  if (p.guest) {
    remember({ ...p, char });
    return current!;
  }
  const r = await call<{ player: PlayerDTO }>("char", { body: { char }, auth: true });
  remember(r.player);
  return r.player;
}

/** Buy a skin with Dili coins; it's equipped straight away. */
export async function buySkin(skin: SkinId): Promise<Player> {
  const p = current!;
  if (p.skins.includes(skin)) throw new ApiError("You already own that skin.", 409);
  if (p.coins < SKIN_INFO[skin].price) throw new ApiError("Not enough Dili coins yet.", 402);
  if (p.guest) {
    remember({ ...p, coins: p.coins - SKIN_INFO[skin].price, skins: [...p.skins, skin], skin });
    return current!;
  }
  const r = await call<{ player: PlayerDTO }>("skin/buy", { body: { skin }, auth: true, retries: 0 });
  remember(r.player);
  return current!;
}

/** Wear an owned skin, or null for the squad driver's own kart. */
export async function equipSkin(skin: SkinId | null): Promise<Player> {
  const p = current!;
  if (skin && !p.skins.includes(skin)) throw new ApiError("You don't own that skin.", 403);
  if (p.guest) {
    remember({ ...p, skin });
    return current!;
  }
  const r = await call<{ player: PlayerDTO }>("skin/equip", { body: { skin }, auth: true });
  remember(r.player);
  return current!;
}

type Pending = { rid: string; handle: string; race: RaceSubmit };
const readPending = (): Pending[] => { try { return JSON.parse(store.get(PENDING_KEY) ?? "[]"); } catch { return []; } };
const writePending = (list: Pending[]) => (list.length ? store.set(PENDING_KEY, JSON.stringify(list)) : store.del(PENDING_KEY));
const newRid = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");

/** How many finished races are still waiting to reach the server. */
export const pendingCount = () => readPending().filter((x) => x.handle === current?.handle).length;

/**
 * Send any races that couldn't be saved earlier. Each carries its own id, so
 * a race the server already has is never counted twice.
 */
export async function syncPending(): Promise<number> {
  const p = current;
  if (!p || p.guest || !store.get(TOKEN_KEY)) return 0;
  let sent = 0;
  for (const item of readPending()) {
    if (item.handle !== p.handle) continue;
    try {
      const r = await call<RaceReply>("race", { body: { ...item.race, rid: item.rid }, auth: true, retries: 0 });
      remember(r.player);
      writePending(readPending().filter((x) => x.rid !== item.rid));
      sent++;
    } catch (e) {
      // Still offline, logged out, or too soon after the last race: try later.
      if (retryable(e) || (e instanceof ApiError && (e.status === 401 || e.status === 429))) break;
      // The server rejected it outright; don't keep retrying a bad record.
      writePending(readPending().filter((x) => x.rid !== item.rid));
    }
  }
  return sent;
}

/** Record a finished race. Guests are scored locally with the same rules. */
export async function submitRace(race: RaceSubmit): Promise<RaceReply & { offline?: boolean }> {
  const p = current!;
  if (!p.guest) {
    const rid = newRid();
    try {
      await syncPending();
      const r = await call<RaceReply>("race", { body: { ...race, rid }, auth: true });
      remember(r.player);
      return r;
    } catch (e) {
      if (!retryable(e) && !(e instanceof ApiError && e.status === 429)) throw e;
      // Couldn't reach the server: keep the race and sync it later.
      writePending([...readPending(), { rid, handle: p.handle, race }]);
    }
  }
  const day = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const last = (p as Player & { lastDay?: string }).lastDay ?? "";
  const streak = last === day ? Math.max(1, p.streak) : last === yesterday ? p.streak + 1 : 1;
  const multiplier = streakMultiplier(streak);
  const earned = Math.round(race.score * multiplier);
  const next: Player & { lastDay: string } = {
    ...p,
    points: p.points + earned,
    best: Math.max(p.best, race.score),
    bestTime: p.bestTime === null ? race.time : Math.min(p.bestTime, race.time),
    races: p.races + 1,
    wins: p.wins + (race.position === 1 ? 1 : 0),
    podiums: p.podiums + (race.position <= 3 ? 1 : 0),
    streak,
    tier: tierOf(p.points + earned),
    coins: p.coins + race.coins,
    lastDay: day,
  };
  const isBest = race.score > p.best;
  if (p.guest) remember(next);
  else current = next;
  return { player: next, earned, multiplier, isBest, rank: 0, offline: !p.guest };
}

export async function leaderboard(by: "best" | "points"): Promise<{ entries: BoardEntry[]; me: { rank: number; value: number } | null }> {
  return call("leaderboard?by=" + by, { auth: true });
}

/** Signed-up drivers and races run, for the landing page. */
export async function stats(): Promise<{ players: number; races: number } | null> {
  try {
    const r = await call<{ players: number; races: number }>("stats", { retries: 0 });
    return { players: r.players, races: r.races };
  } catch {
    return null;
  }
}

export const validChar = (c: unknown): CharId => (isCharId(c) ? c : "dili");
