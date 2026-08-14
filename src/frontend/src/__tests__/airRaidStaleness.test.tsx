/**
 * Що показує екран через 0 с, 2 хв і 10 хв після останнього підтвердження.
 *
 * Шар малював «тиша по Україні» зеленим одразу після монтування — ще не
 * почувши від бекенда жодного слова — і тримав ту зелень скільки завгодно
 * довго. Тобто зелень означала «повідомлень не було», а читалась як
 * «перевірено, безпечно». Це «тиша ≠ безпека» в найбуквальнішій формі.
 *
 * Тести дивляться на DOM, а не на те, що функція щось повернула: беруть
 * саме той чіп, який побачить оператор, і читають його текст.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

type MapHandler = (msg: { type: string; data: Record<string, unknown> }) => void;
const handlers: MapHandler[] = [];

vi.mock('../services/websocket', () => ({
  wsClient: {
    on: (_channel: string, handler: MapHandler) => {
      handlers.push(handler);
      return () => {
        const i = handlers.indexOf(handler);
        if (i >= 0) handlers.splice(i, 1);
      };
    },
    send: () => {},
    connect: () => {},
    disconnect: () => {},
  },
}));

vi.mock('../services/api', () => ({
  request: () => new Promise(() => {}),
}));

import { AirRaidLayer } from '../components/map/layers/AirRaidLayer';

function observed(count: number): void {
  act(() => {
    handlers.forEach((h) =>
      h({
        type: 'map',
        data: {
          op: 'layer_observed',
          target: 'air_raid_ua',
          payload: { layer_id: 'air_raid_ua', observed_at: Date.now() / 1000, count },
        },
      }),
    );
  });
}

function alerted(names: string[]): void {
  act(() => {
    handlers.forEach((h) =>
      h({
        type: 'map',
        data: {
          op: 'alert',
          target: 'air_raid_ua',
          payload: {
            count: names.length,
            feature_collection: {
              type: 'FeatureCollection',
              features: names.map((name) => ({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [30, 50] },
                properties: { oblast_name_ua: name },
              })),
            },
          },
        },
      }),
    );
  });
}

// Чіп перемальовується раз на секунду, тож поріг спрацьовує в межах
// наступного такту — числа тут кратні секунді навмисно.
function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe('шар тривоги старіє несиметрично', () => {
  beforeEach(() => {
    handlers.length = 0;
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-14T09:14:00'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('до першого підтвердження показує «стан невідомий», а не зелену тишу', () => {
    render(<AirRaidLayer />);
    expect(screen.getByTestId('air-raid-unknown').textContent).toContain('стан невідомий');
    expect(screen.queryByTestId('air-raid-quiet')).toBeNull();
    expect(screen.getByTestId('air-raid-unknown').textContent).toContain(
      'дані не надходили',
    );
  });

  it('0 с після підтвердженого спокою — зелена тиша з міткою часу', () => {
    render(<AirRaidLayer />);
    observed(0);
    const chip = screen.getByTestId('air-raid-quiet');
    expect(chip.textContent).toContain('тиша по Україні');
    expect(chip.textContent).toContain('станом на 09:14');
  });

  it('2 хв без підтвердження — спокій уже не зелений, а «стан невідомий»', () => {
    render(<AirRaidLayer />);
    observed(0);
    advance(121_000);
    expect(screen.queryByTestId('air-raid-quiet')).toBeNull();
    const chip = screen.getByTestId('air-raid-unknown');
    expect(chip.textContent).toContain('стан невідомий');
    expect(chip.textContent).toContain('станом на 09:14');
    expect(chip.textContent).toContain('2 хв тому');
  });

  it('спокій живе рівно до порога, не довше', () => {
    render(<AirRaidLayer />);
    observed(0);
    advance(119_000);
    expect(screen.getByTestId('air-raid-quiet')).toBeTruthy();
    advance(2_000);
    expect(screen.queryByTestId('air-raid-quiet')).toBeNull();
  });

  it('тривога тієї ж давності лишається на екрані — помилка в бік безпеки', () => {
    render(<AirRaidLayer />);
    alerted(['Харківська', 'Сумська']);
    advance(121_000);
    const chip = screen.getByTestId('air-raid-overlay');
    expect(chip.getAttribute('data-alert-state')).toBe('active');
    expect(chip.textContent).toContain('Харківська');
  });

  it('10 хв — тривога ще видна, але видимо стара', () => {
    render(<AirRaidLayer />);
    alerted(['Харківська']);
    advance(601_000);
    const chip = screen.getByTestId('air-raid-overlay');
    expect(chip.getAttribute('data-alert-state')).toBe('active_stale');
    expect(chip.textContent).toContain('10 хв тому');
    expect(chip.className).toContain('border-dashed');
  });

  it('тривога ніколи не тихне сама — застаріла лишається тривогою', () => {
    render(<AirRaidLayer />);
    alerted(['Харківська']);
    advance(6 * 60 * 60 * 1000);
    expect(screen.queryByTestId('air-raid-quiet')).toBeNull();
    expect(screen.getByTestId('air-raid-overlay').textContent).toContain('6 год тому');
  });

  it('відбій після тривоги знову зелений — але тільки поки свіжий', () => {
    render(<AirRaidLayer />);
    alerted(['Харківська']);
    advance(1_000);
    observed(0);
    expect(screen.getByTestId('air-raid-quiet')).toBeTruthy();
    advance(121_000);
    expect(screen.getByTestId('air-raid-unknown')).toBeTruthy();
  });

  it('підтвердження без геометрії все одно оголошує тривогу', () => {
    render(<AirRaidLayer />);
    observed(3);
    const chip = screen.getByTestId('air-raid-overlay');
    expect(chip.getAttribute('data-alert-count')).toBe('3');
  });
});
