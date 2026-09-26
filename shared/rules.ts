/**
 * Rules shared by the game (browser) and the API (Cloudflare Pages
 * Functions), so the two can never disagree about what's valid.
 */

/** X handles: lowercase letters, numbers and underscores, 3–15 long. */
export const HANDLE_RE = /^[a-z0-9_]{3,15}$/;
export const PASSWORD_MIN = 6;
export const PASSWORD_MAX = 64;

export function normaliseHandle(raw: string): string | null {
  const h = raw.trim().replace(/^@+/, "").toLowerCase();
  return HANDLE_RE.test(h) ? h : null;
}

export const TIERS = [
  { name: "Rookie", at: 0 },
  { name: "Builder", at: 2_500 },
  { name: "Degen", at: 10_000 },
  { name: "Whale", at: 30_000 },
  { name: "Founder", at: 80_000 },
] as const;

export function tierOf(points: number): string {
  let t: string = TIERS[0].name;
  for (const x of TIERS) if (points >= x.at) t = x.name;
  return t;
}

export function nextTier(points: number): { name: string; at: number } | null {
  for (const x of TIERS) if (points < x.at) return { name: x.name, at: x.at };
  return null;
}

/** The Dlicom squad. Points unlock the rarer drivers. */
export const CHAR_IDS = ["dili", "dcoded", "dco"] as const;
export type CharId = (typeof CHAR_IDS)[number];
export const CHAR_UNLOCK: Record<CharId, number> = { dili: 0, dcoded: 3_000, dco: 12_000 };
export const CHAR_INFO: Record<CharId, { name: string; rarity: string; color: string }> = {
  dili: { name: "Dili Boy", rarity: "Common", color: "#3d63ff" },
  dcoded: { name: "Dcoded", rarity: "Rare", color: "#ffc21a" },
  dco: { name: "DCO", rarity: "Ultra-Rare", color: "#e447d2" },
};
export const isCharId = (c: unknown): c is CharId => typeof c === "string" && (CHAR_IDS as readonly string[]).includes(c);

/** Daily streak multiplier: ×1.0 on day one, up to ×2.0 on day seven. */
export function streakMultiplier(streak: number): number {
  return 1 + Math.min(Math.max(streak - 1, 0), 6) / 6;
}

/**
 * Plausibility bounds for a submitted race. A clean three-lap race takes
 * around two minutes, and even a perfect one can't score beyond these.
 */
export const RACE_LIMITS = {
  maxScore: 15_000,
  minTime: 60,
  maxTime: 900,
  maxCoins: 250,
  /** Seconds that must pass between two submissions from one player. */
  cooldown: 45,
} as const;

/** What the API sends back about a player. */
export interface PlayerDTO {
  handle: string;
  points: number;
  best: number;
  bestTime: number | null;
  races: number;
  wins: number;
  podiums: number;
  streak: number;
  char: CharId;
  tier: string;
}

export interface BoardEntry {
  handle: string;
  best: number;
  points: number;
  races: number;
  wins: number;
  tier: string;
}

export interface RaceSubmit {
  score: number;
  position: number;
  time: number;
  coins: number;
}

export interface RaceReply {
  player: PlayerDTO;
  earned: number;
  multiplier: number;
  isBest: boolean;
  rank: number;
}
