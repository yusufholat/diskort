import type { ReactNode } from 'react';
import { View } from 'react-native';
import { colors, createStyles, tint } from '../theme';
import { renderIcon, type Icon } from './icons';
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
  icon: Icon;
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
      {renderIcon(icon, size, color)}
      {children ? <View style={styles.extra}>{children}</View> : null}
    </PressableScale>
  );
}

const styles = createStyles(() => ({
  button: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  extra: { position: 'absolute', top: 1, right: -3 },
}));
