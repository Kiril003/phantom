import { create } from 'zustand';
import { SystemState, StateTransition, ContextSnapshot } from '@shared/types';
import { contextApi } from '../services/api';

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
  /** Whether we are running inside a Tauri shell (desktop mode). */
  isTauri: boolean;
  /** Live mic amplitude [0, 1] — updated by useVoiceRecorder while listening. */
  voiceAmplitude: number;
  /** Digital Endocrine System state — updated by inner_monologue.stream events. */
  sentience: {
    cortisol: number;
    dopamine: number;
    oxytocin: number;
  };

  setState: (s: SystemState, transition?: Omit<StateTransition, 'from' | 'to'>) => void;
  setContext: (ctx: ContextSnapshot) => void;
  setAuthenticated: (v: boolean) => void;
  setWsConnected: (v: boolean) => void;
  setEsp32: (s: Esp32Status) => void;
  setVoiceAmplitude: (amp: number) => void;
  setSentience: (s: { cortisol: number; dopamine: number; oxytocin: number }) => void;

  // Лишились тільки ті два, що мають виклики. Решта (goFocus, goDialogue,
  // goGhost, goDream, goOperator) не мала жодного — і була пасткою: вони
  // міняють стан, але не ведуть на «/», тож із будь-якого маршруту дали б
  // рівно те, чим хворів goOperator — плашка нова, екран старий.
  // FloatingToolbar через це має власні версії з navigate('/').
  // DREAM і OPERATOR ставить ядро саме, вручну їх вмикати нема чого.
  goShadow: () => void;
  goSentinel: () => void;
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
  isTauri: typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__,
  voiceAmplitude: 0,
  sentience: { cortisol: 0.2, dopamine: 0.5, oxytocin: 0.5 },

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

    // If it's a manual transition (e.g. from the UI), notify the backend
    // so the state machines stay in sync.
    if (!transition.auto) {
      void contextApi.setState(to, transition.trigger);
    }
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

  setSentience: (s) => set({ sentience: s }),

  goShadow: () =>
    get().setState(SystemState.SHADOW, { trigger: 'go-shorthand', timestamp: Date.now(), auto: false }),
  goSentinel: () =>
    get().setState(SystemState.SENTINEL, { trigger: 'go-shorthand', timestamp: Date.now(), auto: false }),
}));

if (import.meta.env.DEV) {
  (window as any).__phantom.system = useSystemStore;
}
