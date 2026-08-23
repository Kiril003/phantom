/**
 * Ф1 гонтлет №1, У8+У9 — палітра Ctrl+K:
 *  - таксономія: чотири розділи-іменники в одному порядку, «Небезпечне»
 *    завжди останнє;
 *  - розрізненність: «Стіл: Компанія» несе вміст стола підказкою,
 *    «Компанія» (перехід) — наслідок «відкрити пейн на активному столі»;
 *  - деструктивне: «Вийти з сесії» НЕ виконується одним Enter'ом —
 *    перший озброює confirm-стан рядка, другий виконує; Esc і відхід
 *    курсора скасовують підтвердження, не палітру.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import CommandBar from '../components/command/CommandBar';
import { buildCommands, SECTION_ORDER } from '../components/command/commands';
import { useSystemStore } from '../stores/systemStore';
import { useAuthStore } from '../stores/authStore';

function openPalette() {
  render(<CommandBar />);
  fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
  return screen.getByLabelText('Пошук команди');
}

describe('палітра: таксономія розділів (У9)', () => {
  afterEach(() => cleanup());

  it('чотири розділи-іменники; «Небезпечне» — останнє', () => {
    expect(SECTION_ORDER).toEqual(['Столи', 'Переходи', 'Дії', 'Небезпечне']);
    openPalette();
    const dialog = screen.getByRole('dialog');
    const headers = SECTION_ORDER.map((s) => screen.getByText(s));
    // Порядок у DOM відповідає порядку розділів.
    for (let i = 1; i < headers.length; i++) {
      const pos = headers[i - 1].compareDocumentPosition(headers[i]);
      expect(pos & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    // Старої назви-дієслова «Перейти» не існує.
    expect(dialog.textContent).not.toContain('Перейти');
  });

  it('рядки «компан» розрізняються ефектом: вміст стола проти наслідку переходу', () => {
    const input = openPalette();
    fireEvent.change(input, { target: { value: 'компан' } });
    // Підсвітка збігу дробить назву на посимвольні span-и, тож accessible
    // name містить пробіли між літерами — порівнюємо без пропусків.
    const flat = (n: string) => n.replace(/\s+/g, '');
    // Перехід несе наслідок дії словами.
    const nav = screen.getByRole('button', {
      name: (n) => flat(n) === flat('Компанія відкрити пейн на активному столі'),
    });
    expect(nav).toBeTruthy();
    // Рядок стола несе вміст стола підказкою (стіл «Компанія» = пейн Компанія).
    const desk = screen.getByRole('button', {
      name: (n) => flat(n).startsWith(flat('Стіл: Компанія')),
    });
    expect(flat(desk.textContent ?? '')).toContain('Компанія');
    expect(desk).not.toBe(nav);
  });

  it('кожен перехід і кожен стіл несуть підказку', () => {
    const items = buildCommands({ close: () => {} });
    for (const item of items) {
      if (item.section === 'Переходи') {
        expect(item.hint).toBe('відкрити пейн на активному столі');
      }
      if (item.section === 'Столи') {
        expect(item.hint, `стіл ${item.title} без підказки вмісту`).toBeTruthy();
      }
    }
  });
});

describe('палітра: «Вийти з сесії» вимагає другого Enter (У8)', () => {
  beforeEach(() => {
    useSystemStore.setState({ authenticated: true });
    useAuthStore.setState({ sessionPhase: 'in' });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('живе в розділі «Небезпечне», не серед тем', () => {
    const items = buildCommands({ close: () => {} });
    const signOut = items.find((i) => i.id === 'action:sign-out');
    expect(signOut?.section).toBe('Небезпечне');
    expect(signOut?.danger).toBe(true);
    // Останній пункт списку — деструктивне завжди внизу.
    expect(items[items.length - 1].id).toBe('action:sign-out');
  });

  it('перший Enter озброює confirm-стан, другий — виконує вихід', () => {
    const input = openPalette();
    fireEvent.change(input, { target: { value: 'вийти' } });

    // Один нечіткий пошук + Enter (у рукавицях) — НЕ розлогінює.
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(useSystemStore.getState().authenticated).toBe(true);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('Точно вийти? Enter — підтвердити')).toBeTruthy();

    // Другий Enter — свідоме підтвердження: сесія закривається.
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(useSystemStore.getState().authenticated).toBe(false);
    expect(useAuthStore.getState().sessionPhase).toBe('out');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Esc у confirm-стані скасовує підтвердження, а не палітру', () => {
    const input = openPalette();
    fireEvent.change(input, { target: { value: 'вийти' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText('Точно вийти? Enter — підтвердити')).toBeTruthy();

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.queryByText('Точно вийти? Enter — підтвердити')).toBeNull();
    expect(useSystemStore.getState().authenticated).toBe(true);

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('відхід курсора з озброєного рядка скасовує підтвердження', () => {
    const input = openPalette();
    fireEvent.change(input, { target: { value: 'вийти' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText('Точно вийти? Enter — підтвердити')).toBeTruthy();

    // Зміна запиту (і позиції курсора) знімає зведення.
    fireEvent.change(input, { target: { value: 'тема' } });
    expect(screen.queryByText('Точно вийти? Enter — підтвердити')).toBeNull();
    expect(useSystemStore.getState().authenticated).toBe(true);
  });
});
