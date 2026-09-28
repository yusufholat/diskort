import { NativeModule, requireOptionalNativeModule } from 'expo';

declare class GalleryModule extends NativeModule {
  /** Bu telefonda izinsiz kaydedilebilir mi (Android 10+) */
  isSupported(): boolean;
  /**
   * Yerel dosyayı (file://) telefonun galerisine kopyalar: resimler Pictures/Diskort, videolar
   * Movies/Diskort klasörüne. Aynı ad varsa Android yeni ad verir. Sonuç: galerideki içerik adresi.
   */
  save(uri: string, name: string, mimeType: string): Promise<string>;
}

/** Eski APK'larda ve iOS'ta yoktur: null (galeriye kaydetme düğmesi görünmez) */
export default requireOptionalNativeModule<GalleryModule>('DiskortGallery');
