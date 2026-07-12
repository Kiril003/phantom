import { HubEnvelope, isHubEnvelope } from './types';

export type HubStatus = 'connecting' | 'open' | 'absent';

export interface HubClientOptions {
  url: string;
  channels: string[];
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
 * One WS connection to the PHANTOM hub, narrowed to the Film's channels via
 * the `{"control":"subscribe"}` message (websocket_hub.py, Phase 19-6).
 * Anonymous — the Film renders presence, it holds no privileges.
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
    this.ws?.close();
  }

  private open(): void {
    this.opts.onStatus(this.attempt === 0 ? 'connecting' : 'absent');
    const ws = new WebSocket(this.opts.url);
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
