import { NativeModule, requireOptionalNativeModule } from 'expo';

declare class CrashReporterModule extends NativeModule {
  /**
   * Çökme raporuna eklenecek JavaScript bağlamı (sürüm, güncelleme, açık ekran). Ucuzdur: ekran değiştikçe
   * çağrılır. Android 11+'da başı sistemin çıkış kaydına da yazılır (yerel çökmelerde tek bağlam budur).
   */
  setCrashContext(info: string): void;
  /**
   * Önceki çalıştırmalardan bekleyen çökme raporları: her biri bir JSON nesnesinin metni (bkz.
   * src/crashReports.ts). Okunanlar silinir; çıkış kayıtları bir kez döner.
   */
  takePendingCrashes(): Promise<string[]>;
}

/** Eski APK'larda (kablosuz güncellemeyle yeni JS almış) ve iOS'ta yerel modül yoktur: null */
export default requireOptionalNativeModule<CrashReporterModule>('DiskortCrashReporter');
