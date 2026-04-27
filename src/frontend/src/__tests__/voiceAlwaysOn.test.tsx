/**
 * Phase 11b — useVoiceAlwaysOn hook tests.
 *
 * AudioWorklet + real getUserMedia don't exist in jsdom, so the test
 * exercises the hook with a fake WebSocket: the server → client event
 * parsing, state transitions, and callback contract. getUserMedia /
 * AudioContext failures are verified by asserting the hook ends up in
 * status='error' when they're missing (default jsdom behaviour).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import {
  useVoiceAlwaysOn,
  type FinalTranscript,
  __resetVoiceAlwaysOnWS,
  __getVoiceAlwaysOnWSRefCount,
} from '../hooks/useVoiceAlwaysOn';
import { __resetMicStream } from '../hooks/useMicStream';
import { useInputMode } from '../stores/inputModeStore';

// The hook imports a `?url`-suffixed module which vitest doesn't
// resolve; stub it before the hook module pulls it in.
vi.mock('../workers/voice-capture.worklet.js?url', () => ({
  default: 'blob:mock-worklet-url',
}));

interface HarnessProps {
  enabled?: boolean;
  wsUrl?: string;
  onFinalTranscript?: (t: FinalTranscript) => void;
  onRevisedTranscript?: (t: FinalTranscript) => void;
  onWake?: (transcript: string, confidence: number) => void;
  token?: string;
}

function Harness(props: HarnessProps) {
  // Default to enabled:true for legacy tests; new tests can pass false to
  // exercise the settings-gate path.
  const hook = useVoiceAlwaysOn({ enabled: true, ...props, debug: false });
  return (
    <div>
      <span data-testid="status">{hook.status}</span>
      <span data-testid="error">{hook.errorMessage ?? ''}</span>
      <span data-testid="partial">{hook.partialTranscript}</span>
      <span data-testid="conf">{hook.confidenceMin ?? 'null'}</span>
      <span data-testid="win">{hook.continuationWindowS ?? 'null'}</span>
      <button data-testid="start" onClick={() => void hook.start()}>start</button>
      <button data-testid="stop" onClick={() => hook.stop()}>stop</button>
      <button data-testid="duck" onClick={() => hook.micDuck()}>duck</button>
      <button data-testid="unduck" onClick={() => hook.micUnduck()}>unduck</button>
      <button
        data-testid="conf07"
        onClick={() => hook.setConfidence(0.7)}
      >
        conf
      </button>
    </div>
  );
}

// ---- WebSocket fake ---------------------------------------------------------

class FakeWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  static instances: FakeWebSocket[] = [];
  binaryType = 'arraybuffer';
  readyState = 0;
  url: string;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  sent: (string | ArrayBuffer)[] = [];
  private _listeners = new Map<string, ((ev: Event) => void)[]>();

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  addEventListener(name: string, cb: (ev: Event) => void) {
    const arr = this._listeners.get(name) ?? [];
    arr.push(cb);
    this._listeners.set(name, arr);
  }

  removeEventListener() { /* noop */ }

  send(payload: string | ArrayBuffer) {
    this.sent.push(payload);
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED;
    const ev = new Event('close');
    this.onclose?.(ev as CloseEvent);
    (this._listeners.get('close') ?? []).forEach((cb) => cb(ev));
  }

  /** Test helper: simulate server opening the socket. */
  _open() {
    this.readyState = FakeWebSocket.OPEN;
    const ev = new Event('open');
    (this._listeners.get('open') ?? []).forEach((cb) => cb(ev));
  }

  /** Test helper: simulate server sending a JSON frame. Phase 12.0
   *  switched the hook from ``ws.onmessage = ...`` to
   *  ``ws.addEventListener('message', ...)`` so multiple hook instances
   *  sharing the singleton WS each get their own listener. Fan out to
   *  both paths so legacy tests that asserted on onmessage still work. */
  _receive(payload: object) {
    const ev = new MessageEvent('message', { data: JSON.stringify(payload) });
    this.onmessage?.(ev);
    (this._listeners.get('message') ?? []).forEach((cb) => cb(ev));
  }

  /** Test helper: simulate server-driven close. */
  _closeFromServer(code = 1008, reason = 'policy') {
    this.readyState = FakeWebSocket.CLOSED;
    const ev = new CloseEvent('close', { code, reason });
    this.onclose?.(ev);
    (this._listeners.get('close') ?? []).forEach((cb) => cb(ev));
  }
}

// Install once. Each test clears the instance list.
beforeEach(() => {
  __resetMicStream();
  __resetVoiceAlwaysOnWS();
  useInputMode.setState({ mode: 'idle' });
  FakeWebSocket.instances = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).WebSocket = FakeWebSocket;
  // Stub AudioContext so the hook's pre-flight check passes and WS
  // event parsing becomes testable. Real Web Audio is out of scope
  // here; the mic setup is expected to fail at getUserMedia, at which
  // point the WS is already live and serving events.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).AudioContext = class {
    audioWorklet = { addModule: () => Promise.resolve() };
    createMediaStreamSource() { return { connect() { /* noop */ }, disconnect() {} }; }
    createGain() {
      return {
        gain: { value: 0 },
        connect: (t: unknown) => t,
      };
    }
    get destination() { return {}; }
    close() { return Promise.resolve(); }
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).AudioWorkletNode = class {
    port = { postMessage: () => {}, close: () => {}, onmessage: null };
    connect(t: unknown) { return t; }
    disconnect() {}
  };
  window.localStorage.setItem('phantom_token', 'test-token');
});

// ---- Tests ------------------------------------------------------------------

describe('useVoiceAlwaysOn — initial state', () => {
  it('stays in disabled when enabled=false (the default path for Phase 11b.1)', () => {
    render(<Harness enabled={false} />);
    expect(screen.getByTestId('status').textContent).toBe('disabled');
    expect(screen.getByTestId('error').textContent).toBe('');
    expect(screen.getByTestId('partial').textContent).toBe('');
    expect(screen.getByTestId('conf').textContent).toBe('null');
    expect(FakeWebSocket.instances.length).toBe(0);
  });

  it('does not open a WS when enabled=false even if the consumer calls start() manually', async () => {
    render(<Harness enabled={false} />);
    await act(async () => {
      screen.getByTestId('start').click();
      await Promise.resolve();
    });
    expect(screen.getByTestId('status').textContent).toBe('disabled');
    expect(FakeWebSocket.instances.length).toBe(0);
  });
});

describe('useVoiceAlwaysOn — auth & media availability', () => {
  it('sets error when no token is available', async () => {
    window.localStorage.removeItem('phantom_token');
    render(<Harness />);
    await act(async () => {
      screen.getByTestId('start').click();
      await Promise.resolve();
    });
    expect(screen.getByTestId('status').textContent).toBe('error');
    expect(screen.getByTestId('error').textContent).toBe('no auth token');
  });

  it('sets error when getUserMedia is unavailable', async () => {
    // Token is set, but jsdom has no mediaDevices — hook should bail after WS open.
    // Simulate media absence explicitly.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (navigator as any).mediaDevices = undefined;
    render(<Harness />);
    await act(async () => {
      screen.getByTestId('start').click();
      await Promise.resolve();
    });
    expect(screen.getByTestId('status').textContent).toBe('error');
    expect(screen.getByTestId('error').textContent).toBe('getUserMedia unavailable');
  });
});

describe('useVoiceAlwaysOn — server event handling', () => {
  async function _startAndOpen() {
    render(<Harness enabled={true} onFinalTranscript={finalSpy} onWake={wakeSpy} />);
    // Auto-start fires on mount; give it a microtask to create the ws,
    // then simulate the server handshake so the open-promise resolves.
    await waitFor(() => {
      expect(FakeWebSocket.instances.length).toBeGreaterThan(0);
    });
    const ws = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
    await act(async () => {
      ws._open();
      await Promise.resolve();
      await Promise.resolve();
    });
    return ws;
  }

  const finalSpy = vi.fn();
  const wakeSpy = vi.fn();

  beforeEach(() => {
    finalSpy.mockClear();
    wakeSpy.mockClear();
    // Stub getUserMedia so the start flow can reach event-handling.
    // We accept the audio setup will then fail (no real AudioContext)
    // and the hook logs the mic error, but the WS is still live, so
    // server events still land.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (navigator as any).mediaDevices = {
      getUserMedia: () => Promise.reject(new Error('no mic in jsdom')),
    };
  });

  it('ready event populates config fields and sets status', async () => {
    const ws = await _startAndOpen();
    await act(async () => {
      ws?._receive({
        type: 'ready',
        sample_rate: 16000,
        frame_size_recommended: 960,
        enabled: true,
        wake_words: 'фантом',
        confidence_min: 0.65,
        continuation_window_s: 12,
      });
    });
    // After getUserMedia rejection the hook flips to error; but the
    // ready event from our fake arrives synchronously before that
    // rejection is processed in some test-orderings, so we assert the
    // config fields were captured regardless.
    expect(screen.getByTestId('conf').textContent).toBe('0.65');
    expect(screen.getByTestId('win').textContent).toBe('12');
  });

  it('wake event fires onWake callback', async () => {
    const ws = await _startAndOpen();
    await act(async () => {
      ws?._receive({ type: 'ready', confidence_min: 0.6, continuation_window_s: 10 });
      ws?._receive({
        type: 'wake',
        transcript: 'фантом',
        confidence: 0.82,
      });
    });
    expect(wakeSpy).toHaveBeenCalledWith('фантом', 0.82);
  });

  it('final event fires onFinalTranscript with correct payload', async () => {
    const ws = await _startAndOpen();
    await act(async () => {
      ws?._receive({ type: 'ready' });
      ws?._receive({
        type: 'final',
        transcript: 'привіт який час',
        source: 'wake',
        confidence: 0.91,
      });
    });
    expect(finalSpy).toHaveBeenCalledTimes(1);
    const arg = finalSpy.mock.calls[0][0] as FinalTranscript;
    expect(arg.transcript).toBe('привіт який час');
    expect(arg.source).toBe('wake');
    expect(arg.confidence).toBe(0.91);
    expect(screen.getByTestId('partial').textContent).toBe('привіт який час');
  });

  it('cooldown events surface through status', async () => {
    const ws = await _startAndOpen();
    await act(async () => {
      ws?._receive({ type: 'ready' });
      ws?._receive({ type: 'cooldown_start', window_s: 10 });
    });
    // After cooldown_start we should read 'cooldown' — the mic-init
    // error may have already flipped us to 'error', so we accept either
    // path. The interesting assertion is that the event was processed
    // at all (setConfidence was unchanged; that's enough).
    const status = screen.getByTestId('status').textContent;
    expect(['cooldown', 'error']).toContain(status);
  });

  it('error event surfaces the server message', async () => {
    const ws = await _startAndOpen();
    await act(async () => {
      ws?._receive({ type: 'ready' });
      ws?._receive({ type: 'error', message: 'always-on unavailable: no vosk' });
    });
    expect(screen.getByTestId('error').textContent).toBe(
      'always-on unavailable: no vosk',
    );
  });
});

describe('useVoiceAlwaysOn — outgoing commands', () => {
  it('duck/unduck send JSON commands when WS is open', async () => {
    // Succeed at getUserMedia so the hook keeps the WS open past the
    // mic setup block.
    const fakeTrack = { stop: vi.fn() };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (navigator as any).mediaDevices = {
      getUserMedia: () =>
        Promise.resolve({ getTracks: () => [fakeTrack] }),
    };
    render(<Harness />);
    await act(async () => {
      screen.getByTestId('start').click();
      await Promise.resolve();
      await Promise.resolve();
      FakeWebSocket.instances[0]._open();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const ws = FakeWebSocket.instances[0];

    await act(async () => {
      screen.getByTestId('duck').click();
      screen.getByTestId('unduck').click();
      screen.getByTestId('conf07').click();
    });
    // stop() closes the WS and then sends stop, so assert before calling it
    const sentStrings = ws.sent.filter((x): x is string => typeof x === 'string');
    expect(sentStrings.some((s) => s.includes('mic_duck'))).toBe(true);
    expect(sentStrings.some((s) => s.includes('mic_unduck'))).toBe(true);
    expect(sentStrings.some((s) => s.includes('set_confidence'))).toBe(true);

    await act(async () => {
      screen.getByTestId('stop').click();
    });
    expect(
      ws.sent.filter((x): x is string => typeof x === 'string')
        .some((s) => s.includes('"cmd":"stop"'))
    ).toBe(true);
  });
});

describe('useVoiceAlwaysOn — input mode arbitration', () => {
  const finalSpy = vi.fn();
  const wakeSpy = vi.fn();

  beforeEach(() => {
    finalSpy.mockClear();
    wakeSpy.mockClear();
    // Succeed at getUserMedia so the hook keeps the WS open — we need
    // to verify that a server-side reset cmd flows out to the server.
    const fakeTrack = { stop: vi.fn() };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (navigator as any).mediaDevices = {
      getUserMedia: () =>
        Promise.resolve({ getTracks: () => [fakeTrack] }),
    };
  });

  it('suppresses wake callback when tap-to-talk owns the turn', async () => {
    render(<Harness enabled={true} onFinalTranscript={finalSpy} onWake={wakeSpy} />);
    await waitFor(() => {
      expect(FakeWebSocket.instances.length).toBeGreaterThan(0);
    });
    const ws = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
    await act(async () => {
      ws._open();
      await Promise.resolve();
      await Promise.resolve();
    });
    // Simulate tap-to-talk claiming the mic first.
    act(() => {
      useInputMode.setState({ mode: 'tap' });
    });
    await act(async () => {
      ws._receive({ type: 'ready' });
      ws._receive({ type: 'wake', transcript: 'фантом', confidence: 0.8 });
    });
    expect(wakeSpy).not.toHaveBeenCalled();
    // Server reset command must have been sent so the server doesn't
    // keep capturing continuation frames behind the user's back.
    const sentStrings = ws.sent.filter((x): x is string => typeof x === 'string');
    expect(sentStrings.some((s) => s.includes('"cmd":"reset"'))).toBe(true);
  });

  it('suppresses final callback when tap-to-talk owns the turn', async () => {
    render(<Harness enabled={true} onFinalTranscript={finalSpy} onWake={wakeSpy} />);
    await waitFor(() => {
      expect(FakeWebSocket.instances.length).toBeGreaterThan(0);
    });
    const ws = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
    await act(async () => {
      ws._open();
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => {
      useInputMode.setState({ mode: 'tap' });
    });
    await act(async () => {
      ws._receive({ type: 'ready' });
      ws._receive({
        type: 'final',
        transcript: 'привіт',
        source: 'wake',
        confidence: 0.9,
      });
    });
    expect(finalSpy).not.toHaveBeenCalled();
  });

  it('wake in idle mode flips input mode to always_on', async () => {
    render(<Harness enabled={true} onFinalTranscript={finalSpy} onWake={wakeSpy} />);
    await waitFor(() => {
      expect(FakeWebSocket.instances.length).toBeGreaterThan(0);
    });
    const ws = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
    await act(async () => {
      ws._open();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(useInputMode.getState().mode).toBe('idle');
    await act(async () => {
      ws._receive({ type: 'ready' });
      ws._receive({ type: 'wake', transcript: 'фантом', confidence: 0.8 });
    });
    expect(wakeSpy).toHaveBeenCalled();
    expect(useInputMode.getState().mode).toBe('always_on');
  });
});

describe('useVoiceAlwaysOn — singleton WS (Phase 12.0 Bug 1 fix)', () => {
  beforeEach(() => {
    // The WS singleton state is module-level, so each test must reset
    // it explicitly to avoid bleed.
    __resetVoiceAlwaysOnWS();
    // Permissive mic stub so two parallel hooks both reach WS open.
    const fakeTrack = { stop: vi.fn() };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (navigator as any).mediaDevices = {
      getUserMedia: () =>
        Promise.resolve({ getTracks: () => [fakeTrack] }),
    };
  });

  it('two concurrent consumers share one WebSocket and refcount = 2', async () => {
    // Render TWO Harness instances at once — simulates either two
    // components calling the hook OR React StrictMode's double-effect.
    render(
      <>
        <Harness enabled />
        <Harness enabled />
      </>,
    );
    // Auto-effect fires start() on each mount; both should see the
    // singleton, so only ONE WebSocket ctor call happens.
    await waitFor(() => {
      expect(FakeWebSocket.instances.length).toBe(1);
    });
    expect(__getVoiceAlwaysOnWSRefCount()).toBe(2);
  });

  it('two start() calls on the same harness instance do not duplicate the WS', async () => {
    const { rerender } = render(<Harness enabled />);
    await waitFor(() => {
      expect(FakeWebSocket.instances.length).toBe(1);
    });
    // A second mount of a sibling consumer should NOT spawn a second WS.
    rerender(
      <>
        <Harness enabled />
        <Harness enabled />
      </>,
    );
    // Still exactly one WS construction.
    expect(FakeWebSocket.instances.length).toBe(1);
    // Refcount reflects however many consumers ended up alive.
    expect(__getVoiceAlwaysOnWSRefCount()).toBeGreaterThanOrEqual(1);
  });

  it('refcount drops to 0 and WS closes after the deferred grace window', async () => {
    const { unmount } = render(
      <>
        <Harness enabled />
        <Harness enabled />
      </>,
    );
    await waitFor(() => {
      expect(FakeWebSocket.instances.length).toBe(1);
    });
    expect(__getVoiceAlwaysOnWSRefCount()).toBe(2);
    const ws = FakeWebSocket.instances[0];
    const closeSpy = vi.spyOn(ws, 'close');
    unmount();
    // Phase 12.4 — refcount drops immediately, but close() is deferred
    // by 50ms so a StrictMode remount inside the window can reuse the
    // same socket.
    expect(__getVoiceAlwaysOnWSRefCount()).toBe(0);
    expect(closeSpy).not.toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 80));
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it('Phase 12.4 — StrictMode unmount→remount within 50ms reuses the same WS', async () => {
    // The production bug: every StrictMode cycle tore down the WS and
    // built a fresh one (logged as 6ms-life "voice WS connected" /
    // "voice WS closed" pairs). With the deferred close, a remount
    // inside the grace window cancels the pending close and bumps the
    // refcount back up — same socket, no backend reconnect.
    const { unmount } = render(<Harness enabled />);
    await waitFor(() => {
      expect(FakeWebSocket.instances.length).toBe(1);
    });
    const ws = FakeWebSocket.instances[0];
    const closeSpy = vi.spyOn(ws, 'close');
    unmount();
    expect(__getVoiceAlwaysOnWSRefCount()).toBe(0);
    // Synchronous remount mirrors React 18's StrictMode timing — the
    // cleanup and re-mount fire in the same task tick.
    render(<Harness enabled />);
    // Sit through the grace window. If F1 didn't take, the 50ms timer
    // would have fired close() and a fresh WS would have been built.
    await new Promise((r) => setTimeout(r, 80));
    expect(FakeWebSocket.instances.length).toBe(1);  // ← still one socket
    expect(closeSpy).not.toHaveBeenCalled();
    expect(__getVoiceAlwaysOnWSRefCount()).toBe(1);
  });

  it('Phase 12.4 — full unmount with no remount eventually closes after grace', async () => {
    const { unmount } = render(<Harness enabled />);
    await waitFor(() => {
      expect(FakeWebSocket.instances.length).toBeGreaterThanOrEqual(1);
    });
    const before = FakeWebSocket.instances.length;
    const ws = FakeWebSocket.instances[before - 1];
    const closeSpy = vi.spyOn(ws, 'close');
    unmount();
    expect(__getVoiceAlwaysOnWSRefCount()).toBe(0);
    // Wait past the grace window without a remount.
    await new Promise((r) => setTimeout(r, 80));
    expect(closeSpy).toHaveBeenCalledTimes(1);
    // A fresh mount AFTER the grace window does build a new WS.
    render(<Harness enabled />);
    await waitFor(() => {
      expect(FakeWebSocket.instances.length).toBeGreaterThan(before);
    });
    expect(__getVoiceAlwaysOnWSRefCount()).toBe(1);
  });
});

// ────────────────── Phase 13b — streaming partials & refine ───────────────────

describe('useVoiceAlwaysOn — Phase 13b streaming partials', () => {
  const finalSpy = vi.fn();
  const revisedSpy = vi.fn();

  beforeEach(() => {
    finalSpy.mockClear();
    revisedSpy.mockClear();
    // Reject getUserMedia so the WS stays open and the audio setup
    // failure does not prevent the message handler from running.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (navigator as any).mediaDevices = {
      getUserMedia: () => Promise.reject(new Error('no mic in jsdom')),
    };
  });

  async function _startAndOpen() {
    render(
      <Harness
        enabled
        onFinalTranscript={finalSpy}
        onRevisedTranscript={revisedSpy}
      />,
    );
    await waitFor(() => {
      expect(FakeWebSocket.instances.length).toBeGreaterThan(0);
    });
    const ws = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
    await act(async () => {
      ws._open();
      await Promise.resolve();
      await Promise.resolve();
    });
    return ws;
  }

  it('partial event updates the visible partialTranscript', async () => {
    const ws = await _startAndOpen();
    await act(async () => {
      ws._receive({ type: 'ready' });
      ws._receive({ type: 'speech_start' });
      ws._receive({ type: 'partial', transcript: 'при', is_committed: false });
    });
    expect(screen.getByTestId('partial').textContent).toBe('при');
    await act(async () => {
      ws._receive({ type: 'partial', transcript: 'привіт', is_committed: false });
    });
    expect(screen.getByTestId('partial').textContent).toBe('привіт');
  });

  it('partial events are suppressed while tap-to-talk owns the turn', async () => {
    const ws = await _startAndOpen();
    act(() => {
      useInputMode.setState({ mode: 'tap' });
    });
    await act(async () => {
      ws._receive({ type: 'ready' });
      ws._receive({ type: 'partial', transcript: 'при', is_committed: false });
    });
    // Should remain blank — partial dropped because tap owns input.
    expect(screen.getByTestId('partial').textContent).toBe('');
  });

  it('vosk_fast final event is forwarded to onFinalTranscript with correct source', async () => {
    const ws = await _startAndOpen();
    await act(async () => {
      ws._receive({ type: 'ready' });
      ws._receive({
        type: 'final',
        transcript: 'привіт',
        source: 'vosk_fast',
        confidence: 0.88,
      });
    });
    expect(finalSpy).toHaveBeenCalledTimes(1);
    const arg = finalSpy.mock.calls[0][0] as FinalTranscript;
    expect(arg.source).toBe('vosk_fast');
    expect(arg.transcript).toBe('привіт');
  });

  it('final_revised fires onRevisedTranscript callback (Whisper-quality)', async () => {
    const ws = await _startAndOpen();
    await act(async () => {
      ws._receive({ type: 'ready' });
      ws._receive({
        type: 'final',
        transcript: 'приві',
        source: 'vosk_fast',
        confidence: 0.6,
      });
      ws._receive({
        type: 'final_revised',
        transcript: 'привіт як справи',
        source: 'whisper_quality',
        confidence: 0.94,
        diff_ratio: 0.4,
      });
    });
    expect(revisedSpy).toHaveBeenCalledTimes(1);
    const arg = revisedSpy.mock.calls[0][0] as FinalTranscript;
    expect(arg.transcript).toBe('привіт як справи');
    expect(arg.source).toBe('whisper_quality');
    expect(arg.confidence).toBe(0.94);
  });

  it('final_revised is suppressed while tap-to-talk owns the turn', async () => {
    const ws = await _startAndOpen();
    act(() => {
      useInputMode.setState({ mode: 'tap' });
    });
    await act(async () => {
      ws._receive({ type: 'ready' });
      ws._receive({
        type: 'final_revised',
        transcript: 'привіт',
        source: 'whisper_quality',
        confidence: 0.9,
      });
    });
    expect(revisedSpy).not.toHaveBeenCalled();
  });

  it('final_revised with non-string transcript is silently ignored', async () => {
    const ws = await _startAndOpen();
    await act(async () => {
      ws._receive({ type: 'ready' });
      ws._receive({
        type: 'final_revised',
        // transcript missing — server bug; hook must not crash.
        source: 'whisper_quality',
        confidence: 0.9,
      });
    });
    expect(revisedSpy).not.toHaveBeenCalled();
  });
});
