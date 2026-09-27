import { memo, useCallback, useMemo, useState } from 'react';
import { Pressable, SectionList, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import type { User } from '@diskort/shared';
import { memberGroups, useCustomStatus, useGuild, useMemberColor, useSession, useStatus } from '@diskort/client-core';
import { Avatar } from '../components/Avatar';
import { MemberSheet } from '../components/MemberSheet';
import { ListSkeleton } from '../components/Skeleton';
import { EmptyState } from '../components/States';
import { useLayoutAnimationOn } from '../motion';
import { colors, createStyles, font, radius, ripple, space, text } from '../theme';

/** Üye listesi: ayrı gösterilen rollere göre gruplar, çevrimiçi, çevrimdışı. Dokununca üye menüsü. */
export default function MembersScreen() {
  const users = useGuild((s) => s.users);
  const roles = useGuild((s) => s.roles);
  const online = useGuild((s) => s.online);
  const guild = useGuild((s) => s.guild);
  const status = useGuild((s) => s.status);
  const [selected, setSelected] = useState<string | null>(null);
  const sections = useMemo(
    () =>
      memberGroups({ users, roles, online, guild }).map((g) => ({
        key: g.id,
        title: g.title,
        count: g.members.length,
        offline: g.id === 'offline',
        data: g.members,
      })),
    [users, roles, online, guild],
  );
  // Biri çevrimiçi olunca/çıkınca satırı yumuşakça yer değiştirir
  useLayoutAnimationOn(sections.map((s) => `${s.key}:${s.data.map((u) => u.id).join('.')}`).join('|'), 220);

  const renderItem = useCallback(
    ({ item, section }: { item: User; section: { offline: boolean } }) => (
      <MemberRow user={item} offline={section.offline} owner={item.id === guild?.ownerId} onPress={setSelected} />
    ),
    [guild?.ownerId],
  );

  const loading = Object.keys(users).length === 0 && status !== 'ready';

  return (
    <SafeAreaView style={styles.page} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Üyeler' }} />
      {loading ? (
        <ListSkeleton rows={8} avatar={36} />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(u) => u.id}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={{ paddingBottom: space.lg, flexGrow: 1 }}
          renderSectionHeader={({ section }) => (
            <Text style={styles.section}>
              {section.title} — {section.count}
            </Text>
          )}
          renderItem={renderItem}
          ListEmptyComponent={<EmptyState icon="people-outline" tone="muted" title="Üye yok" text="Sunucuda henüz kimse yok." />}
        />
      )}
      <MemberSheet userId={selected} onClose={() => setSelected(null)} />
    </SafeAreaView>
  );
}

const MemberRow = memo(function MemberRow({
  user,
  offline,
  owner,
  onPress,
}: {
  user: User;
  offline: boolean;
  owner: boolean;
  onPress: (userId: string) => void;
}) {
  const color = useMemberColor(user.id);
  const inVoice = useGuild((s) => Boolean(s.voiceStates[user.id]));
  const self = useSession((s) => s.user?.id === user.id);
  const status = useStatus(user.id);
  const custom = useCustomStatus(user.id);
  return (
    <View style={styles.rowWrap}>
      <Pressable
        onPress={() => onPress(user.id)}
        onLongPress={() => onPress(user.id)}
        delayLongPress={300}
        android_ripple={ripple.row}
        style={styles.row}
        accessibilityRole="button"
        accessibilityLabel={`${user.displayName}${offline ? ', çevrimdışı' : ''}${inVoice ? ', sesli sohbette' : ''}`}
      >
        <View style={offline && styles.offline}>
          <Avatar user={user} size={38} status={status} surface={colors.main} />
        </View>
        <View style={[{ flex: 1 }, offline && styles.offline]}>
          <View style={styles.nameRow}>
            <Text style={[styles.name, color ? { color } : null]} numberOfLines={1}>
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
          {inVoice ? (
            <View style={styles.subRow}>
              <Ionicons name="volume-medium" size={13} color={colors.ok} />
              <Text style={[styles.sub, { color: colors.ok }]}>Sesli sohbette</Text>
            </View>
          ) : (
            <Text style={styles.sub} numberOfLines={1}>
              {custom ? `${custom.emoji ? `${custom.emoji} ` : ''}${custom.text ?? ''}` : `@${user.username}`}
            </Text>
          )}
        </View>
      </Pressable>
    </View>
  );
});

const styles = createStyles(() => ({
  page: { flex: 1, backgroundColor: colors.main },
  section: { ...text.section, paddingHorizontal: space.lg, paddingTop: space.xl, paddingBottom: space.sm - 2 },
  rowWrap: { paddingHorizontal: space.sm, paddingVertical: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    height: 54,
    paddingHorizontal: space.sm + 2,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  offline: { opacity: 0.45 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { color: colors.text, fontSize: font.row, fontWeight: '600', flexShrink: 1 },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 1 },
  sub: { color: colors.muted, fontSize: font.caption + 0.5, marginTop: 1 },
  youTag: { backgroundColor: colors.brandSoft, borderRadius: radius.sm, paddingHorizontal: 5, paddingVertical: 1 },
  youText: { color: colors.brandText, fontSize: 9.5, fontWeight: '800' },
}));
