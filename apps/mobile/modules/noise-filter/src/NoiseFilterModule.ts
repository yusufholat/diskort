import { NativeModule, requireOptionalNativeModule } from 'expo';

/** DPDFNet'in anlık durumu ve son 2 saniyenin ölçümleri */
export interface NoiseFilterStatus {
  /** Model yüklü, WebRTC'ye takılı ve devre dışı kalmadı */
  active: boolean;
  /** Son 1 saniyede kare işlendi (mikrofon açık, 48 kHz) */
  processing: boolean;
  /** Çalışmıyorsa nedeni (ör. "yavaş: kare başına 7,1 ms") */
  reason: string | null;
  /** WebRTC'nin ses işleme hızı (Hz); model yalnızca 48000'de çalışır */
  sampleRate: number;
  /** Isınmada ölçülen kare başına süre (ms) */
  warmupMs: number;
  avgMs: number | null;
  maxMs: number | null;
  /** Ses iş parçacığının modelle geçirdiği zaman oranı (0–1) */
  load: number | null;
  frames: number;
  /** Son pencerede 10 ms'yi aşan kareler */
  overHop: number;
}

export type NoiseFilterEvents = {
  onBypass: (params: { reason: string }) => void;
};

declare class NoiseFilterModule extends NativeModule<NoiseFilterEvents> {
  isSupported(): boolean;
  configure(enabled: boolean, attenLimitDb: number): Promise<NoiseFilterStatus>;
  setAttenLimit(db: number): void;
  getStats(): NoiseFilterStatus;
}

/** Eski APK'larda (kablosuz güncellemeyle yeni JS almış) yerel modül yoktur: null */
export default requireOptionalNativeModule<NoiseFilterModule>('DiskortNoiseFilter');
