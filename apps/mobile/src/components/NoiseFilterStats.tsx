import { useEffect, useState, type ComponentType } from 'react';
import type { NoiseFilterStatus } from '../../modules/noise-filter';
import { noiseFilterStats, useNoiseFilter } from '../voice/noiseFilter';

const fmt = (n: number): string => n.toFixed(1).replace('.', ',');

/**
 * Bağlantı panelinde (Mikrofon işleme) DPDFNet'in telefonda nasıl çalıştığı: kare başına ortalama/en uzun
 * süre (bütçe 10 ms; ortalama %60'ı aşarsa standart engellemeye dönülür), ses iş parçacığının yükü ve
 * çalışmıyorsa nedeni. Ölçümler 2 saniyede bir tazelenir.
 */
export function NoiseFilterRows({ Row }: { Row: ComponentType<{ label: string; value: string }> }) {
  const selected = useNoiseFilter((s) => s.status !== null);
  const [stats, setStats] = useState<NoiseFilterStatus | null>(null);
  useEffect(() => {
    if (!selected) {
      setStats(null);
      return;
    }
    const tick = (): void => setStats(noiseFilterStats());
    tick();
    const timer = setInterval(tick, 2000);
    return () => clearInterval(timer);
  }, [selected]);
  if (!stats) return <Row label="DPDFNet" value="Sesli sohbette yüklenir" />;

  if (!stats.active) return <Row label="DPDFNet" value={`Kapalı: ${stats.reason ?? 'bilinmeyen neden'}`} />;
  const state = stats.processing
    ? 'Çalışıyor'
    : stats.sampleRate && stats.sampleRate !== 48000
      ? `Bekliyor: ses ${stats.sampleRate} Hz (model 48000 Hz)`
      : 'Hazır (mikrofon kapalı)';
  return (
    <>
      <Row label="DPDFNet" value={state} />
      <Row label="Isınmada kare süresi" value={`${fmt(stats.warmupMs)} ms`} />
      {stats.avgMs !== null && (
        <Row label="Kare süresi (ort. / en uzun)" value={`${fmt(stats.avgMs)} / ${fmt(stats.maxMs ?? 0)} ms`} />
      )}
      {stats.load !== null && <Row label="Ses iş parçacığı yükü" value={`%${Math.round(stats.load * 100)}`} />}
      {stats.avgMs !== null && <Row label="10 ms'yi aşan kare (2 sn)" value={String(stats.overHop)} />}
      <Row label="İşlenen kare" value={String(stats.frames)} />
    </>
  );
}
