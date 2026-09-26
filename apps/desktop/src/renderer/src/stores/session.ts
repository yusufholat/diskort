import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { User } from '@diskort/shared';

interface SessionStore {
  token: string | null;
  user: User | null;
  setSession: (token: string, user: User) => void;
  setUser: (user: User) => void;
  logout: () => void;
}

export const useSession = create<SessionStore>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      setSession: (token, user) => set({ token, user }),
      setUser: (user) => set({ user }),
      logout: () => set({ token: null, user: null }),
    }),
    {
      name: 'diskort-session',
      storage: createJSONStorage(() => localStorage),
      partialize: ({ token, user }) => ({ token, user }),
    },
  ),
);
