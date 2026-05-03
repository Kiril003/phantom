import { useCallback, useEffect, useRef, useState } from 'react';
import { mapApi, type AttributionPayload, type AttributionLine } from '../services/api';

/**
 * Phase 24-A — OmniMap attribution accumulator.
 *
 * Pulls the current active-layer attribution union from the backend and
 * keeps it in sync. The drawer in the OmniMap HUD calls this once on
 * mount and re-fetches whenever the operator toggles a layer (the hook
 * exposes `refresh` for that). A cheap interval poll covers the case
 * where another client (mobile companion, chat agent) flips a layer
 * remotely so the legal footer never lags reality by more than the
 * poll period.
 */

export interface UseAttributionOptions {
  /**
   * Re-poll period in ms. 0 disables polling and the caller must drive
   * `refresh()` manually (used in tests). Default 30 s — slow enough not
   * to spam the API, fast enough that a mobile-side toggle is reflected
   * on the desktop HUD before the operator notices.
   */
  pollMs?: number;
  /** Skip the initial fetch (useful for SSR / Storybook). */
  skip?: boolean;
}

export interface UseAttributionResult {
  payload: AttributionPayload | null;
  lines: AttributionLine[];
  activeIds: string[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const EMPTY_LINES: AttributionLine[] = [];
const EMPTY_IDS: string[] = [];

export function useAttribution(
  options: UseAttributionOptions = {},
): UseAttributionResult {
  const { pollMs = 30_000, skip = false } = options;
  const [payload, setPayload] = useState<AttributionPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    if (skip) return;
    setLoading(true);
    setError(null);
    try {
      const next = await mapApi.getAttribution();
      if (mountedRef.current) {
        setPayload(next);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : 'Failed to load attribution');
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [skip]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (skip) return;
    void refresh();
    if (pollMs <= 0) return;
    const id = window.setInterval(() => {
      void refresh();
    }, pollMs);
    return () => window.clearInterval(id);
  }, [pollMs, refresh, skip]);

  return {
    payload,
    lines: payload?.attribution ?? EMPTY_LINES,
    activeIds: payload?.active_layer_ids ?? EMPTY_IDS,
    loading,
    error,
    refresh,
  };
}
