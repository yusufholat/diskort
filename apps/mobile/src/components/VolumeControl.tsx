import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSettings } from '../stores/settings';
import { colors } from '../theme';
import { voice } from '../voice/voice';
import { Slider } from './Slider';

/** Ses seviyesi 0–2 (%0–%200); %100'de kaydırıcı hafifçe yapışır */
const MAX = 2;

function volumeIcon(v: number): 'volume-mute' | 'volume-low' | 'volume-medium' | 'volume-high' {
  if (v <= 0) return 'volume-mute';
  if (v < 0.5) return 'volume-low';
  if (v <= 1.05) return 'volume-medium';
  return 'volume-high';
}

/**
 * Sessize alma düğmesi + kaydırıcı + yüzde. Sürüklerken ses anında değişir (`onPreview`),
 * bırakınca kaydedilir (`onCommit`). Sessizden açınca son duyulan seviyeye döner.
 */
export function VolumeControl({
  value,
  onPreview,
  onCommit,
  onInteract,
  label,
  style,
}: {
  value: number;
  onPreview: (value: number) => void;
  onCommit: (value: number) => void;
  /** Her dokunuşta (tam ekranda denetimlerin kaybolma süresini uzatmak için) */
  onInteract?: () => void;
  label: string;
  style?: StyleProp<ViewStyle>;
}) {
  const [preview, setPreview] = useState<number | null>(null);
  const shown = preview ?? value;
  const lastAudible = useRef(value > 0 ? value : 1);
  if (value > 0) lastAudible.current = value;
  const muted = shown <= 0;

  return (
    <View style={[styles.row, style]}>
      <Pressable
        onPress={() => {
          onInteract?.();
          onCommit(muted ? lastAudible.current : 0);
        }}
        hitSlop={8}
        style={({ pressed }) => [styles.mute, pressed && { opacity: 0.6 }]}
        accessibilityRole="button"
        accessibilityLabel={muted ? `${label}: sesi aç` : `${label}: sessize al`}
      >
        <Ionicons name={volumeIcon(shown)} size={20} color={muted ? colors.danger : '#fff'} />
      </Pressable>
      <Slider
        style={styles.slider}
        value={shown}
        min={0}
        max={MAX}
        snapTo={1}
        step={0.01}
        accessibilityLabel={label}
        accessibilityText={(v) => `%${Math.round(v * 100)}`}
        onChange={(v) => {
          onInteract?.();
          setPreview(v);
          onPreview(v);
        }}
        onChangeEnd={(v) => {
          setPreview(null);
          onCommit(v);
        }}
      />
      <Text style={styles.percent}>{Math.round(shown * 100)}%</Text>
    </View>
  );
}

/** Seste bir kişinin sesi (yalnızca senin için); uzun basınca açılan sayfada */
export function UserVolume({ userId }: { userId: string }) {
  const volume = useSettings((s) => s.userVolumes[userId] ?? 1);
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Kullanıcı ses seviyesi</Text>
      <VolumeControl
        label="Kullanıcı ses seviyesi"
        value={volume}
        onPreview={(v) => voice.setVolume(userId, 'voice', v, false)}
        onCommit={(v) => voice.setVolume(userId, 'voice', v)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  mute: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  slider: { flex: 1 },
  percent: { color: '#fff', fontSize: 13, fontWeight: '600', minWidth: 42, textAlign: 'right', fontVariant: ['tabular-nums'] },
  section: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  sectionTitle: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 2,
  },
});
