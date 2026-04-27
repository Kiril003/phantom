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
import { MicVAD } from '@ricky0123/vad-web';

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
  source:
    | 'wake'
    | 'continuation'
    | 'continuous'
    | 'wake_word'
    // Phase 13b — Vosk fast-path final emitted directly from streaming
    // KaldiRecognizer.FinalResult (no Whisper hop on the realtime path).
    | 'vosk_fast'
    // Phase 13b — Whisper background-refine result that differs from the
    // Vosk fast final. Delivered via ``final_revised`` event.
    | 'whisper_quality';
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
  /** Phase 13b — fired when the optional Whisper-refine pass produces a
   *  meaningfully different transcript from Vosk's fast final. The
   *  consumer typically calls chatStore.replaceLastUserMessage. */
  onRevisedTranscript?: (t: FinalTranscript) => void;
  /** Fired when a wake is detected. Useful for haptic / visual beep. */
  onWake?: (transcript: string, confidence: number) => void;
  /** Opt-in verbose logging. */
  debug?: boolean;
  /** Phase 13a.2 — disable client-side VAD gate (sends every frame to backend).
   *  Default true. Set false for tests / browsers where MicVAD load fails. */
  clientVadEnabled?: boolean;
}

const CONSUMER_ID = 'always-on';

// Phase 13a.2 — public/vad/ holds the Silero VAD ONNX models, the worklet
// bundle, and the onnxruntime-web WASM artifacts so MicVAD initialises
// without an external CDN call (Radxa boots offline).
const VAD_ASSET_BASE = '/vad/';

// Number of 30 ms (960-byte) frames to keep around so the leading audio
// just before VAD triggers is sent to the backend on speech_start. Without
// this preroll, Vosk/Whisper miss the first 100-300 ms of the utterance.
const VAD_PREROLL_FRAMES = 12;  // ≈ 360 ms

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
// Phase 12.4 — deferred close timer. React StrictMode (and HMR) unmount→
// remount the auto-start useEffect within ~10ms, so an immediate close on
// refcount=0 produces the 6ms-life pattern observed in production logs:
//   t=0   first acquire creates WS, refcount=1
//   t=4   StrictMode unmount → release → close()  ← the 6ms close
//   t=18  remount → acquire creates a *second* WS
// Holding the close for ~50ms lets a remount within that window cancel the
// pending close and reuse the still-open singleton, so the backend sees one
// stable connection across the StrictMode cycle.
let _wsCloseTimer: ReturnType<typeof setTimeout> | null = null;
const _WS_CLOSE_GRACE_MS = 50;

interface AcquiredWS {
  ws: WebSocket;
  ready: Promise<void>;
  /** Whether THIS acquire created the underlying WS (vs reusing an
   *  existing one). Tests assert the WebSocket constructor was called
   *  exactly once for two concurrent acquires. */
  fresh: boolean;
}

function _acquireWS(url: string): AcquiredWS {
  // Phase 12.4 — cancel any pending deferred close. A remount inside the
  // 50ms grace window means we're picking the singleton back up, not
  // tearing it down.
  if (_wsCloseTimer !== null) {
    clearTimeout(_wsCloseTimer);
    _wsCloseTimer = null;
  }
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
    // Phase 12.4 — defer close by 50ms instead of closing immediately. A
    // synchronous close fires the close event before a StrictMode/HMR
    // remount has a chance to call _acquireWS, so the next mount has to
    // build a fresh WS (the 6ms-close + new client_id pattern). A
    // pending timer is replaced — only the latest release wins.
    if (_wsCloseTimer !== null) {
      clearTimeout(_wsCloseTimer);
    }
    const ws = _wsInstance;
    _wsCloseTimer = setTimeout(() => {
      _wsCloseTimer = null;
      // Re-check both: another acquire may have raced in, or _wsInstance
      // may already be a different socket scheduled by a later release.
      if (_wsRefCount === 0 && _wsInstance === ws) {
        try {
          // Close regardless of readyState — the 11c.5 bug was that a
          // CONNECTING socket leaked on teardown because the close
          // branch gated on readyState === OPEN. Closing a CONNECTING
          // socket is a noop on already-closed and a clean abort
          // otherwise.
          ws.close();
        } catch {
          /* ignore */
        }
        _wsInstance = null;
        _wsState = 'idle';
      }
    }, _WS_CLOSE_GRACE_MS);
  }
}

/**
 * Send a ``mic_duck`` command on the singleton WS so the backend
 * orchestrator drops further frames until ``mic_unduck``. Safe to call
 * even when no WS is open (no-ops). Used by the chat TTS playback to
 * stop the assistant's own voice feeding back into the always-on
 * pipeline (Phase 12.2 self-feedback fix).
 */
export function voiceAlwaysOnDuck(): void {
  const ws = _wsInstance;
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify({ cmd: 'mic_duck' }));
    } catch {
      /* ignore */
    }
  }
}

/** Counterpart of ``voiceAlwaysOnDuck``. Releases the backend mic. */
export function voiceAlwaysOnUnduck(): void {
  const ws = _wsInstance;
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify({ cmd: 'mic_unduck' }));
    } catch {
      /* ignore */
    }
  }
}

/** Test-only: forcibly drop the singleton between tests so each test
 *  starts from a clean state. */
export function __resetVoiceAlwaysOnWS(): void {
  if (_wsCloseTimer !== null) {
    clearTimeout(_wsCloseTimer);
    _wsCloseTimer = null;
  }
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
  // Phase 12.1 — bypass the Vite WebSocket proxy for `/ws/voice`. Vite's
  // ws-proxy crashes (EPIPE / 1006) under the combined load of:
  //   * 30 ms-cadence binary PCM frames flowing client → backend, and
  //   * concurrent OLED / sensor / chat traffic on the central /ws hub.
  // The chat hub stays on Vite (text-only, low rate). For voice we go
  // direct to the backend port. Backend `cors_origins` lists the dev
  // host; FastAPI doesn't gate WebSocket upgrades on Origin by default,
  // so this works without extra middleware. Production builds (where
  // import.meta.env.DEV is false) keep using the same-origin URL.
  if (import.meta.env.DEV) {
    const host = `${window.location.hostname}:8000`;
    return `${proto}//${host}/ws/voice`;
  }
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
  const {
    enabled = false,
    wsUrl,
    token,
    onFinalTranscript,
    onRevisedTranscript,
    onWake,
    debug,
    clientVadEnabled = true,
  } = config;

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
  // Phase 13a.2 — client-side VAD instance, speaking flag, and a tiny
  // preroll ring buffer so the leading audio before MicVAD triggers makes
  // it onto the wire. ``clientSpeakingRef.current === true`` is the gate
  // that decides whether worklet-emitted PCM frames are forwarded to the
  // backend or accumulated as preroll for the next speech_start.
  const micVadRef = useRef<MicVAD | null>(null);
  const clientSpeakingRef = useRef<boolean>(false);
  const prerollRef = useRef<ArrayBuffer[]>([]);

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
    // Phase 13a.2 — destroy MicVAD before releasing the shared mic so
    // its internal AudioContext closes cleanly and ORT releases tensors.
    if (micVadRef.current) {
      try { void micVadRef.current.destroy(); } catch { /* ignore */ }
      micVadRef.current = null;
    }
    clientSpeakingRef.current = false;
    prerollRef.current = [];
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
        case 'partial': {
          // Phase 13b — Vosk streaming partial transcript. Updates the
          // ghost-bubble preview as the user speaks. Suppressed when
          // tap-to-talk owns the turn so the partials don't bleed into a
          // parallel push-to-talk capture.
          if (inputModeRef.current === 'tap') break;
          if (typeof ev.transcript !== 'string') break;
          setPartialTranscript(ev.transcript);
          break;
        }
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
          const rawSource = ev.source as string;
          const knownSources = [
            'continuation', 'wake', 'continuous', 'wake_word',
            // Phase 13b — Vosk fast-path final event.
            'vosk_fast',
          ];
          const source = (
            knownSources.includes(rawSource) ? rawSource : 'wake'
          ) as FinalTranscript['source'];
          const confidence = typeof ev.confidence === 'number' ? ev.confidence : 0;
          // Keep the final transcript visible until the next utterance
          // starts — tests assert this and it gives the user a brief
          // "your words got captured as X" before the chat round-trip.
          setPartialTranscript(transcript);
          if (onFinalTranscript) {
            onFinalTranscript({ transcript, source, confidence });
          }
          // Phase 12/13b modes do not trigger cooldown, return to ready directly.
          if (
            source === 'continuous'
            || source === 'wake_word'
            || source === 'vosk_fast'
          ) {
            setStatus('ready');
            if (inputModeRef.current === 'always_on') setInputMode('idle');
          }
          break;
        }
        case 'final_revised': {
          // Phase 13b — Whisper-refine background result. Only fires when
          // Whisper differed from Vosk by more than the configured ratio.
          // We do NOT change the input mode or status — by the time a
          // refine arrives the user has already moved on.
          if (inputModeRef.current === 'tap') break;
          if (typeof ev.transcript !== 'string') break;
          const transcript = ev.transcript;
          const confidence = typeof ev.confidence === 'number' ? ev.confidence : 0;
          if (onRevisedTranscript) {
            onRevisedTranscript({
              transcript,
              source: 'whisper_quality',
              confidence,
            });
          }
          break;
        }
        case 'rejected':
          // STT finished but no text or wake word didn't match. Reset to ready.
          setStatus('ready');
          if (inputModeRef.current === 'always_on') setInputMode('idle');
          break;
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
    [status, onWake, onFinalTranscript, onRevisedTranscript, log, setInputMode],
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
        // Defensive: only act on the expected frame length to catch
        // worklet bugs early. Silently skip short frames.
        if (ev.data.byteLength !== BACKEND_FRAME_BYTES) return;

        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;

        // Phase 13a.2 — when client VAD is enabled, gate forwarding on
        // the speaking flag. Frames during silence are accumulated in a
        // small ring buffer and flushed on the next speech_start so the
        // leading audio (~360 ms) makes it to the backend. When client
        // VAD is disabled, forward every frame (legacy behaviour).
        if (!clientVadEnabled) {
          ws.send(ev.data);
          return;
        }
        if (clientSpeakingRef.current) {
          ws.send(ev.data);
        } else {
          prerollRef.current.push(ev.data);
          if (prerollRef.current.length > VAD_PREROLL_FRAMES) {
            prerollRef.current.shift();
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

      // Phase 13a.2 — start MicVAD on the same MediaStream. This decides
      // when speech starts/ends in the browser so the worklet's frames
      // are only forwarded during real speech. Backend Silero VAD remains
      // active as belt-and-braces. We pass stub pause/resume so MicVAD
      // does not disable the shared mic tracks during its own lifecycle.
      if (clientVadEnabled) {
        try {
          const sharedStream = stream;
          const vad = await MicVAD.new({
            model: 'v5',
            // Local Silero ONNX + worklet bundle (in public/vad/). The
            // onnxruntime-web WASM artifacts are NOT colocated locally
            // (~37 MB) — vad-web's default CDN path serves them, which
            // is fine because PHANTOM already needs WiFi for Gemini.
            baseAssetPath: VAD_ASSET_BASE,
            startOnLoad: true,
            getStream: async () => sharedStream,
            // No-op pause/resume — we never want MicVAD to disable
            // the tracks because the worklet is still feeding from them.
            pauseStream: async () => { /* no-op */ },
            resumeStream: async () => sharedStream,
            onSpeechStart: () => {
              clientSpeakingRef.current = true;
              const pending = prerollRef.current;
              prerollRef.current = [];
              const wsNow = wsRef.current;
              if (wsNow && wsNow.readyState === WebSocket.OPEN) {
                for (const buf of pending) {
                  try { wsNow.send(buf); } catch { /* ignore */ }
                }
                try {
                  wsNow.send(JSON.stringify({ cmd: 'client_speech_start' }));
                } catch { /* ignore */ }
              }
              log('client VAD: speech_start (preroll', pending.length, 'frames)');
            },
            onSpeechEnd: () => {
              clientSpeakingRef.current = false;
              const wsNow = wsRef.current;
              if (wsNow && wsNow.readyState === WebSocket.OPEN) {
                try {
                  wsNow.send(JSON.stringify({ cmd: 'client_speech_end' }));
                } catch { /* ignore */ }
              }
              log('client VAD: speech_end');
            },
            onVADMisfire: () => {
              clientSpeakingRef.current = false;
            },
          });
          micVadRef.current = vad;
        } catch (vadErr) {
          // Failure to load MicVAD is non-fatal — we degrade to
          // "send every frame" mode so the user still gets always-on.
          log('client VAD init failed, degrading to passthrough:', vadErr);
          clientSpeakingRef.current = true;  // forward all frames
        }
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'mic init failed');
      setStatus('error');
      _teardown();
    }
  }, [enabled, status, wsUrl, token, _handleServerEvent, _teardown, _teardownAudio, log, micAcquire, clientVadEnabled]);

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
