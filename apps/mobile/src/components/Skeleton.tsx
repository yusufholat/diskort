import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View, type DimensionValue } from 'react-native';
import { prefersReducedMotion } from '../motion';
import { colors } from '../theme';

// Her satır farklı genişlikte ama her çizimde aynı
const WIDTHS: DimensionValue[][] = [
  ['30%', '85%', '55%'],
  ['22%', '70%'],
  ['36%', '60%', '90%'],
  ['26%', '78%'],
  ['32%', '95%', '45%'],
  ['20%', '50%'],
];

/** Mesaj geçmişi yüklenirken gösterilen, yavaşça nabız atan mesaj biçimli satırlar. */
export function MessageSkeleton({ rows = 6 }: { rows?: number }) {
  const pulse = useRef(new Animated.Value(0.55)).current;

  useEffect(() => {
    if (prefersReducedMotion()) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.55, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <Animated.View style={{ opacity: pulse }} accessibilityLabel="Mesajlar yükleniyor">
      {Array.from({ length: rows }, (_, i) => {
        const [name, ...lines] = WIDTHS[i % WIDTHS.length]!;
        return (
          <View key={i} style={styles.row}>
            <View style={styles.avatar} />
            <View style={styles.body}>
              <View style={[styles.bar, styles.name, { width: name }]} />
              {lines.map((w, j) => (
                <View key={j} style={[styles.bar, { width: w }]} />
              ))}
            </View>
          </View>
        );
      })}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', paddingTop: 14, paddingRight: 14 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.active, marginHorizontal: 12 },
  body: { flex: 1, gap: 8, paddingTop: 4 },
  bar: { height: 11, borderRadius: 6, backgroundColor: colors.active },
  name: { height: 13, maxWidth: 160 },
});
