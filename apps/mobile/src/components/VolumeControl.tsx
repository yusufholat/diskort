import { useRef, useState } from 'react';
import { Pressable, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSettings } from '../stores/settings';
import { colors, createStyles } from '../theme';
import { voice } from '../voice/voice';
import { Slider } from './Slider';

/** Ses seviyesi 0–2 (%0–%200); %100'de kaydırıcı hafifçe yapışır */
const MAX = 2;
const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 0 };

function volumeIcon(v: number): 'volume-mute' | 'volume-low' | 'volume-medium' | 'volume-high' {
  if (v <= 0) return 'volume-mute';
  if (v < 0.5) return 'volume-low';
  if (v <= 1.05) return 'volume-medium';
  return 'volume-high';
}

/**
 * Sessize alma düğmesi + kaydırıcı + yüzde. Sürüklerken ses anında değişir (`onPreview`),
 * bırakınca kaydedilir (`onCommit`). Sessizden açınca son duyulan seviyeye döner.
 * `muted`/`onToggleMute` verilirse sessize alma ayrı bir durumdur (yayın sesi): düğme o durumu gösterir
 * ve değiştirir, seviye korunur.
 */
export function VolumeControl({
  value,
  onPreview,
  onCommit,
  onInteract,
  muted: mutedProp,
  onToggleMute,
  label,
  style,
  themed,
}: {
  value: number;
  /** Ayrı tutulan sessize alma durumu (verilmezse seviye 0 sessiz sayılır) */
  muted?: boolean;
  onToggleMute?: () => void;
  onPreview: (value: number) => void;
  onCommit: (value: number) => void;
  /** Her dokunuşta (tam ekranda denetimlerin kaybolma süresini uzatmak için) */
  onInteract?: () => void;
  label: string;
  style?: StyleProp<ViewStyle>;
  /** Temanın zemininde (sayfada); verilmezse video üstünde: beyaz simge ve yazı */
  themed?: boolean;
}) {
  const [preview, setPreview] = useState<number | null>(null);
  const shown = preview ?? value;
  const lastAudible = useRef(value > 0 ? value : 1);
  if (value > 0) lastAudible.current = value;
  const muted = preview !== null ? preview <= 0 : (mutedProp ?? shown <= 0);

  return (
    <View style={[styles.row, style]}>
      <Pressable
        onPress={() => {
          onInteract?.();
          setPreview(null);
          if (onToggleMute) onToggleMute();
          else onCommit(muted ? lastAudible.current : 0);
        }}
        // Sağda pay yok: kaydırıcının başına taşarsa dokunuş sesi 0'a çeker (düğme çalışmıyor sanılır)
        hitSlop={HIT_SLOP}
        style={({ pressed }) => [styles.mute, pressed && { opacity: 0.6 }]}
        accessibilityRole="button"
        accessibilityLabel={muted ? `${label}: sesi aç` : `${label}: sessize al`}
      >
        <Ionicons name={volumeIcon(muted ? 0 : shown)} size={20} color={muted ? colors.danger : themed ? colors.head : '#fff'} />
      </Pressable>
      <Slider
        style={styles.slider}
        trackColor={themed ? undefined : 'rgba(255,255,255,0.18)'}
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
      <Text style={[styles.percent, themed && { color: colors.head }]}>{Math.round(shown * 100)}%</Text>
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
        themed
        value={volume}
        onPreview={(v) => voice.setVolume(userId, 'voice', v, false)}
        onCommit={(v) => voice.setVolume(userId, 'voice', v)}
      />
    </View>
  );
}

const styles = createStyles(() => ({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  mute: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  slider: { flex: 1 },
  percent: { color: '#fff', fontSize: 13, fontWeight: '600', minWidth: 42, textAlign: 'right', fontVariant: ['tabular-nums'] },
  // Menü sayfasındaki öğe gruplarıyla aynı kart
  section: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    marginHorizontal: 12,
    marginBottom: 12,
    borderRadius: 12,
    backgroundColor: colors.main,
  },
  sectionTitle: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 2,
  },
}));
