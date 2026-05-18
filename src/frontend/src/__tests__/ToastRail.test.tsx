import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import { ToastRail } from '../components/core/ToastRail';
import { useUIStore } from '../stores/uiStore';

describe('ToastRail', () => {
  beforeEach(() => {
    useUIStore.setState({ toasts: [] });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing when there are no toasts', () => {
    const { container } = render(<ToastRail />);
    // The shell <div> remains, but no <button role="alert">.
    expect(container.querySelector('button[role="alert"]')).toBeNull();
  });

  it('renders a toast added via store.toast()', () => {
    const { container } = render(<ToastRail />);
    act(() => {
      useUIStore.getState().toast({ kind: 'error', message: 'boom' });
    });
    const btn = container.querySelector('button[role="alert"]');
    expect(btn).not.toBeNull();
    expect(btn!.textContent).toContain('boom');
  });

  it('auto-dismisses after 3s', () => {
    const { container } = render(<ToastRail />);
    act(() => {
      useUIStore.getState().toast({ kind: 'info', message: 'gone soon' });
    });
    expect(container.querySelector('button[role="alert"]')).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(3001);
    });
    expect(useUIStore.getState().toasts).toHaveLength(0);
  });

  it('renders multiple toasts in insertion order', () => {
    const { container } = render(<ToastRail />);
    act(() => {
      useUIStore.getState().toast({ kind: 'info', message: 'first' });
      useUIStore.getState().toast({ kind: 'warn', message: 'second' });
    });
    const buttons = container.querySelectorAll('button[role="alert"]');
    expect(buttons).toHaveLength(2);
    expect(buttons[0].textContent).toContain('first');
    expect(buttons[1].textContent).toContain('second');
  });
});

// vitest exposes afterEach in its own scope but TS may not know — bring it in.
import { afterEach } from 'vitest';
