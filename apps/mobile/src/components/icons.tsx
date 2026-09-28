import type { ReactNode } from 'react';
import type { StyleProp, TextStyle } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';

export type IconName = keyof typeof Ionicons.glyphMap;

/** Ionicons'ta karşılığı olmayan simgeler için: verilen boyut ve renkle çizer */
export type IconRenderer = (props: { size: number; color: string }) => ReactNode;

/** Düğme ve menülerin simgesi: Ionicons adı ya da kendi çizimi */
export type Icon = IconName | IconRenderer;

export function renderIcon(icon: Icon, size: number, color: string): ReactNode {
  return typeof icon === 'function' ? icon({ size, color }) : <Ionicons name={icon} size={size} color={color} />;
}

/**
 * Raptiye (Discord'daki gibi dolu ve eğik; masaüstündeki PinIcon'un karşılığı). Ionicons'ın raptiyesi ince
 * ve dik duruyordu. `off`: sabitlemeyi kaldır (çizgili; eğilince çizgi dikleşip bozulduğu için dik).
 */
export function PinIcon({
  size,
  color,
  off = false,
  accessibilityLabel,
  style,
}: {
  size: number;
  color: string;
  off?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<TextStyle>;
}) {
  return (
    <MaterialCommunityIcons
      name={off ? 'pin-off' : 'pin'}
      // Eğik raptiye kutuyu daha az doldurur: yanındaki simgelerle aynı büyüklükte görünsün
      size={off ? size : Math.round(size * 1.12)}
      color={color}
      accessibilityLabel={accessibilityLabel}
      style={[off ? null : TILT, style]}
    />
  );
}

const TILT: TextStyle = { transform: [{ rotate: '45deg' }] };

export const pinIcon: IconRenderer = ({ size, color }) => <PinIcon size={size} color={color} />;
export const unpinIcon: IconRenderer = ({ size, color }) => <PinIcon size={size} color={color} off />;
