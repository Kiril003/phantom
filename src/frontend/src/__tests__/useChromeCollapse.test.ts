import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useChromeCollapse } from '../hooks/useChromeCollapse';
import { useUIStore } from '../stores/uiStore';

describe('useChromeCollapse', () => {
  beforeEach(() => {
    localStorage.clear();
    useUIStore.setState({
      chrome: { statusBar: true, roster: true, hud: true, toolbar: true },
    });
  });

  it('returns the current collapsed flag for the given key', () => {
    const { result } = renderHook(() => useChromeCollapse('hud'));
    expect(result.current[0]).toBe(true);
  });

  it('toggle flips the value', () => {
    const { result } = renderHook(() => useChromeCollapse('hud'));
    act(() => result.current[1]());
    expect(result.current[0]).toBe(false);
    act(() => result.current[1]());
    expect(result.current[0]).toBe(true);
  });

  it('does not affect other keys', () => {
    const { result: hud } = renderHook(() => useChromeCollapse('hud'));
    const { result: tb } = renderHook(() => useChromeCollapse('toolbar'));
    act(() => hud.current[1]());
    expect(hud.current[0]).toBe(false);
    expect(tb.current[0]).toBe(true);
  });

  it('persists toggle to localStorage', () => {
    const { result } = renderHook(() => useChromeCollapse('toolbar'));
    act(() => result.current[1]());
    const raw = localStorage.getItem('phantom.chrome.v1');
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!).toolbar).toBe(false);
  });
});
