import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { channelById, useGuild } from '@diskort/client-core';
import { useAppear, useBump } from '../motion';
import { useSettings } from '../stores/settings';
import { colors, createStyles, font, radius, space } from '../theme';
import { leaveVoice, toggleDeafen, toggleMute } from '../voice/actions';
import { useVoice } from '../voice/voice';
import { PressableScale } from './PressableScale';
import { qualityLevel, SignalBars } from './VoiceQuality';

/** Alt çubuktaki düğme boyu (tek satırda kalsın diye ses ekranındakilerden küçük) */
const BUTTON = 38;

const STATUS = { connecting: 'Bağlanıyor…', reconnecting: 'Yeniden bağlanıyor…', connected: 'Ses bağlı', idle: '' };

/**
 * Ekranın altında tek satır (Discord mobil gibi): solda bağlantı kalitesi, kanal adı ve durum
 * (dokununca ses ekranı açılır), sağda sustur / sağırlaştır / ayrıl. Sese katılınca aşağıdan
 * yükselerek belirir. `onSettings` verilirse (ana ekranda kullanıcı panelinin yerini alınca) ayarlar
 * düğmesi de olur; böylece aynı düğmeler iki satırda tekrarlanmaz.
 */
export function VoiceBar({ bottomInset = 0, onSettings }: { bottomInset?: number; onSettings?: () => void }) {
  const status = useVoice((s) => s.status);
  if (status === 'idle') return null;
  return <VoiceBarInner bottomInset={bottomInset} onSettings={onSettings} />;
}

/** `bottomInset`: ekranın en altındaysa gezinme çubuğunun arkası da panel renginde olsun diye boşluk */
function VoiceBarInner({ bottomInset, onSettings }: { bottomInset: number; onSettings?: () => void }) {
  const router = useRouter();
  const status = useVoice((s) => s.status);
  const quality = useVoice((s) => s.quality);
  const channelId = useVoice((s) => s.channelId);
  const channel = useGuild((s) => channelById(s, channelId));
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
      <View style={styles.bar}>
        <Pressable
          style={styles.info}
          android_ripple={{ color: 'rgba(255,255,255,0.07)', foreground: true }}
          onPress={() => router.push('/voice')}
          accessibilityRole="button"
          accessibilityLabel={`${channel?.name ?? 'Ses kanalı'}, ${STATUS[status]}${count > 0 ? `, ${count} kişi` : ''}. Ses ekranını aç`}
        >
          <SignalBars bars={level.bars} color={level.color} size={15} />
          <View style={styles.texts}>
            <Text style={styles.channel} numberOfLines={1}>
              {channel?.name ?? 'Ses kanalı'}
            </Text>
            <Text style={[styles.status, { color: level.color }]} numberOfLines={1}>
              {STATUS[status]}
              {count > 0 ? <Text style={styles.count}>{` · ${count} kişi`}</Text> : null}
            </Text>
          </View>
        </Pressable>
        {onSettings ? <VoiceControl icon="settings-sharp" size={BUTTON} label="Ayarlar" onPress={onSettings} /> : null}
        <VoiceControl
          icon={muted ? 'mic-off' : 'mic'}
          off={muted}
          size={BUTTON}
          label={muted ? 'Mikrofonu aç' : 'Sustur'}
          onPress={toggleMute}
        />
        <VoiceControl
          icon={selfDeaf ? 'volume-mute' : 'headset'}
          off={selfDeaf}
          size={BUTTON}
          label={selfDeaf ? 'Sağırlaştırmayı kaldır' : 'Sağırlaştır'}
          onPress={toggleDeafen}
        />
        <VoiceControl icon="call" danger size={BUTTON} label="Bağlantıyı kes" onPress={leaveVoice} />
      </View>
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

const styles = createStyles(() => ({
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
    gap: space.xxs,
    minHeight: 54,
    paddingLeft: space.xs,
    paddingRight: space.sm,
  },
  // Dokunma alanı satır boyu; dalga efekti yuvarlatılmış kutuda kalır
  info: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm + 2,
    alignSelf: 'stretch',
    marginVertical: space.xs,
    paddingHorizontal: space.sm + 2,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  texts: { flex: 1 },
  channel: { color: colors.head, fontSize: font.body - 0.5, fontWeight: '700' },
  status: { fontSize: font.caption, fontWeight: '700' },
  count: { color: colors.muted, fontWeight: '600' },
  control: { alignItems: 'center', gap: 6 },
  caption: { color: colors.muted, fontSize: 11.5, fontWeight: '600' },
}));
