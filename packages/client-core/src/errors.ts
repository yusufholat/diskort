import { FEEDBACK_MAX_ERRORS } from '@diskort/shared';
import { normalizeServerUrl } from './api';
import { env } from './env';
import { useSession } from './session';

const MAX_REPORTS = 20;
const reported = new Set<string>();
/**
 * Beklenen, zararsız gürültü: sunucuya hiç gönderilmez (sunucu da aynı listeyi eski istemciler için uygular).
 * - DUPLICATE_IDENTITY: kullanıcı aynı kanala başka cihazdan girdi, LiveKit eski oturumu kapattı
 * - createOffer uyarısı: bağlantı kapandıktan sonraki yan gürültü
 * - unpublish uyarısı: ekran paylaşımı kendiliğinden bitince çift yayın kaldırma (masaüstünde giderildi)
 */
const BENIGN_ERRORS = [
  /ses bağlantısı kapandı: DUPLICATE_IDENTITY/,
  /could not createOffer with closed peer connection/,
  /track was not unpublished because no publication was found/,
];
/** Bu oturumdaki son hatalar (geri bildirimin teknik bilgilerine eklenir); en eskisi başta */
const recent: string[] = [];

/**
 * Uygulamadaki beklenmedik bir hatayı sunucuya bildirir (sunucu kayıtlarına yazılır). Telefonda hata
 * ayıklama aracı olmadığından hataları görmenin tek yolu budur. Aynı hata bir kez, oturum başına en
 * fazla MAX_REPORTS hata gönderilir; bildirim başarısız olursa sessizce geçilir.
 */
export function reportClientError(error: unknown, where: string): void {
  try {
    const err = error instanceof Error ? error : new Error(String(error));
    if (BENIGN_ERRORS.some((re) => re.test(err.message))) return;
    const key = `${where}:${err.message}`;
    remember(`${where}: ${err.message}`);
    if (reported.has(key) || reported.size >= MAX_REPORTS) return;
    reported.add(key);
    const { platform, version, serverUrl } = env();
    const token = useSession.getState().token;
    void fetch(`${normalizeServerUrl(serverUrl())}/api/client-errors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({
        platform,
        version,
        where,
        message: err.message.slice(0, 500),
        stack: err.stack?.slice(0, 4000),
      }),
    }).catch(() => undefined);
  } catch {
    // hata bildirirken hata: yapılacak bir şey yok
  }
}

function remember(entry: string): void {
  const text = entry.slice(0, 300);
  // Art arda tekrarlanan aynı hata bir kez tutulur
  if (recent.at(-1) === text) return;
  recent.push(text);
  if (recent.length > FEEDBACK_MAX_ERRORS) recent.shift();
}

/** Bu oturumda bildirilen son hata mesajları (en fazla 10, en eskisi başta; yalnızca mesajlar, yığın yok) */
export function recentClientErrors(): string[] {
  return [...recent];
}
