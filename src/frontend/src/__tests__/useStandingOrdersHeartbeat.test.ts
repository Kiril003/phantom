/**
 * useStandingOrdersHeartbeat — polling hook tests.
 *
 * Strategy: vi.useFakeTimers() freezes the clock so setInterval is
 * controllable. Microtasks/Promises are flushed by wrapping advances in
 * `await act(async () => { await vi.advanceTimersByTimeAsync(N) })`.
 * The initial tick() fires synchronously on mount; flushing 0 ms is
 * sufficient to resolve the first mock Promise.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useStandingOrdersHeartbeat } from '../hooks/useStandingOrdersHeartbeat';

// ---------------------------------------------------------------------------
// Module mock — replace ../services/api so no real fetch fires.
// ---------------------------------------------------------------------------
const requestSpy = vi.fn();

vi.mock('../services/api', () => ({
  request: (...args: unknown[]) => requestSpy(...args),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const makeOrders = (
  rows: Array<{ enabled: boolean; fire_count: number; last_fired_at: string | null }>,
) => ({ orders: rows.map((r, i) => ({ id: i + 1, ...r })) });

const EMPTY_RESP = { orders: [] };

/** Flush the initial synchronous tick() Promise without advancing the clock. */
async function flushInitialTick() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

/** Advance the fake clock by `ms` and flush all resulting promises. */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------
describe('useStandingOrdersHeartbeat', () => {
  beforeEach(() => {
    requestSpy.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ── 1. Initial render → loading=true → after first fetch → values populated ──

  it('starts with loading=true and resolves values after first fetch', async () => {
    requestSpy.mockResolvedValue(
      makeOrders([
        { enabled: true,  fire_count: 3, last_fired_at: '2026-05-11T20:00:00Z' },
        { enabled: false, fire_count: 0, last_fired_at: null },
        { enabled: true,  fire_count: 1, last_fired_at: '2026-05-11T21:00:00Z' },
      ]),
    );

    const { result } = renderHook(() => useStandingOrdersHeartbeat());

    // Before the async tick resolves, loading must be true.
    expect(result.current.loading).toBe(true);
    expect(result.current.enabled).toBe(0);

    // Flush the first fetch promise (0 ms advance resolves microtasks).
    await flushInitialTick();

    expect(result.current.loading).toBe(false);
    expect(result.current.enabled).toBe(2);
    expect(result.current.totalFired).toBe(4); // 3 + 0 + 1
    expect(result.current.lastFireAt).toBe('2026-05-11T21:00:00Z');
    expect(requestSpy).toHaveBeenCalledWith('GET', '/agent/standing_orders');
    expect(requestSpy).toHaveBeenCalledTimes(1);
  });

  // ── 2. After 10 s tick → second fetch fires ──

  it('fires a second fetch after 10 s and updates values', async () => {
    // First poll: 2 enabled orders.
    requestSpy.mockResolvedValueOnce(
      makeOrders([
        { enabled: true,  fire_count: 1, last_fired_at: '2026-05-11T20:00:00Z' },
        { enabled: true,  fire_count: 2, last_fired_at: '2026-05-11T20:30:00Z' },
      ]),
    );
    // Second poll: 1 enabled order (simulating a change).
    requestSpy.mockResolvedValueOnce(
      makeOrders([
        { enabled: true,  fire_count: 5, last_fired_at: '2026-05-11T22:00:00Z' },
        { enabled: false, fire_count: 2, last_fired_at: '2026-05-11T20:30:00Z' },
      ]),
    );

    const { result } = renderHook(() => useStandingOrdersHeartbeat());

    // Flush first fetch.
    await flushInitialTick();
    expect(result.current.enabled).toBe(2);
    expect(requestSpy).toHaveBeenCalledTimes(1);

    // Advance fake clock by 10 s — triggers the interval callback.
    await advance(10_000);

    expect(result.current.enabled).toBe(1);
    expect(result.current.totalFired).toBe(7); // 5 + 2
    expect(result.current.lastFireAt).toBe('2026-05-11T22:00:00Z');
    expect(requestSpy).toHaveBeenCalledTimes(2);
  });

  // ── 3. Unmount → no further fetches ──

  it('clears the interval on unmount so no further fetches fire', async () => {
    requestSpy.mockResolvedValue(EMPTY_RESP);

    const { unmount } = renderHook(() => useStandingOrdersHeartbeat());

    // Flush initial tick.
    await flushInitialTick();
    expect(requestSpy).toHaveBeenCalledTimes(1);

    // Unmount — cleanup should call clearInterval.
    unmount();

    // Advance well past one full polling cycle.
    await advance(30_000);

    // Still exactly 1 call — no fetches after unmount.
    expect(requestSpy).toHaveBeenCalledTimes(1);
  });

  // ── 4. Failed fetch → previous values preserved, no crash ──

  it('keeps last-known values when a fetch fails and does not throw', async () => {
    // First poll succeeds.
    requestSpy.mockResolvedValueOnce(
      makeOrders([
        { enabled: true,  fire_count: 2, last_fired_at: '2026-05-11T19:00:00Z' },
        { enabled: true,  fire_count: 1, last_fired_at: '2026-05-11T18:00:00Z' },
      ]),
    );
    // Second poll fails.
    requestSpy.mockRejectedValueOnce(new Error('network error'));

    const { result } = renderHook(() => useStandingOrdersHeartbeat());

    // Flush first (successful) fetch.
    await flushInitialTick();
    expect(result.current.enabled).toBe(2);
    expect(result.current.totalFired).toBe(3);
    expect(result.current.lastFireAt).toBe('2026-05-11T19:00:00Z');
    expect(result.current.loading).toBe(false);

    // Snapshot before the failure.
    const snapEnabled  = result.current.enabled;
    const snapFired    = result.current.totalFired;
    const snapFireAt   = result.current.lastFireAt;

    // Trigger the failing second fetch via the interval.
    await advance(10_000);

    // Values must be preserved from the last successful response.
    expect(result.current.enabled).toBe(snapEnabled);
    expect(result.current.totalFired).toBe(snapFired);
    expect(result.current.lastFireAt).toBe(snapFireAt);
    // loading must remain false — not reset to true on error.
    expect(result.current.loading).toBe(false);
    expect(requestSpy).toHaveBeenCalledTimes(2);
  });

  // ── 5. Empty orders list ──

  it('handles an empty orders list correctly', async () => {
    requestSpy.mockResolvedValue(EMPTY_RESP);

    const { result } = renderHook(() => useStandingOrdersHeartbeat());

    await flushInitialTick();

    expect(result.current.loading).toBe(false);
    expect(result.current.enabled).toBe(0);
    expect(result.current.totalFired).toBe(0);
    expect(result.current.lastFireAt).toBeNull();
  });

  // ── 6. lastFireAt picks the latest timestamp ──

  it('picks the most-recent last_fired_at across all orders', async () => {
    requestSpy.mockResolvedValue(
      makeOrders([
        { enabled: true, fire_count: 1, last_fired_at: '2026-05-11T08:00:00Z' },
        { enabled: true, fire_count: 1, last_fired_at: '2026-05-11T23:59:00Z' },
        { enabled: true, fire_count: 1, last_fired_at: '2026-05-11T12:00:00Z' },
      ]),
    );

    const { result } = renderHook(() => useStandingOrdersHeartbeat());

    await flushInitialTick();
    expect(result.current.lastFireAt).toBe('2026-05-11T23:59:00Z');
  });
});
