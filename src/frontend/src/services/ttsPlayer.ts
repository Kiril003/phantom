/**
 * ttsPlayer — B1 incremental sentence TTS playback.
 *
 * The backend sentence-splits the reply delta stream, synthesizes each
 * sentence and broadcasts `chat`/`tts.sentence` WS events (base64 WAV,
 * ordered by `seq`). This player queues them and plays sequentially so
 * the voice starts with the FIRST sentence — long before the full reply
 * lands. `chat`/`tts.stop` (new user message = interrupt) halts playback
 * and drops the queue.
 */
import { wsClient, type WSMessage } from './websocket';

export interface TtsSentenceEvent {
  message_id: string;
  session_id?: string;
  seq: number;
  text?: string;
  audio_b64: string;
  sample_rate?: number;
}

function b64ToWavUrl(b64: string): string {
  const raw = atob(b64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
}

export class TtsSentencePlayer {
  private queue: Array<{ seq: number; url: string }> = [];
  private current: HTMLAudioElement | null = null;
  private currentUrl: string | null = null;
  private messageId: string | null = null;

  enqueue(evt: TtsSentenceEvent): void {
    if (!evt.audio_b64) return;
    // A new message id supersedes the previous one mid-flight.
    if (this.messageId !== null && evt.message_id !== this.messageId) {
      this.stop();
    }
    this.messageId = evt.message_id;
    this.queue.push({ seq: evt.seq, url: b64ToWavUrl(evt.audio_b64) });
    this.queue.sort((a, b) => a.seq - b.seq);
    if (!this.current) this.playNext();
  }

  stop(): void {
    if (this.current) {
      try {
        this.current.pause();
      } catch {
        /* already stopped */
      }
      this.current = null;
    }
    if (this.currentUrl) {
      URL.revokeObjectURL(this.currentUrl);
      this.currentUrl = null;
    }
    this.queue.forEach((item) => URL.revokeObjectURL(item.url));
    this.queue = [];
    this.messageId = null;
  }

  get playing(): boolean {
    return this.current !== null;
  }

  get pending(): number {
    return this.queue.length;
  }

  private playNext(): void {
    const next = this.queue.shift();
    if (!next) {
      this.current = null;
      return;
    }
    const audio = new Audio(next.url);
    this.current = audio;
    this.currentUrl = next.url;
    const advance = () => {
      URL.revokeObjectURL(next.url);
      if (this.current === audio) {
        this.current = null;
        this.currentUrl = null;
        this.playNext();
      }
    };
    audio.onended = advance;
    audio.onerror = advance;
    void audio.play().catch(advance);
  }
}

export const ttsPlayer = new TtsSentencePlayer();

/**
 * Wire the player into the chat WS channel. Returns an unsubscribe fn —
 * registered once from `wsHandlers.registerWsHandlers()`.
 */
export function registerTtsPlayerWsHandler(): () => void {
  return wsClient.on<WSMessage>('chat', (msg) => {
    if (msg.type === 'tts.sentence') {
      ttsPlayer.enqueue(msg.data as unknown as TtsSentenceEvent);
      return;
    }
    if (msg.type === 'tts.stop') {
      ttsPlayer.stop();
    }
  });
}
