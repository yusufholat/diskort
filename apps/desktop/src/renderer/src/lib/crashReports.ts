import { gateway, sendClientError } from '@diskort/client-core';
import { useVoice } from '../stores/voice';
import { bridge } from './bridge';

/**
 * Süreç çökmesi bildirimleri (bkz. ana süreçte crashReport.ts): ana sürecin diske yazdığı bildirimleri
 * sunucuya gönderir (POST /api/client-errors) ve ulaşanları kuyruktan sildirir. Ulaşmayan bildirim kuyrukta
 * kalır: yeni bildirimde, sunucu bağlantısı kurulunca (READY) ve sonraki açılışta yeniden denenir.
 * Ayrıca çökme anının bağlamı için ana sürece ses durumunu bildirir (seste mi, yayında mı, izliyor mu).
 */

let flushing = false;
let again = false;

async function flush(): Promise<void> {
  const crash = bridge?.crash;
  if (!crash) return;
  if (flushing) {
    again = true;
    return;
  }
  flushing = true;
  try {
    do {
      again = false;
      const pending = await crash.pending();
      const sent: string[] = [];
      for (const r of pending) {
        if (await sendClientError(r.where, r.message, r.detail)) sent.push(r.id);
        else break; // sunucuya ulaşılamıyor: kalanlar sonra
      }
      if (sent.length > 0) await crash.ack(sent);
    } while (again);
  } catch {
    // ana süreç yanıt vermedi: sonraki denemede
  } finally {
    flushing = false;
  }
}

/** Uygulama açılışında bir kez çağrılır (istemci çekirdeği yapılandırıldıktan sonra) */
export function startCrashReports(): void {
  const crash = bridge?.crash;
  if (!crash) return;
  crash.onPending(() => void flush());
  gateway.on((msg) => {
    if (msg.t === 'READY') void flush();
  });
  void flush();

  const context = (): { voice: boolean; streaming: boolean; watching: boolean } => {
    const v = useVoice.getState();
    return { voice: v.status !== 'idle', streaming: v.sharing, watching: Object.keys(v.watching).length > 0 };
  };
  let last = context();
  crash.setContext(last);
  useVoice.subscribe(() => {
    const next = context();
    if (next.voice === last.voice && next.streaming === last.streaming && next.watching === last.watching) return;
    last = next;
    crash.setContext(next);
  });
}
