import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { colors, createStyles, tint } from '../theme';
import { useVoice, voice, type VoiceQuality } from '../voice/voice';

const PING_INTERVAL_MS = 3000;

/** Gecikme ölçümü (yalnızca gösteren bileşen ekrandayken, birkaç saniyede bir) */
export function useVoicePing(enabled: boolean): number | null {
  const [ping, setPing] = useState<number | null>(null);
  useEffect(() => {
    if (!enabled) {
      setPing(null);
      return;
    }
    let alive = true;
    const tick = (): void =>
      void voice
        .pingMs()
        .then((ms) => alive && setPing(ms))
        .catch(() => undefined);
    tick();
    const timer = setInterval(tick, PING_INTERVAL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [enabled]);
  return ping;
}

/** Kalite ve gecikmeden renk ve dolu çubuk sayısı (gecikme varsa o belirleyicidir; masaüstüyle aynı eşikler) */
export function qualityLevel(quality: VoiceQuality, ping: number | null, connected: boolean): { bars: number; color: string } {
  if (!connected) return { bars: 1, color: colors.warn };
  if (quality === 'lost') return { bars: 0, color: colors.danger };
  if (ping !== null) {
    if (ping < 120) return { bars: 3, color: colors.ok };
    if (ping < 250) return { bars: 2, color: colors.warn };
    return { bars: 1, color: colors.danger };
  }
  if (quality === 'poor') return { bars: 1, color: colors.danger };
  if (quality === 'good') return { bars: 2, color: colors.ok };
  return { bars: 3, color: colors.ok };
}

/** Üç çubuklu bağlantı göstergesi */
export function SignalBars({ bars, color, size = 16 }: { bars: number; color: string; size?: number }) {
  const width = Math.max(3, Math.round(size / 4.5));
  return (
    <View style={[styles.bars, { height: size, gap: width * 0.6 }]} accessibilityElementsHidden>
      {[0.45, 0.72, 1].map((h, i) => (
        <View
          key={i}
          style={{
            width,
            height: Math.round(size * h),
            borderRadius: width / 2,
            backgroundColor: i < bars ? color : tint(0.18),
          }}
        />
      ))}
    </View>
  );
}

/** Başlıkta: çubuklar ve gecikme ("42 ms") */
export function ConnectionQualityBadge() {
  const status = useVoice((s) => s.status);
  const quality = useVoice((s) => s.quality);
  const connected = status === 'connected';
  const ping = useVoicePing(connected);
  const level = qualityLevel(quality, ping, connected);
  const label = !connected
    ? 'Bağlanıyor'
    : quality === 'lost'
      ? 'Bağlantı koptu'
      : ping !== null
        ? `Gecikme ${ping} milisaniye`
        : 'Bağlı';
  return (
    <View style={styles.badge} accessible accessibilityLabel={`Bağlantı: ${label}`}>
      <SignalBars bars={level.bars} color={level.color} />
      {connected && ping !== null && <Text style={[styles.ping, { color: level.color }]}>{ping} ms</Text>}
    </View>
  );
}

const styles = createStyles(() => ({
  bars: { flexDirection: 'row', alignItems: 'flex-end' },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8 },
  ping: { fontSize: 12.5, fontWeight: '700', fontVariant: ['tabular-nums'] },
}));
