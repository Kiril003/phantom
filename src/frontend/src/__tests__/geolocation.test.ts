/**
 * Phase 9.4c.1 hotfix — BrowserGeolocationService keep-alive regression guards.
 *
 * On a stationary device `navigator.geolocation.watchPosition` fires the
 * success callback once at subscription, then never again until the device
 * actually moves. The backend `BrowserGeolocationSource` requires a fresh
 * submission inside its 60 s freshness window or it goes unavailable; the
 * keep-alive timer re-POSTs the last known position every 20 s to keep
 * the source live.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BrowserGeolocationService } from '../services/geolocation';

describe('BrowserGeolocationService keep-alive', () => {
  const originalFetch = globalThis.fetch;
  const originalGeolocation = (globalThis.navigator as Navigator | undefined)?.geolocation;

  beforeEach(() => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    globalThis.fetch = fetchMock as typeof globalThis.fetch;
    // Stub navigator.geolocation so start() subscribes successfully and
    // captures the watch callback for manual invocation.
    Object.defineProperty(globalThis.navigator, 'geolocation', {
      configurable: true,
      value: {
        watchPosition: vi.fn(
          (success: PositionCallback, _err: PositionErrorCallback | null) => {
            (globalThis as unknown as { __lastWatchCb: PositionCallback }).__lastWatchCb =
              success;
            return 42;
          },
        ),
        clearWatch: vi.fn(),
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
    if (originalGeolocation !== undefined) {
      Object.defineProperty(globalThis.navigator, 'geolocation', {
        configurable: true,
        value: originalGeolocation,
      });
    }
    vi.restoreAllMocks();
  });

  it('re-submits the last known position every keep-alive tick', () => {
    const svc = new BrowserGeolocationService();
    svc.start();

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const watchCb = (globalThis as unknown as { __lastWatchCb: PositionCallback }).__lastWatchCb;

    // Feed one fix → first submission lands immediately.
    watchCb({
      coords: {
        latitude: 49.8382,
        longitude: 18.1564,
        accuracy: 15,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
      },
      timestamp: Date.now(),
    } as GeolocationPosition);

    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 20 s later the keep-alive must fire with the same coordinates but a
    // refreshed `timestamp`.
    vi.advanceTimersByTime(20_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // 40 s of total elapsed time → two keep-alive re-submits on top of
    // the initial POST.
    vi.advanceTimersByTime(20_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // Every body carries the original coordinates (device is stationary).
    for (const call of fetchMock.mock.calls) {
      const [, init] = call as [string, RequestInit];
      const body = JSON.parse(init.body as string) as { lat: number; lon: number };
      expect(body.lat).toBeCloseTo(49.8382, 4);
      expect(body.lon).toBeCloseTo(18.1564, 4);
    }

    svc.stop();
  });

  it('does not re-submit before the first watch callback arrives', () => {
    const svc = new BrowserGeolocationService();
    svc.start();
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;

    // 60 s of keep-alive ticks with no watch callback → zero POSTs.
    vi.advanceTimersByTime(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(0);

    svc.stop();
  });

  it('stop() cancels the keep-alive timer', () => {
    const svc = new BrowserGeolocationService();
    svc.start();
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const watchCb = (globalThis as unknown as { __lastWatchCb: PositionCallback }).__lastWatchCb;

    watchCb({
      coords: {
        latitude: 49.8,
        longitude: 18.1,
        accuracy: 10,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
      },
      timestamp: Date.now(),
    } as GeolocationPosition);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    svc.stop();
    vi.advanceTimersByTime(60_000);
    // No further POSTs after stop().
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
