/**
 * Ф1 гонтлет №1, У13: таби смуги столів були 28px і на тач-екрані —
 * нижчі за власну непорушну доктрину «touch targets min 44×44px»
 * (CLAUDE.md, правило №2). Смуга мусить читати первинний вказівник:
 * точний (миша) — компактні 28px, грубий (палець) — повноцінні 44px.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { DeskStrip, DESK_STRIP_H, DESK_STRIP_TOUCH_H } from '../components/desk/DeskStrip';

function stubPointer(coarse: boolean) {
  const mql = (query: string) => ({
    matches: query.includes('pointer: coarse') ? coarse : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
  vi.stubGlobal('matchMedia', mql);
  Object.defineProperty(window, 'matchMedia', {
    value: mql,
    writable: true,
    configurable: true,
  });
}

describe('смуга столів: тач-цілі ≥44px (У13)', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('грубий вказівник (тач): смуга 44px, таби з minWidth 44px', () => {
    stubPointer(true);
    render(<DeskStrip />);
    const nav = screen.getByRole('navigation', { name: 'Столи' });
    expect(nav.style.height).toBe(`${DESK_STRIP_TOUCH_H}px`);
    expect(DESK_STRIP_TOUCH_H).toBeGreaterThanOrEqual(44);
    const tabs = nav.querySelectorAll('button');
    expect(tabs.length).toBeGreaterThan(0);
    for (const tab of Array.from(tabs)) {
      expect(tab.style.minWidth).toBe('44px');
    }
  });

  it('точний вказівник (миша): смуга лишається компактною 28px', () => {
    stubPointer(false);
    render(<DeskStrip />);
    const nav = screen.getByRole('navigation', { name: 'Столи' });
    expect(nav.style.height).toBe(`${DESK_STRIP_H}px`);
  });

  it('без matchMedia (jsdom/старий WebView) — чесний компакт, не падіння', () => {
    // @ts-expect-error — навмисно прибираємо matchMedia.
    delete window.matchMedia;
    render(<DeskStrip />);
    const nav = screen.getByRole('navigation', { name: 'Столи' });
    expect(nav.style.height).toBe(`${DESK_STRIP_H}px`);
  });
});
