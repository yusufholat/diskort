import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { LinkQuality } from '@diskort/client-core';
import { colors, createStyles } from '../theme';
import { useConnectionStats, useLastPing } from '../voice/connectionStats';
import { useVoice, type VoiceQuality } from '../voice/voice';
import { ConnectionSheet } from './ConnectionSheet';

/**
 * Renk ve dolu çubuk sayısı: ölçülen ping ve giden paket kaybından (masaüstüyle aynı eşikler: 120 ms / %3
 * sarı, 250 ms / %10 kırmızı). Ölçüm yoksa LiveKit'in bildirdiği kalite kullanılır.
 */
export function qualityLevel(quality: VoiceQuality, link: LinkQuality, connected: boolean): { bars: number; color: string } {
  if (!connected) return { bars: 1, color: colors.warn };
  if (quality === 'lost') return { bars: 0, color: colors.danger };
  if (link === 'good') return { bars: 3, color: colors.ok };
  if (link === 'fair') return { bars: 2, color: colors.warn };
  if (link === 'poor') return { bars: 1, color: colors.danger };
  if (quality === 'poor') return { bars: 1, color: colors.danger };
  if (quality === 'good') return { bars: 2, color: colors.ok };
  return { bars: 3, color: colors.ok };
}

/** Ses bağlantısının göstergesi: çubuk sayısı, renk ve son ping */
export function useVoiceLevel(): { bars: number; color: string; ping: number | null; connected: boolean } {
  const connected = useVoice((s) => s.status === 'connected');
  const quality = useVoice((s) => s.quality);
  const link = useConnectionStats((s) => s.quality);
  const ping = useLastPing();
  return { ...qualityLevel(quality, link, connected), ping: connected ? ping : null, connected };
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
            backgroundColor: i < bars ? color : 'rgba(255,255,255,0.18)',
          }}
        />
      ))}
    </View>
  );
}

/** Başlıkta: çubuklar ve gecikme ("42 ms"); dokununca bağlantı paneli açılır */
export function ConnectionQualityBadge() {
  const quality = useVoice((s) => s.quality);
  const { bars, color, ping, connected } = useVoiceLevel();
  const [open, setOpen] = useState(false);
  const label = !connected
    ? 'Bağlanıyor'
    : quality === 'lost'
      ? 'Bağlantı koptu'
      : ping !== null
        ? `Gecikme ${ping} milisaniye`
        : 'Bağlı';
  return (
    <>
      <Pressable
        style={styles.badge}
        onPress={() => setOpen(true)}
        hitSlop={8}
        android_ripple={{ color: 'rgba(255,255,255,0.12)', borderless: true, radius: 36 }}
        accessibilityRole="button"
        accessibilityLabel={`Bağlantı: ${label}. Bağlantı bilgisini aç`}
      >
        <SignalBars bars={bars} color={color} />
        {connected && ping !== null && <Text style={[styles.ping, { color }]}>{ping} ms</Text>}
      </Pressable>
      <ConnectionSheet visible={open} onClose={() => setOpen(false)} />
    </>
  );
}

const styles = createStyles(() => ({
  bars: { flexDirection: 'row', alignItems: 'flex-end' },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, paddingVertical: 6 },
  ping: { fontSize: 12.5, fontWeight: '700', fontVariant: ['tabular-nums'] },
}));
