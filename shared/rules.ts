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

/**
 * Kart skins, bought with the Dili coins picked up on track. Driver skins
 * put a new character in the seat with their own kart; liveries repaint the
 * kart of whichever squad driver is picked.
 */
export const SKIN_IDS = ["quang", "cipher", "gold", "carbon"] as const;
export type SkinId = (typeof SKIN_IDS)[number];
export const SKIN_INFO: Record<SkinId, { name: string; kind: "driver" | "livery"; price: number; rarity: string; blurb: string; color: string }> = {
  quang: { name: "Quang", kind: "driver", price: 300, rarity: "Epic", blurb: "Sky-blue wave racer. Glasses on, smile on.", color: "#3fc7ff" },
  cipher: { name: "Cipher", kind: "driver", price: 500, rarity: "Legendary", blurb: "Code in the dome, stars in the sweater.", color: "#2f4dff" },
  gold: { name: "Gold Rush", kind: "livery", price: 200, rarity: "Rare", blurb: "Polished gold paint with black pinstripes.", color: "#ffc21a" },
  carbon: { name: "Carbon Ghost", kind: "livery", price: 120, rarity: "Rare", blurb: "Bare carbon weave and ice-blue neon.", color: "#8fe3ff" },
};
export const isSkinId = (s: unknown): s is SkinId => typeof s === "string" && (SKIN_IDS as readonly string[]).includes(s);
/** Owned skins are stored as a comma list. */
export const parseSkins = (s: string | null | undefined): SkinId[] => (s ?? "").split(",").filter(isSkinId);

/** Daily streak multiplier: ×1.0 on day one, up to ×2.0 on day seven. */
export function streakMultiplier(streak: number): number {
  return 1 + Math.min(Math.max(streak - 1, 0), 6) / 6;
}

/** The tracks. Neon Town is a night street circuit through Dlicom City. */
export const TRACK_IDS = ["circuit", "town"] as const;
export type TrackId = (typeof TRACK_IDS)[number];
export const TRACK_INFO: Record<TrackId, { name: string; laps: number; blurb: string }> = {
  circuit: { name: "Dili Circuit", laps: 3, blurb: "Stadium at dusk · lake jump" },
  town: { name: "Neon Town", laps: 5, blurb: "City streets at night · canal jump" },
};
export const isTrackId = (t: unknown): t is TrackId => typeof t === "string" && (TRACK_IDS as readonly string[]).includes(t);

/**
 * Plausibility bounds for a submitted race. A clean three-lap race takes
 * around two minutes, and even a perfect one can't score beyond these.
 */
export const RACE_LIMITS = {
  maxScore: 20_000,
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
  /** Dili coins to spend in the shop. */
  coins: number;
  skins: SkinId[];
  skin: SkinId | null;
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
