import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * useVoiceRecorder — MediaRecorder-backed tap-to-talk hook.
 *
 * Lifecycle:
 *   start()  → requests mic, starts recording, spins up an AnalyserNode so
 *              consumers can poll `amplitude` for orb-pulse animation.
 *   stop()   → stops the recorder, resolves the returned promise with the
 *              captured Blob (webm/opus by default on Chromium).
 *   cancel() → aborts without producing a blob.
 *
 * Amplitude is a scalar in [0, 1] updated ~30 Hz while recording. When not
 * recording it is 0 so any consumer animation settles to rest.
 */

export type RecorderState = 'idle' | 'requesting' | 'recording' | 'stopping' | 'error';

interface Options {
  /** Preferred MIME type — falls back to browser default if unsupported. */
  mimeType?: string;
  /** Amplitude polling interval in ms (default 33 → ~30 fps). */
  amplitudeIntervalMs?: number;
}

export function useVoiceRecorder(options: Options = {}) {
  const { mimeType = 'audio/webm;codecs=opus', amplitudeIntervalMs = 33 } = options;

  const [state, setState] = useState<RecorderState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [amplitude, setAmplitude] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const resolveRef = useRef<((blob: Blob | null) => void) | null>(null);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastAmpTickRef = useRef(0);

  const cleanup = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (analyserRef.current) {
      try {
        analyserRef.current.disconnect();
      } catch {
        /* ignore */
      }
      analyserRef.current = null;
    }
    if (audioCtxRef.current) {
      try {
        void audioCtxRef.current.close();
      } catch {
        /* ignore */
      }
      audioCtxRef.current = null;
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop();
      streamRef.current = null;
    }
    recorderRef.current = null;
    chunksRef.current = [];
    setAmplitude(0);
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  const tickAmplitude = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const now = performance.now();
    if (now - lastAmpTickRef.current >= amplitudeIntervalMs) {
      lastAmpTickRef.current = now;
      const buf = new Uint8Array(analyser.fftSize);
      analyser.getByteTimeDomainData(buf);
      // RMS of signal centred on 128 → normalise to [0, 1].
      let sum = 0;
      for (const v of buf) {
        const d = (v - 128) / 128;
        sum += d * d;
      }
      const rms = Math.sqrt(sum / buf.length);
      setAmplitude(Math.min(1, rms * 3)); // amplify a bit for visual snap
    }
    rafRef.current = requestAnimationFrame(tickAmplitude);
  }, [amplitudeIntervalMs]);

  const start = useCallback(async (): Promise<void> => {
    if (state === 'recording' || state === 'requesting') return;
    setError(null);
    setState('requesting');
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Browser has no getUserMedia — voice disabled.');
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      });
      streamRef.current = stream;

      // Feed the mic into an AnalyserNode for amplitude pulse.
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      analyserRef.current = analyser;

      const actualMime = MediaRecorder.isTypeSupported(mimeType) ? mimeType : '';
      const recorder = new MediaRecorder(stream, actualMime ? { mimeType: actualMime } : undefined);
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      recorder.onstop = () => {
        const type = recorder.mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type });
        const resolve = resolveRef.current;
        resolveRef.current = null;
        cleanup();
        setState('idle');
        resolve?.(blob.size > 0 ? blob : null);
      };
      recorder.onerror = (ev) => {
        const msg = (ev as unknown as { error?: Error }).error?.message ?? 'recorder error';
        setError(msg);
        setState('error');
        const resolve = resolveRef.current;
        resolveRef.current = null;
        cleanup();
        resolve?.(null);
      };
      recorder.start(250); // emit a chunk every 250 ms so onstop sees data quickly
      setState('recording');
      lastAmpTickRef.current = 0;
      rafRef.current = requestAnimationFrame(tickAmplitude);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Recorder failed to start';
      setError(msg);
      setState('error');
      cleanup();
      throw err;
    }
  }, [state, mimeType, cleanup, tickAmplitude]);

  /** Stop and resolve with the captured Blob (or null on empty capture). */
  const stop = useCallback((): Promise<Blob | null> => {
    if (state !== 'recording' && state !== 'requesting') {
      return Promise.resolve(null);
    }
    setState('stopping');
    return new Promise<Blob | null>((resolve) => {
      resolveRef.current = resolve;
      const rec = recorderRef.current;
      if (rec && rec.state !== 'inactive') {
        rec.stop();
      } else {
        // Already stopped or never started — resolve immediately.
        resolveRef.current = null;
        cleanup();
        setState('idle');
        resolve(null);
      }
    });
  }, [state, cleanup]);

  /** Abort the current recording without producing a blob. */
  const cancel = useCallback(() => {
    if (state === 'idle') return;
    const rec = recorderRef.current;
    resolveRef.current?.(null);
    resolveRef.current = null;
    if (rec && rec.state !== 'inactive') {
      try {
        rec.stop();
      } catch {
        /* ignore */
      }
    }
    cleanup();
    setState('idle');
  }, [state, cleanup]);

  return { state, error, amplitude, start, stop, cancel };
}
