import { normalizeServerUrl } from './api';
import { env } from './env';
import { useSession } from './session';

const MAX_REPORTS = 20;
const reported = new Set<string>();

/**
 * Uygulamadaki beklenmedik bir hatayı sunucuya bildirir (sunucu kayıtlarına yazılır). Telefonda hata
 * ayıklama aracı olmadığından hataları görmenin tek yolu budur. Aynı hata bir kez, oturum başına en
 * fazla MAX_REPORTS hata gönderilir; bildirim başarısız olursa sessizce geçilir.
 */
export function reportClientError(error: unknown, where: string): void {
  try {
    const err = error instanceof Error ? error : new Error(String(error));
    const key = `${where}:${err.message}`;
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
