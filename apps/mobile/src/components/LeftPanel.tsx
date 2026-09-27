import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { openChat, useNav } from '../stores/nav';
import { colors, createStyles, font, space } from '../theme';
import { joinVoice } from '../voice/actions';
import { ChannelList, GuildHeader } from './ChannelList';
import { DmList } from './DmList';
import { HeaderButton } from './HeaderButton';
import { MemberSheet } from './MemberSheet';
import { ServerRail } from './ServerRail';
import { UserPanel } from './UserPanel';

/**
 * Soldan açılan panel (Discord mobil gibi): en solda dikey sunucu çubuğu, yanında seçili sunucunun
 * kanalları (ya da ana sayfa seçiliyse direkt mesajlar), en altta kullanıcı paneli (sesteyken tek
 * satırlık ses çubuğu). Kanala ya da konuşmaya dokununca panel kapanır ve sohbet o olur.
 */
export function LeftPanel({ currentChat }: { currentChat: string | null }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const home = useNav((s) => s.home);
  // Ses kanalında uzun basılan (yönetilecek) üye
  const [member, setMember] = useState<string | null>(null);

  return (
    <View style={styles.root}>
      <View style={[styles.top, { paddingTop: insets.top }]}>
        <ServerRail />
        <View style={styles.column}>
          {home ? (
            <>
              <View style={styles.header}>
                <Text style={styles.title} numberOfLines={1}>
                  Direkt Mesajlar
                </Text>
                <HeaderButton icon="create-outline" label="Yeni mesaj" size={21} onPress={() => router.push('/dm-new')} />
              </View>
              <DmList onOpen={(dm) => openChat(dm.id)} selectedId={currentChat} />
            </>
          ) : (
            <>
              <GuildHeader onMembers={() => router.push('/members')} />
              <ChannelList
                onOpenText={openChat}
                onOpenVoice={(id) => {
                  joinVoice(id);
                  router.push('/voice');
                }}
                onMemberPress={setMember}
                selectedId={currentChat ?? undefined}
              />
            </>
          )}
        </View>
      </View>
      <UserPanel onSettings={() => router.push('/settings')} />
      <MemberSheet userId={member} onClose={() => setMember(null)} />
    </View>
  );
}

const styles = createStyles(() => ({
  root: { flex: 1, backgroundColor: colors.rail },
  top: { flex: 1, flexDirection: 'row' },
  column: { flex: 1, backgroundColor: colors.side, borderTopLeftRadius: 16, overflow: 'hidden' },
  header: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: space.lg,
    paddingRight: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.edge,
  },
  title: { flex: 1, color: colors.head, fontSize: font.title + 1, fontWeight: '800' },
}));
