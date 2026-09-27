import { memo, useMemo, useState } from 'react';
import { Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { User } from '@diskort/shared';
import { memberGroups, useGuild, useMemberColor } from '@diskort/client-core';
import { Avatar } from '../components/Avatar';
import { MemberSheet } from '../components/MemberSheet';
import { colors } from '../theme';

/** Üye listesi: ayrı gösterilen rollere göre gruplar, çevrimiçi, çevrimdışı. Uzun basınca yönetim menüsü. */
export default function MembersScreen() {
  const users = useGuild((s) => s.users);
  const roles = useGuild((s) => s.roles);
  const online = useGuild((s) => s.online);
  const guild = useGuild((s) => s.guild);
  const [selected, setSelected] = useState<string | null>(null);
  const sections = useMemo(
    () =>
      memberGroups({ users, roles, online, guild }).map((g) => ({
        key: g.id,
        title: `${g.title} — ${g.members.length}`,
        offline: g.id === 'offline',
        data: g.members,
      })),
    [users, roles, online, guild],
  );

  return (
    <SafeAreaView style={styles.page} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Üyeler' }} />
      <SectionList
        sections={sections}
        keyExtractor={(u) => u.id}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{ paddingBottom: 16 }}
        renderSectionHeader={({ section }) => <Text style={styles.section}>{section.title}</Text>}
        renderItem={({ item, section }) => (
          <MemberRow
            user={item}
            offline={section.offline}
            owner={item.id === guild?.ownerId}
            onPress={() => setSelected(item.id)}
          />
        )}
      />
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
  onPress: () => void;
}) {
  const color = useMemberColor(user.id);
  const inVoice = useGuild((s) => Boolean(s.voiceStates[user.id]));
  return (
    <Pressable
      onLongPress={onPress}
      onPress={onPress}
      delayLongPress={300}
      style={({ pressed }) => [styles.row, offline && styles.offline, pressed && { backgroundColor: colors.hover }]}
    >
      <Avatar user={user} size={36} online={!offline} />
      <View style={{ flex: 1 }}>
        <View style={styles.nameRow}>
          <Text style={[styles.name, color ? { color } : null]} numberOfLines={1}>
            {user.displayName}
          </Text>
          {owner && <Ionicons name="star" size={13} color={colors.warn} accessibilityLabel="Sunucunun sahibi" />}
        </View>
        {inVoice && <Text style={styles.sub}>Sesli sohbette</Text>}
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.side },
  section: {
    color: colors.muted,
    fontSize: 12.5,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 6,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, marginHorizontal: 8, paddingHorizontal: 10, borderRadius: 6 },
  offline: { opacity: 0.45 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { color: colors.text, fontSize: 16, fontWeight: '500', flexShrink: 1 },
  sub: { color: colors.muted, fontSize: 12.5 },
});
