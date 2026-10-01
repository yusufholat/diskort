import { normalizeServerUrl, useSession } from '@diskort/client-core';
import { useEffect, useState } from 'react';
import type { LineTestResult } from '../../../../shared/bridge';
import { bridge } from '../../lib/bridge';
import { cn } from '../../lib/utils';
import { useSettings } from '../../stores/settings';
import { Button, SectionTitle } from '../ui/controls';

const TONE = { bad: 'text-danger-text', warn: 'text-warn', ok: 'text-ok-text', info: 'text-text-muted' } as const;

/**
 * Hat testi: bilgisayar <-> sunucu UDP yolunu LiveKit'siz, ~12 sn ölçer (yukarı ve aşağı kayıp). Sonuç sunucuya da
 * yüklenir; yönetici panelinde "Hat testleri"nde görünür. UDP yalnızca masaüstü uygulamasının ana sürecinden açılabilir.
 */
export function LineTestSection() {
  const serverUrl = useSettings((s) => s.serverUrl);
  const token = useSession((s) => s.token);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ sec: number; total: number } | null>(null);
  const [result, setResult] = useState<LineTestResult | null>(null);

  useEffect(() => bridge?.lineTest.onProgress(setProgress), []);
  if (!bridge) return null;

  const run = async (): Promise<void> => {
    if (!token) return;
    setBusy(true);
    setResult(null);
    setProgress(null);
    try {
      setResult(await bridge!.lineTest.run(normalizeServerUrl(serverUrl), token));
    } catch (err) {
      setResult({ ok: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <>
      <SectionTitle>Hat Testi</SectionTitle>
      <p className="mb-3 text-xs text-text-muted">
        Bilgisayarınla sunucu arasındaki UDP yolunu (ses ve yayının kullandığı yol) yaklaşık 12 saniye ölçer. Sonuç yöneticiye de
        gönderilir. Test sürerken büyük indirme/yükleme yapma.
      </p>
      <Button variant="secondary" disabled={busy || !token} onClick={() => void run()}>
        {busy ? (progress ? `Ölçülüyor… ${progress.sec}/${progress.total} sn` : 'Başlıyor…') : 'Hat testini başlat'}
      </Button>
      {result && !result.ok && <p className="mt-3 text-sm text-danger-text">Test yapılamadı: {result.error}</p>}
      {result?.ok && (
        <div className="mt-3 space-y-3 text-sm select-text">
          {result.findings.map((f, i) => (
            <div key={i}>
              <p className={cn('font-medium', TONE[f.tone])}>{f.text}</p>
              {f.evidence && <p className="text-xs text-text-muted">{f.evidence}</p>}
            </div>
          ))}
          {result.streaming && <p className="text-xs text-text-muted">Test sırasında canlı yayın vardı.</p>}
          <div className="grid grid-cols-2 gap-4 text-xs">
            {(
              [
                ['Yukarı (sen → sunucu)', result.up],
                ['Aşağı (sunucu → sen)', result.down],
              ] as const
            ).map(([title, steps]) => (
              <div key={title}>
                <div className="mb-1 font-bold text-text-muted uppercase">{title}</div>
                {steps?.map((s) => (
                  <div key={s.label} className="flex justify-between">
                    <span>{s.label}</span>
                    <span className={s.lossPct >= 2 ? 'text-danger-text' : s.lossPct >= 1 ? 'text-warn' : 'text-text-normal'}>
                      kayıp %{s.lossPct}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
