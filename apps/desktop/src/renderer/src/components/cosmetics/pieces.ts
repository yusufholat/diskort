// Hareketli kozmetiklerin masaüstündeki saf yardımcıları (React'e ve depoya bağlı değil; bileşenler
// Cosmetics.tsx'te): hangi dosyanın gösterileceği, ölçüler ve paketi oynatılmayan setin sabit görünümü.
// Masaüstünde her parça bir <img>'dir: hareketli AVIF, yoksa hareketli WebP; "hareketi azalt" açıkken,
// durdurulmuş görünümde ve dosya yüklenene kadar poster (sabit WebP). Gerçek zamanlı çizim yoktur.

import type { CosmeticAssetKind, CosmeticPackInfo, CosmeticPiece } from '@diskort/shared';
import type { CosmeticRenderMode, ResolvedCosmeticAsset } from '@diskort/client-core';

/** Masaüstünün <img> ile oynatabildiği türler, tercih sırasıyla */
export const PLAYABLE_KINDS: readonly CosmeticAssetKind[] = ['avif', 'webp'];

// ---------- Parçanın dosyaları ----------

/** Paket deposunun bu dosyanın kullandığı seçicileri (client-core cosmeticPacks) */
export interface PieceLookup {
  info(id: string | null | undefined): CosmeticPackInfo | null;
  mode(id: string | null | undefined, piece: CosmeticPiece, playableKinds: readonly CosmeticAssetKind[]): CosmeticRenderMode;
  asset(
    id: string | null | undefined,
    piece: CosmeticPiece,
    preferredKinds: readonly CosmeticAssetKind[],
  ): ResolvedCosmeticAsset | null;
  poster(id: string | null | undefined, piece: CosmeticPiece): ResolvedCosmeticAsset | null;
}

/** Bir setin bir parçası: bilgisi (renkler, adlar) ve oynatılacak dosyaları */
export interface PieceView {
  info: CosmeticPackInfo;
  /** Hareketli resim (avif, yoksa webp); paket bu istemcide oynatılmıyorsa null (sabit görünüm) */
  anim: ResolvedCosmeticAsset | null;
  /** Sabit resim; paket oynatılmıyorsa ya da posteri yoksa null */
  poster: ResolvedCosmeticAsset | null;
}

/**
 * Setin parçası nasıl gösterilecek: set bildirimde yoksa null (hiçbir şey çizilmez); paket oynatılıyorsa
 * dosyaları; oynatılmıyorsa (platformda kapalı ya da avif/webp dosyası yok) yalnızca bilgisi (sabit görünüm).
 */
export function resolvePiece(packs: PieceLookup, id: string | null | undefined, piece: CosmeticPiece): PieceView | null {
  const info = packs.info(id);
  if (!info) return null;
  if (packs.mode(id, piece, PLAYABLE_KINDS) !== 'pack') return { info, anim: null, poster: null };
  return { info, anim: packs.asset(id, piece, PLAYABLE_KINDS), poster: packs.poster(id, piece) };
}

/** <img>'de gösterilecek dosya */
export interface PieceSource {
  url: string;
  animated: boolean;
}

/**
 * Şu an gösterilecek dosya; null ise sabit görünüme düşülür.
 * - `still` (hareketi azalt, durdurulmuş ya da örtülmüş görünüm): yalnızca poster; posteri olmayan (ya da
 *   posteri yüklenemeyen) parça sabit görünümle gösterilir (hareketli dosya oynatılmaz).
 * - `primed`: poster gösterildi (ya da hareketli dosya zaten yüklü): hareketli dosyaya geçilebilir. O zamana
 *   kadar poster durur; tarayıcı yeni dosya tamamen yüklenene kadar eskisini göstermeyi sürdürür.
 * - `failed`: yüklenemeyen adresler. Hareketli dosya yüklenemezse poster, o da yüklenemezse sabit görünüm.
 */
export function pickSource(
  files: PieceFiles,
  state: { still: boolean; primed: boolean; failed: readonly string[] },
): PieceSource | null {
  const anim = files.anim && !state.failed.includes(files.anim) ? files.anim : null;
  const poster = files.poster && !state.failed.includes(files.poster) ? files.poster : null;
  if (anim && !state.still && (state.primed || !poster)) return { url: anim, animated: true };
  return poster ? { url: poster, animated: false } : null;
}

/** Parçanın dosyalarının adresleri (tam adres; yoksa null) */
export interface PieceFiles {
  anim: string | null;
  poster: string | null;
}

/**
 * Bir <img>'nin yükleme durumu. Olaylar (load / error) kendi adresleriyle işlenir: durum "şu adres yüklendi /
 * yüklenemedi" bilgisini tutar, o an gösterilen dosyaya bakmaz. Böylece yerini başka dosyaya bırakmış bir
 * adresin gecikmiş olayı yeni dosyayı etkilemez.
 */
export interface PieceLoadState {
  /** Yüklenmiş poster: hareketli dosyaya geçilebilir (bkz. pickSource `primed`) */
  loadedPoster: string | null;
  /** `failed` listesinin ait olduğu dönem (bkz. loadEpoch) */
  epoch: string;
  /** Bu dönemde yüklenemeyen adresler */
  failed: readonly string[];
}

export const INITIAL_LOAD_STATE: PieceLoadState = { loadedPoster: null, epoch: '', failed: [] };

/**
 * Yüklenemeyen dosyaların hatırlandığı dönem: bildirimin sürümü ve bağlantının kaçıncı kez kurulduğu. İkisinden
 * biri değişince (bildirim tazelendi ya da bağlantı geri geldi) eski hatalar unutulur ve dosyalar yeniden
 * denenir: geçici bir ağ hatası parçayı kalıcı olarak postere / sabit görünüme düşürmez.
 */
export const loadEpoch = (manifestVersion: string | null | undefined, connections: number): string =>
  `${manifestVersion ?? ''}#${connections}`;

const NO_URLS: readonly string[] = [];

/** Bu dönemde yüklenemeyen adresler (durum eski bir dönemdense boş) */
export const failuresIn = (state: PieceLoadState, epoch: string): readonly string[] =>
  state.epoch === epoch ? state.failed : NO_URLS;

/** `url` yüklendi. Parçanın güncel posteri değilse (hareketli dosya ya da eski bir adres) durum değişmez. */
export function sourceLoaded(state: PieceLoadState, files: PieceFiles, url: string | null): PieceLoadState {
  if (!url || url !== files.poster || state.loadedPoster === url) return state;
  return { ...state, loadedPoster: url };
}

/**
 * `url` yüklenemedi. Parçanın güncel dosyalarından biri değilse (yerini yenisine bırakmış eski adresin
 * gecikmiş olayı) yok sayılır. Eski dönemin hataları taşınmaz.
 */
export function sourceFailed(state: PieceLoadState, files: PieceFiles, epoch: string, url: string | null): PieceLoadState {
  if (!url || (url !== files.anim && url !== files.poster)) return state;
  const failed = failuresIn(state, epoch);
  if (state.epoch === epoch && failed.includes(url)) return state;
  return { ...state, epoch, failed: [...failed, url] };
}

// ---------- Ölçüler ----------

/** Avatarın bu boydan küçüğünde (mesajlar, listeler) hareketli dekorasyon yerine sabit, ucuz bir halka */
export const ANIMATED_DECORATION_MIN_SIZE = 64;
/** Avatarın halkasıyla birlikte dış yarıçapı, avatarın yarıçapının katı (80 piksellik avatar + 6 piksel halka = 46) */
const DECORATION_RING_SCALE = 1.15;
/** Dekorasyonun karesi, dış yarıçapın katı (46 piksellik yarıçapa 132 piksel: paketteki resim bu oranla çizildi) */
const DECORATION_BOX_SCALE = 132 / 46;

/**
 * Dekorasyon resminin karesi (css px) ve avatarın sol üst köşesine göre yeri: avatarın ortasına oturur,
 * kenarı avatarın 1,65 katıdır (80 → 132, 44 → 73).
 */
export function decorationBox(size: number): { box: number; offset: number } {
  const box = Math.round((size / 2) * DECORATION_RING_SCALE * DECORATION_BOX_SCALE);
  return { box, offset: (size - box) / 2 };
}

/** Plaka resminin sol kenarının satırın koyu zeminine karıştığı genişlik (css px) */
export const PLATE_BLEND_PX = 24;

// ---------- Sabit görünüm (paket oynatılmıyorsa): setin bilgi renklerinden, yalnızca CSS ----------

const alpha = (color: string, percent: number): string => `color-mix(in srgb, ${color} ${percent}%, transparent)`;

/** Küçük avatarlarda (ve paketi oynatılmayan dekorasyonda) setin renklerinde ince halka */
export function staticRingStyle(
  info: Pick<CosmeticPackInfo, 'accent' | 'from' | 'to'>,
  size: number,
): { inset: number; background: string; mask: string; boxShadow: string } {
  const w = size >= ANIMATED_DECORATION_MIN_SIZE ? 3 : size >= 40 ? 2.5 : 2;
  return {
    inset: -w,
    background: `conic-gradient(from 210deg, ${info.accent}, ${info.to}, ${info.accent}, ${info.from}, ${info.accent})`,
    mask: `radial-gradient(circle closest-side, transparent calc(100% - ${w + 0.6}px), #000 calc(100% - ${w}px))`,
    boxShadow: `0 0 ${w * 2}px ${info.accent}55`,
  };
}

/** Profil kartı: afişin (106 piksel) sağ üstünde setin parıltısı */
export function staticCardBackground(info: Pick<CosmeticPackInfo, 'fallback'>): string {
  return `radial-gradient(circle 170px at 75% 32px, ${info.fallback[2]}, transparent)`;
}

/** Perdenin durakları: (satır genişliğine oran %, örtücülük %); plaka resimlerindeki perdeyle aynı */
const PLATE_SCRIM: readonly [number, number][] = [
  [0, 86],
  [30, 78],
  [45, 52],
  [60, 24],
  [72, 7],
  [80, 0],
];

/** İsim plakası: koyu zemin; setin rengi ve parıltısı yalnızca sağda, yazıların altı (sol) koyu ve sakin */
export function staticPlateBackground(info: Pick<CosmeticPackInfo, 'fallback'>): string {
  const [dark, tint, glow] = info.fallback;
  const scrim = PLATE_SCRIM.map(([at, a]) => `${alpha(dark, a)} ${at}%`).join(', ');
  return [
    `linear-gradient(to right, ${scrim})`,
    `radial-gradient(circle 78px at 90% 35%, ${glow}, transparent)`,
    `linear-gradient(to right, transparent 30%, ${alpha(tint, 75)})`,
    dark,
  ].join(', ');
}

/** Seçici kutusu: setin iki koyu rengi ve sağ üstte parıltısı */
export function staticThumbBackground(info: Pick<CosmeticPackInfo, 'fallback'>): string {
  const [dark, tint, glow] = info.fallback;
  return `radial-gradient(60% 96% at 78% 25%, ${glow}, transparent), linear-gradient(154deg, ${dark}, ${tint})`;
}

// ---------- İsim plakalı satırın yazısı ----------

/** Plakanın solu (yazıların altı) çok koyu: bu bağıl parlaklıktaki renk orada ~4.5:1 karşıtlıkla okunur */
const NAMEPLATE_MIN_LUMINANCE = 0.22;

/** #rgb / #rrggbb rengin sRGB kanalları (0-1); çözülemezse null */
function parseHex(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const s = m[1]!.length === 3 ? [...m[1]!].map((c) => c + c).join('') : m[1]!;
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16) / 255) as [number, number, number];
}

/** sRGB rengin beyazla `white` oranında karışımının bağıl parlaklığı (WCAG) */
function mixedLuminance(rgb: [number, number, number], white: number): number {
  const lin = (c: number): number => {
    c += (1 - c) * white;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
}

/**
 * İsim plakalı satırda rol renginin yazısı. Plakanın solu koyu olduğundan açık ve orta renkler olduğu gibi
 * kalır; koyu rol renkleri (lacivert, bordo) okunur olana kadar beyaza doğru açılır, ton korunur. Renk yoksa
 * undefined: .nameplate-text beyazı.
 */
export function nameplateNameColor(color: string | null | undefined): string | undefined {
  if (!color) return undefined;
  const rgb = parseHex(color);
  if (!rgb) return `color-mix(in srgb, ${color} 75%, #fff)`;
  // En az beyaz payı (%5 adımlarla, en çok %70): ton olabildiğince korunur
  let white = 0;
  while (white < 70 && mixedLuminance(rgb, white / 100) < NAMEPLATE_MIN_LUMINANCE) white += 5;
  return white === 0 ? color : `color-mix(in srgb, ${color} ${100 - white}%, #fff)`;
}
