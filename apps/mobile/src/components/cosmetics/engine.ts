// Hareketli kozmetiklerin telefondaki çizim motoru (masaüstündeki engine.ts'in karşılığı). Tek bir
// requestAnimationFrame döngüsü: her görünüm (profil kartı, dekorasyon, isim plakası, seçici kutusu) karesi
// gelince bir Skia resmine (SkPicture) kaydedilir: önce setin gölgelendiricisi (SkSL'e çevrilmiş ortak
// kaynak), üstüne 2B katman. Resim görünümün yerel Skia yüzeyine verilir, çizimi yerel taraf yapar;
// React yeniden çizilmez. Ekranda olmayan görünüm (ölçülerek bulunur), odakta olmayan ekran ve arka plandaki
// uygulama çizilmez; hiç çizilecek görünüm yoksa döngü durur. "Hareketi azalt" açıkken her görünüm tek bir
// sabit kare olarak çizilir. Gölgelendirici derlenemezse 2B yedek zemin kullanılır.

import { AccessibilityInfo, AppState, Dimensions } from 'react-native';
import type { CosmeticSet } from '@diskort/shared';
import type { ShaderViewKind } from '@diskort/client-core';
import type { SkPicture } from '@shopify/react-native-skia';
import { compileCosmetic, drawCosmetic, type CosmeticProgram } from './draw';
import type { CardGeo, LayerView } from './layers';
import { skia } from './skia';

/** "Hareketi azalt" açıkken gösterilen anın zamanı (her set için dolu, güzel bir kare) */
export const STATIC_T = 8.4;
/** Saniyedeki en fazla kare (verilmezse) */
const MAX_FPS = 60;
/** Görünümlerin ekranda olup olmadığı bu aralıkla ölçülür (ms) */
const MEASURE_MS = 500;

export interface ViewOptions {
  kind: ShaderViewKind;
  set: CosmeticSet;
  /** Dekorasyonda avatarın yarıçapı (px) */
  R?: number;
  /** Çizim yüzeyinin çözünürlük katı (1'den küçükse yüzey küçük çizilip büyütülür) */
  scale?: number;
  /** Saniyedeki en fazla kare (isim plakası, seçici kutuları 30) */
  fps?: number;
  /** Durdurulmuş: son kare sabit kalır (ör. sesli sahnede konuşmayan katılımcı) */
  paused?: boolean;
  /** Karadelik kartı gibi ağır görünümler: gürültünün katmanı azaltılır */
  lite?: boolean;
  /** Görünümün bulunduğu ekran odakta mı (başka bir ekranın altında kalan çizilmez) */
  focused?: boolean;
  /** Görünümün pencerede görünür olup olmadığını ölçer (verilmezse hep görünür sayılır) */
  measure?: (done: (visible: boolean) => void) => void;
  w?: number;
  h?: number;
  geo?: CardGeo;
}

export interface ViewHandle {
  update(options: Partial<Omit<ViewOptions, 'kind'>>): void;
  dispose(): void;
}

interface View extends LayerView {
  nativeId: number;
  set: CosmeticSet;
  scale: number;
  fps: number;
  paused: boolean;
  lite: boolean;
  focused: boolean;
  visible: boolean;
  measure?: ViewOptions['measure'];
  /** Son çizimin zamanı (ms) */
  last: number;
  /** Yeniden çizilmeli (ayar değişti, sabit kare) */
  dirty: boolean;
  /** Çizimi hata verdi: bir daha denenmez */
  broken: boolean;
  pic: SkPicture | null;
}


const views = new Set<View>();
let T = 0;
let raf = 0;
let last = 0;
let appActive = AppState.currentState === 'active' || AppState.currentState == null;
let reduced = false;
let started = false;
let measureTimer: ReturnType<typeof setInterval> | null = null;

/** Uygulamanın durumu ve "Hareketi azalt" ayarı: ilk görünüm eklenince dinlenmeye başlar */
function start(): void {
  if (started) return;
  started = true;
  AppState.addEventListener('change', (state) => {
    appActive = state === 'active';
    if (appActive) {
      for (const v of views) v.dirty = true;
      kick();
    } else stop();
  });
  const setReduced = (on: boolean): void => {
    reduced = on;
    for (const v of views) v.dirty = true;
    kick();
  };
  AccessibilityInfo.isReduceMotionEnabled()
    .then(setReduced)
    .catch(() => undefined);
  AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
}

// ---------- Gölgelendiriciler ----------

const programs = new Map<string, CosmeticProgram | null>();

function program(set: CosmeticSet, lite: boolean): CosmeticProgram | null {
  const key = `${set}|${lite ? 1 : 0}`;
  const known = programs.get(key);
  if (known !== undefined) return known;
  programs.set(key, null);
  const sk = skia();
  if (!sk) return null;
  try {
    const prog = compileCosmetic(sk.Skia, set, lite);
    if (!prog) {
      console.warn(`[kozmetik:${set}] gölgelendirici derlenemedi, 2B çizime geçiliyor`);
      return null;
    }
    programs.set(key, prog);
    return prog;
  } catch (err) {
    console.warn(`[kozmetik:${set}] gölgelendirici derlenemedi, 2B çizime geçiliyor:`, err);
    return null;
  }
}

// ---------- Çizim ----------

function render(v: View, t: number): void {
  const sk = skia();
  if (!sk || v.w < 2 || v.h < 2) return;
  const S = sk.Skia;
  const k = v.scale;
  const rec = S.PictureRecorder();
  const canvas = rec.beginRecording(S.XYWHRect(0, 0, v.w * k, v.h * k));
  // Yüzey css pikselinin k katı: bütün çizim css pikseliyle yapılır (gölgelendiricinin koordinatı da)
  canvas.scale(k, k);
  drawCosmetic(S, canvas, v, t, program(v.set, v.lite));
  const pic = rec.finishRecordingAsPicture();
  rec.dispose();
  // Resim yerel görünüme verilir (yerel taraf kendi kopyasını tutar, eskisi bırakılabilir)
  viewApi().setJsiProperty(v.nativeId, 'picture', pic);
  v.pic?.dispose();
  v.pic = pic;
}

/** Skia'nın yerel görünümlerine erişim (paket yüklenince küresel olarak kurulur) */
const viewApi = (): { setJsiProperty(nativeId: number, name: string, value: unknown): void } =>
  (globalThis as unknown as { SkiaViewApi: ReturnType<typeof viewApi> }).SkiaViewApi;

function frame(now: number): void {
  raf = 0;
  const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
  last = now;
  if (reduced) T = STATIC_T;
  else T += dt;
  let running = false;
  const due: View[] = [];
  for (const v of views) {
    if (!v.visible || !v.focused || v.broken || v.w < 2 || v.h < 2) continue;
    // Hareketi azalt açıkken ya da durdurulmuş görünümde yalnızca değişince tek kare çizilir
    if (reduced || v.paused) {
      if (v.dirty) due.push(v);
      v.dirty = false;
      continue;
    }
    running = true;
    // Kare sınırı: bir sonraki çizime kalan süre yarım kareden azsa şimdi çizilir
    if (!v.dirty && now - v.last < 1000 / v.fps - 8) continue;
    due.push(v);
    v.last = now;
    v.dirty = false;
  }
  for (const v of due) {
    try {
      render(v, T);
    } catch (err) {
      v.broken = true;
      console.warn(`[kozmetik:${v.set}] çizilemedi:`, err);
    }
  }
  if (running && appActive) raf = requestAnimationFrame(frame);
  else last = 0;
}

function kick(): void {
  if (!raf && appActive && views.size > 0) raf = requestAnimationFrame(frame);
  if (!measureTimer && appActive && views.size > 0) measureTimer = setInterval(measureAll, MEASURE_MS);
}

function stop(): void {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  last = 0;
  if (measureTimer) clearInterval(measureTimer);
  measureTimer = null;
}

/** Görünümlerin ekranda olup olmadığı (kaydırılan listeler, ayarlar sayfası) */
function measureAll(): void {
  if (views.size === 0 || !appActive) {
    stop();
    return;
  }
  for (const v of views) {
    if (!v.measure || !v.focused) continue;
    v.measure((visible) => {
      if (visible === v.visible || !views.has(v)) return;
      v.visible = visible;
      if (visible) {
        v.dirty = true;
        kick();
      }
    });
  }
}

/** Ölçülen dikdörtgen pencerede görünür mü (biraz pay bırakılır: kaydırırken geç kalmasın) */
export function onScreen(x: number, y: number, w: number, h: number): boolean {
  const win = Dimensions.get('window');
  const m = 40;
  return w > 0 && h > 0 && x + w > -m && y + h > -m && x < win.width + m && y < win.height + m;
}

/** Yerel Skia görünümünü (nativeId) motora bağlar; dönen tutamaçla ayarları değiştirilir, kalkınca bırakılır */
export function attachView(nativeId: number, options: ViewOptions): ViewHandle {
  start();
  const v: View = {
    nativeId,
    kind: options.kind,
    set: options.set,
    w: options.w ?? 0,
    h: options.h ?? 0,
    cache: new Map(),
    geo: options.geo ?? { bh: 106, ax: 62, ay: 112, ar: 46 },
    R: options.R ?? 46,
    scale: options.scale ?? 1,
    fps: options.fps ?? MAX_FPS,
    paused: options.paused ?? false,
    lite: options.lite ?? false,
    focused: options.focused ?? true,
    visible: true,
    measure: options.measure,
    last: 0,
    dirty: true,
    broken: false,
    pic: null,
  };
  views.add(v);
  kick();
  return {
    update(next) {
      let reset = false;
      if (next.set !== undefined && next.set !== v.set) {
        v.set = next.set;
        reset = true;
      }
      if (next.R !== undefined && next.R !== v.R) {
        v.R = next.R;
        reset = true;
      }
      if (next.w !== undefined && next.h !== undefined && (next.w !== v.w || next.h !== v.h)) {
        v.w = next.w;
        v.h = next.h;
        reset = true;
      }
      if (next.geo && (next.geo.bh !== v.geo.bh || next.geo.ax !== v.geo.ax || next.geo.ay !== v.geo.ay || next.geo.ar !== v.geo.ar)) {
        v.geo = next.geo;
        reset = true;
      }
      // Katmanların hazır listeleri (parçacıklar, dendritler) boyuta ve kartın ölçülerine göre kurulur
      if (reset) {
        v.cache.clear();
        v.broken = false;
      }
      if (next.scale !== undefined) v.scale = next.scale;
      if (next.fps !== undefined) v.fps = next.fps;
      if (next.paused !== undefined) v.paused = next.paused;
      if (next.lite !== undefined) v.lite = next.lite;
      if (next.focused !== undefined) v.focused = next.focused;
      if (next.measure !== undefined) v.measure = next.measure;
      v.dirty = true;
      kick();
    },
    dispose() {
      views.delete(v);
      v.pic?.dispose();
      v.pic = null;
      if (views.size === 0) stop();
    },
  };
}

/** Geliştirme ve ölçüm için: kaç görünüm var, kaçı çiziliyor (türlerine göre) */
export function cosmeticsStats(): { views: number; drawing: Record<string, number>; reduced: boolean } {
  const drawing: Record<string, number> = {};
  for (const v of views) if (v.visible && v.focused && !v.broken) drawing[v.kind] = (drawing[v.kind] ?? 0) + 1;
  return { views: views.size, drawing, reduced };
}
