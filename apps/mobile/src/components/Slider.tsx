import { useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { spring } from '../motion';
import { colors } from '../theme';

const THUMB = 18;
/** Dokunma alanı yüksekliği (görünen çizgi 4 piksel; parmakla tutmak kolay olsun) */
const HIT = 36;

type Props = {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  /** Bu değere yakın bırakılırsa ona yapışır (ör. ses için %100) */
  snapTo?: number;
  /** Sürüklerken her değişimde */
  onChange?: (value: number) => void;
  /** Bırakınca (kaydetmek için) */
  onChangeEnd?: (value: number) => void;
  disabled?: boolean;
  color?: string;
  trackColor?: string;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel: string;
  /** Ekran okuyucuda değerin söylenişi (ör. "%80") */
  accessibilityText?: (value: number) => string;
};

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

/**
 * Yerel bağımlılık gerektirmeyen kaydırıcı (PanResponder + Animated). Çizginin herhangi bir yerine
 * dokununca oraya atlar; sürüklerken başparmak büyür. Dokunuş başladıktan sonra üstteki kaydırma
 * alanları ya da aşağı sürükleyince kapanan sayfa hareketi devralamaz.
 */
export function Slider({
  value,
  min = 0,
  max = 1,
  step,
  snapTo,
  onChange,
  onChangeEnd,
  disabled,
  color = colors.brand,
  trackColor = 'rgba(255,255,255,0.18)',
  style,
  accessibilityLabel,
  accessibilityText,
}: Props) {
  const [width, setWidth] = useState(0);
  // Sürüklenirken gösterilen değer (üst bileşen yalnızca bırakınca güncellenebilir)
  const [dragValue, setDragValue] = useState<number | null>(null);
  const grow = useRef(new Animated.Value(1)).current;
  const live = useRef({ min, max, step, snapTo, onChange, onChangeEnd, disabled, width });
  live.current = { min, max, step, snapTo, onChange, onChangeEnd, disabled, width };
  const drag = useRef({ startX: 0, last: value }).current;

  const pan = useMemo(() => {
    const valueAt = (x: number): number => {
      const l = live.current;
      const ratio = l.width > 0 ? clamp(x / l.width, 0, 1) : 0;
      let v = l.min + ratio * (l.max - l.min);
      if (l.snapTo !== undefined && Math.abs(v - l.snapTo) <= (l.max - l.min) * 0.03) v = l.snapTo;
      else if (l.step) v = Math.round(v / l.step) * l.step;
      return clamp(v, l.min, l.max);
    };
    const move = (x: number): void => {
      const v = valueAt(x);
      if (v === drag.last) return;
      drag.last = v;
      setDragValue(v);
      live.current.onChange?.(v);
    };
    const end = (): void => {
      spring(grow, 1, 4).start();
      setDragValue(null);
      live.current.onChangeEnd?.(drag.last);
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => !live.current.disabled,
      onMoveShouldSetPanResponder: () => !live.current.disabled,
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: (e) => {
        // Çocuklar dokunuş almaz: konum her zaman bu kutuya göre (başparmak payı çıkarılır)
        drag.startX = e.nativeEvent.locationX - THUMB / 2;
        drag.last = Number.NaN;
        spring(grow, 1.35, 4).start();
        move(drag.startX);
      },
      onPanResponderMove: (_, g) => move(drag.startX + g.dx),
      onPanResponderRelease: end,
      onPanResponderTerminate: end,
    });
  }, [drag, grow]);

  const shown = clamp(dragValue ?? value, min, max);
  const ratio = max > min ? (shown - min) / (max - min) : 0;
  const offset = ratio * width;
  const stepBy = (max - min) / 10;
  const nudge = (delta: number): void => {
    const v = clamp(shown + delta, min, max);
    onChange?.(v);
    onChangeEnd?.(v);
  };

  return (
    <View
      style={[styles.hit, disabled && { opacity: 0.45 }, style]}
      onLayout={(e) => setWidth(Math.max(0, e.nativeEvent.layout.width - THUMB))}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: Boolean(disabled) }}
      accessibilityValue={
        accessibilityText ? { text: accessibilityText(shown) } : { min: 0, max: 100, now: Math.round(ratio * 100) }
      }
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => nudge(e.nativeEvent.actionName === 'increment' ? stepBy : -stepBy)}
      {...pan.panHandlers}
    >
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <View style={[styles.track, { backgroundColor: trackColor }]} />
        <View style={[styles.fill, { width: offset, backgroundColor: color }]} />
        {snapTo !== undefined && snapTo > min && snapTo < max && (
          <View style={[styles.tick, { left: THUMB / 2 + ((snapTo - min) / (max - min)) * width - 1 }]} />
        )}
        <Animated.View style={[styles.thumb, { left: offset, transform: [{ scale: grow }] }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hit: { height: HIT, justifyContent: 'center' },
  track: {
    position: 'absolute',
    left: THUMB / 2,
    right: THUMB / 2,
    top: (HIT - 4) / 2,
    height: 4,
    borderRadius: 2,
  },
  fill: { position: 'absolute', left: THUMB / 2, top: (HIT - 4) / 2, height: 4, borderRadius: 2 },
  tick: {
    position: 'absolute',
    top: (HIT - 10) / 2,
    width: 2,
    height: 10,
    borderRadius: 1,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  thumb: {
    position: 'absolute',
    top: (HIT - THUMB) / 2,
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: '#fff',
    elevation: 2,
  },
});
