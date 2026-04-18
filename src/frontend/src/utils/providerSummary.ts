/**
 * Phase 9.2.1 — derive the StatusBar provider badge state from a router
 * snapshot. Pulled out of StatusBar.tsx so the rendering logic is unit
 * testable without dragging in every store the bar consumes.
 */
import type { RouterStateSnapshot } from '../services/agentApi';

export interface ProviderSummary {
  color: string;
  label: string;
  tooltip: string;
  fallbackArrow: boolean;
}

export function deriveProviderSummary(
  provider: string,
  rs: RouterStateSnapshot | null,
  nowMs: number = Date.now(),
): ProviderSummary {
  if (!rs) {
    return { color: 'var(--signal-ok)', label: provider, tooltip: provider, fallbackArrow: false };
  }
  const primary = rs.primary;
  const fallback = rs.fallback;

  if (primary in rs.quota_exhausted) {
    return {
      color: 'var(--signal-alert)',
      label: `${primary} · quota`,
      tooltip: `${primary} quota exhausted until ${rs.quota_exhausted[primary]?.until_utc}`,
      fallbackArrow: true,
    };
  }
  if (primary in rs.cooling) {
    const until = rs.cooling[primary]?.until_utc;
    const reason = rs.cooling[primary]?.reason;
    const remaining = until ? Math.max(0, Math.round((Date.parse(until) - nowMs) / 1000)) : 0;
    return {
      color: 'var(--signal-warn)',
      label: `${primary} · cooling ${remaining}s`,
      tooltip: `${primary} cooling ${remaining}s (${reason})`,
      fallbackArrow: true,
    };
  }
  if (rs.active && rs.active !== primary && fallback !== 'none') {
    return {
      color: 'var(--chart-2)',
      label: `${rs.active} ←`,
      tooltip: `Fallback ${rs.active} active; ${primary} primary will be retried.`,
      fallbackArrow: false,
    };
  }
  return {
    color: 'var(--signal-ok)',
    label: provider,
    tooltip: `${provider} (primary)`,
    fallbackArrow: false,
  };
}
