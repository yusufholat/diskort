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

/** Geçici hatadan (ağ, sunucu hatası, sınır, oturum) sonra ikon bu süre yeniden denenmez */
const ICON_RETRY_AFTER_MS = 5 * 60_000;

type IconState =
  /** Sunucuda olduğu biliniyor */
  | { state: 'ready' }
  /** Yüklenemedi; `until`'e dek denenmez (Infinity: sunucu kesin reddetti, bu oturumda hiç denenmez) */
  | { state: 'failed'; until: number }
  | { state: 'pending'; task: Promise<boolean> };

/** İkonların durumu; yalnızca `iconScope`'taki sunucu ve oturum için geçerlidir */
const icons = new Map<string, IconState>();
let iconScope = '';

type UploadResult = 'ready' | 'rejected' | 'retry';

/**
 * Etkinlik ikonunun sunucuda olmasını sağlar: yoksa `read`'in verdiği PNG'yi yükler. true: ikon sunucuda
 * (etkinlik bu anahtarla bildirilebilir). Sunucu bilmediği anahtarı ikonsuz saydığından önce bu beklenir.
 * Sunucunun kesin reddettiği ikon (eski sunucu, geçersiz dosya) bu oturumda yeniden denenmez; geçici
 * hatalar birkaç dakika sonra yeniden denenebilir. Sunucu adresi ya da oturum değişince bilinenler unutulur;
 * oturum açık değilken hiçbir şey denenmez ve hatırlanmaz.
 */
export function ensureActivityIcon(key: string, read: () => Promise<Uint8Array | null>): Promise<boolean> {
  if (!ACTIVITY_ICON_KEY_PATTERN.test(key)) return Promise.resolve(false);
  const token = useSession.getState().token;
  if (!token) return Promise.resolve(false);
  const base = normalizeServerUrl(env().serverUrl());
  const scope = `${base} ${token}`;
  if (scope !== iconScope) {
    icons.clear();
    iconScope = scope;
  }
  const known = icons.get(key);
  if (known?.state === 'ready') return Promise.resolve(true);
  if (known?.state === 'pending') return known.task;
  if (known && Date.now() < known.until) return Promise.resolve(false);

  const task = upload(base + activityIconPath(key), token, read)
    .catch((): UploadResult => 'retry')
    .then((result) => {
      // Bu arada sunucu ya da oturum değiştiyse sonuç yeni duruma yazılmaz
      if (scope === iconScope) {
        icons.set(
          key,
          result === 'ready'
            ? { state: 'ready' }
            : { state: 'failed', until: result === 'rejected' ? Infinity : Date.now() + ICON_RETRY_AFTER_MS },
        );
      }
      return result === 'ready';
    });
  icons.set(key, { state: 'pending', task });
  return task;
}

async function upload(url: string, token: string, read: () => Promise<Uint8Array | null>): Promise<UploadResult> {
  const headers = { Authorization: `Bearer ${token}` };
  // Çoğu ikon zaten yüklüdür (aynı oyunu oynayan herkes aynı anahtarı üretir)
  const head = await fetch(url, { method: 'HEAD', headers });
  if (head.ok) return 'ready';
  // Yalnızca "yok" (404) ya da "HEAD desteklenmiyor" yanıtında yüklenir; 401, 429, 5xx geçicidir
  if (head.status !== 404 && head.status !== 405 && head.status !== 501) return 'retry';
  const png = await read();
  if (!png) return 'retry';
  const put = await fetch(url, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'image/png' },
    body: png as Uint8Array<ArrayBuffer>,
  });
  if (put.ok) return 'ready';
  const definitive = put.status >= 400 && put.status < 500 && put.status !== 401 && put.status !== 408 && put.status !== 429;
  return definitive ? 'rejected' : 'retry';
}
