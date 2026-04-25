/**
 * Phase 11c.2 — FloatingToolbar Always-On toggle.
 *
 * The toolbar grew a new primary button "Always-On" that:
 *  - reads `voice_always_on_enabled` from settingsStore
 *  - on click, optimistically flips the value in the store and PUTs the
 *    new value to the backend via settingsApi.set
 *  - reverts the optimistic flip if the PUT rejects
 *
 * The Voice button is intentionally NOT involved — it remains a
 * tap-to-talk shortcut that routes to DIALOGUE.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const setMock = vi.fn();
vi.mock('../services/api', async () => {
  const actual = await vi.importActual<typeof import('../services/api')>('../services/api');
  return {
    ...actual,
    settingsApi: {
      ...actual.settingsApi,
      set: (key: string, value: unknown) => setMock(key, value),
    },
  };
});

import { FloatingToolbar } from '../components/core/FloatingToolbar';
import { useSettingsStore } from '../stores/settingsStore';
import { useAuthStore } from '../stores/authStore';
import { useUIStore } from '../stores/uiStore';
import { useSystemStore } from '../stores/systemStore';
import { SystemState } from '@shared/types';

function renderToolbar() {
  return render(
    <MemoryRouter>
      <FloatingToolbar />
    </MemoryRouter>,
  );
}

describe('FloatingToolbar — Always-On toggle (phase 11c.2)', () => {
  beforeEach(() => {
    setMock.mockReset();
    setMock.mockResolvedValue({
      key: 'voice_always_on_enabled',
      value: true,
      requires_restart: false,
    });
    // Reset stores to a known-clean state.
    useSettingsStore.setState({
      categories: [],
      values: { voice_always_on_enabled: false },
      dirty: new Set(),
      loaded: true,
    });
    useAuthStore.setState({
      user: { id: 'u1', username: 'op', role: 'OPERATOR' },
      token: 't',
    } as never);
    useUIStore.setState({
      moreMenuOpen: false,
      pendingVoiceActivation: false,
    } as never);
    useSystemStore.setState({ state: SystemState.SHADOW } as never);
  });

  afterEach(() => {
    useSettingsStore.setState({
      categories: [],
      values: {},
      dirty: new Set(),
      loaded: false,
    });
  });

  it('renders the Always-On button in the primary toolbar', () => {
    renderToolbar();
    const btn = screen.getByLabelText('Always-On');
    expect(btn).toBeTruthy();
    expect(btn.getAttribute('aria-pressed')).toBe('false');
  });

  it('reflects the current voice_always_on_enabled value via aria-pressed', () => {
    useSettingsStore.setState({
      categories: [],
      values: { voice_always_on_enabled: true },
      dirty: new Set(),
      loaded: true,
    });
    renderToolbar();
    const btn = screen.getByLabelText('Always-On');
    expect(btn.getAttribute('aria-pressed')).toBe('true');
  });

  it('on click: flips the store value optimistically and PUTs new value', async () => {
    renderToolbar();
    const btn = screen.getByLabelText('Always-On');

    await act(async () => {
      fireEvent.click(btn);
    });

    // Store flipped optimistically.
    expect(useSettingsStore.getState().values.voice_always_on_enabled).toBe(true);
    // API was called with the new value.
    expect(setMock).toHaveBeenCalledTimes(1);
    expect(setMock).toHaveBeenCalledWith('voice_always_on_enabled', true);
    // Button reflects new state.
    expect(btn.getAttribute('aria-pressed')).toBe('true');
  });

  it('on PUT failure: reverts the optimistic flip', async () => {
    setMock.mockRejectedValueOnce(new Error('boom'));
    renderToolbar();
    const btn = screen.getByLabelText('Always-On');

    await act(async () => {
      fireEvent.click(btn);
      // Let the rejected promise + revert microtask flush.
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(useSettingsStore.getState().values.voice_always_on_enabled).toBe(false);
    expect(btn.getAttribute('aria-pressed')).toBe('false');
  });

  it('toggles back to false when clicked while currently true', async () => {
    useSettingsStore.setState({
      categories: [],
      values: { voice_always_on_enabled: true },
      dirty: new Set(),
      loaded: true,
    });
    renderToolbar();
    const btn = screen.getByLabelText('Always-On');

    await act(async () => {
      fireEvent.click(btn);
    });

    expect(useSettingsStore.getState().values.voice_always_on_enabled).toBe(false);
    expect(setMock).toHaveBeenCalledWith('voice_always_on_enabled', false);
  });
});
