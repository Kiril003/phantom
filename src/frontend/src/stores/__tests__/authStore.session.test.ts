/**
 * Обрив зв'язку не має коштувати сесії.
 *
 * Раніше будь-яка невдача `authApi.me()` — включно з мертвим дротом —
 * стирала токен, і власника викидало на екран входу, де PIN однаково нема
 * кому перевірити. Один із тестів нижче саме про це.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const me = vi.fn();
const refresh = vi.fn();

// Фабрика підіймається на верх файла, тож клас оголошуємо всередині неї.
vi.mock('../../services/api', () => {
  class ApiError extends Error {
    constructor(
      public status: number,
      public code = 'ERR',
      message = 'fail',
    ) {
      super(message);
      this.name = 'ApiError';
    }
  }
  return {
    ApiError,
    authApi: {
      me: (...a: unknown[]) => me(...a),
      refresh: (...a: unknown[]) => refresh(...a),
      loginPin: vi.fn(),
      picker: vi.fn(),
    },
  };
});

vi.mock('../../services/settingsBootstrap', () => ({
  bootstrapSettings: vi.fn().mockResolvedValue(undefined),
}));

import { useAuthStore } from '../authStore';
import { ApiError as FakeApiError } from '../../services/api';

const TOKEN = 'live-token';

function seedSession() {
  localStorage.setItem('phantom_token', TOKEN);
  localStorage.setItem('phantom_token_expires', new Date(Date.now() + 3_600_000).toISOString());
  useAuthStore.setState({
    token: TOKEN,
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    user: null,
    sessionPhase: 'checking',
  });
}

describe('autoLogin — ядро мовчить проти ядро відмовило', () => {
  beforeEach(() => {
    me.mockReset();
    refresh.mockReset();
    localStorage.clear();
  });

  it('мережева помилка лишає токен на місці', async () => {
    seedSession();
    me.mockRejectedValue(new TypeError('Failed to fetch'));

    const ok = await useAuthStore.getState().autoLogin();

    expect(ok).toBe(false);
    expect(useAuthStore.getState().sessionPhase).toBe('unreachable');
    expect(useAuthStore.getState().token).toBe(TOKEN);
    expect(localStorage.getItem('phantom_token')).toBe(TOKEN);
  });

  it('401 від ядра стирає токен', async () => {
    seedSession();
    me.mockRejectedValue(new FakeApiError(401, "UNAUTHORIZED", "no"));

    const ok = await useAuthStore.getState().autoLogin();

    expect(ok).toBe(false);
    expect(useAuthStore.getState().sessionPhase).toBe('out');
    expect(useAuthStore.getState().token).toBeNull();
    expect(localStorage.getItem('phantom_token')).toBeNull();
  });

  it('500 від ядра — теж не привід стирати ключ', async () => {
    seedSession();
    me.mockRejectedValue(new FakeApiError(500, "SERVER", "boom"));

    await useAuthStore.getState().autoLogin();

    expect(useAuthStore.getState().sessionPhase).toBe('unreachable');
    expect(localStorage.getItem('phantom_token')).toBe(TOKEN);
  });

  it('успіх переводить сесію в «in»', async () => {
    seedSession();
    me.mockResolvedValue({ id: 'u1', username: 'phantom' });

    const ok = await useAuthStore.getState().autoLogin();

    expect(ok).toBe(true);
    expect(useAuthStore.getState().sessionPhase).toBe('in');
    expect(useAuthStore.getState().user).toMatchObject({ username: 'phantom' });
  });

  it('без токена сесія одразу «out», ядро не смикаємо', async () => {
    localStorage.clear();
    useAuthStore.setState({ token: null, expiresAt: null, sessionPhase: 'checking' });

    const ok = await useAuthStore.getState().autoLogin();

    expect(ok).toBe(false);
    expect(useAuthStore.getState().sessionPhase).toBe('out');
    expect(me).not.toHaveBeenCalled();
  });

  it('прострочений токен + мертве оновлення = «unreachable», ключ цілий', async () => {
    localStorage.setItem('phantom_token', TOKEN);
    localStorage.setItem('phantom_token_expires', new Date(Date.now() - 1000).toISOString());
    useAuthStore.setState({
      token: TOKEN,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
      sessionPhase: 'checking',
    });
    refresh.mockRejectedValue(new TypeError('Failed to fetch'));

    await useAuthStore.getState().autoLogin();

    expect(useAuthStore.getState().sessionPhase).toBe('unreachable');
    expect(localStorage.getItem('phantom_token')).toBe(TOKEN);
    expect(me).not.toHaveBeenCalled();
  });
});
