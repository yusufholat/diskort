// Uygulamayı açan bağlantılar: diskort://davet/<kod> (indirme sayfasındaki "Uygulamada aç").
// Electron'a bağlı değil; test edilebilsin diye ayrı dosyada.
import { APP_LINK_SCHEME, parseInviteDeepLink } from '@diskort/shared';

/** Tek bir bağlantıdan davet kodu; yalnızca diskort:// şeması ve davet yolu kabul edilir */
export function inviteCodeFromUrl(url: string): string | null {
  const text = url.trim();
  if (!text.toLowerCase().startsWith(`${APP_LINK_SCHEME}:`)) return null;
  return parseInviteDeepLink(text);
}

/**
 * Komut satırından davet kodu (Windows/Linux: sistem bağlantıyı son argüman olarak verir; ikinci
 * açılışta argümanlar çalışan uygulamaya iletilir). Chromium'un eklediği anahtarlar yok sayılır.
 */
export function inviteCodeFromArgv(argv: readonly string[]): string | null {
  for (let i = argv.length - 1; i >= 0; i--) {
    const code = inviteCodeFromUrl(argv[i] ?? '');
    if (code) return code;
  }
  return null;
}
