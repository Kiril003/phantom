/**
 * Phase 9.4c audit Q6 — ServicesHealthBanner renders only when at least
 * one tracked external service is down or stale.
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

  it('labels a stale-only set as stale, not offline', async () => {
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
    const banner = await screen.findByTestId('services-health-banner');
    expect(banner.textContent || '').toMatch(/stale/i);
  });
});
