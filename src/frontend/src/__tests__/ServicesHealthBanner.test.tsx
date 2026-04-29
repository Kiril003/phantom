/**
 * Phase 9.4c audit Q6 + B-WK-3 fix (2026-04-30) —
 * ServicesHealthBanner only renders when a tracked external service is
 * genuinely degraded:
 *   - status === "down"  → banner shows "offline".
 *   - status === "stale" AND last_failure_at present → banner shows "stale".
 *   - status === "stale" AND last_failure_at null   → silent (cold-boot
 *     "we haven't called yet" — not a real degradation; this was the
 *     B-WK-3 false-positive).
 *   - status === "ok" / "unknown" → silent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { ServicesHealthBanner } from '../components/map/ServicesHealthBanner';

vi.mock('../services/api', () => ({
  mapApi: {
    getServicesHealth: vi.fn(),
  },
}));

import { mapApi } from '../services/api';

describe('ServicesHealthBanner', () => {
  beforeEach(() => {
    vi.mocked(mapApi.getServicesHealth).mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders nothing when every service is ok', async () => {
    vi.mocked(mapApi.getServicesHealth).mockResolvedValue({
      services: {
        nominatim: {
          status: 'ok',
          last_success_at: 1,
          last_failure_at: null,
          last_failure_reason: null,
          seconds_since_success: 1,
        },
        overpass: {
          status: 'ok',
          last_success_at: 1,
          last_failure_at: null,
          last_failure_reason: null,
          seconds_since_success: 1,
        },
      },
    });

    render(<ServicesHealthBanner />);
    await waitFor(() => {
      expect(mapApi.getServicesHealth).toHaveBeenCalled();
    });
    // Banner should remain hidden.
    expect(screen.queryByTestId('services-health-banner')).toBeNull();
  });

  it('shows an offline banner when a service is down', async () => {
    vi.mocked(mapApi.getServicesHealth).mockResolvedValue({
      services: {
        nominatim: {
          status: 'down',
          last_success_at: null,
          last_failure_at: 1,
          last_failure_reason: 'HTTP 504',
          seconds_since_success: null,
        },
        overpass: {
          status: 'ok',
          last_success_at: 1,
          last_failure_at: null,
          last_failure_reason: null,
          seconds_since_success: 1,
        },
      },
    });

    render(<ServicesHealthBanner />);
    const banner = await screen.findByTestId('services-health-banner');
    expect(banner.textContent || '').toMatch(/offline/i);
    expect(banner.textContent || '').toMatch(/Geocoding/);
  });

  it('labels a stale-with-failure set as stale, not offline', async () => {
    vi.mocked(mapApi.getServicesHealth).mockResolvedValue({
      services: {
        ipapi: {
          status: 'stale',
          last_success_at: 1,
          // BE saw at least one failure — this is a real degradation, not
          // a cold-boot artefact, so the banner is appropriate.
          last_failure_at: 2,
          last_failure_reason: 'HTTP 502',
          seconds_since_success: 99999,
        },
      },
    });

    render(<ServicesHealthBanner />);
    const banner = await screen.findByTestId('services-health-banner');
    expect(banner.textContent || '').toMatch(/stale/i);
  });

  it('stays silent on cold-boot stale (no recorded failure) — B-WK-3', async () => {
    // Before B-WK-3 fix this fired the banner pre-emptively whenever a
    // service hadn't been hit yet, which permanently lit the warning even
    // on a healthy boot. Verify the new gate suppresses that signal.
    vi.mocked(mapApi.getServicesHealth).mockResolvedValue({
      services: {
        ipapi: {
          status: 'stale',
          last_success_at: 1,
          last_failure_at: null,
          last_failure_reason: null,
          seconds_since_success: 99999,
        },
      },
    });

    render(<ServicesHealthBanner />);
    await waitFor(() => {
      expect(mapApi.getServicesHealth).toHaveBeenCalled();
    });
    expect(screen.queryByTestId('services-health-banner')).toBeNull();
  });
});
