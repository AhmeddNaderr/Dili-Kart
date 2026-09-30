/**
 * Multiplayer protocol, shared by the room server (rooms/) and the game.
 *
 * One WebSocket per player to a room (a Cloudflare Durable Object named by
 * its code). Control messages are JSON. The hot path — kart states at
 * 20 Hz — is a compact text frame the server relays without parsing:
 *
 *   client → server   s|[...]          my kart
 *                     b|[[...],...]    host: every bot's kart
 *   server → client   s|<id>|[...]     someone's kart
 *                     b|[[...],...]    the bots
 *
 * Each player's game is the authority for their own kart, so steering is
 * instant; everyone else is drawn a moment in the past, smoothly
 * interpolated on a clock synced to the server's. The host (first in the
 * room, handed on if they leave) drives the Custodian bots.
 */

import type { CharId, SkinId, TrackId } from "./rules";

export const ROOM_MAX = 8;
/** Room codes: 5 characters without look-alikes (no 0/O, 1/I/L). */
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LEN = 5;
export const CODE_RE = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LEN}}$`);

export function normaliseCode(raw: string): string | null {
  const c = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  return CODE_RE.test(c) ? c : null;
}

export interface NetPlayer {
  id: string;
  name: string;
  char: CharId;
  skin: SkinId | null;
  guest: boolean;
}

export type RoomPhase = "lobby" | "loading" | "race";

export interface RoomSnapshot {
  code: string;
  host: string | null;
  track: TrackId;
  phase: RoomPhase;
  raceId: number;
  players: NetPlayer[];
}

/** Server → client control messages. */
export type ServerMsg =
  | { t: "welcome"; you: string; room: RoomSnapshot; now: number }
  | { t: "room"; room: RoomSnapshot }
  | { t: "pong"; c: number; s: number }
  /** The host started a race: load the track, then say "loaded". */
  | { t: "start"; raceId: number; track: TrackId; seed: number; grid: NetPlayer[] }
  /** Everyone's loaded (or the wait ran out): lights out at `at` (server ms). */
  | { t: "go"; raceId: number; at: number }
  | { t: "fin"; id: string; time: number; raceId: number }
  | { t: "ev"; id: string; ev: GameEvent }
  | { t: "left"; id: string }
  | { t: "err"; msg: string };

/** Client → server control messages. */
export type ClientMsg =
  | { t: "ping"; c: number }
  | { t: "track"; track: TrackId }
  | { t: "start" }
  | { t: "loaded"; raceId: number }
  | { t: "fin"; time: number; raceId: number }
  | { t: "ev"; ev: GameEvent }
  | { t: "lobby" };

/**
 * In-race happenings every game needs to see. Racers are named by id.
 *
 * Hits are settled by whichever game drives the kart that was hit (the
 * player themselves, or the host for bots): it applies the hit (so a shield
 * works) and tells everyone the projectile is gone.
 */
export type GameEvent =
  | { e: "coin"; i: number }
  | { e: "box"; i: number }
  | { e: "seek"; sid: string; target: string; u: number; lat: number; speed: number }
  | { e: "seekEnd"; sid: string; hit: boolean }
  | { e: "zap"; dist: number }
  | { e: "goo"; hid: string; u: number; lat: number }
  | { e: "gooEnd"; hid: string }
  | { e: "orb"; oid: string; target: string; u: number; lat: number; speed: number }
  | { e: "orbEnd"; oid: string }
  /** Rammed while boosting: the kart's driver spins it out. */
  | { e: "strike"; who: string };

/**
 * One kart's state, as sent 20 times a second. Indices into the array.
 */
export const S = {
  ts: 0,       // server time (ms) the state was taken
  dist: 1,     // metres along the race (unwrapped: laps add up)
  lat: 2,      // metres across the road
  speed: 3,
  y: 4,        // height when airborne
  flags: 5,    // bit field, F below
  yaw: 6,      // visual slide angle
  steer: 7,
  hop: 8,
  flip: 9,
  roll: 10,    // spin-out angle
  tier: 11,    // drift charge 0..3
  glide: 12,
  pitch: 13,
  boost: 14,   // 0..1 boost flame
  squash: 15,
} as const;
export const S_LEN = 16;

export const F = {
  air: 1,
  spin: 2,
  finished: 4,
  frozen: 8,
  shield: 16,
  ghost: 32,
  drift: 64,
  magnet: 128,
} as const;

/** Bot ids are fixed per grid slot so every game agrees. */
export const botId = (k: number) => `bot${k}`;
