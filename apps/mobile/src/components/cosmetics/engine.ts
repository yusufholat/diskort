// Hareketli kozmetiklerin telefondaki çizim motoru (masaüstündeki engine.ts'in karşılığı). Tek bir
// requestAnimationFrame döngüsü: her görünüm (profil kartı, dekorasyon, isim plakası, seçici kutusu) karesi
// gelince bir Skia resmine (SkPicture) kaydedilir: önce setin gölgelendiricisi (SkSL'e çevrilmiş ortak
// kaynak), üstüne 2B katman. Resim görünümün yerel Skia yüzeyine verilir, çizimi yerel taraf yapar;
// React yeniden çizilmez. Ekranda olmayan görünüm (ölçülerek bulunur), odakta olmayan ekran ve arka plandaki
// uygulama çizilmez; hiç çizilecek görünüm yoksa döngü durur. "Hareketi azalt" açıkken her görünüm tek bir
// sabit kare olarak çizilir. Gölgelendirici derlenemezse 2B yedek zemin kullanılır.
//
// Yerel tarafla sözleşme (Skia 2.6, Android): setJsiProperty resmi JS iş parçacığında yerel görünümün
// çiziciye yazar, çizim ise ana iş parçacığında o resmin bir kopyasıyla yapılır. Aynı anda eski resmin son
// başvurusu JS tarafında bırakılırsa ana iş parçacığı silinmiş resmi okuyabilir (yerel çökme, JS hatası
// bırakmaz). Bu yüzden yerel görünüme verilmiş resim hemen bırakılmaz: RETIRE_MS sonra bırakılır (görünüm
// kalkınca da). Motorun zamanlayıcı ve kare geri çağrıları hiçbir zaman hata fırlatmaz: React Native
// zamanlayıcıdaki yakalanmamış hatayı ölümcül sayar ve uygulamayı kapatır.

import { AccessibilityInfo, AppState, Dimensions } from 'react-native';
import type { CosmeticSet } from '@diskort/shared';
import type { ShaderViewKind } from '@diskort/client-core';
import type { SkPicture } from '@shopify/react-native-skia';
import { compileCosmetic, drawCosmetic, type CosmeticProgram } from './draw';
import { releaseCache, type CardGeo, type LayerView } from './layers';
import { skia } from './skia';

/** "Hareketi azalt" açıkken gösterilen anın zamanı (her set için dolu, güzel bir kare) */
export const STATIC_T = 8.4;
/** Saniyedeki en fazla kare (verilmezse) */
const MAX_FPS = 60;
/** Görünümlerin ekranda olup olmadığı bu aralıkla ölçülür (ms) */
const MEASURE_MS = 500;
/** Yerel görünüme verilmiş, yerini yenisine bırakmış resim bu kadar sonra bırakılır (ms; birkaç kare) */
export const RETIRE_MS = 150;

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
  /** Sabit: tek kare, her set için dolu bir an (STATIC_T); seçicide seçili olmayan seçenekler */
  still?: boolean;
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
  still: boolean;
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
  /** Yerel görünüme en son verilen resim (görünüm onu çizer; bırakılması yenisi gelince ertelenir) */
  pic: SkPicture | null;
  /** Görünüm motordan çıkarıldı: yerel görünüme bir daha dokunulmaz */
  detached: boolean;
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

/** Çizilebilir boyut: sonlu ve en az 2 piksel (NaN karşılaştırmalardan sessizce geçmesin) */
const drawable = (v: View): boolean =>
  Number.isFinite(v.w) && Number.isFinite(v.h) && v.w >= 2 && v.h >= 2 && Number.isFinite(v.scale) && v.scale > 0;

function render(v: View, t: number): void {
  // Kalkmış görünüme (yerel görünümü bırakılmış olabilir) hiçbir şey verilmez
  if (v.detached || !views.has(v) || !drawable(v)) return;
  const sk = skia();
  const api = viewApi();
  if (!sk || !api) return;
  const S = sk.Skia;
  const k = v.scale;
  const rec = S.PictureRecorder();
  let pic: SkPicture;
  try {
    const canvas = rec.beginRecording(S.XYWHRect(0, 0, v.w * k, v.h * k));
    // Yüzey css pikselinin k katı: bütün çizim css pikseliyle yapılır (gölgelendiricinin koordinatı da)
    canvas.scale(k, k);
    drawCosmetic(S, canvas, v, t, program(v.set, v.lite));
    pic = rec.finishRecordingAsPicture();
  } finally {
    rec.dispose();
  }
  try {
    api.setJsiProperty(v.nativeId, 'picture', pic);
  } catch (err) {
    // Yerel tarafa verilemedi: resim kimsede değil, hemen bırakılır
    pic.dispose();
    throw err;
  }
  // Önceki resim ana iş parçacığında hâlâ çiziliyor olabilir: birkaç kare sonra bırakılır
  retire(v.pic);
  v.pic = pic;
}

type ViewApi = { setJsiProperty(nativeId: number, name: string, value: unknown): void };

/** Skia'nın yerel görünümlerine erişim (paket yüklenince küresel olarak kurulur); yoksa null */
function viewApi(): ViewApi | null {
  const api = (globalThis as unknown as { SkiaViewApi?: ViewApi }).SkiaViewApi;
  return api && typeof api.setJsiProperty === 'function' ? api : null;
}

// ---------- Resimlerin bırakılması ----------

/** Yerel görünüme verilmiş, yerini yenisine bırakmış resimler (en eskisi başta) */
const retired: { pic: SkPicture; at: number }[] = [];
let sweepTimer: ReturnType<typeof setTimeout> | null = null;

/** Resmi RETIRE_MS sonra bırakılmak üzere kuyruğa koyar */
function retire(pic: SkPicture | null): void {
  if (!pic) return;
  retired.push({ pic, at: Date.now() });
  if (!sweepTimer) sweepTimer = setTimeout(sweep, RETIRE_MS);
}

/** Süresi dolan resimleri bırakır; kuyrukta kalan varsa yeniden kurulur */
function sweep(): void {
  sweepTimer = null;
  const now = Date.now();
  while (retired.length > 0 && now - retired[0]!.at >= RETIRE_MS) {
    const { pic } = retired.shift()!;
    try {
      pic.dispose();
    } catch {
      // zaten bırakılmış: yapılacak bir şey yok
    }
  }
  if (retired.length > 0) sweepTimer = setTimeout(sweep, Math.max(16, RETIRE_MS - (now - retired[0]!.at)));
}

function frame(now: number): void {
  raf = 0;
  try {
    step(now);
  } catch (err) {
    // Beklenmeyen hata döngüyü (ve uygulamayı) düşürmesin: bir sonraki değişiklikte yeniden başlar
    last = 0;
    console.warn('[kozmetik] kare çizilemedi:', err);
  }
}

function step(now: number): void {
  const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
  last = now;
  if (reduced) T = STATIC_T;
  else T += dt;
  let running = false;
  const due: View[] = [];
  for (const v of views) {
    if (!v.visible || !v.focused || v.broken || v.detached || !drawable(v)) continue;
    // Hareketi azalt açıkken, durdurulmuş ya da sabit görünümde yalnızca değişince tek kare çizilir
    if (reduced || v.paused || v.still) {
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
      render(v, v.still ? STATIC_T : T);
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
  for (const v of views) if (v.focused) measureOne(v);
}

function measureOne(v: View): void {
  if (v.detached || !views.has(v) || !v.measure) return;
  try {
    v.measure((visible) => {
      if (v.detached || !views.has(v) || visible === v.visible) return;
      v.visible = visible;
      if (visible) {
        v.dirty = true;
        kick();
      }
    });
  } catch (err) {
    // Ölçülemeyen görünüm (yerel görünümü kalkmış): bir sonraki ölçümde yeniden denenir
    console.warn('[kozmetik] görünüm ölçülemedi:', err);
  }
}

/** Sonlu sayı ya da yedeği (yerleşimden ya da hesaptan NaN / sonsuz gelirse) */
const finite = (x: number | undefined, fallback: number): number => (x !== undefined && Number.isFinite(x) ? x : fallback);
const finiteGeo = (g: CardGeo | undefined): g is CardGeo =>
  !!g && Number.isFinite(g.bh) && Number.isFinite(g.ax) && Number.isFinite(g.ay) && Number.isFinite(g.ar);

/** Ölçülen dikdörtgen pencerede görünür mü (biraz pay bırakılır: kaydırırken geç kalmasın) */
export function onScreen(x: number, y: number, w: number, h: number): boolean {
  const win = Dimensions.get('window');
  const m = 40;
  return w > 0 && h > 0 && x + w > -m && y + h > -m && x < win.width + m && y < win.height + m;
}

/** Yerel Skia görünümünü (nativeId) motora bağlar; dönen tutamaçla ayarları değiştirilir, kalkınca bırakılır */
export function attachView(nativeId: number, options: ViewOptions): ViewHandle {
  // Geçersiz kimlikle yerel tarafa hiç gidilmez (yerel taraf kimliği tamsayı sayar)
  if (typeof nativeId !== 'number' || !Number.isFinite(nativeId)) return { update: () => undefined, dispose: () => undefined };
  start();
  const v: View = {
    nativeId,
    kind: options.kind,
    set: options.set,
    w: finite(options.w, 0),
    h: finite(options.h, 0),
    cache: new Map(),
    geo: finiteGeo(options.geo) ? options.geo : { bh: 106, ax: 62, ay: 112, ar: 46 },
    R: finite(options.R, 46),
    scale: finite(options.scale, 1),
    fps: finite(options.fps, MAX_FPS),
    paused: options.paused ?? false,
    lite: options.lite ?? false,
    still: options.still ?? false,
    focused: options.focused ?? true,
    // Ölçülebilen görünüm ekranda olduğu ölçülene kadar çizilmez (listede pencerenin dışında kurulan satırlar)
    visible: !options.measure,
    measure: options.measure,
    last: 0,
    dirty: true,
    broken: false,
    pic: null,
    detached: false,
  };
  views.add(v);
  kick();
  // İlk ölçüm yerleşimden sonraki karede (ayrıca boyut gelince yeniden), 500 ms'lik aralığı beklemeden
  requestAnimationFrame(() => measureOne(v));
  return {
    update(next) {
      if (v.detached) return;
      let reset = false;
      if (next.set !== undefined && next.set !== v.set) {
        v.set = next.set;
        reset = true;
      }
      if (next.R !== undefined && Number.isFinite(next.R) && next.R !== v.R) {
        v.R = next.R;
        reset = true;
      }
      let resized = false;
      if (
        next.w !== undefined &&
        next.h !== undefined &&
        Number.isFinite(next.w) &&
        Number.isFinite(next.h) &&
        (next.w !== v.w || next.h !== v.h)
      ) {
        v.w = next.w;
        v.h = next.h;
        reset = true;
        resized = true;
      }
      if (finiteGeo(next.geo) && (next.geo.bh !== v.geo.bh || next.geo.ax !== v.geo.ax || next.geo.ay !== v.geo.ay || next.geo.ar !== v.geo.ar)) {
        v.geo = next.geo;
        reset = true;
      }
      // Katmanların hazır listeleri (parçacıklar, dendritler) boyuta ve kartın ölçülerine göre kurulur
      if (reset) {
        releaseCache(v.cache);
        v.broken = false;
      }
      if (next.scale !== undefined && Number.isFinite(next.scale) && next.scale > 0) v.scale = next.scale;
      if (next.fps !== undefined && Number.isFinite(next.fps) && next.fps > 0) v.fps = next.fps;
      if (next.paused !== undefined) v.paused = next.paused;
      if (next.still !== undefined) v.still = next.still;
      if (next.lite !== undefined) v.lite = next.lite;
      if (next.focused !== undefined) v.focused = next.focused;
      if (next.measure !== undefined) v.measure = next.measure;
      v.dirty = true;
      kick();
      if (resized) measureOne(v);
    },
    dispose() {
      if (v.detached) return;
      v.detached = true;
      views.delete(v);
      v.measure = undefined;
      // Hazır listeler bırakılabilir: yerel görünümdeki resim içindekilere kendi başvurusunu tutar
      releaseCache(v.cache);
      // Son resim ana iş parçacığında hâlâ çiziliyor olabilir: hemen değil, birkaç kare sonra bırakılır
      retire(v.pic);
      v.pic = null;
      if (views.size === 0) stop();
    },
  };
}

/** Geliştirme ve ölçüm için: kaç görünüm var, kaçı çiziliyor (türlerine göre) */
export function cosmeticsStats(): { views: number; drawing: Record<string, number>; reduced: boolean; retired: number } {
  const drawing: Record<string, number> = {};
  for (const v of views) if (v.visible && v.focused && !v.broken) drawing[v.kind] = (drawing[v.kind] ?? 0) + 1;
  return { views: views.size, drawing, reduced, retired: retired.length };
}
