import { memo, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Reanimated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  type EasingFunction,
  type SharedValue,
} from 'react-native-reanimated';
import type { ProfileEffect as Effect } from '@diskort/shared';
import { effectParticles, type Particle } from '@diskort/client-core';

/**
 * Profil kartının üstünde oynayan efekt (kar, yaprak, ışıltı): parçacıkların tanımı client-core'da
 * (masaüstüyle aynı), burada Reanimated ile UI iş parçacığında oynatılır. Dokunmaları engellemez;
 * "animasyonları kaldır" açıkken hiç çizilmez.
 */
export const ProfileEffect = memo(function ProfileEffect({ effect }: { effect: Effect | null | undefined }) {
  const reduce = useReducedMotion();
  // Düşen parçacıklar kartın boyunca iner: boy ölçülene kadar çizilmez
  const [height, setHeight] = useState(0);
  if (!effect || reduce) return null;
  return (
    <View
      style={styles.layer}
      pointerEvents="none"
      onLayout={(e) => setHeight(e.nativeEvent.layout.height)}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {height > 0 &&
        effectParticles(effect).map((p, i) =>
          p.kind === 'twinkle' ? <Twinkle key={`${effect}${i}`} p={p} /> : <Fall key={`${effect}${i}`} p={p} height={height} />,
        )}
    </View>
  );
});

/**
 * Sonsuz döngüdeki ilerleme (0→1). Masaüstündeki eksi gecikme gibi döngünün ortasından başlar (parçacıklar
 * aynı anda doğmasın). `pingPong` ise 1'e varınca geri döner (salınım), değilse başa sarar.
 */
function useLoop(seconds: number, delay: number, pingPong: boolean, easing: EasingFunction): SharedValue<number> {
  const ms = seconds * 1000;
  const phase = ((((-delay * 1000) % ms) + ms) % ms) / ms;
  const value = useSharedValue(phase);
  useEffect(() => {
    const rest = withTiming(1, { duration: (1 - phase) * ms, easing });
    value.value = pingPong
      ? withSequence(rest, withRepeat(withTiming(0, { duration: ms, easing }), -1, true))
      : withSequence(rest, withTiming(0, { duration: 0 }), withRepeat(withTiming(1, { duration: ms, easing }), -1));
    return () => cancelAnimation(value);
  }, [value, ms, phase, pingPong, easing]);
  return value;
}

const linear = Easing.linear;
const sway = Easing.inOut(Easing.sin);

/** Yukarıdan aşağı düşen, sağa sola salınan (yaprak ise dönen) parçacık */
function Fall({ p, height }: { p: Particle; height: number }) {
  const fall = useLoop(p.duration, p.delay, false, linear);
  const side = useLoop(p.duration / 3, p.delay, true, sway);
  const spin = useLoop(p.duration / 2, 0, true, linear);
  const petal = p.shape === 'petal';
  const style = useAnimatedStyle(() => ({
    transform: [
      { translateY: height * (-0.08 + 1.12 * fall.value) },
      { translateX: p.drift * (side.value * 2 - 1) },
      { rotate: `${petal ? p.spin * spin.value : 0}deg` },
    ],
  }));
  const h = petal ? p.size * 0.7 : p.size;
  return (
    <Reanimated.View
      style={[
        styles.particle,
        { left: `${p.x}%`, width: p.size, height: h, opacity: p.opacity, backgroundColor: p.color },
        petal
          ? { borderTopLeftRadius: p.size * 0.8, borderBottomRightRadius: p.size * 0.8 }
          : { borderRadius: p.size / 2, boxShadow: '0 0 2px rgba(0,0,0,0.35)' },
        style,
      ]}
    />
  );
}

/** Yerinde belirip kaybolan, bu sırada biraz dönen yıldız (ışıltı) */
function Twinkle({ p }: { p: Particle }) {
  const t = useLoop(p.duration, p.delay, false, linear);
  const style = useAnimatedStyle(() => {
    // 0 → 1 → 0, yumuşak (masaüstündeki ease-in-out'a yakın)
    const k = Math.sin(Math.PI * t.value);
    return { opacity: k, transform: [{ scale: k }, { rotate: `${p.spin * k}deg` }] };
  });
  return (
    <Reanimated.Text
      style={[
        styles.star,
        {
          left: `${p.x}%`,
          top: `${p.y}%`,
          width: p.size * 1.4,
          height: p.size * 1.4,
          marginLeft: -p.size * 0.7,
          marginTop: -p.size * 0.7,
          fontSize: p.size,
          lineHeight: p.size * 1.4,
          color: p.color,
          textShadowColor: p.color,
        },
        style,
      ]}
    >
      ✦
    </Reanimated.Text>
  );
}

const styles = StyleSheet.create({
  layer: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, overflow: 'hidden' },
  particle: { position: 'absolute', top: 0 },
  star: {
    position: 'absolute',
    textAlign: 'center',
    includeFontPadding: false,
    textShadowRadius: 6,
    textShadowOffset: { width: 0, height: 0 },
  },
});
