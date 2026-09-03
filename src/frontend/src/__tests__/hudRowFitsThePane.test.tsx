/**
 * Нижній ряд HUD мусить вміщатися в пейн мапи, а кредит карти — читатися.
 *
 * 03.09.2026, кадр справжнім WebKitGTK на 1024×600, стіл «Театр»: панель
 * мапи має 679 px, між рейками лишається 527, а трьом колонкам ряду треба
 * 787. Через `justify-center` переповнення розлазилось у два боки, і скло
 * пошуку (x 128→328) накривало чипс атрибуції (x 76→244) на 116 px —
 * «© OpenStreetMap contributors · Protomaps» читалось як «© Ог / contr /
 * Proton.». Тобто борг ODbL порушувався саме там, де KDoc його декларує.
 *
 * Тут тримаємо дві речі, які можна перевірити без скла:
 *   1) арифметику порогу — з тими самими числами, що виміряні;
 *   2) контракт ширини чипса атрибуції: 168 у колонці, 252 на нижньому
 *      краю, де кредит має лягати одним рядком.
 *
 * Геометрія перекриття — робота e2e в chromium; цей сторож стереже число
 * й причину, щоб їх не «спростили» назад.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { hudIsNarrow, HUD_ROW_NEEDS_PX, HUD_RAILS_PX } from '../components/map/hud/HudShell';
import { AttributionDrawer } from '../components/map/hud/AttributionDrawer';

vi.mock('../hooks/useAttribution', () => ({
  useAttribution: () => ({
    lines: [{ text: '© OpenStreetMap contributors · Protomaps', license: 'ODbL' }],
    error: null,
  }),
}));

describe('нижній ряд HUD і ширина пейна', () => {
  it('стіл «Театр» (пейн 679) — вузько', () => {
    expect(hudIsNarrow(679)).toBe(true);
    expect(679 - HUD_RAILS_PX).toBeLessThan(HUD_ROW_NEEDS_PX);
  });

  it('мапа на весь застосунок (1024) — широко', () => {
    // 1024 − 152 = 872 ≥ 787, тобто повний ряд уміщається як і раніше.
    expect(hudIsNarrow(1024)).toBe(false);
  });

  it('нуль — це «ще не виміряно», а не «вузько»', () => {
    // Перший кадр до ResizeObserver: ширини ще немає. Якщо тут повернути
    // true, застосунок блимне вузькою розкладкою на кожному монтуванні.
    expect(hudIsNarrow(0)).toBe(false);
  });

  it('поріг стоїть рівно там, де виміряно', () => {
    expect(hudIsNarrow(HUD_RAILS_PX + HUD_ROW_NEEDS_PX)).toBe(false);
    expect(hudIsNarrow(HUD_RAILS_PX + HUD_ROW_NEEDS_PX - 1)).toBe(true);
  });
});

describe('чипс атрибуції', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200 })));
  });

  it('типово — 168 px, як у колонці HUD', () => {
    render(<AttributionDrawer pollMs={0} />);
    const btn = screen.getByTestId('attribution-drawer-toggle');
    expect(btn.style.maxWidth).toBe('168px');
  });

  it('на нижньому краю чипсу дають 252 px під один рядок кредиту', () => {
    render(<AttributionDrawer pollMs={0} maxWidthPx={252} />);
    const btn = screen.getByTestId('attribution-drawer-toggle');
    expect(btn.style.maxWidth).toBe('252px');
  });

  it('кредит лишається в DOM повністю, а не обрізаним', () => {
    render(<AttributionDrawer pollMs={0} maxWidthPx={252} />);
    expect(
      screen.getByText('© OpenStreetMap contributors · Protomaps'),
    ).toBeTruthy();
  });
});
