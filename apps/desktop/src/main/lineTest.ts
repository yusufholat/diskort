import { app, ipcMain } from 'electron';
import { runSuite, SUITES } from '../../../../tools/udp-probe/probe.mjs';
import type { LineTestResult } from '../shared/bridge';

/**
 * "Hat testi": renderer UDP açamaz, bu yüzden test motoru (tools/udp-probe/probe.mjs; komut satırı aracıyla aynı
 * dosya) ana süreçte node:dgram ile çalışır. Aynı anda tek test; ilerleme 'linetest:progress' olayıyla bildirilir.
 */
export function registerLineTestIpc(): void {
  let running = false;

  ipcMain.handle('linetest:run', async (e, server: unknown, token: unknown): Promise<LineTestResult> => {
    if (running) return { ok: false, error: 'Zaten bir hat testi çalışıyor.' };
    if (typeof server !== 'string' || typeof token !== 'string' || !/^https?:\/\//.test(server) || token.length === 0) {
      return { ok: false, error: 'Geçersiz istek.' };
    }
    running = true;
    const send = (payload: unknown): void => {
      if (!e.sender.isDestroyed()) e.sender.send('linetest:progress', payload);
    };
    try {
      const res = await runSuite({
        server,
        auth: { token },
        phases: SUITES.hizli,
        client: { app: app.getVersion() },
        onEvent: (ev) => {
          if (ev.type === 'second') send({ sec: ev.sec + 1, total: ev.total });
        },
      });
      const first = res.phases[0];
      if (!first?.result) return { ok: false, error: first?.error ?? 'Test tamamlanamadı.' };
      const r = first.result;
      return {
        ok: true,
        suite: r.suite,
        findings: r.findings,
        up: r.stats.up,
        down: r.stats.down,
        streaming: r.streaming,
        unreachable: r.unreachable,
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
      running = false;
    }
  });
}
