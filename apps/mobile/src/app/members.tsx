import { Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useActiveGuildContext } from '@diskort/client-core';
import { MemberList } from '../components/channelPanel/MemberList';
import { colors, createStyles } from '../theme';

/**
 * Sunucunun üye listesi (sunucu başlığından açılır): ayrı gösterilen rollere göre gruplar, çevrimiçi,
 * çevrimdışı. Kanalın paneli (üyeler, medya, sabitlemeler, bağlantılar) ayrıdır: bkz. channel-panel.tsx.
 */
export default function MembersScreen() {
  // Üye listesi seçili sunucunun listesidir
  const context = useActiveGuildContext();
  return (
    <SafeAreaView style={styles.page} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Üyeler' }} />
      <MemberList source={{ kind: 'guild' }} context={context} />
    </SafeAreaView>
  );
}

const styles = createStyles(() => ({
  page: { flex: 1, backgroundColor: colors.main },
}));
