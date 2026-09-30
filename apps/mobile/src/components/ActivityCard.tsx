import { useEffect, useState } from 'react';
import { Image, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Activity, ActivityType } from '@diskort/shared';
import { activityIconUrl, activityLabel, activityTitle, formatElapsed } from '@diskort/client-core';
import { colors, createStyles, font, radius, space } from '../theme';
import type { IconName } from './icons';

// Etkinlik (oynanan oyun) gösterimi: adın altındaki tek satır ve üye menüsündeki "Oynuyor" kartı
// (masaüstündeki ActivityCard'ın karşılığı). Türe özgü olan yalnızca simgedir; başlık türden gelir.

const GLYPHS: Record<ActivityType, IconName> = {
  game: 'game-controller',
};

/** Etkinliğin tek satırlık gösterimi: küçük simge ve ad (sığmazsa kırpılır) */
export function ActivityLine({
  activity,
  textStyle,
  color = colors.muted,
  style,
}: {
  activity: Activity;
  /** Satırın yazı biçimi (durduğu listenin alt satırıyla aynı) */
  textStyle?: StyleProp<TextStyle>;
  /** Simgenin rengi (yazının rengiyle aynı verilir) */
  color?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.line, style]} accessibilityLabel={activityLabel(activity)}>
      <Ionicons name={GLYPHS[activity.type]} size={13} color={color} />
      <Text style={[styles.lineText, textStyle]} numberOfLines={1}>
        {activity.name}
      </Text>
    </View>
  );
}

const ICON = 56;

/** Etkinliğin ikonu; ikon yoksa ya da yüklenemezse türün simgesiyle düz bir karo */
function ActivityIcon({ activity }: { activity: Activity }) {
  const src = activityIconUrl(activity);
  // Yüklenemeyen ikonun yerine simge (adres değişince yeniden denenir)
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <View style={styles.icon}>
      {src && failed !== src ? (
        <Image
          source={{ uri: src }}
          style={styles.iconImage}
          resizeMode="cover"
          onError={() => setFailed(src)}
          accessibilityIgnoresInvertColors
        />
      ) : (
        <Ionicons name={GLYPHS[activity.type]} size={30} color={colors.muted} />
      )}
    </View>
  );
}

/** Şimdiki an; saniyede bir güncellenir (kart açıkken geçen süre canlı aksın) */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** "Oynuyor" kartı: başlık, ikon, ad ve canlı geçen süre (düğmesi yok) */
export function ActivityCard({ activity, style }: { activity: Activity; style?: StyleProp<ViewStyle> }) {
  const now = useNow();
  return (
    <View style={[styles.card, style]} accessible accessibilityLabel={activityLabel(activity)}>
      <Text style={styles.title}>{activityTitle(activity).toLocaleUpperCase('tr')}</Text>
      <View style={styles.body}>
        <ActivityIcon activity={activity} />
        <View style={styles.texts}>
          <Text style={styles.name} numberOfLines={1}>
            {activity.name}
          </Text>
          <View style={styles.elapsed}>
            <Ionicons name={GLYPHS[activity.type]} size={14} color={colors.okText} />
            <Text style={styles.elapsedText}>{formatElapsed(now - activity.startedAt)}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = createStyles(() => ({
  line: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  lineText: { flexShrink: 1, color: colors.muted, fontSize: font.caption + 0.5 },
  // Kenarlık yok: profil kartının degradeli zemininin üstünde durur (bkz. ProfileHeader)
  card: { backgroundColor: colors.main, borderRadius: radius.md + 4, padding: space.md },
  title: { color: colors.muted, fontSize: font.caption - 0.5, fontWeight: '800', letterSpacing: 0.3, marginBottom: space.sm },
  body: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  icon: {
    width: ICON,
    height: ICON,
    borderRadius: radius.md + 2,
    backgroundColor: colors.active,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  iconImage: { width: ICON, height: ICON },
  texts: { flex: 1, gap: 4 },
  name: { color: colors.head, fontSize: font.body, fontWeight: '700' },
  elapsed: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  elapsedText: { color: colors.okText, fontSize: font.small, fontWeight: '600', fontVariant: ['tabular-nums'] },
}));
