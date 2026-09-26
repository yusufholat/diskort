import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useGuild } from '@diskort/client-core';
import { useSettings } from '../stores/settings';
import { colors } from '../theme';
import { useVoice, voice } from '../voice/voice';

const STATUS = { connecting: 'Bağlanıyor…', reconnecting: 'Yeniden bağlanıyor…', connected: 'Ses bağlı', idle: '' };

/** Ekranın altında: bağlı olunan ses kanalı ve hızlı sustur/sağırlaştır/ayrıl düğmeleri. */
export function VoiceBar() {
  const router = useRouter();
  const status = useVoice((s) => s.status);
  const channelId = useVoice((s) => s.channelId);
  const channel = useGuild((s) => s.channels.find((c) => c.id === channelId));
  const selfMute = useSettings((s) => s.selfMute);
  const selfDeaf = useSettings((s) => s.selfDeaf);
  if (status === 'idle') return null;
  const connected = status === 'connected';

  return (
    <Pressable style={styles.bar} onPress={() => router.push('/voice')}>
      <Ionicons name="volume-high" size={22} color={connected ? colors.ok : colors.warn} />
      <View style={styles.info}>
        <Text style={[styles.status, { color: connected ? colors.ok : colors.warn }]}>{STATUS[status]}</Text>
        <Text style={styles.channel} numberOfLines={1}>
          {channel?.name ?? ''}
        </Text>
      </View>
      <IconButton icon={selfMute || selfDeaf ? 'mic-off' : 'mic'} active={selfMute || selfDeaf} onPress={() => voice.toggleMute()} />
      <IconButton icon={selfDeaf ? 'volume-mute' : 'headset'} active={selfDeaf} onPress={() => voice.toggleDeafen()} />
      <IconButton icon="call" danger onPress={() => void voice.leave()} />
    </Pressable>
  );
}

export function IconButton({
  icon,
  onPress,
  active,
  on,
  danger,
  size = 22,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  /** Kırmızı: kapalı olan bir şey (susturuldu) */
  active?: boolean;
  /** Yeşil: açık olan bir şey (yayında) */
  on?: boolean;
  danger?: boolean;
  size?: number;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [
        styles.icon,
        danger && { backgroundColor: colors.danger },
        pressed && { opacity: 0.7 },
      ]}
    >
      <Ionicons
        name={icon}
        size={size}
        color={danger ? '#fff' : active ? colors.danger : on ? colors.ok : colors.text}
        style={danger ? { transform: [{ rotate: '135deg' }] } : undefined}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.panel,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  info: { flex: 1, marginLeft: 6 },
  status: { fontSize: 14, fontWeight: '600' },
  channel: { color: colors.muted, fontSize: 12.5 },
  icon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
});
