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
  // "?" alanlar eski APK'larda yoktur (kablosuz güncellemeyle yeni JS almış olanlar)
  /** Isınmada kare süresinin modele (ONNX Runtime) düşen kısmı; kalanı STFT/ISTFT */
  warmupModelMs?: number | null;
  /** Isınmanın ilk yarısında kare süresi (ikinci yarıdan çok yüksekse işlemci frekansı yükseliyordu) */
  warmupFirstMs?: number | null;
  /** Isınmanın bittiği çekirdek, ör. "7 (2600 MHz)" */
  warmupCore?: string | null;
  /** Modeli çalıştıran ONNX Runtime yürütücüsü: "CPU" ya da "XNNPACK" */
  provider?: string | null;
  /** Android'in başarım ipucu (ADPF) açıldı mı (Android 12+; üretici desteklemiyorsa false) */
  hint?: boolean | null;
  avgMs: number | null;
  /** Ortalamanın modele düşen kısmı (ms) */
  modelMs?: number | null;
  maxMs: number | null;
  /** Ses iş parçacığının modelle geçirdiği zaman oranı (0–1) */
  load: number | null;
  frames: number;
  /** Son pencerede 10 ms'yi aşan kareler */
  overHop: number;
  /** Ses iş parçacığının son çalıştığı çekirdek, ör. "2 (1800 MHz)" */
  audioCore?: string | null;
  /** Çekirdek kümeleri, ör. "6×2000 + 2×2600 MHz" */
  cpu?: string | null;
  /** Yonga (Android 12+: üretici ve model; öncesi Build.HARDWARE) */
  soc?: string | null;
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
