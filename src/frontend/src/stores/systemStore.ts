import { create } from 'zustand';
import { SystemState, StateTransition, ContextSnapshot } from '@shared/types';

/**
 * ESP32 bridge status. `unknown` = /health not yet fetched once.
 * `disabled` = backend reports serial_enabled=false (dev mode, no hardware).
 * `offline` = enabled but no batch received / device disconnected.
 * `online` = enabled and currently connected.
 */
export type Esp32Status = 'unknown' | 'disabled' | 'offline' | 'online';

interface SystemStoreState {
  state: SystemState;
  previousState: SystemState | null;
  stateHistory: StateTransition[];
  context: ContextSnapshot | null;
  authenticated: boolean;
  wsConnected: boolean;
  esp32: Esp32Status;
  /** Live mic amplitude [0, 1] — updated by useVoiceRecorder while listening. */
  voiceAmplitude: number;

  setState: (s: SystemState, transition?: Omit<StateTransition, 'from' | 'to'>) => void;
  setContext: (ctx: ContextSnapshot) => void;
  setAuthenticated: (v: boolean) => void;
  setWsConnected: (v: boolean) => void;
  setEsp32: (s: Esp32Status) => void;
  setVoiceAmplitude: (amp: number) => void;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
if (import.meta.env.DEV) {
  (window as any).__phantom = (window as any).__phantom ?? {};
}

export const useSystemStore = create<SystemStoreState>((set, get) => ({
  state: SystemState.SHADOW,
  previousState: null,
  stateHistory: [],
  context: null,
  authenticated: false,
  wsConnected: false,
  esp32: 'unknown',
  voiceAmplitude: 0,

  setState: (to, extra) => {
    const from = get().state;
    if (from === to) return;

    const transition: StateTransition = {
      from,
      to,
      trigger: extra?.trigger ?? 'unknown',
      timestamp: extra?.timestamp ?? Date.now(),
      auto: extra?.auto ?? true,
    };

    set((s) => ({
      state: to,
      previousState: from,
      stateHistory: [...s.stateHistory.slice(-99), transition],
    }));
  },

  setContext: (ctx) => set({ context: ctx }),
  setAuthenticated: (v) => set({ authenticated: v }),
  setWsConnected: (v) => set({ wsConnected: v }),
  setEsp32: (s) => set({ esp32: s }),
  setVoiceAmplitude: (amp) => {
    // Ignore sub-threshold jitter to avoid pointless rerenders when idle.
    const current = get().voiceAmplitude;
    if (Math.abs(current - amp) < 0.02 && amp < 0.02) return;
    set({ voiceAmplitude: amp });
  },
}));

if (import.meta.env.DEV) {
  (window as any).__phantom.system = useSystemStore;
}
