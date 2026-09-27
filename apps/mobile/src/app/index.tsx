import { useMemo, useState } from 'react';
import { Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { hasPermission, Permission, type Channel, type VoiceState } from '@diskort/shared';
import {
  isUnread,
  membersOf,
  useCan,
  useDmUnreadTotal,
  useGuild,
  useMemberColor,
  useMessages,
  useSession,
} from '@diskort/client-core';
import { Avatar } from '../components/Avatar';
import { MemberSheet } from '../components/MemberSheet';
import { PressableScale } from '../components/PressableScale';
import { SpeakingRing } from '../components/SpeakingRing';
import { VoiceBar } from '../components/VoiceBar';
import { VoiceStateIcon } from '../components/VoiceStateIcon';
import { useLayoutAnimationOn } from '../motion';
import { toast } from '../stores/ui';
import { colors } from '../theme';
import { useVoice, voice } from '../voice/voice';

type Row = { kind: 'text'; channel: Channel } | { kind: 'voice'; channel: Channel };

/** Kanal @everyone'dan gizlenmiş mi (kilit simgesi) */
function usePrivate(channel: Channel): boolean {
  return useGuild((s) => {
    const everyone = channel.overwrites?.find((o) => o.roleId === s.guild?.id);
    return everyone !== undefined && hasPermission(everyone.deny, Permission.VIEW_CHANNEL);
  });
}

export default function HomeScreen() {
  const router = useRouter();
  const guild = useGuild((s) => s.guild);
  const status = useGuild((s) => s.status);
  const channels = useGuild((s) => s.channels);
  // Uzun basılan (yönetilecek) üye
  const [member, setMember] = useState<string | null>(null);

  const sections = useMemo(
    () => [
      { title: 'Metin Kanalları', data: channels.filter((c) => c.type === 'text').map((c): Row => ({ kind: 'text', channel: c })) },
      { title: 'Ses Kanalları', data: channels.filter((c) => c.type === 'voice').map((c): Row => ({ kind: 'voice', channel: c })) },
    ],
    [channels],
  );

  return (
    <SafeAreaView style={styles.page} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Text style={styles.guild} numberOfLines={1}>
          {guild?.name ?? 'Diskort'}
        </Text>
        <View style={styles.headerButtons}>
          <DmButton onPress={() => router.push('/dms')} />
          <PressableScale scaleTo={0.8} hitSlop={10} onPress={() => router.push('/members')} accessibilityLabel="Üyeler">
            <Ionicons name="people" size={23} color={colors.muted} />
          </PressableScale>
          <PressableScale scaleTo={0.8} hitSlop={10} onPress={() => router.push('/settings')} accessibilityLabel="Ayarlar">
            <Ionicons name="settings-sharp" size={22} color={colors.muted} />
          </PressableScale>
        </View>
      </View>
      {status !== 'ready' && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>
            {status === 'reconnecting' ? 'Sunucu bağlantısı koptu, yeniden bağlanılıyor…' : 'Bağlanıyor…'}
          </Text>
        </View>
      )}
      <SectionList
        sections={sections}
        keyExtractor={(row) => row.channel.id}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{ paddingBottom: 16 }}
        renderSectionHeader={({ section }) => <Text style={styles.section}>{section.title}</Text>}
        renderItem={({ item }) =>
          item.kind === 'text' ? (
            <TextChannelRow channel={item.channel} onPress={() => router.push(`/channel/${item.channel.id}`)} />
          ) : (
            <VoiceChannelRow
              channel={item.channel}
              onPress={() => {
                if (useVoice.getState().channelId !== item.channel.id) {
                  voice.join(item.channel.id).catch((err: Error) => toast(err.message, 'error'));
                }
                router.push('/voice');
              }}
              onMemberPress={setMember}
            />
          )
        }
      />
      <VoiceBar />
      <MemberSheet userId={member} onClose={() => setMember(null)} />
    </SafeAreaView>
  );
}

/** Direkt mesajlar düğmesi: okunmamış mesaj sayısıyla */
function DmButton({ onPress }: { onPress: () => void }) {
  const unread = useDmUnreadTotal();
  return (
    <PressableScale
      scaleTo={0.8}
      hitSlop={10}
      onPress={onPress}
      accessibilityLabel={unread > 0 ? `Direkt mesajlar, ${unread} okunmamış` : 'Direkt mesajlar'}
    >
      <Ionicons name="chatbubbles" size={23} color={unread > 0 ? colors.head : colors.muted} />
      {unread > 0 && (
        <View style={styles.headerBadge}>
          <Text style={styles.badgeText}>{unread > 99 ? '99+' : unread}</Text>
        </View>
      )}
    </PressableScale>
  );
}

function TextChannelRow({ channel, onPress }: { channel: Channel; onPress: () => void }) {
  const unread = useGuild((s) => isUnread(s, channel.id));
  const mentionCount = useMessages((s) => s.mentionCounts[channel.id] ?? 0);
  const locked = usePrivate(channel);
  return (
    <PressableScale scaleTo={0.98} onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      {unread && <View style={styles.unreadPill} />}
      <Ionicons name={locked ? 'lock-closed-outline' : 'chatbubble-outline'} size={20} color={unread ? colors.head : colors.muted} />
      <Text style={[styles.name, unread && styles.nameUnread]} numberOfLines={1}>
        {channel.name}
      </Text>
      {mentionCount > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{mentionCount > 99 ? '99+' : mentionCount}</Text>
        </View>
      )}
    </PressableScale>
  );
}

function VoiceChannelRow({
  channel,
  onPress,
  onMemberPress,
}: {
  channel: Channel;
  onPress: () => void;
  onMemberPress: (userId: string) => void;
}) {
  const voiceStates = useGuild((s) => s.voiceStates);
  const members = useMemo(() => membersOf(voiceStates, channel.id), [voiceStates, channel.id]);
  const active = useVoice((s) => s.channelId === channel.id);
  const canConnect = useCan(Permission.CONNECT, channel.id);
  const locked = usePrivate(channel);
  // Katılan üye satırı belirir, ayrılanın yeri yumuşakça kapanır
  useLayoutAnimationOn(members.map((m) => m.userId).join(','));
  return (
    <View>
      <PressableScale
        scaleTo={0.98}
        onPress={() => (canConnect || active ? onPress() : toast('Bu ses kanalına bağlanma iznin yok.', 'error'))}
        style={({ pressed }) => [
          styles.row,
          active && styles.rowActive,
          pressed && styles.pressed,
          !canConnect && !active && { opacity: 0.55 },
        ]}
      >
        <Ionicons
          name={!canConnect || locked ? 'lock-closed-outline' : 'volume-medium'}
          size={21}
          color={active ? colors.head : colors.muted}
        />
        <Text style={[styles.name, active && styles.nameUnread]} numberOfLines={1}>
          {channel.name}
        </Text>
      </PressableScale>
      {members.map((m) => (
        <VoiceMember key={m.userId} state={m} onLongPress={() => onMemberPress(m.userId)} />
      ))}
    </View>
  );
}

function VoiceMember({ state, onLongPress }: { state: VoiceState; onLongPress: () => void }) {
  const user = useGuild((s) => s.users[state.userId]);
  const color = useMemberColor(state.userId);
  const selfId = useSession((s) => s.user?.id);
  const speaking = useVoice((s) => Boolean(s.speaking[state.userId]));
  const inMyChannel = useVoice((s) => s.channelId === state.channelId);
  return (
    <Pressable onLongPress={onLongPress} delayLongPress={300} style={({ pressed }) => [styles.member, pressed && styles.pressed]}>
      <SpeakingRing speaking={inMyChannel && speaking} size={26}>
        <Avatar user={user} size={26} />
      </SpeakingRing>
      <Text
        style={[styles.memberName, state.userId === selfId && { color: colors.head }, color ? { color } : null]}
        numberOfLines={1}
      >
        {user?.displayName ?? '…'}
      </Text>
      {state.streaming && (
        <View style={styles.live}>
          <Text style={styles.liveText}>CANLI</Text>
        </View>
      )}
      <VoiceStateIcon state={state} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.side },
  header: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.4)',
  },
  guild: { color: colors.head, fontSize: 19, fontWeight: '700', flex: 1, marginRight: 12 },
  headerButtons: { flexDirection: 'row', alignItems: 'center', gap: 20 },
  banner: { backgroundColor: colors.warn, paddingVertical: 6, paddingHorizontal: 12 },
  bannerText: { color: '#000', fontSize: 13, fontWeight: '600', textAlign: 'center' },
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 46,
    marginHorizontal: 8,
    paddingHorizontal: 10,
    borderRadius: 6,
  },
  rowActive: { backgroundColor: colors.active },
  pressed: { backgroundColor: colors.hover },
  unreadPill: { position: 'absolute', left: -8, width: 4, height: 10, borderRadius: 2, backgroundColor: '#fff' },
  name: { color: colors.muted, fontSize: 16.5, fontWeight: '500', flex: 1 },
  nameUnread: { color: colors.head, fontWeight: '700' },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 6,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  headerBadge: {
    position: 'absolute',
    top: -7,
    right: -10,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    backgroundColor: colors.danger,
    borderWidth: 2,
    borderColor: colors.side,
    alignItems: 'center',
    justifyContent: 'center',
  },
  member: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 48, paddingRight: 16, height: 36 },
  memberName: { color: colors.muted, fontSize: 15, flex: 1 },
  live: { backgroundColor: colors.danger, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 },
  liveText: { color: '#fff', fontSize: 10, fontWeight: '800' },
});
