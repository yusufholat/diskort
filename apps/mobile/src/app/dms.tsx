import { Stack, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native';
import { DmList } from '../components/DmList';
import { HeaderButton } from '../components/HeaderButton';
import { showChat } from '../stores/nav';
import { colors, createStyles } from '../theme';

/**
 * Direkt mesajlar ekranı. Ana gezinmede konuşmalar sol panelde (ana sayfa düğmesi) listelenir; bu ekran
 * eski bağlantılar için durur. Konuşmaya dokununca ana ekranın sohbeti olur.
 */
export default function DmListScreen() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.page} edges={['bottom']}>
      <Stack.Screen
        options={{
          title: 'Direkt Mesajlar',
          headerRight: () => <HeaderButton icon="create-outline" label="Yeni mesaj" onPress={() => router.push('/dm-new')} />,
        }}
      />
      <DmList onOpen={(dm) => showChat(dm.id)} />
    </SafeAreaView>
  );
}

const styles = createStyles(() => ({
  page: { flex: 1, backgroundColor: colors.main },
}));
