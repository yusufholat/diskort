// Skia (@shopify/react-native-skia) yalnızca yerel modülü olan uygulamada yüklenir. JavaScript paketi
// kablosuz (OTA) güncellemeyle yerel kısmı eski bir APK'ya / IPA'ya ulaşırsa paket açılırken Skia'nın
// yerel modülünü arar ve uygulama çöker; bu yüzden (src/video.ts'teki gibi) paket hiçbir zaman doğrudan
// içe aktarılmaz: önce modülün varlığı denetlenir, paket yalnızca varsa ve ilk kullanımda require edilir.
// Yoksa hareketli kozmetikler hiç çizilmez (seçicide de sunulmaz).
//
// Not: OTA sunucusu güncellemeyi yalnızca yerel parmak izi (runtimeVersion) aynı olan uygulamaya verir;
// Skia'yı ekleyen sürüm parmak izini değiştirdiğinden eski APK'lar bu paketi zaten almaz. Bu denetim ikinci
// güvencedir (ör. yerel modül derlemede bağlanamadıysa).

import { TurboModuleRegistry } from 'react-native';
import type * as ReactNativeSkia from '@shopify/react-native-skia';

export type SkiaModule = typeof ReactNativeSkia;

let loaded: SkiaModule | null | undefined;

/** Skia paketi (yalnızca yerel modül varsa, ilk çağrıda yüklenir); yoksa ya da kurulamadıysa null */
export function skia(): SkiaModule | null {
  if (loaded !== undefined) return loaded;
  loaded = null;
  try {
    if (TurboModuleRegistry.get('RNSkiaModule') == null) return null;
    // Koşullu ve geç yükleme: import ile değil require ile (bkz. dosyanın başı)
    const mod = require('@shopify/react-native-skia') as SkiaModule;
    // Paket yüklenirken JSI bağlarını kurar; kuramadıysa Skia nesnesi yoktur
    if (!mod.Skia || typeof mod.Skia.PictureRecorder !== 'function') return null;
    loaded = mod;
  } catch (err) {
    console.warn('[kozmetik] Skia yüklenemedi, hareketli kozmetikler kapalı:', err);
    loaded = null;
  }
  return loaded;
}

/** Bu uygulama hareketli kozmetikleri çizebilir mi (Skia'nın yerel modülü var mı) */
export function hasSkia(): boolean {
  return skia() !== null;
}
