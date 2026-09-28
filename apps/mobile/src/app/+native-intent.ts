import { parseInviteDeepLink } from '@diskort/shared';
import { setPendingInvite } from '@diskort/client-core';

/**
 * Uygulamayı açan bağlantılar (Expo Router bunu gezinmeden önce çağırır; soğuk açılışta da, uygulama
 * açıkken de). Davet bağlantısı (diskort://davet/<kod>) doğrudan bir ekrana gitmez: kod bekletilir ve ana
 * ekran açılır. Açılış/güncelleme ekranı sürerken gelse de kaybolmaz: ana ekran hazır olunca "Sunucu ekle"
 * kodla açılır; oturum yoksa giriş ekranı "giriş yapınca katılacaksın" notunu gösterir.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    const code = parseInviteDeepLink(path);
    if (!code) return path;
    setPendingInvite(code);
    return '/';
  } catch {
    return path;
  }
}
