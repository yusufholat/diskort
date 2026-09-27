import { useEffect, useState } from 'react';
import { Text } from 'react-native';
import type { NoiseFilterStatus } from '../../modules/noise-filter';
import { colors, createStyles } from '../theme';
import { noiseFilterStats, useNoiseFilter } from '../voice/noiseFilter';

const fmt = (n: number): string => n.toFixed(1).replace('.', ',');

/**
 * Sesli sohbet ekranında DPDFNet'in telefonda nasıl çalıştığı: kare başına ortalama/en uzun süre (bütçe
 * 10 ms; %60'ı aşılırsa standart engellemeye dönülür) ve ses iş parçacığının yükü. Yalnızca DPDFNet
 * seçiliyken görünür.
 */
export function NoiseFilterStats() {
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
  if (!stats) return null;

  let text: string;
  if (!stats.active) text = `DPDFNet kapalı: ${stats.reason ?? 'bilinmeyen neden'} · standart engelleme`;
  else if (!stats.processing)
    text =
      stats.sampleRate && stats.sampleRate !== 48000
        ? `DPDFNet bekliyor: ses ${stats.sampleRate} Hz (model 48000 Hz)`
        : `DPDFNet hazır · ısınma ${fmt(stats.warmupMs)} ms/kare`;
  else {
    const parts = [
      'DPDFNet',
      stats.avgMs !== null ? `${fmt(stats.avgMs)} ms/kare` : null,
      stats.maxMs !== null ? `en uzun ${fmt(stats.maxMs)} ms` : null,
      stats.load !== null ? `yük %${Math.round(stats.load * 100)}` : null,
      stats.overHop ? `10 ms'yi aşan: ${stats.overHop}` : null,
    ];
    text = parts.filter(Boolean).join(' · ');
  }
  return (
    <Text style={styles.text} selectable accessibilityLabel={`Gürültü engelleme: ${text}`}>
      {text}
    </Text>
  );
}

const styles = createStyles(() => ({
  text: { color: colors.muted, fontSize: 11.5, textAlign: 'center', marginVertical: 4, paddingHorizontal: 12 },
}));
