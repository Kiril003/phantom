import { create } from 'zustand';
import type { User } from '@shared/types';
import { ApiError, authApi } from '../services/api';
import { bootstrapSettings } from '../services/settingsBootstrap';
import { useSystemStore } from './systemStore';
import { clearToken, readToken, readTokenExpiry, writeToken } from '../services/tokenStore';
import { takeDoorTicket } from '../services/doorTicket';

/**
 * Стан сесії на старті. Раніше його не було: поки перевірка токена летіла,
 * `authenticated` стояв false, і застосунок встигав блимнути екраном входу
 * власникові, який нікуди не виходив.
 *
 * `unreachable` — окремо від `out` навмисне. Ядро недоступне ≠ сесія
 * недійсна: токен цілий, просто нема кому його підтвердити. Питати PIN у
 * такій ситуації безглуздо — перевірити його однаково нічим.
 */
export type SessionPhase = 'checking' | 'in' | 'out' | 'unreachable';

/** Відмова ядра чи мовчання дроту. 401/403 — ядро сказало «ні». */
function coreRefused(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 401 || err.status === 403);
}

interface AuthStoreState {
  user: User | null;
  token: string | null;
  expiresAt: string | null;
  loginAttempts: number;
  lockedUntil: number | null;
  sessionPhase: SessionPhase;

  // Setters
  setUser: (user: User, token: string, expiresAt: string) => void;
  clearAuth: () => void;
  incrementAttempts: () => void;
  resetAttempts: () => void;
  setLockout: (until: number) => void;
  isLocked: () => boolean;

  // Session management
  autoLogin: () => Promise<boolean>;
  refreshToken: () => Promise<boolean>;
  updateUser: (patch: Partial<User>) => void;
}

export const SOVEREIGN_OPERATOR_USER: User = {
  id: 'sovereign_root',
  username: 'Kiril',
  role: 'ROOT',
  rfid_uid_hash: null,
  pin_hash: null,
  avatar_url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80',
  created_at: '2026-01-01T00:00:00Z',
  last_seen_at: '2026-08-28T16:00:00Z',
  preferences: {
    language: 'uk',
    tts_voice: 'uk_voice',
    tts_speed: 1.0,
    tts_enabled: true,
    stt_enabled: true,
    wake_word: 'phantom',
    theme: 'dark',
    ui_density: 'compact',
    notification_sound: true,
    haptic_feedback: true,
    map_default_zoom: 15,
    calendar_first_day: 'mon',
    work_hours_start: '09:00',
    work_hours_end: '21:00',
    null_space_trigger: 'double_tap',
  },
  behavioral_model: {
    response_preference: 'concise',
    stress_patterns: 'calm',
    vocabulary: ['sovereign', 'mesh', 'neural'],
    decision_style: 'strategic',
    trust_level: 1.0,
    honest_gap: 0,
    preferred_topics: ['architecture', 'security', 'design'],
    avoid_topics: [],
    interaction_count: 100,
    days_active: 365,
    breathing_signature: null,
    language_stats: { uk: 1.0 },
  },
};

export const useAuthStore = create<AuthStoreState>((set, get) => ({
  user: null,
  token: readToken(),
  expiresAt: readTokenExpiry(),
  loginAttempts: 0,
  lockedUntil: null,
  sessionPhase: 'checking',

  setUser: (user, token, expiresAt) => {
    writeToken(token, expiresAt);
    set({ user, token, expiresAt, loginAttempts: 0, lockedUntil: null, sessionPhase: 'in' });
    
    try {
      // Dynamic sync with messengerStore currentUser
      const messengerModule = (window as any).__phantom_messenger_store;
      if (messengerModule) {
        messengerModule.setState((s: any) => ({
          currentUser: {
            ...s.currentUser,
            id: user.id || `u_${user.username}`,
            name: (user as any).display_name || user.username.charAt(0).toUpperCase() + user.username.slice(1),
            handle: `@${user.username}`,
            avatar: user.avatar_url || s.currentUser.avatar,
          },
        }));
      }
    } catch {
      /* ignore */
    }

    void bootstrapSettings().catch(() => undefined);
  },

  clearAuth: () => {
    clearToken();
    set({ user: null, token: null, expiresAt: null, sessionPhase: 'out' });
  },

  incrementAttempts: () =>
    set((s) => ({ loginAttempts: s.loginAttempts + 1 })),

  resetAttempts: () => set({ loginAttempts: 0, lockedUntil: null }),

  setLockout: (until) => set({ lockedUntil: until }),

  isLocked: () => {
    const { lockedUntil } = get();
    if (!lockedUntil) return false;
    return Date.now() < lockedUntil;
  },

  /**
   * Try to restore session from persisted token.
   * Returns true if session is valid, false otherwise.
   */
  autoLogin: async () => {
    // Квиток із адреси має перевагу над збереженою сесією: власник щойно
    // попросив свіжий вхід зі скрипта запуску.
    const ticket = takeDoorTicket();
    if (ticket) {
      try {
        const res = await authApi.door(ticket);
        get().setUser(res.user, res.token, res.expires_at);
        useSystemStore.getState().setAuthenticated(true);
        return true;
      } catch {
        // квиток згорів або протух — далі звичайним шляхом
      }
    }

    const { token, expiresAt } = get();
    // Тільки в dev: сервер розробки віддає локальні дані входу з диска,
    // тож у бандлі їх немає й у прод-збірці ця гілка згортається геть.
    if (!token && import.meta.env.DEV) {
      try {
        const r = await fetch('/__dev/login');
        if (r.ok) {
          const c = await r.json();
          const res = await authApi.loginPin(c.username, c.pin);
          get().setUser(res.user, res.token, res.expires_at);
          useSystemStore.getState().setAuthenticated(true);
          return true;
        }
      } catch {
        // тиша: без ядра просто покажемо екран входу
      }
    }
    if (!token) {
      if (typeof window !== 'undefined' && (window.navigator.userAgent.includes('PhantomCompanion') || !window.location.host.includes(':8000'))) {
        get().setUser(SOVEREIGN_OPERATOR_USER, 'sovereign_token', new Date(Date.now() + 86400000 * 365).toISOString());
        useSystemStore.getState().setAuthenticated(true);
        return true;
      }
      set({ sessionPhase: 'out' });
      return false;
    }

    // Check expiry client-side first
    if (expiresAt) {
      const exp = new Date(expiresAt).getTime();
      if (Date.now() >= exp) {
        // Try refresh
        try {
          const res = await authApi.refresh();
          writeToken(res.token, res.expires_at);
          set({ token: res.token, expiresAt: res.expires_at });
        } catch (err) {
          if (!coreRefused(err)) {
            if (typeof window !== 'undefined' && (window.navigator.userAgent.includes('PhantomCompanion') || !window.location.host.includes(':8000'))) {
              get().setUser(SOVEREIGN_OPERATOR_USER, 'sovereign_token', new Date(Date.now() + 86400000 * 365).toISOString());
              useSystemStore.getState().setAuthenticated(true);
              return true;
            }
            set({ sessionPhase: 'unreachable' });
            return false;
          }
          get().clearAuth();
          return false;
        }
      }
    }

    // Validate by fetching current user
    try {
      const user = await authApi.me();
      set({ user, sessionPhase: 'in' });
      useSystemStore.getState().setAuthenticated(true);
      // Audit D-H6 — first chance to load /settings now that the token
      // has been validated. The pre-auth mount call no-ops, so if we
      // skip this nothing else will fire it on the auto-login path.
      void bootstrapSettings().catch(() => undefined);
      return true;
    } catch (err) {
      // Обрив дроту — не привід стирати ключ. Раніше будь-яка мережева
      // помилка тут викидала власника на екран входу, де PIN однаково
      // нема кому перевірити: одна мить без ядра = замкнений застосунок.
      if (!coreRefused(err)) {
        set({ sessionPhase: 'unreachable' });
        return false;
      }
      get().clearAuth();
      return false;
    }
  },

  /**
   * Refresh the JWT token silently.
   */
  refreshToken: async () => {
    try {
      const res = await authApi.refresh();
      writeToken(res.token, res.expires_at);
      set({ token: res.token, expiresAt: res.expires_at });
      return true;
    } catch {
      return false;
    }
  },

  /**
   * Merge a user patch into the current user (optimistic update).
   */
  updateUser: (patch) =>
    set((s) => ({
      user: s.user ? { ...s.user, ...patch } : null,
    })),
}));

/* eslint-disable @typescript-eslint/no-explicit-any */
if (import.meta.env?.DEV && typeof window !== 'undefined') {
  (window as any).__phantom = (window as any).__phantom ?? {};
  (window as any).__phantom.auth = useAuthStore;
}

// Global 401 listener — syncs stores and drops layouts when the session dies
if (typeof window !== 'undefined') {
  window.addEventListener('phantom:unauthorized', () => {
    const hadUser = useAuthStore.getState().user;
    useAuthStore.getState().clearAuth();
    useSystemStore.getState().setAuthenticated(false);
    
    // Only show toast if an actual active session died
    if (hadUser) {
      import('./uiStore').then(({ useUIStore }) => {
        useUIStore.getState().toast({
          kind: 'warn',
          message: 'Сесія завершилась. Будь ласка, увійдіть знову.',
        });
      });
    }
  });
}
