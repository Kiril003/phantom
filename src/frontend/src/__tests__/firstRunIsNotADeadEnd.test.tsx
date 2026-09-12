/**
 * Перший запуск на чужій машині не має бути глухим кутом.
 *
 * Зміряно 12.09.2026 по коду ядра: ПІН народжується випадковим на першому
 * старті (`security/auth.py:252-291`) і лягає лише у файл
 * `identity/bootstrap_pin` (0600). У журнал він пишеться рівнем WARNING, а
 * `env_logger` оболонки без `RUST_LOG` пропускає тільки `error`
 * (`src-tauri/src/main.rs:31`) — тобто в зібраному застосунку того рядка
 * не видно взагалі. Форма входу при цьому не пояснювала НІЧОГО: єдиний
 * текст про походження ПІНу жив у гілці `nobody`, куди здоровий перший
 * запуск не потрапляє ніколи (ядро щоразу заводить власника, тож picker
 * повертає один рядок і екран стрибає одразу на клавіатуру).
 *
 * І друге, гірше: будь-яка помилка `loginPin` — 401 за невірним кодом
 * теж — складала вигаданого користувача з роллю ROOT, клала токен-літерал
 * `'local_demo_token'` і впускала. Людина з неправильним кодом опинялась
 * «усередині», де ядро мовчки 401-ило кожен виклик.
 *
 * Сторож тисне на живий екран, а не грепає файли.
 */

import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: new Proxy(
    {},
    {
      get: (_t, tag: string) =>
        React.forwardRef((props: Record<string, unknown>, ref) => {
          const skip = new Set(['initial', 'animate', 'exit', 'transition', 'whileTap', 'whileHover', 'layout']);
          const clean: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(props)) if (!skip.has(k)) clean[k] = v;
          return React.createElement(tag, { ...clean, ref });
        }),
    },
  ),
}));

const OWNER = { id: 'u1', username: 'phantom', avatar_url: null };

/** Помилка ядра у тій самій формі, яку кидає services/api.ts. */
class FakeApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public retryAfterS: number | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function mountLogin(loginPin: ReturnType<typeof vi.fn>) {
  vi.resetModules();
  vi.doMock('../services/api', () => ({
    ApiError: FakeApiError,
    authApi: { picker: vi.fn().mockResolvedValue([OWNER]), loginPin },
  }));
  const { default: LoginScreen } = await import('../components/auth/LoginScreen');
  const { useSystemStore } = await import('../stores/systemStore');
  render(
    <MemoryRouter>
      <LoginScreen />
    </MemoryRouter>,
  );
  // Один профіль — екран одразу на клавіатурі, як на справжньому першому запуску.
  await screen.findByRole('button', { name: 'Звідки взяти код?' });
  return { useSystemStore };
}

/** Набрати код: клавіатура сама шле його на шостій цифрі (PinPad.tsx:40). */
function typePin(pin: string) {
  for (const d of pin) fireEvent.click(screen.getByRole('button', { name: d }));
}

describe('перший запуск: форма пояснює, чого просить', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('на екрані ПІНу є дорога далі, і вона називає, де лежить код', async () => {
    await mountLogin(vi.fn());

    const door = screen.getByRole('button', { name: 'Звідки взяти код?' });
    expect(door.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(door);

    // Файл названо своїм імʼям — інакше підказка нічого не дає.
    expect(screen.getByText(/bootstrap_pin/)).toBeTruthy();
    // І сказано головне про його природу: він лише для цього пристрою.
    expect(
      screen.getAllByText(/лише на цьому пристрої|тільки з екрана самого пристрою/).length,
    ).toBeGreaterThan(0);
    expect(door.getAttribute('aria-expanded')).toBe('true');
  });
});

describe('невірний код каже про себе і НЕ впускає', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('401 — на екрані «Код не підійшов», сесії немає', async () => {
    const loginPin = vi
      .fn()
      .mockRejectedValue(new FakeApiError(401, 'PIN_INVALID', 'Invalid username or PIN'));
    const { useSystemStore } = await mountLogin(loginPin);
    useSystemStore.setState({ authenticated: false });

    typePin('123456');

    await waitFor(() => {
      expect(screen.getByText('Код не підійшов.')).toBeTruthy();
    });
    // Найважливіше: жодного вигаданого входу.
    expect(useSystemStore.getState().authenticated).toBe(false);
  });

  it('429 — пауза береться з Retry-After, а не вигадується', async () => {
    const loginPin = vi
      .fn()
      .mockRejectedValue(new FakeApiError(429, 'LOCKED_OUT', 'Too many failed login attempts.', 42));
    const { useSystemStore } = await mountLogin(loginPin);
    useSystemStore.setState({ authenticated: false });

    typePin('123456');

    await waitFor(() => {
      expect(screen.getByText(/Пауза 42 с/)).toBeTruthy();
    });
    expect(useSystemStore.getState().authenticated).toBe(false);
  });
});
