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

const BASE = '/api/v1';

async function submit(sub: GeolocationSubmission): Promise<void> {
  const token = localStorage.getItem('phantom_token');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  try {
    await fetch(`${BASE}/map/geolocation/submit`, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify(sub),
    });
  } catch {
    // Silent — the source will go stale after its freshness window and
    // the resolver will fall through to IP estimate or user-stated.
  }
}

export class BrowserGeolocationService {
  private watchId: number | null = null;
  private events: GeolocationServiceEvents;
  private lastSentAt: number = 0;
  // Throttle server submissions: browsers fire watchPosition often, we
  // don't need more than one POST every ~3 s.
  private minSubmitIntervalMs: number = 3000;

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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  }

  /** Stop watching. Safe to call even if not started. */
  stop(): void {
    if (this.watchId !== null && BrowserGeolocationService.isSupported()) {
      navigator.geolocation.clearWatch(this.watchId);
    }
    this.watchId = null;
  }

  private handlePosition(pos: GeolocationPosition): void {
    const sub: GeolocationSubmission = {
      lat: pos.coords.latitude,
      lon: pos.coords.longitude,
      accuracy_m: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null,
      timestamp: new Date(pos.timestamp).toISOString(),
    };
    this.events.onUpdate?.(sub);

    const now = Date.now();
    if (now - this.lastSentAt < this.minSubmitIntervalMs) return;
    this.lastSentAt = now;
    void submit(sub);
  }
}

export const geolocationService = new BrowserGeolocationService();
