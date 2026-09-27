import { useEffect, useRef } from 'react';
import { Animated, Easing, View } from 'react-native';
import { prefersReducedMotion } from '../motion';
import { colors, createStyles } from '../theme';

/** "Yazıyor" üç noktası: sırayla yükselip parlar (yerel sürücüde; JS'yi meşgul etmez) */
export function TypingDots({ color = colors.text, size = 5 }: { color?: string; size?: number }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (prefersReducedMotion()) {
      t.setValue(0.5);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(t, { toValue: 1, duration: 1100, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [t]);
  return (
    <View style={[styles.row, { gap: size * 0.6 }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {[0, 1, 2].map((i) => {
        const start = i * 0.18;
        const input = [0, start, start + 0.2, start + 0.4, 1];
        return (
          <Animated.View
            key={i}
            style={{
              width: size,
              height: size,
              borderRadius: size / 2,
              backgroundColor: color,
              opacity: t.interpolate({ inputRange: input, outputRange: [0.35, 0.35, 1, 0.35, 0.35] }),
              transform: [{ translateY: t.interpolate({ inputRange: input, outputRange: [0, 0, -size * 0.5, 0, 0] }) }],
            }}
          />
        );
      })}
    </View>
  );
}

const styles = createStyles(() => ({
  row: { flexDirection: 'row', alignItems: 'center' },
}));
