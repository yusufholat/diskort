import { memo, useCallback, useMemo, useState, type ReactElement } from 'react';
import { Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import type { User } from '@diskort/shared';
import {
  channelMemberGroups,
  memberGroups,
  useCustomStatus,
  useGuild,
  useMemberColor,
  useSession,
  useStatus,
  type ProfileContext,
} from '@diskort/client-core';
import { Avatar } from '../Avatar';
import { hasSkia, NAMEPLATE_TEXT_SHADOW, NameplateBackground, nameplateNameColor } from '../cosmetics/Cosmetics';
import { MemberSheet } from '../MemberSheet';
import { ListSkeleton } from '../Skeleton';
import { EmptyState } from '../States';
import { useLayoutAnimationOn } from '../../motion';
import { colors, createStyles, font, radius, ripple, space } from '../../theme';

/** Listenin kaynağı: seçili sunucunun tamamı, bir kanalı görebilenler ya da bir konuşmanın katılımcıları */
export type MemberSource = { kind: 'guild' } | { kind: 'channel'; channelId: string } | { kind: 'dm'; participantIds: string[] };

interface Section {
  key: string;
  title: string;
  offline: boolean;
  data: User[];
}

const byName = (a: User, b: User): number => a.displayName.localeCompare(b.displayName, 'tr');

/**
 * Üye listesi (Discord'daki gibi): gruplar (ayrı gösterilen roller, Çevrim içi, Çevrim dışı), her grup
 * yuvarlak köşeli bir kart, satırlar arasında ince çizgi. Dokununca üye menüsü (verilen bağlamda).
 * Konuşmada roller yok: yalnızca katılımcılar, çevrim içi / dışı. Liste sanallaştırılmıştır (SectionList).
 */
export function MemberList({
  source,
  context,
  header,
}: {
  source: MemberSource;
  context: ProfileContext;
  /** Listenin başında gösterilen öğe (ör. "Üyeleri Davet Et") */
  header?: ReactElement | null;
}) {
  const users = useGuild((s) => s.users);
  const roles = useGuild((s) => s.roles);
  const online = useGuild((s) => s.online);
  const guild = useGuild((s) => s.guild);
  const channels = useGuild((s) => s.channels);
  const status = useGuild((s) => s.status);
  const [selected, setSelected] = useState<string | null>(null);
  const guildInfo = source.kind !== 'dm';
  const channelId = source.kind === 'channel' ? source.channelId : null;
  const participants = source.kind === 'dm' ? source.participantIds.join(',') : '';

  const sections = useMemo<Section[]>(() => {
    if (source.kind === 'dm') {
      const list = source.participantIds.map((id) => users[id]).filter((u): u is NonNullable<typeof u> => Boolean(u));
      const on = list.filter((u) => online[u.id]).sort(byName);
      const off = list.filter((u) => !online[u.id]).sort(byName);
      return [
        ...(on.length ? [{ key: 'online', title: 'Çevrim içi', offline: false, data: on }] : []),
        ...(off.length ? [{ key: 'offline', title: 'Çevrim dışı', offline: true, data: off }] : []),
      ];
    }
    const state = { users, roles, online, guild, channels };
    // Kanal bu sunucunun görünümünde yoksa (başka sunucu seçili) tüm üyeler
    const groups =
      channelId && channels.some((c) => c.id === channelId) ? channelMemberGroups(state, channelId) : memberGroups(state);
    return groups.map((g) => ({
      key: g.id,
      title: g.id === 'online' ? 'Çevrim içi' : g.id === 'offline' ? 'Çevrim dışı' : g.title,
      offline: g.id === 'offline',
      data: g.members,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source.kind, channelId, participants, users, roles, online, guild, channels]);

  // Biri çevrimiçi olunca/çıkınca satırı yumuşakça yer değiştirir
  useLayoutAnimationOn(sections.map((s) => `${s.key}:${s.data.map((u) => u.id).join('.')}`).join('|'), 220);

  const ownerId = guildInfo ? guild?.ownerId : undefined;
  const renderItem = useCallback(
    ({ item, index, section }: { item: User; index: number; section: Section }) => (
      <MemberRow
        user={item}
        offline={section.offline}
        owner={item.id === ownerId}
        guildInfo={guildInfo}
        first={index === 0}
        last={index === section.data.length - 1}
        onPress={setSelected}
      />
    ),
    [ownerId, guildInfo],
  );

  const loading = Object.keys(users).length === 0 && status !== 'ready';
  if (loading) return <ListSkeleton rows={8} avatar={36} />;

  return (
    <>
      <SectionList
        sections={sections}
        keyExtractor={(u) => u.id}
        stickySectionHeadersEnabled={false}
        // Varsayılan 21 ekranlık pencere yerine 11: pencerenin dışında kurulan satır (isim plakası yüzeyi) azalır
        windowSize={11}
        contentContainerStyle={styles.content}
        ListHeaderComponent={header}
        renderSectionHeader={({ section }) => (
          <Text style={styles.section} accessibilityRole="header">
            {section.title} — {section.data.length}
          </Text>
        )}
        renderItem={renderItem}
        ListEmptyComponent={
          <EmptyState icon="people-outline" tone="muted" title="Üye yok" text={guildInfo ? 'Burada henüz kimse yok.' : undefined} />
        }
      />
      <MemberSheet userId={selected} context={context} onClose={() => setSelected(null)} />
    </>
  );
}

const MemberRow = memo(function MemberRow({
  user,
  offline,
  owner,
  guildInfo,
  first,
  last,
  onPress,
}: {
  user: User;
  offline: boolean;
  owner: boolean;
  /** Sunucu bilgisi (rol rengi, taç, ses) gösterilir mi; konuşmada gösterilmez */
  guildInfo: boolean;
  first: boolean;
  last: boolean;
  onPress: (userId: string) => void;
}) {
  const roleColor = useMemberColor(user.id);
  const color = guildInfo ? roleColor : null;
  const inVoice = useGuild((s) => guildInfo && Boolean(s.voiceStates[user.id]));
  const self = useSession((s) => s.user?.id === user.id);
  const status = useStatus(user.id);
  const custom = useCustomStatus(user.id);
  // İsim plakası: satırın arkasında hareketli zemin; üstündeki yazılar açık renkli ve gölgeli (Skia yoksa
  // plaka çizilmez, satır eskisi gibi kalır)
  const plate = hasSkia() ? (user.nameplate ?? null) : null;
  return (
    <View style={[styles.cardRow, first && styles.cardFirst, last && styles.cardLast]}>
      <Pressable
        onPress={() => onPress(user.id)}
        onLongPress={() => onPress(user.id)}
        delayLongPress={300}
        android_ripple={ripple.row}
        style={styles.row}
        accessibilityRole="button"
        accessibilityLabel={`${user.displayName}${offline ? ', çevrimdışı' : ''}${inVoice ? ', sesli sohbette' : ''}`}
      >
        {plate && <NameplateBackground set={plate} />}
        {!first && <View style={styles.divider} />}
        <View style={offline && styles.offline}>
          <Avatar
            user={user}
            size={38}
            status={status}
            surface={plate ? '#0a0a0a' : colors.side}
            decoration={user.avatarDecoration}
          />
        </View>
        <View style={[{ flex: 1 }, offline && styles.offline]}>
          <View style={styles.nameRow}>
            <Text
              style={[styles.name, plate ? [{ color: nameplateNameColor(color) }, NAMEPLATE_TEXT_SHADOW] : color ? { color } : null]}
              numberOfLines={1}
            >
              {user.displayName}
            </Text>
            {/* Masaüstündeki gibi taç; Ionicons'ta taç yok */}
            {owner && (
              <MaterialCommunityIcons name="crown-outline" size={14} color={colors.warn} accessibilityLabel="Sunucunun sahibi" />
            )}
            {self && (
              <View style={styles.youTag}>
                <Text style={styles.youText}>SEN</Text>
              </View>
            )}
          </View>
          {/* Masaüstündeki gibi önce özel durum, yoksa sesli sohbet; ikisi de yoksa yalnız isim */}
          {custom ? (
            <Text style={[styles.sub, plate && styles.plateSub]} numberOfLines={1}>
              {`${custom.emoji ? `${custom.emoji} ` : ''}${custom.text ?? ''}`}
            </Text>
          ) : (
            inVoice && (
              <View style={styles.subRow}>
                <Ionicons name="volume-medium" size={13} color={colors.ok} />
                <Text style={[styles.sub, { color: colors.ok }]}>Sesli sohbette</Text>
              </View>
            )
          )}
        </View>
      </Pressable>
    </View>
  );
});

const CARD_RADIUS = radius.lg - 4;

const styles = createStyles(() => ({
  content: { paddingHorizontal: space.lg, paddingBottom: space.xxl, flexGrow: 1 },
  section: { color: colors.muted, fontSize: font.small + 0.5, fontWeight: '600', paddingTop: space.xl, paddingBottom: space.sm, paddingLeft: space.xs },
  cardRow: { backgroundColor: colors.side, overflow: 'hidden' },
  cardFirst: { borderTopLeftRadius: CARD_RADIUS, borderTopRightRadius: CARD_RADIUS },
  cardLast: { borderBottomLeftRadius: CARD_RADIUS, borderBottomRightRadius: CARD_RADIUS },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    height: 58,
    paddingHorizontal: space.md + 2,
    overflow: 'hidden',
  },
  divider: {
    position: 'absolute',
    top: 0,
    left: space.md + 2 + 38 + space.md,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.line,
  },
  offline: { opacity: 0.45 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { color: colors.text, fontSize: font.row, fontWeight: '600', flexShrink: 1 },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 1 },
  sub: { color: colors.muted, fontSize: font.caption + 0.5, marginTop: 1 },
  plateSub: { color: 'rgba(255,255,255,0.78)', ...NAMEPLATE_TEXT_SHADOW },
  youTag: { backgroundColor: colors.brandSoft, borderRadius: radius.sm, paddingHorizontal: 5, paddingVertical: 1 },
  youText: { color: colors.brandText, fontSize: 9.5, fontWeight: '800' },
}));
