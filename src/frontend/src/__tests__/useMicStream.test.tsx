/**
 * Phase 11b.1 — useMicStream shared-stream hook tests.
 *
 * Covers the refcount invariant that keeps one MediaStream alive
 * across both useVoiceRecorder (MediaRecorder) and useVoiceAlwaysOn
 * (AudioWorklet) consumers.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useMicStream, __resetMicStream } from '../hooks/useMicStream';

interface FakeTrack {
  stop: () => void;
  stopped: boolean;
}

function makeFakeStream(): { stream: MediaStream; tracks: FakeTrack[] } {
  const tracks: FakeTrack[] = [
    { stopped: false, stop: function () { this.stopped = true; } },
  ];
  const stream = {
    getTracks: () => tracks,
  } as unknown as MediaStream;
  return { stream, tracks };
}

describe('useMicStream — contract', () => {
  beforeEach(() => {
    __resetMicStream();
  });

  it('starts in idle status with no stream', () => {
    const { result } = renderHook(() => useMicStream());
    expect(result.current.status).toBe('idle');
    expect(result.current.stream).toBeNull();
    expect(result.current.consumersCount).toBe(0);
  });

  it('surfaces error when getUserMedia is unavailable', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (navigator as any).mediaDevices = undefined;
    const { result } = renderHook(() => useMicStream());
    await expect(result.current.acquire('c1')).rejects.toThrow(
      /getUserMedia unavailable/
    );
    await waitFor(() => {
      expect(result.current.status).toBe('error');
    });
  });

  it('only calls getUserMedia once for two parallel acquires', async () => {
    const { stream } = makeFakeStream();
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (navigator as any).mediaDevices = { getUserMedia };
    const { result } = renderHook(() => useMicStream());
    const p1 = result.current.acquire('c1');
    const p2 = result.current.acquire('c2');
    const [s1, s2] = await Promise.all([p1, p2]);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(s1).toBe(s2);
    await waitFor(() => {
      expect(result.current.status).toBe('active');
      expect(result.current.consumersCount).toBe(2);
    });
  });

  it('keeps stream alive when one consumer releases', async () => {
    const { stream, tracks } = makeFakeStream();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (navigator as any).mediaDevices = { getUserMedia: vi.fn().mockResolvedValue(stream) };
    const { result } = renderHook(() => useMicStream());
    await act(async () => {
      await result.current.acquire('c1');
      await result.current.acquire('c2');
    });
    expect(result.current.consumersCount).toBe(2);

    act(() => {
      result.current.release('c1');
    });
    expect(result.current.consumersCount).toBe(1);
    expect(tracks[0].stopped).toBe(false);
    expect(result.current.status).toBe('active');
  });

  it('stops tracks when the last consumer releases', async () => {
    const { stream, tracks } = makeFakeStream();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (navigator as any).mediaDevices = { getUserMedia: vi.fn().mockResolvedValue(stream) };
    const { result } = renderHook(() => useMicStream());
    await act(async () => {
      await result.current.acquire('c1');
    });
    expect(tracks[0].stopped).toBe(false);
    act(() => {
      result.current.release('c1');
    });
    expect(tracks[0].stopped).toBe(true);
    expect(result.current.status).toBe('idle');
    expect(result.current.stream).toBeNull();
    expect(result.current.consumersCount).toBe(0);
  });

  it('both consumers receive the getUserMedia rejection', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (navigator as any).mediaDevices = {
      getUserMedia: vi.fn().mockRejectedValue(new Error('mic denied')),
    };
    const { result } = renderHook(() => useMicStream());
    const p1 = result.current.acquire('c1').catch((e) => e);
    const p2 = result.current.acquire('c2').catch((e) => e);
    const [e1, e2] = await Promise.all([p1, p2]);
    expect(e1).toBeInstanceOf(Error);
    expect(e2).toBeInstanceOf(Error);
    expect((e1 as Error).message).toMatch(/mic denied/);
    await waitFor(() => {
      expect(result.current.status).toBe('error');
    });
  });

  it('release of an unknown consumer is a no-op', async () => {
    const { stream } = makeFakeStream();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (navigator as any).mediaDevices = { getUserMedia: vi.fn().mockResolvedValue(stream) };
    const { result } = renderHook(() => useMicStream());
    await act(async () => {
      await result.current.acquire('c1');
    });
    act(() => {
      result.current.release('never-acquired');
    });
    expect(result.current.consumersCount).toBe(1);
    expect(result.current.status).toBe('active');
  });

  it('second acquire after full release re-calls getUserMedia', async () => {
    const { stream } = makeFakeStream();
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (navigator as any).mediaDevices = { getUserMedia };
    const { result } = renderHook(() => useMicStream());
    await act(async () => {
      await result.current.acquire('c1');
    });
    act(() => {
      result.current.release('c1');
    });
    await act(async () => {
      await result.current.acquire('c1');
    });
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  });
});
