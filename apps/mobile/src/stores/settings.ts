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
  /** Kişi başı ses seviyesi ve izlenen yayının ses seviyesi (0–2); yalnızca %100'den farklı olanlar tutulur */
  userVolumes: Record<string, number>;
  streamVolumes: Record<string, number>;
  /** Mikrofon işleme (WebRTC ve telefonun kendi ses işlemcisi); sesli sohbete katılırken uygulanır */
  noiseSuppression: boolean;
  echoCancellation: boolean;
  autoGainControl: boolean;
  /** Ses algılama: konuşmadığın anlarda mikrofon sessize alınır (arka plan sesi gitmez) */
  voiceActivity: boolean;
  /** Eşik ortam gürültüsüne göre kendiliğinden belirlenir */
  vadAuto: boolean;
  /** Elle belirlenen eşik (dBFS) */
  vadThresholdDb: number;
  /** Ses düğmelerine ve yönetim işlemlerine basınca kısa titreşim (bkz. haptics.ts) */
  haptics: boolean;
  set: (patch: Partial<Omit<MobileSettings, 'set'>>) => void;
}

export const useSettings = create<MobileSettings>()(
  persist(
    (set) => ({
      serverUrl: DEFAULT_SERVER_URL,
      speaker: true,
      selfMute: false,
      selfDeaf: false,
      userVolumes: {},
      streamVolumes: {},
      noiseSuppression: true,
      echoCancellation: true,
      autoGainControl: true,
      voiceActivity: true,
      vadAuto: true,
      vadThresholdDb: -50,
      haptics: true,
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
