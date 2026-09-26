import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import type { User } from '@diskort/shared';
import { env } from './env';

interface SessionStore {
  token: string | null;
  user: User | null;
  setSession: (token: string, user: User) => void;
  setUser: (user: User) => void;
  logout: () => void;
}

// Depolama platformdan gelir; configureClient() çağrılınca okunur (bkz. configure.ts).
const platformStorage: StateStorage = {
  getItem: (name) => env().storage.getItem(name),
  setItem: (name, value) => env().storage.setItem(name, value),
  removeItem: (name) => env().storage.removeItem(name),
};

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
      storage: createJSONStorage(() => platformStorage),
      partialize: ({ token, user }) => ({ token, user }),
      skipHydration: true,
    },
  ),
);
