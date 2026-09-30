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

// ---------- Karelerin ömrü ----------

/**
 * Gösterilen kareyi değiştirir: yeni kare gösterilir, bir önceki kare bir adım daha yaşar (yüzey JavaScript iş
 * parçacığında kurulurken okuduğu kare, kaydı bitmeden bırakılmasın). Bırakılması gereken kareyi (iki adım
 * önceki) döner; yoksa null.
 */
export function nextFrames<T>(held: { current: T | null; previous: T | null }, next: T): T | null {
  'worklet';
  const old = held.previous;
  held.previous = held.current;
  held.current = next;
  return old;
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

/**
 * Yamalı Skia videosunun (patches/@shopify__react-native-skia@2.6.2.patch, RNSkVideo.BROKEN_TIME) bozulan
 * çözücüde verdiği zaman: hiçbir karenin zamanı olamaz (karelerin zamanı B-kareleri ve düzenleme listeleri
 * yüzünden biraz eksi olabilir; -1 olamazdı).
 */
export const VIDEO_BROKEN_TIME = -1e9;

/** Video çözücüsü bozuldu mu (yamalı Skia videosunun zamanı tam olarak VIDEO_BROKEN_TIME) */
export function videoBroken(timeMs: number): boolean {
  'worklet';
  return timeMs === VIDEO_BROKEN_TIME;
}

/** Çözücünün içinde bekleyebilecek en fazla kare (H.264'ün yeniden sıralama payı): döngünün "sonu" bu kadar kare */
export const VIDEO_TAIL_FRAMES = 12;
/**
 * Bir kare isteği bundan uzun sürdüyse (ms) çözücü hem girdi hem çıktı için boşuna beklemiştir (ikisi de 10 ms'de
 * zaman aşımına uğrar): dosyanın sonu verilmiş ve kare kalmamıştır. Yalnızca çıktıyı bekleyen olağan yavaş istek
 * 10 ms sürer.
 */
export const VIDEO_STALL_MS = 15;

/**
 * Android'de videonun başa sarılması gerekiyor mu. Oradaki Skia videosunda (RNSkVideo.java) kareleri çağrılar
 * ilerletir (her `nextImage` en çok bir kare çözer) ve çözücü dosyanın sonunda kendiliğinden başa dönmez:
 * döngüyü oynatıcı kurar.
 * - `calls`: son sarmadan beri kare isteği sayısı; `frames`: dosyadaki kare sayısı
 * - `timeMs`: son çözülen karenin zamanı. Her karede güncellenmez (çözücüde hazır bekleyen kare zamanı
 *   güncellemeden verilir; dosyanın sonunda kalan kareler böyle gelir) ve sarmanın hemen ardından eski döngünün
 *   sonunu gösterir; `idleCalls`: zamanın kaç istektir değişmediği
 * - `tookMs`: son isteğin süresi
 * Kurallar: döngünün ilk yarısında sarılmaz. Son karenin zamanı görüldüyse sarılır. Son karelerdeyken istek
 * boşuna beklediyse ya da zaman uzun süredir ilerlemiyorsa (kalan kareler de verildi) sarılır. Zaman hiç
 * güvenilir değilse çağrı sayısına bakılır: bütün kareler istendikten sonra boşuna bekleyen istekte, en geç iki
 * döngülük çağrıda.
 */
export function videoShouldRewind(
  calls: number,
  idleCalls: number,
  frames: number,
  timeMs: number,
  durationMs: number,
  frameMs: number,
  tookMs: number,
): boolean {
  'worklet';
  if (!(frames > 0) || calls < frames / 2) return false;
  const timed = durationMs > 0;
  if (timed && timeMs >= durationMs - 1.5 * frameMs) return true;
  const nearEnd = timed && timeMs >= durationMs - VIDEO_TAIL_FRAMES * frameMs;
  if (nearEnd && (tookMs >= VIDEO_STALL_MS || idleCalls >= VIDEO_TAIL_FRAMES)) return true;
  if (calls >= frames + VIDEO_TAIL_FRAMES && tookMs >= VIDEO_STALL_MS) return true;
  return calls >= frames * 2;
}

// ---------- İş bütçesi ----------
//
// Kareler arayüz iş parçacığında çözülür: iş uzarsa arayüz takılır. İki bütçe vardır ve ikisi de tek bir
// takılmayla değil, ortalamanın art arda pek çok karede aşılmasıyla dolar:
// - oynatıcı başına: tek bir dosyanın karesi bu telefonda yetişmiyorsa o dosya bu oturumda oynatılmaz;
// - kare başına toplam: aynı anda çok sayıda farklı dosya oynuyorsa (ör. on iki ayrı isim plakası) en pahalı
//   oynatıcı sabit resme alınır, toplam bütçeye inene kadar sırayla; bunlar bir süre sonra yeniden denenir.

/** Bir oynatıcının kare başına ortalama işi bunu (ms) aşmamalı */
export const STEP_BUDGET_MS = { image: 12, video: 16 } as const;
/** Bir karedeki bütün oynatıcıların toplam ortalama işi bunu (ms) aşmamalı */
export const TICK_BUDGET_MS = 10;
/** Ortalama art arda bu kadar karede bütçenin üstündeyse (30 kare/sn'de 1,5 sn) bütçe dolmuştur */
export const BUDGET_STRIKES = 45;
/** Tek bir ölçüm ortalamaya en çok bütçenin bu katı kadar sayılır (çöp toplama gibi tek bir takılma ortalamayı bozmasın) */
const SAMPLE_CLAMP = 3;

/** İşin kayan ortalaması (ms); tek ölçüm bütçenin SAMPLE_CLAMP katında kırpılır */
export function stepCost(average: number, tookMs: number, budget: number): number {
  'worklet';
  return average * 0.9 + Math.min(tookMs, budget * SAMPLE_CLAMP) * 0.1;
}

/** Ortalamanın art arda kaç karedir bütçenin üstünde olduğu (altına inince sıfırlanır) */
export function budgetStrikes(strikes: number, average: number, budget: number): number {
  'worklet';
  return average > budget ? strikes + 1 : 0;
}

/** Toplam bütçe dolunca sabit resme alınacak oynatıcı: en pahalısı (ortalama işi en yüksek olan); liste boşsa -1 */
export function heaviest(costs: readonly number[]): number {
  'worklet';
  let index = -1;
  for (let i = 0; i < costs.length; i++) if (index < 0 || costs[i]! > costs[index]!) index = i;
  return index;
}
