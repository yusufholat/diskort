import type { ReactNode } from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, createStyles, tint } from '../theme';
import { PressableScale } from './PressableScale';

/** Başlık çubuğundaki simge düğmesi: 40 px dokunma alanı, yuvarlak dalga, basınca küçülme */
export function HeaderButton({
  icon,
  label,
  onPress,
  color = colors.muted,
  size = 23,
  children,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  color?: string;
  size?: number;
  /** Simgenin köşesine oturan rozet gibi ekler */
  children?: ReactNode;
}) {
  return (
    <PressableScale
      scaleTo={0.86}
      ripple={{ color: tint(0.12), borderless: true, radius: 20 }}
      hitSlop={4}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={styles.button}
    >
      <Ionicons name={icon} size={size} color={color} />
      {children ? <View style={styles.extra}>{children}</View> : null}
    </PressableScale>
  );
}

const styles = createStyles(() => ({
  button: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  extra: { position: 'absolute', top: 1, right: -3 },
}));
