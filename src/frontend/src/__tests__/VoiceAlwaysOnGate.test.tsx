/**
 * Phase 12.0 — VoiceAlwaysOnGate reactivity test.
 *
 * The gate reads ``values.voice_mode`` from settingsStore (replacing the
 * legacy voice_always_on_enabled boolean). Mode "off" keeps the hook
 * inert; "continuous" or "wake_word" flips ``enabled`` to true so the
 * underlying useVoiceAlwaysOn opens its WS without a refresh.
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import { VoiceAlwaysOnGate } from '../components/chat/VoiceAlwaysOnGate';
import { useSettingsStore } from '../stores/settingsStore';
import { useVoiceAlwaysOnStatusStore } from '../stores/voiceAlwaysOnStatusStore';
import { __resetMicStream } from '../hooks/useMicStream';
import { __resetVoiceAlwaysOnWS } from '../hooks/useVoiceAlwaysOn';
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
  __resetVoiceAlwaysOnWS();
  useInputMode.setState({ mode: 'idle' });
  FakeWebSocket.instances = [];
   
  (globalThis as any).WebSocket = FakeWebSocket;
   
  (window as any).AudioContext = class {
    audioWorklet = { addModule: () => Promise.resolve() };
    createMediaStreamSource() { return { connect() { /* noop */ }, disconnect() {} }; }
    createGain() { return { gain: { value: 0 }, connect: (t: unknown) => t }; }
    get destination() { return {}; }
    close() { return Promise.resolve(); }
  };
   
  (globalThis as any).AudioWorkletNode = class {
    port = { postMessage: () => {}, close: () => {}, onmessage: null };
    connect(t: unknown) { return t; }
    disconnect() {}
  };
  window.sessionStorage.setItem('phantom_token', 'test-token');
   
  (navigator as any).mediaDevices = {
    getUserMedia: () =>
      Promise.resolve({ getTracks: () => [{ stop: vi.fn() }] }),
  };
  useSettingsStore.setState({ values: {}, loaded: true });
});

describe('VoiceAlwaysOnGate — Phase 12.0 voice_mode reactivity', () => {
  it('does NOT open a WS when voice_mode is undefined (default off)', async () => {
    render(<VoiceAlwaysOnGate />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(FakeWebSocket.instances.length).toBe(0);
  });

  it('does NOT open a WS when voice_mode === "off"', async () => {
    render(<VoiceAlwaysOnGate />);
    act(() => {
      useSettingsStore.setState({
        values: { voice_mode: 'off' },
      });
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(FakeWebSocket.instances.length).toBe(0);
  });

  it('opens a WS when voice_mode flips to "continuous"', async () => {
    render(<VoiceAlwaysOnGate />);
    act(() => {
      useSettingsStore.setState({
        values: { voice_mode: 'continuous' },
      });
    });
    await waitFor(() => {
      expect(FakeWebSocket.instances.length).toBe(1);
    });
  });

  it('opens a WS when voice_mode flips to "wake_word"', async () => {
    render(<VoiceAlwaysOnGate />);
    act(() => {
      useSettingsStore.setState({
        values: { voice_mode: 'wake_word', voice_wake_phrase: 'фантом' },
      });
    });
    await waitFor(() => {
      expect(FakeWebSocket.instances.length).toBe(1);
    });
  });

  it('closes the WS when voice_mode flips back to "off"', async () => {
    render(<VoiceAlwaysOnGate />);
    act(() => {
      useSettingsStore.setState({
        values: { voice_mode: 'continuous' },
      });
    });
    await waitFor(() => {
      expect(FakeWebSocket.instances.length).toBe(1);
    });
    const ws = FakeWebSocket.instances[0];
    act(() => {
      useSettingsStore.setState({
        values: { voice_mode: 'off' },
      });
    });
    await waitFor(() => {
      expect(ws.readyState).toBe(FakeWebSocket.CLOSED);
    });
  });
});

describe('VoiceAlwaysOnGate — global status store reflects voice_mode', () => {
  beforeEach(() => {
    useVoiceAlwaysOnStatusStore.setState({ status: 'disabled' });
  });

  it('writes initial "disabled" to the global status store on mount when off', async () => {
    render(<VoiceAlwaysOnGate />);
    await waitFor(() => {
      expect(useVoiceAlwaysOnStatusStore.getState().status).toBe('disabled');
    });
  });

  it('moves out of "disabled" when voice_mode becomes "continuous"', async () => {
    render(<VoiceAlwaysOnGate />);
    act(() => {
      useSettingsStore.setState({
        values: { voice_mode: 'continuous' },
      });
    });
    await waitFor(() => {
      expect(useVoiceAlwaysOnStatusStore.getState().status).not.toBe('disabled');
    });
  });
});
