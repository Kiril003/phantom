/**
 * Пейн ДІАЛОГ мусить казати, ХТО відповідає.
 *
 * У чіпі джерела стояв літерал «ядро» — однаковий і для локального
 * `qwen2.5:7b` через Ollama, і для хмарного Gemini за ключем. Для
 * оператора це два різні світи: різна якість і різна ціна приватності
 * (лист, що не виходить із машини, проти листа, що виходить). Знайдено
 * сесією «Система» на склі 03.09.2026.
 *
 * Правило те саме, що в кокпіті: слово — на скло, ідентифікатор — у
 * підказку; джерело правди — `GET /health`, не літерал.
 *
 * Окремо стережемо межу чесності: мовчання ядра НЕ можна показувати як
 * «модель не обрано» — це різні твердження, і друге брехало б про
 * налаштування, яких ми не читали.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('../services/organismApi', () => ({ fetchHealth: vi.fn() }));

import { fetchHealth } from '../services/organismApi';
import { DialogueSourceChip } from '../components/desk/DialogueSourceChip';

const health = fetchHealth as unknown as ReturnType<typeof vi.fn>;

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

describe('чіп джерела діалогу', () => {
  beforeEach(() => health.mockReset());

  it('хмарний провайдер названий словом, ідентифікатор — у підказці', async () => {
    health.mockResolvedValue({ ok: true, data: base });

    render(<DialogueSourceChip />);

    await waitFor(() => expect(screen.getByText('Gemini · хмара · ключ')).toBeTruthy());
    const chip = screen.getByTestId('dialogue-source-chip');
    expect(chip.getAttribute('title')).toContain('ai_active: gemini');
    expect(chip.getAttribute('title')).toContain('запасний: ollama');
    // Літерала «ядро» на склі більше немає.
    expect(chip.textContent).not.toBe('ядро');
  });

  it('локальний провайдер названий локальним', async () => {
    health.mockResolvedValue({ ok: true, data: { ...base, ai_active: 'ollama', ai_fallback: '' } });

    render(<DialogueSourceChip />);

    await waitFor(() => expect(screen.getByText('Ollama · локально')).toBeTruthy());
  });

  it('незнайомий провайдер — на імʼя, без тверджень про місце', async () => {
    health.mockResolvedValue({ ok: true, data: { ...base, ai_active: 'vllm', ai_fallback: '' } });

    render(<DialogueSourceChip />);

    await waitFor(() => expect(screen.getByText('Vllm')).toBeTruthy());
    expect(screen.queryByText(/локально|хмара/)).toBeNull();
  });

  it('ядро відповіло, провайдера немає → «модель не обрано»', async () => {
    health.mockResolvedValue({ ok: true, data: { ...base, ai_active: '', ai_fallback: '' } });

    render(<DialogueSourceChip />);

    await waitFor(() => expect(screen.getByText('модель не обрано')).toBeTruthy());
  });

  it('ядро не відповіло → так і сказано, а НЕ «модель не обрано»', async () => {
    health.mockResolvedValue({ ok: false, reason: 'unreachable' });

    render(<DialogueSourceChip />);

    await waitFor(() => expect(screen.getByText('ядро не відповіло')).toBeTruthy());
    expect(screen.queryByText('модель не обрано')).toBeNull();
  });

  it('поки питаємо — не порожньо', async () => {
    // Обіцянка, яку розвʼязуємо самі: «вічний» промис лишав би висіти
    // воркер vitest після файлу.
    let release: (v: unknown) => void = () => {};
    health.mockReturnValue(new Promise((r) => { release = r; }));

    render(<DialogueSourceChip />);
    expect(screen.getByText('питаю ядро…')).toBeTruthy();

    release({ ok: true, data: base });
    await waitFor(() => expect(screen.getByText('Gemini · хмара · ключ')).toBeTruthy());
  });
});
