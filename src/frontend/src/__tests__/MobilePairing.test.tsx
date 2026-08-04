/**
 * Phase 19-5 — MobilePairing settings panel tests.
 *
 * Exercises the desktop pairing UI in isolation. The real `pairApi`
 * (HTTP) and `wsClient` (WebSocket multiplexer) are stubbed so the
 * component can be rendered headless — no network, no live socket.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from '@testing-library/react';

/* ── Mocks ────────────────────────────────────────────────────────── */

type PairHandler = (msg: { channel: 'pair'; type: string; data: Record<string, unknown> }) => void;

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
  return {
    ApiError,
    pairApi: {
      init: vi.fn(),
      status: vi.fn(),
      listDevices: vi.fn(),
      revoke: vi.fn(),
    },
  };
});

vi.mock('../services/websocket', () => {
  const handlers: PairHandler[] = [];
  return {
    wsClient: {
      on: vi.fn((channel: string, handler: PairHandler) => {
        if (channel === 'pair') handlers.push(handler);
        return () => {
          const i = handlers.indexOf(handler);
          if (i >= 0) handlers.splice(i, 1);
        };
      }),
      __deliver: (type: string, data: Record<string, unknown>) => {
        handlers.forEach((h) => h({ channel: 'pair', type, data }));
      },
      __handlers: handlers,
    },
  };
});

import { pairApi, ApiError } from '../services/api';
import { wsClient } from '../services/websocket';
import { MobilePairing } from '../components/settings/MobilePairing';

/* ── Fixtures ─────────────────────────────────────────────────────── */

const QR_FIXTURE = {
  pair_id: 'abcdef1234567890deadbeefcafe',
  expires_in_seconds: 60,
  qr: {
    v: 1,
    host: 'phantom.local',
    ip: '192.168.1.42',
    port: 8443,
    pair_id: 'abcdef1234567890deadbeefcafe',
    server_pub: 'pub-bytes',
    server_cert_sha256: 'dev-no-pin',
    exp: Date.now() / 1000 + 60,
    nonce: 'nonce-xyz',
  },
  qr_svg_data_url: 'data:image/svg+xml;utf8,<svg/>',
};

const DEVICE_FIXTURE = {
  id: 'dev-1',
  device_name: 'Pixel 8',
  device_model: 'Pixel 8',
  platform: 'android',
  platform_version: '14',
  paired_at: new Date(Date.now() - 5_000).toISOString(),
  last_seen_at: new Date(Date.now() - 1_000).toISOString(),
  revoked_at: null,
  capabilities: ['camera', 'mic'],
};

/* ── Helpers ──────────────────────────────────────────────────────── */

function getHandlers(): PairHandler[] {
  return (wsClient as unknown as { __handlers: PairHandler[] }).__handlers;
}

beforeEach(() => {
  vi.mocked(pairApi.init).mockReset();
  vi.mocked(pairApi.listDevices).mockReset();
  vi.mocked(pairApi.revoke).mockReset();
  vi.mocked(wsClient.on).mockClear();
  getHandlers().length = 0;
  // Default: no devices, init returns the QR fixture.
  vi.mocked(pairApi.listDevices).mockResolvedValue([]);
  vi.mocked(pairApi.init).mockResolvedValue(QR_FIXTURE);
  vi.mocked(pairApi.revoke).mockResolvedValue({ ok: true });
});

afterEach(() => cleanup());

/* ── Tests ────────────────────────────────────────────────────────── */

describe('MobilePairing — first paint', () => {
  it('shows the "Generate QR" button and no QR image initially', async () => {
    render(<MobilePairing />);
    expect(await screen.findByText(/Згенерувати QR/i)).toBeTruthy();
    expect(screen.queryByAltText(/Pairing QR code/i)).toBeNull();
  });
});

describe('MobilePairing — generate QR', () => {
  it('calls pairApi.init() and renders the qr_svg_data_url as <img>', async () => {
    render(<MobilePairing />);
    const btn = await screen.findByText(/Згенерувати QR/i);
    await act(async () => {
      fireEvent.click(btn);
    });
    await waitFor(() => {
      expect(pairApi.init).toHaveBeenCalledTimes(1);
    });
    const img = (await screen.findByAltText(
      /Pairing QR code/i,
    )) as HTMLImageElement;
    expect(img.src).toBe(QR_FIXTURE.qr_svg_data_url);
  });

  it('shows host, ip:port, truncated pair_id, and підпис про сертифікат', async () => {
    render(<MobilePairing />);
    const btn = await screen.findByText(/Згенерувати QR/i);
    await act(async () => {
      fireEvent.click(btn);
    });
    await screen.findByAltText(/Pairing QR code/i);
    expect(screen.getByText('phantom.local')).toBeTruthy();
    expect(screen.getByText(/192\.168\.1\.42:8443/)).toBeTruthy();
    // Chip uses `pair_id · abcdef12…` (middle dot + ellipsis). The new
    // raw-JSON drawer also contains the substring "pair_id": "abcdef12…",
    // so we scope the match to text containing the middle-dot separator
    // unique to the chip rendering.
    expect(
      screen.getByText((t) => t.includes('pair_id ·') && t.includes('abcdef12')),
    ).toBeTruthy();
    expect(screen.getByText(/локальна мережа · без сертифіката/i)).toBeTruthy();
  });

  it('shows "ROOT trust required" banner on ApiError 403', async () => {
    vi.mocked(pairApi.init).mockRejectedValueOnce(
      new ApiError(403, 'FORBIDDEN', 'forbidden'),
    );
    render(<MobilePairing />);
    const btn = await screen.findByText(/Згенерувати QR/i);
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(
      await screen.findByText(/ROOT trust required to pair a device/i),
    ).toBeTruthy();
    expect(screen.queryByAltText(/Pairing QR code/i)).toBeNull();
  });
});

describe('MobilePairing — WS lifecycle', () => {
  it('clears the QR and shows a "paired successfully" toast on pair/claimed', async () => {
    render(<MobilePairing />);
    const btn = await screen.findByText(/Згенерувати QR/i);
    await act(async () => {
      fireEvent.click(btn);
    });
    await screen.findByAltText(/Pairing QR code/i);

    // Backend will be hit again from the claim handler.
    vi.mocked(pairApi.listDevices).mockResolvedValueOnce([DEVICE_FIXTURE]);

    await act(async () => {
      (
        wsClient as unknown as {
          __deliver: (t: string, d: Record<string, unknown>) => void;
        }
      ).__deliver('claimed', { device_name: 'Pixel 8' });
    });

    expect(
      await screen.findByText(/Pixel 8 paired successfully/i),
    ).toBeTruthy();
    expect(screen.queryByAltText(/Pairing QR code/i)).toBeNull();
    await waitFor(() => {
      // initial mount + one extra after claim
      expect(pairApi.listDevices).toHaveBeenCalledTimes(2);
    });
  });
});

describe('MobilePairing — paired devices list', () => {
  it('renders a row + Revoke button per device, refreshes after revoke', async () => {
    vi.mocked(pairApi.listDevices).mockResolvedValueOnce([DEVICE_FIXTURE]);
    render(<MobilePairing />);
    expect(await screen.findByText('Pixel 8')).toBeTruthy();

    const revokeBtn = screen.getByText(/Revoke/i).closest('button');
    expect(revokeBtn).toBeTruthy();

    // After revoke the list will be refetched; second call returns empty.
    vi.mocked(pairApi.listDevices).mockResolvedValueOnce([]);

    await act(async () => {
      fireEvent.click(revokeBtn as HTMLButtonElement);
    });

    await waitFor(() => {
      expect(pairApi.revoke).toHaveBeenCalledWith(
        DEVICE_FIXTURE.id,
        expect.any(String),
      );
    });
    await waitFor(() => {
      // mount + post-revoke refresh
      expect(pairApi.listDevices).toHaveBeenCalledTimes(2);
    });
  });
});
