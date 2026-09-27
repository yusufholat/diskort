import { useEffect, useState, type ComponentType } from 'react';
import type { NoiseFilterStatus } from '../../modules/noise-filter';
import { noiseFilterStats, useNoiseFilter } from '../voice/noiseFilter';

const fmt = (n: number): string => n.toFixed(1).replace('.', ',');

/** " (model 4,1)" gibi: toplamın modele düşen kısmı (eski APK'larda yok) */
const split = (total: number, model: number | null | undefined): string =>
  model != null && total > 0 ? ` (model ${fmt(model)})` : '';

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

  const state = !stats.active
    ? `Kapalı: ${stats.reason ?? 'bilinmeyen neden'}`
    : stats.processing
      ? 'Çalışıyor'
      : stats.sampleRate && stats.sampleRate !== 48000
        ? `Bekliyor: ses ${stats.sampleRate} Hz (model 48000 Hz)`
        : 'Hazır (mikrofon kapalı)';
  // Kapalıyken de ölçümler gösterilir (yavaş kaldıysa nedenini anlamak için)
  const measured = stats.warmupMs > 0;
  return (
    <>
      <Row label="DPDFNet" value={stats.active && stats.provider ? `${state} (${stats.provider})` : state} />
      {measured && (
        <Row
          label="Isınmada kare süresi"
          value={`${fmt(stats.warmupMs)} ms${split(stats.warmupMs, stats.warmupModelMs)}${stats.provider && !stats.active ? `, ${stats.provider}` : ''}`}
        />
      )}
      {measured && stats.warmupFirstMs != null && (
        <Row label="Isınma ilk yarı / çekirdek" value={`${fmt(stats.warmupFirstMs)} ms / ${stats.warmupCore ?? '?'}`} />
      )}
      {stats.avgMs !== null && (
        <Row label="Kare süresi (ort. / en uzun)" value={`${fmt(stats.avgMs)} / ${fmt(stats.maxMs ?? 0)} ms`} />
      )}
      {stats.avgMs !== null && stats.modelMs != null && (
        <Row label="Model / STFT (ort.)" value={`${fmt(stats.modelMs)} / ${fmt(stats.avgMs - stats.modelMs)} ms`} />
      )}
      {stats.audioCore && <Row label="Ses iş parçacığı çekirdeği" value={stats.audioCore} />}
      {stats.cpu && <Row label="İşlemci" value={stats.soc ? `${stats.soc} · ${stats.cpu}` : stats.cpu} />}
      {stats.hint != null && <Row label="Başarım ipucu (ADPF)" value={stats.hint ? 'Açık' : 'Desteklenmiyor'} />}
      {stats.active && stats.load !== null && (
        <Row label="Ses iş parçacığı yükü" value={`%${Math.round(stats.load * 100)}`} />
      )}
      {stats.avgMs !== null && <Row label="10 ms'yi aşan kare (2 sn)" value={String(stats.overHop)} />}
      {stats.active && <Row label="İşlenen kare" value={String(stats.frames)} />}
    </>
  );
}
