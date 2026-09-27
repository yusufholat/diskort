import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useGuild } from '@diskort/client-core';
import { useAppear, useBump } from '../motion';
import { useSettings } from '../stores/settings';
import { colors, font, radius, space } from '../theme';
import { leaveVoice, toggleDeafen, toggleMute } from '../voice/actions';
import { useVoice } from '../voice/voice';
import { PressableScale } from './PressableScale';
import { qualityLevel, SignalBars } from './VoiceQuality';

const STATUS = { connecting: 'Bağlanıyor…', reconnecting: 'Yeniden bağlanıyor…', connected: 'Ses bağlı', idle: '' };

/**
 * Ekranın altında: bağlı olunan ses kanalı, bağlantı kalitesi ve hızlı sustur/sağırlaştır/ayrıl
 * düğmeleri. Sese katılınca aşağıdan yükselerek belirir; dokununca ses ekranı açılır.
 */
export function VoiceBar({ bottomInset = 0 }: { bottomInset?: number }) {
  const status = useVoice((s) => s.status);
  if (status === 'idle') return null;
  return <VoiceBarInner bottomInset={bottomInset} />;
}

/** `bottomInset`: ekranın en altındaysa gezinme çubuğunun arkası da panel renginde olsun diye boşluk */
function VoiceBarInner({ bottomInset }: { bottomInset: number }) {
  const router = useRouter();
  const status = useVoice((s) => s.status);
  const quality = useVoice((s) => s.quality);
  const channelId = useVoice((s) => s.channelId);
  const channel = useGuild((s) => s.channels.find((c) => c.id === channelId));
  const count = useGuild((s) => {
    let n = 0;
    for (const id in s.voiceStates) if (s.voiceStates[id]!.channelId === channelId) n++;
    return n;
  });
  const selfMute = useSettings((s) => s.selfMute);
  const selfDeaf = useSettings((s) => s.selfDeaf);
  // Konuşma izni yoksa (yetki ya da sunucuda susturma) mikrofon kapalı görünür
  const micAllowed = useVoice((s) => s.micAllowed);
  const appear = useAppear(true, 220);
  const connected = status === 'connected';
  const muted = selfMute || selfDeaf || !micAllowed;
  const level = qualityLevel(quality, null, connected);

  return (
    <Animated.View
      style={[
        styles.wrap,
        { paddingBottom: bottomInset },
        { opacity: appear, transform: [{ translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }] },
      ]}
    >
      <Pressable
        style={styles.bar}
        android_ripple={{ color: 'rgba(255,255,255,0.06)', foreground: true }}
        onPress={() => router.push('/voice')}
        accessibilityRole="button"
        accessibilityLabel={`${STATUS[status]}, ${channel?.name ?? ''}. Ses ekranını aç`}
      >
        <SignalBars bars={level.bars} color={level.color} size={17} />
        <View style={styles.info}>
          <Text style={[styles.status, { color: level.color }]} numberOfLines={1}>
            {STATUS[status]}
          </Text>
          <Text style={styles.channel} numberOfLines={1}>
            {channel?.name ?? ''}
            {count > 0 ? ` · ${count} kişi` : ''}
          </Text>
        </View>
        <VoiceControl icon={muted ? 'mic-off' : 'mic'} off={muted} label={muted ? 'Mikrofonu aç' : 'Sustur'} onPress={toggleMute} />
        <VoiceControl
          icon={selfDeaf ? 'volume-mute' : 'headset'}
          off={selfDeaf}
          label={selfDeaf ? 'Sağırlaştırmayı kaldır' : 'Sağırlaştır'}
          onPress={toggleDeafen}
        />
        <VoiceControl icon="call" danger label="Bağlantıyı kes" onPress={leaveVoice} />
      </Pressable>
    </Animated.View>
  );
}

/**
 * Ses denetim düğmesi (alt çubukta ve ses ekranında). Kapalı olan (susturuldu) kırmızı, açık olan
 * (yayında) yeşil, ayrıl kırmızı dolgu. Simge değişince kısa zıplar.
 */
export function VoiceControl({
  icon,
  label,
  onPress,
  off,
  on,
  danger,
  size = 40,
  caption,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  /** Kırmızı: kapalı olan bir şey (susturuldu) */
  off?: boolean;
  /** Yeşil: açık olan bir şey (yayında) */
  on?: boolean;
  danger?: boolean;
  size?: number;
  /** Düğmenin altındaki kısa ad (ses ekranında) */
  caption?: string;
}) {
  const bump = useBump(icon);
  const bg = danger ? colors.danger : off ? colors.dangerSoft : on ? colors.okSoft : caption ? colors.active : 'transparent';
  const fg = danger ? '#fff' : off ? colors.danger : on ? colors.ok : colors.text;
  return (
    <View style={styles.control}>
      <PressableScale
        scaleTo={0.86}
        onPress={onPress}
        hitSlop={4}
        ripple={{ color: 'rgba(255,255,255,0.16)', borderless: true, radius: size / 2 }}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected: Boolean(off || on) }}
        style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}
      >
        <Animated.View style={{ transform: [{ scale: bump }] }}>
          <Ionicons
            name={icon}
            size={Math.round(size * 0.5)}
            color={fg}
            style={danger && icon === 'call' ? { transform: [{ rotate: '135deg' }] } : undefined}
          />
        </Animated.View>
      </PressableScale>
      {caption ? (
        <Text style={[styles.caption, (off || danger) && { color: colors.dangerText }, on && { color: colors.ok }]} numberOfLines={1}>
          {caption}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.panel,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    overflow: 'hidden',
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingLeft: space.lg,
    paddingRight: space.sm,
    paddingVertical: space.sm,
  },
  info: { flex: 1, marginLeft: space.sm },
  status: { fontSize: font.small + 0.5, fontWeight: '700' },
  channel: { color: colors.muted, fontSize: font.caption + 0.5 },
  control: { alignItems: 'center', gap: 6 },
  caption: { color: colors.muted, fontSize: 11.5, fontWeight: '600' },
});
