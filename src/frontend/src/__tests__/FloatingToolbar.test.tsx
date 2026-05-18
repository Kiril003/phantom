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
      // OperatorLayout v3 chrome-collapse defaults Toolbar to collapsed; the
      // existing assertions render the full toolbar, so expand it explicitly.
      chrome: { statusBar: false, roster: false, hud: false, toolbar: false },
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

/**
 * Section A — Dock redesign (1024×600 productisation pass).
 *
 * Primary set trimmed from 7 → 5: Home · Chat · Apps · Settings · More.
 * Map and Terminal moved to Apps grid.
 * More-menu becomes a 2-column scroll-safe grid.
 * Long-press on Home shows a one-shot pulsing hint dot until first long-press.
 */
describe('FloatingToolbar — Section A dock redesign', () => {
  beforeEach(() => {
    setMock.mockReset();
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
    useUIStore.setState({
      moreMenuOpen: false,
      pendingVoiceActivation: false,
    } as never);
    useSystemStore.setState({ state: SystemState.SHADOW } as never);
    try {
      window.localStorage.removeItem('phantom_more_hint_seen');
    } catch {
      /* ignore */
    }
  });

  afterEach(() => {
    useSettingsStore.setState({
      categories: [],
      values: {},
      dirty: new Set(),
      loaded: false,
    });
    useUIStore.setState({ moreMenuOpen: false } as never);
  });

  it('renders only Home, Chat (Dialogue), Apps, Settings + More in primary row', () => {
    renderToolbar();
    expect(screen.getByLabelText('Home')).toBeTruthy();
    expect(screen.getByLabelText('Dialogue')).toBeTruthy();
    expect(screen.getByLabelText('Apps')).toBeTruthy();
    expect(screen.getByLabelText('Settings')).toBeTruthy();
    expect(screen.getByLabelText('More')).toBeTruthy();
    // Terminal and Map have moved to the Apps grid; closed More menu
    // means they must NOT be reachable in the primary row.
    expect(screen.queryByLabelText('Terminal')).toBeNull();
    expect(screen.queryByLabelText('Map')).toBeNull();
  });

  it('More menu renders as a 2-column scroll-safe grid', () => {
    useUIStore.setState({ moreMenuOpen: true } as never);
    renderToolbar();
    // Grab the More menu button to find its sibling popover.
    const moreBtn = screen.getByLabelText('More');
    // Climb to the toolbar container then find the grid via the secondary
    // action's parent (e.g. the Sentinel button's grandparent).
    const sentinel = screen.getByLabelText('Sentinel');
    const grid = sentinel.parentElement!;
    expect(grid.style.display).toBe('grid');
    expect(grid.style.gridTemplateColumns).toContain('repeat(2,');
    expect(grid.style.overflowY).toBe('auto');
    expect(parseInt(grid.style.maxHeight, 10)).toBeGreaterThan(0);
    expect(moreBtn.getAttribute('aria-pressed')).toBe('true');
  });

  it('shows the long-press hint dot on first run and dismisses after long-press', async () => {
    vi.useFakeTimers();
    try {
      renderToolbar();
      // Hint dot is rendered as a sibling motion.span inside the Home wrapper.
      const homeBtn = screen.getByLabelText('Home');
      const homeWrapper = homeBtn.parentElement!;
      // span with aria-hidden marks the hint dot.
      expect(homeWrapper.querySelector('span[aria-hidden="true"]')).toBeTruthy();

      // Trigger long-press: pointerDown then advance 500ms.
      await act(async () => {
        fireEvent.pointerDown(homeBtn);
        vi.advanceTimersByTime(600);
      });
      expect(window.localStorage.getItem('phantom_more_hint_seen')).toBe('1');
      // After long-press fires, the hint dot is gone.
      expect(homeWrapper.querySelector('span[aria-hidden="true"]')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
