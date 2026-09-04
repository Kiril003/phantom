/**
 * Ціна першого листа мусить бути сказана ДО того, як людина його напише.
 *
 * Виміряно сесією «Система» живим листом на вузлі d420789:
 *   холодна відповідь — **21,6 с**, з них **21,3 с** підняття `qwen2.5:7b`
 *   (4,7 ГБ) у памʼять і лише 0,5 с сама відповідь; гаряча — **833 мс**.
 * Різниця не в моделі й не в мережі, а рівно в тому, чи лежить модель у
 * памʼяті. На склі про це не було ні слова: людина писала лист і двадцять
 * секунд дивилась у тишу, читаючи її як «завис».
 *
 * Напис показуємо ЛИШЕ коли ядро каже, що моделі немає (`/health` бере це
 * з `api/ps`, тобто знає точно) І що відповідатиме саме локальна модель.
 * Ніякого таймера: скільки лишилось, ми не знаємо, а вигадувати не будемо.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('../services/organismApi', () => ({ fetchHealth: vi.fn() }));

import { fetchHealth } from '../services/organismApi';
import { ColdModelNotice } from '../components/chat/ColdModelNotice';

const health = fetchHealth as unknown as ReturnType<typeof vi.fn>;

const base = {
  status: 'ok',
  version: '0.20.0',
  hostname: 'phantom',
  ws_clients: 1,
  esp32_connected: false,
  serial_enabled: true,
  ai_active: 'gemini',
  ai_fallback: 'ollama',
};

describe('напис про холодну модель', () => {
  beforeEach(() => health.mockReset());

  it('модель не в памʼяті й відповідатиме вона → кажемо ціну наперед', async () => {
    health.mockResolvedValue({
      ok: true,
      data: {
        ...base,
        ai_ready: false,
        ai_fallback_ready: true,
        ai_fallback_model_loaded: false,
      },
    });

    render(<ColdModelNotice pollMs={0} />);

    await waitFor(() => expect(screen.getByTestId('cold-model-notice')).toBeTruthy());
    expect(screen.getByText(/піднімаю мозок/)).toBeTruthy();
    // Строк названо, і він з виміру, а не з голови.
    expect(screen.getByText(/до пів хвилини/)).toBeTruthy();
  });

  it('модель уже в памʼяті → напису немає', async () => {
    health.mockResolvedValue({
      ok: true,
      data: {
        ...base,
        ai_ready: false,
        ai_fallback_ready: true,
        ai_fallback_model_loaded: true,
      },
    });

    const { container } = render(<ColdModelNotice pollMs={0} />);

    await waitFor(() => expect(health).toHaveBeenCalled());
    expect(screen.queryByTestId('cold-model-notice')).toBeNull();
    expect(container.textContent).toBe('');
  });

  it('відповідає хмара, не локальна модель → напису немає', async () => {
    // Ціна підняття стосується лише локального рантайму: якщо відповідає
    // Gemini, жодних гігабайтів ніхто не підіймає.
    health.mockResolvedValue({
      ok: true,
      data: { ...base, ai_ready: true, ai_fallback_ready: true, ai_fallback_model_loaded: false },
    });

    render(<ColdModelNotice pollMs={0} />);

    await waitFor(() => expect(health).toHaveBeenCalled());
    expect(screen.queryByTestId('cold-model-notice')).toBeNull();
  });

  it('стан невідомий (null) → мовчимо, а не лякаємо', async () => {
    health.mockResolvedValue({
      ok: true,
      data: { ...base, ai_ready: false, ai_fallback_ready: true, ai_fallback_model_loaded: null },
    });

    render(<ColdModelNotice pollMs={0} />);

    await waitFor(() => expect(health).toHaveBeenCalled());
    expect(screen.queryByTestId('cold-model-notice')).toBeNull();
  });

  it('ядро не відповіло → нічого не стверджуємо', async () => {
    health.mockResolvedValue({ ok: false, reason: 'unreachable' });

    render(<ColdModelNotice pollMs={0} />);

    await waitFor(() => expect(health).toHaveBeenCalled());
    expect(screen.queryByTestId('cold-model-notice')).toBeNull();
  });
});
