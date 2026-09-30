// Paylaşılan oynatıcıların (packPlayer.ts) uygulamadaki tek örneği: Skia sürücüsü, uygulamanın durumu (önde mi),
// "hareketi azalt" ayarı ve görünümlerin ekranda olup olmadığının ölçümü. İlk görünüm bağlanınca kurulur.

import { AccessibilityInfo, AppState, Dimensions, Platform } from 'react-native';
import { prefersReducedMotion } from '../../motion';
import { createSkiaDriver, type Frame } from './packDriver';
import { watchPackFiles } from './packFiles';
import { createPlayback, type Playback } from './packPlayer';
import { reportCosmeticError } from './report';

let instance: Playback<Frame> | null = null;

export function playback(): Playback<Frame> {
  if (instance) return instance;
  const created = createPlayback<Frame>({
    driver: createSkiaDriver({ manualVideoLoop: Platform.OS === 'android' }),
    timers: {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      setInterval: (fn, ms) => setInterval(fn, ms),
      clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
      nextFrame: (fn) => void requestAnimationFrame(fn),
    },
    onError: (spec, error) => reportCosmeticError(spec.kind === 'video' ? 'video' : 'hareketli resim', error),
  });
  instance = created;
  created.setAppActive(AppState.currentState === 'active' || AppState.currentState == null);
  AppState.addEventListener('change', (state) => created.setAppActive(state === 'active'));
  // Açılışta okunmuş değer (src/motion.ts) hemen, güncel değer sorulunca
  created.setReducedMotion(prefersReducedMotion());
  AccessibilityInfo.isReduceMotionEnabled()
    .then((on) => created.setReducedMotion(on))
    .catch(() => undefined);
  AccessibilityInfo.addEventListener('reduceMotionChanged', (on) => created.setReducedMotion(on));
  watchPackFiles();
  return created;
}

/** Ölçülen dikdörtgen pencerede görünür mü (biraz pay bırakılır: kaydırırken geç kalmasın) */
export function onScreen(x: number, y: number, w: number, h: number): boolean {
  const win = Dimensions.get('window');
  const m = 40;
  return w > 0 && h > 0 && x + w > -m && y + h > -m && x < win.width + m && y < win.height + m;
}
