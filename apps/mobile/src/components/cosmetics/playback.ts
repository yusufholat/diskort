// Paylaşılan oynatıcıların (packPlayer.ts) uygulamadaki tek örneği: Skia sürücüsü, uygulamanın durumu (önde mi),
// "hareketi azalt" ayarı, görünümlerin ekranda olup olmadığının ölçümü ve yüklenemeyen dosyaların yeniden
// denenmesi. İlk görünüm bağlanınca kurulur.

import { useSyncExternalStore } from 'react';
import { AccessibilityInfo, AppState, Dimensions, Platform } from 'react-native';
import { cosmeticAssetFailed, useCosmeticPacks, useGuild } from '@diskort/client-core';
import { prefersReducedMotion } from '../../motion';
import { createSkiaDriver, type Frame } from './packDriver';
import { watchPackFiles } from './packFiles';
import { createPlayback, type Playback } from './packPlayer';
import { reportCosmeticError } from './report';

let instance: Playback<Frame | null> | null = null;

/**
 * Oynatıcılar için uygulama önde mi. iOS'ta `inactive` kısa bir ara durumdur (Denetim Merkezi, uygulama
 * değiştirici, Face ID sorusu): oynatıcılar yalnızca `background`da bırakılır, yoksa her seferinde sabit resim
 * yanıp söner ve video yeniden açılırdı. Android'de öndeki durum dışındaki her durumda bırakılır (sistem arka
 * plandaki uygulamanın video çözücüsünü geri alabilir).
 */
function foreground(state: string | null | undefined): boolean {
  if (state == null || state === 'active') return true;
  return Platform.OS === 'ios' && state === 'inactive';
}

export function playback(): Playback<Frame | null> {
  if (instance) return instance;
  const created = createPlayback<Frame | null>({
    driver: createSkiaDriver({ manualVideoLoop: Platform.OS === 'android' }),
    timers: {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      setInterval: (fn, ms) => setInterval(fn, ms),
      clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
      nextFrame: (fn) => void requestAnimationFrame(fn),
    },
    onError: (spec, error, kind) => {
      reportCosmeticError(spec.kind === 'video' ? 'video' : 'hareketli resim', error);
      // İndirilemeyen ya da çözülemeyen dosya: bildirim eskimiş olabilir (paket yeniden yayınlanmış, kaldırılmış).
      // Telefonun kareleri yetiştirememesi ya da aynı anda çok dosya oynaması dosyanın kusuru değildir.
      if (kind === 'transient' || kind === 'asset') cosmeticAssetFailed(spec.url);
    },
  });
  instance = created;
  created.setAppActive(foreground(AppState.currentState));
  AppState.addEventListener('change', (state) => created.setAppActive(foreground(state)));
  // Açılışta okunmuş değer (src/motion.ts) hemen, güncel değer sorulunca
  created.setReducedMotion(prefersReducedMotion());
  AccessibilityInfo.isReduceMotionEnabled()
    .then((on) => created.setReducedMotion(on))
    .catch(() => undefined);
  AccessibilityInfo.addEventListener('reduceMotionChanged', (on) => created.setReducedMotion(on));
  watchPackFiles();
  return created;
}

// ---------- Yeniden deneme ----------

let epoch = 0;
const listeners = new Set<() => void>();
let watching = false;

/** Yüklenemeyen dosyalar yeniden denenir: oynatıcılar hemen, sabit resimler (bileşenlerde) sayaç değişince */
function retryAll(): void {
  epoch++;
  instance?.retry();
  for (const fn of listeners) fn();
}

/**
 * Yeniden denemenin tetikleyicileri: paket bildirimi değişti (yeni sürüm, yeni adresler) ya da sunucu bağlantısı
 * geri geldi. İkinci çağrı bir şey yapmaz.
 */
function watchRetries(): void {
  if (watching) return;
  watching = true;
  useCosmeticPacks.subscribe((state, previous) => {
    if (state.manifest !== previous.manifest) retryAll();
  });
  useGuild.subscribe((state, previous) => {
    if (state.status === 'ready' && previous.status !== 'ready') retryAll();
  });
}

const subscribe = (fn: () => void): (() => void) => {
  watchRetries();
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/** Yeniden deneme sayacı: değişince yüklenememiş sabit resim yeniden istenir (bileşen yeniden kurulmadan) */
export function useRetryEpoch(): number {
  return useSyncExternalStore(subscribe, () => epoch);
}

/** Ölçülen dikdörtgen pencerede görünür mü (biraz pay bırakılır: kaydırırken geç kalmasın) */
export function onScreen(x: number, y: number, w: number, h: number): boolean {
  const win = Dimensions.get('window');
  const m = 40;
  return w > 0 && h > 0 && x + w > -m && y + h > -m && x < win.width + m && y < win.height + m;
}
