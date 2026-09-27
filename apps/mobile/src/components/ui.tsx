import { useEffect, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
  StyleSheet,
  Text,
  TextInput,
  View,
  type PressableProps,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { useAppear, useShake } from '../motion';
import { colors, radius } from '../theme';
import { PressableScale } from './PressableScale';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

const BG: Record<Variant, [string, string]> = {
  primary: [colors.brand, colors.brandPressed],
  secondary: ['#4e5058', '#6d6f78'],
  danger: [colors.danger, '#da373c'],
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
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  buttonText: { color: '#fff', fontSize: 15.5, fontWeight: '600' },
  field: { marginBottom: 16 },
  label: { color: colors.muted, fontSize: 12, fontWeight: '700', marginBottom: 8, textTransform: 'uppercase' },
  input: {
    height: 46,
    borderRadius: radius.sm,
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
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: 20,
    marginBottom: 8,
  },
});
