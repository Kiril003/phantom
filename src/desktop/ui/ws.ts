import { HubEnvelope, isHubEnvelope } from './types';

export type HubStatus = 'connecting' | 'open' | 'absent';

export interface HubClientOptions {
  url: string;
  channels: string[];
  /** Read at every (re)connect so a refreshed JWT lands on the next socket. */
  token?: () => string | null;
  onEnvelope: (env: HubEnvelope) => void;
  onStatus: (status: HubStatus) => void;
}

/** Reconnect backoff: 1s → 2s → 4s … capped at 30s, ±20% jitter. */
export function nextDelayMs(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(30_000, 1_000 * 2 ** Math.min(attempt, 10));
  const jitter = base * 0.2 * (random() * 2 - 1);
  return Math.round(base + jitter);
}

/**
 * Раунд-4 П4: токен більше не їде в адресі. uvicorn пише повний шлях
 * запиту в access-лог, тож `?token=` означав повний JWT на диску при
 * кожному підключенні Плівки. Тепер URL чистий, а токен — у під-протоколі
 * рукостискання (`bearerProtocols`), який у лог не потрапляє.
 */
export function socketUrl(base: string, _token?: string | null): string {
  return base;
}

/** Маркер під-протоколу; вузол мусить підтвердити його у відповіді. */
export const BEARER_SUBPROTOCOL = 'phantom.bearer.v1';

/** Аргумент `protocols` конструктора WebSocket: маркер і одразу за ним токен. */
export function bearerProtocols(token: string | null): string[] | undefined {
  return token ? [BEARER_SUBPROTOCOL, token] : undefined;
}

/**
 * One WS connection to the PHANTOM hub, narrowed to the Film's channels via
 * the `{"control":"subscribe"}` message (websocket_hub.py, Phase 19-6). Without
 * that narrowing the hub fans out its 30 fps `oled` preview to every client.
 */
export class HubClient {
  private ws: WebSocket | null = null;
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(private readonly opts: HubClientOptions) {}

  connect(): void {
    this.stopped = false;
    this.open();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onclose = null;
      ws.onerror = null;
      ws.close();
    }
  }

  get live(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  send(channel: string, type: string, data: Record<string, unknown>): boolean {
    if (!this.live) return false;
    this.ws!.send(JSON.stringify({ channel, type, data }));
    return true;
  }

  private open(): void {
    this.opts.onStatus(this.attempt === 0 ? 'connecting' : 'absent');
    const protocols = bearerProtocols(this.opts.token?.() ?? null);
    const target = socketUrl(this.opts.url);
    const ws = protocols ? new WebSocket(target, protocols) : new WebSocket(target);
    this.ws = ws;

    ws.onopen = () => {
      this.attempt = 0;
      ws.send(JSON.stringify({ control: 'subscribe', channels: this.opts.channels }));
      this.opts.onStatus('open');
    };

    ws.onmessage = (ev: MessageEvent) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(typeof ev.data === 'string' ? ev.data : '');
      } catch {
        return;
      }
      if (isHubEnvelope(parsed)) this.opts.onEnvelope(parsed);
    };

    ws.onclose = () => this.scheduleReconnect();
    ws.onerror = () => ws.close();
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    this.opts.onStatus('absent');
    const delay = nextDelayMs(this.attempt);
    this.attempt += 1;
    this.timer = setTimeout(() => this.open(), delay);
  }
}
