import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useGuild } from '@diskort/client-core';
import { ChannelChat } from '../components/ChannelChat';
import { NoGuilds } from '../components/ChannelList';
import { ConnectionBanner } from '../components/ConnectionBanner';
import { HeaderButton } from '../components/HeaderButton';
import { LeftPanel } from '../components/LeftPanel';
import { NavShell } from '../components/NavShell';
import { MessageSkeleton } from '../components/Skeleton';
import { EmptyState } from '../components/States';
import { VoiceBar } from '../components/VoiceBar';
import { setPanelOpen, useCurrentChat, useNav } from '../stores/nav';
import { colors, createStyles, space } from '../theme';

const openPanel = (): void => setPanelOpen(true);

/**
 * Ana ekran (Discord mobil gibi): son seçilen kanalın ya da konuşmanın sohbeti. Sağa kaydırınca ya da
 * sol üstteki düğmeyle sunucu çubuğu ve kanal listesi açılır (NavShell, LeftPanel).
 */
export default function HomeScreen() {
  const chatId = useCurrentChat();
  const ready = useGuild((s) => s.status === 'ready');

  // Gösterilecek sohbet yoksa (sunucu yok, kanal yok, konuşma seçilmedi) panel açık gelir
  useEffect(() => {
    if (ready && chatId === null) setPanelOpen(true);
  }, [ready, chatId]);

  return (
    <NavShell panel={<LeftPanel currentChat={chatId} />}>
      {chatId ? <ChannelChat key={chatId} id={chatId} onOpenPanel={openPanel} /> : <EmptyChat ready={ready} />}
    </NavShell>
  );
}

/** Açılacak sohbet yokken sohbetin yerinde: yükleniyor, sunucu yok ya da seçim bekleniyor */
function EmptyChat({ ready }: { ready: boolean }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const home = useNav((s) => s.home);
  const noGuilds = useGuild((s) => s.guild === null);
  return (
    <View style={[styles.page, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <HeaderButton icon="menu" label="Kanallar ve sunucular" size={25} color={colors.text} onPress={openPanel} />
      </View>
      <ConnectionBanner />
      <View style={[styles.body, !ready && { justifyContent: 'flex-start' }]}>
        {!ready ? (
          <MessageSkeleton rows={8} />
        ) : home ? (
          <EmptyState
            icon="chatbubbles"
            title="Bir konuşma seç"
            text="Direkt mesajların soldaki panelde. Yeni bir konuşma da başlatabilirsin."
            action={{ title: 'Yeni mesaj', onPress: () => router.push('/dm-new') }}
          />
        ) : noGuilds ? (
          <NoGuilds />
        ) : (
          <EmptyState
            icon="chatbubbles-outline"
            tone="muted"
            title="Henüz metin kanalı yok"
            text="Kanal oluşturmak için soldaki panelde sunucunun adına dokun → Kanal oluştur (yetkin varsa). Ses kanalları da soldaki panelde."
            action={{ title: 'Kanalları göster', onPress: openPanel }}
          />
        )}
      </View>
      <VoiceBar bottomInset={insets.bottom} />
    </View>
  );
}

const styles = createStyles(() => ({
  page: { flex: 1, backgroundColor: colors.main },
  header: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.edge,
  },
  body: { flex: 1, justifyContent: 'center' },
}));
