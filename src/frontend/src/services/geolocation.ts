/**
 * Phase 9.4b — Browser geolocation service.
 *
 * Streams `navigator.geolocation.watchPosition` readings to the backend
 * `/map/geolocation/submit` endpoint. The backend's
 * `BrowserGeolocationSource` picks them up as a mid-trust (70) source in
 * the LocalizationResolver chain, sitting between hardware GPS (95) and
 * IP estimate (30). On permission denial or missing API the service is a
 * silent no-op — the resolver falls through to the next source.
 */

export interface GeolocationSubmission {
  lat: number;
  lon: number;
  accuracy_m: number | null;
  timestamp: string;
}

export interface GeolocationServiceEvents {
  onUpdate?: (pos: GeolocationSubmission) => void;
  onError?: (err: GeolocationPositionError) => void;
  onPermissionChange?: (state: PermissionState) => void;
}

import { request } from './api';

async function submit(sub: GeolocationSubmission): Promise<void> {
  try {
    await request('POST', '/map/geolocation/submit', sub);
  } catch {
    // Silent — the source will go stale after its freshness window and
    // the resolver will fall through to IP estimate or user-stated.
  }
}

export class BrowserGeolocationService {
  private watchId: number | null = null;
  private keepAliveId: number | null = null;
  private events: GeolocationServiceEvents;
  private lastSentAt: number = 0;
  private lastSub: GeolocationSubmission | null = null;
  // Throttle server submissions: browsers fire watchPosition often, we
  // don't need more than one POST every ~3 s.
  private minSubmitIntervalMs: number = 3000;
  // Phase 9.4c.1 hotfix — on a stationary device `watchPosition` fires
  // exactly once at subscription, then stays quiet. That starves the
  // backend `BrowserGeolocationSource`, which goes stale after its 60 s
  // freshness window. Re-submit the last known position on this interval
  // to keep the source live even when the device isn't moving.
  private keepAliveIntervalMs: number = 20_000;

  constructor(events: GeolocationServiceEvents = {}) {
    this.events = events;
  }

  /** True when the browser supports geolocation at all. */
  static isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'geolocation' in navigator;
  }

  /** Query current permission state without triggering a prompt. */
  static async queryPermission(): Promise<PermissionState | null> {
    if (typeof navigator === 'undefined' || !('permissions' in navigator)) return null;
    try {
       
      const res = await (navigator.permissions as any).query({ name: 'geolocation' });
      return res.state as PermissionState;
    } catch {
      return null;
    }
  }

  /** Start watching. Idempotent — double-start is a no-op. */
  start(): void {
    if (!BrowserGeolocationService.isSupported() || this.watchId !== null) return;
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => this.handlePosition(pos),
      (err) => {
        this.events.onError?.(err);
      },
      {
        enableHighAccuracy: true,
        timeout: 10_000,
        maximumAge: 30_000,
      }
    );
    // Keep-alive: re-submit the most recent fix on a timer so the backend
    // source does not go stale on a stationary device where watchPosition
    // never fires a second time. `timestamp` is refreshed on each resend
    // to anchor the freshness window.
    if (typeof window !== 'undefined' && this.keepAliveId === null) {
      this.keepAliveId = window.setInterval(() => this.resendLast(), this.keepAliveIntervalMs);
    }
  }

  /** Stop watching. Safe to call even if not started. */
  stop(): void {
    if (this.watchId !== null && BrowserGeolocationService.isSupported()) {
      navigator.geolocation.clearWatch(this.watchId);
    }
    this.watchId = null;
    if (this.keepAliveId !== null && typeof window !== 'undefined') {
      window.clearInterval(this.keepAliveId);
    }
    this.keepAliveId = null;
    this.lastSub = null;
  }

  private handlePosition(pos: GeolocationPosition): void {
    const sub: GeolocationSubmission = {
      lat: pos.coords.latitude,
      lon: pos.coords.longitude,
      accuracy_m: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null,
      timestamp: new Date(pos.timestamp).toISOString(),
    };
    this.lastSub = sub;
    this.events.onUpdate?.(sub);

    const now = Date.now();
    if (now - this.lastSentAt < this.minSubmitIntervalMs) return;
    this.lastSentAt = now;
    void submit(sub);
  }

  private resendLast(): void {
    if (this.lastSub === null) return;
    // Freshen the timestamp so the backend's freshness window resets; the
    // lat/lon stay pinned to the last actual fix.
    const resent: GeolocationSubmission = {
      ...this.lastSub,
      timestamp: new Date().toISOString(),
    };
    this.lastSentAt = Date.now();
    void submit(resent);
  }
}

export const geolocationService = new BrowserGeolocationService();
