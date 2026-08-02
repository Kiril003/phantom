/**
 * Settings → License group tests.
 *
 * Exercises the license status/activation panel in isolation. The real
 * `licenseApi` (HTTP) is stubbed so the component renders headless.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor, act } from '@testing-library/react';

vi.mock('../services/licenseApi', () => ({
  licenseApi: {
    status: vi.fn(),
    activate: vi.fn(),
    deactivate: vi.fn(),
    revalidate: vi.fn(),
  },
}));

vi.mock('../services/api', () => {
  class ApiError extends Error {
    constructor(
      public status: number,
      public code: string,
      message: string,
    ) {
      super(message);
      this.name = 'ApiError';
    }
  }
  return { ApiError };
});

import { licenseApi, type Entitlement, type LicenseStatus } from '../services/licenseApi';
import { LicenseGroup } from '../components/settings/LicenseGroup';

function ent(over: Partial<Entitlement> = {}): Entitlement {
  return {
    tier: 'free',
    reason: 'not_activated',
    license_tier: null,
    trial_days_left: 0,
    grace_days_left: null,
    updates_until: null,
    build_date: '2026-08-03',
    features: ['core.chat', 'core.map', 'core.nav', 'core.alerts', 'core.vault', 'core.voice'],
    ...over,
  };
}

const NOT_ACTIVATED: LicenseStatus = {
  valid: false,
  reason: 'not_activated',
  tier: null,
  license_id: null,
  serial: null,
  updates_until: null,
  fingerprint: 'abc123def456fingerprint',
  entitlement: ent(),
  enforced: true,
};

const ACTIVATED: LicenseStatus = {
  valid: true,
  reason: 'ok',
  tier: 'personal',
  license_id: 'lic-001',
  serial: 'SN-42',
  updates_until: '2027-01-01',
  fingerprint: 'abc123def456fingerprint',
  entitlement: ent({
    tier: 'personal',
    reason: 'ok',
    license_tier: 'personal',
    grace_days_left: 30,
    updates_until: '2027-01-01',
    features: [
      'core.chat',
      'core.map',
      'core.nav',
      'core.alerts',
      'core.vault',
      'core.voice',
      'bridge.pair',
      'memory.longterm',
      'map.terrain3d',
      'voice.premium',
      'gnss.blackbox',
      'export.reports',
    ],
  }),
  enforced: true,
};

beforeEach(() => {
  vi.mocked(licenseApi.status).mockReset();
  vi.mocked(licenseApi.activate).mockReset();
  vi.mocked(licenseApi.deactivate).mockReset();
  vi.mocked(licenseApi.revalidate).mockReset();
});

afterEach(() => cleanup());

describe('LicenseGroup — not activated', () => {
  it('shows the activation form and "Не активовано" badge', async () => {
    vi.mocked(licenseApi.status).mockResolvedValue(NOT_ACTIVATED);
    render(<LicenseGroup />);

    expect(await screen.findByText('Не активовано')).toBeTruthy();
    expect(screen.getByTestId('license-activate-form')).toBeTruthy();
    expect(screen.getByPlaceholderText(/PHTM-XXXXX/)).toBeTruthy();
  });
});

describe('LicenseGroup — activation', () => {
  it('activates successfully and flips the badge to "Активовано"', async () => {
    vi.mocked(licenseApi.status).mockResolvedValue(NOT_ACTIVATED);
    vi.mocked(licenseApi.activate).mockResolvedValue(ACTIVATED);
    render(<LicenseGroup />);

    await screen.findByTestId('license-activate-form');
    const input = screen.getByPlaceholderText(/PHTM-XXXXX/) as HTMLInputElement;

    await act(async () => {
      fireEvent.change(input, { target: { value: 'phtm-aaaaa-bbbbb-ccccc-ddddd' } });
    });
    expect(input.value).toBe('PHTM-AAAAA-BBBBB-CCCCC-DDDDD');

    const activateBtn = screen.getByText('Активувати').closest('button') as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(activateBtn);
    });

    await waitFor(() => {
      expect(licenseApi.activate).toHaveBeenCalledWith(
        'PHTM-AAAAA-BBBBB-CCCCC-DDDDD',
        'phantom-os',
      );
    });
    expect(await screen.findByText('Активовано')).toBeTruthy();
  });

  it('shows a human-readable error under the form on activation failure', async () => {
    vi.mocked(licenseApi.status).mockResolvedValue(NOT_ACTIVATED);
    vi.mocked(licenseApi.activate).mockRejectedValue(new Error('Ключ не знайдено'));
    render(<LicenseGroup />);

    await screen.findByTestId('license-activate-form');
    const input = screen.getByPlaceholderText(/PHTM-XXXXX/) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: 'PHTM-AAAAA-BBBBB-CCCCC-DDDDD' } });
    });

    const activateBtn = screen.getByText('Активувати').closest('button') as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(activateBtn);
    });

    expect(await screen.findByText('Ключ не знайдено')).toBeTruthy();
    expect(screen.getByTestId('license-activate-form')).toBeTruthy();
  });
});

describe('LicenseGroup — active license', () => {
  it('renders revalidate/deactivate controls and info tiles', async () => {
    vi.mocked(licenseApi.status).mockResolvedValue(ACTIVATED);
    render(<LicenseGroup />);

    expect(await screen.findByText('Активовано')).toBeTruthy();
    expect(screen.getByText('Перевірити на сервері')).toBeTruthy();
    expect(screen.getByText('Деактивувати')).toBeTruthy();
    expect(screen.getByText('lic-001')).toBeTruthy();
    expect(screen.queryByTestId('license-activate-form')).toBeNull();
  });
});

describe('LicenseGroup — рівень і права', () => {
  it('без ключа показує «Вільний» і не ховає безпеку', async () => {
    vi.mocked(licenseApi.status).mockResolvedValue(NOT_ACTIVATED);
    render(<LicenseGroup />);

    expect(await screen.findByText('Вільний')).toBeTruthy();
    const board = screen.getByTestId('license-features');
    // Обіцянка продукту: навігація й тривоги ніколи не за грошима.
    for (const label of ['Навігація', 'Тривоги', 'Мапа й офлайн-пакети', 'Сховище']) {
      expect(board.textContent).toContain(label);
    }
    expect(screen.getByText(/працюють без нього/)).toBeTruthy();
  });

  it('ознайомчий період названий своїм ім’ям, а не «активовано»', async () => {
    vi.mocked(licenseApi.status).mockResolvedValue({
      ...NOT_ACTIVATED,
      entitlement: ent({ tier: 'personal', reason: 'trial', trial_days_left: 9 }),
    });
    render(<LicenseGroup />);

    expect(await screen.findByText('Ознайомчий')).toBeTruthy();
    expect(screen.getByText(/лишилось 9 дн/)).toBeTruthy();
  });

  it('прострочене вікно оновлень пояснює себе, а не вдає поломку', async () => {
    vi.mocked(licenseApi.status).mockResolvedValue({
      ...ACTIVATED,
      entitlement: ent({
        tier: 'free',
        reason: 'updates_expired',
        license_tier: 'personal',
        updates_until: '2026-01-01',
      }),
    });
    render(<LicenseGroup />);

    expect(await screen.findByText(/Куплена версія працює далі/)).toBeTruthy();
  });
});
