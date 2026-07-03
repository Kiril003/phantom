/**
 * B1 — incremental sentence TTS player.
 * The backend ships chat/tts.sentence events (base64 WAV, seq-ordered);
 * the player must play them sequentially and drop everything on stop.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TtsSentencePlayer, type TtsSentenceEvent } from '../services/ttsPlayer';

class FakeAudio {
  static instances: FakeAudio[] = [];
  src: string;
  paused = false;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(src: string) {
    this.src = src;
    FakeAudio.instances.push(this);
  }
  play(): Promise<void> {
    return Promise.resolve();
  }
  pause(): void {
    this.paused = true;
  }
  /** Test helper — simulate playback completion. */
  end(): void {
    this.onended?.();
  }
}

function evt(seq: number, messageId = 'm1'): TtsSentenceEvent {
  return {
    message_id: messageId,
    seq,
    text: `речення ${seq}`,
    audio_b64: btoa(`wav-${seq}`),
    sample_rate: 22050,
  };
}

describe('TtsSentencePlayer', () => {
  let player: TtsSentencePlayer;

  beforeEach(() => {
    FakeAudio.instances = [];
    vi.stubGlobal('Audio', FakeAudio as unknown as typeof Audio);
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => `blob:${Math.random()}`),
      revokeObjectURL: vi.fn(),
    });
    player = new TtsSentencePlayer();
  });

  it('plays the first sentence immediately and queues the rest', () => {
    player.enqueue(evt(1));
    player.enqueue(evt(2));
    expect(FakeAudio.instances.length).toBe(1);
    expect(player.playing).toBe(true);
    expect(player.pending).toBe(1);
  });

  it('advances to the next sentence when playback ends', () => {
    player.enqueue(evt(1));
    player.enqueue(evt(2));
    FakeAudio.instances[0].end();
    expect(FakeAudio.instances.length).toBe(2);
    FakeAudio.instances[1].end();
    expect(player.playing).toBe(false);
    expect(player.pending).toBe(0);
  });

  it('orders out-of-order seq arrivals', () => {
    player.enqueue(evt(1));
    player.enqueue(evt(3));
    player.enqueue(evt(2));
    FakeAudio.instances[0].end(); // finished #1
    FakeAudio.instances[1].end(); // next must be #2
    // Audio instances are created in play order: 1 → 2 → 3.
    expect(FakeAudio.instances.length).toBe(3);
    expect(player.pending).toBe(0);
  });

  it('stop() pauses current audio and clears the queue', () => {
    player.enqueue(evt(1));
    player.enqueue(evt(2));
    player.stop();
    expect(FakeAudio.instances[0].paused).toBe(true);
    expect(player.playing).toBe(false);
    expect(player.pending).toBe(0);
    // ended callback after stop must NOT resurrect playback
    FakeAudio.instances[0].end();
    expect(FakeAudio.instances.length).toBe(1);
  });

  it('a new message id supersedes the previous stream', () => {
    player.enqueue(evt(1, 'msgA'));
    player.enqueue(evt(2, 'msgA'));
    player.enqueue(evt(1, 'msgB'));
    // msgA playback dropped; msgB starts fresh
    expect(FakeAudio.instances[0].paused).toBe(true);
    expect(player.playing).toBe(true);
    expect(player.pending).toBe(0);
  });

  it('ignores events without audio payload', () => {
    player.enqueue({ ...evt(1), audio_b64: '' });
    expect(player.playing).toBe(false);
  });
});
