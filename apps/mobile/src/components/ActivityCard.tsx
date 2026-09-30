import { useEffect, useMemo, useState } from 'react';
import { Image, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { isKnownActivity, type Activity, type CustomStatus } from '@diskort/shared';
import {
  activityIconUrl,
  activityLabel,
  activityTitle,
  customStatusText,
  formatElapsed,
  presenceSubline,
  useActivities,
} from '@diskort/client-core';
import { colors, createStyles, font, radius, space } from '../theme';
import type { IconName } from './icons';

// Etkinlik (oynanan oyun) gösterimi: adın altındaki satır (durum simgeleri ve yazı) ve üye menüsündeki
// "Oynuyor" kartı (masaüstündeki ActivityCard'ın karşılığı). Türe özgü olan yalnızca simgedir; başlık
// türden gelir.

const GLYPHS: Partial<Record<string, IconName>> = {
  game: 'game-controller',
};

/** Türün simgesi; simgesi tanımlanmamış tür genel bir simgeyle çizilir */
const glyphOf = (activity: Pick<Activity, 'type'>): IconName => GLYPHS[activity.type] ?? 'shapes';

/**
 * Adın altındaki satır (üye listesi, konuşmalar): önce küçük durum simgeleri (oynuyorsa oyun, sesteyse ses),
 * sonra tek bir yazı: özel durum, yoksa oyunun adı, o da yoksa "Sesli sohbette". Hiçbiri yoksa `fallback`
 * (ör. kullanıcı adı); o da yoksa hiçbir şey çizmez. Telefonda ipucu yok: oyun üye menüsündeki kartta
 * görünür. Satırda sayaç yoktur.
 */
export function PresenceSubline({
  custom,
  activity,
  inVoice = false,
  fallback,
  textStyle,
  color = colors.muted,
}: {
  custom: CustomStatus | null | undefined;
  /** Asıl (en son başlanan) etkinlik */
  activity: Activity | null | undefined;
  /** Ses bilgisi sunucuya aittir: konuşmalarda verilmez */
  inVoice?: boolean;
  fallback?: string;
  /** Satırın yazı biçimi (durduğu listenin alt satırıyla aynı) */
  textStyle?: StyleProp<TextStyle>;
  /** Oyun simgesinin rengi (yazının rengiyle aynı verilir) */
  color?: string;
}) {
  const { showGame, showVoice, text } = presenceSubline({ custom, activity, inVoice });
  const label =
    text === 'custom' && custom
      ? customStatusText(custom)
      : text === 'activity' && activity
        ? activity.name
        : text === 'voice'
          ? 'Sesli sohbette'
          : fallback;
  if (!label) return null;
  return (
    <View style={styles.line}>
      {showGame && activity && (
        <Ionicons name={glyphOf(activity)} size={13} color={color} accessibilityLabel={activityLabel(activity)} />
      )}
      {showVoice && <Ionicons name="volume-medium" size={13} color={colors.ok} accessibilityLabel="Sesli sohbette" />}
      <Text style={[styles.lineText, textStyle, text === 'voice' && { color: colors.ok }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const ICON = 56;
const ICON_COMPACT = 36;

/** Etkinliğin ikonu; ikon yoksa ya da yüklenemezse türün simgesiyle düz bir karo */
function ActivityIcon({ activity, compact }: { activity: Activity; compact: boolean }) {
  const src = activityIconUrl(activity);
  // Yüklenemeyen ikonun yerine simge (adres değişince yeniden denenir)
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <View style={[styles.icon, compact && styles.iconCompact]}>
      {src && failed !== src ? (
        <Image
          source={{ uri: src }}
          style={compact ? styles.iconImageCompact : styles.iconImage}
          resizeMode="cover"
          onError={() => setFailed(src)}
          accessibilityIgnoresInvertColors
        />
      ) : (
        <Ionicons name={glyphOf(activity)} size={compact ? 20 : 30} color={colors.muted} />
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

/**
 * "Oynuyor" kartı: başlık, ikon, ad ve canlı geçen süre (düğmesi yok). `compact`: küçük ikon; `title`
 * kapalıysa başlık çizilmez (üstündeki kartla aynı türdeyse yinelenmez).
 */
export function ActivityCard({
  activity,
  compact = false,
  title = true,
  style,
}: {
  activity: Activity;
  compact?: boolean;
  title?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const now = useNow();
  return (
    <View style={[styles.card, style]} accessible accessibilityLabel={activityLabel(activity)}>
      {title && <Text style={styles.title}>{activityTitle(activity).toLocaleUpperCase('tr')}</Text>}
      <View style={styles.body}>
        <ActivityIcon activity={activity} compact={compact} />
        <View style={styles.texts}>
          <Text style={styles.name} numberOfLines={1}>
            {activity.name}
          </Text>
          <View style={styles.elapsed}>
            <Ionicons name={glyphOf(activity)} size={14} color={colors.okText} />
            <Text style={styles.elapsedText}>{formatElapsed(now - activity.startedAt)}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

/**
 * Üye menüsündeki etkinlikler: her biri ayrı bir kart, alt alta (asıl olan en üstte, büyük ikonla). Öbürleri
 * küçüktür (menü ekrana sığsın); başlık yalnızca tür değişince yinelenir. Etkinlik yoksa hiçbir şey çizmez.
 */
export function ActivityCards({ userId, style }: { userId: string | null | undefined; style?: StyleProp<ViewStyle> }) {
  const all = useActivities(userId);
  const activities = useMemo(() => all.filter(isKnownActivity), [all]);
  if (activities.length === 0) return null;
  return (
    <View style={[styles.cards, style]}>
      {activities.map((activity, i) => (
        <ActivityCard
          key={`${activity.type}:${activity.name}:${activity.startedAt}`}
          activity={activity}
          compact={i > 0}
          title={i === 0 || activities[i - 1]!.type !== activity.type}
        />
      ))}
    </View>
  );
}

const styles = createStyles(() => ({
  line: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  lineText: { flexShrink: 1, color: colors.muted, fontSize: font.caption + 0.5 },
  cards: { gap: space.sm },
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
  iconCompact: { width: ICON_COMPACT, height: ICON_COMPACT, borderRadius: radius.md },
  iconImage: { width: ICON, height: ICON },
  iconImageCompact: { width: ICON_COMPACT, height: ICON_COMPACT },
  texts: { flex: 1, gap: 4 },
  name: { color: colors.head, fontSize: font.body, fontWeight: '700' },
  elapsed: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  elapsedText: { color: colors.okText, fontSize: font.small, fontWeight: '600', fontVariant: ['tabular-nums'] },
}));
