// Bir setin bir parçası telefonda nasıl gösterilir: hangi dosya oynatılır, hangi sabit resim (poster) gösterilir
// ya da yalnızca setin renklerinden sabit bir görünüm mü. Paket deposunun (client-core cosmeticPacks) üstünde
// küçük, saf bir seçicidir; oynatma yeteneği (hangi tür hangi telefonda oynar) burada durur.

import type { CosmeticAssetKind, CosmeticPack, CosmeticPiece } from '@diskort/shared';
import type { ResolvedCosmeticAsset } from '@diskort/client-core';
import { isStackedLayout } from './packLayout';

export type PhoneOS = 'android' | 'ios';

/** Oynatıcının çalıştığı telefon */
export interface PhoneDevice {
  os: PhoneOS;
  /** Android'in API düzeyi (Platform.Version); iOS'ta yok */
  androidApi?: number;
}

/** Yan yana videonun (stacked-h264) oynatıldığı platformlar */
export const STACKED_VIDEO_PLATFORMS: readonly PhoneOS[] = ['ios', 'android'];

/**
 * Android'de yan yana videonun oynatıldığı en düşük API düzeyi: 29 (Android 10). Skia'nın Android videosu
 * (node_modules/@shopify/react-native-skia/android/src/main/java/com/shopify/reactnative/skia/RNSkVideo.java)
 * her kareyi `Image.getHardwareBuffer()` ile alır: bu yöntem API 28'de geldi, Android 8'de (API 26–27) çağrısı
 * yakalanmayan bir hata fırlatır (yerel koddan çağrıldığı için uygulamayı kapatır). API 28'de kare arabelleği GPU
 * kullanımı istenmeden kurulur (dokuya bağlanması cihaza kalır); API 29 ve üstünde GPU'dan örneklenebilir
 * arabellek açıkça istenir. Daha eski Android'de kart efekti posterle (ya da pakette varsa hareketli WebP ile)
 * gösterilir. Uygulamanın en düşük sürümü API 26'dır (Skia'nın videosu ancak öyle derlenir: app.config.ts).
 */
export const STACKED_VIDEO_MIN_ANDROID_API = 29;

/** Bu telefon yan yana videoyu oynatabilir mi */
export function playsStackedVideo(device: PhoneDevice): boolean {
  if (!STACKED_VIDEO_PLATFORMS.includes(device.os)) return false;
  return device.os !== 'android' || (device.androidApi ?? 0) >= STACKED_VIDEO_MIN_ANDROID_API;
}

/** Parçanın bu telefonda oynatılabilen türleri, tercih sırasıyla */
export function playableKinds(piece: CosmeticPiece, device: PhoneDevice): readonly CosmeticAssetKind[] {
  if (piece !== 'card') return ['webp'];
  return playsStackedVideo(device) ? ['stacked-h264', 'webp'] : ['webp'];
}

/** Paket deposunun seçicilerden kullanılan kısmı (client-core `cosmeticPacks`) */
export interface PackLookup {
  info(id: string | null | undefined): CosmeticPack | null;
  asset(id: string | null | undefined, piece: CosmeticPiece, preferredKinds: readonly CosmeticAssetKind[]): ResolvedCosmeticAsset | null;
  poster(id: string | null | undefined, piece: CosmeticPiece): ResolvedCosmeticAsset | null;
}

/**
 * - `none`: set bildirimde yok: hiçbir şey gösterilmez
 * - `static`: paket bu platformda oynatılmıyor (sunucudan kapatılmış) ya da gösterilebilecek dosyası yok: setin
 *   renklerinden sabit görünüm
 * - `pack`: `asset` oynatılır (yoksa yalnızca poster); `poster` hareket yokken ve yüklenirken gösterilir
 */
export type PieceSource =
  | { kind: 'none' }
  | { kind: 'static'; info: CosmeticPack }
  | { kind: 'pack'; info: CosmeticPack; asset: ResolvedCosmeticAsset | null; poster: ResolvedCosmeticAsset | null };

const NONE: PieceSource = { kind: 'none' };

export function pieceSource(packs: PackLookup, id: string | null | undefined, piece: CosmeticPiece, device: PhoneDevice): PieceSource {
  const info = packs.info(id);
  if (!info) return NONE;
  // Platformda kapalı pakette ikisi de null gelir
  let asset = packs.asset(id, piece, playableKinds(piece, device));
  // Bilgisi eksik video birleştirilemez
  if (asset?.kind === 'stacked-h264' && !isStackedLayout(asset)) asset = null;
  const poster = packs.poster(id, piece);
  if (!asset && !poster) return { kind: 'static', info };
  return { kind: 'pack', info, asset, poster };
}
