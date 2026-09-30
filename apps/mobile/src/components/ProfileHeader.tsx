import { useMemo, useState, type ReactNode } from 'react';
import { Image, StyleSheet, Text, View, type LayoutRectangle, type StyleProp, type ViewStyle } from 'react-native';
import { userProfileEffect, type CustomStatus, type User } from '@diskort/shared';
import { bannerUrl, profileGradient, type DisplayStatus } from '@diskort/client-core';
import { colors, createStyles, font, radius, space } from '../theme';
import { Avatar } from './Avatar';
import { CardEffect, type CardGeo } from './cosmetics/Cosmetics';

type ProfileUser = Pick<
  User,
  'displayName' | 'username' | 'avatarColor' | 'avatarUrl' | 'bannerUrl' | 'profileTheme' | 'animatedEffect' | 'avatarDecoration'
>;

/** "#rrggbb" iki rengin karışımı (a'dan t kadar); çözülemezse a */
function mix(a: string, b: string, t: number): string {
  const pa = /^#([0-9a-f]{6})$/i.exec(a);
  const pb = /^#([0-9a-f]{6})$/i.exec(b);
  if (!pa || !pb) return a;
  const x = parseInt(pa[1]!, 16);
  const y = parseInt(pb[1]!, 16);
  const channel = (shift: number): string =>
    Math.round(((x >> shift) & 255) * t + ((y >> shift) & 255) * (1 - t))
      .toString(16)
      .padStart(2, '0');
  return `#${channel(16)}${channel(8)}${channel(0)}`;
}

/** Temanın üstüne serilen tülün saydamlığı (masaüstündeki profil kartıyla aynı) */
const VEIL = 0.55;

/**
 * Profil kartının üst kısmı (masaüstündeki profil kartı gibi): üstte afiş (resim, yoksa tema rengi, o da
 * yoksa avatarın rengi), afişe taşan avatar (halkası kartın renginde), ad, kullanıcı adı ve satırlar. Tema
 * varsa zemin iki renkli degradedir, üstüne yazılar okunsun diye sayfanın renginde yarı saydam bir tül
 * serilir. Hareketli set efekti en üsttedir. Üye menüsü ve Ayarlar → Profil'deki önizleme kullanır.
 */
export function ProfileHeader({
  user,
  status,
  nameColor,
  badge,
  lines,
  custom,
  avatar,
  centered = false,
  surface = colors.side,
  children,
  style,
  effectFps,
}: {
  user: ProfileUser;
  status?: DisplayStatus;
  /** Adın rengi (en üstteki rolün rengi) */
  nameColor?: string | null;
  /** Adın yanında (ör. sunucu sahibinin tacı) */
  badge?: ReactNode;
  /** Kullanıcı adının yanına eklenecek bilgi (ör. "Sesli sohbette") */
  lines?: string;
  custom?: CustomStatus | null;
  /** Avatarın yerine (ör. ayarlarda dokununca fotoğraf seçtiren avatar); `ring` halkanın rengidir */
  avatar?: (ring: string) => ReactNode;
  /** Avatar ve yazılar ortada (ayarlar) */
  centered?: boolean;
  /** Kartın zemini: durduğu sayfanın rengi */
  surface?: string;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Hareketli set efektinin en fazla kare hızı (ayarlardaki önizlemede düşük) */
  effectFps?: number;
}) {
  const theme = user.profileTheme ?? null;
  const src = bannerUrl(user);
  // Yüklenemeyen afişin yerine renk (adres değişince yeniden denenir)
  const [failed, setFailed] = useState<string | null>(null);
  const showImage = Boolean(src && failed !== src);
  // Halka kartın o hizadaki rengindedir: degradenin üçte biri kadar aşağısı, tüle karışmış
  const ring = theme ? mix(surface, mix(theme.primary, theme.accent, 0.7), VEIL) : surface;
  const size = centered ? 88 : 72;
  const effect = userProfileEffect(user);
  const geo = useCardGeo();

  return (
    <View style={[styles.card, { backgroundColor: surface }, style]}>
      {theme && (
        <>
          {/* Tema değişince degrade yerinde güncellenmesin, görünüm yeniden kurulsun (Android'de deneysel özellik; #28).
              Degradeli görünüme kenarlık verilmemeli: kaldırılınca Android çöker (bkz. ProfileSettings, #29) */}
          <View key={profileGradient(theme)} style={[StyleSheet.absoluteFill, { experimental_backgroundImage: profileGradient(theme) }]} />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: surface, opacity: VEIL }]} />
        </>
      )}
      <View
        onLayout={geo.onBanner}
        style={[src ? styles.bannerTall : styles.banner, { backgroundColor: theme?.primary ?? user.avatarColor }]}
      >
        {src && showImage && (
          <Image
            source={{ uri: src }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
            onError={() => setFailed(src)}
            accessibilityIgnoresInvertColors
          />
        )}
      </View>
      <View style={[styles.body, centered && styles.bodyCentered]} onLayout={geo.onBody}>
        <View
          onLayout={geo.onRing}
          style={[
            styles.avatarRing,
            centered && styles.avatarCentered,
            { backgroundColor: ring, borderRadius: size, marginTop: -(size / 2 + 4) },
          ]}
        >
          {avatar ? avatar(ring) : <Avatar user={user} size={size} status={status} surface={ring} decoration={user.avatarDecoration} />}
        </View>
        <View style={[styles.nameRow, centered && styles.nameRowCentered]}>
          <Text style={[styles.name, nameColor ? { color: nameColor } : null]} numberOfLines={1}>
            {user.displayName}
          </Text>
          {badge}
        </View>
        <Text style={[styles.sub, centered && styles.textCentered]} numberOfLines={1}>
          @{user.username}
          {lines ? ` · ${lines}` : ''}
        </Text>
        {custom ? (
          <Text style={[styles.sub, centered && styles.textCentered]} numberOfLines={2}>
            {custom.emoji ? `${custom.emoji} ` : ''}
            {custom.text}
          </Text>
        ) : null}
        {children}
      </View>
      {effect && <CardEffect set={effect} geo={geo.value} fps={effectFps} />}
    </View>
  );
}

/**
 * Kartın ölçüleri (hareketli set efekti için): afişin alt kenarı, avatarın merkezi ve halkasıyla dış yarıçapı,
 * kartın sol üstüne göre. Gölgelendirici afişi ve avatarın yerini bunlardan bilir (masaüstünde measureCard).
 */
function useCardGeo() {
  const [banner, setBanner] = useState<LayoutRectangle | null>(null);
  const [body, setBody] = useState<LayoutRectangle | null>(null);
  const [ring, setRing] = useState<LayoutRectangle | null>(null);
  const value = useMemo<CardGeo | null>(
    () =>
      banner && body && ring
        ? {
            bh: banner.y + banner.height,
            ax: body.x + ring.x + ring.width / 2,
            ay: body.y + ring.y + ring.height / 2,
            ar: ring.width / 2,
          }
        : null,
    [banner, body, ring],
  );
  return {
    value,
    onBanner: (e: { nativeEvent: { layout: LayoutRectangle } }) => setBanner(e.nativeEvent.layout),
    onBody: (e: { nativeEvent: { layout: LayoutRectangle } }) => setBody(e.nativeEvent.layout),
    onRing: (e: { nativeEvent: { layout: LayoutRectangle } }) => setRing(e.nativeEvent.layout),
  };
}

const styles = createStyles(() => ({
  card: {
    borderRadius: radius.lg,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.edge,
  },
  banner: { height: 64 },
  // Afiş 17:6 (sunucu 1020×360'a kırpar)
  bannerTall: { aspectRatio: 17 / 6 },
  body: { paddingHorizontal: space.lg, paddingBottom: space.lg },
  bodyCentered: { alignItems: 'center' },
  avatarRing: { alignSelf: 'flex-start', padding: 4, marginBottom: space.xs },
  avatarCentered: { alignSelf: 'center' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  nameRowCentered: { justifyContent: 'center' },
  name: { color: colors.head, fontSize: font.heading, fontWeight: '800', flexShrink: 1 },
  sub: { color: colors.muted, fontSize: font.small, marginTop: 2 },
  textCentered: { textAlign: 'center' },
}));
