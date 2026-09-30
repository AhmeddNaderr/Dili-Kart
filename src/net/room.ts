import type { ClientMsg, GameEvent, RoomSnapshot, ServerMsg } from "../../shared/net";
import type { CharId } from "../../shared/rules";

/**
 * The game's end of a multiplayer room: one WebSocket, a clock synced to
 * the room server's, reconnects, and a tiny event bus.
 *
 * Dev/testing: add `?lag=120&jit=40` to the page URL to delay every message
 * both ways by that many ms (plus random jitter), to feel a bad connection.
 */

export type RoomStatus = "connecting" | "online" | "reconnecting" | "closed";

type Handlers = {
  [K in ServerMsg["t"]]: (m: Extract<ServerMsg, { t: K }>) => void;
} & {
  state: (id: string, d: number[]) => void;
  bots: (d: number[][]) => void;
  status: (s: RoomStatus, why?: string) => void;
};

const GID_KEY = "dilicart.gid";

/** A stable id for a guest on this device, so a reconnect is the same player. */
export function guestId(): string {
  let g = "";
  try { g = localStorage.getItem(GID_KEY) ?? ""; } catch { /* storage blocked */ }
  if (!/^[a-z0-9]{8,24}$/.test(g)) {
    g = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => "abcdefghijkmnpqrstuvwxyz23456789"[b % 32]).join("");
    try { localStorage.setItem(GID_KEY, g); } catch { /* storage blocked */ }
  }
  return g;
}

export async function createRoom(track: string): Promise<string> {
  const res = await fetch("api/room", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ track }) });
  const data = await res.json().catch(() => null) as { ok?: boolean; code?: string; error?: string } | null;
  if (!data?.ok || !data.code) throw new Error(data?.error ?? "Couldn't create a room. Try again.");
  return data.code;
}

export async function checkRoom(code: string): Promise<{ players: number; phase: string | null }> {
  const res = await fetch(`api/room/${encodeURIComponent(code)}`);
  const data = await res.json().catch(() => null) as { ok?: boolean; players?: number; phase?: string | null; error?: string } | null;
  if (!data?.ok) throw new Error(data?.error ?? "Couldn't find that room.");
  return { players: data.players ?? 0, phase: data.phase ?? null };
}

export class RoomClient {
  readonly code: string;
  you = "";
  room: RoomSnapshot | null = null;
  status: RoomStatus = "connecting";
  /** Round-trip time to the server, ms (best recent estimate). */
  rtt = 0;

  private ws: WebSocket | null = null;
  private url: string;
  private handlers = new Map<string, Set<(...a: never[]) => void>>();
  private closedByUs = false;
  private tries = 0;
  private pingTimer = 0;
  /** server time − local time, ms. */
  private offset = 0;
  private synced = false;
  private samples: { rtt: number; off: number }[] = [];
  private lag = 0;
  private jit = 0;
  private sendAt = 0;
  private recvAt = 0;

  constructor(code: string, who: { token?: string | null; char: CharId }) {
    this.code = code;
    const q = who.token ? `t=${encodeURIComponent(who.token)}` : `g=${guestId()}&c=${who.char}`;
    const base = new URL(`api/room/${code}?${q}`, location.href);
    base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
    this.url = base.href;
    const sp = new URLSearchParams(location.search);
    this.lag = Math.max(0, Number(sp.get("lag")) || 0);
    this.jit = Math.max(0, Number(sp.get("jit")) || 0);
  }

  /** Resolves once the room has welcomed us; rejects if it turns us away. */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const offWelcome = this.on("welcome", () => { if (!settled) { settled = true; offWelcome(); offErr(); resolve(); } });
      const offErr = this.on("err", (m) => { if (!settled) { settled = true; offWelcome(); offErr(); this.closedByUs = true; reject(new Error(m.msg)); } });
      this.open((why) => { if (!settled) { settled = true; offWelcome(); offErr(); reject(new Error(why)); } });
    });
  }

  on<K extends keyof Handlers>(t: K, fn: Handlers[K]): () => void {
    let set = this.handlers.get(t);
    if (!set) this.handlers.set(t, set = new Set());
    const f = fn as unknown as (...a: never[]) => void;
    set.add(f);
    return () => { set.delete(f); };
  }

  /** Server clock, ms. */
  now(): number {
    return Date.now() + this.offset;
  }

  isHost(): boolean {
    return !!this.room && this.room.host === this.you;
  }

  send(msg: ClientMsg) {
    this.raw(JSON.stringify(msg));
  }

  event(ev: GameEvent) {
    this.send({ t: "ev", ev });
  }

  sendState(d: number[]) {
    this.raw("s|" + JSON.stringify(d));
  }

  sendBots(d: number[][]) {
    this.raw("b|" + JSON.stringify(d));
  }

  leave() {
    this.closedByUs = true;
    clearInterval(this.pingTimer);
    try { this.ws?.close(1000, "left"); } catch { /* already closed */ }
    this.setStatus("closed", "left");
  }

  /* ---------------------------------------------------------------- */

  private open(fail?: (why: string) => void) {
    let ws: WebSocket;
    try { ws = new WebSocket(this.url); } catch { fail?.("Can't reach the room server."); return; }
    this.ws = ws;
    let opened = false;
    ws.onopen = () => {
      opened = true;
      this.tries = 0;
      this.samples = [];
      // A quick burst of pings to sync the clock, then one every 2 s.
      for (let k = 0; k < 5; k++) setTimeout(() => this.ping(), k * 120);
      clearInterval(this.pingTimer);
      this.pingTimer = window.setInterval(() => this.ping(), 2000);
    };
    ws.onmessage = (m) => this.later(this.recvAt, (t) => { this.recvAt = t; }, () => this.receive(String(m.data)));
    ws.onclose = (e) => {
      clearInterval(this.pingTimer);
      if (this.ws !== ws) return;
      this.ws = null;
      if (!opened) { fail?.("Can't reach the room server."); if (!this.closedByUs && this.status !== "connecting") this.retry(); return; }
      // 4000: we joined from another tab; 4001: turned away. Don't fight it.
      if (this.closedByUs || e.code === 4000 || e.code === 4001) {
        this.setStatus("closed", e.reason || "closed");
        return;
      }
      this.retry();
    };
  }

  private retry() {
    if (this.closedByUs) return;
    if (this.tries >= 10) { this.setStatus("closed", "Lost connection to the room."); return; }
    this.setStatus("reconnecting");
    const wait = Math.min(4000, 400 * 2 ** this.tries++);
    setTimeout(() => { if (!this.closedByUs) this.open(); }, wait);
  }

  private setStatus(s: RoomStatus, why?: string) {
    if (this.status === s && s !== "closed") return;
    this.status = s;
    this.emit("status", s, why);
  }

  private ping() {
    this.send({ t: "ping", c: Date.now() });
  }

  private receive(data: string) {
    if (data.charCodeAt(1) === 124 /* | */) {
      if (data[0] === "s") {
        const bar = data.indexOf("|", 2);
        const id = data.slice(2, bar);
        try { this.emit("state", id, JSON.parse(data.slice(bar + 1))); } catch { /* bad frame */ }
      } else if (data[0] === "b") {
        try { this.emit("bots", JSON.parse(data.slice(2))); } catch { /* bad frame */ }
      }
      return;
    }
    let msg: ServerMsg;
    try { msg = JSON.parse(data); } catch { return; }
    if (msg.t === "pong") this.clock(msg.c, msg.s);
    if (msg.t === "welcome") {
      this.you = msg.you;
      this.room = msg.room;
      // A first rough offset until the pings come back.
      if (!this.synced) this.offset = msg.now - Date.now();
      this.setStatus("online");
    }
    if (msg.t === "room") this.room = msg.room;
    this.emit(msg.t, msg as never);
  }

  /**
   * NTP-style: keep the recent samples and trust the ones with the shortest
   * round trip. Small corrections are eased in so the race clock never jumps.
   */
  private clock(c: number, s: number) {
    const now = Date.now();
    const rtt = now - c;
    if (rtt < 0 || rtt > 5000) return;
    this.samples.push({ rtt, off: s - (c + rtt / 2) });
    if (this.samples.length > 12) this.samples.shift();
    const best = [...this.samples].sort((a, b) => a.rtt - b.rtt).slice(0, 4);
    const off = best.reduce((t, x) => t + x.off, 0) / best.length;
    this.rtt = best[0].rtt;
    if (!this.synced || Math.abs(off - this.offset) > 250) { this.offset = off; this.synced = true; }
    else this.offset += Math.max(-8, Math.min(8, off - this.offset));
  }

  private raw(data: string) {
    this.later(this.sendAt, (t) => { this.sendAt = t; }, () => {
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(data);
    });
  }

  /** Simulated latency for testing; keeps messages in order. */
  private later(prev: number, mark: (t: number) => void, fn: () => void) {
    if (!this.lag && !this.jit) { fn(); return; }
    const at = Math.max(prev, performance.now() + this.lag + Math.random() * this.jit);
    mark(at);
    setTimeout(fn, at - performance.now());
  }

  private emit<K extends keyof Handlers>(t: K, ...args: Parameters<Handlers[K]>) {
    if (import.meta.env.DEV && t !== "state" && t !== "bots" && t !== "pong") {
      const w = window as unknown as { __netlog?: string[] };
      (w.__netlog ??= []).push(`${Math.round(performance.now())} ${t} ${JSON.stringify(args).slice(0, 120)}`);
    }
    const set = this.handlers.get(t) as Set<(...a: unknown[]) => void> | undefined;
    if (!set) return;
    for (const fn of [...set]) {
      try { fn(...args); } catch (e) { console.error(e); }
    }
  }
}
