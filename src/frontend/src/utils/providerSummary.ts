/**
 * Phase 9.2.1 — derive the StatusBar provider badge state from a router
 * snapshot. Pulled out of StatusBar.tsx so the rendering logic is unit
 * testable without dragging in every store the bar consumes.
 *
 * Defensive — backend `ai_router.router_state_snapshot()` historically
 * returned a partial shape (`{active, cooling: list[str]}`) while the
 * TypeScript contract above declares the richer `cooling: Record<...>` /
 * `quota_exhausted` form. A missing key surfaced as
 * `'string' in undefined → TypeError` which crashed the entire app
 * tree (no error boundary above StatusBar). Treat every cooling /
 * quota field as optional and fall back to "ok" green when the
 * snapshot is partial.
 */
import type { RouterStateSnapshot } from '../services/agentApi';

export interface ProviderSummary {
  color: string;
  label: string;
  tooltip: string;
  fallbackArrow: boolean;
}

function asRecord<T>(v: unknown): Record<string, T> {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, T>)
    : {};
}

/**
 * Бекенд шле для добового ліміту рядок "midnight" — і він доходив до
 * підказки як є: «ліміт вичерпано до midnight». Все інше — час ISO.
 */
function untilPhrase(until: string | undefined): string {
  if (!until) return 'на невизначений час';
  if (until === 'midnight') return 'до опівночі';
  const ts = Date.parse(until);
  if (Number.isNaN(ts)) return `до ${until}`;
  return `до ${new Date(ts).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })}`;
}

export function deriveProviderSummary(
  provider: string,
  rs: RouterStateSnapshot | null,
  nowMs: number = Date.now(),
): ProviderSummary {
  if (!rs) {
    return { color: 'var(--signal-ok)', label: provider, tooltip: provider, fallbackArrow: false };
  }
  const primary = rs.primary ?? provider;
  const fallback = rs.fallback ?? 'none';
  const quotaExhausted = asRecord<{ until_utc?: string }>(rs.quota_exhausted);
  const cooling = asRecord<{ until_utc?: string; reason?: string }>(rs.cooling);

  if (primary in quotaExhausted) {
    return {
      color: 'var(--signal-alert)',
      label: 'ліміт',
      tooltip: `${primary}: ліміт вичерпано ${untilPhrase(quotaExhausted[primary]?.until_utc)}`,
      fallbackArrow: true,
    };
  }
  if (primary in cooling) {
    const until = cooling[primary]?.until_utc;
    const reason = cooling[primary]?.reason;
    const remaining = until ? Math.max(0, Math.round((Date.parse(until) - nowMs) / 1000)) : 0;
    return {
      color: 'var(--signal-warn)',
      label: `пауза ${remaining}с`,
      tooltip: `${primary}: пауза ${remaining}с (${reason})`,
      fallbackArrow: true,
    };
  }
  if (rs.active && rs.active !== primary && fallback !== 'none') {
    return {
      color: 'var(--chart-2)',
      label: rs.active,
      tooltip: `Працює запасний ${rs.active}; повернуся до ${primary}.`,
      fallbackArrow: true,
    };
  }
  return {
    color: 'var(--signal-ok)',
    label: provider,
    tooltip: `${provider} — основний`,
    fallbackArrow: false,
  };
}
