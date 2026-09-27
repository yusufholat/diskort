import { useEffect, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type PressableProps,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppear, useShake } from '../motion';
import { colors, font, radius, ripple, space } from '../theme';
import { PressableScale } from './PressableScale';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

const BG: Record<Variant, [string, string]> = {
  primary: [colors.brand, colors.brandPressed],
  secondary: [colors.control, colors.controlPressed],
  danger: [colors.danger, colors.dangerPressed],
  ghost: ['transparent', 'rgba(255,255,255,0.06)'],
};

export function Button({
  title,
  variant = 'primary',
  busy,
  disabled,
  ...rest
}: PressableProps & { title: string; variant?: Variant; busy?: boolean }) {
  const [bg, pressed] = BG[variant];
  return (
    <PressableScale
      scaleTo={0.97}
      ripple={variant === 'ghost' ? true : { color: 'rgba(255,255,255,0.12)', foreground: true }}
      {...rest}
      disabled={disabled || busy}
      style={({ pressed: p }) => [
        styles.button,
        { backgroundColor: p ? pressed : bg, opacity: disabled ? 0.5 : 1 },
      ]}
    >
      {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{title}</Text>}
    </PressableScale>
  );
}

export function Field({ label, error, ...rest }: TextInputProps & { label: string; error?: string | null }) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.field}>
      <Text style={[styles.label, error ? { color: '#fa777c' } : null]}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.faint}
        selectionColor={colors.brand}
        cursorColor={colors.head}
        {...rest}
        onFocus={(e) => {
          setFocused(true);
          rest.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          rest.onBlur?.(e);
        }}
        // Odakta mor, hatada kırmızı ince kenar
        style={[styles.input, focused && styles.inputFocused, error ? styles.inputError : null]}
      />
      {error ? (
        <FadeIn style={styles.errorRow}>
          <Text style={styles.error}>{error}</Text>
        </FadeIn>
      ) : null}
    </View>
  );
}

/** Hata kutusu gibi sonradan beliren içerik: yukarıdan hafifçe kayarak gelir, `shakeKey` değişince sallanır */
export function FadeIn({
  children,
  style,
  shakeKey,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  shakeKey?: number;
}) {
  const appear = useAppear(true, 200);
  const [shakeX, shake] = useShake();
  useEffect(() => {
    if (shakeKey) shake();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shakeKey]);
  return (
    <Animated.View
      style={[
        style,
        {
          opacity: appear,
          transform: [
            { translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [-6, 0] }) },
            { translateX: shakeX },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <Text style={styles.section}>{children}</Text>;
}

/** Ayarlar gibi sayfalarda yuvarlak köşeli grup */
export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

/** Karttaki gezinme satırı: simge kutusu, ad, isteğe bağlı açıklama/değer ve ok */
export function NavRow({
  icon,
  iconColor = colors.brand,
  label,
  detail,
  value,
  onPress,
  danger,
  first,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  iconColor?: string;
  label: string;
  detail?: string;
  value?: string;
  onPress?: () => void;
  danger?: boolean;
  /** Kartın ilk satırı (üstünde ayırıcı çizgi olmaz) */
  first?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      android_ripple={ripple.row}
      accessibilityRole={onPress ? 'button' : 'text'}
      style={styles.navRow}
    >
      {!first && <View style={styles.navDivider} />}
      <View style={[styles.navIcon, { backgroundColor: danger ? colors.danger : iconColor }]}>
        <Ionicons name={icon} size={17} color="#fff" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.navLabel, danger && { color: colors.dangerText }]}>{label}</Text>
        {detail ? <Text style={styles.navDetail}>{detail}</Text> : null}
      </View>
      {value ? (
        <Text style={styles.navValue} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {onPress ? <Ionicons name="chevron-forward" size={18} color={colors.faint} /> : null}
    </Pressable>
  );
}

export const ui = StyleSheet.create({
  errorBox: {
    backgroundColor: 'rgba(242,63,67,0.15)',
    borderRadius: radius.sm,
    padding: 10,
    marginBottom: 12,
  },
  errorText: { color: '#fa777c', fontSize: 14 },
});

const styles = StyleSheet.create({
  button: {
    height: 46,
    borderRadius: radius.md,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  buttonText: { color: '#fff', fontSize: 15.5, fontWeight: '600' },
  field: { marginBottom: 16 },
  label: { color: colors.muted, fontSize: 12, fontWeight: '700', marginBottom: 8, textTransform: 'uppercase' },
  input: {
    height: 46,
    borderRadius: radius.md,
    backgroundColor: colors.input,
    color: colors.text,
    paddingHorizontal: 12,
    fontSize: 16,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  inputFocused: { borderColor: 'rgba(88,101,242,0.7)' },
  inputError: { borderColor: colors.danger },
  errorRow: { marginTop: 6 },
  error: { color: '#fa777c', fontSize: 13 },
  section: {
    color: colors.muted,
    fontSize: font.caption,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: space.xxl,
    marginBottom: space.sm,
    marginLeft: space.xs,
  },
  card: { backgroundColor: colors.side, borderRadius: radius.lg - 4, overflow: 'hidden' },
  navRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 52, paddingHorizontal: space.md + 2, paddingVertical: space.sm + 2 },
  navDivider: { position: 'absolute', top: 0, left: 56, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: colors.line },
  navIcon: { width: 30, height: 30, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  navLabel: { color: colors.head, fontSize: font.row, fontWeight: '500' },
  navDetail: { color: colors.muted, fontSize: font.caption + 0.5, marginTop: 1, lineHeight: 17 },
  navValue: { color: colors.muted, fontSize: font.small + 0.5, maxWidth: '45%' },
});
