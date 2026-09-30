// Bir setin bir parçası telefonda nasıl gösterilir: hangi dosya oynatılır, hangi sabit resim (poster) gösterilir
// ya da yalnızca setin renklerinden sabit bir görünüm mü. Paket deposunun (client-core cosmeticPacks) üstünde
// küçük, saf bir seçicidir; oynatma yeteneği (hangi tür hangi platformda oynar) burada durur.

import type { CosmeticAssetKind, CosmeticPack, CosmeticPiece } from '@diskort/shared';
import type { ResolvedCosmeticAsset } from '@diskort/client-core';
import { isStackedLayout } from './packLayout';

export type PhoneOS = 'android' | 'ios';

/**
 * Yan yana videonun (stacked-h264) oynatıldığı platformlar. Skia'nın videosu Android'de en az API 26 ile
 * derlenmiş uygulama ister (node_modules/@shopify/react-native-skia/android/cpp/rnskia-android/
 * RNSkAndroidVideo.cpp: `__ANDROID_API__ < 26` ise kurucu hata fırlatır); uygulamanın minSdk'si 24 olduğundan
 * Android'de video derlenmemiştir; denemek bile Java tarafında açılmış çözücüyü çöp toplanana dek açık bırakır
 * (RNSkVideo kurulur, ardından C++ kurucusu fırlatır). Android'de kart efekti bu yüzden posterle (ya da pakette
 * varsa hareketli WebP ile) gösterilir. Açmak için: minSdk 26 ile yeni APK, bu listeye 'android' ve cihazda
 * deneme (döngü kuralı hazır ama denenmedi: packLayout.ts videoShouldRewind).
 */
export const STACKED_VIDEO_PLATFORMS: readonly PhoneOS[] = ['ios'];

/** Parçanın bu platformda oynatılabilen türleri, tercih sırasıyla */
export function playableKinds(piece: CosmeticPiece, os: PhoneOS): readonly CosmeticAssetKind[] {
  if (piece !== 'card') return ['webp'];
  return STACKED_VIDEO_PLATFORMS.includes(os) ? ['stacked-h264', 'webp'] : ['webp'];
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

export function pieceSource(packs: PackLookup, id: string | null | undefined, piece: CosmeticPiece, os: PhoneOS): PieceSource {
  const info = packs.info(id);
  if (!info) return NONE;
  // Platformda kapalı pakette ikisi de null gelir
  let asset = packs.asset(id, piece, playableKinds(piece, os));
  // Bilgisi eksik video birleştirilemez
  if (asset?.kind === 'stacked-h264' && !isStackedLayout(asset)) asset = null;
  const poster = packs.poster(id, piece);
  if (!asset && !poster) return { kind: 'static', info };
  return { kind: 'pack', info, asset, poster };
}
