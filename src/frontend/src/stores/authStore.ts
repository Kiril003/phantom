import { create } from 'zustand';
import type { User } from '@shared/types';
import { authApi } from '../services/api';

interface AuthStoreState {
  user: User | null;
  token: string | null;
  expiresAt: string | null;
  loginAttempts: number;
  lockedUntil: number | null;

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
  token: localStorage.getItem('phantom_token'),
  expiresAt: localStorage.getItem('phantom_token_expires'),
  loginAttempts: 0,
  lockedUntil: null,

  setUser: (user, token, expiresAt) => {
    localStorage.setItem('phantom_token', token);
    localStorage.setItem('phantom_token_expires', expiresAt);
    set({ user, token, expiresAt, loginAttempts: 0, lockedUntil: null });
  },

  clearAuth: () => {
    localStorage.removeItem('phantom_token');
    localStorage.removeItem('phantom_token_expires');
    set({ user: null, token: null, expiresAt: null });
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
    const { token, expiresAt } = get();
    if (!token) return false;

    // Check expiry client-side first
    if (expiresAt) {
      const exp = new Date(expiresAt).getTime();
      if (Date.now() >= exp) {
        // Try refresh
        try {
          const res = await authApi.refresh();
          localStorage.setItem('phantom_token', res.token);
          localStorage.setItem('phantom_token_expires', res.expires_at);
          set({ token: res.token, expiresAt: res.expires_at });
        } catch {
          get().clearAuth();
          return false;
        }
      }
    }

    // Validate by fetching current user
    try {
      const user = await authApi.me();
      set({ user });
      return true;
    } catch {
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
      localStorage.setItem('phantom_token', res.token);
      localStorage.setItem('phantom_token_expires', res.expires_at);
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
