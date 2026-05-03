/**
 * Phase 22-B — Apps overlay backbone tests.
 *
 * Exercises the two new stores that the redesigned AppsOverlay leans on:
 *   • appsStore — last-used timestamp persistence + Ukrainian relative-time
 *     formatting used in the tile corner ("5 хв тому").
 *   • uiStore.openToolsTab — single call that promotes a Timer/Alarm/
 *     Calendar/Files tile click into "open the overlay on this tab".
 *
 * The AppsOverlay component itself is exercised end-to-end by the
 * Playwright pass; this file covers the deterministic state plumbing.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useAppsStore, formatAgo } from '../stores/appsStore';
import { useUIStore } from '../stores/uiStore';

describe('appsStore.formatAgo — Ukrainian relative-time tile hint', () => {
  it('returns "щойно" inside the first minute', () => {
    expect(formatAgo(0)).toBe('щойно');
    expect(formatAgo(59_000)).toBe('щойно');
  });

  it('returns "<n> хв тому" inside the first hour', () => {
    expect(formatAgo(60_000)).toBe('1 хв тому');
    expect(formatAgo(15 * 60_000)).toBe('15 хв тому');
  });

  it('returns "<n> год тому" inside the first day', () => {
    expect(formatAgo(60 * 60_000)).toBe('1 год тому');
    expect(formatAgo(5 * 60 * 60_000)).toBe('5 год тому');
  });

  it('returns "<n> дн тому" up to a week, then null beyond', () => {
    expect(formatAgo(24 * 60 * 60_000)).toBe('1 дн тому');
    expect(formatAgo(7 * 24 * 60 * 60_000)).toBe('7 дн тому');
    expect(formatAgo(30 * 24 * 60 * 60_000)).toBeNull();
  });

  it('rejects negative or non-finite deltas', () => {
    expect(formatAgo(-100)).toBeNull();
    expect(formatAgo(Number.POSITIVE_INFINITY)).toBeNull();
    expect(formatAgo(Number.NaN)).toBeNull();
  });
});

describe('appsStore.markUsed — last-used roundtrip', () => {
  beforeEach(() => {
    try {
      window.localStorage.removeItem('phantom.apps.last_used.v1');
    } catch {
      /* ignore */
    }
    useAppsStore.setState({ lastUsed: {} });
  });

  it('records a timestamp the moment a tile is launched', () => {
    const before = Date.now();
    useAppsStore.getState().markUsed('camera');
    const ts = useAppsStore.getState().lastUsed.camera;
    expect(typeof ts).toBe('number');
    expect(ts!).toBeGreaterThanOrEqual(before);
  });

  it('persists across getState cycles via localStorage', () => {
    useAppsStore.getState().markUsed('terminal');
    const stored = window.localStorage.getItem('phantom.apps.last_used.v1');
    expect(stored).toBeTruthy();
    const parsed = JSON.parse(stored!) as Record<string, number>;
    expect(typeof parsed.terminal).toBe('number');
  });

  it('agoLabel returns null for tiles never touched', () => {
    expect(useAppsStore.getState().agoLabel('never-used')).toBeNull();
  });
});

describe('uiStore.openToolsTab — single-tap Tools launch', () => {
  beforeEach(() => {
    useUIStore.setState({
      toolsOverlayOpen: false,
      toolsInitialTab: 'timer',
    } as never);
  });

  afterEach(() => {
    useUIStore.setState({
      toolsOverlayOpen: false,
      toolsInitialTab: 'timer',
    } as never);
  });

  it('opens the overlay on the requested tab in one call', () => {
    useUIStore.getState().openToolsTab('calendar');
    const s = useUIStore.getState();
    expect(s.toolsOverlayOpen).toBe(true);
    expect(s.toolsInitialTab).toBe('calendar');
  });

  it('switching tabs while still open just updates initialTab', () => {
    useUIStore.getState().openToolsTab('alarm');
    useUIStore.getState().openToolsTab('files');
    const s = useUIStore.getState();
    expect(s.toolsOverlayOpen).toBe(true);
    expect(s.toolsInitialTab).toBe('files');
  });
});
