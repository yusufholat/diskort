import { normalizeServerUrl } from './api';
import { env } from './env';
import { useSession } from './session';

/**
 * İstemci ile sunucu saatleri arasındaki fark (sunucu − istemci, ms). Olay kayıtları ve ses kalitesi özetleri
 * istemci saatiyle damgalanır; sunucu bu farkla kendi saatine çevirir, böylece farklı istemcilerin aynı
 * saniyeleri yan yana konabilir ve geç ulaşan kayıt doğru zamana yerleşir.
 *
 * Ölçüm: GET /api/time; fark = sunucu saati − (istek anı + yanıt anı) / 2. Hata payı gidiş-dönüş süresinin
 * yarısıdır; bu yüzden son ölçümler arasından gidiş-dönüşü en kısa olan kullanılır. Sesliyken en çok
 * 10 dakikada bir ölçülür. Eski sunucu (404) desteklemez: fark null kalır, sunucu gönderim anından tahmin eder.
 */

const REFRESH_MS = 10 * 60_000;
/** Bu kadar yavaş yanıt ölçüm sayılmaz (hata payı çok büyük) */
const MAX_RTT_MS = 5_000;

export class ServerClock {
  private best: { offset: number; rtt: number; at: number } | null = null;
  private lastTryAt = Number.NEGATIVE_INFINITY;
  private unsupported = false;
  private busy: Promise<void> | null = null;

  constructor(private readonly now: () => number = Date.now) {}

  /** Tahmini fark (sunucu − istemci, ms); hiç ölçülemediyse null */
  get offsetMs(): number | null {
    return this.best ? Math.round(this.best.offset) : null;
  }

  /** Ölçüm eskidiyse yeniler (bekleyen ölçüm varsa onu bekler). Hata vermez. */
  refresh(force = false): Promise<void> {
    if (this.unsupported) return Promise.resolve();
    if (!force && this.now() - this.lastTryAt < REFRESH_MS) return this.busy ?? Promise.resolve();
    this.busy ??= this.measure().finally(() => {
      this.busy = null;
    });
    return this.busy;
  }

  private async measure(): Promise<void> {
    const token = useSession.getState().token;
    if (!token) return;
    this.lastTryAt = this.now();
    try {
      const t0 = this.now();
      // Yanıt gelmeyen istek (kesinti) ölçümü ve onu bekleyen gönderimi süresiz bekletmesin
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), MAX_RTT_MS);
      const res = await fetch(`${normalizeServerUrl(env().serverUrl())}/api/time`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: abort.signal,
      }).finally(() => clearTimeout(timer));
      const t1 = this.now();
      if (res.status === 404) {
        this.unsupported = true;
        return;
      }
      if (!res.ok) return;
      const body = (await res.json()) as { now?: unknown };
      const server = typeof body.now === 'number' && Number.isFinite(body.now) ? body.now : null;
      const rtt = t1 - t0;
      if (server === null || rtt < 0 || rtt > MAX_RTT_MS) return;
      const offset = server - (t0 + t1) / 2;
      // Eski ölçüm tazeyse ve daha kısa gidiş-dönüşle alındıysa o kalır (daha kesin)
      const prev = this.best;
      if (!prev || rtt <= prev.rtt || t1 - prev.at > REFRESH_MS * 3) this.best = { offset, rtt, at: t1 };
    } catch {
      // ölçülemedi: eski değer (ya da null) kalır
    }
  }
}

/** Uygulamadaki tek saat farkı ölçeri */
export const serverClock = new ServerClock();
