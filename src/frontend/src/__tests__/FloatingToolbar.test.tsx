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

describe('FloatingToolbar — Always-On button (Phase 11c.5 freeze)', () => {
  // Phase 11c.2 wired the Always-On toolbar button to flip
  // voice_always_on_enabled and PUT to the backend. Phase 11c.5 froze the
  // feature pending docs/phase-11c.5/known-issues.md fixes — the button is
  // still visible (so users see the affordance returning in Phase 12) but
  // disabled. Click is a no-op; aria-pressed is always false.

  beforeEach(() => {
    setMock.mockReset();
    setMock.mockResolvedValue({
      key: 'voice_always_on_enabled',
      value: true,
      requires_restart: false,
    });
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

  it('renders the Always-On button in the primary toolbar (disabled)', () => {
    renderToolbar();
    const btn = screen.getByLabelText('Always-On') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('aria-pressed')).toBe('false');
  });

  it('shows the freeze tooltip', () => {
    renderToolbar();
    const btn = screen.getByLabelText('Always-On');
    expect(btn.getAttribute('title') ?? '').toContain('Phase 11c.5');
  });

  it('does NOT call the settings API when clicked (freeze)', async () => {
    renderToolbar();
    const btn = screen.getByLabelText('Always-On');
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(setMock).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().values.voice_always_on_enabled).toBe(false);
  });

  it('does NOT show "active" styling even if the setting is true under the hood', () => {
    useSettingsStore.setState({
      categories: [],
      values: { voice_always_on_enabled: true },
      dirty: new Set(),
      loaded: true,
    });
    renderToolbar();
    const btn = screen.getByLabelText('Always-On');
    // Phase 11c.5 — the button reflects the freeze, not the setting. If
    // a stale row in the DB has true (e.g. from an older build), the
    // toolbar must still show off so the user knows the feature is not
    // running.
    expect(btn.getAttribute('aria-pressed')).toBe('false');
  });
});
