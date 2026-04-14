import { create } from 'zustand';
import { User } from '@shared/types';

interface AuthStoreState {
  user: User | null;
  token: string | null;
  expiresAt: string | null;
  loginAttempts: number;
  lockedUntil: number | null;

  setUser: (user: User, token: string, expiresAt: string) => void;
  clearAuth: () => void;
  incrementAttempts: () => void;
  resetAttempts: () => void;
  setLockout: (until: number) => void;
  isLocked: () => boolean;
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
}));
