/**
 * useChromeCollapse — спільний hook для chrome-elements
 * (StatusBar, Roster, AgentCommandCenter HUD, FloatingToolbar) які мають
 * compact/collapsed і full стани. Стан персистується в localStorage
 * через useUIStore (`phantom.chrome.v1`).
 *
 * Повертає [collapsed, toggle] tuple.
 *
 *   const [hudCollapsed, toggleHud] = useChromeCollapse('hud');
 */
import { useCallback } from 'react';
import { useUIStore, type ChromeKey } from '../stores/uiStore';

export function useChromeCollapse(key: ChromeKey): [boolean, () => void] {
  const collapsed = useUIStore((s) => s.chrome[key]);
  const toggleChrome = useUIStore((s) => s.toggleChrome);
  const toggle = useCallback(() => toggleChrome(key), [toggleChrome, key]);
  return [collapsed, toggle];
}
