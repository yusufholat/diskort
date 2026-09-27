import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';
import { prefersReducedMotion, useAppear } from '../motion';
import { colors } from '../theme';

/**
 * Kırmızı sayı hapı (bahsetme, okunmamış DM): belirirken büyür, sayı artınca kısa zıplar.
 * `ring` verilirse arkasındaki yüzey renginde bir halka çizilir (simgenin köşesine oturan rozet).
 */
export function CountBadge({ count, ring }: { count: number; ring?: string }) {
  const appear = useAppear(true, 200);
  const bump = useRef(new Animated.Value(1)).current;
  const last = useRef(count);
  useEffect(() => {
    if (count > last.current && !prefersReducedMotion()) {
      bump.setValue(1.25);
      Animated.spring(bump, { toValue: 1, useNativeDriver: true, speed: 22, bounciness: 12 }).start();
    }
    last.current = count;
  }, [count, bump]);
  if (count <= 0) return null;
  return (
    <Animated.View
      accessibilityLabel={`${count} okunmamış`}
      style={[
        styles.badge,
        ring ? { borderWidth: 3, borderColor: ring, minWidth: 22, height: 22 } : null,
        {
          opacity: appear,
          transform: [{ scale: Animated.multiply(bump, appear.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] })) }],
        },
      ]}
    >
      <Text style={styles.text}>{count > 99 ? '99+' : count}</Text>
    </Animated.View>
  );
}

/** Kanal/konuşma satırının solundaki beyaz okunmamış işareti: soldan büyüyerek belirir */
export function UnreadMarker({ left = -8 }: { left?: number }) {
  const appear = useAppear(true, 220);
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.marker,
        { left, opacity: appear, transform: [{ scaleY: appear.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1] }) }] },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  badge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { color: '#fff', fontSize: 11.5, fontWeight: '800', includeFontPadding: false },
  marker: {
    position: 'absolute',
    width: 4,
    height: 10,
    top: '50%',
    marginTop: -5,
    borderTopRightRadius: 3,
    borderBottomRightRadius: 3,
    backgroundColor: colors.white,
  },
});
