/**
 * OrganismStrip + CommandBar — standalone-збірка без монтажу desk-engine
 * (Ф1, демо-перевірка): компоненти рендеряться самі по собі, стрічка
 * чесно мовчить на мертвих джерелах, палітра відкривається з Ctrl+K
 * і містить рівно п'ять входів «Перейти».
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import OrganismStrip from '../OrganismStrip';
import CommandBar from '../../command/CommandBar';

describe('standalone-збірка Ф1', () => {
  const fetchMock = vi.fn<() => Promise<Response>>();

  beforeEach(() => {
    fetchMock.mockReset();
    // Усі джерела мертві — мережевий збій на кожен фетч.
    fetchMock.mockRejectedValue(new TypeError('failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('стрічка рендериться сама і мовчить сірим, не нулями', async () => {
    await act(async () => {
      render(<OrganismStrip />);
    });
    // Слова пульсів на місці.
    expect(screen.getByText('вузол')).toBeTruthy();
    expect(screen.getByText('канал')).toBeTruthy();
    expect(screen.getByText('ядро')).toBeTruthy();
    expect(screen.getByText('ресурси')).toBeTruthy();
    // Мертві джерела — «мовчить», жодного вигаданого числа.
    expect(screen.getAllByText('мовчить').length).toBeGreaterThanOrEqual(2);
    // Слово стану машини видиме (дефолт стора — Тінь).
    expect(screen.getByText('Тінь')).toBeTruthy();
  });

  it('живе ядро не друкує ланцюг ШІ-провайдерів (У10: пульси, не архітектура)', async () => {
    // /health відповідає, решта джерел мертві.
    fetchMock.mockImplementation(async (url?: unknown) => {
      if (String(url) === '/health') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            status: 'ok',
            version: '1.2.3',
            hostname: 'phantom',
            ws_clients: 2,
            esp32_connected: false,
            serial_enabled: false,
            ai_active: 'gemini',
            ai_fallback: 'ollama',
          }),
        } as Response;
      }
      throw new TypeError('failed to fetch');
    });
    await act(async () => {
      render(<OrganismStrip />);
    });
    // Машинні пульси на місці…
    expect(screen.getByText(/v1\.2\.3 · кл 2/)).toBeTruthy();
    // …а ланцюг провайдерів зі стрічки виїхав у кокпіт: людині за плечем
    // стрічка не розповідає, куди ходять діалоги.
    expect(screen.queryByText(/ШІ/)).toBeNull();
    expect(screen.queryByText(/gemini/)).toBeNull();
    expect(screen.queryByText(/ollama/)).toBeNull();
  });

  it('клік по слову стану відкриває тихе меню з єдиним «Привид»', async () => {
    await act(async () => {
      render(<OrganismStrip />);
    });
    fireEvent.click(screen.getByText('Тінь'));
    const menu = screen.getByRole('menu');
    const items = menu.querySelectorAll('[role="menuitem"]');
    expect(items.length).toBe(1);
    expect(items[0].textContent).toBe('Привид');
  });

  it('Ctrl+K відкриває палітру; «Переходи» — рівно п\'ять входів', () => {
    render(<CommandBar />);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(screen.getByRole('dialog')).toBeTruthy();
    // getAllByText: «Компанія» живе і назвою пейна, і вмістом стола в
    // підказці рядка «Стіл: Компанія» (У9 — вміст стола підказкою).
    for (const title of ['Мапа', 'Діалог', 'Компанія', 'Налаштування', 'Аналітика']) {
      expect(screen.getAllByText(title).length).toBeGreaterThanOrEqual(1);
    }
    // Заборонені входи (вердикт власника) відсутні.
    for (const banned of ['Воля', 'Вартовий', 'Привид', 'Система']) {
      expect(screen.queryByText(banned)).toBeNull();
    }
    // «Стоп усій Компанії» не існує — глобальної шини зупинки нема.
    expect(screen.queryByText('Стоп усій Компанії')).toBeNull();
  });

  it('нечіткий пошук звужує список, Esc закриває', () => {
    render(<CommandBar />);
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const input = screen.getByLabelText('Пошук команди');
    fireEvent.change(input, { target: { value: 'мапа' } });
    // Підсвітка збігу дробить назву на посимвольні span-и (accessible
    // name отримує пробіли між літерами) — порівнюємо без пропусків;
    // ім'я тепер несе і підказку-наслідок переходу.
    expect(
      screen.getByRole('button', {
        name: (n) => n.replace(/\s+/g, '').startsWith('Мапа'),
      }),
    ).toBeTruthy();
    expect(screen.queryByText('Налаштування')).toBeNull();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
