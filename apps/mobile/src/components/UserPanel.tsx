import { Animated, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useSession } from '@diskort/client-core';
import { useBump } from '../motion';
import { useSettings } from '../stores/settings';
import { colors, createStyles, font, space } from '../theme';
import { toggleDeafen, toggleMute } from '../voice/actions';
import { useVoice } from '../voice/voice';
import { Avatar } from './Avatar';
import { PressableScale } from './PressableScale';
import { VoiceBar } from './VoiceBar';

/**
 * Kanal listesinin altındaki kullanıcı paneli (masaüstündeki gibi): avatar ve ad, sustur,
 * sağırlaştır ve ayarlar. Susturma seste değilken de hatırlanır; sonraki katılışta uygulanır.
 * Sesteyken yerini tek satırlık ses çubuğu alır (aynı düğmeler iki satırda tekrarlanmasın).
 */
export function UserPanel({ onSettings }: { onSettings: () => void }) {
  const user = useSession((s) => s.user);
  const selfMute = useSettings((s) => s.selfMute);
  const selfDeaf = useSettings((s) => s.selfDeaf);
  const micAllowed = useVoice((s) => s.micAllowed || s.status === 'idle');
  const muted = selfMute || selfDeaf || !micAllowed;
  // Ekranın en altında: gezinme çubuğunun arkası da panel renginde olsun
  const insets = useSafeAreaInsets();
  const inVoice = useVoice((s) => s.status !== 'idle');
  if (inVoice) return <VoiceBar bottomInset={insets.bottom} onSettings={onSettings} />;
  if (!user) return null;
  return (
    <View style={[styles.panel, { paddingBottom: styles.panel.paddingVertical + insets.bottom }]}>
      <PressableScale
        scaleTo={0.97}
        onPress={onSettings}
        containerStyle={{ flex: 1 }}
        style={styles.who}
        accessibilityRole="button"
        accessibilityLabel={`${user.displayName}, ayarları aç`}
      >
        <Avatar user={user} size={34} online surface={colors.panel} />
        <View style={{ flex: 1 }}>
          <Text style={styles.name} numberOfLines={1}>
            {user.displayName}
          </Text>
          <Text style={styles.username} numberOfLines={1}>
            @{user.username}
          </Text>
        </View>
      </PressableScale>
      <PanelButton
        icon={muted ? 'mic-off' : 'mic'}
        off={muted}
        label={muted ? 'Mikrofonu aç' : 'Sustur'}
        onPress={toggleMute}
      />
      <PanelButton
        icon={selfDeaf ? 'volume-mute' : 'headset'}
        off={selfDeaf}
        label={selfDeaf ? 'Sağırlaştırmayı kaldır' : 'Sağırlaştır'}
        onPress={toggleDeafen}
      />
      <PanelButton icon="settings-sharp" label="Ayarlar" onPress={onSettings} />
    </View>
  );
}

function PanelButton({
  icon,
  label,
  off,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  off?: boolean;
  onPress: () => void;
}) {
  // Simge değişince (sustur ↔ aç) kısa bir zıplamayla yenisine geçer
  const bump = useBump(icon);
  return (
    <PressableScale
      scaleTo={0.84}
      ripple={{ color: 'rgba(255,255,255,0.12)', borderless: true, radius: 20 }}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: Boolean(off) }}
      style={[styles.button, off && { backgroundColor: colors.dangerSoft }]}
    >
      <Animated.View style={{ transform: [{ scale: bump }] }}>
        <Ionicons name={icon} size={21} color={off ? colors.danger : colors.text} />
      </Animated.View>
    </PressableScale>
  );
}

const styles = createStyles(() => ({
  panel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: colors.panel,
    paddingHorizontal: space.sm,
    paddingVertical: space.sm - 2,
  },
  who: { flexDirection: 'row', alignItems: 'center', gap: space.sm + 2, paddingVertical: 4, paddingHorizontal: 4, borderRadius: 8 },
  name: { color: colors.head, fontSize: font.body - 1, fontWeight: '700' },
  username: { color: colors.muted, fontSize: font.caption },
  button: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
}));
