import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export const DEFAULT_SERVER_URL = 'https://diskort.ziroo.net';

/**
 * Gürültü engelleme: DPDFNet (telefonda çalışan yapay zekâ modeli; masaüstündekiyle aynı), WebRTC'nin
 * standart engelleyicisi ya da kapalı. DPDFNet'i desteklemeyen APK'larda (yerel modül yok) standart kullanılır.
 */
export type NoiseMode = 'dpdfnet' | 'standard' | 'off';
/** DPDFNet'in bastırma sınırı (dB); 100 = sınırsız. Masaüstündeki seçeneklerle aynı. */
export type NoiseStrengthDb = 12 | 24 | 40 | 100;

interface MobileSettings {
  serverUrl: string;
  /** Sesli sohbette hoparlör (true) ya da ahize (false); kulaklık/Bluetooth takılıysa o kullanılır */
  speaker: boolean;
  selfMute: boolean;
  selfDeaf: boolean;
  /** Kişi başı ses seviyesi ve izlenen yayının ses seviyesi (0–2); yalnızca %100'den farklı olanlar tutulur */
  userVolumes: Record<string, number>;
  streamVolumes: Record<string, number>;
  /** Yayın sesi sessize alınan yayıncılar (seviye korunur; açınca ona dönülür) */
  streamMuted: Record<string, true>;
  /** Mikrofon işleme (WebRTC ve telefonun kendi ses işlemcisi); sesli sohbete katılırken uygulanır */
  noiseMode: NoiseMode;
  /** DPDFNet'in gücü; sesli sohbetteyken de anında uygulanır */
  noiseStrengthDb: NoiseStrengthDb;
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
  /** Sesli sohbet sesleri: katıl/ayrıl, sustur, sağırlaştır, yayın, biri girdi/çıktı (bkz. sounds.ts) */
  sounds: boolean;
  /** Arayüz seslerinin seviyesi (0–1; telefonun medya sesiyle çarpılır) */
  sfxVolume: number;
  /** Uygulama açıkken bahsedilince ve direkt mesaj gelince ses (Rahatsız Etmeyin durumunda çalmaz) */
  notificationSound: boolean;
  /** Mesajlardaki bağlantıların önizlemeleri (kart, YouTube, resim) gösterilsin mi */
  linkPreviews: boolean;
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
      streamMuted: {},
      noiseMode: 'dpdfnet',
      noiseStrengthDb: 24,
      echoCancellation: true,
      autoGainControl: true,
      voiceActivity: true,
      vadAuto: true,
      vadThresholdDb: -50,
      haptics: true,
      sounds: true,
      sfxVolume: 1,
      notificationSound: true,
      linkPreviews: true,
      set: (patch) => set(patch),
    }),
    {
      name: 'diskort-settings',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ set: _set, ...rest }) => rest,
      // Sürüm 0 → 1: gürültü engelleme açık/kapalı yerine türü (DPDFNet/standart/kapalı). Açık olan herkes
      // DPDFNet'e geçer (destek yoksa standart çalışır).
      // Sürüm 1 → 2: ses paketleri kaldırıldı (tek ses takımı); kayıtlı soundPack ayarı silinir.
      version: 2,
      migrate: (persisted, version) => {
        let state = (persisted ?? {}) as Record<string, unknown>;
        if (version < 1) {
          const { noiseSuppression, ...rest } = state;
          state = { ...rest, noiseMode: noiseSuppression === false ? 'off' : 'dpdfnet' };
        }
        if (version < 2) {
          const { soundPack: _soundPack, ...rest } = state;
          state = rest;
        }
        return state as unknown as MobileSettings;
      },
    },
  ),
);

export const getSettings = () => useSettings.getState();
