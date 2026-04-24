/**
 * useMicStream — Phase 11b.1 shared microphone stream.
 *
 * Both `useVoiceRecorder` (MediaRecorder-backed tap-to-talk) and
 * `useVoiceAlwaysOn` (AudioWorklet-backed always-on) need the mic.
 * Before this hook each of them called `getUserMedia` independently,
 * which race-conditions on browsers that hand the mic to one consumer
 * at a time.
 *
 * This module owns a single `MediaStream` for the app lifetime.
 * Consumers call `acquire(consumerId)` and `release(consumerId)`.
 * While the refcount is > 0 the stream stays live; when it drops to
 * zero all tracks are stopped and a fresh `getUserMedia` is issued on
 * the next acquire.
 *
 * Not a store — we keep the shared state in a module-scoped closure
 * so the contract is "call the hook, get the functions" and the
 * internals aren't an API surface for the rest of the app.
 */
import { useCallback, useEffect, useState } from 'react';

export type MicStreamStatus = 'idle' | 'acquiring' | 'active' | 'error';

interface State {
  status: MicStreamStatus;
  stream: MediaStream | null;
  error: string | null;
  /** Pending getUserMedia promise so parallel acquire calls share it. */
  pending: Promise<MediaStream> | null;
  /** Set of consumers that currently hold the stream. */
  consumers: Set<string>;
}

const state: State = {
  status: 'idle',
  stream: null,
  error: null,
  pending: null,
  consumers: new Set(),
};

type Listener = (s: State) => void;
const listeners = new Set<Listener>();

function notify(): void {
  for (const cb of listeners) cb(state);
}

async function doAcquire(consumerId: string): Promise<MediaStream> {
  const wasPresent = state.consumers.has(consumerId);
  state.consumers.add(consumerId);
  if (state.stream && state.status === 'active') {
    if (!wasPresent) notify();
    return state.stream;
  }
  if (state.pending) {
    if (!wasPresent) notify();
    return state.pending;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    const msg = 'getUserMedia unavailable';
    state.status = 'error';
    state.error = msg;
    state.consumers.delete(consumerId);
    notify();
    throw new Error(msg);
  }
  state.status = 'acquiring';
  state.error = null;
  notify();
  state.pending = navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
  });
  try {
    const stream = await state.pending;
    state.stream = stream;
    state.status = 'active';
    state.pending = null;
    notify();
    return stream;
  } catch (err) {
    state.pending = null;
    state.status = 'error';
    state.error = err instanceof Error ? err.message : String(err);
    state.consumers.delete(consumerId);
    notify();
    throw err;
  }
}

function doRelease(consumerId: string): void {
  if (!state.consumers.has(consumerId)) return;
  state.consumers.delete(consumerId);
  if (state.consumers.size > 0) {
    // Other consumers still hold the stream — just publish the updated count.
    notify();
    return;
  }
  // Last consumer left — tear the stream down.
  if (state.stream) {
    for (const track of state.stream.getTracks()) {
      try {
        track.stop();
      } catch {
        /* ignore */
      }
    }
  }
  state.stream = null;
  state.status = 'idle';
  state.error = null;
  notify();
}

/** Test-only escape hatch — forces a full reset. */
export function __resetMicStream(): void {
  if (state.stream) {
    for (const track of state.stream.getTracks()) {
      try {
        track.stop();
      } catch {
        /* ignore */
      }
    }
  }
  state.stream = null;
  state.status = 'idle';
  state.error = null;
  state.pending = null;
  state.consumers.clear();
  notify();
}

export interface MicStreamHandle {
  status: MicStreamStatus;
  error: string | null;
  stream: MediaStream | null;
  acquire: (consumerId: string) => Promise<MediaStream>;
  release: (consumerId: string) => void;
  consumersCount: number;
}

export function useMicStream(): MicStreamHandle {
  const [snapshot, setSnapshot] = useState({
    status: state.status,
    error: state.error,
    stream: state.stream,
    consumersCount: state.consumers.size,
  });

  useEffect(() => {
    const cb: Listener = (s) => {
      setSnapshot({
        status: s.status,
        error: s.error,
        stream: s.stream,
        consumersCount: s.consumers.size,
      });
    };
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  }, []);

  const acquire = useCallback(
    (consumerId: string): Promise<MediaStream> => doAcquire(consumerId),
    []
  );
  const release = useCallback((consumerId: string): void => {
    doRelease(consumerId);
  }, []);

  return {
    status: snapshot.status,
    error: snapshot.error,
    stream: snapshot.stream,
    acquire,
    release,
    consumersCount: snapshot.consumersCount,
  };
}
