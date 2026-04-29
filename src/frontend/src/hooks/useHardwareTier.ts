/**
 * Day-4 Wave-2 W-5 — `useHardwareTier()` (closes audit U2-ANIM-C2 +
 * U8-PERF for the React-component side of the gate).
 *
 * Returns the active hardware tier ('low' | 'mid' | 'high') so a
 * component can drop heavy chrome at runtime without re-reading the
 * settings store API. Reads `document.documentElement[data-tier]`
 * (set by `applyUISettings` at app bootstrap + on every settings save).
 *
 * Usage:
 *
 *   const tier = useHardwareTier();
 *   if (tier === 'low') return null;          // skip <AmbientGlows/>
 *   const fps = tier === 'low' ? 24 : 60;     // throttle motion
 *
 * The hook also subscribes to `MutationObserver` on the root attribute
 * so a settings flip reaches every consumer without prop drilling.
 */
import { useEffect, useState } from 'react';

export type HardwareTier = 'low' | 'mid' | 'high';

const DEFAULT_TIER: HardwareTier = 'mid';

function readTierFromDom(): HardwareTier {
  if (typeof document === 'undefined') return DEFAULT_TIER;
  const raw = document.documentElement.getAttribute('data-tier');
  if (raw === 'low' || raw === 'mid' || raw === 'high') return raw;
  return DEFAULT_TIER;
}

export function useHardwareTier(): HardwareTier {
  const [tier, setTier] = useState<HardwareTier>(readTierFromDom);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      setTier(readTierFromDom());
    });
    observer.observe(root, {
      attributes: true,
      attributeFilter: ['data-tier'],
    });
    // Re-sync once on mount in case the attribute changed between
    // `useState` initial value and effect attach.
    setTier(readTierFromDom());
    return () => observer.disconnect();
  }, []);

  return tier;
}

/** Returns true when chrome should be reduced (low tier). */
export function isLowTier(tier: HardwareTier): boolean {
  return tier === 'low';
}
