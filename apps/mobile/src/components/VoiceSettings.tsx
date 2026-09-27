import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { useSettings } from '../stores/settings';
import { colors } from '../theme';
import { useVoice, voice } from '../voice/voice';
import { Slider } from './Slider';
import { SectionTitle } from './ui';

/** Göstergenin ölçeği (dBFS): -80 en sol, 0 en sağ */
const METER_MIN = -80;
const toRatio = (db: number): number => Math.min(1, Math.max(0, (db - METER_MIN) / -METER_MIN));

/**
 * Ayarlar → Ses: gürültü/yankı engelleme, otomatik ses seviyesi ve ses algılama (masaüstündeki
 * "ses aktivitesi"nin telefondaki karşılığı; canlı seviye göstergesiyle).
 */
export function VoiceSettings() {
  const noiseSuppression = useSettings((s) => s.noiseSuppression);
  const echoCancellation = useSettings((s) => s.echoCancellation);
  const autoGainControl = useSettings((s) => s.autoGainControl);
  const voiceActivity = useSettings((s) => s.voiceActivity);
  const vadAuto = useSettings((s) => s.vadAuto);
  const threshold = useSettings((s) => s.vadThresholdDb);
  const set = useSettings((s) => s.set);
  const inVoice = useVoice((s) => s.status !== 'idle');
  // Eşik sürüklenirken göstergedeki çizgi anında kayar; bırakınca kaydedilir
  const [preview, setPreview] = useState<number | null>(null);

  return (
    <View>
      <SectionTitle>Ses</SectionTitle>
      <ToggleRow
        label="Gürültü engelleme"
        description="Fan, trafik, klima gibi sürekli arka plan seslerini azaltır."
        value={noiseSuppression}
        onChange={(v) => set({ noiseSuppression: v })}
      />
      <ToggleRow
        label="Yankı engelleme"
        description="Hoparlörden gelen sesin mikrofona geri girmesini önler."
        value={echoCancellation}
        onChange={(v) => set({ echoCancellation: v })}
      />
      <ToggleRow
        label="Otomatik ses seviyesi"
        description="Mikrofonunun seviyesini otomatik dengeler."
        value={autoGainControl}
        onChange={(v) => set({ autoGainControl: v })}
      />
      {inVoice && (
        <Text style={styles.note}>Bu üç ayar sesli sohbete bir sonraki katılışında uygulanır.</Text>
      )}

      <ToggleRow
        label="Ses algılama"
        description="Konuşmadığın anlarda mikrofonun sessize alınır; klavye, tabak çanak gibi sesler gitmez."
        value={voiceActivity}
        onChange={(v) => set({ voiceActivity: v })}
      />
      {voiceActivity && (
        <View style={styles.vad}>
          <ToggleRow
            label="Hassasiyeti otomatik belirle"
            description="Eşik ortamın gürültüsüne göre kendiliğinden ayarlanır."
            value={vadAuto}
            onChange={(v) => set({ vadAuto: v })}
          />
          <MicMeter threshold={vadAuto ? null : (preview ?? threshold)} />
          {!vadAuto && (
            <Slider
              value={threshold}
              min={METER_MIN}
              max={0}
              step={1}
              accessibilityLabel="Giriş hassasiyeti"
              accessibilityText={(v) => `${Math.round(v)} desibel`}
              onChange={setPreview}
              onChangeEnd={(v) => {
                setPreview(null);
                set({ vadThresholdDb: Math.round(v) });
              }}
            />
          )}
          <Text style={styles.hint}>
            {inVoice
              ? `Çubuk yeşile döndüğünde sesin iletilir. Eşik: ${vadAuto ? 'otomatik' : `${Math.round(preview ?? threshold)} dB`}.`
              : 'Seviye göstergesi sesli sohbete bağlıyken çalışır.'}{' '}
            Uygulama arka plandayken (ekran kapalı) ses algılama çalışmaz; mikrofon açık kalır.
          </Text>
        </View>
      )}
    </View>
  );
}

/** Mikrofonun anlık seviyesi ve eşik çizgisi (yalnızca sesli sohbetteyken ölçülür) */
function MicMeter({ threshold }: { threshold: number | null }) {
  const inVoice = useVoice((s) => s.status === 'connected');
  const level = useVoice((s) => s.micLevel);
  // Gösterge ekrandayken ölçüm sürer
  useEffect(() => (inVoice ? voice.watchMicLevel() : undefined), [inVoice]);

  const levelRatio = toRatio(level.db);
  // Otomatikte o anki (gürültüye göre belirlenen) eşik gösterilir
  const thresholdRatio = toRatio(threshold ?? level.threshold);
  return (
    <View style={styles.meter} accessibilityLabel="Mikrofon seviyesi">
      <View style={styles.meterTrack}>
        <View style={[styles.meterFill, { width: `${Math.min(levelRatio, thresholdRatio) * 100}%` }]} />
        {levelRatio > thresholdRatio && (
          <View
            style={[
              styles.meterFill,
              styles.meterOpen,
              { left: `${thresholdRatio * 100}%`, width: `${(levelRatio - thresholdRatio) * 100}%` },
            ]}
          />
        )}
      </View>
      <View style={[styles.meterMark, { left: `${thresholdRatio * 100}%` }]} />
    </View>
  );
}

function ToggleRow({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description?: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <Pressable
      onPress={() => onChange(!value)}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.8 }]}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={label}
    >
      <View style={{ flex: 1 }}>
        <Text style={styles.label}>{label}</Text>
        {description ? <Text style={styles.description}>{description}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: '#4e5058', true: colors.brand }}
        thumbColor="#fff"
      />
    </Pressable>
  );
}

const THUMB_PAD = 9;

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  label: { color: colors.text, fontSize: 15.5, fontWeight: '500' },
  description: { color: colors.muted, fontSize: 13, lineHeight: 18, marginTop: 2 },
  note: { color: colors.warn, fontSize: 13, lineHeight: 18, marginBottom: 4 },
  vad: { paddingLeft: 12, borderLeftWidth: 2, borderLeftColor: colors.line, marginLeft: 2, marginBottom: 4 },
  hint: { color: colors.muted, fontSize: 12.5, lineHeight: 18, marginTop: 6 },
  // Kaydırıcıyla hizalı olsun diye iki yanda başparmak payı bırakılır
  meter: { height: 22, justifyContent: 'center', marginHorizontal: THUMB_PAD, marginTop: 6 },
  meterTrack: { height: 8, borderRadius: 4, backgroundColor: '#4e5058', overflow: 'hidden' },
  meterFill: { position: 'absolute', top: 0, bottom: 0, left: 0, backgroundColor: colors.warn },
  meterOpen: { backgroundColor: colors.ok },
  meterMark: { position: 'absolute', top: 1, bottom: 1, width: 2, marginLeft: -1, backgroundColor: 'rgba(255,255,255,0.8)' },
});
