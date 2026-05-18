/**
 * Phase 9.4c audit G3 — InnerMonologueStream subscribes to the
 * `inner_monologue.stream` WS channel and renders the rolling log.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { InnerMonologueStream } from '../components/agent/status/InnerMonologueStream';

type Handler = (msg: { channel: string; type: string; data: unknown }) => void;

vi.mock('../services/websocket', () => {
  const handlers: Handler[] = [];
  return {
    wsClient: {
      on: vi.fn((channel: string, handler: Handler) => {
        if (channel === 'inner_monologue.stream') handlers.push(handler);
        return () => {
          const i = handlers.indexOf(handler);
          if (i >= 0) handlers.splice(i, 1);
        };
      }),
      __deliver: (payload: unknown) => {
        handlers.forEach((h) =>
          h({ channel: 'inner_monologue.stream', type: 'plan', data: payload }),
        );
      },
      __handlers: handlers,
    },
  };
});

import { wsClient } from '../services/websocket';

describe('InnerMonologueStream', () => {
  beforeEach(() => {
    // Reset handlers between tests.
    (wsClient as unknown as { __handlers: Handler[] }).__handlers.length = 0;
  });
  afterEach(() => cleanup());

  it('subscribes on mount and unsubscribes on unmount', () => {
    const { unmount } = render(<InnerMonologueStream />);
    expect(wsClient.on).toHaveBeenCalledWith(
      'inner_monologue.stream',
      expect.any(Function),
    );
    expect(
      (wsClient as unknown as { __handlers: Handler[] }).__handlers.length,
    ).toBe(1);
    unmount();
    expect(
      (wsClient as unknown as { __handlers: Handler[] }).__handlers.length,
    ).toBe(0);
  });

  it('renders a monologue event as an entry in the log', () => {
    render(<InnerMonologueStream />);
    act(() => {
      (wsClient as unknown as { __deliver: (p: unknown) => void }).__deliver({
        kind: 'plan',
        source: 'tactical',
        monologue: { what_i_plan: 'Plan a route to the park' },
        ts: '2026-04-20T09:00:00.000Z',
        task_id: 't-1',
      });
    });
    const entries = screen.getAllByTestId('monologue-entry');
    expect(entries.length).toBe(1);
    expect(entries[0].textContent || '').toMatch(/Plan a route to the park/);
    expect(entries[0].textContent || '').toMatch(/plan/i);
  });
});
