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
    // Audit D-H6 — bootstrap is gated on a token, so it has to retrigger
    // here once auth succeeds. settingsBootstrap dedupes a rapid-fire
    // second call, so this is safe even if providers also triggered it.
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
    useAuthStore.getState().clearAuth();
    useSystemStore.getState().setAuthenticated(false);
    
    // 24-PRE: Auth-token UX
    import('./uiStore').then(({ useUIStore }) => {
      useUIStore.getState().toast({
        kind: 'warn',
        message: 'Сесія прострочена. Будь ласка, увійдіть знову.',
      });
    });
    
    // Redirect to login if not already there
    if (window.location.pathname !== '/login') {
      window.location.href = '/login';
    }
  });
}
