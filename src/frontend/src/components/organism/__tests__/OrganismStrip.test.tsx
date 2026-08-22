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

  it('Ctrl+K відкриває палітру; «Перейти» — рівно п\'ять входів', () => {
    render(<CommandBar />);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(screen.getByRole('dialog')).toBeTruthy();
    for (const title of ['Мапа', 'Діалог', 'Компанія', 'Налаштування', 'Аналітика']) {
      expect(screen.getByText(title)).toBeTruthy();
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
    // Підсвітка збігу дробить назву на посимвольні span-и — шукаємо
    // за accessible name кнопки, а не суцільним текстом.
    expect(screen.getByRole('button', { name: 'Мапа' })).toBeTruthy();
    expect(screen.queryByText('Налаштування')).toBeNull();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
