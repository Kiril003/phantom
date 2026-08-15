/**
 * ttsPlayer — B1 incremental sentence TTS playback.
 *
 * The backend sentence-splits the reply delta stream, synthesizes each
 * sentence and broadcasts `chat`/`tts.sentence` WS events (base64 WAV,
 * ordered by `seq`). This player queues them and plays sequentially so
 * the voice starts with the FIRST sentence — long before the full reply
 * lands. `chat`/`tts.stop` (new user message = interrupt) halts playback
 * and drops the queue.
 *
 * Потік обрамлений `tts.begin`/`tts.end`: між ними мікрофон заглушений (у
 * паузах між реченнями ФАНТОМ інакше чує сам себе), а `begin` забиває
 * message_id, щоб ChatWindow не сказав ту саму відповідь удруге.
 *
 * Operator stop control: this is also where "is PHANTOM audibly
 * speaking right now" lives for the whole frontend — `subscribe()` lets
 * a component reflect it, `setExternalAudio()` lets the ONE other place
 * that plays PHANTOM's voice (ChatWindow's whole-reply `/voice/tts`
 * fallback, used when the sentence-stream above never claimed the
 * message) register itself so a single `stop()` call silences either.
 */
import { wsClient, type WSMessage } from './websocket';
import { voiceAlwaysOnDuck, voiceAlwaysOnUnduck } from '../hooks/useVoiceAlwaysOn';

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

const CLAIM_HISTORY = 20;

export class TtsSentencePlayer {
  private queue: Array<{ seq: number; url: string }> = [];
  private current: HTMLAudioElement | null = null;
  private currentUrl: string | null = null;
  private messageId: string | null = null;
  private claimed: string[] = [];
  private streamEnded = true;
  private ducked = false;
  // The ChatWindow whole-reply fallback owns its own <audio> element (it
  // isn't sentence-chunked, so it doesn't go through the queue above) —
  // this is just a handle so stop() can reach it too. Null when nothing
  // outside this class is currently playing PHANTOM's voice.
  private externalAudio: HTMLAudioElement | null = null;
  private listeners = new Set<() => void>();

  hasClaimed(messageId: string): boolean {
    return this.claimed.includes(messageId);
  }

  /** Notified whenever `playing` may have changed — drives the stop
   * button's visibility. Returns an unsubscribe fn. */
  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private notify(): void {
    this.listeners.forEach((cb) => cb());
  }

  /** Register (or clear, with `null`) the fallback whole-reply <audio>
   * element so stop() can pause it too. The caller still owns the
   * element's lifecycle (creation, `ended`/`error` cleanup) — this is
   * only consulted for the interrupt path. */
  setExternalAudio(el: HTMLAudioElement | null): void {
    this.externalAudio = el;
    this.notify();
  }

  begin(messageId: string): void {
    if (this.messageId !== null && messageId !== this.messageId) {
      this.stop();
    }
    this.messageId = messageId;
    this.streamEnded = false;
    this.claimed.push(messageId);
    if (this.claimed.length > CLAIM_HISTORY) {
      this.claimed = this.claimed.slice(-CLAIM_HISTORY);
    }
    this.duck();
    this.notify();
  }

  end(messageId: string): void {
    if (this.messageId !== null && messageId !== this.messageId) return;
    this.streamEnded = true;
    if (!this.current && this.queue.length === 0) this.unduck();
    this.notify();
  }

  enqueue(evt: TtsSentenceEvent): void {
    if (!evt.audio_b64) return;
    // A new message id supersedes the previous one mid-flight.
    if (this.messageId !== null && evt.message_id !== this.messageId) {
      this.stop();
    }
    if (this.messageId !== evt.message_id) this.begin(evt.message_id);
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
    this.streamEnded = true;
    this.unduck();
    // Operator-visible interrupt (POST /voice/stop, or a superseding
    // message) must silence the whole-reply fallback too, not just the
    // sentence queue — the operator hears "PHANTOM talking", not "which
    // of two code paths produced it".
    if (this.externalAudio) {
      try {
        this.externalAudio.pause();
      } catch {
        /* already stopped */
      }
      this.externalAudio = null;
    }
    this.notify();
  }

  get playing(): boolean {
    return this.current !== null || this.externalAudio !== null;
  }

  get pending(): number {
    return this.queue.length;
  }

  private duck(): void {
    if (this.ducked) return;
    this.ducked = true;
    voiceAlwaysOnDuck();
  }

  private unduck(): void {
    if (!this.ducked) return;
    this.ducked = false;
    voiceAlwaysOnUnduck();
  }

  private playNext(): void {
    const next = this.queue.shift();
    if (!next) {
      this.current = null;
      if (this.streamEnded) this.unduck();
      this.notify();
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
    this.notify();
  }
}

export const ttsPlayer = new TtsSentencePlayer();

/**
 * Wire the player into the chat WS channel. Returns an unsubscribe fn —
 * registered once from `wsHandlers.registerWsHandlers()`.
 */
export function registerTtsPlayerWsHandler(): () => void {
  return wsClient.on<WSMessage>('chat', (msg) => {
    const data = msg.data as unknown as { message_id?: string };
    if (msg.type === 'tts.begin') {
      if (data?.message_id) ttsPlayer.begin(data.message_id);
      return;
    }
    if (msg.type === 'tts.sentence') {
      ttsPlayer.enqueue(msg.data as unknown as TtsSentenceEvent);
      return;
    }
    if (msg.type === 'tts.end') {
      if (data?.message_id) ttsPlayer.end(data.message_id);
      return;
    }
    if (msg.type === 'tts.stop') {
      ttsPlayer.stop();
    }
  });
}
