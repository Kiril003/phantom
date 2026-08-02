/**
 * Phase 9.2.1 — StatusBar provider badge state derivation.
 *
 * The StatusBar polls /agent/router_state and renders a coloured badge for
 * the current AI provider. The state derivation logic is the visible
 * acceptance gate (operator can tell at a glance: cooling vs quota vs
 * fallback-active vs healthy), so we lock its outputs against snapshots
 * the AIRouter actually produces.
 */
import { describe, it, expect } from 'vitest';
import { deriveProviderSummary } from '../utils/providerSummary';
import type { RouterStateSnapshot } from '../services/agentApi';

const baseSnap: RouterStateSnapshot = {
  primary: 'gemini',
  fallback: 'ollama',
  active: 'gemini',
  cooling: {},
  quota_exhausted: {},
  last_calls: {},
};

describe('StatusBar — deriveProviderSummary', () => {
  it('returns the bare provider when no router snapshot has loaded yet', () => {
    const out = deriveProviderSummary('gemini', null);
    expect(out.label).toBe('gemini');
    expect(out.color).toBe('var(--signal-ok)');
    expect(out.fallbackArrow).toBe(false);
  });

  it('paints red and shows quota label when primary is quota-exhausted', () => {
    const snap: RouterStateSnapshot = {
      ...baseSnap,
      quota_exhausted: { gemini: { until_utc: '2026-04-19T07:00:00+00:00' } },
    };
    const out = deriveProviderSummary('gemini', snap);
    expect(out.color).toBe('var(--signal-alert)');
    expect(out.label).toContain('ліміт');
    expect(out.tooltip).toContain('2026-04-19');
    expect(out.fallbackArrow).toBe(true);
  });

  it('paints amber with countdown when primary is cooling', () => {
    const futureMs = 1_800_000_042_000; // arbitrary fixed wall-clock for the test
    const snap: RouterStateSnapshot = {
      ...baseSnap,
      cooling: {
        gemini: {
          until_utc: new Date(futureMs + 42_000).toISOString(),
          reason: 'rate_limit',
        },
      },
    };
    const out = deriveProviderSummary('gemini', snap, futureMs);
    expect(out.color).toBe('var(--signal-warn)');
    expect(out.label).toMatch(/пауза 42с/);
    expect(out.tooltip).toContain('rate_limit');
    expect(out.fallbackArrow).toBe(true);
  });

  it('marks fallback as active when active != primary and fallback is configured', () => {
    const snap: RouterStateSnapshot = { ...baseSnap, active: 'ollama' };
    const out = deriveProviderSummary('gemini', snap);
    expect(out.label).toBe('ollama');
    expect(out.fallbackArrow).toBe(true);
    expect(out.color).toBe('var(--chart-2)');
  });

  it('returns healthy primary when no cooling / quota / fallback flips', () => {
    const out = deriveProviderSummary('gemini', baseSnap);
    expect(out.color).toBe('var(--signal-ok)');
    expect(out.label).toBe('gemini');
    expect(out.fallbackArrow).toBe(false);
  });
});
