/**
 * Day-4 Wave-2 W-5 — `useHardwareTier()` + `applyUISettings`
 * hardware-tier branch (audit U2-ANIM-C2 + U8-PERF).
 *
 * Coverage:
 *
 * 1. `applyUISettings({ ui_hardware_tier: 'low' })` writes
 *    `<html data-tier="low">`.
 * 2. Garbage / missing value → `data-tier="mid"` (defensive).
 * 3. `useHardwareTier` reads the current attribute on mount.
 * 4. `useHardwareTier` re-syncs when the attribute is mutated
 *    (MutationObserver path) — a settings save propagates without
 *    prop drilling.
 * 5. `isLowTier` returns true only for 'low'.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { useEffect } from 'react';
import {
  useHardwareTier,
  isLowTier,
  type HardwareTier,
} from '../hooks/useHardwareTier';
import { applyUISettings } from '../services/settingsBootstrap';

beforeEach(() => {
  document.documentElement.removeAttribute('data-tier');
});

function TierProbe({
  onTier,
}: {
  onTier: (t: HardwareTier) => void;
}) {
  const tier = useHardwareTier();
  useEffect(() => {
    onTier(tier);
  }, [tier, onTier]);
  return <span data-testid="probe">{tier}</span>;
}

describe('applyUISettings hardware-tier branch', () => {
  it('writes data-tier="low" when ui_hardware_tier="low"', () => {
    applyUISettings({ ui_hardware_tier: 'low' });
    expect(document.documentElement.getAttribute('data-tier')).toBe('low');
  });

  it('writes data-tier="high" when ui_hardware_tier="high"', () => {
    applyUISettings({ ui_hardware_tier: 'high' });
    expect(document.documentElement.getAttribute('data-tier')).toBe('high');
  });

  it('falls back to data-tier="mid" on garbage', () => {
    applyUISettings({ ui_hardware_tier: 'ultra-mega' });
    expect(document.documentElement.getAttribute('data-tier')).toBe('mid');
  });

  it('falls back to data-tier="mid" on undefined', () => {
    applyUISettings({});
    expect(document.documentElement.getAttribute('data-tier')).toBe('mid');
  });
});


describe('useHardwareTier (W-5)', () => {
  it('reads current attribute on mount', () => {
    document.documentElement.setAttribute('data-tier', 'high');
    let captured: HardwareTier | null = null;
    render(<TierProbe onTier={(t) => (captured = t)} />);
    expect(captured).toBe('high');
  });

  it('returns "mid" when attribute is missing', () => {
    let captured: HardwareTier | null = null;
    render(<TierProbe onTier={(t) => (captured = t)} />);
    expect(captured).toBe('mid');
  });

  it('returns "mid" when attribute is garbage', () => {
    document.documentElement.setAttribute('data-tier', 'garbage');
    let captured: HardwareTier | null = null;
    render(<TierProbe onTier={(t) => (captured = t)} />);
    expect(captured).toBe('mid');
  });

  it('re-syncs when the attribute mutates via MutationObserver', async () => {
    document.documentElement.setAttribute('data-tier', 'mid');
    let last: HardwareTier | null = null;
    render(<TierProbe onTier={(t) => (last = t)} />);
    expect(last).toBe('mid');

    // Flip via applyUISettings — simulates a settings save.
    await act(async () => {
      applyUISettings({ ui_hardware_tier: 'low' });
      // Allow MutationObserver microtask to flush.
      await Promise.resolve();
    });
    // Vitest's jsdom MutationObserver is async; rely on RAF or
    // microtask flush. The hook updates state on the observer
    // callback; the next render captures the new tier.
    await act(async () => {
      await new Promise((res) => setTimeout(res, 5));
    });
    expect(last).toBe('low');
  });
});


describe('isLowTier helper', () => {
  it('true only for "low"', () => {
    expect(isLowTier('low')).toBe(true);
    expect(isLowTier('mid')).toBe(false);
    expect(isLowTier('high')).toBe(false);
  });
});
