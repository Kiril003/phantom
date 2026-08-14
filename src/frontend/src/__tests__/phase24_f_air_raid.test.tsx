/**
 * Phase 24-F — AirRaidLayer + useLiveAlerts tests.
 *
 * Перший тест тут раніше звався «renders quiet pill when no alerts received»
 * і закріплював саме ту ваду, заради якої писався шар: доки не прийшло
 * жодного повідомлення, екран показував зелену тишу. Відсутність новин — не
 * спокій; вона тепер «стан невідомий», і решта файлу лишилась як була.
 * Старіння перевіряє `airRaidStaleness.test.tsx`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';

vi.mock('../services/websocket', () => {
  const handlers: Record<string, ((msg: unknown) => void)[]> = {};
  return {
    wsClient: {
      on: vi.fn(
        <T,>(channel: string, handler: (msg: T) => void) => {
          (handlers[channel] = handlers[channel] || []).push(
            handler as (msg: unknown) => void,
          );
          return () => {
            const arr = handlers[channel] || [];
            const idx = arr.indexOf(handler as (msg: unknown) => void);
            if (idx >= 0) arr.splice(idx, 1);
          };
        },
      ),
      __dispatch: (channel: string, msg: unknown) => {
        for (const h of handlers[channel] || []) h(msg);
      },
    },
  };
});

import { wsClient } from '../services/websocket';
import { AirRaidLayer } from '../components/map/layers/AirRaidLayer';

const dispatchAlert = (count: number, oblasts: string[]) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (wsClient as any).__dispatch('map', {
    channel: 'map',
    type: 'alert',
    data: {
      op: 'alert',
      target: 'air_raid_ua',
      payload: {
        layer_id: 'air_raid_ua',
        count,
        feature_collection: {
          type: 'FeatureCollection',
          features: oblasts.map((id) => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [30, 50] },
            properties: { oblast_id: id, oblast_name_ua: id.toUpperCase() },
          })),
        },
      },
    },
  });
};


beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});


describe('AirRaidLayer', () => {
  it('renders the unknown pill before anything has been heard', () => {
    render(<AirRaidLayer />);
    expect(screen.getByTestId('air-raid-unknown')).toBeInTheDocument();
    expect(screen.queryByTestId('air-raid-quiet')).toBeNull();
  });

  it('switches to red overlay after a count>0 alert', () => {
    render(<AirRaidLayer />);
    expect(screen.getByTestId('air-raid-unknown')).toBeInTheDocument();
    act(() => {
      dispatchAlert(2, ['lviv', 'kyiv']);
    });
    const overlay = screen.getByTestId('air-raid-overlay');
    expect(overlay).toHaveAttribute('data-alert-count', '2');
    expect(overlay).toHaveTextContent(/LVIV/);
    expect(overlay).toHaveTextContent(/KYIV/);
  });

  it('truncates oblast list with "+N" when more than 4 alarms', () => {
    render(<AirRaidLayer />);
    act(() => {
      dispatchAlert(6, ['a', 'b', 'c', 'd', 'e', 'f']);
    });
    expect(screen.getByTestId('air-raid-overlay')).toHaveTextContent(/\+2/);
  });

  it('falls back to quiet state when alert clears (count=0)', () => {
    render(<AirRaidLayer />);
    act(() => {
      dispatchAlert(1, ['lviv']);
    });
    expect(screen.getByTestId('air-raid-overlay')).toBeInTheDocument();
    act(() => {
      dispatchAlert(0, []);
    });
    expect(screen.getByTestId('air-raid-quiet')).toBeInTheDocument();
  });

  it('ignores broadcasts for other layers', () => {
    render(<AirRaidLayer />);
    act(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (wsClient as any).__dispatch('map', {
        channel: 'map',
        type: 'alert',
        data: {
          op: 'alert',
          target: 'frontline',
          payload: {
            layer_id: 'frontline',
            count: 3,
            feature_collection: { type: 'FeatureCollection', features: [] },
          },
        },
      });
    });
    expect(screen.getByTestId('air-raid-unknown')).toBeInTheDocument();
  });
});
