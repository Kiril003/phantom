/**
 * Памʼять без моделі мусить сказати це сама — і словами ядра.
 *
 * Довготривала памʼять тримається на моделі вкладень. Без неї підсистема
 * не падає й не скаржиться: вона просто нічого не запамʼятовує. Людина
 * відкриває «ШІ та памʼять», бачить налаштування памʼяті — і вважає, що
 * памʼять є. Це тиха неправда, і саме її закриває цей напис.
 *
 * Ядро (Сесія 5, 604bef9) віддає `GET /health` → `memory_model.reason` —
 * готове речення українською. Фронт його НЕ переписує: ядро знає, яку
 * модель шукали, де і чи дозволено її тягнути.
 *
 * Три речі під сторожем:
 *   present=false → на склі рівно текст із `reason`;
 *   present=true  → нічого (справний стан не потребує напису);
 *   старе ядро без поля → нічого (стану не знаємо — не вигадуємо).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('../services/organismApi', () => ({
  fetchHealth: vi.fn(),
}));

import { fetchHealth } from '../services/organismApi';
import { MemoryModelNotice } from '../components/settings/MemoryModelNotice';

const health = fetchHealth as unknown as ReturnType<typeof vi.fn>;

const REASON =
  'Модель памʼяті intfloat/multilingual-e5-small не встановлена. ' +
  'Довготривала памʼять нічого не запамʼятає, доки її немає. ' +
  'У мережу по неї сам не піду: дозволь явно або постав модель поруч.';

const base = {
  status: 'ok',
  version: '0.1.0',
  hostname: 'phantom',
  ws_clients: 1,
  esp32_connected: false,
  serial_enabled: true,
  ai_active: 'gemini',
  ai_fallback: 'ollama',
};

describe('напис про модель памʼяті', () => {
  beforeEach(() => health.mockReset());

  it('моделі немає → на склі речення ядра, дослівно', async () => {
    health.mockResolvedValue({
      ok: true,
      data: {
        ...base,
        memory_model: {
          model: 'intfloat/multilingual-e5-small',
          present: false,
          path: '/home/kyrylo/.cache/huggingface/hub',
          download_allowed: false,
          reason: REASON,
        },
      },
    });

    render(<MemoryModelNotice />);

    await waitFor(() => expect(screen.getByTestId('memory-model-notice')).toBeTruthy());
    expect(screen.getByText(REASON)).toBeTruthy();
    // Це стан, а не аварія: слова «помилка» тут бути не повинно.
    expect(screen.queryByText(/помилка/i)).toBeNull();
  });

  it('модель є → жодного напису', async () => {
    health.mockResolvedValue({
      ok: true,
      data: {
        ...base,
        memory_model: {
          model: 'intfloat/multilingual-e5-small',
          present: true,
          path: '/home/kyrylo/.cache/huggingface/hub',
          download_allowed: false,
          reason: null,
        },
      },
    });

    const { container } = render(<MemoryModelNotice />);

    await waitFor(() => expect(health).toHaveBeenCalled());
    expect(screen.queryByTestId('memory-model-notice')).toBeNull();
    expect(container.textContent).toBe('');
  });

  it('старе ядро без поля → нічого не вигадуємо', async () => {
    health.mockResolvedValue({ ok: true, data: { ...base } });

    render(<MemoryModelNotice />);

    await waitFor(() => expect(health).toHaveBeenCalled());
    expect(screen.queryByTestId('memory-model-notice')).toBeNull();
  });

  it('ядро не відповіло → нічого (мовчання не є твердженням)', async () => {
    health.mockResolvedValue({ ok: false, reason: 'unreachable' });

    render(<MemoryModelNotice />);

    await waitFor(() => expect(health).toHaveBeenCalled());
    expect(screen.queryByTestId('memory-model-notice')).toBeNull();
  });
});
