import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  colors,
  createStyles,
  font,
  palettes,
  radius,
  setTheme,
  space,
  THEME_LABELS,
  THEME_NAMES,
  useTheme,
  type ThemeName,
} from '../theme';

const HINTS: Record<ThemeName, string> = {
  dark: 'Varsayılan koyu gri',
  black: 'Simsiyah, OLED ekranda pil dostu',
};

/** Ayarlar → Görünüm: tema seçimi. Seçim hemen uygulanır ve saklanır. */
export function ThemePicker() {
  const current = useTheme((s) => s.name);
  return (
    <View style={styles.row} accessibilityRole="radiogroup">
      {THEME_NAMES.map((name) => {
        const p = palettes[name];
        const selected = name === current;
        return (
          <Pressable
            key={name}
            onPress={() => setTheme(name)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={`${THEME_LABELS[name]} tema`}
            style={[styles.option, selected && styles.optionSelected]}
          >
            {/* Küçük önizleme: kanal listesi, sohbet ve bir mesaj balonu */}
            <View style={[styles.preview, { backgroundColor: p.main, borderColor: p.line }]}>
              <View style={[styles.previewSide, { backgroundColor: p.side }]}>
                <View style={[styles.previewBar, { backgroundColor: p.active, width: '70%' }]} />
                <View style={[styles.previewBar, { backgroundColor: p.hover, width: '55%' }]} />
              </View>
              <View style={styles.previewMain}>
                <View style={[styles.previewBar, { backgroundColor: p.muted, width: '60%', opacity: 0.6 }]} />
                <View style={[styles.previewBar, { backgroundColor: p.text, width: '85%', opacity: 0.8 }]} />
                <View style={[styles.previewInput, { backgroundColor: p.field }]} />
              </View>
            </View>
            <View style={styles.labelRow}>
              <Ionicons
                name={selected ? 'radio-button-on' : 'radio-button-off'}
                size={18}
                color={selected ? colors.brand : colors.faint}
              />
              <Text style={styles.label} numberOfLines={1}>
                {THEME_LABELS[name]}
              </Text>
            </View>
            <Text style={styles.hint}>{HINTS[name]}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = createStyles(() => ({
  row: { flexDirection: 'row', gap: space.md },
  option: {
    flex: 1,
    backgroundColor: colors.side,
    borderRadius: radius.lg - 4,
    borderWidth: 2,
    borderColor: colors.edge,
    padding: space.sm + 2,
  },
  optionSelected: { borderColor: colors.brand },
  preview: {
    height: 64,
    borderRadius: radius.md,
    borderWidth: 1,
    overflow: 'hidden',
    flexDirection: 'row',
  },
  previewSide: { width: '34%', padding: 6, gap: 5 },
  previewMain: { flex: 1, padding: 6, gap: 5, justifyContent: 'flex-end' },
  previewBar: { height: 5, borderRadius: 3 },
  previewInput: { height: 10, borderRadius: 5, marginTop: 2 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: space.sm + 2 },
  label: { color: colors.head, fontSize: font.body, fontWeight: '600', flexShrink: 1 },
  hint: { color: colors.muted, fontSize: font.caption, marginTop: 2, marginLeft: 24, lineHeight: 16 },
}));
