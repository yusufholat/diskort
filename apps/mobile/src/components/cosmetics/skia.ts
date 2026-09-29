// Skia (@shopify/react-native-skia) yalnızca yerel modülü olan uygulamada yüklenir. JavaScript paketi
// kablosuz (OTA) güncellemeyle yerel kısmı eski bir APK'ya / IPA'ya ulaşırsa paket açılırken Skia'nın
// yerel modülünü arar ve uygulama çöker; bu yüzden (src/video.ts'teki gibi) paket hiçbir zaman doğrudan
// içe aktarılmaz: önce modülün varlığı denetlenir, paket yalnızca varsa require edilir.
// Yoksa hareketli kozmetikler hiç çizilmez (seçicide de sunulmaz).
//
// Not: OTA sunucusu güncellemeyi yalnızca yerel parmak izi (runtimeVersion) aynı olan uygulamaya verir;
// Skia'yı ekleyen sürüm parmak izini değiştirdiğinden eski APK'lar bu paketi zaten almaz. Bu denetim ikinci
// güvencedir (ör. yerel modül derlemede bağlanamadıysa).
//
// Neden require'ı try/catch ile sarmak yetmiyor: Metro'nun require'ı modülü ilk kez çalıştırırken (başka bir
// modülün yüklenmesi içinde değilsek) hatayı çağırana fırlatmaz, ErrorUtils.reportFatalError ile ÖLÜMCÜL
// bildirir (metro-runtime/src/polyfills/require.js, guardedLoadModule). Skia'nın paketi açılırken
// (src/skia/NativeSetup.ts) global.SkiaApi yoksa yerel install()'ı çağırır ve false dönerse hata fırlatır;
// Android'de install() yeniden başlatma sırasında (React örneği kaldırılmışken) false dönebilir
// (RNSkiaModule.java: JavaScriptContextHolder yoksa SkiaManager kurulamaz). Bu yüzden:
//  1. install()'ı paketten önce biz çağırırız; false dönerse ya da fırlatırsa paket hiç require edilmez.
//  2. Kurulum başarılıysa global.SkiaApi vardır: paket install()'ı yeniden çağırmaz, fırlatacak bir şey kalmaz.
//  3. Yine de require geçici bir küresel hata işleyicisiyle yapılır: beklenmeyen bir açılış hatası ölümcül
//     değil, "Skia yok" olur.
//  4. Kurulum React çizimi içinde hiç yapılmaz: uygulama açılışında bir kez (initSkia, _layout.tsx); çizimdeki
//     skia() / hasSkia() yalnızca sonucu okur.

import { useSyncExternalStore } from 'react';
import { TurboModuleRegistry } from 'react-native';
import { reportClientError } from '@diskort/client-core';
import type * as ReactNativeSkia from '@shopify/react-native-skia';

export type SkiaModule = typeof ReactNativeSkia;

interface NativeSkiaModule {
  install?: () => unknown;
}

/** Skia'yı kurmanın dış bağımlılıkları (testlerde sahteleri verilir) */
export interface SkiaEnv {
  /** TurboModuleRegistry.get('RNSkiaModule') */
  nativeModule: () => NativeSkiaModule | null | undefined;
  /** Paketin kurduğu JSI küreselleri (global.SkiaApi) */
  global: { SkiaApi?: unknown };
  /** require('@shopify/react-native-skia'); açılış hatası fırlatabilir ya da (Metro'da) undefined dönebilir */
  requireSkia: () => SkiaModule | undefined;
  /** Kurulamadıysa bir kez, ölümcül olmayan bildirim */
  report: (error: Error) => void;
}

export type SkiaLoadResult = { module: SkiaModule } | { module: null; error?: Error };

const errorOf = (err: unknown): Error => (err instanceof Error ? err : new Error(String(err)));

/**
 * Skia'yı kurar ve paketi yükler; hiçbir durumda fırlatmaz. Yerel modül yoksa (eski APK) sessizce null;
 * yerel modül var ama kurulamadıysa null ve bir bildirim.
 */
export function loadSkia(env: SkiaEnv): SkiaLoadResult {
  let native: NativeSkiaModule | null | undefined;
  try {
    native = env.nativeModule();
  } catch {
    native = null;
  }
  // Yerel modülü olmayan uygulama: beklenen durum, bildirilmez
  if (native == null) return { module: null };

  const fail = (error: Error): SkiaLoadResult => {
    try {
      env.report(error);
    } catch {
      // bildirim hatası: yapılacak bir şey yok
    }
    return { module: null, error };
  };

  if (env.global.SkiaApi == null) {
    if (typeof native.install !== 'function') return fail(new Error('Skia: yerel modülde install() yok'));
    let result: unknown;
    try {
      result = native.install();
    } catch (err) {
      return fail(new Error(`Skia: install() hata verdi: ${errorOf(err).message}`));
    }
    if (result !== true) return fail(new Error(`Skia: install() başarısız (sonuç: ${String(result)})`));
    // install() true dönüp küreseli kurmadıysa paket yeniden install() çağırır ve bozuk bir Skia nesnesi kurar
    if (env.global.SkiaApi == null) return fail(new Error('Skia: install() sonrası SkiaApi yok'));
  }

  let mod: SkiaModule | undefined;
  try {
    mod = env.requireSkia();
  } catch (err) {
    return fail(new Error(`Skia: paket yüklenemedi: ${errorOf(err).message}`));
  }
  if (!mod || !mod.Skia || typeof mod.Skia.PictureRecorder !== 'function') {
    return fail(new Error('Skia: paket yüklendi ama Skia nesnesi eksik'));
  }
  return { module: mod };
}

/**
 * Metro'nun require'ını küresel hata işleyicisi geçici olarak değiştirilmiş halde çalıştırır: modülün açılış
 * hatası ölümcül bildirilmek yerine burada yakalanıp fırlatılır (bkz. dosyanın başı, madde 3).
 */
export function requireGuarded(load: () => SkiaModule): SkiaModule | undefined {
  const utils = (globalThis as { ErrorUtils?: typeof ErrorUtils }).ErrorUtils;
  if (!utils) return load();
  const previous = utils.getGlobalHandler();
  let caught: unknown;
  let failed = false;
  utils.setGlobalHandler((error) => {
    failed = true;
    caught = error;
  });
  let mod: SkiaModule | undefined;
  try {
    mod = load();
  } finally {
    utils.setGlobalHandler(previous);
  }
  if (failed) throw errorOf(caught);
  return mod;
}

/** Bu çalıştırma bir OTA güncellemesiyle mi açıldı (yeniden başlatma sonrası mı): bildirime eklenir */
function launchInfo(): string {
  try {
    // Koşullu require: expo-updates'in yerel modülü olmayan ortamda da hata vermesin
    const Updates = require('expo-updates') as typeof import('expo-updates');
    return `gömülü=${String(Updates.isEmbeddedLaunch)} updateId=${Updates.updateId ?? 'yok'}`;
  } catch {
    return 'açılış bilgisi yok';
  }
}

let loaded: SkiaModule | null | undefined;
const listeners = new Set<() => void>();

/**
 * Skia'yı bir kez kurar (uygulama açılışında, React çiziminin dışında çağrılır; bkz. _layout.tsx).
 * Hiçbir durumda fırlatmaz; ikinci çağrı bir şey yapmaz.
 */
export function initSkia(): void {
  if (loaded !== undefined) return;
  const result = loadSkia({
    nativeModule: () => TurboModuleRegistry.get('RNSkiaModule') as NativeSkiaModule | null,
    global: globalThis as { SkiaApi?: unknown },
    // Koşullu ve geç yükleme: import ile değil require ile (bkz. dosyanın başı)
    requireSkia: () => requireGuarded(() => require('@shopify/react-native-skia') as SkiaModule),
    report: (error) => {
      console.warn('[kozmetik] Skia kurulamadı, hareketli kozmetikler kapalı:', error);
      reportClientError(new Error(`${error.message} (${launchInfo()})`), 'skia');
    },
  });
  loaded = result.module;
  for (const fn of listeners) fn();
}

/** Skia paketi (kurulduysa); kurulmadıysa, kurulamadıysa ya da henüz kurulmadıysa null. Kurulum yapmaz. */
export function skia(): SkiaModule | null {
  return loaded ?? null;
}

/** Bu uygulama hareketli kozmetikleri çizebilir mi (Skia kuruldu mu). Kurulum yapmaz. */
export function hasSkia(): boolean {
  return skia() !== null;
}

const subscribe = (fn: () => void): (() => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/** hasSkia() bileşen içinde: Skia açılışta kurulunca bileşen yeniden çizilir */
export function useHasSkia(): boolean {
  return useSyncExternalStore(subscribe, hasSkia);
}
