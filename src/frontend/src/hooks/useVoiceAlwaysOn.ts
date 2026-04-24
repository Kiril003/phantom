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

export type AlwaysOnStatus =
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

interface ServerEvent {
  type: string;
  // Flexible payload — we type-narrow per known type
  // below; anything unknown is logged and ignored.
  [k: string]: unknown;
}

const BACKEND_FRAME_BYTES = 960;  // 30 ms @ 16 kHz s16le — advisory


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
  const { wsUrl, token, onFinalTranscript, onWake, debug } = config;

  const [status, setStatus] = useState<AlwaysOnStatus>('disconnected');
  const [partialTranscript, setPartialTranscript] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [confidenceMin, setConfidenceMin] = useState<number | null>(null);
  const [continuationWindowS, setContinuationWindowS] = useState<number | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
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
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop();
      streamRef.current = null;
    }
  }, []);

  const _teardown = useCallback(() => {
    _teardownAudio();
    if (wsRef.current) {
      try {
        if (wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.close();
        }
      } catch { /* ignore */ }
      wsRef.current = null;
    }
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
          setStatus('armed');
          if (onWake) {
            onWake(
              typeof ev.transcript === 'string' ? ev.transcript : '',
              typeof ev.confidence === 'number' ? ev.confidence : 0,
            );
          }
          break;
        case 'final': {
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
          break;
        case 'error':
          setErrorMessage(typeof ev.message === 'string' ? ev.message : 'unknown');
          break;
        default:
          // reset_ack, mic_duck_ack, config, stopped etc. — silent.
          break;
      }
    },
    [status, onWake, onFinalTranscript, log],
  );

  const start = useCallback(async (): Promise<void> => {
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
    const url = `${_resolveWsUrl(wsUrl)}?token=${encodeURIComponent(resolvedToken)}`;
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return;
      try {
        const msg: ServerEvent = JSON.parse(ev.data);
        _handleServerEvent(msg);
      } catch (err) {
        log('bad json', err, ev.data);
      }
    };
    ws.onerror = () => {
      setErrorMessage('websocket error');
      setStatus('error');
    };
    ws.onclose = () => {
      if (!manualStopRef.current && status !== 'error') {
        setStatus('disconnected');
      }
      _teardownAudio();
    };

    try {
      await new Promise<void>((resolve, reject) => {
        ws.addEventListener('open', () => resolve(), { once: true });
        ws.addEventListener(
          'close',
          (e) => reject(new Error(`ws closed: ${e.code} ${e.reason || ''}`)),
          { once: true },
        );
      });
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'ws open failed');
      setStatus('error');
      return;
    }

    // WS is open. Spin up mic + worklet.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,    // hint; Chrome often ignores this
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      streamRef.current = stream;

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
  }, [status, wsUrl, token, _handleServerEvent, _teardown, _teardownAudio, log]);

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
