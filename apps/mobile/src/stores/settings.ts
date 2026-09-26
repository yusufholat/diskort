import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export const DEFAULT_SERVER_URL = 'https://diskort.ziroo.net';

interface MobileSettings {
  serverUrl: string;
  /** Sesli sohbette hoparlör (true) ya da ahize (false); kulaklık/Bluetooth takılıysa o kullanılır */
  speaker: boolean;
  selfMute: boolean;
  selfDeaf: boolean;
  set: (patch: Partial<Omit<MobileSettings, 'set'>>) => void;
}

export const useSettings = create<MobileSettings>()(
  persist(
    (set) => ({
      serverUrl: DEFAULT_SERVER_URL,
      speaker: true,
      selfMute: false,
      selfDeaf: false,
      set: (patch) => set(patch),
    }),
    {
      name: 'diskort-settings',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ set: _set, ...rest }) => rest,
    },
  ),
);

export const getSettings = () => useSettings.getState();
