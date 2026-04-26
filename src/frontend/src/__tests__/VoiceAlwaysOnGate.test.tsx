/**
 * Phase 11b.1 — VoiceAlwaysOnGate reactivity test.
 *
 * The gate reads `values.voice_always_on_enabled` from settingsStore
 * and drives the `enabled` prop of useVoiceAlwaysOn. Flipping the
 * setting MUST start/stop the WS without the user refreshing the app.
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import { VoiceAlwaysOnGate } from '../components/chat/VoiceAlwaysOnGate';
import { useSettingsStore } from '../stores/settingsStore';
import { useVoiceAlwaysOnStatusStore } from '../stores/voiceAlwaysOnStatusStore';
import { __resetMicStream } from '../hooks/useMicStream';
import { useInputMode } from '../stores/inputModeStore';

// ---- WebSocket fake mirroring the always-on test harness --------------------

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
  send(payload: string | ArrayBuffer) { this.sent.push(payload); }
  close() {
    this.readyState = FakeWebSocket.CLOSED;
    const ev = new Event('close');
    this.onclose?.(ev as CloseEvent);
    (this._listeners.get('close') ?? []).forEach((cb) => cb(ev));
  }
  _open() {
    this.readyState = FakeWebSocket.OPEN;
    const ev = new Event('open');
    (this._listeners.get('open') ?? []).forEach((cb) => cb(ev));
  }
}

beforeEach(() => {
  __resetMicStream();
  useInputMode.setState({ mode: 'idle' });
  FakeWebSocket.instances = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).WebSocket = FakeWebSocket;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).AudioContext = class {
    audioWorklet = { addModule: () => Promise.resolve() };
    createMediaStreamSource() { return { connect() { /* noop */ }, disconnect() {} }; }
    createGain() { return { gain: { value: 0 }, connect: (t: unknown) => t }; }
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (navigator as any).mediaDevices = {
    getUserMedia: () =>
      Promise.resolve({ getTracks: () => [{ stop: vi.fn() }] }),
  };
  useSettingsStore.setState({ values: {}, loaded: true });
});

describe('VoiceAlwaysOnGate — Phase 11c.5 freeze', () => {
  // Pre-11c.5 the gate reacted to settingsStore.values.voice_always_on_enabled
  // and started/stopped a WS. After Phase 11c.5 the feature is disabled at
  // the gate itself (FEATURE_DISABLED constant) so no WS opens regardless
  // of what the setting says. See docs/phase-11c.5/known-issues.md.

  it('does NOT open a WS when voice_always_on_enabled is undefined / false', async () => {
    render(<VoiceAlwaysOnGate />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(FakeWebSocket.instances.length).toBe(0);
  });

  it('does NOT open a WS even when the setting flips to true (freeze)', async () => {
    render(<VoiceAlwaysOnGate />);
    act(() => {
      useSettingsStore.setState({
        values: { voice_always_on_enabled: true },
      });
    });
    // Give effects a tick to run.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    // Phase 11c.5 — FEATURE_DISABLED forces `enabled` to false at the gate
    // so the hook stays idle. If this assertion ever flips, that means
    // FEATURE_DISABLED was unfrozen — make sure the bugs in
    // docs/phase-11c.5/known-issues.md are addressed first.
    expect(FakeWebSocket.instances.length).toBe(0);
  });

  it('does NOT open a WS when the setting toggles true → false (freeze)', async () => {
    render(<VoiceAlwaysOnGate />);
    act(() => {
      useSettingsStore.setState({
        values: { voice_always_on_enabled: true },
      });
    });
    await act(async () => {
      await Promise.resolve();
    });
    act(() => {
      useSettingsStore.setState({
        values: { voice_always_on_enabled: false },
      });
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(FakeWebSocket.instances.length).toBe(0);
  });
});

describe('VoiceAlwaysOnGate — phase 11c.3 global status store (post 11c.5 freeze)', () => {
  beforeEach(() => {
    useVoiceAlwaysOnStatusStore.setState({ status: 'disabled' });
  });

  it('writes initial "disabled" to the global status store on mount when off', async () => {
    render(<VoiceAlwaysOnGate />);
    await waitFor(() => {
      expect(useVoiceAlwaysOnStatusStore.getState().status).toBe('disabled');
    });
  });

  it('keeps the global status at "disabled" even if the setting flips to true (freeze)', async () => {
    render(<VoiceAlwaysOnGate />);
    act(() => {
      useSettingsStore.setState({
        values: { voice_always_on_enabled: true },
      });
    });
    // Phase 11c.5 — FEATURE_DISABLED keeps the underlying hook idle, so
    // the global status store must stay at 'disabled'. If this fails, the
    // freeze flag was unintentionally lifted somewhere.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(useVoiceAlwaysOnStatusStore.getState().status).toBe('disabled');
  });
});
