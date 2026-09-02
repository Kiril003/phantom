/**
 * «Ключі доступу» мусять ходити у СПРАВЖНЄ ядро — /api-keys.
 *
 * Як це виглядало для людини до правки: вкладка показувала два «ключі»
 * Production / Development із захардкодженими pk_live_…/pk_test_…,
 * «Generate Key» творив випадковий рядок у памʼяті вкладки, «Delete»
 * фільтрував локальний масив. Жодного запиту до ядра; після
 * перезавантаження все «створене» зникало, а вигадане поверталось.
 *
 * При цьому бекенд ДАВНО має робочі маршрути
 * (src/backend/api/routes_api_keys.py: POST /generate, GET /, DELETE /{id})
 * і навіть автентифікує такі ключі (security/device_auth.py, role="API").
 * Класика «написане, але не викликане»: труба ціла, а голови не було.
 *
 * Сторож доводить чотири ланки чесного ланцюга:
 *   1) монтування читає список із ядра (GET /api-keys/), не вигадує;
 *   2) порожнє ядро → чесна порожнеча, без Production/Development;
 *   3) створення бʼє POST /api-keys/generate і показує повний ключ
 *      РІВНО один раз (сервер зберігає лише SHA-256-відбиток);
 *   4) видалення бʼє DELETE /api-keys/{id}.
 *
 * ЧЕРВОНИМ доведено на старому коді: жодного request(), натомість
 * pk_live_1234567890abcdef на склі — падають усі чотири.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const requestMock = vi.fn();

vi.mock('../services/api', async () => {
  const actual = await vi.importActual<object>('../services/api');
  return {
    ...actual,
    request: (...a: unknown[]) => requestMock(...a),
  };
});

import { ApiKeysTab } from '../components/settings/ApiKeysTab';

/** Ядро з одним збереженим ключем — сирого значення воно вже НЕ знає. */
function coreWithOneKey() {
  requestMock.mockImplementation(async (method: string, path: string) => {
    if (method === 'GET' && path === '/api-keys/') {
      return {
        api_keys: [
          { id: 'k1', name: 'CI-сервер', created_at: '2026-08-01T10:00:00' },
        ],
      };
    }
    if (method === 'POST' && path.startsWith('/api-keys/generate')) {
      return { id: 'k2', name: 'новий', key: 'pk_live_СЕКРЕТ_ОДИН_РАЗ' };
    }
    if (method === 'DELETE' && path.startsWith('/api-keys/')) {
      return { status: 'revoked' };
    }
    throw new Error(`несподіваний запит: ${method} ${path}`);
  });
}

describe('Ключі доступу — дріт до /api-keys, не вигадка', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('монтування читає список із ядра, а не малює захардкоджене', async () => {
    coreWithOneKey();
    render(<ApiKeysTab />);
    // Те, що віддало ядро — на склі.
    await waitFor(() => {
      expect(screen.getByText(/CI-сервер/)).toBeInTheDocument();
    });
    expect(requestMock).toHaveBeenCalledWith('GET', '/api-keys/');
    // Вигадка старого коду — НЕ на склі. Сирих значень збережених
    // ключів ядро не віддає (тільки відбиток), тож і панель не сміє.
    expect(document.body.textContent).not.toMatch(/pk_live_1234567890abcdef/);
    expect(document.body.textContent).not.toMatch(/pk_test_abcdef1234567890/);
  });

  it('порожнє ядро → чесна порожнеча, без Production/Development', async () => {
    requestMock.mockImplementation(async (method: string, path: string) => {
      if (method === 'GET' && path === '/api-keys/') return { api_keys: [] };
      throw new Error(`несподіваний запит: ${method} ${path}`);
    });
    render(<ApiKeysTab />);
    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith('GET', '/api-keys/');
    });
    expect(screen.queryByText(/Production/)).toBeNull();
    expect(screen.queryByText(/Development/)).toBeNull();
  });

  it('створення бʼє POST /api-keys/generate і показує ключ один раз', async () => {
    coreWithOneKey();
    render(<ApiKeysTab />);
    await waitFor(() => {
      expect(screen.getByText(/CI-сервер/)).toBeInTheDocument();
    });
    fireEvent.change(screen.getByTestId('api-key-name-input'), {
      target: { value: 'новий' },
    });
    fireEvent.click(screen.getByTestId('api-key-generate'));
    // Повний ключ показано (єдиний момент, коли він існує у відкритому виді).
    await waitFor(() => {
      expect(screen.getByText(/pk_live_СЕКРЕТ_ОДИН_РАЗ/)).toBeInTheDocument();
    });
    const postCall = requestMock.mock.calls.find(([m]) => m === 'POST');
    expect(postCall).toBeDefined();
    expect(String(postCall![1])).toMatch(
      /^\/api-keys\/generate\?name=/,
    );
  });

  it('видалення бʼє DELETE /api-keys/{id}', async () => {
    coreWithOneKey();
    render(<ApiKeysTab />);
    await waitFor(() => {
      expect(screen.getByText(/CI-сервер/)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('api-key-delete-k1'));
    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith('DELETE', '/api-keys/k1');
    });
  });
});
