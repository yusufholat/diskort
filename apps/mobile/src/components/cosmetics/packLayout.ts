// Kozmetik paketlerinin telefondaki yerleşim ve çizim hesapları: parçaların kutuları (dekorasyon, kart efekti,
// isim plakası), çizim yüzeyinin çözünürlüğü, yan yana videonun (stacked-h264) birleştirme gölgelendiricisi ve
// kare saatinin kuralları. React Native'e ve Skia'ya bağlı değildir (birim testleri Node'da çalışır). `worklet`
// işaretli işlevler arayüz iş parçacığındaki kare döngüsünden de çağrılır (bkz. packDriver.ts).

// ---------- Avatar dekorasyonu ----------

/** Avatarın bu boydan küçüğünde (mesajlar, listeler) hareketli dekorasyon yerine sabit, ucuz bir halka */
export const ANIMATED_DECORATION_MIN_SIZE = 64;
/** Dekorasyon karesi avatarın dış yarıçapının bu katı (paket: 46 piksellik yarıçapa 132 piksellik kare) */
const DECORATION_CANVAS_SCALE = 132 / 46;

/** Avatarın dış yarıçapı: halkasıyla birlikte (profil kartında 80 piksellik avatar + 6 piksellik halka = 46) */
export const decorationRadius = (size: number): number => (size / 2) * 1.15;

/** Bu boydaki avatarın hareketli dekorasyon karesinin kenarı (avatarla aynı merkezde, ondan büyük) */
export const decorationBox = (size: number): number => Math.round(decorationRadius(size) * DECORATION_CANVAS_SCALE);

/**
 * Yerleşimde dekorasyona ayrılacak yer: büyük avatarda hareketli karenin kenarı; küçük avatarda sabit halka
 * avatarın içinde kaldığından avatarın kendisi.
 */
export const decorationCanvasSize = (size: number): number =>
  size >= ANIMATED_DECORATION_MIN_SIZE ? decorationBox(size) : size;

// ---------- Profil kartı efekti ----------

/** Efektin varsaydığı afiş: kart genişliğinin bu katı yüksekliğinde (afiş resmi 17:6) */
export const CARD_BANNER_RATIO = 6 / 17;

/**
 * Kart efektinin kutusu: kartın genişliğine ölçeklenir, üste yaslanır, en boy oranı dosyadan gelir (600×900).
 * Kısa kart altını kırpar (`visibleHeight`); uzun kartta efekt `height`te biter (dosya altta kendisi söner).
 */
export function cardEffectBox(cardWidth: number, cardHeight: number, assetWidth: number, assetHeight: number): { width: number; height: number; visibleHeight: number } {
  if (!(cardWidth > 0) || !(cardHeight > 0) || !(assetWidth > 0) || !(assetHeight > 0)) return { width: 0, height: 0, visibleHeight: 0 };
  const height = (cardWidth * assetHeight) / assetWidth;
  return { width: cardWidth, height, visibleHeight: Math.min(cardHeight, height) };
}

// ---------- İsim plakası ----------

/** Plaka resminin sol kenarı, soldaki düz renge bu kadarlık (resim genişliğinin katı) bir geçişle karışır */
export const PLATE_BLEND = 0.22;

/**
 * İsim plakası: resim satırın yüksekliğinde, sağa yaslı (dosya 446×80; 223×40'lık satır için). Satır resimden
 * genişse solda kalan kısım (`fill`) plakanın koyu rengiyle doldurulur ve resmin sol kenarı `blend` genişliğinde
 * o renge karışır; satır dar ise resmin solu kırpılır (`left` eksi olur).
 */
export function plateBox(rowWidth: number, rowHeight: number, assetWidth: number, assetHeight: number): { left: number; width: number; height: number; fill: number; blend: number } {
  if (!(rowWidth > 0) || !(rowHeight > 0) || !(assetWidth > 0) || !(assetHeight > 0)) return { left: 0, width: 0, height: 0, fill: 0, blend: 0 };
  const width = (rowHeight * assetWidth) / assetHeight;
  const left = rowWidth - width;
  const fill = Math.max(0, left);
  return { left, width, height: rowHeight, fill, blend: fill > 0.5 ? width * PLATE_BLEND : 0 };
}

// ---------- Çizim yüzeyi ----------

/**
 * Çizim yüzeyinin çözünürlük katı (1 ya da küçüğü): yüzey, dosyanın kendi pikselinden fazlasını çizmez. Telefonun
 * 3× ekranında 58 piksellik satır 174 piksel eder ama plaka dosyası 80 piksel yüksekliğindedir; yüzey küçük
 * tutulup büyütülür (daha az bellek ve dolgu, aynı görüntü).
 */
export function surfaceScale(assetPixels: number, layoutSize: number, pixelRatio: number): number {
  if (!(assetPixels > 0) || !(layoutSize > 0) || !(pixelRatio > 0)) return 1;
  return Math.min(1, assetPixels / (layoutSize * pixelRatio));
}

// ---------- Renkler ----------

/**
 * Paket bilgisindeki rengin ("#rrggbb" ya da "rgb(a)(…)") verilen saydamlıkta hali: degradelerde "transparent"
 * yerine (o, siyaha doğru karışır) rengin kendisinin saydamı kullanılır. Çözülemezse null.
 */
export function withAlpha(color: string, alpha: number): string | null {
  const a = Math.min(1, Math.max(0, alpha));
  const hex = /^#([0-9a-f]{6})$/i.exec(color);
  if (hex) {
    const n = parseInt(hex[1]!, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }
  const rgb = /^rgba?\( ?(\d{1,3}) ?, ?(\d{1,3}) ?, ?(\d{1,3}) ?(?:, ?([\d.]+) ?)?\)$/i.exec(color);
  if (!rgb) return null;
  const own = rgb[4] === undefined ? 1 : Number(rgb[4]);
  if (!Number.isFinite(own)) return null;
  return `rgba(${rgb[1]},${rgb[2]},${rgb[3]},${Math.round(Math.min(1, own) * a * 1000) / 1000})`;
}

// ---------- Yan yana video (stacked-h264) ----------

/** Yan yana videonun yerleşimi (paket bildirimindeki dosya bilgisinden) */
export interface StackedLayout {
  /** Görünen karenin boyu (piksel) */
  width: number;
  height: number;
  /** Videonun tam genişliği ve alfa yarısının başladığı sütun (piksel) */
  stackedWidth: number;
  alphaX: number;
}

/** Dosya bilgisi geçerli bir yan yana yerleşim mi (renk yarısı solda, alfa yarısı videonun içinde) */
export function isStackedLayout(a: { width: number; height: number; stackedWidth?: number; alphaX?: number }): a is StackedLayout {
  const { width, height, stackedWidth, alphaX } = a;
  return (
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width > 0 &&
    height > 0 &&
    typeof stackedWidth === 'number' &&
    typeof alphaX === 'number' &&
    alphaX >= width &&
    alphaX + width <= stackedWidth
  );
}

/**
 * Yan yana videonun iki yarısını tek saydam görüntüde birleştiren gölgelendirici (SkSL, sabit). `image`: videonun
 * karesi (kendi pikselleriyle örneklenir). Renk yarısı zaten alfayla çarpılmıştır; sıkıştırma hatası rengi alfanın
 * üstüne taşırsa kırpılır (saydam yerde parlama olmasın). Çıktı önceden çarpılmış renktir. Masaüstündeki
 * birleştiriciyle (scripts/cosmetic-render/stacked.js) aynı formül.
 */
export const STACKED_ALPHA_SKSL = `
uniform shader image;
uniform float2 scale;
uniform float2 size;
uniform float alphaX;

half4 main(float2 xy) {
  float2 p = clamp(xy * scale, float2(0.5), size - float2(0.5));
  half3 c = image.eval(p).rgb;
  half a = image.eval(float2(p.x + alphaX, p.y)).g;
  return half4(min(c, half3(a)), a);
}
`;

export interface StackedUniforms {
  /** Çizim biriminden videonun pikseline */
  scale: [number, number];
  /** Görünen karenin boyu (piksel) */
  size: [number, number];
  alphaX: number;
}

/** Görünen kare (0, 0)–(drawWidth, drawHeight) dikdörtgenine çizilirken gölgelendiricinin değişkenleri */
export function stackedUniforms(layout: StackedLayout, drawWidth: number, drawHeight: number): StackedUniforms {
  return {
    scale: [drawWidth > 0 ? layout.width / drawWidth : 1, drawHeight > 0 ? layout.height / drawHeight : 1],
    size: [layout.width, layout.height],
    alphaX: layout.alphaX,
  };
}

/**
 * Gölgelendiricinin koordinat hesabı (testler için aynı formül): çizim noktası (x, y) videoda hangi renk ve
 * alfa pikselinden okunur. Kenarda yarım piksel içeride tutulur: iki yarı birbirine ve aradaki boşluğa taşmaz.
 */
export function stackedSample(x: number, y: number, u: StackedUniforms): { color: [number, number]; alpha: [number, number] } {
  const px = Math.min(u.size[0] - 0.5, Math.max(0.5, x * u.scale[0]));
  const py = Math.min(u.size[1] - 0.5, Math.max(0.5, y * u.scale[1]));
  return { color: [px, py], alpha: [px + u.alphaX, py] };
}

// ---------- Kare saati ----------

/** Kare sınırı: bir sonraki kareye kalan süre bundan azsa (ms) şimdi çizilir (ekran 60/90/120 Hz olabilir) */
const FRAME_SLACK_MS = 4;

/** Karenin zamanı geldi mi: `last` son karenin zamanı (0: hiç çizilmedi), `interval` kare aralığı (ms) */
export function frameDue(now: number, last: number, interval: number): boolean {
  'worklet';
  return last <= 0 || now - last >= interval - FRAME_SLACK_MS;
}

/** Kare hızından kare aralığı (ms); geçersiz hız 30 sayılır, en çok 60 */
export function frameInterval(fps: number): number {
  const f = Number.isFinite(fps) && fps > 0 ? Math.min(60, fps) : 30;
  return 1000 / f;
}

/** Videonun son karesinden sonra en çok bu kadar çağrı daha beklenir (çözücünün içinde kalan kareler) */
export const VIDEO_TAIL_CALLS = 8;
/** Döngü sonunda bir kare isteği bundan uzun sürdüyse (ms) çözücüde kare kalmamıştır */
export const VIDEO_STALL_MS = 9;

/**
 * Android'de videonun başa sarılması gerekiyor mu. Oradaki Skia videosunda kareleri çağrılar ilerletir (her
 * `nextImage` en çok bir kare) ve çözücü dosyanın sonunda kendiliğinden başa dönmez: döngüyü oynatıcı kurar.
 * `calls`: son sarmadan beri kare isteği sayısı, `frames`: dosyadaki kare sayısı, `timeMs`: son çözülen karenin
 * zamanı (her karede güncellenmeyebilir), `tookMs`: son isteğin süresi. Dosyanın bütün kareleri istenmeden
 * sarılmaz; sonra şunlardan biri yeter: son karenin zamanı görüldü, istek boşuna bekledi, ya da pay doldu.
 */
export function videoShouldRewind(calls: number, frames: number, timeMs: number, durationMs: number, frameMs: number, tookMs: number): boolean {
  'worklet';
  if (!(frames > 0) || calls < frames - 2) return false;
  if (durationMs > 0 && timeMs >= durationMs - 1.5 * frameMs) return true;
  if (calls >= frames - 1 && tookMs >= VIDEO_STALL_MS) return true;
  return calls >= frames + VIDEO_TAIL_CALLS;
}

/** Kare başına ortalama iş bu süreyi (ms) aşarsa oynatma bırakılır, sabit resme dönülür (arayüz takılmasın) */
export const STEP_BUDGET_MS = { image: 12, video: 16 } as const;
/** Ortalama bu kadar kareden sonra değerlendirilir */
export const STEP_BUDGET_AFTER = 90;

/** Kare işinin kayan ortalaması (ms) */
export function stepCost(average: number, tookMs: number): number {
  'worklet';
  return average * 0.9 + tookMs * 0.1;
}
