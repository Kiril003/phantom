/**
 * useVoiceAlwaysOn — Phase 11b always-on voice client hook.
 *
 * Opens a dedicated WebSocket to the backend's /ws/voice endpoint,
 * streams 30 ms PCM frames from a Web Audio AudioWorklet, and
 * surfaces the orchestrator state (idle → listening → armed →
 * transcribing → cooldown) so the UI can render an appropriate
 * indicator.
 *
 * Parallel to `useVoiceRecorder` (tap-to-talk). Always-on is an
 * opt-in alternative, not a replacement — users should be able to
 * toggle between modes via Settings.
 *
 * The hook is transport-only: when a `final` event arrives it fires
 * the `onFinalTranscript` callback so the parent component can POST
 * to /api/v1/chat/message with `input_method=voice`. Mic-ducking
 * during TTS playback is driven by the parent too — it calls
 * `micDuck()` / `micUnduck()` around the <audio> element playback.
 *
 * Browser API fallbacks:
 *   * `AudioContext` / `getUserMedia` are modern. If unavailable the
 *     hook sets status='error' with a user-readable message.
 *   * `AudioWorklet.addModule` path: uses
 *     `new URL('../workers/voice-capture.worklet.js', import.meta.url)`
 *     so Vite emits the worklet as a static asset with a stable URL.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import workletUrl from '../workers/voice-capture.worklet.js?url';
import { useMicStream } from './useMicStream';
import { useInputMode } from '../stores/inputModeStore';

export type AlwaysOnStatus =
  | 'disabled'          // settings toggle is off; hook inert
  | 'disconnected'
  | 'connecting'
  | 'ready'
  | 'listening'         // VAD detected speech
  | 'armed'             // wake matched, transcribing
  | 'cooldown'          // continuation window open
  | 'error';

export interface FinalTranscript {
  transcript: string;
  source: 'wake' | 'continuation';
  confidence: number;
}

export interface AlwaysOnConfig {
  /** Gate — when false the hook stays in 'disabled' and never opens
   *  the mic or WS. Toggle via Settings ``voice_always_on_enabled``. */
  enabled?: boolean;
  /** Override the default ws URL. Used by tests. */
  wsUrl?: string;
  /** Bearer token. Falls back to `localStorage.phantom_token`. */
  token?: string;
  /** Fired when the orchestrator emits a `final` event. */
  onFinalTranscript?: (t: FinalTranscript) => void;
  /** Fired when a wake is detected. Useful for haptic / visual beep. */
  onWake?: (transcript: string, confidence: number) => void;
  /** Opt-in verbose logging. */
  debug?: boolean;
}

const CONSUMER_ID = 'always-on';

interface ServerEvent {
  type: string;
  // Flexible payload — we type-narrow per known type
  // below; anything unknown is logged and ignored.
  [k: string]: unknown;
}

const BACKEND_FRAME_BYTES = 960;  // 30 ms @ 16 kHz s16le — advisory

// ─── Phase 12.0 — Module-level WS singleton (Bug 1 fix) ─────────────────────
// React StrictMode (and rapid toolbar clicks) used to spawn a fresh WebSocket
// per mount, leaking sockets and triggering a fresh model load on the
// backend each time. The singleton + refcount pattern dedups across all
// hook instances: the first acquire creates the WS, subsequent acquires
// share it, and only the last release closes it.
let _wsInstance: WebSocket | null = null;
let _wsState: 'idle' | 'connecting' | 'connected' = 'idle';
let _wsRefCount = 0;

interface AcquiredWS {
  ws: WebSocket;
  ready: Promise<void>;
  /** Whether THIS acquire created the underlying WS (vs reusing an
   *  existing one). Tests assert the WebSocket constructor was called
   *  exactly once for two concurrent acquires. */
  fresh: boolean;
}

function _acquireWS(url: string): AcquiredWS {
  if (_wsInstance && (_wsState === 'connecting' || _wsState === 'connected')) {
    _wsRefCount += 1;
    const ws = _wsInstance;
    const ready = new Promise<void>((resolve, reject) => {
      if (_wsState === 'connected') {
        // Already open — schedule resolve so callers always observe an
        // async settlement (matches the fresh-WS code path).
        queueMicrotask(() => resolve());
        return;
      }
      const onOpen = () => resolve();
      const onClose = (ev: CloseEvent) =>
        reject(new Error(`ws closed: ${ev.code} ${ev.reason || ''}`));
      ws.addEventListener('open', onOpen, { once: true });
      ws.addEventListener('close', onClose, { once: true });
    });
    return { ws, ready, fresh: false };
  }

  _wsState = 'connecting';
  const ws = new WebSocket(url);
  _wsInstance = ws;
  _wsRefCount = 1;

  const ready = new Promise<void>((resolve, reject) => {
    ws.addEventListener(
      'open',
      () => {
        // Guard: if a later acquire already replaced us, don't clobber.
        if (_wsInstance === ws) {
          _wsState = 'connected';
        }
        resolve();
      },
      { once: true },
    );
    ws.addEventListener(
      'close',
      (ev) => {
        // Only reset module state when THIS ws is still the singleton.
        // A late close event from a previously-released ws must not wipe
        // the new one's refcount.
        if (_wsInstance === ws) {
          _wsState = 'idle';
          _wsInstance = null;
          _wsRefCount = 0;
        }
        reject(new Error(`ws closed: ${ev.code} ${ev.reason || ''}`));
      },
      { once: true },
    );
  });
  return { ws, ready, fresh: true };
}

function _releaseWS(): void {
  _wsRefCount = Math.max(0, _wsRefCount - 1);
  if (_wsRefCount === 0 && _wsInstance) {
    try {
      // Close regardless of readyState — the 11c.5 bug was that a
      // CONNECTING socket leaked on teardown because the close branch
      // gated on readyState === OPEN. Closing a CONNECTING socket is
      // a noop on already-closed and a clean abort otherwise.
      _wsInstance.close();
    } catch {
      /* ignore */
    }
    _wsInstance = null;
    _wsState = 'idle';
  }
}

/** Test-only: forcibly drop the singleton between tests so each test
 *  starts from a clean state. */
export function __resetVoiceAlwaysOnWS(): void {
  if (_wsInstance) {
    try {
      _wsInstance.close();
    } catch {
      /* ignore */
    }
  }
  _wsInstance = null;
  _wsState = 'idle';
  _wsRefCount = 0;
}

/** Test-only: snapshot the singleton refcount. */
export function __getVoiceAlwaysOnWSRefCount(): number {
  return _wsRefCount;
}


function _resolveWsUrl(explicit?: string): string {
  if (explicit) return explicit;
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  return `${proto}//${host}/ws/voice`;
}


function _resolveToken(explicit?: string): string | null {
  if (explicit) return explicit;
  try {
    return localStorage.getItem('phantom_token');
  } catch {
    return null;
  }
}


export function useVoiceAlwaysOn(config: AlwaysOnConfig = {}) {
  const { enabled = false, wsUrl, token, onFinalTranscript, onWake, debug } = config;

  const [status, setStatus] = useState<AlwaysOnStatus>(
    enabled ? 'disconnected' : 'disabled',
  );
  const [partialTranscript, setPartialTranscript] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [confidenceMin, setConfidenceMin] = useState<number | null>(null);
  const [continuationWindowS, setContinuationWindowS] = useState<number | null>(null);

  const { acquire: micAcquire, release: micRelease } = useMicStream();
  const inputMode = useInputMode((s) => s.mode);
  const setInputMode = useInputMode((s) => s.setMode);
  const inputModeRef = useRef(inputMode);
  useEffect(() => { inputModeRef.current = inputMode; }, [inputMode]);

  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const hasStreamRef = useRef(false);
  const manualStopRef = useRef(false);

  const log = useCallback(
    (...args: unknown[]) => {
      if (debug) console.debug('[always-on]', ...args);
    },
    [debug],
  );

  const _teardownAudio = useCallback(() => {
    if (workletRef.current) {
      try {
        workletRef.current.port.close();
        workletRef.current.disconnect();
      } catch { /* ignore */ }
      workletRef.current = null;
    }
    if (sourceRef.current) {
      try { sourceRef.current.disconnect(); } catch { /* ignore */ }
      sourceRef.current = null;
    }
    if (audioCtxRef.current) {
      try { void audioCtxRef.current.close(); } catch { /* ignore */ }
      audioCtxRef.current = null;
    }
    if (hasStreamRef.current) {
      micRelease(CONSUMER_ID);
      hasStreamRef.current = false;
    }
  }, [micRelease]);

  // Tracks whether THIS hook instance currently holds a refcount on the
  // singleton WS. Without this guard, a teardown after a failed acquire
  // (e.g. token missing) would still decrement the refcount and prematurely
  // close a WS that another consumer relies on.
  const wsHeldRef = useRef(false);

  const _teardown = useCallback(() => {
    _teardownAudio();
    if (wsHeldRef.current) {
      _releaseWS();
      wsHeldRef.current = false;
    }
    wsRef.current = null;
    setPartialTranscript('');
  }, [_teardownAudio]);

  const _handleServerEvent = useCallback(
    (ev: ServerEvent) => {
      log('<-', ev.type, ev);
      switch (ev.type) {
        case 'ready': {
          setStatus('ready');
          if (typeof ev.confidence_min === 'number') {
            setConfidenceMin(ev.confidence_min);
          }
          if (typeof ev.continuation_window_s === 'number') {
            setContinuationWindowS(ev.continuation_window_s);
          }
          break;
        }
        case 'speech_start':
          if (status !== 'armed') setStatus('listening');
          break;
        case 'speech_end':
          // stays in listening until wake/final event flips us
          break;
        case 'wake':
          // Input mode arbitration — if tap-to-talk is currently owning
          // the turn, the user is holding the mic themselves; the wake
          // event MUST NOT flip the UI into armed state or fire the
          // callback, or we'd race-send two messages for one utterance.
          if (inputModeRef.current === 'tap') {
            log('wake suppressed — tap-to-talk active');
            // Server-side reset so the wake spotter doesn't keep
            // capturing while tap-to-talk records in parallel.
            try {
              wsRef.current?.send(JSON.stringify({ cmd: 'reset' }));
            } catch { /* ignore */ }
            break;
          }
          setStatus('armed');
          setInputMode('always_on');
          if (onWake) {
            onWake(
              typeof ev.transcript === 'string' ? ev.transcript : '',
              typeof ev.confidence === 'number' ? ev.confidence : 0,
            );
          }
          break;
        case 'final': {
          // Same arbitration — discard final events that were in-flight
          // when the user grabbed tap-to-talk.
          if (inputModeRef.current === 'tap') {
            log('final suppressed — tap-to-talk active');
            break;
          }
          const transcript = typeof ev.transcript === 'string' ? ev.transcript : '';
          const source = (ev.source === 'continuation' ? 'continuation' : 'wake') as
            | 'wake'
            | 'continuation';
          const confidence = typeof ev.confidence === 'number' ? ev.confidence : 0;
          setPartialTranscript(transcript);
          if (onFinalTranscript) {
            onFinalTranscript({ transcript, source, confidence });
          }
          break;
        }
        case 'cooldown_start':
          setStatus('cooldown');
          break;
        case 'cooldown_end':
          setStatus('ready');
          // Hand input mode back to idle so tap-to-talk is free to claim.
          if (inputModeRef.current === 'always_on') setInputMode('idle');
          break;
        case 'error':
          setErrorMessage(typeof ev.message === 'string' ? ev.message : 'unknown');
          break;
        default:
          // reset_ack, mic_duck_ack, config, stopped etc. — silent.
          break;
      }
    },
    [status, onWake, onFinalTranscript, log, setInputMode],
  );

  const start = useCallback(async (): Promise<void> => {
    // Settings gate — when the user has disabled always-on we MUST NOT
    // open the mic or WS. This is the primary fix for Phase 11b's bug
    // where the hook could run even with voice_always_on_enabled=False.
    if (!enabled) {
      setStatus('disabled');
      return;
    }
    if (status === 'connecting' || status === 'ready' || status === 'listening') {
      return;
    }
    manualStopRef.current = false;
    setErrorMessage(null);
    setStatus('connecting');

    const resolvedToken = _resolveToken(token);
    if (!resolvedToken) {
      setErrorMessage('no auth token');
      setStatus('error');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setErrorMessage('getUserMedia unavailable');
      setStatus('error');
      return;
    }
    if (typeof window.AudioContext === 'undefined') {
      setErrorMessage('AudioContext unavailable');
      setStatus('error');
      return;
    }

    // Open WS first so a token rejection fails fast without the mic prompt.
    // Acquire via singleton so React StrictMode double-mounts and rapid
    // toolbar clicks don't spawn duplicate sockets (Phase 11c.5 Bug 1).
    const url = `${_resolveWsUrl(wsUrl)}?token=${encodeURIComponent(resolvedToken)}`;
    const { ws, ready } = _acquireWS(url);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;
    wsHeldRef.current = true;

    // Use addEventListener so multiple hook instances sharing the singleton
    // WS each get their own message/error/close listener, instead of the
    // last consumer's onmessage assignment clobbering earlier ones.
    const messageListener = (ev: MessageEvent) => {
      if (typeof ev.data !== 'string') return;
      try {
        const msg: ServerEvent = JSON.parse(ev.data);
        _handleServerEvent(msg);
      } catch (err) {
        log('bad json', err, ev.data);
      }
    };
    const errorListener = () => {
      setErrorMessage('websocket error');
      setStatus('error');
    };
    const closeListener = () => {
      if (!manualStopRef.current && status !== 'error') {
        setStatus('disconnected');
      }
      _teardownAudio();
    };
    ws.addEventListener('message', messageListener);
    ws.addEventListener('error', errorListener);
    ws.addEventListener('close', closeListener);

    try {
      await ready;
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'ws open failed');
      setStatus('error');
      return;
    }

    // WS is open. Spin up mic (via shared stream) + worklet.
    try {
      const stream = await micAcquire(CONSUMER_ID);
      hasStreamRef.current = true;

      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;
      await audioCtx.audioWorklet.addModule(workletUrl);

      const source = audioCtx.createMediaStreamSource(stream);
      sourceRef.current = source;
      const worklet = new AudioWorkletNode(audioCtx, 'voice-capture-processor');
      workletRef.current = worklet;

      worklet.port.onmessage = (ev: MessageEvent<ArrayBuffer>) => {
        if (!(ev.data instanceof ArrayBuffer)) return;
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          // Defensive: only send the expected length to catch worklet
          // bugs early. Silently skip short frames.
          if (ev.data.byteLength === BACKEND_FRAME_BYTES) {
            wsRef.current.send(ev.data);
          }
        }
      };

      source.connect(worklet);
      // Worklet must be connected to the destination (or a muted
      // GainNode) to keep processing. Using a zero-gain path so no
      // mic loopback reaches the speakers.
      const silent = audioCtx.createGain();
      silent.gain.value = 0;
      worklet.connect(silent).connect(audioCtx.destination);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'mic init failed');
      setStatus('error');
      _teardown();
    }
  }, [enabled, status, wsUrl, token, _handleServerEvent, _teardown, _teardownAudio, log, micAcquire]);

  const stop = useCallback((): void => {
    manualStopRef.current = true;
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      try { wsRef.current.send(JSON.stringify({ cmd: 'stop' })); } catch { /* ignore */ }
    }
    _teardown();
    setStatus('disconnected');
  }, [_teardown]);

  const micDuck = useCallback((): void => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      try { wsRef.current.send(JSON.stringify({ cmd: 'mic_duck' })); } catch { /* ignore */ }
    }
    workletRef.current?.port.postMessage({ type: 'mute' });
  }, []);

  const micUnduck = useCallback((): void => {
    workletRef.current?.port.postMessage({ type: 'unmute' });
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      try { wsRef.current.send(JSON.stringify({ cmd: 'mic_unduck' })); } catch { /* ignore */ }
    }
  }, []);

  const setConfidence = useCallback((value: number): void => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(JSON.stringify({ cmd: 'set_confidence', value }));
      } catch { /* ignore */ }
    }
  }, []);

  // Auto-start / auto-stop tied to the `enabled` prop. When settings
  // flips `voice_always_on_enabled` the hook reacts without requiring
  // the consumer to call start/stop manually. When `enabled` is false
  // the hook sits in 'disabled' state and releases any mic/WS it held.
  useEffect(() => {
    if (!enabled) {
      manualStopRef.current = true;
      _teardown();
      setStatus('disabled');
      setErrorMessage(null);
      return;
    }
    setStatus((prev) => (prev === 'disabled' ? 'disconnected' : prev));
    // Kick off start once when toggle flips on. start() itself is idempotent.
    void start();
    // We intentionally only depend on `enabled` and the stable start
    // reference — a `status` change shouldn't re-run this (would loop).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  useEffect(() => () => {
    manualStopRef.current = true;
    _teardown();
  }, [_teardown]);

  return {
    status,
    errorMessage,
    partialTranscript,
    confidenceMin,
    continuationWindowS,
    start,
    stop,
    micDuck,
    micUnduck,
    setConfidence,
  };
}
