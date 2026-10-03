// Just enough of the Workers runtime types for the room server, so no extra
// type packages are needed.

interface WebSocket {
  accept?(): void;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
  readonly readyState: number;
}

declare const WebSocketPair: { new (): { 0: WebSocket; 1: WebSocket } };

interface ResponseInit { webSocket?: WebSocket | null }

interface DurableObjectStorage {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  deleteAll(): Promise<void>;
  setAlarm(at: number): Promise<void>;
  deleteAlarm(): Promise<void>;
}

interface DurableObjectState {
  storage: DurableObjectStorage;
  acceptWebSocket(ws: WebSocket, tags?: string[]): void;
  getWebSockets(tag?: string): WebSocket[];
  blockConcurrencyWhile<T>(fn: () => Promise<T>): Promise<T>;
}

declare module "cloudflare:workers" {
  export abstract class DurableObject<Env = unknown> {
    protected ctx: DurableObjectState;
    protected env: Env;
    constructor(ctx: DurableObjectState, env: Env);
  }
}
