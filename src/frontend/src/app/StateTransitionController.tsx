import { useEffect, useRef, useCallback } from 'react';
import { useSystemStore } from '../stores/systemStore';
import { SystemState } from '@shared/types';

/**
 * StateTransitionController — orchestrates state transition choreography.
 *
 * Timeline:
 *   0ms   → previous accent fade-out begins
 *   150ms → StatusBar indicator morphs
 *   300ms → content shift
 *   600ms → new accent fully applied, animations adapted
 *
 * Sets CSS class `state-transitioning` on body during the 600ms window,
 * and applies `data-state-prev` for cross-fade reference.
 */

export function StateTransitionController() {
  const state = useSystemStore((s) => s.state);
  const previousState = useSystemStore((s) => s.previousState);
  const prevRef = useRef<SystemState>(state);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runTransition = useCallback((from: SystemState, to: SystemState) => {
    const body = document.body;

    // Phase 0: mark transitioning + set previous state for cross-fade
    body.classList.add('state-transitioning');
    body.setAttribute('data-state-prev', from);
    body.setAttribute('data-state', to);

    // Phase 1 (150ms): indicator morph — handled by CSS transition on StateIndicator
    // Phase 2 (300ms): content shift — handled by layout AnimatePresence

    // Phase 3 (600ms): transition complete
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      body.classList.remove('state-transitioning');
      body.removeAttribute('data-state-prev');
    }, 600);
  }, []);

  useEffect(() => {
    if (prevRef.current !== state) {
      runTransition(prevRef.current, state);
      prevRef.current = state;
    }
  }, [state, runTransition]);

  // Handle initial state and WS-driven transitions
  useEffect(() => {
    document.body.setAttribute('data-state', state);
  }, [state]);

  // Also watch previousState from store for WS-driven transitions
  useEffect(() => {
    if (previousState && previousState !== state) {
      runTransition(previousState, state);
    }
  }, [previousState, state, runTransition]);

  return null;
}
