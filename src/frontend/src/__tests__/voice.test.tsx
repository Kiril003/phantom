/**
 * Phase 07 — Voice client + UI smoke tests.
 *
 * jsdom can't do real microphones, so we stub `navigator.mediaDevices`
 * and `MediaRecorder` and assert at the boundary: does voiceApi speak
 * the right HTTP contract, and does the hook's public state-machine
 * progress from idle → requesting → recording → idle on stop.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import { voiceApi } from '../services/voiceApi';
import { useVoiceRecorder } from '../hooks/useVoiceRecorder';

/* ─── fetch stubbing helpers ────────────────────────────────────────────── */

function mockFetch(response: { status?: number; body?: unknown; blob?: Blob; headers?: Record<string, string> }) {
  const status = response.status ?? 200;
  const headers = new Headers(response.headers ?? {});
  const init: ResponseInit = { status, headers };
  let res: Response;
  if (response.blob) {
    res = new Response(response.blob, init);
  } else {
    res = new Response(JSON.stringify(response.body ?? {}), {
      ...init,
      headers: new Headers({ 'Content-Type': 'application/json', ...(response.headers ?? {}) }),
    });
  }
  return vi.fn().mockResolvedValue(res);
}

/* ═══════════════════════════════════════════════════════════════════════════
   voiceApi
   ═══════════════════════════════════════════════════════════════════════════ */

describe('voiceApi.transcribe', () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('POSTs multipart form and returns the parsed STT response', async () => {
    const stub = mockFetch({
      body: {
        text: 'привіт фантом',
        confidence: 0.9,
        engine: 'vosk',
        language: 'uk',
        wake_word_matched: true,
      },
    });
    globalThis.fetch = stub as unknown as typeof fetch;

    const blob = new Blob([new Uint8Array([0, 1, 2, 3])], { type: 'audio/webm' });
    const result = await voiceApi.transcribe(blob);

    expect(result.text).toBe('привіт фантом');
    expect(result.wake_word_matched).toBe(true);

    const [url, init] = stub.mock.calls[0];
    expect(url).toBe('/api/v1/voice/stt');
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
  });

  it('throws with server detail on non-2xx', async () => {
    const stub = mockFetch({ status: 400, body: { detail: 'Empty audio upload' } });
    globalThis.fetch = stub as unknown as typeof fetch;
    const blob = new Blob([], { type: 'audio/webm' });
    await expect(voiceApi.transcribe(blob)).rejects.toThrow(/Empty audio upload/);
  });
});

describe('voiceApi.synthesize', () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('returns blob + engine header metadata', async () => {
    const wavStub = new Blob([new Uint8Array([0, 1, 2])], { type: 'audio/wav' });
    const stub = mockFetch({
      blob: wavStub,
      headers: { 'X-Engine': 'piper', 'X-Sample-Rate': '22050' },
    });
    globalThis.fetch = stub as unknown as typeof fetch;

    const { blob, engine, sampleRate } = await voiceApi.synthesize('привіт', {
      voice: 'uk-voice',
      speed: 1.2,
    });

    // vitest and jsdom can disagree on Blob identity across realms,
    // so assert on the shape instead of toBeInstanceOf(Blob).
    expect(blob).toBeTruthy();
    expect(typeof (blob as Blob).size).toBe('number');
    expect((blob as Blob).size).toBeGreaterThan(0);
    expect(engine).toBe('piper');
    expect(sampleRate).toBe(22050);

    const [url, init] = stub.mock.calls[0];
    expect(url).toBe('/api/v1/voice/tts');
    const body = JSON.parse(init.body as string);
    expect(body.text).toBe('привіт');
    expect(body.voice).toBe('uk-voice');
    expect(body.speed).toBe(1.2);
  });

  it('falls back to defaults when options omitted', async () => {
    const stub = mockFetch({ blob: new Blob([new Uint8Array([0])]) });
    globalThis.fetch = stub as unknown as typeof fetch;
    await voiceApi.synthesize('ok');
    const body = JSON.parse((stub.mock.calls[0][1] as RequestInit).body as string);
    expect(body.voice).toBe('');
    expect(body.speed).toBe(1.0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   useVoiceRecorder — behaviour on a stubbed MediaRecorder
   ═══════════════════════════════════════════════════════════════════════════ */

class FakeStream {
  _tracks = [{ stop: vi.fn() }];
  getTracks() {
    return this._tracks;
  }
}

class FakeMediaRecorder {
  static isTypeSupported = () => true;
  ondataavailable: ((ev: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((ev: { error: Error }) => void) | null = null;
  state: 'inactive' | 'recording' | 'paused' = 'inactive';
  mimeType = 'audio/webm';

  constructor(public stream: FakeStream, _opts?: unknown) {}

  start(_interval?: number) {
    this.state = 'recording';
    // Emit one chunk so onstop has something to build a Blob from.
    setTimeout(() => {
      this.ondataavailable?.({ data: new Blob([new Uint8Array([0, 1, 2])]) });
    }, 0);
  }

  stop() {
    this.state = 'inactive';
    // Asynchronously fire onstop so stop() remains a promise resolver.
    setTimeout(() => this.onstop?.(), 0);
  }
}

class FakeAnalyser {
  fftSize = 512;
  getByteTimeDomainData(arr: Uint8Array) {
    arr.fill(128); // silence
  }
  disconnect() {
    /* noop */
  }
}

class FakeAudioContext {
  createMediaStreamSource() {
    return { connect: vi.fn() };
  }
  createAnalyser() {
    return new FakeAnalyser();
  }
  close() {
    /* noop */
  }
}

describe('useVoiceRecorder', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia: vi.fn().mockResolvedValue(new FakeStream()),
      },
      configurable: true,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).MediaRecorder = FakeMediaRecorder;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).AudioContext = FakeAudioContext;
    if (typeof performance === 'undefined') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).performance = { now: () => Date.now() };
    }
  });

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).MediaRecorder;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).AudioContext;
  });

  it('transitions idle → recording → idle on start/stop', async () => {
    const { result } = renderHook(() => useVoiceRecorder());
    expect(result.current.state).toBe('idle');

    await act(async () => {
      await result.current.start();
    });
    expect(result.current.state).toBe('recording');

    const blobRef: { current: Blob | null } = { current: null };
    await act(async () => {
      blobRef.current = await result.current.stop();
    });
    expect(result.current.state).toBe('idle');
    expect(blobRef.current).not.toBeNull();
    expect((blobRef.current as Blob).size).toBeGreaterThan(0);
  });

  it('surfaces an error if getUserMedia is missing', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true });
    const { result } = renderHook(() => useVoiceRecorder());

    await act(async () => {
      try {
        await result.current.start();
      } catch {
        /* expected */
      }
    });
    expect(result.current.state).toBe('error');
    expect(result.current.error).toMatch(/getUserMedia/);
  });

  it('cancel() returns to idle without producing a blob', async () => {
    const { result } = renderHook(() => useVoiceRecorder());
    await act(async () => {
      await result.current.start();
    });
    act(() => {
      result.current.cancel();
    });
    expect(result.current.state).toBe('idle');
  });
});
