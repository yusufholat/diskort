import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type PressableProps,
  type TextInputProps,
} from 'react-native';
import { colors, radius } from '../theme';

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
    <Pressable
      {...rest}
      disabled={disabled || busy}
      style={({ pressed: p }) => [
        styles.button,
        { backgroundColor: p ? pressed : bg, opacity: disabled ? 0.5 : 1 },
      ]}
    >
      {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{title}</Text>}
    </Pressable>
  );
}

export function Field({ label, error, ...rest }: TextInputProps & { label: string; error?: string | null }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput placeholderTextColor={colors.faint} style={styles.input} {...rest} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
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
  },
  error: { color: '#fa777c', fontSize: 13, marginTop: 6 },
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
