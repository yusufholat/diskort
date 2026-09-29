import { memo, type ReactNode } from 'react';
import { Animated, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { avatarUrl, streamPreviewHeaders, streamPreviewUrl, useGuild, useMemberColor } from '@diskort/client-core';
import type { VoiceState } from '@diskort/shared';
import { useAppear, useTimingTo } from '../motion';
import { colors, createStyles, font, radius, space } from '../theme';
import { useVoice } from '../voice/voice';
import { Avatar } from './Avatar';
import { decorationCanvasSize } from './cosmetics/Cosmetics';
import { SpeakingRing } from './SpeakingRing';
import { StreamViewers } from './StreamViewers';
import { VoiceStateIcon } from './VoiceStateIcon';

// Ses ekranının kutucukları. Yerleşim kozmetikten bağımsızdır: avatar sabit boyda bir "sahnenin"
// ortasında durur, dekorasyon onun üstüne (yerleşimi etkilemeden) taşarak çizilir, ad sahnenin hemen
// altında sabit yükseklikte bir satırdadır. Sahne her kutucukta aynı boydadır (dekorasyon olsun olmasın),
// böylece bütün avatarlar ve adlar aynı hizada durur.

/** Kutucuğun iç boşluğu (üst/alt) */
const TILE_PAD = 10;
/** Ad satırının sabit yüksekliği ve sahneyle arası */
const NAME_HEIGHT = 20;
const NAME_GAP = 4;
/** En büyük avatar (hareketli dekorasyon bu boyda canlı çizilir) */
const AVATAR_MAX = 72;
/** Küçük kutucukta (yayın izlenirken) avatar; dekorasyon sabit halka olur */
const AVATAR_SMALL = 56;
/** Konuşma halkası avatarın dışına taşar (kalınlık + boşluk, iki yanda) */
const RING_ROOM = 12;

/** Büyük avatarın sığdığı en kısa kutucuk (sahne + ad + boşluklar) */
export const TILE_MIN_HEIGHT = decorationCanvasSize(AVATAR_MAX) + NAME_GAP + NAME_HEIGHT + TILE_PAD * 2;

/** Kutucuk yüksekliğine göre avatar ve sahne (dekorasyon yüzeyinin kaplayacağı kare) boyu */
function stageFor(height: number): { avatar: number; stage: number } {
  const room = height - TILE_PAD * 2 - NAME_HEIGHT - NAME_GAP;
  const big = decorationCanvasSize(AVATAR_MAX);
  if (big <= room) return { avatar: AVATAR_MAX, stage: big };
  const avatar = Math.max(32, Math.min(AVATAR_SMALL, room - RING_ROOM));
  return { avatar, stage: avatar + RING_ROOM };
}

/** Kutucuğun dışı: katılınca büyüyerek belirir; konuşma kenarı içeriğin üstünde çizilir (dekorasyon örtmez) */
function TileFrame({
  width,
  height,
  edge,
  dark,
  children,
}: {
  width: number;
  height: number;
  edge?: Animated.Value;
  dark?: boolean;
  children: ReactNode;
}) {
  const appear = useAppear(true, 260);
  return (
    <Animated.View
      style={[
        styles.tile,
        dark && styles.tileDark,
        {
          width,
          height,
          opacity: appear,
          transform: [{ scale: appear.interpolate({ inputRange: [0, 1], outputRange: [0.88, 1] }) }],
        },
      ]}
    >
      {children}
      {edge && <Animated.View pointerEvents="none" style={[styles.tileEdge, { opacity: edge }]} />}
    </Animated.View>
  );
}

/**
 * Seste bir kişi: sabit sahnenin ortasında avatar (konuşunca yeşil halka ve kutucuğun kenarı yumuşakça
 * yanar), altta ad, sağ üstte ses durumu. Yayını ayrı bir kutucukta (StreamTile) gösterilir.
 */
export const MemberTile = memo(function MemberTile({
  state,
  width,
  height,
  selfId,
  onLongPress,
}: {
  state: VoiceState;
  width: number;
  height: number;
  selfId: string | undefined;
  onLongPress: (userId: string) => void;
}) {
  const user = useGuild((s) => s.users[state.userId]);
  const color = useMemberColor(state.userId);
  const speaking = useVoice((s) => Boolean(s.speaking[state.userId]));
  // Konuşma kenarı: açılışı hızlı, sönüşü yavaş (kısa sessizliklerde titremez)
  const edge = useTimingTo(speaking ? 1 : 0, speaking ? 90 : 280);
  const self = state.userId === selfId;
  const { avatar, stage } = stageFor(height);
  return (
    <Pressable
      onLongPress={() => onLongPress(state.userId)}
      delayLongPress={300}
      accessibilityLabel={`${user?.displayName ?? 'Üye'}${speaking ? ', konuşuyor' : ''}${state.streaming ? ', yayında' : ''}`}
      accessibilityHint="Ses seviyesi ve seçenekler için uzun bas"
    >
      <TileFrame width={width} height={height} edge={edge}>
        <View style={[styles.stage, { width: stage, height: stage }]}>
          <SpeakingRing speaking={speaking} size={avatar}>
            {/* Hareketli dekorasyon hafif modda: yalnızca konuşurken oynar (katılımcı kadar yüzey, sesle yarışır) */}
            <Avatar
              user={user}
              size={avatar}
              decoration={user?.avatarDecoration}
              decorationLite={speaking ? 'on' : 'paused'}
            />
          </SpeakingRing>
        </View>
        <View style={styles.nameRow}>
          <Text style={[styles.name, self && { color: colors.head }, color ? { color } : null]} numberOfLines={1}>
            {user?.displayName ?? '…'}
          </Text>
        </View>
        <View style={styles.stateIcon} pointerEvents="none">
          <VoiceStateIcon state={state} size={15} />
        </View>
      </TileFrame>
    </Pressable>
  );
});

/**
 * Bir ekran yayını, yayıncının kutucuğunun yanında kendi kutucuğunda (masaüstündeki gibi): sunucudaki
 * önizleme karesi varsa o, yoksa yayıncının bulanık avatarı. Dokununca yayın izlenir (izleniyorsa tam
 * ekran açılır). Kendi yayınında önizleme gösterilmez (pil): yalnızca "Ekranını paylaşıyorsun".
 */
export const StreamTile = memo(function StreamTile({
  state,
  width,
  height,
  selfId,
  onOpen,
}: {
  state: VoiceState;
  width: number;
  height: number;
  selfId: string | undefined;
  onOpen: (userId: string) => void;
}) {
  const user = useGuild((s) => s.users[state.userId]);
  const watching = useVoice((s) => s.watching === state.userId);
  const self = state.userId === selfId;
  const name = user?.displayName ?? '…';
  const preview = !self && state.streamPreviewAt !== undefined;
  const photo = avatarUrl(user);
  const avatar = Math.min(44, Math.round(height * 0.3));
  return (
    <Pressable
      onPress={self ? undefined : () => onOpen(state.userId)}
      disabled={self}
      accessibilityRole={self ? undefined : 'button'}
      accessibilityLabel={self ? 'Ekranını paylaşıyorsun' : `${name} yayında${watching ? ', izleniyor' : ''}`}
      accessibilityHint={self ? undefined : watching ? 'Tam ekran açar' : 'Yayını izler'}
    >
      <TileFrame width={width} height={height} dark>
        {preview ? (
          <Image
            source={{ uri: streamPreviewUrl(state), headers: streamPreviewHeaders() }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
            accessibilityIgnoresInvertColors
          />
        ) : (
          <>
            {photo ? (
              <Image
                source={{ uri: photo }}
                style={[StyleSheet.absoluteFill, styles.blurred]}
                blurRadius={24}
                resizeMode="cover"
                accessibilityIgnoresInvertColors
              />
            ) : (
              <View style={[StyleSheet.absoluteFill, styles.blurred, { backgroundColor: user?.avatarColor ?? '#747f8d' }]} />
            )}
            <View style={styles.dim} />
          </>
        )}
        {/* Önizleme üstünde yazı okunsun diye izlenirken ya da kendi yayınında koyulaşır */}
        {preview && watching && <View style={styles.dim} />}

        <View style={styles.center} pointerEvents="none">
          {!preview && (
            <View style={styles.dimAvatar}>
              <Avatar user={user} size={avatar} />
            </View>
          )}
          {self ? (
            <Text style={styles.centerText}>Ekranını paylaşıyorsun</Text>
          ) : watching ? (
            <View style={styles.watchingPill}>
              <Ionicons name="eye" size={13} color="#fff" />
              <Text style={styles.watchingText}>İzleniyor</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.live} pointerEvents="none">
          <Text style={styles.liveText}>YAYINDA</Text>
        </View>
        {/* Kendi izleyicilerin "Ekranını paylaşıyorsun" şeridinde */}
        {!self && <StreamViewers userId={state.userId} style={styles.viewers} />}

        <View style={styles.caption} pointerEvents="none">
          <Ionicons name="desktop-outline" size={13} color="#fff" />
          <Text style={styles.captionText} numberOfLines={1}>
            {name}
          </Text>
        </View>
      </TileFrame>
    </Pressable>
  );
});

const styles = createStyles(() => ({
  tile: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.rail,
    borderRadius: radius.lg - 2,
    paddingVertical: TILE_PAD,
    paddingHorizontal: space.sm,
    overflow: 'hidden',
  },
  tileDark: { backgroundColor: '#000' },
  tileEdge: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: radius.lg - 2,
    borderWidth: 2,
    borderColor: colors.ok,
  },
  // Dekorasyon yüzeyi bu karenin tamamını kaplar; avatar ortada
  stage: { alignItems: 'center', justifyContent: 'center' },
  nameRow: {
    height: NAME_HEIGHT,
    marginTop: NAME_GAP,
    maxWidth: '100%',
    justifyContent: 'center',
  },
  name: { color: colors.text, fontSize: font.body - 0.5, fontWeight: '600', textAlign: 'center' },
  stateIcon: { position: 'absolute', top: space.sm, right: space.sm },
  blurred: { opacity: 0.55 },
  dim: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(0,0,0,0.45)' },
  center: { alignItems: 'center', gap: space.sm, paddingHorizontal: space.sm },
  dimAvatar: { opacity: 0.8 },
  centerText: { color: '#fff', fontSize: font.small, fontWeight: '700', textAlign: 'center' },
  watchingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  watchingText: { color: '#fff', fontSize: 12.5, fontWeight: '700' },
  live: {
    position: 'absolute',
    top: space.sm,
    left: space.sm,
    backgroundColor: colors.danger,
    borderRadius: radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  liveText: { color: '#fff', fontSize: 10.5, fontWeight: '800' },
  viewers: { position: 'absolute', top: space.sm, right: space.sm },
  caption: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: space.sm,
    paddingVertical: 6,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  captionText: { color: '#fff', fontSize: 12.5, fontWeight: '700', flexShrink: 1 },
}));
