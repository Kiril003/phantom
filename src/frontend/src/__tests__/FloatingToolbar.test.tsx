/**
 * Phase 12.0 — FloatingToolbar voice-mode cycle.
 *
 * The toolbar's voice-mode button cycles voice_mode through
 *   off → continuous → wake_word → off
 * Each click optimistically flips the local store and PUTs the new value
 * via settingsApi.set; on rejection the optimistic flip is reverted so the
 * button reflects backend truth.
 *
 * The Voice button (push-to-talk shortcut) is unrelated — it routes to
 * DIALOGUE and is unaffected by this cycle.
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

describe('FloatingToolbar — Voice mode cycle (Phase 12.0)', () => {
  beforeEach(() => {
    setMock.mockReset();
    setMock.mockResolvedValue({
      key: 'voice_mode',
      value: 'continuous',
      requires_restart: false,
    });
    useSettingsStore.setState({
      categories: [],
      values: { voice_mode: 'off' },
      dirty: new Set(),
      loaded: true,
    });
    useAuthStore.setState({
      user: { id: 'u1', username: 'op', role: 'OPERATOR' },
      token: 't',
    } as never);
    // phase-5 R1 — Voice mode lives in the secondary "more" overlay
    // after the StatusBar repaint redesign moved it out of the primary
    // pill row. Open the menu in test fixtures so getByLabelText finds
    // the secondary action.
    useUIStore.setState({
      moreMenuOpen: true,
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

  it('renders the voice-mode button as enabled, off-state by default', () => {
    renderToolbar();
    const btn = screen.getByLabelText('Voice mode') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    expect(btn.disabled).toBe(false);
    // off-state → not active
    expect(btn.getAttribute('aria-pressed')).toBe('false');
  });

  it('cycles off → continuous on first click', async () => {
    renderToolbar();
    const btn = screen.getByLabelText('Voice mode');
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(setMock).toHaveBeenCalledWith('voice_mode', 'continuous');
    expect(useSettingsStore.getState().values.voice_mode).toBe('continuous');
  });

  it('cycles continuous → wake_word on next click', async () => {
    useSettingsStore.setState({
      categories: [],
      values: { voice_mode: 'continuous' },
      dirty: new Set(),
      loaded: true,
    });
    renderToolbar();
    const btn = screen.getByLabelText('Voice mode');
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(setMock).toHaveBeenCalledWith('voice_mode', 'wake_word');
    expect(useSettingsStore.getState().values.voice_mode).toBe('wake_word');
  });

  it('cycles wake_word → off on third click', async () => {
    useSettingsStore.setState({
      categories: [],
      values: { voice_mode: 'wake_word' },
      dirty: new Set(),
      loaded: true,
    });
    renderToolbar();
    const btn = screen.getByLabelText('Voice mode');
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(setMock).toHaveBeenCalledWith('voice_mode', 'off');
    expect(useSettingsStore.getState().values.voice_mode).toBe('off');
  });

  it('shows aria-pressed=true when mode is continuous', () => {
    useSettingsStore.setState({
      categories: [],
      values: { voice_mode: 'continuous' },
      dirty: new Set(),
      loaded: true,
    });
    renderToolbar();
    const btn = screen.getByLabelText('Voice mode');
    expect(btn.getAttribute('aria-pressed')).toBe('true');
  });

  it('shows aria-pressed=true when mode is wake_word', () => {
    useSettingsStore.setState({
      categories: [],
      values: { voice_mode: 'wake_word' },
      dirty: new Set(),
      loaded: true,
    });
    renderToolbar();
    const btn = screen.getByLabelText('Voice mode');
    expect(btn.getAttribute('aria-pressed')).toBe('true');
  });

  it('reverts the optimistic flip when the PUT rejects', async () => {
    setMock.mockReset();
    setMock.mockRejectedValue(new Error('500'));
    renderToolbar();
    const btn = screen.getByLabelText('Voice mode');
    await act(async () => {
      fireEvent.click(btn);
      // give the rejection a tick to land
      await Promise.resolve();
      await Promise.resolve();
    });
    // Optimistic flip set continuous; rejection reverts to off.
    expect(useSettingsStore.getState().values.voice_mode).toBe('off');
  });
});
