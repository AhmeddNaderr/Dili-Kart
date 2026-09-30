/**
 * Dili Kart multiplayer rooms.
 *
 * Each room code is one Durable Object. Players connect with a WebSocket
 * (through the Pages API, which checks who they are and passes that along
 * in the X-Player header). The room keeps the lobby, picks the host, starts
 * races on a shared clock and relays kart states and game events between
 * the players. It never simulates the race itself: every game drives its
 * own kart, and the host's game drives the bots.
 *
 * Uses the hibernation API, so an idle lobby costs nothing: room state is
 * kept in storage and each socket carries its player in an attachment.
 */
import { DurableObject } from "cloudflare:workers";
import { ROOM_MAX, type ClientMsg, type NetPlayer, type RoomPhase, type RoomSnapshot, type ServerMsg } from "../../shared/net";
import { TRACK_IDS, type TrackId } from "../../shared/rules";

interface Env {
  ROOMS: { idFromName(n: string): unknown; get(id: unknown): { fetch(r: Request): Promise<Response> } };
}

interface Meta {
  code: string;
  host: string | null;
  track: TrackId;
  phase: RoomPhase;
  raceId: number;
  grid: NetPlayer[];
  loaded: string[];
  /** When loading started (for the timeout), and when the lights go out. */
  loadingSince: number;
  goAt: number;
}

interface Att {
  p: NetPlayer;
  joined: number;
  /** Set on a socket that a reconnect replaced: it's ignored until it closes. */
  stale?: boolean;
}

/** Lights out this long after everyone has loaded (the countdown is 3 s). */
const GO_DELAY = 3800;
/** Don't wait for a slow loader longer than this. */
const LOAD_WAIT = 20_000;
/** An empty room lingers this long so a dropped player can come back. */
const EMPTY_TTL = 10 * 60_000;
const MAX_MSG = 4096;
const MAX_RATE = 90;

export default {
  async fetch(): Promise<Response> {
    return new Response("Dili Kart rooms", { status: 404 });
  },
};

export class Room extends DurableObject<Env> {
  private meta: Meta | null = null;
  private ready: Promise<void>;
  /** Messages per socket this second, for flood control (memory only). */
  private rate = new Map<WebSocket, { n: number; sec: number }>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ready = ctx.blockConcurrencyWhile(async () => {
      this.meta = (await ctx.storage.get<Meta>("meta")) ?? null;
    });
  }

  async fetch(req: Request): Promise<Response> {
    await this.ready;
    const url = new URL(req.url);

    // Create: claim this code if nobody has it.
    if (url.pathname === "/init") {
      if (this.meta) return Response.json({ ok: false, taken: true });
      const track = url.searchParams.get("track");
      this.meta = {
        code: url.searchParams.get("code") ?? "",
        host: null,
        track: TRACK_IDS.includes(track as TrackId) ? (track as TrackId) : "circuit",
        phase: "lobby",
        raceId: 0,
        grid: [],
        loaded: [],
        loadingSince: 0,
        goAt: 0,
      };
      await this.save();
      // A room nobody joins disappears on its own.
      await this.ctx.storage.setAlarm(Date.now() + EMPTY_TTL);
      return Response.json({ ok: true });
    }

    if (url.pathname === "/peek") {
      return Response.json({ ok: !!this.meta, players: this.live().length, phase: this.meta?.phase ?? null });
    }

    if (url.pathname !== "/ws") return new Response("Not found", { status: 404 });
    if (req.headers.get("Upgrade") !== "websocket") return new Response("Expected a WebSocket", { status: 426 });

    let who: NetPlayer;
    try { who = JSON.parse(req.headers.get("X-Player") ?? ""); } catch { return new Response("Bad player", { status: 400 }); }

    const pair = new WebSocketPair();
    const client = pair[0], server = pair[1];
    this.ctx.acceptWebSocket(server);

    const refuse = (msg: string) => {
      server.serializeAttachment({ p: who, joined: 0, stale: true } satisfies Att);
      this.send(server, { t: "err", msg });
      server.close(4001, msg);
      return new Response(null, { status: 101, webSocket: client });
    };
    if (!this.meta) return refuse("That room doesn't exist (or it closed).");

    // The same player again (a reconnect, or a second tab): the new socket wins.
    let joined = Date.now();
    for (const ws of this.ctx.getWebSockets()) {
      const a = att(ws);
      if (ws !== server && a && !a.stale && a.p.id === who.id) {
        joined = a.joined;
        ws.serializeAttachment({ ...a, stale: true });
        try { ws.close(4000, "Joined from somewhere else"); } catch { /* already gone */ }
      }
    }
    if (this.live().length >= ROOM_MAX) return refuse(`The room is full (${ROOM_MAX} racers).`);

    server.serializeAttachment({ p: who, joined } satisfies Att);
    const m = this.meta;
    if (!m.host || !this.live().some((x) => x.id === m.host)) m.host = who.id;
    await this.save();
    await this.ctx.storage.deleteAlarm();
    this.send(server, { t: "welcome", you: who.id, room: this.snapshot(), now: Date.now() });
    this.broadcast({ t: "room", room: this.snapshot() }, server);
    // Joined mid-load (e.g. a reconnect): keep the start going for them.
    if (m.phase === "loading" && m.grid.some((g) => g.id === who.id)) {
      this.send(server, { t: "start", raceId: m.raceId, track: m.track, seed: m.raceId, grid: m.grid });
    } else if (m.phase === "race" && m.grid.some((g) => g.id === who.id)) {
      this.send(server, { t: "start", raceId: m.raceId, track: m.track, seed: m.raceId, grid: m.grid });
      this.send(server, { t: "go", raceId: m.raceId, at: m.goAt });
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    await this.ready;
    const a = att(ws);
    if (!a || a.stale || typeof raw !== "string" || raw.length > MAX_MSG || !this.meta) return;
    // Flood control: drop anything past MAX_RATE messages a second.
    const sec = Math.floor(Date.now() / 1000);
    let r = this.rate.get(ws);
    if (!r || r.sec !== sec) this.rate.set(ws, r = { n: 0, sec });
    if (++r.n > MAX_RATE) return;
    const m = this.meta;
    const id = a.p.id;

    // Hot path: kart states, relayed without parsing.
    if (raw.charCodeAt(1) === 124 /* | */) {
      const kind = raw[0];
      if (kind === "s") this.broadcastRaw(`s|${id}|${raw.slice(2)}`, ws);
      else if (kind === "b" && id === m.host) this.broadcastRaw(raw, ws);
      return;
    }

    let msg: ClientMsg;
    try { msg = JSON.parse(raw); } catch { return; }
    switch (msg.t) {
      case "ping":
        this.send(ws, { t: "pong", c: msg.c, s: Date.now() });
        break;
      case "track":
        if (id !== m.host || m.phase !== "lobby" || !TRACK_IDS.includes(msg.track)) return;
        m.track = msg.track;
        await this.save();
        this.broadcast({ t: "room", room: this.snapshot() });
        break;
      case "start": {
        if (id !== m.host || m.phase === "loading") return;
        m.raceId++;
        m.phase = "loading";
        m.grid = this.live();
        m.loaded = [];
        m.loadingSince = Date.now();
        m.goAt = 0;
        await this.save();
        this.broadcast({ t: "start", raceId: m.raceId, track: m.track, seed: m.raceId, grid: m.grid });
        this.broadcast({ t: "room", room: this.snapshot() });
        await this.ctx.storage.setAlarm(Date.now() + LOAD_WAIT);
        break;
      }
      case "loaded":
        if (m.phase !== "loading" || msg.raceId !== m.raceId) return;
        if (!m.loaded.includes(id)) m.loaded.push(id);
        await this.maybeGo();
        break;
      case "fin": {
        if (msg.raceId !== m.raceId || !Number.isFinite(msg.time)) return;
        // The host reports the bots it drives; everyone else only themselves.
        const who = typeof msg.who === "string" && msg.who.startsWith("bot") && id === m.host ? msg.who : id;
        this.broadcast({ t: "fin", id: who, time: Math.max(0, msg.time), raceId: m.raceId });
        break;
      }
      case "ev":
        if (m.phase !== "race" || !msg.ev || typeof msg.ev !== "object") return;
        this.broadcast({ t: "ev", id, ev: msg.ev }, ws);
        break;
      case "lobby":
        if (id !== m.host || m.phase === "lobby") return;
        m.phase = "lobby";
        await this.save();
        this.broadcast({ t: "room", room: this.snapshot() });
        break;
    }
  }

  async webSocketClose(ws: WebSocket) {
    await this.gone(ws);
  }

  async webSocketError(ws: WebSocket) {
    await this.gone(ws);
  }

  async alarm() {
    await this.ready;
    const m = this.meta;
    if (!m) return;
    if (!this.live().length) {
      // Nobody came back: close the room for good.
      if (m.phase !== "loading") {
        await this.ctx.storage.deleteAll();
        this.meta = null;
        return;
      }
    }
    if (m.phase === "loading") await this.go();
  }

  /* ---------------------------------------------------------------- */

  private async gone(ws: WebSocket) {
    await this.ready;
    this.rate.delete(ws);
    const a = att(ws);
    if (!a || a.stale) return;
    ws.serializeAttachment({ ...a, stale: true });
    try { ws.close(1000, "bye"); } catch { /* already closed */ }
    const m = this.meta;
    if (!m) return;
    const left = this.live();
    if (m.host === a.p.id) m.host = left[0]?.id ?? null;
    await this.save();
    this.broadcast({ t: "left", id: a.p.id });
    this.broadcast({ t: "room", room: this.snapshot() });
    if (m.phase === "loading") await this.maybeGo();
    if (!left.length) {
      if (m.phase !== "lobby") { m.phase = "lobby"; await this.save(); }
      await this.ctx.storage.setAlarm(Date.now() + EMPTY_TTL);
    }
  }

  private async maybeGo() {
    const m = this.meta!;
    const racing = m.grid.filter((g) => this.live().some((p) => p.id === g.id));
    if (racing.length && racing.every((g) => m.loaded.includes(g.id))) await this.go();
  }

  private async go() {
    const m = this.meta!;
    if (m.phase !== "loading") return;
    m.phase = "race";
    m.goAt = Date.now() + GO_DELAY;
    await this.save();
    await this.ctx.storage.deleteAlarm();
    this.broadcast({ t: "go", raceId: m.raceId, at: m.goAt });
    this.broadcast({ t: "room", room: this.snapshot() });
  }

  /** Connected players, in the order they joined. */
  private live(): NetPlayer[] {
    return this.ctx.getWebSockets()
      .map(att)
      .filter((a): a is Att => !!a && !a.stale)
      .sort((x, y) => x.joined - y.joined)
      .map((a) => a.p);
  }

  private snapshot(): RoomSnapshot {
    const m = this.meta!;
    return { code: m.code, host: m.host, track: m.track, phase: m.phase, raceId: m.raceId, players: this.live() };
  }

  private save() {
    return this.ctx.storage.put("meta", this.meta);
  }

  private send(ws: WebSocket, msg: ServerMsg) {
    try { ws.send(JSON.stringify(msg)); } catch { /* closing */ }
  }

  private broadcast(msg: ServerMsg, except?: WebSocket) {
    this.broadcastRaw(JSON.stringify(msg), except);
  }

  private broadcastRaw(data: string, except?: WebSocket) {
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      const a = att(ws);
      if (!a || a.stale) continue;
      try { ws.send(data); } catch { /* closing */ }
    }
  }
}

function att(ws: WebSocket): Att | null {
  try { return (ws.deserializeAttachment() as Att) ?? null; } catch { return null; }
}
