import { describe, it, expect, beforeEach } from 'vitest';
import { useUIStore } from '../stores/uiStore';

describe('useUIStore — v3 extensions (focusedAgent, toasts, chrome)', () => {
  beforeEach(() => {
    localStorage.clear();
    useUIStore.setState({
      focusedAgent: 'foreground',
      toasts: [],
      chrome: { statusBar: true, roster: true, hud: true, toolbar: true },
    });
  });

  it('focusedAgent defaults to "foreground"', () => {
    expect(useUIStore.getState().focusedAgent).toBe('foreground');
  });

  it('setFocusedAgent updates the slice', () => {
    useUIStore.getState().setFocusedAgent('background');
    expect(useUIStore.getState().focusedAgent).toBe('background');
    useUIStore.getState().setFocusedAgent('council');
    expect(useUIStore.getState().focusedAgent).toBe('council');
  });

  it('toast() appends with auto-generated id and ts', () => {
    const id = useUIStore.getState().toast({ kind: 'error', message: 'boom' });
    const toasts = useUIStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({ kind: 'error', message: 'boom' });
    expect(toasts[0].id).toBe(id);
    expect(typeof toasts[0].ts).toBe('number');
  });

  it('multiple toasts accumulate in order', () => {
    useUIStore.getState().toast({ kind: 'info', message: 'first' });
    useUIStore.getState().toast({ kind: 'warn', message: 'second' });
    const toasts = useUIStore.getState().toasts;
    expect(toasts.map((t) => t.message)).toEqual(['first', 'second']);
  });

  it('dismissToast removes by id', () => {
    const a = useUIStore.getState().toast({ kind: 'info', message: 'a' });
    useUIStore.getState().toast({ kind: 'info', message: 'b' });
    useUIStore.getState().dismissToast(a);
    const toasts = useUIStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].message).toBe('b');
  });

  it('chrome defaults all keys to collapsed=true', () => {
    const c = useUIStore.getState().chrome;
    expect(c).toEqual({ statusBar: true, roster: true, hud: true, toolbar: true });
  });

  it('setChromeCollapsed flips a single key only', () => {
    useUIStore.getState().setChromeCollapsed('hud', false);
    const c = useUIStore.getState().chrome;
    expect(c.hud).toBe(false);
    expect(c.statusBar).toBe(true);
    expect(c.roster).toBe(true);
    expect(c.toolbar).toBe(true);
  });

  it('toggleChrome flips a single key', () => {
    useUIStore.getState().toggleChrome('toolbar');
    expect(useUIStore.getState().chrome.toolbar).toBe(false);
    useUIStore.getState().toggleChrome('toolbar');
    expect(useUIStore.getState().chrome.toolbar).toBe(true);
  });

  it('chrome state persists to localStorage under phantom.chrome.v1', () => {
    useUIStore.getState().setChromeCollapsed('hud', false);
    useUIStore.getState().setChromeCollapsed('toolbar', false);
    const raw = localStorage.getItem('phantom.chrome.v1');
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.hud).toBe(false);
    expect(parsed.toolbar).toBe(false);
    expect(parsed.statusBar).toBe(true);
  });
});
