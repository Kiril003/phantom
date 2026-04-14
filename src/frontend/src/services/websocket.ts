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
  | 'settings';

export interface WSMessage {
  channel: WSChannel;
  type: string;
  data: Record<string, unknown>;
  ts?: number;
}

// Typed payloads per channel
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

class WebSocketClient {
  private ws: WebSocket | null = null;
  private token: string | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private readonly maxReconnectDelay = 30000;
  private intentionalClose = false;

  private connectHandlers: ConnectHandler[] = [];
  private disconnectHandlers: DisconnectHandler[] = [];
  private channelHandlers = new Map<WSChannel, ChannelHandler[]>();

  connect(token?: string): void {
    this.token = token;
    this.intentionalClose = false;
    this._open();
  }

  disconnect(): void {
    this.intentionalClose = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close(1000, 'client disconnect');
    this.ws = null;
  }

  send(msg: WSMessage): void {
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
    return () => {
      const current = this.channelHandlers.get(channel) ?? [];
      this.channelHandlers.set(
        channel,
        current.filter((h) => h !== (handler as ChannelHandler))
      );
    };
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private _open(): void {
    const url = new URL('/ws', window.location.href);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    if (this.token) url.searchParams.set('token', this.token);

    this.ws = new WebSocket(url.toString());

    this.ws.onopen = () => {
      this.reconnectDelay = 1000;
      this.connectHandlers.forEach((h) => h());
    };

    this.ws.onmessage = (event: MessageEvent<string>) => {
      try {
        const msg = JSON.parse(event.data) as WSMessage;
        const handlers = this.channelHandlers.get(msg.channel) ?? [];
        handlers.forEach((h) => h(msg));
      } catch {
        // malformed message — ignore
      }
    };

    this.ws.onclose = () => {
      this.disconnectHandlers.forEach((h) => h());
      if (!this.intentionalClose) {
        this._scheduleReconnect();
      }
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  private _scheduleReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
      this._open();
    }, this.reconnectDelay);
  }
}

export const wsClient = new WebSocketClient();
