/**
 * Месенджер мусить бути ДОСЯЖНИМ із головного екрана.
 *
 * 12.09.2026: маршрут `/messenger` існував і вів на `MessengerLayout`, але
 * по всьому `src/frontend/src` рядок «/messenger» траплявся у ролі шляху
 * рівно двічі — `StatusBar.tsx:119` і `FloatingToolbar.tsx:254`, і обидва
 * рази це було `location.pathname.startsWith(...)`, тобто читання «де ми
 * зараз», а не перехід. Жодна кнопка, жодне посилання, жодний рядок
 * палітри туди не вів, а у вікні Tauri немає адресного рядка. Поверхня на
 * 80 тисяч рядків була недосяжна за побудовою.
 *
 * Цей сторож НЕ грепає файлів: він піднімає справжній екран оболонки
 * (`DeskIndex` + смуга столів із `DashboardLayout`), тисне на те, що
 * бачить людина, і вимагає, щоб месенджер з'явився. Він почервоніє, якщо
 * дорогу приберуть будь-де по ланцюгу: пресет стола, `PaneKind`, реєстр
 * пейнів, смуга столів, поверхня стола.
 *
 * Про jsdom: підмінено лише те, чого в ньому НЕМА як явища —
 * `getBoundingClientRect` (немає рушія розкладки, тож поверхня стола
 * міряла б 0×0 і не намалювала б жодної плитки) і важкі бібліотеки
 * анімації. Жодна поведінка продукту не підмінена.
 */

import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

vi.mock('framer-motion', () => {
  const MOTION_PROPS = new Set([
    'initial',
    'animate',
    'exit',
    'transition',
    'variants',
    'whileHover',
    'whileTap',
    'whileInView',
    'layout',
    'layoutId',
  ]);
  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    motion: new Proxy(
      {},
      {
        get: (_t, tag: string) =>
          React.forwardRef((props: Record<string, unknown>, ref) => {
            const clean: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(props)) {
              if (!MOTION_PROPS.has(k)) clean[k] = v;
            }
            return React.createElement(tag, { ...clean, ref });
          }),
      },
    ),
  };
});

// Стрічка організму ходить у мережу щосекунди — для питання «чи є дорога»
// вона нічого не важить, а в jsdom лише шумить таймерами.
vi.mock('../components/desk/IntegrationMounts', () => ({
  OrganismStripMount: () => null,
  CommandBarMount: () => null,
}));

import { DeskIndex } from '../app/App';
import DashboardLayout from '../layouts/DashboardLayout';
import { useDeskStore } from '../stores/deskStore';
import { PANE_REGISTRY } from '../components/desk/paneRegistry';

/** jsdom не має рушія розкладки: без цього поверхня стола міряє 0×0. */
function giveJsdomALayout(width = 1440, height = 800) {
  Element.prototype.getBoundingClientRect = function () {
    return {
      width,
      height,
      top: 0,
      left: 0,
      right: width,
      bottom: height,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;
  };
}

function renderShell() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<DashboardLayout />}>
          <Route index element={<DeskIndex />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('месенджер досяжний із головного екрана', () => {
  beforeEach(() => {
    giveJsdomALayout();
    // Свіжий вузол: жодних збережених столів.
    localStorage.clear();
    useDeskStore.setState({ activeDeskId: 'theatre' });
  });

  it('один клік у смузі столів відкриває поверхню месенджера', async () => {
    renderShell();

    // Головний екран: смуга столів — єдина навігація, яку видно завжди.
    const strip = screen.getByRole('navigation', { name: 'Столи' });
    const words = Array.from(strip.querySelectorAll('button')).map((b) =>
      (b.textContent ?? '').trim(),
    );

    // На старті месенджера на екрані немає — інакше тест нічого не доводить.
    expect(screen.queryByRole('region', { name: 'Месенджер' })).toBeNull();

    const door = Array.from(strip.querySelectorAll('button')).find((b) =>
      (b.textContent ?? '').trim() === 'Розмови',
    );
    expect(
      door,
      `у смузі столів немає дороги в месенджер; є лише: ${words.join(', ')}`,
    ).toBeDefined();

    fireEvent.click(door as HTMLButtonElement);

    // Рівно один клік — і поверхня месенджера на столі.
    await waitFor(() => {
      expect(screen.getByRole('region', { name: 'Месенджер' })).toBeTruthy();
    });
  });

  it('за пейном месенджера стоїть справжня поверхня, а не порожнеча', async () => {
    const def = PANE_REGISTRY.messenger;
    expect(def.title).toBe('Месенджер');
    // Content === null у цьому реєстрі означає чесне «Порожньо» словом —
    // для месенджера це була б та сама недосяжність, лише з підписом.
    expect(def.Content).not.toBeNull();

    const mod = await import('../layouts/MessengerLayout');
    expect(typeof mod.default).toBe('function');
  }, 60_000);

  it('стіл «Розмови» доїжджає і до власника, у якого вже є збережені столи', () => {
    // Пресет, якого ще нема в сховищі, домерджується — інакше апгрейд
    // лишив би саме тих, хто вже користувався ПК, без дороги.
    localStorage.setItem(
      'phantom.desks.v1',
      JSON.stringify({
        desks: [{ id: 'theatre', name: 'Театр', panes: [] }],
        activeDeskId: 'theatre',
      }),
    );
    vi.resetModules();
    return import('../stores/deskStore').then(({ useDeskStore: fresh }) => {
      const ids = fresh.getState().desks.map((d) => d.id);
      expect(ids).toContain('talks');
    });
  });
});
