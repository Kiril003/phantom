/**
 * Контроль, що відгукується і не робить нічого — найдорожчий клас дефектів
 * у цьому продукті. Тут по одному тесту на кожен випадок, який знайшли
 * пальцем на пристрої.
 *
 * 1. OPERATOR не мав кейса у StateSurface. Це не тільки плитка «Агент»:
 *    ядро само шле цей стан у WS, коли стартує передній план агента
 *    (agent/kernel/runtime.py:738, :878). Плашка ставала «Оператор»,
 *    а під нею лишалась головна.
 * 2. «Створити профіль» вів на /onboarding — маршрут під автентифікацією,
 *    а бачить той екран лише неавтентифікований. Клік = коло.
 * 3. /analytics існував без жодних дверей: рядок трапляється в усьому
 *    фронтенді один раз — у самому визначенні маршруту.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { Suspense } from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SystemState } from '@shared/types';

const navigateSpy = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<object>('react-router-dom');
  return { ...actual, useNavigate: () => navigateSpy };
});

vi.mock('framer-motion', async () => {
  const actual = await vi.importActual<object>('framer-motion');
  return {
    ...actual,
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    motion: new Proxy(
      {},
      {
        get: (_t, key) => (props: Record<string, unknown>) => {
          const { children, ...rest } = props as { children?: React.ReactNode };
          const drop = new Set([
            'whileTap', 'whileHover', 'initial', 'animate', 'exit',
            'transition', 'layout', 'layoutId', 'variants', 'drag',
          ]);
          const cleaned: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(rest)) if (!drop.has(k)) cleaned[k] = v;
          const Tag = key as unknown as keyof JSX.IntrinsicElements;
           
          return <Tag {...(cleaned as any)}>{children}</Tag>;
        },
      },
    ),
  };
});

vi.mock('../layouts/AgentFoundryLayout', () => ({
  default: () => <div data-testid="surface-foundry">МАЙСТЕРНЯ АГЕНТА</div>,
}));
vi.mock('../layouts/ShadowLayout', () => ({
  default: () => <div data-testid="surface-shadow">ГОЛОВНА</div>,
}));
vi.mock('../layouts/DialogueLayout', () => ({ default: () => <div /> }));
vi.mock('../layouts/FocusLayout', () => ({ default: () => <div /> }));
vi.mock('../layouts/SentinelLayout', () => ({ default: () => <div /> }));
vi.mock('../layouts/GhostLayout', () => ({ default: () => <div /> }));
vi.mock('../layouts/DreamLayout', () => ({ default: () => <div /> }));

import { StateSurface } from '../app/App';
import { useSystemStore } from '../stores/systemStore';

const renderSurface = () =>
  render(
    <MemoryRouter>
      <Suspense fallback={<div>…</div>}>
        <StateSurface />
      </Suspense>
    </MemoryRouter>,
  );

describe('дефект 1 — OPERATOR був станом без екрана', () => {
  beforeEach(() => {
    useSystemStore.setState({ state: SystemState.SHADOW });
  });

  it('малює майстерню агента, коли ядро ввело систему в OPERATOR', async () => {
    useSystemStore.setState({ state: SystemState.OPERATOR });
    renderSurface();
    expect(await screen.findByTestId('surface-foundry')).toBeTruthy();
    expect(screen.queryByTestId('surface-shadow')).toBeNull();
  });

  it('не підміняє OPERATOR головною', async () => {
    useSystemStore.setState({ state: SystemState.OPERATOR });
    renderSurface();
    await waitFor(() => expect(screen.queryByTestId('surface-foundry')).toBeTruthy());
    expect(screen.queryByText('ГОЛОВНА')).toBeNull();
  });

  it('лишає SHADOW на головній', async () => {
    renderSurface();
    expect(await screen.findByTestId('surface-shadow')).toBeTruthy();
  });

  it('більше не має скорочень, що ставлять стан без екрана', () => {
    const keys = Object.keys(useSystemStore.getState());
    // goOperator ставив OPERATOR, який нічим не малювався; goDream/goFocus/
    // goDialogue/goGhost не мали викликів і не вели на «/».
    for (const dead of ['goOperator', 'goDream', 'goFocus', 'goDialogue', 'goGhost']) {
      expect(keys).not.toContain(dead);
    }
    expect(keys).toContain('goShadow');
    expect(keys).toContain('goSentinel');
  });
});

describe('дефект 2 — «Створити профіль» вів по колу', () => {
  it('екран «немає профілів» не пропонує неавтентифікований маршрут', async () => {
    vi.resetModules();
    vi.doMock('../services/api', () => ({
      authApi: { picker: vi.fn().mockResolvedValue([]) },
      ApiError: class ApiError extends Error { status = 0; },
    }));
    const { default: LoginScreen } = await import('../components/auth/LoginScreen');
    const { container } = render(
      <MemoryRouter>
        <LoginScreen />
      </MemoryRouter>,
    );

    await screen.findByText('Жодного профілю не видно');
    expect(container.querySelector('a[href="/onboarding"]')).toBeNull();
    expect(container.querySelector('[href*="onboarding"]')).toBeNull();
    expect(screen.queryByText('Створити профіль')).toBeNull();
  });

  it('натомість називає справжнє джерело PIN і дає повтор', async () => {
    vi.resetModules();
    vi.doMock('../services/api', () => ({
      authApi: { picker: vi.fn().mockResolvedValue([]) },
      ApiError: class ApiError extends Error { status = 0; },
    }));
    const { default: LoginScreen } = await import('../components/auth/LoginScreen');
    render(
      <MemoryRouter>
        <LoginScreen />
      </MemoryRouter>,
    );

    await screen.findByText('Жодного профілю не видно');
    expect(screen.getByText(/bootstrap_pin/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Перевірити ще раз/ })).toBeTruthy();
  });
});

describe('дефект 3 — /analytics існував без дверей', () => {
  beforeEach(() => {
    navigateSpy.mockClear();
  });

  it('у Додатках є плитка «Аналітика», і вона веде на /analytics', async () => {
    const { Overlays } = await import('../components/core/Overlays');
    const { useUIStore } = await import('../stores/uiStore');
    useUIStore.getState().toggleOverlay('apps');

    render(
      <MemoryRouter>
        <Overlays />
      </MemoryRouter>,
    );

    const tile = await screen.findByText('Аналітика');
    fireEvent.click(tile);
    expect(navigateSpy).toHaveBeenCalledWith('/analytics');
  });

  it('плитка «Агент» веде в майстерню, а не міняє лише стан', async () => {
    const { Overlays } = await import('../components/core/Overlays');
    const { useUIStore } = await import('../stores/uiStore');
    const before = useSystemStore.getState().state;
    useUIStore.getState().toggleOverlay('apps');

    render(
      <MemoryRouter>
        <Overlays />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByText('Агент'));
    expect(navigateSpy).toHaveBeenCalledWith('/foundry');
    expect(useSystemStore.getState().state).toBe(before);
  });
});
