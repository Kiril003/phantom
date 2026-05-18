import type { ContextSnapshot, SystemState, ChatMessage, StateTransition } from '@shared/types';

/* ─── Message types ───────────────────────────────────────────────────────── */

export type WSChannel =
  | 'sensor'
  | 'state'
  | 'chat'
  | 'voice'
  | 'terminal'
  | 'alert'
  | 'map'
  | 'settings'
  | 'oled'
  | 'face'
  | 'agent.stream'
  // agent/runtime.py:255-285 splits foreground vs background ticks across
  // two channels — pre-fix the type union only listed agent.stream so any
  // FE listener typed against WSChannel could not subscribe to background
  // events at all (audit B-23).
  | 'background_events'
  // Phase 9.3b — inner monologue stream. Dedicated channel so main
  // agent.stream subscribers don't get flooded with per-step thinking.
  // No consumer in 9.3b; a future Inspector panel will subscribe.
  | 'inner_monologue.stream'
  // Phase 5 R1 FAMILIAR — AI-summoned wisp manifestation events.
  // Backend `routes_familiar.py` POST /familiar/manifest broadcasts here;
  // FE `wsHandlers.ts` translates into a familiarStore.manifest('ai-summon').
  | 'familiar'
  // Phase 19 Mobile Companion — pairing lifecycle. `pair/claimed` fires
  // when a phone successfully completes the QR handshake; `pair/revoked`
  // when a paired device is dropped from the desktop UI. The Settings
  // "Mobile Companion" panel subscribes here to live-refresh its device
  // list without polling.
  | 'pair'
  | 'vision'
  | '_meta';

export interface WSMessage {
  channel: WSChannel;
  type: string;
  data: Record<string, unknown>;
  ts?: number;
}

export interface WSControlMessage {
  control: string;
  channels?: string[];
  ts?: number;
}

export interface SensorMessage extends WSMessage {
  channel: 'sensor';
  type: 'snapshot';
  data: { snapshot: ContextSnapshot };
}

export interface StateMessage extends WSMessage {
  channel: 'state';
  type: 'transition';
  data: StateTransition & Record<string, unknown>;
}

export interface ChatStreamMessage extends WSMessage {
  channel: 'chat';
  type: 'stream';
  data: { message_id: string; delta: string; done: boolean; message?: ChatMessage };
}

export interface VoiceMessage extends WSMessage {
  channel: 'voice';
  type: 'partial' | 'final' | 'tts_start' | 'tts_end';
  data: { text?: string; engine?: string; duration_ms?: number };
}

export interface AlertMessage extends WSMessage {
  channel: 'alert';
  type: 'priority';
  data: { level: number; title: string; body: string };
}

export interface StateChangeNotification {
  state: SystemState;
}

/* ─── WebSocket Client ────────────────────────────────────────────────────── */

type ChannelHandler<T extends WSMessage = WSMessage> = (msg: T) => void;
type ConnectHandler = () => void;
type DisconnectHandler = () => void;

const INITIAL_RECONNECT_DELAY = 1000;
const MAX_RECONNECT_DELAY = 30000;

class WebSocketClient {
  private ws: WebSocket | null = null;
  private token: string | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = INITIAL_RECONNECT_DELAY;
  private intentionalClose = false;

  private connectHandlers: ConnectHandler[] = [];
  private disconnectHandlers: DisconnectHandler[] = [];
  private channelHandlers = new Map<WSChannel, ChannelHandler[]>();

  connect(token?: string): void {
    this.token = token;
    this.intentionalClose = false;

    // Idempotent: if we already have an open/connecting socket, keep it.
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    // Clear any scheduled reconnect — we're connecting now.
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this._open();
  }

  disconnect(): void {
    this.intentionalClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const ws = this.ws;
    this.ws = null;
    if (!ws) return;

    // Detach handlers so no late onclose/onerror triggers reconnect.
    ws.onopen = null;
    ws.onmessage = null;
    ws.onerror = null;
    ws.onclose = null;

    if (ws.readyState === WebSocket.CONNECTING) {
      // Can't close a CONNECTING socket without the "closed before established"
      // error. Wait for open, then close cleanly.
      ws.addEventListener(
        'open',
        () => {
          try {
            ws.close(1000, 'client disconnect');
          } catch {
            /* ignore */
          }
        },
        { once: true }
      );
    } else if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.close(1000, 'client disconnect');
      } catch {
        /* ignore */
      }
    }
  }

  send(msg: WSMessage | WSControlMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ ...msg, ts: msg.ts ?? Date.now() }));
    }
  }

  onConnect(handler: ConnectHandler): () => void {
    this.connectHandlers.push(handler);
    return () => {
      this.connectHandlers = this.connectHandlers.filter((h) => h !== handler);
    };
  }

  onDisconnect(handler: DisconnectHandler): () => void {
    this.disconnectHandlers.push(handler);
    return () => {
      this.disconnectHandlers = this.disconnectHandlers.filter((h) => h !== handler);
    };
  }

  on<T extends WSMessage>(channel: WSChannel, handler: ChannelHandler<T>): () => void {
    const handlers = this.channelHandlers.get(channel) ?? [];
    handlers.push(handler as ChannelHandler);
    this.channelHandlers.set(channel, handlers);
    return () => this.off(channel, handler);
  }

  off<T extends WSMessage>(channel: WSChannel, handler: ChannelHandler<T>): void {
    const current = this.channelHandlers.get(channel);
    if (current) {
      this.channelHandlers.set(
        channel,
        current.filter((h) => h !== (handler as ChannelHandler))
      );
    }
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private _open(): void {
    const url = new URL('/ws', window.location.href);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    if (this.token) url.searchParams.set('token', this.token);

    let ws: WebSocket;
    try {
      ws = new WebSocket(url.toString());
    } catch {
      this._scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectDelay = INITIAL_RECONNECT_DELAY;
      this.connectHandlers.forEach((h) => {
        try {
          h();
        } catch {
          /* handler error — ignore */
        }
      });
    };

    ws.onmessage = (event: MessageEvent<string>) => {
      try {
        const msg = JSON.parse(event.data) as WSMessage;
        const handlers = this.channelHandlers.get(msg.channel) ?? [];
        handlers.forEach((h) => h(msg));
      } catch {
        /* malformed — ignore */
      }
    };

    ws.onclose = () => {
      // If this ws was detached by disconnect(), this.ws will be null or
      // point to a new socket; skip side-effects in that case.
      if (this.ws !== ws) return;
      this.ws = null;
      this.disconnectHandlers.forEach((h) => {
        try {
          h();
        } catch {
          /* handler error — ignore */
        }
      });
      if (!this.intentionalClose) {
        this._scheduleReconnect();
      }
    };

    ws.onerror = () => {
      // Let onclose handle reconnect logic.
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    };
  }

  private _scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = this.reconnectDelay;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_RECONNECT_DELAY);
      if (!this.intentionalClose) this._open();
    }, delay);
  }
}

export const wsClient = new WebSocketClient();
