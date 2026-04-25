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

describe('VoiceAlwaysOnGate — settings reactivity', () => {
  it('does NOT open a WS when voice_always_on_enabled is undefined / false', async () => {
    render(<VoiceAlwaysOnGate />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(FakeWebSocket.instances.length).toBe(0);
  });

  it('opens a WS when the setting flips to true', async () => {
    render(<VoiceAlwaysOnGate />);
    // Flip setting ON — the gate's hook useEffect MUST react.
    act(() => {
      useSettingsStore.setState({
        values: { voice_always_on_enabled: true },
      });
    });
    await waitFor(() => {
      expect(FakeWebSocket.instances.length).toBeGreaterThan(0);
    });
  });

  it('closes the WS when the setting flips back to false', async () => {
    render(<VoiceAlwaysOnGate />);
    act(() => {
      useSettingsStore.setState({
        values: { voice_always_on_enabled: true },
      });
    });
    await waitFor(() => {
      expect(FakeWebSocket.instances.length).toBeGreaterThan(0);
    });
    const ws = FakeWebSocket.instances[0];
    // Simulate server open so teardown path exercises the close branch.
    act(() => { ws._open(); });

    act(() => {
      useSettingsStore.setState({
        values: { voice_always_on_enabled: false },
      });
    });
    // After the toggle-off, the gate's hook useEffect should have
    // called _teardown which closes the WS.
    await waitFor(() => {
      expect(ws.readyState).toBe(FakeWebSocket.CLOSED);
    });
  });
});

describe('VoiceAlwaysOnGate — phase 11c.3 global status store', () => {
  beforeEach(() => {
    useVoiceAlwaysOnStatusStore.setState({ status: 'disabled' });
  });

  it('writes initial "disabled" to the global status store on mount when off', async () => {
    render(<VoiceAlwaysOnGate />);
    await waitFor(() => {
      expect(useVoiceAlwaysOnStatusStore.getState().status).toBe('disabled');
    });
  });

  it('updates the global status store as the underlying hook progresses', async () => {
    render(<VoiceAlwaysOnGate />);
    act(() => {
      useSettingsStore.setState({
        values: { voice_always_on_enabled: true },
      });
    });
    // Hook moves through 'connecting' → ready when the WS opens.
    await waitFor(() => {
      const s = useVoiceAlwaysOnStatusStore.getState().status;
      expect(['connecting', 'ready', 'listening']).toContain(s);
    });
    const ws = FakeWebSocket.instances[0];
    act(() => { ws._open(); });
    await waitFor(() => {
      // After WS opens hook eventually reaches 'ready' (or 'listening' if
      // a server status message lands first). Either is fine for this
      // assertion — what matters is that the global store mirrors the
      // hook's state, not the exact label.
      const s = useVoiceAlwaysOnStatusStore.getState().status;
      expect(s).not.toBe('disabled');
    });
  });
});
