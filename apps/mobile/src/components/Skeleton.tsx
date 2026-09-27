import type { ReactNode } from 'react';
import { Animated, StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';
import { usePulse } from '../motion';
import { colors, radius, space } from '../theme';

// Her satır farklı genişlikte ama her çizimde aynı
const WIDTHS: DimensionValue[][] = [
  ['30%', '85%', '55%'],
  ['22%', '70%'],
  ['36%', '60%', '90%'],
  ['26%', '78%'],
  ['32%', '95%', '45%'],
  ['20%', '50%'],
];

/** Tek iskelet çubuğu (nabız, onu saran iskelet bileşeninden gelir) */
export function Bone({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.bar, style]} />;
}

/** Yüklenirken yavaşça nabız atan kap */
export function Pulse({ children, label, style }: { children: ReactNode; label: string; style?: StyleProp<ViewStyle> }) {
  const pulse = usePulse();
  return (
    <Animated.View style={[style, { opacity: pulse }]} accessibilityLabel={label} accessible>
      {children}
    </Animated.View>
  );
}

/** Mesaj geçmişi yüklenirken gösterilen, yavaşça nabız atan mesaj biçimli satırlar. */
export function MessageSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <Pulse label="Mesajlar yükleniyor">
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
    </Pulse>
  );
}

/** Kişi/konuşma listesi yüklenirken: avatar ve iki satır */
export function ListSkeleton({ rows = 6, avatar = 40 }: { rows?: number; avatar?: number }) {
  return (
    <Pulse label="Yükleniyor" style={{ paddingTop: space.sm }}>
      {Array.from({ length: rows }, (_, i) => {
        const [a, b] = WIDTHS[i % WIDTHS.length]!;
        return (
          <View key={i} style={styles.listRow}>
            <View style={{ width: avatar, height: avatar, borderRadius: avatar / 2, backgroundColor: colors.active }} />
            <View style={styles.body}>
              <View style={[styles.bar, styles.name, { width: a }]} />
              {i % 2 === 0 ? <View style={[styles.bar, { width: b, height: 9 }]} /> : null}
            </View>
          </View>
        );
      })}
    </Pulse>
  );
}

/** Kanal listesi yüklenirken: bölüm başlıkları ve simgeli satırlar */
export function ChannelListSkeleton() {
  const section = (rows: DimensionValue[], key: string) => (
    <View key={key}>
      <View style={[styles.bar, styles.sectionBar]} />
      {rows.map((w, i) => (
        <View key={i} style={styles.channelRow}>
          <View style={styles.channelIcon} />
          <View style={[styles.bar, { width: w, height: 12 }]} />
        </View>
      ))}
    </View>
  );
  return (
    <Pulse label="Kanallar yükleniyor">
      {section(['46%', '62%', '38%', '54%'], 'text')}
      {section(['40%', '52%'], 'voice')}
    </Pulse>
  );
}

/** Uzun metin (sürüm notu gibi) yüklenirken */
export function TextSkeleton({ lines = 4 }: { lines?: number }) {
  const widths: DimensionValue[] = ['70%', '92%', '55%', '80%', '64%', '88%'];
  return (
    <Pulse label="Yükleniyor" style={{ gap: 10 }}>
      {Array.from({ length: lines }, (_, i) => (
        <View key={i} style={[styles.bar, { width: widths[i % widths.length] }]} />
      ))}
    </Pulse>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', paddingTop: 14, paddingRight: 14 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.active, marginHorizontal: 12 },
  body: { flex: 1, gap: 8, paddingTop: 4 },
  bar: { height: 11, borderRadius: 6, backgroundColor: colors.active },
  name: { height: 13, maxWidth: 160 },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: 18, paddingVertical: 9 },
  sectionBar: { width: 110, height: 10, marginLeft: space.lg, marginTop: space.xxl, marginBottom: space.md },
  channelRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, height: 40, paddingHorizontal: 18 },
  channelIcon: { width: 20, height: 20, borderRadius: radius.sm, backgroundColor: colors.active },
});
