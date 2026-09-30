import { ACTIVITY_ICON_KEY_PATTERN, activityIconPath, type ActivityReport } from '@diskort/shared';
import { normalizeServerUrl } from './api';
import { env } from './env';
import { gateway } from './gateway';
import { useSession } from './session';

/**
 * Bu cihazın etkinliklerinin tam listesini bildirir (açık oyunlar; boş liste: hiçbiri). Yeniden bağlanınca
 * kendiliğinden yeniden bildirilir (geçen süreler o an baştan hesaplanır). Görünmezken sunucu başkalarına
 * göstermez.
 */
export function setActivities(reports: readonly ActivityReport[]): void {
  gateway.setActivities(reports);
}

/** Bu oturumda sunucuda olduğu bilinen ('ready') ya da yüklenemeyen ('failed') ikonlar; süren yüklemeler */
const icons = new Map<string, 'ready' | 'failed' | Promise<boolean>>();

/**
 * Etkinlik ikonunun sunucuda olmasını sağlar: yoksa `read`'in verdiği PNG'yi yükler. true: ikon sunucuda
 * (etkinlik bu anahtarla bildirilebilir). Sunucu bilmediği anahtarı ikonsuz saydığından önce bu beklenir.
 * Başarısız olan (eski sunucu, ağ hatası, reddedilen dosya) bu oturumda yeniden denenmez; oturum açık
 * değilken hiçbir şey denenmez ve hatırlanmaz.
 */
export function ensureActivityIcon(key: string, read: () => Promise<Uint8Array | null>): Promise<boolean> {
  if (!ACTIVITY_ICON_KEY_PATTERN.test(key)) return Promise.resolve(false);
  const known = icons.get(key);
  if (known === 'ready') return Promise.resolve(true);
  if (known === 'failed') return Promise.resolve(false);
  if (known) return known;
  const token = useSession.getState().token;
  if (!token) return Promise.resolve(false);

  const task = upload(key, token, read)
    .catch(() => false)
    .then((ok) => {
      icons.set(key, ok ? 'ready' : 'failed');
      return ok;
    });
  icons.set(key, task);
  return task;
}

async function upload(key: string, token: string, read: () => Promise<Uint8Array | null>): Promise<boolean> {
  const url = normalizeServerUrl(env().serverUrl()) + activityIconPath(key);
  const headers = { Authorization: `Bearer ${token}` };
  // Çoğu ikon zaten yüklüdür (aynı oyunu oynayan herkes aynı anahtarı üretir)
  const head = await fetch(url, { method: 'HEAD', headers });
  if (head.ok) return true;
  const png = await read();
  if (!png) return false;
  const put = await fetch(url, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'image/png' },
    body: png as Uint8Array<ArrayBuffer>,
  });
  return put.ok;
}
