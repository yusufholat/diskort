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
  black: 'Simsiyah, OLED ekranda pil dostu',
  dark: 'Klasik koyu gri',
  light: 'Beyaz zemin, koyu yazı',
  midnight: 'Lacivert tonlar',
  purple: 'Koyu mor, eflatun vurgu',
  forest: 'Koyu yeşil, deniz yeşili',
  sunset: 'Sıcak kahve, turuncu vurgu',
};

/** Ayarlar → Görünüm: tema seçimi (iki sütunlu ızgara). Seçim hemen uygulanır ve saklanır. */
export function ThemePicker() {
  const current = useTheme((s) => s.name);
  return (
    <View style={styles.grid} accessibilityRole="radiogroup">
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
            {/* Küçük önizleme: kanal listesi, sohbet, bağlantı ve yazma kutusu (temanın kendi renkleriyle) */}
            <View style={[styles.preview, { backgroundColor: p.main, borderColor: p.line }]}>
              <View style={[styles.previewSide, { backgroundColor: p.side }]}>
                <View style={[styles.previewDot, { backgroundColor: p.brand }]} />
                <View style={[styles.previewBar, { backgroundColor: p.active, width: '80%' }]} />
                <View style={[styles.previewBar, { backgroundColor: p.faint, width: '60%', opacity: 0.6 }]} />
              </View>
              <View style={styles.previewMain}>
                <View style={[styles.previewBar, { backgroundColor: p.head, width: '45%' }]} />
                <View style={[styles.previewBar, { backgroundColor: p.text, width: '85%', opacity: 0.75 }]} />
                <View style={[styles.previewBar, { backgroundColor: p.link, width: '55%' }]} />
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
            <Text style={styles.hint} numberOfLines={2}>
              {HINTS[name]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = createStyles(() => ({
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: space.md },
  option: {
    width: '48.5%',
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
  previewDot: { width: 10, height: 10, borderRadius: 4 },
  previewMain: { flex: 1, padding: 6, gap: 4, justifyContent: 'flex-end' },
  previewBar: { height: 5, borderRadius: 3 },
  previewInput: { height: 10, borderRadius: 5, marginTop: 2 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: space.sm + 2 },
  label: { color: colors.head, fontSize: font.body, fontWeight: '600', flexShrink: 1 },
  hint: { color: colors.muted, fontSize: font.caption, marginTop: 2, marginLeft: 24, lineHeight: 16 },
}));
